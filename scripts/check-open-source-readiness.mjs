#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const errors = [];
const warnings = [];

const requiredFiles = [
  "LICENSE",
  "NOTICE",
  "THIRD_PARTY_LICENSES/OpenWork-LICENSE.txt",
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "TRADEMARK.md",
  "CODE_OF_CONDUCT.md",
  "branding/wodeapp-icon-source.png",
  "branding/wodeappx-logo-180.png",
  "openwork.lock.json",
  "docs/OPEN_SOURCE_PLAN.md",
  "scripts/bootstrap-openwork.mjs",
  "scripts/apply-openwork-integration.mjs",
];

const excludedDirectories = new Set([".git", "node_modules", "vendor", "release", "test-results", "dist", "dist-electron"]);
const textExtensions = new Set([".cjs", ".css", ".html", ".js", ".json", ".md", ".mjs", ".sh", ".ts", ".tsx", ".yaml", ".yml"]);

async function exists(relativePath) {
  try {
    await stat(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), "utf8"));
}

async function walk(directory, relativeBase = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const relativePath = path.join(relativeBase, entry.name);
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolutePath, relativePath));
    else if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

for (const file of requiredFiles) {
  if (!await exists(file)) errors.push(`missing required open-source file: ${file}`);
}

const packageJson = await readJson("package.json");
if (packageJson.license !== "Apache-2.0") errors.push("package.json license must be Apache-2.0");
if ((packageJson.scripts?.dev ?? "").includes("patch-cloud")) errors.push("default pnpm dev must not enable the cloud patch");
for (const script of ["setup", "dev", "build", "open-source:check"]) {
  if (!packageJson.scripts?.[script]) errors.push(`package.json is missing the ${script} script`);
}
for (const script of ["setup", "dev", "build"]) {
  if ((packageJson.scripts?.[script] ?? "").includes("../scripts/")) {
    errors.push(`${script} depends on a parent monorepo path and will fail in the standalone repository`);
  }
}

if (await exists(".wodeappx-standalone-export")) {
  const repoUrl = String(packageJson.repository?.url || "");
  if (!repoUrl.includes("diankourenxia/wodeappx") && !repoUrl.includes("wodeapp/wodeappx")) {
    errors.push("standalone package.json repository.url must point at the public WodeAppX repo");
  }
  for (const script of ["dev", "build"]) {
    const value = String(packageJson.scripts?.[script] || "");
    if (!value.includes("WODEAPPX_EDITION=oss")) {
      errors.push(`standalone ${script} must set WODEAPPX_EDITION=oss (got: ${value || "(missing)"})`);
    }
  }
  if (await exists("integrations/openwork/wodeapp/wodeapp-byok-guide-dialog.tsx")) {
    const byok = await readFile(path.join(root, "integrations/openwork/wodeapp/wodeapp-byok-guide-dialog.tsx"), "utf8");
    if (byok.includes("登录云端")) {
      errors.push("standalone BYOK guide must not offer 登录云端");
    }
  }
}

const lock = await readJson("openwork.lock.json");
if (!/^[0-9a-f]{40}$/.test(lock.commit ?? "")) errors.push("OpenWork lock must use a full 40-character commit SHA");
if (!/^[0-9a-f]{64}$/.test(lock.sha256 ?? "")) errors.push("OpenWork lock must contain the archive SHA-256");
if (lock.version !== packageJson.version) warnings.push(`OpenWork ${lock.version} differs from WodeAppX ${packageJson.version}; verify this is intentional`);

