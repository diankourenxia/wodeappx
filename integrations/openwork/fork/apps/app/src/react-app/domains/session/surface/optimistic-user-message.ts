import type { UIMessage } from "ai";

export const OPTIMISTIC_USER_MESSAGE_PREFIX = "optimistic-user:";

export type OptimisticAttachmentInput = {
  name?: string;
  mimeType?: string;
  /** Absolute local path or file:// / https URL for open / materialize. */
  path?: string | null;
  url?: string | null;
  /** Electron-safe image preview (blob:). Preferred for chat thumbnail display. */
  previewUrl?: string | null;
  file?: File | null;
};

function isOpenableAttachmentUrl(url: string): boolean {
  return /^(https?:\/\/|file:\/\/|wodeappx-asset:)/i.test(url.trim());
}

function toFileUrlFromAbsolutePath(absolutePath: string): string | null {
  const trimmed = String(absolutePath ?? "").trim();
  if (!trimmed) return null;
  if (/^file:\/\//i.test(trimmed)) return trimmed;
  if (!(trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed))) return null;
  const normalized = trimmed.replace(/\\/g, "/");
  return `file://${normalized.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
}

function attachmentDisplayName(attachment: OptimisticAttachmentInput): string {
  if (typeof attachment.name === "string" && attachment.name.trim()) {
    return attachment.name.trim();
  }
  const fileName = attachment.file?.name?.trim();
  return fileName || "";
}

function attachmentMediaType(attachment: OptimisticAttachmentInput, name: string): string {
  const mime = typeof attachment.mimeType === "string" ? attachment.mimeType.trim() : "";
  if (mime) return mime;
  const fileType = attachment.file?.type?.trim();
  if (fileType) return fileType;
  const extension = name.split(".").pop()?.trim().toLowerCase() ?? "";
  if (extension === "mp4") return "video/mp4";
  if (extension === "mov") return "video/quicktime";
  if (extension === "webm") return "video/webm";
  if (extension === "pdf") return "application/pdf";
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

/**
 * Images prefer blob previewUrl for Electron-safe thumbnails.
 * Durable file:// / absolute path is used when no blob preview exists.
 */
export function resolveOptimisticAttachmentOpenUrl(
  attachment: OptimisticAttachmentInput,
): string | null {
  const name = attachmentDisplayName(attachment) || "file";
  const mime = attachmentMediaType(attachment, name);
  const preview = typeof attachment.previewUrl === "string" ? attachment.previewUrl.trim() : "";
  if (mime.startsWith("image/") && /^blob:/i.test(preview)) {
    return preview;
  }
  const explicit = typeof attachment.url === "string" ? attachment.url.trim() : "";
  if (explicit && isOpenableAttachmentUrl(explicit)) {
    return explicit;
  }
  if (explicit && /^blob:/i.test(explicit) && mime.startsWith("image/")) {
    return explicit;
  }
  const pathHint = typeof attachment.path === "string" ? attachment.path.trim() : "";
  if (pathHint) {
    if (isOpenableAttachmentUrl(pathHint)) return pathHint;
    const asFileUrl = toFileUrlFromAbsolutePath(pathHint);
    if (asFileUrl) return asFileUrl;
  }
  const legacyPath = (attachment.file as (File & { path?: string }) | null | undefined)?.path?.trim();
  if (legacyPath) {
    const asFileUrl = toFileUrlFromAbsolutePath(legacyPath);
    if (asFileUrl) return asFileUrl;
  }
  return null;
}

export function buildOptimisticUserMessage(
  text: string,
  attachments: OptimisticAttachmentInput[] = [],
): UIMessage {
  const trimmed = text.trim();
  const parts: UIMessage["parts"] = [];
  if (trimmed) {
    parts.push({ type: "text", text: trimmed });
  }
  for (const attachment of attachments) {
    const name = attachmentDisplayName(attachment);
    if (!name) continue;
    const url = resolveOptimisticAttachmentOpenUrl(attachment);
    // No display URL → skip the chip. Send path must materialize first;
    // never paint a non-openable stub like Cursor/Codex never would.
    if (!url) continue;
    parts.push({
      type: "file",
      url,
      mediaType: attachmentMediaType(attachment, name),
      filename: name,
    } as UIMessage["parts"][number]);
  }
  if (parts.length === 0) {
    parts.push({ type: "text", text: "" });
  }
  return {
    id: `${OPTIMISTIC_USER_MESSAGE_PREFIX}${Date.now().toString(36)}`,
    role: "user",
    parts,
  };
}

export function isOptimisticUserMessage(message: UIMessage | null | undefined): boolean {
  return Boolean(message?.id?.startsWith(OPTIMISTIC_USER_MESSAGE_PREFIX));
}

function userMessageVisibleText(message: UIMessage): string {
  return message.parts
    .filter((part): part is Extract<UIMessage["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function userMessageHasVisibleContent(message: UIMessage): boolean {
  if (userMessageVisibleText(message)) return true;
  return message.parts.some((part) => part.type === "file");
}

export type OptimisticUserClearOptions = {
  /**
   * Transcript length when the optimistic bubble was created. Only user turns
   * at/after this index can clear it — otherwise repeating the same prompt
   * ("你好" again) matches the previous user turn and drops the bubble before
   * the new SSE echo has parts (empty shell → invisible).
   */
  baselineMessageCount?: number | null;
};

/** Drop the optimistic bubble once the server/SSE user turn is in the transcript. */
export function shouldClearOptimisticUserMessage(
  pending: UIMessage | null | undefined,
  renderedMessages: UIMessage[],
  options?: OptimisticUserClearOptions,
): boolean {
  if (!pending || !isOptimisticUserMessage(pending)) return false;
  const pendingText = userMessageVisibleText(pending);
  const start = typeof options?.baselineMessageCount === "number"
    ? Math.max(0, options.baselineMessageCount)
    : 0;
  for (let i = renderedMessages.length - 1; i >= start; i -= 1) {
    const message = renderedMessages[i];
    if (!message || message.role !== "user") continue;
    if (isOptimisticUserMessage(message)) continue;
    // message.updated creates an empty shell before parts arrive. Clearing on
    // that shell leaves neither optimistic nor real bubble for a beat.
    if (!userMessageHasVisibleContent(message)) continue;
    return userMessageVisibleText(message) === pendingText;
  }
  return false;
}

/** Append optimistic user turn when the live transcript has not echoed it yet. */
export function mergeOptimisticUserMessage(
  messages: UIMessage[],
  pending: UIMessage | null | undefined,
  options?: OptimisticUserClearOptions,
): UIMessage[] {
  if (!pending || !isOptimisticUserMessage(pending)) return messages;
  if (shouldClearOptimisticUserMessage(pending, messages, options)) return messages;
  if (messages.some((message) => message.id === pending.id)) return messages;
  return [...messages, pending];
}
