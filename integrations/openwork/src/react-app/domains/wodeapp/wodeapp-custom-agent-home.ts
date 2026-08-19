/**
 * Custom sidebar agents are the created agent, not a name sticker.
 * After create-agent publishes a project, that project is the agent's home.
 * Later turns selected on this agent work from that home.
 */

import {
  normalizeWodeAppBrandAgentsFile,
  readStoredWodeAppBrandAgents,
  writeStoredWodeAppBrandAgents,
  type WodeAppBrandAgentConfig,
} from "./wodeapp-brand-agent-config";
import {
  buildCustomBrandAgent,
  isSidebarBrandPin,
} from "./wodeapp-sidebar-agents";

export const WODEAPP_CUSTOM_AGENT_CREATE_SESSION_KEY = "wodeappx:custom-agent-create-session:v1";

export type WodeAppCustomAgentHome = {
  projectId?: string;
  launchUrl?: string;
};

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;
const SHORT_PROJECT_ID_RE = /[0-9a-f]{8,32}/i;
const PROJECT_ID_FIELD_RE = /"(?:projectId|id)"\s*:\s*"((?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})|[0-9a-f]{8,32})"/i;
const PROJECT_ID_LABEL_RE = /项目[^。\n]{0,24}(?:ID|id)[：:\s`]*([0-9a-f]{8,32})/;
const SITE_RE = /https?:\/\/[a-z0-9][a-z0-9.-]*\.wodeapp\.(?:cn|ai)(?:\/[^\s"'<>]*)?/i;
const SLUG_RE = /"slug"\s*:\s*"([a-z0-9-]{2,80})"/i;

function isProjectId(value: string): boolean {
  const id = value.trim();
  return UUID_RE.test(id) || (SHORT_PROJECT_ID_RE.test(id) && id.length <= 32 && !id.includes(" "));
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function asHome(input: WodeAppCustomAgentHome | null | undefined): WodeAppCustomAgentHome | null {
  const projectId = input?.projectId?.trim() ? clip(input.projectId.trim(), 80) : undefined;
  const launchUrl = input?.launchUrl?.trim() ? clip(input.launchUrl.trim(), 500) : undefined;
  if (!projectId && !launchUrl) return null;
  return { projectId, launchUrl };
}

function mergeHome(
  current: WodeAppCustomAgentHome | null,
  next: WodeAppCustomAgentHome | null,
): WodeAppCustomAgentHome | null {
  if (!current) return next;
  if (!next) return current;
  return asHome({
    projectId: current.projectId || next.projectId,
    launchUrl: current.launchUrl || next.launchUrl,
  });
}

function urlFromSlug(slug: string, hint?: string): string {
  const host = hint?.includes("wodeapp.ai") ? "wodeapp.ai" : "wodeapp.cn";
  return `https://${slug}.${host}`;
}

function homeFromRecord(record: Record<string, unknown>, hint?: string): WodeAppCustomAgentHome | null {
  const projectId = typeof record.projectId === "string"
    ? record.projectId.trim()
    : typeof record.id === "string" && isProjectId(record.id)
      ? record.id.trim()
      : "";
  const launchUrl = [
    record.launchUrl,
    record.publishedUrl,
    record.url,
    record.siteUrl,
  ].find((value): value is string => typeof value === "string" && SITE_RE.test(value));
  const slug = typeof record.slug === "string" ? record.slug.trim() : "";
  return asHome({
    projectId: isProjectId(projectId) ? projectId : undefined,
    launchUrl: launchUrl
      || (slug && /^[a-z0-9-]{2,80}$/i.test(slug) ? urlFromSlug(slug, hint) : undefined),
  });
}

