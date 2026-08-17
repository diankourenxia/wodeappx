/**
 * First-turn multimodal context stays full for the model; after the session
 * goes idle we shrink history so later turns do not keep paying for it:
 * - vision-direct: keep chat thumbnails, but stop re-feeding pixels to the
 *   model. Rewrite ephemeral `data:image…` file parts to https when available;
 *   otherwise to synthetic attachment placeholders (UI restores cards). Never
 *   leave `file://` as type:file (AI SDK rejects that scheme) and never delete
 *   the attachment from the transcript.
 * - always scrub any leftover `file://` image file parts into placeholders
 * - attachment intelligence: rewrite long synthetic text to a short stub
 * - tool media: strip `state.attachments` data:image blobs (e.g. OpenCode `read`
 *   of screenshot PNGs / image_inspect previews) into path stubs
 * - web tools: after idle, stub older search/read/transcript dumps (keep a short
 *   recent tail) so multi-search chats do not retain every DuckDuckGo payload
 */

import {
  buildAttachmentIntelligenceHistoryStub,
  isAttachmentIntelligencePartText,
} from "./wodeapp-attachment-intelligence";
import { recordWodeAppContextHygieneEvent } from "./wodeapp-context-hygiene-metrics";

export type VisionHistoryCompactClient = {
  session: {
    status(params?: { directory?: string; workspace?: string }): Promise<{
      data?: unknown;
      error?: unknown;
    }>;
    messages(params: {
      sessionID: string;
      directory?: string;
      workspace?: string;
      limit?: number;
    }): Promise<{
      data?: unknown;
      error?: unknown;
    }>;
  };
  part: {
    // Method syntax keeps parameter checking bivariant so real OpenCode SDK
    // clients remain assignable under strictFunctionTypes.
    delete(params: {
      sessionID: string;
      messageID: string;
      partID: string;
      directory?: string;
      workspace?: string;
    }): Promise<{ data?: unknown; error?: unknown }>;
    update(params: {
      sessionID: string;
      messageID: string;
      partID: string;
      directory?: string;
      workspace?: string;
      part?: Record<string, unknown>;
    }): Promise<{ data?: unknown; error?: unknown }>;
  };
};

const DATA_IMAGE_URL_RE = /^data:image\//i;
const DATA_URL_RE = /^data:/i;
const DATA_APPLICATION_URL_RE = /^data:application\//i;
const DURABLE_DISPLAY_URL_RE = /^(https?:\/\/|file:\/\/|wodeappx-asset:)/i;
/** URLs the AI SDK can download when replaying history into the model. */
const MODEL_SAFE_MEDIA_URL_RE = /^(https?:\/\/|data:)/i;
const FILE_SCHEME_URL_RE = /^file:/i;
const TOOL_MEDIA_STUB_MARKER = "[WodeApp media stub]";
export const WEB_TOOL_STUB_MARKER = "[WodeApp web tool stub]";
/** Keep the newest N completed web-tool payloads intact; stub older ones. */
export const WEB_TOOL_KEEP_RECENT = 4;
/** Only stub outputs larger than this — tiny status payloads are left alone. */
export const WEB_TOOL_MIN_OUTPUT_CHARS = 800;
const WEB_TOOL_NAMES = new Set([
  "agent_reach_web_search",
  "agent_reach_web_read",
  "agent_reach_youtube_transcript",
  "agent_reach_rss_read",
  "agent_reach_bilibili_search",
  "webfetch",
  "web_fetch",
  "websearch",
  "web_search",
]);
/** Max wait for busy→idle before giving up on post-send compaction (not a delay before compact). */
export const DEFAULT_IDLE_TIMEOUT_MS = 3 * 60 * 1000;
const IDLE_POLL_MS = 1_000;
const IDLE_GRACE_MS = 1_000;
const IDLE_STABLE_POLLS = 2;

