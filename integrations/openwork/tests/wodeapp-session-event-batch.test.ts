import { describe, expect, test } from "bun:test";

import {
  SESSION_EVENT_BATCH,
  assistantOutputMarkGate,
  createThrottleGate,
  getSessionEventBatchMetrics,
  noteForcedFlush,
  noteTranscriptFlush,
  resetSessionEventBatchMetrics,
  shouldFlushPartUpdateImmediately,
  shouldFlushSessionStatusImmediately,
} from "../wodeapp/wodeapp-session-event-batch";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("wodeapp-session-event-batch", () => {
  test("tool completed/error and step boundaries flush immediately; streaming tool does not", () => {
    expect(shouldFlushPartUpdateImmediately({ type: "tool", state: { status: "completed" } })).toBe(true);
    expect(shouldFlushPartUpdateImmediately({ type: "tool", state: { status: "error" } })).toBe(true);
    expect(shouldFlushPartUpdateImmediately({ type: "tool", state: { status: "running" } })).toBe(false);
    expect(shouldFlushPartUpdateImmediately({ type: "text" })).toBe(false);
    expect(shouldFlushPartUpdateImmediately({ type: "step-finish" })).toBe(true);
  });

  test("session status idle/retry/error flush immediately; busy can batch", () => {
    expect(shouldFlushSessionStatusImmediately({ type: "idle" })).toBe(true);
    expect(shouldFlushSessionStatusImmediately({ type: "busy" })).toBe(false);
    expect(shouldFlushSessionStatusImmediately("retry")).toBe(true);
  });

  test("activity mark gate suppresses sub-interval repeats unless forced", () => {
    const gate = createThrottleGate(100);
    expect(gate.tryPass("a", { now: 1_000 })).toBe(true);
    expect(gate.tryPass("a", { now: 1_050 })).toBe(false);
    expect(gate.tryPass("a", { now: 1_100 })).toBe(true);
    expect(gate.tryPass("a", { now: 1_120, force: true })).toBe(true);
  });

  test("metrics counters move on flush helpers", () => {
    resetSessionEventBatchMetrics();
    noteTranscriptFlush(3);
    noteForcedFlush();
    const metrics = getSessionEventBatchMetrics();
    expect(metrics.transcript_flushes).toBe(1);
    expect(metrics.part_updates_coalesced).toBe(3);
    expect(metrics.forced_flushes).toBe(1);
    expect(SESSION_EVENT_BATCH.ACTIVITY_MARK_MIN_MS).toBe(100);
    expect(SESSION_EVENT_BATCH.TOOL_ACTIVITY_UI_MS).toBe(200);
    assistantOutputMarkGate.reset();
  });

  test("session-sync wires partUpdateBuffer + immediate flush helpers", () => {
    const source = readFileSync(
      join(import.meta.dir, "../fork/apps/app/src/react-app/domains/session/sync/session-sync.ts"),
      "utf8",
    );
    expect(source).toContain("partUpdateBuffer");
    expect(source).toContain("shouldFlushPartUpdateImmediately");
    expect(source).toContain("flushTranscriptBuffers");
    expect(source).toContain("assistantOutputMarkGate");
    expect(source).toContain("wodeapp-session-event-batch");
  });
});
