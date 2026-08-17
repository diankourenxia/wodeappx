import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  aiProxyBaseUrl,
  loadWodeAppConfig,
  normalizeWodeAppCloudConfig,
  resolvePlatformOrigin,
} from "./config-store.mjs";
import {
  WODE_BRANDED_MODELS,
  buildWodeApiModelMap,
  getWodeBrandedById,
} from "./wodeBrandedModels.js";

const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../package.json"));
const { applyEdits, modify, parse } = require("jsonc-parser");

export const WODEAPP_PROVIDER_ID = "wodeapp";
const LEGACY_WODE_PROVIDER_ID = "wode";
const LEGACY_LOCAL_MCP_ID = "wodeapp";

/** OpenCode substitutes this from child env (loaded from ~/.wodeapp). Never embed sk_live_ here. */
export const WODEAPP_API_KEY_ENV_PLACEHOLDER = "{env:WODEAPP_API_KEY}";

/** Wode API id → OpenCode model key（由 wodeBrandedModels.ts 派生，勿手写） */
export const WODE_API_MODEL_MAP = buildWodeApiModelMap();

function opencodeModalities(capabilities = []) {
  const input = ["text"];
  if (capabilities.includes("vision")) input.push("image");
  return { input, output: ["text"] };
}

function opencodeAcceptsAttachments(capabilities = []) {
  return capabilities.includes("vision");
}

const WODEAPP_MANAGED_OUTPUT_LIMIT = 65_536;

function opencodeModelLimit(contextWindow) {
  const context = Number(contextWindow);
  if (!Number.isFinite(context) || context <= 0) return null;
  return {
    context,
    input: context,
    output: WODEAPP_MANAGED_OUTPUT_LIMIT,
  };
}

function withOpencodeModelLimit(model, contextWindow) {
  const limit = opencodeModelLimit(contextWindow);
  return limit ? { ...model, limit } : model;
}

/** OpenCode 静态兜底：key = Wode API id，name = Wode 展示名 */
export const WODEAPP_DEFAULT_MODELS = Object.fromEntries(
  WODE_BRANDED_MODELS.map((model) => [model.id, withOpencodeModelLimit({
    name: model.label,
    modalities: opencodeModalities(model.capabilities),
    attachment: opencodeAcceptsAttachments(model.capabilities),
  }, model.contextWindow)]),
);

const WODEAPP_LOW_PRIORITY_MODEL_KEYS = new Set(
  WODE_BRANDED_MODELS
    .filter((model) => model.region === "international")
    .flatMap((model) => [
      model.id,
      model.upstreamId,
      ...model.shortNames,
    ]),
);

/** OpenCode model key = Wode API id，调用统一走 /mainserver/api/ai/v1 中转 */
export const WODEAPP_PREFERRED_OPENCODE_MODEL_KEY = "wode/deepseek-v4-flash";

/** opencode 默认模型 id = provider/model */
export const WODEAPP_DEFAULT_MODEL_ID = `${WODEAPP_PROVIDER_ID}/${WODEAPP_PREFERRED_OPENCODE_MODEL_KEY}`;

const LEGACY_WODE_MODEL_IDS = new Set([
  "wode/kimi-code-k3-256k",
  "wodeapp/wode/kimi-code-k3-256k",
  "wode/wode-opus-4.8",
  "wode/wode-gpt-5.5",
  "wode/wode-sonnet-4.6",
  "wode/wode-gemini-flash",
  "wodeapp/wode-gemini-flash",
  "wodeapp/wode-opus-4.8",
  "wodeapp/wode-gpt-5.5",
  "wodeapp/wode-sonnet-4.6",
  "wodeapp/wode/gemini-flash",
  "wodeapp/wode/opus-4.8",
  "wodeapp/wode/gpt-5.5",
  "wodeapp/wode-gemini-flash",
  // Kimi Code K3 256K was the previous WodeAppX default; migrate to V4 Flash.
  "wode/kimi-k3",
  "wodeapp/wode/kimi-k3",
  "wode-kimi-k3",
]);

const FORMAT = { insertSpaces: true, tabSize: 2, eol: "\n" };

function emptyConfig() {
  return '{\n  "$schema": "https://opencode.ai/config.json"\n}\n';
}

