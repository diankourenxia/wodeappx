#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const errors = [];
const warnings = [];
const CJK = /[\u3400-\u9fff]/;
const CORE_PREFIXES = [
  "common.",
  "composer.",
  "extensions.",
  "session.",
  "settings.",
  "status.",
  "welcome.",
  "wodeapp.",
  "wodeappx.",
  "workspace.",
  "workspace_list.",
];

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function parseLocaleSource(source) {
  const values = new Map();
  const entryPattern = /^\s*("(?:\\.|[^"\\])*")\s*:\s*("(?:\\.|[^"\\])*")\s*,?\s*$/gm;
  for (const match of source.matchAll(entryPattern)) {
    values.set(JSON.parse(match[1]), JSON.parse(match[2]));
  }
  return values;
}

const indexPath = path.join(root, "integrations/openwork/fork/apps/app/src/i18n/index.ts");
const indexSource = await readFile(indexPath, "utf8");
for (const marker of [
  'let localeValue: Language = "en"',
  "export const resolveNavigatorLanguage",
  "explicit user choice -> operating-system locale -> English",
]) {
  if (!indexSource.includes(marker)) errors.push(`locale initialization is missing: ${marker}`);
}
if (indexSource.includes("LANGUAGE_ZH_MIGRATION_KEY")) {
  errors.push("OSS locale initialization must not force-migrate users to Chinese");
}

const overrides = JSON.parse(
  await readFile(path.join(root, "integrations/openwork/i18n/oss-overrides.json"), "utf8"),
);
for (const locale of ["en", "zh"]) {
  if (!overrides[locale] || typeof overrides[locale] !== "object") {
    errors.push(`missing maintained ${locale} locale overlay`);
  }
}
for (const [key, value] of Object.entries(overrides.en ?? {})) {
  if (CJK.test(String(value))) errors.push(`English overlay contains CJK text: ${key}`);
}

const maintainedWodeAppXKeys = new Set([
  ...Object.keys(overrides.en ?? {}).filter((key) => key.startsWith("wodeappx.")),
  ...Object.keys(overrides.zh ?? {}).filter((key) => key.startsWith("wodeappx.")),
]);
for (const key of maintainedWodeAppXKeys) {
  if (!(key in (overrides.en ?? {}))) errors.push(`English WodeAppX overlay is missing key: ${key}`);
  if (!(key in (overrides.zh ?? {}))) errors.push(`Chinese WodeAppX overlay is missing key: ${key}`);
}

for (const relativePath of [
  "integrations/openwork/wodeapp/wodeapp-main-chrome.tsx",
  "integrations/openwork/wodeapp/wodeapp-workbench-sidebar.tsx",
  "integrations/openwork/wodeapp/wodeapp-account-footer.tsx",
  "integrations/openwork/wodeapp/wodeapp-sidebar-updater.tsx",
  "integrations/openwork/wodeapp/wodeapp-session-starters.tsx",
  "integrations/openwork/wodeapp/wodeapp-workbench-shell.tsx",
]) {
  const source = await readFile(path.join(root, relativePath), "utf8");
  for (const match of source.matchAll(/t\([`\"](wodeappx\.[^`\"$]+)[`\"]/g)) {
    const key = match[1];
    if (!(key in (overrides.en ?? {}))) errors.push(`used WodeAppX key is missing from English overlay: ${key}`);
    if (!(key in (overrides.zh ?? {}))) errors.push(`used WodeAppX key is missing from Chinese overlay: ${key}`);
  }
}

const localeRoot = path.join(root, "vendor/openwork/apps/app/src/i18n/locales");
const enPath = path.join(localeRoot, "en.ts");
const zhPath = path.join(localeRoot, "zh.ts");
if (await exists(enPath) && await exists(zhPath)) {
  const en = parseLocaleSource(await readFile(enPath, "utf8"));
  const zh = parseLocaleSource(await readFile(zhPath, "utf8"));

  if (en.size < 1000 || zh.size < 1000) errors.push(`locale parser saw too few entries: en=${en.size}, zh=${zh.size}`);
  for (const [key, expected] of Object.entries(overrides.en ?? {})) {
    if (en.get(key) !== expected) errors.push(`English overlay was not applied: ${key}`);
  }
  for (const [key, expected] of Object.entries(overrides.zh ?? {})) {
    if (zh.get(key) !== expected) errors.push(`Chinese overlay was not applied: ${key}`);
  }

  for (const [key, value] of en) {
    if (CJK.test(value)) errors.push(`English locale contains CJK text: ${key}`);
    if (CORE_PREFIXES.some((prefix) => key.startsWith(prefix)) && !zh.has(key)) {
      errors.push(`Chinese core locale is missing key: ${key}`);
    }
  }

  const nonCoreMissing = [...en.keys()].filter(
    (key) => !zh.has(key) && !CORE_PREFIXES.some((prefix) => key.startsWith(prefix)),
  );
  if (nonCoreMissing.length) {
    warnings.push(`${nonCoreMissing.length} non-core upstream keys use the documented English fallback`);
  }
  console.log(`[i18n] vendor checked: en=${en.size}, zh-CN=${zh.size}`);
} else {
  console.log("[i18n] source contract checked; vendor locale checks run after pnpm setup");
}

for (const warning of warnings) console.warn(`[i18n] warning: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`[i18n] error: ${error}`);
  console.error(`[i18n] failed with ${errors.length} issue(s)`);
  process.exit(1);
}

console.log(`[i18n] ready: English and Simplified Chinese core contract, ${warnings.length} warning(s)`);
