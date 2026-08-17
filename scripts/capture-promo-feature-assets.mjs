#!/usr/bin/env node
/**
 * Capture landing-page feature screenshots from a live desktop (CDP 9823/9223).
 * Starts a new empty chat, then walks nav surfaces.
 *
 *   node wodeappx/scripts/capture-promo-feature-assets.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "docs/promo/video/assets/features");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function findCdpPage(ports = [9823, 9223]) {
  for (const port of ports) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(800) });
      if (!res.ok) continue;
      const list = await res.json();
      const pages = (list || []).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
      const page =
        pages.find((t) => /localhost:517[0-9]/.test(t.url || "") && !/[?&]embed=1\b/.test(t.url || "")) ||
        pages.find((t) => t.type === "page");
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

async function evalJson(send, expression) {
  const res = await send("Runtime.evaluate", { expression, returnByValue: true });
  return res?.result?.value;
}

async function clickCss(send, selector) {
  return evalJson(
    send,
    `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { ok: false, selector: ${JSON.stringify(selector)} };
      el.click();
      return { ok: true, selector: ${JSON.stringify(selector)} };
    })()`,
  );
}

async function clickIncludes(send, selector, text) {
  return evalJson(
    send,
    `(() => {
      const needle = ${JSON.stringify(text)};
      const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const el = els.find((n) => (n.textContent || "").replace(/\\s+/g, " ").includes(needle));
      if (!el) {
        return {
          ok: false,
          needle,
          found: els.slice(0, 16).map((n) => (n.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 48)),
        };
      }
      el.click();
      return { ok: true, text: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80) };
    })()`,
  );
}

async function capturePng(send, outPath) {
  const box = await evalJson(
    send,
    `(() => {
      const shell = document.querySelector(".wapp-workspace-shell");
      if (!shell) return null;
      const r = shell.getBoundingClientRect();
      return {
        x: Math.max(0, r.x),
        y: Math.max(0, r.y),
        width: Math.min(innerWidth - Math.max(0, r.x), r.width),
        height: Math.min(innerHeight - Math.max(0, r.y), r.height),
      };
    })()`,
  );
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    ...(box && box.width > 40
      ? {
          clip: {
            x: Math.floor(box.x),
            y: Math.floor(box.y),
            width: Math.max(1, Math.ceil(box.width)),
            height: Math.max(1, Math.ceil(box.height)),
            scale: 2,
          },
        }
      : {}),
  });
  writeFileSync(outPath, Buffer.from(shot.data, "base64"));
}

async function setLightCutePastel(send) {
  await evalJson(
    send,
    `(() => {
      try {
        localStorage.setItem("wodeappx.skin", "cute-pastel");
        localStorage.setItem("openwork.react.settings.theme-mode", "light");
      } catch {}
      document.documentElement.dataset.theme = "light";
      document.documentElement.style.colorScheme = "light";
      window.dispatchEvent(new Event("wodeapp:open-skin-picker"));
      return true;
    })()`,
  );
  await sleep(400);
  const clicked = await clickIncludes(send, ".wapp-skin-picker-card, [role='option']", "可爱马卡龙");
  if (!clicked?.ok) {
    await evalJson(send, `document.querySelector(".wapp-skin-picker-close")?.click()`);
    throw new Error(`skin picker: ${JSON.stringify(clicked)}`);
  }
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const skin = await evalJson(
      send,
      `document.querySelector(".wapp-workspace-shell")?.getAttribute("data-wapp-skin")`,
    );
    if (skin === "cute-pastel") break;
    await sleep(150);
  }
  await evalJson(send, `document.querySelector(".wapp-skin-picker-close")?.click()`);
  await sleep(500);
}

async function hidePerf(send) {
  await evalJson(
    send,
    `(() => {
      document.querySelectorAll(".wapp-perf-hud, .wapp-perf, #wapp-perf").forEach((el) => {
        el.style.display = "none";
      });
      return true;
    })()`,
  );
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const { page } = await findCdpPage();
  const session = cdpSession(page.webSocketDebuggerUrl);
  await session.ready;
  await session.send("Page.enable");
  await session.send("Runtime.enable");

  const log = [];
  try {
    await hidePerf(session.send);
    const newChat = await clickCss(session.send, ".wapp-new-chat");
    log.push({ newChat });
    await sleep(900);

    await setLightCutePastel(session.send);
    await hidePerf(session.send);

    const shots = [
      { name: "empty-chat.png", prep: async () => clickIncludes(session.send, ".wapp-nav-item, button", "默认智能体") },
      { name: "digital-assets.png", prep: async () => clickIncludes(session.send, ".wapp-nav-item, button", "数字资产") },
      { name: "capabilities.png", prep: async () => clickIncludes(session.send, ".wapp-nav-item, button", "能力中心") },
      { name: "image-agent.png", prep: async () => clickIncludes(session.send, ".wapp-nav-subitem, button", "图片智能体") },
      { name: "video-agent.png", prep: async () => clickIncludes(session.send, ".wapp-nav-subitem, button", "视频智能体") },
      {
        name: "models-settings.png",
        prep: async () => clickCss(session.send, '.wapp-icon-button[aria-label*="设置"]'),
      },
    ];

    for (const shot of shots) {
      const prep = await shot.prep();
      await sleep(1200);
      const outPath = path.join(outDir, shot.name);
      await capturePng(session.send, outPath);
      log.push({ shot: shot.name, prep, bytes: (await import("node:fs")).statSync(outPath).size });
      console.log("captured", shot.name, prep);
    }
  } finally {
    session.ws.close();
  }
  writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify({ capturedAt: new Date().toISOString(), log }, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, outDir, log }, null, 2));
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
