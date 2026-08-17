/** @jsxImportSource react */
import * as React from "react";
import {
  ArrowRight,
  Library,
  Plug,
  Settings2,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { useDigitalAssetsList } from "./digital-assets-store";
import {
  WODEAPP_FEISHU_MCP_SERVER,
  WODEAPP_WYNNE_AGENT_ID,
} from "./runtime-projects";
import {
  findWodeAppRuntimeProfile,
  WODEAPP_WYNNE_RUNTIME_PROFILE_ID,
} from "./wodeapp-runtime-profile";
import { requestWodeAppAssetSurfaceMode } from "./wodeapp-asset-surface-mode";
import { useWodeAppWorkbench } from "./wodeapp-workbench-context";
import {
  WODEAPP_SHOPIFY_ADMIN_MCP_SERVER,
  WYNNE_BRAND_CONNECTORS,
  WYNNE_BRAND_WORKFLOWS,
  buildWynneBrandTask,
  isWynneBrandWorkflowId,
  listWynneRelatedDigitalAssets,
  type WynneBrandConnector,
} from "./wodeapp-wynne-brand-workbench-data";

export {
  WODEAPP_SHOPIFY_ADMIN_MCP_SERVER,
  WYNNE_BRAND_CONNECTORS,
  WYNNE_BRAND_WORKFLOWS,
  buildWynneBrandPrompt,
  buildWynneBrandTask,
  isWynneBrandWorkflowId,
  listWynneRelatedDigitalAssets,
} from "./wodeapp-wynne-brand-workbench-data";
export type {
  WynneBrandConnector,
  WynneBrandWorkflow,
  WynneBrandWorkflowId,
} from "./wodeapp-wynne-brand-workbench-data";

const WYNNE_PROFILE = findWodeAppRuntimeProfile(WODEAPP_WYNNE_RUNTIME_PROFILE_ID);

export function WodeAppWynneBrandWorkbench() {
  const {
    selectedWorkspaceId,
    onAuthorizeFeishu,
    onCreateTaskWithPrompt,
    onOpenExtensionsSettings,
    onOpenAssetsSurface,
  } = useWodeAppWorkbench();
  const assets = useDigitalAssetsList();
  const relatedAssets = React.useMemo(() => listWynneRelatedDigitalAssets(assets), [assets]);
  const [authorizing, setAuthorizing] = React.useState(false);

  const openShopifyMcp = React.useCallback(() => {
    onOpenExtensionsSettings("mcp", {
      mcpSearch: "shopify",
      mcpDetailServerName: WODEAPP_SHOPIFY_ADMIN_MCP_SERVER,
    });
  }, [onOpenExtensionsSettings]);

  const openFeishuMcp = React.useCallback(async () => {
    if (onAuthorizeFeishu) {
      setAuthorizing(true);
      try {
        await onAuthorizeFeishu({ source: WODEAPP_WYNNE_AGENT_ID });
      } finally {
        setAuthorizing(false);
      }
      return;
    }
    onOpenExtensionsSettings("mcp", {
      mcpSearch: "feishu",
      mcpDetailServerName: WODEAPP_FEISHU_MCP_SERVER,
    });
  }, [onAuthorizeFeishu, onOpenExtensionsSettings]);

  const openAssets = React.useCallback(() => {
    requestWodeAppAssetSurfaceMode("library");
    onOpenAssetsSurface?.();
  }, [onOpenAssetsSurface]);

  const runWorkflow = React.useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    const workflowId = event.currentTarget.dataset.workflowId;
    if (!isWynneBrandWorkflowId(workflowId)) return;
    onCreateTaskWithPrompt(selectedWorkspaceId, buildWynneBrandTask(workflowId));
  }, [onCreateTaskWithPrompt, selectedWorkspaceId]);

  const runConnectorAction = React.useCallback((action: WynneBrandConnector["action"]) => {
    if (action === "shopify-mcp") {
      openShopifyMcp();
      return;
    }
    if (action === "feishu-mcp") {
      void openFeishuMcp();
      return;
    }
    if (action === "assets") {
      openAssets();
      return;
    }
    onCreateTaskWithPrompt(selectedWorkspaceId, buildWynneBrandTask("knowledge-lookup"));
  }, [onCreateTaskWithPrompt, openAssets, openFeishuMcp, openShopifyMcp, selectedWorkspaceId]);

  const connectorScopes = WYNNE_PROFILE?.connectorScopes.join(" · ") || "shopify · feishu";
  const knowledgeScopes = WYNNE_PROFILE?.knowledgeScopes.join(" · ") || "wynne";

  return (
    <main className="wx-feishu-commerce wx-wynne-brand" aria-label="Wynne 品牌智能体工作台">
      <section className="wx-feishu-commerce-hero">
        <div className="wx-feishu-commerce-hero-copy">
          <div className="wx-feishu-commerce-kicker">
            <span className="wx-feishu-commerce-status-dot" aria-hidden />
            Wynne 品牌智能体
          </div>
          <h1>品牌专属 Runtime，按需连接 MCP 与资产</h1>
          <p>
            与默认智能体不同：本会话绑定 Wynne Runtime Profile，关联 Shopify、飞书与品牌知识范围；
            工具与知识按需发现，不预载整库上下文。
          </p>
          <div className="wx-feishu-commerce-hero-actions">
            <button
              type="button"
              className="wx-feishu-commerce-button is-primary"
              onClick={runWorkflow}
              data-workflow-id="brand-chat"
            >
              <Sparkles aria-hidden />
              <span>开始品牌对话</span>
              <ArrowRight aria-hidden />
            </button>
            <button type="button" className="wx-feishu-commerce-button" onClick={openShopifyMcp}>
              <Plug aria-hidden />
              <span>Shopify MCP</span>
            </button>
            <button
              type="button"
              className="wx-feishu-commerce-button"
              onClick={() => void openFeishuMcp()}
              disabled={authorizing}
            >
              <Settings2 aria-hidden />
              <span>{authorizing ? "正在连接飞书" : "飞书授权 / MCP"}</span>
            </button>
          </div>
        </div>
        <aside className="wx-feishu-commerce-weekly-card" aria-label="Runtime Profile">
          <div className="wx-feishu-commerce-weekly-head">
            <div>
              <span>Runtime Profile</span>
              <strong>{WYNNE_PROFILE?.name || "Wynne 品牌智能体"}</strong>
            </div>
            <ShieldCheck aria-hidden />
          </div>
          <div className="wx-feishu-commerce-metric-grid">
            <div><span>连接器范围</span><strong>{connectorScopes}</strong></div>
            <div><span>知识范围</span><strong>{knowledgeScopes}</strong></div>
            <div><span>工具发现</span><strong>tool_search + profile</strong></div>
            <div><span>数字资产</span><strong>{relatedAssets.length > 0 ? `${relatedAssets.length} 条相关` : "可从资产库引用"}</strong></div>
          </div>
          <div className="wx-feishu-commerce-safety-note">
            <ShieldCheck aria-hidden />
            <span>不编造店铺数据；写操作与发布前必须确认；连接状态以实时工具结果为准。</span>
          </div>
        </aside>
      </section>

      <section className="wx-feishu-commerce-section">
        <div className="wx-feishu-commerce-section-head">
          <div>
            <span className="wx-feishu-commerce-section-kicker">关联能力</span>
            <h2>MCP、知识库与数字资产</h2>
          </div>
          <p>这些是 Wynne 品牌智能体相对默认智能体多出来的关联面；未连接时先完成授权。</p>
        </div>
        <div className="wx-feishu-commerce-source-grid">
          {WYNNE_BRAND_CONNECTORS.map((connector) => {
            const Icon = connector.Icon;
            return (
              <button
                type="button"
                className="wx-feishu-commerce-source wx-wynne-brand-connector"
                key={connector.id}
                onClick={() => runConnectorAction(connector.action)}
              >
                <span className="wx-feishu-commerce-source-icon" aria-hidden><Icon /></span>
                <div>
                  <h3>{connector.title}</h3>
                  <p>{connector.description}</p>
                  <span>{connector.examples}</span>
                </div>
                <small>{connector.badge}</small>
              </button>
            );
          })}
        </div>
      </section>

      <section className="wx-feishu-commerce-section">
        <div className="wx-feishu-commerce-section-head">
          <div>
            <span className="wx-feishu-commerce-section-kicker">数字资产</span>
            <h2>可引用的品牌 / 商品素材</h2>
          </div>
          <p>
            {relatedAssets.length > 0
              ? "以下为与 Wynne / 品牌库相关的本地数字资产，可在对话中 @ 引用。"
              : "暂无匹配到 Wynne 相关资产；可先到数字资产页建立品牌库或商品库。"}
          </p>
        </div>
        {relatedAssets.length > 0 ? (
          <div className="wx-feishu-commerce-workflow-grid">
            {relatedAssets.map((asset) => (
              <button
                type="button"
                className="wx-feishu-commerce-workflow"
                key={asset.id}
                onClick={openAssets}
              >
                <span className="wx-feishu-commerce-workflow-icon" aria-hidden><Library /></span>
                <span className="wx-feishu-commerce-workflow-copy">
                  <span className="wx-feishu-commerce-workflow-title">
                    <strong>{asset.name}</strong>
                    <small>{asset.kind}</small>
                  </span>
                  <span>{asset.meta || "打开数字资产库查看"}</span>
                </span>
                <ArrowRight className="wx-feishu-commerce-workflow-arrow" aria-hidden />
              </button>
            ))}
          </div>
        ) : (
          <div className="wx-feishu-commerce-hero-actions" style={{ padding: "0 4px 4px" }}>
            <button type="button" className="wx-feishu-commerce-button is-primary" onClick={openAssets}>
              <Library aria-hidden />
              <span>打开数字资产</span>
              <ArrowRight aria-hidden />
            </button>
          </div>
        )}
      </section>

      <section className="wx-feishu-commerce-section">
        <div className="wx-feishu-commerce-section-head">
          <div>
            <span className="wx-feishu-commerce-section-kicker">快捷任务</span>
            <h2>带着 Wynne Profile 开聊</h2>
          </div>
          <p>每个入口都会新建对话并绑定 Runtime Profile，不会走默认智能体上下文。</p>
        </div>
        <div className="wx-feishu-commerce-workflow-grid">
          {WYNNE_BRAND_WORKFLOWS.map((workflow) => {
            const Icon = workflow.Icon;
            return (
              <button
                type="button"
                className="wx-feishu-commerce-workflow"
                key={workflow.id}
                data-workflow-id={workflow.id}
                onClick={runWorkflow}
              >
                <span className="wx-feishu-commerce-workflow-icon" aria-hidden><Icon /></span>
                <span className="wx-feishu-commerce-workflow-copy">
                  <span className="wx-feishu-commerce-workflow-title">
                    <strong>{workflow.title}</strong>
                    <small>{workflow.tag}</small>
                  </span>
                  <span>{workflow.description}</span>
                </span>
                <ArrowRight className="wx-feishu-commerce-workflow-arrow" aria-hidden />
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
}
