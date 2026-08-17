export type WodeAppAssetSurfaceMode = "library" | "generation-history";

export const WODEAPP_ASSET_SURFACE_MODE_EVENT = "wodeapp:asset-surface-mode";

export type WodeAppAssetSurfaceModeEventDetail = {
  mode: WodeAppAssetSurfaceMode;
};

type AssetSurfaceModeWindow = Window & {
  __WODEAPP_ASSET_SURFACE_MODE__?: WodeAppAssetSurfaceMode;
};

function normalizeAssetSurfaceMode(value: unknown): WodeAppAssetSurfaceMode {
  return value === "generation-history" ? "generation-history" : "library";
}

export function readWodeAppAssetSurfaceMode(): WodeAppAssetSurfaceMode {
  if (typeof window === "undefined") return "library";
  return normalizeAssetSurfaceMode((window as AssetSurfaceModeWindow).__WODEAPP_ASSET_SURFACE_MODE__);
}

export function requestWodeAppAssetSurfaceMode(mode: WodeAppAssetSurfaceMode) {
  if (typeof window === "undefined") return;
  const nextMode = normalizeAssetSurfaceMode(mode);
  const modeWindow = window as AssetSurfaceModeWindow;
  if (normalizeAssetSurfaceMode(modeWindow.__WODEAPP_ASSET_SURFACE_MODE__) === nextMode) return;
  modeWindow.__WODEAPP_ASSET_SURFACE_MODE__ = nextMode;
  window.dispatchEvent(new CustomEvent<WodeAppAssetSurfaceModeEventDetail>(WODEAPP_ASSET_SURFACE_MODE_EVENT, {
    detail: { mode: nextMode },
  }));
}
