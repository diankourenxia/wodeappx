#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const CASE_ORDER = [
  "small-talk",
  "capability-discovery",
  "weather",
  "web-search",
  "web-read",
  "local-file",
  "wodeapp-docs",
  "mixed-web-file",
  "browser",
  "desktop-readonly",
  "ui-snapshot",
  "capture-status",
  "general-progressive-discovery",
  "product-visual-capability",
  "shopify-status",
  "multi-turn-weather",
  "tool-failure-honesty",
  "safety-no-authorization",
  "image-generation",
  "video-generation",
  "automation-create-cleanup",
  "site-create-publish",
  "agent-app-create",
];

function usage(message) {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write("Usage: node scripts/merge-live-agent-reports.mjs --output <dir> <evidence-dir>...\n");
  process.exit(1);
}

function parseArgs(argv) {
  const inputs = [];
  let output = "";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--output") output = argv[++index] ?? "";
    else if (arg.startsWith("--")) usage(`Unknown option: ${arg}`);
    else inputs.push(arg);
  }
  if (!output || !inputs.length) usage();
  return { output: path.resolve(output), inputs: inputs.map((input) => path.resolve(input)) };
}

function truncate(value, limit) {
  const text = String(value ?? "");
  return text.length <= limit ? text : `${text.slice(0, limit)}\n<...truncated ${text.length - limit} chars>`;
}

function newest(left, right) {
  const leftTime = Date.parse(left?.endedAt ?? left?.startedAt ?? 0) || 0;
  const rightTime = Date.parse(right?.endedAt ?? right?.startedAt ?? 0) || 0;
  return rightTime >= leftTime ? right : left;
}

function loadCases(inputs) {
  const selected = new Map();
  const attempts = new Map();
  for (const directory of inputs) {
    if (!existsSync(directory)) usage(`Evidence directory does not exist: ${directory}`);
    const files = readdirSync(directory).filter((file) => /^\d+-.+\.json$/i.test(file)).sort();
    for (const file of files) {
      const source = path.join(directory, file);
      const parsed = JSON.parse(readFileSync(source, "utf8"));
      if (!parsed?.id || !Array.isArray(parsed.turns)) continue;
      const candidate = { ...parsed, evidenceSource: source };
      const list = attempts.get(parsed.id) ?? [];
      list.push({ source, verdict: parsed.verdict, startedAt: parsed.startedAt, endedAt: parsed.endedAt });
      attempts.set(parsed.id, list);
      selected.set(parsed.id, newest(selected.get(parsed.id), candidate));
    }
  }
  return { selected, attempts };
}

function formatTime(value) {
  if (!value) return "";
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric).toISOString();
  return String(value);
}

