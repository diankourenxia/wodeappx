import { isIP } from "node:net";

const MAX_DESKTOP_FETCH_BYTES = 16 * 1024 * 1024;

function isPrivateIpv4(hostname) {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] === 0;
}

function isPrivateIpv6(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "::1"
    || normalized === "::"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized);
}

export function validateDesktopFetchUrl(rawUrl, env = process.env) {
  let url;
  try {
    url = new URL(String(rawUrl ?? ""));
  } catch {
    throw new Error("Desktop fetch requires a valid absolute URL");
  }
  const allowInsecure = env.OPENWORK_ALLOW_INSECURE_REMOTE_FETCH === "1";
  if (url.protocol !== "https:" && !(allowInsecure && url.protocol === "http:")) {
    throw new Error("Desktop fetch requires HTTPS; set OPENWORK_ALLOW_INSECURE_REMOTE_FETCH=1 only for trusted development services");
  }
  if (url.username || url.password) throw new Error("Desktop fetch URLs must not contain credentials");
  const hostname = url.hostname.toLowerCase();
  const localName = hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local");
  const privateIp = isIP(hostname) === 4
    ? isPrivateIpv4(hostname)
    : isIP(hostname) === 6
      ? isPrivateIpv6(hostname)
      : false;
  if ((localName || privateIp) && env.OPENWORK_ALLOW_PRIVATE_REMOTE_FETCH !== "1") {
    throw new Error("Desktop fetch blocks loopback, link-local, and private-network targets by default");
  }
  return url.toString();
}

export async function readBoundedResponseText(response, maxBytes = MAX_DESKTOP_FETCH_BYTES) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Desktop fetch response exceeds the ${maxBytes}-byte limit`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Desktop fetch response exceeds the ${maxBytes}-byte limit`);
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export function assertTrustedRendererEvent(event, getMainWindow) {
  const window = typeof getMainWindow === "function" ? getMainWindow() : null;
  const sender = event?.sender;
  const frame = event?.senderFrame;
  if (!window || window.isDestroyed?.() || !sender || sender !== window.webContents) {
    throw new Error("IPC request rejected: sender is not the main WodeAppX renderer");
  }
  if (!frame || frame !== sender.mainFrame) {
    throw new Error("IPC request rejected: subframes are not trusted");
  }
  let url;
  try {
    url = new URL(String(frame.url || sender.getURL?.() || ""));
  } catch {
    throw new Error("IPC request rejected: renderer URL is invalid");
  }
  if (url.protocol !== "file:" || !url.pathname.endsWith("/index.html")) {
    throw new Error("IPC request rejected: renderer URL is not the packaged application");
  }
}

export function createTrustedIpcMain(ipcMain, getMainWindow) {
  return {
    handle(channel, listener) {
      ipcMain.handle(channel, (event, ...args) => {
        assertTrustedRendererEvent(event, getMainWindow);
        return listener(event, ...args);
      });
    },
    // Browser-panel menu overlay events validate their own dedicated sender.
    on: ipcMain.on.bind(ipcMain),
  };
}
