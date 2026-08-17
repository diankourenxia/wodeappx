#!/usr/bin/env node
/**
 * Capture WodeAppX promo video assets (CDP). Safe-only: own UI screenshots, no third-party product art.
 *
 * Usage:
 *   node wodeappx/scripts/capture-promo-video-assets.mjs
 *   node wodeappx/scripts/capture-promo-video-assets.mjs --record --seconds 4
 */

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");
const outDir = path.join(repoRoot, "wodeappx/docs/promo/video/assets");
const skinsDir = path.join(repoRoot, "wodeappx/docs/promo/skins");

function parseArgs(argv) {
  const opts = { ports: [], record: false, seconds: 4 };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };
    if (arg === "--port") opts.ports.push(Number(next()));
    else if (arg === "--record") opts.record = true;
    else if (arg === "--seconds") opts.seconds = Number(next());
    else if (arg === "-h" || arg === "--help") {
      console.log("Usage: capture-promo-video-assets.mjs [--port N] [--record] [--seconds N]");
      process.exit(0);
    } else throw new Error(`Unknown arg: ${arg}`);
  }
  if (!opts.ports.length) {
    const envPort = Number(process.env.OPENWORK_ELECTRON_REMOTE_DEBUG_PORT || "");
    opts.ports = Number.isFinite(envPort) && envPort > 0 ? [envPort, 9823, 9223] : [9823, 9223];
  }
  return opts;
}

async function listPages(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(800) });
  if (!res.ok) throw new Error(`CDP list HTTP ${res.status}`);
  return res.json();
}

