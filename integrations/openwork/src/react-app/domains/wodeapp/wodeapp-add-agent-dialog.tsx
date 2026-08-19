/** @jsxImportSource react */
import * as React from "react";

import {
  listWodeAppBrandAgents,
  saveWodeAppBrandAgents,
} from "@/app/lib/wodeapp-auth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import { findWodeAppBuiltinAgent, WODEAPP_CREATE_AGENT_ID } from "./runtime-projects";
import { buildBuiltinAgentTask } from "./wodeapp-auto-orchestration";
import {
  listEnabledWodeAppBrandAgents,
  normalizeWodeAppBrandAgentsFile,
  readStoredWodeAppBrandAgents,
  writeStoredWodeAppBrandAgents,
  type WodeAppBrandAgentConfig,
} from "./wodeapp-brand-agent-config";
import { WODEAPP_SHIPPED_BUILTIN_AGENTS_FILE } from "./wodeapp-builtin-agents-config";
import { mergeBrandAgentsWithPlaza } from "./wodeapp-plaza";
import {
  buildCustomBrandAgent,
  buildCustomCreateAgentDisplayText,
  buildSkillBrandAgent,
  enableShippedSidebarAgent,
  formatSidebarSkillCopy,
  parseGitSkillRepo,
  readWodeAppAgentsOverride,
  resolveOfficialSkillPin,
  resolveSidebarAgentId,
  skillHubRepoKey,
  upsertSkillHubRepo,
  writeAgentProfileEdit,
  WODEAPP_OPTIONAL_SIDEBAR_AGENT_IDS,
} from "./wodeapp-sidebar-agents";
import { rememberCustomAgentCreateSession } from "./wodeapp-custom-agent-home";
import { useOptionalWodeAppWorkbench } from "./wodeapp-workbench-context";

type AddTab = "skill" | "git" | "custom";

const TABS: Array<{ id: AddTab; label: string }> = [
  { id: "skill", label: "已安装技能" },
  { id: "git", label: "Git 仓库" },
  { id: "custom", label: "自定义" },
];

function asBrandAgents(input: unknown): WodeAppBrandAgentConfig[] {
  const agents = Array.isArray(input) ? input : [];
  return normalizeWodeAppBrandAgentsFile({ version: 1, agents }).agents;
}

async function persistBrandAgents(agents: WodeAppBrandAgentConfig[]): Promise<string | null> {
  const file = normalizeWodeAppBrandAgentsFile({ version: 1, agents });
  writeStoredWodeAppBrandAgents(file);
  const saved = await saveWodeAppBrandAgents(file);
  if (saved.ok) {
    writeStoredWodeAppBrandAgents(asBrandAgents(saved.agents));
    return null;
  }
  return saved.error || null;
}

