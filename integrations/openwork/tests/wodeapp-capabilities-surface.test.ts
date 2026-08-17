import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import { WODEAPP_NAV_ITEMS } from "../wodeapp/wodeapp-types";
import { buildWodeAppHubSkillsPath } from "../wodeapp/wodeapp-automation-client";

function existingSourceUrl(...relativeCandidates: string[]): URL {
  for (const relativePath of relativeCandidates) {
    const candidate = new URL(relativePath, import.meta.url);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Unable to locate source file: ${relativeCandidates.join(", ")}`);
}

const surfacePagesUrl = existingSourceUrl(
  "../wodeapp/wodeapp-surface-pages.tsx",
  "../src/react-app/domains/wodeapp/wodeapp-surface-pages.tsx",
);
const sidebarUrl = existingSourceUrl(
  "../wodeapp/wodeapp-workbench-sidebar.tsx",
  "../src/react-app/domains/wodeapp/wodeapp-workbench-sidebar.tsx",
);
const capabilitiesSurfaceUrl = existingSourceUrl(
  "../wodeapp/wodeapp-capabilities-surface.tsx",
  "../src/react-app/domains/wodeapp/wodeapp-capabilities-surface.tsx",
);

describe("WodeAppX capabilities surface (能力中心)", () => {
  test("nav registers 能力中心 right after 自动任务", () => {
    const ids = WODEAPP_NAV_ITEMS.map((item) => item.id);
    expect(ids).toContain("capabilities");
    expect(ids.indexOf("capabilities")).toBe(ids.indexOf("schedule") + 1);
    const entry = WODEAPP_NAV_ITEMS.find((item) => item.id === "capabilities");
    expect(entry?.label).toBe("能力中心");
  });

  test("surface router renders the capabilities page", async () => {
    const source = await readFile(surfacePagesUrl, "utf8");
    expect(source).toContain('import { WodeAppCapabilitiesSurface } from "./wodeapp-capabilities-surface"');
    expect(source).toContain('case "capabilities":');
    expect(source).toContain("return <WodeAppCapabilitiesSurface />;");
  });

  test("sidebar has a nav icon for capabilities", async () => {
    const source = await readFile(sidebarUrl, "utf8");
    expect(source).toMatch(/capabilities:\s*LayoutGrid/);
  });

  test("skills tab wires online hub: default repos, install, uninstall, search", async () => {
    const source = await readFile(capabilitiesSurfaceUrl, "utf8");
    // 默认技能仓库不挂 OpenWork 官方 hub
    expect(source).not.toContain("openwork-hub");
    expect(source).not.toContain("OpenWork 官方");
    expect(source).toContain("anthropics");
    // 接本地服务 skills 客户端
    expect(source).toContain("automations.skills.listInstalled");
    expect(source).toContain("automations.skills.listHub");
    expect(source).toContain("automations.skills.install");
    expect(source).toContain("automations.skills.uninstall");
    // 搜索与两个 MVP Tab
    expect(source).toContain("工具·技能");
    expect(source).toContain("自定义广场");
    expect(source).toContain("推送渠道");
    expect(source).toContain("WodeAppPlazaSection");
    expect(source).toContain("搜索能力");
    // 已安装 / 线上技能 两区
    expect(source).toContain("已安装（");
    expect(source).toContain("线上技能");
    // 服务未连接时的降级提示
    expect(source).toContain("本地服务正在连接");
    // 立即使用 = 新建对话并预填
    expect(source).toContain("onCreateTaskWithPrompt");
    expect(source).toContain("使用技能：");
  });

  test("plaza tab can upload agents and skins", async () => {
    const plazaUrl = existingSourceUrl(
      "../wodeapp/wodeapp-plaza-section.tsx",
      "../src/react-app/domains/wodeapp/wodeapp-plaza-section.tsx",
    );
    const source = await readFile(plazaUrl, "utf8");
    expect(source).toContain("上传包");
    expect(source).toContain("发布到广场");
    expect(source).toContain("parsePlazaUpload");
    expect(source).toContain("publishAgentToPlaza");
    expect(source).toContain("publishSkinToPlaza");
    expect(source).toContain("storeWodeAppSkin");
    expect(source).toContain("saveWodeAppBrandAgents");
    expect(source).toContain("listWodeAppPlazaCatalog");
    expect(source).toContain("saveWodeAppPlazaCatalog");
  });

  test("connectors section includes the Chrome browser extension connector", async () => {
    const connectorsUrl = existingSourceUrl(
      "../wodeapp/wodeapp-connectors-surface.tsx",
      "../src/react-app/domains/wodeapp/wodeapp-connectors-surface.tsx",
    );
    const source = await readFile(connectorsUrl, "utf8");
    // Chrome 扩展连接器卡片：一键安装/自检入口 + 桥接健康轮询
    expect(source).toContain("Chrome 浏览器控制");
    expect(source).toContain("一键安装");
    expect(source).toContain("一键自检");
    expect(source).toContain("/health");
    expect(source).toContain("?autorun=1");
    expect(source).toContain("openDesktopUrl");
    expect(source).toContain("tone-chrome");
  });
});

describe("buildWodeAppHubSkillsPath", () => {
  test("builds repo-scoped hub query", () => {
    expect(buildWodeAppHubSkillsPath({ owner: "anthropics", repo: "skills", ref: "main" })).toBe(
      "/hub/skills?owner=anthropics&repo=skills&ref=main",
    );
  });

  test("falls back to bare path without repo (server default repo)", () => {
    expect(buildWodeAppHubSkillsPath()).toBe("/hub/skills");
    expect(buildWodeAppHubSkillsPath({ owner: " ", repo: "", ref: "" })).toBe("/hub/skills");
  });

  test("trims and encodes repo parts", () => {
    expect(buildWodeAppHubSkillsPath({ owner: " different-ai ", repo: "openwork-hub", ref: "main" })).toBe(
      "/hub/skills?owner=different-ai&repo=openwork-hub&ref=main",
    );
  });
});
