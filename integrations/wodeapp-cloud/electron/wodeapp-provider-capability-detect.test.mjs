import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  collectProviderSecrets,
  extractCloudRegistryRecords,
  extractModelRecords,
  loadMonorepoEnvSecretMap,
  looksLikeEnvPlaceholder,
  maskKeyPreview,
  parseDotEnv,
  probeProviderSecret,
} from "./wodeapp-provider-capability-detect.mjs";

test("extractModelRecords reads OpenAI-style and OpenRouter output modalities", () => {
  const records = extractModelRecords({
    data: [
      { id: "deepseek-chat" },
      {
        id: "vendor/gen",
        architecture: { output_modalities: ["image"] },
      },
    ],
  });
  assert.equal(records[0].id, "deepseek-chat");
  assert.deepEqual(records[1].outputModalities, ["image"]);
});

test("extractCloudRegistryRecords keeps image/video buckets", () => {
  const records = extractCloudRegistryRecords({
    models: [{ value: "wode/kimi-code-k3-256k", label: "Kimi" }],
    registry: {
      image: [{ id: "doubao-seedream-5-0" }],
      video: [{ id: "doubao-seedance-2-0-mini" }],
    },
  });
  assert.ok(records.some((item) => item.id === "wode/kimi-code-k3-256k"));
  assert.ok(records.some((item) => item.id === "doubao-seedream-5-0" && item.outputModalities?.includes("image")));
  assert.ok(records.some((item) => item.id === "doubao-seedance-2-0-mini" && item.outputModalities?.includes("video")));
});

test("probeProviderSecret never returns the raw key", async () => {
  const result = await probeProviderSecret({
    id: "deepseek",
    label: "DeepSeek",
    apiKey: "sk-deepseek-secret-key-value",
    modelsUrl: "https://api.deepseek.com/models",
  }, {
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ data: [{ id: "deepseek-chat" }] }),
    }),
  });
  assert.equal(result.probeStatus, "ok");
  assert.equal(result.models[0].id, "deepseek-chat");
  assert.equal(result.keyPreview, maskKeyPreview("sk-deepseek-secret-key-value"));
  assert.equal(JSON.stringify(result).includes("sk-deepseek-secret-key-value"), false);
});

test("401 is unauthorized, not a silent text-only estimate", async () => {
  const result = await probeProviderSecret({
    id: "volcano",
    label: "火山方舟 ARK",
    apiKey: "ark-bad",
    modelsUrl: "https://ark.cn-beijing.volces.com/api/v3/models",
  }, {
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: "unauthorized" } }),
    }),
  });
  assert.equal(result.probeStatus, "unauthorized");
  assert.equal(result.models.length, 0);
});

test("parseDotEnv skips comments and placeholders stay flagged", () => {
  const parsed = parseDotEnv(`
# comment
ARK_API_KEY=ark-real-fixture-key
export DEEPSEEK_API_KEY="sk-deepseek-fixture"
DASHSCOPE_API_KEY=your_dashscope_api_key
`);
  assert.equal(parsed.ARK_API_KEY, "ark-real-fixture-key");
  assert.equal(parsed.DEEPSEEK_API_KEY, "sk-deepseek-fixture");
  assert.equal(looksLikeEnvPlaceholder(parsed.DASHSCOPE_API_KEY), true);
  assert.equal(looksLikeEnvPlaceholder(parsed.ARK_API_KEY), false);
});

test("collects volcano/deepseek/dashscope from project env without UI paste", async () => {
  const envMap = new Map([
    ["DEEPSEEK_API_KEY", "sk-deepseek-fixture-aaaaaaaa"],
    ["ARK_API_KEY", "ark-fixture-bbbbbbbbbbbb"],
    ["DASHSCOPE_API_KEY", "sk-dash-fixture-cccccccc"],
  ]);
  const envOrigins = new Map([
    ["DEEPSEEK_API_KEY", "project-env"],
    ["ARK_API_KEY", "project-env"],
    ["DASHSCOPE_API_KEY", "project-env"],
  ]);
  const secrets = await collectProviderSecrets({
    envMap,
    envOrigins,
    authMap: new Map(),
    mediaFile: { version: 1, providers: {} },
    processEnv: {},
  });
  assert.deepEqual(secrets.map((item) => item.id).sort(), ["dashscope", "deepseek", "volcano"]);
  assert.equal(secrets.every((item) => item.keyOrigin === "project-env"), true);
  const leaked = JSON.stringify(secrets.filter((item) => item.id === "volcano").map((item) => ({
    id: item.id,
    keyOrigin: item.keyOrigin,
    keyPreview: maskKeyPreview(item.apiKey),
  })));
  assert.equal(leaked.includes("ark-fixture-bbbbbbbbbbbb"), false);
});

