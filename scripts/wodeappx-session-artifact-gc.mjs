#!/usr/bin/env node
/**
 * Safe, offline cleanup for WodeAppX session artifacts.
 *
 * The command is intentionally dry-run by default.  Destructive cleanup
 * requires --apply --idle-confirmed and a complete event-reference scan.
 * This keeps normal desktop sessions independent from maintenance work.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
  openSync,
  closeSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ARTIFACT_GC_DEFAULTS = Object.freeze({
  minAgeMs: 30 * 24 * 60 * 60 * 1000,
  tempAgeMs: 24 * 60 * 60 * 1000,
  maxDepth: 8,
  /** Soft cap per session directory; overage deletes oldest unreferenced first (never referenced). */
  sessionMaxBytes: 512 * 1024 * 1024,
});

function defaultArtifactRoot() {
  const media = process.env.WODEAPPX_SESSION_MEDIA_ROOT?.trim();
  if (media) return resolve(media);
  const legacy = process.env.WODEAPPX_SESSION_ARTIFACTS_ROOT?.trim();
  if (legacy) return resolve(legacy);
  return resolve(join(homedir(), ".wodeappx", "session-media"));
}

function isPathInsideRoot(filePath, rootDir) {
  const file = resolve(filePath);
  const root = resolve(rootDir);
  return file === root || file.startsWith(`${root}/`) || file.startsWith(`${root}\\`);
}

