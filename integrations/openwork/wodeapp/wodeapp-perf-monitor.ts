/**
 * Renderer-side PERF-09 helpers: Long Task observer + IPC glue.
 * Main process owns CPU/RSS/DB sampling; this only reports UI jank hints.
 */

export type PerfMonitorStatus = {
  enabled: boolean;
  autoDefault: boolean;
  sampleIntervalMs: number;
  ringCount: number;
  ringMax: number;
  lastSample: {
    at: number;
    electron: {
      rendererCpu: number | null;
      rendererRssMiB: number | null;
    };
    engine: { cpu: number | null; rssMiB: number | null; count: number };
    mcp: { count: number };
    sqlite: { sizeMiB: number | null };
    rendererHints: { longTasks: number; longTaskMaxMs: number };
  } | null;
  hud: string;
};

export type PerfMonitorSnapshot = PerfMonitorStatus & {
  samples: NonNullable<PerfMonitorStatus["lastSample"]>[];
};

export type PerfMonitorExportResult = {
  ok: boolean;
  canceled: boolean;
  path: string | null;
};

type DesktopInvoke = (command: string, ...args: unknown[]) => Promise<unknown>;

function invokeDesktop(): DesktopInvoke | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as {
    __OPENWORK_ELECTRON__?: { invokeDesktop?: DesktopInvoke };
  }).__OPENWORK_ELECTRON__;
  return bridge?.invokeDesktop ?? null;
}

export function isPerfHudAllowedByEnv(): boolean {
  try {
    if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) return true;
  } catch {
    // ignore
  }
  return false;
}

export async function fetchPerfMonitorStatus(): Promise<PerfMonitorStatus | null> {
  const invoke = invokeDesktop();
  if (!invoke) return null;
  try {
    return (await invoke("perfMonitorStatus")) as PerfMonitorStatus;
  } catch {
    return null;
  }
}

export async function fetchPerfMonitorSnapshot(): Promise<PerfMonitorSnapshot | null> {
  const invoke = invokeDesktop();
  if (!invoke) return null;
  try {
    return (await invoke("perfMonitorSnapshot")) as PerfMonitorSnapshot;
  } catch {
    return null;
  }
}

export async function setPerfMonitorEnabled(enabled: boolean): Promise<PerfMonitorStatus | null> {
  const invoke = invokeDesktop();
  if (!invoke) return null;
  try {
    try {
      window.localStorage.setItem("wodeappx.perf-monitor.ui", enabled ? "1" : "0");
    } catch {
      // ignore
    }
    return (await invoke("perfMonitorSetEnabled", { enabled })) as PerfMonitorStatus;
  } catch {
    return null;
  }
}

export async function exportPerfMonitorPack(): Promise<PerfMonitorExportResult | null> {
  const invoke = invokeDesktop();
  if (!invoke) return null;
  try {
    return (await invoke("perfMonitorExport")) as PerfMonitorExportResult;
  } catch {
    return null;
  }
}

export async function reportPerfRendererHints(input: {
  longTasks?: number;
  longTaskMaxMs?: number;
  sseEvents?: number;
}): Promise<void> {
  const invoke = invokeDesktop();
  if (!invoke) return;
  try {
    await invoke("perfMonitorReportRenderer", input);
  } catch {
    // ignore — observability only
  }
}

let longTaskObserver: PerformanceObserver | null = null;
let pendingLongTasks = 0;
let pendingLongTaskMaxMs = 0;
let flushTimer: ReturnType<typeof setInterval> | null = null;

export function startPerfLongTaskObserver(): void {
  if (typeof PerformanceObserver === "undefined" || longTaskObserver) return;
  try {
    longTaskObserver = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const duration = Number(entry.duration) || 0;
        if (duration < 50) continue;
        pendingLongTasks += 1;
        pendingLongTaskMaxMs = Math.max(pendingLongTaskMaxMs, duration);
      }
    });
    // buffered:false — avoid mixing page-lifetime history (MEMORY lesson).
    longTaskObserver.observe({ type: "longtask", buffered: false } as PerformanceObserverInit);
  } catch {
    longTaskObserver = null;
    return;
  }
  if (!flushTimer) {
    flushTimer = setInterval(() => {
      if (!pendingLongTasks && !pendingLongTaskMaxMs) return;
      const payload = {
        longTasks: pendingLongTasks,
        longTaskMaxMs: pendingLongTaskMaxMs,
      };
      pendingLongTasks = 0;
      pendingLongTaskMaxMs = 0;
      void reportPerfRendererHints(payload);
    }, 10_000);
  }
}

export function stopPerfLongTaskObserver(): void {
  try {
    longTaskObserver?.disconnect();
  } catch {
    // ignore
  }
  longTaskObserver = null;
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}
