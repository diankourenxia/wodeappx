export const WODEAPP_CLOUD_ORIGIN_AI = "https://wodeapp.ai";
export const WODEAPP_CLOUD_ORIGIN_CN = "https://wodeapp.cn";
export const WODEAPP_CLOUD_REGION_STORAGE_KEY = "wodeappx.cloud-region";

export type WodeAppCloudRegion = "ai" | "cn";

const CN_TIMEZONES = new Set([
  "Asia/Shanghai",
  "Asia/Urumqi",
  "Asia/Chongqing",
]);

export function originForCloudRegion(region: WodeAppCloudRegion): string {
  return region === "cn" ? WODEAPP_CLOUD_ORIGIN_CN : WODEAPP_CLOUD_ORIGIN_AI;
}

export function cloudRegionFromOrigin(origin?: string | null): WodeAppCloudRegion | null {
  const value = String(origin || "").trim().toLowerCase();
  if (value.includes("wodeapp.cn")) return "cn";
  if (value.includes("wodeapp.ai")) return "ai";
  return null;
}

export function suggestCloudRegion(): WodeAppCloudRegion {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (CN_TIMEZONES.has(timeZone)) return "cn";
  } catch {
    // ignore
  }
  return "ai";
}

export function readStoredCloudRegion(): WodeAppCloudRegion | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(WODEAPP_CLOUD_REGION_STORAGE_KEY);
    return raw === "cn" || raw === "ai" ? raw : null;
  } catch {
    return null;
  }
}

export function writeStoredCloudRegion(region: WodeAppCloudRegion): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WODEAPP_CLOUD_REGION_STORAGE_KEY, region);
  } catch {
    // ignore
  }
}

export function wodeAppCloudSiteUrl(
  origin: string | null | undefined,
  path: "/pricing" | "/credits",
): string {
  const region = cloudRegionFromOrigin(origin) || readStoredCloudRegion();
  const base = region
    ? originForCloudRegion(region)
    : String(origin || WODEAPP_CLOUD_ORIGIN_AI).replace(/\/$/, "");
  return `${base}${path}`;
}

export function wodeAppCloudPricingUrl(origin?: string | null): string {
  return wodeAppCloudSiteUrl(origin, "/pricing");
}

export function wodeAppCloudCreditsUrl(origin?: string | null): string {
  return wodeAppCloudSiteUrl(origin, "/credits");
}
