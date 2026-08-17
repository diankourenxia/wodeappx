import type { UIMessage } from "ai";
import type { FilePart, Part, PermissionRequest, PermissionV2Request, QuestionRequest, Session, SessionStatus, Todo } from "@opencode-ai/sdk/v2/client";

import { getReactQueryClient } from "../../../infra/query-client";
import { captureAnalyticsEvent, takeTaskRunStart } from "@/app/lib/analytics";
import { trackTaskCompleted, trackTaskFailed } from "@/app/lib/den-telemetry";
import { createClient } from "@/app/lib/opencode";
import { normalizeEvent } from "@/app/utils";
import { SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX, type OpencodeEvent, type PendingPermission, type PendingQuestion } from "@/app/types";
import {
  attachmentDisplayPlaceholderFromTextPart,
  WODEAPP_ATTACHMENT_PLACEHOLDER_URL,
} from "@/react-app/domains/wodeapp/wodeapp-attachment-intelligence";
import {
  SLIM_DATA_URL_MIN_CHARS,
  slimLiveMessagePart,
  slimOpenworkSessionSnapshot,
  slimSessionSummaryDiffs,
} from "@/react-app/domains/wodeapp/wodeapp-session-snapshot-slim";
import {
  assistantOutputMarkGate,
  noteForcedFlush,
  noteTranscriptFlush,
  shouldFlushPartUpdateImmediately,
  shouldFlushSessionStatusImmediately,
} from "@/react-app/domains/wodeapp/wodeapp-session-event-batch";
import {
  getOpencodeCompactionPartId,
  toOpencodeCompactionUIPart,
} from "@/react-app/domains/wodeapp/wodeapp-compaction-history";
import {
  createSessionErrorUIMessage,
  describeOpencodeSessionError,
  openCodeMessageMetadata,
  snapshotToUIMessages,
} from "./usechat-adapter";
import {
  parseDynamicToolUIPart,
  parseStructuredOutputUIPart,
  STRUCTURED_OUTPUT_TOOL,
} from "./parse-tool-parts";
import type { OpenworkSessionSnapshot } from "@/app/lib/openwork-server";
import { applyRevertCursor, reconcileTranscriptMessages } from "./transcript-reconcile";
import { nextHistoryFetchLimit } from "@/components/chat/message-list-history-window";
import {
  useSessionActivityStore,
} from "../status/session-activity-store";
import {
  hangTraceLog,
  noteHangFirstPart,
} from "@/react-app/domains/wodeapp/wodeapp-hang-trace";
import {
  observeLiveAssistantMessage,
  observeLiveAssistantVisibleOutput,
  observeLiveRunStatus,
  observeLiveToolPart,
  seedLiveToolStateFromSnapshot,
} from "../surface/stuck-tool-recovery";

type SyncOptions = {
  workspaceId: string;
  baseUrl: string;
  openworkToken: string;
  onSessionUpdated?: (update: { sessionId: string; info: Record<string, unknown> }) => void;
  onSessionStatus?: (update: { sessionId: string; status: SessionStatus }) => void;
};

type PendingDelta = {
  sessionId: string;
  messageId: string;
  partId: string;
  reasoning: boolean;
  delta: string;
};

type PendingPartUpdate = {
  sessionId: string;
  messageId: string;
  partId: string;
  mapped: UIMessage["parts"][number];
  attachments: UIMessage["parts"][number][];
  pendingSeedText?: string;
  /** Unflushed message.part.delta fragments for this part (rAF buffer). */
  bufferedDeltaText?: string;
};

type SyncEntry = {
  input: SyncOptions;
  refs: number;
  dispose: () => void;
  disposeTimer: ReturnType<typeof setTimeout> | null;
  trackedSessionRefs: Map<string, number>;
  retainedSessionTimers: Map<string, ReturnType<typeof setTimeout>>;
  /** childSessionId → parentSessionId (from session.updated, even when child is untracked). */
  parentBySessionId: Map<string, string>;
  sessionUpdatedListeners: Set<NonNullable<SyncOptions["onSessionUpdated"]>>;
  sessionStatusListeners: Set<NonNullable<SyncOptions["onSessionStatus"]>>;
  pendingDeltas: Map<string, { messageId: string; reasoning: boolean; text: string }>;
  // Coalesce rapid-fire delta + part.updated events into one cache commit per
  // animation frame (PERF-07). Without this, tool/status snapshots each fire
  // setQueryData and starve the main thread on long turns.
  deltaFlushBuffer: PendingDelta[];
  partUpdateBuffer: Map<string, PendingPartUpdate>;
  pendingStatusBySession: Map<string, SessionStatus>;
  transcriptFlushScheduled: boolean;
  /** messageIDs that already emitted hang-trace first_part */
  hangTraceFirstPartSeen: Set<string>;
};

const idleStatus: SessionStatus = { type: "idle" };
const syncs = new Map<string, SyncEntry>();
const retainedSessionTtlMs = 10 * 60_000;
const idleRetainedSessionTtlMs = 10_000;

export const snapshotKey = (workspaceId: string, sessionId: string) =>
  ["react-session-snapshot", workspaceId, sessionId] as const;
export const transcriptKey = (workspaceId: string, sessionId: string) =>
  ["react-session-transcript", workspaceId, sessionId] as const;
export const statusKey = (workspaceId: string, sessionId: string) =>
  ["react-session-status", workspaceId, sessionId] as const;
export const todoKey = (workspaceId: string, sessionId: string) =>
  ["react-session-todos", workspaceId, sessionId] as const;
export const permissionKey = (workspaceId: string, sessionId: string) =>
  ["react-session-permissions", workspaceId, sessionId] as const;
export const questionKey = (workspaceId: string, sessionId: string) =>
  ["react-session-questions", workspaceId, sessionId] as const;

/** Align with MessageList's first-paint window (+small buffer); keep prefetch/mount in sync. */
export const SESSION_SNAPSHOT_MESSAGE_LIMIT = 72;
/** Keep session snapshots warm across rapid history switching. */
export const SESSION_SNAPSHOT_STALE_TIME_MS = 5 * 60_000;

export type LoadEarlierSessionHistoryResult = {
  added: number;
  total: number;
  exhausted: boolean;
  limit: number;
};

type SessionHistoryClient = {
  getSessionMessages: (
    workspaceId: string,
    sessionId: string,
    options?: { limit?: number },
  ) => Promise<{ items: OpenworkSessionSnapshot["messages"] }>;
};

/**
 * Expand the transcript cache past the initial snapshot window by fetching a
 * larger recent-message page (OpenCode returns the newest `limit` messages).
 */
export async function loadEarlierSessionHistory(input: {
  client: SessionHistoryClient;
  workspaceId: string;
  sessionId: string;
  currentCount: number;
  batch?: number;
  max?: number;
}): Promise<LoadEarlierSessionHistoryResult> {
  const workspaceId = input.workspaceId.trim();
  const sessionId = input.sessionId.trim();
  const currentCount = Math.max(0, input.currentCount);
  const limit = nextHistoryFetchLimit(currentCount, input.batch, input.max);
  if (!workspaceId || !sessionId || limit <= currentCount) {
    return { added: 0, total: currentCount, exhausted: true, limit: currentCount };
  }

  const { items } = await input.client.getSessionMessages(workspaceId, sessionId, { limit });
  const queryClient = getReactQueryClient();
  const snapshotMessages = snapshotToUIMessages({
    session: { id: sessionId } as OpenworkSessionSnapshot["session"],
    messages: items,
    todos: [],
    status: { type: "idle" },
  } as OpenworkSessionSnapshot);

  queryClient.setQueryData<UIMessage[]>(transcriptKey(workspaceId, sessionId), (current = []) =>
    reconcileTranscriptMessages({
      currentMessages: current,
      snapshotMessages,
      reason: "snapshot",
    }),
  );

  const total = Math.max(currentCount, items.length);
  return {
    added: Math.max(0, items.length - currentCount),
    total,
    exhausted: items.length < limit,
    limit,
  };
}

type SessionSnapshotClient = {
  getSessionSnapshot: (
    workspaceId: string,
    sessionId: string,
    options?: { limit?: number },
  ) => Promise<{ item: OpenworkSessionSnapshot }>;
};

/**
 * Warm the React Query snapshot (and transcript seed) before a history click.
 * OpenWork already fires this from sidebar hover/focus; WodeApp recent rows
 * should call the same helper so first paint does not wait on a cold fetch.
 */
