import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Must match `scripts/wodeappx-event-db-compaction-dryrun.mjs`. */
export const COMPACTION_TYPE_FILTER =
  "(type LIKE 'message.updated.%' OR type LIKE 'message.part.updated.%')";
export const COMPACTION_ENTITY_SQL = `CASE
  WHEN type LIKE 'message.updated.%' AND json_valid(data) THEN json_extract(data, '$.info.id')
  WHEN type LIKE 'message.part.updated.%' AND json_valid(data) THEN json_extract(data, '$.part.id')
END`;
export const COMPACTION_DELETE_SQL = `DELETE FROM event WHERE rowid IN (
  WITH base AS (
    SELECT rowid AS rid, aggregate_id, type, ${COMPACTION_ENTITY_SQL} AS entity
    FROM event
    WHERE ${COMPACTION_TYPE_FILTER}
  ), ranked AS (
    SELECT rid, MAX(rid) OVER (PARTITION BY aggregate_id, type, entity) AS keep_rid
    FROM base
    WHERE entity IS NOT NULL
  )
  SELECT rid FROM ranked WHERE rid <> keep_rid
)`;

export const ELIDE_HARD_BYTES = 2 * 1024 * 1024;
export const ELIDE_DATA_URL_BYTES = 256 * 1024;
export const COMPACT_MIN_EVENT_ROWS = 40_000;
export const COMPACT_STAMP_TTL_MS = 24 * 60 * 60 * 1000;
const SUBSTR_CHUNK = 512 * 1024;

function openDb(dbPath, { queryOnly = false } = {}) {
  const { DatabaseSync } = require("node:sqlite");
  const database = new DatabaseSync(dbPath);
  database.exec("PRAGMA busy_timeout = 8000");
  if (queryOnly) database.exec("PRAGMA query_only = ON");
  return database;
}

function tableExists(database, name) {
  const row = database.prepare(
    "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
  ).get(name);
  return Boolean(row?.ok);
}

function pick(head, re, fallback = "") {
  const match = re.exec(head);
  return match?.[1] ? String(match[1]) : fallback;
}

function mimeToExt(mime, filename) {
  const fromName = filename && path.extname(filename).replace(/^\./, "");
  if (fromName && /^[a-z0-9]{1,8}$/i.test(fromName)) return fromName.toLowerCase();
  const lower = String(mime || "").toLowerCase();
  if (lower.includes("mp4")) return "mp4";
  if (lower.includes("webm")) return "webm";
  if (lower.includes("quicktime") || lower.includes("mov")) return "mov";
  if (lower.includes("wav")) return "wav";
  if (lower.includes("mpeg") || lower.includes("mp3")) return "mp3";
  if (lower.includes("pdf")) return "pdf";
  if (lower.includes("png")) return "png";
  if (lower.includes("jpeg") || lower.includes("jpg")) return "jpg";
  if (lower.includes("webp")) return "webp";
  return "bin";
}

export function defaultSessionMediaRoot() {
  const override = process.env.WODEAPPX_SESSION_MEDIA_ROOT?.trim();
  if (override) return path.resolve(override);
  return path.join(homedir(), ".wodeappx", "session-media");
}

function safeSessionDir(sessionID) {
  const readable = String(sessionID || "session").replace(/[^a-z0-9._-]+/gi, "_").slice(0, 72) || "session";
  return readable;
}

export function stubEventPayload(head, nbytes, type, localUrl = "") {
  const sessionID = pick(head, /"sessionID":"([^"]+)"/);
  const partId = pick(head, /"part":\{"id":"([^"]+)"/);
  const mime = pick(head, /"mime":"([^"]+)"/, "application/octet-stream");
  const filename = pick(head, /"filename":"([^"]+)"/, "elided.bin");
  const infoId = pick(head, /"info":\{"id":"([^"]+)"/);
  return JSON.stringify({
    sessionID,
    _wodeappxElided: true,
    originalBytes: nbytes,
    originalType: type || "",
    ...(infoId ? { info: { id: infoId, sessionID } } : {}),
    ...(partId
      ? {
          part: {
            id: partId,
            sessionID,
            type: "file",
            mime,
            filename,
            url: localUrl,
          },
        }
      : {}),
  });
}

