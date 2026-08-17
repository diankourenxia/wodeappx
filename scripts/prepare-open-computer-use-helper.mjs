#!/usr/bin/env node
/**
 * Stage open-computer-use platform binaries into Electron helpers/
 * for Windows/Linux Computer Use packaging.
 *
 * Usage:
 *   node scripts/prepare-open-computer-use-helper.mjs
 *   node scripts/prepare-open-computer-use-helper.mjs --platform win32 --arch x64 --force
 *   node scripts/prepare-open-computer-use-helper.mjs --outdir path/to/helpers
 */
import { chmodSync, copyFileSync, createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const DEFAULT_VERSION = process.env.WODEAPPX_OPEN_COMPUTER_USE_VERSION?.trim() || "0.2.1";

function readArg(name) {
  const raw = process.argv.slice(2);
  const direct = raw.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = raw.indexOf(name);
  if (index >= 0 && raw[index + 1]) return raw[index + 1];
  return null;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

export function resolveOcuDistPath(platform, arch) {
  const normalizedArch = arch === "x64" || arch === "amd64" ? "amd64"
    : arch === "arm64" ? "arm64"
      : null;
  if (!normalizedArch) {
    throw new Error(`Unsupported arch for open-computer-use helper: ${arch}`);
  }
  if (platform === "win32" || platform === "windows") {
    return {
      packagePath: `package/dist/windows/${normalizedArch}/open-computer-use.exe`,
      outputName: "open-computer-use.exe",
    };
  }
  if (platform === "linux") {
    return {
      packagePath: `package/dist/linux/${normalizedArch}/open-computer-use`,
      outputName: "open-computer-use",
    };
  }
  throw new Error(`open-computer-use helper packaging is for win32/linux only (got ${platform})`);
}

/**
 * Git Bash / MSYS `tar` treats `C:\...` as host `C`. Prefer Windows bsdtar, else
 * rewrite absolute paths to `/c/...` for MSYS-compatible extraction.
 */
export function resolveTarInvocation(tarball, workDir, packagePath, platform = process.platform) {
  const argsBase = (archive, outDir) => ["-xzf", archive, "-C", outDir, packagePath];
  if (platform !== "win32") {
    return { command: "tar", args: argsBase(tarball, workDir) };
  }
  const systemTar = join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  if (existsSync(systemTar)) {
    return { command: systemTar, args: argsBase(tarball, workDir) };
  }
  return {
    command: "tar",
    args: argsBase(toMsysPath(tarball), toMsysPath(workDir)),
  };
}

export function toMsysPath(value) {
  const raw = String(value);
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(raw);
  if (drive) {
    return `/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, "/")}`;
  }
  const abs = resolve(raw);
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(abs);
  if (!match) return abs.replace(/\\/g, "/");
  return `/${match[1].toLowerCase()}/${match[2].replace(/\\/g, "/")}`;
}

export function defaultHelperOutDirs() {
  return [
    join(root, "vendor", "openwork", "apps", "desktop", "resources", "helpers"),
    join(root, "apps", "desktop", "resources", "helpers"),
  ];
}

async function downloadTarball(version, destFile) {
  const url = `https://registry.npmjs.org/open-computer-use/-/open-computer-use-${version}.tgz`;
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(destFile));
}

async function main() {
  const platform = (readArg("--platform") || process.platform).toLowerCase();
  const arch = readArg("--arch") || process.arch;
  const force = hasFlag("--force") || process.env.WODEAPPX_OPEN_COMPUTER_USE_FORCE === "1";
  const version = readArg("--version") || DEFAULT_VERSION;
  const explicitOut = readArg("--outdir");

  if (platform === "darwin") {
    process.stdout.write(`${JSON.stringify({ ok: true, skipped: true, reason: "macOS uses HandsFree helper" }, null, 2)}\n`);
    return;
  }

  const { packagePath, outputName } = resolveOcuDistPath(platform, arch);
  const outDirs = explicitOut ? [resolve(explicitOut)] : defaultHelperOutDirs();
  const primaryOut = join(outDirs[0], outputName);

  if (!force && existsSync(primaryOut)) {
    process.stdout.write(`${JSON.stringify({ ok: true, skipped: true, binary: primaryOut, version }, null, 2)}\n`);
    return;
  }

  const workDir = join(tmpdir(), `wodeappx-ocu-${version}-${process.pid}`);
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  const tarball = join(workDir, "open-computer-use.tgz");

  try {
    await downloadTarball(version, tarball);
    const { size } = await import("node:fs/promises").then((fs) => fs.stat(tarball));
    if (!size || size < 1024) {
      throw new Error(`Downloaded open-computer-use tarball looks empty (${size} bytes)`);
    }
    const { command, args } = resolveTarInvocation(tarball, workDir, packagePath);
    execFileSync(command, args, { stdio: "pipe" });
    const nested = join(workDir, ...packagePath.split("/"));
    if (!existsSync(nested)) {
      throw new Error(`Extracted path missing: ${nested}`);
    }

    const staged = [];
    for (const outDir of outDirs) {
      mkdirSync(outDir, { recursive: true });
      const dest = join(outDir, outputName);
      copyFileSync(nested, dest);
      if (platform !== "win32" && platform !== "windows") {
        chmodSync(dest, 0o755);
      }
      writeFileSync(join(outDir, "open-computer-use.version.json"), `${JSON.stringify({
        version,
        platform,
        arch,
        packagePath,
        preparedAt: new Date().toISOString(),
      }, null, 2)}\n`);
      staged.push(dest);
    }

    process.stdout.write(`${JSON.stringify({ ok: true, version, platform, arch, binaries: staged }, null, 2)}\n`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exit(1);
  });
}