export function WodeAppAddAgentDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const workbench = useOptionalWodeAppWorkbench();
  const [tab, setTab] = React.useState<AddTab>("skill");
  const [status, setStatus] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [skills, setSkills] = React.useState<Array<{ name: string; description?: string }>>([]);
  const [skillsLoading, setSkillsLoading] = React.useState(false);
  const [gitInput, setGitInput] = React.useState("");
  const [hubSkills, setHubSkills] = React.useState<Array<{ name: string; description?: string }>>([]);
  const [customName, setCustomName] = React.useState("");
  const [customMeta, setCustomMeta] = React.useState("");
  const [customPrompt, setCustomPrompt] = React.useState("");
  const override = readWodeAppAgentsOverride();
  const pinnedIds = new Set(listEnabledWodeAppBrandAgents(readStoredWodeAppBrandAgents()).map((agent) => agent.id));

  const officialCandidates = React.useMemo(
    () => WODEAPP_SHIPPED_BUILTIN_AGENTS_FILE.agents.filter((agent) => {
      if (agent.kind === "industry") return false;
      const optional = (WODEAPP_OPTIONAL_SIDEBAR_AGENT_IDS as readonly string[]).includes(agent.id);
      const hidden = override.hiddenIds.includes(agent.id);
      return optional || hidden;
    }),
    [override.hiddenIds],
  );

  const loadInstalledSkills = React.useCallback(async () => {
    if (!workbench?.automations?.skills || !workbench.selectedWorkspaceId) {
      setSkills([]);
      return;
    }
    setSkillsLoading(true);
    try {
      const items = await workbench.automations.skills.listInstalled(workbench.selectedWorkspaceId);
      setSkills(items.map((item) => ({ name: item.name, description: item.description })));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "技能列表加载失败");
    } finally {
      setSkillsLoading(false);
    }
  }, [workbench]);

  React.useEffect(() => {
    if (!props.open) return;
    setStatus(null);
    setNotice(null);
    void loadInstalledSkills();
  }, [props.open, loadInstalledSkills]);

  const pinBrandAgent = React.useCallback(async (agent: WodeAppBrandAgentConfig) => {
    setBusyId(agent.id);
    setStatus(null);
    setNotice(null);
    try {
      const listed = await listWodeAppBrandAgents();
      const existing = listed.ok ? asBrandAgents(listed.agents) : readStoredWodeAppBrandAgents();
      const merged = mergeBrandAgentsWithPlaza(existing, agent);
      const error = await persistBrandAgents(merged.agents);
      if (error) {
        setStatus(error);
        return false;
      }
      setNotice(`已添加「${agent.name}」`);
      return true;
    } finally {
      setBusyId(null);
    }
  }, []);

  const handlePinSkill = React.useCallback(async (skill: { name: string; description?: string }) => {
    const official = resolveOfficialSkillPin(skill.name);
    if (official) {
      enableShippedSidebarAgent(official.agentId);
      setNotice(`已添加「${official.name}」`);
      return;
    }
    const agent = buildSkillBrandAgent(skill);
    if (!agent) {
      setStatus("技能名称无效");
      return;
    }
    await pinBrandAgent(agent);
  }, [pinBrandAgent]);

  const handleAddGit = React.useCallback(async () => {
    const repo = parseGitSkillRepo(gitInput);
    if (!repo) {
      setStatus("请填写 owner/repo，或粘贴 GitHub 仓库地址");
      return;
    }
    upsertSkillHubRepo(repo);
    setNotice(`已添加技能仓库 ${skillHubRepoKey(repo)}`);
    if (!workbench?.automations?.skills) return;
    setBusyId("git");
    try {
      const items = await workbench.automations.skills.listHub(repo);
      setHubSkills(items.map((item) => ({ name: item.name, description: item.description })));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "仓库技能列表加载失败");
    } finally {
      setBusyId(null);
    }
  }, [gitInput, workbench]);

  const handleInstallHubSkill = React.useCallback(async (skill: { name: string; description?: string }) => {
    const repo = parseGitSkillRepo(gitInput);
    if (workbench?.automations?.skills && workbench.selectedWorkspaceId && repo) {
      setBusyId(skill.name);
      try {
        await workbench.automations.skills.install(workbench.selectedWorkspaceId, skill.name, repo);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "技能安装失败");
        setBusyId(null);
        return;
      }
      setBusyId(null);
    }
    await handlePinSkill(skill);
  }, [gitInput, handlePinSkill, workbench]);

  const handleAddCustom = React.useCallback(async () => {
    const pinnedAgent = buildCustomBrandAgent({
      name: customName,
      meta: customMeta,
      entryPrompt: customPrompt || customMeta,
    });
    if (!pinnedAgent) {
      setStatus("请填写名称");
      return;
    }
    if (!workbench) {
      setStatus("请在工作台里打开对话后再添加");
      return;
    }
    const createAgent = findWodeAppBuiltinAgent(WODEAPP_CREATE_AGENT_ID);
    if (!createAgent) {
      setStatus("创建智能体入口不可用");
      return;
    }
    const displayText = buildCustomCreateAgentDisplayText({
      name: customName,
      meta: customMeta,
      guidance: customPrompt,
    });
    if (!displayText) {
      setStatus("请填写名称");
      return;
    }
    setStatus(null);
    setNotice(null);
    const pinned = await pinBrandAgent(pinnedAgent);
    if (!pinned) return;
    writeAgentProfileEdit(pinnedAgent.id, {
      name: pinnedAgent.name,
      description: customMeta.trim() || pinnedAgent.samplePrompt || "",
    });
    setBusyId("custom");
    try {
      const sessionId = await workbench.onCreateTaskWithPrompt(
        workbench.selectedWorkspaceId,
        buildBuiltinAgentTask(createAgent, { displayText, autoSend: false }),
      );
      if (typeof sessionId === "string" && sessionId.trim()) {
        rememberCustomAgentCreateSession(sessionId, pinnedAgent.id);
      }
      setCustomName("");
      setCustomMeta("");
      setCustomPrompt("");
      props.onOpenChange(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "打开对话失败");
    } finally {
      setBusyId(null);
    }
  }, [customMeta, customName, customPrompt, pinBrandAgent, props, workbench]);

  const handleEnableOfficial = React.useCallback((id: string, name: string) => {
    enableShippedSidebarAgent(id);
    setNotice(`已添加「${name}」`);
  }, []);

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="wx-add-agent-dialog">
        <DialogHeader>
          <DialogTitle>添加智能体</DialogTitle>
        </DialogHeader>
        <div className="wx-add-agent-body">
          <div className="wx-cap-tabs" role="tablist" aria-label="添加来源">
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={tab === entry.id}
                className={`wx-cap-tab${tab === entry.id ? " is-active" : ""}`}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>

          {status ? <p className="wx-add-agent-status" role="alert">{status}</p> : null}
          {notice ? <p className="wx-add-agent-notice" role="status">{notice}</p> : null}

          {tab === "skill" ? (
            <div className="wx-add-agent-list">
              {officialCandidates.length > 0 ? (
                <section aria-label="官方智能体">
                  <h3>官方智能体</h3>
                  {officialCandidates.map((agent) => {
                    const added = !override.hiddenIds.includes(agent.id)
                      && (agent.enabled !== false || override.extraEnabledIds.includes(agent.id));
                    return (
                      <div key={agent.id} className="wx-add-agent-row">
                        <div>
                          <strong>{agent.name}</strong>
                          <span>{agent.meta || "可重新添加到侧栏"}</span>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          disabled={added}
                          onClick={() => handleEnableOfficial(agent.id, agent.name)}
                        >
                          {added ? "已添加" : "添加"}
                        </Button>
                      </div>
                    );
                  })}
                </section>
              ) : null}
              <section aria-label="已安装技能">
                <h3>已安装技能</h3>
                {skillsLoading ? <p>正在读取技能…</p> : null}
                {!skillsLoading && skills.length === 0 ? (
                  <p>还没有已安装技能。可先到 Git 仓库安装，或去能力中心浏览。</p>
                ) : null}
                {skills.filter((skill) => !resolveOfficialSkillPin(skill.name)).map((skill) => {
                  const copy = formatSidebarSkillCopy(skill);
                  const added = pinnedIds.has(resolveSidebarAgentId(skill.name, "skill"));
                  return (
                  <div key={skill.name} className="wx-add-agent-row">
                    <div>
                      <strong>{copy.name}</strong>
                      <span>{copy.meta}</span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      disabled={added || busyId === skill.name}
                      onClick={() => void handlePinSkill(skill)}
                    >
                      {added ? "已添加" : "添加"}
                    </Button>
                  </div>
                  );
                })}
              </section>
            </div>
          ) : null}

          {tab === "git" ? (
            <div className="wx-add-agent-form">
              <label>
                <span>仓库</span>
                <Input
                  value={gitInput}
                  onChange={(event) => setGitInput(event.currentTarget.value)}
                  placeholder="anthropics/skills 或 GitHub 地址"
                  aria-label="Git 仓库"
                />
              </label>
              <Button
                type="button"
                disabled={busyId === "git"}
                onClick={() => void handleAddGit()}
              >
                {busyId === "git" ? "读取中" : "添加仓库"}
              </Button>
              {hubSkills.length > 0 ? (
                <div className="wx-add-agent-list">
                  {hubSkills.map((skill) => (
                    <div key={skill.name} className="wx-add-agent-row">
                      <div>
                        <strong>{formatSidebarSkillCopy(skill).name}</strong>
                        <span>{formatSidebarSkillCopy(skill).meta}</span>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        disabled={Boolean(busyId)}
                        onClick={() => void handleInstallHubSkill(skill)}
                      >
                        {pinnedIds.has(skill.name) ? "已添加" : "安装并添加"}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === "custom" ? (
            <div className="wx-add-agent-form">
              <p>
                会先出现在侧栏，再开一场对话去创建对应项目。初始引导会填进输入框，不会自动发送。
              </p>
              <label>
                <span>名称</span>
                <Input
                  value={customName}
                  onChange={(event) => setCustomName(event.currentTarget.value)}
                  placeholder="例如 调研助手"
                  aria-label="智能体名称"
                />
              </label>
              <label>
                <span>简介</span>
                <Input
                  value={customMeta}
                  onChange={(event) => setCustomMeta(event.currentTarget.value)}
                  placeholder="一句话说明"
                  aria-label="智能体简介"
                />
              </label>
              <label>
                <span>初始引导</span>
                <textarea
                  value={customPrompt}
                  onChange={(event) => setCustomPrompt(event.currentTarget.value)}
                  placeholder="写给对话的第一段需求，例如要做什么、给谁用、必须有哪些页面"
                  rows={3}
                  aria-label="初始引导"
                />
              </label>
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" type="button" />}>取消</DialogClose>
          {tab === "custom" ? (
            <Button type="button" disabled={!customName.trim() || Boolean(busyId)} onClick={() => void handleAddCustom()}>
              {busyId === "custom" ? "打开中" : "打开对话"}
            </Button>
          ) : (
            <Button type="button" variant="outline" onClick={() => props.onOpenChange(false)}>
              完成
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
