import assert from "node:assert/strict";
import test from "node:test";

import {
  clearWodeAppBrowserSession,
  syncWodeAppBrowserSession,
} from "./browser-session-auth.mjs";

function mockBrowserSession({ responseStatus = 200, responseBody, setCookie = true } = {}) {
  const requests = [];
  const removals = [];
  const cookies = setCookie ? [{ name: "auth_token" }] : [];
  return {
    requests,
    removals,
    fetch: async (url, init) => {
      requests.push({ url, init });
      return {
        ok: responseStatus >= 200 && responseStatus < 300,
        status: responseStatus,
        json: async () => responseBody ?? {
          success: true,
          data: { userId: "user-1", expiresAt: "2026-07-24T00:00:00.000Z" },
        },
      };
    },
    cookies: {
      get: async ({ name } = {}) => name
        ? cookies.filter((cookie) => cookie.name === name)
        : [...cookies],
      remove: async (url, name) => {
        removals.push({ url, name });
        const index = cookies.findIndex((cookie) => cookie.name === name);
        if (index >= 0) cookies.splice(index, 1);
      },
    },
  };
}

test("syncs the first-column account into the isolated built-in browser session", async () => {
  const browserSession = mockBrowserSession();
  const result = await syncWodeAppBrowserSession(browserSession, {
    origin: "https://wodeapp.cn",
    apiKey: "sk_live_test",
  });

  assert.equal(result.ok, true);
  assert.equal(browserSession.requests.length, 1);
  assert.equal(
    browserSession.requests[0].url,
    "https://wodeapp.cn/mainserver/api/auth/desktop-session",
  );
  assert.equal(browserSession.requests[0].init.headers["X-API-Key"], "sk_live_test");
});

test("does not report success when the bridge response establishes no cookie", async () => {
  const browserSession = mockBrowserSession({ setCookie: false });
  const result = await syncWodeAppBrowserSession(browserSession, {
    origin: "https://wodeapp.cn",
    apiKey: "sk_live_test",
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /auth cookie/i);
});

test("clears browser auth cookies when the first-column account logs out", async () => {
  const browserSession = mockBrowserSession();
  browserSession.cookies.get = async ({ name } = {}) => (
    ["auth_token", "refresh_token"].includes(name) ? [{ name }] : []
  );

  const result = await clearWodeAppBrowserSession(browserSession, {
    issuedOrigin: "https://wodeapp.cn",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    browserSession.removals.map((item) => item.name),
    ["auth_token", "refresh_token"],
  );
});
