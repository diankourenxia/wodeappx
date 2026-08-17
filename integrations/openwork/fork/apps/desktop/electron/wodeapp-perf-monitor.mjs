/**
 * Local PERF-09 sampler for WodeAppX desktop (dev-first).
 *
 * Every 10s: Electron app metrics + ps-classified engine/mcp + SQLite size.
 * Keeps a 30-minute ring. Auto-on when OPENWORK_DEV_MODE=1 or unpackaged.
 * Packaged release stays off unless WODEAPPX_PERF_MONITOR=1 or explicit enable.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export const PERF_SAMPLE_INTERVAL_MS = 10_000;
export const PERF_RING_MAX = 180; // 30 min @ 10s
const PERF_RING_PERSIST_EVERY = 6; // ~60s
const MIB = 1024 * 1024;

/** @typedef {{
 *  at: number,
 *  electron: { mainCpu: number|null, mainRssMiB: number|null, rendererCpu: number|null, rendererRssMiB: number|null, gpuCpu: number|null, gpuRssMiB: number|null, processCount: number },
 *  engine: { cpu: number|null, rssMiB: number|null, count: number },
 *  mcp: { cpu: number|null, rssMiB: number|null, count: number },
 *  sqlite: { path: string|null, sizeMiB: number|null },
 *  rendererHints: { longTasks: number, longTaskMaxMs: number, sseEvents: number },
 * }} PerfSample */

