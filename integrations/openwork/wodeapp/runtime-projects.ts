/** 内置能力：打开工作台时优先使用用户项目，未绑定账号时回退官方内置入口。 */

import { canonicalizeVideoStoryboardWorkbenchUrl } from "./wodeapp-pvs-storyboard-url";
import {
  listEnabledWodeAppBuiltinAgentConfigs,
  type WodeAppAbilityKind,
  type WodeAppBuiltinAgentConfig,
  type WodeAppBuiltinAgentKind,
} from "./wodeapp-builtin-agents-config";
import {
  brandAgentConfigToBuiltinAgent,
  listEnabledWodeAppBrandAgents,
  readStoredWodeAppBrandAgents,
  type WodeAppBrandAgentConfig,
} from "./wodeapp-brand-agent-config";
import { WODEAPP_WYNNE_RUNTIME_PROFILE_ID } from "./wodeapp-runtime-profile";

export { AUTO_ORCHESTRATION_INSTRUCTION, AUTO_ORCHESTRATION_INSTRUCTION as PIPELINE_INSTRUCTION } from "./wodeapp-auto-orchestration";
export { WODEAPP_WYNNE_RUNTIME_PROFILE_ID } from "./wodeapp-runtime-profile";
export {
  listEnabledWodeAppBuiltinAgentConfigs,
  listShippedBuiltinAgentIds,
  normalizeWodeAppBuiltinAgentConfig,
  normalizeWodeAppBuiltinAgentsFile,
  WODEAPP_SHIPPED_BUILTIN_AGENTS_FILE,
  type WodeAppBuiltinAgentConfig,
  type WodeAppBuiltinAgentsFile,
} from "./wodeapp-builtin-agents-config";
export {
  WODEAPP_BRAND_AGENT_WYNNE_EXAMPLE,
  WODEAPP_BRAND_AGENTS_CHANGED_EVENT,
  WODEAPP_BRAND_AGENTS_STORAGE_KEY,
  WODEAPP_BRAND_CONNECTOR_SCOPES,
  WODEAPP_RESERVED_BUILTIN_AGENT_IDS,
  brandAgentConfigToBuiltinAgent,
  brandAgentConfigToRuntimeProfile,
  listEnabledWodeAppBrandAgents,
  normalizeWodeAppBrandAgentConfig,
  normalizeWodeAppBrandAgentsFile,
  readStoredWodeAppBrandAgents,
  validateWodeAppBrandAgentsFile,
  writeStoredWodeAppBrandAgents,
  type WodeAppBrandAgentConfig,
  type WodeAppBrandAgentFile,
  type WodeAppBrandAgentIssue,
  type WodeAppBrandAgentsValidation,
  type WodeAppBrandAgentWorkbench,
} from "./wodeapp-brand-agent-config";

export type { WodeAppBuiltinAgentKind, WodeAppAbilityKind };

export type WodeAppAbilityProject = {
  id: string;
  kind?: WodeAppAbilityKind | string;
  title?: string;
  projectId?: string;
  name?: string;
  slug?: string;
  subdomain?: string;
  url?: string;
  launchUrl?: string;
  createdAt?: string;
  updatedAt?: string;
};

/** 平台官方短剧剧本工作台（对外展示 / 未 bootstrap 时的兜底） */
export const WODEAPP_SHORT_DRAMA_OFFICIAL_URL = "https://script.wodeapp.cn";
export const WODEAPP_VIDEO_OFFICIAL_URL = "https://ai.wodeapp.cn/video";
export const WODEAPP_FEISHU_AGENT_ID = "feishu-agent-mcp";
export const WODEAPP_FEISHU_MCP_SERVER = "lark-mcp";
export const WODEAPP_FEISHU_SETUP_SKILL_NAME = "wodeappx-feishu-app-setup";
export const WODEAPP_WYNNE_AGENT_ID = WODEAPP_WYNNE_RUNTIME_PROFILE_ID;

