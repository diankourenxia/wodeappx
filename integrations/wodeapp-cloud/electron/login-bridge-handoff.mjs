export const DESKTOP_HANDOFF_PATH = "/desktop-handoff";
export const DESKTOP_LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

export function isDesktopHandoffCorsOrigin(origin) {
  const value = String(origin || "").trim();
  if (!value) return false;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (parsed.protocol === "https:" && (host === "wodeapp.ai" || host === "wodeapp.cn")) return true;
    if (parsed.protocol === "http:" && (host === "127.0.0.1" || host === "localhost")) return true;
    return false;
  } catch {
    return false;
  }
}

export function isDesktopHandoffState(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

export function isDesktopHandoffPort(value) {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

export function isDesktopBootstrapRouteMissing(status) {
  return Number(status) === 404;
}

export async function probeDesktopBootstrapRoute(origin) {
  const url = new URL("/mainserver/api/auth/desktop-bootstrap", origin).toString();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-WodeApp-Desktop": "1",
      Accept: "application/json",
    },
  });
  return { status: res.status, missing: isDesktopBootstrapRouteMissing(res.status) };
}

export function buildDesktopLoginUrl(origin, port, state) {
  const url = new URL("/desktop-handoff.html", origin);
  url.searchParams.set("desktop_port", String(port));
  url.searchParams.set("desktop_state", state);
  return url.toString();
}

export function applyDesktopHandoffCors(res, requestOrigin) {
  if (!isDesktopHandoffCorsOrigin(requestOrigin)) return false;
  res.setHeader("Access-Control-Allow-Origin", requestOrigin);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Vary", "Origin");
  return true;
}

export function parseDesktopHandoffPayload(raw, expectedState) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw || ""));
  } catch {
    return { ok: false, error: "invalid_json" };
  }
  if (!parsed || typeof parsed !== "object") return { ok: false, error: "invalid_json" };
  if (parsed.state !== expectedState) return { ok: false, error: "state_mismatch" };
  if (parsed.cancel === true) return { ok: true, cancel: true };
  if (parsed.phase === "initializing" || parsed.progress === true) {
    return { ok: true, progress: true, phase: "initializing" };
  }
  const data = parsed.data && typeof parsed.data === "object" ? parsed.data : null;
  const apiKey = typeof data?.apiKey === "string" ? data.apiKey.trim() : "";
  if (!apiKey || !apiKey.startsWith("sk_")) return { ok: false, error: "missing_api_key" };
  return { ok: true, cancel: false, data };
}
