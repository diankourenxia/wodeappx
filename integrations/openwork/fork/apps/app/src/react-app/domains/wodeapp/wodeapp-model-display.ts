import catalog from "./wode-branded-catalog.json";
import type { ModelRef } from "@/app/types";

export type WodeAppModelRegion = "china" | "international";

type WodeBrandedCatalogEntry = {
  apiId: string;
  opencodeKey: string;
  name: string;
  upstreamId: string;
  region?: WodeAppModelRegion;
  modality?: "text" | "image" | "video";
  capabilities?: string[];
};

type WodeAppCatalogModelOption = {
  modelID: string;
  title: string;
  description: string;
  region: WodeAppModelRegion;
  aliases: string[];
};

const wodeCatalog = catalog as WodeBrandedCatalogEntry[];
const wodeChatCatalog = wodeCatalog.filter((entry) => entry.modality !== "image" && entry.modality !== "video");

const WODEAPP_LEGACY_MODEL_REDIRECTS: Record<string, string> = {
  "wode/opus-4.8": "wode/opus-4.6",
  "wode/gpt-5.5": "wode/gpt-5.2",
  "wode-opus-4.8": "wode/opus-4.6",
  "wode-gpt-5.5": "wode/gpt-5.2",
  "wodeapp/wode/opus-4.8": "wode/opus-4.6",
  "wodeapp/wode/gpt-5.5": "wode/gpt-5.2",
};

function normalizeRegion(entry: WodeBrandedCatalogEntry): WodeAppModelRegion {
  return entry.region === "international" ? "international" : "china";
}

function catalogModelKeys(entry: WodeBrandedCatalogEntry): string[] {
  const legacyAliases = Object.entries(WODEAPP_LEGACY_MODEL_REDIRECTS)
    .filter(([, canonical]) => canonical === entry.apiId)
    .map(([legacy]) => legacy);
  return [entry.opencodeKey, entry.apiId, entry.upstreamId, ...legacyAliases];
}

function catalogEntryToModelOption(entry: WodeBrandedCatalogEntry): WodeAppCatalogModelOption {
  return {
    modelID: entry.apiId,
    title: String(entry.name || "").replace(/^wode\s+/i, "").trim() || entry.name,
    description: wodeAppModelSubtitle(entry.apiId),
    region: normalizeRegion(entry),
    aliases: catalogModelKeys(entry),
  };
}

/** WodeApp 平台模型展示文案（OpenCode model key → 副标题）— 由 sync-wode-branded-models.mjs 生成 */
export const WODEAPP_MODEL_SUBTITLES: Record<string, string> = Object.fromEntries(
  wodeChatCatalog.flatMap((entry) => {
    const label = normalizeRegion(entry) === "international"
      ? "国际模型 · 按积分计费"
      : "国内模型 · 按积分计费";
    return catalogModelKeys(entry).map((key) => [key, label] as const);
  }),
);

const WODEAPP_MODEL_REGIONS = new Map<string, WodeAppModelRegion>(
  wodeChatCatalog.flatMap((entry) =>
    catalogModelKeys(entry).map((key) => [key, normalizeRegion(entry)] as const),
  ),
);

const WODEAPP_MODEL_PRIORITY = new Map<string, number>(
  wodeChatCatalog.flatMap((entry, index) =>
    catalogModelKeys(entry).map((key) => [key, index] as const),
  ),
);

const WODEAPP_CATALOG_OPTIONS_BY_ALIAS = new Map<string, WodeAppCatalogModelOption>(
  wodeChatCatalog.flatMap((entry) => {
    const option = catalogEntryToModelOption(entry);
    return option.aliases.map((alias) => [alias, option] as const);
  }),
);

const WODEAPP_CATALOG_OPTIONS_BY_NORMALIZED_ALIAS = new Map<string, WodeAppCatalogModelOption>(
  [...WODEAPP_CATALOG_OPTIONS_BY_ALIAS].map(([alias, option]) => [alias.toLowerCase(), option]),
);

export const WODEAPP_PROVIDER_ID = "wodeapp";

export const WODEAPP_LEGACY_PROVIDER_ID = "wode";

