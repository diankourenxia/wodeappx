#!/usr/bin/env node
/**
 * Export wodeappx as a standalone open-source git repository.
 *
 * - Product brand in the export is WodeAppX (not WodeAppX).
 * - Does not copy vendor/openwork (run `pnpm run setup` after clone).
 * - Incremental export with 3-way preserve by default (no orphan force-push).
 * - Orphan mode only for first-time empty repo creation with FORCE_EXPORT=1.
 *
 * Usage:
 *   node scripts/export-standalone-repo.mjs
 *   node scripts/export-standalone-repo.mjs --out /path/to/wodeappx
 *   node scripts/export-standalone-repo.mjs --mode=orphan --dry-run
 *   PUSH=1 node scripts/export-standalone-repo.mjs
 *   FORCE_EXPORT=1 PUSH=1 node scripts/export-standalone-repo.mjs --mode=orphan
 */
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
function flagValue(name, fallback = "") {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name && i + 1 < args.length) return args[i + 1];
    if (args[i].startsWith(`${name}=`)) return args[i].slice(name.length + 1);
  }
  return fallback;
}

export function parseModeFlag(argv = args) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--mode" && i + 1 < argv.length) return argv[i + 1];
    if (argv[i].startsWith("--mode=")) return argv[i].slice("--mode=".length);
  }
  return "";
}

// Parse flags
const modeFlag = parseModeFlag();
const wantsInitGit = args.includes("--init-git") || process.env.INIT_GIT === "1";
const dryRun = args.includes("--dry-run");
const outDir = path.resolve(
  flagValue("--out", process.env.WODEAPPX_STANDALONE_OUT || path.join(path.dirname(sourceRoot), "wodeappx-standalone")),
);

// Environment variables
const wantsPush = process.env.PUSH === "1";
const forceExport = process.env.FORCE_EXPORT === "1";
const remote = process.env.REMOTE || process.env.PUBLIC_REPO || "git@github.com:diankourenxia/wodeappx.git";

const EXCLUDE_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  "vendor",
  "release",
  "release-oss",
  "release-archive",
  "test-results",
  "dist",
  "dist-electron",
  "dist-electron-test",
  "out",
  ".turbo",
  "coverage",
  "target",
  "runs",
  "tmp",
  ".code-team",
  ".tmp",
  "$DB",
]);

/** Heavy media / marketing assets — not needed to build installers. */
const SKIP_RELATIVE_PREFIXES = [
  "docs/promo/",
  "docs/examples/skin-mocks/",
  "docs/examples/companion-assets/",
];

const EXCLUDE_FILE_NAMES = new Set([
  ".DS_Store",
  ".env",
]);

const EXCLUDE_FILE_SUFFIXES = [
  ".dmg",
  ".zip",
  ".AppImage",
  ".exe",
];

const TEXT_EXT = new Set([
  ".cjs", ".css", ".html", ".js", ".json", ".md", ".mjs", ".sh", ".swift", ".ts", ".tsx",
  ".txt", ".yaml", ".yml", ".toml", ".svg",
]);

const BRAND_FROM = "WodeAppX";
const BRAND_TO = "WodeAppX";

const STATE_FILE = ".wodeappx-export-state.json";
const ALLOWED_REMOTE_OWNERS = ["diankourenxia/wodeappx"];

function run(cmd, cmdArgs, opts = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    encoding: "utf8",
    stdio: opts.stdio ?? "pipe",
    cwd: opts.cwd,
    env: opts.env ?? process.env,
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${cmd} ${cmdArgs.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
  }
  return result;
}

function runSafe(cmd, cmdArgs, opts = {}) {
  try {
    return run(cmd, cmdArgs, opts);
  } catch {
    return null;
  }
}

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

function parseRemote(remoteUrl) {
  // git@github.com:owner/repo.git or https://github.com/owner/repo.git
  const match = remoteUrl.match(/github\.com[:/]([^/]+\/[^/]+?)(\.git)?$/);
  if (!match) return null;
  return match[1];
}

