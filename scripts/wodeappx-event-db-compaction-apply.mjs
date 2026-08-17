#!/usr/bin/env node
/**
 * PERF-06 步骤 4b：确认门控下对线上库执行已验证 compaction DELETE。
 *
 * 默认不 VACUUM。三保险缺一不可：
 *   WODEAPPX_EVENT_DB_COMPACTION_APPLY=1
 *   --i-understand-write-live-db
 *   --confirm-plan=<token>
 *
 *   pnpm test:event-db-compaction:apply --i-understand-write-live-db --confirm-plan=...
 *
 * 编排逻辑在 runApplyPipeline（可单测）；本文件只做 CLI 参数与退出码。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  APPLY_ENV_FLAG,
  allowIdleProbeFailure,
  assertApplyFlagsEnabled,
  defaultBackupRoot,
  latestPlanPath,
  readPlanFile,
  requireEngineDownEnabled,
  runApplyPipeline,
  verifyPlanToken,
} from "./wodeappx-event-db-compaction-core.mjs";
import { locateDb, redactString } from "./wodeappx-performance-soak.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const wodeappxRoot = resolve(scriptDir, "..");
const MIB = 1024 * 1024;

function readArg(name) {
  const argv = process.argv;
  const index = argv.indexOf(name);
  if (index !== -1) return argv[index + 1];
  const prefix = `${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function loadDiscovery() {
  const candidates = [
    join(homedir(), "Library/Application Support/com.differentai.openwork.dev/openwork-engine.json"),
    join(homedir(), "Library/Application Support/com.differentai.openwork/openwork-engine.json"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      const raw = JSON.parse(readFileSync(file, "utf8"));
      if (raw?.baseUrl && raw?.username && raw?.password) return raw;
    } catch {
      /* ignore */
    }
  }
  return null;
}

function exitCodeForStage(stage) {
  if (stage === "idle" || stage === "lock" || stage === "engine-down" || stage === "args") return 2;
  return 1;
}

async function main() {
  const flags = assertApplyFlagsEnabled({
    env: process.env,
    understandFlag: hasFlag("--i-understand-write-live-db"),
  });
  if (!flags.ok) {
    process.stderr.write(`[apply] 拒绝：${flags.reason}\n`);
    process.exit(2);
  }

  const confirmPlan = readArg("--confirm-plan");
  if (!confirmPlan) {
    process.stderr.write("[apply] 拒绝：缺少 --confirm-plan=<token>\n");
    process.exit(2);
  }

  const dbPath = readArg("--db") ? resolve(readArg("--db")) : locateDb();
  if (!dbPath || !existsSync(dbPath)) throw new Error("未找到 opencode.db");

  const planPath = readArg("--plan")
    ? resolve(readArg("--plan"))
    : latestPlanPath(wodeappxRoot);
  if (!existsSync(planPath)) {
    throw new Error(`未找到 plan 文件：${planPath}（先跑 pnpm test:event-db-compaction:plan）`);
  }
  const planFile = readPlanFile(planPath);
  const verified = verifyPlanToken(dbPath, planFile, confirmPlan);
  if (!verified.ok) {
    process.stderr.write(`[apply] 拒绝：${verified.reason}\n`);
    process.exit(2);
  }

  const outDir = resolve(
    readArg("--out")
      ?? join(wodeappxRoot, "test-results", `event-db-apply-${new Date().toISOString().replace(/[:.]/g, "-")}`),
  );
  mkdirSync(outDir, { recursive: true });

  const backupRoot = readArg("--backup-root") ? resolve(readArg("--backup-root")) : defaultBackupRoot();
  const vacuum = hasFlag("--vacuum"); // 步骤 4 默认关；显式才开
  const discovery = loadDiscovery();

  const result = await runApplyPipeline({
    dbPath,
    planPayload: planFile,
    backupRoot,
    vacuum,
    discovery,
    requireEngineDown: requireEngineDownEnabled(),
    allowProbeFailure: allowIdleProbeFailure(),
    onStage(stage, payload) {
      if (stage === "idle" && payload?.detail) {
        process.stdout.write(`[apply] idle：${payload.detail}\n`);
      } else if (stage === "before-backup") {
        process.stdout.write(`[apply] 备份 → ${backupRoot}\n`);
      } else if (stage === "backup" && payload?.destDir) {
        process.stdout.write(`[apply] 备份完成：${payload.destDir} sha256=${String(payload.sha256 || "").slice(0, 12)}…\n`);
      } else if (stage === "before-delete") {
        process.stdout.write(
          `[apply] 将删除 ${planFile.deleteRows} 行 / ${(planFile.deleteBytes / MIB).toFixed(1)} MiB（无 VACUUM=${!vacuum}）\n`,
        );
      }
    },
  });

  if (!result.ok) {
    process.stderr.write(`[apply] 拒绝/失败 stage=${result.stage}：${result.reason}\n`);
    process.exit(exitCodeForStage(result.stage));
  }

  const applyResult = result.apply;
  const evidence = {
    at: new Date().toISOString(),
    dbPath,
    planToken: planFile.token,
    envFlag: APPLY_ENV_FLAG,
    idleProbe: result.idleProbe,
    backup: {
      destDir: result.backup.destDir,
      sha256: result.backup.sha256,
      sizeBytes: result.backup.sizeBytes,
    },
    apply: applyResult,
  };
  writeFileSync(join(outDir, "apply.json"), JSON.stringify(evidence, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2));
  writeFileSync(join(outDir, "report.md"), [
    `# event compaction apply 报告`,
    ``,
    `- 时间：${evidence.at}`,
    `- 库：${dbPath}`,
    `- token：${planFile.token}`,
    `- 备份：${result.backup.destDir}`,
    `- 删除行：${applyResult.deletedRows}（${applyResult.eventRowsBefore} → ${applyResult.eventRowsAfter}）`,
    `- 投影一致：是`,
    `- FK 违例：0`,
    `- integrity：${applyResult.integrityAfter.ok ? "ok" : "FAIL"}`,
    `- VACUUM：${applyResult.vacuumed ? "已执行" : "跳过（步骤 5）"}`,
    `- 文件尺寸：${(applyResult.sizeBeforeBytes / MIB).toFixed(1)} → ${(applyResult.sizeAfterBytes / MIB).toFixed(1)} MiB`,
  ].join("\n"));

  process.stdout.write(`[apply] OK 删除 ${applyResult.deletedRows} 行；报告 ${join(outDir, "report.md")}\n`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`[apply] 失败：${redactString(error instanceof Error ? error.message : String(error))}\n`);
    process.exit(1);
  });
}
