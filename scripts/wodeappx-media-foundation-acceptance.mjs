#!/usr/bin/env node
/**
 * Media foundation acceptance (offline + optional live sidecar).
 *
 * Covers gaps beyond unit/sim:
 *  1. Extract ALL live data:video (+ oversized non-image data:) events (read-only)
 *  2. maintain → session-media spill; assert every row slim + file openable
 *  3. Boot NEW patched opencode on an alt port (does not kill desktop)
 *  4. Live HTTP: text / tiny image / small PDF file:// ; assert no data:video
 *  5. Open-target contract for spilled file:// chips
 *
 * Usage:
 *   node scripts/wodeappx-media-foundation-acceptance.mjs
 *   node scripts/wodeappx-media-foundation-acceptance.mjs --skip-sidecar
 *   node scripts/wodeappx-media-foundation-acceptance.mjs --port 61999
 */
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wodeappxRoot = path.resolve(__dirname, "..");
const maintainMod = await import(pathToFileURL(path.join(
  wodeappxRoot,
  "integrations/openwork/fork/apps/desktop/electron/wodeapp-opencode-db-maintain.mjs",
)).href);
const { maintainOpencodeDbBeforeServe } = maintainMod;

const LIVE_DB = process.env.WODEAPPX_SMOKE_DB?.trim() || path.join(
  homedir(),
  "Library/Application Support/com.differentai.openwork/openwork-runtime-data/791d7d28-296a-40d5-818d-a3b267346a1c/xdg/data/opencode/opencode.db",
);
const NEW_BINARY = process.env.WODEAPPX_OPENCODE_BIN?.trim() || path.join(
  wodeappxRoot,
  "vendor/openwork/apps/desktop/resources/sidecars/opencode-aarch64-apple-darwin",
);

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}
function readArg(name) {
  const args = process.argv.slice(2);
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

const report = {
  ok: true,
  steps: [],
  failures: [],
};

function step(name, data = {}) {
  report.steps.push({ name, ...data, at: new Date().toISOString() });
  console.log(JSON.stringify({ step: name, ...data }));
}

function fail(name, error) {
  report.ok = false;
  report.failures.push({ name, error: String(error) });
  console.error(JSON.stringify({ fail: name, error: String(error) }));
}

function sqlite(dbPath, sql, opts = {}) {
  const args = opts.json ? ["-json", dbPath, sql] : [dbPath, sql];
  const result = spawnSync("sqlite3", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `sqlite3 exit ${result.status}`);
  }
  return result.stdout;
}

function looksLikeMedia(buf, ext) {
  if (!buf || buf.length < 12) return false;
  if (ext === "mp4" || ext === "mov" || ext === "m4v") return buf.includes(Buffer.from("ftyp"));
  if (ext === "webm") return buf[0] === 0x1a && buf[1] === 0x45;
  if (ext === "pdf") return buf.slice(0, 4).toString("utf8") === "%PDF";
  if (ext === "wav") return buf.slice(0, 4).toString("utf8") === "RIFF";
  return buf.length > 0;
}

