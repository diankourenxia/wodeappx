/** @jsxImportSource react */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { UIMessage } from "ai";

import type { WorkspaceSessionGroup } from "@/app/types";
import { transcriptKey } from "@/react-app/domains/session/sync/session-sync";
import { stripProviderThinkTags } from "./assistant-think-text";

import { filterVisibleWodeAppSessions } from "./wodeapp-workbench-sidebar";
import { WodeAppCompanionLive2D } from "./wodeapp-companion-live2d";
import {
  companionAvatarSpriteClass,
  companionAvatarSpriteSrc,
  defaultWodeAppCompanionAvatar,
  type WodeAppCompanionAvatar,
} from "./wodeapp-companion-avatars";
import {
  storeWodeAppCompanionPrefs,
} from "./wodeapp-companion-prefs";
import {
  isPetBuddyInProgressStatus,
  PET_BUDDY_SLEEP_AFTER_MS,
  resolvePetBuddyMood,
  type WodeAppPetBuddyMood,
} from "./wodeapp-pet-buddy-mood";

const PET_POS_STORAGE_KEY = "wodeappx.pet-buddy.pos";
const DRAG_THRESHOLD_PX = 6;
const ACTIVE_LIMIT = 6;
const PREVIEW_MAX_CHARS = 140;

export type WodeAppPetBuddyRecentItem = {
  workspaceId: string;
  sessionId: string;
  preview: string;
  statusLabel: string;
  updatedAt: number;
};

/** float = 桌宠 (draggable); perch = 趴宠 on composer (pet-soft skin only). */
export type WodeAppPetBuddyPlacement = "float" | "perch";

export type { WodeAppPetBuddyMood };
export { resolvePetBuddyMood };

export type WodeAppPetBuddyProps = {
  kind?: WodeAppCompanionAvatar["kind"];
  /** Selected companion avatar; falls back to the kind default when omitted. */
  avatar?: WodeAppCompanionAvatar;
  /**
   * float = desktop companion (draggable).
   * perch = dialog-rim skin pet (not draggable; separate from 桌宠).
   */
  placement?: WodeAppPetBuddyPlacement;
  /** Session “进行中” panel. Off for perch (skin decoration only). */
  showSessionPanel?: boolean;
  workspaceSessionGroups: WorkspaceSessionGroup[];
  selectedSessionId: string | null;
  sessionStatusById?: Record<string, string>;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
};

function moodAriaLabel(
  mood: WodeAppPetBuddyMood,
  panelOpen: boolean,
  placement: WodeAppPetBuddyPlacement,
): string {
  if (placement === "perch") {
    if (mood === "sleep") return "对话框趴宠，小憩中";
    if (mood === "watch") return "对话框趴宠，正在看着你";
    return "对话框趴宠";
  }
  if (panelOpen) return "收起进行中对话";
  if (mood === "sleep") return "桌面陪伴，小憩中，点一下叫醒";
  if (mood === "watch") return "桌面陪伴，正在看着你";
  if (mood === "react") return "桌面陪伴";
  return "桌面陪伴";
}

type OsPetOverlayApi = {
  set: (state: {
    visible?: boolean;
    reacting?: boolean;
    reactionText?: string;
    panelOpen?: boolean;
    items?: WodeAppPetBuddyRecentItem[];
    selectedSessionId?: string | null;
  }) => Promise<{ ok?: boolean; mode?: string } | unknown>;
  onOpenSession: (
    callback: (payload: { workspaceId: string; sessionId: string }) => void,
  ) => () => void;
};

function getOsPetOverlayApi(): OsPetOverlayApi | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as {
    __OPENWORK_ELECTRON__?: { petOverlay?: OsPetOverlayApi };
  }).__OPENWORK_ELECTRON__?.petOverlay;
  return api && typeof api.set === "function" ? api : null;
}

const CLICK_REACTIONS = ["在呢", "看看进行中的对话", "这些还在跑", "随时叫我"] as const;

type PetPos = { right: number; bottom: number };

function readStoredPos(): PetPos | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PET_POS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PetPos>;
    if (typeof parsed.right !== "number" || typeof parsed.bottom !== "number") return null;
    return { right: parsed.right, bottom: parsed.bottom };
  } catch {
    return null;
  }
}

function storePos(pos: PetPos) {
  try {
    window.localStorage.setItem(PET_POS_STORAGE_KEY, JSON.stringify(pos));
  } catch {
    // ignore
  }
}

