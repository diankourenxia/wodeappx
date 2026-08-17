/**
 * Stuck empty-args tool recovery must not impersonate the user.
 * The visible chat keeps the original user turn; this marker only
 * kickstarts OpenCode after abort and is hidden from the transcript UI.
 *
 * Detection must NOT read the UI transcript: parse-tool-parts defers
 * pending+{} tools, so they never appear there. Age must NOT fall back to
 * message.created — that lets a stale HTTP snapshot abort a later turn.
 *
 * Only `pending` (args still streaming) is a recovery candidate — never
 * `running` with empty `{}` (legitimate zero-arg tools). Candidates are
 * bound to a busy run epoch and cleared on idle.
 */
export const STUCK_TOOL_AUTO_CONTINUE_MARKER =
  "以下是WodeAppX 的系统自动续跑指令（非用户发言）。";

/**
 * Empty-args auto-abort is ON again (ses_03961aaf*).
 * Safety vs ses_049fe53a false cancels:
 * - content-heavy tools (write/bash/…) use 10m budget, not 90s
 * - growing `state.raw` resets the empty-pending age (streaming heredoc survives)
 * - only `pending`/`input-streaming`/`partial` arm; never `running`+{}
 * Idle/zombie `pending` after sidecar death is owned by orphaned-pending recovery.
 */
export const STUCK_EMPTY_ARGS_RECOVERY_ENABLED = true;

/** Historical short budget (only used when recovery is re-enabled). */
export const STUCK_EMPTY_TOOL_MS = 90_000;

/** Historical content-heavy budget (only used when recovery is re-enabled). */
export const STUCK_EMPTY_CONTENT_TOOL_MS = 600_000;

/** Tools whose args are often multi-KB and stay empty-input while `raw` grows.
 * Include `bash`: agents stream large `cat > file <<'EOF'` HTML/scripts the same
 * way as `write` (ses_049fe53a continue turn: bash pending+{} ~92s → abort).
 */
const CONTENT_HEAVY_TOOL_RE =
  /^(write|edit|multiedit|apply_patch|str_replace|strreplace|search_replace|create_file|bash)$/i;

export function isContentHeavyTool(tool: string | undefined): boolean {
  return CONTENT_HEAVY_TOOL_RE.test(String(tool || "").trim());
}

export function stuckEmptyBudgetMs(tool: string | undefined): number {
  return isContentHeavyTool(tool) ? STUCK_EMPTY_CONTENT_TOOL_MS : STUCK_EMPTY_TOOL_MS;
}

/** Cap silent auto-continues per session across all recovery paths (avoid thrash loops). */
export const STUCK_TOOL_AUTO_CONTINUE_MAX = 2;

export type StuckEmptyPendingToolHit = {
  sessionId: string;
  messageId: string;
  partId: string;
  tool: string;
  ageMs: number;
  firstEmptyAt: number;
  busyEpoch: number;
};

export type RawToolPartLike = {
  id?: string;
  sessionID?: string;
  messageID?: string;
  type?: string;
  tool?: string;
  state?: {
    status?: string;
    input?: Record<string, unknown> | null;
    /** Streaming tool-call argument text before JSON parse fills `input`. */
    raw?: string | null;
  };
};

export type StuckToolSnapshotLike = {
  status?: { type?: string } | null;
  messages?: Array<{
    info?: {
      id?: string;
      role?: string;
      time?: { created?: number; updated?: number };
    };
    parts?: unknown[];
  }> | null;
} | null | undefined;

type LiveToolPartRecord = {
  sessionId: string;
  messageId: string;
  partId: string;
  tool: string;
  status: string;
  /** True only while status is args-streaming pending with empty input in the current busy epoch. */
  emptyPending: boolean;
  firstEmptyAt: number | null;
  /** Last seen `state.raw` length — growth resets the empty-pending age. */
  rawLen: number;
  busyEpoch: number;
  updatedAt: number;
};

type LiveSessionMeta = {
  latestAssistantMessageId: string | null;
  latestAssistantCreatedAt: number | null;
  lastVisibleOutputAt: number | null;
  lastVisibleOutputMessageId: string | null;
  busyEpoch: number;
  runLive: boolean;
};

const liveToolParts = new Map<string, LiveToolPartRecord>();
const liveSessionMeta = new Map<string, LiveSessionMeta>();

