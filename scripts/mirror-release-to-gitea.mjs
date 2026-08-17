#!/usr/bin/env node
/**
 * Mirror a WodeAppX desktop release from local files or GitHub onto public Gitea.
 *
 * Usage:
 *   node wodeappx/scripts/mirror-release-to-gitea.mjs
 *   node wodeappx/scripts/mirror-release-to-gitea.mjs --tag wodeappx-v0.17.4
 *   node wodeappx/scripts/mirror-release-to-gitea.mjs --from-github
 *   node wodeappx/scripts/mirror-release-to-gitea.mjs --dir wodeappx/release
 *
 * Env:
 *   GITEA_TOKEN (required)
 *   GITEA_BASE_URL (default https://gitea.com)
 *   GITEA_OWNER (default diankourenxia)
 *   GITEA_REPO (default wodeappx)
 *   WODEAPPX_GITHUB_TOKEN or GITHUB_TOKEN (only for --from-github / private monorepo)
 */
import { spawnSync } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

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
    const text = readFileSync(absolute, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))
      ) {
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
const GITEA_OWNER = argValue("--owner")
  || process.env.WODEAPPX_GITEA_OWNER
  || process.env.GITEA_OWNER
  || "diankourenxia";
const GITEA_REPO = argValue("--repo")
  || process.env.WODEAPPX_GITEA_REPO
  || process.env.GITEA_REPO
  || "wodeappx";
const GITEA_TOKEN = process.env.GITEA_TOKEN || process.env.WODEAPPX_GITEA_TOKEN || "";
const GITHUB_OWNER = process.env.WODEAPPX_GITHUB_OWNER || "diankourenxia";
const GITHUB_REPO = process.env.WODEAPPX_GITHUB_REPO || "wodeapp";
const GITHUB_TOKEN = process.env.WODEAPPX_GITHUB_TOKEN || process.env.GITHUB_TOKEN || "";

const fromGithub = hasFlag("--from-github");
const releaseDir = resolve(repoRoot, argValue("--dir") || "wodeappx/release");
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "wodeappx/package.json"), "utf8"));
const releaseTag = argValue("--tag") || `wodeappx-v${packageJson.version}`;
const versionFromTag = releaseTag.replace(/^wodeappx-v/i, "").replace(/^v/i, "");
const releaseName = `WodeAppX ${versionFromTag}`;

if (!GITEA_TOKEN) fail("GITEA_TOKEN is required");

const api = `${GITEA_BASE_URL}/api/v1`;
const repoPath = `${GITEA_OWNER}/${GITEA_REPO}`;
const authHeader = `token ${GITEA_TOKEN}`;

async function giteaJson(path, init = {}) {
  const response = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: authHeader,
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
  if (response.status === 401) {
    fail(`Gitea auth failed (401). Refresh GITEA_TOKEN for ${repoPath}.`);
  }
  return { response, text, json };
}

function isInstallerName(name) {
  const lower = name.toLowerCase();
  if (!lower.startsWith("wodeappx-")) return false;
  return (
    lower.endsWith(".dmg")
    || lower.endsWith(".exe")
    || lower.endsWith(".zip")
    || lower.endsWith(".blockmap")
    || lower.endsWith(".yml")
    || lower.endsWith(".yaml")
    || lower === "third-party-licenses.json"
  );
}

async function listLocalAssets() {
  if (!existsSync(releaseDir)) fail(`Release directory not found: ${releaseDir}`);
  const all = readdirSync(releaseDir).filter((name) => isInstallerName(name));
  const matched = all.filter((name) => name.includes(versionFromTag) || /\.(yml|yaml)$/i.test(name) || name === "third-party-licenses.json");
  const names = matched.length ? matched : all;
  return names.map((name) => {
    const absolute = resolve(releaseDir, name);
    return {
      name,
      absolute,
      size: statSync(absolute).size,
    };
  });
}

async function listGithubAssets(tag) {
  const token = GITHUB_TOKEN || (() => {
    const result = spawnSync("gh", ["auth", "token"], { encoding: "utf8" });
    return result.status === 0 ? String(result.stdout || "").trim() : "";
  })();
  if (!token) fail("GitHub token required for --from-github (WODEAPPX_GITHUB_TOKEN or gh auth)");

  const response = await fetch(
    `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${encodeURIComponent(tag)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "wodeappx-gitea-mirror",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response.ok) fail(`GitHub release lookup failed (${response.status}) for ${tag}`);
  const body = await response.json();
  const assets = Array.isArray(body.assets) ? body.assets : [];
  return assets
    .filter((asset) => isInstallerName(String(asset.name || "")))
    .map((asset) => {
      const localPath = resolve(releaseDir, String(asset.name));
      if (existsSync(localPath)) {
        return {
          name: String(asset.name),
          absolute: localPath,
          size: statSync(localPath).size,
        };
      }
      return {
        name: String(asset.name),
        absolute: null,
        size: Number(asset.size) || 0,
        downloadTo: async (targetPath) => {
          const assetApi = String(asset.url || "").trim()
            || `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/assets/${asset.id}`;
          const upstream = await fetch(assetApi, {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/octet-stream",
              "User-Agent": "wodeappx-gitea-mirror",
              "X-GitHub-Api-Version": "2022-11-28",
            },
            redirect: "follow",
          });
          if (!upstream.ok || !upstream.body) {
            throw new Error(`Failed to download ${asset.name} from GitHub (${upstream.status})`);
          }
          await pipeline(Readable.fromWeb(upstream.body), createWriteStream(targetPath));
        },
      };
    });
}

async function ensureRepoHasCommit() {
  const { json } = await giteaJson(`/repos/${repoPath}`);
  if (!json) fail(`Gitea repo not found: ${repoPath}`);
  if (json.empty !== true) {
    console.log(`Gitea repo ready (empty=${json.empty})`);
    return;
  }

  console.log("Gitea repo is empty; creating an initial README commit via Contents API");
  const content = Buffer.from(
    `# ${GITEA_REPO}\n\nPublic download mirror for WodeAppX desktop installers.\nCanonical releases live on GitHub; this repository is a regional mirror.\n`,
    "utf8",
  ).toString("base64");
  const create = await giteaJson(`/repos/${repoPath}/contents/README.md`, {
    method: "POST",
    body: JSON.stringify({
      message: "Initialize public WodeAppX download mirror",
      content,
      branch: "main",
    }),
  });
  if (!create.response.ok && create.response.status !== 409) {
    fail(`Failed to seed empty Gitea repo: HTTP ${create.response.status} ${create.text}`);
  }
}

