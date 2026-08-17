import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

describe("session sync cumulative text", () => {
  test("part.updated keeps the longest of mapped/pending/existing UI text", () => {
    const source = read("fork/apps/app/src/react-app/domains/session/sync/session-sync.ts");
    expect(source).toContain("export function pickLongestCumulativeText");
    expect(source).toContain("export function mergeLiveCumulativeText");
    expect(source).toContain("export function takeBufferedDeltasForPart");
    expect(source).toContain("mergeLiveCumulativeText(");
    expect(source).toContain("bufferedDeltaText");
    expect(source).toContain("pendingSeedText");
    expect(source).toContain("existingText");
    // Must fold rAF-buffered deltas, not silently drop them on part.updated.
    expect(source).not.toContain(
      "Drop queued deltas for this part — cumulative snapshot supersedes them.",
    );
    // Stale shorter snapshots must not clobber delta-built prose.
    expect(source).not.toContain(
      "text: pending.text.length > mapped.text.length ? pending.text : mapped.text",
    );
  });

  test("pickLongestCumulativeText prefers longer same-stream prefix", () => {
    const pick = (...candidates: Array<string | null | undefined>) => {
      let best = "";
      for (const candidate of candidates) {
        if (typeof candidate !== "string" || !candidate) continue;
        if (candidate.length < best.length) continue;
        if (!best || candidate.startsWith(best) || best.startsWith(candidate) || candidate.length > best.length) {
          best = candidate;
        }
      }
      return best;
    };

    expect(pick("1. a\n2. b", "1. a\n2. b\n3. c")).toBe("1. a\n2. b\n3. c");
    expect(pick("1. a\n2. b\n3. c", "1. a\n2. b")).toBe("1. a\n2. b\n3. c");
    expect(pick("", "1. a", null, undefined)).toBe("1. a");
    expect(pick("而且现在", "代码已提交完成。而且现在正是好时机")).toBe(
      "代码已提交完成。而且现在正是好时机",
    );
  });

  test("takeBufferedDeltasForPart folds matching deltas and keeps others", () => {
    const take = <T extends { partId: string; delta: string }>(buffer: T[], partId: string) => {
      const remaining: T[] = [];
      let text = "";
      for (const item of buffer) {
        if (item.partId === partId) text += item.delta;
        else remaining.push(item);
      }
      return { remaining, text };
    };

    const buffer = [
      { partId: "a", delta: "1. a\n", sessionId: "s" },
      { partId: "b", delta: "other", sessionId: "s" },
      { partId: "a", delta: "2. b\n3. c", sessionId: "s" },
    ];
    const taken = take(buffer, "a");
    expect(taken.text).toBe("1. a\n2. b\n3. c");
    expect(taken.remaining).toEqual([{ partId: "b", delta: "other", sessionId: "s" }]);
  });

  test("mergeLiveCumulativeText keeps UI+buffered deltas over shorter snapshot", () => {
    const pick = (...candidates: Array<string | null | undefined>) => {
      let best = "";
      for (const candidate of candidates) {
        if (typeof candidate !== "string" || !candidate) continue;
        if (candidate.length < best.length) continue;
        if (!best || candidate.startsWith(best) || best.startsWith(candidate) || candidate.length > best.length) {
          best = candidate;
        }
      }
      return best;
    };
    const merge = (input: {
      mappedText?: string | null;
      pendingSeedText?: string | null;
      existingText?: string | null;
      bufferedDeltaText?: string | null;
    }) => {
      const mapped = typeof input.mappedText === "string" ? input.mappedText : "";
      const pending = typeof input.pendingSeedText === "string" ? input.pendingSeedText : "";
      const existing = typeof input.existingText === "string" ? input.existingText : "";
      const buffered = typeof input.bufferedDeltaText === "string" ? input.bufferedDeltaText : "";
      const liveBase = existing || pending;
      const liveWithBuffer = buffered ? `${liveBase}${buffered}` : liveBase;
      return pick(mapped, pending, existing, liveWithBuffer);
    };

    // Classic 闪没 race: snapshot lags, rAF still holds the next numbered item.
    expect(
      merge({
        mappedText: "1. a\n2. b",
        existingText: "1. a\n2. b",
        bufferedDeltaText: "\n3. c",
      }),
    ).toBe("1. a\n2. b\n3. c");

    expect(
      merge({
        mappedText: "",
        pendingSeedText: "1. a\n2. b",
        bufferedDeltaText: "\n3. c",
      }),
    ).toBe("1. a\n2. b\n3. c");
  });
});
