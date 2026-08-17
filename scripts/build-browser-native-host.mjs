#!/usr/bin/env node

import { copyFile, mkdir, chmod } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const manifestPath = path.join(
  root,
  "integrations/browser-control/native-host/Cargo.toml",
);
const defaultOutDir = path.join(
  root,
  "vendor/openwork/apps/desktop/resources/native-hosts",
);

function fail(message) {
  console.error(`[browser-native-host] ${message}`);
  process.exit(1);
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}

function targetFor(platform = process.platform, arch = process.arch) {
  if (platform === "darwin") {
    if (arch === "arm64") return "aarch64-apple-darwin";
    if (arch === "x64") return "x86_64-apple-darwin";
  }
  if (platform === "linux") {
    if (arch === "arm64") return "aarch64-unknown-linux-gnu";
    if (arch === "x64") return "x86_64-unknown-linux-gnu";
  }
  if (platform === "win32") {
    if (arch === "arm64") return "aarch64-pc-windows-msvc";
    if (arch === "x64") return "x86_64-pc-windows-msvc";
  }
  return null;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    stdio: options.capture ? "pipe" : "inherit",
    encoding: options.capture ? "utf8" : undefined,
    env: process.env,
  });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    if (options.capture) {
      process.stderr.write(result.stderr || "");
    }
    fail(`${command} exited with ${result.status ?? "unknown"}`);
  }
  return options.capture ? String(result.stdout || "") : "";
}

function ensureRustTarget(target) {
  const installed = run("rustup", ["target", "list", "--installed"], { capture: true })
    .split(/\r?\n/)
    .map((line) => line.trim());
  if (!installed.includes(target)) {
    run("rustup", ["target", "add", target]);
  }
}

const target = valueAfter("--target") || process.env.TARGET || targetFor();
if (!target) {
  fail(`unsupported build platform: ${process.platform}/${process.arch}`);
}

const outDir = path.resolve(valueAfter("--outdir") || defaultOutDir);
const executableSuffix = target.includes("windows") ? ".exe" : "";
const binaryName = `wodeappx-browser-native-host${executableSuffix}`;
const builtPath = path.join(
  root,
  "integrations/browser-control/native-host/target",
  target,
  "release",
  binaryName,
);
const targetPath = path.join(
  outDir,
  `wodeappx-browser-native-host-${target}${executableSuffix}`,
);
const aliasPath = path.join(outDir, binaryName);

ensureRustTarget(target);
run("cargo", [
  "build",
  "--release",
  "--locked",
  "--target",
  target,
  "--manifest-path",
  manifestPath,
]);

await mkdir(outDir, { recursive: true });
await copyFile(builtPath, targetPath);
if (!executableSuffix) {
  await chmod(targetPath, 0o755);
}

const currentTarget = targetFor();
if (target === currentTarget) {
  await copyFile(targetPath, aliasPath);
  if (!executableSuffix) {
    await chmod(aliasPath, 0o755);
  }
}

console.log(
  JSON.stringify(
    {
      ok: true,
      target,
      output: path.relative(root, targetPath),
      alias: target === currentTarget ? path.relative(root, aliasPath) : null,
    },
    null,
    2,
  ),
);
