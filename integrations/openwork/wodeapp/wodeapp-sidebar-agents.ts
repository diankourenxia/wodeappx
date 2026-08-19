/**
 * Sidebar agent list = shipped defaults + Layer2 override + pinned skills/custom.
 * See wodeappx/docs/AGENTS_CONFIG.md.
 */

import { listShippedBuiltinAgentIds } from "./wodeapp-builtin-agents-config";
import {
  WODEAPP_RESERVED_BUILTIN_AGENT_IDS,
  type WodeAppBrandAgentConfig,
} from "./wodeapp-brand-agent-config";
import { slugifyPlazaId } from "./wodeapp-plaza";

export const WODEAPP_AGENTS_OVERRIDE_STORAGE_KEY = "wodeappx.agents.override.v1";
export const WODEAPP_AGENTS_OVERRIDE_CHANGED_EVENT = "wodeapp:agents-override-changed";
export const WODEAPP_SKILL_HUB_REPOS_STORAGE_KEY = "wodeapp.capabilities.skillHubRepos.v1";

/** Official agents hidden from the default sidebar; users can pin them back. */
export const WODEAPP_OPTIONAL_SIDEBAR_AGENT_IDS = [
  "script-storyboard",
  "agent-infinite-canvas",
] as const;

/** Installed skills that are the same product as a shipped Layer0 agent. */
export const WODEAPP_OFFICIAL_SKILL_PINS: Record<string, {
  agentId: string;
  name: string;
  meta: string;
}> = {
  "wodeapp-short-drama-factory": {
    agentId: "script-storyboard",
    name: "短剧智能体",
    meta: "剧本 · 分镜 · 可拍摄脚本",
  },
};

export type WodeAppAgentProfileEdit = {
  name?: string;
  description?: string;
};

export type WodeAppAgentsOverride = {
  version: 1;
  extraEnabledIds: string[];
  hiddenIds: string[];
  order: string[];
  profiles?: Record<string, WodeAppAgentProfileEdit>;
};

export type WodeAppSkillPinInput = {
  name: string;
  description?: string;
};

export type WodeAppGitSkillRepo = {
  owner: string;
  repo: string;
  ref: string;
  label?: string;
};

const ID_RE = /^[a-z][a-z0-9-]{1,62}$/;
const RESERVED = new Set<string>(WODEAPP_RESERVED_BUILTIN_AGENT_IDS);

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

