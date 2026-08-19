import { describe, expect, test } from "bun:test";

import { findWodeAppBuiltinAgent } from "../wodeapp/runtime-projects";
import { buildAgentProfile, buildAgentProfilePrompt } from "../wodeapp/wodeapp-agent-knowledge";
import { buildBuiltinAgentTask } from "../wodeapp/wodeapp-auto-orchestration";

describe("agent profile", () => {
  test("video description is the tool catalog, not a second write-up", () => {
    const agent = findWodeAppBuiltinAgent("video-generation", []);
    const profile = buildAgentProfile(agent!, [{
      id: "video-generation",
      kind: "video",
      title: "视频生成",
      url: "https://example.wodeapp.cn/video",
      launchUrl: "https://example.wodeapp.cn/video",
    }], false);
    expect(profile.title).toBe("视频智能体");
    expect(agent!.tools).toContain("wodeapp.video.generate");
    expect(profile.description).toContain("默认只整理方案，不自动生成。");
    expect(profile.description).toContain("单条视频生成（wodeapp.video.generate）");
    expect(profile.description).toContain("必填 prompt");
    expect(profile.description).toContain("首尾帧运镜");
    expect(profile.description).toContain("wodeapp_video_storyboard_open");
    expect(profile.description).toContain('groups: [{id:"ep-1",title:"第1集"}');
    expect(profile.description).toContain("已开通对应项目「视频生成」");
    expect(profile.description.startsWith("短视频 · 图生视频")).toBe(false);
  });

  test("short-drama description keeps the factory skill and chat-only project", () => {
    const agent = findWodeAppBuiltinAgent("script-storyboard", []);
    const profile = buildAgentProfile(agent!, [], false);
    expect(profile.description).toContain("wodeapp-short-drama-factory");
    expect(profile.description).toContain("无专属云项目，在当前对话完成");
    expect(profile.description.match(/wodeapp-short-drama-factory/g)?.length).toBe(1);
  });

  test("using an agent sends the same profile once", () => {
    const agent = findWodeAppBuiltinAgent("script-storyboard", []);
    const profile = buildAgentProfilePrompt(agent!, [], false);
    const task = buildBuiltinAgentTask(agent!, { projects: [], autoSend: false });
    expect(task.agentMessage).toBe(profile);
    expect(task.agentMessage).toContain(agent!.samplePrompt.trim());
  });

  test("custom agent profile names its published project", () => {
    const agent = findWodeAppBuiltinAgent("custom-memo-helper", [], {
      brandAgents: [{
        id: "custom-memo-helper",
        name: "备忘录助手",
        brandId: "custom",
        meta: "记下待办，打开就能查。",
        launchUrl: "https://xn--7frz1mmxf7oa71h.wodeapp.cn",
        enabled: true,
      }],
    });
    expect(agent?.demoUrl).toBe("https://xn--7frz1mmxf7oa71h.wodeapp.cn");
    const profile = buildAgentProfile(agent!, [], false);
    expect(profile.title).toBe("备忘录助手");
    expect(profile.description).toContain("已开通对应项目 https://xn--7frz1mmxf7oa71h.wodeapp.cn");
    expect(profile.description).not.toContain("无专属云项目");
  });

  test("custom agent profile still names the published project after a local edit", () => {
    const agent = findWodeAppBuiltinAgent("custom-memo-helper", [], {
      brandAgents: [{
        id: "custom-memo-helper",
        name: "备忘录助手",
        brandId: "custom",
        meta: "记下待办，打开就能查。",
        launchUrl: "https://xn--7frz1mmxf7oa71h.wodeapp.cn",
        enabled: true,
      }],
    });
    const profile = buildAgentProfile(agent!, [], false, {
      version: 1,
      extraEnabledIds: [],
      hiddenIds: [],
      order: [],
      profiles: {
        "custom-memo-helper": { name: "备忘录助手", description: "记下待办。" },
      },
    });
    expect(profile.description).toContain("记下待办。");
    expect(profile.description).toContain("已开通对应项目 https://xn--7frz1mmxf7oa71h.wodeapp.cn");
  });

  test("saved profile edit replaces title and description", () => {
    const agent = findWodeAppBuiltinAgent("video-generation", []);
    const profile = buildAgentProfile(agent!, [], false, {
      version: 1,
      extraEnabledIds: [],
      hiddenIds: [],
      order: [],
      profiles: {
        "video-generation": { name: "杯子视频", description: "只做马克杯分镜，不要自动生成。" },
      },
    });
    expect(profile.title).toBe("杯子视频");
    expect(profile.description).toBe("只做马克杯分镜，不要自动生成。");
  });

  test("video profile prompt includes tool call catalog", () => {
    const agent = findWodeAppBuiltinAgent("video-generation", []);
    const prompt = buildAgentProfilePrompt(agent!, [], false);
    const task = buildBuiltinAgentTask(agent!, { projects: [], autoSend: false });
    expect(prompt).toContain("你是「视频智能体」");
    expect(prompt).toContain("必填 prompt");
    expect(prompt).toContain("必填 scenes");
    expect(prompt).toContain("必填 shareDocId");
    expect(prompt).toContain("wodeapp_image_asset_save");
    expect(task.agentMessage).toBe(prompt);
    expect(task.agentMessage).not.toContain("【WodeApp — 编排】");
  });
});
