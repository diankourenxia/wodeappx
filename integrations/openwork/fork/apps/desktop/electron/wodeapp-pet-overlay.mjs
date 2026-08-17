import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { BrowserWindow, ipcMain, screen } from "electron";

const SET_CHANNEL = "wodeappx:pet-overlay:set";
const MOVE_BY_CHANNEL = "wodeappx:pet-overlay:move-by";
const OPEN_SESSION_CHANNEL = "wodeappx:pet-overlay:open-session";
const STATE_CHANNEL = "wodeappx:pet-overlay:state";
const OPEN_SESSION_EVENT = "wodeappx:pet-overlay:open-session-event";

const OVERLAY_WIDTH = 280;
const OVERLAY_HEIGHT = 420;

function resolveSpritePath(electronDir) {
  const candidates = [
    path.join(electronDir, "../../app/public/skin-pet-sprite-sheet.png"),
    path.join(electronDir, "../../../app/public/skin-pet-sprite-sheet.png"),
    path.join(process.resourcesPath || "", "app-dist", "skin-pet-sprite-sheet.png"),
    path.join(process.resourcesPath || "", "app", "dist", "skin-pet-sprite-sheet.png"),
  ];
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

function defaultOverlayBounds() {
  const display = screen.getPrimaryDisplay();
  const work = display.workArea;
  return {
    x: Math.round(work.x + work.width - OVERLAY_WIDTH - 16),
    y: Math.round(work.y + work.height - OVERLAY_HEIGHT - 24),
    width: OVERLAY_WIDTH,
    height: OVERLAY_HEIGHT,
  };
}

/**
 * Codex-style always-on-top pet overlay (floats above other apps).
 */
export function registerWodeAppPetOverlay({ electronDir, getMainWindow }) {
  let overlayWindow = null;
  let lastState = { visible: false, items: [], selectedSessionId: null };

  const htmlPath = path.join(electronDir, "pet-overlay.html");
  const preloadPath = path.join(electronDir, "pet-overlay-preload.mjs");
  const spritePath = resolveSpritePath(electronDir);

  function isOverlaySender(event) {
    return Boolean(
      overlayWindow
      && !overlayWindow.isDestroyed()
      && event?.sender
      && event.sender === overlayWindow.webContents,
    );
  }

  function isMainSender(event) {
    const main = typeof getMainWindow === "function" ? getMainWindow() : null;
    return Boolean(
      main
      && !main.isDestroyed?.()
      && event?.sender
      && event.sender === main.webContents,
    );
  }

  function destroyOverlay() {
    if (!overlayWindow || overlayWindow.isDestroyed()) {
      overlayWindow = null;
      return;
    }
    overlayWindow.removeAllListeners();
    overlayWindow.destroy();
    overlayWindow = null;
  }

  function ensureOverlay() {
    if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;

    const bounds = defaultOverlayBounds();
    overlayWindow = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      focusable: true,
      acceptFirstMouse: true,
      backgroundColor: "#00000000",
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
      },
    });

    try {
      overlayWindow.setAlwaysOnTop(true, "screen-saver");
    } catch {
      overlayWindow.setAlwaysOnTop(true);
    }
    try {
      overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch {
      // ignore unsupported platforms
    }

    const spriteUrl = pathToFileURL(spritePath).href;
    void overlayWindow.loadFile(htmlPath, {
      query: { sprite: spriteUrl },
    });

    overlayWindow.on("closed", () => {
      overlayWindow = null;
    });

    return overlayWindow;
  }

  function pushState(state) {
    lastState = { ...lastState, ...state };
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.webContents.send(STATE_CHANNEL, lastState);
  }

  function showOverlay() {
    const win = ensureOverlay();
    if (!win.isVisible()) {
      win.showInactive();
    }
    pushState(lastState);
  }

  function hideOverlay() {
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    overlayWindow.hide();
  }

  ipcMain.removeHandler(SET_CHANNEL);
  ipcMain.handle(SET_CHANNEL, async (event, payload = {}) => {
    if (!isMainSender(event)) {
      throw new Error("IPC rejected: pet overlay set requires main renderer");
    }
    const next = payload && typeof payload === "object" ? payload : {};
    lastState = {
      visible: next.visible !== false,
      reacting: Boolean(next.reacting),
      reactionText: typeof next.reactionText === "string" ? next.reactionText : "",
      panelOpen: Boolean(next.panelOpen),
      items: Array.isArray(next.items) ? next.items : lastState.items || [],
      selectedSessionId: next.selectedSessionId ?? lastState.selectedSessionId ?? null,
    };
    if (!lastState.visible) {
      hideOverlay();
      destroyOverlay();
      return { ok: true, mode: "hidden" };
    }
    showOverlay();
    return { ok: true, mode: "os-overlay" };
  });

  ipcMain.removeAllListeners(MOVE_BY_CHANNEL);
  ipcMain.on(MOVE_BY_CHANNEL, (event, dx, dy) => {
    if (!isOverlaySender(event)) return;
    if (!overlayWindow || overlayWindow.isDestroyed()) return;
    const deltaX = Number(dx) || 0;
    const deltaY = Number(dy) || 0;
    if (!deltaX && !deltaY) return;
    const [x, y] = overlayWindow.getPosition();
    const display = screen.getDisplayNearestPoint({ x, y });
    const work = display.workArea;
    const bounds = overlayWindow.getBounds();
    const nextX = Math.min(Math.max(work.x, x + deltaX), work.x + work.width - bounds.width);
    const nextY = Math.min(Math.max(work.y, y + deltaY), work.y + work.height - bounds.height);
    overlayWindow.setPosition(Math.round(nextX), Math.round(nextY));
  });

  ipcMain.removeHandler(OPEN_SESSION_CHANNEL);
  ipcMain.handle(OPEN_SESSION_CHANNEL, async (event, payload = {}) => {
    if (!isOverlaySender(event)) {
      throw new Error("IPC rejected: open-session must come from pet overlay");
    }
    const workspaceId = String(payload.workspaceId || "").trim();
    const sessionId = String(payload.sessionId || "").trim();
    if (!workspaceId || !sessionId) return { ok: false, error: "missing ids" };
    const main = typeof getMainWindow === "function" ? getMainWindow() : null;
    if (main && !main.isDestroyed?.()) {
      main.show();
      main.focus();
      main.webContents.send(OPEN_SESSION_EVENT, { workspaceId, sessionId });
    }
    return { ok: true };
  });

  return {
    destroy: destroyOverlay,
    channels: {
      set: SET_CHANNEL,
      openSessionEvent: OPEN_SESSION_EVENT,
    },
  };
}

export const WODEAPP_PET_OVERLAY_SET_CHANNEL = SET_CHANNEL;
export const WODEAPP_PET_OVERLAY_OPEN_SESSION_EVENT = OPEN_SESSION_EVENT;