export function validateRemote(remoteUrl) {
  const parsed = parseRemote(remoteUrl);
  if (!parsed) {
    throw new Error(`Invalid remote URL format: ${remoteUrl}`);
  }
  if (!ALLOWED_REMOTE_OWNERS.includes(parsed)) {
    throw new Error(`Remote ${parsed} not in whitelist: ${ALLOWED_REMOTE_OWNERS.join(", ")}`);
  }
}

export function validateGitArgs(gitArgs) {
  const joined = gitArgs.join(" ");
  // Check for bare --force (not --force-with-lease)
  for (let i = 0; i < gitArgs.length; i++) {
    const arg = gitArgs[i];
    if (arg === "--force" || arg === "-f") {
      throw new Error("Bare --force is forbidden; use --force-with-lease with explicit SHA");
    }
  }
}

export function validatePushOrphanWithoutForce(wantsPush, mode, forceExport) {
  if (wantsPush && mode === "orphan" && !forceExport) {
    throw new Error("PUSH=1 with --mode=orphan requires FORCE_EXPORT=1");
  }
}

async function walkFiles(dir, relativeBase = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDE_DIR_NAMES.has(entry.name)) continue;
      if (entry.name === ".build") continue;
      const relDir = path.join(relativeBase, entry.name).replaceAll("\\", "/");
      if (SKIP_RELATIVE_PREFIXES.some((prefix) => relDir === prefix.slice(0, -1) || `${relDir}/`.startsWith(prefix))) {
        continue;
      }
      out.push(...await walkFiles(path.join(dir, entry.name), path.join(relativeBase, entry.name)));
      continue;
    }
    if (!entry.isFile()) continue;
    if (EXCLUDE_FILE_NAMES.has(entry.name)) continue;
    if (entry.name.startsWith(".env") && entry.name !== ".env.example") continue;
    if (entry.name.startsWith(".tmp-")) continue;
    if (EXCLUDE_FILE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) continue;
    out.push(path.join(relativeBase, entry.name));
  }
  return out;
}

