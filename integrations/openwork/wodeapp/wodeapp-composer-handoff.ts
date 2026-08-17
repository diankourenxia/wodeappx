import type { AssetMentionRef } from "./digital-assets-data";

export type WodeAppComposerHandoff = {
  displayText: string;
  agentMessage?: string;
  /** Slash-command mode: send text starting with this prefix expands to agentMessage + the user's typed remainder. */
  commandPrefix?: string;
};

const handoffsBySession = new Map<string, WodeAppComposerHandoff>();

export function setWodeAppComposerHandoff(sessionId: string, handoff: WodeAppComposerHandoff) {
  const id = sessionId.trim();
  if (!id) return;
  handoffsBySession.set(id, handoff);
}

export function getWodeAppComposerHandoff(sessionId: string): WodeAppComposerHandoff | undefined {
  return handoffsBySession.get(sessionId.trim());
}

export function clearWodeAppComposerHandoff(sessionId: string) {
  handoffsBySession.delete(sessionId.trim());
}

export function resolveWodeAppComposerSendText(sessionId: string, displayText: string): string {
  const handoff = getWodeAppComposerHandoff(sessionId);
  if (!handoff) return displayText;
  // Slash-command mode: the composer shows a short command (e.g. "/新形象 "),
  // the user appends their idea, and on send we expand to base prompt + input.
  if (handoff.commandPrefix && displayText.trimStart().startsWith(handoff.commandPrefix)) {
    clearWodeAppComposerHandoff(sessionId);
    const userInput = displayText.trim().slice(handoff.commandPrefix.length).trim();
    const base = handoff.agentMessage?.trim() || "";
    return [base, userInput ? `我的想法是：${userInput}` : ""].filter(Boolean).join("\n");
  }
  if (handoff.displayText.trim() !== displayText.trim()) return displayText;
  clearWodeAppComposerHandoff(sessionId);
  return handoff.agentMessage?.trim() || displayText;
}

export type WodeAppTaskPromptInput = {
  displayText: string;
  agentMessage?: string;
  autoSend?: boolean;
  assetMentions?: AssetMentionRef[];
  runtimeProfileId?: string;
};

export function normalizeWodeAppTaskPromptInput(input: string | WodeAppTaskPromptInput): WodeAppTaskPromptInput {
  if (typeof input === "string") {
    return { displayText: input.trim() };
  }
  return {
    displayText: input.displayText.trim(),
    agentMessage: input.agentMessage?.trim(),
    autoSend: input.autoSend,
    assetMentions: input.assetMentions?.length ? input.assetMentions : undefined,
    runtimeProfileId: input.runtimeProfileId?.trim() || undefined,
  };
}

function primeComposerSoon(sessionId: string, text: string) {
  if (typeof window === "undefined") return;
  const fire = () => {
    window.dispatchEvent(
      new CustomEvent("wodeapp:prime-composer", {
        detail: { sessionId, text },
      }),
    );
  };
  const timers: number[] = [];
  const cleanup = () => {
    for (const timer of timers) window.clearTimeout(timer);
    window.removeEventListener("wodeapp:composer-primed", handlePrimed);
  };
  const handlePrimed = (event: Event) => {
    const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
    if (detail?.sessionId !== sessionId) return;
    cleanup();
  };
  window.addEventListener("wodeapp:composer-primed", handlePrimed);
  // Cold desktop starts can take more than a second to mount SessionSurface.
  // Replay until the matching session acknowledges the draft, then stop so a
  // successful send is never repopulated by a late timer.
  for (const delay of [0, 80, 240, 600, 1_200, 2_400, 5_000]) {
    timers.push(window.setTimeout(fire, delay));
  }
  timers.push(window.setTimeout(cleanup, 5_500));
}

export function primeWodeAppComposer(sessionId: string, text: string) {
  primeComposerSoon(sessionId, text);
}
