#!/usr/bin/env node
/**
 * Capture promo screenshots (+ optional short screencasts) for visible skins.
 *
 * Requires a running desktop with Electron remote debugging
 * (OPENWORK_ELECTRON_REMOTE_DEBUG_PORT or ports 9823 / 9223).
 *
 * Usage:
 *   node wodeappx/scripts/capture-skin-promo-assets.mjs
 *   node wodeappx/scripts/capture-skin-promo-assets.mjs --record --seconds 4
 *   node wodeappx/scripts/capture-skin-promo-assets.mjs --theme both
 *   node wodeappx/scripts/capture-skin-promo-assets.mjs --skin summer-breeze,red-compact
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(root, "..");

const PROMO_SKINS = [
  "beauty",
  "pet-soft",
  "cute-pastel",
  "ink-book",
  "otome-diary",
  "red-compact",
  "summer-breeze",
  "aurora-night",
  "forest-mist",
  "coffee-loft",
  "noir-jazz",
];

function parseArgs(argv) {
  const opts = {
    ports: [],
    skins: [...PROMO_SKINS],
    themes: ["light"],
    record: false,
    seconds: 3.5,
    outDir: path.join(repoRoot, "wodeappx/docs/promo/skins"),
    // 不改 CSS 视口（避免重排导致元素对不上）；只做整页等比缩放 + 高清截图
    zoom: 0.72,
    scale: 2,
    clipShell: true,
    collapseSidebar: false,
    hidePerf: true,
    lang: "",
  };
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[i];
    };
    if (arg === "--port") opts.ports.push(Number(next()));
    else if (arg === "--skin") {
      opts.skins = String(next())
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg === "--theme") {
      const theme = String(next()).trim().toLowerCase();
      if (theme === "both") opts.themes = ["light", "dark"];
      else if (theme === "light" || theme === "dark") opts.themes = [theme];
      else throw new Error(`Unknown --theme ${theme}`);
    } else if (arg === "--record") opts.record = true;
    else if (arg === "--seconds") opts.seconds = Number(next());
    else if (arg === "--out") opts.outDir = path.resolve(next());
    else if (arg === "--zoom") opts.zoom = Number(next());
    else if (arg === "--scale") opts.scale = Number(next());
    else if (arg === "--width" || arg === "--height" || arg === "--dpr") {
      // 兼容旧参数：忽略视口覆写，避免再次触发重排
      next();
      console.warn(`ignore deprecated ${arg}: promo capture keeps native layout + --zoom`);
    } else if (arg === "--no-clip") opts.clipShell = false;
    else if (arg === "--collapse-sidebar") opts.collapseSidebar = true;
    else if (arg === "--no-collapse-sidebar") opts.collapseSidebar = false;
    else if (arg === "--keep-perf") opts.hidePerf = false;
    else if (arg === "--lang") {
      const lang = String(next()).trim().toLowerCase();
      if (lang !== "zh" && lang !== "en") throw new Error(`Unknown --lang ${lang}`);
      opts.lang = lang;
    } else if (arg === "-h" || arg === "--help") {
      console.log(
        "Usage: capture-skin-promo-assets.mjs [--port N] [--skin a,b] [--theme light|dark|both] [--record] [--seconds N] [--out dir] [--zoom 0.72] [--scale 2] [--lang zh|en] [--no-clip] [--collapse-sidebar] [--keep-perf]",
      );
      process.exit(0);
    } else throw new Error(`Unknown arg: ${arg}`);
  }
  if (!Number.isFinite(opts.zoom) || opts.zoom <= 0.2 || opts.zoom > 1.5) {
    throw new Error(`Invalid --zoom ${opts.zoom}`);
  }
  if (!Number.isFinite(opts.scale) || opts.scale < 1 || opts.scale > 3) {
    throw new Error(`Invalid --scale ${opts.scale}`);
  }
  if (!opts.ports.length) {
    const envPort = Number(process.env.OPENWORK_ELECTRON_REMOTE_DEBUG_PORT || "");
    opts.ports = Number.isFinite(envPort) && envPort > 0 ? [envPort, 9823, 9223] : [9823, 9223];
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
      const pages = (list || []).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
      // Prefer local Vite workbench; never skin-capture embedded runtime-app tabs.
      const page =
        pages.find((t) => /localhost:517[0-9]/.test(t.url || "") && !/[?&]embed=1\b/.test(t.url || "")) ||
        pages.find((t) => /127\.0\.0\.1:517[0-9]/.test(t.url || "")) ||
        pages.find(
          (t) =>
            /wodeappx|openwork/i.test(`${t.title} ${t.url}`) &&
            !/wodeapp\.(cn|ai)/i.test(t.url || "") &&
            !/[?&]embed=1\b/.test(t.url || ""),
        ) ||
        pages.find((t) => !/google\.com|chrome:\/\//i.test(t.url || "") && !/[?&]embed=1\b/.test(t.url || ""));
      if (page?.webSocketDebuggerUrl) return { port, page, url: page.url };
      errors.push(`port ${port}: no page target`);
    } catch (err) {
      errors.push(`port ${port}: ${err.message}`);
    }
  }
  throw new Error(`No Electron CDP page. Tried: ${errors.join("; ")}`);
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
    if (msg.method) {
      for (const fn of listeners) fn(msg);
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
  function onEvent(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  return { ws, ready, send, onEvent };
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

const SKIN_PICKER_LABEL = {
  default: "默认外观",
  "classic-blue": "经典蓝色",
  beauty: "美妆种草",
  "pet-soft": "萌宠柔光",
  "cute-pastel": "可爱马卡龙",
  "ink-book": "水墨书卷",
  "otome-diary": "蔷薇日记",
  "red-compact": "红色紧凑",
  "summer-breeze": "夏日海风",
  "aurora-night": "极光夜航",
  "forest-mist": "林间晨雾",
  "coffee-loft": "咖啡阁楼",
  "noir-jazz": "午夜爵士",
};

async function applySkinAndTheme(send, skinId, theme) {
  const label = SKIN_PICKER_LABEL[skinId] || skinId;
  // 必须走 React 皮肤选择：只改 class 不会换印章/桌宠/趴宠
  const res = await send("Runtime.evaluate", {
    expression: `(() => {
      const skinId = ${JSON.stringify(skinId)};
      const label = ${JSON.stringify(label)};
      const theme = ${JSON.stringify(theme)};

      try {
        // Persist skin so reload / remount cannot leave a stale data-wapp-skin.
        localStorage.setItem("wodeappx.skin", skinId);
        localStorage.setItem("wodeappx.companion.enabled", "true");
        localStorage.setItem("wodeappx.companion.perch", "true");
        localStorage.setItem("wodeappx.companion.perch.kind", "sprite");
        // Clear stale custom perch ids so skin kit default (e.g. perch-otome) wins.
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
        localStorage.setItem("wodeappx.product-desk", "default");
        window.dispatchEvent(new Event("wodeappx:companion-prefs"));
      } catch {}

      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
      try { localStorage.setItem("openwork.react.settings.theme-mode", theme); } catch {}

      const shell = document.querySelector(".wapp-workspace-shell");
      if (shell && shell.getAttribute("data-wapp-skin") === skinId) {
        return { ok: true, already: true, skin: skinId };
      }

      window.dispatchEvent(new Event("wodeapp:open-skin-picker"));
      return { ok: true, opened: true, label };
    })()`,
    returnByValue: true,
  });
  const opened = res?.result?.value;
  if (opened?.already) {
    await sleep(500);
    return opened;
  }

  await sleep(350);
  const clicked = await send("Runtime.evaluate", {
    expression: `(() => {
      const label = ${JSON.stringify(label)};
      const skinId = ${JSON.stringify(skinId)};
      const cards = [...document.querySelectorAll(".wapp-skin-picker-card, [role='option']")];
      const card = cards.find((el) => {
        const strong = el.querySelector("strong");
        const t = (strong?.textContent || el.textContent || "").trim();
        return t === label || t.startsWith(label);
      });
      if (!card) {
        return {
          ok: false,
          reason: "card-not-found",
          labels: cards.map((el) => (el.querySelector("strong")?.textContent || "").trim()).filter(Boolean),
        };
      }
      card.click();
      return { ok: true, label };
    })()`,
    returnByValue: true,
  });
  if (!clicked?.result?.value?.ok) {
    throw new Error(
      `Failed to select skin ${skinId}: ${JSON.stringify(clicked?.result?.value || clicked)}`,
    );
  }

  // 等 React 真正切到目标皮肤（印章/陪伴跟 skin state）
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const check = await send("Runtime.evaluate", {
      expression: `(() => {
        const shell = document.querySelector(".wapp-workspace-shell");
        return {
          skin: shell?.getAttribute("data-wapp-skin") || null,
          classSkin: [...(shell?.classList || [])].find((c) => c.startsWith("wapp-skin-")) || null,
          brandSrc: document.querySelector(".wapp-brand img, .wapp-brand-mark img")?.getAttribute("src") || null,
          float: !!document.querySelector(".wapp-theme-pet-buddy.is-float"),
          perch: !!document.querySelector(".wapp-theme-pet-buddy.is-perch"),
          perchOnDock: !!document.querySelector(".wapp-composer-dock .wapp-theme-pet-buddy.is-perch, .wapp-composer-shell .wapp-theme-pet-buddy.is-perch"),
          pickerOpen: !!document.querySelector(".wapp-skin-picker-dialog"),
          inkPager: !!document.querySelector(".wapp-ink-book-pager"),
        };
      })()`,
      returnByValue: true,
    });
    const v = check?.result?.value;
    if (v?.skin === skinId) {
      // 关掉可能残留的 picker
      if (v.pickerOpen) {
        await send("Runtime.evaluate", {
          expression: `document.querySelector(".wapp-skin-picker-close")?.click()`,
        }).catch(() => {});
      }
      // Kit skins: wait until 趴宠 portals onto composer (not just float at window corner).
      const needsPerch = ["pet-soft", "otome-diary", "summer-breeze", "aurora-night", "forest-mist", "coffee-loft"].includes(skinId);
      if (needsPerch) {
        const perchDeadline = Date.now() + 4000;
        while (Date.now() < perchDeadline) {
          const perchCheck = await send("Runtime.evaluate", {
            expression: `!!document.querySelector(".wapp-composer-dock .wapp-theme-pet-buddy.is-perch, .wapp-composer-shell .wapp-theme-pet-buddy.is-perch")`,
            returnByValue: true,
          });
          if (perchCheck?.result?.value) break;
          await sleep(120);
        }
      }
      await sleep(650);
      return v;
    }
    await sleep(120);
  }

  // Picker click can fail to commit React state; reload from persisted wodeappx.skin.
  await send("Page.reload", { ignoreCache: true }).catch(() => {});
  await sleep(4500);
  const afterReload = await send("Runtime.evaluate", {
    expression: `(() => {
      const shell = document.querySelector(".wapp-workspace-shell");
      return {
        skin: shell?.getAttribute("data-wapp-skin") || null,
        classSkin: [...(shell?.classList || [])].find((c) => c.startsWith("wapp-skin-")) || null,
      };
    })()`,
    returnByValue: true,
  });
  if (afterReload?.result?.value?.skin === skinId) {
    return { ok: true, via: "reload", ...afterReload.result.value };
  }
  throw new Error(`Timed out waiting for skin ${skinId}`);
}

async function waitForShell(send, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await send("Runtime.evaluate", {
      expression: `!!document.querySelector(".wapp-workspace-shell")`,
      returnByValue: true,
    }).catch(() => null);
    if (res?.result?.value) return true;
    await sleep(200);
  }
  return false;
}

async function readCaptureState(send) {
  const res = await send("Runtime.evaluate", {
    expression: `(() => ({
      lang: localStorage.getItem("openwork.language") || document.documentElement.getAttribute("lang") || "",
      skin: document.querySelector(".wapp-workspace-shell")?.getAttribute("data-wapp-skin") || localStorage.getItem("wodeappx.skin") || "",
    }))()`,
    returnByValue: true,
  });
  return res?.result?.value || { lang: "", skin: "" };
}

async function setCaptureLang(send, lang) {
  if (lang !== "zh" && lang !== "en") return { skipped: true };
  const current = await readCaptureState(send);
  if (current.lang === lang && (await waitForShell(send, 1500))) {
    return { ok: true, already: true, lang };
  }
  await send("Runtime.evaluate", {
    expression: `localStorage.setItem("openwork.language", ${JSON.stringify(lang)})`,
  });
  await send("Page.reload", { ignoreCache: true });
  await sleep(4500);
  const ready = await waitForShell(send);
  if (!ready) throw new Error(`Shell missing after language switch to ${lang}`);
  return { ok: true, reloaded: true, lang };
}

async function focusAgentsSurface(send) {
  await send("Runtime.evaluate", {
    expression: `(() => {
      const back = [...document.querySelectorAll("button")].find((el) =>
        /返回对话|Back to chat/i.test(el.textContent || ""),
      );
      if (back) {
        back.click();
        return { via: "back" };
      }
      window.dispatchEvent(new Event("wodeapp:focus-agents"));
      const agentsNav = [...document.querySelectorAll("button, a, [role='button']")].find((el) => {
        const t = (el.textContent || "").replace(/\\s+/g, " ").trim();
        return t === "默认智能体" || t.startsWith("默认智能体") || /^Default agent/i.test(t);
      });
      agentsNav?.click();
      // Close browser / session rail so pets sit on the chat composer, not over a side panel.
      const railClose = [...document.querySelectorAll("button")].find((el) => {
        const label = (el.getAttribute("aria-label") || el.title || "").trim();
        return /关闭浏览器|关闭侧栏|收起/.test(label);
      });
      railClose?.click();
      document.querySelector(".wapp-session-rail button[aria-pressed='true']")?.click();
      return { via: "focus-agents", foundDef: Boolean(agentsNav) };
    })()`,
    returnByValue: true,
  }).catch(() => {});
  await sleep(650);
}

/** 保持真实窗口布局：不用 setDeviceMetricsOverride / css zoom（会重排）。用 transform scale 等比缩小后截。 */
async function preparePromoCapture(send, opts) {
  try {
    await send("Emulation.clearDeviceMetricsOverride");
  } catch {
    /* ignore */
  }
  const res = await send("Runtime.evaluate", {
    expression: `(() => {
      const root = document.documentElement;
      root.style.zoom = "";

      const shell = document.querySelector(".wapp-workspace-shell");
      if (!shell) return { ok: false };

      if (!shell.dataset.promoCaptureArmed) {
        shell.dataset.promoCaptureArmed = "1";
        shell.dataset.promoPrevTransform = shell.style.transform || "";
        shell.dataset.promoPrevOrigin = shell.style.transformOrigin || "";
      }

      if (${opts.collapseSidebar ? "true" : "false"}) shell.classList.add("is-sidebar-collapsed");
      else shell.classList.remove("is-sidebar-collapsed");

      const z = ${JSON.stringify(Number(opts.zoom))};
      if (z !== 1) {
        shell.style.transformOrigin = "top left";
        shell.style.transform = "scale(" + z + ")";
      } else {
        shell.style.transform = shell.dataset.promoPrevTransform || "";
        shell.style.transformOrigin = shell.dataset.promoPrevOrigin || "";
      }

      if (${opts.hidePerf ? "true" : "false"}) {
        const candidates = [
          ...document.querySelectorAll(".wapp-perf-hud, .wapp-perf, #wapp-perf, [data-perf], [class*='PerfMonitor']"),
        ];
        for (const el of candidates) {
          el.setAttribute("data-promo-hidden", "1");
          el.style.setProperty("display", "none", "important");
        }
        for (const el of document.querySelectorAll("body > div, body > aside, #root ~ div")) {
          const t = (el.textContent || "").replace(/\\s+/g, " ").trim();
          if (!t.startsWith("PERF") || t.length > 120) continue;
          const st = getComputedStyle(el);
          if (st.position !== "fixed" && st.position !== "absolute") continue;
          el.setAttribute("data-promo-hidden", "1");
          el.style.setProperty("display", "none", "important");
        }
      }

      window.scrollTo(0, 0);
      document.querySelectorAll(".wapp-sidebar-scroll, .wapp-content, [data-slot='sidebar-inset']").forEach((el) => {
        if (el) el.scrollTop = 0;
      });

      const r = shell.getBoundingClientRect();
      return {
        ok: true,
        zoom: z,
        inner: { w: innerWidth, h: innerHeight },
        shell: { x: r.x, y: r.y, w: r.width, h: r.height },
      };
    })()`,
    returnByValue: true,
  });
  await sleep(450);
  return res?.result?.value || null;
}

