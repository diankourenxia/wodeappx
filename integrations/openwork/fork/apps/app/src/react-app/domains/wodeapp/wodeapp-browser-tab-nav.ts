import { getElectronBrowser } from "../session/panel/utils";
import { readLastSessionFor } from "@/react-app/shell/session-memory";
import { canonicalizeVideoStoryboardWorkbenchUrl } from "./wodeapp-pvs-storyboard-url";
import { sessionPathFromSettingsLocation } from "./wodeapp-provider-billing-links";

const MEDIA_ASSET_URL_PATTERN =
  /\.(?:png|jpe?g|webp|gif|avif|svg|bmp|heic|mp4|mov|webm|mkv|m4v|mp3|wav|m4a|aac)(?:$|[?#])/i;
const ASSET_HOST_PATTERN =
  /(^|\.)((?:placehold|placeholder)\.co|assets\.wodeapp\.(?:ai|cn)|r2\.dev|cloudfront\.net|aliyuncs\.com|volces\.com|volccdn\.com)$/i;
const ASSET_QUERY_PATTERN = /\b(?:X-Tos-|x-oss-|Expires=|Signature=|response-content-type=)/i;

export function isLikelyGenerationAssetUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (/^(?:data:image\/|blob:|asset:\/\/)/i.test(trimmed)) return true;

  try {
    const parsed = new URL(trimmed);
    if (!/^https?:$/i.test(parsed.protocol)) return false;
    if (MEDIA_ASSET_URL_PATTERN.test(parsed.pathname)) return true;
    if (ASSET_HOST_PATTERN.test(parsed.hostname)) return true;
    return ASSET_QUERY_PATTERN.test(parsed.search);
  } catch {
    return false;
  }
}

export function generationAssetUrlMessage(url: string): string {
  return `这是素材/媒体 URL，不会自动打开：${url}。如需作为参考图或生成输入，请直接传给对应生成工具；只有用户明确要求检查这个链接时才打开。`;
}

/** Canonical URL for matching browser tabs (stable param order, no hash). */
export function normalizeBrowserMatchUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed);
    const keys = [...parsed.searchParams.keys()].sort();
    const search = keys
      .map((key) => `${key}=${parsed.searchParams.get(key) ?? ""}`)
      .join("&");
    const pathname = parsed.pathname || "/";
    return `${parsed.origin}${pathname}${search ? `?${search}` : ""}`;
  } catch {
    return trimmed;
  }
}

function browserPathKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname || "/"}`;
  } catch {
    return "";
  }
}

type BrowserBounds = { x: number; y: number; width: number; height: number };

function browserContentBounds(): BrowserBounds | null {
  if (typeof document === "undefined") return null;

  const panel = document.querySelector<HTMLElement>(".wapp-side-panel");
  const content =
    panel?.querySelector<HTMLElement>(".min-h-0.flex-1.overflow-hidden")
    ?? (panel?.lastElementChild instanceof HTMLElement ? panel.lastElementChild : null);

  if (!content) return null;

  const rect = content.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;

  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function safeInvoke<T>(promise: Promise<T> | void) {
  if (promise && typeof promise.catch === "function") {
    void promise.catch(() => undefined);
  }
}

async function revealBrowserViewIfMounted(targetUrl?: string) {
  const browser = getElectronBrowser();
  const bounds = browserContentBounds();
  if (!browser || !bounds) return;

  if (targetUrl) {
    const target = normalizeBrowserMatchUrl(targetUrl);
    const pathKey = browserPathKey(targetUrl);
    const state = await browser.getState?.();
    const targetTab = state?.tabs?.find((tab) => normalizeBrowserMatchUrl(tab.url) === target)
      ?? state?.tabs?.find((tab) => Boolean(pathKey) && browserPathKey(tab.url) === pathKey);
    if (targetTab?.id && state?.activeTabId !== targetTab.id) {
      await browser.selectTab?.(targetTab.id);
    }
  }

  await browser.show?.(bounds);
  await browser.setBounds?.(bounds);
}

function queueBrowserViewReveal(targetUrl?: string) {
  if (typeof window === "undefined") return;
  const routeAtSchedule = window.location.href;

  for (const delay of [0, 50, 150, 300, 600]) {
    window.setTimeout(() => {
      if (window.location.href !== routeAtSchedule) return;
      safeInvoke(revealBrowserViewIfMounted(targetUrl));
    }, delay);
  }
}

/**
 * Prepare a WodeApp workbench URL for AppX embedded browser navigation:
 * canonicalize shareDoc/pvsRun, then add embed + wodeappx flags.
 */
export function prepareWodeAppWorkbenchEmbedUrl(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;

  try {
    const origin = typeof window !== "undefined" ? window.location.origin : "https://wodeapp.cn";
    const canonical = canonicalizeVideoStoryboardWorkbenchUrl(trimmed) || trimmed;
    const url = new URL(canonical, origin);
    if (!url.searchParams.has("embed")) url.searchParams.set("embed", "1");
    if (!url.searchParams.has("wodeappx")) url.searchParams.set("wodeappx", "1");
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Open a built-in browser tab. Reopening the exact destination focuses and refreshes it.
 * Matches exact normalized URL first, then origin + pathname (embed/query order may differ).
 */
export async function openOrActivateWodeAppBrowserTab(url: string): Promise<boolean> {
  const trimmed = url.trim();
  if (!trimmed) return false;

  const browser = getElectronBrowser();
  if (!browser) return false;

  const navigable = canonicalizeVideoStoryboardWorkbenchUrl(trimmed) || trimmed;
  const target = normalizeBrowserMatchUrl(navigable);
  const pathKey = browserPathKey(navigable);
  const state = await browser.getState?.();
  const tabs = state?.tabs ?? [];

  const exact = tabs.find((tab) => normalizeBrowserMatchUrl(tab.url) === target);
  if (exact?.id) {
    await browser.selectTab?.(exact.id);
    await browser.reload?.();
    queueBrowserViewReveal(navigable);
    return true;
  }

  if (pathKey) {
    const samePath = tabs.find((tab) => browserPathKey(tab.url) === pathKey);
    if (samePath?.id) {
      await browser.selectTab?.(samePath.id);
      if (normalizeBrowserMatchUrl(samePath.url) !== target) {
        await browser.navigate?.(navigable);
      }
      queueBrowserViewReveal(navigable);
      return true;
    }
  }

  const created = await browser.createTab?.(navigable);
  if (!created?.tabId) return false;
  await browser.selectTab?.(created.tabId);
  queueBrowserViewReveal(navigable);
  return true;
}

export { sessionPathFromSettingsLocation } from "./wodeapp-provider-billing-links";

export async function leaveSettingsForSessionBrowser(
  navigate: (path: string) => void,
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const loc = `${window.location.pathname}${window.location.hash}`;
  const match = loc.match(/workspace\/([^/?#]+)/);
  let lastSession: string | null = null;
  if (match) {
    try {
      lastSession = readLastSessionFor(decodeURIComponent(match[1]));
    } catch {
      lastSession = null;
    }
  }
  const path = sessionPathFromSettingsLocation(loc, lastSession);
  if (!path) return false;
  navigate(path);
  await new Promise((resolve) => window.setTimeout(resolve, 320));
  return true;
}

/** Leave settings / other surfaces, then open a URL in the session right-sidebar browser. */
export async function openUrlInWodeAppRightPane(url: string): Promise<boolean> {
  const trimmed = String(url || "").trim();
  if (!trimmed || typeof window === "undefined") return false;
  window.dispatchEvent(new Event("wodeapp:focus-agents"));
  window.dispatchEvent(new CustomEvent("openwork-open-right-pane", {
    detail: { pane: "browser", url: trimmed },
  }));
  await new Promise((resolve) => window.setTimeout(resolve, 160));
  return openOrActivateWodeAppBrowserTab(trimmed);
}
