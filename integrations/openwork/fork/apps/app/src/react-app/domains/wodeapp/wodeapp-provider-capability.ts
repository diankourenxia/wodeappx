/**
 * Per-key generation capability snapshot.
 * Classify probed model IDs (and configured media keys) into 对话 / 生图 / 生视频,
 * then drive First Mile, settings, and agent guidance from the same result.
 */

export const WODEAPP_PROVIDER_CAPABILITY_EVENT = "wodeapp:provider-capability";
export const WODEAPP_REFRESH_PROVIDER_CAPABILITY_EVENT = "wodeapp:refresh-provider-capability";

export function requestProviderCapabilityRefresh(force = false): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WODEAPP_REFRESH_PROVIDER_CAPABILITY_EVENT, { detail: { force } }),
  );
}

export type GenerationModality = "text" | "image" | "video";

export type ProviderCapabilityProbeStatus =
  | "ok"
  | "unauthorized"
  | "error"
  | "configured"
  | "skipped";

export type ProviderCapabilityModalities = {
  text: boolean;
  image: boolean;
  video: boolean;
};

export type ProviderCapabilityKeyOrigin =
  | "project-env"
  | "desktop-env"
  | "auth"
  | "media-byok"
  | "process-env"
  | "";

export type ProviderCapabilitySource = {
  id: string;
  label: string;
  keyPreview: string;
  keyOrigin: ProviderCapabilityKeyOrigin;
  probeStatus: ProviderCapabilityProbeStatus;
  /** True when modalities come from vendor fallback, not a live model list. */
  estimated: boolean;
  modelIds: string[];
  sampleModels: string[];
  modalities: ProviderCapabilityModalities;
  error?: string;
};

export type ProviderCapabilityFillHint = {
  vendorId: string;
  label: string;
  why: string;
};

export type ProviderCapabilitySnapshot = {
  ready: boolean;
  probedAt: number;
  sources: ProviderCapabilitySource[];
  union: ProviderCapabilityModalities;
  missing: GenerationModality[];
  fillHints: ProviderCapabilityFillHint[];
  summary: string;
  guidance: string;
};

export type ProviderCapabilityProbeRecord = {
  id: string;
  name?: string;
  description?: string;
  outputModalities?: string[];
};

export type ProviderCapabilityProbeInput = {
  id: string;
  label: string;
  keyPreview?: string;
  keyOrigin?: ProviderCapabilityKeyOrigin | string;
  probeStatus: ProviderCapabilityProbeStatus;
  models?: ProviderCapabilityProbeRecord[];
  /** Media-only keys with no list API (可灵 / Runway). */
  assumed?: Partial<ProviderCapabilityModalities>;
  error?: string;
};

const EMPTY_MODALITIES: ProviderCapabilityModalities = {
  text: false,
  image: false,
  video: false,
};

const IMAGE_GEN_RE =
  /seedream|dall-?e|gpt-image|imagen|flux|qwen-image|stable-diffusion|\bsdxl\b|recraft|ideogram|grok-image|nanobanana|banana|cogview|wanx|kolors|image-generation|text-to-image/i;
const VIDEO_GEN_RE =
  /seedance|kling|runway|hailuo|minimax-video|minimax-h3|veo\b|sora\b|ltx|pika|luma|dreamina|jimeng|keling|video-generation|text-to-video|image-to-video|happyhorse|\bwan2\.|\bwanx2/i;
const VISION_ONLY_RE =
  /\b(vl|vision|omni)\b|qwen-vl|qvq|gpt-4o|claude|sonnet|opus/i;

