#!/usr/bin/env node
/**
 * Live PERF-07 probe against running WodeAppX Electron (CDP).
 * No model send — inspect code load + scroll/longtask on current session.
 */
const port = Number(process.env.CDP_PORT || process.argv[2] || 9823);
if (typeof WebSocket !== "function") {
  throw new Error("Node global WebSocket required");
}
const base = `http://127.0.0.1:${port}`;

async function listTargets() {
  const res = await fetch(`${base}/json/list`);
  if (!res.ok) throw new Error(`CDP list failed: ${res.status}`);
  return res.json();
}

function cdpSession(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const events = [];

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });

  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    if (msg.method) events.push(msg);
  });

  async function send(method, params = {}) {
    await ready;
    const id = nextId++;
    const result = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30_000);
    });
    ws.send(JSON.stringify({ id, method, params }));
    return result;
  }

  return {
    send,
    events,
    close: () => {
      try { ws.close(); } catch (_) {}
    },
  };
}

async function main() {
  const targets = await listTargets();
  const page = targets.find((t) => t.type === "page" && /localhost:5174|小灵通|WodeApp/i.test(`${t.title} ${t.url}`))
    || targets.find((t) => t.type === "page");
  if (!page?.webSocketDebuggerUrl) {
    throw new Error(`No page target on :${port}`);
  }

  const cdp = cdpSession(page.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");

  const evalExpr = async (expression, awaitPromise = true) => {
    const result = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || JSON.stringify(result.exceptionDetails));
    }
    return result.result?.value;
  };

  const probe = await evalExpr(`(async () => {
    const href = location.href;
    const title = document.title;
    const editable = document.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]').length;

    async function fetchText(url) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return { url, ok: false, status: res.status, len: 0, hits: {} };
        const text = await res.text();
        return {
          url,
          ok: true,
          status: res.status,
          len: text.length,
          hits: {
            partUpdateBuffer: text.includes("partUpdateBuffer"),
            flushTranscriptBuffers: text.includes("flushTranscriptBuffers"),
            shouldFlushPartUpdateImmediately: text.includes("shouldFlushPartUpdateImmediately"),
            assistantOutputMarkGate: text.includes("assistantOutputMarkGate"),
            TOOL_ACTIVITY_UI_MS: text.includes("TOOL_ACTIVITY_UI_MS") || text.includes("200"),
            PERF07_comment: text.includes("PERF-07"),
          },
        };
      } catch (error) {
        return { url, ok: false, error: String(error), hits: {} };
      }
    }

    const candidates = [
      "/src/react-app/domains/session/sync/session-sync.ts",
      "/@fs/Users/macpassword0000/Desktop/wodeapp/wodeappx/vendor/openwork/apps/app/src/react-app/domains/session/sync/session-sync.ts",
      "/src/react-app/domains/wodeapp/wodeapp-session-event-batch.ts",
      "/@fs/Users/macpassword0000/Desktop/wodeapp/wodeappx/vendor/openwork/apps/app/src/react-app/domains/wodeapp/wodeapp-session-event-batch.ts",
      "/@fs/Users/macpassword0000/Desktop/wodeapp/wodeappx/integrations/openwork/wodeapp/wodeapp-session-event-batch.ts",
    ];
    const sources = [];
    for (const url of candidates) sources.push(await fetchText(url));

    // Find scrollable transcript / message list
    const scrollers = [...document.querySelectorAll("div, main, section")]
      .filter((el) => {
        const style = getComputedStyle(el);
        const overflowY = style.overflowY;
        return (overflowY === "auto" || overflowY === "scroll") && el.scrollHeight > el.clientHeight + 80;
      })
      .map((el) => ({
        tag: el.tagName,
        className: String(el.className || "").slice(0, 120),
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        scrollTop: el.scrollTop,
      }))
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))
      .slice(0, 5);

    return { href, title, editable, sources, scrollers };
  })()`);

  // Install longtask + rAF FPS sampler, then scroll the biggest scroller.
  // Important: do NOT use buffered:true — that pulls page-lifetime longtasks.
  const scrollPerf = await evalExpr(`(async () => {
    const longTasks = [];
    let observer = null;
    const windowStart = performance.now();
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.startTime < windowStart) continue;
          longTasks.push({ name: entry.name, duration: entry.duration, startTime: entry.startTime });
        }
      });
      observer.observe({ type: "longtask", buffered: false });
    } catch (_) {}

    const scroller = [...document.querySelectorAll("div, main, section")]
      .filter((el) => {
        const style = getComputedStyle(el);
        return (style.overflowY === "auto" || style.overflowY === "scroll") && el.scrollHeight > el.clientHeight + 80;
      })
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0];

    if (!scroller) {
      return { ok: false, reason: "no-scroller", longTasks };
    }

    const frameGaps = [];
    let last = performance.now();
    let frames = 0;
    let stop = false;
    const onFrame = (now) => {
      frameGaps.push(now - last);
      last = now;
      frames += 1;
      if (!stop) requestAnimationFrame(onFrame);
    };
    requestAnimationFrame(onFrame);

    const startTop = scroller.scrollTop;
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const steps = 24;
    for (let i = 0; i <= steps; i += 1) {
      scroller.scrollTop = Math.round((maxTop * i) / steps);
      await new Promise((r) => requestAnimationFrame(r));
    }
    for (let i = steps; i >= 0; i -= 1) {
      scroller.scrollTop = Math.round((maxTop * i) / steps);
      await new Promise((r) => requestAnimationFrame(r));
    }
    await new Promise((r) => setTimeout(r, 200));
    stop = true;
    observer?.disconnect();

    const gaps = frameGaps.slice(2); // drop startup
    const avgGap = gaps.reduce((a, b) => a + b, 0) / Math.max(1, gaps.length);
    const fps = avgGap > 0 ? 1000 / avgGap : 0;
    const longOver50 = longTasks.filter((t) => t.duration >= 50);
    return {
      ok: true,
      className: String(scroller.className || "").slice(0, 160),
      scrollRange: maxTop,
      startTop,
      endTop: scroller.scrollTop,
      frames,
      avgFrameGapMs: Math.round(avgGap * 100) / 100,
      fps: Math.round(fps * 10) / 10,
      longTaskCount: longTasks.length,
      longTaskOver50: longOver50.length,
      maxLongTaskMs: longTasks.reduce((m, t) => Math.max(m, t.duration), 0),
      longTasksSample: longOver50.slice(0, 5),
      measureWindowMs: Math.round(performance.now() - windowStart),
    };
  })()`);

  // Composer focus smoke (no send, no clear)
  const composer = await evalExpr(`(() => {
    const el = document.querySelector('[contenteditable="true"], textarea, [role="textbox"]');
    if (!el) return { ok: false, reason: "no-composer" };
    el.focus();
    const before = (el.innerText || el.value || "").slice(0, 80);
    return {
      ok: true,
      tag: el.tagName,
      focused: document.activeElement === el,
      beforePreview: before,
      bodyHasSession: /ses_/.test(location.href),
    };
  })()`);

  cdp.close();

  const syncHit = (probe.sources || []).find((s) => s.hits?.partUpdateBuffer);
  const batchHit = (probe.sources || []).find((s) => s.hits?.shouldFlushPartUpdateImmediately || s.url.includes("event-batch"));

  const verdict = {
    cdpPort: port,
    target: { title: page.title, url: page.url },
    probe: {
      href: probe.href,
      editable: probe.editable,
      codeLoaded: Boolean(syncHit?.ok && syncHit.hits.partUpdateBuffer && syncHit.hits.flushTranscriptBuffers),
      syncSource: syncHit || null,
      batchSource: batchHit || null,
    },
    scrollPerf,
    composer,
    pass: {
      cdpReachable: true,
      perf07CodeInDevServer: Boolean(syncHit?.hits?.partUpdateBuffer && syncHit?.hits?.shouldFlushPartUpdateImmediately),
      scrollFpsOk: Boolean(scrollPerf?.ok && scrollPerf.fps >= 45),
      longTaskOk: Boolean(scrollPerf?.ok && scrollPerf.longTaskOver50 === 0),
      composerFocusable: Boolean(composer?.ok && composer.focused),
    },
  };

  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.pass.perf07CodeInDevServer && verdict.pass.composerFocusable ? 0 : 1);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error) }, null, 2));
  process.exit(1);
});
