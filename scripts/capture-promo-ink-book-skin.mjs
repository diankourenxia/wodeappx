#!/usr/bin/env node
/**
 * Promo screencast: ink-book skin with a long dialogue transcript so
 * 上一开/下一开 page-turns are visibly flipping “理解/对话记录”.
 *
 *   node wodeappx/scripts/capture-promo-ink-book-skin.mjs [--port 9823]
 */

import { mkdirSync, writeFileSync, rmSync, readdirSync, copyFileSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "docs/promo/video/assets");
const outMp4 = path.join(outDir, "ink-book-skin-effect.mp4");

function parseArgs(argv) {
  const opts = { ports: [] };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--port") {
      i += 1;
      opts.ports.push(Number(argv[i]));
    } else if (arg === "-h" || arg === "--help") {
      console.log("Usage: capture-promo-ink-book-skin.mjs [--port N]");
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

async function prepareInkBook(send) {
  return evalExpr(
    send,
    `(() => {
      const shell = document.querySelector(".wapp-workspace-shell");
      if (shell) {
        for (const c of [...shell.classList]) {
          if (c.startsWith("wapp-skin-") && c !== "wapp-skin-ink-book") shell.classList.remove(c);
        }
        shell.classList.add("wapp-skin-ink-book");
        shell.setAttribute("data-wapp-skin", "ink-book");
      }
      try { localStorage.setItem("wodeappx.skin", "ink-book"); } catch {}
      window.dispatchEvent(new CustomEvent("wodeapp:skin-changed", { detail: { skin: "ink-book" } }));

      for (const el of document.querySelectorAll("*")) {
        const t = (el.textContent || "").trim();
        if (t.startsWith("PERF") && el.children.length <= 12) el.style.visibility = "hidden";
      }

      let style = document.getElementById("promo-ink-force-pages");
      if (!style) {
        style = document.createElement("style");
        style.id = "promo-ink-force-pages";
        document.head.appendChild(style);
      }
      // Shorter page height → multiple openings; keep turn animation even if OS prefers reduced motion
      style.textContent = \`
        [data-wodeapp-ink-book] .wapp-ink-book-spread,
        [data-wodeapp-ink-book] .wapp-ink-book-content { max-height: 400px !important; }
        @media (prefers-reduced-motion: reduce) {
          .wapp-skin-ink-book .wapp-ink-book-turn.is-next {
            animation: wapp-ink-spread-turn-next 0.78s cubic-bezier(0.22, 0.61, 0.36, 1) !important;
            opacity: 1 !important;
          }
          .wapp-skin-ink-book .wapp-ink-book-turn.is-prev {
            animation: wapp-ink-spread-turn-prev 0.78s cubic-bezier(0.22, 0.61, 0.36, 1) !important;
            opacity: 1 !important;
          }
          .wapp-skin-ink-book .wapp-ink-book-turn.is-next .wapp-ink-book-turn-shade,
          .wapp-skin-ink-book .wapp-ink-book-turn.is-prev .wapp-ink-book-turn-shade {
            animation: wapp-ink-spread-turn-shade 0.78s ease-in-out !important;
          }
        }
      \`;
      window.dispatchEvent(new Event("resize"));
      return !!document.querySelector("[data-wodeapp-ink-book]");
    })()`,
  );
}

/** Prefer a long script-dialogue session so pages show real 对话/理解记录. */
async function openRichSession(send) {
  const clicked = await evalExpr(
    send,
    `(() => {
      const prefer = [
        /优化第一集视频脚本/,
        /我救的那匹狼.*分镜/,
        /我救的那匹狼/,
        /视频脚本/,
      ];
      const rows = [...document.querySelectorAll(".wapp-recent-item, button, a, [role='button']")];
      for (const re of prefer) {
        const el = rows.find((n) => {
          const t = (n.textContent || "").replace(/\\s+/g, " ").trim();
          return t.length > 4 && t.length < 80 && re.test(t);
        });
        if (el) {
          el.click();
          return (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 60);
        }
      }
      return null;
    })()`,
  );
  await sleep(2800);
  return clicked;
}

async function waitReady(send) {
  for (let i = 0; i < 20; i += 1) {
    const st = await evalExpr(
      send,
      `(() => {
        const label = document.querySelector(".wapp-ink-book-pager-label")?.textContent || "";
        const binding = /装订中/.test(label) || !!document.querySelector(".wapp-ink-book-cover-status");
        const head = (document.querySelector("[data-wodeapp-ink-book]")?.innerText || "").slice(0, 220);
        const hasDialogue = /用户|助手|检测|脚本|已完成|E01|自然/.test(head);
        const m = label.match(/共\\s*(\\d+)\\s*开/);
        const total = m ? Number(m[1]) : 0;
        return { label, binding, hasDialogue, total, head: head.replace(/\\n/g, " | ").slice(0, 160) };
      })()`,
    );
    console.log("ready?", st);
    if (!st?.binding && st?.total >= 3 && st?.hasDialogue) return st;
    if (!st?.binding && st?.total >= 2) return st;
    await sleep(700);
  }
  return null;
}

async function goToSpread(send, targetOneBased) {
  for (let i = 0; i < 40; i += 1) {
    const r = await evalExpr(
      send,
      `(() => {
        const label = document.querySelector(".wapp-ink-book-pager-label")?.textContent || "";
        const m = label.match(/第\\s*(\\d+)\\s*开\\s*\\/\\s*共\\s*(\\d+)\\s*开/);
        const cur = m ? Number(m[1]) : 1;
        const total = m ? Number(m[2]) : 1;
        const want = Math.max(1, Math.min(${targetOneBased}, total));
        const turning = document.querySelector("[data-ink-turning]")?.getAttribute("data-ink-turning");
        if (turning && turning !== "0") return { wait: true, label, cur };
        if (cur === want) return { done: true, label, cur, total };
        const sel = cur < want ? /下一开/ : /上一开/;
        const btn = [...document.querySelectorAll(".wapp-ink-book-pager-btn")].find((b) => sel.test(b.textContent || ""));
        if (!btn || btn.disabled) return { done: true, label, cur, total, stuck: true };
        btn.click();
        return { done: false, label, cur, want };
      })()`,
    );
    if (r?.done) return r;
    await sleep(r?.wait ? 350 : 850);
  }
  return null;
}

async function clickNext(send) {
  return evalExpr(
    send,
    `(() => {
      const turning = document.querySelector("[data-ink-turning]")?.getAttribute("data-ink-turning");
      if (turning && turning !== "0") return { wait: true };
      const next = [...document.querySelectorAll(".wapp-ink-book-pager-btn")].find((b) => /下一开/.test(b.textContent || ""));
      if (!next || next.disabled) {
        return { ok: false, label: document.querySelector(".wapp-ink-book-pager-label")?.textContent };
      }
      next.click();
      return { ok: true, label: document.querySelector(".wapp-ink-book-pager-label")?.textContent };
    })()`,
  );
}

async function recordViaScreenshots(session, seconds, actionEveryMs, action) {
  const frameDir = `${outMp4}.frames`;
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });
  const t0 = Date.now();
  let step = 0;
  let nextAction = t0 + 900;
  while (Date.now() - t0 < seconds * 1000) {
    if (Date.now() >= nextAction) {
      await action(step);
      nextAction = Date.now() + actionEveryMs;
      step += 1;
    }
    const shot = await session.send("Page.captureScreenshot", { format: "jpeg", quality: 90 });
    const n = readdirSync(frameDir).filter((f) => f.endsWith(".jpg")).length;
    writeFileSync(path.join(frameDir, `f-${String(n).padStart(4, "0")}.jpg`), Buffer.from(shot.data, "base64"));
    await sleep(55);
  }
  const n = readdirSync(frameDir).filter((f) => f.endsWith(".jpg")).length;
  const elapsed = (Date.now() - t0) / 1000;
  const fps = n / Math.max(0.5, elapsed);
  // Crop toward book spread (drop most of sidebar) so flip + dialogue read clearly in promo
  const r = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-framerate",
      String(Number(fps.toFixed(3))),
      "-i",
      path.join(frameDir, "f-%04d.jpg"),
      "-vf",
      "crop=iw*0.78:ih*0.82:iw*0.20:ih*0.06,scale=trunc(iw/2)*2:trunc(ih/2)*2",
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
      "-t",
      "8.0",
      "-movflags",
      "+faststart",
      outMp4,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(r.stderr?.slice(-600) || "ffmpeg failed");
  copyFileSync(path.join(frameDir, `f-${String(Math.floor(n * 0.4)).padStart(4, "0")}.jpg`), `${outMp4}.preview.jpg`);
  return { n, fps: Number(fps.toFixed(3)), elapsed, bytes: statSync(outMp4).size };
}

