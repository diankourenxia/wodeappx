#!/usr/bin/env node
/**
 * context-bench metrics joiner — parse opencode.log files produced by
 * run-task.mjs, join "dynamic tool exposure" with "llm step usage" on
 * (session.id, assistant.id), emit a per-step CSV, and optionally print a
 * toolset-change cache-impact summary.
 *
 * Usage:
 *   node join-metrics.mjs --runs runs/exp1-t2 [--out metrics.csv] [--summary]
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function readArg(name, fallback) {
  const args = process.argv.slice(2);
  const direct = args.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

const runsDir = path.resolve(readArg("--runs", path.join(scriptDir, "runs")));
const outFile = readArg("--out", path.join(runsDir, "metrics.csv"));
const wantSummary = process.argv.includes("--summary");

// ---------------------------------------------------------------------------
// Log discovery
// ---------------------------------------------------------------------------
async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      yield* walk(full);
    } else if (entry.isFile() && (entry.name.endsWith(".log") || entry.name === "run-meta.json")) {
      yield full;
    }
  }
}

// ---------------------------------------------------------------------------
// logfmt-ish line parsing: key=value, values may be "quoted"
// ---------------------------------------------------------------------------
function parseKv(line) {
  const out = {};
  const re = /([\w.]+)=("(?:[^"\\]|\\.)*"|\S+)/g;
  let match;
  while ((match = re.exec(line)) !== null) {
    const key = match[1];
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : "";
}

function contextBucket(promptTokens) {
  const n = Number(promptTokens);
  if (!Number.isFinite(n)) return "";
  if (n < 30_000) return "<30k";
  if (n < 80_000) return "30-80k";
  return ">80k";
}

async function main() {
  const exposures = []; // keyed later by session+assistant
  const usages = new Map(); // session|assistant -> usage record
  const compactionCounts = new Map(); // session -> count of compact-ish lines
  const runMetaBySession = new Map();

  // Collect run-meta.json for arm info
  for await (const file of walk(runsDir)) {
    if (!file.endsWith("run-meta.json") && !file.endsWith(".log")) continue;
    if (file.endsWith("run-meta.json")) {
      try {
        const meta = JSON.parse(await readFile(file, "utf8"));
        if (meta.sessionId) runMetaBySession.set(meta.sessionId, meta);
      } catch { /* ignore */ }
      continue;
    }
    const text = await readFile(file, "utf8").catch(() => "");
    if (!text.includes("dynamic tool exposure") && !text.includes("llm step usage")) continue;
    const runName = (() => {
      const rel = path.relative(runsDir, file);
      const seg = rel.split(path.sep);
      return seg.length >= 2 ? `${seg[0]}/${seg[1]}` : seg[0];
    })();
    for (const line of text.split("\n")) {
      if (!line.includes("level=INFO")) continue;
      if (line.includes('message="dynamic tool exposure"')) {
        const kv = parseKv(line);
        exposures.push({
          run: runName,
          ts: kv.timestamp,
          session: kv["session.id"],
          turn: kv["turn.id"],
          assistant: kv["assistant.id"],
          visible_tools: num(kv.visible_tools),
          loaded: num(kv.loaded),
          toolset_hash: kv.toolset_hash || "",
          previous_toolset_hash: kv.previous_toolset_hash || "",
          toolset_changed: kv.toolset_changed === "true" ? "1" : "0",
          toolset_added: num(kv.toolset_added),
          toolset_removed: num(kv.toolset_removed),
          visible_schema_bytes: num(kv.visible_schema_bytes),
        });
      } else if (line.includes('message="llm step usage"')) {
        const kv = parseKv(line);
        const key = `${kv["session.id"]}|${kv["assistant.id"]}`;
        usages.set(key, {
          tokens_input: num(kv["tokens.input"]),
          tokens_output: num(kv["tokens.output"]),
          tokens_reasoning: num(kv["tokens.reasoning"]),
          cache_read: num(kv["tokens.cache.read"]),
          cache_write: num(kv["tokens.cache.write"]),
          tokens_prompt: num(kv["tokens.prompt"]),
          cache_read_reported: kv["cache.read.provider_reported"] === "true" ? "1" : "0",
          cache_write_reported: kv["cache.write.provider_reported"] === "true" ? "1" : "0",
          llm_model: kv["llm.model"] || "",
        });
      } else if (/compac/i.test(line)) {
        const kv = parseKv(line);
        const session = kv["session.id"];
        if (session) compactionCounts.set(session, (compactionCounts.get(session) || 0) + 1);
      }
    }
  }

  // Join + order
  exposures.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  const stepSeqBySession = new Map();
  const rows = exposures.map((exposure) => {
    const usage = usages.get(`${exposure.session}|${exposure.assistant}`) || {};
    const seq = (stepSeqBySession.get(exposure.session) || 0) + 1;
    stepSeqBySession.set(exposure.session, seq);
    const meta = runMetaBySession.get(exposure.session) || {};
    return {
      run: exposure.run,
      task: meta.taskFile || "",
      soft_wall: meta.softWall ?? "",
      context_limit: meta.contextLimit ?? "",
      reserved: meta.reserved ?? "",
      session: exposure.session,
      turn: exposure.turn,
      step: seq,
      ts: exposure.ts,
      visible_tools: exposure.visible_tools,
      loaded: exposure.loaded,
      toolset_hash: exposure.toolset_hash,
      toolset_changed: exposure.toolset_changed,
      toolset_added: exposure.toolset_added,
      toolset_removed: exposure.toolset_removed,
      visible_schema_bytes: exposure.visible_schema_bytes,
      tokens_input: usage.tokens_input ?? "",
      tokens_output: usage.tokens_output ?? "",
      tokens_reasoning: usage.tokens_reasoning ?? "",
      cache_read: usage.cache_read ?? "",
      cache_write: usage.cache_write ?? "",
      tokens_prompt: usage.tokens_prompt ?? "",
      cache_read_reported: usage.cache_read_reported ?? "",
      cache_write_reported: usage.cache_write_reported ?? "",
      context_bucket: contextBucket(usage.tokens_prompt),
      compaction_events: compactionCounts.get(exposure.session) || 0,
      llm_model: usage.llm_model || "",
    };
  });

  const header = Object.keys(rows[0] || {
    run: "", task: "", soft_wall: "", context_limit: "", reserved: "", session: "", turn: "", step: "", ts: "",
    visible_tools: "", loaded: "", toolset_hash: "", toolset_changed: "", toolset_added: "", toolset_removed: "",
    visible_schema_bytes: "", tokens_input: "", tokens_output: "", tokens_reasoning: "", cache_read: "",
    cache_write: "", tokens_prompt: "", cache_read_reported: "", cache_write_reported: "", context_bucket: "",
    compaction_events: "", llm_model: "",
  });
  const csv = [header.join(","), ...rows.map((row) => header.map((key) => String(row[key] ?? "")).join(","))].join("\n") + "\n";
  await writeFile(outFile, csv, "utf8");
  console.log(`[join] ${rows.length} steps -> ${outFile}`);

  if (!wantSummary) return;

  // Toolset-change impact summary: cache.read before vs at change, recovery steps.
  const bySession = new Map();
  for (const row of rows) {
    if (!bySession.has(row.session)) bySession.set(row.session, []);
    bySession.get(row.session).push(row);
  }
  console.log("\n[join] toolset change impact (per session):");
  for (const [session, sessionRows] of bySession) {
    const meta = runMetaBySession.get(session) || {};
    for (let i = 1; i < sessionRows.length; i++) {
      const row = sessionRows[i];
      if (row.toolset_changed !== "1") continue;
      const prev = sessionRows[i - 1];
      const before = Number(prev.cache_read);
      const after = Number(row.cache_read);
      if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
      let recovery = "";
      for (let j = i + 1; j < sessionRows.length; j++) {
        const candidate = Number(sessionRows[j].cache_read);
        if (Number.isFinite(candidate) && before > 0 && candidate >= before * 0.8) {
          recovery = j - i;
          break;
        }
      }
      console.log(
        `  ${meta.label || session} step ${prev.step}->${row.step}`
        + ` bucket=${row.context_bucket} loaded ${prev.loaded}->${row.loaded}`
        + ` cache.read ${before}->${after} (delta ${after - before})`
        + ` recovery=${recovery === "" ? "not-in-sample" : `${recovery} steps`}`,
      );
    }
  }

  // Per-run totals
  console.log("\n[join] per-run totals:");
  const totals = new Map();
  for (const row of rows) {
    const key = row.run;
    const t = totals.get(key) || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, steps: 0 };
    t.input += Number(row.tokens_input) || 0;
    t.output += Number(row.tokens_output) || 0;
    t.cacheRead += Number(row.cache_read) || 0;
    t.cacheWrite += Number(row.cache_write) || 0;
    t.steps += 1;
    totals.set(key, t);
  }
  for (const [run, t] of totals) {
    const hitRate = t.cacheRead + t.input > 0 ? ((t.cacheRead / (t.cacheRead + t.input)) * 100).toFixed(1) : "n/a";
    console.log(`  ${run}: steps=${t.steps} input=${t.input} cache.read=${t.cacheRead} cache.write=${t.cacheWrite} output=${t.output} hit=${hitRate}%`);
  }
}

await main();
