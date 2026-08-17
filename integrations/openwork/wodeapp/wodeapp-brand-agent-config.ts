/**
 * Configurable brand agents (客户/本地品牌智能体) — Layer 1.
 *
 * Parent:   wodeappx/docs/AGENTS_CONFIG.md
 * Contract: wodeappx/docs/BRAND_AGENTS_CONFIG.md
 * Schema:  wodeappx/docs/schemas/brand-agents.schema.json
 *
 * Shipping builds ship with an empty list. Users add entries via
 * `~/.wodeapp/brand-agents.json` (Electron) or localStorage cache.
 * Wynne is only an example config — not a built-in product agent.
 */

import { listShippedBuiltinAgentIds } from "./wodeapp-builtin-agents-config";

export const WODEAPP_BRAND_AGENTS_STORAGE_KEY = "wodeappx.brand-agents.v1";
export const WODEAPP_BRAND_AGENTS_CHANGED_EVENT = "wodeapp:brand-agents-changed";
export const WODEAPP_BRAND_AGENTS_FILE_VERSION = 1 as const;

export const WODEAPP_BRAND_AGENT_ID_PATTERN = /^[a-z][a-z0-9-]{1,62}$/;
export const WODEAPP_BRAND_ID_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
export const WODEAPP_KNOWLEDGE_SCOPE_PATTERN = /^[a-z][a-z0-9_-]{0,31}$/;

/** Must never be used as brand-agent ids (Layer 0 shipped builtin agents). */
export const WODEAPP_RESERVED_BUILTIN_AGENT_IDS: readonly string[] = listShippedBuiltinAgentIds();

export const WODEAPP_BRAND_CONNECTOR_SCOPES = [
  "shopify",
  "feishu",
  "dingtalk",
  "wecom",
] as const;

export type WodeAppBrandConnectorScope = (typeof WODEAPP_BRAND_CONNECTOR_SCOPES)[number];
export type WodeAppBrandAgentWorkbench = "generic" | "wynne";

export type WodeAppBrandAgentConfig = {
  id: string;
  name: string;
  meta?: string;
  brandId: string;
  connectorScopes?: WodeAppBrandConnectorScope[];
  knowledgeScopes?: string[];
  policy?: string[];
  entryPrompt?: string;
  samplePrompt?: string;
  /** Specialized workbench surface; default generic chat + runtime profile. */
  workbench?: WodeAppBrandAgentWorkbench;
  /** When false, config stays on disk but is not listed. Default true. */
  enabled?: boolean;
};

export type WodeAppBrandAgentFile = {
  version: typeof WODEAPP_BRAND_AGENTS_FILE_VERSION;
  agents: WodeAppBrandAgentConfig[];
};

export type WodeAppBrandAgentIssue = {
  level: "error" | "warning";
  code: string;
  message: string;
  agentId?: string;
};

export type WodeAppBrandAgentsValidation = {
  ok: boolean;
  file: WodeAppBrandAgentFile;
  errors: WodeAppBrandAgentIssue[];
  warnings: WodeAppBrandAgentIssue[];
};

const CONNECTOR_SET = new Set<string>(WODEAPP_BRAND_CONNECTOR_SCOPES);
const RESERVED_ID_SET = new Set<string>(WODEAPP_RESERVED_BUILTIN_AGENT_IDS);

const DEFAULT_POLICY = [
  "Never invent store data, connection state, prices, inventory, orders, or brand policy.",
  "Read operations may run directly. Any external write must use the existing preview and approval gate.",
  "Protect customer and order privacy, especially in group-channel responses.",
] as const;

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}

