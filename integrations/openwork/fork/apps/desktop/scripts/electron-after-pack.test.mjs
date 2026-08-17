import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const afterPackPath = fileURLToPath(new URL("./electron-after-pack.cjs", import.meta.url));
const {
  normalizePackArch,
  targetTriple,
  materializeAliasOnly,
  resolvePackagedResourcesDir,
  asarHasEntry,
} = require(afterPackPath);

describe("electron-after-pack arch + sidecar prune", () => {
  it("normalizes electron-builder Arch enum numbers", () => {
    assert.equal(normalizePackArch(1), "x64");
    assert.equal(normalizePackArch(3), "arm64");
    assert.equal(normalizePackArch("arm64"), "arm64");
  });

  it("maps numeric arch to the correct target triple", () => {
    assert.equal(targetTriple("darwin", 3), "aarch64-apple-darwin");
    assert.equal(targetTriple("darwin", 1), "x86_64-apple-darwin");
    assert.equal(targetTriple("win32", 1), "x86_64-pc-windows-msvc");
    assert.equal(targetTriple("win32", "x64"), "x86_64-pc-windows-msvc");
    assert.equal(targetTriple("darwin", 4), null);
  });

  it("resolves the packaged Resources directory on macOS", () => {
    const dir = mkdtempSync(join(tmpdir(), "wodeappx-after-pack-resources-"));
    try {
      const appPath = join(dir, "WodeAppX.app");
      writeFileSync(join(dir, "placeholder"), "");
      require("node:fs").mkdirSync(join(appPath, "Contents", "Resources"), { recursive: true });
      assert.equal(
        resolvePackagedResourcesDir({
          electronPlatformName: "darwin",
          appOutDir: dir,
        }),
        join(appPath, "Contents", "Resources"),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("recognizes asar supervisor paths with or without a leading slash", () => {
    assert.equal(
      asarHasEntry(["/server/dist/opencode-plugins/wodeappx-scheduler-supervisor.js"], "server/dist/opencode-plugins/wodeappx-scheduler-supervisor.js"),
      true,
    );
    assert.equal(
      asarHasEntry(["electron/main.mjs"], "server/dist/opencode-plugins/wodeappx-scheduler-supervisor.js"),
      false,
    );
  });

  it("keeps only the alias and refuses a wrong-arch alias fallback", () => {
    const dir = mkdtempSync(join(tmpdir(), "wodeappx-after-pack-"));
    try {
      writeFileSync(join(dir, "opencode-aarch64-apple-darwin"), "arm-bin");
      writeFileSync(join(dir, "opencode"), "stale-other-arch");

      assert.equal(
        materializeAliasOnly(dir, "opencode-aarch64-apple-darwin", "opencode", { required: true }),
        true,
      );
      assert.equal(readFileSync(join(dir, "opencode"), "utf8"), "arm-bin");
      assert.equal(existsSync(join(dir, "opencode-aarch64-apple-darwin")), false);

      assert.throws(
        () => materializeAliasOnly(dir, "opencode-x86_64-apple-darwin", "opencode", { required: true }),
        /Missing packaged sidecar for target: opencode-x86_64-apple-darwin/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
