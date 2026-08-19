/**
 * Generic on-device Key store for WodeAppX.
 * Path: ~/.wodeapp/keys.json (same schema as OpenWork env.json).
 * Holds any local vendor / custom provider env keys the engine can consume.
 * Login / platform API Key stays in credentials.v1.json — never mixed in here.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const DESKTOP_KEYS_FILE_NAME = "keys.json";
export const DESKTOP_KEYS_SCHEMA_VERSION = 1;

/** Known vendor keys (capability table). Storage also accepts matching custom suffixes. */
export const VENDOR_ENV_KEY_ALLOWLIST = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "MOONSHOT_API_KEY",
  "MOONSHOT_BASE_URL",
  "KIMI_API_KEY",
  "KIMICODE_API_KEY",
  "KIMICODE_BASE_URL",
  "DASHSCOPE_API_KEY",
  "ARK_API_KEY",
  "VOLC_ARK_API_KEY",
  "VOLCENGINE_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GOOGLE_GENERATIVE_AI_BASE_URL",
  "ZAI_API_KEY",
  "ZHIPU_API_KEY",
  "MINIMAX_API_KEY",
  "MINIMAX_CODING_API_KEY",
  "REPLICATE_API_TOKEN",
  "RUNWAY_API_KEY",
  "KLING_ACCESS_KEY",
  "KLING_SECRET_KEY",
  "HUGGINGFACE_API_KEY",
]);

const MEDIA_TO_ENV = {
  kling: { accessKey: "KLING_ACCESS_KEY", secretKey: "KLING_SECRET_KEY" },
  seedance: { apiKey: "ARK_API_KEY" },
  runway: { apiKey: "RUNWAY_API_KEY" },
  replicate: { apiToken: "REPLICATE_API_TOKEN" },
  "openai-image": { apiKey: "OPENAI_API_KEY" },
};

export function defaultDesktopKeysPath(homeDir = os.homedir()) {
  return path.join(homeDir, ".wodeapp", DESKTOP_KEYS_FILE_NAME);
}

export function resolveDesktopKeysPath(homeDir = os.homedir()) {
  const override = String(process.env.OPENWORK_ENV_STORE || "").trim();
  if (override) return path.resolve(override);
  return defaultDesktopKeysPath(homeDir);
}

export function legacyOpenworkEnvStorePath(homeDir = os.homedir()) {
  if (process.platform === "win32") {
    const appData = String(process.env.APPDATA || "").trim();
    const root = appData || path.join(homeDir, "AppData", "Roaming");
    return path.join(root, "openwork", "env.json");
  }
  const xdg = String(process.env.XDG_CONFIG_HOME || "").trim();
  if (xdg) return path.join(xdg, "openwork", "env.json");
  return path.join(homeDir, ".config", "openwork", "env.json");
}

/** Point OpenWork's env loader at the unified store before the engine starts. */
export function pinOpenworkEnvStore(homeDir = os.homedir()) {
  if (String(process.env.OPENWORK_ENV_STORE || "").trim()) return process.env.OPENWORK_ENV_STORE;
  const storePath = defaultDesktopKeysPath(homeDir);
  process.env.OPENWORK_ENV_STORE = storePath;
  return storePath;
}

const DENIED_ENV_KEYS = new Set([
  "PORT",
  "HOST",
  "NODE_ENV",
  "DATABASE_URL",
  "DIRECT_URL",
]);

const DENIED_ENV_PREFIXES = [
  "JWT_",
  "SESSION_",
  "COOKIE_",
  "STRIPE_",
  "ALIPAY_",
  "WECHAT_PAY",
  "WECHATPAY_",
  "PAYPAL_",
  "ALIYUN_SMS",
  "SMS_",
  "REDIS_",
  "MONGO_",
  "MYSQL_",
  "POSTGRES_",
  "WODEAPP_",
  "OPENWORK_",
  "OPENCODE_",
];

const STORABLE_ENV_SUFFIX = /_(API_KEY|API_TOKEN|API_SECRET|AUTH_TOKEN|ACCESS_KEY|SECRET_KEY|BASE_URL|LABEL)$/;

