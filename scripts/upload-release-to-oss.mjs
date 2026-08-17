#!/usr/bin/env node
/**
 * Upload WodeAppX release installers to Alibaba Cloud OSS (with CDN support).
 *
 * Designed to work both locally and in GitHub Actions:
 *   - Local macOS (after `pnpm release:macos`): uploads release/ folder
 *   - GitHub Actions (Windows build): uploads wodeappx/release/ folder
 *
 * The script also writes a `latest.json` index file at the OSS root, so the
 * download page / website can always discover the current installer URLs
 * without hard-coding version numbers.
 *
 * Env vars required:
 *   OSS_ACCESS_KEY_ID       RAM/AK access key id
 *   OSS_ACCESS_KEY_SECRET   RAM/AK access key secret
 *   OSS_BUCKET              bucket name, e.g. wodeappx-releases
 *   OSS_REGION              region id, e.g. oss-cn-hangzhou  (default cn-hangzhou)
 *   OSS_ENDPOINT            override endpoint, e.g. oss-cn-hangzhou.aliyuncs.com
 *                           (if set, OSS_REGION is ignored)
 *   OSS_PREFIX              key prefix inside bucket, default "releases"
 *   OSS_PUBLIC_BASE_URL     public CDN/base URL used in latest.json,
 *                           e.g. https://dl.wodeapp.cn  (fallback: bucket endpoint)
 *
 * Optional:
 *   WODEAPPX_RELEASE_DIR    dir containing installer files, default release/
 *   WODEAPPX_VERSION        version tag, e.g. 0.17.6; read from package.json by default
 *   DRY_RUN=1               print what would be uploaded without actually doing it
 *
 * Usage:
 *   node wodeappx/scripts/upload-release-to-oss.mjs
 *   DRY_RUN=1 node wodeappx/scripts/upload-release-to-oss.mjs
 *   WODEAPPX_RELEASE_DIR=wodeappx/release node wodeappx/scripts/upload-release-to-oss.mjs
 */
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// wodeappxRoot = <repo>/wodeappx  (where wodeappx/package.json lives)
const wodeappxRoot = resolve(__dirname, "..");
// repoRoot = <repo>
const repoRoot = resolve(wodeappxRoot, "..");

// ---------- CLI flags ----------
function hasFlag(flag) {
  return process.argv.includes(flag);
}
const dryRun = hasFlag("--dry-run") || process.env.DRY_RUN === "1";
const verbose = hasFlag("--verbose");

// ---------- Load .env (so the script works locally without exporting vars) ----------
function loadDotEnv() {
  for (const rel of [".env", "server/.env", "wodeappx/.env"]) {
    const abs = resolve(repoRoot, rel);
    if (!existsSync(abs)) continue;
    const text = readFileSync(abs, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const k = line.slice(0, eq).trim();
      let v = line.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!(k in process.env) || !String(process.env[k] || "").trim()) {
        process.env[k] = v;
      }
    }
  }
}
loadDotEnv();

// ---------- Config ----------
const accessKeyId = process.env.OSS_ACCESS_KEY_ID || "";
const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET || "";
const bucket = process.env.OSS_BUCKET || "";
const region = process.env.OSS_REGION || "oss-cn-hangzhou";
const endpoint = process.env.OSS_ENDPOINT || `${region}.aliyuncs.com`;
const prefix = process.env.OSS_PREFIX || "releases";
const _publicBaseUrl = process.env.OSS_PUBLIC_BASE_URL || "";

// Default: the same release/ folder used by package-macos-release.mjs and the
// GitHub Actions "Collect installers" step. Both put files at wodeappx/release/.
// WODEAPPX_RELEASE_DIR is resolved relative to repoRoot (<repo>) unless absolute.
const defaultReleaseDir = "wodeappx/release";
const releaseDir = resolve(repoRoot, process.env.WODEAPPX_RELEASE_DIR || defaultReleaseDir);

const packageJson = JSON.parse(readFileSync(resolve(wodeappxRoot, "package.json"), "utf8"));
const version = process.env.WODEAPPX_VERSION || packageJson.version;
const releaseTag = `wodeappx-v${version}`;

function fail(msg) {
  console.error("[oss-upload] " + msg);
  process.exit(1);
}

if (!existsSync(releaseDir)) {
  fail(`Release directory not found: ${releaseDir}`);
}

// In dry-run mode we only print the plan, so skip credential & SDK checks.
if (dryRun) {
  console.log("[dry-run] Credential validation and OSS client init skipped.");
} else {
  if (!accessKeyId || !accessKeySecret || !bucket) {
    fail(
      "Missing OSS credentials. Set OSS_ACCESS_KEY_ID, OSS_ACCESS_KEY_SECRET, OSS_BUCKET "
      + "(optionally OSS_REGION / OSS_ENDPOINT / OSS_PREFIX / OSS_PUBLIC_BASE_URL) "
      + "in env or a .env file.",
    );
  }
}