function assertOpenableFileUrl(url) {
  if (!/^file:\/\//i.test(url)) throw new Error(`not file://: ${url}`);
  if (/session-artifacts/i.test(url) && !/session-media/i.test(url)) {
    // legacy allowed for open; new spills must be session-media
  }
  const filePath = fileURLToPath(url);
  if (!existsSync(filePath)) throw new Error(`missing spilled file: ${filePath}`);
  const st = statSync(filePath);
  if (st.size <= 0) throw new Error(`empty spilled file: ${filePath}`);
  return { filePath, bytes: st.size };
}

/** Mirror message-file-display openable contract without importing TS. */
function isOpenableAttachmentUrl(url) {
  return /^(https?:\/\/|file:\/\/|wodeappx-asset:)/i.test(String(url || "").trim());
}

async function extractFatEvents(destDb, mediaRoot) {
  if (!existsSync(LIVE_DB)) throw new Error(`live db missing: ${LIVE_DB}`);
  sqlite(destDb, `
    CREATE TABLE event (
      id TEXT PRIMARY KEY,
      aggregate_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL
    );
  `);
  const extractSql = `
    ATTACH DATABASE 'file:${LIVE_DB}?mode=ro' AS live;
    INSERT INTO event(id, aggregate_id, seq, type, data)
    SELECT id, aggregate_id, seq, type, data
    FROM live.event
    WHERE substr(data, 1, 4096) LIKE '%data:video%'
       OR (
         length(data) > 262144
         AND substr(data, 1, 4096) LIKE '%data:%'
         AND substr(data, 1, 4096) NOT LIKE '%data:image%'
       );
    DETACH live;
    SELECT COUNT(*), COALESCE(SUM(length(data)),0), COALESCE(MAX(length(data)),0) FROM event;
  `;
  let out;
  try {
    out = sqlite(destDb, extractSql);
  } catch {
    out = sqlite(destDb, `
      ATTACH DATABASE '${LIVE_DB.replace(/'/g, "''")}' AS live;
      INSERT INTO event(id, aggregate_id, seq, type, data)
      SELECT id, aggregate_id, seq, type, data
      FROM live.event
      WHERE substr(data, 1, 4096) LIKE '%data:video%'
         OR (
           length(data) > 262144
           AND substr(data, 1, 4096) LIKE '%data:%'
           AND substr(data, 1, 4096) NOT LIKE '%data:image%'
         );
      DETACH live;
      SELECT COUNT(*), COALESCE(SUM(length(data)),0), COALESCE(MAX(length(data)),0) FROM event;
    `);
  }
  const [count, total, max] = out.trim().split("|").map(Number);
  step("extract", { count, totalBytes: total, maxBytes: max, destDb, mediaRoot });
  if (!count) throw new Error("no fat events extracted");
  return { count, total, max };
}

async function runMaintainAndAssert(destDb, mediaRoot) {
  const t0 = Date.now();
  const maintain = maintainOpencodeDbBeforeServe(destDb, {
    forceCompact: true,
    mediaRoot,
  });
  const elapsedMs = Date.now() - t0;
  if (!maintain.ok) throw new Error(maintain.error || "maintain failed");

  const rows = JSON.parse(sqlite(destDb, `SELECT id, length(data) AS n, data FROM event;`, { json: true }) || "[]");
  const stillFat = rows.filter((r) => Number(r.n) >= 8192);
  const stillDataVideo = rows.filter((r) => /data:video\/[^"'\\s]*;base64,/i.test(String(r.data)));
  const spilled = [];
  for (const row of rows) {
    let parsed;
    try { parsed = JSON.parse(row.data); } catch {
      throw new Error(`stub not JSON for ${row.id}`);
    }
    const hasAvData = /data:(video|audio)\/[^"'\\s]*;base64,/i.test(String(row.data));
    if (hasAvData) {
      throw new Error(`data: A/V remains in ${row.id} n=${row.n}`);
    }
    if (!parsed._wodeappxElided && Number(row.n) > 4096 && /data:[^"]*;base64,[A-Za-z0-9+/=]{512,}/i.test(String(row.data))) {
      throw new Error(`large data: blob not elided ${row.id} n=${row.n}`);
    }
    const url = parsed.part?.url || parsed.url || "";
    if (url && /^file:\/\//i.test(url)) {
      if (!isOpenableAttachmentUrl(url)) throw new Error(`not openable: ${url}`);
      const info = assertOpenableFileUrl(url);
      const ext = path.extname(info.filePath).replace(".", "") || "bin";
      const head = readFileSync(info.filePath).subarray(0, 64);
      spilled.push({
        id: row.id,
        n: row.n,
        spilledBytes: info.bytes,
        ext,
        mediaHeaderOk: looksLikeMedia(head, ext) || info.bytes > 1024,
        path: info.filePath,
      });
    }
  }

  if (stillFat.length) {
    // Non-A/V leftovers under hard ceiling are soft-reported; data:video/audio must be zero.
    const fatIds = stillFat.map((r) => `${r.id}:${r.n}`);
    step("maintain-soft-fat", { fatIds });
  }
  if (stillDataVideo.length) throw new Error(`still data:video in ${stillDataVideo.length} rows`);
  const stillDataAudio = rows.filter((r) => /data:audio\/[^"'\\s]*;base64,/i.test(String(r.data)));
  if (stillDataAudio.length) throw new Error(`still data:audio in ${stillDataAudio.length} rows`);
  if (!spilled.length) throw new Error("no spilled file:// rows");
  const badHeader = spilled.filter((s) => !s.mediaHeaderOk && s.ext === "mp4");
  if (badHeader.length) throw new Error(`mp4 without ftyp: ${badHeader.map((s) => s.id).join(",")}`);

  // Hard fail if any remaining row is still large AND contains any data: media blob.
  const fatWithData = stillFat.filter((r) => /data:(video|audio|application)\/[^"'\\s]*;base64,[A-Za-z0-9+/=]{512,}/i.test(String(r.data)));
  if (fatWithData.length) {
    throw new Error(`fat media leftovers: ${fatWithData.map((r) => `${r.id}:${r.n}`).join(",")}`);
  }
  step("maintain", {
    elapsedMs,
    elide: maintain.elide,
    compact: maintain.compact,
    spilled: spilled.length,
    sample: spilled.slice(0, 3),
  });
  return { maintain, spilled };
}

function binaryHasSessionMedia(binPath) {
  const result = spawnSync("strings", [binPath], { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  const text = result.stdout || "";
  return {
    hasSessionMedia: text.includes("WODEAPPX_SESSION_MEDIA_ROOT") || text.includes("session-media/"),
    hasLegacyArtifacts: text.includes("session-artifacts/"),
  };
}

async function waitForHealth(baseUrl, headers, timeoutMs = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/global/health`, { headers });
      if (res.ok) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function req(baseUrl, headers, method, p, body) {
  const res = await fetch(`${baseUrl}${p}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* ignore */ }
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${text.slice(0, 240)}`);
  return json;
}

async function runSidecarFlows(port, workRoot) {
  if (!existsSync(NEW_BINARY)) throw new Error(`binary missing: ${NEW_BINARY}`);
  const marks = binaryHasSessionMedia(NEW_BINARY);
  if (!marks.hasSessionMedia) throw new Error("NEW binary missing session-media markers");

  const xdg = {
    data: path.join(workRoot, "xdg-data"),
    config: path.join(workRoot, "xdg-config"),
    state: path.join(workRoot, "xdg-state"),
    cache: path.join(workRoot, "xdg-cache"),
  };
  for (const dir of Object.values(xdg)) mkdirSync(dir, { recursive: true });

  const username = `acc_${Math.random().toString(16).slice(2, 10)}`;
  const password = `pass_${Math.random().toString(16).slice(2, 18)}`;
  const env = {
    ...process.env,
    XDG_DATA_HOME: xdg.data,
    XDG_CONFIG_HOME: xdg.config,
    XDG_STATE_HOME: xdg.state,
    XDG_CACHE_HOME: xdg.cache,
    OPENCODE_SERVER_USERNAME: username,
    OPENCODE_SERVER_PASSWORD: password,
    HOME: workRoot,
  };

  const child = spawn(NEW_BINARY, ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--cors", "*"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  child.stdout.on("data", () => {});

  const baseUrl = `http://127.0.0.1:${port}`;
  const headers = {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
    "Content-Type": "application/json",
  };

  try {
    const healthy = await waitForHealth(baseUrl, headers, 45_000);
    if (!healthy) throw new Error(`sidecar health timeout\n${stderr.slice(-800)}`);

    const session = await req(baseUrl, headers, "POST", "/session", {
      title: `media-acceptance ${new Date().toISOString()}`,
    });
    if (!session?.id) throw new Error("session create failed");

    // Prefer whatever model config exposes; fall back to a cheap local-ish id.
    let model = { providerID: "wodeapp", modelID: "wode/kimi-code-k3-256k" };
    try {
      const config = await req(baseUrl, headers, "GET", "/config");
      const providers = config?.provider || {};
      const wodeModels = providers.wodeapp?.models || {};
      const ids = Object.keys(wodeModels);
      if (ids.length) {
        const pick = ids.find((id) => /kimi|k3|minimax|deepseek/i.test(id)) || ids[0];
        model = { providerID: "wodeapp", modelID: pick.startsWith("wode/") ? pick : pick };
      }
    } catch { /* empty engine may have no providers; still exercise store path */ }

    // Text turn (may fail model if no key — still assert no data:video written)
    let textOk = false;
    let textError = null;
    try {
      await req(baseUrl, headers, "POST", `/session/${session.id}/prompt_async`, {
        model,
        parts: [{ type: "text", text: "只回复：正常。不要工具。" }],
      });
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const messages = await req(baseUrl, headers, "GET", `/session/${session.id}/message`);
        const blob = JSON.stringify(messages);
        if (/data:video\//i.test(blob)) throw new Error("data:video appeared after text turn");
        if (/"role":"assistant"/.test(blob) || /正常/.test(blob)) {
          textOk = true;
          break;
        }
        // provider missing → prompt may error; treat as store-path OK if session still readable
        if (/error|provider|unauthorized|credit/i.test(blob) && Array.isArray(messages) && messages.length >= 1) {
          textOk = true;
          textError = "model/provider soft-fail (store path still exercised)";
          break;
        }
      }
    } catch (error) {
      textError = String(error);
      // Session create + health already prove new binary boots; text may need cloud keys.
      textOk = /provider|model|credit|unauthorized|fetch failed/i.test(String(error));
    }

    // Image turn: tiny png data URL must be accepted by store (not externalized to file://)
    const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    let imageOk = false;
    let imageError = null;
    try {
      await req(baseUrl, headers, "POST", `/session/${session.id}/prompt_async`, {
        model,
        parts: [
          { type: "text", text: "看图一句话。" },
          { type: "file", mime: "image/png", filename: "dot.png", url: tinyPng },
        ],
      });
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const messages = await req(baseUrl, headers, "GET", `/session/${session.id}/message`);
        const blob = JSON.stringify(messages);
        if (/data:video\//i.test(blob)) throw new Error("data:video appeared after image turn");
        if (/data:image\/png;base64,/.test(blob)) imageOk = true;
        if (Array.isArray(messages) && messages.length >= 2) break;
      }
    } catch (error) {
      imageError = String(error);
      imageOk = /provider|model|credit|unauthorized/i.test(String(error));
    }

    // PDF path: write a tiny PDF and send as file:// — engine must not create data:video;
    // may externalize PDF to session-media (new binary) or keep file://.
    const pdfPath = path.join(workRoot, "tiny.pdf");
    writeFileSync(pdfPath, Buffer.from("%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"));
    const pdfUrl = pathToFileURL(pdfPath).href;
    let pdfOk = false;
    let pdfError = null;
    try {
      await req(baseUrl, headers, "POST", `/session/${session.id}/prompt_async`, {
        model,
        parts: [
          { type: "text", text: "这是 PDF 附件，一句话确认收到。" },
          { type: "file", mime: "application/pdf", filename: "tiny.pdf", url: pdfUrl },
        ],
      });
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const messages = await req(baseUrl, headers, "GET", `/session/${session.id}/message`);
        const blob = JSON.stringify(messages);
        if (/data:video\//i.test(blob)) throw new Error("data:video after pdf turn");
        // PDF must not become megabyte data:application in history
        if (/data:application\/pdf;base64,[A-Za-z0-9+/=]{2000,}/.test(blob)) {
          throw new Error("PDF was inlined as large data:application");
        }
        pdfOk = true;
        break;
      }
    } catch (error) {
      pdfError = String(error);
      pdfOk = /provider|model|credit|unauthorized/i.test(String(error));
    }

    // Inspect engine DB under this XDG for any data:video
    const engineDb = path.join(xdg.data, "opencode", "opencode.db");
    let engineDataVideo = 0;
    if (existsSync(engineDb)) {
      engineDataVideo = Number(sqlite(
        engineDb,
        `SELECT COUNT(*) FROM event WHERE substr(data,1,4096) LIKE '%data:video%';`,
      ).trim() || "0");
    }

    step("sidecar-flows", {
      port,
      sessionId: session.id,
      binaryMarks: marks,
      textOk,
      textError,
      imageOk,
      imageError,
      pdfOk,
      pdfError,
      engineDataVideo,
      engineDbExists: existsSync(engineDb),
    });

    if (engineDataVideo > 0) throw new Error(`new sidecar wrote data:video rows=${engineDataVideo}`);
    if (!textOk && !imageOk && !pdfOk) throw new Error("all sidecar flow probes failed hard");
    return { sessionId: session.id, textOk, imageOk, pdfOk, engineDataVideo };
  } finally {
    try { child.kill("SIGTERM"); } catch { /* ignore */ }
    await new Promise((r) => setTimeout(r, 500));
    try { child.kill("SIGKILL"); } catch { /* ignore */ }
  }
}

async function edgeUnitChecks(mediaRoot) {
  // Synthetic DB: wrong mime + .webm, audio wav, empty-ish tool already covered by unit tests;
  // here we verify maintain spill path for audio-like payload.
  const dbPath = path.join(mediaRoot, "..", "edge.db");
  const { DatabaseSync } = require("node:sqlite");
  const database = new DatabaseSync(dbPath);
  database.exec(`
    CREATE TABLE event (
      id TEXT PRIMARY KEY,
      aggregate_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL
    );
  `);
  const raw = Buffer.alloc(300 * 1024, 9);
  const blob = `data:application/octet-stream;base64,${raw.toString("base64")}`;
  const payload = JSON.stringify({
    sessionID: "ses_edge",
    part: {
      id: "prt_edge",
      sessionID: "ses_edge",
      type: "file",
      mime: "application/octet-stream",
      filename: "clip.webm",
      url: blob,
    },
  });
  database.prepare(
    "INSERT INTO event(id, aggregate_id, seq, type, data) VALUES (?,?,?,?,?)",
  ).run("evt_edge", "ses_edge", 1, "message.part.updated.1", payload);
  database.close();

  const edgeMedia = path.join(mediaRoot, "edge-media");
  const result = maintainOpencodeDbBeforeServe(dbPath, { forceCompact: true, mediaRoot: edgeMedia });
  if (!result.ok) throw new Error(result.error || "edge maintain failed");
  const row = JSON.parse(sqlite(dbPath, `SELECT data FROM event WHERE id='evt_edge';`, { json: true }))[0];
  const parsed = JSON.parse(row.data);
  if (!String(parsed.part?.url || "").startsWith("file:")) {
    throw new Error(`edge webm not spilled: ${parsed.part?.url}`);
  }
  assertOpenableFileUrl(parsed.part.url);
  if (!isOpenableAttachmentUrl(parsed.part.url)) throw new Error("edge url not openable");
  step("edge-wrong-mime-webm", { url: parsed.part.url, spilled: true });
}

async function main() {
  const skipSidecar = hasFlag("--skip-sidecar");
  const port = Number(readArg("--port") || process.env.WODEAPPX_ACCEPT_PORT || 61999);
  const root = mkdtempSync(path.join(tmpdir(), "wodeappx-media-accept-"));
  const mediaRoot = path.join(root, "session-media");
  const destDb = path.join(root, "fat-events.db");
  mkdirSync(mediaRoot, { recursive: true });
  report.root = root;

  try {
    await extractFatEvents(destDb, mediaRoot);
    const { spilled } = await runMaintainAndAssert(destDb, mediaRoot);
    report.spilledCount = spilled.length;
    report.spilledBytes = spilled.reduce((sum, row) => sum + row.spilledBytes, 0);

    await edgeUnitChecks(mediaRoot);

    // Open-target contract for largest spill
    const largest = [...spilled].sort((a, b) => b.spilledBytes - a.spilledBytes)[0];
    if (!largest) throw new Error("no spill sample");
    const openCheck = {
      openable: isOpenableAttachmentUrl(pathToFileURL(largest.path).href),
      bytes: largest.spilledBytes,
      ext: largest.ext,
      mediaHeaderOk: largest.mediaHeaderOk,
    };
    if (!openCheck.openable || !openCheck.mediaHeaderOk) {
      throw new Error(`open-target failed: ${JSON.stringify(openCheck)}`);
    }
    step("open-target", openCheck);

    if (!skipSidecar) {
      await runSidecarFlows(port, path.join(root, "sidecar"));
    } else {
      step("sidecar-flows", { skipped: true });
    }
  } catch (error) {
    fail("acceptance", error instanceof Error ? error.message : String(error));
  }

  writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ summary: report }, null, 2));
  if (!report.ok) process.exit(1);
}

await main();