function isDeniedEnvKey(key) {
  if (DENIED_ENV_KEYS.has(key)) return true;
  return DENIED_ENV_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/** Generic local Key: known vendors, or custom FOO_API_KEY / FOO_BASE_URL. */
export function isStorableEnvKey(key) {
  const raw = String(key || "").trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(raw)) return false;
  const normalized = raw.toUpperCase();
  if (isDeniedEnvKey(normalized)) return false;
  if (VENDOR_ENV_KEY_ALLOWLIST.has(normalized)) return true;
  return STORABLE_ENV_SUFFIX.test(normalized);
}

export function isVendorEnvKey(key) {
  return isStorableEnvKey(key);
}

export function desktopStoreHasLocalVendorKeys(store) {
  const vars = Array.isArray(store?.variables) ? store.variables : [];
  return vars.some((item) => {
    const key = String(item?.key || "").trim();
    const value = String(item?.value || "").trim();
    return Boolean(key && value && isVendorEnvKey(key) && !skipSecretValue(value));
  });
}

export async function hasDesktopLocalVendorKeys(homeDir = os.homedir()) {
  const { store } = await loadDesktopKeysStore(homeDir);
  return desktopStoreHasLocalVendorKeys(store);
}

function skipSecretValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return true;
  const lower = raw.toLowerCase();
  if (/^your[_-]/i.test(raw)) return true;
  if (lower === "changeme" || lower === "todo" || lower === "xxx") return true;
  if (lower.includes("replace") && (lower.includes("secret") || lower.includes("key") || lower.includes("token"))) {
    return true;
  }
  return false;
}

function emptyStore() {
  return {
    schemaVersion: DESKTOP_KEYS_SCHEMA_VERSION,
    updatedAt: 0,
    migratedAt: 0,
    variables: [],
    customVendors: [],
  };
}

function normalizeCustomVendorMeta(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id || "").trim();
    const name = String(item.name || "").trim();
    const envPrefix = String(item.envPrefix || "").trim().toUpperCase();
    if (!id || !name || !/^[A-Z][A-Z0-9_]*$/.test(envPrefix)) continue;
    if (seen.has(id) || seen.has(envPrefix)) continue;
    seen.add(id);
    seen.add(envPrefix);
    out.push({ id, name, envPrefix });
  }
  return out;
}