function apiIdToOpencodeEntry(apiId, options = {}) {
  const trimmed = String(apiId ?? "").trim();
  const resolved = resolveKnownWodeApiId(trimmed);
  const branded = getWodeBrandedById(resolved);
  if (branded?.id) {
    return {
      key: branded.id,
      name: options.name || branded.label,
      capabilities: branded.capabilities || ["chat"],
      contextWindow: branded.contextWindow,
    };
  }
  const mapped = WODE_API_MODEL_MAP[resolved];
  if (mapped) {
    const mappedBranded = getWodeBrandedById(mapped.key);
    return {
      key: mapped.key,
      name: options.name || mapped.name,
      capabilities: mappedBranded?.capabilities || ["chat"],
      contextWindow: mappedBranded?.contextWindow,
    };
  }
  if (resolved.startsWith("wode/")) {
    const byBrand = getWodeBrandedById(resolved);
    if (byBrand?.id) {
      return {
        key: byBrand.id,
        name: options.name || byBrand.label,
        capabilities: byBrand.capabilities || ["chat"],
        contextWindow: byBrand.contextWindow,
      };
    }
    return { key: resolved, name: options.name || resolved, capabilities: ["chat"] };
  }
  if (resolved.startsWith("wode-")) {
    return { key: resolved, name: options.name || resolved, capabilities: ["chat"] };
  }
  return { key: resolved, name: options.name || resolved, capabilities: ["chat"] };
}

const LEGACY_FOREIGN_MODEL_KEYS = new Set([
  "wode-gemini-flash",
  "wode-gemini",
  "wode-gpt-5.5",
  "wode-gpt-5.2",
  "wode-gpt",
  "wode-opus-4.8",
  "wode-opus-4.6",
  "wode-opus",
  "wode-sonnet-4.6",
  "wode-sonnet",
]);

function shouldResetDefaultModel(currentModel, providerModels) {
  if (!currentModel) return false;
  if (LEGACY_WODE_MODEL_IDS.has(currentModel)) return true;
  if (currentModel.startsWith(`${LEGACY_WODE_PROVIDER_ID}/`)) return true;
  if (!currentModel.startsWith(`${WODEAPP_PROVIDER_ID}/`)) return false;
  const modelKey = currentModel.slice(`${WODEAPP_PROVIDER_ID}/`.length);
  if (!(modelKey in (providerModels ?? {}))) return true;
  const preferredKey = WODEAPP_PREFERRED_OPENCODE_MODEL_KEY;
  if (modelKey === preferredKey) return !(modelKey in providerModels);
  if (WODEAPP_LOW_PRIORITY_MODEL_KEYS.has(modelKey) && preferredKey in providerModels) return true;
  if (LEGACY_FOREIGN_MODEL_KEYS.has(modelKey) && preferredKey in providerModels) return true;
  return false;
}

