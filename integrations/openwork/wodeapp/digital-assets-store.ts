import { useSyncExternalStore } from "react";

import {
  digitalAssetSearchText,
  type ProductAssetProfile,
  type BrandAssetEntry,
  type DigitalAssetFileRef,
  type DigitalAssetItem,
  type DigitalAssetKind,
  type ProductImageSyncStatus,
  type PromptAssetCategory,
} from "./digital-assets-data";
import { SUPOR_SITE_DIGITAL_ASSETS } from "./supor-site-assets";
import { ensureDigitalAssetDocument, needsDigitalAssetDocumentMigration } from "./digital-asset-document-format";

export type SaveBrandResearchInput = {
  name: string;
  sourceText: string;
  voice?: string;
  rules?: string;
  colors?: string[];
  entries?: BrandAssetEntry[];
};

export type SaveProductResearchInput = {
  assetId?: string;
  name: string;
  productInfo: string;
  productImages?: string[];
  /** Optional per-image names aligned with productImages / media.url. */
  media?: Array<{ url: string; name?: string }>;
  productImageSyncStatus?: ProductImageSyncStatus;
  productImageSyncError?: string;
  productProfile?: ProductAssetProfile;
  assetFiles?: DigitalAssetFileRef[];
};

export type SavePromptAssetInput = {
  name: string;
  promptText: string;
  promptCategory?: string;
  tags?: string[];
};

export type SaveImageLibraryAssetInput = {
  assetId?: string;
  name: string;
  imageUrls: string[];
  notes?: string;
};

const PRODUCT_PROFILE_ALIASES: Record<keyof ProductAssetProfile, string[]> = {
  brandName: ["brandName", "品牌", "品牌名称", "品牌名"],
  category: ["category", "品类", "商品品类", "类别"],
  sku: ["sku", "SKU"],
  spu: ["spu", "SPU"],
  model: ["model", "型号", "款号"],
  barcode: ["barcode", "条码", "条形码"],
  status: ["status", "状态"],
  price: ["price", "售价", "价格"],
  marketPrice: ["marketPrice", "市场价"],
  currency: ["currency", "币种"],
  unit: ["unit", "单位"],
  stock: ["stock", "库存"],
  color: ["color", "颜色"],
  size: ["size", "尺码", "规格"],
  material: ["material", "材质"],
  dimensions: ["dimensions", "尺寸", "产品尺寸"],
  weight: ["weight", "重量", "净重"],
  packageSpec: ["packageSpec", "包装规格", "包装"],
  sellingPoints: ["sellingPoints", "核心卖点", "卖点"],
  targetAudience: ["targetAudience", "目标人群", "适用人群"],
  usageScenarios: ["usageScenarios", "使用场景", "应用场景"],
  ingredients: ["ingredients", "成分", "配方"],
  origin: ["origin", "产地"],
  shelfLife: ["shelfLife", "保质期"],
  certifications: ["certifications", "认证", "认证资质"],
  warranty: ["warranty", "质保", "保修"],
  shippingNotes: ["shippingNotes", "物流说明", "物流"],
  afterSales: ["afterSales", "售后说明", "售后"],
  platform: ["platform", "销售平台", "平台"],
  channel: ["channel", "渠道"],
  listingTitle: ["listingTitle", "上架标题"],
  shortDescription: ["shortDescription", "短描述", "简介"],
  keywords: ["keywords", "关键词"],
  generationConstraints: ["generationConstraints", "生成约束", "生图约束", "视频约束"],
  customAttributes: ["customAttributes", "自定义属性"],
  variants: ["variants", "规格款式", "变体"],
  links: ["links", "链接", "参考链接"],
};

const PRODUCT_PROFILE_ARRAY_FIELDS = new Set<keyof ProductAssetProfile>([
  "sellingPoints",
  "usageScenarios",
  "certifications",
  "keywords",
]);

function profileScalar(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function profileStringList(value: unknown): string[] | undefined {
  const values = Array.isArray(value) ? value : [value];
  const normalized = values.map(profileScalar).filter((item): item is string => Boolean(item));
  return normalized.length ? [...new Set(normalized)] : undefined;
}

function profileValueText(value: unknown): string | undefined {
  const scalar = profileScalar(value);
  if (scalar) return scalar;
  if (Array.isArray(value)) return profileStringList(value)?.join("，");
  return undefined;
}

function normalizeProductAssetProfile(input: unknown): ProductAssetProfile | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const source = input as Record<string, unknown>;
  const consumedKeys = new Set<string>();
  const profile: ProductAssetProfile = {};

  for (const [field, aliases] of Object.entries(PRODUCT_PROFILE_ALIASES) as Array<[keyof ProductAssetProfile, string[]]>) {
    const sourceKey = aliases.find((alias) => Object.prototype.hasOwnProperty.call(source, alias));
    if (!sourceKey) continue;
    consumedKeys.add(sourceKey);
    const value = source[sourceKey];
    if (PRODUCT_PROFILE_ARRAY_FIELDS.has(field)) {
      const list = profileStringList(value);
      if (list) (profile as Record<string, unknown>)[field] = list;
      continue;
    }
    if (field === "customAttributes" || field === "variants" || field === "links") {
      if (Array.isArray(value)) (profile as Record<string, unknown>)[field] = value;
      continue;
    }
    const text = profileScalar(value);
    if (text) (profile as Record<string, unknown>)[field] = text;
  }

  const customAttributes = Array.isArray(profile.customAttributes)
    ? [...profile.customAttributes]
    : [];
  for (const [key, value] of Object.entries(source)) {
    if (consumedKeys.has(key)) continue;
    const text = profileValueText(value);
    if (text) customAttributes.push({ label: key, value: text });
  }
  if (customAttributes.length) profile.customAttributes = customAttributes;
  return Object.keys(profile).length ? profile : undefined;
}

