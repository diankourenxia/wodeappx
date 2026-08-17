import { app, ipcMain, BrowserWindow } from "electron";
import {
  aiProxyBaseUrl,
  clearWodeAppConfig,
  inferWodeAppProfile,
  isLocalWodeAppOrigin,
  loadWodeAppBrandAgents,
  loadWodeAppPlazaCatalog,
  loadWodeAppConfig,
  loadMediaByokFile,
  normalizeWodeAppCloudOrigin,
  resolvePlatformOrigin,
  saveWodeAppBrandAgents,
  saveWodeAppPlazaCatalog,
  saveWodeAppConfig,
  saveMediaByokFile,
  summarizeWodeAppServiceConfig,
  WODEAPP_CLOUD_ORIGIN,
} from "./config-store.mjs";
import { cancelWodeAppDesktopLogin, runWodeAppDesktopLogin } from "./login-bridge.mjs";
import { bootstrapWodeAppEmbeddedIdentity } from "./embedded-bootstrap.mjs";
import {
  ensureLocalWodeAppSidecar,
  resolvePreferredWodeAppOrigin,
} from "./wodeapp-local-runtime.mjs";
import {
  fetchWodeAppCredits,
  fetchWodeAppAbilityProjects,
  fetchWodeAppAbilityProjectsDetailed,
  fetchWodeAppModelIds,
  fetchWodeAppPlatformToolsHealth,
  normalizeAbilityProjects,
  syncWodeAppProviderToGlobalOpencode,
  WODEAPP_PREFERRED_OPENCODE_MODEL_KEY,
  WODEAPP_PROVIDER_ID,
} from "./wodeapp-provider.mjs";
import {
  clearWodeAppBrowserSession,
  syncWodeAppBrowserSession,
} from "./browser-session-auth.mjs";
import {
  discoverLocalByokCandidates,
  importLocalByokCandidate,
  syncLocalByokToEnv,
  LOCAL_BYOK_PRIVACY_NOTICE,
  toPublicDiscovery,
} from "./local-byok-import.mjs";
import {
  bootstrapDesktopKeysFromDisk,
  clearProviderCapabilityProbeCache,
  detectConfiguredProviderCapabilities,
  warmupConfiguredProviderCapabilities,
} from "./wodeapp-provider-capability-detect.mjs";
import { hasDesktopLocalVendorKeys, pinOpenworkEnvStore } from "./desktop-keys-store.mjs";

pinOpenworkEnvStore();
await bootstrapDesktopKeysFromDisk({ skipMonorepo: app.isPackaged });

const IPC_CHANNEL = "wodeapp:auth";
export const WODEAPP_BROWSER_SESSION_PARTITION = "persist:openwork-browser";

/** In-memory only: last discover secrets for import. Never logged / never HTTP. */
let localByokSecretCache = null;
let desktopLoginUiPhase = "idle";

function setDesktopLoginUiPhase(phase) {
  desktopLoginUiPhase = phase === "initializing" || phase === "browser" ? phase : "idle";
}

function cachedProviderSummary(config) {
  return {
    ok: true,
    signedIn: Boolean(config?.apiKey),
    providerId: WODEAPP_PROVIDER_ID,
    defaultModelId: WODEAPP_PREFERRED_OPENCODE_MODEL_KEY,
    baseURL: aiProxyBaseUrl(config || {}),
    origin: config?.issuedOrigin || config?.origin,
  };
}

function localizeAbilityProjectLaunchUrls(projects, origin, preferLocal = false) {
  const list = normalizeAbilityProjects(projects);
  if (!preferLocal && !isLocalWodeAppOrigin(origin)) return list;
  return list.map((item) => {
    const agentId = (typeof item.id === "string" && item.id.trim()) ? item.id.trim() : "";
    const slug = (typeof item.subdomain === "string" && item.subdomain.trim())
      || (typeof item.slug === "string" && item.slug.trim())
      || "";
    const raw = (typeof item.launchUrl === "string" && item.launchUrl.trim())
      || (typeof item.url === "string" && item.url.trim())
      || "";
    if (raw && !/wodeapp\.(cn|ai)/i.test(raw) && /localhost|127\.0\.0\.1/.test(raw)) {
      return item;
    }
    let projectSlug = agentId || slug;
    if (!projectSlug && raw) {
      try {
        projectSlug = new URL(raw).hostname.replace(/^www\./, "").replace(/\.wodeapp\.(cn|ai)$/i, "");
      } catch {
        projectSlug = "";
      }
    }
    if (!projectSlug) return item;
    const url = `http://localhost:5176/?project=${encodeURIComponent(projectSlug)}`;
    return { ...item, url, launchUrl: url };
  });
}

