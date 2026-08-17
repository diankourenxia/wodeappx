/**
 * WodeAppX custom-tool result contract.
 * Spec: wodeappx/docs/AGENT_RELIABILITY_CONTRACT.md
 *
 * OpenCode only marks a custom tool Item as failed when execute throws.
 * Structured `{ ok:false }` / `{ success:false }` must not be returned as a
 * successful tool payload. Recoverability is an attribute of a failed Item.
 *
 * Custom Error fields are not guaranteed to survive OpenCode's error string
 * channel. Before throw we:
 * 1) write `wodeappxFailure` via `context.metadata()` when available
 * 2) prefix a stable machine-readable tag on the error message string
 */

import {
  failurePayloadFromTaggedMessage,
  formatToolItemFailureTag,
  parseToolItemFailureTag,
  stripFailureMessageTag,
  type ToolErrorKind,
  type ToolItemFailurePayload,
} from "../tool-item-failure.js";

export {
  failurePayloadFromTaggedMessage,
  parseToolItemFailureTag,
  stripFailureMessageTag,
};
export type { ToolErrorKind, ToolItemFailurePayload };

export class ToolItemFailure extends Error {
  readonly status = "failed" as const;
  readonly recoverable: boolean;
  readonly errorKind: ToolErrorKind;
  readonly data?: unknown;

  constructor(input: {
    message: string;
    recoverable?: boolean;
    errorKind?: ToolErrorKind;
    data?: unknown;
  }) {
    const message = input.message.trim() || "Tool execution failed.";
    super(message);
    this.name = "ToolItemFailure";
    this.recoverable = input.recoverable === true;
    this.errorKind = input.errorKind ?? "execution";
    this.data = input.data;
  }

  toPayload(): ToolItemFailurePayload {
    return {
      status: "failed",
      recoverable: this.recoverable,
      errorKind: this.errorKind,
      message: stripFailureMessageTag(this.message),
      ...(this.data !== undefined ? { data: this.data } : {}),
    };
  }
}

export function formatToolItemFailureMessage(failure: ToolItemFailure): string {
  return formatToolItemFailureTag(failure);
}

type ToolMetadataWriter = (input: {
  title?: string;
  metadata?: Record<string, unknown>;
}) => void | Promise<void>;

type ToolResultContext = {
  metadata?: ToolMetadataWriter;
};

function asToolResultContext(context: unknown): ToolResultContext | null {
  if (!context || typeof context !== "object") return null;
  return context as ToolResultContext;
}

/**
 * Persist failure onto the OpenCode Item metadata channel when present, and
 * always rewrite the thrown error message so string-only processors still see
 * recoverable/errorKind.
 */
