#!/usr/bin/env node
/**
 * L4 desktop First Mile inspect (read-only CDP).
 * Does not click, paste keys, or change the running session.
 *
 *   node scripts/oss-l4-desktop-inspect.mjs
 *   node scripts/oss-l4-desktop-inspect.mjs --port 9823 --screenshot
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadWs() {
  const requireFrom = (fromFile) => createRequire(fromFile);
  const tries = [
    () => requireFrom(path.join(root, "vendor/openwork/apps/desktop/package.json"))("ws"),
    () => requireFrom(path.join(root, "vendor/openwork/package.json"))("ws"),
  ];
  for (const tryLoad of tries) {
    try {
      const mod = tryLoad();
      return mod?.default || mod;
    } catch {
      // next
    }
  }
  throw new Error("Cannot resolve `ws`");
}

function parseArgs(argv) {
  const ports = [];
  let screenshot = false;
  let out = path.join(root, "test-results", "oss-verify", "l4-desktop.json");
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--port" && next) {
      ports.push(Number(next));
      i += 1;
    } else if (arg === "--screenshot") {
      screenshot = true;
    } else if (arg === "--out" && next) {
      out = next;
      i += 1;
    }
  }
  const envPort = Number(process.env.OPENWORK_ELECTRON_REMOTE_DEBUG_PORT || process.env.WODEAPPX_CDP_PORT || "");
  if (!ports.length) {
    if (Number.isFinite(envPort) && envPort > 0) ports.push(envPort);
    ports.push(9823, 9223, 9833);
  }
  return { ports: [...new Set(ports)], screenshot, out };
}

async function listPages(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(800) });
  if (!res.ok) throw new Error(`CDP list HTTP ${res.status}`);
  return res.json();
}

async function findCdpPage(ports) {
  const errors = [];
  for (const port of ports) {
    try {
      const list = await listPages(port);
      const pages = list.filter((t) => t.type === "page");
      const isEmbed = (t) => /wodeapp\.(cn|ai)\//i.test(t.url || "") && /embed=1|wodeappx=1/i.test(t.url || "");
      const isDevShell = (t) => /(?:localhost|127\.0\.0\.1):517[0-9]/.test(t.url || "");
      const page =
        pages.find((t) => isDevShell(t) && !/\/settings/.test(t.url || ""))
        || pages.find((t) => isDevShell(t))
        || pages.find((t) => /WodeAppX/i.test(t.title || "") && !isEmbed(t))
        || pages.find((t) => /wodeapp|openwork|5174|5175/i.test(`${t.title} ${t.url}`) && !isEmbed(t))
        || pages.find((t) => !/google\.com|chrome:\/\//i.test(t.url || "") && !isEmbed(t));
      if (page?.webSocketDebuggerUrl) return { port, page };
      errors.push(`port ${port}: no page target`);
    } catch (error) {
      errors.push(`port ${port}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { error: errors.join("; ") };
}

function cdpSession(WebSocket, wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  const ready = new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
    setTimeout(() => reject(new Error("CDP websocket timeout")), 8000);
  });
  function send(method, params = {}) {
    const msgId = ++id;
    return new Promise((resolve, reject) => {
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
      setTimeout(() => {
        if (pending.has(msgId)) {
          pending.delete(msgId);
          reject(new Error(`CDP timeout ${method}`));
        }
      }, 8000);
    });
  }
  return { ws, ready, send };
}

const INSPECT_EXPRESSION = `(() => {
  const text = (el) => (el?.innerText || el?.textContent || "").trim();
  const allText = text(document.body).slice(0, 1200);
  const buttons = [...document.querySelectorAll("button, [role=button]")].map((el) => text(el)).filter(Boolean);
  return {
    title: document.title,
    hasShell: Boolean(document.querySelector(".wapp-workspace-shell")),
    hasComposer: Boolean(document.querySelector(".wapp-composer-card, textarea, [contenteditable=true]")),
    hasSettings: Boolean(document.querySelector(".wapp-settings-shell, [data-settings], a[href*='settings']")) || /\\/settings/.test(location.pathname),
    firstMileDialog: Boolean(document.querySelector(".wx-first-mile-dialog")),
    firstMileCue: Boolean(document.querySelector(".is-first-mile-cue")),
    cloudLoginButton: buttons.some((label) => label.includes("云端登录") || label.includes("登录")),
    chromeInstallButton: buttons.some((label) => label.includes("安装调试")),
    chromeIgnoreButton: buttons.some((label) => label === "忽略"),
    startChip: buttons.some((label) => label.includes("开始使用")),
    desktopOtp: /验证码/.test(allText) && /手机号|邮箱/.test(allText),
  };
})()`;

async function main() {
  const options = parseArgs(process.argv);
  const found = await findCdpPage(options.ports);
  const report = {
    schemaVersion: 1,
    layer: "L4",
    startedAt: new Date().toISOString(),
    verdict: "FAIL",
    notes: [],
    inspect: null,
  };
  mkdirSync(path.dirname(options.out), { recursive: true });

  if (found.error) {
    report.verdict = "INCONCLUSIVE";
    report.notes.push(`no desktop CDP: ${found.error}`);
    writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`[oss-l4] INCONCLUSIVE → ${options.out}`);
    process.exit(2);
  }

  const session = cdpSession(loadWs(), found.page.webSocketDebuggerUrl);
  await session.ready;
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  const evaluated = await session.send("Runtime.evaluate", {
    expression: INSPECT_EXPRESSION,
    returnByValue: true,
    awaitPromise: true,
  });
  const inspect = evaluated?.result?.value || {};
  report.inspect = { port: found.port, url: found.page.url, cdpTitle: found.page.title, ...inspect };

  const titleOk = /WodeAppX|我的AppX|wodeappx/i.test(`${inspect.title || ""} ${found.page.title || ""}`);
  const shellOk = inspect.hasShell === true || inspect.hasComposer === true || inspect.hasSettings === true;
  const noDesktopOtp = inspect.desktopOtp !== true;
  if (titleOk && shellOk && noDesktopOtp) {
    report.verdict = "PASS";
    report.notes.push("running desktop title/shell/composer OK; no desktop OTP form in view");
    if (!inspect.firstMileDialog && !inspect.firstMileCue && !inspect.startChip) {
      report.notes.push("First Mile dialog not open (likely already configured); unit tests cover the wizard contract");
    }
  } else {
    report.notes.push(`titleOk=${titleOk} shellOk=${shellOk} noDesktopOtp=${noDesktopOtp}`);
  }

  if (options.screenshot) {
    try {
      const shot = await session.send("Page.captureScreenshot", { format: "png" });
      const png = path.join(path.dirname(options.out), "l4-desktop.png");
      writeFileSync(png, Buffer.from(shot.data, "base64"));
      report.notes.push(`screenshot ${png}`);
    } catch (error) {
      report.notes.push(`screenshot skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  session.ws.close();
  report.finishedAt = new Date().toISOString();
  writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[oss-l4] ${report.verdict} → ${options.out}`);
  if (report.verdict !== "PASS") process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
