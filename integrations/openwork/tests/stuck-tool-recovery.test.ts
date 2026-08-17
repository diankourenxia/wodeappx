import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  STUCK_EMPTY_ARGS_RECOVERY_ENABLED,
  STUCK_EMPTY_CONTENT_TOOL_MS,
  STUCK_EMPTY_TOOL_MS,
  STUCK_TOOL_AUTO_CONTINUE_MARKER,
  __getLiveToolPartForTest,
  __resetLiveToolStateForTest,
  __setStuckEmptyArgsRecoveryEnabledForTest,
  buildStuckToolAutoContinueSystemContext,
  confirmStuckEmptyPendingTool,
  findStuckEmptyPendingTool,
  isContentHeavyTool,
  isStuckEmptyArgsRecoveryEnabled,
  isStuckToolAutoContinueText,
  observeLiveAssistantMessage,
  observeLiveAssistantVisibleOutput,
  observeLiveRunStatus,
  observeLiveToolPart,
  seedLiveToolStateFromSnapshot,
  snapshotConfirmsEmptyPendingTool,
  stuckEmptyBudgetMs,
} from "../fork/apps/app/src/react-app/domains/session/surface/stuck-tool-recovery.ts";

/** Production keeps empty-args recovery on; unit tests may still toggle via helper. */
function enableStuckEmptyRecoveryForTest(): void {
  __setStuckEmptyArgsRecoveryEnabledForTest(true);
}

test("production: empty-args stuck abort is enabled", () => {
  __resetLiveToolStateForTest();
  assert.equal(STUCK_EMPTY_ARGS_RECOVERY_ENABLED, true);
  assert.equal(isStuckEmptyArgsRecoveryEnabled(), true);
});

test("stuck tool auto-continue marker is detected", () => {
  assert.equal(isStuckToolAutoContinueText(STUCK_TOOL_AUTO_CONTINUE_MARKER), true);
  assert.equal(
    isStuckToolAutoContinueText(`${STUCK_TOOL_AUTO_CONTINUE_MARKER}\nextra`),
    false,
  );
  assert.equal(isStuckToolAutoContinueText("请继续保存商品"), false);
  assert.equal(isStuckToolAutoContinueText(""), false);
});

test("stuck tool auto-continue system context keeps the retry instruction", () => {
  const product = buildStuckToolAutoContinueSystemContext("wodeapp_product_save");
  assert.match(product, /wodeapp_product_save/);
  assert.match(product, /流式参数未完成/);
  assert.match(product, /selectedImageIds/);
  assert.equal(product.startsWith(STUCK_TOOL_AUTO_CONTINUE_MARKER), true);

  const bash = buildStuckToolAutoContinueSystemContext("bash");
  assert.match(bash, /上一次工具「bash」因流式参数未完成而中断/);
  assert.match(bash, /重新发起必要的工具调用/);
});

