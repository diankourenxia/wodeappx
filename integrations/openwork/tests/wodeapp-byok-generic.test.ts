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
  detectOpenAiCompatibleProvider,
  resolveByokProviderIdForAuth,
} from "../src/react-app/domains/wodeapp/wodeapp-provider-detect";

const {
  isAuthorizedByokModelRef,
  normalizeWodeAppModelRefForWorkbench,
  resolveConnectedWodeAppPromptModel,
  resolvePreferredWorkbenchModel,
  shouldAutoSwitchToWodeAppModel,
  WODEAPP_DEFAULT_MODEL,
} = await import("../wodeapp/wodeapp-model-sync");

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
  } as Parameters<typeof resolveConnectedWodeAppPromptModel>[1];
}

describe("generic BYOK workbench normalize", () => {
  test("unauthorized openrouter falls back to platform default", () => {
    expect(
      normalizeWodeAppModelRefForWorkbench({
        providerID: "openrouter",
        modelID: "anthropic/claude-sonnet-4",
      }),
    ).toEqual(WODEAPP_DEFAULT_MODEL);
    expect(
      normalizeWodeAppModelRefForWorkbench(
        { providerID: "openrouter", modelID: "anthropic/claude-sonnet-4" },
        { connectedProviderIds: ["wodeapp"] },
      ),
    ).toEqual(WODEAPP_DEFAULT_MODEL);
  });

  test("authorized openrouter BYOK is kept", () => {
    const byok = {
      providerID: "openrouter",
      modelID: "anthropic/claude-sonnet-4",
    };
    expect(
      normalizeWodeAppModelRefForWorkbench(byok, {
        connectedProviderIds: ["wodeapp", "openrouter"],
      }),
    ).toEqual(byok);
    expect(isAuthorizedByokModelRef(byok, ["wodeapp", "openrouter"])).toBe(true);
  });

  test("empty current does not steal to WodeApp when a local vendor is connected", () => {
    expect(normalizeWodeAppModelRefForWorkbench(null, {
      connectedProviderIds: ["volcano"],
    })).toEqual({ providerID: "", modelID: "" });
    expect(normalizeWodeAppModelRefForWorkbench(null)).toEqual(WODEAPP_DEFAULT_MODEL);
    expect(normalizeWodeAppModelRefForWorkbench({ providerID: "", modelID: "" })).toEqual(
      WODEAPP_DEFAULT_MODEL,
    );
  });

  test("shouldAutoSwitch keeps connected BYOK and does not fill empty with WodeApp", () => {
    const byok = { providerID: "openrouter", modelID: "deepseek/deepseek-chat" };
    expect(shouldAutoSwitchToWodeAppModel(byok, {
      workbench: true,
      connectedProviderIds: ["openrouter"],
    })).toBe(false);
    expect(shouldAutoSwitchToWodeAppModel(null)).toBe(false);
    expect(shouldAutoSwitchToWodeAppModel(null, {
      connectedProviderIds: ["volcano"],
    })).toBe(false);
  });

  test("resolvePreferredWorkbenchModel preserves connected BYOK", () => {
    const list = providerList([
      { id: "wodeapp", models: ["wode/kimi-code-k3-256k"] },
      { id: "openrouter", models: ["anthropic/claude-sonnet-4"] },
    ]);
    expect(resolvePreferredWorkbenchModel(list, {
      providerID: "openrouter",
      modelID: "anthropic/claude-sonnet-4",
    })).toEqual({
      providerID: "openrouter",
      modelID: "anthropic/claude-sonnet-4",
    });
  });

  test("resolvePreferredWorkbenchModel remaps disconnected BYOK to platform", () => {
    const list = providerList([
      { id: "wodeapp", models: ["wode/kimi-code-k3-256k"] },
    ]);
    expect(resolvePreferredWorkbenchModel(list, {
      providerID: "openrouter",
      modelID: "anthropic/claude-sonnet-4",
    })).toEqual({
      providerID: "wodeapp",
      modelID: "wode/kimi-code-k3-256k",
    });
  });

  test("WodeApp is a peer vendor: empty current prefers local, remembered WodeApp stays", () => {
    const list = providerList([
      { id: "wodeapp", models: ["wode/deepseek-v4-flash"] },
      { id: "volcano", models: ["doubao-seed-2-1-pro-260628"] },
    ]);
    expect(resolvePreferredWorkbenchModel(list, null)).toEqual({
      providerID: "volcano",
      modelID: "doubao-seed-2-1-pro-260628",
    });
    expect(resolvePreferredWorkbenchModel(list, WODEAPP_DEFAULT_MODEL)).toEqual(WODEAPP_DEFAULT_MODEL);
  });

  test("resolveConnectedWodeAppPromptModel sends BYOK as-is when connected", () => {
    const list = providerList([
      { id: "wodeapp", models: ["wode/kimi-code-k3-256k", "kimicode/k3-256k"] },
      { id: "openrouter", models: ["moonshotai/kimi-k2.5"] },
    ]);
    expect(resolveConnectedWodeAppPromptModel({
      providerID: "openrouter",
      modelID: "moonshotai/kimi-k2.5",
    }, list)).toEqual({
      providerID: "openrouter",
      modelID: "moonshotai/kimi-k2.5",
    });
  });
});

describe("openai-compatible provider detect", () => {
  test("maps OpenRouter key prefix and host", () => {
    expect(detectOpenAiCompatibleProvider({ apiKey: "sk-or-v1-abc" })).toEqual({
      providerId: "openrouter",
      confidence: "high",
      reason: "api_key_prefix:sk-or-",
    });
    expect(detectOpenAiCompatibleProvider({
      baseURL: "https://openrouter.ai/api/v1",
    })?.providerId).toBe("openrouter");
  });

  test("remaps mismatched selection on high-confidence fingerprint", () => {
    const resolved = resolveByokProviderIdForAuth("openai", {
      apiKey: "sk-or-v1-abc",
    });
    expect(resolved).toEqual({
      providerId: "openrouter",
      remapped: true,
      detected: {
        providerId: "openrouter",
        confidence: "high",
        reason: "api_key_prefix:sk-or-",
      },
    });
  });

  test("keeps selection when fingerprint matches or is absent", () => {
    expect(resolveByokProviderIdForAuth("openrouter", {
      apiKey: "sk-or-v1-abc",
    }).remapped).toBe(false);
    expect(resolveByokProviderIdForAuth("deepseek", {
      apiKey: "sk-generic-key",
    })).toEqual({
      providerId: "deepseek",
      detected: null,
      remapped: false,
    });
  });
});
