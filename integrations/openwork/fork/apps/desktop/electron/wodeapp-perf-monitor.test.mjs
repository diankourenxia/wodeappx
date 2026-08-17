import assert from "node:assert/strict";
import test from "node:test";

import {
  classCpuRss,
  classifyProcess,
  formatPerfHudLine,
  parsePsOutput,
  parsePsTime,
  redactCommand,
  shouldAutoEnablePerfMonitor,
  summarizeAppMetrics,
} from "./wodeapp-perf-monitor.mjs";

test("classifyProcess covers renderer/engine/mcp", () => {
  assert.equal(classifyProcess("/App.app/Contents/MacOS/App --type=renderer"), "renderer");
  assert.equal(classifyProcess("opencode serve --port 4096"), "engine");
  assert.equal(classifyProcess("node /tmp/lark-mcp/server.mjs"), "mcp");
});

test("parsePsTime and parsePsOutput", () => {
  assert.equal(parsePsTime("01:02.50"), 62.5);
  assert.equal(parsePsTime("1-02:03:04"), 93784);
  const procs = parsePsOutput("  11  1 00:01.00  2048 opencode serve --port 1\n  12 11 00:00.50  1024 node lark-mcp\n");
  assert.equal(procs.length, 2);
  assert.equal(procs[0].pid, 11);
  assert.equal(procs[0].cpuSeconds, 1);
});

test("shouldAutoEnablePerfMonitor defaults for dev/unpackaged", () => {
  assert.equal(shouldAutoEnablePerfMonitor({ openworkDevMode: true, isPackaged: true, env: {} }), true);
  assert.equal(shouldAutoEnablePerfMonitor({ openworkDevMode: false, isPackaged: false, env: {} }), true);
  assert.equal(shouldAutoEnablePerfMonitor({ openworkDevMode: false, isPackaged: true, env: {} }), false);
  assert.equal(shouldAutoEnablePerfMonitor({ openworkDevMode: false, isPackaged: true, env: { WODEAPPX_PERF_MONITOR: "1" } }), true);
  assert.equal(shouldAutoEnablePerfMonitor({ openworkDevMode: true, isPackaged: false, env: { WODEAPPX_PERF_MONITOR: "0" } }), false);
});

test("summarizeAppMetrics aggregates Chromium types", () => {
  const summary = summarizeAppMetrics([
    { type: "Browser", cpu: { percentCPUUsage: 3 }, memory: { workingSetSize: 1024 * 100 } },
    { type: "Tab", cpu: { percentCPUUsage: 10 }, memory: { workingSetSize: 1024 * 200 } },
    { type: "Tab", cpu: { percentCPUUsage: 5 }, memory: { workingSetSize: 1024 * 50 } },
    { type: "GPU", cpu: { percentCPUUsage: 1 }, memory: { workingSetSize: 1024 * 20 } },
  ]);
  assert.equal(summary.mainCpu, 3);
  assert.equal(summary.rendererCpu, 15);
  assert.ok(Math.abs(summary.rendererRssMiB - 250) < 0.01);
  assert.equal(summary.processCount, 4);
});

test("classCpuRss uses cpu-second deltas", () => {
  const prev = new Map([[1, { cpuSeconds: 10 }], [2, { cpuSeconds: 4 }]]);
  const result = classCpuRss(
    [
      { pid: 1, cpuSeconds: 12, rssKiB: 2048, command: "opencode serve" },
      { pid: 2, cpuSeconds: 5, rssKiB: 1024, command: "opencode serve" },
    ],
    prev,
    2,
  );
  assert.equal(result.count, 2);
  assert.equal(result.cpu, 150); // (2+1)/2 * 100
  assert.equal(result.rssMiB, 3);
});

test("formatPerfHudLine and redactCommand", () => {
  assert.match(redactCommand("Bearer sk_live_abc123xyz"), /redacted/);
  const line = formatPerfHudLine({
    electron: { rendererCpu: 12.4, rendererRssMiB: 800 },
    engine: { cpu: 5, rssMiB: 400 },
    mcp: { count: 2 },
    rendererHints: { longTasks: 3 },
    sqlite: { sizeMiB: 120 },
  });
  assert.match(line, /R 12% 800M/);
  assert.match(line, /MCP 2/);
  assert.match(line, /LT 3/);
  assert.match(line, /DB 120M/);
});