test("integration patch materializes the stuck tool recovery module", async () => {
  const patcher = await readFile(
    new URL("../../../scripts/apply-openwork-integration.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    patcher,
    /fork\/apps\/app\/src\/react-app\/domains\/session\/surface\/stuck-tool-recovery\.ts/,
  );
});

test("architecture: SSE observes tools before UI deferral; status retires idle candidates", async () => {
  const sync = await readFile(
    new URL(
      "../fork/apps/app/src/react-app/domains/session/sync/session-sync.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const partUpdatedIdx = sync.indexOf('if (event.type === "message.part.updated")');
  assert.ok(partUpdatedIdx > 0);
  const slice = sync.slice(partUpdatedIdx, partUpdatedIdx + 2200);
  assert.match(slice, /observeLiveToolPart/);
  assert.match(slice, /observeLiveAssistantVisibleOutput/);
  const observeAt = slice.indexOf("observeLiveToolPart");
  const mappedAt = slice.indexOf("toUIParts");
  assert.ok(observeAt >= 0 && mappedAt > observeAt);

  assert.match(sync, /observeLiveRunStatus\(props\.sessionID, props\.status\)/);
  assert.match(sync, /observeLiveRunStatus\(props\.sessionID, \{ type: "idle" \}\)/);
});

test("architecture: snapshot watchdog must not depend on whole snapshotQuery object", async () => {
  const surface = await readFile(
    new URL(
      "../fork/apps/app/src/react-app/domains/session/surface/session-surface.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(surface, /snapshotQueryRef/);
  const watchdog = surface.slice(
    surface.indexOf("refreshActiveRun"),
    surface.indexOf("const status = useMemo"),
  );
  assert.match(watchdog, /snapshotQueryRef\.current/);
  assert.equal(
    /,\s*snapshotQuery\s*,/.test(watchdog) || /snapshotQuery\s*\]/.test(watchdog),
    false,
  );
});

test("required: stale snapshot empty bash + live writing later assistant → no trigger", () => {
  __resetLiveToolStateForTest();
  enableStuckEmptyRecoveryForTest();
  const sessionId = "ses_repro_stale";
  const oldMsg = "msg_old_bash";
  const newMsg = "msg_writing_text";
  const t0 = 1_700_000_000_000;

  seedLiveToolStateFromSnapshot(sessionId, {
    status: { type: "busy" },
    messages: [
      {
        info: { id: oldMsg, role: "assistant", time: { created: t0 } },
        parts: [
          {
            id: "prt_old_bash",
            type: "tool",
            tool: "bash",
            state: { status: "pending", input: {} },
          },
        ],
      },
    ],
  }, t0);

  observeLiveToolPart({
    id: "prt_old_bash",
    sessionID: sessionId,
    messageID: oldMsg,
    type: "tool",
    tool: "bash",
    state: { status: "completed", input: { command: "echo ok" } },
  }, { nowMs: t0 + 2, source: "sse" });
  observeLiveAssistantMessage(sessionId, newMsg, { created: t0 + 60_000, nowMs: t0 + 60_000 });

  seedLiveToolStateFromSnapshot(sessionId, {
    status: { type: "busy" },
    messages: [
      {
        info: { id: oldMsg, role: "assistant", time: { created: t0 } },
        parts: [
          {
            id: "prt_old_bash",
            type: "tool",
            tool: "bash",
            state: { status: "pending", input: {} },
          },
        ],
      },
    ],
  }, t0 + STUCK_EMPTY_TOOL_MS + 5_000);

  assert.equal(
    findStuckEmptyPendingTool(sessionId, { nowMs: t0 + STUCK_EMPTY_TOOL_MS + 5_000, runBusy: true }),
    null,
  );
});

test("required: same latest turn empty pending sustained ≥90s → trigger", () => {
  __resetLiveToolStateForTest();
  enableStuckEmptyRecoveryForTest();
  const sessionId = "ses_repro_real_stuck";
  const messageId = "msg_live";
  const partId = "prt_stuck";
  const t0 = 1_700_000_100_000;

  observeLiveRunStatus(sessionId, { type: "busy" }, t0);
  observeLiveAssistantMessage(sessionId, messageId, { created: t0, nowMs: t0 });
  observeLiveToolPart({
    id: partId,
    sessionID: sessionId,
    messageID: messageId,
    type: "tool",
    tool: "read",
    state: { status: "pending", input: {} },
  }, { nowMs: t0 + 1_000, source: "sse" });

  assert.equal(
    findStuckEmptyPendingTool(sessionId, { nowMs: t0 + 1_000 + 5_000, runBusy: true }),
    null,
  );

  const hit = findStuckEmptyPendingTool(sessionId, {
    nowMs: t0 + 1_000 + STUCK_EMPTY_TOOL_MS,
    runBusy: true,
  });
  assert.ok(hit);
  assert.equal(hit.tool, "read");
  assert.equal(
    snapshotConfirmsEmptyPendingTool({
      status: { type: "busy" },
      messages: [
        {
          info: { id: messageId, role: "assistant", time: { created: t0 } },
          parts: [
            {
              id: partId,
              type: "tool",
              tool: "read",
              state: { status: "pending", input: {} },
            },
          ],
        },
      ],
    }, hit),
    true,
  );
});

test("required: empty only 2ms then filled → stale snapshot must not trigger", () => {
  __resetLiveToolStateForTest();
  enableStuckEmptyRecoveryForTest();
  const sessionId = "ses_repro_2ms";
  const messageId = "msg_bash_2ms";
  const partId = "prt_fa295d860001";
  const messageCreated = Date.parse("2026-07-27T15:59:08.418+08:00");
  const emptyAt = Date.parse("2026-07-27T15:59:17.088+08:00");
  const filledAt = Date.parse("2026-07-27T15:59:17.090+08:00");
  const cancelAt = Date.parse("2026-07-27T16:00:40.852+08:00");
  assert.equal(filledAt - emptyAt, 2);

  observeLiveRunStatus(sessionId, { type: "busy" }, messageCreated);
  observeLiveAssistantMessage(sessionId, messageId, { created: messageCreated, nowMs: messageCreated });
  observeLiveToolPart({
    id: partId,
    sessionID: sessionId,
    messageID: messageId,
    type: "tool",
    tool: "bash",
    state: { status: "pending", input: {} },
  }, { nowMs: emptyAt, source: "sse" });
  observeLiveToolPart({
    id: partId,
    sessionID: sessionId,
    messageID: messageId,
    type: "tool",
    tool: "bash",
    state: {
      status: "completed",
      input: { command: "find …/session-surface.tsx" },
    },
  }, { nowMs: filledAt, source: "sse" });

  assert.equal(__getLiveToolPartForTest(sessionId, messageId, partId)?.emptyPending, false);

  seedLiveToolStateFromSnapshot(sessionId, {
    status: { type: "busy" },
    messages: [
      {
        info: { id: messageId, role: "assistant", time: { created: messageCreated } },
        parts: [
          {
            id: partId,
            type: "tool",
            tool: "bash",
            state: { status: "pending", input: {} },
          },
        ],
      },
    ],
  }, cancelAt);

  assert.equal(findStuckEmptyPendingTool(sessionId, { nowMs: cancelAt, runBusy: true }), null);
  assert.equal(
    confirmStuckEmptyPendingTool(
      { sessionId, messageId, partId },
      { nowMs: cancelAt, runBusy: true },
    ),
    null,
  );
});

test("p1: running + {} zero-arg tool must not trigger after 90s", () => {
  __resetLiveToolStateForTest();
  enableStuckEmptyRecoveryForTest();
  const sessionId = "ses_zero_arg";
  const messageId = "msg_zero";
  const partId = "prt_zero";
  const t0 = 1_700_000_200_000;

  observeLiveRunStatus(sessionId, { type: "busy" }, t0);
  observeLiveAssistantMessage(sessionId, messageId, { created: t0, nowMs: t0 });
  observeLiveToolPart({
    id: partId,
    sessionID: sessionId,
    messageID: messageId,
    type: "tool",
    tool: "noop_tool",
    state: { status: "running", input: {} },
  }, { nowMs: t0 + 1_000, source: "sse" });

  assert.equal(
    findStuckEmptyPendingTool(sessionId, { nowMs: t0 + 1_000 + STUCK_EMPTY_TOOL_MS, runBusy: true }),
    null,
  );
  assert.equal(
    snapshotConfirmsEmptyPendingTool({
      status: { type: "busy" },
      messages: [
        {
          info: { id: messageId, role: "assistant", time: { created: t0 } },
          parts: [
            {
              id: partId,
              type: "tool",
              tool: "noop_tool",
              state: { status: "running", input: {} },
            },
          ],
        },
      ],
    }, { messageId, partId }),
    false,
  );
});

test("p1: idle snapshot pending does not arm; next busy before new assistant does not kill", () => {
  __resetLiveToolStateForTest();
  enableStuckEmptyRecoveryForTest();
  const sessionId = "ses_idle_seed";
  const oldMsg = "msg_hist_pending";
  const t0 = 1_700_000_300_000;

  // Idle snapshot with historical pending must not start firstEmptyAt.
  seedLiveToolStateFromSnapshot(sessionId, {
    status: { type: "idle" },
    messages: [
      {
        info: { id: oldMsg, role: "assistant", time: { created: t0 } },
        parts: [
          {
            id: "prt_hist",
            type: "tool",
            tool: "bash",
            state: { status: "pending", input: {} },
          },
        ],
      },
    ],
  }, t0);
  assert.equal(__getLiveToolPartForTest(sessionId, oldMsg, "prt_hist")?.firstEmptyAt ?? null, null);

  // Park 90s, then a new busy run starts but no new assistant yet — snapshot
  // still must not arm (SSE-only arming).
  observeLiveRunStatus(sessionId, { type: "busy" }, t0 + STUCK_EMPTY_TOOL_MS + 1_000);
  seedLiveToolStateFromSnapshot(sessionId, {
    status: { type: "busy" },
    messages: [
      {
        info: { id: oldMsg, role: "assistant", time: { created: t0 } },
        parts: [
          {
            id: "prt_hist",
            type: "tool",
            tool: "bash",
            state: { status: "pending", input: {} },
          },
        ],
      },
    ],
  }, t0 + STUCK_EMPTY_TOOL_MS + 1_000);

  assert.equal(__getLiveToolPartForTest(sessionId, oldMsg, "prt_hist")?.firstEmptyAt ?? null, null);
  assert.equal(
    findStuckEmptyPendingTool(sessionId, {
      nowMs: t0 + STUCK_EMPTY_TOOL_MS + 1_000 + 5_000,
      runBusy: true,
    }),
    null,
  );

  observeLiveRunStatus(sessionId, { type: "idle" }, t0 + STUCK_EMPTY_TOOL_MS + 10_000);
  assert.equal(__getLiveToolPartForTest(sessionId, oldMsg, "prt_hist")?.emptyPending ?? false, false);
});

test("p1: first busy snapshot with historical pending + newer user must not arm", () => {
  __resetLiveToolStateForTest();
  enableStuckEmptyRecoveryForTest();
  const sessionId = "ses_open_busy_hist";
  const oldMsg = "msg_old_pending";
  const userMsg = "msg_new_user";
  const t0 = 1_700_000_500_000;

  seedLiveToolStateFromSnapshot(sessionId, {
    status: { type: "busy" },
    messages: [
      {
        info: { id: oldMsg, role: "assistant", time: { created: t0 } },
        parts: [
          {
            id: "prt_old",
            type: "tool",
            tool: "bash",
            state: { status: "pending", input: {} },
          },
        ],
      },
      {
        info: { id: userMsg, role: "user", time: { created: t0 + 10_000 } },
        parts: [{ type: "text", text: "继续" }],
      },
    ],
  }, t0 + 10_000);

  assert.equal(__getLiveToolPartForTest(sessionId, oldMsg, "prt_old")?.firstEmptyAt ?? null, null);
  assert.equal(
    findStuckEmptyPendingTool(sessionId, {
      nowMs: t0 + 10_000 + STUCK_EMPTY_TOOL_MS,
      runBusy: true,
    }),
    null,
  );
  assert.equal(
    snapshotConfirmsEmptyPendingTool({
      status: { type: "busy" },
      messages: [
        {
          info: { id: oldMsg, role: "assistant", time: { created: t0 } },
          parts: [
            {
              id: "prt_old",
              type: "tool",
              tool: "bash",
              state: { status: "pending", input: {} },
            },
          ],
        },
        {
          info: { id: userMsg, role: "user", time: { created: t0 + 10_000 } },
          parts: [{ type: "text", text: "继续" }],
        },
      ],
    }, { messageId: oldMsg, partId: "prt_old" }),
    false,
  );
});

test("p2: same-millisecond visible prose blocks abort (>= fail-safe)", () => {
  __resetLiveToolStateForTest();
  enableStuckEmptyRecoveryForTest();
  const sessionId = "ses_same_ms";
  const messageId = "msg_same_ms";
  const partId = "prt_empty";
  const t0 = 1_700_000_600_000;
  const sameMs = t0 + 1_000;

  observeLiveRunStatus(sessionId, { type: "busy" }, t0);
  observeLiveAssistantMessage(sessionId, messageId, { created: t0, nowMs: t0 });
  observeLiveToolPart({
    id: partId,
    sessionID: sessionId,
    messageID: messageId,
    type: "tool",
    tool: "bash",
    state: { status: "pending", input: {} },
  }, { nowMs: sameMs, source: "sse" });
  observeLiveAssistantVisibleOutput(sessionId, messageId, { nowMs: sameMs });

  assert.equal(
    findStuckEmptyPendingTool(sessionId, {
      nowMs: sameMs + STUCK_EMPTY_TOOL_MS,
      runBusy: true,
    }),
    null,
  );
});

test("p2: visible prose after firstEmptyAt on same assistant blocks abort", () => {
  __resetLiveToolStateForTest();
  enableStuckEmptyRecoveryForTest();
  const sessionId = "ses_prose_veto";
  const messageId = "msg_same";
  const partId = "prt_empty";
  const t0 = 1_700_000_400_000;

  observeLiveRunStatus(sessionId, { type: "busy" }, t0);
  observeLiveAssistantMessage(sessionId, messageId, { created: t0, nowMs: t0 });
  observeLiveToolPart({
    id: partId,
    sessionID: sessionId,
    messageID: messageId,
    type: "tool",
    tool: "bash",
    state: { status: "pending", input: {} },
  }, { nowMs: t0 + 1_000, source: "sse" });

  // Model keeps writing visible prose on the same turn after empty pending started.
  observeLiveAssistantVisibleOutput(sessionId, messageId, { nowMs: t0 + 5_000 });

  assert.equal(
    findStuckEmptyPendingTool(sessionId, {
      nowMs: t0 + 1_000 + STUCK_EMPTY_TOOL_MS,
      runBusy: true,
    }),
    null,
  );
});

test("p1: production recover path — fresh snapshot must keep SSE-armed timer", () => {
  __resetLiveToolStateForTest();
  enableStuckEmptyRecoveryForTest();
  const sessionId = "ses_prod_refetch";
  const messageId = "msg_live";
  const partId = "prt_empty_bash";
  const t0 = 1_700_000_700_000;
  const armAt = t0 + 2;
  const hitAt = armAt + STUCK_EMPTY_CONTENT_TOOL_MS;
  const freshSnap = {
    status: { type: "busy" as const },
    messages: [
      {
        info: { id: "msg_user", role: "user", time: { created: t0 } },
        parts: [{ type: "text", text: "跑一下" }],
      },
      {
        info: { id: messageId, role: "assistant", time: { created: t0 + 1 } },
        parts: [
          {
            id: partId,
            type: "tool",
            tool: "bash",
            state: { status: "pending", input: {} },
          },
        ],
      },
    ],
  };

  observeLiveRunStatus(sessionId, { type: "busy" }, t0);
  observeLiveAssistantMessage(sessionId, messageId, { created: t0 + 1, nowMs: t0 + 1 });
  observeLiveToolPart({
    id: partId,
    sessionID: sessionId,
    messageID: messageId,
    type: "tool",
    tool: "bash",
    state: { status: "pending", input: {} },
  }, { nowMs: armAt, source: "sse" });

  // Mid-window periodic snapshot must not wipe the SSE timer.
  seedLiveToolStateFromSnapshot(sessionId, freshSnap, armAt + 30_000);
  assert.equal(__getLiveToolPartForTest(sessionId, messageId, partId)?.firstEmptyAt, armAt);
  assert.equal(__getLiveToolPartForTest(sessionId, messageId, partId)?.emptyPending, true);

  const hitBeforeRefetch = findStuckEmptyPendingTool(sessionId, { nowMs: hitAt, runBusy: true });
  assert.equal(hitBeforeRefetch?.partId, partId);
  assert.equal(hitBeforeRefetch?.firstEmptyAt, armAt);

  const liveConfirmedBeforeSeed = confirmStuckEmptyPendingTool(hitBeforeRefetch!, {
    nowMs: hitAt,
    runBusy: true,
  });
  assert.ok(liveConfirmedBeforeSeed);
  assert.equal(snapshotConfirmsEmptyPendingTool(freshSnap, hitBeforeRefetch!), true);

  // Production order: refetch → seed → confirm (must still pass).
  seedLiveToolStateFromSnapshot(sessionId, freshSnap, hitAt + 50);
  const liveConfirmedAfterFreshSeed = confirmStuckEmptyPendingTool(hitBeforeRefetch!, {
    nowMs: hitAt + 50,
    runBusy: true,
  });
  assert.ok(liveConfirmedAfterFreshSeed);
  assert.equal(liveConfirmedAfterFreshSeed.firstEmptyAt, armAt);
  assert.equal(snapshotConfirmsEmptyPendingTool(freshSnap, hitBeforeRefetch!), true);

  // Filled snapshot must settle and block abort.
  seedLiveToolStateFromSnapshot(sessionId, {
    status: { type: "busy" },
    messages: [
      {
        info: { id: "msg_user", role: "user", time: { created: t0 } },
        parts: [{ type: "text", text: "跑一下" }],
      },
      {
        info: { id: messageId, role: "assistant", time: { created: t0 + 1 } },
        parts: [
          {
            id: partId,
            type: "tool",
            tool: "bash",
            state: { status: "running", input: { command: "ls" } },
          },
        ],
      },
    ],
  }, hitAt + 100);
  assert.equal(__getLiveToolPartForTest(sessionId, messageId, partId)?.emptyPending, false);
  assert.equal(__getLiveToolPartForTest(sessionId, messageId, partId)?.firstEmptyAt, null);
  assert.equal(
    confirmStuckEmptyPendingTool(hitBeforeRefetch!, { nowMs: hitAt + 100, runBusy: true }),
    null,
  );
});

test("content-heavy write uses 10m empty budget, not 90s", () => {
  assert.equal(isContentHeavyTool("write"), true);
  assert.equal(isContentHeavyTool("bash"), true);
  assert.equal(isContentHeavyTool("tool_search"), false);
  assert.equal(stuckEmptyBudgetMs("write"), STUCK_EMPTY_CONTENT_TOOL_MS);
  assert.equal(stuckEmptyBudgetMs("bash"), STUCK_EMPTY_CONTENT_TOOL_MS);
  assert.equal(stuckEmptyBudgetMs("tool_search"), STUCK_EMPTY_TOOL_MS);

  __resetLiveToolStateForTest();
  enableStuckEmptyRecoveryForTest();
  const sessionId = "ses_write_budget";
  const messageId = "msg_write";
  const partId = "prt_write";
  const t0 = 1_700_000_800_000;

  observeLiveRunStatus(sessionId, { type: "busy" }, t0);
  observeLiveAssistantMessage(sessionId, messageId, { created: t0 + 1, nowMs: t0 + 1 });
  observeLiveToolPart({
    id: partId,
    sessionID: sessionId,
    messageID: messageId,
    type: "tool",
    tool: "write",
    state: { status: "pending", input: {}, raw: "" },
  }, { nowMs: t0 + 2, source: "sse" });

  // Same age that used to kill bash/write alike — write must survive.
  assert.equal(
    findStuckEmptyPendingTool(sessionId, {
      nowMs: t0 + 2 + STUCK_EMPTY_TOOL_MS + 5_000,
      runBusy: true,
    }),
    null,
  );

  assert.equal(
    findStuckEmptyPendingTool(sessionId, {
      nowMs: t0 + 2 + STUCK_EMPTY_CONTENT_TOOL_MS,
      runBusy: true,
    })?.partId,
    partId,
  );
});

test("content-heavy bash heredoc also uses 10m empty budget", () => {
  __resetLiveToolStateForTest();
  enableStuckEmptyRecoveryForTest();
  const sessionId = "ses_bash_budget";
  const messageId = "msg_bash";
  const partId = "prt_bash";
  const t0 = 1_700_000_810_000;

  observeLiveRunStatus(sessionId, { type: "busy" }, t0);
  observeLiveAssistantMessage(sessionId, messageId, { created: t0 + 1, nowMs: t0 + 1 });
  observeLiveToolPart({
    id: partId,
    sessionID: sessionId,
    messageID: messageId,
    type: "tool",
    tool: "bash",
    state: { status: "pending", input: {}, raw: "" },
  }, { nowMs: t0 + 2, source: "sse" });

  assert.equal(
    findStuckEmptyPendingTool(sessionId, {
      nowMs: t0 + 2 + STUCK_EMPTY_TOOL_MS + 5_000,
      runBusy: true,
    }),
    null,
  );
  assert.equal(
    findStuckEmptyPendingTool(sessionId, {
      nowMs: t0 + 2 + STUCK_EMPTY_CONTENT_TOOL_MS,
      runBusy: true,
    })?.tool,
    "bash",
  );
});

test("growing state.raw resets empty-pending age for write", () => {
  __resetLiveToolStateForTest();
  enableStuckEmptyRecoveryForTest();
  const sessionId = "ses_write_raw_progress";
  const messageId = "msg_write";
  const partId = "prt_write";
  const t0 = 1_700_000_900_000;
  const armAt = t0 + 2;

  observeLiveRunStatus(sessionId, { type: "busy" }, t0);
  observeLiveAssistantMessage(sessionId, messageId, { created: t0 + 1, nowMs: t0 + 1 });
  observeLiveToolPart({
    id: partId,
    sessionID: sessionId,
    messageID: messageId,
    type: "tool",
    tool: "write",
    state: { status: "pending", input: {}, raw: "" },
  }, { nowMs: armAt, source: "sse" });

  const progressAt = armAt + STUCK_EMPTY_TOOL_MS - 1_000;
  observeLiveToolPart({
    id: partId,
    sessionID: sessionId,
    messageID: messageId,
    type: "tool",
    tool: "write",
    state: { status: "pending", input: {}, raw: '{"path":"a.html","content":"<!DOCTYPE' },
  }, { nowMs: progressAt, source: "sse" });

  assert.equal(__getLiveToolPartForTest(sessionId, messageId, partId)?.firstEmptyAt, progressAt);
  assert.equal(
    findStuckEmptyPendingTool(sessionId, {
      nowMs: progressAt + STUCK_EMPTY_TOOL_MS + 1_000,
      runBusy: true,
    }),
    null,
  );
  assert.equal(
    findStuckEmptyPendingTool(sessionId, {
      nowMs: progressAt + STUCK_EMPTY_CONTENT_TOOL_MS,
      runBusy: true,
    })?.partId,
    partId,
  );
});
