#!/usr/bin/env node
/**
 * Isolated OSS install/login/key walkthrough via CDP.
 * Does not touch the user's running desktop (default 9823).
 *
 *   node scripts/oss-install-login-qa.mjs --port 9833
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "test-results", "oss-verify", "install-qa");

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
  let port = 9833;
  let step = "inspect";
  let click = "";
  let text = "";
  let shotName = "";
  let evalExpr = "";
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[++i] ? argv[i] : "";
    if (arg === "--port") port = Number(next);
    else if (arg === "--step") step = next || "inspect";
    else if (arg === "--click") click = next;
    else if (arg === "--text") text = next;
    else if (arg === "--shot") shotName = next;
    else if (arg === "--eval") evalExpr = next;
    else i -= 1;
  }
  return { port, step, click, text, shotName, evalExpr };
}

async function listPages(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
  if (!res.ok) throw new Error(`CDP list HTTP ${res.status}`);
  return res.json();
}

function pickPage(list) {
  return list.find((t) => t.type === "page" && /wodeapp|openwork|5174|5175|file:\/\//i.test(`${t.title} ${t.url}`))
    || list.find((t) => t.type === "page" && !/devtools:\/\//i.test(t.url || "") && !/chrome:\/\//i.test(t.url || ""));
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
    setTimeout(() => reject(new Error("CDP websocket timeout")), 12000);
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
      }, 20000);
    });
  }
  return { ws, ready, send };
}

const INSPECT_EXPRESSION = `(() => {
  const text = (el) => (el?.innerText || el?.textContent || "").trim();
  const allText = text(document.body).slice(0, 2500);
  const buttons = [...document.querySelectorAll("button, [role=button]")].map((el) => text(el)).filter(Boolean);
  const dialogs = [...document.querySelectorAll("[role=dialog], .wx-first-mile-dialog, .wx-login-dialog, .wx-local-key-dialog, .wx-media-byok")]
    .map((el) => ({
      cls: el.className,
      title: text(el.querySelector("h2, h3")),
      excerpt: text(el).slice(0, 400),
    }));
  return {
    title: document.title,
    href: location.href,
    hasShell: Boolean(document.querySelector(".wapp-workspace-shell")),
    firstMileDialog: Boolean(document.querySelector(".wx-first-mile-dialog")),
    localKeyDialog: Boolean(document.querySelector(".wx-local-key-dialog")),
    cloudRegionDialog: Boolean(document.querySelector(".wx-cloud-region-dialog")),
    mediaByok: Boolean(document.querySelector(".wx-media-byok, #wx-media-byok-title")),
    startChip: buttons.some((label) => label.includes("开始使用")),
    cloudLoginButton: buttons.some((label) => label.includes("云端登录")),
    goConfigure: buttons.some((label) => label.includes("去配置")),
    chromeInstall: buttons.some((label) => label.includes("安装调试")),
    desktopOtp: /验证码/.test(allText) && /手机号|邮箱/.test(allText),
    buttons: buttons.slice(0, 40),
    dialogs,
    excerpt: allText.slice(0, 800),
    workspace: text(document.querySelector("[data-workspace-name], .wapp-workspace-title, .wapp-sidebar-project-name")) || "",
    composer: text(document.querySelector('[contenteditable="true"]')).slice(0, 400),
    stopVisible: buttons.some((label) => label === "停止" || label === "Stop"),
    bodyTail: allText.slice(-1200),
  };
})()`;

const BODY_EXPRESSION = `(() => {
  const text = (document.body?.innerText || "").trim();
  const composer = (document.querySelector('[contenteditable="true"]')?.innerText || "").trim();
  const buttons = [...document.querySelectorAll("button, [role=button]")].map((el) => (el.innerText || "").trim()).filter(Boolean);
  return {
    href: location.href,
    composer,
    stopVisible: buttons.some((label) => label === "停止" || label === "Stop"),
    sendVisible: buttons.some((label) => label === "发送"),
    newSessionVisible: buttons.some((label) => label === "新建对话"),
    promoteVisible: Boolean(document.getElementById("__wodeappx-promote-btn")),
    skin: document.documentElement.getAttribute("data-skin") || document.body?.dataset?.skin || "",
    excerpt: text.slice(0, 1500),
    bodyTail: text.slice(-1800),
  };
})()`;

const CLICK_EXPRESSION = (needle) => `(() => {
  const needle = ${JSON.stringify(needle)};
  const text = (el) => (el?.innerText || el?.textContent || "").replace(/\\s+/g, " ").trim();
  const nodes = [...document.querySelectorAll("button, [role=button], a")];
  const el = nodes.find((node) => text(node).includes(needle));
  if (!el) return { ok: false, available: nodes.map(text).filter(Boolean).slice(0, 40) };
  el.click();
  return { ok: true, clicked: text(el).slice(0, 120) };
})()`;

async function waitForPage(port, tries = 40) {
  let last = "";
  for (let i = 0; i < tries; i += 1) {
    try {
      const list = await listPages(port);
      const page = pickPage(list);
      if (page?.webSocketDebuggerUrl) return page;
      last = `no page in ${list.length} targets`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`CDP ${port} not ready: ${last}`);
}

async function evalValue(session, expression) {
  const evaluated = await session.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  return evaluated?.result?.value;
}

async function screenshot(session, name) {
  const params = { format: "png" };
  if (name.includes("cta") || name.includes("clip")) {
    params.clip = { x: 0, y: 44, width: 280, height: 220, scale: 1 };
  }
  const shot = await session.send("Page.captureScreenshot", params);
  writeFileSync(path.join(outDir, name), Buffer.from(shot.data, "base64"));
  return name;
}

async function typeIntoComposer(session, text) {
  const focused = await evalValue(session, `(() => {
    const editor = document.querySelector('[contenteditable="true"], textarea, [role="textbox"]');
    editor?.focus();
    editor?.click?.();
    return { tag: editor?.tagName || "", role: editor?.getAttribute?.("role") || "", found: Boolean(editor) };
  })()`);
  await session.send("Input.insertText", { text });
  await new Promise((r) => setTimeout(r, 400));
  const typed = await evalValue(session, `(() => {
    const editor = document.querySelector('[contenteditable="true"], textarea, [role="textbox"]');
    return editor?.innerText || editor?.value || "";
  })()`);
  return { focused, typed };
}

async function main() {
  const options = parseArgs(process.argv);
  mkdirSync(outDir, { recursive: true });
  const page = await waitForPage(options.port, options.step === "wait" ? 90 : 8);
  const session = cdpSession(loadWs(), page.webSocketDebuggerUrl);
  await session.ready;
  await session.send("Page.enable");
  await session.send("Runtime.enable");

  const step = options.step;
  const clickNeedle = options.click || (step === "new-session" ? "新建对话" : "");
  let extra = {};

  if (options.evalExpr) {
    extra.eval = await evalValue(session, options.evalExpr);
    await new Promise((r) => setTimeout(r, 600));
  }

  if (clickNeedle) {
    extra.click = await evalValue(session, CLICK_EXPRESSION(clickNeedle));
    await new Promise((r) => setTimeout(r, 800));
  }

  if (step === "type" || step === "live-send") {
    extra.typed = await typeIntoComposer(session, options.text);
  }
  if (step === "send" || step === "live-send") {
    extra.send = await evalValue(session, CLICK_EXPRESSION("发送"));
    await new Promise((r) => setTimeout(r, 1200));
  }

  const inspectExpr = step === "body" || step === "live-send" || step === "poll" ? BODY_EXPRESSION : INSPECT_EXPRESSION;
  const inspect = (await evalValue(session, inspectExpr)) || {};
  const shotName = options.shotName || `${step}.png`;
  try {
    inspect.screenshot = await screenshot(session, shotName);
  } catch (error) {
    inspect.screenshotError = error instanceof Error ? error.message : String(error);
  }
  const report = {
    step,
    click: clickNeedle || undefined,
    extra,
    inspect,
    url: page.url,
    title: page.title,
  };
  writeFileSync(path.join(outDir, "last.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(outDir, `${step}.json`), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  session.ws.close();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
