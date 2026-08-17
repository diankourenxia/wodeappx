/**
 * Stable sidebar session order for WodeApp workbench.
 *
 * OpenCode bumps `session.time.updated` on almost every assistant/tool/title
 * write. Sorting the project list by that field makes rows jump while multiple
 * sessions stream. Keep a sticky id order: only *new* sessions prepend (by
 * recency); existing rows keep their relative positions.
 */

export type SessionOrderLike = {
  id: string;
  time?: { updated?: number | null; created?: number | null } | null;
};

export function sessionRecencyMs(session: SessionOrderLike): number {
  return session.time?.updated ?? session.time?.created ?? 0;
}

export function sortSessionsByRecency<T extends SessionOrderLike>(sessions: readonly T[]): T[] {
  return [...sessions].sort((left, right) => sessionRecencyMs(right) - sessionRecencyMs(left));
}

/** Merge previous sticky order with the current visible set. */
export function mergeStableSessionOrderIds(
  previousOrderIds: readonly string[],
  sessions: readonly SessionOrderLike[],
): string[] {
  const visibleSet = new Set(sessions.map((session) => session.id));
  const kept = previousOrderIds.filter((id) => visibleSet.has(id));
  const keptSet = new Set(kept);
  const newcomers = sortSessionsByRecency(sessions.filter((session) => !keptSet.has(session.id))).map(
    (session) => session.id,
  );
  return [...newcomers, ...kept];
}

export function sameStringOrder(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** Apply sticky order (+ pinned first). Unknown ids fall back to recency. */
export function sortSessionsByStableOrder<T extends SessionOrderLike>(
  sessions: readonly T[],
  orderIds: readonly string[],
  pinnedIds: ReadonlySet<string> = new Set(),
): T[] {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const ordered: T[] = [];
  const used = new Set<string>();

  for (const id of orderIds) {
    const session = byId.get(id);
    if (!session || used.has(id)) continue;
    ordered.push(session);
    used.add(id);
  }

  for (const session of sortSessionsByRecency(sessions)) {
    if (used.has(session.id)) continue;
    ordered.push(session);
    used.add(session.id);
  }

  if (pinnedIds.size === 0) return ordered;
  const pinned = ordered.filter((session) => pinnedIds.has(session.id));
  const rest = ordered.filter((session) => !pinnedIds.has(session.id));
  return [...pinned, ...rest];
}
