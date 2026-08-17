import { contextBridge, ipcRenderer } from "electron";

const SET_CHANNEL = "wodeappx:pet-overlay:set";
const MOVE_BY_CHANNEL = "wodeappx:pet-overlay:move-by";
const OPEN_SESSION_CHANNEL = "wodeappx:pet-overlay:open-session";
const STATE_CHANNEL = "wodeappx:pet-overlay:state";

contextBridge.exposeInMainWorld("__wodeappxPetOverlayBridge", {
  moveBy(dx, dy) {
    ipcRenderer.send(MOVE_BY_CHANNEL, dx, dy);
  },
  openSession(workspaceId, sessionId) {
    return ipcRenderer.invoke(OPEN_SESSION_CHANNEL, { workspaceId, sessionId });
  },
  onState(callback) {
    const handler = (_event, state) => {
      try {
        callback(state);
      } catch {
        // ignore
      }
    };
    ipcRenderer.on(STATE_CHANNEL, handler);
    return () => ipcRenderer.removeListener(STATE_CHANNEL, handler);
  },
});
