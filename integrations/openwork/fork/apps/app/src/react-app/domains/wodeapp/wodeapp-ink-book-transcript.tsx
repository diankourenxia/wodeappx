/** @jsxImportSource react */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
  type TouchEvent as ReactTouchEvent,
  type UIEvent as ReactUIEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";

import {
  buildInkBookSpreads,
  clampInkBookSpreadIndex,
  inkBookSpreadLabel,
  paginateBlockHeights,
  resolveInkBookBlockSide,
  type InkBookSpread,
} from "./wodeapp-ink-book-pages";

const MEASURE_GAP_PX = 12;
const TURN_MS = 780;
const SPINE_GAP_PX = 28;
/** Quiet window after remmeasure before revealing the open book. */
const SETTLE_MS = 140;
/** Minimum time the closed cover stays up (even if hydrate is instant). */
const MIN_CLOSED_MS = 1600;
/** Cover open animation duration (keep in sync with CSS). */
const OPEN_MS = 720;

type InkPhase = "closed" | "opening" | "open";

type Props = {
  enabled: boolean;
  sessionId: string;
  children: ReactNode;
  scrollRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  followLatest?: boolean;
  className?: string;
  contentClassName?: string;
  onWheel?: (event: ReactWheelEvent<HTMLDivElement>) => void;
  onTouchStart?: (event: ReactTouchEvent<HTMLDivElement>) => void;
  onTouchMove?: (event: ReactTouchEvent<HTMLDivElement>) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onScroll?: (event: ReactUIEvent<HTMLDivElement>) => void;
};

function listRootFrom(content: HTMLElement | null): HTMLElement | null {
  if (!content) return null;
  return (
    content.querySelector<HTMLElement>("[data-wodeapp-history-loaded]")
    ?? (content.firstElementChild instanceof HTMLElement ? content.firstElementChild : null)
  );
}

function measurableChildren(list: HTMLElement): HTMLElement[] {
  return Array.from(list.children).filter((node): node is HTMLElement => {
    if (!(node instanceof HTMLElement)) return false;
    if (node.dataset.wodeappHistorySentinel === "1") return false;
    if (node.classList.contains("sr-only")) return false;
    return true;
  });
}

function clearBlockLayout(block: HTMLElement) {
  delete block.dataset.inkSide;
  delete block.dataset.inkScroll;
  block.hidden = false;
  block.style.position = "";
  block.style.left = "";
  block.style.top = "";
  block.style.width = "";
  block.style.maxWidth = "";
  block.style.maxHeight = "";
  block.style.overflowY = "";
  block.style.margin = "";
}

/** True when wheel is over a leaf block that scrolls its own overflow. */
function isInsideInkLeafScroll(target: EventTarget | null, root: HTMLElement): boolean {
  if (!(target instanceof Element)) return false;
  let node: Element | null = target;
  while (node && node !== root) {
    if (node instanceof HTMLElement && node.dataset.inkScroll === "1") {
      return node.scrollHeight > node.clientHeight + 1;
    }
    node = node.parentElement;
  }
  return false;
}

/**
 * Ink-book transcript: packs message blocks into left/right pages.
 *
 * Flip animation is a paper-curl overlay (StPageFlip-inspired CSS). We evaluated
 * Nodlik/StPageFlip for physics flips, but its HTML mode reparents/destroys
 * nodes and conflicts with React-owned MessageList — so the library is vendored
 * for a future dedicated page surface, while this path keeps React ownership.
 *
 * Gesture rule: spread flips only via pager buttons (上一开 / 下一开).
 * Wheel never flips — avoids fighting in-leaf scroll on oversized messages.
 *
 * Init: closed cover + settle debounce hides remmeasure thrash while history
 * hydrates; then a short open animation reveals the laid-out spread.
 */
