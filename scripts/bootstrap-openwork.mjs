#!/usr/bin/env node
/**
 * Materialize the exact OpenWork source pinned by openwork.lock.json.
 * The archive is verified before the existing vendor tree is replaced.
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const vendorRoot = path.join(root, "vendor/openwork");
const vendorParent = path.dirname(vendorRoot);
const lockPath = path.join(root, "openwork.lock.json");
const force = process.argv.includes("--force");

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function download(url, destination) {
  try {
    execFileSync("curl", ["-L", "--fail", "--retry", "3", "--retry-delay", "2", "-o", destination, url], {
      stdio: "inherit",
    });
    return;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`OpenWork download failed: HTTP ${response.status}`);
  }
  await pipeline(response.body, createWriteStream(destination));
}

async function sha256(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function removeNonOssUpstreamContent(extractedRoot) {
  await rm(path.join(extractedRoot, "ee"), { recursive: true, force: true });

  const workspacePath = path.join(extractedRoot, "pnpm-workspace.yaml");
  const workspace = await readFile(workspacePath, "utf8");
  await writeFile(
    workspacePath,
    workspace.split("\n").filter((line) => !line.includes('"ee/')).join("\n"),
    "utf8",
  );

  const packagePath = path.join(extractedRoot, "package.json");
  const packageJson = await readJson(packagePath);
  packageJson.scripts = Object.fromEntries(
    Object.entries(packageJson.scripts ?? {}).filter(([name, command]) =>
      !name.includes(":den")
      && !String(command).includes("@openwork-ee")
      && !String(command).includes("ee/")),
  );
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
}

function validateLock(lock) {
  if (lock?.schemaVersion !== 1) throw new Error("Unsupported openwork.lock.json schemaVersion");
  if (!/^[0-9a-f]{40}$/.test(lock.commit ?? "")) throw new Error("openwork.lock.json must pin a full commit SHA");
  if (!/^[0-9a-f]{64}$/.test(lock.sha256 ?? "")) throw new Error("openwork.lock.json must contain an archive SHA-256");
  if (!lock.archiveUrl || !lock.version) throw new Error("openwork.lock.json is incomplete");
}

async function currentVendorMatches(lock) {
  try {
    const marker = await readJson(path.join(vendorRoot, ".wodeappx-upstream.json"));
    return marker.commit === lock.commit
      && marker.sha256 === lock.sha256
      && marker.excludedPaths?.includes("ee/")
      && !await exists(path.join(vendorRoot, "ee"));
  } catch {
    return false;
  }
}

async function main() {
  const lock = await readJson(lockPath);
  validateLock(lock);
  await mkdir(vendorParent, { recursive: true });

  if (await exists(vendorRoot)) {
    if (!force && await currentVendorMatches(lock)) {
      console.log(`OpenWork ${lock.version} (${lock.commit.slice(0, 12)}) is already present.`);
      return;
    }
    if (!force) {
      throw new Error("vendor/openwork exists but is not verified by the current lock. Re-run with --force to replace it.");
    }
  }

  const workRoot = path.join(vendorParent, `.openwork-bootstrap-${process.pid}`);
  const archivePath = path.join(workRoot, "openwork.zip");
  const extractedName = `openwork-${lock.commit}`;
  const extractedRoot = path.join(workRoot, extractedName);

  await rm(workRoot, { recursive: true, force: true });
  await mkdir(workRoot, { recursive: true });
  try {
    console.log(`Downloading OpenWork ${lock.version} (${lock.commit.slice(0, 12)})...`);
    await download(lock.archiveUrl, archivePath);
    const actualSha256 = await sha256(archivePath);
    if (actualSha256 !== lock.sha256) {
      throw new Error(`OpenWork archive checksum mismatch: expected ${lock.sha256}, got ${actualSha256}`);
    }

    execFileSync("unzip", ["-q", "-o", archivePath, "-d", workRoot], { stdio: "inherit" });
    await removeNonOssUpstreamContent(extractedRoot);
    const desktopPackage = await readJson(path.join(extractedRoot, "apps/desktop/package.json"));
    if (desktopPackage.version !== lock.version) {
      throw new Error(`Pinned OpenWork version mismatch: expected ${lock.version}, got ${desktopPackage.version}`);
    }

    await writeFile(
      path.join(extractedRoot, ".wodeappx-upstream.json"),
      `${JSON.stringify({
        repository: lock.repository,
        commit: lock.commit,
        version: lock.version,
        sha256: lock.sha256,
        excludedPaths: ["ee/"],
      }, null, 2)}\n`,
      "utf8",
    );
    await rm(vendorRoot, { recursive: true, force: true });
    await rename(extractedRoot, vendorRoot);
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }

  console.log("OpenWork source verified and ready at vendor/openwork.");
  console.log("Next: pnpm openwork:patch && pnpm openwork:install");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
