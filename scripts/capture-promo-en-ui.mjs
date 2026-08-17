#!/usr/bin/env node
/**
 * Capture English-chrome promo stills + evolve clip from the live desktop.
 * Restores zh locale and cute-pastel when finished.
 *
 *   node wodeappx/scripts/capture-promo-en-ui.mjs
 */
import { mkdirSync, writeFileSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "docs/promo/video/assets");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const EN_PROMPT =
  "/evolve Make an ink-book workbench skin: thread-bound pages, rice-paper ground, seal accents. Chat should feel like turning a book.";

const LOCALIZE_JS = `(() => {
  if (window.__promoEnLocalize) return "already";
  const pairs = [
    ["默认在「wodeapp（自进化）」。配本机 Key 或云端登录即可聊天；Chrome 可选。", "Default workspace is wodeapp (self-evolve). Add a local key or sign in to chat. Chrome is optional."],
    ["管理数字资产，生成图片与视频，或调用自定义 Agent——直接说需求，我来继续完成。", "Manage assets, generate images and video, or call a custom agent."],
    ["随心输入，/ 唤起命令，@ 引用技能与素材...", "Type freely. / for commands, @ for skills and assets…"],
    ["随心输入，/唤起命令，@引用技能与素材...", "Type freely. / for commands, @ for skills and assets…"],
    ["集中管理提示词、图片、视频、剧本、声音与品牌，随时在对话中复用。", "Keep prompts, images, video, scripts, audio, and brands ready for chat."],
    ["修改本机应用自身 (皮肤、文案、功能)；须确认后快照与验证", "Change this app (skin, copy, features). Snapshot and verify after confirm."],
    ["商品图、主图、批量出图", "Product shots, heroes, batch gen"],
    ["短视频、图生视频、批量队列", "Short video, image-to-video, batch"],
    ["剧本、分镜、剪辑脚本", "Scripts, storyboard, edit notes"],
    ["画布、素材节点、连续创作", "Canvas, nodes, keep creating"],
    ["多模型、并行生成/对比", "Multi-model, run and compare"],
    ["本机 Key · 可不登录", "Local key · no login"],
    ["登录 · 所有能力立即可用", "Sign in · all capabilities ready"],
    ["第 1 / 2 步 · 能力一览", "Step 1 / 2 · capabilities"],
    ["第 1 / 2 步", "Step 1 / 2"],
    ["不再自动弹出", "Don't show again"],
    ["想做什么，直接说", "Just say what you need"],
    ["你的 AI 工作台", "Your AI workbench"],
    ["马卡龙工作台", "Macaron workbench"],
    ["水墨书卷", "Ink book"],
    ["开始使用", "Get started"],
    ["本地或云端", "Local or cloud"],
    ["本机 Key", "Local key"],
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
    ["上传素材", "Upload"],
    ["新建商品", "New product"],
    ["新建品牌", "New brand"],
    ["飞书接入", "Lark"],
    ["资产库 / ASSET LIBRARY", "ASSET LIBRARY"],
    ["查看用量", "Usage"],
    ["火山方舟 (字节)", "Volcano Ark"],
    ["火山方舟（字节）", "Volcano Ark"],
    ["去配置", "Set up"],
    ["已配置", "Ready"],
    ["生视频", "Video"],
    ["生图", "Image"],
    ["对话", "Chat"],
    ["平台", "Provider"],
    ["配置", "Setup"],
    ["稍后", "Later"],
    ["下一步", "Next"],
    ["发送", "Send"],
    ["文档", "Docs"],
    ["反馈", "Feedback"],
    ["项目", "Projects"],
    ["最近", "Recent"],
    ["本地", "Local"],
    ["云端", "Cloud"],
    ["全部", "All"],
    ["商品库", "Products"],
    ["品牌库", "Brands"],
    ["提示词", "Prompts"],
    ["图片", "Images"],
    ["视频", "Videos"],
    ["剧本", "Scripts"],
    ["声音", "Audio"],
    ["张云端", "in cloud"],
    ["wodeapp（自进化）", "wodeapp (self-evolve)"],
    ["WodeApp 自进化", "WodeApp self-evolve"],
    ["简体中文", "English"],
    ["/自进化", "/evolve"],
    ["自进化", "evolve"],
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
      if (next !== text) {
        node.nodeValue = next;
        n += 1;
      }
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
      const page =
        pages.find((t) => /localhost:517[0-9]/.test(t.url || "") && !/[?&]embed=1\\b/.test(t.url || "")) ||
        pages.find((t) => /127\\.0\\.0\\.1:517[0-9]/.test(t.url || "") && !/[?&]embed=1\\b/.test(t.url || "")) ||
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

async function evalJson(send, expression) {
  const res = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res?.exceptionDetails) throw new Error(JSON.stringify(res.exceptionDetails));
  return res?.result?.value;
}

async function connect() {
  const { port, page } = await findCdpPage();
  const session = cdpSession(page.webSocketDebuggerUrl);
  await session.ready;
  await session.send("Page.enable");
  await session.send("Runtime.enable");
  await session.send("Input.enable").catch(() => {});
  await session.send("Page.bringToFront").catch(() => {});
  return { port, page, session };
}

async function reconnectAfterReload(oldSession) {
  try {
    oldSession.ws.close();
  } catch {
    /* */
  }
  for (let i = 0; i < 20; i += 1) {
    await sleep(400);
    try {
      return await connect();
    } catch {
      /* retry */
    }
  }
  throw new Error("CDP did not come back after reload");
}

function findWodeappWindowId() {
  const swift = spawnSync(
    "swift",
    [
      "-e",
      `
