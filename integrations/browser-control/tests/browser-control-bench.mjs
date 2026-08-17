#!/usr/bin/env node
/**
 * Compare old 500ms empty-poll vs 0.7.0 long-poll wake,
 * and sequential tool hops vs one page.run batch.
 */
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const runtimeUrl = pathToFileURL(path.resolve(
  "integrations/browser-control/opencode-plugin/wodeappx-browser-control-runtime.mjs",
)).href;

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stats(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    n: sorted.length,
    avg: Math.round(sum / sorted.length),
    p50: sorted[Math.floor(sorted.length * 0.5)],
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

async function startRuntime(port, socketPath) {
  process.env.WODEAPPX_BROWSER_BRIDGE_PORT = String(port);
  process.env.WODEAPPX_BROWSER_TOKEN = "";
  process.env.WODEAPPX_BROWSER_NATIVE_SOCKET = socketPath;
  const runtime = await import(`${runtimeUrl}?bench=${port}`);
  const ready = await runtime.startBridge();
  if (!ready) throw new Error("bridge failed");
  return runtime;
}

async function connect(port) {
  const res = await fetch(`http://127.0.0.1:${port}/extension/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "WodeAppX Browser Control",
      extensionName: "WodeAppX Browser Control",
      supportedActions: ["tabs.list", "tabs.open", "page.read", "page.click", "page.run"],
    }),
  });
  return (await res.json()).clientId;
}

async function fakeChromeWork(command) {
  await sleep(12);
  if (command.action === "page.run") {
    const steps = command.args?.steps || [];
    await sleep(12 * Math.max(0, steps.length - 1));
    return {
      ok: true,
      tabId: 7,
      steps: steps.map((step) => ({ ok: true, action: step.do || step.action, result: { id: 7 } })),
      page: { tab: { id: 7 }, page: { title: "bench", text: "ok", interactiveElements: [] } },
    };
  }
  if (command.action === "tabs.list") return [{ id: 7, title: "bench", url: "https://example.com" }];
  if (command.action === "tabs.open") return { id: 7, title: "bench", url: command.args?.url || "" };
  if (command.action === "page.read") {
    return { tab: { id: 7 }, page: { title: "bench", text: "hello", interactiveElements: [{ nodeId: "n-1", text: "Go" }] } };
  }
  if (command.action === "page.click") return { tab: { id: 7 }, clicked: true };
  return { ok: true };
}

async function extensionLoop(port, clientId, { waitMs, idleDelayMs, stopRef }) {
  while (!stopRef.stop) {
    let data;
    try {
      const url = new URL(`http://127.0.0.1:${port}/extension/command`);
      url.searchParams.set("clientId", clientId);
      if (waitMs) url.searchParams.set("waitMs", String(waitMs));
      const res = await fetch(url);
      data = await res.json();
    } catch {
      if (stopRef.stop) return;
      await sleep(50);
      continue;
    }
    if (!data?.command) {
      if (!waitMs) await sleep(idleDelayMs);
      continue;
    }
    const result = await fakeChromeWork(data.command);
    await fetch(`http://127.0.0.1:${port}/extension/result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        commandId: data.command.id,
        ok: true,
        result,
      }),
    });
  }
}

async function measureDelivery(runtime, clientId, rounds) {
  const samples = [];
  for (let i = 0; i < rounds; i += 1) {
    await sleep(180);
    const started = Date.now();
    await runtime.callBrowserControl("tabs", { clientId, activeOnly: true });
    samples.push(Date.now() - started);
  }
  return stats(samples);
}

async function measureSequence(runtime, clientId) {
  const started = Date.now();
  await runtime.callBrowserControl("open_url", { clientId, url: "https://example.com/bench" });
  const read1 = await runtime.callBrowserControl("read_page", { clientId, tabId: 7, maxChars: 400 });
  await runtime.callBrowserControl("click", { clientId, tabId: 7, nodeId: "n-1" });
  await runtime.callBrowserControl("read_page", { clientId, tabId: 7, maxChars: 400 });
  return { ms: Date.now() - started, hops: 4, sample: String(read1).slice(0, 80) };
}

async function measureRun(runtime, clientId) {
  const started = Date.now();
  const out = await runtime.callBrowserControl("run", {
    clientId,
    steps: [
      { do: "open_url", url: "https://example.com/bench" },
      { do: "read_page", maxChars: 400 },
      { do: "click", nodeId: "n-1" },
      { do: "read_page", maxChars: 400 },
    ],
  });
  return { ms: Date.now() - started, hops: 1, sample: String(out).slice(0, 80) };
}

const port = await reservePort();
const tempDir = await mkdtemp(path.join(os.tmpdir(), "wax-bench-"));
const runtime = await startRuntime(port, path.join(tempDir, "sock"));
const clientId = await connect(port);
const stopRef = { stop: false };
const loop = extensionLoop(port, clientId, { waitMs: 20000, idleDelayMs: 80, stopRef });

const newDelivery = await measureDelivery(runtime, clientId, 8);
const runOnce = await measureRun(runtime, clientId);
stopRef.stop = true;
await Promise.race([loop, sleep(50)]);

const oldClient = await connect(port);
const oldStop = { stop: false };
const oldLoop = extensionLoop(port, oldClient, { waitMs: 0, idleDelayMs: 500, stopRef: oldStop });
const oldDelivery = await measureDelivery(runtime, oldClient, 8);
const seqOnce = await measureSequence(runtime, oldClient);
oldStop.stop = true;
await Promise.race([oldLoop, sleep(50)]);

const report = {
  bridge: "0.7.0 isolated bench (fake Chrome, 12ms/action)",
  commandPickupMs: {
    oldPoll500ms: oldDelivery,
    newLongPoll: newDelivery,
  },
  fourStepTaskMs: {
    sequentialTools: seqOnce,
    batchedRun: runOnce,
  },
};
console.log(JSON.stringify(report, null, 2));
await rm(tempDir, { recursive: true, force: true });
process.exit(0);
