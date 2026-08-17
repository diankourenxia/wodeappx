import type { ComposerAttachment } from "@/app/types";

import { isComposerImageAttachment } from "./wodeapp-attachment-intelligence";
import { readComposerAttachmentDataUrl } from "./wodeapp-chat-asset-sync";
import { readDesktopLocalPathAsDataUrl, desktopLocalPathStat, desktopLocalFilePath } from "./desktop-local-file";
import { requestWodeAppRuntimeJson } from "@/app/lib/wodeapp-auth";
import { persistAttachmentContext } from "./wodeapp-attachment-context-store";
import {
  normalizeDataUrlForUpload,
  UPLOAD_NORMALIZE_LADDER,
  type ImageUploadPurpose,
} from "./wodeapp-image-normalize-for-upload";

const MAX_REGISTRY_ENTRIES = 96;
const MAX_HTTPS_CACHE_ENTRIES = 256;

export type ProductImageMaterializeSource = "https" | "local" | "already-https" | "already-local" | "failed";

export type ProductImageUploadOptions = {
  purpose?: ImageUploadPurpose;
  preserveOriginal?: boolean;
};

export type ProductImageMaterializeDeps = {
  uploadHttps?: (
    dataUrl: string,
    filename: string,
    options?: ProductImageUploadOptions,
  ) => Promise<string | null>;
  persistLocal?: (dataUrl: string, filename: string) => Promise<string | null>;
};

export type SessionProductImageRecord = {
  imageId: string;
  sessionId: string;
  contentKey: string;
  filename: string;
  basename: string;
  dataUrl?: string;
  localPath?: string;
  httpsUrl?: string;
  registeredAt: number;
};

type RegistryEntry = SessionProductImageRecord;

type HttpsCacheEntry = {
  sessionId: string;
  identityKey: string;
  httpsUrl: string;
  registeredAt: number;
};

const registry: RegistryEntry[] = [];
/** Session-scoped identity → HTTPS; shared by send-time materialize and later image_asset_save. */
const httpsCache: HttpsCacheEntry[] = [];
/** Current image-bearing user turn. Historical entries remain available for explicit lookup only. */
const currentTurnBasenames = new Map<string, Set<string>>();
const currentTurnImageIds = new Map<string, Set<string>>();
const currentTurnHttpsUrls = new Map<string, Set<string>>();
const nextImageSeqBySession = new Map<string, number>();

function formatImageId(seq: number): string {
  return `img_${String(seq).padStart(2, "0")}`;
}

function nextSessionImageId(sessionId: string): string {
  let max = nextImageSeqBySession.get(sessionId) || 0;
  for (const entry of registry) {
    if (entry.sessionId !== sessionId) continue;
    const match = /^img_(\d+)$/i.exec(entry.imageId);
    if (match) max = Math.max(max, Number(match[1]) || 0);
  }
  const seq = max + 1;
  nextImageSeqBySession.set(sessionId, seq);
  return formatImageId(seq);
}

function desktopAssetsBridge() {
  const bridge = (typeof window !== "undefined"
    ? (window as unknown as {
      __OPENWORK_ELECTRON__?: {
        wodeappAssets?: { invoke: (action: string, payload?: unknown) => Promise<unknown> };
      };
    }).__OPENWORK_ELECTRON__
    : undefined);
  return bridge?.wodeappAssets ?? null;
}

export function normalizeProductImageFilename(name: string): string {
  return name.trim().replace(/^.*[\\/]/, "").toLowerCase();
}

/**
 * Session-scoped pixel cache filled at send time (no prompt text change).
 * Lets product_save resolve bare filenames / wodeapp://attachment refs after vision-direct.
 */
export function registerSessionProductImagePixels(input: {
  sessionId: string;
  images: Array<{ filename: string; dataUrl: string }>;
  includeInCurrentTurn?: boolean;
}): number {
  const sessionId = input.sessionId.trim();
  if (!sessionId) return 0;
  let added = 0;
  for (const image of input.images) {
    const filename = image.filename.trim();
    const dataUrl = image.dataUrl.trim();
    if (!filename || !dataUrl.startsWith("data:image/")) continue;
    const basename = normalizeProductImageFilename(filename);
    const contentKey = fingerprintDataUrl(dataUrl);
    const byContent = registry.findIndex(
      (entry) => entry.sessionId === sessionId && entry.contentKey === contentKey,
    );
    const existingIndex = byContent >= 0
      ? byContent
      : registry.findIndex((entry) => entry.sessionId === sessionId && entry.basename === basename);
    const imageId = existingIndex >= 0
      ? registry[existingIndex]!.imageId
      : nextSessionImageId(sessionId);
    if (input.includeInCurrentTurn !== false) {
      const current = currentTurnBasenames.get(sessionId) ?? new Set<string>();
      current.add(basename);
      currentTurnBasenames.set(sessionId, current);
      const turnIds = currentTurnImageIds.get(sessionId) ?? new Set<string>();
      turnIds.add(imageId);
      currentTurnImageIds.set(sessionId, turnIds);
    }
    const prev = existingIndex >= 0 ? registry[existingIndex] : undefined;
    const next: RegistryEntry = {
      imageId,
      sessionId,
      contentKey,
      filename,
      basename,
      dataUrl,
      localPath: prev?.localPath,
      httpsUrl: prev?.httpsUrl,
      registeredAt: Date.now(),
    };
    if (existingIndex >= 0) registry[existingIndex] = next;
    else {
      registry.push(next);
      added += 1;
    }
  }
  while (registry.length > MAX_REGISTRY_ENTRIES) registry.shift();
  return added;
}

