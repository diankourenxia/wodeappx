export type ToolEffect = "read" | "write" | "destructive";
export type ToolApproval = "auto" | "prompt" | "writes";
export type ToolMetadataSource = "explicit" | "legacy" | "inferred";
export type ToolRunOutcome = "returned" | "failed" | "cancelled";

export type ToolArgumentDefinition = {
  name: string;
  type?: "string" | "number" | "boolean" | "object" | "array" | "unknown";
  required?: boolean;
  description?: string;
};

export type ToolExecutionHelpers = {
  setNarration: (text: string) => void;
  /** OpenCode tool caller session (from UI bridge). Prefer over UI-mounted session. */
  callerSessionId?: string;
};

export type ToolHandler = (
  args: unknown,
  helpers: ToolExecutionHelpers,
) => unknown | Promise<unknown>;

export type ToolActionSource = {
  id: string;
  label: string;
  description?: string;
  sideEffect?: "none" | "navigation" | "mutation" | "external";
  effect?: ToolEffect;
  approval?: ToolApproval;
  requiresConfirmation?: boolean;
  args?: ToolArgumentDefinition[];
  previewArgs?: unknown;
  disabled?: boolean;
  execute: ToolHandler;
};

export type ToolDefinition = {
  id: string;
  label: string;
  description?: string;
  inputSchema: readonly ToolArgumentDefinition[];
  defaultArgs?: unknown;
  effect: ToolEffect;
  approval: ToolApproval;
  metadataSource: ToolMetadataSource;
  metadataComplete: boolean;
  disabled: boolean;
};

export type ToolRunAudit = {
  runId: string;
  toolId: string;
  effect: ToolEffect;
  approval: ToolApproval;
  metadataSource: ToolMetadataSource;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  outcome: ToolRunOutcome;
  errorCode?: ToolExecutionError["code"] | "handler_error";
};

export type ExecuteToolOptions = {
  helpers: ToolExecutionHelpers;
  confirm?: (tool: ToolDefinition) => boolean | Promise<boolean>;
  beforeExecute?: (tool: ToolDefinition) => void | Promise<void>;
};

