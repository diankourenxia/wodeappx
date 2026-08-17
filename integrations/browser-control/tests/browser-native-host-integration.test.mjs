import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const integrationRoot = path.resolve(testDir, "..");
const defaultBinary = path.join(
  integrationRoot,
  "../../vendor/openwork/apps/desktop/resources/native-hosts/wodeappx-browser-native-host",
);
const binaryPath = process.env.WODEAPPX_BROWSER_NATIVE_HOST_BINARY || defaultBinary;
const nativeDescribe = existsSync(binaryPath) ? describe : describe.skip;

let server;
let port;
let socketPath;
let child;
let stdoutBuffer = Buffer.alloc(0);
const nativeResponses = [];
const nativeWaiters = [];
const httpRequests = [];

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      resolve(text ? JSON.parse(text) : {});
    });
    request.on("error", reject);
  });
}

function takeNativeFrames() {
  while (stdoutBuffer.length >= 4) {
    const length = stdoutBuffer.readUInt32LE(0);
    if (stdoutBuffer.length < 4 + length) return;
    const response = JSON.parse(stdoutBuffer.subarray(4, 4 + length).toString("utf8"));
    stdoutBuffer = stdoutBuffer.subarray(4 + length);
    const waiter = nativeWaiters.shift();
    if (waiter) waiter.resolve(response);
    else nativeResponses.push(response);
  }
}

function nativeCall(op, payload = {}) {
  const id = `test-${Date.now()}-${Math.random()}`;
  const message = Buffer.from(JSON.stringify({ id, op, payload }), "utf8");
  const frame = Buffer.allocUnsafe(4 + message.length);
  frame.writeUInt32LE(message.length, 0);
  message.copy(frame, 4);
  child.stdin.write(frame);
  const immediate = nativeResponses.shift();
  if (immediate) return Promise.resolve(immediate);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for native response to ${op}`));
    }, 5_000);
    nativeWaiters.push({
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject,
    });
  });
}

before(async () => {
  server = createServer(async (request, response) => {
    const body = request.method === "POST" ? await readJsonBody(request) : {};
    httpRequests.push({
      method: request.method,
      url: request.url,
      origin: request.headers.origin || "",
      body,
    });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      method: request.method,
      url: request.url,
      received: body,
    }));
  });
  if (process.platform === "win32") {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
  } else {
    socketPath = path.join(
      "/tmp",
      `wax-native-${process.pid}-${Date.now()}.sock`,
    );
    await rm(socketPath, { force: true });
    await new Promise((resolve) => server.listen(socketPath, resolve));
  }

  child = spawn(binaryPath, ["chrome-extension://mfnpfomihliahiheofiijbmmhfeanhpb/"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(port ? { WODEAPPX_BROWSER_BRIDGE_PORT: String(port) } : {}),
      ...(socketPath ? { WODEAPPX_BROWSER_NATIVE_SOCKET: socketPath } : {}),
    },
  });
  child.stdout.on("data", (chunk) => {
    stdoutBuffer = Buffer.concat([stdoutBuffer, chunk]);
    takeNativeFrames();
  });
});

after(async () => {
  child?.stdin.end();
  child?.kill();
  await new Promise((resolve) => server?.close(resolve));
  if (socketPath) await rm(socketPath, { force: true });
});

nativeDescribe("WodeAppX browser native-host protocol", () => {
  it("answers ping without touching the loopback bridge", async () => {
    const beforeCount = httpRequests.length;
    const response = await nativeCall("ping");
    assert.equal(response.ok, true);
    assert.equal(response.transport, "native_messaging");
    assert.equal(response.data.version, "0.1.1");
    assert.equal(httpRequests.length, beforeCount);
  });

  it("maps fixed native operations to the loopback bridge", async () => {
    const response = await nativeCall("extension.connect", {
      clientId: "client-1",
      token: "local-token",
      extensionName: "WodeAppX Browser Control",
    });
    assert.equal(response.ok, true);
    assert.equal(response.status, 200);
    assert.equal(
      response.hostBridgeTransport,
      process.platform === "win32" ? "localhost_tcp_fallback" : "unix_socket",
    );
    assert.equal(response.data.url, "/extension/connect");
    const request = httpRequests.at(-1);
    assert.equal(request.method, "POST");
    assert.equal(request.origin, "chrome-extension://mfnpfomihliahiheofiijbmmhfeanhpb/");
    assert.equal(request.body.clientId, "client-1");
  });

  it("encodes command query values and rejects arbitrary proxy operations", async () => {
    const command = await nativeCall("extension.command", {
      clientId: "client 1",
      token: "a/b",
      waitMs: 20000,
    });
    assert.equal(command.ok, true);
    assert.equal(command.data.url, "/extension/command?clientId=client%201&token=a%2Fb&waitMs=20000");

    const rejected = await nativeCall("proxy.anything", {
      url: "https://example.com",
    });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /Unsupported native operation/);
  });
});
