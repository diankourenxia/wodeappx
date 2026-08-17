import {
  brandAgentConfigToRuntimeProfile,
  listEnabledWodeAppBrandAgents,
  readStoredWodeAppBrandAgents,
  type WodeAppBrandAgentConfig,
} from "./wodeapp-brand-agent-config";
import {
  listEnabledWodeAppBuiltinAgentConfigs,
  type WodeAppBuiltinAgentConfig,
} from "./wodeapp-builtin-agents-config";
import { findWodeAppIndustryPack, WODEAPP_BEAUTY_INDUSTRY_PACK } from "./wodeapp-industry-packs";

/** Legacy / example id used by the optional Wynne workbench when configured. */
export const WODEAPP_WYNNE_RUNTIME_PROFILE_ID = "wynne-brand-agent";
export const WODEAPP_RUNTIME_PROFILE_CHANGED_EVENT = "wodeapp:runtime-profile-changed";

export type WodeAppRuntimeProfile = {
  id: string;
  agentId: string;
  name: string;
  brandId: string;
  policy: readonly string[];
  connectorScopes: readonly string[];
  knowledgeScopes: readonly string[];
  toolSearchProfile: string;
  /** Optional industry identity line for system context. */
  identity?: string;
  /** Optional industry playbook steps for system context. */
  playbook?: readonly string[];
  recommendedSkills?: readonly string[];
};

const DEFAULT_INDUSTRY_POLICY = [
  "Never invent store data, connection state, prices, inventory, orders, or brand policy.",
  "Read operations may run directly. Any external write must use the existing preview and approval gate.",
  "Protect customer and order privacy, especially in group-channel responses.",
  "Industry advice must cite configured knowledge_search hits or clearly mark assumptions.",
] as const;

let configuredProfiles: Readonly<Record<string, WodeAppRuntimeProfile>> = {};
let profilesHydrated = false;

const STORAGE_PREFIX = "wodeappx:runtime-profile:v1";
const sessionProfiles = new Map<string, string>();

function storageKey(workspaceId: string, sessionId: string): string {
  return `${STORAGE_PREFIX}:${encodeURIComponent(workspaceId)}:${encodeURIComponent(sessionId)}`;
}

function notifyRuntimeProfileChanged(
  workspaceId: string,
  sessionId: string,
  profileId: string | null,
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WODEAPP_RUNTIME_PROFILE_CHANGED_EVENT, {
    detail: { workspaceId, sessionId, profileId },
  }));
}

function brandIdFromAgentId(agentId: string): string {
  return agentId
    .replace(/-industry-agent$/, "")
    .replace(/-brand-agent$/, "")
    .replace(/-agent$/, "")
    || agentId;
}

/** Build a runtime profile from a Layer0 industry/brand builtin that carries runtimeProfileId. */
export function builtinAgentConfigToRuntimeProfile(
  agent: WodeAppBuiltinAgentConfig,
): WodeAppRuntimeProfile | null {
  if (agent.kind !== "industry" && agent.kind !== "brand") return null;
  const profileId = (agent.runtimeProfileId || agent.id).trim();
  if (!profileId) return null;
  const pack = findWodeAppIndustryPack(profileId) || findWodeAppIndustryPack(agent.id);
  if (pack) {
    return {
      id: profileId,
      agentId: profileId,
      name: agent.name,
      brandId: pack.brandId,
      policy: [...pack.policy],
      connectorScopes: [...pack.connectorScopes],
      knowledgeScopes: [...pack.knowledgeScopes],
      toolSearchProfile: pack.toolSearchProfile,
      identity: pack.identity,
      playbook: [...pack.playbook],
      recommendedSkills: [...pack.recommendedSkills],
    };
  }
  const knowledgeScope = brandIdFromAgentId(profileId);
  return {
    id: profileId,
    agentId: profileId,
    name: agent.name,
    brandId: knowledgeScope,
    policy: [...DEFAULT_INDUSTRY_POLICY],
    connectorScopes: [],
    knowledgeScopes: knowledgeScope ? [knowledgeScope] : [],
    toolSearchProfile: profileId,
  };
}

function profileFromIndustryPack(pack: ReturnType<typeof findWodeAppIndustryPack>, name?: string): WodeAppRuntimeProfile | null {
  if (!pack) return null;
  return {
    id: pack.id,
    agentId: pack.id,
    name: name || pack.identity.split("：")[0] || pack.id,
    brandId: pack.brandId,
    policy: [...pack.policy],
    connectorScopes: [...pack.connectorScopes],
    knowledgeScopes: [...pack.knowledgeScopes],
    toolSearchProfile: pack.toolSearchProfile,
    identity: pack.identity,
    playbook: [...pack.playbook],
    recommendedSkills: [...pack.recommendedSkills],
  };
}

function profilesFromShippedIndustryAgents(): Record<string, WodeAppRuntimeProfile> {
  const next: Record<string, WodeAppRuntimeProfile> = {};
  for (const agent of listEnabledWodeAppBuiltinAgentConfigs()) {
    const profile = builtinAgentConfigToRuntimeProfile(agent);
    if (!profile) continue;
    next[profile.id] = profile;
  }
  // Self-evolve beauty shell demo: register beauty pack even when industry agents are disabled/hidden.
  const beauty = profileFromIndustryPack(WODEAPP_BEAUTY_INDUSTRY_PACK, "美妆种草");
  if (beauty) next[beauty.id] = next[beauty.id] ?? beauty;
  return next;
}

/**
 * Merge Layer0 industry/brand profiles with Layer1 brand-agent profiles.
 * Brand Layer1 entries win on id collision.
 */
