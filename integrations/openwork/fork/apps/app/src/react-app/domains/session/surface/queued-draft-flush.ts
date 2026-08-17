/**
 * Queued follow-up flush rules.
 *
 * Auto-drain must key off the authoritative OpenCode run state (sending / busy /
 * retry / idle). Sticky WodeApp-local UI activity ("responding", awaiting
 * assistant baseline) can lag after a turn truly finishes — if auto-drain waits
 * on that broader `chatStreaming` flag, queued messages stay stuck forever even
 * though the conversation already completed.
 *
 * System silent auto-continue drafts must not linger in the user-visible queue
 * after the user takes over with a real prompt.
 */

export type QueuedDraftFlushMode = "auto-idle" | "now";

export type QueuedDraftFlushGateInput = {
  mode: QueuedDraftFlushMode;
  queueLength: number;
  draining: boolean;
  /** True while a real OpenCode run is in flight (sending | busy | retry). */
  openCodeRunActive: boolean;
  liveStatusType: string;
  /**
   * Manual Stop latch. Keep the user's queued follow-ups visible, but pause
   * auto-idle drain so abort→idle cannot instantly re-prompt (#2014).
   * Mode `now` (panel 发送) is unaffected.
   */
  userStopped?: boolean;
  index?: number;
};

export function canFlushQueuedDrafts(input: QueuedDraftFlushGateInput): boolean {
  if (input.draining) return false;
  if (input.queueLength <= 0) return false;
  if (input.mode === "auto-idle") {
    if (input.userStopped) return false;
    // Do not consult sticky local activity here — only OpenCode run state.
    return !input.openCodeRunActive && input.liveStatusType === "idle";
  }
  if (typeof input.index !== "number" || input.index < 0 || input.index >= input.queueLength) {
    return false;
  }
  return true;
}

export type QueuedDraftLike = {
  text?: string;
  resolvedText?: string;
};

export function isSilentAutoContinueDraft(
  draft: QueuedDraftLike,
  isSilentAutoContinue: (text: string | undefined) => boolean,
): boolean {
  return isSilentAutoContinue(draft.text) || isSilentAutoContinue(draft.resolvedText);
}

/** User-visible queue entries (system auto-continue stays out of the panel). */
export function listVisibleQueuedDraftEntries<T extends QueuedDraftLike>(
  drafts: T[],
  isSilentAutoContinue: (text: string | undefined) => boolean,
): Array<{ draft: T; index: number }> {
  return drafts
    .map((draft, index) => ({ draft, index }))
    .filter(({ draft }) => !isSilentAutoContinueDraft(draft, isSilentAutoContinue));
}

/** Drop silent auto-continue drafts; keep real user follow-ups. */
export function retainNonSilentQueuedDrafts<T extends QueuedDraftLike>(
  drafts: T[],
  isSilentAutoContinue: (text: string | undefined) => boolean,
): T[] {
  return drafts.filter((draft) => !isSilentAutoContinueDraft(draft, isSilentAutoContinue));
}

export function pickQueuedDraftFlushIndex(
  mode: QueuedDraftFlushMode,
  drafts: QueuedDraftLike[],
  index: number | undefined,
  isSilentAutoContinue: (text: string | undefined) => boolean,
): number {
  if (mode === "now") {
    return typeof index === "number" ? index : -1;
  }
  const silentIndex = drafts.findIndex((draft) => (
    isSilentAutoContinueDraft(draft, isSilentAutoContinue)
  ));
  return silentIndex >= 0 ? silentIndex : 0;
}
