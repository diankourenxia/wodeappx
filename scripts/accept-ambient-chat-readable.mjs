#!/usr/bin/env node
/**
 * Ambient chat readability accept (new rule):
 * assistant prose / tool summary / link must hit WCAG AA vs nearest opaque bg
 * (or vs shell when surfaces are transparent). SKIPPED if no workbench page.
 *
 * Usage:
 *   node scripts/accept-ambient-chat-readable.mjs [--port 9823] [--skin aurora-night]
 */
import fs from "node:fs";

const args = process.argv.slice(2);
const port = Number(args[args.indexOf("--port") + 1] || 9823) || 9823;
const skinArg = args.includes("--skin") ? args[args.indexOf("--skin") + 1] : "aurora-night";
const outShot = args.includes("--screenshot")
  ? args[args.indexOf("--screenshot") + 1] || `/tmp/ambient-chat-${skinArg}.png`
  : null;

function toRgb(c) {
  if (!c) return null;
  let m = String(c).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
  m = String(c).match(/color\(display-p3\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
  if (m) {
    return {
      r: Math.round(+m[1] * 255),
      g: Math.round(+m[2] * 255),
      b: Math.round(+m[3] * 255),
      a: m[4] == null ? 1 : +m[4],
    };
  }
  return null;
}

function relLum({ r, g, b }) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(fg, bg) {
  if (!fg || !bg) return null;
  const a = fg.a ?? 1;
  const c = {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
  };
  const L1 = relLum(c);
  const L2 = relLum(bg);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page =
  pages.find((p) => p.type === "page" && /localhost:517\d/.test(p.url || "")) ||
  pages.find((p) => p.type === "page" && /小灵通\s*AI|WodeAppX/i.test(p.title || "")) ||
  pages.find(
    (p) =>
      p.type === "page" &&
      /#\/workspace/i.test(p.url || "") &&
      !/login\.|moonshot|weixin|oauth/i.test(p.url || ""),
  );
if (!page?.webSocketDebuggerUrl) {
  console.log(JSON.stringify({ ok: false, status: "SKIPPED", reason: "no workbench page", port }));
  process.exit(2);
}

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, resolve);
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => {
      if (pending.has(i)) {
        pending.delete(i);
        reject(new Error("timeout " + method));
      }
    }, 25000);
  });

await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});
await send("Runtime.enable");
await send("Page.enable");

const ev = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) {
    throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 500));
  }
  return r.result?.result?.value;
};

const shell = await ev(`(() => {
  const el = document.querySelector('.wapp-workspace-shell');
  if (!el) return '';
  return el.getAttribute('data-wapp-skin') || [...el.classList].find((c) => c.startsWith('wapp-skin-')) || 'shell';
})()`);
if (!shell) {
  console.log(JSON.stringify({ ok: false, status: "SKIPPED", reason: "not workbench page", port, url: page.url }));
  ws.close();
  process.exit(2);
}

await ev(`localStorage.setItem('wodeappx.skin', ${JSON.stringify(skinArg)});`);
const resumeHref = await ev(`location.href`);
await send("Page.reload", { ignoreCache: true });
await new Promise((r) => setTimeout(r, 3500));
if (resumeHref && /#\/workspace\//.test(resumeHref)) {
  await ev(`location.href = ${JSON.stringify(resumeHref)}`);
  await new Promise((r) => setTimeout(r, 2500));
}

