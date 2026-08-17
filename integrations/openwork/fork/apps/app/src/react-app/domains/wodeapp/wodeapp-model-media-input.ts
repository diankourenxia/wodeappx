import type { ModelRef } from "@/app/types";
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";

import catalog from "./wode-branded-catalog.json";
import {
  isWodeAppModelProvider,
  WODEAPP_LEGACY_PROVIDER_ID,
  WODEAPP_PROVIDER_ID,
} from "./wodeapp-model-display";
import { modelSupportsVisionInput } from "./wodeapp-model-capabilities";

/**
 * How the chat path should feed this media kind to the model.
 *
 * - `native` — multimodal content / file part; do not pre-parse
 * - `file_api` — provider Files API (still no WodeApp vision-parse side-path)
 * - `extract` — local tools or attachment-intelligence first
 * - `unsupported` — model cannot consume this kind
 */
export type MediaInputMode = "native" | "file_api" | "extract" | "unsupported";

/** Optional catalog override; omit on text-only models (defaults from capabilities). */
export type CatalogMediaInput = {
  image?: MediaInputMode;
  video?: MediaInputMode;
  pdf?: MediaInputMode;
  office?: MediaInputMode;
  remoteImageUrl?: boolean;
};

export type ModelMediaInputSpec = {
  keys: string[];
  label: string;
  image: MediaInputMode;
  video: MediaInputMode;
  pdf: MediaInputMode;
  office: MediaInputMode;
  remoteImageUrl: boolean;
};

export type ResolvedMediaInputCapabilities = {
  image: boolean;
  video: boolean;
  pdf: boolean;
  office: boolean;
  remoteImageUrl: boolean;
  /** Skip WodeApp remote vision-parse for kinds this model can take natively / via file_api. */
  skipRemoteVisionParse: boolean;
  specKey: string;
  notes: string;
};

type CatalogEntry = {
  apiId: string;
  opencodeKey: string;
  upstreamId?: string;
  name?: string;
  capabilities?: string[];
  mediaInput?: CatalogMediaInput;
};

const MEDIA_MODES = new Set<MediaInputMode>(["native", "file_api", "extract", "unsupported"]);

function asMode(value: unknown, fallback: MediaInputMode): MediaInputMode {
  return typeof value === "string" && MEDIA_MODES.has(value as MediaInputMode)
    ? (value as MediaInputMode)
    : fallback;
}

function hasVisionCapability(capabilities: string[] | undefined): boolean {
  return (capabilities || []).some((item) => {
    const normalized = item.trim().toLowerCase();
    return normalized === "vision"
      || normalized === "vision_input"
      || normalized === "image_input"
      || normalized === "multimodal";
  });
}

/** Defaults derived from catalog capabilities — no parallel TS table. */
function defaultsFromCapabilities(capabilities: string[] | undefined): Omit<ModelMediaInputSpec, "keys" | "label"> {
  if (hasVisionCapability(capabilities)) {
    return {
      image: "native",
      video: "native",
      pdf: "extract",
      office: "extract",
      remoteImageUrl: true,
    };
  }
  return {
    image: "unsupported",
    video: "unsupported",
    pdf: "extract",
    office: "extract",
    remoteImageUrl: false,
  };
}

function mergeMediaInput(
  entry: CatalogEntry,
): ModelMediaInputSpec {
  const base = defaultsFromCapabilities(entry.capabilities);
  const override = entry.mediaInput || {};
  return {
    keys: [entry.apiId, entry.opencodeKey, entry.upstreamId].filter(Boolean) as string[],
    label: entry.name || entry.apiId,
    image: asMode(override.image, base.image),
    video: asMode(override.video, base.video),
    pdf: asMode(override.pdf, base.pdf),
    office: asMode(override.office, base.office),
    remoteImageUrl: typeof override.remoteImageUrl === "boolean"
      ? override.remoteImageUrl
      : base.remoteImageUrl,
  };
}

const SPEC_BY_KEY = new Map<string, ModelMediaInputSpec>();
for (const entry of catalog as CatalogEntry[]) {
  const spec = mergeMediaInput(entry);
  for (const key of spec.keys) {
    SPEC_BY_KEY.set(key.trim().toLowerCase(), spec);
  }
}

function modeAllowsChatPart(mode: MediaInputMode): boolean {
  return mode === "native";
}

function modeSkipsRemoteVisionParse(mode: MediaInputMode): boolean {
  return mode === "native" || mode === "file_api";
}

