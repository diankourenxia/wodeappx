import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { buildBuiltinAgentTask } from "../wodeapp/wodeapp-auto-orchestration";
import {
  firstPromptForHandbook,
  listBuiltinAgentsWithWorkbench,
  listEnabledWodeAppBuiltinAgentConfigs,
  OFFICIAL_AGENT_HANDBOOK_IDS,
  officialAgentHandbookRelPath,
  parseAgentHandbookFrontmatter,
  resolveAgentHandbookRef,
  userAgentHandbookRelPath,
  WODEAPP_SHIPPED_BUILTIN_AGENTS_FILE,
} from "../wodeapp/wodeapp-builtin-agents-config";

const repoRoot = resolve(import.meta.dir, "../../..");

function readOfficial(id: string): string {
  return readFileSync(resolve(repoRoot, officialAgentHandbookRelPath(id)), "utf8");
}

describe("agent handbook (docs/agents)", () => {
  test("image and video official handbooks match Layer0 id + name", () => {
    expect([...OFFICIAL_AGENT_HANDBOOK_IDS]).toEqual(["visual-generation", "video-generation"]);
    for (const id of OFFICIAL_AGENT_HANDBOOK_IDS) {
      const agent = WODEAPP_SHIPPED_BUILTIN_AGENTS_FILE.agents.find((item) => item.id === id);
      expect(agent).toBeTruthy();
      const text = readOfficial(id);
      const fm = parseAgentHandbookFrontmatter(text);
      expect(fm).toEqual({ id, name: agent!.name });
      expect(text).toContain("## 目标和约束");
      expect(text).toContain("## 仓库资源");
      expect(text).toContain("## 使用示例");
      expect(text).not.toMatch(/sk-|api[_-]?key|token|cookie/i);
    }
  });

  test("missing frontmatter field means handbook is absent; JSON still lists the agent", () => {
    const ref = resolveAgentHandbookRef({
      id: "script-storyboard",
      officialText: "# 短剧\n\n## 目标和约束\n",
    });
    expect(ref).toBeNull();
    expect(listEnabledWodeAppBuiltinAgentConfigs().some((item) => item.id === "script-storyboard")).toBe(true);
  });

  test("user handbook overrides official for the same id", () => {
    const id = "visual-generation";
    const official = readOfficial(id);
    const user = "---\nid: visual-generation\nname: 图片智能体\n---\n\n# 用户覆盖\n\n## 目标和约束\n\n## 仓库资源\n\n## 使用示例\n";
    const ref = resolveAgentHandbookRef({ id, officialText: official, userText: user });
    expect(ref).toEqual({
      path: userAgentHandbookRelPath(id),
      source: "user",
      id,
      name: "图片智能体",
    });
  });

  test("sidebar first prompt and agent message share the same handbook path", () => {
    const image = listEnabledWodeAppBuiltinAgentConfigs().find((item) => item.id === "visual-generation");
    expect(image).toBeTruthy();
    const task = buildBuiltinAgentTask({
      ...image!,
      kind: "capability",
    });
    const path = officialAgentHandbookRelPath("visual-generation");
    expect(task.displayText).toBe(`阅读 ${path}，按手册工作。`);
    expect(task.agentMessage).toContain(`手册：${path}`);
    expect(firstPromptForHandbook(resolveAgentHandbookRef({ id: "visual-generation" }))).toBe(task.displayText);
  });

  test("lists shipped agents and image/video can open a workbench", () => {
    const rows = listBuiltinAgentsWithWorkbench();
    const enabled = listEnabledWodeAppBuiltinAgentConfigs();
    expect(rows.map((item) => item.id)).toEqual(enabled.map((item) => item.id));
    const image = rows.find((item) => item.id === "visual-generation");
    const video = rows.find((item) => item.id === "video-generation");
    expect(image?.canOpenWorkbench).toBe(true);
    expect(video?.canOpenWorkbench).toBe(true);
    expect(image?.defaultUrl).toBeTruthy();
    expect(video?.defaultUrl).toBeTruthy();
    expect(image?.handbookPath).toBe(officialAgentHandbookRelPath("visual-generation"));
    expect(video?.handbookPath).toBe(officialAgentHandbookRelPath("video-generation"));
  });

  test("Layer0 JSON still has no skills/sites/path/outputs/packVersion", () => {
    for (const agent of WODEAPP_SHIPPED_BUILTIN_AGENTS_FILE.agents) {
      expect(agent).not.toHaveProperty("skills");
      expect(agent).not.toHaveProperty("sites");
      expect(agent).not.toHaveProperty("path");
      expect(agent).not.toHaveProperty("outputs");
      expect(agent).not.toHaveProperty("packVersion");
    }
  });
});
