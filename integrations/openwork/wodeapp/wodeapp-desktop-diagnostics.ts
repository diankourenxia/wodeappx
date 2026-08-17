/**
 * Auto-report product failures and scrubbed agent tool failures from WodeAppX
 * desktop. Tool failures are batched and flushed every few minutes so we can
 * optimize hot failure modes without spamming the ingest API.
 *
 * Cancel / MessageAbortedError / "Tool execution aborted" are OpenCode run
 * cancels — not tool defects. Do not put them in tool_execution_failed.
 * They still use the desktop diagnostics ingest as kind=turn_aborted so ops
 * can see session/model/tool context for wasted in-flight turns.
 */
import { requestWodeAppMainJson, getWodeAppApiCredentials } from "@/app/lib/wodeapp-auth";

export type DesktopDiagnosticKind =
  | "ui_blank_timeout"
  | "session_not_found"
  | "session_create_failed"
  | "engine_bootstrap_failed"
  | "opencode_unavailable"
  | "runtime_stuck"
  | "tool_execution_failed"
  | "turn_aborted"
  | "user_session_bug"
  | "hang_trace";

export type DesktopDiagnosticInput = {
  kind: DesktopDiagnosticKind;
  message: string;
  sessionId?: string | null;
  workspaceId?: string | null;
  route?: string | null;
  context?: Record<string, string | number | boolean | null>;
};

export type ToolExecutionFailureInput = {
  toolName: string;
  message: string;
  partId?: string | null;
  sessionId?: string | null;
  workspaceId?: string | null;
  errorKind?: string | null;
  recoverable?: boolean | null;
  actionId?: string | null;
};

export type TurnAbortedInput = {
  reason: "stuck_empty_args_recovery" | "message_aborted" | "tool_aborted" | "user_or_system_cancel";
  message?: string | null;
  sessionId?: string | null;
  workspaceId?: string | null;
  messageId?: string | null;
  partId?: string | null;
  toolName?: string | null;
  modelId?: string | null;
  providerId?: string | null;
  ageMs?: number | null;
  requestId?: string | null;
};

type QueuedToolFailure = {
  toolName: string;
  message: string;
  sessionId: string;
  workspaceId: string;
  errorKind: string;
  recoverable: boolean | null;
  actionId: string;
  count: number;
  firstAt: number;
  lastAt: number;
};

const DEDUPE_MS = 15 * 60 * 1000;
const TOOL_FLUSH_MS = 5 * 60 * 1000;
const TOOL_FLUSH_MAX = 12;
const recent = new Map<string, number>();
const reportedToolParts = new Set<string>();
const toolQueue = new Map<string, QueuedToolFailure>();
let toolFlushTimer: ReturnType<typeof setTimeout> | null = null;
let toolLifecycleBound = false;

function appVersion(): string {
  try {
    return String((import.meta as { env?: Record<string, string> }).env?.VITE_OPENWORK_APP_VERSION ?? "").trim();
  } catch {
    return "";
  }
}

function fingerprintOf(input: DesktopDiagnosticInput): string {
  return [
    input.kind,
    (input.sessionId || "").trim(),
    (input.workspaceId || "").trim(),
    (input.message || "").trim().slice(0, 120),
  ].join("|");
}

function shouldSend(fingerprint: string): boolean {
  const now = Date.now();
  const last = recent.get(fingerprint) ?? 0;
  if (now - last < DEDUPE_MS) return false;
  recent.set(fingerprint, now);
  if (recent.size > 200) {
    const cutoff = now - DEDUPE_MS;
    for (const [key, ts] of recent) {
      if (ts < cutoff) recent.delete(key);
    }
  }
  return true;
}