export type WodeAppBuiltinAgentVisibilityOptions = {
  feishuSetupSkillReady?: boolean;
  /**
   * Feishu agent is temporarily off product surfaces even when its setup skill is discovered.
   * Re-enable by passing feishuAgentReady: true (still requires feishuSetupSkillReady).
   */
  feishuAgentReady?: boolean;
  /** Pass false only when a deployment explicitly needs to hide the canvas agent. */
  canvasAgentReady?: boolean;
  /** Pass false only to temporarily hide the short-drama agent tile. */
  shortDramaAgentReady?: boolean;
  /**
   * Configured brand agents (from ~/.wodeapp/brand-agents.json / local cache).
   * Empty by default — customer brands are not built-in product agents.
   */
  brandAgents?: readonly WodeAppBrandAgentConfig[];
  /** True when ~/.wodeapp/keys.json has a vendor Key. Chat stays local-first; signed-in runtime workbench stays cloud. */
  hasLocalKeys?: boolean;
  /** Force local workbench URLs (OSS / local-only). Cloud official URLs are skipped. */
  preferLocal?: boolean;
  profile?: string | null;
  origin?: string | null;
  issuedOrigin?: string | null;
  ossEdition?: boolean;
};

export const LOCAL_RUNTIME_APP_ORIGIN = "http://localhost:5176";

let abilityWorkbenchContext: {
  preferLocal: boolean;
  origin?: string | null;
  profile?: string | null;
  hasLocalKeys?: boolean;
} = { preferLocal: false };

export function setAbilityWorkbenchContext(next: {
  preferLocal?: boolean;
  origin?: string | null;
  profile?: string | null;
  issuedOrigin?: string | null;
  ossEdition?: boolean;
  hasLocalKeys?: boolean;
} = {}) {
  const preferLocal = shouldPreferLocalAbilityWorkbench(next);
  abilityWorkbenchContext = {
    preferLocal,
    origin: next.origin ?? abilityWorkbenchContext.origin,
    profile: next.profile ?? abilityWorkbenchContext.profile,
    hasLocalKeys: typeof next.hasLocalKeys === "boolean"
      ? next.hasLocalKeys
      : abilityWorkbenchContext.hasLocalKeys,
  };
}

export function getAbilityWorkbenchContext() {
  return abilityWorkbenchContext;
}

export function isLocalWodeAppOrigin(origin?: string | null): boolean {
  if (!origin) return false;
  try {
    const host = new URL(origin.includes("://") ? origin : `http://${origin}`).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return /localhost|127\.0\.0\.1/.test(origin);
  }
}

export function isCloudWodeAppWorkbenchUrl(url?: string | null): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "wodeapp.cn"
      || host === "wodeapp.ai"
      || host.endsWith(".wodeapp.cn")
      || host.endsWith(".wodeapp.ai");
  } catch {
    return /wodeapp\.(cn|ai)/i.test(url);
  }
}

/** Shared demo sites — never a user's ability project. */
const OFFICIAL_ABILITY_DEMO_HOSTS = new Set([
  "yougi.wodeapp.cn",
  "ai.wodeapp.cn",
  "zhousiying.wodeapp.cn",
  "script.wodeapp.cn",
]);

export function isOfficialAbilityDemoUrl(url?: string | null): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return OFFICIAL_ABILITY_DEMO_HOSTS.has(host);
  } catch {
    return /yougi\.wodeapp\.cn|ai\.wodeapp\.cn|zhousiying\.wodeapp\.cn|script\.wodeapp\.cn/i.test(url);
  }
}

/** Logged-in cloud workbench: the user's published project, not yougi / ai.wodeapp.cn. */
export function buildOwnedAbilityLaunchUrl(slug: string, origin?: string | null): string {
  const id = slug.trim();
  if (!id) return "";
  if (abilityWorkbenchContext.preferLocal || isLocalWodeAppOrigin(origin)) {
    return buildLocalAbilityLaunchUrl(id);
  }
  const suffix = (origin || "").includes("wodeapp.ai") ? ".wodeapp.ai" : ".wodeapp.cn";
  return `https://${id}${suffix}`;
}

