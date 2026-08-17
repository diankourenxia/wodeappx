/**
 * WodeApp managed model catalog for the OpenCode sidecar — single source chain:
 *
 *   shared-components/config/wodeBrandedModels.ts        （唯一手工编辑入口）
 *     → scripts/sync-wode-branded-models.mjs             （生成所有副本）
 *     → wodeapp-model-catalog.json（本目录，静态兜底）
 *
 * 运行时优先级（低 → 高）：
 *   1. 静态 catalog 作为地板（始终保留已同步的 wode/*，避免 live 缺漏时模型消失）
 *   2. 平台 live 模型列表缓存 ~/.wodeapp/models-live.json（叠加/刷新展示名，接口为主数据源）
 *   3. 用户覆盖 ~/.wodeapp/models.json（add / remove / default / baseURL）
 *
 * 用户覆盖文件格式（全部字段可选）：
 *   {
 *     "default": "wode/deepseek-v4-flash",
 *     "baseURL": "https://my-host/mainserver/api/ai/v1",
 *     "models": {
 *       "wode/my-model": { "name": "我的模型", "vision": true }
 *     },
 *     "remove": ["wode/glm-5.2"],
 *     "providers": {
 *       "my-proxy": {
 *         "npm": "@ai-sdk/openai-compatible",
 *         "name": "我的代理",
 *         "options": { "baseURL": "https://…/v1", "apiKey": "…" },
 *         "models": { "gpt-x": { "name": "GPT-X", "vision": false } }
 *       }
 *     }
 *   }
 *
 * 默认只启用 wodeapp；用户在 providers 里加的自定义 provider 会进启动白名单。
 * 桌面设置界面授权过的 provider 由 server runtime config 从 auth.json 动态加回白名单。
 * OpenCode 内置的 openai / anthropic / openrouter 等目录默认不整体暴露。
 */
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

export const WODEAPP_PROVIDER_ID = "wodeapp";
export const WODEAPP_PREFERRED_MODEL = "wode/deepseek-v4-flash";

/**
 * OpenCode only auto-compacts when model.limit.context > 0
 * (see SessionCompaction.isOverflow). Without this, long sessions swell
 * forever even with compaction.auto=true.
 *
 * Soft wall: usable ≈ input - reserved. Reserve ~50% of the window
 * (min 32k) so compaction fires near ~50% utilization — earlier than
 * Codex's ~90% hard wall, so long explore turns compact sooner.
 *
 * Catalog may advertise 1M upstream (Kimi Code K3 / Kimi K3), but OpenCode
 * `limit.context` is capped at MANAGED_MODEL_LIMIT so auto-compact still
 * fires around ~128k. Without the cap, a 1M declaration + fixed reserved
 * 128k yields soft wall ~896k and long agent sessions never compact.
 */
export const MANAGED_MODEL_LIMIT = Object.freeze({
  context: 256_000,
  input: 256_000,
  // Output ceiling for OpenCode max_tokens — not “unlimited”.
  // Codex/Cursor also set per-model max completion tokens; they stay stable
  // because large bodies go through write/apply_patch (short tool args), not
  // because they remove the limit. 16k was too tight when a turn still emits
  // a medium tool JSON; 64k matches upstream acceptance for kimi-code-k3-256k.
  // Pages / mega CustomCode must still use file-first tools — do not rely on
  // raising this further or on the model “knowing” to shrink mid-stream.
  output: 65_536,
});

/** Clamp catalog/upstream context claims to the desktop soft-wall ceiling. */
export function clampManagedContextWindow(declared) {
  const window = Number(declared);
  if (!Number.isFinite(window) || window <= 0) {
    return MANAGED_MODEL_LIMIT.context;
  }
  return Math.min(Math.floor(window), MANAGED_MODEL_LIMIT.context);
}

/** Scale reserved with context so 32k / 128k / 256k models stay proportional. */
export function managedCompactionReserved(contextWindow = MANAGED_MODEL_LIMIT.context) {
  const window = clampManagedContextWindow(contextWindow);
  return Math.max(32_000, Math.floor(window * 0.5));
}