export type SaveGenerationHistoryInput = {
  kind: DigitalAssetKind;
  name?: string;
  urls: string[];
  promptText?: string;
  taskId?: string;
  model?: string;
  provider?: string;
  shareUrl?: string;
  sourceAssetId?: string;
  productName?: string;
  durationLabel?: string;
};

function generationHistoryPreviewForKind(kind: DigitalAssetKind): DigitalAssetItem["preview"] {
  if (kind === "商品库") return "product";
  if (kind === "品牌库") return "brand";
  if (kind === "提示词") return "prompt";
  if (kind === "文件") return "file";
  if (kind === "视频") return "video";
  if (kind === "剧本") return "script";
  if (kind === "声音") return "audio";
  if (kind === "真人") return "role";
  return "image";
}

function generationHistoryLabelForKind(kind: DigitalAssetKind): string {
  return `生成${kind}`;
}

function generationHistoryCountMeta(kind: DigitalAssetKind, count: number): string {
  if (kind === "图片") return `${count} 张`;
  if (kind === "文件") return `${count} 份`;
  return `${count} 条`;
}

function generationHistoryFileName(kind: DigitalAssetKind, name: string): string | undefined {
  if (kind === "视频") return `${name}.mp4`;
  if (kind === "声音") return `${name}.mp3`;
  if (kind === "文件") return name;
  return undefined;
}

function generationHistoryFileType(kind: DigitalAssetKind): string | undefined {
  if (kind === "视频") return "video/mp4";
  if (kind === "声音") return "audio/mpeg";
  return undefined;
}

function generationHistoryUsesImageUrls(kind: DigitalAssetKind): boolean {
  return kind === "图片" || kind === "真人" || kind === "商品库" || kind === "品牌库";
}

export type ListDigitalAssetsInput = {
  kind?: DigitalAssetKind | "全部";
  q?: string;
  limit?: number;
};

export type DeleteDigitalAssetsResult = {
  deleted: DigitalAssetItem[];
  skipped: Array<{ id: string; name?: string; kind?: DigitalAssetKind; reason: string }>;
};

export type DedupeDigitalAssetsInput = {
  kind?: DigitalAssetKind | "全部";
  q?: string;
  keep?: "newest" | "oldest";
  dryRun?: boolean;
};

export type DedupeDigitalAssetsResult = {
  dryRun: boolean;
  groups: Array<{
    key: string;
    kept: DigitalAssetItem;
    duplicates: DigitalAssetItem[];
  }>;
  deleted: DigitalAssetItem[];
  skipped: DeleteDigitalAssetsResult["skipped"];
};

const LOCAL_ASSET_PREFIX = "local-";
const LOCAL_DB_VERSION = 1;
const LOCAL_STORE_NAME = "assets";

export type DigitalAssetScopeId = "default" | "supor";

const DIGITAL_ASSET_SCOPE_STORAGE_KEY = "wodeappx.digitalAssets.scope.v1";

function localDbNameForScope(scope: DigitalAssetScopeId): string {
  return scope === "supor" ? "wodeappx-digital-assets-supor" : "wodeappx-digital-assets";
}

function localFallbackKeyForScope(scope: DigitalAssetScopeId): string {
  return scope === "supor"
    ? "wodeappx.digitalAssets.local.supor.v1"
    : "wodeappx.digitalAssets.local.v1";
}

function readStoredDigitalAssetScope(): DigitalAssetScopeId {
  if (!canUseBrowserStorage()) return "default";
  try {
    const raw = window.localStorage.getItem(DIGITAL_ASSET_SCOPE_STORAGE_KEY);
    return raw === "supor" ? "supor" : "default";
  } catch {
    return "default";
  }
}

function seedSourceAssetsForScope(scope: DigitalAssetScopeId): DigitalAssetItem[] {
  return scope === "supor" ? SUPOR_SITE_DIGITAL_ASSETS : [];
}

