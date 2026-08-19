import { describe, expect, test } from "bun:test";

import {
  WODEAPP_CANVAS_AGENT_ID,
  WODEAPP_FEISHU_AGENT_ID,
  WODEAPP_FEISHU_SETUP_SKILL_NAME,
  WODEAPP_WYNNE_AGENT_ID,
  findWodeAppBuiltinAgent,
  formatWodeAppAgentDisplayName,
  getVisibleWodeAppBuiltinAgents,
  hasWodeAppFeishuSetupSkill,
  resolveAvailableWodeAppBuiltinAgents,
  resolveWodeAppBuiltinAgentId,
} from "../wodeapp/runtime-projects";
import { coalesceStoryboardBeatsIntoClips } from "../../../vendor/openwork/apps/app/src/react-app/domains/wodeapp/wodeapp-storyboard-clips";
import { mergePvsStoryboardRunPayload } from "../../../vendor/openwork/apps/app/src/react-app/domains/wodeapp/wodeapp-pvs-storyboard-url";

describe("WodeAppX built-in workbench resolution", () => {
  test("video storyboard remains built in when bootstrap projects are not cached", () => {
    const agent = findWodeAppBuiltinAgent("video-generation", []);

    expect(agent).toBeDefined();
    expect(agent?.demoUrl).toBeUndefined();
    expect(agent?.tools).toEqual([
      "wodeapp.video.generate",
      "wodeapp.video.status",
      "video_storyboard",
      "wodeapp.video_storyboard.update",
      "wodeapp_image_asset_save",
    ]);
    expect(agent?.samplePrompt).toBe("默认只整理方案，不自动生成。");
  });

  test("Feishu quick access stays hidden until it is marked ready and setup skill is discovered", () => {
    // Feishu is reserved but disabled in the stable default set — not in the sidebar.
    const agent = findWodeAppBuiltinAgent(WODEAPP_FEISHU_AGENT_ID, []);

    expect(agent?.id).toBe(WODEAPP_FEISHU_AGENT_ID);
    expect(getVisibleWodeAppBuiltinAgents().some((item) => item.id === WODEAPP_FEISHU_AGENT_ID)).toBe(false);
    expect(getVisibleWodeAppBuiltinAgents({ feishuSetupSkillReady: true })
      .some((item) => item.id === WODEAPP_FEISHU_AGENT_ID)).toBe(false);
    expect(getVisibleWodeAppBuiltinAgents({ feishuAgentReady: true, feishuSetupSkillReady: true })
      .some((item) => item.id === WODEAPP_FEISHU_AGENT_ID)).toBe(false);
  });

  test("built-in capability agents remain available without account projects", () => {
    const agent = findWodeAppBuiltinAgent("visual-generation", []);
    const availableIds = resolveAvailableWodeAppBuiltinAgents([]).map((item) => item.id).sort();

    expect(agent).toBeDefined();
    expect(availableIds).toEqual([
      "multi-agent-collab",
      "video-generation",
      "visual-generation",
    ]);
    expect(getVisibleWodeAppBuiltinAgents().some((item) => item.id === WODEAPP_CANVAS_AGENT_ID)).toBe(false);
    expect(getVisibleWodeAppBuiltinAgents({
      override: { version: 1, extraEnabledIds: [WODEAPP_CANVAS_AGENT_ID], hiddenIds: [], order: [] },
    }).some((item) => item.id === WODEAPP_CANVAS_AGENT_ID)).toBe(true);
    expect(getVisibleWodeAppBuiltinAgents({
      override: { version: 1, extraEnabledIds: [WODEAPP_CANVAS_AGENT_ID], hiddenIds: [], order: [] },
      canvasAgentReady: false,
    }).some((item) => item.id === WODEAPP_CANVAS_AGENT_ID)).toBe(false);
    expect(getVisibleWodeAppBuiltinAgents().some((item) => item.id === "create-agent")).toBe(false);
    expect(getVisibleWodeAppBuiltinAgents().some((item) => item.id === "script-storyboard")).toBe(false);
    expect(findWodeAppBuiltinAgent("script-storyboard", [])).toBeDefined();
  });

  test("brand agents come from config, not built-in product agents", () => {
    const withoutConfig = resolveAvailableWodeAppBuiltinAgents([]).map((item) => item.id);
    expect(withoutConfig).not.toContain(WODEAPP_WYNNE_AGENT_ID);
    expect(getVisibleWodeAppBuiltinAgents().some((item) => item.id === WODEAPP_WYNNE_AGENT_ID)).toBe(false);

    const configured = getVisibleWodeAppBuiltinAgents({
      brandAgents: [{
        id: WODEAPP_WYNNE_AGENT_ID,
        name: "Wynne 品牌智能体",
        brandId: "wynne",
        meta: "飞书 · Shopify · 品牌知识",
        connectorScopes: ["shopify", "feishu"],
        knowledgeScopes: ["wynne"],
        workbench: "wynne",
        samplePrompt: "使用 Wynne Runtime Profile；按需发现工具与知识，不预载品牌知识。",
        enabled: true,
      }],
    });
    expect(configured.some((item) => item.id === WODEAPP_WYNNE_AGENT_ID)).toBe(false);
    expect(configured.some((item) => /苏泊尔|supor|wynne/i.test(item.name))).toBe(false);
  });

  test("supor brand agents stay out of the default sidebar", () => {
    const visible = getVisibleWodeAppBuiltinAgents({
      brandAgents: [{
        id: "supor-brand-agent",
        name: "苏泊尔智能体",
        brandId: "supor",
        meta: "详情页结构 · 卖点文案 · 出图指引",
        enabled: true,
      }],
    });
    expect(visible.some((item) => item.id === "supor-brand-agent")).toBe(false);
    expect(visible.some((item) => item.name.includes("苏泊尔"))).toBe(false);
  });

  test("short-drama factory skill pin becomes the official sidebar agent", () => {
    const visible = getVisibleWodeAppBuiltinAgents({
      brandAgents: [{
        id: "skill-wodeapp-short-drama-factory",
        name: "wodeapp-short-drama-factory",
        brandId: "skill",
        meta: "End-to-end WodeApp short-drama (竖屏短剧) production pipeline. Use ONLY when the use",
        enabled: true,
      }],
    });
    expect(visible.some((item) => item.id === "script-storyboard")).toBe(true);
    expect(visible.some((item) => item.id === "skill-wodeapp-short-drama-factory")).toBe(false);
    const agent = visible.find((item) => item.id === "script-storyboard");
    expect(agent?.name).toBe("短剧智能体");
    expect(agent?.meta).toBe("剧本 · 分镜 · 可拍摄脚本");
  });

  test("custom brand agents appear in the sidebar", () => {
    const visible = getVisibleWodeAppBuiltinAgents({
      brandAgents: [{
        id: "custom-memo-helper",
        name: "备忘录助手",
        brandId: "custom",
        meta: "记下待办，打开就能查",
        enabled: true,
      }],
    });
    expect(visible.some((item) => item.id === "custom-memo-helper")).toBe(true);
    expect(visible.find((item) => item.id === "custom-memo-helper")?.name).toBe("备忘录助手");
  });

  test("create agent stays shipped but disabled in the stable default set", () => {
    const agent = findWodeAppBuiltinAgent("create-agent", []);

    expect(agent?.id).toBe("create-agent");
    expect(getVisibleWodeAppBuiltinAgents().some((item) => item.id === "create-agent")).toBe(false);
    expect(resolveWodeAppBuiltinAgentId("创建智能体")).toBe("create-agent");
    expect(resolveWodeAppBuiltinAgentId("create-agent")).toBe("create-agent");
    expect(formatWodeAppAgentDisplayName("创建智能体")).toBe("创建智能体");
  });

  test("Feishu skill discovery fails closed and accepts only the exact skill name", () => {
    expect(hasWodeAppFeishuSetupSkill(undefined)).toBe(false);
    expect(hasWodeAppFeishuSetupSkill([])).toBe(false);
    expect(hasWodeAppFeishuSetupSkill([{ name: "wodeappx-feishu" }])).toBe(false);
    expect(hasWodeAppFeishuSetupSkill([{ name: ` ${WODEAPP_FEISHU_SETUP_SKILL_NAME} ` }])).toBe(true);
  });
});

