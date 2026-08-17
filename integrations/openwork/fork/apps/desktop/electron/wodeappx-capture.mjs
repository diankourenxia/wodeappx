import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { dirname, join } from "node:path";
import { shell } from "electron";

const MAX_CAPTURE_ITEMS = 300;
const SYSTEM_PROXY_HOST = "127.0.0.1";
const SYSTEM_PROXY_PORT = 8899;
const SYSTEM_PROXY_CA_URL = "http://mitm.it";
const SYSTEM_PROXY_SETUP_HINT = `我的AppX 会自动把系统 HTTP/HTTPS 代理切到 ${SYSTEM_PROXY_HOST}:${SYSTEM_PROXY_PORT}，停止监听或退出应用时自动恢复。首次抓 HTTPS 完整地址时会打开本机 CA 授权入口。`;
const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
const VIDEO_EXTENSIONS = new Set(["avi", "m3u8", "m4v", "mkv", "mov", "mp4", "mpd", "ogg", "ogv", "ts", "webm"]);
const AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "oga", "ogg", "opus", "wav", "weba"]);
const NETWORKSETUP = "/usr/sbin/networksetup";

const MITMPROXY_ADDON = `
import json
from mitmproxy import http

def _headers(headers):
    result = {}
    for key, value in headers.items(multi=True):
        result.setdefault(key, []).append(value)
    return result

def responseheaders(flow: http.HTTPFlow):
    if flow.response is None:
        return
    item = {
        "url": flow.request.pretty_url,
        "method": flow.request.method,
        "statusCode": flow.response.status_code,
        "responseHeaders": _headers(flow.response.headers),
        "referrer": flow.request.headers.get("referer") or flow.request.headers.get("referrer"),
    }
    print(json.dumps(item, ensure_ascii=False), flush=True)
`;

function normalizeHeaderValue(value) {
  if (Array.isArray(value)) return value.join(", ");
  return value || "";
}

function getHeader(headers, name) {
  if (!headers) return "";
  const wanted = name.toLowerCase();
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === wanted);
  return key ? normalizeHeaderValue(headers[key]) : "";
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseFilenameFromDisposition(disposition) {
  const utf8Match = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) return safeDecode(utf8Match[1].trim().replace(/^"|"$/g, ""));
  const asciiMatch = disposition.match(/filename="?([^";]+)"?/i);
  return asciiMatch?.[1] ? safeDecode(asciiMatch[1].trim()) : "";
}

function parseUrl(rawUrl, disposition) {
  try {
    const parsed = new URL(rawUrl);
    const pathname = safeDecode(parsed.pathname || "/");
    const fromHeader = parseFilenameFromDisposition(disposition);
    const fromPath = pathname.split("/").filter(Boolean).pop() || parsed.hostname;
    const filename = fromHeader || fromPath;
    const extension = filename.includes(".")
      ? filename.split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "")
      : "";
    return {
      host: parsed.hostname,
      path: `${pathname}${parsed.search ? "?" : ""}`,
      filename,
      extension,
    };
  } catch {
    return null;
  }
}

function parseSizeBytes(headers) {
  const contentLength = Number.parseInt(getHeader(headers, "content-length"), 10);
  if (Number.isFinite(contentLength) && contentLength > 0) return contentLength;

  const range = getHeader(headers, "content-range");
  const total = Number.parseInt(range.split("/").pop() || "", 10);
  return Number.isFinite(total) && total > 0 ? total : undefined;
}

