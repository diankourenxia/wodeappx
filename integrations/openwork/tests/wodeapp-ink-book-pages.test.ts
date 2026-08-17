import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInkBookSpreads,
  clampInkBookSpreadIndex,
  inkBookSpreadLabel,
  paginateBlockHeights,
  resolveInkBookBlockSide,
} from "../wodeapp/wodeapp-ink-book-pages.ts";

test("paginateBlockHeights packs until page overflows", () => {
  const pages = paginateBlockHeights([100, 100, 100, 80], 250, 10);
  assert.deepEqual(pages, [
    { start: 0, end: 2 }, // 100 + 10 + 100 = 210
    { start: 2, end: 4 }, // 100 + 10 + 80
  ]);
});

test("paginateBlockHeights keeps oversized block on its own page", () => {
  const pages = paginateBlockHeights([400, 50], 200, 12);
  assert.deepEqual(pages, [
    { start: 0, end: 1 },
    { start: 1, end: 2 },
  ]);
});

test("buildInkBookSpreads pairs left/right pages", () => {
  const spreads = buildInkBookSpreads([
    { start: 0, end: 2 },
    { start: 2, end: 4 },
    { start: 4, end: 5 },
  ]);
  assert.equal(spreads.length, 2);
  assert.deepEqual(spreads[0], {
    index: 0,
    left: { start: 0, end: 2 },
    right: { start: 2, end: 4 },
  });
  assert.deepEqual(spreads[1], {
    index: 1,
    left: { start: 4, end: 5 },
    right: null,
  });
});

test("resolveInkBookBlockSide hides off-spread blocks", () => {
  const spread = {
    index: 0,
    left: { start: 0, end: 2 },
    right: { start: 2, end: 3 },
  };
  assert.equal(resolveInkBookBlockSide(0, spread), "left");
  assert.equal(resolveInkBookBlockSide(2, spread), "right");
  assert.equal(resolveInkBookBlockSide(3, spread), "hide");
});

test("inkBookSpreadLabel and clamp", () => {
  assert.equal(clampInkBookSpreadIndex(9, 3), 2);
  assert.equal(inkBookSpreadLabel(1, 4), "第 2 开 / 共 4 开");
});