describe("WodeAppX storyboard clip normalization", () => {
  test("combines internal timeline beats into two independently generated 15-second clips", () => {
    const scenes = [
      "0-3秒 第一段开场",
      "3-6秒 第一段动作",
      "6-10秒 第一段卖点",
      "10-13秒 第一段使用",
      "13-15秒 第一段收尾",
      "15-18秒 第二段开场",
      "18-21秒 第二段动作",
      "21-24秒 第二段卖点",
      "24-27秒 第二段使用",
      "27-30秒 第二段收尾",
    ].map((prompt, index) => ({ name: `场景 ${index + 1}`, prompt, duration: 15 }));

    const clips = coalesceStoryboardBeatsIntoClips(scenes, 15);

    expect(clips).toHaveLength(2);
    expect(clips.every((clip) => clip.duration === 15)).toBe(true);
    expect(clips[0].prompt).toContain("13-15秒 第一段收尾");
    expect(clips[1].prompt).toContain("0-3秒 第二段开场");
    expect(clips[1].prompt).toContain("12-15秒 第二段收尾");
  });

  test("does not merge independent clips whose timelines each restart at zero", () => {
    const scenes = [
      { prompt: "0-15秒 第一条完整视频", duration: 15 },
      { prompt: "0-15秒 第二条完整视频", duration: 15 },
      { prompt: "0-15秒 第三条完整视频", duration: 15 },
    ];
    expect(coalesceStoryboardBeatsIntoClips(scenes, 15)).toEqual(scenes);
  });
});

