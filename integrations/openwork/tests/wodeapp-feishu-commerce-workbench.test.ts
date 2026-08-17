import { describe, expect, test } from "bun:test";

import {
  FEISHU_COMMERCE_WORKFLOWS,
  buildFeishuCommercePrompt,
} from "../src/react-app/domains/wodeapp/wodeapp-feishu-commerce-workbench";

describe("Feishu commerce workbench", () => {
  test("exposes a focused set of ecommerce operating workflows", () => {
    expect(FEISHU_COMMERCE_WORKFLOWS.map((workflow) => workflow.id)).toEqual([
      "weekly-report",
      "business-anomaly",
      "product-inventory",
      "campaign-review",
      "customer-voice",
      "next-week-plan",
    ]);
  });

  test("weekly report prompt keeps source verification and writes behind confirmation", () => {
    const prompt = buildFeishuCommercePrompt("weekly-report");

    expect(prompt).toContain("lark-mcp");
    expect(prompt).toContain("字段映射");
    expect(prompt).toContain("不得编造");
    expect(prompt).toContain("创建飞书文档");
    expect(prompt).toContain("必须先让我确认");
    expect(prompt).toContain("本周一到当前时间");
    expect(prompt).toContain("数字资产");
  });

  test("every workflow preserves the no-bypass and write-confirmation rules", () => {
    for (const workflow of FEISHU_COMMERCE_WORKFLOWS) {
      const prompt = buildFeishuCommercePrompt(workflow.id);
      expect(prompt).toContain("不要用 bash、curl");
      expect(prompt).toContain("必须先让我确认");
      expect(prompt.length).toBeGreaterThan(300);
    }
  });
});