export function isStuckToolAutoContinueText(text: string | undefined): boolean {
  const value = (text || "").trim();
  // Exact marker only — never treat a merged user+system draft as silent.
  return value === STUCK_TOOL_AUTO_CONTINUE_MARKER;
}

export function buildStuckToolAutoContinueSystemContext(tool: string): string {
  const name = tool.trim() || "tool";
  const productHint = /product_save/i.test(name)
    ? "重新调用时优先传 selectedImageIds（如 img_01）；也可传 media[].imageId。不要传空参数 {}。"
    : "重新发起必要的工具调用，不要停在半路或只解释错误。";
  return [
    STUCK_TOOL_AUTO_CONTINUE_MARKER,
    `上一次工具「${name}」因流式参数未完成而中断。`,
    `请从当前进度继续完成用户原任务：${productHint}`,
  ].join("");
}

export function liveToolPartKey(sessionId: string, messageId: string, partId: string): string {
  return `${sessionId}\0${messageId}\0${partId}`;
}

export function isEmptyToolInput(input: Record<string, unknown> | null | undefined): boolean {
  return !input || Object.keys(input).length === 0;
}

/** Args still streaming — not execution. `running` with `{}` is a zero-arg tool, not stuck. */
export function isArgsStreamingToolStatus(status: string | undefined): boolean {
  const value = String(status || "").trim().toLowerCase();
  return value === "pending" || value === "input-streaming" || value === "partial";
}

function isLiveRunStatus(status: { type?: string } | null | undefined): boolean {
  return status?.type === "busy" || status?.type === "retry";
}

function sessionMeta(sessionId: string): LiveSessionMeta {
  let meta = liveSessionMeta.get(sessionId);
  if (!meta) {
    meta = {
      latestAssistantMessageId: null,
      latestAssistantCreatedAt: null,
      lastVisibleOutputAt: null,
      lastVisibleOutputMessageId: null,
      busyEpoch: 0,
      runLive: false,
    };
    liveSessionMeta.set(sessionId, meta);
  }
  return meta;
}

function retireEmptyPendingCandidates(sessionId: string): void {
  for (const [key, record] of liveToolParts) {
    if (record.sessionId !== sessionId) continue;
    if (!record.emptyPending && record.firstEmptyAt === null) continue;
    liveToolParts.set(key, {
      ...record,
      emptyPending: false,
      firstEmptyAt: null,
      rawLen: 0,
    });
  }
}

function toolRawLen(state: RawToolPartLike["state"]): number {
  const raw = state?.raw;
  return typeof raw === "string" ? raw.length : 0;
}

/** Drop live tool state for a session (route change / unmount). */
export function clearLiveToolSession(sessionId: string): void {
  const id = sessionId.trim();
  if (!id) return;
  liveSessionMeta.delete(id);
  for (const key of [...liveToolParts.keys()]) {
    if (key.startsWith(`${id}\0`)) liveToolParts.delete(key);
  }
}

/**
 * Bind recovery candidates to the current busy run. Idle/retry-end retires
 * empty-pending timers so a parked historical pending cannot kill the next run.
 */
export function observeLiveRunStatus(
  sessionId: string,
  status: { type?: string } | null | undefined,
  nowMs: number = Date.now(),
): void {
  const sid = sessionId.trim();
  if (!sid) return;
  const meta = sessionMeta(sid);
  const live = isLiveRunStatus(status);
  if (live && !meta.runLive) {
    meta.busyEpoch += 1;
    retireEmptyPendingCandidates(sid);
    meta.lastVisibleOutputAt = null;
    meta.lastVisibleOutputMessageId = null;
  } else if (!live && meta.runLive) {
    retireEmptyPendingCandidates(sid);
  }
  meta.runLive = live;
  void nowMs;
}

/**
 * Track the newest live assistant turn. Snapshot seeds must pass `created`
 * so a stale HTTP snapshot cannot regress the pointer backwards.
 */
export function observeLiveAssistantMessage(
  sessionId: string,
  messageId: string,
  options?: { created?: number; nowMs?: number },
): void {
  const sid = sessionId.trim();
  const mid = messageId.trim();
  if (!sid || !mid) return;
  const meta = sessionMeta(sid);
  const created = typeof options?.created === "number" && Number.isFinite(options.created)
    ? options.created
    : null;

  if (meta.latestAssistantMessageId === mid) {
    if (created !== null) {
      meta.latestAssistantCreatedAt = Math.max(meta.latestAssistantCreatedAt ?? created, created);
    }
    return;
  }

  if (
    created !== null
    && meta.latestAssistantCreatedAt !== null
    && created < meta.latestAssistantCreatedAt
  ) {
    // Stale snapshot / out-of-order seed — do not move latest backwards.
    return;
  }

  meta.latestAssistantMessageId = mid;
  meta.latestAssistantCreatedAt = created ?? options?.nowMs ?? Date.now();
}

