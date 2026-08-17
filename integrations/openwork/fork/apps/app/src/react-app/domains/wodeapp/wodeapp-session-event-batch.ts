/**
 * PERF-07: session event batching helpers.
 * Coalesce high-frequency SSE into rAF/33–50ms transcript commits; force-flush
 * terminal tool/status so UI stays snappy without per-token setState.
 */

export const SESSION_EVENT_BATCH = Object.freeze({
  /** Target cadence for non-urgent transcript commits (rAF ≈ 16ms; cap ~50ms). */
  TRANSCRIPT_FLUSH_MS: 33,
  /** Throttle assistant-output activity marks while streaming. */
  ACTIVITY_MARK_MIN_MS: 100,
  /** Soft budget for tool-activity UI ticks (panels / timers). */
  TOOL_ACTIVITY_UI_MS: 200,
});

export type SessionEventBatchMetrics = {
  transcript_flushes: number;
  part_updates_coalesced: number;
  activity_marks_suppressed: number;
  forced_flushes: number;
};

const metrics: SessionEventBatchMetrics = {
  transcript_flushes: 0,
  part_updates_coalesced: 0,
  activity_marks_suppressed: 0,
  forced_flushes: 0,
};

export function getSessionEventBatchMetrics(): SessionEventBatchMetrics {
  return { ...metrics };
}

export function resetSessionEventBatchMetrics(): void {
  metrics.transcript_flushes = 0;
  metrics.part_updates_coalesced = 0;
  metrics.activity_marks_suppressed = 0;
  metrics.forced_flushes = 0;
}

export function noteTranscriptFlush(coalescedPartUpdates = 0): void {
  metrics.transcript_flushes += 1;
  if (coalescedPartUpdates > 0) metrics.part_updates_coalesced += coalescedPartUpdates;
}

export function noteForcedFlush(): void {
  metrics.forced_flushes += 1;
}

export function noteActivityMarkSuppressed(): void {
  metrics.activity_marks_suppressed += 1;
}

/** Terminal / structural part updates must paint immediately. */
export function shouldFlushPartUpdateImmediately(part: {
  type?: string;
  state?: { status?: string } | null;
}): boolean {
  const type = part?.type;
  if (type === "step-finish" || type === "step-start") return true;
  if (type === "tool") {
    const status = part.state?.status;
    return status === "completed" || status === "error" || status === "failed";
  }
  return false;
}

/** Idle / retry / error must not wait for the next batch window. */
export function shouldFlushSessionStatusImmediately(
  status: { type?: string } | string | null | undefined,
): boolean {
  const type = typeof status === "string" ? status : status?.type;
  return type === "idle" || type === "retry" || type === "error";
}

export function createThrottleGate(minIntervalMs: number) {
  const lastByKey = new Map<string, number>();
  return {
    tryPass(key: string, options?: { now?: number; force?: boolean }): boolean {
      const now = options?.now ?? Date.now();
      if (options?.force) {
        lastByKey.set(key, now);
        return true;
      }
      const previous = lastByKey.get(key) ?? 0;
      if (now - previous < minIntervalMs) {
        noteActivityMarkSuppressed();
        return false;
      }
      lastByKey.set(key, now);
      return true;
    },
    reset(): void {
      lastByKey.clear();
    },
  };
}

/** Shared gate for markAssistantOutput while tokens stream. */
export const assistantOutputMarkGate = createThrottleGate(SESSION_EVENT_BATCH.ACTIVITY_MARK_MIN_MS);