let assetScope: DigitalAssetScopeId = "default";
let sourceAssets: DigitalAssetItem[] = seedSourceAssetsForScope("default");
let localAssets: DigitalAssetItem[] = [];
let digitalAssets: DigitalAssetItem[] = mergeDigitalAssets(localAssets, sourceAssets);
let signedIn = false;
let localLoadStarted = false;
let localLoadCompleted = false;
let localAssetsDirty = false;
let localLoadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

function canUseBrowserStorage(): boolean {
  return typeof window !== "undefined";
}

// Initialize scope before first load (must stay after canUseBrowserStorage).
assetScope = readStoredDigitalAssetScope();
sourceAssets = seedSourceAssetsForScope(assetScope);
digitalAssets = mergeDigitalAssets(localAssets, sourceAssets);

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

function mergeDigitalAssets(...assetGroups: DigitalAssetItem[][]): DigitalAssetItem[] {
  const seen = new Set<string>();
  const merged: DigitalAssetItem[] = [];
  for (const group of assetGroups) {
    for (const asset of group) {
      if (seen.has(asset.id)) continue;
      seen.add(asset.id);
      merged.push(asset);
    }
  }
  return merged;
}

function refreshDigitalAssets() {
  digitalAssets = mergeDigitalAssets(localAssets, sourceAssets);
}

export function isLocalDigitalAsset(item: DigitalAssetItem): boolean {
  return item.id.startsWith(LOCAL_ASSET_PREFIX);
}

export function normalizeLocalAsset(value: unknown): DigitalAssetItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<DigitalAssetItem>;
  if (
    typeof item.id !== "string" ||
    !item.id.startsWith(LOCAL_ASSET_PREFIX) ||
    typeof item.name !== "string" ||
    typeof item.kind !== "string" ||
    typeof item.meta !== "string" ||
    typeof item.preview !== "string"
  ) {
    return null;
  }
  const normalized = item as DigitalAssetItem;
  const normalizedAssetTime = normalized.assetTime === "刚刚"
    ? "历史记录（时间未记录）"
    : normalized.assetTime;
  if (normalized.kind !== "商品库") {
    return normalizedAssetTime === normalized.assetTime
      ? normalized
      : { ...normalized, assetTime: normalizedAssetTime };
  }

  const productImages = [...new Set((normalized.productImages || []).filter(Boolean))];
  const files = normalized.assetFiles || [];
  const videoCount = files.filter((file) => file.mediaType === "video" || file.type.startsWith("video/")).length;
  const documentCount = files.filter((file) => file.mediaType !== "video" && !file.type.startsWith("video/")).length;
  const meta = [
    productImages.length ? `${productImages.length} 张图片` : "",
    videoCount ? `${videoCount} 个视频` : "",
    documentCount ? `${documentCount} 份文件` : "",
    "商品库",
  ].filter(Boolean).join(" · ");
  const productInfoWasCopiedFromRequest = Boolean(
    normalized.productInfo && normalized.promptText?.includes(normalized.productInfo),
  );
  const localImageCount = productImages.filter((url) => !/^https:\/\//i.test(url.trim())).length;
  const productImageSyncStatus = productImages.length
    ? localImageCount > 0
      ? "local-only"
      : normalized.productImageSyncStatus || "synced"
    : undefined;
  const productImageSyncError = productImageSyncStatus === "local-only"
    ? normalized.productImageSyncError
      || `${localImageCount} 张商品图仅在当前设备可用，远端生成前需要重新上传同步。`
    : normalized.productImageSyncError;

  return {
    ...normalized,
    assetTime: normalizedAssetTime,
    meta,
    // Product-library prompt text is historical chat/task context, not durable
    // product knowledge. This also migrates legacy local-product-* records that
    // were overwritten by the chat auto-deposit path.
    promptText: undefined,
    productInfo: productInfoWasCopiedFromRequest ? undefined : normalized.productInfo,
    coverImage: productImages[0] || normalized.coverImage,
    productImages: productImages.length ? productImages : undefined,
    productImageSyncStatus,
    productImageSyncError,
  };
}

function normalizeLocalAssets(values: unknown): DigitalAssetItem[] {
  if (!Array.isArray(values)) return [];
  return values.map(normalizeLocalAsset).filter((item): item is DigitalAssetItem => Boolean(item));
}

function desktopAssetsBridge() {
  const bridge = (window as unknown as {
    __OPENWORK_ELECTRON__?: {
      wodeappAssets?: { invoke: (action: string, payload?: unknown) => Promise<unknown> };
    };
  }).__OPENWORK_ELECTRON__;
  return bridge?.wodeappAssets ?? null;
}

function isOkLocalAssetsResponse(value: unknown): value is { ok: true; assets?: unknown } {
  return Boolean(value && typeof value === "object" && (value as { ok?: unknown }).ok === true);
}

function isOkLocalAssetResponse(value: unknown): value is { ok: true; asset?: unknown } {
  return Boolean(value && typeof value === "object" && (value as { ok?: unknown }).ok === true);
}

function isOkDeleteAssetResponse(value: unknown): value is { ok: true } {
  return Boolean(value && typeof value === "object" && (value as { ok?: unknown }).ok === true);
}

