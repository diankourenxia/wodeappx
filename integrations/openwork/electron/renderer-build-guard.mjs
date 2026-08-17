export function validateRendererIndex(indexHtml, indexPath = "index.html") {
  const html = String(indexHtml ?? "");
  if (!html) {
    return { ok: false, reason: `Missing renderer index: ${indexPath}` };
  }
  const rootRelativeAsset = html.match(/\b(?:src|href)=["']\/(?!\/)[^"']+["']/i);
  if (rootRelativeAsset) {
    return {
      ok: false,
      reason: `Invalid root-relative asset: ${rootRelativeAsset[0]}`,
    };
  }
  return { ok: true, reason: null };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * @param {string} rendererUrl
 * @param {{
 *   fetchImpl?: typeof fetch;
 *   attemptTimeoutMs?: number;
 *   retryDelayMs?: number;
 *   signal?: AbortSignal;
 * }} [options]
 */
export async function waitForRendererUrl(
  rendererUrl,
  {
    fetchImpl = globalThis.fetch,
    attemptTimeoutMs = 2_500,
    retryDelayMs = 750,
    signal,
  } = {},
) {
  while (!signal?.aborted) {
    const attemptController = new AbortController();
    const abortAttempt = () => attemptController.abort();
    const attemptTimer = setTimeout(abortAttempt, attemptTimeoutMs);
    signal?.addEventListener("abort", abortAttempt, { once: true });
    try {
      const response = await fetchImpl(rendererUrl, {
        cache: "no-store",
        signal: attemptController.signal,
      });
      if (response.ok) return true;
    } catch {
      if (signal?.aborted) return false;
    } finally {
      clearTimeout(attemptTimer);
      signal?.removeEventListener("abort", abortAttempt);
    }

    await new Promise((resolve) => {
      let settled = false;
      let timer;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        signal?.removeEventListener("abort", finish);
        resolve();
      };
      timer = setTimeout(finish, retryDelayMs);
      signal?.addEventListener("abort", finish, { once: true });
    });
  }

  return false;
}

export function rendererDevServerErrorHtml(appName, rendererUrl, details) {
  const safeAppName = escapeHtml(appName || "WodeAppX");
  const safeRendererUrl = escapeHtml(rendererUrl || "本地页面服务");
  const safeDetails = escapeHtml(details || "Renderer service is unavailable");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${safeAppName}</title>
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f7fb; color: #172033; }
    main { width: min(620px, calc(100vw - 48px)); padding: 32px; border: 1px solid #d9dfeb; border-radius: 18px; background: #fff; box-shadow: 0 18px 50px rgba(24, 39, 75, .12); }
    h1 { margin: 0 0 12px; font-size: 22px; }
    p { margin: 8px 0; line-height: 1.65; }
    code { display: block; margin-top: 18px; padding: 12px; border-radius: 10px; background: #eef2f8; color: #42506a; overflow-wrap: break-word; }
    @media (prefers-color-scheme: dark) {
      body { background: #10141d; color: #edf2ff; }
      main { background: #171d28; border-color: #313b4d; box-shadow: none; }
      code { background: #0e131c; color: #b9c5dc; }
    }
  </style>
</head>
<body>
  <main>
    <h1>桌面界面正在恢复</h1>
    <p>页面服务暂时不可用。WodeAppX 正在等待服务恢复，恢复后会自动重新打开，无需反复重启。</p>
    <code>${safeRendererUrl}<br>${safeDetails}</code>
  </main>
</body>
</html>`;
}

export function rendererBuildErrorHtml(appName, details) {
  const safeAppName = escapeHtml(appName || "WodeAppX");
  const safeDetails = escapeHtml(details || "Unknown renderer build error");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${safeAppName}</title>
  <style>
    :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f7fb; color: #172033; }
    main { width: min(620px, calc(100vw - 48px)); padding: 32px; border: 1px solid #d9dfeb; border-radius: 18px; background: #fff; box-shadow: 0 18px 50px rgba(24, 39, 75, .12); }
    h1 { margin: 0 0 12px; font-size: 22px; }
    p { margin: 8px 0; line-height: 1.65; }
    code { display: block; margin-top: 18px; padding: 12px; border-radius: 10px; background: #eef2f8; color: #42506a; overflow-wrap: break-word; }
    @media (prefers-color-scheme: dark) {
      body { background: #10141d; color: #edf2ff; }
      main { background: #171d28; border-color: #313b4d; box-shadow: none; }
      code { background: #0e131c; color: #b9c5dc; }
    }
  </style>
</head>
<body>
  <main>
    <h1>桌面界面资源未正确构建</h1>
    <p>WodeAppX 已阻止空白窗口。请重新安装最新版；开发环境请使用桌面构建命令重新生成并同步资源。</p>
    <code>${safeDetails}</code>
  </main>
</body>
</html>`;
}