export function classifyProcess(command) {
  const cmd = String(command ?? "");
  if (/--type=renderer/.test(cmd)) return "renderer";
  if (/--type=gpu/.test(cmd)) return "gpu";
  if (/lark-mcp|[-_/]mcp[-_/.]|mcp-server|server\.mjs.*\bmcp\b/i.test(cmd) || (/\bmcp\b/i.test(cmd) && !/opencode/i.test(cmd))) {
    return "mcp";
  }
  if (/opencode/i.test(cmd) && /\bserve\b|--port\b/.test(cmd)) return "engine";
  if (/\.app\/Contents\/MacOS\//.test(cmd) && !/--type=/.test(cmd)) return "desktop";
  return "other";
}

export function parsePsTime(value) {
  const match = String(value ?? "").trim().match(/^(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  return days * 86400 + hours * 3600 + minutes * 60 + seconds;
}

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

export function redactCommand(command) {
  return String(command ?? "")
    .replace(/sk_(?:live|test)_[A-Za-z0-9._-]+/g, "sk_<redacted>")
    .replace(/sk-[A-Za-z0-9._-]{10,}/g, "sk-<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer <redacted>")
    .slice(0, 160);
}

export function shouldAutoEnablePerfMonitor({
  openworkDevMode = false,
  isPackaged = true,
  env = process.env,
} = {}) {
  const flag = String(env.WODEAPPX_PERF_MONITOR ?? "").trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  if (flag === "1" || flag === "true" || flag === "on") return true;
  if (openworkDevMode) return true;
  if (!isPackaged) return true;
  return false;
}

export function summarizeAppMetrics(metrics) {
  const buckets = {
    main: { cpu: 0, rssKiB: 0, count: 0 },
    renderer: { cpu: 0, rssKiB: 0, count: 0 },
    gpu: { cpu: 0, rssKiB: 0, count: 0 },
  };
  for (const metric of Array.isArray(metrics) ? metrics : []) {
    const type = String(metric?.type ?? "");
    const cpu = Number(metric?.cpu?.percentCPUUsage);
    const rss = Number(metric?.memory?.workingSetSize);
    let bucket = null;
    if (type === "Browser") bucket = buckets.main;
    else if (type === "Tab" || type === "Utility") bucket = buckets.renderer;
    else if (type === "GPU") bucket = buckets.gpu;
    if (!bucket) continue;
    bucket.count += 1;
    if (Number.isFinite(cpu)) bucket.cpu += cpu;
    if (Number.isFinite(rss)) bucket.rssKiB += rss;
  }
  const toMiB = (kib) => (kib > 0 ? kib / 1024 : null);
  return {
    mainCpu: buckets.main.count ? buckets.main.cpu : null,
    mainRssMiB: toMiB(buckets.main.rssKiB),
    rendererCpu: buckets.renderer.count ? buckets.renderer.cpu : null,
    rendererRssMiB: toMiB(buckets.renderer.rssKiB),
    gpuCpu: buckets.gpu.count ? buckets.gpu.cpu : null,
    gpuRssMiB: toMiB(buckets.gpu.rssKiB),
    processCount: (Array.isArray(metrics) ? metrics : []).length,
  };
}

/**
 * CPU% from consecutive ps snapshots (cpu-seconds delta / wall seconds).
 * @param {Array<{pid:number,cpuSeconds:number|null,rssKiB:number,command:string}>} procs
 * @param {Map<number,{cpuSeconds:number|null}>|null} prevByPid
 * @param {number} wallSeconds
 */
export function classCpuRss(procs, prevByPid, wallSeconds) {
  let cpu = 0;
  let rssKiB = 0;
  let counted = false;
  for (const proc of procs) {
    rssKiB += Number(proc.rssKiB) || 0;
    if (!prevByPid || !Number.isFinite(wallSeconds) || wallSeconds <= 0) continue;
    const prev = prevByPid.get(proc.pid);
    if (!prev || prev.cpuSeconds == null || proc.cpuSeconds == null) continue;
    const delta = proc.cpuSeconds - prev.cpuSeconds;
    if (delta >= 0) {
      cpu += (delta / wallSeconds) * 100;
      counted = true;
    }
  }
  return {
    cpu: counted ? cpu : null,
    rssMiB: procs.length ? rssKiB / 1024 : null,
    count: procs.length,
  };
}

export function findOpencodeDbCandidates(userDataPath, home = homedir()) {
  const roots = [
    userDataPath,
    path.join(home, "Library", "Application Support", "com.differentai.openwork.dev"),
    path.join(home, "Library", "Application Support", "com.differentai.openwork"),
  ].filter(Boolean);
  const found = [];
  for (const root of roots) {
    const runtimeRoot = path.join(root, "openwork-runtime-data");
    if (!existsSync(runtimeRoot)) continue;
    try {
      const accounts = readdirSafe(runtimeRoot);
      for (const account of accounts) {
        const db = path.join(runtimeRoot, account, "xdg", "data", "opencode", "opencode.db");
        if (existsSync(db)) found.push(db);
      }
    } catch {
      // ignore
    }
  }
  return found;
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function measureSqlite(dbPath) {
  if (!dbPath || !existsSync(dbPath)) return { path: null, sizeMiB: null };
  try {
    let size = statSync(dbPath).size;
    for (const suffix of ["-wal", "-shm"]) {
      const side = `${dbPath}${suffix}`;
      if (existsSync(side)) size += statSync(side).size;
    }
    return { path: dbPath, sizeMiB: size / MIB };
  } catch {
    return { path: dbPath, sizeMiB: null };
  }
}

export function pickLargestSqlite(candidates) {
  let best = { path: null, sizeMiB: null };
  for (const candidate of candidates) {
    const measured = measureSqlite(candidate);
    if (measured.sizeMiB == null) continue;
    if (best.sizeMiB == null || measured.sizeMiB > best.sizeMiB) best = measured;
  }
  return best;
}

export function formatPerfHudLine(sample) {
  if (!sample) return "perf —";
  const rCpu = sample.electron?.rendererCpu;
  const rRss = sample.electron?.rendererRssMiB;
  const eCpu = sample.engine?.cpu;
  const eRss = sample.engine?.rssMiB;
  const mcp = sample.mcp?.count ?? 0;
  const lt = sample.rendererHints?.longTasks ?? 0;
  const db = sample.sqlite?.sizeMiB;
  const fmt = (n, digits = 0) => (n == null || !Number.isFinite(n) ? "—" : n.toFixed(digits));
  return `R ${fmt(rCpu, 0)}% ${fmt(rRss, 0)}M · E ${fmt(eCpu, 0)}% ${fmt(eRss, 0)}M · MCP ${mcp} · LT ${lt}${db != null ? ` · DB ${fmt(db, 0)}M` : ""}`;
}

/**
 * @param {{
 *   app: import("electron").App,
 *   getEngineInfo?: () => { pid?: number|null } | null | Promise<{ pid?: number|null } | null>,
 *   intervalMs?: number,
 *   openworkDevMode?: boolean,
 * }} options
 */
export function createPerfMonitor(options) {
  const {
    app,
    getEngineInfo = async () => null,
    intervalMs = PERF_SAMPLE_INTERVAL_MS,
    openworkDevMode = false,
  } = options;

  /** @type {PerfSample[]} */
  const ring = [];
  let enabled = false;
  let timer = null;
  /** @type {Map<number,{cpuSeconds:number|null}>|null} */
  let prevPs = null;
  let prevAt = 0;
  let rendererHints = { longTasks: 0, longTaskMaxMs: 0, sseEvents: 0 };
  let lastSample = null;
  let samplesSincePersist = 0;

  const statePath = () => path.join(app.getPath("userData"), "wodeappx-perf-monitor.json");
  const logsDir = () => path.join(app.getPath("userData"), "logs");
  const ringLatestPath = () => path.join(logsDir(), "wodeappx-perf-ring-latest.json");

  function ensureLogsDir() {
    mkdirSync(logsDir(), { recursive: true });
  }

  function persistRingSnapshot(reason = "periodic") {
    try {
      ensureLogsDir();
      const pack = {
        kind: "wodeappx.perf-ring.v1",
        reason,
        writtenAt: new Date().toISOString(),
        hud: formatPerfHudLine(lastSample),
        ringCount: ring.length,
        samples: ring.slice(-PERF_RING_MAX),
      };
      writeFileSync(ringLatestPath(), `${JSON.stringify(pack, null, 2)}\n`, "utf8");
      return ringLatestPath();
    } catch {
      return null;
    }
  }

  /**
   * @param {{
   *   reason?: string,
   *   error?: unknown,
   *   extra?: Record<string, unknown>,
   * }} [input]
   */
  function writeCrashDump(input = {}) {
    try {
      ensureLogsDir();
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const dumpPath = path.join(logsDir(), `wodeappx-crash-${stamp}.json`);
      let errorPayload = null;
      if (input.error instanceof Error) {
        errorPayload = {
          name: input.error.name,
          message: input.error.message,
          stack: input.error.stack,
          code: /** @type {{ code?: unknown }} */ (input.error).code ?? undefined,
        };
      } else if (input.error != null) {
        errorPayload = { message: String(input.error) };
      }
      const pack = {
        kind: "wodeappx.crash-dump.v1",
        writtenAt: new Date().toISOString(),
        reason: input.reason ?? "unknown",
        error: errorPayload,
        hud: formatPerfHudLine(lastSample),
        lastSample,
        samples: ring.slice(-36),
        extra: input.extra ?? null,
      };
      writeFileSync(dumpPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
      persistRingSnapshot("crash");
      return dumpPath;
    } catch {
      return null;
    }
  }

  function readOverride() {
    try {
      const raw = JSON.parse(readFileSync(statePath(), "utf8"));
      if (typeof raw?.enabled === "boolean") return raw.enabled;
    } catch {
      // ignore
    }
    return null;
  }

  function writeOverride(nextEnabled) {
    try {
      mkdirSync(path.dirname(statePath()), { recursive: true });
      writeFileSync(statePath(), `${JSON.stringify({ enabled: nextEnabled, updatedAt: Date.now() }, null, 2)}\n`);
    } catch (error) {
      console.warn("[perf-monitor] failed to persist preference:", error?.message || error);
    }
  }

  function listProcesses() {
    if (process.platform === "win32") return null;
    const result = spawnSync("ps", ["-axo", "pid=,ppid=,time=,rss=,command="], {
      encoding: "utf8",
      maxBuffer: 16 * MIB,
    });
    if (result.status !== 0) return null;
    return parsePsOutput(result.stdout);
  }

  async function collectSample() {
    const at = Date.now();
    const electron = summarizeAppMetrics(typeof app.getAppMetrics === "function" ? app.getAppMetrics() : []);
    const processes = listProcesses();
    let engine = { cpu: null, rssMiB: null, count: 0 };
    let mcp = { cpu: null, rssMiB: null, count: 0 };

    if (processes) {
      const wallSeconds = prevAt > 0 ? (at - prevAt) / 1000 : 0;
      const byClass = { engine: [], mcp: [] };
      for (const proc of processes) {
        const kind = classifyProcess(proc.command);
        if (kind === "engine" || kind === "mcp") byClass[kind].push(proc);
      }
      engine = classCpuRss(byClass.engine, prevPs, wallSeconds);
      mcp = classCpuRss(byClass.mcp, prevPs, wallSeconds);
      prevPs = new Map(processes.map((proc) => [proc.pid, { cpuSeconds: proc.cpuSeconds }]));
    } else {
      prevPs = null;
    }
    prevAt = at;

    const sqlite = pickLargestSqlite(findOpencodeDbCandidates(app.getPath("userData")));
    const hints = { ...rendererHints };
    rendererHints = { longTasks: 0, longTaskMaxMs: 0, sseEvents: 0 };

    /** @type {PerfSample} */
    const sample = {
      at,
      electron,
      engine,
      mcp,
      sqlite,
      rendererHints: hints,
    };

    // Attach generation pid when available (non-secret).
    try {
      const info = await getEngineInfo();
      if (info?.pid) {
        sample.engine = { ...sample.engine, pid: Number(info.pid) };
      }
    } catch {
      // ignore
    }

    ring.push(sample);
    while (ring.length > PERF_RING_MAX) ring.shift();
    lastSample = sample;
    samplesSincePersist += 1;
    if (samplesSincePersist >= PERF_RING_PERSIST_EVERY) {
      samplesSincePersist = 0;
      persistRingSnapshot("periodic");
    }
    return sample;
  }

  function startTimer() {
    if (timer) return;
    timer = setInterval(() => {
      void collectSample().catch((error) => {
        console.warn("[perf-monitor] sample failed:", error?.message || error);
      });
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
    void collectSample().catch(() => undefined);
  }

  function stopTimer() {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  function setEnabled(next, { persist = true } = {}) {
    enabled = Boolean(next);
    if (persist) writeOverride(enabled);
    if (enabled) startTimer();
    else stopTimer();
    return status();
  }

  function status() {
    return {
      enabled,
      autoDefault: shouldAutoEnablePerfMonitor({
        openworkDevMode,
        isPackaged: app.isPackaged,
      }),
      sampleIntervalMs: intervalMs,
      ringCount: ring.length,
      ringMax: PERF_RING_MAX,
      lastSample,
      hud: formatPerfHudLine(lastSample),
    };
  }

  function snapshot() {
    return {
      ...status(),
      samples: [...ring],
    };
  }

  function reportRendererHints(input = {}) {
    const longTasks = Math.max(0, Number(input.longTasks) || 0);
    const longTaskMaxMs = Math.max(0, Number(input.longTaskMaxMs) || 0);
    const sseEvents = Math.max(0, Number(input.sseEvents) || 0);
    rendererHints.longTasks += longTasks;
    rendererHints.longTaskMaxMs = Math.max(rendererHints.longTaskMaxMs, longTaskMaxMs);
    rendererHints.sseEvents += sseEvents;
    return { ok: true, pending: { ...rendererHints } };
  }

  function exportPack() {
    const pack = {
      kind: "wodeappx.perf-monitor.v1",
      exportedAt: new Date().toISOString(),
      appVersion: app.getVersion?.() ?? null,
      platform: process.platform,
      arch: process.arch,
      openworkDevMode,
      isPackaged: app.isPackaged,
      ...snapshot(),
    };
    return JSON.stringify(pack, null, 2);
  }

  function bootstrap() {
    const override = readOverride();
    const auto = shouldAutoEnablePerfMonitor({
      openworkDevMode,
      isPackaged: app.isPackaged,
    });
    // Dev/unpackaged: always on unless WODEAPPX_PERF_MONITOR=0 (handled in shouldAutoEnable).
    // Packaged: respect persisted override, else stay off.
    const next = auto ? true : (override ?? false);
    setEnabled(next, { persist: false });
    if (enabled) {
      console.log(`[perf-monitor] enabled (interval=${intervalMs}ms, ring=${PERF_RING_MAX})`);
    }
    return status();
  }

  function dispose() {
    stopTimer();
    if (ring.length) persistRingSnapshot("dispose");
  }

  return {
    bootstrap,
    setEnabled,
    status,
    snapshot,
    reportRendererHints,
    exportPack,
    writeCrashDump,
    persistRingSnapshot,
    dispose,
    // test hooks
    _collectSample: collectSample,
    _ring: ring,
  };
}
