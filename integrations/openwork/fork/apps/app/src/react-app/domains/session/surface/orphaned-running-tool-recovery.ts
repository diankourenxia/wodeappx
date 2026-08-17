/**
 * Codex/Cursor invariant: parent turn status is authoritative.
 * When the engine is idle but a transcript tool is still `running`
 * (classic: task/explore child died as an empty shell), the UI must not
 * keep saying「正在…」and the parent must reconcile — abort is a no-op
 * when already idle, so kick a silent auto-continue.
 *
 * Also covers idle + zombie `pending`/`input-streaming` with empty args
 * (ses_03961aaf: stream/sidecar died mid tool-call; busy-path empty-args
 * recovery never armed or was skipped).
 *
 * Distinct from stuck-empty-pending (busy + empty args) and
 * empty-visible-reply (idle + finish=stop with no prose).
 */

import {
  STUCK_TOOL_AUTO_CONTINUE_MARKER,
  isArgsStreamingToolStatus,
  isEmptyToolInput,
} from "./stuck-tool-recovery";

/** Brief grace so a busy→idle race mid-refetch does not false-fire. */
export const ORPHANED_RUNNING_TOOL_GRACE_MS = 5_000;

/**
 * `python3 -m http.server &` / `nohup … &` never exits the tool shell, so the
 * parent turn stays busy and「继续」looks like it vanished after a long load.
 * After this stall, abort + reconcile (ses_052fd94a repro).
 */
export const STALLED_BACKGROUND_BASH_MS = 45_000;

export const ORPHANED_RUNNING_TOOL_MAX_RETRIES = 2;

export type OrphanedRunningToolHit = {
  sessionId: string;
  messageId: string;
  partId: string;
  tool: string;
  ageMs: number;
  childSessionId: string | null;
  startedAt: number;
};

export type OrphanedToolPartLike = {
  id?: string;
  type?: string;
  tool?: string;
  state?: {
    status?: string;
    input?: Record<string, unknown> | null;
    /** Streaming tool-call argument text before JSON parse fills `input`. */
    raw?: string | null;
    time?: { start?: number; end?: number };
    metadata?: Record<string, unknown> | null;
  };
};

export type OrphanedRunningSnapshotLike = {
  session?: { id?: string } | null;
  status?: { type?: string } | null;
  messages?: Array<{
    info?: {
      id?: string;
      role?: string;
      finish?: string;
      time?: { created?: number; updated?: number; completed?: number };
    };
    parts?: OrphanedToolPartLike[];
  }> | null;
} | null | undefined;

const firstIdleSightingRunning = new Map<string, number>();
const firstIdleSightingPendingEmpty = new Map<string, number>();

function hitKey(sessionId: string, messageId: string, partId: string): string {
  return `${sessionId}\0${messageId}\0${partId}`;
}

function clearSessionSightings(map: Map<string, number>, sessionId: string): void {
  for (const key of [...map.keys()]) {
    if (key.startsWith(`${sessionId}\0`)) map.delete(key);
  }
}

function pruneSessionSightings(
  map: Map<string, number>,
  sessionId: string,
  liveKeys: Set<string>,
): void {
  for (const key of [...map.keys()]) {
    if (!key.startsWith(`${sessionId}\0`)) continue;
    if (!liveKeys.has(key)) map.delete(key);
  }
}

export function isExecutionRunningToolStatus(status: string | undefined): boolean {
  return String(status || "").trim().toLowerCase() === "running";
}

function isParentIdleStatus(status: { type?: string } | null | undefined): boolean {
  const type = String(status?.type || "idle").trim().toLowerCase();
  return type !== "busy" && type !== "retry";
}

function childSessionIdOf(part: OrphanedToolPartLike): string | null {
  const meta = part.state?.metadata;
  if (!meta || typeof meta !== "object") return null;
  const sid = meta.sessionId;
  return typeof sid === "string" && sid.trim() ? sid.trim() : null;
}

function toolStartedAt(part: OrphanedToolPartLike, messageCreated: number | undefined, nowMs: number): number {
  const start = part.state?.time?.start;
  if (typeof start === "number" && Number.isFinite(start) && start > 0) return start;
  if (typeof messageCreated === "number" && Number.isFinite(messageCreated) && messageCreated > 0) {
    return messageCreated;
  }
  return nowMs;
}

function toolRawLen(part: OrphanedToolPartLike): number {
  const raw = part.state?.raw;
  return typeof raw === "string" ? raw.length : 0;
}

/** Idle zombie: args never arrived and are not still streaming into `raw`. */
export function isOrphanedPendingEmptyToolPart(part: OrphanedToolPartLike): boolean {
  if (part.type !== "tool") return false;
  if (!isArgsStreamingToolStatus(part.state?.status)) return false;
  if (!isEmptyToolInput(part.state?.input ?? null)) return false;
  return toolRawLen(part) === 0;
}

