import { createToolItemFailure } from "./openwork-tool-result.js";

export type WodeAppToolExecutionContext = {
  sessionID?: string;
  messageID?: string;
};

type XlsExtractionOutcome = {
  allowed: boolean;
  code: string;
  path: string;
  recordedAt: number;
};

type XlsExtractionStore = Map<string, Map<string, XlsExtractionOutcome>>;

const STORE_SYMBOL = Symbol.for("wodeappx.xls-save-gate.v1");
const STORE_TTL_MS = 30 * 60_000;
const STORE_MAX_TURNS = 200;

function store(): XlsExtractionStore {
  const existing = Reflect.get(globalThis, STORE_SYMBOL);
  if (existing instanceof Map) return existing as XlsExtractionStore;
  const created: XlsExtractionStore = new Map();
  Reflect.set(globalThis, STORE_SYMBOL, created);
  return created;
}

function contextKey(context: WodeAppToolExecutionContext | undefined): string {
  const sessionId = context?.sessionID?.trim() ?? "";
  const messageId = context?.messageID?.trim() ?? "";
  return sessionId && messageId ? `${sessionId}:${messageId}` : "";
}

function resultCode(result: Record<string, unknown>): string {
  const data = result.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return "";
  const code = (data as Record<string, unknown>).code;
  return typeof code === "string" ? code : "";
}

function prune(currentTime: number): void {
  const entries = store();
  for (const [key, outcomes] of entries) {
    const newest = Math.max(0, ...[...outcomes.values()].map((outcome) => outcome.recordedAt));
    if (currentTime - newest > STORE_TTL_MS) entries.delete(key);
  }
  while (entries.size > STORE_MAX_TURNS) {
    const oldestKey = entries.keys().next().value;
    if (typeof oldestKey !== "string") break;
    entries.delete(oldestKey);
  }
}

export function recordXlsExtractionOutcome(
  context: WodeAppToolExecutionContext | undefined,
  path: string,
  result: Record<string, unknown>,
): void {
  const key = contextKey(context);
  const normalizedPath = path.trim();
  if (!key || !normalizedPath) return;
  const currentTime = Date.now();
  prune(currentTime);
  const outcomes = store().get(key) ?? new Map<string, XlsExtractionOutcome>();
  outcomes.set(normalizedPath, {
    allowed: result.ok === true && result.productSaveAllowed === true,
    code: resultCode(result) || (result.ok === true ? "XLS_READ_OK" : "XLS_READ_FAILED"),
    path: normalizedPath,
    recordedAt: currentTime,
  });
  store().set(key, outcomes);
}

export function assertXlsProductSaveAllowed(
  context: WodeAppToolExecutionContext | undefined,
): void {
  const key = contextKey(context);
  if (!key) return;
  prune(Date.now());
  const outcomes = store().get(key);
  if (!outcomes) return;
  const blocked = [...outcomes.values()].filter((outcome) => !outcome.allowed);
  if (!blocked.length) return;

  throw createToolItemFailure({
    message: "Product save is blocked because a Legacy Excel attachment failed to produce verified sheet/row/cell evidence.",
    recoverable: true,
    errorKind: "validation",
    data: {
      code: "XLS_PRODUCT_SAVE_BLOCKED",
      productSaveAllowed: false,
      failures: blocked.map(({ code, path }) => ({ code, path })),
      nextAction: "Read or repair every failed .xls attachment before saving the product.",
    },
  });
}

export function xlsExtractionGateSnapshot(
  context: WodeAppToolExecutionContext | undefined,
): { tracked: number; blocked: number; allowed: number } {
  const outcomes = store().get(contextKey(context));
  const values = outcomes ? [...outcomes.values()] : [];
  return {
    tracked: values.length,
    blocked: values.filter((outcome) => !outcome.allowed).length,
    allowed: values.filter((outcome) => outcome.allowed).length,
  };
}

export function clearXlsExtractionGateForTests(): void {
  store().clear();
}
