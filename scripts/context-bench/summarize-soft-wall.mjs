#!/usr/bin/env node
/**
 * Summarize t6-soft-wall-20 runs from run-meta.json, session-metrics.json and
 * turn stdout. No provider request is made by this script.
 *
 * Usage:
 *   node summarize-soft-wall.mjs --runs /tmp/wodeappx-context-bench-... \
 *     [--out summary.json]
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const execFileAsync = promisify(execFile);

function readArg(name, fallback) {
  const args = process.argv.slice(2);
  const direct = args.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

const runsRoot = path.resolve(readArg("--runs", "."));
const outFile = readArg("--out");

const EXPECTED = new Map([
  [8, "CHECK-08|ORBIT-CEDAR-731|林澈|G7|northstar/atlas-console|17分钟|BATCH-44-KITE|amber-rail"],
  [12, "CHECK-12|ap-southeast-3|eu-west-2|143天|ops-lantern|R-2026.07.29|21:35CST|quartz-19|2048"],
  [20, "CHECK-20|ORBIT-CEDAR-731|林澈|G7|BATCH-44-KITE|ap-southeast-3|143天|quartz-19|MIG-8821|周岚|9f3a-71c2|ESC-51-MAPLE|EXC-NIMBUS-04|37|signer-iris|DRILL-PINE-88|11分钟|SGD|RN-3107|CAB-indigo"],
]);

const normalize = (value) => String(value ?? "")
  .replace(/[`*_]/g, "")
  .replace(/\s+/g, "")
  .replace(/[，,]/g, "")
  .trim();

async function findRunDirs(root) {
  const found = [];
  async function visit(dir) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    if (entries.some((entry) => entry.isFile() && entry.name === "run-meta.json")) {
      found.push(dir);
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) await visit(path.join(dir, entry.name));
    }
  }
  await visit(root);
  return found.sort();
}

function outputTexts(source) {
  return source.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const event = JSON.parse(line);
      return event.type === "text" && typeof event.part?.text === "string" ? [event.part.text] : [];
    } catch {
      return [];
    }
  });
}

function tokenTotals(session) {
  return {
    input: Number(session?.tokens_input) || 0,
    output: Number(session?.tokens_output) || 0,
    reasoning: Number(session?.tokens_reasoning) || 0,
    cacheRead: Number(session?.tokens_cache_read) || 0,
    cacheWrite: Number(session?.tokens_cache_write) || 0,
  };
}

async function loadSessionMetrics(dir, meta) {
  try {
    return JSON.parse(await readFile(path.join(dir, "session-metrics.json"), "utf8"));
  } catch {
    const sessionId = String(meta.sessionId ?? "");
    if (!/^ses_[A-Za-z0-9]+$/.test(sessionId)) throw new Error(`Unsafe session id: ${sessionId}`);
    const database = path.join(dir, "xdg", "data", "opencode", "opencode.db");
    const sessionQuery = [
      "select id, tokens_input, tokens_output, tokens_reasoning,",
      "tokens_cache_read, tokens_cache_write, time_created, time_updated",
      `from session where id='${sessionId}'`,
    ].join(" ");
    const messageQuery = [
      "select m.time_created, m.id, json_extract(m.data,'$.role') role,",
      "json_extract(m.data,'$.summary') summary,",
      "(select group_concat(json_extract(p.data,'$.type')) from part p where p.message_id=m.id) part_types",
      `from message m where m.session_id='${sessionId}' order by m.time_created`,
    ].join(" ");
    const sessionResult = await execFileAsync("sqlite3", ["-json", database, sessionQuery]);
    const messageResult = await execFileAsync("sqlite3", ["-json", database, messageQuery]);
    return {
      session: JSON.parse(sessionResult.stdout)[0],
      messages: JSON.parse(messageResult.stdout),
    };
  }
}

async function summarizeRun(dir) {
  const meta = JSON.parse(await readFile(path.join(dir, "run-meta.json"), "utf8"));
  const metrics = await loadSessionMetrics(dir, meta);
  const messages = Array.isArray(metrics.messages) ? metrics.messages : [];
  const compactionUsers = messages.filter(
    (message) => message.role === "user" && String(message.part_types).split(",").includes("compaction"),
  );
  const summaryAssistants = messages.filter(
    (message) => message.role === "assistant" && message.summary === 1,
  );

  const compactionAfterTurns = [];
  let normalTurns = 0;
  for (const message of messages) {
    if (message.role !== "user") continue;
    if (String(message.part_types).split(",").includes("compaction")) {
      compactionAfterTurns.push(normalTurns);
    } else {
      normalTurns += 1;
    }
  }

  const checks = {};
  for (const [turn, expected] of EXPECTED) {
    const source = await readFile(path.join(dir, `turn-${turn}.stdout.json`), "utf8").catch(() => "");
    const candidates = outputTexts(source).filter((text) => text.includes(`CHECK-${String(turn).padStart(2, "0")}`));
    const actual = candidates.at(-1) ?? "";
    checks[turn] = {
      pass: normalize(actual) === normalize(expected),
      actual: actual.trim(),
      expected,
    };
  }

  const totals = tokenTotals(metrics.session);
  const wallMs = (meta.turns ?? []).reduce((sum, turn) => sum + (Number(turn.wallMs) || 0), 0);
  return {
    run: path.relative(runsRoot, dir),
    softWall: meta.softWall,
    contextLimit: meta.contextLimit,
    reserved: meta.reserved,
    outputLimit: meta.outputLimit,
    keepTokens: meta.keepTokens,
    completedTurns: (meta.turns ?? []).filter((turn) => turn.exitCode === 0).length,
    failedTurns: (meta.turns ?? []).filter((turn) => turn.exitCode !== 0).map((turn) => turn.turn),
    compactions: compactionUsers.length,
    summaryAssistants: summaryAssistants.length,
    compactionAfterTurns,
    wallMs,
    ...totals,
    cacheHitRate: totals.cacheRead + totals.input > 0
      ? totals.cacheRead / (totals.cacheRead + totals.input)
      : 0,
    checks,
    allChecksPass: [...EXPECTED.keys()].every((turn) => checks[turn].pass),
  };
}

const runDirs = await findRunDirs(runsRoot);
const rows = [];
for (const dir of runDirs) {
  try {
    rows.push(await summarizeRun(dir));
  } catch (error) {
    rows.push({ run: path.relative(runsRoot, dir), error: error instanceof Error ? error.message : String(error) });
  }
}

const result = { generatedAt: new Date().toISOString(), runsRoot, runs: rows };
if (outFile) await writeFile(path.resolve(outFile), `${JSON.stringify(result, null, 2)}\n`, "utf8");

console.log("soft wall | turns | compacts(after turns) | input | cache.read | cache.write | hit | wall | checks");
for (const row of rows) {
  if (row.error) {
    console.log(`${row.run}: ERROR ${row.error}`);
    continue;
  }
  console.log(
    `${row.softWall}% | ${row.completedTurns} | ${row.compactions}(${row.compactionAfterTurns.join("/") || "-"})`
    + ` | ${row.input} | ${row.cacheRead} | ${row.cacheWrite}`
    + ` | ${(row.cacheHitRate * 100).toFixed(1)}% | ${(row.wallMs / 1000).toFixed(1)}s`
    + ` | ${row.allChecksPass ? "PASS" : "FAIL"}`,
  );
}
