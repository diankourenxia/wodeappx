#!/usr/bin/env node
/**
 * Runs inside the isolated Linux container on the VPS.
 * Do not point this at /var/www/wodeapp.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  emptyReport,
  finalizeReport,
  parsePhases,
} from "./oss-vps-verify-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(root, "oss-verify-report.json");

function run(command, args, { timeoutMs } = {}) {
  const started = Date.now();
  execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
    timeout: timeoutMs,
    env: {
      ...process.env,
      CI: "1",
      SHELL: process.env.SHELL || "/bin/bash",
      COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
      ELECTRON_MIRROR: process.env.ELECTRON_MIRROR || "https://npmmirror.com/mirrors/electron/",
      ELECTRON_BUILDER_BINARIES_MIRROR:
        process.env.ELECTRON_BUILDER_BINARIES_MIRROR
        || "https://npmmirror.com/mirrors/electron-builder-binaries/",
    },
  });
  return Date.now() - started;
}

function hashVendor() {
  return execFileSync(
    "bash",
    ["-lc", "find vendor/openwork -type f -print0 | sort -z | xargs -0 sha256sum"],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
}

const phases = parsePhases(process.env.WODEAPPX_OSS_PHASES || process.argv.slice(2).join(",") || "contract,setup,patch-idempotent");
const report = emptyReport({
  host: process.env.HOSTNAME || "container",
  remoteDir: root,
  image: process.env.WODEAPPX_OSS_VERIFY_IMAGE || "",
  phases,
});

try {
  if (phases.includes("contract")) {
    const elapsedMs = run("node", ["scripts/check-open-source-readiness.mjs"], { timeoutMs: 120_000 });
    report.results.contract = { ok: true, elapsedMs };
  }
  if (phases.includes("setup")) {
    const elapsedMs = run("pnpm", ["run", "setup"], { timeoutMs: 50 * 60_000 });
    if (!existsSync(path.join(root, "vendor/openwork/.wodeappx-upstream.json"))) {
      throw new Error("pnpm run setup finished without vendor/openwork; do not call builtin `pnpm setup`");
    }
    report.results.setup = { ok: true, elapsedMs };
  }
  if (phases.includes("patch-idempotent")) {
    const started = Date.now();
    run("pnpm", ["openwork:patch"], { timeoutMs: 15 * 60_000 });
    const first = hashVendor();
    run("pnpm", ["openwork:patch"], { timeoutMs: 15 * 60_000 });
    const second = hashVendor();
    if (first !== second) throw new Error("openwork:patch is not idempotent");
    report.results.patchIdempotent = { ok: true, elapsedMs: Date.now() - started };
  }
  finalizeReport(report);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  report.notes.push(message);
  const current = phases.find((phase) => !report.results[phase === "patch-idempotent" ? "patchIdempotent" : phase]);
  if (current) {
    const key = current === "patch-idempotent" ? "patchIdempotent" : current;
    report.results[key] = { ok: false, error: message };
  }
  finalizeReport(report);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.error(`[oss-verify-remote] FAIL: ${message}`);
  process.exit(1);
}

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`[oss-verify-remote] ${report.verdict} → ${reportPath}`);
