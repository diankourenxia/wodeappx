#!/usr/bin/env node
/**
 * Live skin contrast acceptance via Electron CDP.
 *
 * Samples computed styles (catches specificity wars static CSS misses),
 * optionally writes a screenshot for human/agent visual review.
 *
 * Usage:
 *   node wodeappx/scripts/check-skin-contrast-live.mjs
 *   node wodeappx/scripts/check-skin-contrast-live.mjs --port 9823
 *   node wodeappx/scripts/check-skin-contrast-live.mjs --skin beauty --screenshot
 *   node wodeappx/scripts/check-skin-contrast-live.mjs --skin supor --theme dark --screenshot --require
 *   node wodeappx/scripts/check-skin-contrast-live.mjs --json
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  BEAUTY_LIVE_SAMPLE_SELECTORS,
  SUPOR_LIVE_SAMPLE_SELECTORS,
  auditLiveSamples,
  parseCssColorToHex,
} = await import(pathToFileURL(path.join(root, "scripts/lib/skin-contrast.mjs")).href);

const SKIN_PRESETS = {
  beauty: {
    id: "beauty",
    className: "wapp-skin-beauty",
    storageKey: "beauty",
    selectors: BEAUTY_LIVE_SAMPLE_SELECTORS,
  },
  supor: {
    id: "supor",
    className: "wapp-skin-supor",
    storageKey: "supor",
    selectors: SUPOR_LIVE_SAMPLE_SELECTORS,
  },
  "pet-soft": {
    id: "pet-soft",
    className: "wapp-skin-pet-soft",
    storageKey: "pet-soft",
    selectors: SUPOR_LIVE_SAMPLE_SELECTORS,
  },
  "cute-pastel": {
    id: "cute-pastel",
    className: "wapp-skin-cute-pastel",
    storageKey: "cute-pastel",
    selectors: SUPOR_LIVE_SAMPLE_SELECTORS,
  },
  "ink-book": {
    id: "ink-book",
    className: "wapp-skin-ink-book",
    storageKey: "ink-book",
    selectors: SUPOR_LIVE_SAMPLE_SELECTORS,
  },
  "otome-diary": {
    id: "otome-diary",
    className: "wapp-skin-otome-diary",
    storageKey: "otome-diary",
    selectors: SUPOR_LIVE_SAMPLE_SELECTORS,
  },
  "red-compact": {
    id: "red-compact",
    className: "wapp-skin-red-compact",
    storageKey: "red-compact",
    selectors: SUPOR_LIVE_SAMPLE_SELECTORS,
  },
  "summer-breeze": {
    id: "summer-breeze",
    className: "wapp-skin-summer-breeze",
    storageKey: "summer-breeze",
    selectors: SUPOR_LIVE_SAMPLE_SELECTORS,
  },
  "aurora-night": {
    id: "aurora-night",
    className: "wapp-skin-aurora-night",
    storageKey: "aurora-night",
    selectors: SUPOR_LIVE_SAMPLE_SELECTORS,
  },
  "forest-mist": {
    id: "forest-mist",
    className: "wapp-skin-forest-mist",
    storageKey: "forest-mist",
    selectors: SUPOR_LIVE_SAMPLE_SELECTORS,
  },
  "coffee-loft": {
    id: "coffee-loft",
    className: "wapp-skin-coffee-loft",
    storageKey: "coffee-loft",
    selectors: SUPOR_LIVE_SAMPLE_SELECTORS,
  },
  "noir-jazz": {
    id: "noir-jazz",
    className: "wapp-skin-noir-jazz",
    storageKey: "noir-jazz",
    selectors: SUPOR_LIVE_SAMPLE_SELECTORS,
  },
};

function parseArgs(argv) {
  const opts = {
    ports: [],
    require: false,
    screenshot: false,
    json: false,
    /** @type {"auto" | keyof typeof SKIN_PRESETS} */
    skin: "auto",
    theme: "keep",
    out: null,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };
    if (arg === "--port") opts.ports.push(Number(next()));
    else if (arg === "--require") opts.require = true;
    else if (arg === "--screenshot") opts.screenshot = true;
    else if (arg === "--out") opts.out = path.resolve(next());
    else if (arg === "--json") opts.json = true;
    else if (arg === "--skin") {
      const skin = String(next()).trim().toLowerCase();
      if (skin !== "auto" && !SKIN_PRESETS[skin]) {
        throw new Error(`Unknown --skin ${skin} (auto|${Object.keys(SKIN_PRESETS).join("|")})`);
      }
      opts.skin = skin;
    } else if (arg === "--theme") {
      const theme = String(next()).trim().toLowerCase();
      if (!["keep", "light", "dark"].includes(theme)) {
        throw new Error(`Unknown --theme ${theme} (keep|light|dark)`);
      }
      opts.theme = theme;
    } else if (arg === "-h" || arg === "--help") {
      console.log(
        `Usage: node check-skin-contrast-live.mjs [--port N] [--skin auto|${Object.keys(SKIN_PRESETS).join("|")}] [--theme keep|light|dark] [--require] [--screenshot] [--out path] [--json]`,
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown arg: ${arg}`);
    }
  }
  if (!opts.ports.length) {
    const envPort = Number(process.env.OPENWORK_ELECTRON_REMOTE_DEBUG_PORT || "");
    opts.ports = Number.isFinite(envPort) && envPort > 0
      ? [envPort, 9823, 9223]
      : [9823, 9223];
  }
  if (!opts.out) {
    opts.out = path.join(root, "..", "tmp", `${opts.skin === "auto" ? "skin" : opts.skin}-skin-contrast-live.png`);
  }
  return opts;
}

async function listPages(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(800),
  });
  if (!res.ok) throw new Error(`CDP list HTTP ${res.status}`);
  return res.json();
}

async function findCdpPage(ports) {
  const errors = [];
  for (const port of ports) {
    try {
      const list = await listPages(port);
      const page =
        list.find((t) => t.type === "page" && /localhost:517[0-9]/.test(t.url || "")) ||
        list.find((t) => t.type === "page" && /wodeapp|openwork|5174|5175/i.test(`${t.title} ${t.url}`)) ||
        list.find((t) => t.type === "page" && !/google\.com|chrome:\/\//i.test(t.url || "")) ||
        list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return { port, page, list };
      errors.push(`port ${port}: no page target`);
    } catch (err) {
      errors.push(`port ${port}: ${err.message}`);
    }
  }
  return { error: errors.join("; ") };
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

function buildAssertSkinExpression(preset, { force }) {
  return `(() => {
    const shell = document.querySelector(".wapp-workspace-shell");
    if (!shell) return "no-shell";
    if (${force ? "true" : "false"}) {
      for (const c of [...shell.classList]) {
        if (c.startsWith("wapp-skin-") && c !== ${JSON.stringify(preset.className)}) shell.classList.remove(c);
      }
      shell.classList.add(${JSON.stringify(preset.className)});
      shell.setAttribute("data-wapp-skin", ${JSON.stringify(preset.id)});
      try { localStorage.setItem("wodeappx.skin", ${JSON.stringify(preset.storageKey)}); } catch {}
    }
    return "ok";
  })()`;
}

function buildDetectSkinExpression() {
  return `(() => {
    const shell = document.querySelector(".wapp-workspace-shell");
    if (!shell) return "no-shell";
    const known = ${JSON.stringify(Object.keys(SKIN_PRESETS))};
    const classes = [...shell.classList];
    for (const id of known) {
      if (classes.includes("wapp-skin-" + id)) return id;
    }
    const data = shell.getAttribute("data-wapp-skin") || "";
    if (known.includes(data)) return data;
    try {
      const stored = localStorage.getItem("wodeappx.skin") || "";
      if (known.includes(stored)) return stored;
    } catch {}
    return "unknown";
  })()`;
}

function buildAssertThemeExpression(theme) {
  if (theme === "keep") return `(() => document.documentElement.dataset.theme || "unset")()`;
  return `(() => {
    const mode = ${JSON.stringify(theme)};
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
    try { localStorage.setItem("openwork.react.settings.theme-mode", mode); } catch {}
    return mode;
  })()`;
}

function buildLiveEvalExpression(selectors) {
  return `(() => {
  const toRgb = (c) => {
    const m = String(c).match(/rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([0-9.]+))?\\)/i);
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4], raw: c };
  };
  const hex = ({ r, g, b }) => {
    const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
    return ("#" + h(r) + h(g) + h(b)).toUpperCase();
  };
  const mix = (fg, bg) => ({
    r: fg.a * fg.r + (1 - fg.a) * bg.r,
    g: fg.a * fg.g + (1 - fg.a) * bg.g,
    b: fg.a * fg.b + (1 - fg.a) * bg.b,
  });
  const nearestOpaqueBg = (el) => {
    let node = el;
    let layered = null;
    for (let i = 0; i < 16 && node; i += 1) {
      const parsed = toRgb(getComputedStyle(node).backgroundColor);
      if (parsed && parsed.a > 0.12) {
        layered = layered ? mix({ ...parsed, a: parsed.a }, layered) : { r: parsed.r, g: parsed.g, b: parsed.b };
        if (parsed.a >= 0.95) {
          return { raw: parsed.raw, hex: hex(layered), alpha: 1 };
        }
      }
      node = node.parentElement;
    }
    if (layered) return { raw: "composited", hex: hex(layered), alpha: 1 };
    return { raw: "rgb(0,0,0)", hex: "#000000", alpha: 1 };
  };
  const pick = (role, sel, required) => {
    const el = document.querySelector(sel);
    if (!el) return { role, sel, required: !!required, missing: true };
    const cs = getComputedStyle(el);
    const fgParsed = toRgb(cs.color);
    const bg = nearestOpaqueBg(el);
    return {
      role,
      sel,
      required: !!required,
      text: (el.innerText || el.textContent || "").trim().slice(0, 48),
      fg: fgParsed ? hex(fgParsed) : null,
      colorRaw: cs.color,
      bg: bg.hex,
      bgRaw: bg.raw,
      opacity: cs.opacity,
    };
  };
  const shell = document.querySelector(".wapp-workspace-shell");
  const samples = ${JSON.stringify(selectors)}.map((item) =>
    pick(item.role, item.sel, item.required)
  );
  return {
    skinClass: shell ? [...shell.classList].filter((c) => c.startsWith("wapp-skin-")) : [],
    theme: document.documentElement.dataset.theme || null,
    colorScheme: document.documentElement.style.colorScheme || null,
    href: location.href,
    title: document.title,
    samples,
  };
})()`;
}

const ENSURE_ACTIVE = `(() => {
  if (document.querySelector('.wapp-recent-row.is-active .wapp-recent-title')) return 'already-active';
  const item = document.querySelector('.wapp-recent-row .wapp-recent-item');
  if (!item) return 'no-recent';
  item.click();
  return 'clicked';
})()`;

const opts = parseArgs(process.argv);
const found = await findCdpPage(opts.ports);

if (found.error) {
  const payload = {
    ok: !opts.require,
    skipped: true,
    layer: "live",
    reason: found.error,
    hint: opts.require
      ? "Desktop CDP required (--require) but not reachable"
      : "No desktop CDP; static gate still applies. Re-run with app up or --require",
  };
  if (opts.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else {
    console.log(`Skin contrast live audit: SKIPPED (${found.error})`);
    console.log(payload.hint);
  }
  process.exit(opts.require ? 1 : 0);
}

let livePort = found.port;
let live = cdpSession(found.page.webSocketDebuggerUrl);
await live.ready;
await live.send("Runtime.enable");
await live.send("Page.enable");

let resolvedSkin = opts.skin;
if (resolvedSkin === "auto") {
  const detected = await live.send("Runtime.evaluate", {
    expression: buildDetectSkinExpression(),
    returnByValue: true,
  });
  const value = detected.result?.value;
  if (value === "no-shell") {
    live.ws.close();
    const payload = {
      ok: !opts.require,
      skipped: true,
      layer: "live",
      port: livePort,
      reason: "Connected CDP page does not contain the WodeAppX workspace shell",
      hint: opts.require
        ? "Open a WodeAppX workspace before running --require"
        : "Non-target CDP page skipped; static WCAG gate still applies",
    };
    if (opts.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    else {
      console.log(`Skin contrast live audit: SKIPPED (${payload.reason})`);
      console.log(payload.hint);
    }
    process.exit(opts.require ? 1 : 0);
  }
  if (!SKIN_PRESETS[value]) {
    live.ws.close();
    const payload = {
      ok: !opts.require,
      skipped: true,
      layer: "live",
      port: livePort,
      reason: `Unable to auto-detect skin (got ${JSON.stringify(value)})`,
      hint: `Pass --skin ${Object.keys(SKIN_PRESETS).join("|")} explicitly, or open a branded workbench shell`,
    };
    if (opts.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    else {
      console.log(`Skin contrast live audit: SKIPPED (${payload.reason})`);
      console.log(payload.hint);
    }
    process.exit(opts.require ? 1 : 0);
  }
  resolvedSkin = value;
}

const preset = SKIN_PRESETS[resolvedSkin];
const forceSkin = opts.skin !== "auto";

const asserted = await live.send("Runtime.evaluate", {
  expression: buildAssertSkinExpression(preset, { force: forceSkin }),
  returnByValue: true,
});
if (asserted.result?.value !== "ok") {
  live.ws.close();
  const payload = {
    ok: !opts.require,
    skipped: true,
    layer: "live",
    port: livePort,
    reason: "Connected CDP page does not contain the WodeAppX workspace shell",
    hint: opts.require
      ? `Open a WodeAppX workspace before running --require (--skin ${resolvedSkin})`
      : "Non-target CDP page skipped; static WCAG gate still applies",
  };
  if (opts.json) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else {
    console.log(`Skin contrast live audit: SKIPPED (${payload.reason})`);
    console.log(payload.hint);
  }
  process.exit(opts.require ? 1 : 0);
}

const themeApplied = await live.send("Runtime.evaluate", {
  expression: buildAssertThemeExpression(opts.theme),
  returnByValue: true,
});
if (opts.theme !== "keep") {
  await new Promise((r) => setTimeout(r, 200));
}

const ensured = await live.send("Runtime.evaluate", {
  expression: ENSURE_ACTIVE,
  returnByValue: true,
});
if (ensured.result?.value === "clicked") {
  await new Promise((r) => setTimeout(r, 450));
  await live.send("Runtime.evaluate", {
    expression: buildAssertSkinExpression(preset, { force: forceSkin }),
    returnByValue: true,
  });
  if (opts.theme !== "keep") {
    await live.send("Runtime.evaluate", {
      expression: buildAssertThemeExpression(opts.theme),
      returnByValue: true,
    });
  }
}

const evaluated = await live.send("Runtime.evaluate", {
  expression: buildLiveEvalExpression(preset.selectors),
  returnByValue: true,
});
const data = evaluated.result?.value;
if (!data) {
  console.error("CDP evaluate returned empty");
  live.ws.close();
  process.exit(1);
}

const withMins = data.samples.map((sample) => {
  const spec = preset.selectors.find((item) => item.role === sample.role);
  return {
    ...sample,
    min: spec?.min,
    required: spec?.required ?? false,
    fg: sample.fg || parseCssColorToHex(sample.colorRaw),
    bg: sample.bg || parseCssColorToHex(sample.bgRaw),
  };
});

const audit = auditLiveSamples(withMins);
const skinOk = Array.isArray(data.skinClass) && data.skinClass.includes(preset.className);
const themeOk =
  opts.theme === "keep" || String(data.theme || themeApplied.result?.value) === opts.theme;

let screenshotPath = null;
if (opts.screenshot) {
  const shot = await live.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
  });
  mkdirSync(path.dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, Buffer.from(shot.data, "base64"));
  screenshotPath = opts.out;
}

live.ws.close();

const ok = audit.ok && skinOk && themeOk;
const payload = {
  ok,
  layer: "live",
  port: livePort,
  skin: resolvedSkin,
  skinRequested: opts.skin,
  themeRequested: opts.theme,
  theme: data.theme,
  href: data.href,
  skinClass: data.skinClass,
  skinOk,
  themeOk,
  samples: audit.results.map((item) => ({
    role: item.role,
    sel: item.sel,
    text: item.text,
    fg: item.fg,
    bg: item.bg,
    ratio: item.ratio == null ? null : Number(item.ratio.toFixed(2)),
    min: item.min,
    pass: item.pass,
    note: item.note,
  })),
  failures: audit.results.filter((item) => item.pass === false),
  screenshotPath,
};

if (opts.json) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} else {
  console.log(`Skin contrast live audit (CDP :${livePort}, skin=${resolvedSkin}, theme=${opts.theme})`);
  console.log(`  skin: ${payload.skinClass.join(", ") || "(none)"} [${skinOk ? "PASS" : "FAIL"}]`);
  console.log(`  theme: ${payload.theme || "(unset)"} [${themeOk ? "PASS" : "FAIL"}]`);
  for (const row of payload.samples) {
    if (row.note === "missing") {
      console.log(`  [${row.pass ? "PASS" : "FAIL"}] ${row.role}: missing ${row.sel}`);
      continue;
    }
    console.log(
      `  [${row.pass ? "PASS" : "FAIL"}] ${row.role}: ${row.fg} on ${row.bg} → ${row.ratio}:1 (min ${row.min})`,
    );
  }
  if (screenshotPath) console.log(`  screenshot: ${screenshotPath}`);
  console.log(ok ? "OK" : "FAILED");
}

process.exit(ok ? 0 : 1);
