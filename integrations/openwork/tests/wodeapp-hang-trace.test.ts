import { afterEach, describe, expect, test } from "bun:test";
import {
  __pushHangTraceEventForTest,
  __resetHangTraceForTest,
  beginHangTurnTrace,
  exportHangTraceJson,
  getHangTraceEvents,
  hangTraceLog,
  HANG_TRACE_LONG_EMPTY_MS,
  HANG_TRACE_RETENTION_MS,
  noteHangFirstPart,
  observeHangEmptyShell,
  pruneHangTraceRetention,
} from "../wodeapp/wodeapp-hang-trace";

afterEach(() => {
  __resetHangTraceForTest();
});

describe("wodeapp-hang-trace", () => {
  test("beginHangTurnTrace stamps turn.start and reuses id on later logs", () => {
    const id = beginHangTurnTrace("ses_a", { kind: "user_send" });
    hangTraceLog({
      layer: "ui",
      event: "prompt.sent",
      sessionId: "ses_a",
      fields: { textChars: 3 },
    });
    const events = getHangTraceEvents({ sessionId: "ses_a" });
    expect(events.some((row) => row.event === "turn.start" && row.turnTraceId === id)).toBe(true);
    expect(events.some((row) => row.event === "prompt.sent" && row.turnTraceId === id)).toBe(true);
  });

  test("empty shell ticks then long, first part clears arm with ttftMs", () => {
    observeHangEmptyShell({
      sessionId: "ses_empty",
      statusType: "busy",
      assistantMessageId: "msg_1",
      partsCount: 0,
      completed: false,
      hasError: false,
      busySessionCount: 2,
    });
    const arm = getHangTraceEvents({ sessionId: "ses_empty" });
    expect(arm.some((row) => row.event === "assistant.shell_created")).toBe(true);

    observeHangEmptyShell({
      sessionId: "ses_empty",
      statusType: "busy",
      assistantMessageId: "msg_1",
      partsCount: 0,
      completed: false,
      hasError: false,
      busySessionCount: 2,
    });

    noteHangFirstPart({
      sessionId: "ses_empty",
      messageId: "msg_1",
      partType: "text",
    });
    const after = getHangTraceEvents({ sessionId: "ses_empty" });
    const first = after.find((row) => row.event === "assistant.first_part");
    expect(first?.fields.partType).toBe("text");
    expect(typeof first?.fields.ttftMs === "number" || first?.fields.ttftMs === null).toBe(true);
    expect(HANG_TRACE_LONG_EMPTY_MS).toBeGreaterThan(0);
  });

  test("exportHangTraceJson wraps events", () => {
    beginHangTurnTrace("ses_x");
    const raw = exportHangTraceJson({ sessionId: "ses_x", limit: 50 });
    const parsed = JSON.parse(raw);
    expect(parsed.kind).toBe("hang_trace_dump");
    expect(parsed.eventCount).toBeGreaterThan(0);
    expect(Array.isArray(parsed.events)).toBe(true);
  });

  test("pruneHangTraceRetention drops events older than 14d", () => {
    const now = Date.now();
    __pushHangTraceEventForTest({
      ts: now - HANG_TRACE_RETENTION_MS - 60_000,
      iso: new Date(now - HANG_TRACE_RETENTION_MS - 60_000).toISOString(),
      layer: "ui",
      event: "turn.start",
      turnTraceId: "ht_old",
      sessionId: "ses_old",
      workspaceId: null,
      messageId: null,
      fields: {},
    });
    __pushHangTraceEventForTest({
      ts: now - 60_000,
      iso: new Date(now - 60_000).toISOString(),
      layer: "ui",
      event: "prompt.sent",
      turnTraceId: "ht_new",
      sessionId: "ses_new",
      workspaceId: null,
      messageId: null,
      fields: {},
    });
    const removed = pruneHangTraceRetention({ now, force: true });
    expect(removed).toBe(1);
    const events = getHangTraceEvents({ limit: 50 });
    expect(events.some((row) => row.sessionId === "ses_old")).toBe(false);
    expect(events.some((row) => row.sessionId === "ses_new")).toBe(true);
  });
});