const opened = await ev(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const hasChat = () => {
    const surface = document.querySelector('.wapp-session-surface') || document.querySelector('.wapp-content main') || document.body;
    const asst = [...surface.querySelectorAll('[data-message-role="assistant"] p, .prose p')]
      .some((e) => (e.innerText || '').trim().length > 12);
    const link = [...surface.querySelectorAll('a')].some((a) => (a.textContent || '').trim().length > 1);
    const tool = [...surface.querySelectorAll('button, span, div')].some((e) =>
      /已完成|已打开|运行了|StatusCode|agent reach/.test(e.textContent || '')
      && (e.innerText || '').trim().length > 4
      && (e.innerText || '').trim().length < 160);
    return { asst, link, tool };
  };
  let hit = hasChat();
  if (hit.asst && hit.link) return { mode: 'resume', ...hit };
  const items = [...document.querySelectorAll('.wapp-recent-item, .wapp-nav-item, [data-session-id]')];
  for (const item of items.slice(0, 12)) {
    item.click();
    await sleep(900);
    hit = hasChat();
    if (hit.asst && (hit.link || hit.tool)) return { mode: 'clicked', ...hit, title: (item.textContent || '').trim().slice(0, 40) };
  }
  return { mode: 'none', ...hasChat() };
})()`);
console.error("[accept-ambient] openChat", JSON.stringify(opened));

const report = await ev(`(() => {
  ${toRgb.toString()}
  ${relLum.toString()}
  ${contrast.toString()}
  function nearestOpaqueBg(el) {
    let n = el;
    while (n && n !== document.documentElement) {
      const bg = toRgb(getComputedStyle(n).backgroundColor);
      if (bg && bg.a >= 0.72) return bg;
      n = n.parentElement;
    }
    const shellEl = document.querySelector('.wapp-workspace-shell');
    return toRgb(getComputedStyle(shellEl).backgroundColor) || { r: 11, g: 18, b: 32, a: 1 };
  }
  function pick(label, el) {
    if (!el) return { label, missing: true, aa: 'FAIL' };
    const fg = toRgb(getComputedStyle(el).color);
    const bg = nearestOpaqueBg(el);
    const ratio = contrast(fg, bg);
    const aa = ratio == null ? 'FAIL' : ratio >= 4.5 ? 'PASS' : 'FAIL';
    return {
      label,
      text: (el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
      color: getComputedStyle(el).color,
      fg,
      bg,
      ratio: ratio == null ? null : Math.round(ratio * 100) / 100,
      aa,
    };
  }
  const surface = document.querySelector('.wapp-session-surface') || document.querySelector('.wapp-content main') || document.body;
  const asst = [...surface.querySelectorAll('[data-message-role="assistant"] p, .prose p')]
    .find((e) => (e.innerText || '').trim().length > 12);
  const tool = [...surface.querySelectorAll('[class*="text-muted-foreground"], button, span, div')]
    .find((e) => /已完成|已打开|运行了|StatusCode|agent reach/.test(e.textContent || '')
      && (e.innerText || '').trim().length > 4
      && (e.innerText || '').trim().length < 160);
  const link = [...surface.querySelectorAll('a')]
    .find((a) => (a.textContent || '').trim().length > 1 && a.offsetParent && !a.closest('.wapp-sidebar, [data-slot="sidebar"], .bg-sidebar'));
  const user = surface.querySelector('[data-message-role="user"] .rounded-3xl, .wapp-msg-user, [data-message-role="user"]');
  return {
    skin: document.querySelector('.wapp-workspace-shell')?.getAttribute('data-wapp-skin'),
    picks: [pick('assistant-prose', asst), pick('tool-summary', tool), pick('link', link), pick('user-bubble', user)],
  };
})()`);

if (outShot) {
  const shot = await send("Page.captureScreenshot", { format: "png" });
  const b64 = shot.result?.data || shot.data;
  fs.writeFileSync(outShot, Buffer.from(b64, "base64"));
}

const picks = report?.picks || [];
const required = ["assistant-prose", "tool-summary", "link"];
const fails = picks.filter((p) => required.includes(p.label) && p.aa !== "PASS");
const ok = fails.length === 0 && picks.some((p) => p.label === "assistant-prose" && !p.missing);

const out = {
  ok,
  status: ok ? "PASS" : "FAIL",
  skin: report?.skin,
  port,
  screenshot: outShot,
  picks,
  fails: fails.map((f) => ({ label: f.label, ratio: f.ratio, missing: f.missing })),
};
console.log(JSON.stringify(out, null, 2));
ws.close();
process.exit(ok ? 0 : 1);
