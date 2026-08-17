#!/usr/bin/env node
/**
 * WodeAppX ops demo recorder — record + drive UI + verdict.
 *
 * Lessons encoded from 2026-08-04 failed demo:
 * 1) Prefer a fresh chat for each capability (new session is enough; no need to abort other chats).
 * 2) Settings demo must switch to **本地** Origin (127.0.0.1:3000), paste Key, 探活, 保存 — not leave 云端.
 * 3) Type via CDP Input.insertText (not brittle DOM textContent).
 * 4) One capability per turn; wait for success/fail gate before next.
 * 5) Do not cut recording mid-Thinking; only stop after gate or hard timeout.
 * 6) Emit machine verdict JSON + human VERDICT.md (PASS/FAIL per step).
 *
 * Usage:
 *   node wodeappx/scripts/ops-demo-record.mjs --port 9823 --scenarios settings,image,cu
 *   node wodeappx/scripts/ops-demo-record.mjs --scenarios settings,image --no-record
 *   node wodeappx/scripts/ops-demo-record.mjs --dry-run   # print plan only
 *
 * Requires: running desktop with --remote-debugging-port, ffmpeg (if recording),
 * and `ws` resolvable (run from vendor/openwork/apps/desktop or NODE_PATH set).
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../..");

function parseArgs(argv) {
  const out = {
    port: Number(process.env.WODEAPPX_CDP_PORT || 9823),
    scenarios: ["settings", "image", "cu"],
    outdir: join(process.env.HOME || ".", "Desktop/wodeappx-demo-recordings"),
    record: true,
    liveSend: true,
    dryRun: false,
    imageTimeoutMs: 180_000,
    cuTimeoutMs: 90_000,
    browserTimeoutMs: 60_000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--port" && next) { out.port = Number(next); i++; }
    else if (a === "--scenarios" && next) { out.scenarios = next.split(",").map((s) => s.trim()).filter(Boolean); i++; }
    else if (a === "--outdir" && next) { out.outdir = next; i++; }
    else if (a === "--no-record") out.record = false;
    else if (a === "--no-live-send") out.liveSend = false;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--image-timeout-ms" && next) { out.imageTimeoutMs = Number(next); i++; }
    else if (a === "--cu-timeout-ms" && next) { out.cuTimeoutMs = Number(next); i++; }
  }
  return out;
}

async function loadWs() {
  const requireFrom = (fromFile) => createRequire(fromFile);
  const tries = [
    () => requireFrom(join(REPO_ROOT, "wodeappx/vendor/openwork/apps/desktop/package.json"))("ws"),
    () => requireFrom(join(REPO_ROOT, "wodeappx/vendor/openwork/package.json"))("ws"),
    async () => (await import("ws")).default,
  ];
  for (const tryLoad of tries) {
    try {
      const mod = await tryLoad();
      return mod?.default || mod;
    } catch {
      // next
    }
  }
  throw new Error("Cannot resolve `ws`. Ensure vendor/openwork deps are installed.");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function focusApp() {
  try {
    spawn("osascript", ["-e", 'tell application "System Events" to set frontmost of first process whose name contains "小灵通" to true'], { stdio: "ignore" });
  } catch {
    // ignore
  }
}

function startRecording(outdir, id) {
  const file = join(outdir, `ops-demo-${id}.mp4`);
  const log = join(outdir, `ffmpeg-${id}.log`);
  const child = spawn(
    "ffmpeg",
    ["-y", "-f", "avfoundation", "-framerate", "10", "-capture_cursor", "1", "-i", "2:none", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast", "-crf", "28", file],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
  writeFileSync(log, `pid=${child.pid}\nfile=${file}\n`);
  return { pid: child.pid, file, child };
}

function stopRecording(rec) {
  if (!rec?.pid) return;
  try { process.kill(rec.pid, "SIGINT"); } catch { /* */ }
  return sleep(2500).then(() => {
    try { process.kill(rec.pid, "SIGKILL"); } catch { /* */ }
  });
}

