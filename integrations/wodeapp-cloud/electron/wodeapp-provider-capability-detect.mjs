/**
 * Probe configured BYOK keys against vendor model lists.
 * Canonical store is ~/.wodeapp/keys.json. Project .env is imported once, then ignored.
 * Returns public records only — never log or return raw secrets.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resolveOpenworkEnvStorePath } from "./local-byok-import.mjs";
import { loadMediaByokFile, loadWodeAppConfig, resolvePlatformOrigin } from "./config-store.mjs";
import {
  ensureDesktopKeysMigrated,
  loadDesktopKeysStore,
  pinOpenworkEnvStore,
} from "./desktop-keys-store.mjs";

/** Same merge order as sync-byok-from-wodeapp-server.mjs: later files win. */
export const MONOREPO_ENV_RELATIVE_PATHS = [".env", "server/.env", "runtime-server/.env"];

const PROBE_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 15 * 60 * 1000;

export const PROVIDER_PROBE_SPECS = [
  {
    id: "deepseek",
    label: "DeepSeek",
    envKeys: ["DEEPSEEK_API_KEY"],
    authIds: ["deepseek"],
    modelsUrl: "https://api.deepseek.com/models",
  },
  {
    id: "moonshot",
    label: "Kimi / Moonshot",
    envKeys: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
    authIds: ["moonshot", "kimi"],
    modelsUrl: "https://api.moonshot.cn/v1/models",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    envKeys: ["OPENROUTER_API_KEY"],
    authIds: ["openrouter"],
    modelsUrl: "https://openrouter.ai/api/v1/models",
  },
  {
    id: "openai",
    label: "OpenAI",
    envKeys: ["OPENAI_API_KEY"],
    authIds: ["openai"],
    modelsUrl: "https://api.openai.com/v1/models",
  },
  {
    id: "dashscope",
    label: "通义 / 百炼",
    envKeys: ["DASHSCOPE_API_KEY"],
    authIds: ["dashscope", "alibaba"],
    modelsUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/models",
  },
  {
    id: "volcano",
    label: "火山方舟 ARK",
    envKeys: ["ARK_API_KEY", "VOLC_ARK_API_KEY", "VOLCENGINE_API_KEY"],
    authIds: ["volcano", "doubao", "ark"],
    mediaIds: ["seedance"],
    modelsUrl: "https://ark.cn-beijing.volces.com/api/v3/models",
  },
];

export const MEDIA_ONLY_SPECS = [
  {
    id: "kling",
    label: "可灵 Kling",
    envKeys: ["KLING_ACCESS_KEY"],
    envPairKeys: ["KLING_ACCESS_KEY", "KLING_SECRET_KEY"],
    mediaIds: ["kling"],
    assumed: { video: true },
  },
  {
    id: "runway",
    label: "Runway",
    envKeys: ["RUNWAY_API_KEY"],
    mediaIds: ["runway"],
    assumed: { video: true },
  },
  {
    id: "replicate",
    label: "Replicate",
    envKeys: ["REPLICATE_API_TOKEN"],
    mediaIds: ["replicate"],
    assumed: { image: true },
  },
  {
    id: "minimax",
    label: "MiniMax",
    envKeys: ["MINIMAX_API_KEY"],
    assumed: { text: true, video: true },
  },
  {
    id: "google",
    label: "Google Gemini",
    envKeys: ["GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    assumed: { text: true, image: true },
  },
  {
    id: "zai",
    label: "智谱 GLM",
    envKeys: ["ZAI_API_KEY", "ZHIPU_API_KEY"],
    assumed: { text: true },
  },
  { id: "openai-image", label: "OpenAI 图片", mediaIds: ["openai-image"], assumed: { image: true } },
];

/** @type {{ fingerprint: string, expiresAt: number, probes: object[] } | null} */
let probeCache = null;

export function maskKeyPreview(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.length <= 8) return `${raw.slice(0, 2)}***`;
  return `${raw.slice(0, 4)}***${raw.slice(-4)}`;
}

export function extractModelRecords(json) {
  if (!json || typeof json !== "object") return [];
  const buckets = [
    json.data,
    json.items,
    json.models,
    json.registry?.text,
    json.registry?.image,
    json.registry?.video,
  ];
  const rows = [];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const item of bucket) {
      if (typeof item === "string" && item.trim()) {
        rows.push({ id: item.trim() });
        continue;
      }
      if (!item || typeof item !== "object") continue;
      const id = String(item.id ?? item.value ?? item.modelId ?? item.name ?? "").trim();
      if (!id) continue;
      const architecture = item.architecture && typeof item.architecture === "object"
        ? item.architecture
        : {};
      const outputModalities = []
        .concat(architecture.output_modalities || architecture.outputModalities || [])
        .concat(item.output_modalities || item.outputModalities || [])
        .map((entry) => String(entry).toLowerCase())
        .filter(Boolean);
      rows.push({
        id,
        name: String(item.name ?? item.label ?? "").trim() || undefined,
        description: String(item.description ?? "").trim() || undefined,
        outputModalities: outputModalities.length > 0 ? outputModalities : undefined,
      });
    }
  }
  const seen = new Set();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