function statusLabelFor(status: string | undefined): string {
  if (!status || status === "idle") return "";
  if (status === "thinking") return "思考中";
  if (status === "responding") return "回复中";
  if (status === "waiting") return "等待确认";
  if (status === "error") return "出错";
  if (status === "compacting") return "整理中";
  if (/run|stream|busy|active/i.test(status)) return "运行中";
  return "进行中";
}

function collapsePreview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= PREVIEW_MAX_CHARS) return flat;
  return `${flat.slice(0, PREVIEW_MAX_CHARS - 1)}…`;
}

function plainTextFromMessage(message: UIMessage): string {
  const body = message.parts
    .flatMap((part) => {
      if (part.type === "reasoning") return [];
      if (part.type === "text") {
        const visible = stripProviderThinkTags(part.text).trim();
        return visible ? [visible] : [];
      }
      if (part.type === "dynamic-tool") {
        const name = "toolName" in part ? String(part.toolName || "tool") : "tool";
        return [`[工具:${name}]`];
      }
      return [];
    })
    .join("\n")
    .trim();
  return body;
}

function latestContentFromMessages(messages: UIMessage[] | undefined): string {
  if (!messages?.length) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const body = plainTextFromMessage(message);
    if (!body) continue;
    const who = message.role === "user" ? "你" : message.role === "assistant" ? "助手" : "";
    return collapsePreview(who ? `${who}：${body}` : body);
  }
  return "";
}

function latestContentFromDom(sessionId: string | null): string {
  if (typeof document === "undefined" || !sessionId) return "";
  const nodes = document.querySelectorAll<HTMLElement>("[data-message-role]");
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    const role = node.getAttribute("data-message-role") || "";
    const raw = (node.innerText || "").replace(/\s+/g, " ").trim();
    if (!raw) continue;
    const who = role === "user" ? "你" : role === "assistant" ? "助手" : "";
    return collapsePreview(who ? `${who}：${raw}` : raw);
  }
  return "";
}

function useTranscriptRevision(queryClient: ReturnType<typeof useQueryClient>, enabled: boolean) {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (!enabled) return () => {};
      return queryClient.getQueryCache().subscribe((event) => {
        const key = event.query.queryKey;
        if (Array.isArray(key) && key[0] === "react-session-transcript") onStoreChange();
      });
    },
    () => {
      if (!enabled) return 0;
      let stamp = 0;
      for (const query of queryClient.getQueryCache().getAll()) {
        const key = query.queryKey;
        if (Array.isArray(key) && key[0] === "react-session-transcript") {
          stamp += 1 + (query.state.dataUpdatedAt || 0);
        }
      }
      return stamp;
    },
    () => 0,
  );
}

function buildActiveItems(
  groups: WorkspaceSessionGroup[],
  sessionStatusById: Record<string, string> | undefined,
  selectedSessionId: string | null,
  queryClient: ReturnType<typeof useQueryClient>,
): WodeAppPetBuddyRecentItem[] {
  const candidates: Array<{
    workspaceId: string;
    sessionId: string;
    status: string | undefined;
    updatedAt: number;
    inProgress: boolean;
  }> = [];

  for (const group of groups) {
    const workspaceId = String(group.workspace?.id || "").trim();
    if (!workspaceId) continue;
    for (const session of filterVisibleWodeAppSessions(group.sessions)) {
      const status = sessionStatusById?.[session.id];
      candidates.push({
        workspaceId,
        sessionId: session.id,
        status,
        updatedAt: session.time?.updated ?? session.time?.created ?? 0,
        inProgress: isPetBuddyInProgressStatus(status),
      });
    }
  }

  const inProgress = candidates.filter((item) => item.inProgress);
  const pool = (inProgress.length > 0
    ? inProgress
    : candidates.filter((item) => item.sessionId === selectedSessionId)
  ).sort((a, b) => b.updatedAt - a.updatedAt);

  const items: WodeAppPetBuddyRecentItem[] = [];
  for (const item of pool.slice(0, ACTIVE_LIMIT)) {
    const cached = queryClient.getQueryData<UIMessage[]>(transcriptKey(item.workspaceId, item.sessionId));
    let preview = latestContentFromMessages(cached);
    if (!preview && item.sessionId === selectedSessionId) {
      preview = latestContentFromDom(selectedSessionId);
    }
    if (!preview) {
      preview = item.inProgress
        ? `${statusLabelFor(item.status) || "进行中"}…`
        : "还没有可读的最新内容";
    }
    items.push({
      workspaceId: item.workspaceId,
      sessionId: item.sessionId,
      preview,
      statusLabel: statusLabelFor(item.status),
      updatedAt: item.updatedAt,
    });
  }
  return items;
}