describe("WodeAppX storyboard updates", () => {
  test("updates a runtime-id scene by stable name instead of duplicating it", () => {
    const merged = mergePvsStoryboardRunPayload(
      {
        capabilityId: "product-video-storyboard",
        id: "run-stable",
        topic: "商品视频",
        inputSnapshot: {},
        scenes: [{
          id: "runtime-scene-01",
          name: "01 双重锁止",
          prompt: "旧 prompt",
          videoRefs: [{ id: "ref-1", status: "succeed" }],
        }],
      },
      {
        capabilityId: "product-video-storyboard",
        id: "run-incoming",
        topic: "商品视频",
        inputSnapshot: {},
        scenes: [{
          id: undefined,
          name: "01 双重锁止",
          prompt: "按正确开盖动作更新后的 prompt",
        }],
      },
    );

    expect(merged.scenes).toHaveLength(1);
    expect(merged.scenes[0].id).toBe("runtime-scene-01");
    expect(merged.scenes[0].prompt).toContain("正确开盖动作");
    expect(merged.scenes[0].videoRefs).toHaveLength(1);
  });

  test("repairs previously duplicated runtime-id scenes by stable name", () => {
    const merged = mergePvsStoryboardRunPayload(
      {
        capabilityId: "product-video-storyboard",
        id: "run-stable",
        topic: "商品视频",
        inputSnapshot: {},
        scenes: [
          {
            id: "runtime-old",
            name: "01 双重锁止",
            prompt: "旧 prompt",
            videoRefs: [{ id: "ref-old", status: "succeed", url: "https://cdn.example/old.mp4" }],
          },
          {
            id: "runtime-duplicate",
            name: "01 双重锁止",
            prompt: "已更新 prompt",
            videoRefs: [{ id: "ref-new", status: "succeed", url: "https://cdn.example/new.mp4" }],
            activeVideoId: "ref-new",
          },
        ],
      },
      {
        capabilityId: "product-video-storyboard",
        id: "run-incoming",
        topic: "商品视频",
        inputSnapshot: {},
        scenes: [{ id: undefined, name: "01 双重锁止", prompt: "最终 prompt" }],
      },
    );

    expect(merged.scenes).toHaveLength(1);
    expect(merged.scenes[0].id).toBe("runtime-old");
    expect(merged.scenes[0].prompt).toBe("最终 prompt");
    expect(merged.scenes[0].videoRefs).toHaveLength(2);
    expect(merged.scenes[0].activeVideoId).toBe("ref-new");
  });

  test("merges groups by id instead of replacing the whole list", () => {
    const merged = mergePvsStoryboardRunPayload(
      {
        capabilityId: "product-video-storyboard",
        id: "run-stable",
        topic: "短剧",
        inputSnapshot: {},
        scenes: [{ name: "G01-1", prompt: "a", groupId: "G01" }],
        groups: [
          { id: "G01", title: "第1集", order: 1 },
          { id: "G02", title: "第2集", order: 2 },
        ],
      },
      {
        capabilityId: "product-video-storyboard",
        id: "run-incoming",
        topic: "短剧",
        inputSnapshot: {},
        scenes: [{ name: "G03-1", prompt: "c", groupId: "G03" }],
        groups: [
          { id: "G02", title: "第2集（改标题）", order: 2 },
          { id: "G03", title: "第3集", order: 3 },
        ],
      },
    );

    expect(merged.groups).toEqual([
      { id: "G01", title: "第1集", order: 1 },
      { id: "G02", title: "第2集（改标题）", order: 2 },
      { id: "G03", title: "第3集", order: 3 },
    ]);
    expect(merged.scenes).toHaveLength(2);
  });
});

