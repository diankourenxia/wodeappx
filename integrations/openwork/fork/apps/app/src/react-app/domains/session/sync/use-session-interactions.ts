// Pending permissions, questions, and todos for the selected session:
// query-cache subscriptions, snapshot seeding, and reply handlers.
// Extracted verbatim from session-route.tsx (cluster had no readers of its
// internals besides the JSX).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { unwrap } from "@/app/lib/opencode";
import type { Client, PendingPermission, PendingQuestion, TodoItem } from "@/app/types";
import { t } from "@/i18n";
import { getReactQueryClient } from "@/react-app/infra/query-client";
import { useQueryCacheState } from "@/react-app/infra/query-cache-state";
import { describeRouteError } from "@/react-app/shell/route-workspaces";
import {
  permissionKey,
  questionKey,
  seedPermissionState,
  seedQuestionState,
  todoKey,
} from "./session-sync";
import { useLocal } from "@/react-app/kernel/local-provider";
import {
  DEFAULT_EXTERNAL_DIRECTORY_ACCESS,
  normalizeExternalDirectoryAccessMode,
  syncExternalDirectoryAccessMode,
} from "@/react-app/domains/wodeapp/wodeapp-external-directory-access";

const emptyPendingPermissions: PendingPermission[] = [];
const emptyPendingQuestions: PendingQuestion[] = [];
const emptyTodos: TodoItem[] = [];

type AuthorizedFoldersClient = {
  listAuthorizedFolders: (workspaceId: string) => Promise<{ folders: string[] }>;
  setAuthorizedFolders: (
    workspaceId: string,
    folders: string[],
  ) => Promise<{ folders: string[] }>;
};

export type UseSessionInteractionsInput = {
  client: Client | null;
  workspaceId: string;
  sessionId: string | null;
  workspaceRoot: string;
  /** Child / related session ids whose pending asks should surface on this session. */
  relatedSessionIds?: string[];
  /** OpenWork workspace client — used to persist external_directory on "always". */
  openworkClient?: AuthorizedFoldersClient | null;
  openworkWorkspaceId?: string | null;
};

function normalizeFolderPath(raw: string): string | null {
  let value = raw.trim().replace(/\\/g, "/");
  if (!value) return null;
  value = value.replace(/\/+\*\*?$/, "").replace(/\/+$/, "");
  if (!value) return null;
  // Drop trailing file segments when metadata includes a file path.
  const basename = value.split("/").pop() ?? "";
  if (basename.includes(".") && !basename.startsWith(".")) {
    const parent = value.slice(0, value.lastIndexOf("/"));
    return parent || value;
  }
  return value;
}

function foldersFromPermission(permission: PendingPermission): string[] {
  const folders = new Set<string>();
  const add = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const folder = normalizeFolderPath(raw);
    if (folder) folders.add(folder);
  };

  for (const pattern of permission.patterns ?? []) add(pattern);
  for (const resource of permission.v2?.resources ?? []) add(resource);
  for (const save of permission.v2?.save ?? []) add(save);
  if (Array.isArray(permission.always)) {
    for (const item of permission.always) add(item);
  }

  const metadata =
    permission.metadata && typeof permission.metadata === "object"
      ? (permission.metadata as Record<string, unknown>)
      : {};
  add(metadata.parentDir);
  add(metadata.path);
  add(metadata.filepath);
  add(metadata.filePath);
  add(metadata.target);
  add(metadata.cwd);

  // Desktop writes often ask for a nested output folder; also authorize Desktop
  // so later ~/Desktop/<other> paths do not re-prompt in the same workspace.
  for (const folder of [...folders]) {
    const match = folder.match(/^(.*?\/Desktop)(?:\/|$)/i);
    if (match?.[1]) folders.add(match[1]);
  }

  return [...folders];
}

async function persistExternalDirectoryAllow(options: {
  openworkClient: AuthorizedFoldersClient;
  openworkWorkspaceId: string;
  permission: PendingPermission;
}) {
  const nextFolders = foldersFromPermission(options.permission);
  if (nextFolders.length === 0) return;

  const current = await options.openworkClient.listAuthorizedFolders(options.openworkWorkspaceId);
  const merged = new Set(current.folders ?? []);
  let added = 0;
  for (const folder of nextFolders) {
    if (merged.has(folder)) continue;
    merged.add(folder);
    added += 1;
  }
  if (added === 0) return;

  const response = await options.openworkClient.setAuthorizedFolders(
    options.openworkWorkspaceId,
    [...merged],
  );
  const label = nextFolders.map((folder) => folder.split("/").pop() || folder).join("、");
  toast.success(t("session.permission_folder_authorized", undefined, { folder: label }), {
    description: response.folders.slice(-3).join("\n"),
  });
}

