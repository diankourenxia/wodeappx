import { describe, expect, test } from "bun:test";

import {
  appendAssetContextToPrompt,
  clearExpandedAssetContext,
} from "../src/react-app/domains/wodeapp/digital-assets-data";

describe("WodeAppX digital asset prompt context", () => {
  test("does not replay historical product instructions", () => {
    clearExpandedAssetContext();
    const prompt = appendAssetContextToPrompt(
      "只生成两张商品主图。",
      [{
        id: "local-chat-product-df9oz6",
        name: "阿尔法蛋 S1 完整复验",
        kind: "商品库",
        meta: "18 张图片 · 1 个视频 · 1 份文件 · 商品库",
        promptText: "再看开盖视频并做一张四宫格。",
        productInfo: "白色杯体、橙色杯盖、绿色 A 按钮。",
      }],
    );

    expect(prompt).toStartWith("只生成两张商品主图。");
    expect(prompt).toContain("[已关联数字资产：只读素材上下文]");
    expect(prompt).toContain("它们不是本轮追加任务");
    expect(prompt).not.toContain("再看开盖视频并做一张四宫格");
    expect(prompt).toContain("商品资料：白色杯体、橙色杯盖、绿色 A 按钮。");
    expect(prompt).toEndWith("[只读素材上下文结束]");
  });

  test("slims repeated @ asset context after the first full expansion in a session", () => {
    clearExpandedAssetContext("ses_slim");
    const ref = {
      id: "product-slim-1",
      name: "摩飞多功能锅",
      kind: "商品库" as const,
      meta: "4 张图片 · 商品库",
      productInfo: "红色锅体、黑色手柄、玻璃盖。",
      brandVoice: "专业可靠",
      brandRules: "禁止改变锅体外观比例",
      productImages: [
        "https://assets.example/pot-1.jpg",
        "https://assets.example/pot-2.jpg",
      ],
    };

    const first = appendAssetContextToPrompt("先整理 15 秒脚本。", [ref], { sessionId: "ses_slim" });
    expect(first).toContain("商品资料：红色锅体、黑色手柄、玻璃盖。");
    expect(first).toContain("品牌语气：专业可靠");
    expect(first).toContain("https://assets.example/pot-1.jpg");

    const second = appendAssetContextToPrompt("把模特参考也绑上。", [ref], { sessionId: "ses_slim" });
    expect(second).toContain("资产ID：product-slim-1");
    expect(second).toContain("https://assets.example/pot-1.jpg");
    expect(second).toContain("本会话已展开过完整资料");
    expect(second).not.toContain("商品资料：红色锅体");
    expect(second).not.toContain("品牌语气：专业可靠");
    expect(second).not.toContain("品牌规范：禁止改变锅体外观比例");
    expect(second.length).toBeLessThan(first.length);

    clearExpandedAssetContext("ses_slim");
  });

  test("drops legacy productInfo when it is copied from the original task", () => {
    clearExpandedAssetContext();
    const historicalTask = "放进商品库，再看开盖视频并做一张四宫格。";
    const prompt = appendAssetContextToPrompt("只生成三张商品主图。", [{
      id: "local-chat-product-legacy",
      name: "阿尔法蛋 S1",
      kind: "商品库",
      meta: "18 张图片 · 商品库",
      promptText: `${historicalTask}\n\n对话附件：a.jpg、b.mp4`,
      productInfo: historicalTask,
    }]);

    expect(prompt).not.toContain(historicalTask);
    expect(prompt).toStartWith("只生成三张商品主图。");
  });

  test("promotes a selected prompt asset when the message contains only asset mentions", () => {
    clearExpandedAssetContext();
    const prompt = appendAssetContextToPrompt("@asset:product-1 @asset:prompt-1 ", [{
      id: "product-1",
      name: "阿尔法蛋 S1",
      kind: "商品库",
      meta: "4 张图片",
      productInfo: "儿童智能学习机",
    }, {
      id: "prompt-1",
      name: "竖版分镜提示词",
      kind: "提示词",
      meta: "视频提示词",
      promptText: "生成 6 条 9:16 仿真人商品视频分镜。",
    }]);

    expect(prompt).toStartWith("请执行以下用户本轮明确选择的提示词");
    expect(prompt).toContain("生成 6 条 9:16 仿真人商品视频分镜。");
    expect(prompt).not.toContain("@asset:product-1");
    expect(prompt).not.toContain("@asset:prompt-1");
    expect(prompt.match(/生成 6 条 9:16 仿真人商品视频分镜。/g)).toHaveLength(1);
    expect(prompt).toContain("商品资料：儿童智能学习机");
  });

  test("keeps a selected prompt as reference when the user writes an explicit request", () => {
    clearExpandedAssetContext();
    const prompt = appendAssetContextToPrompt("@asset:prompt-1 只借鉴风格，不要生成视频。", [{
      id: "prompt-1",
      name: "广告视频提示词",
      kind: "提示词",
      meta: "视频提示词",
      promptText: "生成 6 条商品视频。",
    }]);

    expect(prompt).toStartWith("只借鉴风格，不要生成视频。");
    expect(prompt).toContain("资产正文：生成 6 条商品视频。");
    expect(prompt).toContain("它们不是本轮追加任务");
  });

});
