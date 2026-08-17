import { describe, expect, test } from "bun:test";

import {
  pendingBrowserPanelTab,
  resolveOpenRightPaneSessionScope,
  type OpenRightPaneDetail,
} from "../../../vendor/openwork/apps/app/src/react-app/domains/wodeapp/wodeapp-open-right-pane";

describe("resolveOpenRightPaneSessionScope", () => {
  test("UI open without sessionId activates the current route session", () => {
    expect(resolveOpenRightPaneSessionScope({}, "ses_current")).toEqual({
      sourceSessionId: "ses_current",
      shouldActivateNow: true,
    });
  });

  test("matching explicit sessionId activates now", () => {
    expect(resolveOpenRightPaneSessionScope(
      { sessionId: "ses_current" },
      "ses_current",
    )).toEqual({
      sourceSessionId: "ses_current",
      shouldActivateNow: true,
    });
  });

  test("mismatched explicit sessionId does not steal the current third column", () => {
    expect(resolveOpenRightPaneSessionScope(
      { sessionId: "ses_background" },
      "ses_current",
    )).toEqual({
      sourceSessionId: "ses_background",
      shouldActivateNow: false,
    });
  });

  test("trims sessionId and ignores empty explicit values", () => {
    expect(resolveOpenRightPaneSessionScope(
      { sessionId: "  ses_current  " },
      "ses_current",
    ).shouldActivateNow).toBe(true);
    expect(resolveOpenRightPaneSessionScope(
      { sessionId: "   " },
      "ses_current",
    )).toEqual({
      sourceSessionId: "ses_current",
      shouldActivateNow: true,
    });
  });
});

describe("pendingBrowserPanelTab", () => {
  test("builds a restorable browser tab keyed by session and url", () => {
    const tab = pendingBrowserPanelTab("ses_a", " https://example.com/task ");
    expect(tab).toMatchObject({
      id: "pending-browser:ses_a:https://example.com/task",
      type: "browser",
      ownerSessionId: "ses_a",
      url: "https://example.com/task",
      status: "ready",
    });
  });
});

/**
 * Mirrors SessionPage `openwork-open-right-pane` + hashchange restore:
 * mismatch → pending tab only; match / switch-back → activate native browser for that session.
 */
type SimBrowserTab = ReturnType<typeof pendingBrowserPanelTab>;

type ThirdPanelSim = {
  routeSessionId: string | null;
  sidePanelState: Record<string, "panel" | null>;
  tabs: Record<string, SimBrowserTab[]>;
  /** Which session currently owns the native browser (global single owner). */
  nativeOwnerSessionId: string | null;
  /** URLs that were actually navigated in the live native browser. */
  liveNavigations: Array<{ sessionId: string; url: string }>;
};

function createSim(routeSessionId: string): ThirdPanelSim {
  return {
    routeSessionId,
    sidePanelState: {},
    tabs: {},
    nativeOwnerSessionId: null,
    liveNavigations: [],
  };
}

function handleOpenRightPane(sim: ThirdPanelSim, detail: OpenRightPaneDetail): ThirdPanelSim {
  if (detail.pane !== "browser") return sim;
  const url = typeof detail.url === "string" ? detail.url.trim() : "";
  const { sourceSessionId, shouldActivateNow } = resolveOpenRightPaneSessionScope(
    detail,
    sim.routeSessionId,
  );
  if (!sourceSessionId) return sim;

  if (!shouldActivateNow) {
    if (!url) {
      return {
        ...sim,
        sidePanelState: { ...sim.sidePanelState, [sourceSessionId]: "panel" },
      };
    }
    const nextTab = pendingBrowserPanelTab(sourceSessionId, url);
    const existing = (sim.tabs[sourceSessionId] ?? []).filter((tab) => tab.id !== nextTab.id);
    return {
      ...sim,
      sidePanelState: { ...sim.sidePanelState, [sourceSessionId]: "panel" },
      tabs: {
        ...sim.tabs,
        [sourceSessionId]: [...existing, nextTab],
      },
      // Must not steal live native browser from the current route session.
    };
  }

  if (!url) {
    return {
      ...sim,
      sidePanelState: { ...sim.sidePanelState, [sourceSessionId]: "panel" },
      nativeOwnerSessionId: sourceSessionId,
    };
  }

  const nextTab = pendingBrowserPanelTab(sourceSessionId, url);
  const existing = (sim.tabs[sourceSessionId] ?? []).filter((tab) => tab.id !== nextTab.id);
  return {
    ...sim,
    sidePanelState: { ...sim.sidePanelState, [sourceSessionId]: "panel" },
    tabs: {
      ...sim.tabs,
      [sourceSessionId]: [...existing, nextTab],
    },
    nativeOwnerSessionId: sourceSessionId,
    liveNavigations: [...sim.liveNavigations, { sessionId: sourceSessionId, url }],
  };
}