export function setWodeAppRuntimeProfilesFromBrandAgents(
  agents: readonly WodeAppBrandAgentConfig[] | null | undefined,
): void {
  const next = profilesFromShippedIndustryAgents();
  const enabled = listEnabledWodeAppBrandAgents(agents ?? []);
  for (const agent of enabled) {
    next[agent.id] = brandAgentConfigToRuntimeProfile(agent);
  }
  configuredProfiles = next;
  profilesHydrated = true;
}

/** Re-register shipped industry profiles and optional Layer1 brands (from storage if omitted). */
export function hydrateWodeAppRuntimeProfiles(
  brandAgents?: readonly WodeAppBrandAgentConfig[] | null,
): void {
  if (brandAgents !== undefined) {
    setWodeAppRuntimeProfilesFromBrandAgents(brandAgents);
    return;
  }
  if (typeof window === "undefined") {
    setWodeAppRuntimeProfilesFromBrandAgents([]);
    return;
  }
  setWodeAppRuntimeProfilesFromBrandAgents(readStoredWodeAppBrandAgents());
}

function ensureProfilesHydratedFromStorage(): void {
  if (profilesHydrated && Object.keys(configuredProfiles).length > 0) return;
  hydrateWodeAppRuntimeProfiles();
}

export function listWodeAppRuntimeProfiles(): WodeAppRuntimeProfile[] {
  ensureProfilesHydratedFromStorage();
  return Object.values(configuredProfiles);
}

export function findWodeAppRuntimeProfile(profileId: string | null | undefined): WodeAppRuntimeProfile | null {
  ensureProfilesHydratedFromStorage();
  const id = profileId?.trim() || "";
  return id ? configuredProfiles[id] ?? null : null;
}

export function wodeAppRuntimeProfileAgentId(
  profile: WodeAppRuntimeProfile | null,
): string | undefined {
  return profile?.agentId;
}

export function bindWodeAppRuntimeProfileToSession(
  workspaceId: string,
  sessionId: string,
  profileId: string,
): boolean {
  const workspace = workspaceId.trim();
  const session = sessionId.trim();
  const profile = findWodeAppRuntimeProfile(profileId);
  if (!workspace || !session || !profile) return false;
  const key = storageKey(workspace, session);
  sessionProfiles.set(key, profile.id);
  if (typeof window === "undefined") return true;
  try {
    window.localStorage.setItem(key, profile.id);
  } catch {
    // The current in-memory conversation can continue even when storage is unavailable.
  }
  notifyRuntimeProfileChanged(workspace, session, profile.id);
  return true;
}

export function clearWodeAppRuntimeProfileForSession(
  workspaceId: string,
  sessionId: string,
): boolean {
  const workspace = workspaceId.trim();
  const session = sessionId.trim();
  if (!workspace || !session) return false;
  const key = storageKey(workspace, session);
  const changed = sessionProfiles.delete(key);
  if (typeof window !== "undefined") {
    try {
      if (window.localStorage.getItem(key)) {
        window.localStorage.removeItem(key);
        notifyRuntimeProfileChanged(workspace, session, null);
        return true;
      }
    } catch {
      // Clearing the in-memory binding is still enough for the current view.
    }
    if (changed) notifyRuntimeProfileChanged(workspace, session, null);
  }
  return changed;
}

export function readWodeAppRuntimeProfileForSession(
  workspaceId: string,
  sessionId: string,
): WodeAppRuntimeProfile | null {
  const workspace = workspaceId.trim();
  const session = sessionId.trim();
  if (!workspace || !session) return null;
  const key = storageKey(workspace, session);
  const inMemory = findWodeAppRuntimeProfile(sessionProfiles.get(key));
  if (inMemory) return inMemory;
  if (typeof window === "undefined") return null;
  try {
    const profile = findWodeAppRuntimeProfile(window.localStorage.getItem(key));
    if (profile) sessionProfiles.set(key, profile.id);
    return profile;
  } catch {
    return null;
  }
}

/**
 * This is routing metadata, not a knowledge dump. Brand facts only enter the
 * model context through the discoverable knowledge_search tool.
 */
export function buildWodeAppRuntimeProfileSystemContext(
  profile: WodeAppRuntimeProfile | null,
): string {
  if (!profile) return "";
  const lines = [
    `<runtime_profile id="${profile.id}" brand="${profile.brandId}">`,
    `Identity: ${profile.identity?.trim() || profile.name}.`,
    "Hard policy:",
    ...profile.policy.map((item) => `- ${item}`),
  ];
  if (profile.playbook && profile.playbook.length > 0) {
    lines.push("Playbook:");
    for (const step of profile.playbook) lines.push(`- ${step}`);
  }
  if (profile.recommendedSkills && profile.recommendedSkills.length > 0) {
    lines.push(`Recommended skills: ${profile.recommendedSkills.join(", ")}.`);
  }
  lines.push(
    `Connector scope: ${profile.connectorScopes.join(", ") || "(none)"}.`,
    `Knowledge scope: ${profile.knowledgeScopes.join(", ") || "(none)"}.`,
    `Routing: when tool_search is needed, pass profile="${profile.toolSearchProfile}" so relevant connected tools receive a soft ranking boost.`,
    `Knowledge: do not assume brand facts from this profile. Discover and call knowledge_search with profile="${profile.id}". Cite returned source and updatedAt. If the scope is unconfigured or has no match, say so plainly.`,
    "Connection truth: only report a connector as connected after a live status tool confirms it.",
    "</runtime_profile>",
  );
  return lines.join("\n");
}

export const __testing = {
  storageKey,
  reset() {
    sessionProfiles.clear();
    configuredProfiles = {};
    profilesHydrated = false;
  },
};