test("custom OpenAI-compatible pair is collected and probed via /models", async () => {
  const secrets = await collectProviderSecrets({
    envMap: new Map([
      ["MY_PROXY_API_KEY", "sk-my-proxy-fixture"],
      ["MY_PROXY_BASE_URL", "https://proxy.example/v1"],
      ["MY_PROXY_LABEL", "我的代理"],
    ]),
    envOrigins: new Map([["MY_PROXY_API_KEY", "desktop-env"]]),
    authMap: new Map(),
    mediaFile: { version: 1, providers: {} },
    processEnv: {},
    customVendors: [],
  });
  const custom = secrets.find((item) => item.id === "custom-my-proxy");
  assert.ok(custom);
  assert.equal(custom.label, "我的代理");
  assert.equal(custom.modelsUrl, "https://proxy.example/v1/models");
  assert.equal(custom.custom, true);

  const probed = await probeProviderSecret(custom, {
    fetchImpl: async (url) => {
      assert.equal(url, "https://proxy.example/v1/models");
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ data: [{ id: "openai/gpt-5.6-sol" }] }),
      };
    },
  });
  assert.equal(probed.probeStatus, "ok");
  assert.equal(probed.models[0].id, "openai/gpt-5.6-sol");
  assert.equal(JSON.stringify(probed).includes("sk-my-proxy-fixture"), false);
});

test("kling needs both access and secret from project env", async () => {
  const incomplete = await collectProviderSecrets({
    envMap: new Map([["KLING_ACCESS_KEY", "kling-ak-fixture"]]),
    envOrigins: new Map([["KLING_ACCESS_KEY", "project-env"]]),
    authMap: new Map(),
    mediaFile: { version: 1, providers: {} },
    processEnv: {},
  });
  assert.equal(incomplete.some((item) => item.id === "kling"), false);

  const complete = await collectProviderSecrets({
    envMap: new Map([
      ["KLING_ACCESS_KEY", "kling-ak-fixture"],
      ["KLING_SECRET_KEY", "kling-sk-fixture"],
    ]),
    envOrigins: new Map([
      ["KLING_ACCESS_KEY", "project-env"],
      ["KLING_SECRET_KEY", "project-env"],
    ]),
    authMap: new Map(),
    mediaFile: { version: 1, providers: {} },
    processEnv: {},
  });
  assert.equal(complete.some((item) => item.id === "kling"), true);
});

test("runtime-server .env wins over root and skips placeholders", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wodeapp-env-"));
  try {
    await writeFile(
      path.join(root, ".env"),
      "ARK_API_KEY=your_ark_api_key\nDEEPSEEK_API_KEY=sk-root-deepseek-fixture\n",
    );
    await mkdir(path.join(root, "runtime-server"));
    await writeFile(path.join(root, "runtime-server/.env"), "ARK_API_KEY=ark-runtime-fixture-key\n");
    const loaded = await loadMonorepoEnvSecretMap({ monorepoRoot: root, processEnv: {} });
    assert.equal(loaded.map.get("ARK_API_KEY"), "ark-runtime-fixture-key");
    assert.equal(loaded.map.get("DEEPSEEK_API_KEY"), "sk-root-deepseek-fixture");
    assert.equal(loaded.origins.get("ARK_API_KEY"), "project-env");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("after migrate, live collect ignores later project .env edits", async () => {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "wodeapp-keys-"));
  const root = await mkdtemp(path.join(os.tmpdir(), "wodeapp-env-"));
  const prevStore = process.env.OPENWORK_ENV_STORE;
  process.env.OPENWORK_ENV_STORE = path.join(homeDir, ".wodeapp", "keys.json");
  try {
    await writeFile(path.join(root, ".env"), "ARK_API_KEY=ark-first-migrate-fixture\n");
    const first = await collectProviderSecrets({
      homeDir,
      monorepoRoot: root,
      authMap: new Map(),
      mediaFile: { version: 1, providers: {} },
      processEnv: {},
    });
    const volcano = first.find((item) => item.id === "volcano");
    assert.equal(volcano?.apiKey, "ark-first-migrate-fixture");
    assert.equal(volcano?.keyOrigin, "desktop-env");

    await writeFile(path.join(root, ".env"), "ARK_API_KEY=ark-second-should-be-ignored\n");
    const second = await collectProviderSecrets({
      homeDir,
      monorepoRoot: root,
      authMap: new Map(),
      mediaFile: { version: 1, providers: {} },
      processEnv: {},
    });
    const again = second.find((item) => item.id === "volcano");
    assert.equal(again?.apiKey, "ark-first-migrate-fixture");
    assert.equal(again?.keyOrigin, "desktop-env");
  } finally {
    if (prevStore === undefined) delete process.env.OPENWORK_ENV_STORE;
    else process.env.OPENWORK_ENV_STORE = prevStore;
    await rm(homeDir, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  }
});
