#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import {
  assertOpencodeDbHealthyForWrite,
  checkOpencodeDbIntegrity,
  opencodeDbPathFromXdgDataHome,
} from "./wodeapp-opencode-db-integrity.mjs";

test("missing DB is treated as healthy first boot", () => {
  const result = checkOpencodeDbIntegrity("/tmp/definitely-missing-opencode.db");
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
});

test("opencodeDbPathFromXdgDataHome joins opencode.db", () => {
  assert.equal(
    opencodeDbPathFromXdgDataHome("/tmp/xdg/data"),
    path.join("/tmp/xdg/data", "opencode", "opencode.db"),
  );
});

test("healthy empty sqlite passes quick_check", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-db-ok-"));
  const dbDir = path.join(root, "opencode");
  await mkdir(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, "opencode.db");
  const created = spawnSync("sqlite3", [dbPath, "CREATE TABLE t(id INTEGER);"], {
    encoding: "utf8",
  });
  assert.equal(created.status, 0, created.stderr);
  const result = checkOpencodeDbIntegrity(dbPath);
  assert.equal(result.ok, true);
  assert.equal(assertOpencodeDbHealthyForWrite(root).ok, true);
});

test("malformed DB fails closed before write", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "opencode-db-bad-"));
  const dbDir = path.join(root, "opencode");
  await mkdir(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, "opencode.db");
  await writeFile(dbPath, "this is not a sqlite database\n", "utf8");
  const result = checkOpencodeDbIntegrity(dbPath);
  assert.equal(result.ok, false);
  assert.throws(
    () => assertOpencodeDbHealthyForWrite(root),
    (error) => error?.code === "OPENCODE_DB_MALFORMED",
  );
});
