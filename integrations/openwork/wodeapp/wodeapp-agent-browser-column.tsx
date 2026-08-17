/** @jsxImportSource react */
import * as React from "react";
import { ExternalLink, RefreshCw, X } from "lucide-react";

import { isElectronRuntime } from "@/app/utils";
import { usePlatform } from "@/react-app/kernel/platform";

import {
  computeBounds,
  getElectronBrowser,
  hasNativeBrowserOccluder,
  sameBounds,
} from "../session/panel/utils";
import { setWodeAppAgentBrowserActive } from "./wodeapp-agent-browser-state";
import type { WodeAppBuiltinAgent } from "./runtime-projects";

const MIN_AGENT_BROWSER_WIDTH = 420;
const CHAT_COLUMN_MIN_WIDTH = 400;
const CHAT_COLUMN_PREFERRED_MAX = 520;
const AGENT_BROWSER_DEFAULT_RATIO = 0.58;

export function resolveDefaultAgentBrowserWidth(containerWidth: number) {
  const minMain = Math.min(
    CHAT_COLUMN_PREFERRED_MAX,
    Math.max(CHAT_COLUMN_MIN_WIDTH, Math.round(containerWidth * 0.38)),
  );
  const maxPanel = Math.max(MIN_AGENT_BROWSER_WIDTH, containerWidth - minMain);
  const preferred = Math.round(containerWidth * AGENT_BROWSER_DEFAULT_RATIO);
  return Math.min(Math.max(preferred, MIN_AGENT_BROWSER_WIDTH), maxPanel);
}

export function getAgentBrowserWidthRange(containerWidth: number) {
  const minMain = Math.min(
    CHAT_COLUMN_PREFERRED_MAX,
    Math.max(CHAT_COLUMN_MIN_WIDTH, Math.round(containerWidth * 0.38)),
  );
  const maxPanel = Math.max(MIN_AGENT_BROWSER_WIDTH, containerWidth - minMain);
  return {
    min: MIN_AGENT_BROWSER_WIDTH,
    max: maxPanel,
  };
}

/** 内嵌打开时给页面加 embed=1 和 wodeappx=1，站点只渲染主体组件并识别桌面来源 */
function withEmbedParam(url: string): string {
  if (!url) return url;
  try {
    const next = new URL(url);
    if (!next.searchParams.has("embed")) next.searchParams.set("embed", "1");
    if (!next.searchParams.has("wodeappx")) next.searchParams.set("wodeappx", "1");
    return next.toString();
  } catch {
    return url;
  }
}

type WodeAppAgentBrowserColumnProps = {
  tabs: WodeAppBuiltinAgent[];
  activeTabId: string;
  onSelectTab: (agentId: string) => void;
  onCloseTab: (agentId: string) => void;
  onClosePanel: () => void;
};

