import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  RUNTIME_GENERATION_ENV,
  attachRuntimeGenerationProcess,
  createRuntimeGeneration,
  runtimeGenerationSpawnOptions,
  terminatePersistedRuntimeGeneration,
  terminateRuntimeGeneration,
} from "./runtime-generation.mjs";

describe("runtime generation ownership", () => {
  it("creates a Unix process group and passes ownership to descendants", () => {
    const generation = createRuntimeGeneration({
      id: "generation-1",
      ownerKind: "desktop",
      program: "/opt/opencode",
      cwd: "/workspace",
      now: () => 123,
      platform: "darwin",
    });
    attachRuntimeGenerationProcess(generation, 4242, "darwin");
    const options = runtimeGenerationSpawnOptions(generation, { env: { EXISTING: "1" } }, "darwin");

    assert.equal(options.detached, true);
    assert.equal(options.env[RUNTIME_GENERATION_ENV], "generation-1");
    assert.equal(options.env.EXISTING, "1");
    assert.equal(generation.processGroupId, 4242);
  });

  it("signals the entire Unix group and escalates when SIGTERM is ignored", async () => {
    const calls = [];
    let alive = true;
    const killImpl = (target, signal) => {
      calls.push([target, signal]);
      if (signal === "SIGKILL") alive = false;
      if (signal === 0 && !alive) {
        const error = new Error("missing");
        error.code = "ESRCH";
        throw error;
      }
    };
    const result = await terminateRuntimeGeneration(
      { rootPid: 77, processGroupId: 77 },
      { platform: "linux", killImpl, wait: async () => undefined },
    );

    assert.equal(result.terminated, true);
    assert.equal(result.escalated, true);
    assert.deepEqual(calls, [
      [-77, "SIGTERM"],
      [-77, 0],
      [-77, "SIGKILL"],
      [-77, 0],
    ]);
  });

  it("uses taskkill tree semantics on Windows", async () => {
    const calls = [];
    await terminateRuntimeGeneration(
      { rootPid: 88, processGroupId: null },
      {
        platform: "win32",
        spawnSyncImpl: (program, args) => {
          calls.push([program, args]);
          return { status: 0 };
        },
        wait: async () => undefined,
      },
    );

    assert.deepEqual(calls, [
      ["taskkill", ["/PID", "88", "/T"]],
      ["taskkill", ["/PID", "88", "/T", "/F"]],
    ]);
  });

  it("only kills stale Unix processes carrying the persisted generation marker", async () => {
    const signals = [];
    let remaining = [100, 101];
    const spawnSyncImpl = (_program, args) => {
      if (args[0] === "-Ao") {
        return { status: 0, stdout: remaining.map((pid) => `${pid} 90`).join("\n") };
      }
      const pid = Number(args[2]);
      return {
        status: 0,
        stdout: pid === 100
          ? `node WODEAPPX_RUNTIME_GENERATION_ID=generation-stale`
          : "node FOREIGN_GENERATION=1",
      };
    };
    const killImpl = (pid, signal) => {
      signals.push([pid, signal]);
      if (pid === 100 && signal === "SIGTERM") remaining = [101];
    };

    const result = await terminatePersistedRuntimeGeneration(
      { generationId: "generation-stale", processGroupId: 90 },
      { platform: "darwin", spawnSyncImpl, killImpl, wait: async () => undefined },
    );

    assert.equal(result.terminated, true);
    assert.deepEqual(signals, [[100, "SIGTERM"]]);
  });

  it("terminates a real three-level process tree on Unix", { timeout: 10_000 }, async () => {
    if (process.platform === "win32") return;
    const grandchildCode = "setInterval(() => {}, 1000)";
    const childCode = `
      const { spawn } = require("node:child_process");
      const grandchild = spawn(process.execPath, ["-e", ${JSON.stringify(grandchildCode)}], { stdio: "ignore" });
      console.log(JSON.stringify({ childPid: process.pid, grandchildPid: grandchild.pid }));
      setInterval(() => {}, 1000);
    `;
    const parentCode = `
      const { spawn } = require("node:child_process");
      const child = spawn(process.execPath, ["-e", ${JSON.stringify(childCode)}], { stdio: ["ignore", "pipe", "ignore"] });
      child.stdout.pipe(process.stdout);
      setInterval(() => {}, 1000);
    `;
    const generation = createRuntimeGeneration({
      id: "generation-real-tree",
      program: process.execPath,
      cwd: process.cwd(),
    });
    const root = spawn(
      process.execPath,
      ["-e", parentCode],
      runtimeGenerationSpawnOptions(generation, {
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
    attachRuntimeGenerationProcess(generation, root.pid);

    try {
      const line = await new Promise((resolve, reject) => {
        let output = "";
        const timeout = setTimeout(() => reject(new Error("timed out waiting for process tree")), 3_000);
        root.stdout.on("data", (chunk) => {
          output += chunk.toString();
          const newline = output.indexOf("\n");
          if (newline < 0) return;
          clearTimeout(timeout);
          resolve(output.slice(0, newline));
        });
        root.once("error", reject);
      });
      const descendants = JSON.parse(line);
      const outcome = await terminateRuntimeGeneration(generation);
      assert.equal(outcome.terminated, true);

      for (const pid of [root.pid, descendants.childPid, descendants.grandchildPid]) {
        assert.throws(
          () => process.kill(pid, 0),
          (error) => error?.code === "ESRCH",
          `expected owned PID ${pid} to exit`,
        );
      }
    } finally {
      try {
        process.kill(-root.pid, "SIGKILL");
      } catch {
        // Group already exited.
      }
    }
  });
});