/** Keep in sync with settings-route toggleAutoCompactContext patch. */
export const MANAGED_COMPACTION_POLICY = Object.freeze({
  auto: true,
  prune: true,
  // Keep a short tail so productId / shareDocId / style choices survive,
  // but let prune clear older web-search / coding dumps sooner (Codex/Cursor-like).
  tail_turns: 4,
  preserve_recent_tokens: 8_000,
  reserved: managedCompactionReserved(),
});

/**
 * Cap tool stdout retained in history (Codex tool_output_token_limit /
 * Cursor command-result caps). Keep enough room for structured search/tool results;
 * per-call caps alone do not stop multi-search accumulation — pair with
 * earlier soft wall + in-turn prune + idle web-tool stubbing.
 * OpenCode must apply Truncate.output unless metadata.truncateHandled===true
 * (shell); pagination metadata.truncated must NOT skip the gate.
 */
export const MANAGED_TOOL_OUTPUT_POLICY = Object.freeze({
  max_lines: 80,
  max_bytes: 8_192,
});

const LIVE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const LIVE_FETCH_TIMEOUT_MS = 5000;

let liveRefreshInFlight = false;

function readJsonSafe(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function wodeAppUserDir() {
  return path.join(os.homedir(), ".wodeapp");
}

export function userModelsOverridePath() {
  return path.join(wodeAppUserDir(), "models.json");
}

function liveModelCachePath() {
  return path.join(wodeAppUserDir(), "models-live.json");
}

function catalogEntries() {
  const parsed = readJsonSafe(path.join(__moduleDir, "wodeapp-model-catalog.json"));
  return Array.isArray(parsed) ? parsed : [];
}

function withManagedModelLimit(model) {
  const existing = model?.limit && typeof model.limit === "object" ? model.limit : null;
  const context = clampManagedContextWindow(existing?.context);
  const input = clampManagedContextWindow(
    Number.isFinite(Number(existing?.input)) && Number(existing?.input) > 0
      ? existing.input
      : existing?.context,
  );
  return {
    ...model,
    limit: {
      context,
      input,
      // Always take the managed output ceiling so catalog/live stale 16k
      // values cannot pin OpenCode max_tokens after a limit bump.
      output: MANAGED_MODEL_LIMIT.output,
    },
  };
}

function catalogEntryToOpencodeModel(entry) {
  const capabilities = Array.isArray(entry.capabilities) ? entry.capabilities : ["chat"];
  const vision = capabilities.includes("vision");
  const mediaInput = entry.mediaInput && typeof entry.mediaInput === "object" ? entry.mediaInput : null;
  const videoNative = mediaInput?.video === "native";
  const inputModalities = ["text"];
  if (vision || mediaInput?.image === "native") inputModalities.push("image");
  if (videoNative) inputModalities.push("video");
  const contextWindow = Number(entry.contextWindow);
  const cappedWindow = Number.isFinite(contextWindow) && contextWindow > 0
    ? clampManagedContextWindow(contextWindow)
    : null;
  const verifiedLimit = cappedWindow
    ? {
        context: cappedWindow,
        input: cappedWindow,
        output: MANAGED_MODEL_LIMIT.output,
      }
    : null;
  return withManagedModelLimit({
    name: typeof entry.name === "string" && entry.name ? entry.name : String(entry.apiId ?? ""),
    modalities: { input: inputModalities, output: ["text"] },
    attachment: vision || mediaInput?.image === "native",
    ...(verifiedLimit ? { limit: verifiedLimit } : {}),
  });
}

/** catalog 别名（apiId / opencodeKey / upstreamId）→ 规范条目 */
function catalogAliasMap() {
  const map = new Map();
  for (const entry of catalogEntries()) {
    for (const alias of [entry.apiId, entry.opencodeKey, entry.upstreamId]) {
      const key = String(alias ?? "").trim();
      if (key) map.set(key.toLowerCase(), entry);
    }
  }
  return map;
}

function normalizeUserModelEntry(id, value) {
  if (!value || typeof value !== "object") {
    return withManagedModelLimit({
      name: id,
      modalities: { input: ["text"], output: ["text"] },
      attachment: false,
    });
  }
  if (value.modalities && typeof value.modalities === "object") {
    return withManagedModelLimit({
      name: typeof value.name === "string" && value.name ? value.name : id,
      modalities: value.modalities,
      attachment: value.attachment === true,
      ...(value.limit && typeof value.limit === "object" ? { limit: value.limit } : {}),
    });
  }
  const vision = value.vision === true;
  return withManagedModelLimit({
    name: typeof value.name === "string" && value.name ? value.name : id,
    modalities: { input: vision ? ["text", "image"] : ["text"], output: ["text"] },
    attachment: typeof value.attachment === "boolean" ? value.attachment : vision,
    ...(value.limit && typeof value.limit === "object" ? { limit: value.limit } : {}),
  });
}

function liveCacheIds() {
  const cache = readJsonSafe(liveModelCachePath());
  if (!cache || !Array.isArray(cache.ids) || cache.ids.length === 0) return null;
  return {
    ids: cache.ids.map((id) => String(id ?? "").trim()).filter(Boolean),
    names: cache.names && typeof cache.names === "object" ? cache.names : {},
    updatedAt: Number(cache.updatedAt) || 0,
  };
}

function resolveModelsOverride(override) {
  return override === undefined ? readJsonSafe(userModelsOverridePath()) : override;
}

/** 组合最终模型表：catalog 地板 → live 叠加 → 用户覆盖 */
export function buildManagedWodeAppModels(overrideInput) {
  const aliases = catalogAliasMap();
  const models = {};

  // Floor: synced Wode branded catalog must remain selectable even when live lags.
  // Register both branded apiId and upstreamId so OpenCode lookups for either succeed
  // (live caches often expose kimicode/k3* while the UI prefers wode/kimi-code-*).
  for (const entry of catalogEntries()) {
    const id = String(entry.apiId ?? "").trim();
    if (!id) continue;
    const model = catalogEntryToOpencodeModel(entry);
    models[id] = model;
    const upstream = String(entry.upstreamId ?? "").trim();
    if (upstream && upstream !== id) models[upstream] = model;
  }

  const live = liveCacheIds();
  if (live) {
    for (const id of live.ids) {
      const known = aliases.get(id.toLowerCase());
      if (known) {
        const model = catalogEntryToOpencodeModel(known);
        models[known.apiId] = model;
        const upstream = String(known.upstreamId ?? "").trim();
        if (upstream) models[upstream] = model;
        if (id !== known.apiId && id !== upstream) models[id] = model;
      } else {
        models[id] = withManagedModelLimit({
          name: typeof live.names[id] === "string" && live.names[id] ? live.names[id] : id,
          modalities: { input: ["text"], output: ["text"] },
          attachment: false,
        });
      }
    }
  }

  const override = resolveModelsOverride(overrideInput);
  if (override && typeof override === "object") {
    if (override.models && typeof override.models === "object") {
      for (const [id, value] of Object.entries(override.models)) {
        const key = String(id ?? "").trim();
        if (key) models[key] = normalizeUserModelEntry(key, value);
      }
    }
    if (Array.isArray(override.remove)) {
      for (const id of override.remove) {
        delete models[String(id ?? "").trim()];
      }
    }
  }

  return models;
}

export function resolveManagedDefaultModel(models, overrideInput) {
  const keys = Object.keys(models ?? {});
  const override = resolveModelsOverride(overrideInput);
  const userDefault = String(override?.default ?? "").trim();
  if (userDefault && keys.includes(userDefault)) return userDefault;
  if (keys.includes(WODEAPP_PREFERRED_MODEL)) return WODEAPP_PREFERRED_MODEL;
  return keys[0] || WODEAPP_PREFERRED_MODEL;
}

function platformOrigin(env = {}) {
  const raw = String(env.WODEAPP_ORIGIN ?? "").trim().replace(/\/$/, "");
  return raw || "https://wodeapp.cn";
}

function normalizeUserProviders(override) {
  const out = {};
  if (!override?.providers || typeof override.providers !== "object") return out;
  for (const [id, value] of Object.entries(override.providers)) {
    const key = String(id ?? "").trim();
    if (!key || key === WODEAPP_PROVIDER_ID || !value || typeof value !== "object") continue;
    const models = {};
    if (value.models && typeof value.models === "object") {
      for (const [modelId, modelValue] of Object.entries(value.models)) {
        const mid = String(modelId ?? "").trim();
        if (mid) models[mid] = normalizeUserModelEntry(mid, modelValue);
      }
    }
    out[key] = {
      npm: typeof value.npm === "string" && value.npm ? value.npm : "@ai-sdk/openai-compatible",
      name: typeof value.name === "string" && value.name ? value.name : key,
      ...(value.options && typeof value.options === "object" ? { options: value.options } : {}),
      ...(Object.keys(models).length ? { models } : {}),
    };
  }
  return out;
}

function skipManagedPlaceholderKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return true;
  const lower = raw.toLowerCase();
  if (/^your[_-]/i.test(raw)) return true;
  if (lower === "changeme" || lower === "todo" || lower === "xxx") return true;
  return false;
}

