type WodeAppAuthConfig = {
  origin: string;
  user: { id?: string; name?: string | null } | null;
  embedded?: boolean;
  profile?: "cloud" | "selfhost" | "local-only";
  providerId: string;
  defaultModelId: string;
  modelIds: string[];
  credits: number | null;
  builtInTools?: WodeAppBuiltInToolsHealth;
  hasLocalKeys?: boolean;
  abilityProjects?: WodeAppAbilityProject[];
  abilityProjectsSyncError?: string | null;
};

export type WodeAppBuiltInToolsHealth = {
  ok: boolean;
  signedIn: boolean;
  status: string;
  endpoint?: string;
  httpStatus?: number;
  toolCount: number;
  transport?: string;
  error?: string;
};

export type WodeAppAbilityProject = {
  id: string;
  kind: "image" | "video" | "short-drama" | "canvas" | string;
  title: string;
  projectId: string;
  name: string;
  slug: string;
  subdomain: string;
  url: string;
  launchUrl: string;
  createdAt?: string;
  updatedAt?: string;
};

type WodeAppAuthResponse =
  | { ok: true; signedIn: false; config: null }
  | { ok: true; signedIn: true; config: WodeAppAuthConfig; provider?: unknown }
  | { ok: false; error: string };

function electronBridge() {
  const bridge = (window as unknown as {
    __OPENWORK_ELECTRON__?: {
      invokeDesktop?: (command: string, ...args: unknown[]) => Promise<unknown>;
      wodeappAuth?: { invoke: (action: string, payload?: unknown) => Promise<unknown> };
    };
  }).__OPENWORK_ELECTRON__;
  return bridge?.wodeappAuth ?? null;
}

async function desktopFetchViaMain(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const invokeDesktop = (window as unknown as {
    __OPENWORK_ELECTRON__?: { invokeDesktop?: (command: string, ...args: unknown[]) => Promise<unknown> };
  }).__OPENWORK_ELECTRON__?.invokeDesktop;
  if (!invokeDesktop) {
    throw new Error("WodeApp desktop request bridge is unavailable");
  }
  const result = (await invokeDesktop("__fetch", input, {
    method: init.method,
    headers: init.headers ? Object.fromEntries(new Headers(init.headers).entries()) : undefined,
    body: typeof init.body === "string" ? init.body : undefined,
    timeoutMs,
  })) as { status: number; statusText: string; headers: Array<[string, string]>; body: string };

  const nullBodyStatuses = new Set([101, 204, 205, 304]);
  return new Response(nullBodyStatuses.has(result.status) ? null : result.body, {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });
}

async function fetchDirect(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const signal = timeoutMs > 0 && typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
  return fetch(input, { ...init, signal });
}

function hasDesktopFetchBridge(): boolean {
  return Boolean(
    (window as unknown as {
      __OPENWORK_ELECTRON__?: { invokeDesktop?: unknown };
    }).__OPENWORK_ELECTRON__?.invokeDesktop,
  );
}

async function fetchWodeAppApi(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  try {
    return await fetchDirect(input, init, timeoutMs);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    const looksLikeCorsOrNetwork =
      error instanceof TypeError ||
      message.includes("Failed to fetch") ||
      message.includes("NetworkError") ||
      message.includes("Load failed") ||
      message.includes("CORS");
    // Web（非 Electron）没有主进程 fetch 兜底，直接抛原始错误。
    if (!looksLikeCorsOrNetwork || !hasDesktopFetchBridge()) {
      throw error;
    }
    return desktopFetchViaMain(input, init, timeoutMs);
  }
}

// ---------------------------------------------------------------------------
// Web（非 Electron）凭证分支
// 桌面端凭证在主进程 ~/.wodeapp/config.json；web 版直接请求平台 API，
// 凭证存 localStorage。opencode provider 同步由部署侧（openwork-server 宿主机）
// 负责，applyProvider 在 web 上是 no-op。
// ---------------------------------------------------------------------------

const WODEAPP_CLOUD_ORIGIN_AI = "https://wodeapp.ai";
const WODEAPP_CLOUD_ORIGIN_CN = "https://wodeapp.cn";
const WODEAPP_CLOUD_ORIGIN = WODEAPP_CLOUD_ORIGIN_AI;
const WEB_CREDENTIALS_STORAGE_KEY = "wodeapp.cloud.credentials.v1";
const WODEAPP_PROVIDER_ID = "wodeapp";
const WODEAPP_PREFERRED_MODEL_KEY = "wode/deepseek-v4-flash";
const PLATFORM_MCP_HEALTH_TIMEOUT_MS = 5000;

type WebStoredCredentials = {
  origin: string;
  apiKey: string;
  user?: { id?: string; name?: string | null } | null;
  abilityProjects?: WodeAppAbilityProject[];
};

function isWebAuthRuntime(): boolean {
  return typeof window !== "undefined" && typeof fetch === "function" && !electronBridge();
}

function emitAuthChanged() {
  try {
    window.dispatchEvent(new Event("wodeapp:auth-changed"));
  } catch {
    // ignore
  }
}

/** 与 electron/config-store.mjs 的 normalizeWodeAppCloudOrigin 保持一致 */
function normalizeWebCloudOrigin(origin?: string): string {
  const cleaned = (origin || WODEAPP_CLOUD_ORIGIN).replace(/\/$/, "");
  try {
    const parsed = new URL(cleaned);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "wodeapp.ai") return WODEAPP_CLOUD_ORIGIN_AI;
    if (host === "wodeapp.cn") return WODEAPP_CLOUD_ORIGIN_CN;
    return parsed.origin;
  } catch {
    return cleaned || WODEAPP_CLOUD_ORIGIN;
  }
}

export function peekWebApiKey(): string | null {
  if (typeof window === "undefined") return null;
  return readWebCredentials()?.apiKey?.trim() || null;
}