/**
 * Visible assistant prose (not tool parts). If this lands after firstEmptyAt on
 * the same turn, recovery must not abort — the model is still producing output.
 */
export function observeLiveAssistantVisibleOutput(
  sessionId: string,
  messageId: string,
  options?: { nowMs?: number; created?: number },
): void {
  const sid = sessionId.trim();
  const mid = messageId.trim();
  if (!sid || !mid) return;
  const nowMs = typeof options?.nowMs === "number" && Number.isFinite(options.nowMs)
    ? options.nowMs
    : Date.now();
  observeLiveAssistantMessage(sid, mid, { created: options?.created, nowMs });
  const meta = sessionMeta(sid);
  meta.lastVisibleOutputAt = nowMs;
  meta.lastVisibleOutputMessageId = mid;
}

/**
 * Observe a raw OpenCode tool part (SSE or snapshot). UI transcript mapping
 * deliberately drops pending+{} so recovery must use this path.
 *
 * Snapshot rules:
 * - never arm a new firstEmptyAt (SSE-only)
 * - preserve same-epoch SSE candidates that are still empty+args-streaming
 * - settle only when filled / left args-streaming / completed / error
 * - never reopen a part live SSE already settled
 */
export function observeLiveToolPart(
  part: RawToolPartLike,
  options?: { nowMs?: number; source?: "sse" | "snapshot" },
): void {
  if (part.type !== "tool") return;
  const sessionId = String(part.sessionID || "").trim();
  const messageId = String(part.messageID || "").trim();
  const partId = String(part.id || "").trim();
  if (!sessionId || !messageId || !partId) return;

  const nowMs = typeof options?.nowMs === "number" && Number.isFinite(options.nowMs)
    ? options.nowMs
    : Date.now();
  const source = options?.source || "sse";
  const status = String(part.state?.status || "pending");
  const emptyInput = isEmptyToolInput(part.state?.input ?? null);
  const argsStreaming = isArgsStreamingToolStatus(status);
  const stillEmptyStreaming = emptyInput && argsStreaming;
  const rawLen = toolRawLen(part.state);
  const meta = sessionMeta(sessionId);
  const key = liveToolPartKey(sessionId, messageId, partId);
  const existing = liveToolParts.get(key);
  const tool = String(part.tool || existing?.tool || "tool");

  if (source === "snapshot") {
    if (
      existing
      && !existing.emptyPending
      && stillEmptyStreaming
    ) {
      // Live SSE already settled this part; ignore a stale HTTP snapshot reopen.
      return;
    }
    if (
      existing?.emptyPending
      && existing.firstEmptyAt !== null
      && existing.busyEpoch === meta.busyEpoch
      && stillEmptyStreaming
      && meta.runLive
    ) {
      // Fresh refetch / periodic poll still shows empty pending — keep the SSE
      // timer, but treat growing `raw` as progress (same as live SSE).
      const progressed = rawLen > existing.rawLen;
      liveToolParts.set(key, {
        sessionId,
        messageId,
        partId,
        tool,
        status,
        emptyPending: true,
        firstEmptyAt: progressed ? nowMs : existing.firstEmptyAt,
        rawLen: Math.max(existing.rawLen, rawLen),
        busyEpoch: meta.busyEpoch,
        updatedAt: nowMs,
      });
      return;
    }
    // No SSE arm to preserve, or tool filled / left args-streaming → settle.
    liveToolParts.set(key, {
      sessionId,
      messageId,
      partId,
      tool,
      status,
      emptyPending: false,
      firstEmptyAt: null,
      rawLen: stillEmptyStreaming ? rawLen : 0,
      busyEpoch: meta.busyEpoch,
      updatedAt: nowMs,
    });
    return;
  }

  // Only live SSE may arm empty-pending timers.
  const canArm = stillEmptyStreaming && meta.runLive;
  let firstEmptyAt: number | null = null;
  let emptyPending = false;
  let nextRawLen = rawLen;
  if (canArm) {
    emptyPending = true;
    if (
      existing?.emptyPending
      && existing.firstEmptyAt !== null
      && existing.busyEpoch === meta.busyEpoch
    ) {
      // Args text still streaming into `raw` while `input` stays {} — not stuck.
      if (rawLen > existing.rawLen) {
        firstEmptyAt = nowMs;
        nextRawLen = rawLen;
      } else {
        firstEmptyAt = existing.firstEmptyAt;
        nextRawLen = Math.max(existing.rawLen, rawLen);
      }
    } else {
      firstEmptyAt = nowMs;
    }
  }

  liveToolParts.set(key, {
    sessionId,
    messageId,
    partId,
    tool,
    status,
    emptyPending,
    firstEmptyAt,
    rawLen: emptyPending ? nextRawLen : 0,
    busyEpoch: meta.busyEpoch,
    updatedAt: nowMs,
  });

  // SSE is chronological — advance latest turn. Snapshot seeding already
  // walks assistants with created timestamps and must not regress via tools.
  observeLiveAssistantMessage(sessionId, messageId, { nowMs });
}

