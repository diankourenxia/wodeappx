import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import {
  envMapToMediaByok,
  loadDesktopKeysStore,
  mediaByokToEnvEntries,
  upsertDesktopKeys,
} from "./desktop-keys-store.mjs";

export const CONFIG_DIR_NAME = ".wodeapp";
export const CONFIG_FILE_NAME = "config.json";
export const INSTALL_FILE_NAME = "install.json";
export const BRAND_AGENTS_FILE_NAME = "brand-agents.json";
export const PLAZA_CATALOG_REL = join("plaza", "catalog.json");
export const MEDIA_BYOK_FILE_NAME = "media-byok.json";

/** Seeded only when ~/.wodeapp/brand-agents.json is missing (local demo, not Layer0). */
export const WODEAPP_BRAND_AGENTS_SEED = {
  version: 1,
  agents: [
    {
      id: "wynne-brand-agent",
      name: "Wynne 品牌智能体",
      meta: "飞书 · Shopify · 品牌知识",
      brandId: "wynne",
      connectorScopes: ["shopify", "feishu"],
      knowledgeScopes: ["wynne"],
      workbench: "wynne",
      policy: [
        "Never invent store data, connection state, prices, inventory, orders, or brand policy.",
        "Read operations may run directly. Any external write must use the existing preview and approval gate.",
        "Protect customer and order privacy, especially in group-channel responses.",
      ],
      entryPrompt: "向 Wynne 品牌智能体提问；需要数据时再检索 Shopify、飞书或品牌知识库。",
      samplePrompt: "使用 Wynne Runtime Profile；按需发现工具与知识，不预载品牌知识。",
      enabled: true,
    },
  ],
};
export const WODEAPP_CLOUD_ORIGIN_AI = "https://wodeapp.ai";
export const WODEAPP_CLOUD_ORIGIN_CN = "https://wodeapp.cn";
/** OSS / unsigned fallback. Login still lets the user pick .cn. */
export const WODEAPP_CLOUD_ORIGIN = WODEAPP_CLOUD_ORIGIN_AI;
export const WODEAPP_LOCAL_ORIGIN = "http://127.0.0.1:3000";

export function isLocalWodeAppOrigin(origin) {
  try {
    const host = new URL(normalizeWodeAppCloudOrigin(origin)).hostname;
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

/** Infer profile from origin when the UI/CLI does not pass an explicit profile. Default is local. */
export function inferWodeAppProfile(origin, explicit) {
  if (explicit === "cloud" || explicit === "selfhost" || explicit === "local-only") {
    return explicit;
  }
  const normalized = normalizeWodeAppCloudOrigin(origin);
  if (isLocalWodeAppOrigin(normalized)) return "selfhost";
  return "local-only";
}

export function maskWodeAppApiKey(apiKey) {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!key) return null;
  if (key.length <= 12) return `${key.slice(0, 4)}…`;
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

export function summarizeWodeAppServiceConfig(config) {
  if (!config || typeof config !== "object") return null;
  const origin = normalizeWodeAppCloudOrigin(config.origin);
  return {
    profile: inferWodeAppProfile(origin, config.profile),
    origin,
    issuedOrigin: config.issuedOrigin ? normalizeWodeAppCloudOrigin(config.issuedOrigin) : null,
    hasApiKey: Boolean(typeof config.apiKey === "string" && config.apiKey.trim()),
    apiKeyPreview: maskWodeAppApiKey(config.apiKey),
    embedded: Boolean(config.embedded),
    user: config.user && typeof config.user === "object" ? config.user : null,
  };
}

export function normalizeWodeAppCloudOrigin(origin) {
  const cleaned = (origin || WODEAPP_CLOUD_ORIGIN).replace(/\/$/, "");
  try {
    const parsed = new URL(cleaned);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "wodeapp.ai") return WODEAPP_CLOUD_ORIGIN_AI;
    if (host === "wodeapp.cn") return WODEAPP_CLOUD_ORIGIN_CN;
    return parsed.origin;
  } catch {
    return cleaned || WODEAPP_CLOUD_ORIGIN;
  }
}

export function normalizeWodeAppCloudConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("Invalid WodeApp config");
  }
  return {
    profile: inferWodeAppProfile(config.origin, config.profile),
    origin: normalizeWodeAppCloudOrigin(config.origin),
    apiKey: typeof config.apiKey === "string" ? config.apiKey : undefined,
    issuedOrigin: config.issuedOrigin ? normalizeWodeAppCloudOrigin(config.issuedOrigin) : undefined,
    projectSubdomainSuffix: config.projectSubdomainSuffix ?? null,
    embedded: Boolean(config.embedded),
    embeddedInstallId: typeof config.embeddedInstallId === "string" ? config.embeddedInstallId : undefined,
    user: config.user && typeof config.user === "object" ? config.user : undefined,
    credits: typeof config.credits === "number" && Number.isFinite(config.credits)
      ? config.credits
      : undefined,
    abilityProjects: Array.isArray(config.abilityProjects)
      ? config.abilityProjects.filter((item) => item && typeof item === "object" && typeof item.id === "string")
      : [],
  };
}

