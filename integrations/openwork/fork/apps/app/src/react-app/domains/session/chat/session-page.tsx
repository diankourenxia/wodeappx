/** @jsxImportSource react */
import type { CSSProperties } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePanelRef } from "react-resizable-panels";
import { Columns2, FileText, Globe, Mic2, Settings2, X, Zap } from "lucide-react";

import { t } from "../../../../i18n";
import { OPENWORK_EXTENSION_CATALOG } from "../../../../app/constants";
import { type OpenworkServerClient, type OpenworkServerStatus } from "../../../../app/lib/openwork-server";
import { getDisplaySessionTitle } from "../../../../app/lib/session-title";
import type { BootPhase } from "../../../../app/lib/startup-boot";
import { openDesktopPath, revealDesktopItemInDir, type WorkspaceInfo } from "../../../../app/lib/desktop";
import { toast } from "sonner";
import type {
  PendingPermission,
  PendingQuestion,
  ProviderListItem,
  TodoItem,
  WorkspaceConnectionState,
  WorkspaceSessionGroup,
} from "../../../../app/types";
import type { ShareWorkspaceModalProps } from "../../workspace/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ConfirmModal } from "../../../design-system/modals/confirm-modal";
import ProviderAuthModal, { type ProviderAuthModalProps } from "../../connections/provider-auth/provider-auth-modal";
import { RenameSessionModal } from "../modals/rename-session-modal";
import { AppSidebar } from "../sidebar/app-sidebar";
import { useSessionManagementStore } from "../sidebar/session-management-store";
import { SessionSurface, type SessionSurfaceProps } from "../surface/session-surface";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ShareWorkspaceModal } from "../../workspace/share-workspace-modal";
import { StatusBar, type StatusBarProps } from "./status-bar";
import { OwDotTicker } from "../../../shell/dot-ticker";
import { NotificationBell } from "../../../shell/notification-center";
import { useReactRenderWatchdog } from "../../../shell/react-render-watchdog";
import { useShellConfig } from "../../../shell/shell-config";
import { type SidePanelItem, useUiStateStore } from "../../../shell/ui-state-store";

import { isElectronRuntime } from "../../../../app/utils";
import { isCollectibleArtifactTarget, isLocalhostBrowserTarget, isOpenableDirectoryTarget, isOpenableFileTarget, type OpenTarget } from "../artifacts/open-target";
import type { OpenTargetOptions } from "@/lib/target-provider";
import { VoicePanel } from "../voice/voice-panel";
import { SidePanel } from "../panel/side-panel";
import { TerminalDock } from "../terminal/terminal-dock";
import { useActivePanelTab, usePanelTabStore, useSessionPanelState } from "../panel/panel-tab-store";
import {
  activateNativeBrowserForSession,
  nativeBrowserBelongsToSession,
  nativeBrowserRouteSessionId,
} from "../panel/use-side-panel-tabs";
import { useWorkspaceShellLayout } from "../../../shell/workspace-shell-layout";
import { useControlAction, type OpenworkControlAction } from "../../../shell/control/control-provider";
import { getExtensionId, isOpenWorkExtensionEnabled, OPENWORK_EXTENSION_STATE_CHANGED } from "../../settings/extension-state";
import { cn } from "@/lib/utils";
import { buildBuiltinAgentTask } from "../../wodeapp/wodeapp-auto-orchestration";
import { WodeAppSessionStarters } from "../../wodeapp/wodeapp-session-starters";
import { reportDesktopDiagnostic } from "../../wodeapp/wodeapp-desktop-diagnostics";
import type { WodeAppBuiltinAgent } from "../../wodeapp/runtime-projects";
import { resolveWodeAppBrowserPanelWidth } from "../../wodeapp/wodeapp-browser-panel-width";
import {
  generationAssetUrlMessage,
  isLikelyGenerationAssetUrl,
  openOrActivateWodeAppBrowserTab,
} from "../../wodeapp/wodeapp-browser-tab-nav";
import {
  pendingBrowserPanelTab,
  resolveOpenRightPaneSessionScope,
} from "../../wodeapp/wodeapp-open-right-pane";

const STARTUP_SKELETON_ROWS = [
  { id: "intro", titleWidth: "42%", bodyWidth: "88%" },
  { id: "middle", titleWidth: "56%", bodyWidth: "88%" },
  { id: "final", titleWidth: "36%", bodyWidth: "74%" },
];
const GLOBAL_VOICE_SIDE_PANEL_KEY = "__openwork_voice__";
const EMPTY_TRANSCRIPT_TARGETS: OpenTarget[] = [];

function resolveWodeAppPanelScopeKey(workspaceId: string) {
  return `__wodeapp__:${workspaceId}`;
}

export type OpenSessionTab = {
  workspaceId: string;
  sessionId: string;
};

type StatusBarOverrides = Pick<
  StatusBarProps,
  | "loading"
  | "showSettingsButton"
  | "settingsOpen"
  | "reloadBusy"
  | "reloadError"
>;

export type SessionPageHistoryControls = {
  canUndo: boolean;
  canRedo: boolean;
  busyAction: "undo" | "redo" | null;
  onUndo: () => void | Promise<void>;
  onRedo: () => void | Promise<void>;
};

export type SessionPageSidebarProps = {
  workspaceSessionGroups: WorkspaceSessionGroup[];
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  developerMode: boolean;
  sessionStatusById: Record<string, string>;
  connectingWorkspaceId: string | null;
  workspaceConnectionStateById: Record<string, WorkspaceConnectionState>;
  newTaskDisabled: boolean;
  sidebarHydratedFromCache: boolean;
  startupPhase: BootPhase;
  onSelectWorkspace: (workspaceId: string) => Promise<boolean> | boolean | void;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onCreateTaskInWorkspace: (workspaceId: string) => void;
  onCreateTaskWithPrompt?: (workspaceId: string, prompt: string | import("../../wodeapp/wodeapp-composer-handoff").WodeAppTaskPromptInput) => void | Promise<void | string | null>;
  onOpenRenameWorkspace: (workspaceId: string) => void;
  onShareWorkspace: (workspaceId: string) => void;
  onRevealWorkspace: (workspaceId: string) => void;
  onRecoverWorkspace: (workspaceId: string) => Promise<boolean> | boolean | void;
  onTestWorkspaceConnection: (workspaceId: string) => Promise<boolean> | boolean | void;
  onEditWorkspaceConnection: (workspaceId: string) => void;
  onForgetWorkspace: (workspaceId: string) => void;
  onOpenCreateWorkspace: () => void;
  onReorderWorkspaces?: (workspaceIds: string[]) => void;
};

export type SessionPageSurfaceProps = Omit<
  SessionSurfaceProps,
  "client" | "workspaceId" | "sessionId" | "opencodeBaseUrl" | "openworkToken"
>;

export type SessionPageProps = {
  selectedSessionId: string | null;
  selectedWorkspaceId: string;
  selectedWorkspaceDisplay: {
    id?: string;
    name?: string;
    displayName?: string;
    workspaceType?: WorkspaceInfo["workspaceType"];
  };
  selectedWorkspaceRoot: string;
  selectedWorkspaceError?: string | null;
  runtimeWorkspaceId: string | null;
  /**
   * Pre-built OpenCode SDK base URL for the selected workspace's owning
   * server. The parent route resolves this through `resolveWorkspaceEndpoint`
   * so we never compose `<baseUrl>/workspace/<id>/opencode` here.
   */
  opencodeBaseUrl?: string | null;
  workspaces: WorkspaceInfo[];
  clientConnected: boolean;
  openworkServerStatus: OpenworkServerStatus;
  openworkServerClient: OpenworkServerClient | null;
  environmentClient?: OpenworkServerClient | null;
  openworkServerToken?: string | null;
  developerMode: boolean;
  headerStatus: string;
  busyHint: string | null;
  startupPhase: BootPhase;
  providerConnectedIds: string[];
  hasUsableModel?: boolean;
  providers?: ProviderListItem[];
  mcpConnectedCount: number;
  onSendFeedback: () => void;
  onOpenSettings: () => void;
  sidebar: SessionPageSidebarProps;
  surface?: SessionPageSurfaceProps | null;
  history?: SessionPageHistoryControls | null;
  todos: TodoItem[];
  sessionLoadingById: (sessionId: string | null) => boolean;
  shareWorkspaceModal?: ShareWorkspaceModalProps | null;
  providerAuthModal?: ProviderAuthModalProps | null;
  activePermission?: PendingPermission | null;
  permissionReplyBusy?: boolean;
  respondPermission?: (requestID: string, reply: "once" | "always" | "reject") => void;
  safeStringify?: (value: unknown) => string;
  activeQuestion?: PendingQuestion | null;
  questionReplyBusy?: boolean;
  respondQuestion?: (requestID: string, answers: string[][]) => void;
  statusBar?: Partial<StatusBarOverrides>;
  notFoundMessage?: string | null;
  onOpenProviderAuth?: () => void;
  onRenameSession?: (sessionId: string, title: string) => Promise<void> | void;
  onDeleteSession?: (sessionId: string) => Promise<void> | void;
  onArchiveSession?: (sessionId: string, archived: boolean) => Promise<void> | void;
  onAccessibleTargetsChange?: (targets: OpenTarget[]) => void;
  /** Settings content rendered inside the right pane when the settings rail icon is active. */
  settingsSlot?: React.ReactNode;
  terminalOpen?: boolean;
  onTerminalOpenChange?: (open: boolean) => void;
  onSessionTabsChange?: (tabs: OpenSessionTab[]) => void;
};