export function prefetchSessionSnapshot(
  client: SessionSnapshotClient | null | undefined,
  workspaceId: string,
  sessionId: string,
) {
  const nextWorkspaceId = workspaceId.trim();
  const nextSessionId = sessionId.trim();
  if (!client || !nextWorkspaceId || !nextSessionId) return;

  const queryClient = getReactQueryClient();
  void queryClient
    .fetchQuery({
      queryKey: snapshotKey(nextWorkspaceId, nextSessionId),
      queryFn: async () =>
        slimOpenworkSessionSnapshot(
          (
            await client.getSessionSnapshot(nextWorkspaceId, nextSessionId, {
              limit: SESSION_SNAPSHOT_MESSAGE_LIMIT,
            })
          ).item,
        ),
      staleTime: SESSION_SNAPSHOT_STALE_TIME_MS,
    })
    .then((snapshot) => {
      if (snapshot?.session?.id === nextSessionId) {
        seedSessionState(nextWorkspaceId, snapshot);
      }
    })
    .catch(() => undefined);
}

function syncKey(input: SyncOptions) {
  return `${input.workspaceId}:${input.baseUrl}:${input.openworkToken}`;
}

function getErrorStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const record = error as {
    status?: unknown;
    response?: { status?: unknown };
    cause?: { status?: unknown };
  };
  const status = record.status ?? record.response?.status ?? record.cause?.status;
  return typeof status === "number" ? status : null;
}

function shouldRetrySyncSubscribe(error: unknown) {
  const status = getErrorStatus(error);
  return status !== 401 && status !== 403 && status !== 404;
}

function isTrackedSession(entry: SyncEntry, sessionId: string) {
  return (entry.trackedSessionRefs.get(sessionId) ?? 0) > 0 || entry.retainedSessionTimers.has(sessionId);
}

function getSessionUpdatedInfo(event: OpencodeEvent) {
  if (event.type !== "session.updated") return null;
  const props = event.properties;
  if (!props || typeof props !== "object") return null;
  const record = props as { sessionID?: unknown; info?: unknown };
  const info = record.info;
  if (!info || typeof info !== "object") return null;
  const sessionId = typeof record.sessionID === "string"
    ? record.sessionID
    : typeof (info as { id?: unknown }).id === "string"
      ? (info as { id: string }).id
      : "";
  if (!sessionId) return null;
  return { sessionId, info: info as Record<string, unknown> };
}

function isLiveStatus(status: SessionStatus | null | undefined) {
  return status?.type === "busy" || status?.type === "retry";
}

const TERMINAL_ASSISTANT_FINISH_REASONS = new Set([
  "stop",
  "length",
  "content-filter",
  "content_filter",
  "end-turn",
  "end_turn",
  "completed",
]);

function isTerminalAssistantCompletion(info: {
  role?: string;
  time?: { completed?: number };
  finish?: unknown;
  error?: unknown;
}) {
  if (info.role !== "assistant" || info.error) return false;
  if (typeof info.time?.completed !== "number" || typeof info.finish !== "string") return false;
  return TERMINAL_ASSISTANT_FINISH_REASONS.has(info.finish.trim().toLowerCase());
}

function settleSessionRun(entry: SyncEntry, workspaceId: string, sessionId: string) {
  const queryClient = getReactQueryClient();
  const activityStore = useSessionActivityStore.getState();
  const tracked = isTrackedSession(entry, sessionId);
  const previousStatus = tracked
    ? queryClient.getQueryData<SessionStatus>(statusKey(workspaceId, sessionId))
    : undefined;
  const shouldNotify = isLiveStatus(previousStatus) || activityStore.getStatus(workspaceId, sessionId) !== "idle";
  const runStartedAt = takeTaskRunStart(sessionId);
  if (runStartedAt !== null) {
    captureAnalyticsEvent("task_run_completed", {
      duration_ms: Date.now() - runStartedAt,
    });
    trackTaskCompleted(sessionId, Date.now() - runStartedAt);
  }
  activityStore.setRunStatus(workspaceId, sessionId, idleStatus);
  if (tracked) queryClient.setQueryData(statusKey(workspaceId, sessionId), idleStatus);
  if (shouldNotify) {
    for (const listener of entry.sessionStatusListeners) listener({ sessionId, status: idleStatus });
  }
  if (tracked) releaseRetainedSessionSoon(entry.input, entry, sessionId);
}

function messageHasVisibleAssistantOutput(message: UIMessage) {
  if (message.role !== "assistant") return false;
  return message.parts.some((part) => {
    if ("text" in part && typeof part.text === "string") return part.text.trim().length > 0;
    return part.type === "dynamic-tool" || part.type === "file";
  });
}

function assistantOutputAfterLatestUser(messages: UIMessage[]) {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  return messages.slice(lastUserIndex + 1).some(messageHasVisibleAssistantOutput);
}

function assistantCompletedAtAfterLatestUser(messages: OpenworkSessionSnapshot["messages"]) {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.info.role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  for (let index = messages.length - 1; index > lastUserIndex; index -= 1) {
    const info = messages[index]?.info;
    if (info?.role !== "assistant") continue;
    if (typeof info.time?.completed === "number") return info.time.completed;
  }
  return undefined;
}

function sessionIdFromProperties(properties: unknown) {
  if (!properties || typeof properties !== "object") return "";
  const sessionID = (properties as { sessionID?: unknown }).sessionID;
  return typeof sessionID === "string" ? sessionID : "";
}

function sessionErrorFromProperties(properties: unknown) {
  if (!properties || typeof properties !== "object") return undefined;
  return (properties as { error?: unknown }).error;
}

function latestAssistantMessageId(messages: UIMessage[]) {
  // The snapshot keys each error to its errored assistant message id, so the
  // live event must resolve to that same id to dedupe on reload. Skipping
  // synthetic error messages ensures a follow-up error keys off the real
  // assistant turn rather than overwriting the previous error message.
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.role !== "assistant") continue;
    if (message.id.startsWith(SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX)) continue;
    return message.id;
  }
  return null;
}

function partHasVisibleAssistantOutput(part: Part) {
  if (part.type === "text" && part.synthetic) return false;
  if (part.type === "text" && part.ignored) return false;
  const partType = String(part.type);
  if ("text" in part && typeof part.text === "string" && part.text.trim().length > 0) return true;
  return partType === "tool" || partType === "file" || partType === "agent";
}

/** Visible prose for stuck-empty veto — tools must not count as "正文". */
function partHasVisibleProseForRecovery(part: Part) {
  if (part.type !== "text") return false;
  if (part.synthetic || part.ignored) return false;
  return typeof part.text === "string" && part.text.trim().length > 0;
}

function clearTrackedSession(input: SyncOptions, entry: SyncEntry, sessionId: string) {
  entry.trackedSessionRefs.delete(sessionId);
  const retainedTimer = entry.retainedSessionTimers.get(sessionId);
  if (retainedTimer) clearTimeout(retainedTimer);
  entry.retainedSessionTimers.delete(sessionId);
  entry.deltaFlushBuffer = entry.deltaFlushBuffer.filter(
    (item) => item.sessionId !== sessionId,
  );
  for (const [partId, update] of entry.partUpdateBuffer) {
    if (update.sessionId === sessionId) entry.partUpdateBuffer.delete(partId);
  }
  entry.pendingStatusBySession.delete(sessionId);
  // Explicit lifecycle replaces timer GC for transcript (gcTime Infinity).
  // Dropping snapshot too forces a fresh HTTP floor the next time this session
  // is opened — avoids a stale empty create-time snapshot forever blocking
  // welcome-chrome (ses_01562a*).
  const queryClient = getReactQueryClient();
  const workspaceId = input.workspaceId;
  for (const key of [
    permissionKey(workspaceId, sessionId),
    questionKey(workspaceId, sessionId),
    transcriptKey(workspaceId, sessionId),
    snapshotKey(workspaceId, sessionId),
    statusKey(workspaceId, sessionId),
    todoKey(workspaceId, sessionId),
  ]) {
    queryClient.removeQueries({ queryKey: key, exact: true });
  }
  if (entry.refs <= 0 && entry.retainedSessionTimers.size === 0) {
    disposeWorkspaceSync(syncKey(input), entry);
  }
}

function retainSession(input: SyncOptions, entry: SyncEntry, sessionId: string, ttlMs = retainedSessionTtlMs) {
  const existing = entry.retainedSessionTimers.get(sessionId);
  if (existing) clearTimeout(existing);
  entry.retainedSessionTimers.set(sessionId, setTimeout(() => {
    clearTrackedSession(input, entry, sessionId);
  }, ttlMs));
}

function disposeWorkspaceSync(key: string, entry: SyncEntry) {
  if (entry.refs > 0) return;
  if (entry.disposeTimer) {
    clearTimeout(entry.disposeTimer);
    entry.disposeTimer = null;
  }
  for (const timer of entry.retainedSessionTimers.values()) clearTimeout(timer);
  entry.retainedSessionTimers.clear();
  entry.dispose();
  if (syncs.get(key) === entry) syncs.delete(key);
}