/** Seed / refresh live tool state from an HTTP snapshot without using message.created as age. */
export function seedLiveToolStateFromSnapshot(
  sessionId: string,
  snapshot: StuckToolSnapshotLike,
  nowMs: number = Date.now(),
): void {
  const sid = sessionId.trim();
  if (!sid || !snapshot?.messages?.length) return;

  observeLiveRunStatus(sid, snapshot.status, nowMs);

  let lastUserIndex = -1;
  for (let index = 0; index < snapshot.messages.length; index += 1) {
    if (snapshot.messages[index]?.info?.role === "user") lastUserIndex = index;
  }

  for (let index = 0; index < snapshot.messages.length; index += 1) {
    const message = snapshot.messages[index];
    const messageId = String(message?.info?.id || "").trim();
    const role = message?.info?.role;
    if (!messageId) continue;
    const afterLatestUser = index > lastUserIndex;
    // Snapshot may advance the live assistant pointer only for turns after the
    // latest user — never promote a pre-user historical assistant as "latest".
    if (role === "assistant" && afterLatestUser) {
      observeLiveAssistantMessage(sid, messageId, {
        created: message?.info?.time?.created,
        nowMs,
      });
    }
    for (const part of message?.parts || []) {
      const toolPart = part as RawToolPartLike & { id?: string };
      if (toolPart.type !== "tool") continue;
      // Snapshot never arms new timers; preserves same-epoch SSE candidates
      // that are still empty pending; settles filled / non-args-streaming.
      observeLiveToolPart(
        {
          id: toolPart.id,
          sessionID: sid,
          messageID: messageId,
          type: "tool",
          tool: toolPart.tool,
          state: toolPart.state,
        },
        { nowMs, source: "snapshot" },
      );
    }
  }
}

function visibleOutputBlocksAbort(
  meta: LiveSessionMeta,
  record: LiveToolPartRecord,
): boolean {
  if (record.firstEmptyAt === null) return false;
  if (meta.lastVisibleOutputAt === null) return false;
  if (meta.lastVisibleOutputMessageId !== record.messageId) return false;
  // Prose on the same assistant at/after empty-pending started → do not kill.
  // Use >= so same-millisecond SSE ordering still fail-safes to "do not abort".
  return meta.lastVisibleOutputAt >= record.firstEmptyAt;
}

function buildHit(record: LiveToolPartRecord, meta: LiveSessionMeta, nowMs: number): StuckEmptyPendingToolHit | null {
  if (!record.emptyPending || record.firstEmptyAt === null) return null;
  if (record.busyEpoch !== meta.busyEpoch) return null;
  if (!meta.runLive) return null;
  if (visibleOutputBlocksAbort(meta, record)) return null;
  const ageMs = nowMs - record.firstEmptyAt;
  if (ageMs < stuckEmptyBudgetMs(record.tool)) return null;
  return {
    sessionId: record.sessionId,
    messageId: record.messageId,
    partId: record.partId,
    tool: record.tool,
    ageMs,
    firstEmptyAt: record.firstEmptyAt,
    busyEpoch: record.busyEpoch,
  };
}

/**
 * Find a sustained empty-pending tool on the latest live assistant turn.
 * Age is measured from first live observation of empty pending — never message.created.
 */
let stuckEmptyArgsRecoveryEnabledForTest: boolean | null = null;

export function __setStuckEmptyArgsRecoveryEnabledForTest(enabled: boolean | null): void {
  stuckEmptyArgsRecoveryEnabledForTest = enabled;
}