const VENDOR_ESTIMATE: Record<string, ProviderCapabilityModalities> = {
  deepseek: { text: true, image: false, video: false },
  moonshot: { text: true, image: false, video: false },
  kimi: { text: true, image: false, video: false },
  anthropic: { text: true, image: false, video: false },
  openai: { text: true, image: true, video: false },
  openrouter: { text: true, image: false, video: false },
  dashscope: { text: true, image: true, video: true },
  volcano: { text: true, image: true, video: true },
  doubao: { text: true, image: true, video: true },
  ark: { text: true, image: true, video: true },
  kling: { text: false, image: false, video: true },
  runway: { text: false, image: false, video: true },
  replicate: { text: false, image: true, video: false },
  minimax: { text: true, image: false, video: true },
  google: { text: true, image: true, video: false },
  gemini: { text: true, image: true, video: false },
  zai: { text: true, image: false, video: false },
  "openai-image": { text: false, image: true, video: false },
  wodeapp: { text: true, image: true, video: true },
};

export const IMAGE_GENERATION_TOOL_IDS = [
  "ai_generate_image",
  "product_visual_batch_image_run",
  "wodeapp_batch_image_prepare",
] as const;

export const VIDEO_GENERATION_TOOL_IDS = [
  "video_generate",
  "video_task_status",
  "wodeapp_video_storyboard_open",
  "wodeapp_video_storyboard_update",
  "wodeapp_video_template_render",
] as const;

export const MODALITY_FILL_HINTS: Record<GenerationModality, readonly ProviderCapabilityFillHint[]> = {
  text: [
    { vendorId: "volcano", label: "火山方舟（字节）", why: "同一 Key 可探测豆包对话 + Seedream + Seedance" },
    { vendorId: "deepseek", label: "DeepSeek", why: "国内对话" },
    { vendorId: "moonshot", label: "Kimi", why: "国内对话" },
    { vendorId: "openrouter", label: "OpenRouter", why: "一张 Key 可探测 GPT / Claude / Grok 等" },
    { vendorId: "openai", label: "OpenAI", why: "原厂 GPT 对话与生图" },
  ],
  image: [
    { vendorId: "volcano", label: "火山方舟（字节）", why: "探测到 Seedream 即可生图" },
    { vendorId: "replicate", label: "Replicate", why: "Flux / Nano Banana 等生图" },
    { vendorId: "dashscope", label: "通义百炼（阿里）", why: "探测到千问生图模型即可生图" },
  ],
  video: [
    { vendorId: "volcano", label: "火山方舟（字节）", why: "探测到 Seedance 即可生视频" },
    { vendorId: "dashscope", label: "通义百炼（阿里）", why: "探测到千问/HappyHorse 即可生视频" },
    { vendorId: "kling", label: "可灵", why: "视频 Key" },
  ],
};

const MODALITY_LABEL: Record<GenerationModality, string> = {
  text: "对话",
  image: "生图",
  video: "生视频",
};

const KEY_ORIGIN_LABEL: Record<Exclude<ProviderCapabilityKeyOrigin, "">, string> = {
  "project-env": "项目 .env",
  "desktop-env": "本机 Key",
  auth: "已保存模型 Key",
  "media-byok": "本机 Key",
  "process-env": "进程环境",
};

export function formatKeyOriginLabel(origin: string | undefined): string {
  const key = String(origin ?? "").trim() as Exclude<ProviderCapabilityKeyOrigin, "">;
  return KEY_ORIGIN_LABEL[key] || "";
}

export function normalizeKeyOrigin(value: unknown): ProviderCapabilityKeyOrigin {
  const raw = String(value ?? "").trim();
  if (
    raw === "project-env"
    || raw === "desktop-env"
    || raw === "auth"
    || raw === "media-byok"
    || raw === "process-env"
  ) {
    return raw;
  }
  return "";
}

let cachedSnapshot: ProviderCapabilitySnapshot | null = null;

/** UI treats a snapshot older than this as stale and re-probes the live model list. */
export const CAPABILITY_STALE_MS = 2 * 60 * 1000;

