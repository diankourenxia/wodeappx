import { describe, expect, test } from "bun:test";
import { ApiError } from "../errors.js";
import { createOpenCodeV1Adapter } from "./opencode-v1-adapter.js";

function fakeFetch(
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
  return Object.assign(
    (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      handler(new URL(input instanceof Request ? input.url : String(input)), init),
    { preconnect: fetch.preconnect },
  ) as typeof fetch;
}

describe("OpenCodeV1Adapter", () => {
  test("normalizes v1 session status without leaking SDK types", async () => {
    let capturedHeaders: Headers | undefined;
    const adapter = createOpenCodeV1Adapter({
      connection: {
        baseUrl: "http://127.0.0.1:4096",
        directory: "/tmp/工作区",
        authHeader: "Basic token",
      },
      fetchImpl: fakeFetch((url, init) => {
        expect(url.pathname).toBe("/session/status");
        capturedHeaders = new Headers(init?.headers);
        return Response.json({
          busy: { type: "busy" },
          retrying: { type: "retry" },
          idle: { type: "idle" },
        });
      }),
    });

    await expect(adapter.activeRuns()).resolves.toEqual([
      { sessionId: "busy", state: "active", sourceStatus: "busy" },
      { sessionId: "retrying", state: "retrying", sourceStatus: "retry" },
    ]);
    expect(capturedHeaders?.get("authorization")).toBe("Basic token");
    expect(capturedHeaders?.get("x-opencode-directory")).toBe(encodeURIComponent("/tmp/工作区"));
  });

  test("owns the v1 dispose contract and runs post-reload synchronization", async () => {
    let synchronized = false;
    const adapter = createOpenCodeV1Adapter({
      connection: {
        baseUrl: "http://127.0.0.1:4096/base",
        directory: "/tmp/project",
      },
      fetchImpl: fakeFetch((url, init) => {
        expect(url.pathname).toBe("/instance/dispose");
        expect(url.searchParams.get("directory")).toBe("/tmp/project");
        expect(init?.method).toBe("POST");
        return new Response(null, { status: 204 });
      }),
      afterReload: async () => {
        synchronized = true;
      },
    });

    await adapter.reload();
    expect(synchronized).toBe(true);
  });

  test("fails closed when live run status cannot be read", async () => {
    const adapter = createOpenCodeV1Adapter({
      connection: { baseUrl: "http://127.0.0.1:4096" },
      fetchImpl: fakeFetch(() => Response.json({ message: "bad gateway" }, { status: 502 })),
    });

    try {
      await adapter.activeRuns();
      throw new Error("expected activeRuns to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("opencode_status_failed");
    }
  });
});
