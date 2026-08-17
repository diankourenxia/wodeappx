import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  ORPHANED_RUNNING_TOOL_GRACE_MS,
  __resetOrphanedRunningToolStateForTest,
  buildOrphanedPendingEmptyToolAutoContinueSystemContext,
  buildOrphanedRunningToolAutoContinueSystemContext,
  buildStalledBackgroundBashAutoContinueSystemContext,
  findOrphanedPendingEmptyTool,
  findOrphanedRunningTool,
  findStalledBackgroundBashTool,
  isDetachedBackgroundBashCommand,
  isExecutionRunningToolStatus,
  snapshotHasInFlightRunningTool,
  snapshotHasOrphanedPendingEmptyCandidate,
  snapshotHasOrphanedRunningCandidate,
} from "../fork/apps/app/src/react-app/domains/session/surface/orphaned-running-tool-recovery.ts";
import {
  settleInFlightToolPartsForIdleSession,
  summarizeWodeAppToolActivityGroup,
} from "../src/react-app/domains/wodeapp/wodeapp-tool-activity.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

test("execution running status detection", () => {
  assert.equal(isExecutionRunningToolStatus("running"), true);
  assert.equal(isExecutionRunningToolStatus("pending"), false);
  assert.equal(isExecutionRunningToolStatus("completed"), false);
});

test("auto-continue context includes silent marker prefix and tool name", () => {
  const text = buildOrphanedRunningToolAutoContinueSystemContext("task");
  assert.match(text, /系统自动续跑指令/);
  assert.match(text, /task/);
  assert.match(text, /会话已空闲/);

  const pending = buildOrphanedPendingEmptyToolAutoContinueSystemContext("bash");
  assert.match(pending, /系统自动续跑指令/);
  assert.match(pending, /bash/);
  assert.match(pending, /pending/);
});

test("idle + pending empty bash after grace → orphaned pending hit (ses_03961aaf)", () => {
  __resetOrphanedRunningToolStateForTest();
  const sessionId = "ses_03961aafdffelEg0CbhYCwGlNl";
  const messageId = "msg_fc6e480c4001RfcAFBc0t7rsIr";
  const partId = "prt_fc6e8ee5c0012KzoMcVk5woibv";
  const t0 = 1_785_748_581_980;
  const snapshot = {
    session: { id: sessionId },
    status: { type: "idle" },
    messages: [
      {
        info: { id: "msg_user", role: "user", time: { created: t0 - 60_000 } },
        parts: [],
      },
      {
        info: { id: messageId, role: "assistant", finish: undefined, time: { created: t0 - 290_000 } },
        parts: [
          {
            id: partId,
            type: "tool",
            tool: "bash",
            state: { status: "pending", input: {}, raw: "" },
          },
        ],
      },
    ],
  };

  assert.equal(snapshotHasOrphanedRunningCandidate(snapshot), false);
  assert.equal(snapshotHasOrphanedPendingEmptyCandidate(snapshot), true);
  assert.equal(
    findOrphanedRunningTool(snapshot, { nowMs: t0 + 60_000, graceMs: ORPHANED_RUNNING_TOOL_GRACE_MS }),
    null,
  );
  assert.equal(
    findOrphanedPendingEmptyTool(snapshot, { nowMs: t0 + 1_000, graceMs: ORPHANED_RUNNING_TOOL_GRACE_MS }),
    null,
    "within grace must not fire",
  );
  const hit = findOrphanedPendingEmptyTool(snapshot, {
    nowMs: t0 + 1_000 + ORPHANED_RUNNING_TOOL_GRACE_MS + 1_000,
    graceMs: ORPHANED_RUNNING_TOOL_GRACE_MS,
  });
  assert.ok(hit);
  assert.equal(hit.partId, partId);
  assert.equal(hit.tool, "bash");
});

test("idle + pending with growing raw is not an orphaned-pending candidate", () => {
  __resetOrphanedRunningToolStateForTest();
  const snapshot = {
    session: { id: "ses_raw_progress" },
    status: { type: "idle" },
    messages: [
      { info: { id: "u", role: "user" }, parts: [] },
      {
        info: { id: "a", role: "assistant" },
        parts: [
          {
            id: "p",
            type: "tool",
            tool: "write",
            state: {
              status: "pending",
              input: {},
              raw: '{"path":"a.ts","content":"x"',
            },
          },
        ],
      },
    ],
  };
  assert.equal(snapshotHasOrphanedPendingEmptyCandidate(snapshot), false);
  assert.equal(
    findOrphanedPendingEmptyTool(snapshot, { nowMs: 1_000_000, graceMs: 0 }),
    null,
  );
});

