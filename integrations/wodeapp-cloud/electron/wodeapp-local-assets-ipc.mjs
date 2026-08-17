import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { cp, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { app, ipcMain, net, protocol } from "electron";

const IPC_CHANNEL = "wodeapp:assets";
const ASSET_PROTOCOL = "wodeappx-asset";
const ASSET_DIR_NAME = "wodeappx-assets";
const ASSET_FILE_DIR_NAME = "files";
const ASSET_MANIFEST_NAME = "assets.json";
const ALLOWED_DOCUMENT_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "csv",
  "ppt",
  "pptx",
  "txt",
  "md",
  "json",
]);

let registered = false;
let protocolRegistered = false;

function safeAccountScope(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function currentWodeAppAccountScope() {
  const fromEnv = safeAccountScope(process.env.WODEAPP_USER_ID);
  if (fromEnv) return fromEnv;
  try {
    const configPath = path.join(app.getPath("home"), ".wodeapp", "config.json");
    const parsed = JSON.parse(readFileSync(configPath, "utf8"));
    return safeAccountScope(parsed?.user?.id);
  } catch {
    return "";
  }
}

function assetRootDir() {
  const root = path.join(app.getPath("userData"), ASSET_DIR_NAME);
  const accountScope = currentWodeAppAccountScope();
  return accountScope ? path.join(root, "accounts", accountScope) : root;
}

function assetFilesDir() {
  return path.join(assetRootDir(), ASSET_FILE_DIR_NAME);
}

function assetManifestPath() {
  return path.join(assetRootDir(), ASSET_MANIFEST_NAME);
}

function assetRootCandidates() {
  // Legacy roots are machine-global. They are useful only for the old
  // signed-out layout; copying them into a signed-in account would leak local
  // assets from a previous user into a brand-new account.
  if (currentWodeAppAccountScope()) return [];
  const currentRoot = path.resolve(assetRootDir());
  return [
    path.join(app.getPath("appData"), "com.differentai.openwork.dev", ASSET_DIR_NAME),
    path.join(app.getPath("appData"), "@wodeapp", "desktop", ASSET_DIR_NAME),
    path.join(app.getPath("appData"), "@wodeapp", "desktop", "openwork-runtime", ASSET_DIR_NAME),
  ]
    .map((root) => path.resolve(root))
    .filter((root) => root !== currentRoot);
}

function assetFilesDirForRoot(root) {
  return path.join(root, ASSET_FILE_DIR_NAME);
}

function assetManifestPathForRoot(root) {
  return path.join(root, ASSET_MANIFEST_NAME);
}

async function ensureAssetDirs() {
  await mkdir(assetFilesDir(), { recursive: true });
}

function normalizeAssetUrlPath(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return null;
  }
  if (parsed.protocol !== `${ASSET_PROTOCOL}:`) return null;
  const fileName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
  if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) return null;
  const root = path.resolve(assetFilesDir());
  const filePath = path.resolve(root, fileName);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) return null;
  return filePath;
}

function fileNameToAssetUrl(fileName) {
  return `${ASSET_PROTOCOL}://local/${encodeURIComponent(fileName)}`;
}

function mimeToExtension(mime, fallbackName = "") {
  const extensionFromName = String(fallbackName || "").match(/\.([a-zA-Z0-9]{1,8})$/)?.[1]?.toLowerCase();
  if (extensionFromName) return extensionFromName;
  switch (String(mime || "").toLowerCase()) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/avif":
      return "avif";
    case "image/svg+xml":
      return "svg";
    case "video/mp4":
      return "mp4";
    case "video/webm":
      return "webm";
    case "video/quicktime":
      return "mov";
    case "audio/mpeg":
      return "mp3";
    case "audio/mp4":
      return "m4a";
    case "audio/wav":
    case "audio/x-wav":
      return "wav";
    case "audio/webm":
      return "webm";
    case "text/plain":
      return "txt";
    case "text/markdown":
      return "md";
    case "application/pdf":
      return "pdf";
    case "application/msword":
      return "doc";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "docx";
    case "application/vnd.ms-excel":
      return "xls";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return "xlsx";
    case "text/csv":
      return "csv";
    case "application/vnd.ms-powerpoint":
      return "ppt";
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return "pptx";
    case "application/json":
      return "json";
    default:
      return "bin";
  }
}