function readWebCredentials(): WebStoredCredentials | null {
  try {
    const raw = window.localStorage.getItem(WEB_CREDENTIALS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WebStoredCredentials> | null;
    if (!parsed || typeof parsed.origin !== "string" || typeof parsed.apiKey !== "string") {
      return null;
    }
    if (!parsed.origin.trim() || !parsed.apiKey.trim()) return null;
    return {
      origin: parsed.origin,
      apiKey: parsed.apiKey,
      user: parsed.user && typeof parsed.user === "object" ? parsed.user : null,
      abilityProjects: normalizeAbilityProjects((parsed as WebStoredCredentials).abilityProjects),
    };
  } catch {
    return null;
  }
}

function normalizeAbilityProjects(value: unknown): WodeAppAbilityProject[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): WodeAppAbilityProject | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const id = asAuthText(record.id);
      const url = asAuthText(record.launchUrl) || asAuthText(record.url);
      if (!id || !url) return null;
      return {
        id,
        kind: asAuthText(record.kind) || "image",
        title: asAuthText(record.title) || asAuthText(record.name) || id,
        projectId: asAuthText(record.projectId) || "",
        name: asAuthText(record.name) || asAuthText(record.title) || id,
        slug: asAuthText(record.slug) || "",
        subdomain: asAuthText(record.subdomain) || asAuthText(record.slug) || "",
        url,
        launchUrl: url,
        createdAt: asAuthText(record.createdAt),
        updatedAt: asAuthText(record.updatedAt),
      };
    })
    .filter((item): item is WodeAppAbilityProject => Boolean(item));
}

function writeWebCredentials(credentials: WebStoredCredentials) {
  try {
    window.localStorage.setItem(WEB_CREDENTIALS_STORAGE_KEY, JSON.stringify(credentials));
  } catch {
    // ignore (private mode 等)
  }
}

function clearWebCredentials() {
  try {
    window.localStorage.removeItem(WEB_CREDENTIALS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function asAuthText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function fetchWebModelIds(credentials: WebStoredCredentials): Promise<{
  ids: string[];
  names: Record<string, string>;
}> {
  const platformOrigin = wodeAppPlatformOrigin(credentials.origin);
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${credentials.apiKey}`,
    "X-API-Key": credentials.apiKey,
  };

  // 首选 runtime 文字模型列表（与桌面端 fetchWodeAppRuntimeTextModelIds 对齐）
  try {
    const res = await fetchDirect(`${platformOrigin}/runtime-server/api/ai/models`, { headers }, 15000);
    if (res.ok) {
      const json = (await res.json()) as {
        models?: unknown;
        registry?: { text?: unknown };
      };
      const source = Array.isArray(json?.models)
        ? json.models
        : Array.isArray(json?.registry?.text)
          ? json.registry.text
          : [];
      const ids: string[] = [];
      const names: Record<string, string> = {};
      for (const item of source as Array<Record<string, unknown>>) {
        const id = String(item?.value ?? item?.id ?? item?.modelId ?? "").trim();
        if (!id || ids.includes(id)) continue;
        ids.push(id);
        const label = String(item?.label ?? item?.name ?? "").trim();
        if (label) names[id] = label;
      }
      if (ids.length > 0) return { ids, names };
    }
  } catch {
    // fall through
  }

  // 兜底：ai/v1 models 列表
  try {
    const res = await fetchDirect(`${wodeAppAiBaseUrl(credentials.origin)}/models`, { headers }, 15000);
    if (res.ok) {
      const json = (await res.json()) as { data?: Array<{ id?: unknown }> };
      const ids = Array.isArray(json?.data)
        ? json.data.map((entry) => String(entry?.id ?? "").trim()).filter(Boolean)
        : [];
      if (ids.length > 0) return { ids, names: {} };
    }
  } catch {
    // fall through
  }
  return { ids: [], names: {} };
}

async function fetchWebCredits(credentials: WebStoredCredentials): Promise<number | null> {
  try {
    const res = await fetchDirect(`${wodeAppPlatformOrigin(credentials.origin)}/mainserver/api/credits`, {
      headers: {
        Accept: "application/json",
        "X-API-Key": credentials.apiKey,
      },
    }, 15000);
    const json = (await res.json()) as { success?: boolean; data?: { credits?: unknown } };
    if (json?.success && typeof json.data?.credits === "number") {
      return json.data.credits;
    }
    return null;
  } catch {
    return null;
  }
}

/** 与 electron/wodeapp-provider.mjs 的 fetchWodeAppPlatformToolsHealth 对齐 */
async function fetchWebToolsHealth(credentials: WebStoredCredentials): Promise<WodeAppBuiltInToolsHealth> {
  const endpoint = `${wodeAppPlatformOrigin(credentials.origin)}/mainserver/mcp`;
  try {
    const response = await fetchDirect(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.apiKey}`,
        "X-API-Key": credentials.apiKey,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }, PLATFORM_MCP_HEALTH_TIMEOUT_MS);

    const raw = await response.text();
    if (response.status === 401 || response.status === 403) {
      return { ok: false, signedIn: true, status: "auth_failed", httpStatus: response.status, endpoint, toolCount: 0 };
    }
    if (!response.ok) {
      return { ok: false, signedIn: true, status: "unreachable", httpStatus: response.status, endpoint, toolCount: 0 };
    }
    const dataLine = raw.includes("data:")
      ? raw.split("\n").filter((line) => line.startsWith("data:")).pop()?.slice(5).trim()
      : raw;
    const parsed = JSON.parse(dataLine || raw || "{}") as { result?: { tools?: unknown } };
    const tools = parsed?.result?.tools;
    if (!Array.isArray(tools)) {
      return { ok: false, signedIn: true, status: "invalid_response", httpStatus: response.status, endpoint, toolCount: 0 };
    }
    return {
      ok: true,
      signedIn: true,
      status: "ready",
      httpStatus: response.status,
      endpoint,
      toolCount: tools.length,
      transport: "streamable-http",
    };
  } catch (error) {
    return {
      ok: false,
      signedIn: true,
      status: "unreachable",
      endpoint,
      toolCount: 0,
      error: error instanceof Error ? error.message : "WodeApp built-in tools are unavailable",
    };
  }
}

