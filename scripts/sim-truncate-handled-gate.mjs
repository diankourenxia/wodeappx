#!/usr/bin/env node
/**
 * Simulation: Truncate wrap gate (old vs new) + Truncate.output byte/line cap.
 * No LLM / no credits. Exit 1 on assertion failure.
 *
 *   node scripts/sim-truncate-handled-gate.mjs
 */
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "scripts/context-bench/runs/sim-truncate-handled-gate");
mkdirSync(outDir, { recursive: true });

/** Upstream buggy gate: any pagination `truncated` field skips Truncate. */
function shouldSkipTruncateOld(metadata) {
  return metadata?.truncated !== undefined;
}

/** WodeAppX gate: only tools that already applied Truncate.limits/output skip. */
function shouldSkipTruncateNew(metadata) {
  return metadata?.truncateHandled === true;
}

function truncateOutput(text, { maxLines = 80, maxBytes = 8192 } = {}) {
  const lines = text.split("\n");
  const totalBytes = Buffer.byteLength(text, "utf-8");
  if (lines.length <= maxLines && totalBytes <= maxBytes) {
    return { content: text, truncated: false };
  }
  const out = [];
  let bytes = 0;
  for (let i = 0; i < lines.length && i < maxLines; i++) {
    const size = Buffer.byteLength(lines[i], "utf-8") + (i > 0 ? 1 : 0);
    if (bytes + size > maxBytes) break;
    out.push(lines[i]);
    bytes += size;
  }
  const preview = out.join("\n");
  return {
    content: `${preview}\n\n...truncated...\n\nFull output spilled (sim).`,
    truncated: true,
  };
}

const fatRead = Array.from({ length: 200 }, (_, i) => `line-${i}-${"x".repeat(80)}`).join("\n");
assert.ok(Buffer.byteLength(fatRead, "utf-8") > 8192, "fixture must exceed cap");

const cases = [
  {
    name: "read_pagination_false_12k",
    metadata: { truncated: false },
    output: fatRead,
  },
  {
    name: "read_pagination_true_12k",
    metadata: { truncated: true },
    output: fatRead,
  },
  {
    name: "glob_truncated_false_small",
    metadata: { truncated: false },
    output: "a\nb\n",
  },
  {
    name: "shell_self_truncate",
    metadata: { truncated: true, truncateHandled: true },
    output: "ok\n",
  },
  {
    name: "shell_under_limit_handled",
    metadata: { truncated: false, truncateHandled: true },
    output: "ok\n",
  },
  {
    name: "plugin_undocumented_optout_truncated_only",
    metadata: { truncated: true },
    output: fatRead,
  },
];

const matrix = [];
for (const c of cases) {
  const skipOld = shouldSkipTruncateOld(c.metadata);
  const skipNew = shouldSkipTruncateNew(c.metadata);
  const afterOld = skipOld ? c.output : truncateOutput(c.output).content;
  const afterNew = skipNew ? c.output : truncateOutput(c.output).content;
  matrix.push({
    name: c.name,
    skipOld,
    skipNew,
    inBytes: Buffer.byteLength(c.output, "utf-8"),
    outBytesOld: Buffer.byteLength(afterOld, "utf-8"),
    outBytesNew: Buffer.byteLength(afterNew, "utf-8"),
  });
}

// Assertions: read/glob must NOT skip under new gate; shell must skip.
assert.equal(matrix.find((r) => r.name === "read_pagination_false_12k").skipOld, true);
assert.equal(matrix.find((r) => r.name === "read_pagination_false_12k").skipNew, false);
assert.equal(matrix.find((r) => r.name === "read_pagination_true_12k").skipNew, false);
assert.equal(matrix.find((r) => r.name === "shell_self_truncate").skipNew, true);
assert.equal(matrix.find((r) => r.name === "shell_under_limit_handled").skipNew, true);

const readNew = matrix.find((r) => r.name === "read_pagination_false_12k");
assert.ok(readNew.outBytesNew < readNew.inBytes, "new gate must shrink fat read");
assert.ok(readNew.outBytesNew <= 8192 + 120, `read must be capped, got ${readNew.outBytesNew}`);
assert.ok(readNew.outBytesOld > 8192, "old gate left fat payload intact");

// Undocumented plugin escape via truncated alone no longer works (intentional).
assert.equal(
  matrix.find((r) => r.name === "plugin_undocumented_optout_truncated_only").skipNew,
  false,
);

const report = {
  ok: true,
  policy: { max_lines: 80, max_bytes: 8192 },
  matrix,
  notes: [
    "Old gate: metadata.truncated !== undefined → skip (read/glob bypass).",
    "New gate: truncateHandled === true → skip (shell only among builtins).",
    "Plugin opt-out must set truncateHandled; truncated alone is not enough.",
  ],
};

writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`\nWrote ${path.join(outDir, "report.json")}`);
