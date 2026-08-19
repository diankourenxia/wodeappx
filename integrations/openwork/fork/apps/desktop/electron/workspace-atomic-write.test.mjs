import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  isRetryableReplaceError,
  persistWorkspaceStateSafe,
  replaceFileAtomic,
  writeJsonFileAtomic,
} from "./workspace-atomic-write.mjs";

function eperm() {
  const error = new Error("EPERM: operation not permitted, rename");
  error.code = "EPERM";
  return error;
}

test("EPERM / EACCES / EBUSY are retryable Windows replace errors", () => {
  assert.equal(isRetryableReplaceError({ code: "EPERM" }), true);
  assert.equal(isRetryableReplaceError({ code: "EACCES" }), true);
  assert.equal(isRetryableReplaceError({ code: "EBUSY" }), true);
  assert.equal(isRetryableReplaceError({ code: "ENOENT" }), false);
  assert.equal(isRetryableReplaceError({ code: "EISDIR" }), false);
});

test("replace retries rename after EPERM then succeeds", async () => {
  let calls = 0;
  const result = await replaceFileAtomic("from.tmp", "dest.json", {
    maxAttempts: 4,
    delayMs: 1,
    sleep: async () => {},
    rename: async () => {
      calls += 1;
      if (calls < 3) throw eperm();
    },
    copyFile: async () => {
      throw new Error("copy should not run");
    },
  });
  assert.equal(result.method, "rename");
  assert.equal(result.attempts, 3);
  assert.equal(calls, 3);
});

test("replace falls back to copy when rename stays EPERM", async () => {
  const copied = [];
  const unlinked = [];
  const result = await replaceFileAtomic("from.tmp", "dest.json", {
    maxAttempts: 3,
    delayMs: 1,
    sleep: async () => {},
    rename: async () => {
      throw eperm();
    },
    copyFile: async (from, to) => {
      copied.push([from, to]);
    },
    unlink: async (target) => {
      unlinked.push(target);
    },
  });
  assert.equal(result.method, "copy");
  assert.deepEqual(copied, [["from.tmp", "dest.json"]]);
  assert.deepEqual(unlinked, ["from.tmp"]);
});

test("non-retryable replace errors fail immediately", async () => {
  const error = new Error("is a directory");
  error.code = "EISDIR";
  await assert.rejects(
    () => replaceFileAtomic("from.tmp", "dest.json", {
      rename: async () => {
        throw error;
      },
      copyFile: async () => {
        throw new Error("copy should not run");
      },
    }),
    (caught) => caught.code === "EISDIR",
  );
});

test("persistWorkspaceStateSafe stays up when replace keeps failing", async () => {
  const warnings = [];
  const result = await persistWorkspaceStateSafe("/locked/openwork-workspaces.json", { ok: true }, {
    mkdir: async () => {},
    writeFile: async () => {},
    randomBytes: () => Buffer.from("aabbcc", "hex"),
    pid: 10944,
    maxAttempts: 2,
    delayMs: 1,
    sleep: async () => {},
    rename: async () => {
      throw eperm();
    },
    copyFile: async () => {
      throw eperm();
    },
    rm: async () => {
      throw eperm();
    },
    warn: (...args) => warnings.push(args),
  });
  assert.equal(result.persisted, false);
  assert.equal(result.error?.code, "EPERM");
  assert.match(String(warnings[0]?.[0]), /persist failed; continuing with in-memory state/);
});

test("writeJsonFileAtomic writes valid JSON through a real rename", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wodeappx-atomic-write-"));
  const dest = path.join(root, "openwork-workspaces.json");
  await writeJsonFileAtomic(dest, { selectedId: "ws_1", workspaces: [] });
  const parsed = JSON.parse(await readFile(dest, "utf8"));
  assert.equal(parsed.selectedId, "ws_1");
  assert.equal(parsed.workspaces.length, 0);
});
