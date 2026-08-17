/** @jsxImportSource react */
import * as React from "react";

import {
  SettingsStack,
  SettingsStatusBadge,
} from "@/react-app/domains/settings/settings-section";
import { useWodeAppAuthSession } from "./use-wodeapp-auth-session";
import { WodeAppByokGuideDialog, useWodeAppFirstMileOpenState } from "./wodeapp-byok-guide-dialog";
import { WodeAppLocalKeyDialog } from "./wodeapp-local-key-dialog";
import { WODEAPP_OPEN_LOCAL_KEY_EVENT } from "./wodeapp-model-display";
import { WodeAppProviderCapabilityPanel } from "./wodeapp-provider-capability-panel";
import "./wodeapp-shell.css";

function originHost(origin: string | null | undefined): string {
  if (!origin) return "未配置";
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

function originProfileLabel(origin: string | null | undefined): string {
  const cleaned = (origin || "").replace(/\/$/, "");
  if (!cleaned) return "";
  if (cleaned.includes("wodeapp.cn") || cleaned.includes("wodeapp.ai")) return "云端";
  if (cleaned.includes("127.0.0.1") || cleaned.includes("localhost")) return "本地";
  return "自托管";
}

export function WodeAppServiceView() {
  const { authConfig, authChecked, signedIn, accountName, creditsText } = useWodeAppAuthSession();
  const [firstMileOpen, setFirstMileOpen] = useWodeAppFirstMileOpenState();
  const [localKeyOpen, setLocalKeyOpen] = React.useState(false);

  React.useEffect(() => {
    const openLocalKey = () => setLocalKeyOpen(true);
    window.addEventListener(WODEAPP_OPEN_LOCAL_KEY_EVENT, openLocalKey);
    return () => window.removeEventListener(WODEAPP_OPEN_LOCAL_KEY_EVENT, openLocalKey);
  }, []);

  const origin = authConfig?.origin ?? null;
  const profile = originProfileLabel(origin);
  const tools = authConfig?.builtInTools ?? null;
  const mcpConnected = Boolean(tools?.ok);
  const mcpLabel = mcpConnected
    ? `Platform 已连接 · ${tools?.toolCount ?? 0} 个工具`
    : "Platform 未连接";

  return (
    <SettingsStack>
      <div className="wapp-model-source-intro">
        <h2 className="wapp-model-source-intro-title">服务与模型</h2>
        <p className="wapp-model-source-intro-copy">
          默认本机 Key。每把 Key 会探测对话 / 生图 / 生视频。要走云端积分，从侧栏登录。
        </p>
      </div>

      <WodeAppProviderCapabilityPanel />

      <section aria-label="当前配置状态" className="wapp-model-source-status">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium text-dls-text">当前状态</h3>
          {!authChecked ? (
            <p className="text-xs text-muted-foreground">正在读取配置…</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {profile || "未配置"} · {originHost(origin)}
              {signedIn ? ` · ${accountName}` : " · 未登录"}
              {creditsText ? ` · 积分 ${creditsText}` : ""}
              {" · "}
              {authConfig?.defaultModelId || "未设置默认模型"}
              {" · "}
              <SettingsStatusBadge label={mcpLabel} tone={mcpConnected ? "ready" : "neutral"} />
            </p>
          )}
        </div>
      </section>

      <WodeAppByokGuideDialog
        open={firstMileOpen}
        onClose={() => setFirstMileOpen(false)}
      />
      <WodeAppLocalKeyDialog
        open={localKeyOpen}
        onClose={() => setLocalKeyOpen(false)}
      />
    </SettingsStack>
  );
}