/** hashchange → activateNativeBrowserForSession(route) restores that session's tabs. */
function switchRouteSession(sim: ThirdPanelSim, nextSessionId: string): ThirdPanelSim {
  const restored = sim.tabs[nextSessionId] ?? [];
  const liveNavigations = [...sim.liveNavigations];
  for (const tab of restored) {
    liveNavigations.push({ sessionId: nextSessionId, url: tab.url });
  }
  return {
    ...sim,
    routeSessionId: nextSessionId,
    nativeOwnerSessionId: nextSessionId,
    liveNavigations,
  };
}

function visiblePanelForRoute(sim: ThirdPanelSim): "panel" | null {
  if (!sim.routeSessionId) return null;
  return sim.sidePanelState[sim.routeSessionId] ?? null;
}

function lastLiveUrlFor(sim: ThirdPanelSim, sessionId: string): string | null {
  for (let i = sim.liveNavigations.length - 1; i >= 0; i -= 1) {
    if (sim.liveNavigations[i]?.sessionId === sessionId) return sim.liveNavigations[i]!.url;
  }
  return null;
}

describe("third-panel session switch simulation", () => {
  const SES_A = "ses_aaa_storyboard";
  const SES_B = "ses_bbb_chat";
  const URL_A = "https://video.wodeapp.cn/agent?shareDoc=pvs_a&embed=1";
  const URL_B = "https://visual.wodeapp.cn/agent?task=batch_b&embed=1";
  const URL_A2 = "https://video.wodeapp.cn/agent?shareDoc=pvs_a2&embed=1";

  test("same-session open activates current third column", () => {
    let sim = createSim(SES_A);
    sim = handleOpenRightPane(sim, { pane: "browser", url: URL_A, sessionId: SES_A });

    expect(sim.nativeOwnerSessionId).toBe(SES_A);
    expect(visiblePanelForRoute(sim)).toBe("panel");
    expect(lastLiveUrlFor(sim, SES_A)).toBe(URL_A);
    expect(sim.tabs[SES_A]?.map((tab) => tab.url)).toEqual([URL_A]);
  });

  test("background session open does not steal current route panel", () => {
    let sim = createSim(SES_B);
    sim = handleOpenRightPane(sim, { pane: "browser", url: URL_B, sessionId: SES_B });
    expect(lastLiveUrlFor(sim, SES_B)).toBe(URL_B);

    // Session A tool opens while user stays on B
    sim = handleOpenRightPane(sim, { pane: "browser", url: URL_A, sessionId: SES_A });

    expect(sim.routeSessionId).toBe(SES_B);
    expect(sim.nativeOwnerSessionId).toBe(SES_B);
    expect(visiblePanelForRoute(sim)).toBe("panel");
    expect(lastLiveUrlFor(sim, SES_B)).toBe(URL_B);
    expect(lastLiveUrlFor(sim, SES_A)).toBeNull();
    expect(sim.sidePanelState[SES_A]).toBe("panel");
    expect(sim.tabs[SES_A]?.map((tab) => tab.url)).toEqual([URL_A]);
    expect(sim.liveNavigations.filter((entry) => entry.sessionId === SES_A)).toEqual([]);
  });

  test("switch back to source session restores pending storyboard url", () => {
    let sim = createSim(SES_B);
    sim = handleOpenRightPane(sim, { pane: "browser", url: URL_A, sessionId: SES_A });
    expect(sim.nativeOwnerSessionId).toBeNull();
    expect(visiblePanelForRoute(sim)).toBeNull();

    sim = switchRouteSession(sim, SES_A);

    expect(sim.routeSessionId).toBe(SES_A);
    expect(sim.nativeOwnerSessionId).toBe(SES_A);
    expect(visiblePanelForRoute(sim)).toBe("panel");
    expect(lastLiveUrlFor(sim, SES_A)).toBe(URL_A);
  });

  test("A↔B round-trip keeps each session's pending url isolated", () => {
    let sim = createSim(SES_A);

    // On A: open A's storyboard
    sim = handleOpenRightPane(sim, { pane: "browser", url: URL_A, sessionId: SES_A });
    expect(lastLiveUrlFor(sim, SES_A)).toBe(URL_A);

    // Switch to B
    sim = switchRouteSession(sim, SES_B);
    expect(sim.nativeOwnerSessionId).toBe(SES_B);

    // On B: open B's batch studio
    sim = handleOpenRightPane(sim, { pane: "browser", url: URL_B, sessionId: SES_B });
    expect(lastLiveUrlFor(sim, SES_B)).toBe(URL_B);

    // Still on B: A's tool opens an updated storyboard — must not replace B's live url
    sim = handleOpenRightPane(sim, { pane: "browser", url: URL_A2, sessionId: SES_A });
    expect(sim.nativeOwnerSessionId).toBe(SES_B);
    expect(lastLiveUrlFor(sim, SES_B)).toBe(URL_B);
    expect(sim.tabs[SES_A]?.map((tab) => tab.url)).toEqual([URL_A, URL_A2]);

    // Switch back to A → restore A's tabs (latest pending last)
    sim = switchRouteSession(sim, SES_A);
    expect(sim.nativeOwnerSessionId).toBe(SES_A);
    expect(lastLiveUrlFor(sim, SES_A)).toBe(URL_A2);
    expect(visiblePanelForRoute(sim)).toBe("panel");

    // Switch to B again → B still has its own url, not A's
    sim = switchRouteSession(sim, SES_B);
    expect(sim.nativeOwnerSessionId).toBe(SES_B);
    expect(lastLiveUrlFor(sim, SES_B)).toBe(URL_B);
    expect(sim.tabs[SES_B]?.map((tab) => tab.url)).toEqual([URL_B]);
    expect(sim.tabs[SES_A]?.map((tab) => tab.url)).toEqual([URL_A, URL_A2]);
  });

  test("sidebar image/video race: open with new sessionId before route switch restores on navigate", () => {
    const SES_OLD = "ses_old_chat";
    const SES_NEW = "ses_new_video";
    const URL = "https://ai.wodeapp.cn/video?wodeappx=1&embed=1";
    let sim = createSim(SES_OLD);

    // Fixed order: create returns SES_NEW, then open with that sessionId while hash may still be old.
    sim = handleOpenRightPane(sim, { pane: "browser", url: URL, sessionId: SES_NEW });
    expect(sim.routeSessionId).toBe(SES_OLD);
    expect(sim.nativeOwnerSessionId).toBeNull();
    expect(visiblePanelForRoute(sim)).toBeNull();
    expect(sim.sidePanelState[SES_NEW]).toBe("panel");
    expect(sim.tabs[SES_NEW]?.map((tab) => tab.url)).toEqual([URL]);

    sim = switchRouteSession(sim, SES_NEW);
    expect(visiblePanelForRoute(sim)).toBe("panel");
    expect(sim.nativeOwnerSessionId).toBe(SES_NEW);
    expect(lastLiveUrlFor(sim, SES_NEW)).toBe(URL);
  });

  test("UI open without sessionId always binds to current route (compat)", () => {
    let sim = createSim(SES_B);
    sim = handleOpenRightPane(sim, { pane: "browser", url: URL_B });

    expect(sim.nativeOwnerSessionId).toBe(SES_B);
    expect(lastLiveUrlFor(sim, SES_B)).toBe(URL_B);
    expect(sim.tabs[SES_B]?.[0]?.ownerSessionId).toBe(SES_B);
  });
});
