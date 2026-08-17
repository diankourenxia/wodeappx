/**
 * PERF-06 步骤 4 共享核心：plan token、门控校验、事务删除。
 * 删除 SQL 只来自 dry-run 模块，禁止在此另写 DELETE。
 */
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  createReadStream,
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { hostname, homedir } from "node:os";
import { join, resolve } from "node:path";
import { finished } from "node:stream/promises";

import {
  COMPACTION_DELETE_SQL,
  copyDatabase,
  fingerprintProjections,
  fingerprintsEqual,
  integrityCheck,
  planCompaction,
} from "./wodeappx-event-db-compaction-dryrun.mjs";
import { fileSizeBytes } from "./wodeappx-performance-soak.mjs";

export const RULE_VERSION = "v1-message-part-final-snapshot";
export const PLAN_TTL_MS = 2 * 60 * 60 * 1000;
export const APPLY_ENV_FLAG = "WODEAPPX_EVENT_DB_COMPACTION_APPLY";

export function openDb(dbPath, { queryOnly = false, busyTimeoutMs = 5_000 } = {}) {
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  if (busyTimeoutMs > 0) db.exec(`PRAGMA busy_timeout = ${Math.floor(busyTimeoutMs)}`);
  if (queryOnly) db.exec("PRAGMA query_only = ON");
  return db;
}

export function dbIdentity(dbPath) {
  const st = statSync(dbPath);
  return {
    dbPath: resolve(dbPath),
    dbInode: Number(st.ino),
    dbSizeBytes: Number(st.size),
    dbMtimeMs: Number(st.mtimeMs),
  };
}

