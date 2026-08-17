import { MessageSquareText } from "lucide-react";

import type { WodeAppBuiltinAgent } from "./runtime-projects";
import {
  WODEAPP_FEISHU_AGENT_ID,
  WODEAPP_FEISHU_MCP_SERVER,
  WODEAPP_OPEN_AGENT_VIEW_EVENT,
  getVisibleWodeAppBuiltinAgents,
} from "./runtime-projects";
import { useWodeAppWorkbench } from "./wodeapp-workbench-context";

import "./wodeapp-agents-home.css";

type WodeAppSessionStartersProps = {
  className?: string;
  onStartAgent: (agent: WodeAppBuiltinAgent) => void;
};

export function WodeAppSessionStarters(props: WodeAppSessionStartersProps) {
  const { feishuSetupSkillReady, onAuthorizeFeishu, onOpenExtensionsSettings } = useWodeAppWorkbench();
  const feishuAgent = getVisibleWodeAppBuiltinAgents({ feishuSetupSkillReady })
    .find((agent) => agent.id === WODEAPP_FEISHU_AGENT_ID);
  if (!feishuAgent) return null;

  const openFeishuConnect = () => {
    if (onAuthorizeFeishu) {
      void onAuthorizeFeishu();
      return;
    }
    onOpenExtensionsSettings("mcp", {
      mcpSearch: "feishu",
      mcpDetailServerName: WODEAPP_FEISHU_MCP_SERVER,
    });
  };

  const openFeishuWorkbench = () => {
    window.dispatchEvent(new CustomEvent(WODEAPP_OPEN_AGENT_VIEW_EVENT, { detail: feishuAgent }));
  };

  return (
    <div className={`wapp-agents-home wapp-agents-home-grid-only${props.className ? ` ${props.className}` : ""}`}>
      <section className="wapp-agents-section">
        <div className="wapp-agents-section-head">
          <h2>默认智能体</h2>
          <p>
            <span className="wapp-agents-green-dot" aria-hidden />
            飞书快捷接入已开放
          </p>
        </div>
        <div className="wapp-agents-grid">
          <article className="wapp-agents-card tone-green">
            <div className="wapp-agents-card-head">
              <span className="wapp-agents-icon" aria-hidden>
                <MessageSquareText />
              </span>
              <div>
                <h3>{feishuAgent.name}</h3>
                <p>{feishuAgent.meta}</p>
              </div>
              <button type="button" onClick={openFeishuWorkbench}>
                打开工作台
              </button>
            </div>
            <ul>
              <li>
                <button
                  type="button"
                  className="wapp-agents-history-button"
                  onClick={() => props.onStartAgent(feishuAgent)}
                >
                  <span className="wapp-agents-item-dot" aria-hidden />
                  <span>汇总多维表、群消息和云文档，生成电商经营周报</span>
                  <span className="wapp-agents-history-tag">周报</span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className="wapp-agents-history-button"
                  onClick={openFeishuConnect}
                >
                  <span className="wapp-agents-item-dot is-warn" aria-hidden />
                  <span>首次使用先完成浏览器授权，后续可直接复用连接</span>
                  <span className="wapp-agents-history-tag">授权</span>
                </button>
              </li>
            </ul>
          </article>
        </div>
      </section>
    </div>
  );
}
