import { beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  clearRecentToolRunsForTest,
  confirmControlToolForSession,
  executeTool,
  listRecentToolRuns,
  protectToolAction,
  toToolDefinition,
  toolRequiresConfirmation,
  type ToolActionSource,
} from "../fork/apps/app/src/react-app/shell/control/tool-registry";
import { createActionExecutionQueue } from "../wodeapp/action-execution-queue";
import { WODEAPP_DIRECT_ACTION_CONTRACT_BY_ACTION_ID } from "../wodeapp/wodeapp-direct-action-contracts";

function action(overrides: Partial<ToolActionSource> = {}): ToolActionSource {
  return {
    id: "example.get",
    label: "Example",
    sideEffect: "none",
    execute: async () => ({ ok: true }),
    ...overrides,
  };
}

describe("OpenWork tool registry adapter", () => {
  beforeEach(() => clearRecentToolRunsForTest());

  test("keeps the control provider on the unified execution entry", async () => {
    const provider = await readFile(path.resolve(
      import.meta.dir,
      "../../../vendor/openwork/apps/app/src/react-app/shell/control/control-provider.tsx",
    ), "utf8");

    expect(provider).toContain("await executeTool(tool, args");
    expect(provider).not.toContain("await action.execute(");
  });

  test("queues concurrent UI actions instead of rejecting another session while the app is acting", async () => {
    const provider = await readFile(path.resolve(
      import.meta.dir,
      "../../../vendor/openwork/apps/app/src/react-app/shell/control/control-provider.tsx",
    ), "utf8");

    expect(provider).toContain("const actionQueueRef = useRef(createActionExecutionQueue())");
    expect(provider).toContain("actionQueueRef.current.enqueue(() => executeActionNow(actionId, args))");
    expect(provider).not.toContain("Already acting:");
  });

  test("executes queued actions in order and continues after a failed action", async () => {
    const queue = createActionExecutionQueue();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const first = queue.enqueue(async () => {
      events.push("first:start");
      await new Promise<void>((resolve) => { releaseFirst = resolve; });
      events.push("first:end");
      throw new Error("first failed");
    });
    const second = queue.enqueue(async () => {
      events.push("second:start");
      return "second completed";
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["first:start"]);
    releaseFirst?.();
    await expect(first).rejects.toThrow("first failed");
    await expect(second).resolves.toBe("second completed");
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  test("keeps batch image preparation on the verified non-billing direct action", async () => {
    const source = await readFile(path.resolve(
      import.meta.dir,
      "../../../vendor/openwork/apps/app/src/react-app/domains/wodeapp/wodeapp-session-control-actions.tsx",
    ), "utf8");
    const start = source.indexOf("function buildBatchImageControlAction(");
    const end = source.indexOf("function buildGenerationHistorySaveControlAction(", start);
    const actionSource = start >= 0 && end > start ? source.slice(start, end) : "";

    expect(actionSource).toContain('directActionMetadata("wodeapp.batch_image.open")');
    expect(actionSource).toContain("buildVisualGenerationTaskUrlAsync");
    expect(actionSource).toContain('status: "ready_for_manual_generate"');
    expect(actionSource).toContain("generationStarted: false");
    expect(actionSource).not.toContain("runProductVisualBatchImageRemote");
    expect(actionSource).not.toContain("attachProductVisualBatchIdParam");
  });

  test("marks workspace creation for one session-scoped control approval", async () => {
    const source = await readFile(path.resolve(
      import.meta.dir,
      "../../../vendor/openwork/apps/app/src/react-app/shell/session-route.tsx",
    ), "utf8");
    const actionSource = source.match(
      /id: "workspace\.create",[\s\S]*?requiresArgs: true,/,
    )?.[0];

    expect(actionSource).toBeDefined();
    expect(actionSource).toContain('effect: "write"');
    expect(actionSource).toContain('approval: "prompt"');
  });

  test("remembers one non-destructive control approval for the app session", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem(key: string) {
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        values.set(key, value);
      },
    };
    let confirmations = 0;
    const confirm = () => {
      confirmations += 1;
      return true;
    };

    await expect(confirmControlToolForSession({ effect: "write" }, { storage, confirm })).resolves.toBe(true);
    await expect(confirmControlToolForSession({ effect: "write" }, { storage, confirm })).resolves.toBe(true);
    expect(confirmations).toBe(1);
  });

  test("never remembers destructive control approval", async () => {
    const values = new Map<string, string>();
    const storage = {
      getItem(key: string) {
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        values.set(key, value);
      },
    };
    let confirmations = 0;
    const confirm = () => {
      confirmations += 1;
      return true;
    };

    await confirmControlToolForSession({ effect: "destructive" }, { storage, confirm });
    await confirmControlToolForSession({ effect: "destructive" }, { storage, confirm });
    expect(confirmations).toBe(2);
  });

  test("auto-approves non-destructive digital asset saves but keeps destructive cleanup protected", () => {
    for (const actionId of [
      "wodeapp.brand.save",
      "wodeapp.product.save",
      "wodeapp.prompt.save",
      "wodeapp.generation_history.save",
    ] as const) {
      expect(WODEAPP_DIRECT_ACTION_CONTRACT_BY_ACTION_ID.get(actionId)).toMatchObject({
        effect: "write",
        approval: "auto",
      });
    }
    for (const actionId of ["wodeapp.assets.delete", "wodeapp.assets.dedupe"] as const) {
      expect(WODEAPP_DIRECT_ACTION_CONTRACT_BY_ACTION_ID.get(actionId)).toMatchObject({
        effect: "destructive",
        approval: "prompt",
      });
    }
  });

  test("maps existing action metadata without rewriting handlers", async () => {
    const handler = async () => ({ ok: true, value: 1 });
    const tool = toToolDefinition(action({ execute: handler }));

    expect(tool.effect).toBe("read");
    expect(tool.approval).toBe("auto");
    expect("execute" in tool).toBe(false);
    expect(await executeTool(tool, undefined, { helpers: { setNarration() {} } })).toEqual({ ok: true, value: 1 });
  });

  test("rejects preview arguments that are missing from the public schema", () => {
    expect(() => toToolDefinition(action({
      args: [{ name: "durationSec", type: "number" }],
      previewArgs: { durationSec: 15, aspectRatio: "9:16" },
    }))).toThrow("unknown argument aspectRatio");
  });

  test("rejects preview argument types that disagree with the public schema", () => {
    expect(() => toToolDefinition(action({
      args: [{ name: "durationSec", type: "string" }],
      previewArgs: { durationSec: 15 },
    }))).toThrow("durationSec must be string");
  });

  test("uses conservative legacy id inference only when effect metadata is absent", () => {
    const list = toToolDefinition(action({ id: "asset.list", sideEffect: undefined }));
    const save = toToolDefinition(action({ id: "asset.save", sideEffect: undefined }));
    const unknown = toToolDefinition(action({ id: "asset.unknown", sideEffect: undefined }));

    expect({ effect: list.effect, approval: list.approval }).toEqual({ effect: "read", approval: "auto" });
    expect({ effect: save.effect, approval: save.approval }).toEqual({ effect: "write", approval: "prompt" });
    expect({ effect: unknown.effect, approval: unknown.approval }).toEqual({ effect: "write", approval: "prompt" });
    expect(unknown.metadataSource).toBe("inferred");
  });

  test("defaults legacy non-read actions to prompt until metadata is explicit", () => {
    const tool = toToolDefinition(action({ id: "asset.save", sideEffect: "mutation" }));

    expect(tool).toMatchObject({
      effect: "write",
      approval: "prompt",
      metadataSource: "legacy",
      metadataComplete: false,
    });
  });

  test("destructive actions always prompt even when legacy metadata asks for auto", () => {
    const tool = toToolDefinition(action({
      id: "asset.delete",
      sideEffect: "mutation",
      approval: "auto",
    }));

    expect(tool.effect).toBe("destructive");
    expect(tool.approval).toBe("prompt");
    expect(toolRequiresConfirmation(tool)).toBe(true);
  });

  test("writes approval prompts only for non-read effects", () => {
    expect(toolRequiresConfirmation({ effect: "read", approval: "writes" })).toBe(false);
    expect(toolRequiresConfirmation({ effect: "write", approval: "writes" })).toBe(true);
  });

  test("does not execute a destructive handler when confirmation is declined", async () => {
    let executions = 0;
    const tool = toToolDefinition(action({
      id: "asset.delete",
      sideEffect: "mutation",
      execute: () => { executions += 1; },
    }));

    await expect(executeTool(tool, {}, {
      helpers: { setNarration() {} },
      confirm: () => false,
    })).rejects.toMatchObject({ code: "cancelled" });
    expect(executions).toBe(0);
  });

  test("validates required arguments before executing", async () => {
    const tool = toToolDefinition(action({
      args: [{ name: "name", type: "string", required: true }],
    }));

    await expect(executeTool(tool, {}, { helpers: { setNarration() {} } }))
      .rejects.toMatchObject({ code: "invalid_arguments" });
  });

  test("blocks a protected raw handler outside executeTool", async () => {
    const protectedAction = protectToolAction(action());

    await expect(protectedAction.execute(undefined, { setNarration() {} }))
      .rejects.toMatchObject({ code: "bypass" });
    await expect(executeTool(toToolDefinition(protectedAction), undefined, {
      helpers: { setNarration() {} },
    })).resolves.toEqual({ ok: true });
  });

  test("records bounded execution facts without tool arguments", async () => {
    const tool = toToolDefinition(action({ effect: "read", approval: "auto" }));
    await executeTool(tool, { secret: "not-audited" }, { helpers: { setNarration() {} } });

    const runs = listRecentToolRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      toolId: "example.get",
      effect: "read",
      approval: "auto",
      metadataSource: "explicit",
      outcome: "returned",
    });
    expect(JSON.stringify(runs[0])).not.toContain("not-audited");
  });

  test("allows execute calls only through the public control API", async () => {
    const appSource = path.resolve(import.meta.dir, "../../../vendor/openwork/apps/app/src");
    const glob = new Bun.Glob("**/*.{ts,tsx}");
    const bypasses: string[] = [];
    for await (const relativePath of glob.scan({ cwd: appSource, onlyFiles: true })) {
      const source = await readFile(path.join(appSource, relativePath), "utf8");
      const dotCalls = source.match(/\b[\w$.]+\.execute\s*\(/g) ?? [];
      const bracketCalls = source.match(/\[\s*["']execute["']\s*\]\s*\(/g) ?? [];
      const allowed = relativePath.endsWith("/domains/session/voice/voice-panel.tsx")
        ? dotCalls.filter((call) => call !== "control.execute(")
        : dotCalls;
      if (allowed.length || bracketCalls.length) {
        bypasses.push(relativePath);
      }
    }
    expect(bypasses).toEqual([]);
  });
});
