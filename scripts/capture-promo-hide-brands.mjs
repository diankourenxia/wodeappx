#!/usr/bin/env node
/**
 * Recapture promo stills with 苏泊尔 / 摩飞 (and known SKUs) hidden.
 * Does not restart the desktop app.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const batchDir = path.join(root, "docs/promo/video/assets/batch");
const featDir = path.join(root, "docs/promo/video/assets/features");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HIDE_JS = `(() => {
  const re = /苏泊尔|摩飞|SUPOR|Morphy|SW-?10Y10QA|10Y10QA|有钛/i;
  const hide = new Set();
  for (const el of document.querySelectorAll("div, li, article, section, a, button")) {
    const t = (el.innerText || "").trim();
    if (!t || t.length > 500 || !re.test(t)) continue;
    let n = el;
    for (let i = 0; i < 10 && n && n !== document.body; i++) {
      const r = n.getBoundingClientRect();
      if (r.height >= 56 && r.height <= 320 && r.width >= 180) break;
      n = n.parentElement;
    }
    if (n && n !== document.body) hide.add(n);
  }
  for (const n of hide) n.style.setProperty("display", "none", "important");
  return hide.size;
})()`;

async function findCdp(ports = [9823, 9223]) {
  for (const port of ports) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(800) })).json();
      const main = list.find((t) => t.type === "page" && /localhost:517[0-9]/.test(t.url || "") && !/[?&]embed=1\b/.test(t.url || ""));
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

async function evalExpr(send, expression) {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (res?.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res?.result?.value;
}

async function shot(send, outPath) {
  const png = await send("Page.captureScreenshot", { format: "jpeg", quality: 86, fromSurface: true });
  writeFileSync(outPath, Buffer.from(png.data, "base64"));
}

async function clickIncludes(send, selector, text) {
  return evalExpr(
    send,
    `(() => {
      const needle = ${JSON.stringify(text)};
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((n) =>
        (n.textContent || "").replace(/\\s+/g, " ").includes(needle),
      );
      if (!el) return { ok: false, needle };
      el.click();
      return { ok: true };
    })()`,
  );
}

async function main() {
  mkdirSync(batchDir, { recursive: true });
  mkdirSync(featDir, { recursive: true });
  const { port, main: mainPage, list } = await findCdp();
  const main = cdpSession(mainPage.webSocketDebuggerUrl);
  await main.ready;
  await main.send("Runtime.enable");
  await main.send("Page.enable");

  const log = {};

  await clickIncludes(main.send, "button.wapp-nav-subitem, .wapp-nav-subitem", "图片智能体");
  await sleep(700);
  await evalExpr(
    main.send,
    `(() => { [...document.querySelectorAll("a")].find((el) => (el.textContent || "").trim() === "图片智能体打开")?.click(); })()`,
  );
  await sleep(2800);

  let embed = list.concat(await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
    .find((t) => t.type === "page" && /wodeapp\.(cn|ai)/.test(t.url || ""));
  for (let i = 0; i < 10 && !embed?.webSocketDebuggerUrl; i++) {
    await sleep(400);
    embed = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())
      .find((t) => t.type === "page" && /wodeapp\.(cn|ai)/.test(t.url || ""));
  }
  if (!embed?.webSocketDebuggerUrl) throw new Error("no studio embed");
  const emb = cdpSession(embed.webSocketDebuggerUrl);
  await emb.ready;
  await emb.send("Runtime.enable");
  await emb.send("Page.enable");
  await evalExpr(emb.send, `(() => { [...document.querySelectorAll("button,span,a,[role=tab]")].find((n) => /历史/.test(n.textContent || ""))?.click(); })()`);
  await sleep(800);
  log.imageHidden = await evalExpr(emb.send, HIDE_JS);
  await sleep(200);
  const imgOut = path.join(batchDir, "agent-batch-images.mp4.preview.jpg");
  await shot(emb.send, imgOut);
  log.imageText = await evalExpr(emb.send, `(document.body.innerText || "").slice(0, 500)`);
  emb.ws.close();

  await clickIncludes(main.send, ".wapp-nav-item, button", "数字资产");
  await sleep(1200);
  log.assetsHidden = await evalExpr(main.send, HIDE_JS);
  await sleep(200);
  const assetsOut = path.join(featDir, "digital-assets.jpg");
  await shot(main.send, assetsOut);
  log.assetsText = await evalExpr(main.send, `(document.body.innerText || "").slice(0, 500)`);

  main.ws.close();
  process.stdout.write(`${JSON.stringify({ ok: true, imgOut, assetsOut, log }, null, 2)}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
