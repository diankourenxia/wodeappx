#!/usr/bin/env node
/**
 * PERF-06 步骤 1：event 表只读审计。绝不写库。
 *
 * 输出：总量 / 按 type 统计（行数、MiB、最大 event）/ Top-N 最大 event /
 * 单 event > 2 MiB 清单 / 按 compaction 规则的可回收估算 / 阈值告警。
 *
 * 阈值（§7.6）：库文件 > 512 MiB 告警；> 1 GiB 提示维护；单 event > 2 MiB 记录。
 *
 * 用法：
 *   node scripts/wodeappx-event-db-audit.mjs                 # 自动定位线上库（只读）
 *   node scripts/wodeappx-event-db-audit.mjs --db <path> --top 20 --out <dir>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { dbSnapshot, fileSizeBytes, locateDb, openDbReadonly, redactString } from "./wodeappx-performance-soak.mjs";
import { planCompaction } from "./wodeappx-event-db-compaction-dryrun.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const wodeappxRoot = resolve(scriptDir, "..");
const MIB = 1024 * 1024;

export const DB_WARN_MIB = 512;
export const DB_MAINTAIN_MIB = 1024;
export const EVENT_MAX_MIB = 2;

/** 阈值评估（纯函数，单测覆盖）。 */
export function evaluateDbThresholds({ totalFileMiB, eventsOver2MiB }) {
  return [
    {
      id: "db-size-warn",
      target: `< ${DB_WARN_MIB} MiB 无告警`,
      actual: `${totalFileMiB.toFixed(0)} MiB`,
      status: totalFileMiB >= DB_MAINTAIN_MIB ? "maintain" : totalFileMiB >= DB_WARN_MIB ? "warn" : "ok",
      note: totalFileMiB >= DB_MAINTAIN_MIB ? "超过 1 GiB，提示维护" : totalFileMiB >= DB_WARN_MIB ? "超过 512 MiB，告警" : "",
    },
    {
      id: "event-over-2mib",
      target: "0 个单 event > 2 MiB",
      actual: String(eventsOver2MiB),
      status: eventsOver2MiB > 0 ? "warn" : "ok",
      note: eventsOver2MiB > 0 ? "记录并待外置（PERF-05 server 端）" : "",
    },
  ];
}