async function cachedSignedInResponse(config, overrides = {}) {
  const provider = overrides.provider || cachedProviderSummary(config);
  const hasLocalKeys = typeof overrides.hasLocalKeys === "boolean"
    ? overrides.hasLocalKeys
    : await hasDesktopLocalVendorKeys();
  const origin = config.issuedOrigin || config.origin;
  return {
    ok: true,
    signedIn: true,
    config: {
      origin,
      user: overrides.user ?? config.user ?? null,
      embedded: Boolean(config.embedded),
      profile: config.profile
        || inferWodeAppProfile(config.issuedOrigin || config.origin, config.profile),
      providerId: provider.providerId || WODEAPP_PROVIDER_ID,
      defaultModelId: provider.defaultModelId || WODEAPP_PREFERRED_OPENCODE_MODEL_KEY,
      modelIds: overrides.modelIds || [],
      credits: overrides.credits ?? config.credits ?? null,
      builtInTools: overrides.builtInTools,
      hasLocalKeys,
      abilityProjects: localizeAbilityProjectLaunchUrls(
        overrides.abilityProjects || normalizeAbilityProjects(config.abilityProjects),
        origin,
        config.profile === "local-only",
      ),
      abilityProjectsSyncError: overrides.abilityProjectsSyncError ?? null,
    },
    provider,
  };
}

async function persistAccountConfig(config, updates = {}) {
  const latest = await loadWodeAppConfig();
  // Prefer the caller config + updates. Never let a stale on-disk embedded
  // identity overwrite a freshly logged-in wallet.
  return saveWodeAppConfig({
    ...(latest || {}),
    ...config,
    ...updates,
  });
}

function applyProcessIdentityEnv(config) {
  const apiKey = typeof config?.apiKey === "string" ? config.apiKey.trim() : "";
  const userId = typeof config?.user?.id === "string" ? config.user.id.trim() : "";
  const origin = typeof config?.issuedOrigin === "string" && config.issuedOrigin.trim()
    ? config.issuedOrigin.trim()
    : (typeof config?.origin === "string" ? config.origin.trim() : "");
  if (apiKey) process.env.WODEAPP_API_KEY = apiKey;
  else delete process.env.WODEAPP_API_KEY;
  if (userId) process.env.WODEAPP_USER_ID = userId;
  else delete process.env.WODEAPP_USER_ID;
  if (origin) process.env.WODEAPP_ORIGIN = origin;
  else delete process.env.WODEAPP_ORIGIN;
}

function parentWindowFromEvent(event) {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) return win;
  return BrowserWindow.getAllWindows().find((item) => !item.isDestroyed()) ?? null;
}

async function buildSignedInResponse(config, deps) {
  applyProcessIdentityEnv(config);
  const provider = await syncWodeAppProviderToGlobalOpencode(deps);
  if (!provider.ok) {
    return { ok: false, error: provider.error || "Failed to configure WodeApp model provider" };
  }
  const [credits, modelIds, builtInTools, fetched] = await Promise.all([
    fetchWodeAppCredits(config),
    fetchWodeAppModelIds(config),
    fetchWodeAppPlatformToolsHealth(config),
    fetchWodeAppAbilityProjectsDetailed(config),
  ]);
  const storedProjects = normalizeAbilityProjects(config.abilityProjects);
  const hasLocalKeys = await hasDesktopLocalVendorKeys();
  const origin = config.issuedOrigin || config.origin;
  const sourceProjects = fetched.projects.length > 0 ? fetched.projects : storedProjects;
  const abilityProjects = localizeAbilityProjectLaunchUrls(
    sourceProjects,
    origin,
    config.profile === "local-only",
  );
  const abilityProjectsSyncError = abilityProjects.length > 0 ? null : (fetched.error || null);
  const user = fetched.user ?? config.user ?? null;
  const currentCredits = credits ?? config.credits ?? null;
  const nextConfig = await persistAccountConfig(config, {
    ...(user ? { user } : {}),
    ...(typeof credits === "number" ? { credits } : {}),
    ...(sourceProjects.length ? { abilityProjects: sourceProjects } : {}),
    // Explicit so a logged-in wallet cannot silently become embedded again.
    embedded: Boolean(config.embedded),
  });
  applyProcessIdentityEnv(nextConfig);
  return await cachedSignedInResponse(nextConfig, {
    provider,
    user,
    modelIds,
    credits: currentCredits,
    builtInTools,
    abilityProjects,
    abilityProjectsSyncError,
    hasLocalKeys,
  });
}

