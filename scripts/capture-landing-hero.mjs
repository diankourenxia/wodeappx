#!/usr/bin/env node
/**
 * Recapture landing-page hero skins (zh + en) via macOS window capture.
 * Page.captureScreenshot hangs on this Electron build; do not use it.
 *
 *   node wodeappx/scripts/capture-landing-hero.mjs
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = path.join(root, "docs/promo/skins");
const DEFAULT_HERO_SKINS = ["cute-pastel", "summer-breeze", "ink-book", "pet-soft", "otome-diary"];
const HERO_SKINS = (() => {
  const i = process.argv.indexOf("--skin");
  if (i < 0 || !process.argv[i + 1]) return DEFAULT_HERO_SKINS;
  return process.argv[i + 1].split(",").map((s) => s.trim()).filter(Boolean);
})();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SKIN_PICKER_LABEL = {
  "cute-pastel": "可爱马卡龙",
  "ink-book": "水墨书卷",
  "otome-diary": "蔷薇日记",
  "pet-soft": "萌宠柔光",
  "summer-breeze": "夏日海风",
};

const LOCALIZE_JS = `(() => {
  if (window.__promoEnLocalize) { window.__promoEnLocalize.apply(); return "refresh"; }
  const pairs = [
    ["想做什么，直接说", "Just say what you need"],
    ["管理数字资产，生成图片与视频，或调用自定义 Agent——直接说需求，我来继续完成。", "Manage assets, generate images and video, or call a custom agent."],
    ["随心输入，/ 唤起命令，@ 引用技能与素材...", "Type freely. / for commands, @ for skills and assets…"],
    ["随心输入, / 唤起命令, @ 引用技能与素材...", "Type freely. / for commands, @ for skills and assets…"],
    ["随心输入，/唤起命令，@引用技能与素材...", "Type freely. / for commands, @ for skills and assets…"],
    ["请求批准", "Ask to run"],
    ["深度", "Depth"],
    ["你的 AI 工作台", "Your AI workbench"],
    ["马卡龙工作台", "Macaron workbench"],
    ["可爱马卡龙 软圆角工作台", "Cute macaron · soft studio"],
    ["水墨书卷", "Ink book"],
    ["新建对话", "New chat"],
    ["默认智能体", "Default agent"],
    ["图片智能体", "Image agent"],
    ["视频智能体", "Video agent"],
    ["短剧智能体", "Short drama"],
    ["画布智能体", "Canvas"],
    ["多模型智能体", "Multi-model"],
    ["数字资产", "Digital assets"],
    ["生成历史", "History"],
    ["自动任务", "Automations"],
    ["能力中心", "Capabilities"],
    ["生成图片", "Generate image"],
    ["生成视频", "Generate video"],
    ["自定义 Agent", "Custom agent"],
    ["完全访问权限", "Full access"],
    ["商品图 · 主图 · 批量出图", "Product shots · heroes · batch"],
    ["短视频 · 图生视频 · 批量队列", "Short video · image-to-video"],
    ["剧本 · 分镜 · 可拍摄脚本", "Scripts · storyboard"],
    ["画布 · 素材节点 · 连续创作", "Canvas · nodes"],
    ["多模型 · 并行生成 · 对比", "Multi-model · compare"],
    ["按类型查看记录", "Browse by type"],
    ["发送", "Send"],
    ["文档", "Docs"],
    ["反馈", "Feedback"],
    ["项目", "Projects"],
    ["最近", "Recent"],
    ["简体中文", "English"],
    ["wodeapp（自进化）", "wodeapp (self-evolve)"],
  ];
  const apply = (root = document.body) => {
    if (!root) return 0;
    let n = 0;
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walk.nextNode()) nodes.push(walk.currentNode);
    for (const node of nodes) {
      let text = node.nodeValue;
      if (!text || !/[\\u4e00-\\u9fff]/.test(text)) continue;
      let next = text;
      for (const [zh, en] of pairs) next = next.split(zh).join(en);
      if (next !== text) { node.nodeValue = next; n += 1; }
    }
    for (const el of root.querySelectorAll("[placeholder],[aria-label],[title]")) {
      for (const attr of ["placeholder", "aria-label", "title"]) {
        const cur = el.getAttribute(attr);
        if (!cur || !/[\\u4e00-\\u9fff]/.test(cur)) continue;
        let next = cur;
        for (const [zh, en] of pairs) next = next.split(zh).join(en);
        if (next !== cur) el.setAttribute(attr, next);
      }
    }
    return n;
  };
  apply();
  const mo = new MutationObserver(() => apply());
  mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  window.__promoEnLocalize = { apply, mo };
  return "on";
})()`;

async function findCdpPage(ports = [9823, 9223]) {
  for (const port of ports) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(800) });
      if (!res.ok) continue;
      const list = await res.json();
      const pages = (list || []).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
      const notEmbed = (t) => !/[?&]embed=1(?:&|$)/.test(t.url || "");
      const page =
        pages.find((t) => /127\.0\.0\.1:517[0-9]|localhost:517[0-9]/.test(t.url || "") && notEmbed(t)) ||
        pages.find((t) => t.title === "WodeAppX" && notEmbed(t)) ||
        pages.find((t) => /wodeappx/i.test(t.title || "") && notEmbed(t));
      if (page?.webSocketDebuggerUrl) {
        console.log(JSON.stringify({ cdpPort: port, title: page.title, url: page.url }));
        return { port, page };
      }
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
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
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
  if (res?.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res?.result?.value;
}

async function connect() {
  const { port, page } = await findCdpPage();
  const session = cdpSession(page.webSocketDebuggerUrl);
  await session.ready;
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  return { port, page, session };
}

async function reconnect(old) {
  try { old.session.ws.close(); } catch { /* */ }
  for (let i = 0; i < 24; i += 1) {
    await sleep(350);
    try { return await connect(); } catch { /* retry */ }
  }
  throw new Error("CDP did not come back");
}

