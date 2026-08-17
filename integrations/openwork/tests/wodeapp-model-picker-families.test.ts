import { describe, expect, test } from "bun:test";

import {
  buildPickerFamiliesFromSources,
  collapseRoutesToPickerFamilies,
  modelVariantKey,
  pickerFamilyMatchesRef,
  pickerTitleForModelRef,
  setRemotePickerCatalog,
  stripWodeModelTitle,
} from "../wodeapp/wodeapp-model-picker-families";
import { applyRemoteModelFamilies } from "../wodeapp/wodeapp-model-families-api";
import { buildModelRoutesFromSources } from "../wodeapp/wodeapp-model-route-match";

describe("picker families collapse vendor dumps", () => {
  test("strips Wode brand prefix and dated catalog suffixes", () => {
    expect(stripWodeModelTitle("Wode DeepSeek V4 Flash")).toBe("DeepSeek V4 Flash");
    expect(modelVariantKey("deepseek/deepseek-v4-flash-0731")).toBe("deepseek-v4-flash");
    expect(modelVariantKey("doubao-1-5-thinking-pro-250415")).toBe("doubao-1-5-thinking-pro");
    expect(modelVariantKey("doubao-1-5-thinking-pro-m-250415")).toBe("doubao-1-5-thinking-pro-m");
    expect(modelVariantKey("doubao-seed-2-1-pro-260628")).toBe("doubao-seed-2-1-pro");
  });

  test("Volcano dump collapses to catalog Seed 2.1, not every thinking-pro date", () => {
    const families = buildPickerFamiliesFromSources([{
      id: "volcano",
      modelIds: [
        "doubao-1-5-thinking-pro-250415",
        "doubao-1-5-thinking-pro-m-250415",
        "doubao-1-5-thinking-pro-m-250428",
        "doubao-1-5-thinking-vision-pro-250428",
        "doubao-1-5-ui-tars-250428",
        "doubao-seed-2-1-pro-260215",
        "doubao-seed-2-1-pro-260628",
        "doubao-seed-2-1-turbo-260215",
      ],
    }]);
    expect(families.map((item) => item.title)).toEqual([
      "豆包 Seed 2.1 Pro",
      "豆包 Seed 2.1 Turbo",
    ]);
    expect(families.map((item) => item.modelID)).toEqual([
      "doubao-seed-2-1-pro-260628",
      "doubao-seed-2-1-turbo-260215",
    ]);
    expect(families.some((item) => item.modelID.includes("thinking-pro"))).toBe(false);
    expect(families.some((item) => item.modelID.includes("260215") && item.modelID.includes("pro"))).toBe(false);
  });

  test("OpenRouter only surfaces current catalog families, mapped onto OpenRouter", () => {
    const families = buildPickerFamiliesFromSources([{
      id: "openrouter",
      modelIds: [
        "anthropic/claude-sonnet-4",
        "deepseek/deepseek-v4-flash",
        "deepseek/deepseek-v4-flash-0731",
        "moonshotai/kimi-k2.5",
        "qwen/qwen3.8-max",
        "minimax/minimax-m3",
      ],
    }]);
    expect(families.map((item) => item.title)).toEqual([
      "DeepSeek V4 Flash",
      "通义千问 3.8 Max",
      "MiniMax M3",
    ]);
    expect(families.find((item) => item.familyId === "deepseek")).toEqual(expect.objectContaining({
      providerID: "openrouter",
      modelID: "deepseek/deepseek-v4-flash-0731",
    }));
    expect(families.some((item) => item.modelID.includes("claude"))).toBe(false);
    expect(families.some((item) => item.modelID.includes("kimi-k2.5"))).toBe(false);
  });

  test("OpenRouter maps current Claude / GPT / Grok catalog families", () => {
    const families = buildPickerFamiliesFromSources([{
      id: "openrouter",
      modelIds: [
        "anthropic/claude-opus-5",
        "anthropic/claude-sonnet-5",
        "anthropic/claude-sonnet-4",
        "openai/gpt-5.6-luna-pro",
        "openai/gpt-5.6-luna",
        "openai/gpt-5.2",
        "x-ai/grok-4.6",
        "x-ai/grok-4.5",
        "x-ai/grok-4",
      ],
    }]);
    expect(families.map((item) => item.title)).toEqual([
      "Claude Opus 5",
      "Claude Sonnet 5",
      "GPT-5.6 Luna Pro",
      "GPT-5.6 Luna",
      "Grok 4.6",
      "Grok 4.5",
    ]);
    expect(families.every((item) => item.providerID === "openrouter")).toBe(true);
    expect(families.some((item) => item.modelID.includes("sonnet-4") && !item.modelID.includes("sonnet-5"))).toBe(false);
    expect(families.some((item) => item.modelID.endsWith("gpt-5.2"))).toBe(false);
    expect(families.some((item) => item.modelID.endsWith("grok-4"))).toBe(false);
  });

  test("local DeepSeek wins over WodeApp cloud for the same family", () => {
    const families = collapseRoutesToPickerFamilies(buildModelRoutesFromSources([
      { id: "wodeapp", modelIds: ["wode/deepseek-v4-flash"] },
      { id: "deepseek", modelIds: ["deepseek-v4-flash"] },
    ]));
    const flash = families.find((item) => item.familyId === "deepseek");
    expect(flash).toEqual(expect.objectContaining({
      title: "DeepSeek V4 Flash",
      providerID: "deepseek",
      modelID: "deepseek-v4-flash",
    }));
    expect(families.filter((item) => item.familyId === "deepseek")).toHaveLength(1);
  });

  test("composer treats wode/* and local ids as the same picker family", () => {
    const option = {
      familyId: "deepseek",
      variantKey: "deepseek-v4-flash",
      title: "DeepSeek V4 Flash",
      providerID: "deepseek",
      modelID: "deepseek-v4-flash",
    };
    expect(pickerFamilyMatchesRef(option, {
      providerID: "wodeapp",
      modelID: "wode/deepseek-v4-flash",
    })).toBe(true);
    expect(pickerTitleForModelRef({
      providerID: "wodeapp",
      modelID: "wode/deepseek-v4-flash",
    }, [option])).toBe("DeepSeek V4 Flash");
  });

  test("remote mainserver catalog replaces bundled families", () => {
    try {
      applyRemoteModelFamilies({
        families: [{
          id: "wode/claude-opus-5",
          title: "Claude Opus 5",
          aliases: ["wode/claude-opus-5", "wode-claude-opus-5", "anthropic/claude-opus-5"],
        }],
      });
      const families = buildPickerFamiliesFromSources([{
        id: "openrouter",
        modelIds: ["anthropic/claude-opus-5", "deepseek/deepseek-v4-flash"],
      }]);
      expect(families.map((item) => item.title)).toEqual(["Claude Opus 5"]);
    } finally {
      setRemotePickerCatalog(null);
    }
  });

  test("Volcano dump collapses image/video families without entering the chat picker", () => {
    const source = [{
      id: "volcano",
      modelIds: [
        "doubao-seed-2-1-pro-260628",
        "doubao-seedream-5-0-260128",
        "doubao-seedream-5-0-pro-260628",
        "doubao-seedance-2-0-mini-260615",
        "doubao-seedance-2-0-260128",
        "doubao-seedance-2-0-fast-260128",
      ],
    }];
    expect(buildPickerFamiliesFromSources(source).map((item) => item.title)).toEqual([
      "豆包 Seed 2.1 Pro",
    ]);
    expect(buildPickerFamiliesFromSources(source, "image").map((item) => item.title)).toEqual([
      "豆包 Seedream 5",
      "豆包 Seedream 5 Pro",
    ]);
    expect(buildPickerFamiliesFromSources(source, "video").map((item) => item.title)).toEqual([
      "豆包 Seedance 2 Mini",
      "豆包 Seedance 2",
    ]);
  });

  test("DashScope dump collapses qwen-image onto 3.0 / Pro, not chat", () => {
    const source = [{
      id: "dashscope",
      modelIds: [
        "qwen3.8-max",
        "qwen-image-max",
        "qwen-image-3.0",
        "qwen-image-3.0-pro",
      ],
    }];
    expect(buildPickerFamiliesFromSources(source).map((item) => item.title)).toEqual([
      "通义千问 3.8 Max",
    ]);
    expect(buildPickerFamiliesFromSources(source, "image").map((item) => item.title)).toEqual([
      "千问 Image 3.0 Pro",
      "千问 Image 3.0",
    ]);
    expect(buildPickerFamiliesFromSources(source, "image").map((item) => item.modelID)).toEqual([
      "qwen-image-3.0-pro",
      "qwen-image-3.0",
    ]);
  });
});
