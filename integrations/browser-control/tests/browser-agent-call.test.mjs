/**
 * Isolated bridge: assert POST /agent/call for status without touching :17654.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
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
      server.close((error) => (error ? reject(error) : resolve(selected)));
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

before(async () => {
  port = await reservePort();
  tempDir = await mkdtemp(path.join(os.tmpdir(), "wodeappx-agent-call-"));
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

describe("POST /agent/call", () => {
  it("returns status for external harnesses", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/agent/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status", args: {} }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.action, "status");
    assert.equal(body.result?.server?.name || body.result?.ok, body.result?.server?.name ? "wodeappx-browser-control" : true);
  });

  it("rejects unknown actions", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/agent/call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "not_a_real_action", args: {} }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.ok, false);
  });

  it("rejects browser-origin requests when the optional bridge token is unset", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/agent/call`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://malicious.example",
      },
      body: JSON.stringify({ action: "open_url", args: { url: "https://example.com" } }),
    });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.ok, false);
    assert.match(body.error, /local non-browser clients/);
  });
});
