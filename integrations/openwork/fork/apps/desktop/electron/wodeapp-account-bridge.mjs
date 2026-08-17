import { chmod, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { WODEAPP_CREDENTIAL_SLOTS, wodeAppDataDir } from "./wodeapp-secure-credentials.mjs";

export const WODEAPP_ACCOUNT_IPC_CHANNEL = "wodeapp:account";
export const WODEAPP_QUICK_ORIGIN_AI = "https://wodeapp.ai";
export const WODEAPP_QUICK_ORIGIN_CN = "https://wodeapp.cn";
export const WODEAPP_QUICK_ORIGIN = WODEAPP_QUICK_ORIGIN_AI;

const ACCOUNT_FILE = "account.json";
const SERVICE_FILE = "service.json";
const LEGACY_CONFIG_FILE = "config.json";
const BRAND_AGENTS_FILE = "brand-agents.json";
const PLAZA_CATALOG_FILE = path.join("plaza", "catalog.json");
const FETCH_TIMEOUT_MS = 12_000;

function dataDir() {
  return wodeAppDataDir();
}

export function wodeAppQuickAccountPath() {
  return path.join(dataDir(), ACCOUNT_FILE);
}

function serviceConfigPath() {
  return path.join(dataDir(), SERVICE_FILE);
}

function legacyConfigPath() {
  return path.join(dataDir(), LEGACY_CONFIG_FILE);
}

function brandAgentsPath() {
  return path.join(dataDir(), BRAND_AGENTS_FILE);
}

function plazaCatalogPath() {
  return path.join(dataDir(), PLAZA_CATALOG_FILE);
}

async function readJson(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function writePrivateJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(filePath, 0o600);
}

async function removeFile(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function asText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function normalizeWodeAppQuickOrigin(value) {
  const candidate = asText(value) || WODEAPP_QUICK_ORIGIN;
  try {
    const parsed = new URL(candidate);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "wodeapp.ai") return WODEAPP_QUICK_ORIGIN_AI;
    if (host === "wodeapp.cn") return WODEAPP_QUICK_ORIGIN_CN;
  } catch {
    // Quick mode deliberately has no arbitrary-origin fallback.
  }
  return WODEAPP_QUICK_ORIGIN;
}

export function normalizeWodeAppLoginTarget(method, value) {
  const target = asText(value) || "";
  return method === "email"
    ? target.toLowerCase()
    : target.replace(/[\s-]/g, "").replace(/^\+?86/, "");
}

function normalizeProjects(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const id = asText(item.id);
    const launchUrl = asText(item.launchUrl) || asText(item.url);
    if (!id || !launchUrl) return [];
    return [{
      id,
      kind: asText(item.kind) || "image",
      title: asText(item.title) || asText(item.name) || id,
      projectId: asText(item.projectId) || "",
      name: asText(item.name) || asText(item.title) || id,
      slug: asText(item.slug) || "",
      subdomain: asText(item.subdomain) || asText(item.slug) || "",
      url: launchUrl,
      launchUrl,
      createdAt: asText(item.createdAt),
      updatedAt: asText(item.updatedAt),
    }];
  });
}

export function sanitizeWodeAppQuickAccount(input) {
  if (!input || typeof input !== "object") return null;
  const hasAccountShape = Number(input.version) >= 2
    || Boolean(asText(input.apiKey))
    || Boolean(input.user && typeof input.user === "object")
    || Array.isArray(input.modelIds)
    || Array.isArray(input.abilityProjects);
  if (!hasAccountShape) return null;
  return {
    version: 2,
    origin: normalizeWodeAppQuickOrigin(input.origin),
    user: input.user && typeof input.user === "object"
      ? { id: asText(input.user.id), name: asText(input.user.name) || null }
      : null,
    modelIds: Array.isArray(input.modelIds)
      ? [...new Set(input.modelIds.map(asText).filter(Boolean))]
      : [],
    abilityProjects: normalizeProjects(input.abilityProjects),
    updatedAt: asText(input.updatedAt) || new Date().toISOString(),
  };
}

export async function migrateWodeAppLegacyCredential({ credentialStore, filePath, input, metadata, slot }) {
  const legacyCredential = asText(input?.apiKey);
  if (!legacyCredential) return;
  await credentialStore.set(slot, legacyCredential);
  const verified = await credentialStore.get(slot);
  if (verified !== legacyCredential) {
    throw new Error("WodeApp 凭证迁移校验失败，旧凭证文件未修改");
  }
  await writePrivateJson(filePath, metadata);
}