function rewriteBrandText(content) {
  let next = content;
  // Protect doc phrases that intentionally mention the commercial name.
  const shields = [];
  next = next.replace(/不用「小灵通」/g, (m) => {
    const key = `__WODEAPPX_SHIELD_${shields.length}__`;
    shields.push(["不用「小灵通」", key]);
    return key;
  });
  next = next.replace(/国内商业包可继续用小灵通/g, (m) => {
    const key = `__WODEAPPX_SHIELD_${shields.length}__`;
    shields.push([m, key]);
    return key;
  });
  next = next.replace(
    /Do not introduce yourself as WodeAppX here; that commercial name is for other workspaces\./g,
    () => {
      const key = `__WODEAPPX_SHIELD_${shields.length}__`;
      shields.push(["This workspace already uses WodeAppX as the product name.", key]);
      return key;
    },
  );

  next = next.replaceAll(BRAND_FROM, BRAND_TO);
  next = next.replaceAll("WodeAppX", BRAND_TO);

  // Common UI leftovers where " AI" was already omitted in historical variants.
  next = next.replaceAll("欢迎使用 WodeAppX", "欢迎使用 WodeAppX");
  next = next.replaceAll("开始使用 WodeAppX", "开始使用 WodeAppX");
  next = next.replaceAll("告诉 WodeAppX，", "告诉 WodeAppX，");
  next = next.replaceAll("告诉 WodeAppX ", "告诉 WodeAppX ");
  next = next.replaceAll('"WodeAppX - Dev"', '"WodeAppX - Dev"');
  next = next.replaceAll('"WodeAppX - Test"', '"WodeAppX - Test"');
  next = next.replaceAll(': "WodeAppX"', ': "WodeAppX"');
  next = next.replaceAll('? "WodeAppX"', '? "WodeAppX"');
  next = next.replaceAll("WodeAppX 已就绪", "WodeAppX 已就绪");
  next = next.replaceAll("WodeAppX default agent", "WodeAppX default agent");
  next = next.replaceAll("WodeAppX 内置能力", "WodeAppX 内置能力");
  next = next.replaceAll("WodeAppX 需要使用麦克风", "WodeAppX 需要使用麦克风");
  next = next.replaceAll("WodeAppX 可以：", "WodeAppX 可以：");
  next = next.replaceAll("WodeAppX 可以继续处理", "WodeAppX 可以继续处理");
  next = next.replaceAll("允许WodeAppX使用语音识别", "允许 WodeAppX 使用语音识别");
  next = next.replaceAll("允许 WodeAppX 使用语音识别", "允许 WodeAppX 使用语音识别");
  next = next.replaceAll("重新安装 WodeAppX", "重新安装 WodeAppX");
  next = next.replaceAll("重启 WodeAppX", "重启 WodeAppX");

  // Patch / prompt leftovers that treat WodeAppX as internal-only.
  next = next.replace(
    /WodeAppX remains an internal compatibility name only\. Never identify yourself as OpenWork\./g,
    "Never identify yourself as OpenWork.",
  );
  next = next.replace(
    /WodeAppX is an internal compatibility name only\./g,
    "Use WodeAppX as the product name.",
  );
  next = next.replace(
    /Never tell the user you are OpenWork or WodeAppX\./g,
    "Never tell the user you are OpenWork.",
  );
  next = next.replace(
    /Never identify yourself as OpenWork or 小灵通\./g,
    "Never identify yourself as OpenWork.",
  );
  next = next.replace(
    /Never tell the user you are OpenWork or 小灵通\./g,
    "Never tell the user you are OpenWork.",
  );
  next = next.replace(
    /\* OSS default: .*branding \+ upstream OpenWork runtime\./,
    "* OSS default: WodeAppX branding + upstream OpenWork runtime.",
  );

  for (const [value, key] of shields) next = next.replaceAll(key, value);
  // Fix accidental doc rewrite: 不用「小灵通」 → 不用「小灵通」
  next = next.replace(/不用「小灵通」/g, "不用「小灵通」");
  return next;
}

