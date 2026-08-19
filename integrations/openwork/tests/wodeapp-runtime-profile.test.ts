import { afterEach, describe, expect, test } from "bun:test";

import { WODEAPP_BRAND_AGENT_INDUSTRY_EXAMPLE, WODEAPP_BRAND_AGENT_WYNNE_EXAMPLE } from "../wodeapp/wodeapp-brand-agent-config";
import {
  WODEAPP_WYNNE_RUNTIME_PROFILE_ID,
  bindWodeAppRuntimeProfileToSession,
  buildWodeAppRuntimeProfileSystemContext,
  clearWodeAppRuntimeProfileForSession,
  findWodeAppRuntimeProfile,
  listWodeAppRuntimeProfiles,
  readWodeAppRuntimeProfileForSession,
  setWodeAppRuntimeProfilesFromBrandAgents,
  resolveOpenCodePromptAgent,
  wodeAppRuntimeProfileAgentId,
  __testing,
} from "../wodeapp/wodeapp-runtime-profile";

afterEach(() => {
  __testing.reset();
});

describe("WodeApp runtime profiles", () => {
  test("binds a configured brand profile to a real conversation without embedding knowledge", () => {
    setWodeAppRuntimeProfilesFromBrandAgents([WODEAPP_BRAND_AGENT_WYNNE_EXAMPLE]);

    expect(bindWodeAppRuntimeProfileToSession(
      "workspace-1",
      "session-1",
      WODEAPP_WYNNE_RUNTIME_PROFILE_ID,
    )).toBe(true);

    const profile = readWodeAppRuntimeProfileForSession("workspace-1", "session-1");
    expect(profile?.id).toBe(WODEAPP_WYNNE_RUNTIME_PROFILE_ID);
    expect(wodeAppRuntimeProfileAgentId(profile)).toBeUndefined();

    const context = buildWodeAppRuntimeProfileSystemContext(profile);
    expect(context).toContain('profile="wynne-brand-agent"');
    expect(context).toContain("knowledge_search");
    expect(context).toContain("only report a connector as connected after a live status tool confirms it");
    expect(context).not.toContain("128");
    expect(context).not.toContain("Avery");
  });

  test("uses the normal selected agent when no runtime profile is active", () => {
    expect(wodeAppRuntimeProfileAgentId(null)).toBeUndefined();
  });

  test("custom sidebar agents stay in system context and never become OpenCode agent ids", () => {
    setWodeAppRuntimeProfilesFromBrandAgents([
      {
        id: "custom-memo-helper",
        name: "备忘录助手",
        brandId: "custom",
        samplePrompt: "记下待办，打开就能查。",
        enabled: true,
      },
    ]);
    expect(bindWodeAppRuntimeProfileToSession(
      "workspace-1",
      "session-memo",
      "custom-memo-helper",
    )).toBe(true);
    const profile = readWodeAppRuntimeProfileForSession("workspace-1", "session-memo");
    expect(profile?.name).toBe("备忘录助手");
    expect(wodeAppRuntimeProfileAgentId(profile)).toBeUndefined();
    expect(resolveOpenCodePromptAgent(profile, "custom-memo-helper")).toBeUndefined();
    expect(resolveOpenCodePromptAgent(profile, "build")).toBe("build");
    const context = buildWodeAppRuntimeProfileSystemContext(profile);
    expect(context).toContain('<product_agent id="custom-memo-helper">');
    expect(context).toContain("记下待办，打开就能查。");
  });

  test("selected custom agent uses its published project as the identity base", () => {
    setWodeAppRuntimeProfilesFromBrandAgents([
      {
        id: "custom-memo-helper",
        name: "备忘录助手",
        brandId: "custom",
        samplePrompt: "记下待办，打开就能查。",
        projectId: "97c47826-2361-41f3-becd-c0a626042b3b",
        launchUrl: "https://xn--7frz1mmxf7oa71h.wodeapp.cn",
        enabled: true,
      },
    ]);
    bindWodeAppRuntimeProfileToSession("workspace-1", "session-memo", "custom-memo-helper");
    const context = buildWodeAppRuntimeProfileSystemContext(
      readWodeAppRuntimeProfileForSession("workspace-1", "session-memo"),
    );
    expect(context).toContain('<product_agent id="custom-memo-helper">');
    expect(context).toContain("备忘录助手");
    expect(context).toContain("记下待办，打开就能查。");
    expect(context).toContain("这个智能体的项目：https://xn--7frz1mmxf7oa71h.wodeapp.cn");
    expect(context).toContain("projectId：97c47826-2361-41f3-becd-c0a626042b3b");
    expect(context).not.toContain("添加 xxx");
    expect(context).not.toContain("禁止再建");
    expect(context).not.toContain("禁止 create_project");
  });

  test("binds product agents for later turns without passing them as OpenCode agent ids", () => {
    setWodeAppRuntimeProfilesFromBrandAgents([]);
    expect(bindWodeAppRuntimeProfileToSession(
      "workspace-1",
      "session-image",
      "visual-generation",
    )).toBe(true);
    const profile = readWodeAppRuntimeProfileForSession("workspace-1", "session-image");
    expect(profile?.name).toBe("图片智能体");
    expect(wodeAppRuntimeProfileAgentId(profile)).toBeUndefined();
    const context = buildWodeAppRuntimeProfileSystemContext(profile);
    expect(context).toContain('<product_agent id="visual-generation">');
    expect(context).toContain("wodeapp_batch_image_prepare");
    expect(context).not.toContain("knowledge_search");
  });

  test("fails closed for unknown profiles", () => {
    expect(findWodeAppRuntimeProfile("unknown-profile")).toBeNull();
    expect(bindWodeAppRuntimeProfileToSession("workspace-1", "session-1", "unknown-profile")).toBe(false);
  });

  test("exposes beauty pack profile by default and clears a session binding", () => {
    setWodeAppRuntimeProfilesFromBrandAgents([]);
    const shippedIds = listWodeAppRuntimeProfiles().map((profile) => profile.id);
    expect(shippedIds).toContain("beauty-industry-agent");
    expect(shippedIds).toContain("visual-generation");
    expect(shippedIds).toContain("video-generation");
    expect(shippedIds).not.toContain("home-textile-industry-agent");
    expect(shippedIds).not.toContain(WODEAPP_WYNNE_RUNTIME_PROFILE_ID);

    const beauty = findWodeAppRuntimeProfile("beauty-industry-agent");
    expect(beauty?.identity).toContain("美妆");
    expect(beauty?.recommendedSkills).toContain("wodeappx-beauty-industry");

    setWodeAppRuntimeProfilesFromBrandAgents([WODEAPP_BRAND_AGENT_WYNNE_EXAMPLE]);
    expect(listWodeAppRuntimeProfiles().map((profile) => profile.id))
      .toContain(WODEAPP_WYNNE_RUNTIME_PROFILE_ID);

    bindWodeAppRuntimeProfileToSession("workspace-1", "session-1", WODEAPP_WYNNE_RUNTIME_PROFILE_ID);
    expect(clearWodeAppRuntimeProfileForSession("workspace-1", "session-1")).toBe(true);
    expect(readWodeAppRuntimeProfileForSession("workspace-1", "session-1")).toBeNull();
  });

  test("registers Layer1 brand profile alongside beauty pack profile", () => {
    setWodeAppRuntimeProfilesFromBrandAgents([
      WODEAPP_BRAND_AGENT_INDUSTRY_EXAMPLE,
      WODEAPP_BRAND_AGENT_WYNNE_EXAMPLE,
    ]);
    const ids = listWodeAppRuntimeProfiles().map((profile) => profile.id);
    expect(ids).toContain("beauty-industry-agent");
    expect(ids).toContain("outdoor-gear-industry-agent");
    expect(ids).toContain(WODEAPP_WYNNE_RUNTIME_PROFILE_ID);

    expect(bindWodeAppRuntimeProfileToSession(
      "workspace-1",
      "session-industry",
      "outdoor-gear-industry-agent",
    )).toBe(true);
    const profile = readWodeAppRuntimeProfileForSession("workspace-1", "session-industry");
    expect(profile?.brandId).toBe("outdoor-gear");
    const context = buildWodeAppRuntimeProfileSystemContext(profile);
    expect(context).toContain('profile="outdoor-gear-industry-agent"');
    expect(context).toContain("knowledge_search");
  });
});