function asScopedStringArray(
  value: unknown,
  pattern: RegExp,
  options: { agentId?: string; field: string; allowlist?: Set<string>; warnings: WodeAppBrandAgentIssue[] },
): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (options.allowlist && !options.allowlist.has(trimmed)) {
      options.warnings.push({
        level: "warning",
        code: "unknown_scope",
        message: `Dropped unknown ${options.field} "${trimmed}"`,
        agentId: options.agentId,
      });
      continue;
    }
    if (!pattern.test(trimmed)) {
      options.warnings.push({
        level: "warning",
        code: "invalid_scope",
        message: `Dropped invalid ${options.field} "${trimmed}"`,
        agentId: options.agentId,
      });
      continue;
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function normalizeWodeAppBrandAgentConfig(
  input: unknown,
  issues?: WodeAppBrandAgentIssue[],
): WodeAppBrandAgentConfig | null {
  const warnings = issues ?? [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const nameRaw = typeof record.name === "string" ? record.name.trim() : "";
  const brandId = typeof record.brandId === "string" ? record.brandId.trim() : "";
  if (!id || !nameRaw || !brandId) return null;

  if (!WODEAPP_BRAND_AGENT_ID_PATTERN.test(id)) {
    warnings.push({
      level: "error",
      code: "invalid_id",
      message: `Agent id "${id}" must match ${WODEAPP_BRAND_AGENT_ID_PATTERN}`,
      agentId: id,
    });
    return null;
  }
  if (RESERVED_ID_SET.has(id)) {
    warnings.push({
      level: "error",
      code: "reserved_id",
      message: `Agent id "${id}" conflicts with a built-in product agent`,
      agentId: id,
    });
    return null;
  }
  if (!WODEAPP_BRAND_ID_PATTERN.test(brandId)) {
    warnings.push({
      level: "error",
      code: "invalid_brand_id",
      message: `brandId "${brandId}" must match ${WODEAPP_BRAND_ID_PATTERN}`,
      agentId: id,
    });
    return null;
  }

  const name = clip(nameRaw, 64);
  const meta = typeof record.meta === "string" && record.meta.trim()
    ? clip(record.meta.trim(), 80)
    : undefined;
  const connectorScopes = asScopedStringArray(record.connectorScopes, WODEAPP_BRAND_ID_PATTERN, {
    agentId: id,
    field: "connectorScopes",
    allowlist: CONNECTOR_SET,
    warnings,
  }) as WodeAppBrandConnectorScope[];
  const knowledgeScopes = asScopedStringArray(record.knowledgeScopes, WODEAPP_KNOWLEDGE_SCOPE_PATTERN, {
    agentId: id,
    field: "knowledgeScopes",
    warnings,
  });

  let policy: string[] | undefined;
  if (Array.isArray(record.policy)) {
    policy = record.policy
      .map((item) => (typeof item === "string" ? clip(item.trim(), 240) : ""))
      .filter(Boolean);
    if (!policy.length) policy = undefined;
  }

  const entryPrompt = typeof record.entryPrompt === "string" && record.entryPrompt.trim()
    ? clip(record.entryPrompt.trim(), 500)
    : undefined;
  const samplePrompt = typeof record.samplePrompt === "string" && record.samplePrompt.trim()
    ? clip(record.samplePrompt.trim(), 4000)
    : undefined;

  let workbench: WodeAppBrandAgentWorkbench = record.workbench === "wynne" ? "wynne" : "generic";
  if (workbench === "wynne" && id !== "wynne-brand-agent" && brandId !== "wynne") {
    warnings.push({
      level: "warning",
      code: "workbench_downgraded",
      message: `workbench "wynne" requires id wynne-brand-agent or brandId wynne; downgraded to generic`,
      agentId: id,
    });
    workbench = "generic";
  }

  return {
    id,
    name,
    brandId,
    meta,
    connectorScopes,
    knowledgeScopes,
    policy,
    entryPrompt,
    samplePrompt,
    workbench,
    enabled: record.enabled === false ? false : true,
  };
}

export function normalizeWodeAppBrandAgentsFile(input: unknown): WodeAppBrandAgentFile {
  return validateWodeAppBrandAgentsFile(input).file;
}

export function validateWodeAppBrandAgentsFile(input: unknown): WodeAppBrandAgentsValidation {
  const errors: WodeAppBrandAgentIssue[] = [];
  const warnings: WodeAppBrandAgentIssue[] = [];

  if (input == null) {
    return { ok: true, file: { version: 1, agents: [] }, errors, warnings };
  }

  const isArray = Array.isArray(input);
  const record = !isArray && input && typeof input === "object"
    ? input as Record<string, unknown>
    : null;

  if (!isArray && record && "version" in record && record.version !== 1 && record.version !== "1") {
    errors.push({
      level: "error",
      code: "unsupported_version",
      message: `Unsupported brand-agents version "${String(record.version)}"; expected 1`,
    });
    return { ok: false, file: { version: 1, agents: [] }, errors, warnings };
  }

  const rawAgents = isArray
    ? input
    : Array.isArray(record?.agents)
      ? record.agents
      : [];

  if (!isArray && record && record.agents != null && !Array.isArray(record.agents)) {
    errors.push({
      level: "error",
      code: "invalid_agents",
      message: "agents must be an array",
    });
    return { ok: false, file: { version: 1, agents: [] }, errors, warnings };
  }

  const seen = new Set<string>();
  const agents: WodeAppBrandAgentConfig[] = [];
  for (const item of rawAgents) {
    const agentIssues: WodeAppBrandAgentIssue[] = [];
    const normalized = normalizeWodeAppBrandAgentConfig(item, agentIssues);
    for (const issue of agentIssues) {
      if (issue.level === "error") errors.push(issue);
      else warnings.push(issue);
    }
    if (!normalized) continue;
    if (seen.has(normalized.id)) {
      warnings.push({
        level: "warning",
        code: "duplicate_id",
        message: `Duplicate agent id "${normalized.id}" ignored`,
        agentId: normalized.id,
      });
      continue;
    }
    seen.add(normalized.id);
    agents.push(normalized);
  }

  return {
    ok: errors.length === 0,
    file: { version: 1, agents },
    errors,
    warnings,
  };
}

export function listEnabledWodeAppBrandAgents(
  file: WodeAppBrandAgentFile | readonly WodeAppBrandAgentConfig[] | null | undefined,
): WodeAppBrandAgentConfig[] {
  const agents = Array.isArray(file)
    ? [...file]
    : normalizeWodeAppBrandAgentsFile(file).agents;
  return agents.filter((agent) => agent.enabled !== false);
}

export function brandAgentConfigToBuiltinAgent(agent: WodeAppBrandAgentConfig): {
  id: string;
  name: string;
  meta: string;
  kind: "brand";
  entryPrompt: string;
  samplePrompt: string;
  runtimeProfileId: string;
  autoSend: false;
} {
  const scopes = [
    ...(agent.connectorScopes || []),
    ...(agent.knowledgeScopes || []),
  ].filter(Boolean);
  return {
    id: agent.id,
    name: agent.name,
    meta: agent.meta?.trim() || (scopes.length ? scopes.join(" · ") : "品牌 · 连接器 · 知识库"),
    kind: "brand",
    entryPrompt: agent.entryPrompt?.trim()
      || `向「${agent.name}」提问；需要数据时再检索已配置的连接器或品牌知识库。`,
    samplePrompt: agent.samplePrompt?.trim()
      || `使用 Runtime Profile「${agent.id}」；按需发现工具与知识，不预载品牌事实。禁止编造店铺/订单/政策数据。`,
    runtimeProfileId: agent.id,
    autoSend: false,
  };
}

export function brandAgentConfigToRuntimeProfile(agent: WodeAppBrandAgentConfig): {
  id: string;
  agentId: string;
  name: string;
  brandId: string;
  policy: string[];
  connectorScopes: string[];
  knowledgeScopes: string[];
  toolSearchProfile: string;
} {
  const policy = agent.policy?.length ? agent.policy : [...DEFAULT_POLICY];
  return {
    id: agent.id,
    agentId: agent.id,
    name: agent.name,
    brandId: agent.brandId,
    policy,
    connectorScopes: agent.connectorScopes?.length ? [...agent.connectorScopes] : [],
    knowledgeScopes: agent.knowledgeScopes?.length ? [...agent.knowledgeScopes] : [],
    toolSearchProfile: agent.id,
  };
}

export function readStoredWodeAppBrandAgents(): WodeAppBrandAgentConfig[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(WODEAPP_BRAND_AGENTS_STORAGE_KEY);
    if (!raw) return [];
    return listEnabledWodeAppBrandAgents(normalizeWodeAppBrandAgentsFile(JSON.parse(raw)));
  } catch {
    return [];
  }
}

export function writeStoredWodeAppBrandAgents(file: WodeAppBrandAgentFile | WodeAppBrandAgentConfig[]): void {
  if (typeof window === "undefined") return;
  const normalized = normalizeWodeAppBrandAgentsFile(file);
  try {
    window.localStorage.setItem(WODEAPP_BRAND_AGENTS_STORAGE_KEY, JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent(WODEAPP_BRAND_AGENTS_CHANGED_EVENT, { detail: normalized }));
  } catch {
    // ignore quota / private mode
  }
}

/** Example only — copy into ~/.wodeapp/brand-agents.json for local Wynne demos. */
export const WODEAPP_BRAND_AGENT_WYNNE_EXAMPLE: WodeAppBrandAgentConfig = {
  id: "wynne-brand-agent",
  name: "Wynne 品牌智能体",
  meta: "飞书 · Shopify · 品牌知识",
  brandId: "wynne",
  connectorScopes: ["shopify", "feishu"],
  knowledgeScopes: ["wynne"],
  workbench: "wynne",
  entryPrompt: "向 Wynne 品牌智能体提问；需要数据时再检索 Shopify、飞书或品牌知识库。",
  samplePrompt: "使用 Wynne Runtime Profile；按需发现工具与知识，不预载品牌知识。",
  enabled: true,
};

/** Example only — generic industry-style brand agent for Layer1 tests (not shipped Layer0 ids). */
export const WODEAPP_BRAND_AGENT_INDUSTRY_EXAMPLE: WodeAppBrandAgentConfig = {
  id: "outdoor-gear-industry-agent",
  name: "户外行业智能体",
  meta: "选品 · 话术 · 场景方案",
  brandId: "outdoor-gear",
  connectorScopes: [],
  knowledgeScopes: ["outdoor-gear"],
  workbench: "generic",
  entryPrompt: "按户外行业视角回答选品、话术与场景方案；缺资料时再检索知识库。",
  samplePrompt: "使用户外行业 Runtime Profile；按需 knowledge_search，不编造库存、价格与未配置的政策。",
  enabled: true,
};
