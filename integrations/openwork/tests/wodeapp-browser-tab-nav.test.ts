import { afterEach, describe, expect, test } from "bun:test";

import { openOrActivateWodeAppBrowserTab } from "../../../vendor/openwork/apps/app/src/react-app/domains/wodeapp/wodeapp-browser-tab-nav";

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

afterEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
});

describe("WodeAppX workbench browser navigation", () => {
  test("reselects the requested workbench when stale session restore briefly activates Google", async () => {
    const workbenchUrl = "https://video.example/?shareDoc=pvs_demo";
    const state = {
      activeTabId: "tab-google",
      tabs: [
        { id: "tab-google", url: "https://www.google.com/" },
        { id: "tab-video", url: workbenchUrl },
      ],
    };
    const selected: string[] = [];
    const browser = {
      getState: async () => state,
      selectTab: async (tabId: string) => {
        selected.push(tabId);
        state.activeTabId = tabId;
      },
      reload: async () => undefined,
      show: async () => undefined,
      setBounds: async () => undefined,
    };
    const content = {
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 640, height: 720 }),
    };
    const panel = {
      querySelector: () => content,
      lastElementChild: null,
    };

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        __OPENWORK_ELECTRON__: { browser },
        location: { href: "http://localhost/#/session/ses_test" },
        setTimeout,
      },
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { querySelector: () => panel },
    });

    expect(await openOrActivateWodeAppBrowserTab(workbenchUrl)).toBe(true);
    expect(state.activeTabId).toBe("tab-video");

    state.activeTabId = "tab-google";
    await new Promise((resolve) => setTimeout(resolve, 700));

    expect(state.activeTabId).toBe("tab-video");
    expect(selected.filter((id) => id === "tab-video").length).toBeGreaterThanOrEqual(2);
  });
});
