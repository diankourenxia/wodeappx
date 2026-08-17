#!/usr/bin/env node
/**
 * Prefer a local WodeApp mainserver+runtime sidecar when healthy; optionally spawn it
 * from the monorepo (Desktop Local Profile). Otherwise keep existing cloud/selfhost config.
 *
 * Architecture: WodeAppX Electron = host; runtime-server/server stay in monorepo packages.
 * This is NOT folding runtime into the wodeappx repo, and NOT a full SQLite embed yet.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const DEFAULT_LOCAL_ORIGINS = [
  "http://127.0.0.1:3000",
  "http://localhost:3000",
];

function asText(value) {
  return typeof value === "string" && value.trim() ? value.trim().replace(/\/$/, "") : "";
}

export function listLocalOriginCandidates(extra = []) {
  const fromEnv = asText(process.env.WODEAPPX_LOCAL_ORIGIN);
  const list = [];
  if (fromEnv) list.push(fromEnv);
  for (const item of extra) {
    const origin = asText(item);
    if (origin) list.push(origin);
  }
  for (const item of DEFAULT_LOCAL_ORIGINS) {
    if (!list.includes(item)) list.push(item);
  }
  return list;
}

export async function probeWodeAppOrigin(origin, options = {}) {
  const base = asText(origin);
  if (!base) return { ok: false, origin: "", error: "missing origin" };
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 2500;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}/mainserver/api/health`, {
      method: "GET",
      headers: { Accept: "application/json", "X-WodeApp-Desktop": "1" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, origin: base, status: response.status, error: `health ${response.status}` };
    }
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    return { ok: true, origin: base, status: response.status, payload };
  } catch (error) {
    return {
      ok: false,
      origin: base,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function resolvePreferredWodeAppOrigin(options = {}) {
  const cloudFallback = asText(options.cloudOrigin);
  const candidates = listLocalOriginCandidates(options.extraOrigins || []);
  const probes = [];
  for (const origin of candidates) {
    const result = await probeWodeAppOrigin(origin, options);
    probes.push(result);
    if (result.ok) {
      return {
        ok: true,
        origin: result.origin,
        mode: "local",
        desktopLocal: Boolean(result.payload?.desktopLocal),
        profile: result.payload?.profile || "selfhost",
        probes,
      };
    }
  }
  if (cloudFallback) {
    const cloud = await probeWodeAppOrigin(cloudFallback, options);
    probes.push(cloud);
    if (cloud.ok) {
      return {
        ok: true,
        origin: cloud.origin,
        mode: "cloud",
        desktopLocal: false,
        profile: "cloud",
        probes,
      };
    }
  }
  return {
    ok: false,
    origin: "",
    mode: "none",
    probes,
    error: "No healthy WodeApp origin (local or cloud)",
  };
}

/** Best-effort free port finder for a future embedded sidecar. */
export function findFreePort(host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, host, () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
    server.on("error", reject);
  });
}

export function looksLikeMonorepoRoot(dir) {
  if (!dir) return false;
  return existsSync(path.join(dir, "wodeappx", "package.json"))
    && existsSync(path.join(dir, "runtime-server", "package.json"))
    && existsSync(path.join(dir, "server", "package.json"))
    && existsSync(path.join(dir, "scripts", "desktop-local-sidecar.mjs"));
}

/**
 * Resolve monorepo root for spawning the local sidecar.
 * @param {{ env?: NodeJS.ProcessEnv, seedPaths?: string[] }} [options]
 */
export function resolveLocalSidecarMonorepoRoot(options = {}) {
  const env = options.env || process.env;
  const explicit = asText(env.WODEAPP_MONOREPO_ROOT);
  if (explicit && looksLikeMonorepoRoot(explicit)) return path.resolve(explicit);

  // Packaged installs must not walk cwd / ~/Desktop/wodeapp — that fork-bombs
  // Electron when process.execPath is the .app binary.
  if (options.packaged) return "";

  const seeds = [
    ...(Array.isArray(options.seedPaths) ? options.seedPaths : []),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.."),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../.."),
    process.cwd(),
    path.join(homedir(), "Desktop", "wodeapp"),
  ];
  for (const seed of seeds) {
    let current = path.resolve(seed);
    for (let depth = 0; depth < 10; depth += 1) {
      if (looksLikeMonorepoRoot(current)) return current;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return "";
}

export function shouldAutoStartLocalSidecar(options = {}) {
  const env = options.env || process.env;
  const flag = asText(env.WODEAPPX_LOCAL_SIDECAR).toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return false;
  if (flag === "1" || flag === "true" || flag === "on") return true;
  if (options.profile === "local-only") return true;
  if (options.force) return true;
  // Packaged OSS must not auto-spawn from a nearby checkout. Dev trees still do.
  if (options.packaged) return false;
  // Default: auto when OSS edition and monorepo is available (dev / self-evolve tree).
  if (options.edition === "oss" && options.monorepoRoot) return true;
  return false;
}

export function resolveLocalRuntimeDataDir(userDataPath) {
  const fromEnv = asText(process.env.WODEAPPX_LOCAL_RUNTIME_DIR);
  if (fromEnv) return path.resolve(fromEnv);
  if (userDataPath) return path.join(userDataPath, "wodeapp-local-runtime");
  return path.join(homedir(), ".wodeapp", "local-runtime");
}

function runSidecarCommand(monorepoRoot, dataDir, command, options = {}) {
  const script = path.join(monorepoRoot, "scripts", "desktop-local-sidecar.mjs");
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 120_000;
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, command, "--data-dir", dataDir], {
      cwd: monorepoRoot,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        WODEAPP_MONOREPO_ROOT: monorepoRoot,
        WODEAPPX_LOCAL_RUNTIME_DIR: dataDir,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try { child.kill("SIGTERM"); } catch { /* ignore */ }
      resolve({
        ok: false,
        error: `sidecar ${command} timed out after ${timeoutMs}ms`,
        stdout,
        stderr,
      });
    }, timeoutMs);
    child.stdout?.on("data", (buf) => { stdout += String(buf); });
    child.stderr?.on("data", (buf) => { stderr += String(buf); });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: error.message, stdout, stderr });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      let payload = null;
      const text = `${stdout}\n${stderr}`.trim();
      try {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start >= 0 && end > start) payload = JSON.parse(text.slice(start, end + 1));
      } catch {
        payload = null;
      }
      resolve({
        ok: code === 0 && payload?.ok !== false,
        code,
        payload,
        stdout,
        stderr,
        error: payload?.error || (code === 0 ? null : `sidecar ${command} exit ${code}`),
      });
    });
  });
}

