#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vendor = path.join(root, "vendor/openwork");
const appRoot = path.join(vendor, "apps/app");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

const result = spawnSync(pnpm, ["audit", "--prod", "--json"], {
  cwd: vendor,
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});

if (result.error) throw result.error;
if (!result.stdout.trim()) {
  throw new Error(`pnpm audit returned no JSON${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
}

const report = JSON.parse(result.stdout);
const advisories = Object.values(report.advisories ?? {});
const blockingSeverities = new Set(["moderate", "high", "critical"]);
const blocking = advisories.filter((item) => blockingSeverities.has(item.severity));

const appPackage = JSON.parse(await readFile(path.join(appRoot, "package.json"), "utf8"));
const components = JSON.parse(await readFile(path.join(appRoot, "components.json"), "utf8"));
const appDependencies = { ...(appPackage.dependencies ?? {}), ...(appPackage.devDependencies ?? {}) };

const rscException = {
  advisory: "GHSA-qwww-vcr4-c8h2",
  expiresOn: "2026-12-31",
  reason: "The Electron renderer is a Vite SPA with shadcn RSC explicitly disabled; it has no React Router framework/RSC server runtime or server actions.",
};

function isNarrowRscException(advisory) {
  if (advisory.github_advisory_id !== rscException.advisory) return false;
  if (advisory.module_name !== "react-router" || advisory.severity !== "high") return false;
  if (Date.now() > Date.parse(`${rscException.expiresOn}T23:59:59Z`)) return false;
  if (appDependencies["react-router-dom"] !== "7.18.2") return false;
  if (appDependencies["react-router"] || Object.keys(appDependencies).some((name) => name.startsWith("@react-router/"))) return false;
  if (components.rsc !== false) return false;
  const findings = advisory.findings ?? [];
  return findings.length > 0 && findings.every((finding) =>
    finding.version === "7.18.2"
    && (finding.paths ?? []).length > 0
    && finding.paths.every((entry) => entry === "apps__app>react-router-dom>react-router"));
}

const allowed = blocking.filter(isNarrowRscException);
const unexpected = blocking.filter((item) => !isNarrowRscException(item));

if (unexpected.length > 0) {
  for (const advisory of unexpected) {
    console.error(`[security] ${advisory.severity}: ${advisory.github_advisory_id ?? advisory.id} ${advisory.module_name} — ${advisory.title}`);
  }
  process.exitCode = 1;
} else {
  const counts = report.metadata?.vulnerabilities ?? {};
  console.log(`[security] audit checked: critical=${counts.critical ?? 0}, high=${counts.high ?? 0}, moderate=${counts.moderate ?? 0}, low=${counts.low ?? 0}`);
  for (const advisory of allowed) {
    console.warn(`[security] scoped exception: ${advisory.github_advisory_id} until ${rscException.expiresOn} — ${rscException.reason}`);
  }
  console.log("[security] ready: no applicable moderate, high, or critical production dependency advisories");
}