// ---------- Dynamically import ali-oss (fallback to runtime install hint) ----------
let OSS;
try {
  OSS = (await import("ali-oss")).default;
} catch {
  if (dryRun) {
    console.log("[dry-run] ali-oss SDK not installed; skipping OSS client init.");
    OSS = null;
  } else {
    fail(
      "ali-oss SDK is not installed. Run:\n"
      + "  pnpm -F wodeappx add -D ali-oss\n"
      + "or set it as a devDependency in wodeappx/package.json.",
    );
  }
}

// ---------- Select installer files ----------
// Resolve public base URL; in dry-run with no bucket set, show a placeholder.
const publicBaseUrl = (_publicBaseUrl
  || (bucket ? `https://${bucket}.${endpoint}` : "https://<your-cdn-domain>")
).replace(/\/$/, "");

const INSTALLER_EXTS = new Set([".exe", ".dmg", ".zip", ".msi", ".AppImage", ".blockmap"]);
const META_EXTS = new Set([".yml", ".yaml", ".json"]);

function isInstallerAsset(name) {
  const lower = name.toLowerCase();
  if (lower.startsWith("wodeappx-") === false && lower !== "third-party-licenses.json") {
    return false;
  }
  const ext = extname(lower);
  return INSTALLER_EXTS.has(ext) || META_EXTS.has(ext) || lower.endsWith(".blockmap") || lower === "third-party-licenses.json";
}

function detectPlatform(name) {
  const n = name.toLowerCase();
  if (n.includes("win32") || n.endsWith(".exe") || n.endsWith(".msi")) return "win32";
  if (n.includes("darwin") || n.includes("mac") || n.endsWith(".dmg")) return "darwin";
  if (n.includes("linux") || n.endsWith(".appimage")) return "linux";
  return "unknown";
}

function detectArch(name) {
  const n = name.toLowerCase();
  if (n.includes("x64") || n.includes("x86_64")) return "x64";
  if (n.includes("arm64") || n.includes("aarch64")) return "arm64";
  if (n.includes("ia32") || n.includes("x86") && !n.includes("x86_64")) return "ia32";
  return "unknown";
}

const rawFiles = readdirSync(releaseDir).filter(isInstallerAsset);
if (!rawFiles.length) fail(`No wodeappx installer assets found in ${releaseDir}`);

// Build descriptor for each file
const files = rawFiles.map((name) => {
  const abs = resolve(releaseDir, name);
  const stat = statSync(abs);
  const platform = detectPlatform(name);
  const arch = detectArch(name);
  const ext = extname(name).toLowerCase().replace(/^\./, "");
  const key = `${prefix}/${version}/${name}`;
  const url = `${publicBaseUrl}/${key}`;
  return { name, abs, size: stat.size, platform, arch, ext, key, url };
});

// Detect primary installer per platform (the one electron-builder treats as main installer,
// i.e. .exe / .dmg rather than .blockmap / .yml)
function isPrimaryInstaller(f) {
  return [".exe", ".dmg", ".msi", ".appimage", ".zip"].includes(`.${f.ext}`);
}

console.log("");
console.log(`WodeAppX release upload -> oss://${bucket}/${prefix}/${version}/`);
console.log(`Public base URL: ${publicBaseUrl}`);
console.log(`Version: ${version} (tag: ${releaseTag})`);
console.log(`Files to upload (${files.length}):`);
const MB = 1024 * 1024;
for (const f of files) {
  const tag = isPrimaryInstaller(f) ? " [primary]" : "";
  console.log(`  - ${f.name}  (${(f.size / MB).toFixed(1)} MB, ${f.platform}/${f.arch})${tag}`);
}
console.log("");

if (dryRun) {
  console.log("[dry-run] Skipping actual upload.");
  process.exit(0);
}

// ---------- OSS client ----------
// ali-oss expects host without https:// and without bucket prefix when using
// bucket parameter; secure defaults to true.
const client = new OSS({
  region,
  endpoint,
  accessKeyId,
  accessKeySecret,
  bucket,
  secure: true,
  timeout: "120s",
});

// multipart upload threshold: > 50MB automatically uses multipart in ali-oss
const MULTIPART_THRESHOLD = 50 * MB;
const PART_SIZE = 8 * MB; // 8MB parts, well above the 100KB minimum

