export const WODEAPP_FEISHU_AUTHORIZE_DEEP_LINK = "wodeappx://feishu/authorize";

const SUPPORTED_SCHEMES = new Set(["wodeappx:", "openwork:", "openwork-dev:"]);
const FORBIDDEN_SECRET_PARAMS = new Set(["app_secret", "appsecret", "secret", "token"]);

export type WodeAppFeishuAuthorizeDeepLink = {
  action: "authorize";
  source: string | null;
};

export function parseWodeAppFeishuAuthorizeDeepLink(
  rawUrl: string,
): WodeAppFeishuAuthorizeDeepLink | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (!SUPPORTED_SCHEMES.has(url.protocol.toLowerCase())) return null;
    if (url.hostname.toLowerCase() !== "feishu") return null;
    if (url.pathname.replace(/\/+$/, "").toLowerCase() !== "/authorize") return null;
    if ([...url.searchParams.keys()].some((key) => FORBIDDEN_SECRET_PARAMS.has(key.toLowerCase()))) {
      return null;
    }

    const source = url.searchParams.get("source")?.trim().slice(0, 80) || null;
    return { action: "authorize", source };
  } catch {
    return null;
  }
}

export function isWodeAppFeishuAuthorizeDeepLink(rawUrl: string): boolean {
  return parseWodeAppFeishuAuthorizeDeepLink(rawUrl) !== null;
}
