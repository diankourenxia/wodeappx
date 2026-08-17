/**
 * Canvas-based image normalize before HTTPS upload (asset_save / product_save).
 * Strips EXIF by redraw, caps long edge, ladder-compresses oversized payloads.
 * Does not require Electron sharp — server `/upload/file` remains the sharp safety net.
 */

export type ImageUploadPurpose = "reference" | "product" | "original";

export type NormalizeForUploadOptions = {
  purpose?: ImageUploadPurpose;
  preserveOriginal?: boolean;
  filename?: string;
  maxLongEdge?: number;
  maxFileBytes?: number;
  jpegQuality?: number;
};

export type NormalizeForUploadResult = {
  dataUrl: string;
  filename: string;
  mime: string;
  normalized: boolean;
  width?: number;
  height?: number;
  originalBytes: number;
  preparedBytes: number;
};

export const UPLOAD_NORMALIZE_MAX_LONG_EDGE = 2048;
export const UPLOAD_NORMALIZE_MAX_FILE_BYTES = 5 * 1024 * 1024;
export const UPLOAD_NORMALIZE_JPEG_QUALITY = 0.9;

/** Progressive sizes for first-pass normalize and upload-failure retries. */
export const UPLOAD_NORMALIZE_LADDER: Array<{ maxLongEdge: number; jpegQuality: number }> = [
  { maxLongEdge: 2048, jpegQuality: 0.9 },
  { maxLongEdge: 1536, jpegQuality: 0.85 },
  { maxLongEdge: 1024, jpegQuality: 0.8 },
  { maxLongEdge: 800, jpegQuality: 0.8 },
  { maxLongEdge: 512, jpegQuality: 0.75 },
];

const LADDER = UPLOAD_NORMALIZE_LADDER;

const RASTER_FORCE_JPEG = /^image\/(?:bmp|x-ms-bmp|tiff|tif|heic|heif)$/i;
const KEEP_ALPHA_MIME = /^image\/(?:png|webp)$/i;
const SKIP_MIME = /^image\/(?:gif|svg\+xml)$/i;

export function parseDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const match = dataUrl.trim().match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return null;
  return {
    mime: match[1].trim().toLowerCase(),
    base64: match[2].replace(/\s+/g, ""),
  };
}

export function dataUrlByteLength(dataUrl: string): number {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return Math.max(0, Math.floor((dataUrl.length * 3) / 4));
  const padding = parsed.base64.endsWith("==") ? 2 : parsed.base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((parsed.base64.length * 3) / 4) - padding);
}

export function filenameWithExtension(filename: string, extension: string): string {
  const trimmed = filename.trim() || `upload.${extension}`;
  if (/\.[a-z0-9]{1,8}$/i.test(trimmed)) {
    return trimmed.replace(/\.[a-z0-9]{1,8}$/i, `.${extension}`);
  }
  return `${trimmed}.${extension}`;
}

export function computeUploadScale(width: number, height: number, maxLongEdge: number): number {
  const maxDim = Math.max(width, height);
  if (!Number.isFinite(maxDim) || maxDim <= 0) return 1;
  if (maxDim <= maxLongEdge) return 1;
  return maxLongEdge / maxDim;
}

export function resolveUploadOutputMime(inputMime: string, purpose: ImageUploadPurpose): string {
  const mime = inputMime.trim().toLowerCase();
  if (purpose === "product" && KEEP_ALPHA_MIME.test(mime)) return mime === "image/webp" ? "image/webp" : "image/png";
  if (RASTER_FORCE_JPEG.test(mime)) return "image/jpeg";
  if (mime === "image/png" && purpose === "reference") return "image/jpeg";
  if (mime === "image/webp" && purpose === "reference") return "image/jpeg";
  if (mime === "image/jpeg" || mime === "image/jpg") return "image/jpeg";
  if (KEEP_ALPHA_MIME.test(mime)) return mime === "image/webp" ? "image/webp" : "image/png";
  return "image/jpeg";
}

export function shouldSkipUploadNormalize(options: NormalizeForUploadOptions = {}): boolean {
  if (options.preserveOriginal === true) return true;
  if ((options.purpose || "reference") === "original") return true;
  return false;
}

function extensionForMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

function canvasToDataUrl(canvas: HTMLCanvasElement, mime: string, quality: number): string {
  if (mime === "image/jpeg" || mime === "image/webp") {
    return canvas.toDataURL(mime, quality);
  }
  return canvas.toDataURL(mime);
}

async function decodeDataUrl(dataUrl: string): Promise<{ bitmap: ImageBitmap; width: number; height: number }> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error("invalid_data_url");
  const binary = atob(parsed.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: parsed.mime });
  if (typeof createImageBitmap !== "function") {
    throw new Error("createImageBitmap_unavailable");
  }
  const bitmap = await createImageBitmap(blob);
  return {
    bitmap,
    width: bitmap.width,
    height: bitmap.height,
  };
}

function drawScaled(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  outputMime: string,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas_2d_unavailable");
  if (outputMime === "image/jpeg") {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

/**
 * Normalize a data:image URL for durable HTTPS upload.
 * Best-effort: on decode failure returns the original payload unchanged.
 */
export async function normalizeDataUrlForUpload(
  dataUrl: string,
  options: NormalizeForUploadOptions = {},
): Promise<NormalizeForUploadResult> {
  const input = dataUrl.trim();
  const parsed = parseDataUrl(input);
  const originalBytes = dataUrlByteLength(input);
  const filename = (options.filename || "upload").trim() || "upload";
  const purpose = options.purpose || "reference";

  const passthrough = (mime: string, normalized: boolean): NormalizeForUploadResult => ({
    dataUrl: input,
    filename,
    mime,
    normalized,
    originalBytes,
    preparedBytes: originalBytes,
  });

  if (!parsed || !parsed.mime.startsWith("image/")) {
    return passthrough(parsed?.mime || "application/octet-stream", false);
  }
  if (shouldSkipUploadNormalize(options) || SKIP_MIME.test(parsed.mime)) {
    return passthrough(parsed.mime, false);
  }
  if (typeof document === "undefined" || typeof createImageBitmap !== "function") {
    return passthrough(parsed.mime, false);
  }

  let bitmap: ImageBitmap | undefined;
  try {
    const decoded = await decodeDataUrl(input);
    bitmap = decoded.bitmap;
    const maxFileBytes = options.maxFileBytes ?? UPLOAD_NORMALIZE_MAX_FILE_BYTES;
    const baseLongEdge = options.maxLongEdge ?? UPLOAD_NORMALIZE_MAX_LONG_EDGE;
    const baseQuality = options.jpegQuality ?? UPLOAD_NORMALIZE_JPEG_QUALITY;
    const outputMime = resolveUploadOutputMime(parsed.mime, purpose);

    const attempts = [
      { maxLongEdge: baseLongEdge, jpegQuality: baseQuality },
      ...LADDER.filter((step) => step.maxLongEdge < baseLongEdge),
    ];

    let best: NormalizeForUploadResult | null = null;
    for (const step of attempts) {
      const scale = computeUploadScale(decoded.width, decoded.height, step.maxLongEdge);
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      const canvas = drawScaled(bitmap, width, height, outputMime);
      const nextDataUrl = canvasToDataUrl(canvas, outputMime, step.jpegQuality);
      if (!nextDataUrl.startsWith("data:image/")) continue;
      const preparedBytes = dataUrlByteLength(nextDataUrl);
      const candidate: NormalizeForUploadResult = {
        dataUrl: nextDataUrl,
        filename: filenameWithExtension(filename, extensionForMime(outputMime)),
        mime: outputMime,
        normalized: true,
        width,
        height,
        originalBytes,
        preparedBytes,
      };
      best = candidate;
      if (preparedBytes <= maxFileBytes) break;
    }

    if (!best) return passthrough(parsed.mime, false);
    // Always return a redrawn raster when decode succeeded. Passthrough of the
    // original JPEG/PNG has caused intermittent /upload/file 500s for some
    // camera exports even when dimensions/bytes were already under the cap.
    return best;
  } catch {
    return passthrough(parsed.mime, false);
  } finally {
    bitmap?.close();
  }
}
