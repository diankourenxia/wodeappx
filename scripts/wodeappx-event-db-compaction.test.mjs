import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fingerprintsEqual,
  planCompaction,
  runCompactionOnCopy,
} from "./wodeappx-event-db-compaction-dryrun.mjs";
import { evaluateDbThresholds } from "./wodeappx-event-db-audit.mjs";
import {
  APPLY_ENV_FLAG,
  applyCompactionDelete,
  assertApplyFlagsEnabled,
  buildPlanPayload,
  computePlanToken,
  createBackup,
  ensureDiskSpace,
  freeBytesForPath,
  probeEngineIdle,
  runApplyPipeline,
  verifyPlanToken,
} from "./wodeappx-event-db-compaction-core.mjs";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite");

const SCHEMA = `
CREATE TABLE event (
  id text PRIMARY KEY,
  aggregate_id text NOT NULL,
  seq integer NOT NULL,
  type text NOT NULL,
  data text NOT NULL
);
CREATE TABLE event_sequence (aggregate_id text PRIMARY KEY, seq integer NOT NULL, owner_id text);
CREATE TABLE session (id text PRIMARY KEY, data text NOT NULL);
CREATE TABLE message (
  id text PRIMARY KEY, session_id text NOT NULL,
  time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL
);
CREATE TABLE part (
  id text PRIMARY KEY, message_id text NOT NULL, session_id text NOT NULL,
  time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL
);`;

function seedFixtureDb(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  db.exec("INSERT INTO session VALUES ('ses_1', '{\"id\":\"ses_1\"}')");
  db.exec("INSERT INTO event_sequence VALUES ('ses_1', 9, null)");
  db.exec("INSERT INTO message VALUES ('msg_1', 'ses_1', 1, 9, '{\"id\":\"msg_1\"}')");
  db.exec("INSERT INTO part VALUES ('prt_1', 'msg_1', 'ses_1', 1, 9, '{\"id\":\"prt_1\"}')");

  const insert = db.prepare("INSERT INTO event (id, aggregate_id, seq, type, data) VALUES (?, 'ses_1', ?, ?, ?)");
  insert.run("e1", 1, "message.updated.1", JSON.stringify({ info: { id: "msg_1", v: 1 } }));
  insert.run("e2", 2, "message.updated.1", JSON.stringify({ info: { id: "msg_1", v: 2, pad: "x".repeat(100) } }));
  insert.run("e3", 3, "message.updated.1", JSON.stringify({ info: { id: "msg_1", v: 3, pad: "y".repeat(200) } }));
  insert.run("e4", 4, "message.updated.1", JSON.stringify({ info: { id: "msg_2" } }));
  insert.run("e5", 5, "message.part.updated.1", JSON.stringify({ part: { id: "prt_1", messageID: "msg_1" } }));
  insert.run("e6", 6, "message.part.updated.1", JSON.stringify({ part: { id: "prt_1", messageID: "msg_1", pad: "z".repeat(50) } }));
  insert.run("e7", 7, "message.updated.1", "{不是合法JSON");
  insert.run("e8", 8, "session.updated.1", JSON.stringify({ info: { id: "ses_1" } }));
  insert.run("e9", 9, "session.created.1", JSON.stringify({ info: { id: "ses_1" } }));
  db.close();
}

function withFixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), "wodeappx-compaction-test-"));
  const dbPath = join(dir, "opencode.db");
  seedFixtureDb(dbPath);
  const cleanup = () => {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  };
  try {
    const result = fn(dbPath, dir);
    if (result && typeof result.then === "function") {
      return Promise.resolve(result).finally(cleanup);
    }
    cleanup();
    return result;
  } catch (error) {
    cleanup();
    throw error;
  }
}

function eventCount(dbPath) {
  const db = new DatabaseSync(dbPath);
  const n = db.prepare("SELECT COUNT(*) AS n FROM event").get().n;
  db.close();
  return n;
}

function planFor(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA query_only = ON");
  const plan = planCompaction(db);
  db.close();
  return buildPlanPayload(dbPath, plan);
}

test("planCompaction：每实体仅留最新，NULL 实体与生命周期类型不删", () => {
  withFixture((dbPath) => {
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA query_only = ON");
    const plan = planCompaction(db);
    db.close();
    assert.equal(plan.eventRows, 9);
    assert.equal(plan.deleteRows, 3);
    assert.ok(plan.deleteBytes > 0);
    assert.ok(plan.compactableTypes.some((row) => row.type === "message.updated.1"));
  });
});

test("runCompactionOnCopy：删除后投影指纹不变、无 FK 违例、可回收字节", () => {
  withFixture((dbPath) => {
    const result = runCompactionOnCopy(dbPath, { vacuum: true });
    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.equal(result.deletedRows, 3);
    assert.equal(result.eventRowsAfter, 6);
    assert.equal(result.projectionMatch, true);
    assert.equal(result.foreignKeyViolations, 0);
    assert.equal(result.integrityAfter.ok, true);
    assert.ok(result.reclaimedBytes >= 0);

    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA query_only = ON");
    const kept = db.prepare("SELECT id FROM event ORDER BY id").all().map((row) => row.id);
    db.close();
    assert.deepEqual(kept, ["e3", "e4", "e6", "e7", "e8", "e9"]);
  });
});