function lookupSpecByModelId(modelID: string): ModelMediaInputSpec | null {
  const raw = modelID.trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  return SPEC_BY_KEY.get(lower)
    || SPEC_BY_KEY.get(lower.replace(/^wode\//, ""))
    || SPEC_BY_KEY.get(lower.split("/").pop() || "")
    || null;
}

export function findModelMediaInputSpec(
  model: ModelRef | null | undefined,
): ModelMediaInputSpec | null {
  if (!model) return null;
  return lookupSpecByModelId(model.modelID)
    || lookupSpecByModelId(`${model.providerID}/${model.modelID}`);
}

/** Catalog rows that declare an explicit mediaInput override (for docs/tests). */
export function listCatalogMediaInputOverrides(): CatalogEntry[] {
  return (catalog as CatalogEntry[]).filter((entry) => Boolean(entry.mediaInput));
}

/**
 * Resolve media-input routing for the current chat model.
 * Branded catalog is the source; unknown models fall back to vision hints.
 */
export function resolveModelMediaInputCapabilities(
  model: ModelRef | null | undefined,
  providerList?: ProviderListResponse | null,
): ResolvedMediaInputCapabilities {
  const spec = findModelMediaInputSpec(model);
  if (spec) {
    return {
      image: modeAllowsChatPart(spec.image),
      video: modeAllowsChatPart(spec.video),
      pdf: modeAllowsChatPart(spec.pdf),
      office: modeAllowsChatPart(spec.office),
      remoteImageUrl: spec.remoteImageUrl,
      skipRemoteVisionParse: modeSkipsRemoteVisionParse(spec.image)
        && modeSkipsRemoteVisionParse(spec.video)
        && modeSkipsRemoteVisionParse(spec.pdf)
        && modeSkipsRemoteVisionParse(spec.office),
      specKey: spec.keys[0],
      notes: spec.label,
    };
  }

  const vision = modelSupportsVisionInput(model ?? null, providerList);
  const isWode = model ? isWodeAppModelProvider(model.providerID) : false;
  return {
    image: vision,
    video: false,
    pdf: vision && !isWode,
    office: false,
    remoteImageUrl: vision,
    skipRemoteVisionParse: vision,
    specKey: model ? `${model.providerID}/${model.modelID}` : "unknown",
    notes: vision
      ? "未进品牌目录：仅按 vision 直送图片；视频/PDF/Office 默认抽文本。"
      : "未进品牌目录且无视觉：媒体走解析/抽文本。",
  };
}

export function mediaKindNeedsParseTool(
  caps: ResolvedMediaInputCapabilities,
  kind: "image" | "video" | "pdf" | "office",
): boolean {
  return !caps[kind];
}

export function providerListHasWodeAppAlias(
  providerList: ProviderListResponse | null | undefined,
  providerID: string,
): boolean {
  if (!providerList) return false;
  return (providerList.all ?? []).some((item) =>
    item.id === providerID
    || (providerID === WODEAPP_PROVIDER_ID && item.id === WODEAPP_LEGACY_PROVIDER_ID)
    || (providerID === WODEAPP_LEGACY_PROVIDER_ID && item.id === WODEAPP_PROVIDER_ID),
  );
}

/** Canonical Kimi Code ids (Wode branded). */
export const KIMI_CODE_K3_MODEL_ID = "wode/kimi-code-k3";
export const KIMI_CODE_K3_256K_MODEL_ID = "wode/kimi-code-k3-256k";
/** Upstream / live-cache ids still present in some OpenCode sidecar configs. */
export const KIMICODE_K3_UPSTREAM_ID = "kimicode/k3";
export const KIMICODE_K3_256K_UPSTREAM_ID = "kimicode/k3-256k";

const KIMI_CODE_K3_256K_ALIASES = new Set([
  KIMI_CODE_K3_256K_MODEL_ID,
  "wode-kimi-code-k3-256k",
  KIMICODE_K3_256K_UPSTREAM_ID,
  "k3-256k",
]);

function normalizeModelIdKey(modelID: string | null | undefined): string {
  return String(modelID ?? "").trim().toLowerCase();
}

export function isKimiCodeK3_256kModel(model: ModelRef | null | undefined): boolean {
  if (!model) return false;
  const id = normalizeModelIdKey(model.modelID);
  if (KIMI_CODE_K3_256K_ALIASES.has(id)) return true;
  return id.endsWith("/k3-256k") || id.endsWith("kimi-code-k3-256k");
}

/**
 * Prefer same id family as the current 256k model, then branded / Moonshot video-capable
 * fallbacks. OpenCode sidecar configs often expose live `kimicode/k3*` without `wode/kimi-code-*`.
 */
export function kimiCodeVideoUpgradeCandidates(currentModelID: string): string[] {
  const id = normalizeModelIdKey(currentModelID);
  const brandedFirst = [
    KIMI_CODE_K3_MODEL_ID,
    KIMICODE_K3_UPSTREAM_ID,
    "wode/kimi-k3",
    "moonshotai/kimi-k3",
  ];
  const upstreamFirst = [
    KIMICODE_K3_UPSTREAM_ID,
    KIMI_CODE_K3_MODEL_ID,
    "wode/kimi-k3",
    "moonshotai/kimi-k3",
  ];
  if (
    id === KIMICODE_K3_256K_UPSTREAM_ID
    || id === "k3-256k"
    || (id.endsWith("/k3-256k") && id.includes("kimicode"))
  ) {
    return upstreamFirst;
  }
  return brandedFirst;
}

function collectAvailableModelIds(
  availableModelIds?: Iterable<string> | null,
): Set<string> | null {
  if (!availableModelIds) return null;
  const set = new Set<string>();
  for (const id of availableModelIds) {
    const trimmed = String(id ?? "").trim();
    if (trimmed) set.add(trimmed);
  }
  return set.size > 0 ? set : null;
}

/** True when the current turn carries a video attachment or @ video asset. */
export function draftHasVideoMediaInput(draft: {
  attachments?: Array<{ mimeType?: string; name?: string; kind?: string } | null> | null;
  assetMentions?: Array<{
    assetFileType?: string;
    assetFileName?: string;
    name?: string;
    assetFiles?: Array<{ type?: string; name?: string } | null> | null;
  } | null> | null;
} | null | undefined): boolean {
  if (!draft) return false;
  const attachments = draft.attachments ?? [];
  for (const attachment of attachments) {
    if (!attachment) continue;
    const mime = String(attachment.mimeType ?? "").toLowerCase();
    const name = String(attachment.name ?? "");
    const kind = String(attachment.kind ?? "").toLowerCase();
    if (kind === "video" || mime.startsWith("video/") || /\.(mp4|mov|webm|mkv|m4v)$/i.test(name)) {
      return true;
    }
  }
  for (const mention of draft.assetMentions ?? []) {
    if (!mention) continue;
    const mime = String(mention.assetFileType ?? "").toLowerCase();
    const name = String(mention.assetFileName || mention.name || "");
    if (mime.startsWith("video/") || /\.(mp4|mov|webm|mkv|m4v)$/i.test(name)) return true;
    for (const file of mention.assetFiles ?? []) {
      if (!file) continue;
      const fileMime = String(file.type ?? "").toLowerCase();
      const fileName = String(file.name ?? "");
      if (fileMime.startsWith("video/") || /\.(mp4|mov|webm|mkv|m4v)$/i.test(fileName)) return true;
    }
  }
  return false;
}

export type KimiCodeVideoModelAdaptResult = {
  model: ModelRef;
  upgraded: boolean;
  fromModelID?: string;
  toModelID?: string;
  reason?: string;
};

/**
 * Kimi Code `k3-256k` rejects video input; when this turn has video, upgrade to `k3`
 * (official multimodal table). Quota: within 256k, `k3` ≈ 2× `k3-256k`.
 *
 * Target id must exist in the OpenCode provider catalog — some runtimes only register
 * live `kimicode/k3`, not branded `wode/kimi-code-k3`.
 */
export function adaptKimiCodeModelForVideoInput(
  model: ModelRef | null | undefined,
  draft: Parameters<typeof draftHasVideoMediaInput>[0],
  options?: { availableModelIds?: Iterable<string> | null },
): KimiCodeVideoModelAdaptResult | null {
  if (!model) return null;
  if (!draftHasVideoMediaInput(draft)) {
    return { model, upgraded: false };
  }
  if (!isKimiCodeK3_256kModel(model)) {
    return { model, upgraded: false };
  }
  const available = collectAvailableModelIds(options?.availableModelIds);
  const candidates = kimiCodeVideoUpgradeCandidates(model.modelID);
  const picked = available
    ? candidates.find((id) => available.has(id))
    : candidates[0];
  if (!picked) {
    return {
      model,
      upgraded: false,
      fromModelID: model.modelID,
      reason: "k3-256k_video_but_no_k3_available",
    };
  }
  const next: ModelRef = {
    providerID: model.providerID || WODEAPP_PROVIDER_ID,
    modelID: picked,
  };
  return {
    model: next,
    upgraded: true,
    fromModelID: model.modelID,
    toModelID: picked,
    reason: "k3-256k_no_video_upgrade_to_k3",
  };
}