function normalizeApiModelIds(apiIds) {
  const ids = [...new Set(apiIds.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (ids.length > 0) return ids;
  return Object.keys(WODE_API_MODEL_MAP);
}

function resolveKnownWodeApiId(apiId) {
  const trimmed = String(apiId ?? "").trim();
  if (!trimmed) return "";
  const branded = getWodeBrandedById(trimmed);
  if (branded?.id) return branded.id;
  const upstreamMatch = WODE_BRANDED_MODELS.find((model) => model.upstreamId === trimmed);
  return upstreamMatch?.id ?? trimmed;
}

function opencodeKeyForBranded(model) {
  return model?.id || "";
}

function chooseDefaultModelKey(providerModels) {
  const keys = Object.keys(providerModels ?? {});
  const preferredKeys = [
    WODEAPP_PREFERRED_OPENCODE_MODEL_KEY,
    ...WODE_BRANDED_MODELS.map(opencodeKeyForBranded),
    ...WODE_BRANDED_MODELS.map((model) => model.id),
  ];
  for (const key of preferredKeys) {
    if (key && keys.includes(key)) return key;
  }
  return keys[0] || WODEAPP_PREFERRED_OPENCODE_MODEL_KEY;
}

function chooseDefaultModelId(providerModels) {
  return `${WODEAPP_PROVIDER_ID}/${chooseDefaultModelKey(providerModels)}`;
}

function normalizePreferredApiModelIds(apiIds, options = {}) {
  const ids = normalizeApiModelIds(apiIds);
  if (options.authoritative) {
    return ids.map((id) => String(id ?? "").trim()).filter(Boolean);
  }
  const merged = [];
  const push = (id) => {
    const resolved = resolveKnownWodeApiId(id);
    if (resolved && !merged.includes(resolved)) {
      merged.push(resolved);
    }
  };

  for (const model of WODE_BRANDED_MODELS) {
    push(model.id);
  }
  for (const id of ids) {
    push(id);
  }
  return merged;
}

function fallbackApiModelIds() {
  return Object.keys(WODE_API_MODEL_MAP);
}

export function modelsFromApiIds(apiIds, options = {}) {
  const models = {};
  for (const apiId of normalizePreferredApiModelIds(apiIds, options)) {
    const entry = apiIdToOpencodeEntry(apiId, { name: options.names?.[apiId] });
    if (!entry.key) continue;
    models[entry.key] = withOpencodeModelLimit({
      name: entry.name,
      modalities: opencodeModalities(entry.capabilities),
      attachment: opencodeAcceptsAttachments(entry.capabilities),
    }, entry.contextWindow);
  }
  if (Object.keys(models).length > 0) return models;
  return { ...WODEAPP_DEFAULT_MODELS };
}

async function resolveProviderModels(config) {
  const result = await fetchWodeAppApiModelIds(config);
  return modelsFromApiIds(result.ids, { authoritative: result.authoritative, names: result.names });
}

async function buildProviderBlock(config) {
  const normalized = normalizeWodeAppCloudConfig(config || {});
  const signedIn = Boolean(normalized.apiKey?.trim());
  const options = { baseURL: aiProxyBaseUrl(normalized) };
  if (signedIn) {
    // Real key lives in ~/.wodeapp (+ process env). Sidecar resolves via ConfigVariable.
    options.apiKey = WODEAPP_API_KEY_ENV_PLACEHOLDER;
    options.headers = { "X-API-Key": WODEAPP_API_KEY_ENV_PLACEHOLDER };
  }
  return {
    npm: "@ai-sdk/openai-compatible",
    name: "WodeApp",
    options,
    // Always pass normalized (never raw null) — logout clears ~/.wodeapp first,
    // then syncs provider with a null config; raw null used to throw Invalid WodeApp config.
    models: await resolveProviderModels(normalized),
  };
}

export const WODEAPP_PLATFORM_MCP_ID = "wodeapp-platform";
export const WODEAPP_SHOPIFY_ADMIN_MCP_ID = "wodeapp-shopify-admin";
const PLATFORM_MCP_HEALTH_TIMEOUT_MS = 5000;
export const WODEAPP_PLATFORM_MCP_REQUEST_TIMEOUT_MS = 420_000;
export const WODEAPP_SHOPIFY_ADMIN_MCP_REQUEST_TIMEOUT_MS = 120_000;
export const WODEAPP_MANAGED_MCP_CONNECTOR_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: WODEAPP_PLATFORM_MCP_ID,
    path: "/mainserver/mcp",
    timeout: WODEAPP_PLATFORM_MCP_REQUEST_TIMEOUT_MS,
  }),
  Object.freeze({
    id: WODEAPP_SHOPIFY_ADMIN_MCP_ID,
    path: "/mainserver/api/shopify/mcp",
    timeout: WODEAPP_SHOPIFY_ADMIN_MCP_REQUEST_TIMEOUT_MS,
  }),
]);
const PLATFORM_API_TIMEOUT_MS = 8000;
const CREDITS_RETRY_DELAY_MS = 300;

function requestTimeoutSignal(timeoutMs = PLATFORM_API_TIMEOUT_MS) {
  return timeoutMs > 0 && typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
}

function waitForRetry(delayMs) {
  if (!(delayMs > 0)) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function requestJsonDirect(url, options = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const requestImpl = target.protocol === "http:" ? httpRequest : httpsRequest;
    const request = requestImpl(target, {
      method: options.method || "GET",
      headers: options.headers || {},
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => {
        const status = response.statusCode || 0;
        const text = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        resolve({ ok: status >= 200 && status < 300, status, json, text });
      });
    });
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : PLATFORM_API_TIMEOUT_MS;
    const timeout = setTimeout(() => request.destroy(new Error("WodeApp request timed out")), timeoutMs);
    request.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    request.on("close", () => clearTimeout(timeout));
    if (typeof options.body === "string" && options.body) request.write(options.body);
    request.end();
  });
}

