/**
 * Discover & import local Claude / CC Switch / Codex API credentials into the
 * desktop OpenCode auth store. Secrets stay on-device — never uploaded to WodeApp cloud.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveDesktopKeysPath, upsertDesktopKeys } from "./desktop-keys-store.mjs";

export const LOCAL_BYOK_PRIVACY_NOTICE =
  "仅在本机读取，并写入 ~/.wodeapp/keys.json；不会上传到 WodeApp 云端。";

export const LOCAL_BYOK_DEFAULT_MODEL_NOTICE =
  "同步不会改默认模型；工作台默认仍走平台中转。已写入的 Key 在能力表里显示为已配置。";

const PROVIDER_ENV_KEYS = {
  anthropic: { apiKey: "ANTHROPIC_API_KEY", baseURL: "ANTHROPIC_BASE_URL" },
  openai: { apiKey: "OPENAI_API_KEY", baseURL: "OPENAI_BASE_URL" },
  deepseek: { apiKey: "DEEPSEEK_API_KEY", baseURL: "DEEPSEEK_BASE_URL" },
  openrouter: { apiKey: "OPENROUTER_API_KEY", baseURL: "OPENROUTER_BASE_URL" },
  google: { apiKey: "GOOGLE_GENERATIVE_AI_API_KEY", baseURL: "GOOGLE_GENERATIVE_AI_BASE_URL" },
  groq: { apiKey: "GROQ_API_KEY", baseURL: "GROQ_BASE_URL" },
  xai: { apiKey: "XAI_API_KEY", baseURL: "XAI_BASE_URL" },
  mistral: { apiKey: "MISTRAL_API_KEY", baseURL: "MISTRAL_BASE_URL" },
};
const KNOWN_HOST_PROVIDERS = [
  { providerId: "openrouter", hosts: ["openrouter.ai"] },
  { providerId: "openai", hosts: ["api.openai.com"] },
  { providerId: "anthropic", hosts: ["api.anthropic.com"] },
  { providerId: "deepseek", hosts: ["api.deepseek.com"] },
  { providerId: "google", hosts: ["generativelanguage.googleapis.com", "ai.google.dev"] },
  { providerId: "groq", hosts: ["api.groq.com"] },
  { providerId: "xai", hosts: ["api.x.ai"] },
  { providerId: "mistral", hosts: ["api.mistral.ai"] },
];

const KEY_PREFIX_PROVIDERS = [
  { providerId: "openrouter", prefixes: ["sk-or-"] },
  { providerId: "anthropic", prefixes: ["sk-ant-"] },
];

function hostFromBaseUrl(baseURL) {
  const raw = String(baseURL ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function detectProviderId({ apiKey, baseURL }) {
  const key = String(apiKey ?? "").trim();
  for (const entry of KEY_PREFIX_PROVIDERS) {
    if (entry.prefixes.some((prefix) => key.startsWith(prefix))) {
      return entry.providerId;
    }
  }
  const host = hostFromBaseUrl(baseURL);
  if (host) {
    for (const entry of KNOWN_HOST_PROVIDERS) {
      if (entry.hosts.some((candidate) => host === candidate || host.endsWith(`.${candidate}`))) {
        return entry.providerId;
      }
    }
  }
  return null;
}

export function maskSecret(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.length <= 8) return `${raw.slice(0, 2)}***`;
  return `${raw.slice(0, 6)}***…${raw.slice(-4)}`;
}

function slugProviderId(name) {
  const slug = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "local-byok";
}

/**
 * @returns {null | {
 *   sourceId: string,
 *   sourceLabel: string,
 *   sourceKind: "claude-settings" | "codex-auth" | "cc-switch",
 *   providerId: string,
 *   apiKey: string,
 *   baseURL: string | null,
 *   modelHint: string | null,
 *   isCurrent: boolean,
 *   custom: boolean,
 * }}
 */
export function buildCandidateFromCredential(input) {
  const apiKey = String(input?.apiKey ?? "").trim();
  if (!apiKey) return null;
  // ChatGPT / Claude OAuth tokens are not OpenCode API keys.
  if (apiKey.startsWith("eyJ") && apiKey.length > 80) return null;
  if (/^PROXY_MANAGED$/i.test(apiKey)) return null;
  if (/^(not[-_]?needed|your[-_]?api[-_]?key|changeme|xxx+|placeholder)$/i.test(apiKey)) return null;
  if (apiKey.length < 12) return null;

  const baseURL = String(input?.baseURL ?? "").trim() || null;
  const detected = detectProviderId({ apiKey, baseURL });
  const custom = !detected;
  const providerId = detected
    || `local-${slugProviderId(input?.preferredId || input?.sourceLabel || "byok")}`;

  return {
    sourceId: String(input?.sourceId || providerId),
    sourceLabel: String(input?.sourceLabel || providerId),
    sourceKind: input?.sourceKind || "claude-settings",
    providerId,
    apiKey,
    baseURL,
    modelHint: typeof input?.modelHint === "string" && input.modelHint.trim()
      ? input.modelHint.trim()
      : null,
    isCurrent: Boolean(input?.isCurrent),
    custom,
  };
}

