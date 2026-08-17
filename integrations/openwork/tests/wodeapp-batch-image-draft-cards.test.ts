import { describe, expect, test } from "bun:test";
import {
  buildDefaultBatchImageVisualTask,
  withBatchImageDraftCards,
} from "../wodeapp/wodeapp-pv-batch-image-capability";

describe("batch image draft cards (Agent prepare)", () => {
  test("withBatchImageDraftCards writes imageCards and skipPlanner before studio open", () => {
    const task = withBatchImageDraftCards(
      buildDefaultBatchImageVisualTask({
        name: "苏泊尔养生壶",
        productImages: ["https://example.com/product.png"],
        refImages: [],
        productInfo: "全玻璃茶篮",
        selectedCreativeTypes: ["white-bg", "selling-point"],
        iterCount: 2,
        targetTotalImages: 4,
        activeMode: "full",
      }),
    );

    expect(task.skipPlanner).toBe(true);
    expect(task.imageCards).toHaveLength(4);
    expect(task.imageCards?.[0]?.status).toBe("draft");
    expect(task.imageCards?.[0]?.prompt).toContain("苏泊尔养生壶");
    expect(task.imageCards?.every((card) => card.prompt.trim().length > 0)).toBe(true);
  });

  test("keeps existing imageCards instead of rebuilding", () => {
    const existing = [{
      id: "pv_card_keep",
      title: "已有卡片",
      prompt: "keep me",
      creativeTypeId: "product-photo",
      aspectRatio: "1:1",
      status: "succeeded" as const,
      resultUrl: "https://example.com/done.png",
      createdAt: 1,
    }];
    const task = withBatchImageDraftCards({
      ...buildDefaultBatchImageVisualTask({
        name: "x",
        productImages: ["https://example.com/a.png"],
        refImages: [],
        productInfo: "y",
      }),
      imageCards: existing,
    });
    expect(task.imageCards).toEqual(existing);
    expect(task.skipPlanner).toBe(true);
  });
});