async function uploadFile(f) {
  const headers = {
    // Cache installers for 1 year at CDN edge (immutable, since versioned path);
    // metadata files (.yml / latest.json / latest*.yml) are overwritten on same-version
    // re-runs, so use shorter cache.
  };
  if (f.ext === "yml" || f.ext === "yaml" || f.name === "latest.json" || f.name === "third-party-licenses.json") {
    headers["Cache-Control"] = "public, max-age=300"; // 5 min
  } else {
    headers["Cache-Control"] = "public, max-age=31536000, immutable";
  }
  // Set correct content-type for .exe / .dmg so browsers download instead of streaming
  const contentType = guessContentType(f.name);
  if (contentType) headers["Content-Type"] = contentType;

  const options = {
    headers,
    timeout: 600 * 1000,
  };

  // ali-oss multipart: SDK chooses multipart for files > partSize threshold
  // when we call multipartUpload, which is the safest for >50MB installers.
  if (f.size > MULTIPART_THRESHOLD) {
    options.parallel = 4;
    options.partSize = PART_SIZE;
    const result = await client.multipartUpload(f.key, f.abs, options);
    return result;
  }
  const result = await client.put(f.key, createReadStream(f.abs) /* ali-oss accepts stream or buffer */, options);
  return result;
}

function guessContentType(name) {
  const n = name.toLowerCase();
  if (n.endsWith(".exe")) return "application/vnd.microsoft.portable-executable";
  if (n.endsWith(".msi")) return "application/x-msi";
  if (n.endsWith(".dmg")) return "application/x-apple-diskimage";
  if (n.endsWith(".zip")) return "application/zip";
  if (n.endsWith(".appimage")) return "application/vnd.appimage";
  if (n.endsWith(".blockmap")) return "application/gzip";
  if (n.endsWith(".yml") || n.endsWith(".yaml")) return "text/yaml; charset=utf-8";
  if (n.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

// ---------- Upload all files ----------
let ok = 0;
let failCount = 0;
for (const f of files) {
  process.stdout.write(`  uploading ${f.name} ... `);
  const started = Date.now();
  try {
    await uploadFile(f);
    const ms = Date.now() - started;
    console.log(`done (${(ms / 1000).toFixed(1)}s) -> ${f.url}`);
    ok++;
  } catch (err) {
    failCount++;
    const msg = err && err.message ? err.message : String(err);
    console.log(`FAILED: ${msg}`);
    if (verbose) console.error(err);
  }
}
if (failCount > 0) {
  fail(`${failCount} file(s) failed to upload.`);
}
console.log(`Uploaded ${ok} file(s).`);

// ---------- Build and upload latest.json index ----------
// This file lives at {prefix}/latest.json and always points to the newest version,
// so download pages / auto-update meta can fetch it without knowing the version.
const primaries = files.filter(isPrimaryInstaller);
const assets = {};
for (const f of primaries) {
  const key = `${f.platform}-${f.arch}`;
  assets[key] = {
    url: f.url,
    name: f.name,
    size: f.size,
    platform: f.platform,
    arch: f.arch,
    ext: f.ext,
  };
}

// Also upload electron-updater yml files (latest.yml for Windows, latest-mac.yml etc.)
// electron-builder emits them per-platform; detect & mirror to a stable "latest" key.
const updaterMeta = {};
for (const f of files) {
  if (f.ext === "yml" || f.ext === "yaml") {
    // electron-builder emits names like latest.yml (win), latest-mac.yml (mac)
    const stableName = f.name; // keep original name; upload under version/ AND copy to prefix/latest*.yml
    const stableKey = `${prefix}/${stableName}`;
    updaterMeta[stableName] = { key: stableKey, url: `${publicBaseUrl}/${stableKey}`, sourceAbs: f.abs };
  }
}

const latest = {
  version,
  releaseTag,
  publishedAt: new Date().toISOString(),
  channel: "stable",
  publicBaseUrl,
  assets,
  // Expose electron-updater meta URLs for the auto-updater:
  updates: {
    win32: updaterMeta["latest.yml"]?.url || null,
    darwin: updaterMeta["latest-mac.yml"]?.url || null,
  },
};

const latestJson = JSON.stringify(latest, null, 2);
const latestKey = `${prefix}/latest.json`;

process.stdout.write(`  uploading ${latestKey} ... `);
try {
  await client.put(latestKey, Buffer.from(latestJson, "utf8"), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60", // 1 minute; new version picked up quickly
    },
  });
  console.log("done");
} catch (err) {
  fail(`Failed to upload latest.json: ${err.message || err}`);
}

// Copy per-platform updater yml to stable "latest" location (electron-updater feeds).
for (const [name, meta] of Object.entries(updaterMeta)) {
  process.stdout.write(`  uploading ${meta.key} ... `);
  try {
    await client.put(meta.key, createReadStream(meta.sourceAbs), {
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Cache-Control": "public, max-age=60",
      },
    });
    console.log("done");
  } catch (err) {
    console.log(`FAILED: ${err.message || err}`);
  }
}

console.log("");
console.log("Done. Public download index:");
console.log(`  ${publicBaseUrl}/${latestKey}`);
console.log("");