async function loadQuickAccount(credentialStore) {
  const filePath = wodeAppQuickAccountPath();
  const input = await readJson(filePath);
  const metadata = sanitizeWodeAppQuickAccount(input);
  if (!metadata) return null;
  await migrateWodeAppLegacyCredential({
    credentialStore,
    filePath,
    input,
    metadata,
    slot: WODEAPP_CREDENTIAL_SLOTS.quickAccount,
  });
  const apiKey = await credentialStore.get(WODEAPP_CREDENTIAL_SLOTS.quickAccount);
  return apiKey ? { ...metadata, apiKey } : null;
}

function normalizeServiceOrigin(value) {
  const raw = asText(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const loopback = parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost";
    if (parsed.protocol !== "https:" && !(loopback && parsed.protocol === "http:")) return null;
    if (parsed.username || parsed.password) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function sanitizeServiceConfig(input) {
  if (!input || typeof input !== "object") return null;
  const origin = normalizeServiceOrigin(input.origin);
  if (!origin) return null;
  return {
    version: 2,
    profile: input.profile === "local-only" ? "local-only" : "selfhost",
    origin,
    updatedAt: asText(input.updatedAt) || new Date().toISOString(),
  };
}

async function loadServiceConfig(credentialStore) {
  const filePath = serviceConfigPath();
  const input = await readJson(serviceConfigPath());
  const metadata = sanitizeServiceConfig(input);
  if (!metadata) return null;
  await migrateWodeAppLegacyCredential({
    credentialStore,
    filePath,
    input,
    metadata,
    slot: WODEAPP_CREDENTIAL_SLOTS.service,
  });
  const apiKey = await credentialStore.get(WODEAPP_CREDENTIAL_SLOTS.service);
  return { ...metadata, apiKey: apiKey || undefined };
}

function sanitizeLegacyConfig(input) {
  if (!input || typeof input !== "object") return null;
  const origin = normalizeServiceOrigin(input.issuedOrigin) || normalizeServiceOrigin(input.origin);
  if (!origin) return null;
  return {
    version: 2,
    origin,
    issuedOrigin: origin,
    user: input.user && typeof input.user === "object"
      ? { id: asText(input.user.id), name: asText(input.user.name) || null }
      : null,
    updatedAt: asText(input.updatedAt) || new Date().toISOString(),
  };
}

async function loadLegacyConfig(credentialStore) {
  const filePath = legacyConfigPath();
  const input = await readJson(filePath);
  const metadata = sanitizeLegacyConfig(input);
  if (!metadata) return null;
  await migrateWodeAppLegacyCredential({
    credentialStore,
    filePath,
    input,
    metadata,
    slot: WODEAPP_CREDENTIAL_SLOTS.legacyConfig,
  });
  const apiKey = await credentialStore.get(WODEAPP_CREDENTIAL_SLOTS.legacyConfig);
  return { ...metadata, apiKey: apiKey || undefined };
}

async function loadActiveCredentials(credentialStore) {
  const quick = await loadQuickAccount(credentialStore);
  if (quick) return { origin: quick.origin, apiKey: quick.apiKey };
  const local = await loadServiceConfig(credentialStore);
  if (local?.apiKey) return { origin: local.origin, apiKey: local.apiKey };
  const legacy = await loadLegacyConfig(credentialStore);
  if (legacy?.apiKey) return { origin: legacy.origin, apiKey: legacy.apiKey };
  return null;
}

let managedRuntimeEnvironment = false;
const explicitRuntimeEnvironment = {
  apiKey: asText(process.env.WODEAPP_API_KEY),
  origin: asText(process.env.WODEAPP_ORIGIN),
};

async function syncManagedRuntimeEnvironment(credentialStore) {
  if (explicitRuntimeEnvironment.apiKey && explicitRuntimeEnvironment.origin && !managedRuntimeEnvironment) {
    return;
  }
  const credentials = await loadActiveCredentials(credentialStore);
  if (credentials) {
    process.env.WODEAPP_API_KEY = credentials.apiKey;
    process.env.WODEAPP_ORIGIN = credentials.origin;
    managedRuntimeEnvironment = true;
    return;
  }
  if (managedRuntimeEnvironment) {
    delete process.env.WODEAPP_API_KEY;
    delete process.env.WODEAPP_ORIGIN;
    delete process.env.WODEAPP_USER_ID;
    managedRuntimeEnvironment = false;
  }
}

export async function initializeWodeAppAccountSecurity({ credentialStore }) {
  // Loading each source performs a verified one-time migration before the
  // plaintext field is removed. A failed migration leaves the old file intact.
  const quick = await loadQuickAccount(credentialStore);
  await loadServiceConfig(credentialStore);
  await loadLegacyConfig(credentialStore);
  if (quick?.user?.id) process.env.WODEAPP_USER_ID = quick.user.id;
  await syncManagedRuntimeEnvironment(credentialStore);
  return { ok: true, storage: credentialStore.status() };
}

async function readResponsePayload(response) {
  const text = (await response.text().catch(() => "")).slice(0, 512 * 1024);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return { error: text.slice(0, 500) };
  }
}

async function sessionFetch(ses, url, init = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await ses.fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function preferredModel(modelIds) {
  const preferred = "wode/deepseek-v4-flash";
  return modelIds.includes(preferred) ? preferred : modelIds[0] || preferred;
}

function signedInResponse(account) {
  return {
    ok: true,
    signedIn: true,
    config: {
      origin: account.origin,
      user: account.user,
      embedded: false,
      providerId: "wodeapp",
      defaultModelId: preferredModel(account.modelIds),
      modelIds: account.modelIds,
      abilityProjects: account.abilityProjects,
      abilityProjectsSyncError: null,
    },
  };
}

async function toolsHealth(ses, credentialStore) {
  const credentials = await loadActiveCredentials(credentialStore);
  if (!credentials) return { ok: false, signedIn: false, status: "not_configured", toolCount: 0 };
  const endpoint = `${credentials.origin}/mainserver/mcp`;
  try {
    const response = await sessionFetch(ses, endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        Authorization: `Bearer ${credentials.apiKey}`,
        "X-API-Key": credentials.apiKey,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    }, 5_000);
    const raw = await response.text();
    const dataLine = raw.includes("data:")
      ? raw.split("\n").filter((line) => line.startsWith("data:")).pop()?.slice(5).trim()
      : raw;
    const parsed = JSON.parse(dataLine || raw || "{}");
    const tools = parsed?.result?.tools;
    return Array.isArray(tools)
      ? { ok: true, signedIn: true, status: "ready", endpoint, httpStatus: response.status, toolCount: tools.length }
      : { ok: false, signedIn: true, status: "invalid_response", endpoint, httpStatus: response.status, toolCount: 0 };
  } catch (error) {
    return { ok: false, signedIn: true, status: "unreachable", endpoint, toolCount: 0, error: error instanceof Error ? error.message : "连接失败" };
  }
}

function summarizeService(config) {
  if (!config) return null;
  const key = config.apiKey || "";
  return {
    profile: config.profile,
    origin: config.origin,
    issuedOrigin: config.origin,
    hasApiKey: Boolean(key),
    apiKeyPreview: key ? (key.length > 12 ? `${key.slice(0, 8)}…${key.slice(-4)}` : `${key.slice(0, 4)}…`) : null,
    embedded: false,
    user: null,
  };
}

async function probeOrigin(ses, value) {
  const origin = normalizeServiceOrigin(value);
  if (!origin) return { ok: false, origin: asText(value) || "", error: "仅支持 HTTPS，或本机 localhost/127.0.0.1 HTTP" };
  try {
    const response = await sessionFetch(ses, `${origin}/mainserver/api/health`, { headers: { Accept: "application/json" } }, 3_000);
    return { ok: response.ok, origin, status: response.status, error: response.ok ? null : `health ${response.status}` };
  } catch (error) {
    return { ok: false, origin, error: error instanceof Error ? error.message : "连接失败" };
  }
}

async function readBrandAgents() {
  const stored = await readJson(brandAgentsPath());
  return { ok: true, version: 1, agents: Array.isArray(stored?.agents) ? stored.agents : [] };
}

async function saveBrandAgents(input) {
  const agents = Array.isArray(input?.agents) ? input.agents.filter((item) => item && typeof item === "object") : [];
  await writePrivateJson(brandAgentsPath(), { version: 1, agents });
  return { ok: true, version: 1, agents };
}

function plazaItemsFrom(input) {
  if (Array.isArray(input)) return input.filter((item) => item && typeof item === "object");
  if (Array.isArray(input?.items)) return input.items.filter((item) => item && typeof item === "object");
  return [];
}

async function readPlazaCatalog() {
  const stored = await readJson(plazaCatalogPath());
  if (!stored) return { ok: true, exists: false, version: 1, items: [] };
  return { ok: true, exists: true, version: 1, items: plazaItemsFrom(stored) };
}

async function savePlazaCatalog(input) {
  const items = plazaItemsFrom(input);
  await writePrivateJson(plazaCatalogPath(), { version: 1, items });
  return { ok: true, exists: true, version: 1, items };
}

function credentialFailure(error) {
  const message = error instanceof Error ? error.message : "WodeApp 凭证操作失败";
  return { ok: false, error: message };
}

export function registerWodeAppAccountIpc({ ipcMain, credentialStore, onCredentialsChanged }) {
  ipcMain.handle(WODEAPP_ACCOUNT_IPC_CHANNEL, async (event, action, payload = {}) => {
    try {
      switch (action) {
        case "load":
        case "loadCached":
        case "refreshAccount": {
          const account = await loadQuickAccount(credentialStore);
          return account ? signedInResponse(account) : { ok: true, signedIn: false, config: null };
        }
        case "sendCode":
        case "loginWithCode":
          return { ok: false, error: "请在浏览器中登录 WodeApp" };
        case "signOut":
          await credentialStore.remove(WODEAPP_CREDENTIAL_SLOTS.quickAccount);
          await removeFile(wodeAppQuickAccountPath());
          delete process.env.WODEAPP_USER_ID;
          await syncManagedRuntimeEnvironment(credentialStore);
          await onCredentialsChanged?.({ reason: "sign-out" });
          return { ok: true, signedIn: false, remoteRevoked: false };
        case "credentials": {
          const credentials = await loadActiveCredentials(credentialStore);
          return credentials
            ? { ok: true, signedIn: true, ...credentials }
            : { ok: false, signedIn: false, error: "尚未配置模型服务" };
        }
        case "applyProvider": {
          await syncManagedRuntimeEnvironment(credentialStore);
          const credentials = await loadActiveCredentials(credentialStore);
          if (!credentials) return { ok: false, error: "尚未配置模型服务" };
          await onCredentialsChanged?.({ reason: "apply-provider" });
          return { ok: true, providerId: "wodeapp" };
        }
        case "toolsHealth":
          return toolsHealth(event.sender.session, credentialStore);
        case "syncAbilityProjects": {
          const account = await loadQuickAccount(credentialStore);
          return account
            ? { ok: account.abilityProjects.length > 0, projects: account.abilityProjects, error: account.abilityProjects.length ? null : "暂无平台项目" }
            : { ok: false, projects: [], error: "请先登录快捷模式" };
        }
        case "getServiceConfig":
          return { ok: true, config: summarizeService(await loadServiceConfig(credentialStore)) };
        case "probeOrigin":
          return probeOrigin(event.sender.session, payload?.origin);
        case "saveServiceConfig": {
          if (payload?.clearApiKey) {
            await credentialStore.remove(WODEAPP_CREDENTIAL_SLOTS.service);
            await removeFile(serviceConfigPath());
            await syncManagedRuntimeEnvironment(credentialStore);
            await onCredentialsChanged?.({ reason: "clear-service" });
            return { ok: true, config: null, signedIn: false };
          }
          const origin = normalizeServiceOrigin(payload?.origin);
          if (!origin) return { ok: false, error: "服务地址不安全或格式无效" };
          const current = await loadServiceConfig(credentialStore);
          const apiKey = asText(payload?.apiKey) || current?.apiKey;
          if (apiKey) await credentialStore.set(WODEAPP_CREDENTIAL_SLOTS.service, apiKey);
          const config = {
            version: 2,
            profile: payload?.profile === "local-only" ? "local-only" : "selfhost",
            origin,
            updatedAt: new Date().toISOString(),
          };
          await writePrivateJson(serviceConfigPath(), config);
          await syncManagedRuntimeEnvironment(credentialStore);
          await onCredentialsChanged?.({ reason: "save-service" });
          return { ok: true, config: summarizeService({ ...config, apiKey }), signedIn: Boolean(apiKey) };
        }
        case "listBrandAgents":
          return readBrandAgents();
        case "saveBrandAgents":
          return saveBrandAgents(payload);
        case "listPlazaCatalog":
          return readPlazaCatalog();
        case "savePlazaCatalog":
          return savePlazaCatalog(payload);
        default:
          return { ok: false, error: `Unsupported WodeApp account action: ${String(action)}` };
      }
    } catch (error) {
      return credentialFailure(error);
    }
  });
}
