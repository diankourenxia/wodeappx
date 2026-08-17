import { describe, expect, test } from "bun:test";

import {
  INITIAL_HISTORY_WINDOW,
  adjustLoadedHistoryCountOnMessageGrowth,
  nextHistoryFetchLimit,
  nextLoadedHistoryCount,
  scrollTopAfterPrepend,
} from "../fork/apps/app/src/components/chat/message-list-history-window";

describe("message list history lazy window", () => {
  test("nextLoadedHistoryCount grows by batch and caps at total", () => {
    expect(nextLoadedHistoryCount(60, 350, 40)).toBe(100);
    expect(nextLoadedHistoryCount(340, 350, 40)).toBe(350);
    expect(nextLoadedHistoryCount(350, 350, 40)).toBe(350);
    expect(nextLoadedHistoryCount(0, 0, 40)).toBe(0);
  });

  test("scrollTopAfterPrepend keeps the same distance from bottom", () => {
    expect(scrollTopAfterPrepend(1400, 800)).toBe(600);
    expect(scrollTopAfterPrepend(500, 800)).toBe(0);
  });

  test("nextHistoryFetchLimit requests a larger recent page than current count", () => {
    expect(nextHistoryFetchLimit(72, 40, 800)).toBe(112);
    expect(nextHistoryFetchLimit(780, 40, 800)).toBe(800);
    expect(nextHistoryFetchLimit(800, 40, 800)).toBe(800);
  });

  test("short session grow-while-open stays on the default trailing window", () => {
    let loaded = INITIAL_HISTORY_WINDOW;
    let prev = 32;
    for (const next of [33, 61, 100, 200]) {
      loaded = adjustLoadedHistoryCountOnMessageGrowth({
        currentLoaded: loaded,
        prevTotal: prev,
        nextTotal: next,
      });
      prev = next;
      expect(loaded).toBe(Math.min(INITIAL_HISTORY_WINDOW, next));
    }
  });

  test("default window on a long session does not grow past the initial cap", () => {
    expect(
      adjustLoadedHistoryCountOnMessageGrowth({
        currentLoaded: INITIAL_HISTORY_WINDOW,
        prevTotal: 120,
        nextTotal: 200,
      }),
    ).toBe(INITIAL_HISTORY_WINDOW);
  });

  test("user-expanded history grows with append delta and can stay fully open", () => {
    expect(
      adjustLoadedHistoryCountOnMessageGrowth({
        currentLoaded: 100,
        prevTotal: 200,
        nextTotal: 205,
      }),
    ).toBe(105);

    expect(
      adjustLoadedHistoryCountOnMessageGrowth({
        currentLoaded: 200,
        prevTotal: 200,
        nextTotal: 201,
      }),
    ).toBe(201);
  });

  test("trailing window append past the cap drops older rows (needs scroll anchor)", () => {
    // Document the slide that used to jump the viewport upward after send:
    // loaded stays at INITIAL while total grows, so slice(-60) loses the oldest.
    expect(
      adjustLoadedHistoryCountOnMessageGrowth({
        currentLoaded: INITIAL_HISTORY_WINDOW,
        prevTotal: INITIAL_HISTORY_WINDOW,
        nextTotal: INITIAL_HISTORY_WINDOW + 1,
      }),
    ).toBe(INITIAL_HISTORY_WINDOW);
  });
});