export function extractFromClaudeSettings(settings, options = {}) {
  const record = settings && typeof settings === "object" ? settings : {};
  const env = record.env && typeof record.env === "object" ? record.env : {};
  const apiKey = String(
    env.ANTHROPIC_API_KEY
      || env.ANTHROPIC_AUTH_TOKEN
      || record.apiKey
      || "",
  ).trim();
  const baseURL = String(
    env.ANTHROPIC_BASE_URL
      || record.base_url
      || record.baseUrl
      || "",
  ).trim() || null;
  return buildCandidateFromCredential({
    sourceId: options.sourceId || "claude-settings",
    sourceLabel: options.sourceLabel || "Claude Code / CC Switch 当前配置",
    sourceKind: options.sourceKind || "claude-settings",
    preferredId: "anthropic",
    apiKey,
    baseURL,
    modelHint: String(env.ANTHROPIC_DEFAULT_SONNET_MODEL || env.ANTHROPIC_MODEL || "").trim() || null,
    isCurrent: true,
  });
}

export function extractFromCodexAuth(auth, config = {}) {
  const record = auth && typeof auth === "object" ? auth : {};
  const apiKey = String(record.OPENAI_API_KEY || record.api_key || record.apiKey || "").trim();
  const baseURL = String(config.base_url || config.baseUrl || "").trim() || null;
  if (!apiKey) return null;
  return buildCandidateFromCredential({
    sourceId: "codex-auth",
    sourceLabel: "Codex CLI API Key",
    sourceKind: "codex-auth",
    preferredId: "openai",
    apiKey,
    baseURL,
    modelHint: typeof config.model === "string" ? config.model : null,
    isCurrent: true,
  });
}

export function extractFromCcSwitchProviderRow(row) {
  if (!row || typeof row !== "object") return null;
  let settings = row.settings_config;
  if (typeof settings === "string") {
    try {
      settings = JSON.parse(settings);
    } catch {
      return null;
    }
  }
  if (!settings || typeof settings !== "object") return null;

  const env = settings.env && typeof settings.env === "object" ? settings.env : {};
  const apiKey = String(
    settings.apiKey
      || env.ANTHROPIC_API_KEY
      || env.ANTHROPIC_AUTH_TOKEN
      || env.OPENAI_API_KEY
      || env.GEMINI_API_KEY
      || "",
  ).trim();
  const baseURL = String(
    settings.baseUrl
      || settings.base_url
      || env.ANTHROPIC_BASE_URL
      || env.OPENAI_BASE_URL
      || "",
  ).trim() || null;

  const models = Array.isArray(settings.models) ? settings.models : [];
  const modelHint = typeof models[0]?.id === "string" ? models[0].id : null;
  const appType = String(row.app_type || "").trim();
  const name = String(row.name || row.id || appType || "CC Switch").trim();

  return buildCandidateFromCredential({
    sourceId: `cc-switch:${appType}:${row.id || name}`,
    sourceLabel: `CC Switch · ${name}${appType ? ` (${appType})` : ""}`,
    sourceKind: "cc-switch",
    preferredId: row.id || name,
    apiKey,
    baseURL,
    modelHint,
    isCurrent: Boolean(row.is_current),
  });
}

function summarizeCandidate(candidate) {
  return {
    sourceId: candidate.sourceId,
    sourceLabel: candidate.sourceLabel,
    sourceKind: candidate.sourceKind,
    providerId: candidate.providerId,
    apiKeyPreview: maskSecret(candidate.apiKey),
    baseURL: candidate.baseURL,
    modelHint: candidate.modelHint,
    isCurrent: candidate.isCurrent,
    custom: candidate.custom,
  };
}

function parseSimpleTomlScalarSection(text) {
  // Minimal TOML peek for top-level keys only (Codex config.toml).
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("[")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    return null;
  }
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    return null;
  }
}

