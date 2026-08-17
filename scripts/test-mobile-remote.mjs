#!/usr/bin/env node

/**
 * Mobile remote (云中转「手机端」) is deferred behind WODEAPP_MOBILE_REMOTE_ENABLED.
 * Default: assert the UI is gated off; keep pairing/relay source contracts intact.
 * Pass --live to exercise the CDP button flow (only when the flag is flipped on).
 */

import { readFile } from "node:fs/promises";

const args = process.argv.slice(2);
const portFlag = args.indexOf("--port");
const port = portFlag >= 0 ? Number(args[portFlag + 1]) : 9223;
const shouldReload = args.includes("--reload");
const liveUi = args.includes("--live");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function connectToWodeAppX() {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => {
    if (!response.ok) throw new Error(`CDP target list failed: HTTP ${response.status}`);
    return response.json();
  });
  const page =
    targets.find((target) => target.type === "page" && /WodeAppX|我的AppX|WodeAppX|OpenWork/.test(target.title || "")) ??
    targets.find((target) => target.type === "page");
  if (!page?.webSocketDebuggerUrl) {
    throw new Error(`No debuggable WodeAppX page found on port ${port}`);
  }

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const runtimeErrors = [];
  let nextId = 0;

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.method === "Runtime.exceptionThrown") {
      runtimeErrors.push(payload.params?.exceptionDetails?.exception?.description || payload.params?.exceptionDetails?.text || "Runtime exception");
      return;
    }
    if (!payload.id || !pending.has(payload.id)) return;
    const request = pending.get(payload.id);
    pending.delete(payload.id);
    clearTimeout(request.timer);
    if (payload.error) request.reject(new Error(payload.error.message || JSON.stringify(payload.error)));
    else request.resolve(payload.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  const request = (method, params = {}) => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, 20_000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
  };

  const evaluate = async (expression) => {
    const result = await request("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
    }
    return result.result?.value;
  };

  await request("Runtime.enable");
  await request("Page.enable");
  return { socket, request, evaluate, runtimeErrors, page };
}

async function waitForButton(evaluate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await evaluate('Boolean(document.querySelector(".wapp-mobile-button"))');
    if (found) return true;
    await delay(500);
  }
  return false;
}