export function buildOrphanedRunningToolAutoContinueSystemContext(tool: string): string {
  const name = tool.trim() || "tool";
  return [
    STUCK_TOOL_AUTO_CONTINUE_MARKER,
    `上一次工具「${name}」在会话已空闲后仍停在 running（子代理/工具未正常收尾）。`,
    "请根据已有进度继续完成用户原任务；不要空转重复同一工具；若子代理已有部分结果请汇总后继续。",
  ].join("");
}

export function buildOrphanedPendingEmptyToolAutoContinueSystemContext(tool: string): string {
  const name = tool.trim() || "tool";
  return [
    STUCK_TOOL_AUTO_CONTINUE_MARKER,
    `上一次工具「${name}」在会话已空闲后仍停在 pending 且参数为空（流式参数未完成或引擎中断）。`,
    "请根据已有进度继续完成用户原任务；重新发起必要的工具调用时务必带齐参数，不要再发空 {}。",
  ].join("");
}

/** True when bash was used to detach a long-lived server (http.server / nohup &). */
export function isDetachedBackgroundBashCommand(command: string | undefined): boolean {
  const text = String(command || "");
  if (!text.trim()) return false;
  const hasDetach = /(?:^|[\n;&|])\s*nohup\b/i.test(text)
    || /&\s*(?:disown\b|$)/m.test(text)
    || /(?:^|[\n;])[^&\n]*&\s*$/m.test(text);
  if (!hasDetach) return false;
  return /\bhttp\.server\b/i.test(text)
    || /\bnpx\s+serve\b/i.test(text)
    || /\bvite\b/i.test(text)
    || /\bpython3?\b/i.test(text);
}

function bashCommandOf(part: OrphanedToolPartLike): string {
  const input = part.state?.input;
  if (!input || typeof input !== "object") return "";
  const command = (input as Record<string, unknown>).command;
  return typeof command === "string" ? command : "";
}

function bashAlreadyProducedOutput(part: OrphanedToolPartLike): boolean {
  const meta = part.state?.metadata;
  if (!meta || typeof meta !== "object") return false;
  const output = (meta as Record<string, unknown>).output;
  return typeof output === "string" && output.trim().length > 0;
}

/**
 * Busy/idle agnostic: find a detached background bash in the current
 * post-user turn that has been `running` longer than stallMs (and ideally
 * already printed output). Historical server turns may intentionally keep the
 * detached process alive and must never re-trigger recovery after the user has
 * moved on.
 */
export function findStalledBackgroundBashTool(
  snapshot: OrphanedRunningSnapshotLike,
  options?: {
    nowMs?: number;
    stallMs?: number;
    sessionId?: string;
  },
): OrphanedRunningToolHit | null {
  if (!snapshot?.messages?.length) return null;

  const nowMs = typeof options?.nowMs === "number" && Number.isFinite(options.nowMs)
    ? options.nowMs
    : Date.now();
  const stallMs = typeof options?.stallMs === "number" && Number.isFinite(options.stallMs)
    ? Math.max(0, options.stallMs)
    : STALLED_BACKGROUND_BASH_MS;
  const sessionId = String(options?.sessionId || snapshot.session?.id || "").trim();
  if (!sessionId) return null;

  let lastUserIndex = -1;
  for (let index = 0; index < snapshot.messages.length; index += 1) {
    if (snapshot.messages[index]?.info?.role === "user") lastUserIndex = index;
  }

  let best: OrphanedRunningToolHit | null = null;
  for (let index = lastUserIndex + 1; index < snapshot.messages.length; index += 1) {
    const message = snapshot.messages[index];
    if (message?.info?.role !== "assistant") continue;
    const messageId = String(message.info?.id || "").trim();
    if (!messageId) continue;
    for (const part of message.parts || []) {
      if (part.type !== "tool") continue;
      if (String(part.tool || "").trim().toLowerCase() !== "bash") continue;
      if (!isExecutionRunningToolStatus(part.state?.status)) continue;
      if (!isDetachedBackgroundBashCommand(bashCommandOf(part))) continue;
      const partId = String(part.id || "").trim();
      if (!partId) continue;
      const startedAt = toolStartedAt(part, message.info?.time?.created, nowMs);
      const ageMs = nowMs - startedAt;
      if (ageMs < stallMs) continue;
      // Prefer cases that already printed health-check output; still allow
      // pure hang after 2× stall with no output.
      if (!bashAlreadyProducedOutput(part) && ageMs < stallMs * 2) continue;
      const hit: OrphanedRunningToolHit = {
        sessionId,
        messageId,
        partId,
        tool: "bash",
        ageMs,
        childSessionId: null,
        startedAt,
      };
      if (!best || hit.startedAt >= best.startedAt) best = hit;
    }
  }
  return best;
}