/** Start a new image-bearing user turn without discarding reusable pixel/HTTPS caches. */
export function beginSessionProductImageTurn(sessionId: string): void {
  const scope = sessionId.trim();
  if (!scope) return;
  currentTurnBasenames.set(scope, new Set());
  currentTurnImageIds.set(scope, new Set());
  currentTurnHttpsUrls.set(scope, new Set());
}

/** Clear current-turn candidate set. Prefer beginSessionProductImageTurn on new uploads; do not clear merely because a save succeeded. */
export function clearCurrentSessionProductImageTurn(sessionId: string): void {
  const scope = sessionId.trim();
  if (!scope) return;
  currentTurnBasenames.delete(scope);
  currentTurnImageIds.delete(scope);
  currentTurnHttpsUrls.delete(scope);
}

export function clearRegisteredProductImagePixels(sessionId?: string): void {
  const scope = sessionId?.trim();
  if (!scope) {
    registry.length = 0;
    clearSessionHttpsImageCache();
    currentTurnBasenames.clear();
    currentTurnImageIds.clear();
    currentTurnHttpsUrls.clear();
    nextImageSeqBySession.clear();
    return;
  }
  for (let index = registry.length - 1; index >= 0; index -= 1) {
    if (registry[index]?.sessionId === scope) registry.splice(index, 1);
  }
  clearSessionHttpsImageCache(scope);
  clearCurrentSessionProductImageTurn(scope);
}

/** Distinct chat-upload image filenames registered for this session (send-time pixel cache). */
export function listRegisteredSessionProductImages(sessionId: string): Array<{
  filename: string;
  basename: string;
}> {
  const scope = sessionId.trim();
  if (!scope) return [];
  const current = currentTurnBasenames.get(scope);
  if (!current?.size) return [];
  const seen = new Set<string>();
  const out: Array<{ filename: string; basename: string }> = [];
  for (const entry of registry) {
    if (entry.sessionId !== scope) continue;
    if (!current.has(entry.basename)) continue;
    if (seen.has(entry.basename)) continue;
    seen.add(entry.basename);
    out.push({ filename: entry.filename, basename: entry.basename });
  }
  return out;
}


export type SessionProductImageCandidate = {
  imageId: string;
  filename: string;
  localPath?: string;
  httpsUrl?: string;
};

/** Current-turn chat upload candidates for selectedImageIds (any shelf). */
export function listCurrentSessionProductImageCandidates(sessionId: string): SessionProductImageCandidate[] {
  const scope = sessionId.trim();
  if (!scope) return [];
  const turnIds = currentTurnImageIds.get(scope);
  if (!turnIds?.size) return [];
  const out: SessionProductImageCandidate[] = [];
  const seen = new Set<string>();
  for (const entry of registry) {
    if (entry.sessionId !== scope) continue;
    if (!turnIds.has(entry.imageId)) continue;
    if (seen.has(entry.imageId)) continue;
    seen.add(entry.imageId);
    out.push({
      imageId: entry.imageId,
      filename: entry.filename,
      localPath: entry.localPath,
      httpsUrl: entry.httpsUrl,
    });
  }
  out.sort((a, b) => a.imageId.localeCompare(b.imageId));
  return out;
}

export const listSessionProductImageCandidates = listCurrentSessionProductImageCandidates;

/**
 * Resolve session image IDs.
 * Prefer current-turn candidates; also allow previously registered session images that still
 * hold HTTPS/local/pixels so a successful save does not invalidate later binds.
 */