async function refreshWodeAppAccount(config) {
  // The account menu only needs the balance. Profile/project discovery runs on the full auth path;
  // keeping it off this path prevents an unrelated bootstrap timeout from delaying the menu.
  const credits = await fetchWodeAppCredits(config, { attempts: 1, timeoutMs: 3000 });
  const abilityProjects = normalizeAbilityProjects(config.abilityProjects);
  const user = config.user ?? null;
  const currentCredits = credits ?? config.credits ?? null;
  const nextConfig = await persistAccountConfig(config, {
    ...(user ? { user } : {}),
    ...(typeof credits === "number" ? { credits } : {}),
    ...(abilityProjects.length ? { abilityProjects } : {}),
  });
  return {
    ...await cachedSignedInResponse(nextConfig, {
      user,
      credits: currentCredits,
      abilityProjects,
      abilityProjectsSyncError: null,
    }),
    creditsFresh: typeof credits === "number",
  };
}

async function loadOrBootstrapWodeAppConfigForSession(browserSession, payload = {}) {
  const config = await loadWodeAppConfig();
  if (config?.apiKey) return config;
  if (!browserSession) {
    console.warn("[wodeapp] embedded bootstrap skipped: browser session unavailable");
    return null;
  }

  // Product model: local runtime may exist or not; cloud is an optional layer to attach.
  // Never treat cloud as the only way to get an identity when a local sidecar can start.
  const preferLocalOnly = config?.profile === "local-only"
    || payload?.profile === "local-only"
    || String(process.env.WODEAPPX_LOCAL_SIDECAR || "").trim() === "1";
  const allowCloudBootstrap = !preferLocalOnly && (
    String(process.env.WODEAPPX_CLOUD_BOOTSTRAP || "").trim() === "1"
    || payload?.allowCloudBootstrap === true
    || config?.profile === "cloud"
  );

  let userDataPath = "";
  try {
    userDataPath = app.getPath("userData");
  } catch {
    userDataPath = "";
  }

  const local = await ensureLocalWodeAppSidecar({
    userDataPath,
    edition: "oss",
    packaged: app.isPackaged,
    profile: preferLocalOnly ? "local-only" : (config?.profile || ""),
    extraOrigins: [
      typeof payload?.origin === "string" ? payload.origin : "",
      typeof config?.origin === "string" ? config.origin : "",
    ],
  });
  if (local.ok && local.origin) {
    console.info("[wodeapp] local sidecar ready for bootstrap", {
      origin: local.origin,
      spawned: local.spawned,
      reused: local.reused,
    });
    const localBootstrap = await bootstrapWodeAppEmbeddedIdentity(browserSession, local.origin);
    if (localBootstrap.ok && localBootstrap.config?.apiKey) {
      return localBootstrap.config;
    }
    console.warn(
      "[wodeapp] local bootstrap failed:",
      localBootstrap.error || localBootstrap.status || "unknown",
    );
  } else if (local.error) {
    console.info("[wodeapp] local sidecar not used:", local.error);
  }

  if (!allowCloudBootstrap) {
    console.info(
      "[wodeapp] skipping cloud bootstrap (optional layer off; BYOK / local-only still usable)",
    );
    return null;
  }

  const preferred = await resolvePreferredWodeAppOrigin({
    cloudOrigin: WODEAPP_CLOUD_ORIGIN,
    extraOrigins: [
      typeof payload?.origin === "string" ? payload.origin : "",
      typeof config?.origin === "string" ? config.origin : "",
    ],
  });
  const origin = normalizeWodeAppCloudOrigin(
    preferred.ok
      ? preferred.origin
      : (typeof payload?.origin === "string" ? payload.origin : WODEAPP_CLOUD_ORIGIN),
  );
  if (preferred.ok) {
    console.info("[wodeapp] preferred origin for cloud bootstrap", {
      origin,
      mode: preferred.mode,
    });
  }
  const bootstrap = await bootstrapWodeAppEmbeddedIdentity(browserSession, origin);
  if (bootstrap.ok && bootstrap.config?.apiKey) {
    return bootstrap.config;
  }
  console.warn("[wodeapp] cloud bootstrap failed:", bootstrap.error || bootstrap.status || "unknown");
  return null;
}

