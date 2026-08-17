#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const patcherPath = path.join(root, "scripts/patch-opencode-dynamic-tools.mjs");

function extractProcessorReplacements(source) {
  const start = source.indexOf('await patchFile(sourceRoot, "packages/opencode/src/session/processor.ts"');
  if (start < 0) throw new Error("processor.ts patch block missing");
  const next = source.indexOf("await patchFile(sourceRoot,", start + 1);
  const slice = source.slice(start, next > start ? next : start + 20000);
  const required = [
    "Do not snapshot on create",
    "const ensureSnapshot = Effect.fn(\"SessionProcessor.ensureSnapshot\")",
    "ctx.snapshot = yield* snapshot.track()",
    "toolsUsed = true",
    "yield* ensureSnapshot()",
    "const completedSnapshot = toolsUsed ? yield* snapshot.track() : ctx.snapshot",
    "snapshot: undefined,",
  ];
  const missing = required.filter((item) => !slice.includes(item));
  if (missing.length) {
    throw new Error(`processor patch missing:\n${missing.join("\n")}`);
  }
  const forbidden = ["Deferred.make", "Effect.forkIn(scope)"];
  const leaked = forbidden.filter((item) => slice.includes(item));
  if (leaked.length) {
    throw new Error(`processor patch still starts snapshot at create:\n${leaked.join("\n")}`);
  }
}

function extractPromptReplacements(source) {
  const required = [
    "isSmallTalkSession",
    "resolveWorkspaceIdentitySystem",
    "isLeanRuntimeProfile(agent.name) || isSmallTalkSession(msgs)",
    '"small-talk"',
    "instruction.system().pipe(Effect.orDie)",
  ];
  const missing = required.filter((item) => !source.includes(item));
  if (missing.length) {
    throw new Error(`prompt patch missing:\n${missing.join("\n")}`);
  }
}

function simulateTurn({ tools }) {
  const events = [];
  let blockedMs = 0;
  const snapshotMs = 57_000;
  const llmMs = 5_700;
  events.push("create:no-snapshot");
  events.push("llm-start");
  events.push("step-start:no-wait");
  events.push("text-delta");
  blockedMs += llmMs;
  if (tools) {
    events.push("tool-input-start:track-snapshot");
    blockedMs += snapshotMs;
    events.push("step-finish:track-after-tools");
  } else {
    events.push("step-finish:skip-track");
  }
  return { events, blockedMs, firstTokenMs: llmMs };
}

const patcher = await readFile(patcherPath, "utf8");
extractProcessorReplacements(patcher);
extractPromptReplacements(patcher);

const cacheProcessor = path.join(
  process.env.HOME || "",
  ".cache/wodeappx/opencode/wodeappx-dynamic-tools-1.18.16-393816f77eec00f7/source/packages/opencode/src/session/processor.ts",
);
try {
  const processor = await readFile(cacheProcessor, "utf8");
  const befores = [
    "const initialSnapshot = yield* snapshot.track()",
    "if (!ctx.snapshot) ctx.snapshot = yield* snapshot.track()",
    "const completedSnapshot = yield* snapshot.track()",
  ];
  const missingBefores = befores.filter((item) => !processor.includes(item));
  if (missingBefores.length) {
    throw new Error(`1.18.16 processor no longer matches patch befores:\n${missingBefores.join("\n")}`);
  }
} catch (error) {
  if (error && error.code !== "ENOENT") throw error;
}

const greeting = simulateTurn({ tools: false });
const coding = simulateTurn({ tools: true });
if (greeting.firstTokenMs >= 30_000) {
  throw new Error(`greeting first token still blocked: ${greeting.firstTokenMs}ms`);
}
if (greeting.blockedMs >= 30_000) {
  throw new Error(`greeting turn still waits on snapshot: ${greeting.blockedMs}ms`);
}
if (coding.blockedMs < 50_000) {
  throw new Error("coding turn should still wait for snapshot before tools");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      greetingFirstTokenMs: greeting.firstTokenMs,
      greetingTurnMs: greeting.blockedMs,
      codingTurnMs: coding.blockedMs,
      greetingEvents: greeting.events,
    },
    null,
    2,
  ),
);
