import * as React from "react";

import type { BrowserStatePayload } from "@/app/lib/desktop";

import {
  type BrowserPanelTab,
  type PanelTab,
  usePanelTabStore,
} from "./panel-tab-store";
import {
  activateBrowserSession,
  browserSessionIsOwnedBy,
  releaseBrowserSession,
} from "./browser-session-ownership";
import { getElectronBrowser } from "./utils";
import { normalizeBrowserMatchUrl, openOrActivateWodeAppBrowserTab } from "../../wodeapp/wodeapp-browser-tab-nav";

function isRestorableBrowserUrl(url: string) {
  const trimmed = url.trim();
  return Boolean(trimmed && trimmed !== "about:blank");
}

function isRestorableBrowserTab(tab: PanelTab): tab is BrowserPanelTab {
  return tab.type === "browser" && isRestorableBrowserUrl(tab.url);
}

function browserUrlsMatch(left: string, right: string) {
  return normalizeBrowserMatchUrl(left) === normalizeBrowserMatchUrl(right);
}

export function nativeBrowserRouteSessionId() {
  if (typeof window === "undefined") return null;
  return window.location.hash.match(/\/session\/(ses_[^/?#]+)/)?.[1] ?? null;
}

function routeBelongsToSession(sessionId: string) {
  return nativeBrowserRouteSessionId() === sessionId;
}

let routeOwnershipListenerInstalled = false;

function ensureRouteOwnershipListener() {
  if (routeOwnershipListenerInstalled || typeof window === "undefined") return;
  routeOwnershipListenerInstalled = true;
  window.addEventListener("hashchange", () => {
    const sessionId = nativeBrowserRouteSessionId();
    if (sessionId) void activateNativeBrowserForSession(sessionId);
  });
}

function sessionBrowserTabs(sessionId: string) {
  const session = usePanelTabStore.getState().sessions[sessionId];
  return (session?.tabs ?? []).filter((tab): tab is BrowserPanelTab => (
    isRestorableBrowserTab(tab) && tab.ownerSessionId === sessionId
  ));
}

function sessionBrowserActiveIndex(sessionId: string, tabs: BrowserPanelTab[]) {
  const activeTabId = usePanelTabStore.getState().sessions[sessionId]?.activeTabId;
  const index = tabs.findIndex((tab) => tab.id === activeTabId);
  return index >= 0 ? index : 0;
}

async function restoreBrowserTabsForSession(
  sessionId: string,
  isCurrent: () => boolean,
): Promise<BrowserStatePayload | null> {
  const browser = getElectronBrowser();
  if (!browser || !isCurrent()) return null;

  const desiredTabs = sessionBrowserTabs(sessionId);
  const initialState = await browser.getState?.();
  if (!isCurrent()) return null;
  const initialTabs = initialState?.tabs ?? [];

  if (desiredTabs.length === 0) {
    if (initialTabs.length > 0) {
      await browser.closeAllTabs?.();
    }
    if (!isCurrent()) return null;
    return await browser.getState?.() ?? { activeTabId: null, tabs: [] };
  }

  const activeIndex = sessionBrowserActiveIndex(sessionId, desiredTabs);
  const nativeTabIds: string[] = [];

  for (const [index, desiredTab] of desiredTabs.entries()) {
    if (!isCurrent()) return null;
    const existingTab = initialTabs[index];
    const url = desiredTab.url.trim();

    if (existingTab?.id) {
      nativeTabIds.push(existingTab.id);
      if (!browserUrlsMatch(existingTab.url, url)) {
        await browser.selectTab?.(existingTab.id);
        if (!isCurrent()) return null;
        await browser.navigate?.(url);
      }
      continue;
    }

    const created = await browser.createTab?.(url);
    if (created?.tabId) nativeTabIds.push(created.tabId);
  }

  if (!isCurrent()) return null;
  const activeNativeTabId = nativeTabIds[activeIndex] ?? nativeTabIds[0] ?? null;
  if (activeNativeTabId) await browser.selectTab?.(activeNativeTabId);

  if (!isCurrent()) return null;
  const stateAfterCreate = await browser.getState?.();
  const nativeTabIdSet = new Set(nativeTabIds);
  const extraTabs = (stateAfterCreate?.tabs ?? []).filter((tab) => !nativeTabIdSet.has(tab.id));

  for (const tab of extraTabs) {
    if (!isCurrent()) return null;
    await browser.closeTab?.(tab.id);
  }

  if (activeNativeTabId && isCurrent()) await browser.selectTab?.(activeNativeTabId);
  if (!isCurrent()) return null;
  return await browser.getState?.() ?? null;
}

export async function activateNativeBrowserForSession(sessionId: string) {
  if (!sessionId || !routeBelongsToSession(sessionId)) return null;
  return activateBrowserSession(
    sessionId,
    (isCurrent) => restoreBrowserTabsForSession(sessionId, isCurrent),
    () => routeBelongsToSession(sessionId),
  );
}

export function nativeBrowserBelongsToSession(sessionId: string) {
  return browserSessionIsOwnedBy(sessionId);
}

export function useSidePanelTabs(sessionId: string) {
  const syncBrowserTabs = usePanelTabStore((state) => state.syncBrowserTabs);

  const applyBrowserState = React.useCallback((browserState: BrowserStatePayload) => {
    if (!browserSessionIsOwnedBy(sessionId)) return;
    const tabs = browserState.tabs ?? [];
    const activeTabId = browserState.activeTabId ?? tabs[0]?.id ?? null;
    syncBrowserTabs(sessionId, tabs, activeTabId);
  }, [sessionId, syncBrowserTabs]);

  React.useEffect(() => {
    ensureRouteOwnershipListener();
    const browser = getElectronBrowser();
    if (!browser) return;

    let disposed = false;
    const unsub = browser.onStateChange?.((browserState) => {
      if (disposed || !browserSessionIsOwnedBy(sessionId)) return;
      applyBrowserState(browserState);
    });

    void activateNativeBrowserForSession(sessionId).then((restoredState) => {
      if (!disposed && restoredState) applyBrowserState(restoredState);
    });

    return () => {
      disposed = true;
      unsub?.();
      releaseBrowserSession(sessionId);
    };
  }, [applyBrowserState, sessionId]);

  const createTab = useCreateTab(sessionId);
  const closeTab = useCloseTab();
  const selectTab = useSelectTab();
  const reorderTabs = useReorderTabs();

  return {
    createTab: (url?: string) => createTab(url),
    closeTab: (tab: PanelTab) => closeTab(sessionId, tab),
    selectTab: (tabId: string) => selectTab(sessionId, tabId),
    reorderTabs: (tabIds: string[]) => reorderTabs(sessionId, tabIds),
  };
}

export function useCreateTab(sessionId: string) {
  return React.useCallback((url?: string) => {
    void (async () => {
      const activated = await activateNativeBrowserForSession(sessionId);
      if (!activated || !browserSessionIsOwnedBy(sessionId)) return;
      if (url?.trim()) {
        await openOrActivateWodeAppBrowserTab(url);
        return;
      }
      await getElectronBrowser()?.createTab?.();
    })();
  }, [sessionId]);
}

export function useCloseTab() {
  const closeTab = usePanelTabStore((state) => state.closeTab);
  return React.useCallback((sessionId: string, tab: PanelTab) => {
    if (tab.type === "browser") {
      void (async () => {
        if (!browserSessionIsOwnedBy(sessionId)) await activateNativeBrowserForSession(sessionId);
        if (browserSessionIsOwnedBy(sessionId)) await getElectronBrowser()?.closeTab?.(tab.id);
      })();
      return;
    }

    const wasActive = usePanelTabStore.getState().sessions[sessionId]?.activeTabId === tab.id;
    closeTab(sessionId, tab.id);
    if (wasActive) {
      const nextTabId = usePanelTabStore.getState().sessions[sessionId]?.activeTabId;
      const nextTab = usePanelTabStore.getState().sessions[sessionId]?.tabs.find((entry) => entry.id === nextTabId);
      if (nextTab?.type === "browser" && browserSessionIsOwnedBy(sessionId)) {
        void getElectronBrowser()?.selectTab?.(nextTab.id);
      }
    }
  }, [closeTab]);
}

export function useSelectTab() {
  const selectTab = usePanelTabStore((state) => state.selectTab);
  return React.useCallback((sessionId: string, tabId: string) => {
    const tabs = usePanelTabStore.getState().sessions[sessionId]?.tabs ?? [];
    const tab = tabs.find((entry) => entry.id === tabId);
    if (!tab) return;
    selectTab(sessionId, tabId);
    if (tab.type === "browser") {
      void (async () => {
        if (!browserSessionIsOwnedBy(sessionId)) await activateNativeBrowserForSession(sessionId);
        if (browserSessionIsOwnedBy(sessionId)) await getElectronBrowser()?.selectTab?.(tabId);
      })();
    }
  }, [selectTab]);
}

export function useReorderTabs() {
  const reorderTabs = usePanelTabStore((state) => state.reorderTabs);
  return React.useCallback((sessionId: string, tabIds: string[]) => {
    const tabs = usePanelTabStore.getState().sessions[sessionId]?.tabs ?? [];
    const browserTabIds = tabIds.filter((tabId) => (
      tabs.some((tab) => tab.type === "browser" && tab.id === tabId && tab.ownerSessionId === sessionId)
    ));
    reorderTabs(sessionId, tabIds);
    if (browserSessionIsOwnedBy(sessionId)) {
      void getElectronBrowser()?.reorderTabs?.(browserTabIds);
    }
  }, [reorderTabs]);
}
