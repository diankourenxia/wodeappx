/**
 * ses_033f064afffe* shape: busy + trailing assistant empty shell (parts=0).
 *
 * Existing recoveries do NOT cover this while status stays busy:
 * - empty-visible requires idle
 * - stuck-empty-args requires a pending/empty tool part
 * - orphaned-running requires idle + running tool
 *
 * This test locks the gap so a busy-empty-shell watchdog can be added later.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { findEmptyVisibleCompletedAssistantTurn } from "../fork/apps/app/src/react-app/domains/session/surface/empty-visible-reply-recovery.ts";
import {
  findOrphanedPendingEmptyTool,
  findOrphanedRunningTool,
} from "../fork/apps/app/src/react-app/domains/session/surface/orphaned-running-tool-recovery.ts";
import {
  __resetLiveToolStateForTest,
  findStuckEmptyPendingTool,
  observeLiveRunStatus,
} from "../fork/apps/app/src/react-app/domains/session/surface/stuck-tool-recovery.ts";

const SESSION_ID = "ses_033f064afffeUf08hrArJ2xMu5";
const EMPTY_MSG = "msg_fcc11ec14001gQlps0dimy8waz";
const T0 = 1_785_835_154_452;

function busyEmptyShellSnapshot(statusType: "busy" | "idle") {
  return {
    session: { id: SESSION_ID },
    status: { type: statusType },
    messages: [
      {
        info: {
          id: "msg_user",
          role: "user",
          time: { created: T0 - 60_000 },
        },
        parts: [{ type: "text", text: "这边的数量好像一直保持在 170，是什么原因" }],
      },
      {
        info: {
          id: "msg_prev",
          role: "assistant",
          finish: "tool-calls",
          time: { created: T0 - 10_000, completed: T0 - 1_000 },
        },
        parts: [
          {
            id: "prt_bash",
            type: "tool",
            tool: "bash",
            state: { status: "completed", input: { command: "sed -n 1,2p file" }, raw: "ok" },
          },
        ],
      },
      {
        info: {
          id: EMPTY_MSG,
          role: "assistant",
          finish: undefined,
          time: { created: T0 },
        },
        parts: [],
      },
    ],
  };
}

test("busy + empty shell is NOT recovered by empty-visible (requires idle)", () => {
  const hit = findEmptyVisibleCompletedAssistantTurn(busyEmptyShellSnapshot("busy"));
  assert.equal(hit, null);
});

test("idle + empty shell IS recovered by empty-visible (post-settle continue path)", () => {
  const hit = findEmptyVisibleCompletedAssistantTurn(busyEmptyShellSnapshot("idle"));
  assert.ok(hit);
  assert.equal(hit?.messageId, EMPTY_MSG);
});

test("busy + empty shell is NOT stuck-empty-args (no pending tool)", () => {
  __resetLiveToolStateForTest();
  observeLiveRunStatus(SESSION_ID, { type: "busy" });
  const stuck = findStuckEmptyPendingTool(SESSION_ID, { runBusy: true });
  assert.equal(stuck, null);
});

test("busy + empty shell is NOT orphaned-running/pending", () => {
  const snapshot = busyEmptyShellSnapshot("busy");
  assert.equal(
    findOrphanedRunningTool(snapshot, { parentIdle: false, sessionId: SESSION_ID }),
    null,
  );
  assert.equal(
    findOrphanedPendingEmptyTool(snapshot, { parentIdle: false, sessionId: SESSION_ID }),
    null,
  );
});

test("detector helper: busy empty shell age crosses hang threshold", () => {
  const snapshot = busyEmptyShellSnapshot("busy");
  const last = snapshot.messages[snapshot.messages.length - 1];
  const empty =
    last.info.role === "assistant" &&
    (last.parts?.length ?? 0) === 0 &&
    !last.info.time?.completed;
  const busy = snapshot.status.type === "busy";
  const ageMs = 90_000;
  assert.equal(empty && busy && ageMs >= 45_000, true);
});
