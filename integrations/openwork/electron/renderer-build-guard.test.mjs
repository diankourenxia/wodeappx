import assert from "node:assert/strict";
import test from "node:test";

import {
  rendererBuildErrorHtml,
  rendererDevServerErrorHtml,
  validateRendererIndex,
  waitForRendererUrl,
} from "./renderer-build-guard.mjs";

test("accepts relative Electron renderer assets", () => {
  assert.deepEqual(
    validateRendererIndex('<script src="./assets/app.js"></script>', "/app/index.html"),
    { ok: true, reason: null },
  );
});

test("rejects root-relative renderer assets that become file:///assets", () => {
  assert.deepEqual(
    validateRendererIndex('<script src="/assets/app.js"></script>', "/app/index.html"),
    { ok: false, reason: 'Invalid root-relative asset: src="/assets/app.js"' },
  );
});

test("escapes diagnostic content in the visible recovery page", () => {
  const html = rendererBuildErrorHtml("WodeAppX", '<script src="/assets/app.js">');
  assert.match(html, /桌面界面资源未正确构建/);
  assert.doesNotMatch(html, /<script src=/);
  assert.match(html, /&lt;script src=/);
});

test("shows a visible recovery page while the dev renderer is unavailable", () => {
  const html = rendererDevServerErrorHtml(
    "WodeAppX",
    "http://localhost:5188/<script>",
    "ERR_CONNECTION_REFUSED <retry>",
  );
  assert.match(html, /桌面界面正在恢复/);
  assert.match(html, /恢复后会自动重新打开/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;retry&gt;/);
});

test("waits until the renderer URL responds successfully", async () => {
  const statuses = [false, false, true];
  const calls = [];
  const ready = await waitForRendererUrl("http://localhost:5188", {
    fetchImpl: async (url) => {
      calls.push(url);
      return new Response(null, { status: statuses.shift() ? 200 : 503 });
    },
    retryDelayMs: 0,
  });

  assert.equal(ready, true);
  assert.equal(calls.length, 3);
});

test("stops waiting when recovery is aborted", async () => {
  const controller = new AbortController();
  const waiting = waitForRendererUrl("http://localhost:5188", {
    fetchImpl: async () => {
      controller.abort();
      throw new Error("offline");
    },
    retryDelayMs: 0,
    signal: controller.signal,
  });

  assert.equal(await waiting, false);
});
