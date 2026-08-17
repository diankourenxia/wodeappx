import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assertTrustedRendererEvent,
  createTrustedIpcMain,
  readBoundedResponseText,
  validateDesktopFetchUrl,
} from "./ipc-security.mjs";

describe("Electron IPC security", () => {
  it("accepts only the main packaged renderer frame", () => {
    const mainFrame = { url: "file:///Applications/WodeAppX.app/Contents/Resources/app-dist/index.html" };
    const webContents = { mainFrame, getURL: () => mainFrame.url };
    const window = { webContents, isDestroyed: () => false };
    assert.doesNotThrow(() => assertTrustedRendererEvent({ sender: webContents, senderFrame: mainFrame }, () => window));
    assert.throws(
      () => assertTrustedRendererEvent({ sender: webContents, senderFrame: { url: mainFrame.url } }, () => window),
      /subframes/,
    );
    mainFrame.url = "https://attacker.example/index.html";
    assert.throws(() => assertTrustedRendererEvent({ sender: webContents, senderFrame: mainFrame }, () => window), /packaged application/);
  });

  it("guards registered IPC handlers", async () => {
    /** @type {((event: unknown, ...args: any[]) => unknown) | undefined} */
    let wrapped;
    const ipcMain = { handle: (_channel, listener) => { wrapped = listener; }, on() {} };
    const frame = { url: "file:///tmp/app-dist/index.html" };
    const sender = { mainFrame: frame };
    const window = { webContents: sender, isDestroyed: () => false };
    createTrustedIpcMain(ipcMain, () => window).handle("test", (_event, value) => value + 1);
    if (!wrapped) throw new Error("expected guarded IPC handler to be registered");
    assert.equal(await wrapped({ sender, senderFrame: frame }, 2), 3);
    assert.throws(() => wrapped({ sender: {}, senderFrame: frame }, 2), /not the main/);
  });

  it("blocks unsafe desktop fetch targets unless explicitly opted in", () => {
    assert.equal(validateDesktopFetchUrl("https://api.example.com/v1"), "https://api.example.com/v1");
    assert.throws(() => validateDesktopFetchUrl("file:///etc/passwd"), /HTTPS/);
    assert.throws(() => validateDesktopFetchUrl("http://example.com"), /HTTPS/);
    assert.throws(() => validateDesktopFetchUrl("https://127.0.0.1/admin"), /private-network/);
    assert.throws(() => validateDesktopFetchUrl("https://192.168.1.2/admin"), /private-network/);
    assert.equal(
      validateDesktopFetchUrl("http://192.168.1.2/api", {
        OPENWORK_ALLOW_INSECURE_REMOTE_FETCH: "1",
        OPENWORK_ALLOW_PRIVATE_REMOTE_FETCH: "1",
      }),
      "http://192.168.1.2/api",
    );
  });

  it("caps desktop fetch response bodies", async () => {
    const response = new Response("12345");
    assert.equal(await readBoundedResponseText(response, 5), "12345");
    await assert.rejects(() => readBoundedResponseText(new Response("123456"), 5), /exceeds/);
  });
});
