export const PHASES = ["export", "contract", "setup", "patch-idempotent"];
export const DEFAULT_REMOTE_DIR = "/opt/wodeappx-oss-verify";
export const DEFAULT_IMAGE = "docker.m.daocloud.io/library/node:22-bookworm";
export const DEFAULT_HOST = "wode-cn-tencent";
export const PNPM_VERSION = "9.15.0";
export const CONTAINER_NAME = "wodeappx-oss-verify";

const BLOCKED_REMOTE_PREFIXES = [
  "/var/www/wodeapp",
  "/root/wodeapp",
  "/home/ubuntu/wodeapp",
];

export function parsePhases(raw) {
  const text = String(raw ?? "").trim();
  const list = (text ? text.split(",") : PHASES)
    .map((item) => item.trim())
    .filter(Boolean);
  if (list.length === 0) throw new Error("at least one --phase is required");
  for (const phase of list) {
    if (!PHASES.includes(phase)) {
      throw new Error(`unknown phase "${phase}"; allowed: ${PHASES.join(", ")}`);
    }
  }
  return [...new Set(list)];
}

export function parseArgs(argv) {
  const args = argv.slice(2);
  const flags = new Map();
  const booleans = new Set();
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith("--")) {
      booleans.add(key);
      continue;
    }
    flags.set(key, next);
    i += 1;
  }
  return {
    host: flags.get("host") || process.env.WODEAPPX_OSS_VERIFY_HOST || DEFAULT_HOST,
    remoteDir: flags.get("remote-dir") || process.env.WODEAPPX_OSS_VERIFY_DIR || DEFAULT_REMOTE_DIR,
    image: flags.get("image") || process.env.WODEAPPX_OSS_VERIFY_IMAGE || DEFAULT_IMAGE,
    out: flags.get("out") || "",
    tree: flags.get("tree") || "",
    phases: parsePhases(flags.get("phase")),
    skipExport: booleans.has("skip-export"),
    localOnly: booleans.has("local-only"),
    cleanup: booleans.has("cleanup"),
    keepContainer: booleans.has("keep"),
    keepRemoteVendor: booleans.has("keep-remote-vendor"),
  };
}

export function assertSafeRemoteDir(remoteDir) {
  const dir = String(remoteDir || "").replace(/\/+$/, "") || "/";
  if (dir === "/" || dir === "/opt" || dir === "/var" || dir === "/home" || dir === "/root") {
    throw new Error(`refusing unsafe remote dir: ${dir}`);
  }
  for (const prefix of BLOCKED_REMOTE_PREFIXES) {
    if (dir === prefix || dir.startsWith(`${prefix}/`)) {
      throw new Error(`refusing to use production path: ${dir}`);
    }
  }
  if (!dir.startsWith("/opt/wodeappx-oss-verify") && !dir.startsWith("/tmp/wodeappx-oss-verify")) {
    throw new Error(`remote dir must be under /opt/wodeappx-oss-verify or /tmp/wodeappx-oss-verify (got ${dir})`);
  }
  return dir;
}

export function summarizeExportTree(relativePaths) {
  const files = relativePaths.map((file) => file.replaceAll("\\", "/"));
  const envFiles = files.filter((file) => {
    const base = file.split("/").pop();
    return base?.startsWith(".env") && base !== ".env.example";
  });
  const vendor = files.filter((file) => file === "vendor/openwork" || file.startsWith("vendor/openwork/"));
  const ee = files.filter((file) => file === "ee" || file.startsWith("ee/") || file.includes("/ee/"));
  const brandAgents = files.filter((file) => /(^|\/)brand-agents\.json$/.test(file) && !file.includes("/examples/"));
  return {
    fileCount: files.length,
    envFiles,
    vendorTracked: vendor,
    eePaths: ee,
    brandAgents,
    ok: envFiles.length === 0 && vendor.length === 0 && ee.length === 0 && brandAgents.length === 0,
  };
}

export function emptyReport({ host, remoteDir, image, phases }) {
  return {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    host: host || "local",
    remoteDir: remoteDir || "",
    image: image || "",
    phases,
    results: {},
    verdict: "FAIL",
    notes: [],
  };
}

export function finalizeReport(report) {
  const results = Object.values(report.results);
  const failed = results.filter((item) => item && item.ok === false);
  report.finishedAt = new Date().toISOString();
  report.verdict = failed.length === 0 && results.length > 0 ? "PASS" : "FAIL";
  return report;
}

export function buildAptBootstrapCommand(pnpmVersion = PNPM_VERSION) {
  // node:22-bookworm already has git/python3/make/g++/curl.
  // Do not apt-get update from Debian mirrors (hangs on CN VPS).
  return [
    "set -euo pipefail",
    "export COREPACK_ENABLE_DOWNLOAD_PROMPT=0",
    "export SHELL=/bin/bash",
    "git config --global --add safe.directory /work || true",
    "corepack enable",
    `corepack prepare pnpm@${pnpmVersion} --activate`,
    "node -v",
    "pnpm -v",
    "git --version",
  ].join(" && ");
}
