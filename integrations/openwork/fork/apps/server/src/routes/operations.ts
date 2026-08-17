import { recordAudit } from "../audit.js";
import type { EngineAdapter } from "../engine/engine-types.js";
import { ApiError } from "../errors.js";
import type { RunRegistry } from "../run-registry.js";
import type { ServerConfig, TokenScope, WorkspaceInfo } from "../types.js";
import { shortId } from "../utils.js";
import { addRoute, type RequestContext, type Route } from "./registry.js";

type JsonResponse = (data: unknown, status?: number) => Response;
type ReadJsonBody = (request: Request) => Promise<Record<string, unknown>>;

interface RegisterOperationRoutesOptions {
  routes: Route[];
  config: ServerConfig;
  jsonResponse: JsonResponse;
  readJsonBody: ReadJsonBody;
  readOptionalJsonBody: ReadJsonBody;
  requireClientScope: (ctx: RequestContext, required: TokenScope) => void;
  resolveWorkspace: (config: ServerConfig, id: string) => Promise<WorkspaceInfo>;
  createEngineAdapter: (workspace: WorkspaceInfo) => EngineAdapter;
  runRegistry: RunRegistry;
}

function parseExpectedEpoch(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ApiError(400, "invalid_payload", "expectedRunEpoch must be a non-negative integer");
  }
  return value;
}

export function registerOperationRoutes(options: RegisterOperationRoutesOptions): void {
  const {
    routes,
    config,
    jsonResponse,
    readJsonBody,
    readOptionalJsonBody,
    requireClientScope,
    resolveWorkspace,
    createEngineAdapter,
    runRegistry,
  } = options;

  addRoute(routes, "GET", "/workspace/:id/events", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const sinceRaw = ctx.url.searchParams.get("since");
    const since = sinceRaw ? Number(sinceRaw) : undefined;
    const items = ctx.reloadEvents.list(workspace.id, since);
    return jsonResponse({ items, cursor: ctx.reloadEvents.cursor(), workspaceId: workspace.id, disabled: false });
  });

  addRoute(routes, "GET", "/workspace/:id/runs", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    const adapter = createEngineAdapter(workspace);
    const liveRuns = await adapter.activeRuns();
    runRegistry.reconcile(workspace.id, liveRuns);
    return jsonResponse({
      workspaceId: workspace.id,
      protocol: adapter.protocol,
      ...runRegistry.snapshot(workspace.id),
    });
  });

  addRoute(routes, "POST", "/workspace/:id/engine/reload", "client", async (ctx) => {
    const workspace = await resolveWorkspace(config, ctx.params.id);
    requireClientScope(ctx, "collaborator");
    const body = await readOptionalJsonBody(ctx.request);
    const expectedEpoch = parseExpectedEpoch(body.expectedRunEpoch);
    const force = body.force === true;
    if (force) {
      requireClientScope(ctx, "owner");
    }

    const lease = runRegistry.beginReload(workspace.id, expectedEpoch);
    const adapter = createEngineAdapter(workspace);
    try {
      if (!force) {
        const firstLiveRuns = await adapter.activeRuns();
        const firstSnapshot = runRegistry.reconcile(workspace.id, firstLiveRuns);
        if (firstSnapshot.length > 0) {
          throw new ApiError(409, "active_runs", "Workspace engine has active runs and cannot be reloaded", {
            workspaceId: workspace.id,
            epoch: runRegistry.snapshot(workspace.id).epoch,
            items: firstSnapshot,
          });
        }

        // The reload lease already rejects new proxy starts. Re-read the engine
        // immediately before dispose to also catch runs started outside OpenWork.
        const confirmedLiveRuns = await adapter.activeRuns();
        const confirmedSnapshot = runRegistry.reconcile(workspace.id, confirmedLiveRuns);
        if (confirmedSnapshot.length > 0) {
          throw new ApiError(409, "active_runs", "Workspace run state changed before reload", {
            workspaceId: workspace.id,
            epoch: runRegistry.snapshot(workspace.id).epoch,
            items: confirmedSnapshot,
          });
        }
      }

      await adapter.reload();
      runRegistry.clearRuns(workspace.id);

      await recordAudit(workspace.path, {
        id: shortId(),
        workspaceId: workspace.id,
        actor: ctx.actor ?? { type: "remote" },
        action: "engine.reload",
        target: workspace.baseUrl ?? "opencode",
        summary: force ? "Force reloaded workspace engine" : "Reloaded idle workspace engine",
        timestamp: Date.now(),
      });

      return jsonResponse({
        ok: true,
        reloadedAt: Date.now(),
        protocol: adapter.protocol,
        runEpoch: runRegistry.snapshot(workspace.id).epoch,
      });
    } finally {
      lease.release();
    }
  });

  addRoute(routes, "GET", "/approvals", "host", async (ctx) => {
    return jsonResponse({ items: ctx.approvals.list() });
  });

  addRoute(routes, "POST", "/approvals/:id", "host", async (ctx) => {
    const body = await readJsonBody(ctx.request);
    const reply = body.reply === "allow" ? "allow" : "deny";
    const result = ctx.approvals.respond(ctx.params.id, reply);
    if (!result) {
      throw new ApiError(404, "approval_not_found", "Approval request not found");
    }
    return jsonResponse({ ok: true, allowed: result.allowed });
  });
}
