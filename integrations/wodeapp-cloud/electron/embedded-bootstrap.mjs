import {
  getOrCreateWodeAppInstallId,
  isLocalWodeAppOrigin,
  normalizeWodeAppCloudConfig,
  normalizeWodeAppCloudOrigin,
  saveWodeAppConfig,
  WODEAPP_CLOUD_ORIGIN,
} from "./config-store.mjs";

function asText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

async function readJson(response) {
  const text = await response.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function normalizeAbilityProjects(value) {
  return Array.isArray(value) ? value.filter((item) => item && typeof item === "object") : [];
}

export async function bootstrapWodeAppEmbeddedIdentity(ses, origin = WODEAPP_CLOUD_ORIGIN) {
  const base = normalizeWodeAppCloudOrigin(origin);
  const installId = await getOrCreateWodeAppInstallId();

  let response;
  let payload;
  try {
    response = await ses.fetch(`${base}/mainserver/api/auth/desktop-embedded-bootstrap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WodeApp-Desktop": "1",
        Accept: "application/json",
      },
      body: JSON.stringify({
        installId,
        app: "wodeappx",
      }),
    });
    payload = await readJson(response);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "WodeApp embedded bootstrap failed",
    };
  }

  const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
  const apiKey = asText(data.apiKey);
  if (!response.ok || !payload?.success || !apiKey) {
    return {
      ok: false,
      status: response.status,
      error: asText(payload?.error) || `WodeApp embedded bootstrap failed (${response.status})`,
    };
  }

  const issuedOrigin = normalizeWodeAppCloudOrigin(asText(data.issuedOrigin) || base);
  // Base identity is always install-local. Cloud is an optional layer you can attach later.
  // - loopback → local-only (本机无账号主人)
  // - other private/selfhost Origin → selfhost
  // - public wodeapp.cn/.ai → cloud
  let profile = "selfhost";
  if (isLocalWodeAppOrigin(issuedOrigin) || isLocalWodeAppOrigin(base)) {
    profile = "local-only";
  } else {
    try {
      const host = new URL(issuedOrigin || base).hostname.replace(/^www\./, "");
      if (host === "wodeapp.cn" || host === "wodeapp.ai" || host.endsWith(".wodeapp.cn") || host.endsWith(".wodeapp.ai")) {
        profile = "cloud";
      }
    } catch {
      profile = "selfhost";
    }
  }
  const localOwner = profile === "local-only";
  const config = normalizeWodeAppCloudConfig({
    profile,
    origin: base,
    issuedOrigin,
    projectSubdomainSuffix: data.projectSubdomainSuffix ?? null,
    apiKey,
    embedded: true,
    embeddedInstallId: installId,
    user: data.user && typeof data.user === "object"
      ? {
          ...data.user,
          name: localOwner
            ? (asText(data.user.name) || "本机主人")
            : data.user.name,
        }
      : { name: localOwner ? "本机主人" : "WodeAppX 内嵌用户" },
    abilityProjects: normalizeAbilityProjects(data.abilityProjects),
  });
  const saved = await saveWodeAppConfig(config);
  return {
    ok: true,
    config: saved,
    message: localOwner
      ? "Local owner identity is ready (cloud optional)"
      : "WodeApp embedded identity is ready",
  };
}
