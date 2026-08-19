/**
 * Custom OpenAI-compatible cloud vendors in ~/.wodeapp/keys.json.
 * One row = display name + Base URL + Key. Probe GET {base}/models.
 */
import {
  isVendorEnvKey,
  loadDesktopKeysStore,
  writeDesktopKeysStore,
} from "./desktop-keys-store.mjs";

export const RESERVED_CUSTOM_ENV_PREFIXES = new Set([
  "ANTHROPIC",
  "OPENAI",
  "DEEPSEEK",
  "OPENROUTER",
  "MOONSHOT",
  "KIMI",
  "KIMICODE",
  "DASHSCOPE",
  "ARK",
  "VOLC_ARK",
  "VOLCENGINE",
  "GOOGLE",
  "GEMINI",
  "GOOGLE_GENERATIVE_AI",
  "ZAI",
  "ZHIPU",
  "MINIMAX",
  "MINIMAX_CODING",
  "REPLICATE",
  "RUNWAY",
  "KLING",
  "HUGGINGFACE",
  "WODEAPP",
  "OPENWORK",
  "OPENCODE",
]);

const API_KEY_SUFFIX = /_API_KEY$/;

export function customVendorIdFromPrefix(prefix) {
  const raw = String(prefix || "").trim().toUpperCase();
  const kebab = raw.toLowerCase().replace(/_+/g, "-").replace(/^-|-$/g, "");
  return kebab ? `custom-${kebab}` : "custom-cloud";
}

export function slugifyVendorName(name) {
  const raw = String(name || "").trim();
  const ascii = raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  if (ascii && /^[A-Z]/.test(ascii)) {
    return ascii.slice(0, 24).replace(/_+$/g, "") || "CUSTOM_CLOUD";
  }
  const hex = [...raw]
    .slice(0, 3)
    .map((char) => (char.codePointAt(0) || 0).toString(16).toUpperCase())
    .join("");
  return `CUSTOM_${hex || "CLOUD"}`.slice(0, 24);
}

export function isReservedCustomEnvPrefix(prefix) {
  const key = String(prefix || "").trim().toUpperCase();
  if (!key) return true;
  if (RESERVED_CUSTOM_ENV_PREFIXES.has(key)) return true;
  return [...RESERVED_CUSTOM_ENV_PREFIXES].some((item) => key === item || key.startsWith(`${item}_`));
}

export function allocateEnvPrefix(name, usedPrefixes = []) {
  const used = new Set(
    [...usedPrefixes].map((item) => String(item || "").trim().toUpperCase()).filter(Boolean),
  );
  const base = slugifyVendorName(name);
  let prefix = isReservedCustomEnvPrefix(base) ? `${base}_X` : base;
  if (isReservedCustomEnvPrefix(prefix)) prefix = "CUSTOM_CLOUD";
  let next = prefix;
  let n = 2;
  while (used.has(next) || isReservedCustomEnvPrefix(next)) {
    next = `${prefix}_${n}`;
    n += 1;
    if (n > 99) {
      next = `CUSTOM_${Date.now().toString(36).toUpperCase()}`;
      break;
    }
  }
  return next;
}

export function normalizeOpenAiCompatibleBaseUrl(raw) {
  const text = String(raw || "").trim();
  if (!text) return { ok: false, error: "请填写 Base URL" };
  let url;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: "Base URL 不是合法地址" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "Base URL 须是 http 或 https" };
  }
  if (url.username || url.password) {
    return { ok: false, error: "不要把 Key 写进 URL" };
  }
  return { ok: true, baseURL: url.href.replace(/\/+$/, "") };
}

