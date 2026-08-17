import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, it } from "node:test";

const runtimeUrl = pathToFileURL(path.resolve(
  "integrations/browser-control/opencode-plugin/wodeappx-browser-control-runtime.mjs",
)).href;

let child;
let port;
let tempDir;

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

function request(pathname, { method = "GET", body } = {}) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

before(async () => {
  port = await reservePort();
  tempDir = await mkdtemp(path.join(os.tmpdir(), "wodeappx-browser-longpoll-"));
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
      WODEAPPX_BROWSER_TOKEN: "",
      WODEAPPX_BROWSER_ENABLE_HTTP_FALLBACK: "1",
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

describe("WodeAppX browser command long-poll", () => {
  it("returns immediately when waitMs is omitted", async () => {
    const connect = await request("/extension/connect", {
      method: "POST",
      body: { name: "WodeAppX Browser Control", extensionName: "WodeAppX Browser Control", supportedActions: ["tabs.list"] },
    });
    const { clientId } = await connect.json();
    const started = Date.now();
    const poll = await request(`/extension/command?clientId=${clientId}`);
    const body = await poll.json();
    assert.equal(poll.status, 200);
    assert.equal(body.command, null);
    assert.ok(Date.now() - started < 400);
  });

  it("wakes a waiting poll as soon as a command is queued", async () => {
    const connect = await request("/extension/connect", {
      method: "POST",
      body: { name: "WodeAppX Browser Control", extensionName: "WodeAppX Browser Control", supportedActions: ["tabs.list"] },
    });
    const { clientId } = await connect.json();
    const pending = request(`/extension/command?clientId=${clientId}&waitMs=2500`);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const started = Date.now();
    const agent = request("/agent/call", {
      method: "POST",
      body: { action: "tabs", args: { clientId, activeOnly: true } },
    });
    const pollRes = await pending;
    const poll = await pollRes.json();
    assert.ok(poll.command);
    assert.equal(poll.command.action, "tabs.list");
    assert.ok(Date.now() - started < 600);
    const result = await request("/extension/result", {
      method: "POST",
      body: { clientId, commandId: poll.command.id, ok: true, result: [{ id: 1, title: "ok" }] },
    });
    assert.equal(result.status, 200);
    const agentRes = await agent;
    const agentBody = await agentRes.json();
    assert.equal(agentBody.ok, true);
  });
});