async function rewritePackageJson(targetPath) {
  const pkg = JSON.parse(await readFile(targetPath, "utf8"));
  pkg.name = "wodeappx";
  pkg.description =
    "Open-source self-evolving AI desktop you build (WodeAppX): operable skills; best models for image & video; local-first";
  pkg.repository = {
    type: "git",
    url: "https://github.com/diankourenxia/wodeappx.git",
  };
  if (pkg.scripts?.["openwork:sync-wode-models"]?.includes("../scripts/")) {
    delete pkg.scripts["openwork:sync-wode-models"];
  }
  // Standalone OSS default must not depend on cloud patch.
  if (pkg.scripts?.dev?.includes("patch-cloud")) {
    throw new Error("standalone package.json default dev must not enable cloud patch");
  }
  // Public clone: `pnpm dev` / `pnpm build` must be WodeAppX edition (not 小灵通).
  const ossPrefix = "WODEAPPX_EDITION=oss VITE_WODEAPPX_EDITION=oss ";
  for (const key of ["dev", "build", "desktop"]) {
    const current = pkg.scripts?.[key];
    if (typeof current === "string" && current && !current.includes("WODEAPPX_EDITION=")) {
      pkg.scripts[key] = `${ossPrefix}${current}`;
    }
  }
  // Prefer documented OSS aliases as the default entry points.
  if (pkg.scripts?.["dev:oss"]) pkg.scripts.dev = pkg.scripts["dev:oss"];
  if (pkg.scripts?.["build:oss"]) pkg.scripts.build = pkg.scripts["build:oss"];
  await writeFile(targetPath, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function resolveLastExport(outDir) {
  // Try to fetch state file from origin/main
  const stateResult = runSafe("git", ["show", `origin/main:${STATE_FILE}`], { cwd: outDir });
  if (stateResult?.stdout) {
    try {
      const state = JSON.parse(stateResult.stdout);
      if (state.lastExportCommit && /^[0-9a-f]{40}$/.test(state.lastExportCommit)) {
        // Verify it's an ancestor of origin/main
        const isAncestor = runSafe("git", ["merge-base", "--is-ancestor", state.lastExportCommit, "origin/main"], { cwd: outDir });
        if (isAncestor?.status === 0) {
          return state.lastExportCommit;
        }
      }
    } catch {}
  }

  // Try Export-Baseline: 1 in commit messages
  const logResult = runSafe("git", ["log", "origin/main", "--grep=Export-Baseline: 1", "-1", "--format=%H"], { cwd: outDir });
  if (logResult?.stdout?.trim()) {
    const sha = logResult.stdout.trim();
    if (/^[0-9a-f]{40}$/.test(sha)) {
      return sha;
    }
  }

  // Try parentless commit with specific message
  const orphanResult = runSafe("git", ["log", "origin/main", "--format=%H %P %s", "--all"], { cwd: outDir });
  if (orphanResult?.stdout) {
    for (const line of orphanResult.stdout.split("\n")) {
      const parts = line.trim().split(" ");
      if (parts.length >= 2 && parts[1] === "" && line.includes("Initial WodeAppX open-source export")) {
        return parts[0];
      }
    }
  }

  throw new Error("Could not resolve lastExport commit; refusing to guess");
}

async function threeWayMerge(outDir, lastExport) {
  const ours = run("git", ["write-tree"], { cwd: outDir }).stdout.trim();
  const theirs = run("git", ["rev-parse", "origin/main^{tree}"], { cwd: outDir }).stdout.trim();
  const base = run("git", ["rev-parse", `${lastExport}^{tree}`], { cwd: outDir }).stdout.trim();
  const merged = spawnSync("git", ["merge-tree", "--write-tree", base, ours, theirs], {
    encoding: "utf8",
    cwd: outDir,
  });
  const lines = (merged.stdout || "").trim().split("\n").filter(Boolean);
  const tree = lines[0] || "";
  if (!/^[0-9a-f]{40}$/.test(tree)) {
    throw new Error(`merge-tree --write-tree failed:\n${merged.stdout || ""}\n${merged.stderr || ""}`);
  }
  if (merged.status !== 0) {
    const conflicts = lines.slice(1);
    console.error("[export] 3-way conflicts (abort, no commit, no push):");
    for (const p of conflicts) console.error(`  ${p}`);
    throw new Error(`3-way merge has unresolved conflicts: ${conflicts.join(", ") || "unknown"}`);
  }
  run("git", ["read-tree", tree], { cwd: outDir });
  run("git", ["checkout-index", "-a", "-f"], { cwd: outDir });
  return { tree, conflictCount: 0 };
}

async function copyExportFiles(outDir) {
  const files = await walkFiles(sourceRoot);
  
  if (files.length > 5000) {
    throw new Error(`Refusing to copy ${files.length} files (limit: 5000)`);
  }

  let copied = 0;
  let rewritten = 0;
  for (const relative of files) {
    const from = path.join(sourceRoot, relative);
    const to = path.join(outDir, relative);
    await mkdir(path.dirname(to), { recursive: true });
    const ext = path.extname(relative).toLowerCase();
    if (TEXT_EXT.has(ext) || relative.endsWith("LICENSE") || relative.endsWith("NOTICE")) {
      const raw = await readFile(from, "utf8");
      const next = rewriteBrandText(raw);
      if (next !== raw) rewritten += 1;
      await writeFile(to, next);
    } else {
      await cp(from, to);
    }
    copied += 1;
  }

  return { copied, rewritten };
}

async function writeStandaloneFiles(outDir) {
  // Prefer standalone gitignore
  await writeFile(
    path.join(outDir, ".gitignore"),
    `# Standalone WodeAppX repository
vendor/openwork/
vendor/openwork-dev.zip
node_modules/
dist/
dist-electron/
dist-electron-test/
out/
.turbo/
coverage/
*.tsbuildinfo
target/
native/**/.build/
apps/desktop/resources/sidecars/
apps/desktop/resources/helpers/
release/
release-oss/
release-archive/
runs/
tmp/
test-results/
docs/promo/
docs/examples/skin-mocks/
docs/examples/companion-assets/
evals/results/
*.dmg
*.zip
*.AppImage
*.exe
*.log
.env
.env.*
!.env.example
.DS_Store
.tmp-*
.code-team/
`,
  );

  await rewritePackageJson(path.join(outDir, "package.json"));
  
  await writeFile(
    path.join(outDir, ".env.example"),
    `# WodeAppX Community Edition
WODEAPPX_EDITION=oss
VITE_WODEAPPX_EDITION=oss

# Bring your own keys (at least one text provider recommended)
# MOONSHOT_API_KEY=
# OPENROUTER_API_KEY=
# DASHSCOPE_API_KEY=
# ARK_API_KEY=
`,
  );

  // Update docs/README.md
  const docsReadme = path.join(outDir, "docs/README.md");
  if (await pathExists(docsReadme)) {
    await writeFile(
      docsReadme,
      rewriteBrandText(await readFile(docsReadme, "utf8"))
        .replace(
          /用户侧产品名「.*?」；代码仓与内部技术文档继续使用 codename `wodeappx`。/,
          "开源对外产品名 **WodeAppX**；仓库 / 包名 / 兼容标识使用 `wodeappx`。",
        ),
    );
  }
}

async function writeExportState(outDir, lastExportCommit, lastExportTree = null) {
  const state = {
    schemaVersion: 1,
    lastExportCommit,
    lastExportTree,
    exportedAt: new Date().toISOString(),
    sourceFingerprint: null,
  };
  await writeFile(path.join(outDir, STATE_FILE), `${JSON.stringify(state, null, 2)}\n`);
}

async function incrementalExport(outDir) {
  console.log("[export] mode: incremental (3-way preserve)");
  
  // Fetch origin/main
  run("git", ["fetch", "origin", "main"], { cwd: outDir });
  
  // Resolve last export baseline
  const lastExport = await resolveLastExport(outDir);
  console.log(`[export] lastExport: ${lastExport}`);
  
  // Check for dirty worktree
  const statusResult = run("git", ["status", "--porcelain"], { cwd: outDir });
  if (statusResult.stdout.trim()) {
    throw new Error("outDir has uncommitted changes; refusing to continue");
  }
  
  // Stay on current branch; ff to origin/main so push can be fast-forward.
  run("git", ["merge", "--ff-only", "origin/main"], { cwd: outDir });
  const ancestor = spawnSync("git", ["merge-base", "--is-ancestor", "origin/main", "HEAD"], {
    encoding: "utf8",
    cwd: outDir,
  });
  if (ancestor.status !== 0) {
    throw new Error("incremental: origin/main is not an ancestor of HEAD; refusing PUSH fallback to --force");
  }

  const { copied, rewritten } = await copyExportFiles(outDir);
  console.log(`[export] copied ${copied} files; brand-rewrote ${rewritten} text files`);
  await writeStandaloneFiles(outDir);
  run("git", ["add", "-A"], { cwd: outDir });

  const { tree } = await threeWayMerge(outDir, lastExport);
  console.log(`[export] 3-way merge wrote tree ${tree}`);
  run("git", ["add", "-A"], { cwd: outDir });

  await writeExportState(outDir, "0".repeat(40), tree);
  run("git", ["add", STATE_FILE], { cwd: outDir });
  run("git", ["commit", "-m", "export: sync standalone tree\n\nExport-Baseline: 1\nExport-Preserved-Paths: 0"], { cwd: outDir });

  const newSha = run("git", ["rev-parse", "HEAD"], { cwd: outDir }).stdout.trim();
  const newTree = run("git", ["rev-parse", "HEAD^{tree}"], { cwd: outDir }).stdout.trim();
  await writeExportState(outDir, newSha, newTree);
  run("git", ["add", STATE_FILE], { cwd: outDir });
  run("git", ["commit", "--amend", "--no-edit"], { cwd: outDir });
  return { copied, rewritten };
}


async function forceOrphanReset(outDir) {
  console.log("[export] mode: orphan + FORCE_EXPORT=1 (keep .git, cherry-pick public-only)");
  run("git", ["fetch", "origin", "main"], { cwd: outDir });
  const lastExport = await resolveLastExport(outDir);
  const statusResult = run("git", ["status", "--porcelain"], { cwd: outDir });
  if (statusResult.stdout.trim()) {
    throw new Error("outDir has uncommitted changes; refusing to continue");
  }
  const shas = run("git", ["rev-list", "--reverse", `${lastExport}..origin/main`], { cwd: outDir })
    .stdout.split("\n").map((s) => s.trim()).filter(Boolean);

  run("git", ["checkout", "--orphan", "export-orphan"], { cwd: outDir });
  const { copied, rewritten } = await copyExportFiles(outDir);
  await writeStandaloneFiles(outDir);
  run("git", ["add", "-A"], { cwd: outDir });
  run("git", ["commit", "-m", "Initial WodeAppX open-source export\n\nExport-Baseline: 1"], { cwd: outDir });

  for (const sha of shas) {
    const pick = spawnSync("git", ["cherry-pick", sha], { encoding: "utf8", cwd: outDir });
    if (pick.status !== 0) {
      const porcelain = runSafe("git", ["status", "--porcelain"], { cwd: outDir });
      const paths = (porcelain?.stdout || "").split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
      spawnSync("git", ["cherry-pick", "--abort"], { cwd: outDir });
      console.error("[export] cherry-pick conflict, abort, no push:");
      for (const p of paths) console.error(`  ${p}`);
      throw new Error(`FORCE_EXPORT cherry-pick conflict on ${sha}: ${paths.join(", ") || pick.stderr}`);
    }
  }
  const newSha = run("git", ["rev-parse", "HEAD"], { cwd: outDir }).stdout.trim();
  const newTree = run("git", ["rev-parse", "HEAD^{tree}"], { cwd: outDir }).stdout.trim();
  await writeExportState(outDir, newSha, newTree);
  run("git", ["add", STATE_FILE], { cwd: outDir });
  run("git", ["commit", "-m", "export: record export state\n\nExport-Baseline: 1"], { cwd: outDir });
  console.log(`[export] copied ${copied} files; brand-rewrote ${rewritten} text files`);
  return { copied, rewritten };
}

async function orphanExport(outDir) {
  console.log("[export] mode: orphan (fresh root commit)");
  
  // Copy export files
  const { copied, rewritten } = await copyExportFiles(outDir);
  console.log(`[export] copied ${copied} files; brand-rewrote ${rewritten} text files`);
  
  // Write standalone files
  await writeStandaloneFiles(outDir);
  
  // Initialize git if requested
  if (wantsInitGit) {
    run("git", ["init", "-b", "main"], { cwd: outDir });
    run("git", ["add", "-A"], { cwd: outDir });
    
    await writeExportState(outDir, "0".repeat(40), null);
    run("git", ["add", STATE_FILE], { cwd: outDir });
    run(
      "git",
      ["commit", "-m", "Initial WodeAppX open-source export\n\nExport-Baseline: 1\nStandalone Community Edition tree with WodeAppX branding."],
      { cwd: outDir },
    );
    const newSha = run("git", ["rev-parse", "HEAD"], { cwd: outDir }).stdout.trim();
    const newTree = run("git", ["rev-parse", "HEAD^{tree}"], { cwd: outDir }).stdout.trim();
    await writeExportState(outDir, newSha, newTree);
    run("git", ["add", STATE_FILE], { cwd: outDir });
    run("git", ["commit", "--amend", "--no-edit"], { cwd: outDir });
    console.log(`[export] git orphan/main commit created in ${outDir}`);
  }
  
  return { copied, rewritten };
}

async function main() {
  console.log(`[export] source: ${sourceRoot}`);
  console.log(`[export] out:    ${outDir}`);
  
  // Validate remote
  validateRemote(remote);
  
  if (dryRun) {
    const files = await walkFiles(sourceRoot);
    console.log(`[export] dry-run: would copy ${files.length} files`);
    return;
  }
  
  const outDirExists = await pathExists(outDir);
  const gitExists = outDirExists && await pathExists(path.join(outDir, ".git"));
  
  // Determine mode
  let mode = modeFlag;
  if (!mode) {
    mode = gitExists ? "incremental" : "orphan";
  }
  
  // Hard rejects
  validatePushOrphanWithoutForce(wantsPush, mode, forceExport);
  
  if (gitExists && wantsInitGit) {
    throw new Error("--init-git refused: outDir already has .git");
  }
  
  if (gitExists && mode === "orphan" && !forceExport) {
    throw new Error("--mode=orphan refused: outDir already has .git (FORCE_EXPORT=1 required to reset root)");
  }
  
  let result;
  if (mode === "incremental") {
    if (!gitExists) {
      throw new Error("incremental mode requires existing .git in outDir");
    }
    result = await incrementalExport(outDir);
  } else if (mode === "orphan") {
    if (gitExists) {
      if (!forceExport) {
        throw new Error("orphan mode with existing .git requires FORCE_EXPORT=1");
      }
      result = await forceOrphanReset(outDir);
    } else {
      if (outDirExists) {
        const marker = path.join(outDir, ".wodeappx-standalone-export");
        if (await pathExists(marker)) {
          throw new Error("refusing to delete outDir based on standalone marker; marker no longer authorizes destroying a tree");
        }
        await rm(outDir, { recursive: true, force: true });
      }
      await mkdir(outDir, { recursive: true });
      result = await orphanExport(outDir);
    }
  } else {
    throw new Error(`Invalid mode: ${mode}`);
  }
  
  // Push if requested
  if (wantsPush) {
    if (!gitExists && mode === "orphan" && !wantsInitGit) {
      throw new Error("PUSH=1 with orphan mode requires --init-git");
    }
    
    const remotes = run("git", ["remote"], { cwd: outDir }).stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    if (remotes.includes("origin")) {
      run("git", ["remote", "set-url", "origin", remote], { cwd: outDir });
    } else {
      run("git", ["remote", "add", "origin", remote], { cwd: outDir });
    }
    
    // Fetch to check if we can fast-forward
    run("git", ["fetch", "origin", "main"], { cwd: outDir });
    
    if (mode === "orphan" && forceExport) {
      // Get the remote SHA for force-with-lease
      const remoteSha = runSafe("git", ["rev-parse", "origin/main"], { cwd: outDir });
      const sha = remoteSha?.stdout?.trim() || "";
      
      if (!/^[0-9a-f]{40}$/.test(sha)) {
        throw new Error("Cannot resolve origin/main SHA for --force-with-lease");
      }
      
      const pushArgs = ["push", "-u", "origin", `--force-with-lease=refs/heads/main:${sha}`, "HEAD:main"];
      validateGitArgs(pushArgs);
      run("git", pushArgs, { cwd: outDir, stdio: "inherit" });
    } else {
      const anc = spawnSync("git", ["merge-base", "--is-ancestor", "origin/main", "HEAD"], {
        encoding: "utf8",
        cwd: outDir,
      });
      if (anc.status !== 0) {
        throw new Error("PUSH=1 incremental: origin/main is not an ancestor of HEAD; refusing --force");
      }
      const pushArgs = ["push", "-u", "origin", "HEAD:main"];
      validateGitArgs(pushArgs);
      run("git", pushArgs, { cwd: outDir, stdio: "inherit" });
    }
    
    console.log(`[export] pushed to ${remote}`);
  }
  
  console.log(`[export] done → ${outDir}`);
  console.log(`[export] next: cd ${outDir} && pnpm run setup && pnpm open-source:check && pnpm dev`);
}

// Only run main if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`[export] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