function walkForHome(value: unknown, depth = 0): WodeAppCustomAgentHome | null {
  if (depth > 8 || value == null) return null;
  if (typeof value === "string") return extractPublishedProjectFromText(value);
  if (Array.isArray(value)) {
    let found: WodeAppCustomAgentHome | null = null;
    for (const item of value) found = mergeHome(found, walkForHome(item, depth + 1));
    return found;
  }
  if (typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  let found = homeFromRecord(record);
  for (const key of ["output", "content", "result", "text", "state", "parts", "messages", "data"]) {
    if (key in record) found = mergeHome(found, walkForHome(record[key], depth + 1));
  }
  return found;
}

export function extractPublishedProjectFromText(text: string): WodeAppCustomAgentHome | null {
  const raw = text.trim();
  if (!raw) return null;
  if (raw.startsWith("{") || raw.startsWith("[")) {
    try {
      return walkForHome(JSON.parse(raw));
    } catch {
      // Fall through to regex scrape.
    }
  }
  const site = raw.match(SITE_RE)?.[0];
  const projectId = raw.match(UUID_RE)?.[0]
    || raw.match(PROJECT_ID_FIELD_RE)?.[1]
    || raw.match(PROJECT_ID_LABEL_RE)?.[1];
  const slug = raw.match(SLUG_RE)?.[1];
  return asHome({
    projectId: projectId && isProjectId(projectId) ? projectId : undefined,
    launchUrl: site || (slug ? urlFromSlug(slug, raw) : undefined),
  });
}

function firstUserText(value: unknown, depth = 0): string {
  if (depth > 8 || value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = firstUserText(item, depth + 1);
      if (text) return text;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const role = typeof record.role === "string"
    ? record.role
    : record.info && typeof record.info === "object"
      ? String((record.info as { role?: unknown }).role || "")
      : "";
  if (role && role !== "user") return "";
  if (typeof record.text === "string" && record.text.trim() && (!role || role === "user")) {
    return record.text.trim();
  }
  for (const key of ["parts", "messages", "content"]) {
    if (key in record) {
      const text = firstUserText(record[key], depth + 1);
      if (text) return text;
    }
  }
  return "";
}

function collectUserText(value: unknown, depth = 0): string {
  if (depth > 8 || value == null) return "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    return value.map((item) => collectUserText(item, depth + 1)).filter(Boolean).join("\n");
  }
  if (typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const role = typeof record.role === "string"
    ? record.role
    : record.info && typeof record.info === "object"
      ? String((record.info as { role?: unknown }).role || "")
      : "";
  if (role && role !== "user") return "";
  const chunks: string[] = [];
  if (typeof record.text === "string" && record.text.trim()) chunks.push(record.text.trim());
  for (const key of ["parts", "messages", "content"]) {
    if (key in record) {
      const text = collectUserText(record[key], depth + 1);
      if (text) chunks.push(text);
    }
  }
  return chunks.join("\n");
}

function normalizeAgentKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

const GENERIC_AGENT_TOKENS = new Set(["管理", "助手", "智能体", "agent", "custom", "app", "helper"]);

function agentTokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter((token) => token.length >= 2);
}

function expandAgentToken(token: string): string[] {
  if (token === "ph" || token === "producthunt") return ["ph", "producthunt", "product", "hunt"];
  return [token];
}

function distinctiveAgentTokens(value: string): string[] {
  return [...new Set(agentTokens(value).flatMap(expandAgentToken))]
    .filter((token) => !GENERIC_AGENT_TOKENS.has(token));
}

function tokensOverlap(left: string, right: string): boolean {
  const a = distinctiveAgentTokens(left);
  const b = distinctiveAgentTokens(right);
  return a.some((token) => b.includes(token));
}

export function inferCustomAgentDraftFromText(text: string): { name: string; meta?: string } | null {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const named = raw.match(/名称[：:]\s*([^\s。，,]{1,32})/);
  if (named?.[1]?.trim()) {
    const name = named[1].replace(/\s+/g, " ").trim();
    if (name && name.length <= 32) {
      return { name: clip(name, 64), meta: clip(raw.split(/[。\n]/)[0] || name, 80) };
    }
  }
  const match = raw.match(/(?:生成|创建|做一个|做个|新建|保存)一个?\s*([^。\n]{1,40}?)\s*智能体(?!应用)/);
  if (!match) return null;
  let name = match[1].replace(/^(一个|个|ai)\s*/i, "").trim();
  name = name.replace(/\bph\b/ig, "PH");
  name = name.replace(/\s+/g, " ").trim();
  if (!name || name.length > 32) return null;
  return { name: clip(name, 64), meta: clip(raw.split(/[。\n]/)[0] || name, 80) };
}

function matchExistingCustomAgent(
  existing: readonly WodeAppBrandAgentConfig[],
  draft: { name: string },
): WodeAppBrandAgentConfig | undefined {
  const key = normalizeAgentKey(draft.name);
  if (!key) return undefined;
  const pins = existing.filter((agent) => isSidebarBrandPin(agent) && agent.brandId === "custom");
  const named = pins.find((agent) => {
    const nameKey = normalizeAgentKey(agent.name);
    const idKey = normalizeAgentKey(agent.id.replace(/^custom-/, ""));
    return nameKey === key
      || nameKey.includes(key)
      || key.includes(nameKey)
      || idKey === key
      || idKey.includes(key)
      || tokensOverlap(agent.name, draft.name)
      || tokensOverlap(agent.id.replace(/^custom-/, ""), draft.name);
  });
  if (named) return named;
  const homeless = pins.filter((agent) => !agent.launchUrl);
  return homeless.length === 1 ? homeless[0] : undefined;
}

export function extractPublishedProjectFromMessages(messages: unknown): WodeAppCustomAgentHome | null {
  return walkForHome(messages);
}

function readCreateSessionMap(): Record<string, string> {
  if (typeof window === "undefined") return memoryCreateSessions;
  try {
    const raw = window.localStorage.getItem(WODEAPP_CUSTOM_AGENT_CREATE_SESSION_KEY);
    if (!raw) return { ...memoryCreateSessions };
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const next: Record<string, string> = { ...memoryCreateSessions };
    for (const [sessionId, agentId] of Object.entries(parsed)) {
      if (typeof agentId === "string" && agentId.trim()) next[sessionId] = agentId.trim();
    }
    return next;
  } catch {
    return { ...memoryCreateSessions };
  }
}

const memoryCreateSessions: Record<string, string> = {};

export function rememberCustomAgentCreateSession(sessionId: string, agentId: string): void {
  const session = sessionId.trim();
  const agent = agentId.trim();
  if (!session || !agent) return;
  memoryCreateSessions[session] = agent;
  if (typeof window === "undefined") return;
  try {
    const next = { ...readCreateSessionMap(), [session]: agent };
    window.localStorage.setItem(WODEAPP_CUSTOM_AGENT_CREATE_SESSION_KEY, JSON.stringify(next));
  } catch {
    // In-memory map is enough for the current create conversation.
  }
}

export function readCustomAgentIdForCreateSession(sessionId: string): string | null {
  const session = sessionId.trim();
  if (!session) return null;
  return readCreateSessionMap()[session] || null;
}

export function buildCustomAgentHomeContract(
  agent: {
    meta?: string;
    samplePrompt?: string;
    projectId?: string;
    launchUrl?: string;
  },
  editDescription?: string,
): string {
  const identity = [
    editDescription?.trim(),
    agent.samplePrompt?.trim(),
    agent.meta?.trim(),
  ].find(Boolean) || "";
  const home: string[] = [];
  if (agent.launchUrl?.trim()) home.push(`这个智能体的项目：${agent.launchUrl.trim()}`);
  if (agent.projectId?.trim()) home.push(`projectId：${agent.projectId.trim()}`);
  return [identity, home.join("\n")].filter(Boolean).join("\n\n");
}

export function applyCustomAgentHome<T extends WodeAppCustomAgentHome>(
  agent: T,
  home: WodeAppCustomAgentHome,
): T {
  const next = asHome({
    projectId: agent.projectId || home.projectId,
    launchUrl: agent.launchUrl || home.launchUrl,
  });
  if (!next) return agent;
  return {
    ...agent,
    ...(next.projectId ? { projectId: next.projectId } : {}),
    ...(next.launchUrl ? { launchUrl: next.launchUrl } : {}),
  };
}

function sameHome(agent: WodeAppBrandAgentConfig, home: WodeAppCustomAgentHome): boolean {
  const projectId = home.projectId?.trim() || "";
  const launchUrl = home.launchUrl?.trim() || "";
  return (
    (!projectId || agent.projectId === projectId)
    && (!launchUrl || agent.launchUrl === launchUrl)
  );
}

function withBoundHome(agent: WodeAppBrandAgentConfig, home: WodeAppCustomAgentHome): WodeAppBrandAgentConfig {
  const next = applyCustomAgentHome(agent, home);
  const samplePrompt = buildCustomAgentHomeContract(next);
  return samplePrompt ? { ...next, samplePrompt } : next;
}

async function readDiskBrandAgents(): Promise<WodeAppBrandAgentConfig[]> {
  const { listWodeAppBrandAgents } = await import("@/app/lib/wodeapp-auth");
  const listed = await listWodeAppBrandAgents().catch(() => ({ ok: false as const, agents: [] }));
  return listed.ok
    ? normalizeWodeAppBrandAgentsFile(listed).agents
    : readStoredWodeAppBrandAgents();
}

async function writeDiskBrandAgents(agents: WodeAppBrandAgentConfig[]): Promise<boolean> {
  const { saveWodeAppBrandAgents } = await import("@/app/lib/wodeapp-auth");
  const file = normalizeWodeAppBrandAgentsFile({ version: 1, agents });
  writeStoredWodeAppBrandAgents(file);
  const saved = await saveWodeAppBrandAgents(file);
  if (saved.ok) {
    writeStoredWodeAppBrandAgents(normalizeWodeAppBrandAgentsFile({ version: 1, agents: saved.agents }));
    return true;
  }
  return false;
}

export async function saveSidebarCustomAgent(input: {
  name: string;
  meta?: string;
  samplePrompt?: string;
  projectId?: string;
  launchUrl?: string;
  sessionId?: string;
}): Promise<{ ok: true; agent: WodeAppBrandAgentConfig } | { ok: false; error: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "智能体名称不能为空" };
  const existing = await readDiskBrandAgents();
  const matched = matchExistingCustomAgent(existing, { name });
  const drafted = buildCustomBrandAgent({
    name,
    meta: input.meta || matched?.meta,
    entryPrompt: input.meta || matched?.entryPrompt,
    samplePrompt: input.samplePrompt || matched?.samplePrompt,
    projectId: input.projectId || matched?.projectId,
    launchUrl: input.launchUrl || matched?.launchUrl,
  });
  if (!drafted) return { ok: false, error: "无法创建智能体" };
  const agent = matched
    ? {
        ...matched,
        name: matched.name || drafted.name,
        ...(input.meta ? { meta: drafted.meta } : {}),
        ...(input.samplePrompt ? { samplePrompt: drafted.samplePrompt } : {}),
        ...(drafted.projectId ? { projectId: drafted.projectId } : {}),
        ...(drafted.launchUrl ? { launchUrl: drafted.launchUrl } : {}),
        enabled: true,
      }
    : drafted;
  const home = asHome({ projectId: agent.projectId, launchUrl: agent.launchUrl });
  const next = home ? withBoundHome(agent, home) : agent;
  const persisted = await persistPinnedCustomAgent(next);
  if (persisted.ok && input.sessionId?.trim()) {
    rememberCustomAgentCreateSession(input.sessionId, persisted.agent.id);
  }
  return persisted;
}

