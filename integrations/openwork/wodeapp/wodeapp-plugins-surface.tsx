/** @jsxImportSource react */
import { Plug } from "lucide-react";

import { SettingsSurface } from "@/react-app/shell/settings-route";
import { useWodeAppWorkbench } from "./wodeapp-workbench-context";
import { WodeAppSurfaceFrame } from "./wodeapp-surface-frame";

export function WodeAppPluginsSurface() {
  const { selectedWorkspaceId } = useWodeAppWorkbench();

  return (
    <WodeAppSurfaceFrame
      title="插件"
      subtitle="管理 MCP、技能和本地引擎插件。"
      Icon={Plug}
    >
      <div className="wapp-extensions-embed">
        <SettingsSurface
          embedded
          contentOnly
          workspaceId={selectedWorkspaceId}
          initialPath="extensions/plugins"
        />
      </div>
    </WodeAppSurfaceFrame>
  );
}

