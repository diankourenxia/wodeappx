/**
 * Picker shows a small family list (DeepSeek V4 Flash, 豆包 Seed 2.1 Pro).
 * Vendor /models dumps stay in the matching layer, not the dropdown.
 */

import catalog from "./wode-branded-catalog.json";
import {
  buildModelRoutesFromSources,
  matchModelRoute,
  modelFamilyId,
  modelVariantKey,
  type ModelRoute,
  type ModelRouteRef,
  type ModelRouteSource,
} from "./wodeapp-model-route-match";

type CatalogEntry = {
  apiId: string;
  opencodeKey?: string;
  upstreamId?: string;
  name?: string;
  modality?: "text" | "image" | "video";
};

const catalogEntries = catalog as CatalogEntry[];
let remoteCatalogEntries: CatalogEntry[] | null = null;

function activeCatalogEntries(): CatalogEntry[] {
  return remoteCatalogEntries && remoteCatalogEntries.length > 0
    ? remoteCatalogEntries
    : catalogEntries;
}

export function setRemotePickerCatalog(entries: CatalogEntry[] | null | undefined): void {
  remoteCatalogEntries = Array.isArray(entries) && entries.length > 0 ? entries : null;
}

export type PickerFamilyOption = {
  familyId: string;
  variantKey: string;
  title: string;
  providerID: string;
  modelID: string;
};

export { modelVariantKey };

export function stripWodeModelTitle(name: string): string {
  return String(name || "").replace(/^wode\s+/i, "").trim();
}

function entryModality(entry: CatalogEntry): "text" | "image" | "video" {
  return entry.modality === "image" || entry.modality === "video" ? entry.modality : "text";
}

function catalogEntriesFor(modality: "text" | "image" | "video"): CatalogEntry[] {
  return activeCatalogEntries().filter((entry) => entryModality(entry) === modality);
}

function catalogAliasKeys(entry: CatalogEntry): string[] {
  return [entry.apiId, entry.opencodeKey, entry.upstreamId]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function routeMatchesCatalog(route: ModelRoute, entry: CatalogEntry): boolean {
  if (route.familyId !== modelFamilyId("wodeapp", entry.apiId)) return false;
  const routeKey = modelVariantKey(route.modelID);
  if (!routeKey) return false;
  for (const alias of catalogAliasKeys(entry)) {
    const catalogKey = modelVariantKey(alias);
    if (!catalogKey) continue;
    if (routeKey === catalogKey) return true;
  }
  return false;
}

function pickBestRoute(
  routes: readonly ModelRoute[],
  current: ModelRouteRef | null | undefined,
  modality: "text" | "image" | "video",
): ModelRoute | null {
  return matchModelRoute(current ?? null, routes, modality)
    ?? matchModelRoute(null, routes, modality);
}

function humanizeVariantKey(modelID: string): string {
  const key = modelVariantKey(modelID);
  if (!key) return modelID;
  return key
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => {
      if (/^\d/.test(part)) return part;
      if (part.toLowerCase() === "kimi") return "Kimi";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function familyOptionKey(option: Pick<PickerFamilyOption, "familyId" | "variantKey">): string {
  return `${option.familyId}:${option.variantKey}`;
}

/**
 * Default picker = current catalog families that have a probed route.
 * Vendor /models dumps and older leftover families stay out; users add
 * extra models later via their own config.
 */
export function collapseRoutesToPickerFamilies(
  routes: readonly ModelRoute[],
  modality: "text" | "image" | "video" = "text",
): PickerFamilyOption[] {
  const pooled = routes.filter((route) => route.modality === modality);
  const out: PickerFamilyOption[] = [];
  const seen = new Set<string>();

  const push = (option: PickerFamilyOption) => {
    const key = familyOptionKey(option);
    if (seen.has(key) || !option.modelID) return;
    seen.add(key);
    out.push(option);
  };

  for (const entry of catalogEntriesFor(modality)) {
    const matched = pooled.filter((route) => routeMatchesCatalog(route, entry));
    if (matched.length === 0) continue;
    const catalogIsWode = String(entry.apiId || "").startsWith("wode/");
    const best = pickBestRoute(matched, {
      providerID: catalogIsWode ? "wodeapp" : (matched[0]?.providerID || ""),
      modelID: entry.upstreamId || entry.apiId,
    }, modality);
    if (!best) continue;
    push({
      familyId: modelFamilyId("wodeapp", entry.apiId),
      variantKey: modelVariantKey(entry.upstreamId || entry.apiId),
      title: stripWodeModelTitle(String(entry.name || best.modelID)),
      providerID: best.providerID,
      modelID: best.modelID,
    });
  }

  return out;
}

export function buildPickerFamiliesFromSources(
  sources: readonly ModelRouteSource[],
  modality: "text" | "image" | "video" = "text",
): PickerFamilyOption[] {
  return collapseRoutesToPickerFamilies(buildModelRoutesFromSources(sources), modality);
}

export function pickerFamilyMatchesRef(
  option: Pick<PickerFamilyOption, "familyId" | "modelID" | "providerID">,
  value: ModelRouteRef | null | undefined,
): boolean {
  if (!value?.providerID && !value?.modelID) return false;
  if (option.providerID === value.providerID && option.modelID === value.modelID) return true;
  return modelFamilyId(option.providerID, option.modelID)
    === modelFamilyId(value.providerID, value.modelID)
    && modelVariantKey(option.modelID) === modelVariantKey(value.modelID);
}

export function pickerTitleForModelRef(
  value: ModelRouteRef | null | undefined,
  families: readonly PickerFamilyOption[],
): string | null {
  if (!value) return null;
  const hit = families.find((option) => pickerFamilyMatchesRef(option, value));
  if (hit) return hit.title;
  const catalogHit = activeCatalogEntries().find((entry) => (
    catalogAliasKeys(entry).some((alias) => (
      modelVariantKey(alias) === modelVariantKey(value.modelID)
      && modelFamilyId("wodeapp", entry.apiId) === modelFamilyId(value.providerID, value.modelID)
    ))
  ));
  if (catalogHit?.name) return stripWodeModelTitle(catalogHit.name);
  return stripWodeModelTitle(humanizeVariantKey(value.modelID));
}
