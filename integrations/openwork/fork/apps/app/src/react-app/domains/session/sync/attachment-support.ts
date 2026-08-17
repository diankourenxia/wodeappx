/**
 * Attach-time policy vs send-time mime routing.
 *
 * OpenWork #3079: client allowlists drift. Attach accepts durable files; send
 * remaps via `modelFacingAttachmentMime` so unsupported provider mimes never
 * land in replayable session history.
 *
 * Size caps stay in composer / session-surface — do not remove them.
 */
export function isModelReadableAttachment(_mimeType: string) {
  // Any mime may be attached; model-facing routing happens at send time.
  return true;
}

type AttachmentFileIdentity = Pick<File, "lastModified" | "name" | "size" | "type"> & {
  path?: string;
  webkitRelativePath?: string;
};

type ExistingAttachmentIdentity = { file: AttachmentFileIdentity; name?: string };

/** macOS/Electron clipboard screenshots often arrive as bare image.png / image.jpg. */
const GENERIC_CLIPBOARD_BASENAME_RE = /^(image|img|photo|screenshot|untitled|picture|paste)(\.(png|jpe?g|gif|webp|heic|bmp))?$/i;

function extensionFromMime(mimeType: string, fallbackName: string): string {
  const mime = mimeType.trim().toLowerCase();
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/heic") return "heic";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("video/mp4")) return "mp4";
  const fromName = fallbackName.split(".").pop()?.trim().toLowerCase() || "";
  if (fromName && /^[a-z0-9]{1,8}$/i.test(fromName)) return fromName;
  return "bin";
}

function sanitizeAttachmentBaseName(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function shortAttachmentToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function isGenericClipboardAttachmentName(name: string): boolean {
  const base = name.trim().split(/[/\\]/).pop() || "";
  return !base || GENERIC_CLIPBOARD_BASENAME_RE.test(base);
}

/**
 * Cursor/Codex-style durable names: clipboard `image.png` must not collide with
 * ~/Downloads/image.png or a previous paste in the same session.
 */
export function uniquifyComposerAttachmentFileName(
  file: Pick<File, "name" | "type">,
  usedNames: Set<string>,
  nowMs: number = Date.now(),
): string {
  const original = (file.name || "").trim() || "attachment";
  const ext = extensionFromMime(file.type || "", original);
  const stamp = new Date(nowMs).toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  let candidate = original;
  if (isGenericClipboardAttachmentName(original)) {
    candidate = `paste-${stamp}-${shortAttachmentToken()}.${ext}`;
  } else {
    const stem = sanitizeAttachmentBaseName(original.replace(/\.[^.]+$/, "")) || "attachment";
    candidate = `${stem}.${ext}`;
  }
  const lowerUsed = usedNames;
  if (!lowerUsed.has(candidate.toLowerCase())) {
    lowerUsed.add(candidate.toLowerCase());
    return candidate;
  }
  let index = 2;
  while (index < 10_000) {
    const stem = candidate.replace(/\.[^.]+$/, "");
    const next = `${stem}-${index}.${ext}`;
    if (!lowerUsed.has(next.toLowerCase())) {
      lowerUsed.add(next.toLowerCase());
      return next;
    }
    index += 1;
  }
  const fallback = `paste-${stamp}-${shortAttachmentToken()}.${ext}`;
  lowerUsed.add(fallback.toLowerCase());
  return fallback;
}

export function renameComposerAttachmentFile(file: File, nextName: string): File {
  if (file.name === nextName) return file;
  const renamed = new File([file], nextName, {
    type: file.type || "application/octet-stream",
    lastModified: file.lastModified,
  });
  const legacyPath = (file as File & { path?: string }).path;
  if (legacyPath) {
    Object.defineProperty(renamed, "path", {
      configurable: true,
      value: legacyPath,
    });
  }
  return renamed;
}

/** Rename generic/colliding clipboard names before preview URLs are allocated. */
export function uniquifyComposerAttachmentFiles(
  files: readonly File[],
  existingAttachments: readonly ExistingAttachmentIdentity[] = [],
): File[] {
  const used = new Set(
    existingAttachments
      .map((attachment) => (attachment.name || attachment.file.name || "").trim().toLowerCase())
      .filter(Boolean),
  );
  return files.map((file) => {
    const nextName = uniquifyComposerAttachmentFileName(file, used);
    return renameComposerAttachmentFile(file, nextName);
  });
}

function attachmentFileFingerprint(file: AttachmentFileIdentity) {
  const sourcePath = file.path?.trim() || file.webkitRelativePath?.trim() || "";
  return [sourcePath, file.name, file.size, file.lastModified, file.type || "application/octet-stream"].join("\u0000");
}

/** Reject existing and same-batch duplicates before allocating preview URLs. */
export function filterDuplicateComposerAttachmentFiles(
  files: readonly File[],
  existingAttachments: readonly ExistingAttachmentIdentity[],
) {
  const fingerprints = new Set(
    existingAttachments.map((attachment) => attachmentFileFingerprint(attachment.file)),
  );
  const accepted: File[] = [];
  const duplicates: File[] = [];
  for (const file of files) {
    const fingerprint = attachmentFileFingerprint(file);
    if (fingerprints.has(fingerprint)) {
      duplicates.push(file);
      continue;
    }
    fingerprints.add(fingerprint);
    accepted.push(file);
  }
  return { accepted, duplicates };
}
