const AUTH_COOKIE_NAMES = ["auth_token", "refresh_token"];

function normalizeOrigin(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return "";
  }
}

function readApiKey(config) {
  return typeof config?.apiKey === "string" ? config.apiKey.trim() : "";
}

function readPlatformOrigin(config) {
  return normalizeOrigin(config?.issuedOrigin || config?.origin);
}

async function hasAuthCookie(browserSession, origin) {
  const cookies = await browserSession.cookies.get({ url: origin });
  return cookies.some((cookie) => cookie?.name === "auth_token");
}

/**
 * Convert the desktop account API key into an httpOnly cookie inside the
 * built-in browser's isolated persistent session.
 */
export async function syncWodeAppBrowserSession(browserSession, config) {
  if (!browserSession?.fetch || !browserSession?.cookies) {
    return { ok: false, error: "Built-in browser session is unavailable" };
  }

  const origin = readPlatformOrigin(config);
  const apiKey = readApiKey(config);
  if (!origin || !apiKey) {
    return { ok: false, error: "WodeApp account credentials are unavailable" };
  }

  try {
    const response = await browserSession.fetch(
      `${origin}/mainserver/api/auth/desktop-session`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "X-API-Key": apiKey,
          "X-WodeApp-Desktop": "1",
        },
      },
    );
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.success === false) {
      return {
        ok: false,
        status: response.status,
        error: body?.error || `Desktop session bridge failed (${response.status})`,
      };
    }

    if (!(await hasAuthCookie(browserSession, origin))) {
      return {
        ok: false,
        status: response.status,
        error: "Desktop session bridge did not establish an auth cookie",
      };
    }

    return {
      ok: true,
      origin,
      userId: body?.data?.userId,
      expiresAt: body?.data?.expiresAt,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Desktop session bridge failed",
    };
  }
}

export async function clearWodeAppBrowserSession(browserSession, config) {
  if (!browserSession?.cookies) return { ok: true, removed: 0 };
  const origin = readPlatformOrigin(config);
  if (!origin) return { ok: true, removed: 0 };

  let removed = 0;
  for (const name of AUTH_COOKIE_NAMES) {
    const matches = await browserSession.cookies.get({ url: origin, name }).catch(() => []);
    if (!matches.length) continue;
    await browserSession.cookies.remove(origin, name);
    removed += matches.length;
  }
  return { ok: true, removed };
}