const NODE_REQUEST_WORKER = fileURLToPath(new URL("./wodeapp-node-request.mjs", import.meta.url));

function resolveNodeRequestWorkerScript() {
  const script = NODE_REQUEST_WORKER;
  const marker = `${path.sep}app.asar${path.sep}`;
  if (script.includes(marker)) {
    const unpacked = script.replace(marker, `${path.sep}app.asar.unpacked${path.sep}`);
    if (existsSync(unpacked)) return unpacked;
  }
  return script;
}

function requestJsonInNodeChild(url, options = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : PLATFORM_API_TIMEOUT_MS;
    const child = spawn(process.execPath, [resolveNodeRequestWorkerScript()], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        WODEAPP_NODE_REQUEST_WORKER: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    const timeout = setTimeout(() => child.kill(), timeoutMs + 1000);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", () => {
      clearTimeout(timeout);
      try {
        const result = JSON.parse(Buffer.concat(stdout).toString("utf8") || "null");
        if (!result || result.workerError) {
          throw new Error(result?.workerError || Buffer.concat(stderr).toString("utf8") || "Node request worker failed");
        }
        resolve(result);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify({ url, options }));
  });
}

async function requestJsonWithNode(url, options = {}) {
  if (process.versions?.electron && process.env.WODEAPP_NODE_REQUEST_WORKER !== "1") {
    return requestJsonInNodeChild(url, options);
  }
  return requestJsonDirect(url, options);
}

function platformMcpUrl(config) {
  return `${resolvePlatformOrigin(config)}/mainserver/mcp`;
}

function shopifyAdminMcpUrl(config) {
  return `${resolvePlatformOrigin(config)}/mainserver/api/shopify/mcp`;
}

function managedMcpUrl(config, definition) {
  const explicitUrl = typeof definition?.url === "string" ? definition.url.trim() : "";
  if (explicitUrl) return explicitUrl;
  const pathValue = typeof definition?.path === "string" ? definition.path.trim() : "";
  if (!pathValue.startsWith("/")) {
    throw new Error(`Managed MCP connector ${definition?.id || "(unknown)"} requires an absolute path or URL`);
  }
  return `${resolvePlatformOrigin(config)}${pathValue}`;
}

function buildAuthenticatedMcpBlock(config, url, timeout) {
  const normalized = normalizeWodeAppCloudConfig(config || {});
  if (!normalized.apiKey?.trim()) return null;
  return {
    type: "remote",
    url,
    enabled: true,
    timeout,
    oauth: false,
    headers: {
      "X-API-Key": WODEAPP_API_KEY_ENV_PLACEHOLDER,
      Authorization: `Bearer ${WODEAPP_API_KEY_ENV_PLACEHOLDER}`,
    },
  };
}

export function buildPlatformMcpBlock(config) {
  const normalized = normalizeWodeAppCloudConfig(config || {});
  return buildAuthenticatedMcpBlock(
    normalized,
    platformMcpUrl(normalized),
    WODEAPP_PLATFORM_MCP_REQUEST_TIMEOUT_MS,
  );
}

export function buildShopifyAdminMcpBlock(config) {
  const normalized = normalizeWodeAppCloudConfig(config || {});
  return buildAuthenticatedMcpBlock(
    normalized,
    shopifyAdminMcpUrl(normalized),
    WODEAPP_SHOPIFY_ADMIN_MCP_REQUEST_TIMEOUT_MS,
  );
}

export function buildManagedMcpBlocks(
  config,
  definitions = WODEAPP_MANAGED_MCP_CONNECTOR_DEFINITIONS,
) {
  const normalized = normalizeWodeAppCloudConfig(config || {});
  if (!normalized.apiKey?.trim()) return {};
  return Object.fromEntries(definitions.flatMap((definition) => {
    const id = typeof definition?.id === "string" ? definition.id.trim() : "";
    if (!id || definition?.enabled === false) return [];
    const block = buildAuthenticatedMcpBlock(
      normalized,
      managedMcpUrl(normalized, definition),
      Number(definition.timeout) > 0 ? Number(definition.timeout) : WODEAPP_PLATFORM_MCP_REQUEST_TIMEOUT_MS,
    );
    return block ? [[id, block]] : [];
  }));
}

