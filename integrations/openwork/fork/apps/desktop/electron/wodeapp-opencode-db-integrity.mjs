import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { maintainOpencodeDbBeforeServe } from "./wodeapp-opencode-db-maintain.mjs";

const require = createRequire(import.meta.url);

/**
 * Boot-time gate for the interactive OpenCode sidecar DB.
 * Missing DB (first launch) is OK; malformed DB must fail closed before serve.
 */

export function opencodeDbPathFromXdgDataHome(xdgDataHome) {
  const root = String(xdgDataHome ?? "").trim();
  if (!root) return null;
  return path.join(root, "opencode", "opencode.db");
}

function normalizeCheckOutput(stdout) {
  const lines = String(stdout ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { ok: false, detail: "empty integrity output" };
  if (lines.every((line) => line === "ok")) return { ok: true, detail: "ok" };
  return { ok: false, detail: lines.slice(0, 8).join("; ") };
}

function checkWithNodeSqlite(dbPath, pragmaSql) {
  try {
    // Electron / Node 22+: node:sqlite DatabaseSync
    const { DatabaseSync } = require("node:sqlite");
    const database = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = database.prepare(pragmaSql).all();
      const text = rows
        .map((row) => Object.values(row ?? {})[0])
        .filter((value) => value != null)
        .join("\n");
      return normalizeCheckOutput(text || "ok");
    } finally {
      database.close();
    }
  } catch (error) {
    return {
      ok: false,
      detail: `node:sqlite unavailable: ${error instanceof Error ? error.message : String(error)}`,
      retryWithCli: true,
    };
  }
}

function checkWithSqliteCli(dbPath, pragmaSql) {
  const result = spawnSync("sqlite3", [dbPath, pragmaSql], {
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.error) {
    return {
      ok: false,
      detail: `sqlite3 cli failed: ${result.error.message}`,
    };
  }
  if (result.status !== 0) {
    const errText = String(result.stderr || result.stdout || "").trim();
    return {
      ok: false,
      detail: errText || `sqlite3 exit ${result.status}`,
    };
  }
  return normalizeCheckOutput(result.stdout);
}

/**
 * @param {string} dbPath
 * @param {{ quick?: boolean }} [options]
 * @returns {{ ok: boolean, skipped?: boolean, reason?: string, detail?: string, quick?: boolean }}
 */
export function checkOpencodeDbIntegrity(dbPath, options = {}) {
  const quick = options.quick !== false;
  if (!dbPath || !existsSync(dbPath)) {
    return { ok: true, skipped: true, reason: "missing", quick };
  }
  const pragmaSql = quick ? "PRAGMA quick_check;" : "PRAGMA integrity_check;";
  let result = checkWithNodeSqlite(dbPath, pragmaSql);
  if (result.retryWithCli) {
    result = checkWithSqliteCli(dbPath, pragmaSql);
  }
  return { ...result, quick };
}

/**
 * Throw OPENCODE_DB_MALFORMED when the interactive account DB is corrupt.
 * Call before spawning `opencode serve`.
 */
export function assertOpencodeDbHealthyForWrite(xdgDataHome) {
  const dbPath = opencodeDbPathFromXdgDataHome(xdgDataHome);
  const result = checkOpencodeDbIntegrity(dbPath, { quick: true });
  if (!result.ok) {
    const error = new Error(
      `OpenCode session database is corrupted (${dbPath}): ${result.detail || "malformed"}. `
        + "Refusing to start the local engine against a malformed DB. "
        + "Restore from backup or recover the database before retrying.",
    );
    error.code = "OPENCODE_DB_MALFORMED";
    error.dbPath = dbPath;
    error.integrity = result;
    throw error;
  }
  let maintain = { skipped: true, reason: "not-run" };
  try {
    maintain = maintainOpencodeDbBeforeServe(dbPath);
    if (maintain?.ok === false) {
      console.warn("[opencode-db-maintain] skipped after failure", maintain.error || maintain);
    }
  } catch (error) {
    console.warn(
      "[opencode-db-maintain] failed",
      error instanceof Error ? error.message : String(error),
    );
  }
  return { ...result, maintain };
}
