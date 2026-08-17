/**
 * Optional client for GET /mainserver/api/ai/model-families.
 * Picker defaults to the bundled wode-branded-catalog.json and does not fetch.
 * Call this later when a user with their own keys wants to refresh families.
 */

import {
  originForCloudRegion,
  readStoredCloudRegion,
  suggestCloudRegion,
  WODEAPP_CLOUD_ORIGIN_AI,
} from "./wodeapp-cloud-region";
import { setRemotePickerCatalog } from "./wodeapp-model-picker-families";

type RemoteFamily = {
  id?: string;
  title?: string;
  aliases?: string[];
};

function familiesOrigin(authOrigin?: string | null): string {
  const fromAuth = String(authOrigin || "").trim();
  if (fromAuth) {
    try {
      return new URL(fromAuth).origin;
    } catch {
      return fromAuth.replace(/\/+$/, "");
    }
  }
  const region = readStoredCloudRegion() || suggestCloudRegion();
  return originForCloudRegion(region) || WODEAPP_CLOUD_ORIGIN_AI;
}

export function applyRemoteModelFamilies(payload: { families?: RemoteFamily[] } | null | undefined): number {
  const families = Array.isArray(payload?.families) ? payload.families : [];
  const entries = families.flatMap((family) => {
    const aliases = Array.isArray(family.aliases) ? family.aliases.map((item) => String(item || "").trim()).filter(Boolean) : [];
    const apiId = String(family.id || aliases[0] || "").trim();
    if (!apiId) return [];
    return [{
      apiId,
      opencodeKey: aliases[1],
      upstreamId: aliases[2] || aliases[1],
      name: String(family.title || apiId),
    }];
  });
  setRemotePickerCatalog(entries);
  return entries.length;
}

export async function refreshRemoteModelFamilies(authOrigin?: string | null): Promise<number> {
  const origin = familiesOrigin(authOrigin);
  const response = await fetch(`${origin}/mainserver/api/ai/model-families`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) return 0;
  const payload = await response.json() as { families?: RemoteFamily[] };
  return applyRemoteModelFamilies(payload);
}
