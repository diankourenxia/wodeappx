export const WODEAPP_WORKBENCH_SIDEBAR_WIDTH = 228;
export const WODEAPP_WORKBENCH_ICON_RAIL_WIDTH = 44;

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

export function resolveWodeAppWorkbenchMainWidth(windowWidth = typeof window !== "undefined" ? window.innerWidth : 1280) {
  return Math.max(640, windowWidth - WODEAPP_WORKBENCH_SIDEBAR_WIDTH - WODEAPP_WORKBENCH_ICON_RAIL_WIDTH);
}

export function resolveWodeAppBrowserPanelWidth(windowWidth = typeof window !== "undefined" ? window.innerWidth : 1280) {
  return resolveDefaultAgentBrowserWidth(resolveWodeAppWorkbenchMainWidth(windowWidth));
}