export function isStuckEmptyArgsRecoveryEnabled(): boolean {
  if (stuckEmptyArgsRecoveryEnabledForTest !== null) return stuckEmptyArgsRecoveryEnabledForTest;
  return STUCK_EMPTY_ARGS_RECOVERY_ENABLED;
}

export function findStuckEmptyPendingTool(
  sessionId: string,
  options?: {
    nowMs?: number;
    /** Live run status; do not trust snapshot.status alone. */
    runBusy?: boolean;
  },
): StuckEmptyPendingToolHit | null {
  if (!isStuckEmptyArgsRecoveryEnabled()) return null;
  const sid = sessionId.trim();
  if (!sid) return null;
  if (options?.runBusy === false) return null;

  const meta = liveSessionMeta.get(sid);
  if (!meta?.runLive) return null;
  const latestId = meta.latestAssistantMessageId;
  if (!latestId) return null;

  const nowMs = typeof options?.nowMs === "number" && Number.isFinite(options.nowMs)
    ? options.nowMs
    : Date.now();

  let best: StuckEmptyPendingToolHit | null = null;
  for (const record of liveToolParts.values()) {
    if (record.sessionId !== sid) continue;
    if (record.messageId !== latestId) continue;
    const hit = buildHit(record, meta, nowMs);
    if (!hit) continue;
    if (!best || hit.firstEmptyAt <= best.firstEmptyAt) best = hit;
  }
  return best;
}

/**
 * Re-check live state immediately before abort. If the part filled, completed,
 * left pending, or is no longer on the latest assistant turn, return null.
 */
export function confirmStuckEmptyPendingTool(
  hit: Pick<StuckEmptyPendingToolHit, "sessionId" | "messageId" | "partId">,
  options?: { nowMs?: number; runBusy?: boolean },
): StuckEmptyPendingToolHit | null {
  const again = findStuckEmptyPendingTool(hit.sessionId, options);
  if (!again) return null;
  if (again.partId !== hit.partId || again.messageId !== hit.messageId) return null;
  return again;
}

/**
 * Authoritative HTTP snapshot check used right before abort.
 * Returns false when the part is gone/filled/running or a newer assistant exists.
 */
export function snapshotConfirmsEmptyPendingTool(
  snapshot: StuckToolSnapshotLike,
  hit: Pick<StuckEmptyPendingToolHit, "messageId" | "partId">,
): boolean {
  if (!snapshot?.messages?.length) return false;
  if (!isLiveRunStatus(snapshot.status)) return false;

  let lastUserIndex = -1;
  for (let index = 0; index < snapshot.messages.length; index += 1) {
    if (snapshot.messages[index]?.info?.role === "user") lastUserIndex = index;
  }

  let latestAssistantId: string | null = null;
  let latestAssistantIndex = -1;
  for (let i = snapshot.messages.length - 1; i >= 0; i -= 1) {
    const message = snapshot.messages[i];
    if (message?.info?.role === "assistant") {
      latestAssistantId = String(message.info.id || "") || null;
      latestAssistantIndex = i;
      break;
    }
  }
  if (!latestAssistantId || latestAssistantId !== hit.messageId) return false;
  // Historical assistants before the latest user must never confirm an abort.
  if (latestAssistantIndex <= lastUserIndex) return false;

  for (const message of snapshot.messages) {
    if (String(message.info?.id || "") !== hit.messageId) continue;
    for (const part of message.parts || []) {
      const toolPart = part as {
        id?: string;
        type?: string;
        state?: { status?: string; input?: Record<string, unknown> };
      };
      if (toolPart.type !== "tool" || toolPart.id !== hit.partId) continue;
      if (!isArgsStreamingToolStatus(toolPart.state?.status)) return false;
      return isEmptyToolInput(toolPart.state?.input);
    }
  }
  return false;
}

/** Test helpers — keep production Maps inspectable without exporting mutators. */
export function __resetLiveToolStateForTest(): void {
  liveToolParts.clear();
  liveSessionMeta.clear();
  stuckEmptyArgsRecoveryEnabledForTest = null;
}

export function __getLiveToolPartForTest(
  sessionId: string,
  messageId: string,
  partId: string,
): LiveToolPartRecord | undefined {
  return liveToolParts.get(liveToolPartKey(sessionId, messageId, partId));
}

export function __getLiveSessionMetaForTest(sessionId: string): LiveSessionMeta | undefined {
  return liveSessionMeta.get(sessionId);
}
