/**
 * Model family → available send routes.
 *
 * A route is a probed (providerID, modelID, modality) that actually appeared
 * on that vendor's /models (or an assumed media-only key). Matching never
 * invents a volcano-Kimi path.
 */

import { modelPickerVendorId } from "./wodeapp-model-display";
import {
  classifyGenerationModel,
  type GenerationModality,
} from "./wodeapp-provider-capability";

export type ModelRouteRef = {
  providerID: string;
  modelID: string;
};

export type ModelRoute = ModelRouteRef & {
  familyId: string;
  modality: GenerationModality;
};

const ORIGINAL_PROVIDERS: Record<string, readonly string[]> = {
  kimi: ["moonshot", "kimi", "kimicode"],
  volcano: ["volcano", "doubao", "ark"],
  deepseek: ["deepseek"],
  dashscope: ["dashscope", "alibaba", "qwen"],
  openai: ["openai"],
  anthropic: ["anthropic"],
  xai: ["xai", "x-ai"],
  google: ["google", "gemini"],
  replicate: ["replicate"],
  minimax: ["minimax"],
  zai: ["zai", "zhipu", "glm"],
  runway: ["runway"],
  kling: ["kling"],
};

const REPLICATE_IMAGE_FLOOR = "google/nano-banana";
const PLATFORM_PROVIDERS = new Set(["wodeapp", "wode"]);

export function modelFamilyId(providerID: string, modelID: string): string {
  return modelPickerVendorId(providerID, modelID);
}

export function modelStem(modelID: string): string {
  let value = String(modelID || "").trim().toLowerCase();
  if (value.startsWith("wode/")) value = value.slice(5);
  const slash = value.lastIndexOf("/");
  if (slash >= 0) value = value.slice(slash + 1);
  return value;
}

/** Collapse dated catalog rows: deepseek-v4-flash-0731 → deepseek-v4-flash. */
export function modelVariantKey(modelID: string): string {
  let stem = modelStem(modelID);
  stem = stem.replace(/[-_](?:20)?\d{6}(?=[-_]|$)/g, "");
  stem = stem.replace(/[-_]\d{4}$/g, "");
  return stem.replace(/[-_]{2,}/g, "-").replace(/^[-_]+|[-_]+$/g, "");
}

/** YYMMDD / YYYYMMDD / trailing MMDD snapshot, or 0 if the id is undated. */
export function modelDateStamp(modelID: string): number {
  const value = String(modelID || "");
  let best = 0;
  for (const match of value.matchAll(/[-_]((?:20)\d{6}|\d{6})(?=[-_.]|$)/g)) {
    let raw = match[1] || "";
    if (raw.length === 6) raw = `${Number(raw.slice(0, 2)) >= 70 ? "19" : "20"}${raw}`;
    const n = Number(raw);
    if (Number.isFinite(n) && n > best) best = n;
  }
  const trailing = value.match(/[-_](\d{4})$/);
  if (trailing) {
    const mm = Number(trailing[1].slice(0, 2));
    const dd = Number(trailing[1].slice(2));
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      const n = 2026 * 10000 + mm * 100 + dd;
      if (n > best) best = n;
    }
  }
  return best;
}

export function isOriginalProvider(familyId: string, providerID: string): boolean {
  const originals = ORIGINAL_PROVIDERS[familyId];
  if (!originals) return false;
  return originals.includes(String(providerID || "").trim().toLowerCase());
}

function routeRank(route: ModelRoute): number {
  const provider = String(route.providerID || "").trim().toLowerCase();
  if (isOriginalProvider(route.familyId, provider)) return 0;
  if (PLATFORM_PROVIDERS.has(provider)) return 2;
  return 1;
}

function routeScore(route: ModelRoute, current: ModelRouteRef | null | undefined): number {
  let score = routeRank(route) * 100;
  if (current && modelVariantKey(route.modelID) === modelVariantKey(current.modelID)) score -= 50;
  return score;
}

