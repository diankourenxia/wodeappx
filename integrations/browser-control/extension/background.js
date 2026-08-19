const DEFAULT_BRIDGE_URL = "http://127.0.0.1:17654";
const NATIVE_HOST_NAME = "com.wodeappx.browser_control";
const NATIVE_REQUEST_TIMEOUT_MS = 45000;
const POLL_DELAY_MS = 80;
const COMMAND_WAIT_MS = 20000;
const CONNECT_REFRESH_MS = 15000;
const CONTROL_NOTICE_TTL_MS = 2600;
const NATIVE_DEBUG_NOTICE_HOLD_MS = 600000;
const DEBUGGER_ATTACH_TIMEOUT_MS = 1500;
const NOTICE_SKIP_ACTIONS = new Set(["tabs.list", "page.read"]);
const DEBUGGER_ATTACH_ACTIONS = new Set(["page.cdp", "page.screenshot", "page.key"]);
const READ_PAGE_DEFAULT_MAX_CHARS = 12000;
const READ_PAGE_DEFAULT_MAX_ELEMENTS = 240;
const READ_PAGE_MAX_ELEMENTS_CAP = 400;
const DEBUGGER_OCCUPIED_RE = /another debugger|already attached|already being debugged|被调试|已开始调试/i;
const ACTION_LABELS = {
  "tabs.list": "检查标签页",
  "tabs.open": "打开网页",
  "tabs.navigate": "跳转网页",
  "page.read": "读取页面",
  "page.click": "点击页面",
  "page.type": "输入内容",
  "page.key": "发送按键",
  "page.eval": "执行页面脚本",
  "page.screenshot": "截取页面",
  "page.cdp": "CDP 命令",
  "page.run": "连续执行",
};
const SUPPORTED_ACTIONS = Object.freeze(Object.keys(ACTION_LABELS));

let pollTimer = null;
let pollInFlight = false;
let nativePort = null;
let nativeRequestSequence = 0;
const nativePendingRequests = new Map();
let connecting = false;
let lastConnectAt = 0;
let activeCommandCount = 0;
let badgeClearTimer = null;
const nativeDebugSessions = new Map();
let lastStatus = {
  connected: false,
  bridgeUrl: DEFAULT_BRIDGE_URL,
  clientId: "",
  lastError: "",
  lastCommandAt: "",
  lastResultAt: "",
  currentCommand: "",
  currentCommandAction: "",
  currentCommandStartedAt: "",
  nativeDebugAttached: false,
  transport: "disconnected",
  nativeHostName: NATIVE_HOST_NAME,
  nativeHostVersion: "",
  nativeHostConnected: false,
  hostBridgeTransport: "",
};

function storageGet(defaults) {
  return chrome.storage.local.get(defaults);
}

function storageSet(values) {
  return chrome.storage.local.set(values);
}

function chromeCall(fn, ...args) {
  return new Promise((resolve, reject) => {
    fn(...args, (result) => {
      const err = chrome.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(result);
    });
  });
}

function normalizeBridgeUrl(value) {
  const raw = String(value || DEFAULT_BRIDGE_URL).trim().replace(/\/+$/, "");
  return raw || DEFAULT_BRIDGE_URL;
}

async function getConfig() {
  const stored = await storageGet({
    bridgeUrl: DEFAULT_BRIDGE_URL,
    bridgeToken: "",
    clientId: "",
  });
  return {
    bridgeUrl: normalizeBridgeUrl(stored.bridgeUrl),
    bridgeToken: String(stored.bridgeToken || ""),
    clientId: String(stored.clientId || ""),
  };
}

async function readBridgeHealth(config = null) {
  const current = config || await getConfig();
  const data = await bridgeRequest("health", { token: current.bridgeToken }, current);
  if (!data?.ok) throw new Error(data?.error || "WodeAppX browser bridge health check failed");
  return data;
}

function isAutomatableUrl(value) {
  const url = String(value || "");
  return /^(https?|file):/i.test(url);
}

async function sidePanelTarget() {
  try {
    const tab = await activeTab();
    return {
      ...summarizeTab(tab),
      supported: isAutomatableUrl(tab.url),
    };
  } catch {
    return { id: null, title: "当前页面", url: "", supported: false };
  }
}

async function sendSidePanelPrompt(message) {
  const prompt = String(message?.prompt || "").trim();
  if (!prompt) throw new Error("请输入要完成的网页任务");
  await connectBridge(false);
  const config = await getConfig();
  const target = await sidePanelTarget();
  return bridgeRequest("sidepanel.message", {
    token: config.bridgeToken,
    sessionId: String(message?.sessionId || ""),
    prompt,
    activeTab: target,
  }, config);
}

function tokenQuery(token) {
  return token ? `?token=${encodeURIComponent(token)}` : "";
}

