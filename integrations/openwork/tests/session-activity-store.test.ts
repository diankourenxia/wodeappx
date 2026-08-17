import { describe, expect, test } from "bun:test";

import {
  isBlockingSessionActivityStatus,
  useSessionActivityStore,
} from "../src/react-app/domains/session/status/session-activity-store";

describe("session activity status", () => {
  test("treats visible errors as non-blocking so the composer can recover", () => {
    expect(isBlockingSessionActivityStatus("thinking")).toBe(true);
    expect(isBlockingSessionActivityStatus("responding")).toBe(true);
    expect(isBlockingSessionActivityStatus("waiting")).toBe(true);
    expect(isBlockingSessionActivityStatus("compacting")).toBe(true);
    expect(isBlockingSessionActivityStatus("idle")).toBe(false);
    expect(isBlockingSessionActivityStatus("error")).toBe(false);
  });

  test("a failed send records an error without leaving the session locally running", () => {
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    const sessionId = `session-${crypto.randomUUID()}`;

    useSessionActivityStore.getState().setRunStatus(workspaceId, sessionId, { type: "busy" });
    expect(useSessionActivityStore.getState().getStatus(workspaceId, sessionId)).toBe("thinking");

    useSessionActivityStore.getState().setError(workspaceId, sessionId, "413 Request Entity Too Large");

    const status = useSessionActivityStore.getState().getStatus(workspaceId, sessionId);
    expect(status).toBe("error");
    expect(isBlockingSessionActivityStatus(status)).toBe(false);
    expect(useSessionActivityStore.getState().getSessionError(workspaceId, sessionId)).toContain("413");
  });

  test("a completed assistant snapshot settles a run without accepting an older idle snapshot", () => {
    const workspaceId = `workspace-${crypto.randomUUID()}`;
    const sessionId = `session-${crypto.randomUUID()}`;
    const store = useSessionActivityStore.getState();
    const oldCompletion = Date.now() - 10_000;

    store.setRunStatus(workspaceId, sessionId, { type: "busy" });
    store.markMessageRole(workspaceId, sessionId, "assistant-message", "assistant");
    store.markAssistantOutput(workspaceId, sessionId, "assistant-message");
    expect(store.getStatus(workspaceId, sessionId)).toBe("responding");

    store.seedSessionRun(workspaceId, sessionId, { type: "idle" }, true, {
      assistantCompletedAt: oldCompletion,
    });
    expect(store.getStatus(workspaceId, sessionId)).toBe("responding");

    store.seedSessionRun(workspaceId, sessionId, { type: "idle" }, true, {
      assistantCompletedAt: Date.now() + 1,
    });
    expect(store.getStatus(workspaceId, sessionId)).toBe("idle");
  });
});

