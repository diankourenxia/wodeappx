#!/usr/bin/env node
/**
 * Rebuild the HandsFree Computer Use helper as a universal (arm64 + x86_64)
 * binary so electron-builder can sign both Mac chip packages.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const packagePath = join(root, "vendor/openwork/packages/handsfree/native/HandsFree");
const helperApps = [
  join(root, "vendor/openwork/apps/desktop/resources/helpers/OpenWork Computer Use.app"),
  join(root, "apps/desktop/resources/helpers/OpenWork Computer Use.app"),
];
const helperApp = helperApps[0];
const executablePath = join(helperApp, "Contents/MacOS/ComputerUse");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    cwd: options.cwd,
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
  }
  return result;
}

if (process.platform !== "darwin") {
  process.stdout.write(`${JSON.stringify({ ok: true, skipped: true, reason: "macOS-only" })}\n`);
  process.exit(0);
}
if (!existsSync(packagePath)) {
  throw new Error(`HandsFree package missing: ${packagePath}`);
}

run("swift", [
  "build",
  "--package-path",
  packagePath,
  "-c",
  "release",
  "--product",
  "HandsFreeComputerUse",
  "--arch",
  "arm64",
  "--arch",
  "x86_64",
], { stdio: "inherit" });

const candidates = [
  join(packagePath, ".build/apple/Products/Release/HandsFreeComputerUse"),
  join(packagePath, ".build/release/HandsFreeComputerUse"),
];
const built = candidates.find((p) => existsSync(p));
if (!built) {
  throw new Error(`Universal HandsFree binary not found. Looked in:\n${candidates.join("\n")}`);
}

for (const appPath of helperApps) {
  if (!existsSync(appPath)) continue;
  const dest = join(appPath, "Contents/MacOS/ComputerUse");
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(built, dest);
  chmodSync(dest, 0o755);
  run("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
}
if (!existsSync(executablePath)) {
  throw new Error(`Computer Use helper app missing: ${helperApp}`);
}

const lipo = run("lipo", ["-info", executablePath]);
process.stdout.write(`${JSON.stringify({ ok: true, executablePath, lipo: lipo.stdout.trim() }, null, 2)}\n`);
