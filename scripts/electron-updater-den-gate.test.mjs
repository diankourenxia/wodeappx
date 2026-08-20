import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const applySrc = readFileSync(join(root, "scripts/apply-openwork-integration.mjs"), "utf8");

test("apply script skips OpenWork Den so WodeAppX 1.x feed updates stay visible", () => {
  assert.match(applySrc, /applyWodeappxFeedUpdateGatePatch/);
  assert.match(applySrc, /availableAllowed = Boolean\(result\.available\)/);
  assert.match(applySrc, /WodeAppX ships 1\.x from wodeapp\.cn/);
});
