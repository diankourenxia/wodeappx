import { wodeAppCloudCreditsUrl } from "./wodeapp-cloud-region";

/**
 * Vendor API console / billing URLs for BYOK and platform upstream providers.
 * Open these in the built-in browser (`persist:openwork-browser`) so one login sticks.
 */

export type WodeAppProviderBillingLink = {
  id: string;
  name: string;
  meta: string;
  /** Primary action: recharge / balance / subscription */
  billingUrl: string;
  /** Secondary: API keys / console home */
  consoleUrl: string;
};

/**
 * China-first upstreams used by platform text routing + common BYOK providers.
 * Prefer official CN consoles when both CN/global exist.
 */
export const WODEAPP_PROVIDER_BILLING_LINKS: readonly WodeAppProviderBillingLink[] = [
  {
    id: "minimax",
    name: "MiniMax",
    meta: "Token Plan / 套餐充值",
    billingUrl: "https://platform.minimaxi.com/console/plan",
    consoleUrl: "https://platform.minimaxi.com",
  },
  {
    id: "moonshot",
    name: "Kimi / Moonshot",
    meta: "账户充值与用量",
    billingUrl: "https://platform.moonshot.cn/console/account",
    consoleUrl: "https://platform.moonshot.cn/console",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    meta: "用量与充值",
    billingUrl: "https://platform.deepseek.com/usage",
    consoleUrl: "https://platform.deepseek.com",
  },
  {
    id: "dashscope",
    name: "通义千问 / DashScope",
    meta: "阿里云百炼控制台",
    billingUrl: "https://bailian.console.aliyun.com/?tab=model#/costing-balance",
    consoleUrl: "https://bailian.console.aliyun.com/?tab=model#/api-key",
  },
  {
    id: "volcano",
    name: "豆包 / 火山方舟",
    meta: "方舟控制台与计费",
    billingUrl: "https://console.volcengine.com/ark",
    consoleUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
  },
  {
    id: "zai",
    name: "智谱 GLM",
    meta: "开放平台充值",
    billingUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    consoleUrl: "https://open.bigmodel.cn",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    meta: "Credits 充值",
    billingUrl: "https://openrouter.ai/settings/credits",
    consoleUrl: "https://openrouter.ai/keys",
  },
  {
    id: "openai",
    name: "OpenAI",
    meta: "API keys",
    billingUrl: "https://platform.openai.com/settings/organization/billing",
    consoleUrl: "https://platform.openai.com/api-keys",
  },
  {
    id: "google",
    name: "Google Gemini",
    meta: "API keys",
    billingUrl: "https://aistudio.google.com/apikey",
    consoleUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "kling",
    name: "可灵 Kling",
    meta: "控制台与 API 文档",
    billingUrl: "https://app.klingai.com/global/dev/document-api",
    consoleUrl: "https://app.klingai.com/global/dev/document-api",
  },
  {
    id: "runway",
    name: "Runway",
    meta: "API 文档",
    billingUrl: "https://docs.dev.runwayml.com/",
    consoleUrl: "https://docs.dev.runwayml.com/",
  },
  {
    id: "replicate",
    name: "Replicate",
    meta: "API tokens",
    billingUrl: "https://replicate.com/account/api-tokens",
    consoleUrl: "https://replicate.com/account/api-tokens",
  },
] as const;

const PROVIDER_ID_ALIASES: Record<string, string> = {
  kimi: "moonshot",
  doubao: "volcano",
  ark: "volcano",
  seedance: "volcano",
  alibaba: "dashscope",
  glm: "zai",
  zhipu: "zai",
  gemini: "google",
  "openai-image": "openai",
};

export function normalizeProviderBillingId(providerId: string | null | undefined): string {
  const id = String(providerId || "").trim().toLowerCase();
  return PROVIDER_ID_ALIASES[id] || id;
}

export const WODEAPP_OPEN_PROVIDER_BILLING_EVENT = "wodeapp:open-provider-billing";

export type WodeAppOpenProviderBillingDetail = {
  providerId?: string;
  url?: string;
};

export function findWodeAppProviderBillingLink(
  providerId: string | undefined | null,
): WodeAppProviderBillingLink | undefined {
  const id = normalizeProviderBillingId(providerId);
  if (!id) return undefined;
  return WODEAPP_PROVIDER_BILLING_LINKS.find((item) => item.id === id);
}

/** Vendor API-key / console page for a capability-table row. */
export function resolveCapabilityConsoleUrl(providerId: string | null | undefined): string {
  return findWodeAppProviderBillingLink(providerId)?.consoleUrl || "";
}

/** Usage / balance page for a configured capability-table row. */
export function resolveCapabilityUsageUrl(
  providerId: string | null | undefined,
  cloudOrigin?: string | null,
): string {
  const id = normalizeProviderBillingId(providerId);
  if (id === "wodeapp") return wodeAppCloudCreditsUrl(cloudOrigin);
  return findWodeAppProviderBillingLink(providerId)?.billingUrl || "";
}

/** Session route to restore when leaving `/settings/…` so the right browser pane can mount. */
export function sessionPathFromSettingsLocation(
  pathnameAndHash: string,
  lastSessionId?: string | null,
): string | null {
  const loc = String(pathnameAndHash || "");
  if (!/\/settings\//.test(loc)) return null;
  const sessionId = String(lastSessionId || "").trim();
  const match = loc.match(/workspace\/([^/?#]+)/);
  if (!match) return sessionId ? `/session/${encodeURIComponent(sessionId)}` : "/session";
  let workspaceId = match[1];
  try {
    workspaceId = decodeURIComponent(match[1]);
  } catch {
    // keep raw
  }
  const workspace = encodeURIComponent(workspaceId);
  return sessionId
    ? `/workspace/${workspace}/session/${encodeURIComponent(sessionId)}`
    : `/workspace/${workspace}/session`;
}

export function resolveWodeAppProviderBillingUrl(
  input: WodeAppOpenProviderBillingDetail | string | undefined,
): string {
  if (!input) return WODEAPP_PROVIDER_BILLING_LINKS[0]?.billingUrl || "";
  if (typeof input === "string") {
    const found = findWodeAppProviderBillingLink(input);
    return found?.billingUrl || input;
  }
  if (input.url?.trim()) return input.url.trim();
  return findWodeAppProviderBillingLink(input.providerId)?.billingUrl
    || WODEAPP_PROVIDER_BILLING_LINKS[0]?.billingUrl
    || "";
}