export function runAudit(dbPath, { top = 20 } = {}) {
  const snapshot = dbSnapshot(dbPath);
  if (snapshot.error) return { ok: false, error: snapshot.error, snapshot };

  const db = openDbReadonly(dbPath);
  try {
    const byType = db.prepare(
      "SELECT type, COUNT(*) AS count, SUM(LENGTH(data)) AS bytes, MAX(LENGTH(data)) AS maxBytes FROM event GROUP BY type ORDER BY bytes DESC",
    ).all();
    const topEvents = db.prepare(
      "SELECT type, aggregate_id, seq, LENGTH(data) AS bytes FROM event ORDER BY bytes DESC LIMIT ?",
    ).all(top).map((row) => ({ ...row, mib: row.bytes / MIB }));
    const overThreshold = db.prepare(
      "SELECT type, aggregate_id, seq, LENGTH(data) AS bytes FROM event WHERE LENGTH(data) > ? ORDER BY bytes DESC LIMIT 50",
    ).all(EVENT_MAX_MIB * MIB);
    const plan = planCompaction(db);
    const totalFileBytes = snapshot.fileBytes + snapshot.walBytes + fileSizeBytes(`${dbPath}-shm`);

    return {
      ok: true,
      at: snapshot.at,
      dbPath,
      fileBytes: snapshot.fileBytes,
      walBytes: snapshot.walBytes,
      totalFileBytes,
      event: snapshot.event,
      byType,
      topEvents,
      eventsOver2MiB: overThreshold.length,
      overThresholdEvents: overThreshold,
      reclaim: plan,
      thresholds: evaluateDbThresholds({ totalFileMiB: totalFileBytes / MIB, eventsOver2MiB: overThreshold.length }),
    };
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

function mib(bytes) {
  return (bytes / MIB).toFixed(1);
}

export function renderAuditMarkdown(audit) {
  const typeRows = audit.byType.map(
    (row) => `| ${row.type} | ${row.count} | ${mib(row.bytes)} | ${mib(row.maxBytes ?? 0)} |`,
  );
  const topRows = audit.topEvents.map(
    (row) => `| ${row.type} | ${row.aggregate_id} | ${row.seq} | ${row.mib.toFixed(2)} |`,
  );
  const thresholdRows = audit.thresholds.map(
    (gate) => `| ${gate.id} | ${gate.target} | ${gate.actual} | ${gate.status.toUpperCase()} | ${gate.note} |`,
  );
  return [
    `# event DB 只读审计（PERF-06 步骤 1）`,
    ``,
    `- 时间：${audit.at}`,
    `- 库：${audit.dbPath}`,
    `- 文件：db ${mib(audit.fileBytes)} + wal ${mib(audit.walBytes)} = **${mib(audit.totalFileBytes)} MiB**`,
    `- event：${audit.event.count} 行 / ${mib(audit.event.bytes)} MiB / 单 event 最大 ${mib(audit.event.maxBytes)} MiB`,
    ``,
    `## 阈值`,
    ``,
    `| 项 | 目标 | 实测 | 状态 | 说明 |`,
    `|---|---|---|---|---|`,
    ...thresholdRows,
    ``,
    `## 可回收估算（compaction 规则，详见 dry-run 脚本）`,
    ``,
    `- 可删 ${audit.reclaim.deleteRows} 行（${(audit.reclaim.deleteRatio * 100).toFixed(1)}%）/ ${mib(audit.reclaim.deleteBytes)} MiB`,
    ``,
    `## 按 type 统计`,
    ``,
    `| type | 行数 | MiB | 最大 event MiB |`,
    `|---|---:|---:|---:|`,
    ...typeRows,
    ``,
    `## Top ${audit.topEvents.length} 最大 event`,
    ``,
    `| type | aggregate | seq | MiB |`,
    `|---|---|---:|---:|`,
    ...topRows,
  ].join("\n");
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 14).join("\n") + "\n");
    return;
  }
  const dbPath = readArg("--db") ? resolve(readArg("--db")) : locateDb();
  if (!dbPath || !existsSync(dbPath)) throw new Error("未找到 opencode.db（--db 指定或先启动桌面端）");
  const top = Math.min(100, Math.max(1, Number(readArg("--top")) || 20));
  const outDir = resolve(readArg("--out") ?? join(wodeappxRoot, "test-results", `event-db-audit-${new Date().toISOString().replace(/[:.]/g, "-")}`));
  mkdirSync(outDir, { recursive: true });

  const audit = runAudit(dbPath, { top });
  if (!audit.ok) throw new Error(`审计失败：${audit.error}`);
  writeFileSync(join(outDir, "audit.json"), JSON.stringify(audit, null, 2));
  writeFileSync(join(outDir, "report.md"), renderAuditMarkdown(audit));

  process.stdout.write(`[audit] event ${audit.event.count} 行 / ${mib(audit.event.bytes)} MiB；文件 ${mib(audit.totalFileBytes)} MiB\n`);
  process.stdout.write(`[audit] 可回收 ${audit.reclaim.deleteRows} 行 / ${mib(audit.reclaim.deleteBytes)} MiB（${(audit.reclaim.deleteRatio * 100).toFixed(1)}%）\n`);
  for (const gate of audit.thresholds) {
    if (gate.status !== "ok") process.stdout.write(`[audit] ${gate.status.toUpperCase()} ${gate.id}: ${gate.actual}（${gate.note}）\n`);
  }
  process.stdout.write(`[audit] 报告：${join(outDir, "report.md")}\n`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`[audit] 失败：${redactString(error instanceof Error ? error.message : String(error))}\n`);
    process.exit(1);
  }
}