function findWodeappWindow() {
  const swift = spawnSync(
    "swift",
    ["-e", `
import Cocoa
let info = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
var bestId = 0
var bestArea = 0.0
var bestX = 0.0
var bestY = 0.0
var bestW = 0.0
var bestH = 0.0
for w in info {
  let owner = (w[kCGWindowOwnerName as String] as? String ?? "")
  let bounds = w[kCGWindowBounds as String] as? [String: Any]
  let ww = (bounds?["Width"] as? NSNumber)?.doubleValue ?? 0
  let hh = (bounds?["Height"] as? NSNumber)?.doubleValue ?? 0
  if owner != "wodeappx" || ww < 1200 || hh < 700 { continue }
  let area = ww * hh
  if area > bestArea {
    bestArea = area
    bestId = (w[kCGWindowNumber as String] as? NSNumber)?.intValue ?? 0
    bestX = (bounds?["X"] as? NSNumber)?.doubleValue ?? 0
    bestY = (bounds?["Y"] as? NSNumber)?.doubleValue ?? 0
    bestW = ww
    bestH = hh
  }
}
print("\\(bestId) \\(bestX) \\(bestY) \\(bestW) \\(bestH)")
`],
    { encoding: "utf8" },
  );
  const line = (swift.stdout || "").trim().split("\n").map((s) => s.trim()).filter(Boolean).pop() || "";
  const parts = line.split(/\s+/).map(Number);
  if (parts.length < 5 || !parts[0] || parts[3] < 1200) {
    throw new Error(`no wodeappx window: ${(swift.stderr || "") + (swift.stdout || "")}`);
  }
  return { id: parts[0], x: parts[1], y: parts[2], w: parts[3], h: parts[4] };
}

function setWindowPos(x, y) {
  spawnSync("osascript", [
    "-e",
    `tell application "System Events" to tell process "wodeappx" to set position of window 1 to {${Number(x)}, ${Number(y)}}`,
  ]);
}

function captureWindow(outPath) {
  spawnSync("osascript", ["-e", 'tell application "System Events" to set frontmost of process "wodeappx" to true']);
  spawnSync("sleep", ["0.45"]);
  const win = findWodeappWindow();
  // Screen rect (not -l): Electron window-id bitmaps go stale when the app is occluded.
  const r = spawnSync(
    "screencapture",
    ["-x", "-t", "png", `-R${win.x},${win.y},${win.w},${win.h}`, outPath],
    { encoding: "utf8" },
  );
  if (r.status !== 0 || !statSync(outPath).size) {
    throw new Error(`screencapture failed: ${r.stderr || r.status}`);
  }
  return { ...win, bytes: statSync(outPath).size };
}

async function hidePerf(send) {
  return evalJson(
    send,
    `(() => {
      document.querySelector(".wapp-perf-hud-close")?.click();
      document.querySelectorAll(".wapp-perf-hud, .wapp-perf, #wapp-perf, [data-sonner-toast]").forEach((el) => {
        el.style.setProperty("display", "none", "important");
      });
      return true;
    })()`,
  );
}

async function focusAgents(send) {
  return evalJson(
    send,
    `(() => {
      const back = [...document.querySelectorAll("button")].find((el) => /返回对话|Back to chat/i.test(el.textContent || ""));
      if (back) { back.click(); return "back"; }
      window.dispatchEvent(new Event("wodeapp:focus-agents"));
      const nav = [...document.querySelectorAll("button, a, [role='button']")].find((el) => {
        const t = (el.textContent || "").replace(/\\s+/g, " ").trim();
        return t === "默认智能体" || t.startsWith("默认智能体") || /^Default agent/i.test(t);
      });
      nav?.click();
      return nav ? "nav" : "event";
    })()`,
  );
}