function uniqueIds(input: unknown, allow: (id: string) => boolean): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of input) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || seen.has(id) || !allow(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function emptyWodeAppAgentsOverride(): WodeAppAgentsOverride {
  return { version: 1, extraEnabledIds: [], hiddenIds: [], order: [], profiles: {} };
}

function normalizeProfiles(input: unknown): Record<string, WodeAppAgentProfileEdit> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: Record<string, WodeAppAgentProfileEdit> = {};
  for (const [id, value] of Object.entries(input as Record<string, unknown>)) {
    if (!ID_RE.test(id) || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const record = value as Record<string, unknown>;
    const name = typeof record.name === "string" ? clip(record.name, 64) : "";
    const description = typeof record.description === "string" ? clip(record.description, 16000) : "";
    if (!name && !description) continue;
    out[id] = {
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
    };
  }
  return out;
}

export function normalizeWodeAppAgentsOverride(input: unknown): WodeAppAgentsOverride {
  const record = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  if (record.version != null && record.version !== 1 && record.version !== "1") {
    return emptyWodeAppAgentsOverride();
  }
  const shipped = new Set(listShippedBuiltinAgentIds());
  return {
    version: 1,
    extraEnabledIds: uniqueIds(record.extraEnabledIds, (id) => shipped.has(id)),
    hiddenIds: uniqueIds(record.hiddenIds, (id) => shipped.has(id)),
    order: uniqueIds(record.order, (id) => ID_RE.test(id)),
    profiles: normalizeProfiles(record.profiles),
  };
}

export function readWodeAppAgentsOverride(): WodeAppAgentsOverride {
  if (typeof window === "undefined") return emptyWodeAppAgentsOverride();
  try {
    const raw = window.localStorage.getItem(WODEAPP_AGENTS_OVERRIDE_STORAGE_KEY);
    if (!raw) return emptyWodeAppAgentsOverride();
    return normalizeWodeAppAgentsOverride(JSON.parse(raw));
  } catch {
    return emptyWodeAppAgentsOverride();
  }
}

export function writeWodeAppAgentsOverride(input: WodeAppAgentsOverride | unknown): WodeAppAgentsOverride {
  const next = normalizeWodeAppAgentsOverride(input);
  if (typeof window === "undefined") return next;
  try {
    window.localStorage.setItem(WODEAPP_AGENTS_OVERRIDE_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(WODEAPP_AGENTS_OVERRIDE_CHANGED_EVENT, { detail: next }));
  } catch {
    // ignore quota / private mode
  }
  return next;
}

export function enableShippedSidebarAgent(
  id: string,
  current: WodeAppAgentsOverride = readWodeAppAgentsOverride(),
): WodeAppAgentsOverride {
  const shipped = new Set(listShippedBuiltinAgentIds());
  if (!shipped.has(id)) return current;
  return writeWodeAppAgentsOverride({
    ...current,
    extraEnabledIds: [...current.extraEnabledIds.filter((item) => item !== id), id],
    hiddenIds: current.hiddenIds.filter((item) => item !== id),
  });
}

export function writeAgentProfileEdit(
  id: string,
  edit: { name: string; description: string },
  current: WodeAppAgentsOverride = readWodeAppAgentsOverride(),
): WodeAppAgentsOverride {
  const name = clip(edit.name, 64);
  const description = clip(edit.description, 16000);
  const profiles = { ...current.profiles };
  if (!name && !description) {
    delete profiles[id];
  } else {
    profiles[id] = {
      ...(name ? { name } : {}),
      ...(description ? { description } : {}),
    };
  }
  return writeWodeAppAgentsOverride({ ...current, profiles });
}

export function applyAgentProfileEdit<T extends { id: string; name: string }>(
  agent: T,
  override: WodeAppAgentsOverride = readWodeAppAgentsOverride(),
): T {
  const edit = override.profiles?.[agent.id];
  if (!edit?.name) return agent;
  return { ...agent, name: edit.name };
}

export function hideShippedSidebarAgent(
  id: string,
  current: WodeAppAgentsOverride = readWodeAppAgentsOverride(),
): WodeAppAgentsOverride {
  const shipped = new Set(listShippedBuiltinAgentIds());
  if (!shipped.has(id)) return current;
  return writeWodeAppAgentsOverride({
    ...current,
    extraEnabledIds: current.extraEnabledIds.filter((item) => item !== id),
    hiddenIds: [...current.hiddenIds.filter((item) => item !== id), id],
  });
}

export function applySidebarAgentOrder<T extends { id: string }>(
  agents: readonly T[],
  order: readonly string[],
): T[] {
  if (order.length === 0) return [...agents];
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const next: T[] = [];
  for (const id of order) {
    const agent = byId.get(id);
    if (!agent) continue;
    next.push(agent);
    byId.delete(id);
  }
  for (const agent of agents) {
    if (byId.has(agent.id)) next.push(agent);
  }
  return next;
}

function normalizeSkillKey(raw: string): string {
  return raw.trim().toLowerCase().replace(/^(skill|custom)-/, "");
}

/** Client/demo brand agents stay in ~/.wodeapp/brand-agents.json, not the default sidebar. */
const SIDEBAR_EXCLUDED_BRAND_KEYS = new Set([
  "wynne",
  "wynne-brand-agent",
  "supor",
  "supor-brand-agent",
]);

export function isExcludedSidebarBrandAgent(agent: {
  id?: string;
  brandId?: string;
  name?: string;
}): boolean {
  const id = String(agent.id || "").trim().toLowerCase();
  const brandId = String(agent.brandId || "").trim().toLowerCase();
  const name = String(agent.name || "").trim();
  if (SIDEBAR_EXCLUDED_BRAND_KEYS.has(id) || SIDEBAR_EXCLUDED_BRAND_KEYS.has(brandId)) return true;
  return /wynne/i.test(name) || /苏泊尔|supor/i.test(name);
}

/** Sidebar pins user-added skills and custom agents created from the add dialog. */
export function isSidebarBrandPin(agent: {
  id?: string;
  brandId?: string;
  name?: string;
}): boolean {
  if (isExcludedSidebarBrandAgent(agent)) return false;
  const id = String(agent.id || "").trim().toLowerCase();
  const brandId = String(agent.brandId || "").trim().toLowerCase();
  return brandId === "skill"
    || brandId === "custom"
    || id.startsWith("skill-")
    || id.startsWith("custom-");
}

/** Keep custom/skill pins when disk hydrate would otherwise overwrite them. */
export function mergeDiskBrandAgentsWithLocalPins<T extends {
  id?: string;
  brandId?: string;
  name?: string;
  projectId?: string;
  launchUrl?: string;
}>(disk: readonly T[], local: readonly T[]): T[] {
  const localById = new Map(
    local
      .map((agent) => [String(agent.id || "").trim(), agent] as const)
      .filter(([id]) => id),
  );
  const merged = disk.map((agent) => {
    const extra = localById.get(String(agent.id || "").trim());
    if (!extra || !isSidebarBrandPin(agent)) return agent;
    const projectId = String(agent.projectId || extra.projectId || "").trim();
    const launchUrl = String(agent.launchUrl || extra.launchUrl || "").trim();
    if (
      (projectId && projectId !== String(agent.projectId || "").trim())
      || (launchUrl && launchUrl !== String(agent.launchUrl || "").trim())
    ) {
      return {
        ...agent,
        ...(projectId ? { projectId } : {}),
        ...(launchUrl ? { launchUrl } : {}),
      };
    }
    return agent;
  });
  const seen = new Set(merged.map((agent) => String(agent.id || "").trim()).filter(Boolean));
  const extras = local.filter((agent) => {
    const id = String(agent.id || "").trim();
    return Boolean(id) && isSidebarBrandPin(agent) && !seen.has(id);
  });
  return extras.length ? [...merged, ...extras] : merged;
}

export function resolveOfficialSkillPin(raw: string): {
  agentId: string;
  name: string;
  meta: string;
} | null {
  const key = normalizeSkillKey(raw);
  return WODEAPP_OFFICIAL_SKILL_PINS[key] || null;
}

export function formatSidebarSkillCopy(skill: WodeAppSkillPinInput): { name: string; meta: string } {
  const official = resolveOfficialSkillPin(skill.name);
  if (official) return { name: official.name, meta: official.meta };
  const name = humanizeSkillName(skill.name);
  return { name, meta: formatSkillMeta(skill.description) };
}

function humanizeSkillName(raw: string): string {
  const stripped = raw.trim().replace(/^(wodeappx?|skill)[-_]+/i, "").replace(/[-_]+/g, " ").trim();
  return clip(stripped || raw, 24);
}

function formatSkillMeta(description?: string): string {
  const text = (description || "").replace(/\s+/g, " ").trim();
  if (!text) return "已安装技能";
  const chinese = text.match(/[\u4e00-\u9fff]/g) || [];
  if (chinese.length < 4) return "已安装技能";
  return clip(text, 24);
}

export function resolveSidebarAgentId(raw: string, prefix = "skill"): string {
  const slug = slugifyPlazaId(raw).replace(new RegExp(`^${prefix}-`), "");
  const id = `${prefix}-${slug}`;
  if (ID_RE.test(id) && !RESERVED.has(id)) return id;
  return `${prefix}-${slugifyPlazaId(`${raw}-${Date.now().toString(36)}`)}`.slice(0, 64);
}

export function buildSkillBrandAgent(skill: WodeAppSkillPinInput): WodeAppBrandAgentConfig | null {
  const rawName = clip(skill.name, 64);
  if (!rawName) return null;
  if (resolveOfficialSkillPin(rawName)) return null;
  const copy = formatSidebarSkillCopy({ name: rawName, description: skill.description });
  return {
    id: resolveSidebarAgentId(rawName, "skill"),
    name: copy.name,
    brandId: "skill",
    meta: copy.meta,
    entryPrompt: `请使用「${rawName}」技能帮我处理接下来的任务。`,
    samplePrompt: clip(skill.description || `使用技能「${rawName}」。`, 4000),
    enabled: true,
  };
}

/** Prefill for 「添加智能体」: new chat, not a picker dialog. */
export function buildAddAgentGuideText(): string {
  return [
    "我想创建一个智能体。",
    "",
    "名称：",
    "它要帮我做什么：",
    "如果需要对应站点，站点用来：",
  ].join("\n");
}

/** Composer text for「自定义」: create a runtime project via the create-agent conversation. */
export function buildCustomCreateAgentDisplayText(input: {
  name: string;
  meta?: string;
  guidance?: string;
}): string | null {
  const name = clip(input.name, 64);
  if (!name) return null;
  const meta = clip(input.meta || "", 80);
  const guidance = clip(input.guidance || "", 2000);
  const lines = [`我想创建一个智能体应用，名称是「${name}」。`];
  if (meta) lines.push(`简介：${meta}`);
  lines.push("用途是：");
  lines.push(guidance || `按「${name}」的定位，创建一个可发布的 runtime 项目。`);
  return lines.join("\n");
}

export function buildCustomBrandAgent(input: {
  name: string;
  meta?: string;
  entryPrompt?: string;
  samplePrompt?: string;
  projectId?: string;
  launchUrl?: string;
}): WodeAppBrandAgentConfig | null {
  const name = clip(input.name, 64);
  if (!name) return null;
  const meta = clip(input.meta || "", 80);
  const entryPrompt = clip(input.entryPrompt || "", 500);
  const samplePrompt = clip(input.samplePrompt || "", 4000);
  const projectId = clip(input.projectId || "", 80);
  const launchUrl = clip(input.launchUrl || "", 500);
  return {
    id: resolveSidebarAgentId(name, "custom"),
    name,
    brandId: "custom",
    meta: meta || "自定义",
    entryPrompt: entryPrompt || `请以「${name}」的方式帮助我。`,
    samplePrompt: samplePrompt || meta || `使用自定义智能体「${name}」。`,
    ...(projectId ? { projectId } : {}),
    ...(launchUrl ? { launchUrl } : {}),
    enabled: true,
  };
}

export function parseGitSkillRepo(input: string): WodeAppGitSkillRepo | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hosted = trimmed.match(
    /(?:github\.com|gitee\.com|gitcode\.com)[:/]([^/\s]+)\/([^/\s#]+)/i,
  );
  if (hosted) {
    return {
      owner: hosted[1],
      repo: hosted[2].replace(/\.git$/i, ""),
      ref: "main",
      label: "自定义",
    };
  }
  const parts = trimmed.replace(/^https?:\/\//, "").split(/[/#]/).filter(Boolean);
  if (parts.length >= 2 && /^[A-Za-z0-9_.-]+$/.test(parts[0]) && /^[A-Za-z0-9_.-]+$/.test(parts[1])) {
    return {
      owner: parts[0],
      repo: parts[1].replace(/\.git$/i, ""),
      ref: parts[2] && /^[A-Za-z0-9._/-]+$/.test(parts[2]) ? parts[2] : "main",
      label: "自定义",
    };
  }
  return null;
}

export function skillHubRepoKey(repo: WodeAppGitSkillRepo): string {
  return `${repo.owner}/${repo.repo}@${repo.ref || "main"}`;
}

export function readStoredSkillHubRepos(): WodeAppGitSkillRepo[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(WODEAPP_SKILL_HUB_REPOS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const repos: WodeAppGitSkillRepo[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const owner = typeof record.owner === "string" ? record.owner.trim() : "";
      const repo = typeof record.repo === "string" ? record.repo.trim() : "";
      const ref = typeof record.ref === "string" && record.ref.trim() ? record.ref.trim() : "main";
      if (!owner || !repo) continue;
      repos.push({ owner, repo, ref, label: "自定义" });
    }
    return repos;
  } catch {
    return [];
  }
}

export function writeStoredSkillHubRepos(repos: WodeAppGitSkillRepo[]): WodeAppGitSkillRepo[] {
  if (typeof window === "undefined") return repos;
  try {
    window.localStorage.setItem(WODEAPP_SKILL_HUB_REPOS_STORAGE_KEY, JSON.stringify(repos));
  } catch {
    // ignore
  }
  return repos;
}

export function upsertSkillHubRepo(repo: WodeAppGitSkillRepo): WodeAppGitSkillRepo[] {
  const current = readStoredSkillHubRepos();
  const key = skillHubRepoKey(repo);
  if (current.some((item) => skillHubRepoKey(item) === key)) return current;
  return writeStoredSkillHubRepos([...current, { ...repo, label: repo.label || "自定义" }]);
}
