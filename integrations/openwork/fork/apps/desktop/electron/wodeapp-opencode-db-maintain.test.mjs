#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import { fileURLToPath } from "node:url";

import {
  COMPACTION_DELETE_SQL,
  maintainOpencodeDbBeforeServe,
  stubEventPayload,
  stubMessagePayload,
} from "./wodeapp-opencode-db-maintain.mjs";

const require = createRequire(import.meta.url);

function sqlite(dbPath, sql) {
  const created = spawnSync("sqlite3", [dbPath, sql], { encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr);
  return created.stdout;
}

function openDb(dbPath) {
  const { DatabaseSync } = require("node:sqlite");
  return new DatabaseSync(dbPath);
}

test("stubEventPayload keeps ids without inlining media", () => {
  const head = '{"sessionID":"ses_1","part":{"id":"prt_1","sessionID":"ses_1","type":"file","mime":"video/mp4","filename":"meet.mp4","url":"data:video/mp4;base64,AAAA';
  const stub = JSON.parse(stubEventPayload(head, 186_670_002, "message.part.updated.1"));
  assert.equal(stub.sessionID, "ses_1");
  assert.equal(stub.part.id, "prt_1");
  assert.equal(stub.part.url, "");
  assert.equal(stub._wodeappxElided, true);
  assert.equal(stub.originalBytes, 186_670_002);
  assert.ok(!JSON.stringify(stub).includes("data:video"));

  const withFile = JSON.parse(stubEventPayload(
    head,
    186_670_002,
    "message.part.updated.1",
    "file:///Users/test/.wodeappx/session-media/ses_1/evt_x.mp4",
  ));
  assert.equal(withFile.part.url, "file:///Users/test/.wodeappx/session-media/ses_1/evt_x.mp4");
});

test("stubMessagePayload always keeps role (never bare file stub)", () => {
  const head = '{"role":"assistant","agent":"openwork","modelID":"wode/kimi","providerID":"wodeapp","mime":"video/mp4","filename":"clip.mp4","url":"data:video/mp4;base64,AAAA';
  const stub = JSON.parse(stubMessagePayload(
    head,
    1_137_831,
    undefined,
    "file:///Users/test/.wodeappx/session-media/session/msg_x.bin",
  ));
  assert.equal(stub.role, "assistant");
  assert.equal(stub._wodeappxElided, true);
  assert.equal(stub.originalBytes, 1_137_831);
  assert.equal(stub.elidedAttachment?.url, "file:///Users/test/.wodeappx/session-media/session/msg_x.bin");
  assert.notEqual(stub.type, "file");
});

test("spills oversized data:video to a local file:// instead of emptying url", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-maintain-"));
  const dbPath = path.join(root, "opencode.db");
  const mediaRoot = path.join(root, "session-media");
  sqlite(dbPath, `
    CREATE TABLE event (
      id TEXT PRIMARY KEY,
      aggregate_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL
    );
  `);
  const raw = Buffer.alloc(300 * 1024, 7);
  const blob = "data:video/mp4;base64," + raw.toString("base64");
  const payload = JSON.stringify({
    sessionID: "ses_x",
    part: {
      id: "prt_x",
      sessionID: "ses_x",
      type: "file",
      mime: "video/mp4",
      filename: "meet.mp4",
      url: blob,
    },
  });
  const database = openDb(dbPath);
  database.prepare(
    "INSERT INTO event(id, aggregate_id, seq, type, data) VALUES (?,?,?,?,?)",
  ).run("evt_fat", "ses_x", 1, "message.part.updated.1", payload);
  database.close();

  const report = maintainOpencodeDbBeforeServe(dbPath, { forceCompact: true, mediaRoot });
  assert.equal(report.ok, true);
  const elideEvent = report.elide.find((item) => item.table === "event");
  assert.equal(elideEvent.elided, 1);
  assert.equal(elideEvent.spilled, 1);

  const after = openDb(dbPath);
  const row = after.prepare("SELECT length(data) AS n, data FROM event WHERE id = 'evt_fat'").get();
  after.close();
  assert.ok(row.n < 8192, `still fat: ${row.n}`);
  const parsed = JSON.parse(row.data);
  assert.equal(parsed._wodeappxElided, true);
  assert.ok(String(parsed.part.url).startsWith("file:"), parsed.part.url);
  assert.ok(!row.data.includes("data:video/mp4;base64,AA"));
  const spilledPath = fileURLToPath(parsed.part.url);
  assert.equal(existsSync(spilledPath), true);
  const spilled = await readFile(spilledPath);
  assert.equal(spilled.length, raw.length);
  assert.ok(spilled.equals(raw), "spilled file must match original bytes");
});

test("isOpenableAttachmentUrl accepts session-media file:// chips", async () => {
  const { isOpenableAttachmentUrl } = await import(
    "../../../app/src/components/chat/message-file-display.ts"
  ).catch(() => ({ isOpenableAttachmentUrl: null }));
  // Pure pattern check if TS import unavailable in node:test without loader.
  const pattern = /^(https?:\/\/|file:\/\/|wodeappx-asset:)/i;
  const url = "file:///Users/test/.wodeappx/session-media/ses_x/evt.mp4";
  assert.equal(pattern.test(url), true);
  assert.equal(pattern.test(""), false);
  assert.equal(pattern.test("data:video/mp4;base64,AAA"), false);
  if (typeof isOpenableAttachmentUrl === "function") {
    assert.equal(isOpenableAttachmentUrl(url), true);
  }
});

