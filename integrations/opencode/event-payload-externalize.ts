/**
 * PERF-05 / PERF-06 step 2: write-before-externalize for OpenCode event/part store.
 *
 * Fat video/audio/PDF `data:` and oversized tool output must not enter `event` / `part` tables.
 * Bytes land under ~/.wodeappx/session-media (0700/0600); events keep file:// + metadata.
 * (Legacy alias: session-artifacts / WODEAPPX_SESSION_ARTIFACTS_ROOT.)
 *
 * Never externalize `image/*` to file:// — AI SDK / cloud vision only accept http/https/data.
 * Empirically (ses_0357fbf67ffe*): paste screenshot → data:image → spill to file:// →
 * "URL scheme must be http, https, or data, got file:" (tokens=0). Idle compaction still
 * strips vision pixels after the turn.
 *
 * Copied into patched OpenCode via patch-opencode-dynamic-tools.mjs.
 */
import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const EVENT_PAYLOAD_LIMITS = Object.freeze({
  /** Hard ceiling for a single part JSON after externalize (acceptance). */
  MAX_EVENT_BYTES: 2 * 1024 * 1024,
  /** Tool text/output spill threshold. */
  TOOL_OUTPUT_EXTERNALIZE_BYTES: 256 * 1024,
  /** Non-media data: URLs above this are externalized (aligned with PERF-05 slim). */
  DATA_URL_EXTERNALIZE_CHARS: 2_048,
  /** Preview kept in tool state.output after spill. */
  TOOL_OUTPUT_PREVIEW_CHARS: 4_000,
});

/** Tiny JPEG — keeps `data:image` scheme for replay while shrinking an oversized part. */
const TINY_JPEG_DATA_URL =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEAMQAAAAqf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z";

export const ARTIFACT_SCHEME_HINT = "wodeappx-session-artifact";

export type EventPayloadMetrics = {
  externalized_bytes: number;
  externalized_count: number;
  max_event_bytes: number;
  payload_rejected: number;
};

export class EventPayloadExternalizeError extends Error {
  readonly code = "EVENT_PAYLOAD_EXTERNALIZE_FAILED";
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "EventPayloadExternalizeError";
    this.details = details;
  }
}

const metrics: EventPayloadMetrics = {
  externalized_bytes: 0,
  externalized_count: 0,
  max_event_bytes: 0,
  payload_rejected: 0,
};

export function getEventPayloadMetrics(): EventPayloadMetrics {
  return { ...metrics };
}

export function resetEventPayloadMetrics(): void {
  metrics.externalized_bytes = 0;
  metrics.externalized_count = 0;
  metrics.max_event_bytes = 0;
  metrics.payload_rejected = 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function estimateBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function trackEventBytes(bytes: number): void {
  if (bytes > metrics.max_event_bytes) metrics.max_event_bytes = bytes;
}

/** Cursor/Codex-style durable media root (openable file:// chips). */
export function defaultSessionMediaRoot(): string {
  const media = process.env.WODEAPPX_SESSION_MEDIA_ROOT?.trim();
  if (media) return resolve(media);
  // Legacy env kept as alias so old installs / GC scripts keep working.
  const legacy = process.env.WODEAPPX_SESSION_ARTIFACTS_ROOT?.trim();
  if (legacy) return resolve(legacy);
  return join(homedir(), ".wodeappx", "session-media");
}

/** @deprecated Use defaultSessionMediaRoot */
function defaultArtifactsRoot(): string {
  return defaultSessionMediaRoot();
}

const AV_OR_PDF_EXT_RE = /\.(mp4|m4v|mov|webm|mkv|avi|mp3|wav|m4a|aac|flac|ogg|oga|pdf)$/i;

function isPathInsideRoot(filePath: string, rootDir: string): boolean {
  const resolved = resolve(filePath);
  const root = resolve(rootDir);
  return resolved === root || resolved.startsWith(`${root}/`) || resolved.startsWith(`${root}\\`);
}

function safeSessionDir(sessionID: string): string {
  const readable = String(sessionID || "session").replace(/[^a-z0-9._-]+/gi, "_").slice(0, 72) || "session";
  const suffix = createHash("sha256").update(String(sessionID || "session")).digest("hex").slice(0, 8);
  return `${readable}-${suffix}`;
}

function mimeToExt(mime: string, filename?: string): string {
  const fromName = filename ? extname(filename).replace(/^\./, "") : "";
  if (fromName && /^[a-z0-9]{1,8}$/i.test(fromName)) return fromName.toLowerCase();
  const lower = mime.toLowerCase();
  if (lower.includes("mp4")) return "mp4";
  if (lower.includes("webm")) return "webm";
  if (lower.includes("wav")) return "wav";
  if (lower.includes("mpeg") || lower.includes("mp3")) return "mp3";
  if (lower.includes("pdf")) return "pdf";
  if (lower.includes("png")) return "png";
  if (lower.includes("jpeg") || lower.includes("jpg")) return "jpg";
  if (lower.includes("webp")) return "webp";
  if (lower.includes("gif")) return "gif";
  if (lower.startsWith("text/") || lower.includes("json")) return "txt";
  return "bin";
}

function parseDataUrl(url: string): { mime: string; buffer: Buffer } | null {
  const match = /^data:([^;,]+)?([^,]*),(.*)$/s.exec(url);
  if (!match) return null;
  const mime = (match[1] || "application/octet-stream").trim() || "application/octet-stream";
  const meta = match[2] || "";
  const payload = match[3] || "";
  try {
    if (/;base64/i.test(meta)) {
      return { mime, buffer: Buffer.from(payload, "base64") };
    }
    return { mime, buffer: Buffer.from(decodeURIComponent(payload), "utf8") };
  } catch {
    return null;
  }
}

function isAlwaysExternalizeMime(mime: string): boolean {
  const lower = mime.toLowerCase();
  return (
    lower.startsWith("video/")
    || lower.startsWith("audio/")
    || lower === "application/pdf"
    || lower.includes("pdf")
  );
}

/** Mime or filename says this must stay out of data: transcript blobs. */
export function isAvOrPdfMedia(mime?: string, filename?: string): boolean {
  if (mime && isAlwaysExternalizeMime(mime)) return true;
  if (filename && AV_OR_PDF_EXT_RE.test(filename)) return true;
  return false;
}

function shouldExternalizeDataUrl(url: string, mimeHint?: string, filename?: string): boolean {
  if (!/^data:/i.test(url)) return false;
  const mime = (mimeHint || /^data:([^;,]+)/i.exec(url)?.[1] || "").toLowerCase();
  // Keep vision pixels as data:image for the live turn. file:// poisons model replay.
  if (mime.startsWith("image/")) return false;
  if (isAvOrPdfMedia(mime, filename)) return true;
  return url.length > EVENT_PAYLOAD_LIMITS.DATA_URL_EXTERNALIZE_CHARS;
}

function chmodPrivateDir(dir: string): void {
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* ignore */
  }
}