export function getConfigDir() {
  const override = String(process.env.WODEAPP_CONFIG_DIR || "").trim();
  if (override) return override;
  return join(homedir(), CONFIG_DIR_NAME);
}

export function getConfigPath() {
  return join(getConfigDir(), CONFIG_FILE_NAME);
}

export function getInstallPath() {
  return join(getConfigDir(), INSTALL_FILE_NAME);
}

export function getBrandAgentsPath() {
  return join(getConfigDir(), BRAND_AGENTS_FILE_NAME);
}

export function getPlazaCatalogPath() {
  return join(getConfigDir(), PLAZA_CATALOG_REL);
}

export function getMediaByokPath() {
  return join(getConfigDir(), MEDIA_BYOK_FILE_NAME);
}

const MEDIA_BYOK_FIELD_KEYS = {
  kling: ["accessKey", "secretKey"],
  seedance: ["apiKey"],
  runway: ["apiKey"],
  replicate: ["apiToken"],
  "openai-image": ["apiKey"],
};

export function normalizeMediaByokFile(input) {
  const providers = {};
  const rawProviders = input && typeof input === "object" && input.providers && typeof input.providers === "object"
    ? input.providers
    : {};
  for (const [providerId, fields] of Object.entries(MEDIA_BYOK_FIELD_KEYS)) {
    const entry = rawProviders[providerId];
    if (!entry || typeof entry !== "object") continue;
    const values = {};
    for (const field of fields) {
      const value = typeof entry[field] === "string" ? entry[field].trim() : "";
      if (value) values[field] = value;
    }
    if (Object.keys(values).length > 0) providers[providerId] = values;
  }
  return {
    version: 1,
    preferLocal: input?.preferLocal !== false,
    providers,
  };
}

async function loadLegacyMediaByokFile() {
  try {
    const raw = await readFile(getMediaByokPath(), "utf8");
    return normalizeMediaByokFile(JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return { version: 1, preferLocal: true, providers: {} };
    }
    return { version: 1, preferLocal: true, providers: {} };
  }
}

export async function loadMediaByokFile() {
  const { store } = await loadDesktopKeysStore();
  if (store.migratedAt > 0 || store.variables.length > 0) {
    const envMap = new Map(store.variables.map((item) => [item.key, item.value]));
    return envMapToMediaByok(envMap, true);
  }
  return loadLegacyMediaByokFile();
}

export async function saveMediaByokFile(input) {
  const payload = normalizeMediaByokFile(input);
  await upsertDesktopKeys(mediaByokToEnvEntries(payload));
  return payload;
}

