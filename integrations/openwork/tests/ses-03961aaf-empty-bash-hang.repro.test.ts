/**
 * Repro + regression: ses_03961aafdffelEg0CbhYCwGlNl
 *
 * Live shape: after long reasoning, assistant emits bash with
 * status=pending, input={}, raw=""; finish=None; tokens=0. Hang persisted
 * across sidecar restart.
 *
 * Fix expectations:
 * 1) busy-path empty-args recovery is ON and detects this shape after 10m
 * 2) idle-path orphaned-pending recovery detects pending+{} with empty raw
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  ORPHANED_RUNNING_TOOL_GRACE_MS,
  __resetOrphanedRunningToolStateForTest,
  findOrphanedPendingEmptyTool,
  findOrphanedRunningTool,
  findStalledBackgroundBashTool,
  isExecutionRunningToolStatus,
  snapshotHasOrphanedPendingEmptyCandidate,
  snapshotHasOrphanedRunningCandidate,
} from "../fork/apps/app/src/react-app/domains/session/surface/orphaned-running-tool-recovery.ts";
import {
  STUCK_EMPTY_ARGS_RECOVERY_ENABLED,
  STUCK_EMPTY_CONTENT_TOOL_MS,
  STUCK_EMPTY_TOOL_MS,
  __resetLiveToolStateForTest,
  findStuckEmptyPendingTool,
  isStuckEmptyArgsRecoveryEnabled,
  observeLiveAssistantMessage,
  observeLiveRunStatus,
  observeLiveToolPart,
} from "../fork/apps/app/src/react-app/domains/session/surface/stuck-tool-recovery.ts";

const SESSION_ID = "ses_03961aafdffelEg0CbhYCwGlNl";
const MESSAGE_ID = "msg_fc6e480c4001RfcAFBc0t7rsIr";
const PART_ID = "prt_fc6e8ee5c0012KzoMcVk5woibv";
const T0 = 1_785_748_581_980; // 2026-08-03 17:16:21.980 local epoch ms

function sesSnapshot(statusType: "busy" | "idle") {
  return {
    session: { id: SESSION_ID },
    status: { type: statusType },
    messages: [
      {
        info: {
          id: "msg_fc6e46c74001SjCslIF2AYnV1h",
          role: "user",
          time: { created: T0 - 60_000 },
        },
        parts: [{ type: "text", text: "都想做比如机芯沿导轨上下运动的剖面演示…" }],
      },
      {
        info: {
          id: MESSAGE_ID,
          role: "assistant",
          finish: undefined,
          time: { created: T0 - 290_000 },
        },
        parts: [
          { id: "prt_step", type: "step-start" },
          {
            id: "prt_reason",
            type: "reasoning",
            text: "User quoted my earlier suggestions…",
          },
          { id: "prt_text", type: "text", text: "" },
          {
            id: PART_ID,
            type: "tool",
            tool: "bash",
            state: {
              status: "pending",
              input: {},
              raw: "",
            },
          },
        ],
      },
    ],
  };
}

test("production empty-args recovery is ON", () => {
  __resetLiveToolStateForTest();
  assert.equal(STUCK_EMPTY_ARGS_RECOVERY_ENABLED, true);
  assert.equal(isStuckEmptyArgsRecoveryEnabled(), true);
});

test("ses_03961aaf busy + empty bash: findStuck hits after 10m", () => {
  __resetLiveToolStateForTest();
  observeLiveRunStatus(SESSION_ID, { type: "busy" }, T0);
  observeLiveAssistantMessage(SESSION_ID, MESSAGE_ID, { created: T0 - 1, nowMs: T0 });
  observeLiveToolPart(
    {
      id: PART_ID,
      sessionID: SESSION_ID,
      messageID: MESSAGE_ID,
      type: "tool",
      tool: "bash",
      state: { status: "pending", input: {}, raw: "" },
    },
    { nowMs: T0, source: "sse" },
  );

  assert.equal(
    findStuckEmptyPendingTool(SESSION_ID, {
      nowMs: T0 + STUCK_EMPTY_TOOL_MS + 5_000,
      runBusy: true,
    }),
    null,
    "bash is content-heavy: 90s must NOT be enough",
  );

  const hit = findStuckEmptyPendingTool(SESSION_ID, {
    nowMs: T0 + STUCK_EMPTY_CONTENT_TOOL_MS,
    runBusy: true,
  });
  assert.ok(hit);
  assert.equal(hit.partId, PART_ID);
  assert.equal(hit.tool, "bash");
});

test("ses_03961aaf idle + pending empty bash: orphaned-pending recovers", () => {
  __resetOrphanedRunningToolStateForTest();
  const snapshot = sesSnapshot("idle");

  assert.equal(isExecutionRunningToolStatus("pending"), false);
  assert.equal(snapshotHasOrphanedRunningCandidate(snapshot), false);
  assert.equal(snapshotHasOrphanedPendingEmptyCandidate(snapshot), true);
  assert.equal(
    findOrphanedRunningTool(snapshot, {
      nowMs: T0 + ORPHANED_RUNNING_TOOL_GRACE_MS + 60_000,
      graceMs: ORPHANED_RUNNING_TOOL_GRACE_MS,
    }),
    null,
  );
  assert.equal(
    findStalledBackgroundBashTool(snapshot, {
      nowMs: T0 + 120_000,
      stallMs: 45_000,
      sessionId: SESSION_ID,
    }),
    null,
  );

  assert.equal(
    findOrphanedPendingEmptyTool(snapshot, {
      nowMs: T0 + 1_000,
      graceMs: ORPHANED_RUNNING_TOOL_GRACE_MS,
    }),
    null,
  );
  const hit = findOrphanedPendingEmptyTool(snapshot, {
    nowMs: T0 + 1_000 + ORPHANED_RUNNING_TOOL_GRACE_MS + 1_000,
    graceMs: ORPHANED_RUNNING_TOOL_GRACE_MS,
  });
  assert.ok(hit);
  assert.equal(hit.partId, PART_ID);
  assert.equal(hit.tool, "bash");
});

test("contrast: idle + running task IS still recovered", () => {
  __resetOrphanedRunningToolStateForTest();
  const snapshot = {
    session: { id: SESSION_ID },
    status: { type: "idle" },
    messages: [
      { info: { id: "u", role: "user", time: { created: T0 - 10_000 } }, parts: [] },
      {
        info: { id: MESSAGE_ID, role: "assistant", time: { created: T0 } },
        parts: [
          {
            id: "prt_task",
            type: "tool",
            tool: "task",
            state: {
              status: "running",
              input: { description: "x" },
              time: { start: T0 },
            },
          },
        ],
      },
    ],
  };
  assert.equal(snapshotHasOrphanedRunningCandidate(snapshot), true);
  assert.equal(
    findOrphanedRunningTool(snapshot, {
      nowMs: T0 + 1_000,
      graceMs: ORPHANED_RUNNING_TOOL_GRACE_MS,
    }),
    null,
  );
  const hit = findOrphanedRunningTool(snapshot, {
    nowMs: T0 + 1_000 + ORPHANED_RUNNING_TOOL_GRACE_MS + 1_000,
    graceMs: ORPHANED_RUNNING_TOOL_GRACE_MS,
  });
  assert.ok(hit);
  assert.equal(hit.tool, "task");
});