function releaseRetainedSessionSoon(input: SyncOptions, entry: SyncEntry, sessionId: string) {
  if (!entry.retainedSessionTimers.has(sessionId)) return;
  retainSession(input, entry, sessionId, idleRetainedSessionTtlMs);
}

type PermissionSeed = PermissionRequest | PermissionV2Request;

function isV2PermissionRequest(permission: PermissionSeed): permission is PermissionV2Request {
  return "action" in permission;
}

function legacyPermissionWithReceivedAt(permission: PermissionRequest, receivedAt: number): PendingPermission {
  return { ...permission, receivedAt, protocol: "legacy" };
}

function v2PermissionKind(action: string): string {
  if (action === "external_directory") return "external_directory";
  if (action.endsWith(".external_directory")) return "external_directory";
  if (action === "file.read") return "read";
  if (action === "file.edit" || action === "file.write") return "edit";
  return action;
}

function v2PermissionWithReceivedAt(permission: PermissionV2Request, receivedAt: number): PendingPermission {
  const metadata: Record<string, unknown> = {
    ...(permission.metadata ?? {}),
    action: permission.action,
  };
  if (permission.save?.length) metadata.save = permission.save.join(", ");
  return {
    id: permission.id,
    sessionID: permission.sessionID,
    permission: v2PermissionKind(permission.action),
    patterns: permission.resources,
    metadata,
    always: permission.save ?? [],
    ...(permission.source ? { tool: { messageID: permission.source.messageID, callID: permission.source.callID } } : {}),
    receivedAt,
    protocol: "v2",
    v2: {
      action: permission.action,
      resources: permission.resources,
      ...(permission.save ? { save: permission.save } : {}),
    },
  };
}

function permissionWithReceivedAt(permission: PermissionSeed, receivedAt: number): PendingPermission {
  return isV2PermissionRequest(permission)
    ? v2PermissionWithReceivedAt(permission, receivedAt)
    : legacyPermissionWithReceivedAt(permission, receivedAt);
}

function questionWithReceivedAt(question: QuestionRequest, receivedAt: number): PendingQuestion {
  return { ...question, receivedAt };
}

function sortPermissions(a: PendingPermission, b: PendingPermission) {
  return a.receivedAt - b.receivedAt || a.id.localeCompare(b.id);
}

function sortQuestions(a: PendingQuestion, b: PendingQuestion) {
  return a.receivedAt - b.receivedAt || a.id.localeCompare(b.id);
}

function allowedSessionIdSet(sessionId: string, includeSessionIds?: string[]) {
  return new Set(
    [sessionId, ...(includeSessionIds ?? [])].map((id) => id.trim()).filter(Boolean),
  );
}

export function seedPermissionState(
  workspaceId: string,
  sessionId: string,
  permissions: PermissionSeed[],
  options: { snapshotStartedAt?: number; includeSessionIds?: string[] } = {},
) {
  const allowed = allowedSessionIdSet(sessionId, options.includeSessionIds);
  useSessionActivityStore.getState().replaceWaitingRequests(
    workspaceId,
    sessionId,
    "permission",
    permissions.flatMap((permission) => (allowed.has(permission.sessionID) ? [permission.id] : [])),
  );
  const queryClient = getReactQueryClient();
  const now = Date.now();
  queryClient.setQueryData<PendingPermission[]>(permissionKey(workspaceId, sessionId), (current = []) => {
    const receivedAtById = new Map(current.map((permission) => [permission.id, permission.receivedAt]));
    const seeded = permissions.flatMap((permission) =>
      allowed.has(permission.sessionID)
        ? [permissionWithReceivedAt(permission, receivedAtById.get(permission.id) ?? now)]
        : [],
    );
    const seededIds = new Set(seeded.map((permission) => permission.id));
    const snapshotStartedAt = options.snapshotStartedAt;
    const liveAfterSnapshot =
      typeof snapshotStartedAt === "number"
        ? current.filter(
            (permission) =>
              allowed.has(permission.sessionID) &&
              permission.receivedAt > snapshotStartedAt &&
              !seededIds.has(permission.id),
          )
        : [];
    return [...seeded, ...liveAfterSnapshot].sort(sortPermissions);
  });
}

export function seedQuestionState(
  workspaceId: string,
  sessionId: string,
  questions: QuestionRequest[],
  options: { snapshotStartedAt?: number; includeSessionIds?: string[] } = {},
) {
  const allowed = allowedSessionIdSet(sessionId, options.includeSessionIds);
  useSessionActivityStore.getState().replaceWaitingRequests(
    workspaceId,
    sessionId,
    "question",
    questions.flatMap((question) => (allowed.has(question.sessionID) ? [question.id] : [])),
  );
  const queryClient = getReactQueryClient();
  const now = Date.now();
  queryClient.setQueryData<PendingQuestion[]>(questionKey(workspaceId, sessionId), (current = []) => {
    const receivedAtById = new Map(current.map((question) => [question.id, question.receivedAt]));
    const seeded = questions.flatMap((question) =>
      allowed.has(question.sessionID)
        ? [questionWithReceivedAt(question, receivedAtById.get(question.id) ?? now)]
        : [],
    );
    const seededIds = new Set(seeded.map((question) => question.id));
    const snapshotStartedAt = options.snapshotStartedAt;
    const liveAfterSnapshot =
      typeof snapshotStartedAt === "number"
        ? current.filter(
            (question) =>
              allowed.has(question.sessionID) &&
              question.receivedAt > snapshotStartedAt &&
              !seededIds.has(question.id),
          )
        : [];
    return [...seeded, ...liveAfterSnapshot].sort(sortQuestions);
  });
}

function fileProviderMetadata(part: FilePart) {
  if (part.source) {
    return { opencode: { partId: part.id, source: part.source } };
  }
  return { opencode: { partId: part.id } };
}

function toFileUIPart(part: FilePart): UIMessage["parts"][number] {
  // Defensive PERF-05 hard limit: even if a caller skips slimLiveMessagePart,
  // fat data URLs must not enter the React Query transcript cache.
  let url = part.url;
  let filename = part.filename;
  if (
    typeof part.url === "string"
    && /^data:/i.test(part.url)
    && part.url.length > SLIM_DATA_URL_MIN_CHARS
  ) {
    filename = (typeof part.filename === "string" && part.filename.trim())
      ? part.filename.trim()
      : "image";
    url = `wodeappx-local:${encodeURIComponent(filename)}`;
  }
  return {
    type: "file",
    url,
    filename: filename || (url === "" ? "image" : part.filename),
    mediaType: part.mime,
    providerMetadata: fileProviderMetadata(part),
  };
}

function toFileSourceUIPart(part: FilePart): UIMessage["parts"][number] | null {
  const source = part.source;
  if (!source) return null;

  const sourceId = `${part.id}:source`;
  const providerMetadata = { opencode: { partId: sourceId, sourcePartId: part.id, source } };

  if (source.type === "resource") {
    if (source.uri.startsWith("http://")) {
      return { type: "source-url", sourceId, url: source.uri, title: source.uri, providerMetadata };
    }
    if (source.uri.startsWith("https://")) {
      return { type: "source-url", sourceId, url: source.uri, title: source.uri, providerMetadata };
    }
    return { type: "source-document", sourceId, mediaType: part.mime, title: source.uri, providerMetadata };
  }

  if (source.type === "symbol") {
    return { type: "source-document", sourceId, mediaType: part.mime, title: source.name, filename: source.path, providerMetadata };
  }

  return { type: "source-document", sourceId, mediaType: part.mime, title: source.path, filename: source.path, providerMetadata };
}

function toFileUIParts(part: FilePart): UIMessage["parts"] {
  const sourcePart = toFileSourceUIPart(part);
  if (sourcePart) return [toFileUIPart(part), sourcePart];
  return [toFileUIPart(part)];
}

function toUIPart(part: Part): UIMessage["parts"][number] | null {
  if (part.type === "text") {
    const attachmentPlaceholder = attachmentDisplayPlaceholderFromTextPart(part);
    if (attachmentPlaceholder) {
      return {
        type: "file",
        mediaType: attachmentPlaceholder.mime,
        filename: attachmentPlaceholder.filename,
        url: attachmentPlaceholder.url || WODEAPP_ATTACHMENT_PLACEHOLDER_URL,
        providerMetadata: { opencode: { partId: part.id, wodeappAttachmentPlaceholder: true } },
      };
    }
    if (part.synthetic || part.ignored) return null;
    return {
      type: "text",
      text: part.text,
      state: "done",
      providerMetadata: { opencode: { partId: part.id } },
    };
  }
  if (part.type === "reasoning") {
    return {
      type: "reasoning",
      text: part.text,
      state: "done",
      providerMetadata: { opencode: { partId: part.id } },
    };
  }
  if (part.type === "file") {
    return toFileUIPart(part);
  }
  if (part.type === "tool") {
    if (part.tool === STRUCTURED_OUTPUT_TOOL) {
      return parseStructuredOutputUIPart(part);
    }
    return parseDynamicToolUIPart(part);
  }
  if (part.type === "agent") {
    return {
      type: "text",
      text: part.name ? `@${part.name}` : "@agent",
      state: "done",
      providerMetadata: { opencode: { partId: part.id } },
    };
  }
  if (part.type === "step-start") return { type: "step-start" };
  // Codex-style collapse marker: keep the boundary so MessageList can fold
  // everything above it into one expandable「已处理 xx」strip.
  if (part.type === "compaction") return toOpencodeCompactionUIPart(part);
  return null;
}