/**
 * Brand agents are local/customer configuration, never shipped defaults.
 * Contract: docs/BRAND_AGENTS_CONFIG.md
 * Shape: { version: 1, agents: [{ id, name, brandId, ... }] }
 */
export function normalizeWodeAppBrandAgentsFile(input) {
  const ALLOWED_CONNECTORS = new Set(["shopify", "feishu", "dingtalk", "wecom"]);
  // Keep in sync with wodeapp-builtin-agents.default.json (Layer 0 ids).
  const RESERVED_IDS = new Set([
    "content-orchestrator",
    "feishu-agent-mcp",
    "visual-generation",
    "video-generation",
    "script-storyboard",
    "agent-infinite-canvas",
    "multi-agent-collab",
    "home-textile-industry-agent",
    "beauty-industry-agent",
    "consumer-electronics-industry-agent",
    "create-agent",
  ]);
  const ID_RE = /^[a-z][a-z0-9-]{1,62}$/;
  const BRAND_RE = /^[a-z][a-z0-9-]{0,31}$/;
  const KNOWLEDGE_RE = /^[a-z][a-z0-9_-]{0,31}$/;

  if (input && typeof input === "object" && !Array.isArray(input) && "version" in input) {
    if (input.version !== 1 && input.version !== "1") {
      return { version: 1, agents: [], ok: false, errors: [`unsupported version ${input.version}`] };
    }
  }

  const record = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const rawAgents = Array.isArray(record.agents)
    ? record.agents
    : Array.isArray(input)
      ? input
      : [];
  const seen = new Set();
  const agents = [];
  const warnings = [];
  for (const item of rawAgents) {
    if (!item || typeof item !== "object") continue;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const name = typeof item.name === "string" ? item.name.trim().slice(0, 64) : "";
    const brandId = typeof item.brandId === "string" ? item.brandId.trim() : "";
    if (!id || !name || !brandId) continue;
    if (!ID_RE.test(id) || RESERVED_IDS.has(id) || !BRAND_RE.test(brandId)) continue;
    if (seen.has(id)) {
      warnings.push(`duplicate id ${id}`);
      continue;
    }
    seen.add(id);
    const asScoped = (value, re, allowlist) => {
      if (!Array.isArray(value)) return [];
      const out = [];
      const localSeen = new Set();
      for (const entry of value) {
        if (typeof entry !== "string") continue;
        const trimmed = entry.trim();
        if (!trimmed || localSeen.has(trimmed)) continue;
        if (allowlist && !allowlist.has(trimmed)) continue;
        if (!re.test(trimmed)) continue;
        localSeen.add(trimmed);
        out.push(trimmed);
      }
      return out;
    };
    let workbench = item.workbench === "wynne" ? "wynne" : "generic";
    if (workbench === "wynne" && id !== "wynne-brand-agent" && brandId !== "wynne") {
      workbench = "generic";
      warnings.push(`workbench downgraded for ${id}`);
    }
    agents.push({
      id,
      name,
      brandId,
      meta: typeof item.meta === "string" ? item.meta.trim().slice(0, 80) : undefined,
      connectorScopes: asScoped(item.connectorScopes, BRAND_RE, ALLOWED_CONNECTORS),
      knowledgeScopes: asScoped(item.knowledgeScopes, KNOWLEDGE_RE),
      policy: Array.isArray(item.policy)
        ? item.policy.map((entry) => (typeof entry === "string" ? entry.trim().slice(0, 240) : "")).filter(Boolean)
        : undefined,
      entryPrompt: typeof item.entryPrompt === "string" ? item.entryPrompt.trim().slice(0, 500) : undefined,
      samplePrompt: typeof item.samplePrompt === "string" ? item.samplePrompt.trim().slice(0, 4000) : undefined,
      workbench,
      enabled: item.enabled === false ? false : true,
    });
  }
  return { version: 1, agents, ok: true, warnings };
}

