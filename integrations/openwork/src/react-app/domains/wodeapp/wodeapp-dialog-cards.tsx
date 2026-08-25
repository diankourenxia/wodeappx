/** @jsxImportSource react */
import * as React from "react";

import {
  findWodeAppBuiltinAgent,
  openWodeAppBuiltinAgentView,
} from "./runtime-projects";
import { WODEAPP_AGENT_STAGE_STATUS_LABEL } from "./wodeapp-agent-stage";
import {
  WODEAPP_DIALOG_CARD_CHANGED_EVENT,
  listWodeAppDialogCardsWithStatus,
  type WodeAppDialogCard,
} from "./wodeapp-dialog-card";
import { useOptionalWodeAppWorkbench } from "./wodeapp-workbench-context";

import "./wodeapp-dialog-card.css";

export function WodeAppDialogCards() {
  const workbench = useOptionalWodeAppWorkbench();
  const sessionId = workbench?.selectedSessionId?.trim() || "";
  const [cards, setCards] = React.useState(() =>
    sessionId ? listWodeAppDialogCardsWithStatus(sessionId) : [],
  );

  const refresh = React.useCallback(() => {
    setCards(sessionId ? listWodeAppDialogCardsWithStatus(sessionId) : []);
  }, [sessionId]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  React.useEffect(() => {
    if (!sessionId || typeof window === "undefined") return;
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string }>).detail;
      if (detail?.sessionId && detail.sessionId !== sessionId) return;
      refresh();
    };
    window.addEventListener(WODEAPP_DIALOG_CARD_CHANGED_EVENT, onChange);
    window.addEventListener("wodeapp:skin-changed", refresh);
    return () => {
      window.removeEventListener(WODEAPP_DIALOG_CARD_CHANGED_EVENT, onChange);
      window.removeEventListener("wodeapp:skin-changed", refresh);
    };
  }, [refresh, sessionId]);

  if (!sessionId || cards.length === 0) return null;

  const openCard = (card: WodeAppDialogCard) => {
    const agent = findWodeAppBuiltinAgent(card.agentId);
    if (!agent) return;
    openWodeAppBuiltinAgentView(agent, undefined, sessionId);
  };

  return (
    <div className="wapp-dialog-cards" data-wodeapp-dialog-cards="1" aria-label="调度卡">
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          className="wapp-dialog-card"
          data-status={card.status}
          data-agent-id={card.agentId}
          title={`打开${card.name}工作台`}
          onClick={() => openCard(card)}
        >
          <span className="wapp-dialog-card-cycle" aria-hidden>{card.cycle}</span>
          <span className="wapp-dialog-card-copy">
            <span className="wapp-dialog-card-name">{card.name}</span>
            <span className="wapp-dialog-card-status">
              {WODEAPP_AGENT_STAGE_STATUS_LABEL[card.status]}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
