#!/usr/bin/env node
/**
 * PERF-06 步骤 3：event 表 compaction 复制库验证（dry-run，绝不写线上库）。
 *
 * 流程：复制 opencode.db(+wal/shm) → integrity check → 生成计划 → 副本上删除 →
 * 校验 message/part 等投影表指纹不变 + foreign_key_check → VACUUM → 报告可回收字节。
 *
 * compaction 规则（保守 v1）：仅对 message.updated.% / message.part.updated.% 事件，
 * 同一 (aggregate_id, type, 实体 id) 分组内只保留 rowid 最大的一行（最终快照）；
 * 实体 id 提取失败（NULL）的行一律保留；session、todo、permission 等其他类型全保留。
 * event_sequence 高水位不动（seq 允许空洞）——引擎启动是否容忍空洞是「运行时实测」
 * 待办项，本脚本如实标注，不声称已证明。
 *
 * 用法：
 *   node scripts/wodeappx-event-db-compaction-dryrun.mjs                 # 自动定位线上库，复制后验证
 *   node scripts/wodeappx-event-db-compaction-dryrun.mjs --db <path> --out <dir> --no-vacuum
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { fileSizeBytes, locateDb, redactString } from "./wodeappx-performance-soak.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const wodeappxRoot = resolve(scriptDir, "..");
const MIB = 1024 * 1024;

// ---------- compaction 规则（单一来源，审计脚本复用） ----------

export const COMPACTION_TYPE_FILTER = "(type LIKE 'message.updated.%' OR type LIKE 'message.part.updated.%')";
export const COMPACTION_ENTITY_SQL = `CASE
  WHEN type LIKE 'message.updated.%' AND json_valid(data) THEN json_extract(data, '$.info.id')
  WHEN type LIKE 'message.part.updated.%' AND json_valid(data) THEN json_extract(data, '$.part.id')
END`;

/** 删除候选：过滤类型内、实体 id 可提取、且不是同组 rowid 最大者。窗口函数避免 CTE 自连接。 */
export const COMPACTION_PLAN_SQL = `WITH base AS (
  SELECT rowid AS rid, aggregate_id, type, LENGTH(data) AS bytes, ${COMPACTION_ENTITY_SQL} AS entity
  FROM event
  WHERE ${COMPACTION_TYPE_FILTER}
), ranked AS (
  SELECT rid, bytes, MAX(rid) OVER (PARTITION BY aggregate_id, type, entity) AS keep_rid
  FROM base
  WHERE entity IS NOT NULL
)
SELECT rid, bytes FROM ranked WHERE rid <> keep_rid`;

export const COMPACTION_DELETE_SQL = `DELETE FROM event WHERE rowid IN (
  WITH base AS (
    SELECT rowid AS rid, aggregate_id, type, ${COMPACTION_ENTITY_SQL} AS entity
    FROM event
    WHERE ${COMPACTION_TYPE_FILTER}
  ), ranked AS (
    SELECT rid, MAX(rid) OVER (PARTITION BY aggregate_id, type, entity) AS keep_rid
    FROM base
    WHERE entity IS NOT NULL
  )
  SELECT rid FROM ranked WHERE rid <> keep_rid
)`;

// ---------- 基础件 ----------

function openDb(dbPath, { queryOnly = false } = {}) {
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  if (queryOnly) db.exec("PRAGMA query_only = ON");
  return db;
}

/** 投影表指纹：count + data 长度和 + time_updated 和（有该列时）。删 event 不应改变它们。 */
export function fingerprintProjections(db, tables = ["session", "message", "part", "todo"]) {
  const existing = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
  const fingerprints = {};
  for (const table of tables) {
    if (!existing.includes(table)) continue;
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((col) => col.name);
    const parts = ["COUNT(*) AS n"];
    if (columns.includes("data")) parts.push("COALESCE(SUM(LENGTH(data)),0) AS dataBytes");
    // SUM(time_updated) 会溢出 JS number（万级行 × 毫秒时间戳），用 MAX 取等效信号
    if (columns.includes("time_updated")) parts.push("COALESCE(MAX(time_updated),0) AS updatedMax");
    fingerprints[table] = db.prepare(`SELECT ${parts.join(", ")} FROM ${table}`).get();
  }
  return fingerprints;
}