export function toLocalFileDisplayUrl(pathOrUrl: string): string | null {
  const value = pathOrUrl.trim();
  if (!value) return null;
  if (DURABLE_DISPLAY_URL_RE.test(value)) return value;
  const normalized = value.replace(/\\/g, "/");
  if (!normalized.startsWith("/") && !/^[A-Za-z]:\//.test(normalized)) return null;
  return `file://${normalized.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
}

export function buildVisionDisplayUrlMap(
  displayUrls: Array<{ filename: string; url: string }> | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const item of displayUrls || []) {
    const filename = item.filename.trim();
    if (!filename || map.has(filename)) continue;
    const raw = item.url.trim();
    const url = DURABLE_DISPLAY_URL_RE.test(raw) ? raw : toLocalFileDisplayUrl(raw);
    if (url) map.set(filename, url);
  }
  return map;
}

export function isModelSafeMediaUrl(url: string): boolean {
  return MODEL_SAFE_MEDIA_URL_RE.test(url.trim());
}

/**
 * File parts whose URL cannot be replayed by AI SDK on later turns (`file:`).
 * Images were the original poison; video/audio path parts must be stubbed too.
 */
export function isFileSchemeImageFilePart(
  part: unknown,
): part is {
  id: string;
  messageID?: string;
  sessionID?: string;
  type: "file";
  url: string;
  filename?: string;
  mime?: string;
} {
  return isFileSchemeUnsafeFilePart(part);
}

/** Any `file://` type:file part — AI SDK only accepts http/https/data on replay. */
export function isFileSchemeUnsafeFilePart(
  part: unknown,
): part is {
  id: string;
  messageID?: string;
  sessionID?: string;
  type: "file";
  url: string;
  filename?: string;
  mime?: string;
} {
  const record = asRecord(part);
  if (!record || record.type !== "file") return false;
  if (typeof record.id !== "string" || !record.id.trim()) return false;
  if (typeof record.url !== "string" || !FILE_SCHEME_URL_RE.test(record.url.trim())) return false;
  return true;
}

/**
 * URLs safe to keep on scrubbed attachment placeholders for chat thumbnails.
 * Spill dirs (`session-media` / legacy `session-artifacts`) file:// often 404 as
 * Electron img src — open via chip instead; never use as `<img src>`.
 */
export function isChatThumbnailDisplayUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (/^(https?:\/\/|blob:|wodeappx-asset:)/i.test(trimmed)) return true;
  if (/^data:image\//i.test(trimmed)) return true;
  if (/^file:\/\//i.test(trimmed)) {
    return !/[/\\]session-(?:media|artifacts)[/\\]/i.test(trimmed);
  }
  return false;
}

function pickChatThumbnailDisplayUrl(...candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (candidate && isChatThumbnailDisplayUrl(candidate)) return candidate.trim();
  }
  return undefined;
}

function attachmentPlaceholderKind(mime: string, filename: string): string {
  const normalized = mime.trim().toLowerCase();
  if (normalized.startsWith("video/") || /\.(mp4|mov|webm|mkv)$/i.test(filename)) return "video";
  if (normalized.startsWith("audio/") || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(filename)) return "audio";
  if (normalized === "application/pdf" || /\.pdf$/i.test(filename)) return "pdf";
  if (normalized.startsWith("image/")) return "image";
  return "file";
}

function buildVisionCompactAttachmentPlaceholder(input: {
  id: string;
  sessionID: string;
  messageID: string;
  filename: string;
  mime?: string;
  displayUrl?: string;
}): Record<string, unknown> {
  const filename = input.filename.trim() || "attachment";
  const mime = (input.mime && input.mime.trim()) || "application/octet-stream";
  const kind = attachmentPlaceholderKind(mime, filename);
  const displayUrl = input.displayUrl?.trim() || "";
  const reference = displayUrl
    ? `\n[WodeApp attachment reference: ${JSON.stringify({ url: displayUrl, kind })}]`
    : "";
  return {
    id: input.id,
    sessionID: input.sessionID,
    messageID: input.messageID,
    type: "text",
    text: `[WodeApp attachment: ${filename}]${reference}`,
    synthetic: true,
    metadata: {
      wodeappAttachmentPlaceholder: {
        filename,
        mime,
        kind,
        ...(displayUrl ? { url: displayUrl } : {}),
      },
    },
  };
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sessionStatusType(payload: unknown, sessionId: string): string | null {
  const root = asRecord(payload);
  if (!root) return null;
  const direct = asRecord(root[sessionId]);
  if (direct && typeof direct.type === "string") return direct.type;
  const data = asRecord(root.data);
  if (data) {
    const nested = asRecord(data[sessionId]);
    if (nested && typeof nested.type === "string") return nested.type;
  }
  return null;
}

export function isEphemeralVisionDataUrlFilePart(
  part: unknown,
  filenames?: Set<string>,
): part is { id: string; messageID?: string; type: "file"; url: string; filename?: string; mime?: string } {
  const record = asRecord(part);
  if (!record || record.type !== "file") return false;
  if (typeof record.id !== "string" || !record.id.trim()) return false;
  if (typeof record.url !== "string" || !DATA_IMAGE_URL_RE.test(record.url)) return false;
  const mime = typeof record.mime === "string" ? record.mime : "";
  if (mime && !mime.toLowerCase().startsWith("image/")) return false;
  if (filenames && filenames.size > 0) {
    const filename = typeof record.filename === "string" ? record.filename.trim() : "";
    if (!filename || !filenames.has(filename)) return false;
  }
  return true;
}

/** Non-image `data:` file parts (video/audio/pdf/binary) that must leave model history. */
export function isEphemeralNonImageDataUrlFilePart(
  part: unknown,
): part is { id: string; messageID?: string; type: "file"; url: string; filename?: string; mime?: string } {
  const record = asRecord(part);
  if (!record || record.type !== "file") return false;
  if (typeof record.id !== "string" || !record.id.trim()) return false;
  if (typeof record.url !== "string" || !DATA_URL_RE.test(record.url)) return false;
  if (DATA_IMAGE_URL_RE.test(record.url)) return false;
  const mime = typeof record.mime === "string" ? record.mime.trim().toLowerCase() : "";
  if (mime.startsWith("image/")) return false;
  return true;
}

export function isAttachmentIntelligenceTextPart(
  part: unknown,
): part is {
  id: string;
  messageID?: string;
  sessionID?: string;
  type: "text";
  text: string;
  synthetic?: boolean;
} {
  const record = asRecord(part);
  if (!record || record.type !== "text") return false;
  if (typeof record.id !== "string" || !record.id.trim()) return false;
  if (typeof record.text !== "string" || !record.text.trim()) return false;
  if (record.synthetic !== true && record.ignored !== true) return false;
  return isAttachmentIntelligencePartText(record.text);
}

function toolMediaPathHint(state: Record<string, unknown>): string {
  const input = asRecord(state.input);
  for (const key of ["path", "file", "filePath", "savePath"] as const) {
    const value = input?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  if (typeof state.title === "string" && state.title.trim()) return state.title.trim();
  return "";
}

function estimateDataUrlBytes(url: string): number {
  const comma = url.indexOf(",");
  if (comma < 0) return url.length;
  const payload = url.slice(comma + 1);
  return Math.max(0, Math.floor(payload.length * 0.75));
}

/** Inline tool attachment that must leave model history (images + PDF/binary data URLs). */
export function isEphemeralToolMediaAttachment(attachment: unknown): boolean {
  const item = asRecord(attachment);
  if (!item || typeof item.url !== "string") return false;
  const url = item.url.trim();
  if (!url) return false;
  if (DATA_IMAGE_URL_RE.test(url)) return true;
  if (DATA_APPLICATION_URL_RE.test(url)) return true;
  if (DATA_URL_RE.test(url) && !DATA_IMAGE_URL_RE.test(url)) return true;
  const mime = typeof item.mime === "string" ? item.mime.trim().toLowerCase() : "";
  if (mime === "application/pdf" || mime.startsWith("application/")) return true;
  return false;
}

/**
 * Tool parts that still carry inline image pixels (OpenCode `read` on PNGs,
 * image_inspect previews, optional Computer Use includeImage payloads).
 * Also catches PDF/binary data URLs from generic `read` before they explode context.
 */
export function isToolPartWithEphemeralMediaAttachments(
  part: unknown,
): part is {
  id: string;
  messageID?: string;
  sessionID?: string;
  type: "tool";
  callID: string;
  tool: string;
  state: Record<string, unknown>;
  metadata?: Record<string, unknown>;
} {
  const record = asRecord(part);
  if (!record || record.type !== "tool") return false;
  if (typeof record.id !== "string" || !record.id.trim()) return false;
  if (typeof record.callID !== "string" || !record.callID.trim()) return false;
  if (typeof record.tool !== "string" || !record.tool.trim()) return false;
  const state = asRecord(record.state);
  if (!state || state.status !== "completed") return false;
  if (asRecord(state.metadata)?.wodeappMediaStubbed === true) return false;
  const attachments = Array.isArray(state.attachments) ? state.attachments : [];
  return attachments.some((attachment) => isEphemeralToolMediaAttachment(attachment));
}

/**
 * Replace inline tool image attachments with a recoverable path stub.
 * Keeps tool/call identity so the transcript stays coherent.
 */
export function buildToolMediaAttachmentStub(
  part: {
    id: string;
    messageID?: string;
    sessionID?: string;
    type: "tool";
    callID: string;
    tool: string;
    state: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
  sessionId: string,
  fallbackMessageId: string,
): Record<string, unknown> | null {
  const state = asRecord(part.state);
  if (!state) return null;
  const attachments = Array.isArray(state.attachments) ? state.attachments : [];
  const mediaAttachments = attachments.filter((attachment) => isEphemeralToolMediaAttachment(attachment));
  if (!mediaAttachments.length) return null;

  const pathHint = toolMediaPathHint(state);
  const totalBytes = mediaAttachments.reduce((sum, attachment) => {
    const item = asRecord(attachment);
    const url = typeof item?.url === "string" ? item.url : "";
    return sum + estimateDataUrlBytes(url);
  }, 0);
  const mime = mediaAttachments
    .map((attachment) => {
      const item = asRecord(attachment);
      return typeof item?.mime === "string" ? item.mime : "";
    })
    .find(Boolean) || "application/octet-stream";
  const isPdfOrBinary = !/^image\//i.test(mime) && !mediaAttachments.every((attachment) => {
    const item = asRecord(attachment);
    return typeof item?.url === "string" && DATA_IMAGE_URL_RE.test(item.url);
  });

  const previousOutput = typeof state.output === "string" ? state.output.trim() : "";
  const stubLines = [
    TOOL_MEDIA_STUB_MARKER,
    `tool=${part.tool}`,
    pathHint ? `path=${pathHint}` : "path=(unknown)",
    `mime=${mime}`,
    `approxBytes=${totalBytes}`,
    `images=${mediaAttachments.length}`,
    "Pixels/binary were removed from history after the active turn to prevent context explosion.",
    isPdfOrBinary
      ? "Do not re-open PDF/binary via OpenCode read. Prefer openwork_pdf_info + openwork_pdf_extract_text, or openwork_file_extract_text."
      : "Do not re-open this image for ordinary follow-ups (引用/写脚本/存商品/生图参数). Prefer prior text summary, @商品 HTTPS URLs, or selectedImageIds.",
    pathHint
      ? (isPdfOrBinary
        ? `Only if the user explicitly asks to re-check the file: use openwork_pdf_* / openwork_file_extract_text on path=${pathHint}. Never call OpenCode read on PDF/binary paths.`
        : `Pixels were shown earlier this session; prefer the path stub. Absolute path=${pathHint} (bounded current-turn preview). Never call OpenCode read on image/screenshot paths.`)
      : (isPdfOrBinary
        ? "Only if the user explicitly asks and an absolute local path is known: openwork_pdf_* / openwork_file_extract_text. Never call OpenCode read on PDF/binary paths."
        : "Prefer path stubs / HTTPS / selectedImageIds. Never call OpenCode read on image/screenshot paths."),
  ];
  const stubOutput = stubLines.join("\n");
  const nextOutput = previousOutput.includes(TOOL_MEDIA_STUB_MARKER)
    ? previousOutput
    : previousOutput
      ? `${previousOutput}\n\n${stubOutput}`
      : stubOutput;

  const time = asRecord(state.time) ?? {};
  const metadata = {
    ...(asRecord(state.metadata) ?? {}),
    wodeappMediaStubbed: true,
    wodeappMediaPath: pathHint || undefined,
    wodeappMediaApproxBytes: totalBytes,
    wodeappMediaCount: mediaAttachments.length,
  };

  const messageID = typeof part.messageID === "string" && part.messageID.trim()
    ? part.messageID
    : fallbackMessageId;
  const sessionID = typeof part.sessionID === "string" && part.sessionID.trim()
    ? part.sessionID
    : sessionId;

  return {
    id: part.id,
    sessionID,
    messageID,
    type: "tool",
    callID: part.callID,
    tool: part.tool,
    ...(part.metadata ? { metadata: part.metadata } : {}),
    state: {
      ...state,
      output: nextOutput,
      attachments: [],
      metadata,
      time: {
        ...time,
        compacted: typeof time.compacted === "number" ? time.compacted : Date.now(),
      },
    },
  };
}

export function isWebDiscoveryToolName(tool: string): boolean {
  return WEB_TOOL_NAMES.has(tool.trim());
}

export function isWebToolPartForHistoryStub(
  part: unknown,
): part is {
  id: string;
  messageID?: string;
  sessionID?: string;
  type: "tool";
  callID: string;
  tool: string;
  state: Record<string, unknown>;
  metadata?: Record<string, unknown>;
} {
  const record = asRecord(part);
  if (!record || record.type !== "tool") return false;
  if (typeof record.id !== "string" || !record.id.trim()) return false;
  if (typeof record.callID !== "string" || !record.callID.trim()) return false;
  if (typeof record.tool !== "string" || !isWebDiscoveryToolName(record.tool)) return false;
  const state = asRecord(record.state);
  if (!state || state.status !== "completed") return false;
  if (asRecord(state.metadata)?.wodeappWebStubbed === true) return false;
  const output = typeof state.output === "string" ? state.output : "";
  if (output.includes(WEB_TOOL_STUB_MARKER)) return false;
  return output.length >= WEB_TOOL_MIN_OUTPUT_CHARS;
}

/**
 * Replace a completed web-search/read tool payload with a recoverable stub.
 * Keeps query/url/resultCount when present so the model knows what was done.
 */
export function buildWebToolOutputStub(
  part: {
    id: string;
    messageID?: string;
    sessionID?: string;
    type: "tool";
    callID: string;
    tool: string;
    state: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
  sessionId: string,
  fallbackMessageId: string,
): Record<string, unknown> | null {
  const state = asRecord(part.state);
  if (!state) return null;
  const previousOutput = typeof state.output === "string" ? state.output : "";
  if (previousOutput.length < WEB_TOOL_MIN_OUTPUT_CHARS) return null;

  let parsed: Record<string, unknown> | null = null;
  try {
    const value = JSON.parse(previousOutput) as unknown;
    parsed = asRecord(value);
  } catch {
    parsed = null;
  }

  const query = typeof parsed?.query === "string" ? parsed.query : undefined;
  const url = typeof parsed?.url === "string" ? parsed.url : undefined;
  const resultCount = typeof parsed?.resultCount === "number" ? parsed.resultCount : undefined;
  const spillPath = typeof parsed?.spillPath === "string" ? parsed.spillPath : undefined;
  const retainedResults: Array<{ title?: string; url: string; snippet?: string }> = [];
  const rawResults = Array.isArray(parsed?.results) ? parsed.results : [];
  for (const value of rawResults.slice(0, 8)) {
    const result = asRecord(value);
    const resultUrl = typeof result?.url === "string" ? result.url.trim() : "";
    if (!resultUrl) continue;
    retainedResults.push({
      ...(typeof result?.title === "string" ? { title: result.title.slice(0, 180) } : {}),
      url: resultUrl,
      ...(typeof result?.snippet === "string" ? { snippet: result.snippet.slice(0, 240) } : {}),
    });
  }
  const input = asRecord(state.input);
  const inputQuery = typeof input?.query === "string" ? input.query : undefined;
  const inputUrl = typeof input?.url === "string" ? input.url : undefined;

  const stubPayload = {
    ok: true,
    stubbed: true,
    marker: WEB_TOOL_STUB_MARKER,
    tool: part.tool,
    query: query || inputQuery || undefined,
    url: url || inputUrl || undefined,
    resultCount,
    ...(retainedResults.length ? { results: retainedResults } : {}),
    spillPath,
    originalChars: previousOutput.length,
    note: spillPath
      ? "Full web tool output was removed after idle; use spillPath to recover details."
      : "Full web tool output was compacted after idle; source titles, URLs and short snippets were retained. Re-run the same tool for more detail.",
  };

  const time = asRecord(state.time) ?? {};
  const metadata = {
    ...(asRecord(state.metadata) ?? {}),
    wodeappWebStubbed: true,
    wodeappWebOriginalChars: previousOutput.length,
  };

  const messageID = typeof part.messageID === "string" && part.messageID.trim()
    ? part.messageID
    : fallbackMessageId;
  const sessionID = typeof part.sessionID === "string" && part.sessionID.trim()
    ? part.sessionID
    : sessionId;

  return {
    id: part.id,
    sessionID,
    messageID,
    type: "tool",
    callID: part.callID,
    tool: part.tool,
    ...(part.metadata ? { metadata: part.metadata } : {}),
    state: {
      ...state,
      output: JSON.stringify(stubPayload),
      metadata,
      time: {
        ...time,
        compacted: typeof time.compacted === "number" ? time.compacted : Date.now(),
      },
    },
  };
}

export async function waitForSessionIdle(
  client: VisionHistoryCompactClient,
  sessionId: string,
  options: {
    directory?: string;
    timeoutMs?: number;
    /** Test hook: skip the post-busy grace window. */
    graceMs?: number;
    pollMs?: number;
    /**
     * Legacy/test escape hatch. Production compaction must observe busy→idle;
     * an already-idle recovery sweep is handled separately.
     */
    allowStableIdleFallback?: boolean;
  } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  const graceMs = options.graceMs ?? IDLE_GRACE_MS;
  const pollMs = options.pollMs ?? IDLE_POLL_MS;
  const started = Date.now();
  let sawBusy = false;
  let idleStreak = 0;

  while (Date.now() - started < timeoutMs) {
    try {
      const result = await client.session.status(
        options.directory ? { directory: options.directory } : undefined,
      );
      if (result.error) {
        idleStreak = 0;
        await sleep(pollMs);
        continue;
      }
      const type = sessionStatusType(result.data, sessionId) ?? "idle";
      if (type === "busy" || type === "retry") {
        sawBusy = true;
        idleStreak = 0;
      } else if (type === "idle" || type === "completed") {
        idleStreak += 1;
        // Normal post-send cleanup must observe busy→idle. Otherwise an early
        // "idle" snapshot can race the prompt start and delete first-turn data.
        if (sawBusy && idleStreak >= IDLE_STABLE_POLLS) {
          if (graceMs > 0) await sleep(graceMs);
          return true;
        }
        if (
          options.allowStableIdleFallback
          && !sawBusy
          && Date.now() - started >= graceMs
          && idleStreak >= IDLE_STABLE_POLLS
        ) {
          return true;
        }
      } else {
        idleStreak = 0;
      }
    } catch {
      idleStreak = 0;
      // Keep polling; sidecar may briefly reject while streaming.
    }
    await sleep(pollMs);
  }
  return false;
}

function messageEntries(payload: unknown): Array<{ messageID: string; parts: unknown[] }> {
  const root = asRecord(payload);
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.data)
      ? root.data
      : Array.isArray(root?.messages)
        ? root.messages
        : [];

  const entries: Array<{ messageID: string; parts: unknown[] }> = [];
  for (const item of list) {
    const record = asRecord(item);
    if (!record) continue;
    const info = asRecord(record.info) ?? asRecord(record.message) ?? record;
    const messageID = typeof info.id === "string"
      ? info.id
      : typeof record.id === "string"
        ? record.id
        : "";
    if (!messageID) continue;
    const parts = Array.isArray(record.parts)
      ? record.parts
      : Array.isArray(info.parts)
        ? info.parts
        : [];
    entries.push({ messageID, parts });
  }
  return entries;
}

async function loadRecentMessageEntries(
  client: VisionHistoryCompactClient,
  sessionId: string,
  directory?: string,
  limit = 80,
): Promise<Array<{ messageID: string; parts: unknown[] }> | null> {
  const messagesResult = await client.session.messages({
    sessionID: sessionId,
    directory,
    limit,
  });
  if (messagesResult.error) return null;
  return messageEntries(messagesResult.data);
}

/**
 * After the agent loop finishes, stop re-feeding vision pixels into later model
 * turns without deleting the attachment from the transcript:
 * - https → keep type:file (cheap, model-safe)
 * - otherwise → synthetic text placeholder (UI restores the card; model only
 *   sees a short stub — OpenCode does not honor `ignored` on file parts)
 * - leftover `file://` type:file → same placeholder scrub (prevents AI_DownloadError)
 */
export async function compactEphemeralVisionFilePartsAfterIdle(input: {
  client: VisionHistoryCompactClient;
  sessionId: string;
  directory?: string;
  filenames?: string[];
  /** Prefer https; file:// is UI-only via text placeholders. */
  displayUrls?: Array<{ filename: string; url: string }>;
  /** Default true: heal sessions already poisoned with file:// media parts. */
  scrubFileSchemeImages?: boolean;
  timeoutMs?: number;
  graceMs?: number;
  pollMs?: number;
  /** When true, caller already waited for idle (e.g. combined compaction). */
  alreadyIdle?: boolean;
}): Promise<{ deleted: number; rewritten: number; scrubbed: number; idle: boolean }> {
  const filenames = new Set((input.filenames || []).map((name) => name.trim()).filter(Boolean));
  const scrubFileScheme = input.scrubFileSchemeImages !== false;
  if (!filenames.size && !scrubFileScheme) {
    return { deleted: 0, rewritten: 0, scrubbed: 0, idle: true };
  }

  const idle = input.alreadyIdle
    ? true
    : await waitForSessionIdle(input.client, input.sessionId, {
      directory: input.directory,
      timeoutMs: input.timeoutMs,
      graceMs: input.graceMs,
      pollMs: input.pollMs,
    });
  if (!idle) return { deleted: 0, rewritten: 0, scrubbed: 0, idle: false };

  const entries = await loadRecentMessageEntries(input.client, input.sessionId, input.directory);
  if (!entries) return { deleted: 0, rewritten: 0, scrubbed: 0, idle: true };

  const urlByFilename = buildVisionDisplayUrlMap(input.displayUrls);
  let rewritten = 0;
  let scrubbed = 0;

  for (const entry of entries) {
    for (const part of entry.parts) {
      const partID = typeof (part as { id?: unknown }).id === "string"
        ? (part as { id: string }).id
        : "";
      if (!partID) continue;
      const messageID = typeof (part as { messageID?: unknown }).messageID === "string"
        && (part as { messageID: string }).messageID.trim()
        ? (part as { messageID: string }).messageID.trim()
        : entry.messageID;

      // Heal file:// media parts — model download rejects that scheme.
      if (scrubFileScheme && isFileSchemeUnsafeFilePart(part)) {
        const filename = typeof part.filename === "string" && part.filename.trim()
          ? part.filename.trim()
          : "attachment";
        const mime = typeof part.mime === "string" && part.mime.trim()
          ? part.mime.trim()
          : "application/octet-stream";
        const displayUrl = pickChatThumbnailDisplayUrl(
          filename ? urlByFilename.get(filename) : undefined,
          part.url,
        );
        try {
          const result = await input.client.part.update({
            sessionID: input.sessionId,
            messageID,
            partID,
            directory: input.directory,
            part: buildVisionCompactAttachmentPlaceholder({
              id: partID,
              sessionID: input.sessionId,
              messageID,
              filename,
              mime,
              displayUrl,
            }),
          });
          if (!result.error) scrubbed += 1;
        } catch {
          // Best-effort compaction; never fail the user send path.
        }
        continue;
      }

      // Heal poisoned data:video / data:audio / other non-image data: file parts.
      if (isEphemeralNonImageDataUrlFilePart(part)) {
        const filename = typeof part.filename === "string" && part.filename.trim()
          ? part.filename.trim()
          : "attachment";
        const mime = typeof part.mime === "string" && part.mime.trim()
          ? part.mime.trim()
          : "application/octet-stream";
        const displayUrl = filename ? urlByFilename.get(filename) : undefined;
        try {
          const result = await input.client.part.update({
            sessionID: input.sessionId,
            messageID,
            partID,
            directory: input.directory,
            part: buildVisionCompactAttachmentPlaceholder({
              id: partID,
              sessionID: input.sessionId,
              messageID,
              filename,
              mime,
              displayUrl,
            }),
          });
          if (!result.error) scrubbed += 1;
        } catch {
          // Best-effort compaction; never fail the user send path.
        }
        continue;
      }

      if (!filenames.size || !isEphemeralVisionDataUrlFilePart(part, filenames)) continue;

      const filename = typeof part.filename === "string" ? part.filename.trim() : "";
      const mime = typeof part.mime === "string" && part.mime.trim()
        ? part.mime.trim()
        : "image/jpeg";
      const nextUrl = filename ? urlByFilename.get(filename) : undefined;

      try {
        if (nextUrl && isModelSafeMediaUrl(nextUrl)) {
          const result = await input.client.part.update({
            sessionID: input.sessionId,
            messageID,
            partID,
            directory: input.directory,
            part: {
              id: partID,
              sessionID: input.sessionId,
              messageID,
              type: "file",
              mime,
              filename: filename || part.filename,
              url: nextUrl,
            },
          });
          if (!result.error) rewritten += 1;
          continue;
        }

        // Keep the attachment in the transcript as a UI card; do not re-feed
        // base64 / file:// pixels into later model turns.
        const result = await input.client.part.update({
          sessionID: input.sessionId,
          messageID,
          partID,
          directory: input.directory,
          part: buildVisionCompactAttachmentPlaceholder({
            id: partID,
            sessionID: input.sessionId,
            messageID,
            filename: filename || "image",
            mime,
            displayUrl: nextUrl,
          }),
        });
        if (!result.error) rewritten += 1;
      } catch {
        // Best-effort compaction; never fail the user send path.
      }
    }
  }
  // Hygiene metrics still use deletedVision for "pixels compacted out of model".
  return { deleted: rewritten + scrubbed, rewritten, scrubbed, idle: true };
}

/**
 * After idle, rewrite long attachment-intelligence synthetic parts to short stubs
 * so later turns keep sources / productImages / contextPackId without the full parse.
 */
export async function compactAttachmentIntelligencePartsAfterIdle(input: {
  client: VisionHistoryCompactClient;
  sessionId: string;
  directory?: string;
  timeoutMs?: number;
  graceMs?: number;
  pollMs?: number;
  alreadyIdle?: boolean;
}): Promise<{ stubbed: number; idle: boolean }> {
  const idle = input.alreadyIdle
    ? true
    : await waitForSessionIdle(input.client, input.sessionId, {
      directory: input.directory,
      timeoutMs: input.timeoutMs,
      graceMs: input.graceMs,
      pollMs: input.pollMs,
    });
  if (!idle) return { stubbed: 0, idle: false };

  const entries = await loadRecentMessageEntries(input.client, input.sessionId, input.directory);
  if (!entries) return { stubbed: 0, idle: true };

  let stubbed = 0;
  for (const entry of entries) {
    for (const part of entry.parts) {
      if (!isAttachmentIntelligenceTextPart(part)) continue;
      const stub = buildAttachmentIntelligenceHistoryStub(part.text);
      if (!stub || stub === part.text) continue;
      const partID = part.id;
      const messageID = typeof part.messageID === "string" && part.messageID.trim()
        ? part.messageID
        : entry.messageID;
      try {
        const result = await input.client.part.update({
          sessionID: input.sessionId,
          messageID,
          partID,
          directory: input.directory,
          part: {
            id: partID,
            sessionID: input.sessionId,
            messageID,
            type: "text",
            text: stub,
            synthetic: true,
          },
        });
        if (!result.error) stubbed += 1;
      } catch {
        // Best-effort compaction; never fail the user send path.
      }
    }
  }
  return { stubbed, idle: true };
}

/**
 * After idle, strip inline tool image attachments (screenshot / pdf_render previews, etc.).
 */
export async function compactToolMediaAttachmentsAfterIdle(input: {
  client: VisionHistoryCompactClient;
  sessionId: string;
  directory?: string;
  timeoutMs?: number;
  graceMs?: number;
  pollMs?: number;
  alreadyIdle?: boolean;
  limit?: number;
}): Promise<{ stubbed: number; idle: boolean }> {
  const idle = input.alreadyIdle
    ? true
    : await waitForSessionIdle(input.client, input.sessionId, {
      directory: input.directory,
      timeoutMs: input.timeoutMs,
      graceMs: input.graceMs,
      pollMs: input.pollMs,
    });
  if (!idle) return { stubbed: 0, idle: false };

  const entries = await loadRecentMessageEntries(
    input.client,
    input.sessionId,
    input.directory,
    Math.max(80, Math.min(400, input.limit ?? 200)),
  );
  if (!entries) return { stubbed: 0, idle: true };

  let stubbed = 0;
  for (const entry of entries) {
    for (const part of entry.parts) {
      if (!isToolPartWithEphemeralMediaAttachments(part)) continue;
      const next = buildToolMediaAttachmentStub(part, input.sessionId, entry.messageID);
      if (!next) continue;
      const messageID = typeof next.messageID === "string" && next.messageID.trim()
        ? next.messageID
        : entry.messageID;
      try {
        const result = await input.client.part.update({
          sessionID: input.sessionId,
          messageID,
          partID: part.id,
          directory: input.directory,
          part: next,
        });
        if (!result.error) stubbed += 1;
      } catch {
        // Best-effort compaction; never fail the user send path.
      }
    }
  }
  return { stubbed, idle: true };
}

/**
 * After idle, stub older web-search/read/transcript tool outputs.
 * Keeps the newest WEB_TOOL_KEEP_RECENT payloads so the active turn stays coherent.
 */
export async function compactWebToolOutputsAfterIdle(input: {
  client: VisionHistoryCompactClient;
  sessionId: string;
  directory?: string;
  timeoutMs?: number;
  graceMs?: number;
  pollMs?: number;
  alreadyIdle?: boolean;
  limit?: number;
  keepRecent?: number;
}): Promise<{ stubbed: number; idle: boolean }> {
  const idle = input.alreadyIdle
    ? true
    : await waitForSessionIdle(input.client, input.sessionId, {
      directory: input.directory,
      timeoutMs: input.timeoutMs,
      graceMs: input.graceMs,
      pollMs: input.pollMs,
    });
  if (!idle) return { stubbed: 0, idle: false };

  const entries = await loadRecentMessageEntries(
    input.client,
    input.sessionId,
    input.directory,
    Math.max(80, Math.min(400, input.limit ?? 200)),
  );
  if (!entries) return { stubbed: 0, idle: true };

  const keepRecent = Math.max(0, input.keepRecent ?? WEB_TOOL_KEEP_RECENT);
  const candidates: Array<{
    entryMessageID: string;
    part: {
      id: string;
      messageID?: string;
      sessionID?: string;
      type: "tool";
      callID: string;
      tool: string;
      state: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    };
  }> = [];
  for (const entry of entries) {
    for (const part of entry.parts) {
      if (!isWebToolPartForHistoryStub(part)) continue;
      candidates.push({ entryMessageID: entry.messageID, part });
    }
  }
  // Newest last in message order → reverse so newest are first, then skip keepRecent.
  const toStub = candidates.slice().reverse().slice(keepRecent);

  let stubbed = 0;
  for (const item of toStub) {
    const next = buildWebToolOutputStub(item.part, input.sessionId, item.entryMessageID);
    if (!next) continue;
    const messageID = typeof next.messageID === "string" && next.messageID.trim()
      ? next.messageID
      : item.entryMessageID;
    try {
      const result = await input.client.part.update({
        sessionID: input.sessionId,
        messageID,
        partID: item.part.id,
        directory: input.directory,
        part: next,
      });
      if (!result.error) stubbed += 1;
    } catch {
      // Best-effort compaction; never fail the user send path.
    }
  }
  return { stubbed, idle: true };
}

/**
 * Combined idle compaction for vision pixels + attachment-intelligence text + tool media.
 * Waits for idle once, then applies whichever cleanups were requested.
 */
export async function compactSessionHistoryAfterIdle(input: {
  client: VisionHistoryCompactClient;
  sessionId: string;
  directory?: string;
  visionFilenames?: string[];
  visionDisplayUrls?: Array<{ filename: string; url: string }>;
  compactAttachmentIntelligence?: boolean;
  /** Default true: always strip tool-embedded screenshot/image pixels after idle. */
  compactToolMedia?: boolean;
  /** Default true: stub older web search/read dumps after idle. */
  compactWebTools?: boolean;
  timeoutMs?: number;
  graceMs?: number;
  pollMs?: number;
}): Promise<{
  idle: boolean;
  deletedVision: number;
  stubbedAttachment: number;
  stubbedToolMedia: number;
  stubbedWebTools: number;
}> {
  const visionFilenames = (input.visionFilenames ?? []).map((name) => name.trim()).filter(Boolean);
  const needsVision = true; // always scrub leftover file:// image parts
  const needsAttachment = Boolean(input.compactAttachmentIntelligence);
  const needsToolMedia = input.compactToolMedia !== false;
  const needsWebTools = input.compactWebTools !== false;
  if (!needsVision && !needsAttachment && !needsToolMedia && !needsWebTools) {
    return { idle: true, deletedVision: 0, stubbedAttachment: 0, stubbedToolMedia: 0, stubbedWebTools: 0 };
  }

  const idle = await waitForSessionIdle(input.client, input.sessionId, {
    directory: input.directory,
    timeoutMs: input.timeoutMs,
    graceMs: input.graceMs,
    pollMs: input.pollMs,
  });
  if (!idle) {
    return { idle: false, deletedVision: 0, stubbedAttachment: 0, stubbedToolMedia: 0, stubbedWebTools: 0 };
  }

  let deletedVision = 0;
  let stubbedAttachment = 0;
  let stubbedToolMedia = 0;
  let stubbedWebTools = 0;
  if (needsVision) {
    const vision = await compactEphemeralVisionFilePartsAfterIdle({
      client: input.client,
      sessionId: input.sessionId,
      directory: input.directory,
      filenames: visionFilenames,
      displayUrls: input.visionDisplayUrls,
      scrubFileSchemeImages: true,
      alreadyIdle: true,
    });
    deletedVision = vision.deleted;
  }
  if (needsAttachment) {
    const attachment = await compactAttachmentIntelligencePartsAfterIdle({
      client: input.client,
      sessionId: input.sessionId,
      directory: input.directory,
      alreadyIdle: true,
    });
    stubbedAttachment = attachment.stubbed;
  }
  if (needsToolMedia) {
    const toolMedia = await compactToolMediaAttachmentsAfterIdle({
      client: input.client,
      sessionId: input.sessionId,
      directory: input.directory,
      alreadyIdle: true,
    });
    stubbedToolMedia = toolMedia.stubbed;
  }
  if (needsWebTools) {
    const webTools = await compactWebToolOutputsAfterIdle({
      client: input.client,
      sessionId: input.sessionId,
      directory: input.directory,
      alreadyIdle: true,
    });
    stubbedWebTools = webTools.stubbed;
  }
  return { idle: true, deletedVision, stubbedAttachment, stubbedToolMedia, stubbedWebTools };
}

/**
 * Recovery for interrupted attachment-intelligence stubbing, tool media blobs,
 * and leftover `file://` image parts that would crash the next model turn.
 * Do not delete vision `data:image` pixels here — that left the chat UI with
 * bare filenames / revoked blob tiles (broken images) while the model brief
 * still looked fine.
 */
export async function sweepRecoverableSessionHistory(input: {
  client: VisionHistoryCompactClient;
  sessionId: string;
  directory?: string;
  limit?: number;
}): Promise<{
  idle: boolean;
  deletedVision: number;
  stubbedAttachment: number;
  stubbedToolMedia: number;
  stubbedWebTools: number;
}> {
  let statusType: string;
  try {
    const status = await input.client.session.status(
      input.directory ? { directory: input.directory } : undefined,
    );
    if (status.error) {
      return { idle: false, deletedVision: 0, stubbedAttachment: 0, stubbedToolMedia: 0, stubbedWebTools: 0 };
    }
    statusType = sessionStatusType(status.data, input.sessionId) ?? "idle";
  } catch {
    return { idle: false, deletedVision: 0, stubbedAttachment: 0, stubbedToolMedia: 0, stubbedWebTools: 0 };
  }
  if (statusType !== "idle" && statusType !== "completed") {
    return { idle: false, deletedVision: 0, stubbedAttachment: 0, stubbedToolMedia: 0, stubbedWebTools: 0 };
  }

  const entries = await loadRecentMessageEntries(
    input.client,
    input.sessionId,
    input.directory,
    Math.max(80, Math.min(400, input.limit ?? 400)),
  );
  if (!entries) {
    return { idle: true, deletedVision: 0, stubbedAttachment: 0, stubbedToolMedia: 0, stubbedWebTools: 0 };
  }

  let stubbedAttachment = 0;
  let stubbedToolMedia = 0;
  let deletedVision = 0;
  const webCandidates: Array<{
    entryMessageID: string;
    part: {
      id: string;
      messageID?: string;
      sessionID?: string;
      type: "tool";
      callID: string;
      tool: string;
      state: Record<string, unknown>;
      metadata?: Record<string, unknown>;
    };
  }> = [];
  for (const entry of entries) {
    for (const part of entry.parts) {
      // Heal file:// / non-image data: parts that would crash or bloat later turns.
      if (isFileSchemeUnsafeFilePart(part) || isEphemeralNonImageDataUrlFilePart(part)) {
        const messageID = typeof part.messageID === "string" && part.messageID.trim()
          ? part.messageID.trim()
          : entry.messageID;
        const filename = typeof part.filename === "string" && part.filename.trim()
          ? part.filename.trim()
          : "attachment";
        const mime = typeof part.mime === "string" && part.mime.trim()
          ? part.mime.trim()
          : "application/octet-stream";
        try {
          const result = await input.client.part.update({
            sessionID: input.sessionId,
            messageID,
            partID: part.id,
            directory: input.directory,
            part: buildVisionCompactAttachmentPlaceholder({
              id: part.id,
              sessionID: input.sessionId,
              messageID,
              filename,
              mime,
              displayUrl: typeof part.url === "string" && /^file:/i.test(part.url) ? part.url : undefined,
            }),
          });
          if (!result.error) deletedVision += 1;
        } catch {
          // Recover on a future sweep.
        }
        continue;
      }

      if (isAttachmentIntelligenceTextPart(part)) {
        const stub = buildAttachmentIntelligenceHistoryStub(part.text);
        if (!stub || stub === part.text) continue;
        const messageID = typeof part.messageID === "string" && part.messageID.trim()
          ? part.messageID
          : entry.messageID;
        try {
          const result = await input.client.part.update({
            sessionID: input.sessionId,
            messageID,
            partID: part.id,
            directory: input.directory,
            part: {
              id: part.id,
              sessionID: input.sessionId,
              messageID,
              type: "text",
              text: stub,
              synthetic: true,
            },
          });
          if (!result.error) stubbedAttachment += 1;
        } catch {
          // Recover on a future sweep.
        }
        continue;
      }

      if (isWebToolPartForHistoryStub(part)) {
        webCandidates.push({ entryMessageID: entry.messageID, part });
        continue;
      }

      if (!isToolPartWithEphemeralMediaAttachments(part)) continue;
      const next = buildToolMediaAttachmentStub(part, input.sessionId, entry.messageID);
      if (!next) continue;
      const messageID = typeof next.messageID === "string" && next.messageID.trim()
        ? next.messageID
        : entry.messageID;
      try {
        const result = await input.client.part.update({
          sessionID: input.sessionId,
          messageID,
          partID: part.id,
          directory: input.directory,
          part: next,
        });
        if (!result.error) stubbedToolMedia += 1;
      } catch {
        // Recover on a future sweep.
      }
    }
  }

  let stubbedWebTools = 0;
  const toStub = webCandidates.slice().reverse().slice(WEB_TOOL_KEEP_RECENT);
  for (const item of toStub) {
    const next = buildWebToolOutputStub(item.part, input.sessionId, item.entryMessageID);
    if (!next) continue;
    const messageID = typeof next.messageID === "string" && next.messageID.trim()
      ? next.messageID
      : item.entryMessageID;
    try {
      const result = await input.client.part.update({
        sessionID: input.sessionId,
        messageID,
        partID: item.part.id,
        directory: input.directory,
        part: next,
      });
      if (!result.error) stubbedWebTools += 1;
    } catch {
      // Recover on a future sweep.
    }
  }
  return { idle: true, deletedVision, stubbedAttachment, stubbedToolMedia, stubbedWebTools };
}

export function scheduleEphemeralVisionHistoryCompaction(input: {
  client: VisionHistoryCompactClient;
  sessionId: string;
  directory?: string;
  filenames: string[];
  displayUrls?: Array<{ filename: string; url: string }>;
  compactAttachmentIntelligence?: boolean;
  compactToolMedia?: boolean;
  compactWebTools?: boolean;
}): void {
  void compactSessionHistoryAfterIdle({
    client: input.client,
    sessionId: input.sessionId,
    directory: input.directory,
    visionFilenames: input.filenames,
    visionDisplayUrls: input.displayUrls,
    compactAttachmentIntelligence: input.compactAttachmentIntelligence,
    compactToolMedia: input.compactToolMedia,
    compactWebTools: input.compactWebTools,
  }).catch((error) => {
    console.warn("[WodeAppVisionHistory] compact failed", error);
  });
}

/**
 * Sync scrub before the next promptAsync. Idle compaction can race a fast
 * follow-up, and leftover `file://` type:file parts crash AI SDK replay with
 * "URL scheme must be http, https, or data, got file:".
 * Does not strip current-turn `data:image` pixels (those need filenames /
 * post-idle compaction).
 */
export async function scrubUnsafeModelMediaBeforePrompt(input: {
  client: VisionHistoryCompactClient;
  sessionId: string;
  directory?: string;
}): Promise<{ scrubbed: number }> {
  const sessionId = input.sessionId.trim();
  if (!sessionId) return { scrubbed: 0 };
  try {
    const result = await compactEphemeralVisionFilePartsAfterIdle({
      client: input.client,
      sessionId,
      directory: input.directory,
      filenames: [],
      scrubFileSchemeImages: true,
      alreadyIdle: true,
    });
    if (result.scrubbed > 0) {
      recordWodeAppContextHygieneEvent({
        sessionId,
        event: "history_pre_prompt_file_scheme_scrub",
        details: { scrubbed: result.scrubbed },
      });
    }
    return { scrubbed: result.scrubbed };
  } catch (error) {
    console.warn("[WodeAppVisionHistory] pre-prompt file-scheme scrub failed", error);
    return { scrubbed: 0 };
  }
}

export function scheduleSessionHistoryCompaction(input: {
  client: VisionHistoryCompactClient;
  sessionId: string;
  directory?: string;
  visionFilenames?: string[];
  visionDisplayUrls?: Array<{ filename: string; url: string }>;
  compactAttachmentIntelligence?: boolean;
  compactToolMedia?: boolean;
  compactWebTools?: boolean;
  timeoutMs?: number;
  graceMs?: number;
  pollMs?: number;
}): void {
  void compactSessionHistoryAfterIdle({
    ...input,
    timeoutMs: input.timeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS,
  })
    .then((result) => {
      recordWodeAppContextHygieneEvent({
        sessionId: input.sessionId,
        event: "history_compaction_finished",
        details: { ...result },
      });
    })
    .catch((error) => {
      console.warn("[WodeAppContextHistory] compact failed", error);
      recordWodeAppContextHygieneEvent({
        sessionId: input.sessionId,
        event: "history_compaction_failed",
        details: { reason: error instanceof Error ? error.name : "unknown" },
      });
    });
}

/** Wait for first paint / snapshot hydrate before hygiene IPC (session-switch critical path). */
const RECOVERY_SWEEP_DEFER_MS = 1_500;
/** Cap idle-callback wait so recovery still runs when the main thread stays busy. */
const RECOVERY_SWEEP_IDLE_TIMEOUT_MS = 2_500;
/** Bound recovery reads so a fat history session cannot starve the UI after switch. */
const RECOVERY_SWEEP_MESSAGE_LIMIT = 120;

type PendingRecoverySweep = {
  sessionId: string;
  cancelled: boolean;
  timer: ReturnType<typeof setTimeout>;
  idleHandle: number | null;
};

let pendingRecoverySweep: PendingRecoverySweep | null = null;

function cancelPendingSessionHistoryRecoverySweep(): void {
  const pending = pendingRecoverySweep;
  if (!pending) return;
  pending.cancelled = true;
  clearTimeout(pending.timer);
  if (pending.idleHandle != null) {
    const cancelIdle = (globalThis as { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback;
    if (typeof cancelIdle === "function") cancelIdle(pending.idleHandle);
    else clearTimeout(pending.idleHandle);
  }
  if (pendingRecoverySweep === pending) pendingRecoverySweep = null;
}

function scheduleOnIdle(run: () => void, timeoutMs: number): number {
  const requestIdle = (globalThis as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (typeof requestIdle === "function") {
    return requestIdle(run, { timeout: timeoutMs });
  }
  return setTimeout(run, Math.min(32, timeoutMs)) as unknown as number;
}

/**
 * Schedule recoverable-history hygiene AFTER session-switch first paint.
 * Rapid history flips cancel the previous pending sweep so only the latest
 * session pays for status/messages IPC.
 */
export function scheduleSessionHistoryRecoverySweep(input: {
  client: VisionHistoryCompactClient;
  sessionId: string;
  directory?: string;
}): void {
  const sessionId = input.sessionId.trim();
  if (!sessionId) return;

  cancelPendingSessionHistoryRecoverySweep();

  const pending: PendingRecoverySweep = {
    sessionId,
    cancelled: false,
    idleHandle: null,
    timer: setTimeout(() => {
      if (pending.cancelled || pendingRecoverySweep !== pending) return;
      pending.idleHandle = scheduleOnIdle(() => {
        if (pending.cancelled || pendingRecoverySweep !== pending) return;
        pendingRecoverySweep = null;
        void sweepRecoverableSessionHistory({
          ...input,
          sessionId,
          limit: RECOVERY_SWEEP_MESSAGE_LIMIT,
        })
          .then((result) => {
            if (!result.deletedVision && !result.stubbedAttachment && !result.stubbedToolMedia && !result.stubbedWebTools) return;
            recordWodeAppContextHygieneEvent({
              sessionId,
              event: "history_recovery_finished",
              details: { ...result },
            });
          })
          .catch((error) => {
            console.warn("[WodeAppContextHistory] recovery sweep failed", error);
            recordWodeAppContextHygieneEvent({
              sessionId,
              event: "history_recovery_failed",
              details: { reason: error instanceof Error ? error.name : "unknown" },
            });
          });
      }, RECOVERY_SWEEP_IDLE_TIMEOUT_MS);
    }, RECOVERY_SWEEP_DEFER_MS),
  };
  pendingRecoverySweep = pending;
}