function getSidebarInitialLoading(props: SessionPageSidebarProps) {
  if (props.workspaceSessionGroups.some((group) => group.sessions.length > 0)) {
    return false;
  }
  if (props.sidebarHydratedFromCache) return false;
  if (
    props.startupPhase !== "sessionIndexReady" &&
    props.startupPhase !== "firstSessionReady" &&
    props.startupPhase !== "ready"
  ) {
    return true;
  }
  return props.workspaceSessionGroups.some(
    (group) => group.status === "loading" || group.status === "idle",
  );
}

function sessionTitleForId(
  groups: WorkspaceSessionGroup[],
  id: string | null | undefined,
  options?: { useAgentTitle?: boolean },
) {
  if (options?.useAgentTitle && id) return t("session.default_title");
  if (!id) return "";
  const sessionsById = new Map(groups.flatMap((group) => group.sessions.map((session) => [session.id, session] as const)));
  const match = sessionsById.get(id);
  return match ? getDisplaySessionTitle(match.title) : "";
}

function sessionExistsInWorkspace(groups: WorkspaceSessionGroup[], workspaceId: string, sessionId: string | null | undefined) {
  if (!sessionId) return false;
  return groups.some((group) => (
    group.workspace.id === workspaceId && group.sessions.some((session) => session.id === sessionId)
  ));
}

function isTrackableAccessibleTarget(target: OpenTarget) {
  return isOpenableFileTarget(target) || isOpenableDirectoryTarget(target) || isLocalhostBrowserTarget(target);
}

function absoluteWorkspacePath(root: string | null | undefined, value: string) {
  const target = value.trim();
  if (!target) return "";
  if (/^file:\/\//i.test(target)) {
    try {
      const pathname = new URL(target).pathname;
      return /^\/[a-zA-Z]:/.test(pathname) ? pathname.slice(1) : pathname;
    } catch {
      return target.replace(/^file:\/\//i, "");
    }
  }
  // Refuse non-file URL schemes (optimistic://, data:, blob:, https:…). Joining
  // them onto the workspace root produced paths like
  // ~/.wodeapp/projects/supor/optimistic://attachment/foo.mp4.
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return "";
  // Keep ~/… for Electron to expand via homedir — do not prefix workspace root.
  if (target === "~" || target.startsWith("~/") || target.startsWith("~\\")) return target;
  if (target.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(target)) return target;
  // Bare filenames (e.g. export.mp4) are searched by Electron across Downloads /
  // Desktop / workspace. Joining them to the workspace root makes miss-fallbacks
  // open the repo folder instead of the real file.
  if (!/[\\/]/.test(target)) return target;
  const cleanRoot = root?.trim().replace(/[/\\]+$/, "") ?? "";
  const cleanTarget = target.replace(/^[.][\\/]/, "");
  return cleanRoot ? `${cleanRoot}/${cleanTarget}` : cleanTarget;
}

function hiddenAccessibleTargetsStorageKey(workspaceId: string | null | undefined, sessionId: string | null | undefined) {
  if (!workspaceId || !sessionId) return null;
  return `openwork.session.hiddenAccessibleTargets.v1:${workspaceId}:${sessionId}`;
}

function readHiddenAccessibleTargetIds(workspaceId: string | null | undefined, sessionId: string | null | undefined): Set<string> {
  const key = hiddenAccessibleTargetsStorageKey(workspaceId, sessionId);
  if (!key || typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string" && id.trim().length > 0));
  } catch {
    return new Set();
  }
}

function writeHiddenAccessibleTargetIds(workspaceId: string | null | undefined, sessionId: string | null | undefined, ids: Set<string>) {
  const key = hiddenAccessibleTargetsStorageKey(workspaceId, sessionId);
  if (!key || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(Array.from(ids)));
  } catch {
    // ignore storage failures
  }
}

function controlObjectArg(args: unknown) {
  return args && typeof args === "object" && !Array.isArray(args) ? args : null;
}

function controlStringArg(args: unknown, key: string) {
  const object = controlObjectArg(args);
  const value = object ? Reflect.get(object, key) : null;
  return typeof value === "string" ? value.trim() : "";
}

function controlBooleanArg(args: unknown, key: string, fallback = false) {
  const object = controlObjectArg(args);
  const value = object ? Reflect.get(object, key) : null;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }
  return fallback;
}

