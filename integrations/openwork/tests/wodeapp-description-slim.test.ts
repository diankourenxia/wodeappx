import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  WODEAPP_DIRECT_ACTION_CONTRACT_BY_TOOL_NAME,
  buildVideoReferenceCorrective,
  classifyNonHttpsImageUrl,
} from "../wodeapp/wodeapp-direct-action-contracts";
import { resolveWodeAppToolDocs } from "../wodeapp/wodeapp-tool-docs";
import { AUTO_ORCHESTRATION_INSTRUCTION } from "../wodeapp/wodeapp-auto-orchestration";

const WODEAPP_DIR = resolve(import.meta.dir, "../wodeapp");

describe("description slim + corrective", () => {
  test("storyboard action description stays under 250 chars and drops hard-rule dumps", () => {
    const source = readFileSync(resolve(WODEAPP_DIR, "wodeapp-session-control-actions.tsx"), "utf8");
    const marker = 'id: "wodeapp.video_storyboard.open"';
    const start = source.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const descriptionMatch = source.slice(start).match(/description:\s*([`"])([\s\S]*?)\1,/);
    expect(descriptionMatch).not.toBeNull();
    const description = descriptionMatch?.[2] || "";
    expect(description.length).toBeLessThan(250);
    expect(description).not.toContain("【硬规则");
    expect(description).toContain("wodeapp.video.generate");
    expect(description).toMatch(/shareDocId|wodeapp_video_storyboard_open/);
  });

  test("auto-orchestration stays decision-routing only (no tool-desc overlap essays)", () => {
    expect(AUTO_ORCHESTRATION_INSTRUCTION).not.toContain("【硬规则");
    expect(AUTO_ORCHESTRATION_INSTRUCTION).toContain("wodeapp_get_tool_docs");
    expect(AUTO_ORCHESTRATION_INSTRUCTION).toContain("wodeapp_assets_list");
    expect(AUTO_ORCHESTRATION_INSTRUCTION.length).toBeLessThan(1000);
  });

  test("short asset tools carry trigger phrases and auto-save clarity", () => {
    const list = WODEAPP_DIRECT_ACTION_CONTRACT_BY_TOOL_NAME.get("wodeapp_assets_list")!.description;
    expect(list).toMatch(/之前存的|商品库|模特/);
    const hist = WODEAPP_DIRECT_ACTION_CONTRACT_BY_TOOL_NAME.get("wodeapp_generation_history_save")!.description;
    expect(hist).toContain("已自动保存");
    expect(hist).toMatch(/不必再调|收藏/);
    const product = WODEAPP_DIRECT_ACTION_CONTRACT_BY_TOOL_NAME.get("wodeapp_product_save")!.description;
    expect(product).toContain("selectedImageIds");
    const image = WODEAPP_DIRECT_ACTION_CONTRACT_BY_TOOL_NAME.get("wodeapp_image_asset_save")!.description;
    expect(image).toContain("wodeapp_product_save");
  });

  test("video agent samplePrompt stays compact", () => {
    const source = readFileSync(resolve(WODEAPP_DIR, "wodeapp-builtin-agents.default.json"), "utf8");
    const parsed = JSON.parse(source) as {
      agents: Array<{ id: string; samplePrompt: string }>;
    };
    const samplePrompt = parsed.agents.find((agent) => agent.id === "video-generation")?.samplePrompt || "";
    expect(samplePrompt).toContain("wodeapp_video_storyboard_open");
    expect(samplePrompt).toContain("勿传 model");
    expect(samplePrompt).toContain("seedream-5.0");
    expect(samplePrompt).not.toContain("【硬规则");
    expect(samplePrompt.length).toBeLessThan(500);
  });

  test("buildVideoReferenceCorrective suggests image_asset_save for local paths", () => {
    const result = buildVideoReferenceCorrective([
      "/Users/demo/model.jpg",
      "https://cdn.example.com/ok.png",
    ]);
    expect(result.correctiveAction?.tool).toBe("wodeapp_image_asset_save");
    expect(result.correctiveAction?.args.imageUrls).toEqual(["/Users/demo/model.jpg"]);
    expect(classifyNonHttpsImageUrl("data:image/png;base64,aaa")).toBe("data");
  });

  test("attachment prompts publish candidateImages and keep shelves unified", () => {
    const source = readFileSync(resolve(WODEAPP_DIR, "wodeapp-attachment-intelligence.ts"), "utf8");
    expect(source).toContain("candidateImages=");
    expect(source).toContain("selectedImageIds");
    expect(source).toContain("wodeapp_product_save");
    expect(source).toContain("wodeapp_image_asset_save");
    expect(source).toContain("按用户意图选货架");
    expect(source).not.toContain("不要先调 image_asset_save");
    expect(source).toContain("candidateHttpsImages=");
  });

  test("get_tool_docs covers storyboard binding rules", () => {
    const docs = resolveWodeAppToolDocs("video_storyboard");
    expect(docs?.rules?.some((rule) => rule.includes("[subject名]"))).toBe(true);
    expect(docs?.rules?.some((rule) => rule.includes("勿传 model"))).toBe(true);
    expect(docs?.rules?.some((rule) => rule.includes("seedream-5.0"))).toBe(true);
    expect(docs?.rules?.some((rule) => rule.includes("groups") && rule.includes("groupId"))).toBe(true);
    expect(docs?.rules?.some((rule) => rule.includes("create_page") || rule.includes("站点页面"))).toBe(true);
    expect(resolveWodeAppToolDocs("wodeapp.video_storyboard.open")?.title).toContain("分镜");
  });

  test("storyboard direct contract advertises groups for same-shareDoc multi-episode", () => {
    const contract = WODEAPP_DIRECT_ACTION_CONTRACT_BY_TOOL_NAME.get("wodeapp_video_storyboard_open");
    expect(contract?.description).toMatch(/groups/);
    expect(contract?.inputSchema.properties).toHaveProperty("groups");
  });
});