function rejectNativePending(error) {
  for (const pending of nativePendingRequests.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  nativePendingRequests.clear();
}

function closeNativePort(error) {
  const current = nativePort;
  nativePort = null;
  if (current) {
    try {
      current.disconnect();
    } catch {
      // Best effort.
    }
  }
  const nativeError = error instanceof Error
    ? error
    : new Error(String(error || "WodeAppX browser native host disconnected"));
  rejectNativePending(nativeError);
  lastStatus = {
    ...lastStatus,
    nativeHostConnected: false,
    nativeHostVersion: "",
    hostBridgeTransport: "",
  };
}

function ensureNativePort() {
  if (nativePort) return nativePort;
  const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  nativePort = port;
  port.onMessage.addListener((message) => {
    const id = String(message?.id || "");
    const pending = nativePendingRequests.get(id);
    if (!pending) return;
    nativePendingRequests.delete(id);
    clearTimeout(pending.timer);
    if (message?.ok) {
      lastStatus = {
        ...lastStatus,
        nativeHostConnected: true,
        nativeHostVersion: String(message.hostVersion || ""),
        hostBridgeTransport: String(message.hostBridgeTransport || ""),
      };
      pending.resolve(message);
      return;
    }
    const error = new Error(String(message?.error || "WodeAppX browser native host request failed"));
    if (Number.isFinite(Number(message?.status))) {
      error.httpStatus = Number(message.status);
    }
    error.nativeHostReached = true;
    pending.reject(error);
  });
  port.onDisconnect.addListener(() => {
    const message = chrome.runtime.lastError?.message || "WodeAppX browser native host disconnected";
    if (nativePort === port) closeNativePort(new Error(message));
  });
  return port;
}

function nativeRequest(op, payload = {}) {
  return new Promise((resolve, reject) => {
    const port = ensureNativePort();
    const id = crypto.randomUUID?.() || `native-${Date.now()}-${++nativeRequestSequence}`;
    const timer = setTimeout(() => {
      nativePendingRequests.delete(id);
      reject(new Error(`WodeAppX browser native host timed out for ${op}`));
    }, NATIVE_REQUEST_TIMEOUT_MS);
    nativePendingRequests.set(id, { resolve, reject, timer });
    try {
      port.postMessage({ id, op, payload });
    } catch (error) {
      nativePendingRequests.delete(id);
      clearTimeout(timer);
      closeNativePort(error);
      reject(error);
    }
  });
}

async function readHttpJson(response) {
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const error = new Error(data?.error || `HTTP ${response.status}`);
    error.httpStatus = response.status;
    throw error;
  }
  return data;
}