export function SessionPage(props: SessionPageProps) {
  const { config: shellConfig } = useShellConfig();
  const panelScopeKey = useMemo(() => {
    if (props.selectedSessionId) return props.selectedSessionId;
    if (shellConfig.wodeappWorkbench && props.selectedWorkspaceId) {
      return resolveWodeAppPanelScopeKey(props.selectedWorkspaceId);
    }
    return null;
  }, [props.selectedSessionId, props.selectedWorkspaceId, shellConfig.wodeappWorkbench]);
  const [topbarSessionRailHost, setTopbarSessionRailHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!shellConfig.wodeappWorkbench) {
      setTopbarSessionRailHost(null);
      return;
    }
    setTopbarSessionRailHost(document.getElementById("wapp-topbar-session-rail"));
  }, [shellConfig.wodeappWorkbench, props.selectedSessionId, props.selectedWorkspaceId]);
  const sidebarOpen = useUiStateStore((state) => state.sidebarOpen);
  const setSidebarOpen = useUiStateStore((state) => state.setSidebarOpen);
  const sessionSidePanel = useUiStateStore((state) => (
    panelScopeKey ? state.sidePanelState[panelScopeKey] ?? null : null
  ));
  const voiceSidePanelOpen = useUiStateStore((state) => state.sidePanelState[GLOBAL_VOICE_SIDE_PANEL_KEY] === "voice");
  const setSidePanelState = useUiStateStore((state) => state.setSidePanelState);
  const toggleSidePanelState = useUiStateStore((state) => state.toggleSidePanelState);
  const openTab = usePanelTabStore((state) => state.openTab);
  const closeTab = usePanelTabStore((state) => state.closeTab);
  const selectTab = usePanelTabStore((state) => state.selectTab);
  const transcriptTargets = usePanelTabStore((state) => (
    props.selectedSessionId ? state.transcriptArtifactTargets[props.selectedSessionId] ?? EMPTY_TRANSCRIPT_TARGETS : EMPTY_TRANSCRIPT_TARGETS
  ));
  const sessionPanelState = useSessionPanelState(panelScopeKey ?? "");
  const activePanelTab = useActivePanelTab(panelScopeKey ?? "");
  const [hiddenTargetRevision, setHiddenTargetRevision] = useState(0);
  const [, setExtensionStateVersion] = useState(0);
  const hiddenAccessibleTargetIds = useMemo(
    () => readHiddenAccessibleTargetIds(props.selectedWorkspaceId, props.selectedSessionId),
    [props.selectedSessionId, props.selectedWorkspaceId, hiddenTargetRevision],
  );
  const accessibleTargets = useMemo(
    () => transcriptTargets.filter((target) => isTrackableAccessibleTarget(target) && !hiddenAccessibleTargetIds.has(target.id)),
    [hiddenAccessibleTargetIds, transcriptTargets],
  );
  const artifactFileTargets = useMemo(() => accessibleTargets.filter(isCollectibleArtifactTarget), [accessibleTargets]);
  const artifactTargetCount = artifactFileTargets.length;
  const hasArtifactTargets = artifactTargetCount > 0;
  const activeSidePanel = voiceSidePanelOpen ? "voice" : sessionSidePanel;
  const sidePanelOpen = activeSidePanel !== null;
  const panelRailActive = activeSidePanel === "panel";
  const extensionsRailActive = activeSidePanel === "extensions";
  const voiceRailActive = activeSidePanel === "voice";
  const voiceExtension = useMemo(
    () => OPENWORK_EXTENSION_CATALOG.find((entry) => getExtensionId(entry) === "openwork-voice") ?? null,
    [],
  );
  const voiceExtensionEnabled = voiceExtension ? isOpenWorkExtensionEnabled(voiceExtension) : false;

  useReactRenderWatchdog("SessionPage", {
    selectedSessionId: props.selectedSessionId,
    selectedWorkspaceId: props.selectedWorkspaceId,
    clientConnected: props.clientConnected,
    startupPhase: props.startupPhase,
    hasSurface: Boolean(props.surface),
    workspaceCount: props.workspaces.length,
  });

  const [renameOpen, setRenameOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [sessionActionId, setSessionActionId] = useState<string | null>(null);
  const [sessionTabs, setSessionTabs] = useState<OpenSessionTab[]>([]);
  const [splitSessionId, setSplitSessionId] = useState<string | null>(null);
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [createGroupLabel, setCreateGroupLabel] = useState("");
  const [createGroupWorkspaceId, setCreateGroupWorkspaceId] = useState<string | null>(null);
  const browserPanelRef = usePanelRef();
  const pendingBrowserPanelWidthRef = useRef<number | null>(null);

  const setCurrentSidePanel = useCallback((panel: SidePanelItem | null) => {
    setSidePanelState(GLOBAL_VOICE_SIDE_PANEL_KEY, panel === "voice" ? "voice" : null);
    if (panel === "voice") return;
    if (!panelScopeKey) return;
    setSidePanelState(panelScopeKey, panel);
  }, [panelScopeKey, setSidePanelState]);

  const syncNativeBrowserStateToCurrentPanel = useCallback(async (options?: { waitForPageUrl?: boolean }) => {
    if (!panelScopeKey || !nativeBrowserBelongsToSession(panelScopeKey)) return;
    const browser = window.__OPENWORK_ELECTRON__?.browser;
    let browserState = await browser?.getState?.();
    if (options?.waitForPageUrl) {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const hasPageUrl = (browserState?.tabs ?? []).some((tab) => {
          const url = tab.url.trim();
          return url && url !== "about:blank";
        });
        if (hasPageUrl) break;
        await new Promise((resolve) => window.setTimeout(resolve, 80));
        browserState = await browser?.getState?.();
      }
    }
    if (!browserState || !nativeBrowserBelongsToSession(panelScopeKey)) return;
    usePanelTabStore.getState().syncBrowserTabs(
      panelScopeKey,
      browserState.tabs ?? [],
      browserState.activeTabId ?? browserState.tabs?.[0]?.id ?? null,
    );
  }, [panelScopeKey]);

  const toggleCurrentSidePanel = useCallback((panel: SidePanelItem) => {
    if (panel === "voice") {
      toggleSidePanelState(GLOBAL_VOICE_SIDE_PANEL_KEY, "voice");
      return;
    }
    setSidePanelState(GLOBAL_VOICE_SIDE_PANEL_KEY, null);
    if (!panelScopeKey) return;
    toggleSidePanelState(panelScopeKey, panel);
  }, [panelScopeKey, setSidePanelState, toggleSidePanelState]);

  // Native browser lifecycle events are process-global and do not identify
  // the task that initiated them. Session-scoped panel state is therefore
  // changed only by the explicit browser actions below.
  const {
    leftSidebarResizing,
    leftSidebarWidth,
    rightSidebarExpandedWidth: browserPanelWidth,
    setRightSidebarExpandedWidth: setBrowserPanelWidth,
    startLeftSidebarResize,
  } = useWorkspaceShellLayout({
    expandedRightWidth: shellConfig.wodeappWorkbench
      ? resolveWodeAppBrowserPanelWidth()
      : 520,
    minRightWidth: 320,
    maxRightWidth: shellConfig.wodeappWorkbench ? 1600 : undefined,
  });
  const [browserPanelDefaultWidth, setBrowserPanelDefaultWidth] = useState(browserPanelWidth);
  const sidebarProviderStyle: CSSProperties & Record<"--sidebar-width", string> = {
    "--sidebar-width": `${leftSidebarWidth}px`,
  };
  useEffect(() => {
    if (sidePanelOpen) return;
    setBrowserPanelDefaultWidth(browserPanelWidth);
  }, [sidePanelOpen, browserPanelWidth]);
  useEffect(() => {
    props.onAccessibleTargetsChange?.(accessibleTargets);
  }, [accessibleTargets, props.onAccessibleTargetsChange]);
  const commitBrowserPanelWidth = useCallback(() => {
    const size = browserPanelRef.current?.getSize();
    if (size?.inPixels) setBrowserPanelWidth(Math.round(size.inPixels));
  }, [browserPanelRef, setBrowserPanelWidth]);
  const queueWodeAppAgentBrowserPanelWidth = useCallback(() => {
    if (!shellConfig.wodeappWorkbench) return;
    const width = resolveWodeAppBrowserPanelWidth();
    pendingBrowserPanelWidthRef.current = width;
    setBrowserPanelWidth(width);
    setBrowserPanelDefaultWidth(width);
    browserPanelRef.current?.resize?.(`${width}px`);
  }, [browserPanelRef, setBrowserPanelWidth, shellConfig.wodeappWorkbench]);
  useEffect(() => {
    if (!sidePanelOpen || pendingBrowserPanelWidthRef.current == null) return;
    const width = pendingBrowserPanelWidthRef.current;
    pendingBrowserPanelWidthRef.current = null;
    requestAnimationFrame(() => {
      browserPanelRef.current?.resize?.(`${width}px`);
    });
  }, [browserPanelRef, sidePanelOpen]);
  const browserUrlForTarget = useCallback((target: OpenTarget) => {
    if (/^wss?:\/\//i.test(target.value)) return target.value.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:");
    return target.value;
  }, []);
  const downloadOpenTarget = useCallback(async (target: OpenTarget) => {
    if (target.kind !== "file" || !props.openworkServerClient || !props.runtimeWorkspaceId) {
      return;
    }

    const result = await props.openworkServerClient.downloadWorkspaceFile(props.runtimeWorkspaceId, target.value);
    const url = URL.createObjectURL(new Blob([result.data], { type: result.contentType ?? "application/octet-stream" }));
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = target.name;
    anchor.click();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [props.openworkServerClient, props.runtimeWorkspaceId]);
  const openTarget = useCallback((target: OpenTarget, options?: OpenTargetOptions, sourceSessionId?: string) => {
    if (target.kind === "url" || target.preview === "browser") {
      const url = browserUrlForTarget(target);
      if (isElectronRuntime()) {
        queueWodeAppAgentBrowserPanelWidth();
        void (async () => {
          const scopeKey = sourceSessionId ?? panelScopeKey;
          if (!scopeKey) return;
          if (panelScopeKey && scopeKey !== panelScopeKey) {
            usePanelTabStore.getState().openTab(scopeKey, pendingBrowserPanelTab(scopeKey, url));
            setSidePanelState(scopeKey, "panel");
            return;
          }
          const activated = await activateNativeBrowserForSession(scopeKey);
          if (!activated || !nativeBrowserBelongsToSession(scopeKey)) return;
          await openOrActivateWodeAppBrowserTab(url);
          await syncNativeBrowserStateToCurrentPanel({ waitForPageUrl: true });
          setCurrentSidePanel("panel");
        })();
      } else {
        window.open(url, "_blank", "noopener,noreferrer");
      }
      return;
    }
    if (options?.external && isOpenableDirectoryTarget(target) && props.selectedWorkspaceDisplay.workspaceType !== "remote") {
      const path = absoluteWorkspacePath(props.selectedWorkspaceRoot, target.value);
      if (path && isElectronRuntime()) {
        void openDesktopPath(path, props.selectedWorkspaceRoot).catch((error) => {
          toast.error("无法打开文件夹", {
            description: error instanceof Error ? error.message : String(error),
          });
        });
      }
      return;
    }

    if (options?.external && target.kind === "file" && props.selectedWorkspaceDisplay.workspaceType !== "remote") {
      const path = absoluteWorkspacePath(props.selectedWorkspaceRoot, target.value);
      if (!path) {
        toast.error("无法打开文件", {
          description: "该附件没有可打开的本机路径，请重新选择文件后再发送。",
        });
        return;
      }
      if (isElectronRuntime()) {
        void (async () => {
          try {
            if (options.reveal) {
              await revealDesktopItemInDir(path, props.selectedWorkspaceRoot);
            } else {
              await openDesktopPath(path, props.selectedWorkspaceRoot);
            }
          } catch (error) {
            toast.error(options.reveal ? "无法在访达中显示" : "无法打开文件", {
              description: error instanceof Error ? error.message : String(error),
            });
          }
        })();
      }
      return;
    }

    if (!isCollectibleArtifactTarget(target)) {
      if (isOpenableFileTarget(target)) {
        if (props.selectedWorkspaceDisplay.workspaceType === "remote") {
          void downloadOpenTarget(target).catch(() => undefined);
        } else if (isElectronRuntime()) {
          const path = absoluteWorkspacePath(props.selectedWorkspaceRoot, target.value);
          if (!path) {
            toast.error("无法打开文件", {
              description: "该附件没有可打开的本机路径，请重新选择文件后再发送。",
            });
            return;
          }
          void openDesktopPath(path, props.selectedWorkspaceRoot).catch((error) => {
            toast.error("无法打开文件", {
              description: error instanceof Error ? error.message : String(error),
            });
          });
        }
      }
      return;
    }

    const sessionId = sourceSessionId ?? props.selectedSessionId;
    if (!sessionId) return;
    if (options?.auto && activePanelTab?.id === target.id) return;
    openTab(sessionId, {
      id: target.id,
      type: "artifact",
      label: target.name,
      preview: target.preview,
    });
    if (panelScopeKey && sessionId !== panelScopeKey) {
      setSidePanelState(sessionId, "panel");
      return;
    }
    setCurrentSidePanel("panel");
  }, [activePanelTab?.id, browserUrlForTarget, downloadOpenTarget, openTab, panelScopeKey, props.selectedSessionId, props.selectedWorkspaceDisplay.workspaceType, props.selectedWorkspaceRoot, queueWodeAppAgentBrowserPanelWidth, setCurrentSidePanel, setSidePanelState, shellConfig.wodeappWorkbench, syncNativeBrowserStateToCurrentPanel]);
  const closeRightPane = useCallback(() => {
    setCurrentSidePanel(null);
  }, [setCurrentSidePanel]);
  const openBrowserRailPane = useCallback((options?: { toggle?: boolean }) => {
    // Opening the browser pane should land on a usable page, not an empty
    // panel that forces the user to click "+". If no browser tab exists yet,
    // create one (defaults to the new-tab URL in the main process).
    const opening = !panelRailActive;
    if (!opening && options?.toggle !== true) return;
    if (opening) queueWodeAppAgentBrowserPanelWidth();
    if (opening && isElectronRuntime()) {
      const hasBrowserTab = sessionPanelState.tabs.some((tab) => tab.type === "browser");
      void (async () => {
        if (!panelScopeKey) return;
        const activated = await activateNativeBrowserForSession(panelScopeKey);
        if (!activated || !nativeBrowserBelongsToSession(panelScopeKey)) return;
        if (!hasBrowserTab) {
          const browser = window.__OPENWORK_ELECTRON__?.browser;
          await browser?.createTab?.();
          await syncNativeBrowserStateToCurrentPanel({ waitForPageUrl: true });
        }
        if (options?.toggle === true) {
          toggleCurrentSidePanel("panel");
        } else {
          setCurrentSidePanel("panel");
        }
      })();
      return;
    }
    if (options?.toggle === true) {
      toggleCurrentSidePanel("panel");
    } else {
      setCurrentSidePanel("panel");
    }
  }, [panelRailActive, panelScopeKey, queueWodeAppAgentBrowserPanelWidth, sessionPanelState.tabs, setCurrentSidePanel, syncNativeBrowserStateToCurrentPanel, toggleCurrentSidePanel]);
  const openBrowserUrlControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "browser.open_url",
    label: "Open URL in built-in browser",
    description: "Create or select an OpenWork built-in browser tab, navigate it to a URL, and return the CDP handle for browser automation.",
    sideEffect: "navigation",
    requiresArgs: true,
    args: [
      { name: "url", type: "string", required: true, description: "The website URL to open." },
      { name: "provider", type: "string", description: "Browser provider. Use builtin or auto. External is reserved for future support." },
      { name: "allowAssetUrl", type: "boolean", description: "Only true when the user explicitly asked to inspect an image/media/CDN asset URL." },
    ],
    previewArgs: { url: "https://example.com", provider: "builtin" },
    disabled: !isElectronRuntime(),
    execute: async (args) => {
      const url = controlStringArg(args, "url");
      if (!url) return { ok: false, error: "Missing URL." };
      if (isLikelyGenerationAssetUrl(url) && !controlBooleanArg(args, "allowAssetUrl", false)) {
        return { ok: false, error: generationAssetUrlMessage(url) };
      }
      const provider = controlStringArg(args, "provider") || "builtin";
      if (provider !== "auto" && provider !== "builtin") {
        return { ok: false, error: `Browser provider is not available yet: ${provider}` };
      }
      if (!panelScopeKey) return { ok: false, error: "No active session owns the browser panel." };
      const activated = await activateNativeBrowserForSession(panelScopeKey);
      if (!activated || !nativeBrowserBelongsToSession(panelScopeKey)) {
        return { ok: false, error: "Browser session changed before navigation completed." };
      }
      queueWodeAppAgentBrowserPanelWidth();
      const result = await window.__OPENWORK_ELECTRON__?.browser?.openUrl?.(url, provider);
      await syncNativeBrowserStateToCurrentPanel({ waitForPageUrl: true });
      setCurrentSidePanel("panel");
      return result;
    },
  }), [panelScopeKey, queueWodeAppAgentBrowserPanelWidth, setCurrentSidePanel, syncNativeBrowserStateToCurrentPanel]);
  useControlAction(openBrowserUrlControlAction);
  const setBrowserProxyControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "browser.set_proxy",
    label: "Set built-in browser proxy",
    description: "Route the built-in browser through an HTTP/SOCKS proxy. Pass an empty proxy to restore system network settings.",
    sideEffect: "mutation",
    args: [
      { name: "proxy", type: "string", description: "Proxy URL like http://user:pass@host:8080 or socks5://host:1080, env:NAME to use the OPENWORK_BROWSER_PROXY_NAME environment variable, or empty to clear." },
    ],
    previewArgs: { proxy: "env:DE" },
    disabled: !isElectronRuntime(),
    execute: async (args) => {
      const proxy = controlStringArg(args, "proxy") || "";
      const setProxy = window.__OPENWORK_ELECTRON__?.browser?.setProxy;
      if (!setProxy) return { ok: false, error: "Built-in browser is not available." };
      return setProxy(proxy);
    },
  }), []);
  useControlAction(setBrowserProxyControlAction);
  const openArtifactRailPane = useCallback(() => {
    if (!hasArtifactTargets || !props.selectedSessionId) return;
    const activeTab = sessionPanelState.tabs.find((tab) => tab.id === sessionPanelState.activeTabId);
    const artifactTargetIds = new Set(artifactFileTargets.map((target) => target.id));
    const artifactTab = sessionPanelState.tabs.find((tab) => (
      tab.type === "artifact" && artifactTargetIds.has(tab.id)
    ));
    const firstArtifact = artifactFileTargets[0];
    if (panelRailActive && activeTab?.type === "artifact") {
      toggleCurrentSidePanel("panel");
      return;
    }
    if (artifactTab) {
      selectTab(props.selectedSessionId, artifactTab.id);
    } else if (firstArtifact) {
      openTab(props.selectedSessionId, {
        id: firstArtifact.id,
        type: "artifact",
        label: firstArtifact.name,
        preview: firstArtifact.preview,
      });
    }
    if (!panelRailActive) {
      toggleCurrentSidePanel("panel");
    }
  }, [artifactFileTargets, hasArtifactTargets, openTab, panelRailActive, props.selectedSessionId, selectTab, sessionPanelState, toggleCurrentSidePanel]);
  const openExtensionsRailPane = useCallback(() => {
    toggleCurrentSidePanel("extensions");
  }, [toggleCurrentSidePanel]);
  const openVoiceRailPane = useCallback(() => {
    toggleCurrentSidePanel("voice");
  }, [toggleCurrentSidePanel]);
  const removeAccessibleTarget = useCallback((target: OpenTarget) => {
    const nextHiddenIds = new Set(hiddenAccessibleTargetIds);
    nextHiddenIds.add(target.id);
    writeHiddenAccessibleTargetIds(props.selectedWorkspaceId, props.selectedSessionId, nextHiddenIds);
    setHiddenTargetRevision((value) => value + 1);
    if (props.selectedSessionId) {
      closeTab(props.selectedSessionId, target.id);
    }
  }, [closeTab, hiddenAccessibleTargetIds, props.selectedSessionId, props.selectedWorkspaceId]);
  useEffect(() => {
    const open = (event: Event) => {
      const requested = (event as CustomEvent<OpenTarget>).detail;
      const target = accessibleTargets.find((item) => item.id === requested?.id || item.value === requested?.value) ?? (
        requested?.kind && requested?.value ? requested : null
      );
      if (target) openTarget(target);
    };
    const hide = (event: Event) => {
      const requested = (event as CustomEvent<OpenTarget>).detail;
      const target = accessibleTargets.find((item) => item.id === requested?.id || item.value === requested?.value);
      if (target) removeAccessibleTarget(target);
    };
    window.addEventListener("openwork-open-accessible-target", open);
    window.addEventListener("openwork-hide-accessible-target", hide);
    return () => {
      window.removeEventListener("openwork-open-accessible-target", open);
      window.removeEventListener("openwork-hide-accessible-target", hide);
    };
  }, [accessibleTargets, openTarget, removeAccessibleTarget]);
  useEffect(() => {
    const handler = () => setCurrentSidePanel(null);
    window.addEventListener("openwork-close-right-pane", handler);
    return () => window.removeEventListener("openwork-close-right-pane", handler);
  }, [setCurrentSidePanel]);
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ pane?: string; url?: string; sessionId?: string }>).detail;
      if (detail?.pane !== "browser") return;
      const url = typeof detail.url === "string" ? detail.url.trim() : "";
      const routeSessionId = nativeBrowserRouteSessionId();
      const { sourceSessionId, shouldActivateNow } = resolveOpenRightPaneSessionScope(detail, routeSessionId);
      if (!sourceSessionId) return;

      if (url && isElectronRuntime()) {
        if (!shouldActivateNow) {
          usePanelTabStore.getState().openTab(sourceSessionId, pendingBrowserPanelTab(sourceSessionId, url));
          setSidePanelState(sourceSessionId, "panel");
          return;
        }
        queueWodeAppAgentBrowserPanelWidth();
        void (async () => {
          const activated = await activateNativeBrowserForSession(sourceSessionId);
          if (!activated || !nativeBrowserBelongsToSession(sourceSessionId)) return;
          await openOrActivateWodeAppBrowserTab(url);
          let browserState = await window.__OPENWORK_ELECTRON__?.browser?.getState?.();
          for (let attempt = 0; attempt < 10; attempt += 1) {
            if ((browserState?.tabs ?? []).some((tab) => tab.url.trim() && tab.url !== "about:blank")) break;
            await new Promise((resolve) => window.setTimeout(resolve, 80));
            browserState = await window.__OPENWORK_ELECTRON__?.browser?.getState?.();
          }
          if (!browserState || !nativeBrowserBelongsToSession(sourceSessionId)) return;
          usePanelTabStore.getState().syncBrowserTabs(
            sourceSessionId,
            browserState.tabs ?? [],
            browserState.activeTabId ?? browserState.tabs?.[0]?.id ?? null,
          );
          setSidePanelState(sourceSessionId, "panel");
        })();
        return;
      }
      if (!shouldActivateNow) {
        setSidePanelState(sourceSessionId, "panel");
        return;
      }
      openBrowserRailPane({ toggle: false });
    };
    window.addEventListener("openwork-open-right-pane", handler);
    return () => window.removeEventListener("openwork-open-right-pane", handler);
  }, [openBrowserRailPane, queueWodeAppAgentBrowserPanelWidth, setSidePanelState]);
  useEffect(() => {
    const refresh = () => setExtensionStateVersion((value) => value + 1);
    window.addEventListener(OPENWORK_EXTENSION_STATE_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(OPENWORK_EXTENSION_STATE_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  useEffect(() => {
    if (activeSidePanel === "voice" && !voiceExtensionEnabled) {
      setCurrentSidePanel(null);
    }
  }, [activeSidePanel, setCurrentSidePanel, voiceExtensionEnabled]);

  useEffect(() => {
    if (!isElectronRuntime()) return;
    if (sidePanelOpen) return;
    void window.__OPENWORK_ELECTRON__?.browser?.hide?.();
  }, [props.selectedSessionId, sidePanelOpen]);

  const openVoicePanelControlAction = useMemo<OpenworkControlAction | null>(() => (
    voiceExtensionEnabled ? {
      id: "voice.panel.open",
      label: "Open Voice Mode",
      description: "Open the sticky Voice Mode right-side panel.",
      sideEffect: "none",
      execute: () => {
        setCurrentSidePanel("voice");
        return { open: true };
      },
    } : null
  ), [setCurrentSidePanel, voiceExtensionEnabled]);
  useControlAction(openVoicePanelControlAction);

  const closeVoicePanelControlAction = useMemo<OpenworkControlAction | null>(() => (
    voiceExtensionEnabled && activeSidePanel === "voice" ? {
      id: "voice.panel.close",
      label: "Close Voice Mode",
      description: "Close the Voice Mode right-side panel.",
      sideEffect: "none",
      execute: () => {
        setCurrentSidePanel(null);
        return { open: false };
      },
    } : null
  ), [activeSidePanel, setCurrentSidePanel, voiceExtensionEnabled]);
  useControlAction(closeVoicePanelControlAction);
  const [showDelayedSessionLoadingState, setShowDelayedSessionLoadingState] = useState(false);

  const selectedSessionTitle = useMemo(
    () => sessionTitleForId(
      props.sidebar.workspaceSessionGroups,
      props.selectedSessionId,
      { useAgentTitle: true },
    ),
    [props.selectedSessionId, props.sidebar.workspaceSessionGroups],
  );
  useEffect(() => {
    setSessionTabs((current) => {
      const currentWorkspaceTabs = current.filter((tab) => tab.workspaceId === props.selectedWorkspaceId);
      const next = props.selectedSessionId && !currentWorkspaceTabs.some((tab) => tab.sessionId === props.selectedSessionId)
        ? [...currentWorkspaceTabs, { workspaceId: props.selectedWorkspaceId, sessionId: props.selectedSessionId }]
        : currentWorkspaceTabs;
      return next.filter((tab) => (
        tab.sessionId === props.selectedSessionId ||
        sessionExistsInWorkspace(props.sidebar.workspaceSessionGroups, tab.workspaceId, tab.sessionId)
      ));
    });
  }, [props.selectedSessionId, props.selectedWorkspaceId, props.sidebar.workspaceSessionGroups]);
  useEffect(() => {
    props.onSessionTabsChange?.(sessionTabs);
  }, [sessionTabs, props.onSessionTabsChange]);
  useEffect(() => {
    if (!splitSessionId) return;
    if (splitSessionId === props.selectedSessionId) {
      setSplitSessionId(null);
      return;
    }
    if (!sessionExistsInWorkspace(props.sidebar.workspaceSessionGroups, props.selectedWorkspaceId, splitSessionId)) {
      setSplitSessionId(null);
    }
  }, [props.selectedSessionId, props.selectedWorkspaceId, props.sidebar.workspaceSessionGroups, splitSessionId]);
  const sessionActionTitle = useMemo(
    () => sessionTitleForId(props.sidebar.workspaceSessionGroups, sessionActionId),
    [props.sidebar.workspaceSessionGroups, sessionActionId],
  );
  const rawWorkspaceName =
    props.selectedWorkspaceDisplay.displayName?.trim() ||
    props.selectedWorkspaceDisplay.name?.trim() ||
    t("session.workspace_fallback");
  const workspaceName = rawWorkspaceName.toLowerCase() === "wodeapp"
    ? "WodeAppX"
    : rawWorkspaceName;
  const providerCount = props.hasUsableModel ? 1 : props.providerConnectedIds.length;
  const messageCountVisible = props.selectedSessionId ? 1 : 0;
  const showWorkspaceSetupEmptyState = props.workspaces.length === 0 && !props.selectedSessionId;
  const showStartupSkeleton =
    !props.selectedSessionId &&
    !props.clientConnected &&
    props.startupPhase !== "sessionIndexReady" &&
    props.startupPhase !== "firstSessionReady" &&
    props.startupPhase !== "ready";
  const showSessionLoadingState =
    Boolean(props.selectedSessionId) && props.sessionLoadingById(props.selectedSessionId) && !showWorkspaceSetupEmptyState;
  const sidebarInitialLoading = useMemo(() => getSidebarInitialLoading(props.sidebar), [props.sidebar]);
  // Derive the main-pane error from the same data the sidebar uses so the two
  // panes can never disagree. We check (in priority order):
  // 1. selectedWorkspaceError (errorsByWorkspaceId[selectedWorkspaceId])
  // 2. workspaceConnectionStateById[selectedWorkspaceId].message (covers test/recover paths)
  // 3. group.error from workspaceSessionGroups (the same source the sidebar reads)
  const selectedWorkspaceConnectionMessage = (() => {
    const state = props.sidebar.workspaceConnectionStateById[props.selectedWorkspaceId];
    if (state?.status === "error") return state.message?.trim() ?? "";
    return "";
  })();
  const selectedWorkspaceGroupError = (() => {
    const group = props.sidebar.workspaceSessionGroups.find(
      (item) => item.workspace.id === props.selectedWorkspaceId,
    );
    return group?.error?.trim() ?? "";
  })();
  const selectedWorkspaceErrorMessage =
    props.selectedWorkspaceError?.trim() ||
    selectedWorkspaceConnectionMessage ||
    selectedWorkspaceGroupError ||
    "";
  const showSelectedWorkspaceError = Boolean(selectedWorkspaceErrorMessage);
  const selectedWorkspaceErrorTitle =
    props.selectedWorkspaceDisplay.workspaceType === "remote"
      ? "Remote workspace unavailable"
      : "OpenCode unavailable";

  const reactSessionBaseUrl = props.opencodeBaseUrl?.trim() ?? "";
  const reactSessionToken =
    props.openworkServerToken?.trim() ||
    props.openworkServerClient?.token?.trim() ||
    "";
  const canRenderReactSurface = Boolean(
    props.selectedSessionId &&
      props.runtimeWorkspaceId &&
      props.openworkServerClient &&
      reactSessionBaseUrl &&
      reactSessionToken &&
      props.surface,
  );
  const canRenderSplitSurface = Boolean(canRenderReactSurface && splitSessionId && splitSessionId !== props.selectedSessionId);

  const openSessionTab = useCallback((workspaceId: string, sessionId: string) => {
    setSessionTabs((current) => {
      const next = current.filter((tab) => tab.workspaceId === workspaceId);
      if (next.some((tab) => tab.sessionId === sessionId)) return next;
      return [...next, { workspaceId, sessionId }];
    });
    props.sidebar.onOpenSession(workspaceId, sessionId);
  }, [props.sidebar]);

  const closeSessionTab = useCallback((sessionId: string) => {
    setSessionTabs((current) => current.filter((tab) => tab.sessionId !== sessionId));
    setSplitSessionId((current) => current === sessionId ? null : current);
    if (sessionId !== props.selectedSessionId) return;

    const nextTab = sessionTabs.find((tab) => tab.sessionId !== sessionId && tab.workspaceId === props.selectedWorkspaceId);
    if (nextTab) {
      props.sidebar.onOpenSession(nextTab.workspaceId, nextTab.sessionId);
      return;
    }
    props.sidebar.onSelectWorkspace(props.selectedWorkspaceId);
  }, [props.selectedSessionId, props.selectedWorkspaceId, props.sidebar, sessionTabs]);

  useEffect(() => {
    if (!showSessionLoadingState) {
      setShowDelayedSessionLoadingState(false);
      return;
    }
    const id = window.setTimeout(() => {
      setShowDelayedSessionLoadingState(true);
    }, 1000);
    return () => window.clearTimeout(id);
  }, [showSessionLoadingState]);

  // Product failure: selected a session but the chat surface never mounts.
  useEffect(() => {
    if (!shellConfig.wodeappWorkbench) return;
    const stuckBlank =
      Boolean(props.selectedSessionId) &&
      !canRenderReactSurface &&
      !showStartupSkeleton &&
      !showWorkspaceSetupEmptyState &&
      !props.notFoundMessage;
    if (!stuckBlank) return;
    const timer = window.setTimeout(() => {
      reportDesktopDiagnostic({
        kind: "ui_blank_timeout",
        message: "Chat surface stayed blank for more than 60s after selecting a session",
        sessionId: props.selectedSessionId,
        workspaceId: props.selectedWorkspaceId,
        context: {
          clientConnected: props.clientConnected,
          hasSurface: Boolean(props.surface),
          hasServerClient: Boolean(props.openworkServerClient),
          hasBaseUrl: Boolean(props.opencodeBaseUrl),
          startupPhase: props.startupPhase || null,
        },
      });
    }, 60_000);
    return () => window.clearTimeout(timer);
  }, [
    canRenderReactSurface,
    props.clientConnected,
    props.notFoundMessage,
    props.opencodeBaseUrl,
    props.openworkServerClient,
    props.selectedSessionId,
    props.selectedWorkspaceId,
    props.startupPhase,
    props.surface,
    shellConfig.wodeappWorkbench,
    showStartupSkeleton,
    showWorkspaceSetupEmptyState,
  ]);

  useEffect(() => {
    if (!shellConfig.wodeappWorkbench) return;
    const message = props.notFoundMessage?.trim();
    if (!message) return;
    reportDesktopDiagnostic({
      kind: "session_not_found",
      message,
      sessionId: props.selectedSessionId,
      workspaceId: props.selectedWorkspaceId,
    });
  }, [
    props.notFoundMessage,
    props.selectedSessionId,
    props.selectedWorkspaceId,
    shellConfig.wodeappWorkbench,
  ]);

  useEffect(() => {
    setRenameOpen(false);
    setDeleteOpen(false);
    setRenameBusy(false);
    setDeleteBusy(false);
    setSessionActionId(null);
  }, [props.selectedSessionId]);

  const openRenameModal = (sessionId: string) => {
    if (!props.onRenameSession) return;
    setSessionActionId(sessionId);
    setRenameTitle(sessionTitleForId(props.sidebar.workspaceSessionGroups, sessionId));
    setRenameOpen(true);
  };

  const submitRename = async () => {
    const sessionId = sessionActionId;
    const nextTitle = renameTitle.trim();
    if (!sessionId || !props.onRenameSession || !nextTitle || nextTitle === sessionActionTitle.trim()) return;
    setRenameBusy(true);
    try {
      await props.onRenameSession(sessionId, nextTitle);
      setRenameOpen(false);
    } finally {
      setRenameBusy(false);
    }
  };

  const confirmDelete = async () => {
    const sessionId = sessionActionId;
    if (!sessionId || !props.onDeleteSession || deleteBusy) return;
    setDeleteBusy(true);
    try {
      await props.onDeleteSession(sessionId);
      setDeleteOpen(false);
    } catch {
      // Parent handler already surfaces toast; keep dialog open for retry.
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <div
      className={
        shellConfig.wodeappWorkbench
          ? "wapp-session-embed flex h-full min-h-0 flex-col bg-transparent text-dls-text mac:bg-transparent"
          : "flex h-full min-h-0 flex-col bg-[radial-gradient(circle_at_top,rgba(74,111,255,0.12),transparent_42%),var(--app-bg,#0b1020)] text-dls-text mac:bg-transparent"
      }
    >
      <SidebarProvider
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        className={cn(
          "relative min-h-0 flex-1 mac:bg-transparent",
          leftSidebarResizing &&
            "**:data-[slot=sidebar-container]:transition-none **:data-[slot=sidebar-gap]:transition-none",
          !shellConfig.sidebar && "**:data-[slot=sidebar-container]:hidden **:data-[slot=sidebar-gap]:hidden",
        )}
        style={sidebarProviderStyle}
      >
        <AppSidebar
          workspaceSessionGroups={props.sidebar.workspaceSessionGroups}
          selectedWorkspaceId={props.sidebar.selectedWorkspaceId}
          developerMode={props.sidebar.developerMode}
          selectedSessionId={props.sidebar.selectedSessionId}
          showInitialLoading={sidebarInitialLoading}
          showSessionActions={Boolean(props.onRenameSession || props.onDeleteSession || props.onArchiveSession)}
          sessionStatusById={props.sidebar.sessionStatusById}
          connectingWorkspaceId={props.sidebar.connectingWorkspaceId}
          workspaceConnectionStateById={props.sidebar.workspaceConnectionStateById}
          newTaskDisabled={props.sidebar.newTaskDisabled}
          onSelectWorkspace={props.sidebar.onSelectWorkspace}
          onOpenSession={openSessionTab}
          onPrefetchSession={props.sidebar.onPrefetchSession}
          onCreateTaskInWorkspace={props.sidebar.onCreateTaskInWorkspace}
          onCreateTaskWithPrompt={props.sidebar.onCreateTaskWithPrompt}
          onOpenRenameSession={props.onRenameSession ? openRenameModal : undefined}
          onOpenDeleteSession={props.onDeleteSession ? (sessionId) => {
            setSessionActionId(sessionId);
            window.setTimeout(() => {
              if (typeof document !== "undefined") {
                document.body.style.pointerEvents = "";
              }
              setDeleteOpen(true);
            }, 0);
          } : undefined}
          onArchiveSession={props.onArchiveSession ? (sessionId, archived) => {
            void props.onArchiveSession?.(sessionId, archived);
          } : undefined}
          onOpenCreateGroupModal={(workspaceId) => {
            setCreateGroupWorkspaceId(workspaceId);
            setCreateGroupLabel("");
            setCreateGroupOpen(true);
          }}
          onOpenRenameWorkspace={props.sidebar.onOpenRenameWorkspace}
          onShareWorkspace={props.sidebar.onShareWorkspace}
          onRevealWorkspace={props.sidebar.onRevealWorkspace}
          onRecoverWorkspace={props.sidebar.onRecoverWorkspace}
          onTestWorkspaceConnection={props.sidebar.onTestWorkspaceConnection}
          onEditWorkspaceConnection={props.sidebar.onEditWorkspaceConnection}
          onForgetWorkspace={props.sidebar.onForgetWorkspace}
          onOpenCreateWorkspace={props.sidebar.onOpenCreateWorkspace}
          onReorderWorkspaces={props.sidebar.onReorderWorkspaces}
          onStartResize={startLeftSidebarResize}
          openworkServerClient={props.openworkServerClient}
        />
        <SidebarInset
          className={cn(
            "min-h-0 overflow-hidden",
            shellConfig.wodeappWorkbench
              ? "bg-transparent mac:bg-transparent"
              : "bg-background mac:bg-background/80 mac:[&_header]:transition-[padding-left] mac:[&_header]:duration-200 mac:[&_header]:ease-linear mac:peer-data-[state=collapsed]:[&_header]:pl-28 mac:max-md:[&_header]:pl-28",
          )}
        >
          <div className="flex min-h-0 flex-1">
          <ResizablePanelGroup
            orientation="horizontal"
            onLayoutChanged={sidePanelOpen ? commitBrowserPanelWidth : undefined}
            className="min-h-0 flex-1"
          >
            <ResizablePanel minSize="360px" className="min-w-0">
              <main
                className={cn(
                  "flex h-full min-w-0 flex-col overflow-hidden",
                  !shellConfig.wodeappWorkbench && "border-r border-border",
                )}
              >
          {!shellConfig.wodeappWorkbench ? (
          <header className="z-10 flex h-10 shrink-0 items-center justify-between border-b border-border px-4 md:px-6 mac:titlebar-drag  mac:backdrop-blur-2xl mac:backdrop-saturate-150 @container/titlebar">
            <div className="flex min-w-0 items-center gap-3">
              {shellConfig.sidebar ? <SidebarTrigger className="mac:hidden" /> : null}
              <h1 className="truncate text-[15px] font-semibold text-dls-text">
                {showWorkspaceSetupEmptyState
                  ? t("session.create_or_connect_workspace")
                  : selectedSessionTitle || t("session.default_title")}
              </h1>
              <span className="hidden truncate text-[13px] text-dls-secondary lg:inline">
                {workspaceName}
              </span>
              {props.developerMode ? (
                <span className="hidden text-[12px] text-dls-secondary lg:inline">
                  {props.headerStatus}
                </span>
              ) : null}
              {props.busyHint ? (
                <span className="hidden text-[12px] text-dls-secondary lg:inline">
                  {props.busyHint}
                </span>
              ) : null}
            </div>

            <div className="flex items-center gap-1.5 text-gray-10 mac:titlebar-no-drag">
              {/* Revert/redo moved to per-message actions */}
              <NotificationBell />
              {props.developerMode ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    try {
                      window.localStorage.removeItem("openwork.acknowledgedProviders");
                      window.localStorage.removeItem("openwork.orgOnboardingSeen");
                    } catch {}
                  }}
                  title="Clears acknowledged providers + org onboarding so they trigger again"
                >
                  Reset notifications
                </Button>
              ) : null}
            </div>
          </header>
          ) : null}

          <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1 overflow-hidden">
            <ResizablePanel minSize="180px" className="min-h-0">
            <div
              className={cn(
                "relative h-full min-w-0 overflow-hidden",
                shellConfig.wodeappWorkbench
                  ? "bg-transparent"
                  : "bg-dls-surface mac:bg-dls-surface/85 mac:backdrop-blur-2xl mac:backdrop-saturate-150",
              )}
            >
              {showStartupSkeleton ? (
                <div className="px-6 py-14" role="status" aria-live="polite">
                  <div className="mx-auto max-w-2xl space-y-6">
                    <div className="space-y-2">
                      <div className="h-4 w-32 animate-pulse rounded-full bg-dls-hover/80" />
                      <div className="h-3 w-64 animate-pulse rounded-full bg-dls-hover/60" />
                    </div>
                    <div className="space-y-3">
                      {STARTUP_SKELETON_ROWS.map((row) => (
                        <div key={row.id} className="rounded-2xl border border-dls-border bg-dls-hover/40 p-4">
                          <div
                            className="mb-3 h-3 animate-pulse rounded-full bg-dls-hover/80"
                            style={{ width: row.titleWidth }}
                          />
                          <div className="space-y-2">
                            <div className="h-2.5 animate-pulse rounded-full bg-dls-hover/70" />
                            <div
                              className="h-2.5 animate-pulse rounded-full bg-dls-hover/60"
                              style={{ width: row.bodyWidth }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {showDelayedSessionLoadingState ? (
                <div className="px-6 py-16">
                  <div
                    className="mx-auto flex max-w-[320px] flex-col items-center gap-3 text-center"
                    role="status"
                    aria-live="polite"
                  >
                    <OwDotTicker size="md" />
                    <div className="text-[12px] leading-5 text-dls-secondary">
                      {t("session.loading_detail")}
                    </div>
                  </div>
                </div>
              ) : null}

              {!showDelayedSessionLoadingState && canRenderReactSurface ? (
                <div className="flex h-full min-h-0 flex-col">
                  {!shellConfig.wodeappWorkbench && sessionTabs.length > 0 ? (
                    <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-background/80 px-2 mac:backdrop-blur-xl">
                      {sessionTabs.map((tab) => {
                        const title = sessionTitleForId(
                          props.sidebar.workspaceSessionGroups,
                          tab.sessionId,
                          { useAgentTitle: true },
                        ) || t("session.default_title");
                        const active = tab.sessionId === props.selectedSessionId;
                        const split = tab.sessionId === splitSessionId;
                        return (
                          <div
                            key={tab.sessionId}
                            className={cn(
                              "group flex max-w-56 shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-xs transition-colors",
                              active
                                ? "border-border bg-dls-surface text-dls-text shadow-sm"
                                : "border-transparent text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
                              split && "border-primary/30 bg-primary/10 text-primary",
                            )}
                          >
                            <button
                              type="button"
                              className="min-w-0 flex-1 truncate text-left"
                              onClick={() => props.sidebar.onOpenSession(tab.workspaceId, tab.sessionId)}
                              title={title}
                            >
                              {title}
                            </button>
                            <button
                              type="button"
                              className="rounded p-0.5 text-dls-secondary hover:bg-dls-hover hover:text-dls-text disabled:pointer-events-none disabled:opacity-40"
                              onClick={() => setSplitSessionId(split ? null : tab.sessionId)}
                              disabled={active}
                              title={split ? "Close split" : "Open in split view"}
                              aria-label={split ? "Close split" : "Open in split view"}
                            >
                              <Columns2 size={13} />
                            </button>
                            <button
                              type="button"
                              className="rounded p-0.5 text-dls-secondary opacity-80 hover:bg-dls-hover hover:text-dls-text group-hover:opacity-100"
                              onClick={() => closeSessionTab(tab.sessionId)}
                              title="Close tab"
                              aria-label="Close tab"
                            >
                              <X size={13} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                    <div className={cn("min-h-0 min-w-0 flex-1", canRenderSplitSurface && "lg:border-r lg:border-border")}>
                      <SessionSurface
                        // Spread `surface` first so the explicit per-workspace
                        // routing props below CAN'T be silently overridden by
                        // anything that leaks into `surface`. SessionSurface's
                        // server target (client/workspaceId/sessionId/opencodeBaseUrl/openworkToken)
                        // must come from the resolved workspace endpoint passed by
                        // SessionRoute, not from anything in `surface`.
                        {...props.surface!}
                        client={props.openworkServerClient!}
                        environmentClient={props.environmentClient}
                        workspaceId={props.runtimeWorkspaceId!}
                        sessionId={props.selectedSessionId!}
                        opencodeBaseUrl={reactSessionBaseUrl}
                        openworkToken={reactSessionToken}
                        todos={props.todos}
                        activePermission={props.activePermission}
                        permissionReplyBusy={props.permissionReplyBusy}
                        respondPermission={props.respondPermission}
                        activeQuestion={props.activeQuestion}
                        questionReplyBusy={props.questionReplyBusy}
                        respondQuestion={props.respondQuestion}
                        safeStringify={props.safeStringify}
                        onOpenTarget={openTarget}
                      />
                    </div>
                    {canRenderSplitSurface ? (
                      <div className="min-h-0 min-w-0 flex-1 border-t border-border lg:border-t-0">
                        <SessionSurface
                          {...props.surface!}
                          client={props.openworkServerClient!}
                          environmentClient={props.environmentClient}
                          workspaceId={props.runtimeWorkspaceId!}
                          sessionId={splitSessionId!}
                          opencodeBaseUrl={reactSessionBaseUrl}
                          openworkToken={reactSessionToken}
                          todos={[]}
                          onOpenTarget={openTarget}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {!showDelayedSessionLoadingState && !canRenderReactSurface && !showStartupSkeleton ? (
                <div className={`mx-auto max-w-[800px] px-6 ${showWorkspaceSetupEmptyState ? "pt-20" : "pt-10"}`}>
                  {props.notFoundMessage ? (
                    <div className="px-6 py-16 text-center">
                      <div className="mx-auto max-w-md rounded-2xl border border-dls-border bg-dls-card px-5 py-6 shadow-[var(--dls-card-shadow)]">
                        <h3 className="text-base font-medium text-dls-text">Workspace or session not found</h3>
                        <p className="mt-2 text-sm leading-6 text-dls-secondary">{props.notFoundMessage}</p>
                      </div>
                    </div>
                  ) : showWorkspaceSetupEmptyState ? (
                    <div className="space-y-6 px-6 text-center">
                      <div className="mx-auto flex size-16 items-center justify-center rounded-3xl border border-dls-border bg-dls-hover">
                        <Zap className="text-dls-secondary" />
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-xl font-medium">{t("session.create_or_connect_workspace")}</h3>
                        <p className="mx-auto max-w-sm text-sm text-dls-secondary">
                          {t("workspace.empty_state_body")}
                        </p>
                      </div>
                      <div className="flex justify-center">
                        <Button onClick={props.sidebar.onOpenCreateWorkspace}>{t("workspace.create_workspace")}</Button>
                      </div>
                    </div>
                  ) : showSelectedWorkspaceError ? (
                    <div className="px-6 py-16">
                      <div className="mx-auto max-w-lg rounded-2xl border border-red-7/35 bg-red-1/40 p-5 text-left shadow-[var(--dls-card-shadow)]">
                        <div className="text-sm font-medium text-red-11">{selectedWorkspaceErrorTitle}</div>
                        <p className="mt-2 whitespace-pre-wrap wrap-anywhere text-sm leading-6 text-red-11/90">
                          {selectedWorkspaceErrorMessage}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => props.sidebar.onCreateTaskInWorkspace(props.selectedWorkspaceId)}
                          >
                            Retry
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void Promise.resolve(props.sidebar.onTestWorkspaceConnection(props.selectedWorkspaceId))}
                          >
                            {t("workspace_list.test_connection")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => props.sidebar.onEditWorkspaceConnection(props.selectedWorkspaceId)}
                          >
                            {t("workspace_list.edit_connection")}
                          </Button>
                          {props.sidebar.workspaceConnectionStateById[props.selectedWorkspaceId]?.status === "error" ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void Promise.resolve(props.sidebar.onRecoverWorkspace(props.selectedWorkspaceId))}
                            >
                              {t("workspace_list.recover")}
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : props.selectedSessionId ? (
                    <div className="px-6 py-16 text-center text-sm text-dls-secondary">
                      {t("session.loading_detail")}
                    </div>
                  ) : shellConfig.wodeappWorkbench ? (
                    <div className="flex min-h-0 flex-1 overflow-auto">
                      <WodeAppSessionStarters
                        className="w-full"
                        onStartAgent={(agent: WodeAppBuiltinAgent) => {
                          props.sidebar.onCreateTaskWithPrompt?.(
                            props.selectedWorkspaceId,
                            buildBuiltinAgentTask(agent),
                          );
                        }}
                      />
                    </div>
                  ) : (
                    <div className="flex flex-1 items-center justify-center px-6 py-16">
                      <div className="w-full max-w-md space-y-6">
                        <div className="space-y-1 text-center">
                          <h2 className="text-lg font-semibold text-dls-text">
                            {providerCount === 0
                              ? t("session.connect_model_to_start")
                              : t("session.select_or_create_session")}
                          </h2>
                          <p className="text-xs text-dls-secondary">
                            {providerCount === 0
                              ? "Add an AI model provider so your tasks can run."
                              : "Try one of these to get started:"}
                          </p>
                        </div>
                        <div className="space-y-2">
                          {providerCount === 0 ? (
                            <button
                              type="button"
                              className="flex w-full items-start gap-3 rounded-xl border border-blue-7/50 bg-blue-2/40 p-3.5 text-left transition-colors hover:bg-blue-3/50"
                              onClick={() => props.onOpenProviderAuth?.()}
                            >
                              <Zap className="mt-0.5 size-5 shrink-0 text-blue-10" />
                              <div>
                                <div className="text-[13px] font-medium text-dls-text">配置模型 Key</div>
                                <div className="mt-0.5 text-[11px] text-dls-secondary">
                                  打开引导：本机打开火山 / Kimi 等控制台取 Key（无需登录云端）
                                </div>
                              </div>
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="flex w-full items-start gap-3 rounded-xl border border-dls-border bg-dls-surface p-3.5 text-left transition-colors hover:bg-dls-hover"
                            onClick={() => {
                              props.sidebar.onCreateTaskWithPrompt?.(
                                props.selectedWorkspaceId,
                                "Create a sample CSV file with 20 rows of fake customer data (name, email, company, revenue). Then show me a summary of the data.",
                              );
                            }}
                          >
                            <img src="https://cdn.simpleicons.org/googlesheets" alt="" width={20} height={20} className="mt-0.5 shrink-0" />
                            <div>
                              <div className="text-[13px] font-medium text-dls-text">Edit a CSV</div>
                              <div className="mt-0.5 text-[11px] text-dls-secondary">Create a sample spreadsheet with customer data</div>
                            </div>
                          </button>
                          <button
                            type="button"
                            className="flex w-full items-start gap-3 rounded-xl border border-dls-border bg-dls-surface p-3.5 text-left transition-colors hover:bg-dls-hover"
                            onClick={() => {
                              props.sidebar.onCreateTaskWithPrompt?.(
                                props.selectedWorkspaceId,
                                "Open craigslist.org in the browser and search for couches for sale. Show me the top 5 results with prices.",
                              );
                            }}
                          >
                            <img src="/wodeapp-mark.png" alt="" width={20} height={20} className="mt-0.5 shrink-0" />
                            <div>
                              <div className="text-[13px] font-medium text-dls-text">Browse the web</div>
                              <div className="mt-0.5 text-[11px] text-dls-secondary">Search Craigslist for couches and list the results</div>
                            </div>
                          </button>
                          <button
                            type="button"
                            className="flex w-full items-start gap-3 rounded-xl border border-dls-border bg-dls-surface p-3.5 text-left transition-colors hover:bg-dls-hover"
                            onClick={() => {
                              props.onOpenSettings?.();
                            }}
                          >
                            <img src="https://cdn.simpleicons.org/hackthebox" alt="" width={20} height={20} className="mt-0.5 shrink-0" />
                            <div>
                              <div className="text-[13px] font-medium text-dls-text">Connect an extension</div>
                              <div className="mt-0.5 text-[11px] text-dls-secondary">Add MCP servers, plugins, and integrations</div>
                            </div>
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            </ResizablePanel>
            {props.terminalOpen ? (
              <>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize="280px" minSize="160px" maxSize="55%" className="min-h-0">
                  <TerminalDock
                    workspaceRoot={props.selectedWorkspaceRoot}
                    isRemoteWorkspace={props.selectedWorkspaceDisplay.workspaceType === "remote"}
                    onClose={() => props.onTerminalOpenChange?.(false)}
                  />
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>

          {shellConfig.statusBar && !shellConfig.wodeappWorkbench ? (
            <StatusBar
              clientConnected={props.clientConnected}
              openworkServerStatus={props.openworkServerStatus}
              developerMode={props.developerMode}
              settingsOpen={props.statusBar?.settingsOpen ?? false}
              onSendFeedback={props.onSendFeedback}
              onOpenSettings={props.onOpenSettings}
              providerConnectedIds={props.providerConnectedIds}
              mcpConnectedCount={props.mcpConnectedCount}
              loading={props.statusBar?.loading ?? false}
              showSettingsButton={props.statusBar?.showSettingsButton}
              reloadBusy={props.statusBar?.reloadBusy}
              reloadError={props.statusBar?.reloadError}
            />
          ) : null}
              </main>
            </ResizablePanel>
              {sidePanelOpen ? (
              <>
                <ResizableHandle withHandle className="hidden lg:flex" />
                <ResizablePanel
                  panelRef={browserPanelRef}
                  defaultSize={`${activeSidePanel === "extensions" ? Math.max(browserPanelDefaultWidth, 480) : browserPanelDefaultWidth}px`}
                  minSize={activeSidePanel === "extensions" ? "420px" : shellConfig.wodeappWorkbench ? "420px" : "320px"}
                  maxSize={shellConfig.wodeappWorkbench ? "80%" : "70%"}
                  className="wapp-side-panel min-h-0 overflow-hidden lg:flex lg:flex-col"
                >
                  {activeSidePanel === "extensions" && props.settingsSlot ? (
                    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background">
                      {props.settingsSlot}
                    </div>
                  ) : activeSidePanel === "voice" ? (
                    <VoicePanel
                      client={props.openworkServerClient}
                      workspaceId={props.runtimeWorkspaceId}
                      sessionId={props.selectedSessionId}
                      onClose={closeRightPane}
                    />
                  ) : activeSidePanel === "panel" && panelScopeKey ? (
                    <SidePanel
                      sessionId={panelScopeKey}
                      client={props.openworkServerClient}
                      workspaceId={props.runtimeWorkspaceId}
                      workspaceRoot={props.selectedWorkspaceRoot}
                      isRemoteWorkspace={props.surface?.isRemoteWorkspace ?? false}
                      onClose={closeRightPane}
                    />
                  ) : null}
                </ResizablePanel>
              </>
            ) : null}
          </ResizablePanelGroup>
          {(() => {
            const railInTopbar = Boolean(shellConfig.wodeappWorkbench);
            const railIconClass = (active: boolean) =>
              railInTopbar
                ? cn("wapp-icon-button", active && "is-active")
                : cn(
                    "rounded-xl transition-colors hover:bg-muted hover:text-foreground",
                    active && "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary",
                  );
            const sessionRailControls = (
              <>
                {isElectronRuntime() ? (
                  <Button
                    variant={railInTopbar ? "ghost" : "ghost"}
                    size="icon-sm"
                    className={railIconClass(panelRailActive)}
                    onClick={() => openBrowserRailPane({ toggle: true })}
                    title={panelRailActive ? "关闭浏览器" : "打开浏览器"}
                    aria-label={panelRailActive ? "关闭浏览器" : "打开浏览器"}
                    aria-pressed={panelRailActive}
                    data-browser-open={panelRailActive ? "true" : "false"}
                  >
                    <Globe size={railInTopbar ? 14 : 17} />
                  </Button>
                ) : null}
                {voiceExtensionEnabled ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className={railIconClass(voiceRailActive)}
                    onClick={openVoiceRailPane}
                    title="Voice Mode"
                    aria-label="Voice Mode"
                    aria-pressed={voiceRailActive}
                  >
                    <Mic2 size={railInTopbar ? 14 : 17} />
                  </Button>
                ) : null}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={railIconClass(panelRailActive)}
                  onClick={openArtifactRailPane}
                  title={hasArtifactTargets ? `Artifacts (${artifactTargetCount})` : "No artifacts yet"}
                  aria-label={hasArtifactTargets ? `Artifacts (${artifactTargetCount})` : "No artifacts yet"}
                  aria-pressed={panelRailActive}
                  disabled={!hasArtifactTargets}
                >
                  <FileText size={railInTopbar ? 14 : 17} />
                  {artifactTargetCount > 0 ? (
                    <span className="absolute right-0 top-0 flex min-w-3.5 translate-x-1 -translate-y-1 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-3 text-primary-foreground">
                      {artifactTargetCount > 9 ? "9+" : artifactTargetCount}
                    </span>
                  ) : null}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={railIconClass(extensionsRailActive)}
                  onClick={props.settingsSlot ? openExtensionsRailPane : props.onOpenSettings}
                  title="插件"
                  aria-label="插件"
                  aria-pressed={extensionsRailActive}
                >
                  <Settings2 size={railInTopbar ? 14 : 17} />
                </Button>
              </>
            );
            if (railInTopbar) {
              return topbarSessionRailHost
                ? createPortal(
                    <div className="wapp-topbar-session-rail-inner mac:titlebar-no-drag">
                      {sessionRailControls}
                    </div>,
                    topbarSessionRailHost,
                  )
                : null;
            }
            return (
              <aside className="wapp-session-rail flex w-11 shrink-0 flex-col items-center gap-1 border-l border-border bg-background/95 px-1 py-2 text-muted-foreground mac:titlebar-no-drag">
                {sessionRailControls}
              </aside>
            );
          })()}
          </div>
        </SidebarInset>
        {shellConfig.sidebar ? <SidebarTrigger className="hidden mac:absolute mac:left-[64px] top-[3px] z-50 mac:flex titlebar-no-drag" /> : null}
      </SidebarProvider>

      {props.providerAuthModal ? <ProviderAuthModal {...props.providerAuthModal} /> : null}

      {props.onRenameSession ? (
        <RenameSessionModal
          open={renameOpen}
          title={renameTitle}
          busy={renameBusy}
          canSave={renameTitle.trim().length > 0 && renameTitle.trim() !== sessionActionTitle.trim()}
          onClose={() => {
            if (!renameBusy) setRenameOpen(false);
          }}
          onSave={() => void submitRename()}
          onTitleChange={setRenameTitle}
        />
      ) : null}

      {props.onDeleteSession ? (
        <ConfirmModal
          open={deleteOpen}
          title={t("session.delete_session_title")}
          message={
            sessionActionTitle.trim()
              ? t("session.delete_named_session_message", { title: sessionActionTitle.trim() })
              : t("session.delete_session_generic")
          }
          confirmLabel={deleteBusy ? t("session.deleting") : t("session.delete")}
          cancelLabel={t("common.cancel")}
          variant="danger"
          busy={deleteBusy}
          onConfirm={() => void confirmDelete()}
          onCancel={() => {
            if (!deleteBusy) setDeleteOpen(false);
          }}
        />
      ) : null}

      <Dialog open={createGroupOpen} onOpenChange={(open) => { if (!open) setCreateGroupOpen(false); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("session_management.new_group")}</DialogTitle>
          </DialogHeader>
          <Input
            type="text"
            value={createGroupLabel}
            onChange={(e) => setCreateGroupLabel(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && createGroupLabel.trim()) {
                if (createGroupWorkspaceId) useSessionManagementStore.getState().createGroup(createGroupWorkspaceId, createGroupLabel.trim());
                setCreateGroupOpen(false);
              }
            }}
            placeholder={t("session_management.new_group_prompt")}
          />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>{t("common.cancel")}</DialogClose>
            <Button
              type="button"
              disabled={!createGroupLabel.trim()}
              onClick={() => {
                if (createGroupWorkspaceId) useSessionManagementStore.getState().createGroup(createGroupWorkspaceId, createGroupLabel.trim());
                setCreateGroupOpen(false);
              }}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {props.shareWorkspaceModal ? <ShareWorkspaceModal {...props.shareWorkspaceModal} /> : null}

      {/* Cloud provider notifications are now handled globally by CloudProvidersToast in app-root.tsx */}
    </div>
  );
}
