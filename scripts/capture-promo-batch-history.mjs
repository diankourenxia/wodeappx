#!/usr/bin/env node
/**
 * Promo screencast: WodeAppX 生成历史 — 图片批量 / 视频批量（壳内智能体产物，非裸贴图）
 *
 *   node wodeappx/scripts/capture-promo-batch-history.mjs [--port 9823]
 */

import { mkdirSync, rmSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "docs/promo/video/assets/batch");

function parseArgs(argv) {
  const opts = { ports: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") {
      i += 1;
      opts.ports.push(Number(argv[i]));
    } else if (arg === "-h" || arg === "--help") {
      console.log("Usage: capture-promo-batch-history.mjs [--port N]");
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

async function applySkin(send, skinId = "ink-book", theme = "light") {
  await evalExpr(
    send,
    `(() => {
      const shell = document.querySelector(".wapp-workspace-shell");
      if (!shell) return "no-shell";
      const className = ${JSON.stringify(`wapp-skin-${skinId}`)};
      for (const c of [...shell.classList]) {
        if (c.startsWith("wapp-skin-") && c !== className) shell.classList.remove(c);
      }
      shell.classList.add(className);
      shell.setAttribute("data-wapp-skin", ${JSON.stringify(skinId)});
      try { localStorage.setItem("wodeappx.skin", ${JSON.stringify(skinId)}); } catch {}
      document.documentElement.dataset.theme = ${JSON.stringify(theme)};
      document.documentElement.style.colorScheme = ${JSON.stringify(theme)};
      try { localStorage.setItem("openwork.react.settings.theme-mode", ${JSON.stringify(theme)}); } catch {}
      window.dispatchEvent(new CustomEvent("wodeapp:skin-changed", { detail: { skin: ${JSON.stringify(skinId)} } }));
      return "ok";
    })()`,
  );
  await sleep(500);
}

async function clickLabel(send, matcher, { maxLen = 40 } = {}) {
  return evalExpr(
    send,
    `(() => {
      const matcher = ${JSON.stringify(matcher)};
      const maxLen = ${maxLen};
      const re = new RegExp(matcher);
      const nodes = [...document.querySelectorAll('button,a,span,div,[role="tab"],[role="menuitem"],[role="button"]')];
      let best = null;
      let bestScore = 1e9;
      for (const n of nodes) {
        const t = (n.textContent || "").replace(/\\s+/g, " ").trim();
        if (!t || t.length > maxLen) continue;
        if (!re.test(t)) continue;
        const score = n.children.length * 20 + t.length;
        if (score < bestScore) {
          best = n;
          bestScore = score;
        }
      }
      best?.scrollIntoView?.({ block: "center", inline: "nearest" });
      best?.click();
      return best ? (best.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80) : null;
    })()`,
  );
}

async function openGenerationHistory(send) {
  for (let i = 0; i < 2; i += 1) {
    await evalExpr(send, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await sleep(150);
  }
  const hit = await clickLabel(send, "^生成历史$", { maxLen: 12 });
  if (!hit) await clickLabel(send, "生成历史", { maxLen: 12 });
  await sleep(1600);
  const ok = await evalExpr(send, `document.body.innerText.includes("生成历史")`);
  if (!ok) throw new Error("failed to open 生成历史");
}

async function recordClip(session, outMp4, seconds, actions) {
  const { send, onEvent } = session;
  const frameDir = `${outMp4}.frames`;
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });
  const frames = [];
  const off = onEvent((msg) => {
    if (msg.method !== "Page.screencastFrame") return;
    const { data, sessionId } = msg.params || {};
    if (typeof sessionId === "number") void send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    if (data) frames.push(data);
  });
  await send("Page.startScreencast", {
    format: "jpeg",
    quality: 88,
    maxWidth: 1920,
    maxHeight: 1200,
    everyNthFrame: 2,
  });
  const t0 = Date.now();
  await actions();
  while (Date.now() - t0 < seconds * 1000) await sleep(40);
  const elapsed = Math.max(0.5, (Date.now() - t0) / 1000);
  await send("Page.stopScreencast").catch(() => {});
  off();
  if (!frames.length) throw new Error(`0 frames for ${outMp4}`);
  frames.forEach((d, i) => {
    writeFileSync(path.join(frameDir, `f-${String(i).padStart(4, "0")}.jpg`), Buffer.from(d, "base64"));
  });
  // Use real capture rate so duration matches wall clock (do not clamp too low — stretches the clip).
  const fps = Math.max(12, Math.min(60, Math.round(frames.length / elapsed)));
  const r = spawnSync(
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
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outMp4,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(r.stderr?.slice(-500) || "ffmpeg failed");
  writeFileSync(`${outMp4}.preview.jpg`, Buffer.from(frames[Math.floor(frames.length * 0.45)], "base64"));
  return { frames: frames.length, fps, elapsed, bytes: statSync(outMp4).size };
}

async function scrollHistory(send, dy = 150) {
  await evalExpr(
    send,
    `(() => {
      const panels = [...document.querySelectorAll("div")].filter((d) => d.scrollHeight > d.clientHeight + 80);
      const sc = panels.sort((a, b) => b.clientHeight - a.clientHeight)[0];
      sc?.scrollBy?.(0, ${dy});
      return sc ? sc.clientHeight : 0;
    })()`,
  );
}

async function openFirstBatchCard(send, kind) {
  return evalExpr(
    send,
    `(() => {
      const kind = ${JSON.stringify(kind)};
      const cards = [...document.querySelectorAll("button,a,div")].filter((n) => {
        const t = (n.innerText || "").replace(/\\s+/g, " ");
        if (t.length < 8 || t.length > 280) return false;
        if (kind === "image") return /图片/.test(t) && /\\d+\\s*张|seedream|图片/.test(t);
        return /视频/.test(t) && /(条|seedance|15s|视频)/.test(t);
      });
      const card = cards.sort((a, b) => a.innerText.length - b.innerText.length)[0];
      card?.click();
      return card ? (card.innerText || "").slice(0, 90) : null;
    })()`,
  );
}

async function main() {
  const opts = parseArgs(process.argv);
  mkdirSync(outDir, { recursive: true });
  const { port, page } = await findCdpPage(opts.ports);
  console.log("cdp", port, page.url);
  const session = cdpSession(page.webSocketDebuggerUrl);
  await session.ready;
  await session.send("Runtime.enable");
  await session.send("Page.enable");
  await session.send("Page.bringToFront");

  await applySkin(session.send, "ink-book", "light");
  await openGenerationHistory(session.send);

  // —— Images ——
  console.log("tab", await clickLabel(session.send, "^图片\\s*\\d+$|^图片\\d+$", { maxLen: 16 }));
  await sleep(900);
  const imgHead = await evalExpr(session.send, `document.body.innerText.slice(0, 280)`);
  console.log("imgHead", imgHead?.slice(0, 200));

  const outImg = path.join(outDir, "agent-batch-images.mp4");
  const rImg = await recordClip(session, outImg, 7.6, async () => {
    await sleep(600);
    for (let i = 0; i < 3; i += 1) {
      await scrollHistory(session.send, 130);
      await sleep(480);
    }
    console.log("open img card", await openFirstBatchCard(session.send, "image"));
    await sleep(1400);
    console.log(
      "insert?",
      await clickLabel(session.send, "插入到对话|继续对话|打开对话|预览", { maxLen: 20 }),
    );
    await sleep(1600);
  });
  console.log("rImg", rImg);

  for (let i = 0; i < 3; i += 1) {
    await evalExpr(session.send, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await sleep(180);
  }
  await openGenerationHistory(session.send);

  // —— Videos ——
  console.log("tab", await clickLabel(session.send, "^视频\\s*\\d+$|^视频\\d+$", { maxLen: 16 }));
  await sleep(900);
  const vidHead = await evalExpr(session.send, `document.body.innerText.slice(0, 280)`);
  console.log("vidHead", vidHead?.slice(0, 200));

  const outVid = path.join(outDir, "agent-batch-videos.mp4");
  const rVid = await recordClip(session, outVid, 7.6, async () => {
    await sleep(600);
    for (let i = 0; i < 3; i += 1) {
      await scrollHistory(session.send, 130);
      await sleep(480);
    }
    console.log("open vid card", await openFirstBatchCard(session.send, "video"));
    await sleep(1400);
    console.log(
      "play?",
      await clickLabel(session.send, "插入到对话|播放|预览|打开", { maxLen: 20 }),
    );
    await sleep(1600);
  });
  console.log("rVid", rVid);

  session.ws.close();
  console.log("DONE", { outImg, outVid });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
