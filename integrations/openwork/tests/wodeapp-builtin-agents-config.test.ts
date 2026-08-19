import { describe, expect, test } from "bun:test";

import {
  listEnabledWodeAppBuiltinAgentConfigs,
  listShippedBuiltinAgentIds,
  normalizeWodeAppBuiltinAgentsFile,
  WODEAPP_SHIPPED_BUILTIN_AGENTS_FILE,
} from "../wodeapp/wodeapp-builtin-agents-config";
import {
  getVisibleWodeAppBuiltinAgents,
  WODEAPP_BUILTIN_AGENTS,
} from "../wodeapp/runtime-projects";

describe("builtin-agents default config (Layer 0)", () => {
  test("defaults to image / video / multi-model", () => {
    expect(WODEAPP_SHIPPED_BUILTIN_AGENTS_FILE.version).toBe(1);
    const agents = listEnabledWodeAppBuiltinAgentConfigs();
    expect(agents.map((agent) => agent.id).sort()).toEqual([
      "multi-agent-collab",
      "video-generation",
      "visual-generation",
    ]);
    expect(listShippedBuiltinAgentIds()).toContain("agent-infinite-canvas");
    expect(listShippedBuiltinAgentIds()).toContain("create-agent");
    expect(listShippedBuiltinAgentIds()).toContain("feishu-agent-mcp");
    expect(listShippedBuiltinAgentIds()).toContain("beauty-industry-agent");
    expect(listShippedBuiltinAgentIds()).not.toContain("wynne-brand-agent");
    expect(agents.filter((agent) => agent.kind === "industry")).toHaveLength(0);
  });

  test("industry agents are not visible in the workbench sidebar model", () => {
    expect(getVisibleWodeAppBuiltinAgents().some((agent) => agent.kind === "industry")).toBe(false);
    expect(WODEAPP_BUILTIN_AGENTS.some((agent) => agent.kind === "industry")).toBe(false);
  });

  test("runtime agents load from the shipped config file", () => {
    expect(WODEAPP_BUILTIN_AGENTS.map((agent) => agent.id)).toEqual(
      listEnabledWodeAppBuiltinAgentConfigs().map((agent) => agent.id),
    );
    const video = WODEAPP_BUILTIN_AGENTS.find((agent) => agent.id === "video-generation");
    expect(video?.name).toBe("视频智能体");
    expect(video?.defaultUrl).toBe("https://ai.wodeapp.cn/video");
    expect(video?.tools).toContain("wodeapp.video.generate");
    expect(video?.samplePrompt).toBe("默认只整理方案，不自动生成。");
  });

  test("drops invalid or duplicate entries", () => {
    const file = normalizeWodeAppBuiltinAgentsFile({
      version: 1,
      agents: [
        { id: "ok-agent", name: "OK", kind: "capability", samplePrompt: "hi" },
        { id: "ok-agent", name: "Dup", kind: "capability", samplePrompt: "dup" },
        { id: "Bad Id", name: "No", kind: "capability", samplePrompt: "x" },
        { id: "disabled", name: "Off", kind: "capability", samplePrompt: "x", enabled: false },
      ],
    });
    expect(file.agents.map((agent) => agent.id)).toEqual(["ok-agent", "disabled"]);
    expect(listEnabledWodeAppBuiltinAgentConfigs(file).map((agent) => agent.id)).toEqual(["ok-agent"]);
  });
});