function scrubToolMessage(message: string): string {
  return String(message || "")
    .replace(/sk_(?:live|test)_[A-Za-z0-9_-]+/g, "sk_***")
    .replace(/owt_[A-Za-z0-9_-]+/g, "owt_***")
    .replace(/\/Users\/[^/"'\s]+/g, "/Users/***")
    .replace(/\/home\/[^/"'\s]+/g, "/home/***")
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .trim()
    .slice(0, 240);
}

function inferErrorKind(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("unknown ") || text.includes("required") || text.includes("must be")) return "validation";
  if (text.includes("abort")) return "aborted";
  if (text.includes("timeout") || text.includes("timed out")) return "timeout";
  if (text.includes("unavailable tool")) return "unavailable_tool";
  if (text.includes("body too large") || text.includes("request body")) return "payload";
  return "execution";
}

/** Pure cancel/abort noise — local OpenCode cancel, not a platform tool defect. */
export function isAbortNoiseMessage(message: string): boolean {
  const text = String(message || "").trim();
  if (!text) return false;
  if (/^Tool execution aborted$/i.test(text)) return true;
  if (/^Aborted$/i.test(text)) return true;
  if (/^MessageAbortedError$/i.test(text)) return true;
  if (/MessageAbortedError/i.test(text) && /aborted/i.test(text)) return true;
  return false;
}

function ensureToolLifecycleHooks(): void {
  if (toolLifecycleBound || typeof window === "undefined") return;
  toolLifecycleBound = true;
  const flush = () => {
    void flushToolExecutionFailures();
  };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

function scheduleToolFlush(immediate = false): void {
  ensureToolLifecycleHooks();
  if (immediate || toolQueue.size >= TOOL_FLUSH_MAX) {
    void flushToolExecutionFailures();
    return;
  }
  if (toolFlushTimer) return;
  toolFlushTimer = setTimeout(() => {
    toolFlushTimer = null;
    void flushToolExecutionFailures();
  }, TOOL_FLUSH_MS);
}

export type ReportDesktopDiagnosticResult = {
  ok: boolean;
  skipped?: boolean;
  deduped?: boolean;
};

/**
 * Awaitable product / tool failure report. No-ops when signed out or deduped
 * unless `force` is set (user-triggered reports).
 */
export async function reportDesktopDiagnosticAsync(
  input: DesktopDiagnosticInput,
  options?: { force?: boolean },
): Promise<ReportDesktopDiagnosticResult> {
  try {
    const message = String(input.message || "").trim();
    if (!message) return { ok: false, skipped: true };
    const fingerprint = fingerprintOf(input);
    if (!options?.force && !shouldSend(fingerprint)) {
      return { ok: false, skipped: true, deduped: true };
    }
    if (options?.force) {
      recent.set(fingerprint, Date.now());
    }

    const credentials = await getWodeAppApiCredentials();
    if (!credentials?.apiKey) return { ok: false, skipped: true };

    const response = await requestWodeAppMainJson(
      "/desktop/diagnostics",
      {
        method: "POST",
        body: JSON.stringify({
          kind: input.kind,
          message: message.slice(0, 500),
          sessionId: input.sessionId || null,
          workspaceId: input.workspaceId || null,
          route:
            input.route
            || (typeof window !== "undefined" ? window.location.hash || window.location.pathname : null),
          appVersion: appVersion() || null,
          platform: typeof navigator !== "undefined" ? navigator.platform || null : null,
          arch: typeof navigator !== "undefined" ? (navigator as Navigator & { userAgentData?: { architecture?: string } }).userAgentData?.architecture || null : null,
          fingerprint,
          context: input.context || null,
        }),
        wodeAppCredentials: credentials,
      },
      8000,
    );
    const deduped = Boolean(
      response && typeof response === "object" && (response as { deduped?: unknown }).deduped === true,
    );
    return { ok: true, deduped };
  } catch {
    // Diagnostics must never break the app.
    return { ok: false };
  }
}

/**
 * Fire-and-forget product / tool failure report. No-ops when signed out or deduped.
 */
export function reportDesktopDiagnostic(input: DesktopDiagnosticInput): void {
  void reportDesktopDiagnosticAsync(input);
}

/**
 * Report a cancelled / aborted turn via desktop diagnostics (kind=turn_aborted).
 * Separate from tool_execution_failed — abort is cancel telemetry, not a tool bug.
 */
export function reportTurnAborted(input: TurnAbortedInput): void {
  const reason = input.reason || "user_or_system_cancel";
  const toolName = String(input.toolName || "").trim();
  const modelId = String(input.modelId || "").trim();
  const message = scrubToolMessage(
    input.message
    || (toolName ? `turn aborted (${reason}) tool=${toolName}` : `turn aborted (${reason})`),
  );
  reportDesktopDiagnostic({
    kind: "turn_aborted",
    message: message || `turn aborted (${reason})`,
    sessionId: input.sessionId || null,
    workspaceId: input.workspaceId || null,
    context: {
      reason,
      messageId: input.messageId || null,
      partId: input.partId || null,
      toolName: toolName || null,
      modelId: modelId || null,
      providerId: String(input.providerId || "").trim() || null,
      ageMs: typeof input.ageMs === "number" && Number.isFinite(input.ageMs) ? Math.round(input.ageMs) : null,
      requestId: String(input.requestId || "").trim() || null,
    },
  });
}

/**
 * Queue a scrubbed tool failure and flush on a short interval (or when the
 * queue is full / the window hides). Same tool+message fingerprint is counted
 * together so admin can see hot spots without per-call spam.
 *
 * Abort/cancel is not queued here — call reportTurnAborted for that telemetry.
 */
export function reportToolExecutionFailure(input: ToolExecutionFailureInput): void {
  try {
    const toolName = String(input.toolName || "").trim() || "unknown_tool";
    const message = scrubToolMessage(input.message);
    if (!message) return;
    if (isAbortNoiseMessage(message) || input.errorKind === "aborted") return;

    const partKey = `${input.sessionId || ""}:${input.partId || ""}:${toolName}:${message.slice(0, 80)}`;
    if (input.partId && reportedToolParts.has(partKey)) return;
    if (input.partId) {
      reportedToolParts.add(partKey);
      if (reportedToolParts.size > 500) {
        const first = reportedToolParts.values().next().value;
        if (first) reportedToolParts.delete(first);
      }
    }

    const errorKind = String(input.errorKind || inferErrorKind(message)).slice(0, 64);
    const actionId = String(input.actionId || "").trim().slice(0, 120);
    const sessionId = String(input.sessionId || "").trim();
    const workspaceId = String(input.workspaceId || "").trim();
    const queueKey = [toolName, actionId, errorKind, message.slice(0, 120)].join("|");
    const now = Date.now();
    const existing = toolQueue.get(queueKey);
    if (existing) {
      existing.count += 1;
      existing.lastAt = now;
      if (sessionId) existing.sessionId = sessionId;
      if (workspaceId) existing.workspaceId = workspaceId;
    } else {
      toolQueue.set(queueKey, {
        toolName,
        message,
        sessionId,
        workspaceId,
        errorKind,
        recoverable: typeof input.recoverable === "boolean" ? input.recoverable : null,
        actionId,
        count: 1,
        firstAt: now,
        lastAt: now,
      });
    }
    scheduleToolFlush(toolQueue.size >= TOOL_FLUSH_MAX);
  } catch {
    // never throw
  }
}

/** Flush queued tool failures now (also used by lifecycle hooks / tests). */
export async function flushToolExecutionFailures(): Promise<void> {
  if (toolFlushTimer) {
    clearTimeout(toolFlushTimer);
    toolFlushTimer = null;
  }
  if (toolQueue.size === 0) return;
  const batch = [...toolQueue.values()];
  toolQueue.clear();
  for (const item of batch) {
    reportDesktopDiagnostic({
      kind: "tool_execution_failed",
      message: item.count > 1
        ? `${item.toolName}: ${item.message} (×${item.count})`
        : `${item.toolName}: ${item.message}`,
      sessionId: item.sessionId || null,
      workspaceId: item.workspaceId || null,
      context: {
        toolName: item.toolName,
        actionId: item.actionId || null,
        errorKind: item.errorKind,
        recoverable: item.recoverable,
        count: item.count,
        firstAt: item.firstAt,
        lastAt: item.lastAt,
        batched: true,
      },
    });
  }
}
