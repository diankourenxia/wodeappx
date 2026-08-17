import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveMissingOpenPath } from "./open-path-resolver.mjs";

test("resolves a missing workspace path to the newest matching OpenCode output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wodeappx-open-path-"));
  try {
    const older = path.join(root, "older", "renders", "demo.mp4");
    const newer = path.join(root, "newer", "renders", "demo.mp4");
    await mkdir(path.dirname(older), { recursive: true });
    await mkdir(path.dirname(newer), { recursive: true });
    await writeFile(older, "older");
    await writeFile(newer, "newer");
    await utimes(older, new Date(1_000), new Date(1_000));
    await utimes(newer, new Date(2_000), new Date(2_000));

    const resolved = await resolveMissingOpenPath(
      path.join(root, "default-workspace", "demo.mp4"),
      { searchRoots: [root] },
    );

    assert.equal(resolved, newer);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps an existing absolute path unchanged", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wodeappx-open-path-existing-"));
  try {
    const target = path.join(root, "video.mp4");
    await writeFile(target, "video");
    assert.equal(await resolveMissingOpenPath(target, { searchRoots: [] }), target);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("expands ~/ paths before existence checks", async () => {
  const homeFile = path.join(os.homedir(), ".wodeapp-open-path-resolver-test");
  try {
    await writeFile(homeFile, "ok");
    const resolved = await resolveMissingOpenPath(`~/${path.basename(homeFile)}`, { searchRoots: [] });
    assert.equal(resolved, homeFile);
  } finally {
    await rm(homeFile, { force: true });
  }
});

test("rejects optimistic:// and workspace-joined fake schemes", async () => {
  const { expandUserPath } = await import("./open-path-resolver.mjs");
  assert.equal(expandUserPath("optimistic://attachment/clip.mp4"), "");
  assert.equal(
    expandUserPath("/Users/test/.wodeapp/projects/supor/optimistic://attachment/clip.mp4"),
    "",
  );
  assert.equal(
    await resolveMissingOpenPath(
      "/Users/test/.wodeapp/projects/supor/optimistic://attachment/clip.mp4",
      { searchRoots: [] },
    ),
    null,
  );
});

test("never resolves bare clipboard image.png to Downloads by basename", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wodeappx-open-path-generic-"));
  const emptyPacks = await mkdtemp(path.join(os.tmpdir(), "wodeappx-open-path-empty-packs-"));
  const prev = process.env.WODEAPPX_ATTACHMENT_CONTEXT_ROOT;
  process.env.WODEAPPX_ATTACHMENT_CONTEXT_ROOT = emptyPacks;
  try {
    const downloads = path.join(root, "Downloads");
    await mkdir(downloads, { recursive: true });
    const decoy = path.join(downloads, "image.png");
    await writeFile(decoy, "wrong-image");
    assert.equal(
      await resolveMissingOpenPath("image.png", { searchRoots: [downloads] }),
      null,
    );
    assert.equal(
      await resolveMissingOpenPath(decoy, { searchRoots: [downloads] }),
      decoy,
    );
  } finally {
    if (prev === undefined) delete process.env.WODEAPPX_ATTACHMENT_CONTEXT_ROOT;
    else process.env.WODEAPPX_ATTACHMENT_CONTEXT_ROOT = prev;
    await rm(root, { recursive: true, force: true });
    await rm(emptyPacks, { recursive: true, force: true });
  }
});

test("resolves paste-* chat attachments from attachment-context-packs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wodeappx-open-path-pack-"));
  const prev = process.env.WODEAPPX_ATTACHMENT_CONTEXT_ROOT;
  process.env.WODEAPPX_ATTACHMENT_CONTEXT_ROOT = root;
  try {
    const packDir = path.join(root, "ctx_testpack");
    await mkdir(packDir, { recursive: true });
    const packed = path.join(packDir, "01-paste-20260805022400-2282f8f8.png");
    await writeFile(packed, "paste-bytes");
    assert.equal(
      await resolveMissingOpenPath("paste-20260805022400-2282f8f8.png", { searchRoots: [] }),
      packed,
    );
  } finally {
    if (prev === undefined) delete process.env.WODEAPPX_ATTACHMENT_CONTEXT_ROOT;
    else process.env.WODEAPPX_ATTACHMENT_CONTEXT_ROOT = prev;
    await rm(root, { recursive: true, force: true });
  }
});

test("resolves a bare filename from Downloads-like search roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wodeappx-open-path-bare-"));
  try {
    const downloads = path.join(root, "Downloads");
    const workspace = path.join(root, "wodeapp");
    const target = path.join(downloads, "taiping-led-wall-6780x756.mp4");
    await mkdir(downloads, { recursive: true });
    await mkdir(workspace, { recursive: true });
    await writeFile(target, "video");

    const resolved = await resolveMissingOpenPath("taiping-led-wall-6780x756.mp4", {
      searchRoots: [workspace, downloads],
    });
    assert.equal(resolved, target);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("prefers a direct Downloads hit before deep workspace scanning", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wodeappx-open-path-direct-"));
  try {
    const downloads = path.join(root, "Downloads");
    const nested = path.join(root, "wodeapp", "deep", "nested");
    await mkdir(downloads, { recursive: true });
    await mkdir(nested, { recursive: true });
    const preferred = path.join(downloads, "clip.mp4");
    const older = path.join(nested, "clip.mp4");
    await writeFile(preferred, "new");
    await writeFile(older, "old");
    await utimes(older, new Date(1_000), new Date(1_000));
    await utimes(preferred, new Date(2_000), new Date(2_000));

    const resolved = await resolveMissingOpenPath("clip.mp4", {
      searchRoots: [path.join(root, "wodeapp"), downloads],
    });
    assert.equal(resolved, preferred);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