function classifyResource(details, mime, extension) {
  const contentType = mime.toLowerCase();
  if (contentType.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) return "image";
  if (
    contentType.startsWith("video/")
    || contentType.includes("mpegurl")
    || contentType.includes("dash+xml")
    || VIDEO_EXTENSIONS.has(extension)
  ) {
    return "video";
  }
  if (contentType.startsWith("audio/") || AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (contentType.includes("json") || extension === "json") return "json";
  return null;
}

function commandWorks(spec, args) {
  const result = spawnSync(spec.command, [...(spec.argsPrefix || []), ...args], {
    encoding: "utf8",
    timeout: 15000,
  });
  return !result.error && result.status === 0;
}

function runCommand(spec, args, timeout) {
  const result = spawnSync(spec.command, [...(spec.argsPrefix || []), ...args], {
    encoding: "utf8",
    timeout,
  });
  return {
    ok: !result.error && result.status === 0,
    output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
  };
}

function platformBinaryName(name) {
  return process.platform === "win32" ? `${name}.exe` : name;
}

function targetTriple() {
  if (process.platform === "darwin") {
    if (process.arch === "arm64") return "aarch64-apple-darwin";
    if (process.arch === "x64") return "x86_64-apple-darwin";
  }
  if (process.platform === "linux") {
    if (process.arch === "arm64") return "aarch64-unknown-linux-gnu";
    if (process.arch === "x64") return "x86_64-unknown-linux-gnu";
  }
  if (process.platform === "win32") {
    if (process.arch === "arm64") return "aarch64-pc-windows-msvc";
    if (process.arch === "x64") return "x86_64-pc-windows-msvc";
  }
  return null;
}

function normalizeExecutable(filePath) {
  if (process.platform !== "win32") {
    try {
      chmodSync(filePath, 0o755);
    } catch {
      // Best effort; spawn will report the executable error if this fails.
    }
  }
  return filePath;
}

function resolvePythonCommand() {
  const candidates = process.platform === "win32"
    ? [{ command: "py", argsPrefix: ["-3"] }, { command: "python" }, { command: "python3" }]
    : [{ command: "python3" }, { command: "python" }];
  return candidates.find((candidate) => commandWorks(candidate, ["--version"])) || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFile(filePath, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(filePath)) return true;
    await sleep(250);
  }
  return existsSync(filePath);
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}

async function waitForTcpPort(host, port, timeoutMs, isAlive) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isAlive()) return false;
    if (await canConnect(host, port)) return true;
    await sleep(250);
  }
  return false;
}

function runNetworkSetup(args, timeout = 15000) {
  const result = spawnSync(NETWORKSETUP, args, { encoding: "utf8", timeout });
  return {
    ok: !result.error && result.status === 0,
    output: `${result.stdout || ""}${result.stderr || ""}`.trim(),
  };
}

function parseMacProxyState(output) {
  return {
    enabled: /Enabled:\s*Yes/i.test(output),
    server: output.match(/Server:\s*(.*)/i)?.[1]?.trim() || "",
    port: output.match(/Port:\s*(.*)/i)?.[1]?.trim() || "",
  };
}

function parseScutilProxyState(output, prefix) {
  return {
    enabled: new RegExp(`${prefix}Enable\\s*:\\s*1`, "i").test(output),
    server: output.match(new RegExp(`${prefix}Proxy\\s*:\\s*(.*)`, "i"))?.[1]?.trim() || "",
    port: output.match(new RegExp(`${prefix}Port\\s*:\\s*(.*)`, "i"))?.[1]?.trim() || "",
  };
}

function readEffectiveSystemProxySettings() {
  if (process.platform !== "darwin") return null;
  const result = spawnSync("/usr/sbin/scutil", ["--proxy"], { encoding: "utf8", timeout: 15000 });
  if (result.error || result.status !== 0) return null;
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  return {
    web: parseScutilProxyState(output, "HTTP"),
    secure: parseScutilProxyState(output, "HTTPS"),
  };
}

function proxyEndpointMatches(endpoint, host, port) {
  return endpoint?.enabled && endpoint.server === host && endpoint.port === String(port);
}

function effectiveProxyMatches(host, port) {
  const effective = readEffectiveSystemProxySettings();
  if (!effective) return true;
  return proxyEndpointMatches(effective.web, host, port) && proxyEndpointMatches(effective.secure, host, port);
}

function formatEffectiveProxy(effective) {
  if (!effective) return "未知";
  const web = effective.web.enabled ? `${effective.web.server || "-"}:${effective.web.port || "-"}` : "未启用";
  const secure = effective.secure.enabled ? `${effective.secure.server || "-"}:${effective.secure.port || "-"}` : "未启用";
  return `HTTP ${web} / HTTPS ${secure}`;
}