export function isProviderCapabilitySnapshotStale(
  snapshot: ProviderCapabilitySnapshot | null | undefined,
  now = Date.now(),
): boolean {
  if (!snapshot?.ready || !snapshot.probedAt) return true;
  return now - snapshot.probedAt >= CAPABILITY_STALE_MS;
}

export function formatCapabilityProbedAt(probedAt: number | null | undefined, now = Date.now()): string {
  const at = Number(probedAt);
  if (!Number.isFinite(at) || at <= 0) return "";
  const delta = Math.max(0, now - at);
  if (delta < 15_000) return "刚刚更新";
  if (delta < 60_000) return "不到 1 分钟前";
  if (delta < 60 * 60_000) return `${Math.floor(delta / 60_000)} 分钟前更新`;
  return `${Math.floor(delta / 3_600_000)} 小时前更新`;
}

export function emptyModalities(): ProviderCapabilityModalities {
  return { ...EMPTY_MODALITIES };
}

export function unionModalities(
  items: readonly Partial<ProviderCapabilityModalities>[],
): ProviderCapabilityModalities {
  return {
    text: items.some((item) => item.text),
    image: items.some((item) => item.image),
    video: items.some((item) => item.video),
  };
}

export function maskCapabilityKeyPreview(value: string | null | undefined): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.length <= 8) return `${raw.slice(0, 2)}***`;
  return `${raw.slice(0, 4)}***${raw.slice(-4)}`;
}

function parseCapabilityModelDate(id: string): number {
  const raw = String(id ?? "").toLowerCase();
  const long = raw.match(/(?:^|[-_])(\d{8})(?:$|[-_])/);
  if (long) return Number(long[1]);
  const short = raw.match(/(?:^|[-_])(\d{6})(?:$|[-_])/);
  if (!short) return 0;
  const n = Number(short[1]);
  const yy = Math.floor(n / 10_000);
  const rest = n % 10_000;
  return (yy >= 70 ? 1900 + yy : 2000 + yy) * 10_000 + rest;
}

function capabilityModelFamilyScore(id: string): number {
  const raw = String(id ?? "").toLowerCase();
  const seedream = raw.match(/seedream[-_]?(\d{1,2})(?:[-_.](\d{1,2}))?/);
  if (seedream) return Number(seedream[1]) * 100 + Number(seedream[2] || 0);
  const seedance = raw.match(/seedance[-_]?(\d{1,2})(?:[-_.](\d{1,2}))?/);
  if (seedance) return Number(seedance[1]) * 100 + Number(seedance[2] || 0);
  const seed = raw.match(/\bseed[-_](\d{1,2})[-_](\d{1,2})\b/);
  if (seed) return Number(seed[1]) * 100 + Number(seed[2]);
  const version = raw.match(/\bv(\d{1,2})(?:[-_.](\d{1,2}))?(?!\d)/);
  if (version) return Number(version[1]) * 100 + Number(version[2] || 0);
  return 0;
}

function capabilityModelTierScore(id: string): number {
  const raw = String(id ?? "").toLowerCase();
  if (/(?:^|[-_])pro(?:$|[-_])/.test(raw)) return 40;
  if (/turbo|fast/.test(raw)) return 20;
  if (/mini/.test(raw)) return 10;
  if (/lite/.test(raw)) return 5;
  if (/embedding|character|functioncall|browsing|pretrain|distill/.test(raw)) return 0;
  return 30;
}

function capabilityModelVendorBoost(id: string): number {
  const raw = String(id ?? "").toLowerCase();
  if (/seedream|seedance|(?:^|[-_/])seed-\d/.test(raw) || /doubao-seed-/.test(raw)) return 3_000_000_000;
  if (/(?:^|[-_/])doubao-/.test(raw)) return 1_000_000_000;
  return 0;
}

/** Higher is newer / more current. Used so capability chips don't show leftover 2024 ARK IDs. */
export function capabilityModelRecencyScore(id: string): number {
  return capabilityModelVendorBoost(id)
    + capabilityModelFamilyScore(id) * 1_000_000
    + parseCapabilityModelDate(id)
    + capabilityModelTierScore(id);
}