async function main() {
  const opts = parseArgs(process.argv);
  mkdirSync(outDir, { recursive: true });
  const { port, page } = await findCdpPage(opts.ports);
  console.log("CDP", port, page.url);
  const session = cdpSession(page.webSocketDebuggerUrl);
  await session.ready;
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("Page.bringToFront");
  try {
    await session.send("Emulation.clearDeviceMetricsOverride");
  } catch {
    /* */
  }

  console.log("session", await openRichSession(session.send));
  console.log("prepare", await prepareInkBook(session.send));
  await sleep(1500);
  // Re-apply after session mount (book root may remount)
  console.log("prepare2", await prepareInkBook(session.send));
  const ready = await waitReady(session.send);
  if (!ready) throw new Error("ink book not ready with dialogue content");

  // Start on a mid spread that already shows user/assistant 记录 (not sparse page 1 tool log)
  const startAt = Math.min(3, Math.max(2, Math.floor((ready.total || 4) / 3)));
  console.log("goto", await goToSpread(session.send, startAt));
  await sleep(600);

  const head = await evalExpr(
    session.send,
    `(document.querySelector("[data-wodeapp-ink-book]")?.innerText || "").slice(0, 280).replace(/\\n/g, " | ")`,
  );
  console.log("head", head);

  // Stay on content-dense mid spreads (avoid empty late openings): next/next/prev/next/next
  const flipPlan = ["next", "next", "prev", "next", "next"];
  const info = await recordViaScreenshots(session, 8.0, 1400, async (step) => {
    const dir = flipPlan[step];
    if (!dir) return;
    for (let w = 0; w < 8; w += 1) {
      const r =
        dir === "next"
          ? await clickNext(session.send)
          : await evalExpr(
              session.send,
              `(() => {
                const turning = document.querySelector("[data-ink-turning]")?.getAttribute("data-ink-turning");
                if (turning && turning !== "0") return { wait: true };
                const prev = [...document.querySelectorAll(".wapp-ink-book-pager-btn")].find((b) => /上一开/.test(b.textContent || ""));
                if (!prev || prev.disabled) return { ok: false };
                prev.click();
                return { ok: true, label: document.querySelector(".wapp-ink-book-pager-label")?.textContent };
              })()`,
            );
      console.log(dir, step, r);
      if (r?.wait) {
        await sleep(200);
        continue;
      }
      break;
    }
  });

  await evalExpr(session.send, `document.getElementById("promo-ink-force-pages")?.remove();`);
  console.log(JSON.stringify({ ok: true, outMp4, ...info }, null, 2));
  session.ws.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
