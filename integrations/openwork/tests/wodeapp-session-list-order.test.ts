import { describe, expect, test } from "bun:test";

import {
  mergeStableSessionOrderIds,
  sortSessionsByRecency,
  sortSessionsByStableOrder,
} from "../wodeapp/wodeapp-session-list-order";

describe("wodeapp session list stable order", () => {
  test("seeds empty order from recency", () => {
    const sessions = [
      { id: "old", time: { updated: 10 } },
      { id: "new", time: { updated: 30 } },
      { id: "mid", time: { updated: 20 } },
    ];
    expect(mergeStableSessionOrderIds([], sessions)).toEqual(["new", "mid", "old"]);
  });

  test("keeps sticky order when updated timestamps reshuffle", () => {
    const previous = ["a", "b", "c"];
    const sessions = [
      { id: "a", time: { updated: 1 } },
      { id: "b", time: { updated: 999 } }, // would win live recency
      { id: "c", time: { updated: 50 } },
    ];
    expect(mergeStableSessionOrderIds(previous, sessions)).toEqual(["a", "b", "c"]);
    expect(sortSessionsByStableOrder(sessions, previous).map((s) => s.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(sortSessionsByRecency(sessions).map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  test("prepends only brand-new sessions by recency", () => {
    const previous = ["a", "b"];
    const sessions = [
      { id: "a", time: { updated: 10 } },
      { id: "b", time: { updated: 20 } },
      { id: "fresh-old", time: { updated: 5 } },
      { id: "fresh-new", time: { updated: 100 } },
    ];
    expect(mergeStableSessionOrderIds(previous, sessions)).toEqual([
      "fresh-new",
      "fresh-old",
      "a",
      "b",
    ]);
  });

  test("drops ids that left the visible set", () => {
    expect(
      mergeStableSessionOrderIds(["gone", "keep"], [{ id: "keep", time: { updated: 1 } }]),
    ).toEqual(["keep"]);
  });

  test("pins float above sticky order without reshuffling the rest", () => {
    const sessions = [
      { id: "a", time: { updated: 1 } },
      { id: "b", time: { updated: 2 } },
      { id: "c", time: { updated: 3 } },
    ];
    expect(
      sortSessionsByStableOrder(sessions, ["a", "b", "c"], new Set(["b"])).map((s) => s.id),
    ).toEqual(["b", "a", "c"]);
  });
});
