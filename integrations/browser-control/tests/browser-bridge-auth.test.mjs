import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, it } from "node:test";

const OFFICIAL_ORIGIN = "chrome-extension://mfnpfomihliahiheofiijbmmhfeanhpb";
const EXTENSION_ID = "mfnpfomihliahiheofiijbmmhfeanhpb";
const BRIDGE_TOKEN = "test-bridge-token-0123456789abcdef0123456789abcdef";
const runtimeUrl = pathToFileURL(path.resolve(
  "integrations/browser-control/opencode-plugin/wodeappx-browser-control-runtime.mjs",
)).href;

let child;
let port;
let tempDir;
let discoveryPath;

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const selected = server.address().port;
      server.close((error) => error ? reject(error) : resolve(selected));
    });
  });
}

function waitForReady(processHandle) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Bridge did not start: ${output}`)), 8_000);
    processHandle.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
      if (!output.includes("BRIDGE_READY")) return;
      clearTimeout(timer);
      resolve();
    });
    processHandle.stderr.on("data", (chunk) => {
      output += chunk.toString("utf8");
    });
    processHandle.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Bridge exited with ${code}: ${output}`));
    });
  });
}

function request(pathname, { token = BRIDGE_TOKEN, clientToken = "", origin = OFFICIAL_ORIGIN, method = "GET", body } = {}) {
  const headers = { Origin: origin };
  if (token) headers["X-WodeAppX-Browser-Token"] = token;
  if (clientToken) headers["X-WodeAppX-Client-Token"] = clientToken;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

before(async () => {
  port = await reservePort();
  tempDir = await mkdtemp(path.join(os.tmpdir(), "wodeappx-browser-auth-"));
  discoveryPath = path.join(tempDir, "browser-control.json");
  const socketPath = path.join(tempDir, "browser-control.sock");
  const code = [
    `const runtime = await import(${JSON.stringify(runtimeUrl)});`,
    "const ready = await runtime.startBridge();",
    "if (!ready) throw new Error('bridge failed');",
    "process.stdout.write('BRIDGE_READY\\n');",
  ].join("\n");
  child = spawn(process.execPath, ["--input-type=module", "--eval", code], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      WODEAPPX_BROWSER_BRIDGE_PORT: String(port),
      WODEAPPX_BROWSER_TOKEN: BRIDGE_TOKEN,
      WODEAPPX_BROWSER_ENABLE_HTTP_FALLBACK: "1",
      WODEAPPX_BROWSER_DISCOVERY_PATH: discoveryPath,
      WODEAPPX_BROWSER_NATIVE_SOCKET: socketPath,
    },
  });
  await waitForReady(child);
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("WodeAppX browser bridge authentication", () => {
  it("stores discovery material with user-only permissions", async () => {
    if (process.platform === "win32") return;
    const metadata = await stat(discoveryPath);
    assert.equal(metadata.mode & 0o777, 0o600);
  });

  it("rejects missing tokens and unapproved extension origins", async () => {
    const missingToken = await request("/health", { token: "" });
    assert.equal(missingToken.status, 401);
    assert.equal(missingToken.headers.get("access-control-allow-origin"), OFFICIAL_ORIGIN);

    const wrongOrigin = await request("/health", { origin: "https://attacker.example" });
    assert.equal(wrongOrigin.status, 403);
    assert.equal(wrongOrigin.headers.get("access-control-allow-origin"), null);
  });

  it("rotates and enforces a client-bound session token", async () => {
    const connect = await request("/extension/connect", {
      method: "POST",
      body: {
        extensionId: EXTENSION_ID,
        extensionName: "WodeAppX Browser Control",
        supportedActions: ["tabs.list"],
      },
    });
    assert.equal(connect.status, 200);
    const first = await connect.json();
    assert.match(first.clientToken, /^[a-f0-9]{64}$/);

    const missingClientToken = await request(`/extension/command?clientId=${first.clientId}`);
    assert.equal(missingClientToken.status, 403);

    const poll = await request(`/extension/command?clientId=${first.clientId}`, {
      clientToken: first.clientToken,
    });
    assert.equal(poll.status, 200);

    const reconnectWithoutToken = await request("/extension/connect", {
      method: "POST",
      body: {
        clientId: first.clientId,
        extensionId: EXTENSION_ID,
        extensionName: "WodeAppX Browser Control",
      },
    });
    assert.equal(reconnectWithoutToken.status, 403);

    const reconnect = await request("/extension/connect", {
      method: "POST",
      clientToken: first.clientToken,
      body: {
        clientId: first.clientId,
        extensionId: EXTENSION_ID,
        extensionName: "WodeAppX Browser Control",
      },
    });
    assert.equal(reconnect.status, 200);
    const second = await reconnect.json();
    assert.notEqual(second.clientToken, first.clientToken);

    const stale = await request(`/extension/command?clientId=${first.clientId}`, {
      clientToken: first.clientToken,
    });
    assert.equal(stale.status, 403);
  });
});