export function sampleModelsForModality(
  source: Pick<ProviderCapabilitySource, "modelIds">,
  modality: GenerationModality,
  limit = 2,
): string[] {
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const id of source.modelIds ?? []) {
    const raw = String(id ?? "").trim();
    if (!raw || seen.has(raw) || !classifyGenerationModel(raw)[modality]) continue;
    seen.add(raw);
    candidates.push(raw);
  }
  candidates.sort((a, b) => {
    const byScore = capabilityModelRecencyScore(b) - capabilityModelRecencyScore(a);
    if (byScore !== 0) return byScore;
    return a.localeCompare(b);
  });
  return candidates.slice(0, Math.max(0, limit));
}

export function shortCapabilityModelLabel(id: string): string {
  const raw = String(id ?? "").trim();
  if (!raw) return "";
  const slash = raw.lastIndexOf("/");
  return slash >= 0 ? raw.slice(slash + 1) : raw;
}

export function capabilitySupportScore(modalities: ProviderCapabilityModalities): number {
  return Number(Boolean(modalities.text))
    + Number(Boolean(modalities.image))
    + Number(Boolean(modalities.video));
}

export function sortSourcesBySupport<T extends {
  modalities: ProviderCapabilityModalities;
  label?: string;
}>(sources: readonly T[]): T[] {
  return [...sources].sort((a, b) => {
    const byCount = capabilitySupportScore(b.modalities) - capabilitySupportScore(a.modalities);
    if (byCount !== 0) return byCount;
    const byVideo = Number(b.modalities.video) - Number(a.modalities.video);
    if (byVideo !== 0) return byVideo;
    const byImage = Number(b.modalities.image) - Number(a.modalities.image);
    if (byImage !== 0) return byImage;
    return String(a.label ?? "").localeCompare(String(b.label ?? ""), "zh");
  });
}

export function formatCapabilitySourceLabel(id: string, fallback = ""): string {
  const key = String(id ?? "").trim().toLowerCase();
  const base = String(fallback ?? "").trim();
  if (key === "volcano" || key === "ark" || key === "doubao" || /火山方舟/.test(base)) {
    return "火山方舟（字节）";
  }
  if (key === "dashscope" || /通义百炼/.test(base)) {
    return "通义百炼（阿里）";
  }
  return base || String(id ?? "").trim();
}

function capabilityTablePin(id: string): number {
  const key = String(id ?? "").trim().toLowerCase();
  if (key === "deepseek") return 0;
  if (key === "moonshot" || key === "kimi") return 1;
  if (key === "volcano" || key === "ark" || key === "doubao") return 2;
  if (key === "dashscope") return 3;
  return 50;
}

export function sortCapabilityTableRows<T extends {
  id: string;
  modalities: ProviderCapabilityModalities;
  label?: string;
}>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const pin = capabilityTablePin(a.id) - capabilityTablePin(b.id);
    if (pin !== 0) return pin;
    const byCount = capabilitySupportScore(b.modalities) - capabilitySupportScore(a.modalities);
    if (byCount !== 0) return byCount;
    return formatCapabilitySourceLabel(a.id, a.label).localeCompare(
      formatCapabilitySourceLabel(b.id, b.label),
      "zh",
    );
  });
}

export function isCapabilitySourceConfigured(
  source: Pick<ProviderCapabilitySource, "keyPreview"> & {
    probeStatus?: ProviderCapabilityProbeStatus;
  },
): boolean {
  if (String(source.keyPreview ?? "").trim()) return true;
  return source.probeStatus === "configured";
}