export function stubRowPayload(head, nbytes, _type, localUrl = "") {
  const type = pick(head, /"type":"([^"]+)"/, "file");
  const mime = pick(head, /"mime":"([^"]+)"/, "application/octet-stream");
  const filename = pick(head, /"filename":"([^"]+)"/, "elided.bin");
  const tool = pick(head, /"tool":"([^"]+)"/);
  if ((type === "tool" || tool) && !localUrl) {
    return JSON.stringify({
      type: "tool",
      tool: tool || "unknown",
      _wodeappxElided: true,
      originalBytes: nbytes,
      state: { status: "completed", output: "[elided oversized tool payload]" },
    });
  }
  return JSON.stringify({
    type: type === "tool" ? "file" : type,
    mime,
    filename,
    url: localUrl,
    _wodeappxElided: true,
    originalBytes: nbytes,
  });
}

/**
 * message.data is OpenCode message info (must keep `role`). Never replace it with a
 * bare file stub — that makes OpenWork hydrate fail with
 * "Local engine returned invalid session messages" (info.role undefined).
 */
export function stubMessagePayload(head, nbytes, _type, localUrl = "") {
  const role = pick(head, /"role":"(user|assistant|system)"/, "user");
  const agent = pick(head, /"agent":"([^"]+)"/);
  const mode = pick(head, /"mode":"([^"]+)"/);
  const modelID = pick(head, /"modelID":"([^"]+)"/);
  const providerID = pick(head, /"providerID":"([^"]+)"/);
  const parentID = pick(head, /"parentID":"([^"]+)"/);
  const mime = pick(head, /"mime":"([^"]+)"/, "application/octet-stream");
  const filename = pick(head, /"filename":"([^"]+)"/, "elided.bin");
  const stub = {
    role,
    _wodeappxElided: true,
    originalBytes: nbytes,
    ...(agent ? { agent } : {}),
    ...(mode ? { mode } : {}),
    ...(modelID ? { modelID } : {}),
    ...(providerID ? { providerID } : {}),
    ...(parentID ? { parentID } : {}),
    ...(localUrl
      ? {
          elidedAttachment: {
            type: "file",
            mime,
            filename,
            url: localUrl,
          },
        }
      : {}),
  };
  return JSON.stringify(stub);
}

function stampPath(dbPath) {
  return `${dbPath}.wodeappx-maintain.json`;
}