function dataUrlToFileBuffer(value, fallbackName = "") {
  if (typeof value !== "string") return null;
  const match = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const extension = mimeToExtension(mime, fallbackName);
  const allowed =
    mime.startsWith("image/") ||
    mime.startsWith("video/") ||
    mime.startsWith("audio/") ||
    mime.startsWith("text/") ||
    mime === "application/pdf" ||
    mime.includes("wordprocessingml") ||
    mime.includes("spreadsheetml") ||
    mime.includes("presentationml") ||
    mime === "application/msword" ||
    mime === "application/vnd.ms-excel" ||
    mime === "application/vnd.ms-powerpoint" ||
    mime === "application/json" ||
    ALLOWED_DOCUMENT_EXTENSIONS.has(extension);
  if (!allowed) return null;
  return {
    buffer: Buffer.from(match[2], "base64"),
    extension,
  };
}

async function saveFileValue(value, cache = new Map(), fallbackName = "") {
  if (typeof value !== "string" || !value) return "";
  if (value.startsWith(`${ASSET_PROTOCOL}://`)) return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (cache.has(value)) return cache.get(value);
  const file = dataUrlToFileBuffer(value, fallbackName);
  if (!file) {
    // Bare filenames / wodeapp://attachment refs previously leaked into productImages and 404'd in 商品库.
    return "";
  }
  await ensureAssetDirs();
  const fileName = `${Date.now()}-${randomUUID()}.${file.extension}`;
  await writeFile(path.join(assetFilesDir(), fileName), file.buffer);
  const url = fileNameToAssetUrl(fileName);
  cache.set(value, url);
  return url;
}

async function replaceImageValues(values, cache) {
  if (!Array.isArray(values)) return values;
  const next = [];
  for (const value of values) {
    const saved = await saveFileValue(value, cache);
    if (saved) next.push(saved);
  }
  return next;
}

async function normalizeLocalAsset(asset) {
  if (!asset || typeof asset !== "object") return null;
  if (typeof asset.id !== "string" || !asset.id.startsWith("local-")) return null;
  if (typeof asset.name !== "string" || typeof asset.kind !== "string" || typeof asset.preview !== "string") return null;
  const next = { ...asset };
  const imageCache = new Map();
  if (typeof next.coverImage === "string") {
    next.coverImage = await saveFileValue(next.coverImage, imageCache);
  }
  if (Array.isArray(next.productImages)) {
    next.productImages = await replaceImageValues(next.productImages, imageCache);
  }
  if (Array.isArray(next.assetImages)) {
    next.assetImages = await replaceImageValues(next.assetImages, imageCache);
  }
  if (typeof next.assetFile === "string") {
    next.assetFile = await saveFileValue(next.assetFile, imageCache, next.assetFileName);
  }
  if (Array.isArray(next.assetFiles)) {
    const files = [];
    for (const entry of next.assetFiles) {
      if (!entry || typeof entry !== "object") continue;
      const url = await saveFileValue(entry.url, imageCache, entry.name);
      if (!url) continue;
      files.push({
        ...entry,
        url,
      });
    }
    next.assetFiles = files;
  }
  if (Array.isArray(next.brandAssets)) {
    next.brandAssets = await replaceImageValues(next.brandAssets, imageCache);
  }
  return next;
}

async function readManifestAssetsFromRoot(root) {
  try {
    const raw = await readFile(assetManifestPathForRoot(root), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => item && typeof item.id === "string" && item.id.startsWith("local-"));
  } catch {
    return [];
  }
}

async function migrateLegacyManifestAssets() {
  for (const root of assetRootCandidates()) {
    const assets = await readManifestAssetsFromRoot(root);
    if (!assets.length) continue;
    await ensureAssetDirs();
    await cp(assetFilesDirForRoot(root), assetFilesDir(), {
      recursive: true,
      force: false,
      errorOnExist: false,
    }).catch(() => undefined);
    await writeManifestAssets(assets);
    return assets;
  }
  return [];
}

async function readManifestAssets() {
  const current = await readManifestAssetsFromRoot(assetRootDir());
  if (current.length) return current;
  return migrateLegacyManifestAssets();
}

async function writeManifestAssets(assets) {
  await ensureAssetDirs();
  const target = assetManifestPath();
  const temp = `${target}.tmp`;
  await writeFile(temp, JSON.stringify(assets, null, 2), "utf8");
  await rename(temp, target);
}