async function fetchWebAbilityProjectsDetailed(credentials: WebStoredCredentials): Promise<{
  projects: WodeAppAbilityProject[];
  error: string | null;
}> {
  try {
    const res = await fetchDirect(`${wodeAppPlatformOrigin(credentials.origin)}/mainserver/api/auth/wodeappx-bootstrap`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.apiKey}`,
        "X-API-Key": credentials.apiKey,
      },
      body: "{}",
    }, 45000);
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
      data?: { abilityProjects?: unknown; errors?: Array<{ message?: string }> };
    };
    if (!res.ok) {
      return {
        projects: [],
        error: typeof json?.error === "string" && json.error.trim() ? json.error.trim() : `平台返回 ${res.status}`,
      };
    }
    const projects = normalizeAbilityProjects(json?.data?.abilityProjects);
    if (projects.length > 0) {
      return { projects, error: null };
    }
    const bootstrapMessage = json?.data?.errors?.find((item) => typeof item?.message === "string")?.message;
    return {
      projects: [],
      error: bootstrapMessage || "暂未获取到专属智能体项目",
    };
  } catch (error) {
    return {
      projects: [],
      error: error instanceof Error ? error.message : "网络连接失败",
    };
  }
}

async function fetchWebAbilityProjects(credentials: WebStoredCredentials): Promise<WodeAppAbilityProject[]> {
  const result = await fetchWebAbilityProjectsDetailed(credentials);
  return result.projects;
}

function chooseWebDefaultModelId(ids: string[]): string {
  const key = ids.includes(WODEAPP_PREFERRED_MODEL_KEY) ? WODEAPP_PREFERRED_MODEL_KEY : ids[0];
  return key || WODEAPP_PREFERRED_MODEL_KEY;
}

async function buildWebSignedInResponse(credentials: WebStoredCredentials): Promise<WodeAppAuthResponse> {
  const [{ ids }, credits, builtInTools, fetched] = await Promise.all([
    fetchWebModelIds(credentials),
    fetchWebCredits(credentials),
    fetchWebToolsHealth(credentials),
    fetchWebAbilityProjectsDetailed(credentials),
  ]);
  const storedProjects = normalizeAbilityProjects(credentials.abilityProjects);
  const abilityProjects = fetched.projects.length > 0 ? fetched.projects : storedProjects;
  const abilityProjectsSyncError = abilityProjects.length > 0 ? null : fetched.error;
  if (abilityProjects.length) {
    writeWebCredentials({ ...credentials, abilityProjects });
  }
  return {
    ok: true,
    signedIn: true,
    config: {
      origin: credentials.origin,
      user: credentials.user ?? null,
      embedded: false,
      profile: credentials.origin.includes("127.0.0.1") || credentials.origin.includes("localhost")
        ? "selfhost"
        : credentials.origin.includes("wodeapp.cn") || credentials.origin.includes("wodeapp.ai")
          ? "cloud"
          : "selfhost",
      providerId: WODEAPP_PROVIDER_ID,
      defaultModelId: chooseWebDefaultModelId(ids),
      modelIds: ids,
      credits,
      builtInTools,
      abilityProjects,
      abilityProjectsSyncError,
    },
  };
}

// ---------------------------------------------------------------------------
// 对外 API：优先 Electron bridge，无 bridge 时走 web 分支
// ---------------------------------------------------------------------------

export function isWodeAppAuthAvailable() {
  return Boolean(electronBridge()) || isWebAuthRuntime();
}

function currentWebPlatformOrigin(preferred?: string): string {
  if (preferred && preferred.trim()) return normalizeWebCloudOrigin(preferred);
  if (typeof window !== "undefined") return normalizeWebCloudOrigin(window.location.origin);
  return WODEAPP_CLOUD_ORIGIN_CN;
}

function redirectToWodeAppLogin(origin: string) {
  const loginUrl = new URL("/login", origin);
  loginUrl.searchParams.set("return_to", window.location.href);
  window.location.assign(loginUrl.toString());
}

async function tryBootstrapWebFromCookie(origin: string): Promise<WodeAppAuthResponse> {
  try {
    const res = await fetchDirect(`${origin}/mainserver/api/auth/desktop-bootstrap`, {
      method: "POST",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "X-WodeApp-Desktop": "1",
      },
    }, 15000);
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      error?: string;
      data?: {
        apiKey?: string;
        issuedOrigin?: string;
        user?: { id?: string; name?: string | null } | null;
      };
    };
    if (res.status === 401) {
      return { ok: true, signedIn: false, config: null };
    }
    const apiKey = typeof json?.data?.apiKey === "string" ? json.data.apiKey.trim() : "";
    if (!res.ok || !json?.success || !apiKey) {
      return {
        ok: false,
        error: typeof json?.error === "string" && json.error.trim()
          ? json.error.trim()
          : `登录失败 (${res.status})`,
      };
    }
    writeWebCredentials({
      origin: normalizeWebCloudOrigin(json.data?.issuedOrigin || origin),
      apiKey,
      user: json.data?.user ?? null,
    });
    emitAuthChanged();
    const stored = readWebCredentials();
    if (!stored) return { ok: false, error: "登录凭证写入失败" };
    return buildWebSignedInResponse(stored);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "登录失败",
    };
  }
}

export async function loadWodeAppAuthState(): Promise<WodeAppAuthResponse> {
  const bridge = electronBridge();
  if (bridge) {
    return (await bridge.invoke("load")) as WodeAppAuthResponse;
  }
  if (!isWebAuthRuntime()) {
    return { ok: false, error: "WodeApp auth is unavailable in this environment" };
  }
  const credentials = readWebCredentials();
  if (credentials) {
    return buildWebSignedInResponse(credentials);
  }
  return tryBootstrapWebFromCookie(currentWebPlatformOrigin());
}

/** Read the persisted desktop identity immediately, without waiting for network health checks. */
export async function loadCachedWodeAppAuthState(): Promise<WodeAppAuthResponse> {
  const bridge = electronBridge();
  if (bridge) {
    return (await bridge.invoke("loadCached")) as WodeAppAuthResponse;
  }
  return loadWodeAppAuthState();
}

/** Refresh only account/profile/credits data; provider and tool discovery stay off this UI path. */
export async function refreshWodeAppAccountState(): Promise<WodeAppAuthResponse> {
  const bridge = electronBridge();
  if (bridge) {
    return (await bridge.invoke("refreshAccount")) as WodeAppAuthResponse;
  }
  return loadWodeAppAuthState();
}

/** Open the official WodeApp website login page, then bootstrap an API Key. */
export async function signInWithWodeApp(origin?: string): Promise<WodeAppAuthResponse> {
  const bridge = electronBridge();
  if (bridge) {
    const result = (await bridge.invoke("login", { origin })) as WodeAppAuthResponse;
    if (result.ok && result.signedIn) {
      window.dispatchEvent(new Event("wodeapp:auth-changed"));
    }
    return result;
  }
  if (!isWebAuthRuntime()) {
    return { ok: false, error: "WodeApp auth is unavailable in this environment" };
  }
  const resolved = currentWebPlatformOrigin(origin);
  const bootstrapped = await tryBootstrapWebFromCookie(resolved);
  if (bootstrapped.ok && bootstrapped.signedIn) return bootstrapped;
  if (bootstrapped.ok && !bootstrapped.signedIn) {
    redirectToWodeAppLogin(resolved);
    return { ok: false, error: "REDIRECTING" };
  }
  return bootstrapped;
}

export async function cancelWodeAppLogin(): Promise<void> {
  const bridge = electronBridge();
  if (!bridge) return;
  try {
    await bridge.invoke("cancelLogin");
  } catch {
    // ignore
  }
}

export async function getWodeAppLoginStatus(): Promise<{ phase: "idle" | "browser" | "initializing" }> {
  const bridge = electronBridge();
  if (!bridge) return { phase: "idle" };
  try {
    const result = (await bridge.invoke("loginStatus")) as { phase?: string };
    if (result?.phase === "initializing" || result?.phase === "browser") {
      return { phase: result.phase };
    }
  } catch {
    // ignore
  }
  return { phase: "idle" };
}

export async function applyWodeAppProvider(): Promise<{ ok: boolean; error?: string }> {
  const bridge = electronBridge();
  if (bridge) {
    return (await bridge.invoke("applyProvider")) as { ok: boolean; error?: string };
  }
  if (!isWebAuthRuntime()) {
    return { ok: false, error: "WodeApp auth is unavailable in this environment" };
  }
  // Web 版：opencode 的 wodeapp provider 由 openwork-server 宿主机在部署时配置，
  // 浏览器侧无法（也不应）写 opencode 全局配置，这里视为已就绪。
  return { ok: true };
}

export async function checkWodeAppBuiltInTools(): Promise<WodeAppBuiltInToolsHealth> {
  const bridge = electronBridge();
  if (bridge) {
    return (await bridge.invoke("toolsHealth")) as WodeAppBuiltInToolsHealth;
  }
  if (!isWebAuthRuntime()) {
    return { ok: false, signedIn: false, status: "desktop_unavailable", toolCount: 0 };
  }
  const credentials = readWebCredentials();
  if (!credentials) {
    return { ok: false, signedIn: false, status: "embedded_unavailable", toolCount: 0 };
  }
  return fetchWebToolsHealth(credentials);
}

export async function signOutWodeApp(): Promise<{ ok: boolean; signedIn: false }> {
  const bridge = electronBridge();
  if (bridge) {
    const result = (await bridge.invoke("logout")) as { ok: boolean; signedIn: false };
    // Do not dispatch auth-changed here. Logout clears the phone/email wallet then
    // bootstraps a silent trial shell on disk; a refresh would paint that trial as
    // still signed-in and make「退出登录」look like a no-op. Footer clears local
    // auth state to show「登录」; the next explicit login/load can surface trial.
    return result;
  }
  if (!isWebAuthRuntime()) {
    return { ok: false, signedIn: false };
  }
  clearWebCredentials();
  emitAuthChanged();
  return { ok: true, signedIn: false };
}

export type WodeAppApiCredentials = {
  origin: string;
  apiKey: string;
};

export type WodeAppChatCompletionRequest = {
  model: string;
  stream?: false;
  temperature?: number;
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: unknown;
  }>;
};

export type WodeAppChatCompletionResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string; status?: number };

export type WodeAppVisionRequest = {
  imageUrl: string | string[];
  prompt: string;
  systemPrompt?: string;
  mediaType?: "image" | "video" | "pdf";
};

export type WodeAppVisionResponse = {
  success: boolean;
  data?: { content?: string; model?: string };
  error?: string;
};

export type WodeAppAttachmentInput = {
  filename: string;
  mimeType?: string;
  data?: string;
  url?: string;
};

export type WodeAppAttachmentUnderstanding = {
  filename: string;
  kind: string;
  method: string;
  summary: string;
  url?: string;
  wordCount?: number;
  error?: string;
};

export type WodeAppAttachmentIntelligenceResponse = {
  success: boolean;
  data?: {
    results: WodeAppAttachmentUnderstanding[];
    combinedContext: string;
    /** 按文件内容计算的稳定指纹，可用于下游复用已解析资料。 */
    contextPackId?: string;
    /** 命中缓存时为 true，本次不重复扣费。 */
    cacheHit?: boolean;
    billing?: {
      creditsEstimated: number;
      creditsUsed: number;
      breakdown: Array<{
        filename: string;
        kind: string;
        method: string;
        credits: number;
      }>;
    };
  };
  error?: string;
};

export type WodeAppRuntimeRequestInit = Omit<RequestInit, "headers"> & {
  headers?: HeadersInit;
  wodeAppCredentials?: WodeAppApiCredentials;
};

/** runtime-server 请求失败时携带 HTTP 状态与响应片段，便于 pvs_video_shares 等 sync 诊断。 */
export class WodeAppRuntimeRequestError extends Error {
  readonly status: number;
  readonly bodySnippet: string;

  constructor(message: string, status: number, bodySnippet = "") {
    super(message);
    this.name = "WodeAppRuntimeRequestError";
    this.status = status;
    this.bodySnippet = bodySnippet.slice(0, 500);
  }
}

function wodeAppPlatformOrigin(origin: string): string {
  const trimmed = origin.trim();
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed
      .replace(/\/(?:mainserver|runtime-server)(?:\/api.*)?$/i, "")
      .replace(/\/+$/, "");
  }
}

function wodeAppAiBaseUrl(origin: string): string {
  return `${wodeAppPlatformOrigin(origin)}/mainserver/api/ai/v1`;
}

function wodeAppRuntimeBaseUrl(origin: string): string {
  return `${wodeAppPlatformOrigin(origin)}/runtime-server/api`;
}

async function requestWodeAppChatCompletionDirect(input: WodeAppChatCompletionRequest): Promise<unknown> {
  const credentials = await getWodeAppApiCredentials();
  if (!credentials) {
    throw new Error("WodeApp 内嵌能力暂未初始化，请稍后重试。");
  }

  const response = await fetchWodeAppApi(`${wodeAppAiBaseUrl(credentials.origin)}/chat/completions`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${credentials.apiKey}`,
      "X-API-Key": credentials.apiKey,
    },
    body: JSON.stringify({
      ...input,
      stream: false,
    }),
  }, 90000);
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error?: { message?: unknown } }).error?.message === "string"
        ? (data as { error: { message: string } }).error.message
        : text || `WodeApp AI request failed (${response.status})`;
    throw new Error(error);
  }
  return data;
}

