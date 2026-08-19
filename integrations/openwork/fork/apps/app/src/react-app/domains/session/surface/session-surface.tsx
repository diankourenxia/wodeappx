/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { UIMessage } from "ai";
import { useQueryClient } from "@tanstack/react-query";
import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import { Check, Minimize2 } from "lucide-react";
import { toast } from "@/components/ui/sonner";

import { captureAnalyticsEvent } from "@/app/lib/analytics";
import { createClient, unwrap } from "@/app/lib/opencode";
import { abortSessionSafe } from "@/app/lib/opencode-session";
import { t } from "@/i18n";
import { readWorkspaceCloudImports, type CloudImportedPlugin } from "@/app/cloud/import-state";
import type {
  OpenworkServerClient,
  OpenworkSessionSnapshot,
} from "@/app/lib/openwork-server";
import type {
  ComposerAttachment,
  ComposerDraft,
  ComposerPart,
  McpServerEntry,
  McpStatusMap,
  ModelRef,
  PendingPermission,
  PendingQuestion,
  SkillCard,
  TodoItem,
} from "@/app/types";
import {
  publishInspectorSlice,
  recordInspectorEvent,
} from "@/app/lib/app-inspector";
import { requestWodeAppRuntimeJson } from "@/app/lib/wodeapp-auth";
import { WodeAppLive2DAssistant } from "@/react-app/domains/wodeapp/wodeapp-live2d-assistant";
import { desktopLocalFilePath } from "@/react-app/domains/wodeapp/desktop-local-file";
import { reportToolExecutionFailure, reportTurnAborted, isAbortNoiseMessage } from "@/react-app/domains/wodeapp/wodeapp-desktop-diagnostics";
import {
  beginHangTurnTrace,
  hangTraceLog,
  observeHangEmptyShell,
} from "@/react-app/domains/wodeapp/wodeapp-hang-trace";
import { registerSessionProductImagePixels, materializeComposerAttachmentsForSend } from "@/react-app/domains/wodeapp/wodeapp-product-image-materialize";
import {
  listComposerAttachmentsMissingLocalPath,
  stampComposerAttachmentLocalPaths,
} from "@/react-app/domains/wodeapp/wodeapp-attachment-intelligence";
import { slimOpenworkSessionSnapshot } from "@/react-app/domains/wodeapp/wodeapp-session-snapshot-slim";
import { useControlAction, type OpenworkControlAction } from "@/react-app/shell/control/control-provider";
import { ReactSessionComposer } from "./composer/composer";
import {
  collectComposerMentionValues,
  decodeComposerMentionValue,
  encodeComposerMentionValue,
  type ComposerMentionKind,
} from "./composer/mention-encoding";
import {
  appendAssetContextToPrompt,
  assetMentionValue,
  digitalAssetToMention,
  type DigitalAssetItem,
  type AssetMentionRef,
} from "@/react-app/domains/wodeapp/digital-assets-data";
import { findDigitalAssetByMentionValue, getDigitalAssetsList } from "@/react-app/domains/wodeapp/digital-assets-store";
import {
  consumeQueuedAssetMentionInsert,
  consumeQueuedAssetMentionInserts,
  rememberAssetMention,
  resolveAssetMentionsFromValues,
  useOptionalWodeAppWorkbench,
} from "@/react-app/domains/wodeapp/wodeapp-workbench-context";
import { WodeAppFeishuAuthorizationAccessory } from "@/react-app/domains/wodeapp/wodeapp-feishu-authorization-panel";
import { resolveWodeAppComposerSendText, setWodeAppComposerHandoff } from "@/react-app/domains/wodeapp/wodeapp-composer-handoff";
import {
  buildBuiltinAgentTask,
  consumeBuiltinAgentAutoSend,
} from "@/react-app/domains/wodeapp/wodeapp-auto-orchestration";
import {
  findWodeAppBuiltinAgent,
  type WodeAppBuiltinAgent,
} from "@/react-app/domains/wodeapp/runtime-projects";
import { bindWodeAppRuntimeProfileToSession } from "@/react-app/domains/wodeapp/wodeapp-runtime-profile";
import { bindCustomAgentHomeFromCreateSession } from "@/react-app/domains/wodeapp/wodeapp-custom-agent-home";
import {
  isWodeAppSkinId,
  WODEAPP_DEFAULT_SKIN_ID,
} from "@/react-app/domains/wodeapp/wodeapp-skins";
import { WodeAppInkBookTranscript } from "@/react-app/domains/wodeapp/wodeapp-ink-book-transcript";
import { useWodeAppSessionControlActions } from "@/react-app/domains/wodeapp/wodeapp-session-control-actions";
import {
  classifyWodeAppCreditGatedError,
} from "@/react-app/domains/wodeapp/wodeapp-send-readiness";
import { WODEAPP_OPEN_LOGIN_EVENT, WODEAPP_OPEN_RECHARGE_EVENT } from "@/react-app/domains/wodeapp/wodeapp-model-display";
import { isWebDeployment } from "@/app/lib/openwork-deployment";
import { openFirstMileGuide } from "@/react-app/domains/wodeapp/wodeapp-first-mile";
import { useFirstMileEntryCue } from "@/react-app/domains/wodeapp/wodeapp-byok-guide-dialog";
import { loadCachedWodeAppAuthState } from "@/app/lib/wodeapp-auth";
import { desktopBridge } from "@/app/lib/desktop";
import { parseSlashCommandInvocation } from "./composer/slash-command";
import { DevProfiler } from "@/react-app/shell/dev-profiler";
import { useShellConfig } from "@/react-app/shell/shell-config";
import { cn } from "@/lib/utils";
import { recordDebugLog } from "@/react-app/shell/debug-logger";
import { useReactRenderWatchdog } from "@/react-app/shell/react-render-watchdog";
import { SessionDebugPanel } from "./debug-panel";
import { deriveRenderedSessionMessages, resolveRenderedSessionSnapshot } from "./session-render-state";
import {
  shouldShowPendingSessionLoad,
  shouldShowWodeAppEmptySessionChrome,
} from "./session-empty-chrome";
import { stripProviderThinkTags } from "@/react-app/domains/wodeapp/assistant-think-text";
import { filterDuplicateComposerAttachmentFiles, uniquifyComposerAttachmentFiles } from "../sync/attachment-support";
import {
  STUCK_TOOL_AUTO_CONTINUE_MARKER,
  STUCK_TOOL_AUTO_CONTINUE_MAX,
  buildStuckToolAutoContinueSystemContext,
  clearLiveToolSession,
  confirmStuckEmptyPendingTool,
  findStuckEmptyPendingTool,
  isStuckEmptyArgsRecoveryEnabled,
  isStuckToolAutoContinueText,
  seedLiveToolStateFromSnapshot,
  snapshotConfirmsEmptyPendingTool,
} from "./stuck-tool-recovery";
import {
  buildEmptyVisibleReplyAutoContinueSystemContext,
  findEmptyVisibleCompletedAssistantTurn,
} from "./empty-visible-reply-recovery";
import {
  buildTruncatedOutputAutoContinueSystemContext,
  findTruncatedOutputAssistantTurn,
} from "./truncated-output-recovery";
import {
  buildOrphanedPendingEmptyToolAutoContinueSystemContext,
  buildOrphanedRunningToolAutoContinueSystemContext,
  buildStalledBackgroundBashAutoContinueSystemContext,
  findOrphanedPendingEmptyTool,
  findOrphanedRunningTool,
  findStalledBackgroundBashTool,
  snapshotHasInFlightRunningTool,
} from "./orphaned-running-tool-recovery";
import { snapshotToUIMessages } from "../sync/usechat-adapter";
import { isSilentAutoContinueUserMessage } from "./session-silent-auto-continue";
import {
  buildOptimisticUserMessage,
  mergeOptimisticUserMessage,
  shouldClearOptimisticUserMessage,
} from "./optimistic-user-message";
import { useLocal } from "@/react-app/kernel/local-provider";
import { deriveSessionRenderModel } from "@/react-app/domains/session/sync/transition-controller";
import { useSessionScrollController } from "./scroll-controller";
import { SessionScrollOverlay } from "./scroll-overlay";
import { isBlockingSessionActivityStatus, useSessionActivityStore, type SessionActivityStatus } from "@/react-app/domains/session/status/session-activity-store";
import { PermissionApprovalPanel } from "@/react-app/domains/session/chat/permission-approval-modal";
import { QuestionPanel } from "@/react-app/domains/session/modals/question-modal";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import { QueuedMessagesPanel } from "@/react-app/domains/session/modals/queued-messages-panel";
import { augmentResolvedOpenTargets, deriveOpenTargets, selectAutoOpenTarget, type OpenTarget } from "@/react-app/domains/session/artifacts/open-target";
import { usePanelTabStore } from "@/react-app/domains/session/panel/panel-tab-store";
import {
  loadEarlierSessionHistory,
  seedSessionState,
  SESSION_SNAPSHOT_MESSAGE_LIMIT,
  SESSION_SNAPSHOT_STALE_TIME_MS,
  snapshotKey as reactSnapshotKey,
  statusKey as reactStatusKey,
  transcriptKey as reactTranscriptKey,
} from "@/react-app/domains/session/sync/session-sync";
import { HISTORY_LOAD_BATCH } from "@/components/chat/message-list-history-window";
import { resolveForkBoundaryId } from "@/react-app/domains/session/sync/transcript-reconcile";
import {
  getComposerAttachments,
  getComposerDraft,
  getComposerHistory,
  getComposerMentions,
  getComposerPasteParts,
  getComposerQueuedDrafts,
  useComposerStateStore,
} from "./composer-state-store";
import {
  canFlushQueuedDrafts,
  listVisibleQueuedDraftEntries,
  pickQueuedDraftFlushIndex,
  retainNonSilentQueuedDrafts,
} from "./queued-draft-flush";
import { MessageList } from "@/components/chat/message-list";
import { MessageListProvider, type DispatchAction } from "@/components/chat/message-list-provider";
import { OpenTargetProvider, type OpenTargetOptions } from "@/lib/target-provider";
import type { ThreadStatus } from "@/lib/messages";
import {
  EnvironmentVariableProvider,
  type ApplyEnvironmentChangesResult,
} from "@/react-app/domains/settings/pages/environment-variable-provider";

const EMPTY_TRANSCRIPT: UIMessage[] = [];
const IDLE_STATUS: SessionStatus = { type: "idle" };
const DEFAULT_COMPOSER_CONTROL_TEXT = "告诉 WodeAppX 你想完成什么。";

function extractToolActionId(input: unknown, errorText: string): string | null {
  const fromError = /UI action ([a-zA-Z0-9_.]+)/.exec(errorText);
  if (fromError?.[1]) return fromError[1];
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  if (typeof record.actionId === "string" && record.actionId.trim()) return record.actionId.trim();
  if (typeof record.value === "string") {
    try {
      const parsed = JSON.parse(record.value) as { actionId?: unknown };
      if (typeof parsed?.actionId === "string" && parsed.actionId.trim()) return parsed.actionId.trim();
    } catch {
      // ignore
    }
  }
  return null;
}

function reportSnapshotToolFailures(
  snapshot: OpenworkSessionSnapshot | null | undefined,
  sessionId: string,
  workspaceId: string,
): void {
  if (!snapshot?.messages?.length) return;
  const now = Date.now();
  // Only freshly failed tools — opening an old chat must not flush months of history.
  const maxAgeMs = 10 * 60 * 1000;
  for (const message of snapshot.messages) {
    const info = message.info as {
      id?: string;
      role?: string;
      modelID?: string;
      providerID?: string;
      error?: { name?: string; data?: { message?: string } };
      time?: { created?: number; completed?: number };
    } | undefined;
    if (info?.role === "assistant" && info.error) {
      const errName = String(info.error.name || "");
      const errMsg = String(info.error.data?.message || info.error.name || "").trim();
      if (/MessageAbortedError/i.test(errName) || isAbortNoiseMessage(errMsg)) {
        const endedAt = info.time?.completed ?? info.time?.created;
        if (!(typeof endedAt === "number" && Number.isFinite(endedAt) && now - endedAt > maxAgeMs)) {
          reportTurnAborted({
            reason: "message_aborted",
            message: errMsg || "MessageAbortedError",
            sessionId,
            workspaceId,
            messageId: typeof info.id === "string" ? info.id : null,
            modelId: info.modelID || null,
            providerId: info.providerID || null,
            ageMs:
              typeof info.time?.created === "number" && typeof info.time?.completed === "number"
                ? info.time.completed - info.time.created
                : null,
          });
        }
      }
    }
    for (const part of message.parts) {
      const toolPart = part as {
        id?: string;
        type?: string;
        tool?: string;
        state?: {
          status?: string;
          error?: string;
          input?: unknown;
          time?: { end?: number; start?: number };
          metadata?: { wodeappxFailure?: { errorKind?: string; recoverable?: boolean } };
        };
      };
      if (toolPart.type !== "tool") continue;
      if (toolPart.state?.status !== "error") continue;
      const endedAt = toolPart.state.time?.end ?? toolPart.state.time?.start;
      if (typeof endedAt === "number" && Number.isFinite(endedAt) && now - endedAt > maxAgeMs) continue;
      const errorText = String(toolPart.state.error || "").trim();
      if (!errorText) continue;
      const failure = toolPart.state.metadata?.wodeappxFailure;
      // Abort → turn_aborted telemetry; never tool_execution_failed.
      if (isAbortNoiseMessage(errorText) || failure?.errorKind === "aborted") {
        reportTurnAborted({
          reason: "tool_aborted",
          message: errorText,
          sessionId,
          workspaceId,
          messageId: typeof info?.id === "string" ? info.id : null,
          partId: typeof toolPart.id === "string" ? toolPart.id : null,
          toolName: toolPart.tool || "tool",
          modelId: info?.modelID || null,
          providerId: info?.providerID || null,
          ageMs:
            typeof toolPart.state.time?.start === "number" && typeof toolPart.state.time?.end === "number"
              ? toolPart.state.time.end - toolPart.state.time.start
              : null,
        });
        continue;
      }
      reportToolExecutionFailure({
        toolName: toolPart.tool || "tool",
        message: errorText,
        partId: typeof toolPart.id === "string" ? toolPart.id : null,
        sessionId,
        workspaceId,
        errorKind: failure?.errorKind || null,
        recoverable: typeof failure?.recoverable === "boolean" ? failure.recoverable : null,
        actionId: extractToolActionId(toolPart.state.input, errorText),
      });
    }
  }
}

type SessionError = {
  message: string;
  kind?: "model-not-found" | "auth-required" | "insufficient-credits" | "provider-not-ready" | "generic";
  /** For model-not-found: the model that failed. */
  failedModel?: { providerID: string; modelID: string };
  /** For model-not-found: suggested replacements from the backend. */
  suggestions?: Array<{ providerID: string; modelID: string }>;
};

function filePartCount(message: UIMessage) {
  return message.parts.filter((part) => part.type === "file").length;
}

export type SessionSurfaceProps = {
  client: OpenworkServerClient;
  environmentClient?: OpenworkServerClient | null;
  workspaceId: string;
  workspaceRoot: string;
  sessionId: string;
  opencodeBaseUrl: string;
  openworkToken: string;
  developerMode: boolean;
  modelLabel: string;
  onModelClick: () => void;
  modelPickerOpen: boolean;
  modelUnavailable?: boolean;
  selectedModel: ModelRef;
  onModelPickerOpenChange: (open: boolean) => void;
  onModelChange: (model: ModelRef) => void;
  onSendDraft: (
    draft: ComposerDraft,
    sessionId: string,
    onAttachmentProgress?: (message: string | null) => void,
  ) => void;
  onDraftChange: (draft: ComposerDraft) => void;
  attachmentsEnabled: boolean;
  attachmentsDisabledReason: string | null;
  modelVariantLabel: string;
  modelVariant: string | null;
  modelBehaviorOptions?: { value: string | null; label: string }[];
  onModelVariantChange: (value: string | null) => void;
  agentLabel: string;
  selectedAgent: string | null;
  listAgents: () => Promise<import("@opencode-ai/sdk/v2/client").Agent[]>;
  onSelectAgent: (agent: string | null) => void;
  listCommands: () => Promise<import("@/app/types").SlashCommandOption[]>;
  recentFiles: string[];
  searchFiles: (query: string) => Promise<string[]>;
  isRemoteWorkspace: boolean;
  isSandboxWorkspace: boolean;
  todos?: TodoItem[];
  activePermission?: PendingPermission | null;
  permissionReplyBusy?: boolean;
  respondPermission?: (requestID: string, reply: "once" | "always" | "reject") => void;
  activeQuestion?: PendingQuestion | null;
  questionReplyBusy?: boolean;
  respondQuestion?: (requestID: string, answers: string[][]) => void;
  safeStringify?: (value: unknown) => string;
  onChangeModel?: (model: { providerID: string; modelID: string }) => void;
  onUploadInboxFiles?: ((files: File[], options?: { notify?: boolean }) => void | Promise<unknown>) | null;
  providerConnectedCount?: number;
  onOpenSettingsSection?: ((section: "commands" | "skills" | "mcps" | "plugins" | "providers") => void) | undefined;
  onRevertToMessage?: (messageId: string, sessionId: string) => Promise<boolean>;
  onForkAtMessage?: (messageId: string | null, sessionId: string) => void;
  onOpenTarget?: (target: OpenTarget, options?: OpenTargetOptions, sessionId?: string) => void;
  environmentRuntimeKey?: string | null;
  onApplyEnvironmentChanges?: () => Promise<ApplyEnvironmentChangesResult>;
};

