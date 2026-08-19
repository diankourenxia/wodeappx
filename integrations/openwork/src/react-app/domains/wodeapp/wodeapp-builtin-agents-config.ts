/**
 * Built-in agents = shipped default config (layer 0).
 * Brand agents = user config ~/.wodeapp/brand-agents.json (layer 1).
 * See wodeappx/docs/AGENTS_CONFIG.md.
 */

import builtinAgentsFile from "./wodeapp-builtin-agents.default.json";

export const WODEAPP_BUILTIN_AGENTS_FILE_VERSION = 1 as const;

export type WodeAppBuiltinAgentKind =
  | "capability"
  | "workflow"
  | "orchestrator"
  | "integration"
  | "industry"
  | "brand";
export type WodeAppAbilityKind = "image" | "video" | "short-drama" | "canvas" | "multi-agent";

export type WodeAppBuiltinAgentConfig = {
  id: string;
  name: string;
  meta?: string;
  kind: WodeAppBuiltinAgentKind;
  abilityKind?: WodeAppAbilityKind;
  defaultUrl?: string;
  entryPrompt?: string;
  samplePrompt: string;
  runtimeProfileId?: string;
  demoUrl?: string;
  autoSend?: boolean;
  enabled?: boolean;
};

export type WodeAppBuiltinAgentsFile = {
  version: typeof WODEAPP_BUILTIN_AGENTS_FILE_VERSION;
  layer?: "builtin";
  description?: string;
  agents: WodeAppBuiltinAgentConfig[];
};

const ABILITY_KINDS = new Set<string>([
  "image",
  "video",
  "short-drama",
  "canvas",
  "multi-agent",
]);
const KINDS = new Set<string>([
  "capability",
  "workflow",
  "orchestrator",
  "integration",
  "industry",
  "brand",
]);
const ID_RE = /^[a-z][a-z0-9-]{1,62}$/;

export function normalizeWodeAppBuiltinAgentConfig(input: unknown): WodeAppBuiltinAgentConfig | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const kind = typeof record.kind === "string" ? record.kind.trim() : "";
  const samplePrompt = typeof record.samplePrompt === "string" ? record.samplePrompt : "";
  if (!id || !name || !KINDS.has(kind) || !samplePrompt.trim() || !ID_RE.test(id)) return null;
  const abilityKind = typeof record.abilityKind === "string" ? record.abilityKind.trim() : undefined;
  if (abilityKind && !ABILITY_KINDS.has(abilityKind)) return null;
  return {
    id,
    name,
    meta: typeof record.meta === "string" ? record.meta.trim() : undefined,
    kind: kind as WodeAppBuiltinAgentKind,
    abilityKind: abilityKind as WodeAppAbilityKind | undefined,
    defaultUrl: typeof record.defaultUrl === "string" ? record.defaultUrl.trim() : undefined,
    entryPrompt: typeof record.entryPrompt === "string" ? record.entryPrompt.trim() : undefined,
    samplePrompt,
    runtimeProfileId: typeof record.runtimeProfileId === "string"
      ? record.runtimeProfileId.trim()
      : undefined,
    demoUrl: typeof record.demoUrl === "string" ? record.demoUrl.trim() : undefined,
    autoSend: typeof record.autoSend === "boolean" ? record.autoSend : undefined,
    enabled: record.enabled === false ? false : true,
  };
}

export function normalizeWodeAppBuiltinAgentsFile(input: unknown): WodeAppBuiltinAgentsFile {
  const record = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  if (record.version != null && record.version !== 1 && record.version !== "1") {
    return { version: 1, layer: "builtin", agents: [] };
  }
  const raw = Array.isArray(record.agents) ? record.agents : [];
  const seen = new Set<string>();
  const agents: WodeAppBuiltinAgentConfig[] = [];
  for (const item of raw) {
    const normalized = normalizeWodeAppBuiltinAgentConfig(item);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    agents.push(normalized);
  }
  return {
    version: 1,
    layer: "builtin",
    description: typeof record.description === "string" ? record.description : undefined,
    agents,
  };
}

