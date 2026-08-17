/** @jsxImportSource react */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { PanelLeft } from "lucide-react";

import {
  deepLinkBridgeEvent,
  takePendingDeepLinks,
  type DeepLinkBridgeDetail,
} from "@/app/lib/deep-link-bridge";
import { workspaceSettingsRoute } from "@/react-app/shell/workspace-routes";
import { getElectronBrowser } from "../session/panel/utils";
import { openBuiltinAgentWithFeedback } from "./wodeapp-agent-open";
import { buildBuiltinAgentTask } from "./wodeapp-auto-orchestration";
import {
  isWodeAppFeishuAuthorizeDeepLink,
  parseWodeAppFeishuAuthorizeDeepLink,
} from "./wodeapp-feishu-deep-link";
import {
  bindFeishuAuthorizationPromptToSession,
  selectFeishuAuthorizationPromptForSession,
} from "./wodeapp-feishu-authorization-scope";
import {
  VIDEO_GENERATION_AGENT_ID,
  VISUAL_GENERATION_AGENT_ID,
} from "./wodeapp-page-capabilities";
import {
  WODEAPP_CREATE_AGENT_ID,
  WODEAPP_FEISHU_AGENT_ID,
  WODEAPP_FEISHU_MCP_SERVER,
  WODEAPP_OPEN_AGENT_VIEW_EVENT,
  WODEAPP_WYNNE_AGENT_ID,
  pickAbilityProjects,
  resolveAvailableWodeAppBuiltinAgents,
  type WodeAppBuiltinAgent,
} from "./runtime-projects";
import { isOssEdition } from "./wodeapp-edition";
import {
  WODEAPP_BRAND_AGENTS_CHANGED_EVENT,
  listEnabledWodeAppBrandAgents,
  normalizeWodeAppBrandAgentsFile,
  readStoredWodeAppBrandAgents,
  writeStoredWodeAppBrandAgents,
  type WodeAppBrandAgentConfig,
} from "./wodeapp-brand-agent-config";
import {
  readWodeAppRuntimeProfileForSession,
  setWodeAppRuntimeProfilesFromBrandAgents,
} from "./wodeapp-runtime-profile";
import { listWodeAppBrandAgents } from "@/app/lib/wodeapp-auth";
import {
  SCRIPT_STORYBOARD_AGENT_ID,
  WODEAPP_OPEN_SCRIPT_WORKBENCH_EVENT,
  type WodeAppOpenScriptWorkbenchDetail,
} from "./wodeapp-script-pipeline";
import type { WodeAppSurface } from "./wodeapp-types";
import { WodeAppSurfacePage } from "./wodeapp-surface-pages";
import { WodeAppFeishuCommerceWorkbench } from "./wodeapp-feishu-commerce-workbench";
import { WodeAppWynneBrandWorkbench } from "./wodeapp-wynne-brand-workbench";
import { WodeAppMainChrome, wodeappSurfaceLabel } from "./wodeapp-main-chrome";
import {
  WodeAppClassicAssistantRail,
  WodeAppClassicFrame,
} from "./wodeapp-classic-frame";
import { WodeAppThemeChrome } from "./wodeapp-theme-chrome";
import {
  isWodeAppSkinId,
  readStoredWodeAppSkin,
  storeWodeAppSkin,
  WODEAPP_DEFAULT_SKIN_ID,
  type WodeAppSkinId,
} from "./wodeapp-skins";
import {
  WodeAppWorkbenchProvider,
  type WodeAppWorkbenchContextValue,
} from "./wodeapp-workbench-context";
import type { WodeAppAutomationClient } from "./wodeapp-automation-client";
import { useWodeAppDigitalAssets } from "./use-wodeapp-digital-assets";
import { useWodeAppAuthSession } from "./use-wodeapp-auth-session";
import { useWodeAppDefaultModelSync } from "./use-wodeapp-default-model";
import {
  WodeAppWorkbenchSidebar,
  type WodeAppWorkbenchSidebarProps,
} from "./wodeapp-workbench-sidebar";
import { setDigitalAssetScope } from "./digital-assets-store";
import {
  isSuporWorkspaceLike,
  readStoredProductDesk,
  storeProductDesk,
  type WodeAppProductDeskId,
} from "./wodeapp-supor-project";
import { reportAndInvestigateSessionBug } from "./wodeapp-session-bug-report";

