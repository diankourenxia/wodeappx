#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isLoginCancelKey, isLoginCancelUrl } from "./login-bridge-close.mjs";
import {
  applyDesktopHandoffCors,
  buildDesktopLoginUrl,
  isDesktopBootstrapRouteMissing,
  isDesktopHandoffCorsOrigin,
  parseDesktopHandoffPayload,
} from "./login-bridge-handoff.mjs";

test("Escape without modifiers cancels desktop login", () => {
  assert.equal(isLoginCancelKey({ type: "keyDown", key: "Escape" }), true);
  assert.equal(isLoginCancelKey({ type: "keyUp", key: "Escape" }), false);
  assert.equal(isLoginCancelKey({ type: "keyDown", key: "Escape", meta: true }), false);
  assert.equal(isLoginCancelKey({ type: "keyDown", key: "w", meta: true }), false);
});

test("desktop login cancel hash is detected in navigation urls", () => {
  assert.equal(
    isLoginCancelUrl("https://wodeapp.cn/login?from=desktop#wodeapp-login-cancel"),
    true,
  );
  assert.equal(isLoginCancelUrl("https://wodeapp.cn/login?from=desktop"), false);
  assert.equal(isLoginCancelUrl(""), false);
});

test("desktop login opens the system browser instead of an embedded window", () => {
  const source = readFileSync(new URL("./login-bridge.mjs", import.meta.url), "utf8");
  const handoff = readFileSync(new URL("./login-bridge-handoff.mjs", import.meta.url), "utf8");
  assert.match(source, /shell\.openExternal/);
  assert.match(source, /activate:\s*true/);
  assert.match(source, /cancelWodeAppDesktopLogin/);
  assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /DESKTOP_HANDOFF_PATH/);
  assert.match(source, /onProgress/);
  assert.match(handoff, /\/desktop-handoff\.html/);
  assert.doesNotMatch(source, /new BrowserWindow/);
  assert.doesNotMatch(source, /loadURL\(`\$\{activeBase\}\/login/);
});

test("official origins can call the loopback handoff", () => {
  assert.equal(isDesktopHandoffCorsOrigin("https://wodeapp.ai"), true);
  assert.equal(isDesktopHandoffCorsOrigin("https://wodeapp.cn"), true);
  assert.equal(isDesktopHandoffCorsOrigin("https://attacker.invalid"), false);
  const headers = {};
  const res = { setHeader(name, value) { headers[name] = value; } };
  assert.equal(applyDesktopHandoffCors(res, "https://wodeapp.cn"), true);
  assert.equal(headers["Access-Control-Allow-Private-Network"], "true");
});

test("desktop login url carries loopback port and state", () => {
  const url = buildDesktopLoginUrl("https://wodeapp.ai", 54321, "abcDEF123_-zzzzzz");
  assert.equal(
    url,
    "https://wodeapp.ai/desktop-handoff.html?desktop_port=54321&desktop_state=abcDEF123_-zzzzzz",
  );
});

test("404 means desktop-bootstrap is not deployed yet", () => {
  assert.equal(isDesktopBootstrapRouteMissing(404), true);
  assert.equal(isDesktopBootstrapRouteMissing(401), false);
  assert.equal(isDesktopBootstrapRouteMissing(403), false);
});

test("handoff payload requires matching state and a platform api key", () => {
  const state = "abcDEF123_-zzzzzz";
  assert.equal(parseDesktopHandoffPayload("not-json", state).ok, false);
  assert.deepEqual(
    parseDesktopHandoffPayload(JSON.stringify({ state, cancel: true }), state),
    { ok: true, cancel: true },
  );
  assert.equal(
    parseDesktopHandoffPayload(JSON.stringify({ state: "other", data: { apiKey: "sk_live_x" } }), state).ok,
    false,
  );
  const parsed = parseDesktopHandoffPayload(
    JSON.stringify({ state, data: { apiKey: "sk_live_example", issuedOrigin: "https://wodeapp.cn" } }),
    state,
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.cancel, false);
  assert.equal(parsed.data.apiKey, "sk_live_example");
  assert.deepEqual(
    parseDesktopHandoffPayload(JSON.stringify({ state, phase: "initializing" }), state),
    { ok: true, progress: true, phase: "initializing" },
  );
});
