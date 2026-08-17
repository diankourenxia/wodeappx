/**
 * Cross-layer hang / empty-shell tracing for WodeAppX desktop.
 *
 * Goal: after a few real stuck chats, align UI ↔ OpenCode SSE ↔ (proxy) with
 * one turnTraceId / sessionId / messageId timeline. Logs go to:
 * - console `[hang-trace]`
 * - in-memory ring (exportable)
 * - localStorage ring (survives soft reload)
 * - optional desktop diagnostics ingest (kind=hang_trace) for milestones
 *
 * Does not change run control (no auto-abort). Observability only.
 */
import { reportDesktopDiagnostic } from "./wodeapp-desktop-diagnostics";

export type HangTraceLayer =
  | "ui"
  | "sync"
  | "recovery"
  | "opencode_obs"
  | "proxy_client"
  | "system";

export type HangTraceEventName =
  | "turn.start"
  | "prompt.sent"
  | "status.busy"
  | "status.idle"
  | "status.retry"
  | "assistant.shell_created"
  | "assistant.first_part"
  | "assistant.completed"
  | "assistant.error"
  | "empty_shell.tick"
  | "empty_shell.long"
  | "auto_continue.attempt"
  | "auto_continue.skip"
  | "auto_continue.sent"
  | "abort.user"
  | "abort.system"
  | "abort.api"
  | "busy_fanout.sample"
  | "dump.export"
  | string;

export type HangTraceFields = Record<string, string | number | boolean | null | undefined>;

export type HangTraceEvent = {
  ts: number;
  iso: string;
  layer: HangTraceLayer;
  event: HangTraceEventName;
  turnTraceId: string | null;
  sessionId: string | null;
  workspaceId: string | null;
  messageId: string | null;
  fields: HangTraceFields;
};

/** In-memory ring: enough for multi-session busy ticks over a long hang day. */
const RING_MAX = 4000;
const LS_KEY = "wodeappx.hang-trace.v1";
const LS_PRUNE_AT_KEY = "wodeappx.hang-trace.pruned-at.v1";
/** Persist slightly less than ring (localStorage quota); still covers multi-hour hangs. */
const LS_MAX = 2000;
/** Keep hang-trace events for half a month (14d). Older rows are dropped. */
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;
/** Do not run age prune more often than once per day. */
const PRUNE_EVERY_MS = 24 * 60 * 60 * 1000;
const LONG_EMPTY_MS = 12_000;
const TICK_LOG_EVERY_MS = 5_000;
const INGEST_EVENTS = new Set([
  "turn.start",
  "prompt.sent",
  "assistant.shell_created",
  "assistant.first_part",
  "empty_shell.long",
  "auto_continue.sent",
  "auto_continue.skip",
  "abort.user",
  "abort.system",
  "abort.api",
  "assistant.error",
]);

const ring: HangTraceEvent[] = [];
const turnBySession = new Map<string, string>();
const emptyArm = new Map<string, { messageId: string; since: number; lastTickLog: number; longLogged: boolean }>();
let lastPruneAt = 0;

function nowIso(ts = Date.now()): string {
  return new Date(ts).toISOString();
}

function newId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

function readLastPruneAt(): number {
  if (lastPruneAt > 0) return lastPruneAt;
  if (typeof localStorage === "undefined") return 0;
  try {
    const raw = localStorage.getItem(LS_PRUNE_AT_KEY);
    const n = raw ? Number(raw) : 0;
    lastPruneAt = Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    lastPruneAt = 0;
  }
  return lastPruneAt;
}

function writeLastPruneAt(ts: number): void {
  lastPruneAt = ts;
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LS_PRUNE_AT_KEY, String(ts));
  } catch {
    /* ignore */
  }
}

/**
 * Drop events older than retention. Returns removed count.
 * Force=true ignores the daily throttle (tests / explicit cleanup).
 */
export function pruneHangTraceRetention(options?: {
  now?: number;
  retentionMs?: number;
  force?: boolean;
}): number {
  const now = typeof options?.now === "number" ? options.now : Date.now();
  const retentionMs =
    typeof options?.retentionMs === "number" && options.retentionMs > 0
      ? options.retentionMs
      : RETENTION_MS;
  if (!options?.force) {
    const previous = readLastPruneAt();
    if (previous > 0 && now - previous < PRUNE_EVERY_MS) return 0;
  }
  const cutoff = now - retentionMs;
  const before = ring.length;
  if (before === 0) {
    writeLastPruneAt(now);
    return 0;
  }
  let keepFrom = 0;
  while (keepFrom < ring.length && ring[keepFrom]!.ts < cutoff) keepFrom += 1;
  if (keepFrom > 0) ring.splice(0, keepFrom);
  const removed = before - ring.length;
  writeLastPruneAt(now);
  if (removed > 0) persistLocalStorage();
  return removed;
}

