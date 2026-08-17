import { describe, expect, test } from "bun:test";
import { ApiError } from "./errors.js";
import { RunRegistry, sessionIdForRunStart } from "./run-registry.js";

describe("RunRegistry", () => {
  test("rejects new runs while a reload lease is held", () => {
    const registry = new RunRegistry();
    const lease = registry.beginReload("workspace-1");

    expect(() => registry.beginRun("workspace-1", "session-1")).toThrow(ApiError);
    try {
      registry.beginRun("workspace-1", "session-1");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(409);
      expect((error as ApiError).code).toBe("engine_reload_in_progress");
    }

    lease.release();
    const ticket = registry.beginRun("workspace-1", "session-1");
    expect(ticket.epoch).toBe(1);
  });

  test("uses epochs to reject a stale reload decision", () => {
    const registry = new RunRegistry();
    const ticket = registry.beginRun("workspace-1", "session-1");
    registry.markAccepted(ticket);

    expect(() => registry.beginReload("workspace-1", 0)).toThrow(ApiError);
    try {
      registry.beginReload("workspace-1", 0);
    } catch (error) {
      expect((error as ApiError).code).toBe("run_epoch_changed");
      expect((error as ApiError).details).toEqual({
        workspaceId: "workspace-1",
        expectedEpoch: 0,
        currentEpoch: 1,
      });
    }
  });

  test("keeps a just-accepted run during engine status propagation delay", () => {
    let now = 1_000;
    const registry = new RunRegistry({
      now: () => now,
      engineAbsenceGraceMs: 5_000,
    });
    const ticket = registry.beginRun("workspace-1", "session-1");
    registry.markAccepted(ticket);

    now += 4_999;
    expect(registry.reconcile("workspace-1", [])).toHaveLength(1);
    now += 1;
    expect(registry.reconcile("workspace-1", [])).toHaveLength(0);
  });

  test("discovers engine runs that did not enter through the proxy", () => {
    const registry = new RunRegistry();
    const runs = registry.reconcile("workspace-1", [
      { sessionId: "external-session", state: "retrying", sourceStatus: "retry" },
    ]);

    expect(runs).toMatchObject([
      {
        workspaceId: "workspace-1",
        sessionId: "external-session",
        state: "retrying",
        epoch: 1,
      },
    ]);
    expect(registry.snapshot("workspace-1").epoch).toBe(1);
  });

  test("only recognizes mutations that start a generation", () => {
    expect(sessionIdForRunStart("POST", "/session/ses_1/prompt_async")).toBe("ses_1");
    expect(sessionIdForRunStart("POST", "/opencode/session/ses%202/command")).toBe("ses 2");
    expect(sessionIdForRunStart("POST", "/session/ses_3/summarize")).toBe("ses_3");
    expect(sessionIdForRunStart("POST", "/session/ses_1/abort")).toBeNull();
    expect(sessionIdForRunStart("GET", "/session/ses_1/prompt_async")).toBeNull();
  });
});
