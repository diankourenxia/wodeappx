import { afterEach, describe, expect, test } from "bun:test";

describe("session query gc defaults (ses_01562a welcome flash)", () => {
  afterEach(() => {
    const g = globalThis as { __owReactQueryClient?: unknown };
    delete g.__owReactQueryClient;
  });

  test("transcript shares Infinity gcTime with permissions (no useQuery observers)", async () => {
    const { getReactQueryClient } = await import(
      "../../../vendor/openwork/apps/app/src/react-app/infra/query-client"
    );
    const client = getReactQueryClient();
    const transcript = client.getQueryDefaults(["react-session-transcript"]);
    const permissions = client.getQueryDefaults(["react-session-permissions"]);
    const status = client.getQueryDefaults(["react-session-status"]);

    expect(transcript.gcTime).toBe(Number.POSITIVE_INFINITY);
    expect(permissions.gcTime).toBe(Number.POSITIVE_INFINITY);
    expect(status.gcTime).toBe(15_000);
  });
});