export async function publishToolItemFailure(
  context: unknown,
  failure: ToolItemFailure,
): Promise<ToolItemFailure> {
  const payload = failure.toPayload();
  const ctx = asToolResultContext(context);
  if (typeof ctx?.metadata === "function") {
    try {
      await Promise.resolve(ctx.metadata({
        title: failure.recoverable ? "Recoverable tool failure" : "Tool failure",
        metadata: { wodeappxFailure: payload },
      }));
    } catch {
      // Best-effort: string tag below remains the hard guarantee for agents/UI.
    }
  }
  return new ToolItemFailure({
    message: formatToolItemFailureMessage(failure),
    recoverable: failure.recoverable,
    errorKind: failure.errorKind,
    data: failure.data,
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function messageFrom(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  const record = asRecord(value);
  if (!record) return null;
  for (const key of ["message", "error", "detail", "reason", "output"]) {
    const message = messageFrom(record[key]);
    if (message) return message;
  }
  return null;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function readErrorKind(record: Record<string, unknown>): ToolErrorKind | undefined {
  const raw = record.errorKind ?? record.error_kind;
  if (raw === "validation" || raw === "ambiguous" || raw === "dependency" || raw === "execution") {
    return raw;
  }
  return undefined;
}

function isExplicitFailureRecord(record: Record<string, unknown>): boolean {
  if (record.ok === false) return true;
  if (record.success === false) return true;
  if (record.isError === true || record.is_error === true) return true;
  if (record.status === "failed") return true;
  return false;
}

/**
 * Legacy scheduler / adapters used `shouldContinue:true` with `success:false`.
 * Map that to recoverable Item failure; do not keep shouldContinue as a public field.
 *
 * UI-bridge validation payloads often only set `code: "validation_failed"` without
 * an explicit `recoverable` flag. Those must stay recoverable so the agent can
 * fix args / ask the user and retry — otherwise they look like hard execution
 * failures and the old "see error → auto-fix → retry" loop breaks.
 */
function inferRecoverable(record: Record<string, unknown>): boolean {
  if (record.recoverable === true) return true;
  if (record.recoverable === false) return false;
  if (record.shouldContinue === true || record.should_continue === true) return true;
  const code = typeof record.code === "string" ? record.code.trim() : "";
  if (code === "validation_failed" || code === "validation" || code === "ambiguous") {
    return true;
  }
  const status = typeof record.status === "string" ? record.status.trim() : "";
  if (
    status === "scenes_prompt_required"
    || status === "clip_duration_exceeds_model_limit"
    || status === "reference_images_not_synced"
  ) {
    return true;
  }
  const kind = readErrorKind(record);
  if (kind === "validation" || kind === "ambiguous" || kind === "dependency") {
    return true;
  }
  return false;
}

function inferErrorKind(record: Record<string, unknown>, recoverable: boolean): ToolErrorKind {
  const explicit = readErrorKind(record);
  if (explicit) return explicit;
  if (recoverable) {
    if (typeof record.data === "object" && record.data !== null && "matches" in (record.data as object)) {
      return "ambiguous";
    }
    return "validation";
  }
  return "execution";
}

export function createToolItemFailure(input: {
  message: string;
  recoverable?: boolean;
  errorKind?: ToolErrorKind;
  data?: unknown;
}): ToolItemFailure {
  return new ToolItemFailure(input);
}

export function failureFromStructuredResult(
  value: unknown,
  fallback = "Tool execution failed.",
): ToolItemFailure | null {
  const parsed = parseMaybeJson(value);
  const record = asRecord(parsed);
  if (!record || !isExplicitFailureRecord(record)) return null;

  const message = messageFrom(record.error)
    ?? messageFrom(record.message)
    ?? messageFrom(record.detail)
    ?? messageFrom(record.reason)
    ?? messageFrom(record.output)
    ?? fallback;
  const recoverable = inferRecoverable(record);
  return new ToolItemFailure({
    message,
    recoverable,
    errorKind: inferErrorKind(record, recoverable),
    data: record.data,
  });
}

/**
 * OpenCode marks a custom tool as failed only when execute throws. WodeAppX
 * adapters also receive structured results from MCP, native helpers and the UI
 * bridge, so convert their explicit failure flags into that native error state.
 */
export function assertToolResultSucceeded<T>(
  value: T,
  fallback = "Tool execution failed.",
): T {
  const failure = failureFromStructuredResult(value, fallback);
  if (failure) throw failure;
  return value;
}

/** Normalize thrown values to ToolItemFailure when possible. */
export function normalizeToolError(error: unknown): ToolItemFailure {
  if (error instanceof ToolItemFailure) {
    const tagged = parseToolItemFailureTag(error.message);
    if (!tagged) return error;
    return new ToolItemFailure({
      message: stripFailureMessageTag(error.message),
      recoverable: error.recoverable,
      errorKind: error.errorKind,
      data: error.data,
    });
  }

  const fromStructured = failureFromStructuredResult(error);
  if (fromStructured) return fromStructured;

  if (error instanceof Error) {
    const fromTag = parseToolItemFailureTag(error.message);
    if (fromTag) {
      return new ToolItemFailure({
        message: stripFailureMessageTag(error.message),
        recoverable: fromTag.recoverable,
        errorKind: fromTag.errorKind,
      });
    }
    const nested = failureFromStructuredResult(error.message);
    if (nested) return nested;
    return new ToolItemFailure({
      message: error.message || "Tool execution failed.",
      recoverable: false,
      errorKind: "execution",
    });
  }

  const message = messageFrom(error) || "Tool execution failed.";
  return new ToolItemFailure({
    message,
    recoverable: false,
    errorKind: "execution",
  });
}

/**
 * Enforce contract on a returned tool value (object or JSON string).
 * Return successful values unchanged; throw ToolItemFailure on explicit failures.
 */
export function enforceToolResult<T>(value: T, fallback = "Tool execution failed."): T {
  return assertToolResultSucceeded(value, fallback);
}

export function asToolResultJson(value: unknown): string {
  return JSON.stringify(assertToolResultSucceeded(value), null, 2);
}

const UI_BRIDGE_DEPENDENCY_RE =
  /UI bridge not available|control (?:surface|port) is (?:not available|stale)|ECONNREFUSED|fetch failed|network|socket hang up/i;

/**
 * UI-bridge callers must not wrap {@link ToolItemFailure} in a plain `Error`.
 * Doing so drops `recoverable` / `errorKind` and turns validation failures into
 * hard execution errors (model then blind-retries the same bad args).
 */
export function finalizeUiBridgeError(lastError: unknown): never {
  if (lastError instanceof ToolItemFailure) {
    throw lastError;
  }

  const rawMessage = lastError instanceof Error
    ? lastError.message
    : messageFrom(lastError) || "unknown error";
  const bridgedMessage = rawMessage.startsWith("UI bridge request failed:")
    ? rawMessage
    : `UI bridge request failed: ${rawMessage}`;

  if (UI_BRIDGE_DEPENDENCY_RE.test(rawMessage)) {
    throw createToolItemFailure({
      message: bridgedMessage,
      recoverable: true,
      errorKind: "dependency",
    });
  }

  const normalized = normalizeToolError(lastError);
  throw createToolItemFailure({
    message: normalized.message.startsWith("UI bridge request failed:")
      ? normalized.message
      : `UI bridge request failed: ${normalized.message}`,
    recoverable: normalized.recoverable,
    errorKind: normalized.errorKind,
    data: normalized.data,
  });
}

type ToolExecute<A, C, R> = (args: A, context: C) => R | Promise<R>;

/**
 * Central wrapper for WodeAppX custom tool `execute` handlers.
 * Prefer wrapping at registration boundaries over source-scanning for `{ok:false}`.
 */
export async function executeWithContract<A, C, R>(
  original: ToolExecute<A, C, R>,
  args: A,
  context: C,
  fallback = "Tool execution failed.",
): Promise<R> {
  try {
    const raw = await original(args, context);
    return enforceToolResult(raw, fallback);
  } catch (error) {
    const failure = normalizeToolError(error);
    throw await publishToolItemFailure(context, failure);
  }
}