export function fillHintAsCapabilitySource(hint: ProviderCapabilityFillHint): ProviderCapabilitySource {
  return {
    id: hint.vendorId,
    label: formatCapabilitySourceLabel(hint.vendorId, hint.label),
    keyPreview: "",
    keyOrigin: "",
    probeStatus: "skipped",
    estimated: true,
    modelIds: [],
    sampleModels: [],
    modalities: vendorEstimate(hint.vendorId) ?? emptyModalities(),
  };
}

/** Platform already routes these vendors; do not show them as empty 去配置 when logged in. */
export const CLOUD_COVERED_FILL_VENDOR_IDS = new Set(["dashscope"]);

export function capabilityConfigActionLabel(
  source: Pick<ProviderCapabilitySource, "keyPreview"> & {
    probeStatus?: ProviderCapabilityProbeStatus;
  },
): "已配置" | "去配置" {
  return isCapabilitySourceConfigured(source) ? "已配置" : "去配置";
}

export function hasConfiguredLocalProviderKeys(
  sources: readonly Pick<ProviderCapabilitySource, "id" | "keyPreview">[] = [],
): boolean {
  return sources.some((source) => source.id !== "wodeapp" && isCapabilitySourceConfigured(source));
}

export function unsignedLocalModeHint(
  sources: readonly Pick<ProviderCapabilitySource, "id" | "keyPreview">[] = [],
): string {
  return hasConfiguredLocalProviderKeys(sources) ? "本机 Key · 已配置" : "本机 Key · 可不登录";
}

/** Live WodeApp catalogs for cloud-covered vendor rows (text/image/video registries). */
export const CLOUD_COVERED_VENDOR_MODELS: Record<string, readonly string[]> = {
  dashscope: [
    "qwen3.8-max",
    "qwen-image-3.0-pro",
    "qwen-image-3.0",
    "happyhorse-1.0-r2v",
  ],
};

function fillHintCoveredByCloud(hint: ProviderCapabilityFillHint): ProviderCapabilitySource {
  const estimate = vendorEstimate(hint.vendorId) ?? emptyModalities();
  const modelIds = [...(CLOUD_COVERED_VENDOR_MODELS[hint.vendorId] ?? [])];
  return {
    ...fillHintAsCapabilitySource(hint),
    keyPreview: "",
    probeStatus: "configured",
    modalities: estimate,
    modelIds,
    sampleModels: modelIds.slice(0, 6),
  };
}

function sourceIsConfiguredWodeAppCloud(source: Pick<ProviderCapabilitySource, "id" | "keyPreview">): boolean {
  return source.id === "wodeapp" && isCapabilitySourceConfigured(source);
}

export function mergeCapabilityTableRows(
  sources: readonly ProviderCapabilitySource[],
  fillHints: readonly ProviderCapabilityFillHint[] = resolveFillHints(["text", "image", "video"]),
): ProviderCapabilitySource[] {
  const have = new Set(sources.map((item) => item.id));
  const cloudCovers = sources.some((item) => sourceIsConfiguredWodeAppCloud(item));
  const extras = fillHints
    .filter((hint) => !have.has(hint.vendorId))
    .map((hint) => (
      cloudCovers && CLOUD_COVERED_FILL_VENDOR_IDS.has(hint.vendorId)
        ? fillHintCoveredByCloud(hint)
        : fillHintAsCapabilitySource(hint)
    ));
  return sortCapabilityTableRows([
    ...sources.map((item) => ({
      ...item,
      label: formatCapabilitySourceLabel(item.id, item.label),
    })),
    ...extras,
  ]);
}

export function classifyGenerationModel(
  input: string | ProviderCapabilityProbeRecord | null | undefined,
): ProviderCapabilityModalities {
  const record = typeof input === "string" || input == null
    ? { id: String(input ?? "") }
    : input;
  const id = String(record.id ?? "").trim();
  const haystack = [id, record.name, record.description].filter(Boolean).join(" ");
  const outputs = (record.outputModalities ?? []).map((item) => String(item).toLowerCase());
  if (outputs.includes("video") || VIDEO_GEN_RE.test(haystack)) {
    return { text: false, image: false, video: true };
  }
  if (outputs.includes("image") || IMAGE_GEN_RE.test(haystack)) {
    return { text: false, image: true, video: false };
  }
  if (!id) return emptyModalities();
  if (VISION_ONLY_RE.test(haystack)) {
    return { text: true, image: false, video: false };
  }
  return { text: true, image: false, video: false };
}

