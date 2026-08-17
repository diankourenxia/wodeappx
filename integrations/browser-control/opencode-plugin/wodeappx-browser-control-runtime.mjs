import http from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const GLOBAL_KEY = "__wodeappxBrowserControlRuntime";
const SERVER_NAME = "wodeappx-browser-control";
const SERVER_VERSION = "0.7.0";
const COMMAND_WAIT_MS_MAX = Number(process.env.WODEAPPX_BROWSER_COMMAND_WAIT_MS_MAX || 25000);
const EXPECTED_EXTENSION_NAME = "WodeAppX Browser Control";
const OFFICIAL_CHROME_WEB_STORE_EXTENSION_ID = "mfnpfomihliahiheofiijbmmhfeanhpb";
const BRIDGE_HOST = process.env.WODEAPPX_BROWSER_BRIDGE_HOST || "127.0.0.1";
const BRIDGE_PORT = Number(process.env.WODEAPPX_BROWSER_BRIDGE_PORT || 17654);
const BRIDGE_TOKEN = process.env.WODEAPPX_BROWSER_TOKEN || "";
const NATIVE_SOCKET_PATH = process.env.WODEAPPX_BROWSER_NATIVE_SOCKET
  || path.join(os.homedir(), ".wodeappx", "browser-control.sock");
const DEFAULT_TIMEOUT_MS = Number(process.env.WODEAPPX_BROWSER_COMMAND_TIMEOUT_MS || 30000);
const MAX_RESULT_CHARS = Number(process.env.WODEAPPX_BROWSER_MAX_RESULT_CHARS || 12000);
const CLIENT_STALE_MS = Number(process.env.WODEAPPX_BROWSER_CLIENT_STALE_MS || 45000);
const CHROME_WEB_STORE_URL = process.env.WODEAPPX_BROWSER_STORE_URL
  || `https://chromewebstore.google.com/detail/wodeappx-browser-control/${OFFICIAL_CHROME_WEB_STORE_EXTENSION_ID}`;