export function WodeAppAgentBrowserColumn({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onClosePanel,
}: WodeAppAgentBrowserColumnProps) {
  const platform = usePlatform();
  const activeAgent = React.useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0] ?? null,
    [activeTabId, tabs],
  );
  const pageUrl = activeAgent?.demoUrl ?? "";
  const embedPageUrl = withEmbedParam(pageUrl);
  const panelRef = React.useRef<HTMLElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const shownRef = React.useRef(false);
  const boundsFrameRef = React.useRef<number | null>(null);
  const lastBoundsRef = React.useRef<{ x: number; y: number; width: number; height: number } | null>(null);
  const browserTabByAgentRef = React.useRef<Map<string, string>>(new Map());
  const [resizing, setResizing] = React.useState(false);
  const userResizedRef = React.useRef(false);
  const isElectron = isElectronRuntime();

  React.useEffect(() => {
    setWodeAppAgentBrowserActive(true);
    try {
      window.dispatchEvent(new Event("openwork-close-right-pane"));
    } catch {
      // ignore
    }
    return () => {
      setWodeAppAgentBrowserActive(false);
      const browser = getElectronBrowser();
      for (const tabId of browserTabByAgentRef.current.values()) {
        void browser?.closeTab?.(tabId);
      }
      browserTabByAgentRef.current.clear();
      browser?.hide?.();
    };
  }, []);

  React.useEffect(() => {
    if (!isElectron) {
      if (pageUrl) void platform.openLink(pageUrl);
      return;
    }

    const browser = getElectronBrowser();
    if (!browser) return;

    const openTabs = tabs.filter((tab) => tab.demoUrl);
    const openTabIds = new Set(openTabs.map((tab) => tab.id));

    void (async () => {
      for (const tab of openTabs) {
        const embedUrl = withEmbedParam(tab.demoUrl ?? "");
        const existingTabId = browserTabByAgentRef.current.get(tab.id);
        if (!existingTabId) {
          const created = await browser.createTab?.(embedUrl);
          if (created?.tabId) {
            browserTabByAgentRef.current.set(tab.id, created.tabId);
          }
          continue;
        }
        const state = await browser.getState?.();
        const current = state?.tabs?.find((item) => item.id === existingTabId);
        if (current?.url !== embedUrl) {
          await browser.selectTab?.(existingTabId);
          await browser.navigate?.(embedUrl);
        }
      }

      for (const [agentId, browserTabId] of browserTabByAgentRef.current) {
        if (!openTabIds.has(agentId)) {
          await browser.closeTab?.(browserTabId);
          browserTabByAgentRef.current.delete(agentId);
        }
      }

      const activeBrowserTabId = browserTabByAgentRef.current.get(activeTabId);
      if (activeBrowserTabId) {
        await browser.selectTab?.(activeBrowserTabId);
      }
    })();
  }, [activeTabId, isElectron, pageUrl, platform, tabs]);

  React.useLayoutEffect(() => {
    const browser = getElectronBrowser();
    const content = contentRef.current;

    if (!browser || !content || !isElectron || !pageUrl) {
      browser?.hide?.();
      shownRef.current = false;
      lastBoundsRef.current = null;
      return;
    }

    let disposed = false;

    const syncBounds = () => {
      const bounds = computeBounds(content);

      if (bounds.width < 1 || bounds.height < 1 || hasNativeBrowserOccluder()) {
        if (shownRef.current) {
          browser.hide?.();
          shownRef.current = false;
          lastBoundsRef.current = null;
        }
        return;
      }

      if (!shownRef.current) {
        browser.show?.(bounds);
        shownRef.current = true;
        lastBoundsRef.current = bounds;
        return;
      }

      if (!sameBounds(lastBoundsRef.current, bounds)) {
        browser.setBounds?.(bounds);
        lastBoundsRef.current = bounds;
      }
    };

    const watchBounds = () => {
      syncBounds();
      boundsFrameRef.current = window.requestAnimationFrame(watchBounds);
    };

    void Promise.resolve(browser.hide?.()).finally(() => {
      if (disposed) return;
      boundsFrameRef.current = window.requestAnimationFrame(watchBounds);
    });

    const observer = new ResizeObserver(syncBounds);
    observer.observe(content);
    window.addEventListener("resize", syncBounds);
    window.addEventListener("scroll", syncBounds, true);

    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
      window.removeEventListener("scroll", syncBounds, true);

      if (boundsFrameRef.current != null) {
        window.cancelAnimationFrame(boundsFrameRef.current);
        boundsFrameRef.current = null;
      }

      browser.hide?.();
      shownRef.current = false;
      lastBoundsRef.current = null;
    };
  }, [activeTabId, isElectron, pageUrl]);

  const syncPanelWidth = React.useCallback((width: number) => {
    const container = panelRef.current?.closest(".wapp-workspace-main") as HTMLElement | null;
    if (!container) return;
    container.style.setProperty("--wapp-agent-browser-width", `${Math.round(width)}px`);
  }, []);

  React.useLayoutEffect(() => {
    userResizedRef.current = false;
  }, [activeTabId]);

  React.useLayoutEffect(() => {
    const container = panelRef.current?.closest(".wapp-workspace-main") as HTMLElement | null;
    if (!container) return;

    const applyDefaultWidth = () => {
      if (userResizedRef.current) return;
      const containerWidth = container.getBoundingClientRect().width;
      if (containerWidth < 1) return;
      syncPanelWidth(resolveDefaultAgentBrowserWidth(containerWidth));
    };

    applyDefaultWidth();

    const observer = new ResizeObserver(() => {
      applyDefaultWidth();
    });
    observer.observe(container);
    window.addEventListener("resize", applyDefaultWidth);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", applyDefaultWidth);
    };
  }, [activeTabId, syncPanelWidth]);

  const startResize = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const container = panelRef.current?.closest(".wapp-workspace-main") as HTMLElement | null;
    const panel = panelRef.current;
    if (!container || !panel) return;

    event.preventDefault();
    userResizedRef.current = true;
    const startX = event.clientX;
    const startWidth = panel.getBoundingClientRect().width;
    const containerWidth = container.getBoundingClientRect().width;
    const { max: maxPanel } = getAgentBrowserWidthRange(containerWidth);

    setResizing(true);
    document.body.classList.add("wapp-agent-column-resizing");

    const onMouseMove = (moveEvent: MouseEvent) => {
      moveEvent.preventDefault();
      const nextWidth = Math.min(
        Math.max(MIN_AGENT_BROWSER_WIDTH, startWidth + startX - moveEvent.clientX),
        maxPanel,
      );
      syncPanelWidth(nextWidth);
    };

    const stopResize = () => {
      setResizing(false);
      document.body.classList.remove("wapp-agent-column-resizing");
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", stopResize);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", stopResize);
  }, [syncPanelWidth]);

  const reload = () => {
    if (isElectron) {
      void getElectronBrowser()?.reload?.();
      return;
    }
    if (pageUrl) void platform.openLink(pageUrl);
  };

  const openExternal = () => {
    if (pageUrl) void platform.openLink(pageUrl);
  };

  const handleCloseTab = (agentId: string, event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (tabs.length <= 1) {
      onClosePanel();
      return;
    }
    onCloseTab(agentId);
  };

  return (
    <aside
      ref={panelRef}
      className={`wapp-agent-browser-column${resizing ? " is-resizing" : ""}`}
      aria-label="智能体预览"
    >
      <button
        type="button"
        className="wapp-agent-column-resizer"
        aria-label="调整预览栏宽度"
        title="拖动调整预览栏宽度"
        onMouseDown={startResize}
      />
      <header className="wapp-agent-browser-head">
        <div className="wapp-agent-browser-tabs" role="tablist" aria-label="已打开的智能体">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <div
                key={tab.id}
                role="presentation"
                className={`wapp-agent-browser-tab${active ? " is-active" : ""}`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className="wapp-agent-browser-tab-main"
                  title={tab.meta ? `${tab.name} · ${tab.meta}` : tab.name}
                  onClick={() => onSelectTab(tab.id)}
                >
                  <span className="wapp-agent-browser-tab-title">{tab.name}</span>
                </button>
                <button
                  type="button"
                  className="wapp-agent-browser-tab-close"
                  aria-label={`关闭 ${tab.name}`}
                  title="关闭标签"
                  onClick={(event) => handleCloseTab(tab.id, event)}
                >
                  <X aria-hidden className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="wapp-agent-browser-actions">
          <button type="button" className="wapp-agent-browser-action" onClick={reload}>
            <RefreshCw aria-hidden />
            刷新
          </button>
          <button type="button" className="wapp-agent-browser-action" onClick={openExternal}>
            <ExternalLink aria-hidden />
            外部打开
          </button>
          <button
            type="button"
            className="wapp-agent-browser-action"
            aria-label="关闭预览栏"
            onClick={onClosePanel}
          >
            <X aria-hidden />
            关闭
          </button>
        </div>
      </header>
      <div className="wapp-agent-browser-body">
        {isElectron ? (
          <div ref={contentRef} className="wapp-agent-browser-host" />
        ) : pageUrl ? (
          <iframe
            key={activeTabId}
            className="wapp-agent-browser-frame"
            src={embedPageUrl}
            title={activeAgent?.name ?? "智能体预览"}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
          />
        ) : (
          <p className="wapp-agent-browser-empty">暂无预览页面</p>
        )}
      </div>
    </aside>
  );
}