function chatFloorModel(name) {
  return {
    name,
    tool_call: true,
    limit: { ...MANAGED_MODEL_LIMIT },
  };
}

function resolveEnvSecret(env = {}, names = []) {
  for (const name of names) {
    const value = String(env[name] ?? "").trim();
    if (!skipManagedPlaceholderKey(value)) return value;
  }
  return "";
}

const VOLCANO_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const VOLCANO_CHAT_FLOOR = {
  "doubao-seed-2-1-pro-260628": chatFloorModel("Doubao Seed 2.1 Pro"),
  "doubao-seed-2-0-lite-260215": chatFloorModel("Doubao Seed 2.0 Lite"),
};

/** Peer chat vendors from ~/.wodeapp/keys.json env. WodeApp cloud is not special-cased. */
const LOCAL_CHAT_PROVIDER_SPECS = [
  {
    id: "deepseek",
    name: "DeepSeek",
    envKeys: ["DEEPSEEK_API_KEY"],
    baseURL: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    models: {
      "deepseek-chat": chatFloorModel("DeepSeek Chat"),
      "deepseek-reasoner": chatFloorModel("DeepSeek Reasoner"),
    },
  },
  {
    id: "moonshot",
    name: "Kimi",
    envKeys: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
    baseURL: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k2.5",
    models: {
      "kimi-k2.5": chatFloorModel("Kimi K2.5"),
      "moonshot-v1-auto": chatFloorModel("Moonshot Auto"),
    },
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    envKeys: ["OPENROUTER_API_KEY"],
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "openai/gpt-4o-mini",
    models: {
      "openai/gpt-4o-mini": chatFloorModel("GPT-4o mini"),
    },
  },
  {
    id: "openai",
    name: "OpenAI",
    envKeys: ["OPENAI_API_KEY"],
    baseURL: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    models: {
      "gpt-4o-mini": chatFloorModel("GPT-4o mini"),
    },
  },
  {
    id: "dashscope",
    name: "通义百炼",
    envKeys: ["DASHSCOPE_API_KEY"],
    baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    models: {
      "qwen-plus": chatFloorModel("Qwen Plus"),
    },
  },
  {
    id: "volcano",
    name: "火山方舟",
    envKeys: ["ARK_API_KEY", "VOLC_ARK_API_KEY", "VOLCENGINE_API_KEY"],
    baseURL: VOLCANO_ARK_BASE_URL,
    defaultModel: "doubao-seed-2-1-pro-260628",
    models: VOLCANO_CHAT_FLOOR,
  },
];