export function fingerprintsEqual(before, after) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  for (const key of keys) {
    if (JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after?.[key] ?? null)) return false;
  }
  return true;
}

/** 只读生成 compaction 计划（审计脚本复用）。 */
export function planCompaction(db) {
  const rows = db.prepare(`SELECT COUNT(*) AS deleteRows, COALESCE(SUM(bytes),0) AS deleteBytes, COALESCE(MAX(bytes),0) AS maxBytes FROM (${COMPACTION_PLAN_SQL})`).get();
  const eventTotals = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(LENGTH(data)),0) AS bytes FROM event").get();
  const byType = db.prepare(`SELECT type, COUNT(*) AS n, COALESCE(SUM(LENGTH(data)),0) AS bytes FROM event WHERE ${COMPACTION_TYPE_FILTER} GROUP BY type ORDER BY bytes DESC`).all();
  return {
    deleteRows: rows.deleteRows,
    deleteBytes: rows.deleteBytes,
    maxDeleteEventBytes: rows.maxBytes,
    eventRows: eventTotals.n,
    eventBytes: eventTotals.bytes,
    deleteRatio: eventTotals.n ? rows.deleteRows / eventTotals.n : 0,
    compactableTypes: byType,
  };
}

/** 复制 db+wal+shm 到目标目录，返回副本路径。 */
export function copyDatabase(sourcePath, destDir) {
  mkdirSync(destDir, { recursive: true });
  const destPath = join(destDir, basename(sourcePath));
  for (const suffix of ["", "-wal", "-shm"]) {
    const from = `${sourcePath}${suffix}`;
    if (existsSync(from)) copyFileSync(from, `${destPath}${suffix}`);
  }
  return destPath;
}

export function integrityCheck(db) {
  const rows = db.prepare("PRAGMA integrity_check").all();
  const text = rows.map((row) => Object.values(row)[0]).join("; ");
  return { ok: text === "ok", detail: text.slice(0, 500) };
}

/**
 * 在副本上执行 compaction + 校验 +（可选）VACUUM。返回完整结果对象。
 * 供 CLI 与单元测试共用；调用方保证 dbPath 是可写副本，不是线上库。
 */