export function vendorEstimate(id: string): ProviderCapabilityModalities | null {
  const key = String(id ?? "").trim().toLowerCase();
  return VENDOR_ESTIMATE[key] ? { ...VENDOR_ESTIMATE[key] } : null;
}

export function missingModalities(union: ProviderCapabilityModalities): GenerationModality[] {
  const missing: GenerationModality[] = [];
  if (!union.text) missing.push("text");
  if (!union.image) missing.push("image");
  if (!union.video) missing.push("video");
  return missing;
}

export function resolveFillHints(missing: readonly GenerationModality[]): ProviderCapabilityFillHint[] {
  const seen = new Set<string>();
  const hints: ProviderCapabilityFillHint[] = [];
  for (const modality of missing) {
    for (const hint of MODALITY_FILL_HINTS[modality]) {
      if (seen.has(hint.vendorId)) continue;
      seen.add(hint.vendorId);
      hints.push(hint);
    }
  }
  return hints;
}

function formatSourceLine(source: ProviderCapabilitySource): string {
  const active = (["text", "image", "video"] as const)
    .filter((key) => source.modalities[key])
    .map((key) => MODALITY_LABEL[key]);
  const able = active.length > 0 ? active.join("、") : "未探测到可用模型";
  const suffix = source.estimated ? "（估计）" : "";
  const sample = source.sampleModels.length > 0
    ? `；模型例：${source.sampleModels.slice(0, 3).join("、")}`
    : "";
  return `${source.label}${source.keyPreview ? ` ${source.keyPreview}` : ""}：${able}${suffix}${sample}`;
}

export function formatCapabilitySummary(union: ProviderCapabilityModalities): string {
  const parts = [
    union.text ? "对话可用" : "对话不可用",
    union.image ? "生图可用" : "生图不可用",
    union.video ? "生视频可用" : "生视频不可用",
  ];
  return parts.join("；");
}

export function formatCapabilityGuidance(input: {
  sources: readonly ProviderCapabilitySource[];
  union: ProviderCapabilityModalities;
  fillHints: readonly ProviderCapabilityFillHint[];
}): string {
  if (input.sources.length === 0) {
    return "本机还没配置可用 Key。选厂商配置后会按这把 Key 的模型列表确认对话、生图、生视频。";
  }
  const missing = missingModalities(input.union);
  if (missing.length === 0) {
    return "当前已配置的 Key 覆盖对话、生图和生视频。";
  }
  const need = missing.map((item) => MODALITY_LABEL[item]).join("、");
  const hint = input.fillHints[0];
  if (hint) {
    return `当前缺${need}。可配置${hint.label}：${hint.why}。配好后会重新探测这把 Key 实际能调哪些模型。`;
  }
  return `当前缺${need}。到「设置 → 服务与模型」补对应厂商 Key，保存后会按模型列表探测。`;
}

