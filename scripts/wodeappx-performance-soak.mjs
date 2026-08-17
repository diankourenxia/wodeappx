#!/usr/bin/env node
/**
 * WodeAppX 性能 soak（RUNTIME_PERFORMANCE_REMEDIATION.md §10.4 子集的可复跑实现）。
 *
 * 场景（--scenarios，默认 idle,turns,reload）：
 *   idle    空闲 N 分钟（--idle-minutes，默认 5），10 秒采样 CPU/RSS。
 *   turns   经 engine API 发 N 个普通文本 Turn（--turns，默认 100），测 DB 增量与 RSS 增长。
 *   reload  经桌面控制面 POST /workspace/:id/engine/reload × N（--reloads，默认 10），
 *           按 §9.3 验证 owned MCP 数回到基线、无 generation 残留。
 *
 * 门槛：§9.2 / §9.3。证据：§10.6（版本/commit/机型、前后进程树、10 秒 CPU/RSS 时序、
 * SQLite 前后大小与按 event type 统计、reload epoch 日志），写入 --out 目录。
 *
 * 用法：
 *   node scripts/wodeappx-performance-soak.mjs                 # 全量（烧积分：turns 场景）
 *   node scripts/wodeappx-performance-soak.mjs --check         # 只做预检 + 单次采样 + DB 快照，不跑场景
 *   node scripts/wodeappx-performance-soak.mjs --scenarios idle --idle-minutes 5
 *   node scripts/wodeappx-performance-soak.mjs --gates warn    # 门槛失败只告警，不改退出码
 *
 * 限制（v1）：进程采样仅支持 macOS/Linux（ps）；Windows 下采样为空、相关门槛记 NA。
 * Renderer CPU 门槛对「全部 renderer 进程 CPU 之和」判定（Apple Silicon 100% = 单核）。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { cpus, homedir, totalmem, platform, arch, release as osRelease } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const wodeappxRoot = resolve(scriptDir, "..");

const MIB = 1024 * 1024;
const DEFAULT_SAMPLE_INTERVAL_MS = 10_000; // §10.6 要求 10 秒采样
const DEFAULT_PROMPT = "请只回复 OK-SOAK，不要调用任何工具。";

// ---------- 参数 ----------

export function readArg(name, argv = process.argv.slice(2)) {
  const index = argv.indexOf(name);
  if (index === -1) return undefined;
  return argv[index + 1];
}

export function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function hasFlag(name) {
  return process.argv.includes(name);
}

// ---------- 统计（纯函数，单测覆盖） ----------

export function percentile(values, fraction) {
  const sorted = [...values].filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function mean(values) {
  const valid = values.filter((v) => Number.isFinite(v));
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
}

/** 相对稳定段 RSS 增长：末段均值相对首段均值的增长比。样本不足返回 null。 */
export function rssGrowthRatio(rssSeries) {
  const valid = rssSeries.filter((v) => Number.isFinite(v));
  if (valid.length < 10) return null;
  const head = valid.slice(0, Math.max(1, Math.floor(valid.length * 0.1)));
  const tail = valid.slice(-Math.max(1, Math.floor(valid.length * 0.1)));
  const headMean = mean(head);
  const tailMean = mean(tail);
  if (!headMean || !tailMean || headMean <= 0) return null;
  return (tailMean - headMean) / headMean;
}

