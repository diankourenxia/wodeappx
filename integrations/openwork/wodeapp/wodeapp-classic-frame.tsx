/** @jsxImportSource react */
import {
  Archive,
  Bot,
  CalendarClock,
  FolderOpen,
  MessageCircle,
  Palette,
  Plug,
  Radar,
  Settings,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import type { WodeAppSkinId } from "./wodeapp-skins";
import type { WodeAppSurface } from "./wodeapp-types";

const WODEAPP_MARK_SRC = `${import.meta.env.BASE_URL}wodeapp-mark.png`;

const CLASSIC_TOOLS: Array<{
  id: WodeAppSurface | "new";
  label: string;
  icon: typeof Bot;
}> = [
  { id: "new", label: "新建任务", icon: Sparkles },
  { id: "schedule", label: "已安排", icon: CalendarClock },
  { id: "assets", label: "商品与素材", icon: FolderOpen },
  { id: "plugins", label: "插件", icon: Plug },
  { id: "capture", label: "内容抓取", icon: Radar },
  { id: "agents", label: "聊天", icon: MessageCircle },
];

type WodeAppClassicFrameProps = {
  activeSurface: WodeAppSurface;
  onCreateTask: () => void;
  onSkinChange: (skin: WodeAppSkinId) => void;
  onSurfaceChange: (surface: WodeAppSurface) => void;
};

export function WodeAppClassicFrame({
  activeSurface,
  onCreateTask,
  onSkinChange,
  onSurfaceChange,
}: WodeAppClassicFrameProps) {
  return (
    <>
      <header className="wapp-classic-titlebar mac:titlebar-drag">
        <img src={WODEAPP_MARK_SRC} alt="" width={22} height={22} />
        <strong>WodeAppX 2007</strong>
        <span>桌面 AI 工作台</span>
      </header>

      <nav className="wapp-classic-toolbar mac:titlebar-no-drag" aria-label="经典皮肤快捷导航">
        {CLASSIC_TOOLS.map(({ id, label, icon: Icon }) => {
          const active = id !== "new" && activeSurface === id;
          return (
            <button
              key={id}
              type="button"
              className={active ? "is-active" : undefined}
              onClick={() => {
                if (id === "new") onCreateTask();
                else onSurfaceChange(id);
              }}
            >
              <Icon aria-hidden />
              <span>{label}</span>
            </button>
          );
        })}
        <span className="wapp-classic-toolbar-separator" aria-hidden />
        <button type="button" onClick={() => onSkinChange("default")}>
          <Palette aria-hidden />
          <span>默认外观</span>
        </button>
      </nav>
    </>
  );
}

type WodeAppClassicAssistantRailProps = {
  activeSurfaceLabel: string;
  onOpenAccount: () => void;
  onOpenAgents: () => void;
  onOpenSettings: () => void;
};

export function WodeAppClassicAssistantRail({
  activeSurfaceLabel,
  onOpenAccount,
  onOpenAgents,
  onOpenSettings,
}: WodeAppClassicAssistantRailProps) {
  return (
    <aside className="wapp-classic-assistant" aria-label="WodeAppX 助手栏">
      <header>
        <Bot aria-hidden />
        <strong>WodeAppX 助手</strong>
      </header>

      <section className="wapp-classic-assistant-card is-identity">
        <div className="wapp-classic-assistant-portrait">
          <img src={WODEAPP_MARK_SRC} alt="WodeAppX" width={92} height={92} />
        </div>
        <div className="wapp-classic-assistant-status">
          <span aria-hidden />
          <strong>小店智</strong>
          <small>在线</small>
        </div>
        <p>当前正在使用“{activeSurfaceLabel}”。需要帮助时，回到聊天直接告诉我你想完成什么。</p>
        <button type="button" onClick={onOpenAgents}>
          <MessageCircle aria-hidden />
          继续聊天
        </button>
      </section>

      <section className="wapp-classic-assistant-card is-tools">
        <h2>快捷入口</h2>
        <button type="button" onClick={onOpenAccount}>
          <ShieldCheck aria-hidden />
          账号与积分
        </button>
        <button type="button" onClick={onOpenSettings}>
          <Settings aria-hidden />
          工作台设置
        </button>
        <div className="wapp-classic-assistant-safe">
          <Archive aria-hidden />
          <span>任务记录保存在当前工作区</span>
        </div>
      </section>
    </aside>
  );
}