export function buildLocalAbilityLaunchUrl(slug: string, runtimeOrigin = LOCAL_RUNTIME_APP_ORIGIN): string {
  const url = new URL(runtimeOrigin);
  url.searchParams.set("project", slug.trim());
  return url.toString();
}

export function rewriteAbilityLaunchUrlForLocal(url: string, slug?: string | null): string {
  const fromSlug = typeof slug === "string" && slug.trim() ? slug.trim() : "";
  if (fromSlug) return buildLocalAbilityLaunchUrl(fromSlug);
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const sub = host.replace(/\.wodeapp\.(cn|ai)$/i, "");
    if (sub && sub !== host) return buildLocalAbilityLaunchUrl(sub);
  } catch {
    // keep original
  }
  return url;
}

export function shouldPreferLocalAbilityWorkbench(input: {
  preferLocal?: boolean;
  hasLocalKeys?: boolean;
  profile?: string | null;
  origin?: string | null;
  issuedOrigin?: string | null;
  ossEdition?: boolean;
} = {}): boolean {
  if (typeof input.preferLocal === "boolean") return input.preferLocal;
  if (input.profile === "local-only") return true;
  if (isLocalWodeAppOrigin(input.origin) || isLocalWodeAppOrigin(input.issuedOrigin)) return true;
  // Signed-in runtime project = the user's cloud workbench. Chat stays local-first separately.
  if (input.profile === "cloud") return false;
  if (isCloudWodeAppWorkbenchUrl(input.origin || "") || isCloudWodeAppWorkbenchUrl(input.issuedOrigin || "")) {
    return false;
  }
  if (input.hasLocalKeys === true) return true;
  if (!input.profile) return true;
  return Boolean(input.ossEdition);
}

export function localizeAbilityProjects(
  projects: readonly WodeAppAbilityProject[],
  preferLocal = abilityWorkbenchContext.preferLocal,
): WodeAppAbilityProject[] {
  if (!preferLocal) return projects.map((item) => ({ ...item }));
  return projects.map((project) => {
    const raw = project.launchUrl || project.url || "";
    if (raw && /localhost|127\.0\.0\.1/.test(raw) && !/wodeapp\.(cn|ai)/i.test(raw)) {
      return { ...project };
    }
    const agentId = typeof project.id === "string" ? project.id.trim() : "";
    const slug = (project.subdomain || project.slug || "").trim();
    const localId = agentId || slug;
    if (!localId) {
      if (!raw || !isCloudWodeAppWorkbenchUrl(raw)) return { ...project };
      const url = rewriteAbilityLaunchUrlForLocal(raw);
      return { ...project, url, launchUrl: url };
    }
    const url = buildLocalAbilityLaunchUrl(localId);
    return { ...project, url, launchUrl: url };
  });
}

/** Sidebar / starter entry temporarily removed from product surfaces. */
export const WODEAPP_CANVAS_AGENT_ID = "agent-infinite-canvas";
/** 侧栏「创建智能体」：Skill 物化优先 → 模板 → 空白 ai_generate_page → 发布。 */
export const WODEAPP_CREATE_AGENT_ID = "create-agent";
/** 短剧智能体：剧本编辑台（script.wodeapp.cn）；出片与脚本可视化（单帧/九宫格/视频）走视频分镜工作台。 */
export const WODEAPP_SCRIPT_STORYBOARD_AGENT_ID = "script-storyboard";

export function hasWodeAppFeishuSetupSkill(skills: unknown): boolean {
  if (!Array.isArray(skills)) return false;
  return skills.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const name = (item as Record<string, unknown>).name;
    return typeof name === "string" && name.trim() === WODEAPP_FEISHU_SETUP_SKILL_NAME;
  });
}

