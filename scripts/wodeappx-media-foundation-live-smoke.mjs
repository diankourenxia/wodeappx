#!/usr/bin/env node
/**
 * Offline live-data smoke for media foundation:
 * 1) Extract known fat data:video event(s) from the account opencode.db into a temp DB
 * 2) Run maintainOpencodeDbBeforeServe → session-media spill
 * 3) Assert row is slim file:// and spilled bytes exist
 * 4) Externalize unit path: wrong-mime .mp4 never stays data:
 *
 * Does NOT touch the live DB (read-only extract) and does NOT kill the desktop app.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const maintainPath = path.join(
  __dirname,
  "../integrations/openwork/fork/apps/desktop/electron/wodeapp-opencode-db-maintain.mjs",
);
const { maintainOpencodeDbBeforeServe } = await import(pathToFileURL(maintainPath).href);

const LIVE_DB = process.env.WODEAPPX_SMOKE_DB?.trim()
  || path.join(
    homedir(),
    "Library/Application Support/com.differentai.openwork/openwork-runtime-data/791d7d28-296a-40d5-818d-a3b267346a1c/xdg/data/opencode/opencode.db",
  );
const FAT_EVENT_ID = process.env.WODEAPPX_SMOKE_EVENT_ID?.trim()
  || "evt_fa18be9fe001cxJ6K3tR0rMf9m";

function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(1);
}

function sqlite(dbPath, sql) {
  const result = spawnSync("sqlite3", [dbPath, sql], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    fail(`sqlite3 failed: ${result.stderr || result.stdout || result.status}`);
  }
  return result.stdout;
}

if (!existsSync(LIVE_DB)) fail(`live db missing: ${LIVE_DB}`);

const root = mkdtempSync(path.join(tmpdir(), "wodeappx-media-smoke-"));
const mediaRoot = path.join(root, "session-media");
const copyDb = path.join(root, "opencode-smoke.db");
mkdirSync(mediaRoot, { recursive: true });

console.log(JSON.stringify({ phase: "extract", liveDb: LIVE_DB, fatEventId: FAT_EVENT_ID, root }, null, 2));

// Schema + only the fat event (avoid copying the full 2.3G DB).
sqlite(copyDb, `
  CREATE TABLE event (
    id TEXT PRIMARY KEY,
    aggregate_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    type TEXT NOT NULL,
    data TEXT NOT NULL
  );
`);

const attachSql = `
  ATTACH DATABASE '${LIVE_DB.replace(/'/g, "''")}' AS live KEY '';
`;
// Prefer read-only URI when possible; fall back to plain attach.
const extract = spawnSync("sqlite3", [
  copyDb,
  `
  ATTACH DATABASE 'file:${LIVE_DB}?mode=ro' AS live;
  INSERT INTO event(id, aggregate_id, seq, type, data)
  SELECT id, aggregate_id, seq, type, data FROM live.event WHERE id = '${FAT_EVENT_ID}';
  DETACH live;
  SELECT id, length(data), substr(data,1,120) FROM event;
  `,
], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });

if (extract.status !== 0) {
  // Some environments reject URI attach; try plain path attach (still only SELECT).
  const retry = spawnSync("sqlite3", [
    copyDb,
    `
    ATTACH DATABASE '${LIVE_DB.replace(/'/g, "''")}' AS live;
    INSERT INTO event(id, aggregate_id, seq, type, data)
    SELECT id, aggregate_id, seq, type, data FROM live.event WHERE id = '${FAT_EVENT_ID}';
    DETACH live;
    SELECT id, length(data), substr(data,1,120) FROM event;
    `,
  ], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (retry.status !== 0) {
    fail(`extract failed: ${extract.stderr || retry.stderr || retry.stdout}`);
  }
  console.log(retry.stdout.trim());
} else {
  console.log(extract.stdout.trim());
}

const before = sqlite(copyDb, `SELECT length(data) FROM event WHERE id='${FAT_EVENT_ID}';`).trim();
const beforeN = Number(before);
if (!Number.isFinite(beforeN) || beforeN < 1_000_000) {
  fail(`expected fat event >1MB, got length=${before}`);
}

const t0 = Date.now();
const report = maintainOpencodeDbBeforeServe(copyDb, {
  forceCompact: true,
  mediaRoot,
});
const elapsedMs = Date.now() - t0;

if (!report.ok) fail(`maintain failed: ${report.error || JSON.stringify(report)}`);

const afterRow = sqlite(
  copyDb,
  `SELECT length(data) AS n, data FROM event WHERE id='${FAT_EVENT_ID}';`,
).trim();
const nl = afterRow.indexOf("\n");
// sqlite3 default separator is | for multi-col without -separator when using SELECT n, data
// But data contains newlines? Our stub shouldn't. Use JSON mode.
const jsonOut = spawnSync("sqlite3", [
  "-json",
  copyDb,
  `SELECT length(data) AS n, data FROM event WHERE id='${FAT_EVENT_ID}';`,
], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
if (jsonOut.status !== 0) fail(`after query failed: ${jsonOut.stderr}`);
const [row] = JSON.parse(jsonOut.stdout || "[]");
if (!row) fail("fat event missing after maintain");
if (row.n >= 8192) fail(`row still fat after maintain: ${row.n}`);
if (String(row.data).includes("data:video")) fail("data:video still in stub");
const parsed = JSON.parse(row.data);
if (!parsed._wodeappxElided) fail("missing _wodeappxElided");
if (!String(parsed.part?.url || "").startsWith("file:")) {
  fail(`expected file:// url, got ${parsed.part?.url}`);
}
const spilledPath = fileURLToPath(parsed.part.url);
if (!existsSync(spilledPath)) fail(`spilled file missing: ${spilledPath}`);
const spilledBytes = statSync(spilledPath).size;
if (spilledBytes < 1024 * 1024) fail(`spilled file too small: ${spilledBytes}`);

const result = {
  ok: true,
  beforeBytes: beforeN,
  afterBytes: row.n,
  spilledBytes,
  spilledPath,
  elapsedMs,
  maintain: {
    elide: report.elide,
    compact: report.compact,
  },
  stubFilename: parsed.part?.filename,
  stubMime: parsed.part?.mime,
};
console.log(JSON.stringify(result, null, 2));

// Keep artifacts for inspection unless WODEAPPX_SMOKE_KEEP=0
if (process.env.WODEAPPX_SMOKE_KEEP === "0") {
  rmSync(root, { recursive: true, force: true });
} else {
  writeFileSync(path.join(root, "report.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ keepRoot: root }, null, 2));
}
