import type { ModelCapability, ModelOption, ModelRef, ProviderListItem } from "@/app/types";
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";

import catalog from "./wode-branded-catalog.json";
import {
  isWodeAppModelProvider,
  WODEAPP_LEGACY_PROVIDER_ID,
  WODEAPP_PROVIDER_ID,
} from "./wodeapp-model-display";

type CatalogEntry = {
  apiId: string;
  opencodeKey: string;
  upstreamId?: string;
  name?: string;
  capabilities?: string[];
};

type ModelCapabilityInput = {
  providerID: string;
  modelID: string;
  title?: string | null;
  description?: string | null;
  capabilities?: readonly string[] | null;
};

const catalogEntries = catalog as CatalogEntry[];

const WODEAPP_CAPABILITIES_BY_KEY = new Map<string, string[]>(
  catalogEntries.flatMap((entry) => {
    const capabilities = entry.capabilities ?? ["chat"];
    return [entry.apiId, entry.opencodeKey, entry.upstreamId]
      .filter((key): key is string => Boolean(key))
      .map((key) => [key, capabilities] as const);
  }),
);

const VISION_HINT_RE =
  /\b(vision|visual|multimodal|multi-modal|omni|vl|qwen-vl|qvq|gpt-4o|gpt-4\.1|gpt-5|gemini|claude|sonnet|opus|minimax|doubao|seed|glm|zhipu|kimi|step)\b/i;
const TEXT_ONLY_HINT_RE = /\b(deepseek|codestral|code|embedding|rerank|tts|whisper)\b/i;

function rawCapabilitiesForModel(input: ModelCapabilityInput): string[] {
  const explicit = input.capabilities?.filter(Boolean) ?? [];
  if (explicit.length > 0) return explicit.map(String);
  if (isWodeAppModelProvider(input.providerID)) {
    return WODEAPP_CAPABILITIES_BY_KEY.get(input.modelID) ?? ["chat"];
  }
  return [];
}

function coerceCapabilityTokenList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => coerceCapabilityTokenList(item));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  return [];
}

function collectProviderModelCapabilityTokens(metadata: {
  capabilities?: unknown;
  input?: unknown;
  modalities?: unknown;
} | null | undefined): string[] {
  const tokens: string[] = [];
  const capabilities = metadata?.capabilities;
  if (capabilities && typeof capabilities === "object" && !Array.isArray(capabilities)) {
    const cap = capabilities as Record<string, unknown>;
    if (cap.attachment === true) tokens.push("attachment");
    if (cap.reasoning === true) tokens.push("reasoning");
    const nestedInput = cap.input;
    if (nestedInput && typeof nestedInput === "object" && !Array.isArray(nestedInput)) {
      const input = nestedInput as Record<string, boolean>;
      if (input.image) tokens.push("vision", "image_input");
      if (input.video) tokens.push("video");
      if (input.audio) tokens.push("audio");
      if (input.pdf) tokens.push("pdf");
    }
    const nestedOutput = cap.output;
    if (nestedOutput && typeof nestedOutput === "object" && !Array.isArray(nestedOutput)) {
      const output = nestedOutput as Record<string, boolean>;
      if (output.image) tokens.push("image_generation");
      if (output.video) tokens.push("video_generation");
      if (output.audio) tokens.push("audio");
    }
  } else {
    tokens.push(...coerceCapabilityTokenList(capabilities));
  }
  tokens.push(...coerceCapabilityTokenList(metadata?.input));
  tokens.push(...coerceCapabilityTokenList(metadata?.modalities));
  return tokens;
}

function normalizeCapability(value: string): ModelCapability | null {
  const normalized = value.trim().toLowerCase().replace(/[-\s]+/g, "_");
  if (!normalized) return null;
  if (["chat", "text", "reasoning", "tool", "tools"].includes(normalized)) return "text";
  if (["vision", "vision_input", "image_input", "multimodal", "multi_modal"].includes(normalized)) return "vision_input";
  if (["image", "image_generation", "text_to_image"].includes(normalized)) return "image_generation";
  if (["image_edit", "image_editing"].includes(normalized)) return "image_edit";
  if (["video", "video_generation"].includes(normalized)) return "video_generation";
  if (["audio", "speech", "voice"].includes(normalized)) return "audio";
  return null;
}

export function inferModelCapabilities(input: ModelCapabilityInput): ModelCapability[] {
  const capabilities = new Set<ModelCapability>(["text"]);
  for (const capability of rawCapabilitiesForModel(input)) {
    const normalized = normalizeCapability(capability);
    if (normalized) capabilities.add(normalized);
  }

  const haystack = [
    input.providerID,
    input.modelID,
    input.title ?? "",
    input.description ?? "",
  ].join(" ");
  if (!capabilities.has("vision_input") && VISION_HINT_RE.test(haystack) && !TEXT_ONLY_HINT_RE.test(haystack)) {
    capabilities.add("vision_input");
  }

  return [...capabilities];
}

export function modelCapabilityLabels(capabilities: readonly ModelCapability[] | null | undefined): string[] {
  const values = new Set(capabilities ?? ["text"]);
  return [
    values.has("text") ? "文本" : "",
    values.has("vision_input") ? "识图" : "",
    values.has("image_generation") ? "生图" : "",
    values.has("image_edit") ? "改图" : "",
    values.has("video_generation") ? "视频" : "",
    values.has("audio") ? "音频" : "",
  ].filter(Boolean);
}

export function modelCapabilitySearchText(capabilities: readonly ModelCapability[] | null | undefined): string {
  return modelCapabilityLabels(capabilities).join(" ").toLowerCase();
}

export function withInferredModelCapabilities(option: ModelOption): ModelOption {
  const capabilities = inferModelCapabilities(option);
  return { ...option, capabilities };
}

function providerModelForRef(
  providerList: ProviderListResponse | null | undefined,
  model: ModelRef | null | undefined,
): ProviderListItem["models"][string] | null {
  if (!providerList || !model) return null;
  const provider = (providerList.all ?? []).find((item) =>
    item.id === model.providerID ||
    (model.providerID === WODEAPP_PROVIDER_ID && item.id === WODEAPP_LEGACY_PROVIDER_ID) ||
    (model.providerID === WODEAPP_LEGACY_PROVIDER_ID && item.id === WODEAPP_PROVIDER_ID),
  );
  return provider?.models?.[model.modelID] ?? null;
}

export function modelSupportsVisionInput(
  model: ModelRef | null | undefined,
  providerList?: ProviderListResponse | null,
): boolean {
  if (!model) return false;
  const providerModel = providerModelForRef(providerList, model);
  const metadata = providerModel as unknown as {
    name?: string;
    capabilities?: string[];
    input?: string[];
    modalities?: string[];
  } | null;
  const capabilities = inferModelCapabilities({
    providerID: model.providerID,
    modelID: model.modelID,
    title: metadata?.name,
    capabilities: collectProviderModelCapabilityTokens(metadata),
  });
  return capabilities.includes("vision_input");
}
