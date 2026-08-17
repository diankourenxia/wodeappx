/**
 * Pure pagination for the ink-book skin: pack transcript blocks into page
 * buckets by measured height so conversation reads like turning a book.
 */

export type InkBookPageBucket = {
  /** Inclusive start index into the measured block list. */
  start: number;
  /** Exclusive end index. */
  end: number;
};

export type InkBookSpread = {
  /** Zero-based spread index (one open book = left + right page). */
  index: number;
  left: InkBookPageBucket | null;
  right: InkBookPageBucket | null;
};

/**
 * Pack block heights into pages. A single oversized block always gets its own
 * page (caller may allow in-page scroll for that leaf; wheel must not also flip).
 */
export function paginateBlockHeights(
  heights: readonly number[],
  pageHeight: number,
  gap = 12,
): InkBookPageBucket[] {
  const usable = Math.max(1, Math.floor(pageHeight));
  if (heights.length === 0) return [{ start: 0, end: 0 }];

  const pages: InkBookPageBucket[] = [];
  let start = 0;
  let used = 0;

  for (let i = 0; i < heights.length; i += 1) {
    const h = Math.max(0, Number(heights[i]) || 0);
    const extra = used > 0 ? gap : 0;
    if (used > 0 && used + extra + h > usable) {
      pages.push({ start, end: i });
      start = i;
      used = h;
      continue;
    }
    used += extra + h;
  }

  pages.push({ start, end: heights.length });
  return pages;
}

/** Pair consecutive pages into left/right open-book spreads. */
export function buildInkBookSpreads(pages: readonly InkBookPageBucket[]): InkBookSpread[] {
  if (pages.length === 0) {
    return [{ index: 0, left: { start: 0, end: 0 }, right: null }];
  }
  const spreads: InkBookSpread[] = [];
  for (let i = 0; i < pages.length; i += 2) {
    spreads.push({
      index: spreads.length,
      left: pages[i] ?? null,
      right: pages[i + 1] ?? null,
    });
  }
  return spreads;
}

export function clampInkBookSpreadIndex(index: number, spreadCount: number): number {
  if (spreadCount <= 0) return 0;
  return Math.max(0, Math.min(spreadCount - 1, Math.floor(index)));
}

/** Which side a block belongs to for the active spread, or hide. */
export function resolveInkBookBlockSide(
  blockIndex: number,
  spread: InkBookSpread | null | undefined,
): "left" | "right" | "hide" {
  if (!spread) return "hide";
  const { left, right } = spread;
  if (left && blockIndex >= left.start && blockIndex < left.end) return "left";
  if (right && blockIndex >= right.start && blockIndex < right.end) return "right";
  return "hide";
}

export function inkBookSpreadLabel(spreadIndex: number, spreadCount: number): string {
  const total = Math.max(1, spreadCount);
  const current = clampInkBookSpreadIndex(spreadIndex, total) + 1;
  return `第 ${current} 开 / 共 ${total} 开`;
}