export function useSessionInteractions(input: UseSessionInteractionsInput) {
  const {
    client,
    workspaceId,
    sessionId,
    workspaceRoot,
    relatedSessionIds = [],
    openworkClient = null,
    openworkWorkspaceId = null,
  } = input;
  const local = useLocal();
  const externalDirectoryAccess = normalizeExternalDirectoryAccessMode(
    local.prefs.externalDirectoryAccess ?? DEFAULT_EXTERNAL_DIRECTORY_ACCESS,
  );

  const [permissionReplyBusy, setPermissionReplyBusy] = useState(false);
  const permissionReplyBusyRef = useRef(false);
  const [questionReplyBusy, setQuestionReplyBusy] = useState(false);
  const questionReplyBusyRef = useRef(false);

  const relatedSessionIdsKey = relatedSessionIds.join("\0");
  const stableRelatedSessionIds = useMemo(
    () => relatedSessionIds.map((id) => id.trim()).filter(Boolean),
    // relatedSessionIdsKey keeps referential churn from parent arrays stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [relatedSessionIdsKey],
  );

  const permissionQueryKey = useMemo(
    () => (workspaceId && sessionId ? permissionKey(workspaceId, sessionId) : null),
    [sessionId, workspaceId],
  );
  const pendingPermissions = useQueryCacheState<PendingPermission[]>(
    permissionQueryKey,
    emptyPendingPermissions,
  );
  const questionQueryKey = useMemo(
    () => (workspaceId && sessionId ? questionKey(workspaceId, sessionId) : null),
    [sessionId, workspaceId],
  );
  const pendingQuestions = useQueryCacheState<PendingQuestion[]>(
    questionQueryKey,
    emptyPendingQuestions,
  );
  const todoQueryKey = useMemo(
    () => (workspaceId && sessionId ? todoKey(workspaceId, sessionId) : null),
    [sessionId, workspaceId],
  );
  const todos = useQueryCacheState<TodoItem[]>(todoQueryKey, emptyTodos);

  useEffect(() => {
    if (!client || !workspaceId || !sessionId) return;
    let cancelled = false;
    const directory = workspaceRoot || undefined;
    void (async () => {
      const snapshotStartedAt = Date.now();
      try {
        const list: Parameters<typeof seedPermissionState>[2] = [];
        let readSucceeded = false;
        try {
          list.push(...unwrap(await client.permission.list({ directory })));
          readSucceeded = true;
        } catch {
          // Older/newer OpenCode permission APIs can fail independently.
        }
        try {
          list.push(...unwrap(await client.v2.session.permission.list({ sessionID: sessionId })).data);
          readSucceeded = true;
        } catch {
          // Keep the legacy snapshot if the v2 endpoint is unavailable.
        }
        if (!readSucceeded) return;
        if (!cancelled) {
          seedPermissionState(workspaceId, sessionId, list, {
            snapshotStartedAt,
            includeSessionIds: stableRelatedSessionIds,
          });
        }
      } catch {
        // Keep event-synced permission state if the snapshot read fails.
        // Hiding a pending approval can block the running task.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, sessionId, stableRelatedSessionIds, workspaceId, workspaceRoot]);

  useEffect(() => {
    if (!client || !workspaceId || !sessionId) return;
    let cancelled = false;
    const directory = workspaceRoot || undefined;
    void (async () => {
      const snapshotStartedAt = Date.now();
      try {
        const list = unwrap(await client.question.list({ directory }));
        if (!cancelled) {
          seedQuestionState(workspaceId, sessionId, list, {
            snapshotStartedAt,
            includeSessionIds: stableRelatedSessionIds,
          });
        }
      } catch {
        // Keep event-synced question state if the snapshot read fails.
        // Hiding a pending question can block the running task.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, sessionId, stableRelatedSessionIds, workspaceId, workspaceRoot]);

  const activePermission = pendingPermissions[0] ?? null;
  const respondPermission = useCallback(
    async (requestID: string, reply: "once" | "always" | "reject") => {
      if (!client || !workspaceId || !sessionId) return;
      if (permissionReplyBusyRef.current) return;
      permissionReplyBusyRef.current = true;
      setPermissionReplyBusy(true);
      try {
        const pendingPermission = pendingPermissions.find((permission) => permission.id === requestID);
        if (pendingPermission?.protocol === "v2") {
          const result = await client.v2.session.permission.reply({
            sessionID: pendingPermission.sessionID,
            requestID,
            reply,
          });
          if (result.error !== undefined) unwrap(result);
        } else {
          unwrap(
            await client.permission.reply({
              requestID,
              reply,
              directory: workspaceRoot || undefined,
            }),
          );
        }

        // "always" for external_directory only sticks to the engine's exact
        // pattern list; also persist via authorized-folders so Desktop (and
        // siblings) stop re-prompting for this workspace.
        if (
          reply === "always" &&
          pendingPermission &&
          (pendingPermission.permission === "external_directory" ||
            pendingPermission.permission === "bash") &&
          openworkClient &&
          openworkWorkspaceId
        ) {
          try {
            if (externalDirectoryAccess === "full") {
              await syncExternalDirectoryAccessMode({
                mode: "full",
                openworkClient,
                openworkWorkspaceId,
              });
            } else {
              await persistExternalDirectoryAllow({
                openworkClient,
                openworkWorkspaceId,
                permission: pendingPermission,
              });
            }
          } catch (persistError) {
            toast.error(t("session.permission_folder_authorize_failed"), {
              description: describeRouteError(persistError),
            });
          }
        }

        getReactQueryClient().setQueryData<PendingPermission[]>(
          permissionKey(workspaceId, sessionId),
          (current = []) => current.filter((permission) => permission.id !== requestID),
        );
      } catch (error) {
        toast.error(t("app.error_request_failed"), {
          description: describeRouteError(error),
        });
      } finally {
        permissionReplyBusyRef.current = false;
        setPermissionReplyBusy(false);
      }
    },
    [
      client,
      externalDirectoryAccess,
      openworkClient,
      openworkWorkspaceId,
      pendingPermissions,
      sessionId,
      workspaceId,
      workspaceRoot,
    ],
  );

  // Keep workspace OpenCode config aligned with the preferred access mode.
  useEffect(() => {
    if (!openworkClient || !openworkWorkspaceId) return;
    void syncExternalDirectoryAccessMode({
      mode: externalDirectoryAccess,
      openworkClient,
      openworkWorkspaceId,
    }).catch(() => undefined);
  }, [externalDirectoryAccess, openworkClient, openworkWorkspaceId]);

  // Auto-approve external_directory prompts when full access is enabled.
  const autoApprovedPermissionIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (externalDirectoryAccess !== "full") {
      autoApprovedPermissionIdRef.current = null;
      return;
    }
    if (!activePermission) return;
    if (activePermission.permission !== "external_directory") return;
    if (autoApprovedPermissionIdRef.current === activePermission.id) return;
    if (permissionReplyBusyRef.current) return;
    autoApprovedPermissionIdRef.current = activePermission.id;
    void respondPermission(activePermission.id, "always");
  }, [activePermission, externalDirectoryAccess, respondPermission]);

  const activeQuestion = pendingQuestions[0] ?? null;
  const respondQuestion = useCallback(
    async (requestID: string, answers: string[][]) => {
      if (!client || !workspaceId || !sessionId) return;
      if (questionReplyBusyRef.current) return;
      questionReplyBusyRef.current = true;
      setQuestionReplyBusy(true);
      try {
        unwrap(
          await client.question.reply({
            requestID,
            answers,
            directory: workspaceRoot || undefined,
          }),
        );
        getReactQueryClient().setQueryData<PendingQuestion[]>(
          questionKey(workspaceId, sessionId),
          (current = []) => current.filter((question) => question.id !== requestID),
        );
      } catch (error) {
        toast.error(t("app.error_request_failed"), {
          description: describeRouteError(error),
        });
      } finally {
        questionReplyBusyRef.current = false;
        setQuestionReplyBusy(false);
      }
    },
    [client, sessionId, workspaceId, workspaceRoot],
  );

  return {
    activePermission,
    permissionReplyBusy,
    respondPermission,
    activeQuestion,
    questionReplyBusy,
    respondQuestion,
    todos,
  };
}
