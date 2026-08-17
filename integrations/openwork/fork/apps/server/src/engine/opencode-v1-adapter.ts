import { ApiError } from "../errors.js";
import type {
  EngineAdapter,
  NormalizedEngineRun,
  NormalizedEngineRunState,
  OpenCodeV1Connection,
} from "./engine-types.js";

interface CreateOpenCodeV1AdapterOptions {
  connection: OpenCodeV1Connection;
  fetchImpl?: typeof fetch;
  afterReload?: () => Promise<void>;
}

function buildDirectoryHeader(directory: string): string {
  return /[^\x00-\x7F]/.test(directory) ? encodeURIComponent(directory) : directory;
}

function buildEngineUrl(connection: OpenCodeV1Connection, path: string, includeDirectoryQuery = false): string {
  try {
    const url = new URL(connection.baseUrl);
    url.pathname = path;
    url.search = "";
    if (includeDirectoryQuery && connection.directory) {
      url.searchParams.set("directory", connection.directory);
    }
    return url.toString();
  } catch {
    throw new ApiError(400, "opencode_url_invalid", "Local engine base URL is invalid");
  }
}

function buildHeaders(connection: OpenCodeV1Connection): Headers {
  const headers = new Headers();
  if (connection.authHeader) {
    headers.set("Authorization", connection.authHeader);
  }
  if (connection.directory) {
    headers.set("x-opencode-directory", buildDirectoryHeader(connection.directory));
  }
  return headers;
}

function parseErrorBody(input: string): unknown {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

function normalizeStatus(status: unknown): { state: NormalizedEngineRunState; sourceStatus: string } | null {
  const raw =
    typeof status === "string"
      ? status
      : status && typeof status === "object" && typeof (status as { type?: unknown }).type === "string"
        ? (status as { type: string }).type
        : "";
  const sourceStatus = raw.trim().toLowerCase();
  if (!sourceStatus || sourceStatus === "idle" || sourceStatus === "completed" || sourceStatus === "stopped") {
    return null;
  }
  if (sourceStatus === "retry") {
    return { state: "retrying", sourceStatus };
  }
  if (sourceStatus === "permission" || sourceStatus === "waiting_permission") {
    return { state: "waiting_permission", sourceStatus };
  }
  return { state: "active", sourceStatus };
}

function normalizeStatusMap(input: unknown): NormalizedEngineRun[] {
  const payload =
    input && typeof input === "object" && "data" in input && (input as { data?: unknown }).data
      ? (input as { data: unknown }).data
      : input;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];

  const runs: NormalizedEngineRun[] = [];
  for (const [sessionId, status] of Object.entries(payload)) {
    if (!sessionId.trim()) continue;
    const normalized = normalizeStatus(status);
    if (!normalized) continue;
    runs.push({ sessionId, ...normalized });
  }
  return runs;
}

export function createOpenCodeV1Adapter(options: CreateOpenCodeV1AdapterOptions): EngineAdapter {
  const { connection, afterReload } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!connection.baseUrl.trim()) {
    throw new ApiError(400, "opencode_unconfigured", "Local engine base URL is missing for this workspace");
  }

  return {
    protocol: "opencode-v1",
    capabilities: {
      atomicReload: false,
      dynamicPluginReload: false,
      serviceOwnership: false,
    },
    async activeRuns() {
      const targetUrl = buildEngineUrl(connection, "/session/status");
      let response: Response;
      try {
        response = await fetchImpl(targetUrl, {
          method: "GET",
          headers: buildHeaders(connection),
        });
      } catch (error) {
        throw new ApiError(503, "opencode_engine_unreachable", "Local engine is not reachable", {
          baseUrl: connection.baseUrl,
          cause: error instanceof Error ? error.message : String(error),
        });
      }
      if (!response.ok) {
        throw new ApiError(502, "opencode_status_failed", "Local engine run status query failed", {
          status: response.status,
          body: parseErrorBody(await response.text()),
        });
      }
      return normalizeStatusMap(await response.json());
    },
    async reload() {
      const targetUrl = buildEngineUrl(connection, "/instance/dispose", true);
      let response: Response;
      try {
        response = await fetchImpl(targetUrl, {
          method: "POST",
          headers: buildHeaders(connection),
        });
      } catch (error) {
        throw new ApiError(
          503,
          "opencode_engine_unreachable",
          "Local engine is not reachable; a full engine restart is required",
          { baseUrl: connection.baseUrl, cause: error instanceof Error ? error.message : String(error) },
        );
      }
      if (!response.ok) {
        throw new ApiError(502, "opencode_reload_failed", "Local engine reload failed", {
          status: response.status,
          body: parseErrorBody(await response.text()),
        });
      }
      await afterReload?.();
    },
  };
}