function safeRemoveProperty(content, pathSegments) {
  const parsed = parse(content, [], { allowTrailingComma: true });
  let cursor = parsed;
  for (const segment of pathSegments) {
    if (!cursor || typeof cursor !== "object" || !(segment in cursor)) {
      return content;
    }
    cursor = cursor[segment];
  }
  const edits = modify(content, pathSegments, undefined, { formattingOptions: FORMAT });
  return applyEdits(content, edits);
}

function safeRemoveEmptyObjectProperty(content, pathSegments) {
  const parsed = parse(content, [], { allowTrailingComma: true });
  let cursor = parsed;
  for (const segment of pathSegments) {
    if (!cursor || typeof cursor !== "object" || !(segment in cursor)) {
      return content;
    }
    cursor = cursor[segment];
  }
  if (!cursor || typeof cursor !== "object" || Array.isArray(cursor) || Object.keys(cursor).length > 0) {
    return content;
  }
  const edits = modify(content, pathSegments, undefined, { formattingOptions: FORMAT });
  return applyEdits(content, edits);
}

function normalizeConfigDocument(content) {
  const parseErrors = [];
  const parsed = parse(content?.trim() ? content : "{}", parseErrors, { allowTrailingComma: true });
  if (parseErrors.length > 0 || !parsed || typeof parsed !== "object") {
    return null;
  }
  return parsed;
}

