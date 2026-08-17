import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import test from "node:test";

import { ensureWorkingTreeGit, findMonorepoRoot, cmdOverlaySync, versionPathspecs } from "./self-evolve-guard.mjs";

function canonicalPath(p) {
  let resolved = p;
  try {
    resolved = realpathSync.native(p);
  } catch {
    resolved = realpathSync(p);
  }
  return resolved.replaceAll("\\", "/").replace(/\/+$/, "").toLowerCase();
}

function sameDir(a, b) {
  const left = canonicalPath(a);
  const right = canonicalPath(b);
  if (left === right) return true;
  return path.basename(left) === path.basename(right);
}

test("findMonorepoRoot uses parent when AGENTS.md + wodeappx exist", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wodeappx-se-mono-"));
  try {
    writeFileSync(path.join(dir, "AGENTS.md"), "# test\n");
    mkdirSync(path.join(dir, "wodeappx"));
    assert.equal(findMonorepoRoot(path.join(dir, "wodeappx")), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ensureWorkingTreeGit seeds a local repo so snapshot can run without a clone", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wodeappx-se-seed-"));
  try {
    writeFileSync(path.join(dir, "AGENTS.md"), "# test\n");
    mkdirSync(path.join(dir, "wodeappx"));
    writeFileSync(path.join(dir, "wodeappx", "package.json"), "{\"name\":\"wodeappx\"}\n");
    const first = ensureWorkingTreeGit(dir);
    assert.equal(first.inited, true);
    const second = ensureWorkingTreeGit(dir);
    assert.equal(second.inited, false);
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: path.join(dir, "wodeappx"),
      encoding: "utf8",
    }).trim();
    // Windows CI may mix 8.3 short paths (C:\Users\RUNNER~1) with the long form.
    assert.ok(
      sameDir(top, dir),
      `git toplevel ${top} should resolve to seeded tree ${dir}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("versionPathspecs skips include paths missing from an OSS extract", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wodeappx-se-pathspec-"));
  try {
    mkdirSync(path.join(dir, "scripts"));
    writeFileSync(path.join(dir, "package.json"), "{\"name\":\"wodeappx\"}\n");
    const specs = versionPathspecs(dir);
    assert.ok(specs.includes("scripts"));
    assert.ok(specs.includes("package.json"));
    assert.ok(!specs.includes("native"));
    assert.ok(!specs.includes("vendor/openwork"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("overlay sync copies skin css into local overlay dirs", () => {
  const dest = mkdtempSync(path.join(tmpdir(), "wodeappx-se-overlay-"));
  try {
    const report = cmdOverlaySync({ destDirs: [dest] });
    assert.equal(report.ok, true);
    assert.ok(report.files >= 1);
    assert.ok(existsSync(path.join(dest, "wodeapp-skin-cute-pastel.css")));
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
});
