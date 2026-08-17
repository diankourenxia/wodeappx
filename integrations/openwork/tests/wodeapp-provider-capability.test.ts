import { describe, expect, test } from "bun:test";

import {
  buildAgentProviderCapabilityPack,
  buildProviderCapabilitySnapshot,
  classifyGenerationModel,
  emptyProviderCapabilitySnapshot,
  formatCapabilityGuidance,
  formatCapabilityProbedAt,
  formatCapabilitySourceLabel,
  generationToolsHiddenBySnapshot,
  isCapabilitySourceConfigured,
  capabilityConfigActionLabel,
  hasConfiguredLocalProviderKeys,
  unsignedLocalModeHint,
  isProviderCapabilitySnapshotStale,
  IMAGE_GENERATION_TOOL_IDS,
  VIDEO_GENERATION_TOOL_IDS,
  mergeCapabilityTableRows,
  sampleModelsForModality,
  shortCapabilityModelLabel,
  sortCapabilityTableRows,
  sortSourcesBySupport,
} from "../wodeapp/wodeapp-provider-capability";

describe("classifyGenerationModel", () => {
  test("DeepSeek chat stays text-only", () => {
    expect(classifyGenerationModel("deepseek-chat")).toEqual({
      text: true,
      image: false,
      video: false,
    });
  });

  test("ARK Seedream / Seedance split image and video", () => {
    expect(classifyGenerationModel("doubao-seedream-5-0-250428")).toEqual({
      text: false,
      image: true,
      video: false,
    });
    expect(classifyGenerationModel("doubao-seedance-2-0-mini-260615")).toEqual({
      text: false,
      image: false,
      video: true,
    });
    expect(classifyGenerationModel("happyhorse-1.0-r2v")).toEqual({
      text: false,
      image: false,
      video: true,
    });
    expect(classifyGenerationModel("wan2.5-t2v-preview")).toEqual({
      text: false,
      image: false,
      video: true,
    });
  });

  test("uses OpenRouter output modalities instead of the name", () => {
    expect(classifyGenerationModel({
      id: "some-vendor/custom-gen",
      outputModalities: ["image"],
    })).toEqual({
      text: false,
      image: true,
      video: false,
    });
  });
});