import Cocoa
let info = CGWindowListCopyWindowInfo([.optionAll, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
var bestId = 0
var bestArea = 0
for w in info {
  let owner = (w[kCGWindowOwnerName as String] as? String ?? "")
  let bounds = w[kCGWindowBounds as String] as? [String: Any]
  let ww = (bounds?["Width"] as? NSNumber)?.intValue ?? 0
  let hh = (bounds?["Height"] as? NSNumber)?.intValue ?? 0
  let num = (w[kCGWindowNumber as String] as? NSNumber)?.intValue ?? 0
  if owner != "wodeappx" || ww < 1200 || hh < 700 { continue }
  let area = ww * hh
  if area > bestArea {
    bestId = num
    bestArea = area
  }
}
print(bestId)
`,
    ],
    { encoding: "utf8" },
  );
  const line = (swift.stdout || "")
    .trim()
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .pop();
  const id = Number(line || 0);
  if (!id) throw new Error(`no wodeappx window: ${(swift.stderr || "") + (swift.stdout || "")}`);
  return id;
}

function captureWindow(outPath) {
  spawnSync("osascript", ["-e", 'tell application "System Events" to set frontmost of process "wodeappx" to true']);
  const id = findWodeappWindowId();
  const format = /\.jpe?g$/i.test(outPath) ? "jpg" : "png";
  const r = spawnSync("screencapture", ["-x", "-o", "-t", format, `-l${id}`, outPath], { encoding: "utf8" });
  if (r.status !== 0 || !statSync(outPath).size) {
    throw new Error(`screencapture failed: ${r.stderr || r.status}`);
  }
  return { id, bytes: statSync(outPath).size };
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

async function setSkin(send, skinId) {
  return evalJson(
    send,
    `(() => {
      const shell = document.querySelector(".wapp-workspace-shell");
      if (!shell) return "no-shell";
      for (const c of [...shell.classList]) {
        if (c.startsWith("wapp-skin-") && c !== ${JSON.stringify(`wapp-skin-${skinId}`)}) shell.classList.remove(c);
      }
      shell.classList.add(${JSON.stringify(`wapp-skin-${skinId}`)});
      shell.setAttribute("data-wapp-skin", ${JSON.stringify(skinId)});
      try { localStorage.setItem("wodeappx.skin", ${JSON.stringify(skinId)}); } catch {}
      document.documentElement.dataset.theme = "light";
      document.documentElement.style.colorScheme = "light";
      try { localStorage.setItem("openwork.react.settings.theme-mode", "light"); } catch {}
      window.dispatchEvent(new CustomEvent("wodeapp:skin-changed", { detail: { skin: ${JSON.stringify(skinId)} } }));
      return "ok";
    })()`,
  );
}

async function clickText(send, ...labels) {
  return evalJson(
    send,
    `(() => {
      const wants = ${JSON.stringify(labels)};
      const nodes = [...document.querySelectorAll("button,a,span,div,[role='button']")];
      let best = null;
      let bestScore = 1e9;
      let hit = null;
      for (const want of wants) {
        for (const n of nodes) {
          const t = (n.textContent || "").replace(/\\s+/g, " ").trim();
          if (t !== want && !t.startsWith(want)) continue;
          const score = n.children.length * 20 + t.length;
          if (score < bestScore) { best = n; bestScore = score; hit = t; }
        }
        if (best) break;
      }
      best?.click();
      return hit;
    })()`,
  );
}

async function localize(send) {
  return evalJson(send, LOCALIZE_JS);
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
      "-movflags",
      "+faststart",
      outPath,
    ],
    { encoding: "utf8" },
  );
  if (ff.status !== 0) throw new Error(ff.stderr?.slice(-800) || "ffmpeg failed");
}

async function recordEvolve(session) {
  await hidePerf(session.send);
  await setSkin(session.send, "red-compact");
  await localize(session.send);
  await clickText(session.send, "默认智能体", "Default agent");
  await sleep(300);
  await clickText(session.send, "新建对话", "New chat");
  await sleep(1400);
  await localize(session.send);

  const outMp4 = path.join(outDir, "evolve-skin-type-en.mp4");
  const frameDir = `${outMp4}.frames`;
  rmSync(frameDir, { recursive: true, force: true });
  mkdirSync(frameDir, { recursive: true });
  let i = 0;
  const grab = () => {
    try {
      captureWindow(path.join(frameDir, `f-${String(i).padStart(4, "0")}.jpg`));
      i += 1;
    } catch {
      /* skip a dropped frame */
    }
  };

  const t0 = Date.now();
  grab();
  const rect = await evalJson(
    session.send,
    `(() => {
      const ed = document.querySelector('[contenteditable="true"]');
      if (!ed) return null;
      const r = ed.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + Math.min(24, r.height / 2) };
    })()`,
  );
  if (!rect) throw new Error("composer missing");
  await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
  await sleep(200);
  grab();
  for (const ch of [...EN_PROMPT]) {
    await session.send("Input.insertText", { text: ch });
    if (ch === "/" || ch === " ") grab();
    await sleep(ch === "/" ? 160 : 22);
  }
  await localize(session.send);
  grab();
  await sleep(400);
  await setSkin(session.send, "ink-book");
  await localize(session.send);
  await sleep(500);
  grab();
  await sleep(700);
  grab();
  const elapsed = Math.max(0.5, (Date.now() - t0) / 1000);
  if (i < 6) throw new Error(`too few evolve frames: ${i}`);
  const fps = Math.max(4, Math.min(18, i / elapsed));
  await encodeFrames(frameDir, outMp4, Number(fps.toFixed(3)));
  return { outMp4, frames: i, fps, elapsed, bytes: statSync(outMp4).size };
}

async function main() {
  mkdirSync(outDir, { recursive: true });
  const ctx = await connect();
  const log = { port: ctx.port, shots: [] };
  try {
    await hidePerf(ctx.session.send);
    await setSkin(ctx.session.send, "cute-pastel");
    await clickText(ctx.session.send, "默认智能体", "Default agent");
    await sleep(400);
    await localize(ctx.session.send);
    await evalJson(ctx.session.send, `window.dispatchEvent(new CustomEvent("wodeapp:open-first-mile"))`);
    await sleep(800);
    await localize(ctx.session.send);
    await hidePerf(ctx.session.send);
    log.shots.push({ id: "first-mile", ...captureWindow(path.join(outDir, "ph-first-mile-en.png")) });

    await evalJson(
      ctx.session.send,
      `document.querySelector(".wx-login-dialog-close")?.click() || document.querySelector(".wx-first-mile-dialog button")?.click()`,
    );
    await sleep(400);
    await setSkin(ctx.session.send, "ink-book");
    await clickText(ctx.session.send, "默认智能体", "Default agent");
    await sleep(250);
    await clickText(ctx.session.send, "新建对话", "New chat");
    await sleep(1000);
    await localize(ctx.session.send);
    await hidePerf(ctx.session.send);
    log.shots.push({ id: "ink-book", ...captureWindow(path.join(outDir, "ink-book-workbench-en.jpg")) });

    await setSkin(ctx.session.send, "cute-pastel");
    await clickText(ctx.session.send, "数字资产", "Digital assets");
    await sleep(1000);
    await localize(ctx.session.send);
    await hidePerf(ctx.session.send);
    log.shots.push({ id: "assets", ...captureWindow(path.join(outDir, "ph-assets-en.png")) });

    log.evolve = await recordEvolve(ctx.session);
  } finally {
    try {
      await evalJson(
        ctx.session.send,
        `(() => {
          window.__promoEnLocalize?.mo?.disconnect();
          delete window.__promoEnLocalize;
          return true;
        })()`,
      );
      await setSkin(ctx.session.send, "cute-pastel");
    } catch {
      /* restore best-effort */
    }
    try {
      ctx.session.ws.close();
    } catch {
      /* */
    }
  }
  writeFileSync(path.join(outDir, "promo-en-capture.json"), `${JSON.stringify(log, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, ...log }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
