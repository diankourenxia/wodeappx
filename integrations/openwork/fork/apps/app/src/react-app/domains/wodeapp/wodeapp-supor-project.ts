/** Renderer-safe Supor project markers (no Node APIs). */

export const SUPOR_BRAND_AGENT_ID = "supor-brand-agent";
export const SUPOR_BRAND_ID = "supor";
/** Stable workspace name used by Electron mount + path matching. */
export const SUPOR_WORKSPACE_NAME = "苏泊尔经营台";
/** Sidebar / chrome label — this desk is the default self-evolve project. */
export const SUPOR_WORKSPACE_DISPLAY_NAME = "苏泊尔经营台（自进化）";

/**
 * Runtime product desk: whole-shell mode (skin + workspace + assets).
 * Persisted in localStorage — switch in chrome, do not flip compile-time flags.
 */
export type WodeAppProductDeskId = "default" | "supor";

export const WODEAPP_DEFAULT_PRODUCT_DESK: WodeAppProductDeskId = "default";

const WODEAPP_PRODUCT_DESK_STORAGE_KEY = "wodeappx.product-desk";
const productDeskListeners = new Set<() => void>();

export function isWodeAppProductDeskId(
  value: string | null | undefined,
): value is WodeAppProductDeskId {
  return value === "default" || value === "supor";
}

export function readStoredProductDesk(): WodeAppProductDeskId {
  if (typeof window === "undefined") return WODEAPP_DEFAULT_PRODUCT_DESK;
  try {
    const stored = window.localStorage.getItem(WODEAPP_PRODUCT_DESK_STORAGE_KEY);
    return isWodeAppProductDeskId(stored) ? stored : WODEAPP_DEFAULT_PRODUCT_DESK;
  } catch {
    return WODEAPP_DEFAULT_PRODUCT_DESK;
  }
}

export function storeProductDesk(desk: WodeAppProductDeskId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WODEAPP_PRODUCT_DESK_STORAGE_KEY, desk);
  } catch {
    // Local state still applies when storage is unavailable.
  }
  for (const listener of productDeskListeners) listener();
}

export function subscribeProductDesk(listener: () => void): () => void {
  productDeskListeners.add(listener);
  return () => {
    productDeskListeners.delete(listener);
  };
}

/** Sync read for non-React call sites (debug fab, etc.). */
export function isWodeAppProductDeskSupor(): boolean {
  return readStoredProductDesk() === "supor";
}

/**
 * @deprecated Compile-time lock removed — use `readStoredProductDesk()` /
 * `isWodeAppProductDeskSupor()` / React desk state. Kept as `false` so stale
 * imports never re-lock the whole app to Supor.
 */
export const WODEAPP_PRODUCT_DESK_IS_SUPOR = false;

export function isSuporWorkspaceLike(input: {
  path?: string | null;
  name?: string | null;
  displayName?: string | null;
} | null | undefined): boolean {
  if (!input) return false;
  const name = String(input.displayName || input.name || "").trim();
  if (
    name === SUPOR_WORKSPACE_NAME
    || name === SUPOR_WORKSPACE_DISPLAY_NAME
    || name.includes("苏泊尔经营台")
  ) {
    return true;
  }
  const folderPath = String(input.path || "").replace(/\\/g, "/").toLowerCase();
  return folderPath.includes("/.wodeapp/projects/supor");
}

export function isSuporBrandAgentId(id: string | null | undefined): boolean {
  return String(id || "").trim().toLowerCase() === SUPOR_BRAND_AGENT_ID;
}