export type WodeAppBuiltinAgent = {
  id: string;
  name: string;
  meta: string;
  kind: WodeAppBuiltinAgentKind;
  abilityKind?: WodeAppAbilityKind;
  defaultUrl?: string;
  /** 用户可见的短入口文案（composer 展示） */
  entryPrompt?: string;
  samplePrompt: string;
  /** Bind a normal conversation to compact routing metadata instead of a hidden knowledge prompt. */
  runtimeProfileId?: string;
  demoUrl?: string;
  /** 是否在点击入口后立即把入口文案发送给智能体。 */
  autoSend?: boolean;
};

const WODEAPP_ABILITY_PROJECTS_STORAGE_KEY_PREFIX = "wodeappx:ability-projects:v2";
const LEGACY_WODEAPP_ABILITY_PROJECTS_STORAGE_KEY = "wodeappx:ability-projects:v1";
let cachedAbilityProjects: WodeAppAbilityProject[] | null = null;
let cachedAbilityProjectsUserId: string | null = null;

function abilityProjectsStorageKey(userId: string) {
  return `${WODEAPP_ABILITY_PROJECTS_STORAGE_KEY_PREFIX}:${userId}`;
}

function clearLegacyAbilityProjectsStorage() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LEGACY_WODEAPP_ABILITY_PROJECTS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function clearWodeAppAbilityProjects() {
  cachedAbilityProjects = null;
  cachedAbilityProjectsUserId = null;
  if (typeof window === "undefined") return;
  try {
    clearLegacyAbilityProjectsStorage();
    const keysToRemove: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(WODEAPP_ABILITY_PROJECTS_STORAGE_KEY_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // ignore
  }
}

export function setWodeAppAbilityProjects(projects: unknown, userId?: string | null) {
  const normalizedUserId = typeof userId === "string" && userId.trim() ? userId.trim() : null;
  if (!normalizedUserId) {
    clearWodeAppAbilityProjects();
    return;
  }
  cachedAbilityProjectsUserId = normalizedUserId;
  cachedAbilityProjects = localizeAbilityProjects(normalizeAbilityProjects(projects));
  if (typeof window === "undefined") return;
  try {
    clearLegacyAbilityProjectsStorage();
    window.localStorage.setItem(
      abilityProjectsStorageKey(normalizedUserId),
      JSON.stringify(cachedAbilityProjects),
    );
  } catch {
    // Ignore storage failures; current in-memory state is enough for this session.
  }
}

export function readWodeAppAbilityProjects(userId?: string | null): WodeAppAbilityProject[] {
  const normalizedUserId = typeof userId === "string" && userId.trim()
    ? userId.trim()
    : cachedAbilityProjectsUserId;
  if (!normalizedUserId) {
    return cachedAbilityProjects ?? [];
  }
  if (cachedAbilityProjectsUserId === normalizedUserId && cachedAbilityProjects) {
    return cachedAbilityProjects;
  }
  if (typeof window === "undefined") return [];
  try {
    clearLegacyAbilityProjectsStorage();
    cachedAbilityProjects = localizeAbilityProjects(normalizeAbilityProjects(
      JSON.parse(window.localStorage.getItem(abilityProjectsStorageKey(normalizedUserId)) || "[]"),
    ));
    cachedAbilityProjectsUserId = normalizedUserId;
  } catch {
    cachedAbilityProjects = [];
    cachedAbilityProjectsUserId = normalizedUserId;
  }
  return cachedAbilityProjects;
}

function builtinConfigToAgent(config: WodeAppBuiltinAgentConfig): WodeAppBuiltinAgent {
  return {
    id: config.id,
    name: config.name,
    meta: config.meta ?? "",
    kind: config.kind,
    abilityKind: config.abilityKind,
    defaultUrl: config.defaultUrl,
    entryPrompt: config.entryPrompt,
    samplePrompt: config.samplePrompt,
    runtimeProfileId: config.runtimeProfileId,
    demoUrl: config.demoUrl,
    autoSend: config.autoSend,
  };
}

/** Layer 0: shipped default config (`wodeapp-builtin-agents.default.json`). */
export const WODEAPP_BUILTIN_AGENTS: readonly WodeAppBuiltinAgent[] =
  listEnabledWodeAppBuiltinAgentConfigs().map(builtinConfigToAgent);

/** @deprecated 使用 WODEAPP_BUILTIN_AGENTS */
export const WODEAPP_RUNTIME_PROJECTS = WODEAPP_BUILTIN_AGENTS;

/** @deprecated 使用 WodeAppBuiltinAgent */
export type WodeAppRuntimeProject = WodeAppBuiltinAgent;

export const WODEAPP_OPEN_AGENT_VIEW_EVENT = "wodeapp:open-agent-view";

export function isWodeAppBuiltinAgentVisible(
  agent: WodeAppBuiltinAgent,
  options: WodeAppBuiltinAgentVisibilityOptions = {},
): boolean {
  const registered = WODEAPP_BUILTIN_AGENTS.some((item) => item.id === agent.id);
  if (!registered) return false;
  // Industry packs are whole-shell adaptations (self-evolve / Skill), not sidebar agents.
  if (agent.kind === "industry") return false;
  if (agent.id === WODEAPP_SCRIPT_STORYBOARD_AGENT_ID) {
    // 短剧智能体已重新上线：默认可见；仍可用 shortDramaAgentReady:false 临时隐藏
    return options.shortDramaAgentReady !== false;
  }
  if (agent.id === WODEAPP_FEISHU_AGENT_ID) {
    return options.feishuAgentReady === true && options.feishuSetupSkillReady === true;
  }
  if (agent.id === WODEAPP_CANVAS_AGENT_ID) return options.canvasAgentReady !== false;
  return true;
}

export function getConfiguredBrandBuiltinAgents(
  options: WodeAppBuiltinAgentVisibilityOptions = {},
): WodeAppBuiltinAgent[] {
  const configured = listEnabledWodeAppBrandAgents(
    options.brandAgents ?? readStoredWodeAppBrandAgents(),
  );
  const builtinIds = new Set(WODEAPP_BUILTIN_AGENTS.map((item) => item.id));
  return configured
    .filter((agent) => !builtinIds.has(agent.id))
    .map((agent) => brandAgentConfigToBuiltinAgent(agent));
}

export function getVisibleWodeAppBuiltinAgents(
  options: WodeAppBuiltinAgentVisibilityOptions = {},
): WodeAppBuiltinAgent[] {
  return [
    ...WODEAPP_BUILTIN_AGENTS.filter((agent) => isWodeAppBuiltinAgentVisible(agent, options)),
    ...getConfiguredBrandBuiltinAgents(options),
  ];
}

function normalizeAbilityProjects(projects: unknown): WodeAppAbilityProject[] {
  if (!Array.isArray(projects)) return [];
  return projects
    .map((item): WodeAppAbilityProject | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id.trim() : "";
      const url = typeof record.launchUrl === "string" && record.launchUrl.trim()
        ? record.launchUrl.trim()
        : typeof record.url === "string"
          ? record.url.trim()
          : "";
      if (!id || !url) return null;
      return {
        id,
        kind: typeof record.kind === "string" ? record.kind : undefined,
        title: typeof record.title === "string" ? record.title : undefined,
        projectId: typeof record.projectId === "string" ? record.projectId : undefined,
        name: typeof record.name === "string" ? record.name : undefined,
        slug: typeof record.slug === "string" ? record.slug : undefined,
        subdomain: typeof record.subdomain === "string" ? record.subdomain : undefined,
        url,
        launchUrl: url,
        createdAt: typeof record.createdAt === "string" ? record.createdAt : undefined,
        updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : undefined,
      };
    })
    .filter((item): item is WodeAppAbilityProject => Boolean(item));
}