export function computePlanToken(payload) {
  const material = [
    payload.ruleVersion,
    payload.dbPath,
    String(payload.dbInode),
    String(payload.dbSizeBytes),
    String(payload.eventRows),
    String(payload.deleteRows),
    String(payload.deleteBytes),
    payload.issuedAt,
    payload.expiresAt,
  ].join("|");
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

export function buildPlanPayload(dbPath, plan, { issuedAt = new Date().toISOString() } = {}) {
  const identity = dbIdentity(dbPath);
  const issuedMs = Date.parse(issuedAt);
  if (!Number.isFinite(issuedMs)) {
    throw new Error(`issuedAt 非法：${issuedAt}`);
  }
  const payload = {
    ...identity,
    issuedAt,
    expiresAt: new Date(issuedMs + PLAN_TTL_MS).toISOString(),
    eventRows: Number(plan.eventRows),
    deleteRows: Number(plan.deleteRows),
    deleteBytes: Number(plan.deleteBytes),
    ruleVersion: RULE_VERSION,
  };
  payload.token = computePlanToken(payload);
  return payload;
}

export function verifyPlanToken(currentDbPath, planPayload, confirmToken) {
  if (!planPayload || typeof planPayload !== "object") {
    return { ok: false, reason: "缺少 plan payload" };
  }
  if (planPayload.ruleVersion !== RULE_VERSION) {
    return { ok: false, reason: `ruleVersion 不匹配：${planPayload.ruleVersion}` };
  }
  const expiresMs = Date.parse(planPayload.expiresAt);
  if (!Number.isFinite(expiresMs)) {
    return { ok: false, reason: "expiresAt 缺失或非法" };
  }
  if (expiresMs < Date.now()) {
    return { ok: false, reason: "plan 已过期，请重新签发" };
  }
  const issuedMs = Date.parse(planPayload.issuedAt);
  if (!Number.isFinite(issuedMs)) {
    return { ok: false, reason: "issuedAt 缺失或非法" };
  }
  if (computePlanToken(planPayload) !== planPayload.token) {
    return { ok: false, reason: "plan payload 自校验失败（token 被篡改）" };
  }
  if (String(confirmToken || "") !== planPayload.token) {
    return { ok: false, reason: "--confirm-plan 与签发 token 不一致" };
  }
  const identity = dbIdentity(currentDbPath);
  if (identity.dbPath !== planPayload.dbPath) {
    return { ok: false, reason: "dbPath 漂移" };
  }
  if (identity.dbInode !== planPayload.dbInode) {
    return { ok: false, reason: "dbInode 漂移（文件已替换）" };
  }
  if (identity.dbSizeBytes !== planPayload.dbSizeBytes) {
    return { ok: false, reason: `dbSizeBytes 漂移：plan=${planPayload.dbSizeBytes} now=${identity.dbSizeBytes}` };
  }
  const db = openDb(currentDbPath, { queryOnly: true });
  try {
    const live = planCompaction(db);
    if (Number(live.eventRows) !== Number(planPayload.eventRows)) {
      return { ok: false, reason: `eventRows 漂移：plan=${planPayload.eventRows} now=${live.eventRows}` };
    }
    if (Number(live.deleteRows) !== Number(planPayload.deleteRows)) {
      return { ok: false, reason: `deleteRows 漂移：plan=${planPayload.deleteRows} now=${live.deleteRows}` };
    }
    if (Number(live.deleteBytes) !== Number(planPayload.deleteBytes)) {
      return { ok: false, reason: `deleteBytes 漂移：plan=${planPayload.deleteBytes} now=${live.deleteBytes}` };
    }
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
  return { ok: true };
}

export function assertApplyFlagsEnabled({ env = process.env, understandFlag = false } = {}) {
  if (String(env[APPLY_ENV_FLAG] || "") !== "1") {
    return { ok: false, reason: `未开启环境开关 ${APPLY_ENV_FLAG}=1` };
  }
  if (!understandFlag) {
    return { ok: false, reason: "缺少 --i-understand-write-live-db" };
  }
  return { ok: true };
}

export function defaultBackupRoot() {
  const explicit = process.env.WODEAPPX_EVENT_DB_BACKUP_ROOT;
  if (explicit) return resolve(explicit);
  return join(homedir(), "Library", "Application Support", "com.differentai.openwork", "backups");
}

/** 剩余空间（字节）。macOS/Linux 用 df -Pk；失败返回 null。 */
export function freeBytesForPath(targetPath) {
  try {
    const out = execFileSync("df", ["-Pk", targetPath], { encoding: "utf8" });
    const lines = out.trim().split("\n");
    if (lines.length < 2) return null;
    const cols = lines[lines.length - 1].trim().split(/\s+/);
    // Filesystem 1024-blocks Used Available Capacity Mounted
    const availableKb = Number(cols[3]);
    if (!Number.isFinite(availableKb)) return null;
    return availableKb * 1024;
  } catch {
    return null;
  }
}

/**
 * 剩余空间须 ≥ needBytes（通常 = 源库体积 × 1.2）。
 * 另写一字节探测可写性。
 */
export function ensureDiskSpace(backupRoot, needBytes) {
  mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  try { chmodSync(backupRoot, 0o700); } catch { /* ignore */ }
  const probe = join(backupRoot, `.space-probe-${randomBytes(4).toString("hex")}`);
  writeFileSync(probe, "ok", { mode: 0o600 });
  unlinkSync(probe);
  if (typeof needBytes === "number" && needBytes > 0) {
    const free = freeBytesForPath(backupRoot);
    if (free == null) {
      return { ok: false, reason: "无法读取磁盘剩余空间（df 失败）" };
    }
    if (free < needBytes) {
      return {
        ok: false,
        reason: `磁盘剩余 ${(free / 1024 / 1024).toFixed(0)} MiB < 需要 ${(needBytes / 1024 / 1024).toFixed(0)} MiB（源库×1.2）`,
        freeBytes: free,
        needBytes,
      };
    }
    return { ok: true, freeBytes: free, needBytes };
  }
  return { ok: true };
}

export function acquireMaintenanceLock(backupRoot) {
  mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  try { chmodSync(backupRoot, 0o700); } catch { /* ignore */ }
  const lockPath = join(backupRoot, ".compaction-apply.lock");
  try {
    const fd = openSync(lockPath, "wx", 0o600);
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), host: hostname() }));
    try { chmodSync(lockPath, 0o600); } catch { /* ignore */ }
    closeSync(fd);
    return {
      ok: true,
      lockPath,
      release() {
        try { unlinkSync(lockPath); } catch { /* ignore */ }
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: `maintenance lock 已被占用：${lockPath}（${error instanceof Error ? error.message : String(error)}）`,
    };
  }
}

function chmodPrivate(path) {
  try { chmodSync(path, 0o600); } catch { /* ignore */ }
}