async function httpBridgeRequest(op, payload, config) {
  const base = normalizeBridgeUrl(config.bridgeUrl);
  if (op === "health") {
    return readHttpJson(await fetch(`${base}/health${tokenQuery(payload.token)}`));
  }
  if (op === "extension.command") {
    const params = new URLSearchParams();
    if (payload.clientId) params.set("clientId", payload.clientId);
    if (payload.token) params.set("token", payload.token);
    if (payload.waitMs != null && payload.waitMs !== "") params.set("waitMs", String(payload.waitMs));
    return readHttpJson(await fetch(`${base}/extension/command?${params}`));
  }
  const routes = {
    "extension.connect": "/extension/connect",
    "extension.result": "/extension/result",
    "sidepanel.message": "/sidepanel/message",
  };
  const route = routes[op];
  if (!route) throw new Error(`Unsupported bridge operation: ${op}`);
  return readHttpJson(await fetch(`${base}${route}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, transport: "localhost_http_fallback" }),
  }));
}

async function bridgeRequest(op, payload = {}, config = null) {
  const current = config || await getConfig();
  const useNativeHost = normalizeBridgeUrl(current.bridgeUrl) === DEFAULT_BRIDGE_URL;
  if (useNativeHost) {
    try {
      const response = await nativeRequest(op, {
        ...payload,
        transport: "native_messaging",
      });
      lastStatus = {
        ...lastStatus,
        transport: "native_messaging",
        nativeHostConnected: true,
        nativeHostVersion: String(response.hostVersion || ""),
        hostBridgeTransport: String(response.hostBridgeTransport || ""),
      };
      return response.data;
    } catch (error) {
      if (error?.nativeHostReached && Number.isFinite(error.httpStatus)) {
        throw error;
      }
      lastStatus = {
        ...lastStatus,
        nativeHostConnected: false,
        transport: "localhost_http_fallback",
        nativeHostVersion: "",
        hostBridgeTransport: "",
        lastNativeHostError: String(error?.message || error),
      };
    }
  }
  const data = await httpBridgeRequest(op, payload, current);
  lastStatus = {
    ...lastStatus,
    transport: "localhost_http_fallback",
  };
  return data;
}

async function connectBridge(force = false) {
  if (connecting) return;
  const config = await getConfig();
  const now = Date.now();
  if (!force && config.clientId && now - lastConnectAt < CONNECT_REFRESH_MS) return;

  connecting = true;
  try {
    const manifest = chrome.runtime.getManifest();
    const extensionId = String(chrome.runtime.id || "");
    const extensionName = String(manifest.name || "WodeAppX Browser Control");
    const connectionPayload = {
      token: config.bridgeToken,
      clientId: config.clientId,
      name: extensionName,
      extensionId,
      extensionName,
      extensionVersion: manifest.version,
      supportedActions: SUPPORTED_ACTIONS,
      chromeVersion: navigator.userAgent,
      nativeHostVersion: lastStatus.nativeHostVersion,
      hostBridgeTransport: lastStatus.hostBridgeTransport,
    };
    let data = await bridgeRequest("extension.connect", connectionPayload, config);
    if (
      lastStatus.transport === "native_messaging"
      && (lastStatus.nativeHostVersion || lastStatus.hostBridgeTransport)
      && (
        connectionPayload.nativeHostVersion !== lastStatus.nativeHostVersion
        || connectionPayload.hostBridgeTransport !== lastStatus.hostBridgeTransport
      )
    ) {
      data = await bridgeRequest("extension.connect", {
        ...connectionPayload,
        clientId: String(data.clientId || config.clientId || ""),
        nativeHostVersion: lastStatus.nativeHostVersion,
        hostBridgeTransport: lastStatus.hostBridgeTransport,
      }, config);
    }
    const clientId = String(data.clientId || config.clientId || "");
    await storageSet({ clientId });
    lastConnectAt = now;
    lastStatus = {
      ...lastStatus,
      connected: true,
      bridgeUrl: config.bridgeUrl,
      clientId,
      extensionId,
      extensionName,
      extensionVersion: manifest.version,
      supportedActions: SUPPORTED_ACTIONS,
      lastError: "",
    };
  } catch (error) {
    lastStatus = {
      ...lastStatus,
      connected: false,
      bridgeUrl: config.bridgeUrl,
      lastError: String(error?.message || error),
    };
  } finally {
    connecting = false;
  }
}

async function activeTab() {
  const tabs = await chromeCall(chrome.tabs.query, { active: true, currentWindow: true });
  if (tabs?.[0]?.id != null) return tabs[0];
  const fallback = await chromeCall(chrome.tabs.query, { active: true, lastFocusedWindow: true });
  if (fallback?.[0]?.id != null) return fallback[0];
  throw new Error("No active tab");
}

async function resolveTab(tabId) {
  if (Number.isFinite(Number(tabId))) {
    return chromeCall(chrome.tabs.get, Number(tabId));
  }
  return activeTab();
}

async function inject(tabId, func, args = [], world = "ISOLATED") {
  const [execution] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args,
    world,
  });
  if (execution?.error) {
    const message = typeof execution.error === "string"
      ? execution.error
      : execution.error.message || JSON.stringify(execution.error);
    throw new Error(message || "Injected page operation failed");
  }
  const value = execution?.result;
  if (value && typeof value === "object" && typeof value.__wodeappxError === "string") {
    throw new Error(value.__wodeappxError);
  }
  return value;
}

function commandLabel(action) {
  return ACTION_LABELS[action] || "浏览器操作";
}

async function setActionBadge(text, color, title) {
  if (badgeClearTimer) {
    clearTimeout(badgeClearTimer);
    badgeClearTimer = null;
  }
  try {
    await chrome.action.setBadgeText({ text });
    if (color) await chrome.action.setBadgeBackgroundColor({ color });
    if (title) await chrome.action.setTitle({ title });
  } catch {
    // Badge updates are best effort; browser control should keep working.
  }
}

function clearActionBadgeSoon(delay = CONTROL_NOTICE_TTL_MS) {
  if (badgeClearTimer) clearTimeout(badgeClearTimer);
  badgeClearTimer = setTimeout(() => {
    badgeClearTimer = null;
    void setActionBadge("", "#1769e0", "WodeAppX Browser Control");
  }, delay);
}

async function tabIdForNotice(action, args = {}) {
  if (action === "tabs.open" && args.newTab !== false && !args.tabId) return null;
  if (action === "tabs.list" || action === "tabs.navigate") return null;
  const tab = await resolveTab(args.tabId);
  if (tab?.status !== "complete") return null;
  return tab?.id ?? null;
}

async function showPageControlNotice(tabId, label, state = "running", ttlMs = CONTROL_NOTICE_TTL_MS) {
  if (!Number.isFinite(Number(tabId))) return;
  try {
    await inject(Number(tabId), (payload) => {
      const rootId = "wodeappx-browser-control-indicator";
      const timerKey = "__wodeappxBrowserControlIndicatorTimer";
      const existing = document.getElementById(rootId);
      const root = existing || document.createElement("div");
      root.id = rootId;
      root.setAttribute("role", "status");
      root.setAttribute("aria-live", "polite");

      const running = payload.state === "running";
      const error = payload.state === "error";
      const message = running
        ? `WodeAppX 正在控制浏览器：${payload.label}`
        : error
          ? `WodeAppX 浏览器操作失败：${payload.label}`
          : `WodeAppX 浏览器操作完成：${payload.label}`;

      root.textContent = message;
      Object.assign(root.style, {
        position: "fixed",
        top: "14px",
        right: "14px",
        zIndex: "2147483647",
        boxSizing: "border-box",
        maxWidth: "min(360px, calc(100vw - 28px))",
        padding: "10px 12px",
        borderRadius: "8px",
        border: error ? "1px solid #fecaca" : "1px solid #bfdbfe",
        background: error ? "#7f1d1d" : running ? "#123a63" : "#14532d",
        color: "#ffffff",
        boxShadow: "0 12px 32px rgba(15, 23, 42, 0.24)",
        fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        fontSize: "13px",
        fontWeight: "650",
        lineHeight: "1.35",
        letterSpacing: "0",
        pointerEvents: "none",
        wordBreak: "break-word",
      });

      if (!existing) document.documentElement.appendChild(root);
      if (window[timerKey]) clearTimeout(window[timerKey]);
      if (!running) {
        window[timerKey] = setTimeout(() => {
          document.getElementById(rootId)?.remove();
          window[timerKey] = null;
        }, payload.ttlMs);
      }
    }, [{ label, state, ttlMs }]);
  } catch {
    // Some pages, such as chrome:// URLs, do not allow script injection.
  }
}

function debuggerErrorMessage(error) {
  return String(error?.message || error || "");
}

function isDebuggerOccupiedError(error) {
  const message = debuggerErrorMessage(error);
  return DEBUGGER_OCCUPIED_RE.test(message)
    || message.includes("BROWSER_DEBUGGER_OCCUPIED")
    || message.includes("BROWSER_DEBUGGER_ATTACH_TIMEOUT");
}

function debuggerOccupiedError() {
  return new Error("BROWSER_DEBUGGER_OCCUPIED: 该标签页已被其他调试器占用（例如 ChatGPT）。请先结束对方的调试后再试。");
}

function debuggerAttachTimeoutError() {
  return new Error("BROWSER_DEBUGGER_ATTACH_TIMEOUT: 附加调试器超时。该标签页可能已被其他调试器占用，请先结束对方的调试后再试。");
}

function withTimeout(promise, ms, createTimeoutError) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(createTimeoutError()), ms);
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function attachNativeDebugNotice(tabId, { required = false } = {}) {
  const id = Number(tabId);
  if (!Number.isFinite(id) || !chrome.debugger?.attach) {
    if (required) throw new Error("Chrome debugger attach failed for this tab");
    return null;
  }

  const existing = nativeDebugSessions.get(id);
  if (existing?.attached) {
    if (existing.detachTimer) clearTimeout(existing.detachTimer);
    existing.count += 1;
    existing.detachTimer = null;
    return id;
  }

  try {
    await withTimeout(
      chrome.debugger.attach({ tabId: id }, "1.3"),
      DEBUGGER_ATTACH_TIMEOUT_MS,
      debuggerAttachTimeoutError,
    );
    nativeDebugSessions.set(id, { attached: true, count: 1, detachTimer: null });
    lastStatus = { ...lastStatus, nativeDebugAttached: true };
    return id;
  } catch (error) {
    const timeout = debuggerErrorMessage(error).includes("BROWSER_DEBUGGER_ATTACH_TIMEOUT");
    const occupied = timeout || isDebuggerOccupiedError(error);
    if (timeout) {
      try {
        await chrome.debugger.detach({ tabId: id });
      } catch {
        // Attach may have completed after the timeout; detach so we do not leak it.
      }
    }
    const classified = timeout ? error : occupied ? debuggerOccupiedError() : error;
    lastStatus = {
      ...lastStatus,
      lastError: debuggerErrorMessage(classified),
      nativeDebugAttached: false,
    };
    if (occupied || required) throw classified;
    return null;
  }
}

async function ensureDebuggerAttached(tabId) {
  const id = Number(tabId);
  if (Number.isFinite(id) && nativeDebugSessions.get(id)?.attached) {
    return id;
  }
  const attached = await attachNativeDebugNotice(tabId, { required: true });
  if (!attached) throw new Error("Chrome debugger attach failed for this tab");
  return attached;
}

async function debuggerSendCommand(tabId, method, params = {}) {
  const id = await ensureDebuggerAttached(tabId);
  return chromeCall(chrome.debugger.sendCommand, { tabId: id }, method, params || {});
}

async function detachNativeDebugNotice(tabId) {
  const id = Number(tabId);
  if (!Number.isFinite(id)) return;
  const session = nativeDebugSessions.get(id);
  if (!session?.attached) return;

  try {
    await chrome.debugger.detach({ tabId: id });
  } catch {
    // The user, DevTools, or Chrome may have already detached this tab.
  } finally {
    nativeDebugSessions.delete(id);
    lastStatus = { ...lastStatus, nativeDebugAttached: nativeDebugSessions.size > 0 };
  }
}

function releaseNativeDebugNotice(tabId, holdMs = NATIVE_DEBUG_NOTICE_HOLD_MS) {
  const id = Number(tabId);
  if (!Number.isFinite(id)) return;
  const session = nativeDebugSessions.get(id);
  if (!session?.attached) return;

  session.count = Math.max(0, session.count - 1);
  if (session.count > 0) return;
  if (session.detachTimer) clearTimeout(session.detachTimer);
  session.detachTimer = setTimeout(() => {
    void detachNativeDebugNotice(id);
  }, holdMs);
}

chrome.debugger?.onDetach?.addListener((source) => {
  if (source?.tabId != null) {
    nativeDebugSessions.delete(Number(source.tabId));
    lastStatus = { ...lastStatus, nativeDebugAttached: nativeDebugSessions.size > 0 };
  }
});

chrome.tabs?.onRemoved?.addListener((tabId) => {
  if (nativeDebugSessions.has(Number(tabId))) {
    void detachNativeDebugNotice(tabId);
  }
});

async function beginControlNotice(action, args = {}) {
  const label = commandLabel(action);
  activeCommandCount += 1;
  lastStatus = {
    ...lastStatus,
    currentCommand: label,
    currentCommandAction: action,
    currentCommandStartedAt: new Date().toISOString(),
  };
  await setActionBadge("RUN", "#1769e0", `WodeAppX 正在控制浏览器：${label}`);

  const tabId = await tabIdForNotice(action, args).catch(() => null);
  const debugTabId = tabId && DEBUGGER_ATTACH_ACTIONS.has(action)
    ? await attachNativeDebugNotice(tabId)
    : null;
  if (tabId && !NOTICE_SKIP_ACTIONS.has(action)) {
    await showPageControlNotice(tabId, label, "running", CONTROL_NOTICE_TTL_MS);
  }
  return { action, label, tabId, debugTabId };
}

function resultTabId(result) {
  return result?.tab?.id ?? result?.id ?? null;
}

async function finishControlNotice(notice, error, result) {
  const ok = !error;
  const tabId = resultTabId(result) ?? notice?.tabId ?? null;
  let debugTabId = notice?.debugTabId ?? null;
  const canDecorateResult = notice?.action !== "tabs.open"
    && notice?.action !== "tabs.navigate"
    && !NOTICE_SKIP_ACTIONS.has(notice?.action)
    && result?.tab?.status !== "loading"
    && result?.status !== "loading";
  if (!debugTabId && tabId && canDecorateResult && DEBUGGER_ATTACH_ACTIONS.has(notice?.action)) {
    debugTabId = await attachNativeDebugNotice(tabId);
  }
  if (tabId && canDecorateResult) {
    await showPageControlNotice(tabId, notice.label, ok ? "complete" : "error", ok ? CONTROL_NOTICE_TTL_MS : 4200);
  }
  if (debugTabId) releaseNativeDebugNotice(debugTabId, NATIVE_DEBUG_NOTICE_HOLD_MS);

  activeCommandCount = Math.max(0, activeCommandCount - 1);
  lastStatus = {
    ...lastStatus,
    currentCommand: activeCommandCount ? lastStatus.currentCommand : "",
    currentCommandAction: activeCommandCount ? lastStatus.currentCommandAction : "",
    currentCommandStartedAt: activeCommandCount ? lastStatus.currentCommandStartedAt : "",
  };

  if (activeCommandCount === 0) {
    await setActionBadge(ok ? "OK" : "ERR", ok ? "#16803c" : "#b42318", ok ? "WodeAppX 浏览器操作完成" : "WodeAppX 浏览器操作失败");
    clearActionBadgeSoon(ok ? CONTROL_NOTICE_TTL_MS : 4200);
  }
}

function summarizeTab(tab) {
  return {
    id: tab.id,
    windowId: tab.windowId,
    active: Boolean(tab.active),
    title: tab.title || "",
    url: tab.url || "",
    status: tab.status || "",
    favIconUrl: tab.favIconUrl || "",
  };
}

async function listTabs(args = {}) {
  const tabs = await chromeCall(chrome.tabs.query, args.activeOnly ? { active: true, currentWindow: true } : {});
  return tabs.map(summarizeTab);
}

async function openUrl(args = {}) {
  const url = String(args.url || "").trim();
  if (!url) throw new Error("url is required");
  if (args.newTab === false) {
    const tab = args.tabId ? await chromeCall(chrome.tabs.get, Number(args.tabId)) : await activeTab();
    const updated = await chromeCall(chrome.tabs.update, tab.id, { url, active: true });
    return summarizeTab(updated);
  }
  const tab = await chromeCall(chrome.tabs.create, { url, active: true });
  return summarizeTab(tab);
}

async function readPage(args = {}) {
  const tab = await resolveTab(args.tabId);
  const maxChars = Math.max(200, Math.min(50000, Number(args.maxChars || READ_PAGE_DEFAULT_MAX_CHARS)));
  const maxElements = Math.max(1, Math.min(READ_PAGE_MAX_ELEMENTS_CAP, Number(args.maxElements || READ_PAGE_DEFAULT_MAX_ELEMENTS)));
  const page = await inject(tab.id, (limit, elementLimit) => {
    const nodeAttribute = "data-wodeappx-node-id";
    for (const node of document.querySelectorAll(`[${nodeAttribute}]`)) {
      node.removeAttribute(nodeAttribute);
    }

    function compact(value, max = 160) {
      return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
    }

    function inViewport(rect) {
      return rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
    }

    function isVisible(element, viewportOnly) {
      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return false;
      if (viewportOnly && !inViewport(rect)) return false;
      const style = window.getComputedStyle(element);
      return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || 1) > 0;
    }

    function targetName(element) {
      const labelledBy = compact(element.getAttribute("aria-labelledby"));
      const labelledText = labelledBy
        ? labelledBy.split(/\s+/).map((id) => compact(document.getElementById(id)?.textContent)).filter(Boolean).join(" ")
        : "";
      const labelText = element.id
        ? compact(document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent)
        : "";
      return compact(
        element.getAttribute("aria-label")
        || labelledText
        || labelText
        || element.getAttribute("title")
        || element.getAttribute("alt")
        || element.getAttribute("placeholder")
        || element.innerText
        || (element.type === "password" ? "" : element.value),
      );
    }

    function uniqueSelector(element) {
      const candidates = [];
      const id = element.getAttribute("id");
      const testId = element.getAttribute("data-testid");
      const name = element.getAttribute("name");
      const aria = element.getAttribute("aria-label");
      if (id) candidates.push(`#${CSS.escape(id)}`);
      if (testId) candidates.push(`[data-testid="${CSS.escape(testId)}"]`);
      if (name) candidates.push(`${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`);
      if (aria) candidates.push(`[aria-label="${CSS.escape(aria)}"]`);
      for (const selector of candidates) {
        try {
          if (document.querySelectorAll(selector).length === 1) return selector;
        } catch {
          // Ignore invalid page-provided attribute values.
        }
      }
      return null;
    }

    function pageText(max) {
      const full = String(document.body?.innerText || document.documentElement?.innerText || "")
        .replace(/\s+/g, " ")
        .trim();
      return { text: full.slice(0, max), truncated: full.length > max };
    }

    const snapshotId = `wxa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const targetSelector = [
      "a[href]",
      "button",
      "input",
      "textarea",
      "select",
      "summary",
      "[contenteditable='true']",
      "[role='button']",
      "[role='link']",
      "[role='checkbox']",
      "[role='radio']",
      "[role='switch']",
      "[role='tab']",
      "[role='menuitem']",
      "[role='option']",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
    const seen = new Set();
    const interactiveElements = [];

    function addInteractive(viewportOnly) {
      for (const element of document.querySelectorAll(targetSelector)) {
        if (interactiveElements.length >= elementLimit) return;
        if (seen.has(element) || !isVisible(element, viewportOnly)) continue;
        seen.add(element);
        const nodeId = `${snapshotId}-${interactiveElements.length + 1}`;
        element.setAttribute(nodeAttribute, nodeId);
        const rect = element.getBoundingClientRect();
        const type = compact(element.getAttribute("type"), 48);
        const password = type.toLowerCase() === "password";
        const name = targetName(element);
        const text = compact(element.innerText, 240);
        interactiveElements.push({
          nodeId,
          tag: element.tagName.toLowerCase(),
          role: compact(element.getAttribute("role") || element.tagName.toLowerCase(), 32),
          type: type || undefined,
          name,
          text,
          value: password ? undefined : compact(element.value, 240) || undefined,
          placeholder: compact(element.getAttribute("placeholder"), 160) || undefined,
          href: element.tagName === "A" ? compact(element.getAttribute("href"), 400) || undefined : undefined,
          selector: uniqueSelector(element) || undefined,
          checked: typeof element.checked === "boolean" ? element.checked : undefined,
          disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        });
      }
    }

    addInteractive(true);
    if (interactiveElements.length < elementLimit) addInteractive(false);

    const selectedText = String(window.getSelection?.() || "");
    const visible = pageText(limit);
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,h4"))
      .slice(0, 40)
      .map((node) => node.textContent?.trim())
      .filter(Boolean);
    return {
      title: document.title,
      url: location.href,
      selectedText,
      headings,
      text: visible.text,
      textLength: visible.text.length,
      textTruncated: visible.truncated,
      snapshotId,
      interactiveElements,
      interactiveElementCount: interactiveElements.length,
      interactiveElementsTruncated: interactiveElements.length >= elementLimit,
      viewportOnly: false,
      activeElementNodeId: document.activeElement?.getAttribute?.(nodeAttribute) || null,
    };
  }, [maxChars, maxElements]);
  return { tab: summarizeTab(tab), page };
}

async function clickPage(args = {}) {
  const tab = await resolveTab(args.tabId);
  const result = await inject(tab.id, (payload) => {
    try {
    const nodeAttribute = "data-wodeappx-node-id";
    const compact = (value, max = 160) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    }

    function label(el) {
      return compact(el.getAttribute("aria-label") || el.innerText || el.value || el.getAttribute("title"));
    }

    let matches = [];
    let targetDescription = "";
    if (payload.nodeId) {
      targetDescription = `nodeId ${payload.nodeId}`;
      matches = Array.from(document.querySelectorAll(`[${nodeAttribute}="${CSS.escape(String(payload.nodeId))}"]`));
    } else if (payload.selector) {
      targetDescription = `selector ${payload.selector}`;
      try {
        matches = Array.from(document.querySelectorAll(payload.selector));
      } catch {
        throw new Error(`TARGET_SELECTOR_INVALID: ${payload.selector}`);
      }
    } else {
      const needle = compact(payload.text).toLocaleLowerCase();
      targetDescription = `exact text ${payload.text}`;
      const candidates = Array.from(document.querySelectorAll(
        "button,a[href],input,textarea,select,summary,[role='button'],[role='link'],[role='tab'],[role='menuitem'],[tabindex]:not([tabindex='-1'])",
      ));
      matches = candidates.filter((el) => isVisible(el) && label(el).toLocaleLowerCase() === needle);
    }
    matches = matches.filter(isVisible);
    if (matches.length === 0) {
      throw new Error(`TARGET_NOT_FOUND: no visible element matches ${targetDescription}; refresh read_page and choose a current nodeId`);
    }
    if (matches.length !== 1) {
      const candidates = matches.slice(0, 5).map((el) => `${el.tagName.toLowerCase()}:${label(el)}`).join(" | ");
      throw new Error(`TARGET_AMBIGUOUS: ${matches.length} visible elements match ${targetDescription}; candidates=${candidates}`);
    }
    const [el] = matches;
    el.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
    el.click();
    return {
      clicked: true,
      nodeId: el.getAttribute(nodeAttribute) || null,
      tagName: el.tagName,
      text: label(el),
    };
    } catch (error) {
      return { __wodeappxError: String(error?.message || error) };
    }
  }, [args]);
  return { tab: summarizeTab(tab), result };
}

async function typePage(args = {}) {
  const tab = await resolveTab(args.tabId);
  const result = await inject(tab.id, (payload) => {
    try {
    const nodeAttribute = "data-wodeappx-node-id";
    let matches = [];
    let targetDescription = "";
    if (payload.nodeId) {
      targetDescription = `nodeId ${payload.nodeId}`;
      matches = Array.from(document.querySelectorAll(`[${nodeAttribute}="${CSS.escape(String(payload.nodeId))}"]`));
    } else {
      targetDescription = `selector ${payload.selector}`;
      try {
        matches = Array.from(document.querySelectorAll(payload.selector));
      } catch {
        throw new Error(`TARGET_SELECTOR_INVALID: ${payload.selector}`);
      }
    }
    if (matches.length === 0) {
      throw new Error(`TARGET_NOT_FOUND: no element matches ${targetDescription}; refresh read_page and choose a current nodeId`);
    }
    if (matches.length !== 1) {
      throw new Error(`TARGET_AMBIGUOUS: ${matches.length} elements match ${targetDescription}; use one current nodeId`);
    }
    const [el] = matches;
    el.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
    el.focus();
    const text = String(payload.text ?? "");
    const replace = payload.replace !== false;
    if (el.isContentEditable) {
      if (replace) el.textContent = text;
      else el.textContent = `${el.textContent || ""}${text}`;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    } else if ("value" in el) {
      const nextValue = replace ? text : `${el.value || ""}${text}`;
      const prototype = el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(el, nextValue);
      else el.value = nextValue;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      throw new Error("Element is not editable");
    }
    return {
      typed: true,
      nodeId: el.getAttribute(nodeAttribute) || null,
      selector: payload.selector || null,
      length: text.length,
      valueLength: "value" in el ? String(el.value || "").length : String(el.textContent || "").length,
    };
    } catch (error) {
      return { __wodeappxError: String(error?.message || error) };
    }
  }, [args]);
  if (args.pressEnter) {
    result.enterMode = await dispatchRealKey(tab.id, "Enter");
  }
  return { tab: summarizeTab(tab), result };
}

function keyDescriptor(key) {
  const named = {
    Enter: { code: "Enter", keyCode: 13 },
    Escape: { code: "Escape", keyCode: 27 },
    Tab: { code: "Tab", keyCode: 9 },
    ArrowUp: { code: "ArrowUp", keyCode: 38 },
    ArrowDown: { code: "ArrowDown", keyCode: 40 },
    ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
    ArrowRight: { code: "ArrowRight", keyCode: 39 },
    Backspace: { code: "Backspace", keyCode: 8 },
    Delete: { code: "Delete", keyCode: 46 },
  };
  if (named[key]) return { key, ...named[key] };
  if (key.length === 1) {
    const upper = key.toUpperCase();
    return { key, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: key };
  }
  return { key, code: key, keyCode: 0 };
}

async function dispatchRealKey(tabId, key) {
  const descriptor = keyDescriptor(key);
  for (const type of ["keyDown", "keyUp"]) {
    await debuggerSendCommand(tabId, "Input.dispatchKeyEvent", {
      type,
      key: descriptor.key,
      code: descriptor.code,
      text: type === "keyDown" ? descriptor.text : undefined,
      windowsVirtualKeyCode: descriptor.keyCode,
      nativeVirtualKeyCode: descriptor.keyCode,
    });
  }
  return "cdp";
}

async function keyPage(args = {}) {
  const tab = await resolveTab(args.tabId);
  const key = String(args.key || "");
  if (!key) throw new Error("key is required");

  if (args.nodeId || args.selector) {
    await inject(tab.id, (payload) => {
      try {
      const nodeAttribute = "data-wodeappx-node-id";
      let matches = [];
      if (payload.nodeId) {
        matches = Array.from(document.querySelectorAll(`[${nodeAttribute}="${CSS.escape(String(payload.nodeId))}"]`));
      } else {
        try {
          matches = Array.from(document.querySelectorAll(payload.selector));
        } catch {
          throw new Error(`TARGET_SELECTOR_INVALID: ${payload.selector}`);
        }
      }
      if (matches.length === 0) throw new Error("TARGET_NOT_FOUND: refresh read_page and choose a current nodeId");
      if (matches.length !== 1) throw new Error(`TARGET_AMBIGUOUS: ${matches.length} elements matched`);
      const [el] = matches;
      el.focus();
      return true;
      } catch (error) {
        return { __wodeappxError: String(error?.message || error) };
      }
    }, [{ nodeId: args.nodeId, selector: args.selector }]);
  }

  // Prefer real CDP key events (Codex-style). Fall back to DOM KeyboardEvent.
  try {
    await dispatchRealKey(tab.id, key);
    return { tab: summarizeTab(tab), result: { sent: true, key, mode: "cdp" } };
  } catch {
    const result = await inject(tab.id, (payload) => {
      const el = document.activeElement;
      if (!el) throw new Error("No target element");
      for (const type of ["keydown", "keypress", "keyup"]) {
        el.dispatchEvent(new KeyboardEvent(type, { key: payload.key, code: payload.key, bubbles: true, cancelable: true }));
      }
      return { sent: true, key: payload.key, tagName: el.tagName, mode: "dom" };
    }, [{ key }]);
    return { tab: summarizeTab(tab), result };
  }
}

async function evalPage(args = {}) {
  const tab = await resolveTab(args.tabId);
  const result = await inject(tab.id, async (code) => {
    try {
    function clean(value) {
      if (value == null) return value;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return String(value);
      }
    }
    const value = await (0, eval)(code);
    return clean(value);
    } catch (error) {
      return { __wodeappxError: String(error?.message || error) };
    }
  }, [String(args.code || "")], "MAIN");
  return { tab: summarizeTab(tab), result };
}

async function screenshotPage(args = {}) {
  const tab = await resolveTab(args.tabId);
  await chromeCall(chrome.tabs.update, tab.id, { active: true });
  await new Promise((resolve) => setTimeout(resolve, 200));

  // Prefer CDP Page.captureScreenshot when debugger is available.
  try {
    const result = await debuggerSendCommand(tab.id, "Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    });
    if (result?.data) {
      return {
        tab: summarizeTab(tab),
        dataUrl: `data:image/png;base64,${result.data}`,
        mode: "cdp",
      };
    }
  } catch {
    // Fall through to captureVisibleTab.
  }

  const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  return { tab: summarizeTab(tab), dataUrl, mode: "tabs" };
}

async function cdpPage(args = {}) {
  const tab = await resolveTab(args.tabId);
  const uploadFiles = Array.isArray(args.uploadFiles)
    ? args.uploadFiles.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (uploadFiles.length) {
    await debuggerSendCommand(tab.id, "DOM.enable");
    const doc = await debuggerSendCommand(tab.id, "DOM.getDocument", { depth: 0, pierce: true });
    const rootId = doc?.root?.nodeId;
    if (!rootId) throw new Error("DOM.getDocument did not return a root node");
    const selector = String(args.selector || 'input[type="file"][accept*="image/jpeg"]').trim();
    const found = await debuggerSendCommand(tab.id, "DOM.querySelector", { nodeId: rootId, selector });
    if (!found?.nodeId) throw new Error(`file input not found: ${selector}`);
    await debuggerSendCommand(tab.id, "DOM.setFileInputFiles", {
      nodeId: found.nodeId,
      files: uploadFiles,
    });
    return {
      tab: summarizeTab(tab),
      method: "DOM.setFileInputFiles",
      result: { ok: true, nodeId: found.nodeId, files: uploadFiles.length },
      mode: "cdp",
    };
  }

  const batched = Array.isArray(args.commands) ? args.commands.filter((item) => item && typeof item === "object") : [];
  const commands = batched.length
    ? batched
    : [{ method: String(args.method || "").trim(), params: args.params }];
  if (!String(commands[0]?.method || "").trim()) throw new Error("method is required");

  const results = [];
  for (const command of commands) {
    const method = String(command.method || "").trim();
    if (!method) throw new Error("method is required");
    const params = command.params && typeof command.params === "object" ? command.params : {};
    const result = await debuggerSendCommand(tab.id, method, params);
    results.push({ method, result });
  }

  return {
    tab: summarizeTab(tab),
    method: results[0].method,
    result: results.length === 1 ? results[0].result : results,
    results,
    mode: "cdp",
  };
}

function normalizeStepAction(step) {
  const raw = String(step?.do || step?.action || "").trim();
  const mapped = {
    open_url: "tabs.open",
    tabs: "tabs.list",
    read_page: "page.read",
    click: "page.click",
    type: "page.type",
    key: "page.key",
    eval: "page.eval",
    screenshot: "page.screenshot",
    cdp: "page.cdp",
    navigate: "tabs.navigate",
    run: "page.run",
  };
  return mapped[raw] || raw;
}

async function executeAction(action, args = {}) {
  switch (action) {
    case "tabs.list":
      return listTabs(args);
    case "tabs.open":
      return openUrl(args);
    case "tabs.navigate":
      return openUrl({ ...args, newTab: false });
    case "page.read":
      return readPage(args);
    case "page.click":
      return clickPage(args);
    case "page.type":
      return typePage(args);
    case "page.key":
      return keyPage(args);
    case "page.eval":
      return evalPage(args);
    case "page.screenshot":
      return screenshotPage(args);
    case "page.cdp":
      return cdpPage(args);
    default:
      throw new Error(`Unknown browser action: ${action}`);
  }
}

async function runSteps(args = {}) {
  const steps = Array.isArray(args.steps) ? args.steps.filter((step) => step && typeof step === "object") : [];
  if (!steps.length) throw new Error("steps is required");
  if (steps.length > 16) throw new Error("at most 16 steps");
  const results = [];
  let tabId = args.tabId;
  let lastRead = null;
  for (const step of steps) {
    const action = normalizeStepAction(step);
    if (!action || action === "page.run") throw new Error("invalid step action");
    const stepArgs = { ...(step.args && typeof step.args === "object" ? step.args : step) };
    delete stepArgs.do;
    delete stepArgs.action;
    delete stepArgs.args;
    delete stepArgs.steps;
    if (tabId != null && stepArgs.tabId == null) stepArgs.tabId = tabId;
    try {
      const result = await executeAction(action, stepArgs);
      results.push({ ok: true, action, result });
      const nextId = result?.tab?.id ?? result?.id ?? tabId;
      if (Number.isFinite(Number(nextId))) tabId = Number(nextId);
      if (action === "page.read") lastRead = result;
    } catch (error) {
      results.push({ ok: false, action, error: String(error?.message || error) });
      return { ok: false, tabId, steps: results, page: lastRead };
    }
  }
  return { ok: true, tabId, steps: results, page: lastRead };
}

async function runCommand(command) {
  const action = command?.action;
  const args = command?.args || {};
  if (NOTICE_SKIP_ACTIONS.has(action)) {
    return executeAction(action, args);
  }
  const notice = await beginControlNotice(action, args);
  try {
    let result;
    switch (action) {
      case "page.run":
        result = await runSteps(args);
        break;
      default:
        result = await executeAction(action, args);
        break;
    }
    await finishControlNotice(notice, null, result);
    return result;
  } catch (error) {
    await finishControlNotice(notice, error, null);
    throw error;
  }
}

async function pollOnce() {
  if (pollInFlight) return false;
  pollInFlight = true;
  try {
  const config = await getConfig();
  if (!config.bridgeUrl) return false;
  await connectBridge(false);
  const latest = await getConfig();
  if (!latest.clientId) return false;

  const data = await bridgeRequest("extension.command", {
    clientId: latest.clientId,
    token: latest.bridgeToken,
    waitMs: String(COMMAND_WAIT_MS),
  }, latest);
  if (!data?.ok) throw new Error(data?.error || "WodeAppX browser command polling failed");
  const command = data.command;
  if (!command) return false;

  lastStatus = { ...lastStatus, lastCommandAt: new Date().toISOString() };
  try {
    const result = await runCommand(command);
    await bridgeRequest("extension.result", {
      token: latest.bridgeToken,
      clientId: latest.clientId,
      commandId: command.id,
      ok: true,
      result,
    }, latest);
    lastStatus = { ...lastStatus, lastResultAt: new Date().toISOString(), lastError: "" };
  } catch (error) {
    await bridgeRequest("extension.result", {
      token: latest.bridgeToken,
      clientId: latest.clientId,
      commandId: command.id,
      ok: false,
      error: String(error?.message || error),
    }, latest);
    lastStatus = { ...lastStatus, lastResultAt: new Date().toISOString(), lastError: String(error?.message || error) };
  }
  return true;
  } finally {
    pollInFlight = false;
  }
}

function schedulePoll(delay = POLL_DELAY_MS) {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    let hadCommand = false;
    try {
      hadCommand = Boolean(await pollOnce());
    } catch (error) {
      lastStatus = { ...lastStatus, connected: false, lastError: String(error?.message || error) };
    } finally {
      schedulePoll(hadCommand ? 0 : POLL_DELAY_MS);
    }
  }, delay);
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
  void storageGet({ bridgeUrl: "", bridgeToken: "" }).then((stored) => {
    const updates = {};
    if (!stored.bridgeUrl) updates.bridgeUrl = DEFAULT_BRIDGE_URL;
    if (Object.keys(updates).length) return storageSet(updates);
    return null;
  });
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});

void chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});

chrome.alarms.create("wodeappx-browser-poll", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "wodeappx-browser-poll") {
    void pollOnce().catch((error) => {
      lastStatus = { ...lastStatus, connected: false, lastError: String(error?.message || error) };
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    if (message?.type === "getStatus") {
      const config = await getConfig();
      let chatReady = false;
      try {
        const health = await readBridgeHealth(config);
        chatReady = Boolean(health.chatReady);
      } catch {
        chatReady = false;
      }
      return { ok: true, status: { ...lastStatus, chatReady, bridgeUrl: config.bridgeUrl, clientId: config.clientId } };
    }
    if (message?.type === "saveConfig") {
      const bridgeUrl = normalizeBridgeUrl(message.bridgeUrl);
      const bridgeToken = String(message.bridgeToken || "");
      await storageSet({ bridgeUrl, bridgeToken, clientId: "" });
      lastConnectAt = 0;
      await connectBridge(true);
      const config = await getConfig();
      return { ok: true, status: { ...lastStatus, bridgeUrl: config.bridgeUrl, clientId: config.clientId } };
    }
    if (message?.type === "connectNow") {
      await connectBridge(true);
      const config = await getConfig();
      return { ok: true, status: { ...lastStatus, bridgeUrl: config.bridgeUrl, clientId: config.clientId } };
    }
    if (message?.type === "getActiveTab") {
      return { ok: true, target: await sidePanelTarget() };
    }
    if (message?.type === "sidePanelChat") {
      return { ok: true, data: await sendSidePanelPrompt(message) };
    }
    return { ok: false, error: "Unknown message" };
  })()
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});

schedulePoll(50);