async function readLocalAssetsFromDesktop(): Promise<DigitalAssetItem[] | null> {
  // Desktop asset IPC is global — only use it for the default scope to avoid leaking into Supor.
  if (assetScope !== "default") return null;
  const bridge = desktopAssetsBridge();
  if (!bridge) return null;
  const response = await bridge.invoke("loadAssets");
  if (!isOkLocalAssetsResponse(response)) return [];
  return normalizeLocalAssets(response.assets);
}

async function saveLocalAssetToDesktop(item: DigitalAssetItem): Promise<DigitalAssetItem | null> {
  if (assetScope !== "default") return null;
  const bridge = desktopAssetsBridge();
  if (!bridge) return null;
  const response = await bridge.invoke("saveAsset", { asset: item });
  if (!isOkLocalAssetResponse(response)) return null;
  return normalizeLocalAsset(response.asset);
}

async function deleteLocalAssetFromDesktop(assetId: string): Promise<boolean | null> {
  if (assetScope !== "default") return null;
  const bridge = desktopAssetsBridge();
  if (!bridge) return null;
  const response = await bridge.invoke("deleteAsset", { assetId });
  return isOkDeleteAssetResponse(response);
}

function openLocalAssetsDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!canUseBrowserStorage() || !window.indexedDB) {
      reject(new Error("IndexedDB is not available."));
      return;
    }

    const request = window.indexedDB.open(localDbNameForScope(assetScope), LOCAL_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(LOCAL_STORE_NAME)) {
        database.createObjectStore(LOCAL_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onerror = () => reject(request.error || new Error("Failed to open local asset store."));
    request.onsuccess = () => resolve(request.result);
  });
}

async function readLocalAssetsFromIndexedDB(): Promise<DigitalAssetItem[]> {
  const database = await openLocalAssetsDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(LOCAL_STORE_NAME, "readonly");
    const store = transaction.objectStore(LOCAL_STORE_NAME);
    const request = store.getAll();
    request.onerror = () => reject(request.error || new Error("Failed to read local assets."));
    request.onsuccess = () => resolve(normalizeLocalAssets(request.result));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error("Failed to read local assets."));
    };
  });
}

async function writeLocalAssetsToIndexedDB(assets: DigitalAssetItem[]): Promise<void> {
  const database = await openLocalAssetsDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(LOCAL_STORE_NAME, "readwrite");
    const store = transaction.objectStore(LOCAL_STORE_NAME);
    store.clear();
    for (const asset of assets) {
      store.put(asset);
    }
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error || new Error("Failed to write local assets."));
    };
  });
}

function readLocalAssetsFromFallback(): DigitalAssetItem[] {
  if (!canUseBrowserStorage()) return [];
  try {
    return normalizeLocalAssets(JSON.parse(window.localStorage.getItem(localFallbackKeyForScope(assetScope)) || "[]"));
  } catch {
    return [];
  }
}

function writeLocalAssetsToFallback(assets: DigitalAssetItem[]) {
  if (!canUseBrowserStorage()) return;
  try {
    window.localStorage.setItem(localFallbackKeyForScope(assetScope), JSON.stringify(assets));
  } catch {
    // Local image data can exceed the fallback quota. IndexedDB remains the primary store.
  }
}

async function readLocalAssets(): Promise<DigitalAssetItem[]> {
  const desktopAssets = await readLocalAssetsFromDesktop().catch(() => null);
  if (desktopAssets?.length) return desktopAssets;

  try {
    const assets = await readLocalAssetsFromIndexedDB();
    if (assets.length) {
      if (desktopAssets) {
        const savedAssets: DigitalAssetItem[] = [];
        for (const asset of assets) {
          const saved = await saveLocalAssetToDesktop(asset).catch(() => null);
          savedAssets.push(saved || asset);
        }
        return savedAssets;
      }
      return assets;
    }
  } catch {
    // Fall through to the small fallback store.
  }
  return readLocalAssetsFromFallback();
}

async function persistLocalAssets() {
  const assets = localAssets.filter(isLocalDigitalAsset);
  try {
    await writeLocalAssetsToIndexedDB(assets);
    writeLocalAssetsToFallback(assets);
  } catch {
    writeLocalAssetsToFallback(assets);
  }
}

async function migrateAndPersistDocumentAssets(assets: DigitalAssetItem[]): Promise<{
  assets: DigitalAssetItem[];
  migratedCount: number;
}> {
  let migratedCount = 0;
  const next = assets.map((asset) => {
    if (!needsDigitalAssetDocumentMigration(asset)) {
      // Still normalize document shape for already-migrated Markdown assets.
      return ensureDigitalAssetDocument(asset);
    }
    migratedCount += 1;
    return ensureDigitalAssetDocument(asset);
  });

  if (migratedCount > 0) {
    for (const asset of next) {
      if (!isLocalDigitalAsset(asset)) continue;
      if (!isDigitalAssetDocumentKindSafe(asset.kind)) continue;
      await saveLocalAssetToDesktop(asset).catch(() => null);
    }
  }

  return { assets: next, migratedCount };
}

