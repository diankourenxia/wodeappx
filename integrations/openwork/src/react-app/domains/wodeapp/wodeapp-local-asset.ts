const LOCAL_ASSET_URL_RE = /^wodeappx-asset:\/\//i;
const LOCAL_ASSET_MAX_BYTES = 50 * 1024 * 1024;

function inferMimeType(url: string): string | undefined {
  const extension = url.match(/\.([a-z0-9]+)(?:[?#]|$)/i)?.[1]?.toLowerCase();
  if (!extension) return undefined;
  const mimeByExtension: Record<string, string> = {
    avif: "image/avif",
    bmp: "image/bmp",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    png: "image/png",
    svg: "image/svg+xml",
    webp: "image/webp",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
  };
  return mimeByExtension[extension];
}

function concreteMimeType(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed || trimmed.endsWith("/*")) return undefined;
  return trimmed;
}

function readBlobAsDataUrl(blob: Blob, mimeType: string, filename: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Failed to read local asset: ${filename}`));
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(new Blob([blob], { type: mimeType }));
  });
}

export function isWodeAppLocalAssetUrl(value: string | undefined): boolean {
  return Boolean(value && LOCAL_ASSET_URL_RE.test(value.trim()));
}

export function isLikelyImageAssetUrl(value: string, fallbackMimeType?: string): boolean {
  const mimeType = concreteMimeType(fallbackMimeType);
  if (mimeType) return mimeType.startsWith("image/");
  const extension = value.match(/\.([a-z0-9]+)(?:[?#]|$)/i)?.[1]?.toLowerCase();
  if (extension) return /^(avif|bmp|gif|jpe?g|png|svg|webp)$/.test(extension);
  return fallbackMimeType?.trim() === "image/*";
}

/**
 * Electron 的本地素材协议只在桌面端存在，不能直接交给远程服务或模型。
 * 读取前严格限制为该协议，并限制大小，避免把任意 URL 当成本地文件读取。
 */
export async function readWodeAppLocalAssetAsDataUrl(
  url: string,
  fallbackMimeType?: string,
  filename = "local asset",
): Promise<string> {
  const trimmed = url.trim();
  if (!isWodeAppLocalAssetUrl(trimmed)) {
    throw new Error(`Unsupported local asset URL: ${trimmed}`);
  }

  const response = await fetch(trimmed);
  if (!response.ok) {
    throw new Error(`Failed to read local asset (${response.status}): ${filename}`);
  }

  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > LOCAL_ASSET_MAX_BYTES) {
    throw new Error(`本地素材太大（${(declaredLength / 1024 / 1024).toFixed(1)}MB）：${filename}`);
  }

  const blob = await response.blob();
  if (blob.size > LOCAL_ASSET_MAX_BYTES) {
    throw new Error(`本地素材太大（${(blob.size / 1024 / 1024).toFixed(1)}MB）：${filename}`);
  }
  if (!blob.size) throw new Error(`Local asset is empty: ${filename}`);

  const mimeType = concreteMimeType(fallbackMimeType) || blob.type || inferMimeType(trimmed) || "application/octet-stream";
  return readBlobAsDataUrl(blob, mimeType, filename);
}