async function findCdpPage(ports) {
  for (const port of ports) {
    try {
      const list = await listPages(port);
      const pages = list.filter((t) => t.type === "page");
      const isEmbed = (t) => /wodeapp\.(cn|ai)\//i.test(t.url || "") && /embed=1|wodeappx=1/i.test(t.url || "");
      const isDevShell = (t) => /(?:localhost|127\.0\.0\.1):517[0-9]/.test(t.url || "");
      const page =
        pages.find((t) => isDevShell(t) && !/\/settings/.test(t.url || "")) ||
        pages.find((t) => /WodeAppX/i.test(t.title || "") && !isEmbed(t)) ||
        pages.find((t) => !isEmbed(t));
      if (page?.webSocketDebuggerUrl) return { port, page };
    } catch {
      /* try next */
    }
  }
  throw new Error("No Electron CDP page on 9823/9223");
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

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function applySkinAndTheme(send, skinId, theme) {
  const className = `wapp-skin-${skinId}`;
  await send("Runtime.evaluate", {
    expression: `(() => {
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
      return "ok";
    })()`,
    returnByValue: true,
  });
  await sleep(700);
}

async function capturePng(send, outPath) {
  const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  writeFileSync(outPath, Buffer.from(shot.data, "base64"));
}

async function clickInkBookNext(send) {
  const res = await send("Runtime.evaluate", {
    expression: `(() => {
      const candidates = [...document.querySelectorAll("button, [role='button'], a")];
      const next = candidates.find((el) => {
        const t = (el.textContent || "").replace(/\s+/g, "");
        return t.includes("下一页") || t.includes("下页") || t === "›" || t === "→";
      });
      if (next) {
        next.click();
        return { ok: true, text: (next.textContent || "").trim().slice(0, 40) };
      }
      const pageCtrl = document.querySelector("[class*='page'], [class*='book'], [class*='scroll']");
      if (pageCtrl) {
        pageCtrl.scrollBy?.(320, 0);
        return { ok: true, mode: "scroll" };
      }
      return { ok: false };
    })()`,
    returnByValue: true,
  });
  return res?.result?.value || { ok: false };
}

async function captureScreencast(send, onEvent, outMp4, seconds) {
  const frames = [];
  const off = onEvent((msg) => {
    if (msg.method !== "Page.screencastFrame") return;
    const { data, sessionId } = msg.params || {};
    if (typeof sessionId === "number") void send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    if (data) frames.push({ data });
  });

  await send("Page.startScreencast", {
    format: "jpeg",
    quality: 88,
    maxWidth: 1920,
    maxHeight: 1080,
    everyNthFrame: 1,
  });

  const end = Date.now() + seconds * 1000;
  let flipAt = seconds * 0.45;
  while (Date.now() < end) {
    const elapsed = (Date.now() - (end - seconds * 1000)) / 1000;
    if (elapsed >= flipAt) {
      await clickInkBookNext(send);
      flipAt = seconds + 1;
    }
    await sleep(100);
  }

  await send("Page.stopScreencast").catch(() => {});
  off();

  if (frames.length < 5) return { ok: false, frames: frames.length };

  const frameDir = `${outMp4}.frames`;
  mkdirSync(frameDir, { recursive: true });
  frames.forEach((frame, i) => {
    writeFileSync(path.join(frameDir, `f-${String(i).padStart(4, "0")}.jpg`), Buffer.from(frame.data, "base64"));
  });

  const ff = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-framerate",
      "12",
      "-i",
      path.join(frameDir, "f-%04d.jpg"),
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
  return { ok: ff.status === 0, frames: frames.length };
}

function copySafeBatchTiles() {
  const batchDir = path.join(outDir, "batch");
  mkdirSync(batchDir, { recursive: true });
  const safe = [
    ["ink-book-light.png", "ui-inkbook-page.png"],
    ["summer-breeze-light.png", "ui-summer.png"],
    ["pet-soft-light.png", "ui-pet.png"],
    ["cute-pastel-light.png", "ui-pastel.png"],
    ["ink-book-light.png", "ui-inkbook.png"],
    ["red-compact-light.png", "ui-red.png"],
  ];
  for (const [src, dst] of safe) {
    copyFileSync(path.join(skinsDir, src), path.join(batchDir, dst));
  }
  return safe.map(([, dst]) => path.join(batchDir, dst));
}

async function main() {
  const opts = parseArgs(process.argv);
  mkdirSync(outDir, { recursive: true });

  const { port, page } = await findCdpPage(opts.ports);
  const session = cdpSession(page.webSocketDebuggerUrl);
  await session.ready;
  await session.send("Page.enable");
  await session.send("Runtime.enable");

  const manifest = { capturedAt: new Date().toISOString(), port, assets: [] };

  // Before skin
  await applySkinAndTheme(session.send, "red-compact", "light");
  const beforePath = path.join(outDir, "workspace-default.png");
  await capturePng(session.send, beforePath);
  manifest.assets.push({ id: "workspace-default", path: beforePath });

  // Ink book pages
  await applySkinAndTheme(session.send, "ink-book", "light");
  const pages = ["ink-book-page1.png", "ink-book-page2.png", "ink-book-page3.png"];
  for (let i = 0; i < pages.length; i += 1) {
    const p = path.join(outDir, pages[i]);
    await capturePng(session.send, p);
    manifest.assets.push({ id: pages[i], path: p });
    if (i < pages.length - 1) {
      const click = await clickInkBookNext(session.send);
      manifest.assets.push({ id: `flip-${i + 1}`, click });
      await sleep(900);
    }
  }

  if (opts.record) {
    await applySkinAndTheme(session.send, "ink-book", "light");
    const mp4 = path.join(outDir, "ink-book-flip.mp4");
    const rec = await captureScreencast(session.send, session.onEvent, mp4, opts.seconds);
    manifest.assets.push({ id: "ink-book-flip", mp4, rec });
  }

  const batchTiles = copySafeBatchTiles();
  manifest.assets.push({ id: "batch-tiles", paths: batchTiles, note: "own UI skins only" });

  const manifestPath = path.join(outDir, "capture-manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, manifestPath, count: manifest.assets.length }, null, 2));
  session.ws.close();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
