/** @jsxImportSource react */
import * as React from "react";
import {
  Bot,
  Box,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Folder,
  FolderPlus,
  History,
  LayoutGrid,
  Loader2,
  MessageSquarePlus,
  Pin,
  Plug,
  Plus,
  Radar,
  Trash2,
} from "lucide-react";

import { getDisplaySessionTitle, isGeneratedSessionTitle } from "@/app/lib/session-title";
import type { WorkspaceConnectionState, WorkspaceSessionGroup } from "@/app/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import { RenameSessionModal } from "@/react-app/domains/session/modals/rename-session-modal";
import {
  SessionActions,
  SessionContextMenu,
} from "@/react-app/domains/session/sidebar/app-sidebar";
import { SidebarContext } from "@/react-app/domains/session/sidebar/app-sidebar-provider";
import {
  usePinnedSessionIds,
  useSessionManagementStore,
  useSessionOrder,
  useWorkspaceGroups,
  type SessionGroupDefinition,
} from "@/react-app/domains/session/sidebar/session-management-store";
import {
  isSessionArchived,
  isStreamingSessionStatus,
} from "@/react-app/domains/session/sidebar/utils";
import {
  mergeStableSessionOrderIds,
  sameStringOrder,
  sortSessionsByStableOrder,
} from "./wodeapp-session-list-order";

import { WodeAppAccountFooter } from "./wodeapp-account-footer";
import type { WodeAppBuiltinAgent } from "./runtime-projects";
import type { WodeAppSurface } from "./wodeapp-types";
import { WODEAPP_NAV_ITEMS } from "./wodeapp-types";
import {
  WODEAPP_ASSET_SURFACE_MODE_EVENT,
  requestWodeAppAssetSurfaceMode,
  type WodeAppAssetSurfaceMode,
  type WodeAppAssetSurfaceModeEventDetail,
} from "./wodeapp-asset-surface-mode";
import {
  isSuporWorkspaceLike,
  SUPOR_WORKSPACE_DISPLAY_NAME,
} from "./wodeapp-supor-project";
import type { WodeAppSkinId } from "./wodeapp-skins";
import {
  getSessionActivityStatusLabel,
  type SessionActivityStatus,
} from "../session/status/session-activity-store";

const THEME_BRAND_AVATAR_SRC: Partial<Record<WodeAppSkinId, string>> = {
  "pet-soft": `${import.meta.env.BASE_URL}skin-pet-avatar.png`,
  "cute-pastel": `${import.meta.env.BASE_URL}skin-cute-macaron.png`,
  "ink-book": `${import.meta.env.BASE_URL}skin-ink-seal.png`,
  "otome-diary": `${import.meta.env.BASE_URL}skin-otome-avatar.png`,
};

const NAV_ICONS: Record<WodeAppSurface, React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  agents: Bot,
  assets: Box,
  schedule: CalendarClock,
  capabilities: LayoutGrid,
  plugins: Plug,
  capture: Radar,
  account: Bot,
};

export type WodeAppWorkbenchSidebarProps = {
  activeSurface: WodeAppSurface;
  builtinAgents: readonly WodeAppBuiltinAgent[];
  /** Runtime Supor whole-shell desk (not a compile-time flag). */
  productDeskIsSupor?: boolean;
  /** Active workbench skin — theme brand chrome (e.g. pet avatar). */
  skin?: WodeAppSkinId;
  selectedRuntimeProjectId: string | null;
  onSurfaceChange: (surface: WodeAppSurface) => void;
  onSelectRuntimeProject: (projectId: string) => void;
  /** Leave Supor brand isolation (clear brand selection; sidebar switches workspace). */
  onExitBrandIsolation?: () => void;
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  workspaceSessionGroups: WorkspaceSessionGroup[];
  sessionsLoading: boolean;
  sessionStatusById?: Record<string, string>;
  connectingWorkspaceId?: string | null;
  workspaceConnectionStateById?: Record<string, WorkspaceConnectionState>;
  newTaskDisabled: boolean;
  onCreateTaskInWorkspace: (workspaceId: string) => void;
  onCreateTaskWithPrompt?: (
    workspaceId: string,
    prompt: string | import("./wodeapp-composer-handoff").WodeAppTaskPromptInput,
  ) => void | Promise<void | string | null>;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
  onRenameSession?: (sessionId: string, title: string) => Promise<void>;
  onDeleteSession?: (sessionId: string) => Promise<void>;
  onCompactSession?: (sessionId: string) => Promise<void> | void;
  onArchiveSession?: (sessionId: string, archived: boolean) => void;
  onSelectWorkspace?: (workspaceId: string) => Promise<boolean> | boolean | void;
  onOpenRenameWorkspace?: (workspaceId: string) => void;
  onShareWorkspace?: (workspaceId: string) => void;
  onRevealWorkspace?: (workspaceId: string) => void;
  onRecoverWorkspace?: (workspaceId: string) => Promise<boolean> | boolean | void;
  onTestWorkspaceConnection?: (workspaceId: string) => Promise<boolean> | boolean | void;
  onEditWorkspaceConnection?: (workspaceId: string) => void;
  onForgetWorkspace?: (workspaceId: string) => void;
  /** @deprecated Prefer blank / existing-folder handlers; kept as fallback. */
  onOpenCreateWorkspace?: () => void;
  onCreateBlankWorkspace?: () => void | Promise<void>;
  onOpenExistingFolderWorkspace?: () => void | Promise<void>;
  createWorkspaceBusy?: boolean;
};

const RECENT_STATUS_LABELS: Record<SessionActivityStatus, string> = {
  idle: "",
  thinking: "思考中",
  responding: "回复中",
  waiting: "等待确认",
  error: "出错",
  compacting: "整理中",
};

function isSessionActivityStatus(status: string | undefined): status is SessionActivityStatus {
  return (
    status === "idle" ||
    status === "thinking" ||
    status === "responding" ||
    status === "waiting" ||
    status === "error" ||
    status === "compacting"
  );
}

function getRecentSessionStatusLabel(status: string | undefined): string {
  if (!status || status === "idle") return "";
  if (isSessionActivityStatus(status)) {
    return RECENT_STATUS_LABELS[status] || getSessionActivityStatusLabel(status);
  }
  if (isStreamingSessionStatus(status)) return "运行中";
  return "进行中";
}

function sessionTitleForId(groups: WorkspaceSessionGroup[], sessionId: string): string {
  for (const group of groups) {
    const session = group.sessions.find((item) => item.id === sessionId);
    if (session) {
      return getDisplaySessionTitle(session.title ?? "", "我的智能体");
    }
  }
  return "";
}

