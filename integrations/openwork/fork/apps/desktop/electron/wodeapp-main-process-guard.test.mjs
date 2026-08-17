import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createCriticalLogger,
  isBrokenPipeError,
  serializeLogArg,
} from "./wodeapp-main-process-guard.mjs";

test("isBrokenPipeError matches EPIPE codes and messages", () => {
  assert.equal(isBrokenPipeError({ code: "EPIPE", message: "write EPIPE" }), true);
  assert.equal(isBrokenPipeError(Object.assign(new Error("write EPIPE"), { code: "EPIPE" })), true);
  assert.equal(isBrokenPipeError({ code: "EIO", message: "read EIO" }), true);
  assert.equal(isBrokenPipeError(new Error("boom")), false);
  assert.equal(isBrokenPipeError(null), false);
});

test("serializeLogArg keeps Error fields", () => {
  const err = Object.assign(new Error("watchdog failed"), { code: "ECONNREFUSED" });
  const serialized = serializeLogArg(err);
  assert.equal(serialized.message, "watchdog failed");
  assert.equal(serialized.code, "ECONNREFUSED");
  assert.ok(typeof serialized.stack === "string");
});

test("createCriticalLogger appends JSON lines and keeps recent ring", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wodeappx-guard-"));
  try {
    const logger = createCriticalLogger({ getLogDir: () => dir, recentMax: 3 });
    logger.safeWarn("[ui-control] watchdog ensureHealthy failed", new Error("health down"));
    logger.write("error", "fatal", { ok: false });
    logger.write("warn", "extra", "third");
    logger.write("warn", "extra", "fourth");
    const raw = readFileSync(logger.logPath(), "utf8");
    assert.match(raw, /ui-control/);
    assert.match(raw, /health down/);
    const recent = logger.recentLines();
    assert.equal(recent.length, 3);
    assert.match(recent[2], /fourth/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
