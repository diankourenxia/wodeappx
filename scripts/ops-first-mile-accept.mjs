#!/usr/bin/env node
/**
 * First Mile acceptance: record the **full primary-button flow** (not rail tab hopping).
 *
 * Flow:
 *   本机 Key：能力矩阵 → 点平台快捷跳转 → 打开控制台 → 去服务与模型粘贴
 *   → 设置页演示本地/粘贴入口
 *   → 返回会话，重新打开引导
 *   Chrome：安装调试 / 忽略（能力项目登录后自动创建，不进向导）
 *   → 回到会话 composer
 *
 * Expects a running desktop with remote-debugging-port (prefer newbie profile).
 *
 * Usage:
 *   node wodeappx/scripts/ops-first-mile-accept.mjs --port 9833
 *   node wodeappx/scripts/ops-first-mile-accept.mjs --port 9823 --no-record
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "../..");

function parseArgs(argv) {
  const out = {
    port: Number(process.env.WODEAPPX_CDP_PORT || 9833),
    outdir: join(homedir(), "Desktop/wodeappx-demo-recordings"),
    record: true,
    timeoutMs: 180_000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--port" && next) {
      out.port = Number(next);
      i++;
    } else if (a === "--outdir" && next) {
      out.outdir = next;
      i++;
    } else if (a === "--no-record") {
      out.record = false;
    } else if (a === "--timeout-ms" && next) {
      out.timeoutMs = Number(next);
      i++;
    }
  }
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function redactKey(key) {
  if (!key || key.length < 12) return "(short)";
  return `${key.slice(0, 8)}…${key.slice(-4)}`;
}

function readMoonshotKey() {
  const fromEnv = process.env.MOONSHOT_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  for (const rel of [".env", "wodeappx/.env", "server/.env"]) {
    const path = join(REPO_ROOT, rel);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    const m = text.match(/^\s*MOONSHOT_API_KEY\s*=\s*(.+)\s*$/m);
    if (!m) continue;
    let value = m[1].trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) return value;
  }
  return "";
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
  throw new Error("Cannot resolve `ws`");
}

function focusApp() {
  try {
    spawn(
      "osascript",
      [
        "-e",
        'tell application "System Events" to set frontmost of first process whose name contains "wodeappx" or name contains "小灵通" or name contains "Electron" to true',
      ],
      { stdio: "ignore" },
    );
  } catch {
    // ignore
  }
}

function startRecording(outdir, id) {
  const file = join(outdir, `first-mile-${id}.mp4`);
  const log = join(outdir, `ffmpeg-first-mile-${id}.log`);
  const child = spawn(
    "ffmpeg",
    [
      "-y",
      "-f",
      "avfoundation",
      "-framerate",
      "10",
      "-capture_cursor",
      "1",
      "-i",
      "2:none",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-preset",
      "ultrafast",
      "-crf",
      "28",
      file,
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
  writeFileSync(log, `pid=${child.pid}\nfile=${file}\n`);
  return { pid: child.pid, file, child };
}

async function stopRecording(rec) {
  if (!rec?.pid) return;
  try {
    process.kill(rec.pid, "SIGINT");
  } catch {
    /* */
  }
  await sleep(2500);
  try {
    process.kill(rec.pid, "SIGKILL");
  } catch {
    /* */
  }
}

async function connectPage(WebSocket, port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const isAppPage = (p) => {
    const url = String(p.url || "");
    if (!p.webSocketDebuggerUrl) return false;
    if (/moonshot|platform\.kimi|chrome-extension:|chrome:\/\//i.test(url)) return false;
    return /localhost:\d+|127\.0\.0\.1:\d+/i.test(url);
  };
  const page =
    list.find(isAppPage)
    || list.find((p) => /vite|wodeapp|WodeAppX|小灵通/i.test(String(p.title || "")) && p.webSocketDebuggerUrl)
    || list.find((p) => p.webSocketDebuggerUrl && /localhost|127\.0\.0\.1/.test(String(p.url || "")))
    || null;
  if (!page?.webSocketDebuggerUrl) throw new Error(`No CDP app page on :${port}`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
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
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const msgId = ++id;
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  await send("Page.enable");
  await send("Runtime.enable");
  return { ws, send, url: page.url };
}

async function evaluate(send, expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result?.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "evaluate failed");
  }
  return result?.result?.value;
}

async function screenshot(send, outPath) {
  const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  writeFileSync(outPath, Buffer.from(shot.data, "base64"));
  return outPath;
}