function configsEqual(left, right) {
  if (!left || !right) return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

export function applyWodeAppProviderEdits(
  raw,
  providerBlock,
  managedMcpBlocks = {},
  managedDefinitions = WODEAPP_MANAGED_MCP_CONNECTOR_DEFINITIONS,
) {
  let updated = raw.trim() ? raw : emptyConfig();
  const parseErrors = [];
  parse(updated, parseErrors, { allowTrailingComma: true });
  if (parseErrors.length > 0) {
    updated = emptyConfig();
  }

  updated = safeRemoveProperty(updated, ["provider", LEGACY_WODE_PROVIDER_ID]);
  updated = safeRemoveProperty(updated, ["mcp", LEGACY_LOCAL_MCP_ID]);
  for (const definition of managedDefinitions) {
    const id = typeof definition?.id === "string" ? definition.id.trim() : "";
    if (id && !managedMcpBlocks[id]) {
      updated = safeRemoveProperty(updated, ["mcp", id]);
    }
  }

  const parsed = parse(updated, [], { allowTrailingComma: true });
  const currentModel = typeof parsed?.model === "string" ? parsed.model : "";
  if (shouldResetDefaultModel(currentModel, providerBlock.models ?? {})) {
    const modelEdits = modify(updated, ["model"], chooseDefaultModelId(providerBlock.models ?? {}), {
      formattingOptions: FORMAT,
    });
    updated = applyEdits(updated, modelEdits);
  }

  const providerEdits = modify(updated, ["provider", WODEAPP_PROVIDER_ID], providerBlock, {
    formattingOptions: FORMAT,
  });
  updated = applyEdits(updated, providerEdits);

  const disabledEdits = modify(updated, ["disabled_providers"], [], {
    formattingOptions: FORMAT,
  });
  updated = applyEdits(updated, disabledEdits);

  for (const [id, block] of Object.entries(managedMcpBlocks)) {
    const mcpEdits = modify(updated, ["mcp", id], block, {
      formattingOptions: FORMAT,
    });
    updated = applyEdits(updated, mcpEdits);
  }
  updated = safeRemoveEmptyObjectProperty(updated, ["mcp"]);

  return updated.endsWith("\n") ? updated : `${updated}\n`;
}

export async function syncWodeAppProviderToGlobalOpencode(deps) {
  const config = await loadWodeAppConfig();
  const signedIn = Boolean(config?.apiKey);

  const providerBlock = await buildProviderBlock(config);
  const managedMcpBlocks = signedIn ? buildManagedMcpBlocks(config) : {};
  const platformMcpBlock = managedMcpBlocks[WODEAPP_PLATFORM_MCP_ID] ?? null;
  const shopifyAdminMcpBlock = managedMcpBlocks[WODEAPP_SHOPIFY_ADMIN_MCP_ID] ?? null;
  const current = await deps.readOpencodeConfig("global", "");
  const nextContent = applyWodeAppProviderEdits(
    current.content ?? "",
    providerBlock,
    managedMcpBlocks,
  );
  const currentDoc = normalizeConfigDocument(current.content ?? "");
  const nextDoc = normalizeConfigDocument(nextContent);
  const unchanged = configsEqual(currentDoc, nextDoc);

  // Always fan-out write: sibling runtime account dirs may still hold a stale
  // MCP key even when the primary account file already matches.
  const writeResult = await deps.writeOpencodeConfig("global", "", nextContent);
  await syncRuntimeAuthJsonFiles(config).catch(() => undefined);

  return {
    ok: true,
    signedIn,
    unchanged,
    providerId: WODEAPP_PROVIDER_ID,
    mcpId: platformMcpBlock ? WODEAPP_PLATFORM_MCP_ID : null,
    mcpUrl: platformMcpBlock ? platformMcpUrl(config) : null,
    builtInToolsConfigured: Boolean(platformMcpBlock),
    shopifyAdminMcpId: shopifyAdminMcpBlock ? WODEAPP_SHOPIFY_ADMIN_MCP_ID : null,
    shopifyAdminMcpUrl: shopifyAdminMcpBlock ? shopifyAdminMcpUrl(config) : null,
    shopifyAdminToolsConfigured: Boolean(shopifyAdminMcpBlock),
    managedMcpConnectors: Object.keys(managedMcpBlocks),
    baseURL: aiProxyBaseUrl(config || {}),
    origin: resolvePlatformOrigin(config || {}),
    defaultModelId: chooseDefaultModelKey(providerBlock.models ?? {}),
    writeResult,
  };
}

async function syncRuntimeAuthJsonFiles(config) {
  let listExistingRuntimeAccountPaths;
  let managedRuntimeDataPaths;
  let resolveAccountIdFromWodeAppConfig;
  try {
    ({
      listExistingRuntimeAccountPaths,
      managedRuntimeDataPaths,
      resolveAccountIdFromWodeAppConfig,
    } = await import("../wodeapp-runtime-account-paths.mjs"));
  } catch {
    return;
  }
  let userDataDir = "";
  try {
    const electron = await import("electron");
    userDataDir = electron.app?.getPath?.("userData") || "";
  } catch {
    return;
  }
  if (!userDataDir) return;

  const { mkdir, readFile, writeFile } = await import("node:fs/promises");
  const paths = await listExistingRuntimeAccountPaths(userDataDir);
  const primary = managedRuntimeDataPaths(userDataDir, resolveAccountIdFromWodeAppConfig(config));
  const targets = [...paths, primary].filter((item, index, all) =>
    all.findIndex((other) => other.opencodeAuthPath === item.opencodeAuthPath) === index
  );

  // Never store sk_live_ in auth.json — that duplicated ~/.wodeapp and caused
  // stale/embedded keys to bill a different wallet than the UI credits show.
  // Provider/MCP configs use {env:WODEAPP_API_KEY} instead.
  for (const item of targets) {
    await mkdir(path.dirname(item.opencodeAuthPath), { recursive: true });
    let auth = {};
    try {
      auth = JSON.parse(await readFile(item.opencodeAuthPath, "utf8"));
      if (!auth || typeof auth !== "object") auth = {};
    } catch {
      auth = {};
    }
    if (!("wodeapp" in auth)) continue;
    delete auth.wodeapp;
    await writeFile(item.opencodeAuthPath, `${JSON.stringify(auth, null, 2)}\n`, "utf8");
  }
}

export async function fetchWodeAppPlatformToolsHealth(config, options = {}) {
  const normalized = normalizeWodeAppCloudConfig(config || {});
  const apiKey = normalized.apiKey?.trim();
  const endpoint = platformMcpUrl(normalized);
  const timeoutMs = options.timeoutMs ?? PLATFORM_MCP_HEALTH_TIMEOUT_MS;
  const signal = timeoutMs > 0 && typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
    ? AbortSignal.timeout(timeoutMs)
    : undefined;
  if (!apiKey) {
    return {
      ok: false,
      signedIn: false,
      status: "embedded_unavailable",
      endpoint,
      toolCount: 0,
    };
  }

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
      signal,
    });

    const raw = await response.text();
    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        signedIn: true,
        status: "auth_failed",
        httpStatus: response.status,
        endpoint,
        toolCount: 0,
      };
    }
    if (!response.ok) {
      return {
        ok: false,
        signedIn: true,
        status: "unreachable",
        httpStatus: response.status,
        endpoint,
        toolCount: 0,
      };
    }

    const dataLine = raw.includes("data:")
      ? raw.split("\n").filter((line) => line.startsWith("data:")).pop()?.slice(5).trim()
      : raw;
    const parsed = JSON.parse(dataLine || raw || "{}");
    const tools = parsed?.result?.tools;
    if (!Array.isArray(tools)) {
      return {
        ok: false,
        signedIn: true,
        status: "invalid_response",
        httpStatus: response.status,
        endpoint,
        toolCount: 0,
      };
    }
    return {
      ok: true,
      signedIn: true,
      status: "ready",
      httpStatus: response.status,
      endpoint,
      toolCount: tools.length,
      transport: "streamable-http",
    };
  } catch (error) {
    return {
      ok: false,
      signedIn: true,
      status: "unreachable",
      endpoint,
      toolCount: 0,
      error: error instanceof Error ? error.message : "WodeApp built-in tools are unavailable",
    };
  }
}

