import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  clearWodeAppContextPacks,
  deleteWodeAppContextPacksForSession,
  getWodeAppContextPackStatus,
  putWodeAppContextPack,
} from "./wodeapp-context-packs.mjs";

async function withContextRoot(run, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "wodeappx-context-packs-"));
  const previousRoot = process.env.WODEAPPX_ATTACHMENT_CONTEXT_ROOT;
  const previousLimit = process.env.WODEAPPX_ATTACHMENT_CONTEXT_MAX_BYTES;
  process.env.WODEAPPX_ATTACHMENT_CONTEXT_ROOT = root;
  if (options.maxBytes) {
    process.env.WODEAPPX_ATTACHMENT_CONTEXT_MAX_BYTES = String(options.maxBytes);
  } else {
    delete process.env.WODEAPPX_ATTACHMENT_CONTEXT_MAX_BYTES;
  }
  try {
    await run(root);
  } finally {
    if (previousRoot === undefined) delete process.env.WODEAPPX_ATTACHMENT_CONTEXT_ROOT;
    else process.env.WODEAPPX_ATTACHMENT_CONTEXT_ROOT = previousRoot;
    if (previousLimit === undefined) delete process.env.WODEAPPX_ATTACHMENT_CONTEXT_MAX_BYTES;
    else process.env.WODEAPPX_ATTACHMENT_CONTEXT_MAX_BYTES = previousLimit;
    await rm(root, { recursive: true, force: true });
  }
}

test("writes a private attachment manifest and stable local media path", async () => {
  await withContextRoot(async (root) => {
    const refId = `ctx_test_${Date.now()}_store`;
    const packDir = path.join(root, refId);
    const result = await putWodeAppContextPack({
      refId,
      sessionId: "ses_test",
      contextPackId: "pack_test",
      context: "attachment details",
      sources: [{ label: "对话上传", filename: "reference.png" }],
      files: [{
        filename: "../reference.png",
        mime: "image/png",
        dataUrl: "data:image/png;base64,aGVsbG8=",
      }],
    });
    assert.equal(result.ok, true);
    assert.equal(result.contextChars, "attachment details".length);
    assert.equal(result.files.length, 1);
    assert.equal(path.dirname(result.files[0].path), packDir);
    assert.equal(result.files[0].filename, "reference.png");
    assert.equal(await readFile(result.files[0].path, "utf8"), "hello");
    assert.ok(result.storedBytes > 0);
    assert.ok(result.storeBytes >= result.storedBytes);

    const manifest = JSON.parse(await readFile(path.join(packDir, "manifest.json"), "utf8"));
    assert.equal(manifest.refId, refId);
    assert.equal(manifest.context, "attachment details");
    assert.equal(manifest.files[0].path, result.files[0].path);
    assert.ok(manifest.storedBytes > 0);
  });
});

test("accepts FileReader-style data URLs that include charset parameters", async () => {
  await withContextRoot(async () => {
    const refId = `ctx_test_${Date.now()}_charset`;
    const result = await putWodeAppContextPack({
      refId,
      sessionId: "ses_charset",
      files: [{
        filename: "photo.jpg",
        mime: "image/jpeg",
        dataUrl: "data:image/jpeg;charset=utf-8;base64,aGVsbG8=",
      }],
    });
    assert.equal(result.ok, true);
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].mime, "image/jpeg");
    assert.equal(await readFile(result.files[0].path, "utf8"), "hello");
  });
});

test("preserves Unicode display names and distinct paths for duplicate filenames", async () => {
  await withContextRoot(async () => {
    const refId = `ctx_test_${Date.now()}_unicode`;
    const result = await putWodeAppContextPack({
      refId,
      sessionId: "ses_unicode",
      files: [
        {
          filename: "报价单.pdf",
          mime: "application/pdf",
          dataUrl: "data:application/pdf;base64,JVBERg==",
        },
        {
          filename: "报价单.pdf",
          mime: "application/pdf",
          dataUrl: "data:application/pdf;base64,JVBERgE=",
        },
      ],
    });

    assert.equal(result.files.length, 2);
    assert.equal(result.files[0].originalFilename, "报价单.pdf");
    assert.equal(result.files[1].originalFilename, "报价单.pdf");
    assert.notEqual(result.files[0].path, result.files[1].path);
    assert.match(path.basename(result.files[0].path), /^01-/);
    assert.match(path.basename(result.files[1].path), /^02-/);
  });
});

test("deletes only attachment packs owned by the requested session", async () => {
  await withContextRoot(async () => {
    await putWodeAppContextPack({
      refId: "ctx_session_alpha_001",
      sessionId: "session-alpha",
      context: "alpha",
    });
    await putWodeAppContextPack({
      refId: "ctx_session_beta_0001",
      sessionId: "session-beta",
      context: "beta",
    });

    const result = await deleteWodeAppContextPacksForSession("session-alpha");
    assert.equal(result.deletedPacks, 1);
    assert.ok(result.freedBytes > 0);
    assert.equal(result.packs, 1);
    assert.equal((await getWodeAppContextPackStatus()).packs, 1);
  });
});

test("rejects writes beyond capacity without evicting existing packs", async () => {
  await withContextRoot(async () => {
    await putWodeAppContextPack({
      refId: "ctx_capacity_first_01",
      sessionId: "session-first",
      context: "a".repeat(600),
    });
    const before = await getWodeAppContextPackStatus();
    assert.equal(before.packs, 1);

    await assert.rejects(
      putWodeAppContextPack({
        refId: "ctx_capacity_second_1",
        sessionId: "session-second",
        context: "b".repeat(600),
      }),
      /storage is full/,
    );
    const after = await getWodeAppContextPackStatus();
    assert.equal(after.packs, 1);
    assert.equal(after.totalBytes, before.totalBytes);
  }, { maxBytes: 1_200 });
});

test("counts incomplete directories toward the hard capacity limit", async () => {
  await withContextRoot(async (root) => {
    const orphanDir = path.join(root, ".pending-interrupted-write");
    await mkdir(orphanDir, { recursive: true });
    await writeFile(path.join(orphanDir, "orphan.bin"), Buffer.alloc(900));

    await assert.rejects(
      putWodeAppContextPack({
        refId: "ctx_after_orphan_0001",
        sessionId: "session-after-orphan",
        context: "small context",
      }),
      /storage is full/,
    );
    const status = await getWodeAppContextPackStatus();
    assert.equal(status.packs, 1);
    assert.equal(status.totalBytes, 900);
  }, { maxBytes: 1_000 });
});

test("clears all attachment context packs explicitly", async () => {
  await withContextRoot(async () => {
    await putWodeAppContextPack({
      refId: "ctx_clear_all_test_01",
      sessionId: "session-clear",
      context: "clear me",
    });
    const result = await clearWodeAppContextPacks();
    assert.equal(result.deletedPacks, 1);
    assert.ok(result.freedBytes > 0);
    assert.equal(result.packs, 0);
    assert.equal((await getWodeAppContextPackStatus()).totalBytes, 0);
  });
});

test("rejects unsafe context references before writing", async () => {
  await withContextRoot(async () => {
    await assert.rejects(
      putWodeAppContextPack({
        refId: "../unsafe",
        context: "must not be written",
      }),
      /Invalid attachment context reference/,
    );
  });
});
