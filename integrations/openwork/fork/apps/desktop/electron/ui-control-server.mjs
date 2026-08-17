// Local UI-control HTTP bridge: a loopback server exposing /snapshot,
// /actions, /execute, dispatched to the renderer's window.__openworkControl
// surface via executeJavaScript. Consumed over HTTP by openwork-ui-mcp.
 // Self-heals when the listener dies while Electron stays alive, and keeps
// openwork-ui-control.json aligned with a live /health endpoint.
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { app } from "electron";

const HEALTH_PROBE_TIMEOUT_MS = 800;
const WATCHDOG_INTERVAL_MS = 3_000;

export function createUiControlServer({ appName, appIdentifier, getWindow, logWarn }) {
  let uiControlServer = null;
  let uiControlDiscoveryPath = null;
  let uiControlPort = null;
  let stopping = false;
  let closingIntentionally = false;
  let starting = null;
  let watchdogTimer = null;
  const uiControlToken = randomBytes(32).toString("hex");

  /** @param {...unknown} args */
  function warn(...args) {
    if (typeof logWarn === "function") {
      logWarn(...args);
      return;
    }
    console.warn(...args);
  }

  function discoveryPath() {
    return path.join(app.getPath("userData"), "openwork-ui-control.json");
  }

  function bridgeInfo(port = uiControlPort) {
    if (!port) return null;
    return {
      version: 1,
      app: appName,
      identifier: appIdentifier,
      platform: process.platform,
      baseUrl: `http://127.0.0.1:${port}`,
      token: uiControlToken,
    };
  }

  function sendJsonResponse(response, statusCode, payload) {
    response.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(payload));
  }

  function readJsonRequestBody(request) {
    return new Promise((resolve, reject) => {
      let raw = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 128_000) {
          reject(new Error("Request body too large"));
          request.destroy();
        }
      });
      request.on("end", () => {
        if (!raw.trim()) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error("Request body must be JSON"));
        }
      });
      request.on("error", reject);
    });
  }

  function authorizedUiControlRequest(request) {
    const auth = request.headers.authorization ?? "";
    return auth === `Bearer ${uiControlToken}`;
  }

  function jsonForJavaScript(value) {
    return JSON.stringify(JSON.stringify(value ?? {}));
  }

  async function evaluateOpenworkControl(expression, options = {}) {
    const win = await getWindow();
    if (options.focus === true) {
      win.show();
      if (win.isMinimized()) win.restore();
      win.focus();
    }
    return win.webContents.executeJavaScript(expression, true);
  }

  async function runOpenworkControlCommand(command, args = {}) {
    const argsJsonLiteral = jsonForJavaScript(args);
    if (command === "snapshot") {
      return evaluateOpenworkControl(`(async () => {
        const control = window.__openworkControl;
        if (!control) return { ok: false, error: "OpenWork control surface is not available yet." };
        control.setEnabled?.(true);
        return { ok: true, ...control.snapshot() };
      })()`);
    }
    if (command === "actions") {
      return evaluateOpenworkControl(`(async () => {
        const control = window.__openworkControl;
        if (!control) return { ok: false, error: "OpenWork control surface is not available yet." };
        control.setEnabled?.(true);
        return { ok: true, actions: control.listActions() };
      })()`);
    }
    if (command === "execute") {
      return evaluateOpenworkControl(`(async () => {
        const control = window.__openworkControl;
        const input = JSON.parse(${argsJsonLiteral});
        if (!control) return { ok: false, error: "OpenWork control surface is not available yet." };
        if (!input || typeof input.actionId !== "string" || !input.actionId.trim()) {
          return { ok: false, error: "Missing OpenWork actionId." };
        }
        control.setEnabled?.(true);
        const sessionId = typeof input.sessionId === "string" ? input.sessionId.trim() : "";
        return control.execute(input.actionId, input.args ?? {}, sessionId ? { sessionId } : undefined);
      })()`, { focus: true });
    }
    return { ok: false, error: `Unknown OpenWork control command: ${command}` };
  }

  async function writeDiscovery(port) {
    uiControlDiscoveryPath = discoveryPath();
    const payload = bridgeInfo(port);
    await writeFile(uiControlDiscoveryPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    process.env.OPENWORK_UI_CONTROL_DISCOVERY = uiControlDiscoveryPath;
    return payload;
  }

  async function clearDiscovery() {
    const target = uiControlDiscoveryPath || discoveryPath();
    await rm(target, { force: true }).catch(() => undefined);
    uiControlDiscoveryPath = null;
  }

  async function probeLocalHealth(port) {
    if (!port) return false;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(HEALTH_PROBE_TIMEOUT_MS),
      });
      if (!response.ok) return false;
      const payload = await response.json().catch(() => null);
      return Boolean(payload && payload.ok === true);
    } catch {
      return false;
    }
  }

  function currentBoundPort() {
    if (!uiControlServer) return null;
    const address = uiControlServer.address();
    if (typeof address === "object" && address && typeof address.port === "number") {
      return address.port;
    }
    return uiControlPort;
  }

  async function isListeningHealthy() {
    const port = currentBoundPort();
    if (!port) return false;
    return probeLocalHealth(port);
  }

  async function forceCloseServer() {
    const server = uiControlServer;
    uiControlServer = null;
    uiControlPort = null;
    if (!server) return;
    closingIntentionally = true;
    await new Promise((resolve) => {
      try {
        server.close(() => resolve(undefined));
      } catch {
        resolve(undefined);
      }
      // Avoid hanging forever if the handle is already dead.
      setTimeout(() => resolve(undefined), 500).unref?.();
    });
    closingIntentionally = false;
  }

  function attachServerLifecycle(server) {
    server.on("close", () => {
      if (uiControlServer === server) {
        uiControlServer = null;
        uiControlPort = null;
      }
      if (stopping || closingIntentionally) return;
      warn("[ui-control] listener closed unexpectedly; will self-heal");
      void ensureHealthy().catch((error) => {
        warn("[ui-control] self-heal after close failed", error);
      });
    });
    server.on("error", (error) => {
      warn("[ui-control] listener error", error);
      if (uiControlServer === server) {
        uiControlServer = null;
        uiControlPort = null;
      }
      if (stopping || closingIntentionally) return;
      void ensureHealthy().catch((healError) => {
        warn("[ui-control] self-heal after error failed", healError);
      });
    });
  }

  async function start() {
    if (stopping) return null;
    if (starting) return starting;
    starting = (async () => {
      try {
        if (await isListeningHealthy()) {
          const port = currentBoundPort();
          uiControlPort = port;
          return writeDiscovery(port);
        }
        if (uiControlServer) {
          await forceCloseServer();
        }

        const server = createServer(async (request, response) => {
          try {
            const url = new URL(request.url ?? "/", "http://127.0.0.1");
            if (request.method === "GET" && url.pathname === "/health") {
              sendJsonResponse(response, 200, { ok: true, app: appName, version: 1 });
              return;
            }
            if (!authorizedUiControlRequest(request)) {
              sendJsonResponse(response, 401, { ok: false, error: "Unauthorized" });
              return;
            }
            if (request.method === "GET" && url.pathname === "/snapshot") {
              sendJsonResponse(response, 200, await runOpenworkControlCommand("snapshot"));
              return;
            }
            if (request.method === "GET" && url.pathname === "/actions") {
              sendJsonResponse(response, 200, await runOpenworkControlCommand("actions"));
              return;
            }
            if (request.method === "POST" && url.pathname === "/execute") {
              sendJsonResponse(response, 200, await runOpenworkControlCommand("execute", await readJsonRequestBody(request)));
              return;
            }
            sendJsonResponse(response, 404, { ok: false, error: "Not found" });
          } catch (error) {
            sendJsonResponse(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
          }
        });

        attachServerLifecycle(server);
        uiControlServer = server;

        await new Promise((resolve, reject) => {
          const onError = (error) => {
            server.off("listening", onListening);
            reject(error);
          };
          const onListening = () => {
            server.off("error", onError);
            resolve(undefined);
          };
          server.once("error", onError);
          server.listen(0, "127.0.0.1", onListening);
        });

        const address = server.address();
        const port = typeof address === "object" && address ? address.port : null;
        if (!port) throw new Error("Could not start OpenWork UI control bridge.");
        uiControlPort = port;
        const healthy = await probeLocalHealth(port);
        if (!healthy) throw new Error("OpenWork UI control bridge started but /health is unreachable.");
        return writeDiscovery(port);
      } catch (error) {
        await forceCloseServer();
        await clearDiscovery();
        throw error;
      } finally {
        starting = null;
      }
    })();
    return starting;
  }

  async function ensureHealthy() {
    if (stopping) return null;
    if (await isListeningHealthy()) {
      const port = currentBoundPort();
      uiControlPort = port;
      return writeDiscovery(port);
    }
    return start();
  }

  function startWatchdog() {
    if (watchdogTimer) return;
    watchdogTimer = setInterval(() => {
      if (stopping) return;
      void ensureHealthy().catch((error) => {
        warn("[ui-control] watchdog ensureHealthy failed", error);
      });
    }, WATCHDOG_INTERVAL_MS);
    watchdogTimer.unref?.();
  }

  function stopWatchdog() {
    if (!watchdogTimer) return;
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }

  async function stop() {
    stopping = true;
    stopWatchdog();
    await clearDiscovery();
    await forceCloseServer();
  }

  function getBridgeInfo() {
    return bridgeInfo(currentBoundPort());
  }

  return { start, stop, ensureHealthy, startWatchdog, stopWatchdog, getBridgeInfo };
}
