/**
 * Codex/Cursor-style gate: OpenCode generic `read` must never re-inject PDF /
 * raster binary as tool `attachments` into the next chat/completions turn.
 *
 * Primary: block `read` on media paths (recoverable redirect to openwork_*).
 * Safety net: strip unsafe attachments from messages before the model call.
 */

import { createToolItemFailure } from "./openwork-tool-result.js";
import {
  buildContextReadbackPlan,
  writeSessionTranscriptArtifact,
} from "./wodeapp-context-artifacts.js";

const READ_TOOL_NAMES = new Set(["read", "Read", "READ"]);

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|heif|avif|ico)$/i;
const PDF_EXT_RE = /\.pdf$/i;
const OFFICE_EXT_RE = /\.(docx?|xlsx?|pptx?|odt|ods|odp)$/i;
const MEDIA_EXT_RE = /\.(mp4|webm|mov|m4v|avi|mkv|mp3|wav|m4a|aac|flac|ogg)$/i;

const DATA_IMAGE_URL_RE = /^data:image\//i;
const DATA_URL_RE = /^data:/i;
const DATA_APPLICATION_URL_RE = /^data:application\//i;

export type ReadMediaKind = "pdf" | "image" | "office" | "media" | null;

export function extractReadPathFromArgs(args: unknown): string {
  if (!args || typeof args !== "object" || Array.isArray(args)) return "";
  const record = args as Record<string, unknown>;
  for (const key of ["filePath", "filepath", "path", "file", "filename", "target"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function classifyReadMediaPath(pathOrName: string): ReadMediaKind {
  const value = pathOrName.trim().split(/[?#]/)[0] || "";
  if (!value) return null;
  if (PDF_EXT_RE.test(value)) return "pdf";
  if (IMAGE_EXT_RE.test(value)) return "image";
  if (OFFICE_EXT_RE.test(value)) return "office";
  if (MEDIA_EXT_RE.test(value)) return "media";
  return null;
}

export function redirectHintForReadMedia(kind: ReadMediaKind, path: string): string {
  const quoted = path || "(path)";
  switch (kind) {
    case "pdf":
      return [
        `Do not use OpenCode read on PDF files (${quoted}).`,
        "Call openwork_pdf_info, then openwork_pdf_extract_text.",
        "For scans/tables/layout: openwork_pdf_render_pages (bounded page previews attach automatically).",
        "Never embed PDF bytes into chat completions.",
      ].join(" ");
    case "image":
      return [
        `Do not use OpenCode read on image files (${quoted}).`,
        "Call openwork_media_view for a bounded current-turn preview (local path, https://, or image-proxy URL), or image_inspect for local dimensions only.",
        "Chat uploads may also use selectedImageIds / candidateHttpsImages.",
        "read embeds full-resolution base64 into history and can poison the next model call.",
      ].join(" ");
    case "office":
      return [
        `Do not use OpenCode read on Office files (${quoted}).`,
        "Call openwork_file_extract_text (bounded windows; continue with nextOffset when hasMore).",
      ].join(" ");
    case "media":
      return [
        `Do not use OpenCode read on audio/video files (${quoted}).`,
        "Use a dedicated media tool or summarize via a local extractor; never inline binary into chat.",
      ].join(" ");
    default:
      return "Use a dedicated openwork_* file tool instead of OpenCode read for binary media.";
  }
}

export function assertReadToolAllowsPath(tool: string, args: unknown): void {
  if (!READ_TOOL_NAMES.has(tool.trim())) return;
  const path = extractReadPathFromArgs(args);
  const kind = classifyReadMediaPath(path);
  if (!kind) return;
  throw createToolItemFailure({
    message: redirectHintForReadMedia(kind, path),
    recoverable: true,
    errorKind: "validation",
    data: {
      code: "READ_MEDIA_BLOCKED",
      kind,
      path,
      nextActions:
        kind === "pdf"
          ? ["openwork_pdf_info", "openwork_pdf_extract_text", "openwork_pdf_render_pages"]
          : kind === "image"
            ? ["openwork_media_view", "image_inspect"]
            : kind === "office"
              ? ["openwork_file_extract_text"]
              : [],
    },
  });
}

export function isUnsafeToolAttachment(
  attachment: unknown,
  toolName?: string,
): boolean {
  if (!attachment || typeof attachment !== "object" || Array.isArray(attachment)) return false;
  const item = attachment as Record<string, unknown>;
  const url = typeof item.url === "string" ? item.url.trim() : "";
  const mime = typeof item.mime === "string" ? item.mime.trim().toLowerCase() : "";
  const tool = (toolName || "").trim();

  if (READ_TOOL_NAMES.has(tool)) {
    // Generic read must never feed vision/binary attachments into the model.
    return Boolean(url || mime);
  }

  if (mime === "application/pdf" || mime.startsWith("application/")) return true;
  if (url && DATA_APPLICATION_URL_RE.test(url)) return true;
  if (url && DATA_URL_RE.test(url) && !DATA_IMAGE_URL_RE.test(url)) return true;
  return false;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

const STRIP_MARKER = "[WodeApp stripped unsafe tool attachment]";

/** Forwarded on OpenCode chat/completions so aiProxy can gate compaction flatten. */
export const WODEAPP_REQUEST_KIND_HEADER = "X-WodeApp-Request-Kind";
export const WODEAPP_REQUEST_KIND_COMPACTION = "compaction";
/** Correlates proxy TTFT / hang-trace with OpenCode session. */
export const WODEAPP_SESSION_ID_HEADER = "X-WodeApp-Session-Id";
/** Correlates one OpenCode user turn with mainserver and the selected upstream. */
export const WODEAPP_REQUEST_ID_HEADER = "X-WodeApp-Request-Id";
export const HANG_TRACE_JSONL_PATH = "/tmp/opencode-hang-trace.jsonl";
/** Sidecar jsonl retention: half a month. */
export const HANG_TRACE_JSONL_RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
const HANG_TRACE_JSONL_PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;
const HANG_TRACE_JSONL_MAX_BYTES = 8 * 1024 * 1024;

let hangTraceJsonlLastPruneAt = 0;

export function applyCompactionRequestKindHeader(
  input: { agent?: string },
  output: { headers: Record<string, string> },
): void {
  if (input.agent !== WODEAPP_REQUEST_KIND_COMPACTION) return;
  output.headers[WODEAPP_REQUEST_KIND_HEADER] = WODEAPP_REQUEST_KIND_COMPACTION;
}

/** Keep jsonl lines whose `at` ISO timestamp is within retention (pure). */
export function filterHangTraceJsonlLines(
  content: string,
  options?: { now?: number; retentionMs?: number },
): { kept: string; removed: number; total: number } {
  const now = typeof options?.now === "number" ? options.now : Date.now();
  const retentionMs =
    typeof options?.retentionMs === "number" && options.retentionMs > 0
      ? options.retentionMs
      : HANG_TRACE_JSONL_RETENTION_MS;
  const cutoff = now - retentionMs;
  const lines = content.split(/\n/);
  const keptLines: string[] = [];
  let removed = 0;
  let total = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    total += 1;
    let keep = true;
    try {
      const row = JSON.parse(trimmed) as { at?: string; ts?: number };
      const ts =
        typeof row.ts === "number"
          ? row.ts
          : typeof row.at === "string"
            ? Date.parse(row.at)
            : Number.NaN;
      if (Number.isFinite(ts) && ts < cutoff) keep = false;
    } catch {
      // Keep unparsable lines (safer than silent wipe).
    }
    if (keep) keptLines.push(trimmed);
    else removed += 1;
  }
  return {
    kept: keptLines.length ? `${keptLines.join("\n")}\n` : "",
    removed,
    total,
  };
}

/**
 * Append one hang-trace jsonl row; prune by age at most once/day (or when oversized).
 * Pure fs ops are injectable for tests.
 */
export function appendHangTraceJsonl(
  row: Record<string, unknown>,
  options?: {
    path?: string;
    now?: number;
    retentionMs?: number;
    maxBytes?: number;
    forcePrune?: boolean;
    fs?: {
      appendFileSync: (path: string, data: string) => void;
      existsSync: (path: string) => boolean;
      readFileSync: (path: string, encoding: "utf8") => string;
      writeFileSync: (path: string, data: string) => void;
      statSync: (path: string) => { size: number };
    };
  },
): { pruned: number } {
  const fsApi = options?.fs ?? (require("node:fs") as typeof import("node:fs"));
  const path = options?.path || HANG_TRACE_JSONL_PATH;
  const now = typeof options?.now === "number" ? options.now : Date.now();
  const line = `${JSON.stringify({ ...row, at: row.at || new Date(now).toISOString() })}\n`;
  fsApi.appendFileSync(path, line);

  const maxBytes = options?.maxBytes ?? HANG_TRACE_JSONL_MAX_BYTES;
  let oversized = false;
  try {
    if (fsApi.existsSync(path) && fsApi.statSync(path).size > maxBytes) oversized = true;
  } catch {
    oversized = false;
  }
  const due =
    options?.forcePrune
    || oversized
    || hangTraceJsonlLastPruneAt <= 0
    || now - hangTraceJsonlLastPruneAt >= HANG_TRACE_JSONL_PRUNE_EVERY_MS;
  if (!due) return { pruned: 0 };
  hangTraceJsonlLastPruneAt = now;
  try {
    if (!fsApi.existsSync(path)) return { pruned: 0 };
    const content = fsApi.readFileSync(path, "utf8");
    const filtered = filterHangTraceJsonlLines(content, {
      now,
      retentionMs: options?.retentionMs,
    });
    if (filtered.removed > 0 || oversized) {
      // If still oversized after age prune, keep the newest half of kept lines.
      let next = filtered.kept;
      if (Buffer.byteLength(next, "utf8") > maxBytes) {
        const rows = next.trimEnd().split("\n").filter(Boolean);
        const keep = rows.slice(Math.floor(rows.length / 2));
        next = keep.length ? `${keep.join("\n")}\n` : "";
      }
      fsApi.writeFileSync(path, next);
    }
    return { pruned: filtered.removed };
  } catch {
    return { pruned: 0 };
  }
}

/** Test helper */
export function __resetHangTraceJsonlPruneForTest(): void {
  hangTraceJsonlLastPruneAt = 0;
}

export function applyHangTraceRequestHeaders(
  input: {
    agent?: string;
    sessionID?: string;
    message?: { id?: string };
    provider?: { id?: string };
    model?: { providerID?: string };
  },
  output: { headers: Record<string, string> },
): void {
  const sessionId = String(input.sessionID || "").trim();
  const providerId = String(input.provider?.id || input.model?.providerID || "").trim();
  const requestId = String(input.message?.id || "").trim();
  if (sessionId) {
    output.headers[WODEAPP_SESSION_ID_HEADER] = sessionId;
  }
  if (providerId === "wodeapp" && /^[A-Za-z0-9._:-]{1,128}$/.test(requestId)) {
    output.headers[WODEAPP_REQUEST_ID_HEADER] = requestId;
  }
  applyCompactionRequestKindHeader(input, output);
  try {
    appendHangTraceJsonl({
      tag: "chat.headers",
      sessionID: sessionId || null,
      agent: input.agent || null,
      headers: {
        [WODEAPP_SESSION_ID_HEADER]: output.headers[WODEAPP_SESSION_ID_HEADER] || null,
        [WODEAPP_REQUEST_ID_HEADER]: output.headers[WODEAPP_REQUEST_ID_HEADER] || null,
        [WODEAPP_REQUEST_KIND_HEADER]: output.headers[WODEAPP_REQUEST_KIND_HEADER] || null,
      },
    });
  } catch {
    // ignore local dump failures
  }
}

/**
 * Mutates message parts in place: remove PDF / non-image data / read-tool
 * attachments that would be forwarded into chat completions as image_url.
 */
export function stripUnsafeToolAttachmentsFromMessages(
  messages: Array<{ info?: unknown; parts?: unknown[] }>,
): { stripped: number } {
  let stripped = 0;
  for (const message of messages) {
    if (!Array.isArray(message.parts)) continue;
    for (const part of message.parts) {
      const record = asRecord(part);
      if (!record || record.type !== "tool") continue;
      const tool = typeof record.tool === "string" ? record.tool : "";
      const state = asRecord(record.state);
      if (!state) continue;
      const attachments = Array.isArray(state.attachments) ? state.attachments : [];
      if (!attachments.length) continue;
      const kept: unknown[] = [];
      let removed = 0;
      for (const attachment of attachments) {
        if (isUnsafeToolAttachment(attachment, tool)) {
          removed += 1;
          continue;
        }
        kept.push(attachment);
      }
      if (!removed) continue;
      stripped += removed;
      state.attachments = kept;
      const previous = typeof state.output === "string" ? state.output.trim() : "";
      const note = [
        STRIP_MARKER,
        `tool=${tool || "unknown"}`,
        `removed=${removed}`,
        "Binary/PDF (or OpenCode read media) attachments were removed before the model call.",
        "Use openwork_pdf_* / openwork_file_extract_text / openwork_media_view instead of read for media.",
      ].join("\n");
      if (!previous.includes(STRIP_MARKER)) {
        state.output = previous ? `${previous}\n\n${note}` : note;
      }
      const metadata = asRecord(state.metadata) ?? {};
      metadata.wodeappUnsafeAttachmentStripped = true;
      metadata.wodeappUnsafeAttachmentRemoved = removed;
      state.metadata = metadata;
    }
  }
  return { stripped };
}

export function readToolDefinitionSuffix(): string {
  return [
    "Never use this tool on PDF, PNG, JPEG, WebP, GIF, Office, audio, or video paths.",
    "PDF → openwork_pdf_info + openwork_pdf_extract_text (layout: openwork_pdf_render_pages attaches bounded previews).",
    "Images → openwork_media_view (bounded pixels; local path / https / image-proxy) or image_inspect (local dimensions only).",
    "Office → openwork_file_extract_text.",
    "Embedding binary via read poisons the next chat/completions turn (424 / upstream 400).",
  ].join(" ");
}

type DumpableMessage = { info?: unknown; parts?: unknown[] };

function summarizeMessagesForDump(messages: DumpableMessage[]) {
  const roleCounts: Record<string, number> = {};
  const partTypes: Record<string, number> = {};
  let chars = 0;
  let unsafeAttachments = 0;
  let dataUrls = 0;
  let compactionHints = 0;
  const tools: string[] = [];
  for (const message of messages) {
    const info = asRecord(message.info);
    const role = typeof info?.role === "string" ? info.role : "unknown";
    roleCounts[role] = (roleCounts[role] || 0) + 1;
    const mode = typeof info?.mode === "string" ? info.mode : "";
    const agent = typeof info?.agent === "string" ? info.agent : "";
    if (mode === "compaction" || agent === "compaction") compactionHints += 1;
    if (!Array.isArray(message.parts)) continue;
    for (const part of message.parts) {
      const record = asRecord(part);
      if (!record) continue;
      const type = typeof record.type === "string" ? record.type : "?";
      partTypes[type] = (partTypes[type] || 0) + 1;
      if (type === "text" && typeof record.text === "string") {
        chars += record.text.length;
        if (/compact|compress|summarize (the )?conversation|conversation so far/i.test(record.text)) {
          compactionHints += 1;
        }
      }
      if (type === "tool") {
        const tool = typeof record.tool === "string" ? record.tool : "";
        if (tool) tools.push(tool);
        const state = asRecord(record.state);
        if (typeof state?.output === "string") chars += state.output.length;
        const attachments = Array.isArray(state?.attachments) ? state.attachments : [];
        for (const attachment of attachments) {
          if (isUnsafeToolAttachment(attachment, tool)) unsafeAttachments += 1;
          const item = asRecord(attachment);
          const url = typeof item?.url === "string" ? item.url : "";
          if (url.startsWith("data:")) {
            dataUrls += 1;
            chars += url.length;
          }
        }
      }
      if (type === "file") {
        const url = typeof record.url === "string" ? record.url : "";
        if (url.startsWith("data:")) {
          dataUrls += 1;
          chars += url.length;
        }
      }
    }
  }
  return {
    messageCount: messages.length,
    roleCounts,
    partTypes,
    chars,
    estTokens: Math.floor(chars / 4),
    unsafeAttachments,
    dataUrls,
    compactionHints,
    toolSample: tools.slice(0, 40),
  };
}

/** Best-effort dump for empirical compaction/debug (never throws into chat path). */
export function dumpModelBoundMessages(messages: DumpableMessage[], tag = "messages.transform") {
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const summary = summarizeMessagesForDump(messages);
    const line = JSON.stringify({
      at: new Date().toISOString(),
      tag,
      pid: process.pid,
      summary,
    });
    fs.appendFileSync("/tmp/opencode-model-bound-dump.jsonl", `${line}\n`);
    // Full snapshot only when compaction-ish or very large — for exact replay.
    if (summary.compactionHints > 0 || summary.estTokens >= 40_000 || summary.unsafeAttachments > 0) {
      fs.writeFileSync(
        "/tmp/opencode-model-bound-latest.json",
        JSON.stringify({ at: new Date().toISOString(), tag, summary, messages }, null, 0),
      );
    }
  } catch {
    // ignore dump failures
  }
}

type ReadMediaGateOptions = {
  loadSessionMessages?: (
    sessionID: string,
  ) => Promise<Array<{ info?: unknown; parts?: unknown[] }>>;
  artifactRoot?: string;
};

/** Hooks to merge into the OpenWorkExtensionsPreview plugin return value. */
export function buildReadMediaGateHooks(options: ReadMediaGateOptions = {}) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: unknown },
    ) => {
      assertReadToolAllowsPath(input.tool, output.args);
    },
    "tool.definition": async (
      input: { toolID: string },
      output: { description: string; jsonSchema?: unknown },
    ) => {
      if (!READ_TOOL_NAMES.has(input.toolID.trim())) return;
      const suffix = readToolDefinitionSuffix();
      if (!output.description.includes("Never use this tool on PDF")) {
        output.description = `${output.description.trim()} ${suffix}`.trim();
      }
    },
    "chat.headers": async (
      input: {
        agent?: string;
        sessionID?: string;
        message?: { id?: string };
        provider?: { id?: string };
        model?: { providerID?: string };
      },
      output: { headers: Record<string, string> },
    ) => {
      if (!output.headers || typeof output.headers !== "object") {
        output.headers = {};
      }
      applyHangTraceRequestHeaders(input, output);
    },
    "experimental.chat.messages.transform": async (
      _input: unknown,
      output: { messages: Array<{ info?: unknown; parts?: unknown[] }> },
    ) => {
      dumpModelBoundMessages(output.messages);
      stripUnsafeToolAttachmentsFromMessages(output.messages);
      dumpModelBoundMessages(output.messages, "messages.transform.after-strip");
    },
    "experimental.session.compacting": async (
      input: { sessionID: string },
      output: { context: string[]; prompt?: string },
    ) => {
      let artifact:
        | Awaited<ReturnType<typeof writeSessionTranscriptArtifact>>
        | undefined;
      let artifactError = "";
      if (options.loadSessionMessages) {
        try {
          const messages = await options.loadSessionMessages(input.sessionID);
          artifact = await writeSessionTranscriptArtifact({
            sessionID: input.sessionID,
            messages,
            artifactRoot: options.artifactRoot,
          });
          const readback = buildContextReadbackPlan({
            artifactKind: "session transcript",
            path: artifact.path,
            queryHint: "the forgotten exact detail",
          });
          if (!Array.isArray(output.context)) output.context = [];
          output.context.push([
            "Recoverable history artifact (outside the compacted prompt):",
            `path=${JSON.stringify(artifact.path)} bytes=${artifact.bytes} lines=${artifact.lines} messages=${artifact.messageCount}`,
            readback.hint,
            "Preserve this exact path and bounded recovery rule in the summary under a `Recoverable history` heading.",
          ].join("\n"));
        } catch (error) {
          artifactError = error instanceof Error ? error.message : String(error);
        }
      } else {
        artifactError = "session message loader unavailable";
      }

      try {
        const fs = require("node:fs") as typeof import("node:fs");
        fs.appendFileSync(
          "/tmp/opencode-model-bound-dump.jsonl",
          `${JSON.stringify({
            at: new Date().toISOString(),
            tag: "session.compacting",
            sessionID: input.sessionID,
            contextCount: Array.isArray(output.context) ? output.context.length : 0,
            contextChars: Array.isArray(output.context)
              ? output.context.reduce((n, s) => n + String(s || "").length, 0)
              : 0,
            hasCustomPrompt: typeof output.prompt === "string" && output.prompt.length > 0,
            promptChars: typeof output.prompt === "string" ? output.prompt.length : 0,
            ...(artifact
              ? {
                  transcriptPath: artifact.path,
                  transcriptBytes: artifact.bytes,
                  transcriptLines: artifact.lines,
                  transcriptMessages: artifact.messageCount,
                }
              : {}),
            ...(artifactError ? { transcriptError: artifactError } : {}),
          })}\n`,
        );
      } catch {
        // ignore
      }
    },
  };
}