async function connectPage(WebSocket, port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((p) => p.webSocketDebuggerUrl) || list[0];
  if (!page?.webSocketDebuggerUrl) throw new Error(`No CDP page on :${port}`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  let id = 0;
  const pending = new Map();
  ws.on("message", (raw) => {
    const msg = JSON.parse(String(raw));
    if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, (m) => {
        pending.delete(i);
        if (m.error) reject(new Error(JSON.stringify(m.error)));
        else resolve(m.result);
      });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Input.setIgnoreInputEvents", { ignore: false }).catch(() => {});
  return { ws, send, page };
}

async function evaluate(send, expression) {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r?.exceptionDetails) throw new Error(r.exceptionDetails.text || "evaluate failed");
  return r?.result?.value;
}

async function screenshot(send, outdir, name) {
  const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  const path = join(outdir, `${name}.png`);
  writeFileSync(path, Buffer.from(shot.data, "base64"));
  return path;
}

async function bodySnapshot(send) {
  return evaluate(send, `(() => {
    const t = (document.body?.innerText || "").replace(/\\s+/g, " ");
    return {
      href: location.href,
      text: t,
      tail: t.slice(-1200),
      running: /停止/.test(t) && /运行中|Thinking|排队|生成中/.test(t),
      queued: /已排队/.test(t),
    };
  })()`);
}

async function clickByExactText(send, label) {
  return evaluate(send, `(() => {
    const label = ${JSON.stringify(label)};
    const nodes = [...document.querySelectorAll("button,a,[role=button]")];
    const hit = nodes.find((n) => ((n.innerText || n.textContent || "").trim() === label));
    if (!hit) return { ok: false };
    hit.click();
    return { ok: true };
  })()`);
}

async function clickByRegex(send, pattern) {
  return evaluate(send, `(() => {
    const re = new RegExp(${JSON.stringify(pattern)});
    const nodes = [...document.querySelectorAll("button,a,[role=button]")];
    const hit = nodes.find((n) => re.test((n.innerText || n.textContent || "").trim()));
    if (!hit) return { ok: false, text: null };
    hit.click();
    return { ok: true, text: (hit.innerText || "").trim().slice(0, 40) };
  })()`);
}

function readSavedApiKey() {
  try {
    const cfg = JSON.parse(readFileSync(join(homedir(), ".wodeapp", "config.json"), "utf8"));
    const key = typeof cfg.apiKey === "string" ? cfg.apiKey.trim() : "";
    return key || null;
  } catch {
    return null;
  }
}

function redactKey(key) {
  if (!key || key.length < 12) return "(short)";
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

async function openSettingsService(send) {
  await evaluate(send, `(() => {
    const m = location.hash.match(/#(\\/workspace\\/[^/]+)/);
    location.hash = (m ? m[1] : "#/workspace") + "/settings/service";
    return location.href;
  })()`);
  await sleep(1500);
  return bodySnapshot(send);
}

/** Demo: switch Origin to 本地, paste API Key, 探活, 保存. */
async function configureLocalOriginAndKey(send, { apiKey }) {
  const steps = [];

  // Click 本地 preset (radiogroup)
  const localClick = await evaluate(send, `(() => {
    const radios = [...document.querySelectorAll('[role="radio"], button')];
    const hit = radios.find((n) => {
      const label = (n.innerText || n.textContent || "").replace(/\\s+/g, " ");
      return /^本地\\b/.test(label.trim()) || label.includes("127.0.0.1:3000");
    });
    if (!hit) return { ok: false, reason: "local-preset-not-found" };
    hit.click();
    return { ok: true, text: (hit.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 60) };
  })()`);
  steps.push({ action: "click-local", ...localClick });
  await sleep(800);

  // Focus API Key password input and type
  const focused = await evaluate(send, `(() => {
    const labels = [...document.querySelectorAll("label")];
    const keyLabel = labels.find((l) => /API Key/.test(l.textContent || ""));
    const input = keyLabel?.querySelector("input") || document.querySelector('input[type="password"]');
    if (!input) return { ok: false };
    input.focus();
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    return { ok: true };
  })()`);
  steps.push({ action: "focus-api-key", ...focused });
  if (focused?.ok && apiKey) {
    await send("Input.insertText", { text: apiKey });
    await sleep(400);
    steps.push({ action: "type-api-key", ok: true, preview: redactKey(apiKey) });
  } else {
    steps.push({ action: "type-api-key", ok: false, reason: focused?.ok ? "no-api-key-in-config" : "no-input" });
  }
  await sleep(600);

  const probe = await clickByExactText(send, "探活");
  steps.push({ action: "probe", ...probe });
  await sleep(2500);

  const save = await clickByExactText(send, "保存");
  steps.push({ action: "save", ...save });
  await sleep(2000);

  const snap = await bodySnapshot(send);
  const localOk = /127\.0\.0\.1:3000|本地/.test(snap.text) && !/服务器\s*云端/.test(snap.text);
  // After save, status card should prefer local host
  const statusLocal = /服务器[^\n]*本地|127\.0\.0\.1:3000/.test(snap.text)
    || (/本地/.test(snap.text) && /探活成功|已保存|保存成功|配置已更新/.test(snap.text));
  return { steps, snap, pass: Boolean(localClick?.ok && (statusLocal || localOk) && (apiKey ? focused?.ok : true)) };
}

async function backToApp(send) {
  const clicked = await clickByRegex(send, "Back to app|返回");
  if (!clicked?.ok) {
    await evaluate(send, `(() => {
      const m = location.hash.match(/#(\\/workspace\\/[^/]+)/);
      // Stay on the workspace session root — never use the literal id "new"
      // (OpenCode rejects non-ses_* ids).
      location.hash = (m ? m[1] : "#/workspace") + "/session";
      return location.href;
    })()`);
  }
  await sleep(1000);
  return bodySnapshot(send);
}

async function newSession(send) {
  await clickByExactText(send, "新建对话");
  await sleep(1200);
  await evaluate(send, `(() => {
    if (/settings/.test(location.hash) || !/\\/session/.test(location.hash)) {
      const m = location.hash.match(/#(\\/workspace\\/[^/]+)/);
      location.hash = (m ? m[1] : "#/workspace") + "/session";
    }
    return location.href;
  })()`);
  await sleep(1200);
  return bodySnapshot(send);
}

async function focusComposer(send) {
  return evaluate(send, `(() => {
    const editor = document.querySelector('[contenteditable="true"]');
    editor?.focus();
    return Boolean(editor);
  })()`);
}

async function clearComposer(send) {
  await focusComposer(send);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Meta", code: "MetaLeft", modifiers: 4 });
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 4 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 4 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Meta", code: "MetaLeft", modifiers: 4 });
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace" });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace" });
}