import "./wodeapp-shell.css";
import "./wodeapp-surfaces.css";
import "./wodeapp-skin-classic-blue.css";
import "./wodeapp-skin-beauty.css";
import "./wodeapp-skin-supor.css";
import "./wodeapp-skin-pet-soft.css";
import "./wodeapp-skin-cute-pastel.css";
import "./wodeapp-skin-ink-book.css";
import "./wodeapp-skin-otome-diary.css";
import "./wodeapp-skin-red-compact.css";
import "./wodeapp-skin-summer-breeze.css";
import "./wodeapp-skin-aurora-night.css";
import "./wodeapp-skin-forest-mist.css";
import "./wodeapp-skin-coffee-loft.css";
import "./wodeapp-skin-noir-jazz.css";
import "./wodeapp-skin-ambient-chat-readable.css";
import "./wodeapp-skin-theme-align.css";

type RetainedFeishuAuthorizationPrompt = NonNullable<
  WodeAppWorkbenchContextValue["feishuAuthorizationPrompt"]
>;

let retainedFeishuAuthorizationPrompt: RetainedFeishuAuthorizationPrompt | null = null;

function retainFeishuAuthorizationPrompt(
  prompt: RetainedFeishuAuthorizationPrompt | null,
): RetainedFeishuAuthorizationPrompt | null {
  retainedFeishuAuthorizationPrompt = prompt;
  return prompt;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    getElectronBrowser()?.hide?.();
  });
}

type WodeAppWorkbenchShellProps = {
  selectedWorkspaceRoot?: string;
  automations?: WodeAppAutomationClient;
  feishuSetupSkillReady?: boolean;
  sidebar: Omit<
    WodeAppWorkbenchSidebarProps,
    "activeSurface" | "selectedRuntimeProjectId" | "onSurfaceChange" | "onSelectRuntimeProject"
    | "builtinAgents" | "onCreateTaskInWorkspace"
  > & {
    onCreateTaskInWorkspace: (
      workspaceId: string,
      options?: { runtimeProfileId?: string },
    ) => void;
    onCreateTaskWithPrompt?: (
      workspaceId: string,
      prompt: string | import("./wodeapp-composer-handoff").WodeAppTaskPromptInput,
    ) => void | Promise<void | string | null>;
  };
  onAuthorizeFeishu?: () => Promise<boolean> | boolean;
  children: ReactNode;
};

const ACTIVE_SURFACE_STORAGE_PREFIX = "wodeappx.active-surface";
const WODEAPP_SURFACES = new Set<WodeAppSurface>([
  "agents",
  "assets",
  "schedule",
  "plugins",
  "capture",
  "account",
]);

function activeSurfaceStorageKey(workspaceId: string): string {
  return `${ACTIVE_SURFACE_STORAGE_PREFIX}:${workspaceId}`;
}

function readStoredActiveSurface(workspaceId: string): WodeAppSurface {
  if (typeof window === "undefined") return "agents";
  try {
    const stored = window.sessionStorage.getItem(activeSurfaceStorageKey(workspaceId));
    return stored && WODEAPP_SURFACES.has(stored as WodeAppSurface)
      ? stored as WodeAppSurface
      : "agents";
  } catch {
    return "agents";
  }
}

function storeActiveSurface(workspaceId: string, surface: WodeAppSurface): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(activeSurfaceStorageKey(workspaceId), surface);
  } catch {
    // Storage can be unavailable in hardened browser contexts. Local state still works.
  }
}

const SIDEBAR_COLLAPSED_STORAGE_KEY = "wodeappx.workbench.sidebarCollapsed";

function readSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function storeSidebarCollapsed(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // ignore
  }
}

/** Home / 「最近」 desk — not a folder project under 「项目」. */
function isHomeConversationWorkspacePath(path: string | null | undefined): boolean {
  const normalized = String(path ?? "").replace(/\\/g, "/");
  if (!normalized) return true;
  return (
    /\/default-workspace(?:\/|$)/i.test(normalized)
    || /\/managed-opencode-workdir(?:\/|$)/i.test(normalized)
  );
}

