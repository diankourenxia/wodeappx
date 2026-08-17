/** @jsxImportSource react */
import { useCallback, useEffect, useState } from "react";

import {
  exportPerfMonitorPack,
  fetchPerfMonitorStatus,
  setPerfMonitorEnabled,
  startPerfLongTaskObserver,
  stopPerfLongTaskObserver,
  type PerfMonitorStatus,
} from "./wodeapp-perf-monitor";

/**
 * Dev-only corner chip for PERF-09 local sampler.
 * Visible when main process reports enabled (auto-on in OPENWORK_DEV_MODE).
 */
export function WodeAppPerfHud() {
  const [status, setStatus] = useState<PerfMonitorStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await fetchPerfMonitorStatus();
    setStatus(next);
    if (next?.enabled) startPerfLongTaskObserver();
    else stopPerfLongTaskObserver();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await fetchPerfMonitorStatus();
      if (cancelled) return;
      setStatus(next);
      if (next?.enabled) startPerfLongTaskObserver();
    })();
    const timer = setInterval(() => {
      void refresh();
    }, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      stopPerfLongTaskObserver();
    };
  }, [refresh]);

  if (!status?.enabled) return null;

  const onExport = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await exportPerfMonitorPack();
      if (result?.ok && result.path) setMessage("已导出");
      else if (result?.canceled) setMessage(null);
      else setMessage("导出失败");
    } finally {
      setBusy(false);
      window.setTimeout(() => setMessage(null), 2500);
    }
  };

  const onDisable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await setPerfMonitorEnabled(false);
      setStatus(next);
      stopPerfLongTaskObserver();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="wapp-perf-hud" role="status" aria-live="polite">
      <button
        type="button"
        className="wapp-perf-hud-chip"
        title="本地性能采样（开发态）。点击导出诊断包。"
        onClick={() => void onExport()}
        disabled={busy}
      >
        <span className="wapp-perf-hud-label">PERF</span>
        <span className="wapp-perf-hud-value">{status.hud || "采样中"}</span>
        {message ? <span className="wapp-perf-hud-msg">{message}</span> : null}
      </button>
      <button
        type="button"
        className="wapp-perf-hud-close"
        title="关闭本地性能采样（本次会话；重启开发版仍会自动开）"
        aria-label="关闭本地性能采样"
        onClick={() => void onDisable()}
        disabled={busy}
      >
        关
      </button>
    </div>
  );
}