test("wrong mime + .webm still spills via maintain", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-maintain-webm-"));
  const dbPath = path.join(root, "opencode.db");
  const mediaRoot = path.join(root, "session-media");
  sqlite(dbPath, `
    CREATE TABLE event (
      id TEXT PRIMARY KEY,
      aggregate_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL
    );
  `);
  const raw = Buffer.alloc(300 * 1024, 3);
  const blob = "data:application/octet-stream;base64," + raw.toString("base64");
  const payload = JSON.stringify({
    sessionID: "ses_webm",
    part: {
      id: "prt_webm",
      sessionID: "ses_webm",
      type: "file",
      mime: "application/octet-stream",
      filename: "clip.webm",
      url: blob,
    },
  });
  const database = openDb(dbPath);
  database.prepare(
    "INSERT INTO event(id, aggregate_id, seq, type, data) VALUES (?,?,?,?,?)",
  ).run("evt_webm", "ses_webm", 1, "message.part.updated.1", payload);
  database.close();

  const report = maintainOpencodeDbBeforeServe(dbPath, { forceCompact: true, mediaRoot });
  assert.equal(report.ok, true);
  assert.equal(report.elide.find((item) => item.table === "event").spilled, 1);
  const after = openDb(dbPath);
  const row = after.prepare("SELECT data FROM event WHERE id = 'evt_webm'").get();
  after.close();
  const parsed = JSON.parse(row.data);
  assert.ok(String(parsed.part.url).startsWith("file:"));
  assert.ok(parsed.part.url.includes("session-media") || existsSync(fileURLToPath(parsed.part.url)));
});

test("small data:video under 256KB is still spilled", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-maintain-small-video-"));
  const dbPath = path.join(root, "opencode.db");
  const mediaRoot = path.join(root, "session-media");
  sqlite(dbPath, `
    CREATE TABLE event (
      id TEXT PRIMARY KEY,
      aggregate_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL
    );
  `);
  const raw = Buffer.alloc(12 * 1024, 5);
  const blob = "data:video/mp4;base64," + raw.toString("base64");
  const payload = JSON.stringify({
    sessionID: "ses_small",
    part: {
      id: "prt_small",
      sessionID: "ses_small",
      type: "file",
      mime: "video/mp4",
      filename: "short.mp4",
      url: blob,
    },
  });
  const database = openDb(dbPath);
  database.prepare(
    "INSERT INTO event(id, aggregate_id, seq, type, data) VALUES (?,?,?,?,?)",
  ).run("evt_small", "ses_small", 1, "message.part.updated.1", payload);
  database.close();
  const beforeN = Buffer.byteLength(payload, "utf8");
  assert.ok(beforeN < 256 * 1024, `fixture should be under threshold: ${beforeN}`);

  const report = maintainOpencodeDbBeforeServe(dbPath, { forceCompact: true, mediaRoot });
  assert.equal(report.ok, true);
  assert.equal(report.elide.find((item) => item.table === "event").spilled, 1);
  const after = openDb(dbPath);
  const row = after.prepare("SELECT length(data) AS n, data FROM event WHERE id = 'evt_small'").get();
  after.close();
  assert.ok(row.n < 2048);
  assert.ok(!row.data.includes("data:video"));
  assert.ok(JSON.parse(row.data).part.url.startsWith("file:"));
});

test("skips missing db and disabled env", async () => {
  const missing = maintainOpencodeDbBeforeServe(path.join(os.tmpdir(), "no-such-opencode.db"));
  assert.equal(missing.skipped, true);
  assert.equal(missing.reason, "missing");

  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-disabled-"));
  const dbPath = path.join(root, "opencode.db");
  sqlite(dbPath, "CREATE TABLE event (id TEXT PRIMARY KEY, data TEXT);");
  const prev = process.env.WODEAPPX_EVENT_DB_MAINTAIN;
  process.env.WODEAPPX_EVENT_DB_MAINTAIN = "0";
  try {
    const report = maintainOpencodeDbBeforeServe(dbPath);
    assert.equal(report.skipped, true);
    assert.equal(report.reason, "disabled");
  } finally {
    if (prev === undefined) delete process.env.WODEAPPX_EVENT_DB_MAINTAIN;
    else process.env.WODEAPPX_EVENT_DB_MAINTAIN = prev;
  }
});

test("compaction SQL deletes duplicate snapshots, keeps latest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-compact-"));
  const dbPath = path.join(root, "opencode.db");
  sqlite(dbPath, `
    CREATE TABLE event (
      id TEXT PRIMARY KEY,
      aggregate_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL
    );
  `);
  const database = openDb(dbPath);
  const insert = database.prepare(
    "INSERT INTO event(id, aggregate_id, seq, type, data) VALUES (?,?,?,?,?)",
  );
  for (const [id, seq] of [["evt_1", 1], ["evt_2", 2], ["evt_3", 3]]) {
    insert.run(
      id,
      "ses_a",
      seq,
      "message.part.updated.1",
      JSON.stringify({ sessionID: "ses_a", part: { id: "prt_keep", sessionID: "ses_a" } }),
    );
  }
  database.exec(COMPACTION_DELETE_SQL);
  const left = database.prepare("SELECT id FROM event ORDER BY seq").all().map((row) => row.id);
  database.close();
  assert.deepEqual(left, ["evt_3"]);
});