function messageToReadableText(message: UIMessage) {
  const header = message.role === "user" ? "You" : message.role === "assistant" ? "WodeAppX" : message.role;
  const body = message.parts
    .flatMap((part) => {
      // Skip reasoning / provider <think> — transcript copy is for the answer.
      if (part.type === "reasoning") return [];
      if (part.type === "text") {
        const visible = stripProviderThinkTags(part.text).trim();
        return visible ? [visible] : [];
      }
      if (part.type === "dynamic-tool") {
        if (part.state === "output-error") return [`[tool:${part.toolName}] ${part.errorText}`];
        if (part.state === "output-available") return [`[tool:${part.toolName}] ${JSON.stringify(part.output)}`];
        return [`[tool:${part.toolName}] ${JSON.stringify(part.input)}`];
      }
      return [];
    })
    .join("\n\n");
  return `${header}\n${body}`.trim();
}

function transcriptToText(messages: UIMessage[]) {
  return messages
    .flatMap((message) => {
      const text = messageToReadableText(message);
      return text ? [text] : [];
    })
    .join("\n\n---\n\n");
}

function statusLabel(snapshot: OpenworkSessionSnapshot | undefined, busy: boolean) {
  if (busy) return "Running...";
  if (snapshot?.status.type === "busy") return "Running...";
  if (snapshot?.status.type === "retry") return `Retrying: ${snapshot.status.message}`;
  return "Ready";
}

