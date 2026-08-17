#!/usr/bin/env node
/**
 * Build a WodeAppX-branded macOS test package that still wires Cloud bootstrap
 * so default ability projects exist on first launch.
 *
 * Usage:
 *   pnpm release:macos:oss
 *   pnpm release:macos:oss -- --skip-bootstrap
 */
import { spawnSync } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const vendor = path.join(root, "vendor/openwork");
const desktopDir = path.join(vendor, "apps/desktop");
const distDir = path.join(desktopDir, "dist-electron");
const releaseDir = path.join(root, "release");
const ossReleaseDir = path.join(root, "release-oss");

const args = new Set(process.argv.slice(2));
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

if (process.platform !== "darwin") {
  fail("release:macos:oss must run on macOS.");
}

const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = pkg.version;

if (!skipBootstrap) {
  run("pnpm", ["openwork:bootstrap"]);
  run("pnpm", ["openwork:patch"]);
  run("pnpm", ["openwork:patch-cloud"]);
  run("pnpm", ["openwork:install"]);
} else {
  console.log("skip bootstrap/patch/install (--skip-bootstrap)");
}

run("node", ["scripts/apply-oss-product-brand.mjs"]);
run("node", ["scripts/filter-local-brand-agents.mjs"]);
run("node", ["scripts/pack-self-evolve-source.mjs"]);
run("node", ["scripts/generate-license-inventory.mjs"]);
run("pnpm", ["release:smoke-electron"]);

run("pnpm", ["--filter", "@openwork/desktop", "build:electron"], vendor, {
  VITE_DISABLE_OPENWORK_MODELS: "1",
  WODEAPPX_EDITION: "oss",
  VITE_WODEAPPX_EDITION: "oss",
  OPENWORK_ELECTRON_APP_NAME: "WodeAppX",
});

const sidecarDir = path.join(desktopDir, "resources/sidecars");
const macTargets = process.env.WODEAPPX_OSS_MAC_TARGETS?.split(",").map((s) => s.trim()).filter(Boolean)
  ?? ["aarch64-apple-darwin", "x86_64-apple-darwin"];
const electronBuilderArchArgs = macTargets.includes("x86_64-apple-darwin") && macTargets.includes("aarch64-apple-darwin")
  ? ["--x64", "--arm64"]
  : macTargets.includes("x86_64-apple-darwin")
    ? ["--x64"]
    : ["--arm64"];

for (const target of macTargets) {
  run(
    "node",
    ["scripts/prepare-sidecar.mjs", "--force", "--outdir", sidecarDir],
    desktopDir,
    { TARGET: target },
  );
  run("node", ["scripts/build-capture-engine.mjs"], root, { TARGET: target });
  run("node", ["scripts/build-browser-native-host.mjs", "--target", target], root);
}

run("node", ["scripts/build-local-speech-helper.mjs"]);
run("node", ["scripts/make-macos-computer-use-universal.mjs"]);

// Clean previous electron-builder output so we only pick up this version.
await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

run(
  "pnpm",
  ["exec", "electron-builder", "--config", "electron-builder.yml", "--mac", ...electronBuilderArchArgs, "--publish", "never"],
  desktopDir,
  { OPENWORK_ELECTRON_APP_NAME: "WodeAppX" },
);

await mkdir(ossReleaseDir, { recursive: true });
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
  if (!name.includes(version) && name.startsWith("wodeappx-")) {
    console.warn(`[oss-release] skip unexpected artifact ${name}`);
    continue;
  }
  const ossName = name.includes(version)
    ? name.replace(version, `${version}-oss`)
    : name.replace(/(\.ya?ml)$/i, `-oss$1`);
  await cp(path.join(distDir, name), path.join(ossReleaseDir, ossName));
  // Also place in release/ for convenience, without wiping commercial artifacts.
  await cp(path.join(distDir, name), path.join(releaseDir, ossName));
  copied.push(ossName);
}

if (!copied.length) fail(`No macOS installers found in ${path.relative(root, distDir)}`);

await writeFile(
  path.join(ossReleaseDir, `wodeappx-oss-${version}.json`),
  `${JSON.stringify({
    version,
    brand: "WodeAppX",
    builtAt: new Date().toISOString(),
    artifacts: copied.sort(),
    notes: [
      "Test package: WodeAppX brand + Cloud ability-project bootstrap",
      "Default local OpenWork workspace on first launch",
      "desktop-embedded-bootstrap creates WodeApp ability projects",
      "Brand agents filtered out of installer (use ~/.wodeapp/brand-agents.json locally)",
      "Bundled filtered monorepo source extracted on first launch into 「项目」/wodeapp（自进化）",
      "Prefers local http://127.0.0.1:3000 when healthy",
      "Full local SQLite mainserver embed is not bundled yet",
    ],
  }, null, 2)}\n`,
);
await cp(
  path.join(ossReleaseDir, `wodeappx-oss-${version}.json`),
  path.join(releaseDir, `wodeappx-oss-${version}.json`),
);

console.log("");
console.log(`OSS macOS packages ready for ${version}:`);
for (const name of copied.sort()) {
  console.log(`  - ${path.join("release-oss", name)}`);
}
console.log(`[oss-release] also mirrored under release/`);