async function typeComposer(send, text) {
  await clearComposer(send);
  await focusComposer(send);
  await send("Input.insertText", { text });
  await sleep(400);
  const preview = await evaluate(send, `(() => {
    const editor = document.querySelector('[contenteditable="true"]');
    return (editor?.innerText || "").trim();
  })()`);
  return { ok: Boolean(preview) && preview.includes(text.slice(0, Math.min(12, text.length))), preview: String(preview || "").slice(0, 120) };
}

async function clickSend(send) {
  return clickByExactText(send, "发送");
}

async function waitForGate(send, {
  timeoutMs,
  success,
  failure,
  pollMs = 3000,
  requireIdle = true,
} = {}) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await bodySnapshot(send);
    const hitFail = failure?.some((re) => re.test(last.text));
    const hitOk = success?.some((re) => re.test(last.text));
    const idle = !last.running && !last.queued;
    if (hitFail) return { ok: false, reason: "failure-pattern", snap: last };
    if (hitOk && (!requireIdle || idle)) return { ok: true, reason: "success-pattern", snap: last };
    await sleep(pollMs);
  }
  return { ok: false, reason: "timeout", snap: last };
}

const SCENARIOS = {
  settings: {
    title: "配置本地 Origin + API Key（探活/保存）",
    async run({ send, outdir, log }) {
      await openSettingsService(send);
      await screenshot(send, outdir, "step-settings-before");
      await sleep(1000);
      const apiKey = readSavedApiKey();
      const configured = await configureLocalOriginAndKey(send, { apiKey });
      await screenshot(send, outdir, "step-settings-after-local");
      await sleep(2000);
      const text = configured.snap?.text || "";
      const pass = Boolean(
        configured.steps.find((s) => s.action === "click-local")?.ok
        && /127\.0\.0\.1:3000|本地/.test(text)
        && /API Key/.test(text)
        && !/服务器\s*云端\s*·\s*wodeapp\.cn/.test(text),
      );
      // Prefer explicit local server line when status hydrated
      const strongLocal = /127\.0\.0\.1:3000/.test(text) || /服务器[\s\S]*本地/.test(text);
      const finalPass = pass && (strongLocal || /探活成功|已保存|保存成功|配置已更新|MCP/.test(text));
      log.push({
        scenario: "settings",
        pass: finalPass,
        keyPreview: apiKey ? redactKey(apiKey) : null,
        steps: configured.steps,
        evidence: text.slice(0, 400),
      });
      await backToApp(send);
      return {
        pass: finalPass,
        detail: finalPass
          ? "switched to local Origin, keyed, probed/saved"
          : `local configure incomplete (localClick/status). tail=${text.slice(0, 160)}`,
      };
    },
  },
  image: {
    title: "生图 ai_generate_image",
    async run({ send, outdir, log, opts }) {
      await newSession(send);
      await screenshot(send, outdir, "step-image-new-session");
      const prompt =
        "只做一件事：调用 ai_generate_image，生成一张简洁白底陶瓷咖啡杯产品图，不要文字。成功后在回复里给出可打开的图片 URL。不要用 bash/echo/写临时文件。";
      const typed = await typeComposer(send, prompt);
      if (!typed.ok) {
        log.push({ scenario: "image", pass: false, evidence: typed });
        return { pass: false, detail: `composer type failed: ${typed.preview}` };
      }
      await screenshot(send, outdir, "step-image-before-send");
      if (!opts.liveSend) return { pass: false, detail: "live send disabled" };
      await clickSend(send);
      await sleep(2000);
      await screenshot(send, outdir, "step-image-after-send");
      const gate = await waitForGate(send, {
        timeoutMs: opts.imageTimeoutMs,
        success: [
          /image-proxy\//i,
          /https?:\/\/\S+\.(png|jpg|jpeg|webp)/i,
          /wodeapp-assets\.oss/i,
          /生成完成|图片 URL|已生成/,
        ],
        failure: [
          /生成图片未完成/,
          /会话已空闲，步骤未正常收尾/,
          /REPLICATE_API_TOKEN not configured/,
          /402|积分不足|Insufficient credits/i,
        ],
        requireIdle: true,
      });
      await screenshot(send, outdir, "step-image-end");
      // Soft-fail if only bash thrash with no URL even if idle
      const thrash = /echo \"retry image generation\"|\/tmp\/placeholder|tool search/.test(gate.snap?.text || "")
        && !/image-proxy\//i.test(gate.snap?.text || "");
      const pass = gate.ok && !thrash;
      log.push({ scenario: "image", pass, gate, thrash, tail: gate.snap?.tail?.slice(0, 400) });
      return {
        pass,
        detail: pass
          ? "image URL / completion signal observed"
          : `image gate ${gate.reason}${thrash ? " + bash thrash" : ""}`,
      };
    },
  },
  cu: {
    title: "Computer Use 权限检查",
    async run({ send, outdir, log, opts }) {
      await newSession(send);
      const prompt =
        "只做一件事：调用 openwork_computer_check_permissions，用一两句话报告辅助功能与屏幕录制是否已授权。不要点击、不要截屏、不要用 bash。";
      const typed = await typeComposer(send, prompt);
      if (!typed.ok) return { pass: false, detail: "composer type failed" };
      await screenshot(send, outdir, "step-cu-before-send");
      if (!opts.liveSend) return { pass: false, detail: "live send disabled" };
      await clickSend(send);
      const gate = await waitForGate(send, {
        timeoutMs: opts.cuTimeoutMs,
        success: [
          /openwork_computer_check_permissions/,
          /辅助功能/,
          /屏幕录制/,
          /accessibility/i,
          /screenRecording|Screen Recording/i,
          /已授权|未授权|权限/,
        ],
        failure: [/Helper binary not found|Failed to run permission check/i],
        requireIdle: true,
      });
      await screenshot(send, outdir, "step-cu-end");
      log.push({ scenario: "cu", pass: gate.ok, gate, tail: gate.snap?.tail?.slice(0, 400) });
      return { pass: gate.ok, detail: gate.ok ? "permissions reported" : `cu gate ${gate.reason}` };
    },
  },
  browser: {
    title: "Chrome 扩展 status",
    async run({ send, outdir, log, opts }) {
      await newSession(send);
      const prompt =
        "只做一件事：调用 wodeappx_browser_status，报告扩展是否已连接（clientId / version）。不要打开网页，不要用 Computer Use 代替。";
      const typed = await typeComposer(send, prompt);
      if (!typed.ok) return { pass: false, detail: "composer type failed" };
      await screenshot(send, outdir, "step-browser-before-send");
      if (!opts.liveSend) return { pass: false, detail: "live send disabled" };
      await clickSend(send);
      const gate = await waitForGate(send, {
        timeoutMs: opts.browserTimeoutMs,
        success: [
          /wodeappx_browser_status/,
          /clientId/,
          /extensionVersion|1\.\d+\.\d+/,
          /已连接|connected/i,
          /Browser Control/,
        ],
        failure: [/BROWSER_CLIENT_NOT_FOUND|clients:\s*\[\]|未连接/],
        requireIdle: true,
      });
      await screenshot(send, outdir, "step-browser-end");
      log.push({ scenario: "browser", pass: gate.ok, gate, tail: gate.snap?.tail?.slice(0, 400) });
      return { pass: gate.ok, detail: gate.ok ? "browser status connected" : `browser gate ${gate.reason}` };
    },
  },
  plugins: {
    title: "插件页 Computer Use / Browser 状态",
    async run({ send, outdir, log }) {
      await evaluate(send, `(() => {
        const m = location.hash.match(/#(\\/workspace\\/[^/]+)/);
        location.hash = (m ? m[1] : "") + "/settings/extensions";
        return location.href;
      })()`);
      await sleep(1500);
      const snap = await bodySnapshot(send);
      await screenshot(send, outdir, "step-plugins");
      const pass = /Computer Use/.test(snap.text) && (/Ready|就绪|Connected|已连接/.test(snap.text));
      log.push({ scenario: "plugins", pass, evidence: snap.tail.slice(0, 240) });
      return { pass, detail: pass ? "plugins page shows CU/Browser ready" : "plugin markers missing" };
    },
  },
};

