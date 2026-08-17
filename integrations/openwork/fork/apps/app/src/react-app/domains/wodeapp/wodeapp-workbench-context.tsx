/** @jsxImportSource react */
import * as React from "react";

import type { AssetMentionRef } from "./digital-assets-data";
import type { WodeAppTaskPromptInput } from "./wodeapp-composer-handoff";
import type { WodeAppAutomationClient } from "./wodeapp-automation-client";

export type WodeAppFeishuAuthorizationPrompt = {
  status: "ready" | "needs_setup";
  source: string | null;
  requestedAt: number;
  workspaceId: string;
  sessionId: string | null;
};

export type WodeAppWorkbenchContextValue = {
  selectedWorkspaceId: string;
  selectedWorkspaceRoot?: string;
  selectedSessionId?: string | null;
  feishuSetupSkillReady: boolean;
  feishuAuthorizationPrompt?: WodeAppFeishuAuthorizationPrompt | null;
  feishuAuthorizationBusy?: boolean;
  automations?: WodeAppAutomationClient;
  onCreateTaskWithPrompt: (
    workspaceId: string,
    prompt: string | WodeAppTaskPromptInput,
  ) => void | Promise<void | string | null>;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onAuthorizeFeishu?: (options?: { source?: string | null }) => boolean | Promise<boolean>;
  onConfirmFeishuAuthorization?: () => boolean | Promise<boolean>;
  onDismissFeishuAuthorization?: () => void;
  onOpenFeishuSettings?: () => void;
  onOpenAssetsSurface?: () => void;
  onOpenExtensionsSettings: (
    section?: "all" | "mcp" | "plugins",
    options?: {
      mcpSearch?: string;
      mcpDetailServerName?: string;
    },
  ) => void;
};

const WodeAppWorkbenchContext = React.createContext<WodeAppWorkbenchContextValue | null>(null);

export function WodeAppWorkbenchProvider({
  value,
  children,
}: {
  value: WodeAppWorkbenchContextValue;
  children: React.ReactNode;
}) {
  return <WodeAppWorkbenchContext.Provider value={value}>{children}</WodeAppWorkbenchContext.Provider>;
}

export function useWodeAppWorkbench() {
  const ctx = React.use(WodeAppWorkbenchContext);
  if (!ctx) {
    throw new Error("useWodeAppWorkbench must be used within WodeAppWorkbenchProvider");
  }
  return ctx;
}

export function useOptionalWodeAppWorkbench() {
  return React.use(WodeAppWorkbenchContext);
}

const assetMentionStore = new Map<string, AssetMentionRef>();
const pendingAssetMentionInserts = new Map<string, AssetMentionRef>();

export function rememberAssetMention(ref: AssetMentionRef) {
  assetMentionStore.set(ref.id, ref);
}

export function listRememberedAssetMentions(): AssetMentionRef[] {
  return [...assetMentionStore.values()];
}

export function queueAssetMentionInsert(ref: AssetMentionRef) {
  rememberAssetMention(ref);
  pendingAssetMentionInserts.set(ref.id, ref);
}

export function consumeQueuedAssetMentionInsert(id: string): AssetMentionRef | undefined {
  const ref = pendingAssetMentionInserts.get(id);
  pendingAssetMentionInserts.delete(id);
  return ref;
}

export function consumeQueuedAssetMentionInserts(): AssetMentionRef[] {
  const refs = [...pendingAssetMentionInserts.values()];
  pendingAssetMentionInserts.clear();
  return refs;
}

export function resolveAssetMentionById(id: string): AssetMentionRef | undefined {
  return assetMentionStore.get(id);
}

export function resolveAssetMentionsFromValues(values: string[]): AssetMentionRef[] {
  const refs: AssetMentionRef[] = [];
  for (const value of values) {
    const id = value.startsWith("asset:") ? value.slice("asset:".length) : value;
    const ref = assetMentionStore.get(id);
    if (ref) refs.push(ref);
  }
  return refs;
}
