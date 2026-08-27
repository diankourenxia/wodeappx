/** @jsxImportSource react */
import * as React from "react";

import {
  formatQuotaPercent,
  formatQuotaRemainLine,
  quotaTone,
  type WodeAppKeyQuotaReport,
  type WodeAppKeyQuotaRow,
} from "./wodeapp-key-quota";

type DesktopInvoke = (command: string, ...args: unknown[]) => Promise<unknown>;

function invokeDesktop(): DesktopInvoke | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as {
    __OPENWORK_ELECTRON__?: { invokeDesktop?: DesktopInvoke };
  }).__OPENWORK_ELECTRON__;
  return bridge?.invokeDesktop ?? null;
}

function QuotaCard({ row }: { row: WodeAppKeyQuotaRow }) {
  const tone = quotaTone(row.remainingPercent);
  const percent = formatQuotaPercent(row.remainingPercent);
  const bar = row.remainingPercent == null ? 0 : Math.max(0, Math.min(100, row.remainingPercent));
  return (
    <article className={`wx-key-quota-card is-${tone}`}>
      <header className="wx-key-quota-card-head">
        <h4>{row.label}</h4>
        {row.preview ? <p className="wx-key-quota-card-key">{row.preview}</p> : null}
      </header>
      <p className="wx-key-quota-percent">{percent}</p>
      <div className="wx-key-quota-bar" aria-hidden="true">
        <i style={{ transform: `scaleX(${bar / 100})` }} />
      </div>
      <p className="wx-key-quota-remain">{formatQuotaRemainLine(row)}</p>
      {!row.ok ? (
        <p className="wx-key-quota-note">暂时读不到这个 Key 的额度。</p>
      ) : row.note ? (
        <p className="wx-key-quota-note">{row.note}</p>
      ) : row.remainingPercent == null ? (
        <p className="wx-key-quota-note">这个 Key 没有额度上限，只显示余额。</p>
      ) : null}
    </article>
  );
}

export function WodeAppModelUsagePanel() {
  const [report, setReport] = React.useState<WodeAppKeyQuotaReport | null>(null);
  const [available, setAvailable] = React.useState(true);

  React.useEffect(() => {
    const invoke = invokeDesktop();
    if (!invoke) {
      setAvailable(false);
      return;
    }
    let cancelled = false;
    void invoke("keyQuota")
      .then((value) => {
        if (!cancelled) setReport(value as WodeAppKeyQuotaReport);
      })
      .catch(() => {
        if (!cancelled) setReport({ ok: false, rows: [], error: "read-failed" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!available) return null;

  const rows = report?.rows ?? [];

  return (
    <section className="wx-model-usage" aria-label="Key 额度">
      <div className="wx-model-usage-head">
        <h3>Key 额度</h3>
        <p>本机 Key 的剩余额度。云端 WodeApp 积分在侧栏，这里不展开模型用量。</p>
      </div>
      {!report ? (
        <p className="wx-model-usage-empty">正在读取额度…</p>
      ) : !report.ok ? (
        <p className="wx-model-usage-empty">暂时读不到本机 Key 额度。</p>
      ) : rows.length === 0 ? (
        <p className="wx-model-usage-empty">还没有可查询额度的本机 Key。</p>
      ) : (
        <div className="wx-model-usage-grid">
          {rows.map((row, index) => (
            <QuotaCard key={`${row.vendorId}-${row.preview || index}`} row={row} />
          ))}
        </div>
      )}
    </section>
  );
}