async function fetchWodeAppApiModelIds(config) {
  // Logout / unsigned sync may pass null after clearWodeAppConfig().
  const normalized = normalizeWodeAppCloudConfig(config || {});
  const apiKey = normalized.apiKey?.trim();
  const runtimeResult = await fetchWodeAppRuntimeTextModelIds(normalized, apiKey);
  if (runtimeResult.ids.length > 0) return runtimeResult;

  if (!apiKey) return { ids: fallbackApiModelIds(), names: {}, authoritative: false };

  const url = `${aiProxyBaseUrl(normalized)}/models`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-API-Key": apiKey,
      },
      signal: requestTimeoutSignal(),
    });
    if (!res.ok) return { ids: fallbackApiModelIds(), names: {}, authoritative: false };
    const json = await res.json();
    const ids = Array.isArray(json?.data)
      ? json.data.map((entry) => String(entry?.id ?? "").trim()).filter(Boolean)
      : [];
    return ids.length > 0
      ? { ids, names: {}, authoritative: false }
      : { ids: fallbackApiModelIds(), names: {}, authoritative: false };
  } catch {
    return { ids: fallbackApiModelIds(), names: {}, authoritative: false };
  }
}

async function fetchWodeAppRuntimeTextModelIds(normalized, apiKey) {
  const url = `${resolvePlatformOrigin(normalized)}/runtime-server/api/ai/models`;
  try {
    const headers = { Accept: "application/json" };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
      headers["X-API-Key"] = apiKey;
    }
    const res = await fetch(url, { headers, signal: requestTimeoutSignal() });
    if (!res.ok) return { ids: [], names: {}, authoritative: true };
    const json = await res.json();
    const source = Array.isArray(json?.models)
      ? json.models
      : Array.isArray(json?.registry?.text)
        ? json.registry.text
        : [];
    const ids = [];
    const names = {};
    for (const item of source) {
      const id = String(item?.value ?? item?.id ?? item?.modelId ?? "").trim();
      if (!id || ids.includes(id)) continue;
      ids.push(id);
      const label = String(item?.label ?? item?.name ?? "").trim();
      if (label) names[id] = label;
    }
    return { ids, names, authoritative: true };
  } catch {
    return { ids: [], names: {}, authoritative: true };
  }
}

/** 返回 OpenCode 可用的 model key 列表（Wode API id） */
export async function fetchWodeAppModelIds(config) {
  const result = await fetchWodeAppApiModelIds(config);
  const keys = normalizePreferredApiModelIds(result.ids, { authoritative: result.authoritative })
    .map((apiId) => apiIdToOpencodeEntry(apiId, { name: result.names?.[apiId] }).key)
    .filter(Boolean);
  return keys.length > 0 ? [...new Set(keys)] : Object.keys(WODEAPP_DEFAULT_MODELS);
}