export function buildProviderCapabilitySource(
  input: ProviderCapabilityProbeInput,
): ProviderCapabilitySource {
  const models = Array.isArray(input.models) ? input.models : [];
  const classified = models.map((model) => ({
    id: String(model.id ?? "").trim(),
    modalities: classifyGenerationModel(model),
  })).filter((item) => item.id);
  const fromModels = unionModalities(classified.map((item) => item.modalities));
  const hasModelList = models.length > 0;
  const assumed = input.assumed
    ? unionModalities([input.assumed])
    : emptyModalities();
  const estimate = vendorEstimate(input.id);
  const probedOk = input.probeStatus === "ok" && hasModelList;
  const unauthorized = input.probeStatus === "unauthorized";
  const modalities = unauthorized
    ? emptyModalities()
    : probedOk
      ? fromModels
      : unionModalities([fromModels, assumed, estimate ?? EMPTY_MODALITIES]);
  const estimated = !unauthorized && !probedOk && (Boolean(input.assumed) || Boolean(estimate) || input.probeStatus === "configured");
  const sampleModels = classified
    .filter((item) => item.modalities.text || item.modalities.image || item.modalities.video)
    .map((item) => item.id)
    .slice(0, 6);

  return {
    id: input.id,
    label: input.label,
    keyPreview: maskCapabilityKeyPreview(input.keyPreview),
    keyOrigin: normalizeKeyOrigin(input.keyOrigin),
    probeStatus: input.probeStatus,
    estimated,
    modelIds: classified.map((item) => item.id),
    sampleModels,
    modalities,
    error: input.error,
  };
}

export function buildProviderCapabilitySnapshot(
  inputs: readonly ProviderCapabilityProbeInput[],
  probedAt = Date.now(),
): ProviderCapabilitySnapshot {
  const sources = sortSourcesBySupport(inputs.map((item) => buildProviderCapabilitySource(item)));
  const union = unionModalities(sources.map((item) => item.modalities));
  const missing = missingModalities(union);
  const fillHints = resolveFillHints(missing);
  return {
    ready: true,
    probedAt,
    sources,
    union,
    missing,
    fillHints,
    summary: formatCapabilitySummary(union),
    guidance: formatCapabilityGuidance({ sources, union, fillHints }),
  };
}

export function snapshotFromCapabilityProbes(
  probes: unknown,
  probedAt = Date.now(),
): ProviderCapabilitySnapshot {
  if (!Array.isArray(probes)) return { ...emptyProviderCapabilitySnapshot(), ready: true, probedAt };
  const inputs: ProviderCapabilityProbeInput[] = probes.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const probeStatus: ProviderCapabilityProbeStatus =
      row.probeStatus === "ok"
      || row.probeStatus === "unauthorized"
      || row.probeStatus === "error"
      || row.probeStatus === "configured"
      || row.probeStatus === "skipped"
        ? row.probeStatus
        : "error";
    return [{
      id: String(row.id ?? ""),
      label: String(row.label ?? row.id ?? ""),
      keyPreview: String(row.keyPreview ?? ""),
      keyOrigin: normalizeKeyOrigin(row.keyOrigin),
      probeStatus,
      models: Array.isArray(row.models) ? row.models as ProviderCapabilityProbeRecord[] : [],
      assumed: row.assumed && typeof row.assumed === "object"
        ? row.assumed as Partial<ProviderCapabilityModalities>
        : undefined,
      error: typeof row.error === "string" ? row.error : undefined,
    }];
  }).filter((item) => item.id);
  return buildProviderCapabilitySnapshot(inputs, probedAt);
}

export function emptyProviderCapabilitySnapshot(): ProviderCapabilitySnapshot {
  return {
    ready: false,
    probedAt: 0,
    sources: [],
    union: emptyModalities(),
    missing: ["text", "image", "video"],
    fillHints: resolveFillHints(["text", "image", "video"]),
    summary: formatCapabilitySummary(emptyModalities()),
    guidance: formatCapabilityGuidance({
      sources: [],
      union: emptyModalities(),
      fillHints: resolveFillHints(["text", "image", "video"]),
    }),
  };
}

