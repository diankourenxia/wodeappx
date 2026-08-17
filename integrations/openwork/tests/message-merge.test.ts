import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";

import { mergeSnapshotAndLiveMessages } from "../src/react-app/domains/session/sync/message-merge";

function user(id: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text: id }] };
}

function assistant(id: string, text: string): UIMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

describe("mergeSnapshotAndLiveMessages", () => {
  test("does not reorder a snapshot assistant under a live-only new user", () => {
    const snapshot = [user("u1"), assistant("a1", "cyberpunk cat")];
    const live = [user("u2"), assistant("a1", "cyberpunk cat")];

    const merged = mergeSnapshotAndLiveMessages(snapshot, live, {
      appendLiveOnlyMessages: true,
    });

    expect(merged.map((message) => message.id)).toEqual(["u1", "a1", "u2"]);
  });

  test("still inserts timestamped live-only messages chronologically", () => {
    const snapshot = [
      {
        ...user("u1"),
        metadata: { opencode: { created: 1 } },
      },
      {
        ...assistant("a1", "old"),
        metadata: { opencode: { created: 2 } },
      },
    ];
    const live = [
      {
        ...user("u1"),
        metadata: { opencode: { created: 1 } },
      },
      {
        ...assistant("a1", "old"),
        metadata: { opencode: { created: 2 } },
      },
      {
        ...user("u2"),
        metadata: { opencode: { created: 3 } },
      },
    ];

    const merged = mergeSnapshotAndLiveMessages(snapshot, live, {
      appendLiveOnlyMessages: true,
    });

    expect(merged.map((message) => message.id)).toEqual(["u1", "a1", "u2"]);
  });
});