/**
 * Ensure a healthy local mainserver (and runtime) exists; spawn from monorepo when allowed.
 * @returns {Promise<{ok:boolean, origin?:string, mode?:string, spawned?:boolean, error?:string, detail?:any}>}
 */
export async function ensureLocalWodeAppSidecar(options = {}) {
  const monorepoRoot = options.monorepoRoot || resolveLocalSidecarMonorepoRoot(options);
  const dataDir = resolveLocalRuntimeDataDir(options.userDataPath);
  const preferred = await resolvePreferredWodeAppOrigin({
    cloudOrigin: "",
    extraOrigins: options.extraOrigins || [],
  });
  if (preferred.ok && preferred.mode === "local") {
    return {
      ok: true,
      origin: preferred.origin,
      mode: "local",
      spawned: false,
      desktopLocal: preferred.desktopLocal,
      profile: preferred.profile || "local-only",
      dataDir,
      monorepoRoot: monorepoRoot || null,
    };
  }

  if (!shouldAutoStartLocalSidecar({
    env: options.env,
    profile: options.profile,
    edition: options.edition,
    monorepoRoot,
    force: options.force,
    packaged: options.packaged,
  })) {
    return {
      ok: false,
      error: "local sidecar auto-start disabled (set WODEAPPX_LOCAL_SIDECAR=1 or profile=local-only)",
      dataDir,
      monorepoRoot: monorepoRoot || null,
    };
  }

  if (!monorepoRoot) {
    return {
      ok: false,
      error: "monorepo root not found — cannot spawn local sidecar (bundled binary not shipped yet)",
      dataDir,
    };
  }

  const started = await runSidecarCommand(monorepoRoot, dataDir, "start", {
    timeoutMs: options.spawnTimeoutMs || 120_000,
  });
  if (!started.ok) {
    return {
      ok: false,
      error: started.error || "failed to start local sidecar",
      detail: started.payload || { stdout: started.stdout, stderr: started.stderr },
      dataDir,
      monorepoRoot,
    };
  }

  const origin = asText(started.payload?.mainOrigin) || "http://127.0.0.1:3000";
  return {
    ok: true,
    origin,
    mode: "local",
    spawned: !started.payload?.reused,
    reused: Boolean(started.payload?.reused),
    desktopLocal: true,
    profile: "local-only",
    dataDir,
    monorepoRoot,
    detail: started.payload,
  };
}

export async function stopLocalWodeAppSidecar(options = {}) {
  const monorepoRoot = options.monorepoRoot || resolveLocalSidecarMonorepoRoot(options);
  const dataDir = resolveLocalRuntimeDataDir(options.userDataPath);
  if (!monorepoRoot) {
    return { ok: false, error: "monorepo root not found" };
  }
  return runSidecarCommand(monorepoRoot, dataDir, "stop", { timeoutMs: 30_000 });
}

export function describeLocalRuntimePlan(userDataPath) {
  const dataDir = resolveLocalRuntimeDataDir(userDataPath);
  const monorepoRoot = resolveLocalSidecarMonorepoRoot();
  return {
    status: "mvp",
    dataDir,
    monorepoRoot: monorepoRoot || null,
    note: "Desktop Local Profile: Electron hosts; monorepo scripts/desktop-local-sidecar.mjs spawns mainserver+runtime-server with OPEN_SOURCE_MODE. Local sidecar is optional; cloud user/credits are an optional add-on layer. Still needs Postgres DATABASE_URL; SQLite embed is later.",
    enable: "WODEAPPX_LOCAL_SIDECAR=1 or profile=local-only (OSS + monorepo auto-starts). Cloud bootstrap: WODEAPPX_CLOUD_BOOTSTRAP=1",
    next: [
      "SQLite / bundled Desktop Profile without external Postgres",
      "resources/wodeapp-runtime binary in electron-builder extraResources",
      "settings/runtime UI for keys + connection mode",
    ],
  };
}

export default {
  listLocalOriginCandidates,
  probeWodeAppOrigin,
  resolvePreferredWodeAppOrigin,
  findFreePort,
  looksLikeMonorepoRoot,
  resolveLocalSidecarMonorepoRoot,
  shouldAutoStartLocalSidecar,
  resolveLocalRuntimeDataDir,
  ensureLocalWodeAppSidecar,
  stopLocalWodeAppSidecar,
  describeLocalRuntimePlan,
};
