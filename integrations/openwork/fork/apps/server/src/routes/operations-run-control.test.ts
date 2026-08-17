import { describe, expect, test } from "bun:test";
import type { EngineAdapter, NormalizedEngineRun } from "../engine/engine-types.js";
import { ApiError } from "../errors.js";
import { RunRegistry } from "../run-registry.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { matchRoute, type RequestContext, type Route } from "./registry.js";
import { registerOperationRoutes } from "./operations.js";

const workspace: WorkspaceInfo = {
  id: "workspace-1",
  name: "Workspace",
  path: "/tmp/workspace-1",
  preset: "default",
  workspaceType: "local",
  baseUrl: "http://127.0.0.1:4096",
};

function createReloadHandler(adapter: EngineAdapter, runRegistry: RunRegistry) {
  const routes: Route[] = [];
  registerOperationRoutes({
    routes,
    config: {} as ServerConfig,
    jsonResponse: (data, status = 200) => Response.json(data, { status }),
    readJsonBody: async () => ({}),
    readOptionalJsonBody: async () => ({}),
    requireClientScope: () => undefined,
    resolveWorkspace: async () => workspace,
    createEngineAdapter: () => adapter,
    runRegistry,
  });
  const route = matchRoute(routes, "POST", `/workspace/${workspace.id}/engine/reload`);
  if (!route) throw new Error("reload route was not registered");
  return () =>
    route.handler({
      request: new Request(`http://localhost/workspace/${workspace.id}/engine/reload`, { method: "POST" }),
      url: new URL(`http://localhost/workspace/${workspace.id}/engine/reload`),
      params: route.params,
      config: {} as ServerConfig,
      actor: { type: "remote", scope: "collaborator" },
    } as RequestContext);
}

describe("operation reload run control", () => {
  test("holds the server-side reload lease while engine status is checked", async () => {
    const registry = new RunRegistry({ engineAbsenceGraceMs: 0 });
    let resolveStatus: ((runs: NormalizedEngineRun[]) => void) | undefined;
    let statusStartedResolve: (() => void) | undefined;
    const statusStarted = new Promise<void>((resolve) => {
      statusStartedResolve = resolve;
    });
    const adapter: EngineAdapter = {
      protocol: "opencode-v1",
      capabilities: { atomicReload: false, dynamicPluginReload: false, serviceOwnership: false },
      activeRuns: () => {
        statusStartedResolve?.();
        return new Promise((resolve) => {
          resolveStatus = resolve;
        });
      },
      reload: async () => undefined,
    };

    const reloadPromise = createReloadHandler(adapter, registry)();
    await statusStarted;
    expect(() => registry.beginRun(workspace.id, "new-session")).toThrow(ApiError);

    resolveStatus?.([{ sessionId: "external-session", state: "active", sourceStatus: "busy" }]);
    try {
      await reloadPromise;
      throw new Error("expected reload to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("active_runs");
    }

    expect(() => registry.beginRun(workspace.id, "after-reload-check")).not.toThrow();
  });

  test("blocks reload during the proxy-to-engine status propagation window", async () => {
    const registry = new RunRegistry({ engineAbsenceGraceMs: 5_000 });
    const ticket = registry.beginRun(workspace.id, "session-1");
    registry.markAccepted(ticket);
    const adapter: EngineAdapter = {
      protocol: "opencode-v1",
      capabilities: { atomicReload: false, dynamicPluginReload: false, serviceOwnership: false },
      activeRuns: async () => [],
      reload: async () => {
        throw new Error("reload must not be reached");
      },
    };

    try {
      await createReloadHandler(adapter, registry)();
      throw new Error("expected reload to be rejected");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("active_runs");
    }
  });
});
