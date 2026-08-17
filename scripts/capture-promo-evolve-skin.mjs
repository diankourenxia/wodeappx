#!/usr/bin/env node
/**
 * Promo screencast: clean session → type `/自进化` + ink-book prompt → apply skin → page turn.
 * Does NOT send the message (no credits). Skips garbled chat history by creating a fresh session.
 *
 *   node wodeappx/scripts/capture-promo-evolve-skin.mjs [--port 9823]
 */

import { mkdirSync, writeFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "docs/promo/video/assets");
const outMp4 = path.join(outDir, "evolve-skin-type.mp4");

const PROMPT =
  "/自进化 给工作台做一套水墨书卷皮肤：线装书开页、宣纸底、印章点缀，对话像翻书阅读。";

function parseArgs(argv) {
  const opts = { ports: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") {
      i += 1;
      opts.ports.push(Number(argv[i]));
    } else if (arg === "-h" || arg === "--help") {
      console.log("Usage: capture-promo-evolve-skin.mjs [--port N]");
      process.exit(0);
    } else throw new Error(`Unknown arg: ${arg}`);
  }
  if (!opts.ports.length) opts.ports = [9823, 9223];
  return opts;
}

async function findCdpPage(ports) {
  for (const port of ports) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(800) });
      if (!res.ok) continue;
      const list = await res.json();
      const page =
        list.find((t) => t.type === "page" && /localhost:517[0-9]/.test(t.url || "")) ||
        list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return { port, page };
    } catch {
      /* next */
    }
  }
  throw new Error("No Electron CDP page");
}