export function openaiCompatibleModelsUrl(baseURL) {
  const raw = String(baseURL || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  if (/\/models$/i.test(raw)) return raw;
  return `${raw}/models`;
}

export function humanizeEnvPrefix(prefix) {
  const raw = String(prefix || "").trim();
  if (!raw) return "自定义厂商";
  return raw
    .split(/_+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

export function normalizeCustomVendorRecords(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const id = String(item.id || "").trim();
    const name = String(item.name || "").trim();
    const envPrefix = String(item.envPrefix || "").trim().toUpperCase();
    if (!id || !name || !/^[A-Z][A-Z0-9_]*$/.test(envPrefix)) continue;
    if (isReservedCustomEnvPrefix(envPrefix)) continue;
    if (seen.has(id) || seen.has(envPrefix)) continue;
    seen.add(id);
    seen.add(envPrefix);
    out.push({ id, name, envPrefix });
  }
  return out;
}

function envEntries(envMap, processEnv) {
  const out = new Map();
  const push = (key, value) => {
    const name = String(key || "").trim();
    const trimmed = String(value || "").trim();
    if (!name || !trimmed || !isVendorEnvKey(name)) return;
    out.set(name, trimmed);
  };
  if (envMap instanceof Map) {
    for (const [key, value] of envMap) push(key, value);
  } else if (envMap && typeof envMap === "object") {
    for (const [key, value] of Object.entries(envMap)) push(key, value);
  }
  for (const [key, value] of Object.entries(processEnv || {})) {
    if (!out.has(key)) push(key, value);
  }
  return out;
}

export function listCustomVendorPairsFromEnv(input = {}, customVendors = [], origins = new Map()) {
  const isOptions = Boolean(input && typeof input === "object" && !(input instanceof Map)
    && (input.envMap || input.processEnv || Array.isArray(input.customVendors)));
  const envMap = isOptions ? (input.envMap || {}) : input;
  const processEnv = isOptions ? (input.processEnv || {}) : {};
  const vendors = isOptions && Array.isArray(input.customVendors) ? input.customVendors : customVendors;
  const originMap = isOptions && input.origins instanceof Map ? input.origins : origins;
  const bag = envEntries(envMap, processEnv);
  const meta = normalizeCustomVendorRecords(vendors);
  const usedPrefixes = new Set();
  const pairs = [];

  const pushPair = (prefix, name, id) => {
    const envPrefix = String(prefix || "").trim().toUpperCase();
    if (!envPrefix || usedPrefixes.has(envPrefix) || isReservedCustomEnvPrefix(envPrefix)) return;
    const apiKey = bag.get(`${envPrefix}_API_KEY`) || "";
    const baseURL = bag.get(`${envPrefix}_BASE_URL`) || "";
    if (!apiKey || !baseURL) return;
    const parsed = normalizeOpenAiCompatibleBaseUrl(baseURL);
    if (!parsed.ok) return;
    usedPrefixes.add(envPrefix);
    const vendorId = id || customVendorIdFromPrefix(envPrefix);
    pairs.push({
      id: vendorId,
      name: String(name || bag.get(`${envPrefix}_LABEL`) || humanizeEnvPrefix(envPrefix)).trim(),
      envPrefix,
      apiKey,
      baseURL: parsed.baseURL,
      modelsUrl: openaiCompatibleModelsUrl(parsed.baseURL),
      keyOrigin: originMap.get(`${envPrefix}_API_KEY`) || "desktop-env",
    });
  };

  for (const vendor of meta) {
    pushPair(vendor.envPrefix, vendor.name, vendor.id);
  }
  for (const key of bag.keys()) {
    const match = key.match(/^([A-Z][A-Z0-9_]*)_API_KEY$/);
    if (!match) continue;
    pushPair(match[1], bag.get(`${match[1]}_LABEL`) || "", "");
  }
  return pairs;
}

export function applyVendorEnvToProcess(entries, removeKeys = []) {
  for (const key of removeKeys) {
    const name = String(key || "").trim();
    if (name) delete process.env[name];
  }
  for (const item of entries || []) {
    const key = String(item?.key || "").trim();
    const value = String(item?.value || "").trim();
    if (key && value) process.env[key] = value;
  }
}

export function customVendorEnvKeys(prefix) {
  const envPrefix = String(prefix || "").trim().toUpperCase();
  return [`${envPrefix}_API_KEY`, `${envPrefix}_BASE_URL`, `${envPrefix}_LABEL`];
}

export async function upsertCustomVendor(input = {}, homeDir) {
  const name = String(input.name || "").trim();
  const apiKey = String(input.apiKey || "").trim();
  if (!name) return { ok: false, error: "请填写名称" };
  if (name.length > 40) return { ok: false, error: "名称不要超过 40 个字" };
  if (!apiKey) return { ok: false, error: "请填写 Key" };
  const parsed = normalizeOpenAiCompatibleBaseUrl(input.baseURL);
  if (!parsed.ok) return parsed;

  const { store } = await loadDesktopKeysStore(homeDir);
  const existing = normalizeCustomVendorRecords(store.customVendors);
  const requestedId = String(input.id || "").trim();
  const current = requestedId ? existing.find((item) => item.id === requestedId) : null;
  const usedPrefixes = existing
    .filter((item) => !current || item.id !== current.id)
    .map((item) => item.envPrefix);
  const envPrefix = current?.envPrefix || allocateEnvPrefix(name, usedPrefixes);
  const id = current?.id || customVendorIdFromPrefix(envPrefix);
  const now = Date.now();
  const entries = [
    { key: `${envPrefix}_API_KEY`, value: apiKey, updatedAt: now },
    { key: `${envPrefix}_BASE_URL`, value: parsed.baseURL, updatedAt: now },
    { key: `${envPrefix}_LABEL`, value: name, updatedAt: now },
  ];
  const byKey = new Map((store.variables || []).map((item) => [item.key, item]));
  for (const entry of entries) byKey.set(entry.key, entry);
  const customVendors = [
    ...existing.filter((item) => item.id !== id),
    { id, name, envPrefix },
  ];
  const written = await writeDesktopKeysStore({
    ...store,
    variables: [...byKey.values()],
    customVendors,
  }, homeDir);
  applyVendorEnvToProcess(entries);
  return {
    ok: true,
    vendor: {
      id,
      name,
      envPrefix,
      baseURL: parsed.baseURL,
      modelsUrl: openaiCompatibleModelsUrl(parsed.baseURL),
    },
    store: written.store,
  };
}

export async function removeCustomVendor(id, homeDir) {
  const vendorId = String(id || "").trim();
  if (!vendorId) return { ok: false, error: "缺少厂商" };
  const { store } = await loadDesktopKeysStore(homeDir);
  const existing = normalizeCustomVendorRecords(store.customVendors);
  const current = existing.find((item) => item.id === vendorId);
  if (!current) return { ok: false, error: "没有这个自定义厂商" };
  const drop = new Set(customVendorEnvKeys(current.envPrefix));
  const variables = (store.variables || []).filter((item) => !drop.has(item.key));
  const written = await writeDesktopKeysStore({
    ...store,
    variables,
    customVendors: existing.filter((item) => item.id !== vendorId),
  }, homeDir);
  applyVendorEnvToProcess([], [...drop]);
  return { ok: true, vendor: { id: vendorId, envPrefix: current.envPrefix }, store: written.store };
}

export function isCustomVendorApiKeyEnv(key) {
  const raw = String(key || "").trim();
  if (!API_KEY_SUFFIX.test(raw)) return false;
  const prefix = raw.replace(API_KEY_SUFFIX, "");
  return !isReservedCustomEnvPrefix(prefix);
}