describe("buildProviderCapabilitySnapshot", () => {
  test("DeepSeek-only key cannot generate image or video", () => {
    const snapshot = buildProviderCapabilitySnapshot([{
      id: "deepseek",
      label: "DeepSeek",
      keyPreview: "sk-deepseek-demo",
      probeStatus: "ok",
      models: [{ id: "deepseek-chat" }, { id: "deepseek-reasoner" }],
    }]);
    expect(snapshot.union).toEqual({ text: true, image: false, video: false });
    expect(snapshot.sources[0]?.estimated).toBe(false);
    expect(snapshot.missing).toEqual(["image", "video"]);
    expect(snapshot.guidance).toContain("火山");
    expect(generationToolsHiddenBySnapshot(snapshot)).toEqual([
      ...IMAGE_GENERATION_TOOL_IDS,
      ...VIDEO_GENERATION_TOOL_IDS,
    ]);
    expect(buildAgentProviderCapabilityPack(snapshot)).toContain("不要调用 ai_generate_image");
  });

  test("probed Volcano key only enables models that Key actually returned", () => {
    const snapshot = buildProviderCapabilitySnapshot([{
      id: "volcano",
      label: "火山方舟 ARK",
      probeStatus: "ok",
      models: [
        { id: "doubao-seed-1-6-250615" },
        { id: "doubao-seedream-5-0-250428" },
        { id: "doubao-seedance-2-0-mini-260615" },
      ],
    }]);
    expect(snapshot.union).toEqual({ text: true, image: true, video: true });
    expect(snapshot.missing).toEqual([]);
    expect(snapshot.sources[0]?.estimated).toBe(false);
    expect(generationToolsHiddenBySnapshot(snapshot)).toEqual([]);
    const source = snapshot.sources[0]!;
    expect(sampleModelsForModality(source, "text")).toEqual(["doubao-seed-1-6-250615"]);
    expect(sampleModelsForModality(source, "image")).toEqual(["doubao-seedream-5-0-250428"]);
    expect(sampleModelsForModality(source, "video")).toEqual(["doubao-seedance-2-0-mini-260615"]);
    expect(shortCapabilityModelLabel("bytedance-seed/seed-2-1-turbo")).toBe("seed-2-1-turbo");
  });

  test("capability chips prefer current Volcano Seed / Seedream / Seedance IDs", () => {
    const source = {
      modelIds: [
        "doubao-lite-128k-240428",
        "doubao-pro-128k-240515",
        "doubao-seedream-3-0-t2i-250415",
        "doubao-seedream-4-0-250828",
        "doubao-seedance-1-0-lite-i2v-250428",
        "doubao-seedance-1-0-lite-t2v-250428",
        "doubao-seedream-4-0-20260415",
        "doubao-seedance-2-0-260128",
        "doubao-seedream-5-0-260128",
        "doubao-seedance-2-0-mini-260615",
        "deepseek-v3-250324",
        "deepseek-v4-flash-ga-260731",
        "doubao-seed-2-1-pro-260628",
        "doubao-seed-2-1-turbo-260628",
        "doubao-seedream-5-0-pro-260628",
        "doubao-seedance-2-5-260628",
      ],
    };
    expect(sampleModelsForModality(source, "text")).toEqual([
      "doubao-seed-2-1-pro-260628",
      "doubao-seed-2-1-turbo-260628",
    ]);
    expect(sampleModelsForModality(source, "image")).toEqual([
      "doubao-seedream-5-0-pro-260628",
      "doubao-seedream-5-0-260128",
    ]);
    expect(sampleModelsForModality(source, "video")).toEqual([
      "doubao-seedance-2-5-260628",
      "doubao-seedance-2-0-mini-260615",
    ]);
  });

  test("sorts keys by how many capabilities they cover", () => {
    const snapshot = buildProviderCapabilitySnapshot([
      {
        id: "deepseek",
        label: "DeepSeek",
        probeStatus: "ok",
        models: [{ id: "deepseek-chat" }],
      },
      {
        id: "volcano",
        label: "火山方舟 ARK",
        probeStatus: "ok",
        models: [
          { id: "doubao-seed-1-6" },
          { id: "doubao-seedream-5-0" },
          { id: "doubao-seedance-2-0" },
        ],
      },
      {
        id: "gemini",
        label: "Google Gemini",
        probeStatus: "ok",
        models: [{ id: "gemini-2.5-flash" }, { id: "imagen-4" }],
      },
    ]);
    expect(snapshot.sources.map((item) => item.id)).toEqual(["volcano", "gemini", "deepseek"]);
    expect(sortSourcesBySupport(snapshot.sources).map((item) => item.id)).toEqual([
      "volcano",
      "gemini",
      "deepseek",
    ]);
  });

  test("table labels ByteDance and Aliyun, pins DeepSeek and Kimi, and puts 通义百炼 in the list", () => {
    expect(formatCapabilitySourceLabel("volcano", "火山方舟 ARK")).toBe("火山方舟（字节）");
    expect(formatCapabilitySourceLabel("dashscope", "通义百炼")).toBe("通义百炼（阿里）");
    const snapshot = buildProviderCapabilitySnapshot([
      {
        id: "volcano",
        label: "火山方舟 ARK",
        probeStatus: "ok",
        models: [
          { id: "doubao-seed-1-6" },
          { id: "doubao-seedream-5-0" },
          { id: "doubao-seedance-2-0" },
        ],
      },
      {
        id: "deepseek",
        label: "DeepSeek",
        probeStatus: "ok",
        models: [{ id: "deepseek-chat" }],
      },
      {
        id: "moonshot",
        label: "Kimi / Moonshot",
        probeStatus: "ok",
        models: [{ id: "kimi-k2.5" }],
      },
    ]);
    const rows = mergeCapabilityTableRows(snapshot.sources);
    expect(rows.map((item) => item.id)).toEqual([
      "deepseek",
      "moonshot",
      "volcano",
      "dashscope",
      "kling",
      "replicate",
    ]);
    expect(rows.map((item) => item.label)).toEqual([
      "DeepSeek",
      "Kimi / Moonshot",
      "火山方舟（字节）",
      "通义百炼（阿里）",
      "可灵",
      "Replicate",
    ]);
    expect(rows.find((item) => item.id === "dashscope")?.keyPreview).toBe("");
    expect(rows.find((item) => item.id === "dashscope")?.modalities).toEqual({
      text: true,
      image: true,
      video: true,
    });
    expect(rows.find((item) => item.id === "kling")?.modalities).toEqual({
      text: false,
      image: false,
      video: true,
    });
    expect(sortCapabilityTableRows(snapshot.sources).map((item) => item.id)).toEqual([
      "deepseek",
      "moonshot",
      "volcano",
    ]);
  });

  test("unconfigured catalog rows still show known vendor capabilities", () => {
    const rows = mergeCapabilityTableRows([]);
    expect(rows.find((item) => item.id === "deepseek")?.modalities).toEqual({
      text: true,
      image: false,
      video: false,
    });
    expect(rows.find((item) => item.id === "moonshot")?.modalities).toEqual({
      text: true,
      image: false,
      video: false,
    });
    expect(rows.find((item) => item.id === "volcano")?.modalities).toEqual({
      text: true,
      image: true,
      video: true,
    });
    expect(rows.find((item) => item.id === "kling")?.modalities).toEqual({
      text: false,
      image: false,
      video: true,
    });
    expect(isCapabilitySourceConfigured(rows.find((item) => item.id === "deepseek")!)).toBe(false);
    expect(capabilityConfigActionLabel(rows.find((item) => item.id === "deepseek")!)).toBe("去配置");
  });

  test("logged-in WodeApp cloud marks 通义百炼 as 已配置, not 去配置", () => {
    const snapshot = buildProviderCapabilitySnapshot([
      {
        id: "wodeapp",
        label: "WodeApp 云端",
        keyPreview: "sk_l***4db5",
        probeStatus: "ok",
        models: [
          { id: "wode/kimi-code-k3-256k" },
          { id: "qwen-image-3.0-pro", outputModalities: ["image"] },
        ],
      },
      {
        id: "deepseek",
        label: "DeepSeek",
        probeStatus: "ok",
        models: [{ id: "deepseek-chat" }],
      },
    ]);
    const rows = mergeCapabilityTableRows(snapshot.sources);
    const dashscope = rows.find((item) => item.id === "dashscope");
    expect(dashscope?.keyPreview).toBe("");
    expect(dashscope?.probeStatus).toBe("configured");
    expect(isCapabilitySourceConfigured(dashscope!)).toBe(true);
    expect(capabilityConfigActionLabel(dashscope!)).toBe("已配置");
    expect(dashscope?.modalities).toEqual({ text: true, image: true, video: true });
    expect(sampleModelsForModality(dashscope!, "text")).toEqual(["qwen3.8-max"]);
    expect(sampleModelsForModality(dashscope!, "image")).toEqual([
      "qwen-image-3.0-pro",
      "qwen-image-3.0",
    ]);
    expect(sampleModelsForModality(dashscope!, "video")).toEqual(["happyhorse-1.0-r2v"]);
  });

  test("a key preview means 已配置, empty means 去配置", () => {
    expect(isCapabilitySourceConfigured({ keyPreview: "sk-***abcd" })).toBe(true);
    expect(isCapabilitySourceConfigured({ keyPreview: "" })).toBe(false);
    expect(capabilityConfigActionLabel({ keyPreview: "sk-***abcd" })).toBe("已配置");
    expect(capabilityConfigActionLabel({ keyPreview: "" })).toBe("去配置");
    expect(capabilityConfigActionLabel({ keyPreview: "", probeStatus: "configured" })).toBe("已配置");
  });

  test("unsigned local hint shows 已配置 when local keys exist", () => {
    expect(unsignedLocalModeHint([])).toBe("本机 Key · 可不登录");
    expect(unsignedLocalModeHint([
      { id: "wodeapp", keyPreview: "sk_l***4db5" },
    ])).toBe("本机 Key · 可不登录");
    expect(unsignedLocalModeHint([
      { id: "wodeapp", keyPreview: "sk_l***4db5" },
      { id: "deepseek", keyPreview: "sk-***01eb" },
    ])).toBe("本机 Key · 已配置");
    expect(hasConfiguredLocalProviderKeys([
      { id: "deepseek", keyPreview: "sk-***01eb" },
    ])).toBe(true);
  });

  test("failed Volcano probe falls back to estimated full coverage", () => {
    const snapshot = buildProviderCapabilitySnapshot([{
      id: "volcano",
      label: "火山方舟 ARK",
      probeStatus: "error",
      error: "network",
      models: [],
    }]);
    expect(snapshot.union).toEqual({ text: true, image: true, video: true });
    expect(snapshot.sources[0]?.estimated).toBe(true);
  });

  test("unauthorized Volcano key does not claim image or video", () => {
    const snapshot = buildProviderCapabilitySnapshot([{
      id: "volcano",
      label: "火山方舟 ARK",
      probeStatus: "unauthorized",
      error: "HTTP 401",
      models: [],
    }]);
    expect(snapshot.union).toEqual({ text: false, image: false, video: false });
    expect(snapshot.sources[0]?.estimated).toBe(false);
  });

  test("keeps project-env origin from scanned keys", () => {
    const snapshot = buildProviderCapabilitySnapshot([{
      id: "volcano",
      label: "火山方舟 ARK",
      keyPreview: "ark-****key",
      keyOrigin: "project-env",
      probeStatus: "ok",
      models: [{ id: "doubao-seedream-5-0" }],
    }]);
    expect(snapshot.sources[0]?.keyOrigin).toBe("project-env");
  });

  test("empty snapshot asks to configure local keys first", () => {
    const snapshot = emptyProviderCapabilitySnapshot();
    expect(snapshot.ready).toBe(false);
    expect(formatCapabilityGuidance({
      sources: snapshot.sources,
      union: snapshot.union,
      fillHints: snapshot.fillHints,
    })).toContain("本机还没配置");
    expect(generationToolsHiddenBySnapshot(snapshot)).toEqual([]);
  });

  test("marks old snapshots stale so the live model list can refresh", () => {
    const now = 1_700_000_000_000;
    expect(isProviderCapabilitySnapshotStale(null, now)).toBe(true);
    expect(isProviderCapabilitySnapshotStale({
      ...emptyProviderCapabilitySnapshot(),
      ready: true,
      probedAt: now - 30_000,
    }, now)).toBe(false);
    expect(isProviderCapabilitySnapshotStale({
      ...emptyProviderCapabilitySnapshot(),
      ready: true,
      probedAt: now - 3 * 60_000,
    }, now)).toBe(true);
    expect(formatCapabilityProbedAt(now - 8_000, now)).toBe("刚刚更新");
    expect(formatCapabilityProbedAt(now - 4 * 60_000, now)).toBe("4 分钟前更新");
  });
});