function compareRoutes(a: ModelRoute, b: ModelRoute, current?: ModelRouteRef | null): number {
  const byScore = routeScore(a, current) - routeScore(b, current);
  if (byScore !== 0) return byScore;
  const byDate = modelDateStamp(b.modelID) - modelDateStamp(a.modelID);
  if (byDate !== 0) return byDate;
  return a.modelID.localeCompare(b.modelID);
}

export function inferRouteModality(
  modelID: string,
  outputModalities?: readonly string[],
): GenerationModality {
  const classified = classifyGenerationModel({
    id: modelID,
    outputModalities: outputModalities ? [...outputModalities] : undefined,
  });
  if (classified.video) return "video";
  if (classified.image) return "image";
  return "text";
}

export type ModelRouteSource = {
  id: string;
  modelIds?: readonly string[];
  modalities?: { text?: boolean; image?: boolean; video?: boolean };
  estimated?: boolean;
};

export function buildModelRoutesFromSources(
  sources: readonly ModelRouteSource[],
): ModelRoute[] {
  const routes: ModelRoute[] = [];
  const seen = new Set<string>();
  const push = (route: ModelRoute) => {
    const key = `${route.providerID}:${route.modelID}:${route.modality}`;
    if (seen.has(key) || !route.modelID) return;
    seen.add(key);
    routes.push(route);
  };

  for (const source of sources) {
    const providerID = String(source.id || "").trim();
    if (!providerID) continue;
    const ids = Array.isArray(source.modelIds) ? source.modelIds : [];
    for (const raw of ids) {
      const modelID = String(raw || "").trim();
      if (!modelID) continue;
      const modality = inferRouteModality(modelID);
      push({
        providerID,
        modelID,
        familyId: modelFamilyId(providerID, modelID),
        modality,
      });
    }
    if (ids.length === 0 && source.estimated) {
      if (source.modalities?.image && providerID === "replicate") {
        push({
          providerID,
          modelID: REPLICATE_IMAGE_FLOOR,
          familyId: "replicate",
          modality: "image",
        });
      }
      if (source.modalities?.text) {
        // Media-only keys with no list should not invent chat models.
      }
    }
  }
  return routes;
}

export function buildModelRoutesFromConnected(
  connected: ReadonlyArray<{ id: string; models: readonly string[] }>,
): ModelRoute[] {
  return buildModelRoutesFromSources(
    connected.map((item) => ({
      id: item.id,
      modelIds: [...item.models],
      modalities: { text: true, image: false, video: false },
      estimated: false,
    })),
  );
}

export function matchModelRoute(
  current: ModelRouteRef | null | undefined,
  routes: readonly ModelRoute[],
  modality: GenerationModality = "text",
): ModelRoute | null {
  const pool = routes.filter((route) => route.modality === modality);
  if (pool.length === 0) return null;

  const hasCurrent = Boolean(current?.providerID || current?.modelID);
  if (!hasCurrent) {
    const originals = pool.filter((route) => routeRank(route) === 0);
    const ranked = [...(originals.length ? originals : pool)].sort((a, b) => compareRoutes(a, b));
    return ranked[0] ?? null;
  }

  const family = modelFamilyId(current!.providerID, current!.modelID);
  const variant = modelVariantKey(current!.modelID);
  let familyPool = pool.filter((route) => route.familyId === family);
  // Kimi K3 vs K2.5 share vendor family `kimi` but are different products.
  // Dated snapshots (deepseek-v4-flash-0731) share a variant key; those still
  // collapse. Missing variant → do not guess another generation.
  if (variant) {
    const variantPool = familyPool.filter((route) => modelVariantKey(route.modelID) === variant);
    if (variantPool.length === 0) return null;
    familyPool = variantPool;
  }
  if (familyPool.length === 0) return null;
  const ranked = [...familyPool].sort((a, b) => compareRoutes(a, b, current));
  return ranked[0] ?? null;
}

export function matchGenerationRoute(
  sources: readonly ModelRouteSource[],
  modality: GenerationModality,
  current?: ModelRouteRef | null,
): ModelRoute | null {
  return matchModelRoute(current ?? null, buildModelRoutesFromSources(sources), modality);
}