export async function getWodeAppApiCredentials(): Promise<WodeAppApiCredentials | null> {
  const bridge = electronBridge();
  if (bridge) {
    const result = (await bridge.invoke("credentials")) as
      | { ok: true; signedIn: true; origin: string; apiKey: string }
      | { ok: false; signedIn?: false; error?: string };
    if (!result.ok || !result.signedIn || !result.origin || !result.apiKey) {
      return null;
    }
    return { origin: result.origin, apiKey: result.apiKey };
  }
  if (!isWebAuthRuntime()) return null;
  const credentials = readWebCredentials();
  if (!credentials) return null;
  return { origin: credentials.origin, apiKey: credentials.apiKey };
}

export type WodeAppServiceConfigSummary = {
  profile: "cloud" | "selfhost" | "local-only";
  origin: string;
  issuedOrigin: string | null;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
  embedded: boolean;
  user: { id?: string; name?: string | null } | null;
};

export type WodeAppServiceProbeResult = {
  ok: boolean;
  origin: string;
  status?: number | null;
  error?: string | null;
};

export type WodeAppSaveServiceConfigResult =
  | {
      ok: true;
      config: WodeAppServiceConfigSummary | null;
      signedIn: boolean;
      provider?: unknown;
      providerError?: string | null;
    }
  | { ok: false; error: string };