/** ps time 列（[[dd-]hh:]mm:ss[.cc]）→ 秒。 */
export function parsePsTime(value) {
  const match = String(value ?? "").trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

/** 进程分类：desktop / renderer / gpu / engine / mcp / other。 */
export function classifyProcess(command) {
  const cmd = String(command ?? "");
  if (/--type=renderer/.test(cmd)) return "renderer";
  if (/--type=gpu/.test(cmd)) return "gpu";
  if (/lark-mcp|[-_/]mcp[-_/.]|mcp-server|server\.mjs.*\bmcp\b/i.test(cmd) || (/\bmcp\b/i.test(cmd) && !/opencode/i.test(cmd))) return "mcp";
  if (/opencode/i.test(cmd) && /\bserve\b|--port\b/.test(cmd)) return "engine";
  if (/\.app\/Contents\/MacOS\//.test(cmd) && !/--type=/.test(cmd)) return "desktop";
  return "other";
}

/** 由根 PID 集合计算传递闭包后代（含根本身）。 */
export function collectOwnedPids(processes, rootPids) {
  const childrenByPpid = new Map();
  for (const proc of processes) {
    if (!childrenByPpid.has(proc.ppid)) childrenByPpid.set(proc.ppid, []);
    childrenByPpid.get(proc.ppid).push(proc.pid);
  }
  const owned = new Set();
  const queue = [...rootPids];
  while (queue.length) {
    const pid = queue.shift();
    if (owned.has(pid)) continue;
    owned.add(pid);
    for (const child of childrenByPpid.get(pid) ?? []) queue.push(child);
  }
  return owned;
}

/** 桌面主进程：app bundle 内 MacOS 可执行、无 --type=。已安装版 ppid=1（launchd），dev 版由 pnpm 拉起、ppid 任意。 */
export function findDesktopRootPids(processes) {
  return processes
    .filter((proc) =>
      classifyProcess(proc.command) === "desktop"
      && /(WodeAppX|小灵通|OpenWork|openwork)/i.test(proc.command))
    .map((proc) => proc.pid);
}

/** 门槛评估（纯函数）。返回 [{ id, target, actual, status: pass|fail|na, note }]。 */
export function evaluateGates({ mode = "release", idleRendererCpuP95 = null, turnsRssGrowth = null, dbGrowthMiB = null, turns = 100, newEventStats = null, reloadMcpDelta = null, reloadLeftovers = null } = {}) {
  const cpuLimit = mode === "dev" ? 10 : 5; // §9.2：Release < 5%，Dev < 10%
  const gates = [];
  gates.push({
    id: "idle-renderer-cpu-p95",
    target: `< ${cpuLimit}%（${mode}，§9.2）`,
    actual: idleRendererCpuP95 == null ? null : `${idleRendererCpuP95.toFixed(2)}%`,
    status: idleRendererCpuP95 == null ? "na" : idleRendererCpuP95 < cpuLimit ? "pass" : "fail",
    note: idleRendererCpuP95 == null ? "无 idle 采样或无 renderer 进程" : "全部 renderer 进程 CPU 之和",
  });
  gates.push({
    id: "turns-renderer-rss-growth",
    target: "≤ 25%（相对稳定段，§9.2）",
    actual: turnsRssGrowth == null ? null : `${(turnsRssGrowth * 100).toFixed(1)}%`,
    status: turnsRssGrowth == null ? "na" : turnsRssGrowth <= 0.25 ? "pass" : "fail",
    note: turnsRssGrowth == null ? "采样不足（< 10 个样本）" : "末 10% 样本均值 vs 首 10% 样本均值",
  });
  const dbLimitMiB = turns * 1; // §9.2：100 个普通文本 Turn < 100 MiB → 每 turn 1 MiB
  gates.push({
    id: "turns-db-growth",
    target: `< ${dbLimitMiB} MiB（${turns} turns，§9.2）`,
    actual: dbGrowthMiB == null ? null : `${dbGrowthMiB.toFixed(1)} MiB`,
    status: dbGrowthMiB == null ? "na" : dbGrowthMiB < dbLimitMiB ? "pass" : "fail",
    note: dbGrowthMiB == null ? "未跑 turns 场景或 DB 不可用" : "opencode.db + wal 文件增量与 event 行增量取大者",
  });
  gates.push({
    id: "event-max-size",
    target: "< 2 MiB（单 event，§9.2）",
    actual: newEventStats?.maxMiB == null ? null : `${newEventStats.maxMiB.toFixed(2)} MiB`,
    status: newEventStats?.maxMiB == null ? "na" : newEventStats.maxMiB < 2 ? "pass" : "fail",
    note: newEventStats == null ? "未产生新 event 或无法按 rowid 切分" : `新 event ${newEventStats.count} 个`,
  });
  gates.push({
    id: "event-p99-size",
    target: "p99 < 512 KiB（目标值，§9.2）",
    actual: newEventStats?.p99KiB == null ? null : `${newEventStats.p99KiB.toFixed(0)} KiB`,
    status: newEventStats?.p99KiB == null ? "na" : newEventStats.p99KiB < 512 ? "pass" : "warn",
    note: "目标值，未达不判 fail",
  });
  gates.push({
    id: "reload-mcp-delta",
    target: "= 0（owned MCP 增量，§9.3）",
    actual: reloadMcpDelta == null ? null : String(reloadMcpDelta),
    status: reloadMcpDelta == null ? "na" : reloadMcpDelta === 0 ? "pass" : "fail",
    note: reloadMcpDelta == null ? "未跑 reload 场景" : "N 次 reload 后 owned MCP 数 − 基线",
  });
  gates.push({
    id: "reload-no-leftover",
    target: "无 generation 结束后仍存活的进程（§9.3）",
    actual: reloadLeftovers == null ? null : String(reloadLeftovers),
    status: reloadLeftovers == null ? "na" : reloadLeftovers === 0 ? "pass" : "fail",
    note: reloadLeftovers == null ? "未跑 reload 场景" : "reload 后 owned engine/mcp 进程数超出基线的部分",
  });
  return gates;
}

// ---------- 脱敏 ----------

export function redactString(value) {
  return String(value ?? "")
    .replace(/sk_(?:live|test)_[A-Za-z0-9._-]+/g, "sk_<redacted>")
    .replace(/sk-[A-Za-z0-9._-]{10,}/g, "sk-<redacted>")
    .replace(/owt_[A-Za-z0-9._-]+/g, "owt_<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer <redacted>")
    .replace(/Basic\s+[A-Za-z0-9+/=]+/gi, "Basic <redacted>")
    .slice(0, 1_200);
}

// ---------- Discovery / Engine / 控制面 ----------

function discoveryCandidates() {
  return [
    process.env.OPENWORK_ENGINE_DISCOVERY,
    join(homedir(), "Library", "Application Support", "com.differentai.openwork.dev", "openwork-engine.json"),
    join(homedir(), "Library", "Application Support", "com.differentai.openwork", "openwork-engine.json"),
  ].filter(Boolean);
}

function readDiscoveryFile(file) {
  const raw = JSON.parse(readFileSync(file, "utf8"));
  if (!raw.baseUrl || !raw.directory) throw new Error(`discovery 缺少 baseUrl/directory：${file}`);
  const username = raw.username || raw.auth?.username;
  const password = raw.password || raw.auth?.password;
  if (!username || !password) throw new Error("discovery 缺少 basic auth 凭据");
  return { file, baseUrl: raw.baseUrl, directory: raw.directory, username, password, openwork: raw.openwork ?? null };
}

/** 逐个探测候选 discovery，返回第一个 engine 真正应答的（dev 产物可能残留过期文件）。 */
async function resolveDiscovery() {
  const explicit = readArg("--discovery");
  const candidates = (explicit ? [resolve(explicit)] : discoveryCandidates()).filter((candidate) => existsSync(candidate));
  if (!candidates.length) throw new Error("未找到 engine discovery 文件。请先启动WodeAppX 桌面端。");
  const failures = [];
  for (const file of candidates) {
    let discovery;
    try {
      discovery = readDiscoveryFile(file);
    } catch (error) {
      failures.push(`${file}: ${error.message}`);
      continue;
    }
    try {
      const url = new URL("/session/status", discovery.baseUrl);
      url.searchParams.set("directory", discovery.directory);
      const response = await fetch(url, {
        headers: engineHeaders(discovery),
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) return discovery;
      failures.push(`${file}: HTTP ${response.status}`);
    } catch (error) {
      failures.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`所有 discovery 候选均不可用：${failures.join("；")}`);
}

function engineHeaders(discovery) {
  return { Authorization: `Basic ${Buffer.from(`${discovery.username}:${discovery.password}`).toString("base64")}` };
}

async function engineRequest(discovery, method, pathname, body) {
  const url = new URL(pathname, discovery.baseUrl);
  url.searchParams.set("directory", discovery.directory);
  const response = await fetch(url, {
    method,
    headers: {
      ...engineHeaders(discovery),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!response.ok) throw new Error(`Engine ${method} ${pathname} 失败：HTTP ${response.status} ${redactString(JSON.stringify(parsed))}`);
  return parsed;
}

const engineGet = (discovery, pathname) => engineRequest(discovery, "GET", pathname);
const enginePost = (discovery, pathname, body) => engineRequest(discovery, "POST", pathname, body ?? {});

async function controlRequest(discovery, method, pathname, body) {
  if (!discovery.openwork?.baseUrl || !discovery.openwork?.token) {
    throw new Error("discovery 缺少 openwork 控制面 baseUrl/token，无法执行 reload 场景");
  }
  const url = new URL(pathname, discovery.openwork.baseUrl);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${discovery.openwork.token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  if (!response.ok) {
    const detail = parsed && typeof parsed === "object" ? (parsed.error?.code ?? parsed.code ?? JSON.stringify(parsed)) : String(parsed);
    const error = new Error(`控制面 ${method} ${pathname} 失败：HTTP ${response.status} ${redactString(String(detail))}`);
    error.status = response.status;
    throw error;
  }
  return parsed;
}

/** 当前工作区 id：openwork-workspaces.json 里 path 与 discovery.directory 匹配，或 activeId。 */
function resolveWorkspaceId(discovery) {
  const stateFile = join(dirname(discovery.file), "openwork-workspaces.json");
  if (!existsSync(stateFile)) throw new Error(`未找到 ${stateFile}`);
  const state = JSON.parse(readFileSync(stateFile, "utf8"));
  const workspaces = Array.isArray(state.workspaces) ? state.workspaces : [];
  const byPath = workspaces.find((ws) => ws.path === discovery.directory);
  const id = byPath?.id ?? state.activeId ?? workspaces[0]?.id;
  if (!id) throw new Error("openwork-workspaces.json 中没有可用工作区");
  return id;
}

// ---------- 进程采样 ----------

export function parsePsOutput(output) {
  const processes = [];
  for (const line of String(output ?? "").split("\n")) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;
    processes.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      cpuSeconds: parsePsTime(match[3]),
      rssKiB: Number(match[4]),
      command: match[5].trim(),
    });
  }
  return processes;
}

function listProcesses() {
  if (platform() === "win32") return null; // v1：Windows 暂不支持
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,time=,rss=,command="], { encoding: "utf8", maxBuffer: 16 * MIB });
  if (result.status !== 0) return null;
  return parsePsOutput(result.stdout);
}

function processTreeLines(processes, ownedPids) {
  const byPid = new Map(processes.map((proc) => [proc.pid, proc]));
  const lines = [];
  const roots = [...ownedPids].filter((pid) => !ownedPids.has(byPid.get(pid)?.ppid));
  const walk = (pid, depth) => {
    const proc = byPid.get(pid);
    if (!proc) return;
    lines.push(`${"  ".repeat(depth)}${pid} [${classifyProcess(proc.command)}] rss=${(proc.rssKiB / 1024).toFixed(0)}MiB ${redactString(proc.command).slice(0, 160)}`);
    for (const child of processes.filter((candidate) => candidate.ppid === pid)) walk(child.pid, depth + 1);
  };
  for (const root of roots.sort((a, b) => a - b)) walk(root, 0);
  return lines.join("\n");
}

/**
 * 采样器：每 intervalMs 一次 ps 快照；CPU% 由两次快照的累计 CPU 时间差 / 墙钟差计算。
 */
class Sampler {
  constructor(rootPids, intervalMs, onSample) {
    this.rootPids = rootPids;
    this.intervalMs = intervalMs;
    this.onSample = onSample;
    this.samples = [];
    this.prev = null;
    this.timer = null;
    this.unsupported = platform() === "win32";
  }

  sampleOnce(scenario) {
    const processes = listProcesses();
    if (!processes) return null;
    const now = Date.now();
    const owned = collectOwnedPids(processes, this.rootPids);
    const ownedProcs = processes.filter((proc) => owned.has(proc.pid));
    const byClass = { renderer: [], engine: [], mcp: [], desktop: [], gpu: [], other: [] };
    for (const proc of ownedProcs) byClass[classifyProcess(proc.command)].push(proc);

    let rendererCpuPct = null;
    if (this.prev) {
      const wallSeconds = (now - this.prev.at) / 1000;
      const prevCpuByPid = new Map(this.prev.procs.map((proc) => [proc.pid, proc.cpuSeconds]));
      let cpuSum = 0;
      let counted = false;
      for (const proc of byClass.renderer) {
        const before = prevCpuByPid.get(proc.pid);
        if (before == null || proc.cpuSeconds == null) continue; // 新进程或 PID 复用，跳过本拍
        const delta = proc.cpuSeconds - before;
        if (delta < 0) continue;
        cpuSum += (delta / wallSeconds) * 100;
        counted = true;
      }
      if (counted) rendererCpuPct = cpuSum;
    }

    const sumRss = (list) => list.reduce((total, proc) => total + proc.rssKiB / 1024, 0);
    const sample = {
      ts: new Date(now).toISOString(),
      scenario,
      rendererCpuPct,
      rendererRssMiB: sumRss(byClass.renderer),
      engineRssMiB: sumRss(byClass.engine),
      desktopRssMiB: sumRss(byClass.desktop),
      totalRssMiB: sumRss(ownedProcs),
      mcpCount: byClass.mcp.length,
      engineCount: byClass.engine.length,
      rendererCount: byClass.renderer.length,
      ownedCount: ownedProcs.length,
    };
    this.samples.push(sample);
    this.prev = { at: now, procs: ownedProcs };
    this.onSample?.(sample);
    return sample;
  }

  start(getScenario) {
    if (this.unsupported) return;
    this.timer = setInterval(() => {
      try { this.sampleOnce(getScenario()); } catch { /* 采样失败不中断场景 */ }
    }, this.intervalMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  seriesFor(scenario, field) {
    return this.samples.filter((sample) => sample.scenario === scenario).map((sample) => sample[field]).filter((v) => v != null);
  }
}

// ---------- SQLite（opencode.db，event 表） ----------

export function locateDb() {
  const explicit = readArg("--db");
  if (explicit) return resolve(explicit);
  const roots = [
    join(homedir(), "Library", "Application Support", "com.differentai.openwork.dev", "openwork-runtime-data"),
    join(homedir(), "Library", "Application Support", "com.differentai.openwork", "openwork-runtime-data"),
  ];
  const candidates = [];
  for (const root of roots) {
    let accounts = [];
    try { accounts = readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const account of accounts) {
      if (!account.isDirectory()) continue;
      const file = join(root, account.name, "xdg", "data", "opencode", "opencode.db");
      if (existsSync(file)) candidates.push({ file, mtimeMs: statSync(file).mtimeMs });
    }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return candidates[0]?.file ?? null;
}

export function openDbReadonly(dbPath) {
  // Node ≥22.5 内置 node:sqlite；WAL 模式下只读查询不与 engine 写入冲突。
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA query_only = ON");
  return db;
}

export function fileSizeBytes(path) {
  try { return statSync(path).size; } catch { return 0; }
}

export function dbSnapshot(dbPath) {
  const snapshot = {
    path: dbPath,
    at: new Date().toISOString(),
    fileBytes: fileSizeBytes(dbPath),
    walBytes: fileSizeBytes(`${dbPath}-wal`),
    event: null,
    byType: [],
    maxRowid: null,
    error: null,
  };
  let db;
  try {
    db = openDbReadonly(dbPath);
    snapshot.event = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(LENGTH(data)),0) AS bytes, COALESCE(MAX(LENGTH(data)),0) AS maxBytes FROM event").get();
    snapshot.byType = db.prepare("SELECT type, COUNT(*) AS count, SUM(LENGTH(data)) AS bytes FROM event GROUP BY type ORDER BY bytes DESC LIMIT 25").all();
    try {
      snapshot.maxRowid = db.prepare("SELECT MAX(rowid) AS r FROM event").get()?.r ?? null;
    } catch { snapshot.maxRowid = null; }
  } catch (error) {
    snapshot.error = redactString(error instanceof Error ? error.message : String(error));
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
  return snapshot;
}

function newEventStats(dbPath, sinceRowid) {
  if (sinceRowid == null) return null;
  let db;
  try {
    db = openDbReadonly(dbPath);
    const rows = db.prepare("SELECT LENGTH(data) AS len FROM event WHERE rowid > ?").all(sinceRowid);
    const lengths = rows.map((row) => row.len);
    return {
      count: lengths.length,
      maxMiB: lengths.length ? Math.max(...lengths) / MIB : 0,
      p99KiB: (percentile(lengths, 0.99) ?? 0) / 1024,
    };
  } catch {
    return null;
  } finally {
    try { db?.close(); } catch { /* ignore */ }
  }
}

// ---------- 报告 ----------

function machineInfo() {
  const cpu = cpus()?.[0]?.model ?? "unknown";
  return {
    platform: `${platform()} ${arch()} ${osRelease()}`,
    cpu,
    cores: cpus()?.length ?? 0,
    totalMemGiB: (totalmem() / 1024 ** 3).toFixed(1),
    node: process.version,
  };
}

function gitCommit() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: wodeappxRoot, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function packageVersion() {
  try { return JSON.parse(readFileSync(join(wodeappxRoot, "package.json"), "utf8")).version ?? "unknown"; } catch { return "unknown"; }
}

function formatGateTable(gates) {
  const rows = gates.map((gate) => `| ${gate.id} | ${gate.target} | ${gate.actual ?? "NA"} | ${gate.status.toUpperCase()} | ${gate.note} |`);
  return ["| 门槛 | 目标 | 实测 | 结果 | 说明 |", "|---|---|---|---|---|", ...rows].join("\n");
}

// ---------- 主流程 ----------

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    process.stdout.write(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 24).join("\n") + "\n");
    return;
  }

  const mode = readArg("--mode") === "dev" ? "dev" : "release";
  const gatesMode = readArg("--gates") === "warn" ? "warn" : "strict";
  const checkOnly = hasFlag("--check");
  const scenarios = checkOnly ? [] : (readArg("--scenarios") ?? "idle,turns,reload").split(",").map((s) => s.trim()).filter(Boolean);
  const idleMinutes = boundedInteger(readArg("--idle-minutes"), 5, 1, 60);
  const turns = boundedInteger(readArg("--turns"), 100, 1, 500);
  const reloads = boundedInteger(readArg("--reloads"), 10, 1, 50);
  const turnTimeoutMs = boundedInteger(readArg("--turn-timeout-ms"), 90_000, 5_000, 600_000);
  const sampleIntervalMs = boundedInteger(readArg("--sample-interval-ms"), DEFAULT_SAMPLE_INTERVAL_MS, 1_000, 60_000);
  const prompt = readArg("--prompt") ?? DEFAULT_PROMPT;

  const outDir = resolve(readArg("--out") ?? join(wodeappxRoot, "test-results", `perf-soak-${new Date().toISOString().replace(/[:.]/g, "-")}`));
  mkdirSync(outDir, { recursive: true });
  const samplesFile = join(outDir, "samples.jsonl");

  process.stdout.write(`[soak] 输出目录：${outDir}\n`);

  // --- 预检 ---
  const discovery = await resolveDiscovery();
  process.stdout.write(`[soak] engine：${discovery.baseUrl}（discovery: ${discovery.file}）\n`);
  const statuses = await engineGet(discovery, "/session/status");
  const active = Object.entries(statuses ?? {}).filter(([, status]) => status && status.type !== "idle");
  if (scenarios.length && active.length && !hasFlag("--allow-busy")) {
    throw new Error(`有 ${active.length} 个会话仍 busy，先结束再跑（或 --allow-busy 强制）：${active.map(([id]) => id).join(", ")}`);
  }

  const processes = listProcesses();
  const rootPids = processes ? findDesktopRootPids(processes) : [];
  if (!rootPids.length && platform() !== "win32") {
    process.stdout.write("[soak] 警告：未找到桌面主进程，Renderer 相关门槛将记 NA（engine/DB 门槛仍有效）\n");
  }

  const dbPath = locateDb();
  if (!dbPath) process.stdout.write("[soak] 警告：未找到 opencode.db，DB 相关门槛将记 NA\n");

  // --- 采样器 ---
  const sampler = new Sampler(rootPids, sampleIntervalMs, (sample) => {
    appendFile(samplesFile, `${JSON.stringify(sample)}\n`).catch(() => undefined);
  });
  let currentScenario = "preflight";
  if (rootPids.length) {
    sampler.sampleOnce(currentScenario); // 首拍仅建立 CPU 基线
    sampler.start(() => currentScenario);
  }

  const writeProcessTree = (name) => {
    const now = listProcesses();
    if (!now || !rootPids.length) return;
    const owned = collectOwnedPids(now, rootPids);
    writeFileSync(join(outDir, name), `${processTreeLines(now, owned)}\n`);
  };

  const evidence = {
    version: packageVersion(),
    commit: gitCommit(),
    mode,
    machine: machineInfo(),
    discoveryFile: discovery.file,
    dbPath,
    scenarios,
    options: { idleMinutes, turns, reloads, turnTimeoutMs, sampleIntervalMs, prompt },
    startedAt: new Date().toISOString(),
  };
  writeProcessTree("process-tree-before.txt");
  const dbBefore = dbPath ? dbSnapshot(dbPath) : null;
  if (dbBefore) writeFileSync(join(outDir, "db-before.json"), JSON.stringify(dbBefore, null, 2));

  const report = { scenarios: {}, turnLatenciesMs: [], reloadEpochs: [], errors: [] };

  try {
    // --- 场景：idle ---
    if (scenarios.includes("idle")) {
      currentScenario = "idle";
      process.stdout.write(`[soak] idle：空闲 ${idleMinutes} 分钟，每 ${sampleIntervalMs / 1000}s 采样…\n`);
      const end = Date.now() + idleMinutes * 60_000;
      while (Date.now() < end) {
        await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(sampleIntervalMs, end - Date.now())));
        const busyNow = Object.values(await engineGet(discovery, "/session/status").catch(() => ({})) ?? {}).some((status) => status && status.type !== "idle");
        if (busyNow && !hasFlag("--allow-busy")) {
          report.errors.push("idle 场景期间检测到会话变为 busy，样本可能受污染");
          break;
        }
      }
      const cpuSeries = sampler.seriesFor("idle", "rendererCpuPct");
      report.scenarios.idle = {
        samples: cpuSeries.length,
        rendererCpuP95: percentile(cpuSeries, 0.95),
        rendererRssEndMiB: sampler.samples.filter((s) => s.scenario === "idle").at(-1)?.rendererRssMiB ?? null,
      };
      process.stdout.write(`[soak] idle 完成：样本 ${cpuSeries.length}，renderer CPU p95 = ${report.scenarios.idle.rendererCpuP95?.toFixed(2) ?? "NA"}%\n`);
    }

    // --- 场景：turns ---
    if (scenarios.includes("turns")) {
      currentScenario = "turns";
      process.stdout.write(`[soak] turns：创建会话并发送 ${turns} 个文本 Turn（烧积分，模型走默认路由）…\n`);
      const session = await enginePost(discovery, "/session", { title: `perf-soak ${new Date().toISOString()}` });
      const sessionId = session?.id;
      if (!sessionId) throw new Error("创建 soak 会话失败：响应缺少 id");
      report.scenarios.turns = { sessionId, turns: 0, failures: 0, firstTokenMs: null };
      for (let index = 0; index < turns; index += 1) {
        const startedAt = Date.now();
        await enginePost(discovery, `/session/${encodeURIComponent(sessionId)}/prompt_async`, {
          parts: [{ type: "text", text: prompt }],
        });
        let completed = false;
        while (Date.now() - startedAt < turnTimeoutMs) {
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
          const status = await engineGet(discovery, "/session/status").catch(() => null);
          const sessionStatus = status?.[sessionId];
          if (!sessionStatus || sessionStatus.type === "idle") { completed = true; break; }
        }
        const latency = Date.now() - startedAt;
        if (completed) {
          report.turnLatenciesMs.push(latency);
          report.scenarios.turns.turns += 1;
        } else {
          report.scenarios.turns.failures += 1;
          report.errors.push(`turn ${index + 1} 超时（>${turnTimeoutMs}ms）`);
        }
        if ((index + 1) % 10 === 0) process.stdout.write(`[soak] turns 进度 ${index + 1}/${turns}\n`);
      }
      report.scenarios.turns.latencyP50Ms = percentile(report.turnLatenciesMs, 0.5);
      report.scenarios.turns.latencyP95Ms = percentile(report.turnLatenciesMs, 0.95);
      const rssSeries = sampler.seriesFor("turns", "rendererRssMiB");
      report.scenarios.turns.rssGrowth = rssGrowthRatio(rssSeries);
      process.stdout.write(`[soak] turns 完成：${report.scenarios.turns.turns}/${turns} 成功，p95 ${report.scenarios.turns.latencyP95Ms ?? "NA"}ms\n`);
    }

    // --- 场景：reload ---
    if (scenarios.includes("reload")) {
      currentScenario = "reload";
      const workspaceId = resolveWorkspaceId(discovery);
      const baseline = sampler.samples.at(-1) ?? sampler.sampleOnce("reload");
      const mcpBefore = baseline?.mcpCount ?? null;
      const engineBefore = (baseline?.engineCount ?? 0) + (baseline?.mcpCount ?? 0);
      process.stdout.write(`[soak] reload：工作区 ${workspaceId}，engine/reload × ${reloads}（MCP 基线 ${mcpBefore ?? "NA"}）…\n`);
      report.scenarios.reload = { workspaceId, mcpBefore, attempts: reloads, ok: 0, conflicts: 0 };
      for (let index = 0; index < reloads; index += 1) {
        try {
          const result = await controlRequest(discovery, "POST", `/workspace/${encodeURIComponent(workspaceId)}/engine/reload`, {});
          report.scenarios.reload.ok += 1;
          report.reloadEpochs.push({ at: new Date().toISOString(), runEpoch: result?.runEpoch ?? null, protocol: result?.protocol ?? null });
        } catch (error) {
          if (error.status === 409) {
            report.scenarios.reload.conflicts += 1;
            report.errors.push(`reload ${index + 1} 被拒（409 active_runs）：${redactString(error.message)}`);
          } else {
            throw error;
          }
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
      }
      // 等 engine 稳定后采样对比
      await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.max(sampleIntervalMs, 10_000)));
      const after = sampler.sampleOnce("reload") ?? sampler.samples.at(-1);
      report.scenarios.reload.mcpAfter = after?.mcpCount ?? null;
      report.scenarios.reload.mcpDelta = mcpBefore != null && after?.mcpCount != null ? after.mcpCount - mcpBefore : null;
      const engineAfter = (after?.engineCount ?? 0) + (after?.mcpCount ?? 0);
      report.scenarios.reload.leftoverProcesses = Math.max(0, engineAfter - engineBefore);
      process.stdout.write(`[soak] reload 完成：${report.scenarios.reload.ok}/${reloads} 成功，MCP 增量 ${report.scenarios.reload.mcpDelta ?? "NA"}\n`);
    }
  } finally {
    currentScenario = "done";
    sampler.stop();
  }

  // --- 收尾证据 ---
  writeProcessTree("process-tree-after.txt");
  const dbAfter = dbPath ? dbSnapshot(dbPath) : null;
  if (dbAfter) writeFileSync(join(outDir, "db-after.json"), JSON.stringify(dbAfter, null, 2));

  let dbGrowthMiB = null;
  let eventStats = null;
  if (dbBefore && dbAfter && !dbBefore.error && !dbAfter.error) {
    const fileGrowth = (dbAfter.fileBytes + dbAfter.walBytes - dbBefore.fileBytes - dbBefore.walBytes) / MIB;
    const eventGrowth = ((dbAfter.event?.bytes ?? 0) - (dbBefore.event?.bytes ?? 0)) / MIB;
    dbGrowthMiB = Math.max(fileGrowth, eventGrowth);
    eventStats = scenarios.includes("turns") ? newEventStats(dbPath, dbBefore.maxRowid) : null;
    writeFileSync(join(outDir, "db-delta.json"), JSON.stringify({
      fileGrowthMiB: fileGrowth,
      walBeforeMiB: dbBefore.walBytes / MIB,
      walAfterMiB: dbAfter.walBytes / MIB,
      eventRowGrowth: (dbAfter.event?.count ?? 0) - (dbBefore.event?.count ?? 0),
      eventBytesGrowthMiB: eventGrowth,
      newEventStats: eventStats,
    }, null, 2));
  }

  const gates = evaluateGates({
    mode,
    idleRendererCpuP95: report.scenarios.idle?.rendererCpuP95 ?? null,
    turnsRssGrowth: report.scenarios.turns?.rssGrowth ?? null,
    dbGrowthMiB: scenarios.includes("turns") ? dbGrowthMiB : null,
    turns,
    newEventStats: eventStats,
    reloadMcpDelta: report.scenarios.reload?.mcpDelta ?? null,
    reloadLeftovers: report.scenarios.reload?.leftoverProcesses ?? null,
  });

  evidence.finishedAt = new Date().toISOString();
  evidence.gates = gates;
  evidence.report = report;
  writeFileSync(join(outDir, "metrics.json"), JSON.stringify(evidence, null, 2));

  const markdown = [
    `# WodeAppX 性能 soak 报告`,
    ``,
    `- 版本：${evidence.version}（commit ${evidence.commit}，${mode} 模式）`,
    `- 机器：${evidence.machine.platform}，${evidence.machine.cpu}，${evidence.machine.cores} 核，${evidence.machine.totalMemGiB} GiB`,
    `- 时间：${evidence.startedAt} → ${evidence.finishedAt}`,
    `- 场景：${scenarios.join(", ") || "（仅预检）"}；DB：${dbPath ?? "NA"}`,
    ``,
    `## 门槛（§9.2 / §9.3）`,
    ``,
    formatGateTable(gates),
    ``,
    `## 场景摘要`,
    ``,
    "```json",
    JSON.stringify(report.scenarios, null, 2),
    "```",
    report.errors.length ? `\n## 异常\n\n${report.errors.map((line) => `- ${line}`).join("\n")}\n` : "",
    `## 证据文件`,
    ``,
    `- samples.jsonl（${sampleIntervalMs / 1000}s 采样时序）`,
    `- process-tree-before.txt / process-tree-after.txt`,
    `- db-before.json / db-after.json / db-delta.json`,
    `- metrics.json（完整指标与门槛）`,
  ].join("\n");
  writeFileSync(join(outDir, "report.md"), markdown);

  const failed = gates.filter((gate) => gate.status === "fail");
  process.stdout.write(`\n[soak] 门槛：${gates.filter((g) => g.status === "pass").length} pass / ${failed.length} fail / ${gates.filter((g) => g.status === "na").length} NA\n`);
    for (const gate of failed) process.stdout.write(`[soak] FAIL ${gate.id}: 实测 ${gate.actual}（目标 ${gate.target}）\n`);
  process.stdout.write(`[soak] 报告：${join(outDir, "report.md")}\n`);
  if (failed.length && gatesMode === "strict") {
    process.stderr.write(`[soak] ${failed.length} 个门槛未通过（--gates warn 可降级为告警）\n`);
    process.exit(1);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`[soak] 失败：${redactString(error instanceof Error ? error.message : String(error))}\n`);
    process.exit(1);
  });
}
