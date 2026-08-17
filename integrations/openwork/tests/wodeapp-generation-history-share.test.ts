import { describe, expect, test } from "bun:test";

import type { DigitalAssetItem } from "../wodeapp/digital-assets-data";
import {
  buildGenerationHistoryInlineShareUrl,
  buildGenerationHistoryPvSession,
  buildGenerationHistoryShareDocId,
  buildGenerationHistoryVideoRun,
  canShareGenerationHistory,
  collectGenerationHistoryMediaUrls,
  resolveGenerationHistoryShareKind,
} from "../wodeapp/wodeapp-generation-history-share";

function historyItem(partial: Partial<DigitalAssetItem> & Pick<DigitalAssetItem, "id" | "name" | "kind">): DigitalAssetItem {
  return {
    meta: "生成历史",
    preview: partial.kind === "视频" ? "video" : "image",
    assetUse: "生成历史",
    ...partial,
  };
}

describe("wodeapp generation history share", () => {
  test("collects https media urls and ignores local paths", () => {
    const item = historyItem({
      id: "local-generation-1",
      name: "测试图",
      kind: "图片",
      coverImage: "https://cdn.example.com/a.png",
      assetImages: ["https://cdn.example.com/a.png", "file:///tmp/b.png", "https://cdn.example.com/c.png"],
    });
    expect(collectGenerationHistoryMediaUrls(item)).toEqual([
      "https://cdn.example.com/a.png",
      "https://cdn.example.com/c.png",
    ]);
    expect(canShareGenerationHistory(item)).toBe(true);
    expect(resolveGenerationHistoryShareKind(item)).toBe("image");
  });

  test("builds stable shareDoc ids", () => {
    expect(buildGenerationHistoryShareDocId({ id: "local-generation-99" }, "video"))
      .toBe("pvs_wappxgen_local_generation_99");
    expect(buildGenerationHistoryShareDocId({ id: "local-generation-99" }, "image"))
      .toBe("wodeapp-img-wappxgen-local_generation_99");
  });

  test("builds video run and image session payloads with result urls", () => {
    const video = historyItem({
      id: "local-generation-vid",
      name: "成片",
      kind: "视频",
      assetFile: "https://cdn.example.com/out.mp4",
      promptText: "一只猫在草地上跑",
      generationModel: "seedance",
    });
    const run = buildGenerationHistoryVideoRun(video);
    expect(run?.status).toBe("done");
    expect((run?.scenes as Array<{ videoUrl: string }>)[0]?.videoUrl).toBe("https://cdn.example.com/out.mp4");

    const image = historyItem({
      id: "local-generation-img",
      name: "海报",
      kind: "图片",
      assetImages: ["https://cdn.example.com/1.png", "https://cdn.example.com/2.png"],
      promptText: "夏日海报",
    });
    const session = buildGenerationHistoryPvSession(image);
    expect((session?.candidates as unknown[]).length).toBe(2);
  });

  test("builds inline share urls under length budget", () => {
    const item = historyItem({
      id: "local-generation-inline",
      name: "短视频",
      kind: "视频",
      assetFile: "https://cdn.example.com/short.mp4",
      promptText: "短提示",
    });
    const url = buildGenerationHistoryInlineShareUrl(item, "video", "https://ai.wodeapp.cn/video");
    expect(url).toBeTruthy();
    expect(url!).toContain("https://ai.wodeapp.cn/video");
    expect(url!).toContain("pvsShare=");
  });

  test("allows share when only generationShareUrl exists", () => {
    const item = historyItem({
      id: "local-generation-link",
      name: "旧项目",
      kind: "视频",
      generationShareUrl: "https://demo.wodeapp.cn/video?shareDoc=pvs_demo",
    });
    expect(canShareGenerationHistory(item)).toBe(true);
  });
});