function toUIParts(part: Part): UIMessage["parts"] {
  if (part.type === "file") return toFileUIParts(part);
  const mapped = toUIPart(part);
  if (!mapped) return [];
  if (part.type === "tool" && part.tool === STRUCTURED_OUTPUT_TOOL) return [mapped];
  if (part.type === "tool" && part.state.status === "completed" && part.state.attachments) {
    return [mapped, ...part.state.attachments.flatMap(toFileUIParts)];
  }
  return [mapped];
}

function getPartMetadataId(part: UIMessage["parts"][number]) {
  if (part.type === "dynamic-tool") {
    const metadata = part.callProviderMetadata?.opencode;
    if (!metadata || typeof metadata !== "object") return null;
    return "partId" in metadata ? (metadata as { partId?: string }).partId ?? null : null;
  }
  const compactionPartId = getOpencodeCompactionPartId(part);
  if (compactionPartId) return compactionPartId;
  if (part.type !== "text" && part.type !== "reasoning" && part.type !== "file" && part.type !== "source-url" && part.type !== "source-document") return null;
  const metadata = part.providerMetadata?.opencode;
  if (!metadata || typeof metadata !== "object") return null;
  return "partId" in metadata ? (metadata as { partId?: string }).partId ?? null : null;
}

function upsertMessage(messages: UIMessage[], next: UIMessage) {
  const index = messages.findIndex((message) => message.id === next.id);
  if (index === -1) return [...messages, next];
  return messages.map((message, messageIndex) =>
    messageIndex === index
      ? {
          ...message,
          ...next,
          parts: next.parts.length > 0 ? next.parts : message.parts,
        }
      : message,
  );
}

/**
 * When a message.part.updated or message.part.delta event arrives for a
 * messageID we haven't seen a message.updated for yet, stub the message so
 * the part has somewhere to live.
 *
 * Do not infer role by alternating with the previous message. OpenCode
 * routinely emits consecutive assistant steps (tool → think → tool), and
 * alternation mislabels the next assistant stream as `user` — which is how
 * provider `<think>` text leaked into user bubbles. Cursor/Codex style:
 * streaming stubs default to assistant; `message.updated` overwrites with
 * the authoritative role. User turns show via the optimistic pending bubble
 * until `message.updated` arrives with the real id.
 */
export function stubRoleForUnknownMessage(): UIMessage["role"] {
  return "assistant";
}

function upsertPart(messages: UIMessage[], messageId: string, partId: string, next: UIMessage["parts"][number]) {
  return messages.map((message) => {
    if (message.id !== messageId) return message;
    const index = message.parts.findIndex((part) =>
      ("toolCallId" in part && part.toolCallId === partId) || getPartMetadataId(part) === partId,
    );
    if (index === -1) {
      return { ...message, parts: [...message.parts, next] };
    }
    const parts = message.parts.slice();
    parts[index] = next;
    return { ...message, parts };
  });
}

/**
 * Streaming text/reasoning is cumulative. Deltas often race ahead of
 * `message.part.updated` snapshots; taking a shorter snapshot clobber
 * drops the prefix the user already saw (1./2. vanish, only 3. remains).
 * Prefer the longest same-stream candidate.
 */
export function pickLongestCumulativeText(...candidates: Array<string | null | undefined>): string {
  let best = "";
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || !candidate) continue;
    if (candidate.length < best.length) continue;
    // Same stream: one is a prefix of the other. Prefer the longer.
    // Divergent rewrite (rare mid-stream): still prefer longer to avoid
    // visible vanish; final idle snapshot reload can correct.
    if (!best || candidate.startsWith(best) || best.startsWith(candidate) || candidate.length > best.length) {
      best = candidate;
    }
  }
  return best;
}

/**
 * `message.part.updated` used to drop unflushed `deltaFlushBuffer` rows for the
 * same part under the assumption that the snapshot is cumulative and complete.
 * Deltas often race ahead of that snapshot (classic 1./2./3.「闪没」). Fold the
 * buffered fragments into the live seed instead of discarding them.
 */
export function takeBufferedDeltasForPart<T extends { partId: string; delta: string }>(
  buffer: T[],
  partId: string,
): { remaining: T[]; text: string } {
  if (buffer.length === 0) return { remaining: buffer, text: "" };
  const remaining: T[] = [];
  let text = "";
  for (const item of buffer) {
    if (item.partId === partId) text += item.delta;
    else remaining.push(item);
  }
  return { remaining, text };
}

/** Live stream text that must not lose rAF-buffered deltas to a shorter snapshot. */
export function mergeLiveCumulativeText(input: {
  mappedText?: string | null;
  pendingSeedText?: string | null;
  existingText?: string | null;
  bufferedDeltaText?: string | null;
}): string {
  const mapped = typeof input.mappedText === "string" ? input.mappedText : "";
  const pending = typeof input.pendingSeedText === "string" ? input.pendingSeedText : "";
  const existing = typeof input.existingText === "string" ? input.existingText : "";
  const buffered = typeof input.bufferedDeltaText === "string" ? input.bufferedDeltaText : "";
  const liveBase = existing || pending;
  const liveWithBuffer = buffered ? `${liveBase}${buffered}` : liveBase;
  return pickLongestCumulativeText(mapped, pending, existing, liveWithBuffer);
}

function existingPartText(messages: UIMessage[], messageId: string, partId: string): string {
  const message = messages.find((item) => item.id === messageId);
  if (!message) return "";
  for (const part of message.parts) {
    const id = ("toolCallId" in part && part.toolCallId === partId)
      ? part.toolCallId
      : getPartMetadataId(part);
    if (id !== partId) continue;
    if ((part.type === "text" || part.type === "reasoning") && typeof part.text === "string") {
      return part.text;
    }
  }
  return "";
}

function appendDelta(messages: UIMessage[], messageId: string, partId: string, delta: string, reasoning: boolean) {
  // Fast path: locate the target message by index, only clone that message
  // and its parts array. The previous implementation ran messages.map AND
  // message.parts.map on every delta event, which is O(N * P) per token.
  // For an old session with hundreds of prior messages/parts that allocated
  // thousands of objects per token and crushed the main thread after a
  // handful of tokens.
  const messageIndex = messages.findIndex((message) => message.id === messageId);
  if (messageIndex === -1) return messages;

  const target = messages[messageIndex]!;
  const lastPart = target.parts[target.parts.length - 1];

  let partIndex = -1;
  for (let i = 0; i < target.parts.length; i++) {
    const part = target.parts[i]!;
    const id = getPartMetadataId(part);
    if (reasoning && part.type === "reasoning") {
      if (id === partId || (!id && part === lastPart)) {
        partIndex = i;
        break;
      }
    } else if (!reasoning && part.type === "text") {
      if (id === partId || (!id && part === lastPart)) {
        partIndex = i;
        break;
      }
    }
  }

  let nextParts: UIMessage["parts"];
  if (partIndex === -1) {
    // No existing matching part — append a fresh one so the delta is not lost.
    const newPart: UIMessage["parts"][number] = reasoning
      ? {
          type: "reasoning",
          text: delta,
          state: "streaming" as const,
          providerMetadata: { opencode: { partId } },
        }
      : {
          type: "text",
          text: delta,
          state: "streaming" as const,
          providerMetadata: { opencode: { partId } },
        };
    nextParts = target.parts.slice();
    nextParts.push(newPart);
  } else {
    const existing = target.parts[partIndex]!;
    nextParts = target.parts.slice();
    if (existing.type === "text") {
      nextParts[partIndex] = {
        ...existing,
        text: `${existing.text}${delta}`,
        state: "streaming",
      };
    } else if (existing.type === "reasoning") {
      nextParts[partIndex] = {
        ...existing,
        text: `${existing.text}${delta}`,
        state: "streaming",
      };
    }
  }

  const nextMessages = messages.slice();
  nextMessages[messageIndex] = { ...target, parts: nextParts };
  return nextMessages;
}