export function runCompactionOnCopy(dbPath, { vacuum = true } = {}) {
  const sizeBefore = fileSizeBytes(dbPath) + fileSizeBytes(`${dbPath}-wal`);
  const db = openDb(dbPath);
  try {
    const integrityBefore = integrityCheck(db);
    if (!integrityBefore.ok) return { ok: false, stage: "integrity-before", integrityBefore };

    const fingerprintBefore = fingerprintProjections(db);
    const plan = planCompaction(db);

    db.exec("BEGIN");
    try {
      db.exec(COMPACTION_DELETE_SQL);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const fingerprintAfter = fingerprintProjections(db);
    const projectionMatch = fingerprintsEqual(fingerprintBefore, fingerprintAfter);
    const fkRows = db.prepare("PRAGMA foreign_key_check").all();
    const eventRowsAfter = db.prepare("SELECT COUNT(*) AS n FROM event").get().n;

    let sizeAfter = fileSizeBytes(dbPath) + fileSizeBytes(`${dbPath}-wal`);
    let vacuumed = false;
    if (vacuum) {
      db.exec("VACUUM");
      vacuumed = true;
      sizeAfter = fileSizeBytes(dbPath) + fileSizeBytes(`${dbPath}-wal`);
    }
    const integrityAfter = integrityCheck(db);

    return {
      ok: projectionMatch && fkRows.length === 0 && integrityAfter.ok,
      integrityBefore,
      integrityAfter,
      plan,
      deletedRows: plan.eventRows - eventRowsAfter,
      eventRowsAfter,
      projectionMatch,
      fingerprintBefore,
      fingerprintAfter,
      foreignKeyViolations: fkRows.length,
      vacuumed,
      sizeBeforeBytes: sizeBefore,
      sizeAfterBytes: sizeAfter,
      reclaimedBytes: Math.max(0, sizeBefore - sizeAfter),
    };
  } finally {
    try { db.close(); } catch { /* ignore */ }
  }
}

// ---------- CLI ----------

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 18).join("\n") + "\n");
    return;
  }
  const sourcePath = readArg("--db") ? resolve(readArg("--db")) : locateDb();
  if (!sourcePath || !existsSync(sourcePath)) throw new Error("未找到 opencode.db（--db 指定或先启动桌面端）");
  const outDir = resolve(readArg("--out") ?? join(wodeappxRoot, "test-results", `event-db-compaction-${new Date().toISOString().replace(/[:.]/g, "-")}`));
  const vacuum = !process.argv.includes("--no-vacuum");
  mkdirSync(outDir, { recursive: true });

  process.stdout.write(`[dryrun] 源库（只读）：${sourcePath}\n`);
  const copyDir = join(outDir, "copy");
  let copyPath = copyDatabase(sourcePath, copyDir);
  // 线上库在写入时复制可能拿到撕裂页；integrity 不过则等 2s 重拷一次
  {
    const probe = openDb(copyPath, { queryOnly: true });
    const check = integrityCheck(probe);
    try { probe.close(); } catch { /* ignore */ }
    if (!check.ok) {
      process.stdout.write("[dryrun] 首次复制 integrity 未过（源库写入中），2s 后重拷…\n");
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
      copyPath = copyDatabase(sourcePath, copyDir);
    }
  }

  const result = runCompactionOnCopy(copyPath, { vacuum });
  const evidence = {
    at: new Date().toISOString(),
    sourcePath,
    copyPath,
    rule: "message.updated.%/message.part.updated.% 每实体仅留 rowid 最大行；其余类型与 NULL 实体全保留；event_sequence 不动",
    pendingRuntimeProof: "引擎运行时是否 replay event 表（seq 空洞容忍、session revert 依赖）未在本脚本证明；建议后续用副本库启动引擎冒烟后再开 feature flag",
    ...result,
  };
  writeFileSync(join(outDir, "compaction-dryrun.json"), JSON.stringify(evidence, (key, value) => typeof value === "bigint" ? Number(value) : value, 2));

  const mib = (bytes) => (bytes / MIB).toFixed(1);
  const markdown = [
    `# event compaction dry-run 报告`,
    ``,
    `- 时间：${evidence.at}`,
    `- 源库：${sourcePath}（只读，未修改）`,
    `- 副本：${copyPath}`,
    `- 规则：${evidence.rule}`,
    ``,
    `## 结果`,
    ``,
    `| 项 | 值 |`,
    `|---|---|`,
    `| 计划删除行 | ${result.plan?.deleteRows ?? "NA"} / ${result.plan?.eventRows ?? "NA"}（${((result.plan?.deleteRatio ?? 0) * 100).toFixed(1)}%） |`,
    `| 计划删除字节 | ${mib(result.plan?.deleteBytes ?? 0)} MiB / ${mib(result.plan?.eventBytes ?? 0)} MiB |`,
    `| 投影表指纹一致 | ${result.projectionMatch ? "是" : "否"} |`,
    `| FK 违例 | ${result.foreignKeyViolations ?? "NA"} |`,
    `| integrity（前/后） | ${result.integrityBefore?.ok ? "ok" : "FAIL"} / ${result.integrityAfter?.ok ? "ok" : "FAIL"} |`,
    `| VACUUM | ${result.vacuumed ? "已执行" : "跳过"} |`,
    `| 文件尺寸 | ${mib(result.sizeBeforeBytes ?? 0)} → ${mib(result.sizeAfterBytes ?? 0)} MiB（回收 ${mib(result.reclaimedBytes ?? 0)} MiB） |`,
    ``,
    `## 待证明（不阻塞 dry-run 结论）`,
    ``,
    `- ${evidence.pendingRuntimeProof}`,
  ].join("\n");
  writeFileSync(join(outDir, "report.md"), markdown);

  process.stdout.write(`[dryrun] 计划删除 ${result.plan?.deleteRows ?? "NA"} 行（${mib(result.plan?.deleteBytes ?? 0)} MiB），投影一致=${result.projectionMatch}，回收 ${mib(result.reclaimedBytes ?? 0)} MiB\n`);
  process.stdout.write(`[dryrun] 报告：${join(outDir, "report.md")}\n`);
  if (!result.ok) {
    process.stderr.write("[dryrun] 校验未全过，见报告；源库未被修改\n");
    process.exit(1);
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`[dryrun] 失败：${redactString(error instanceof Error ? error.message : String(error))}\n`);
    process.exit(1);
  });
}