export async function loadWodeAppBrandAgents() {
  const brandPath = getBrandAgentsPath();
  try {
    const raw = await readFile(brandPath, "utf8");
    const normalized = normalizeWodeAppBrandAgentsFile(JSON.parse(raw));
    return { version: 1, agents: normalized.agents };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "ENOENT") {
      const seeded = normalizeWodeAppBrandAgentsFile(WODEAPP_BRAND_AGENTS_SEED);
      const payload = { version: 1, agents: seeded.agents };
      try {
        await writePrivateJson(brandPath, payload);
      } catch {
        // Still return the seed for this session if write fails.
      }
      return payload;
    }
    return { version: 1, agents: [] };
  }
}

export async function saveWodeAppBrandAgents(input) {
  const normalized = normalizeWodeAppBrandAgentsFile(input);
  if (normalized.ok === false) {
    const error = Array.isArray(normalized.errors) ? normalized.errors.join("; ") : "invalid brand-agents config";
    throw new Error(error);
  }
  const payload = { version: 1, agents: normalized.agents };
  await writePrivateJson(getBrandAgentsPath(), payload);
  return payload;
}

function plazaItemsFrom(input) {
  if (Array.isArray(input)) return input.filter((item) => item && typeof item === "object");
  if (input && typeof input === "object" && Array.isArray(input.items)) {
    return input.items.filter((item) => item && typeof item === "object");
  }
  return [];
}

export async function loadWodeAppPlazaCatalog() {
  const catalogPath = getPlazaCatalogPath();
  try {
    const raw = JSON.parse(await readFile(catalogPath, "utf8"));
    return { version: 1, exists: true, items: plazaItemsFrom(raw) };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : null;
    if (code === "ENOENT") return { version: 1, exists: false, items: [] };
    return { version: 1, exists: false, items: [] };
  }
}

export async function saveWodeAppPlazaCatalog(input) {
  const items = plazaItemsFrom(input);
  const payload = { version: 1, items };
  await writePrivateJson(getPlazaCatalogPath(), payload);
  return { ...payload, exists: true };
}

async function writePrivateJson(filePath, value) {
  const dir = getConfigDir();
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(filePath, 0o600);
}

export async function loadWodeAppConfig() {
  try {
    const raw = await readFile(getConfigPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed?.origin) return null;
    return normalizeWodeAppCloudConfig(parsed);
  } catch {
    return null;
  }
}

export async function saveWodeAppConfig(config) {
  const normalized = normalizeWodeAppCloudConfig(config);
  const configPath = getConfigPath();
  await writePrivateJson(configPath, normalized);
  if (normalized.embeddedInstallId) {
    await writePrivateJson(getInstallPath(), { installId: normalized.embeddedInstallId });
  }
  return normalized;
}

export async function getOrCreateWodeAppInstallId() {
  const existingConfig = await loadWodeAppConfig();
  const fromConfig = typeof existingConfig?.embeddedInstallId === "string" ? existingConfig.embeddedInstallId.trim() : "";
  if (fromConfig) return fromConfig;

  try {
    const raw = await readFile(getInstallPath(), "utf8");
    const parsed = JSON.parse(raw);
    const fromInstallFile = typeof parsed?.installId === "string" ? parsed.installId.trim() : "";
    if (fromInstallFile) return fromInstallFile;
  } catch {
    // create below
  }

  const installId = `wodeappx-${randomUUID()}`;
  await writePrivateJson(getInstallPath(), { installId });
  return installId;
}

export async function clearWodeAppConfig() {
  try {
    await unlink(getConfigPath());
  } catch {
    // no config
  }
}

export function resolvePlatformOrigin(config) {
  const normalized = normalizeWodeAppCloudConfig(config);
  return normalizeWodeAppCloudOrigin(normalized.issuedOrigin || normalized.origin);
}

export function aiProxyBaseUrl(config) {
  return `${resolvePlatformOrigin(config)}/mainserver/api/ai/v1`;
}
