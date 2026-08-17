import { describe, expect, mock, test } from "bun:test";

mock.module("@/app/types", () => ({}));

import {
  buildModelRoutesFromSources,
  matchGenerationRoute,
  matchModelRoute,
  modelDateStamp,
  modelFamilyId,
  modelStem,
} from "../wodeapp/wodeapp-model-route-match";
import { groupModelsForPicker, modelPickerVendorId } from "../wodeapp/wodeapp-model-display";

const volcanoModels = [
  "doubao-seed-2-1-pro-260628",
  "doubao-seedream-5-0-260128",
  "doubao-seedance-2-0-260128",
];

describe("model family matching layer", () => {
  test("groups OpenRouter catalog IDs by model family, not the OpenRouter silo", () => {
    expect(modelPickerVendorId("openrouter", "moonshotai/kimi-k2.5")).toBe("kimi");
    expect(modelPickerVendorId("openrouter", "deepseek/deepseek-v4-flash-0731")).toBe("deepseek");
    expect(modelPickerVendorId("openrouter", "anthropic/claude-sonnet-4")).toBe("anthropic");
    const grouped = groupModelsForPicker([
      { providerID: "openrouter", modelID: "moonshotai/kimi-k2.5" },
      { providerID: "moonshot", modelID: "kimi-k2.5" },
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.vendorId).toBe("kimi");
    expect(grouped[0]?.items.map((item) => item.providerID)).toEqual(["moonshot", "openrouter"]);
  });

  test("Volcano probe splits chat / image / video and does not invent Kimi", () => {
    const routes = buildModelRoutesFromSources([{
      id: "volcano",
      modelIds: volcanoModels,
    }]);
    expect(matchModelRoute(null, routes, "text")?.modelID).toBe("doubao-seed-2-1-pro-260628");
    expect(matchGenerationRoute([{ id: "volcano", modelIds: volcanoModels }], "image")?.modelID)
      .toBe("doubao-seedream-5-0-260128");
    expect(matchGenerationRoute([{ id: "volcano", modelIds: volcanoModels }], "video")?.modelID)
      .toBe("doubao-seedance-2-0-260128");
    expect(matchModelRoute({
      providerID: "wodeapp",
      modelID: "wode/kimi-k3",
    }, routes, "text")).toBeNull();
  });

  test("Kimi K3 does not remap onto Moonshot K2.5", () => {
    const routes = buildModelRoutesFromSources([
      { id: "wodeapp", modelIds: ["wode/kimi-k3", "moonshotai/kimi-k3"] },
      { id: "moonshot", modelIds: ["kimi-k2.5", "moonshot-v1-auto"] },
      { id: "openrouter", modelIds: ["moonshotai/kimi-k2.5"] },
    ]);
    expect(matchModelRoute({
      providerID: "wodeapp",
      modelID: "wode/kimi-k3",
    }, routes, "text")).toEqual(expect.objectContaining({
      providerID: "wodeapp",
      familyId: "kimi",
      modality: "text",
    }));
    expect(matchModelRoute({
      providerID: "wodeapp",
      modelID: "wode/kimi-k3",
    }, routes, "text")?.modelID).toMatch(/kimi-k3/);
    expect(matchModelRoute({
      providerID: "wodeapp",
      modelID: "wode/kimi-k3",
    }, routes, "text")?.modelID).not.toContain("k2.5");
    expect(matchModelRoute({
      providerID: "moonshot",
      modelID: "kimi-k3",
    }, routes, "text")).toEqual(expect.objectContaining({
      providerID: "wodeapp",
      familyId: "kimi",
      modality: "text",
    }));
    expect(matchModelRoute({
      providerID: "moonshot",
      modelID: "kimi-k3",
    }, routes, "text")?.modelID).not.toContain("k2.5");
  });

  test("Kimi K3 prefers Moonshot when that id is actually probed", () => {
    const routes = buildModelRoutesFromSources([
      { id: "wodeapp", modelIds: ["wode/kimi-k3"] },
      { id: "moonshot", modelIds: ["kimi-k2.5", "kimi-k3"] },
    ]);
    expect(matchModelRoute({
      providerID: "wodeapp",
      modelID: "wode/kimi-k3",
    }, routes, "text")).toEqual({
      providerID: "moonshot",
      modelID: "kimi-k3",
      familyId: "kimi",
      modality: "text",
    });
  });

  test("Kimi prefers Moonshot direct over OpenRouter and WodeApp", () => {
    const routes = buildModelRoutesFromSources([
      { id: "wodeapp", modelIds: ["wode/kimi-k2.5"] },
      { id: "openrouter", modelIds: ["moonshotai/kimi-k2.5"] },
      { id: "moonshot", modelIds: ["kimi-k2.5"] },
    ]);
    const matched = matchModelRoute({
      providerID: "openrouter",
      modelID: "moonshotai/kimi-k2.5",
    }, routes, "text");
    expect(matched).toEqual({
      providerID: "moonshot",
      modelID: "kimi-k2.5",
      familyId: "kimi",
      modality: "text",
    });
    expect(modelStem("moonshotai/kimi-k2.5")).toBe("kimi-k2.5");
    expect(modelFamilyId("openrouter", "moonshotai/kimi-k2.5")).toBe("kimi");
  });

  test("same family prefers the newest dated snapshot", () => {
    expect(modelDateStamp("doubao-seed-2-1-pro-260215")).toBe(20260215);
    expect(modelDateStamp("doubao-seed-2-1-pro-260628")).toBe(20260628);
    expect(modelDateStamp("deepseek/deepseek-v4-flash-0731")).toBe(20260731);
    const matched = matchModelRoute({
      providerID: "wodeapp",
      modelID: "wode/deepseek-v4-flash",
    }, buildModelRoutesFromSources([{
      id: "openrouter",
      modelIds: [
        "deepseek/deepseek-v4-flash",
        "deepseek/deepseek-v4-flash-0731",
      ],
    }]), "text");
    expect(matched?.modelID).toBe("deepseek/deepseek-v4-flash-0731");
  });

  test("Replicate assumed key yields an image route, not chat", () => {
    const routes = buildModelRoutesFromSources([{
      id: "replicate",
      modelIds: [],
      estimated: true,
      modalities: { text: false, image: true, video: false },
    }]);
    expect(matchModelRoute(null, routes, "text")).toBeNull();
    expect(matchGenerationRoute([{
      id: "replicate",
      estimated: true,
      modalities: { text: false, image: true, video: false },
    }], "image")).toEqual({
      providerID: "replicate",
      modelID: "google/nano-banana",
      familyId: "replicate",
      modality: "image",
    });
  });
});