export class ToolExecutionError extends Error {
  constructor(
    message: string,
    readonly code: "disabled" | "invalid_arguments" | "confirmation_required" | "cancelled" | "unregistered" | "bypass",
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

const READ_ID_PATTERN = /(?:^|[._-])(list|get|read|status|inspect|search|preview|capabilities)(?:$|[._-])/i;
const DESTRUCTIVE_ID_PATTERN = /(?:^|[._-])(delete|remove|purge|clear|reset|revoke|dedupe)(?:$|[._-])/i;
const WRITE_ID_PATTERN = /(?:^|[._-])(save|create|update|set|generate|run|publish|send|install|execute)(?:$|[._-])/i;
const MAX_RECENT_RUNS = 100;
const CONTROL_SESSION_WRITE_APPROVAL_KEY = "openwork.control.allowNonDestructiveWrites.v1";
const toolHandlers = new WeakMap<ToolDefinition, ToolHandler>();
const activeHandlerCalls = new WeakMap<ToolHandler, number>();
const protectedActions = new WeakMap<ToolActionSource, ToolActionSource>();
const recentToolRuns: ToolRunAudit[] = [];
let runSequence = 0;

function inferToolEffect(action: ToolActionSource): ToolEffect {
  if (action.effect) return action.effect;
  if (DESTRUCTIVE_ID_PATTERN.test(action.id)) return "destructive";
  if (action.sideEffect === "none" || action.sideEffect === "navigation") return "read";
  if (action.sideEffect === "mutation" || action.sideEffect === "external") return "write";
  if (READ_ID_PATTERN.test(action.id)) return "read";
  if (WRITE_ID_PATTERN.test(action.id)) return "write";
  return "write";
}

function normalizeApproval(action: ToolActionSource, effect: ToolEffect): ToolApproval {
  if (effect === "destructive") return "prompt";
  if (action.requiresConfirmation) return "prompt";
  if (action.approval) return action.approval;
  return effect === "read" ? "auto" : "prompt";
}

function metadataSource(action: ToolActionSource): ToolMetadataSource {
  if (action.effect || action.approval) return "explicit";
  if (action.sideEffect !== undefined || action.requiresConfirmation !== undefined) return "legacy";
  return "inferred";
}

function isPlainArgumentRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function defaultArgumentMatchesType(value: unknown, type: ToolArgumentDefinition["type"]): boolean {
  if (value === undefined || type === undefined || type === "unknown") return true;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isPlainArgumentRecord(value);
  return typeof value === type;
}

function validateDefaultArguments(action: ToolActionSource) {
  if (action.previewArgs === undefined) return;
  if (!isPlainArgumentRecord(action.previewArgs)) {
    throw new Error(`Invalid previewArgs for ${action.id}: expected an object.`);
  }
  const definitions = new Map((action.args ?? []).map((argument) => [argument.name, argument]));
  for (const [name, value] of Object.entries(action.previewArgs)) {
    const definition = definitions.get(name);
    if (!definition) {
      throw new Error(`Invalid previewArgs for ${action.id}: unknown argument ${name}.`);
    }
    if (!defaultArgumentMatchesType(value, definition.type)) {
      throw new Error(`Invalid previewArgs for ${action.id}: ${name} must be ${definition.type}.`);
    }
  }
}

export function toToolDefinition(action: ToolActionSource): ToolDefinition {
  validateDefaultArguments(action);
  const effect = inferToolEffect(action);
  const tool: ToolDefinition = {
    id: action.id,
    label: action.label,
    description: action.description,
    inputSchema: action.args ?? [],
    defaultArgs: action.previewArgs,
    effect,
    approval: normalizeApproval(action, effect),
    metadataSource: metadataSource(action),
    metadataComplete: action.effect !== undefined && action.approval !== undefined,
    disabled: action.disabled === true,
  };
  toolHandlers.set(tool, action.execute);
  return tool;
}

/**
 * Wrap an action before registration so its raw handler cannot be called from
 * the registry without an executeTool permit. Source-level tests cover calls
 * made before registration.
 */
export function protectToolAction<T extends ToolActionSource>(action: T): T {
  const cached = protectedActions.get(action);
  if (cached) return cached as T;

  const original = action.execute;
  const guarded: ToolHandler = async (args, helpers) => {
    if ((activeHandlerCalls.get(guarded) ?? 0) < 1) {
      throw new ToolExecutionError(`Tool handler bypassed executeTool: ${action.id}`, "bypass");
    }
    return original(args, helpers);
  };
  const protectedAction = { ...action, execute: guarded };
  protectedActions.set(action, protectedAction);
  protectedActions.set(protectedAction, protectedAction);
  return protectedAction;
}

export function listRecentToolRuns(): readonly ToolRunAudit[] {
  return recentToolRuns.slice();
}

export function clearRecentToolRunsForTest() {
  recentToolRuns.splice(0, recentToolRuns.length);
}

function recordRun(run: ToolRunAudit) {
  recentToolRuns.push(Object.freeze(run));
  if (recentToolRuns.length > MAX_RECENT_RUNS) {
    recentToolRuns.splice(0, recentToolRuns.length - MAX_RECENT_RUNS);
  }
}

function nextRunId(startedAt: number): string {
  runSequence += 1;
  return `tool_${startedAt.toString(36)}_${runSequence.toString(36)}`;
}

export function toolRequiresConfirmation(tool: Pick<ToolDefinition, "effect" | "approval">): boolean {
  if (tool.effect === "destructive") return true;
  if (tool.approval === "prompt") return true;
  return tool.approval === "writes" && tool.effect !== "read";
}

export async function confirmControlToolForSession(
  tool: Pick<ToolDefinition, "effect">,
  options: {
    storage: Pick<Storage, "getItem" | "setItem">;
    confirm: () => boolean | Promise<boolean>;
  },
): Promise<boolean> {
  if (tool.effect !== "write") return options.confirm();

  try {
    if (options.storage.getItem(CONTROL_SESSION_WRITE_APPROVAL_KEY) === "allow") return true;
  } catch {
    // A blocked sessionStorage still permits a one-off confirmation below.
  }

  const allowed = await options.confirm();
  if (!allowed) return false;
  try {
    options.storage.setItem(CONTROL_SESSION_WRITE_APPROVAL_KEY, "allow");
  } catch {
    // Keep the current approval even when the browser cannot remember it.
  }
  return true;
}

function validateRequiredArguments(tool: ToolDefinition, args: unknown) {
  const required = tool.inputSchema.filter((argument) => argument.required);
  if (!required.length) return;
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new ToolExecutionError(
      `Invalid arguments for ${tool.id}: ${required.map((argument) => argument.name).join(", ")} required.`,
      "invalid_arguments",
    );
  }
  const values = args as Record<string, unknown>;
  const missing = required.filter((argument) => values[argument.name] === undefined || values[argument.name] === null);
  if (missing.length) {
    throw new ToolExecutionError(
      `Invalid arguments for ${tool.id}: ${missing.map((argument) => argument.name).join(", ")} required.`,
      "invalid_arguments",
    );
  }
}

export async function executeTool(
  tool: ToolDefinition,
  args: unknown,
  options: ExecuteToolOptions,
): Promise<unknown> {
  const startedAt = Date.now();
  const runId = nextRunId(startedAt);
  let outcome: ToolRunOutcome = "failed";
  let errorCode: ToolRunAudit["errorCode"];

  try {
    if (tool.disabled) {
      throw new ToolExecutionError(`Tool is disabled: ${tool.label}`, "disabled");
    }

    const effectiveArgs = args === undefined ? tool.defaultArgs : args;
    validateRequiredArguments(tool, effectiveArgs);

    if (toolRequiresConfirmation(tool)) {
      if (!options.confirm) {
        throw new ToolExecutionError(`Confirmation required for ${tool.id}.`, "confirmation_required");
      }
      if (!await options.confirm(tool)) {
        throw new ToolExecutionError("User cancelled action.", "cancelled");
      }
    }

    const handler = toolHandlers.get(tool);
    if (!handler) {
      throw new ToolExecutionError(`Tool is not registered through toToolDefinition: ${tool.id}`, "unregistered");
    }

    await options.beforeExecute?.(tool);
    activeHandlerCalls.set(handler, (activeHandlerCalls.get(handler) ?? 0) + 1);
    try {
      const result = await handler(effectiveArgs, options.helpers);
      outcome = "returned";
      return result;
    } finally {
      const remaining = (activeHandlerCalls.get(handler) ?? 1) - 1;
      if (remaining > 0) activeHandlerCalls.set(handler, remaining);
      else activeHandlerCalls.delete(handler);
    }
  } catch (error) {
    if (error instanceof ToolExecutionError) {
      errorCode = error.code;
      if (error.code === "cancelled") outcome = "cancelled";
    } else {
      errorCode = "handler_error";
    }
    throw error;
  } finally {
    const finishedAt = Date.now();
    recordRun({
      runId,
      toolId: tool.id,
      effect: tool.effect,
      approval: tool.approval,
      metadataSource: tool.metadataSource,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - startedAt),
      outcome,
      errorCode,
    });
  }
}
