#!/usr/bin/env node
/**
 * Promo capture: 图片智能体 / 视频智能体 batch UI (studio embed), NOT 生成历史.
 *
 * Opens agents via WodeAppX nav, then records the *embed* page with
 * Page.captureScreenshot (main-shell screencast often shows blank embed).
 *
 *   node wodeappx/scripts/capture-promo-agent-batch.mjs [--port 9823]
 */

import { mkdirSync, writeFileSync, rmSync, readdirSync, copyFileSync, statSync } from "node:fs";
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
      console.log("Usage: capture-promo-agent-batch.mjs [--port N]");
      process.exit(0);
    } else throw new Error(`Unknown arg: ${arg}`);
  }
  if (!opts.ports.length) opts.ports = [9823, 9223];
  return opts;
}

async function findCdp(ports) {
  for (const port of ports) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(800) })).json();
      const main = list.find((t) => t.type === "page" && /localhost:517[0-9]/.test(t.url || ""));
      if (main?.webSocketDebuggerUrl) return { port, list, main };
    } catch {
      /* next */
    }
  }
  throw new Error("No Electron CDP");
}

function cdpSession(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
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
  return { ws, ready, send };
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

async function listPages(port) {
  return (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
}

async function openAgent(mainSend, label) {
  await evalExpr(
    mainSend,
    `(() => {
      const btn = [...document.querySelectorAll("button.wapp-nav-subitem")].find((b) =>
        (b.textContent || "").includes(${JSON.stringify(label)}),
      );
      btn?.click();
    })()`,
  );
  await sleep(700);
  await evalExpr(
    mainSend,
    `(() => {
      const a = [...document.querySelectorAll("a")].find(
        (el) => (el.textContent || "").replace(/\\s+/g, " ").trim() === ${JSON.stringify(`${label}打开`)},
      );
      a?.click();
    })()`,
  );
  await sleep(3200);
}

async function getEmbed(port, pred) {
  for (let i = 0; i < 12; i += 1) {
    const list = await listPages(port);
    const emb = list.find((t) => t.type === "page" && /wodeapp\.(cn|ai)/.test(t.url || ""));
    if (emb?.webSocketDebuggerUrl) {
      const s = cdpSession(emb.webSocketDebuggerUrl);
      await s.ready;
      await s.send("Runtime.enable");
      await s.send("Page.enable");
      try {
        await s.send("Page.bringToFront");
      } catch {
        /* */
      }
      const head = await evalExpr(s.send, `(document.body.innerText || "").slice(0, 400)`);
      if (!pred || pred(head)) return { s, head, url: emb.url };
      s.ws.close();
    }
    await sleep(700);
  }
  return null;
}

async function recordViaScreenshots(session, outMp4, seconds, actionEveryMs, action) {
  const frameDir = `${outMp4}.frames`;
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });
  const t0 = Date.now();
  let step = 0;
  let nextAction = t0;
  while (Date.now() - t0 < seconds * 1000) {
    if (Date.now() >= nextAction) {
      await action(step);
      nextAction = Date.now() + actionEveryMs;
      step += 1;
    }
    const shot = await session.send("Page.captureScreenshot", { format: "jpeg", quality: 88 });
    const n = readdirSync(frameDir).filter((f) => f.endsWith(".jpg")).length;
    writeFileSync(path.join(frameDir, `f-${String(n).padStart(4, "0")}.jpg`), Buffer.from(shot.data, "base64"));
    await sleep(95);
  }
  const n = readdirSync(frameDir).filter((f) => f.endsWith(".jpg")).length;
  const elapsed = (Date.now() - t0) / 1000;
  const fps = n / Math.max(0.5, elapsed);
  const r = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-framerate",
      String(Number(fps.toFixed(3))),
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
      "-r",
      "30",
      "-g",
      "30",
      "-movflags",
      "+faststart",
      outMp4,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(r.stderr?.slice(-500) || "ffmpeg failed");
  copyFileSync(path.join(frameDir, `f-${String(Math.floor(n * 0.45)).padStart(4, "0")}.jpg`), `${outMp4}.preview.jpg`);
  return { n, fps: Number(fps.toFixed(3)), elapsed, bytes: statSync(outMp4).size };
}

