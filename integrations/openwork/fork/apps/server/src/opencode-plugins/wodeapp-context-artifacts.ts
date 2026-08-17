import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CONTEXT_READBACK_POLICY = Object.freeze({
  version: "wodeappx.context-readback/1",
  searchFirst: true,
  maxLines: 120,
  maxChars: 8_000,
  neverWholeFile: true,
});

export type ContextReadbackPlan = {
  policy: typeof CONTEXT_READBACK_POLICY;
  artifactKind: string;
  path: string;
  queryHint?: string;
  hint: string;
};

export type ContextReadbackTraceStep = {
  tool: string;
  args?: Record<string, unknown>;
};

export type SessionTranscriptArtifact = {
  path: string;
  bytes: number;
  lines: number;
  messageCount: number;
  createdAt: string;
};

const SECRET_KEY_RE =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|password|secret|client[-_]?secret)$/i;
const DATA_URL_RE = /data:[^,\s"'<>]+,[a-z0-9+/=_-]+/gi;

function redactString(value: string): string {
  const withoutDataUrls = value.replace(DATA_URL_RE, (match) => {
    const mime = /^data:([^;,]+)/i.exec(match)?.[1] || "unknown";
    return `[WodeApp data URL omitted: mime=${mime} chars=${match.length}]`;
  });
  return withoutDataUrls
    .replace(/\b(Bearer\s+)[a-z0-9._~+/=-]{8,}/gi, "$1[REDACTED]")
    .replace(/\bsk_(live|test)_[a-z0-9_-]{8,}\b/gi, "sk_$1_[REDACTED]")
    .replace(/\bsk-[a-z0-9_-]{12,}\b/gi, "sk-[REDACTED]")
    .replace(
      /\b(authorization|cookie|x-api-key|api[-_]?key|access[-_]?token|refresh[-_]?token|token|password|secret)\s*([:=])\s*["']?[^\s"',;}{]{8,}["']?/gi,
      "$1$2[REDACTED]",
    );
}

export function sanitizeContextArtifactValue(
  value: unknown,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === "string") return redactString(value);
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[WodeApp circular value omitted]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeContextArtifactValue(item, seen));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key,
      SECRET_KEY_RE.test(key)
        ? "[REDACTED]"
        : sanitizeContextArtifactValue(nested, seen),
    ]),
  );
}

function safeSessionDirectory(sessionID: string): string {
  const readable = sessionID.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 72) || "session";
  const suffix = createHash("sha256").update(sessionID).digest("hex").slice(0, 8);
  return `${readable}-${suffix}`;
}

export async function writeSessionTranscriptArtifact(input: {
  sessionID: string;
  messages: Array<{ info?: unknown; parts?: unknown[] }>;
  artifactRoot?: string;
}): Promise<SessionTranscriptArtifact> {
  const createdAt = new Date().toISOString();
  const root = input.artifactRoot || join(tmpdir(), "wodeappx-session-history");
  const directory = join(root, safeSessionDirectory(input.sessionID));
  await mkdir(root, { recursive: true, mode: 0o700 });
  await chmod(root, 0o700);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);

  const lines: string[] = [
    JSON.stringify({
      kind: "artifact",
      version: "wodeappx.session-transcript/1",
      sessionID: input.sessionID,
      createdAt,
      messageCount: input.messages.length,
    }),
  ];
  input.messages.forEach((message, messageIndex) => {
    const sanitizedInfo = sanitizeContextArtifactValue(message.info);
    const messageID =
      sanitizedInfo && typeof sanitizedInfo === "object" && !Array.isArray(sanitizedInfo)
        ? String((sanitizedInfo as Record<string, unknown>).id || "")
        : "";
    lines.push(JSON.stringify({
      kind: "message",
      messageIndex,
      info: sanitizedInfo,
    }));
    const parts = Array.isArray(message.parts) ? message.parts : [];
    parts.forEach((part, partIndex) => {
      lines.push(JSON.stringify({
        kind: "part",
        messageIndex,
        ...(messageID ? { messageID } : {}),
        partIndex,
        part: sanitizeContextArtifactValue(part),
      }));
    });
  });

  const content = `${lines.join("\n")}\n`;
  const path = join(directory, "transcript.jsonl");
  const temporaryPath = join(directory, `.transcript-${process.pid}-${randomUUID()}.tmp`);
  await writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
  await chmod(path, 0o600);
  return {
    path,
    bytes: Buffer.byteLength(content),
    lines: lines.length,
    messageCount: input.messages.length,
    createdAt,
  };
}

export function buildContextReadbackPlan(input: {
  artifactKind: string;
  path: string;
  queryHint?: string;
}): ContextReadbackPlan {
  const query = input.queryHint?.trim();
  return {
    policy: CONTEXT_READBACK_POLICY,
    artifactKind: input.artifactKind,
    path: input.path,
    ...(query ? { queryHint: query } : {}),
    hint: [
      `Recover exact details from the ${input.artifactKind} at path=${JSON.stringify(input.path)} only when needed.`,
      `Search first with grep/rg${query ? ` for ${JSON.stringify(query)}` : ""}.`,
      `Then read only the relevant window: read with offset and limit<=${CONTEXT_READBACK_POLICY.maxLines}, or openwork_file_extract_text with offset and maxChars<=${CONTEXT_READBACK_POLICY.maxChars}.`,
      "Never cat or read the entire artifact back into model context.",
    ].join(" "),
  };
}

function referencesPath(step: ContextReadbackTraceStep, path: string): boolean {
  try {
    return JSON.stringify(step.args ?? {}).includes(path);
  } catch {
    return false;
  }
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Deterministic evaluator for captured model/tool traces. Live model evals can
 * feed their steps here so spill, transcript and knowledge recovery share one
 * acceptance rule.
 */
export function evaluateContextReadbackTrace(input: {
  path: string;
  steps: ContextReadbackTraceStep[];
}): { ok: boolean; violations: string[] } {
  const relevant = input.steps.filter((step) => referencesPath(step, input.path));
  const violations: string[] = [];
  if (relevant.length === 0) {
    return { ok: false, violations: ["artifact_not_accessed"] };
  }

  const first = relevant[0];
  const firstTool = first.tool.trim().toLowerCase();
  const firstCommand = typeof first.args?.command === "string" ? first.args.command : "";
  const searchedFirst =
    firstTool === "grep"
    || firstTool === "rg"
    || (firstTool === "bash" && /(^|\s)(rg|grep)(\s|$)/.test(firstCommand));
  if (!searchedFirst) violations.push("search_first_required");

  relevant.forEach((step) => {
    const tool = step.tool.trim().toLowerCase();
    const command = typeof step.args?.command === "string" ? step.args.command : "";
    if (tool === "bash" && /(^|[;&|]\s*|\s)cat(\s|$)/.test(command)) {
      violations.push("whole_file_cat_forbidden");
    }
    if (tool === "read") {
      const offset = finiteNumber(step.args?.offset);
      const limit = finiteNumber(step.args?.limit);
      if (offset === null || offset < 0 || limit === null || limit < 1 || limit > CONTEXT_READBACK_POLICY.maxLines) {
        violations.push("read_window_unbounded");
      }
    }
    if (tool === "openwork_file_extract_text") {
      const offset = finiteNumber(step.args?.offset);
      const maxChars = finiteNumber(step.args?.maxChars);
      if (offset === null || offset < 0 || maxChars === null || maxChars < 1 || maxChars > CONTEXT_READBACK_POLICY.maxChars) {
        violations.push("extract_window_unbounded");
      }
    }
  });

  return { ok: violations.length === 0, violations: [...new Set(violations)] };
}
