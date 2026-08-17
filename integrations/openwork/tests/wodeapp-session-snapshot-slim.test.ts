import { describe, expect, test } from "bun:test";

import {
  slimOpenworkSessionSnapshot,
  slimSessionSummaryDiffs,
} from "../wodeapp/wodeapp-session-snapshot-slim";

describe("wodeapp-session-snapshot-slim", () => {
  test("drops patch/before/after while preserving diff metadata", () => {
    const slim = slimSessionSummaryDiffs({
      title: "turn",
      diffs: [{
        file: "wodeapp-session-control-actions.tsx",
        path: "ignored-if-file-present",
        status: "modified",
        additions: 10,
        deletions: 2,
        patch: "@@ huge patch @@",
        before: "before",
        after: "after",
      }],
    }) as { title?: string; diffs?: Array<Record<string, unknown>> };

    expect(slim.title).toBe("turn");
    expect(slim.diffs).toEqual([{
      file: "wodeapp-session-control-actions.tsx",
      path: "ignored-if-file-present",
      status: "modified",
      additions: 10,
      deletions: 2,
    }]);
  });

  test("slims nested snapshot messages for renderer cache", () => {
    const snapshot = slimOpenworkSessionSnapshot({
      session: { id: "ses_1" },
      status: { type: "idle" as const },
      todos: [],
      messages: [{
        info: {
          id: "msg_1",
          role: "user",
          summary: {
            diffs: [{ file: "a.ts", additions: 1, deletions: 0, patch: "FAT" }],
          },
        },
        parts: [
          {
            type: "file",
            mime: "image/png",
            filename: "image.png",
            url: `data:image/png;base64,${"A".repeat(3000)}`,
          },
          {
            type: "tool",
            tool: "bash",
            state: { status: "completed", output: "x".repeat(9000) },
          },
        ],
      }],
    });

    expect((snapshot.messages[0]?.info as { summary?: { diffs?: unknown[] } }).summary?.diffs).toEqual([{
      file: "a.ts",
      additions: 1,
      deletions: 0,
    }]);
    expect(JSON.stringify(snapshot).includes("FAT")).toBe(false);
    const parts = snapshot.messages[0]?.parts as Array<Record<string, unknown>>;
    expect(parts[0]?.url).toBe("");
    expect(String((parts[1]?.state as { output?: string }).output || "")).toContain("[slimmed");
  });

  test("exports slimLiveMessagePart as the live/snapshot shared contract", async () => {
    const { slimLiveMessagePart } = await import("../wodeapp/wodeapp-session-snapshot-slim");
    const fat = `data:image/png;base64,${"B".repeat(3000)}`;
    const slimmed = slimLiveMessagePart({
      type: "file",
      filename: "x.png",
      url: fat,
    }) as { url: string; filename: string };
    expect(slimmed.url).toBe("");
    expect(slimmed.filename).toBe("x.png");
  });
});
