import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { findWodeAppBuiltinAgent, getVisibleWodeAppBuiltinAgents, listWodeAppComposerAgents } from "../wodeapp/runtime-projects";
import {
  applyAgentProfileEdit,
  applySidebarAgentOrder,
  buildAddAgentGuideText,
  buildCustomBrandAgent,
  buildCustomCreateAgentDisplayText,
  buildSkillBrandAgent,
  formatSidebarSkillCopy,
  isExcludedSidebarBrandAgent,
  isSidebarBrandPin,
  mergeDiskBrandAgentsWithLocalPins,
  normalizeWodeAppAgentsOverride,
  parseGitSkillRepo,
  resolveOfficialSkillPin,
  resolveSidebarAgentId,
} from "../wodeapp/wodeapp-sidebar-agents";

describe("sidebar agent pins", () => {
  test("composer picker lists sidebar agents and keeps build", () => {
    const names = listWodeAppComposerAgents([
      { name: "build", description: "execute", mode: "primary" },
      { name: "wynne-brand-agent", description: "brand", mode: "primary" },
      { name: "supor-brand-agent", description: "brand", mode: "primary" },
      { name: "beauty-industry-agent", description: "beauty", mode: "primary" },
      { name: "hidden-sub", mode: "subagent" },
    ], {
      override: { version: 1, extraEnabledIds: [], hiddenIds: [], order: [] },
      brandAgents: [],
    }).map((agent) => agent.name);
    expect(names).toEqual([
      "visual-generation",
      "video-generation",
      "multi-agent-collab",
      "build",
    ]);
  });

  test("default visible set is image / video / multi-model", () => {
    const ids = getVisibleWodeAppBuiltinAgents({
      override: { version: 1, extraEnabledIds: [], hiddenIds: [], order: [] },
    }).map((agent) => agent.id);
    expect(ids).toEqual(["visual-generation", "video-generation", "multi-agent-collab"]);
  });

  test("parses github urls and owner/repo", () => {
    expect(parseGitSkillRepo("anthropics/skills")).toEqual({
      owner: "anthropics",
      repo: "skills",
      ref: "main",
      label: "自定义",
    });
    expect(parseGitSkillRepo("https://github.com/anthropics/skills.git")?.repo).toBe("skills");
    expect(parseGitSkillRepo("not a repo")).toBeNull();
  });

  test("keeps wynne and supor out of default sidebar pins", () => {
    expect(isExcludedSidebarBrandAgent({
      id: "wynne-brand-agent",
      brandId: "wynne",
      name: "Wynne 品牌智能体",
    })).toBe(true);
    expect(isExcludedSidebarBrandAgent({
      id: "supor-detail",
      brandId: "custom",
      name: "苏泊尔智能体",
    })).toBe(true);
    expect(isSidebarBrandPin({
      id: "skill-local-notes",
      brandId: "skill",
      name: "本地笔记",
    })).toBe(true);
    expect(isSidebarBrandPin({
      id: "custom-research-notes",
      brandId: "custom",
      name: "Research Notes",
    })).toBe(true);
  });

  test("disk hydrate keeps local custom pins", () => {
    const merged = mergeDiskBrandAgentsWithLocalPins(
      [{ id: "wynne-brand-agent", brandId: "wynne", name: "Wynne" }],
      [
        { id: "wynne-brand-agent", brandId: "wynne", name: "Wynne" },
        { id: "custom-memo-helper", brandId: "custom", name: "备忘录助手" },
      ],
    );
    expect(merged.map((item) => item.id)).toEqual([
      "wynne-brand-agent",
      "custom-memo-helper",
    ]);
  });

  test("disk hydrate keeps a local custom agent's published project", () => {
    const merged = mergeDiskBrandAgentsWithLocalPins(
      [{ id: "custom-memo-helper", brandId: "custom", name: "备忘录助手" }],
      [{
        id: "custom-memo-helper",
        brandId: "custom",
        name: "备忘录助手",
        projectId: "97c47826-2361-41f3-becd-c0a626042b3b",
        launchUrl: "https://xn--7frz1mmxf7oa71h.wodeapp.cn",
      }],
    );
    expect(merged[0]?.projectId).toBe("97c47826-2361-41f3-becd-c0a626042b3b");
    expect(merged[0]?.launchUrl).toBe("https://xn--7frz1mmxf7oa71h.wodeapp.cn");
  });

  test("custom create-agent prompt fills name and guidance", () => {
    expect(buildCustomCreateAgentDisplayText({ name: "  " })).toBeNull();
    expect(buildCustomCreateAgentDisplayText({
      name: "调研助手",
      meta: "整理资料",
      guidance: "每周汇总竞品价格和卖点",
    })).toBe([
      "我想创建一个智能体应用，名称是「调研助手」。",
      "简介：整理资料",
      "用途是：",
      "每周汇总竞品价格和卖点",
    ].join("\n"));
  });

  test("builds skill and custom brand agents without reserved ids", () => {
    const skill = buildSkillBrandAgent({ name: "图片智能体", description: "出图" });
    expect(skill?.id.startsWith("skill-")).toBe(true);
    expect(skill?.brandId).toBe("skill");
    const custom = buildCustomBrandAgent({ name: "Research Notes", meta: "整理资料", entryPrompt: "帮我调研" });
    expect(custom?.id).toBe("custom-research-notes");
    expect(custom?.name).toBe("Research Notes");
    const withHome = buildCustomBrandAgent({
      name: "PH 管理",
      projectId: "80d37c53",
      launchUrl: "https://xn--vxup8bh7b382a-2.wodeapp.cn",
    });
    expect(withHome?.projectId).toBe("80d37c53");
    expect(withHome?.launchUrl).toBe("https://xn--vxup8bh7b382a-2.wodeapp.cn");
    expect(resolveSidebarAgentId("visual-generation")).not.toBe("visual-generation");
  });

  test("maps short-drama factory skill to official agent copy", () => {
    expect(resolveOfficialSkillPin("wodeapp-short-drama-factory")?.agentId).toBe("script-storyboard");
    expect(resolveOfficialSkillPin("skill-wodeapp-short-drama-factory")?.name).toBe("短剧智能体");
    expect(buildSkillBrandAgent({
      name: "wodeapp-short-drama-factory",
      description: "End-to-end WodeApp short-drama (竖屏短剧) production pipeline.",
    })).toBeNull();
    expect(formatSidebarSkillCopy({
      name: "wodeapp-short-drama-factory",
      description: "End-to-end WodeApp short-drama (竖屏短剧) production pipeline. Use ONLY when the use",
    })).toEqual({
      name: "短剧智能体",
      meta: "剧本 · 分镜 · 可拍摄脚本",
    });
    expect(formatSidebarSkillCopy({
      name: "local-notes",
      description: "End-to-end English only skill description without enough Chinese.",
    })).toEqual({
      name: "local notes",
      meta: "已安装技能",
    });
    const shortDrama = findWodeAppBuiltinAgent("script-storyboard", []);
    expect(shortDrama?.abilityKind).toBeUndefined();
    expect(shortDrama?.defaultUrl).toBeUndefined();
  });

  test("normalizes override and keeps sidebar order", () => {
    const file = normalizeWodeAppAgentsOverride({
      version: 1,
      extraEnabledIds: ["script-storyboard", "script-storyboard", "nope"],
      hiddenIds: ["visual-generation"],
      order: ["video-generation", "multi-agent-collab"],
    });
    expect(file.extraEnabledIds).toEqual(["script-storyboard"]);
    expect(file.hiddenIds).toEqual(["visual-generation"]);
    expect(file.profiles).toEqual({});
    expect(applySidebarAgentOrder(
      [{ id: "a" }, { id: "b" }, { id: "c" }],
      ["c", "a"],
    ).map((item) => item.id)).toEqual(["c", "a", "b"]);
  });

  test("profile edits keep name and description on the override", () => {
    const file = normalizeWodeAppAgentsOverride({
      version: 1,
      profiles: {
        "video-generation": { name: "杯子视频", description: "只做马克杯分镜" },
        "Bad Id": { name: "坏 id" },
      },
    });
    expect(file.profiles).toEqual({
      "video-generation": { name: "杯子视频", description: "只做马克杯分镜" },
    });
    expect(applyAgentProfileEdit({ id: "video-generation", name: "视频智能体" }, file).name).toBe("杯子视频");
  });

  test("add-agent starts a guided conversation instead of a picker dialog", () => {
    expect(buildAddAgentGuideText()).toContain("我想创建一个智能体");
    expect(buildAddAgentGuideText()).toContain("名称：");
    expect(buildAddAgentGuideText()).toContain("如果需要对应站点");
    const source = readFileSync(new URL("../wodeapp/wodeapp-workbench-sidebar.tsx", import.meta.url), "utf8");
    expect(source).toContain("startAddAgentConversation");
    expect(source).toContain("buildAddAgentGuideText");
    expect(source).toContain("autoSend: false");
    expect(source).not.toContain("WodeAppAddAgentDialog");
    expect(source).not.toContain("setAddAgentOpen(true)");
  });

  test("sidebar agent rows are title-only and do not highlight the agents header", () => {
    const source = readFileSync(new URL("../wodeapp/wodeapp-workbench-sidebar.tsx", import.meta.url), "utf8");
    expect(source).toContain("{agent.name}");
    expect(source).not.toContain("{agent.meta}");
    expect(source).toContain('id !== "agents" && props.activeSurface === id');
  });
});
