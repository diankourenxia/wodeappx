import { describe, expect, test } from "bun:test";

import {
  shouldShowPendingSessionLoad,
  shouldShowWodeAppEmptySessionChrome,
} from "../fork/apps/app/src/react-app/domains/session/surface/session-empty-chrome";

describe("empty session chrome gates (ses_02ff883a welcome flash)", () => {
  test("does not show welcome hero while snapshot is still loading", () => {
    expect(
      shouldShowWodeAppEmptySessionChrome({
        workbench: true,
        messageCount: 0,
        activityIdle: true,
        chatStreaming: false,
        hasSnapshot: false,
        snapshotFetching: true,
        transitionIdle: true,
      }),
    ).toBe(false);
  });

  test("does not show welcome hero before the first snapshot fetch settles", () => {
    expect(
      shouldShowPendingSessionLoad({
        hasSnapshot: false,
        messageCount: 0,
        snapshotError: false,
        snapshotLoading: false,
        snapshotFetching: false,
        snapshotFetched: false,
      }),
    ).toBe(true);

    expect(
      shouldShowWodeAppEmptySessionChrome({
        workbench: true,
        messageCount: 0,
        activityIdle: true,
        chatStreaming: false,
        hasSnapshot: false,
        snapshotFetching: false,
        transitionIdle: true,
      }),
    ).toBe(false);
  });

  test("shows welcome hero only for a confirmed idle empty session", () => {
    expect(
      shouldShowWodeAppEmptySessionChrome({
        workbench: true,
        messageCount: 0,
        activityIdle: true,
        chatStreaming: false,
        hasSnapshot: true,
        snapshotFetching: false,
        transitionIdle: true,
      }),
    ).toBe(true);
  });

  test("never shows welcome hero when the transcript already has messages", () => {
    expect(
      shouldShowWodeAppEmptySessionChrome({
        workbench: true,
        messageCount: 11,
        activityIdle: true,
        chatStreaming: false,
        hasSnapshot: true,
        snapshotFetching: false,
        transitionIdle: true,
      }),
    ).toBe(false);
  });
});
