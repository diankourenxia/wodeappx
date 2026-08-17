#!/usr/bin/env node
/**
 * Build macOS DMG/ZIP packages locally and optionally upload them to the
 * existing GitHub release for the current wodeappx version.
 *
 * Usage:
 *   pnpm release:macos
 *   pnpm release:macos -- --upload
 *   pnpm release:macos -- --skip-bootstrap
 */
import { spawnSync } from "node:child_process";
import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const vendor = path.join(root, "vendor/openwork");
const desktopDir = path.join(vendor, "apps/desktop");
const distDir = path.join(desktopDir, "dist-electron");
const releaseDir = path.join(root, "release");

const args = new Set(process.argv.slice(2));
const shouldUpload = args.has("--upload");
const skipBootstrap = args.has("--skip-bootstrap");

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, commandArgs, cwd = root, env = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} exited with ${result.status ?? "unknown"}`);
}

function runCapture(stdoutCommand, commandArgs, cwd = root) {
  const result = spawnSync(stdoutCommand, commandArgs, {
    cwd,
    encoding: "utf8",
    env: process.env,
  });
  if (result.error) fail(`${stdoutCommand} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    process.stderr.write(result.stderr || "");
    fail(`${stdoutCommand} exited with ${result.status ?? "unknown"}`);
  }
  return String(result.stdout || "").trim();
}

if (process.platform !== "darwin") {
  fail("release:macos must run on a macOS machine.");
}

const version = JSON.parse(
  await (await import("node:fs/promises")).readFile(path.join(root, "package.json"), "utf8"),
).version;
const releaseTag = `wodeappx-v${version}`;

if (!skipBootstrap) {
  run("pnpm", ["openwork:bootstrap"]);
  run("pnpm", ["openwork:patch"]);
  // Cloud patch wires desktop file bridge (absolute path → HTTPS upload) used by Agent tools.
  run("pnpm", ["openwork:patch-cloud"]);
  run("pnpm", ["openwork:install"]);
} else {
  console.log("skip bootstrap/patch/install (--skip-bootstrap)");
}

run("pnpm", ["release:check"]);
run("node", ["scripts/pack-self-evolve-source.mjs"]);
run("node", ["scripts/filter-local-brand-agents.mjs"]);
run("pnpm", ["--filter", "@openwork/desktop", "build:electron"], vendor, {
  VITE_DISABLE_OPENWORK_MODELS: "1",
});

const sidecarDir = path.join(desktopDir, "resources/sidecars");
// Prepare OpenCode/orchestrator (+ capture) for BOTH mac arches before
// electron-builder. afterPack keeps only the matching arch and drops the
// triple-named duplicate so Intel/ARM packages are correct and smaller.
for (const target of ["x86_64-apple-darwin", "aarch64-apple-darwin"]) {
  run(
    "node",
    ["scripts/prepare-sidecar.mjs", "--force", "--outdir", sidecarDir],
    desktopDir,
    { TARGET: target },
  );
  run("node", ["scripts/build-capture-engine.mjs"], root, { TARGET: target });
  run(
    "node",
    ["scripts/build-browser-native-host.mjs", "--target", target],
    root,
  );
}

run("node", ["scripts/build-local-speech-helper.mjs"]);
run("node", ["scripts/make-macos-computer-use-universal.mjs"]);

run(
  "pnpm",
  ["exec", "electron-builder", "--config", "electron-builder.yml", "--mac", "--x64", "--arm64", "--publish", "never"],
  desktopDir,
);

await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });

const distFiles = await readdir(distDir);
const copied = [];
for (const name of distFiles) {
  const keep =
    name.startsWith("wodeappx-")
    || name.endsWith(".blockmap")
    || name.endsWith(".yml")
    || name.endsWith(".yaml");
  if (!keep) continue;
  await cp(path.join(distDir, name), path.join(releaseDir, name));
  copied.push(name);
}

if (!copied.length) fail(`No macOS installers found in ${path.relative(root, distDir)}`);

console.log("");
console.log(`macOS packages ready for ${releaseTag}:`);
for (const name of copied.sort()) {
  console.log(`  - ${path.join("release", name)}`);
}

if (!shouldUpload) {
  console.log("");
  console.log("Upload later with:");
  console.log(`  pnpm release:macos -- --skip-bootstrap --upload`);
  console.log(`  # or: gh release upload ${releaseTag} release/* --clobber`);
  process.exit(0);
}

const releaseView = spawnSync("gh", ["release", "view", releaseTag], {
  cwd: root,
  encoding: "utf8",
  env: process.env,
});
if (releaseView.status !== 0) {
  const create = spawnSync(
    "gh",
    [
      "release",
      "create",
      releaseTag,
      ...copied.map((name) => path.join(releaseDir, name)),
      "--title",
      `WodeAppX ${version}`,
      "--notes",
      "macOS packages built locally; Windows packages come from GitHub Actions.",
      "--verify-tag",
    ],
    { cwd: root, stdio: "inherit", env: process.env },
  );
  if (create.status !== 0) fail(`Failed to create GitHub release ${releaseTag}`);
} else {
  run("gh", ["release", "upload", releaseTag, ...copied.map((name) => path.join(releaseDir, name)), "--clobber"]);
}

const url = runCapture("gh", ["release", "view", releaseTag, "--json", "url", "--jq", ".url"]);
console.log("");
console.log(`Uploaded macOS assets to ${url}`);
