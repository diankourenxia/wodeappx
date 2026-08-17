import { describe, expect, test } from "bun:test";

import {
  buildProductGenerationAgentMessage,
  buildProductGenerationDisplayText,
  buildProductSaveFollowUpChoicesMarkdown,
} from "../wodeapp/wodeapp-product-follow-up";

describe("product generation follow-up", () => {
  test("display text leaves room for the user to finish the request", () => {
    expect(buildProductGenerationDisplayText("阿尔法蛋 S1", "image")).toBe(
      "用商品「阿尔法蛋 S1」生成商品图：",
    );
    expect(buildProductGenerationDisplayText("阿尔法蛋 S1", "video")).toBe(
      "用商品「阿尔法蛋 S1」生成5条视频脚本：",
    );
  });

  test("agent message asks to wait for user requirements before charging", () => {
    const image = buildProductGenerationAgentMessage("阿尔法蛋 S1", "image", "PIPELINE");
    expect(image).toContain("阿尔法蛋 S1");
    expect(image).toContain("不要在用户未补充前直接扣费生成");
    expect(image).toContain("PIPELINE");

    const video = buildProductGenerationAgentMessage("阿尔法蛋 S1", "video", "PIPELINE");
    expect(video).toContain("商品短视频任务（不是短剧）");
    expect(video).toContain("生成5条视频脚本");
    expect(video).toContain("不要在用户未选定脚本前直接扣费生成视频");
    expect(video).toContain("禁止打开短剧智能体");
    expect(video).toContain("wodeapp-short-drama-factory");
  });

  test("product_save follow-up choices emit a parseable wodeapp-choices block", () => {
    const markdown = buildProductSaveFollowUpChoicesMarkdown("阿尔法蛋 S1");
    expect(markdown.startsWith("```wodeapp-choices")).toBe(true);
    const json = markdown.replace(/^```wodeapp-choices\n/, "").replace(/\n```$/, "");
    const spec = JSON.parse(json) as {
      title: string;
      questions: Array<{ options: Array<{ label: string }> }>;
    };
    expect(spec.title).toContain("商品已入库");
    expect(spec.questions[0]?.options.map((option) => option.label)).toEqual([
      "生成商品图",
      "生成视频脚本",
      "先不用",
    ]);
  });
});
