/**
 * Codex-style compaction transcript: after 压缩上下文 the earlier turns fold
 * into one expandable「已处理 xx」strip with the summary answer below.
 *
 * OpenCode keeps a recent tail (`tail_start_id` / tail_turns) in full context;
 * those turns must stay visible outside the strip (ses_00c083 repro).
 *
 * Covers the pure boundary/row helpers plus the wiring contracts:
 *   live SSE path (fork session-sync) keeps the compaction marker part
 *   snapshot path (apply-script usechat-adapter patch) keeps the marker part
 *   MessageList renders the fold strip instead of the marker bubble
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildCompactionRows,
  findCompactionBoundaries,
  formatCompactionElapsed,
  getOpencodeCompactionMarker,
  getOpencodeCompactionPartId,
  OPENCODE_COMPACTION_PART_TYPE,
  toOpencodeCompactionUIPart,
} from "../src/react-app/domains/wodeapp/wodeapp-compaction-history";

const root = join(import.meta.dir, "..");

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function textMessage(id: string, created: number) {
  return {
    id,
    parts: [{ type: "text", text: `msg ${id}` }],
    metadata: { opencode: { created } },
  };
}

function compactionMessage(id: string, created: number, auto = false, tailStartId?: string) {
  return {
    id,
    parts: [toOpencodeCompactionUIPart({ id: `prt_${id}`, auto, tailStartId })],
    metadata: { opencode: { created } },
  };
}

describe("compaction history marker part", () => {
  test("toOpencodeCompactionUIPart carries a data marker with the original part id", () => {
    const part = toOpencodeCompactionUIPart({
      id: "prt_1",
      auto: true,
      overflow: false,
      tail_start_id: "msg_tail",
    });
    expect(part.type).toBe(OPENCODE_COMPACTION_PART_TYPE);
    expect(part.type.startsWith("data-")).toBe(true);
    expect(part.data.auto).toBe(true);
    expect(part.data.tailStartId).toBe("msg_tail");
    expect(getOpencodeCompactionPartId(part)).toBe("prt_1");
  });

  test("marker lookup ignores ordinary parts and finds the boundary message", () => {
    expect(getOpencodeCompactionMarker(textMessage("m1", 1))).toBeNull();
    const marker = getOpencodeCompactionMarker(compactionMessage("m2", 2, true, "u1"));
    expect(marker).toEqual({ auto: true, overflow: false, tailStartId: "u1" });
  });

  test("formatCompactionElapsed matches the Codex row style", () => {
    expect(formatCompactionElapsed(45_000)).toBe("45s");
    expect(formatCompactionElapsed(32 * 60_000 + 12_000)).toBe("32m 12s");
    expect(formatCompactionElapsed(65 * 60_000)).toBe("1h 5m");
    expect(formatCompactionElapsed(0)).toBe("0s");
  });
});

describe("findCompactionBoundaries", () => {
  test("locates each boundary and measures the collapsed segment span", () => {
    const t0 = 1_000_000;
    const messages = [
      textMessage("u1", t0),
      textMessage("a1", t0 + 10_000),
      compactionMessage("c1", t0 + 32 * 60_000 + 12_000),
      textMessage("s1", t0 + 33 * 60_000),
      textMessage("u2", t0 + 34 * 60_000),
      compactionMessage("c2", t0 + 40 * 60_000, true),
      textMessage("s2", t0 + 41 * 60_000),
    ];

    const boundaries = findCompactionBoundaries(messages);
    expect(boundaries.map((boundary) => boundary.messageId)).toEqual(["c1", "c2"]);
    expect(boundaries[0]!.messageIndex).toBe(2);
    expect(boundaries[0]!.foldUntilIndex).toBe(2);
    // Fold ends at the last pre-marker message (a1), not the marker clock.
    expect(boundaries[0]!.elapsedMs).toBe(10_000);
    // Second segment starts after the first boundary (the summary message).
    expect(boundaries[1]!.auto).toBe(true);
    expect(boundaries[1]!.foldUntilIndex).toBe(5);
    // elapsed = u2.created - s1.created
    expect(boundaries[1]!.elapsedMs).toBe(60_000);
  });

  test("respects OpenCode tail_start_id so recent turns stay outside the fold", () => {
    const t0 = 1_000_000;
    const messages = [
      textMessage("old_u", t0),
      textMessage("old_a", t0 + 1_000),
      textMessage("tail_u", t0 + 2 * 60_000),
      textMessage("tail_a", t0 + 3 * 60_000),
      textMessage("pending_u", t0 + 4 * 60_000),
      compactionMessage("c1", t0 + 5 * 60_000, true, "tail_u"),
      textMessage("summary", t0 + 6 * 60_000),
    ];
    const boundaries = findCompactionBoundaries(messages);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0]!.foldUntilIndex).toBe(2);
    expect(boundaries[0]!.messageIndex).toBe(5);
    expect(boundaries[0]!.tailStartId).toBe("tail_u");
    // Folded span is only old_u → old_a.
    expect(boundaries[0]!.elapsedMs).toBe(1_000);
  });

  test("returns no boundaries for a transcript without compaction", () => {
    expect(findCompactionBoundaries([textMessage("u1", 1), textMessage("a1", 2)])).toEqual([]);
  });
});

describe("buildCompactionRows", () => {
  test("folds items before each boundary and consumes the marker item", () => {
    const items = [
      { index: 0, id: "u1" },
      { index: 1, id: "a1" },
      { index: 2, id: "c1" },
      { index: 3, id: "s1" },
      { index: 4, id: "u2" },
    ];
    const rows = buildCompactionRows(
      items,
      (item) => item.index,
      [{
        messageId: "c1",
        messageIndex: 2,
        visibleIndex: 2,
        foldUntilIndex: 2,
        foldUntilVisibleIndex: 2,
        auto: false,
        elapsedMs: 1000,
        tailStartId: null,
      }],
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]!.kind).toBe("boundary");
    const boundaryRow = rows[0] as Extract<(typeof rows)[number], { kind: "boundary" }>;
    expect(boundaryRow.hidden.map((item) => item.id)).toEqual(["u1", "a1"]);
    expect(rows.slice(1).map((row) => (row.kind === "item" ? row.item.id : ""))).toEqual(["s1", "u2"]);
  });

  test("keeps the OpenCode tail visible between the strip and the summary", () => {
    const items = [
      { index: 0, id: "old_u" },
      { index: 1, id: "old_a" },
      { index: 2, id: "tail_u" },
      { index: 3, id: "pending_u" },
      { index: 4, id: "c1" },
      { index: 5, id: "summary" },
    ];
    const rows = buildCompactionRows(
      items,
      (item) => item.index,
      [{
        messageId: "c1",
        messageIndex: 4,
        visibleIndex: 4,
        foldUntilIndex: 2,
        foldUntilVisibleIndex: 2,
        auto: true,
        elapsedMs: 1000,
        tailStartId: "tail_u",
      }],
    );
    expect(rows[0]!.kind).toBe("boundary");
    const boundaryRow = rows[0] as Extract<(typeof rows)[number], { kind: "boundary" }>;
    expect(boundaryRow.hidden.map((item) => item.id)).toEqual(["old_u", "old_a"]);
    expect(rows.slice(1).map((row) => (row.kind === "item" ? row.item.id : ""))).toEqual([
      "tail_u",
      "pending_u",
      "summary",
    ]);
  });

  test("drops a boundary that has nothing to hide in the rendered window", () => {
    const items = [{ index: 0, id: "c1" }, { index: 1, id: "s1" }];
    const rows = buildCompactionRows(
      items,
      (item) => item.index,
      [{
        messageId: "c1",
        messageIndex: 0,
        visibleIndex: 0,
        foldUntilIndex: 0,
        foldUntilVisibleIndex: 0,
        auto: false,
        elapsedMs: null,
        tailStartId: null,
      }],
    );
    expect(rows.every((row) => row.kind === "item")).toBe(true);
    expect(rows.map((row) => (row.kind === "item" ? row.item.id : ""))).toEqual(["s1"]);
  });
});

describe("wiring contracts", () => {
  test("live SSE path keeps the compaction part as a transcript marker", () => {
    const source = read("fork/apps/app/src/react-app/domains/session/sync/session-sync.ts");
    expect(source).toContain("wodeapp-compaction-history");
    expect(source).toContain('if (part.type === "compaction") return toOpencodeCompactionUIPart(part);');
    expect(source).toContain("getOpencodeCompactionPartId");
  });

  test("snapshot path keeps the compaction part via the apply-script patch", () => {
    const source = read("../../scripts/apply-openwork-integration.mjs");
    expect(source).toContain('"wodeapp-compaction-history.ts"');
    expect(source).toContain("wodeapp-compaction-history");
    // The usechat-adapter anchor patch must inject the snapshot mapping.
    expect(source).toContain('if (part.type === "compaction") {');
    expect(source).toContain("return [toOpencodeCompactionUIPart(part)];");
  });

  test("MessageList folds history into the expandable 已处理 strip", () => {
    const source = read("fork/apps/app/src/components/chat/message-list.tsx");
    expect(source).toContain("CompactionHistoryStrip");
    expect(source).toContain("findCompactionBoundaries(messages)");
    expect(source).toContain("buildCompactionRows(items, transcriptItemLastIndex, compactionBoundaries)");
    expect(source).toContain("已处理 ${formatCompactionElapsed(boundary.elapsedMs)}");
    expect(source).toContain("foldUntilVisibleIndex");
    // Folded turns mount only when the merchant expands the strip.
    expect(source).toContain("{open ? (");
  });
});