function cdpSession(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    if (msg.method) for (const fn of listeners) fn(msg);
  };
  const ready = new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  function send(method, params = {}) {
    const msgId = ++id;
    return new Promise((resolve, reject) => {
      pending.set(msgId, { resolve, reject });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }
  function onEvent(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  return { ws, ready, send, onEvent };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evalExpr(send, expression) {
  const res = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res?.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res?.result?.value;
}

async function applySkinAndTheme(send, skinId, theme) {
  const className = `wapp-skin-${skinId}`;
  await evalExpr(
    send,
    `(() => {
      const shell = document.querySelector(".wapp-workspace-shell");
      if (!shell) return "no-shell";
      for (const c of [...shell.classList]) {
        if (c.startsWith("wapp-skin-") && c !== ${JSON.stringify(className)}) shell.classList.remove(c);
      }
      shell.classList.add(${JSON.stringify(className)});
      shell.setAttribute("data-wapp-skin", ${JSON.stringify(skinId)});
      try { localStorage.setItem("wodeappx.skin", ${JSON.stringify(skinId)}); } catch {}
      try { localStorage.setItem("wodeappx.product-desk", "default"); } catch {}
      document.documentElement.dataset.theme = ${JSON.stringify(theme)};
      document.documentElement.style.colorScheme = ${JSON.stringify(theme)};
      try { localStorage.setItem("openwork.react.settings.theme-mode", ${JSON.stringify(theme)}); } catch {}
      window.dispatchEvent(new CustomEvent("wodeapp:skin-changed", { detail: { skin: ${JSON.stringify(skinId)} } }));
      return "ok";
    })()`,
  );
  await sleep(550);
}

async function clickExact(send, label) {
  return evalExpr(
    send,
    `(() => {
      const want = ${JSON.stringify(label)};
      const nodes = [...document.querySelectorAll('button,a,span,div,[role="button"]')];
      let best = null;
      let bestScore = 1e9;
      for (const n of nodes) {
        const t = (n.textContent || "").replace(/\\s+/g, " ").trim();
        if (t !== want) continue;
        const score = n.children.length * 20 + t.length;
        if (score < bestScore) {
          best = n;
          bestScore = score;
        }
      }
      best?.scrollIntoView?.({ block: "center" });
      best?.click();
      return best ? want : null;
    })()`,
  );
}

async function newCleanSession(send) {
  for (let i = 0; i < 2; i += 1) {
    await evalExpr(send, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await sleep(120);
  }
  // Leave assets / agent embed surfaces
  await clickExact(send, "默认智能体");
  await sleep(400);
  const hit = await clickExact(send, "新建对话");
  if (!hit) throw new Error("新建对话 not found");
  await sleep(1800);
  // Wait for empty home (no long garbled transcript)
  for (let i = 0; i < 12; i += 1) {
    const st = await evalExpr(
      send,
      `(() => {
        const t = document.body.innerText || "";
        const ed = document.querySelector('[contenteditable="true"]');
        return {
          ed: !!ed,
          home: /想做什么/.test(t),
          messy: /browser eval|capture start|KV4[0-9]|未完成/.test(t),
          len: t.length,
        };
      })()`,
    );
    console.log("session", st);
    if (st?.ed && st.home && !st.messy) return st;
    if (st?.ed && !st.messy && st.len < 2500) return st;
    await sleep(500);
  }
  // Soft fail: still proceed if composer exists and not obviously messy
  const ok = await evalExpr(
    send,
    `!!document.querySelector('[contenteditable="true"]') && !/browser eval|capture start未完成/.test(document.body.innerText||"")`,
  );
  if (!ok) throw new Error("clean session not ready");
  return { soft: true };
}

async function hidePerfHud(send) {
  await evalExpr(
    send,
    `(() => {
      for (const el of document.querySelectorAll("*")) {
        const t = (el.textContent || "").trim();
        if (t.startsWith("PERF") && el.children.length <= 12) {
          el.style.visibility = "hidden";
          return "hid";
        }
      }
      return "none";
    })()`,
  );
}

async function getComposerRect(send) {
  return evalExpr(
    send,
    `(() => {
      const ed = document.querySelector('.wapp-composer-dock [contenteditable="true"], .wapp-composer-shell [contenteditable="true"], [contenteditable="true"][role="textbox"]');
      if (!ed) return null;
      const r = ed.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + Math.min(24, r.height / 2), w: r.width, h: r.height, left: r.left, top: r.top, bottom: r.bottom, right: r.right, vh: innerHeight, vw: innerWidth };
    })()`,
  );
}

async function focusComposer(send) {
  const rect = await getComposerRect(send);
  if (!rect) throw new Error("composer not found");
  const x = Math.round(rect.x);
  const y = Math.round(rect.y);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  await sleep(120);
  await clearComposer(send);
  return rect;
}

async function clearComposer(send) {
  await evalExpr(
    send,
    `(() => {
      const ed = document.querySelector('[contenteditable="true"][role="textbox"], .wapp-composer-shell [contenteditable="true"]');
      if (!ed) return "missing";
      ed.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      ed.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
      return "cleared";
    })()`,
  );
}

async function typePrompt(send, text) {
  for (const ch of [...text]) {
    await send("Input.insertText", { text: ch });
    const delay = ch === "/" ? 140 : /[\u4e00-\u9fff]/.test(ch) ? 70 : 35;
    await sleep(delay);
  }
}

async function pageTurn(send) {
  // Prefer 下一开 then 上一开 so pager motion is visible
  const next = await clickExact(send, "下一开");
  await sleep(900);
  const prev = await clickExact(send, "上一开");
  await sleep(900);
  const next2 = await clickExact(send, "下一开");
  await sleep(1100);
  return { next, prev, next2 };
}

async function encodeFrames(frameDir, outPath, fps) {
  const ff = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-framerate",
      String(fps),
      "-i",
      path.join(frameDir, "f-%04d.jpg"),
      "-vf",
      "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v",
      "libx264",
      "-profile:v",
      "main",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "30",
      "-keyint_min",
      "30",
      "-movflags",
      "+faststart",
      outPath,
    ],
    { encoding: "utf8" },
  );
  if (ff.status !== 0) {
    console.error(ff.stderr?.slice(-800));
    throw new Error("ffmpeg failed");
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  mkdirSync(outDir, { recursive: true });

  const { port, page } = await findCdpPage(opts.ports);
  console.log("CDP", port, page.title || page.url);
  const session = cdpSession(page.webSocketDebuggerUrl);
  await session.ready;
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("Input.enable").catch(() => {});
  await session.send("Page.bringToFront");
  try {
    await session.send("Emulation.clearDeviceMetricsOverride");
  } catch {
    /* */
  }

  // Prep OFF-camera: clean skin + clean session (no garbled transcript)
  await applySkinAndTheme(session.send, "red-compact", "light");
  await hidePerfHud(session.send);
  console.log("new clean session");
  await newCleanSession(session.send);
  await clearComposer(session.send);
  await sleep(600);

  const pre = await evalExpr(
    session.send,
    `({head:(document.body.innerText||"").slice(0,220), messy:/browser eval|capture start|KV4/.test(document.body.innerText||""), home:/想做什么/.test(document.body.innerText||"")})`,
  );
  console.log("pre-record", pre);
  if (pre?.messy) throw new Error("refusing to record messy transcript");

  const frames = [];
  const t0 = Date.now();
  const off = session.onEvent((msg) => {
    if (msg.method !== "Page.screencastFrame") return;
    const { data, sessionId } = msg.params || {};
    if (typeof sessionId === "number") void session.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    if (data) frames.push(data);
  });

  await session.send("Page.startScreencast", {
    format: "jpeg",
    quality: 88,
    maxWidth: 1920,
    maxHeight: 1200,
    everyNthFrame: 1,
  });

  // 0–1.0s establishing clean home (composer already mid-lower, no history mess)
  await sleep(1000);
  console.log("focus composer");
  await focusComposer(session.send);
  await sleep(500);

  console.log("type prompt");
  await typePrompt(session.send, PROMPT);
  await sleep(900);

  console.log("switch → ink-book");
  await applySkinAndTheme(session.send, "ink-book", "light");
  await sleep(1200);

  console.log("page turn", await pageTurn(session.send));
  await sleep(900);

  const elapsed = Math.max(0.5, (Date.now() - t0) / 1000);
  await session.send("Page.stopScreencast").catch(() => {});
  off();

  console.log("frames", frames.length, "elapsed", elapsed.toFixed(2));
  if (frames.length < 30) throw new Error(`too few frames: ${frames.length}`);

  const frameDir = `${outMp4}.frames`;
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });
  frames.forEach((data, i) => {
    writeFileSync(path.join(frameDir, `f-${String(i).padStart(4, "0")}.jpg`), Buffer.from(data, "base64"));
  });

  const fps = Math.max(6, Math.min(48, frames.length / elapsed));
  await encodeFrames(frameDir, outMp4, Number(fps.toFixed(3)));

  writeFileSync(path.join(outDir, "evolve-skin-after.jpg"), Buffer.from(frames[frames.length - 1], "base64"));
  writeFileSync(
    path.join(outDir, "evolve-skin-mid.jpg"),
    Buffer.from(frames[Math.floor(frames.length * 0.45)], "base64"),
  );

  await clearComposer(session.send);

  console.log(
    JSON.stringify(
      {
        ok: true,
        outMp4,
        frames: frames.length,
        fps,
        elapsed,
        bytes: statSync(outMp4).size,
        prompt: PROMPT,
      },
      null,
      2,
    ),
  );
  session.ws.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