const UNGROUPED_GROUP_ID = "__openwork_ungrouped";
const RECENT_SESSION_LIMIT = 8;
const EMPTY_COLLAPSED_GROUP_IDS: string[] = [];

export function selectWodeAppCollapsedGroupIds(
  groupsByWorkspace: Record<string, { collapsedGroupIds?: string[] }>,
  workspaceId: string,
): string[] {
  return groupsByWorkspace[workspaceId]?.collapsedGroupIds ?? EMPTY_COLLAPSED_GROUP_IDS;
}

type WorkspaceSession = WorkspaceSessionGroup["sessions"][number];

export function filterVisibleWodeAppSessions(sessions: WorkspaceSession[]) {
  const ids = new Set(sessions.map((session) => session.id));
  return sessions.filter((session) => {
    if (isSessionArchived(session) || isGeneratedSessionTitle(session.title)) return false;
    // task/explore subagent sessions are engine-internal children; never list them in 「最近」.
    const parentID = typeof session.parentID === "string" ? session.parentID.trim() : "";
    if (parentID && ids.has(parentID)) return false;
    return true;
  });
}

/**
 * Sticky list order for the workbench sidebar.
 * OpenCode bumps `time.updated` on tool/assistant writes; live recency sort made
 * rows jump while several sessions streamed. New sessions still prepend.
 */
function useOrderedVisibleSessions(workspaceId: string, sessions: WorkspaceSession[]) {
  const orderIds = useSessionOrder(workspaceId);
  const pinnedIds = usePinnedSessionIds();
  const reorderSessions = useSessionManagementStore((state) => state.reorderSessions);
  const visibleSessions = React.useMemo(
    () => filterVisibleWodeAppSessions(sessions),
    [sessions],
  );
  const visibleIdsKey = React.useMemo(
    () => visibleSessions.map((session) => session.id).join("\0"),
    [visibleSessions],
  );

  React.useEffect(() => {
    if (!workspaceId) return;
    const nextOrderIds = mergeStableSessionOrderIds(orderIds, visibleSessions);
    if (sameStringOrder(nextOrderIds, orderIds)) return;
    reorderSessions(workspaceId, nextOrderIds);
  }, [orderIds, reorderSessions, visibleIdsKey, visibleSessions, workspaceId]);

  return React.useMemo(
    () => sortSessionsByStableOrder(visibleSessions, orderIds, pinnedIds),
    [orderIds, pinnedIds, visibleSessions],
  );
}

function isHomeConversationWorkspace(workspace: WorkspaceSessionGroup["workspace"]) {
  const path = String(workspace.path ?? "").replace(/\\/g, "/");
  if (!path) return true;
  return (
    /\/default-workspace(?:\/|$)/i.test(path)
    || /\/managed-opencode-workdir(?:\/|$)/i.test(path)
  );
}

/** Auto-mounted monorepo desk under 「项目」 — distinct from chat-only default-workspace. */
function isSelfEvolveWorkspaceLike(workspace: WorkspaceSessionGroup["workspace"] | null | undefined) {
  if (!workspace) return false;
  if (isSuporWorkspaceLike(workspace)) return true;
  const name = String(workspace.displayName || workspace.name || "").trim();
  if (name.includes("自进化")) return true;
  const folderPath = String(workspace.path || "").replace(/\\/g, "/");
  if (!folderPath) return false;
  // Dev monorepo root that contains wodeappx/ + runtime-server/
  return /\/wodeapp$/i.test(folderPath.replace(/\/+$/, ""))
    && !/\/\.wodeapp\/projects\//i.test(folderPath);
}

/** Folder workspaces keep the directory name; never rebrand them as the product. */
function folderWorkspaceLabel(workspace: WorkspaceSessionGroup["workspace"]) {
  if (isSuporWorkspaceLike(workspace)) {
    return SUPOR_WORKSPACE_DISPLAY_NAME;
  }
  if (isSelfEvolveWorkspaceLike(workspace)) {
    const named = workspace.displayName?.trim() || workspace.name?.trim();
    if (named?.includes("自进化")) return named;
    return "wodeapp（自进化）";
  }
  const displayName = workspace.displayName?.trim();
  if (displayName && displayName.toLowerCase() !== "wodeapp" && displayName !== "WodeAppX" && displayName !== "WodeAppX") {
    return displayName;
  }
  const path = String(workspace.path ?? "").replace(/\\/g, "/");
  if (path) {
    const base = path.split("/").filter(Boolean).pop();
    if (base) return base;
  }
  const name = workspace.name?.trim();
  if (!name || name.toLowerCase() === "wodeapp" || name === "WodeAppX" || name === "WodeAppX") return "本地工作区";
  return name;
}

export function partitionSessionsByGroup(
  sessions: WorkspaceSession[],
  groups: SessionGroupDefinition[],
  assignments: Record<string, string>,
) {
  const byGroup = new Map<string, WorkspaceSession[]>();
  for (const group of groups) {
    byGroup.set(group.id, []);
  }
  const ungrouped: WorkspaceSession[] = [];
  for (const session of sessions) {
    const groupId = assignments[session.id];
    if (groupId && byGroup.has(groupId)) {
      byGroup.get(groupId)!.push(session);
    } else {
      ungrouped.push(session);
    }
  }
  return { byGroup, ungrouped };
}

function hasGroupedSessionLayout(
  groups: SessionGroupDefinition[],
  assignments: Record<string, string>,
) {
  if (groups.length > 0) return true;
  return Object.values(assignments).some(Boolean);
}

/**
 * Group first, then truncate. Named groups always keep their full membership
 * so a session assigned to「自动化视频」is never hidden behind the global
 * 「展开其余」until the ungrouped list itself is truncated.
 */
export function buildGroupedSessionDisplay(
  sessions: WorkspaceSession[],
  groups: SessionGroupDefinition[],
  assignments: Record<string, string>,
  showAllSessions: boolean,
  limit: number = RECENT_SESSION_LIMIT,
) {
  // Caller supplies already-filtered, stably-ordered sessions.
  const allSessions = sessions;
  const full = partitionSessionsByGroup(allSessions, groups, assignments);
  if (showAllSessions) {
    return {
      allSessions,
      totals: full,
      display: full,
      hiddenCount: 0,
    };
  }

  const byGroup = new Map<string, WorkspaceSession[]>();
  for (const group of groups) {
    byGroup.set(group.id, [...(full.byGroup.get(group.id) ?? [])]);
  }
  const ungroupedVisible = full.ungrouped.slice(0, limit);
  return {
    allSessions,
    totals: full,
    display: { byGroup, ungrouped: ungroupedVisible },
    hiddenCount: Math.max(0, full.ungrouped.length - ungroupedVisible.length),
  };
}