export function extractCloudRegistryRecords(json) {
  if (!json || typeof json !== "object") return [];
  const rows = [];
  const push = (bucket, output) => {
    if (!Array.isArray(bucket)) return;
    for (const item of bucket) {
      const id = String(item?.value ?? item?.id ?? item?.modelId ?? "").trim();
      if (!id) continue;
      rows.push({
        id,
        name: String(item?.label ?? item?.name ?? "").trim() || undefined,
        outputModalities: output ? [output] : undefined,
      });
    }
  };
  push(json.models || json.registry?.text, "text");
  push(json.registry?.image, "image");
  push(json.registry?.video, "video");
  return extractModelRecords({ data: rows });
}

function credentialFingerprint(secrets) {
  return secrets
    .map((item) => `${item.id}:${String(item.apiKey || "").length}:${maskKeyPreview(item.apiKey)}`)
    .sort()
    .join("|");
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function parseDotEnv(text) {
  const out = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const body = trimmed.startsWith("export ") ? trimmed.slice(7).trim() : trimmed;
    const idx = body.indexOf("=");
    if (idx <= 0) continue;
    const key = body.slice(0, idx).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = body.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function looksLikeEnvPlaceholder(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return true;
  const lower = raw.toLowerCase();
  if (/^your[_-]/i.test(raw)) return true;
  if (lower.includes("replace") && (lower.includes("secret") || lower.includes("key") || lower.includes("token"))) {
    return true;
  }
  if (lower === "changeme" || lower === "todo" || lower === "xxx" || lower === "changemeplease") return true;
  if (/^(sk_|pk_|ark-|Bearer )/i.test(raw) === false && /^[a-z0-9._-]+$/.test(lower) && lower.includes("your")) {
    return true;
  }
  return false;
}

function looksLikeMonorepoRootForEnv(dir) {
  if (!dir) return false;
  try {
    return existsSync(path.join(dir, "runtime-server"))
      && (
        existsSync(path.join(dir, "wodeappx"))
        || existsSync(path.join(dir, ".env"))
        || existsSync(path.join(dir, "runtime-server", ".env"))
        || existsSync(path.join(dir, "server", ".env"))
      );
  } catch {
    return false;
  }
}

export function resolveMonorepoRootForEnvScan(input = {}) {
  if (input.monorepoRoot) return path.resolve(String(input.monorepoRoot));
  const processEnv = input.processEnv || process.env;
  const explicit = String(processEnv.WODEAPP_MONOREPO_ROOT || "").trim();
  if (explicit && looksLikeMonorepoRootForEnv(explicit)) return path.resolve(explicit);

  const here = path.dirname(fileURLToPath(import.meta.url));
  const seeds = [
    ...(Array.isArray(input.seedPaths) ? input.seedPaths : []),
    here,
    process.cwd(),
    path.join(os.homedir(), "Desktop", "wodeapp"),
  ];
  for (const seed of seeds) {
    if (!seed) continue;
    let current = path.resolve(seed);
    for (let depth = 0; depth < 12; depth += 1) {
      if (looksLikeMonorepoRootForEnv(current)) return current;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return "";
}

export async function loadMonorepoEnvSecretMap(input = {}) {
  const map = new Map();
  const origins = new Map();
  const root = resolveMonorepoRootForEnvScan(input);
  if (!root) return { map, origins, root: "" };
  const read = input.readFileImpl || readFile;
  for (const rel of MONOREPO_ENV_RELATIVE_PATHS) {
    try {
      const text = await read(path.join(root, rel), "utf8");
      const parsed = parseDotEnv(text);
      for (const [key, value] of Object.entries(parsed)) {
        if (!value || looksLikeEnvPlaceholder(value)) continue;
        map.set(key, value);
        origins.set(key, "project-env");
      }
    } catch {
      // missing file is normal
    }
  }
  return { map, origins, root };
}

async function loadOpenworkEnvSecretMap(homeDir = os.homedir()) {
  const map = new Map();
  const origins = new Map();
  const raw = await readJsonIfExists(resolveOpenworkEnvStorePath(homeDir));
  const variables = Array.isArray(raw?.variables) ? raw.variables : [];
  for (const item of variables) {
    if (typeof item?.key === "string" && typeof item?.value === "string" && item.value.trim()) {
      if (looksLikeEnvPlaceholder(item.value)) continue;
      map.set(item.key, item.value.trim());
      origins.set(item.key, "desktop-env");
    }
  }
  return { map, origins };
}

export async function loadMergedEnvSecretMap(input = {}) {
  const map = new Map();
  const origins = new Map();
  const skipMonorepo = input.skipMonorepo !== false;
  if (!skipMonorepo) {
    const project = await loadMonorepoEnvSecretMap(input);
    for (const [key, value] of project.map) {
      map.set(key, value);
      origins.set(key, project.origins.get(key) || "project-env");
    }
  }
  const desktop = await loadOpenworkEnvSecretMap(input.homeDir);
  for (const [key, value] of desktop.map) {
    map.set(key, value);
    origins.set(key, desktop.origins.get(key) || "desktop-env");
  }
  return { map, origins, monorepoRoot: "" };
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

async function loadAuthSecrets(userDataDir, accountId) {
  const secrets = new Map();
  try {
    const mod = await loadRuntimeAccountPathsModule();
    if (!mod || !userDataDir) return secrets;
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
    const targets = [...paths, primary].filter((item, index, all) =>
      all.findIndex((other) => other.opencodeAuthPath === item.opencodeAuthPath) === index,
    );
    for (const target of targets) {
      const auth = await readJsonIfExists(target.opencodeAuthPath);
      if (!auth || typeof auth !== "object") continue;
      for (const [providerId, entry] of Object.entries(auth)) {
        const key = typeof entry?.key === "string" ? entry.key.trim() : "";
        if (key) secrets.set(String(providerId).toLowerCase(), key);
      }
    }
  } catch {
    // ignore missing runtime trees
  }
  return secrets;
}

function pickSecret(spec, envMap, authMap, mediaFile, processEnv, origins = new Map()) {
  for (const envKey of spec.envKeys || []) {
    const fromEnvFile = envMap.get(envKey);
    if (fromEnvFile) {
      return { apiKey: fromEnvFile, keyOrigin: origins.get(envKey) || "desktop-env" };
    }
    const fromProcess = String(processEnv?.[envKey] || "").trim();
    if (fromProcess && !looksLikeEnvPlaceholder(fromProcess)) {
      return { apiKey: fromProcess, keyOrigin: "process-env" };
    }
  }
  for (const authId of spec.authIds || []) {
    const key = authMap.get(String(authId).toLowerCase());
    if (key) return { apiKey: key, keyOrigin: "auth" };
  }
  for (const mediaId of spec.mediaIds || []) {
    const values = mediaFile?.providers?.[mediaId];
    const key = String(values?.apiKey || values?.apiToken || values?.accessKey || "").trim();
    if (key) return { apiKey: key, keyOrigin: "media-byok" };
  }
  return { apiKey: "", keyOrigin: "" };
}

function mediaReady(mediaFile, mediaId) {
  const values = mediaFile?.providers?.[mediaId];
  if (!values || typeof values !== "object") return false;
  if (mediaId === "kling") {
    return Boolean(String(values.accessKey || "").trim() && String(values.secretKey || "").trim());
  }
  return Object.values(values).some((value) => String(value || "").trim());
}

function envPairReady(spec, envMap, processEnv) {
  const pair = Array.isArray(spec.envPairKeys) ? spec.envPairKeys : [];
  if (pair.length > 0) {
    return pair.every((key) => {
      const fromMap = String(envMap.get(key) || "").trim();
      const fromProcess = String(processEnv?.[key] || "").trim();
      const value = fromMap || fromProcess;
      return Boolean(value) && !looksLikeEnvPlaceholder(value);
    });
  }
  return false;
}

export async function bootstrapDesktopKeysFromDisk(input = {}) {
  if (!input.homeDir) pinOpenworkEnvStore();
  const { store } = await loadDesktopKeysStore(input.homeDir);
  if (store.migratedAt > 0) return { store, migrated: false };
  const project = input.skipMonorepo === true
    ? { map: new Map() }
    : await loadMonorepoEnvSecretMap(input);
  const mediaFile = input.mediaFile || await loadMediaByokFile();
  return ensureDesktopKeysMigrated({
    homeDir: input.homeDir,
    mediaFile,
    projectEnvMap: project.map,
  });
}

export async function collectProviderSecrets(input = {}) {
  const processEnv = input.processEnv || process.env;
  let envMap = input.envMap;
  let origins = input.envOrigins || new Map();
  if (!envMap) {
    await bootstrapDesktopKeysFromDisk(input);
    const merged = await loadMergedEnvSecretMap({
      ...input,
      skipMonorepo: true,
      homeDir: input.homeDir,
    });
    envMap = merged.map;
    origins = merged.origins;
  }
  const authMap = input.authMap || await loadAuthSecrets(input.userDataDir, input.accountId || "anonymous");
  const mediaFile = input.mediaFile || await loadMediaByokFile();
  const collected = [];

  for (const spec of PROVIDER_PROBE_SPECS) {
    const picked = pickSecret(spec, envMap, authMap, mediaFile, processEnv, origins);
    if (!picked.apiKey) continue;
    collected.push({
      id: spec.id,
      label: spec.label,
      apiKey: picked.apiKey,
      modelsUrl: spec.modelsUrl,
      keyOrigin: picked.keyOrigin,
    });
  }

  for (const spec of MEDIA_ONLY_SPECS) {
    const picked = pickSecret(spec, envMap, authMap, mediaFile, processEnv, origins);
    const fromMedia = (spec.mediaIds || []).some((mediaId) => mediaReady(mediaFile, mediaId));
    const ready = Array.isArray(spec.envPairKeys) && spec.envPairKeys.length > 0
      ? envPairReady(spec, envMap, processEnv) || fromMedia
      : Boolean(picked.apiKey) || fromMedia;
    if (!ready) continue;
    if (spec.id === "openai-image" && collected.some((item) => item.id === "openai")) continue;
    collected.push({
      id: spec.id,
      label: spec.label,
      apiKey: picked.apiKey,
      assumed: spec.assumed,
      keyOrigin: picked.keyOrigin || (ready ? "media-byok" : ""),
    });
  }

  return collected;
}

export async function probeModelsUrl(url, apiKey, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : PROBE_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      json,
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

function publicProbeBase(secret) {
  return {
    id: secret.id,
    label: secret.label,
    keyPreview: maskKeyPreview(secret.apiKey),
    keyOrigin: secret.keyOrigin || "",
  };
}

export async function probeProviderSecret(secret, options = {}) {
  if (secret.assumed && !secret.modelsUrl) {
    return {
      ...publicProbeBase(secret),
      probeStatus: "configured",
      assumed: secret.assumed,
      models: [],
    };
  }
  if (!secret.modelsUrl || !secret.apiKey) {
    return {
      ...publicProbeBase(secret),
      probeStatus: "skipped",
      models: [],
    };
  }
  try {
    const result = await probeModelsUrl(secret.modelsUrl, secret.apiKey, options);
    if (result.status === 401 || result.status === 403) {
      return {
        ...publicProbeBase(secret),
        probeStatus: "unauthorized",
        models: [],
        error: `HTTP ${result.status}`,
      };
    }
    if (!result.ok) {
      return {
        ...publicProbeBase(secret),
        probeStatus: "error",
        models: [],
        error: `HTTP ${result.status}`,
      };
    }
    const models = secret.id === "wodeapp"
      ? extractCloudRegistryRecords(result.json)
      : extractModelRecords(result.json);
    return {
      ...publicProbeBase(secret),
      probeStatus: "ok",
      models,
    };
  } catch (error) {
    return {
      ...publicProbeBase(secret),
      probeStatus: "error",
      models: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function collectCloudSecret(input = {}) {
  const config = input.config || await loadWodeAppConfig();
  const apiKey = typeof config?.apiKey === "string" ? config.apiKey.trim() : "";
  const embedded = Boolean(config?.embedded);
  if (!apiKey || embedded) return null;
  const origin = resolvePlatformOrigin(config);
  if (!origin) return null;
  return {
    id: "wodeapp",
    label: "WodeApp 云端",
    apiKey,
    modelsUrl: `${origin.replace(/\/$/, "")}/runtime-server/api/ai/models`,
  };
}

export async function detectConfiguredProviderCapabilities(input = {}) {
  const secrets = [...await collectProviderSecrets(input)];
  const cloud = await collectCloudSecret(input);
  if (cloud) secrets.push(cloud);
  const fingerprint = credentialFingerprint(secrets);
  const now = Date.now();
  if (!input.force && probeCache && probeCache.fingerprint === fingerprint && probeCache.expiresAt > now) {
    return { ok: true, cached: true, probes: probeCache.probes };
  }
  const probes = await Promise.all(secrets.map((secret) => probeProviderSecret(secret, input)));
  probeCache = {
    fingerprint,
    expiresAt: now + CACHE_TTL_MS,
    probes,
  };
  return { ok: true, cached: false, probes };
}

export function clearProviderCapabilityProbeCache() {
  probeCache = null;
}

export async function warmupConfiguredProviderCapabilities(input = {}) {
  try {
    const result = await detectConfiguredProviderCapabilities(input);
    const ids = (result.probes || []).map((item) => `${item.id}:${item.probeStatus}`).join(",");
    console.log(`[wodeapp] capability warmup${result.cached ? " (cached)" : ""}: ${ids || "none"}`);
    return result;
  } catch (error) {
    console.warn("[wodeapp] capability warmup failed:", error instanceof Error ? error.message : String(error));
    return { ok: false, probes: [], error: error instanceof Error ? error.message : String(error) };
  }
}
