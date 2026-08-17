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
