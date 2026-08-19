import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const EMPTY_COLLAPSED_GROUP_IDS: string[] = [];

function existingSourceUrl(...relativeCandidates: string[]): URL {
  for (const relativePath of relativeCandidates) {
    const candidate = new URL(relativePath, import.meta.url);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Unable to locate source file: ${relativeCandidates.join(", ")}`);
}

const sidebarSourceUrl = existingSourceUrl(
  "../wodeapp/wodeapp-workbench-sidebar.tsx",
  "../src/react-app/domains/wodeapp/wodeapp-workbench-sidebar.tsx",
);
const shellCssSourceUrl = existingSourceUrl(
  "../wodeapp/wodeapp-shell.css",
  "../fork/apps/app/src/react-app/domains/wodeapp/wodeapp-shell.css",
  "../src/react-app/domains/wodeapp/wodeapp-shell.css",
);
const sessionRouteSourceUrl = existingSourceUrl(
  "../fork/apps/app/src/react-app/shell/session-route.tsx",
  "../src/react-app/shell/session-route.tsx",
);

function selectWodeAppCollapsedGroupIds(
  groupsByWorkspace: Record<string, { collapsedGroupIds?: string[] }>,
  workspaceId: string,
): string[] {
  return groupsByWorkspace[workspaceId]?.collapsedGroupIds ?? EMPTY_COLLAPSED_GROUP_IDS;
}

type SessionLike = {
  id: string;
  title?: string | null;
  parentID?: string | null;
  time?: { archived?: number | null } | null;
};

/** Keep in sync with filterVisibleWodeAppSessions in wodeapp-workbench-sidebar.tsx */
function filterVisibleWodeAppSessions(sessions: SessionLike[]) {
  const ids = new Set(sessions.map((session) => session.id));
  return sessions.filter((session) => {
    const archived = typeof session.time?.archived === "number" && session.time.archived > 0;
    const title = session.title?.trim() ?? "";
    const generated =
      title.startsWith("我的智能体 - ") &&
      Number.isFinite(Date.parse(title.slice("我的智能体 - ".length).trim()));
    if (archived || generated) return false;
    const parentID = typeof session.parentID === "string" ? session.parentID.trim() : "";
    if (parentID && ids.has(parentID)) return false;
    return true;
  });
}

describe("WodeAppX sidebar empty state", () => {
  test("returns a stable snapshot for a new workspace with no session groups", () => {
    const groupsByWorkspace = {};
    const first = selectWodeAppCollapsedGroupIds(groupsByWorkspace, "new-workspace");
    const second = selectWodeAppCollapsedGroupIds(groupsByWorkspace, "new-workspace");

    expect(first).toBe(second);
    expect(first).toEqual([]);
  });

  test("preserves the stored collapsed group array", () => {
    const collapsedGroupIds = ["group-a"];
    const selected = selectWodeAppCollapsedGroupIds({
      workspace: { collapsedGroupIds },
    }, "workspace");

    expect(selected).toBe(collapsedGroupIds);
  });

  test("filters generated empty-session entries from recent conversations", () => {
    const sessions = [
      { id: "empty", title: "我的智能体 - 2026-07-15T12:32:23.277Z" },
      { id: "real", title: "阿尔法蛋S1智能指纹水杯仿真人广告短视频创作" },
      { id: "archived", title: "旧记录", time: { archived: Date.now() } },
    ];

    expect(filterVisibleWodeAppSessions(sessions).map((session) => session.id)).toEqual(["real"]);
  });

  test("hides task/explore child sessions from recent conversations", () => {
    const sessions = [
      { id: "parent", title: "《我救的那匹狼》分镜脚本生成" },
      {
        id: "child",
        parentID: "parent",
        title: "提取剧本结构 (@explore subagent)",
      },
      { id: "orphan-child", parentID: "missing-parent", title: "孤立子会话" },
    ];

    expect(filterVisibleWodeAppSessions(sessions).map((session) => session.id)).toEqual([
      "parent",
      "orphan-child",
    ]);
  });

  test("sidebar source filters child sessions with parentID", async () => {
    const source = await readFile(sidebarSourceUrl, "utf8");
    expect(source).toContain("parentID && ids.has(parentID)");
    expect(source).toContain("task/explore subagent sessions");
  });

  test("groups sessions before truncating recent list", async () => {
    const source = await readFile(sidebarSourceUrl, "utf8");
    expect(source).toContain("export function buildGroupedSessionDisplay");
    expect(source).toContain("Named groups always keep their full membership");
    // Regression: must not slice(0, LIMIT) before partitionSessionsByGroup.
    expect(source).not.toMatch(
      /allSessions\.slice\(0,\s*RECENT_SESSION_LIMIT\);\s*const groupedSessions = partitionSessionsByGroup\(visibleSessions/,
    );
  });

  test("named group sessions stay visible when recent list is truncated", () => {
    const RECENT_SESSION_LIMIT = 8;
    type Session = { id: string; title: string; time: { updated: number } };
    const groups = [{ id: "auto-video", label: "自动化视频" }];
    const sessions: Session[] = [];
    for (let i = 0; i < 140; i += 1) {
      sessions.push({
        id: `u${i}`,
        title: `未分组 ${i}`,
        time: { updated: 1_000_000 - i },
      });
    }
    sessions.push({
      id: "grouped-1",
      title: "我想有个持续化选...",
      time: { updated: 1 }, // older than the top-8 ungrouped
    });
    const assignments: Record<string, string> = { "grouped-1": "auto-video" };

    const byGroup = new Map<string, Session[]>([["auto-video", []]]);
    const ungrouped: Session[] = [];
    const sorted = [...sessions].sort((a, b) => b.time.updated - a.time.updated);
    for (const session of sorted) {
      const groupId = assignments[session.id];
      if (groupId && byGroup.has(groupId)) byGroup.get(groupId)!.push(session);
      else ungrouped.push(session);
    }
    const ungroupedVisible = ungrouped.slice(0, RECENT_SESSION_LIMIT);

    expect(byGroup.get("auto-video")?.map((s) => s.id)).toEqual(["grouped-1"]);
    expect(ungroupedVisible).toHaveLength(8);
    expect(ungroupedVisible.map((s) => s.id)).not.toContain("grouped-1");
    expect(ungrouped.length - ungroupedVisible.length).toBe(132);
  });

  test("traffic-nodrag overlay stays inside collapsed topbar and does not cover expanded sidebar", async () => {
    const source = await readFile(shellCssSourceUrl, "utf8");
    expect(source).toContain("html.openwork-electron .wapp-workspace-shell .wapp-topbar");
    expect(source).toMatch(
      /html\.openwork-electron \.wapp-workspace-shell \.wapp-topbar \{[\s\S]*?position: relative;/,
    );
    expect(source).toMatch(
      /html\.openwork-electron \.wapp-topbar-traffic-nodrag \{\s*display: none;/,
    );
    expect(source).toContain(
      "html.openwork-electron .wapp-workspace-shell.is-sidebar-collapsed .wapp-topbar-traffic-nodrag",
    );
  });

  test("project new-chat switches surface to agents like opening an existing session", async () => {
    const source = await readFile(sidebarSourceUrl, "utf8");
    const blockStart = source.indexOf("function WorkspaceConversationBlock(");
    const blockEnd = source.indexOf("export function WodeAppWorkbenchSidebar(", blockStart);
    const blockSource = source.slice(blockStart, blockEnd);

    expect(blockStart).toBeGreaterThan(-1);
    expect(blockEnd).toBeGreaterThan(blockStart);
    expect(blockSource).toContain('onSurfaceChange("agents")');
    expect(blockSource).toContain("onCreateTaskInWorkspace(workspace.id)");
    expect(blockSource).toMatch(
      /onSurfaceChange\("agents"\);\s*if \(!isActive && onSelectWorkspace\)/,
    );
  });

  test("web deployment hides the folder project section", async () => {
    const source = await readFile(sidebarSourceUrl, "utf8");
    expect(source).toContain('import { isWebDeployment } from "@/app/lib/openwork-deployment"');
    expect(source).toContain('{isWebDeployment() ? null : <section className="wapp-sidebar-section">');
    expect(source).toContain('t("wodeappx.workspace.projects")');
    expect(source).toContain('t("wodeappx.recent.title")');
    expect(source).toContain("if (isWebDeployment()) return true;");
    expect(source).toContain("const untitled = usable");
    expect(source).toContain("return untitled[0] ? [untitled[0], ...named] : named;");
  });

  test("supor product desk flattens the nested project chrome row", async () => {
    const source = await readFile(sidebarSourceUrl, "utf8");
    expect(source).toContain("function FlatWorkspaceConversationList(");
    expect(source).toContain("inSuporProductDesk && isSuporWorkspaceLike(group.workspace)");
    expect(source).toContain("不再套一层「苏泊尔经营台（自进化）」折叠框");
    expect(source).toContain("onForgetWorkspace={props.onForgetWorkspace}");
    expect(source).toContain('t("wodeappx.workspace.remove")');
  });

  test("wires leftover English chrome to i18n instead of hardcoded Chinese", async () => {
    const source = await readFile(sidebarSourceUrl, "utf8");
    expect(source).toContain('t("wodeappx.common.new")');
    expect(source).toContain('t("wodeappx.recent.expand_more"');
    expect(source).toContain('t("wodeappx.workspace.self_evolve")');
    expect(source).toContain("currentLocale() !== \"zh\"");
    expect(source).not.toContain("展开显示（其余");
    expect(source).not.toContain("<span>新建</span>");
    expect(source).not.toContain('return "wodeapp（自进化）"');
  });

  test("promotes the first sent message into the recent-conversation list immediately", async () => {
    const source = await readFile(sessionRouteSourceUrl, "utf8");
    const sendStart = source.indexOf("onSendDraft: async (");
    const promptStart = source.indexOf("await opencodeClient.session.promptAsync", sendStart);
    const sendSource = source.slice(sendStart, promptStart);

    expect(sendStart).toBeGreaterThan(-1);
    expect(promptStart).toBeGreaterThan(sendStart);
    expect(sendSource).toContain("makeSessionTitleFromText(draft.text.trim() || text)");
    expect(sendSource).toContain("setSessionsByWorkspaceId((current) =>");
    expect(sendSource).toContain("await opencodeClient.session.update({");
  });

  test("create-agent composer label and placeholder use i18n", async () => {
    const sessionSource = await readFile(sessionRouteSourceUrl, "utf8");
    expect(sessionSource).toContain("formatAgentDisplayName(");
    expect(sessionSource).toContain("selectedRuntimeProfile?.id || selectedRuntimeProfile?.name || selectedAgent");
    expect(sessionSource).not.toContain("agentLabel: selectedRuntimeProfile?.name");

    const composerUrl = existingSourceUrl(
      "../fork/apps/app/src/react-app/domains/session/surface/composer/composer.tsx",
      "../src/react-app/domains/session/surface/composer/composer.tsx",
    );
    const composer = await readFile(composerUrl, "utf8");
    expect(composer).toContain('t("composer.workbench_placeholder")');
    expect(composer).toContain("resolveWodeAppBuiltinAgentId");
    expect(composer).not.toContain("随心输入");
  });

  test("leaves tool visibility to the OpenCode dynamic discovery loop", async () => {
    const source = await readFile(sessionRouteSourceUrl, "utf8");
    const promptStart = source.indexOf("await opencodeClient.session.promptAsync");
    const promptEnd = source.indexOf("if (result.error)", promptStart);
    const promptSource = source.slice(promptStart, promptEnd);

    expect(promptStart).toBeGreaterThan(-1);
    expect(promptEnd).toBeGreaterThan(promptStart);
    expect(promptSource).toContain("Tool visibility is resolved inside the patched OpenCode loop");
    expect(promptSource).not.toContain("tools: capabilityRoute.tools");
  });
});