function localChatProvidersFromEnv(env = {}, customProviders = {}) {
  const providers = {};
  const enabled = [];
  let defaultModel = "";
  for (const spec of LOCAL_CHAT_PROVIDER_SPECS) {
    if (customProviders[spec.id]) continue;
    const apiKey = resolveEnvSecret(env, spec.envKeys);
    if (!apiKey) continue;
    providers[spec.id] = {
      npm: "@ai-sdk/openai-compatible",
      name: spec.name,
      options: {
        apiKey,
        baseURL: spec.baseURL,
      },
      models: { ...spec.models },
    };
    enabled.push(spec.id);
    if (!defaultModel) defaultModel = `${spec.id}/${spec.defaultModel}`;
  }
  return { providers, enabled, defaultModel };
}

export function managedWodeAppProviderConfig(env = {}, overrideInput) {
  const apiKey = String(env.WODEAPP_API_KEY ?? "").trim();
  const override = resolveModelsOverride(overrideInput);
  const baseURL = String(override?.baseURL ?? "").trim()
    || `${platformOrigin(env)}/mainserver/api/ai/v1`;
  const options = { baseURL };
  if (apiKey) {
    options.apiKey = apiKey;
    options.headers = { "X-API-Key": apiKey };
  }
  const models = buildManagedWodeAppModels(override);
  const customProviders = normalizeUserProviders(override);
  const local = localChatProvidersFromEnv(env, customProviders);
  const wodeappEnabled = Boolean(apiKey);
  const enabledProviders = [
    ...local.enabled,
    ...(wodeappEnabled ? [WODEAPP_PROVIDER_ID] : []),
    ...Object.keys(customProviders),
  ];
  const defaultModel = local.defaultModel
    || (wodeappEnabled
      ? `${WODEAPP_PROVIDER_ID}/${resolveManagedDefaultModel(models, override)}`
      : "");
  return {
    "$schema": "https://opencode.ai/config.json",
    ...(defaultModel ? { model: defaultModel } : {}),
    enabled_providers: enabledProviders,
    // Bound tool stdout in the engine prompt (rewrite/truncate, not drop the turn).
    // Prefer earlier soft wall + prune + idle web-tool stubs so long sessions
    // (especially multi web_search / coding explore) do not wait for Codex's ~90% hard wall.
    // Cursor-like: tool_output caps + spill/stub large discovery payloads.
    // In-turn prune (OpenCode patch) clears older tool dumps mid-explore.
    tool_output: { ...MANAGED_TOOL_OUTPUT_POLICY },
    compaction: { ...MANAGED_COMPACTION_POLICY },
    provider: {
      ...(wodeappEnabled ? {
        [WODEAPP_PROVIDER_ID]: {
          npm: "@ai-sdk/openai-compatible",
          name: "WodeApp",
          options,
          models,
        },
      } : {}),
      ...local.providers,
      ...customProviders,
    },
  };
}