export async function persistPinnedCustomAgent(
  agent: WodeAppBrandAgentConfig,
): Promise<{ ok: true; agent: WodeAppBrandAgentConfig } | { ok: false; error: string }> {
  const existing = await readDiskBrandAgents();
  const next = existing.some((item) => item.id === agent.id)
    ? existing.map((item) => item.id === agent.id ? { ...item, ...agent, enabled: true } : item)
    : [...existing, { ...agent, enabled: true }];
  const written = await writeDiskBrandAgents(next);
  if (!written) return { ok: false, error: "保存智能体失败" };
  const saved = readStoredWodeAppBrandAgents().find((item) => item.id === agent.id) || agent;
  return { ok: true, agent: saved };
}

export async function bindCustomAgentHome(
  agentId: string,
  home: WodeAppCustomAgentHome,
): Promise<boolean> {
  const id = agentId.trim();
  const nextHome = asHome(home);
  if (!id || !nextHome) return false;
  const existing = await readDiskBrandAgents();
  const current = existing.find((agent) => agent.id === id);
  if (!current) return false;
  const next = withBoundHome(current, nextHome);
  if (sameHome(current, nextHome) && current.samplePrompt === next.samplePrompt) return true;
  return writeDiskBrandAgents(existing.map((agent) => agent.id === id ? next : agent));
}

