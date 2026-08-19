import { afterEach, describe, expect, test } from "bun:test";

import {
  applyCustomAgentHome,
  buildCustomAgentHomeContract,
  extractPublishedProjectFromMessages,
  extractPublishedProjectFromText,
  inferCustomAgentDraftFromText,
  rememberCustomAgentCreateSession,
  readCustomAgentIdForCreateSession,
  __testing,
} from "../wodeapp/wodeapp-custom-agent-home";

afterEach(() => {
  __testing.resetCreateSessions();
});

describe("custom agent home", () => {
  test("create session remembers which custom agent is being materialized", () => {
    rememberCustomAgentCreateSession("ses_create_1", "custom-memo-helper");
    expect(readCustomAgentIdForCreateSession("ses_create_1")).toBe("custom-memo-helper");
    expect(readCustomAgentIdForCreateSession("ses_other")).toBeNull();
  });

  test("infers PH 管理 from a freeform 生成智能体 prompt", () => {
    expect(inferCustomAgentDraftFromText("生成一个 ph 管理智能体，用 wodeappx chrome 插件操作")).toEqual({
      name: "PH 管理",
      meta: "生成一个 ph 管理智能体，用 wodeappx chrome 插件操作",
    });
  });

  test("infers 竞品观察 from the add-agent guide 名称 field", () => {
    expect(inferCustomAgentDraftFromText([
      "我想创建一个智能体。",
      "",
      "名称：竞品观察",
      "它要帮我做什么：做一个很短的竞品观察看板。",
    ].join("\n"))).toEqual({
      name: "竞品观察",
      meta: "我想创建一个智能体",
    });
  });

  test("scrapes short REST project ids and punycode site urls", () => {
    expect(extractPublishedProjectFromText(
      "项目 ID：80d37c53 已发布 https://xn--vxup8bh7b382a-2.wodeapp.cn",
    )).toEqual({
      projectId: "80d37c53",
      launchUrl: "https://xn--vxup8bh7b382a-2.wodeapp.cn",
    });
    expect(extractPublishedProjectFromText(JSON.stringify({
      ok: true,
      id: "80d37c53",
      url: "https://xn--vxup8bh7b382a-2.wodeapp.cn",
    }))).toEqual({
      projectId: "80d37c53",
      launchUrl: "https://xn--vxup8bh7b382a-2.wodeapp.cn",
    });
  });

  test("scrapes the published project from create/publish tool output", () => {
    expect(extractPublishedProjectFromText(JSON.stringify({
      ok: true,
      projectId: "97c47826-2361-41f3-becd-c0a626042b3b",
      slug: "xn--7frz1mmxf7oa71h",
      url: "https://xn--7frz1mmxf7oa71h.wodeapp.cn",
    }))).toEqual({
      projectId: "97c47826-2361-41f3-becd-c0a626042b3b",
      launchUrl: "https://xn--7frz1mmxf7oa71h.wodeapp.cn",
    });
    expect(extractPublishedProjectFromMessages([
      {
        role: "assistant",
        parts: [{
          type: "tool",
          tool: "create_project",
          state: {
            output: {
              projectId: "97c47826-2361-41f3-becd-c0a626042b3b",
              slug: "xn--7frz1mmxf7oa71h",
            },
          },
        }],
      },
    ])).toEqual({
      projectId: "97c47826-2361-41f3-becd-c0a626042b3b",
      launchUrl: "https://xn--7frz1mmxf7oa71h.wodeapp.cn",
    });
  });

  test("PH 管理 matches an existing Product Hunt custom pin", () => {
    const matched = __testing.matchExistingCustomAgent([
      { id: "custom-memo-helper", name: "备忘录助手", brandId: "custom", enabled: true },
      { id: "ph-manager", name: "Product Hunt 管理", brandId: "custom", enabled: true },
    ], { name: "PH 管理" });
    expect(matched?.id).toBe("ph-manager");
  });

  test("identity contract is the agent plus its project, not a command patch", () => {
    const contract = buildCustomAgentHomeContract({
      meta: "记下待办，打开就能查。",
      projectId: "97c47826-2361-41f3-becd-c0a626042b3b",
      launchUrl: "https://xn--7frz1mmxf7oa71h.wodeapp.cn",
    });
    expect(contract).toContain("记下待办，打开就能查。");
    expect(contract).toContain("这个智能体的项目：https://xn--7frz1mmxf7oa71h.wodeapp.cn");
    expect(contract).toContain("projectId：97c47826-2361-41f3-becd-c0a626042b3b");
    expect(contract).not.toContain("添加");
    expect(contract).not.toContain("禁止");
    expect(applyCustomAgentHome(
      { id: "custom-memo-helper" },
      { projectId: "97c47826-2361-41f3-becd-c0a626042b3b" },
    )).toEqual({
      id: "custom-memo-helper",
      projectId: "97c47826-2361-41f3-becd-c0a626042b3b",
    });
  });
});