export function listEnabledWodeAppBuiltinAgentConfigs(
  file: WodeAppBuiltinAgentsFile | null | undefined = normalizeWodeAppBuiltinAgentsFile(builtinAgentsFile),
): WodeAppBuiltinAgentConfig[] {
  return (file?.agents ?? []).filter((agent) => agent.enabled !== false);
}

/** Stable id set for brand-agent reserved-id checks (includes disabled Layer0 entries). */
export function listShippedBuiltinAgentIds(): string[] {
  return WODEAPP_SHIPPED_BUILTIN_AGENTS_FILE.agents.map((agent) => agent.id);
}

export const WODEAPP_SHIPPED_BUILTIN_AGENTS_FILE = normalizeWodeAppBuiltinAgentsFile(builtinAgentsFile);

/** Official handbook files live in-repo. Do not compile markdown into types. */
export const OFFICIAL_AGENT_HANDBOOK_IDS = ["visual-generation", "video-generation"] as const;

export type AgentHandbookFrontmatter = {
  id: string;
  name: string;
};

export type AgentHandbookRef = {
  path: string;
  source: "official" | "user";
  id: string;
  name: string;
};

export function officialAgentHandbookRelPath(id: string): string {
  return `docs/agents/${id}.md`;
}

export function userAgentHandbookRelPath(id: string): string {
  return `~/.wodeapp/agents/${id}.md`;
}

export function parseAgentHandbookFrontmatter(text: string): AgentHandbookFrontmatter | null {
  const match = String(text ?? "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const block = match[1];
  const id = block.match(/^id:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const name = block.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? "";
  if (!id || !name) return null;
  return { id, name };
}

/**
 * Frontmatter must have both id and name. Missing either means the handbook
 * is absent; the sidebar still opens from Layer JSON.
 * Same id: later write (user) overrides earlier (official).
 * Do not parse Skills / sites / tools sections.
 */
export function resolveAgentHandbookRef(input: {
  id: string;
  name?: string;
  officialText?: string | null;
  userText?: string | null;
}): AgentHandbookRef | null {
  const id = String(input.id ?? "").trim();
  if (!id) return null;
  if (input.userText) {
    const fm = parseAgentHandbookFrontmatter(input.userText);
    if (fm && fm.id === id) {
      return { path: userAgentHandbookRelPath(id), source: "user", id: fm.id, name: fm.name };
    }
  }
  if (input.officialText) {
    const fm = parseAgentHandbookFrontmatter(input.officialText);
    if (fm && fm.id === id) {
      return { path: officialAgentHandbookRelPath(id), source: "official", id: fm.id, name: fm.name };
    }
  }
  if ((OFFICIAL_AGENT_HANDBOOK_IDS as readonly string[]).includes(id)) {
    return {
      path: officialAgentHandbookRelPath(id),
      source: "official",
      id,
      name: String(input.name ?? "").trim() || id,
    };
  }
  return null;
}

/** Sidebar tile and first prompt share this exact string. */
export function firstPromptForHandbook(ref: AgentHandbookRef | null, fallback = ""): string {
  if (ref) return `阅读 ${ref.path}，按手册工作。`;
  return String(fallback ?? "").trim();
}

export function listBuiltinAgentsWithWorkbench(
  file: WodeAppBuiltinAgentsFile | null | undefined = WODEAPP_SHIPPED_BUILTIN_AGENTS_FILE,
) {
  return listEnabledWodeAppBuiltinAgentConfigs(file).map((agent) => {
    const ref = resolveAgentHandbookRef({ id: agent.id, name: agent.name });
    return {
      id: agent.id,
      name: agent.name,
      abilityKind: agent.abilityKind,
      defaultUrl: agent.defaultUrl,
      canOpenWorkbench: Boolean(agent.defaultUrl || agent.abilityKind),
      handbookPath: ref?.path ?? null,
    };
  });
}