test("idle + running task after grace → orphaned hit (ses_053f96d2 repro shape)", () => {
  __resetOrphanedRunningToolStateForTest();
  const sessionId = "ses_053f96d2cffe6Wg1Vrj35Vlavp";
  const messageId = "msg_fac0870d8001z4I5hmRUTeI3By";
  const partId = "prt_fac0882b3001XUNsHr";
  const t0 = 1_785_297_675_404;

  const snapshot = {
    session: { id: sessionId },
    status: { type: "idle" },
    messages: [
      {
        info: { id: "msg_user", role: "user", time: { created: t0 - 10_000 } },
        parts: [],
      },
      {
        info: { id: messageId, role: "assistant", finish: undefined, time: { created: t0 } },
        parts: [
          {
            id: partId,
            type: "tool",
            tool: "task",
            state: {
              status: "running",
              input: { description: "查找AI provider和模型配置", subagent_type: "explore" },
              time: { start: t0 },
              metadata: {
                parentSessionId: sessionId,
                sessionId: "ses_053f75b77ffen96RcKQKsHYdpV",
              },
            },
          },
        ],
      },
    ],
  };

  assert.equal(snapshotHasInFlightRunningTool(snapshot), true);
  assert.equal(snapshotHasOrphanedRunningCandidate(snapshot), true);

  assert.equal(
    findOrphanedRunningTool(snapshot, { nowMs: t0 + 1_000, graceMs: ORPHANED_RUNNING_TOOL_GRACE_MS }),
    null,
    "within grace must not fire",
  );

  const hit = findOrphanedRunningTool(snapshot, {
    nowMs: t0 + ORPHANED_RUNNING_TOOL_GRACE_MS + 1_000,
    graceMs: ORPHANED_RUNNING_TOOL_GRACE_MS,
  });
  assert.ok(hit);
  assert.equal(hit.partId, partId);
  assert.equal(hit.tool, "task");
  assert.equal(hit.childSessionId, "ses_053f75b77ffen96RcKQKsHYdpV");
});

test("busy parent never reports orphaned running tool", () => {
  __resetOrphanedRunningToolStateForTest();
  const snapshot = {
    session: { id: "ses_busy" },
    status: { type: "busy" },
    messages: [
      { info: { id: "u", role: "user" }, parts: [] },
      {
        info: { id: "a", role: "assistant" },
        parts: [
          {
            id: "p",
            type: "tool",
            tool: "task",
            state: { status: "running", time: { start: 1 } },
          },
        ],
      },
    ],
  };
  assert.equal(snapshotHasOrphanedRunningCandidate(snapshot), false);
  assert.equal(
    findOrphanedRunningTool(snapshot, { nowMs: 1_000_000, graceMs: 0 }),
    null,
  );
});

test("detached http.server bash stall is detected even while busy (ses_052fd94a)", () => {
  __resetOrphanedRunningToolStateForTest();
  const t0 = 1_785_316_366_000;
  assert.equal(
    isDetachedBackgroundBashCommand(
      "cd /tmp/demo && nohup python3 -m http.server 8787 >/tmp/log 2>&1 &\ndisown\nsleep 2\ncurl -s -o /dev/null -w '%{http_code}' http://localhost:8787/",
    ),
    true,
  );
  assert.equal(isDetachedBackgroundBashCommand("ls -la"), false);

  const snapshot = {
    session: { id: "ses_052fd94a0ffe5urtfiIInqboVi" },
    status: { type: "busy" },
    messages: [
      { info: { id: "u", role: "user", time: { created: t0 - 5_000 } }, parts: [] },
      {
        info: { id: "a", role: "assistant", time: { created: t0 } },
        parts: [
          {
            id: "prt_bash",
            type: "tool",
            tool: "bash",
            state: {
              status: "running",
              input: {
                command:
                  "lsof -ti:8787 | xargs kill -9 2>/dev/null; cd /tmp/demo && nohup python3 -m http.server 8787 >/tmp/log 2>&1 &\ndisown\nsleep 2\ncurl http://localhost:8787/",
              },
              time: { start: t0 },
              metadata: { output: "index: 200\n" },
            },
          },
        ],
      },
    ],
  };

  assert.equal(
    findStalledBackgroundBashTool(snapshot, { nowMs: t0 + 10_000, stallMs: 45_000 }),
    null,
    "within stall window must not fire",
  );
  const hit = findStalledBackgroundBashTool(snapshot, {
    nowMs: t0 + 50_000,
    stallMs: 45_000,
  });
  assert.ok(hit);
  assert.equal(hit.tool, "bash");
  assert.equal(hit.partId, "prt_bash");
  assert.match(buildStalledBackgroundBashAutoContinueSystemContext(), /http\.server/);

  const afterUserMovedOn = {
    ...snapshot,
    messages: [
      ...snapshot.messages,
      {
        info: {
          id: "u_next",
          role: "user",
          time: { created: t0 + 55_000 },
        },
        parts: [],
      },
      {
        info: {
          id: "a_next",
          role: "assistant",
          time: { created: t0 + 56_000 },
        },
        parts: [],
      },
    ],
  };
  assert.equal(
    findStalledBackgroundBashTool(afterUserMovedOn, {
      nowMs: t0 + 120_000,
      stallMs: 45_000,
    }),
    null,
    "historical detached servers must not trigger recovery after a later user turn",
  );

  const idleCurrentTurn = {
    ...snapshot,
    status: { type: "idle" },
  };
  assert.equal(
    findOrphanedRunningTool(idleCurrentTurn, {
      nowMs: t0 + 120_000,
      graceMs: 0,
      parentIdle: true,
    }),
    null,
    "detached background bash is owned by its dedicated stalled recovery path",
  );
});