const UI_KIND_TO_API_KIND = new Map([
  ["商品库", "product"],
  ["品牌库", "brand"],
  ["提示词", "prompt"],
  ["图片", "image"],
  ["文件", "file"],
  ["视频", "video"],
  ["剧本", "script"],
  ["声音", "audio"],
  ["真人", "role"],
  ["角色库", "role"],
]);

const API_KIND_TO_UI_KIND = new Map([
  ["product", "商品库"],
  ["brand", "品牌库"],
  ["prompt", "提示词"],
  ["image", "图片"],
  ["file", "文件"],
  ["video", "视频"],
  ["script", "剧本"],
  ["audio", "声音"],
  ["role", "真人"],
]);

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function recordValue(value) {
  return isRecord(value) ? value : {};
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstString(...values) {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return "";
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(stringValue).filter(Boolean);
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const text = stringValue(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function apiKindFromLocal(value) {
  const raw = stringValue(value);
  return UI_KIND_TO_API_KIND.get(raw) || (API_KIND_TO_UI_KIND.has(raw) ? raw : "image");
}

function localKindFromApi(value) {
  const raw = stringValue(value);
  return API_KIND_TO_UI_KIND.get(raw) || (UI_KIND_TO_API_KIND.has(raw) ? raw : "图片");
}

function previewForApiKind(kind) {
  switch (kind) {
    case "product":
      return "product";
    case "brand":
      return "brand";
    case "prompt":
      return "prompt";
    case "file":
      return "file";
    case "video":
      return "video";
    case "script":
      return "script";
    case "audio":
      return "audio";
    case "role":
      return "role";
    case "image":
    default:
      return "image";
  }
}

function mediaTypeForUrl(url, fallback = "image") {
  const text = stringValue(url).toLowerCase();
  if (/\.(mp4|webm|mov)(\?|#|$)/.test(text)) return "video";
  if (/\.(mp3|m4a|wav|webm)(\?|#|$)/.test(text)) return "audio";
  if (/\.(pdf|doc|docx|xls|xlsx|csv|ppt|pptx|txt|md|json)(\?|#|$)/.test(text)) return "document";
  return fallback;
}

function mediaRefsFromUrls(urls, role, fallbackMediaType = "image") {
  return uniqueStrings(urls).map((url) => ({
    url,
    role,
    mediaType: mediaTypeForUrl(url, fallbackMediaType),
    storageProvider: url.startsWith(`${ASSET_PROTOCOL}://`) ? "local" : "external",
  }));
}

function localAssetToDigitalAsset(asset) {
  const kind = apiKindFromLocal(asset.kind);
  const productImages = uniqueStrings(asset.productImages || []);
  const assetImages = uniqueStrings(asset.assetImages || []);
  const brandAssets = uniqueStrings(asset.brandAssets || []);
  const coverImage = firstString(asset.coverImage, productImages[0], assetImages[0], brandAssets[0], asset.assetFile);
  const media = [
    ...(coverImage ? mediaRefsFromUrls([coverImage], "cover") : []),
    ...mediaRefsFromUrls(productImages.filter((url) => url !== coverImage), "reference"),
    ...mediaRefsFromUrls(assetImages.filter((url) => url !== coverImage), "reference"),
    ...mediaRefsFromUrls(brandAssets.filter((url) => url !== coverImage), "reference"),
    ...(asset.assetFile ? mediaRefsFromUrls([asset.assetFile], "file", mediaTypeForUrl(asset.assetFile, "document")) : []),
  ];

  return {
    id: asset.id,
    schemaVersion: 1,
    kind,
    name: asset.name,
    summary: asset.meta || "",
    tags: uniqueStrings([...(asset.promptTags || []), asset.promptCategory]),
    media,
    payload: {
      product: kind === "product" ? {
        info: asset.productInfo || "",
        images: productImages,
        refImages: assetImages,
        profile: asset.productProfile,
        productProfile: asset.productProfile,
        supplement: asset.promptText || "",
      } : undefined,
      prompt: kind === "prompt" ? {
        category: asset.promptCategory,
        tags: asset.promptTags,
        text: asset.promptText || "",
      } : undefined,
      brand: kind === "brand" ? {
        colors: asset.brandColors,
        voice: asset.brandVoice,
        rules: asset.brandRules,
        assets: brandAssets,
        entries: asset.brandEntries,
      } : undefined,
      asset: {
        notes: asset.promptText || "",
        images: assetImages,
        durationLabel: asset.durationLabel,
      },
      file: asset.assetFile ? {
        url: asset.assetFile,
        name: asset.assetFileName,
        type: asset.assetFileType,
        size: asset.assetFileSize,
      } : undefined,
      wodeappx: {
        id: asset.id,
        kind: asset.kind,
        preview: asset.preview || previewForApiKind(kind),
        meta: asset.meta,
        promptCategory: asset.promptCategory,
        promptTags: asset.promptTags,
        promptText: asset.promptText,
        productInfo: asset.productInfo,
        productImages,
        assetImages,
        assetFile: asset.assetFile,
        assetFileName: asset.assetFileName,
        assetFileType: asset.assetFileType,
        assetFileSize: asset.assetFileSize,
        brandColors: asset.brandColors,
        brandVoice: asset.brandVoice,
        brandRules: asset.brandRules,
        brandAssets,
        brandEntries: asset.brandEntries,
        coverImage,
        assetTime: asset.assetTime,
        assetUse: asset.assetUse,
        durationLabel: asset.durationLabel,
        productProfile: asset.productProfile,
      },
    },
    source: { type: "manual", sourceId: asset.id },
    visibility: "private",
    status: "active",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function mediaImageUrls(media) {
  if (!Array.isArray(media)) return [];
  return media
    .filter((item) => isRecord(item) && stringValue(item.url) && stringValue(item.mediaType || item.mimeType).includes("image"))
    .map((item) => stringValue(item.url));
}

function digitalAssetToLocalAsset(value, existing) {
  const asset = recordValue(value);
  const payload = recordValue(asset.payload);
  const product = recordValue(payload.product);
  const prompt = recordValue(payload.prompt);
  const brand = recordValue(payload.brand);
  const assetPayload = recordValue(payload.asset);
  const filePayload = recordValue(payload.file);
  const wodeappx = recordValue(payload.wodeappx);
  const kind = localKindFromApi(firstString(wodeappx.kind, asset.kind));
  const apiKind = apiKindFromLocal(kind);
  const imagesFromMedia = mediaImageUrls(asset.media);
  const explicitProductImages = uniqueStrings([
    ...stringArray(wodeappx.productImages),
    ...stringArray(asset.productImages),
    ...stringArray(product.images),
  ]);
  const productImages = explicitProductImages.length
    ? explicitProductImages
    : apiKind === "product"
      ? imagesFromMedia
      : [];
  const assetImages = uniqueStrings([
    ...stringArray(wodeappx.assetImages),
    ...stringArray(asset.assetImages),
    ...stringArray(product.refImages),
    ...stringArray(product.referenceImages),
    ...stringArray(assetPayload.images),
    ...(apiKind !== "product" && apiKind !== "brand" ? imagesFromMedia : []),
  ]);
  const brandAssets = uniqueStrings([
    ...stringArray(wodeappx.brandAssets),
    ...stringArray(asset.brandAssets),
    ...stringArray(brand.assets),
    ...(apiKind === "brand" ? imagesFromMedia : []),
  ]);
  const requestedId = firstString(wodeappx.id, asset.id, existing?.id);
  const id = requestedId.startsWith("local-")
    ? requestedId
    : existing?.id || `local-${apiKind}-${Date.now()}`;
  const productProfile = isRecord(product.profile)
    ? product.profile
    : isRecord(product.productProfile)
      ? product.productProfile
      : isRecord(wodeappx.productProfile)
        ? wodeappx.productProfile
        : undefined;

  return {
    ...(existing || {}),
    id,
    name: firstString(wodeappx.name, asset.name, existing?.name) || "Untitled asset",
    kind,
    meta: firstString(wodeappx.meta, asset.summary, asset.meta, existing?.meta) || `${kind} · WodeAppX`,
    preview: firstString(wodeappx.preview, asset.preview, existing?.preview) || previewForApiKind(apiKind),
    promptCategory: firstString(wodeappx.promptCategory, prompt.category, existing?.promptCategory) || undefined,
    promptTags: uniqueStrings([
      ...stringArray(wodeappx.promptTags),
      ...stringArray(prompt.tags),
      ...stringArray(asset.tags),
      ...(existing?.promptTags || []),
    ]),
    promptText: firstString(wodeappx.promptText, prompt.text, assetPayload.notes, product.supplement, existing?.promptText) || undefined,
    productInfo: firstString(wodeappx.productInfo, product.info, asset.productInfo, existing?.productInfo) || undefined,
    productProfile,
    productImages,
    assetImages,
    assetFile: firstString(wodeappx.assetFile, filePayload.url, existing?.assetFile) || undefined,
    assetFileName: firstString(wodeappx.assetFileName, filePayload.name, existing?.assetFileName) || undefined,
    assetFileType: firstString(wodeappx.assetFileType, filePayload.type, existing?.assetFileType) || undefined,
    assetFileSize: typeof wodeappx.assetFileSize === "number"
      ? wodeappx.assetFileSize
      : typeof filePayload.size === "number"
        ? filePayload.size
        : existing?.assetFileSize,
    brandColors: stringArray(wodeappx.brandColors).length ? stringArray(wodeappx.brandColors) : stringArray(brand.colors),
    brandVoice: firstString(wodeappx.brandVoice, brand.voice, existing?.brandVoice) || undefined,
    brandRules: firstString(wodeappx.brandRules, brand.rules, existing?.brandRules) || undefined,
    brandAssets,
    brandEntries: Array.isArray(wodeappx.brandEntries) ? wodeappx.brandEntries : Array.isArray(brand.entries) ? brand.entries : existing?.brandEntries,
    coverImage: firstString(wodeappx.coverImage, asset.coverImage, productImages[0], assetImages[0], brandAssets[0], existing?.coverImage) || undefined,
    assetTime: firstString(wodeappx.assetTime, existing?.assetTime) || "刚刚",
    assetUse: firstString(wodeappx.assetUse, existing?.assetUse) || kind,
    durationLabel: firstString(wodeappx.durationLabel, assetPayload.durationLabel, existing?.durationLabel) || undefined,
  };
}

function parseDigitalAssetsPath(pathValue) {
  const basePath = "/runtime-server/api/v1/digital-assets";
  let url;
  try {
    url = new URL(String(pathValue || basePath), "https://wodeappx.local");
  } catch {
    return null;
  }
  if (!url.pathname.startsWith(basePath)) return null;
  const rest = url.pathname.slice(basePath.length).replace(/^\/+/, "");
  return {
    assetId: rest ? decodeURIComponent(rest.split("/")[0]) : "",
    searchParams: url.searchParams,
  };
}

function filterDigitalAssetList(assets, searchParams) {
  const kind = stringValue(searchParams.get("kind"));
  const q = stringValue(searchParams.get("q")).toLowerCase();
  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 100) || 100, 1), 100);
  return assets
    .filter((asset) => {
      if (kind && kind !== apiKindFromLocal(asset.kind) && kind !== asset.kind) return false;
      if (!q) return true;
      return JSON.stringify(asset).toLowerCase().includes(q);
    })
    .slice(0, limit);
}

async function digitalAssetsRequest(input = {}) {
  const method = String(input.method || "GET").toUpperCase();
  const parsed = parseDigitalAssetsPath(input.path);
  if (!parsed) {
    return {
      ok: false,
      status: 400,
      body: { success: false, error: "Invalid digital-assets path" },
    };
  }

  const current = await readManifestAssets();
  const existing = parsed.assetId ? current.find((item) => item.id === parsed.assetId) : null;

  if (method === "GET" && !parsed.assetId) {
    const assets = filterDigitalAssetList(current, parsed.searchParams).map(localAssetToDigitalAsset);
    return { ok: true, status: 200, body: { success: true, data: { assets, nextCursor: null } } };
  }

  if (method === "GET") {
    if (!existing) return { ok: false, status: 404, body: { success: false, error: "Digital asset not found" } };
    return { ok: true, status: 200, body: { success: true, data: localAssetToDigitalAsset(existing) } };
  }

  if (method === "POST") {
    const saved = await saveAsset(digitalAssetToLocalAsset(input.body));
    return {
      ok: saved.ok === true,
      status: saved.ok === true ? 201 : 400,
      body: saved.ok === true
        ? { success: true, data: localAssetToDigitalAsset(saved.asset) }
        : { success: false, error: saved.error || "Failed to save digital asset" },
    };
  }

  if (method === "PUT" || method === "PATCH") {
    if (!parsed.assetId) {
      return { ok: false, status: 400, body: { success: false, error: "assetId is required" } };
    }
    const saved = await saveAsset(digitalAssetToLocalAsset({ ...(existing ? localAssetToDigitalAsset(existing) : {}), ...recordValue(input.body), id: parsed.assetId }, existing));
    return {
      ok: saved.ok === true,
      status: saved.ok === true ? 200 : 400,
      body: saved.ok === true
        ? { success: true, data: localAssetToDigitalAsset(saved.asset) }
        : { success: false, error: saved.error || "Failed to update digital asset" },
    };
  }

  if (method === "DELETE") {
    if (!parsed.assetId) {
      return { ok: false, status: 400, body: { success: false, error: "assetId is required" } };
    }
    const deleted = await deleteAsset(parsed.assetId);
    return {
      ok: deleted.ok === true,
      status: deleted.ok === true ? 200 : 400,
      body: deleted.ok === true
        ? { success: true, data: { deleted: deleted.deleted, asset: deleted.asset ? localAssetToDigitalAsset(deleted.asset) : null } }
        : { success: false, error: deleted.error || "Failed to delete digital asset" },
    };
  }

  return { ok: false, status: 405, body: { success: false, error: `Unsupported method: ${method}` } };
}

async function saveAsset(asset) {
  const normalized = await normalizeLocalAsset(asset);
  if (!normalized) {
    return { ok: false, error: "Invalid local asset" };
  }
  const current = await readManifestAssets();
  const next = [normalized, ...current.filter((item) => item.id !== normalized.id)];
  await writeManifestAssets(next);
  return { ok: true, asset: normalized, assets: next };
}

async function deleteAsset(assetId) {
  if (typeof assetId !== "string" || !assetId.startsWith("local-")) {
    return { ok: false, error: "Invalid local asset id" };
  }
  const current = await readManifestAssets();
  const asset = current.find((item) => item.id === assetId) || null;
  const next = current.filter((item) => item.id !== assetId);
  if (next.length !== current.length) {
    await writeManifestAssets(next);
  }
  return { ok: true, asset, assets: next, deleted: Boolean(asset) };
}

async function readStorageInfo() {
  const root = assetRootDir();
  async function walk(dir) {
    let total = 0;
    let entries = [];
    try {
      entries = await import("node:fs/promises").then((fs) => fs.readdir(dir, { withFileTypes: true }));
    } catch {
      return 0;
    }
    for (const entry of entries) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        total += await walk(filePath);
      } else if (entry.isFile()) {
        const info = await stat(filePath).catch(() => null);
        total += info?.size || 0;
      }
    }
    return total;
  }
  return { ok: true, root, bytes: await walk(root) };
}

function registerAssetProtocol() {
  if (protocolRegistered) return;
  protocolRegistered = true;
  protocol.handle(ASSET_PROTOCOL, async (request) => {
    const filePath = normalizeAssetUrlPath(request.url);
    if (!filePath) return new Response("Not found", { status: 404 });
    return net.fetch(pathToFileURL(filePath).toString());
  });
}

export function registerWodeAppLocalAssetsIpc() {
  if (!registered) {
    registered = true;
    protocol.registerSchemesAsPrivileged([
      {
        scheme: ASSET_PROTOCOL,
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          corsEnabled: true,
        },
      },
    ]);
    app.whenReady().then(registerAssetProtocol).catch(() => undefined);
  }

  ipcMain.handle(IPC_CHANNEL, async (_event, action, payload = {}) => {
    switch (action) {
      case "loadAssets":
        return { ok: true, assets: await readManifestAssets() };
      case "saveAsset":
        return saveAsset(payload?.asset);
      case "deleteAsset":
        return deleteAsset(payload?.assetId);
      case "persistFiles": {
        const files = Array.isArray(payload?.files) ? payload.files : [];
        const cache = new Map();
        const urls = [];
        for (const entry of files) {
          if (!entry || typeof entry !== "object") continue;
          const dataUrl = typeof entry.dataUrl === "string" ? entry.dataUrl : "";
          const filename = typeof entry.filename === "string" ? entry.filename : "";
          const url = await saveFileValue(dataUrl, cache, filename);
          if (url) urls.push(url);
        }
        return { ok: true, urls };
      }
      case "storageInfo":
        return readStorageInfo();
      case "digitalAssetsRequest":
        return digitalAssetsRequest(payload);
      default:
        return { ok: false, error: `Unknown WodeApp asset action: ${String(action)}` };
    }
  });
}
