#!/usr/bin/env node
/**
 * Export wodeappx as a standalone open-source git repository.
 *
 * - Product brand in the export is WodeAppX (not WodeAppX).
 * - Does not copy vendor/openwork (run `pnpm run setup` after clone).
 * - Creates an orphan commit by default (no private monorepo history).
 *
 * Usage:
 *   node scripts/export-standalone-repo.mjs
 *   node scripts/export-standalone-repo.mjs --out /path/to/wodeappx
 *   node scripts/export-standalone-repo.mjs --out ~/Desktop/wodeappx --init-git
 *   PUSH=1 REMOTE=git@github.com:diankourenxia/wodeappx.git node scripts/export-standalone-repo.mjs --out ~/Desktop/wodeappx --init-git
 */
import { spawnSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
function flagValue(name, fallback = "") {
  const idx = args.indexOf(name);
  if (idx === -1) return fallback;
  return args[idx + 1] ?? fallback;
}
const wantsInitGit = args.includes("--init-git") || process.env.INIT_GIT === "1";
const dryRun = args.includes("--dry-run");
const outDir = path.resolve(
  flagValue("--out", process.env.WODEAPPX_STANDALONE_OUT || path.join(path.dirname(sourceRoot), "wodeappx-standalone")),
);

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
  "runs", // context-bench / live harness artifacts
  "tmp",
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

async function pathExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
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

async function main() {
  console.log(`[export] source: ${sourceRoot}`);
  console.log(`[export] out:    ${outDir}`);
  if (dryRun) {
    const files = await walkFiles(sourceRoot);
    console.log(`[export] dry-run: would copy ${files.length} files`);
    return;
  }

  if (await pathExists(outDir)) {
    const marker = path.join(outDir, ".wodeappx-standalone-export");
    if (!(await pathExists(marker)) && (await pathExists(path.join(outDir, ".git")))) {
      throw new Error(`refusing to overwrite existing git repo without marker: ${outDir}`);
    }
    await rm(outDir, { recursive: true, force: true });
  }
  await mkdir(outDir, { recursive: true });

  const files = await walkFiles(sourceRoot);
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

  // Prefer standalone gitignore (vendor stays generated / untracked).
  const standaloneIgnore = path.join(outDir, ".gitignore-standalone");
  if (await pathExists(standaloneIgnore)) {
    // Standalone ignore historically versioned vendor; OSS readiness forbids that.
    // Keep excluding vendor and release artifacts.
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
.wodeappx-standalone-export
`,
    );
  }

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
  // README.md + README.en.md copied from source tree (multilingual)
  await writeFile(
    path.join(outDir, "docs/README.md"),
    rewriteBrandText(await readFile(path.join(outDir, "docs/README.md"), "utf8"))
      .replace(
        /用户侧产品名「.*?」；代码仓与内部技术文档继续使用 codename `wodeappx`。/,
        "开源对外产品名 **WodeAppX**；仓库 / 包名 / 兼容标识使用 `wodeappx`。",
      ),
  );
  await writeFile(
    path.join(outDir, ".wodeappx-standalone-export"),
    `${JSON.stringify({
      exportedAt: new Date().toISOString(),
      source: sourceRoot,
      brand: BRAND_TO,
      includesVendor: false,
    }, null, 2)}\n`,
  );

  // Drop monorepo-only cloud branding comments that confuse OSS readers? keep files.
  console.log(`[export] copied ${copied} files; brand-rewrote ${rewritten} text files`);

  if (wantsInitGit) {
    run("git", ["init", "-b", "main"], { cwd: outDir });
    run("git", ["add", "-A"], { cwd: outDir });
    run(
      "git",
      ["commit", "-m", "Initial WodeAppX open-source export\n\nStandalone Community Edition tree with WodeAppX branding."],
      { cwd: outDir },
    );
    console.log(`[export] git orphan/main commit created in ${outDir}`);
  }

  const remote = process.env.REMOTE || process.env.PUBLIC_REPO || "";
  if (process.env.PUSH === "1") {
    if (!remote) throw new Error("PUSH=1 requires REMOTE=git@github.com:diankourenxia/wodeappx.git");
    if (!wantsInitGit) throw new Error("PUSH=1 requires --init-git");
    const remotes = run("git", ["remote"], { cwd: outDir }).stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    if (remotes.includes("origin")) {
      run("git", ["remote", "set-url", "origin", remote], { cwd: outDir });
    } else {
      run("git", ["remote", "add", "origin", remote], { cwd: outDir });
    }
    run("git", ["push", "-u", "origin", "HEAD:main"], { cwd: outDir, stdio: "inherit" });
    console.log(`[export] pushed to ${remote}`);
  }

  console.log(`[export] done → ${outDir}`);
  console.log(`[export] next: cd ${outDir} && pnpm run setup && pnpm open-source:check && pnpm dev`);
}

main().catch((error) => {
  console.error(`[export] ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
