/** @jsxImportSource react */
import * as React from "react";
import type { LucideIcon } from "lucide-react";
import {
  CloudDownload,
  LayoutGrid,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
} from "lucide-react";

import type {
  WodeAppHubSkill,
  WodeAppInstalledSkill,
  WodeAppSkillHubRepo,
} from "./wodeapp-automation-client";
import { useWodeAppWorkbench } from "./wodeapp-workbench-context";
import { WodeAppConnectorsSection } from "./wodeapp-connectors-surface";
import { WodeAppPlazaSection } from "./wodeapp-plaza-section";
import { WodeAppSurfaceFrame } from "./wodeapp-surface-frame";

type CapabilityTabId = "skills" | "channels" | "plaza";

const CAPABILITY_TABS: Array<{ id: CapabilityTabId; label: string }> = [
  { id: "skills", label: "工具·技能" },
  { id: "plaza", label: "自定义广场" },
  { id: "channels", label: "推送渠道" },
];

const SKILL_HUB_REPOS_STORAGE_KEY = "wodeapp.capabilities.skillHubRepos.v1";
const SKILL_HUB_ACTIVE_STORAGE_KEY = "wodeapp.capabilities.skillHubActive.v1";

type SkillHubRepoSource = WodeAppSkillHubRepo & { label: string };

const DEFAULT_SKILL_HUB_REPOS: SkillHubRepoSource[] = [
  { owner: "anthropics", repo: "skills", ref: "main", label: "Anthropic 官方" },
];

function skillHubRepoKey(repo: WodeAppSkillHubRepo): string {
  return `${repo.owner}/${repo.repo}@${repo.ref}`;
}

function readStoredJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeStoredJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 忽略存储失败（隐私模式等），仅本次会话生效。
  }
}

function normalizeCustomRepos(input: unknown): SkillHubRepoSource[] {
  if (!Array.isArray(input)) return [];
  const repos: SkillHubRepoSource[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const owner = String(record.owner ?? "").trim();
    const repo = String(record.repo ?? "").trim();
    const ref = String(record.ref ?? "").trim() || "main";
    if (!owner || !repo) continue;
    repos.push({ owner, repo, ref, label: "自定义" });
  }
  return repos;
}

type ChannelCardData = {
  id: string;
  name: string;
  description: string;
};

/** 推送渠道占位：M3 接入真实配置。 */
const CHANNEL_CARDS: ChannelCardData[] = [
  { id: "channel-feishu", name: "飞书群推送", description: "任务完成与定时任务结果自动推送到飞书群。" },
  { id: "channel-wecom", name: "企业微信群推送", description: "任务完成与定时任务结果自动推送到企业微信群。" },
  { id: "channel-dingtalk", name: "钉钉群推送", description: "任务完成与定时任务结果自动推送到钉钉群。" },
];

type CapabilityCardProps = {
  name: string;
  description?: string;
  Icon: LucideIcon;
  badgeText?: string;
  badgeTone?: "neutral" | "custom" | "pending";
  /** 已安装等状态：绿色小圆点标签，取代大徽章与开关 */
  dotTag?: string;
  /** 底部左侧小字（触发方式 / 开放说明等） */
  footText?: string;
  /** 整卡可点（已安装技能：点击回到对话使用） */
  onCardClick?: () => void;
  secondary?: { label: string; busy?: boolean; onClick: () => void };
  primary?: { label: string; busy?: boolean; disabledReason?: string; onClick?: () => void };
};

