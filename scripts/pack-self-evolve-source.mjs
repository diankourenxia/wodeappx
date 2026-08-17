#!/usr/bin/env node
/**
 * Pack a filtered monorepo source tree for self-evolve mounting inside installers.
 *
 * Include: open-core top-level dirs + root contract files.
 * Exclude: node_modules/vendor/dist/release/.git, OSS commercial strip paths,
 *          docs archives/media, uploads, tmp, root one-off _*.mjs.
 *
 * Usage:
 *   node scripts/pack-self-evolve-source.mjs
 *   node scripts/pack-self-evolve-source.mjs --dry-run
 *   node scripts/pack-self-evolve-source.mjs --out vendor/openwork/apps/desktop/resources/self-evolve-source
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createZstdCompress } from "node:zlib";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wodeappxRoot = path.resolve(__dirname, "..");
const monorepoRootDefault = path.resolve(wodeappxRoot, "..");

export const SELF_EVOLVE_ARCHIVE_NAME = "self-evolve-source.tar.zst";
export const SELF_EVOLVE_MANIFEST_NAME = "manifest.json";
export const SELF_EVOLVE_ARCHIVE_ROOT = "wodeapp";

export const INCLUDE_TOP_LEVEL_DIRS = [
  "wodeappx",
  "runtime-server",
  "runtime-app",
  "server",
  "client-react",
  "shared-components",
  "packages",
  "docs",
  ".agents",
  "scripts",
];

export const INCLUDE_ROOT_FILES = [
  "AGENTS.md",
  "README.md",
  "LICENSE",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CODE_OF_CONDUCT.md",
  "LOCAL_DEVELOPMENT.md",
  "CHANGELOG.md",
  "package.json",
  "pnpm-workspace.yaml",
  "pnpm-lock.yaml",
  ".env.example",
  ".npmrc",
  ".gitignore",
];

/** Same commercial paths as scripts/oss-strip.sh (omit from archive). */
export const OSS_STRIP_PATHS = [
  "server/src/routes/stripe.ts",
  "server/src/routes/alipay.ts",
  "server/src/routes/wechatpay.ts",
  "server/src/routes/webhook.ts",
  "server/src/routes/credits.ts",
  "server/src/routes/referral.ts",
  "server/src/routes/qingyunProxy.ts",
  "server/src/services/subscriptionService.ts",
  "server/src/services/creditService.ts",
  "server/src/services/alipayService.ts",
  "server/src/services/wechatPayService.ts",
];

/** Replace with OSS stub content when packing. */
export const OSS_STUB_PAIRS = [
  {
    target: "runtime-server/src/middleware/creditCheck.ts",
    stub: "scripts/stubs/oss/creditCheck.OSS.stub.ts",
  },
];

const EXCLUDE_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "vendor",
  "release",
  "release-oss",
  "release-archive",
  "dist",
  "dist-electron",
  "dist-electron-test",
  "dist-mobile",
  "out",
  ".turbo",
  "coverage",
  "target",
  ".build",
  "test-results",
  "tmp",
  "uploads",
  "sidecars",
  "android",
  "ios",
  "src-tauri",
  "certs",
  "generated-projects",
  ".venv",
  ".venv-pdf",
  "venv",
  "site-packages",
  "runs",
  ".expo",
]);

const SKIP_PREFIXES = [
  "docs/archive/",
  "docs/test-evidence/",
  "docs/design/oss-p0-mockups/",
  "docs/copyright-materials/",
  "docs/assets/",
  "server/uploads/",
  "server/data/",
  "server/certs/",
  "server/generated-projects/",
  "runtime-app/public/",
  "runtime-app/assets/",
  "wodeappx/release/",
  "wodeappx/release-oss/",
  "wodeappx/release-archive/",
  "wodeappx/vendor/",
  "wodeappx/apps/desktop/resources/sidecars/",
  "wodeappx/capture-engine/bin/",
  "wodeappx/native/",
  "scripts/_archived/",
  "scripts/episode-rhythm-manifest/",
  "scripts/output/",
  "scripts/automa-workflows/",
  "scripts/.venv-pdf/",
  "scripts/.venv/",
  "wodeappx/scripts/context-bench/runs/",
  "wodeappx/docs/promo/",
  "wodeappx/docs/examples/skin-mocks/",
  "wodeappx/docs/examples/companion-assets/",
];

const DOCS_MEDIA_EXT = new Set([
  ".mp4", ".mov", ".webm", ".dmg", ".zip", ".blockmap",
  ".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".psd",
]);

/** Never ship private key material even if gitignored locally. */
const SECRET_FILE_EXT = new Set([
  ".key", ".pem", ".p12", ".pfx", ".jks", ".keystore",
]);

const STRIP_SET = new Set(OSS_STRIP_PATHS.map((p) => p.replace(/\\/g, "/")));

