import { describe, expect, test } from "bun:test";

import {
  CREATIVE_CORE_RESIDENT_TOOL_IDS,
  INTERNET_RESIDENT_TOOL_IDS,
  SUBSTANTIVE_RESIDENT_TOOL_IDS,
  WORKSPACE_RESIDENT_TOOL_IDS,
  estimateTokenBudgetFromChars,
} from "../wodeapp/wodeapp-creative-core";
import {
  listWodeAppToolDocKeys,
  resolveWodeAppToolDocs,
} from "../wodeapp/wodeapp-tool-docs";
import { routeWodeAppCapabilities } from "../wodeapp/wodeapp-capability-routing";

describe("creative-core resident surface", () => {
  test("keeps creative resident tools within the 22–36 band", () => {
    expect(CREATIVE_CORE_RESIDENT_TOOL_IDS.length).toBeGreaterThanOrEqual(22);
    expect(CREATIVE_CORE_RESIDENT_TOOL_IDS.length).toBeLessThanOrEqual(36);
  });

  test("substantive resident union includes workspace and lean web (Codex/Cursor parity)", () => {
    expect(WORKSPACE_RESIDENT_TOOL_IDS).toContain("read");
    expect(WORKSPACE_RESIDENT_TOOL_IDS).toContain("bash");
    expect(WORKSPACE_RESIDENT_TOOL_IDS).toContain("grep");
    expect(WORKSPACE_RESIDENT_TOOL_IDS).toContain("todowrite");
    expect(INTERNET_RESIDENT_TOOL_IDS).toContain("agent_reach_web_search");
    expect(INTERNET_RESIDENT_TOOL_IDS).toContain("webfetch");
    expect(SUBSTANTIVE_RESIDENT_TOOL_IDS).toContain("bash");
    expect(SUBSTANTIVE_RESIDENT_TOOL_IDS).toContain("read");
    expect(SUBSTANTIVE_RESIDENT_TOOL_IDS.length).toBeGreaterThanOrEqual(40);
    expect(SUBSTANTIVE_RESIDENT_TOOL_IDS.length).toBeLessThanOrEqual(60);
  });

  test("includes discover and docs meta tools", () => {
    expect(CREATIVE_CORE_RESIDENT_TOOL_IDS).toContain("wodeappx_search_tools");
    expect(CREATIVE_CORE_RESIDENT_TOOL_IDS).toContain("wodeappx_list_capabilities");
    expect(CREATIVE_CORE_RESIDENT_TOOL_IDS).toContain("wodeapp_get_tool_docs");
    expect(CREATIVE_CORE_RESIDENT_TOOL_IDS).toContain("wodeapp_image_asset_save");
    expect(CREATIVE_CORE_RESIDENT_TOOL_IDS).toContain("wodeapp_video_storyboard_open");
    expect(CREATIVE_CORE_RESIDENT_TOOL_IDS).toContain("wodeapp_video_storyboard_update");
    expect(CREATIVE_CORE_RESIDENT_TOOL_IDS).toContain("get_project");
    expect(CREATIVE_CORE_RESIDENT_TOOL_IDS).toContain("image_inspect");
    expect(CREATIVE_CORE_RESIDENT_TOOL_IDS).toContain("wodeapp_page_import_from_file");
    expect(CREATIVE_CORE_RESIDENT_TOOL_IDS).toContain("wodeapp_sidebar_agent_save");
  });

  test("substantive turns mount coding + creative + lean web without heavy packs", () => {
    const route = routeWodeAppCapabilities({ text: "把这个跨领域新任务完成" });
    for (const toolName of SUBSTANTIVE_RESIDENT_TOOL_IDS) {
      expect(route.tools[toolName]).toBe(true);
    }
    expect(route.tools.bash).toBe(true);
    expect(route.tools.read).toBe(true);
    expect(route.tools.agent_reach_web_search).toBe(true);
    expect(route.tools.wodeappx_shopify_status).toBe(false);
    expect(route.tools.openwork_computer_snapshot).toBe(false);
    expect(route.tools.wodeapp_assets_delete).toBe(false);
    expect(route.tools.openwork_pdf_extract_text).toBe(false);
    expect(route.tools.agent_reach_weather).toBe(false);
  });

  test("small talk keeps resident creative and workspace tools off", () => {
    const route = routeWodeAppCapabilities({ text: "你好" });
    expect(route.tools.wodeapp_get_tool_docs).toBe(false);
    expect(route.tools.ai_generate_image).toBe(false);
    expect(route.tools.read).toBe(false);
    expect(route.tools.bash).toBe(false);
    expect(route.tools.agent_reach_web_search).toBe(false);
  });
});

describe("wodeapp tool docs", () => {
  test("resolves product_save aliases", () => {
    expect(resolveWodeAppToolDocs("product_save")?.title).toContain("商品");
    expect(resolveWodeAppToolDocs("wodeapp_image_asset_save")?.requiredFields).toContain("name");
    expect(resolveWodeAppToolDocs("wodeapp_image_asset_save")?.rules?.some((r) => r.includes("imageUrls"))).toBe(true);
    expect(listWodeAppToolDocKeys().length).toBeGreaterThan(3);
  });

  test("update_page / publish_project docs steer short config + publish after real write", () => {
    const update = resolveWodeAppToolDocs("update_page");
    expect(update?.title).toContain("更新");
    expect(update?.rules?.some((r) => r.includes("wodeapp_page_import_from_file"))).toBe(true);
    expect(update?.rules?.some((r) => r.includes("finish=length") || r.includes("invalid"))).toBe(true);
    expect(update?.rules?.some((r) => r.includes("禁止用本工具堆 Hero + SmartForm + SmartTable"))).toBe(true);
    expect(resolveWodeAppToolDocs("wodeapp-platform_update_page")?.rules?.[0]).toContain("update_page");
    const fromFile = resolveWodeAppToolDocs("wodeapp_page_import_from_file");
    expect(fromFile?.requiredFields).toEqual(expect.arrayContaining(["projectId", "sourcePath"]));
    expect(resolveWodeAppToolDocs("page_import_from_file")?.title).toContain("HTML");
    const publish = resolveWodeAppToolDocs("publish_project");
    expect(publish?.rules?.some((r) => r.includes("publish_project"))).toBe(true);
  });

  test("char budget helper stays sane", () => {
    expect(estimateTokenBudgetFromChars(4000)).toBe(1000);
  });
});