/** 后台刷新平台 live 模型列表缓存；失败静默，绝不阻塞启动。 */
export function refreshLiveModelCache(env = {}) {
  const apiKey = String(env.WODEAPP_API_KEY ?? "").trim();
  if (!apiKey || liveRefreshInFlight) return;
  const cache = liveCacheIds();
  if (cache && Date.now() - cache.updatedAt < LIVE_CACHE_TTL_MS) return;
  liveRefreshInFlight = true;

  const run = async () => {
    const response = await fetch(`${platformOrigin(env)}/runtime-server/api/ai/models`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-API-Key": apiKey,
      },
      signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal
        ? AbortSignal.timeout(LIVE_FETCH_TIMEOUT_MS)
        : undefined,
    });
    if (!response.ok) return;
    const json = await response.json();
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
    if (ids.length === 0) return;
    await mkdir(wodeAppUserDir(), { recursive: true });
    await writeFile(
      liveModelCachePath(),
      `${JSON.stringify({ updatedAt: Date.now(), ids, names }, null, 2)}\n`,
      "utf8",
    );
  };

  void run()
    .catch(() => undefined)
    .finally(() => {
      liveRefreshInFlight = false;
    });
}

/**
 * 把托管 provider 配置写入 OpenCode 实际读取的 config dir。
 * 这些目录是应用托管目录（openwork-dev-data / openwork-runtime-data），
 * 用户自定义一律走 ~/.wodeapp/models.json，不会被覆盖。
 */
export async function ensureManagedWodeAppOpencodeConfig(configDirs, env = {}) {
  const uniqueDirs = [...new Set((configDirs ?? []).filter(Boolean))];
  if (uniqueDirs.length === 0) return;
  const content = `${JSON.stringify(managedWodeAppProviderConfig(env), null, 2)}\n`;
  for (const dir of uniqueDirs) {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "config.json"), content, "utf8");
    await writeFile(path.join(dir, "opencode.json"), content, "utf8");
  }
  refreshLiveModelCache(env);
}