function isDigitalAssetDocumentKindSafe(kind: string): boolean {
  return kind === "品牌库" || kind === "提示词" || kind === "剧本";
}

export function ensureLocalDigitalAssetsLoaded(options?: { force?: boolean }): Promise<void> {
  if (options?.force) {
    localLoadStarted = false;
    localLoadCompleted = false;
    localLoadPromise = null;
  }
  if (localLoadPromise) return localLoadPromise;
  if (localLoadStarted) return Promise.resolve();
  localLoadStarted = true;
  localLoadPromise = readLocalAssets()
    .then(async (assets) => {
      localLoadCompleted = true;
      if (localAssetsDirty) return;
      const { assets: migrated, migratedCount } = await migrateAndPersistDocumentAssets(assets);
      localAssets = mergeDigitalAssets(migrated);
      refreshDigitalAssets();
      emitChange();
      if (migratedCount > 0) {
        localAssetsDirty = true;
        await persistLocalAssets().finally(() => {
          localAssetsDirty = false;
        });
      }
    })
    .catch(() => {
      localLoadCompleted = true;
    });
  return localLoadPromise;
}

if (canUseBrowserStorage()) {
  void ensureLocalDigitalAssetsLoaded();
}

export function getDigitalAssetsList(): DigitalAssetItem[] {
  return digitalAssets;
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeDedupeText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[·.。,_，:：;；\-_/\\()[\]{}'"“”‘’]+/g, "");
}

function assetUpdatedSortValue(asset: DigitalAssetItem): number {
  const idTime = asset.id.match(/(\d{10,})/)?.[1];
  if (idTime) return Number(idTime);
  const parsed = Date.parse(asset.assetTime || "");
  return Number.isFinite(parsed) ? parsed : 0;
}

export function findExistingProductAssetIdForSave(
  assets: DigitalAssetItem[],
  productName: string,
): string | undefined {
  const nameKey = normalizeDedupeText(productName);
  if (!nameKey) return undefined;
  return [...assets]
    .filter((asset) => asset.kind === "商品库" && normalizeDedupeText(asset.name) === nameKey)
    .sort((a, b) => assetUpdatedSortValue(b) - assetUpdatedSortValue(a))[0]?.id;
}

function assetContentFingerprint(asset: DigitalAssetItem): string {
  const hashes = [
    ...(asset.contentHashes || []),
    ...(asset.assetFiles || []).map((file) => file.contentHash || ""),
  ].map((value) => value.trim().toLowerCase()).filter(Boolean).sort();
  return [...new Set(hashes)].join("|");
}

function filterDigitalAssets(input: ListDigitalAssetsInput = {}): DigitalAssetItem[] {
  const kind = input.kind && input.kind !== "全部" ? input.kind : undefined;
  const query = normalizeSearchText(input.q || "");
  return digitalAssets.filter((asset) => {
    if (kind && asset.kind !== kind) return false;
    if (!query) return true;
    return digitalAssetSearchText(asset).includes(query) || asset.id.toLowerCase().includes(query);
  });
}

export function listDigitalAssetsForAgent(input: ListDigitalAssetsInput = {}): DigitalAssetItem[] {
  const limit = Math.min(100, Math.max(1, input.limit || 50));
  return filterDigitalAssets(input).slice(0, limit);
}

export function getDigitalAssetsSignedIn(): boolean {
  return signedIn;
}

/** 内嵌身份状态由 useWodeAppDigitalAssets 同步，用于区分“本地可用”与“已同步云端资产”。 */
export function setDigitalAssetsSignedIn(next: boolean) {
  if (signedIn === next) return;
  signedIn = next;
  emitChange();
}

export function useDigitalAssetsSignedIn(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => signedIn,
    () => signedIn,
  );
}

export function getDigitalAssetScope(): DigitalAssetScopeId {
  return assetScope;
}

export function useDigitalAssetScope(): DigitalAssetScopeId {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => assetScope,
    () => assetScope,
  );
}

