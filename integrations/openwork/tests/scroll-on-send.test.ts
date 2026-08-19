import { describe, expect, test } from "bun:test";

import {
  isTrailingUserMessage,
  lastUserMessageId,
  shouldClearHistoryWindowAnchorOnAppend,
  shouldStickToBottomOnNewUserMessage,
} from "../fork/apps/app/src/react-app/domains/session/surface/scroll-on-send";

describe("scroll on follow-up send", () => {
  test("lastUserMessageId walks from the tail", () => {
    expect(lastUserMessageId([])).toBeNull();
    expect(lastUserMessageId([{ role: "assistant", id: "a1" }])).toBeNull();
    expect(lastUserMessageId([
      { role: "user", id: "u1" },
      { role: "assistant", id: "a1" },
      { role: "user", id: "u2" },
      { role: "assistant", id: "a2" },
    ])).toBe("u2");
  });

  test("isTrailingUserMessage is true only when the newest row is the user", () => {
    expect(isTrailingUserMessage([{ role: "user", id: "u1" }])).toBe(true);
    expect(isTrailingUserMessage([
      { role: "user", id: "u1" },
      { role: "assistant", id: "a1" },
    ])).toBe(false);
  });

  test("does not steal restore-manual when switching sessions", () => {
    expect(shouldStickToBottomOnNewUserMessage({
      sessionId: "ses_b",
      sessionChanged: true,
      prevLastUserMessageId: "u-old",
      nextLastUserMessageId: "u-new",
    })).toBe(false);
  });

  test("sticks to bottom when the same session gets a new user turn", () => {
    expect(shouldStickToBottomOnNewUserMessage({
      sessionId: "ses_a",
      sessionChanged: false,
      prevLastUserMessageId: "u1",
      nextLastUserMessageId: "u2",
    })).toBe(true);
  });

  test("does not re-stick when the last user id is unchanged", () => {
    expect(shouldStickToBottomOnNewUserMessage({
      sessionId: "ses_a",
      sessionChanged: false,
      prevLastUserMessageId: "u2",
      nextLastUserMessageId: "u2",
    })).toBe(false);
  });

  test("clears history-window mid-list anchor on a new user turn even if assistant already trails", () => {
    expect(shouldClearHistoryWindowAnchorOnAppend({
      prevLastUserMessageId: "u1",
      nextLastUserMessageId: "u2",
      messages: [
        { role: "user", id: "u2" },
        { role: "assistant", id: "a2" },
      ],
    })).toBe(true);
    expect(shouldClearHistoryWindowAnchorOnAppend({
      prevLastUserMessageId: "u2",
      nextLastUserMessageId: "u2",
      messages: [
        { role: "user", id: "u2" },
        { role: "assistant", id: "a2" },
      ],
    })).toBe(false);
  });
});
