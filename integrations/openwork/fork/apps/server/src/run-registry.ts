import { ApiError } from "./errors.js";
import type { NormalizedEngineRun, NormalizedEngineRunState } from "./engine/engine-types.js";

export type RegisteredRunState = "starting" | NormalizedEngineRunState;

export interface RegisteredRun {
  workspaceId: string;
  sessionId: string;
  state: RegisteredRunState;
  epoch: number;
  startedAt: number;
  updatedAt: number;
  sourceStatus?: string;
}

export interface RunTicket {
  workspaceId: string;
  sessionId: string;
  epoch: number;
}

export interface ReloadLease {
  workspaceId: string;
  epoch: number;
  release(): void;
}

interface WorkspaceRunState {
  epoch: number;
  reloadInProgress: boolean;
  runs: Map<string, RegisteredRun>;
}

interface RunRegistryOptions {
  now?: () => number;
  engineAbsenceGraceMs?: number;
}

const DEFAULT_ENGINE_ABSENCE_GRACE_MS = 5_000;

function newWorkspaceState(): WorkspaceRunState {
  return {
    epoch: 0,
    reloadInProgress: false,
    runs: new Map(),
  };
}

export function sessionIdForRunStart(method: string, proxyPath: string): string | null {
  if (method.toUpperCase() !== "POST") return null;
  const withoutPrefix = proxyPath.trim().replace(/^\/opencode(?=\/|$)/, "");
  const normalized = (withoutPrefix || "/").replace(/\/+$/, "");
  const match = normalized.match(/^\/session\/([^/]+)\/(?:prompt_async|command|summarize)$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

export class RunRegistry {
  private readonly states = new Map<string, WorkspaceRunState>();
  private readonly now: () => number;
  private readonly engineAbsenceGraceMs: number;

  constructor(options: RunRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.engineAbsenceGraceMs = options.engineAbsenceGraceMs ?? DEFAULT_ENGINE_ABSENCE_GRACE_MS;
  }

  private state(workspaceId: string): WorkspaceRunState {
    let state = this.states.get(workspaceId);
    if (!state) {
      state = newWorkspaceState();
      this.states.set(workspaceId, state);
    }
    return state;
  }

  beginRun(workspaceId: string, sessionId: string): RunTicket {
    const state = this.state(workspaceId);
    if (state.reloadInProgress) {
      throw new ApiError(
        409,
        "engine_reload_in_progress",
        "The workspace engine is reloading; retry the prompt after reload completes",
        { workspaceId, sessionId, epoch: state.epoch },
      );
    }
    const now = this.now();
    const epoch = ++state.epoch;
    state.runs.set(sessionId, {
      workspaceId,
      sessionId,
      state: "starting",
      epoch,
      startedAt: now,
      updatedAt: now,
    });
    return { workspaceId, sessionId, epoch };
  }

  markAccepted(ticket: RunTicket): void {
    const current = this.state(ticket.workspaceId).runs.get(ticket.sessionId);
    if (!current || current.epoch !== ticket.epoch) return;
    current.state = "active";
    current.updatedAt = this.now();
  }

  markFailed(ticket: RunTicket): void {
    const state = this.state(ticket.workspaceId);
    const current = state.runs.get(ticket.sessionId);
    if (current?.epoch === ticket.epoch) {
      state.runs.delete(ticket.sessionId);
    }
  }

  reconcile(workspaceId: string, liveRuns: NormalizedEngineRun[]): RegisteredRun[] {
    const state = this.state(workspaceId);
    const now = this.now();
    const liveBySession = new Map(liveRuns.map((run) => [run.sessionId, run]));

    for (const [sessionId, run] of state.runs) {
      const live = liveBySession.get(sessionId);
      if (live) {
        run.state = live.state;
        run.sourceStatus = live.sourceStatus;
        run.updatedAt = now;
        liveBySession.delete(sessionId);
        continue;
      }
      if (now - run.updatedAt >= this.engineAbsenceGraceMs) {
        state.runs.delete(sessionId);
      }
    }

    for (const live of liveBySession.values()) {
      const epoch = ++state.epoch;
      state.runs.set(live.sessionId, {
        workspaceId,
        sessionId: live.sessionId,
        state: live.state,
        sourceStatus: live.sourceStatus,
        epoch,
        startedAt: now,
        updatedAt: now,
      });
    }

    return this.list(workspaceId);
  }

  list(workspaceId: string): RegisteredRun[] {
    return [...this.state(workspaceId).runs.values()]
      .map((run) => ({ ...run }))
      .sort((left, right) => left.epoch - right.epoch);
  }

  snapshot(workspaceId: string): { epoch: number; reloadInProgress: boolean; items: RegisteredRun[] } {
    const state = this.state(workspaceId);
    return {
      epoch: state.epoch,
      reloadInProgress: state.reloadInProgress,
      items: this.list(workspaceId),
    };
  }

  beginReload(workspaceId: string, expectedEpoch?: number): ReloadLease {
    const state = this.state(workspaceId);
    if (state.reloadInProgress) {
      throw new ApiError(409, "reload_in_progress", "A workspace engine reload is already in progress", {
        workspaceId,
        epoch: state.epoch,
      });
    }
    if (expectedEpoch !== undefined && expectedEpoch !== state.epoch) {
      throw new ApiError(409, "run_epoch_changed", "Workspace run state changed before reload could start", {
        workspaceId,
        expectedEpoch,
        currentEpoch: state.epoch,
      });
    }
    state.reloadInProgress = true;
    let released = false;
    return {
      workspaceId,
      epoch: state.epoch,
      release: () => {
        if (released) return;
        released = true;
        state.reloadInProgress = false;
      },
    };
  }

  clearRuns(workspaceId: string): void {
    this.state(workspaceId).runs.clear();
  }
}
