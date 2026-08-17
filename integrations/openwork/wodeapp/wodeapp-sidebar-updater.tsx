/** @jsxImportSource react */
import * as React from "react";
import { Download, RefreshCw } from "lucide-react";

import { isElectronRuntime } from "@/app/utils";

type UpdaterBridge = NonNullable<Window["__OPENWORK_ELECTRON__"]>["updater"] & {
  onDownloadProgress?: (
    callback: (data: {
      transferred: number;
      total: number;
      percent: number;
      bytesPerSecond: number;
    }) => void,
  ) => () => void;
};

type SidebarUpdateState =
  | { kind: "hidden" }
  | { kind: "checking" }
  | { kind: "available"; version?: string }
  | { kind: "downloading"; version?: string; percent: number | null }
  | { kind: "ready"; version?: string }
  | { kind: "error"; message: string };

function updaterBridge(): UpdaterBridge | null {
  if (typeof window === "undefined") return null;
  return window.__OPENWORK_ELECTRON__?.updater ?? null;
}

function formatPercent(percent: number | null): string {
  if (percent == null || !Number.isFinite(percent)) return "";
  return `${Math.max(0, Math.min(100, Math.round(percent)))}%`;
}

/**
 * Compact dock control: auto-check + auto-download, user clicks to install & restart.
 * True in-place hot reload of the Electron binary is not supported; this is the
 * standard "silent download, restart to apply" path.
 */
export function WodeAppSidebarUpdater() {
  const [state, setState] = React.useState<SidebarUpdateState>({ kind: "hidden" });
  const startedRef = React.useRef(false);
  const busyRef = React.useRef(false);

  const downloadUpdate = React.useCallback(async (version?: string) => {
    const bridge = updaterBridge();
    if (!bridge?.download || busyRef.current) return;
    busyRef.current = true;
    let unsub: (() => void) | null = null;
    setState({ kind: "downloading", version, percent: null });
    try {
      if (bridge.onDownloadProgress) {
        unsub = bridge.onDownloadProgress((data) => {
          setState({
            kind: "downloading",
            version,
            percent: typeof data.percent === "number" ? data.percent : null,
          });
        });
      }
      const result = await bridge.download();
      if (!result?.ok) {
        setState({ kind: "error", message: result?.reason || "下载失败" });
        return;
      }
      setState({ kind: "ready", version });
    } catch (error) {
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "下载失败",
      });
    } finally {
      unsub?.();
      busyRef.current = false;
    }
  }, []);

  const checkForUpdates = React.useCallback(async () => {
    const bridge = updaterBridge();
    if (!bridge?.check || busyRef.current) return;
    busyRef.current = true;
    setState({ kind: "checking" });
    try {
      const result = await bridge.check();
      if (result.reason === "unavailable") {
        setState({ kind: "hidden" });
        busyRef.current = false;
        return;
      }
      if (result.reason) {
        setState({ kind: "error", message: result.reason });
        busyRef.current = false;
        return;
      }
      if (!result.available) {
        setState({ kind: "hidden" });
        busyRef.current = false;
        return;
      }
      const version = result.latestVersion ?? undefined;
      setState({ kind: "available", version });
      // downloadUpdate owns busyRef for the rest of the flow
      busyRef.current = false;
      await downloadUpdate(version);
    } catch (error) {
      busyRef.current = false;
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "检查更新失败",
      });
    }
  }, [downloadUpdate]);

  React.useEffect(() => {
    if (!isElectronRuntime()) return;
    if (!updaterBridge()?.check) return;
    if (startedRef.current) return;
    startedRef.current = true;
    const timer = window.setTimeout(() => {
      void checkForUpdates();
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [checkForUpdates]);

  const onClick = () => {
    if (state.kind === "ready") {
      const bridge = updaterBridge();
      if (!bridge?.installAndRestart) return;
      void bridge.installAndRestart().then((result) => {
        if (result && !result.ok) {
          setState({ kind: "error", message: result.reason || "安装失败" });
        }
      });
      return;
    }
    if (state.kind === "available" || state.kind === "error") {
      void (state.kind === "available" ? downloadUpdate(state.version) : checkForUpdates());
    }
  };

  if (state.kind === "hidden" || state.kind === "checking") {
    return null;
  }

  const disabled = state.kind === "downloading";
  const label =
    state.kind === "ready"
      ? "安装更新"
      : state.kind === "downloading"
        ? formatPercent(state.percent)
          ? `下载 ${formatPercent(state.percent)}`
          : "下载中"
        : state.kind === "error"
          ? "重试更新"
          : "下载更新";

  const title =
    state.kind === "ready"
      ? state.version
        ? `已下载 v${state.version}，点击安装并重启`
        : "已下载更新，点击安装并重启"
      : state.kind === "downloading"
        ? state.version
          ? `正在下载 v${state.version}`
          : "正在下载更新"
        : state.kind === "error"
          ? state.message
          : state.version
            ? `发现 v${state.version}`
            : "发现新版本";

  const Icon = state.kind === "ready" ? RefreshCw : Download;

  return (
    <button
      type="button"
      className={`wx-sidebar-update-btn${state.kind === "ready" ? " is-ready" : ""}${state.kind === "error" ? " is-error" : ""}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
    >
      <Icon aria-hidden className={state.kind === "downloading" ? "wx-button-spinner" : undefined} />
      <span>{label}</span>
    </button>
  );
}