test("runCompactionOnCopy：无匹配类型时零删除仍通过", () => {
  const dir = mkdtempSync(join(tmpdir(), "wodeappx-compaction-empty-"));
  const dbPath = join(dir, "opencode.db");
  try {
    const db = new DatabaseSync(dbPath);
    db.exec(SCHEMA);
    db.exec("INSERT INTO session VALUES ('ses_1', '{}')");
    db.exec("INSERT INTO event (id, aggregate_id, seq, type, data) VALUES ('e1', 'ses_1', 1, 'session.created.1', '{}')");
    db.close();
    const result = runCompactionOnCopy(dbPath, { vacuum: false });
    assert.equal(result.ok, true);
    assert.equal(result.deletedRows, 0);
    assert.equal(result.vacuumed, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fingerprintsEqual：键集合与值完全一致才相等", () => {
  assert.equal(fingerprintsEqual({ a: { n: 1 } }, { a: { n: 1 } }), true);
  assert.equal(fingerprintsEqual({ a: { n: 1 } }, { a: { n: 2 } }), false);
  assert.equal(fingerprintsEqual({ a: { n: 1 } }, { b: { n: 1 } }), false);
});

test("evaluateDbThresholds：512 MiB 告警 / 1 GiB 维护 / 大 event 记录", () => {
  assert.deepEqual(
    evaluateDbThresholds({ totalFileMiB: 300, eventsOver2MiB: 0 }).map((g) => g.status),
    ["ok", "ok"],
  );
  assert.deepEqual(
    evaluateDbThresholds({ totalFileMiB: 600, eventsOver2MiB: 0 }).map((g) => g.status),
    ["warn", "ok"],
  );
  assert.deepEqual(
    evaluateDbThresholds({ totalFileMiB: 1500, eventsOver2MiB: 7 }).map((g) => g.status),
    ["maintain", "warn"],
  );
});

test("plan token：自洽；漂移/错误 confirm/非法 expires 拒绝；expiresAt 参与 hash", () => {
  withFixture((dbPath) => {
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA query_only = ON");
    const plan = planCompaction(db);
    db.close();
    const payload = buildPlanPayload(dbPath, plan);
    assert.equal(payload.token, computePlanToken(payload));
    assert.ok(payload.expiresAt);
    assert.equal(verifyPlanToken(dbPath, payload, payload.token).ok, true);
    assert.equal(verifyPlanToken(dbPath, payload, "deadbeefdeadbeef").ok, false);

    const drifted = { ...payload, eventRows: payload.eventRows + 1 };
    drifted.token = computePlanToken(drifted);
    assert.equal(verifyPlanToken(dbPath, drifted, drifted.token).ok, false);

    const extended = { ...payload, expiresAt: new Date(Date.now() + 86400_000).toISOString() };
    // expiresAt 改了但 token 未重算 → 自校验失败
    assert.equal(verifyPlanToken(dbPath, extended, extended.token).ok, false);

    assert.equal(verifyPlanToken(dbPath, { ...payload, expiresAt: "not-a-date", token: payload.token }, payload.token).ok, false);
    assert.equal(verifyPlanToken(dbPath, { ...payload, expiresAt: undefined, token: payload.token }, payload.token).ok, false);
  });
});

test("assertApplyFlagsEnabled：默认关；需 env+理解旗标", () => {
  assert.equal(assertApplyFlagsEnabled({ env: {}, understandFlag: true }).ok, false);
  assert.equal(assertApplyFlagsEnabled({ env: { [APPLY_ENV_FLAG]: "1" }, understandFlag: false }).ok, false);
  assert.equal(assertApplyFlagsEnabled({ env: { [APPLY_ENV_FLAG]: "1" }, understandFlag: true }).ok, true);
});

test("applyCompactionDelete：成功删行", () => {
  withFixture((dbPath) => {
    const ok = applyCompactionDelete(dbPath, { vacuum: false });
    assert.equal(ok.ok, true);
    assert.equal(ok.deletedRows, 3);
    assert.equal(ok.eventRowsAfter, 6);
    assert.equal(ok.vacuumed, false);
  });
});

test("applyCompactionDelete：投影失败注入后 ROLLBACK 行数复原", () => {
  withFixture((dbPath) => {
    const before = new DatabaseSync(dbPath);
    const nBefore = before.prepare("SELECT COUNT(*) AS n FROM event").get().n;
    before.close();
    assert.equal(nBefore, 9);

    const failed = applyCompactionDelete(dbPath, { vacuum: false, forceProjectionMismatch: true });
    assert.equal(failed.ok, false);
    assert.equal(failed.rolledBack, true);
    assert.equal(failed.stage, "post-delete-check");
    assert.equal(failed.eventRowsAfterRollback, 9);

    const after = new DatabaseSync(dbPath);
    const nAfter = after.prepare("SELECT COUNT(*) AS n FROM event").get().n;
    after.close();
    assert.equal(nAfter, 9);
  });
});

test("ensureDiskSpace：拒绝不足空间；备份目录/文件权限收紧", async () => {
  // 专用 backupRoot，禁止 chmod 系统 tmpdir（避免影响并发测试）
  const diskRoot = mkdtempSync(join(tmpdir(), "wodeappx-compaction-disk-"));
  try {
    const free = freeBytesForPath(diskRoot);
    assert.ok(free == null || free > 0);

    const tooMuch = ensureDiskSpace(diskRoot, Number.MAX_SAFE_INTEGER);
    assert.equal(tooMuch.ok, false);
    assert.match(tooMuch.reason, /磁盘剩余|无法读取/);
    // Windows NTFS does not honor POSIX 0700/0600 the same way; skip mode bits there.
    if (process.platform !== "win32") {
      assert.equal(statSync(diskRoot).mode & 0o777, 0o700);
    }
  } finally {
    rmSync(diskRoot, { recursive: true, force: true });
  }

  await withFixture(async (dbPath, dir) => {
    const backupRoot = join(dir, "backups");
    const payload = planFor(dbPath);
    const backup = await createBackup(dbPath, backupRoot, payload);
    assert.equal(backup.ok, true, JSON.stringify(backup));
    if (process.platform !== "win32") {
      assert.equal(statSync(backup.destDir).mode & 0o777, 0o700);
      assert.equal(statSync(backup.destPath).mode & 0o777, 0o600);
      assert.equal(statSync(join(backup.destDir, "backup-manifest.json")).mode & 0o777, 0o600);
    }
  });
});

test("probeEngineIdle：无 discovery 通过；探测失败默认拒绝", async () => {
  const noDiscovery = await probeEngineIdle(null);
  assert.equal(noDiscovery.ok, true);
  assert.equal(noDiscovery.skipped, true);

  const failClosed = await probeEngineIdle({
    baseUrl: "http://127.0.0.1:1",
    username: "u",
    password: "p",
  });
  assert.equal(failClosed.ok, false);
  assert.match(failClosed.detail, /fail-closed/);

  const allowSkip = await probeEngineIdle({
    baseUrl: "http://127.0.0.1:1",
    username: "u",
    password: "p",
  }, { allowProbeFailure: true });
  assert.equal(allowSkip.ok, true);
  assert.equal(allowSkip.skipped, true);
});

test("runApplyPipeline：idle 失败 → 不备份、不删除", async () => {
  await withFixture(async (dbPath, dir) => {
    const backupRoot = join(dir, "backups");
    const payload = planFor(dbPath);
    let backupCalls = 0;
    let deleteCalls = 0;

    const result = await runApplyPipeline({
      dbPath,
      planPayload: payload,
      backupRoot,
      discovery: { baseUrl: "http://example.invalid", username: "u", password: "p" },
      probeIdle: async () => ({ ok: false, detail: "injected idle failure" }),
      backupFn: async () => {
        backupCalls += 1;
        return { ok: true, destDir: backupRoot, sha256: "x", sizeBytes: 1 };
      },
      deleteFn: () => {
        deleteCalls += 1;
        return { ok: true, deletedRows: 3 };
      },
      acquireLock: () => ({ ok: true, release() {} }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.stage, "idle");
    assert.equal(result.backup, null);
    assert.equal(result.apply, null);
    assert.equal(backupCalls, 0);
    assert.equal(deleteCalls, 0);
    assert.equal(eventCount(dbPath), 9);
  });
});

test("runApplyPipeline：磁盘不足 → 不删除", async () => {
  await withFixture(async (dbPath, dir) => {
    const backupRoot = join(dir, "backups");
    const payload = planFor(dbPath);
    let deleteCalls = 0;

    const result = await runApplyPipeline({
      dbPath,
      planPayload: payload,
      backupRoot,
      discovery: null,
      probeIdle: async () => ({ ok: true, skipped: true, detail: "no engine" }),
      backupFn: async () => ({
        ok: false,
        stage: "disk-space",
        reason: "磁盘剩余 1 MiB < 需要 999 MiB（源库×1.2）",
      }),
      deleteFn: () => {
        deleteCalls += 1;
        return { ok: true, deletedRows: 3 };
      },
      acquireLock: () => ({ ok: true, release() {} }),
    });

    assert.equal(result.ok, false);
    assert.equal(result.stage, "disk-space");
    assert.equal(result.apply, null);
    assert.equal(deleteCalls, 0);
    assert.equal(eventCount(dbPath), 9);
  });
});

test("runApplyPipeline：成功路径会备份并删除", async () => {
  await withFixture(async (dbPath, dir) => {
    const backupRoot = join(dir, "backups");
    const payload = planFor(dbPath);
    const result = await runApplyPipeline({
      dbPath,
      planPayload: payload,
      backupRoot,
      discovery: null,
      acquireLock: () => ({ ok: true, release() {} }),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.stage, "done");
    assert.ok(result.backup?.ok);
    assert.equal(result.apply?.deletedRows, 3);
    assert.equal(eventCount(dbPath), 6);
  });
});
