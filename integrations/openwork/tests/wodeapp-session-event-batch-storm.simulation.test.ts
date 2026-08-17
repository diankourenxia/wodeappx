/**
 * PERF-07 storm simulation — mirrors session-sync flush decisions without
 * spinning Electron. Counts transcript "commits" (setQueryData equivalents)
 * for a mixed SSE burst: deltas + streaming part.updated + terminal tools.
 */
import { describe, expect, test } from "bun:test";

import {
  assistantOutputMarkGate,
  getSessionEventBatchMetrics,
  noteForcedFlush,
  noteTranscriptFlush,
  resetSessionEventBatchMetrics,
  shouldFlushPartUpdateImmediately,
  shouldFlushSessionStatusImmediately,
} from "../wodeapp/wodeapp-session-event-batch";

type SimPart = {
  id: string;
  type: string;
  state?: { status?: string } | null;
};

type SimEvent =
  | { kind: "delta" }
  | { kind: "part.updated"; part: SimPart }
  | { kind: "status"; status: { type: string } }
  | { kind: "idle" };

type StormResult = {
  events: number;
  commits: number;
  forcedFlushes: number;
  transcriptFlushes: number;
  activityMarks: number;
  activitySuppressed: number;
  reductionPct: number;
};

function buildMixedStorm(options?: {
  deltas?: number;
  textUpdates?: number;
  runningToolTicks?: number;
  completedTools?: number;
  busyTicks?: number;
}): SimEvent[] {
  const deltas = options?.deltas ?? 120;
  const textUpdates = options?.textUpdates ?? 40;
  const runningToolTicks = options?.runningToolTicks ?? 30;
  const completedTools = options?.completedTools ?? 6;
  const busyTicks = options?.busyTicks ?? 8;
  const events: SimEvent[] = [];

  for (let i = 0; i < busyTicks; i += 1) {
    events.push({ kind: "status", status: { type: "busy" } });
  }
  for (let i = 0; i < deltas; i += 1) events.push({ kind: "delta" });
  for (let i = 0; i < textUpdates; i += 1) {
    events.push({
      kind: "part.updated",
      part: { id: `text-${i}`, type: "text" },
    });
  }
  for (let i = 0; i < runningToolTicks; i += 1) {
    events.push({
      kind: "part.updated",
      part: {
        id: `tool-run-${Math.floor(i / 5)}`,
        type: "tool",
        state: { status: "running" },
      },
    });
  }
  for (let i = 0; i < completedTools; i += 1) {
    events.push({
      kind: "part.updated",
      part: {
        id: `tool-done-${i}`,
        type: "tool",
        state: { status: "completed" },
      },
    });
  }
  events.push({ kind: "status", status: { type: "idle" } });
  events.push({ kind: "idle" });
  return events;
}

/** Naive pre-PERF-07: every SSE writes transcript/status immediately. */
function simulateNaive(events: SimEvent[]): StormResult {
  let commits = 0;
  let activityMarks = 0;
  for (const event of events) {
    if (event.kind === "delta") {
      commits += 1;
      activityMarks += 1;
      continue;
    }
    if (event.kind === "part.updated") {
      commits += 1;
      activityMarks += 1;
      continue;
    }
    if (event.kind === "status" || event.kind === "idle") {
      commits += 1;
    }
  }
  return {
    events: events.length,
    commits,
    forcedFlushes: 0,
    transcriptFlushes: commits,
    activityMarks,
    activitySuppressed: 0,
    reductionPct: 0,
  };
}

/**
 * PERF-07 policy: queue non-urgent work into one flush per "frame";
 * force-flush terminals (completed tool / idle / error). Same decision
 * surface as session-sync scheduleTranscriptFlush + immediate paths.
 */
