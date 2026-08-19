#!/usr/bin/env node
/**
 * Publish Electron updater manifests (latest.yml / latest-mac.yml / latest-linux.yml)
 * to the Gitea feed that already-shipped 1.0.0 apps check, with absolute binary URLs.
 *
 * Binaries stay on https://wodeapp.cn/downloads/wodeappx/ (or --public-base).
 * Gitea only gets the tiny yml files (gitea.com cannot host 200MB installers).
 *
 * Usage:
 *   node scripts/publish-updater-feed.mjs --from-github --win-tag v1.0.0 --mac-tag v1.0.1
 *   node scripts/publish-updater-feed.mjs --dir release
 *   node scripts/publish-updater-feed.mjs --from-github --sync-cn
 *
 * Env: GITEA_TOKEN, optional GITEA_BASE_URL / GITEA_OWNER / GITEA_REPO,
 *      WODEAPPX_GITHUB_TOKEN or gh auth, CN SSH via WODEAPP_CN_SSH_KEY or ~/.ssh/wodeapp_tencent.pem
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { rewriteUpdaterYml, updaterYmlVersion } from "./rewrite-updater-yml.mjs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(__dirname, "../..");

function argValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index < 0) return null;
  return process.argv[index + 1] || null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function loadDotEnvFiles() {
  for (const relative of [".env", "server/.env", "wodeappx/.env"]) {
    const absolute = resolve(repoRoot, relative);
    if (!existsSync(absolute)) continue;
    for (const line of readFileSync(absolute, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env) || !String(process.env[key] || "").trim()) {
        process.env[key] = value;
      }
    }
  }
}

loadDotEnvFiles();

const GITEA_BASE_URL = (process.env.GITEA_BASE_URL || process.env.WODEAPPX_GITEA_BASE_URL || "https://gitea.com").replace(/\/$/, "");
const GITEA_OWNER = argValue("--owner") || process.env.WODEAPPX_GITEA_OWNER || process.env.GITEA_OWNER || "diankourenxia";
const GITEA_REPO = argValue("--repo") || process.env.WODEAPPX_GITEA_REPO || process.env.GITEA_REPO || "wodeappx";
const GITEA_TOKEN = process.env.GITEA_TOKEN || process.env.WODEAPPX_GITEA_TOKEN || "";
const GITHUB_OWNER = process.env.WODEAPPX_PUBLIC_GITHUB_OWNER || "diankourenxia";
const GITHUB_REPO = process.env.WODEAPPX_PUBLIC_GITHUB_REPO || "wodeappx";
const GITHUB_TOKEN = process.env.WODEAPPX_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "";
const PUBLIC_BASE = (argValue("--public-base") || process.env.WODEAPPX_PUBLIC_DOWNLOAD_BASE || "https://wodeapp.cn/downloads/wodeappx").replace(/\/$/, "");
const FEED_TAG = argValue("--gitea-tag") || "updater-feed";
const dryRun = hasFlag("--dry-run");

function githubToken() {
  if (GITHUB_TOKEN) return GITHUB_TOKEN;
  const result = spawnSync("gh", ["auth", "token"], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

async function githubReleaseAsset(tag, name) {
  const token = githubToken();
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "wodeappx-updater-feed",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const url = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${encodeURIComponent(tag)}`;
  const response = await fetch(url, { headers });
  if (!response.ok) fail(`GitHub release ${tag} lookup failed (${response.status})`);
  const body = await response.json();
  const asset = (body.assets || []).find((item) => item?.name === name);
  if (!asset) return null;
  const download = await fetch(asset.browser_download_url, {
    headers: { "User-Agent": "wodeappx-updater-feed", Accept: "application/octet-stream" },
    redirect: "follow",
  });
  if (!download.ok) fail(`Download ${name} from ${tag} failed (${download.status})`);
  return Buffer.from(await download.arrayBuffer());
}

function readLocalYml(dir, name) {
  const absolute = resolve(dir, name);
  return existsSync(absolute) ? readFileSync(absolute) : null;
}

async function collectManifests() {
  const manifests = [];
  const fromGithub = hasFlag("--from-github");
  const dir = argValue("--dir") ? resolve(repoRoot, argValue("--dir")) : resolve(repoRoot, "wodeappx/release");
  const winTag = argValue("--win-tag") || argValue("--tag");
  const macTag = argValue("--mac-tag") || argValue("--tag");
  const linuxTag = argValue("--linux-tag") || argValue("--tag");

  const sources = [
    { name: "latest.yml", tag: winTag },
    { name: "latest-mac.yml", tag: macTag },
    { name: "latest-linux.yml", tag: linuxTag },
  ];

  for (const source of sources) {
    let bytes = null;
    if (fromGithub && source.tag) {
      bytes = await githubReleaseAsset(source.tag, source.name);
    } else {
      bytes = readLocalYml(dir, source.name);
    }
    if (!bytes) continue;
    const rewritten = rewriteUpdaterYml(bytes.toString("utf8"), { publicBase: PUBLIC_BASE });
    manifests.push({
      name: source.name,
      text: rewritten,
      version: updaterYmlVersion(rewritten),
    });
  }
  return manifests;
}

async function giteaJson(path, init = {}) {
  const response = await fetch(`${GITEA_BASE_URL}/api/v1${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `token ${GITEA_TOKEN}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, text, json };
}

async function ensureFeedRelease() {
  const existing = await giteaJson(`/repos/${GITEA_OWNER}/${GITEA_REPO}/releases/tags/${encodeURIComponent(FEED_TAG)}`);
  if (existing.response.ok && existing.json?.id) return existing.json;
  const created = await giteaJson(`/repos/${GITEA_OWNER}/${GITEA_REPO}/releases`, {
    method: "POST",
    body: JSON.stringify({
      tag_name: FEED_TAG,
      target_commitish: "main",
      name: "WodeAppX updater feed",
      body: "Tiny electron-updater manifests. Installer binaries are on wodeapp.cn / GitHub.",
      draft: false,
      prerelease: false,
    }),
  });
  if (!created.response.ok || !created.json?.id) {
    throw new Error(`Failed to create Gitea feed release: HTTP ${created.response.status} ${created.text}`);
  }
  return created.json;
}

async function uploadYml(release, manifest) {
  const assets = release.assets || release.attachments || [];
  const matched = assets.find((item) => item?.name === manifest.name);
  if (matched?.id) {
    await giteaJson(`/repos/${GITEA_OWNER}/${GITEA_REPO}/releases/${release.id}/assets/${matched.id}`, {
      method: "DELETE",
    });
  }
  const tempRoot = mkdtempSync(join(tmpdir(), "wodeappx-feed-"));
  const filePath = join(tempRoot, manifest.name);
  try {
    writeFileSync(filePath, manifest.text);
    const uploadUrl = `${GITEA_BASE_URL}/api/v1/repos/${GITEA_OWNER}/${GITEA_REPO}/releases/${release.id}/assets?name=${encodeURIComponent(manifest.name)}`;
    const result = spawnSync(
      "curl",
      ["-fsS", "-X", "POST", "-H", `Authorization: token ${GITEA_TOKEN}`, "-H", "Accept: application/json", "-F", `attachment=@${filePath}`, uploadUrl],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      throw new Error(`Upload ${manifest.name} failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function syncCn(manifests) {
  const key = process.env.WODEAPP_CN_SSH_KEY
    || (existsSync(`${process.env.HOME}/.ssh/wodeapp_tencent.pem`) ? `${process.env.HOME}/.ssh/wodeapp_tencent.pem` : "");
  if (!key) {
    console.warn("CN sync skipped: no WODEAPP_CN_SSH_KEY or ~/.ssh/wodeapp_tencent.pem");
    return;
  }
  const host = process.env.CN_HOST || "43.143.246.125";
  const dest = `root@${host}:/var/www/wodeappx-releases/`;
  const tempRoot = mkdtempSync(join(tmpdir(), "wodeappx-feed-cn-"));
  try {
    for (const manifest of manifests) {
      writeFileSync(join(tempRoot, manifest.name), manifest.text);
    }
    const ssh = ["ssh", "-o", "ProxyCommand=none", "-o", "StrictHostKeyChecking=no", ...(key ? ["-i", key, "-o", "IdentitiesOnly=yes"] : [])];
    const result = spawnSync(
      "rsync",
      ["-avz", "-e", ssh.join(" "), ...manifests.map((item) => join(tempRoot, item.name)), dest],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      fail(`CN rsync failed: ${result.stderr || result.stdout || `exit ${result.status}`}`);
    }
    console.log(result.stdout || "synced CN");
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

const manifests = await collectManifests();
if (!manifests.length) fail("No latest.yml / latest-mac.yml / latest-linux.yml found");

for (const manifest of manifests) {
  console.log(`${manifest.name} version=${manifest.version || "?"} bytes=${Buffer.byteLength(manifest.text)}`);
}

if (dryRun) {
  for (const manifest of manifests) {
    console.log(`\n----- ${manifest.name} -----\n${manifest.text}`);
  }
  process.exit(0);
}

if (hasFlag("--sync-cn")) {
  syncCn(manifests);
}

if (!GITEA_TOKEN) {
  if (hasFlag("--sync-cn")) {
    console.log("GITEA_TOKEN missing; CN feed published, Gitea skipped.");
    process.exit(0);
  }
  fail("GITEA_TOKEN is required unless --dry-run or --sync-cn");
}
try {
  const release = await ensureFeedRelease();
  for (const manifest of manifests) {
    await uploadYml(release, manifest);
    console.log(`gitea: ${manifest.name}`);
  }
  console.log(`Gitea feed: ${GITEA_BASE_URL}/${GITEA_OWNER}/${GITEA_REPO}/releases/latest/download/latest.yml`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (hasFlag("--sync-cn")) {
    console.warn(`Gitea feed skipped: ${message}`);
    process.exit(0);
  }
  fail(message);
}
