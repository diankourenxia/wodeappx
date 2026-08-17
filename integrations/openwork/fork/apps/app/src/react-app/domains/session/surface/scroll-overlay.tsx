import { memo, useCallback } from "react";

import {
  selectSessionIsStickyBottom,
  selectSessionTopClippedMessageId,
  useSessionScrollStore,
} from "./scroll-store";

function useSessionScrollOverlayState(sessionId: string) {
  const isAtBottom = useSessionScrollStore((state) => selectSessionIsStickyBottom(state.sessions, sessionId));
  const topClippedMessageId = useSessionScrollStore((state) => selectSessionTopClippedMessageId(state.sessions, sessionId));

  return { isAtBottom, topClippedMessageId };
}

type JumpToStartButtonProps = {
  onJumpToStartOfMessage: (behavior?: ScrollBehavior) => void;
};

const JumpToStartButton = memo(function JumpToStartButton({
  onJumpToStartOfMessage,
}: JumpToStartButtonProps) {
  const handleClick = useCallback(() => {
    onJumpToStartOfMessage("smooth");
  }, [onJumpToStartOfMessage]);

  return (
    <button
      type="button"
      className="rounded-full px-3 py-1.5 text-xs text-dls-text transition-colors hover:bg-dls-hover"
      onClick={handleClick}
    >
      跳到开头
    </button>
  );
});

type JumpToLatestButtonProps = {
  onJumpToLatest: (behavior?: ScrollBehavior) => void;
};

const JumpToLatestButton = memo(function JumpToLatestButton({
  onJumpToLatest,
}: JumpToLatestButtonProps) {
  const handleClick = useCallback(() => {
    onJumpToLatest("smooth");
  }, [onJumpToLatest]);

  return (
    <button
      type="button"
      className="rounded-full px-3 py-1.5 text-xs text-dls-text transition-colors hover:bg-dls-hover"
      onClick={handleClick}
    >
      跳到最新
    </button>
  );
});

type SessionScrollOverlayProps = {
  sessionId: string;
  isStreaming: boolean;
  onJumpToLatest: (behavior?: ScrollBehavior) => void;
  onJumpToStartOfMessage: (behavior?: ScrollBehavior) => void;
};

export const SessionScrollOverlay = memo(function SessionScrollOverlay({
  sessionId,
  isStreaming: _isStreaming,
  onJumpToLatest,
  onJumpToStartOfMessage,
}: SessionScrollOverlayProps) {
  const { isAtBottom, topClippedMessageId } = useSessionScrollOverlayState(sessionId);
  // Must stay available while streaming: sticky-bottom + tall replies (or
  // images above the live prose) clip the answer start, which reads as
  // "content flashed away". Hiding this until idle made the bug unrecoverable.
  const showJumpToStart = Boolean(topClippedMessageId);
  const showJumpToLatest = !isAtBottom;

  if (!showJumpToStart && !showJumpToLatest) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute bottom-2 left-1/2 z-30 flex -translate-x-1/2 justify-center">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-dls-border bg-dls-surface/95 p-1 shadow-(--dls-card-shadow) backdrop-blur-md">
        {showJumpToStart ? (
          <JumpToStartButton onJumpToStartOfMessage={onJumpToStartOfMessage} />
        ) : null}
        {showJumpToLatest ? (
          <JumpToLatestButton onJumpToLatest={onJumpToLatest} />
        ) : null}
      </div>
    </div>
  );
});
