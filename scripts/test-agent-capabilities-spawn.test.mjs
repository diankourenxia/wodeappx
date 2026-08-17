import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

/**
 * Mirrors the Windows-safe spawn policy used by test-agent-capabilities.mjs.
 * On win32, .cmd/.bat and pnpm/npm/npx must use shell:true or CreateProcess returns EINVAL.
 */
function shouldUseShell(command) {
  return process.platform === "win32" && (
    /\.(cmd|bat)$/i.test(command)
    || command === "pnpm"
    || command === "npm"
    || command === "npx"
  );
}

test("windows shell policy enables shell for pnpm.cmd", () => {
  const original = process.platform;
  Object.defineProperty(process, "platform", { value: "win32" });
  try {
    assert.equal(shouldUseShell("pnpm.cmd"), true);
    assert.equal(shouldUseShell("pnpm"), true);
    assert.equal(shouldUseShell("node"), false);
    assert.equal(shouldUseShell(process.execPath), false);
  } finally {
    Object.defineProperty(process, "platform", { value: original });
  }
});

test("spawn helper can run a command via node without shell", () => {
  const result = spawnSync(process.execPath, ["-e", "process.exit(0)"], {
    stdio: "ignore",
    shell: false,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
});

test("windows-style cmd wrapper is spawnable with shell when present", () => {
  if (process.platform !== "win32") {
    // On non-Windows, verify the policy stays off for unix binaries.
    assert.equal(shouldUseShell("pnpm"), false);
    return;
  }
  const dir = mkdtempSync(join(tmpdir(), "wodeappx-spawn-"));
  const script = join(dir, "ok.cmd");
  try {
    writeFileSync(script, "@echo off\r\nexit /b 0\r\n");
    const withoutShell = spawnSync(script, [], { stdio: "ignore", shell: false });
    assert.ok(withoutShell.error, "expected EINVAL/ENOENT without shell");
    const withShell = spawnSync(script, [], { stdio: "ignore", shell: true });
    assert.equal(withShell.error, undefined);
    assert.equal(withShell.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
