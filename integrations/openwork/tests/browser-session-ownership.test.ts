import { beforeEach, describe, expect, test } from "bun:test";

import {
  activateBrowserSession,
  browserSessionIsOwnedBy,
  browserSessionOwner,
  releaseBrowserSession,
  resetBrowserSessionOwnershipForTests,
} from "../src/react-app/domains/session/panel/browser-session-ownership";

beforeEach(() => resetBrowserSessionOwnershipForTests());

describe("native browser session ownership", () => {
  test("binds the native browser to exactly one session", async () => {
    await activateBrowserSession("ses_a", async () => "a");
    expect(browserSessionOwner()).toBe("ses_a");
    expect(browserSessionIsOwnedBy("ses_a")).toBe(true);
    expect(browserSessionIsOwnedBy("ses_b")).toBe(false);

    await activateBrowserSession("ses_b", async () => "b");
    expect(browserSessionOwner()).toBe("ses_b");
    expect(browserSessionIsOwnedBy("ses_a")).toBe(false);
  });

  test("prevents a stale activation from reclaiming ownership", async () => {
    let finishA: (() => void) | null = null;
    const a = activateBrowserSession("ses_a", async () => {
      await new Promise<void>((resolve) => { finishA = resolve; });
      return "a";
    });
    const b = activateBrowserSession("ses_b", async () => "b");
    finishA?.();

    expect(await a).toBeNull();
    expect(await b).toBe("b");
    expect(browserSessionOwner()).toBe("ses_b");
  });

  test("release removes authority to publish browser state", async () => {
    await activateBrowserSession("ses_a", async () => true);
    releaseBrowserSession("ses_a");
    expect(browserSessionOwner()).toBeNull();
    expect(browserSessionIsOwnedBy("ses_a")).toBe(false);
  });

  test("route authority can revoke an activation before it publishes ownership", async () => {
    let authorized = true;
    const result = await activateBrowserSession(
      "ses_a",
      async () => {
        authorized = false;
        return "restored";
      },
      () => authorized,
    );

    expect(result).toBeNull();
    expect(browserSessionOwner()).toBeNull();
  });
});
