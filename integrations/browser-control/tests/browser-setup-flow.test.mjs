import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { after, before, describe, it } from "node:test";

const EXTENSION_ID = "mfnpfomihliahiheofiijbmmhfeanhpb";
const EXTENSION_NAME = "WodeAppX Browser Control";
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setupOrigin() {
  return `http://127.0.0.1:${port}`;
}

async function fetchState() {
  const res = await fetch(`${setupOrigin()}/setup/state`);
  assert.equal(res.status, 200);
  return res.json();
}

async function waitForPhase(phases, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await fetchState();
    if (state.run && phases.includes(state.run.phase)) return state.run;
    await sleep(250);
  }
  const state = await fetchState();
  throw new Error(`phase not reached: wanted ${phases.join("/")}, got ${state.run?.phase || "none"} (${state.run?.detail || ""})`);
}

/** Simulates the Chrome extension: registers, long-polls commands, answers smoke-test calls. */
async function fakeExtensionLoop(clientId, stopRef) {
  let reads = 0;
  while (!stopRef.stop) {
    let data;
    try {
      const res = await fetch(`${setupOrigin()}/extension/command?clientId=${clientId}`);
      data = await res.json();
    } catch {
      await sleep(300);
      continue;
    }
    const command = data.command;
    if (!command) {
      await sleep(200);
      continue;
    }
    let result = null;
    if (command.action === "tabs.open") {
      result = { id: 4242, windowId: 1, status: "complete", url: command.args?.url || "" };
    } else if (command.action === "page.read") {
      reads += 1;
      result = reads === 1
        ? {
            tab: { id: 4242, title: "WodeAppX 浏览器扩展自检页" },
            page: {
              title: "WodeAppX 浏览器扩展自检页",
              text: "WodeAppX 浏览器扩展自检页 运行点击自检",
              interactiveElements: [{ nodeId: "n-1", text: "运行点击自检", tag: "button", role: "button" }],
            },
          }
        : {
            tab: { id: 4242, title: "WodeAppX 自检完成" },
            page: { title: "WodeAppX 自检完成", text: "SELFTEST_OK 点击自检通过", interactiveElements: [] },
          };
    } else if (command.action === "page.click") {
      result = { clicked: true, nodeId: command.args?.nodeId || "" };
    }
    await fetch(`${setupOrigin()}/extension/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        commandId: command.id,
        ok: true,
        result,
        extensionId: EXTENSION_ID,
        extensionName: EXTENSION_NAME,
      }),
    });
  }
}

before(async () => {
  port = await reservePort();
  tempDir = await mkdtemp(path.join(os.tmpdir(), "wodeappx-browser-setup-"));
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
      WODEAPPX_BROWSER_SETUP_NO_OPEN: "1",
      WODEAPPX_BROWSER_SETUP_WAIT_MS: "15000",
      WODEAPPX_BROWSER_SETUP_EARLY_WAIT_MS: "2000",
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

describe("WodeAppX browser extension one-click setup flow", () => {
  it("serves the setup page and self-test page", async () => {
    const setup = await fetch(`${setupOrigin()}/setup`);
    assert.equal(setup.status, 200);
    const html = await setup.text();
    assert.match(html, /安装调试/);
    assert.match(html, /autorun/);
    assert.match(html, /function startRun\(/);
    assert.match(html, /已安装，开始连接检测/);
    assert.match(html, /id="detect"/);
    assert.match(html, /调试记录/);
    // Programmatic click on a disabled button is a no-op in Chromium; autorun must call startRun().
    assert.doesNotMatch(html, /if \(!running\) runBtn\.click\(\)/);

    const testPage = await fetch(`${setupOrigin()}/setup/test-page`);
    assert.equal(testPage.status, 200);
    const testHtml = await testPage.text();
    assert.match(testHtml, /运行点击自检/);
    assert.match(testHtml, /浏览器操作调试演示/);
    assert.match(testHtml, /SELFTEST_OK/);
    assert.match(testHtml, /已被扩展点击/);
  });

  it("reports empty state before any run", async () => {
    const state = await fetchState();
    assert.equal(state.run, null);
    assert.deepEqual(state.clients, []);
    assert.match(state.storeUrl, /chromewebstore\.google\.com/);
  });

  it("rejects setup runs from foreign web origins", async () => {
    const res = await fetch(`${setupOrigin()}/setup/run`, {
      method: "POST",
      headers: { Origin: "https://attacker.example" },
    });
    assert.equal(res.status, 403);
  });

  it("runs the full chain: wait for extension, connect, smoke test, done", async () => {
    const start = await fetch(`${setupOrigin()}/setup/run`, {
      method: "POST",
      headers: { Origin: setupOrigin() },
    });
    assert.equal(start.status, 202);

    // auto-open disabled in test → falls back to waiting for manual install
    await waitForPhase(["awaiting_manual_install", "waiting_extension"]);

    // fake extension connects with official identity
    const connect = await fetch(`${setupOrigin()}/extension/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: `chrome-extension://${EXTENSION_ID}` },
      body: JSON.stringify({
        extensionId: EXTENSION_ID,
        extensionName: EXTENSION_NAME,
        extensionVersion: "1.4.0",
        transport: "native_messaging",
        supportedActions: ["tabs.open", "page.read", "page.click"],
      }),
    });
    assert.equal(connect.status, 200);
    const { clientId } = await connect.json();
    assert.ok(clientId);

    const stopRef = { stop: false };
    const loop = fakeExtensionLoop(clientId, stopRef);
    try {
      const done = await waitForPhase(["done", "failed"], 20_000);
      assert.equal(done.phase, "done", done.error || done.detail);
      assert.ok(done.result?.ok);
      const stepNames = done.result.steps.map((step) => step.name);
      assert.deepEqual(stepNames, ["打开自检页", "读取页面标题", "定位自检按钮", "自动点击按钮", "验证点击生效"]);
      for (const step of done.result.steps) assert.equal(step.ok, true, step.name);
    } finally {
      stopRef.stop = true;
      await loop;
    }

    const health = await (await fetch(`${setupOrigin()}/health`)).json();
    assert.match(health.setup.url, /\/setup$/);
    assert.equal(health.clients[0].distribution, "chrome_web_store");
  });

  it("already-connected extension still runs smoke selftest (no store hop)", async () => {
    const connect = await fetch(`${setupOrigin()}/extension/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: `chrome-extension://${EXTENSION_ID}` },
      body: JSON.stringify({
        extensionId: EXTENSION_ID,
        extensionName: EXTENSION_NAME,
        extensionVersion: "1.4.0",
        transport: "native_messaging",
        supportedActions: ["tabs.open", "page.read", "page.click"],
      }),
    });
    assert.equal(connect.status, 200);
    const { clientId } = await connect.json();
    assert.ok(clientId);

    const stopRef = { stop: false };
    const loop = fakeExtensionLoop(clientId, stopRef);
    try {
      const start = await fetch(`${setupOrigin()}/setup/run`, {
        method: "POST",
        headers: { Origin: setupOrigin() },
      });
      assert.equal(start.status, 202);
      const body = await start.json();
      assert.ok(
        ["starting", "smoke_testing", "done"].includes(body.run?.phase),
        `unexpected phase ${body.run?.phase}`,
      );

      const done = await waitForPhase(["done", "failed"], 20_000);
      assert.equal(done.phase, "done", done.error || done.detail);
      assert.ok(done.result?.ok);
      assert.doesNotMatch(String(done.detail || ""), /应用商店/);
    } finally {
      stopRef.stop = true;
      await loop;
    }
  });

  it("detect mode skips the store hop for an already-installed extension", async () => {
    // Fresh client + responder so this case does not depend on leftover state from prior tests.
    const connect = await fetch(`${setupOrigin()}/extension/connect`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: `chrome-extension://${EXTENSION_ID}` },
      body: JSON.stringify({
        extensionId: EXTENSION_ID,
        extensionName: EXTENSION_NAME,
        extensionVersion: "1.4.0",
        transport: "native_messaging",
        supportedActions: ["tabs.open", "page.read", "page.click"],
      }),
    });
    assert.equal(connect.status, 200);
    const { clientId } = await connect.json();
    assert.ok(clientId);

    // Drain any in-flight setup run left by earlier cases.
    for (let i = 0; i < 40; i++) {
      const state = await fetchState();
      const phase = state.run?.phase;
      if (!phase || !["starting", "opening_store", "awaiting_manual_install", "waiting_extension", "smoke_testing"].includes(phase)) {
        break;
      }
      await sleep(250);
    }

    const stopRef = { stop: false };
    const loop = fakeExtensionLoop(clientId, stopRef);
    await sleep(200);
    try {
      const start = await fetch(`${setupOrigin()}/setup/run?mode=detect`, {
        method: "POST",
        headers: {
          Origin: setupOrigin(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mode: "detect" }),
      });
      assert.equal(start.status, 202);
      const body = await start.json();
      assert.equal(body.alreadyRunning, false);
      assert.equal(body.run?.mode, "detect");
      assert.notEqual(body.run?.phase, "opening_store");

      const done = await waitForPhase(["done", "failed", "timeout"], 20_000);
      assert.equal(done.phase, "done", done.error || done.detail);
      assert.equal(done.mode, "detect");
      assert.ok(done.result?.ok);
      assert.doesNotMatch(String(done.detail || ""), /应用商店/);
    } finally {
      stopRef.stop = true;
      await loop;
    }
  });
});