export function resolveSessionProductImageIds(
  sessionId: string,
  imageIds: readonly string[],
): { refs: string[]; missing: string[]; records: SessionProductImageRecord[] } {
  const scope = sessionId.trim();
  const turnIds = currentTurnImageIds.get(scope);
  const refs: string[] = [];
  const missing: string[] = [];
  const records: SessionProductImageRecord[] = [];
  for (const rawId of imageIds) {
    const imageId = String(rawId || "").trim();
    if (!imageId) continue;
    const entry = registry.find((item) => item.sessionId === scope && item.imageId === imageId);
    if (!entry) {
      missing.push(imageId);
      continue;
    }
    const inTurn = Boolean(turnIds?.has(imageId));
    const reusable = Boolean(
      (entry.httpsUrl && /^https:\/\//i.test(entry.httpsUrl))
      || entry.localPath
      || entry.dataUrl,
    );
    if (!inTurn && !reusable) {
      missing.push(imageId);
      continue;
    }
    records.push(entry);
    if (entry.httpsUrl && /^https:\/\//i.test(entry.httpsUrl)) refs.push(entry.httpsUrl);
    else if (entry.localPath) refs.push(entry.localPath);
    else refs.push(`wodeapp://session-image/${entry.imageId}`);
  }
  return { refs, missing, records };
}

export type ResolveAndMaterializeSessionImagesResult =
  | {
    ok: true;
    selectedImageIds: string[];
    urls: string[];
    httpsCount: number;
    records: SessionProductImageRecord[];
  }
  | {
    ok: false;
    code: "UNKNOWN_IMAGE_ID" | "NEED_USER_SELECT" | "UPLOAD_OR_PERSIST_FAILED" | "invalid_input";
    error: string;
    missingImageIds?: string[];
    failed?: string[];
    candidates?: SessionProductImageCandidate[];
  };

/**
 * Shared path for product_save / image_asset_save:
 * selectedImageIds → resolve session refs → upload/persist → remember HTTPS on IDs.
 */
export async function resolveAndMaterializeSessionImages(input: {
  sessionId: string;
  selectedImageIds?: readonly string[];
  /** When selectedImageIds empty, auto-use all current-turn candidates if ≤ maxImages. */
  autoSelectFromCurrentTurn?: boolean;
  maxImages?: number;
  deps?: ProductImageMaterializeDeps;
}): Promise<ResolveAndMaterializeSessionImagesResult> {
  const sessionId = input.sessionId.trim();
  const maxImages = Math.max(1, Math.min(12, input.maxImages ?? 12));
  if (!sessionId) {
    return { ok: false, code: "invalid_input", error: "selectedImageIds 需要当前会话上下文。" };
  }

  let selectedImageIds = [...(input.selectedImageIds || [])]
    .map((id) => String(id || "").trim())
    .filter(Boolean);
  const candidates = listCurrentSessionProductImageCandidates(sessionId);

  if (!selectedImageIds.length && input.autoSelectFromCurrentTurn !== false) {
    if (candidates.length > maxImages) {
      return {
        ok: false,
        code: "NEED_USER_SELECT",
        error: `本轮有 ${candidates.length} 张候选图，超过 ${maxImages} 张上限。请只问用户一次，选最多 ${maxImages} 张后传 selectedImageIds。`,
        candidates,
      };
    }
    selectedImageIds = candidates.map((item) => item.imageId);
  }

  if (!selectedImageIds.length) {
    return { ok: false, code: "invalid_input", error: "selectedImageIds 为空，且本轮没有可自动选用的候选图。" };
  }
  if (selectedImageIds.length > maxImages) {
    return {
      ok: false,
      code: "NEED_USER_SELECT",
      error: `selectedImageIds 有 ${selectedImageIds.length} 张，超过 ${maxImages} 张上限。`,
      candidates,
    };
  }

  const resolved = resolveSessionProductImageIds(sessionId, selectedImageIds);
  if (resolved.missing.length) {
    return {
      ok: false,
      code: "UNKNOWN_IMAGE_ID",
      error: `有未知图片 ID：${resolved.missing.join(", ")}。请只用 candidateImages 里的 id。`,
      missingImageIds: resolved.missing,
      candidates,
    };
  }

  const materialized = await materializeProductImageUrls(resolved.refs, {
    sessionId,
    deps: input.deps,
  });
  if (materialized.failed.length || materialized.urls.length !== resolved.refs.length) {
    return {
      ok: false,
      code: "UPLOAD_OR_PERSIST_FAILED",
      error: `有 ${materialized.failed.length || resolved.refs.length} 张图无法落成可用地址。`,
      failed: materialized.failed,
    };
  }

  for (let index = 0; index < selectedImageIds.length; index += 1) {
    const imageId = selectedImageIds[index];
    const url = materialized.urls[index];
    if (imageId && url && /^https:\/\//i.test(url)) {
      rememberHttpsOnSessionProductImage(sessionId, imageId, url);
    }
  }

  return {
    ok: true,
    selectedImageIds,
    urls: materialized.urls,
    httpsCount: materialized.httpsCount,
    records: resolved.records,
  };
}

export function attachLocalPathToSessionProductImages(
  sessionId: string,
  pathByFilename: Map<string, string>,
): void {
  const scope = sessionId.trim();
  if (!scope) return;
  for (const entry of registry) {
    if (entry.sessionId !== scope) continue;
    const path = pathByFilename.get(entry.filename) || pathByFilename.get(entry.basename);
    if (path) entry.localPath = path;
  }
}

export function rememberHttpsOnSessionProductImage(
  sessionId: string,
  imageId: string,
  httpsUrl: string,
): void {
  const scope = sessionId.trim();
  const url = httpsUrl.trim();
  if (!scope || !imageId || !/^https:\/\//i.test(url)) return;
  const entry = registry.find((item) => item.sessionId === scope && item.imageId === imageId);
  if (entry) entry.httpsUrl = url;
}

/** Distinct HTTPS product/ref URLs remembered for this session. */
export function listSessionHttpsProductImageUrls(sessionId: string): string[] {
  const scope = sessionId.trim();
  if (!scope) return [];
  const current = currentTurnHttpsUrls.get(scope);
  if (!current?.size) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of httpsCache) {
    if (entry.sessionId !== scope) continue;
    const url = entry.httpsUrl.trim();
    if (!current.has(url)) continue;
    if (!/^https:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

/** Persist attachment-intelligence / batch upload HTTPS URLs for later product_save expansion. */
export function rememberSessionProductImageUploads(input: {
  sessionId: string;
  uploads: Array<{ filename?: string; url: string }>;
}): number {
  const sessionId = input.sessionId.trim();
  if (!sessionId) return 0;
  let added = 0;
  for (const upload of input.uploads) {
    const url = String(upload.url || "").trim();
    if (!/^https:\/\//i.test(url)) continue;
    const filename = String(upload.filename || "").trim();
    const before = httpsCache.length;
    rememberSessionHttpsImageUrl({
      sessionId,
      identityOrRef: filename || url,
      httpsUrl: url,
      alsoRefs: filename ? [url] : undefined,
    });
    if (httpsCache.length > before || lookupSessionHttpsImageUrl(filename || url, sessionId) === url) {
      added += 1;
    }
  }
  return added;
}

function pruneHttpsCache(): void {
  while (httpsCache.length > MAX_HTTPS_CACHE_ENTRIES) httpsCache.shift();
}

/** Remember a durable HTTPS URL under one or more identity keys for this chat session. */
export function rememberSessionHttpsImageUrl(input: {
  sessionId: string;
  identityOrRef: string;
  httpsUrl: string;
  alsoRefs?: readonly string[];
}): void {
  const sessionId = input.sessionId.trim();
  const httpsUrl = input.httpsUrl.trim();
  if (!sessionId || !/^https:\/\//i.test(httpsUrl)) return;
  const current = currentTurnHttpsUrls.get(sessionId) ?? new Set<string>();
  current.add(httpsUrl);
  currentTurnHttpsUrls.set(sessionId, current);
  const refs = [input.identityOrRef, ...(input.alsoRefs || [])];
  for (const ref of refs) {
    const identityKey = productImageIdentityKey(ref);
    if (!identityKey) continue;
    const existingIndex = httpsCache.findIndex(
      (entry) => entry.sessionId === sessionId && entry.identityKey === identityKey,
    );
    const next: HttpsCacheEntry = {
      sessionId,
      identityKey,
      httpsUrl,
      registeredAt: Date.now(),
    };
    if (existingIndex >= 0) httpsCache[existingIndex] = next;
    else httpsCache.push(next);
  }
  pruneHttpsCache();
}

export function lookupSessionHttpsImageUrl(
  identityOrRef: string,
  sessionId?: string,
): string | null {
  const identityKey = productImageIdentityKey(identityOrRef);
  if (!identityKey) return null;
  const scope = sessionId?.trim();
  if (scope) {
    const scoped = [...httpsCache].reverse().find(
      (entry) => entry.sessionId === scope && entry.identityKey === identityKey,
    );
    return scoped?.httpsUrl || null;
  }
  const any = [...httpsCache].reverse().find((entry) => entry.identityKey === identityKey);
  return any?.httpsUrl || null;
}

export function clearSessionHttpsImageCache(sessionId?: string): void {
  const scope = sessionId?.trim();
  if (!scope) {
    httpsCache.length = 0;
    return;
  }
  for (let index = httpsCache.length - 1; index >= 0; index -= 1) {
    if (httpsCache[index]?.sessionId === scope) httpsCache.splice(index, 1);
  }
}

export function lookupRegisteredProductImageDataUrl(
  filenameOrRef: string,
  sessionId?: string,
): string | null {
  const basename = normalizeProductImageFilename(filenameOrRef);
  if (!basename) return null;
  const scope = sessionId?.trim();
  if (scope) {
    const scoped = [...registry].reverse().find(
      (entry) => entry.sessionId === scope && entry.basename === basename,
    );
    return scoped?.dataUrl || null;
  }
  const any = [...registry].reverse().find((entry) => entry.basename === basename);
  return any?.dataUrl || null;
}

/** Extract bare filename from ephemeral attachment refs. */
export function extractProductImageLookupName(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const attachment = value.match(/^wodeapp:\/\/attachment\/(.+)$/i);
  if (attachment?.[1]) {
    try {
      return decodeURIComponent(attachment[1]).trim() || null;
    } catch {
      return attachment[1].trim() || null;
    }
  }
  // session-image refs are resolved by imageId, not filename.
  if (/^wodeapp:\/\/session-image\//i.test(value)) return null;
  if (/^data:/i.test(value) || /^https?:\/\//i.test(value) || value.startsWith("wodeappx-asset://")) {
    return null;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  return value;
}

function lookupSessionProductImageById(
  sessionId: string | undefined,
  imageId: string,
): RegistryEntry | null {
  const scope = sessionId?.trim();
  const id = imageId.trim();
  if (!scope || !id) return null;
  return registry.find((entry) => entry.sessionId === scope && entry.imageId === id) || null;
}

async function resolveDataUrlFromRegistryEntry(
  entry: RegistryEntry,
): Promise<{ dataUrl: string; filename: string } | null> {
  if (entry.dataUrl?.startsWith("data:image/")) {
    return { dataUrl: entry.dataUrl, filename: entry.filename };
  }
  if (entry.localPath) {
    const filename = entry.filename
      || entry.localPath.replace(/^.*[\\/]/, "")
      || "product-image.png";
    const mime = guessImageMimeFromFilename(filename) || "image/jpeg";
    const rawDataUrl = await readDesktopLocalPathAsDataUrl(entry.localPath, mime);
    const dataUrl = rawDataUrl ? coerceLocalImageDataUrl(rawDataUrl, filename) : null;
    if (dataUrl) return { dataUrl, filename };
  }
  return null;
}

async function resolveDataUrlForRef(
  raw: string,
  sessionId?: string,
): Promise<{ dataUrl: string; filename: string } | null> {
  const value = raw.trim();
  if (value.startsWith("data:image/")) {
    return { dataUrl: value, filename: "product-image.png" };
  }

  const sessionImage = value.match(/^wodeapp:\/\/session-image\/([^/?#]+)$/i);
  if (sessionImage?.[1]) {
    let imageId = sessionImage[1].trim();
    try {
      imageId = decodeURIComponent(imageId).trim();
    } catch {
      // keep raw segment
    }
    const entry = lookupSessionProductImageById(sessionId, imageId);
    if (!entry) return null;
    return resolveDataUrlFromRegistryEntry(entry);
  }

  const localPath = normalizeLocalFilesystemImagePath(value);
  if (localPath) {
    const filename = localPath.replace(/^.*[\\/]/, "") || "product-image.png";
    const mime = guessImageMimeFromFilename(filename) || "image/jpeg";
    const rawDataUrl = await readDesktopLocalPathAsDataUrl(localPath, mime);
    const dataUrl = rawDataUrl ? coerceLocalImageDataUrl(rawDataUrl, filename) : null;
    if (dataUrl) {
      return { dataUrl, filename };
    }
  }
  const lookupName = extractProductImageLookupName(value);
  if (!lookupName) return null;
  const dataUrl = lookupRegisteredProductImageDataUrl(lookupName, sessionId);
  if (!dataUrl) return null;
  return { dataUrl, filename: lookupName };
}

/** Cheap content fingerprint for data URLs (length + head/tail of base64 payload). */
function fingerprintDataUrl(dataUrl: string): string {
  const match = dataUrl.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) return `data:${dataUrl.length}:${dataUrl.slice(5, 37)}`;
  const mime = (match[1] || "").toLowerCase();
  const payload = match[2].replace(/\s+/g, "");
  return `bytes:${mime}:${payload.length}:${payload.slice(0, 24)}:${payload.slice(-12)}`;
}

/** Stable identity for dedupe / productImages↔sourceProductImages matching / HTTPS reuse. */
export function productImageIdentityKey(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (/^https:\/\//i.test(value)) return `https:${value}`;
  const sessionImage = value.match(/^wodeapp:\/\/session-image\/([^/?#]+)$/i);
  if (sessionImage?.[1]) {
    let imageId = sessionImage[1].trim();
    try {
      imageId = decodeURIComponent(imageId).trim();
    } catch {
      // keep raw
    }
    return imageId ? `session-image:${imageId}` : "";
  }
  const localPath = normalizeLocalFilesystemImagePath(value);
  if (localPath) {
    // Include size+mtime so overwriting the same path (PS re-export, same-name
    // replace) does not reuse a stale session HTTPS URL. Falls back to path-only
    // when stat is unavailable (plain browser / missing file).
    const st = desktopLocalPathStat(localPath);
    if (st) return `path:${localPath}:${st.size}:${Math.floor(st.mtimeMs)}`;
    return `path:${localPath}`;
  }
  if (/^data:(image|application)\//i.test(value)) return fingerprintDataUrl(value);
  const lookup = extractProductImageLookupName(value);
  if (lookup) return `name:${normalizeProductImageFilename(lookup)}`;
  return `url:${value}`;
}

export function sameProductImageIdentitySet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const leftKeys = [...new Set(left.map(productImageIdentityKey).filter(Boolean))];
  const rightKeys = [...new Set(right.map(productImageIdentityKey).filter(Boolean))];
  if (leftKeys.length !== rightKeys.length) return false;
  const rightSet = new Set(rightKeys);
  return leftKeys.every((key) => rightSet.has(key));
}

export function isHttpsProductImageUrl(url: string): boolean {
  return /^https:\/\//i.test(url.trim());
}

/** Final product-library URLs: HTTPS cloud asset or an explicit local-only fallback. */
export function isAcceptableProductLibraryImageUrl(url: string): boolean {
  const value = url.trim();
  if (!value) return false;
  if (/^https:\/\//i.test(value)) return true;
  if (value.startsWith("wodeappx-asset://")) return true;
  return false;
}

async function defaultUploadHttps(
  dataUrl: string,
  filename: string,
  options: ProductImageUploadOptions = {},
): Promise<string | null> {
  const purpose = options.purpose || "reference";
  const preserveOriginal = options.preserveOriginal === true;
  const steps = preserveOriginal
    ? [{ maxLongEdge: 0, jpegQuality: 1 }]
    : UPLOAD_NORMALIZE_LADDER;

  let lastError: unknown = null;
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    try {
      const normalized = preserveOriginal
        ? {
          dataUrl,
          filename: filename || "product-image",
          mime: "image/jpeg",
          normalized: false,
          originalBytes: dataUrl.length,
          preparedBytes: dataUrl.length,
        }
        : await normalizeDataUrlForUpload(dataUrl, {
          filename: filename || "product-image",
          purpose,
          preserveOriginal,
          maxLongEdge: step.maxLongEdge,
          jpegQuality: step.jpegQuality,
          // Force smaller payloads on later retries when upstream is flaky.
          maxFileBytes: step.maxLongEdge <= 800 ? 1.5 * 1024 * 1024 : 5 * 1024 * 1024,
        });

      const payload = await requestWodeAppRuntimeJson<{
        success?: boolean;
        data?: { url?: string };
        error?: string;
        detail?: string;
      }>("/upload/file", {
        method: "POST",
        body: JSON.stringify({
          data: normalized.dataUrl,
          filename: normalized.filename || filename || "product-image",
          purpose,
          preserveOriginal,
          // Client already canvas-normalized; server skips re-encode unless preserveOriginal.
          alreadyNormalized: normalized.normalized || preserveOriginal,
        }),
      }, 120000);

      const url = payload.success === true ? payload.data?.url?.trim() || "" : "";
      if (/^https:\/\//i.test(url)) {
        if (index > 0) {
          console.info(
            `[WodeAppX] product image HTTPS upload succeeded on retry #${index} (maxLongEdge=${step.maxLongEdge || "original"})`,
          );
        }
        return url;
      }

      lastError = payload.error || payload.detail || "upload_returned_no_https";
      console.warn("[WodeAppX] product image HTTPS upload rejected", {
        attempt: index + 1,
        maxLongEdge: step.maxLongEdge || null,
        error: lastError,
      });
    } catch (error) {
      lastError = error;
      console.warn("[WodeAppX] product image HTTPS upload failed", {
        attempt: index + 1,
        maxLongEdge: step.maxLongEdge || null,
        error,
      });
    }

    if (preserveOriginal) break;
  }

  if (lastError) {
    console.warn("[WodeAppX] product image HTTPS upload exhausted retries", lastError);
  }
  return null;
}

async function defaultPersistLocal(dataUrl: string, filename: string): Promise<string | null> {
  const bridge = desktopAssetsBridge();
  if (!bridge) return null;
  try {
    const response = await bridge.invoke("persistFiles", {
      files: [{ dataUrl, filename }],
    });
    const record = response && typeof response === "object"
      ? response as { ok?: unknown; urls?: unknown }
      : null;
    if (record?.ok !== true || !Array.isArray(record.urls)) return null;
    const url = typeof record.urls[0] === "string" ? record.urls[0].trim() : "";
    return url.startsWith("wodeappx-asset://") ? url : null;
  } catch (error) {
    console.warn("[WodeAppX] product image local persist failed", error);
    return null;
  }
}

function normalizeLocalFilesystemImagePath(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(value)) return value;
  if (!/^file:\/\//i.test(value)) return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "file:") return null;
    let pathname = decodeURIComponent(parsed.pathname || "");
    // Windows file:///C:/path → /C:/path → C:/path
    if (/^\/[a-zA-Z]:\//.test(pathname)) pathname = pathname.slice(1);
    return pathname || null;
  } catch {
    return null;
  }
}

function guessImageMimeFromFilename(name: string): string | null {
  const ext = (name.split(".").pop() || "").trim().toLowerCase();
  if (!ext) return null;
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "bmp") return "image/bmp";
  if (ext === "heic" || ext === "heif") return "image/heic";
  return null;
}

/** Desktop path bridge may tag bytes as octet-stream; coerce to image/* by filename. */
function coerceLocalImageDataUrl(dataUrl: string, filename: string): string | null {
  const value = dataUrl.trim();
  if (value.startsWith("data:image/")) return value;
  const mime = guessImageMimeFromFilename(filename);
  if (!mime) return null;
  const match = value.match(/^data:[^;,]+;base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match?.[1]) return null;
  return `data:${mime};base64,${match[1].replace(/\s+/g, "")}`;
}

function rememberMaterializedHttps(input: {
  sessionId?: string;
  rawInput: string;
  httpsUrl: string;
  filename?: string;
  dataUrl?: string;
}): void {
  const sessionId = input.sessionId?.trim();
  if (!sessionId || !/^https:\/\//i.test(input.httpsUrl)) return;
  const alsoRefs: string[] = [];
  if (input.filename) alsoRefs.push(input.filename);
  if (input.dataUrl) alsoRefs.push(input.dataUrl);
  const localPath = normalizeLocalFilesystemImagePath(input.rawInput);
  if (localPath) alsoRefs.push(localPath);
  rememberSessionHttpsImageUrl({
    sessionId,
    identityOrRef: input.rawInput,
    httpsUrl: input.httpsUrl,
    alsoRefs,
  });
}

export async function materializeProductImageUrl(
  raw: string,
  options: {
    sessionId?: string;
    deps?: ProductImageMaterializeDeps;
    purpose?: ImageUploadPurpose;
    preserveOriginal?: boolean;
  } = {},
): Promise<{ url: string | null; source: ProductImageMaterializeSource; input: string }> {
  const input = raw.trim();
  if (!input) return { url: null, source: "failed", input };

  if (/^https:\/\//i.test(input)) {
    rememberMaterializedHttps({ sessionId: options.sessionId, rawInput: input, httpsUrl: input });
    return { url: input, source: "already-https", input };
  }
  if (/^http:\/\//i.test(input)) return { url: null, source: "failed", input };
  if (input.startsWith("wodeappx-asset://")) {
    return { url: input, source: "already-local", input };
  }

  const cachedHttps = lookupSessionHttpsImageUrl(input, options.sessionId);
  if (cachedHttps) {
    return { url: cachedHttps, source: "already-https", input };
  }

  const resolved = await resolveDataUrlForRef(input, options.sessionId);
  if (!resolved) return { url: null, source: "failed", input };

  const cachedByPixels = lookupSessionHttpsImageUrl(resolved.dataUrl, options.sessionId)
    || lookupSessionHttpsImageUrl(resolved.filename, options.sessionId);
  if (cachedByPixels) {
    rememberMaterializedHttps({
      sessionId: options.sessionId,
      rawInput: input,
      httpsUrl: cachedByPixels,
      filename: resolved.filename,
      dataUrl: resolved.dataUrl,
    });
    return { url: cachedByPixels, source: "already-https", input };
  }

  const uploadHttps = options.deps?.uploadHttps || defaultUploadHttps;
  const persistLocal = options.deps?.persistLocal || defaultPersistLocal;
  const uploadOptions: ProductImageUploadOptions = {
    purpose: options.purpose || "reference",
    preserveOriginal: options.preserveOriginal === true,
  };

  const httpsUrl = await uploadHttps(resolved.dataUrl, resolved.filename, uploadOptions);
  if (httpsUrl) {
    rememberMaterializedHttps({
      sessionId: options.sessionId,
      rawInput: input,
      httpsUrl,
      filename: resolved.filename,
      dataUrl: resolved.dataUrl,
    });
    return { url: httpsUrl, source: "https", input };
  }

  const localUrl = await persistLocal(resolved.dataUrl, resolved.filename);
  if (localUrl) return { url: localUrl, source: "local", input };

  return { url: null, source: "failed", input };
}

export async function materializeProductImageUrls(
  urls: readonly string[],
  options: {
    sessionId?: string;
    deps?: ProductImageMaterializeDeps;
    purpose?: ImageUploadPurpose;
    preserveOriginal?: boolean;
    /** Shared across productImages + sourceProductImages in one save — avoids double HTTPS upload → URL mismatch. */
    cache?: Map<string, string>;
  } = {},
): Promise<{
  urls: string[];
  failed: string[];
  httpsCount: number;
  localCount: number;
}> {
  const next: string[] = [];
  const failed: string[] = [];
  let httpsCount = 0;
  let localCount = 0;
  const cache = options.cache ?? new Map<string, string>();
  const sessionId = options.sessionId?.trim();

  for (const raw of urls) {
    const input = raw.trim();
    const cacheKey = productImageIdentityKey(input);
    const cached = (cacheKey ? cache.get(cacheKey) : undefined)
      || (sessionId ? lookupSessionHttpsImageUrl(input, sessionId) : null)
      || undefined;
    if (cached && isAcceptableProductLibraryImageUrl(cached)) {
      next.push(cached);
      if (/^https:\/\//i.test(cached)) {
        httpsCount += 1;
        if (sessionId) {
          rememberMaterializedHttps({ sessionId, rawInput: input, httpsUrl: cached });
        }
      } else localCount += 1;
      if (cacheKey) cache.set(cacheKey, cached);
      continue;
    }

    const result = await materializeProductImageUrl(raw, {
      sessionId: options.sessionId,
      deps: options.deps,
      purpose: options.purpose,
      preserveOriginal: options.preserveOriginal,
    });
    if (!result.url || !isAcceptableProductLibraryImageUrl(result.url)) {
      failed.push(result.input);
      continue;
    }
    if (cacheKey) cache.set(cacheKey, result.url);
    next.push(result.url);
    if (result.source === "https" || result.source === "already-https") httpsCount += 1;
    else localCount += 1;
  }

  return { urls: next, failed, httpsCount, localCount };
}

export async function registerComposerAttachmentsForProductSave(
  sessionId: string,
  attachments: ComposerAttachment[],
): Promise<number> {
  const images = attachments.filter(isComposerImageAttachment);
  if (!sessionId.trim() || !images.length) return 0;
  const payloads: Array<{ filename: string; dataUrl: string }> = [];
  for (const attachment of images) {
    try {
      const dataUrl = await readComposerAttachmentDataUrl(attachment);
      if (!dataUrl.startsWith("data:image/")) continue;
      payloads.push({
        filename: attachment.name || `image-${payloads.length + 1}.png`,
        dataUrl,
      });
    } catch (error) {
      console.warn("[WodeAppX] failed to register composer image for product save", error);
    }
  }
  return registerSessionProductImagePixels({ sessionId, images: payloads });
}

/**
 * Send-time materialization for chat attachments (Codex-style durable paths):
 * 1) register image pixels in the session cache
 * 2) write chat files (images + documents) into the attachment context pack
 * Do NOT upload HTTPS here — that happens inside wodeapp_product_save / image_asset_save.
 *
 * Documents without a native File.path still get a durable cache path so local PDF/Office
 * tools can run instead of relying on remote attachment intelligence.
 */
export async function materializeComposerAttachmentsForSend(input: {
  sessionId: string;
  attachments: ComposerAttachment[];
  deps?: ProductImageMaterializeDeps;
}): Promise<{
  contextRefId?: string;
  localPaths: string[];
  pathByFilename: Map<string, string>;
  pathByAttachmentId: Map<string, string>;
  durableProductImageUrls: string[];
  imageCandidates: SessionProductImageCandidate[];
  /** filename → https (preferred) or local file:// for UI cards only — never model type:file */
  displayUrls: Array<{ filename: string; url: string }>;
  registered: number;
}> {
  const empty = {
    localPaths: [] as string[],
    pathByFilename: new Map<string, string>(),
    pathByAttachmentId: new Map<string, string>(),
    durableProductImageUrls: [] as string[],
    imageCandidates: [] as SessionProductImageCandidate[],
    displayUrls: [] as Array<{ filename: string; url: string }>,
    registered: 0,
  };
  if (!input.sessionId.trim() || !input.attachments.length) return empty;

  const images = input.attachments.filter(isComposerImageAttachment);
  const documents = input.attachments.filter((attachment) => !isComposerImageAttachment(attachment));
  if (images.length) beginSessionProductImageTurn(input.sessionId);

  // Keep under Electron context-pack limits (see wodeapp-context-packs.mjs).
  const MAX_MATERIALIZE_FILE_BYTES = 50 * 1024 * 1024;
  const files: Array<{
    attachmentId: string;
    filename: string;
    mime: string;
    dataUrl: string;
  }> = [];
  const pathByFilename = new Map<string, string>();
  const pathByAttachmentId = new Map<string, string>();

  const rememberExistingLocalPath = (attachment: ComposerAttachment, filename: string) => {
    const existing = desktopLocalFilePath(attachment.file)?.trim() || "";
    if (!existing || /^https?:\/\//i.test(existing)) return false;
    let absolute = existing;
    if (/^file:\/\//i.test(existing)) {
      try {
        absolute = decodeURIComponent(new URL(existing).pathname);
      } catch {
        absolute = existing.replace(/^file:\/\//i, "");
      }
    }
    if (!(absolute.startsWith("/") || /^[A-Za-z]:[\\/]/.test(absolute))) return false;
    if (!desktopLocalPathStat(absolute)) return false;
    pathByAttachmentId.set(attachment.id, absolute);
    if (!pathByFilename.has(filename)) pathByFilename.set(filename, absolute);
    return true;
  };

  const pushPackFile = async (attachment: ComposerAttachment, requireImageDataUrl: boolean) => {
    const filename = (attachment.name || attachment.file.name || `attachment-${files.length + 1}`).trim();
    if (!filename) return;
    const mime = (attachment.mimeType || attachment.file.type || "").toLowerCase();
    const isAv = mime.startsWith("video/") || mime.startsWith("audio/")
      || /\.(mp4|mov|webm|mkv|mp3|wav|m4a|aac|flac|ogg)$/i.test(filename);
    // Codex-style: prefer the original absolute path for A/V — never read megabyte
    // media into a data URL just to copy it into the context pack.
    if (isAv && rememberExistingLocalPath(attachment, filename)) return;
    if (attachment.file.size > MAX_MATERIALIZE_FILE_BYTES) {
      rememberExistingLocalPath(attachment, filename);
      return;
    }
    // No File.path (drag/drop blob, hash-named temp): still pack under the size
    // ceiling so UI chips and local tools get a durable path. Never emit A/V as
    // chat type:file — this only writes ~/.wodeappx/attachment-context-packs.
    try {
      const dataUrl = await readComposerAttachmentDataUrl(attachment);
      if (requireImageDataUrl && !dataUrl.startsWith("data:image/")) return;
      if (!dataUrl.startsWith("data:")) return;
      files.push({
        attachmentId: attachment.id,
        filename,
        mime: attachment.mimeType || attachment.file.type || "application/octet-stream",
        dataUrl,
      });
    } catch (error) {
      console.warn("[WodeAppX] failed to read composer attachment for send materialize", {
        filename,
        error,
      });
    }
  };

  for (const attachment of images) {
    await pushPackFile(attachment, true);
  }
  for (const attachment of documents) {
    await pushPackFile(attachment, false);
  }

  const imageFiles = files.filter((file) => file.dataUrl.startsWith("data:image/"));
  const registered = imageFiles.length
    ? registerSessionProductImagePixels({
      sessionId: input.sessionId,
      images: imageFiles.map((file) => ({ filename: file.filename, dataUrl: file.dataUrl })),
    })
    : 0;

  const stored = files.length
    ? await persistAttachmentContext({
      sessionId: input.sessionId,
      context: documents.length
        ? "chat attachment durable paths (images + documents)"
        : "vision-direct attachment paths",
      sources: files.map((file) => ({ label: "对话上传", filename: file.filename })),
      files: files.map(({ filename, mime, dataUrl }) => ({ filename, mime, dataUrl })),
    })
    : null;

  for (let index = 0; index < (stored?.files.length || 0); index += 1) {
    const file = stored!.files[index];
    const packed = files[index];
    const path = file?.path?.trim() || "";
    if (!path || !packed) continue;
    pathByAttachmentId.set(packed.attachmentId, path);
    const originalFilename = file.originalFilename?.trim() || packed.filename;
    if (!pathByFilename.has(originalFilename)) pathByFilename.set(originalFilename, path);
  }

  // Fill gaps only: prefer durable context-pack copies when present. Fall back to a
  // still-valid original absolute path for oversized files that could not be packed.
  for (const attachment of input.attachments) {
    const filename = (attachment.name || attachment.file.name || "").trim();
    if (!filename || pathByFilename.has(filename)) continue;
    const original = desktopLocalFilePath(attachment.file)?.trim() || "";
    if (!original || /^https?:\/\//i.test(original)) continue;
    let absolute = original;
    if (/^file:\/\//i.test(original)) {
      try {
        absolute = decodeURIComponent(new URL(original).pathname);
      } catch {
        absolute = original.replace(/^file:\/\//i, "");
      }
    }
    if (!(absolute.startsWith("/") || /^[A-Za-z]:[\\/]/.test(absolute))) continue;
    if (desktopLocalPathStat(absolute)) {
      pathByAttachmentId.set(attachment.id, absolute);
      if (!pathByFilename.has(filename)) pathByFilename.set(filename, absolute);
    }
  }
  if (images.length) {
    attachLocalPathToSessionProductImages(input.sessionId, pathByFilename);
  }

  const localPaths = [...new Set([
    ...pathByAttachmentId.values(),
    ...pathByFilename.values(),
  ].filter(Boolean))];
  const durableProductImageUrls: string[] = [];
  const displayUrls: Array<{ filename: string; url: string }> = [];
  const pushDisplayUrl = (filename: string, localPath: string) => {
    const name = filename.trim();
    const path = localPath.trim();
    if (!name || !path) return;
    if (displayUrls.some((item) => item.filename === name)) return;
    const normalized = path.replace(/\\/g, "/");
    displayUrls.push({
      filename: name,
      url: `file://${normalized.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`,
    });
  };
  for (const file of imageFiles) {
    const cachedHttps = lookupSessionHttpsImageUrl(file.dataUrl, input.sessionId)
      || lookupSessionHttpsImageUrl(file.filename, input.sessionId);
    let displayUrl = "";
    if (cachedHttps && /^https:\/\//i.test(cachedHttps)) {
      durableProductImageUrls.push(cachedHttps);
      displayUrl = cachedHttps;
    }
    if (!displayUrl) {
      const localPath = pathByAttachmentId.get(file.attachmentId)
        || pathByFilename.get(file.filename.trim())
        || "";
      if (localPath) {
        const normalized = localPath.replace(/\\/g, "/");
        displayUrl = `file://${normalized.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`;
      }
    }
    if (displayUrl) {
      displayUrls.push({ filename: file.filename, url: displayUrl });
    }
  }
  // Documents / video / audio also need openable chips — not only images.
  for (const [attachmentId, localPath] of pathByAttachmentId.entries()) {
    const attachment = input.attachments.find((item) => item.id === attachmentId);
    const filename = (attachment?.name || attachment?.file.name || "").trim();
    pushDisplayUrl(filename, localPath);
  }
  for (const [filename, localPath] of pathByFilename.entries()) {
    pushDisplayUrl(filename, localPath);
  }

  return {
    contextRefId: stored?.refId,
    localPaths,
    pathByFilename,
    pathByAttachmentId,
    durableProductImageUrls: [...new Set(durableProductImageUrls)],
    imageCandidates: images.length ? listCurrentSessionProductImageCandidates(input.sessionId) : [],
    displayUrls,
    registered,
  };
}

/**
 * @deprecated Prefer materializeComposerAttachmentsForSend so documents also get durable paths.
 * Send-time materialization for vision-direct images only.
 */
export async function materializeComposerImagesForSend(input: {
  sessionId: string;
  attachments: ComposerAttachment[];
  deps?: ProductImageMaterializeDeps;
}): Promise<{
  contextRefId?: string;
  localPaths: string[];
  durableProductImageUrls: string[];
  imageCandidates: SessionProductImageCandidate[];
  /** filename → https (preferred) or local file:// for UI cards only — never model type:file */
  displayUrls: Array<{ filename: string; url: string }>;
  registered: number;
}> {
  const result = await materializeComposerAttachmentsForSend({
    sessionId: input.sessionId,
    attachments: input.attachments.filter(isComposerImageAttachment),
    deps: input.deps,
  });
  return {
    contextRefId: result.contextRefId,
    localPaths: result.localPaths,
    durableProductImageUrls: result.durableProductImageUrls,
    imageCandidates: result.imageCandidates,
    displayUrls: result.displayUrls,
    registered: result.registered,
  };
}