async function closePicker(send) {
  await evalJson(
    send,
    `(() => {
      document.querySelector(".wapp-skin-picker-close")?.click();
      document.querySelector(".wapp-skin-picker-dialog")?.querySelector("button[aria-label='关闭'], .wapp-dialog-close")?.click();
      return true;
    })()`,
  );
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const open = await evalJson(send, `!!document.querySelector(".wapp-skin-picker-dialog")`);
    if (!open) return true;
    await sleep(120);
  }
  return false;
}

async function applySkin(send, skinId) {
  const label = SKIN_PICKER_LABEL[skinId] || skinId;
  await evalJson(send, `(() => { window.__promoEnLocalize?.mo?.disconnect(); delete window.__promoEnLocalize; return true; })()`).catch(() => {});
  await closePicker(send);
  const opened = await evalJson(
    send,
    `(() => {
      const skinId = ${JSON.stringify(skinId)};
      try {
        localStorage.setItem("wodeappx.skin", skinId);
        localStorage.setItem("wodeappx.companion.enabled", "true");
        localStorage.setItem("wodeappx.companion.perch", "true");
        localStorage.setItem("wodeappx.companion.perch.kind", "sprite");
        if (skinId === "otome-diary") {
          localStorage.setItem("wodeappx.companion.perch.avatar", "perch-otome");
          localStorage.setItem("wodeappx.companion.avatar", "otome-default");
        } else if (skinId === "pet-soft") {
          localStorage.setItem("wodeappx.companion.perch.avatar", "perch-poodle");
          localStorage.setItem("wodeappx.companion.avatar", "dog");
        } else if (skinId === "summer-breeze") {
          localStorage.setItem("wodeappx.companion.perch.avatar", "perch-dolphin");
          localStorage.setItem("wodeappx.companion.avatar", "dolphin");
        }
        localStorage.setItem("openwork.react.settings.theme-mode", "light");
      } catch {}
      document.documentElement.dataset.theme = "light";
      document.documentElement.style.colorScheme = "light";
      const shell = document.querySelector(".wapp-workspace-shell");
      if (shell && shell.getAttribute("data-wapp-skin") === skinId && !document.querySelector(".wapp-skin-picker-dialog")) {
        return { already: true };
      }
      window.dispatchEvent(new Event("wodeapp:open-skin-picker"));
      return { opened: true };
    })()`,
  );
  if (opened?.already) return { via: "already" };
  await sleep(900);
  const clicked = await evalJson(
    send,
    `(() => {
      const skinId = ${JSON.stringify(skinId)};
      const label = ${JSON.stringify(label)};
      const byPreview = document.querySelector(${JSON.stringify(`.wapp-skin-preview-${skinId}`)})?.closest("button, [role='option']");
      if (byPreview) { byPreview.click(); return { ok: true, via: "preview" }; }
      const cards = [...document.querySelectorAll(".wapp-skin-picker-card, [role='option']")];
      const card = cards.find((el) => {
        const t = (el.querySelector("strong")?.textContent || el.textContent || "").replace(/\\s+/g, " ").trim();
        return t === label || t.startsWith(label) || t.includes(skinId);
      });
      if (!card) return { ok: false, labels: cards.map((el) => (el.querySelector("strong")?.textContent || "").trim()) };
      card.click();
      return { ok: true, via: "label" };
    })()`,
  );
  if (!clicked?.ok) throw new Error(`skin ${skinId}: ${JSON.stringify(clicked)}`);
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const state = await evalJson(
      send,
      `(() => ({
        skin: document.querySelector(".wapp-workspace-shell")?.getAttribute("data-wapp-skin") || "",
        picker: !!document.querySelector(".wapp-skin-picker-dialog"),
      }))()`,
    );
    if (state?.skin === skinId && !state.picker) return { via: "picker" };
    if (state?.skin === skinId && state.picker) await closePicker(send);
    await sleep(150);
  }
  throw new Error(`Timed out waiting for skin ${skinId}`);
}

async function ensureEmptyChat(send) {
  await focusAgents(send);
  await sleep(400);
  await evalJson(
    send,
    `(() => {
      const btn = [...document.querySelectorAll("button")].find((el) => {
        const t = (el.textContent || "").replace(/\\s+/g, " ").trim();
        return t === "新建对话" || t === "New chat" || t.startsWith("新建对话") || t.startsWith("New chat");
      });
      btn?.click();
      return btn ? "new" : "missing";
    })()`,
  );
  await sleep(900);
}