function isRegularFile(filePath) {
  try {
    return lstatSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(dirPath) {
  try {
    return lstatSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function decodeFileUrl(value) {
  if (!value.startsWith("file://")) return null;
  try {
    return fileURLToPath(value);
  } catch {
    return null;
  }
}

export function normalizeArtifactPath(value, rootDir = defaultArtifactRoot()) {
  if (typeof value !== "string" || value.length === 0) return null;
  const root = resolve(rootDir);
  const filePath = decodeFileUrl(value) || value;
  for (const prefix of ["session-media/", "session-artifacts/"]) {
    if (filePath.startsWith(prefix)) {
      const candidate = resolve(join(root, filePath.slice(prefix.length)));
      return isPathInsideRoot(candidate, root) ? candidate : null;
    }
  }
  for (const folder of ["session-media", "session-artifacts"]) {
    const marker = `${join(".wodeappx", folder)}${process.platform === "win32" ? "\\" : "/"}`;
    const markerIndex = filePath.indexOf(marker);
    if (markerIndex >= 0) {
      const candidate = resolve(join(root, filePath.slice(markerIndex + marker.length)));
      return isPathInsideRoot(candidate, root) ? candidate : null;
    }
  }
  if (isPathInsideRoot(filePath, root)) return resolve(filePath);
  return null;
}

function artifactPathsFromText(text, rootDir) {
  const values = new Set();
  const candidates = [
    ...(String(text).match(/file:\/\/[^\s"'\\]+/g) || []),
    ...(String(text).match(/session-media\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+/g) || []),
    ...(String(text).match(/session-artifacts\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+/g) || []),
  ];
  for (const candidate of candidates) {
    const normalized = normalizeArtifactPath(candidate, rootDir);
    if (normalized) values.add(normalized);
  }
  return values;
}

export function collectReferencedArtifactPaths(rows, rootDir = defaultArtifactRoot()) {
  const referenced = new Set();
  for (const row of rows || []) {
    for (const path of artifactPathsFromText(row, rootDir)) referenced.add(path);
  }
  return referenced;
}

export function listArtifactFiles(rootDir = defaultArtifactRoot()) {
  const root = resolve(rootDir);
  if (!isDirectory(root)) return [];
  const result = [];
  for (const sessionName of readdirSync(root)) {
    const sessionDir = join(root, sessionName);
    if (!isDirectory(sessionDir)) continue;
    for (const name of readdirSync(sessionDir)) {
      const filePath = join(sessionDir, name);
      if (isRegularFile(filePath)) result.push(filePath);
    }
  }
  return result;
}

export function planArtifactGc({
  rootDir = defaultArtifactRoot(),
  referencedPaths = new Set(),
  referencesComplete = false,
  now = Date.now(),
  minAgeMs = ARTIFACT_GC_DEFAULTS.minAgeMs,
  tempAgeMs = ARTIFACT_GC_DEFAULTS.tempAgeMs,
  sessionMaxBytes = ARTIFACT_GC_DEFAULTS.sessionMaxBytes,
} = {}) {
  const root = resolve(rootDir);
  const referenced = new Set([...referencedPaths].map((path) => resolve(path)));
  const byPath = new Map();
  const sessionBytes = new Map();
  let totalBytes = 0;
  let totalFiles = 0;

  for (const filePath of listArtifactFiles(root)) {
    const resolvedPath = resolve(filePath);
    const stat = lstatSync(resolvedPath);
    const ageMs = Math.max(0, now - stat.mtimeMs);
    const isTemp = basename(resolvedPath).startsWith(".tmp-");
    const unreferenced = referencesComplete && !referenced.has(resolvedPath);
    const sessionDir = resolve(join(resolvedPath, ".."));
    totalFiles += 1;
    totalBytes += stat.size;
    sessionBytes.set(sessionDir, (sessionBytes.get(sessionDir) || 0) + stat.size);

    const entry = {
      path: resolvedPath,
      relativePath: relative(root, resolvedPath),
      sessionDir,
      bytes: stat.size,
      ageMs,
      mtimeMs: stat.mtimeMs,
      isTemp,
      unreferenced,
    };

    if (isTemp && ageMs >= tempAgeMs) {
      byPath.set(resolvedPath, { ...entry, reason: "stale-temp" });
    } else if (!isTemp && unreferenced && ageMs >= minAgeMs) {
      byPath.set(resolvedPath, { ...entry, reason: "unreferenced" });
    }
  }

  // Session quota: only when reference scan is complete. Never delete referenced files.
  // Oldest unreferenced first (may be younger than TTL) until under soft cap.
  if (referencesComplete && sessionMaxBytes > 0) {
    const filesBySession = new Map();
    for (const filePath of listArtifactFiles(root)) {
      const resolvedPath = resolve(filePath);
      const sessionDir = resolve(join(resolvedPath, ".."));
      if (!filesBySession.has(sessionDir)) filesBySession.set(sessionDir, []);
      const stat = lstatSync(resolvedPath);
      filesBySession.get(sessionDir).push({
        path: resolvedPath,
        relativePath: relative(root, resolvedPath),
        sessionDir,
        bytes: stat.size,
        ageMs: Math.max(0, now - stat.mtimeMs),
        mtimeMs: stat.mtimeMs,
        isTemp: basename(resolvedPath).startsWith(".tmp-"),
        unreferenced: !referenced.has(resolvedPath),
      });
    }

    for (const [sessionDir, files] of filesBySession) {
      let remaining = sessionBytes.get(sessionDir) || 0;
      for (const planned of byPath.values()) {
        if (planned.sessionDir === sessionDir) remaining -= planned.bytes;
      }
      if (remaining <= sessionMaxBytes) continue;

      const reclaimable = files
        .filter((file) => file.unreferenced && !byPath.has(file.path))
        .sort((a, b) => a.mtimeMs - b.mtimeMs || a.path.localeCompare(b.path));
      for (const file of reclaimable) {
        if (remaining <= sessionMaxBytes) break;
        byPath.set(file.path, { ...file, reason: "session-quota" });
        remaining -= file.bytes;
      }
    }
  }

  const candidates = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
  return {
    rootDir: root,
    referencesComplete,
    sessionMaxBytes,
    totalFiles,
    totalBytes,
    candidateFiles: candidates.length,
    candidateBytes: candidates.reduce((sum, item) => sum + item.bytes, 0),
    sessionsOverQuota: [...sessionBytes.entries()]
      .filter(([, bytes]) => sessionMaxBytes > 0 && bytes > sessionMaxBytes)
      .map(([sessionDir, bytes]) => ({
        sessionDir,
        bytes,
        overBytes: bytes - sessionMaxBytes,
      })),
    candidates,
  };
}

export function applyArtifactGc(plan) {
  const removed = [];
  for (const candidate of plan.candidates || []) {
    if (!isPathInsideRoot(candidate.path, plan.rootDir) || !isRegularFile(candidate.path)) continue;
    unlinkSync(candidate.path);
    removed.push(candidate);
  }
  return removed;
}

function walkForDatabases(root, maxDepth, depth = 0, result = []) {
  if (depth > maxDepth || !isDirectory(root)) return result;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const candidate = join(root, entry.name);
    if (entry.isFile() && entry.name === "opencode.db") result.push(candidate);
    else if (entry.isDirectory()) walkForDatabases(candidate, maxDepth, depth + 1, result);
  }
  return result;
}

export function discoverEventDatabases({ roots, maxDepth = ARTIFACT_GC_DEFAULTS.maxDepth } = {}) {
  const defaultRoots = [
    join(homedir(), "Library", "Application Support", "com.differentai.openwork"),
    join(homedir(), ".openwork"),
  ];
  const found = new Set();
  for (const root of roots?.length ? roots : defaultRoots) {
    for (const dbPath of walkForDatabases(resolve(root), maxDepth)) found.add(resolve(dbPath));
  }
  return [...found];
}

export function readEventReferenceRows(dbPath) {
  const sql = "SELECT replace(replace(data, char(10), ' '), char(13), ' ') FROM event WHERE data LIKE '%session-media%' OR data LIKE '%session-artifacts%' OR data LIKE '%/.wodeappx/session-media/%' OR data LIKE '%/.wodeappx/session-artifacts/%';";
  // immutable keeps the scan read-only while allowing SQLite WAL databases
  // and compaction backups to be inspected without creating sidecar files.
  const immutableUri = `file:${dbPath}?immutable=1`;
  const result = spawnSync("sqlite3", ["-batch", "-noheader", immutableUri, sql], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    return { ok: false, rows: [], error: result.error?.message || result.stderr?.trim() || `sqlite3 exited ${result.status}` };
  }
  return { ok: true, rows: result.stdout.split("\n").filter(Boolean) };
}

export function scanEventReferences(dbPaths, rootDir = defaultArtifactRoot()) {
  const rows = [];
  const errors = [];
  for (const dbPath of dbPaths) {
    const result = readEventReferenceRows(dbPath);
    if (!result.ok) errors.push({ dbPath, error: result.error });
    rows.push(...result.rows);
  }
  return {
    databases: dbPaths,
    referencesComplete: errors.length === 0 && dbPaths.length > 0,
    referencedPaths: collectReferencedArtifactPaths(rows, rootDir),
    errors,
  };
}

function acquireLock(rootDir) {
  mkdirSync(rootDir, { recursive: true, mode: 0o700 });
  const lockPath = join(rootDir, ".gc.lock");
  const fd = openSync(lockPath, "wx", 0o600);
  writeFileSync(fd, `${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
  closeSync(fd);
  return () => {
    try { unlinkSync(lockPath); } catch { /* already gone */ }
  };
}

function parseArgs(argv) {
  const options = { dbPaths: [], apply: false, idleConfirmed: false, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") options.rootDir = argv[++index];
    else if (arg === "--db") options.dbPaths.push(argv[++index]);
    else if (arg === "--min-age-days") options.minAgeMs = Number(argv[++index]) * 24 * 60 * 60 * 1000;
    else if (arg === "--temp-age-hours") options.tempAgeMs = Number(argv[++index]) * 60 * 60 * 1000;
    else if (arg === "--session-max-mib") options.sessionMaxBytes = Number(argv[++index]) * 1024 * 1024;
    else if (arg === "--apply") options.apply = true;
    else if (arg === "--idle-confirmed") options.idleConfirmed = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/wodeappx-session-artifact-gc.mjs [options]

Default is a read-only dry-run. Destructive mode requires --apply --idle-confirmed.

  --root <dir>             media root (default ~/.wodeappx/session-media)
  --db <path>              event DB to scan; may be repeated
  --min-age-days <n>       unreferenced artifact age (default 30)
  --temp-age-hours <n>     stale .tmp age (default 24)
  --session-max-mib <n>    soft cap per session dir (default 512); overage drops oldest unreferenced
  --apply --idle-confirmed delete only safely identified candidates
  --json                   machine-readable output`);
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    printHelp();
    return 0;
  }
  const rootDir = resolve(options.rootDir || defaultArtifactRoot());
  const dbPaths = options.dbPaths.length ? options.dbPaths.map(resolve) : discoverEventDatabases();
  const scan = scanEventReferences(dbPaths, rootDir);
  const plan = planArtifactGc({
    rootDir,
    referencedPaths: scan.referencedPaths,
    referencesComplete: scan.referencesComplete,
    minAgeMs: options.minAgeMs,
    tempAgeMs: options.tempAgeMs,
    sessionMaxBytes: options.sessionMaxBytes,
  });
  const output = { ...plan, databases: scan.databases, referenceCount: scan.referencedPaths.size, errors: scan.errors, applied: false };

  if (options.apply) {
    if (!options.idleConfirmed) throw new Error("--apply requires --idle-confirmed; close/idle the desktop first");
    if (!scan.referencesComplete) throw new Error("refusing destructive GC because event-reference scan is incomplete");
    const release = acquireLock(rootDir);
    try {
      const removed = applyArtifactGc(plan);
      output.applied = true;
      output.removedFiles = removed.length;
      output.removedBytes = removed.reduce((sum, item) => sum + item.bytes, 0);
    } finally {
      release();
    }
  }

  if (options.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log(`[artifact-gc] root ${rootDir}`);
    console.log(`[artifact-gc] scanned ${dbPaths.length} event DB(s), ${scan.referencedPaths.size} referenced artifact(s)`);
    console.log(`[artifact-gc] sessionMaxBytes=${plan.sessionMaxBytes} sessionsOverQuota=${plan.sessionsOverQuota?.length || 0}`);
    console.log(`[artifact-gc] candidates ${plan.candidateFiles} file(s) / ${plan.candidateBytes} bytes`);
    if (output.applied) console.log(`[artifact-gc] removed ${output.removedFiles} file(s) / ${output.removedBytes} bytes`);
    else console.log("[artifact-gc] dry-run only; pass --apply --idle-confirmed after verifying the report");
    for (const error of scan.errors) console.warn(`[artifact-gc] reference scan failed: ${error.dbPath}: ${error.error}`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[artifact-gc] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