function readStamp(dbPath) {
  const file = stampPath(dbPath);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeStamp(dbPath, report) {
  writeFileSync(stampPath(dbPath), JSON.stringify({
    at: new Date().toISOString(),
    ...report,
  }), "utf8");
}

/**
 * Stream `data:<mime>;base64,...` out of a SQLite TEXT column in 512KiB substr
 * chunks so V8 never holds the full JSON (the 178MB meeting-video case).
 * Finds A/V payloads even when buried deep inside message.updated JSON.
 */
export function spillDataUrlFromColumn(database, table, id, nbytes, destPath) {
  const markers = [
    "data:video/",
    "data:audio/",
    "data:application/pdf",
    "data:application/octet-stream;base64,",
  ];
  let payloadStart = 0;
  let mime = "application/octet-stream";
  const chunkStmt = database.prepare(`SELECT substr(data, ?, ?) AS c FROM ${table} WHERE id = ?`);
  const instrStmt = database.prepare(`SELECT instr(data, ?) AS pos FROM ${table} WHERE id = ?`);

  for (const marker of markers) {
    const pos = Number(instrStmt.get(marker, id)?.pos) || 0;
    if (pos <= 0) continue;
    const window = String(chunkStmt.get(pos, 256, id)?.c || "");
    const match = /data:([^;,]+);base64,/.exec(window);
    if (!match || match.index !== 0) continue;
    payloadStart = pos + match[0].length; // 1-indexed first base64 char
    mime = match[1] || mime;
    break;
  }

  if (!payloadStart) {
    const head = String(chunkStmt.get(1, 8192, id)?.c || "");
    const match = /data:([^;,]+);base64,/.exec(head);
    if (!match) return { ok: false, reason: "no-data-url" };
    payloadStart = match.index + match[0].length + 1;
    mime = match[1] || mime;
  }

  const tmp = `${destPath}.tmp`;
  mkdirSync(path.dirname(destPath), { recursive: true, mode: 0o700 });
  const fd = openSync(tmp, "w", 0o600);
  let sqlitePos = payloadStart;
  let leftover = "";
  let written = 0;
  try {
    while (sqlitePos <= nbytes) {
      const take = Math.min(SUBSTR_CHUNK, nbytes - sqlitePos + 1);
      if (take <= 0) break;
      const piece = String(chunkStmt.get(sqlitePos, take, id)?.c || "");
      sqlitePos += take;
      let text = leftover + piece;
      leftover = "";
      const quote = text.indexOf('"');
      if (quote >= 0) text = text.slice(0, quote);
      if (quote < 0) {
        const keep = text.length % 4;
        leftover = text.slice(text.length - keep);
        text = text.slice(0, text.length - keep);
      }
      if (text) {
        const buf = Buffer.from(text, "base64");
        writeSync(fd, buf);
        written += buf.byteLength;
      }
      if (quote >= 0) break;
    }
    if (leftover) {
      const buf = Buffer.from(leftover, "base64");
      writeSync(fd, buf);
      written += buf.byteLength;
    }
  } finally {
    closeSync(fd);
  }
  if (written <= 0) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    return { ok: false, reason: "empty", bytes: 0 };
  }
  renameSync(tmp, destPath);
  try { chmodSync(destPath, 0o600); } catch { /* ignore */ }
  return { ok: true, bytes: written, mime };
}

function localMediaPath(mediaRoot, sessionID, rowId, mime, filename) {
  const ext = mimeToExt(mime, filename);
  const dir = path.join(mediaRoot, safeSessionDir(sessionID));
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return path.join(dir, `${String(rowId).replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80)}.${ext}`);
}

function elideTable(database, table, mediaRoot, buildStub) {
  if (!tableExists(database, table)) return { table, scanned: 0, elided: 0, spilled: 0 };
  const typeSelect = table === "event" ? ", type" : "";
  const rows = database.prepare(`
    SELECT id${typeSelect}, length(data) AS nbytes, substr(data, 1, 4096) AS head
    FROM ${table}
    WHERE length(data) > ?
       OR (length(data) > ? AND substr(data, 1, 4096) LIKE '%data:%')
       OR substr(data, 1, 4096) LIKE '%data:video/%'
       OR substr(data, 1, 4096) LIKE '%data:audio/%'
       OR instr(data, 'data:video/') > 0
       OR instr(data, 'data:audio/') > 0
  `).all(ELIDE_HARD_BYTES, ELIDE_DATA_URL_BYTES);
  let elided = 0;
  let spilled = 0;
  const update = database.prepare(`UPDATE ${table} SET data = ? WHERE id = ?`);
  const hasAvInstr = database.prepare(
    `SELECT CASE WHEN instr(data,'data:video/')>0 OR instr(data,'data:audio/')>0 THEN 1 ELSE 0 END AS ok FROM ${table} WHERE id = ?`,
  );
  database.exec("BEGIN");
  try {
    for (const row of rows) {
      const nbytes = Number(row.nbytes) || 0;
      const head = String(row.head || "");
      const sessionID = pick(head, /"sessionID":"([^"]+)"/, "session");
      let mime = pick(head, /"mime":"([^"]+)"/, "application/octet-stream");
      let filename = pick(head, /"filename":"([^"]+)"/, "elided.bin");
      let localUrl = "";
      const deepAv = Number(hasAvInstr.get(row.id)?.ok) === 1;
      if (/data:[^"]*;base64,/i.test(head) || deepAv) {
        if (deepAv && !/video\/|audio\//i.test(mime)) {
          // Prefer extension from buried payload when head only has message.info.
          filename = filename === "elided.bin" ? "buried-media.bin" : filename;
        }
        const dest = localMediaPath(mediaRoot, sessionID, row.id, mime, filename);
        const spilledFile = spillDataUrlFromColumn(database, table, row.id, nbytes, dest);
        if (spilledFile.ok) {
          localUrl = pathToFileURL(dest).href;
          if (spilledFile.mime) mime = spilledFile.mime;
          spilled += 1;
        }
      }
      const next = buildStub(head, nbytes, row.type, localUrl);
      update.run(next, row.id);
      elided += 1;
    }
    database.exec("COMMIT");
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* ignore */ }
    throw error;
  }
  return { table, scanned: rows.length, elided, spilled };
}

