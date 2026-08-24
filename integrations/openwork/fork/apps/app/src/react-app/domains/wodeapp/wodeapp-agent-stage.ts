/** Task-field float: ability agents as tool cards. No new Bot persona / thick JSON. */

export type WodeAppAgentStageStatus = "idle" | "working" | "done";

export type WodeAppAgentStageAbility =
  | "image"
  | "video"
  | "short-drama"
  | "canvas";

export type WodeAppAgentStageCard = {
  id: string;
  abilityKind: WodeAppAgentStageAbility;
  name: string;
  label: string;
  status: WodeAppAgentStageStatus;
};

export const WODEAPP_AGENT_STAGE_ABILITIES: readonly WodeAppAgentStageAbility[] = [
  "image",
  "video",
  "short-drama",
  "canvas",
] as const;

export const WODEAPP_AGENT_STAGE_LABEL: Record<WodeAppAgentStageAbility, string> = {
  image: "图片",
  video: "视频",
  "short-drama": "短剧",
  canvas: "画布",
};

export const WODEAPP_AGENT_STAGE_STATUS_LABEL: Record<WodeAppAgentStageStatus, string> = {
  idle: "待命",
  working: "工作中",
  done: "已完成",
};

export const WODEAPP_AGENT_STAGE_STORAGE_KEY = "wodeappx.agent-stage.v1";

export type WodeAppAgentStageSnapshot = {
  expanded: boolean;
  /** CSS left/top in px; null = default bottom-right dock. */
  left: number | null;
  top: number | null;
  /** agentId currently working */
  workingId: string | null;
  /** agentIds completed in this conversation */
  doneIds: string[];
  cycle: number;
};

export function emptyWodeAppAgentStageSnapshot(): WodeAppAgentStageSnapshot {
  return {
    expanded: false,
    left: null,
    top: null,
    workingId: null,
    doneIds: [],
    cycle: 0,
  };
}

export function isWodeAppAgentStageAbility(value: unknown): value is WodeAppAgentStageAbility {
  return value === "image"
    || value === "video"
    || value === "short-drama"
    || value === "canvas";
}

export function stageLabelForAbility(ability: WodeAppAgentStageAbility): string {
  return WODEAPP_AGENT_STAGE_LABEL[ability];
}

/** Keep 2–4 tool-like ability agents: image / video / short-drama / canvas. */
export function listWodeAppAgentStageAgents<T extends { id: string; abilityKind?: string | null }>(
  agents: readonly T[],
): T[] {
  const byAbility = new Map<WodeAppAgentStageAbility, T>();
  for (const agent of agents) {
    if (!isWodeAppAgentStageAbility(agent.abilityKind)) continue;
    if (!byAbility.has(agent.abilityKind)) byAbility.set(agent.abilityKind, agent);
  }
  return WODEAPP_AGENT_STAGE_ABILITIES
    .map((ability) => byAbility.get(ability))
    .filter((item): item is T => Boolean(item));
}

export function resolveWodeAppAgentStageStatus(
  agentId: string,
  snapshot: Pick<WodeAppAgentStageSnapshot, "workingId" | "doneIds">,
): WodeAppAgentStageStatus {
  if (snapshot.workingId === agentId) return "working";
  if (snapshot.doneIds.includes(agentId)) return "done";
  return "idle";
}

export function buildWodeAppAgentStageCards(
  agents: readonly { id: string; name: string; abilityKind?: string | null }[],
  snapshot: Pick<WodeAppAgentStageSnapshot, "workingId" | "doneIds">,
): WodeAppAgentStageCard[] {
  return listWodeAppAgentStageAgents(agents).map((agent) => {
    const abilityKind = agent.abilityKind as WodeAppAgentStageAbility;
    return {
      id: agent.id,
      abilityKind,
      name: agent.name,
      label: stageLabelForAbility(abilityKind),
      status: resolveWodeAppAgentStageStatus(agent.id, snapshot),
    };
  });
}

/** Same conversation, re-dispatch: previous working becomes done; new id lights up. */
export function markWodeAppAgentStageWorking(
  snapshot: WodeAppAgentStageSnapshot,
  agentId: string,
): WodeAppAgentStageSnapshot {
  const nextDone = new Set(snapshot.doneIds);
  if (snapshot.workingId && snapshot.workingId !== agentId) {
    nextDone.add(snapshot.workingId);
  }
  nextDone.delete(agentId);
  const cycle = snapshot.workingId === agentId ? snapshot.cycle : snapshot.cycle + 1;
  return {
    ...snapshot,
    workingId: agentId,
    doneIds: [...nextDone],
    cycle: Math.max(1, cycle),
    expanded: true,
  };
}

export function parseWodeAppAgentStageSnapshot(raw: unknown): WodeAppAgentStageSnapshot {
  const base = emptyWodeAppAgentStageSnapshot();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return base;
  const record = raw as Record<string, unknown>;
  const doneIds = Array.isArray(record.doneIds)
    ? record.doneIds.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
  return {
    expanded: record.expanded === true,
    left: typeof record.left === "number" && Number.isFinite(record.left) ? record.left : null,
    top: typeof record.top === "number" && Number.isFinite(record.top) ? record.top : null,
    workingId: typeof record.workingId === "string" && record.workingId.trim()
      ? record.workingId.trim()
      : null,
    doneIds,
    cycle: typeof record.cycle === "number" && Number.isFinite(record.cycle)
      ? Math.max(0, Math.floor(record.cycle))
      : 0,
  };
}

export function readWodeAppAgentStageSnapshot(storageKey = WODEAPP_AGENT_STAGE_STORAGE_KEY): WodeAppAgentStageSnapshot {
  if (typeof window === "undefined") return emptyWodeAppAgentStageSnapshot();
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return emptyWodeAppAgentStageSnapshot();
    return parseWodeAppAgentStageSnapshot(JSON.parse(raw));
  } catch {
    return emptyWodeAppAgentStageSnapshot();
  }
}

export function writeWodeAppAgentStageSnapshot(
  snapshot: WodeAppAgentStageSnapshot,
  storageKey = WODEAPP_AGENT_STAGE_STORAGE_KEY,
): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(snapshot));
  } catch {
    // Session storage may be unavailable; in-memory state still works.
  }
}

export function clampWodeAppAgentStagePosition(
  left: number,
  top: number,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const maxLeft = Math.max(8, viewport.width - size.width - 8);
  const maxTop = Math.max(8, viewport.height - size.height - 8);
  return {
    left: Math.min(maxLeft, Math.max(8, left)),
    top: Math.min(maxTop, Math.max(8, top)),
  };
}

/** Snap within 24px of an edge to that edge (可贴边). */
export function snapWodeAppAgentStagePosition(
  left: number,
  top: number,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  threshold = 24,
): { left: number; top: number } {
  const clamped = clampWodeAppAgentStagePosition(left, top, size, viewport);
  let nextLeft = clamped.left;
  let nextTop = clamped.top;
  if (clamped.left <= 8 + threshold) nextLeft = 8;
  if (clamped.left >= viewport.width - size.width - 8 - threshold) {
    nextLeft = Math.max(8, viewport.width - size.width - 8);
  }
  if (clamped.top <= 8 + threshold) nextTop = 8;
  if (clamped.top >= viewport.height - size.height - 8 - threshold) {
    nextTop = Math.max(8, viewport.height - size.height - 8);
  }
  return { left: nextLeft, top: nextTop };
}
