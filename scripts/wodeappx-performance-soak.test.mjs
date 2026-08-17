import test from "node:test";
import assert from "node:assert/strict";

import {
  boundedInteger,
  classifyProcess,
  collectOwnedPids,
  evaluateGates,
  findDesktopRootPids,
  parsePsOutput,
  parsePsTime,
  percentile,
  redactString,
  rssGrowthRatio,
} from "./wodeappx-performance-soak.mjs";

test("percentile 取上界索引", () => {
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10);
  assert.equal(percentile([1, 2, 3, 4], 0.5), 2);
  assert.equal(percentile([], 0.95), null);
  assert.equal(percentile([5], 0.99), 5);
});

test("boundedInteger 夹紧范围并兜底", () => {
  assert.equal(boundedInteger("20", 5, 1, 10), 10);
  assert.equal(boundedInteger("0", 5, 1, 10), 1);
  assert.equal(boundedInteger("abc", 5, 1, 10), 5);
  assert.equal(boundedInteger(undefined, 5, 1, 10), 5);
});

test("parsePsTime 支持 mm:ss、hh:mm:ss、dd-hh:mm:ss", () => {
  assert.equal(parsePsTime("0:03.42"), 3.42);
  assert.equal(parsePsTime("01:12:33"), 4353);
  assert.equal(parsePsTime("1-02:03:04"), 93784);
  assert.equal(parsePsTime("垃圾"), null);
});

test("parsePsOutput 解析 ps 行", () => {
  const output = "  101     1 02:03:04  123456 /Applications/WodeAppX.app/Contents/MacOS/WodeAppX\n" +
    "  202   101 0:03.42   65432 /Applications/WodeAppX.app/Contents/MacOS/WodeAppX --type=renderer --enable-features=x\n";
  const procs = parsePsOutput(output);
  assert.equal(procs.length, 2);
  assert.deepEqual(procs[0], {
    pid: 101,
    ppid: 1,
    cpuSeconds: 7384,
    rssKiB: 123456,
    command: "/Applications/WodeAppX.app/Contents/MacOS/WodeAppX",
  });
  assert.equal(procs[1].ppid, 101);
});

test("classifyProcess 分类 renderer / engine / mcp / desktop", () => {
  assert.equal(classifyProcess("/Applications/WodeAppX.app/Contents/MacOS/WodeAppX --type=renderer --x"), "renderer");
  assert.equal(classifyProcess("/Applications/WodeAppX.app/Contents/MacOS/WodeAppX --type=gpu-process"), "gpu");
  assert.equal(classifyProcess("node /Users/x/opencode serve --port 4096"), "engine");
  assert.equal(classifyProcess("npx -y lark-mcp@latest mcp -a x -s y"), "mcp");
  assert.equal(classifyProcess("/Applications/WodeAppX.app/Contents/MacOS/WodeAppX"), "desktop");
  assert.equal(classifyProcess("/usr/sbin/syslogd"), "other");
});

test("collectOwnedPids 计算传递闭包后代", () => {
  const procs = [
    { pid: 1, ppid: 0 },
    { pid: 2, ppid: 1 },
    { pid: 3, ppid: 2 },
    { pid: 4, ppid: 2 },
    { pid: 5, ppid: 99 },
  ];
  assert.deepEqual([...collectOwnedPids(procs, [2])].sort(), [2, 3, 4]);
});

test("findDesktopRootPids 识别已安装版（ppid=1）与 dev 版（pnpm 拉起）主进程", () => {
  const procs = [
    { pid: 10, ppid: 1, command: "/Applications/WodeAppX.app/Contents/MacOS/WodeAppX" },
    { pid: 11, ppid: 10, command: "/Applications/WodeAppX.app/Contents/MacOS/WodeAppX --type=renderer" },
    { pid: 12, ppid: 1, command: "/usr/libexec/lsd" },
    { pid: 20, ppid: 15, command: "/Users/x/node_modules/electron/dist/WodeAppX.app/Contents/MacOS/WodeAppX ./electron/main.mjs" },
  ];
  assert.deepEqual(findDesktopRootPids(procs), [10, 20]);
});

test("rssGrowthRatio 首末 10% 均值比较，样本不足返回 null", () => {
  assert.equal(rssGrowthRatio([100, 100, 100]), null);
  const stable = Array.from({ length: 100 }, () => 100);
  assert.ok(Math.abs(rssGrowthRatio(stable)) < 1e-9);
  const growing = Array.from({ length: 100 }, (_, i) => 100 + i * 0.5);
  const ratio = rssGrowthRatio(growing);
  assert.ok(ratio > 0.3 && ratio < 0.6, `ratio=${ratio}`);
});

test("evaluateGates 按 §9.2/§9.3 判定 pass/fail/na", () => {
  const gates = evaluateGates({
    mode: "release",
    idleRendererCpuP95: 3.2,
    turnsRssGrowth: 0.1,
    dbGrowthMiB: 42,
    turns: 100,
    newEventStats: { count: 500, maxMiB: 0.3, p99KiB: 100 },
    reloadMcpDelta: 0,
    reloadLeftovers: 0,
  });
  const byId = Object.fromEntries(gates.map((gate) => [gate.id, gate.status]));
  assert.deepEqual(byId, {
    "idle-renderer-cpu-p95": "pass",
    "turns-renderer-rss-growth": "pass",
    "turns-db-growth": "pass",
    "event-max-size": "pass",
    "event-p99-size": "pass",
    "reload-mcp-delta": "pass",
    "reload-no-leftover": "pass",
  });
});

test("evaluateGates 超标判 fail，缺数据判 na，dev 模式放宽 CPU", () => {
  const failing = evaluateGates({
    mode: "release",
    idleRendererCpuP95: 7,
    turnsRssGrowth: 0.4,
    dbGrowthMiB: 150,
    turns: 100,
    newEventStats: { count: 3, maxMiB: 2.5, p99KiB: 900 },
    reloadMcpDelta: 2,
    reloadLeftovers: 1,
  });
  const byId = Object.fromEntries(failing.map((gate) => [gate.id, gate.status]));
  assert.equal(byId["idle-renderer-cpu-p95"], "fail");
  assert.equal(byId["turns-renderer-rss-growth"], "fail");
  assert.equal(byId["turns-db-growth"], "fail");
  assert.equal(byId["event-max-size"], "fail");
  assert.equal(byId["event-p99-size"], "warn");
  assert.equal(byId["reload-mcp-delta"], "fail");

  const dev = evaluateGates({ mode: "dev", idleRendererCpuP95: 7 });
  assert.equal(dev.find((gate) => gate.id === "idle-renderer-cpu-p95").status, "pass");

  const empty = evaluateGates({});
  assert.ok(empty.every((gate) => gate.status === "na"));
});

test("redactString 脱敏密钥与 token", () => {
  const dirty = "key sk_live_abc.def.123 token owt_abc123 Bearer xyz== Basic QWxhZGRpbjpPcGVu";
  const clean = redactString(dirty);
  assert.ok(!clean.includes("sk_live_abc"), clean);
  assert.ok(!clean.includes("owt_abc123"), clean);
  assert.ok(!clean.includes("Bearer xyz"), clean);
  assert.ok(!clean.includes("QWxhZGRpbjpPcGVu"), clean);
});