function simulateBatched(events: SimEvent[], options?: { frames?: number }): StormResult {
  resetSessionEventBatchMetrics();
  assistantOutputMarkGate.reset();

  let commits = 0;
  let pendingParts = 0;
  let pendingDeltas = 0;
  let pendingBusy = 0;
  let scheduled = false;
  let activityMarks = 0;
  const frames = Math.max(1, options?.frames ?? 8);

  const flushQueued = () => {
    if (pendingParts === 0 && pendingDeltas === 0 && pendingBusy === 0) {
      scheduled = false;
      return;
    }
    commits += 1;
    noteTranscriptFlush(pendingParts);
    pendingParts = 0;
    pendingDeltas = 0;
    pendingBusy = 0;
    scheduled = false;
  };

  const schedule = () => {
    scheduled = true;
  };

  // Distribute events across synthetic frames (one flush opportunity each).
  const chunk = Math.ceil(events.length / frames);
  for (let frame = 0; frame < frames; frame += 1) {
    const slice = events.slice(frame * chunk, (frame + 1) * chunk);
    for (const event of slice) {
      if (event.kind === "delta") {
        pendingDeltas += 1;
        if (assistantOutputMarkGate.tryPass("storm-msg", { now: frame * 16 + pendingDeltas })) {
          activityMarks += 1;
        }
        schedule();
        continue;
      }
      if (event.kind === "part.updated") {
        const immediate = shouldFlushPartUpdateImmediately(event.part);
        if (immediate) {
          flushQueued();
          commits += 1;
          noteForcedFlush();
          activityMarks += 1;
          continue;
        }
        pendingParts += 1;
        if (assistantOutputMarkGate.tryPass("storm-msg", { now: frame * 16 + pendingParts * 3 })) {
          activityMarks += 1;
        }
        schedule();
        continue;
      }
      if (event.kind === "status") {
        if (shouldFlushSessionStatusImmediately(event.status)) {
          flushQueued();
          commits += 1;
          noteForcedFlush();
        } else {
          pendingBusy += 1;
          schedule();
        }
        continue;
      }
      if (event.kind === "idle") {
        flushQueued();
        commits += 1;
        noteForcedFlush();
      }
    }
    if (scheduled) flushQueued();
  }
  flushQueued();

  const metrics = getSessionEventBatchMetrics();
  const naiveCommits = simulateNaive(events).commits;
  const reductionPct = naiveCommits === 0
    ? 0
    : Math.round((1 - commits / naiveCommits) * 1000) / 10;

  return {
    events: events.length,
    commits,
    forcedFlushes: metrics.forced_flushes,
    transcriptFlushes: metrics.transcript_flushes,
    activityMarks,
    activitySuppressed: metrics.activity_marks_suppressed,
    reductionPct,
  };
}

describe("PERF-07 session event batch storm simulation", () => {
  test("mixed SSE storm: transcript commits drop ≥50% vs naive per-event writes", () => {
    const events = buildMixedStorm();
    const naive = simulateNaive(events);
    const batched = simulateBatched(events, { frames: 10 });

    const matrix = {
      events: events.length,
      naiveCommits: naive.commits,
      batchedCommits: batched.commits,
      reductionPct: batched.reductionPct,
      forcedFlushes: batched.forcedFlushes,
      activityMarksNaive: naive.activityMarks,
      activityMarksBatched: batched.activityMarks,
      activitySuppressed: batched.activitySuppressed,
      passCommitCut: batched.reductionPct >= 50,
      passForcedTerminals: batched.forcedFlushes >= 6 + 1 + 1, // completed tools + idle status + idle event
      passActivityThrottle: batched.activityMarks < naive.activityMarks * 0.5,
    };

    // eslint-disable-next-line no-console
    console.log("[perf07-storm-matrix]", JSON.stringify(matrix, null, 2));

    expect(matrix.passCommitCut).toBe(true);
    expect(matrix.passForcedTerminals).toBe(true);
    expect(matrix.passActivityThrottle).toBe(true);
    expect(batched.commits).toBeLessThanOrEqual(Math.floor(naive.commits * 0.5));
  });

  test("terminal tool completed still force-flushes even mid-storm", () => {
    const events: SimEvent[] = [
      { kind: "delta" },
      { kind: "delta" },
      {
        kind: "part.updated",
        part: { id: "t1", type: "tool", state: { status: "running" } },
      },
      {
        kind: "part.updated",
        part: { id: "t1", type: "tool", state: { status: "completed" } },
      },
    ];
    resetSessionEventBatchMetrics();
    const batched = simulateBatched(events, { frames: 1 });
    expect(batched.forcedFlushes).toBeGreaterThanOrEqual(1);
    // completed tool must produce at least one immediate commit in the same frame
    expect(batched.commits).toBeGreaterThanOrEqual(1);
  });
});