async function loadOrBootstrapWodeAppConfig(event, payload = {}) {
  return loadOrBootstrapWodeAppConfigForSession(event.sender.session, payload);
}

/**
 * Finish embedded identity bootstrap and persist the authenticated provider
 * before OpenCode starts. Otherwise the first request can race the async IPC
 * bootstrap and reach WodeApp as an unauthenticated guest.
 */
export async function prepareWodeAppProviderForStartup(browserSession, deps) {
  const config = await loadOrBootstrapWodeAppConfigForSession(browserSession);
  const provider = await syncWodeAppProviderToGlobalOpencode(deps);
  return {
    ok: Boolean(provider?.ok),
    signedIn: Boolean(config?.apiKey),
    provider,
  };
}

function getBuiltInBrowserSession(deps) {
  try {
    return deps?.getBrowserSession?.() ?? null;
  } catch {
    return null;
  }
}

export async function prepareWodeAppBrowserSession(browserSession) {
  const config = await loadWodeAppConfig();
  if (!config?.apiKey) {
    return { ok: false, signedIn: false, error: "WodeApp account is unavailable" };
  }
  const result = await syncWodeAppBrowserSession(browserSession, config);
  return { ...result, signedIn: Boolean(result.ok) };
}

async function syncBuiltInBrowserSession(config, deps) {
  const browserSession = getBuiltInBrowserSession(deps);
  if (!browserSession) return { ok: false, error: "Built-in browser session is unavailable" };
  return syncWodeAppBrowserSession(browserSession, config);
}

async function syncAbilityProjectsFromConfig(config) {
  if (!config?.apiKey) {
    return { ok: false, projects: [], error: "WodeApp 账户暂不可用" };
  }
  const fetched = await fetchWodeAppAbilityProjectsDetailed(config);
  const storedProjects = normalizeAbilityProjects(config.abilityProjects);
  const projects = fetched.projects.length > 0 ? fetched.projects : storedProjects;
  const user = fetched.user ?? config.user ?? null;
  if (projects.length || user) {
    await persistAccountConfig(config, {
      ...(user ? { user } : {}),
      ...(projects.length ? { abilityProjects: projects } : {}),
    });
  }
  return {
    ok: projects.length > 0,
    projects,
    error: projects.length > 0 ? null : (fetched.error || "暂未获取到专属智能体项目"),
  };
}

function readCompletionError(payload, fallback) {
  const error = payload?.error;
  if (!error) return fallback;
  if (typeof error === "string") return error;
  if (typeof error?.message === "string" && error.message) return error.message;
  return fallback;
}

async function requestWodeAppChatCompletion(config, payload) {
  const apiKey = config?.apiKey?.trim();
  if (!apiKey) {
    return { ok: false, error: "WodeApp account is unavailable" };
  }
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.messages)) {
    return { ok: false, error: "Invalid chat completion payload" };
  }

  try {
    const response = await fetch(`${aiProxyBaseUrl(config)}/chat/completions`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        ...payload,
        stream: false,
      }),
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: readCompletionError(data, text || `Request failed (${response.status})`),
      };
    }
    return { ok: true, data };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to request WodeApp AI",
    };
  }
}