/**
 * Pet buddy — either desktop companion (float, draggable) or dialog perch (skin).
 * Callers must not collapse the two placements into one instance.
 */
export function WodeAppPetBuddy({
  kind = "sprite",
  avatar,
  placement = "float",
  showSessionPanel,
  workspaceSessionGroups,
  selectedSessionId,
  sessionStatusById,
  onOpenSession,
}: WodeAppPetBuddyProps) {
  const isPerch = placement === "perch";
  const panelEnabled = showSessionPanel ?? !isPerch;
  const activeAvatar = avatar ?? defaultWodeAppCompanionAvatar(kind);
  const queryClient = useQueryClient();
  const osPet = useMemo(() => getOsPetOverlayApi(), []);
  const rootRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originRight: number;
    originBottom: number;
    moved: boolean;
  } | null>(null);

  const [pos, setPos] = useState<PetPos>(() => readStoredPos() ?? { right: 16, bottom: 24 });
  const [panelOpen, setPanelOpen] = useState(false);
  const [reacting, setReacting] = useState(false);
  const [reactionText, setReactionText] = useState<string>("");
  const [reactionIndex, setReactionIndex] = useState(0);
  const [dragging, setDragging] = useState(false);
  /** One-shot sleep flag — never tick every second while idle. */
  const [asleep, setAsleep] = useState(false);
  const suppressClickRef = useRef(false);
  const lastFeedbackAtRef = useRef(0);

  const transcriptRevision = useTranscriptRevision(queryClient, panelEnabled && panelOpen);
  const selectedStatus = selectedSessionId ? sessionStatusById?.[selectedSessionId] : undefined;
  const sessionBusy = isPetBuddyInProgressStatus(selectedStatus);

  const activeItems = useMemo(
    () => buildActiveItems(workspaceSessionGroups, sessionStatusById, selectedSessionId, queryClient),
    [workspaceSessionGroups, sessionStatusById, selectedSessionId, queryClient, transcriptRevision, panelOpen],
  );

  // Keep any leftover desktop always-on-top pet hidden; default companion follows WodeAppX.
  useEffect(() => {
    if (!osPet) return;
    void osPet.set({ visible: false });
    return () => {
      void osPet.set({ visible: false });
    };
  }, [osPet]);

  useEffect(() => {
    if (!reacting) return;
    const timer = window.setTimeout(() => setReacting(false), 900);
    return () => window.clearTimeout(timer);
  }, [reacting]);

  useEffect(() => {
    if (sessionBusy || reacting) {
      setAsleep(false);
      return;
    }
    setAsleep(false);
    const timer = window.setTimeout(() => setAsleep(true), PET_BUDDY_SLEEP_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [sessionBusy, reacting, selectedSessionId]);

  // Pause CSS sprite work when the window is hidden (no React re-render).
  useEffect(() => {
    const syncHidden = () => {
      const el = rootRef.current;
      if (!el) return;
      el.setAttribute("data-page-hidden", document.hidden ? "1" : "0");
    };
    syncHidden();
    document.addEventListener("visibilitychange", syncHidden);
    return () => document.removeEventListener("visibilitychange", syncHidden);
  }, []);

  const mood = resolvePetBuddyMood({
    reacting,
    selectedStatus,
    asleep,
  });

  const clampPos = useCallback((next: PetPos): PetPos => {
    const el = rootRef.current;
    const hit = el?.querySelector(".wapp-theme-pet-hit") as HTMLElement | null;
    const elW = hit?.offsetWidth || el?.offsetWidth || 140;
    const elH = hit?.offsetHeight || 132;
    const viewW = typeof window !== "undefined" ? window.innerWidth : 1280;
    const viewH = typeof window !== "undefined" ? window.innerHeight : 800;
    return {
      right: Math.max(8, Math.min(Math.max(8, viewW - elW - 8), next.right)),
      bottom: Math.max(8, Math.min(Math.max(8, viewH - elH - 8), next.bottom)),
    };
  }, []);

  const triggerClickFeedback = useCallback(() => {
    const now = Date.now();
    if (now - lastFeedbackAtRef.current < 350) return;
    lastFeedbackAtRef.current = now;
    setAsleep(false);
    const text = CLICK_REACTIONS[reactionIndex % CLICK_REACTIONS.length];
    setReactionIndex((i) => i + 1);
    setReactionText(text);
    setReacting(true);
    if (panelEnabled) setPanelOpen((open) => !open);
  }, [panelEnabled, reactionIndex]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      // Perch pets stay on the dialog rim — click only, no free drag.
      if (isPerch) {
        suppressClickRef.current = true;
        triggerClickFeedback();
        return;
      }
      const pointerId = event.pointerId;
      dragRef.current = {
        pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originRight: pos.right,
        originBottom: pos.bottom,
        moved: false,
      };
      setDragging(true);

      const onMove = (ev: PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== ev.pointerId) return;
        const dx = ev.clientX - drag.startX;
        const dy = ev.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        drag.moved = true;
        setPos(clampPos({ right: drag.originRight - dx, bottom: drag.originBottom - dy }));
      };

      const onEnd = (ev: PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
        const drag = dragRef.current;
        dragRef.current = null;
        setDragging(false);
        if (!drag) return;
        if (drag.moved) {
          suppressClickRef.current = true;
          setPos((current) => {
            const next = clampPos(current);
            storePos(next);
            return next;
          });
          return;
        }
        suppressClickRef.current = true;
        triggerClickFeedback();
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
    },
    [clampPos, isPerch, pos.bottom, pos.right, triggerClickFeedback],
  );

  const onClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (dragRef.current) return;
    triggerClickFeedback();
  }, [triggerClickFeedback]);

  const className = [
    "wapp-theme-pet-buddy",
    isPerch ? "is-perch" : "is-float",
    panelOpen ? "is-open" : "",
    dragging ? "is-dragging" : "",
    reacting ? "is-reacting" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <aside
      ref={rootRef}
      className={className}
      data-active="1"
      data-mood={mood}
      data-placement={placement}
      data-kind={activeAvatar.kind}
      data-avatar={activeAvatar.id}
      style={isPerch ? undefined : { right: pos.right, bottom: pos.bottom }}
    >
      {panelEnabled && panelOpen ? (
        <div className="wapp-theme-pet-panel" role="dialog" aria-label="进行中的对话">
          <header className="wapp-theme-pet-panel-head">
            <strong>{activeItems.some((item) => item.statusLabel) ? "进行中" : "当前对话"}</strong>
            <button type="button" className="wapp-theme-pet-panel-close" onClick={() => setPanelOpen(false)}>
              收起
            </button>
          </header>
          {activeItems.length === 0 ? (
            <p className="wapp-theme-pet-panel-empty">还没有可显示的最新内容</p>
          ) : (
            <ul className="wapp-theme-pet-panel-list">
              {activeItems.map((item) => {
                const active = item.sessionId === selectedSessionId;
                return (
                  <li key={item.sessionId}>
                    <button
                      type="button"
                      className={`wapp-theme-pet-panel-item${active ? " is-active" : ""}`}
                      onClick={() => {
                        onOpenSession(item.workspaceId, item.sessionId);
                        setPanelOpen(false);
                        setReactionText("这就带你过去");
                        setReacting(true);
                      }}
                    >
                      <span className="wapp-theme-pet-panel-preview">{item.preview}</span>
                      {item.statusLabel ? (
                        <span className="wapp-theme-pet-panel-status">{item.statusLabel}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <footer className="wapp-theme-pet-panel-foot">
            <button
              type="button"
              className="wapp-theme-pet-panel-hide"
              onClick={() => {
                setPanelOpen(false);
                storeWodeAppCompanionPrefs({ enabled: false });
              }}
            >
              关闭陪伴
            </button>
          </footer>
        </div>
      ) : null}

      {reacting && reactionText ? (
        <div className="wapp-theme-pet-bubble" role="status">
          {reactionText}
        </div>
      ) : null}

      {mood === "sleep" && !panelOpen ? (
        <div className="wapp-theme-pet-zzz" aria-hidden="true">
          z
        </div>
      ) : null}

      <button
        type="button"
        className="wapp-theme-pet-hit"
        aria-label={moodAriaLabel(mood, panelEnabled && panelOpen, placement)}
        aria-expanded={panelEnabled ? panelOpen : undefined}
        title=""
        onPointerDown={onPointerDown}
        onClick={onClick}
      >
        {activeAvatar.kind === "live2d" ? (
          <WodeAppCompanionLive2D reacting={reacting || mood === "watch"} modelUrl={activeAvatar.live2dModelUrl} />
        ) : (
          <span
            className={companionAvatarSpriteClass(activeAvatar)}
            style={{
              ["--wapp-pet-sprite-sheet" as string]: `url(${JSON.stringify(companionAvatarSpriteSrc(activeAvatar))})`,
            }}
          />
        )}
      </button>
    </aside>
  );
}