export function pickAbilityProjects(
  fromAuth: readonly WodeAppAbilityProject[] | undefined,
  userId?: string | null,
): WodeAppAbilityProject[] {
  if (fromAuth?.length) return localizeAbilityProjects(fromAuth);
  return localizeAbilityProjects(readWodeAppAbilityProjects(userId));
}

export function matchAbilityProject(agent: WodeAppBuiltinAgent, projects: readonly WodeAppAbilityProject[]) {
  return projects.find((project) => project.id === agent.id)
    || (agent.abilityKind ? projects.find((project) => project.kind === agent.abilityKind) : undefined);
}

function preferLocalWorkbench(options: WodeAppBuiltinAgentVisibilityOptions = {}): boolean {
  if (typeof options.preferLocal === "boolean") return options.preferLocal;
  if (typeof options.hasLocalKeys === "boolean") {
    return shouldPreferLocalAbilityWorkbench({
      ...options,
      hasLocalKeys: options.hasLocalKeys,
    });
  }
  if (
    options.profile
    || options.origin
    || options.issuedOrigin
    || typeof options.ossEdition === "boolean"
  ) {
    return shouldPreferLocalAbilityWorkbench({
      ...options,
      hasLocalKeys: abilityWorkbenchContext.hasLocalKeys,
    });
  }
  return abilityWorkbenchContext.preferLocal;
}

