#!/usr/bin/env node
/**
 * PERF-06 步骤 4a：只读签发 compaction plan + token（绝不写线上库）。
 *
 *   pnpm test:event-db-compaction:plan
 *   node scripts/wodeappx-event-db-compaction-plan.mjs --db <path> --out <dir>
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  buildPlanPayload,
  openDb,
  writePlanFile,
} from "./wodeappx-event-db-compaction-core.mjs";
import { planCompaction } from "./wodeappx-event-db-compaction-dryrun.mjs";
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

async function main() {
  const dbPath = readArg("--db") ? resolve(readArg("--db")) : locateDb();
  if (!dbPath || !existsSync(dbPath)) throw new Error("未找到 opencode.db");
  const outDir = resolve(
    readArg("--out")
      ?? join(wodeappxRoot, "test-results", `event-db-plan-${new Date().toISOString().replace(/[:.]/g, "-")}`),
  );
  mkdirSync(outDir, { recursive: true });

  const db = openDb(dbPath, { queryOnly: true });
  let plan;
  try {
    plan = planCompaction(db);
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }

  const payload = buildPlanPayload(dbPath, plan);
  const planFile = writePlanFile(outDir, payload, plan);
  writeFileSync(join(outDir, "report.md"), [
    `# event compaction plan`,
    ``,
    `- 时间：${payload.issuedAt}`,
    `- 库：${payload.dbPath}`,
    `- token：\`${payload.token}\``,
    `- 过期：${payload.expiresAt}`,
    `- 计划删除：${payload.deleteRows} / ${payload.eventRows} 行（${(payload.deleteBytes / MIB).toFixed(1)} MiB）`,
    `- ruleVersion：${payload.ruleVersion}`,
    ``,
    `Apply（写线上，需三保险）：`,
    ``,
    "```bash",
    `WODEAPPX_EVENT_DB_COMPACTION_APPLY=1 \\`,
    `  pnpm test:event-db-compaction:apply \\`,
    `  --i-understand-write-live-db \\`,
    `  --confirm-plan=${payload.token}`,
    "```",
  ].join("\n"));

  process.stdout.write(`[plan] token=${payload.token} deleteRows=${payload.deleteRows} deleteMiB=${(payload.deleteBytes / MIB).toFixed(1)}\n`);
  process.stdout.write(`[plan] 文件：${planFile}\n`);
  process.stdout.write(`[plan] 过期：${payload.expiresAt}\n`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`[plan] 失败：${redactString(error instanceof Error ? error.message : String(error))}\n`);
    process.exit(1);
  });
}
