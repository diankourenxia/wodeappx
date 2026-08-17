import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { MACOS_HELPER_MARKER } from "./openwork-electron-dev-patch.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const wodeappxRoot = path.dirname(scriptsDir);
const patchScript = path.join(scriptsDir, "apply-openwork-integration.mjs");
const electronDevScript = path.join(
  wodeappxRoot,
  "vendor",
  "openwork",
  "apps",
  "desktop",
  "scripts",
  "electron-dev.mjs",
);
const sessionRouteSourcePath = path.join(
  wodeappxRoot,
  "vendor",
  "openwork",
  "apps",
  "app",
  "src",
  "react-app",
  "shell",
  "session-route.tsx",
);

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: wodeappxRoot,
    encoding: "utf8",
    stdio: "pipe",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}

run(process.execPath, [patchScript]);
run(process.execPath, [patchScript]);
run(process.execPath, ["--check", electronDevScript]);

const electronDevSource = await readFile(electronDevScript, "utf8");
const helperCount = electronDevSource.split(MACOS_HELPER_MARKER).length - 1;
assert.equal(helperCount, 1, `expected one macOS helper, received ${helperCount}`);

const sessionRouteSource = await readFile(sessionRouteSourcePath, "utf8");
assert.equal(
  sessionRouteSource.includes("tools: capabilityRoute.tools"),
  false,
  "session prompt must not persist the per-turn capability visibility map as permissions",
);
assert.match(
  sessionRouteSource,
  /Tool visibility is resolved inside the patched OpenCode loop\./,
  "session prompt should document that OpenCode owns dynamic tool visibility",
);

const electronBuilderSource = await readFile(
  path.join(wodeappxRoot, "vendor", "openwork", "apps", "desktop", "electron-builder.yml"),
  "utf8",
);
assert.equal(
  electronBuilderSource.split("to: built-in-skills").length - 1,
  1,
  "electron-builder extraResources must pack built-in-skills once (Linux EEXIST)",
);

console.log("OpenWork patch idempotency passed: two applies + electron-dev syntax check.");
