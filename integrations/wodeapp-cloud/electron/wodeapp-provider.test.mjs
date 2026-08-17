import assert from "node:assert/strict";
import test from "node:test";

import {
  applyWodeAppProviderEdits,
  buildManagedMcpBlocks,
  buildPlatformMcpBlock,
  buildShopifyAdminMcpBlock,
  fetchWodeAppAbilityProjectsDetailed,
  fetchWodeAppCredits,
  modelsFromApiIds,
  WODEAPP_API_KEY_ENV_PLACEHOLDER,
  WODEAPP_DEFAULT_MODELS,
  WODEAPP_DEFAULT_MODEL_ID,
  WODEAPP_MANAGED_MCP_CONNECTOR_DEFINITIONS,
  WODEAPP_PLATFORM_MCP_REQUEST_TIMEOUT_MS,
  WODEAPP_PREFERRED_OPENCODE_MODEL_KEY,
  WODEAPP_SHOPIFY_ADMIN_MCP_ID,
  WODEAPP_SHOPIFY_ADMIN_MCP_REQUEST_TIMEOUT_MS,
} from "./wodeapp-provider.mjs";

const config = {
  origin: "https://wodeapp.cn",
  issuedOrigin: "https://wodeapp.cn",
  apiKey: "sk_live_test",
};

test("WodeApp provider defaults to DeepSeek V4 Flash", () => {
  assert.equal(WODEAPP_PREFERRED_OPENCODE_MODEL_KEY, "wode/deepseek-v4-flash");
  assert.equal(WODEAPP_DEFAULT_MODEL_ID, "wodeapp/wode/deepseek-v4-flash");
});

test("platform MCP allows long-running media tools to finish", () => {
  const block = buildPlatformMcpBlock(config);

  assert.equal(block.timeout, WODEAPP_PLATFORM_MCP_REQUEST_TIMEOUT_MS);
  assert.equal(block.timeout, 420_000);
});

test("managed MCP and provider configs use env placeholder, not plaintext API keys", () => {
  const block = buildPlatformMcpBlock(config);
  assert.equal(block.headers["X-API-Key"], WODEAPP_API_KEY_ENV_PLACEHOLDER);
  assert.equal(block.headers.Authorization, `Bearer ${WODEAPP_API_KEY_ENV_PLACEHOLDER}`);
  assert.equal(WODEAPP_API_KEY_ENV_PLACEHOLDER, "{env:WODEAPP_API_KEY}");

  const managed = buildManagedMcpBlocks(config);
  const written = applyWodeAppProviderEdits(
    "{}",
    {
      npm: "@ai-sdk/openai-compatible",
      name: "WodeApp",
      options: {
        baseURL: "https://wodeapp.cn/mainserver/api/ai/v1",
        apiKey: WODEAPP_API_KEY_ENV_PLACEHOLDER,
        headers: { "X-API-Key": WODEAPP_API_KEY_ENV_PLACEHOLDER },
      },
      models: { "wode/minimax-m3": { name: "MiniMax M3" } },
    },
    managed,
  );
  assert.equal(written.includes("sk_live_test"), false);
  assert.equal(written.includes(WODEAPP_API_KEY_ENV_PLACEHOLDER), true);
});

test("Shopify Admin MCP reuses the authenticated WodeApp connector identity", () => {
  const block = buildShopifyAdminMcpBlock(config);

  assert.equal(WODEAPP_SHOPIFY_ADMIN_MCP_ID, "wodeapp-shopify-admin");
  assert.equal(block.url, "https://wodeapp.cn/mainserver/api/shopify/mcp");
  assert.equal(block.timeout, WODEAPP_SHOPIFY_ADMIN_MCP_REQUEST_TIMEOUT_MS);
  assert.equal(block.enabled, true);
  assert.equal(block.oauth, false);
  assert.equal(block.headers["X-API-Key"], WODEAPP_API_KEY_ENV_PLACEHOLDER);
  assert.equal(block.headers.Authorization, `Bearer ${WODEAPP_API_KEY_ENV_PLACEHOLDER}`);
});

test("managed MCP registry builds authenticated connectors without provider-specific branches", () => {
  const blocks = buildManagedMcpBlocks(config, [
    {
      id: "wodeapp-calendar",
      path: "/mainserver/api/calendar/mcp",
      timeout: 45_000,
    },
  ]);

  assert.deepEqual(Object.keys(blocks), ["wodeapp-calendar"]);
  assert.equal(blocks["wodeapp-calendar"].url, "https://wodeapp.cn/mainserver/api/calendar/mcp");
  assert.equal(blocks["wodeapp-calendar"].timeout, 45_000);
  assert.equal(blocks["wodeapp-calendar"].headers["X-API-Key"], WODEAPP_API_KEY_ENV_PLACEHOLDER);
});

test("provider sync mounts the managed MCP registry and preserves unrelated MCP entries", () => {
  const providerBlock = {
    npm: "@ai-sdk/openai-compatible",
    name: "WodeApp",
    options: {},
    models: {
      "wode/minimax-m3": { name: "MiniMax M3" },
    },
  };
  const managedBlocks = buildManagedMcpBlocks(config);
  const next = JSON.parse(applyWodeAppProviderEdits(
    JSON.stringify({
      mcp: {
        "custom-connector": {
          type: "remote",
          url: "https://example.com/mcp",
        },
      },
    }),
    providerBlock,
    managedBlocks,
  ));

  assert.deepEqual(next.mcp["custom-connector"], {
    type: "remote",
    url: "https://example.com/mcp",
  });
  assert.deepEqual(next.mcp["wodeapp-platform"], managedBlocks["wodeapp-platform"]);
  assert.deepEqual(next.mcp["wodeapp-shopify-admin"], managedBlocks["wodeapp-shopify-admin"]);
  assert.deepEqual(
    Object.keys(managedBlocks),
    WODEAPP_MANAGED_MCP_CONNECTOR_DEFINITIONS.map((definition) => definition.id),
  );
});

