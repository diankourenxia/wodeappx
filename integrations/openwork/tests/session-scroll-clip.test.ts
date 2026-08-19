import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

describe("session scroll clip recovery", () => {
  test("shows jump-to-start while streaming when the answer top is clipped", () => {
    const source = read("fork/apps/app/src/react-app/domains/session/surface/scroll-overlay.tsx");
    expect(source).toContain("Must stay available while streaming");
    expect(source).toContain("const showJumpToStart = Boolean(topClippedMessageId)");
    expect(source).not.toContain("const showJumpToStart = !isStreaming && Boolean(topClippedMessageId)");
  });

  test("detects clipped assistant prose even when the latest row is a short tool", () => {
    const source = read("fork/apps/app/src/react-app/domains/session/surface/scroll-controller.ts");
    expect(source).toContain("function isMessageTopClipped");
    expect(source).toContain("data-message-role");
    expect(source).toContain("earliest clipped assistant message");
    expect(source).toContain("setStickyBottom(selectedSessionId, latestMessageTopClippedId(container))");
    expect(source).not.toContain("setStickyBottom(selectedSessionId, null)");
  });

  test("does not blind-pin the capped step scroller away from earlier tools", () => {
    const source = read("fork/apps/app/src/components/chat/message-list.tsx");
    expect(source).toContain("pinToLatestIfSticky");
    expect(source).toContain('data-scrollable="steps"');
    expect(source).toContain("gap <= 48");
  });

  test("keeps sticky tail and still exposes jump-to-start when clipped", () => {
    const source = read("fork/apps/app/src/react-app/domains/session/surface/scroll-controller.ts");
    // Sticky chase is intentional; content vanish is fixed in session-sync.
    expect(source).not.toContain("function pinMessageStart");
    expect(source).not.toContain("preferTailRef");
    expect(source).toContain("latestMessageTopClippedId");
  });

  test("re-anchors sticky bottom when the scrollport height changes after send", () => {
    const source = read("fork/apps/app/src/react-app/domains/session/surface/scroll-controller.ts");
    expect(source).toContain("observedContainerHeightRef");
    expect(source).toContain("containerChanged");
    expect(source).toContain("clears/resizes the composer");
    // Must not require content growth alone — composer shrink opens gap with
    // scrollTop unchanged while mode stays stickyBottom.
    expect(source).not.toContain("if (grew && isStickyBottom(selectedSessionId) && !hasScrollGesture())");
  });

  test("anchors trailing history window slides so appends do not jump upward", () => {
    const source = read("fork/apps/app/src/components/chat/message-list.tsx");
    expect(source).toContain("Default trailing window drops the oldest visible row on append");
    expect(source).toContain("prev >= INITIAL_HISTORY_WINDOW");
    expect(source).toContain("captureScrollAnchor()");
    expect(source).toContain("shouldClearHistoryWindowAnchorOnAppend");
    expect(source).toContain("pendingDistanceFromBottomRef.current = null");
  });

  test("follow-up send forces sticky tail instead of a mid-list offset", () => {
    const source = read("fork/apps/app/src/react-app/domains/session/surface/scroll-controller.ts");
    expect(source).toContain("shouldStickToBottomOnNewUserMessage");
    expect(source).toContain("Follow-up send: always chase the tail");
    expect(source).toContain("lastGestureAtRef.current = 0");
    expect(source).toContain("useLayoutEffect");
  });
});

describe("codex-style compact tool strip", () => {
  test("always collapses compactable tools and keeps attachment previews inside the strip", () => {
    const source = read("fork/apps/app/src/components/chat/message-list.tsx");
    expect(source).toContain("mediaParts?: FileUIPart[]");
    expect(source).toContain("Always one collapsed strip");
    expect(source).toContain("tool attachment previews are not full-bleed");
    expect(source).not.toContain("if (parts.length > 1) {\n                return (\n                  <ToolActivityGroup");
  });

  test("merges consecutive tool-only assistant messages across the turn", () => {
    const source = read("fork/apps/app/src/components/chat/message-list.tsx");
    expect(source).toContain("buildAssistantGroupSegments");
    expect(source).toContain("Collapse consecutive tool-only messages anywhere in the turn");
    expect(source).toContain('kind: "tool-run"');
    expect(source).toContain("probePastToolSpacers");
  });

  test("shows a collapsed content peek under the activity summary", () => {
    const source = read("fork/apps/app/src/components/chat/message-list.tsx");
    expect(source).toContain("buildWodeAppToolActivityPeek");
    expect(source).toContain('data-tool-activity-peek="1"');
    expect(source).toContain("Cursor-style: always show a short content peek");
  });
});
