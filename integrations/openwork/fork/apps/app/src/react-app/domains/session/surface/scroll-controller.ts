import { useCallback, useEffect, useRef, type RefObject, type UIEventHandler } from "react";

import { getSessionScrollState, useSessionScrollStore, type SessionScrollState } from "./scroll-store";

function readScrollState(sessionId: string | null): SessionScrollState {
  return getSessionScrollState(useSessionScrollStore.getState().sessions, sessionId);
}

function isStickyBottom(sessionId: string | null) {
  return readScrollState(sessionId).mode === "stickyBottom";
}

const EXACT_BOTTOM_GAP_PX = 1;
// Widened from 250ms so a single wheel or trackpad flick isn't missed between
// two rapid programmatic scroll-to-bottom frames during streaming.
const SCROLL_GESTURE_WINDOW_MS = 600;
// Threshold (px) that counts as a meaningful "scroll upward" gesture. Anything
// smaller is treated as anchoring jitter and ignored so we don't trip out of
// sticky bottom mode for pixel-level content growth.
const MANUAL_BROWSE_UPWARD_THRESHOLD_PX = 16;

type SessionScrollControllerOptions = {
  selectedSessionId: string | null;
  renderedMessages: unknown;
  containerRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  restoreManualScroll?: boolean;
};

function scrollBottomGap(container: HTMLElement) {
  return container.scrollHeight - (container.scrollTop + container.clientHeight);
}

function isExactlyAtBottom(container: HTMLElement) {
  return scrollBottomGap(container) <= EXACT_BOTTOM_GAP_PX;
}

function messageIdForElement(element: HTMLElement) {
  const id = element.getAttribute("data-message-id")?.trim();
  return id && id.length > 0 ? id : null;
}

function latestMessageElement(container: HTMLElement) {
  const messageEls = container.querySelectorAll("[data-message-id]");
  for (let index = messageEls.length - 1; index >= 0; index -= 1) {
    const element = messageEls.item(index);
    if (element instanceof HTMLElement) return element;
  }
  return null;
}

function messageElementById(container: HTMLElement, messageId: string) {
  const messageEls = container.querySelectorAll("[data-message-id]");
  for (const element of messageEls) {
    if (!(element instanceof HTMLElement)) continue;
    if (messageIdForElement(element) === messageId) return element;
  }
  return null;
}

function isMessageTopClipped(container: HTMLElement, message: HTMLElement) {
  const containerRect = container.getBoundingClientRect();
  const messageRect = message.getBoundingClientRect();
  // Top of this message has scrolled above the reading pane.
  return messageRect.top < containerRect.top - 1 && messageRect.bottom > containerRect.top + 8;
}

function latestMessageTopClippedId(container: HTMLElement) {
  const latestMessage = latestMessageElement(container);
  if (!latestMessage) return null;

  const messageId = messageIdForElement(latestMessage);
  if (!messageId) return null;

  const containerRect = container.getBoundingClientRect();
  const latestRect = latestMessage.getBoundingClientRect();
  const lastMessageDoesNotFit = latestRect.height > containerRect.height + 1;
  const startVisible = latestRect.top >= containerRect.top - 1 && latestRect.top <= containerRect.bottom + 1;

  if (lastMessageDoesNotFit && !startVisible) return messageId;

  // Multi-step assistant turns often end on a short tool row while the long
  // prose (or media) above has already been yanked out of view by sticky
  // bottom. Surface the earliest clipped assistant message in that live turn
  // so "跳到开头" can restore what the user was reading.
  const messageEls = container.querySelectorAll("[data-message-id]");
  let lastUserIndex = -1;
  for (let index = messageEls.length - 1; index >= 0; index -= 1) {
    const element = messageEls.item(index);
    if (!(element instanceof HTMLElement)) continue;
    if (element.getAttribute("data-message-role") === "user") {
      lastUserIndex = index;
      break;
    }
  }
  for (let index = lastUserIndex + 1; index < messageEls.length; index += 1) {
    const element = messageEls.item(index);
    if (!(element instanceof HTMLElement)) continue;
    if (element.getAttribute("data-message-role") !== "assistant") continue;
    if (!isMessageTopClipped(container, element)) continue;
    const id = messageIdForElement(element);
    if (id) return id;
  }

  return null;
}

