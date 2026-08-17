import { describe, expect, mock, test } from "bun:test";

mock.module("@/app/constants", () => ({
  DEFAULT_MODEL: { providerID: "opencode", modelID: "big-pickle" },
}));
mock.module("@/app/lib/wodeapp-auth", () => ({
  applyWodeAppProvider: async () => ({ ok: true }),
  loadCachedWodeAppAuthState: async () => ({ ok: false, signedIn: false }),
  getWodeAppServiceConfig: async () => ({ ok: true, config: { profile: "local-only" } }),
}));
mock.module("@/react-app/kernel/local-provider", () => ({}));
mock.module("@/react-app/kernel/model-config", () => ({
  writeStoredDefaultModel: () => {},
}));
mock.module("@/react-app/infra/provider-list-query", () => ({
  getConnectedProviderItems: (list: { all?: Array<{ id: string }> } | null | undefined) => list?.all ?? [],
}));
mock.module("@/app/types", () => ({}));
mock.module("@/app/utils", () => ({
  modelEquals: (a: { providerID?: string; modelID?: string } | null | undefined, b: { providerID?: string; modelID?: string } | null | undefined) => (
    Boolean(a && b && a.providerID === b.providerID && a.modelID === b.modelID)
  ),
  parseModelRef: (raw: string | null | undefined) => {
    const value = String(raw ?? "").trim();
    const slash = value.indexOf("/");
    if (slash <= 0) return null;
    return { providerID: value.slice(0, slash), modelID: value.slice(slash + 1) };
  },
}));
mock.module("@opencode-ai/sdk/v2/client", () => ({}));

import {
  isModelPickerVendorConfigured,
  modelPickerVendorId,
} from "../wodeapp/wodeapp-model-display";
import {
  buildProviderCapabilitySnapshot,
  capabilityConfigActionLabel,
  mergeCapabilityTableRows,
} from "../wodeapp/wodeapp-provider-capability";
import {
  isLocalByokSendLane,
} from "../wodeapp/wodeapp-send-readiness";
import { buildPickerFamiliesFromSources } from "../wodeapp/wodeapp-model-picker-families";

const {
  normalizeWodeAppModelRefForWorkbench,
  resolvePreferredWorkbenchModel,
  WODEAPP_DEFAULT_MODEL,
} = await import("../wodeapp/wodeapp-model-sync");

/**
 * Isolation: cloud WodeApp + other vendor keys off; only OpenRouter connected.
 * These assertions lock current workbench behavior so ID / grouping / default
 * mismatches stay visible instead of being assumed away.
 */

const OPENROUTER_ONLY_MODELS = [
  "anthropic/claude-sonnet-4",
  "openai/gpt-5.2",
  "google/gemini-3.5-flash",
  "deepseek/deepseek-v4-flash",
  "deepseek/deepseek-v4-flash-0731",
  "moonshotai/kimi-k2.5",
  "qwen/qwen3.8-max",
  "minimax/minimax-m3",
];

function providerList(connected: Array<{ id: string; models: string[] }>) {
  return {
    connected: connected.map((item) => item.id),
    default: {},
    all: connected.map((item) => ({
      id: item.id,
      name: item.id,
      source: "custom",
      env: [],
      models: Object.fromEntries(item.models.map((id) => [id, { id, name: id }])),
    })),
  } as Parameters<typeof resolvePreferredWorkbenchModel>[0];
}

const openrouterOnlyList = providerList([
  { id: "openrouter", models: OPENROUTER_ONLY_MODELS },
]);