async function assertSourceContracts() {
  const featureSource = await readFile(
    new URL("../vendor/openwork/apps/app/src/react-app/domains/wodeapp/wodeapp-mobile-remote-feature.ts", import.meta.url),
    "utf8",
  );
  const featureEnabled = /export const WODEAPP_MOBILE_REMOTE_ENABLED = true\b/.test(featureSource);
  if (!/export const WODEAPP_MOBILE_REMOTE_ENABLED = (true|false)\b/.test(featureSource)) {
    throw new Error("缺少 WODEAPP_MOBILE_REMOTE_ENABLED 开关");
  }

  const chromeSource = await readFile(
    new URL("../vendor/openwork/apps/app/src/react-app/domains/wodeapp/wodeapp-main-chrome.tsx", import.meta.url),
    "utf8",
  );
  if (!chromeSource.includes("WODEAPP_MOBILE_REMOTE_ENABLED")) {
    throw new Error("顶栏「手机端」未按 feature flag 门控");
  }

  const sessionRouteSource = await readFile(
    new URL("../vendor/openwork/apps/app/src/react-app/shell/session-route.tsx", import.meta.url),
    "utf8",
  );
  if (
    !sessionRouteSource.includes("WODEAPP_MOBILE_REMOTE_ENABLED") ||
    !sessionRouteSource.includes("useWodeAppCloudRelayBridge")
  ) {
    throw new Error("云中转 bridge 未按 feature flag 门控");
  }

  const pairingPanelSource = await readFile(
    new URL("../vendor/openwork/apps/app/src/react-app/domains/workspace/share-workspace-access-panel.tsx", import.meta.url),
    "utf8",
  );
  if (
    !pairingPanelSource.includes("buildMobilePairingArtifact") ||
    !pairingPanelSource.includes("buildMobilePairingLink") ||
    !pairingPanelSource.includes("复制手机打开链接") ||
    !pairingPanelSource.includes("WodeAppMobileInstallCard")
  ) {
    throw new Error("手机端弹窗缺少安装卡、配对信息或一键打开链接");
  }
  const installCardSource = await readFile(
    new URL("../vendor/openwork/apps/app/src/react-app/domains/workspace/wodeapp-mobile-install-card.tsx", import.meta.url),
    "utf8",
  );
  if (
    !installCardSource.includes("https://wodeapp.cn/downloads/wodeapp.apk") ||
    !installCardSource.includes("wodeapp-mobile-install-qr.svg") ||
    !installCardSource.includes("QRCode.toDataURL") ||
    !installCardSource.includes("6 位数字码") ||
    !installCardSource.includes("useWodeAppCloudRelayState") ||
    !installCardSource.includes("无需手机与电脑处于同一局域网")
  ) {
    throw new Error("手机端安装卡缺少下载地址、安装二维码或云中转连接状态");
  }
  const shareModalSource = await readFile(
    new URL("../vendor/openwork/apps/app/src/react-app/domains/workspace/share-workspace-modal.tsx", import.meta.url),
    "utf8",
  );
  if (!shareModalSource.includes("max-h-[88dvh]") || !shareModalSource.includes("max-w-5xl")) {
    throw new Error("手机端弹窗未使用扩大后的工作台尺寸");
  }
  const relaySource = await readFile(
    new URL("../vendor/openwork/apps/app/src/react-app/domains/wodeapp/wodeapp-cloud-relay.ts", import.meta.url),
    "utf8",
  );
  if (
    !relaySource.includes("/wodeappx-relay/devices/register") ||
    !relaySource.includes("/requests") ||
    !relaySource.includes("/responses/") ||
    !relaySource.includes("mobile\\/mentions") ||
    !relaySource.includes("mobile\\/snapshot") ||
    !relaySource.includes("prompt_async") ||
    !relaySource.includes("pollFailures")
  ) {
    throw new Error("WodeAppX 桌面端缺少统一会话、@引用、附件或稳定重试桥接");
  }
  const mobileRemoteSource = await readFile(
    new URL("../../runtime-app/src/components/WodeAppXRemote.tsx", import.meta.url),
    "utf8",
  );
  if (
    !mobileRemoteSource.includes("normalizeMentions") ||
    !mobileRemoteSource.includes("uploadWodeAppXAttachment") ||
    !mobileRemoteSource.includes("mobile/sessions/") ||
    !mobileRemoteSource.includes("发消息，输入 @ 关联内容") ||
    !mobileRemoteSource.includes("6 位数字配对码") ||
    !mobileRemoteSource.includes("rows={3}") ||
    !mobileRemoteSource.includes("min-h-20") ||
    !mobileRemoteSource.includes('type="file"')
  ) {
    throw new Error("WodeApp 手机端缺少 OpenCode 同会话、@引用或附件上传能力");
  }

  return featureEnabled;
}