function SessionList(options: {
  sessions: WorkspaceSession[];
  workspaceId: string;
  sessionsLoading: boolean;
  showAllSessions: boolean;
  sessionGroups: SessionGroupDefinition[];
  assignments: Record<string, string>;
  collapsedGroupIds: string[];
  rowProps: Omit<RecentSessionRowProps, "session" | "workspaceId">;
  onToggleShowAll: () => void;
  onToggleSessionGroup: (groupId: string) => void;
  emptyLabel?: string;
}) {
  const {
    sessions,
    workspaceId,
    sessionsLoading,
    showAllSessions,
    sessionGroups,
    assignments,
    collapsedGroupIds,
    rowProps,
    onToggleShowAll,
    onToggleSessionGroup,
    emptyLabel = "暂无对话",
  } = options;
  const orderedSessions = useOrderedVisibleSessions(workspaceId, sessions);
  const useGroupedLayout = hasGroupedSessionLayout(sessionGroups, assignments);
  const groupedDisplay = useGroupedLayout
    ? buildGroupedSessionDisplay(orderedSessions, sessionGroups, assignments, showAllSessions)
    : null;
  const allSessions = groupedDisplay?.allSessions ?? orderedSessions;
  const visibleSessions = showAllSessions
    ? allSessions
    : allSessions.slice(0, RECENT_SESSION_LIMIT);
  const hiddenCount = groupedDisplay
    ? groupedDisplay.hiddenCount
    : Math.max(0, allSessions.length - visibleSessions.length);

  if (sessionsLoading && allSessions.length === 0) {
    return <p className="wapp-sidebar-muted">加载中...</p>;
  }

  return (
    <>
      {useGroupedLayout && groupedDisplay ? (
        <>
          {sessionGroups.map((sessionGroup) => (
            <RecentGroupBlock
              key={sessionGroup.id}
              groupId={sessionGroup.id}
              label={sessionGroup.label}
              sessions={groupedDisplay.display.byGroup.get(sessionGroup.id) ?? []}
              totalCount={(groupedDisplay.totals.byGroup.get(sessionGroup.id) ?? []).length}
              workspaceId={workspaceId}
              collapsedGroupIds={collapsedGroupIds}
              onToggleGroup={onToggleSessionGroup}
              rowProps={rowProps}
            />
          ))}
          <RecentGroupBlock
            groupId={UNGROUPED_GROUP_ID}
            label={t("session_management.no_group")}
            sessions={groupedDisplay.display.ungrouped}
            totalCount={groupedDisplay.totals.ungrouped.length}
            workspaceId={workspaceId}
            collapsedGroupIds={collapsedGroupIds}
            onToggleGroup={onToggleSessionGroup}
            rowProps={rowProps}
          />
        </>
      ) : allSessions.length > 0 ? (
        visibleSessions.map((session) => (
          <RecentSessionRow
            key={session.id}
            session={session}
            workspaceId={workspaceId}
            {...rowProps}
          />
        ))
      ) : (
        <p className="wapp-sidebar-muted wapp-recent-group-empty">{emptyLabel}</p>
      )}
      {hiddenCount > 0 || (showAllSessions && allSessions.length > RECENT_SESSION_LIMIT) ? (
        <button
          type="button"
          className="wapp-recent-expand"
          aria-expanded={showAllSessions}
          onClick={onToggleShowAll}
        >
          {showAllSessions ? <ChevronUp aria-hidden /> : <ChevronDown aria-hidden />}
          <span>
            {showAllSessions
              ? "收起显示"
              : `展开显示（其余 ${hiddenCount} 条）`}
          </span>
        </button>
      ) : null}
    </>
  );
}

/** @deprecated name kept for call sites that still say renderSessionList */
function renderSessionList(options: Parameters<typeof SessionList>[0]) {
  return <SessionList {...options} />;
}

type RecentSessionRowProps = {
  session: WorkspaceSession;
  workspaceId: string;
  selectedSessionId: string | null;
  sessionStatusById?: Record<string, string>;
  pinnedSessionIds: Set<string>;
  showSessionActions: boolean;
  onSurfaceChange: (surface: WodeAppSurface) => void;
  onOpenSession: (workspaceId: string, sessionId: string) => void;
  onPrefetchSession?: (workspaceId: string, sessionId: string) => void;
};

function RecentSessionRow({
  session,
  workspaceId,
  selectedSessionId,
  sessionStatusById,
  pinnedSessionIds,
  showSessionActions,
  onSurfaceChange,
  onOpenSession,
  onPrefetchSession,
}: RecentSessionRowProps) {
  const activityStatus = sessionStatusById?.[session.id];
  const statusLabel = getRecentSessionStatusLabel(activityStatus);
  const isStreaming = isStreamingSessionStatus(activityStatus);
  // Do not reuse "active" here — `.is-active` is reserved for the selected session.
  // Busy sessions used to get `is-active` and looked multi-selected.
  const statusTone =
    activityStatus === "error"
      ? "error"
      : activityStatus === "waiting"
        ? "waiting"
        : statusLabel
          ? "running"
          : null;
  const isSelected = selectedSessionId === session.id;
  const isPinned = pinnedSessionIds.has(session.id);
  const isArchived = isSessionArchived(session);
  const rowClassName = [
    "wapp-recent-row",
    "group/recent",
    isSelected ? "is-active" : "",
    statusTone ? `is-${statusTone}` : "",
  ].filter(Boolean).join(" ");
  const itemClassName = [
    "wapp-recent-item",
    isSelected ? "is-active" : "",
    statusTone ? `is-${statusTone}` : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={rowClassName}>
      <SessionContextMenu
        sessionId={session.id}
        workspaceId={workspaceId}
        isPinned={isPinned}
        isArchived={isArchived}
      >
        <button
          type="button"
          className={itemClassName}
          aria-current={isSelected ? "page" : undefined}
          onClick={() => {
            onSurfaceChange("agents");
            onOpenSession(workspaceId, session.id);
          }}
          onPointerEnter={() => onPrefetchSession?.(workspaceId, session.id)}
          onFocus={() => onPrefetchSession?.(workspaceId, session.id)}
        >
          <span className="wapp-recent-item-head">
            {isPinned ? (
              <Pin className="wapp-recent-pin" aria-hidden />
            ) : null}
            <span className="wapp-recent-title">
              {getDisplaySessionTitle(session.title ?? "", "我的智能体")}
            </span>
            {statusLabel ? (
              <span
                className={`wapp-recent-status-indicator${isStreaming ? " is-streaming" : ""}`}
                title={statusLabel}
                aria-label={statusLabel}
              >
                {isStreaming ? <Loader2 aria-hidden /> : null}
              </span>
            ) : null}
          </span>
        </button>
      </SessionContextMenu>
      {showSessionActions ? (
        <div className="wapp-recent-actions">
          <SessionActions
            sessionId={session.id}
            workspaceId={workspaceId}
            isPinned={isPinned}
            isArchived={isArchived}
            className="wapp-recent-action-trigger"
          />
        </div>
      ) : null}
    </div>
  );
}