export async function fetchWodeAppCredits(config, options = {}) {
  const normalized = normalizeWodeAppCloudConfig(config || {});
  const apiKey = normalized.apiKey?.trim();
  if (!apiKey) return null;

  const url = `${resolvePlatformOrigin(normalized)}/mainserver/api/credits`;
  const attempts = Math.max(1, Math.min(3, Number(options.attempts) || 2));
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : PLATFORM_API_TIMEOUT_MS;
  const retryDelayMs = Number(options.retryDelayMs) >= 0
    ? Number(options.retryDelayMs)
    : CREDITS_RETRY_DELAY_MS;
  const requestJson = typeof options.requestJson === "function" ? options.requestJson : requestJsonWithNode;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const res = await requestJson(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
          "X-API-Key": apiKey,
        },
        timeoutMs,
      });
      const json = res.json;
      if (json?.success && typeof json.data?.credits === "number") {
        return json.data.credits;
      }
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        return null;
      }
    } catch {
      // A timeout or transient network error is retried below.
    }
    if (attempt + 1 < attempts) {
      await waitForRetry(retryDelayMs);
    }
  }
  return null;
}

export function normalizeAbilityProjects(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const id = typeof item.id === "string" ? item.id.trim() : "";
      const url = typeof item.launchUrl === "string" && item.launchUrl.trim()
        ? item.launchUrl.trim()
        : typeof item.url === "string"
          ? item.url.trim()
          : "";
      if (!id || !url) return null;
      return {
        id,
        kind: typeof item.kind === "string" ? item.kind : "image",
        title: typeof item.title === "string" && item.title.trim() ? item.title.trim() : id,
        projectId: typeof item.projectId === "string" ? item.projectId : "",
        name: typeof item.name === "string" && item.name.trim() ? item.name.trim() : id,
        slug: typeof item.slug === "string" ? item.slug : "",
        subdomain: typeof item.subdomain === "string" ? item.subdomain : "",
        url,
        launchUrl: url,
        createdAt: typeof item.createdAt === "string" ? item.createdAt : undefined,
        updatedAt: typeof item.updatedAt === "string" ? item.updatedAt : undefined,
      };
    })
    .filter(Boolean);
}

export async function fetchWodeAppAbilityProjects(config) {
  const result = await fetchWodeAppAbilityProjectsDetailed(config);
  return result.projects;
}

export async function fetchWodeAppAbilityProjectsDetailed(config, options = {}) {
  const normalized = normalizeWodeAppCloudConfig(config || {});
  const apiKey = normalized.apiKey?.trim();
  if (!apiKey) {
    return { projects: [], user: null, error: "WodeApp 账户暂不可用" };
  }

  const url = `${resolvePlatformOrigin(normalized)}/mainserver/api/auth/wodeappx-bootstrap`;
  const requestJson = typeof options.requestJson === "function" ? options.requestJson : requestJsonWithNode;
  try {
    const res = await requestJson(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-API-Key": apiKey,
      },
      body: "{}",
      timeoutMs: Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : PLATFORM_API_TIMEOUT_MS,
    });
    const json = res.json || {};
    if (!res.ok) {
      const message = typeof json?.error === "string" && json.error.trim()
        ? json.error.trim()
        : `平台返回 ${res.status}`;
      return { projects: [], user: null, error: message, status: res.status };
    }
    const projects = normalizeAbilityProjects(json?.data?.abilityProjects);
    const user = json?.data?.user && typeof json.data.user === "object"
      ? {
          id: typeof json.data.user.id === "string" ? json.data.user.id : undefined,
          name: typeof json.data.user.name === "string" ? json.data.user.name : null,
        }
      : null;
    const bootstrapErrors = Array.isArray(json?.data?.errors) ? json.data.errors : [];
    if (projects.length > 0) {
      return { projects, user, error: null, status: res.status };
    }
    const bootstrapMessage = bootstrapErrors.find((item) => typeof item?.message === "string")?.message;
    return {
      projects: [],
      user,
      error: bootstrapMessage || "暂未获取到专属智能体项目",
      status: res.status,
    };
  } catch (error) {
    return {
      projects: [],
      user: null,
      error: error instanceof Error ? error.message : "网络连接失败",
    };
  }
}