function writeVerdict(outdir, id, { results, recording, port, scenarios }) {
  const overall = results.every((r) => r.pass) ? "PASS" : "FAIL";
  const verdict = {
    id,
    overall,
    port,
    scenarios,
    recording: recording || null,
    results,
    finishedAt: new Date().toISOString(),
  };
  writeFileSync(join(outdir, `verdict-${id}.json`), JSON.stringify(verdict, null, 2));
  const lines = [
    `# Ops demo verdict — ${id}`,
    "",
    `**Overall: ${overall}**`,
    "",
    recording ? `- Recording: \`${recording}\`` : "- Recording: (disabled)",
    `- CDP port: ${port}`,
    "",
    "| Step | Pass | Detail |",
    "|---|---|---|",
    ...results.map((r) => `| ${r.scenario} | ${r.pass ? "YES" : "NO"} | ${String(r.detail || "").replace(/\|/g, "/")} |`),
    "",
    "## Rules for next run",
    "- Settings: switch to **本地** (127.0.0.1:3000), paste Key, 探活, 保存 — not leave 云端",
    "- New chat per capability (no need to abort other running sessions)",
    "- One prompt per turn; wait for success/fail gate",
    "- Image PASS requires URL / proxy, not only tool_search",
    "- Do not cut recording while Thinking",
    "",
  ];
  writeFileSync(join(outdir, `VERDICT-${id}.md`), lines.join("\n"));
  return verdict;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const id = stamp();
  mkdirSync(opts.outdir, { recursive: true });

  console.log(JSON.stringify({ plan: true, id, ...opts, known: Object.keys(SCENARIOS) }, null, 2));
  if (opts.dryRun) return;

  for (const name of opts.scenarios) {
    if (!SCENARIOS[name]) throw new Error(`Unknown scenario: ${name}. Known: ${Object.keys(SCENARIOS).join(",")}`);
  }

  const WebSocket = await loadWs();
  focusApp();
  await sleep(800);

  let rec = null;
  if (opts.record) {
    if (!existsSync("/usr/local/bin/ffmpeg") && !existsSync("/opt/homebrew/bin/ffmpeg")) {
      console.warn("ffmpeg not found; continuing without recording");
    } else {
      rec = startRecording(opts.outdir, id);
      await sleep(2000);
    }
  }

  const { ws, send } = await connectPage(WebSocket, opts.port);
  const log = [];
  const results = [];

  try {
    await screenshot(send, opts.outdir, "00-start");

    for (const name of opts.scenarios) {
      console.log(JSON.stringify({ step: "scenario-start", name }));
      const result = await SCENARIOS[name].run({ send, outdir: opts.outdir, log, opts });
      results.push({ scenario: name, title: SCENARIOS[name].title, ...result });
      console.log(JSON.stringify({ step: "scenario-end", name, ...result }));
      // dwell so recording shows the end state
      await sleep(2000);
    }
  } finally {
    ws.close();
    await stopRecording(rec);
  }

  const verdict = writeVerdict(opts.outdir, id, {
    results,
    recording: rec?.file || null,
    port: opts.port,
    scenarios: opts.scenarios,
  });
  writeFileSync(join(opts.outdir, `ops-log-${id}.json`), JSON.stringify(log, null, 2));
  console.log(JSON.stringify({ done: true, verdict }, null, 2));
  process.exit(verdict.overall === "PASS" ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