/** Read persisted origin / profile / key preview without triggering embedded bootstrap. */
export async function getWodeAppServiceConfig(): Promise<{
  ok: boolean;
  config: WodeAppServiceConfigSummary | null;
  error?: string;
}> {
  const bridge = electronBridge();
  if (bridge) {
    return (await bridge.invoke("getServiceConfig")) as {
      ok: boolean;
      config: WodeAppServiceConfigSummary | null;
      error?: string;
    };
  }
  if (!isWebAuthRuntime()) {
    return { ok: false, config: null, error: "Service config is only available in the desktop app or browser" };
  }
  const credentials = readWebCredentials();
  if (!credentials) return { ok: true, config: null };
  return {
    ok: true,
    config: {
      profile: credentials.origin.includes("127.0.0.1") || credentials.origin.includes("localhost")
        ? "selfhost"
        : credentials.origin.includes("wodeapp.cn")
          ? "cloud"
          : "selfhost",
      origin: credentials.origin,
      issuedOrigin: credentials.origin,
      hasApiKey: Boolean(credentials.apiKey),
      apiKeyPreview: credentials.apiKey.length > 12
        ? `${credentials.apiKey.slice(0, 8)}…${credentials.apiKey.slice(-4)}`
        : `${credentials.apiKey.slice(0, 4)}…`,
      embedded: false,
      user: credentials.user ?? null,
    },
  };
}

