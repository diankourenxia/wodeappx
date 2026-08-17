#!/usr/bin/env node
/**
 * Rewrite packaged desktop brand strings from commercial WodeAppX → WodeAppX
 * after openwork + cloud patches. Used by OSS / community test packages, and
 * as the post-apply safety net so leftover vendor copy cannot ship as 小灵通.
 *
 * Prefer setting WODEAPPX_EDITION=oss for runtime/dev; this script is the
 * post-patch safety net for vendor strings that still say WodeAppX.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { editionProcessEnv } from "./wodeapp-edition.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const vendor = path.join(root, "vendor/openwork");

const SKIP_DIR = new Set([
  "node_modules", "dist", "dist-electron", ".git", "coverage", "out",
  "helpers", "sidecars", "self-evolve-source", "icons",
]);
const TEXT_EXT = new Set([
  ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".yml", ".yaml",
  ".html", ".htm", ".md", ".txt", ".css", ".svg", ".plist", ".xml",
]);
const SKIP_BASENAME = new Set(["wodeapp-edition.ts", "wodeapp-edition.mjs"]);

const LEGACY_TARGETS = [
  "apps/desktop/electron-builder.yml",
  "apps/desktop/electron/main.mjs",
  "apps/desktop/electron/runtime.mjs",
  "apps/desktop/scripts/electron-dev.mjs",
  "apps/app/index.html",
  "apps/app/src/react-app/shell/shell-config.tsx",
  "apps/app/src/react-app/shell/session-route.tsx",
  "apps/app/src/i18n/locales/zh.json",
  "apps/app/src/i18n/locales/en.json",
  "apps/app/src/i18n/locales/zh.ts",
  "apps/app/src/i18n/locales/en.ts",
];

function rewrite(content) {
  let next = content;
  const shields = [];
  const shield = (pattern, restore = null) => {
    next = next.replace(pattern, (match) => {
      const key = `__WODEAPPX_BRAND_SHIELD_${shields.length}__`;
      shields.push([restore ?? match, key]);
      return key;
    });
  };

  shield(/Do not introduce yourself as WodeAppX here; that commercial name is for other workspaces\./g);
  shield(/Do not introduce yourself as WodeAppX/g);
  shield(/!== "WodeAppX"/g);
  shield(/=== "WodeAppX"/g);
  shield(/"WodeAppX\.app"/g);
  shield(/不用「小灵通」/g, "不用「小灵通」");
  shield(/不要写「小灵通」/g);
  shield(/登录小灵通/g);

  next = next.replaceAll("WodeAppX", "WodeAppX");
  next = next.replaceAll("WodeAppX", "WodeAppX");
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
  next = next.replaceAll("重新安装 WodeAppX", "重新安装 WodeAppX");
  next = next.replaceAll("重启 WodeAppX", "重启 WodeAppX");

  for (const [value, key] of shields) next = next.replaceAll(key, value);
  return next;
}

async function collectTextFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "." || entry.name === "..") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name) || entry.name.startsWith(".") || entry.name.endsWith(".app")) continue;
      files.push(...await collectTextFiles(full));
      continue;
    }
    if (SKIP_BASENAME.has(entry.name)) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!TEXT_EXT.has(ext)) continue;
    files.push(full);
  }
  return files;
}

export async function applyOssProductBrand(vendorRoot = vendor) {
  const files = new Set(await collectTextFiles(vendorRoot));
  for (const relative of LEGACY_TARGETS) {
    files.add(path.join(vendorRoot, relative));
  }

  let changedFiles = 0;
  for (const absolute of files) {
    let raw;
    try {
      raw = await readFile(absolute, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") {
        if (LEGACY_TARGETS.some((relative) => absolute.endsWith(relative))) {
          console.warn(`[oss-brand] skip missing ${path.relative(vendorRoot, absolute)}`);
        }
        continue;
      }
      throw error;
    }
    if (raw.includes("\0")) continue;
    const next = rewrite(raw);
    if (next !== raw) {
      await writeFile(absolute, next);
      changedFiles += 1;
      console.log(`[oss-brand] updated ${path.relative(vendorRoot, absolute)}`);
    }
  }

  console.log(`[oss-brand] done, ${changedFiles} file(s) changed`);
  return changedFiles;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  Object.assign(process.env, editionProcessEnv("oss", process.env));
  await applyOssProductBrand();
}