function listMacNetworkServices() {
  const result = runNetworkSetup(["-listallnetworkservices"]);
  if (!result.ok) return [];
  return result.output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("An asterisk") && !line.startsWith("*"));
}

function readMacServiceState(service) {
  return {
    service,
    web: parseMacProxyState(runNetworkSetup(["-getwebproxy", service]).output),
    secure: parseMacProxyState(runNetworkSetup(["-getsecurewebproxy", service]).output),
  };
}

function setMacProxy(service, type, endpoint) {
  const setCommand = type === "web" ? "-setwebproxy" : "-setsecurewebproxy";
  const stateCommand = type === "web" ? "-setwebproxystate" : "-setsecurewebproxystate";
  if (endpoint.enabled && endpoint.server && endpoint.port) {
    runNetworkSetup([setCommand, service, endpoint.server, endpoint.port]);
    runNetworkSetup([stateCommand, service, "on"]);
    return;
  }
  runNetworkSetup([stateCommand, service, "off"]);
}

export function createWodeAppXCaptureController({ app }) {
  let running = false;
  let captureError = undefined;
  let nextId = 1;
  let proxyProcess = null;
  let proxyStdout = "";
  let proxyApplied = false;
  let captureBackend = undefined;
  let captureBackendPath = undefined;
  let captureBackendVersion = undefined;
  let upstreamProxyUrl = undefined;
  const capturedByKey = new Map();

  function runtimeDir() {
    return join(app.getPath("userData"), "capture-runtime");
  }

  function captureEngineCaDir() {
    const dir = join(runtimeDir(), "capture-engine-ca");
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  function captureEngineCaCertPath() {
    return join(captureEngineCaDir(), "wodeappx-capture-ca.cer");
  }

  function activeCaCertPath() {
    return captureBackend === "wodeappx-capture-engine" ? captureEngineCaCertPath() : mitmproxyCaCertPath();
  }

  function resolveUpstreamProxyUrl() {
    const effective = readEffectiveSystemProxySettings();
    const endpoint = effective?.secure.enabled ? effective.secure : effective?.web.enabled ? effective.web : null;
    if (!endpoint?.server || !endpoint.port) return undefined;
    if (endpoint.server === SYSTEM_PROXY_HOST && endpoint.port === String(SYSTEM_PROXY_PORT)) return undefined;
    return `http://${endpoint.server}:${endpoint.port}`;
  }

  function restoreFile() {
    return join(runtimeDir(), "system-proxy-restore.json");
  }

  function mitmdumpVenvPath() {
    return join(
      runtimeDir(),
      "mitmproxy-venv",
      process.platform === "win32" ? "Scripts" : "bin",
      platformBinaryName("mitmdump"),
    );
  }

  function mitmproxyHome() {
    const dir = join(runtimeDir(), "mitmproxy-home");
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  function mitmproxyCaCertPath() {
    return join(mitmproxyHome(), "mitmproxy-ca-cert.cer");
  }

  function mitmproxyEnvironment() {
    return {
      ...process.env,
      MITMPROXY_HOME: mitmproxyHome(),
    };
  }

  function bundledMitmdumpCandidates() {
    const binary = platformBinaryName("mitmdump");
    const platformArch = `${process.platform}-${process.arch}`;
    return [
      join(process.resourcesPath || "", "capture", platformArch, binary),
      join(process.resourcesPath || "", "capture", binary),
      join(app.getAppPath(), "resources", "capture", platformArch, binary),
      join(app.getAppPath(), "resources", "capture", binary),
      mitmdumpVenvPath(),
    ].filter(Boolean);
  }

  function captureEngineCandidates() {
    const explicit = process.env.WODEAPPX_CAPTURE_ENGINE?.trim();
    const binary = platformBinaryName("wodeappx-capture-engine");
    const triple = targetTriple();
    const platformArch = `${process.platform}-${process.arch}`;
    const executableSuffix = process.platform === "win32" ? ".exe" : "";
    const names = [
      binary,
      triple ? `wodeappx-capture-engine-${triple}${executableSuffix}` : "",
      `wodeappx-capture-engine-${platformArch}${executableSuffix}`,
    ].filter(Boolean);
    const dirs = [
      process.resourcesPath ? join(process.resourcesPath, "sidecars") : "",
      process.resourcesPath ? join(process.resourcesPath, "capture-engine") : "",
      join(app.getAppPath(), "resources", "sidecars"),
      join(app.getAppPath(), "resources", "capture-engine"),
      join(app.getAppPath(), "..", "..", "capture-engine", "bin", platformArch),
      join(app.getAppPath(), "..", "..", "..", "..", "capture-engine", "bin", platformArch),
      join(process.cwd(), "resources", "sidecars"),
      join(process.cwd(), "..", "..", "capture-engine", "bin", platformArch),
      join(process.cwd(), "..", "..", "..", "..", "capture-engine", "bin", platformArch),
    ].filter(Boolean);
    const candidates = explicit ? [explicit] : [];
    for (const dir of dirs) {
      for (const name of names) candidates.push(join(dir, name));
    }
    return [...new Set(candidates)];
  }

  function resolveCaptureEngineCommand() {
    for (const candidate of captureEngineCandidates()) {
      if (!existsSync(candidate)) continue;
      const command = normalizeExecutable(candidate);
      if (!commandWorks({ command }, ["--version"])) continue;
      captureBackendPath = command;
      captureBackendVersion = runCommand({ command }, ["--version"], 15000).output;
      return { command };
    }
    return null;
  }

  function writeRestoreState(state) {
    mkdirSync(dirname(restoreFile()), { recursive: true });
    writeFileSync(restoreFile(), JSON.stringify(state, null, 2), "utf8");
  }

  function readRestoreState() {
    if (!existsSync(restoreFile())) return null;
    try {
      return JSON.parse(readFileSync(restoreFile(), "utf8"));
    } catch {
      return null;
    }
  }

  function applySystemProxySettings(host, port) {
    if (process.platform !== "darwin") {
      return {
        ok: false,
        changed: false,
        error: "当前版本仅支持在 macOS 自动设置系统代理。Windows 和 Linux 将在后续补齐。",
      };
    }

    const services = listMacNetworkServices();
    if (services.length === 0) return { ok: false, changed: false, error: "没有找到可配置的网络服务。" };

    if (!existsSync(restoreFile())) {
      writeRestoreState({
        platform: process.platform,
        savedAt: new Date().toISOString(),
        host,
        port,
        services: services.map(readMacServiceState),
      });
    }

    const errors = [];
    for (const service of services) {
      const web = runNetworkSetup(["-setwebproxy", service, host, String(port)]);
      const webState = runNetworkSetup(["-setwebproxystate", service, "on"]);
      const secure = runNetworkSetup(["-setsecurewebproxy", service, host, String(port)]);
      const secureState = runNetworkSetup(["-setsecurewebproxystate", service, "on"]);
      if (!web.ok || !webState.ok || !secure.ok || !secureState.ok) errors.push(service);
    }

    if (errors.length > 0) {
      restoreSystemProxySettings();
      return {
        ok: false,
        changed: false,
        error: `系统代理设置失败：${errors.join(", ")}。请确认 我的AppX 有权限修改网络设置。`,
        services,
      };
    }

    const effective = readEffectiveSystemProxySettings();
    if (!effectiveProxyMatches(host, port)) {
      restoreSystemProxySettings();
      return {
        ok: false,
        changed: false,
        effectiveMismatch: true,
        error: `系统代理已写入，但当前生效代理仍是 ${formatEffectiveProxy(effective)}。我的AppX 已进入兼容模式：采集代理继续运行在 ${host}:${port}，并会把经过它的流量转发到原代理；但当前真实流量仍直接进入 VPN/代理软件，所以列表可能为空。若要全系统抓取，请让当前 VPN/代理软件把 ${host}:${port} 作为前置代理。`,
        services,
        effective,
      };
    }
    return {
      ok: true,
      changed: true,
      message: `已自动把系统 HTTP/HTTPS 代理设置为 ${host}:${port}。`,
      services,
      effective,
    };
  }

  function restoreSystemProxySettings() {
    const state = readRestoreState();
    if (!state) return { ok: true, changed: false };

    if (state.platform !== process.platform || process.platform !== "darwin") {
      return {
        ok: false,
        changed: false,
        error: "代理恢复记录与当前系统不匹配，请手动检查系统代理设置。",
      };
    }

    const errors = [];
    for (const serviceState of state.services) {
      try {
        setMacProxy(serviceState.service, "web", serviceState.web);
        setMacProxy(serviceState.service, "secure", serviceState.secure);
      } catch {
        errors.push(serviceState.service);
      }
    }

    if (errors.length > 0) {
      return {
        ok: false,
        changed: false,
        error: `部分系统代理恢复失败：${errors.join(", ")}。请手动检查系统代理设置。`,
        services: state.services.map((service) => service.service),
      };
    }

    try {
      unlinkSync(restoreFile());
    } catch {
      // The proxy has been restored; the stale file can be overwritten next run.
    }

    return {
      ok: true,
      changed: true,
      message: "已恢复启动监听前的系统代理设置。",
      services: state.services.map((service) => service.service),
    };
  }

  function buildItem(details) {
    if (!details.url || details.statusCode < 200 || details.statusCode >= 400) return null;
    const responseHeaders = details.responseHeaders;
    const mime = getHeader(responseHeaders, "content-type").split(";")[0].trim().toLowerCase();
    const parsed = parseUrl(details.url, getHeader(responseHeaders, "content-disposition"));
    if (!parsed) return null;

    const kind = classifyResource(details, mime, parsed.extension);
    if (!kind) return null;

    const key = `${details.method}:${details.url}`;
    const previous = capturedByKey.get(key);
    return {
      id: previous?.id || `cap_${nextId++}`,
      source: "system-proxy",
      url: details.url,
      method: details.method || "GET",
      kind,
      host: parsed.host,
      path: parsed.path,
      filename: parsed.filename,
      mime: mime || kind,
      extension: parsed.extension,
      statusCode: details.statusCode,
      resourceType: details.resourceType || "system-proxy",
      sizeBytes: details.sizeBytes ?? parseSizeBytes(responseHeaders) ?? previous?.sizeBytes,
      referrer: details.referrer,
      requestHeaders: details.requestHeaders,
      capturedAt: Date.now(),
    };
  }

  function sortedItems() {
    return [...capturedByKey.values()].sort((a, b) => b.capturedAt - a.capturedAt);
  }

  function filteredItems(options = {}) {
    const kind = typeof options.kind === "string" ? options.kind : "";
    const limit = Number.isFinite(Number(options.limit))
      ? Math.max(1, Math.min(300, Number.parseInt(String(options.limit), 10)))
      : MAX_CAPTURE_ITEMS;
    const items = kind && kind !== "all" ? sortedItems().filter((item) => item.kind === kind) : sortedItems();
    return items.slice(0, limit);
  }

  function trimItems() {
    const items = sortedItems();
    if (items.length <= MAX_CAPTURE_ITEMS) return;
    const keepIds = new Set(items.slice(0, MAX_CAPTURE_ITEMS).map((item) => item.id));
    for (const [key, item] of capturedByKey.entries()) {
      if (!keepIds.has(item.id)) capturedByKey.delete(key);
    }
  }

  function addCapturedDetails(details) {
    if (!running) return;
    const item = buildItem(details);
    if (!item) return;
    capturedByKey.set(`${item.method}:${item.url}`, item);
    trimItems();
  }

  function parseSystemProxyLine(line) {
    if (!line.trim().startsWith("{")) return;
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === "error" && parsed.message) {
        captureError = String(parsed.message).slice(0, 240);
        return;
      }
      if (parsed.type === "state") {
        if (parsed.engine === "wodeappx-capture-engine") {
          captureBackend = "wodeappx-capture-engine";
          captureBackendVersion = parsed.version || captureBackendVersion;
        }
        return;
      }
      if (!parsed.url || !parsed.statusCode) return;
      addCapturedDetails({
        url: parsed.url,
        method: parsed.method || "GET",
        referrer: parsed.referrer,
        responseHeaders: parsed.responseHeaders,
        requestHeaders: parsed.requestHeaders,
        resourceType: parsed.resourceType || "system-proxy",
        statusCode: parsed.statusCode,
        sizeBytes: parsed.sizeBytes,
      });
    } catch {
      // Ignore proxy log lines that are not our capture JSON.
    }
  }

  function ensureManagedMitmdump() {
    const existing = mitmdumpVenvPath();
    if (existsSync(existing) && commandWorks({ command: normalizeExecutable(existing) }, ["--version"])) {
      return { command: normalizeExecutable(existing) };
    }

    const python = resolvePythonCommand();
    if (!python) {
      captureError = "未找到可用的 Python，无法自动准备内置抓取运行时。";
      return null;
    }

    const venvDir = join(runtimeDir(), "mitmproxy-venv");
    mkdirSync(runtimeDir(), { recursive: true });

    const venv = runCommand(python, ["-m", "venv", venvDir], 180000);
    if (!venv.ok) {
      captureError = `内置抓取运行时创建失败：${venv.output || "python venv 执行失败"}`;
      return null;
    }

    const venvPython = join(
      venvDir,
      process.platform === "win32" ? "Scripts" : "bin",
      platformBinaryName("python"),
    );
    const pip = runCommand({ command: normalizeExecutable(venvPython) }, [
      "-m",
      "pip",
      "install",
      "--upgrade",
      "pip",
      "mitmproxy",
    ], 300000);
    if (!pip.ok) {
      captureError = `内置抓取运行时安装失败：${pip.output || "pip install mitmproxy 执行失败"}`;
      return null;
    }

    if (existsSync(existing) && commandWorks({ command: normalizeExecutable(existing) }, ["--version"])) {
      return { command: normalizeExecutable(existing) };
    }

    captureError = "内置抓取运行时已安装，但未找到 mitmdump 可执行文件。";
    return null;
  }

  function resolveMitmdumpCommand() {
    for (const candidate of bundledMitmdumpCandidates()) {
      if (existsSync(candidate)) {
        const command = normalizeExecutable(candidate);
        if (commandWorks({ command }, ["--version"])) return { command };
      }
    }

    if (commandWorks({ command: "mitmdump" }, ["--version"])) return { command: "mitmdump" };
    return ensureManagedMitmdump();
  }

  function ensureMitmproxyAddon() {
    const addonPath = join(app.getPath("userData"), "wodeappx-system-capture-addon.py");
    writeFileSync(addonPath, MITMPROXY_ADDON, "utf8");
    return addonPath;
  }

  function snapshot(options = {}) {
    const caPath = activeCaCertPath();
    const caReady = existsSync(caPath);
    return {
      ok: true,
      running,
      source: "system-proxy",
      items: filteredItems(options),
      maxItems: MAX_CAPTURE_ITEMS,
      error: captureError,
      setupHint: SYSTEM_PROXY_SETUP_HINT,
      proxy: {
        host: SYSTEM_PROXY_HOST,
        port: SYSTEM_PROXY_PORT,
        caUrl: SYSTEM_PROXY_CA_URL,
      },
      httpsAuth: {
        status: caReady ? "certificate-ready" : "not-ready",
        caPath: caReady ? caPath : undefined,
        guideUrl: SYSTEM_PROXY_CA_URL,
        message: "HTTPS 深度抓取需要用户在系统证书界面信任 我的AppX 本机 CA。",
      },
      engine: captureBackend
        ? {
            name: captureBackend === "wodeappx-capture-engine" ? "我的AppX Capture Engine" : "mitmproxy",
            mode: captureBackend === "wodeappx-capture-engine" ? "sidecar" : "mitmproxy",
            path: captureBackendPath,
            version: captureBackendVersion,
            upstream: upstreamProxyUrl,
          }
        : undefined,
    };
  }

  async function startCaptureEngineProxy(captureEngine) {
    captureBackend = "wodeappx-capture-engine";
    captureBackendPath = captureEngine.command;
    upstreamProxyUrl = resolveUpstreamProxyUrl();

    const args = [
      ...(captureEngine.argsPrefix || []),
      "--host",
      SYSTEM_PROXY_HOST,
      "--port",
      String(SYSTEM_PROXY_PORT),
      "--ca-dir",
      captureEngineCaDir(),
      "--rule",
      "*",
    ];
    if (upstreamProxyUrl) args.push("--upstream", upstreamProxyUrl);

    const child = spawn(captureEngine.command, args, {
      env: process.env,
    });
    proxyProcess = child;
    proxyStdout = "";
    running = true;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      proxyStdout += chunk;
      const lines = proxyStdout.split(/\r?\n/);
      proxyStdout = lines.pop() || "";
      lines.forEach(parseSystemProxyLine);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      const line = chunk.trim();
      const lower = line.toLowerCase();
      if (line && (lower.includes("error") || lower.includes("failed") || lower.includes("panic"))) {
        captureError = line.slice(0, 240);
      }
    });

    child.once("error", (error) => {
      proxyProcess = null;
      running = false;
      if (proxyApplied) {
        restoreSystemProxySettings();
        proxyApplied = false;
      }
      captureError = error instanceof Error ? error.message : "系统代理监听启动失败";
    });

    child.once("exit", (code) => {
      proxyProcess = null;
      running = false;
      if (proxyApplied) {
        const restore = restoreSystemProxySettings();
        proxyApplied = false;
        if (!restore.ok) captureError = restore.error;
      }
      if (code && code !== 0) captureError = `系统代理监听已退出，退出码 ${code}`;
    });

    const ready = await waitForTcpPort(SYSTEM_PROXY_HOST, SYSTEM_PROXY_PORT, 12000, () => proxyProcess === child);
    if (!ready) {
      proxyProcess = null;
      running = false;
      child.kill("SIGTERM");
      captureError ||= "系统代理监听启动超时。";
      return { ...snapshot(), ok: false };
    }

    const proxyResult = applySystemProxySettings(SYSTEM_PROXY_HOST, SYSTEM_PROXY_PORT);
    if (!proxyResult.ok) {
      if (proxyResult.effectiveMismatch) {
        proxyApplied = false;
        captureError = proxyResult.error || "当前网络代理正在接管系统流量，已进入兼容模式。";
        return snapshot();
      }
      proxyProcess = null;
      running = false;
      child.kill("SIGTERM");
      captureError = proxyResult.error || "系统代理自动设置失败。";
      return { ...snapshot(), ok: false };
    }

    proxyApplied = proxyResult.changed;
    return snapshot();
  }

  async function start() {
    if (proxyProcess) {
      running = true;
      return snapshot();
    }

    captureError = undefined;
    if (await canConnect(SYSTEM_PROXY_HOST, SYSTEM_PROXY_PORT)) {
      running = false;
      captureError = `系统代理端口 ${SYSTEM_PROXY_HOST}:${SYSTEM_PROXY_PORT} 已被占用，请先关闭占用该端口的程序后再开启采集。`;
      return { ...snapshot(), ok: false };
    }

    const captureEngine = resolveCaptureEngineCommand();
    if (captureEngine) {
      return startCaptureEngineProxy(captureEngine);
    }

    const mitmdump = resolveMitmdumpCommand();
    if (!mitmdump) {
      running = false;
      captureError ||= "内置抓取运行时不可用，无法启动系统级监听。";
      return { ...snapshot(), ok: false };
    }
    captureBackend = "mitmproxy";
    captureBackendPath = mitmdump.command;
    captureBackendVersion = runCommand(mitmdump, ["--version"], 15000).output;

    const addonPath = ensureMitmproxyAddon();
    const child = spawn(mitmdump.command, [
      ...(mitmdump.argsPrefix || []),
      "--listen-host",
      SYSTEM_PROXY_HOST,
      "--listen-port",
      String(SYSTEM_PROXY_PORT),
      "--set",
      "flow_detail=0",
      "-s",
      addonPath,
    ], {
      env: mitmproxyEnvironment(),
    });
    proxyProcess = child;
    proxyStdout = "";
    running = true;

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      proxyStdout += chunk;
      const lines = proxyStdout.split(/\r?\n/);
      proxyStdout = lines.pop() || "";
      lines.forEach(parseSystemProxyLine);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      const line = chunk.trim();
      const lower = line.toLowerCase();
      if (line && (lower.includes("error") || lower.includes("failed") || lower.includes("address already in use"))) {
        captureError = line.slice(0, 240);
      }
    });

    child.once("error", (error) => {
      proxyProcess = null;
      running = false;
      if (proxyApplied) {
        restoreSystemProxySettings();
        proxyApplied = false;
      }
      captureError = error instanceof Error ? error.message : "系统代理监听启动失败";
    });

    child.once("exit", (code) => {
      proxyProcess = null;
      running = false;
      if (proxyApplied) {
        const restore = restoreSystemProxySettings();
        proxyApplied = false;
        if (!restore.ok) captureError = restore.error;
      }
      if (code && code !== 0) captureError = `系统代理监听已退出，退出码 ${code}`;
    });

    const ready = await waitForTcpPort(SYSTEM_PROXY_HOST, SYSTEM_PROXY_PORT, 12000, () => proxyProcess === child);
    if (!ready) {
      proxyProcess = null;
      running = false;
      child.kill("SIGTERM");
      captureError ||= "系统代理监听启动超时。";
      return { ...snapshot(), ok: false };
    }

    const proxyResult = applySystemProxySettings(SYSTEM_PROXY_HOST, SYSTEM_PROXY_PORT);
    if (!proxyResult.ok) {
      if (proxyResult.effectiveMismatch) {
        proxyApplied = false;
        captureError = proxyResult.error || "当前网络代理正在接管系统流量，已进入兼容模式。";
        return snapshot();
      }
      proxyProcess = null;
      running = false;
      child.kill("SIGTERM");
      captureError = proxyResult.error || "系统代理自动设置失败。";
      return { ...snapshot(), ok: false };
    }

    proxyApplied = proxyResult.changed;
    return snapshot();
  }

  async function authorizeHttps() {
    const startResult = await start();
    if (!startResult.ok) return startResult;

    const caPath = activeCaCertPath();
    const ready = await waitForFile(caPath, 10000);
    if (!ready) {
      captureError = "HTTPS 授权证书尚未生成，请稍后再试。";
      return { ...snapshot(), ok: false };
    }

    let openError = "";
    if (process.platform === "darwin" || process.platform === "win32") {
      openError = await shell.openPath(caPath);
    }
    await shell.openExternal(SYSTEM_PROXY_CA_URL).catch(() => undefined);

    return {
      ...snapshot(),
      ok: !openError,
      httpsAuth: {
        status: openError ? "open-failed" : "authorization-opened",
        caPath,
        guideUrl: SYSTEM_PROXY_CA_URL,
        message: openError
          ? `证书授权入口打开失败：${openError}`
          : "已打开 HTTPS 证书授权入口。请在系统证书界面确认信任 我的AppX 本机 CA。",
      },
      error: openError || captureError,
    };
  }

  async function stop() {
    running = false;
    const child = proxyProcess;
    proxyProcess = null;
    if (child) {
      try {
        child.kill("SIGTERM");
      } catch {
        // Already gone.
      }
    }
    if (proxyApplied) {
      const restore = restoreSystemProxySettings();
      proxyApplied = false;
      if (!restore.ok) captureError = restore.error;
    }
    return snapshot();
  }

  async function clear() {
    capturedByKey.clear();
    return snapshot();
  }

  return {
    start,
    stop,
    clear,
    authorizeHttps,
    snapshot,
    list: filteredItems,
  };
}