export async function bindCustomAgentHomeFromCreateSession(
  sessionId: string,
  messages: unknown,
): Promise<boolean> {
  const home = extractPublishedProjectFromMessages(messages);
  if (!home) return false;
  let agentId = readCustomAgentIdForCreateSession(sessionId);
  if (!agentId) {
    const draft = inferCustomAgentDraftFromText(firstUserText(messages))
      || inferCustomAgentDraftFromText(collectUserText(messages));
    if (!draft) return false;
    const existing = await readDiskBrandAgents();
    const matched = matchExistingCustomAgent(existing, draft);
    if (matched) {
      agentId = matched.id;
    } else {
      const pinned = buildCustomBrandAgent({
        name: draft.name,
        meta: draft.meta,
        entryPrompt: draft.meta,
      });
      if (!pinned) return false;
      const persisted = await persistPinnedCustomAgent(withBoundHome(pinned, home));
      if (!persisted.ok) return false;
      rememberCustomAgentCreateSession(sessionId, persisted.agent.id);
      return true;
    }
    rememberCustomAgentCreateSession(sessionId, agentId);
  }
  return bindCustomAgentHome(agentId, home);
}

export const __testing = {
  resetCreateSessions() {
    for (const key of Object.keys(memoryCreateSessions)) delete memoryCreateSessions[key];
  },
  matchExistingCustomAgent,
};