export function WodeAppWorkbenchShell({
  sidebar,
  selectedWorkspaceRoot,
  automations,
  feishuSetupSkillReady = false,
  onAuthorizeFeishu,
  children,
}: WodeAppWorkbenchShellProps) {
  const navigate = useNavigate();
  const [activeSurface, setActiveSurface] = React.useState<WodeAppSurface>(
    () => readStoredActiveSurface(sidebar.selectedWorkspaceId),
  );
  const feishuAuthorizationInFlightRef = React.useRef(false);
  const feishuPromptSessionRequestedRef = React.useRef(false);
  const [feishuAuthorizationPrompt, setFeishuAuthorizationPrompt] =
    React.useState<WodeAppWorkbenchContextValue["feishuAuthorizationPrompt"]>(
      () => retainedFeishuAuthorizationPrompt,
    );
  const [feishuAuthorizationBusy, setFeishuAuthorizationBusy] = React.useState(false);
  const [selectedRuntimeProjectId, setSelectedRuntimeProjectId] = React.useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(() => readSidebarCollapsed());
  const [productDesk, setProductDesk] = React.useState<WodeAppProductDeskId>(() => {
    const desk = readStoredProductDesk();
    // Supor desk is hidden from public/demo surfaces; force default if still stored.
    if (desk === "supor") {
      storeProductDesk("default");
      return "default";
    }
    return desk;
  });
  const productDeskIsSupor = productDesk === "supor";
  const [skin, setSkin] = React.useState<WodeAppSkinId>(() => {
    const stored = readStoredWodeAppSkin();
    const next: WodeAppSkinId =
      isWodeAppSkinId(stored) && stored !== "supor" ? stored : WODEAPP_DEFAULT_SKIN_ID;
    storeWodeAppSkin(next);
    return next;
  });
  const { authConfig } = useWodeAppAuthSession();
  const userId = authConfig?.user?.id ?? null;
  const [brandAgents, setBrandAgents] = React.useState<WodeAppBrandAgentConfig[]>(
    () => readStoredWodeAppBrandAgents(),
  );
  const abilityProjects = React.useMemo(
    () => pickAbilityProjects(authConfig?.abilityProjects, userId),
    [userId, authConfig?.abilityProjects],
  );
  const builtinAgents = React.useMemo(
    () => resolveAvailableWodeAppBuiltinAgents(abilityProjects, {
      feishuSetupSkillReady,
      brandAgents,
      origin: authConfig?.origin,
      profile: authConfig?.profile,
      ossEdition: isOssEdition(),
    }),
    [abilityProjects, authConfig?.origin, authConfig?.profile, brandAgents, feishuSetupSkillReady],
  );

  React.useEffect(() => {
    setWodeAppRuntimeProfilesFromBrandAgents(brandAgents);
  }, [brandAgents]);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await listWodeAppBrandAgents();
      if (cancelled || !result.ok) return;
      const normalized = normalizeWodeAppBrandAgentsFile(result);
      writeStoredWodeAppBrandAgents(normalized);
      setBrandAgents(listEnabledWodeAppBrandAgents(normalized));
    })();
    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      setBrandAgents(listEnabledWodeAppBrandAgents(normalizeWodeAppBrandAgentsFile(detail)));
    };
    window.addEventListener(WODEAPP_BRAND_AGENTS_CHANGED_EVENT, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(WODEAPP_BRAND_AGENTS_CHANGED_EVENT, onChanged);
    };
  }, []);

  useWodeAppDigitalAssets();
  useWodeAppDefaultModelSync();

  const selectSurface = React.useCallback((surface: WodeAppSurface) => {
    storeActiveSurface(sidebar.selectedWorkspaceId, surface);
    setActiveSurface(surface);
  }, [sidebar.selectedWorkspaceId]);

  const selectSkin = React.useCallback((nextSkin: WodeAppSkinId) => {
    storeWodeAppSkin(nextSkin);
    setSkin(nextSkin);
    // Supor skin locks the product desk + asset scope; other skins live on default desk.
    if (nextSkin === "supor") {
      storeProductDesk("supor");
      setProductDesk("supor");
      void setDigitalAssetScope("supor");
      return;
    }
    storeProductDesk("default");
    setProductDesk("default");
    void setDigitalAssetScope("default");
  }, []);

  const focusAgents = React.useCallback(() => {
    selectSurface("agents");
    setSelectedRuntimeProjectId(null);
  }, [selectSurface]);

  React.useEffect(() => {
    const openAgentView = (event: Event) => {
      const agent = (event as CustomEvent<WodeAppBuiltinAgent>).detail;
      if (!agent?.id) return;
      if (agent.id === WODEAPP_FEISHU_AGENT_ID && !feishuSetupSkillReady) return;
      selectSurface("agents");
      setSelectedRuntimeProjectId(agent.id);
    };
    window.addEventListener(WODEAPP_OPEN_AGENT_VIEW_EVENT, openAgentView);
    return () => window.removeEventListener(WODEAPP_OPEN_AGENT_VIEW_EVENT, openAgentView);
  }, [feishuSetupSkillReady, selectSurface]);

  React.useEffect(() => {
    if (feishuSetupSkillReady || selectedRuntimeProjectId !== WODEAPP_FEISHU_AGENT_ID) return;
    setSelectedRuntimeProjectId(null);
  }, [feishuSetupSkillReady, selectedRuntimeProjectId]);

  React.useEffect(() => {
    if (!selectedRuntimeProjectId) return;
    if (builtinAgents.some((agent) => agent.id === selectedRuntimeProjectId)) return;
    setSelectedRuntimeProjectId(null);
  }, [builtinAgents, selectedRuntimeProjectId]);

  // Hide brand agents from chrome when locked into Supor product desk.
  React.useEffect(() => {
    if (!productDeskIsSupor || !selectedRuntimeProjectId) return;
    const selected = builtinAgents.find((agent) => agent.id === selectedRuntimeProjectId);
    if (selected?.kind === "brand") {
      setSelectedRuntimeProjectId(null);
    }
  }, [builtinAgents, productDeskIsSupor, selectedRuntimeProjectId]);

  // Supor product desk: lock skin + assets, and keep the Supor workspace selected.
  React.useEffect(() => {
    if (!productDeskIsSupor) return;
    selectSkin("supor");
    void setDigitalAssetScope("supor");
    const suporGroup = sidebar.workspaceSessionGroups.find((item) =>
      isSuporWorkspaceLike(item.workspace));
    const suporId = suporGroup?.workspace?.id;
    if (!suporId || !sidebar.onSelectWorkspace) return;
    if (suporId === sidebar.selectedWorkspaceId) return;
    void Promise.resolve(sidebar.onSelectWorkspace(suporId));
  }, [
    productDeskIsSupor,
    selectSkin,
    sidebar.onSelectWorkspace,
    sidebar.selectedWorkspaceId,
    sidebar.workspaceSessionGroups,
  ]);

  const handleCreateTaskWithPrompt = React.useCallback(
    async (
      workspaceId: string,
      prompt: string | import("./wodeapp-composer-handoff").WodeAppTaskPromptInput,
    ): Promise<string | null> => {
      selectSurface("agents");
      setSelectedRuntimeProjectId(null);
      if (sidebar.onCreateTaskWithPrompt) {
        const created = await Promise.resolve(sidebar.onCreateTaskWithPrompt(workspaceId, prompt));
        return typeof created === "string" && created.trim() ? created.trim() : null;
      }
      sidebar.onCreateTaskInWorkspace(workspaceId);
      return null;
    },
    [selectSurface, sidebar],
  );

  const handleReportSessionBug = React.useCallback(async () => {
    const sessionId = sidebar.selectedSessionId?.trim() || "";
    const workspaceId = sidebar.selectedWorkspaceId?.trim() || "";
    if (!sessionId || !workspaceId) return;
    // Keep 「项目」order stable: spawn investigation under 「最近」, not the project desk.
    const homeWorkspaceId = sidebar.workspaceSessionGroups.find((group) =>
      isHomeConversationWorkspacePath(group.workspace.path)
    )?.workspace.id?.trim() || "";
    await reportAndInvestigateSessionBug({
      context: {
        workspaceId,
        sessionId,
        workspaceRoot: selectedWorkspaceRoot || "",
        wodeappWorkbench: true,
      },
      investigationWorkspaceId: homeWorkspaceId || workspaceId,
      startInvestigation: handleCreateTaskWithPrompt,
    });
  }, [
    handleCreateTaskWithPrompt,
    selectedWorkspaceRoot,
    sidebar.selectedSessionId,
    sidebar.selectedWorkspaceId,
    sidebar.workspaceSessionGroups,
  ]);

  const openBuiltinAbilityPage = React.useCallback(
    async (agent: WodeAppBuiltinAgent, sessionId?: string) => {
      selectSurface("agents");
      setSelectedRuntimeProjectId(agent.id);
      await openBuiltinAgentWithFeedback({
        agent,
        signedIn: Boolean(authConfig),
        userId,
        projects: abilityProjects,
        sessionId,
      });
    },
    [abilityProjects, authConfig, selectSurface, userId],
  );

  const openFeishuAgentSettings = React.useCallback(() => {
    setFeishuAuthorizationPrompt(retainFeishuAuthorizationPrompt(null));
    selectSurface("agents");
    if (feishuSetupSkillReady) {
      setSelectedRuntimeProjectId(WODEAPP_FEISHU_AGENT_ID);
    }
    navigate(workspaceSettingsRoute(sidebar.selectedWorkspaceId, "extensions/mcp"), {
      state: {
        workspaceId: sidebar.selectedWorkspaceId,
        mcpSearch: "feishu",
        mcpDetailServerName: WODEAPP_FEISHU_MCP_SERVER,
      },
    });
  }, [feishuSetupSkillReady, navigate, selectSurface, sidebar.selectedWorkspaceId]);

  React.useEffect(() => {
    const sessionId = sidebar.selectedSessionId?.trim() || "";
    if (!sessionId) return;
    setFeishuAuthorizationPrompt((current) => {
      const bound = bindFeishuAuthorizationPromptToSession(
        current,
        sidebar.selectedWorkspaceId,
        sessionId,
      );
      return bound === current ? current : retainFeishuAuthorizationPrompt(bound);
    });
    feishuPromptSessionRequestedRef.current = false;
  }, [sidebar.selectedSessionId, sidebar.selectedWorkspaceId]);

  const requestFeishuAuthorization = React.useCallback(
    (options?: { source?: string | null }) => {
      setFeishuAuthorizationPrompt(retainFeishuAuthorizationPrompt({
        status: "ready",
        source: options?.source?.trim() || null,
        requestedAt: Date.now(),
        workspaceId: sidebar.selectedWorkspaceId,
        sessionId: sidebar.selectedSessionId?.trim() || null,
      }));
      selectSurface("agents");
      setSelectedRuntimeProjectId(null);

      if (sidebar.selectedSessionId) {
        sidebar.onOpenSession(sidebar.selectedWorkspaceId, sidebar.selectedSessionId);
      } else if (!sidebar.newTaskDisabled && !feishuPromptSessionRequestedRef.current) {
        feishuPromptSessionRequestedRef.current = true;
        sidebar.onCreateTaskInWorkspace(sidebar.selectedWorkspaceId);
      }
      return true;
    },
    [selectSurface, sidebar],
  );

  const confirmFeishuAuthorization = React.useCallback(async () => {
    if (feishuAuthorizationInFlightRef.current) return true;
    feishuAuthorizationInFlightRef.current = true;
    setFeishuAuthorizationBusy(true);
    try {
      if (!onAuthorizeFeishu) {
        setFeishuAuthorizationPrompt((current) => (
          retainFeishuAuthorizationPrompt(
            current ? { ...current, status: "needs_setup" } : null,
          )
        ));
        return false;
      }
      const handled = await Promise.resolve(onAuthorizeFeishu());
      if (handled) {
        setFeishuAuthorizationPrompt(retainFeishuAuthorizationPrompt(null));
      } else {
        setFeishuAuthorizationPrompt((current) => (
          retainFeishuAuthorizationPrompt(
            current ? { ...current, status: "needs_setup" } : null,
          )
        ));
      }
      return handled;
    } catch {
      setFeishuAuthorizationPrompt((current) => (
        retainFeishuAuthorizationPrompt(
          current ? { ...current, status: "needs_setup" } : null,
        )
      ));
      return false;
    } finally {
      feishuAuthorizationInFlightRef.current = false;
      setFeishuAuthorizationBusy(false);
    }
  }, [onAuthorizeFeishu]);

  const dismissFeishuAuthorization = React.useCallback(() => {
    if (feishuAuthorizationInFlightRef.current) return;
    setFeishuAuthorizationPrompt(retainFeishuAuthorizationPrompt(null));
  }, []);

  React.useEffect(() => {
    const handleUrls = (urls: readonly string[]) => {
      for (const url of urls) {
        const parsed = parseWodeAppFeishuAuthorizeDeepLink(url);
        if (!parsed) continue;
        requestFeishuAuthorization({ source: parsed.source });
        return;
      }
    };
    const handleDeepLink = (event: Event) => {
      const urls = (event as CustomEvent<DeepLinkBridgeDetail>).detail?.urls ?? [];
      takePendingDeepLinks(window, isWodeAppFeishuAuthorizeDeepLink);
      handleUrls(urls);
    };

    handleUrls(takePendingDeepLinks(window, isWodeAppFeishuAuthorizeDeepLink));
    window.addEventListener(deepLinkBridgeEvent, handleDeepLink);
    return () => window.removeEventListener(deepLinkBridgeEvent, handleDeepLink);
  }, [requestFeishuAuthorization]);

  React.useEffect(() => {
    const onOpenScriptWorkbench = (event: Event) => {
      const detail = (event as CustomEvent<WodeAppOpenScriptWorkbenchDetail>).detail;
      const agent = builtinAgents.find((item) => item.id === SCRIPT_STORYBOARD_AGENT_ID);
      if (!agent) return;
      const sessionId = typeof detail?.sessionId === "string" ? detail.sessionId.trim() : "";
      void openBuiltinAbilityPage(agent, sessionId || undefined);
    };
    window.addEventListener(WODEAPP_OPEN_SCRIPT_WORKBENCH_EVENT, onOpenScriptWorkbench);
    return () => window.removeEventListener(WODEAPP_OPEN_SCRIPT_WORKBENCH_EVENT, onOpenScriptWorkbench);
  }, [builtinAgents, openBuiltinAbilityPage]);

  const scopedFeishuAuthorizationPrompt = React.useMemo(
    () => selectFeishuAuthorizationPromptForSession(
      feishuAuthorizationPrompt,
      sidebar.selectedWorkspaceId,
      sidebar.selectedSessionId,
    ),
    [
      feishuAuthorizationPrompt,
      sidebar.selectedSessionId,
      sidebar.selectedWorkspaceId,
    ],
  );

  const handleOpenSession = React.useCallback(
    (workspaceId: string, sessionId: string) => {
      focusAgents();
      sidebar.onOpenSession(workspaceId, sessionId);
    },
    [focusAgents, sidebar],
  );

  const workbenchValue = React.useMemo<WodeAppWorkbenchContextValue>(
    () => ({
      selectedWorkspaceId: sidebar.selectedWorkspaceId,
      selectedWorkspaceRoot,
      selectedSessionId: sidebar.selectedSessionId,
      feishuSetupSkillReady,
      feishuAuthorizationPrompt: scopedFeishuAuthorizationPrompt,
      feishuAuthorizationBusy,
      automations,
      onCreateTaskWithPrompt: handleCreateTaskWithPrompt,
      onOpenSession: handleOpenSession,
      onAuthorizeFeishu: requestFeishuAuthorization,
      onConfirmFeishuAuthorization: confirmFeishuAuthorization,
      onDismissFeishuAuthorization: dismissFeishuAuthorization,
      onOpenFeishuSettings: openFeishuAgentSettings,
      onOpenAssetsSurface: () => selectSurface("assets"),
      onOpenExtensionsSettings: (section, options) => {
        const path = section === "plugins" ? "extensions/plugins" : section === "mcp" ? "extensions/mcp" : "extensions";
        navigate(workspaceSettingsRoute(sidebar.selectedWorkspaceId, path), {
          state: {
            workspaceId: sidebar.selectedWorkspaceId,
            ...(options?.mcpSearch ? { mcpSearch: options.mcpSearch } : {}),
            ...(options?.mcpDetailServerName ? { mcpDetailServerName: options.mcpDetailServerName } : {}),
          },
        });
      },
    }),
    [
      automations,
      confirmFeishuAuthorization,
      dismissFeishuAuthorization,
      feishuAuthorizationBusy,
      feishuSetupSkillReady,
      handleCreateTaskWithPrompt,
      handleOpenSession,
      navigate,
      openFeishuAgentSettings,
      requestFeishuAuthorization,
      scopedFeishuAuthorizationPrompt,
      selectSurface,
      selectedWorkspaceRoot,
      sidebar.selectedSessionId,
      sidebar.selectedWorkspaceId,
    ],
  );

  const handleSelectRuntimeProject = React.useCallback(
    (projectId: string) => {
      void (async () => {
        const agent = builtinAgents.find((item) => item.id === projectId);
        if (!agent) return;
        if (agent.id === WODEAPP_FEISHU_AGENT_ID) {
          selectSurface("agents");
          setSelectedRuntimeProjectId(agent.id);
          return;
        }
        // Brand agents are not mode switches in the Supor product desk.
        if (productDeskIsSupor && agent.kind === "brand") {
          selectSurface("agents");
          setSelectedRuntimeProjectId(null);
          return;
        }
        // Stay on Supor asset partition for capability agents while in that desk.
        if (productDeskIsSupor) {
          void setDigitalAssetScope("supor");
          selectSkin("supor");
        }
        // 创建智能体：只开新对话并预填需求，由用户补全后发送；不打开网页向导。
        if (agent.id === WODEAPP_CREATE_AGENT_ID) {
          selectSurface("agents");
          setSelectedRuntimeProjectId(agent.id);
          handleCreateTaskWithPrompt(sidebar.selectedWorkspaceId, buildBuiltinAgentTask(agent));
          return;
        }
        // 图片/视频：先建对话拿到 sessionId，再打开能力页，避免右栏挂在旧会话上被切会话关掉。
        if (agent.id === VISUAL_GENERATION_AGENT_ID || agent.id === VIDEO_GENERATION_AGENT_ID) {
          selectSurface("agents");
          setSelectedRuntimeProjectId(agent.id);
          const prompt = buildBuiltinAgentTask(agent, { autoSend: false });
          let sessionId: string | undefined;
          if (sidebar.onCreateTaskWithPrompt) {
            const created = await Promise.resolve(
              sidebar.onCreateTaskWithPrompt(sidebar.selectedWorkspaceId, prompt),
            );
            if (typeof created === "string" && created.trim()) sessionId = created.trim();
          } else {
            sidebar.onCreateTaskInWorkspace(sidebar.selectedWorkspaceId);
          }
          await openBuiltinAbilityPage(agent, sessionId);
          return;
        }
        void openBuiltinAbilityPage(agent);
      })();
    },
    [
      builtinAgents,
      handleCreateTaskWithPrompt,
      openBuiltinAbilityPage,
      productDeskIsSupor,
      selectSkin,
      selectSurface,
      sidebar,
    ],
  );

  const handleExitBrandIsolation = React.useCallback(() => {
    setSelectedRuntimeProjectId(null);
  }, []);

  const handleSurfaceChange = React.useCallback((surface: WodeAppSurface) => {
    selectSurface(surface);
    if (surface !== "agents") {
      setSelectedRuntimeProjectId(null);
    }
  }, [selectSurface]);

  const handleClassicNewTask = React.useCallback(() => {
    if (sidebar.newTaskDisabled) return;
    focusAgents();
    sidebar.onCreateTaskInWorkspace(sidebar.selectedWorkspaceId);
  }, [focusAgents, sidebar]);

  React.useEffect(() => {
    if (activeSurface === "agents") return;
    window.dispatchEvent(new Event("openwork-close-right-pane"));
    getElectronBrowser()?.hide?.();
  }, [activeSurface]);

  React.useEffect(() => {
    const onFocusAgents = () => focusAgents();
    window.addEventListener("wodeapp:focus-agents", onFocusAgents);
    return () => window.removeEventListener("wodeapp:focus-agents", onFocusAgents);
  }, [focusAgents]);

  const feishuCommerceWorkbenchOpen = activeSurface === "agents"
    && selectedRuntimeProjectId === WODEAPP_FEISHU_AGENT_ID;
  const wynneBrandWorkbenchOpen = activeSurface === "agents"
    && selectedRuntimeProjectId === WODEAPP_WYNNE_AGENT_ID
    && brandAgents.some((agent) => agent.id === WODEAPP_WYNNE_AGENT_ID && agent.workbench === "wynne");
  const integrationWorkbenchOpen = feishuCommerceWorkbenchOpen || wynneBrandWorkbenchOpen;
  const selectedRuntimeProfile = readWodeAppRuntimeProfileForSession(
    sidebar.selectedWorkspaceId,
    sidebar.selectedSessionId ?? "",
  );
  const activeSurfaceLabel = wynneBrandWorkbenchOpen
    ? "Wynne 品牌智能体"
    : feishuCommerceWorkbenchOpen
    ? "飞书"
    : activeSurface === "agents" && selectedRuntimeProfile
    ? selectedRuntimeProfile.name
    : wodeappSurfaceLabel(activeSurface);

  const toggleSidebarCollapsed = React.useCallback(() => {
    setSidebarCollapsed((current) => {
      const next = !current;
      storeSidebarCollapsed(next);
      return next;
    });
  }, []);

  return (
    <WodeAppWorkbenchProvider value={workbenchValue}>
      <div
        className={`wapp-workspace-shell wapp-skin-${skin}${sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}
        data-wapp-skin={skin}
        data-wapp-product-desk={productDesk}
        data-sidebar-collapsed={sidebarCollapsed ? "1" : "0"}
      >
        <button
          type="button"
          className="wapp-sidebar-toggle mac:titlebar-no-drag"
          aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
          title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
          aria-pressed={sidebarCollapsed}
          onClick={toggleSidebarCollapsed}
        >
          <PanelLeft aria-hidden />
        </button>
        {/* Classic 2007 chrome: mount/unmount with the skin. Do not CSS-hide. */}
        {skin === "classic-blue" ? (
          <WodeAppClassicFrame
            activeSurface={activeSurface}
            onCreateTask={handleClassicNewTask}
            onSkinChange={selectSkin}
            onSurfaceChange={handleSurfaceChange}
          />
        ) : null}
        <WodeAppThemeChrome
          skin={skin}
          workspaceSessionGroups={sidebar.workspaceSessionGroups}
          selectedSessionId={sidebar.selectedSessionId}
          sessionStatusById={sidebar.sessionStatusById}
          onOpenSession={handleOpenSession}
        />
        <WodeAppWorkbenchSidebar
          {...sidebar}
          activeSurface={activeSurface}
          builtinAgents={builtinAgents}
          productDeskIsSupor={productDeskIsSupor}
          skin={skin}
          selectedRuntimeProjectId={selectedRuntimeProjectId}
          onSurfaceChange={handleSurfaceChange}
          onSelectRuntimeProject={handleSelectRuntimeProject}
          onExitBrandIsolation={handleExitBrandIsolation}
          onOpenSession={handleOpenSession}
        />
        <div className="wapp-workspace-main">
          <WodeAppMainChrome
            activeSurface={activeSurface}
            activeSurfaceLabel={activeSurfaceLabel}
            sessionId={sidebar.selectedSessionId}
            onReportSessionBug={handleReportSessionBug}
            productDesk={productDesk}
            skin={skin}
            onSkinChange={selectSkin}
          >
            <div className="wapp-stage">
              <div
                className={`wapp-stage-pane${activeSurface === "agents" && !integrationWorkbenchOpen ? " is-active" : ""}`}
                aria-hidden={activeSurface !== "agents" || integrationWorkbenchOpen}
              >
                <div className="wapp-workspace-main-inner">{children}</div>
              </div>
              <div
                className={`wapp-stage-pane wapp-stage-pane-surface${activeSurface !== "agents" || integrationWorkbenchOpen ? " is-active" : ""}`}
                aria-hidden={activeSurface === "agents" && !integrationWorkbenchOpen}
              >
                {feishuCommerceWorkbenchOpen ? (
                  <div className="wapp-surface-scroll-host">
                    <WodeAppFeishuCommerceWorkbench />
                  </div>
                ) : wynneBrandWorkbenchOpen ? (
                  <div className="wapp-surface-scroll-host">
                    <WodeAppWynneBrandWorkbench />
                  </div>
                ) : activeSurface !== "agents" ? (
                  <div className="wapp-surface-scroll-host">
                    <WodeAppSurfacePage surface={activeSurface} />
                  </div>
                ) : null}
              </div>
            </div>
          </WodeAppMainChrome>
        </div>
        {skin === "classic-blue" ? (
          <WodeAppClassicAssistantRail
            activeSurfaceLabel={activeSurfaceLabel}
            onOpenAccount={() => handleSurfaceChange("account")}
            onOpenAgents={focusAgents}
            onOpenSettings={() => navigate("/settings/service")}
          />
        ) : null}
      </div>
    </WodeAppWorkbenchProvider>
  );
}