async function ensureRelease(tag) {
  const existing = await giteaJson(`/repos/${repoPath}/releases/tags/${encodeURIComponent(tag)}`);
  if (existing.response.ok && existing.json?.id) {
    console.log(`Reusing Gitea release id=${existing.json.id} tag=${tag}`);
    return existing.json;
  }

  const created = await giteaJson(`/repos/${repoPath}/releases`, {
    method: "POST",
    body: JSON.stringify({
      tag_name: tag,
      target_commitish: "main",
      name: releaseName,
      body: "Mirror of the WodeAppX GitHub release. GitHub remains the canonical update feed.",
      draft: false,
      prerelease: false,
    }),
  });
  if (!created.response.ok || !created.json?.id) {
    fail(`Failed to create Gitea release: HTTP ${created.response.status} ${created.text}`);
  }
  console.log(`Created Gitea release id=${created.json.id} tag=${tag}`);
  return created.json;
}

async function deleteExistingAsset(release, name) {
  const assets = release.assets || release.attachments || [];
  const matched = assets.find((item) => item?.name === name);
  if (!matched?.id) return;
  const deleted = await giteaJson(`/repos/${repoPath}/releases/${release.id}/assets/${matched.id}`, {
    method: "DELETE",
  });
  if (!deleted.response.ok && deleted.response.status !== 404) {
    console.warn(`Failed to delete existing asset ${name}: HTTP ${deleted.response.status}`);
  }
}

async function uploadAsset(releaseId, asset) {
  const MAX_GITEA_COM_BYTES = 50 * 1024 * 1024;
  if (asset.size > MAX_GITEA_COM_BYTES && /gitea\.com$/i.test(new URL(GITEA_BASE_URL).host)) {
    fail(
      `Skip/fail ${asset.name}: ${Math.round(asset.size / (1024 * 1024))}MB exceeds gitea.com attachment limit (~50MB; 80MB returns HTTP 502). `
      + `Host installers on GitHub/COS and keep Gitea for metadata, or use a self-hosted Gitea with a higher limit.`,
    );
  }
  const tempRoot = mkdtempSync(join(tmpdir(), "wodeappx-gitea-"));
  let filePath = asset.absolute;
  let cleanup = false;
  try {
    if (!filePath) {
      if (typeof asset.downloadTo !== "function") {
        fail(`Asset ${asset.name} has no local path or downloader`);
      }
      filePath = join(tempRoot, basename(asset.name));
      cleanup = true;
      console.log(`downloading ${asset.name} from GitHub...`);
      await asset.downloadTo(filePath);
    }

    const uploadUrl = `${api}/repos/${repoPath}/releases/${releaseId}/assets?name=${encodeURIComponent(asset.name)}`;
    const result = spawnSync(
      "curl",
      [
        "-fsS",
        "-X",
        "POST",
        "-H",
        `Authorization: ${authHeader}`,
        "-H",
        "Accept: application/json",
        "-F",
        `attachment=@${filePath}`,
        uploadUrl,
      ],
      { encoding: "utf8" },
    );
    if (result.status !== 0) {
      fail(`Upload failed for ${asset.name}: ${result.stderr || result.stdout || `exit ${result.status}`}`);
    }
    console.log(`mirrored: ${asset.name} (${Math.max(1, Math.round(asset.size / (1024 * 1024)))} MB)`);
  } finally {
    if (cleanup) {
      try {
        rmSync(tempRoot, { recursive: true, force: true });
      } catch {
        // ignore cleanup errors
      }
    } else {
      try {
        rmSync(tempRoot, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}

const assets = fromGithub ? await listGithubAssets(releaseTag) : await listLocalAssets();
if (!assets.length) fail("No installer assets found to mirror");

console.log(`Mirroring ${assets.length} assets for ${releaseTag} -> ${GITEA_BASE_URL}/${repoPath}`);
await ensureRepoHasCommit();
let release = await ensureRelease(releaseTag);

for (const asset of assets) {
  await deleteExistingAsset(release, asset.name);
  await uploadAsset(release.id, asset);
}

const refreshed = await giteaJson(`/repos/${repoPath}/releases/${release.id}`);
release = refreshed.json || release;
console.log("");
console.log(`Done. Release page: ${GITEA_BASE_URL}/${repoPath}/releases/tag/${releaseTag}`);
console.log(`Assets on Gitea: ${(release.assets || release.attachments || []).length}`);
