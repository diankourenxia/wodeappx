/** @jsxImportSource react */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Chrome, Loader2, Plug, Server, Settings2, ShoppingBag } from "lucide-react";

import { toast } from "@/components/ui/sonner";
import { openDesktopUrl } from "@/app/lib/desktop";
import {
  applyWodeAppProvider,
  checkWodeAppBuiltInTools,
  type WodeAppBuiltInToolsHealth,
} from "@/app/lib/wodeapp-auth";
import { useWodeAppAuthSession } from "./use-wodeapp-auth-session";

const BROWSER_BRIDGE_BASE = "http://127.0.0.1:17654";

type BrowserBridgeState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | {
      kind: "ready";
      connected: boolean;
      version: string;
      transport: string;
      distribution: string;
      setupUrl: string;
    };

type ConnectorStatus = "connected" | "disconnected" | "action";

type ConnectorCard = {
  id: string;
  name: string;
  sub: string;
  desc: string;
  icon: React.ReactNode;
  tone: string;
  status: ConnectorStatus;
  statusLabel: string;
  chips: string[];
  primaryAction: { label: string; onClick: () => void } | null;
  secondaryAction: { label: string; onClick: () => void } | null;
};

function originHost(origin: string | null | undefined): string {
  if (!origin) return "";
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

export function WodeAppConnectorsSection() {
  const navigate = useNavigate();
  const { authConfig, signedIn, refreshAuth } = useWodeAppAuthSession();
  const [tools, setTools] = React.useState<WodeAppBuiltInToolsHealth | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [browserBridge, setBrowserBridge] = React.useState<BrowserBridgeState>({ kind: "loading" });

  const refreshTools = React.useCallback(async () => {
    const health = await checkWodeAppBuiltInTools();
    setTools(health);
    return health;
  }, []);

  const refreshBrowserBridge = React.useCallback(async () => {
    try {
      const response = await fetch(`${BROWSER_BRIDGE_BASE}/health`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      const client = Array.isArray(data?.clients) ? data.clients[0] : null;
      setBrowserBridge({
        kind: "ready",
        connected: Boolean(client),
        version: String(client?.extensionVersion || ""),
        transport: String(client?.transport || ""),
        distribution: String(client?.distribution || ""),
        setupUrl: String(data?.setup?.url || `${BROWSER_BRIDGE_BASE}/setup`),
      });
    } catch {
      setBrowserBridge({ kind: "unavailable" });
    }
  }, []);

  React.useEffect(() => {
    setTools(authConfig?.builtInTools ?? null);
    void refreshTools();
  }, [authConfig?.builtInTools, refreshTools]);

  React.useEffect(() => {
    void refreshBrowserBridge();
    const timer = window.setInterval(() => void refreshBrowserBridge(), 15_000);
    return () => window.clearInterval(timer);
  }, [refreshBrowserBridge]);

  const platformConnected = Boolean(tools?.ok);
  const host = originHost(authConfig?.origin);

  const enablePlatform = async () => {
    if (!signedIn) {
      navigate("/settings/service");
      toast("请先在「服务与模型」中配置 Origin 与 API Key");
      return;
    }
    setBusy(true);
    try {
      const result = await applyWodeAppProvider();
      if (!result.ok) {
        toast.error(result.error || "启用失败，请检查服务配置");
        return;
      }
      await refreshAuth();
      const health = await refreshTools();
      toast(health.ok ? `Platform MCP 已连接 · ${health.toolCount} 个工具` : "已写入配置，等待服务就绪");
    } finally {
      setBusy(false);
    }
  };

  const refreshPlatform = async () => {
    setBusy(true);
    try {
      await refreshAuth();
      const health = await refreshTools();
      toast(health.ok ? `状态已刷新 · ${health.toolCount} 个工具` : "暂时无法连接 Platform MCP");
    } finally {
      setBusy(false);
    }
  };

  const goExtensions = () => navigate("/settings/extensions");
  const goService = () => navigate("/settings/service");

  const browserConnected = browserBridge.kind === "ready" && browserBridge.connected;
  const browserSetupUrl = browserBridge.kind === "ready" ? browserBridge.setupUrl : `${BROWSER_BRIDGE_BASE}/setup`;
  const openBrowserSetup = (mode: "install" | "detect" = "install") => {
    const query = mode === "detect" ? "autorun=1&mode=detect" : "autorun=1";
    void openDesktopUrl(`${browserSetupUrl}?${query}`);
    toast(
      mode === "detect"
        ? "已开始连接检测（不会打开应用商店）"
        : "已打开一键安装/自检页，按页面提示操作即可",
    );
  };
  const browserStatusLabel =
    browserBridge.kind === "loading"
      ? "检测中"
      : browserBridge.kind === "unavailable"
        ? "桌面端未就绪"
        : browserConnected
          ? "已连接"
          : "未连接";
  const browserChips =
    browserBridge.kind === "ready" && browserConnected
      ? [
          browserBridge.version ? `v${browserBridge.version}` : "已连接",
          browserBridge.transport === "native_messaging" ? "Native 通道" : "本地通道",
        ]
      : ["读页面", "点击", "截图"];

  const cards: ConnectorCard[] = [
    {
      id: "platform",
      name: "WodeApp Platform",
      sub: host ? `${host} · 平台主接口` : "平台主接口",
      desc: "建项目、编辑页面、一键发布站点。配置 API Key 后自动接入。",
      icon: <Server aria-hidden />,
      tone: "tone-blue",
      status: platformConnected ? "connected" : "disconnected",
      statusLabel: platformConnected ? "已连接" : signedIn ? "未连接" : "未配置",
      chips: platformConnected
        ? [`${tools?.toolCount ?? 0} 个工具`]
        : ["建站", "发布", "页面"],
      primaryAction: platformConnected
        ? { label: "刷新", onClick: () => void refreshPlatform() }
        : { label: signedIn ? "一键启用" : "去配置", onClick: () => void enablePlatform() },
      secondaryAction: platformConnected ? { label: "服务设置", onClick: goService } : null,
    },
    {
      id: "chrome",
      name: "Chrome 浏览器控制",
      sub: "本机浏览器扩展",
      desc: "让智能体直接操作你的 Chrome：打开页面、读取内容、点击与截图。",
      icon: <Chrome aria-hidden />,
      tone: "tone-chrome",
      status: browserConnected ? "connected" : "disconnected",
      statusLabel: browserStatusLabel,
      chips: browserChips,
      primaryAction:
        browserBridge.kind === "unavailable"
          ? null
          : {
              label: browserConnected ? "一键自检" : "一键安装",
              onClick: () => openBrowserSetup(browserConnected ? "detect" : "install"),
            },
      secondaryAction:
        browserBridge.kind === "unavailable"
          ? { label: "刷新", onClick: () => void refreshBrowserBridge() }
          : browserConnected
            ? { label: "刷新", onClick: () => void refreshBrowserBridge() }
            : { label: "已安装，开始连接检测", onClick: () => openBrowserSetup("detect") },
    },
    {
      id: "project",
      name: "WodeApp Project",
      sub: "项目运行时工具",
      desc: "数据集合、工作流、AI 生成、素材库。按项目启用后自动生效。",
      icon: <Plug aria-hidden />,
      tone: "tone-purple",
      status: "disconnected",
      statusLabel: "按需启用",
      chips: ["数据", "工作流", "素材"],
      primaryAction: { label: "去配置", onClick: goExtensions },
      secondaryAction: null,
    },
    {
      id: "shopify",
      name: "Shopify",
      sub: "电商店铺",
      desc: "读取商品、订单与库存，配合智能体批量生成主图与营销素材。",
      icon: <ShoppingBag aria-hidden />,
      tone: "tone-green",
      status: "action",
      statusLabel: "需授权",
      chips: ["商品", "订单", "素材"],
      primaryAction: { label: "去授权", onClick: goExtensions },
      secondaryAction: null,
    },
    {
      id: "feishu",
      name: "飞书",
      sub: "协作与多维表格",
      desc: "把生成的内容与经营周报推送到飞书群、多维表格与云文档。",
      icon: <Settings2 aria-hidden />,
      tone: "tone-lark",
      status: "disconnected",
      statusLabel: "未连接",
      chips: ["群消息", "多维表格", "云文档"],
      primaryAction: { label: "去配置", onClick: goExtensions },
      secondaryAction: null,
    },
    {
      id: "dingtalk",
      name: "钉钉",
      sub: "企业协同",
      desc: "生成结果推送到钉钉群机器人，支持任务提醒与审批消息。",
      icon: <Settings2 aria-hidden />,
      tone: "tone-ding",
      status: "disconnected",
      statusLabel: "未连接",
      chips: ["群机器人", "消息推送"],
      primaryAction: { label: "去配置", onClick: goExtensions },
      secondaryAction: null,
    },
  ];

  return (
    <section className="wx-connectors" aria-label="连接器">
      <div className="wx-connectors-head">
        <span className="wx-connectors-title">连接器</span>
        <span className="wx-connectors-sub">连接后，智能体才能读写对应平台的数据</span>
      </div>
      <div className="wx-connectors-grid">
        {cards.map((card) => (
          <div
            key={card.id}
            className={`wx-connector-card ${card.tone}${card.status === "connected" ? " is-connected" : ""}`}
          >
            <div className="wx-connector-top">
              <span className={`wx-connector-icon ${card.tone}`} aria-hidden>
                {card.icon}
              </span>
              <span className="wx-connector-names">
                <span className="wx-connector-name">{card.name}</span>
                <span className="wx-connector-sub">{card.sub}</span>
              </span>
              <span className={`wx-connector-status is-${card.status}`}>
                {card.status === "connected" ? <CheckCircle2 aria-hidden /> : null}
                {card.statusLabel}
              </span>
            </div>
            <p className="wx-connector-desc">{card.desc}</p>
            <div className="wx-connector-chips">
              {card.chips.map((chip) => (
                <span key={chip} className="wx-connector-chip">{chip}</span>
              ))}
            </div>
            <div className="wx-connector-actions">
              {card.secondaryAction ? (
                <button
                  type="button"
                  className="wx-connector-btn is-ghost"
                  disabled={busy}
                  onClick={card.secondaryAction.onClick}
                >
                  {card.secondaryAction.label}
                </button>
              ) : null}
              {card.primaryAction ? (
                <button
                  type="button"
                  className={`wx-connector-btn${card.status === "connected" ? " is-ghost" : " is-primary is-block"}`}
                  disabled={busy}
                  onClick={card.primaryAction.onClick}
                >
                  {busy ? <Loader2 aria-hidden className="wx-connector-spin" /> : null}
                  {card.primaryAction.label}
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
