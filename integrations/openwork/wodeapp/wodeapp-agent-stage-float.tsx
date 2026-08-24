/** @jsxImportSource react */
import * as React from "react";

import type { WodeAppBuiltinAgent } from "./runtime-projects";
import {
  WODEAPP_AGENT_STAGE_STATUS_LABEL,
  buildWodeAppAgentStageCards,
  clampWodeAppAgentStagePosition,
  emptyWodeAppAgentStageSnapshot,
  markWodeAppAgentStageWorking,
  readWodeAppAgentStageSnapshot,
  snapWodeAppAgentStagePosition,
  writeWodeAppAgentStageSnapshot,
  type WodeAppAgentStageSnapshot,
} from "./wodeapp-agent-stage";

import "./wodeapp-agent-stage-float.css";

const FLOAT_WIDTH = 300;
const FLOAT_HEIGHT = 210;

export type WodeAppAgentStageFloatProps = {
  agents: readonly WodeAppBuiltinAgent[];
  sessionKey?: string | null;
  onOpenAgent: (agent: WodeAppBuiltinAgent) => void;
};

function storageKeyForSession(sessionKey?: string | null) {
  const key = typeof sessionKey === "string" ? sessionKey.trim() : "";
  return key ? `wodeappx.agent-stage.v1:${key}` : "wodeappx.agent-stage.v1";
}

function faceGlyph(label: string) {
  return label.slice(0, 1) || "智";
}

export function WodeAppAgentStageFloat({
  agents,
  sessionKey,
  onOpenAgent,
}: WodeAppAgentStageFloatProps) {
  const storageKey = storageKeyForSession(sessionKey);
  const [snapshot, setSnapshot] = React.useState<WodeAppAgentStageSnapshot>(() =>
    readWodeAppAgentStageSnapshot(storageKey),
  );
  const dragRef = React.useRef<{
    pointerId: number;
    originX: number;
    originY: number;
    startLeft: number;
    startTop: number;
  } | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setSnapshot(readWodeAppAgentStageSnapshot(storageKey));
  }, [storageKey]);

  React.useEffect(() => {
    writeWodeAppAgentStageSnapshot(snapshot, storageKey);
  }, [snapshot, storageKey]);

  const cards = React.useMemo(
    () => buildWodeAppAgentStageCards(agents, snapshot),
    [agents, snapshot],
  );

  const docked = snapshot.left == null || snapshot.top == null;
  const style = docked
    ? undefined
    : ({ left: snapshot.left ?? undefined, top: snapshot.top ?? undefined } as React.CSSProperties);

  const expand = React.useCallback(() => {
    setSnapshot((current) => ({ ...current, expanded: true }));
  }, []);

  const collapse = React.useCallback(() => {
    setSnapshot((current) => ({ ...current, expanded: false }));
  }, []);

  const openCard = React.useCallback((agentId: string) => {
    const agent = agents.find((item) => item.id === agentId);
    if (!agent) return;
    setSnapshot((current) => markWodeAppAgentStageWorking(current, agentId));
    onOpenAgent(agent);
  }, [agents, onOpenAgent]);

  const onPointerDown = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("button, .wapp-agent-stage-card")) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
    };
    panel.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, []);

  const onPointerMove = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = clampWodeAppAgentStagePosition(
      drag.startLeft + (event.clientX - drag.originX),
      drag.startTop + (event.clientY - drag.originY),
      { width: FLOAT_WIDTH, height: FLOAT_HEIGHT },
      { width: window.innerWidth, height: window.innerHeight },
    );
    setSnapshot((current) => ({ ...current, left: next.left, top: next.top }));
  }, []);

  const onPointerUp = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setSnapshot((current) => {
      if (current.left == null || current.top == null) return current;
      const snapped = snapWodeAppAgentStagePosition(
        current.left,
        current.top,
        { width: FLOAT_WIDTH, height: FLOAT_HEIGHT },
        { width: window.innerWidth, height: window.innerHeight },
      );
      return { ...current, left: snapped.left, top: snapped.top };
    });
  }, []);

  if (cards.length === 0) return null;

  if (!snapshot.expanded) {
    return (
      <button
        type="button"
        className="wapp-agent-stage-pill"
        aria-label="展开任务场"
        title="任务场"
        onClick={expand}
      >
        <span className="wapp-agent-stage-pill-pip" aria-hidden />
        <span className="wapp-agent-stage-pill-face" aria-hidden>{faceGlyph("任")}</span>
        <span>任务场</span>
      </button>
    );
  }

  return (
    <div
      ref={panelRef}
      className="wapp-agent-stage-float"
      data-docked={docked ? "1" : "0"}
      style={style}
      role="dialog"
      aria-label="任务场"
    >
      <div
        className="wapp-agent-stage-float-header"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="wapp-agent-stage-float-drag" aria-hidden>
          <i /><i /><i /><i /><i /><i /><i /><i /><i />
        </span>
        <span className="wapp-agent-stage-float-title">任务场</span>
        <button
          type="button"
          className="wapp-agent-stage-float-collapse"
          aria-label="收起任务场"
          title="收起"
          onClick={collapse}
        >
          ∨
        </button>
      </div>
      <div className="wapp-agent-stage-float-body">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            className="wapp-agent-stage-card"
            data-status={card.status}
            title={card.name}
            onClick={() => openCard(card.id)}
          >
            <span className="wapp-agent-stage-card-face" aria-hidden>
              {faceGlyph(card.label)}
            </span>
            <span className="wapp-agent-stage-card-label">{card.label}</span>
            <span className="wapp-agent-stage-card-status">
              {WODEAPP_AGENT_STAGE_STATUS_LABEL[card.status]}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function resetWodeAppAgentStageFloatStateForTests() {
  return emptyWodeAppAgentStageSnapshot();
}