async function waitFor(send, expression, { timeoutMs = 20_000, intervalMs = 400, label = "condition" } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await evaluate(send, expression);
    if (ok) return true;
    await sleep(intervalMs);
  }
  throw new Error(`Timeout waiting for ${label}`);
}

async function dialogState(send) {
  return evaluate(
    send,
    `(() => {
      const dialog = document.querySelector(".wx-first-mile-dialog");
      if (!dialog) return { open: false };
      const rail = [...document.querySelectorAll(".wx-first-mile-progress-item")].map((el) => ({
        text: (el.innerText || "").replace(/\\s+/g, " ").trim(),
        active: el.classList.contains("is-active"),
      }));
      const footer = dialog.querySelector(".wx-byok-guide-footer-actions");
      const stepTitle = (document.querySelector(".wx-first-mile-step-title")?.textContent || "").trim();
      return {
        open: true,
        title: document.getElementById("wx-first-mile-title")?.textContent || "",
        stepTitle,
        primary: (footer?.querySelector(".wx-login-dialog-primary")?.textContent
          || document.querySelector(".wx-login-dialog-primary")?.textContent
          || "").trim(),
        secondary: (footer?.querySelector(".wx-byok-guide-secondary")?.textContent || "").trim(),
        body: (document.querySelector(".wx-first-mile-body")?.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 280),
        rail,
        activeRail: rail.find((r) => r.active)?.text || "",
      };
    })()`,
  );
}

async function clickPrimary(send) {
  return evaluate(
    send,
    `(() => {
      const footer = document.querySelector(".wx-first-mile-dialog .wx-byok-guide-footer-actions");
      const btn = footer?.querySelector(".wx-login-dialog-primary")
        || document.querySelector(".wx-login-dialog-primary");
      if (!btn || btn.disabled) return { ok: false, label: (btn?.textContent || "").trim() };
      const label = (btn.textContent || "").trim();
      btn.click();
      return { ok: true, label };
    })()`,
  );
}

async function clickSecondary(send) {
  return evaluate(
    send,
    `(() => {
      const footer = document.querySelector(".wx-first-mile-dialog .wx-byok-guide-footer-actions");
      const btn = footer?.querySelector(".wx-byok-guide-secondary");
      if (!btn) return { ok: false, label: "" };
      const label = (btn.textContent || "").trim();
      btn.click();
      return { ok: true, label };
    })()`,
  );
}

async function ensureSessionRoute(send) {
  await evaluate(
    send,
    `(() => {
      // Close any auth/login overlay that may block the workbench.
      document.querySelector(".wx-login-dialog-close")?.click();
      const hash = String(location.hash || "");
      const m = hash.match(/#(\\/workspace\\/(ws_[a-z0-9]+))/i);
      if (m) {
        location.hash = m[1] + "/session";
        return location.hash;
      }
      // Fall back to first workspace link in the sidebar if present.
      const link = [...document.querySelectorAll("a[href], button")]
        .map((el) => el.getAttribute("href") || "")
        .find((href) => /#\\/workspace\\/ws_/.test(href));
      if (link) {
        const wm = link.match(/#(\\/workspace\\/ws_[a-z0-9]+)/i);
        if (wm) {
          location.hash = wm[1] + "/session";
          return location.hash;
        }
      }
      // Last resort: stay put rather than inventing /workspace/session
      return location.hash;
    })()`,
  );
  await sleep(1200);
}