function normalizeStore(raw) {
  const variables = Array.isArray(raw?.variables)
    ? raw.variables
      .filter((item) => item && typeof item.key === "string" && typeof item.value === "string")
      .filter((item) => isVendorEnvKey(item.key) && item.value.trim() && !skipSecretValue(item.value))
      .map((item) => ({
        key: item.key.trim(),
        value: item.value.trim(),
        updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : Date.now(),
      }))
    : [];
  return {
    schemaVersion: DESKTOP_KEYS_SCHEMA_VERSION,
    updatedAt: typeof raw?.updatedAt === "number" ? raw.updatedAt : 0,
    migratedAt: typeof raw?.migratedAt === "number" ? raw.migratedAt : 0,
    variables,
    customVendors: normalizeCustomVendorMeta(raw?.customVendors),
  };
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function loadDesktopKeysStore(homeDir = os.homedir()) {
  const storePath = resolveDesktopKeysPath(homeDir);
  const raw = await readJsonIfExists(storePath);
  return { storePath, store: normalizeStore(raw) };
}

function mergeVariables(lists) {
  const byKey = new Map();
  for (const list of lists) {
    for (const item of list || []) {
      if (!item?.key || !item?.value) continue;
      if (!isVendorEnvKey(item.key)) continue;
      if (skipSecretValue(item.value)) continue;
      byKey.set(item.key, {
        key: item.key,
        value: item.value,
        updatedAt: typeof item.updatedAt === "number" ? item.updatedAt : Date.now(),
      });
    }
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function mediaByokToEnvEntries(mediaFile) {
  const entries = [];
  const providers = mediaFile?.providers && typeof mediaFile.providers === "object"
    ? mediaFile.providers
    : {};
  for (const [providerId, fieldMap] of Object.entries(MEDIA_TO_ENV)) {
    const values = providers[providerId];
    if (!values || typeof values !== "object") continue;
    for (const [field, envKey] of Object.entries(fieldMap)) {
      const value = String(values[field] || "").trim();
      if (!value || skipSecretValue(value)) continue;
      entries.push({ key: envKey, value, updatedAt: Date.now() });
    }
  }
  return entries;
}

export function envMapToMediaByok(envMap, preferLocal = true) {
  const providers = {};
  for (const [providerId, fieldMap] of Object.entries(MEDIA_TO_ENV)) {
    const values = {};
    for (const [field, envKey] of Object.entries(fieldMap)) {
      const value = String(envMap.get(envKey) || "").trim();
      if (value) values[field] = value;
    }
    if (Object.keys(values).length > 0) providers[providerId] = values;
  }
  return { version: 1, preferLocal, providers };
}

function variablesFromEnvObject(obj) {
  const entries = [];
  for (const [key, value] of Object.entries(obj || {})) {
    const trimmed = String(value || "").trim();
    if (!isVendorEnvKey(key) || !trimmed || skipSecretValue(trimmed)) continue;
    entries.push({ key, value: trimmed, updatedAt: Date.now() });
  }
  return entries;
}

function variablesFromEnvStoreRaw(raw) {
  if (!raw || !Array.isArray(raw.variables)) return [];
  return variablesFromEnvObject(
    Object.fromEntries(
      raw.variables
        .filter((item) => item && typeof item.key === "string" && typeof item.value === "string")
        .map((item) => [item.key, item.value]),
    ),
  );
}

export async function writeDesktopKeysStore(store, homeDir = os.homedir()) {
  const storePath = resolveDesktopKeysPath(homeDir);
  await mkdir(path.dirname(storePath), { recursive: true });
  const normalized = normalizeStore(store);
  const now = Date.now();
  const payload = {
    schemaVersion: DESKTOP_KEYS_SCHEMA_VERSION,
    updatedAt: now,
    migratedAt: typeof normalized.migratedAt === "number" ? normalized.migratedAt : 0,
    variables: normalized.variables,
    customVendors: normalized.customVendors,
  };
  await writeFile(storePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  return { storePath, store: payload };
}

export async function upsertDesktopKeys(entries, homeDir = os.homedir()) {
  const { store } = await loadDesktopKeysStore(homeDir);
  const variables = mergeVariables([store.variables, entries]);
  return writeDesktopKeysStore({ ...store, variables }, homeDir);
}

/**
 * One-time: fold legacy env.json / media-byok / project .env vendor keys into keys.json.
 * Does not copy JWT, payment, SMS, or DATABASE_URL.
 */
export async function ensureDesktopKeysMigrated(input = {}) {
  const homeDir = input.homeDir || os.homedir();
  const { store, storePath } = await loadDesktopKeysStore(homeDir);
  if (store.migratedAt > 0) {
    return { storePath, store, migrated: false };
  }

  const sources = [store.variables];
  const legacyEnv = await readJsonIfExists(legacyOpenworkEnvStorePath(homeDir));
  sources.push(variablesFromEnvStoreRaw(legacyEnv));

  const mediaFile = input.mediaFile || await readJsonIfExists(
    path.join(homeDir, ".wodeapp", "media-byok.json"),
  );
  if (mediaFile) {
    sources.push(mediaByokToEnvEntries(mediaFile));
  }

  if (input.projectEnvMap instanceof Map) {
    sources.push(variablesFromEnvObject(Object.fromEntries(input.projectEnvMap)));
  } else if (input.projectEnvMap && typeof input.projectEnvMap === "object") {
    sources.push(variablesFromEnvObject(input.projectEnvMap));
  }

  const variables = mergeVariables(sources);
  const written = await writeDesktopKeysStore({
    ...store,
    migratedAt: Date.now(),
    variables,
  }, homeDir);
  return { ...written, migrated: true };
}
