import assert from "node:assert/strict";
import test from "node:test";

import {
  editionProcessEnv,
  parseWodeAppEditionId,
  resolveEditionAppName,
  resolveWodeAppEdition,
  WODEAPP_EDITIONS,
} from "./wodeapp-edition.mjs";

test("defaults to oss / WodeAppX when env unset", () => {
  assert.equal(parseWodeAppEditionId({}), "oss");
  assert.equal(resolveWodeAppEdition({}).productName, "WodeAppX");
});

test("parses oss aliases", () => {
  for (const value of ["oss", "open-source", "wodeappx", "Open-Source"]) {
    assert.equal(parseWodeAppEditionId({ WODEAPPX_EDITION: value }), "oss");
  }
  assert.equal(resolveWodeAppEdition({ WODEAPPX_EDITION: "oss" }).productName, "WodeAppX");
});

test("maps leftover commercial env names to oss", () => {
  for (const value of ["xiaolingtong", "xlt", "commercial", "xiaolingtong-ai"]) {
    assert.equal(parseWodeAppEditionId({ WODEAPPX_EDITION: value }), "oss");
  }
});

test("rejects unknown edition", () => {
  assert.throws(() => parseWodeAppEditionId({ WODEAPPX_EDITION: "supor" }), /Unknown WODEAPPX_EDITION/);
});

test("resolveEditionAppName respects explicit OPENWORK_ELECTRON_APP_NAME", () => {
  assert.equal(
    resolveEditionAppName({
      isDevMode: true,
      env: { WODEAPPX_EDITION: "oss", OPENWORK_ELECTRON_APP_NAME: "Custom" },
    }),
    "Custom",
  );
});

test("resolveEditionAppName picks dev/test/product names", () => {
  assert.equal(
    resolveEditionAppName({ isDevMode: true, env: { WODEAPPX_EDITION: "oss" } }),
    WODEAPP_EDITIONS.oss.productNameDev,
  );
  assert.equal(
    resolveEditionAppName({ isTestInstance: true, env: { WODEAPPX_EDITION: "oss" } }),
    WODEAPP_EDITIONS.oss.productNameTest,
  );
  assert.equal(
    resolveEditionAppName({ env: { WODEAPPX_EDITION: "oss" } }),
    "WodeAppX",
  );
});

test("editionProcessEnv injects Vite + Electron vars without clobbering app name", () => {
  const injected = editionProcessEnv("oss", {});
  assert.equal(injected.WODEAPPX_EDITION, "oss");
  assert.equal(injected.VITE_WODEAPPX_EDITION, "oss");
  assert.equal(injected.OPENWORK_ELECTRON_APP_NAME, "WodeAppX");

  const kept = editionProcessEnv("oss", { OPENWORK_ELECTRON_APP_NAME: "Keep Me" });
  assert.equal(kept.OPENWORK_ELECTRON_APP_NAME, undefined);
});