const integrationScript = await readFile(path.join(root, "scripts/apply-openwork-integration.mjs"), "utf8");
const mappingPattern = /\["([^"]+)",\s*"([^"]+)"\]/g;
for (const match of integrationScript.matchAll(mappingPattern)) {
  const source = match[1];
  if ((source.startsWith("fork/") || source.startsWith("wodeapp/") || source.startsWith("tests/"))
      && !await exists(path.join("integrations/openwork", source))) {
    errors.push(`fork-owned OpenWork template is missing: integrations/openwork/${source}`);
  }
}

if (integrationScript.includes("vendor/openwork/ee")) errors.push("the source integration must not copy OpenWork ee code");
const forkPnpmLock = await readFile(path.join(root, "integrations/openwork/fork/pnpm-lock.yaml"), "utf8");
if (/^  ee\//m.test(forkPnpmLock)) errors.push("fork pnpm lock still contains OpenWork ee workspace importers");
if (await exists("vendor/openwork/.wodeappx-upstream.json")) {
  if (await exists("vendor/openwork/ee")) errors.push("verified vendor contains the non-OSS OpenWork ee directory");
  const vendorWorkspace = await readFile(path.join(root, "vendor/openwork/pnpm-workspace.yaml"), "utf8");
  if (vendorWorkspace.includes('"ee/')) errors.push("verified vendor workspace still includes OpenWork ee packages");
  const vendorPnpmLock = await readFile(path.join(root, "vendor/openwork/pnpm-lock.yaml"), "utf8");
  if (/^  ee\//m.test(vendorPnpmLock)) errors.push("verified vendor lock still contains OpenWork ee workspace importers");
}
const shellCssPath = "integrations/openwork/wodeapp/wodeapp-shell.css";
if (await exists(shellCssPath)) {
  const shellCss = await readFile(path.join(root, shellCssPath), "utf8");
  const heroMarkerCount = shellCss.split(".wapp-session-surface-top-composer .wapp-session-hero-kicker").length - 1;
  if (heroMarkerCount > 2) errors.push(`wodeapp-shell.css contains a duplicated hero block (${heroMarkerCount} marker occurrences)`);
}

const allFiles = await walk(root);
for (const file of allFiles) {
  const base = path.basename(file);
  if (base.startsWith(".env") && base !== ".env.example") errors.push(`environment file must not be published: ${file}`);
  if (base === "brand-agents.json" && !file.includes(`${path.sep}examples${path.sep}`)) {
    errors.push(`customer brand-agents.json must not be published: ${file} (keep under ~/.wodeapp/ or docs/examples/*.example.json)`);
  }
}

const secretPatterns = [
  ["OpenAI-style key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/g],
  ["WodeApp live key", /\bsk_live_[A-Za-z0-9_-]{16,}\b/g],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/g],
  ["Slack token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];

for (const file of allFiles) {
  if (!textExtensions.has(path.extname(file)) || file === "scripts/check-open-source-readiness.mjs") continue;
  // Unit/integration fixtures intentionally use fake sk_live_/sk-/ghp_ samples.
  if (/\.(?:test|spec)\.(?:[cm]?[jt]s|tsx)$/.test(file) || /(^|\/)(?:__)?tests?(?:\/|$)/.test(file)) {
    continue;
  }
  const content = await readFile(path.join(root, file), "utf8");
  for (const [label, pattern] of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(content)) errors.push(`${label} candidate found in ${file}`);
  }
}

try {
  const tracked = execFileSync("git", ["-C", root, "ls-files", "--", "."], { encoding: "utf8" })
    .split("\n")
    .filter(Boolean)
    .map((file) => file.replace(/^wodeappx\//, ""));
  for (const file of tracked) {
    if (file.startsWith("vendor/openwork/")) errors.push(`generated upstream vendor file is tracked: ${file}`);
    if (file.startsWith("test-results/") || file.startsWith("release/")) errors.push(`generated artifact is tracked: ${file}`);
    if (file.includes("/ee/") || file.startsWith("ee/")) errors.push(`non-OSS ee path is tracked: ${file}`);
    if (/(^|\/)brand-agents\.json$/.test(file) && !file.includes("/examples/")) {
      errors.push(`customer brand-agents.json is tracked: ${file}`);
    }
  }
} catch {
  warnings.push("git tracked-file checks were skipped");
}

for (const warning of warnings) console.warn(`[open-source] warning: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`[open-source] error: ${error}`);
  console.error(`[open-source] failed with ${errors.length} issue(s)`);
  process.exit(1);
}

console.log(`[open-source] ready: ${allFiles.length} source files checked, ${warnings.length} warning(s)`);
