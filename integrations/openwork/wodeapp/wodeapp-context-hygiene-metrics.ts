export type WodeAppContextHygieneMetricValue = string | number | boolean | null;

export type WodeAppContextHygieneEvent = {
  event: string;
  at: string;
  details: Record<string, WodeAppContextHygieneMetricValue>;
};

const STORAGE_PREFIX = "wodeapp.contextHygiene";
const MAX_EVENTS_PER_SESSION = 80;
const MAX_DETAIL_FIELDS = 20;

function storageKey(sessionId: string) {
  return `${STORAGE_PREFIX}:${sessionId.trim().slice(0, 240)}`;
}

function safeDetails(
  details: Record<string, unknown> | undefined,
): Record<string, WodeAppContextHygieneMetricValue> {
  return Object.fromEntries(
    Object.entries(details ?? {})
      .slice(0, MAX_DETAIL_FIELDS)
      .flatMap(([key, value]) => {
        const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 60);
        if (!safeKey) return [];
        if (
          typeof value !== "string"
          && typeof value !== "number"
          && typeof value !== "boolean"
          && value !== null
        ) {
          return [];
        }
        const safeValue = typeof value === "string" ? value.slice(0, 160) : value;
        return [[safeKey, safeValue] as const];
      }),
  );
}

export function readWodeAppContextHygieneEvents(
  sessionId: string,
  limit = 30,
): WodeAppContextHygieneEvent[] {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId || typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(storageKey(normalizedSessionId)) ?? "[]",
    ) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is WodeAppContextHygieneEvent => (
        Boolean(item)
        && typeof item === "object"
        && typeof (item as WodeAppContextHygieneEvent).event === "string"
        && typeof (item as WodeAppContextHygieneEvent).at === "string"
      ))
      .slice(-Math.max(1, Math.min(MAX_EVENTS_PER_SESSION, limit)));
  } catch {
    return [];
  }
}

export function recordWodeAppContextHygieneEvent(input: {
  sessionId: string;
  event: string;
  details?: Record<string, unknown>;
}): void {
  const sessionId = input.sessionId.trim();
  const event = input.event.trim().slice(0, 80);
  if (!sessionId || !event || typeof window === "undefined") return;
  try {
    const current = readWodeAppContextHygieneEvents(sessionId, MAX_EVENTS_PER_SESSION);
    const next = [
      ...current,
      {
        event,
        at: new Date().toISOString(),
        details: safeDetails(input.details),
      },
    ].slice(-MAX_EVENTS_PER_SESSION);
    window.localStorage.setItem(storageKey(sessionId), JSON.stringify(next));
  } catch {
    // Diagnostics must never affect the send, read, or compaction path.
  }
}

export function clearWodeAppContextHygieneEvents(sessionId: string): void {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(normalizedSessionId));
  } catch {
    // Best-effort lifecycle cleanup.
  }
}