async function loadCcSwitchProviders(dbPath) {
  try {
    const sqlite = await import("node:sqlite");
    const DatabaseSync = sqlite.DatabaseSync;
    if (typeof DatabaseSync !== "function") return [];
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return db.prepare(`
        SELECT id, app_type, name, settings_config, is_current
        FROM providers
        ORDER BY is_current DESC, app_type, name
      `).all();
    } finally {
      db.close();
    }
  } catch {
    return [];
  }
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const out = [];
  for (const item of candidates) {
    if (!item) continue;
    const key = `${item.providerId}::${item.apiKey}::${item.baseURL || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export async function discoverLocalByokCandidates(homeDir = os.homedir()) {
  const home = String(homeDir || os.homedir());
  const candidates = [];
  const skipped = [];
  const rawEnvHints = [];

  const claudeSettings = await readJsonIfExists(path.join(home, ".claude", "settings.json"));
  if (claudeSettings) {
    const env = claudeSettings.env && typeof claudeSettings.env === "object" ? claudeSettings.env : {};
    for (const [key, value] of Object.entries(env)) {
      if (typeof value === "string" && value.trim() && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        if (/KEY|TOKEN|SECRET|PASSWORD|BASE_URL|API_URL/i.test(key)) {
          rawEnvHints.push({ key, value: value.trim(), source: "claude-settings", priority: 30 });
        }
      }
    }
    const fromClaude = extractFromClaudeSettings(claudeSettings);
    if (fromClaude) candidates.push(fromClaude);
    else if (!rawEnvHints.some((item) => item.source === "claude-settings")) {
      skipped.push({ source: "claude-settings", reason: "未找到可用的 API Key（可能是 OAuth）" });
    }
  }

  const codexAuth = await readJsonIfExists(path.join(home, ".codex", "auth.json"));
  const codexToml = await readTextIfExists(path.join(home, ".codex", "config.toml"));
  const codexConfig = parseSimpleTomlScalarSection(codexToml || "");
  if (codexAuth) {
    const fromCodex = extractFromCodexAuth(codexAuth, codexConfig);
    if (fromCodex) candidates.push(fromCodex);
    else if (codexAuth.auth_mode === "chatgpt" || codexAuth.tokens) {
      skipped.push({ source: "codex-auth", reason: "Codex 当前是 ChatGPT 登录，不是 API Key，无法导入" });
    }
  }

  const ccDb = path.join(home, ".cc-switch", "cc-switch.db");
  const rows = await loadCcSwitchProviders(ccDb);
  if (rows.length === 0) {
    // no-op when DB missing
  } else {
    let imported = 0;
    for (const row of rows) {
      const candidate = extractFromCcSwitchProviderRow(row);
      if (candidate) {
        candidates.push(candidate);
        imported += 1;
      }
    }
    if (imported === 0) {
      skipped.push({ source: "cc-switch", reason: "CC Switch 里没有可导入的 API Key 配置" });
    }
  }

  const unique = dedupeCandidates(candidates);
  return {
    ok: true,
    privacyNotice: LOCAL_BYOK_PRIVACY_NOTICE,
    defaultModelNotice: LOCAL_BYOK_DEFAULT_MODEL_NOTICE,
    candidates: unique.map(summarizeCandidate),
    // Keep secrets only in-process for subsequent import by sourceId.
    _secrets: Object.fromEntries(unique.map((item) => [item.sourceId, item])),
    _rawEnvHints: rawEnvHints,
    skipped,
  };
}

function envKeyPrefixForProvider(providerId) {
  const prefix = String(providerId || "custom")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return prefix || "CUSTOM";
}

export function envEntriesFromCandidate(candidate, priority = 10) {
  if (!candidate?.apiKey) return [];
  const mapping = PROVIDER_ENV_KEYS[candidate.providerId] || {
    apiKey: `${envKeyPrefixForProvider(candidate.providerId)}_API_KEY`,
    baseURL: `${envKeyPrefixForProvider(candidate.providerId)}_BASE_URL`,
  };
  const entries = [];
  entries.push({
    key: mapping.apiKey,
    value: candidate.apiKey,
    source: candidate.sourceLabel,
    priority: candidate.isCurrent ? priority + 20 : priority,
  });
  if (candidate.baseURL && mapping.baseURL) {
    entries.push({
      key: mapping.baseURL,
      value: candidate.baseURL,
      source: candidate.sourceLabel,
      priority: candidate.isCurrent ? priority + 20 : priority,
    });
  }
  // Claude Code often prefers AUTH_TOKEN over API_KEY.
  if (candidate.providerId === "anthropic" && candidate.apiKey.startsWith("sk-ant-")) {
    entries.push({
      key: "ANTHROPIC_AUTH_TOKEN",
      value: candidate.apiKey,
      source: candidate.sourceLabel,
      priority: candidate.isCurrent ? priority + 21 : priority + 1,
    });
  }
  return entries;
}

export function mergeEnvEntries(entryLists) {
  const best = new Map();
  for (const list of entryLists) {
    for (const entry of list || []) {
      if (!entry?.key || !entry?.value) continue;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(entry.key)) continue;
      if (entry.key.startsWith("OPENWORK_") || entry.key.startsWith("OPENCODE_")) continue;
      const prev = best.get(entry.key);
      if (!prev || (entry.priority || 0) >= (prev.priority || 0)) {
        best.set(entry.key, entry);
      }
    }
  }
  return [...best.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function resolveOpenworkEnvStorePath(homeDir = os.homedir()) {
  return resolveDesktopKeysPath(homeDir);
}

export async function upsertOpenworkEnvEntries(entries, homeDir = os.homedir()) {
  const written = await upsertDesktopKeys(entries, homeDir);
  return {
    storePath: written.storePath,
    count: entries.length,
    keys: entries.map((item) => item.key),
  };
}

/**
 * One-click: discover local Claude/CC Switch/Codex credentials → write OpenWork
 * ~/.wodeapp/keys.json + local OpenCode auth.json. Never uploads.
 */
export async function syncLocalByokToEnv(input = {}) {
  const homeDir = input?.homeDir || os.homedir();
  const discovery = input?.discovery || await discoverLocalByokCandidates(homeDir);
  const secrets = Object.values(discovery?._secrets || {});
  const fromCandidates = secrets.flatMap((item) => envEntriesFromCandidate(item));
  const fromHints = Array.isArray(discovery?._rawEnvHints) ? discovery._rawEnvHints : [];
  const merged = mergeEnvEntries([fromHints, fromCandidates]);
  if (merged.length === 0) {
    return {
      ok: false,
      privacyNotice: LOCAL_BYOK_PRIVACY_NOTICE,
      uploaded: false,
      error: "未发现可同步的本机 API Key / 环境变量",
      skipped: discovery?.skipped || [],
    };
  }

  const envWrite = await upsertOpenworkEnvEntries(merged, homeDir);
  const userDataDir = String(input?.userDataDir || "").trim();
  const accountId = String(input?.accountId || "anonymous").trim() || "anonymous";
  const targets = await resolveAuthTargets(userDataDir, accountId);
  const writtenAuth = [];
  for (const candidate of secrets) {
    if (!candidate?.providerId || candidate.custom) continue;
    if (!PROVIDER_ENV_KEYS[candidate.providerId]) continue;
    if (targets.length === 0) continue;
    const paths = await writeProviderAuth(targets, candidate.providerId, candidate.apiKey);
    writtenAuth.push(...paths);
  }

  return {
    ok: true,
    privacyNotice: LOCAL_BYOK_PRIVACY_NOTICE,
    defaultModelNotice: LOCAL_BYOK_DEFAULT_MODEL_NOTICE,
    uploaded: false,
    destination: "local-openwork-env",
    envStorePath: envWrite.storePath,
    syncedKeys: envWrite.keys,
    syncedCount: envWrite.count,
    syncedPreviews: merged.map((item) => ({
      key: item.key,
      preview: /KEY|TOKEN|SECRET|PASSWORD/i.test(item.key) ? maskSecret(item.value) : item.value,
      source: item.source || "",
    })),
    writtenAuth: [...new Set(writtenAuth)],
    skipped: discovery?.skipped || [],
  };
}

async function loadRuntimeAccountPathsModule() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "../wodeapp-runtime-account-paths.mjs"),
    path.join(here, "../../openwork/fork/apps/desktop/electron/wodeapp-runtime-account-paths.mjs"),
    path.join(here, "../../../integrations/openwork/fork/apps/desktop/electron/wodeapp-runtime-account-paths.mjs"),
  ];
  for (const filePath of candidates) {
    try {
      return await import(pathToFileURL(filePath).href);
    } catch {
      // try next
    }
  }
  return null;
}

async function resolveAuthTargets(userDataDir, accountId) {
  try {
    const mod = await loadRuntimeAccountPathsModule();
    if (!mod || !userDataDir) return [];
    const {
      listExistingRuntimeAccountPaths,
      managedRuntimeDataPaths,
      sanitizeRuntimeAccountScope,
    } = mod;
    const paths = await listExistingRuntimeAccountPaths(userDataDir);
    const primary = managedRuntimeDataPaths(
      userDataDir,
      sanitizeRuntimeAccountScope(accountId) || "anonymous",
    );
    return [...paths, primary].filter((item, index, all) =>
      all.findIndex((other) => other.opencodeAuthPath === item.opencodeAuthPath) === index
    );
  } catch {
    return [];
  }
}

async function writeProviderAuth(targets, providerId, apiKey) {
  const written = [];
  for (const item of targets) {
    await mkdir(path.dirname(item.opencodeAuthPath), { recursive: true });
    let auth = {};
    try {
      auth = JSON.parse(await readFile(item.opencodeAuthPath, "utf8"));
      if (!auth || typeof auth !== "object") auth = {};
    } catch {
      auth = {};
    }
    auth[providerId] = { type: "api", key: apiKey };
    await writeFile(item.opencodeAuthPath, `${JSON.stringify(auth, null, 2)}\n`, { mode: 0o600 });
    written.push(item.opencodeAuthPath);
  }
  return written;
}

async function upsertCustomModelsProvider(homeDir, candidate) {
  if (!candidate.custom && !candidate.baseURL) return null;
  // Known providers with default hosts do not need models.json.
  if (!candidate.custom) {
    const detected = detectProviderId({ apiKey: candidate.apiKey, baseURL: candidate.baseURL });
    if (detected && (!candidate.baseURL || detectProviderId({ baseURL: candidate.baseURL }) === detected)) {
      return null;
    }
  }

  const modelsPath = path.join(homeDir, ".wodeapp", "models.json");
  let file = { models: {}, providers: {} };
  try {
    const raw = JSON.parse(await readFile(modelsPath, "utf8"));
    if (raw && typeof raw === "object") file = raw;
  } catch {
    // create new
  }
  if (!file.providers || typeof file.providers !== "object") file.providers = {};
  const modelId = candidate.modelHint || "default";
  file.providers[candidate.providerId] = {
    name: candidate.sourceLabel,
    npm: "@ai-sdk/openai-compatible",
    options: {
      baseURL: candidate.baseURL || undefined,
      apiKey: candidate.apiKey,
    },
    models: {
      [modelId]: { name: modelId },
    },
  };
  await mkdir(path.dirname(modelsPath), { recursive: true });
  await writeFile(modelsPath, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  return modelsPath;
}

/**
 * Import one discovered candidate into local OpenCode auth (+ optional models.json).
 * Never sends credentials over the network.
 */
export async function importLocalByokCandidate(input) {
  const homeDir = input?.homeDir || os.homedir();
  const discovery = input?.discovery || await discoverLocalByokCandidates(homeDir);
  const sourceId = String(input?.sourceId || "").trim();
  const candidate = discovery?._secrets?.[sourceId];
  if (!candidate) {
    return {
      ok: false,
      privacyNotice: LOCAL_BYOK_PRIVACY_NOTICE,
      error: "未找到可导入的本机配置（可能已变更，请重新扫描）",
    };
  }

  const userDataDir = String(input?.userDataDir || "").trim();
  const accountId = String(input?.accountId || "anonymous").trim() || "anonymous";
  const targets = await resolveAuthTargets(userDataDir, accountId);
  if (targets.length === 0) {
    return {
      ok: false,
      privacyNotice: LOCAL_BYOK_PRIVACY_NOTICE,
      error: "找不到本机引擎凭据目录，请确认在桌面端内操作",
    };
  }

  const writtenAuth = await writeProviderAuth(targets, candidate.providerId, candidate.apiKey);
  const modelsPath = await upsertCustomModelsProvider(homeDir, candidate);

  return {
    ok: true,
    privacyNotice: LOCAL_BYOK_PRIVACY_NOTICE,
    defaultModelNotice: LOCAL_BYOK_DEFAULT_MODEL_NOTICE,
    uploaded: false,
    destination: "local-opencode-auth",
    providerId: candidate.providerId,
    apiKeyPreview: maskSecret(candidate.apiKey),
    baseURL: candidate.baseURL,
    modelHint: candidate.modelHint,
    writtenAuth,
    modelsPath,
    // Returned only over local IPC so the renderer can auth.set without re-reading disk.
    apiKey: candidate.apiKey,
  };
}

export function toPublicDiscovery(discovery) {
  return {
    ok: Boolean(discovery?.ok),
    privacyNotice: discovery?.privacyNotice || LOCAL_BYOK_PRIVACY_NOTICE,
    defaultModelNotice: discovery?.defaultModelNotice || LOCAL_BYOK_DEFAULT_MODEL_NOTICE,
    candidates: Array.isArray(discovery?.candidates) ? discovery.candidates : [],
    skipped: Array.isArray(discovery?.skipped) ? discovery.skipped : [],
  };
}