function caseMarkdown(item) {
  const lines = [
    `## ${item.id}`,
    "",
    `- 能力族：${item.family}`,
    `- 结论：${item.verdict}`,
    `- 证据文件：${item.evidenceSource}`,
    `- 开始：${item.startedAt}`,
    `- 结束：${item.endedAt}`,
    `- 总耗时：${item.durationMs ?? 0} ms`,
    "",
  ];
  if (item.error) lines.push(`- 错误：${item.error}`, "");
  for (const turn of item.turns ?? []) {
    lines.push(
      `### Turn ${turn.index}`,
      "",
      `- Session：${turn.sessionId ?? "未获取"}`,
      `- 模型：${turn.models?.map((model) => `${model.providerId}/${model.modelId}`).filter(Boolean).join(", ") || "未获取"}`,
      `- 判定：${turn.analysis?.verdict ?? "ERROR"} — ${turn.analysis?.reason ?? "无"}`,
      `- 耗时：${turn.durationMs ?? 0} ms`,
      "",
      "Prompt：",
      "",
      "```text",
      turn.prompt ?? "",
      "```",
      "",
      "阶段时间：",
      "",
      "| 阶段 | 开始 | 结束 | 耗时(ms) | 状态 |",
      "|---|---|---|---:|---|",
      ...(turn.phases ?? []).map((phase) => `| ${phase.name} | ${phase.startedAt ?? ""} | ${phase.endedAt ?? ""} | ${phase.durationMs ?? ""} | ${phase.status ?? ""} |`),
      "",
      `启用工具（${turn.enabledTools?.length ?? 0}）：${turn.enabledTools?.join(", ") || "无"}`,
      "",
      `禁用工具数量：${turn.disabledTools?.length ?? 0}`,
      "",
      "实际工具调用：",
      "",
    );
    if (!turn.toolCalls?.length) {
      lines.push("无。", "");
    } else {
      for (const call of turn.toolCalls) {
        lines.push(
          `#### ${call.tool}`,
          "",
          `- 状态：${call.status ?? "unknown"}`,
          `- 开始：${formatTime(call.time?.start)}`,
          `- 结束：${formatTime(call.time?.end)}`,
          `- 耗时：${call.durationMs ?? ""} ms`,
          "",
          "参数：",
          "",
          "```json",
          truncate(JSON.stringify(call.input ?? {}, null, 2), 8_000),
          "```",
          "",
          call.error
            ? `错误：\n\n\`\`\`text\n${truncate(call.error, 8_000)}\n\`\`\``
            : `结果摘录：\n\n\`\`\`text\n${truncate(call.output, 12_000)}\n\`\`\``,
          "",
        );
      }
    }
    lines.push(
      "最终回答：",
      "",
      "```text",
      turn.finalAnswer || "<无最终回答>",
      "```",
      "",
      "模型推理记录（测试证据，仅本地）：",
      "",
      "```text",
      truncate(turn.reasoning || "<无>", 12_000),
      "```",
      "",
    );
  }
  return lines.join("\n");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const { selected, attempts } = loadCases(options.inputs);
  const missing = CASE_ORDER.filter((id) => !selected.has(id));
  const extras = [...selected.keys()].filter((id) => !CASE_ORDER.includes(id));
  const cases = [
    ...CASE_ORDER.flatMap((id) => selected.has(id) ? [selected.get(id)] : []),
    ...extras.map((id) => selected.get(id)),
  ];
  const counts = {};
  for (const item of cases) counts[item.verdict] = (counts[item.verdict] ?? 0) + 1;
  const startedAt = cases.map((item) => item.startedAt).filter(Boolean).sort()[0] ?? null;
  const endedAt = cases.map((item) => item.endedAt).filter(Boolean).sort().at(-1) ?? null;
  const verdict = missing.length || cases.some((item) => ["FAIL", "ERROR"].includes(item.verdict))
    ? "FAIL"
    : cases.some((item) => item.verdict === "INCONCLUSIVE") ? "INCONCLUSIVE" : "PASS";
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    verdict,
    expectedCaseCount: CASE_ORDER.length,
    selectedCaseCount: cases.length,
    counts,
    missing,
    inputs: options.inputs,
    startedAt,
    endedAt,
    attempts: Object.fromEntries([...attempts.entries()]),
    cases,
  };
  mkdirSync(options.output, { recursive: true });
  writeFileSync(path.join(options.output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  const lines = [
    "# WodeAppX Live Agent 全能力合并实操报告",
    "",
    `- 生成时间：${report.generatedAt}`,
    `- 覆盖：${cases.length}/${CASE_ORDER.length}`,
    `- 结论：${verdict}`,
    `- 结果：PASS ${counts.PASS ?? 0} / FAIL ${counts.FAIL ?? 0} / INCONCLUSIVE ${counts.INCONCLUSIVE ?? 0} / ERROR ${counts.ERROR ?? 0}`,
    `- 缺失：${missing.join(", ") || "无"}`,
    "",
    "## 汇总",
    "",
    "| 用例 | 能力族 | 结论 | 耗时(ms) | Session | 实际工具 |",
    "|---|---|---|---:|---|---|",
    ...cases.map((item) => {
      const sessions = item.turns?.map((turn) => turn.sessionId).filter(Boolean).join("<br>") || "";
      const tools = [...new Set(item.turns?.flatMap((turn) => turn.toolCalls?.map((call) => call.tool) ?? []) ?? [])].join("<br>") || "无";
      return `| ${item.id} | ${item.family} | ${item.verdict} | ${item.durationMs ?? 0} | ${sessions} | ${tools} |`;
    }),
    "",
    "## 完整证据",
    "",
    ...cases.flatMap((item) => [caseMarkdown(item), ""]),
  ];
  writeFileSync(path.join(options.output, "REPORT.md"), `${lines.join("\n")}\n`);
  process.stdout.write(`Merged ${cases.length}/${CASE_ORDER.length} cases: ${verdict}\n${path.join(options.output, "REPORT.md")}\n`);
  if (verdict === "FAIL") process.exitCode = 1;
  else if (verdict === "INCONCLUSIVE") process.exitCode = 2;
}

main();
