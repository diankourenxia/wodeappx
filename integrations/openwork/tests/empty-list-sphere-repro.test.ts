/**
 * Reproduce the ses_0490d614 empty-list / sphere / 「未返回」 races against the
 * fixed optimistic + awaiting rules. If any scenario still trips the old
 * failure signatures, the fix is incomplete.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";

import {
  buildOptimisticUserMessage,
  mergeOptimisticUserMessage,
  shouldClearOptimisticUserMessage,
} from "../fork/apps/app/src/react-app/domains/session/surface/optimistic-user-message.ts";

function user(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function emptyUser(id: string): UIMessage {
  return { id, role: "user", parts: [] };
}

function assistant(id: string, text = ""): UIMessage {
  return {
    id,
    role: "assistant",
    parts: text ? [{ type: "text", text }] : [],
  };
}

/** Old UI gate that painted the OpenWork sphere instead of MessageList. */
function wouldShowSphereCard(conversationLength: number, activityNotIdle: boolean) {
  return conversationLength === 0 && activityNotIdle;
}

test("OLD trigger: duplicate 你好 cleared optimistic → empty list while busy → sphere", () => {
  const history: UIMessage[] = [
    user("u1", "你好"),
    assistant("a1", "你好！"),
  ];
  const pending = buildOptimisticUserMessage("你好");
  // Pre-fix: matched previous turn text and dropped the bubble immediately.
  assert.equal(shouldClearOptimisticUserMessage(pending, history), true);
  const withoutBaseline = mergeOptimisticUserMessage(history, pending);
  assert.equal(withoutBaseline.length, 2);

  // If transcript then briefly wiped (refetch) while still busy:
  assert.equal(wouldShowSphereCard(0, true), true);
});

test("FIXED: duplicate 你好 keeps optimistic until new echo after baseline", () => {
  const history: UIMessage[] = [
    user("u1", "你好"),
    assistant("a1", "你好！"),
  ];
  const baseline = history.length;
  const pending = buildOptimisticUserMessage("你好");
  assert.equal(
    shouldClearOptimisticUserMessage(pending, history, { baselineMessageCount: baseline }),
    false,
  );
  const merged = mergeOptimisticUserMessage(history, pending, { baselineMessageCount: baseline });
  assert.equal(merged.length, 3);
  assert.equal(wouldShowSphereCard(merged.length, true), false);

  // Empty transport shell must not clear either.
  const withShell = [...history, emptyUser("u2-shell")];
  assert.equal(
    shouldClearOptimisticUserMessage(pending, withShell, { baselineMessageCount: baseline }),
    false,
  );
  assert.equal(
    mergeOptimisticUserMessage(withShell, pending, { baselineMessageCount: baseline }).at(-1)?.id,
    pending.id,
  );
});

test("OLD trigger: empty assistant shell + ready looked like 未返回 while user shell invisible", () => {
  // message.updated user parts:[] renders null; optimistic cleared by duplicate → no user bubble.
  const pending = buildOptimisticUserMessage("你好");
  const rendered: UIMessage[] = [
    user("u1", "你好"),
    assistant("a1", "ok"),
    emptyUser("u2"),
    assistant("a2"), // empty shell
  ];
  assert.equal(shouldClearOptimisticUserMessage(pending, rendered), true);
  // Fixed path with baseline keeps optimistic over the empty shell.
  assert.equal(
    shouldClearOptimisticUserMessage(pending, rendered, { baselineMessageCount: 2 }),
    false,
  );
});

test("FIXED: new echoed user after baseline clears optimistic cleanly", () => {
  const pending = buildOptimisticUserMessage("你好");
  const rendered: UIMessage[] = [
    user("u1", "你好"),
    assistant("a1", "ok"),
    user("u2", "你好"),
  ];
  assert.equal(
    shouldClearOptimisticUserMessage(pending, rendered, { baselineMessageCount: 2 }),
    true,
  );
  assert.deepEqual(
    mergeOptimisticUserMessage(rendered, pending, { baselineMessageCount: 2 }),
    rendered,
  );
});