export function useSessionScrollController(
  options: SessionScrollControllerOptions,
) {
  const selectedSessionId = options.selectedSessionId;
  const setStickyBottom = useSessionScrollStore((state) => state.setStickyBottom);
  const setManualScroll = useSessionScrollStore((state) => state.setManualScroll);
  const setTopClippedMessageId = useSessionScrollStore((state) => state.setTopClippedMessageId);

  const lastKnownScrollTopRef = useRef(0);
  const programmaticScrollRef = useRef(false);
  const programmaticScrollResetRafARef = useRef<number | undefined>(undefined);
  const programmaticScrollResetRafBRef = useRef<number | undefined>(undefined);
  const observedContentHeightRef = useRef(0);
  const observedContainerHeightRef = useRef(0);
  const lastGestureAtRef = useRef(0);
  const previousSessionIdRef = useRef<string | null>(null);
  const hasScrollGesture = useCallback(
    () => Date.now() - lastGestureAtRef.current < SCROLL_GESTURE_WINDOW_MS,
    [],
  );

  const updateOverflowAnchor = useCallback(() => {
    const container = options.containerRef.current;
    if (!container) return;
    container.style.overflowAnchor = isStickyBottom(selectedSessionId) ? "none" : "auto";
  }, [options.containerRef, selectedSessionId]);

  const markScrollGesture = useCallback(
    (target?: EventTarget | null) => {
      const container = options.containerRef.current;
      if (!container) return;

      const el = target instanceof Element ? target : undefined;
      const nested = el?.closest("[data-scrollable]");
      if (nested && nested !== container) return;

      lastGestureAtRef.current = Date.now();
    },
    [options.containerRef],
  );

  const clearProgrammaticScrollReset = useCallback(() => {
    if (programmaticScrollResetRafARef.current !== undefined) {
      window.cancelAnimationFrame(programmaticScrollResetRafARef.current);
      programmaticScrollResetRafARef.current = undefined;
    }
    if (programmaticScrollResetRafBRef.current !== undefined) {
      window.cancelAnimationFrame(programmaticScrollResetRafBRef.current);
      programmaticScrollResetRafBRef.current = undefined;
    }
  }, []);

  const releaseProgrammaticScrollSoon = useCallback(() => {
    clearProgrammaticScrollReset();
    programmaticScrollResetRafARef.current = window.requestAnimationFrame(() => {
      programmaticScrollResetRafARef.current = undefined;
      programmaticScrollResetRafBRef.current = window.requestAnimationFrame(() => {
        programmaticScrollResetRafBRef.current = undefined;
        programmaticScrollRef.current = false;
      });
    });
  }, [clearProgrammaticScrollReset]);

  const refreshTopClippedMessage = useCallback(() => {
    const container = options.containerRef.current;
    const nextId = container ? latestMessageTopClippedId(container) : null;
    setTopClippedMessageId(selectedSessionId, nextId);
    return nextId;
  }, [options.containerRef, selectedSessionId, setTopClippedMessageId]);

  const finishStickyScroll = useCallback(
    (container: HTMLElement) => {
      lastKnownScrollTopRef.current = container.scrollTop;
      // Keep clipped-id so 「跳到开头」 stays available while sticky-chasing
      // a tall reply. Do not pin-start here — user wants normal sticky tail.
      setStickyBottom(selectedSessionId, latestMessageTopClippedId(container));
      releaseProgrammaticScrollSoon();
    },
    [releaseProgrammaticScrollSoon, selectedSessionId, setStickyBottom],
  );

  const scrollToBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const container = options.containerRef.current;
      if (!container) return;

      programmaticScrollRef.current = true;

      if (behavior === "smooth") {
        container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
        window.requestAnimationFrame(() => {
          const next = options.containerRef.current;
          if (!next) {
            programmaticScrollRef.current = false;
            return;
          }
          finishStickyScroll(next);
        });
        return;
      }

      container.scrollTop = container.scrollHeight;
      lastKnownScrollTopRef.current = container.scrollTop;
      window.requestAnimationFrame(() => {
        const next = options.containerRef.current;
        if (!next) {
          programmaticScrollRef.current = false;
          return;
        }
        next.scrollTop = next.scrollHeight;
        finishStickyScroll(next);
      });
    },
    [finishStickyScroll, options.containerRef],
  );

  const saveScrollPosition = useCallback(
    (container: HTMLDivElement) => {
      const nextTopClippedMessageId = latestMessageTopClippedId(container);
      if (isExactlyAtBottom(container)) {
        setStickyBottom(selectedSessionId, nextTopClippedMessageId);
      } else {
        setManualScroll(selectedSessionId, container.scrollTop, nextTopClippedMessageId);
      }
      return nextTopClippedMessageId;
    },
    [selectedSessionId, setManualScroll, setStickyBottom],
  );

  const handleScroll = useCallback<UIEventHandler<HTMLDivElement>>(
    (event) => {
      const container = event.currentTarget;
      const currentTop = container.scrollTop;
      const previousTop = lastKnownScrollTopRef.current;
      const delta = currentTop - previousTop;
      const scrolledUp = delta <= -MANUAL_BROWSE_UPWARD_THRESHOLD_PX;
      const userGestured = hasScrollGesture();

      // If the user scrolls up meaningfully while a programmatic scroll is
      // in flight, abandon the programmatic state and switch to manual browse
      // immediately. Without this the ResizeObserver's auto-scroll during
      // streaming keeps re-anchoring us to the bottom and the user can never
      // actually get away from the tail of the transcript.
      if (programmaticScrollRef.current && (userGestured || scrolledUp)) {
        programmaticScrollRef.current = false;
        clearProgrammaticScrollReset();
        saveScrollPosition(container);
        lastKnownScrollTopRef.current = currentTop;
        return;
      }

      if (programmaticScrollRef.current) {
        lastKnownScrollTopRef.current = currentTop;
        refreshTopClippedMessage();
        return;
      }

      if (!userGestured && !scrolledUp) {
        if (isExactlyAtBottom(container)) {
          setStickyBottom(selectedSessionId, latestMessageTopClippedId(container));
        } else {
          refreshTopClippedMessage();
        }
        lastKnownScrollTopRef.current = currentTop;
        return;
      }

      saveScrollPosition(container);
      lastKnownScrollTopRef.current = currentTop;
    },
    [clearProgrammaticScrollReset, hasScrollGesture, refreshTopClippedMessage, saveScrollPosition, selectedSessionId, setStickyBottom],
  );

  const jumpToLatest = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      scrollToBottom(behavior);
    },
    [scrollToBottom],
  );

  const jumpToStartOfMessage = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      const messageId = readScrollState(selectedSessionId).topClippedMessageId;
      const container = options.containerRef.current;
      if (!messageId || !container) return;

      const target = messageElementById(container, messageId);
      if (!target) return;

      setManualScroll(selectedSessionId, container.scrollTop, messageId);
      target.scrollIntoView({ behavior, block: "start" });
    },
    [options.containerRef, selectedSessionId, setManualScroll],
  );

  useEffect(() => {
    updateOverflowAnchor();
    return useSessionScrollStore.subscribe(updateOverflowAnchor);
  }, [updateOverflowAnchor]);

  useEffect(() => {
    const content = options.contentRef.current;
    const container = options.containerRef.current;
    if (!content) return;

    observedContentHeightRef.current = content.offsetHeight;
    observedContainerHeightRef.current = container?.clientHeight ?? 0;

    const reanchorIfSticky = () => {
      // Sticky means "keep the newest content pinned". Content growth is the
      // common case, but sending also clears/resizes the composer so the
      // scrollport clientHeight changes while scrollTop stays put — gap opens
      // and the transcript appears to jump upward even though mode is still
      // stickyBottom. Re-anchor on either signal unless the user is gesturing.
      if (!isStickyBottom(selectedSessionId) || hasScrollGesture()) {
        refreshTopClippedMessage();
        return;
      }
      scrollToBottom("auto");
    };

    const observer = new ResizeObserver(() => {
      const nextContent = options.contentRef.current;
      const nextContainer = options.containerRef.current;
      if (!nextContent) return;

      const nextContentHeight = nextContent.offsetHeight;
      const nextContainerHeight = nextContainer?.clientHeight ?? 0;
      const contentChanged =
        Math.abs(nextContentHeight - observedContentHeightRef.current) > 1;
      const containerChanged =
        Math.abs(nextContainerHeight - observedContainerHeightRef.current) > 1;
      observedContentHeightRef.current = nextContentHeight;
      observedContainerHeightRef.current = nextContainerHeight;

      if (!contentChanged && !containerChanged) {
        refreshTopClippedMessage();
        return;
      }

      reanchorIfSticky();
    });

    observer.observe(content);
    if (container) observer.observe(container);
    return () => observer.disconnect();
  }, [
    hasScrollGesture,
    options.containerRef,
    options.contentRef,
    refreshTopClippedMessage,
    scrollToBottom,
    selectedSessionId,
  ]);

  useEffect(() => {
    if (selectedSessionId === previousSessionIdRef.current) return;
    previousSessionIdRef.current = selectedSessionId;
    if (!selectedSessionId) return;

    observedContentHeightRef.current = 0;
    observedContainerHeightRef.current = 0;
    lastKnownScrollTopRef.current = 0;
    queueMicrotask(() => {
      const container = options.containerRef.current;
      if (!container) return;

      const savedState = getSessionScrollState(useSessionScrollStore.getState().sessions, selectedSessionId);
      if (options.restoreManualScroll !== false && savedState.mode === "manual") {
        programmaticScrollRef.current = true;
        container.scrollTop = Math.min(savedState.scrollTop, Math.max(0, container.scrollHeight - container.clientHeight));
        lastKnownScrollTopRef.current = container.scrollTop;
        window.requestAnimationFrame(() => {
          const next = options.containerRef.current;
          if (!next) {
            programmaticScrollRef.current = false;
            return;
          }
          next.scrollTop = Math.min(savedState.scrollTop, Math.max(0, next.scrollHeight - next.clientHeight));
          lastKnownScrollTopRef.current = next.scrollTop;
          saveScrollPosition(next);
          releaseProgrammaticScrollSoon();
        });
        return;
      }

      scrollToBottom("auto");
    });
  }, [options.containerRef, options.restoreManualScroll, releaseProgrammaticScrollSoon, saveScrollPosition, scrollToBottom, selectedSessionId]);

  useEffect(() => {
    void options.renderedMessages;
    queueMicrotask(refreshTopClippedMessage);
  }, [options.renderedMessages, refreshTopClippedMessage]);

  useEffect(() => {
    return () => {
      clearProgrammaticScrollReset();
    };
  }, [clearProgrammaticScrollReset]);

  return {
    handleScroll,
    markScrollGesture,
    scrollToBottom,
    jumpToLatest,
    jumpToStartOfMessage,
  };
}