export async function createBackup(sourcePath, backupRoot, planPayload) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destDir = join(backupRoot, `event-db-compaction-${stamp}`);
  const needBytes = Math.ceil((fileSizeBytes(sourcePath) + fileSizeBytes(`${sourcePath}-wal`)) * 1.2);
  const space = ensureDiskSpace(backupRoot, needBytes);
  if (!space.ok) {
    return { ok: false, stage: "disk-space", reason: space.reason, needBytes: space.needBytes, freeBytes: space.freeBytes };
  }
  mkdirSync(destDir, { recursive: true, mode: 0o700 });
  try { chmodSync(destDir, 0o700); } catch { /* ignore */ }
  const destPath = copyDatabase(sourcePath, destDir);
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${destPath}${suffix}`;
    if (existsSync(file)) chmodPrivate(file);
  }
  const db = openDb(destPath, { queryOnly: true });
  let integrity;
  try {
    integrity = integrityCheck(db);
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
  if (!integrity.ok) {
    return { ok: false, stage: "backup-integrity", integrity, destDir, destPath };
  }
  const hash = createHash("sha256");
  const stream = createReadStream(destPath);
  stream.on("data", (chunk) => hash.update(chunk));
  await finished(stream);
  const sha256 = hash.digest("hex");
  const manifest = {
    at: new Date().toISOString(),
    host: hostname(),
    sourcePath,
    destPath,
    destDir,
    sizeBytes: fileSizeBytes(destPath),
    walBytes: fileSizeBytes(`${destPath}-wal`),
    sha256,
    planToken: planPayload.token,
    ruleVersion: RULE_VERSION,
  };
  const manifestPath = join(destDir, "backup-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
  chmodPrivate(manifestPath);
  return { ok: true, ...manifest, integrity, disk: space };
}

export function applyCompactionDelete(dbPath, { vacuum = false, forceProjectionMismatch = false } = {}) {
  const sizeBefore = fileSizeBytes(dbPath) + fileSizeBytes(`${dbPath}-wal`);
  const db = openDb(dbPath, { queryOnly: false, busyTimeoutMs: 30_000 });
  try {
    const integrityBefore = integrityCheck(db);
    if (!integrityBefore.ok) return { ok: false, stage: "integrity-before", integrityBefore };

    const fingerprintBefore = fingerprintProjections(db);
    const plan = planCompaction(db);
    const eventRowsBefore = plan.eventRows;

    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(COMPACTION_DELETE_SQL);
      const fingerprintAfter = fingerprintProjections(db);
      // 测试注入：强制投影不一致以验证 ROLLBACK
      const projectionMatch = forceProjectionMismatch
        ? false
        : fingerprintsEqual(fingerprintBefore, fingerprintAfter);
      const fkRows = db.prepare("PRAGMA foreign_key_check").all();
      if (!projectionMatch || fkRows.length > 0) {
        db.exec("ROLLBACK");
        return {
          ok: false,
          stage: "post-delete-check",
          projectionMatch,
          foreignKeyViolations: fkRows.length,
          fingerprintBefore,
          fingerprintAfter,
          rolledBack: true,
          eventRowsAfterRollback: db.prepare("SELECT COUNT(*) AS n FROM event").get().n,
        };
      }
      db.exec("COMMIT");
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch { /* ignore */ }
      throw error;
    }

    const eventRowsAfter = db.prepare("SELECT COUNT(*) AS n FROM event").get().n;
    let vacuumed = false;
    if (vacuum) {
      db.exec("VACUUM");
      vacuumed = true;
    }
    const integrityAfter = integrityCheck(db);
    const sizeAfter = fileSizeBytes(dbPath) + fileSizeBytes(`${dbPath}-wal`);
    return {
      ok: integrityAfter.ok,
      plan,
      deletedRows: eventRowsBefore - eventRowsAfter,
      eventRowsBefore,
      eventRowsAfter,
      projectionMatch: true,
      foreignKeyViolations: 0,
      integrityBefore,
      integrityAfter,
      vacuumed,
      sizeBeforeBytes: sizeBefore,
      sizeAfterBytes: sizeAfter,
      reclaimedBytes: Math.max(0, sizeBefore - sizeAfter),
      rolledBack: false,
    };
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

/**
 * 引擎 idle 探测（fail-closed）：
 * - 无 discovery → 视为引擎未运行，通过
 * - 有 discovery 但请求失败 → 拒绝（除非 allowProbeFailure）
 * - 非 idle → 拒绝
 */
export async function probeEngineIdle(discovery, { allowProbeFailure = false } = {}) {
  if (!discovery?.baseUrl) {
    return { ok: true, skipped: true, detail: "无 discovery，视为引擎未运行" };
  }
  const headers = {
    Authorization: `Basic ${Buffer.from(`${discovery.username}:${discovery.password}`).toString("base64")}`,
  };
  const url = new URL("/session/status", discovery.baseUrl);
  if (discovery.directory) url.searchParams.set("directory", discovery.directory);
  const readOnce = async () => {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };
  let first;
  let second;
  try {
    first = await readOnce();
    await new Promise((r) => setTimeout(r, 200));
    second = await readOnce();
  } catch (error) {
    if (allowProbeFailure) {
      return {
        ok: true,
        skipped: true,
        detail: `idle 探测失败但允许跳过：${error instanceof Error ? error.message : String(error)}`,
      };
    }
    return {
      ok: false,
      detail: `idle 探测失败（fail-closed）：${error instanceof Error ? error.message : String(error)}；可设 WODEAPPX_EVENT_DB_COMPACTION_ALLOW_IDLE_PROBE_FAILURE=1 紧急跳过`,
    };
  }
  const busy = (statusMap) => {
    if (!statusMap || typeof statusMap !== "object") return [];
    return Object.entries(statusMap)
      .filter(([, status]) => {
        const type = status?.type ?? status;
        return type && type !== "idle";
      })
      .map(([id, status]) => `${id}:${status?.type ?? status}`);
  };
  const busyFirst = busy(first);
  const busySecond = busy(second);
  if (busyFirst.length || busySecond.length) {
    return {
      ok: false,
      detail: `引擎非 idle：first=[${busyFirst.join(",")}] second=[${busySecond.join(",")}]`,
    };
  }
  return { ok: true, skipped: false, detail: "引擎两次读取均为 idle" };
}

export function allowIdleProbeFailure(env = process.env) {
  return String(env.WODEAPPX_EVENT_DB_COMPACTION_ALLOW_IDLE_PROBE_FAILURE || "") === "1";
}

/**
 * Apply 编排（可测）：idle → backup → delete。
 * 任一步失败提前返回，不得调用后续副作用（备份/删除）。
 * deps 可注入，供编排单测证明门控短路。
 */
export async function runApplyPipeline({
  dbPath,
  planPayload,
  backupRoot,
  vacuum = false,
  discovery = null,
  requireEngineDown = false,
  allowProbeFailure = false,
  probeIdle = probeEngineIdle,
  backupFn = createBackup,
  deleteFn = applyCompactionDelete,
  acquireLock = acquireMaintenanceLock,
  onStage = null,
} = {}) {
  if (!dbPath || !planPayload || !backupRoot) {
    return {
      ok: false,
      stage: "args",
      reason: "缺少 dbPath / planPayload / backupRoot",
      idleProbe: null,
      backup: null,
      apply: null,
    };
  }

  const lock = acquireLock(backupRoot);
  if (!lock.ok) {
    return {
      ok: false,
      stage: "lock",
      reason: lock.reason,
      idleProbe: null,
      backup: null,
      apply: null,
    };
  }

  try {
    if (requireEngineDown && discovery) {
      return {
        ok: false,
        stage: "engine-down",
        reason: "REQUIRE_ENGINE_DOWN=1 且检测到 engine discovery",
        idleProbe: null,
        backup: null,
        apply: null,
      };
    }

    let idleProbe = null;
    if (!requireEngineDown) {
      idleProbe = await probeIdle(discovery, { allowProbeFailure });
      if (!idleProbe?.ok) {
        return {
          ok: false,
          stage: "idle",
          reason: idleProbe?.detail || "idle 探测失败",
          idleProbe,
          backup: null,
          apply: null,
        };
      }
      onStage?.("idle", idleProbe);
    }

    onStage?.("before-backup", { backupRoot });
    const backup = await backupFn(dbPath, backupRoot, planPayload);
    if (!backup?.ok) {
      return {
        ok: false,
        stage: backup?.stage || "backup",
        reason: backup?.reason || backup?.integrity?.detail || "备份失败",
        idleProbe,
        backup,
        apply: null,
      };
    }
    onStage?.("backup", backup);

    onStage?.("before-delete", { planPayload, vacuum });
    const apply = deleteFn(dbPath, { vacuum });
    if (!apply?.ok) {
      return {
        ok: false,
        stage: apply?.stage || "delete",
        reason: apply?.reason || "删除失败或已 ROLLBACK",
        idleProbe,
        backup,
        apply,
      };
    }

    return {
      ok: true,
      stage: "done",
      reason: null,
      idleProbe,
      backup,
      apply,
    };
  } finally {
    try { lock.release?.(); } catch { /* ignore */ }
  }
}

export function writePlanFile(outDir, planPayload, plan) {
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, "plan.json");
  const body = { ...planPayload, plan };
  const json = JSON.stringify(body, (_key, value) => (typeof value === "bigint" ? Number(value) : value), 2);
  writeFileSync(file, json);
  const latest = join(outDir, "..", "event-db-compaction-plan-latest.json");
  try {
    writeFileSync(latest, json);
  } catch {
    /* ignore */
  }
  return file;
}

export function readPlanFile(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function latestPlanPath(wodeappxRoot) {
  return join(wodeappxRoot, "test-results", "event-db-compaction-plan-latest.json");
}

export function requireEngineDownEnabled(env = process.env) {
  return String(env.WODEAPPX_EVENT_DB_COMPACTION_REQUIRE_ENGINE_DOWN || "") === "1";
}

export function engineProcessRunning() {
  // 粗检：discovery 指向的端口是否有监听；详细 idle 由 probeEngineIdle 负责。
  return existsSync(join(homedir(), "Library", "Application Support", "com.differentai.openwork", "openwork-engine.json"));
}