export function isWodeAppModelProvider(providerID: string | null | undefined): boolean {
  return providerID === WODEAPP_PROVIDER_ID || providerID === WODEAPP_LEGACY_PROVIDER_ID;
}

/** Non-platform providers suitable for local BYOK (OpenRouter / DeepSeek / …). */
export function isLocalByokModelProvider(providerID: string | null | undefined): boolean {
  if (!providerID) return false;
  if (isWodeAppModelProvider(providerID)) return false;
  if (providerID === "opencode" || providerID === "openwork") return false;
  return true;
}

/** Collapse catalog aliases to canonical apiIds; unknown ids keep first occurrence. */
export function uniqueWodeAppCatalogModelIds(modelIds: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of modelIds) {
    const key = wodeAppCatalogOptionForModel(raw)?.modelID ?? raw;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export const WODEAPP_API_KEY_URL = "https://wodeapp.cn/api-skills";

export const WODEAPP_OPEN_LOGIN_EVENT = "wodeapp:open-login";

/** Navigate users to Settings → 服务与模型 (local BYOK / media keys). */
export const WODEAPP_OPEN_SERVICE_SETTINGS_EVENT = "wodeapp:open-service-settings";

/** Open the 配置本机 Key dialog from the model picker / capability table. */
export const WODEAPP_OPEN_LOCAL_KEY_EVENT = "wodeapp:open-local-key";

export const WODEAPP_OPEN_ACCOUNT_EVENT = "wodeapp:open-account";

export const WODEAPP_OPEN_RECHARGE_EVENT = "wodeapp:open-recharge";

/** Cold-start: open BYOK / model setup guide when no usable model. */
export const WODEAPP_OPEN_BYOK_GUIDE_EVENT = "wodeapp:open-byok-guide";


export function wodeAppModelSubtitle(modelKey: string): string {
  return WODEAPP_MODEL_SUBTITLES[modelKey] ?? "国内模型 · 按积分计费";
}

export function wodeAppModelRegion(modelKey: string): WodeAppModelRegion {
  return WODEAPP_MODEL_REGIONS.get(modelKey) ?? "china";
}

export function wodeAppCatalogModelOptions(): WodeAppCatalogModelOption[] {
  return wodeChatCatalog.map(catalogEntryToModelOption);
}

export function wodeAppCatalogOptionForModel(modelKey: string): WodeAppCatalogModelOption | null {
  return WODEAPP_CATALOG_OPTIONS_BY_ALIAS.get(modelKey)
    ?? WODEAPP_CATALOG_OPTIONS_BY_NORMALIZED_ALIAS.get(modelKey.toLowerCase())
    ?? null;
}

export function isWodeAppLegacyModelId(modelKey: string): boolean {
  return Boolean(WODEAPP_LEGACY_MODEL_REDIRECTS[modelKey]);
}

export function wodeAppCanonicalModelId(modelKey: string): string {
  if (WODEAPP_LEGACY_MODEL_REDIRECTS[modelKey]) return modelKey;
  return wodeAppCatalogOptionForModel(modelKey)?.modelID ?? modelKey;
}

export function normalizeWodeAppModelRef(model: ModelRef): ModelRef {
  if (!isWodeAppModelProvider(model.providerID)) return model;
  return {
    providerID: model.providerID,
    modelID: wodeAppCanonicalModelId(model.modelID),
  };
}

export function wodeAppCatalogModelKeys(): string[] {
  return [
    ...new Set(
      wodeChatCatalog.flatMap((entry) => catalogModelKeys(entry)),
    ),
  ];
}

export function wodeAppModelPriority(modelKey: string): number {
  return WODEAPP_MODEL_PRIORITY.get(modelKey) ?? Number.MAX_SAFE_INTEGER;
}

export type ModelPickerChannel = "cloud" | "local";

export const MODEL_PICKER_CHANNEL_LABEL: Record<ModelPickerChannel, string> = {
  cloud: "云端积分",
  local: "本机 Key",
};

const VENDOR_LABELS: Record<string, string> = {
  kimi: "Kimi",
  volcano: "火山",
  deepseek: "DeepSeek",
  dashscope: "通义",
  minimax: "MiniMax",
  zai: "智谱",
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  openrouter: "OpenRouter",
  replicate: "Replicate",
  groq: "Groq",
  mistral: "Mistral",
  xai: "xAI",
  custom: "自定义",
  other: "其他",
};

const VENDOR_PRIORITY = [
  "kimi",
  "volcano",
  "deepseek",
  "dashscope",
  "minimax",
  "zai",
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "replicate",
  "groq",
  "mistral",
  "xai",
  "custom",
  "other",
];

const PROVIDER_VENDOR_ALIASES: Record<string, string> = {
  wodeapp: "other",
  wode: "other",
  moonshot: "kimi",
  kimi: "kimi",
  kimicode: "kimi",
  volcano: "volcano",
  doubao: "volcano",
  ark: "volcano",
  dashscope: "dashscope",
  alibaba: "dashscope",
  qwen: "dashscope",
  deepseek: "deepseek",
  minimax: "minimax",
  zai: "zai",
  zhipu: "zai",
  glm: "zai",
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  gemini: "google",
  openrouter: "openrouter",
  replicate: "replicate",
  groq: "groq",
  mistral: "mistral",
  xai: "xai",
  "x-ai": "xai",
};

function vendorFromModelKey(modelKey: string): string {
  const key = String(modelKey || "").toLowerCase();
  if (key.includes("kimi") || key.includes("moonshot") || key.includes("kimicode")) return "kimi";
  if (key.includes("deepseek")) return "deepseek";
  if (key.includes("doubao") || key.includes("volc") || key.includes("bytedance") || key.includes("seedream") || key.includes("seedance") || /(^|[/-])ark([/-]|$)/.test(key)) {
    return "volcano";
  }
  if (key.includes("qwen") || key.includes("dashscope") || key.includes("tongyi")) return "dashscope";
  if (key.includes("minimax") || key.includes("hailuo")) return "minimax";
  if (key.includes("glm") || key.includes("zhipu") || key.includes("z-ai") || key.includes("zai")) return "zai";
  if (key.includes("claude") || key.includes("opus") || key.includes("sonnet") || key.includes("haiku") || key.includes("anthropic")) {
    return "anthropic";
  }
  if (key.includes("gpt") || key.includes("openai") || key.includes("o1") || key.includes("o3") || key.includes("o4")) {
    return "openai";
  }
  if (key.includes("gemini") || key.includes("google")) return "google";
  if (key.includes("openrouter")) return "openrouter";
  if (key.includes("kling") || key.includes("keling")) return "kling";
  if (key.includes("flux") || key.includes("replicate") || key.includes("nano-banana")) return "replicate";
  if (key.includes("groq")) return "groq";
  if (key.includes("mistral")) return "mistral";
  if (key.includes("xai") || key.includes("grok")) return "xai";
  return "other";
}

export function modelPickerChannel(providerID: string | null | undefined): ModelPickerChannel {
  return isWodeAppModelProvider(providerID) ? "cloud" : "local";
}

export function modelPickerChannelLabel(channel: ModelPickerChannel): string {
  return MODEL_PICKER_CHANNEL_LABEL[channel];
}

export function modelPickerSourceLabel(channel: ModelPickerChannel): string {
  return channel === "cloud" ? "积分" : "本机 Key";
}

export function modelPickerVendorId(
  providerID: string | null | undefined,
  modelID: string | null | undefined,
): string {
  const fromModel = vendorFromModelKey(String(modelID || ""));
  if (fromModel !== "other") return fromModel;
  const provider = String(providerID || "").trim().toLowerCase();
  if (!provider) return fromModel;
  if (provider.startsWith("local-")) return "custom";
  if (isWodeAppModelProvider(provider)) return fromModel;
  return PROVIDER_VENDOR_ALIASES[provider] || (VENDOR_LABELS[provider] ? provider : "other");
}

export function modelPickerVendorLabel(vendorId: string): string {
  return VENDOR_LABELS[vendorId] || getProviderDisplayName(vendorId);
}

function getProviderDisplayName(providerId: string) {
  return providerId
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export type ModelPickerItem = {
  providerID: string;
  modelID: string;
};

export type ModelPickerVendorGroup<T> = {
  vendorId: string;
  vendorLabel: string;
  items: T[];
};

function compareVendorId(a: string, b: string): number {
  const aRank = VENDOR_PRIORITY.indexOf(a);
  const bRank = VENDOR_PRIORITY.indexOf(b);
  const aOrder = aRank === -1 ? VENDOR_PRIORITY.length : aRank;
  const bOrder = bRank === -1 ? VENDOR_PRIORITY.length : bRank;
  if (aOrder !== bOrder) return aOrder - bOrder;
  return a.localeCompare(b);
}

export type ModelPickerConfigSource = {
  id: string;
  keyPreview?: string;
  probeStatus?: string;
  modelIds?: string[];
  estimated?: boolean;
  modalities?: { text?: boolean; image?: boolean; video?: boolean };
};

export function isModelPickerSourceConfigured(source: ModelPickerConfigSource): boolean {
  if (String(source.keyPreview ?? "").trim()) return true;
  return source.probeStatus === "configured";
}

export function isModelPickerVendorConfigured(
  vendorId: string,
  sources: readonly ModelPickerConfigSource[] = [],
  cloudSignedIn = false,
): boolean {
  if (cloudSignedIn) return true;
  if (sources.some((source) => (
    isWodeAppModelProvider(source.id) && isModelPickerSourceConfigured(source)
  ))) {
    return true;
  }
  return sources.some((source) => {
    if (isWodeAppModelProvider(source.id)) return false;
    return modelPickerVendorId(source.id, "") === vendorId && isModelPickerSourceConfigured(source);
  });
}

/** Known chat vendors to keep visible even before a Key exists. */
export const LOCAL_PICKER_PLACEHOLDER_VENDORS = [
  "kimi",
  "volcano",
  "deepseek",
  "dashscope",
  "minimax",
  "zai",
] as const;

export function withLocalPickerVendorPlaceholders<T>(
  vendors: ModelPickerVendorGroup<T>[],
  extraVendorIds: readonly string[] = LOCAL_PICKER_PLACEHOLDER_VENDORS,
): ModelPickerVendorGroup<T>[] {
  const extras = extraVendorIds
    .map((vendorId) => String(vendorId || "").trim())
    .filter(Boolean);
  if (extras.length === 0) return vendors;

  const have = new Set(vendors.map((vendor) => vendor.vendorId));
  const missing = extras
    .filter((vendorId) => !have.has(vendorId))
    .map((vendorId) => ({
      vendorId,
      vendorLabel: modelPickerVendorLabel(vendorId),
      items: [] as T[],
    }));
  if (missing.length === 0) return vendors;

  return [...vendors, ...missing].sort((a, b) => compareVendorId(a.vendorId, b.vendorId));
}

function preferLocalPickerItems<T extends ModelPickerItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aLocal = !isWodeAppModelProvider(a.providerID);
    const bLocal = !isWodeAppModelProvider(b.providerID);
    if (aLocal !== bLocal) return aLocal ? -1 : 1;
    const family = modelPickerVendorId(a.providerID, a.modelID);
    const aOriginal = (PROVIDER_VENDOR_ALIASES[a.providerID] || a.providerID) === family;
    const bOriginal = (PROVIDER_VENDOR_ALIASES[b.providerID] || b.providerID) === family;
    if (aOriginal !== bOriginal) return aOriginal ? -1 : 1;
    return 0;
  });
}

export function groupModelsForPicker<T extends ModelPickerItem>(
  items: readonly T[],
): ModelPickerVendorGroup<T>[] {
  const vendors = new Map<string, T[]>();
  for (const item of items) {
    const vendorId = modelPickerVendorId(item.providerID, item.modelID);
    const list = vendors.get(vendorId) || [];
    list.push(item);
    vendors.set(vendorId, list);
  }

  return [...vendors.entries()]
    .sort((a, b) => compareVendorId(a[0], b[0]))
    .map(([vendorId, vendorItems]) => ({
      vendorId,
      vendorLabel: modelPickerVendorLabel(vendorId),
      items: preferLocalPickerItems(vendorItems),
    }));
}
