import assert from "node:assert/strict";
import test from "node:test";

import { resolveOcuDistPath, resolveTarInvocation, toMsysPath } from "./prepare-open-computer-use-helper.mjs";

test("resolveOcuDistPath maps windows and linux arches", () => {
  assert.deepEqual(resolveOcuDistPath("win32", "x64"), {
    packagePath: "package/dist/windows/amd64/open-computer-use.exe",
    outputName: "open-computer-use.exe",
  });
  assert.deepEqual(resolveOcuDistPath("windows", "arm64"), {
    packagePath: "package/dist/windows/arm64/open-computer-use.exe",
    outputName: "open-computer-use.exe",
  });
  assert.deepEqual(resolveOcuDistPath("linux", "x64"), {
    packagePath: "package/dist/linux/amd64/open-computer-use",
    outputName: "open-computer-use",
  });
});

test("resolveOcuDistPath rejects darwin and unknown arch", () => {
  assert.throws(() => resolveOcuDistPath("darwin", "arm64"), /win32\/linux only/);
  assert.throws(() => resolveOcuDistPath("linux", "ia32"), /Unsupported arch/);
});

test("toMsysPath rewrites Windows drive letters for Git Bash tar", () => {
  assert.equal(toMsysPath("C:\\Users\\runner\\Temp\\ocu.tgz"), "/c/Users/runner/Temp/ocu.tgz");
  assert.match(toMsysPath("/tmp/ocu.tgz"), /ocu\.tgz$/);
});

test("resolveTarInvocation prefers System32 tar on win32 when present", () => {
  const inv = resolveTarInvocation(
    "C:\\Users\\runner\\a.tgz",
    "C:\\Users\\runner\\out",
    "package/dist/windows/amd64/open-computer-use.exe",
    "win32",
  );
  assert.equal(inv.args[0], "-xzf");
  assert.equal(inv.args.at(-1), "package/dist/windows/amd64/open-computer-use.exe");
  if (inv.command.endsWith("tar.exe")) {
    assert.match(inv.args[1], /a\.tgz$/);
  } else {
    assert.equal(inv.command, "tar");
    assert.equal(inv.args[1], "/c/Users/runner/a.tgz");
    assert.equal(inv.args[3], "/c/Users/runner/out");
  }
});

test("resolveTarInvocation keeps plain tar on non-Windows", () => {
  const inv = resolveTarInvocation("/tmp/a.tgz", "/tmp/out", "package/x", "darwin");
  assert.deepEqual(inv, {
    command: "tar",
    args: ["-xzf", "/tmp/a.tgz", "-C", "/tmp/out", "package/x"],
  });
});
