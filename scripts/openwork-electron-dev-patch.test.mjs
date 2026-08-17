import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  MACOS_HELPER_MARKER,
  repairElectronDevMacosHelperDuplicates,
} from "./openwork-electron-dev-patch.mjs";

const helper = `function runPlistBuddy(command, plistPath) {
  return Boolean(command && plistPath);
}

function setPlistString(plistPath, key, value) {
  return runPlistBuddy(key, plistPath) && Boolean(value);
}

function registerAppBundle(appPath) {
  return appPath;
}

function pathExistsNoFollow(targetPath) {
  return Boolean(targetPath);
}

function prepareElectronDevBundleName() {
  return true;
}

`;

const needsShell = `function needsShell(command) {
  return process.platform === "win32" && /\\.(cmd|bat)$/i.test(command);
}
`;

function assertValidJavaScript(content) {
  const result = spawnSync(process.execPath, ["--check", "-"], {
    encoding: "utf8",
    input: content,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("repairs duplicate macOS helpers and produces valid JavaScript", () => {
  const damaged = `${helper}${helper}${needsShell}`;
  const result = repairElectronDevMacosHelperDuplicates(damaged);

  assert.equal(result.changed, true);
  assert.equal(result.content.split(MACOS_HELPER_MARKER).length - 1, 1);
  assertValidJavaScript(result.content);
});

test("is idempotent after duplicate macOS helpers are repaired", () => {
  const first = repairElectronDevMacosHelperDuplicates(`${helper}${helper}${needsShell}`);
  const second = repairElectronDevMacosHelperDuplicates(first.content);

  assert.equal(second.changed, false);
  assert.equal(second.content, first.content);
});

test("keeps one existing macOS helper unchanged", () => {
  const current = `${helper}${needsShell}`;
  const result = repairElectronDevMacosHelperDuplicates(current);

  assert.equal(result.changed, false);
  assert.equal(result.content, current);
});

test("fails closed instead of deleting unrelated declarations", () => {
  const unsafe = `${helper}function userOwnedHelper() {}\n\n${helper}${needsShell}`;

  assert.throws(
    () => repairElectronDevMacosHelperDuplicates(unsafe),
    /could not safely repair duplicate macOS helpers/,
  );
});