function WodeAppCapabilityCard(props: CapabilityCardProps) {
  const { Icon } = props;
  const clickable = Boolean(props.onCardClick);
  return (
    <article
      className={`wx-cap-card${clickable ? " is-clickable" : ""}`}
      onClick={props.onCardClick}
      title={clickable ? "点击回到对话中使用" : undefined}
    >
      <div className="wx-cap-card-head">
        <div className="wx-cap-card-icon">
          <Icon aria-hidden />
        </div>
        <div className="wx-cap-card-title">
          <h4 title={props.name}>{props.name}</h4>
          <div className="wx-cap-card-badges">
            {props.dotTag ? <span className="wx-cap-dot-tag">{props.dotTag}</span> : null}
            {props.badgeText ? (
              <span className={`wx-cap-badge is-${props.badgeTone ?? "neutral"}`}>{props.badgeText}</span>
            ) : null}
          </div>
        </div>
      </div>
      {props.description ? <p className="wx-cap-card-desc">{props.description}</p> : null}
      <div className="wx-cap-card-foot">
        <span className="wx-cap-card-foot-text">{props.footText ?? ""}</span>
        {props.secondary || props.primary ? (
          <div className="wx-cap-card-actions" onClick={(event) => event.stopPropagation()}>
            {props.secondary ? (
              <button
                type="button"
                className="wx-cap-ghost-btn"
                disabled={props.secondary.busy}
                onClick={props.secondary.onClick}
              >
                {props.secondary.busy ? <Loader2 className="is-spinning" aria-hidden /> : null}
                {props.secondary.label}
              </button>
            ) : null}
            {props.primary ? (
              props.primary.disabledReason ? (
                <button type="button" className="wx-cap-primary" disabled title={props.primary.disabledReason}>
                  {props.primary.label}
                </button>
              ) : (
                <button type="button" className="wx-cap-primary" disabled={props.primary.busy} onClick={props.primary.onClick}>
                  {props.primary.busy ? <Loader2 className="is-spinning" aria-hidden /> : null}
                  {props.primary.label}
                </button>
              )
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function matchesSkill(query: string, name: string, description?: string): boolean {
  if (!query) return true;
  return `${name} ${description ?? ""}`.toLowerCase().includes(query.toLowerCase());
}

export function WodeAppCapabilitiesSurface() {
  const workbench = useWodeAppWorkbench();
  const automations = workbench.automations;
  const workspaceId = workbench.selectedWorkspaceId?.trim() ?? "";
  const onCreateTaskWithPrompt = workbench.onCreateTaskWithPrompt;

  const [activeTab, setActiveTab] = React.useState<CapabilityTabId>("skills");
  const [query, setQuery] = React.useState("");

  const [customRepos, setCustomRepos] = React.useState<SkillHubRepoSource[]>(() =>
    normalizeCustomRepos(readStoredJson(SKILL_HUB_REPOS_STORAGE_KEY, [])),
  );
  const allRepos = React.useMemo(() => [...DEFAULT_SKILL_HUB_REPOS, ...customRepos], [customRepos]);
  const [activeRepoKey, setActiveRepoKey] = React.useState<string>(() => {
    const stored = readStoredJson<string>(SKILL_HUB_ACTIVE_STORAGE_KEY, "");
    return stored || skillHubRepoKey(DEFAULT_SKILL_HUB_REPOS[0]);
  });
  const activeRepo = React.useMemo(
    () => allRepos.find((repo) => skillHubRepoKey(repo) === activeRepoKey) ?? allRepos[0],
    [allRepos, activeRepoKey],
  );

  const [installedSkills, setInstalledSkills] = React.useState<WodeAppInstalledSkill[]>([]);
  const [hubSkills, setHubSkills] = React.useState<WodeAppHubSkill[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [statusMessage, setStatusMessage] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [installingName, setInstallingName] = React.useState<string | null>(null);
  const [removingName, setRemovingName] = React.useState<string | null>(null);

  const [addRepoOpen, setAddRepoOpen] = React.useState(false);
  const [addRepoForm, setAddRepoForm] = React.useState({ owner: "", repo: "", ref: "main" });

  const serverReady = Boolean(automations?.skills) && Boolean(workspaceId);

  const loadSkills = React.useCallback(async () => {
    if (!automations?.skills || !workspaceId) return;
    setLoading(true);
    setStatusMessage(null);
    try {
      const [installed, hub] = await Promise.all([
        automations.skills.listInstalled(workspaceId),
        automations.skills.listHub(activeRepo),
      ]);
      setInstalledSkills(installed);
      setHubSkills(hub);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "技能列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [automations, workspaceId, activeRepo]);

  React.useEffect(() => {
    if (activeTab !== "skills") return;
    void loadSkills();
  }, [activeTab, loadSkills]);

  const handleSelectRepo = React.useCallback((key: string) => {
    setActiveRepoKey(key);
    writeStoredJson(SKILL_HUB_ACTIVE_STORAGE_KEY, key);
  }, []);

  const handleAddRepo = React.useCallback(() => {
    const owner = addRepoForm.owner.trim();
    const repo = addRepoForm.repo.trim();
    const ref = addRepoForm.ref.trim() || "main";
    if (!owner || !repo) {
      setStatusMessage("请填写仓库 owner 与名称，例如 anthropics / skills");
      return;
    }
    const candidate: SkillHubRepoSource = { owner, repo, ref, label: "自定义" };
    const key = skillHubRepoKey(candidate);
    setCustomRepos((current) => {
      if (current.some((entry) => skillHubRepoKey(entry) === key)) return current;
      const next = [...current, candidate];
      writeStoredJson(SKILL_HUB_REPOS_STORAGE_KEY, next);
      return next;
    });
    setAddRepoOpen(false);
    setAddRepoForm({ owner: "", repo: "", ref: "main" });
    handleSelectRepo(key);
    setNotice(`已添加技能仓库 ${key}`);
  }, [addRepoForm, handleSelectRepo]);

  const handleInstall = React.useCallback(
    async (name: string) => {
      if (!automations?.skills || !workspaceId || installingName) return;
      setInstallingName(name);
      setStatusMessage(null);
      setNotice(null);
      try {
        const result = await automations.skills.install(workspaceId, name, activeRepo);
        if (!result?.ok) throw new Error("安装失败，请稍后重试");
        setNotice(`已安装「${name}」，回到对话即可使用`);
        await loadSkills();
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "技能安装失败");
      } finally {
        setInstallingName(null);
      }
    },
    [automations, workspaceId, installingName, activeRepo, loadSkills],
  );

  const handleUninstall = React.useCallback(
    async (name: string) => {
      if (!automations?.skills || !workspaceId || removingName) return;
      setRemovingName(name);
      setStatusMessage(null);
      setNotice(null);
      try {
        await automations.skills.uninstall(workspaceId, name);
        setNotice(`已卸载「${name}」，可随时从下方线上列表重新安装`);
        await loadSkills();
      } catch (error) {
        setStatusMessage(error instanceof Error ? error.message : "技能卸载失败");
      } finally {
        setRemovingName(null);
      }
    },
    [automations, workspaceId, removingName, loadSkills],
  );

  const handleUseSkill = React.useCallback(
    (skill: WodeAppInstalledSkill) => {
      if (!onCreateTaskWithPrompt || !workspaceId) return;
      onCreateTaskWithPrompt(workspaceId, {
        displayText: `使用技能：${skill.name}`,
        agentMessage: `请使用「${skill.name}」技能帮我处理接下来的任务。${skill.description ? `技能说明：${skill.description}` : ""}`,
      });
    },
    [onCreateTaskWithPrompt, workspaceId],
  );

  const trimmedQuery = query.trim();
  const searching = trimmedQuery.length > 0;

  const installedNames = React.useMemo(() => new Set(installedSkills.map((skill) => skill.name)), [installedSkills]);
  const onlineSkills = React.useMemo(
    () => hubSkills.filter((skill) => !installedNames.has(skill.name)),
    [hubSkills, installedNames],
  );

  const filteredInstalled = React.useMemo(
    () => (searching ? installedSkills.filter((skill) => matchesSkill(trimmedQuery, skill.name, skill.description)) : installedSkills),
    [searching, trimmedQuery, installedSkills],
  );
  const filteredOnline = React.useMemo(
    () => (searching ? onlineSkills.filter((skill) => matchesSkill(trimmedQuery, skill.name, skill.description)) : onlineSkills),
    [searching, trimmedQuery, onlineSkills],
  );
  const filteredChannels = React.useMemo(
    () => (searching ? CHANNEL_CARDS.filter((card) => matchesSkill(trimmedQuery, card.name, card.description)) : CHANNEL_CARDS),
    [searching, trimmedQuery],
  );

  const canUseSkill = Boolean(onCreateTaskWithPrompt) && Boolean(workspaceId);

  const renderInstalledCard = (skill: WodeAppInstalledSkill) => (
    <WodeAppCapabilityCard
      key={`installed-${skill.name}`}
      name={skill.name}
      description={skill.description || "已安装的技能，回到对话即可使用。"}
      Icon={Sparkles}
      dotTag="已安装"
      footText={skill.trigger ? `触发方式：${skill.trigger}` : undefined}
      onCardClick={canUseSkill ? () => handleUseSkill(skill) : undefined}
      secondary={
        serverReady
          ? {
              label: "卸载",
              busy: removingName === skill.name,
              onClick: () => void handleUninstall(skill.name),
            }
          : undefined
      }
    />
  );

  const renderOnlineCard = (skill: WodeAppHubSkill) => (
    <WodeAppCapabilityCard
      key={`hub-${skill.name}`}
      name={skill.name}
      description={skill.description || "来自线上技能仓库。"}
      Icon={CloudDownload}
      badgeText="线上"
      badgeTone="custom"
      primary={
        serverReady
          ? {
              label: installingName === skill.name ? "安装中" : "安装",
              busy: installingName === skill.name,
              onClick: () => void handleInstall(skill.name),
            }
          : { label: "安装", disabledReason: "本地服务正在连接，暂时无法安装" }
      }
    />
  );

  const renderChannelCard = (card: ChannelCardData) => (
    <WodeAppCapabilityCard
      key={card.id}
      name={card.name}
      description={card.description}
      Icon={Send}
      badgeText="待接入"
      badgeTone="pending"
      footText="渠道配置将在后续版本开放"
    />
  );

  return (
    <WodeAppSurfaceFrame
      title="能力中心"
      subtitle="安装线上技能、上传自定义智能体和皮肤，或管理推送渠道。"
      Icon={LayoutGrid}
    >
      <div className="wx-cap-surface">
        <WodeAppConnectorsSection />
        <div className="wx-cap-toolbar">
          <div className="wx-cap-tabs" role="tablist" aria-label="能力分类">
            {CAPABILITY_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                className={`wx-cap-tab${activeTab === tab.id ? " is-active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="wx-cap-search">
            <Search aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索能力"
              aria-label="搜索能力"
            />
          </div>
        </div>

        {activeTab === "skills" ? (
          <>
            <div className="wx-cap-repo-bar">
              <label className="wx-cap-repo-select">
                <span>技能仓库</span>
                <select value={skillHubRepoKey(activeRepo)} onChange={(event) => handleSelectRepo(event.target.value)}>
                  {allRepos.map((repo) => (
                    <option key={skillHubRepoKey(repo)} value={skillHubRepoKey(repo)}>
                      {repo.label} · {skillHubRepoKey(repo)}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="wx-cap-repo-action" onClick={() => setAddRepoOpen((open) => !open)}>
                <Plus aria-hidden />
                添加仓库
              </button>
              <button type="button" className="wx-cap-repo-action" onClick={() => void loadSkills()} disabled={loading || !serverReady}>
                <RefreshCw className={loading ? "is-spinning" : ""} aria-hidden />
                刷新
              </button>
            </div>

            {addRepoOpen ? (
              <div className="wx-cap-repo-form">
                <input
                  type="text"
                  value={addRepoForm.owner}
                  onChange={(event) => setAddRepoForm((form) => ({ ...form, owner: event.target.value }))}
                  placeholder="owner，如 anthropics"
                  aria-label="仓库 owner"
                />
                <input
                  type="text"
                  value={addRepoForm.repo}
                  onChange={(event) => setAddRepoForm((form) => ({ ...form, repo: event.target.value }))}
                  placeholder="仓库名，如 skills"
                  aria-label="仓库名"
                />
                <input
                  type="text"
                  value={addRepoForm.ref}
                  onChange={(event) => setAddRepoForm((form) => ({ ...form, ref: event.target.value }))}
                  placeholder="分支，默认 main"
                  aria-label="分支"
                />
                <button type="button" className="wx-cap-primary" onClick={handleAddRepo}>
                  添加
                </button>
              </div>
            ) : null}

            {!serverReady ? (
              <div className="wx-cap-empty" role="status">
                <p>本地服务正在连接，暂时无法加载技能列表；连接成功后这里会显示已安装与线上技能。</p>
              </div>
            ) : null}

            {statusMessage ? (
              <div className="wx-cap-status is-error" role="alert">
                {statusMessage}
              </div>
            ) : null}
            {notice ? (
              <div className="wx-cap-status is-ok" role="status">
                {notice}
              </div>
            ) : null}

            {loading && installedSkills.length === 0 && hubSkills.length === 0 ? (
              <div className="wx-cap-empty" role="status">
                <p>
                  <Loader2 className="is-spinning" aria-hidden /> 正在读取技能列表…
                </p>
              </div>
            ) : null}

            {serverReady && !loading ? (
              <>
                {searching && filteredInstalled.length === 0 && filteredOnline.length === 0 ? (
                  <div className="wx-cap-empty" role="status">
                    <p>没有找到「{trimmedQuery}」相关的技能</p>
                  </div>
                ) : null}
                {filteredInstalled.length > 0 ? (
                  <section className="wx-cap-section" aria-label="已安装">
                    <h3>已安装（{filteredInstalled.length}）</h3>
                    <div className="wx-cap-grid">{filteredInstalled.map((skill) => renderInstalledCard(skill))}</div>
                  </section>
                ) : null}
                <section className="wx-cap-section" aria-label="线上技能">
                  <h3>线上技能 · {activeRepo.label}</h3>
                  {filteredOnline.length === 0 ? (
                    <div className="wx-cap-empty" role="status">
                      <p>{searching ? "该仓库没有匹配的线上技能" : "这个仓库的技能都已在已安装区，或仓库暂无技能"}</p>
                    </div>
                  ) : (
                    <div className="wx-cap-grid">{filteredOnline.map((skill) => renderOnlineCard(skill))}</div>
                  )}
                </section>
              </>
            ) : null}
          </>
        ) : activeTab === "plaza" ? (
          <WodeAppPlazaSection query={query} />
        ) : (
          <>
            {searching && filteredChannels.length === 0 ? (
              <div className="wx-cap-empty" role="status">
                <p>没有找到「{trimmedQuery}」相关的推送渠道</p>
              </div>
            ) : null}
            <section className="wx-cap-section" aria-label="推送渠道">
              <h3>推送渠道</h3>
              <div className="wx-cap-grid">{filteredChannels.map((card) => renderChannelCard(card))}</div>
            </section>
          </>
        )}
      </div>
    </WodeAppSurfaceFrame>
  );
}