/** Switch local asset partition (Supor vs default). Flushes dirty writes first. */
export async function setDigitalAssetScope(next: DigitalAssetScopeId): Promise<void> {
  if (next === assetScope) return;
  if (localAssetsDirty) {
    await persistLocalAssets().catch(() => undefined);
    localAssetsDirty = false;
  }
  assetScope = next;
  if (canUseBrowserStorage()) {
    try {
      window.localStorage.setItem(DIGITAL_ASSET_SCOPE_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }
  sourceAssets = seedSourceAssetsForScope(next);
  localAssets = [];
  refreshDigitalAssets();
  emitChange();
  await ensureLocalDigitalAssetsLoaded({ force: true });
}

export function setDigitalAssetsList(next: DigitalAssetItem[]) {
  // Default scope: cloud list only (no Supor site seed bleed).
  // Supor scope: keep Supor seeds and ignore unrelated cloud catalogs.
  // Cloud records are adapted in-memory for Markdown preview; local persist happens on save/load.
  const adapted = next.map((asset) => ensureDigitalAssetDocument(asset));
  sourceAssets = assetScope === "supor"
    ? seedSourceAssetsForScope("supor")
    : mergeDigitalAssets(adapted);
  refreshDigitalAssets();
  emitChange();
}

export function resetDigitalAssetsList() {
  sourceAssets = seedSourceAssetsForScope(assetScope);
  refreshDigitalAssets();
  emitChange();
}

export async function saveBrandResearchAsset(input: SaveBrandResearchInput): Promise<DigitalAssetItem> {
  const name = input.name.trim();
  const sourceText = input.sourceText.trim();
  if (!name) throw new Error("品牌名称不能为空");
  if (!sourceText) throw new Error("品牌资料不能为空");

  const brandEntries: BrandAssetEntry[] = input.entries?.length
    ? input.entries
    : [{
      id: "brand-source",
      category: "资料",
      title: "品牌原始资料",
      description: sourceText.length > 220 ? `${sourceText.slice(0, 220)}...` : sourceText,
      keywords: ["品牌资料", "搜索", "参考"],
      scenePrompt: "生成场景时优先遵循这段品牌原始资料，不确定的信息不要补写。",
    }];

  return saveLocalDigitalAsset({
    id: `local-brand-${Date.now()}`,
    name,
    kind: "品牌库",
    meta: "HTML · 品牌规范",
    preview: "brand",
    promptText: sourceText,
    brandColors: input.colors?.map((color) => color.trim()).filter(Boolean).slice(0, 6),
    brandVoice: input.voice?.trim() || undefined,
    brandRules: input.rules?.trim() || undefined,
    brandEntries,
    assetTime: "刚刚",
    assetUse: "品牌调研",
  });
}

const PROMPT_ASSET_CATEGORIES = new Set<PromptAssetCategory>([
  "全部",
  "视频",
  "图片",
  "人物",
  "风格",
  "环境",
  "动作",
  "光质",
  "产品图",
  "通用",
]);

function normalizePromptCategory(value: string | undefined): PromptAssetCategory {
  const trimmed = value?.trim();
  if (trimmed && PROMPT_ASSET_CATEGORIES.has(trimmed as PromptAssetCategory) && trimmed !== "全部") {
    return trimmed as PromptAssetCategory;
  }
  return "通用";
}

function formatLocalAssetTime(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export async function saveProductResearchAsset(input: SaveProductResearchInput): Promise<DigitalAssetItem> {
  const name = input.name.trim();
  const productInfo = input.productInfo.trim();
  const productImages = [...new Set((input.productImages || []).map((url) => url.trim()).filter(Boolean))].slice(0, 12);
  const productProfile = normalizeProductAssetProfile(input.productProfile);
  const assetFiles = (input.assetFiles || [])
    .map((file) => ({
      ...file,
      url: file.url.trim(),
      name: file.name.trim(),
      type: file.type.trim() || "application/octet-stream",
      size: Number.isFinite(file.size) && file.size >= 0 ? file.size : 0,
    }))
    .filter((file) => file.url && file.name);
  if (!name) throw new Error("商品名称不能为空");
  if (!productInfo && !productProfile && !productImages.length && !assetFiles.length) {
    throw new Error("商品描述、商品图或附件至少填写一项");
  }

  const primaryFile = assetFiles[0];
  const videoCount = assetFiles.filter((file) => file.mediaType === "video" || file.type.startsWith("video/")).length;
  const documentCount = assetFiles.length - videoCount;
  const meta = [
    productImages.length ? `${productImages.length} 张图片` : "",
    videoCount ? `${videoCount} 个视频` : "",
    documentCount ? `${documentCount} 份文件` : "",
    "商品库",
  ].filter(Boolean).join(" · ");

  await ensureLocalDigitalAssetsLoaded();
  const assetId = input.assetId?.trim()
    || findExistingProductAssetIdForSave(localAssets, name)
    || `local-product-${Date.now()}`;

  const nameByUrl = new Map<string, string>();
  for (const item of input.media || []) {
    const url = item.url?.trim();
    const label = item.name?.trim();
    if (url && label) nameByUrl.set(url, label);
  }
  const media = productImages.length
    ? productImages.map((url, index) => ({
      url,
      name: nameByUrl.get(url) || undefined,
      role: (index === 0 ? "cover" : "reference") as "cover" | "reference",
      mediaType: "image" as const,
    }))
    : undefined;

  return saveLocalDigitalAsset({
    id: assetId,
    name,
    kind: "商品库",
    meta,
    preview: "product",
    coverImage: productImages[0],
    productImages: productImages.length ? productImages : undefined,
    media,
    productImageSyncStatus: productImages.length ? input.productImageSyncStatus : undefined,
    productImageSyncError: productImages.length ? input.productImageSyncError?.trim() || undefined : undefined,
    productInfo: productInfo || undefined,
    productProfile,
    assetFile: primaryFile?.url,
    assetFileName: primaryFile?.name,
    assetFileType: primaryFile?.type,
    assetFileSize: primaryFile?.size,
    assetFiles: assetFiles.length ? assetFiles : undefined,
    contentHashes: [...new Set(assetFiles.map((file) => file.contentHash).filter((hash): hash is string => Boolean(hash)))],
    integrityStatus: assetFiles.length
      ? assetFiles.every((file) => file.integrityStatus === "verified") ? "verified" : "unverified"
      : undefined,
    processingStatus: assetFiles.length ? "ready" : undefined,
    assetTime: formatLocalAssetTime(),
    assetUse: "商品调研",
  });
}

export async function savePromptResearchAsset(input: SavePromptAssetInput): Promise<DigitalAssetItem> {
  const name = input.name.trim();
  const promptText = input.promptText.trim();
  if (!name) throw new Error("提示词名称不能为空");
  if (!promptText) throw new Error("提示词正文不能为空");

  const promptCategory = normalizePromptCategory(input.promptCategory);
  const tags = (input.tags || []).map((tag) => tag.trim()).filter(Boolean).slice(0, 8);

  return saveLocalDigitalAsset({
    id: `local-prompt-${Date.now()}`,
    name,
    kind: "提示词",
    meta: `${promptCategory} · 本地提示词`,
    preview: "prompt",
    promptCategory,
    promptTags: [promptCategory, ...tags.filter((tag) => tag !== promptCategory)],
    promptText,
    assetTime: "刚刚",
    assetUse: "提示词资产",
  });
}

export async function saveImageLibraryAsset(input: SaveImageLibraryAssetInput): Promise<DigitalAssetItem> {
  const name = input.name.trim();
  const imageUrls = [...new Set((input.imageUrls || []).map((url) => url.trim()).filter(Boolean))].slice(0, 12);
  const notes = input.notes?.trim() || undefined;
  if (!name) throw new Error("素材名称不能为空");
  if (!imageUrls.length) throw new Error("至少需要一张图片");

  const httpsCount = imageUrls.filter((url) => /^https:\/\//i.test(url)).length;
  const localCount = imageUrls.length - httpsCount;
  const meta = [
    `${imageUrls.length} 张`,
    httpsCount ? `${httpsCount} 张云端` : "",
    localCount ? `${localCount} 张本地` : "",
    "图片素材",
  ].filter(Boolean).join(" · ");

  return saveLocalDigitalAsset({
    id: input.assetId?.trim() || `local-image-${Date.now()}`,
    name,
    kind: "图片",
    meta,
    preview: "image",
    coverImage: imageUrls[0],
    assetImages: imageUrls,
    promptText: notes,
    assetTime: formatLocalAssetTime(),
    assetUse: "图片素材",
  });
}

export async function saveGenerationHistoryAsset(input: SaveGenerationHistoryInput): Promise<DigitalAssetItem> {
  const urls = [...new Set((input.urls || []).map((url) => url.trim()).filter(Boolean))].slice(0, 24);
  if (!urls.length) throw new Error("生成记录至少需要一个结果 URL");

  const kind = input.kind;
  const now = Date.now();
  const label = generationHistoryLabelForKind(kind);
  const productPrefix = input.productName?.trim() ? `${input.productName.trim()} · ` : "";
  const name = (input.name?.trim() || `${productPrefix}${label}`).slice(0, 80);
  const modelMeta = [input.provider, input.model].map((item) => item?.trim()).filter(Boolean).join(" · ");
  const countMeta = generationHistoryCountMeta(kind, urls.length);
  const promptText = [
    input.promptText?.trim(),
    input.taskId ? `taskId: ${input.taskId}` : "",
    input.sourceAssetId ? `sourceAssetId: ${input.sourceAssetId}` : "",
  ].filter(Boolean).join("\n\n") || undefined;

  return saveLocalDigitalAsset({
    id: `local-generation-${now}`,
    name,
    kind,
    meta: [countMeta, modelMeta || "生成历史"].filter(Boolean).join(" · "),
    preview: generationHistoryPreviewForKind(kind),
    coverImage: generationHistoryUsesImageUrls(kind) ? urls[0] : undefined,
    productImages: kind === "商品库" ? urls : undefined,
    brandAssets: kind === "品牌库" ? urls : undefined,
    assetImages: kind === "图片" || kind === "真人" ? urls : undefined,
    assetFile: generationHistoryUsesImageUrls(kind) ? undefined : urls[0],
    assetFileName: generationHistoryFileName(kind, name),
    assetFileType: generationHistoryFileType(kind),
    promptText,
    assetTime: formatLocalAssetTime(),
    assetUse: "生成历史",
    durationLabel: input.durationLabel?.trim() || undefined,
    generationTaskId: input.taskId?.trim() || undefined,
    generationModel: input.model?.trim() || undefined,
    generationProvider: input.provider?.trim() || undefined,
    generationSourceAssetId: input.sourceAssetId?.trim() || undefined,
    generationShareUrl: input.shareUrl?.trim() || undefined,
  });
}

export async function saveLocalDigitalAsset(item: DigitalAssetItem): Promise<DigitalAssetItem> {
  localAssetsDirty = true;
  const prepared = ensureDigitalAssetDocument(item);
  const saved = await saveLocalAssetToDesktop(prepared).catch(() => null);
  const next = saved || prepared;
  localAssets = [next, ...localAssets.filter((asset) => asset.id !== next.id)];
  refreshDigitalAssets();
  emitChange();
  await persistLocalAssets().finally(() => {
    if (localLoadCompleted) localAssetsDirty = false;
  });
  return next;
}

export async function deleteLocalDigitalAssets(assetIds: string[]): Promise<DeleteDigitalAssetsResult> {
  const ids = [...new Set(assetIds.map((id) => id.trim()).filter(Boolean))];
  const deleted: DigitalAssetItem[] = [];
  const skipped: DeleteDigitalAssetsResult["skipped"] = [];
  if (!ids.length) return { deleted, skipped };

  await ensureLocalDigitalAssetsLoaded();
  localAssetsDirty = true;

  for (const id of ids) {
    const target = digitalAssets.find((asset) => asset.id === id);
    if (!target) {
      skipped.push({ id, reason: "资产不存在" });
      continue;
    }
    if (!isLocalDigitalAsset(target)) {
      skipped.push({
        id,
        name: target.name,
        kind: target.kind,
        reason: "当前只能删除桌面本地资产；云端数字资产删除接口尚未接通",
      });
      continue;
    }
    const persisted = await deleteLocalAssetFromDesktop(id).catch(() => false);
    if (persisted === false) {
      skipped.push({ id, name: target.name, kind: target.kind, reason: "桌面本地资产持久化删除失败" });
      continue;
    }
    deleted.push(target);
  }

  if (deleted.length) {
    const deletedIds = new Set(deleted.map((asset) => asset.id));
    localAssets = localAssets.filter((asset) => !deletedIds.has(asset.id));
    refreshDigitalAssets();
    emitChange();
    await persistLocalAssets().finally(() => {
      if (localLoadCompleted) localAssetsDirty = false;
    });
  } else if (localLoadCompleted) {
    localAssetsDirty = false;
  }

  return { deleted, skipped };
}

export async function dedupeLocalDigitalAssets(input: DedupeDigitalAssetsInput = {}): Promise<DedupeDigitalAssetsResult> {
  await ensureLocalDigitalAssetsLoaded();
  const kind = input.kind && input.kind !== "全部" ? input.kind : undefined;
  const query = normalizeSearchText(input.q || "");
  const keep = input.keep === "oldest" ? "oldest" : "newest";
  const candidates = localAssets.filter((asset) => {
    if (kind && asset.kind !== kind) return false;
    if (!query) return true;
    return digitalAssetSearchText(asset).includes(query) || asset.id.toLowerCase().includes(query);
  });
  const grouped = new Map<string, DigitalAssetItem[]>();

  for (const asset of candidates) {
    const contentFingerprint = assetContentFingerprint(asset);
    const key = contentFingerprint
      ? `${asset.kind}:sha256:${contentFingerprint}`
      : `${asset.kind}:name:${normalizeDedupeText(asset.name)}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)?.push(asset);
  }

  const groups: DedupeDigitalAssetsResult["groups"] = [];
  for (const [key, assets] of grouped) {
    if (assets.length < 2) continue;
    const sorted = [...assets].sort((a, b) => assetUpdatedSortValue(b) - assetUpdatedSortValue(a));
    const kept = keep === "newest" ? sorted[0] : sorted[sorted.length - 1];
    groups.push({
      key,
      kept,
      duplicates: sorted.filter((asset) => asset.id !== kept.id),
    });
  }

  if (input.dryRun) {
    return { dryRun: true, groups, deleted: [], skipped: [] };
  }

  const result = await deleteLocalDigitalAssets(groups.flatMap((group) => group.duplicates.map((asset) => asset.id)));
  return {
    dryRun: false,
    groups,
    deleted: result.deleted,
    skipped: result.skipped,
  };
}

export function useDigitalAssetsList(): DigitalAssetItem[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => digitalAssets,
    () => digitalAssets,
  );
}

export function findDigitalAssetById(id: string): DigitalAssetItem | undefined {
  return digitalAssets.find((item) => item.id === id);
}

export function findDigitalAssetByMentionValue(value: string): DigitalAssetItem | undefined {
  if (value.startsWith("asset:")) {
    return findDigitalAssetById(value.slice("asset:".length));
  }
  const byId = findDigitalAssetById(value);
  if (byId) return byId;
  return digitalAssets.find((item) => item.name === value);
}
