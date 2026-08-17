#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import {
  inferWodeAppProfile,
  maskWodeAppApiKey,
  summarizeWodeAppServiceConfig,
  WODEAPP_CLOUD_ORIGIN,
  WODEAPP_LOCAL_ORIGIN,
} from "./config-store.mjs";

test("keeps official .ai and .cn origins instead of folding them together", async () => {
  const { normalizeWodeAppCloudOrigin, WODEAPP_CLOUD_ORIGIN_AI, WODEAPP_CLOUD_ORIGIN_CN } = await import("./config-store.mjs");
  assert.equal(normalizeWodeAppCloudOrigin(), WODEAPP_CLOUD_ORIGIN_AI);
  assert.equal(normalizeWodeAppCloudOrigin("https://wodeapp.ai"), WODEAPP_CLOUD_ORIGIN_AI);
  assert.equal(normalizeWodeAppCloudOrigin("https://www.wodeapp.ai/"), WODEAPP_CLOUD_ORIGIN_AI);
  assert.equal(normalizeWodeAppCloudOrigin("https://wodeapp.cn"), WODEAPP_CLOUD_ORIGIN_CN);
  assert.equal(normalizeWodeAppCloudOrigin("https://www.wodeapp.cn"), WODEAPP_CLOUD_ORIGIN_CN);
  assert.equal(inferWodeAppProfile("https://wodeapp.ai"), "local-only");
  assert.equal(inferWodeAppProfile("https://wodeapp.cn"), "local-only");
  assert.equal(inferWodeAppProfile("https://wodeapp.ai", "cloud"), "cloud");
  assert.equal(inferWodeAppProfile(WODEAPP_LOCAL_ORIGIN), "selfhost");
  assert.equal(inferWodeAppProfile(WODEAPP_CLOUD_ORIGIN, "local-only"), "local-only");
});

test("masks api keys for UI preview", () => {
  assert.equal(maskWodeAppApiKey(""), null);
  assert.equal(maskWodeAppApiKey("sk_live_abcdefghijklmnop"), "sk_live_…mnop");
});

test("summarizes service config without exposing full key", () => {
  const summary = summarizeWodeAppServiceConfig({
    profile: "cloud",
    origin: WODEAPP_CLOUD_ORIGIN,
    apiKey: "sk_live_abcdefghijklmnop",
    embedded: true,
    user: { id: "u1", name: "Test" },
  });
  assert.equal(summary.profile, "cloud");
  assert.equal(summary.origin, WODEAPP_CLOUD_ORIGIN);
  assert.equal(summary.hasApiKey, true);
  assert.equal(summary.apiKeyPreview, "sk_live_…mnop");
  assert.equal(summary.embedded, true);
  assert.equal(summary.user?.id, "u1");
});

test("normalizes brand-agents config and drops invalid entries", async () => {
  const { normalizeWodeAppBrandAgentsFile } = await import("./config-store.mjs");
  const file = normalizeWodeAppBrandAgentsFile({
    version: 1,
    agents: [
      { id: "wynne-brand-agent", name: "Wynne", brandId: "wynne", workbench: "wynne" },
      { id: "bad", name: "Missing brand" },
      { id: "visual-generation", name: "Reserved", brandId: "x" },
      { id: "wynne-brand-agent", name: "Dup", brandId: "wynne" },
      { id: "acme-brand-agent", name: "Acme", brandId: "acme", connectorScopes: ["shopify", "twitter"] },
    ],
  });
  assert.equal(file.version, 1);
  assert.equal(file.ok, true);
  assert.equal(file.agents.length, 2);
  assert.equal(file.agents[0].id, "wynne-brand-agent");
  assert.equal(file.agents[0].workbench, "wynne");
  assert.equal(file.agents[1].id, "acme-brand-agent");
  assert.deepEqual(file.agents[1].connectorScopes, ["shopify"]);
});

test("brand-agents seed includes Wynne demo for missing local file", async () => {
  const { WODEAPP_BRAND_AGENTS_SEED, normalizeWodeAppBrandAgentsFile } = await import("./config-store.mjs");
  const seeded = normalizeWodeAppBrandAgentsFile(WODEAPP_BRAND_AGENTS_SEED);
  assert.equal(seeded.ok, true);
  assert.equal(seeded.agents.length, 1);
  assert.equal(seeded.agents[0].id, "wynne-brand-agent");
  assert.equal(seeded.agents[0].workbench, "wynne");
});
