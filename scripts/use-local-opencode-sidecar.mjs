#!/usr/bin/env node
/**
 * Dev fallback for slow GitHub sidecar downloads.
 *
 * Copies an existing OpenCode CLI binary into OpenWork's Electron sidecar
 * directory so the dev script can run with OPENWORK_ELECTRON_SKIP_SHARED_PREPARE=1.
 */
import { constants } from "node:fs";
import { access, chmod, copyFile, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const sidecarDir = path.join(root, "vendor/openwork/apps/desktop/resources/sidecars");

function targetTriple() {
  if (process.platform === "darwin") return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  if (process.platform === "linux") return process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
  if (process.platform === "win32") return process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  return null;
}

function commandPath(command) {
  const shell = process.platform === "win32" ? "where" : "sh";
  const args = process.platform === "win32" ? [command] : ["-lc", `command -v ${command}`];
  const result = spawnSync(shell, args, { encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
}

async function assertExecutable(filePath) {
  await access(filePath, constants.X_OK);
}

async function main() {
  const source = process.env.OPENCODE_BIN?.trim() || commandPath("opencode");
  if (!source) {
    throw new Error("OpenCode CLI not found. Install it or set OPENCODE_BIN=/path/to/opencode.");
  }
  await assertExecutable(source);

  const triple = targetTriple();
  const isWindows = process.platform === "win32";
  const baseName = isWindows ? "opencode.exe" : "opencode";
  const names = new Set([baseName]);
  if (triple) names.add(`opencode-${triple}${isWindows ? ".exe" : ""}`);

  await mkdir(sidecarDir, { recursive: true });
  for (const name of names) {
    const dest = path.join(sidecarDir, name);
    await copyFile(source, dest);
    if (!isWindows) await chmod(dest, 0o755);
    console.log(`Copied ${source} -> ${dest}`);
  }

  const version = spawnSync(source, ["--version"], { encoding: "utf8" }).stdout?.trim();
  if (version) console.log(`OpenCode version: ${version}`);
  console.log("Run: pnpm openwork:dev:local-sidecar");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
