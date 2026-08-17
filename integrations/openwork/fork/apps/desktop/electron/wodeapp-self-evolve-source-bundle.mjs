/**
 * Packaged-app helpers: extract bundled filtered monorepo source and mount it.
 */
import { createReadStream, createWriteStream, existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createZstdDecompress } from "node:zlib";
import { spawn } from "node:child_process";

export const BUNDLED_SELF_EVOLVE_RESOURCE_DIR = "self-evolve-source";
export const BUNDLED_SELF_EVOLVE_ARCHIVE = "self-evolve-source.tar.zst";
export const BUNDLED_SELF_EVOLVE_MANIFEST = "manifest.json";

/**
 * @param {string} resourcesPath process.resourcesPath
 */
export function resolveBundledSelfEvolvePaths(resourcesPath) {
  const dir = path.join(resourcesPath, BUNDLED_SELF_EVOLVE_RESOURCE_DIR);
  return {
    dir,
    archivePath: path.join(dir, BUNDLED_SELF_EVOLVE_ARCHIVE),
    manifestPath: path.join(dir, BUNDLED_SELF_EVOLVE_MANIFEST),
  };
}

const inflightExtracts = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One extract at a time per destRoot: in-process coalescing plus a directory
 * lock so a second Electron sharing userData cannot spawn parallel tars.
 */
async function withDestLock(destRoot, fn) {
  const existing = inflightExtracts.get(destRoot);
  if (existing) return existing;

  const run = (async () => {
    const lockDir = `${destRoot}.lock`;
    const started = Date.now();
    const staleAfterMs = 15 * 60 * 1000;
    await mkdir(path.dirname(lockDir), { recursive: true });
    while (true) {
      try {
        await mkdir(lockDir);
        break;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const lockStat = await stat(lockDir).catch(() => null);
        if (lockStat && Date.now() - lockStat.mtimeMs > staleAfterMs) {
          await rm(lockDir, { recursive: true, force: true });
          continue;
        }
        if (Date.now() - started > staleAfterMs) {
          throw new Error(`self-evolve extract lock timeout: ${lockDir}`);
        }
        await sleep(200);
      }
    }
    try {
      return await fn();
    } finally {
      await rm(lockDir, { recursive: true, force: true });
    }
  })();

  inflightExtracts.set(destRoot, run);
  try {
    return await run;
  } finally {
    if (inflightExtracts.get(destRoot) === run) inflightExtracts.delete(destRoot);
  }
}

export function readBundledSelfEvolveManifest(manifestPath) {
  try {
    const raw = readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function decompressZstToFile(zstPath, tarPath) {
  await pipeline(
    createReadStream(zstPath),
    createZstdDecompress(),
    createWriteStream(tarPath),
  );
}

async function extractTarFile(tarPath, destDir) {
  await mkdir(destDir, { recursive: true });
  // Windows bsdtar treats absolute paths like `C:\...` as remote `host:path`.
  // Copy the tar next to the dest and extract with cwd-relative names only.
  const localName = `.wodeappx-extract-${process.pid}-${Date.now()}.tar`;
  const localTar = path.join(destDir, localName);
  const { copyFile, unlink } = await import("node:fs/promises");
  await copyFile(tarPath, localTar);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn("tar", ["-xf", localName], {
        cwd: destDir,
        stdio: ["ignore", "ignore", "pipe"],
      });
      let err = "";
      child.stderr?.on("data", (chunk) => {
        err += String(chunk);
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) reject(new Error(`tar extract failed (${code}): ${err.trim()}`));
        else resolve();
      });
    });
  } finally {
    try {
      await unlink(localTar);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Ensure the bundled archive is extracted under userData for the given app version.
 * Returns the monorepo root path (…/wodeapp) or "".
 *
 * @param {{
 *   resourcesPath: string,
 *   userDataPath: string,
 *   version: string,
 *   looksLikeMonorepoRoot: (dir: string) => boolean,
 *   log?: (...args: any[]) => void,
 * }} options
 */
export async function ensureBundledSelfEvolveMonorepo(options) {
  const {
    resourcesPath,
    userDataPath,
    version,
    looksLikeMonorepoRoot,
    log = console.info.bind(console),
  } = options;

  const appVersion = String(version || "").trim() || "unknown";
  const bundled = resolveBundledSelfEvolvePaths(resourcesPath);
  if (!existsSync(bundled.archivePath) || !existsSync(bundled.manifestPath)) {
    log("[workspace] bundled self-evolve source missing", {
      archivePath: bundled.archivePath,
    });
    return "";
  }

  const manifest = readBundledSelfEvolveManifest(bundled.manifestPath);
  const rootName = typeof manifest?.rootName === "string" && manifest.rootName.trim()
    ? manifest.rootName.trim()
    : "wodeapp";
  const extractVersion = typeof manifest?.version === "string" && manifest.version.trim()
    ? manifest.version.trim()
    : appVersion;

  const destRoot = path.join(userDataPath, "self-evolve-source", extractVersion);
  const monorepoRoot = path.join(destRoot, rootName);
  const markerPath = path.join(destRoot, ".extracted");

  if (existsSync(markerPath) && looksLikeMonorepoRoot(monorepoRoot)) {
    return monorepoRoot;
  }

  return withDestLock(destRoot, async () => {
    if (existsSync(markerPath) && looksLikeMonorepoRoot(monorepoRoot)) {
      return monorepoRoot;
    }

    await rm(destRoot, { recursive: true, force: true });
    await mkdir(destRoot, { recursive: true });

    const tempDir = await mkdtemp(path.join(tmpdir(), "wodeappx-self-evolve-extract-"));
    const tarPath = path.join(tempDir, "self-evolve-source.tar");
    try {
      await decompressZstToFile(bundled.archivePath, tarPath);
      await extractTarFile(tarPath, destRoot);
      if (!looksLikeMonorepoRoot(monorepoRoot)) {
        throw new Error(`extracted tree is not a monorepo root: ${monorepoRoot}`);
      }
      await writeFile(
        markerPath,
        JSON.stringify({
          version: extractVersion,
          rootName,
          sha256: manifest?.sha256 || null,
          extractedAt: new Date().toISOString(),
        }, null, 2),
        "utf8",
      );
      log("[workspace] extracted bundled self-evolve source", {
        path: monorepoRoot,
        version: extractVersion,
        fileCount: manifest?.fileCount ?? null,
      });
      return monorepoRoot;
    } catch (error) {
      await rm(destRoot, { recursive: true, force: true });
      log("[workspace] failed to extract bundled self-evolve source", {
        error: error instanceof Error ? error.message : String(error),
      });
      return "";
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
}