export async function probeWodeAppServiceOrigin(origin: string): Promise<WodeAppServiceProbeResult> {
  const bridge = electronBridge();
  if (bridge) {
    return (await bridge.invoke("probeOrigin", { origin })) as WodeAppServiceProbeResult;
  }
  const cleaned = normalizeWebCloudOrigin(origin);
  try {
    const response = await fetchWodeAppApi(`${cleaned}/mainserver/api/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
    }, 2500);
    return {
      ok: response.ok,
      origin: cleaned,
      status: response.status,
      error: response.ok ? null : `health ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      origin: cleaned,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function saveWodeAppServiceConfig(input: {
  origin: string;
  apiKey?: string;
  profile?: "cloud" | "selfhost" | "local-only";
  clearApiKey?: boolean;
}): Promise<WodeAppSaveServiceConfigResult> {
  const bridge = electronBridge();
  if (bridge) {
    const result = (await bridge.invoke("saveServiceConfig", input)) as WodeAppSaveServiceConfigResult;
    if (result.ok) emitAuthChanged();
    return result;
  }
  if (!isWebAuthRuntime()) {
    return { ok: false, error: "Saving service config requires the desktop app or browser runtime" };
  }
  const origin = normalizeWebCloudOrigin(input.origin);
  if (!origin) return { ok: false, error: "Origin is required" };
  if (input.clearApiKey) {
    clearWebCredentials();
    emitAuthChanged();
    return { ok: true, config: null, signedIn: false };
  }
  const existing = readWebCredentials();
  const apiKey = (input.apiKey || "").trim() || existing?.apiKey || "";
  if (!apiKey) {
    return { ok: false, error: "API Key is required for browser credentials" };
  }
  writeWebCredentials({
    origin,
    apiKey,
    user: existing?.user ?? null,
    abilityProjects: existing?.origin === origin ? existing.abilityProjects : [],
  });
  emitAuthChanged();
  const loaded = await getWodeAppServiceConfig();
  return { ok: true, config: loaded.config, signedIn: true };
}

export async function requestWodeAppChatCompletion(input: WodeAppChatCompletionRequest): Promise<unknown> {
  return requestWodeAppChatCompletionDirect(input);
}

export async function requestWodeAppRuntimeJson<T>(
  path: string,
  init: WodeAppRuntimeRequestInit = {},
  timeoutMs = 90000,
): Promise<T> {
  const { wodeAppCredentials, ...requestInit } = init;
  const credentials = wodeAppCredentials || await getWodeAppApiCredentials();
  if (!credentials) {
    throw new Error("WodeApp 内嵌能力暂未初始化，请稍后重试。");
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const headers = new Headers(requestInit.headers);
  headers.set("Accept", "application/json");
  if (requestInit.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Authorization", `Bearer ${credentials.apiKey}`);
  headers.set("X-API-Key", credentials.apiKey);

  const response = await fetchWodeAppApi(`${wodeAppRuntimeBaseUrl(credentials.origin)}${normalizedPath}`, {
    ...requestInit,
    headers,
  }, timeoutMs);
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const errorFromJson =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : undefined;
    const message = errorFromJson || text || `WodeApp runtime request failed (${response.status})`;
    throw new WodeAppRuntimeRequestError(message, response.status, text);
  }
  return data as T;
}

export async function requestWodeAppMainJson<T>(
  path: string,
  init: WodeAppRuntimeRequestInit = {},
  timeoutMs = 90000,
): Promise<T> {
  const { wodeAppCredentials, ...requestInit } = init;
  const credentials = wodeAppCredentials || await getWodeAppApiCredentials();
  if (!credentials) {
    throw new Error("WodeApp 内嵌能力暂未初始化，请稍后重试。");
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const headers = new Headers(requestInit.headers);
  headers.set("Accept", "application/json");
  if (requestInit.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Authorization", `Bearer ${credentials.apiKey}`);
  headers.set("X-API-Key", credentials.apiKey);

  const response = await fetchWodeAppApi(`${wodeAppPlatformOrigin(credentials.origin)}/mainserver/api${normalizedPath}`, {
    ...requestInit,
    headers,
  }, timeoutMs);
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const errorFromJson =
      data &&
      typeof data === "object" &&
      "error" in data &&
      typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : undefined;
    const message = errorFromJson || text || `WodeApp main request failed (${response.status})`;
    throw new WodeAppRuntimeRequestError(message, response.status, text);
  }
  return data as T;
}

type WodeAppCanvasProjectsResponse = {
  success?: boolean;
  data?: {
    project?: unknown;
    projects?: unknown;
  };
  error?: string;
};

export async function listWodeAppCanvasProjects(): Promise<WodeAppAbilityProject[]> {
  const response = await requestWodeAppMainJson<WodeAppCanvasProjectsResponse>(
    "/auth/wodeappx-canvas-projects",
  );
  return normalizeAbilityProjects(response.data?.projects)
    .filter((project) => project.kind === "canvas");
}

export async function createWodeAppCanvasProject(name?: string): Promise<{
  project: WodeAppAbilityProject;
  projects: WodeAppAbilityProject[];
}> {
  const response = await requestWodeAppMainJson<WodeAppCanvasProjectsResponse>(
    "/auth/wodeappx-canvas-projects",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(name?.trim() ? { name: name.trim() } : {}),
    },
    45000,
  );
  const projects = normalizeAbilityProjects(response.data?.projects)
    .filter((project) => project.kind === "canvas");
  const created = normalizeAbilityProjects(response.data?.project ? [response.data.project] : [])[0];
  if (!created || created.kind !== "canvas") {
    throw new Error(response.error || "新建画布项目失败");
  }
  return { project: created, projects };
}

export async function requestWodeAppVision(input: WodeAppVisionRequest): Promise<WodeAppVisionResponse> {
  const credentials = await getWodeAppApiCredentials();
  if (!credentials) {
    throw new Error("WodeApp 内嵌能力暂未初始化，请稍后重试。");
  }

  const response = await fetchWodeAppApi(`${wodeAppRuntimeBaseUrl(credentials.origin)}/ai/vision`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${credentials.apiKey}`,
      "X-API-Key": credentials.apiKey,
    },
    body: JSON.stringify(input),
  }, 180000);
  const text = await response.text();
  let data: WodeAppVisionResponse | null = null;
  try {
    data = text ? JSON.parse(text) as WodeAppVisionResponse : null;
  } catch {
    data = null;
  }
  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || text || `WodeApp vision request failed (${response.status})`);
  }
  if (!data) {
    throw new Error("WodeApp vision request returned empty response");
  }
  return data;
}

export async function requestWodeAppAttachmentIntelligence(input: {
  files: WodeAppAttachmentInput[];
  userPrompt?: string;
  timingId?: string;
}): Promise<WodeAppAttachmentIntelligenceResponse> {
  const credentials = await getWodeAppApiCredentials();
  if (!credentials) {
    throw new Error("WodeApp 内嵌能力暂未初始化，请稍后重试。");
  }
  if (!input.files.length) {
    return { success: true, data: { results: [], combinedContext: "" } };
  }

  const payload = await requestWodeAppRuntimeJson<WodeAppAttachmentIntelligenceResponse>(
    "/ai/attachments/understand",
    {
      method: "POST",
      headers: input.timingId ? { "X-Attachment-Timing-Id": input.timingId } : undefined,
      body: JSON.stringify(input),
    },
    300000,
  );
  if (payload.success === false) {
    throw new Error(payload.error || "附件理解失败");
  }
  return payload;
}

export async function syncWodeAppAbilityProjects(): Promise<{
  ok: boolean;
  projects: WodeAppAbilityProject[];
  error?: string | null;
}> {
  const bridge = electronBridge();
  if (bridge) {
    return (await bridge.invoke("syncAbilityProjects")) as {
      ok: boolean;
      projects: WodeAppAbilityProject[];
      error?: string | null;
    };
  }
  if (!isWebAuthRuntime()) {
    return { ok: false, projects: [], error: "当前环境不支持同步智能体项目" };
  }
  const credentials = readWebCredentials();
  if (!credentials) {
    return { ok: false, projects: [], error: "WodeApp 内嵌能力暂未初始化" };
  }
  const fetched = await fetchWebAbilityProjectsDetailed(credentials);
  const storedProjects = normalizeAbilityProjects(credentials.abilityProjects);
  const projects = fetched.projects.length > 0 ? fetched.projects : storedProjects;
  if (projects.length) {
    writeWebCredentials({ ...credentials, abilityProjects: projects });
  }
  return {
    ok: projects.length > 0,
    projects,
    error: projects.length > 0 ? null : fetched.error,
  };
}

export type WodeAppBrandAgentConfigDto = {
  id: string;
  name: string;
  brandId: string;
  meta?: string;
  connectorScopes?: string[];
  knowledgeScopes?: string[];
  policy?: string[];
  entryPrompt?: string;
  samplePrompt?: string;
  workbench?: "generic" | "wynne";
  enabled?: boolean;
};

export async function listWodeAppBrandAgents(): Promise<{
  ok: boolean;
  version: 1;
  agents: WodeAppBrandAgentConfigDto[];
  error?: string;
}> {
  const bridge = electronBridge();
  if (bridge) {
    try {
      const result = await bridge.invoke("listBrandAgents") as {
        ok?: boolean;
        version?: number;
        agents?: WodeAppBrandAgentConfigDto[];
        error?: string;
      };
      if (result?.ok === false) {
        return { ok: false, version: 1, agents: [], error: result.error || "读取品牌智能体配置失败" };
      }
      return {
        ok: true,
        version: 1,
        agents: Array.isArray(result?.agents) ? result.agents : [],
      };
    } catch (error) {
      return {
        ok: false,
        version: 1,
        agents: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  return { ok: true, version: 1, agents: [] };
}

export async function saveWodeAppBrandAgents(input: {
  version?: 1;
  agents: WodeAppBrandAgentConfigDto[];
}): Promise<{
  ok: boolean;
  version: 1;
  agents: WodeAppBrandAgentConfigDto[];
  error?: string;
}> {
  const bridge = electronBridge();
  if (!bridge) {
    return { ok: false, version: 1, agents: [], error: "仅桌面端可写入 ~/.wodeapp/brand-agents.json" };
  }
  try {
    const result = await bridge.invoke("saveBrandAgents", input) as {
      ok?: boolean;
      agents?: WodeAppBrandAgentConfigDto[];
      error?: string;
    };
    if (result?.ok === false) {
      return { ok: false, version: 1, agents: [], error: result.error || "保存品牌智能体配置失败" };
    }
    return {
      ok: true,
      version: 1,
      agents: Array.isArray(result?.agents) ? result.agents : [],
    };
  } catch (error) {
    return {
      ok: false,
      version: 1,
      agents: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function listWodeAppPlazaCatalog(): Promise<{
  ok: boolean;
  exists: boolean;
  version: 1;
  items: unknown[];
  error?: string;
}> {
  const bridge = electronBridge();
  if (!bridge) {
    return { ok: true, exists: false, version: 1, items: [] };
  }
  try {
    const result = await bridge.invoke("listPlazaCatalog") as {
      ok?: boolean;
      exists?: boolean;
      items?: unknown[];
      error?: string;
    };
    if (result?.ok === false) {
      return { ok: false, exists: false, version: 1, items: [], error: result.error || "读取广场目录失败" };
    }
    return {
      ok: true,
      exists: result?.exists === true,
      version: 1,
      items: Array.isArray(result?.items) ? result.items : [],
    };
  } catch (error) {
    return {
      ok: false,
      exists: false,
      version: 1,
      items: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function saveWodeAppPlazaCatalog(input: {
  version?: 1;
  items: unknown[];
}): Promise<{
  ok: boolean;
  exists: boolean;
  version: 1;
  items: unknown[];
  error?: string;
}> {
  const bridge = electronBridge();
  if (!bridge) {
    return { ok: true, exists: false, version: 1, items: Array.isArray(input.items) ? input.items : [] };
  }
  try {
    const result = await bridge.invoke("savePlazaCatalog", input) as {
      ok?: boolean;
      exists?: boolean;
      items?: unknown[];
      error?: string;
    };
    if (result?.ok === false) {
      return { ok: false, exists: false, version: 1, items: [], error: result.error || "保存广场目录失败" };
    }
    return {
      ok: true,
      exists: result?.exists !== false,
      version: 1,
      items: Array.isArray(result?.items) ? result.items : [],
    };
  } catch (error) {
    return {
      ok: false,
      exists: false,
      version: 1,
      items: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export type { WodeAppAuthConfig, WodeAppAuthResponse };

export async function loadWodeAppMediaByok(): Promise<{
  ok: boolean;
  version: 1;
  preferLocal: boolean;
  providers: Record<string, Record<string, string>>;
  error?: string;
}> {
  const bridge = electronBridge();
  if (!bridge) {
    return { ok: false, version: 1, preferLocal: true, providers: {}, error: "仅桌面端可读写媒体 BYOK" };
  }
  try {
    const result = await bridge.invoke("getMediaByok") as {
      ok?: boolean;
      preferLocal?: boolean;
      providers?: Record<string, Record<string, string>>;
      error?: string;
    };
    if (result?.ok === false) {
      return {
        ok: false,
        version: 1,
        preferLocal: true,
        providers: {},
        error: result.error || "读取媒体 BYOK 失败",
      };
    }
    return {
      ok: true,
      version: 1,
      preferLocal: result?.preferLocal !== false,
      providers: result?.providers && typeof result.providers === "object" ? result.providers : {},
    };
  } catch (error) {
    return {
      ok: false,
      version: 1,
      preferLocal: true,
      providers: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function saveWodeAppMediaByok(input: {
  version?: 1;
  preferLocal?: boolean;
  providers: Record<string, Record<string, string>>;
}): Promise<{
  ok: boolean;
  version: 1;
  preferLocal: boolean;
  providers: Record<string, Record<string, string>>;
  error?: string;
}> {
  const bridge = electronBridge();
  if (!bridge) {
    return {
      ok: false,
      version: 1,
      preferLocal: true,
      providers: {},
      error: "仅桌面端可写入 ~/.wodeapp/media-byok.json",
    };
  }
  try {
    const result = await bridge.invoke("saveMediaByok", input) as {
      ok?: boolean;
      preferLocal?: boolean;
      providers?: Record<string, Record<string, string>>;
      error?: string;
    };
    if (result?.ok === false) {
      return {
        ok: false,
        version: 1,
        preferLocal: true,
        providers: {},
        error: result.error || "保存媒体 BYOK 失败",
      };
    }
    return {
      ok: true,
      version: 1,
      preferLocal: result?.preferLocal !== false,
      providers: result?.providers && typeof result.providers === "object" ? result.providers : {},
    };
  } catch (error) {
    return {
      ok: false,
      version: 1,
      preferLocal: true,
      providers: {},
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export type LocalByokCandidateSummary = {
  sourceId: string;
  sourceLabel: string;
  sourceKind: string;
  providerId: string;
  apiKeyPreview: string;
  baseURL: string | null;
  modelHint: string | null;
  isCurrent: boolean;
  custom: boolean;
};

export async function discoverWodeAppLocalByok(): Promise<{
  ok: boolean;
  privacyNotice: string;
  defaultModelNotice?: string;
  candidates: LocalByokCandidateSummary[];
  skipped: Array<{ source: string; reason: string }>;
  error?: string;
}> {
  const bridge = electronBridge();
  const privacyNotice =
    "仅在本机读取并用于本地引擎调用上游 API；不会上传到 WodeApp 云端，也不会同步到任何远程账号服务。";
  if (!bridge) {
    return {
      ok: false,
      privacyNotice,
      candidates: [],
      skipped: [],
      error: "仅桌面端可扫描本机 Claude / CC Switch / Codex 配置",
    };
  }
  try {
    const result = await bridge.invoke("discoverLocalByok") as {
      ok?: boolean;
      privacyNotice?: string;
      defaultModelNotice?: string;
      candidates?: LocalByokCandidateSummary[];
      skipped?: Array<{ source: string; reason: string }>;
      error?: string;
    };
    return {
      ok: result?.ok !== false,
      privacyNotice: result?.privacyNotice || privacyNotice,
      defaultModelNotice: result?.defaultModelNotice,
      candidates: Array.isArray(result?.candidates) ? result.candidates : [],
      skipped: Array.isArray(result?.skipped) ? result.skipped : [],
      error: result?.error,
    };
  } catch (error) {
    return {
      ok: false,
      privacyNotice,
      candidates: [],
      skipped: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function importWodeAppLocalByok(sourceId: string): Promise<{
  ok: boolean;
  privacyNotice: string;
  defaultModelNotice?: string;
  uploaded: boolean;
  providerId?: string;
  apiKey?: string;
  apiKeyPreview?: string;
  baseURL?: string | null;
  modelHint?: string | null;
  error?: string;
}> {
  const bridge = electronBridge();
  const privacyNotice =
    "仅在本机读取并用于本地引擎调用上游 API；不会上传到 WodeApp 云端，也不会同步到任何远程账号服务。";
  if (!bridge) {
    return {
      ok: false,
      privacyNotice,
      uploaded: false,
      error: "仅桌面端可导入本机配置",
    };
  }
  try {
    const result = await bridge.invoke("importLocalByok", { sourceId }) as {
      ok?: boolean;
      privacyNotice?: string;
      defaultModelNotice?: string;
      uploaded?: boolean;
      providerId?: string;
      apiKey?: string;
      apiKeyPreview?: string;
      baseURL?: string | null;
      modelHint?: string | null;
      error?: string;
    };
    return {
      ok: result?.ok === true,
      privacyNotice: result?.privacyNotice || privacyNotice,
      defaultModelNotice: result?.defaultModelNotice,
      uploaded: false,
      providerId: result?.providerId,
      apiKey: result?.apiKey,
      apiKeyPreview: result?.apiKeyPreview,
      baseURL: result?.baseURL ?? null,
      modelHint: result?.modelHint ?? null,
      error: result?.error,
    };
  } catch (error) {
    return {
      ok: false,
      privacyNotice,
      uploaded: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function syncWodeAppLocalByokEnv(): Promise<{
  ok: boolean;
  privacyNotice: string;
  defaultModelNotice?: string;
  uploaded: boolean;
  syncedKeys?: string[];
  syncedCount?: number;
  syncedPreviews?: Array<{ key: string; preview: string; source: string }>;
  envStorePath?: string;
  error?: string;
}> {
  const bridge = electronBridge();
  const privacyNotice =
    "仅在本机读取，并同步到本机「环境变量」与本地引擎凭据；不会上传到 WodeApp 云端，也不会同步到任何远程账号服务。";
  if (!bridge) {
    return { ok: false, privacyNotice, uploaded: false, error: "仅桌面端可同步本机环境变量" };
  }
  try {
    const result = await bridge.invoke("syncLocalByokEnv") as {
      ok?: boolean;
      privacyNotice?: string;
      defaultModelNotice?: string;
      uploaded?: boolean;
      syncedKeys?: string[];
      syncedCount?: number;
      syncedPreviews?: Array<{ key: string; preview: string; source: string }>;
      envStorePath?: string;
      error?: string;
    };
    return {
      ok: result?.ok === true,
      privacyNotice: result?.privacyNotice || privacyNotice,
      defaultModelNotice: result?.defaultModelNotice,
      uploaded: false,
      syncedKeys: Array.isArray(result?.syncedKeys) ? result.syncedKeys : [],
      syncedCount: Number(result?.syncedCount) || 0,
      syncedPreviews: Array.isArray(result?.syncedPreviews) ? result.syncedPreviews : [],
      envStorePath: result?.envStorePath,
      error: result?.error,
    };
  } catch (error) {
    return {
      ok: false,
      privacyNotice,
      uploaded: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function detectWodeAppProviderCapabilities(options?: { force?: boolean }): Promise<{
  ok: boolean;
  cached?: boolean;
  probes: unknown[];
  error?: string;
}> {
  const bridge = electronBridge();
  if (!bridge) {
    return { ok: false, probes: [], error: "仅桌面端可探测本机 Key 能力" };
  }
  try {
    const result = await bridge.invoke("detectCapabilities", { force: options?.force === true }) as {
      ok?: boolean;
      cached?: boolean;
      probes?: unknown[];
      error?: string;
    };
    return {
      ok: result?.ok === true,
      cached: Boolean(result?.cached),
      probes: Array.isArray(result?.probes) ? result.probes : [],
      error: result?.error,
    };
  } catch (error) {
    return {
      ok: false,
      probes: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