function normalizeRel(rel) {
  return String(rel || "").replace(/\\/g, "/").replace(/^\.\//, "");
}

export function shouldIncludeSelfEvolveRelativePath(relativePath) {
  const rel = normalizeRel(relativePath);
  if (!rel || rel.endsWith("/")) return false;
  if (STRIP_SET.has(rel)) return false;
  if (rel === ".DS_Store" || rel.endsWith("/.DS_Store")) return false;
  const base = path.posix.basename(rel);
  if (base === "SERVERS.md") return false;
  if (base.startsWith(".env") && base !== ".env.example") return false;
  const ext = path.posix.extname(base).toLowerCase();
  if (SECRET_FILE_EXT.has(ext)) return false;
  if (base.startsWith("id_rsa") || base.startsWith("id_ed25519")) return false;
  if (SKIP_PREFIXES.some((prefix) => rel === prefix.slice(0, -1) || rel.startsWith(prefix))) {
    return false;
  }
  if (DOCS_MEDIA_EXT.has(ext)) {
    return false;
  }
  // Root one-off noise scripts.
  if (!rel.includes("/") && /^_.*\.(mjs|cjs|js)$/.test(rel)) return false;

  const top = rel.split("/")[0];
  if (INCLUDE_TOP_LEVEL_DIRS.includes(top)) {
    const parts = rel.split("/");
    for (const part of parts.slice(0, -1)) {
      if (EXCLUDE_DIR_NAMES.has(part)) return false;
      if (part === "tmp" || part.startsWith("tmp-") || part.startsWith(".tmp")) return false;
      if (part.startsWith(".venv")) return false;
    }
    return true;
  }
  return INCLUDE_ROOT_FILES.includes(rel);
}

const PRIVATE_KEY_RE = /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/;

/**
 * Fail closed if staged tree still contains private-key PEMs or secret filenames.
 * @param {string} treeRoot absolute path to staged wodeapp/
 */
export async function assertNoSecretsInSelfEvolveTree(treeRoot) {
  const errors = [];
  async function walk(absDir, relativeBase) {
    let entries;
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = normalizeRel(path.join(relativeBase, entry.name));
      const abs = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.posix.extname(entry.name).toLowerCase();
      if (SECRET_FILE_EXT.has(ext) && !rel.includes("cacert")) {
        errors.push(`secret-like file packed: ${rel}`);
        continue;
      }
      if (![".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".md", ".yml", ".yaml", ".txt", ".example", ".env", ".sh", ".pem", ".key"].includes(ext)
        && entry.name !== ".env.example") {
        continue;
      }
      // Skip known documentation/examples that mention PEM markers without embedding keys.
      if (rel.endsWith(".env.example") || rel.includes(".test.") || rel.endsWith(".test.ts") || rel.endsWith(".test.mjs")) {
        // Still forbid raw PEM blocks in tests/examples longer than a one-liner template.
      }
      let text;
      try {
        text = await readFile(abs, "utf8");
      } catch {
        continue;
      }
      if (text.length > 1_500_000) text = text.slice(0, 1_500_000);
      if (!PRIVATE_KEY_RE.test(text)) continue;
      const hasMultilinePem = /-----BEGIN [^-]+PRIVATE KEY-----[\s\S]{80,}?-----END [^-]+PRIVATE KEY-----/.test(text);
      if (hasMultilinePem) {
        errors.push(`private key PEM material packed: ${rel}`);
      }
    }
  }
  await walk(treeRoot, "");
  if (errors.length) {
    const err = new Error(`self-evolve source secret scan failed:\n- ${errors.join("\n- ")}`);
    err.errors = errors;
    throw err;
  }
  return { ok: true, errors: [] };
}

async function walkFiles(absDir, relativeBase, out) {
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name;
    if (entry.isDirectory()) {
      if (EXCLUDE_DIR_NAMES.has(name)) continue;
      if (name === "tmp" || name.startsWith("tmp-") || name.startsWith(".tmp") || name.startsWith(".venv")) continue;
      await walkFiles(path.join(absDir, name), path.join(relativeBase, name), out);
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = normalizeRel(path.join(relativeBase, name));
    if (shouldIncludeSelfEvolveRelativePath(rel)) out.push(rel);
  }
}

export async function listSelfEvolveSourceFiles(monorepoRoot) {
  const root = path.resolve(monorepoRoot);
  const files = [];
  for (const dir of INCLUDE_TOP_LEVEL_DIRS) {
    const abs = path.join(root, dir);
    try {
      const st = await stat(abs);
      if (!st.isDirectory()) continue;
    } catch {
      continue;
    }
    await walkFiles(abs, dir, files);
  }
  for (const name of INCLUDE_ROOT_FILES) {
    const abs = path.join(root, name);
    try {
      const st = await stat(abs);
      if (st.isFile() && shouldIncludeSelfEvolveRelativePath(name)) files.push(name);
    } catch {
      // optional
    }
  }
  files.sort();
  return [...new Set(files)];
}

function stubSourceForRelative(rel, monorepoRoot) {
  const normalized = normalizeRel(rel);
  for (const pair of OSS_STUB_PAIRS) {
    if (pair.target === normalized) {
      return path.join(monorepoRoot, pair.stub);
    }
  }
  return path.join(monorepoRoot, normalized);
}

export async function stageSelfEvolveSourceTree(monorepoRoot, stageRoot) {
  const files = await listSelfEvolveSourceFiles(monorepoRoot);
  const treeRoot = path.join(stageRoot, SELF_EVOLVE_ARCHIVE_ROOT);
  await rm(treeRoot, { recursive: true, force: true });
  await mkdir(treeRoot, { recursive: true });
  let bytes = 0;
  for (const rel of files) {
    const src = stubSourceForRelative(rel, monorepoRoot);
    try {
      await stat(src);
    } catch {
      continue;
    }
    const dest = path.join(treeRoot, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
    bytes += (await stat(dest)).size;
  }
  return { files: files.length, uncompressedBytes: bytes, treeRoot };
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function compressDirectoryToTarZst(sourceDir, archivePath) {
  await mkdir(path.dirname(archivePath), { recursive: true });
  await rm(archivePath, { force: true });
  const parent = path.dirname(sourceDir);
  const base = path.basename(sourceDir);
  await new Promise((resolve, reject) => {
    const tar = spawn("tar", ["-cf", "-", "-C", parent, base], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const compress = createZstdCompress({ level: 12 });
    const out = createWriteStream(archivePath);
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    let err = "";
    tar.stderr?.on("data", (chunk) => {
      err += String(chunk);
    });
    tar.on("error", fail);
    compress.on("error", fail);
    out.on("error", fail);
    tar.stdout.pipe(compress).pipe(out);
    out.on("finish", () => {
      if (tar.exitCode && tar.exitCode !== 0) {
        fail(new Error(`tar failed (${tar.exitCode}): ${err.trim()}`));
        return;
      }
      succeed();
    });
    tar.on("close", (code) => {
      if (code !== 0) fail(new Error(`tar failed (${code}): ${err.trim()}`));
    });
  });
}

/**
 * @param {{
 *   monorepoRoot?: string,
 *   outDir?: string,
 *   version?: string,
 *   dryRun?: boolean,
 * }} [options]
 */
export async function packSelfEvolveSource(options = {}) {
  const monorepoRoot = path.resolve(options.monorepoRoot || monorepoRootDefault);
  const version = options.version
    || JSON.parse(await readFile(path.join(wodeappxRoot, "package.json"), "utf8")).version;
  const outDir = path.resolve(
    options.outDir
      || path.join(wodeappxRoot, "vendor/openwork/apps/desktop/resources/self-evolve-source"),
  );

  const files = await listSelfEvolveSourceFiles(monorepoRoot);
  let estimateBytes = 0;
  for (const rel of files) {
    const src = stubSourceForRelative(rel, monorepoRoot);
    try {
      estimateBytes += (await stat(src)).size;
    } catch {
      // skip
    }
  }

  if (options.dryRun) {
    return {
      ok: true,
      dryRun: true,
      version,
      fileCount: files.length,
      uncompressedBytes: estimateBytes,
      sample: files.filter((f) =>
        f.includes("self-evolve-guard")
        || f.startsWith("runtime-server/")
        || f === "server/src/routes/stripe.ts"
        || f.includes("vendor/")
      ).slice(0, 20),
      hasStripe: files.includes("server/src/routes/stripe.ts"),
      hasVendor: files.some((f) => f.includes("/vendor/") || f.startsWith("wodeappx/vendor/")),
      hasGuard: files.includes("wodeappx/scripts/self-evolve-guard.mjs"),
    };
  }

  const stageRoot = path.join(outDir, ".stage");
  await rm(stageRoot, { recursive: true, force: true });
  await mkdir(stageRoot, { recursive: true });
  const staged = await stageSelfEvolveSourceTree(monorepoRoot, stageRoot);
  await assertNoSecretsInSelfEvolveTree(staged.treeRoot);
  const archivePath = path.join(outDir, SELF_EVOLVE_ARCHIVE_NAME);
  await compressDirectoryToTarZst(staged.treeRoot, archivePath);
  const sha256 = await sha256File(archivePath);
  const archiveBytes = (await stat(archivePath)).size;
  const manifest = {
    version,
    rootName: SELF_EVOLVE_ARCHIVE_ROOT,
    archive: SELF_EVOLVE_ARCHIVE_NAME,
    fileCount: staged.files,
    uncompressedBytes: staged.uncompressedBytes,
    archiveBytes,
    sha256,
    createdAt: new Date().toISOString(),
  };
  await writeFile(
    path.join(outDir, SELF_EVOLVE_MANIFEST_NAME),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  await rm(stageRoot, { recursive: true, force: true });
  return { ok: true, outDir, ...manifest };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const outIdx = args.indexOf("--out");
  const outDir = outIdx >= 0 ? args[outIdx + 1] : undefined;
  const result = await packSelfEvolveSource({ dryRun, outDir });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
  if (dryRun && (result.hasStripe || result.hasVendor || !result.hasGuard)) {
    console.error("[pack-self-evolve-source] dry-run filter check failed");
    process.exit(1);
  }
}
