/** Transcript dispatch cards. Status follows the task-field snapshot. No confirm gate. */

import {
  readWodeAppAgentStageSnapshot,
  resolveWodeAppAgentStageStatus,
  type WodeAppAgentStageStatus,
} from "./wodeapp-agent-stage";

export const WODEAPP_DIALOG_CARD_STORAGE_KEY = "wodeappx.dialog-card.v1";
export const WODEAPP_DIALOG_CARD_CHANGED_EVENT = "wodeapp:dialog-card-changed";

export type WodeAppDialogCard = {
  id: string;
  agentId: string;
  name: string;
  cycle: number;
};

export type WodeAppDialogCardFile = {
  cards: WodeAppDialogCard[];
};

export function dialogCardStorageKey(sessionId: string): string {
  const id = String(sessionId || "").trim();
  return id ? `${WODEAPP_DIALOG_CARD_STORAGE_KEY}:${id}` : WODEAPP_DIALOG_CARD_STORAGE_KEY;
}

export function emptyWodeAppDialogCardFile(): WodeAppDialogCardFile {
  return { cards: [] };
}

export function parseWodeAppDialogCardFile(raw: unknown): WodeAppDialogCardFile {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyWodeAppDialogCardFile();
  const cardsRaw = (raw as { cards?: unknown }).cards;
  if (!Array.isArray(cardsRaw)) return emptyWodeAppDialogCardFile();
  const cards: WodeAppDialogCard[] = [];
  for (const item of cardsRaw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const agentId = typeof record.agentId === "string" ? record.agentId.trim() : "";
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const cycle = typeof record.cycle === "number" && Number.isFinite(record.cycle)
      ? Math.max(1, Math.floor(record.cycle))
      : cards.length + 1;
    if (!id || !agentId) continue;
    cards.push({ id, agentId, name: name || agentId, cycle });
  }
  return { cards };
}

export function appendWodeAppDialogCard(
  cards: readonly WodeAppDialogCard[],
  input: { agentId: string; name: string },
): WodeAppDialogCard[] {
  const agentId = String(input.agentId || "").trim();
  const name = String(input.name || "").trim() || agentId;
  if (!agentId) return [...cards];
  const cycle = cards.length + 1;
  return [
    ...cards,
    {
      id: `dialog-card-${cycle}-${agentId}`,
      agentId,
      name,
      cycle,
    },
  ];
}

export function resolveWodeAppDialogCardStatus(
  card: WodeAppDialogCard,
  cards: readonly WodeAppDialogCard[],
  stage: { workingId: string | null; doneIds: string[] } = { workingId: null, doneIds: [] },
): WodeAppAgentStageStatus {
  if (stage.workingId) {
    const lastOfWorking = [...cards].reverse().find((item) => item.agentId === stage.workingId);
    if (lastOfWorking && lastOfWorking.id === card.id) return "working";
    if (card.agentId === stage.workingId) return "done";
    return resolveWodeAppAgentStageStatus(card.agentId, stage) === "idle" && card !== cards[cards.length - 1]
      ? "done"
      : resolveWodeAppAgentStageStatus(card.agentId, stage);
  }
  const last = cards[cards.length - 1];
  if (last && last.id === card.id) return "working";
  return "done";
}

export function readWodeAppDialogCards(sessionId: string): WodeAppDialogCard[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(dialogCardStorageKey(sessionId));
    if (!raw) return [];
    return parseWodeAppDialogCardFile(JSON.parse(raw)).cards;
  } catch {
    return [];
  }
}

export function writeWodeAppDialogCards(sessionId: string, cards: readonly WodeAppDialogCard[]): void {
  const id = String(sessionId || "").trim();
  if (!id || typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      dialogCardStorageKey(id),
      JSON.stringify({ cards }),
    );
    window.dispatchEvent(new CustomEvent(WODEAPP_DIALOG_CARD_CHANGED_EVENT, {
      detail: { sessionId: id },
    }));
  } catch {
    // Session storage may be unavailable; callers still hold in-memory cards.
  }
}

export function recordWodeAppDialogCard(
  sessionId: string,
  input: { agentId: string; name: string },
): WodeAppDialogCard[] {
  const next = appendWodeAppDialogCard(readWodeAppDialogCards(sessionId), input);
  writeWodeAppDialogCards(sessionId, next);
  return next;
}

export function listWodeAppDialogCardsWithStatus(sessionId: string) {
  const cards = readWodeAppDialogCards(sessionId);
  const stage = readWodeAppAgentStageSnapshot(
    sessionId ? `wodeappx.agent-stage.v1:${sessionId}` : "wodeappx.agent-stage.v1",
  );
  return cards.map((card) => ({
    ...card,
    status: resolveWodeAppDialogCardStatus(card, cards, stage),
  }));
}
