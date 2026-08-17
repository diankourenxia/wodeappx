/**
 * Prepare chat attachment bytes for vision-direct file parts.
 *
 * OpenCode Image.normalize defaults: max edge 2000, PNG-first when it resizes.
 * We must stay ≤2000 as JPEG so OpenCode never re-encodes photos to PNG.
 */
const WEBP_MIMES = new Set(["image/webp", "image/x-webp"]);
/** Match OpenCode Image.normalize default maxWidth/maxHeight (not 2048). */
export const IMAGE_COMPRESS_MAX_PX = 2000;
const IMAGE_COMPRESS_QUALITY = 0.82;
/**
 * Skip recompress when already small AND within OpenCode's edge limit.
 * Over-limit dimensions always get a JPEG resize even if the file is tiny —
 * otherwise OpenCode's PNG-first resize blows a ~200KB JPEG into ~1.7MB.
 */
export const IMAGE_COMPRESS_SKIP_BYTES = 300 * 1024;
const COMPRESSIBLE_IMAGE_MIME_RE = /^image\/(?:jpeg|jpg|png|webp|bmp)$/i;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function normalizedMime(mimeType: string) {
  return mimeType.trim().toLowerCase().split(";")[0]?.trim() ?? "";
}

function isOfficeMime(mime: string) {
  return mime === DOCX_MIME || mime === PPTX_MIME || mime === XLSX_MIME;
}

function isTextLikeAttachmentMime(mime: string) {
  if (mime.startsWith("text/")) return true;
  if (mime === "application/json" || mime === "application/xml" || mime === "application/javascript") return true;
  return mime.endsWith("+json") || mime.endsWith("+xml");
}

/**
 * AI SDK provider adapters only accept `image/*`, `application/pdf`, and
 * `text/plain` file parts; anything else throws UnsupportedFunctionalityError
 * and poisons session history on every later prompt (OpenWork #3079).
 *
 * - text-like → `text/plain` (Read-tool path)
 * - image / pdf / office → pass through
 * - everything else → `null` (no model-facing file part; keep path notes / tools)
 *
 * Size caps and video/audio bans stay elsewhere — this only remaps mime.
 */
export function modelFacingAttachmentMime(mimeType: string): string | null {
  const mime = normalizedMime(mimeType);
  if (!mime) return null;
  if (isTextLikeAttachmentMime(mime)) return "text/plain";
  if (mime.startsWith("image/") || mime === "application/pdf" || isOfficeMime(mime)) return mime;
  return null;
}

function filenameWithExtension(filename: string, extension: string) {
  const trimmed = filename.trim() || `attachment.${extension}`;
  if (/\.[a-z0-9]{1,8}$/i.test(trimmed)) {
    return trimmed.replace(/\.[a-z0-9]{1,8}$/i, `.${extension}`);
  }
  return `${trimmed}.${extension}`;
}

function readBlobAsDataUrl(blob: Blob, filename: string) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Failed to read attachment: ${filename}`));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number, filename: string) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      reject(new Error(`Failed to convert image attachment: ${filename}`));
    }, type, quality);
  });
}

async function decodeImageFile(file: File) {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to decode image attachment: ${file.name}`));
      img.src = sourceUrl;
    });
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) throw new Error(`Image attachment has no dimensions: ${file.name}`);
    return { image, width, height };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

async function compressImageForModel(file: File, mimeType: string): Promise<{ blob: Blob; mime: string; filename: string } | null> {
  const mime = normalizedMime(mimeType || file.type);
  if (!COMPRESSIBLE_IMAGE_MIME_RE.test(mime) || mime === "image/gif") return null;

  try {
    const { image, width, height } = await decodeImageFile(file);
    const maxDim = Math.max(width, height);
    const needsResize = maxDim > IMAGE_COMPRESS_MAX_PX;
    const needsShrink = file.size > IMAGE_COMPRESS_SKIP_BYTES;
    // WebP/BMP always re-encode to JPEG for model send (never PNG).
    const needsFormatNormalize = WEBP_MIMES.has(mime) || mime === "image/bmp";
    if (!needsResize && !needsShrink && !needsFormatNormalize) return null;

    const scale = needsResize ? IMAGE_COMPRESS_MAX_PX / maxDim : 1;
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const context = canvas.getContext("2d");
    if (!context) return null;
    // Opaque white underlay so transparent PNG/WebP do not become black JPEG.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, targetW, targetH);
    context.drawImage(image, 0, 0, targetW, targetH);

    const outputMime = "image/jpeg";
    const blob = await canvasToBlob(canvas, outputMime, IMAGE_COMPRESS_QUALITY, file.name);
    if (blob.size >= file.size && !needsResize && !needsFormatNormalize) return null;
    return {
      blob,
      mime: outputMime,
      filename: filenameWithExtension(file.name, "jpg"),
    };
  } catch {
    return null;
  }
}

/** Only images may become chat `data:` file parts (Cursor/Codex-style). */
export function canInlineAttachmentAsModelDataUrl(mimeType: string): boolean {
  return normalizedMime(mimeType).startsWith("image/");
}

/**
 * Prepare attachment bytes for vision-direct file parts.
 * Non-images must use a durable local path / tool path — never session-persisted base64.
 */
export async function attachmentToModelFileData(file: File, mimeType: string) {
  const mime = normalizedMime(mimeType || file.type);
  if (!canInlineAttachmentAsModelDataUrl(mime)) {
    throw new Error(
      `Refusing to inline non-image attachment as data URL: ${file.name || "attachment"} (${mimeType || mime || "unknown"})`,
    );
  }
  const compressed = await compressImageForModel(file, mime);
  if (compressed) {
    return {
      url: await readBlobAsDataUrl(compressed.blob, compressed.filename),
      mime: compressed.mime,
      filename: compressed.filename,
    };
  }

  return {
    url: await readBlobAsDataUrl(new Blob([file], { type: mime || mimeType }), file.name),
    mime: mime || mimeType,
    filename: file.name,
  };
}