export function buildStalledBackgroundBashAutoContinueSystemContext(): string {
  return [
    STUCK_TOOL_AUTO_CONTINUE_MARKER,
    "上一次 bash 用后台方式启动了长期进程（如 http.server &），工具一直停在 running，导致会话假死。",
    "后台服务若已起来请当作已完成；不要再阻塞等待同一条 bash；根据用户原任务继续，或告知可打开的本地地址。",
  ].join("");
}

/** True when the latest post-user turn still has a tool in OpenCode `running`. */
export function snapshotHasInFlightRunningTool(
  snapshot: OrphanedRunningSnapshotLike,
): boolean {
  if (!snapshot?.messages?.length) return false;

  let lastUserIndex = -1;
  for (let index = 0; index < snapshot.messages.length; index += 1) {
    if (snapshot.messages[index]?.info?.role === "user") lastUserIndex = index;
  }

  for (let index = lastUserIndex + 1; index < snapshot.messages.length; index += 1) {
    const message = snapshot.messages[index];
    if (message?.info?.role !== "assistant") continue;
    for (const part of message.parts || []) {
      if (part.type !== "tool") continue;
      if (isExecutionRunningToolStatus(part.state?.status)) return true;
    }
  }
  return false;
}

export function snapshotHasInFlightPendingEmptyTool(
  snapshot: OrphanedRunningSnapshotLike,
): boolean {
  if (!snapshot?.messages?.length) return false;

  let lastUserIndex = -1;
  for (let index = 0; index < snapshot.messages.length; index += 1) {
    if (snapshot.messages[index]?.info?.role === "user") lastUserIndex = index;
  }

  for (let index = lastUserIndex + 1; index < snapshot.messages.length; index += 1) {
    const message = snapshot.messages[index];
    if (message?.info?.role !== "assistant") continue;
    for (const part of message.parts || []) {
      if (isOrphanedPendingEmptyToolPart(part)) return true;
    }
  }
  return false;
}

export function snapshotHasOrphanedRunningCandidate(
  snapshot: OrphanedRunningSnapshotLike,
): boolean {
  if (!isParentIdleStatus(snapshot?.status)) return false;
  return snapshotHasInFlightRunningTool(snapshot);
}

export function snapshotHasOrphanedPendingEmptyCandidate(
  snapshot: OrphanedRunningSnapshotLike,
): boolean {
  if (!isParentIdleStatus(snapshot?.status)) return false;
  return snapshotHasInFlightPendingEmptyTool(snapshot);
}

/**
 * Find the latest post-user tool still `running` while parent status is idle.
 * Grace is measured from first idle sighting of that part (not message.created).
 */
export function findOrphanedRunningTool(
  snapshot: OrphanedRunningSnapshotLike,
  options?: {
    nowMs?: number;
    graceMs?: number;
    sessionId?: string;
    /** Live parent status override when snapshot.status is missing/stale. */
    parentIdle?: boolean;
  },
): OrphanedRunningToolHit | null {
  if (!snapshot?.messages?.length) return null;

  const parentIdle = options?.parentIdle ?? isParentIdleStatus(snapshot.status);
  if (!parentIdle) {
    // Clear sightings when a live run resumes so the next idle epoch re-arms.
    const sid = String(options?.sessionId || snapshot.session?.id || "").trim();
    if (sid) clearSessionSightings(firstIdleSightingRunning, sid);
    return null;
  }

  const nowMs = typeof options?.nowMs === "number" && Number.isFinite(options.nowMs)
    ? options.nowMs
    : Date.now();
  const graceMs = typeof options?.graceMs === "number" && Number.isFinite(options.graceMs)
    ? Math.max(0, options.graceMs)
    : ORPHANED_RUNNING_TOOL_GRACE_MS;

  const sessionId = String(options?.sessionId || snapshot.session?.id || "").trim();
  if (!sessionId) return null;

  let lastUserIndex = -1;
  for (let index = 0; index < snapshot.messages.length; index += 1) {
    if (snapshot.messages[index]?.info?.role === "user") lastUserIndex = index;
  }

  let best: OrphanedRunningToolHit | null = null;
  const liveKeys = new Set<string>();

  for (let index = lastUserIndex + 1; index < snapshot.messages.length; index += 1) {
    const message = snapshot.messages[index];
    if (message?.info?.role !== "assistant") continue;
    const messageId = String(message.info?.id || "").trim();
    if (!messageId) continue;

    for (const part of message.parts || []) {
      if (part.type !== "tool") continue;
      if (!isExecutionRunningToolStatus(part.state?.status)) continue;
      if (
        String(part.tool || "").trim().toLowerCase() === "bash"
        && isDetachedBackgroundBashCommand(bashCommandOf(part))
      ) {
        // Specialized stalled-background recovery owns this case after its
        // longer grace period; do not surface the generic manual recovery.
        continue;
      }
      const partId = String(part.id || "").trim();
      if (!partId) continue;

      const key = hitKey(sessionId, messageId, partId);
      liveKeys.add(key);
      if (!firstIdleSightingRunning.has(key)) firstIdleSightingRunning.set(key, nowMs);
      const firstSeen = firstIdleSightingRunning.get(key)!;
      const idleAge = nowMs - firstSeen;
      if (idleAge < graceMs) continue;

      const startedAt = toolStartedAt(part, message.info?.time?.created, nowMs);
      const hit: OrphanedRunningToolHit = {
        sessionId,
        messageId,
        partId,
        tool: String(part.tool || "tool"),
        ageMs: Math.max(idleAge, nowMs - startedAt),
        childSessionId: childSessionIdOf(part),
        startedAt,
      };
      // Prefer task tools, then the latest message/part.
      if (
        !best
        || (hit.tool === "task" && best.tool !== "task")
        || (hit.tool === best.tool && hit.startedAt >= best.startedAt)
      ) {
        best = hit;
      }
    }
  }

  pruneSessionSightings(firstIdleSightingRunning, sessionId, liveKeys);
  return best;
}