function persistLocalStorage(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ring.slice(-LS_MAX)));
  } catch {
    /* quota / private mode */
  }
}

function loadLocalStorageOnce(): void {
  if (typeof localStorage === "undefined") return;
  if (ring.length > 0) return;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const row of parsed.slice(-LS_MAX)) {
      if (row && typeof row === "object" && typeof row.ts === "number") {
        ring.push(row as HangTraceEvent);
      }
    }
  } catch {
    /* ignore */
  }
}

let hydrated = false;
function ensureHydrated(): void {
  if (hydrated) return;
  hydrated = true;
  loadLocalStorageOnce();
  pruneHangTraceRetention({ force: true });
}

/** Start or reuse a turn trace id for a session (call on user send / auto-continue). */
export function beginHangTurnTrace(sessionId: string, fields?: HangTraceFields): string {
  const sid = String(sessionId || "").trim();
  const id = newId("ht");
  if (sid) turnBySession.set(sid, id);
  hangTraceLog({
    layer: "ui",
    event: "turn.start",
    sessionId: sid || null,
    turnTraceId: id,
    fields: fields || {},
  });
  return id;
}

export function currentHangTurnTraceId(sessionId: string | null | undefined): string | null {
  const sid = String(sessionId || "").trim();
  if (!sid) return null;
  return turnBySession.get(sid) || null;
}

export function clearHangTurnTrace(sessionId: string | null | undefined): void {
  const sid = String(sessionId || "").trim();
  if (sid) turnBySession.delete(sid);
}

export function hangTraceLog(input: {
  layer: HangTraceLayer;
  event: HangTraceEventName;
  sessionId?: string | null;
  workspaceId?: string | null;
  messageId?: string | null;
  turnTraceId?: string | null;
  fields?: HangTraceFields;
}): HangTraceEvent {
  ensureHydrated();
  pruneHangTraceRetention();
  const ts = Date.now();
  const sessionId = input.sessionId ? String(input.sessionId).trim() : null;
  const turnTraceId =
    input.turnTraceId
    || (sessionId ? turnBySession.get(sessionId) || null : null);
  const row: HangTraceEvent = {
    ts,
    iso: nowIso(ts),
    layer: input.layer,
    event: input.event,
    turnTraceId,
    sessionId,
    workspaceId: input.workspaceId ? String(input.workspaceId).trim() : null,
    messageId: input.messageId ? String(input.messageId).trim() : null,
    fields: input.fields || {},
  };
  ring.push(row);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  persistLocalStorage();

  // eslint-disable-next-line no-console
  console.info(
    `[hang-trace] ${JSON.stringify({
      layer: row.layer,
      event: row.event,
      turnTraceId: row.turnTraceId,
      sessionId: row.sessionId,
      messageId: row.messageId,
      ...row.fields,
    })}`,
  );

  if (INGEST_EVENTS.has(String(row.event))) {
    reportDesktopDiagnostic({
      kind: "hang_trace",
      message: `${row.layer}:${row.event}`.slice(0, 500),
      sessionId: row.sessionId,
      workspaceId: row.workspaceId,
      context: {
        turnTraceId: row.turnTraceId,
        messageId: row.messageId,
        layer: row.layer,
        event: row.event,
        ...Object.fromEntries(
          Object.entries(row.fields).map(([k, v]) => [k, v === undefined ? null : v]),
        ),
      },
    });
  }
  return row;
}

/**
 * Observe live transcript shape for empty-shell age. Call from a busy poll
 * or after sync updates. Emits tick / long events without aborting.
 */