async function setLang(ctx, lang) {
  const cur = await evalJson(ctx.session.send, `localStorage.getItem("openwork.language")`);
  if (cur === lang) return { ...ctx, already: true };
  await evalJson(ctx.session.send, `localStorage.setItem("openwork.language", ${JSON.stringify(lang)})`);
  await ctx.session.send("Page.reload", { ignoreCache: true });
  const next = await reconnect(ctx);
  await sleep(800);
  return next;
}

async function waitShell(send) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    if (await evalJson(send, `!!document.querySelector(".wapp-workspace-shell")`)) return true;
    await sleep(200);
  }
  throw new Error("shell missing");
}

async function main() {
  mkdirSync(path.join(outRoot, "_raw/zh"), { recursive: true });
  mkdirSync(path.join(outRoot, "_raw/en"), { recursive: true });
  let ctx = await connect();
  const original = await evalJson(
    ctx.session.send,
    `(() => ({
      lang: localStorage.getItem("openwork.language") || "zh",
      skin: document.querySelector(".wapp-workspace-shell")?.getAttribute("data-wapp-skin") || "cute-pastel",
    }))()`,
  );
  const log = { original, shots: [] };
  const parked = { x: 640, y: -1040 };
  try {
    setWindowPos(parked.x, parked.y);
    const langs = process.argv.includes("--en-only") ? ["en"] : process.argv.includes("--zh-only") ? ["zh"] : ["zh", "en"];
    for (const lang of langs) {
      if (lang === "en") {
        // Reload leaves a stale CGWindow bitmap; keep the live window and overlay EN copy.
        await evalJson(ctx.session.send, `localStorage.setItem("openwork.language", "en")`);
      } else {
        ctx = await setLang(ctx, lang);
        await waitShell(ctx.session.send);
      }
      for (const skinId of HERO_SKINS) {
        console.log(`capture ${lang} ${skinId}`);
        await applySkin(ctx.session.send, skinId);
        await ensureEmptyChat(ctx.session.send);
        await closePicker(ctx.session.send);
        await hidePerf(ctx.session.send);
        if (lang === "en") await evalJson(ctx.session.send, LOCALIZE_JS);
        await sleep(700);
        if (lang === "en") await evalJson(ctx.session.send, LOCALIZE_JS);
        await hidePerf(ctx.session.send);
        const ready = await evalJson(
          ctx.session.send,
          `(() => ({
            skin: document.querySelector(".wapp-workspace-shell")?.getAttribute("data-wapp-skin") || "",
            picker: !!document.querySelector(".wapp-skin-picker-dialog"),
            hero: document.querySelector("h1")?.textContent || "",
            crumb: (document.querySelector(".wapp-breadcrumb")?.innerText || "").replace(/\\s+/g, " ").trim(),
          }))()`,
        );
        if (ready.picker) throw new Error(`picker still open before ${lang}/${skinId}`);
        if (ready.skin !== skinId) throw new Error(`skin mismatch before shot: ${JSON.stringify(ready)}`);
        const png = path.join(outRoot, "_raw", lang, `${skinId}-light.png`);
        let shot = captureWindow(png);
        let hash = createHash("md5").update(readFileSync(png)).digest("hex");
        const prev = log.shots[log.shots.length - 1];
        if (prev?.hash && prev.hash === hash) {
          await sleep(800);
          shot = captureWindow(png);
          hash = createHash("md5").update(readFileSync(png)).digest("hex");
        }
        if (prev?.hash && prev.hash === hash) {
          throw new Error(`stale capture ${lang}/${skinId} matches ${prev.skinId}`);
        }
        log.shots.push({ lang, skinId, ...shot, png, ready, hash });
        console.log(JSON.stringify({ lang, skinId, bytes: shot.bytes, hero: ready.hero, crumb: ready.crumb, hash: hash.slice(0, 10) }));
      }
    }
  } finally {
    try {
      await evalJson(
        ctx.session.send,
        `(() => { window.__promoEnLocalize?.mo?.disconnect(); delete window.__promoEnLocalize; return true; })()`,
      );
      await evalJson(ctx.session.send, `localStorage.setItem("openwork.language", ${JSON.stringify(original.lang === "en" ? "en" : "zh")})`);
      await applySkin(ctx.session.send, original.skin || "cute-pastel");
    } catch (err) {
      console.warn(`restore failed: ${err.message || err}`);
    }
    try { ctx.session.ws.close(); } catch { /* */ }
    try { setWindowPos(0, 33); } catch { /* */ }
  }
  writeFileSync(path.join(outRoot, "_raw/landing-hero-manifest.json"), `${JSON.stringify(log, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, count: log.shots.length }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