function chmodPrivateFile(file: string): void {
  try {
    chmodSync(file, 0o600);
  } catch {
    /* ignore */
  }
}

export type WrittenArtifact = {
  path: string;
  fileUrl: string;
  bytes: number;
  sha256: string;
  mime: string;
  filename: string;
  artifactRef: string;
  readHint: string;
};

export function writeSessionArtifact(input: {
  sessionID: string;
  bytes: Buffer;
  mime: string;
  filename?: string;
  rootDir?: string;
}): WrittenArtifact {
  const root = input.rootDir ? resolve(input.rootDir) : defaultArtifactsRoot();
  const sessionDir = join(root, safeSessionDir(input.sessionID));
  mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  chmodPrivateDir(root);
  chmodPrivateDir(sessionDir);

  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const ext = mimeToExt(input.mime, input.filename);
  const filename = (input.filename && basename(input.filename).trim()) || `artifact.${ext}`;
  const dest = join(sessionDir, `${sha256.slice(0, 24)}.${ext}`);
  if (!existsSync(dest)) {
    const tmp = join(sessionDir, `.tmp-${randomBytes(6).toString("hex")}`);
    try {
      writeFileSync(tmp, input.bytes, { mode: 0o600 });
      chmodPrivateFile(tmp);
      renameSync(tmp, dest);
      chmodPrivateFile(dest);
    } catch (error) {
      try { unlinkSync(tmp); } catch { /* ignore */ }
      metrics.payload_rejected += 1;
      throw new EventPayloadExternalizeError(
        error instanceof Error ? error.message : String(error),
        { stage: "write-artifact", dest },
      );
    }
  } else {
    chmodPrivateFile(dest);
  }

  metrics.externalized_bytes += input.bytes.byteLength;
  metrics.externalized_count += 1;

  const artifactRef = `session-media/${safeSessionDir(input.sessionID)}/${basename(dest)}`;
  return {
    path: dest,
    fileUrl: pathToFileURL(dest).href,
    bytes: input.bytes.byteLength,
    sha256,
    mime: input.mime,
    filename,
    artifactRef,
    readHint: "use offset/maxChars (Read/grep); never cat whole artifact",
  };
}

/** Sync helper used by prompt.resolvePart to skip base64 for binary media. */
export function externalizeRawBytesToFileUrl(input: {
  sessionID: string;
  bytes: Buffer;
  mime: string;
  filename?: string;
  rootDir?: string;
}): string {
  return writeSessionArtifact(input).fileUrl;
}