export function resolveWodeAppBuiltinAgent(
  agent: WodeAppBuiltinAgent,
  projects: readonly WodeAppAbilityProject[] = readWodeAppAbilityProjects(),
  options: WodeAppBuiltinAgentVisibilityOptions = {},
): WodeAppBuiltinAgent {
  const preferLocal = preferLocalWorkbench(options);
  if (preferLocal) {
    return { ...agent, demoUrl: buildLocalAbilityLaunchUrl(agent.id) };
  }
  const project = matchAbilityProject(agent, localizeAbilityProjects(projects, preferLocal));
  const slug = project?.subdomain || project?.slug || "";
  const rawLaunch = project?.launchUrl || project?.url || "";
  const launchUrl = rawLaunch && !isOfficialAbilityDemoUrl(rawLaunch)
    ? rawLaunch
    : "";
  if (launchUrl) {
    return { ...agent, demoUrl: launchUrl };
  }
  if (slug) {
    return {
      ...agent,
      demoUrl: buildOwnedAbilityLaunchUrl(slug, options.origin || abilityWorkbenchContext.origin),
    };
  }
  return { ...agent, demoUrl: undefined };
}

export function resolveWodeAppBuiltinAgents(
  projects: readonly WodeAppAbilityProject[] = readWodeAppAbilityProjects(),
  options: WodeAppBuiltinAgentVisibilityOptions = {},
): WodeAppBuiltinAgent[] {
  return getVisibleWodeAppBuiltinAgents(options).map((agent) => resolveWodeAppBuiltinAgent(agent, projects, options));
}

export function isWodeAppBuiltinAgentAvailable(
  agent: WodeAppBuiltinAgent,
  projects: readonly WodeAppAbilityProject[] = readWodeAppAbilityProjects(),
): boolean {
  if (agent.kind === "integration" || agent.kind === "industry" || agent.kind === "brand") return true;
  // Chat-only entries (e.g. 创建智能体) have no workbench URL / ability project.
  if (agent.id === WODEAPP_CREATE_AGENT_ID) return true;
  // Capability agents stay in the sidebar; URL comes from the user's project or local sidecar.
  if (agent.abilityKind) return true;
  return Boolean(matchAbilityProject(agent, projects));
}

export function resolveAvailableWodeAppBuiltinAgents(
  projects: readonly WodeAppAbilityProject[] = readWodeAppAbilityProjects(),
  options: WodeAppBuiltinAgentVisibilityOptions = {},
): WodeAppBuiltinAgent[] {
  return getVisibleWodeAppBuiltinAgents(options)
    .filter((agent) => isWodeAppBuiltinAgentAvailable(agent, projects))
    .map((agent) => resolveWodeAppBuiltinAgent(agent, projects, options));
}

