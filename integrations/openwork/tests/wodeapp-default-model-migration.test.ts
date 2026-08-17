import { describe, expect, test } from "bun:test";

import {
  resolveConnectedWodeAppPromptModel,
  shouldMigrateLegacyWodeAppDefault,
  WODEAPP_DEFAULT_MODEL,
} from "../src/react-app/domains/wodeapp/wodeapp-model-sync";
import { resolveSessionModelState } from "../src/react-app/domains/wodeapp/wodeapp-session-model-state";

function connectedWodeAppProvider(modelIDs: string[]) {
  return {
    connected: ["wodeapp"],
    default: {},
    all: [{
      id: "wodeapp",
      name: "WodeApp",
      source: "custom",
      env: [],
      models: Object.fromEntries(modelIDs.map((id) => [id, { id, name: id }])),
    }],
  } as Parameters<typeof resolveConnectedWodeAppPromptModel>[1];
}

describe("WodeApp default model migration", () => {
  test("migrates the previous MiniMax / DeepSeek / Kimi K3 defaults", () => {
    for (const modelID of [
      "wode/minimax-m3",
      "wode-minimax-m3",
      "minimax/MiniMax-M3",
      "minimax/minimax-m3",
      "wode/deepseek-v4-pro",
      "wode/deepseek-v4-flash",
      "deepseek/deepseek-v4-pro",
      "deepseek/deepseek-v4-flash",
      "wode/kimi-k3",
      "wode-kimi-k3",
      "moonshotai/kimi-k3",
    ]) {
      expect(shouldMigrateLegacyWodeAppDefault({ providerID: "wodeapp", modelID })).toBe(true);
    }
  });

  test("does not migrate direct providers or other valid WodeApp choices", () => {
    expect(shouldMigrateLegacyWodeAppDefault({
      providerID: "deepseek",
      modelID: "deepseek-chat",
    })).toBe(false);
    expect(shouldMigrateLegacyWodeAppDefault({
      providerID: "wodeapp",
      modelID: "wode/doubao-pro",
    })).toBe(false);
    expect(shouldMigrateLegacyWodeAppDefault(WODEAPP_DEFAULT_MODEL)).toBe(false);
    expect(WODEAPP_DEFAULT_MODEL).toEqual({
      providerID: "wodeapp",
      modelID: "wode/kimi-code-k3-256k",
    });
  });

  test("keeps an existing session override after the global default migrates", () => {
    const sessionDeepSeek = {
      providerID: "wodeapp",
      modelID: "wode/deepseek-v4-flash",
    };

    expect(resolveSessionModelState(WODEAPP_DEFAULT_MODEL, null, {
      model: sessionDeepSeek,
    }).model).toEqual(sessionDeepSeek);
    expect(resolveSessionModelState(WODEAPP_DEFAULT_MODEL, null, undefined).model)
      .toEqual(WODEAPP_DEFAULT_MODEL);
  });

  test("maps branded Kimi Code ids onto the model keys registered by the connected provider", () => {
    expect(resolveConnectedWodeAppPromptModel(
      WODEAPP_DEFAULT_MODEL,
      connectedWodeAppProvider(["kimicode/k3-256k", "kimicode/k3"]),
    )).toEqual({
      providerID: "wodeapp",
      modelID: "kimicode/k3-256k",
    });

    expect(resolveConnectedWodeAppPromptModel(
      { providerID: "wodeapp", modelID: "wode/kimi-code-k3" },
      connectedWodeAppProvider(["kimicode/k3"]),
    )).toEqual({
      providerID: "wodeapp",
      modelID: "kimicode/k3",
    });
  });

  test("keeps the branded id when the connected provider registers it directly", () => {
    expect(resolveConnectedWodeAppPromptModel(
      WODEAPP_DEFAULT_MODEL,
      connectedWodeAppProvider(["wode/kimi-code-k3-256k", "kimicode/k3-256k"]),
    )).toEqual(WODEAPP_DEFAULT_MODEL);
  });
});
