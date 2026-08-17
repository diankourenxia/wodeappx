import { describe, expect, test } from "bun:test";

import { buildSessionMessages, slimSessionSummaryDiffs } from "./session-read-model.js";

function sessionMessagesWithError(error: string, metadata?: Record<string, unknown>) {
  return [{
    info: {
      id: "msg_test",
      sessionID: "ses_test",
      role: "assistant",
      time: { created: 1 },
    },
    parts: [{
      id: "prt_test",
      messageID: "msg_test",
      sessionID: "ses_test",
      type: "tool",
      tool: "schedule_job",
      callID: "call_test",
      state: {
        status: "error",
        input: { command: "bash" },
        error,
        ...(metadata ? { metadata } : {}),
        time: { start: 1, end: 2 },
      },
    }],
  }] as never;
}

describe("session reliability read model", () => {
  test("projects tagged OpenCode errors into structured Item failure metadata", () => {
    const messages = buildSessionMessages(sessionMessagesWithError(
      "[wodeappxFailure recoverable=true errorKind=validation] command 字段不能填写 bash",
    ));
    const part = messages[0]?.parts[0] as Record<string, unknown>;
    const state = part.state as Record<string, unknown>;

    expect(state.status).toBe("error");
    expect(state.metadata).toEqual({
      wodeappxFailure: {
        status: "failed",
        recoverable: true,
        errorKind: "validation",
        message: "command 字段不能填写 bash",
      },
    });
  });

  test("preserves engine metadata and ignores ordinary tool errors", () => {
    const existing = { traceId: "trace-1" };
    const tagged = buildSessionMessages(sessionMessagesWithError(
      "[wodeappxFailure recoverable=false errorKind=execution] disk full",
      existing,
    ));
    const taggedState = (tagged[0]?.parts[0] as Record<string, unknown>).state as Record<string, unknown>;
    expect(taggedState.metadata).toEqual({
      traceId: "trace-1",
      wodeappxFailure: {
        status: "failed",
        recoverable: false,
        errorKind: "execution",
        message: "disk full",
      },
    });

    const ordinary = buildSessionMessages(sessionMessagesWithError("ordinary failure"));
    const ordinaryState = (ordinary[0]?.parts[0] as Record<string, unknown>).state as Record<string, unknown>;
    expect(ordinaryState.metadata).toBeUndefined();
  });

  test("strips summary.diffs patch bodies from session messages", () => {
    const patch = `${"x".repeat(200_000)}\n@@ -1 +1 @@\n-old\n+new\n`;
    const messages = buildSessionMessages([{
      info: {
        id: "msg_user",
        sessionID: "ses_test",
        role: "user",
        time: { created: 1 },
        summary: {
          title: "review",
          diffs: [{
            file: "apps/server/src/big.ts",
            status: "modified",
            additions: 12,
            deletions: 3,
            patch,
            before: "old",
            after: "new",
          }],
        },
      },
      parts: [{
        id: "prt_user",
        messageID: "msg_user",
        sessionID: "ses_test",
        type: "text",
        text: "hello",
      }],
    }] as never);

    const summary = (messages[0]?.info as { summary?: { diffs?: Array<Record<string, unknown>>; title?: string } }).summary;
    expect(summary?.title).toBe("review");
    expect(summary?.diffs).toEqual([{
      file: "apps/server/src/big.ts",
      status: "modified",
      additions: 12,
      deletions: 3,
    }]);
    expect(JSON.stringify(messages).includes(patch)).toBe(false);
  });

  test("slimSessionSummaryDiffs keeps metadata only", () => {
    const slim = slimSessionSummaryDiffs({
      body: "ok",
      diffs: [{ file: "a.ts", additions: 1, deletions: 0, patch: "huge", status: "added" }],
    }) as { body?: string; diffs?: Array<Record<string, unknown>> };
    expect(slim.body).toBe("ok");
    expect(slim.diffs).toEqual([{ file: "a.ts", status: "added", additions: 1, deletions: 0 }]);
  });
});