function controlTextArgument(args: unknown) {
  if (typeof args === "string") return args;
  if (args && typeof args === "object" && "text" in args) {
    const text = (args as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return DEFAULT_COMPOSER_CONTROL_TEXT;
}

function controlOptionalStringArgument(args: unknown, name: string) {
  if (!args || typeof args !== "object" || !(name in args)) return "";
  const value = (args as Record<string, unknown>)[name];
  return typeof value === "string" ? value.trim() : "";
}

function controlOptionalStringArrayArgument(args: unknown, name: string) {
  if (!args || typeof args !== "object" || !(name in args)) return [];
  const value = (args as Record<string, unknown>)[name];
  if (Array.isArray(value)) {
    return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

const waitForControl = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function useSharedQueryState<T>(queryKey: readonly unknown[], fallback: T) {
  const queryClient = useQueryClient();
  const queryHash = JSON.stringify(queryKey);
  const subscribe = useCallback((listener: () => void) =>
    queryClient.getQueryCache().subscribe((event) => {
      if (JSON.stringify(event.query.queryKey) === queryHash) listener();
    }), [queryClient, queryHash]);
  const queryState = useSyncExternalStore(
    subscribe,
    () => queryClient.getQueryState<T>(queryKey),
    () => queryClient.getQueryState<T>(queryKey),
  );
  return queryState?.data ?? fallback;
}

function useSessionSnapshotQuery(
  queryKey: readonly unknown[],
  queryFn: () => Promise<OpenworkSessionSnapshot>,
) {
  const queryClient = useQueryClient();
  const queryHash = JSON.stringify(queryKey);
  const subscribe = useCallback((listener: () => void) =>
    queryClient.getQueryCache().subscribe((event) => {
      if (JSON.stringify(event.query.queryKey) === queryHash) listener();
    }), [queryClient, queryHash]);
  const queryState = useSyncExternalStore(
    subscribe,
    () => queryClient.getQueryState<OpenworkSessionSnapshot>(queryKey),
    () => queryClient.getQueryState<OpenworkSessionSnapshot>(queryKey),
  );
  const refetch = useCallback(async () => {
    try {
      const data = await queryClient.fetchQuery({ queryKey, queryFn, staleTime: 0 });
      return { data, error: null };
    } catch (error) {
      return { data: undefined, error };
    }
  }, [queryClient, queryFn, queryHash]);

  useEffect(() => {
    if (queryState?.data) return;
    void queryClient.fetchQuery({
      queryKey,
      queryFn,
      staleTime: SESSION_SNAPSHOT_STALE_TIME_MS,
    }).catch(() => undefined);
  }, [queryClient, queryFn, queryHash, queryState?.data]);

  return {
    data: queryState?.data,
    dataUpdatedAt: queryState?.dataUpdatedAt ?? 0,
    error: queryState?.error,
    isLoading: !queryState || queryState.status === "pending",
    isFetching: queryState?.fetchStatus === "fetching",
    isError: queryState?.status === "error",
    isFetched: queryState?.status === "success" || queryState?.status === "error",
    refetch,
  };
}

function messageHasVisibleAssistantOutput(message: UIMessage) {
  if (message.role !== "assistant") return false;
  return message.parts.some((part) => {
    if ("text" in part && typeof part.text === "string") return part.text.trim().length > 0;
    return part.type === "dynamic-tool" || part.type === "file";
  });
}

function sessionHasOpenTodos(todos: TodoItem[] | undefined) {
  return (todos ?? []).some((todo) => {
    if (!todo.content.trim()) return false;
    return todo.status !== "completed" && todo.status !== "cancelled";
  });
}

function TodoPanel(props: { todos: TodoItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const todos = props.todos.filter((todo) => todo.content.trim());
  const completedTodos = todos.filter((todo) => todo.status === "completed").length;
  const hasOpenTodo = todos.some((todo) => todo.status !== "completed" && todo.status !== "cancelled");
  const progressLabel = t("session.todo_progress_label");
  const label = expanded ? progressLabel : `${progressLabel} · ${completedTodos}/${todos.length}`;

  // Hide when every item is done/cancelled — otherwise a finished earlier plan
  // keeps 「进度 · 4/4」 on unrelated follow-ups (ses_049432e88ffe*).
  if (todos.length === 0 || !hasOpenTodo) return null;

  return (
    <div className="overflow-hidden border-b border-dls-border bg-transparent">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-xs text-gray-9 transition-colors hover:bg-gray-2/50"
          onClick={() => setExpanded((current) => !current)}
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-11">{label}</span>
          </div>
          <Minimize2 size={12} className={`text-gray-8 transition-transform ${expanded ? "" : "rotate-180"}`} />
        </button>
        {expanded ? (
          <div className="max-h-60 space-y-2.5 overflow-auto border-t border-dls-border px-4 pb-3">
            {todos.map((todo, index) => {
              const done = todo.status === "completed";
              const cancelled = todo.status === "cancelled";
              const active = todo.status === "in_progress";
              return (
                <div key={todo.id} className="flex items-start gap-2.5 pt-2.5 first:pt-2.5">
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <div
                      className={`flex size-4.5 items-center justify-center rounded-full border ${
                        done
                          ? "border-green-6 bg-green-2 text-green-11"
                          : active
                            ? "border-amber-6 bg-amber-2 text-amber-11"
                            : cancelled
                              ? "border-gray-6 bg-gray-2 text-gray-8"
                              : "border-gray-6 bg-gray-1 text-gray-8"
                      }`}
                    >
                      {done ? <Check size={10} /> : active ? <span className="size-1.5 rounded-full bg-amber-9" /> : null}
                    </div>
                  </div>
                  <div className={`flex-1 text-sm leading-relaxed ${cancelled ? "text-gray-9 line-through" : "text-gray-12"}`}>
                    <span className="mr-1.5 text-gray-9">{index + 1}.</span>
                    {todo.content}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
    </div>
  );
}

function parseSessionError(thrown: unknown): SessionError {
  if (thrown instanceof Error && thrown.name === "WodeAppSendBlockedError") {
    const reason = (thrown as Error & { reason?: string }).reason;
    if (reason === "login") {
      return { message: thrown.message || "请先登录后再发送", kind: "auth-required" };
    }
    if (reason === "recharge") {
      return { message: thrown.message || "积分不足，请充值或领取每日积分", kind: "insufficient-credits" };
    }
    return { message: thrown.message || "账号未就绪，请稍后重试", kind: "provider-not-ready" };
  }

  const raw = thrown instanceof Error ? thrown.message : String(thrown);
  // Try to detect ProviderModelNotFoundError from the SDK error shape.
  // The error message may be a JSON string from our serializer in session-route.
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.name === "ProviderModelNotFoundError" && parsed?.data) {
      const { providerID, modelID, suggestions } = parsed.data;
      return {
        message: `Model ${providerID}/${modelID} is not available.`,
        kind: "model-not-found",
        failedModel: { providerID, modelID },
        suggestions: Array.isArray(suggestions) ? suggestions : [],
      };
    }
  } catch {
    // Not JSON — fall through to plain message
  }
  // Check if the raw string mentions model-not-found patterns
  if (/ProviderModelNotFoundError/i.test(raw) || /model.*not found/i.test(raw)) {
    return { message: raw, kind: "model-not-found" };
  }
  if (/INSUFFICIENT_CREDITS/i.test(raw) || raw.includes("积分不足") || /Status:\s*402/i.test(raw)) {
    return { message: "积分不足，请充值或领取每日积分", kind: "insufficient-credits" };
  }
  if (/AUTH_REQUIRED/i.test(raw) || raw.includes("请先登录")) {
    return { message: "请先登录后再发送", kind: "auth-required" };
  }
  return { message: raw || "Failed to send prompt." };
}

function SessionErrorCard({ error, onDismiss, onChangeModel, onOpenModelPicker }: {
  error: SessionError;
  onDismiss: () => void;
  onChangeModel?: (model: { providerID: string; modelID: string }) => void;
  onOpenModelPicker?: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[720px] px-3 py-3 sm:px-5">
      <div className="min-w-0 max-w-full overflow-hidden rounded-2xl border border-red-6/30 bg-red-3/15 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="min-w-0 break-words text-sm font-medium text-red-11">{error.message}</div>
            {error.kind === "model-not-found" ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {error.suggestions && error.suggestions.length > 0 ? (
                  error.suggestions.map((s) => (
                    <button
                      key={`${s.providerID}/${s.modelID}`}
                      type="button"
                      className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-full border border-dls-border bg-dls-surface px-3 py-1.5 text-xs font-medium text-dls-text transition-colors hover:bg-dls-hover"
                      onClick={() => {
                        onChangeModel?.(s);
                        onDismiss();
                      }}
                    >
                      Use {s.providerID}/{s.modelID}
                    </button>
                  ))
                ) : null}
                <button
                  type="button"
                  className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-full border border-dls-border bg-dls-surface px-3 py-1.5 text-xs font-medium text-dls-text transition-colors hover:bg-dls-hover"
                  onClick={() => {
                    onOpenModelPicker?.();
                    onDismiss();
                  }}
                >
                  Change model
                </button>
              </div>
            ) : null}
            {error.kind === "auth-required" ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-full border border-dls-border bg-dls-surface px-3 py-1.5 text-xs font-medium text-dls-text transition-colors hover:bg-dls-hover"
                  onClick={() => {
                    window.dispatchEvent(new Event(WODEAPP_OPEN_LOGIN_EVENT));
                    onDismiss();
                  }}
                >
                  去登录
                </button>
              </div>
            ) : null}
            {error.kind === "insufficient-credits" ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="max-w-full overflow-hidden text-ellipsis whitespace-nowrap rounded-full border border-dls-border bg-dls-surface px-3 py-1.5 text-xs font-medium text-dls-text transition-colors hover:bg-dls-hover"
                  onClick={() => {
                    window.dispatchEvent(new Event(WODEAPP_OPEN_RECHARGE_EVENT));
                    onDismiss();
                  }}
                >
                  去充值
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="shrink-0 rounded-full p-1 text-red-10 transition-colors hover:bg-red-3 hover:text-red-11"
            onClick={onDismiss}
            aria-label="Dismiss error"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function mergeWodeAppAgentTextIntoDraft(draft: ComposerDraft, agentText: string): ComposerDraft {
  const promptText = (draft.resolvedText ?? draft.text).trim();
  const instructionText = agentText.trim();
  if (!instructionText || instructionText === promptText) return draft;
  const systemContext = [draft.systemContext?.trim(), instructionText]
    .filter(Boolean)
    .join("\n\n");
  return {
    ...draft,
    // Keep the user's natural wording as the persisted user turn. Internal
    // orchestration belongs in the system channel so it cannot teach the
    // capability router the expected tools or leak into the transcript.
    resolvedText: promptText,
    systemContext,
  };
}

function dedupeDraftAssetMentions(refs: NonNullable<ComposerDraft["assetMentions"]>): NonNullable<ComposerDraft["assetMentions"]> {
  const seen = new Set<string>();
  return refs.filter((ref) => {
    const id = ref.id.trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function SessionSurface(props: SessionSurfaceProps) {
  const local = useLocal();
  const queryClient = useQueryClient();
  const { config: shellConfig } = useShellConfig();
  const wodeAppWorkbench = useOptionalWodeAppWorkbench();
  const showFeishuAuthorizationPrompt = Boolean(
    shellConfig.wodeappWorkbench
    && wodeAppWorkbench?.feishuAuthorizationPrompt?.sessionId === props.sessionId,
  );
  const showThinking = local.prefs.showThinking;
  const sessionActivityStatus = useSessionActivityStore(
    (state) => state.statusesByWorkspaceId[props.workspaceId]?.[props.sessionId] ?? "idle",
  );
  const draft = useComposerStateStore((state) => getComposerDraft(state, props.sessionId));
  const attachments = useComposerStateStore((state) => getComposerAttachments(state, props.sessionId));
  const mentions = useComposerStateStore((state) => getComposerMentions(state, props.sessionId));
  const pasteParts = useComposerStateStore((state) => getComposerPasteParts(state, props.sessionId));
  const setComposerDraft = useComposerStateStore((state) => state.setDraft);
  const setComposerAttachments = useComposerStateStore((state) => state.setAttachments);
  const setComposerMentions = useComposerStateStore((state) => state.setMentions);
  const setComposerPasteParts = useComposerStateStore((state) => state.setPasteParts);
  const clearComposerSession = useComposerStateStore((state) => state.clearSession);
  const inputHistory = useComposerStateStore((state) => getComposerHistory(state, props.sessionId));
  const appendComposerHistory = useComposerStateStore((state) => state.appendHistory);
  // Queued follow-up drafts live in the shared composer store keyed by session
  // id. That keeps a queued message in session A from being drained into
  // session B when the route swaps the same surface component to another
  // session.
  const queuedDrafts = useComposerStateStore((state) => getComposerQueuedDrafts(state, props.sessionId));
  const appendQueuedDraft = useComposerStateStore((state) => state.appendQueuedDraft);
  const removeQueuedDraftFromStore = useComposerStateStore((state) => state.removeQueuedDraft);
  const updateQueuedDraftTextInStore = useComposerStateStore((state) => state.updateQueuedDraftText);
  const clearQueuedDrafts = useComposerStateStore((state) => state.clearQueuedDrafts);
  const prependQueuedDrafts = useComposerStateStore((state) => state.prependQueuedDrafts);
  const [error, setError] = useState<SessionError | null>(null);
  const [sending, setSending] = useState(false);
  const [pendingRevertMessageId, setPendingRevertMessageId] = useState<string | null>(null);
  const [optimisticUserMessage, setOptimisticUserMessage] = useState<UIMessage | null>(null);
  const [optimisticUserBaseline, setOptimisticUserBaseline] = useState<number | null>(null);
  const [revertBusy, setRevertBusy] = useState(false);
  const [attachmentUnderstandingLabel, setAttachmentUnderstandingLabel] = useState<string | null>(null);
  const [showDelayedLoading, setShowDelayedLoading] = useState(false);
  const [awaitingAssistantBaseline, setAwaitingAssistantBaseline] = useState<number | null>(null);
  const [rendered, setRendered] = useState<{ sessionId: string; snapshot: OpenworkSessionSnapshot } | null>(null);
  const [toolSkills, setToolSkills] = useState<SkillCard[]>([]);
  const [toolMcpServers, setToolMcpServers] = useState<McpServerEntry[]>([]);
  const [toolMcpStatus, setToolMcpStatus] = useState<string | null>(null);
  const [toolMcpStatuses, setToolMcpStatuses] = useState<McpStatusMap>({});
  const [toolImportedPlugins, setToolImportedPlugins] = useState<CloudImportedPlugin[]>([]);
  const [verifiedOpenTargets, setVerifiedOpenTargets] = useState<OpenTarget[]>([]);
  const [historyExhausted, setHistoryExhausted] = useState(false);
  const historyLoadInFlightRef = useRef(false);
  const composerShellRef = useRef<HTMLDivElement>(null);
  const hydratedKeyRef = useRef<string | null>(null);
  const autoOpenedTargetRef = useRef<string | null>(null);
  const initializedAutoOpenSessionRef = useRef<string | null>(null);
  const streamingPerfStateRef = useRef<{ sessionId: string; chatStreaming: boolean } | null>(null);
  const opencodeClient = useMemo(
    () => createClient(props.opencodeBaseUrl, undefined, { token: props.openworkToken, mode: "openwork" }),
    [props.opencodeBaseUrl, props.openworkToken],
  );

  const snapshotQueryKey = useMemo(
    () => reactSnapshotKey(props.workspaceId, props.sessionId),
    [props.workspaceId, props.sessionId],
  );
  const transcriptQueryKey = useMemo(
    () => reactTranscriptKey(props.workspaceId, props.sessionId),
    [props.workspaceId, props.sessionId],
  );
  const statusQueryKey = useMemo(
    () => reactStatusKey(props.workspaceId, props.sessionId),
    [props.workspaceId, props.sessionId],
  );
  const fetchSessionSnapshot = useCallback(async () =>
    slimOpenworkSessionSnapshot(
      (
        await props.client.getSessionSnapshot(props.workspaceId, props.sessionId, {
          limit: SESSION_SNAPSHOT_MESSAGE_LIMIT,
        })
      ).item,
    ), [props.client, props.sessionId, props.workspaceId]);
  const snapshotQuery = useSessionSnapshotQuery(snapshotQueryKey, fetchSessionSnapshot);

  const currentSnapshot = snapshotQuery.data?.session.id === props.sessionId ? snapshotQuery.data : null;
  const transcriptState = useSharedQueryState<UIMessage[]>(transcriptQueryKey, EMPTY_TRANSCRIPT);
  const statusState = useSharedQueryState(statusQueryKey, currentSnapshot?.status ?? IDLE_STATUS);

  useEffect(() => {
    if (!currentSnapshot) return;
    setRendered({
      sessionId: props.sessionId,
      snapshot: slimOpenworkSessionSnapshot(currentSnapshot),
    });
  }, [props.sessionId, currentSnapshot]);

  useEffect(() => {
    hydratedKeyRef.current = null;
    setError(null);
    setSending(false);
    setOptimisticUserMessage(null);
    setOptimisticUserBaseline(null);
    setPendingRevertMessageId(null);
    setRevertBusy(false);
    setAttachmentUnderstandingLabel(null);
    setShowDelayedLoading(false);
    setAwaitingAssistantBaseline(null);
    setHistoryExhausted(false);
    historyLoadInFlightRef.current = false;
    // Composer draft state lives in the shared store keyed by session id, so
    // switching sessions preserves each session's own in-progress composer.
    autoOpenedTargetRef.current = null;
    initializedAutoOpenSessionRef.current = null;
    setVerifiedOpenTargets([]);
  }, [props.sessionId]);

  // Publish a composer inspector slice so external drivers can read draft
  // state, attachments, mentions, and sending status from the running app.
  useEffect(() => {
    const dispose = publishInspectorSlice("composer", () => ({
      workspaceId: props.workspaceId,
      sessionId: props.sessionId,
      draft,
      draftLength: draft.length,
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        kind: attachment.kind,
      })),
      mentions,
      pasteParts: pasteParts.map((part) => ({
        id: part.id,
        label: part.label,
        lines: part.lines,
      })),
      sending,
      error,
    }));
    return dispose;
  }, [
    attachments,
    draft,
    error,
    mentions,
    pasteParts,
    props.sessionId,
    props.workspaceId,
    sending,
  ]);

  useEffect(() => {
    recordInspectorEvent("session.mounted", {
      workspaceId: props.workspaceId,
      sessionId: props.sessionId,
    });
  }, [props.sessionId, props.workspaceId]);

  useEffect(() => {
    if (!currentSnapshot) return;
    const key = `${props.sessionId}:${currentSnapshot.session.time?.updated ?? currentSnapshot.session.time?.created ?? 0}:${currentSnapshot.messages.length}`;
    if (hydratedKeyRef.current === key) return;
    hydratedKeyRef.current = key;
    seedSessionState(props.workspaceId, currentSnapshot);
  }, [props.sessionId, currentSnapshot, props.workspaceId]);

  const snapshot = resolveRenderedSessionSnapshot({
    sessionId: props.sessionId,
    currentSnapshot,
    cachedRendered: rendered,
  });
  const liveStatus = statusState ?? snapshot?.status ?? IDLE_STATUS;
  const hasPendingAssistantTurn = awaitingAssistantBaseline !== null;
  const hasAbortableOpenCodeRun =
    sending
    || liveStatus.type === "busy"
    || liveStatus.type === "retry";
  const hasWodeAppLocalActivity =
    shellConfig.wodeappWorkbench && (hasPendingAssistantTurn || isBlockingSessionActivityStatus(sessionActivityStatus));
  const chatStreaming = hasAbortableOpenCodeRun || hasWodeAppLocalActivity;
  const snapshotQueryRef = useRef(snapshotQuery);
  snapshotQueryRef.current = snapshotQuery;

  useEffect(() => {
    if (!chatStreaming) return;
    let disposed = false;
    let refreshing = false;

    const refreshActiveRun = async () => {
      if (disposed || refreshing) return;
      // Skip if the mount/prefetch snapshot is still fresh — staleTime:0 on every
      // switch made busy sessions pay for a duplicate 300–700KB snapshot fetch
      // on the first paint tick.
      const query = snapshotQueryRef.current;
      const updatedAt = query.dataUpdatedAt || 0;
      if (updatedAt > 0 && Date.now() - updatedAt < 1_500) return;
      refreshing = true;
      try {
        const result = await query.refetch();
        if (!disposed && result.data?.session.id === props.sessionId) {
          // Live events can be interrupted while the sidecar reconnects. The
          // snapshot is authoritative and must also refresh the shared status
          // cache, otherwise the UI can remain on "Thinking" indefinitely.
          seedSessionState(props.workspaceId, result.data);
        }
      } catch {
        // The normal query error state remains responsible for user-visible
        // fetch failures; this watchdog only repairs missed live events.
      } finally {
        refreshing = false;
      }
    };

    // Let session-switch first paint + mount fetch finish before the watchdog.
    const bootTimer = window.setTimeout(() => void refreshActiveRun(), 2_000);
    const interval = window.setInterval(() => void refreshActiveRun(), 2500);
    return () => {
      disposed = true;
      window.clearTimeout(bootTimer);
      window.clearInterval(interval);
    };
  }, [
    chatStreaming,
    props.sessionId,
    props.workspaceId,
  ]);

  // Idle but transcript still has tool.status=running (orphaned task/child).
  // Keep a light snapshot poll so grace timers arm and reconcile can fire —
  // the busy watchdog above stops once liveStatus flips to idle.
  useEffect(() => {
    if (chatStreaming) return;
    if (liveStatus.type !== "idle") return;
    if (!snapshotHasInFlightRunningTool(snapshotQuery.data)) return;
    let disposed = false;
    let refreshing = false;
    const refreshOrphan = async () => {
      if (disposed || refreshing) return;
      refreshing = true;
      try {
        const result = await snapshotQueryRef.current.refetch();
        if (!disposed && result.data?.session.id === props.sessionId) {
          seedSessionState(props.workspaceId, result.data);
        }
      } catch {
        // ignore — recovery effect uses latest snapshot when available
      } finally {
        refreshing = false;
      }
    };
    const bootTimer = window.setTimeout(() => void refreshOrphan(), 1_000);
    const interval = window.setInterval(() => void refreshOrphan(), 3_000);
    return () => {
      disposed = true;
      window.clearTimeout(bootTimer);
      window.clearInterval(interval);
    };
  }, [
    chatStreaming,
    liveStatus.type,
    props.sessionId,
    props.workspaceId,
    snapshotQuery.data,
    snapshotQuery.dataUpdatedAt,
  ]);

  const status = useMemo((): ThreadStatus => {
    if (liveStatus.type === "retry") {
      return "retrying";
    }

    if (liveStatus.type === "busy") {
      return "streaming";
    }

    if (sending || hasWodeAppLocalActivity) {
      return "submitted";
    }

    return "ready";
  }, [hasWodeAppLocalActivity, liveStatus.type, sending]);
  // Snapshot conversion is independent from live token updates. Keep the
  // expensive part mapping out of the per-frame streaming render path.
  const snapshotMessages = useMemo(
    () => snapshot && snapshot.messages.length > 0 ? snapshotToUIMessages(snapshot) : EMPTY_TRANSCRIPT,
    [snapshot],
  );
  const renderedMessages = useMemo(
    () => deriveRenderedSessionMessages({ transcriptState, snapshot, snapshotMessages }),
    [snapshot, snapshotMessages, transcriptState],
  );
  useEffect(() => {
    void bindCustomAgentHomeFromCreateSession(props.sessionId, snapshot?.messages ?? renderedMessages);
  }, [props.sessionId, renderedMessages, snapshot]);
  useEffect(() => {
    if (!shouldClearOptimisticUserMessage(optimisticUserMessage, renderedMessages, {
      baselineMessageCount: optimisticUserBaseline,
    })) return;
    setOptimisticUserMessage(null);
    setOptimisticUserBaseline(null);
  }, [optimisticUserBaseline, optimisticUserMessage, renderedMessages]);
  const conversationMessages = useMemo(
    () => mergeOptimisticUserMessage(
      renderedMessages.filter((message) => !isSilentAutoContinueUserMessage(message)),
      optimisticUserMessage,
      { baselineMessageCount: optimisticUserBaseline },
    ),
    [optimisticUserBaseline, optimisticUserMessage, renderedMessages],
  );

  const handleLoadEarlierHistory = useCallback(async () => {
    if (historyExhausted || historyLoadInFlightRef.current) {
      return { added: 0, exhausted: historyExhausted };
    }
    historyLoadInFlightRef.current = true;
    try {
      const result = await loadEarlierSessionHistory({
        client: props.client,
        workspaceId: props.workspaceId,
        sessionId: props.sessionId,
        currentCount: conversationMessages.length,
        batch: HISTORY_LOAD_BATCH,
      });
      if (result.exhausted) setHistoryExhausted(true);
      return { added: result.added, exhausted: result.exhausted };
    } catch (error) {
      console.warn("[wodeapp] load earlier session history failed", error);
      return { added: 0, exhausted: false };
    } finally {
      historyLoadInFlightRef.current = false;
    }
  }, [
    conversationMessages.length,
    historyExhausted,
    props.client,
    props.sessionId,
    props.workspaceId,
  ]);

  // Keep product_save able to resolve bare filenames after app restart by
  // re-indexing any data:image file parts still present in this session.
  useEffect(() => {
    if (!shellConfig.wodeappWorkbench || !props.sessionId) return;
    const images: Array<{ filename: string; dataUrl: string }> = [];
    for (const message of renderedMessages) {
      for (const part of message.parts) {
        if (part.type !== "file") continue;
        const url = typeof part.url === "string" ? part.url.trim() : "";
        const filename = typeof part.filename === "string" ? part.filename.trim() : "";
        if (!filename || !url.startsWith("data:image/")) continue;
        images.push({ filename, dataUrl: url });
      }
    }
    if (!images.length) return;
    registerSessionProductImagePixels({
      sessionId: props.sessionId,
      images,
      includeInCurrentTurn: false,
    });
  }, [props.sessionId, renderedMessages, shellConfig.wodeappWorkbench]);
  const renderedMessageStats = useMemo(() => {
    let assistantMessageCount = 0;
    let assistantTextCharCount = 0;
    let partCount = 0;
    let toolPartCount = 0;
    for (const message of renderedMessages) {
      if (message.role === "assistant") assistantMessageCount += 1;
      for (const part of message.parts) {
        partCount += 1;
        const partType = String(part.type);
        if (partType.includes("tool")) toolPartCount += 1;
        if (message.role === "assistant" && "text" in part && typeof part.text === "string") {
          assistantTextCharCount += part.text.length;
        }
      }
    }
    return {
      assistantMessageCount,
      assistantTextCharCount,
      partCount,
      toolPartCount,
    };
  }, [renderedMessages]);
  const openTargets = useMemo(() => deriveOpenTargets(renderedMessages), [renderedMessages]);
  const openTargetsFingerprint = useMemo(
    () => openTargets.map((target) => `${target.kind}:${target.value}:${target.confidence}`).join("|"),
    [openTargets],
  );
  const autoOpenTarget = selectAutoOpenTarget(verifiedOpenTargets);
  // Cold switch / HMR remount can leave messages empty while the snapshot is
  // still in flight (or not yet fetched). Treat that as loading — never as a
  // brand-new empty chat welcome (ses_02ff883a* 「清理 500G」回归).
  const pendingSessionLoad = shouldShowPendingSessionLoad({
    hasSnapshot: Boolean(snapshot),
    messageCount: renderedMessages.length,
    snapshotError: snapshotQuery.isError,
    snapshotLoading: snapshotQuery.isLoading,
    snapshotFetching: snapshotQuery.isFetching,
    snapshotFetched: snapshotQuery.isFetched,
  });
  const assistantOutputAfterAwaitStart = useMemo(() => {
    if (awaitingAssistantBaseline === null) return false;
    return renderedMessages
      .slice(awaitingAssistantBaseline)
      .some(messageHasVisibleAssistantOutput);
  }, [awaitingAssistantBaseline, renderedMessages]);
  const showAssistantWaitState = awaitingAssistantBaseline !== null && !assistantOutputAfterAwaitStart;
  const showAssistantRespondingState = awaitingAssistantBaseline !== null && assistantOutputAfterAwaitStart && chatStreaming;
  const effectiveActivityStatus: SessionActivityStatus = sessionActivityStatus !== "idle"
    ? sessionActivityStatus
    : showAssistantWaitState
      ? "thinking"
      : showAssistantRespondingState
        ? "responding"
        : "idle";
  useReactRenderWatchdog("SessionSurface", {
    sessionId: props.sessionId,
    workspaceId: props.workspaceId,
    messageCount: renderedMessages.length,
    snapshotMessageCount: snapshot?.messages.length ?? 0,
    transcriptMessageCount: transcriptState.length,
    ...renderedMessageStats,
    liveStatus: liveStatus.type,
    sessionActivityStatus,
    chatStreaming,
    sending,
    pendingSessionLoad,
    showAssistantWaitState,
    showAssistantRespondingState,
    openTargetCount: openTargets.length,
    verifiedOpenTargetCount: verifiedOpenTargets.length,
    queuedDraftCount: queuedDrafts.length,
    hasSnapshot: Boolean(snapshot),
    wodeappWorkbench: shellConfig.wodeappWorkbench,
  });

  useEffect(() => {
    const previous = streamingPerfStateRef.current;
    const changed = previous?.sessionId !== props.sessionId || previous.chatStreaming !== chatStreaming;
    if (!changed) return;
    streamingPerfStateRef.current = { sessionId: props.sessionId, chatStreaming };
    if (!chatStreaming && previous?.sessionId !== props.sessionId) return;
    recordDebugLog({
      level: "perf",
      source: "session-surface",
      message: "session.streaming_state",
      extra: {
        workspaceId: props.workspaceId,
        sessionId: props.sessionId,
        chatStreaming,
        liveStatus: liveStatus.type,
        sessionActivityStatus,
        sending,
        messageCount: renderedMessages.length,
        snapshotMessageCount: snapshot?.messages.length ?? 0,
        transcriptMessageCount: transcriptState.length,
        openTargetCount: openTargets.length,
        verifiedOpenTargetCount: verifiedOpenTargets.length,
        queuedDraftCount: queuedDrafts.length,
        ...renderedMessageStats,
      },
    });
  }, [
    chatStreaming,
    liveStatus.type,
    openTargets.length,
    props.sessionId,
    props.workspaceId,
    queuedDrafts.length,
    renderedMessageStats,
    renderedMessages.length,
    sending,
    sessionActivityStatus,
    snapshot?.messages.length,
    transcriptState.length,
    verifiedOpenTargets.length,
  ]);

  useEffect(() => {
    if (!autoOpenTarget) return;
    if (autoOpenedTargetRef.current === autoOpenTarget.id) return;
    autoOpenedTargetRef.current = autoOpenTarget.id;
    props.onOpenTarget?.(autoOpenTarget, { auto: true }, props.sessionId);
  }, [autoOpenTarget, props.onOpenTarget, props.sessionId]);

  useEffect(() => {
    let cancelled = false;
    function initializeAutoOpenState(targets: OpenTarget[]) {
      if (initializedAutoOpenSessionRef.current === props.sessionId) return;
      initializedAutoOpenSessionRef.current = props.sessionId;
      autoOpenedTargetRef.current = selectAutoOpenTarget(targets)?.id ?? null;
    }

    async function verifyTargets() {
      if (!openTargets.length) {
        initializeAutoOpenState([]);
        setVerifiedOpenTargets([]);
        return;
      }
      try {
        const resolvableTargets = openTargets.filter(
          (target): target is OpenTarget & { kind: "url" | "file" } => target.kind !== "directory",
        );
        const resolvedItems = resolvableTargets.length
          ? (await props.client.resolveArtifacts(props.workspaceId, resolvableTargets)).items
          : [];
        if (!cancelled) {
          const nextTargets = augmentResolvedOpenTargets(openTargets, resolvedItems as OpenTarget[]);
          initializeAutoOpenState(nextTargets);
          setVerifiedOpenTargets(nextTargets);
        }
      } catch {
        if (!cancelled) {
          const nextTargets = augmentResolvedOpenTargets(
            openTargets,
            openTargets.map((target) => ({ ...target, exists: target.kind === "url" || target.kind === "directory" })),
          );
          initializeAutoOpenState(nextTargets);
          setVerifiedOpenTargets(nextTargets);
        }
      }
    }
    void verifyTargets();
    return () => { cancelled = true; };
  }, [openTargetsFingerprint, props.client, props.sessionId, props.workspaceId]);

  useEffect(() => {
    usePanelTabStore.getState().syncTranscriptArtifacts(props.sessionId, verifiedOpenTargets);
  }, [props.sessionId, verifiedOpenTargets]);

  useEffect(() => {
    if (!pendingSessionLoad) {
      setShowDelayedLoading(false);
      return;
    }
    const id = window.setTimeout(() => setShowDelayedLoading(true), 350);
    return () => window.clearTimeout(id);
  }, [pendingSessionLoad]);

  useEffect(() => {
    if (awaitingAssistantBaseline === null) return;
    if (sending || liveStatus.type !== "idle") return;
    if (assistantOutputAfterAwaitStart) {
      setAwaitingAssistantBaseline(null);
      return;
    }
    // Do NOT clear just because transcript length grew (user message.updated
    // shell). That left status=ready with an empty assistant group →
    // EmptyMessage「代理未返回任何内容」during the OpenWork Thinking spinner
    // window, before custom「思考中」reasoning arrives (ses_0490d614).
    // Keep submitted until visible assistant output or a long idle grace so
    // empty-visible-reply recovery / queue drain can still proceed.
    const id = window.setTimeout(() => {
      setAwaitingAssistantBaseline(null);
    }, 10_000);
    return () => window.clearTimeout(id);
  }, [assistantOutputAfterAwaitStart, awaitingAssistantBaseline, liveStatus.type, sending]);

  // Settle sticky local activity once OpenCode is idle so Stop/queue UI and
  // auto-drain are not blocked by a lagged "responding/thinking" record.
  useEffect(() => {
    if (sending || liveStatus.type !== "idle") return;
    if (!isBlockingSessionActivityStatus(sessionActivityStatus)) return;
    useSessionActivityStore.getState().setRunStatus(props.workspaceId, props.sessionId, { type: "idle" });
  }, [liveStatus.type, props.sessionId, props.workspaceId, sending, sessionActivityStatus]);

  const model = deriveSessionRenderModel({
    intendedSessionId: props.sessionId,
    renderedSessionId: renderedMessages.length > 0 || snapshot ? props.sessionId : null,
    hasSnapshot: Boolean(snapshot) || renderedMessages.length > 0,
    isFetching: snapshotQuery.isFetching,
    isError: snapshotQuery.isError || Boolean(error),
  });

  const buildDraft = useCallback((
    text: string,
    nextAttachments: ComposerAttachment[],
    mentionOverrides: Record<string, ComposerMentionKind> = mentions,
  ): ComposerDraft => {
    const parts: ComposerPart[] = text.split(/(\[pasted text [^\]]+\]|\[skill [^\]]+\]|@[^\s@]+)/).flatMap((segment) => {
      if (!segment) return [] as ComposerDraft["parts"];
      const pasteMatch = segment.match(/^\[pasted text (.+)\]$/);
      if (pasteMatch) {
        const target = pasteParts.find((item) => item.label === pasteMatch[1]);
        if (target) {
          return [{ type: "paste", id: target.id, label: target.label, text: target.text, lines: target.lines }];
        }
      }
      const skillMatch = segment.match(/^\[skill (.+)\]$/);
      if (skillMatch?.[1]) {
        return [{ type: "skill", name: skillMatch[1] } satisfies ComposerDraft["parts"][number]];
      }
      if (segment.startsWith("@")) {
        const value = decodeComposerMentionValue(segment.slice(1));
        const kind = mentionOverrides[value];
        if (kind === "agent") return [{ type: "agent", name: value } satisfies ComposerDraft["parts"][number]];
        if (kind === "file") return [{ type: "file", path: value, label: value } satisfies ComposerDraft["parts"][number]];
        if (kind === "app") return [{ type: "app", name: value } satisfies ComposerDraft["parts"][number]];
        if (kind === "asset") return [];
      }
      return [{ type: "text", text: segment } satisfies ComposerDraft["parts"][number]];
    });
    // Expand paste placeholders in resolvedText so the model receives
    // the actual pasted content instead of "[pasted text <label>]".
    let resolved = text;
    for (const part of pasteParts) {
      resolved = resolved.replace(`[pasted text ${part.label}]`, part.text);
    }
    resolved = resolved.replace(/\[skill ([^\]]+)\]/g, (_match, name: string) => `the \"${name}\" skill`);
    for (const value of Object.keys(mentionOverrides)) {
      resolved = resolved.replaceAll(`@${encodeComposerMentionValue(value)}`, `@${value}`);
    }
    const assetRefs = resolveAssetMentionsFromValues(collectComposerMentionValues(text, mentionOverrides, "asset"));
    if (assetRefs.length > 0) {
      resolved = appendAssetContextToPrompt(resolved, assetRefs, { sessionId: props.sessionId });
    }
    const slashCommand = parseSlashCommandInvocation(resolved);
    return {
      mode: "prompt",
      parts,
      attachments: nextAttachments,
      text,
      resolvedText: resolved,
      assetMentions: assetRefs,
      mentions: mentionOverrides,
      command: slashCommand ?? undefined,
    };
  }, [mentions, pasteParts, props.sessionId]);

  const handleComposerDraftChange = useCallback((value: string) => {
    setComposerDraft(props.sessionId, value);
  }, [props.sessionId, setComposerDraft]);

  const handleCopyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(transcriptToText(renderedMessages));
    } catch (nextError) {
      setError({ message: nextError instanceof Error ? nextError.message : "Failed to copy transcript." });
    }
  };

  // Core sender shared by initial send and steered follow-ups. OpenCode
  // accepts follow-up user turns mid-run (steering) — the running loop picks
  // up the new message — so this is safe to call while the agent is busy.
  const liveStatusTypeRef = useRef(liveStatus.type);
  liveStatusTypeRef.current = liveStatus.type;
  const sendingClearFallbackRef = useRef<number | null>(null);
  // Manual Stop latch — shared by sendDraft / handleAbort / silent recoveries.
  const userStoppedRef = useRef(false);
  const sendDraft = useCallback(async (nextDraft: ComposerDraft, draftAttachments: ComposerAttachment[]) => {
    const silentAutoContinue = isStuckToolAutoContinueText(nextDraft.text)
      || isStuckToolAutoContinueText(nextDraft.resolvedText);
    const promptText = (nextDraft.resolvedText ?? nextDraft.text ?? "").trim();
    beginHangTurnTrace(props.sessionId, {
      kind: silentAutoContinue ? "auto_continue" : "user_send",
      textChars: promptText.length,
      attachmentCount: draftAttachments.length,
      workspaceId: props.workspaceId,
    });
    if (silentAutoContinue) {
      hangTraceLog({
        layer: "recovery",
        event: "auto_continue.attempt",
        sessionId: props.sessionId,
        workspaceId: props.workspaceId,
        fields: {
          systemContextChars: String(nextDraft.systemContext || "").length,
        },
      });
    }
    setError(null);
    // Record the prompt for Up/Down recall in the composer (#2012).
    // System auto-continue must never enter the user's recall history.
    // A real user send clears the manual-Stop latch so future stuck recovery
    // may auto-continue again.
    if (!silentAutoContinue) {
      userStoppedRef.current = false;
      appendComposerHistory(props.sessionId, nextDraft.text);
    }
    useSessionActivityStore.getState().setRunStatus(props.workspaceId, props.sessionId, { type: "busy" });
    setSending(true);
    setAwaitingAssistantBaseline(renderedMessages.length);
    if (sendingClearFallbackRef.current !== null) {
      window.clearTimeout(sendingClearFallbackRef.current);
      sendingClearFallbackRef.current = null;
    }
    try {
      // Sending a message must not mutate a business library or rewrite the
      // user's task. Attachments stay as conversation inputs until attachment
      // understanding finishes; explicit domain actions such as
      // `wodeapp.product.save` own the eventual transactional write.
      // Optimistic user bubble is shown before this await; SSE replaces it when
      // the server echoes the real user turn into `renderedMessages`.
      await props.onSendDraft(nextDraft, props.sessionId, setAttachmentUnderstandingLabel);
      hangTraceLog({
        layer: silentAutoContinue ? "recovery" : "ui",
        event: silentAutoContinue ? "auto_continue.sent" : "prompt.sent",
        sessionId: props.sessionId,
        workspaceId: props.workspaceId,
        fields: {
          textChars: promptText.length,
          attachmentCount: draftAttachments.length,
        },
      });
      // `sending` normally clears when liveStatus transitions to idle. If the
      // session was already idle and never leaves (or the busy event is missed),
      // that transition never fires and auto-drain stays blocked forever.
      sendingClearFallbackRef.current = window.setTimeout(() => {
        sendingClearFallbackRef.current = null;
        if (liveStatusTypeRef.current === "idle") {
          setSending(false);
        }
      }, 1500);
    } catch (nextError) {
      let parsed = parseSessionError(nextError);
      if (
        shellConfig.wodeappWorkbench
        && (parsed.kind === "insufficient-credits" || parsed.kind === "auth-required" || parsed.kind === "provider-not-ready")
      ) {
        try {
          const auth = await loadCachedWodeAppAuthState();
          const credits = auth.ok && auth.signedIn && typeof auth.config.credits === "number"
            ? auth.config.credits
            : null;
          const classified = classifyWodeAppCreditGatedError(
            nextError instanceof Error ? nextError.message : String(nextError),
            credits,
            {
              unsigned: !(auth.ok && auth.signedIn),
            },
          );
          if (classified) {
            parsed = { message: classified.message, kind: classified.kind };
          }
        } catch {
          // Keep the first parse if cache read fails.
        }
      }
      captureAnalyticsEvent("task_send_failed", {});
      setError(parsed);
      useSessionActivityStore.getState().setError(props.workspaceId, props.sessionId, parsed.message);
      hangTraceLog({
        layer: silentAutoContinue ? "recovery" : "ui",
        event: "assistant.error",
        sessionId: props.sessionId,
        workspaceId: props.workspaceId,
        fields: {
          stage: "prompt_send",
          kind: parsed.kind || null,
          message: parsed.message.slice(0, 240),
        },
      });
      // Composer was cleared before the server echoed the user turn. On failure
      // there may be no SSE user bubble — restore text/attachments so the prompt
      // does not appear to vanish (ProviderModelNotFound mid-prompt is one case).
      setOptimisticUserMessage(null);
      setOptimisticUserBaseline(null);
      const restoreText = (nextDraft.resolvedText ?? nextDraft.text ?? "").trim();
      setComposerDraft(props.sessionId, restoreText || nextDraft.text || "");
      setComposerAttachments(props.sessionId, draftAttachments);
      if (nextDraft.mentions && Object.keys(nextDraft.mentions).length > 0) {
        setComposerMentions(props.sessionId, nextDraft.mentions);
      }
      props.onDraftChange({
        ...nextDraft,
        text: restoreText || nextDraft.text || "",
        attachments: draftAttachments,
      });
      // Pull any server-persisted user turn that never reached the UI via SSE.
      void queryClient.invalidateQueries({ queryKey: snapshotQueryKey });
      void queryClient.invalidateQueries({ queryKey: transcriptQueryKey });
      setAwaitingAssistantBaseline(null);
      setSending(false);
      throw nextError;
    } finally {
      setAttachmentUnderstandingLabel(null);
    }
  }, [
    appendComposerHistory,
    props.onDraftChange,
    props.onSendDraft,
    props.sessionId,
    props.workspaceId,
    queryClient,
    renderedMessages.length,
    setComposerAttachments,
    setComposerDraft,
    setComposerMentions,
    shellConfig.wodeappWorkbench,
    snapshotQueryKey,
    transcriptQueryKey,
  ]);

  const clearComposer = useCallback(() => {
    clearComposerSession(props.sessionId);
    props.onDraftChange(buildDraft("", []));
  }, [buildDraft, clearComposerSession, props.onDraftChange, props.sessionId]);

  // Drop stale system auto-continue drafts when the user takes over with a
  // real prompt — otherwise the panel keeps showing "已排队 1 条" after send.
  const purgeSilentQueuedDrafts = useCallback(() => {
    const kept = retainNonSilentQueuedDrafts(queuedDrafts, isStuckToolAutoContinueText);
    if (kept.length === queuedDrafts.length) return;
    clearQueuedDrafts(props.sessionId);
    if (kept.length > 0) {
      prependQueuedDrafts(props.sessionId, kept);
    }
  }, [clearQueuedDrafts, prependQueuedDrafts, props.sessionId, queuedDrafts]);

  // Initial send (agent idle) and explicit "Steer" follow-up (agent busy)
  // share the same immediate path.
  const handleSend = useCallback(async () => {
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    let nextDraft = buildDraft(text, attachments);
    const agentText = resolveWodeAppComposerSendText(props.sessionId, text);
    if (agentText !== text) {
      nextDraft = mergeWodeAppAgentTextIntoDraft(nextDraft, agentText);
    }
    const sentAttachments = attachments;
    const displayText = (nextDraft.resolvedText ?? nextDraft.text ?? "").trim() || text;
    // Cursor/Codex: every attachment chip must open a real local file. Materialize
    // durable paths first; if any file still has no path, hard-fail and keep the
    // composer — never paint a non-openable data stub.
    if (sentAttachments.length > 0 && props.sessionId) {
      try {
        const materialize = await materializeComposerAttachmentsForSend({
          sessionId: props.sessionId,
          attachments: sentAttachments,
        });
        if (materialize.pathByAttachmentId.size || materialize.pathByFilename.size) {
          stampComposerAttachmentLocalPaths(
            sentAttachments,
            materialize.pathByFilename,
            materialize.pathByAttachmentId,
          );
        }
      } catch (error) {
        console.warn("[WodeAppX] pre-send attachment materialize failed", error);
      }
      const missingPaths = listComposerAttachmentsMissingLocalPath(sentAttachments);
      if (missingPaths.length > 0) {
        toast.error("无法发送附件", {
          description: `这些文件还没有本机路径，请重新选择后再发：${missingPaths.join("、")}`,
        });
        return;
      }
    }
    // Show the user bubble immediately. clearComposer + await onSendDraft used
    // to leave a blank gap until SSE echoed (ses_049fe53a 「继续」~30s).
    if (!isStuckToolAutoContinueText(displayText)) {
      setOptimisticUserBaseline(renderedMessages.length);
      setOptimisticUserMessage(buildOptimisticUserMessage(
        displayText,
        sentAttachments.map((attachment) => ({
          name: attachment.name,
          mimeType: attachment.mimeType,
          path: desktopLocalFilePath(attachment.file),
          previewUrl: attachment.previewUrl,
          file: attachment.file,
        })),
      ));
    }
    purgeSilentQueuedDrafts();
    clearComposer();
    try {
      await sendDraft(nextDraft, sentAttachments);
    } catch {
      setOptimisticUserMessage(null);
      setOptimisticUserBaseline(null);
    }
  }, [attachments, buildDraft, clearComposer, draft, props.sessionId, purgeSilentQueuedDrafts, renderedMessages.length, sendDraft, setComposerDraft]);

  const handleSteer = handleSend;

  // Queue: hold the draft locally and clear the composer. The drain effect
  // sends it once the session reports idle.
  const handleQueue = useCallback(() => {
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    let nextDraft = buildDraft(text, attachments);
    const agentText = resolveWodeAppComposerSendText(props.sessionId, text);
    if (agentText !== text) {
      nextDraft = mergeWodeAppAgentTextIntoDraft(nextDraft, agentText);
    }
    appendQueuedDraft(props.sessionId, nextDraft);
    clearComposer();
  }, [appendQueuedDraft, attachments, buildDraft, clearComposer, draft, props.sessionId]);

  const removeQueuedDraft = useCallback((index: number) => {
    removeQueuedDraftFromStore(props.sessionId, index);
  }, [props.sessionId, removeQueuedDraftFromStore]);

  // One label per visible queued draft (system auto-continue is hidden from
  // the panel). Indices map back to the full queue for remove / send-now.
  const visibleQueuedEntries = useMemo(
    () => listVisibleQueuedDraftEntries(queuedDrafts, isStuckToolAutoContinueText),
    [queuedDrafts],
  );
  const queuedMessages = useMemo(
    () =>
      visibleQueuedEntries.map(({ draft: draftItem }) => {
        // Always expose the editable text (may be empty when only attachments).
        return draftItem.text;
      }),
    [visibleQueuedEntries],
  );
  const queuedAttachmentHints = useMemo(
    () =>
      visibleQueuedEntries.map(({ draft: draftItem }) =>
        draftItem.text.trim()
          ? null
          : draftItem.attachments.length > 0
            ? t("composer.queued_attachments_only", { count: draftItem.attachments.length })
            : null,
      ),
    [visibleQueuedEntries],
  );

  // Flush queued follow-ups one entry at a time.
  // - `auto-idle`: when OpenCode is idle, send the next entry (silent
  //   auto-continue drafts first so stuck-tool recovery is not merged into
  //   a real user prompt). Remaining entries stay queued until the next idle.
  // - `now`: send the entry at `index` immediately (even mid-run).
  // Gate on hasAbortableOpenCodeRun — not chatStreaming — so sticky local
  // "responding/awaiting" after a finished turn cannot trap the queue.
  const drainingQueueRef = useRef(false);
  const flushQueuedDrafts = useCallback(async (
    mode: "auto-idle" | "now",
    index?: number,
  ) => {
    if (mode === "auto-idle") {
      const safeQueue = retainNonSilentQueuedDrafts(queuedDrafts, isStuckToolAutoContinueText);
      if (safeQueue.length !== queuedDrafts.length) {
        // Old builds could persist a synthetic recovery draft after a failed
        // automatic send. Never let an idle effect create that turn later.
        clearQueuedDrafts(props.sessionId);
        if (safeQueue.length > 0) {
          prependQueuedDrafts(props.sessionId, safeQueue);
        }
        return false;
      }
    }
    if (!canFlushQueuedDrafts({
      mode,
      queueLength: queuedDrafts.length,
      draining: drainingQueueRef.current,
      openCodeRunActive: hasAbortableOpenCodeRun,
      liveStatusType: liveStatus.type,
      userStopped: userStoppedRef.current,
      index,
    })) {
      return false;
    }

    const draftIndex = pickQueuedDraftFlushIndex(
      mode,
      queuedDrafts,
      index,
      isStuckToolAutoContinueText,
    );
    const draftToSend = queuedDrafts[draftIndex];
    if (!draftToSend) return false;
    const remaining = queuedDrafts.filter((_, i) => i !== draftIndex);
    const displayText = (draftToSend.resolvedText ?? draftToSend.text ?? "").trim();
    if (displayText && !isStuckToolAutoContinueText(displayText)) {
      const queueAttachments = draftToSend.attachments ?? [];
      if (queueAttachments.length > 0 && props.sessionId) {
        try {
          const materialize = await materializeComposerAttachmentsForSend({
            sessionId: props.sessionId,
            attachments: queueAttachments,
          });
          if (materialize.pathByAttachmentId.size || materialize.pathByFilename.size) {
            stampComposerAttachmentLocalPaths(
              queueAttachments,
              materialize.pathByFilename,
              materialize.pathByAttachmentId,
            );
          }
        } catch (error) {
          console.warn("[WodeAppX] queued-send attachment materialize failed", error);
        }
        const missingPaths = listComposerAttachmentsMissingLocalPath(queueAttachments);
        if (missingPaths.length > 0) {
          toast.error("无法发送附件", {
            description: `这些文件还没有本机路径，请重新选择后再发：${missingPaths.join("、")}`,
          });
          return false;
        }
      }
      setOptimisticUserBaseline(renderedMessages.length);
      setOptimisticUserMessage(buildOptimisticUserMessage(
        displayText,
        queueAttachments.map((attachment) => ({
          name: attachment.name,
          mimeType: attachment.mimeType,
          path: desktopLocalFilePath(attachment.file),
          previewUrl: attachment.previewUrl,
          file: attachment.file,
        })),
      ));
    }

    drainingQueueRef.current = true;
    clearQueuedDrafts(props.sessionId);
    if (remaining.length > 0) {
      prependQueuedDrafts(props.sessionId, remaining);
    }
    try {
      await sendDraft(draftToSend, draftToSend.attachments);
      return true;
    } catch {
      setOptimisticUserMessage(null);
      setOptimisticUserBaseline(null);
      // Restore the exact prior queue so the user can retry / edit.
      clearQueuedDrafts(props.sessionId);
      prependQueuedDrafts(props.sessionId, queuedDrafts);
      return false;
    } finally {
      drainingQueueRef.current = false;
    }
  }, [clearQueuedDrafts, hasAbortableOpenCodeRun, liveStatus.type, prependQueuedDrafts, props.sessionId, queuedDrafts, renderedMessages.length, sendDraft]);

  const handleSendQueuedNow = useCallback((visibleIndex: number) => {
    const realIndex = visibleQueuedEntries[visibleIndex]?.index;
    if (typeof realIndex !== "number") return;
    void flushQueuedDrafts("now", realIndex);
  }, [flushQueuedDrafts, visibleQueuedEntries]);

  const handleRemoveQueuedDraft = useCallback((visibleIndex: number) => {
    const realIndex = visibleQueuedEntries[visibleIndex]?.index;
    if (typeof realIndex !== "number") return;
    removeQueuedDraft(realIndex);
  }, [removeQueuedDraft, visibleQueuedEntries]);

  const handleChangeQueuedDraft = useCallback((visibleIndex: number, text: string) => {
    const realIndex = visibleQueuedEntries[visibleIndex]?.index;
    if (typeof realIndex !== "number") return;
    updateQueuedDraftTextInStore(props.sessionId, realIndex, text);
  }, [props.sessionId, updateQueuedDraftTextInStore, visibleQueuedEntries]);

  const handleAbort = useCallback(async () => {
    if (!chatStreaming) return;
    setError(null);
    hangTraceLog({
      layer: "ui",
      event: "abort.user",
      sessionId: props.sessionId,
      workspaceId: props.workspaceId,
      fields: {
        hasAbortableOpenCodeRun,
        hasWodeAppLocalActivity,
      },
    });
    // Keep user follow-ups after Stop. Purge only silent auto-continue
    // drafts; userStoppedRef pauses auto-idle drain until the user sends
    // again so abort→idle cannot instantly re-prompt (#2014).
    {
      const kept = retainNonSilentQueuedDrafts(queuedDrafts, isStuckToolAutoContinueText);
      if (kept.length !== queuedDrafts.length) {
        clearQueuedDrafts(props.sessionId);
        if (kept.length > 0) {
          prependQueuedDrafts(props.sessionId, kept);
        }
      }
    }
    // Latch before await so idle recovery effects cannot race a silent
    // auto-continue between cancel completing and local state clearing.
    userStoppedRef.current = true;
    // The prompt was sent through a directory-scoped client (session-route
    // passes the workspace root), so the abort must target the same scope —
    // without it the server resolves the default project, finds no live run,
    // and answers `200: false` while the stream keeps going (#2014).
    const aborted = hasAbortableOpenCodeRun
      ? await abortSessionSafe(
          opencodeClient,
          props.sessionId,
          props.workspaceRoot.trim() || undefined,
        )
      : false;
    hangTraceLog({
      layer: "ui",
      event: "abort.api",
      sessionId: props.sessionId,
      workspaceId: props.workspaceId,
      fields: {
        aborted,
        hasAbortableOpenCodeRun,
      },
    });
    const clearLocalRunState = () => {
      setSending(false);
      setAwaitingAssistantBaseline(null);
      useSessionActivityStore.getState().setRunStatus(props.workspaceId, props.sessionId, { type: "idle" });
      useSessionActivityStore.getState().clearError(props.workspaceId, props.sessionId);
    };
    if (!aborted) {
      if (hasWodeAppLocalActivity && !hasAbortableOpenCodeRun) {
        clearLocalRunState();
        toast.info(t("session.stop_state_cleared"));
        await snapshotQuery.refetch();
        return;
      }
      // Abort did not land — allow recoveries again.
      userStoppedRef.current = false;
      setError({ message: t("session.stop_failed") });
      toast.error(t("session.stop_failed"));
      return;
    }
    clearLocalRunState();
    toast.success(t("session.stop_success"));
    captureAnalyticsEvent("task_run_stopped", {});
    await snapshotQuery.refetch();
  }, [chatStreaming, clearQueuedDrafts, hasAbortableOpenCodeRun, hasWodeAppLocalActivity, opencodeClient, prependQueuedDrafts, props.sessionId, props.workspaceId, props.workspaceRoot, queuedDrafts, snapshotQuery.refetch]);

  const handleDismissError = useCallback(() => {
    setError(null);
    useSessionActivityStore.getState().clearError(props.workspaceId, props.sessionId);
  }, [props.sessionId, props.workspaceId]);

  useEffect(() => {
    if (liveStatus.type === "idle") {
      setSending(false);
      if (sendingClearFallbackRef.current !== null) {
        window.clearTimeout(sendingClearFallbackRef.current);
        sendingClearFallbackRef.current = null;
      }
    }
  }, [liveStatus.type]);

  useEffect(() => () => {
    if (sendingClearFallbackRef.current !== null) {
      window.clearTimeout(sendingClearFallbackRef.current);
      sendingClearFallbackRef.current = null;
    }
  }, []);

  // Auto-drain once idle. Manual flush uses the queue panel "发送" button.
  useEffect(() => {
    void flushQueuedDrafts("auto-idle");
  }, [flushQueuedDrafts]);

  // Silent recoveries (empty-args abort, blank finish, orphaned tool, stalled
  // bash) auto-continue without a confirm banner. Cap per session to avoid loops.
  // Manual Stop must win: do not revive the run until the user sends again
  // (ses_0357*: cancel succeeded then auto-continue re-opened Thinking).
  const silentAutoContinueBusyRef = useRef(false);
  const sessionSilentAutoContinueCountRef = useRef(0);
  useEffect(() => {
    silentAutoContinueBusyRef.current = false;
    sessionSilentAutoContinueCountRef.current = 0;
    userStoppedRef.current = false;
  }, [props.sessionId]);
  const sendSilentAutoContinue = useCallback(async (systemContext: string): Promise<boolean> => {
    if (userStoppedRef.current) {
      hangTraceLog({
        layer: "recovery",
        event: "auto_continue.skip",
        sessionId: props.sessionId,
        workspaceId: props.workspaceId,
        fields: { reason: "user_stopped" },
      });
      return false;
    }
    if (silentAutoContinueBusyRef.current) {
      hangTraceLog({
        layer: "recovery",
        event: "auto_continue.skip",
        sessionId: props.sessionId,
        workspaceId: props.workspaceId,
        fields: { reason: "in_flight" },
      });
      return false;
    }
    if (sessionSilentAutoContinueCountRef.current >= STUCK_TOOL_AUTO_CONTINUE_MAX) {
      hangTraceLog({
        layer: "recovery",
        event: "auto_continue.skip",
        sessionId: props.sessionId,
        workspaceId: props.workspaceId,
        fields: {
          reason: "cap",
          count: sessionSilentAutoContinueCountRef.current,
          max: STUCK_TOOL_AUTO_CONTINUE_MAX,
        },
      });
      return false;
    }
    silentAutoContinueBusyRef.current = true;
    sessionSilentAutoContinueCountRef.current += 1;
    hangTraceLog({
      layer: "recovery",
      event: "auto_continue.attempt",
      sessionId: props.sessionId,
      workspaceId: props.workspaceId,
      fields: {
        count: sessionSilentAutoContinueCountRef.current,
        systemContextChars: systemContext.length,
        systemContextPreview: systemContext.slice(0, 120),
      },
    });
    try {
      const recoveryDraft: ComposerDraft = {
        ...buildDraft(STUCK_TOOL_AUTO_CONTINUE_MARKER, []),
        systemContext,
      };
      await sendDraft(recoveryDraft, []);
      await snapshotQueryRef.current.refetch();
      return true;
    } catch {
      hangTraceLog({
        layer: "recovery",
        event: "auto_continue.skip",
        sessionId: props.sessionId,
        workspaceId: props.workspaceId,
        fields: {
          reason: "send_failed",
          count: sessionSilentAutoContinueCountRef.current,
        },
      });
      return false;
    } finally {
      silentAutoContinueBusyRef.current = false;
    }
  }, [buildDraft, props.sessionId, props.workspaceId, sendDraft]);

  // Empty-args auto-abort (busy + pending + empty input; raw growth resets age).
  const stuckToolRecoveryRef = useRef(false);
  const recoveredStuckPartIdsRef = useRef(new Set<string>());
  const stuckToolSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previousSessionId = stuckToolSessionIdRef.current;
    if (previousSessionId && previousSessionId !== props.sessionId) {
      clearLiveToolSession(previousSessionId);
    }
    stuckToolSessionIdRef.current = props.sessionId;
    stuckToolRecoveryRef.current = false;
    recoveredStuckPartIdsRef.current = new Set();
  }, [props.sessionId]);
  useEffect(() => {
    reportSnapshotToolFailures(snapshotQuery.data, props.sessionId, props.workspaceId);
  }, [props.sessionId, props.workspaceId, snapshotQuery.data, snapshotQuery.dataUpdatedAt]);
  useEffect(() => {
    if (!isStuckEmptyArgsRecoveryEnabled()) return;
    if (!chatStreaming || !hasAbortableOpenCodeRun) return;
    let disposed = false;

    const maybeRecoverStuckTool = async () => {
      if (disposed || stuckToolRecoveryRef.current) return;
      const stuck = findStuckEmptyPendingTool(props.sessionId, { runBusy: true });
      if (!stuck || recoveredStuckPartIdsRef.current.has(stuck.partId)) return;

      stuckToolRecoveryRef.current = true;
      recoveredStuckPartIdsRef.current.add(stuck.partId);
      try {
        const liveConfirmed = confirmStuckEmptyPendingTool(stuck, { runBusy: true });
        if (!liveConfirmed) {
          recoveredStuckPartIdsRef.current.delete(stuck.partId);
          return;
        }

        const fresh = await snapshotQueryRef.current.refetch();
        if (disposed || fresh.data?.session.id !== props.sessionId) {
          recoveredStuckPartIdsRef.current.delete(stuck.partId);
          return;
        }
        seedLiveToolStateFromSnapshot(props.sessionId, fresh.data);
        const stillLive = confirmStuckEmptyPendingTool(stuck, { runBusy: true });
        if (!stillLive || !snapshotConfirmsEmptyPendingTool(fresh.data, stuck)) {
          recoveredStuckPartIdsRef.current.delete(stuck.partId);
          return;
        }

        const directory = props.workspaceRoot.trim() || undefined;
        const aborted = await abortSessionSafe(opencodeClient, props.sessionId, directory);
        if (!aborted) {
          recoveredStuckPartIdsRef.current.delete(stuck.partId);
          return;
        }
        hangTraceLog({
          layer: "recovery",
          event: "abort.system",
          sessionId: props.sessionId,
          workspaceId: props.workspaceId,
          fields: {
            reason: "stuck_empty_args_recovery",
            toolName: stillLive.tool,
            ageMs: stillLive.ageMs,
            partId: stillLive.partId,
          },
        });
        reportTurnAborted({
          reason: "stuck_empty_args_recovery",
          message: `Tool execution aborted: empty-args pending ${stillLive.tool}`,
          sessionId: props.sessionId,
          workspaceId: props.workspaceId,
          partId: stillLive.partId,
          toolName: stillLive.tool,
          ageMs: stillLive.ageMs,
        });

        useSessionActivityStore.getState().setRunStatus(props.workspaceId, props.sessionId, { type: "idle" });
        if (!disposed) {
          await sendSilentAutoContinue(buildStuckToolAutoContinueSystemContext(stillLive.tool));
        }
        await snapshotQueryRef.current.refetch();
      } finally {
        stuckToolRecoveryRef.current = false;
      }
    };

    const bootTimer = window.setTimeout(() => void maybeRecoverStuckTool(), 1_000);
    const interval = window.setInterval(() => void maybeRecoverStuckTool(), 2_000);
    return () => {
      disposed = true;
      window.clearTimeout(bootTimer);
      window.clearInterval(interval);
    };
  }, [
    chatStreaming,
    hasAbortableOpenCodeRun,
    opencodeClient,
    props.sessionId,
    props.workspaceId,
    props.workspaceRoot,
    sendSilentAutoContinue,
  ]);

  // Blank idle finish: fake <tool_call> in reasoning / <think>, or plain
  // reasoning-only stop after tools (ses_049432). Recoverable question XML is
  // shown in the transcript; unrecovered blanks silently continue.
  const recoveredEmptyVisibleMessageIdsRef = useRef(new Set<string>());
  useEffect(() => {
    recoveredEmptyVisibleMessageIdsRef.current = new Set();
  }, [props.sessionId]);
  useEffect(() => {
    if (liveStatus.type !== "idle") return;
    if (chatStreaming || hasAbortableOpenCodeRun) return;
    const empty = findEmptyVisibleCompletedAssistantTurn(snapshotQuery.data);
    if (!empty || recoveredEmptyVisibleMessageIdsRef.current.has(empty.messageId)) return;
    // Question XML is recovered into clickable wodeapp-choices in MessageList —
    // do not auto-continue over the user's choice panel.
    if (empty.recoverableQuestion && empty.recoveredMarkdown) {
      recoveredEmptyVisibleMessageIdsRef.current.add(empty.messageId);
      return;
    }

    recoveredEmptyVisibleMessageIdsRef.current.add(empty.messageId);
    void sendSilentAutoContinue(buildEmptyVisibleReplyAutoContinueSystemContext(empty.toolName));
  }, [
    chatStreaming,
    hasAbortableOpenCodeRun,
    liveStatus.type,
    sendSilentAutoContinue,
    snapshotQuery.data,
    snapshotQuery.dataUpdatedAt,
  ]);

  // Output truncated mid-turn (finish=length, or stop with half-sentence promise).
  // empty-visible skips these because some visible prose exists — users still see
  // "断了" (ses_01562a732ffe*). Silently continue with shrink-payload guidance.
  const recoveredTruncatedMessageIdsRef = useRef(new Set<string>());
  useEffect(() => {
    recoveredTruncatedMessageIdsRef.current = new Set();
  }, [props.sessionId]);
  useEffect(() => {
    if (liveStatus.type !== "idle") return;
    if (chatStreaming || hasAbortableOpenCodeRun) return;
    const hit = findTruncatedOutputAssistantTurn(snapshotQuery.data);
    if (!hit || recoveredTruncatedMessageIdsRef.current.has(hit.messageId)) return;
    recoveredTruncatedMessageIdsRef.current.add(hit.messageId);
    hangTraceLog({
      layer: "recovery",
      event: "auto_continue.attempt",
      sessionId: props.sessionId,
      workspaceId: props.workspaceId,
      fields: {
        reason: "truncated_output_recovery",
        kind: hit.kind,
        messageId: hit.messageId,
        visiblePreview: hit.visiblePreview,
      },
    });
    void sendSilentAutoContinue(buildTruncatedOutputAutoContinueSystemContext(hit.kind));
  }, [
    chatStreaming,
    hasAbortableOpenCodeRun,
    liveStatus.type,
    props.sessionId,
    props.workspaceId,
    sendSilentAutoContinue,
    snapshotQuery.data,
    snapshotQuery.dataUpdatedAt,
  ]);

  // Idle parent must not leave tool.status=running forever (task/explore child
  // empty-shell), nor zombie pending+{} (ses_03961aaf after stream/sidecar death).
  // UI settles「正在…」→「未完成」; silently continue.
  const recoveredOrphanedPartIdsRef = useRef(new Set<string>());
  useEffect(() => {
    recoveredOrphanedPartIdsRef.current = new Set();
  }, [props.sessionId]);
  useEffect(() => {
    if (liveStatus.type !== "idle") return;
    if (chatStreaming || hasAbortableOpenCodeRun) return;
    const runningHit = findOrphanedRunningTool(snapshotQuery.data, {
      parentIdle: true,
      sessionId: props.sessionId,
    });
    const pendingHit = runningHit
      ? null
      : findOrphanedPendingEmptyTool(snapshotQuery.data, {
        parentIdle: true,
        sessionId: props.sessionId,
      });
    const hit = runningHit || pendingHit;
    if (!hit || recoveredOrphanedPartIdsRef.current.has(hit.partId)) return;

    recoveredOrphanedPartIdsRef.current.add(hit.partId);
    const systemContext = runningHit
      ? buildOrphanedRunningToolAutoContinueSystemContext(hit.tool)
      : buildOrphanedPendingEmptyToolAutoContinueSystemContext(hit.tool);
    void sendSilentAutoContinue(systemContext);
  }, [
    chatStreaming,
    hasAbortableOpenCodeRun,
    liveStatus.type,
    props.sessionId,
    sendSilentAutoContinue,
    snapshotQuery.data,
    snapshotQuery.dataUpdatedAt,
  ]);

  // Detached `http.server &` / `nohup … &` bash may leave the current turn
  // permanently busy. Stop the confirmed stale shell, then silently continue.
  // Historical server turns are excluded by findStalledBackgroundBashTool
  // (ses_052fd94a regression).
  const stalledBashRecoveryRef = useRef(false);
  const recoveredStalledBashPartIdsRef = useRef(new Set<string>());
  useEffect(() => {
    stalledBashRecoveryRef.current = false;
    recoveredStalledBashPartIdsRef.current = new Set();
  }, [props.sessionId]);
  useEffect(() => {
    if (stalledBashRecoveryRef.current) return;
    const hit = findStalledBackgroundBashTool(snapshotQuery.data, {
      sessionId: props.sessionId,
    });
    if (!hit || recoveredStalledBashPartIdsRef.current.has(hit.partId)) return;

    stalledBashRecoveryRef.current = true;
    recoveredStalledBashPartIdsRef.current.add(hit.partId);
    void (async () => {
      try {
        // Cached snapshots can lag behind later user turns after a reload.
        // Never abort or create a synthetic turn from that cache: confirm the
        // exact part against a fresh server snapshot first.
        const fresh = await snapshotQueryRef.current.refetch();
        if (fresh.error || fresh.data?.session.id !== props.sessionId) {
          recoveredStalledBashPartIdsRef.current.delete(hit.partId);
          return;
        }
        const confirmed = findStalledBackgroundBashTool(fresh.data, {
          sessionId: props.sessionId,
        });
        if (!confirmed || confirmed.partId !== hit.partId) return;

        const directory = props.workspaceRoot.trim() || undefined;
        if (hasAbortableOpenCodeRun) {
          await abortSessionSafe(opencodeClient, props.sessionId, directory);
          hangTraceLog({
            layer: "recovery",
            event: "abort.system",
            sessionId: props.sessionId,
            workspaceId: props.workspaceId,
            fields: {
              reason: "stalled_background_bash",
              partId: confirmed.partId,
            },
          });
          useSessionActivityStore.getState().setRunStatus(props.workspaceId, props.sessionId, { type: "idle" });
        }

        await sendSilentAutoContinue(buildStalledBackgroundBashAutoContinueSystemContext());
        await snapshotQueryRef.current.refetch();
      } catch {
        recoveredStalledBashPartIdsRef.current.delete(hit.partId);
      } finally {
        stalledBashRecoveryRef.current = false;
      }
    })();
  }, [
    hasAbortableOpenCodeRun,
    opencodeClient,
    props.sessionId,
    props.workspaceId,
    props.workspaceRoot,
    sendSilentAutoContinue,
    snapshotQuery.data,
    snapshotQuery.dataUpdatedAt,
  ]);

  // Hang-trace: while busy/retry, poll trailing assistant shell age (empty parts).
  // Observability only — does not abort or auto-continue.
  useEffect(() => {
    const statusType = liveStatus.type;
    const busy = statusType === "busy" || statusType === "retry" || chatStreaming;
    const sample = () => {
      let assistantMessageId: string | null = null;
      let partsCount: number | null = null;
      let completed: boolean | null = null;
      let hasError: boolean | null = null;
      for (let i = renderedMessages.length - 1; i >= 0; i -= 1) {
        const message = renderedMessages[i];
        if (message.role === "assistant") {
          assistantMessageId = message.id;
          partsCount = Array.isArray(message.parts) ? message.parts.length : 0;
          break;
        }
        if (message.role === "user") break;
      }
      if (assistantMessageId && snapshot?.messages) {
        const hit = snapshot.messages.find((row) => row.info?.id === assistantMessageId);
        const info = hit?.info as
          | { time?: { completed?: number }; error?: unknown; finish?: unknown }
          | undefined;
        if (info) {
          completed = typeof info.time?.completed === "number";
          hasError = Boolean(info.error);
        }
      }
      const records = useSessionActivityStore.getState().recordsByWorkspaceId[props.workspaceId] || {};
      const busySessionCount = Object.values(records).filter((row) => row.runActive).length;
      observeHangEmptyShell({
        sessionId: props.sessionId,
        workspaceId: props.workspaceId,
        statusType: busy ? statusType : "idle",
        assistantMessageId,
        partsCount,
        completed,
        hasError,
        busySessionCount,
      });
    };
    sample();
    if (!busy) return;
    const interval = window.setInterval(sample, 2_000);
    return () => window.clearInterval(interval);
  }, [
    chatStreaming,
    liveStatus.type,
    props.sessionId,
    props.workspaceId,
    renderedMessages,
    snapshot,
  ]);

  useEffect(() => {
    props.onDraftChange(buildDraft(draft, attachments));
  }, [attachments, buildDraft, draft, props.onDraftChange]);

  const handleAttachFiles = (files: File[]): ComposerAttachment[] => {
    if (!props.attachmentsEnabled) {
      toast.warning(props.attachmentsDisabledReason ?? "Attachments are unavailable.");
      return [];
    }
    const attachmentLimitBytes = shellConfig.wodeappWorkbench
      ? Number.POSITIVE_INFINITY
      : 25 * 1024 * 1024;
    const oversized = Number.isFinite(attachmentLimitBytes)
      ? files.filter((file) => file.size > attachmentLimitBytes)
      : [];
    const sized = Number.isFinite(attachmentLimitBytes)
      ? files.filter((file) => file.size <= attachmentLimitBytes)
      : files;
    if (oversized.length) {
      const limitMb = Math.round(attachmentLimitBytes / 1024 / 1024);
      toast.warning(
        oversized.length === 1 ? `${oversized[0]?.name ?? "File"} is too large` : `${oversized.length} files are too large`,
        { description: `Files over ${limitMb} MB were skipped.` },
      );
    }
    // OpenWork #3079: attach any durable file; send-time modelFacingAttachmentMime
    // remaps unsafe mimes. Keep size caps above — do not remove them.
    // Clipboard screenshots arrive as image.png — uniquify before fingerprinting
    // so open/search never hits ~/Downloads/image.png by basename.
    const uniquified = uniquifyComposerAttachmentFiles(sized, attachments);
    const { accepted, duplicates } = filterDuplicateComposerAttachmentFiles(uniquified, attachments);
    if (duplicates.length) {
      toast.warning(
        duplicates.length === 1
          ? `${duplicates[0]?.name ?? "File"} is already attached`
          : `${duplicates.length} duplicate files were skipped`,
      );
    }
    if (!accepted.length) return [];
    const next = accepted.map((file) => ({
      id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      kind: file.type.startsWith("image/") ? "image" as const : "file" as const,
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
    }));
    setComposerAttachments(props.sessionId, [...attachments, ...next]);
    return next;
  };

  const handleRemoveAttachment = (id: string) => {
    const target = attachments.find((item) => item.id === id);
    if (target?.previewUrl) {
      URL.revokeObjectURL(target.previewUrl);
    }
    setComposerAttachments(props.sessionId, attachments.filter((item) => item.id !== id));
  };

  const handleInsertMention = (kind: ComposerMentionKind, value: string) => {
    // @agent mentions switch the session agent instead of inserting an agent
    // part. Agent parts are treated as *subagent* (task tool) calls by the
    // engine, which silently fails for primary agents and left every reply
    // coming from the default agent (#2101).
    if (kind === "agent") {
      setComposerDraft(props.sessionId, draft.replace(/@([^\s@]*)$/, ""));
      props.onSelectAgent(value);
      toast.success(t("composer.agent_selected", { agent: value }));
      return;
    }
    setComposerDraft(props.sessionId, draft.replace(/@([^\s@]*)$/, `@${encodeComposerMentionValue(value)} `));
    setComposerMentions(props.sessionId, { ...mentions, [value]: kind });
    if (kind === "asset") {
      const asset = findDigitalAssetByMentionValue(value);
      if (asset) rememberAssetMention(digitalAssetToMention(asset));
    }
    // Pre-flight Computer Use permissions when an app is mentioned so missing
    // Accessibility / Screen Recording grants surface before send, not as a
    // mid-task failure. Only ever runs on macOS desktop (apps aren't offered
    // elsewhere); errors are silently ignored.
    if (kind === "app") {
      void (async () => {
        try {
          const status = (await desktopBridge.checkComputerUsePermissions()) as { ok?: boolean };
          if (status.ok === true) return;
          toast.warning(t("composer.computer_use_permissions_missing", { app: value }), {
            action: {
              label: t("composer.computer_use_permissions_setup"),
              onClick: () => void desktopBridge.openComputerUsePermissionSetup(),
            },
          });
        } catch {
          // Desktop bridge unavailable — nothing to pre-flight.
        }
      })();
    }
  };

  const insertAssetMentionRef = useCallback((ref: AssetMentionRef | undefined) => {
    if (!ref?.id) return;
    rememberAssetMention(ref);
    const state = useComposerStateStore.getState();
    const currentDraft = getComposerDraft(state, props.sessionId);
    const currentMentions = getComposerMentions(state, props.sessionId);
    const asset = findDigitalAssetByMentionValue(ref.id) ?? findDigitalAssetByMentionValue(`asset:${ref.id}`);
    const value = asset ? assetMentionValue(asset) : `asset:${ref.id}`;
    const token = `@${encodeComposerMentionValue(value)}`;
    const nextDraft = currentDraft.includes(token)
      ? currentDraft
      : currentDraft.trim()
        ? `${currentDraft.trimEnd()} ${token} `
        : `${token} `;
    setComposerDraft(props.sessionId, nextDraft);
    setComposerMentions(props.sessionId, { ...currentMentions, [value]: "asset" });
    window.dispatchEvent(new Event("openwork:focusPrompt"));
  }, [props.sessionId, setComposerDraft, setComposerMentions]);

  useEffect(() => {
    const handleInsertAsset = (event: Event) => {
      const detail = (event as CustomEvent<AssetMentionRef>).detail;
      const ref = detail?.id ? consumeQueuedAssetMentionInsert(detail.id) ?? detail : detail;
      insertAssetMentionRef(ref);
    };
    window.addEventListener("wodeapp:insert-asset-mention", handleInsertAsset);
    return () => window.removeEventListener("wodeapp:insert-asset-mention", handleInsertAsset);
  }, [insertAssetMentionRef]);

  useEffect(() => {
    consumeQueuedAssetMentionInserts().forEach(insertAssetMentionRef);
  }, [insertAssetMentionRef]);

  const handleExpandPastedText = (id: string) => {
    const part = pasteParts.find((item) => item.id === id);
    if (!part) return;
    setComposerDraft(props.sessionId, draft.replace(`[pasted text ${part.label}]`, part.text));
    setComposerPasteParts(props.sessionId, pasteParts.filter((item) => item.id !== id));
  };

  const handleRemovePastedText = (id: string) => {
    const target = pasteParts.find((item) => item.id === id);
    if (!target) return;
    setComposerDraft(props.sessionId, draft.replace(`[pasted text ${target.label}]`, ""));
    setComposerPasteParts(props.sessionId, pasteParts.filter((item) => item.id !== id));
  };

  const handleUnsupportedFileLinks = (links: string[]) => {
    if (!links.length) return;
    setComposerDraft(props.sessionId, `${draft}${draft && !draft.endsWith("\n") ? "\n" : ""}${links.join("\n")}`);
  };

  const typeComposerText = useCallback(async (text: string) => {
    window.dispatchEvent(new Event("openwork:focusPrompt"));
    setComposerDraft(props.sessionId, text);
    await waitForControl(40);
  }, [props.sessionId, setComposerDraft]);

  const handleStartBuiltinAgent = useCallback((agent: WodeAppBuiltinAgent, options?: { displayText?: string; autoSend?: boolean }) => {
    if (agent.runtimeProfileId) {
      bindWodeAppRuntimeProfileToSession(props.workspaceId, props.sessionId, agent.runtimeProfileId);
    }
    const task = buildBuiltinAgentTask(agent, options);
    setWodeAppComposerHandoff(props.sessionId, {
      displayText: task.displayText,
      agentMessage: task.agentMessage,
    });
    void typeComposerText(task.displayText);
    props.onDraftChange(buildDraft(task.displayText, attachments));
    if (task.autoSend) {
      window.setTimeout(() => {
        void (async () => {
          let nextDraft = buildDraft(task.displayText, attachments);
          const agentText = resolveWodeAppComposerSendText(props.sessionId, task.displayText);
          if (agentText !== task.displayText) {
            nextDraft = mergeWodeAppAgentTextIntoDraft(nextDraft, agentText);
          }
          clearComposer();
          try {
            await sendDraft(nextDraft, attachments);
          } catch {}
        })();
      }, 160);
    }
  }, [attachments, buildDraft, clearComposer, props.onDraftChange, props.sessionId, props.workspaceId, sendDraft, setComposerDraft, typeComposerText]);

  useWodeAppSessionControlActions({
    enabled: shellConfig.wodeappWorkbench,
    modelUnavailable: props.modelUnavailable,
    workspaceRoot: props.workspaceRoot,
    sessionId: props.sessionId,
    handleStartBuiltinAgent,
  });

  useEffect(() => {
    if (!draft.trim() && attachments.length === 0) return;
    const timer = window.setTimeout(() => {
      if (!consumeBuiltinAgentAutoSend(props.sessionId)) return;
      void handleSend();
    }, 720);
    return () => window.clearTimeout(timer);
  }, [attachments.length, draft, handleSend, props.sessionId]);

  useEffect(() => {
    const handlePrimeComposer = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; text?: string }>).detail;
      if (!detail?.sessionId || detail.sessionId !== props.sessionId) return;
      if (!detail.text) return;
      void typeComposerText(detail.text);
      props.onDraftChange(buildDraft(detail.text, attachments));
      window.dispatchEvent(new CustomEvent("wodeapp:composer-primed", {
        detail: { sessionId: props.sessionId },
      }));
    };
    window.addEventListener("wodeapp:prime-composer", handlePrimeComposer);
    return () => window.removeEventListener("wodeapp:prime-composer", handlePrimeComposer);
  }, [attachments, buildDraft, props.onDraftChange, props.sessionId, typeComposerText]);

  useEffect(() => {
    const handleVoiceTranscript = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail: unknown = event.detail;
      if (!detail || typeof detail !== "object" || Array.isArray(detail) || !("text" in detail) || typeof detail.text !== "string") return;
      const text = detail.text;
      void typeComposerText(text);
      props.onDraftChange(buildDraft(text, attachments));
      recordInspectorEvent("voice.transcript.applied", {
        workspaceId: props.workspaceId,
        sessionId: props.sessionId,
        length: text.length,
      });
    };
    window.addEventListener("openwork:voice-transcript", handleVoiceTranscript);
    return () => window.removeEventListener("openwork:voice-transcript", handleVoiceTranscript);
  }, [attachments, buildDraft, props.onDraftChange, props.sessionId, props.workspaceId, typeComposerText]);

  const composerSetTextControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "composer.set_text",
    label: "Type into the composer",
    description: "Replace the current session draft and type the supplied text visibly.",
    sideEffect: "none",
    requiresArgs: true,
    args: [{ name: "text", type: "string", required: true, description: "Prompt text to place in the composer." }],
    previewArgs: { text: DEFAULT_COMPOSER_CONTROL_TEXT },
    targetRef: composerShellRef,
    execute: async (args, helpers) => {
      const text = controlTextArgument(args);
      helpers.setNarration(`Typing ${text.length.toLocaleString()} characters into the composer…`);
      await typeComposerText(text);
      props.onDraftChange(buildDraft(text, attachments));
      return { draftLength: text.length };
    },
  }), [attachments, buildDraft, props.onDraftChange, typeComposerText]);
  useControlAction(composerSetTextControlAction);

  const composerSendControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "composer.send",
    label: "Send the composer prompt",
    description: "Send the currently visible composer draft to the active session.",
    sideEffect: "mutation",
    disabled: props.modelUnavailable || (!draft.trim() && attachments.length === 0) || model.transitionState !== "idle",
    targetRef: composerShellRef,
    execute: async () => {
      await handleSend();
      return true;
    },
  }), [attachments.length, draft, handleSend, model.transitionState, props.modelUnavailable]);
  useControlAction(composerSendControlAction);

  const composerStopControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "composer.stop",
    label: "Stop the current run",
    description: "Stop the current streaming session run.",
    sideEffect: "mutation",
    disabled: !chatStreaming,
    targetRef: composerShellRef,
    execute: async () => {
      await handleAbort();
      return true;
    },
  }), [chatStreaming, handleAbort]);
  useControlAction(composerStopControlAction);

  const listSkills = async (): Promise<SkillCard[]> => {
    const response = await props.client.listSkills(props.workspaceId, { includeGlobal: true });
    const next = (response.items ?? []).map((skill) => ({
      name: skill.name,
      path: skill.path,
      description: skill.description,
      trigger: skill.trigger,
    } satisfies SkillCard));
    setToolSkills(next);
    return next;
  };

  const listMcp = async (): Promise<{ servers: McpServerEntry[]; statuses: McpStatusMap; status: string | null }> => {
    const response = await props.client.listMcp(props.workspaceId);
    const servers = (response.items ?? []).map((entry) => ({
      name: entry.name,
      config: entry.config as McpServerEntry["config"],
    } satisfies McpServerEntry));

    let statuses: McpStatusMap = {};
    try {
      if (props.workspaceRoot.trim()) {
        statuses = unwrap(await opencodeClient.mcp.status({ directory: props.workspaceRoot.trim() })) as McpStatusMap;
      }
    } catch {
      statuses = {};
    }

    const status = servers.length ? null : "No MCP servers loaded.";
    setToolMcpServers(servers);
    setToolMcpStatuses(statuses);
    setToolMcpStatus(status);
    return { servers, statuses, status };
  };

  const listImportedPlugins = async (): Promise<CloudImportedPlugin[]> => {
    const response = await props.client.getConfig(props.workspaceId);
    const plugins = Object.values(readWorkspaceCloudImports(response.openwork).plugins)
      .sort((left, right) => left.name.localeCompare(right.name));
    setToolImportedPlugins(plugins);
    return plugins;
  };

  const handleUploadInboxFiles = async (files: File[]) => {
    const input = files.filter(Boolean);
    if (!input.length) return;
    try {
      const results = await Promise.all(input.map((file) => props.client.uploadInbox(props.workspaceId, file)));
      return results;
    } catch (nextError) {
      toast.warning(nextError instanceof Error ? nextError.message : "Shared folder upload failed");
      throw nextError;
    }
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sessionScroll = useSessionScrollController({
    selectedSessionId: props.sessionId,
    renderedMessages: conversationMessages,
    containerRef: scrollRef,
    contentRef,
    restoreManualScroll: !shellConfig.wodeappWorkbench,
  });

  const handleMessageListDispatchAction = useCallback((action: DispatchAction) => {
    if (action.target === "settings" && action.action === "open") {
      props.onOpenSettingsSection?.(action.section);
    }
  }, [props.onOpenSettingsSection]);

  const handleMessageListSetPrompt = useCallback((prompt: string, files: File[] = []) => {
    if (files.length > 0) {
      handleAttachFiles(files);
    }
    void typeComposerText(prompt);
  }, [attachments, props.attachmentsDisabledReason, props.attachmentsEnabled, props.sessionId, setComposerAttachments, shellConfig.wodeappWorkbench, typeComposerText]);

  const handleMessageListSubmitPrompt = useCallback((prompt: string, files: File[] = []) => {
    const text = prompt.trim();
    if (!text && files.length === 0) return;
    void (async () => {
      const uploadedAttachments = files.length > 0 ? handleAttachFiles(files) : [];
      const submitAttachments = files.length > 0 ? [...attachments, ...uploadedAttachments] : [];
      if (!text && submitAttachments.length === 0) return;
      setComposerDraft(props.sessionId, "");
      if (submitAttachments.length > 0) {
        setComposerAttachments(props.sessionId, []);
      }
      try {
        await sendDraft(buildDraft(text, submitAttachments), submitAttachments);
      } catch {
        // sendDraft already surfaces the error in the session.
      }
    })();
  }, [attachments, buildDraft, props.attachmentsDisabledReason, props.attachmentsEnabled, props.sessionId, sendDraft, setComposerAttachments, setComposerDraft, shellConfig.wodeappWorkbench]);

  const handleRevertToUserMessage = useCallback((messageId: string) => {
    if (!props.onRevertToMessage || revertBusy) return;
    setPendingRevertMessageId(messageId);
  }, [props.onRevertToMessage, revertBusy]);

  const confirmRevertToUserMessage = useCallback(() => {
    if (!pendingRevertMessageId || !props.onRevertToMessage || revertBusy) return;
    void (async () => {
      setRevertBusy(true);
      try {
        await props.onRevertToMessage?.(pendingRevertMessageId, props.sessionId);
        setPendingRevertMessageId(null);
      } finally {
        setRevertBusy(false);
      }
    })();
  }, [pendingRevertMessageId, props.onRevertToMessage, props.sessionId, revertBusy]);

  const cancelRevertToUserMessage = useCallback(() => {
    if (revertBusy) return;
    setPendingRevertMessageId(null);
  }, [revertBusy]);

  const handleForkAtMessage = useCallback((messageId: string) => {
    // OpenCode's fork copies messages strictly before the given id, so pass
    // the next real message to make the branch include the clicked message.
    props.onForkAtMessage?.(resolveForkBoundaryId(renderedMessages, messageId), props.sessionId);
  }, [props.onForkAtMessage, props.sessionId, renderedMessages]);

  const handleEditUserMessage = useCallback((messageId: string, text: string) => {
    void (async () => {
      // Rewind the session to just before this prompt, then restore the
      // prompt text into the composer so the user can rewrite and resend it.
      // Edit is an explicit rewrite action; confirm only the dedicated Revert path.
      const reverted = await props.onRevertToMessage?.(messageId, props.sessionId);
      if (reverted === false) return;
      await typeComposerText(text);
    })();
  }, [props.onRevertToMessage, props.sessionId, typeComposerText]);

  const sessionScrollTopControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "session.scroll_top",
    label: "Go to the top of the session",
    description: "Scroll the visible session transcript to the first messages.",
    sideEffect: "none",
    execute: () => {
      const container = scrollRef.current;
      if (!container) return { ok: false, error: "Session transcript is not mounted" };
      container.scrollTo({ top: 0, behavior: "smooth" });
      return { ok: true, position: "top" };
    },
  }), []);
  useControlAction(sessionScrollTopControlAction);

  const sessionScrollBottomControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "session.scroll_bottom",
    label: "Go to the bottom of the session",
    description: "Scroll the visible session transcript to the newest messages and composer area.",
    sideEffect: "none",
    execute: () => {
      sessionScroll.jumpToLatest("smooth");
      return { ok: true, position: "bottom" };
    },
  }), [sessionScroll.jumpToLatest]);
  useControlAction(sessionScrollBottomControlAction);

  const sessionLatestMessageControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "session.latest_message",
    label: "Read the latest session message",
    description: "Return the latest visible message in the current session transcript.",
    sideEffect: "none",
    execute: () => {
      const message = renderedMessages[renderedMessages.length - 1];
      if (!message) return { ok: false, error: "No messages are visible in this session" };
      return {
        ok: true,
        sessionId: props.sessionId,
        index: renderedMessages.length - 1,
        role: message.role,
        text: messageToReadableText(message),
      };
    },
  }), [props.sessionId, renderedMessages]);
  useControlAction(sessionLatestMessageControlAction);

  const sessionReadTranscriptControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "session.read_transcript",
    label: "Read the current session transcript",
    description: "Return the last messages from the current session transcript as readable text, including the session ID, title, and message count.",
    sideEffect: "none",
    args: [{ name: "count", type: "number", required: false, description: "Number of recent messages to return, from 1 to 30. Defaults to 10." }],
    execute: (args) => {
      const count = typeof args === "object" && args !== null && "count" in args && typeof (args as { count?: unknown }).count === "number"
        ? Math.min(Math.max(1, (args as { count: number }).count), 30)
        : 10;
      const total = renderedMessages.length;
      const slice = renderedMessages.slice(-count);
      if (!slice.length) return { ok: false, error: "No messages in this session" };
      return {
        ok: true,
        sessionId: props.sessionId,
        messageCount: total,
        returned: slice.length,
        messages: slice.map((message, index) => ({
          index: total - slice.length + index,
          role: message.role,
          text: messageToReadableText(message),
        })),
      };
    },
  }), [props.sessionId, renderedMessages]);
  useControlAction(sessionReadTranscriptControlAction);

  // Welcome / top-composer chrome is only for a *confirmed* empty session.
  // Do not paint「想做什么，直接说」while snapshot is missing or still fetching —
  // otherwise selecting a history chat (or HMR remount) flashes the new-chat
  // landing even though the DB already has replies (ses_02ff883a*).
  const firstMileCue = useFirstMileEntryCue();
  const wodeAppTopComposer = shouldShowWodeAppEmptySessionChrome({
    workbench: Boolean(shellConfig.wodeappWorkbench),
    messageCount: renderedMessages.length,
    activityIdle: effectiveActivityStatus === "idle",
    chatStreaming,
    hasSnapshot: Boolean(snapshot),
    snapshotFetching: snapshotQuery.isFetching,
    transitionIdle: model.transitionState === "idle",
  });
  const wodeAppSkin = useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === "undefined" || typeof MutationObserver === "undefined") {
        return () => {};
      }
      let observer: MutationObserver | null = null;
      const connect = () => {
        const el = document.querySelector("[data-wapp-skin]");
        if (!el) return false;
        observer?.disconnect();
        observer = new MutationObserver(onStoreChange);
        observer.observe(el, {
          attributes: true,
          attributeFilter: ["data-wapp-skin", "class"],
        });
        return true;
      };
      if (!connect()) {
        const timer = window.setInterval(() => {
          if (connect()) {
            window.clearInterval(timer);
            onStoreChange();
          }
        }, 250);
        return () => {
          window.clearInterval(timer);
          observer?.disconnect();
        };
      }
      return () => observer?.disconnect();
    },
    () => {
      if (typeof document === "undefined") return WODEAPP_DEFAULT_SKIN_ID;
      const raw = document.querySelector("[data-wapp-skin]")?.getAttribute("data-wapp-skin");
      return isWodeAppSkinId(raw) ? raw : WODEAPP_DEFAULT_SKIN_ID;
    },
    () => WODEAPP_DEFAULT_SKIN_ID,
  );
  // Default desk keeps the commerce hero; beauty skin uses MIRRORED; Supor stays composer-only.
  const showWodeAppHero = wodeAppTopComposer && wodeAppSkin !== "supor";
  const showBeautyHero = showWodeAppHero && wodeAppSkin === "beauty";
  const startHeroBuiltinAgent = useCallback((agentId: "visual-generation" | "video-generation", displayText: string) => {
    const agent = findWodeAppBuiltinAgent(agentId);
    if (agent) {
      handleStartBuiltinAgent(agent, { displayText, autoSend: false });
      return;
    }
    void typeComposerText(displayText);
    props.onDraftChange(buildDraft(displayText, attachments));
  }, [attachments, buildDraft, handleStartBuiltinAgent, props.onDraftChange, typeComposerText]);
  const handleWodeAppHeroPromptClick = useCallback((text: string, options?: { includeDefaultProduct?: boolean }) => {
    let nextText = text;
    let nextMentions = mentions;
    if (options?.includeDefaultProduct) {
      const defaultProduct = getDigitalAssetsList().find((item) => item.kind === "商品库");
      if (defaultProduct) {
        const ref = digitalAssetToMention(defaultProduct);
        rememberAssetMention(ref);
        const value = assetMentionValue(defaultProduct);
        const token = `@${encodeComposerMentionValue(value)}`;
        nextText = nextText.includes(token) ? nextText : `${token} ${nextText}`;
        nextMentions = { ...mentions, [value]: "asset" };
        setComposerMentions(props.sessionId, nextMentions);
      }
    }
    void typeComposerText(nextText);
    props.onDraftChange(buildDraft(nextText, attachments, nextMentions));
  }, [attachments, buildDraft, mentions, props.onDraftChange, props.sessionId, setComposerMentions, typeComposerText]);

  const composerPanel = (
    <div
      ref={composerShellRef}
      className={cn("wapp-composer-shell shrink-0 px-0 pb-2 pt-2", wodeAppTopComposer && "wapp-session-composer-top")}
    >
      {(props.providerConnectedCount ?? 0) === 0 ? (
        <button
          type="button"
          className="mx-3 mb-2 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg border border-amber-7/40 bg-amber-2/30 px-3 py-2 text-left text-xs text-amber-11 transition-colors hover:bg-amber-3/40"
          onClick={() => props.onOpenSettingsSection?.("providers")}
        >
          <span className="font-medium">No AI model connected.</span>
          <span className="text-amber-11/70">Add a provider to run tasks.</span>
        </button>
      ) : null}
      <DevProfiler id="SessionComposer">
        <ReactSessionComposer
          draft={draft}
          mentions={mentions}
          onDraftChange={handleComposerDraftChange}
          onSend={handleSend}
          onSteer={handleSteer}
          onQueue={handleQueue}
          onStop={handleAbort}
          busy={chatStreaming}
          queuedCount={queuedMessages.length}
          disabled={model.transitionState !== "idle" || Boolean(props.modelUnavailable)}
          modelUnavailable={Boolean(props.modelUnavailable)}
          statusLabel={statusLabel(snapshot ?? undefined, chatStreaming)}
          modelPickerOpen={props.modelPickerOpen}
          selectedModel={props.selectedModel}
          onModelPickerOpenChange={props.onModelPickerOpenChange}
          onModelChange={props.onModelChange}
          attachments={attachments}
          onAttachFiles={handleAttachFiles}
          onRemoveAttachment={handleRemoveAttachment}
          attachmentsEnabled={props.attachmentsEnabled}
          attachmentsDisabledReason={props.attachmentsDisabledReason}
          modelVariantLabel={props.modelVariantLabel}
          modelVariant={props.modelVariant}
          modelBehaviorOptions={props.modelBehaviorOptions}
          onModelVariantChange={props.onModelVariantChange}
          agentLabel={props.agentLabel}
          selectedAgent={props.selectedAgent}
          listAgents={props.listAgents}
          onSelectAgent={props.onSelectAgent}
          listCommands={props.listCommands}
          listSkills={listSkills}
          skills={toolSkills}
          listMcp={listMcp}
          mcpServers={toolMcpServers}
          mcpStatus={toolMcpStatus}
          mcpStatuses={toolMcpStatuses}
          listImportedPlugins={listImportedPlugins}
          importedPlugins={toolImportedPlugins}
          onOpenSettingsSection={props.onOpenSettingsSection}
          recentFiles={props.recentFiles}
          searchFiles={props.searchFiles}
          onInsertMention={handleInsertMention}
          inputHistory={inputHistory}
          onUnsupportedFileLinks={handleUnsupportedFileLinks}
          pastedText={pasteParts}
          onExpandPastedText={handleExpandPastedText}
          onRemovePastedText={handleRemovePastedText}
          isRemoteWorkspace={props.isRemoteWorkspace}
          isSandboxWorkspace={props.isSandboxWorkspace}
          onUploadInboxFiles={props.onUploadInboxFiles ?? handleUploadInboxFiles}
          wodeAppTopDock={wodeAppTopComposer}
          compactTopSpacing={Boolean(
              props.activeQuestion ||
              sessionHasOpenTodos(props.todos) ||
              props.activePermission ||
              showFeishuAuthorizationPrompt ||
              queuedMessages.length > 0,
          )}
          topAccessory={
            props.activeQuestion ||
            sessionHasOpenTodos(props.todos) ||
            props.activePermission ||
            showFeishuAuthorizationPrompt ||
            queuedMessages.length > 0 ? (
              <div>
                {queuedMessages.length > 0 ? (
                  <QueuedMessagesPanel
                    messages={queuedMessages}
                    attachmentHints={queuedAttachmentHints}
                    onRemove={handleRemoveQueuedDraft}
                    onChange={handleChangeQueuedDraft}
                    onSendNow={handleSendQueuedNow}
                  />
                ) : null}
                {props.activeQuestion ? (
                  <QuestionPanel
                    questions={props.activeQuestion.questions}
                    busy={props.questionReplyBusy ?? false}
                    onReply={(answers) => {
                      if (props.activeQuestion) {
                        props.respondQuestion?.(props.activeQuestion.id, answers);
                      }
                    }}
                  />
                ) : sessionHasOpenTodos(props.todos) ? (
                  <TodoPanel todos={props.todos ?? []} />
                ) : null}
                {props.activePermission ? (
                  <PermissionApprovalPanel
                    permission={props.activePermission}
                    busy={props.permissionReplyBusy}
                    respondPermission={props.respondPermission}
                    safeStringify={props.safeStringify}
                  />
                ) : null}
                {showFeishuAuthorizationPrompt ? (
                  <WodeAppFeishuAuthorizationAccessory />
                ) : null}
              </div>
            ) : null
          }
        />
      </DevProfiler>
    </div>
  );

  return (
    <DevProfiler id="SessionSurface">
    <div
      className={cn(
        "flex h-full min-h-0 flex-col",
        shellConfig.wodeappWorkbench && "wapp-session-surface",
        wodeAppTopComposer && "wapp-session-surface-top-composer",
      )}
    >
      {model.transitionState === "switching" && showDelayedLoading ? (
        <div className="flex justify-center px-6 pt-4">
          <div className="rounded-full border border-dls-border bg-dls-hover/80 px-3 py-1 text-xs text-dls-secondary">
            {model.renderSource === "cache" ? "Switching session from cache..." : "Switching session..."}
          </div>
        </div>
      ) : null}

      {showWodeAppHero ? (
        <div className="wapp-session-hero-strip shrink-0">
          {showBeautyHero ? (
            <>
              <div className="wapp-session-hero-copy">
                <div className="wapp-session-hero-kicker">MIRRORED 美妆种草</div>
                <h1>先放一张产品图</h1>
                <p>像在化妆台前一样：出图、写种草文案、再做 15 秒口播。缺图就先上传包装或试用照。</p>
              </div>
              <div className="wapp-session-hero-mirror" aria-hidden="true">
                <div className="wapp-session-hero-mirror-glass">
                  <div className="wapp-session-hero-mirror-eyebrow">对镜开台</div>
                  <div className="wapp-session-hero-mirror-caption">种草 · 主图 · 口播</div>
                </div>
              </div>
              <div className="wapp-session-hero-chips" aria-label="常用能力">
                <button
                  type="button"
                  className="wapp-session-hero-chip"
                  onClick={() => handleWodeAppHeroPromptClick("基于这个美妆产品，生成一组小红书种草主图和场景图。", { includeDefaultProduct: true })}
                >
                  种草主图套装
                </button>
                <button
                  type="button"
                  className="wapp-session-hero-chip"
                  onClick={() => handleWodeAppHeroPromptClick("基于这个美妆产品，提炼 3 条可核验卖点并写一篇小红书种草文案。", { includeDefaultProduct: true })}
                >
                  卖点与种草文案
                </button>
                <button
                  type="button"
                  className="wapp-session-hero-chip"
                  onClick={() => handleWodeAppHeroPromptClick("基于这个美妆产品，生成一条 15 秒种草口播短视频方案。", { includeDefaultProduct: true })}
                >
                  15 秒种草口播
                </button>
                <button
                  type="button"
                  className="wapp-session-hero-chip"
                  onClick={() => handleWodeAppHeroPromptClick("基于这个美妆产品，做一套种草：卖点三条 + 主图 + 小红书文案 + 可选短视频。", { includeDefaultProduct: true })}
                >
                  完整种草套装
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="wapp-session-hero-kicker">{t("wodeappx.hero.kicker")}</div>
              <h1>{t("wodeappx.hero.title")}</h1>
              <p>{t("wodeappx.hero.body")}</p>
              <div className="wapp-session-hero-chips" aria-label={t("wodeappx.hero.chips")}>
                {firstMileCue && !isWebDeployment() ? (
                  <button
                    type="button"
                    className="wapp-session-hero-chip"
                    onClick={() => openFirstMileGuide()}
                  >
                    {t("wodeappx.hero.chip_start")}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="wapp-session-hero-chip"
                  onClick={() => handleWodeAppHeroPromptClick("把下面的资料保存整理到数字资产")}
                >
                  {t("wodeappx.nav.assets")}
                </button>
                <button
                  type="button"
                  className="wapp-session-hero-chip"
                  onClick={() => startHeroBuiltinAgent("visual-generation", "用图片智能体生成：")}
                >
                  {t("wodeappx.hero.chip_image")}
                </button>
                <button
                  type="button"
                  className="wapp-session-hero-chip"
                  onClick={() => startHeroBuiltinAgent("video-generation", "用视频智能体生成：")}
                >
                  {t("wodeappx.hero.chip_video")}
                </button>
                <button
                  type="button"
                  className="wapp-session-hero-chip"
                  onClick={() => {
                    if (isWebDeployment()) {
                      window.dispatchEvent(new Event("wodeapp:open-add-agent"));
                      return;
                    }
                    handleWodeAppHeroPromptClick("/自进化 ");
                  }}
                >
                  {t("wodeappx.hero.chip_custom")}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      {wodeAppTopComposer ? composerPanel : null}

      <div className="relative min-h-0 flex-1">
        <WodeAppInkBookTranscript
          enabled={wodeAppSkin === "ink-book"}
          sessionId={props.sessionId}
          scrollRef={scrollRef}
          contentRef={contentRef}
          followLatest
          contentClassName={cn(
            "mx-auto w-full",
            wodeAppTopComposer ? "max-w-[1200px] px-2 sm:px-0" : "max-w-[1100px]",
          )}
          onWheel={(event) => {
            sessionScroll.markScrollGesture(event.target);
          }}
          onTouchStart={(event) => {
            sessionScroll.markScrollGesture(event.target);
          }}
          onTouchMove={(event) => {
            sessionScroll.markScrollGesture(event.target);
          }}
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return;
            sessionScroll.markScrollGesture(event.currentTarget);
          }}
          onScroll={sessionScroll.handleScroll}
          className="absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 py-4 sm:px-5"
        >
          {/* Use the desktop canvas for long answers while preserving a
               bounded reading width and responsive gutters. */}
            {showDelayedLoading && pendingSessionLoad ? (
              <div className="flex min-h-full items-center justify-center px-6 py-8">
                <div className="mx-auto max-w-sm rounded-3xl border border-dls-border bg-dls-hover/60 px-8 py-10 text-center">
                  <div className="text-sm text-dls-secondary">Opening session…</div>
                </div>
              </div>
            ) : (snapshotQuery.isError || error) && !snapshot && renderedMessages.length === 0 ? (
              <div className="px-6 py-8">
                {error ? (
                  <SessionErrorCard
                    error={error}
                    onDismiss={handleDismissError}
                    onChangeModel={props.onChangeModel}
                    onOpenModelPicker={props.onModelClick}
                  />
                ) : (
                  <div className="mx-auto w-full max-w-xl break-words rounded-3xl border border-red-6/40 bg-red-3/20 px-6 py-5 text-sm text-red-11">
                    {snapshotQuery.error instanceof Error ? snapshotQuery.error.message : "Failed to load session."}
                  </div>
                )}
              </div>
            ) : conversationMessages.length === 0 && error ? (
              <div className="px-6 py-8">
                <SessionErrorCard
                  error={error}
                  onDismiss={handleDismissError}
                  onChangeModel={props.onChangeModel}
                  onOpenModelPicker={props.onModelClick}
                />
              </div>
            ) : (
              <DevProfiler id="MessageList">
                <OpenTargetProvider
                  openTargets={verifiedOpenTargets}
                  onOpenTarget={props.onOpenTarget}
                >
                  <EnvironmentVariableProvider
                    client={props.isRemoteWorkspace ? null : props.environmentClient ?? props.client}
                    runtimeKey={props.environmentRuntimeKey}
                    onApplyChanges={props.onApplyEnvironmentChanges}
                  >
                    <MessageListProvider
                      workspaceId={props.workspaceId}
                      sessionId={props.sessionId}
                      showThinking={showThinking}
                      developerMode={props.developerMode}
                      displaySuggestions={shellConfig.starterCards}
                      providerConnectedCount={props.providerConnectedCount ?? 0}
                      dispatchAction={handleMessageListDispatchAction}
                      setPrompt={handleMessageListSetPrompt}
                      submitPrompt={handleMessageListSubmitPrompt}
                      onRevertToUserMessage={handleRevertToUserMessage}
                      onForkAtMessage={handleForkAtMessage}
                      onEditUserMessage={handleEditUserMessage}
                    >
                      <MessageList
                        messages={conversationMessages}
                        status={status}
                        retryStatus={liveStatus.type === "retry" ? liveStatus : null}
                        onStartBuiltinAgent={shellConfig.wodeappWorkbench ? handleStartBuiltinAgent : undefined}
                        attachmentActivityLabel={attachmentUnderstandingLabel}
                        historyKey={props.sessionId}
                        onLoadEarlierHistory={handleLoadEarlierHistory}
                        historyExhausted={historyExhausted}
                      />
                    </MessageListProvider>
                  </EnvironmentVariableProvider>
                </OpenTargetProvider>
              </DevProfiler>
            )}
        </WodeAppInkBookTranscript>
        {wodeAppSkin === "ink-book" ? null : (
          <SessionScrollOverlay
            sessionId={props.sessionId}
            isStreaming={chatStreaming}
            onJumpToLatest={sessionScroll.jumpToLatest}
            onJumpToStartOfMessage={sessionScroll.jumpToStartOfMessage}
          />
        )}
      </div>

      {shellConfig.wodeappWorkbench ? <WodeAppLive2DAssistant active={chatStreaming} messages={conversationMessages} sessionId={props.sessionId} /> : null}
      {!wodeAppTopComposer ? composerPanel : null}
      {/* Error display moved inline into the session conversation area */}
      <ConfirmModal
        open={pendingRevertMessageId !== null}
        title={t("session.revert_confirm_title")}
        message={t("session.revert_confirm_message")}
        confirmLabel={revertBusy ? t("session.reverting") : t("session.revert_label")}
        cancelLabel={t("common.cancel")}
        variant="warning"
        busy={revertBusy}
        onConfirm={confirmRevertToUserMessage}
        onCancel={cancelRevertToUserMessage}
      />
      {!shellConfig.wodeappWorkbench && props.developerMode ? (
        <SessionDebugPanel model={model} snapshot={snapshot} />
      ) : null}
    </div>
    </DevProfiler>
  );
}