test("UI: idle session settles in-flight task label away from 正在运行子代理", () => {
  const part = {
    type: "dynamic-tool" as const,
    toolName: "task",
    toolCallId: "call_task",
    state: "input-available" as const,
    input: { description: "查找AI provider和模型配置" },
  };
  const live = summarizeWodeAppToolActivityGroup([part], { sessionLive: true });
  assert.equal(live.running, true);
  assert.match(live.summary, /正在运行子代理/);

  const idle = summarizeWodeAppToolActivityGroup([part], { sessionLive: false });
  assert.equal(idle.running, false);
  assert.equal(idle.failed, 1);
  assert.doesNotMatch(idle.summary, /正在运行子代理/);
  assert.match(idle.summary, /未完成/);

  const mixed = summarizeWodeAppToolActivityGroup(
    [
      {
        type: "dynamic-tool" as const,
        toolName: "todowrite",
        toolCallId: "call_todo",
        state: "output-available" as const,
        input: { todos: [] },
      },
      part,
    ],
    { sessionLive: false },
  );
  assert.equal(mixed.running, false);
  assert.doesNotMatch(mixed.summary, /正在运行子代理/);
  assert.match(mixed.summary, /已更新计划/);
  assert.match(mixed.summary, /未完成/);

  const settled = settleInFlightToolPartsForIdleSession([part], false);
  assert.equal(settled[0]?.state, "output-error");
});

test("integration: session-surface confirms stalled background bash then silently continues", async () => {
  const surface = await readFile(
    path.join(root, "fork/apps/app/src/react-app/domains/session/surface/session-surface.tsx"),
    "utf8",
  );
  assert.match(surface, /orphaned-running-tool-recovery/);
  assert.match(surface, /findOrphanedRunningTool/);
  assert.match(surface, /findOrphanedPendingEmptyTool/);
  assert.match(surface, /snapshotHasInFlightRunningTool/);
  assert.match(surface, /buildOrphanedRunningToolAutoContinueSystemContext/);
  assert.match(surface, /buildOrphanedPendingEmptyToolAutoContinueSystemContext/);
  assert.match(surface, /buildStalledBackgroundBashAutoContinueSystemContext/);
  assert.doesNotMatch(surface, /检测到后台服务已启动，已自动继续任务/);
  assert.doesNotMatch(surface, /后台服务命令卡住了/);

  const recoveryStart = surface.indexOf("// Detached `http.server");
  const recoveryEnd = surface.indexOf("props.onDraftChange", recoveryStart);
  assert.ok(recoveryStart >= 0 && recoveryEnd > recoveryStart);
  const recoveryBlock = surface.slice(recoveryStart, recoveryEnd);
  assert.match(recoveryBlock, /sendSilentAutoContinue/);
  assert.match(
    recoveryBlock,
    /const fresh = await snapshotQueryRef\.current\.refetch\(\);[\s\S]*findStalledBackgroundBashTool\(fresh\.data/,
    "stalled background recovery must reconfirm against a fresh server snapshot before continuing",
  );
  assert.doesNotMatch(recoveryBlock, /offerManualRecovery/);
});

test("integration patch materializes the orphaned running recovery module", async () => {
  const script = await readFile(
    path.join(root, "../../scripts/apply-openwork-integration.mjs"),
    "utf8",
  );
  assert.match(
    script,
    /fork\/apps\/app\/src\/react-app\/domains\/session\/surface\/orphaned-running-tool-recovery\.ts/,
  );
});