test("provider sync removes managed registry entries when WodeApp identity is unavailable", () => {
  const providerBlock = {
    npm: "@ai-sdk/openai-compatible",
    name: "WodeApp",
    options: {},
    models: {
      "wode/minimax-m3": { name: "MiniMax M3" },
    },
  };
  const next = JSON.parse(applyWodeAppProviderEdits(
    JSON.stringify({
      mcp: {
        "wodeapp-platform": buildPlatformMcpBlock(config),
        "wodeapp-shopify-admin": buildShopifyAdminMcpBlock(config),
        "custom-connector": {
          type: "remote",
          url: "https://example.com/mcp",
        },
      },
    }),
    providerBlock,
    {},
  ));

  assert.equal(next.mcp["wodeapp-platform"], undefined);
  assert.equal(next.mcp["wodeapp-shopify-admin"], undefined);
  assert.deepEqual(next.mcp["custom-connector"], {
    type: "remote",
    url: "https://example.com/mcp",
  });
});

test("WodeApp provider preserves image input for vision models", () => {
  const models = modelsFromApiIds(["wode/doubao-pro"], { authoritative: true });

  assert.deepEqual(models["wode/doubao-pro"].modalities, {
    input: ["text", "image"],
    output: ["text"],
  });
  assert.equal(models["wode/doubao-pro"].attachment, true);
});

test("WodeApp provider keeps text-only models text-only", () => {
  const models = modelsFromApiIds(["wode/deepseek-v4-flash"], { authoritative: true });

  assert.deepEqual(models["wode/deepseek-v4-flash"].modalities, {
    input: ["text"],
    output: ["text"],
  });
  assert.equal(models["wode/deepseek-v4-flash"].attachment, false);
});

test("WodeApp fallback catalog also preserves image input", () => {
  assert.deepEqual(WODEAPP_DEFAULT_MODELS["wode/doubao-pro"].modalities, {
    input: ["text", "image"],
    output: ["text"],
  });
  assert.equal(WODEAPP_DEFAULT_MODELS["wode/doubao-pro"].attachment, true);
});

test("Kimi K3 exposes its verified 1M context window to OpenCode", () => {
  const models = modelsFromApiIds(["moonshotai/kimi-k3"], { authoritative: true });

  assert.deepEqual(models["wode/kimi-k3"].limit, {
    context: 1_048_576,
    input: 1_048_576,
    output: 65_536,
  });
  assert.deepEqual(WODEAPP_DEFAULT_MODELS["wode/kimi-k3"].limit, {
    context: 1_048_576,
    input: 1_048_576,
    output: 65_536,
  });
});

test("stale lowercase MiniMax ids are normalized to the Wode API model", () => {
  const models = modelsFromApiIds(["minimax/minimax-m3"], { authoritative: true });

  assert.deepEqual(Object.keys(models), ["wode/minimax-m3"]);
  assert.equal(models["wode/minimax-m3"].name, "MiniMax M3");
  assert.equal(models["wode/minimax-m3"].attachment, true);
});

test("credits retry once after a transient server failure", async (t) => {
  let calls = 0;
  const requestJson = async () => {
    calls += 1;
    if (calls === 1) {
      return { ok: false, status: 500, json: { success: false, error: "temporary" } };
    }
    return { ok: true, status: 200, json: { success: true, data: { credits: 1093309 } } };
  };

  const credits = await fetchWodeAppCredits(config, {
    attempts: 2,
    timeoutMs: 1000,
    retryDelayMs: 0,
    requestJson,
  });

  assert.equal(credits, 1093309);
  assert.equal(calls, 2);
});

test("account bootstrap returns the authenticated profile with projects", async (t) => {
  const requestJson = async () => ({
    ok: true,
    status: 200,
    json: {
      success: true,
      data: {
        user: { id: "user_1", name: "测试账号" },
        abilityProjects: [{
          id: "image",
          title: "图片智能体",
          projectId: "project_1",
          launchUrl: "https://image.wodeapp.cn",
        }],
      },
    },
  });

  const result = await fetchWodeAppAbilityProjectsDetailed(config, { requestJson });

  assert.deepEqual(result.user, { id: "user_1", name: "测试账号" });
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].launchUrl, "https://image.wodeapp.cn");
});

test("null config does not throw when signing out / clearing provider", () => {
  assert.equal(buildPlatformMcpBlock(null), null);
  assert.deepEqual(buildManagedMcpBlocks(null), {});
  assert.equal(buildShopifyAdminMcpBlock(undefined), null);
});

test("provider sync keeps peer vendor defaults instead of forcing WodeApp", () => {
  const providerBlock = {
    npm: "@ai-sdk/openai-compatible",
    name: "WodeApp",
    options: {},
    models: {
      "wode/deepseek-v4-flash": { name: "DeepSeek V4 Flash" },
    },
  };
  const volcano = JSON.parse(applyWodeAppProviderEdits(
    JSON.stringify({ model: "volcano/doubao-seed-2-1-pro-260628" }),
    providerBlock,
    {},
  ));
  assert.equal(volcano.model, "volcano/doubao-seed-2-1-pro-260628");

  const deepseek = JSON.parse(applyWodeAppProviderEdits(
    JSON.stringify({ model: "deepseek/deepseek-chat" }),
    providerBlock,
    {},
  ));
  assert.equal(deepseek.model, "deepseek/deepseek-chat");

  const empty = JSON.parse(applyWodeAppProviderEdits("{}", providerBlock, {}));
  assert.equal(empty.model, undefined);
});