export function readExternalizedArtifact(
  artifactPath: string,
  options: { offset?: number; maxChars?: number; rootDir?: string } = {},
): { ok: true; text: string; bytes: number; truncated: boolean } | { ok: false; error: string } {
  try {
    const resolved = resolve(artifactPath);
    const root = resolve(options.rootDir || defaultArtifactsRoot());
    if (!isPathInsideRoot(resolved, root)) {
      return { ok: false, error: "artifact path outside session-media root" };
    }
    const buf = readFileSync(resolved);
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const maxChars = Math.max(1, Math.floor(options.maxChars ?? EVENT_PAYLOAD_LIMITS.TOOL_OUTPUT_PREVIEW_CHARS));
    const text = buf.toString("utf8");
    const slice = text.slice(offset, offset + maxChars);
    return {
      ok: true,
      text: slice,
      bytes: buf.byteLength,
      truncated: offset + maxChars < text.length,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function artifactStubText(meta: WrittenArtifact): string {
  return [
    `[${ARTIFACT_SCHEME_HINT}]`,
    `filename: ${meta.filename}`,
    `mime: ${meta.mime}`,
    `bytes: ${meta.bytes}`,
    `sha256: ${meta.sha256}`,
    `artifactRef: ${meta.artifactRef}`,
    `path: ${meta.path}`,
    `readHint: ${meta.readHint}`,
  ].join("\n");
}

function externalizeDataUrlField(
  record: Record<string, unknown>,
  sessionID: string,
  rootDir?: string,
): Record<string, unknown> {
  const url = typeof record.url === "string" ? record.url : "";
  const mimeHint = typeof record.mime === "string" ? record.mime : undefined;
  const filenameHint = typeof record.filename === "string" ? record.filename : undefined;
  if (!shouldExternalizeDataUrl(url, mimeHint, filenameHint)) return record;

  const parsed = parseDataUrl(url);
  if (!parsed) {
    metrics.payload_rejected += 1;
    throw new EventPayloadExternalizeError("failed to parse data URL for externalize", {
      mime: mimeHint,
      urlChars: url.length,
    });
  }

  const meta = writeSessionArtifact({
    sessionID,
    bytes: parsed.buffer,
    mime: mimeHint || parsed.mime,
    filename: filenameHint,
    rootDir,
  });

  return {
    ...record,
    url: meta.fileUrl,
    mime: meta.mime,
    filename: typeof record.filename === "string" && record.filename.trim()
      ? record.filename
      : meta.filename,
    source: {
      type: "file",
      path: meta.path,
      text: {
        value: artifactStubText(meta),
        start: 0,
        end: 0,
      },
    },
  };
}

function externalizeToolOutput(
  output: string,
  sessionID: string,
  rootDir?: string,
): string {
  const bytes = Buffer.byteLength(output, "utf8");
  if (bytes <= EVENT_PAYLOAD_LIMITS.TOOL_OUTPUT_EXTERNALIZE_BYTES) return output;

  const meta = writeSessionArtifact({
    sessionID,
    bytes: Buffer.from(output, "utf8"),
    mime: "text/plain",
    filename: "tool-output.txt",
    rootDir,
  });
  const preview = output.slice(0, EVENT_PAYLOAD_LIMITS.TOOL_OUTPUT_PREVIEW_CHARS);
  return [
    preview,
    preview.length < output.length ? "\n…[preview truncated]" : "",
    "",
    artifactStubText(meta),
  ].join("\n");
}

function walkExternalize(value: unknown, sessionID: string, rootDir?: string): unknown {
  const record = asRecord(value);
  if (!record) return value;

  if (record.type === "file" && typeof record.url === "string") {
    return externalizeDataUrlField(record, sessionID, rootDir);
  }

  if (record.type === "tool") {
    const state = asRecord(record.state);
    if (!state) return record;
    let changed = false;
    const nextState: Record<string, unknown> = { ...state };

    for (const key of ["output", "error"] as const) {
      const text = nextState[key];
      if (typeof text === "string") {
        const next = externalizeToolOutput(text, sessionID, rootDir);
        if (next !== text) {
          nextState[key] = next;
          changed = true;
        }
      }
    }

    if (Array.isArray(nextState.attachments)) {
      const nextAttachments = nextState.attachments.map((attachment) => {
        const entry = asRecord(attachment);
        if (!entry || typeof entry.url !== "string") return attachment;
        const next = externalizeDataUrlField(entry, sessionID, rootDir);
        if (next !== entry) changed = true;
        return next;
      });
      if (changed) nextState.attachments = nextAttachments;
    }

    return changed ? { ...record, state: nextState } : record;
  }

  return record;
}

/**
 * Self-heal (ses_025ec834*): oversized `data:image` must not Die the turn.
 * Spill original bytes to session-media, keep a tiny data:image stub (never file://),
 * and let the loop continue. Prefer createBoundedImagePreview's own byte budget; this is the last resort.
 */
function shrinkOversizedImageDataUrls(
  value: unknown,
  sessionID: string,
  rootDir?: string,
): unknown {
  const record = asRecord(value);
  if (!record) return value;

  if (record.type === "file" && typeof record.url === "string" && /^data:image\//i.test(record.url)) {
    const parsed = parseDataUrl(record.url);
    if (!parsed) return record;
    const meta = writeSessionArtifact({
      sessionID,
      bytes: parsed.buffer,
      mime: (typeof record.mime === "string" && record.mime) || parsed.mime || "image/jpeg",
      filename: typeof record.filename === "string" ? record.filename : undefined,
      rootDir,
    });
    return {
      ...record,
      url: TINY_JPEG_DATA_URL,
      mime: "image/jpeg",
      filename: typeof record.filename === "string" && record.filename.trim()
        ? record.filename
        : meta.filename,
      source: {
        type: "file",
        path: meta.path,
        text: {
          value: [
            "Self-healed: oversized image preview shrunk for durable store; full bytes kept as artifact.",
            artifactStubText(meta),
          ].join("\n"),
          start: 0,
          end: 0,
        },
      },
    };
  }

  if (record.type === "tool") {
    const state = asRecord(record.state);
    if (!state) return record;
    let changed = false;
    const nextState: Record<string, unknown> = { ...state };
    const spillNotes: string[] = [];

    if (Array.isArray(nextState.attachments)) {
      nextState.attachments = nextState.attachments.map((attachment) => {
        const entry = asRecord(attachment);
        if (!entry || typeof entry.url !== "string" || !/^data:image\//i.test(entry.url)) {
          return attachment;
        }
        const parsed = parseDataUrl(entry.url);
        if (!parsed) return attachment;
        const meta = writeSessionArtifact({
          sessionID,
          bytes: parsed.buffer,
          mime: (typeof entry.mime === "string" && entry.mime) || parsed.mime || "image/jpeg",
          filename: typeof entry.filename === "string" ? entry.filename : undefined,
          rootDir,
        });
        spillNotes.push(artifactStubText(meta));
        changed = true;
        return {
          ...entry,
          url: TINY_JPEG_DATA_URL,
          mime: "image/jpeg",
        };
      });
    }

    if (spillNotes.length > 0) {
      const note = [
        "Self-healed: oversized image preview shrunk so the turn can continue (artifact path kept).",
        ...spillNotes,
      ].join("\n");
      const prev = typeof nextState.output === "string" ? nextState.output : "";
      nextState.output = prev ? `${prev}\n\n${note}` : note;
      changed = true;
    }

    return changed ? { ...record, state: nextState } : record;
  }

  return record;
}

/**
 * Gate for Session.updatePart: return a part safe to publish into durable event store.
 * Throws EventPayloadExternalizeError on failure (caller must not write).
 */
export function externalizePartForEventStore<T>(part: T, options: { rootDir?: string } = {}): T {
  const record = asRecord(part);
  if (!record) return part;

  const sessionID = typeof record.sessionID === "string" && record.sessionID
    ? record.sessionID
    : "unknown-session";

  let next: unknown;
  try {
    next = walkExternalize(record, sessionID, options.rootDir);
  } catch (error) {
    metrics.payload_rejected += 1;
    if (error instanceof EventPayloadExternalizeError) throw error;
    throw new EventPayloadExternalizeError(
      error instanceof Error ? error.message : String(error),
      { stage: "externalize" },
    );
  }

  let bytes = estimateBytes(next);
  trackEventBytes(bytes);
  if (bytes > EVENT_PAYLOAD_LIMITS.MAX_EVENT_BYTES) {
    // Soft-fail oversized vision pixels: prefer continue over killing the turn.
    next = shrinkOversizedImageDataUrls(next, sessionID, options.rootDir);
    bytes = estimateBytes(next);
    trackEventBytes(bytes);
  }
  if (bytes > EVENT_PAYLOAD_LIMITS.MAX_EVENT_BYTES) {
    metrics.payload_rejected += 1;
    throw new EventPayloadExternalizeError(
      `part payload still exceeds ${EVENT_PAYLOAD_LIMITS.MAX_EVENT_BYTES} bytes after externalize`,
      { bytes, sessionID, type: record.type },
    );
  }

  return next as T;
}

export function isSessionArtifactPath(filePath: string, rootDir?: string): boolean {
  try {
    return isPathInsideRoot(filePath, rootDir || defaultArtifactsRoot());
  } catch {
    return false;
  }
}

/**
 * prompt.resolvePart must never turn A/V/PDF into data: blobs.
 * Filename is required: wrong mime (octet-stream + .mp4) previously re-inlined 178MB.
 */
export function shouldSkipDataUrlInline(mime: string, filename?: string): boolean {
  return isAvOrPdfMedia(mime, filename);
}
