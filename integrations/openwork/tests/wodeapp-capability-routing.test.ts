import { describe, expect, test } from "bun:test";

import {
  CREATIVE_CORE_TOOL_IDS,
  detectWodeAppCapabilities,
  routeWodeAppCapabilities,
  WODEAPP_PLATFORM_MCP_TOOL_IDS,
  WODEAPP_SHOPIFY_ADMIN_MCP_TOOL_IDS,
} from "../wodeapp/wodeapp-capability-routing";
import {
  WODEAPP_ASSET_DIRECT_TOOL_NAMES,
  WODEAPP_DIRECT_ACTION_CONTRACTS,
  WODEAPP_DIRECT_TOOL_NAMES,
  WODEAPP_FOUNDATION_DIRECT_TOOL_NAMES,
  WODEAPP_IMAGE_DIRECT_TOOL_NAMES,
  WODEAPP_VIDEO_DIRECT_TOOL_NAMES,
} from "../wodeapp/wodeapp-direct-action-contracts";

describe("WodeAppX capability routing", () => {
  test("plain greetings keep heavy tools disabled", () => {
    const route = routeWodeAppCapabilities({ text: "你好" });

    expect(route.capabilities).toEqual([]);
    expect(route.system).toContain("Deferred Visibility + Gated Execution");
    expect(route.system).toContain("approvals and effect gates remain the safety boundary");
    expect(route.system).toContain("默认使用简体中文回答用户");
    expect(route.system).not.toContain("Surface: WodeAppX web chat");
    expect(route.system).toContain("只有用户明确要求其他语言时");
    expect(route.enabledTools).toEqual([
      "wodeapp_auth_status",
      "openwork_attachment_context_read",
      "openwork_runtime_status",
    ]);
    expect(route.tools.wodeapp_auth_status).toBe(true);
    expect(route.tools.openwork_attachment_context_read).toBe(true);
    expect(route.tools.openwork_runtime_status).toBe(true);
    expect(route.tools.agent_reach_web_search).toBe(false);
    expect(route.tools.openwork_docs_search).toBe(false);
    expect(route.tools.wodeappx_list_capabilities).toBe(false);
    expect(route.tools.wodeappx_search_tools).toBe(false);
    expect(route.tools.openwork_ui_list_actions).toBe(false);
    expect(route.tools.openwork_ui_execute_action).toBe(false);
    expect(route.tools.wodeapp_video_template_render).toBe(false);
    expect(route.tools.wodeappx_browser_status).toBe(false);
    expect(route.tools.openwork_file_search).toBe(false);
    expect(route.tools.wodeappx_shopify_status).toBe(false);
    expect(route.tools.bash).toBe(false);
    expect(route.tools.question).toBe(false);
    expect(route.tools.invalid).toBeUndefined();
    for (const toolName of WODEAPP_PLATFORM_MCP_TOOL_IDS) {
      expect(route.tools[`wodeapp-platform_${toolName}`]).toBe(false);
    }
    for (const toolName of WODEAPP_SHOPIFY_ADMIN_MCP_TOOL_IDS) {
      expect(route.tools[`wodeapp-shopify-admin_${toolName}`]).toBe(false);
    }
    expect(route.system).not.toContain("wodeapp.video_storyboard.open");
  });

  test("manages every direct tool and derives capability packs from registry groups", () => {
    const greeting = routeWodeAppCapabilities({ text: "你好" });
    const assets = routeWodeAppCapabilities({ text: "列出并检查数字资产库" });
    const noExecution = routeWodeAppCapabilities({ text: "只说明能力，不要调用任何工具" });

    expect(WODEAPP_DIRECT_TOOL_NAMES).toEqual(
      WODEAPP_DIRECT_ACTION_CONTRACTS.map((contract) => contract.toolName),
    );
    expect(WODEAPP_FOUNDATION_DIRECT_TOOL_NAMES).toEqual(["wodeapp_auth_status"]);
    expect(WODEAPP_IMAGE_DIRECT_TOOL_NAMES).toEqual([
      "wodeapp_image_asset_save",
      "wodeapp_batch_image_prepare",
    ]);
    expect(WODEAPP_ASSET_DIRECT_TOOL_NAMES).toEqual(
      WODEAPP_DIRECT_ACTION_CONTRACTS
        .filter((contract) => contract.groups.some((group) => group === "assets"))
        .map((contract) => contract.toolName),
    );

    for (const contract of WODEAPP_DIRECT_ACTION_CONTRACTS) {
      expect(greeting.tools).toHaveProperty(contract.toolName);
      expect(noExecution.tools[contract.toolName]).toBe(false);
      if (contract.groups.some((group) => group === "foundation")) {
        expect(greeting.tools[contract.toolName]).toBe(true);
      }
      if (contract.groups.some((group) => group === "assets")) {
        expect(assets.tools[contract.toolName]).toBe(true);
      }
    }
  });

  test("product video loads only the video and asset packs", () => {
    const route = routeWodeAppCapabilities({ text: "帮我生成一条商品推广视频" });

    expect(route.capabilities).toContain("video");
    expect(route.capabilities).toContain("assets");
    expect(route.system).toContain("Video:");
    expect(route.system).toContain("Digital assets:");
    expect(route.system).toContain("wodeapp_get_tool_docs");
    expect(route.system).toContain("scriptFrameUrl");
    expect(route.system).toContain("Product short-video: never call wodeapp.short_drama.open");
    expect(route.system).toContain("wodeapp-short-drama-factory");
    expect(route.tools.video_generate).toBe(true);
    expect(route.tools.wodeapp_video_storyboard_open).toBe(true);
    expect(route.tools.video_parse_link).toBe(false);
    expect(route.tools.wodeapp_video_template_render).toBe(true);
    expect(route.tools.wodeapp_product_save).toBe(true);
    expect(route.tools.wodeapp_image_asset_save).toBe(true);
    expect(route.tools.openwork_ui_execute_action).toBe(true);
    expect(route.system).toContain("wodeapp_video_storyboard_open");
    expect(route.tools.wodeappx_browser_status).toBe(false);
    expect(route.tools.wodeappx_shopify_status).toBe(false);
    expect(route.system).not.toContain("Online video URL task");
  });

  test("product short-video wording still routes to video pack and bans short-drama", () => {
    const route = routeWodeAppCapabilities({
      text: "用商品「轻语耳机 224814」生成短视频：高级一点",
    });

    expect(route.capabilities).toContain("video");
    expect(route.capabilities).toContain("assets");
    expect(route.system).toContain("Product short-video: never call wodeapp.short_drama.open");
    expect(route.system).toContain("never call wodeapp.short_drama.open");
    expect(route.tools.video_generate).toBe(true);
    expect(route.tools.wodeapp_video_storyboard_open).toBe(true);
  });

  test("online video URL parsing exposes the local atomic path and cloud fallback", () => {
    const route = routeWodeAppCapabilities({
      text: "解析下这个链接看看https://www.douyin.com/jingxuan?modal_id=7649696609795077818",
    });

    expect(route.capabilities).toContain("video-url");
    expect(route.capabilities).not.toContain("video");
    expect(route.capabilities).not.toContain("internet");
    expect(route.tools.video_resolve_link).toBe(true);
    expect(route.tools.video_extract_metadata).toBe(true);
    expect(route.tools.video_parse_link).toBe(true);
    expect(route.tools["wodeapp-platform_video_parse_link"]).toBe(true);
    expect(route.tools.media_analyze).toBe(true);
    // Creative + workspace + lean web stay visible; niche internet (weather/rss) stays off.
    expect(route.tools.video_generate).toBe(true);
    expect(route.tools.wodeapp_image_asset_save).toBe(true);
    expect(route.tools.agent_reach_web_read).toBe(true);
    expect(route.tools.webfetch).toBe(true);
    expect(route.tools.bash).toBe(true);
    expect(route.tools.agent_reach_weather).toBe(false);
    expect(route.system).toContain("video_resolve_link");
    expect(route.system).toContain("video_extract_metadata");
    expect(route.system).toContain("DEPENDENCY_MISSING");
  });

  test("video parsing and public research compose video and internet tools", () => {
    const route = routeWodeAppCapabilities({
      text: "解析 https://www.douyin.com/video/7649696609795077818，并搜索作者最近的公开资料",
    });

    expect(route.capabilities).toContain("video-url");
    expect(route.capabilities).toContain("internet");
    expect(route.tools.video_resolve_link).toBe(true);
    expect(route.tools.video_extract_metadata).toBe(true);
    expect(route.tools.video_parse_link).toBe(true);
    expect(route.tools.agent_reach_web_search).toBe(true);
    expect(route.tools.agent_reach_web_read).toBe(true);
    expect(route.system).toContain("Deferred Visibility + Gated Execution");
    expect(route.system).toContain("small direct coding/web surface plus tool_search");
    expect(route.system).toContain("Visibility is not authorization");
  });

  test("online video follow-ups keep the parser and analyzer available", () => {
    const route = routeWodeAppCapabilities({ text: "下载并解析这个视频的内容" });

    expect(route.capabilities).toContain("video-url");
    expect(route.capabilities).not.toContain("internet");
    expect(route.tools.video_resolve_link).toBe(true);
    expect(route.tools.video_extract_metadata).toBe(true);
    expect(route.tools.video_parse_link).toBe(true);
    expect(route.tools["wodeapp-platform_video_parse_link"]).toBe(true);
    expect(route.tools.media_analyze).toBe(true);
    expect(route.tools.agent_reach_web_read).toBe(true);
  });

  test("uploaded-video parsing stays on attachment context without a generic UI tunnel", () => {
    const route = routeWodeAppCapabilities({
      text: "这些素材一起放进商品库，顺便解析开盖视频，按时间顺序做一张四宫格。",
      attachments: [{ name: "开盖.mp4", mimeType: "video/mp4", kind: "video" }],
    });

    expect(route.capabilities).toContain("video");
    expect(route.capabilities).toContain("assets");
    expect(route.tools.wodeapp_product_save).toBe(true);
    // Creative core keeps UI/video tools visible; system pack still steers away from them.
    expect(route.tools.openwork_ui_list_actions).toBe(true);
    expect(route.tools.openwork_ui_execute_action).toBe(true);
    expect(route.tools.video_generate).toBe(true);
    expect(route.system).toContain("Video:");
    expect(route.system).not.toContain("actionId");
    expect(route.system).not.toContain("wodeapp.video.frames");
  });

  test("storyboard preparation keeps creative core including asset save and video tools", () => {
    const route = routeWodeAppCapabilities({
      text: "根据当前商品素材创建并打开一个两段15秒视频分镜项目，只准备分镜，不生成最终视频。素材：https://assets.example.com/product-demo.mp4",
      assetMentions: [{ kind: "product", name: "测试商品" }],
    });

    expect(route.capabilities).toContain("video");
    expect(route.capabilities).toContain("assets");
    expect(route.capabilities).not.toContain("browser");
    expect(route.tools.product_video_storyboard_capability).toBe(true);
    expect(route.tools.openwork_ui_execute_action).toBe(true);
    expect(route.tools.openwork_ui_list_actions).toBe(true);
    expect(route.tools.video_generate).toBe(true);
    expect(route.tools.wodeapp_video_template_render).toBe(true);
    expect(route.tools.wodeapp_image_asset_save).toBe(true);
    expect(route.tools.wodeappx_browser_open_url).toBe(false);
    expect(route.tools.bash).toBe(true);
    expect(route.system).toContain("wodeapp_video_storyboard_open");
    expect(route.system).not.toContain("actionId");
    expect(route.system).not.toContain("wodeapp.video_storyboard.open");
    expect(route.system).not.toContain("wodeapp.assets.list");
    expect(route.system).toContain("After three failed or repeated attempts");
  });

  test("a product save receives a typed direct tool instead of the generic action tunnel", () => {
    const route = routeWodeAppCapabilities({
      text: "解析下这个商品，并把信息存入商品库",
      attachments: [
        { name: "商品 brief.pdf", mimeType: "application/pdf", kind: "file" },
        { name: "商品主图.jpg", mimeType: "image/jpeg", kind: "image" },
      ],
    });

    expect(route.capabilities).toContain("assets");
    expect(route.tools.wodeapp_product_save).toBe(true);
    expect(route.tools.wodeapp_assets_list).toBe(true);
    expect(route.tools.openwork_ui_execute_action).toBe(true);
    expect(route.tools.openwork_ui_list_actions).toBe(true);
    expect(route.tools.wodeappx_list_capabilities).toBe(true);
    expect(route.system).not.toContain("wodeapp.product.save");
    expect(route.system).not.toContain("wodeapp.assets.update");
    expect(route.system).toContain("wodeapp_get_tool_docs");
  });

  test("explicit Chrome tasks expose one WodeAppX browser surface without competing browser stacks", () => {
    const route = routeWodeAppCapabilities({ text: "打开 Chrome 查看这个网页" });

    expect(route.capabilities).toContain("browser");
    expect(route.capabilities).not.toContain("browser-devtools");
    expect(route.tools.wodeappx_browser_status).toBe(true);
    expect(route.tools.wodeappx_browser_read_page).toBe(true);
    expect(route.tools.wodeappx_browser_click).toBe(true);
    expect(route.tools.wodeappx_browser_type).toBe(true);
    expect(route.tools.wodeappx_browser_cdp).toBe(false);
    expect(route.tools.wodeappx_browser_execute).toBe(false);
    expect(route.tools.openwork_chrome_active_tab).toBe(false);
    expect(route.tools.openwork_browser_open_url).toBe(false);
    expect(route.tools.browser_version).toBe(false);
    expect(route.tools.openwork_computer_click).toBe(false);
    expect(route.tools.bash).toBe(false);
    expect(route.tools.read).toBe(false);
    expect(route.tools.agent_reach_web_search).toBe(false);
    expect(route.tools.agent_reach_web_read).toBe(false);
    expect(route.system).toContain("Use only wodeappx_browser_*");
    expect(route.system).toContain("Before claiming Chrome is unavailable");
    expect(route.system).toContain("Status is diagnostic preflight, not task completion");
    expect(route.system).toContain("perform the complete tool chain");
    expect(route.system).toContain("current nodeId");
    expect(route.system).toContain("bash/curl");
  });

  test("natural Chrome plugin wording mounts the browser route and keeps it on follow-up", () => {
    const first = routeWodeAppCapabilities({
      text: "在 chrome 浏览器里面直接通过 chrome 插件执行，看看这个页面怎么连接",
    });
    const followUp = routeWodeAppCapabilities({
      text: "继续测试输入框",
      recentUserTexts: ["在 chrome 浏览器里面直接通过 chrome 插件执行，看看这个页面怎么连接"],
    });

    expect(first.capabilities).toContain("browser");
    expect(first.tools.wodeappx_browser_status).toBe(true);
    expect(first.tools.openwork_chrome_active_tab).toBe(false);
    expect(followUp.capabilities).toContain("browser");
    expect(followUp.tools.wodeappx_browser_read_page).toBe(true);
    expect(followUp.tools.browser_snapshot).toBe(false);
  });

  test("raw CDP is visible only for an explicit Chrome developer request", () => {
    const route = routeWodeAppCapabilities({
      text: "用 Chrome 插件的 CDP 调试协议读取这个本地测试页的 document.title",
    });

    expect(route.capabilities).toContain("browser");
    expect(route.capabilities).toContain("browser-devtools");
    expect(route.tools.wodeappx_browser_cdp).toBe(true);
    expect(route.tools.wodeappx_browser_execute).toBe(false);
    expect(route.system).toContain("helper-last full developer access");
    expect(route.system).toContain("userConfirmed:true");
    expect(route.system).toContain("Never use it for cookies");
  });

  test("an authorized CDP clause is not negated by banning another browser stack later", () => {
    const route = routeWodeAppCapabilities({
      text: "请使用 WodeAppX Chrome 插件在 Chrome 新标签打开 https://example.com/。我明确授权你仅针对 example.com、仅为本轮开发者模式验收使用一次原始 CDP Runtime.evaluate，读取 document.title、location.href 和页面 h1 文本；不得读取 Cookie、认证信息、密码、浏览器存储、历史或网络请求。CDP 后再用普通页面读取验证两边结果是否一致。不要使用 ChatGPT Chrome 插件、内置浏览器、Computer Use、bash 或 curl。",
    });

    expect(route.capabilities).toContain("browser");
    expect(route.capabilities).toContain("browser-devtools");
    expect(route.tools.wodeappx_browser_cdp).toBe(true);
    expect(route.tools.wodeappx_browser_eval).toBe(true);
    expect(route.tools.bash).toBe(false);
    expect(route.system).toContain("recommendedRawCdpClientId");
    expect(route.system).toContain("supportsRawCdp:true");
    expect(route.system).toContain("a pre-CDP baseline is not post-CDP verification");
  });

  test("negated CDP and terminal fallbacks do not widen a focused Chrome route", () => {
    const route = routeWodeAppCapabilities({
      text: "用 Chrome 插件读取当前页面，不要使用终端、bash、eval、execute 或 CDP",
    });

    expect(route.capabilities).toContain("browser");
    expect(route.capabilities).not.toContain("browser-devtools");
    expect(route.tools.wodeappx_browser_status).toBe(true);
    expect(route.tools.wodeappx_browser_read_page).toBe(true);
    expect(route.tools.wodeappx_browser_cdp).toBe(false);
    expect(route.tools.wodeappx_browser_execute).toBe(false);
    expect(route.tools.bash).toBe(false);
    expect(route.tools.browser_snapshot).toBe(false);
    expect(route.tools.openwork_chrome_snapshot).toBe(false);
  });

  test("a Chrome-selected URL read does not also mount generic internet tools", () => {
    const route = routeWodeAppCapabilities({
      text: "使用 WodeAppX Chrome 插件打开 http://127.0.0.1:18765/browser-control-e2e.html，再读取页面标题",
    });

    expect(route.capabilities).toContain("browser");
    expect(route.capabilities).not.toContain("internet");
    expect(route.tools.wodeappx_browser_open_url).toBe(true);
    expect(route.tools.wodeappx_browser_read_page).toBe(true);
    expect(route.tools.agent_reach_web_search).toBe(false);
    expect(route.tools.agent_reach_web_read).toBe(false);
    expect(route.tools.web_fetch).toBe(false);
  });

  test("login-wall crawl intent mounts Chrome extension tools instead of HTTP readers", () => {
    const route = routeWodeAppCapabilities({
      text: "抓取这个需要登录才能看的页面内容 https://example.com/private",
    });

    expect(route.capabilities).toContain("browser");
    expect(route.capabilities).not.toContain("internet");
    expect(route.capabilities).not.toContain("browser-devtools");
    expect(route.tools.wodeappx_browser_status).toBe(true);
    expect(route.tools.wodeappx_browser_open_url).toBe(true);
    expect(route.tools.wodeappx_browser_read_page).toBe(true);
    expect(route.tools.wodeappx_browser_cdp).toBe(false);
    expect(route.tools.agent_reach_web_read).toBe(false);
    expect(route.system).toContain("Prefer this surface whenever the page needs login");
  });

  test("login-session wording prefers Chrome without unlocking raw CDP", () => {
    const route = routeWodeAppCapabilities({
      text: "我已登录，用登录态读取当前网页正文",
    });

    expect(route.capabilities).toContain("browser");
    expect(route.capabilities).not.toContain("browser-devtools");
    expect(route.tools.wodeappx_browser_read_page).toBe(true);
    expect(route.tools.wodeappx_browser_cdp).toBe(false);
  });

  test("WodeApp account login wording does not mount browser crawl tools", () => {
    const route = routeWodeAppCapabilities({
      text: "请先登录小灵通账户再继续",
    });

    expect(route.capabilities).not.toContain("browser");
    expect(route.tools.wodeappx_browser_status).toBe(false);
  });

  test("generic internet pack tells the model to escalate login walls to Chrome", () => {
    const route = routeWodeAppCapabilities({
      text: "搜索并读取最新的公开行业资料",
    });

    expect(route.capabilities).toContain("internet");
    expect(route.system).toContain("Login / paywall / cookie-session pages");
    expect(route.system).toContain("wodeappx_browser_status");
    expect(route.system).toContain("Raw wodeappx_browser_cdp stays helper-last");
  });

  test("an explicit CDP-only request still mounts Chrome developer tools", () => {
    const route = routeWodeAppCapabilities({
      text: "CDP 后台操作可以吗？先检查连接状态",
    });

    expect(route.capabilities).toContain("browser");
    expect(route.capabilities).toContain("browser-devtools");
    expect(route.tools.wodeappx_browser_status).toBe(true);
    expect(route.tools.wodeappx_browser_cdp).toBe(true);
    expect(route.tools.bash).toBe(false);
  });

  test("a normal webpage URL does not mount the video URL node", () => {
    const route = routeWodeAppCapabilities({ text: "解析这个网页链接 https://example.com/article" });

    expect(route.capabilities).toContain("internet");
    expect(route.capabilities).not.toContain("video-url");
    expect(route.tools.video_parse_link).toBe(false);
    expect(route.system).not.toContain("Online video URL task");
  });

  test("weather questions mount the dedicated live weather route", () => {
    const route = routeWodeAppCapabilities({ text: "杭州的天气" });

    expect(route.capabilities).toContain("internet");
    expect(route.system).toContain("agent_reach_weather");
    expect(route.tools.agent_reach_weather).toBe(true);
    expect(route.tools.agent_reach_web_search).toBe(true);
    expect(route.tools.openwork_computer_click).toBe(false);
    expect(route.tools.agent_reach_rss_read).toBe(false);
    expect(route.tools.agent_reach_youtube_transcript).toBe(false);
    expect(route.tools.openwork_docs_search).toBe(false);
    expect(route.tools.openwork_file_search).toBe(false);
  });

  test("time-sensitive questions mount web search without requiring explicit 联网 wording", () => {
    const route = routeWodeAppCapabilities({ text: "今天有什么重要新闻？" });

    expect(route.capabilities).toContain("internet");
    expect(route.tools.agent_reach_web_search).toBe(true);
    expect(route.tools.agent_reach_web_read).toBe(true);
    expect(route.tools.bash).toBe(true);
  });

  test("one-time automation wording exposes scheduler tools", () => {
    const route = routeWodeAppCapabilities({
      text: "这是自动化实操测试：创建一个一次性测试任务，计划时间设为 2099-01-01 00:00",
    });

    expect(route.capabilities).toContain("automation");
    expect(route.tools.schedule_job).toBe(true);
    expect(route.tools.get_job).toBe(true);
    expect(route.tools.delete_job).toBe(true);
  });

  test("routes a normal nightly maintenance request without tool-name hints", () => {
    const route = routeWodeAppCapabilities({
      text: "每天晚上 11 点，总结今天修改的代码，提交推送，更新文档，删除过时文档等",
    });

    expect(route.capabilities).toContain("automation");
    expect(route.tools.schedule_job).toBe(true);
    expect(route.tools.list_jobs).toBe(true);
  });

  test("Chinese 建站 and 站点 wording exposes platform publishing tools", () => {
    for (const text of ["帮我建站并发布", "创建一个最小单页站点并发布"]) {
      const route = routeWodeAppCapabilities({ text });
      expect(route.capabilities).toContain("site");
      expect(route.tools.create_project).toBe(true);
      expect(route.tools.publish_project).toBe(true);
      expect(route.tools["wodeapp-platform_create_project"]).toBe(true);
    }
  });

  test("site pack steers hand-authored HTML through wodeapp_page_import_from_file", () => {
    const route = routeWodeAppCapabilities({ text: "帮我建站并发布" });
    expect(route.system).toContain("wodeapp_page_import_from_file");
    expect(route.system).toContain("sourcePath");
    expect(route.system).toMatch(/finish=length|tool 'invalid'|unavailable tool/);
    expect(route.system).toContain("publish_project");
    expect(route.tools.wodeapp_page_import_from_file).toBe(true);
  });

  test("agent-app pack also forbids mega template paste into update_page", () => {
    const route = routeWodeAppCapabilities({ text: "帮我创建一个售后客服智能体" });
    expect(route.system).toContain("Hand-authored HTML");
    expect(route.system).toContain("wodeapp_page_import_from_file");
    expect(route.system).toContain("publish_project");
  });

  test("site generation exposes the routed platform ai_generate_text tool", () => {
    const route = routeWodeAppCapabilities({ text: "生成网站文案并创建一个产品站点" });

    expect(WODEAPP_PLATFORM_MCP_TOOL_IDS).toContain("ai_generate_text");
    expect(route.capabilities).toContain("site");
    expect(route.tools.ai_generate_text).toBe(true);
    expect(route.tools["wodeapp-platform_ai_generate_text"]).toBe(true);
  });

  test("Agent App wording exposes skill materialize and design-then-generate create flow", () => {
    for (const text of [
      "创建名为 WODEAPPX_LIVE_TEST_AGENT_20260714 的最小 Agent App",
      "请创建一个最小 Agent 应用",
    ]) {
      const route = routeWodeAppCapabilities({ text });
      expect(route.capabilities).toContain("agent-app");
      expect(route.capabilities).not.toContain("site");
      expect(route.capabilities).not.toContain("workspace");
      expect(route.tools.list_skill_manifests).toBe(true);
      expect(route.tools.materialize_skill_app).toBe(true);
      expect(route.tools.list_templates).toBe(true);
      expect(route.tools.create_project).toBe(true);
      expect(route.tools.ai_generate_page).toBe(true);
      expect(route.tools["wodeapp-platform_list_skill_manifests"]).toBe(true);
      expect(route.tools["wodeapp-platform_materialize_skill_app"]).toBe(true);
      expect(route.tools["wodeapp-platform_create_project"]).toBe(true);
      expect(route.tools["wodeapp-platform_ai_generate_page"]).toBe(true);
      expect(route.tools.build_app).toBe(false);
      expect(route.tools.read).toBe(true);
      expect(route.tools.todowrite).toBe(true);
      expect(route.tools.browser_snapshot).toBe(true);
    }
  });

  test("the live Agent App audit prompt stays on the focused route", () => {
    const route = routeWodeAppCapabilities({
      text: "这是明确授权的真实 Agent App 测试：创建名为 WODEAPPX_LIVE_TEST_AGENT_20260714 的最小 Agent 应用，职责是把一句话改写得更简洁；返回真实项目 ID 和创建结果。测试项目允许保留供审计。",
    });

    expect(route.capabilities).toEqual(["agent-app"]);
    expect(route.system).toContain("Opening a URL is not verification");
    expect(route.system).toContain("list_skill_manifests");
    expect(route.system).toContain("materialize_skill_app");
    expect(route.system).toContain("ai_generate_page");
    expect(route.tools.list_skill_manifests).toBe(true);
    expect(route.tools.materialize_skill_app).toBe(true);
    expect(route.tools.list_templates).toBe(true);
    expect(route.tools.create_project).toBe(true);
    expect(route.tools.ai_generate_page).toBe(true);
    expect(route.tools.update_page).toBe(true);
    expect(route.tools.publish_project).toBe(true);
    expect(route.tools.openwork_browser_open_url).toBe(true);
    expect(route.tools.browser_snapshot).toBe(true);
    expect(route.tools.bash).toBe(true);
    expect(route.tools.read).toBe(true);
    expect(route.tools.todowrite).toBe(true);
  });

  test("local document work enables file tools; coding stays resident without false workspace cap", () => {
    const route = routeWodeAppCapabilities({ text: "整理本地 PDF 文件并提取文字" });

    expect(route.capabilities).toContain("files");
    expect(route.capabilities).not.toContain("workspace");
    expect(route.tools.openwork_file_extract_text).toBe(true);
    expect(route.tools.openwork_pdf_info).toBe(true);
    expect(route.tools.openwork_pdf_extract_text).toBe(true);
    expect(route.system).toContain("PDF tools are already available; do not call the skill loader first");
    expect(route.system).not.toContain("load wodeappx-pdf");
    expect(route.tools.read).toBe(true);
    expect(route.tools.bash).toBe(true);
    expect(route.tools.wodeappx_browser_status).toBe(false);
    expect(route.system).toContain("remembered context is not fresh evidence");
  });

  test("mixed web and explicit filename evidence enables both tool packs", () => {
    const route = routeWodeAppCapabilities({
      text: "先联网查询 Codex，再实际搜索并读取本地 AGENTS.md 中的硬规则",
    });

    expect(route.capabilities).toContain("internet");
    expect(route.capabilities).toContain("files");
    expect(route.tools.agent_reach_web_search).toBe(true);
    expect(route.tools.openwork_file_search).toBe(true);
    expect(route.tools.openwork_file_extract_text).toBe(true);
  });

  test("document research and image generation union all relevant capability nodes", () => {
    const route = routeWodeAppCapabilities({
      text: "读取本地 PDF，再搜索相关行业数据并生成图片",
    });

    expect(route.capabilities).toContain("files");
    expect(route.capabilities).not.toContain("workspace");
    expect(route.capabilities).toContain("internet");
    expect(route.capabilities).toContain("image");
    expect(route.tools.openwork_pdf_extract_text).toBe(true);
    expect(route.tools.agent_reach_web_search).toBe(true);
    expect(route.tools.ai_generate_image).toBe(true);
  });

  test("deterministic image editing exposes local atomic tools before generation fallbacks", () => {
    const route = routeWodeAppCapabilities({
      text: "把这几张商品图原样拼成一张参考图并裁剪，不要重新生图",
      attachments: [
        { name: "front.png", mimeType: "image/png", kind: "image" },
        { name: "open.png", mimeType: "image/png", kind: "image" },
      ],
    });

    expect(route.capabilities).toContain("image");
    expect(route.tools.image_inspect).toBe(true);
    expect(route.tools.image_crop).toBe(true);
    expect(route.tools.image_resize).toBe(true);
    expect(route.tools.image_rotate_flip).toBe(true);
    expect(route.tools.image_collage).toBe(true);
    expect(route.tools.image_composite).toBe(true);
    expect(route.system).toContain("deterministic edits use image_* tools");
    expect(route.tools.ai_generate_image).toBe(true);
  });

  test("an attached image understanding request mounts the image pack, not general fail-open", () => {
    const route = routeWodeAppCapabilities({
      text: "这张图讲了什么？",
      attachments: [{ name: "screen.png", mimeType: "image/png", kind: "image" }],
    });

    expect(route.capabilities).toContain("image");
    expect(route.capabilities).not.toContain("general");
    expect(route.tools.image_inspect).toBe(true);
    expect(route.tools.create_project).toBe(true);
    expect(route.tools.wodeapp_image_asset_save).toBe(true);
    expect(route.tools.openwork_computer_snapshot).toBe(false);
    expect(route.tools.bash).toBe(true);
    expect(route.tools.invalid).toBeUndefined();
  });

  test("arbitrary new task classes mount creative core, not the complete heavy surface", () => {
    const route = routeWodeAppCapabilities({
      text: "把这件从未预设过的事情处理好，先判断需要哪些能力再完成",
    });

    expect(route.capabilities).toEqual(["general"]);
    expect(route.system).toContain("Call tool_search when the needed operation is deferred");
    expect(route.tools.wodeappx_list_capabilities).toBe(true);
    expect(route.tools.wodeapp_get_tool_docs).toBe(true);
    expect(route.tools.wodeapp_image_asset_save).toBe(true);
    expect(route.tools.ai_generate_image).toBe(true);
    expect(route.tools.video_generate).toBe(true);
    expect(route.tools.openwork_ui_execute_action).toBe(true);
    expect(route.tools.create_project).toBe(true);
    for (const toolName of CREATIVE_CORE_TOOL_IDS) {
      expect(route.tools[toolName]).toBe(true);
    }
    expect(route.tools.agent_reach_web_search).toBe(true);
    expect(route.tools.openwork_file_search).toBe(false);
    expect(route.tools.openwork_computer_snapshot).toBe(false);
    expect(route.tools.schedule_job).toBe(false);
    expect(route.tools.wodeappx_shopify_status).toBe(false);
    expect(route.tools.wodeapp_assets_delete).toBe(false);
    expect(route.tools.bash).toBe(true);
    expect(route.tools.invalid).toBeUndefined();
  });

  test("explicit capability questions keep the discovery tool available", () => {
    expect(detectWodeAppCapabilities({ text: "你有什么能力？" })).toContain("discovery");
    for (const text of [
      "列出你的工具",
      "请实际调用能力发现工具，列出你当前可以使用的主要能力类别，不要凭记忆回答。",
    ]) {
      const route = routeWodeAppCapabilities({ text });
      expect(route.capabilities).toEqual(["discovery"]);
      expect(route.tools.wodeappx_list_capabilities).toBe(true);
      expect(route.tools.wodeapp_image_asset_save).toBe(true);
      expect(route.tools.agent_reach_web_search).toBe(true);
      expect(route.tools.bash).toBe(true);
    }
  });

  test("explicit no-tool and confirmation-only requests keep the tool surface minimal", () => {
    for (const text of [
      "延迟基线测试：请只回复 OK-BASE，不要调用任何工具。",
      "帮我删除当前所有项目。注意：我还没有授权你真的执行，现在只告诉我你需要什么确认。",
      "Do not call any tools; only reply OK.",
    ]) {
      const route = routeWodeAppCapabilities({ text });
      expect(route.capabilities).toEqual([]);
      expect(route.enabledTools).toEqual([]);
      expect(route.tools.agent_reach_web_search).toBe(false);
      expect(route.tools.create_project).toBe(false);
      expect(route.tools.bash).toBe(false);
    }
  });

  test("generic execution wording does not falsely mount internet tools", () => {
    const route = routeWodeAppCapabilities({ text: "现在只告诉我你需要什么确认，不要执行。" });
    expect(route.capabilities).not.toContain("internet");
    expect(route.tools.agent_reach_web_search).toBe(false);
  });

  test("agent creation routes to skill-first then design-then-generate create/publish flow", () => {
    const route = routeWodeAppCapabilities({ text: "帮我创建一个售后客服智能体" });

    expect(route.capabilities).toContain("agent-app");
    expect(route.capabilities).not.toContain("site");
    expect(route.system).toContain("prefer Skill materialization");
    expect(route.system).toContain("list_skill_manifests");
    expect(route.system).toContain("materialize_skill_app");
    expect(route.system).toContain("ai_generate_page");
    expect(route.system).toContain("never assemble Hero/SmartForm/SmartTable stacks");
    expect(route.system).not.toContain("create_agent_app");
    expect(route.tools.list_skill_manifests).toBe(true);
    expect(route.tools.materialize_skill_app).toBe(true);
    expect(route.tools.list_templates).toBe(true);
    expect(route.tools.create_project).toBe(true);
    expect(route.tools.list_pages).toBe(true);
    expect(route.tools.ai_generate_page).toBe(true);
    expect(route.tools.openwork_browser_open_url).toBe(true);
    expect(route.tools.browser_snapshot).toBe(true);
    expect(route.tools.build_app).toBe(false);
    expect(route.tools["wodeapp-platform_create_project"]).toBe(true);
    expect(route.tools["wodeapp-platform_materialize_skill_app"]).toBe(true);
    expect(route.tools["wodeapp-platform_ai_generate_page"]).toBe(true);
    expect(route.tools["wodeapp-platform_publish_project"]).toBe(true);
    expect(route.tools["wodeapp-platform_build_app"]).toBe(false);
    expect(route.tools.wodeapp_sidebar_agent_save).toBe(true);
    expect(route.system).toContain("wodeapp_sidebar_agent_save");
    // Creative core keeps image generation tools visible alongside agent-app.
    expect(route.tools["wodeapp-platform_ai_generate_image"]).toBe(true);
    expect(route.tools.bash).toBe(true);
  });

  test("templates and packaging tools are enabled only when explicitly requested", () => {
    const normal = routeWodeAppCapabilities({ text: "创建一个产品网站并发布" });
    const template = routeWodeAppCapabilities({ text: "用模板创建一个产品网站并发布" });
    const packaged = routeWodeAppCapabilities({ text: "把这个网站打包成 PWA" });

    expect(normal.tools.list_templates).toBe(false);
    expect(normal.tools.build_app).toBe(false);
    expect(normal.system).toContain("saveData/loadData/deleteData");
    expect(normal.system).not.toContain("Data apps: create collection, bind reads/writes");
    expect(template.capabilities).toContain("site");
    expect(template.tools.list_templates).toBe(true);
    expect(template.tools.build_app).toBe(false);
    expect(packaged.capabilities).toContain("site");
    expect(packaged.tools.list_templates).toBe(false);
    expect(packaged.tools.build_app).toBe(true);
  });

  test("every platform MCP tool receives an exact namespaced policy key", () => {
    const smallTalk = routeWodeAppCapabilities({ text: "你好" });
    const site = routeWodeAppCapabilities({ text: "帮我创建一个客服网站" });
    const image = routeWodeAppCapabilities({ text: "帮我生成一张商品主图" });

    for (const toolName of WODEAPP_PLATFORM_MCP_TOOL_IDS) {
      expect(smallTalk.tools).toHaveProperty(`wodeapp-platform_${toolName}`);
    }
    expect(site.tools["wodeapp-platform_list_actions"]).toBe(true);
    expect(site.tools["wodeapp-platform_execute_action"]).toBe(true);
    expect(site.tools["wodeapp-platform_list_versions"]).toBe(true);
    expect(site.tools["wodeapp-platform_rollback_version"]).toBe(true);
    expect(image.tools["wodeapp-platform_ai_generate_image"]).toBe(true);
    expect(image.tools["wodeapp-platform_product_visual_batch_image_run"]).toBe(true);
    expect(image.tools["wodeapp-platform_product_visual_batch_image_capability"]).toBe(false);
    expect(image.system).toContain("wodeapp_get_tool_docs");
    expect(image.system).toContain("product_visual_batch_image_run");
    expect(image.tools["wodeapp-platform_create_project"]).toBe(true);
    expect(image.tools["wodeapp-platform_build_app"]).toBe(false);
  });

  test("Shopify intent discovers the authenticated Admin MCP without enabling it globally", () => {
    const greeting = routeWodeAppCapabilities({ text: "你好" });
    const shipping = routeWodeAppCapabilities({ text: "给 Shopify 小样商品设置一个单独的运费模板" });

    expect(shipping.capabilities).toContain("shopify");
    for (const toolName of WODEAPP_SHOPIFY_ADMIN_MCP_TOOL_IDS) {
      expect(greeting.tools[toolName]).toBe(false);
      expect(greeting.tools[`wodeapp-shopify-admin_${toolName}`]).toBe(false);
      expect(shipping.tools[toolName]).toBe(true);
      expect(shipping.tools[`wodeapp-shopify-admin_${toolName}`]).toBe(true);
    }
    expect(shipping.system).toContain("shopify_connections_list");
    expect(shipping.system).toContain("shopify_graphql");
    expect(shipping.system).toContain("confirmed:true");
    expect(shipping.system).toContain("explicit user confirmation");
    expect(shipping.system).toContain("Shopify Dev MCP is for API/docs/schema work, not store execution");
  });

  test("shipping-profile wording mounts Shopify Admin tools without requiring the Shopify brand name", () => {
    const route = routeWodeAppCapabilities({ text: "把样品订单的运费模板改成统一收费" });

    expect(route.capabilities).toContain("shopify");
    expect(route.tools.shopify_connections_list).toBe(true);
    expect(route.tools.shopify_graphql).toBe(true);
    expect(route.tools["wodeapp-shopify-admin_shopify_graphql"]).toBe(true);
  });

  test("the lightweight image graph opens the full contract edge only on explicit schema requests", () => {
    const normal = routeWodeAppCapabilities({ text: "用商品库里的指纹水杯生成 3 张商品主图" });
    const contract = routeWodeAppCapabilities({ text: "查看批量商品生图的完整 schema、defaults 和 examples" });

    expect(normal.capabilities).toContain("image");
    expect(normal.tools.product_visual_batch_image_run).toBe(true);
    expect(normal.tools.product_visual_batch_image_capability).toBe(false);
    expect(contract.capabilities).toContain("image");
    expect(contract.tools.product_visual_batch_image_capability).toBe(true);
    expect(contract.tools["wodeapp-platform_product_visual_batch_image_capability"]).toBe(true);
  });

  test("an attached product image run keeps creative core visible without heavy packs", () => {
    const route = routeWodeAppCapabilities({
      text: "用商品库里的真实指纹水杯素材批量生成 2 张电商商品主图，直接执行，不要读取完整 capability 契约。",
      assetMentions: [{ kind: "product", name: "阿尔法蛋 S1 完整复验" }],
    });

    expect(route.capabilities).toContain("image");
    expect(route.capabilities).toContain("assets");
    expect(route.tools.product_visual_batch_image_run).toBe(true);
    expect(route.tools.product_visual_batch_image_capability).toBe(false);
    expect(route.tools.wodeappx_list_capabilities).toBe(true);
    expect(route.tools.openwork_ui_list_actions).toBe(true);
    expect(route.tools.openwork_ui_execute_action).toBe(true);
    expect(route.tools.wodeapp_image_asset_save).toBe(true);
    expect(route.tools.bash).toBe(true);
    expect(route.system).toContain("wodeapp_get_tool_docs");
    expect(route.system).toContain("product_visual_batch_image_run");
  });

  test("image studio handoff exposes the prepare-only direct tool", () => {
    const route = routeWodeAppCapabilities({
      text: "用当前商品生成主图和详情图，并打开图片工作室第三栏",
      assetMentions: [{ kind: "product", name: "测试商品" }],
    });

    expect(route.capabilities).toContain("image");
    expect(route.tools.wodeapp_batch_image_prepare).toBe(true);
    expect(route.tools.openwork_ui_execute_action).toBe(true);
    expect(route.tools.product_visual_batch_image_run).toBe(true);
    expect(route.system).toContain("wodeapp_batch_image_prepare");
    expect(route.system).toContain("no credits");
  });

  test("routes a prepare-only image-agent request even without generation wording", () => {
    const route = routeWodeAppCapabilities({
      text: "进入图片智能体并预填商品主图草稿；只准备并打开工作台，不要执行生成，不要创建远端运行任务，不要扣费。",
      assetMentions: [{ kind: "product", name: "Codex 实操测试商品" }],
    });

    expect(route.capabilities).toContain("image");
    expect(route.tools.wodeapp_batch_image_prepare).toBe(true);
    expect(route.tools.openwork_ui_execute_action).toBe(true);
    expect(route.system).toContain("wodeapp_batch_image_prepare");
  });

  test("local OpenCode agent files do not route to runtime app creation", () => {
    const route = routeWodeAppCapabilities({ text: "在工作区创建一个 OpenCode 智能体配置文件" });

    expect(route.capabilities).not.toContain("agent-app");
    expect(route.capabilities).toContain("general");
    expect(route.system).not.toContain("real WodeApp runtime Web App");
  });

  test("discovery stays available on substantive turns; UI list/execute stay paired", () => {
    const drafts = [
      { text: "你好" },
      { text: "杭州的天气" },
      { text: "帮我生成商品视频" },
      { text: "把这个目标拆成步骤并开始完成" },
    ];

    for (const draft of drafts) {
      const route = routeWodeAppCapabilities(draft);
      const substantive = draft.text !== "你好";
      expect(route.tools.wodeappx_list_capabilities).toBe(substantive);
      expect(route.tools.openwork_ui_list_actions).toBe(
        Boolean(route.tools.openwork_ui_execute_action),
      );
      expect(route.tools.invalid).toBeUndefined();
    }
  });

  test("small-talk paraphrases never mount the complete heavy tool surface", () => {
    const prompts = ["你好", "您好！", "在吗？", "谢谢", "好的", "你是谁？", "hello", "Thank you", "OK"];

    for (const text of prompts) {
      const route = routeWodeAppCapabilities({ text });
      expect(route.capabilities).not.toContain("general");
      expect(route.tools.agent_reach_web_search).toBe(false);
      expect(route.tools.ai_generate_image).toBe(false);
      expect(route.tools.video_generate).toBe(false);
      expect(route.tools.openwork_computer_click).toBe(false);
      expect(route.tools.create_project).toBe(false);
      expect(route.tools.schedule_job).toBe(false);
      expect(route.tools.bash).toBe(false);
      expect(route.tools.read).toBe(false);
    }
  });

  test("novel task paraphrases mount creative core while keeping heavy packs off", () => {
    const prompts = [
      "把这个目标拆成步骤并开始完成",
      "研究这个新问题，选择合适能力给出有证据的结论",
      "观察情况后选择最合适的能力继续",
      "帮我完成一个跨领域的新任务",
      "先弄清楚发生了什么，再采取下一步",
      "Handle this unfamiliar cross-domain task and choose the right tools",
      "Figure out the best capability for this new objective and complete it",
    ];

    for (const text of prompts) {
      const route = routeWodeAppCapabilities({ text });
      expect(route.capabilities).toEqual(["general"]);
      expect(route.tools.wodeappx_list_capabilities).toBe(true);
      expect(route.tools.ai_generate_image).toBe(true);
      expect(route.tools.video_generate).toBe(true);
      expect(route.tools.create_project).toBe(true);
      expect(route.tools.wodeapp_image_asset_save).toBe(true);
      expect(route.tools.agent_reach_web_search).toBe(true);
      expect(route.tools.read).toBe(true);
      expect(route.tools.openwork_file_preview).toBe(false);
      expect(route.tools.openwork_computer_snapshot).toBe(false);
      expect(route.tools.schedule_job).toBe(false);
      expect(route.tools.wodeappx_shopify_status).toBe(false);
      expect(route.tools.bash).toBe(true);
    }
  });

  test("short follow-ups retain the recent task pack instead of general fail-open", () => {
    const route = routeWodeAppCapabilities({
      text: "直接用 https 地址嵌入进去就行啊",
      recentUserTexts: [
        "帮我生成一张商品主图",
        "参考图片不够丰富啊，有可能会穿帮吧？最好拼接成一张套图",
      ],
    });

    expect(route.capabilities).toContain("image");
    expect(route.capabilities).not.toContain("general");
    expect(route.tools.product_visual_batch_image_run).toBe(true);
    expect(route.tools.wodeappx_list_capabilities).toBe(true);
    expect(route.tools.bash).toBe(true);
  });

  test("implicit time-sensitive requests get internet tools without saying 联网", () => {
    const prompts = [
      "杭州的天气",
      "现在人民币兑美元汇率",
      "今天英超赛程",
      "最近 OpenAI 发布了什么",
      "谁是现任法国总统",
      "What is the weather in Tokyo today?",
      "What is the latest stable React version?",
      "Who is the current CEO of Apple?",
    ];

    for (const text of prompts) {
      const route = routeWodeAppCapabilities({ text });
      expect(route.capabilities).toContain("internet");
      expect(route.tools.agent_reach_web_search).toBe(true);
      expect(route.tools.agent_reach_web_read).toBe(true);
    }
  });

  test("resolved multi-turn text controls capability selection", () => {
    const route = routeWodeAppCapabilities({
      text: "杭州的呢？",
      resolvedText: "查询杭州今天的实时天气并给出来源",
    });

    expect(route.capabilities).toContain("internet");
    expect(route.capabilities).not.toContain("general");
    expect(route.tools.agent_reach_weather).toBe(true);
  });

  test("documentation follow-ups retain the previous active task capability", () => {
    const route = routeWodeAppCapabilities({
      text: "再核对一下 WodeAppX 的参数契约和实现文档",
      recentUserTexts: ["创建一条商品推广视频，并保留可编辑的项目结果"],
    });

    expect(route.capabilities).toContain("docs");
    expect(route.capabilities).toContain("video");
    expect(route.tools.openwork_docs_search).toBe(true);
    expect(route.tools.openwork_ui_execute_action).toBe(true);
    expect(route.system).toContain("status=no_match");
  });

  test("contextual follow-ups inherit a prior capability instead of falling back to every tool", () => {
    const route = routeWodeAppCapabilities({
      text: "继续处理上面的内容",
      recentUserTexts: ["创建一个产品网站并发布"],
    });

    expect(route.capabilities).toContain("site");
    expect(route.capabilities).not.toContain("general");
    expect(route.tools.create_project).toBe(true);
    expect(route.tools.wodeappx_shopify_status).toBe(false);
  });

  test("a new explicit task replaces rather than unions an unrelated previous task", () => {
    const route = routeWodeAppCapabilities({
      text: "生成一张新的商品主图",
      recentUserTexts: ["创建一条商品推广视频"],
    });

    expect(route.capabilities).toContain("image");
    expect(route.capabilities).not.toContain("video");
    expect(route.tools.ai_generate_image).toBe(true);
    // Video tools stay visible via creative core; the video capability pack is not mounted.
    expect(route.tools.video_generate).toBe(true);
    expect(route.system).not.toContain("Video:");
    // Foundation guidance tells the model to discover storyboard tools instead
    // of assuming a deferred tool is already mounted.
    expect(route.system).toContain("search for storyboard tools");
    expect(route.tools.wodeappx_shopify_status).toBe(false);
    expect(route.tools.bash).toBe(true);
  });

  test("an explicit no-execution request never inherits executable capabilities", () => {
    const route = routeWodeAppCapabilities({
      text: "先不要执行，只告诉我需要什么确认",
      recentUserTexts: ["创建一个产品网站并发布"],
    });

    expect(route.capabilities).toEqual([]);
    expect(route.enabledTools).toEqual([]);
  });

  test("known capability families keep their required representative tools", () => {
    const cases = [
      { text: "打开 Chrome 查看这个网页", capability: "browser", tool: "wodeappx_browser_status" },
      { text: "整理本地 PDF 文件并提取文字", capability: "files", tool: "openwork_file_extract_text" },
      { text: "帮我生成一张宣传图片", capability: "image", tool: "ai_generate_image" },
      { text: "帮我制作一条宣传视频", capability: "video", tool: "video_generate" },
      { text: "帮我创建一个客服网站", capability: "site", tool: "create_project" },
      { text: "每天早上执行这个任务", capability: "automation", tool: "schedule_job" },
      { text: "查看 Shopify 店铺订单", capability: "shopify", tool: "wodeappx_shopify_orders" },
      { text: "把 Shopify 商品同步到飞书多维表", capability: "shopify", tool: "wodeappx_shopify_feishu_sync_preview" },
      { text: "打开模型设置", capability: "app-ui", tool: "openwork_ui_execute_action" },
      { text: "查询 WodeApp API 文档", capability: "docs", tool: "openwork_docs_search" },
    ];

    for (const item of cases) {
      const route = routeWodeAppCapabilities({ text: item.text });
      expect(route.capabilities).toContain(item.capability);
      expect(route.tools[item.tool]).toBe(true);
    }
  });

  test("unions files capability when attachmentRequirements declare unread local documents", () => {
    const route = routeWodeAppCapabilities({
      text: "把这些资料总结后存到商品库",
      attachmentRequirements: {
        localRead: true,
        requiredCapabilities: ["files"],
        requiredTools: [
          "openwork_file_extract_text",
          "openwork_file_preview",
          "openwork_file_media_probe",
        ],
        localDocuments: [{
          filename: "socks.xls",
          mimeType: "application/vnd.ms-excel",
          extension: ".xls",
          readStatus: "unread",
        }],
      },
    });

    expect(route.capabilities).toContain("files");
    expect(route.capabilities).toContain("assets");
    expect(route.tools.openwork_file_extract_text).toBe(true);
    expect(route.tools.openwork_file_preview).toBe(true);
    expect(route.tools.openwork_file_media_probe).toBe(true);
  });

  test("explicit code/repo prompts mount workspace coding tools", () => {
    const route = routeWodeAppCapabilities({ text: "帮我修复这个仓库里的 bug" });
    expect(route.capabilities).toContain("workspace");
    expect(route.tools.bash).toBe(true);
    expect(route.tools.read).toBe(true);
    expect(route.tools.edit).toBe(true);
    expect(route.tools.wodeapp_product_save).toBe(true); // still resident creative on substantive
  });

  test("product video script prompts do not false-positive into workspace capability", () => {
    const route = routeWodeAppCapabilities({ text: "为摩飞测试2生成5条商品视频脚本" });
    expect(route.capabilities).not.toContain("workspace");
    expect(route.tools.bash).toBe(true);
    expect(route.tools.video_generate).toBe(true);
  });

  test("python/shell script prompts set workspace capability; creative scripts do not", () => {
    for (const text of [
      "写个 python 脚本帮我批量改文件名",
      "用 python 跑一下这个处理",
      "执行一下这段 shell",
      "帮我写个脚本统计销量",
    ]) {
      const route = routeWodeAppCapabilities({ text });
      expect(route.capabilities).toContain("workspace");
      expect(route.tools.bash).toBe(true);
      expect(route.tools.read).toBe(true);
      expect(route.tools.write).toBe(true);
    }
    const creative = routeWodeAppCapabilities({ text: "写个短视频口播脚本" });
    expect(creative.capabilities).not.toContain("workspace");
    // Coding is resident on substantive turns; creative-script only avoids the workspace system pack.
    expect(creative.tools.bash).toBe(true);
  });

  test("DeepSeek-only key snapshot hides image/video generation tools and guides fill", () => {
    const snapshot = {
      ready: true,
      probedAt: 1,
      sources: [{
        id: "deepseek",
        label: "DeepSeek",
        keyPreview: "sk-d***chat",
        probeStatus: "ok" as const,
        estimated: false,
        modelIds: ["deepseek-chat"],
        sampleModels: ["deepseek-chat"],
        modalities: { text: true, image: false, video: false },
      }],
      union: { text: true, image: false, video: false },
      missing: ["image" as const, "video" as const],
      fillHints: [{ vendorId: "volcano", label: "火山方舟", why: "探测到 Seedream 即可生图" }],
      summary: "对话可用；生图不可用；生视频不可用",
      guidance: "当前缺生图、生视频。可配置火山方舟。",
    };
    const route = routeWodeAppCapabilities({
      text: "帮我生成一张宣传图片",
      providerCapability: snapshot,
    });
    expect(route.capabilities).toContain("image");
    expect(route.tools.ai_generate_image).toBe(false);
    expect(route.tools.video_generate).toBe(false);
    expect(route.system).toContain("不要调用 ai_generate_image");
    expect(route.system).toContain("DeepSeek");
  });

  test("labels the web surface as browser chat instead of the desktop workbench", () => {
    const route = routeWodeAppCapabilities({
      text: "你是谁",
      runtime: "web",
    });
    expect(route.system).toContain("Surface: WodeAppX web chat");
    expect(route.system).toContain("不要自称桌面端");
    expect(route.system).not.toContain("Self-evolution (本工作区)");
  });

  test("points self-evolve questions on web to the desktop app", () => {
    const route = routeWodeAppCapabilities({
      text: "帮我改你自己的代码",
      runtime: "web",
    });
    expect(route.system).toContain("自进化只在 WodeAppX 桌面端");
    expect(route.system).not.toContain("Self-evolution (本工作区)");
  });

});
