import { describe, expect, test } from "bun:test";

import { deriveSessionRenderModel } from "../src/react-app/domains/session/sync/transition-controller";

describe("session transition controller", () => {
  test("keeps a rendered session interactive during background refresh", () => {
    expect(deriveSessionRenderModel({
      intendedSessionId: "ses_current",
      renderedSessionId: "ses_current",
      hasSnapshot: true,
      isFetching: true,
      isError: false,
    })).toMatchObject({
      transitionState: "idle",
      renderSource: "live",
    });
  });

  test("still blocks interaction while the requested session has no snapshot", () => {
    expect(deriveSessionRenderModel({
      intendedSessionId: "ses_next",
      renderedSessionId: null,
      hasSnapshot: false,
      isFetching: true,
      isError: false,
    })).toMatchObject({
      transitionState: "switching",
      renderSource: "empty",
    });
  });
});
