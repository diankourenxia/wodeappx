/** @jsxImportSource react */
import * as React from "react";
import { Plus } from "lucide-react";

import { SidebarMenuSubButton, SidebarMenuSubItem } from "@/components/ui/sidebar";

import { useSidebarContext } from "../session/sidebar/app-sidebar-provider";
import { openBuiltinAgentWithFeedback } from "./wodeapp-agent-open";
import {
  pickAbilityProjects,
  resolveAvailableWodeAppBuiltinAgents,
  type WodeAppBuiltinAgent,
} from "./runtime-projects";
import { isOssEdition } from "./wodeapp-edition";
import { useWodeAppAuthSession } from "./use-wodeapp-auth-session";

export function WodeAppNewConversationButton({ workspaceId }: { workspaceId: string }) {
  const ctx = useSidebarContext();

  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        className="mb-1 h-9 rounded-lg border border-sidebar-border bg-sidebar-accent/40 font-medium text-sidebar-accent-foreground"
        onClick={() => {
          if (ctx.newTaskDisabled) return;
          ctx.onCreateTaskInWorkspace(workspaceId);
        }}
        aria-disabled={ctx.newTaskDisabled}
      >
        <Plus className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">新建对话</span>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  );
}

type WodeAppRuntimeProjectsSectionProps = {
  workspaceId: string;
};

export function WodeAppRuntimeProjectsSection({ workspaceId: _workspaceId }: WodeAppRuntimeProjectsSectionProps) {
  const { authConfig } = useWodeAppAuthSession();
  const userId = authConfig?.user?.id ?? null;
  const abilityProjects = React.useMemo(
    () => pickAbilityProjects(authConfig?.abilityProjects, userId),
    [userId, authConfig?.abilityProjects],
  );
  const capabilityAgents = React.useMemo(
    () => resolveAvailableWodeAppBuiltinAgents(abilityProjects, {
      origin: authConfig?.origin,
      profile: authConfig?.profile,
      ossEdition: isOssEdition(),
    }).filter((agent) => agent.kind === "capability"),
    [abilityProjects, authConfig?.origin, authConfig?.profile],
  );

  if (capabilityAgents.length === 0) return null;

  return capabilityAgents.map((agent) => (
    <SidebarMenuSubItem key={agent.id}>
      <SidebarMenuSubButton
        className="h-auto min-h-8 justify-between gap-2 text-left"
        onClick={() => {
          void openBuiltinAgentWithFeedback({
            agent,
            signedIn: Boolean(authConfig),
            userId,
            projects: abilityProjects,
          });
        }}
        title={agent.name}
      >
        <span className="min-w-0 flex-1 truncate">{agent.name}</span>
        <span className="shrink-0 text-[10px] text-muted-foreground">打开</span>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem>
  ));
}