type RecentGroupBlockProps = {
  groupId: string;
  label: string;
  sessions: WorkspaceSession[];
  /** Full membership count; may exceed `sessions` when ungrouped is truncated. */
  totalCount?: number;
  workspaceId: string;
  collapsedGroupIds: string[];
  onToggleGroup: (groupId: string) => void;
  rowProps: Omit<RecentSessionRowProps, "session" | "workspaceId">;
};

function RecentGroupBlock({
  groupId,
  label,
  sessions,
  totalCount,
  workspaceId,
  collapsedGroupIds,
  onToggleGroup,
  rowProps,
}: RecentGroupBlockProps) {
  const expanded = !collapsedGroupIds.includes(groupId);
  const canRemoveGroup = groupId !== UNGROUPED_GROUP_ID;
  const membershipCount = totalCount ?? sessions.length;
  if (groupId === UNGROUPED_GROUP_ID && membershipCount === 0) {
    return null;
  }

  return (
    <div className="wapp-recent-group">
      <div className="wapp-recent-group-head-row">
        <button
          type="button"
          className="wapp-recent-group-head"
          aria-expanded={expanded}
          onClick={() => onToggleGroup(groupId)}
        >
          <ChevronRight className={`wapp-recent-group-chevron${expanded ? " is-open" : ""}`} aria-hidden />
          <span className="wapp-recent-group-label">{label}</span>
          <span className="wapp-recent-group-count">{membershipCount}</span>
        </button>
        {canRemoveGroup ? (
          <button
            type="button"
            className="wapp-recent-group-delete"
            aria-label="删除分组"
            title="删除分组"
            onClick={(event) => {
              event.stopPropagation();
              useSessionManagementStore.getState().removeGroup(workspaceId, groupId);
            }}
          >
            <Trash2 aria-hidden />
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div className="wapp-recent-group-body">
          {sessions.length > 0 ? (
            sessions.map((session) => (
              <RecentSessionRow
                key={session.id}
                session={session}
                workspaceId={workspaceId}
                {...rowProps}
              />
            ))
          ) : membershipCount > 0 ? null : (
            <p className="wapp-sidebar-muted wapp-recent-group-empty">暂无对话</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

type WorkspaceSessionListBodyProps = {
  group: WorkspaceSessionGroup;
  sessionsLoading: boolean;
  showAllSessions: boolean;
  rowProps: Omit<RecentSessionRowProps, "session" | "workspaceId">;
  onToggleShowAll: (workspaceId: string) => void;
  onToggleSessionGroup: (workspaceId: string, groupId: string) => void;
  emptyLabel?: string;
};

function WorkspaceSessionListBody({
  group,
  sessionsLoading,
  showAllSessions,
  rowProps,
  onToggleShowAll,
  onToggleSessionGroup,
  emptyLabel,
}: WorkspaceSessionListBodyProps) {
  const workspaceId = group.workspace.id;
  const { groups: sessionGroups, assignments } = useWorkspaceGroups(workspaceId);
  const collapsedGroupIds = useSessionManagementStore(
    (state) => selectWodeAppCollapsedGroupIds(state.groupsByWorkspace, workspaceId),
  );

  return renderSessionList({
    sessions: group.sessions,
    workspaceId,
    sessionsLoading,
    showAllSessions,
    sessionGroups,
    assignments,
    collapsedGroupIds,
    rowProps,
    onToggleShowAll: () => onToggleShowAll(workspaceId),
    onToggleSessionGroup: (groupId) => onToggleSessionGroup(workspaceId, groupId),
    emptyLabel,
  });
}

/**
 * Product desk (e.g. Supor) already *is* the project — do not wrap sessions in a
 * nested workspace chrome row (chevron / title / count). Keep an explicit
 * "删除项目" so the desk can still be forgotten from the sidebar.
 */
function FlatWorkspaceConversationList({
  group,
  selectedWorkspaceId,
  sessionsLoading,
  showAllSessions,
  rowProps,
  onSelectWorkspace,
  onForgetWorkspace,
  onToggleShowAll,
  onToggleSessionGroup,
}: {
  group: WorkspaceSessionGroup;
  selectedWorkspaceId: string;
  sessionsLoading: boolean;
  showAllSessions: boolean;
  rowProps: Omit<RecentSessionRowProps, "session" | "workspaceId">;
  onSelectWorkspace?: (workspaceId: string) => Promise<boolean> | boolean | void;
  onForgetWorkspace?: (workspaceId: string) => void;
  onToggleShowAll: (workspaceId: string) => void;
  onToggleSessionGroup: (workspaceId: string, groupId: string) => void;
}) {
  const workspaceId = group.workspace.id;
  const isActive = workspaceId === selectedWorkspaceId;
  const ensureSelected = React.useCallback(() => {
    if (workspaceId === selectedWorkspaceId) return;
    void Promise.resolve(onSelectWorkspace?.(workspaceId));
  }, [onSelectWorkspace, selectedWorkspaceId, workspaceId]);

  return (
    <div
      className={`wapp-home-conversations${isActive ? " is-active" : ""}`}
      onFocusCapture={ensureSelected}
    >
      {onForgetWorkspace ? (
        <div className="wapp-conversation-workspace-actions wapp-flat-workspace-actions">
          <button
            type="button"
            className="wapp-conversation-workspace-action is-danger"
            aria-label="删除项目"
            title="删除项目"
            onClick={(event) => {
              event.stopPropagation();
              onForgetWorkspace(workspaceId);
            }}
          >
            <Trash2 aria-hidden />
          </button>
        </div>
      ) : null}
      <WorkspaceSessionListBody
        group={group}
        sessionsLoading={sessionsLoading}
        showAllSessions={showAllSessions}
        rowProps={{
          ...rowProps,
          onOpenSession: (nextWorkspaceId, sessionId) => {
            ensureSelected();
            rowProps.onOpenSession(nextWorkspaceId, sessionId);
          },
        }}
        onToggleShowAll={onToggleShowAll}
        onToggleSessionGroup={(id, groupId) => {
          ensureSelected();
          onToggleSessionGroup(id, groupId);
        }}
        emptyLabel="暂无对话"
      />
    </div>
  );
}

type WorkspaceConversationBlockProps = {
  group: WorkspaceSessionGroup;
  selectedWorkspaceId: string;
  sessionsLoading: boolean;
  connectingWorkspaceId?: string | null;
  expanded: boolean;
  showAllSessions: boolean;
  newTaskDisabled: boolean;
  rowProps: Omit<RecentSessionRowProps, "session" | "workspaceId">;
  onToggleExpanded: (workspaceId: string) => void;
  onSelectWorkspace?: (workspaceId: string) => Promise<boolean> | boolean | void;
  onSurfaceChange: (surface: WodeAppSurface) => void;
  onCreateTaskInWorkspace: (workspaceId: string) => void;
  onForgetWorkspace?: (workspaceId: string) => void;
  onToggleShowAll: (workspaceId: string) => void;
  onToggleSessionGroup: (workspaceId: string, groupId: string) => void;
};

function WorkspaceConversationBlock({
  group,
  selectedWorkspaceId,
  sessionsLoading,
  connectingWorkspaceId,
  expanded,
  showAllSessions,
  newTaskDisabled,
  rowProps,
  onToggleExpanded,
  onSelectWorkspace,
  onSurfaceChange,
  onCreateTaskInWorkspace,
  onForgetWorkspace,
  onToggleShowAll,
  onToggleSessionGroup,
}: WorkspaceConversationBlockProps) {
  const workspace = group.workspace;
  const workspaceId = workspace.id;
  const isActive = workspaceId === selectedWorkspaceId;
  const isConnecting = connectingWorkspaceId === workspaceId;
  const label = folderWorkspaceLabel(workspace);

  return (
    <div className={`wapp-conversation-workspace${isActive ? " is-active" : ""}`}>
      <div className="wapp-conversation-workspace-head">
        <button
          type="button"
          className="wapp-conversation-workspace-toggle"
          aria-expanded={expanded}
          aria-label={expanded ? "折叠项目" : "展开项目"}
          onClick={() => onToggleExpanded(workspace.id)}
        >
          <ChevronRight
            className={`wapp-conversation-workspace-chevron${expanded ? " is-open" : ""}`}
            aria-hidden
          />
        </button>
        <button
          type="button"
          className="wapp-conversation-workspace-main"
          title={workspace.path || label}
          onClick={() => {
            if (!isActive && onSelectWorkspace) {
              void Promise.resolve(onSelectWorkspace(workspace.id));
            }
            if (!expanded) onToggleExpanded(workspace.id);
          }}
        >
          <span className="wapp-conversation-workspace-title">{label}</span>
          {isConnecting ? (
            <span className="wapp-conversation-workspace-meta">连接中...</span>
          ) : null}
        </button>
        <div className="wapp-conversation-workspace-actions">
          <button
            type="button"
            className="wapp-conversation-workspace-action"
            disabled={newTaskDisabled}
            aria-label="新建对话"
            title="新建对话"
            onClick={(event) => {
              event.stopPropagation();
              // Leave assets/settings/etc. so the new session chat is visible
              // (same as top 「新建对话」 and clicking an existing session).
              onSurfaceChange("agents");
              if (!isActive && onSelectWorkspace) {
                void Promise.resolve(onSelectWorkspace(workspace.id)).then((ok) => {
                  if (ok === false) return;
                  onCreateTaskInWorkspace(workspace.id);
                });
                return;
              }
              onCreateTaskInWorkspace(workspace.id);
            }}
          >
            <MessageSquarePlus aria-hidden />
          </button>
          {onForgetWorkspace ? (
            <button
              type="button"
              className="wapp-conversation-workspace-action is-danger"
              aria-label="删除项目"
              title="删除项目"
              onClick={(event) => {
                event.stopPropagation();
                onForgetWorkspace(workspace.id);
              }}
            >
              <Trash2 aria-hidden />
            </button>
          ) : null}
          <span className="wapp-conversation-workspace-count">
            {filterVisibleWodeAppSessions(group.sessions).length}
          </span>
        </div>
      </div>

      {expanded ? (
        <div className="wapp-conversation-workspace-body">
          <WorkspaceSessionListBody
            group={group}
            sessionsLoading={sessionsLoading}
            showAllSessions={showAllSessions}
            rowProps={rowProps}
            onToggleShowAll={onToggleShowAll}
            onToggleSessionGroup={onToggleSessionGroup}
          />
        </div>
      ) : null}
    </div>
  );
}

export function WodeAppWorkbenchSidebar(props: WodeAppWorkbenchSidebarProps) {
  const [agentsSubtreeOpen, setAgentsSubtreeOpen] = React.useState(true);
  const [assetSurfaceMode, setAssetSurfaceMode] = React.useState<WodeAppAssetSurfaceMode>("library");
  const [expandedSessionIds, setExpandedSessionIds] = React.useState<Set<string>>(() => new Set());
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = React.useState<Set<string>>(
    () => new Set(props.selectedWorkspaceId ? [props.selectedWorkspaceId] : []),
  );
  const [showAllSessionsByWorkspace, setShowAllSessionsByWorkspace] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [sessionActionId, setSessionActionId] = React.useState<string | null>(null);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [renameTitle, setRenameTitle] = React.useState("");
  const [renameBusy, setRenameBusy] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleteBusy, setDeleteBusy] = React.useState(false);
  const [createGroupOpen, setCreateGroupOpen] = React.useState(false);
  const [createGroupWorkspaceId, setCreateGroupWorkspaceId] = React.useState<string | null>(null);
  const [createGroupLabel, setCreateGroupLabel] = React.useState("");

  const pinnedSessionIds = usePinnedSessionIds();
  const homeConversationGroup = React.useMemo(
    () => props.workspaceSessionGroups.find((group) => isHomeConversationWorkspace(group.workspace)) ?? null,
    [props.workspaceSessionGroups],
  );
  const suporWorkspaceGroup = React.useMemo(
    () => props.workspaceSessionGroups.find((group) => isSuporWorkspaceLike(group.workspace)) ?? null,
    [props.workspaceSessionGroups],
  );
  /** Whole app is the Supor desk — not a brand agent you toggle into. */
  const inSuporProductDesk = Boolean(props.productDeskIsSupor);
  const folderWorkspaceGroups = React.useMemo(() => {
    const folders = props.workspaceSessionGroups.filter((group) => {
      if (isHomeConversationWorkspace(group.workspace)) return false;
      // 苏泊尔经营台与主仓自进化隔离：不展示 wodeapp（自进化）及其会话分组（如「狼」）。
      if (
        inSuporProductDesk
        && isSelfEvolveWorkspaceLike(group.workspace)
        && !isSuporWorkspaceLike(group.workspace)
      ) {
        return false;
      }
      return true;
    });
    // Keep create-project available; pin Supor / self-evolve first.
    return [...folders].sort((left, right) => {
      const rank = (workspace: WorkspaceSessionGroup["workspace"]) => {
        if (isSuporWorkspaceLike(workspace)) return 0;
        if (isSelfEvolveWorkspaceLike(workspace)) return 1;
        return 2;
      };
      return rank(left.workspace) - rank(right.workspace);
    });
  }, [inSuporProductDesk, props.workspaceSessionGroups]);
  const homeWorkspaceId = homeConversationGroup?.workspace.id ?? null;
  // 「最近」只列首页/非项目对话；已挂在「项目」下的工作区会话不再重复出现。
  const recentConversationGroup = homeConversationGroup;
  const recentWorkspaceId = recentConversationGroup?.workspace.id ?? null;
  const primarySuporWorkspaceId = suporWorkspaceGroup?.workspace.id ?? null;
  const recentSessionGroupsState = useWorkspaceGroups(recentWorkspaceId ?? "");
  const recentCollapsedGroupIds = useSessionManagementStore(
    (state) => selectWodeAppCollapsedGroupIds(state.groupsByWorkspace, recentWorkspaceId ?? ""),
  );
  const showSessionActions = true;

  const capabilityNavItems = React.useMemo(
    () => props.builtinAgents.filter((agent) =>
      agent.kind === "capability" || agent.kind === "integration"),
    [props.builtinAgents],
  );
  /**
   * Default desk no longer surfaces the shipped/demo Supor brand agent.
   * Supor remains available via skin / product desk; brand-agents.json can still load it.
   */
  const brandNavItems = React.useMemo(
    () => [] as Array<{ id: string; name: string; meta: string }>,
    [],
  );
  const hasAgentsSubtree =
    capabilityNavItems.length > 0 || brandNavItems.length > 0;

  React.useEffect(() => {
    if (!props.selectedWorkspaceId) return;
    setExpandedWorkspaceIds((current) => {
      if (current.has(props.selectedWorkspaceId)) return current;
      const next = new Set(current);
      next.add(props.selectedWorkspaceId);
      return next;
    });
  }, [props.selectedWorkspaceId]);

  const recentRowProps = React.useMemo(
    () => ({
      selectedSessionId: props.selectedSessionId,
      sessionStatusById: props.sessionStatusById,
      pinnedSessionIds,
      showSessionActions,
      onSurfaceChange: props.onSurfaceChange,
      onOpenSession: props.onOpenSession,
      onPrefetchSession: props.onPrefetchSession,
    }),
    [
      pinnedSessionIds,
      props.onOpenSession,
      props.onPrefetchSession,
      props.onSurfaceChange,
      props.selectedSessionId,
      props.sessionStatusById,
      showSessionActions,
    ],
  );

  const toggleWorkspaceExpanded = React.useCallback((workspaceId: string) => {
    setExpandedWorkspaceIds((current) => {
      const next = new Set(current);
      if (next.has(workspaceId)) next.delete(workspaceId);
      else next.add(workspaceId);
      return next;
    });
  }, []);

  const toggleShowAllSessions = React.useCallback((workspaceId: string) => {
    setShowAllSessionsByWorkspace((current) => {
      const next = new Set(current);
      if (next.has(workspaceId)) next.delete(workspaceId);
      else next.add(workspaceId);
      return next;
    });
  }, []);

  const toggleRecentGroup = React.useCallback((workspaceId: string, groupId: string) => {
    useSessionManagementStore.getState().toggleGroupExpanded(workspaceId, groupId);
  }, []);

  const ensureRecentWorkspaceSelected = React.useCallback(() => {
    if (!recentWorkspaceId) return;
    if (recentWorkspaceId === props.selectedWorkspaceId) return;
    void Promise.resolve(props.onSelectWorkspace?.(recentWorkspaceId));
  }, [props, recentWorkspaceId]);

  const exitSuporIsolation = React.useCallback(() => {
    // Product desk is always Supor; 默认智能体 only clears capability selection.
    props.onExitBrandIsolation?.();
  }, [props]);

  React.useEffect(() => {
    const onAssetSurfaceMode = (event: Event) => {
      const mode = (event as CustomEvent<WodeAppAssetSurfaceModeEventDetail>).detail?.mode;
      setAssetSurfaceMode(mode === "generation-history" ? "generation-history" : "library");
    };
    window.addEventListener(WODEAPP_ASSET_SURFACE_MODE_EVENT, onAssetSurfaceMode);
    return () => window.removeEventListener(WODEAPP_ASSET_SURFACE_MODE_EVENT, onAssetSurfaceMode);
  }, []);

  const sessionActionTitle = React.useMemo(
    () => (sessionActionId ? sessionTitleForId(props.workspaceSessionGroups, sessionActionId) : ""),
    [props.workspaceSessionGroups, sessionActionId],
  );

  const sidebarContextValue = React.useMemo(
    () => ({
      selectedWorkspaceId: props.selectedWorkspaceId,
      selectedSessionId: props.selectedSessionId,
      developerMode: false,
      showSessionActions,
      sessionStatusById: props.sessionStatusById,
      newTaskDisabled: props.newTaskDisabled,
      connectingWorkspaceId: props.connectingWorkspaceId ?? null,
      workspaceConnectionStateById: props.workspaceConnectionStateById ?? {},
      onSelectWorkspace: props.onSelectWorkspace ?? (() => false),
      onOpenSession: props.onOpenSession,
      onPrefetchSession: props.onPrefetchSession,
      onCreateTaskInWorkspace: props.onCreateTaskInWorkspace,
      onCreateTaskWithPrompt: props.onCreateTaskWithPrompt,
      onOpenRenameSession: props.onRenameSession
        ? (sessionId: string) => {
            setSessionActionId(sessionId);
            setRenameTitle(sessionTitleForId(props.workspaceSessionGroups, sessionId));
            setRenameOpen(true);
          }
        : undefined,
      onOpenDeleteSession: props.onDeleteSession
        ? (sessionId: string) => {
            setSessionActionId(sessionId);
            // Let dropdown/context menu release body pointer-events before the dialog mounts.
            window.setTimeout(() => {
              if (typeof document !== "undefined") {
                document.body.style.pointerEvents = "";
              }
              setDeleteOpen(true);
            }, 0);
          }
        : undefined,
      onCompactSession: props.onCompactSession,
      onArchiveSession: props.onArchiveSession,
      onOpenCreateGroupModal: (workspaceId: string) => {
        setCreateGroupWorkspaceId(workspaceId);
        setCreateGroupLabel("");
        setCreateGroupOpen(true);
      },
      onOpenRenameWorkspace: props.onOpenRenameWorkspace ?? (() => {}),
      onShareWorkspace: props.onShareWorkspace ?? (() => {}),
      onRevealWorkspace: props.onRevealWorkspace ?? (() => {}),
      onRecoverWorkspace: props.onRecoverWorkspace ?? (async () => false),
      onTestWorkspaceConnection: props.onTestWorkspaceConnection ?? (async () => false),
      onEditWorkspaceConnection: props.onEditWorkspaceConnection ?? (() => {}),
      onForgetWorkspace: props.onForgetWorkspace ?? (() => {}),
      openworkServerClient: null,
      expandWorkspace: (workspaceId: string) => {
        setExpandedWorkspaceIds((current) => new Set(current).add(workspaceId));
      },
      toggleWorkspaceExpanded,
      toggleSessionExpanded: (sessionId: string) => {
        setExpandedSessionIds((current) => {
          const next = new Set(current);
          if (next.has(sessionId)) next.delete(sessionId);
          else next.add(sessionId);
          return next;
        });
      },
      expandedWorkspaceIds,
      expandedSessionIds,
    }),
    [
      expandedSessionIds,
      expandedWorkspaceIds,
      props,
      showSessionActions,
      toggleWorkspaceExpanded,
    ],
  );

  const handleNewChat = () => {
    if (props.newTaskDisabled) return;
    props.onSurfaceChange("agents");
    // 有项目（如苏泊尔经营台）时落到项目；没有项目时落到「最近」对应的首页工作区。
    const workspaceId = inSuporProductDesk
      ? (primarySuporWorkspaceId ?? homeWorkspaceId ?? props.selectedWorkspaceId)
      : props.selectedWorkspaceId;
    props.onCreateTaskInWorkspace(workspaceId);
  };

  const canCreateProject = Boolean(
    props.onCreateBlankWorkspace
      || props.onOpenExistingFolderWorkspace
      || props.onOpenCreateWorkspace,
  );

  const handleCreateBlankProject = () => {
    if (props.createWorkspaceBusy) return;
    if (props.onCreateBlankWorkspace) {
      void props.onCreateBlankWorkspace();
      return;
    }
    props.onOpenCreateWorkspace?.();
  };

  const handleUseExistingFolder = () => {
    if (props.createWorkspaceBusy) return;
    if (props.onOpenExistingFolderWorkspace) {
      void props.onOpenExistingFolderWorkspace();
      return;
    }
    props.onOpenCreateWorkspace?.();
  };

  const handleNewHomeChat = () => {
    if (props.newTaskDisabled) return;
    props.onSurfaceChange("agents");
    // 「最近」新建始终进入非项目首页工作区，不会进项目列表。
    props.onCreateTaskInWorkspace(
      homeWorkspaceId ?? props.selectedWorkspaceId,
    );
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
    <SidebarContext.Provider value={sidebarContextValue}>
      <aside className="wapp-sidebar">
        <div className="wapp-sidebar-top">
          <div className="wapp-brand wapp-brand-spacer mac:titlebar-drag" aria-hidden>
            {props.skin && THEME_BRAND_AVATAR_SRC[props.skin] ? (
              <img
                className="wapp-theme-brand-avatar"
                src={THEME_BRAND_AVATAR_SRC[props.skin]}
                alt=""
                width={64}
                height={64}
                decoding="async"
              />
            ) : null}
          </div>

          <button
            type="button"
            className="wapp-new-chat"
            onClick={handleNewChat}
            disabled={props.newTaskDisabled}
          >
            <MessageSquarePlus aria-hidden />
            新建对话
          </button>
        </div>

        <div className="wapp-sidebar-scroll">
          <nav className="wapp-nav" aria-label="工作台导航">
            {WODEAPP_NAV_ITEMS.map(({ id, label }) => {
              const Icon = NAV_ICONS[id];
              const showAgentsSubtree = id === "agents" && hasAgentsSubtree;
              return (
                <React.Fragment key={id}>
                  <div className={`wapp-nav-row${showAgentsSubtree ? " has-subtree" : ""}`}>
                    <button
                      type="button"
                      className={`wapp-nav-item${props.activeSurface === id ? " is-active" : ""}${showAgentsSubtree ? " has-toggle" : ""}`}
                      onClick={() => {
                        if (id === "assets") requestWodeAppAssetSurfaceMode("library");
                        if (id === "agents") exitSuporIsolation();
                        props.onSurfaceChange(id);
                      }}
                    >
                      <Icon className="wapp-nav-icon" aria-hidden />
                      <span>{label}</span>
                    </button>
                    {showAgentsSubtree ? (
                      <button
                        type="button"
                        className={`wapp-nav-toggle${agentsSubtreeOpen ? " is-open" : ""}`}
                        aria-label={agentsSubtreeOpen ? "折叠智能体" : "展开智能体"}
                        aria-expanded={agentsSubtreeOpen}
                        onClick={() => setAgentsSubtreeOpen((open) => !open)}
                      >
                        <ChevronRight aria-hidden />
                      </button>
                    ) : null}
                  </div>
                  {showAgentsSubtree && agentsSubtreeOpen ? (
                    <div className="wapp-nav-subtree" aria-label="智能体分组">
                      {capabilityNavItems.length > 0 ? (
                        <div className="wapp-nav-agent-group" aria-label="能力智能体">
                          {capabilityNavItems.map((agent) => (
                            <button
                              key={agent.id}
                              type="button"
                              className={`wapp-nav-subitem${props.selectedRuntimeProjectId === agent.id ? " is-active" : ""}`}
                              onClick={() => props.onSelectRuntimeProject(agent.id)}
                            >
                              <span className="wapp-nav-subitem-title">{agent.name}</span>
                              <span className="wapp-nav-subitem-meta">{agent.meta}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {brandNavItems.length > 0 ? (
                        <div className="wapp-nav-agent-group" aria-label="品牌智能体">
                          <p className="wapp-nav-agent-group-label">品牌</p>
                          {brandNavItems.map((agent) => (
                            <button
                              key={agent.id}
                              type="button"
                              className={`wapp-nav-subitem${props.selectedRuntimeProjectId === agent.id ? " is-active" : ""}`}
                              onClick={() => props.onSelectRuntimeProject(agent.id)}
                            >
                              <span className="wapp-nav-subitem-title">{agent.name}</span>
                              <span className="wapp-nav-subitem-meta">{agent.meta}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  {id === "assets" ? (
                    <div className="wapp-nav-subtree is-assets" aria-label="数字资产快捷入口">
                      <button
                        type="button"
                        className={`wapp-nav-subitem${props.activeSurface === "assets" && assetSurfaceMode === "generation-history" ? " is-active" : ""}`}
                        onClick={() => {
                          requestWodeAppAssetSurfaceMode("generation-history");
                          props.onSurfaceChange("assets");
                        }}
                      >
                        <span className="wapp-nav-subitem-title">
                          <History aria-hidden />
                          <span>生成历史</span>
                        </span>
                        <span className="wapp-nav-subitem-meta">按类型查看记录</span>
                      </button>
                    </div>
                  ) : null}
                </React.Fragment>
              );
            })}
          </nav>

          <section className="wapp-sidebar-section">
            <div className="wapp-sidebar-label-row">
              <p className="wapp-sidebar-label">项目</p>
              {inSuporProductDesk ? (
                <button
                  type="button"
                  className="wapp-workspace-add"
                  onClick={handleNewChat}
                  disabled={props.newTaskDisabled}
                  aria-label="新建对话"
                  title="新建对话"
                >
                  <MessageSquarePlus aria-hidden />
                  <span>新建</span>
                </button>
              ) : canCreateProject ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    disabled={props.createWorkspaceBusy}
                    render={
                      <button
                        type="button"
                        className="wapp-workspace-add"
                        aria-label="新建项目"
                        title="新建项目"
                        disabled={props.createWorkspaceBusy}
                      >
                        {props.createWorkspaceBusy ? (
                          <Loader2 aria-hidden className="animate-spin" />
                        ) : (
                          <FolderPlus aria-hidden />
                        )}
                        <span>{props.createWorkspaceBusy ? "创建中" : "新建"}</span>
                      </button>
                    }
                  />
                  <DropdownMenuContent align="end" side="bottom" sideOffset={6} className="w-52">
                    <DropdownMenuItem
                      disabled={props.createWorkspaceBusy}
                      onClick={handleCreateBlankProject}
                    >
                      <Plus className="size-4" />
                      新建空白项目
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={props.createWorkspaceBusy}
                      onClick={handleUseExistingFolder}
                    >
                      <Folder className="size-4" />
                      使用现有文件夹
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
            {folderWorkspaceGroups.length > 0 ? (
              <div className="wapp-conversation-list" role="list">
                {folderWorkspaceGroups.map((group) => {
                  // 苏泊尔经营台整站即项目，不再套一层「苏泊尔经营台（自进化）」折叠框。
                  if (inSuporProductDesk && isSuporWorkspaceLike(group.workspace)) {
                    return (
                      <FlatWorkspaceConversationList
                        key={group.workspace.id}
                        group={group}
                        selectedWorkspaceId={props.selectedWorkspaceId}
                        sessionsLoading={
                          props.sessionsLoading && group.workspace.id === props.selectedWorkspaceId
                        }
                        showAllSessions={showAllSessionsByWorkspace.has(group.workspace.id)}
                        rowProps={recentRowProps}
                        onSelectWorkspace={props.onSelectWorkspace}
                        onForgetWorkspace={props.onForgetWorkspace}
                        onToggleShowAll={toggleShowAllSessions}
                        onToggleSessionGroup={toggleRecentGroup}
                      />
                    );
                  }
                  return (
                    <WorkspaceConversationBlock
                      key={group.workspace.id}
                      group={group}
                      selectedWorkspaceId={props.selectedWorkspaceId}
                      sessionsLoading={props.sessionsLoading && group.workspace.id === props.selectedWorkspaceId}
                      connectingWorkspaceId={props.connectingWorkspaceId}
                      expanded={expandedWorkspaceIds.has(group.workspace.id)}
                      showAllSessions={showAllSessionsByWorkspace.has(group.workspace.id)}
                      newTaskDisabled={props.newTaskDisabled}
                      rowProps={recentRowProps}
                      onToggleExpanded={toggleWorkspaceExpanded}
                      onSelectWorkspace={props.onSelectWorkspace}
                      onSurfaceChange={props.onSurfaceChange}
                      onCreateTaskInWorkspace={props.onCreateTaskInWorkspace}
                      onForgetWorkspace={props.onForgetWorkspace}
                      onToggleShowAll={toggleShowAllSessions}
                      onToggleSessionGroup={toggleRecentGroup}
                    />
                  );
                })}
              </div>
            ) : (
              <p className="wapp-sidebar-muted">
                {inSuporProductDesk
                  ? "暂无对话。点上方「新建对话」开始。"
                  : "暂无项目。自进化请点「新建」→「使用现有文件夹」选择本机 wodeapp 仓库根；开发版或本机已有常见克隆路径时会自动挂载「wodeapp（自进化）」。"}
              </p>
            )}
          </section>

          <section className="wapp-sidebar-section">
            <div className="wapp-sidebar-label-row">
              <p className="wapp-sidebar-label">最近</p>
              <button
                type="button"
                className="wapp-workspace-add"
                onClick={handleNewHomeChat}
                disabled={props.newTaskDisabled}
                aria-label="新建对话"
                title="新建对话"
              >
                <MessageSquarePlus aria-hidden />
                <span>新建</span>
              </button>
            </div>
            <div className="wapp-home-conversation-list">
              {recentConversationGroup ? (
                <div
                  className={`wapp-home-conversations${props.selectedWorkspaceId === recentWorkspaceId ? " is-active" : ""}`}
                  onFocusCapture={ensureRecentWorkspaceSelected}
                >
                  {renderSessionList({
                    sessions: recentConversationGroup.sessions,
                    workspaceId: recentConversationGroup.workspace.id,
                    sessionsLoading:
                      props.sessionsLoading && props.selectedWorkspaceId === recentWorkspaceId,
                    showAllSessions: showAllSessionsByWorkspace.has(recentConversationGroup.workspace.id),
                    sessionGroups: recentSessionGroupsState.groups,
                    assignments: recentSessionGroupsState.assignments,
                    collapsedGroupIds: recentCollapsedGroupIds,
                    rowProps: {
                      ...recentRowProps,
                      onOpenSession: (workspaceId, sessionId) => {
                        ensureRecentWorkspaceSelected();
                        props.onOpenSession(workspaceId, sessionId);
                      },
                    },
                    onToggleShowAll: () => toggleShowAllSessions(recentConversationGroup.workspace.id),
                    onToggleSessionGroup: (groupId) => {
                      ensureRecentWorkspaceSelected();
                      toggleRecentGroup(recentConversationGroup.workspace.id, groupId);
                    },
                    emptyLabel: "暂无对话",
                  })}
                </div>
              ) : (
                <p className="wapp-sidebar-muted">暂无对话</p>
              )}
            </div>
          </section>
        </div>

        <WodeAppAccountFooter
          onOpenAccountPage={() => props.onSurfaceChange("account")}
        />
      </aside>

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
              if (e.key === "Enter" && createGroupLabel.trim() && createGroupWorkspaceId) {
                useSessionManagementStore.getState().createGroup(createGroupWorkspaceId, createGroupLabel.trim());
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
                if (createGroupWorkspaceId) {
                  useSessionManagementStore.getState().createGroup(createGroupWorkspaceId, createGroupLabel.trim());
                }
                setCreateGroupOpen(false);
              }}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarContext.Provider>
  );
}