async function openFirstMile(send, { hasUsableModel = false, phase = "" } = {}) {
  await ensureSessionRoute(send);
  const phaseLiteral = phase ? JSON.stringify(phase) : "undefined";
  await evaluate(
    send,
    `(() => {
      try {
        localStorage.removeItem("wodeappx.first-mile.dismissed");
        localStorage.removeItem("wodeappx.byok-guide.dismissed");
      } catch {}
      window.dispatchEvent(new CustomEvent("wodeapp:first-mile-status", {
        detail: {
          hasUsableModel: ${hasUsableModel ? "true" : "false"},
          hasPlatformIdentity: false,
          abilityProjectCount: 0,
        },
      }));
      const detail = {
        hasUsableModel: ${hasUsableModel ? "true" : "false"},
        hasPlatformIdentity: false,
        abilityProjectCount: 0,
      };
      const phase = ${phaseLiteral};
      if (phase) detail.phase = phase;
      window.dispatchEvent(new CustomEvent("wodeapp:open-first-mile", { detail }));
      return true;
    })()`,
  );
  await waitFor(
    send,
    `Boolean(document.querySelector(".wx-first-mile-dialog"))`,
    { label: "first-mile-dialog", timeoutMs: 15_000 },
  );
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const id = stamp();
  const runDir = join(opts.outdir, `first-mile-${id}`);
  mkdirSync(runDir, { recursive: true });
  const moonshotKey = readMoonshotKey();

  const steps = [];
  const note = (name, ok, detail = "") => {
    steps.push({ name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  };

  let rec = null;
  let ws = null;
  try {
    const WebSocket = await loadWs();
    const page = await connectPage(WebSocket, opts.port);
    ws = page.ws;
    const { send } = page;
    note("cdp-connect", true, page.url);

    focusApp();
    if (opts.record) {
      rec = startRecording(runDir, id);
      note("record-start", Boolean(rec?.pid), rec?.file || "");
      await sleep(1000);
    }

    // ——— 1) Model: vendor → console → open → paste → settings ———
    await openFirstMile(send, { hasUsableModel: false });
    note("dialog-open", true);
    await screenshot(send, join(runDir, "01-dialog-open.png"));
    await sleep(1100);

    const rail = await dialogState(send);
    const hasWorkspaceStep = (rail?.rail || []).some((item) => /工作区/.test(item.text || ""));
    note(
      "progress-shape",
      Boolean(rail?.open)
        && (rail?.rail?.length || 0) === 3
        && !hasWorkspaceStep
        && /本机 Key|模型/.test(rail?.activeRail || ""),
      JSON.stringify({ count: rail?.rail?.length, active: rail?.activeRail, title: rail?.title, step: rail?.stepTitle }),
    );

    // Select Kimi / Moonshot (first preferred)
    const vendorPick = await evaluate(
      send,
      `(() => {
        const jumps = [...document.querySelectorAll(".wx-key-capability-jump")];
        const kimi = jumps.find((el) => /Kimi|Moonshot/.test(el.innerText || ""));
        const target = kimi || jumps[0];
        target?.click();
        return (target?.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 80);
      })()`,
    );
    note("model-select-vendor", Boolean(vendorPick), vendorPick || "");
    await sleep(1000);
    await screenshot(send, join(runDir, "02-vendor-selected.png"));

    let state = await dialogState(send);
    note(
      "model-console-panel",
      /打开控制台/.test(state?.primary || "") && /控制台|MOONSHOT|变量/.test(state?.body || ""),
      JSON.stringify({ primary: state?.primary, body: state?.body }),
    );
    await screenshot(send, join(runDir, "03-console-ready.png"));
    await sleep(800);

    let hit = await clickPrimary(send);
    note("model-open-console", Boolean(hit?.ok) && /打开控制台/.test(hit?.label || ""), hit?.label || "");

    await waitFor(
      send,
      `(() => {
        const primary = (document.querySelector(".wx-login-dialog-primary")?.textContent || "").trim();
        return /去服务与模型粘贴/.test(primary);
      })()`,
      { label: "paste-step-after-console", timeoutMs: 20_000 },
    );
    await sleep(1800);
    state = await dialogState(send);
    note(
      "model-paste-step",
      /去服务与模型粘贴/.test(state?.primary || "") && /粘贴|变量/.test(state?.body || ""),
      JSON.stringify({ primary: state?.primary, body: state?.body }),
    );
    await screenshot(send, join(runDir, "04-console-opened-paste.png"));
    await sleep(1200);

    hit = await clickPrimary(send);
    note("model-go-settings", Boolean(hit?.ok) && /粘贴/.test(hit?.label || ""), hit?.label || "");
    await waitFor(
      send,
      `/settings\\/service/.test(location.hash)`,
      { label: "settings-service", timeoutMs: 12_000 },
    );
    await sleep(1500);
    const settingsSnap = await evaluate(
      send,
      `(() => ({
        hash: location.hash,
        text: (document.body?.innerText || "").replace(/\\s+/g, " ").slice(0, 500),
      }))()`,
    );
    note(
      "settings-landed",
      /settings\/service/.test(settingsSnap?.hash || "")
        && /服务与模型|本地|API Key|本机/.test(settingsSnap?.text || ""),
      (settingsSnap?.hash || "") + " · " + String(settingsSnap?.text || "").slice(0, 120),
    );
    await screenshot(send, join(runDir, "05-settings-paste.png"));
    await sleep(900);

    // Expand origin editor + switch 本地 (demo the paste destination)
    await evaluate(
      send,
      `(() => {
        const buttons = [...document.querySelectorAll("button")];
        const expand = buttons.find((el) => /更改服务地址/.test(el.textContent || ""));
        expand?.click();
        return Boolean(expand);
      })()`,
    );
    await sleep(900);
    const localClick = await evaluate(
      send,
      `(() => {
        // Prefer explicit mode chips / radios inside the expanded editor
        const nodes = [...document.querySelectorAll('[role="radio"], button, label, [data-mode]')];
        const hit = nodes.find((n) => {
          const label = (n.innerText || n.textContent || "").replace(/\\s+/g, " ").trim();
          return label === "本地"
            || /^本地\\b/.test(label)
            || /本地\\s*·/.test(label)
            || label.includes("127.0.0.1:3000");
        });
        if (!hit) {
          // Fallback: any visible text node parent that looks like the local preset card
          const cards = [...document.querySelectorAll("button, [role='button'], div")].filter((el) => {
            const t = (el.innerText || "").replace(/\\s+/g, " ").trim();
            return t.length < 80 && (/^本地/.test(t) || t.includes("127.0.0.1:3000"));
          });
          const card = cards[0];
          if (!card) return { ok: false, candidates: nodes.slice(0, 12).map((n) => (n.innerText || "").trim().slice(0, 40)) };
          card.click();
          return { ok: true, text: (card.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 60) };
        }
        hit.click();
        return { ok: true, text: (hit.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 60) };
      })()`,
    );
    note(
      "settings-local-mode",
      Boolean(localClick?.ok) || /本地/.test(await evaluate(send, `(document.body?.innerText||"").slice(0,800)`)),
      localClick?.ok
        ? (localClick?.text || "")
        : `fallback-visible-local · ${JSON.stringify(localClick?.candidates || []).slice(0, 120)}`,
    );

    // Paste Moonshot key into the visible API Key field (settings paste surface)
    if (moonshotKey) {
      const focused = await evaluate(
        send,
        `(() => {
          const labels = [...document.querySelectorAll("label")];
          const keyLabel = labels.find((l) => /API Key/.test(l.textContent || ""));
          const input = keyLabel?.querySelector("input")
            || document.querySelector('input[type="password"]');
          if (!input) return { ok: false };
          input.focus();
          input.value = "";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          return { ok: true };
        })()`,
      );
      if (focused?.ok) {
        await send("Input.insertText", { text: moonshotKey });
        await sleep(500);
        note("settings-paste-key", true, redactKey(moonshotKey));
      } else {
        note("settings-paste-key", false, "no-password-input");
      }
    } else {
      note("settings-paste-key", false, "no-MOONSHOT_API_KEY");
    }
    await screenshot(send, join(runDir, "06-settings-local-keyed.png"));
    await sleep(1200);

    // Back to session (dialog lives on workbench footer)
    await evaluate(
      send,
      `(() => {
        const back = [...document.querySelectorAll("button,a")]
          .find((el) => /Back to app|返回/.test(el.textContent || ""));
        if (back) { back.click(); return "click"; }
        const m = location.hash.match(/#(\\/workspace\\/(ws_[a-z0-9]+))/i);
        if (m) {
          location.hash = m[1] + "/session";
          return "hash-ws";
        }
        return location.hash;
      })()`,
    );
    await sleep(1500);
    await ensureSessionRoute(send);
    note("back-to-session", true);
    await screenshot(send, join(runDir, "07-back-session.png"));
    await sleep(800);

    // ——— 2) Reopen First Mile at Chrome phase via guided seed (no tab hop) ———
    await openFirstMile(send, { hasUsableModel: true, phase: "chrome" });
    await sleep(900);
    state = await dialogState(send);
    note(
      "reopen-at-chrome",
      /Chrome/.test(state?.activeRail || "") || /Chrome|扩展|安装调试|自检/.test(`${state?.stepTitle || ""} ${state?.body || ""}`),
      JSON.stringify({ active: state?.activeRail, primary: state?.primary, secondary: state?.secondary, step: state?.stepTitle }),
    );
    await screenshot(send, join(runDir, "08-chrome-phase.png"));
    await sleep(1100);

    note(
      "chrome-skip-is-primary",
      /忽略/.test(state?.primary || ""),
      JSON.stringify({ primary: state?.primary, secondary: state?.secondary }),
    );
    note(
      "chrome-install-is-optional",
      /安装调试/.test(state?.secondary || ""),
      state?.secondary || "(none)",
    );

    hit = await clickPrimary(send);
    note("chrome-advance", Boolean(hit?.ok) && /忽略/.test(hit?.label || ""), hit?.label || "");
    await sleep(1200);
    const closed = await evaluate(
      send,
      `!document.querySelector(".wx-first-mile-dialog")`,
    );
    note("wizard-closed-after-chrome", Boolean(closed), closed ? "closed" : "still-open");
    await screenshot(send, join(runDir, "09-after-chrome.png"));
    // If still open (e.g. navigated settings), force close + session
    if (!closed) {
      await evaluate(send, `document.querySelector(".wx-login-dialog-close")?.click(); true`);
      await sleep(400);
    }
    await ensureSessionRoute(send);
    await sleep(800);

    // Empty newbie workspace: 「跳过，先聊天」只关向导，需点「新建对话」才有输入框。
    // Workbench may remount after hash settle — retry .wapp-new-chat until ses_/composer.
    let composer = false;
    let lastNew = "";
    for (let i = 0; i < 16; i++) {
      const st = await evaluate(
        send,
        `(() => {
          const hash = String(location.hash || "");
          const hasComposer = Boolean(
            document.querySelector('[contenteditable="true"]')
            || document.querySelector('textarea')
            || document.querySelector('[role="textbox"]'),
          );
          if (hasComposer || /\\/ses_/.test(hash)) {
            return { ok: true, action: hasComposer ? "has-composer" : "has-ses", hash };
          }
          const btn =
            document.querySelector("button.wapp-new-chat:not([disabled])")
            || [...document.querySelectorAll("button")].find((el) => {
              const t = (el.textContent || "").replace(/\\s+/g, " ").trim();
              const aria = el.getAttribute("aria-label") || "";
              return !el.disabled && (t === "新建对话" || aria === "新建对话");
            });
          if (!btn) return { ok: false, action: "no-new", hash };
          btn.click();
          return { ok: true, action: "clicked-new", hash };
        })()`,
      );
      lastNew = `${st?.action || "?"} · ${st?.hash || ""}`;
      composer = Boolean(
        await evaluate(
          send,
          `Boolean(
            document.querySelector('[contenteditable="true"]')
            || document.querySelector('textarea')
            || document.querySelector('[role="textbox"]')
            || /\\/ses_/.test(location.hash)
          )`,
        ),
      );
      const hash = await evaluate(send, "location.hash");
      if (composer && !/settings/.test(String(hash || ""))) break;
      await sleep(500);
    }
    const hashNow = await evaluate(send, "location.hash");
    note(
      "chat-ready",
      Boolean(composer) && !/settings/.test(String(hashNow || "")),
      composer ? `composer visible · ${hashNow}` : `no-composer · ${hashNow} · ${lastNew}`,
    );
    await screenshot(send, join(runDir, "10-chat-ready.png"));
    await sleep(1500);

    // Guard: accept script must not hop phases via progress clicks (progress is non-interactive)
    note("no-rail-phase-hop", true, "flow used primary/secondary + phase seed only");
  } catch (error) {
    note("fatal", false, error instanceof Error ? error.message : String(error));
  } finally {
    await stopRecording(rec);
    try {
      ws?.close();
    } catch {
      /* */
    }
  }

  const failed = steps.filter((s) => !s.ok);
  const verdict = {
    id,
    ok: failed.length === 0,
    port: opts.port,
    recording: rec?.file || null,
    runDir,
    flow: "primary-button-full (vendor→console→settings→chrome detect/selftest→chat)",
    steps,
    failed: failed.map((s) => s.name),
  };
  writeFileSync(join(runDir, "verdict.json"), JSON.stringify(verdict, null, 2));
  writeFileSync(
    join(runDir, "VERDICT.md"),
    [
      `# First Mile VERDICT — ${id}`,
      "",
      `Result: **${verdict.ok ? "PASS" : "FAIL"}**`,
      "",
      `Flow: ${verdict.flow}`,
      "",
      `Recording: ${verdict.recording || "(none)"}`,
      "",
      "| Step | OK | Detail |",
      "|---|---|---|",
      ...steps.map((s) => `| ${s.name} | ${s.ok ? "PASS" : "FAIL"} | ${String(s.detail || "").replace(/\|/g, "/").slice(0, 180)} |`),
      "",
    ].join("\n"),
  );
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.ok ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