async function restorePromoCapture(send) {
  await send("Runtime.evaluate", {
    expression: `(() => {
      const root = document.documentElement;
      root.style.zoom = "";
      delete root.dataset.promoCapturePrevZoom;

      const shell = document.querySelector(".wapp-workspace-shell");
      if (shell && shell.dataset.promoCaptureArmed === "1") {
        shell.style.transform = shell.dataset.promoPrevTransform || "";
        shell.style.transformOrigin = shell.dataset.promoPrevOrigin || "";
        delete shell.dataset.promoCaptureArmed;
        delete shell.dataset.promoPrevTransform;
        delete shell.dataset.promoPrevOrigin;
      }

      document.querySelectorAll("[data-promo-hidden='1']").forEach((el) => {
        el.style.removeProperty("display");
        el.removeAttribute("data-promo-hidden");
      });
      return "restored";
    })()`,
    returnByValue: true,
  }).catch(() => {});
}

async function getShellClip(send, scale) {
  const res = await send("Runtime.evaluate", {
    expression: `(() => {
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
    returnByValue: true,
  });
  const box = res?.result?.value;
  if (!box || box.width < 40 || box.height < 40) return null;
  return {
    x: Math.floor(box.x),
    y: Math.floor(box.y),
    width: Math.max(1, Math.ceil(box.width)),
    height: Math.max(1, Math.ceil(box.height)),
    scale,
  };
}

async function capturePng(send, outPath, opts) {
  const clip = opts.clipShell ? await getShellClip(send, opts.scale) : null;
  const shot = await send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    ...(clip ? { clip } : {}),
  });
  writeFileSync(outPath, Buffer.from(shot.data, "base64"));
}

async function captureScreencast(send, onEvent, outWebmPath, seconds) {
  const frames = [];
  const off = onEvent((msg) => {
    if (msg.method !== "Page.screencastFrame") return;
    const { data, sessionId, metadata } = msg.params || {};
    if (typeof sessionId === "number") {
      void send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    }
    if (data) {
      frames.push({
        data,
        ts: metadata?.timestamp || Date.now() / 1000,
      });
    }
  });

  await send("Page.startScreencast", {
    format: "jpeg",
    quality: 82,
    maxWidth: 1600,
    maxHeight: 1000,
    everyNthFrame: 2,
  });

  // Light motion so the clip isn't a frozen still.
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) {
    await send("Runtime.evaluate", {
      expression: `(() => {
        const el = document.querySelector(".wapp-sidebar-scroll, .wapp-content, [data-slot='sidebar-inset']") || document.scrollingElement;
        if (!el) return;
        const max = Math.max(0, (el.scrollHeight || 0) - (el.clientHeight || 0));
        if (max < 8) return;
        el.scrollTop = (el.scrollTop + 28) % (max + 1);
      })()`,
    }).catch(() => {});
    await sleep(180);
  }

  await send("Page.stopScreencast").catch(() => {});
  off();

  if (frames.length < 3) {
    writeFileSync(
      `${outWebmPath}.json`,
      JSON.stringify({ ok: false, reason: "too-few-frames", frames: frames.length }, null, 2),
    );
    return { ok: false, frames: frames.length };
  }

  const frameDir = `${outWebmPath}.frames`;
  mkdirSync(frameDir, { recursive: true });
  frames.forEach((frame, i) => {
    writeFileSync(path.join(frameDir, `f-${String(i).padStart(4, "0")}.jpg`), Buffer.from(frame.data, "base64"));
  });

  const ffmpeg = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-framerate",
      "8",
      "-i",
      path.join(frameDir, "f-%04d.jpg"),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      outWebmPath.replace(/\.webm$/i, ".mp4"),
    ],
    { encoding: "utf8" },
  );

  if (ffmpeg.status !== 0) {
    writeFileSync(
      `${outWebmPath}.ffmpeg-error.txt`,
      `${ffmpeg.stderr || ffmpeg.stdout || "ffmpeg failed"}\n`,
    );
    return { ok: false, frames: frames.length, ffmpeg: false };
  }
  return { ok: true, frames: frames.length, mp4: outWebmPath.replace(/\.webm$/i, ".mp4") };
}

async function main() {
  const opts = parseArgs(process.argv);
  mkdirSync(opts.outDir, { recursive: true });

  const { port, page } = await findCdpPage(opts.ports);
  const session = cdpSession(page.webSocketDebuggerUrl);
  await session.ready;
  await session.send("Page.enable");
  await session.send("Runtime.enable");

  const original = await readCaptureState(session.send);
  let prepared;
  try {
    if (opts.lang) {
      const langSwitch = await setCaptureLang(session.send, opts.lang);
      console.log(JSON.stringify({ langSwitch, original }, null, 2));
    }
    prepared = await preparePromoCapture(session.send, opts);
    console.log(JSON.stringify({ prepared }, null, 2));

    const manifest = {
      capturedAt: new Date().toISOString(),
      port,
      outDir: opts.outDir,
      mode: "native-layout+transform-scale",
      zoom: opts.zoom,
      scale: opts.scale,
      clipShell: opts.clipShell,
      collapseSidebar: opts.collapseSidebar,
      lang: opts.lang || original.lang || "",
      prepared,
      skins: [],
    };

    for (const skinId of opts.skins) {
      if (skinId === "supor") {
        console.log(`skip hidden skin: ${skinId}`);
        continue;
      }
      for (const theme of opts.themes) {
        console.log(`capture ${skinId} / ${theme}`);
        await applySkinAndTheme(session.send, skinId, theme);
        await focusAgentsSurface(session.send);
        // 换肤后重新确认 zoom / 侧栏，避免 React 重渲染冲掉
        await preparePromoCapture(session.send, opts);
        const pngPath = path.join(opts.outDir, `${skinId}-${theme}.png`);
        await capturePng(session.send, pngPath, opts);
        const entry = { skinId, theme, png: pngPath };
        if (opts.record) {
          const videoBase = path.join(opts.outDir, `${skinId}-${theme}`);
          entry.record = await captureScreencast(session.send, session.onEvent, `${videoBase}.webm`, opts.seconds);
        }
        manifest.skins.push(entry);
      }
    }

    const manifestPath = path.join(opts.outDir, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(JSON.stringify({ ok: true, manifestPath, count: manifest.skins.length }, null, 2));
  } finally {
    await restorePromoCapture(session.send);
    try {
      if (original.lang && original.lang !== opts.lang) {
        await setCaptureLang(session.send, original.lang === "en" ? "en" : "zh");
      }
      if (original.skin) {
        await applySkinAndTheme(session.send, original.skin, opts.themes[0] || "light").catch(() => {});
      }
    } catch (err) {
      console.warn(`restore original desktop state failed: ${err.message || err}`);
    }
    session.ws.close();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
