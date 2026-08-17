import { describe, expect, test } from "bun:test";

import type { DigitalAssetItem } from "../wodeapp/digital-assets-data";
import {
  WYNNE_BRAND_CONNECTORS,
  WYNNE_BRAND_WORKFLOWS,
  WODEAPP_SHOPIFY_ADMIN_MCP_SERVER,
  buildWynneBrandPrompt,
  buildWynneBrandTask,
  listWynneRelatedDigitalAssets,
} from "../wodeapp/wodeapp-wynne-brand-workbench-data";
import { WODEAPP_WYNNE_RUNTIME_PROFILE_ID } from "../wodeapp/wodeapp-runtime-profile";

describe("Wynne brand workbench", () => {
  test("exposes connectors for MCP, knowledge, and digital assets", () => {
    expect(WYNNE_BRAND_CONNECTORS.map((item) => item.id)).toEqual([
      "shopify",
      "feishu",
      "knowledge",
      "assets",
    ]);
    expect(WYNNE_BRAND_CONNECTORS.some((item) => item.badge === WODEAPP_SHOPIFY_ADMIN_MCP_SERVER)).toBe(true);
    expect(WYNNE_BRAND_CONNECTORS.some((item) => item.badge === "lark-mcp")).toBe(true);
  });

  test("workflows bind the Wynne runtime profile without dumping brand facts", () => {
    expect(WYNNE_BRAND_WORKFLOWS.map((item) => item.id)).toEqual([
      "brand-chat",
      "shopify-catalog",
      "feishu-ops",
      "knowledge-lookup",
    ]);

    const task = buildWynneBrandTask("brand-chat");
    expect(task.runtimeProfileId).toBe(WODEAPP_WYNNE_RUNTIME_PROFILE_ID);
    expect(task.autoSend).toBe(false);
    expect(task.agentMessage).toContain("knowledge_search");
    expect(task.agentMessage).toContain(`profile="${WODEAPP_WYNNE_RUNTIME_PROFILE_ID}"`);
    expect(task.agentMessage).not.toContain("库存风险");
    expect(task.agentMessage).not.toContain("售后政策");

    const knowledge = buildWynneBrandPrompt("knowledge-lookup");
    expect(knowledge).toContain("knowledge_search");
    expect(knowledge).toContain("不要用通用常识冒充品牌政策");
  });

  test("lists brand/product assets and Wynne-named items for the workbench", () => {
    const assets: DigitalAssetItem[] = [
      {
        id: "brand-1",
        name: "Wynne Curtains",
        kind: "品牌库",
        meta: "品牌档案",
        preview: "brand",
      },
      {
        id: "product-1",
        name: "Brook Linen",
        kind: "商品库",
        meta: "商品",
        preview: "product",
      },
      {
        id: "prompt-1",
        name: "通用出图提示",
        kind: "提示词",
        meta: "提示词",
        preview: "prompt",
        promptText: "hello",
      },
      {
        id: "upload",
        name: "新建品牌库",
        kind: "品牌库",
        meta: "创建",
        preview: "brandCreate",
      },
    ];

    const related = listWynneRelatedDigitalAssets(assets);
    expect(related.map((item) => item.id)).toEqual(["brand-1", "product-1"]);
  });
});