const SETUP_WAIT_TIMEOUT_MS = Number(process.env.WODEAPPX_BROWSER_SETUP_WAIT_MS || 180_000);
const SETUP_EARLY_WAIT_MS = Number(process.env.WODEAPPX_BROWSER_SETUP_EARLY_WAIT_MS || 8_000);
const SETUP_STEP_TIMEOUT_MS = Number(process.env.WODEAPPX_BROWSER_SETUP_STEP_TIMEOUT_MS || 15_000);
const SETUP_OPEN_DISABLED = /^(1|true|yes)$/i.test(process.env.WODEAPPX_BROWSER_SETUP_NO_OPEN || "");
const SETUP_ACTIVE_PHASES = new Set(["starting", "opening_store", "awaiting_manual_install", "waiting_extension", "smoke_testing"]);
/** Actions allowed on POST /agent/call for external harnesses (e.g. dsh plugin). */
const AGENT_HTTP_ACTIONS = new Set([
  "status",
  "tabs",
  "open_url",
  "read_page",
  "click",
  "type",
  "key",
  "eval",
  "screenshot",
  "execute",
  "run",
]);
const MEDIA_ASSET_URL_PATTERN =
  /\.(?:png|jpe?g|webp|gif|avif|svg|bmp|heic|mp4|mov|webm|mkv|m4v|mp3|wav|m4a|aac)(?:$|[?#])/i;
const ASSET_HOST_PATTERN =
  /(^|\.)((?:placehold|placeholder)\.co|assets\.wodeapp\.(?:ai|cn)|r2\.dev|cloudfront\.net|aliyuncs\.com|volces\.com|volccdn\.com)$/i;
const ASSET_QUERY_PATTERN = /\b(?:X-Tos-|x-oss-|Expires=|Signature=|response-content-type=)/i;

function isLikelyGenerationAssetUrl(input) {
  const url = String(input || "").trim();
  if (!url) return false;
  if (/^(?:data:image\/|blob:|asset:\/\/)/i.test(url)) return true;
  try {
    const parsed = new URL(url);
    if (!/^https?:$/i.test(parsed.protocol)) return false;
    if (MEDIA_ASSET_URL_PATTERN.test(parsed.pathname)) return true;
    if (ASSET_HOST_PATTERN.test(parsed.hostname)) return true;
    return ASSET_QUERY_PATTERN.test(parsed.search);
  } catch {
    return false;
  }
}

function createRuntime() {
  const clients = new Map();
  const commandQueues = new Map();
  const commandWaiters = new Map();
  const pendingCommands = new Map();
  let sidePanelChatAdapter = null;
  let bridgeReady = false;
  let bridgeError = null;
  let bridgeStart = null;
  let tcpBridgeReady = false;
  let nativeSocketReady = false;
  let nativeSocketError = null;
  let selectedClientId = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function isExpectedExtensionClient(client) {
    return Boolean(client?.extensionId && client?.extensionName === EXPECTED_EXTENSION_NAME);
  }

  function clientSupportsRequiredAction(client, requiredAction) {
    if (!requiredAction) return true;
    if (requiredAction === "page.cdp") {
      return isExpectedExtensionClient(client) && client.supportedActions.includes("page.cdp");
    }
    return client.supportedActions.includes(requiredAction);
  }

  function pruneStaleClients() {
    const cutoff = Date.now() - CLIENT_STALE_MS;
    for (const [clientId, client] of clients.entries()) {
      if (client.lastSeenMs >= cutoff) continue;
      clients.delete(clientId);
      commandQueues.delete(clientId);
      const waiter = commandWaiters.get(clientId);
      if (waiter) {
        clearTimeout(waiter.timer);
        waiter.resolve(null);
        commandWaiters.delete(clientId);
      }
      if (selectedClientId === clientId) selectedClientId = null;
    }
  }

  function clientSummary() {
    pruneStaleClients();
    return Array.from(clients.values()).map((client) => ({
      clientId: client.clientId,
      name: client.name,
      extensionId: client.extensionId,
      extensionName: client.extensionName,
      extensionVersion: client.extensionVersion,
      extensionIdentityReported: Boolean(client.extensionId && client.extensionName),
      supportedActions: client.supportedActions,
      supportsRawCdp: clientSupportsRequiredAction(client, "page.cdp"),
      transport: client.transport,
      nativeHostVersion: client.nativeHostVersion,
      hostBridgeTransport: client.hostBridgeTransport,
      distribution: client.extensionId === OFFICIAL_CHROME_WEB_STORE_EXTENSION_ID
        ? "chrome_web_store"
        : client.extensionId
          ? "unpacked_or_other"
          : "legacy_unknown",
      chromeVersion: client.chromeVersion,
      connectedAt: client.connectedAt,
      lastSeenAt: client.lastSeenAt,
      pendingCommands: commandQueues.get(client.clientId)?.length || 0,
    }));
  }

  function bestClientId(requiredAction = "") {
    pruneStaleClients();
    let best = null;
    for (const client of clients.values()) {
      if (!clientSupportsRequiredAction(client, requiredAction)) continue;
      const identityRank = client.extensionId && client.extensionName === EXPECTED_EXTENSION_NAME ? 1 : 0;
      const bestIdentityRank = best?.extensionId && best?.extensionName === EXPECTED_EXTENSION_NAME ? 1 : 0;
      if (!best || identityRank > bestIdentityRank || (identityRank === bestIdentityRank && client.lastSeenMs > best.lastSeenMs)) {
        best = client;
      }
    }
    return best?.clientId || null;
  }

  function firstClientId() {
    selectedClientId = bestClientId();
    return selectedClientId;
  }

  function bridgeInfo() {
    return {
      ready: bridgeReady,
      error: bridgeError,
      host: BRIDGE_HOST,
      port: BRIDGE_PORT,
      url: `http://${BRIDGE_HOST}:${BRIDGE_PORT}`,
      tokenRequired: Boolean(BRIDGE_TOKEN),
      tcpReady: tcpBridgeReady,
      nativeSocket: {
        ready: nativeSocketReady,
        path: process.platform === "win32" ? "" : NATIVE_SOCKET_PATH,
        error: nativeSocketError,
      },
    };
  }

  function status() {
    const recommendedClientId = firstClientId();
    const recommendedRawCdpClientId = bestClientId("page.cdp");
    return {
      server: { name: SERVER_NAME, version: SERVER_VERSION },
      expectedExtension: {
        name: EXPECTED_EXTENSION_NAME,
        chromeWebStoreId: OFFICIAL_CHROME_WEB_STORE_EXTENSION_ID,
      },
      bridge: bridgeInfo(),
      clients: clientSummary(),
      browserSession: {
        selectedClientId,
        recommendedClientId,
        recommendedRawCdpClientId,
        selectionPolicy: "Call tabs with the recommended clientId once, then reuse that clientId or omit it to keep the same Chrome client.",
        rawCdpSelectionPolicy: "Before raw CDP, require supportsRawCdp:true and bind recommendedRawCdpClientId. Never fall back to a legacy client whose capabilities are unknown.",
      },
      capabilities: {
        nativeMessagingPreferred: true,
        localhostHttpFallback: true,
        structuredDomSnapshot: true,
        persistentNodeIds: true,
        uniqueTargetEnforcement: true,
        realKeyEvents: true,
        screenshot: true,
        rawCdpApprovalRequired: true,
        extensionIdentityReporting: true,
        commandLongPoll: true,
        debuggerKeepAlive: true,
        batchedRun: true,
      },
      workflow: [
        "status",
        "tabs (bind clientId and tabId)",
        "read_page (observe interactiveElements and nodeId)",
        "prefer wodeappx_browser_run for a known multi-step sequence",
        "one click/type/key by current nodeId",
        "read_page or screenshot (verify)",
      ],
      pendingCommandCount: pendingCommands.size,
      chatReady: Boolean(sidePanelChatAdapter),
      setup: {
        url: `http://${BRIDGE_HOST}:${BRIDGE_PORT}/setup`,
        storeUrl: CHROME_WEB_STORE_URL,
      },
    };
  }

  const SETUP_TEST_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>WodeAppX 浏览器扩展自检页</title>
<style>
  body { font-family: -apple-system, "PingFang SC", sans-serif; margin: 36px auto; max-width: 640px; color: #1c1917; background: #fafaf9; padding: 0 20px 48px; }
  h1 { font-size: 22px; margin: 0 0 8px; letter-spacing: -0.02em; }
  .lead { line-height: 1.65; color: #57534e; margin: 0 0 22px; font-size: 14px; }
  .stage { background: #fff; border: 1px solid #e7e5e4; border-radius: 14px; padding: 20px; }
  .stage h2 { margin: 0 0 12px; font-size: 15px; }
  .checks { list-style: none; margin: 0 0 18px; padding: 0; }
  .checks li { display: flex; gap: 10px; align-items: flex-start; padding: 8px 0; border-bottom: 1px solid #f5f5f4; font-size: 13.5px; color: #78716c; }
  .checks li:last-child { border-bottom: 0; }
  .checks .mark { flex: none; width: 20px; height: 20px; border-radius: 999px; border: 1px solid #d6d3d1; display: grid; place-items: center; font-size: 11px; color: #a8a29e; }
  .checks li.is-on { color: #1c1917; }
  .checks li.is-on .mark { border-color: #7f1d1d; background: #7f1d1d; color: #fff; }
  button { font-size: 15px; padding: 12px 22px; border: 0; border-radius: 10px; background: #1c1917; color: #fff; cursor: pointer; }
  button.is-hit { background: #7f1d1d; transform: scale(0.98); }
  #selftest-result { margin-top: 16px; padding: 14px 16px; border-radius: 10px; background: #f5f5f4; color: #57534e; font-size: 13.5px; line-height: 1.6; display: none; }
  #selftest-result.is-ok { display: block; background: #ecfdf3; color: #166534; border: 1px solid #bbf7d0; }
  #selftest-result strong { display: block; font-size: 15px; margin-bottom: 6px; }
  .log { margin-top: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: #3f3f46; white-space: pre-wrap; }
</style>
</head>
<body>
<h1>浏览器操作调试演示</h1>
<p class="lead">这不是普通按钮页。WodeAppX 会通过 Chrome 扩展<strong>自动</strong>打开本页、读取标题、定位下方按钮并点击。你应能看到按钮被点亮，以及下方调试记录逐条出现。</p>
<div class="stage">
  <h2>现场会看到什么</h2>
  <ul class="checks" id="checks">
    <li id="c1"><span class="mark" aria-hidden></span><span>页面已打开，等待扩展操作</span></li>
    <li id="c2"><span class="mark" aria-hidden></span><span>扩展定位「运行点击自检」按钮</span></li>
    <li id="c3"><span class="mark" aria-hidden></span><span>扩展自动点击按钮（标题与结果区会变）</span></li>
  </ul>
  <button id="selftest-button" type="button">运行点击自检</button>
  <div id="selftest-result">
    <strong>SELFTEST_OK 点击自检通过</strong>
    <div>扩展已完成一次真实的读页 + 点击。回到安装页可看完整调试步骤；之后智能体也能用同样能力操作浏览器。</div>
    <div class="log" id="selftest-log"></div>
  </div>
</div>
<script>
(function () {
  var btn = document.getElementById("selftest-button");
  var result = document.getElementById("selftest-result");
  var log = document.getElementById("selftest-log");
  function mark(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.add("is-on");
  }
  mark("c1");
  btn.addEventListener("click", function () {
    var at = new Date().toLocaleTimeString();
    mark("c2");
    mark("c3");
    btn.classList.add("is-hit");
    btn.textContent = "已被扩展点击";
    result.className = "is-ok";
    result.style.display = "block";
    log.textContent = [
      "[" + at + "] page.click → #selftest-button",
      "[" + at + "] title → WodeAppX 自检完成",
      "[" + at + "] result → SELFTEST_OK 点击自检通过"
    ].join("\\n");
    document.title = "WodeAppX 自检完成";
  });
})();
</script>
</body>
</html>`;

  const SETUP_PAGE_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WodeAppX 浏览器扩展 · 安装调试</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "PingFang SC", sans-serif; margin: 0; background: #f5f5f7; color: #1c1c1e; }
  .wrap { max-width: 640px; margin: 48px auto; padding: 0 20px; }
  .card { background: #fff; border-radius: 14px; padding: 28px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .sub { color: #666; font-size: 13.5px; margin: 0 0 20px; line-height: 1.7; }
  .status { display: flex; align-items: center; gap: 8px; font-size: 14px; padding: 10px 14px; border-radius: 8px; background: #f5f5f7; margin-bottom: 18px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #c7c7cc; flex: none; }
  .status.is-on .dot { background: #2fb457; }
  .status.is-off .dot { background: #d9534f; }
  .primary { width: 100%; font-size: 16px; font-weight: 600; padding: 13px 0; border: 0; border-radius: 10px; background: #1c1917; color: #fff; cursor: pointer; }
  .primary:disabled { opacity: .55; cursor: default; }
  .actions { display: flex; flex-direction: column; gap: 10px; }
  .secondary { width: 100%; font-size: 14px; font-weight: 500; padding: 11px 0; border: 1px solid #d2d2d7; border-radius: 10px; background: #fff; color: #1c1c1e; cursor: pointer; }
  .secondary:disabled { opacity: .55; cursor: default; }
  .steps { margin: 20px 0 0; padding: 0; list-style: none; font-size: 13.5px; }
  .steps li { display: flex; gap: 9px; padding: 7px 0; color: #555; align-items: flex-start; line-height: 1.55; }
  .steps li .mark { flex: none; width: 18px; text-align: center; color: #c7c7cc; }
  .steps li.is-active .mark { color: #7f1d1d; }
  .steps li.is-ok { color: #1d7a4d; }
  .steps li.is-ok .mark { color: #2fb457; }
  .steps li.is-bad { color: #c03a2b; }
  .steps li.is-bad .mark { color: #d9534f; }
  .debug-title { margin: 18px 0 0; font-size: 13px; font-weight: 600; color: #44403c; letter-spacing: 0.02em; }
  .result { margin-top: 12px; padding: 13px 16px; border-radius: 10px; font-size: 14px; line-height: 1.7; display: none; }
  .result.is-ok { display: block; background: #e8f7ef; color: #1d7a4d; }
  .result.is-bad { display: block; background: #fdecea; color: #c03a2b; }
  .hint { margin: 10px 0 0; font-size: 12.5px; color: #78716c; line-height: 1.6; }
  .store { margin-top: 16px; font-size: 13px; color: #777; }
  .store a { color: #7f1d1d; word-break: break-all; }
  .spin { display: inline-block; width: 13px; height: 13px; border: 2px solid #c7c7cc; border-top-color: #7f1d1d; border-radius: 50%; animation: r .8s linear infinite; vertical-align: -2px; }
  @keyframes r { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <h1>Chrome 安装调试</h1>
    <p class="sub">会在本机 Chrome 里真实跑一遍：连接扩展 → 打开调试页 → 读标题 → 自动点按钮。请盯着新开的标签页，按钮被点、结果区变绿，才算你看得到的调试，而不是只看一句「通过」。</p>
    <div class="status" id="status"><span class="dot"></span><span id="status-text">正在检测扩展状态…</span></div>
    <div class="actions">
      <button class="primary" id="run" type="button" disabled>加载中…</button>
      <button class="secondary" id="detect" type="button" disabled>已安装，开始连接检测</button>
    </div>
    <p class="debug-title" id="debug-title" hidden>调试记录</p>
    <ul class="steps" id="steps"></ul>
    <div class="result" id="result"></div>
    <p class="hint" id="watch-hint" hidden>若 Chrome 刚弹出「浏览器操作调试演示」标签，请看按钮是否变成「已被扩展点击」、下方是否出现 SELFTEST_OK。</p>
    <p class="store">如果没有自动打开，请手动访问：<a id="store-link" href="#" target="_blank" rel="noopener">Chrome 应用商店</a></p>
  </div>
</div>
<script>
(function () {
  var stepsEl = document.getElementById("steps");
  var resultEl = document.getElementById("result");
  var statusEl = document.getElementById("status");
  var statusText = document.getElementById("status-text");
  var runBtn = document.getElementById("run");
  var detectBtn = document.getElementById("detect");
  var storeLink = document.getElementById("store-link");
  var debugTitle = document.getElementById("debug-title");
  var watchHint = document.getElementById("watch-hint");
  var pollTimer = null;
  var autorun = /(?:\\?|&)autorun=1/.test(location.search);
  var modeMatch = /(?:\\?|&)mode=([^&]+)/.exec(location.search);
  var autorunMode = modeMatch && modeMatch[1] === "detect" ? "detect" : "install";
  var tokenMatch = /(?:\\?|&)token=([^&]+)/.exec(location.search);
  var tokenQuery = tokenMatch ? "?token=" + encodeURIComponent(tokenMatch[1]) : "";

  var PHASES = [
    ["opening_store", "打开应用商店安装页"],
    ["awaiting_manual_install", "等待手动安装扩展"],
    ["waiting_extension", "等待扩展连接"],
    ["smoke_testing", "在 Chrome 里现场调试（开页 / 读内容 / 点按钮）"]
  ];

  function setBusy(busy) {
    runBtn.disabled = busy;
    detectBtn.disabled = busy;
    if (busy) {
      runBtn.innerHTML = '<span class="spin"></span> 调试进行中…';
      detectBtn.textContent = "检测中…";
    }
  }

  function renderStatus(state) {
    var client = state.clients && state.clients[0];
    if (client) {
      statusEl.className = "status is-on";
      statusText.textContent = "扩展已连接 · v" + (client.extensionVersion || "?") + " · " + (client.transport === "native_messaging" ? "Native 通道" : "本地通道");
      runBtn.textContent = "安装调试";
      detectBtn.textContent = "再次连接检测";
    } else {
      statusEl.className = "status is-off";
      statusText.textContent = "扩展未连接";
      runBtn.textContent = "安装调试";
      detectBtn.textContent = "已安装，开始连接检测";
    }
    runBtn.disabled = false;
    detectBtn.disabled = false;
  }

  function renderRun(run) {
    if (!run) {
      stepsEl.innerHTML = "";
      debugTitle.hidden = true;
      watchHint.hidden = true;
      return;
    }
    debugTitle.hidden = false;
    var html = "";
    var seen = false;
    for (var i = 0; i < PHASES.length; i++) {
      var id = PHASES[i][0], label = PHASES[i][1];
      var cls = "", mark = "○";
      if (run.phase === id) { cls = "is-active"; mark = "◌"; seen = true; }
      else if (!seen && run.phase !== "starting") { cls = "is-ok"; mark = "✓"; }
      if (run.phase === "done" || run.phase === "failed" || run.phase === "timeout") {
        cls = "is-ok"; mark = "✓";
        if (run.phase !== "done" && id === "smoke_testing" && run.phase !== "smoke_testing") { cls = ""; mark = "○"; }
      }
      html += '<li class="' + cls + '"><span class="mark">' + mark + "</span><span>" + label + "</span></li>";
    }
    if (run.result && run.result.steps) {
      for (var j = 0; j < run.result.steps.length; j++) {
        var s = run.result.steps[j];
        html += '<li class="' + (s.ok ? "is-ok" : "is-bad") + '"><span class="mark" aria-hidden></span><span>' + s.name + (s.detail ? " · " + s.detail : "") + "</span></li>";
      }
    }
    stepsEl.innerHTML = html;
    watchHint.hidden = !(run.phase === "smoke_testing" || run.phase === "done");
    if (run.phase === "done") {
      resultEl.className = "result is-ok";
      resultEl.innerHTML = "<strong>调试通过</strong><br>已在 Chrome 新标签里打开演示页，读到标题，并自动点了「运行点击自检」。请对照那一页的「已被扩展点击」与 SELFTEST_OK；之后智能体可用同样能力操作浏览器。";
      stopPoll();
    } else if (run.phase === "failed" || run.phase === "timeout") {
      resultEl.className = "result is-bad";
      resultEl.textContent = run.detail || run.error || "调试未完成，请重试。";
      stopPoll();
    } else {
      resultEl.className = "result";
    }
  }

  function fetchState() {
    return fetch("/setup/state" + tokenQuery).then(function (r) { return r.json(); });
  }

  function refresh() {
    fetchState().then(function (state) {
      storeLink.href = state.storeUrl;
      renderStatus(state);
      renderRun(state.run);
      var running = state.run && ["starting", "opening_store", "awaiting_manual_install", "waiting_extension", "smoke_testing"].indexOf(state.run.phase) >= 0;
      if (running) {
        setBusy(true);
        startPoll();
      } else {
        stopPoll();
      }
    }).catch(function () {
      statusEl.className = "status is-off";
      statusText.textContent = "无法连接本地桥接服务，请确认 WodeAppX 桌面端正在运行。";
    });
  }

  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(refresh, 1500);
  }
  function stopPoll() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function startRun(mode) {
    setBusy(true);
    var q = tokenQuery ? (tokenQuery + "&mode=" + encodeURIComponent(mode || "install")) : ("?mode=" + encodeURIComponent(mode || "install"));
    fetch("/setup/run" + q, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: mode || "install" }),
    }).then(function () {
      startPoll();
      refresh();
    }).catch(function () {
      setBusy(false);
      refresh();
    });
  }

  runBtn.addEventListener("click", function () {
    startRun("install");
  });
  detectBtn.addEventListener("click", function () {
    startRun("detect");
  });

  refresh();
  if (autorun) {
    // Do NOT use runBtn.click() while disabled — browsers swallow programmatic clicks
    // on disabled buttons, which skipped selftest especially when the extension was
    // already connected and the page raced autorun vs first /setup/state paint.
    fetchState().then(function (state) {
      var running = state.run && ["starting", "opening_store", "awaiting_manual_install", "waiting_extension", "smoke_testing"].indexOf(state.run.phase) >= 0;
      if (!running) startRun(autorunMode);
    }).catch(function () {
      startRun(autorunMode);
    });
  }
})();
</script>
</body>
</html>`;

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function setupClient() {
    pruneStaleClients();
    let best = null;
    for (const client of clients.values()) {
      if (!isExpectedExtensionClient(client)) continue;
      if (!best || client.lastSeenMs > best.lastSeenMs) best = client;
    }
    return best;
  }

  function openUrlInChrome(targetUrl) {
    if (SETUP_OPEN_DISABLED) {
      return Promise.resolve({ ok: false, error: "auto-open disabled (WODEAPPX_BROWSER_SETUP_NO_OPEN)" });
    }
    const platform = process.platform;
    const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
    const args = platform === "darwin"
      ? ["-a", "Google Chrome", targetUrl]
      : platform === "win32"
        ? ["/c", "start", "", targetUrl]
        : [targetUrl];
    return new Promise((resolve) => {
      let settled = false;
      try {
        const child = spawn(command, args, { detached: true, stdio: "ignore" });
        child.on("error", (err) => {
          if (!settled) { settled = true; resolve({ ok: false, error: String(err?.message || err) }); }
        });
        child.unref();
        setTimeout(() => {
          if (!settled) { settled = true; resolve({ ok: true }); }
        }, 800);
      } catch (err) {
        if (!settled) { settled = true; resolve({ ok: false, error: String(err?.message || err) }); }
      }
    });
  }

  async function runSetupSmokeTest(clientId) {
    const steps = [];
    const record = (name, ok, detail) => {
      steps.push({ name, ok, detail: String(detail || "").slice(0, 200) });
      if (!ok) throw new Error(`${name}失败${detail ? `：${detail}` : ""}`);
    };
    const testPageUrl = `http://${BRIDGE_HOST}:${BRIDGE_PORT}/setup/test-page`;
    const opened = await sendBrowserCommand("tabs.open", { url: testPageUrl, newTab: true }, { clientId, timeoutMs: SETUP_STEP_TIMEOUT_MS });
    const tabId = opened.result?.id;
    record("打开自检页", Boolean(tabId), tabId ? `tab ${tabId}` : "扩展未返回 tabId");
    await sleep(1500);
    const read1 = await sendBrowserCommand("page.read", { tabId, maxChars: 2000, maxElements: 20 }, { clientId, timeoutMs: SETUP_STEP_TIMEOUT_MS });
    const page1 = read1.result?.page || {};
    const title1 = page1.title || read1.result?.tab?.title || "";
    record("读取页面标题", /WodeAppX/.test(title1), title1 ? `标题：${title1}` : "未读到标题");
    const elements = Array.isArray(page1.interactiveElements) ? page1.interactiveElements : [];
    const button = elements.find((el) => /运行点击自检/.test(String(el?.text || el?.name || "")));
    record("定位自检按钮", Boolean(button?.nodeId), button ? `nodeId ${button.nodeId}` : "interactiveElements 中没有目标按钮");
    await sendBrowserCommand("page.click", { tabId, nodeId: button.nodeId }, { clientId, timeoutMs: SETUP_STEP_TIMEOUT_MS });
    record("自动点击按钮", true, "已对「运行点击自检」发出 page.click");
    await sleep(500);
    const read2 = await sendBrowserCommand("page.read", { tabId, maxChars: 2000, maxElements: 20 }, { clientId, timeoutMs: SETUP_STEP_TIMEOUT_MS });
    const text2 = String(read2.result?.page?.text || "");
    record(
      "验证点击生效",
      text2.includes("SELFTEST_OK"),
      text2.includes("SELFTEST_OK")
        ? "演示页已显示 SELFTEST_OK / 已被扩展点击"
        : "未检测到点击结果",
    );
    return { ok: true, steps, tabId, title: title1 };
  }

  let setupRun = null;

  async function performSetupRun(mode = "install") {
    const run = setupRun;
    const detectOnly = mode === "detect";
    const update = (phase, detail) => {
      if (setupRun !== run) return;
      run.phase = phase;
      run.detail = detail || "";
      run.mode = detectOnly ? "detect" : "install";
      run.updatedAt = nowIso();
    };
    try {
      let client = setupClient();
      if (!client && detectOnly) {
        update("waiting_extension", "已安装模式：正在检测扩展连接…请确认 Chrome 中扩展已启用；检测到后自动自检。");
        const deadline = Date.now() + SETUP_WAIT_TIMEOUT_MS;
        while (Date.now() < deadline) {
          await sleep(1500);
          client = setupClient();
          if (client) break;
        }
        if (!client) {
          update("timeout", "等待超时：仍未检测到已安装扩展。请确认扩展已启用并重新加载，或改点「一键安装并自检」。");
          return;
        }
      } else if (!client) {
        // Extension may already be installed but not yet heartbeating. Wait briefly
        // before opening the Web Store so already-installed users are not bounced
        // into a redundant "Add to Chrome" flow.
        update("waiting_extension", "等待扩展连接…若已安装，请改点「已安装，开始连接检测」；检测到连接后自动自检。");
        const earlyDeadline = Date.now() + SETUP_EARLY_WAIT_MS;
        while (Date.now() < earlyDeadline) {
          await sleep(1500);
          client = setupClient();
          if (client) break;
        }
      }
      if (!client) {
        update("opening_store", "仍未检测到扩展，正在打开 Chrome 应用商店…");
        const opened = await openUrlInChrome(CHROME_WEB_STORE_URL);
        if (opened.ok) {
          update("waiting_extension", "已打开应用商店，请在 Chrome 中点击「添加至 Chrome」；检测到连接后自动继续。");
        } else {
          update("awaiting_manual_install", `无法自动打开 Chrome（${opened.error}）。请手动打开下方商店链接安装。`);
        }
        const deadline = Date.now() + SETUP_WAIT_TIMEOUT_MS;
        while (Date.now() < deadline) {
          await sleep(1500);
          client = setupClient();
          if (client) break;
        }
        if (!client) {
          update("timeout", "等待超时：扩展仍未连接。请确认已在商店页点击「添加至 Chrome」，或重新加载已安装扩展后重试。");
          return;
        }
      }
      update("smoke_testing", `扩展已连接（v${client.extensionVersion || "?"} · ${client.transport}），正在 Chrome 里现场调试…请看新开的演示标签页`);
      const result = await runSetupSmokeTest(client.clientId);
      run.result = result;
      update("done", "调试通过：已开页、读标题、自动点击，演示页应显示「已被扩展点击」。");
    } catch (err) {
      run.error = String(err?.message || err);
      update("failed", run.error);
    }
  }

  function startSetupRun(mode = "install") {
    if (setupRun && SETUP_ACTIVE_PHASES.has(setupRun.phase)) {
      return { run: setupRun, alreadyRunning: true };
    }
    const normalized = mode === "detect" ? "detect" : "install";
    setupRun = {
      id: randomUUID(),
      phase: "starting",
      mode: normalized,
      detail: "",
      startedAt: nowIso(),
      updatedAt: nowIso(),
      result: null,
      error: null,
    };
    void performSetupRun(normalized);
    return { run: setupRun, alreadyRunning: false };
  }

  function setupState() {
    return {
      ok: true,
      run: setupRun,
      clients: clientSummary(),
      storeUrl: CHROME_WEB_STORE_URL,
      setupUrl: `http://${BRIDGE_HOST}:${BRIDGE_PORT}/setup`,
    };
  }

  function assertSetupOrigin(req) {
    const origin = String(req.headers.origin || "");
    if (!origin) return;
    if (origin.startsWith("chrome-extension://")) return;
    if (origin === `http://${BRIDGE_HOST}:${BRIDGE_PORT}` || origin === `http://localhost:${BRIDGE_PORT}`) return;
    const err = new Error("This endpoint only accepts requests from the local setup page or a Chrome extension");
    err.status = 403;
    throw err;
  }

  function readRequestBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (!text) return resolve({});
        try {
          resolve(JSON.parse(text));
        } catch (err) {
          reject(new Error(`Invalid JSON body: ${err.message}`));
        }
      });
      req.on("error", reject);
    });
  }

  function writeJson(res, statusCode, data) {
    res.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "content-type,x-wodeappx-browser-token",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    });
    res.end(JSON.stringify(data));
  }

  function writeHtml(res, statusCode, html) {
    res.writeHead(statusCode, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(html);
  }

  function tokenFrom(req, url, body) {
    return req.headers["x-wodeappx-browser-token"] || url.searchParams.get("token") || body?.token || "";
  }

  function assertToken(req, url, body) {
    if (!BRIDGE_TOKEN) return;
    if (tokenFrom(req, url, body) !== BRIDGE_TOKEN) {
      const err = new Error("Invalid bridge token");
      err.status = 401;
      throw err;
    }
  }

  function assertExtensionOrigin(req) {
    const origin = String(req.headers.origin || "");
    if (origin && !origin.startsWith("chrome-extension://")) {
      const err = new Error("This endpoint only accepts requests from a Chrome extension");
      err.status = 403;
      throw err;
    }
  }

  function assertLocalHarnessRequest(req) {
    const origin = String(req.headers.origin || "").trim();
    if (origin) {
      const err = new Error("This endpoint only accepts local non-browser clients");
      err.status = 403;
      throw err;
    }
  }

  function upsertClient(body) {
    const clientId = String(body.clientId || randomUUID());
    const previous = clients.get(clientId);
    const reportedExtensionId = String(body.extensionId || previous?.extensionId || "").trim();
    const extensionId = /^[a-p]{32}$/.test(reportedExtensionId) ? reportedExtensionId : "";
    const extensionName = String(body.extensionName || previous?.extensionName || "").trim().slice(0, 160);
    const supportedActions = Array.isArray(body.supportedActions)
      ? [...new Set(body.supportedActions.map((value) => String(value || "").trim()).filter(Boolean))].slice(0, 32)
      : previous?.supportedActions || [];
    const client = {
      clientId,
      name: String(body.name || extensionName || previous?.name || "Chrome").slice(0, 160),
      extensionId,
      extensionName,
      extensionVersion: String(body.extensionVersion || previous?.extensionVersion || ""),
      transport: String(body.transport || previous?.transport || "unknown").slice(0, 80),
      nativeHostVersion: String(body.nativeHostVersion || previous?.nativeHostVersion || "").slice(0, 80),
      hostBridgeTransport: String(body.hostBridgeTransport || previous?.hostBridgeTransport || "").slice(0, 80),
      supportedActions,
      chromeVersion: String(body.chromeVersion || previous?.chromeVersion || ""),
      connectedAt: previous?.connectedAt || nowIso(),
      lastSeenAt: nowIso(),
      lastSeenMs: Date.now(),
    };
    clients.set(clientId, client);
    if (!selectedClientId) selectedClientId = clientId;
    if (!commandQueues.has(clientId)) commandQueues.set(clientId, []);
    return client;
  }

  function takeQueuedCommand(clientId) {
    const queue = commandQueues.get(clientId) || [];
    const command = queue.shift() || null;
    commandQueues.set(clientId, queue);
    return command;
  }

  function enqueueCommand(clientId, command) {
    const waiter = commandWaiters.get(clientId);
    if (waiter) {
      clearTimeout(waiter.timer);
      commandWaiters.delete(clientId);
      waiter.resolve(command);
      return;
    }
    const queue = commandQueues.get(clientId) || [];
    queue.push(command);
    commandQueues.set(clientId, queue);
  }

  function waitForCommand(clientId, waitMs, req) {
    const immediate = takeQueuedCommand(clientId);
    if (immediate || waitMs <= 0) return Promise.resolve(immediate);
    return new Promise((resolve) => {
      const existing = commandWaiters.get(clientId);
      if (existing) {
        clearTimeout(existing.timer);
        existing.resolve(null);
      }
      const timer = setTimeout(() => {
        if (commandWaiters.get(clientId)?.timer === timer) commandWaiters.delete(clientId);
        resolve(null);
      }, waitMs);
      const waiter = {
        timer,
        resolve: (command) => {
          clearTimeout(timer);
          if (commandWaiters.get(clientId)?.timer === timer) commandWaiters.delete(clientId);
          resolve(command);
        },
      };
      commandWaiters.set(clientId, waiter);
      req?.once?.("close", () => {
        if (commandWaiters.get(clientId)?.timer !== timer) return;
        clearTimeout(timer);
        commandWaiters.delete(clientId);
        resolve(null);
      });
    });
  }

  async function handleHttp(req, res) {
    const url = new URL(req.url || "/", `http://${BRIDGE_HOST}:${BRIDGE_PORT}`);
    if (req.method === "OPTIONS") {
      writeJson(res, 200, { ok: true });
      return;
    }

    try {
      if (req.method === "GET" && url.pathname === "/health") {
        writeJson(res, 200, { ok: true, ...status() });
        return;
      }

      if (req.method === "GET" && url.pathname === "/setup") {
        writeHtml(res, 200, SETUP_PAGE_HTML);
        return;
      }

      if (req.method === "GET" && url.pathname === "/setup/test-page") {
        writeHtml(res, 200, SETUP_TEST_PAGE_HTML);
        return;
      }

      if (req.method === "GET" && url.pathname === "/setup/state") {
        assertToken(req, url, {});
        writeJson(res, 200, setupState());
        return;
      }

      if (req.method === "POST" && url.pathname === "/setup/run") {
        assertSetupOrigin(req);
        const body = await readRequestBody(req).catch(() => ({}));
        assertToken(req, url, body || {});
        const modeParam = String(url.searchParams.get("mode") || body?.mode || "install");
        const started = startSetupRun(modeParam);
        writeJson(res, 202, { ok: true, run: started.run, alreadyRunning: started.alreadyRunning });
        return;
      }

      if (req.method === "POST" && url.pathname === "/extension/connect") {
        const body = await readRequestBody(req);
        assertToken(req, url, body);
        const client = upsertClient(body);
        writeJson(res, 200, {
          ok: true,
          clientId: client.clientId,
          tokenRequired: Boolean(BRIDGE_TOKEN),
          server: { name: SERVER_NAME, version: SERVER_VERSION },
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/extension/command") {
        assertToken(req, url, {});
        const clientId = String(url.searchParams.get("clientId") || "");
        if (!clientId || !clients.has(clientId)) {
          writeJson(res, 404, { ok: false, error: "Unknown clientId" });
          return;
        }
        const client = clients.get(clientId);
        client.lastSeenAt = nowIso();
        client.lastSeenMs = Date.now();
        const waitMs = Math.min(COMMAND_WAIT_MS_MAX, Math.max(0, Number(url.searchParams.get("waitMs") || 0) || 0));
        const command = await waitForCommand(clientId, waitMs, req);
        if (clients.get(clientId)) {
          clients.get(clientId).lastSeenAt = nowIso();
          clients.get(clientId).lastSeenMs = Date.now();
        }
        writeJson(res, 200, { ok: true, command });
        return;
      }

      if (req.method === "POST" && url.pathname === "/extension/result") {
        const body = await readRequestBody(req);
        assertToken(req, url, body);
        const client = upsertClient(body);
        const commandId = String(body.commandId || "");
        const pending = pendingCommands.get(commandId);
        if (!pending) {
          writeJson(res, 200, { ok: true, ignored: true });
          return;
        }
        clearTimeout(pending.timer);
        pendingCommands.delete(commandId);
        if (body.ok) {
          pending.resolve({ clientId: client.clientId, result: body.result ?? null });
        } else {
          pending.reject(new Error(String(body.error || "Browser command failed")));
        }
        writeJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/sidepanel/message") {
        const body = await readRequestBody(req);
        assertExtensionOrigin(req);
        assertToken(req, url, body);
        if (!sidePanelChatAdapter?.message) {
          writeJson(res, 503, { ok: false, error: "WodeAppX chat is still starting. Keep WodeAppX open and try again." });
          return;
        }
        const prompt = String(body.prompt || "").trim();
        if (!prompt) {
          writeJson(res, 400, { ok: false, error: "prompt is required" });
          return;
        }
        const result = await sidePanelChatAdapter.message({
          sessionId: String(body.sessionId || ""),
          prompt,
          activeTab: body.activeTab && typeof body.activeTab === "object" ? body.activeTab : null,
        });
        writeJson(res, 200, { ok: true, ...result });
        return;
      }

      // External harness entry (DeepSeek Harness plugin, scripts). Same actions as
      // callBrowserControl; not for Chrome extension origin.
      if (req.method === "POST" && url.pathname === "/agent/call") {
        assertLocalHarnessRequest(req);
        const body = await readRequestBody(req);
        assertToken(req, url, body || {});
        const action = String(body?.action || "").trim();
        if (!AGENT_HTTP_ACTIONS.has(action)) {
          writeJson(res, 400, {
            ok: false,
            error: `Unsupported action: ${action || "(empty)"}. Allowed: ${[...AGENT_HTTP_ACTIONS].join(", ")}`,
          });
          return;
        }
        const args = body?.args && typeof body.args === "object" && !Array.isArray(body.args)
          ? body.args
          : {};
        try {
          const resultText = await call(action, args);
          let result = resultText;
          try {
            result = JSON.parse(resultText);
          } catch {
            // keep string
          }
          writeJson(res, 200, { ok: true, action, result });
        } catch (err) {
          writeJson(res, 502, { ok: false, action, error: String(err?.message || err) });
        }
        return;
      }

      writeJson(res, 404, { ok: false, error: "Not found" });
    } catch (err) {
      writeJson(res, err.status || 500, { ok: false, error: String(err?.message || err) });
    }
  }

  function startTcpBridge() {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => {
        void handleHttp(req, res);
      });
      server.on("error", (err) => {
        tcpBridgeReady = false;
        bridgeError = String(err?.message || err);
        resolve(false);
      });
      server.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
        tcpBridgeReady = true;
        bridgeError = null;
        resolve(true);
      });
    });
  }

  async function startNativeSocketBridge() {
    if (process.platform === "win32") {
      nativeSocketReady = false;
      nativeSocketError = "named_pipe_not_enabled";
      return false;
    }
    try {
      await mkdir(path.dirname(NATIVE_SOCKET_PATH), { recursive: true, mode: 0o700 });
      await rm(NATIVE_SOCKET_PATH, { force: true });
      return await new Promise((resolve) => {
        const server = http.createServer((req, res) => {
          void handleHttp(req, res);
        });
        server.on("error", (err) => {
          nativeSocketReady = false;
          nativeSocketError = String(err?.message || err);
          resolve(false);
        });
        server.listen(NATIVE_SOCKET_PATH, async () => {
          await chmod(NATIVE_SOCKET_PATH, 0o600).catch(() => undefined);
          nativeSocketReady = true;
          nativeSocketError = null;
          resolve(true);
        });
      });
    } catch (err) {
      nativeSocketReady = false;
      nativeSocketError = String(err?.message || err);
      return false;
    }
  }

  function startBridge() {
    if (bridgeStart) return bridgeStart;
    bridgeStart = Promise.all([
      startTcpBridge(),
      startNativeSocketBridge(),
    ]).then(([tcpReady, socketReady]) => {
      bridgeReady = tcpReady || socketReady;
      if (!bridgeReady && !bridgeError) {
        bridgeError = nativeSocketError || "No local browser bridge transport could start";
      }
      return bridgeReady;
    });
    return bridgeStart;
  }

  async function sendBrowserCommand(action, args = {}, options = {}) {
    await startBridge();
    if (!bridgeReady) {
      throw new Error(`Browser bridge is not ready: ${bridgeError || "unknown error"}`);
    }
    const requestedClientId = String(options.clientId || "").trim();
    if (requestedClientId && !clients.has(requestedClientId)) {
      throw new Error(`BROWSER_CLIENT_NOT_FOUND: ${requestedClientId}. Call wodeappx_browser_status and bind a connected clientId.`);
    }
    const rawCdpRequested = action === "page.cdp";
    const requestedClient = requestedClientId ? clients.get(requestedClientId) : null;
    if (rawCdpRequested && requestedClient && !clientSupportsRequiredAction(requestedClient, "page.cdp")) {
      throw new Error(
        `BROWSER_CLIENT_CAPABILITY_MISSING: ${requestedClientId} does not report page.cdp support. Call wodeappx_browser_status and bind browserSession.recommendedRawCdpClientId from WodeAppX Browser Control 1.3.2 or newer.`,
      );
    }
    const clientId = requestedClientId || (rawCdpRequested ? bestClientId("page.cdp") : firstClientId());
    if (!clientId) {
      if (rawCdpRequested) {
        throw new Error(
          "BROWSER_CDP_CLIENT_REQUIRED: no connected extension reports page.cdp support. Install or reload WodeAppX Browser Control 1.3.2 or newer, then call wodeappx_browser_status again.",
        );
      }
      throw new Error(
        `No Chrome extension client is connected. Load WodeAppX Browser Control and set its bridge URL to http://${BRIDGE_HOST}:${BRIDGE_PORT}.`,
      );
    }
    selectedClientId = clientId;
    const commandId = randomUUID();
    enqueueCommand(clientId, { id: commandId, action, args, createdAt: nowIso() });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingCommands.delete(commandId);
        reject(new Error(`Timed out waiting for browser result for ${action}`));
      }, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
      pendingCommands.set(commandId, { resolve, reject, timer, action, clientId });
    });
  }

  async function saveScreenshot(dataUrl, savePath) {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
      throw new Error("Screenshot result did not include an image data URL");
    }
    const match = /^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
    if (!match) throw new Error("Unsupported screenshot data URL");
    const ext = match[1].toLowerCase().includes("jpeg") ? "jpg" : "png";
    const target = savePath
      ? path.resolve(String(savePath))
      : path.join(os.tmpdir(), `${SERVER_NAME}-${Date.now()}.${ext}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(match[2], "base64"));
    return target;
  }

  function stringify(value) {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n...` : text;
  }

  async function call(action, args = {}) {
    await startBridge();
    switch (action) {
      case "status":
        return stringify(status());
      case "tabs": {
        const out = await sendBrowserCommand("tabs.list", { activeOnly: Boolean(args.activeOnly) }, args);
        return stringify({ clientId: out.clientId, tabs: out.result });
      }
      case "open_url": {
        const url = String(args.url || "").trim();
        if (!url) throw new Error("url is required");
        if (isLikelyGenerationAssetUrl(url) && args.allowAssetUrl !== true) {
          return stringify({
            ok: false,
            skipped: true,
            reason: "asset_url_not_opened",
            message: "This looks like an image/media/CDN asset URL. Treat it as a generation/reference input instead of opening it. If the user explicitly asked to inspect this exact URL, call again with allowAssetUrl: true.",
            url,
          });
        }
        const out = await sendBrowserCommand("tabs.open", {
          url,
          newTab: args.newTab !== false,
          tabId: args.tabId,
        }, args);
        return stringify({ clientId: out.clientId, tab: out.result });
      }
      case "read_page": {
        const out = await sendBrowserCommand("page.read", {
          tabId: args.tabId,
          maxChars: Number(args.maxChars || 8000),
          maxElements: Number(args.maxElements || 160),
        }, args);
        return stringify({ clientId: out.clientId, ...out.result });
      }
      case "click": {
        if (!args.nodeId && !args.selector && !args.text) throw new Error("nodeId, selector, or exact text is required");
        const out = await sendBrowserCommand("page.click", {
          tabId: args.tabId,
          nodeId: args.nodeId,
          selector: args.selector,
          text: args.text,
        }, args);
        return stringify({ clientId: out.clientId, ...out.result });
      }
      case "type": {
        const selector = String(args.selector || "").trim();
        const nodeId = String(args.nodeId || "").trim();
        if (!nodeId && !selector) throw new Error("nodeId or selector is required");
        const out = await sendBrowserCommand("page.type", {
          tabId: args.tabId,
          nodeId: nodeId || undefined,
          selector,
          text: String(args.text ?? ""),
          replace: args.replace !== false,
          pressEnter: Boolean(args.pressEnter),
        }, args);
        return stringify({ clientId: out.clientId, ...out.result });
      }
      case "key": {
        const key = String(args.key || "").trim();
        if (!key) throw new Error("key is required");
        const out = await sendBrowserCommand("page.key", {
          tabId: args.tabId,
          nodeId: args.nodeId,
          selector: args.selector,
          key,
        }, args);
        return stringify({ clientId: out.clientId, ...out.result });
      }
      case "eval": {
        const code = String(args.code || "").trim();
        if (!code) throw new Error("code is required");
        const out = await sendBrowserCommand("page.eval", { tabId: args.tabId, code }, args);
        return stringify({ clientId: out.clientId, ...out.result });
      }
      case "screenshot": {
        const out = await sendBrowserCommand("page.screenshot", { tabId: args.tabId }, args);
        const savedPath = await saveScreenshot(out.result?.dataUrl, args.savePath);
        return stringify({
          clientId: out.clientId,
          savedPath,
          tab: out.result?.tab || null,
          mediaRef: { kind: "screenshot", path: savedPath },
          nextActions: ["image_inspect"],
          doNot: "Do not call OpenCode read on this PNG. That embeds full-resolution base64 into session history. A bounded preview is attached for this turn; use browser_eval/snapshot for structured page state.",
        });
      }
      case "execute": {
        const rawAction = String(args.action || "").trim();
        if (!rawAction) throw new Error("action is required");
        const out = await sendBrowserCommand(rawAction, args.args || {}, args);
        return stringify({ clientId: out.clientId, result: out.result });
      }
      case "run": {
        const steps = Array.isArray(args.steps) ? args.steps.filter((step) => step && typeof step === "object") : [];
        if (!steps.length) throw new Error("steps is required");
        if (steps.length > 16) throw new Error("at most 16 steps");
        const timeoutMs = Number(args.timeoutMs || Math.max(DEFAULT_TIMEOUT_MS, steps.length * 8000));
        const out = await sendBrowserCommand("page.run", {
          tabId: args.tabId,
          steps,
        }, { ...args, timeoutMs });
        return stringify({ clientId: out.clientId, ...out.result });
      }
      default:
        throw new Error(`Unknown WodeAppX browser action: ${action}`);
    }
  }

  function setSidePanelChatAdapter(adapter) {
    sidePanelChatAdapter = adapter?.message ? adapter : null;
  }

  return { startBridge, status, bridgeInfo, call, setSidePanelChatAdapter };
}

const root = globalThis;
if (!root[GLOBAL_KEY]) {
  root[GLOBAL_KEY] = createRuntime();
}

export const runtime = root[GLOBAL_KEY];
export const startBridge = () => runtime.startBridge();
export const browserControlStatus = () => runtime.status();
export const browserControlBridgeInfo = () => runtime.bridgeInfo();
export const callBrowserControl = (action, args) => runtime.call(action, args);
export const registerSidePanelChatAdapter = (adapter) => runtime.setSidePanelChatAdapter(adapter);
