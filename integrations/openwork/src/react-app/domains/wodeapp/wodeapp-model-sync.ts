import { DEFAULT_MODEL } from "@/app/constants";
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";
import type { WodeAppAuthConfig } from "@/app/lib/wodeapp-auth";
import type { LocalPreferences } from "@/react-app/kernel/local-provider";
import { writeStoredDefaultModel } from "@/react-app/kernel/model-config";
import { getConnectedProviderItems } from "@/react-app/infra/provider-list-query";
import type { ModelRef } from "@/app/types";
import { modelEquals, parseModelRef } from "@/app/utils";

import catalog from "./wode-branded-catalog.json";
import {
  isWodeAppModelProvider,
  normalizeWodeAppModelRef,
  WODEAPP_LEGACY_PROVIDER_ID,
  wodeAppCatalogModelKeys,
  wodeAppModelRegion,
} from "./wodeapp-model-display";
import { buildModelRoutesFromConnected, matchModelRoute } from "./wodeapp-model-route-match";

export const WODEAPP_PROVIDER_ID = "wodeapp";

/** 与 integrations/wodeapp-cloud/electron/wodeapp-provider.mjs 保持一致 */
export const WODEAPP_DEFAULT_MODEL: ModelRef = {
  providerID: WODEAPP_PROVIDER_ID,
  modelID: "wode/deepseek-v4-flash",
};

const LEGACY_WODE_PROVIDER_IDS = new Set([WODEAPP_LEGACY_PROVIDER_ID, WODEAPP_PROVIDER_ID]);

const WODEAPP_MODEL_ALIASES: Record<string, string[]> = Object.fromEntries(
  catalog.flatMap((entry) => {
    const aliases = [entry.opencodeKey, entry.apiId, entry.upstreamId];
    return aliases.map((key) => [key, aliases] as const);
  }),
);

/** 旧模型别名，自动迁到 WODEAPP_DEFAULT_MODEL */
const DEPRECATED_WODE_MODEL_IDS = new Set([
  // Older sessions persisted the upstream id instead of the Wode-branded id.
  // Treat those values as migration candidates so the next workbench start
  // does not send them as a direct provider model.
  "deepseek/deepseek-v4-pro",
  "deepseek/deepseek-v4-flash",
  "anthropic/claude-opus-4.6",
  "anthropic/claude-sonnet-4.6",
  "google/gemini-3.5-flash",
  "openai/gpt-5.2",
  "wode-opus-4.8",
  "wode-opus",
  "opus-4.8",
  "opus-4.6",
  "wode/opus-4.8",
  "wode/gpt-5.5",
  "wode-gpt-5.5",
  "wode-gpt",
  "wode-sonnet",
  "wode-gemini",
]);

/**
 * Defaults written by earlier WodeAppX releases. Separate from
 * DEPRECATED_WODE_MODEL_IDS: these remain valid user choices and migrate once.
 */
const LEGACY_DEFAULT_MODEL_IDS = new Set([
  "wode/minimax-m3",
  "wode-minimax-m3",
  "minimax/MiniMax-M3",
  "minimax/minimax-m3",
  "deepseek/deepseek-v4-pro",
  "wode/deepseek-v4-pro",
  "wode/kimi-k3",
  "wode-kimi-k3",
  "moonshotai/kimi-k3",
  "wode/kimi-code-k3-256k",
  "wode-kimi-code-k3-256k",
  "kimicode/k3-256k",
]);

export function shouldMigrateLegacyWodeAppDefault(
  current: ModelRef | null | undefined,
): boolean {
  return Boolean(
    current
      && LEGACY_WODE_PROVIDER_IDS.has(current.providerID)
      && LEGACY_DEFAULT_MODEL_IDS.has(current.modelID),
  );
}

function modelKeysForLookup(modelID: string): string[] {
  const trimmed = modelID.trim();
  const aliases = WODEAPP_MODEL_ALIASES[trimmed] ?? [];
  return [trimmed, ...aliases];
}