export function WodeAppInkBookTranscript({
  enabled,
  sessionId,
  children,
  scrollRef,
  contentRef,
  followLatest = true,
  className,
  contentClassName,
  onWheel,
  onTouchStart,
  onTouchMove,
  onPointerDown,
  onScroll,
}: Props) {
  const measureHostRef = useRef<HTMLDivElement | null>(null);
  const measuringRef = useRef(false);
  const remmeasureTimerRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const openTimerRef = useRef<number | null>(null);
  const closedAtRef = useRef<number>(Date.now());
  const [spreadIndex, setSpreadIndex] = useState(0);
  const [spreads, setSpreads] = useState<InkBookSpread[]>([
    { index: 0, left: { start: 0, end: 0 }, right: null },
  ]);
  const [turning, setTurning] = useState<"next" | "prev" | null>(null);
  const [pageHeight, setPageHeight] = useState(0);
  const [phase, setPhase] = useState<InkPhase>("closed");
  const lastSessionRef = useRef(sessionId);
  const wasEnabledRef = useRef(enabled);
  const stickLatestRef = useRef(true);
  const turnTimerRef = useRef<number | null>(null);
  const spreadIndexRef = useRef(0);
  const heightsRef = useRef<number[]>([]);
  const phaseRef = useRef<InkPhase>("closed");

  useEffect(() => {
    spreadIndexRef.current = spreadIndex;
  }, [spreadIndex]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const resetClosedBook = useCallback(() => {
    if (settleTimerRef.current != null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    if (openTimerRef.current != null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    closedAtRef.current = Date.now();
    phaseRef.current = "closed";
    setPhase("closed");
    setSpreadIndex(0);
    stickLatestRef.current = true;
    setTurning(null);
  }, []);

  const beginOpenReveal = useCallback(() => {
    if (phaseRef.current !== "closed") return;
    phaseRef.current = "opening";
    setPhase("opening");
    if (openTimerRef.current != null) window.clearTimeout(openTimerRef.current);
    openTimerRef.current = window.setTimeout(() => {
      openTimerRef.current = null;
      phaseRef.current = "open";
      setPhase("open");
    }, OPEN_MS);
  }, []);

  const scheduleSettleReveal = useCallback(() => {
    if (phaseRef.current !== "closed") return;
    if (settleTimerRef.current != null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      if (phaseRef.current !== "closed") return;
      const elapsed = Date.now() - closedAtRef.current;
      const remain = Math.max(0, MIN_CLOSED_MS - elapsed);
      if (remain > 0) {
        settleTimerRef.current = window.setTimeout(() => {
          settleTimerRef.current = null;
          beginOpenReveal();
        }, remain);
        return;
      }
      beginOpenReveal();
    }, SETTLE_MS);
  }, [beginOpenReveal]);

  useEffect(() => {
    if (lastSessionRef.current === sessionId) return;
    lastSessionRef.current = sessionId;
    resetClosedBook();
  }, [resetClosedBook, sessionId]);

  useEffect(() => {
    if (enabled && !wasEnabledRef.current) {
      resetClosedBook();
    }
    wasEnabledRef.current = enabled;
  }, [enabled, resetClosedBook]);

  // Wheel must not flip spreads; only oversized leaf blocks may scroll.
  // Use a non-passive listener so preventDefault actually sticks.
  useEffect(() => {
    if (!enabled) return;
    const root = scrollRef.current;
    if (!root) return;
    const onWheelNative = (event: WheelEvent) => {
      if (isInsideInkLeafScroll(event.target, root)) return;
      event.preventDefault();
    };
    root.addEventListener("wheel", onWheelNative, { passive: false });
    return () => root.removeEventListener("wheel", onWheelNative);
  }, [enabled, scrollRef]);

  const applySpreadLayout = useCallback((
    spread: InkBookSpread | null,
    heights: readonly number[],
    leafWidth: number,
    leafHeight: number,
  ) => {
    const content = contentRef.current;
    const list = listRootFrom(content);
    if (!list) return;
    const blocks = measurableChildren(list);
    list.dataset.inkBook = "1";
    list.dataset.inkSpread = String(spread?.index ?? 0);
    list.style.position = "relative";
    list.style.height = "100%";
    list.style.overflow = "hidden";
    list.style.display = "block";

    let leftY = 0;
    let rightY = 0;
    const rightLeft = leafWidth + SPINE_GAP_PX;

    for (let i = 0; i < blocks.length; i += 1) {
      const side = resolveInkBookBlockSide(i, spread);
      const block = blocks[i]!;
      const h = heights[i] ?? block.getBoundingClientRect().height;
      block.dataset.inkSide = side;
      if (side === "hide") {
        block.hidden = true;
        block.style.position = "";
        block.style.left = "";
        block.style.top = "";
        block.style.width = "";
        block.style.maxHeight = "";
        block.style.overflowY = "";
        continue;
      }
      block.hidden = false;
      block.style.position = "absolute";
      block.style.width = `${leafWidth}px`;
      block.style.maxWidth = `${leafWidth}px`;
      block.style.margin = "0";
      if (h > leafHeight) {
        block.style.maxHeight = `${leafHeight}px`;
        block.style.overflowY = "auto";
        block.dataset.inkScroll = "1";
      } else {
        block.style.maxHeight = "";
        block.style.overflowY = "hidden";
        delete block.dataset.inkScroll;
      }
      if (side === "left") {
        block.style.left = "0px";
        block.style.top = `${leftY}px`;
        leftY += Math.min(h, leafHeight) + MEASURE_GAP_PX;
      } else {
        block.style.left = `${rightLeft}px`;
        block.style.top = `${rightY}px`;
        rightY += Math.min(h, leafHeight) + MEASURE_GAP_PX;
      }
    }
  }, [contentRef]);

  const remmeasure = useCallback(() => {
    if (!enabled || measuringRef.current) return;
    const host = measureHostRef.current;
    const content = contentRef.current;
    if (!host || !content) return;

    measuringRef.current = true;
    const leafH = Math.max(120, Math.floor(host.clientHeight - 8));
    const leafW = Math.max(160, Math.floor((host.clientWidth - SPINE_GAP_PX) / 2));
    setPageHeight(leafH);

    const list = listRootFrom(content);
    if (!list) {
      setSpreads([{ index: 0, left: { start: 0, end: 0 }, right: null }]);
      measuringRef.current = false;
      // Empty / not-yet-mounted list: still settle so empty sessions open cleanly.
      scheduleSettleReveal();
      return;
    }

    const prev = {
      position: list.style.position,
      height: list.style.height,
      overflow: list.style.overflow,
      display: list.style.display,
      width: list.style.width,
      maxWidth: list.style.maxWidth,
      gap: list.style.gap,
      flexDirection: list.style.flexDirection,
    };

    list.dataset.inkMeasuring = "1";
    list.style.position = "static";
    list.style.height = "auto";
    list.style.overflow = "visible";
    list.style.display = "flex";
    list.style.flexDirection = "column";
    list.style.width = `${leafW}px`;
    list.style.maxWidth = `${leafW}px`;
    list.style.gap = `${MEASURE_GAP_PX}px`;

    const blocks = measurableChildren(list);
    for (const block of blocks) {
      block.hidden = false;
      block.style.position = "static";
      block.style.left = "";
      block.style.top = "";
      block.style.width = "";
      block.style.maxWidth = "";
      block.style.maxHeight = "";
      block.style.overflowY = "";
      block.dataset.inkSide = "measure";
    }

    const heights = blocks.map((block) => block.getBoundingClientRect().height);
    heightsRef.current = heights;
    const pages = paginateBlockHeights(heights, leafH, MEASURE_GAP_PX);
    const nextSpreads = buildInkBookSpreads(pages);

    list.style.position = prev.position;
    list.style.height = prev.height;
    list.style.overflow = prev.overflow;
    list.style.display = prev.display;
    list.style.width = prev.width;
    list.style.maxWidth = prev.maxWidth;
    list.style.gap = prev.gap;
    list.style.flexDirection = prev.flexDirection;
    delete list.dataset.inkMeasuring;

    const last = Math.max(0, nextSpreads.length - 1);
    const nextIndex = stickLatestRef.current && followLatest
      ? last
      : clampInkBookSpreadIndex(spreadIndexRef.current, nextSpreads.length);

    setSpreads(nextSpreads);
    setSpreadIndex(nextIndex);
    applySpreadLayout(nextSpreads[nextIndex] ?? null, heights, leafW, leafH);
    measuringRef.current = false;
    scheduleSettleReveal();
  }, [applySpreadLayout, contentRef, enabled, followLatest, scheduleSettleReveal]);

  const scheduleRemmeasure = useCallback(() => {
    if (!enabled) return;
    // History still hydrating — keep the settle timer from firing mid-thrash.
    if (phaseRef.current === "closed" && settleTimerRef.current != null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
    if (remmeasureTimerRef.current != null) window.clearTimeout(remmeasureTimerRef.current);
    remmeasureTimerRef.current = window.setTimeout(() => {
      remmeasureTimerRef.current = null;
      remmeasure();
    }, 48);
  }, [enabled, remmeasure]);

  useLayoutEffect(() => {
    if (!enabled) {
      const list = listRootFrom(contentRef.current);
      if (list) {
        delete list.dataset.inkBook;
        delete list.dataset.inkSpread;
        delete list.dataset.inkMeasuring;
        list.style.position = "";
        list.style.height = "";
        list.style.overflow = "";
        list.style.display = "";
        for (const block of measurableChildren(list)) clearBlockLayout(block);
      }
      return;
    }
    remmeasure();
  }, [children, contentRef, enabled, remmeasure, sessionId]);

  useEffect(() => {
    if (!enabled) return;
    const host = measureHostRef.current;
    const content = contentRef.current;
    if (!host || !content) return;
    const ro = new ResizeObserver(() => scheduleRemmeasure());
    ro.observe(host);
    ro.observe(content);
    const mo = new MutationObserver(() => {
      if (measuringRef.current) return;
      scheduleRemmeasure();
    });
    mo.observe(content, { childList: true, subtree: true, characterData: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [contentRef, enabled, scheduleRemmeasure]);

  useEffect(() => () => {
    if (turnTimerRef.current != null) window.clearTimeout(turnTimerRef.current);
    if (remmeasureTimerRef.current != null) window.clearTimeout(remmeasureTimerRef.current);
    if (settleTimerRef.current != null) window.clearTimeout(settleTimerRef.current);
    if (openTimerRef.current != null) window.clearTimeout(openTimerRef.current);
  }, []);

  const goToSpread = useCallback((next: number, direction: "next" | "prev") => {
    const host = measureHostRef.current;
    const leafW = host
      ? Math.max(160, Math.floor((host.clientWidth - SPINE_GAP_PX) / 2))
      : 320;
    const leafH = host
      ? Math.max(120, Math.floor(host.clientHeight - 8))
      : 400;
    const clamped = clampInkBookSpreadIndex(next, spreads.length);
    if (clamped === spreadIndex) return;
    stickLatestRef.current = clamped >= spreads.length - 1;
    setTurning(direction);
    // Mid-curl swap feels closer to a real page turn than swapping at t=0.
    window.setTimeout(() => {
      setSpreadIndex(clamped);
      applySpreadLayout(spreads[clamped] ?? null, heightsRef.current, leafW, leafH);
    }, Math.floor(TURN_MS * 0.42));
    if (turnTimerRef.current != null) window.clearTimeout(turnTimerRef.current);
    turnTimerRef.current = window.setTimeout(() => setTurning(null), TURN_MS);
  }, [applySpreadLayout, spreadIndex, spreads]);

  const onPrev = useCallback(() => {
    goToSpread(spreadIndex - 1, "prev");
  }, [goToSpread, spreadIndex]);

  const onNext = useCallback(() => {
    goToSpread(spreadIndex + 1, "next");
  }, [goToSpread, spreadIndex]);

  const label = useMemo(
    () => inkBookSpreadLabel(spreadIndex, spreads.length),
    [spreadIndex, spreads.length],
  );

  if (!enabled) {
    return (
      <div
        ref={scrollRef}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onPointerDown={onPointerDown}
        onScroll={onScroll}
        className={className}
      >
        <div ref={contentRef} className={contentClassName || "mx-auto w-full max-w-[1200px] px-2 sm:px-0"}>
          {children}
        </div>
      </div>
    );
  }

  const coverBusy = phase === "closed";
  const showCover = phase !== "open";

  return (
    <div
      ref={scrollRef}
      className="absolute inset-0 flex min-h-0 flex-col overflow-hidden px-3 py-3 sm:px-5"
      data-wodeapp-ink-book="1"
      data-ink-engine="css-curl"
      data-ink-phase={phase}
      data-ink-turning={turning || "0"}
      onWheel={(event) => {
        onWheel?.(event);
      }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onPointerDown={onPointerDown}
      onScroll={onScroll}
    >
      <div
        ref={measureHostRef}
        className="wapp-ink-book-spread relative min-h-0 flex-1"
        data-page-height={pageHeight || undefined}
        data-ink-phase={phase}
      >
        <div className="wapp-ink-book-leaf wapp-ink-book-leaf-left" aria-hidden="true" />
        <div className="wapp-ink-book-spine" aria-hidden="true" />
        <div className="wapp-ink-book-leaf wapp-ink-book-leaf-right" aria-hidden="true" />
        <div
          className={
            turning === "next"
              ? "wapp-ink-book-turn is-next"
              : turning === "prev"
                ? "wapp-ink-book-turn is-prev"
                : "wapp-ink-book-turn"
          }
          aria-hidden="true"
        >
          <span className="wapp-ink-book-turn-face" />
          <span className="wapp-ink-book-turn-shade" />
        </div>
        <div
          ref={contentRef}
          data-ink-phase={phase}
          className={
            contentClassName
              ? `wapp-ink-book-content relative z-[1] h-full ${contentClassName}`
              : "wapp-ink-book-content relative z-[1] mx-auto h-full w-full max-w-[1200px]"
          }
        >
          {children}
        </div>
        {showCover ? (
          <div
            className={
              phase === "opening"
                ? "wapp-ink-book-cover is-opening"
                : "wapp-ink-book-cover"
            }
            aria-hidden={!coverBusy}
            aria-busy={coverBusy || undefined}
          >
            <div className="wapp-ink-book-cover-board">
              <span className="wapp-ink-book-cover-seal">墨</span>
              <span className="wapp-ink-book-cover-title">水墨书卷</span>
              {coverBusy ? (
                <span className="wapp-ink-book-cover-status">装订中</span>
              ) : null}
            </div>
            <div className="wapp-ink-book-cover-edge" aria-hidden="true" />
          </div>
        ) : null}
      </div>

      <nav
        className="wapp-ink-book-pager shrink-0"
        aria-label="书卷翻页"
        data-ink-phase={phase}
      >
        <button
          type="button"
          className="wapp-ink-book-pager-btn"
          onClick={onPrev}
          disabled={phase !== "open" || spreadIndex <= 0 || Boolean(turning)}
        >
          上一开
        </button>
        <span className="wapp-ink-book-pager-label">
          {phase === "open" ? label : "装订中"}
        </span>
        <button
          type="button"
          className="wapp-ink-book-pager-btn"
          onClick={onNext}
          disabled={phase !== "open" || spreadIndex >= spreads.length - 1 || Boolean(turning)}
        >
          下一开
        </button>
      </nav>
    </div>
  );
}
