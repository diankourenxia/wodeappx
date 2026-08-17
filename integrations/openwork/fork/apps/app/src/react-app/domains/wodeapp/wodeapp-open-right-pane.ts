export type OpenRightPaneDetail = {
  pane?: string;
  url?: string;
  sessionId?: string;
};

export type OpenRightPaneSessionScope = {
  sourceSessionId: string | null;
  /** True when the open should activate the current route's native browser / side panel. */
  shouldActivateNow: boolean;
};

/**
 * Resolve which session an `openwork-open-right-pane` event belongs to.
 * Explicit sessionId from tools must never steal another session's third column.
 * Missing sessionId = UI-initiated open for the current route session.
 */
export function resolveOpenRightPaneSessionScope(
  detail: Pick<OpenRightPaneDetail, "sessionId"> | undefined,
  routeSessionId: string | null,
): OpenRightPaneSessionScope {
  const explicit = typeof detail?.sessionId === "string" ? detail.sessionId.trim() : "";
  if (explicit) {
    return {
      sourceSessionId: explicit,
      shouldActivateNow: Boolean(routeSessionId && explicit === routeSessionId),
    };
  }
  return {
    sourceSessionId: routeSessionId,
    shouldActivateNow: Boolean(routeSessionId),
  };
}

/** Store a restorable browser tab for a background session until the user switches back. */
export function pendingBrowserPanelTab(sessionId: string, url: string) {
  const trimmedUrl = url.trim();
  return {
    id: `pending-browser:${sessionId}:${trimmedUrl}`,
    type: "browser" as const,
    ownerSessionId: sessionId,
    label: trimmedUrl,
    url: trimmedUrl,
    favicon: null as string | null,
    status: "ready" as const,
    canGoBack: false,
    canGoForward: false,
  };
}
