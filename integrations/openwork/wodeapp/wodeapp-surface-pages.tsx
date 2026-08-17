/** @jsxImportSource react */

import type { WodeAppSurface } from "./wodeapp-types";
import { WodeAppAssetsSurface } from "./wodeapp-assets-surface";
import { WodeAppCapabilitiesSurface } from "./wodeapp-capabilities-surface";
import { WodeAppPluginsSurface } from "./wodeapp-plugins-surface";
import { WodeAppScheduleSurface } from "./wodeapp-schedule-surface";
import { WodeAppSurfaceFrame } from "./wodeapp-surface-frame";
import { useWodeAppWorkbench } from "./wodeapp-workbench-context";
import { WodeAppAccountSurface } from "./wodeapp-account-surface";
import { Radar } from "lucide-react";

type WodeAppSurfacePageProps = {
  surface: Exclude<WodeAppSurface, "agents">;
};

function WodeAppCaptureSurface() {
  return (
    <WodeAppSurfaceFrame
      title="内容抓取"
      subtitle="mitmproxy 抓包与素材采集能力将逐步迁入。现阶段可在智能体里用 Browser 自动化访问目标页面。"
      Icon={Radar}
    >
      <div className="wapp-surface-actions">
        <button
          type="button"
          className="wapp-surface-button is-primary"
          onClick={() => {
            try {
              window.dispatchEvent(new CustomEvent("openwork-open-right-pane", { detail: { pane: "browser" } }));
            } catch {
              // ignore
            }
          }}
        >
          打开 Browser 面板
        </button>
      </div>
    </WodeAppSurfaceFrame>
  );
}

export function WodeAppSurfacePage({ surface }: WodeAppSurfacePageProps) {
  useWodeAppWorkbench();

  switch (surface) {
    case "assets":
      return <WodeAppAssetsSurface />;
    case "schedule":
      return <WodeAppScheduleSurface />;
    case "capabilities":
      return <WodeAppCapabilitiesSurface />;
    case "plugins":
      return <WodeAppPluginsSurface />;
    case "capture":
      return <WodeAppCaptureSurface />;
    case "account":
      return <WodeAppAccountSurface />;
    default:
      return null;
  }
}

