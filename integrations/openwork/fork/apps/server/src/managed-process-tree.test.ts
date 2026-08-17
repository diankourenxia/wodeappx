import { describe, expect, test } from "bun:test";
import {
  MANAGED_GENERATION_ENV,
  attachManagedProcessGeneration,
  createManagedProcessGeneration,
  managedProcessSpawnOptions,
  terminateManagedProcessGeneration,
} from "./managed-process-tree.js";

describe("managed OpenCode process tree", () => {
  test("assigns a server-owned Unix process group", () => {
    const generation = createManagedProcessGeneration("/opt/opencode", "/workspace", {
      id: "server-generation",
      now: () => 100,
      platform: "darwin",
    });
    attachManagedProcessGeneration(generation, 1234, "darwin");
    const options = managedProcessSpawnOptions(generation, { env: { EXISTING: "1" } }, "darwin");

    expect(options.detached).toBe(true);
    expect(options.env?.[MANAGED_GENERATION_ENV]).toBe("server-generation");
    expect(options.env?.EXISTING).toBe("1");
    expect(generation.processGroupId).toBe(1234);
  });

  test("escalates from SIGTERM to SIGKILL for the complete Unix group", async () => {
    const generation = createManagedProcessGeneration("/opt/opencode", "/workspace");
    attachManagedProcessGeneration(generation, 91, "linux");
    const calls: Array<[number, NodeJS.Signals | 0]> = [];
    let alive = true;
    const killImpl = ((target: number, signal?: NodeJS.Signals | 0) => {
      calls.push([target, signal ?? "SIGTERM"]);
      if (signal === "SIGKILL") alive = false;
      if (signal === 0 && !alive) {
        const error = new Error("missing") as NodeJS.ErrnoException;
        error.code = "ESRCH";
        throw error;
      }
      return true;
    }) as typeof process.kill;

    await expect(terminateManagedProcessGeneration(generation, {
      platform: "linux",
      killImpl,
      wait: async () => undefined,
    })).resolves.toEqual({ terminated: true, escalated: true });
    expect(calls).toEqual([
      [-91, "SIGTERM"],
      [-91, 0],
      [-91, "SIGKILL"],
      [-91, 0],
    ]);
  });

  test("uses taskkill tree mode on Windows", async () => {
    const generation = createManagedProcessGeneration("/opt/opencode", "/workspace");
    attachManagedProcessGeneration(generation, 92, "win32");
    const calls: string[][] = [];

    await terminateManagedProcessGeneration(generation, {
      platform: "win32",
      spawnSyncImpl: ((_program: string, args: readonly string[]) => {
        calls.push([...args]);
        return { status: 0 };
      }) as typeof import("node:child_process").spawnSync,
      wait: async () => undefined,
    });

    expect(calls).toEqual([
      ["/PID", "92", "/T"],
      ["/PID", "92", "/T", "/F"],
    ]);
  });
});
