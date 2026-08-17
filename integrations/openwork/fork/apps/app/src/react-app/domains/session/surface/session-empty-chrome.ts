/** Top-composer welcome hero is only for a server-confirmed empty session. */
export function shouldShowWodeAppEmptySessionChrome(input: {
  workbench: boolean;
  messageCount: number;
  activityIdle: boolean;
  chatStreaming: boolean;
  hasSnapshot: boolean;
  snapshotFetching: boolean;
  transitionIdle: boolean;
}): boolean {
  return Boolean(
    input.workbench
    && input.messageCount === 0
    && input.activityIdle
    && !input.chatStreaming
    && input.hasSnapshot
    && !input.snapshotFetching
    && input.transitionIdle,
  );
}

/** Cold open / HMR: empty list with no snapshot yet is loading, not a new chat. */
export function shouldShowPendingSessionLoad(input: {
  hasSnapshot: boolean;
  messageCount: number;
  snapshotError: boolean;
  snapshotLoading: boolean;
  snapshotFetching: boolean;
  snapshotFetched: boolean;
}): boolean {
  return Boolean(
    !input.hasSnapshot
    && input.messageCount === 0
    && !input.snapshotError
    && (input.snapshotLoading || input.snapshotFetching || !input.snapshotFetched),
  );
}
