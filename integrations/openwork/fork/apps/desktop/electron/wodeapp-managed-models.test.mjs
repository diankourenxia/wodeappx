import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MANAGED_COMPACTION_POLICY,
  MANAGED_MODEL_LIMIT,
  MANAGED_TOOL_OUTPUT_POLICY,
  WODEAPP_PREFERRED_MODEL,
  buildManagedWodeAppModels,
  clampManagedContextWindow,
  managedCompactionReserved,
  managedWodeAppProviderConfig,
  resolveManagedDefaultModel,
} from "./wodeapp-managed-models.mjs";

describe("managed OpenCode compaction policy", () => {
  it("defaults the WodeApp catalog preferred model to DeepSeek V4 Flash", () => {
    const models = buildManagedWodeAppModels({});
    assert.equal(WODEAPP_PREFERRED_MODEL, "wode/deepseek-v4-flash");
    assert.equal(resolveManagedDefaultModel(models, {}), "wode/deepseek-v4-flash");
    const unsigned = managedWodeAppProviderConfig({}, {});
    assert.equal(unsigned.model, undefined);
    assert.equal(unsigned.enabled_providers.includes("wodeapp"), false);
    assert.equal(unsigned.provider.wodeapp, undefined);
    const signedIn = managedWodeAppProviderConfig({ WODEAPP_API_KEY: "sk_live_test" }, {});
    assert.equal(signedIn.model, "wodeapp/wode/deepseek-v4-flash");
    assert.ok(signedIn.enabled_providers.includes("wodeapp"));
  });

  it("registers both branded and upstream kimi-code ids", () => {
    const models = buildManagedWodeAppModels({});
    assert.ok(models["wode/kimi-code-k3"]);
    assert.ok(models["kimicode/k3"]);
    assert.ok(models["wode/kimi-code-k3-256k"]);
    assert.ok(models["kimicode/k3-256k"]);
    assert.deepEqual(models["kimicode/k3"].modalities.input, ["text", "image", "video"]);
    assert.deepEqual(models["kimicode/k3-256k"].modalities.input, ["text", "image"]);
  });

  it("declares model context limits so OpenCode auto-compact can fire", () => {
    const models = buildManagedWodeAppModels();
    const kimi = models["wode/kimi-code-k3-256k"];
    const kimi1m = models["wode/kimi-code-k3"];
    const kimiChat = models["wode/kimi-k3"];
    const fallback = models["wode/minimax-m3"] || Object.values(models)[0];
    assert.ok(kimi, "expected Kimi Code K3 256K in the managed catalog");
    assert.ok(kimi1m, "expected Kimi Code K3 in the managed catalog");
    assert.ok(fallback, "expected at least one fallback managed model");
    // Catalog may say 262144 / 1M; OpenCode limits are capped at 256k for soft wall.
    assert.equal(kimi.limit.context, MANAGED_MODEL_LIMIT.context);
    assert.equal(kimi.limit.input, MANAGED_MODEL_LIMIT.input);
    assert.equal(kimi.limit.output, MANAGED_MODEL_LIMIT.output);
    assert.equal(kimi1m.limit.context, MANAGED_MODEL_LIMIT.context);
    assert.equal(kimi1m.limit.input, MANAGED_MODEL_LIMIT.input);
    assert.equal(kimiChat.limit.context, MANAGED_MODEL_LIMIT.context);
    assert.deepEqual(kimi.modalities.input, ["text", "image"]);
    assert.deepEqual(kimi1m.modalities.input, ["text", "image", "video"]);
    assert.equal(fallback.limit.context, MANAGED_MODEL_LIMIT.context);
    assert.equal(fallback.limit.input, MANAGED_MODEL_LIMIT.input);
    assert.equal(fallback.limit.output, MANAGED_MODEL_LIMIT.output);
  });

  it("clamps advertised 1M catalog windows to the 256k desktop soft-wall ceiling", () => {
    assert.equal(clampManagedContextWindow(1_048_576), MANAGED_MODEL_LIMIT.context);
    assert.equal(clampManagedContextWindow(262_144), MANAGED_MODEL_LIMIT.context);
    assert.equal(clampManagedContextWindow(128_000), 128_000);
    assert.equal(clampManagedContextWindow(0), MANAGED_MODEL_LIMIT.context);
    const models = buildManagedWodeAppModels({});
    assert.equal(models["kimicode/k3"].limit.context, MANAGED_MODEL_LIMIT.context);
    assert.equal(models["kimicode/k3-256k"].limit.context, MANAGED_MODEL_LIMIT.context);
  });

  it("scales reserved with context window (~50%, min 32k)", () => {
    assert.equal(managedCompactionReserved(128_000), 64_000);
    assert.equal(managedCompactionReserved(256_000), 128_000);
    assert.equal(managedCompactionReserved(32_000), 32_000);
    // 1M claims still reserve against the 256k ceiling, not ~896k soft wall.
    assert.equal(managedCompactionReserved(1_048_576), 128_000);
    assert.equal(managedCompactionReserved(), MANAGED_COMPACTION_POLICY.reserved);
    assert.equal(MANAGED_COMPACTION_POLICY.reserved, 128_000);
  });

  it("writes an earlier soft-wall compaction policy into managed opencode config", () => {
    const config = managedWodeAppProviderConfig({});
    assert.deepEqual(config.compaction, { ...MANAGED_COMPACTION_POLICY });
    assert.deepEqual(config.tool_output, { ...MANAGED_TOOL_OUTPUT_POLICY });
    assert.equal(config.compaction.auto, true);
    assert.equal(config.compaction.prune, true);
    assert.equal(config.compaction.tail_turns, 4);
    assert.equal(config.compaction.preserve_recent_tokens, 8_000);
    assert.equal(config.tool_output.max_bytes, 8_192);
    assert.equal(config.tool_output.max_lines, 80);
    // Soft wall ≈ input - reserved (OpenCode usable()) ≈ 50% of 256k.
    assert.equal(
      MANAGED_MODEL_LIMIT.input - MANAGED_COMPACTION_POLICY.reserved,
      128_000,
    );
  });

  it("wires local chat vendors from keys.json env as peers of WodeApp", () => {
    const unsigned = managedWodeAppProviderConfig({ ARK_API_KEY: "ark-test-key" });
    assert.equal(unsigned.model, "volcano/doubao-seed-2-1-pro-260628");
    assert.deepEqual(unsigned.enabled_providers, ["volcano"]);
    assert.equal(unsigned.provider.volcano.options.baseURL, "https://ark.cn-beijing.volces.com/api/v3");
    assert.equal(unsigned.provider.volcano.options.apiKey, "ark-test-key");
    assert.ok(unsigned.provider.volcano.models["doubao-seed-2-1-pro-260628"]);
    assert.equal(unsigned.provider.wodeapp, undefined);

    const deepseek = managedWodeAppProviderConfig({ DEEPSEEK_API_KEY: "sk-deepseek-test" });
    assert.equal(deepseek.model, "deepseek/deepseek-chat");
    assert.deepEqual(deepseek.enabled_providers, ["deepseek"]);
    assert.equal(deepseek.provider.deepseek.options.baseURL, "https://api.deepseek.com");

    const signedIn = managedWodeAppProviderConfig({
      ARK_API_KEY: "ark-test-key",
      WODEAPP_API_KEY: "sk_live_test",
    });
    assert.equal(signedIn.model, "volcano/doubao-seed-2-1-pro-260628");
    assert.deepEqual(signedIn.enabled_providers, ["volcano", "wodeapp"]);
    assert.ok(signedIn.provider.wodeapp);
  });
});