describe("OpenRouter-only isolation (no cloud, no other vendor keys)", () => {
  test("unsigned default uses OpenRouter chat model, not missing WodeApp cloud", () => {
    expect(normalizeWodeAppModelRefForWorkbench(null, {
      connectedProviderIds: ["openrouter"],
    })).toEqual({ providerID: "", modelID: "" });
    expect(WODEAPP_DEFAULT_MODEL).toEqual({
      providerID: "wodeapp",
      modelID: "wode/deepseek-v4-flash",
    });

    expect(resolvePreferredWorkbenchModel(openrouterOnlyList, null)).toEqual({
      providerID: "openrouter",
      modelID: "deepseek/deepseek-v4-flash-0731",
    });
    expect(resolvePreferredWorkbenchModel(openrouterOnlyList, WODEAPP_DEFAULT_MODEL)).toEqual({
      providerID: "openrouter",
      modelID: "deepseek/deepseek-v4-flash-0731",
    });
    expect(
      resolvePreferredWorkbenchModel(openrouterOnlyList, {
        providerID: "openrouter",
        modelID: "wode/deepseek-v4-flash",
      }),
    ).toEqual({
      providerID: "openrouter",
      modelID: "deepseek/deepseek-v4-flash-0731",
    });
  });

  test("WodeApp DeepSeek Flash id is not an OpenRouter model id", () => {
    const ids = new Set(OPENROUTER_ONLY_MODELS);
    expect(ids.has("wode/deepseek-v4-flash")).toBe(false);
    expect(ids.has("deepseek/deepseek-v4-flash")).toBe(true);
    expect(ids.has("deepseek/deepseek-v4-flash-0731")).toBe(true);
  });

  test("picker groups OpenRouter catalog IDs by model family", () => {
    expect(modelPickerVendorId("openrouter", "anthropic/claude-sonnet-4")).toBe("anthropic");
    expect(modelPickerVendorId("openrouter", "deepseek/deepseek-v4-flash-0731")).toBe("deepseek");
    expect(modelPickerVendorId("openrouter", "moonshotai/kimi-k2.5")).toBe("kimi");

    const families = buildPickerFamiliesFromSources([{
      id: "openrouter",
      modelIds: OPENROUTER_ONLY_MODELS,
    }]);
    expect(families.map((item) => item.title)).toEqual([
      "DeepSeek V4 Flash",
      "通义千问 3.8 Max",
      "MiniMax M3",
    ]);
    expect(families.find((item) => item.familyId === "deepseek")?.modelID)
      .toBe("deepseek/deepseek-v4-flash-0731");
    expect(families.some((item) => item.modelID.includes("claude"))).toBe(false);
    expect(families.some((item) => item.modelID.includes("kimi-k2.5"))).toBe(false);
    expect(families.some((item) => item.modelID.includes("gpt-"))).toBe(false);
  });

  test("OpenRouter key does not mark DeepSeek / Kimi / 火山 / 百炼 as configured", () => {
    const sources = [{
      id: "openrouter",
      keyPreview: "sk-o***uter",
      probeStatus: "ok",
    }];
    expect(isModelPickerVendorConfigured("openrouter", sources, false)).toBe(true);
    expect(isModelPickerVendorConfigured("deepseek", sources, false)).toBe(false);
    expect(isModelPickerVendorConfigured("kimi", sources, false)).toBe(false);
    expect(isModelPickerVendorConfigured("volcano", sources, false)).toBe(false);
    expect(isModelPickerVendorConfigured("dashscope", sources, false)).toBe(false);
  });

  test("capability table keeps other vendors as 去配置; OpenRouter is text-only", () => {
    const snapshot = buildProviderCapabilitySnapshot([{
      id: "openrouter",
      label: "OpenRouter",
      keyPreview: "sk-or-v1-demo-key",
      probeStatus: "ok",
      models: OPENROUTER_ONLY_MODELS.map((id) => ({ id })),
    }]);
    expect(snapshot.union).toEqual({ text: true, image: false, video: false });
    expect(snapshot.missing).toEqual(["image", "video"]);

    const rows = mergeCapabilityTableRows(snapshot.sources);
    expect(capabilityConfigActionLabel(rows.find((item) => item.id === "openrouter")!)).toBe("已配置");
    expect(capabilityConfigActionLabel(rows.find((item) => item.id === "deepseek")!)).toBe("去配置");
    expect(capabilityConfigActionLabel(rows.find((item) => item.id === "moonshot")!)).toBe("去配置");
    expect(capabilityConfigActionLabel(rows.find((item) => item.id === "volcano")!)).toBe("去配置");
    expect(capabilityConfigActionLabel(rows.find((item) => item.id === "dashscope")!)).toBe("去配置");
  });

  test("preferred OpenRouter model sends on the local-key lane", () => {
    const preferred = resolvePreferredWorkbenchModel(openrouterOnlyList, null);
    expect(isLocalByokSendLane(WODEAPP_DEFAULT_MODEL, ["openrouter"])).toBe(false);
    expect(isLocalByokSendLane(preferred, ["openrouter"])).toBe(true);
  });
});
