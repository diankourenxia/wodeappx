/**
 * Pure helpers for transcript history windowing (lazy load on scroll-up).
 * Keep this free of React so tests can import it without mounting MessageList.
 */

export const INITIAL_HISTORY_WINDOW = 60
/** How many older messages to reveal each time the user scrolls near the top. */
export const HISTORY_LOAD_BATCH = 40
/** Cap server-side history fetch so a single scroll-up cannot pull an entire huge session. */
export const HISTORY_FETCH_MAX = 800
/** Intersection rootMargin above the list so load starts before the user hits the ceiling. */
export const HISTORY_LOAD_ROOT_MARGIN = "160px 0px 0px 0px"

/** Nearest vertical scrollport for transcript lazy-load (session surface scroller). */
export function findTranscriptScrollParent(node: Element | null): HTMLElement | null {
  let current: Element | null = node?.parentElement ?? null
  while (current) {
    if (current instanceof HTMLElement) {
      const style = window.getComputedStyle(current)
      const overflowY = style.overflowY
      if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
        return current
      }
    }
    current = current.parentElement
  }
  return null
}

/**
 * Keep the viewport anchored when older messages are prepended.
 * `distanceFromBottom` = scrollHeight - scrollTop captured before the prepend.
 */
export function scrollTopAfterPrepend(scrollHeight: number, distanceFromBottom: number): number {
  return Math.max(0, scrollHeight - distanceFromBottom)
}

export function nextLoadedHistoryCount(
  current: number,
  total: number,
  batch = HISTORY_LOAD_BATCH,
): number {
  if (total <= 0) return 0
  if (current >= total) return total
  return Math.min(total, current + batch)
}

/**
 * When the transcript grows (usually appends at the end), keep a trailing window
 * unless the user has already scrolled up and expanded past the default size.
 *
 * Important: `loadedCount` starts at INITIAL_HISTORY_WINDOW even when the session
 * is shorter than that. The old `current >= prevTotal → expand to nextTotal`
 * branch treated that as "fully expanded", so chatting from 30 → 200 messages
 * mounted the entire list in the DOM.
 */
export function adjustLoadedHistoryCountOnMessageGrowth(input: {
  currentLoaded: number
  prevTotal: number
  nextTotal: number
  initialWindow?: number
}): number {
  const initial = input.initialWindow ?? INITIAL_HISTORY_WINDOW
  const currentLoaded = Math.max(0, input.currentLoaded)
  const prevTotal = Math.max(0, input.prevTotal)
  const nextTotal = Math.max(0, input.nextTotal)

  if (nextTotal <= 0) return 0
  if (nextTotal <= prevTotal) return Math.min(currentLoaded, nextTotal)

  const delta = nextTotal - prevTotal

  // User explicitly revealed older history (or fully expanded past the default
  // trailing window). Grow with the append delta so the same start stays visible.
  if (currentLoaded > initial) {
    return Math.min(nextTotal, currentLoaded + delta)
  }

  // Default trailing window: stay pinned to the newest `initial` messages.
  return Math.min(initial, nextTotal)
}

/**
 * OpenWork/OpenCode `messages?limit=N` returns the N most recent messages.
 * To reveal older history, request a larger limit than what we already hold.
 */
export function nextHistoryFetchLimit(
  currentCount: number,
  batch = HISTORY_LOAD_BATCH,
  max = HISTORY_FETCH_MAX,
): number {
  const base = Math.max(0, currentCount)
  if (base >= max) return max
  return Math.min(max, base + Math.max(1, batch))
}
