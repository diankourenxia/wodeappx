import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  allocateEnvPrefix,
  listCustomVendorPairsFromEnv,
  normalizeOpenAiCompatibleBaseUrl,
  openaiCompatibleModelsUrl,
  slugifyVendorName,
  upsertCustomVendor,
} from "./desktop-custom-vendors.mjs";

async function withTempHome(fn) {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "wodeapp-custom-vendor-"));
  const prevStore = process.env.OPENWORK_ENV_STORE;
  process.env.OPENWORK_ENV_STORE = path.join(homeDir, ".wodeapp", "keys.json");
  try {
    return await fn(homeDir);
  } finally {
    if (prevStore === undefined) delete process.env.OPENWORK_ENV_STORE;
    else process.env.OPENWORK_ENV_STORE = prevStore;
    await rm(homeDir, { recursive: true, force: true });
  }
}

test("slug and URL stay OpenAI-compatible", () => {
  assert.equal(slugifyVendorName("SiliconFlow"), "SILICONFLOW");
  assert.equal(slugifyVendorName("我的代理").startsWith("CUSTOM_"), true);
  assert.equal(allocateEnvPrefix("OpenAI", []), "CUSTOM_CLOUD");
  assert.equal(openaiCompatibleModelsUrl("https://api.example.com/v1"), "https://api.example.com/v1/models");
  assert.equal(openaiCompatibleModelsUrl("https://api.example.com/v1/models"), "https://api.example.com/v1/models");
  assert.equal(normalizeOpenAiCompatibleBaseUrl("https://x.example/v1").ok, true);
  assert.equal(normalizeOpenAiCompatibleBaseUrl("https://user:pass@x.example/v1").ok, false);
});

test("env pairs become custom vendor secrets without leaking reserved prefixes", () => {
  const pairs = listCustomVendorPairsFromEnv({
    DEEPSEEK_API_KEY: "sk-deepseek",
    DEEPSEEK_BASE_URL: "https://api.deepseek.com",
    MY_PROXY_API_KEY: "sk-my-proxy",
    MY_PROXY_BASE_URL: "https://proxy.example/v1",
    MY_PROXY_LABEL: "我的代理",
  });
  assert.deepEqual(pairs.map((item) => item.id), ["custom-my-proxy"]);
  assert.equal(pairs[0].name, "我的代理");
  assert.equal(pairs[0].modelsUrl, "https://proxy.example/v1/models");
});

test("upsert writes name + base URL + key and keeps customVendors", async () => {
  await withTempHome(async (homeDir) => {
    const saved = await upsertCustomVendor({
      name: "硅基流动",
      baseURL: "https://api.siliconflow.cn/v1",
      apiKey: "sk-silicon-fixture",
    }, homeDir);
    assert.equal(saved.ok, true);
    assert.equal(saved.vendor.name, "硅基流动");
    assert.match(saved.vendor.id, /^custom-/);
    assert.equal(saved.vendor.modelsUrl, "https://api.siliconflow.cn/v1/models");
    const raw = JSON.parse(await readFile(process.env.OPENWORK_ENV_STORE, "utf8"));
    const keys = Object.fromEntries(raw.variables.map((item) => [item.key, item.value]));
    assert.equal(keys[`${saved.vendor.envPrefix}_API_KEY`], "sk-silicon-fixture");
    assert.equal(keys[`${saved.vendor.envPrefix}_BASE_URL`], "https://api.siliconflow.cn/v1");
    assert.equal(keys[`${saved.vendor.envPrefix}_LABEL`], "硅基流动");
    assert.equal(raw.customVendors[0].name, "硅基流动");
    assert.equal(JSON.stringify(saved.vendor).includes("sk-silicon-fixture"), false);
  });
});