async function main() {
  const opts = parseArgs(process.argv);
  mkdirSync(outDir, { recursive: true });
  const { port, main: mainPage } = await findCdp(opts.ports);
  console.log("CDP", port, mainPage.url);
  const main = cdpSession(mainPage.webSocketDebuggerUrl);
  await main.ready;
  await main.send("Runtime.enable");
  await main.send("Page.enable");
  await main.send("Page.bringToFront");

  // —— 图片智能体 ——
  await openAgent(main.send, "图片智能体");
  let emb = await getEmbed(port, (h) => /AI 商品视觉|历史|\d+\s*张/.test(h));
  if (!emb) throw new Error("no image-agent embed");
  console.log("IMG", emb.head.slice(0, 140).replace(/\n/g, " | "));
  await evalExpr(emb.s.send, `(() => { [...document.querySelectorAll('button,span,a,[role="tab"]')].find((n) => /历史/.test(n.textContent || ""))?.click(); })()`);
  await sleep(900);

  const outImg = path.join(outDir, "agent-batch-images.mp4");
  const rImg = await recordViaScreenshots(emb.s, outImg, 7.2, 850, async (step) => {
    await evalExpr(
      emb.s.send,
      `(() => {
        const step = ${step};
        const panels = [...document.querySelectorAll("div")].filter((d) => d.scrollHeight > d.clientHeight + 50);
        panels.sort((a, b) => b.clientHeight - a.clientHeight)[0]?.scrollBy?.(0, 130);
        if (step === 2) {
          const row = [...document.querySelectorAll("button,div")].find(
            (n) => /\\d+\\s*张/.test(n.textContent || "") && (n.textContent || "").length < 120,
          );
          row?.click();
        }
        if (step === 4) {
          const b = [...document.querySelectorAll("button")].find((n) => /套用|展开|▼/.test(n.textContent || ""));
          b?.click();
        }
      })()`,
    );
  });
  console.log("rImg", rImg);
  emb.s.ws.close();

  // —— 视频智能体 ——
  await openAgent(main.send, "视频智能体");
  emb = await getEmbed(
    port,
    (h) =>
      (/镜|已出片|分镜|场景/.test(h) && !/AI 商品视觉工作室/.test(h)) ||
      (/历史\s*\(\d+\)/.test(h) && /镜|场景|已出片/.test(h)),
  );
  if (!emb) emb = await getEmbed(port, (h) => /历史\s*\(\d+\)/.test(h) && !/AI 商品视觉工作室/.test(h));
  if (!emb) throw new Error("no video-agent embed");
  console.log("VID", emb.head.slice(0, 160).replace(/\n/g, " | "));
  await evalExpr(emb.s.send, `(() => { [...document.querySelectorAll('button,span,a,[role="tab"]')].find((n) => /历史/.test(n.textContent || ""))?.click(); })()`);
  await sleep(1000);

  const outVid = path.join(outDir, "agent-batch-videos.mp4");
  const rVid = await recordViaScreenshots(emb.s, outVid, 7.2, 850, async (step) => {
    await evalExpr(
      emb.s.send,
      `(() => {
        const step = ${step};
        const panels = [...document.querySelectorAll("div")].filter((d) => d.scrollHeight > d.clientHeight + 50);
        panels.sort((a, b) => b.clientHeight - a.clientHeight)[0]?.scrollBy?.(0, 140);
        if (step === 2) {
          const row = [...document.querySelectorAll("button,div,a")].find(
            (n) => /\\d+\\s*镜|打开|已出片|短剧/.test(n.textContent || "") && (n.textContent || "").length < 100,
          );
          row?.click();
        }
      })()`,
    );
  });
  console.log("rVid", rVid);
  emb.s.ws.close();
  main.ws.close();
  console.log("DONE", { outImg, outVid });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
