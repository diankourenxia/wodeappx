import { describe, expect, test } from "bun:test";

import {
  isLocalByokModelProvider,
  isWodeAppModelProvider,
  uniqueWodeAppCatalogModelIds,
  groupModelsForPicker,
  isModelPickerVendorConfigured,
  modelPickerChannel,
  modelPickerVendorId,
  withLocalPickerVendorPlaceholders,
} from "../wodeapp/wodeapp-model-display";

describe("WodeApp model display boundaries", () => {
  test("recognizes both hosted provider ids so local BYOK can exclude them", () => {
    expect(isWodeAppModelProvider("wodeapp")).toBe(true);
    expect(isWodeAppModelProvider("wode")).toBe(true);
    expect(isWodeAppModelProvider("deepseek")).toBe(false);
    expect(["wodeapp", "wode", "deepseek", "openrouter"].filter(isLocalByokModelProvider)).toEqual([
      "deepseek",
      "openrouter",
    ]);
  });

  test("deduplicates branded, OpenCode and upstream aliases", () => {
    expect(uniqueWodeAppCatalogModelIds([
      "wode/doubao-pro",
      "wode-doubao-pro",
      "bytedance/doubao-seed-2-1-pro",
      "wode/deepseek-v4-pro",
      "deepseek/deepseek-v4-pro",
      "vendor/unknown-model",
      "vendor/unknown-model",
    ])).toEqual([
      "wode/doubao-pro",
      "wode/deepseek-v4-pro",
      "vendor/unknown-model",
    ]);
  });

  test("picker groups by vendor and lists local models first", () => {
    expect(modelPickerChannel("wodeapp")).toBe("cloud");
    expect(modelPickerChannel("deepseek")).toBe("local");
    expect(modelPickerVendorId("wodeapp", "wode/kimi-code-k3-256k")).toBe("kimi");
    expect(modelPickerVendorId("wodeapp", "wode/doubao-pro")).toBe("volcano");
    expect(modelPickerVendorId("deepseek", "deepseek-chat")).toBe("deepseek");
    expect(modelPickerVendorId("local-my-proxy", "custom-model")).toBe("custom");

    const grouped = groupModelsForPicker([
      { providerID: "wodeapp", modelID: "wode/kimi-code-k3-256k" },
      { providerID: "wodeapp", modelID: "wode/doubao-pro" },
      { providerID: "deepseek", modelID: "deepseek-chat" },
      { providerID: "moonshot", modelID: "kimi-k2" },
      { providerID: "local-my-proxy", modelID: "proxy-chat" },
    ]);
    expect(grouped.map((item) => item.vendorLabel)).toEqual(["Kimi", "火山", "DeepSeek", "自定义"]);
    expect(grouped[0]?.items.map((item) => item.providerID)).toEqual(["moonshot", "wodeapp"]);
  });

  test("vendor is configured when logged in, WodeApp key exists, or matching local Key exists", () => {
    const sources = [
      { id: "wodeapp", keyPreview: "sk-***abcd" },
      { id: "moonshot", keyPreview: "sk-***kimi" },
      { id: "deepseek", keyPreview: "" },
    ];
    expect(isModelPickerVendorConfigured("kimi", sources, false)).toBe(true);
    expect(isModelPickerVendorConfigured("kimi", [], true)).toBe(true);
    expect(isModelPickerVendorConfigured("kimi", [], false)).toBe(false);
    expect(isModelPickerVendorConfigured("deepseek", [{ id: "deepseek", keyPreview: "" }])).toBe(false);
    expect(isModelPickerVendorConfigured("volcano", [{ id: "moonshot", keyPreview: "sk-***" }])).toBe(false);
  });

  test("placeholder vendors stay visible so 去配置 is reachable", () => {
    const grouped = withLocalPickerVendorPlaceholders(groupModelsForPicker([
      { providerID: "wodeapp", modelID: "wode/kimi-code-k3-256k" },
    ]));
    expect(grouped.map((item) => item.vendorId)).toEqual([
      "kimi",
      "volcano",
      "deepseek",
      "dashscope",
      "minimax",
      "zai",
    ]);
    expect(grouped.filter((item) => item.vendorId !== "kimi").every((item) => item.items.length === 0)).toBe(true);
  });
});