export function resolveAvailableWodeAppModel(
  providerList: ProviderListResponse | null | undefined,
  preferred: ModelRef = WODEAPP_DEFAULT_MODEL,
): ModelRef | null {
  const providers = getConnectedProviderItems(providerList);
  const wodeapp =
    providers.find((item) => item.id === WODEAPP_PROVIDER_ID) ??
    providers.find((item) => item.id === WODEAPP_LEGACY_PROVIDER_ID);
  if (!wodeapp) return null;
  const modelIds = Object.keys(wodeapp.models ?? {});
  if (modelIds.length === 0) return null;

  const candidates = [
    ...modelKeysForLookup(preferred.modelID),
    ...modelKeysForLookup(WODEAPP_DEFAULT_MODEL.modelID),
    ...wodeAppCatalogModelKeys(),
  ];
  const seen = new Set<string>();
  const orderedCandidates = candidates.filter((candidate) => {
    if (!candidate || seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });

  for (const candidate of orderedCandidates) {
    if (modelIds.includes(candidate)) {
      return { providerID: wodeapp.id, modelID: candidate };
    }
  }

  return { providerID: wodeapp.id, modelID: modelIds[0] };
}

/**
 * Map a workbench/UI model ref onto an id that OpenCode's connected wodeapp
 * provider actually registers. Live sidecars often expose `kimicode/k3-256k`
 * without branded `wode/kimi-code-k3-256k` — sending the branded id causes
 * ProviderModelNotFoundError.
 */
function connectedProviderIdsFromList(
  providerList: ProviderListResponse | null | undefined,
): string[] {
  return getConnectedProviderItems(providerList).map((item) => item.id);
}

const NON_CHAT_BYOK_MODEL = /seedream|seedance|tts|embed|rerank|image-generation/i;

/** Unsigned local-key lane: pick a chat model from connected BYOK providers. */
export function resolveAvailableByokChatModel(
  providerList: ProviderListResponse | null | undefined,
): ModelRef | null {
  for (const provider of getConnectedProviderItems(providerList)) {
    if (isWodeAppModelProvider(provider.id)) continue;
    if (provider.id === "opencode" || provider.id === "openwork") continue;
    const modelIds = Object.keys(provider.models ?? {});
    const chatId = modelIds.find((id) => !NON_CHAT_BYOK_MODEL.test(id)) ?? modelIds[0];
    if (chatId) return { providerID: provider.id, modelID: chatId };
  }
  return null;
}

/**
 * True when the ref is a non-platform provider that is currently authorized
 * (auth.json / connected list). OpenWork / OpenCode Zen are not local BYOK.
 */
export function isAuthorizedByokModelRef(
  current: ModelRef | null | undefined,
  connectedProviderIds?: readonly string[] | null,
): boolean {
  if (!current?.providerID || !String(current.modelID ?? "").trim()) return false;
  if (isWodeAppModelProvider(current.providerID)) return false;
  if (current.providerID === "opencode" || current.providerID === "openwork") return false;
  if (!connectedProviderIds?.length) return false;
  return connectedProviderIds.includes(current.providerID);
}

function hasLocalConnectedProviders(
  connectedProviderIds?: readonly string[] | null,
): boolean {
  return Boolean(connectedProviderIds?.some((id) => (
    id
    && !isWodeAppModelProvider(id)
    && id !== "opencode"
    && id !== "openwork"
  )));
}

export function resolveConnectedWodeAppPromptModel(
  preferred: ModelRef | null | undefined,
  providerList: ProviderListResponse | null | undefined,
): ModelRef {
  const connectedProviderIds = connectedProviderIdsFromList(providerList);
  const resolved = resolvePreferredWorkbenchModel(providerList, preferred);
  if (resolved) return resolved;
  // OSS first-run / empty key: return empty ref instead of defaulting to cloud model
  return normalizeWodeAppModelRefForWorkbench(preferred, { connectedProviderIds });
}

export function resolvePreferredWorkbenchModel(
  providerList: ProviderListResponse | null | undefined,
  current: ModelRef | null | undefined,
): ModelRef | null {
  const connected = getConnectedProviderItems(providerList).map((item) => ({
    id: item.id,
    models: Object.keys(item.models ?? {}),
  }));
  const routes = buildModelRoutesFromConnected(connected);
  const matched = matchModelRoute(current, routes, "text");
  if (matched) {
    return { providerID: matched.providerID, modelID: matched.modelID };
  }

  const connectedProviderIds = connectedProviderIdsFromList(providerList);

  if (current && isAuthorizedByokModelRef(current, connectedProviderIds)) {
    const provider = getConnectedProviderItems(providerList).find(
      (item) => item.id === current.providerID,
    );
    if (provider) {
      const modelIds = Object.keys(provider.models ?? {});
      if (modelIds.length === 0 || modelIds.includes(current.modelID)) {
        return { providerID: current.providerID, modelID: current.modelID };
      }
    }
  }

  if (current && isWodeAppModelProvider(current.providerID) && String(current.modelID ?? "").trim()) {
    const normalizedCurrent = normalizeWodeAppModelRef(current);
    if (wodeAppModelRegion(normalizedCurrent.modelID) === "international") {
      return resolveAvailableWodeAppModel(providerList, WODEAPP_DEFAULT_MODEL)
        ?? resolveAvailableByokChatModel(providerList);
    }
    const wode = resolveAvailableWodeAppModel(providerList, normalizedCurrent);
    if (wode) return wode;
  }

  return resolveAvailableByokChatModel(providerList)
    // OSS first-run / empty key: return null instead of cloud model fallback
    ?? null;
}

export function wodeAppDefaultModelRef(
  _config?: Pick<WodeAppAuthConfig, "providerId" | "defaultModelId"> | null,
): ModelRef {
  return { ...WODEAPP_DEFAULT_MODEL };
}

export function wodeAppAuthConfigToModelRef(
  config: Pick<WodeAppAuthConfig, "providerId" | "defaultModelId">,
): ModelRef {
  return wodeAppDefaultModelRef(config);
}

export function shouldAutoSwitchToWodeAppModel(
  current: ModelRef | null,
  options?: { workbench?: boolean; connectedProviderIds?: readonly string[] },
): boolean {
  if (hasLocalConnectedProviders(options?.connectedProviderIds)) {
    if (!current) return false;
    if (isAuthorizedByokModelRef(current, options?.connectedProviderIds)) return false;
    if (isWodeAppModelProvider(current.providerID) && DEPRECATED_WODE_MODEL_IDS.has(current.modelID)) {
      return true;
    }
    return false;
  }
  if (!current) return false;
  if (modelEquals(current, DEFAULT_MODEL)) return true;
  if (current.providerID === "opencode") return true;
  if (isAuthorizedByokModelRef(current, options?.connectedProviderIds)) return false;
  if (isWodeAppModelProvider(current.providerID) && DEPRECATED_WODE_MODEL_IDS.has(current.modelID)) {
    return true;
  }
  return false;
}

export type NormalizeWorkbenchModelOptions = {
  replaceInternational?: boolean;
  /** Provider ids from auth.json / connected list — authorized BYOK is kept. */
  connectedProviderIds?: readonly string[];
};

export function normalizeWodeAppModelRefForWorkbench(
  current: ModelRef | null | undefined,
  options?: NormalizeWorkbenchModelOptions,
): ModelRef {
  // OSS first-run / empty key: no model unless there's a local BYOK provider or explicit choice
  if (!current?.providerID || !String(current.modelID ?? "").trim()) {
    // Return empty ref (needs-key state) instead of defaulting to cloud model
    return { providerID: "", modelID: "" };
  }

  if (isAuthorizedByokModelRef(current, options?.connectedProviderIds)) {
    return { providerID: current.providerID, modelID: current.modelID };
  }

  if (!isWodeAppModelProvider(current.providerID)) {
    if (hasLocalConnectedProviders(options?.connectedProviderIds)) {
      return { providerID: current.providerID, modelID: current.modelID };
    }
    // Non-WodeApp provider without connected providers → empty (needs-key state)
    return { providerID: "", modelID: "" };
  }

  const normalized = normalizeWodeAppModelRef(current);
  if (options?.replaceInternational && wodeAppModelRegion(normalized.modelID) === "international") {
    return {
      providerID: current.providerID,
      modelID: WODEAPP_DEFAULT_MODEL.modelID,
    };
  }
  return normalized;
}

export const FLASH_DEFAULT_MIGRATION_KEY = "wodeappx.defaultModel.deepseekV4Flash.v1";
export const USER_DEFAULT_MODEL_CHOICE_KEY = "wodeappx.defaultModel.userChoice.v1";

export function hasUserChoseDefaultModel(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(USER_DEFAULT_MODEL_CHOICE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markUserChoseDefaultModel(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(USER_DEFAULT_MODEL_CHOICE_KEY, "1");
    window.localStorage.setItem(FLASH_DEFAULT_MIGRATION_KEY, "1");
  } catch {
    // The in-memory preference still applies for this run.
  }
}

export function forceApplyWodeAppDefaultModel(
  setPrefs: (updater: (previous: LocalPreferences) => LocalPreferences) => void,
  model: ModelRef = WODEAPP_DEFAULT_MODEL,
): boolean {
  let changed = false;
  setPrefs((previous) => {
    if (previous.defaultModel && modelEquals(previous.defaultModel, model)) {
      return previous;
    }
    changed = true;
    writeStoredDefaultModel(model);
    return { ...previous, defaultModel: model, modelVariant: null };
  });
  return changed;
}

/** Persist a user-picked model so later new chats open with the same one. */
export function rememberUserSelectedDefaultModel(
  setPrefs: (updater: (previous: LocalPreferences) => LocalPreferences) => void,
  model: ModelRef,
): void {
  forceApplyWodeAppDefaultModel(setPrefs, model);
  markUserChoseDefaultModel();
}

export function applyWodeAppDefaultModelToPrefs(
  config: Pick<WodeAppAuthConfig, "providerId" | "defaultModelId"> | null,
  setPrefs: (updater: (previous: LocalPreferences) => LocalPreferences) => void,
  current: ModelRef | null,
  options?: { workbench?: boolean; force?: boolean },
): boolean {
  const next = wodeAppDefaultModelRef(config);
  if (options?.force || shouldAutoSwitchToWodeAppModel(current, options)) {
    return forceApplyWodeAppDefaultModel(setPrefs, next);
  }
  return false;
}

export function parseWodeAppModelRef(raw: string | null | undefined): ModelRef | null {
  const parsed = parseModelRef(raw?.trim() ?? null);
  if (!parsed || !isWodeAppModelProvider(parsed.providerID)) return null;
  return parsed;
}

/** WodeAppX 工作台：平台模型由后台同步，不向用户展示检测/不可用状态。 */
export function shouldHideWodeAppModelDetection(
  workbench: boolean | undefined,
  model: ModelRef | null | undefined,
): boolean {
  return Boolean(workbench && isWodeAppModelProvider(model?.providerID));
}