export function observeHangEmptyShell(input: {
  sessionId: string;
  workspaceId?: string | null;
  statusType?: string | null;
  assistantMessageId?: string | null;
  partsCount?: number | null;
  completed?: boolean | null;
  hasError?: boolean | null;
  busySessionCount?: number | null;
}): void {
  const sessionId = String(input.sessionId || "").trim();
  if (!sessionId) return;
  const status = String(input.statusType || "");
  const busy = status === "busy" || status === "retry";
  const messageId = String(input.assistantMessageId || "").trim();
  const partsCount = typeof input.partsCount === "number" ? input.partsCount : null;
  const empty =
    busy
    && Boolean(messageId)
    && partsCount === 0
    && !input.completed
    && !input.hasError;

  const key = sessionId;
  if (!empty) {
    emptyArm.delete(key);
    return;
  }

  const now = Date.now();
  let arm = emptyArm.get(key);
  if (!arm || arm.messageId !== messageId) {
    arm = { messageId, since: now, lastTickLog: 0, longLogged: false };
    emptyArm.set(key, arm);
    hangTraceLog({
      layer: "sync",
      event: "assistant.shell_created",
      sessionId,
      workspaceId: input.workspaceId,
      messageId,
      fields: {
        status,
        partsCount: 0,
        busySessionCount: input.busySessionCount ?? null,
      },
    });
  }

  const ageMs = now - arm.since;
  if (now - arm.lastTickLog >= TICK_LOG_EVERY_MS) {
    arm.lastTickLog = now;
    hangTraceLog({
      layer: "sync",
      event: "empty_shell.tick",
      sessionId,
      workspaceId: input.workspaceId,
      messageId,
      fields: {
        ageMs,
        status,
        busySessionCount: input.busySessionCount ?? null,
      },
    });
  }
  if (!arm.longLogged && ageMs >= LONG_EMPTY_MS) {
    arm.longLogged = true;
    hangTraceLog({
      layer: "sync",
      event: "empty_shell.long",
      sessionId,
      workspaceId: input.workspaceId,
      messageId,
      fields: {
        ageMs,
        thresholdMs: LONG_EMPTY_MS,
        status,
        busySessionCount: input.busySessionCount ?? null,
      },
    });
  }
}

export function noteHangFirstPart(input: {
  sessionId: string;
  workspaceId?: string | null;
  messageId?: string | null;
  partType?: string | null;
}): void {
  const sessionId = String(input.sessionId || "").trim();
  if (!sessionId) return;
  const arm = emptyArm.get(sessionId);
  const ttftMs = arm ? Date.now() - arm.since : null;
  emptyArm.delete(sessionId);
  hangTraceLog({
    layer: "sync",
    event: "assistant.first_part",
    sessionId,
    workspaceId: input.workspaceId,
    messageId: input.messageId,
    fields: {
      partType: input.partType ?? null,
      ttftMs,
    },
  });
}

export function getHangTraceEvents(filter?: {
  sessionId?: string | null;
  limit?: number;
}): HangTraceEvent[] {
  ensureHydrated();
  const sid = String(filter?.sessionId || "").trim();
  const limit = Math.max(1, Math.min(RING_MAX, filter?.limit ?? 200));
  const rows = sid ? ring.filter((r) => r.sessionId === sid) : ring;
  return rows.slice(-limit);
}

export function exportHangTraceJson(filter?: { sessionId?: string | null; limit?: number }): string {
  const events = getHangTraceEvents(filter);
  hangTraceLog({
    layer: "system",
    event: "dump.export",
    sessionId: filter?.sessionId,
    fields: { count: events.length },
  });
  return JSON.stringify(
    {
      product: "wodeappx",
      kind: "hang_trace_dump",
      exportedAt: nowIso(),
      longEmptyThresholdMs: LONG_EMPTY_MS,
      eventCount: events.length,
      events,
    },
    null,
    2,
  );
}

/** Test helper: inject a historical row (for retention tests). */
export function __pushHangTraceEventForTest(event: HangTraceEvent): void {
  ensureHydrated();
  ring.push(event);
}

/** Test helper */
export function __resetHangTraceForTest(): void {
  ring.length = 0;
  turnBySession.clear();
  emptyArm.clear();
  lastPruneAt = 0;
  hydrated = true;
  if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(LS_KEY);
      localStorage.removeItem(LS_PRUNE_AT_KEY);
    } catch {
      /* ignore */
    }
  }
}

export const HANG_TRACE_LONG_EMPTY_MS = LONG_EMPTY_MS;
export const HANG_TRACE_RETENTION_MS = RETENTION_MS;
export const HANG_TRACE_PRUNE_EVERY_MS = PRUNE_EVERY_MS;
