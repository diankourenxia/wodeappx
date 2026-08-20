import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const applySrc = readFileSync(join(root, "scripts/apply-openwork-integration.mjs"), "utf8");
const statePath = join(
  root,
  "vendor/openwork/apps/app/src/react-app/domains/settings/state/electron-updater-state.ts",
);

test("apply script skips OpenWork Den so WodeAppX 1.x feed updates stay visible", () => {
  assert.match(applySrc, /applyWodeappxFeedUpdateGatePatch/);
  assert.match(applySrc, /availableAllowed = Boolean\(result\.available\)/);
  assert.match(applySrc, /WodeAppX ships 1\.x from wodeapp\.cn/);
});

test("vendor settings updater trusts the packaged feed when present", () => {
  if (!existsSync(statePath)) {
    return;
  }
  const src = readFileSync(statePath, "utf8");
  assert.match(src, /availableAllowed = Boolean\(result\.available\)/);
  assert.doesNotMatch(src, /await isUpdateAllowed\(/);
  assert.doesNotMatch(src, /await isAlphaUpdateAllowed\(/);
});
