/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import QRCode from "qrcode";

import { pillSecondaryClass, surfaceCardClass } from "./modal-styles";
import { useWodeAppCloudRelayState } from "@/react-app/domains/wodeapp/wodeapp-cloud-relay";
import installQrUrl from "./wodeapp-mobile-install-qr.svg";

export const WODEAPP_MOBILE_APK_URL =
  "https://wodeapp.cn/downloads/wodeapp.apk";

type WodeAppMobileInstallCardProps = {
  connected: boolean;
  copiedKey: string | null;
  onCopy: (value: string, key: string) => void;
};

export function WodeAppMobileInstallCard(
  props: WodeAppMobileInstallCardProps,
) {
  const relay = useWodeAppCloudRelayState();
  const [pairingQrUrl, setPairingQrUrl] = useState("");
  useEffect(() => {
    let cancelled = false;
    if (!relay.pairingLink) {
      setPairingQrUrl("");
      return () => {
        cancelled = true;
      };
    }
    void QRCode.toDataURL(relay.pairingLink, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#111827", light: "#FFFFFF" },
    }).then((url) => {
      if (!cancelled) setPairingQrUrl(url);
    }).catch(() => {
      if (!cancelled) setPairingQrUrl("");
    });
    return () => {
      cancelled = true;
    };
  }, [relay.pairingLink]);
  const connected = relay.paired && relay.online;
  const statusLabel = connected
    ? "已连接"
    : relay.status === "registering"
      ? "正在连接云服务"
      : relay.online
        ? "等待手机配对"
        : "未连接";
  return (
    <section className={surfaceCardClass} aria-label="手机端安装与连接">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[18px] font-semibold tracking-[-0.3px] text-dls-text">
            手机端应用
          </h3>
          <p className="mt-1 text-[13px] leading-relaxed text-dls-secondary">
            安装 Android 应用后，可连接并控制当前工作区。
          </p>
        </div>
        <span
          className={`box-border inline-flex min-h-8 min-w-0 max-w-full shrink-0 items-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap rounded-full px-3 text-[12px] font-medium ${
            connected
              ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
              : "bg-zinc-500/10 text-dls-secondary"
          }`}
        >
          <span
            className={`size-2 shrink-0 rounded-full ${
              connected ? "bg-emerald-500" : relay.online ? "bg-amber-500" : "bg-zinc-400"
            }`}
          />
          {statusLabel}
        </span>
      </div>

      <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-[168px_minmax(0,1fr)] sm:items-center">
        <a
          href={WODEAPP_MOBILE_APK_URL}
          target="_blank"
          rel="noreferrer"
          className="mx-auto box-border flex size-[168px] max-w-full items-center justify-center rounded-2xl border border-dls-border bg-white p-2 sm:mx-0"
          aria-label="扫码下载 Android 安装包"
        >
          <img
            src={installQrUrl}
            alt="WodeApp 手机端安装二维码"
            className="size-full max-w-full"
          />
        </a>

        <div className="min-w-0">
          <p className="text-[14px] font-medium text-dls-text">
            使用 Android 手机扫码安装
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-dls-secondary">
            也可以在手机浏览器打开下方下载地址。
          </p>
          <p className="mt-2 max-w-full break-all rounded-lg bg-dls-surface px-2.5 py-2 font-mono text-[11px] text-dls-secondary">
            {WODEAPP_MOBILE_APK_URL}
          </p>
          <div className="mt-3 flex max-w-full flex-wrap gap-2">
            <a
              href={WODEAPP_MOBILE_APK_URL}
              target="_blank"
              rel="noreferrer"
              className="box-border inline-flex min-h-9 min-w-0 max-w-full items-center justify-center gap-2 overflow-hidden text-ellipsis whitespace-nowrap rounded-full bg-[var(--dls-accent)] px-4 text-[13px] font-medium text-white"
            >
              <Download size={14} className="shrink-0" />
              <span className="min-w-0 truncate">下载 Android 安装包</span>
            </a>
            <button
              type="button"
              className={`${pillSecondaryClass} min-w-0 max-w-full`}
              onClick={() =>
                props.onCopy(WODEAPP_MOBILE_APK_URL, "mobile:download")
              }
            >
              {props.copiedKey === "mobile:download" ? (
                <Check size={14} className="shrink-0" />
              ) : (
                <Copy size={14} className="shrink-0" />
              )}
              <span className="min-w-0 truncate">
                {props.copiedKey === "mobile:download"
                  ? "下载地址已复制"
                  : "复制下载地址"}
              </span>
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-dls-border bg-dls-surface p-4">
        <p className="text-[14px] font-medium text-dls-text">连接当前电脑</p>
        <p className="mt-1 text-[12px] leading-relaxed text-dls-secondary">
          通过 wodeapp.cn 安全中转任务状态和对话，无需手机与电脑处于同一局域网。
        </p>
        {relay.pairingLink ? (
          <>
            <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-[132px_minmax(0,1fr)] sm:items-center">
              <div className="mx-auto box-border flex size-[132px] max-w-full items-center justify-center rounded-2xl border border-dls-border bg-white p-2 sm:mx-0">
                {pairingQrUrl ? (
                  <img
                    src={pairingQrUrl}
                    alt="WodeApp 当前电脑连接二维码"
                    className="size-full max-w-full"
                  />
                ) : (
                  <span className="text-[12px] text-dls-secondary">正在生成连接二维码</span>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-dls-text">扫码连接</p>
                <p className="mt-1 text-[12px] leading-relaxed text-dls-secondary">
                  安装后用手机系统相机扫描，确认后自动打开 WodeApp。
                </p>
                <p className="mt-3 text-[12px] text-dls-secondary">或输入 6 位数字码</p>
                <button
                  type="button"
                  className="mt-1 box-border inline-flex min-h-11 min-w-0 max-w-full items-center gap-2 overflow-hidden rounded-xl bg-dls-elevated px-3 font-mono text-[18px] font-semibold tracking-[0.2em] text-dls-text transition-colors hover:bg-dls-hover"
                  aria-label="复制 6 位配对码"
                  onClick={() => props.onCopy(relay.pairCode, "mobile:relay-code")}
                >
                  <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                    {relay.pairCode.replace(/^(\d{3})(\d{3})$/, "$1 $2")}
                  </span>
                  {props.copiedKey === "mobile:relay-code" ? (
                    <Check size={14} className="shrink-0" />
                  ) : (
                    <Copy size={14} className="shrink-0" />
                  )}
                </button>
              </div>
            </div>
            <button
              type="button"
              className={`${pillSecondaryClass} mt-3 min-w-0 max-w-full`}
              onClick={() => props.onCopy(relay.pairingLink, "mobile:relay")}
            >
              {props.copiedKey === "mobile:relay" ? (
                <Check size={14} className="shrink-0" />
              ) : (
                <Copy size={14} className="shrink-0" />
              )}
              <span className="min-w-0 truncate">
                {props.copiedKey === "mobile:relay" ? "配对链接已复制" : "复制连接链接"}
              </span>
            </button>
          </>
        ) : null}
        {relay.error ? (
          <p className="mt-3 break-words text-[12px] leading-relaxed text-red-600 dark:text-red-400">
            {relay.error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