async function runLiveUiFlow() {
  const connection = await connectToWodeAppX();
  try {
    if (shouldReload) {
      await connection.request("Page.reload", { ignoreCache: true });
    }
    const buttonFound = await waitForButton(connection.evaluate);
    if (!buttonFound) {
      const snapshot = await connection.evaluate(`(() => ({
        href: location.href,
        bodyText: document.body?.innerText?.slice(0, 1000) || "",
        bodyHtml: document.body?.innerHTML?.slice(0, 1000) || ""
      }))()`);
      throw new Error(`手机端按钮未出现: ${JSON.stringify({ snapshot, runtimeErrors: connection.runtimeErrors })}`);
    }

    const before = await connection.evaluate(`(() => ({
      href: location.href,
      buttonText: document.querySelector(".wapp-mobile-button")?.textContent?.trim() || ""
    }))()`);
    const closedExistingDialog = await connection.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      if (!dialog) return false;
      const close = [...dialog.querySelectorAll("button")].find((button) => /关闭|Close|取消|Cancel/i.test(button.textContent || ""));
      close?.click();
      return true;
    })()`);
    if (closedExistingDialog) await delay(300);

    await connection.evaluate(`document.querySelector(".wapp-mobile-button")?.click()`);
    await delay(800);

    const mobileDialog = await connection.evaluate(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')].find((node) => /手机端/.test(node.textContent || ""));
      const qr = dialog?.querySelector('img[alt="WodeApp 手机端安装二维码"]');
      const pairingQr = dialog?.querySelector('img[alt="手机打开链接二维码"]');
      const pairingCodeButton = dialog?.querySelector('button[aria-label="复制 6 位配对码"]');
      const download = dialog?.querySelector('a[href*="wodeapp.apk"]');
      const dialogRect = dialog?.getBoundingClientRect();
      const qrRect = qr?.getBoundingClientRect();
      const pairingQrRect = pairingQr?.getBoundingClientRect();
      const downloadRect = download?.getBoundingClientRect();
      return {
        href: location.href,
        dialogText: dialog?.textContent?.replace(/\\s+/g, " ").trim() || "",
        qrAlt: qr?.getAttribute('alt') || "",
        pairingQrAlt: pairingQr?.getAttribute('alt') || "",
        pairingCode: pairingCodeButton?.textContent?.replace(/\\s+/g, "").trim() || "",
        downloadHref: download?.getAttribute('href') || "",
        hasRemoteAccessToggle: Boolean(dialog?.querySelector('input[aria-label="Remote access"]')),
        hasChooser: /Access workspace remotely|远程访问工作区/.test(dialog?.textContent || ""),
        layout: {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          dialogWidth: Math.round(dialogRect?.width || 0),
          dialogHeight: Math.round(dialogRect?.height || 0),
          qrWidth: Math.round(qrRect?.width || 0),
          qrHeight: Math.round(qrRect?.height || 0),
          pairingQrWidth: Math.round(pairingQrRect?.width || 0),
          pairingQrHeight: Math.round(pairingQrRect?.height || 0),
          downloadVisible: Boolean(downloadRect && downloadRect.width > 0 && downloadRect.height > 0),
          horizontalOverflow: Boolean(dialog && dialog.scrollWidth > dialog.clientWidth + 1)
        }
      };
    })()`);
    if (mobileDialog.href !== before.href) {
      throw new Error(`点击手机端后发生了页面跳转: ${before.href} -> ${mobileDialog.href}`);
    }
    if (!/手机端/.test(mobileDialog.dialogText) || !/下载 Android 安装包/.test(mobileDialog.dialogText)) {
      throw new Error(`点击手机端后未直接打开安装面板: ${JSON.stringify(mobileDialog)}`);
    }
    if (
      mobileDialog.qrAlt !== "WodeApp 手机端安装二维码" ||
      !mobileDialog.downloadHref.includes("wodeapp.apk") ||
      !mobileDialog.layout.downloadVisible ||
      !/已连接|未连接|等待手机配对|正在连接云服务/.test(mobileDialog.dialogText) ||
      mobileDialog.layout.horizontalOverflow
    ) {
      throw new Error(`手机端安装或连接控件不完整: ${JSON.stringify(mobileDialog)}`);
    }
    console.log(JSON.stringify({ ok: true, mode: "live", before, mobileDialog }, null, 2));
  } finally {
    connection.socket.close();
  }
}

async function assertHiddenInLiveUi() {
  const connection = await connectToWodeAppX();
  try {
    if (shouldReload) {
      await connection.request("Page.reload", { ignoreCache: true });
    }
    await delay(1500);
    const present = await connection.evaluate('Boolean(document.querySelector(".wapp-mobile-button"))');
    if (present) {
      throw new Error("feature flag 关闭时顶栏仍出现「手机端」按钮");
    }
    console.log(JSON.stringify({ ok: true, mode: "hidden", buttonPresent: false }, null, 2));
  } finally {
    connection.socket.close();
  }
}

async function main() {
  const featureEnabled = await assertSourceContracts();

  if (!featureEnabled) {
    console.log(JSON.stringify({ ok: true, mode: "deferred", featureEnabled: false }, null, 2));
    if (liveUi) {
      await assertHiddenInLiveUi();
    }
    return;
  }

  if (!liveUi) {
    console.log(JSON.stringify({ ok: true, mode: "source-only", featureEnabled: true }, null, 2));
    return;
  }

  await runLiveUiFlow();
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exit(1);
});
