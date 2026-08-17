#!/usr/bin/env node
/**
 * Stranger-path OSS verify: export a standalone tree, then run it on an
 * isolated Docker container on a VPS. Never touches /var/www/wodeapp.
 *
 *   pnpm open-source:verify
 *   pnpm open-source:verify -- --local-only --phase export,contract
 *   pnpm open-source:verify -- --host wode-cn-tencent --phase export,contract,setup,patch-idempotent
 */
import { execFileSync } from "node:child_process";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertSafeRemoteDir,
  buildAptBootstrapCommand,
  CONTAINER_NAME,
  emptyReport,
  finalizeReport,
  parseArgs,
  PNPM_VERSION,
  summarizeExportTree,
} from "./oss-vps-verify-lib.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args, { cwd = root, timeoutMs, stdio = "inherit" } = {}) {
  return execFileSync(command, args, {
    cwd,
    stdio,
    timeout: timeoutMs,
    encoding: stdio === "pipe" ? "utf8" : undefined,
  });
}

async function walkRelative(dir, relativeBase = "") {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = path.join(relativeBase, entry.name);
    if (entry.isDirectory()) {
      if ([".git", "node_modules", "vendor", "tmp"].includes(entry.name)) continue;
      out.push(...await walkRelative(path.join(dir, entry.name), relative));
    } else if (entry.isFile()) {
      out.push(relative.replaceAll("\\", "/"));
    }
  }
  return out;
}

async function exportStandalone(outDir) {
  await rm(outDir, { recursive: true, force: true });
  run("node", ["scripts/export-standalone-repo.mjs", "--out", outDir, "--init-git"], {
    timeoutMs: 10 * 60_000,
  });
  const files = await walkRelative(outDir);
  return summarizeExportTree(files);
}

function ssh(host, remoteCommand, { timeoutMs } = {}) {
  return run("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", host, remoteCommand], {
    timeoutMs,
  });
}

async function main() {
  const options = parseArgs(process.argv);
  const remoteDir = assertSafeRemoteDir(options.remoteDir);
  const treeRemote = `${remoteDir}/tree`;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportDir = path.join(root, "test-results", "oss-verify");
  await mkdir(reportDir, { recursive: true });
  const localReportPath = options.out || path.join(reportDir, `oss-verify-${stamp}.json`);
  const exportDir = options.tree || path.join(os.tmpdir(), `wodeappx-oss-verify-${process.pid}`);
  const report = emptyReport({
    host: options.localOnly ? "local" : options.host,
    remoteDir: options.localOnly ? exportDir : remoteDir,
    image: options.image,
    phases: options.phases,
  });

  try {
    if (options.phases.includes("export") && !options.skipExport) {
      const started = Date.now();
      const summary = await exportStandalone(exportDir);
      report.results.export = { ok: summary.ok, elapsedMs: Date.now() - started, ...summary };
      if (!summary.ok) {
        report.notes.push("export tree still contains env, vendor, ee, or brand-agents.json");
      }
    } else if (options.tree) {
      const summary = summarizeExportTree(await walkRelative(options.tree));
      report.results.export = { ok: summary.ok, skipped: true, ...summary };
    }

    const tree = options.tree || exportDir;
    if (options.phases.includes("contract")) {
      const started = Date.now();
      run("node", ["scripts/check-open-source-readiness.mjs"], {
        cwd: tree,
        timeoutMs: 120_000,
      });
      report.results.contract = { ok: true, elapsedMs: Date.now() - started, where: "local-export" };
    }

    const remotePhases = options.phases.filter((phase) => phase === "setup" || phase === "patch-idempotent");
    if (!options.localOnly && remotePhases.length > 0) {
      ssh(options.host, `mkdir -p ${JSON.stringify(treeRemote)}`);
      const rsyncArgs = [
        "-az",
        "--delete",
        "-e", "ssh -o BatchMode=yes -o ConnectTimeout=15",
      ];
      if (options.keepRemoteVendor) {
        rsyncArgs.push("--exclude", "vendor/");
      }
      rsyncArgs.push(`${tree}/`, `${options.host}:${treeRemote}/`);
      run("rsync", rsyncArgs, { timeoutMs: 15 * 60_000 });

      const bootstrap = buildAptBootstrapCommand(PNPM_VERSION);
      const phaseEnv = remotePhases.join(",");
      const dockerCmd = [
        `docker rm -f ${CONTAINER_NAME} >/dev/null 2>&1 || true`,
        `docker pull ${JSON.stringify(options.image)}`,
        [
          "docker run --rm",
          `--name ${CONTAINER_NAME}`,
          "--cpus=3 --memory=8g",
          `-v ${JSON.stringify(treeRemote)}:/work`,
          "-w /work",
          "-u root",
          `-e WODEAPPX_OSS_PHASES=${JSON.stringify(phaseEnv)}`,
          `-e WODEAPPX_OSS_VERIFY_IMAGE=${JSON.stringify(options.image)}`,
          "-e COREPACK_ENABLE_DOWNLOAD_PROMPT=0",
          "-e SHELL=/bin/bash",
          "-e npm_config_registry=https://registry.npmmirror.com",
          "-e ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/",
          "-e ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/",
          JSON.stringify(options.image),
          `bash -lc ${JSON.stringify(`${bootstrap} && node scripts/oss-vps-verify-remote.mjs`)}`,
        ].join(" "),
      ].join(" && ");
      const started = Date.now();
      try {
        ssh(options.host, dockerCmd, { timeoutMs: 70 * 60_000 });
        report.notes.push(`vps docker finished in ${Date.now() - started}ms`);
      } catch (error) {
        report.notes.push(`vps docker failed after ${Date.now() - started}ms`);
        throw error;
      } finally {
        try {
          const remoteJson = run("ssh", [
            "-o", "BatchMode=yes",
            options.host,
            `cat ${JSON.stringify(`${treeRemote}/oss-verify-report.json`)}`,
          ], { stdio: "pipe", timeoutMs: 30_000 });
          const remoteReport = JSON.parse(String(remoteJson));
          Object.assign(report.results, remoteReport.results || {});
          report.notes.push(...(remoteReport.notes || []));
        } catch {
          report.notes.push("remote oss-verify-report.json was not readable");
        }
      }
      if (options.cleanup) {
        ssh(options.host, `docker rm -f ${CONTAINER_NAME} >/dev/null 2>&1 || true; rm -rf ${JSON.stringify(remoteDir)}`);
      }
    } else if (remotePhases.length > 0 && options.localOnly) {
      report.notes.push("setup/patch-idempotent skipped because --local-only");
    }

    finalizeReport(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    report.notes.push(message);
    finalizeReport(report);
    await writeFile(localReportPath, `${JSON.stringify(report, null, 2)}\n`);
    console.error(`[oss-verify] FAIL: ${message}`);
    console.error(`[oss-verify] report: ${localReportPath}`);
    process.exit(1);
  }

  await writeFile(localReportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[oss-verify] ${report.verdict} → ${localReportPath}`);
  if (report.verdict !== "PASS") process.exit(1);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(`[oss-verify] ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  });
}
