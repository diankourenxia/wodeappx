/**
 * When OpenCode prunes tool dumps (`time.compacted`), the model used to see only
 * "[Old tool result content cleared]" — no paths, commands, or findings.
 * Codex-like continuability needs a short conclusion stub: what was called,
 * the durable keys from input, and a head excerpt of the outcome.
 */

export const COMPACTED_TOOL_STUB_MARKER = "[WodeApp compacted tool]";

const INPUT_KEYS = [
  "filePath",
  "path",
  "command",
  "cmd",
  "pattern",
  "glob",
  "query",
  "url",
  "offset",
  "limit",
  "oldString",
  "newString",
  "content",
] as const;

const MAX_INPUT_VALUE_CHARS = 240;
const MAX_CONCLUSION_CHARS = 700;
const MAX_STUB_CHARS = 1_200;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function oneLine(value: string, max = MAX_INPUT_VALUE_CHARS): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}…`;
}

function pickInputLines(input: unknown): string[] {
  const record = asRecord(input);
  if (!record) return [];
  const lines: string[] = [];
  for (const key of INPUT_KEYS) {
    const raw = record[key];
    if (typeof raw === "string" && raw.trim()) {
      lines.push(`${key}: ${oneLine(raw)}`);
      continue;
    }
    if (typeof raw === "number" && Number.isFinite(raw)) {
      lines.push(`${key}: ${raw}`);
    }
  }
  if (lines.length > 0) return lines;
  // Fallback: first few primitive fields so unknown tools still leave a trail.
  for (const [key, value] of Object.entries(record).slice(0, 4)) {
    if (typeof value === "string" && value.trim()) {
      lines.push(`${key}: ${oneLine(value)}`);
    } else if (typeof value === "number" && Number.isFinite(value)) {
      lines.push(`${key}: ${value}`);
    }
  }
  return lines;
}

function conclusionFromOutput(output: unknown): string {
  if (typeof output !== "string") return "";
  const trimmed = output.trim();
  if (!trimmed) return "";
  if (trimmed.includes(COMPACTED_TOOL_STUB_MARKER)) {
    // Already a stub — keep as-is for callers that re-stub.
    return "";
  }
  const head = trimmed.length <= MAX_CONCLUSION_CHARS
    ? trimmed
    : `${trimmed.slice(0, MAX_CONCLUSION_CHARS)}\n…`;
  return head;
}

export function hasCompactedToolStubMarker(text: string | null | undefined): boolean {
  return typeof text === "string" && text.includes(COMPACTED_TOOL_STUB_MARKER);
}

/**
 * Build a model-facing stub that preserves useful conclusions after prune.
 * Full stdout stays recoverable by re-running the same tool.
 */
export function buildCompactedToolOutputStub(input: {
  tool: string;
  input?: unknown;
  output?: unknown;
  title?: string;
}): string {
  const tool = String(input.tool || "tool").trim() || "tool";
  const lines = [
    COMPACTED_TOOL_STUB_MARKER,
    `tool: ${tool}`,
  ];
  if (typeof input.title === "string" && input.title.trim()) {
    lines.push(`title: ${oneLine(input.title, 120)}`);
  }
  for (const line of pickInputLines(input.input)) {
    lines.push(line);
  }
  const conclusion = conclusionFromOutput(input.output);
  if (conclusion) {
    lines.push("conclusion:");
    lines.push(conclusion);
  } else {
    lines.push("conclusion: (none retained)");
  }
  lines.push("note: Full tool output cleared from model context; re-run the same tool for details.");
  const stub = lines.join("\n");
  if (stub.length <= MAX_STUB_CHARS) return stub;
  return `${stub.slice(0, MAX_STUB_CHARS)}\n…`;
}

/**
 * Model-facing tool output after prune: prefer an existing stub, else build one.
 * Never return the blank upstream placeholder alone.
 */
export function modelFacingCompactedToolOutput(part: {
  tool: string;
  state: {
    input?: unknown;
    output?: unknown;
    title?: string;
  };
}): string {
  const output = typeof part.state.output === "string" ? part.state.output : "";
  if (hasCompactedToolStubMarker(output)) return output;
  return buildCompactedToolOutputStub({
    tool: part.tool,
    input: part.state.input,
    output: part.state.output,
    title: typeof part.state.title === "string" ? part.state.title : undefined,
  });
}