export function buildAgentProviderCapabilityPack(
  snapshot: ProviderCapabilitySnapshot | null | undefined,
): string {
  if (!snapshot?.ready) return "";
  const lines = snapshot.sources.map((source) => `- ${formatSourceLine(source)}`);
  const missing = snapshot.missing;
  const block: string[] = [
    "本机 Key 能力探测（按已配置 Key 的模型列表，不是产品功能开关）：",
    snapshot.summary,
    ...lines,
    snapshot.guidance,
  ];
  if (missing.includes("image")) {
    block.push("用户要生图时：不要调用 ai_generate_image / product_visual_batch_image_run。说明当前 Key 没有生图通道，引导去「设置 → 服务与模型」配置火山或百炼，配好后会重新探测。");
  }
  if (missing.includes("video")) {
    block.push("用户要生视频时：不要调用 video_generate / wodeapp_video_storyboard_open。说明当前 Key 没有生视频通道，引导配置火山或可灵。");
  }
  if (missing.includes("text")) {
    block.push("还没有可对话的 Key。引导先配置 DeepSeek / Kimi / 火山豆包 / 百炼文字模型。");
  }
  return block.join("\n");
}

export function generationToolsHiddenBySnapshot(
  snapshot: ProviderCapabilitySnapshot | null | undefined,
): string[] {
  if (!snapshot?.ready) return [];
  const hidden: string[] = [];
  if (!snapshot.union.image) hidden.push(...IMAGE_GENERATION_TOOL_IDS);
  if (!snapshot.union.video) hidden.push(...VIDEO_GENERATION_TOOL_IDS);
  return hidden;
}

export function readCachedProviderCapabilitySnapshot(): ProviderCapabilitySnapshot | null {
  return cachedSnapshot;
}

export function writeCachedProviderCapabilitySnapshot(
  snapshot: ProviderCapabilitySnapshot | null,
): void {
  cachedSnapshot = snapshot;
}

export function publishProviderCapabilitySnapshot(
  snapshot: ProviderCapabilitySnapshot,
): void {
  writeCachedProviderCapabilitySnapshot(snapshot);
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(WODEAPP_PROVIDER_CAPABILITY_EVENT, { detail: snapshot }),
  );
}

export function normalizeProviderCapabilitySnapshot(
  input: unknown,
): ProviderCapabilitySnapshot | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (!Array.isArray(record.sources)) return null;
  const sources = record.sources.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const modalities = row.modalities && typeof row.modalities === "object"
      ? row.modalities as Record<string, unknown>
      : {};
    return [{
      id: String(row.id ?? ""),
      label: String(row.label ?? row.id ?? ""),
      keyPreview: String(row.keyPreview ?? ""),
      keyOrigin: normalizeKeyOrigin(row.keyOrigin),
      probeStatus: (
        row.probeStatus === "ok"
        || row.probeStatus === "unauthorized"
        || row.probeStatus === "error"
        || row.probeStatus === "configured"
        || row.probeStatus === "skipped"
      ) ? row.probeStatus : "error",
      estimated: row.estimated === true,
      modelIds: Array.isArray(row.modelIds) ? row.modelIds.map((id) => String(id)) : [],
      sampleModels: Array.isArray(row.sampleModels) ? row.sampleModels.map((id) => String(id)) : [],
      modalities: {
        text: Boolean(modalities.text),
        image: Boolean(modalities.image),
        video: Boolean(modalities.video),
      },
      error: typeof row.error === "string" ? row.error : undefined,
    } satisfies ProviderCapabilitySource];
  });
  const union = record.union && typeof record.union === "object"
    ? unionModalities([record.union as ProviderCapabilityModalities])
    : unionModalities(sources.map((item) => item.modalities));
  const missing = missingModalities(union);
  const fillHints = resolveFillHints(missing);
  return {
    ready: record.ready !== false,
    probedAt: Number(record.probedAt) || Date.now(),
    sources,
    union,
    missing,
    fillHints,
    summary: typeof record.summary === "string" && record.summary.trim()
      ? record.summary
      : formatCapabilitySummary(union),
    guidance: typeof record.guidance === "string" && record.guidance.trim()
      ? record.guidance
      : formatCapabilityGuidance({ sources, union, fillHints }),
  };
}