export function coalescePendingDeltas(items: PendingDelta[]) {
  if (items.length < 2) return items;

  const ordered: PendingDelta[] = [];
  const byKey = new Map<string, PendingDelta>();
  for (const item of items) {
    const key = `${item.sessionId}\u0000${item.messageId}\u0000${item.partId}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.delta += item.delta;
      existing.reasoning = existing.reasoning || item.reasoning;
      continue;
    }

    const next = { ...item };
    byKey.set(key, next);
    ordered.push(next);
  }
  return ordered;
}

function uiTargetSessionIds(entry: SyncEntry, sessionID: string): string[] {
  const targets = [sessionID];
  const parentID = entry.parentBySessionId.get(sessionID)?.trim();
  if (parentID && parentID !== sessionID) targets.push(parentID);
  return targets;
}

function upsertPendingPermission(
  entry: SyncEntry,
  workspaceId: string,
  targetSessionId: string,
  permission: PermissionSeed,
  receivedAt: number,
) {
  useSessionActivityStore.getState().setWaitingRequest(workspaceId, targetSessionId, "permission", permission.id, true);
  if (!isTrackedSession(entry, targetSessionId)) return;
  const queryClient = getReactQueryClient();
  queryClient.setQueryData<PendingPermission[]>(permissionKey(workspaceId, targetSessionId), (current = []) => {
    const existing = current.find((item) => item.id === permission.id);
    const next = permissionWithReceivedAt(permission, existing?.receivedAt ?? receivedAt);
    if (existing) {
      return current.map((item) => (item.id === permission.id ? next : item)).sort(sortPermissions);
    }
    return [...current, next].sort(sortPermissions);
  });
}

function clearPendingPermission(
  entry: SyncEntry,
  workspaceId: string,
  targetSessionId: string,
  requestID: string,
) {
  useSessionActivityStore.getState().setWaitingRequest(workspaceId, targetSessionId, "permission", requestID, false);
  if (!isTrackedSession(entry, targetSessionId)) return;
  const queryClient = getReactQueryClient();
  queryClient.setQueryData<PendingPermission[]>(permissionKey(workspaceId, targetSessionId), (current = []) =>
    current.filter((permission) => permission.id !== requestID),
  );
}

function upsertPendingQuestion(
  entry: SyncEntry,
  workspaceId: string,
  targetSessionId: string,
  question: QuestionRequest,
  receivedAt: number,
) {
  useSessionActivityStore.getState().setWaitingRequest(workspaceId, targetSessionId, "question", question.id, true);
  if (!isTrackedSession(entry, targetSessionId)) return;
  const queryClient = getReactQueryClient();
  queryClient.setQueryData<PendingQuestion[]>(questionKey(workspaceId, targetSessionId), (current = []) => {
    const existing = current.find((item) => item.id === question.id);
    const next = questionWithReceivedAt(question, existing?.receivedAt ?? receivedAt);
    if (existing) {
      return current.map((item) => (item.id === question.id ? next : item)).sort(sortQuestions);
    }
    return [...current, next].sort(sortQuestions);
  });
}

function clearPendingQuestion(
  entry: SyncEntry,
  workspaceId: string,
  targetSessionId: string,
  requestID: string,
) {
  useSessionActivityStore.getState().setWaitingRequest(workspaceId, targetSessionId, "question", requestID, false);
  if (!isTrackedSession(entry, targetSessionId)) return;
  const queryClient = getReactQueryClient();
  queryClient.setQueryData<PendingQuestion[]>(questionKey(workspaceId, targetSessionId), (current = []) =>
    current.filter((question) => question.id !== requestID),
  );
}

function applyEvent(entry: SyncEntry, workspaceId: string, event: OpencodeEvent) {
  const queryClient = getReactQueryClient();
  const input = entry.input;

  if (event.type === "session.updated") {
    const update = getSessionUpdatedInfo(event);
    if (!update) return;
    const parentID =
      typeof (update.info as { parentID?: unknown }).parentID === "string"
        ? (update.info as { parentID: string }).parentID.trim()
        : "";
    if (parentID) entry.parentBySessionId.set(update.sessionId, parentID);
    else entry.parentBySessionId.delete(update.sessionId);
    if (!isTrackedSession(entry, update.sessionId)) return;
    // Keep the cached snapshot's revert cursor in sync with the server. The
    // renderer derives the visible transcript from this cursor, so a revert
    // (or its cleanup on the next prompt) must reach the snapshot cache or
    // the transcript stays frozen on stale history.
    queryClient.setQueryData<OpenworkSessionSnapshot>(
      snapshotKey(workspaceId, update.sessionId),
      (current) => {
        if (!current) return current;
        const revert = (update.info as { revert?: OpenworkSessionSnapshot["session"]["revert"] }).revert;
        return { ...current, session: { ...current.session, revert } };
      },
    );
    for (const listener of entry.sessionUpdatedListeners) listener(update);
    return;
  }

  if (event.type === "session.deleted") {
    const props = (event.properties ?? {}) as { sessionID?: string; info?: { id?: string } };
    const sessionId = props.sessionID ?? props.info?.id ?? "";
    if (sessionId) useSessionActivityStore.getState().removeSession(workspaceId, sessionId);
    return;
  }

  if (event.type === "session.error") {
    const sessionId = sessionIdFromProperties(event.properties);
    if (sessionId) {
      const errorText = describeOpencodeSessionError(sessionErrorFromProperties(event.properties));
      const runStartedAt = takeTaskRunStart(sessionId);
      if (runStartedAt !== null) {
        captureAnalyticsEvent("task_run_errored", {
          duration_ms: Date.now() - runStartedAt,
        });
        trackTaskFailed(sessionId, Date.now() - runStartedAt);
      }
      useSessionActivityStore.getState().setError(workspaceId, sessionId, errorText);
      if (isTrackedSession(entry, sessionId)) {
        queryClient.setQueryData<UIMessage[]>(transcriptKey(workspaceId, sessionId), (current = []) => {
          // Key the error to the latest assistant turn so it lands beside the
          // turn that failed and a later turn's error becomes its own message
          // instead of overwriting this one. Falls back to the session id when
          // no assistant turn exists yet (e.g. error before any output).
          const turnKey = latestAssistantMessageId(current) ?? sessionId;
          // Note: turnKey matches the snapshot's per-turn key (the errored
          // assistant message id) so a reload reconciles instead of
          // duplicating; the sessionId fallback only applies when the run
          // errored before any assistant message existed.
          return upsertMessage(current, createSessionErrorUIMessage(turnKey, errorText));
        });
      }
    }
    return;
  }

  if (event.type === "session.next.compaction.started") {
    const sessionId = sessionIdFromProperties(event.properties);
    if (sessionId) useSessionActivityStore.getState().setCompacting(workspaceId, sessionId, true);
    return;
  }

  if (event.type === "session.next.compaction.ended" || event.type === "session.compacted") {
    const sessionId = sessionIdFromProperties(event.properties);
    if (sessionId) useSessionActivityStore.getState().setCompacting(workspaceId, sessionId, false);
    return;
  }

  if (event.type === "session.status") {
    const props = (event.properties ?? {}) as { sessionID?: string; status?: SessionStatus };
    if (!props.sessionID || !props.status) return;
    observeLiveRunStatus(props.sessionID, props.status);
    const statusType = (props.status as { type?: string } | null)?.type || String(props.status);
    if (statusType === "busy" || statusType === "retry" || statusType === "idle") {
      hangTraceLog({
        layer: "sync",
        event: statusType === "idle" ? "status.idle" : statusType === "retry" ? "status.retry" : "status.busy",
        sessionId: props.sessionID,
        workspaceId,
        fields: { statusType },
      });
    }
    const tracked = isTrackedSession(entry, props.sessionID);
    if (shouldFlushSessionStatusImmediately(props.status)) {
      flushTranscriptBuffers(entry, workspaceId);
      applySessionStatus(entry, workspaceId, props.sessionID, props.status, { tracked, input });
      noteForcedFlush();
    } else if (tracked || entry.sessionStatusListeners.size > 0) {
      entry.pendingStatusBySession.set(props.sessionID, props.status);
      scheduleTranscriptFlush(entry, workspaceId);
    }
    return;
  }

  if (event.type === "todo.updated") {
    const props = (event.properties ?? {}) as { sessionID?: string; todos?: Todo[] };
    if (!props.sessionID || !props.todos) return;
    if (!isTrackedSession(entry, props.sessionID)) return;
    queryClient.setQueryData(todoKey(workspaceId, props.sessionID), props.todos);
    return;
  }

  if (event.type === "permission.asked") {
    const permission = event.properties as PermissionRequest;
    if (!permission?.id || !permission.sessionID) return;
    // Subagent (task) sessions are hidden from the sidebar; bubble their asks
    // to the tracked parent so the approval modal is not invisible forever.
    const receivedAt = Date.now();
    for (const targetSessionId of uiTargetSessionIds(entry, permission.sessionID)) {
      upsertPendingPermission(entry, workspaceId, targetSessionId, permission, receivedAt);
    }
    return;
  }

  if (event.type === "permission.v2.asked") {
    const permission = event.properties as PermissionV2Request;
    if (!permission?.id || !permission.sessionID) return;
    const receivedAt = Date.now();
    for (const targetSessionId of uiTargetSessionIds(entry, permission.sessionID)) {
      upsertPendingPermission(entry, workspaceId, targetSessionId, permission, receivedAt);
    }
    return;
  }

  if (event.type === "permission.replied" || event.type === "permission.v2.replied") {
    const props = (event.properties ?? {}) as { sessionID?: string; requestID?: string };
    if (!props.sessionID || !props.requestID) return;
    for (const targetSessionId of uiTargetSessionIds(entry, props.sessionID)) {
      clearPendingPermission(entry, workspaceId, targetSessionId, props.requestID);
    }
    return;
  }

  if (event.type === "question.asked") {
    const question = event.properties as QuestionRequest;
    if (!question?.id || !question.sessionID) return;
    const receivedAt = Date.now();
    for (const targetSessionId of uiTargetSessionIds(entry, question.sessionID)) {
      upsertPendingQuestion(entry, workspaceId, targetSessionId, question, receivedAt);
    }
    return;
  }

  if (event.type === "question.replied" || event.type === "question.rejected") {
    const props = (event.properties ?? {}) as { sessionID?: string; requestID?: string };
    if (!props.sessionID || !props.requestID) return;
    for (const targetSessionId of uiTargetSessionIds(entry, props.sessionID)) {
      clearPendingQuestion(entry, workspaceId, targetSessionId, props.requestID);
    }
    return;
  }

  if (event.type === "message.updated") {
    const props = (event.properties ?? {}) as {
      info?: {
        id?: string;
        role?: UIMessage["role"] | string;
        sessionID?: string;
        time?: { created?: number; completed?: number };
        finish?: unknown;
        error?: unknown;
        summary?: unknown;
      };
    };
    const info = props.info;
    if (!info?.id || !info.sessionID || (info.role !== "user" && info.role !== "assistant" && info.role !== "system")) {
      return;
    }
    // Drop patch bodies early so the fat summary is not retained via event closures.
    if (info.summary !== undefined) {
      info.summary = slimSessionSummaryDiffs(info.summary);
    }
    useSessionActivityStore.getState().markMessageRole(workspaceId, info.sessionID, info.id, info.role);
    if (info.role === "assistant") {
      observeLiveAssistantMessage(info.sessionID, info.id, {
        created: typeof info.time?.created === "number" ? info.time.created : undefined,
      });
      const completed = typeof info.time?.completed === "number";
      hangTraceLog({
        layer: "sync",
        event: completed
          ? (info.error ? "assistant.error" : "assistant.completed")
          : "assistant.shell_created",
        sessionId: info.sessionID,
        workspaceId,
        messageId: info.id,
        fields: {
          finish: info.finish == null ? null : String(info.finish),
          completed,
          hasError: Boolean(info.error),
        },
      });
    }
    if (!isTrackedSession(entry, info.sessionID)) return;
    const metadata = openCodeMessageMetadata(info);
    const next = {
      id: info.id,
      role: info.role,
      ...(metadata ? { metadata } : {}),
      parts: [],
    } satisfies UIMessage;
    queryClient.setQueryData<UIMessage[]>(transcriptKey(workspaceId, info.sessionID), (current = []) =>
      upsertMessage(current, next),
    );
    // Create-time snapshot is often messages=[]. Drop it once live traffic
    // proves the session is non-empty so the next mount fetch can rebuild the
    // HTTP floor — instead of keeping a forever-empty "confirmed" snapshot.
    const snap = queryClient.getQueryData<OpenworkSessionSnapshot>(
      snapshotKey(workspaceId, info.sessionID),
    );
    if (snap && snap.messages.length === 0) {
      queryClient.removeQueries({
        queryKey: snapshotKey(workspaceId, info.sessionID),
        exact: true,
      });
    }
    // Some OpenCode/provider combinations emit the terminal assistant update
    // but drop the following session.idle event. Treat an explicit terminal
    // finish as the authoritative fallback so the composer and Thinking UI
    // cannot remain busy forever. Tool-call finishes are intentionally not
    // terminal and therefore do not match the allow-list above.
    if (isTerminalAssistantCompletion(info)) {
      settleSessionRun(entry, workspaceId, info.sessionID);
    }
    return;
  }

  if (event.type === "message.removed") {
    // Revert cleanup (and explicit message deletion) removes messages
    // server-side; drop them from both the live transcript cache and the
    // cached snapshot so they can't be resurrected by later merges.
    const props = (event.properties ?? {}) as { sessionID?: string; messageID?: string };
    if (!props.sessionID || !props.messageID) return;
    if (!isTrackedSession(entry, props.sessionID)) return;
    queryClient.setQueryData<UIMessage[]>(transcriptKey(workspaceId, props.sessionID), (current = []) =>
      current.filter((message) => message.id !== props.messageID),
    );
    queryClient.setQueryData<OpenworkSessionSnapshot>(
      snapshotKey(workspaceId, props.sessionID),
      (current) => {
        if (!current) return current;
        return { ...current, messages: current.messages.filter((message) => message.info.id !== props.messageID) };
      },
    );
    return;
  }

  if (event.type === "message.part.updated") {
    const props = (event.properties ?? {}) as { part?: Part };
    const part = props.part;
    if (!part?.sessionID || !part.messageID) return;
    // Raw tool state must be observed even when UI mapping defers pending+{}.
    if (part.type === "tool") {
      observeLiveToolPart(part as {
        id?: string;
        sessionID?: string;
        messageID?: string;
        type?: string;
        tool?: string;
        state?: {
          status?: string;
          input?: Record<string, unknown> | null;
          raw?: string | null;
        };
      }, { source: "sse" });
    }
    if (partHasVisibleProseForRecovery(part)) {
      observeLiveAssistantVisibleOutput(part.sessionID, part.messageID);
    }
    const forceActivityMark = shouldFlushPartUpdateImmediately(part);
    if (partHasVisibleAssistantOutput(part)) {
      maybeMarkAssistantOutput(workspaceId, part.sessionID, part.messageID, { force: forceActivityMark });
    }
    if (!isTrackedSession(entry, part.sessionID)) return;
    // First concrete part after empty assistant shell → TTFT for hang-trace.
    if (!entry.hangTraceFirstPartSeen) entry.hangTraceFirstPartSeen = new Set<string>();
    if (!entry.hangTraceFirstPartSeen.has(part.messageID)) {
      entry.hangTraceFirstPartSeen.add(part.messageID);
      noteHangFirstPart({
        sessionId: part.sessionID,
        workspaceId,
        messageId: part.messageID,
        partType: typeof part.type === "string" ? part.type : null,
      });
    }
    // Observe hooks above need raw tool/prose state; slim only for UI cache.
    const [mapped, ...attachments] = toUIParts(slimLiveMessagePart(part));
    if (!mapped) return;
    const pending = entry.pendingDeltas.get(part.id);
    // Fold queued deltas into the live seed. A shorter part.updated snapshot
    // must not discard deltas that already raced ahead in the rAF buffer.
    const taken = takeBufferedDeltasForPart(entry.deltaFlushBuffer, part.id);
    entry.deltaFlushBuffer = taken.remaining;
    const update: PendingPartUpdate = {
      sessionId: part.sessionID,
      messageId: part.messageID,
      partId: part.id,
      mapped,
      attachments,
      pendingSeedText: pending?.text,
      bufferedDeltaText: taken.text || undefined,
    };
    if (forceActivityMark || shouldFlushPartUpdateImmediately(part)) {
      flushTranscriptBuffers(entry, workspaceId);
      applyPendingPartUpdates(entry, workspaceId, [update]);
      if (pending) entry.pendingDeltas.delete(part.id);
      noteForcedFlush();
      return;
    }
    entry.partUpdateBuffer.set(part.id, update);
    if (pending) entry.pendingDeltas.delete(part.id);
    scheduleTranscriptFlush(entry, workspaceId);
    return;
  }

  if (event.type === "message.part.delta") {
    const props = (event.properties ?? {}) as {
      sessionID?: string;
      messageID?: string;
      partID?: string;
      field?: string;
      delta?: string;
    };
    if (!props.sessionID || !props.messageID || !props.partID || !props.delta) return;
    maybeMarkAssistantOutput(workspaceId, props.sessionID, props.messageID, {
      allowUnknownMessageRole: true,
    });
    if (!isTrackedSession(entry, props.sessionID)) return;
    // Note: we do NOT trust `props.field` to disambiguate reasoning vs
    // text. Opencode emits `field: "text"` for both kinds; the actual
    // distinction lives on the part's `type`, which we only see via
    // `message.part.updated`. The flusher resolves the kind at apply
    // time, falling back to `pendingDeltas` if the part hasn't been
    // declared yet.
    entry.deltaFlushBuffer.push({
      sessionId: props.sessionID!,
      messageId: props.messageID!,
      partId: props.partID!,
      reasoning: false,
      delta: props.delta!,
    });
    scheduleTranscriptFlush(entry, workspaceId);
    return;
  }

  if (event.type === "session.idle") {
    const props = (event.properties ?? {}) as { sessionID?: string };
    if (!props.sessionID) return;
    flushTranscriptBuffers(entry, workspaceId);
    observeLiveRunStatus(props.sessionID, { type: "idle" });
    settleSessionRun(entry, workspaceId, props.sessionID);
  }
}

function maybeMarkAssistantOutput(
  workspaceId: string,
  sessionId: string,
  messageId: string,
  options?: { force?: boolean; allowUnknownMessageRole?: boolean },
) {
  const key = `${workspaceId}|${sessionId}|${messageId}`;
  if (!assistantOutputMarkGate.tryPass(key, { force: options?.force })) return;
  useSessionActivityStore.getState().markAssistantOutput(workspaceId, sessionId, messageId, {
    allowUnknownMessageRole: options?.allowUnknownMessageRole,
  });
}

function applySessionStatus(
  entry: SyncEntry,
  workspaceId: string,
  sessionId: string,
  status: SessionStatus,
  options: { tracked: boolean; input?: SyncOptions },
) {
  const queryClient = getReactQueryClient();
  useSessionActivityStore.getState().setRunStatus(workspaceId, sessionId, status);
  if (options.tracked) queryClient.setQueryData(statusKey(workspaceId, sessionId), status);
  for (const listener of entry.sessionStatusListeners) listener({ sessionId, status });
  if (options.input && options.tracked && !isLiveStatus(status)) {
    releaseRetainedSessionSoon(options.input, entry, sessionId);
  }
}

function applyPendingPartUpdates(
  entry: SyncEntry,
  workspaceId: string,
  updates: PendingPartUpdate[],
) {
  if (updates.length === 0) return;
  const queryClient = getReactQueryClient();
  const bySession = new Map<string, PendingPartUpdate[]>();
  for (const update of updates) {
    const bucket = bySession.get(update.sessionId);
    if (bucket) bucket.push(update);
    else bySession.set(update.sessionId, [update]);
  }
  for (const [sessionId, sessionUpdates] of bySession) {
    queryClient.setQueryData<UIMessage[]>(transcriptKey(workspaceId, sessionId), (current = []) => {
      let next = current;
      for (const update of sessionUpdates) {
        const existing = next.find((message) => message.id === update.messageId);
        const role = existing?.role ?? stubRoleForUnknownMessage();
        const withMessage = upsertMessage(next, {
          id: update.messageId,
          role,
          parts: existing?.parts ?? [],
        });
        const seededPartId = getPartMetadataId(update.mapped) ?? update.partId;
        const existingText = existingPartText(withMessage, update.messageId, seededPartId);
        const seededPart =
          update.mapped.type === "text" || update.mapped.type === "reasoning"
            ? {
                ...update.mapped,
                text: mergeLiveCumulativeText({
                  mappedText: typeof update.mapped.text === "string" ? update.mapped.text : "",
                  pendingSeedText: update.pendingSeedText,
                  existingText,
                  bufferedDeltaText: update.bufferedDeltaText,
                }),
                state: "streaming" as const,
              }
            : update.mapped;
        next = upsertPart(withMessage, update.messageId, seededPartId, seededPart);
        for (const attachment of update.attachments) {
          const attachmentId = getPartMetadataId(attachment);
          if (attachmentId) next = upsertPart(next, update.messageId, attachmentId, attachment);
        }
      }
      return next;
    });
  }
}

function scheduleTranscriptFlush(entry: SyncEntry, workspaceId: string) {
  if (entry.transcriptFlushScheduled) return;
  entry.transcriptFlushScheduled = true;
  const run = () => {
    entry.transcriptFlushScheduled = false;
    flushTranscriptBuffers(entry, workspaceId);
  };
  if (
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function" &&
    (typeof document === "undefined" || document.visibilityState === "visible")
  ) {
    window.requestAnimationFrame(run);
  } else if (typeof window !== "undefined") {
    window.setTimeout(run, 50);
  } else {
    queueMicrotask(run);
  }
}

/** PERF-07: one React Query commit per session for queued part.updated + deltas (+ busy status). */
function flushTranscriptBuffers(entry: SyncEntry, workspaceId: string) {
  const partUpdates = [...entry.partUpdateBuffer.values()];
  entry.partUpdateBuffer.clear();
  const pendingStatuses = [...entry.pendingStatusBySession.entries()];
  entry.pendingStatusBySession.clear();

  if (partUpdates.length > 0) {
    applyPendingPartUpdates(entry, workspaceId, partUpdates);
  }

  const queryClient = getReactQueryClient();
  const pending = coalescePendingDeltas(entry.deltaFlushBuffer);
  entry.deltaFlushBuffer = [];

  const bySession = new Map<string, PendingDelta[]>();
  for (const item of pending) {
    const bucket = bySession.get(item.sessionId);
    if (bucket) bucket.push(item);
    else bySession.set(item.sessionId, [item]);
  }

  for (const [sessionId, items] of bySession) {
    queryClient.setQueryData<UIMessage[]>(
      transcriptKey(workspaceId, sessionId),
      (current = []) => {
        let next = current;
        const nextById = new Map(next.map((message) => [message.id, message]));
        const ensuredMessageIds = new Set<string>();
        for (const item of items) {
          if (!ensuredMessageIds.has(item.messageId)) {
            const existing = nextById.get(item.messageId);
            const role = existing?.role ?? stubRoleForUnknownMessage();
            const ensuredMessage = { id: item.messageId, role, parts: existing?.parts ?? [] };
            next = upsertMessage(next, ensuredMessage);
            nextById.set(item.messageId, ensuredMessage);
            ensuredMessageIds.add(item.messageId);
          }
          const ownerMessage = nextById.get(item.messageId);
          const ownerPartsById = new Map(
            (ownerMessage?.parts ?? []).flatMap((part) => {
              const id = part.type === "dynamic-tool" ? part.toolCallId : getPartMetadataId(part);
              return id ? [[id, part] as const] : [];
            }),
          );
          const ownerPart = ownerPartsById.get(item.partId);

          if (!ownerPart) {
            const existing = entry.pendingDeltas.get(item.partId) ?? {
              messageId: item.messageId,
              reasoning: item.reasoning,
              text: "",
            };
            existing.text += item.delta;
            entry.pendingDeltas.set(item.partId, existing);
            continue;
          }

          const reasoning = ownerPart.type === "reasoning";
          next = appendDelta(next, item.messageId, item.partId, item.delta, reasoning);
          if (!reasoning && item.delta.trim()) {
            observeLiveAssistantVisibleOutput(item.sessionId, item.messageId);
          }
        }
        return next;
      },
    );
  }

  for (const [sessionId, status] of pendingStatuses) {
    applySessionStatus(entry, workspaceId, sessionId, status, {
      tracked: isTrackedSession(entry, sessionId),
      input: entry.input,
    });
  }

  if (partUpdates.length > 0 || pending.length > 0 || pendingStatuses.length > 0) {
    noteTranscriptFlush(partUpdates.length);
  }
}

function startSync(input: SyncOptions) {
  const client = createClient(input.baseUrl, undefined, { token: input.openworkToken, mode: "openwork" });
  const controller = new AbortController();
  const entry = syncs.get(syncKey(input));
  let disposed = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let watchdogTimer: ReturnType<typeof setInterval> | null = null;
  let activeConnectionController: AbortController | null = null;
  let lastEventAt = Date.now();
  let retryDelayMs = 1_000;
  const staleStreamMs = 30_000;

  const scheduleRetry = () => {
    if (disposed || controller.signal.aborted || retryTimer) return;
    activeConnectionController = null;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, retryDelayMs);
    retryDelayMs = Math.min(retryDelayMs * 2, 10_000);
  };

  const connect = async () => {
    const connectionController = new AbortController();
    activeConnectionController = connectionController;
    try {
      const sub = await client.event.subscribe(undefined, { signal: connectionController.signal });
      retryDelayMs = 1_000;
      lastEventAt = Date.now();
      for await (const raw of sub.stream) {
        if (controller.signal.aborted || connectionController.signal.aborted) return;
        lastEventAt = Date.now();
        const event = normalizeEvent(raw);
        if (!event) continue;
        if (!entry) continue;
        applyEvent(entry, input.workspaceId, event);
      }
      if (!controller.signal.aborted && activeConnectionController === connectionController) scheduleRetry();
    } catch (error) {
      if (
        !controller.signal.aborted &&
        (connectionController.signal.aborted || shouldRetrySyncSubscribe(error))
      ) {
        scheduleRetry();
      }
    } finally {
      if (activeConnectionController === connectionController) activeConnectionController = null;
    }
  };

  void connect();
  watchdogTimer = setInterval(() => {
    if (disposed || controller.signal.aborted || retryTimer) return;
    const active = activeConnectionController;
    if (!active || active.signal.aborted) return;
    if (Date.now() - lastEventAt < staleStreamMs) return;
    active.abort();
    scheduleRetry();
  }, 10_000);

  return () => {
    disposed = true;
    if (retryTimer) clearTimeout(retryTimer);
    if (watchdogTimer) clearInterval(watchdogTimer);
    activeConnectionController?.abort();
    controller.abort();
  };
}

export function ensureWorkspaceSessionSync(input: SyncOptions) {
  const key = syncKey(input);
  const existing = syncs.get(key);
  if (existing) {
    if (existing.disposeTimer) {
      clearTimeout(existing.disposeTimer);
      existing.disposeTimer = null;
    }
    if (input.onSessionUpdated) existing.sessionUpdatedListeners.add(input.onSessionUpdated);
    if (input.onSessionStatus) existing.sessionStatusListeners.add(input.onSessionStatus);
    existing.refs += 1;
    return () => releaseWorkspaceSessionSync(input);
  }

  syncs.set(key, {
    input,
    refs: 1,
    dispose: () => {},
    disposeTimer: null,
    trackedSessionRefs: new Map(),
    retainedSessionTimers: new Map(),
    parentBySessionId: new Map(),
    sessionUpdatedListeners: new Set(input.onSessionUpdated ? [input.onSessionUpdated] : []),
    sessionStatusListeners: new Set(input.onSessionStatus ? [input.onSessionStatus] : []),
    pendingDeltas: new Map(),
    deltaFlushBuffer: [],
    partUpdateBuffer: new Map(),
    pendingStatusBySession: new Map(),
    transcriptFlushScheduled: false,
    hangTraceFirstPartSeen: new Set(),
  });

  const created = syncs.get(key)!;
  created.dispose = startSync(input);

  return () => releaseWorkspaceSessionSync(input);
}

function releaseWorkspaceSessionSync(input: SyncOptions) {
  const key = syncKey(input);
  const existing = syncs.get(key);
  if (!existing) return;
  if (input.onSessionUpdated) existing.sessionUpdatedListeners.delete(input.onSessionUpdated);
  if (input.onSessionStatus) existing.sessionStatusListeners.delete(input.onSessionStatus);
  existing.refs -= 1;
  if (existing.refs > 0) return;
  if (existing.retainedSessionTimers.size === 0) {
    disposeWorkspaceSync(key, existing);
  }
}

export function seedSessionState(
  workspaceId: string,
  snapshot: OpenworkSessionSnapshot,
  options?: { uiMessages?: UIMessage[] },
) {
  const queryClient = getReactQueryClient();
  const slimSnapshot = slimOpenworkSessionSnapshot(snapshot);
  const key = transcriptKey(workspaceId, slimSnapshot.session.id);
  // Callers that already mapped this snapshot (SessionSurface render path) pass
  // uiMessages so we do not pay snapshotToUIMessages twice on session switch.
  const incoming = options?.uiMessages ?? snapshotToUIMessages(slimSnapshot);
  const existing = queryClient.getQueryData<UIMessage[]>(key);

  useSessionActivityStore.getState().seedSessionRun(
    workspaceId,
    slimSnapshot.session.id,
    slimSnapshot.status,
    assistantOutputAfterLatestUser(incoming),
    {
      assistantCompletedAt:
        slimSnapshot.status.type === "idle"
          ? assistantCompletedAtAfterLatestUser(slimSnapshot.messages)
          : undefined,
    },
  );
  seedLiveToolStateFromSnapshot(slimSnapshot.session.id, slimSnapshot);

  // The snapshot's revert cursor is authoritative: messages at/after it are
  // reverted server-side, so the cache must not keep them alive (a later
  // merge would resurrect them once the server deletes them on next prompt).
  queryClient.setQueryData(key, applyRevertCursor(
    reconcileTranscriptMessages({
      currentMessages: existing ?? [],
      snapshotMessages: incoming,
      reason: "snapshot",
    }),
    slimSnapshot.session.revert?.messageID ?? null,
  ));

  queryClient.setQueryData(snapshotKey(workspaceId, slimSnapshot.session.id), slimSnapshot);
  queryClient.setQueryData(statusKey(workspaceId, slimSnapshot.session.id), slimSnapshot.status);
  queryClient.setQueryData(todoKey(workspaceId, slimSnapshot.session.id), slimSnapshot.todos);
}

/**
 * Apply a server-confirmed revert to the local session caches.
 *
 * `session.revert` only reaches the renderer through the snapshot cache, so
 * after a successful `session.revert` call this stamps the returned revert
 * cursor into the cached snapshot, truncates the live transcript cache, and
 * refetches the snapshot to pick up the server's post-revert truth. Without
 * this the UI keeps rendering the old transcript until a full reload.
 */
export function applySessionRevert(workspaceId: string, session: Session) {
  const queryClient = getReactQueryClient();
  const revertMessageId = session.revert?.messageID ?? null;

  queryClient.setQueryData<OpenworkSessionSnapshot>(
    snapshotKey(workspaceId, session.id),
    (current) => (current ? { ...current, session: { ...current.session, revert: session.revert } } : current),
  );
  queryClient.setQueryData<UIMessage[]>(
    transcriptKey(workspaceId, session.id),
    (current = []) => applyRevertCursor(current, revertMessageId),
  );
  void queryClient.invalidateQueries({ queryKey: snapshotKey(workspaceId, session.id) });
}

export function trackWorkspaceSessionSync(input: SyncOptions, sessionId: string | null | undefined) {
  const normalizedSessionId = sessionId?.trim() ?? "";
  if (!normalizedSessionId) return () => {};

  const entry = syncs.get(syncKey(input));
  if (!entry) return () => {};

  const retainedTimer = entry.retainedSessionTimers.get(normalizedSessionId);
  if (retainedTimer) {
    clearTimeout(retainedTimer);
    entry.retainedSessionTimers.delete(normalizedSessionId);
  }

  entry.trackedSessionRefs.set(
    normalizedSessionId,
    (entry.trackedSessionRefs.get(normalizedSessionId) ?? 0) + 1,
  );

  return () => {
    const current = entry.trackedSessionRefs.get(normalizedSessionId) ?? 0;
    if (current <= 1) {
      entry.trackedSessionRefs.delete(normalizedSessionId);
      retainSession(input, entry, normalizedSessionId);
      return;
    }
    entry.trackedSessionRefs.set(normalizedSessionId, current - 1);
  };
}

export function trackWorkspaceSessionsSync(input: SyncOptions, sessionIds: Array<string | null | undefined>) {
  const seen = new Set<string>();
  const releases = sessionIds.flatMap((sessionId) => {
    const id = sessionId?.trim() ?? "";
    if (!id || seen.has(id)) return [];
    seen.add(id);
    return [trackWorkspaceSessionSync(input, id)];
  });
  return () => {
    for (const release of releases) release();
  };
}

export function __createWorkspaceSessionSyncForTest(input: SyncOptions) {
  const key = syncKey(input);
  syncs.set(key, {
    input,
    refs: 1,
    dispose: () => {},
    disposeTimer: null,
    trackedSessionRefs: new Map(),
    retainedSessionTimers: new Map(),
    parentBySessionId: new Map(),
    sessionUpdatedListeners: new Set(),
    sessionStatusListeners: new Set(),
    pendingDeltas: new Map(),
    deltaFlushBuffer: [],
    partUpdateBuffer: new Map(),
    pendingStatusBySession: new Map(),
    transcriptFlushScheduled: false,
    hangTraceFirstPartSeen: new Set(),
  });
  return () => {
    const entry = syncs.get(key);
    if (entry) {
      for (const timer of entry.retainedSessionTimers.values()) clearTimeout(timer);
    }
    syncs.delete(key);
  };
}

export function __hasWorkspaceSessionSyncForTest(input: SyncOptions) {
  return syncs.has(syncKey(input));
}

export function __disposeWorkspaceSessionSyncForTest(input: SyncOptions) {
  const key = syncKey(input);
  const entry = syncs.get(key);
  if (!entry) return;
  entry.refs = 0;
  disposeWorkspaceSync(key, entry);
}

export function __applySessionSyncEventForTest(input: SyncOptions, event: OpencodeEvent) {
  const entry = syncs.get(syncKey(input));
  if (!entry) return;
  applyEvent(entry, input.workspaceId, event);
}