/**
 * Idle + pending/partial with empty input and empty raw (ses_03961aaf).
 * Parent already left the run; nobody will fill args — reconcile via silent continue.
 * Grace matches orphaned-running so busy→idle races do not false-fire.
 */
export function findOrphanedPendingEmptyTool(
  snapshot: OrphanedRunningSnapshotLike,
  options?: {
    nowMs?: number;
    graceMs?: number;
    sessionId?: string;
    parentIdle?: boolean;
  },
): OrphanedRunningToolHit | null {
  if (!snapshot?.messages?.length) return null;

  const parentIdle = options?.parentIdle ?? isParentIdleStatus(snapshot.status);
  if (!parentIdle) {
    const sid = String(options?.sessionId || snapshot.session?.id || "").trim();
    if (sid) clearSessionSightings(firstIdleSightingPendingEmpty, sid);
    return null;
  }

  const nowMs = typeof options?.nowMs === "number" && Number.isFinite(options.nowMs)
    ? options.nowMs
    : Date.now();
  const graceMs = typeof options?.graceMs === "number" && Number.isFinite(options.graceMs)
    ? Math.max(0, options.graceMs)
    : ORPHANED_RUNNING_TOOL_GRACE_MS;

  const sessionId = String(options?.sessionId || snapshot.session?.id || "").trim();
  if (!sessionId) return null;

  let lastUserIndex = -1;
  for (let index = 0; index < snapshot.messages.length; index += 1) {
    if (snapshot.messages[index]?.info?.role === "user") lastUserIndex = index;
  }

  let best: OrphanedRunningToolHit | null = null;
  const liveKeys = new Set<string>();

  for (let index = lastUserIndex + 1; index < snapshot.messages.length; index += 1) {
    const message = snapshot.messages[index];
    if (message?.info?.role !== "assistant") continue;
    const messageId = String(message.info?.id || "").trim();
    if (!messageId) continue;

    for (const part of message.parts || []) {
      if (!isOrphanedPendingEmptyToolPart(part)) continue;
      const partId = String(part.id || "").trim();
      if (!partId) continue;

      const key = hitKey(sessionId, messageId, partId);
      liveKeys.add(key);
      if (!firstIdleSightingPendingEmpty.has(key)) firstIdleSightingPendingEmpty.set(key, nowMs);
      const firstSeen = firstIdleSightingPendingEmpty.get(key)!;
      const idleAge = nowMs - firstSeen;
      if (idleAge < graceMs) continue;

      const startedAt = toolStartedAt(part, message.info?.time?.created, nowMs);
      const hit: OrphanedRunningToolHit = {
        sessionId,
        messageId,
        partId,
        tool: String(part.tool || "tool"),
        ageMs: Math.max(idleAge, nowMs - startedAt),
        childSessionId: null,
        startedAt,
      };
      if (!best || hit.startedAt >= best.startedAt) best = hit;
    }
  }

  pruneSessionSightings(firstIdleSightingPendingEmpty, sessionId, liveKeys);
  return best;
}

/** Test helper — clear idle-sighting timers. */
export function __resetOrphanedRunningToolStateForTest(): void {
  firstIdleSightingRunning.clear();
  firstIdleSightingPendingEmpty.clear();
}