export function registerWodeAppAuthIpc(deps) {
  ipcMain.handle(IPC_CHANNEL, async (event, action, payload = {}) => {
    switch (action) {
      case "load": {
        const config = await loadOrBootstrapWodeAppConfig(event, payload);
        if (!config?.apiKey) {
          return { ok: false, signedIn: false, config: null, error: "WodeApp account is unavailable" };
        }
        const browserAuth = await syncBuiltInBrowserSession(config, deps);
        if (!browserAuth.ok) {
          console.warn("[wodeapp] built-in browser sign-in sync failed:", browserAuth.error);
        }
        return buildSignedInResponse(config, deps);
      }

      case "loadCached": {
        const config = await loadOrBootstrapWodeAppConfig(event, payload);
        if (!config?.apiKey) {
          return { ok: false, signedIn: false, config: null, error: "WodeApp account is unavailable" };
        }
        const browserAuth = await syncBuiltInBrowserSession(config, deps);
        if (!browserAuth.ok) {
          console.warn("[wodeapp] built-in browser sign-in sync failed:", browserAuth.error);
        }
        return await cachedSignedInResponse(config);
      }

      case "refreshAccount": {
        const config = await loadOrBootstrapWodeAppConfig(event, payload);
        if (!config?.apiKey) {
          return { ok: false, signedIn: false, config: null, error: "WodeApp account is unavailable" };
        }
        const browserAuth = await syncBuiltInBrowserSession(config, deps);
        if (!browserAuth.ok) {
          console.warn("[wodeapp] built-in browser sign-in sync failed:", browserAuth.error);
        }
        return refreshWodeAppAccount(config);
      }

      case "login": {
        const parent = parentWindowFromEvent(event);
        if (!parent) {
          return { ok: false, error: "Desktop window unavailable" };
        }
        const origin = normalizeWodeAppCloudOrigin(
          typeof payload?.origin === "string" ? payload.origin : WODEAPP_CLOUD_ORIGIN,
        );
        setDesktopLoginUiPhase("browser");
        try {
          const login = await runWodeAppDesktopLogin(parent, origin, {
            onProgress: (phase) => setDesktopLoginUiPhase(phase || "initializing"),
          });
          if (!login.ok || !login.config) {
            return { ok: false, error: login.error || "Account binding failed" };
          }
          setDesktopLoginUiPhase("initializing");
          applyProcessIdentityEnv(login.config);
          const browserAuth = await syncBuiltInBrowserSession(login.config, deps);
          if (!browserAuth.ok) {
            console.warn("[wodeapp] built-in browser sign-in sync failed:", browserAuth.error);
          }
          return await buildSignedInResponse(login.config, deps);
        } finally {
          setDesktopLoginUiPhase("idle");
        }
      }

      case "loginStatus": {
        return { ok: true, phase: desktopLoginUiPhase };
      }

      case "cancelLogin": {
        setDesktopLoginUiPhase("idle");
        cancelWodeAppDesktopLogin();
        return { ok: true };
      }

      case "applyProvider": {
        const config = await loadOrBootstrapWodeAppConfig(event, payload);
        if (!config?.apiKey) {
          return { ok: false, error: "WodeApp account is unavailable" };
        }
        const [provider, builtInTools] = await Promise.all([
          syncWodeAppProviderToGlobalOpencode(deps),
          fetchWodeAppPlatformToolsHealth(config),
        ]);
        return provider.ok
          ? { ok: true, ...provider, builtInTools }
          : { ok: false, error: provider.error || "Provider sync failed" };
      }

      case "toolsHealth": {
        const config = await loadOrBootstrapWodeAppConfig(event, payload);
        if (!config?.apiKey) {
          return { ok: false, signedIn: false, status: "embedded_unavailable", toolCount: 0 };
        }
        return fetchWodeAppPlatformToolsHealth(config);
      }

      case "credentials": {
        const config = await loadOrBootstrapWodeAppConfig(event, payload);
        if (!config?.apiKey) {
          return { ok: false, signedIn: false, error: "WodeApp account is unavailable" };
        }
        return {
          ok: true,
          signedIn: true,
          origin: config.issuedOrigin || config.origin,
          apiKey: config.apiKey,
        };
      }

      case "getServiceConfig": {
        const config = await loadWodeAppConfig();
        return {
          ok: true,
          config: summarizeWodeAppServiceConfig(config),
        };
      }

      case "listBrandAgents": {
        const file = await loadWodeAppBrandAgents();
        return { ok: true, ...file };
      }

      case "saveBrandAgents": {
        try {
          const saved = await saveWodeAppBrandAgents(payload);
          return { ok: true, ...saved };
        } catch (error) {
          return {
            ok: false,
            version: 1,
            agents: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      case "listPlazaCatalog": {
        const file = await loadWodeAppPlazaCatalog();
        return { ok: true, ...file };
      }

      case "savePlazaCatalog": {
        try {
          const saved = await saveWodeAppPlazaCatalog(payload);
          return { ok: true, ...saved };
        } catch (error) {
          return {
            ok: false,
            version: 1,
            exists: false,
            items: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      case "getMediaByok": {
        const file = await loadMediaByokFile();
        return { ok: true, ...file };
      }

      case "saveMediaByok": {
        try {
          const saved = await saveMediaByokFile(payload);
          clearProviderCapabilityProbeCache();
          return { ok: true, ...saved };
        } catch (error) {
          return {
            ok: false,
            version: 1,
            preferLocal: true,
            providers: {},
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      case "detectCapabilities": {
        try {
          const config = await loadWodeAppConfig();
          const accountId = typeof config?.user?.id === "string" && config.user.id.trim()
            ? config.user.id.trim()
            : "anonymous";
          const result = await detectConfiguredProviderCapabilities({
            userDataDir: app.getPath("userData"),
            accountId,
            config,
            force: payload?.force === true,
          });
          return {
            ok: true,
            cached: Boolean(result.cached),
            probes: Array.isArray(result.probes) ? result.probes : [],
          };
        } catch (error) {
          return {
            ok: false,
            probes: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      case "discoverLocalByok": {
        try {
          const discovery = await discoverLocalByokCandidates();
          localByokSecretCache = discovery._secrets || null;
          return toPublicDiscovery(discovery);
        } catch (error) {
          return {
            ok: false,
            privacyNotice: LOCAL_BYOK_PRIVACY_NOTICE,
            candidates: [],
            skipped: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      case "importLocalByok": {
        try {
          const sourceId = typeof payload?.sourceId === "string" ? payload.sourceId.trim() : "";
          if (!sourceId) {
            return {
              ok: false,
              privacyNotice: LOCAL_BYOK_PRIVACY_NOTICE,
              uploaded: false,
              error: "缺少 sourceId",
            };
          }
          const config = await loadWodeAppConfig();
          const accountId = typeof config?.user?.id === "string" && config.user.id.trim()
            ? config.user.id.trim()
            : "anonymous";
          const result = await importLocalByokCandidate({
            sourceId,
            discovery: { _secrets: localByokSecretCache || {} },
            userDataDir: app.getPath("userData"),
            accountId,
          });
          clearProviderCapabilityProbeCache();
          // Strip nothing needed — apiKey only travels renderer←main over local IPC.
          return {
            ...result,
            uploaded: false,
            cloudSync: false,
          };
        } catch (error) {
          return {
            ok: false,
            privacyNotice: LOCAL_BYOK_PRIVACY_NOTICE,
            uploaded: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      case "syncLocalByokEnv": {
        try {
          const config = await loadWodeAppConfig();
          const accountId = typeof config?.user?.id === "string" && config.user.id.trim()
            ? config.user.id.trim()
            : "anonymous";
          const discovery = await discoverLocalByokCandidates();
          localByokSecretCache = discovery._secrets || null;
          const result = await syncLocalByokToEnv({
            discovery,
            userDataDir: app.getPath("userData"),
            accountId,
          });
          clearProviderCapabilityProbeCache();
          return {
            ...result,
            uploaded: false,
            cloudSync: false,
          };
        } catch (error) {
          return {
            ok: false,
            privacyNotice: LOCAL_BYOK_PRIVACY_NOTICE,
            uploaded: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }

      case "probeOrigin": {
        const origin = normalizeWodeAppCloudOrigin(
          typeof payload?.origin === "string" ? payload.origin : WODEAPP_CLOUD_ORIGIN,
        );
        const result = await probeWodeAppOrigin(origin, {
          timeoutMs: Number(payload?.timeoutMs) > 0 ? Number(payload.timeoutMs) : 2500,
        });
        return {
          ok: Boolean(result.ok),
          origin: result.origin || origin,
          status: result.status ?? null,
          error: result.error || null,
        };
      }

      case "saveServiceConfig": {
        const originRaw = typeof payload?.origin === "string" ? payload.origin.trim() : "";
        if (!originRaw) {
          return { ok: false, error: "Origin is required" };
        }
        if (!/^https?:\/\//i.test(originRaw)) {
          return { ok: false, error: "Origin must start with http:// or https://" };
        }
        const origin = normalizeWodeAppCloudOrigin(originRaw);
        const profile = inferWodeAppProfile(origin, payload?.profile);
        const incomingKey = typeof payload?.apiKey === "string" ? payload.apiKey.trim() : "";
        const clearApiKey = payload?.clearApiKey === true;
        const latest = await loadWodeAppConfig();
        const previousOrigin = latest ? resolvePlatformOrigin(latest) : "";
        const originChanged = Boolean(previousOrigin && previousOrigin !== origin);
        const nextApiKey = clearApiKey
          ? undefined
          : (incomingKey || (typeof latest?.apiKey === "string" ? latest.apiKey : undefined));

        const saved = await saveWodeAppConfig({
          ...(latest || {}),
          profile,
          origin,
          issuedOrigin: origin,
          apiKey: nextApiKey,
          embedded: clearApiKey ? false : Boolean(latest?.embedded),
          embeddedInstallId: latest?.embeddedInstallId,
          user: clearApiKey ? undefined : latest?.user,
          credits: clearApiKey ? undefined : latest?.credits,
          abilityProjects: originChanged || clearApiKey
            ? []
            : normalizeAbilityProjects(latest?.abilityProjects),
        });

        let provider = null;
        let providerError = null;
        if (saved.apiKey) {
          const synced = await syncWodeAppProviderToGlobalOpencode(deps);
          if (synced.ok) {
            provider = synced;
            const browserAuth = await syncBuiltInBrowserSession(saved, deps);
            if (!browserAuth.ok) {
              console.warn("[wodeapp] browser session sync after service save failed:", browserAuth.error);
            }
          } else {
            providerError = synced.error || "Provider sync failed";
          }
        }

        return {
          ok: true,
          config: summarizeWodeAppServiceConfig(saved),
          signedIn: Boolean(saved.apiKey),
          provider,
          providerError,
        };
      }

      case "chatCompletion":
      case "chat.completions": {
        const config = await loadOrBootstrapWodeAppConfig(event, payload);
        return requestWodeAppChatCompletion(config, payload);
      }

      case "syncAbilityProjects": {
        const config = await loadOrBootstrapWodeAppConfig(event, payload);
        if (!config?.apiKey) {
          return { ok: false, signedIn: false, projects: [], error: "WodeApp 账户暂不可用" };
        }
        return syncAbilityProjectsFromConfig(config);
      }

      case "logout": {
        const config = await loadWodeAppConfig();
        const browserSession = getBuiltInBrowserSession(deps);
        if (browserSession && config) {
          await clearWodeAppBrowserSession(browserSession, config);
        }
        await clearWodeAppConfig();
        delete process.env.WODEAPP_API_KEY;
        delete process.env.WODEAPP_USER_ID;
        // Drop logged-in MCP/provider keys, then restore the install trial wallet
        // so the sidecar cannot keep charging the previous phone/email account.
        await syncWodeAppProviderToGlobalOpencode(deps);
        const session = event.sender?.session || browserSession;
        const next = session
          ? await loadOrBootstrapWodeAppConfigForSession(session, payload)
          : null;
        if (next?.apiKey) {
          applyProcessIdentityEnv(next);
          await syncWodeAppProviderToGlobalOpencode(deps);
          if (browserSession) {
            await syncWodeAppBrowserSession(browserSession, next).catch(() => null);
          }
        }
        // UI treats logout as signed-out; next load/refresh surfaces the trial wallet.
        return { ok: true, signedIn: false };
      }

      default:
        return { ok: false, error: `Unknown wodeapp auth action: ${String(action)}` };
    }
  });

  const warmup = () => {
    void (async () => {
      try {
        const config = await loadWodeAppConfig();
        const accountId = typeof config?.user?.id === "string" && config.user.id.trim()
          ? config.user.id.trim()
          : "anonymous";
        await warmupConfiguredProviderCapabilities({
          userDataDir: app.getPath("userData"),
          accountId,
          config,
        });
      } catch (error) {
        console.warn(
          "[wodeapp] capability warmup skipped:",
          error instanceof Error ? error.message : String(error),
        );
      }
    })();
  };
  if (app.isReady()) warmup();
  else app.whenReady().then(warmup).catch(() => undefined);
}