function maybeCompactEvents(database, { force = false, stamp } = {}) {
  if (!tableExists(database, "event")) {
    return { skipped: true, reason: "no-event-table", deleted: 0 };
  }
  const countRow = database.prepare(
    `SELECT COUNT(*) AS n FROM event WHERE ${COMPACTION_TYPE_FILTER}`,
  ).get();
  const n = Number(countRow?.n) || 0;
  if (n < COMPACT_MIN_EVENT_ROWS) {
    return { skipped: true, reason: "below-threshold", eventRows: n, deleted: 0 };
  }
  const stampAt = stamp?.compactAt ? Date.parse(stamp.compactAt) : 0;
  if (!force && Number.isFinite(stampAt) && Date.now() - stampAt < COMPACT_STAMP_TTL_MS) {
    return { skipped: true, reason: "stamp-fresh", eventRows: n, deleted: 0 };
  }
  const before = database.prepare("SELECT COUNT(*) AS n FROM event").get();
  database.exec("BEGIN");
  try {
    database.exec(COMPACTION_DELETE_SQL);
    database.exec("COMMIT");
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch { /* ignore */ }
    throw error;
  }
  const after = database.prepare("SELECT COUNT(*) AS n FROM event").get();
  return {
    skipped: false,
    eventRows: n,
    deleted: Math.max(0, (Number(before?.n) || 0) - (Number(after?.n) || 0)),
  };
}

/**
 * Pre-serve maintenance: spill oversized data: URLs to ~/.wodeappx/session-media
 * (file://, not session-artifacts), then compact duplicate snapshots.
 * Never VACUUM.
 */
export function maintainOpencodeDbBeforeServe(dbPath, options = {}) {
  const report = {
    ok: true,
    skipped: false,
    elide: [],
    compact: { skipped: true, deleted: 0 },
  };
  if (!dbPath || !existsSync(dbPath)) {
    return { ...report, skipped: true, reason: "missing" };
  }
  if (options.disabled === true || process.env.WODEAPPX_EVENT_DB_MAINTAIN === "0") {
    return { ...report, skipped: true, reason: "disabled" };
  }

  const mediaRoot = options.mediaRoot || defaultSessionMediaRoot();
  const database = openDb(dbPath);
  try {
    const hasType = tableExists(database, "event")
      && database.prepare("PRAGMA table_info(event)").all().some((col) => col.name === "type");
    report.elide.push(elideTable(
      database,
      "event",
      mediaRoot,
      (head, nbytes, type, localUrl) => stubEventPayload(head, nbytes, hasType ? type : "", localUrl),
    ));
    report.elide.push(elideTable(
      database,
      "part",
      mediaRoot,
      (head, nbytes, type, localUrl) => stubRowPayload(head, nbytes, type, localUrl),
    ));
    report.elide.push(elideTable(
      database,
      "message",
      mediaRoot,
      (head, nbytes, type, localUrl) => stubMessagePayload(head, nbytes, type, localUrl),
    ));
    report.compact = maybeCompactEvents(database, {
      force: options.forceCompact === true,
      stamp: readStamp(dbPath),
    });
    writeStamp(dbPath, {
      elide: report.elide,
      compactAt: report.compact.skipped ? readStamp(dbPath)?.compactAt : new Date().toISOString(),
      compact: report.compact,
    });
    return report;
  } catch (error) {
    return {
      ...report,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try { database.close(); } catch { /* ignore */ }
  }
}