export function findWodeAppBuiltinAgent(
  id: string,
  projects?: readonly WodeAppAbilityProject[],
  options: WodeAppBuiltinAgentVisibilityOptions = {},
) {
  const agent = getVisibleWodeAppBuiltinAgents(options).find((item) => item.id === id)
    || WODEAPP_BUILTIN_AGENTS.find((item) => item.id === id);
  return agent ? resolveWodeAppBuiltinAgent(agent, projects, options) : undefined;
}

function withWodeAppXSourceParam(url: string): string {
  try {
    const next = new URL(url);
    if (!next.searchParams.has("wodeappx")) next.searchParams.set("wodeappx", "1");
    return next.toString();
  } catch {
    return url;
  }
}

function withAgentEmbedParam(url: string): string {
  try {
    const next = new URL(url);
    if (!next.searchParams.has("embed")) next.searchParams.set("embed", "1");
    return next.toString();
  } catch {
    return url;
  }
}

export function openWodeAppBuiltinAgentView(
  agent: WodeAppBuiltinAgent,
  projects?: readonly WodeAppAbilityProject[],
  sessionId?: string,
  options: WodeAppBuiltinAgentVisibilityOptions = {},
): boolean {
  const resolved = resolveWodeAppBuiltinAgent(agent, projects, options);
  if (!resolved.demoUrl || typeof window === "undefined") return false;

  const embedUrl = withAgentEmbedParam(withWodeAppXSourceParam(resolved.demoUrl));
  const scopedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";

  window.dispatchEvent(new CustomEvent(WODEAPP_OPEN_AGENT_VIEW_EVENT, {
    detail: {
      ...resolved,
      demoUrl: embedUrl,
      ...(scopedSessionId ? { sessionId: scopedSessionId } : {}),
    },
  }));
  window.dispatchEvent(new CustomEvent("openwork-open-right-pane", {
    detail: {
      pane: "browser",
      url: embedUrl,
      ...(scopedSessionId ? { sessionId: scopedSessionId } : {}),
    },
  }));
  return true;
}

/**
 * 打开一个显式的任务 URL（如带 shareDoc 的多条/分镜视频任务链接），跳过 resolveWodeAppBuiltinAgent
 * 对 demoUrl 的项目默认 launchUrl 覆盖。用于对话动作已经拼好具体任务链接、必须原样展开的场景。
 */
export async function openWodeAppAgentTaskUrl(
  agent: WodeAppBuiltinAgent,
  taskUrl: string,
  sessionId?: string,
): Promise<boolean> {
  if (!taskUrl || typeof window === "undefined") return false;

  const canonicalTaskUrl = canonicalizeVideoStoryboardWorkbenchUrl(taskUrl) || taskUrl;
  const embedUrl = withAgentEmbedParam(withWodeAppXSourceParam(canonicalTaskUrl));
  const scopedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";

  window.dispatchEvent(new CustomEvent(WODEAPP_OPEN_AGENT_VIEW_EVENT, {
    detail: {
      ...agent,
      demoUrl: embedUrl,
      ...(scopedSessionId ? { sessionId: scopedSessionId } : {}),
    },
  }));
  // The session page owns native-browser activation. Passing the task URL to
  // that handler avoids a race where a tab is created before session ownership
  // is restored and then immediately disappears from the third column.
  window.dispatchEvent(new CustomEvent("openwork-open-right-pane", {
    detail: {
      pane: "browser",
      url: embedUrl,
      ...(scopedSessionId ? { sessionId: scopedSessionId } : {}),
    },
  }));
  return true;
}

export function openBuiltinAgentDemo(agent: WodeAppBuiltinAgent) {
  openWodeAppBuiltinAgentView(agent);
}

/** @deprecated 使用 openBuiltinAgentDemo */
export function openRuntimeProjectInBrowser(agent: WodeAppBuiltinAgent) {
  openBuiltinAgentDemo(agent);
}
