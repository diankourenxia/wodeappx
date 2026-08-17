import http from "node:http";
import { randomBytes } from "node:crypto";
import { shell } from "electron";
import {
  normalizeWodeAppCloudOrigin,
  saveWodeAppConfig,
  WODEAPP_CLOUD_ORIGIN,
} from "./config-store.mjs";
import {
  applyDesktopHandoffCors,
  buildDesktopLoginUrl,
  DESKTOP_HANDOFF_PATH,
  DESKTOP_LOGIN_TIMEOUT_MS,
  parseDesktopHandoffPayload,
  probeDesktopBootstrapRoute,
} from "./login-bridge-handoff.mjs";

export { isLoginCancelKey, isLoginCancelUrl } from "./login-bridge-close.mjs";

let pendingDesktopLoginFinish = null;

function createHandoffState() {
  return randomBytes(24).toString("base64url");
}

export function cancelWodeAppDesktopLogin() {
  if (!pendingDesktopLoginFinish) return false;
  pendingDesktopLoginFinish({ ok: false, error: "已取消绑定" });
  return true;
}

function readRequestBody(req, limit = 64_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("payload_too_large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Open the system browser on /desktop-handoff.html, then wait for the page to
 * POST desktop-bootstrap result to a loopback handoff server.
 */
export async function runWodeAppDesktopLogin(parent, origin = WODEAPP_CLOUD_ORIGIN, options = {}) {
  cancelWodeAppDesktopLogin();
  const base = normalizeWodeAppCloudOrigin(origin);
  const state = createHandoffState();
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;

  return new Promise((resolve) => {
    let settled = false;
    let timeout = null;
    const server = http.createServer(async (req, res) => {
      const path = String(req.url || "").split("?")[0];
      const originHeader = String(req.headers.origin || "");
      if (req.method === "OPTIONS") {
        applyDesktopHandoffCors(res, originHeader);
        res.writeHead(204);
        res.end();
        return;
      }
      if (req.method !== "POST" || path !== DESKTOP_HANDOFF_PATH) {
        res.writeHead(404);
        res.end();
        return;
      }
      applyDesktopHandoffCors(res, originHeader);
      let raw = "";
      try {
        raw = await readRequestBody(req);
      } catch {
        res.writeHead(413);
        res.end(JSON.stringify({ ok: false }));
        return;
      }
      const parsed = parseDesktopHandoffPayload(raw, state);
      if (!parsed.ok) {
        res.writeHead(parsed.error === "state_mismatch" ? 403 : 400);
        res.end(JSON.stringify({ ok: false }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      if (parsed.cancel) {
        finish({ ok: false, error: "已取消绑定" });
        return;
      }
      if (parsed.progress) {
        try {
          onProgress?.(parsed.phase || "initializing");
        } catch {
          // ignore renderer progress errors
        }
        return;
      }
      try {
        const { buildLoggedInWodeAppConfig } = await import("./code-login.mjs");
        const issuedOrigin = normalizeWodeAppCloudOrigin(parsed.data.issuedOrigin || base);
        const config = await buildLoggedInWodeAppConfig({
          profile: issuedOrigin.includes("localhost") || issuedOrigin.includes("127.0.0.1")
            ? "selfhost"
            : "cloud",
          origin: issuedOrigin,
          issuedOrigin,
          apiKey: parsed.data.apiKey,
          projectSubdomainSuffix: parsed.data.projectSubdomainSuffix
            ?? (issuedOrigin.includes("wodeapp.ai") ? ".wodeapp.ai" : ".wodeapp.cn"),
          user: parsed.data.user && typeof parsed.data.user === "object" ? parsed.data.user : undefined,
          abilityProjects: Array.isArray(parsed.data.abilityProjects) ? parsed.data.abilityProjects : [],
        });
        const saved = await saveWodeAppConfig(config);
        finish({ ok: true, config: saved });
      } catch (error) {
        finish({
          ok: false,
          error: error instanceof Error ? error.message : "账号绑定失败",
        });
      }
    });

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (pendingDesktopLoginFinish === finish) pendingDesktopLoginFinish = null;
      if (timeout) clearTimeout(timeout);
      server.close();
      if (result.ok && parent && !parent.isDestroyed()) {
        try {
          parent.show();
          parent.focus();
        } catch {
          // ignore
        }
      }
      resolve(result);
    };
    pendingDesktopLoginFinish = finish;

    server.on("error", () => {
      finish({ ok: false, error: "无法启动桌面回跳" });
    });

    void (async () => {
      try {
        const probe = await probeDesktopBootstrapRoute(base);
        if (probe.missing) {
          finish({
            ok: false,
            error: "国际站尚未开通桌面回跳，请改选中国大陆",
          });
          return;
        }
      } catch (error) {
        console.warn("[wodeapp-login] bootstrap probe failed", error);
      }

      server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      if (!port) {
        finish({ ok: false, error: "无法启动桌面回跳" });
        return;
      }
      timeout = setTimeout(() => {
        finish({ ok: false, error: "登录超时，请从 WodeAppX 重试" });
      }, DESKTOP_LOGIN_TIMEOUT_MS);
      const loginUrl = buildDesktopLoginUrl(base, port, state);
      console.info("[wodeapp-login] opened system browser", { origin: base, port });
      try {
        await shell.openExternal(loginUrl, { activate: true });
      } catch (error) {
        finish({
          ok: false,
          error: error instanceof Error ? error.message : "无法打开浏览器",
        });
      }
      });
    })();
  });
}