describe("OSS / local-only ability workbench URLs", () => {
  test("does not fall back to cloud official URLs when preferLocal", async () => {
    const {
      findWodeAppBuiltinAgent,
      localizeAbilityProjects,
      setAbilityWorkbenchContext,
      shouldPreferLocalAbilityWorkbench,
      isOfficialAbilityDemoUrl,
    } = await import("../wodeapp/runtime-projects");

    setAbilityWorkbenchContext({ preferLocal: false, ossEdition: false });
    expect(shouldPreferLocalAbilityWorkbench({ ossEdition: true })).toBe(true);
    expect(shouldPreferLocalAbilityWorkbench({ origin: "http://127.0.0.1:3000" })).toBe(true);
    expect(shouldPreferLocalAbilityWorkbench({})).toBe(true);
    expect(shouldPreferLocalAbilityWorkbench({
      ossEdition: true,
      origin: "https://wodeapp.cn",
      profile: "cloud",
    })).toBe(false);
    expect(shouldPreferLocalAbilityWorkbench({
      hasLocalKeys: true,
      origin: "https://wodeapp.cn",
      profile: "cloud",
    })).toBe(false);
    expect(shouldPreferLocalAbilityWorkbench({
      hasLocalKeys: true,
    })).toBe(true);

    const cloudFallback = findWodeAppBuiltinAgent("video-generation", [], { preferLocal: false });
    expect(cloudFallback?.demoUrl).toBeUndefined();
    expect(isOfficialAbilityDemoUrl("https://ai.wodeapp.cn/video")).toBe(true);
    expect(isOfficialAbilityDemoUrl("https://yougi.wodeapp.cn/")).toBe(true);
    expect(isOfficialAbilityDemoUrl("https://my-video.wodeapp.cn")).toBe(false);

    const owned = findWodeAppBuiltinAgent("video-generation", [{
      id: "video-generation",
      kind: "video",
      slug: "my-video",
      subdomain: "my-video",
      launchUrl: "https://my-video.wodeapp.cn",
      url: "https://my-video.wodeapp.cn",
      projectId: "p-owned",
      name: "视频生成",
    }], { preferLocal: false, profile: "cloud", origin: "https://wodeapp.cn" });
    expect(owned?.demoUrl).toBe("https://my-video.wodeapp.cn");

    const localKeysWhileLoggedIn = findWodeAppBuiltinAgent("visual-generation", [{
      id: "visual-generation",
      kind: "image",
      slug: "xn--wcso1x15mhvc",
      subdomain: "xn--wcso1x15mhvc",
      launchUrl: "https://xn--wcso1x15mhvc.wodeapp.cn",
      url: "https://xn--wcso1x15mhvc.wodeapp.cn",
      projectId: "p-cloud-image",
      name: "图片生成",
    }], { hasLocalKeys: true, profile: "cloud", origin: "https://wodeapp.cn" });
    expect(localKeysWhileLoggedIn?.demoUrl).toBe("https://xn--wcso1x15mhvc.wodeapp.cn");

    const officialStored = findWodeAppBuiltinAgent("video-generation", [{
      id: "video-generation",
      kind: "video",
      slug: "my-video",
      subdomain: "my-video",
      launchUrl: "https://ai.wodeapp.cn/video",
      url: "https://ai.wodeapp.cn/video",
      projectId: "p-owned",
      name: "视频生成",
    }], { preferLocal: false, origin: "https://wodeapp.cn" });
    expect(officialStored?.demoUrl).toBe("https://my-video.wodeapp.cn");

    const localUnsigned = findWodeAppBuiltinAgent("video-generation", [], { preferLocal: true });
    expect(localUnsigned?.demoUrl).toBe("http://localhost:5176/?project=video-generation");

    const rewritten = localizeAbilityProjects([{
      id: "video-generation",
      kind: "video",
      slug: "video-generation",
      subdomain: "video-generation",
      launchUrl: "https://ai.wodeapp.cn/video",
      url: "https://ai.wodeapp.cn/video",
      projectId: "p1",
      name: "视频生成",
    }], true);
    expect(rewritten[0]?.launchUrl).toBe("http://localhost:5176/?project=video-generation");

    const opened = findWodeAppBuiltinAgent("video-generation", rewritten, { preferLocal: true });
    expect(opened?.demoUrl).toBe("http://localhost:5176/?project=video-generation");

    setAbilityWorkbenchContext({ preferLocal: false, ossEdition: false });
  });
});
