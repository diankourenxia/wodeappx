/** @jsxImportSource react */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { toast } from "@/components/ui/sonner";
import type {
  Agent,
  AgentPartInput,
  FilePartInput,
  ProviderListResponse,
  TextPartInput,
} from "@opencode-ai/sdk/v2/client";

import { captureAnalyticsEvent, markTaskRunStart } from "@/app/lib/analytics";
import { trackSessionActive, trackTaskStarted } from "@/app/lib/den-telemetry";
import { createClient, unwrap } from "@/app/lib/opencode";
import { abortSessionSafe, compactSession, forkSession, listCommands, revertSession, setSessionArchived, shellInSession } from "@/app/lib/opencode-session";
import { preferLocalizedSlashCommands } from "@/react-app/domains/session/surface/composer/slash-command-localize";
import { currentLocale } from "@/i18n";
import {
  isStuckToolAutoContinueText,
} from "@/react-app/domains/session/surface/stuck-tool-recovery";
import { useSessionManagementStore as sessionManagementStore } from "@/react-app/domains/session/sidebar/session-management-store";
import {
  buildOpenworkWorkspaceBaseUrl,
  createOpenworkServerClient,
  readOpenworkServerSettings,
  type OpenworkServerClient,
  type OpenworkSessionMessage,
  type OpenworkWorkspaceInfo,
} from "@/app/lib/openwork-server";
import { ensureWorkspaceRegisteredOnServer } from "@/react-app/domains/wodeapp/wodeapp-ensure-server-workspace";
import {
  resolveWorkspaceEndpoint,
  workspaceServerId,
  type ResolvedWorkspaceEndpoint,
} from "@/app/lib/workspace-endpoint";
import { buildOpenworkEnvRuntimeKey } from "@/app/lib/openwork-env-runtime";
import {
  getDesktopHomeDir,
  joinDesktopPath,
  revealDesktopItemInDir,
  pickDirectory,
  resolveWorkspaceListSelectedId,
  workspaceBootstrap,
  workspaceForget,
  workspaceSetRuntimeActive,
  workspaceSetSelected,
  type OpenworkServerInfo,
  type WorkspaceInfo,
  type WorkspaceList,
} from "@/app/lib/desktop";
import type {
  ComposerAttachment,
  ComposerDraft,
  ComposerPart,
  ModelOption,
  ModelRef,
  SlashCommandOption,
  WorkspacePreset,
  WorkspaceConnectionState,
  Client,
  ProviderListItem,
  WorkspaceDisplay,
  WorkspaceSessionGroup,
} from "@/app/types";
import { buildFeedbackUrl } from "@/app/lib/feedback";
import {
  getWorkspaceTaskLoadErrorDisplay,
  isDesktopRuntime,
  isSandboxWorkspace,
  normalizeDirectoryPath,
  normalizeSessionStatus,
  modelEquals,
  resolveModelDisplayName,
  safeStringify,
} from "@/app/utils";
import { t } from "@/i18n";
import {
  blankProjectName,
  resolveBlankProjectFolderPath,
} from "@/react-app/domains/wodeapp/wodeapp-blank-project";
import {
  type RouteWorkspace,
  type RouteSession,
  describeRouteError,
  describeWorkspaceCreateError,
  downloadWorkspaceJson,
  folderNameFromPath,
  getSessionStatus,
  isActiveSessionStatus,
  isTransientStartupError,
  mapDesktopWorkspace,
  mergeRouteWorkspaces,
  orderRouteWorkspaces,
  toSessionGroups,
  workspaceExportFilename,
  workspaceLabel,
} from "@/react-app/shell/route-workspaces";
import { useLocal } from "@/react-app/kernel/local-provider";
import {
  parseSessionChoiceOverrides,
  serializeSessionChoiceOverrides,
  sessionModelOverridesKey,
  type SessionChoiceOverride,
} from "@/react-app/kernel/model-config";
import { usePlatform } from "@/react-app/kernel/platform";
import { SessionPage, type OpenSessionTab } from "@/react-app/domains/session/chat/session-page";
import { isWodeAppModelProvider } from "@/react-app/domains/wodeapp/wodeapp-model-display";
import {
  normalizeWodeAppModelRefForWorkbench,
  rememberUserSelectedDefaultModel,
  resolveConnectedWodeAppPromptModel,
  resolvePreferredWorkbenchModel,
  shouldHideWodeAppModelDetection,
  WODEAPP_PROVIDER_ID,
} from "@/react-app/domains/wodeapp/wodeapp-model-sync";
import { resolveByokProviderIdForAuth } from "@/react-app/domains/wodeapp/wodeapp-provider-detect";
import { modelSupportsVisionInput } from "@/react-app/domains/wodeapp/wodeapp-model-capabilities";
import {
  adaptKimiCodeModelForVideoInput,
  resolveModelMediaInputCapabilities,
} from "@/react-app/domains/wodeapp/wodeapp-model-media-input";
import {
  resolveSessionModelState,
  selectSessionModel,
  selectSessionVariant,
} from "@/react-app/domains/wodeapp/wodeapp-session-model-state";
import {
  attachmentContextCanBeDehydrated,
  buildAttachmentDisplayParts,
  buildAttachmentIntelligencePart,
  buildVisionEphemeralFollowupPart,
  isComposerImageAttachment,
  shouldIncludeRawAttachmentsInPrompt,
  shouldPreserveAttachmentsAsDisplayOnly,
  draftHasOnlyInlinePlainTextAttachments,
  shouldIncludeAssetMentionFilesInPrompt,
  shouldUseAttachmentIntelligence,
  stampComposerAttachmentLocalPaths,
  understandDraftAttachments,
} from "@/react-app/domains/wodeapp/wodeapp-attachment-intelligence";
import {
  deleteAttachmentContextForSession,
} from "@/react-app/domains/wodeapp/wodeapp-attachment-context-store";
import { desktopLocalFilePath } from "@/react-app/domains/wodeapp/desktop-local-file";
import { recordWodeAppContextHygieneEvent } from "@/react-app/domains/wodeapp/wodeapp-context-hygiene-metrics";
import {
  scheduleSessionHistoryCompaction,
  scheduleSessionHistoryRecoverySweep,
  scrubUnsafeModelMediaBeforePrompt,
} from "@/react-app/domains/wodeapp/wodeapp-vision-history-compact";
import { materializeComposerAttachmentsForSend, rememberSessionProductImageUploads } from "@/react-app/domains/wodeapp/wodeapp-product-image-materialize";
import { refreshWodeAppProviderCapabilities } from "@/react-app/domains/wodeapp/wodeapp-provider-capability-panel";
import {
  classifyWodeAppCreditGatedError,
  ensureWodeAppSendReady,
  WodeAppSendBlockedError,
} from "@/react-app/domains/wodeapp/wodeapp-send-readiness";
import {
  WODEAPP_OPEN_BYOK_GUIDE_EVENT,
} from "@/react-app/domains/wodeapp/wodeapp-byok-guide";
import {
  openFirstMileGuide,
  publishFirstMileStatus,
  readFirstMileDismissed,
  resolveFirstMileHasUsableModel,
  shouldAutoOpenFirstMile,
  shouldWaitForProviderListBeforeFirstMile,
} from "@/react-app/domains/wodeapp/wodeapp-first-mile";
import {
  copyWodeAppSessionDebugBundle,
  copyWodeAppSessionId,
  type WodeAppSessionDebugContext,
} from "@/react-app/domains/wodeapp/wodeapp-session-debug";
import { WodeAppWorkbenchShell } from "@/react-app/domains/wodeapp/wodeapp-workbench-shell";
import { reportDesktopDiagnostic } from "@/react-app/domains/wodeapp/wodeapp-desktop-diagnostics";
import { hasWodeAppFeishuSetupSkill } from "@/react-app/domains/wodeapp/runtime-projects";
import { createWodeAppAutomationClient } from "@/react-app/domains/wodeapp/wodeapp-automation-client";
import {
  isWodeAppAuthAvailable,
  applyWodeAppProvider,
  getWodeAppApiCredentials,
  loadCachedWodeAppAuthState,
} from "@/app/lib/wodeapp-auth";
import { isDesktopProviderBlocked, DESKTOP_RESTRICTION_OPENCODE_PROVIDER_ID } from "@/app/cloud/desktop-app-restrictions";
import { useCheckDesktopRestriction } from "@/react-app/domains/cloud/desktop-config-provider";
import { useRestrictionNotice } from "@/react-app/domains/cloud/restriction-notice-provider";
import { ReactSessionRuntime } from "@/react-app/domains/session/sync/runtime-sync";
import { useSessionActivityStore } from "@/react-app/domains/session/status/session-activity-store";
import { buildOpenworkEnvSystemContext } from "@/react-app/domains/session/sync/env-context";
import {
  applySessionRevert,
  prefetchSessionSnapshot,
} from "@/react-app/domains/session/sync/session-sync";
import { firstLineLocalFileParts } from "@/react-app/domains/session/sync/prompt-file-parts";
import { useSessionInteractions } from "@/react-app/domains/session/sync/use-session-interactions";
import { useModelBehavior } from "@/react-app/domains/session/surface/use-model-behavior";
import { useModelPicker } from "@/react-app/domains/session/modals/use-model-picker";
import { appMentionInstruction } from "@/react-app/domains/session/surface/composer/app-mentions";
import { formatAgentDisplayName } from "@/react-app/domains/session/surface/composer/composer";
import { CreateRemoteWorkspaceModal } from "@/react-app/domains/workspace/create-remote-workspace-modal";
import { CreateWorkspaceModal } from "@/react-app/domains/workspace/create-workspace-modal";
import { useSessionProviderAuth } from "@/react-app/domains/connections/provider-auth/use-session-provider-auth";
import { useMcpConnectedCount } from "@/react-app/domains/connections/use-mcp-connected-count";
import { useRemoteAccessRestart } from "@/react-app/domains/workspace/remote-access-restart";
import { RenameWorkspaceModal } from "@/react-app/domains/workspace/rename-workspace-modal";
import { useRemoteWorkspaceConnectionEditor } from "@/react-app/domains/workspace/use-remote-workspace-connection-editor";
import { useDenAuth } from "@/react-app/domains/cloud/den-auth-provider";
import { OpenWorkModelsStartupDialog } from "@/react-app/domains/cloud/openwork-models-startup-dialog";
import { OPENWORK_MODEL_PREVIEWS } from "@/react-app/domains/cloud/openwork-models-promo";
import { useOpenWorkModelsStartupPromo } from "@/react-app/domains/cloud/use-openwork-models-startup-promo";
import {
  diagnoseRemoteWorkspaceTaskLoadFailure,
  getRemoteWorkspaceConnectionKey,
  testRemoteWorkspaceConnection,
} from "@/react-app/domains/workspace/remote-workspace-diagnostics";
import { useShareWorkspaceState } from "@/react-app/domains/workspace/share-workspace-state";
import { useWodeAppCloudRelayBridge } from "@/react-app/domains/wodeapp/wodeapp-cloud-relay";
import { WODEAPP_MOBILE_REMOTE_ENABLED } from "@/react-app/domains/wodeapp/wodeapp-mobile-remote-feature";
import { ModelPickerModal } from "@/react-app/domains/session/modals/model-picker-modal";
import { CommandPalette, type PaletteItem, type SessionGroupOption, type SessionOption as PaletteSessionOption } from "./command-palette";
import { SessionSearchDialog } from "./session-search-dialog";
import type { SessionMessageFetcher } from "@/react-app/domains/session/search/session-search";
import {
  getDisplaySessionTitle,
  isGeneratedSessionTitle,
  makeSessionTitleFromText,
} from "@/app/lib/session-title";
import { useBootState } from "./boot-state";
import {
  forgetWorkspaceMemory,
  readActiveWorkspaceId,
  readLastSessionFor,
  readWorkspaceOrderIds,
  writeActiveWorkspaceId,
  writeLastSessionFor,
  writeWorkspaceOrderIds,
} from "./session-memory";
import {
  publishInspectorSlice,
  recordInspectorEvent,
} from "../../app/lib/app-inspector";
import { saveSessionDraft } from "@/react-app/domains/session/sync/draft-store";
import {
  buildComposerTextWithAssetMentions,
  primeComposerAssetMentions,
} from "@/react-app/domains/wodeapp/wodeapp-agent-handoff";
import { queueBuiltinAgentAutoSend } from "@/react-app/domains/wodeapp/wodeapp-auto-orchestration";
import {
  normalizeWodeAppTaskPromptInput,
  primeWodeAppComposer,
  setWodeAppComposerHandoff,
  type WodeAppTaskPromptInput,
} from "@/react-app/domains/wodeapp/wodeapp-composer-handoff";
import {
  bindWodeAppRuntimeProfileToSession,
  buildWodeAppRuntimeProfileSystemContext,
  clearWodeAppRuntimeProfileForSession,
  findWodeAppRuntimeProfile,
  listWodeAppRuntimeProfiles,
  readWodeAppRuntimeProfileForSession,
  wodeAppRuntimeProfileAgentId,
  WODEAPP_RUNTIME_PROFILE_CHANGED_EVENT,
} from "@/react-app/domains/wodeapp/wodeapp-runtime-profile";
import { useControlAction, type OpenworkControlAction } from "./control/control-provider";
import { useReactRenderWatchdog } from "./react-render-watchdog";

import { readDenSettings } from "@/app/lib/den";
import { denSessionUpdatedEvent } from "@/app/lib/den-session-events";

import { filterProviderList } from "@/app/utils/providers";
import { ensureDesktopLocalOpenworkConnection } from "./desktop-local-openwork";
import { resolveOpenworkConnection } from "./openwork-connection";
import { useReloadCoordinator } from "./reload-coordinator";
import { useShellConfig } from "./shell-config";
import { useShellShortcuts } from "./use-shell-shortcuts";
import { useEngineReload } from "./use-engine-reload";
import { useSessionGroupSync } from "./use-session-group-sync";
import { useWorkspaceRouteState } from "./use-workspace-route-state";
import { getReactQueryClient } from "@/react-app/infra/query-client";
import { useSessionControlActions } from "@/react-app/domains/session/control/session-control-actions";
import { legacySessionRoute, workspaceSessionRoute, workspaceSettingsRoute } from "./workspace-routes";
import { WorkspaceProvider } from "./workspace-provider";
import type { OpenTarget } from "@/react-app/domains/session/artifacts/open-target";
import { SettingsSurface } from "./settings-route";
import { assetMentionFileParts } from "./asset-mention-file-parts";
import {
  attachmentToModelFileData,
  modelFacingAttachmentMime,
} from "@/react-app/domains/session/sync/attachment-data-url";
import {
  ensureProviderListQuery,
  getConnectedProviderItems,
  isModelAvailableInConnectedProviders,
  refreshProviderListQueries,
  useProviderListState,
} from "@/react-app/infra/provider-list-query";

/**
 * Serialize an SDK error value into a string that parseSessionError can parse.
 * Preserves the original shape (name, data, message) as JSON when possible,
 * so the session surface can detect ProviderModelNotFoundError and offer
 * recovery actions like "Change model".
 */
function serializeSDKError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null) {
    try {
      return JSON.stringify(error);
    } catch {
      const msg = (error as Record<string, unknown>).message;
      return typeof msg === "string" ? msg : String(error);
    }
  }
  return String(error);
}

function describeTaskCreateError(error: unknown) {
  const message = describeRouteError(error);
  const lower = message.toLowerCase();
  if (
    lower.includes("failed to fetch") ||
    lower.includes("connection") ||
    lower.includes("fetch failed") ||
    lower.includes("econnrefused") ||
    lower.includes("connection lost") ||
    lower.includes("internal_error") ||
    lower.includes("unexpected server error")
  ) {
    return "The local engine is unavailable for this workspace. Retry once it restarts, or restart WodeAppX if the problem continues.";
  }
  return message;
}

function taskCreateUnavailableToastId(workspaceId: string) {
  return `opencode-unavailable:${workspaceId}`;
}

function focusPromptSoon() {
  if (typeof window === "undefined") return;
  const focus = () => window.dispatchEvent(new Event("openwork:focusPrompt"));
  [0, 80, 240, 600].forEach((delay) => window.setTimeout(focus, delay));
}

type WodeAppSessionHandoff = {
  id: string;
  prompt: string;
  autoSend: boolean;
};

const WODEAPP_HANDOFF_STORAGE_PREFIX = "openwork.wodeappHandoff.";
const WODEAPP_PENDING_HANDOFF_KEY = "openwork.wodeappPendingHandoff";
const WODEAPP_HANDOFF_PROMPT_LIMIT = 20_000;

function fallbackHandoffId(prompt: string) {
  let hash = 0;
  for (let index = 0; index < prompt.length; index += 1) {
    hash = ((hash << 5) - hash + prompt.charCodeAt(index)) | 0;
  }
  return `prompt-${Math.abs(hash).toString(36)}`;
}

function parseWodeAppSessionHandoff(search: string): WodeAppSessionHandoff | null {
  const params = new URLSearchParams(search);
  if (params.get("wodeappSource") !== "wodeappx") return null;
  const prompt = params.get("wodeappPrompt")?.trim();
  if (!prompt) return null;
  return {
    id: params.get("wodeappHandoffId")?.trim() || fallbackHandoffId(prompt),
    prompt: prompt.slice(0, WODEAPP_HANDOFF_PROMPT_LIMIT),
    autoSend: params.get("wodeappAutoSend") === "1",
  };
}

function savePendingWodeAppSessionHandoff(handoff: WodeAppSessionHandoff) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(WODEAPP_PENDING_HANDOFF_KEY, JSON.stringify(handoff));
  } catch {
    // ignore storage failures; the URL handoff still works for the current route.
  }
}

function readPendingWodeAppSessionHandoff(): WodeAppSessionHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(WODEAPP_PENDING_HANDOFF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WodeAppSessionHandoff>;
    const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
    const prompt = typeof parsed.prompt === "string" ? parsed.prompt.trim() : "";
    if (!id || !prompt) return null;
    return {
      id,
      prompt: prompt.slice(0, WODEAPP_HANDOFF_PROMPT_LIMIT),
      autoSend: parsed.autoSend === true,
    };
  } catch {
    return null;
  }
}

function clearPendingWodeAppSessionHandoff() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(WODEAPP_PENDING_HANDOFF_KEY);
  } catch {
    // ignore
  }
}

function readWodeAppSessionHandoff(): WodeAppSessionHandoff | null {
  if (typeof window === "undefined") return null;
  const fromUrl = parseWodeAppSessionHandoff(window.location.search);
  if (fromUrl) {
    savePendingWodeAppSessionHandoff(fromUrl);
    return fromUrl;
  }
  return readPendingWodeAppSessionHandoff();
}

function clearWodeAppSessionHandoffFromUrl() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const before = url.search;
  [
    "wodeappSource",
    "wodeappAutoSend",
    "wodeappHandoffId",
    "wodeappPrompt",
    "clipboard",
  ].forEach((key) => url.searchParams.delete(key));
  if (url.search !== before) {
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
}

function claimWodeAppSessionHandoff(id: string): boolean {
  if (typeof window === "undefined") return true;
  try {
    const key = `${WODEAPP_HANDOFF_STORAGE_PREFIX}${id}`;
    if (window.sessionStorage.getItem(key)) return false;
    window.sessionStorage.setItem(key, String(Date.now()));
    return true;
  } catch {
    return true;
  }
}

function buildWodeAppHandoffDraft(text: string): ComposerDraft {
  return {
    text,
    resolvedText: text,
    mode: "prompt",
    parts: [{ type: "text", text }],
    attachments: [],
  };
}

// All workspace-scoped server URLs/clients/tokens come from
// `resolveWorkspaceEndpoint` in apps/app/src/app/lib/workspace-endpoint.ts.
// Don't compose `<baseUrl>/workspace/<id>` here.

function localAttachmentFileUrl(file: File): string | null {
  const path = desktopLocalFilePath(file)?.trim();
  if (!path) return null;
  if (/^file:\/\//i.test(path)) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return `file://${path}`;
}

function attachmentMime(attachment: ComposerAttachment) {
  const mime = (attachment.mimeType || attachment.file.type || "").trim().toLowerCase();
  if (mime && mime !== "application/octet-stream") return mime;
  const name = attachment.name || attachment.file.name || "";
  if (/\.png$/i.test(name)) return "image/png";
  if (/\.jpe?g$/i.test(name)) return "image/jpeg";
  if (/\.gif$/i.test(name)) return "image/gif";
  if (/\.webp$/i.test(name)) return "image/webp";
  if (/\.bmp$/i.test(name)) return "image/bmp";
  if (/\.svg$/i.test(name)) return "image/svg+xml";
  if (mime) return mime;
  // Never disguise unknown binary data as text: OpenCode may decode a
  // text/plain file into a synthetic text part and permanently poison history.
  return "application/octet-stream";
}

type DraftToPartsOptions = {
  /** 是否保留对话上传的原始附件（图片/文档等）。附件理解已接管时应为 false。 */
  includeRawAttachments?: boolean;
  /** 仅打包图片附件（视觉模型在混有 PDF 等文档时补发像素）。 */
  rawAttachmentsImagesOnly?: boolean;
  /** 是否保留 @ 引用资产的图片 file part。附件理解已将其入参时应为 false。 */
  includeAssetMentionFiles?: boolean;
};

async function draftToParts(draft: ComposerDraft, workspaceRoot: string, options: DraftToPartsOptions = {}) {
  const parts: Array<TextPartInput | FilePartInput | AgentPartInput> = [];
  const root = workspaceRoot.trim();
  const includeRawAttachments = options.includeRawAttachments ?? true;
  const rawAttachmentsImagesOnly = options.rawAttachmentsImagesOnly === true;
  const includeAssetMentionFiles = options.includeAssetMentionFiles ?? true;
  const promptText = (draft.resolvedText ?? draft.text).trim();
  if (promptText) {
    parts.push({
      type: "text",
      text: promptText,
      ...(isStuckToolAutoContinueText(promptText) ? { synthetic: true } : {}),
    });
  }
  if (includeAssetMentionFiles) {
    parts.push(...await assetMentionFileParts(draft.assetMentions));
  }

  const toAbsolutePath = (path: string) => {
    const trimmed = path.trim();
    if (!trimmed) return "";
    if (trimmed.startsWith("/")) return trimmed;
    if (/^[a-zA-Z]:\\/.test(trimmed)) return trimmed;
    if (!root) return "";
    return `${root}/${trimmed}`.replace(/\/\/+/g, "/");
  };

  const filenameFromPath = (path: string) => {
    const normalized = path.replace(/\\/g, "/");
    const segments = normalized.split("/").filter(Boolean);
    return segments[segments.length - 1] ?? "file";
  };

  for (const part of draft.parts) {
    if (part.type === "text") {
      continue;
    }
    if (part.type === "paste") {
      continue;
    }
    if (part.type === "agent") {
      parts.push({ type: "agent", name: part.name });
      continue;
    }
    if (part.type === "skill") {
      parts.push({ type: "text", text: `Load [skill ${part.name}] and follow its instructions.` });
      continue;
    }
    if (part.type === "app") {
      parts.push({ type: "text", text: appMentionInstruction(part.name) });
      continue;
    }
    if (part.type === "file") {
      const absolute = toAbsolutePath(part.path);
      if (!absolute) continue;
      parts.push({
        type: "file",
        mime: "text/plain",
        url: `file://${absolute}`,
        filename: filenameFromPath(part.path),
      });
    }
  }

  parts.push(...firstLineLocalFileParts(draft.resolvedText ?? draft.text, root));

  const rawAttachments = includeRawAttachments
    ? draft.attachments.filter((attachment) =>
      !rawAttachmentsImagesOnly || isComposerImageAttachment(attachment),
    )
    : [];
  const rawFileParts = (
    await Promise.all(
      rawAttachments.map(async (attachment) => {
        const mime = attachmentMime(attachment);
        const isImage = isComposerImageAttachment(attachment) || mime.startsWith("image/");
        // Cursor/Codex-style: A/V never become model-facing type:file (AI SDK rejects
        // video/* on replay). History chips use display placeholders with file://.
        // Engine resolvePart also refuses data: for A/V/PDF even when mime is wrong.
        if (!isImage) {
          if (mime.startsWith("video/") || mime.startsWith("audio/")) return null;
          // OpenCode inlines file:// PDF/Office into data:application — refuse oversized binaries.
          const maxNonImageBytes = 512 * 1024;
          if (Number(attachment.file?.size || 0) > maxNonImageBytes) return null;
          // Provider-safe mime only (#3079): json/xml/csv → text/plain; zip/binary → drop file part.
          const modelMime = modelFacingAttachmentMime(mime);
          if (!modelMime) return null;
          const localUrl = localAttachmentFileUrl(attachment.file);
          if (!localUrl) return null;
          return {
            type: "file" as const,
            url: localUrl,
            filename: attachment.name,
            mime: modelMime,
          };
        }
        // Images: vision models need base64; file:// is not readable by cloud vision
        // and poisons history replay (AI SDK only accepts http/https/data).
        const modelFileData = await attachmentToModelFileData(attachment.file, mime);
        if (/^file:/i.test(modelFileData.url)) return null;
        return {
          type: "file" as const,
          url: modelFileData.url,
          filename: modelFileData.filename,
          mime: modelFileData.mime,
        };
      }),
    )
  ).filter((part): part is {
    type: "file";
    url: string;
    filename: string;
    mime: string;
  } => Boolean(part?.url));
  parts.push(...rawFileParts);

  return parts;
}

const WODEAPP_FEISHU_EXTENSION_ID = "feishu-agent-mcp";
const WODEAPP_FEISHU_AUTH_TOAST_ID = "wodeapp-feishu-authorize";

function normalizeFeishuWorkbenchLoginResult(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { authorized: false, configPath: "", integration: "missing" };
  }
  const record = value as Record<string, unknown>;
  return {
    authorized: record.authorized === true,
    configPath: typeof record.configPath === "string" ? record.configPath.trim() : "",
    integration: record.integration === "lark-cli" || record.integration === "lark-mcp"
      ? record.integration
      : "missing",
    userName: typeof record.userName === "string" ? record.userName.trim() : "",
  };
}

function normalizeFeishuWorkbenchStatus(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { configured: false, authorized: false, integration: "missing", userName: "" };
  }
  const record = value as Record<string, unknown>;
  return {
    configured: record.configured === true,
    authorized: record.authorized === true,
    integration: record.integration === "lark-cli" || record.integration === "lark-mcp"
      ? record.integration
      : "missing",
    userName: typeof record.userName === "string" ? record.userName.trim() : "",
  };
}

function isFeishuWorkbenchCredentialError(message: string) {
  const lower = message.toLowerCase();
  return lower.includes("app id")
    || lower.includes("app secret")
    || lower.includes("credential")
    || lower.includes("feishu_credentials_missing");
}


export function SessionRoute() {
  const navigate = useNavigate();
  const platform = usePlatform();
  const denAuth = useDenAuth();
  const { config: shellConfig } = useShellConfig();
  const local = useLocal();
  const [sessionModelOverridesByWorkspace, setSessionModelOverridesByWorkspace] = useState<
    Record<string, Record<string, SessionChoiceOverride>>
  >({});
  const reloadCoordinator = useReloadCoordinator();
  const checkDesktopRestriction = useCheckDesktopRestriction();
  const restrictionNotice = useRestrictionNotice();
  const [openworkServerHostInfoState, setOpenworkServerHostInfoState] = useState<OpenworkServerInfo | null>(null);
  const [openworkServerSettingsVersion, setOpenworkServerSettingsVersion] = useState(0);
  const {
    navigateToWorkspaceSession,
    routeWorkspaceId,
    selectedSessionId,
    loading,
    effectiveLoading,
    client,
    baseUrl,
    token,
    workspaces,
    setWorkspaces,
    workspacesRef,
    workspaceOrderIds,
    setWorkspaceOrderIds,
    workspaceOrderIdsRef,
    sessionsByWorkspaceId,
    setSessionsByWorkspaceId,
    sessionsByWorkspaceIdRef,
    errorsByWorkspaceId,
    setErrorsByWorkspaceId,
    workspaceConnectionOverrides,
    routeError,
    setRouteError,
    legacySelectedWorkspaceId,
    setLegacySelectedWorkspaceId,
    retryingWorkspaceIds,
    setRetryingWorkspaceIds,
    refreshInFlightRef,
    startupRetryTimerRef,
    selectedWorkspaceId,
    selectedWorkspace,
    selectedWorkspaceRoot,
    selectedWorkspaceEndpoint,
    selectedWorkspaceServerToken,
    opencodeBaseUrl,
    opencodeClient,
    selectedWorkspaceIsLoading,
    selectedWorkspaceError,
    routeNotFoundMessage,
    endpointForWorkspace,
    refreshRouteState,
    loadWorkspaceSessionsInBackground,
    rememberPendingCreatedSession,
    handleRuntimeSessionUpdated,
    handleRemoteWorkspaceConnectionSaved,
    runRemoteWorkspaceConnectionCheck,
  } = useWorkspaceRouteState({
    onServerSettingsChanged: () => setOpenworkServerSettingsVersion((value) => value + 1),
    onHostInfo: setOpenworkServerHostInfoState,
    welcomePageEnabled: shellConfig.welcomePage,
  });
  useEffect(() => {
    const sessionId = selectedSessionId?.trim();
    if (!opencodeClient || !sessionId) return;
    // 重启或错过 busy 事件时，在已选中的空闲会话上补做幂等瘦身。
    scheduleSessionHistoryRecoverySweep({
      client: opencodeClient,
      sessionId,
      directory: selectedWorkspaceRoot || undefined,
    });
  }, [opencodeClient, selectedSessionId, selectedWorkspaceRoot]);
  const readSessionModelOverrides = useCallback((workspaceId: string) => {
    if (!workspaceId || typeof window === "undefined") return {};
    try {
      return parseSessionChoiceOverrides(
        window.localStorage.getItem(sessionModelOverridesKey(workspaceId)),
      );
    } catch {
      return {};
    }
  }, []);
  const sessionModelOverrides = useMemo(
    () => sessionModelOverridesByWorkspace[selectedWorkspaceId] ?? readSessionModelOverrides(selectedWorkspaceId),
    [readSessionModelOverrides, selectedWorkspaceId, sessionModelOverridesByWorkspace],
  );
  useEffect(() => {
    if (!selectedWorkspaceId || sessionModelOverridesByWorkspace[selectedWorkspaceId]) return;
    const stored = readSessionModelOverrides(selectedWorkspaceId);
    setSessionModelOverridesByWorkspace((current) => (
      current[selectedWorkspaceId]
        ? current
        : { ...current, [selectedWorkspaceId]: stored }
    ));
  }, [readSessionModelOverrides, selectedWorkspaceId, sessionModelOverridesByWorkspace]);

  const selectedSessionChoice = selectedSessionId
    ? sessionModelOverrides[selectedSessionId]
    : undefined;
  const selectedModelState = useMemo(() => resolveSessionModelState(
    local.prefs.defaultModel,
    local.prefs.modelVariant,
    selectedSessionChoice,
  ), [local.prefs.defaultModel, local.prefs.modelVariant, selectedSessionChoice]);
  const selectedModel = selectedModelState.model;
  const selectedModelVariant = selectedModelState.variant;

  const updateSessionChoice = useCallback((
    sessionId: string,
    updater: (previous: SessionChoiceOverride) => SessionChoiceOverride,
  ) => {
    const workspaceId = selectedWorkspaceId;
    const normalizedSessionId = sessionId.trim();
    if (!workspaceId || !normalizedSessionId) return;
    setSessionModelOverridesByWorkspace((current) => {
      const previousOverrides = current[workspaceId] ?? readSessionModelOverrides(workspaceId);
      const nextOverrides = {
        ...previousOverrides,
        [normalizedSessionId]: updater(previousOverrides[normalizedSessionId] ?? {}),
      };
      try {
        const serialized = serializeSessionChoiceOverrides(nextOverrides);
        const key = sessionModelOverridesKey(workspaceId);
        if (serialized) window.localStorage.setItem(key, serialized);
        else window.localStorage.removeItem(key);
      } catch {
        // Keep the in-memory session choice even if persistence is unavailable.
      }
      return { ...current, [workspaceId]: nextOverrides };
    });
  }, [readSessionModelOverrides, selectedWorkspaceId]);

  const setSelectedSessionModel = useCallback((model: ModelRef) => {
    if (!selectedSessionId) return;
    updateSessionChoice(selectedSessionId, () => selectSessionModel(selectedModelState, model));
  }, [selectedModelState, selectedSessionId, updateSessionChoice]);

  const rememberSelectedModel = useCallback((model: ModelRef) => {
    setSelectedSessionModel(model);
    rememberUserSelectedDefaultModel(local.setPrefs, model);
  }, [local.setPrefs, setSelectedSessionModel]);

  const setSelectedSessionVariant = useCallback((variant: string | null) => {
    if (!selectedSessionId || !selectedModel) return;
    updateSessionChoice(selectedSessionId, () => selectSessionVariant(selectedModelState, variant));
  }, [selectedModel, selectedModelState, selectedSessionId, updateSessionChoice]);
  const automationClient = useMemo(
    () => client?.baseUrl ? createWodeAppAutomationClient({ baseUrl: client.baseUrl, token: client.token }) : undefined,
    [client?.baseUrl, client?.token],
  );
  const [wodeAppHandoff, setWodeAppHandoff] = useState<WodeAppSessionHandoff | null>(
    () => readWodeAppSessionHandoff(),
  );
  const wodeAppHandoffCreateStartedRef = useRef(false);
  const wodeAppHandoffSendStartedRef = useRef(false);
  useEffect(() => {
    if (!wodeAppHandoff) return;
    clearWodeAppSessionHandoffFromUrl();
  }, [wodeAppHandoff]);
  // Agent selection is persisted in local prefs (like the model variant) so
  // it survives reloads instead of silently falling back to "build" (#2101).
  const selectedAgent = local.prefs.selectedAgent;
  const setSelectedAgent = useCallback(
    (agent: string | null) => {
      local.setPrefs((previous) => ({ ...previous, selectedAgent: agent }));
    },
    [local.setPrefs],
  );
  const [runtimeProfileVersion, setRuntimeProfileVersion] = useState(0);
  useEffect(() => {
    const handleRuntimeProfileChanged = (event: Event) => {
      const detail = event instanceof CustomEvent
        ? event.detail as { workspaceId?: string; sessionId?: string }
        : null;
      if (
        detail?.workspaceId === selectedWorkspaceId
        && detail?.sessionId === selectedSessionId
      ) {
        setRuntimeProfileVersion((version) => version + 1);
      }
    };
    window.addEventListener(WODEAPP_RUNTIME_PROFILE_CHANGED_EVENT, handleRuntimeProfileChanged);
    return () => {
      window.removeEventListener(WODEAPP_RUNTIME_PROFILE_CHANGED_EVENT, handleRuntimeProfileChanged);
    };
  }, [selectedSessionId, selectedWorkspaceId]);
  const selectedRuntimeProfile = useMemo(
    () => readWodeAppRuntimeProfileForSession(
      selectedWorkspaceId,
      selectedSessionId ?? "",
    ),
    [runtimeProfileVersion, selectedSessionId, selectedWorkspaceId],
  );
  const handleSelectSessionAgent = useCallback((agent: string | null) => {
    const runtimeProfile = findWodeAppRuntimeProfile(agent);
    if (runtimeProfile && selectedWorkspaceId && selectedSessionId) {
      bindWodeAppRuntimeProfileToSession(
        selectedWorkspaceId,
        selectedSessionId,
        runtimeProfile.id,
      );
      setSelectedAgent(null);
      return;
    }
    if (selectedWorkspaceId && selectedSessionId) {
      clearWodeAppRuntimeProfileForSession(selectedWorkspaceId, selectedSessionId);
    }
    setSelectedAgent(agent);
  }, [selectedSessionId, selectedWorkspaceId, setSelectedAgent]);
  // One-way latch for "a refreshRouteState is currently running"; prevents
  // overlapping route refreshes from queueing up when the user clicks fast.
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const [createWorkspaceBusy, setCreateWorkspaceBusy] = useState(false);
  const [createWorkspaceError, setCreateWorkspaceError] = useState<string | null>(null);
  const [createWorkspaceRemoteBusy, setCreateWorkspaceRemoteBusy] = useState(false);
  const [createWorkspaceRemoteError, setCreateWorkspaceRemoteError] = useState<string | null>(null);
  const [renameWorkspaceId, setRenameWorkspaceId] = useState<string | null>(null);
  const [renameWorkspaceTitle, setRenameWorkspaceTitle] = useState("");
  const [renameWorkspaceBusy, setRenameWorkspaceBusy] = useState(false);
  const [developerMode, setDeveloperMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("openwork.developerMode") === "1";
  });
  const [paletteAccessibleTargets, setPaletteAccessibleTargets] = useState<OpenTarget[]>([]);
  const [providers, setProviders] = useState<ProviderListItem[]>([]);
  const [providerDefaults, setProviderDefaults] = useState<Record<string, string>>({});
  const [providerConnectedIds, setProviderConnectedIds] = useState<string[]>([]);
  // Exclude the built-in OpenCode Zen provider from the "user" count so the
  // onboarding CTA ("Connect a model") only considers user-added providers.
  const userProviderConnectedIds = useMemo(
    () => providerConnectedIds.filter((id) => id !== DESKTOP_RESTRICTION_OPENCODE_PROVIDER_ID),
    [providerConnectedIds],
  );
  const [disabledProviderIds, setDisabledProviderIds] = useState<string[]>([]);
  // Bump to re-filter provider list when den session changes (sign-in/out)
  const [denSessionVersion, setDenSessionVersion] = useState(0);
  useEffect(() => {
    const handler = () => setDenSessionVersion((v) => v + 1);
    window.addEventListener(denSessionUpdatedEvent, handler);
    return () => window.removeEventListener(denSessionUpdatedEvent, handler);
  }, []);

  // Provider IDs that were just added — used to highlight them as
  useEffect(() => {
    setPaletteAccessibleTargets([]);
  }, [selectedSessionId, selectedWorkspaceId]);

  // Provider catalog cache. Used to compute the reasoning/thinking variant
  // options for whichever model is currently selected so the composer's
  // behavior pill actually shows its options (bug: was empty before).

  const openworkServerSettings = useMemo(
    () => readOpenworkServerSettings(),
    [openworkServerSettingsVersion],
  );

  const activeReloadBlockingSessions = useMemo(
    () =>
      Object.values(sessionsByWorkspaceId)
        .flat()
        .flatMap((session) => {
          if (!isActiveSessionStatus(getSessionStatus(session))) return [];
          const id = String(session?.id ?? "");
          if (!id) return [];
          return [{
            id,
            title:
              String(session?.title ?? session?.slug ?? session?.id ?? "").trim() ||
              t("session.untitled"),
          }];
        }),
    [sessionsByWorkspaceId],
  );
  const activeSelectedWorkspaceSessionIds = useMemo(
    () =>
      (sessionsByWorkspaceId[selectedWorkspaceId] ?? []).flatMap((session) => {
        if (!isActiveSessionStatus(getSessionStatus(session))) return [];
        const id = String(session?.id ?? "").trim();
        return id ? [id] : [];
      }),
    [selectedWorkspaceId, sessionsByWorkspaceId],
  );

  const remoteAccessRestart = useRemoteAccessRestart({
    isEnabled: () => openworkServerSettings.remoteAccessEnabled === true,
    onHostInfo: setOpenworkServerHostInfoState,
    onSettingsChanged: () => setOpenworkServerSettingsVersion((value) => value + 1),
  });

  const { engineReloadVersion, routeEngineInfo, reloadWorkspaceEngineFromUi } = useEngineReload({
    client,
    workspaceId: selectedWorkspaceId,
    workspace: selectedWorkspace,
    endpointForWorkspace,
    activeReloadBlockingSessions,
    onError: setRouteError,
    refreshRouteState,
  });
  const [feishuSetupSkillReady, setFeishuSetupSkillReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFeishuSetupSkillReady(false);
    if (!opencodeClient) {
      return () => {
        cancelled = true;
      };
    }

    void opencodeClient.app.skills({
      directory: selectedWorkspaceRoot || undefined,
    }).then((result) => {
      if (!cancelled) setFeishuSetupSkillReady(hasWodeAppFeishuSetupSkill(result.data));
    }).catch(() => {
      if (!cancelled) setFeishuSetupSkillReady(false);
    });

    return () => {
      cancelled = true;
    };
  }, [engineReloadVersion, opencodeClient, selectedWorkspaceRoot]);

  const environmentRuntimeKey = useMemo(
    () => buildOpenworkEnvRuntimeKey({
      baseUrl: client?.baseUrl ?? null,
      pid: openworkServerHostInfoState?.pid ?? null,
      port: openworkServerHostInfoState?.port ?? null,
    }),
    [client?.baseUrl, openworkServerHostInfoState?.pid, openworkServerHostInfoState?.port],
  );

  const handleApplyEnvironmentChanges = useCallback(async () => {
    if (!isDesktopRuntime()) {
      throw new Error(t("settings.environment.apply_unavailable"));
    }
    if (activeReloadBlockingSessions.length > 0) {
      throw new Error(t("settings.environment.apply_blocked_active_tasks"));
    }
    if (!selectedWorkspaceRoot) {
      throw new Error(t("settings.environment.apply_no_local_workspace"));
    }
    const reloaded = await reloadWorkspaceEngineFromUi();
    if (!reloaded) {
      throw new Error(t("app.error_connect_first"));
    }
  }, [activeReloadBlockingSessions.length, reloadWorkspaceEngineFromUi, selectedWorkspaceRoot]);

  const shareWorkspaceState = useShareWorkspaceState({
    workspaces,
    openworkServerHostInfo: openworkServerHostInfoState,
    openworkServerSettings,
    engineInfo: routeEngineInfo,
    exportWorkspaceBusy: false,
    openLink: (url) => platform.openLink(url),
    workspaceLabel,
  });

  useWodeAppCloudRelayBridge({
    enabled:
      WODEAPP_MOBILE_REMOTE_ENABLED &&
      isDesktopRuntime() &&
      selectedWorkspace?.workspaceType === "local",
    localBaseUrl: openworkServerHostInfoState?.baseUrl,
    localToken: openworkServerHostInfoState?.ownerToken || openworkServerHostInfoState?.clientToken,
    workspaceId: selectedWorkspaceEndpoint?.workspaceId || selectedWorkspaceId,
  });


  const remoteWorkspaceConnectionEditor = useRemoteWorkspaceConnectionEditor({
    workspaces,
    onSaved: handleRemoteWorkspaceConnectionSaved,
  });


  const workspaceSessionGroups = useMemo(
    () => toSessionGroups(workspaces, sessionsByWorkspaceId, errorsByWorkspaceId, new Set(retryingWorkspaceIds)),
    [errorsByWorkspaceId, retryingWorkspaceIds, sessionsByWorkspaceId, workspaces],
  );
  useSessionGroupSync({ workspaces, selectedWorkspaceId, endpointForWorkspace });
  const selectedWorkspaceGroupState = sessionManagementStore((state) => (
    selectedWorkspaceId ? state.groupsByWorkspace[selectedWorkspaceId] : undefined
  ));
  const assignSessionToGroup = sessionManagementStore((state) => state.assignGroup);
  const seedWorkspaceActivitySessions = useSessionActivityStore((state) => state.seedWorkspaceSessions);
  const sessionActivityByWorkspaceId = useSessionActivityStore((state) => state.statusesByWorkspaceId);

  const selectedSessionError = useSessionActivityStore((state) => (
    selectedWorkspaceId && selectedSessionId
      ? state.recordsByWorkspaceId[selectedWorkspaceId]?.[selectedSessionId]?.errorMessage ?? null
      : null
  ));


  useEffect(() => {
    for (const group of workspaceSessionGroups) {
      seedWorkspaceActivitySessions(group.workspace.id, group.sessions);
      const serverId = workspaceServerId(group.workspace);
      if (serverId && serverId !== group.workspace.id) {
        seedWorkspaceActivitySessions(serverId, group.sessions);
      }
    }
  }, [seedWorkspaceActivitySessions, workspaceSessionGroups]);

  const sidebarSessionStatusById = useMemo(() => {
    const next: Record<string, string> = {};
    for (const group of workspaceSessionGroups) {
      const serverId = workspaceServerId(group.workspace);
      const workspaceStatuses = {
        ...(sessionActivityByWorkspaceId[group.workspace.id] ?? {}),
        ...(serverId ? sessionActivityByWorkspaceId[serverId] ?? {} : {}),
      };
      for (const session of group.sessions) {
        const status = workspaceStatuses[session.id];
        if (status) next[session.id] = status;
      }
    }
    return next;
  }, [sessionActivityByWorkspaceId, workspaceSessionGroups]);

  const sidebarActiveWorkspaceId = useMemo(() => {
    const sessionId = selectedSessionId?.trim() ?? "";
    if (sessionId) {
      const owner = workspaceSessionGroups.find((group) =>
        group.sessions.some((session) => session?.id === sessionId),
      );
      if (owner?.workspace.id) return owner.workspace.id;
    }
    return selectedWorkspaceId;
  }, [selectedSessionId, selectedWorkspaceId, workspaceSessionGroups]);

  const workspaceConnectionStateById = useMemo(() => {
    const next: Record<string, WorkspaceConnectionState> = { ...workspaceConnectionOverrides };
    for (const workspace of workspaces) {
      if (workspace.workspaceType !== "remote") continue;
      const error = errorsByWorkspaceId[workspace.id]?.trim();
      if (!error || next[workspace.id]?.status === "connecting") continue;
      next[workspace.id] ??= {
        status: "error",
        message: getWorkspaceTaskLoadErrorDisplay(workspace, error).message || error,
        checkedAt: null,
      };
    }
    return next;
  }, [errorsByWorkspaceId, workspaceConnectionOverrides, workspaces]);

  const mcpConnectedCount = useMcpConnectedCount(opencodeClient, selectedWorkspaceRoot);
  const providerListQuery = useProviderListState({
    client: opencodeClient,
    baseUrl: opencodeBaseUrl,
    directory: selectedWorkspaceRoot || undefined,
  });
  const { providerCatalog, modelVariantLabel, modelBehaviorOptions, modelVariantValue } =
    useModelBehavior({
      providerList: providerListQuery.data,
      defaultModel: selectedModel,
      modelVariant: selectedModelVariant,
    });
  const modelPicker = useModelPicker({
    client: opencodeClient,
    baseUrl: opencodeBaseUrl,
    workspaceRoot: selectedWorkspaceRoot,
  });
  const providerListSettling = shouldWaitForProviderListBeforeFirstMile({
    isFetching: providerListQuery.isFetching,
  });
  const selectedModelUnavailable = Boolean(
    selectedModel &&
      !providerListSettling &&
      (
        isDesktopProviderBlocked({
          providerId: selectedModel.providerID,
          checkRestriction: checkDesktopRestriction,
        }) ||
        (
          checkDesktopRestriction({ restriction: "allowCustomProviders" }) &&
          (providerListQuery.data
            ? !getConnectedProviderItems(providerListQuery.data).some(
                (provider) => provider.id.trim() === selectedModel.providerID.trim(),
              )
            : !providerConnectedIds.some(
                (providerId) => providerId.trim() === selectedModel.providerID.trim(),
              ))
        ) ||
        (
          providerListQuery.data &&
          !isModelAvailableInConnectedProviders(providerListQuery.data, selectedModel)
        )
      ),
  );
  const hideModelDetectionUi = shouldHideWodeAppModelDetection(
    shellConfig.wodeappWorkbench,
    selectedModel,
  );
  const effectiveModelUnavailable = hideModelDetectionUi ? false : selectedModelUnavailable;
  const hasUsableModel = Boolean(selectedModel && !effectiveModelUnavailable);
  const firstMileHasUsableModel = resolveFirstMileHasUsableModel({
    hasSelectedModel: Boolean(selectedModel),
    selectedModelUnavailable,
  });
  const canCreateTask = Boolean(
    opencodeClient && selectedWorkspaceId && !selectedWorkspaceError && !effectiveModelUnavailable,
  );

  const firstMileAutoOpenedRef = useRef(false);

  useEffect(() => {
    if (!shellConfig.wodeappWorkbench) return;
    let cancelled = false;
    void (async () => {
      let hasPlatformIdentity = false;
      let abilityProjectCount = 0;
      try {
        if (isWodeAppAuthAvailable()) {
          const cached = await loadCachedWodeAppAuthState();
          if (cached.ok && cached.signedIn && cached.config) {
            hasPlatformIdentity = true;
            const projects = cached.config.abilityProjects;
            abilityProjectCount = Array.isArray(projects) ? projects.length : 0;
          }
        }
      } catch {
        // ignore — First Mile still works with model Key only
      }
      if (cancelled) return;
      publishFirstMileStatus({
        hasUsableModel: firstMileHasUsableModel,
        hasPlatformIdentity,
        abilityProjectCount,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [firstMileHasUsableModel, shellConfig.wodeappWorkbench]);

  useEffect(() => {
    if (!shellConfig.wodeappWorkbench) return;
    if (firstMileAutoOpenedRef.current) return;
    if (providerListSettling) return;
    if (!shouldAutoOpenFirstMile({
      ready: true,
      hasUsableModel: firstMileHasUsableModel,
      dismissed: readFirstMileDismissed(),
    })) {
      return;
    }
    firstMileAutoOpenedRef.current = true;
    const timer = window.setTimeout(() => {
      openFirstMileGuide({
        hasUsableModel: firstMileHasUsableModel,
      });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [firstMileHasUsableModel, providerListSettling, shellConfig.wodeappWorkbench]);

  useEffect(() => {
    if (!shellConfig.wodeappWorkbench) return;
    void refreshWodeAppProviderCapabilities(false);
  }, [hasUsableModel, shellConfig.wodeappWorkbench]);

  // 恢复尝试计数：engine reload 是重操作，最多跑 1 次。跑完若 wodeapp 仍不在 opencode
  // connected 列表里，就停在静态错误，绝不无限 applyProvider+reload（那会导致 UI 一直闪）。
  // 模型恢复可用 / 退出工作台时清零，下次状态变化再重新武装。
  const wodeappModelRecoveryRef = useRef(0);
  const wodeappModelRecoveryInFlightRef = useRef(false);

  useEffect(() => {
    if (!shellConfig.wodeappWorkbench || providerListSettling) return;
    const preferred = resolvePreferredWorkbenchModel(
      providerListQuery.data,
      selectedModel,
    );
    if (!preferred || modelEquals(preferred, selectedModel ?? { providerID: "", modelID: "" })) return;
    setSelectedSessionModel(preferred);
  }, [
    providerListQuery.data,
    providerListSettling,
    selectedModel,
    setSelectedSessionModel,
    shellConfig.wodeappWorkbench,
  ]);

  // Keep OpenCode auth.json in sync with desktop login even when the model is already selectable.
  // Without this, chat completions can go out as guest (401 AUTH_REQUIRED) while the footer shows signed-in.
  useEffect(() => {
    if (!shellConfig.wodeappWorkbench) return;
    if (!isWodeAppAuthAvailable()) return;
    if (!opencodeClient?.auth?.set) return;
    let cancelled = false;
    void (async () => {
      try {
        const creds = await getWodeAppApiCredentials();
        if (cancelled || !creds?.apiKey) return;
        await opencodeClient.auth.set({
          providerID: WODEAPP_PROVIDER_ID,
          auth: { type: "api", key: creds.apiKey },
        });
      } catch {
        // best-effort — send path also retries auth.set
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [opencodeClient, shellConfig.wodeappWorkbench]);

  useEffect(() => {
    if (!shellConfig.wodeappWorkbench || !selectedModelUnavailable) {
      wodeappModelRecoveryRef.current = 0;
      wodeappModelRecoveryInFlightRef.current = false;
      return;
    }
    if (!isWodeAppAuthAvailable()) return;
    if (providerListSettling) return;
    // opencode 客户端还没就绪就先不消耗那唯一一次尝试，等它 ready 后再触发（deps 含 opencodeClient）。
    if (!opencodeClient) return;

    const resolved = resolvePreferredWorkbenchModel(providerListQuery.data, selectedModel);

    if (resolved && !modelEquals(resolved, selectedModel ?? { providerID: "", modelID: "" })) {
      setSelectedSessionModel(resolved);
      return;
    }

    const wantsWodeApp = !selectedModel?.providerID
      || isWodeAppModelProvider(selectedModel.providerID);
    if (!wantsWodeApp) return;

    // 已尝试过一次 engine reload 仍不可用：停手，避免无限重载导致闪烁。
    if (wodeappModelRecoveryRef.current >= 1 || wodeappModelRecoveryInFlightRef.current) return;
    wodeappModelRecoveryRef.current += 1;
    wodeappModelRecoveryInFlightRef.current = true;
    void (async () => {
      try {
        // 关键：opencode 的 connected 集合来自 auth 凭据库，而不是 config 里的 options.apiKey。
        // 只写 config，provider 会出现在 all（选择器可见）但不在 connected（判定不可用→闪）。
        // 这里和 BYOK 一样，把 WodeApp 的 key 通过 opencode auth.set 注册进去，provider 才会变 connected。
        const creds = await getWodeAppApiCredentials();
        if (creds?.apiKey && opencodeClient) {
          try {
            await opencodeClient.auth.set({
              providerID: WODEAPP_PROVIDER_ID,
              auth: { type: "api", key: creds.apiKey },
            });
          } catch {
            // ignore — 仍会尝试写 config + reload
          }
        }
        await applyWodeAppProvider();
        await reloadWorkspaceEngineFromUi();
      } catch {
        // best-effort — user can restart desktop app
      } finally {
        wodeappModelRecoveryInFlightRef.current = false;
      }
    })();
  }, [
    opencodeClient,
    providerListQuery.data,
    providerListSettling,
    reloadWorkspaceEngineFromUi,
    selectedModel,
    selectedModelUnavailable,
    setSelectedSessionModel,
    shellConfig.wodeappWorkbench,
  ]);

  const openWorkModelsPromo = useOpenWorkModelsStartupPromo({
    clientReady: Boolean(opencodeClient),
    workspaceId: selectedWorkspaceId,
    providerConnectedIds,
  });

  const authorizeFeishuFromWorkbench = useCallback(async () => {
    const openworkClient = selectedWorkspaceEndpoint?.client ?? client;
    const workspaceId = selectedWorkspaceEndpoint?.workspaceId?.trim() || selectedWorkspaceId.trim();
    if (!openworkClient || !workspaceId) {
      toast.error("飞书授权需要先连接工作区");
      return false;
    }

    toast.loading("正在检查飞书授权状态", { id: WODEAPP_FEISHU_AUTH_TOAST_ID });
    try {
      const statusResponse = await openworkClient.callExtensionAction({
        extensionId: WODEAPP_FEISHU_EXTENSION_ID,
        action: "status",
        args: {},
      });
      const status = normalizeFeishuWorkbenchStatus(statusResponse.result);
      if (status.authorized && status.integration === "lark-cli") {
        toast.success(
          status.userName ? `飞书已连接 · ${status.userName}` : "飞书已连接",
          { id: WODEAPP_FEISHU_AUTH_TOAST_ID },
        );
        await refreshRouteState();
        return true;
      }
      if (!status.configured) {
        toast.info("飞书尚未授权，请完成扫码授权", { id: WODEAPP_FEISHU_AUTH_TOAST_ID });
        return false;
      }

      const loginResponse = await openworkClient.callExtensionAction({
        extensionId: WODEAPP_FEISHU_EXTENSION_ID,
        action: "login",
        args: {
          domain: "https://open.feishu.cn",
          tools: "preset.default",
          language: "zh",
          callbackPort: 3000,
        },
      });
      const login = normalizeFeishuWorkbenchLoginResult(loginResponse.result);
      if (login.authorized && login.integration === "lark-cli") {
        toast.success(
          login.userName ? `飞书已连接 · ${login.userName}` : "飞书已连接",
          { id: WODEAPP_FEISHU_AUTH_TOAST_ID },
        );
        await refreshRouteState();
        return true;
      }
      if (!login.authorized || !login.configPath) {
        throw new Error("飞书授权完成，但没有生成 MCP 配置文件。");
      }

      await openworkClient.addMcp(workspaceId, {
        name: WODEAPP_FEISHU_EXTENSION_ID,
        config: {
          type: "local",
          command: ["npx", "-y", "@larksuiteoapi/lark-mcp", "mcp", "--config", login.configPath],
          enabled: true,
          timeout: 300_000,
        },
      });
      toast.success("飞书授权已完成，MCP 已连接", { id: WODEAPP_FEISHU_AUTH_TOAST_ID });
      await refreshRouteState();
      return true;
    } catch (error) {
      const message = describeRouteError(error);
      if (isFeishuWorkbenchCredentialError(message)) {
        toast.info("需要先配置飞书应用凭证", { id: WODEAPP_FEISHU_AUTH_TOAST_ID });
        return false;
      }
      toast.error("飞书授权失败", {
        id: WODEAPP_FEISHU_AUTH_TOAST_ID,
        description: message,
      });
      return true;
    }
  }, [client, refreshRouteState, selectedWorkspaceEndpoint, selectedWorkspaceId]);


  const { store: sessionProviderAuthStore, snapshot: sessionProviderAuthSnapshot } =
    useSessionProviderAuth({
      opencodeClient,
      providers,
      providerDefaults,
      providerConnectedIds,
      disabledProviderIds,
      selectedWorkspace,
      selectedWorkspaceEndpoint,
      selectedWorkspaceRoot,
      selectedWorkspaceId,
      setProviders,
      setProviderDefaults,
      setProviderConnectedIds,
      setDisabledProviderIds,
    });
  // Surface pending permission/question asks from child/subagent sessions on the
  // parent chat. Missing this binding used to throw ReferenceError and white-screen SessionRoute.
  const relatedSessionIdsForPermissions = useMemo(() => {
    const parentId = selectedSessionId?.trim();
    if (!parentId) return [] as string[];
    const related: string[] = [];
    for (const group of workspaceSessionGroups) {
      for (const session of group.sessions ?? []) {
        const id = typeof session?.id === "string" ? session.id.trim() : "";
        const parent =
          typeof (session as { parentID?: unknown })?.parentID === "string"
            ? String((session as { parentID: string }).parentID).trim()
            : "";
        if (id && parent === parentId) related.push(id);
      }
    }
    return related;
  }, [selectedSessionId, workspaceSessionGroups]);

  const {
    activePermission,
    permissionReplyBusy,
    respondPermission,
    activeQuestion,
    questionReplyBusy,
    respondQuestion,
    todos,
  } = useSessionInteractions({
    client: opencodeClient,
    workspaceId: selectedWorkspaceId,
    sessionId: selectedSessionId,
    workspaceRoot: selectedWorkspaceRoot,
    relatedSessionIds: relatedSessionIdsForPermissions,
    openworkClient: selectedWorkspaceEndpoint?.client ?? client,
    openworkWorkspaceId: selectedWorkspaceEndpoint?.workspaceId || selectedWorkspaceId,
  });
  const showPreparingStatus =
    effectiveLoading ||
    (!canCreateTask && !routeError && !selectedWorkspaceError);

  useEffect(() => {
    if (!shellConfig.wodeappWorkbench) return;
    const message = selectedWorkspaceError?.trim();
    if (!message) return;
    const timer = window.setTimeout(() => {
      reportDesktopDiagnostic({
        kind: "opencode_unavailable",
        message,
        sessionId: selectedSessionId,
        workspaceId: selectedWorkspaceId,
      });
    }, 30_000);
    return () => window.clearTimeout(timer);
  }, [
    selectedSessionId,
    selectedWorkspaceError,
    selectedWorkspaceId,
    shellConfig.wodeappWorkbench,
  ]);

  useEffect(() => {
    if (!opencodeClient) {
      setProviders([]);
      setProviderDefaults({});
      setProviderConnectedIds([]);
      return;
    }

    let cancelled = false;

    const applyProviderState = (value: ProviderListResponse) => {
      if (cancelled) return;
      // When not signed in, filter out cloud-managed providers (lpr_*)
      // so stale entries from a previous session don't appear.
      const hasCloudAuth = !!readDenSettings().authToken?.trim();
      const isCloudProvider = (id: string) => /^lpr_/i.test(id);
      const all = hasCloudAuth
        ? ((value.all ?? []) as ProviderListItem[])
        : ((value.all ?? []) as ProviderListItem[]).filter(
            (p) => !isCloudProvider(p.id ?? ""),
          );
      const connected = hasCloudAuth
        ? (value.connected ?? [])
        : (value.connected ?? []).filter((id) => !isCloudProvider(id));
      setProviders(all);
      setProviderConnectedIds(connected);
      // New-provider detection is handled globally by the provider auth
      // store's applyProviderListState, which fires dispatchNewProviders.
    };

    void (async () => {
      let disabledProviders: string[] = [];
      try {
        const config = unwrap(
          await opencodeClient.config.get({
            directory: selectedWorkspaceRoot || undefined,
          }),
        ) as { disabled_providers?: string[] };
        disabledProviders = Array.isArray(config.disabled_providers)
          ? config.disabled_providers
          : [];
        if (!cancelled) setDisabledProviderIds(disabledProviders);
      } catch {
        // ignore config read failures and continue with provider discovery
      }

      try {
        applyProviderState(
          filterProviderList(
            await ensureProviderListQuery(getReactQueryClient(), {
              client: opencodeClient,
              baseUrl: opencodeBaseUrl,
              directory: selectedWorkspaceRoot || undefined,
            }),
            disabledProviders,
          ),
        );
      } catch {
        if (cancelled) return;
        setProviders([]);
        setProviderDefaults({});
        setProviderConnectedIds([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [opencodeBaseUrl, opencodeClient, selectedWorkspaceRoot, denSessionVersion, engineReloadVersion, openworkServerSettingsVersion]);

  const modelLabel = selectedModel
    ? resolveModelDisplayName(selectedModel.modelID)
    : t("session.default_model");

  const listSlashCommands = useCallback(async (): Promise<SlashCommandOption[]> => {
    // engineReloadVersion is included so the callback identity changes after
    // an engine reload, which invalidates the composer's command list cache
    // and causes it to re-fetch (picking up newly created skills).
    void engineReloadVersion;
    if (!opencodeClient) return [];
    const commands = await listCommands(opencodeClient, selectedWorkspaceRoot || undefined);
    return preferLocalizedSlashCommands(commands, currentLocale());
  }, [engineReloadVersion, opencodeClient, selectedWorkspaceRoot]);

  // Shared by the composer (plug menu, @ mentions) and the command palette.
  // Hidden and subagent-only entries are excluded — those are task-tool
  // delegation targets, not agents the user can run a session as.
  const listAgents = useCallback(async () => {
    // Include engineReloadVersion so the composer refetches after newly added
    // agent files become available, even when the inline picker is hidden.
    void engineReloadVersion;
    const runtimeAgents: Agent[] = shellConfig.wodeappWorkbench
      ? listWodeAppRuntimeProfiles().map((profile) => ({
          name: profile.id,
          description: `${profile.name} · 按会话加载品牌知识与已授权工具`,
          mode: "primary",
          native: true,
          permission: [],
          options: { wodeAppRuntimeProfile: true },
        }))
      : [];
    if (!opencodeClient) return runtimeAgents;
    const list = unwrap(await opencodeClient.app.agents());
    const runtimeAgentIds = new Set(runtimeAgents.map((agent) => agent.name));
    return [
      ...runtimeAgents,
      ...list.filter((agent) =>
        !agent.hidden
        && agent.mode !== "subagent"
        && !runtimeAgentIds.has(agent.name)
      ),
    ];
  }, [engineReloadVersion, opencodeClient, shellConfig.wodeappWorkbench]);

  const handleOpenSettings = useCallback((route = "/settings/service", workspaceId = sidebarActiveWorkspaceId) => {
    const sessionId = workspaceId === sidebarActiveWorkspaceId ? selectedSessionId : null;
    const tab = route.replace(/^\/settings\/?/, "").replace(/^\/+|\/+$/g, "") || "service";
    const target = workspaceId ? workspaceSettingsRoute(workspaceId, tab) : route;
    writeActiveWorkspaceId(workspaceId || null);
    navigate(target, { state: { workspaceId, sessionId } });
  }, [navigate, selectedSessionId, sidebarActiveWorkspaceId]);

  const surfaceProps = useMemo(() => {
    if (!client || !selectedWorkspaceId || !selectedSessionId || !opencodeBaseUrl || !token || !opencodeClient) {
      return null;
    }

    // Transient-safety: when the user switches workspaces the URL-driven
    // selectedSessionId may still point at a session from the old workspace
    // for one render tick. Only block rendering when we KNOW the session
    // belongs to a different workspace (i.e., it exists in another
    // workspace's list). A brand-new session that hasn't been refreshed
    // into any list yet must still render so "New task" feels instant.
    let sessionOwnedByOtherWorkspace = false;
    for (const [workspaceId, sessions] of Object.entries(sessionsByWorkspaceId)) {
      if (workspaceId === selectedWorkspaceId) continue;
      if ((sessions ?? []).some((session) => session?.id === selectedSessionId)) {
        sessionOwnedByOtherWorkspace = true;
        break;
      }
    }
    if (sessionOwnedByOtherWorkspace) {
      return null;
    }

    // Note: do NOT include `client`, `workspaceId`, `sessionId`,
    // `opencodeBaseUrl`, or `openworkToken` here. SessionPage forwards those
    // explicitly to SessionSurface from the per-workspace endpoint resolved
    // by `resolveWorkspaceEndpoint`. If we leak them in here, the spread of
    // `surfaceProps` in SessionPage overrides those correct values with the
    // local server's, and remote workspaces silently end up calling the
    // local server with the local `rem_*` id.
    return {
      workspaceRoot: selectedWorkspaceRoot,
      developerMode: false,
      modelLabel,
      onModelClick: () => {
        modelPicker.setQuery("");
        modelPicker.setOpen(true);
      },
      modelPickerOpen: modelPicker.compactOpen,
      modelUnavailable: effectiveModelUnavailable,
      selectedModel: selectedModel ?? { providerID: "", modelID: "" },
      onModelPickerOpenChange: modelPicker.setCompactOpen,
      onModelChange: (model: ModelRef) => {
        const nextModel = shellConfig.wodeappWorkbench
          ? normalizeWodeAppModelRefForWorkbench(model, {
              connectedProviderIds: providerConnectedIds,
            })
          : model;
        rememberSelectedModel(nextModel);
        modelPicker.setCompactOpen(false);
      },
      providerConnectedCount: hasUsableModel ? 1 : providerConnectedIds.length,
      onOpenSettingsSection: (section: "commands" | "skills" | "mcps" | "plugins" | "providers") => {
        handleOpenSettings(section === "skills" ? "/settings/skills" : section === "mcps" ? "/settings/extensions/mcp" : section === "plugins" ? "/settings/extensions/plugins" : "/settings/service");
      },
      onSendDraft: async (
        draft: ComposerDraft,
        sessionId: string,
        onAttachmentProgress?: (message: string | null) => void,
      ) => {
        const targetSessionId = sessionId.trim() || selectedSessionId;
        if (!targetSessionId) return;
        const text = (draft.resolvedText ?? draft.text).trim();
        if (!text && draft.attachments.length === 0) return;
        if (effectiveModelUnavailable) throw new Error("Selected model is unavailable. Choose another model before sending.");

        let localCredits: number | null = null;
        let sendMode: "cloud" | "local-byok" = "cloud";
        let localServiceMode = false;
        const connectedModels = getConnectedProviderItems(providerListQuery.data).map((item) => ({
          id: item.id,
          models: Object.keys(item.models ?? {}),
        }));
        let promptModel = shellConfig.wodeappWorkbench
          ? resolveConnectedWodeAppPromptModel(
              selectedModel,
              providerListQuery.data,
            )
          : selectedModel ?? undefined;
        if (shellConfig.wodeappWorkbench && isWodeAppAuthAvailable()) {
          const ready = await ensureWodeAppSendReady({
            selectedModel: promptModel ?? selectedModel,
            connectedProviderIds: providerConnectedIds,
            connectedModels,
          });
          sendMode = ready.mode;
          localCredits = ready.credits;
          localServiceMode = ready.localServiceMode;
          // OpenCode 1.17+ reads credentials from auth.json, not config options.apiKey.
          // Only inject the platform key on the cloud lane.
          if (ready.mode === "cloud") {
            const creds = await getWodeAppApiCredentials();
            if (creds?.apiKey && opencodeClient?.auth?.set) {
              try {
                await opencodeClient.auth.set({
                  providerID: WODEAPP_PROVIDER_ID,
                  auth: { type: "api", key: creds.apiKey },
                });
              } catch {
                // best-effort — send still proceeds; server will 401 if auth never lands
              }
            }
          }
        }

        // New sessions start with a timestamp title and the recent-conversation
        // list intentionally hides those empty placeholders. Promote the first
        // user message to the session title before sending so the conversation
        // appears in the sidebar immediately, without waiting for a later sync.
        const currentSession = sessionsByWorkspaceId[selectedWorkspaceId]?.find(
          (session) => session.id === targetSessionId,
        );
        const currentTitle = currentSession?.title?.trim() ?? "";
        const silentAutoContinue = isStuckToolAutoContinueText(draft.text)
          || isStuckToolAutoContinueText(text);
        const nextTitle = silentAutoContinue
          ? ""
          : makeSessionTitleFromText(draft.text.trim() || text);
        if (nextTitle && (!currentTitle || isGeneratedSessionTitle(currentTitle))) {
          setSessionsByWorkspaceId((current) => {
            const next = {
              ...current,
              [selectedWorkspaceId]: (current[selectedWorkspaceId] ?? []).map((session) =>
                session.id === targetSessionId ? { ...session, title: nextTitle } : session,
              ),
            };
            sessionsByWorkspaceIdRef.current = next;
            return next;
          });
          await opencodeClient.session.update({
            sessionID: targetSessionId,
            title: nextTitle,
            directory: selectedWorkspaceRoot || undefined,
          }).catch((error) => {
            console.warn("[session-title] failed to persist first-message title", error);
          });
        }

        captureAnalyticsEvent("task_message_sent", {
          mode: draft.mode ?? "prompt",
          is_command: Boolean(draft.command),
          attachment_count: draft.attachments.length,
          text_length: text.length,
          workspace_type: selectedWorkspace?.workspaceType ?? "unknown",
          provider_id: selectedModel?.providerID ?? null,
          model_id: selectedModel?.modelID ?? null,
        });
        markTaskRunStart(targetSessionId);
        // Den org adoption signals (auth-gated inside; no-op when signed out).
        // Lives here — the live send choke point — because its previous call
        // site was in the orphaned actions-store and never fired.
        trackSessionActive(targetSessionId);
        trackTaskStarted(targetSessionId);

        if (draft.mode === "shell") {
          await shellInSession(opencodeClient, targetSessionId, text);
          return;
        }

        if (draft.command) {
          const result = await opencodeClient.session.command({
            sessionID: targetSessionId,
            command: draft.command.name,
            arguments: draft.command.arguments,
          });
          if (result.error) {
            throw new Error(serializeSDKError(result.error));
          }
          return;
        }

        // Kimi Code k3-256k rejects video; auto-upgrade this turn (+ session picker) to k3.
        // Prefer an id that actually exists in the connected provider catalog.
        const availableWodeModelIds = (() => {
          const providers = providerListQuery.data?.all ?? [];
          const wode = providers.find((item) => item.id === WODEAPP_PROVIDER_ID)
            ?? providers.find((item) => item.id === "wode");
          return Object.keys(wode?.models ?? {});
        })();
        const kimiVideoAdapt = shellConfig.wodeappWorkbench
          ? adaptKimiCodeModelForVideoInput(promptModel ?? null, draft, {
              availableModelIds: availableWodeModelIds,
            })
          : null;
        if (kimiVideoAdapt?.upgraded) {
          promptModel = resolveConnectedWodeAppPromptModel(
            kimiVideoAdapt.model,
            providerListQuery.data,
          );
          // Do not mutate the session picker yet — if promptAsync fails
          // (e.g. ProviderModelNotFound) the UI would stay stuck on a bad id.
          console.info("[WodeAppModelAdapt]", {
            sessionId: targetSessionId,
            from: kimiVideoAdapt.fromModelID,
            to: promptModel.modelID,
            reason: kimiVideoAdapt.reason,
            persistPicker: false,
          });
        } else if (
          shellConfig.wodeappWorkbench
          && promptModel
          && selectedModel
          && !modelEquals(promptModel, selectedModel)
        ) {
          console.info("[WodeAppModelAdapt]", {
            sessionId: targetSessionId,
            from: selectedModel.modelID,
            to: promptModel.modelID,
            reason: "map_branded_id_to_connected_provider_model",
          });
        }
        const mediaInput = resolveModelMediaInputCapabilities(promptModel ?? null, providerListQuery.data);
        const modelSupportsVision = mediaInput.image || modelSupportsVisionInput(promptModel ?? null, providerListQuery.data);
        const useAttachmentIntelligence = shouldUseAttachmentIntelligence({
          enabled: shellConfig.wodeappWorkbench,
          draft,
          modelSupportsVision,
          mediaInput,
        });
        const preserveAttachmentsAsDisplayOnly = shouldPreserveAttachmentsAsDisplayOnly({
          enabled: shellConfig.wodeappWorkbench,
          draft,
          modelSupportsVision,
          mediaInput,
        });
        const rawAttachmentPlan = shouldIncludeRawAttachmentsInPrompt({
          modelSupportsVision,
          useAttachmentIntelligence,
          preserveAttachmentsAsDisplayOnly,
          draft,
          mediaInput,
        });
        const inlinePlainTextAttachments = draftHasOnlyInlinePlainTextAttachments(draft);
        // Codex-aligned: materialize chat attachments to durable local paths BEFORE routing,
        // so PDF/txt/office can use openwork_pdf_* / file tools even when File.path is missing.
        let attachmentMaterialize: Awaited<ReturnType<typeof materializeComposerAttachmentsForSend>> | null = null;
        if (draft.attachments.length > 0) {
          try {
            attachmentMaterialize = await materializeComposerAttachmentsForSend({
              sessionId: targetSessionId,
              attachments: draft.attachments,
            });
            if (
              attachmentMaterialize.pathByAttachmentId.size
              || attachmentMaterialize.pathByFilename.size
            ) {
              stampComposerAttachmentLocalPaths(
                draft.attachments,
                attachmentMaterialize.pathByFilename,
                attachmentMaterialize.pathByAttachmentId,
              );
            }
          } catch (error) {
            console.warn("[WodeAppX] composer attachment materialize at send failed", error);
          }
        }
        let attachmentIntelligence: Awaited<ReturnType<typeof understandDraftAttachments>> | null = null;
        try {
          attachmentIntelligence = useAttachmentIntelligence
            ? await understandDraftAttachments(draft, modelSupportsVision, {
                sessionId: targetSessionId,
                onProgress: (message) => {
                  if (!inlinePlainTextAttachments) {
                    onAttachmentProgress?.(message);
                  }
                },
              })
            : null;
        } finally {
          onAttachmentProgress?.(null);
        }
        if (useAttachmentIntelligence && !attachmentIntelligence?.combinedContext) {
          throw new Error(
            "附件未能解析出可用内容。纯文本请确认文件非空；PDF/图片请登录 WodeApp 或切换到支持识图的模型后重试。",
          );
        }
        const visionMaterialize = attachmentMaterialize;
        const parts = await draftToParts(draft, selectedWorkspaceRoot, {
          // 只有体积受控的纯图片直送视觉模型；文档/视频走本地工具或附件理解。
          includeRawAttachments: rawAttachmentPlan.includeRawAttachments,
          rawAttachmentsImagesOnly: rawAttachmentPlan.imagesOnly,
          // @ 引用：生图只带 URL；看图且可直送时打 file part；远程解析已吸收时不再重复。
          includeAssetMentionFiles: shouldIncludeAssetMentionFilesInPrompt({
            draft,
            modelSupportsVision,
            useAttachmentIntelligence,
            mediaInput,
          }),
        });
        const visionDirectEphemeral = rawAttachmentPlan.includeRawAttachments
          && rawAttachmentPlan.imagesOnly
          && draft.attachments.some(isComposerImageAttachment);
        const visionLocalPaths = visionDirectEphemeral
          ? [
              ...(visionMaterialize?.localPaths || []),
              ...draft.attachments
                .filter(isComposerImageAttachment)
                .map((attachment) => desktopLocalFilePath(attachment.file))
                .filter((value): value is string => Boolean(value)),
            ].filter((path, index, all) => all.indexOf(path) === index)
          : [];
        if (attachmentIntelligence?.combinedContext || visionDirectEphemeral) {
          recordWodeAppContextHygieneEvent({
            sessionId: targetSessionId,
            event: "prompt_context_prepared",
            details: {
              contextStored: Boolean(visionMaterialize?.contextRefId),
              contextChars: attachmentIntelligence?.combinedContext.length ?? 0,
              visionFiles: visionDirectEphemeral ? draft.attachments.filter(isComposerImageAttachment).length : 0,
              localPaths: visionLocalPaths.length,
              durableUrls: visionMaterialize?.durableProductImageUrls.length ?? 0,
            },
          });
        }
        if (visionDirectEphemeral) {
          parts.unshift(buildVisionEphemeralFollowupPart(draft.attachments, {
            localPaths: visionLocalPaths,
            contextRefId: visionMaterialize?.contextRefId,
            durableProductImageUrls: visionMaterialize?.durableProductImageUrls,
            imageCandidates: visionMaterialize?.imageCandidates,
          }));
        }
        if (attachmentIntelligence?.combinedContext) {
          if (attachmentIntelligence.uploadedUrls?.length) {
            rememberSessionProductImageUploads({
              sessionId: targetSessionId,
              uploads: attachmentIntelligence.uploadedUrls,
            });
          }
          parts.unshift(
            buildAttachmentIntelligencePart(
              attachmentIntelligence.combinedContext,
              attachmentIntelligence.sources,
              attachmentIntelligence.uploadedUrls,
              {
                contextPackId: attachmentIntelligence.contextPackId,
                contextRefId: attachmentIntelligence.contextRefId || visionMaterialize?.contextRefId,
                imageCandidates: visionMaterialize?.imageCandidates,
              },
            ),
          );
        }
        // Always keep openable chat cards with durable file:// / https display URLs.
        // Vision-direct turns still embed raw pixels for the model; after PERF-05 slim
        // those raw parts lose their data: URL — display placeholders are the Cursor/Codex
        // chip source of truth.
        if (draft.attachments.length > 0) {
          const durableDisplayUrls = (visionMaterialize?.displayUrls || []).map((item) => ({
            filename: item.filename,
            url: item.url,
            kind: "image" as const,
          }));
          parts.push(
            ...buildAttachmentDisplayParts(
              draft.attachments,
              [
                ...(attachmentIntelligence?.uploadedUrls || []),
                ...durableDisplayUrls,
              ],
            ),
          );
        }
        const envSystemContext = await buildOpenworkEnvSystemContext(client, {
          cacheKey: targetSessionId,
          runtimeKey: environmentRuntimeKey,
        });
        const runtimeProfile = readWodeAppRuntimeProfileForSession(
          selectedWorkspaceId,
          targetSessionId,
        );
        const runtimeProfileSystemContext = buildWodeAppRuntimeProfileSystemContext(runtimeProfile);
        // Shell is not a second agent. Tool surface, AGENTS.md, and workspace
        // identity are assembled once inside OpenCode.
        const promptSystemContext = [
          runtimeProfileSystemContext,
          envSystemContext,
          draft.systemContext,
        ]
          .filter((value): value is string => Boolean(value))
          .join("\n\n");
        // Heal leftover file:// type:file before replay — idle scrub can race.
        await scrubUnsafeModelMediaBeforePrompt({
          client: opencodeClient,
          sessionId: targetSessionId,
          directory: selectedWorkspaceRoot || undefined,
        });
        const result = await opencodeClient.session.promptAsync({
          sessionID: targetSessionId,
          parts,
          model: promptModel,
          agent: wodeAppRuntimeProfileAgentId(runtimeProfile) ?? selectedAgent ?? undefined,
          ...(modelVariantValue ? { variant: modelVariantValue } : {}),
          // Tool visibility is resolved inside the patched OpenCode loop.
          // Passing the capability map here would persist its `false` entries
          // as session permissions and block tools loaded by tool_search.
          ...(promptSystemContext ? { system: promptSystemContext } : {}),
        });
        if (result.error) {
          const raw = serializeSDKError(result.error);
          if (shellConfig.wodeappWorkbench) {
            const classified = classifyWodeAppCreditGatedError(raw, localCredits, {
              localByokActive: sendMode === "local-byok",
              localServiceMode,
              unsigned: sendMode !== "local-byok" && localCredits == null,
            });
            if (classified) {
              throw new WodeAppSendBlockedError(classified.reason, classified.message);
            }
          }
          throw new Error(raw);
        }
        if (kimiVideoAdapt?.upgraded && promptModel) {
          setSelectedSessionModel(promptModel);
        }
        // Always strip tool-embedded screenshot/image pixels after idle.
        // Always try to stub lingering attachment-intelligence parts (not only
        // when this turn produced a new one) so multi-turn video prep stays lean.
        const canCompactAttachmentIntelligence = Boolean(
          !attachmentIntelligence?.combinedContext
          || attachmentContextCanBeDehydrated(attachmentIntelligence.combinedContext),
        );
        scheduleSessionHistoryCompaction({
          client: opencodeClient,
          sessionId: targetSessionId,
          directory: selectedWorkspaceRoot || undefined,
          // Always pass durable file:// display URLs for image attachments so
          // idle scrub keeps real thumbnails (not a bare image.png placeholder
          // that opens ~/Downloads/image.png by basename).
          visionFilenames: draft.attachments
            .filter(isComposerImageAttachment)
            .map((attachment) => attachment.name),
          visionDisplayUrls: visionMaterialize?.displayUrls || [],
          compactAttachmentIntelligence: canCompactAttachmentIntelligence,
          compactToolMedia: true,
          compactWebTools: true,
        });
      },
      onDraftChange: () => {
        // Draft persistence will be wired once the full React shell owns session state.
      },
      attachmentsEnabled: true,
      attachmentsDisabledReason: null,
      modelVariantLabel,
      modelVariant: modelVariantValue,
      modelBehaviorOptions,
      onModelVariantChange: (value: string | null) => {
        setSelectedSessionVariant(value);
      },
      agentLabel: selectedRuntimeProfile?.name
        ?? (selectedAgent ? formatAgentDisplayName(selectedAgent) : t("session.default_agent")),
      selectedAgent: selectedRuntimeProfile?.id ?? selectedAgent,
      listAgents,
      onSelectAgent: handleSelectSessionAgent,
      listCommands: listSlashCommands,
      recentFiles: [],
      searchFiles: async (query: string) => {
        const trimmed = query.trim();
        if (!trimmed) return [];
        const result = unwrap(
          await opencodeClient.find.files({
            query: trimmed,
            dirs: "true",
            limit: 50,
            directory: selectedWorkspaceRoot || undefined,
          }),
        );
        return result;
      },
      isRemoteWorkspace: selectedWorkspace?.workspaceType === "remote",
      isSandboxWorkspace: selectedWorkspace ? isSandboxWorkspace(selectedWorkspace) : false,
      onRevertToMessage: async (messageId: string, sessionId: string) => {
        const targetSessionId = sessionId.trim() || selectedSessionId;
        if (!targetSessionId) return false;
        try {
          // Abort any running generation first; OpenCode rejects revert on busy sessions.
          await abortSessionSafe(opencodeClient, targetSessionId, selectedWorkspaceRoot || undefined);
          const reverted = await revertSession(opencodeClient, targetSessionId, messageId);
          // Stamp the revert cursor into the local caches so the transcript
          // rewinds immediately instead of waiting for a full reload.
          applySessionRevert(selectedWorkspaceId, reverted);
          return true;
        } catch (error) {
          console.warn("[revert] failed", error);
          toast.error(t("session.revert_failed"));
          return false;
        }
      },
      onForkAtMessage: (messageId: string | null, sessionId: string) => {
        void (async () => {
          const targetSessionId = sessionId.trim() || selectedSessionId;
          if (!targetSessionId) return;
          try {
            const forked = await forkSession(opencodeClient, targetSessionId, messageId ?? undefined);
            if (selectedRuntimeProfile) {
              bindWodeAppRuntimeProfileToSession(
                selectedWorkspaceId,
                forked.id,
                selectedRuntimeProfile.id,
              );
            }
            if (selectedModel) {
              updateSessionChoice(forked.id, () => ({
                model: selectedModel,
                variant: selectedModelVariant,
              }));
            }
            writeLastSessionFor(selectedWorkspaceId, forked.id);
            rememberPendingCreatedSession(selectedWorkspaceId, forked.id);
            setSessionsByWorkspaceId((current) => ({
              ...current,
              [selectedWorkspaceId]: [forked, ...(current[selectedWorkspaceId] ?? [])],
            }));
            navigateToWorkspaceSession(selectedWorkspaceId, forked.id);
            void refreshRouteState();
          } catch (error) {
            console.warn("[fork] failed", error);
            toast.error(t("session.branch_failed"));
          }
        })();
      },
      onChangeModel: (model: { providerID: string; modelID: string }) => {
        const nextModel = shellConfig.wodeappWorkbench
          ? normalizeWodeAppModelRefForWorkbench(model, {
              connectedProviderIds: providerConnectedIds,
            })
          : model;
        rememberSelectedModel(nextModel);
      },
      environmentRuntimeKey,
      onApplyEnvironmentChanges: isDesktopRuntime() && selectedWorkspace?.workspaceType !== "remote"
        ? handleApplyEnvironmentChanges
        : undefined,
    };
  }, [
    client,
    modelPicker.compactOpen,
    handleOpenSettings,
    handleSelectSessionAgent,
    hasUsableModel,
    handleApplyEnvironmentChanges,
    environmentRuntimeKey,
    listAgents,
    listSlashCommands,
    modelBehaviorOptions,
    modelLabel,
    modelVariantLabel,
    modelVariantValue,
    navigate,
    opencodeBaseUrl,
    opencodeClient,
    providerConnectedIds,
    selectedAgent,
    selectedRuntimeProfile,
    selectedModel,
    selectedModelVariant,
    selectedSessionId,
    selectedModelUnavailable,
    effectiveModelUnavailable,
    selectedWorkspace,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
    rememberSelectedModel,
    setSelectedSessionModel,
    setSelectedSessionVariant,
    sessionsByWorkspaceId,
    shellConfig.wodeappWorkbench,
    token,
    updateSessionChoice,
  ]);

  const guardMultipleWorkspacesAllowed = useCallback(() => {
    // Respect the org-level `allowMultipleWorkspaces` restriction (dev
    // #1505). If the checker returns true, the admin has disabled
    // adding further workspaces; surface a friendly notice instead of
    // opening the modal.
    if (
      workspaces.length > 0 &&
      checkDesktopRestriction({ restriction: "allowMultipleWorkspaces" })
    ) {
      restrictionNotice.show({
        title: "Additional workspaces are restricted",
        message:
          "Your organization administrator has restricted access to adding additional workspaces.",
      });
      return false;
    }
    return true;
  }, [checkDesktopRestriction, restrictionNotice, workspaces.length]);

  const handleOpenCreateWorkspace = useCallback(() => {
    if (!guardMultipleWorkspacesAllowed()) return;
    setCreateWorkspaceRemoteError(null);
    setCreateWorkspaceOpen(true);
  }, [guardMultipleWorkspacesAllowed]);

  const resolveBlankProjectFolder = useCallback(async (): Promise<string | null> => {
    const name = blankProjectName();
    const fromKnown = resolveBlankProjectFolderPath(
      workspaces.map((workspace) => String(workspace.path ?? "")),
      name,
    );
    if (fromKnown) return fromKnown;
    try {
      const home = await getDesktopHomeDir();
      if (!home?.trim()) return null;
      return await joinDesktopPath(home.trim(), "Documents", "WodeAppX", name);
    } catch {
      return null;
    }
  }, [workspaces]);

  const handleOpenRenameWorkspace = useCallback((workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace) return;
    setRenameWorkspaceId(workspaceId);
    setRenameWorkspaceTitle(
      workspace.displayName?.trim() ||
        workspace.name?.trim() ||
        workspace.path?.trim() ||
        "",
    );
  }, [workspaces]);

  const handleSaveRenameWorkspace = useCallback(async () => {
    if (!renameWorkspaceId) return;
    const trimmed = renameWorkspaceTitle.trim();
    if (!trimmed) return;
    setRenameWorkspaceBusy(true);
    try {
      if (!client) {
        toast.error("OpenWork server is unavailable. Reconnect the server before renaming workspaces.");
        return;
      }
      await client.updateWorkspaceDisplayName(renameWorkspaceId, trimmed);
      setRenameWorkspaceId(null);
      setRenameWorkspaceTitle("");
      await refreshRouteState();
    } catch (error) {
      toast.error("Workspace rename failed", {
        description: describeRouteError(error),
      });
    } finally {
      setRenameWorkspaceBusy(false);
    }
  }, [client, refreshRouteState, renameWorkspaceId, renameWorkspaceTitle]);

  const handleRevealWorkspace = useCallback(async (workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    const path = workspace?.path?.trim();
    if (!path || !isDesktopRuntime()) return;
    try {
      await revealDesktopItemInDir(path);
    } catch {
      // ignore
    }
  }, [workspaces]);

  const handleShareWorkspace = useCallback((workspaceId: string) => {
    shareWorkspaceState.openShareWorkspace(workspaceId);
  }, [shareWorkspaceState]);

  useEffect(() => {
    if (!WODEAPP_MOBILE_REMOTE_ENABLED) return;
    const openMobileRemote = () => {
      const workspaceId = selectedWorkspaceId.trim();
      if (!workspaceId) {
        toast.warning("请先选择一个工作区");
        return;
      }
      shareWorkspaceState.openMobileShareWorkspace(workspaceId);
    };
    window.addEventListener("wodeapp:open-mobile-remote", openMobileRemote);
    return () => window.removeEventListener("wodeapp:open-mobile-remote", openMobileRemote);
  }, [selectedWorkspaceId, shareWorkspaceState.openMobileShareWorkspace]);

  const handleSaveShareRemoteAccess = useCallback(
    async (enabled: boolean) => {
      if (!isDesktopRuntime()) return;
      await remoteAccessRestart.save(enabled);
    },
    [remoteAccessRestart],
  );

  const handleExportWorkspaceConfig = useCallback(
    async (workspaceId: string) => {
      const workspace = workspaces.find((item) => item.id === workspaceId) ?? null;
      if (!workspace) return;
      const endpoint = endpointForWorkspace(workspace);
      if (endpoint) {
        const payload = await endpoint.client.exportWorkspace(endpoint.workspaceId);
        downloadWorkspaceJson(workspaceExportFilename(workspace), payload);
        return;
      }
      throw new Error("OpenWork server is unavailable. Reconnect the server before exporting workspace config.");
    },
    [endpointForWorkspace, workspaces],
  );

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      const id = sessionId.trim();
      if (!id) return;
      const ownerWorkspace =
        workspaces.find((workspace) =>
          (sessionsByWorkspaceId[workspace.id] ?? []).some((session) => session?.id === id),
        ) ?? selectedWorkspace;
      if (!ownerWorkspace) {
        toast.error("找不到该会话所属工作区");
        throw new Error("session workspace not found");
      }
      const endpoint = endpointForWorkspace(ownerWorkspace);
      if (!endpoint) {
        toast.error("工作区未连接，无法删除会话");
        throw new Error("workspace endpoint unavailable");
      }
      try {
        await endpoint.client.deleteSession(endpoint.workspaceId, id);
      } catch (error) {
        toast.error("删除会话失败", {
          description: error instanceof Error ? error.message : String(error || "unknown"),
        });
        throw error;
      }
      await deleteAttachmentContextForSession(id);
      if (selectedSessionId === id) {
        navigateToWorkspaceSession(ownerWorkspace.id);
      }
      await refreshRouteState();
    },
    [
      endpointForWorkspace,
      navigateToWorkspaceSession,
      refreshRouteState,
      selectedSessionId,
      selectedWorkspace,
      sessionsByWorkspaceId,
      workspaces,
    ],
  );

  const handleForgetWorkspace = useCallback(
    async (workspaceId: string) => {
      if (typeof window !== "undefined") {
        const message = shellConfig.wodeappWorkbench
          ? "从列表中移除此项目？本地文件夹不会被删除。"
          : (t("workspace_list.remove_confirm") ||
            "Remove this workspace from the sidebar?");
        if (!window.confirm(message)) return;
      }
      // Desktop mount list is authoritative. Forget it first and fail loudly —
      // silent catch + server-first delete used to leave the row on disk, then
      // refreshRouteState / merge resurrected it (e.g. 苏泊尔经营台).
      if (isDesktopRuntime()) {
        try {
          await workspaceForget(workspaceId);
        } catch (error) {
          toast.error("移除项目失败", { description: describeRouteError(error) });
          return;
        }
      }
      setWorkspaces((current) => current.filter((workspace) => workspace.id !== workspaceId));
      if (client) {
        await client.deleteWorkspace(workspaceId).catch((error) => {
          console.warn("[session-route] server deleteWorkspace failed (non-fatal)", error);
        });
      }
      if (selectedWorkspaceId === workspaceId) {
        setLegacySelectedWorkspaceId("");
        writeActiveWorkspaceId(null);
        navigate(legacySessionRoute());
      }
      forgetWorkspaceMemory(workspaceId);
      sessionManagementStore.getState().forgetWorkspace(workspaceId);
      await refreshRouteState();
    },
    [client, navigate, refreshRouteState, selectedWorkspaceId, setWorkspaces, shellConfig.wodeappWorkbench],
  );


  const handleCreateTaskInWorkspace = useCallback(async (
    workspaceId: string,
    options?: { runtimeProfileId?: string },
  ): Promise<string | null> => {
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (
      !workspace ||
      retryingWorkspaceIds.includes(workspaceId)
    ) {
      return null;
    }
    const endpoint = resolveWorkspaceEndpoint(workspace, { baseUrl, token });
    if (!endpoint || !endpoint.token) {
      return null;
    }
    const workspaceClient = createClient(
      endpoint.opencodeBaseUrl,
      workspace.path?.trim() || undefined,
      { token: endpoint.token, mode: "openwork" },
    );
    try {
      setErrorsByWorkspaceId((current) => ({ ...current, [workspaceId]: null }));
      setRouteError(null);
      const session = unwrap(
        await workspaceClient.session.create({ directory: workspace.path?.trim() || undefined }),
      );
      if (options?.runtimeProfileId) {
        bindWodeAppRuntimeProfileToSession(
          workspaceId,
          session.id,
          options.runtimeProfileId,
        );
      }
      captureAnalyticsEvent("task_created", {
        source: "new_task",
        workspace_type: workspace.workspaceType ?? "unknown",
      });
      toast.dismiss(taskCreateUnavailableToastId(workspaceId));
      toast.dismiss();
      setLegacySelectedWorkspaceId(workspaceId);
      writeActiveWorkspaceId(workspaceId || null);
      writeLastSessionFor(workspaceId, session.id);
      rememberPendingCreatedSession(workspaceId, session.id);
      setSessionsByWorkspaceId((current) => {
        const next = {
          ...current,
          [workspaceId]: [session, ...(current[workspaceId] ?? [])],
        };
        sessionsByWorkspaceIdRef.current = next;
        return next;
      });
      navigateToWorkspaceSession(workspaceId, session.id);
      focusPromptSoon();
      return session.id;
    } catch (error) {
      const message = describeTaskCreateError(error);
      setRouteError(message);
      setErrorsByWorkspaceId((current) => ({ ...current, [workspaceId]: message }));
      if (shellConfig.wodeappWorkbench) {
        reportDesktopDiagnostic({
          kind: isTransientStartupError(message) ? "runtime_stuck" : "session_create_failed",
          message,
          workspaceId,
          context: {
            transient: isTransientStartupError(message),
            workspaceType: workspace.workspaceType ?? "unknown",
          },
        });
      }
      toast.error("OpenCode unavailable", {
        id: taskCreateUnavailableToastId(workspaceId),
        description: message,
        action: {
          label: "Retry",
          onClick: () => void handleCreateTaskInWorkspace(workspaceId, options),
        },
        duration: Infinity,
      });
      if (isTransientStartupError(message)) {
        setRetryingWorkspaceIds((current) => Array.from(new Set([...current, workspaceId])));
        if (startupRetryTimerRef.current === null) {
          startupRetryTimerRef.current = window.setTimeout(() => {
            startupRetryTimerRef.current = null;
            refreshInFlightRef.current = false;
            void refreshRouteState();
          }, 1_000);
        }
      }
      return null;
    }
  }, [baseUrl, loading, navigateToWorkspaceSession, rememberPendingCreatedSession, retryingWorkspaceIds, shellConfig.wodeappWorkbench, token, workspaces]);

  const handleCreateTaskWithPrompt = useCallback(async (workspaceId: string, prompt: string | WodeAppTaskPromptInput): Promise<string | null> => {
    const taskPrompt = normalizeWodeAppTaskPromptInput(prompt);
    if (!taskPrompt.displayText) return null;
    const workspace = workspaces.find((item) => item.id === workspaceId);
    if (!workspace) return null;
    const endpoint = resolveWorkspaceEndpoint(workspace, { baseUrl, token });
    if (!endpoint?.token) return null;
    const workspaceClient = createClient(
      endpoint.opencodeBaseUrl,
      workspace.path?.trim() || undefined,
      { token: endpoint.token, mode: "openwork" },
    );
    try {
      const session = unwrap(
        await workspaceClient.session.create({ directory: workspace.path?.trim() || undefined }),
      );
      if (taskPrompt.runtimeProfileId) {
        bindWodeAppRuntimeProfileToSession(workspaceId, session.id, taskPrompt.runtimeProfileId);
      }
      const composerText = buildComposerTextWithAssetMentions(
        taskPrompt.displayText,
        taskPrompt.assetMentions ?? [],
      );
      saveSessionDraft(workspaceId, session.id, { text: composerText, mode: "prompt" });
      setWodeAppComposerHandoff(session.id, {
        displayText: composerText,
        agentMessage: taskPrompt.agentMessage,
      });
      setLegacySelectedWorkspaceId(workspaceId);
      writeActiveWorkspaceId(workspaceId || null);
      writeLastSessionFor(workspaceId, session.id);
      rememberPendingCreatedSession(workspaceId, session.id);
      setSessionsByWorkspaceId((current) => ({
        ...current,
        [workspaceId]: [session, ...(current[workspaceId] ?? [])],
      }));
      navigateToWorkspaceSession(workspaceId, session.id);
      primeWodeAppComposer(session.id, composerText);
      primeComposerAssetMentions(session.id, taskPrompt.assetMentions ?? []);
      if (taskPrompt.autoSend !== false) {
        queueBuiltinAgentAutoSend(session.id);
      }
      focusPromptSoon();
      return session.id;
    } catch {
      void handleCreateTaskInWorkspace(workspaceId);
      return null;
    }
  }, [
    baseUrl,
    handleCreateTaskInWorkspace,
    navigateToWorkspaceSession,
    rememberPendingCreatedSession,
    token,
    workspaces,
  ]);

  useEffect(() => {
    if (!wodeAppHandoff?.autoSend) return;
    if (!selectedWorkspaceId) return;

    if (!selectedSessionId) {
      if (!canCreateTask || wodeAppHandoffCreateStartedRef.current) return;
      wodeAppHandoffCreateStartedRef.current = true;
      void handleCreateTaskInWorkspace(selectedWorkspaceId).then((sessionId) => {
        if (!sessionId) {
          clearPendingWodeAppSessionHandoff();
          setWodeAppHandoff(null);
          toast.error("自动任务没有发送", {
            description: "请确认工作区和模型可用后再试。",
          });
        }
      });
      return;
    }

    if (!surfaceProps || wodeAppHandoffSendStartedRef.current) return;
    if (!claimWodeAppSessionHandoff(wodeAppHandoff.id)) {
      clearPendingWodeAppSessionHandoff();
      setWodeAppHandoff(null);
      return;
    }

    wodeAppHandoffSendStartedRef.current = true;
    const prompt = wodeAppHandoff.prompt;
    void surfaceProps.onSendDraft(buildWodeAppHandoffDraft(prompt), selectedSessionId)
      .then(() => {
        clearPendingWodeAppSessionHandoff();
        setWodeAppHandoff(null);
        toast.success("已开始创建自动任务");
      })
      .catch((error) => {
        clearPendingWodeAppSessionHandoff();
        setWodeAppHandoff(null);
        toast.error("自动任务没有发送", {
          description: error instanceof Error ? error.message : "请稍后重试。",
        });
      });
  }, [
    canCreateTask,
    handleCreateTaskInWorkspace,
    selectedSessionId,
    selectedWorkspaceId,
    surfaceProps,
    wodeAppHandoff,
  ]);

  // Latest session-list state for prev/next session tab navigation. The
  // `options` field is updated by `onSessionTabsChange` from SessionPage so we
  // only cycle through tabs the user actually opened (not artifact sessions).
  // The remaining fields are refreshed during render.
  const sessionTabNavRef = useRef<{
    options: OpenSessionTab[];
    workspaceId: string;
    sessionId: string | null;
    navigate: (workspaceId: string, sessionId?: string | null) => void;
  }>({ options: [], workspaceId: "", sessionId: null, navigate: () => {} });

  const goToSessionTabByOffset = useCallback((offset: number) => {
    const { options, workspaceId, sessionId, navigate } = sessionTabNavRef.current;
    const scoped = options.filter((option) => option.workspaceId === workspaceId);
    if (scoped.length === 0) return;
    const currentIndex = sessionId
      ? scoped.findIndex((option) => option.sessionId === sessionId)
      : -1;
    const nextIndex = currentIndex === -1
      ? offset > 0 ? 0 : scoped.length - 1
      : (currentIndex + offset + scoped.length) % scoped.length;
    const target = scoped[nextIndex];
    if (!target || target.sessionId === sessionId) return;
    navigate(target.workspaceId, target.sessionId);
  }, []);

  const goToNextSessionTab = useCallback(() => goToSessionTabByOffset(1), [goToSessionTabByOffset]);
  const goToPrevSessionTab = useCallback(() => goToSessionTabByOffset(-1), [goToSessionTabByOffset]);

  const {
    commandPaletteOpen,
    setCommandPaletteOpen,
    sessionSearchOpen,
    setSessionSearchOpen,
    terminalOpen,
    setTerminalOpen,
  } = useShellShortcuts({
    canCreateTask,
    workspaceId: selectedWorkspaceId,
    onCreateTask: async (workspaceId) => {
      await handleCreateTaskInWorkspace(workspaceId);
    },
    onNextSessionTab: goToNextSessionTab,
    onPrevSessionTab: goToPrevSessionTab,
  });
  useReactRenderWatchdog("SessionRoute", {
    selectedSessionId,
    selectedWorkspaceId,
    loading,
    workspaceCount: workspaces.length,
    sessionGroupCount: Object.keys(sessionsByWorkspaceId).length,
    commandPaletteOpen,
    modelPickerOpen: modelPicker.open,
  });

  const navigateToSessionForControl = useCallback((sessionId: string) => {
    const owner = Object.entries(sessionsByWorkspaceId).find(([, sessions]) =>
      (sessions ?? []).some((session) => session?.id === sessionId),
    )?.[0];
    navigateToWorkspaceSession(owner || selectedWorkspaceId, sessionId);
  }, [navigateToWorkspaceSession, selectedWorkspaceId, sessionsByWorkspaceId]);

  const navigateToSessionRootForControl = useCallback(() => {
    navigateToWorkspaceSession(selectedWorkspaceId);
  }, [navigateToWorkspaceSession, selectedWorkspaceId]);

  const openModelPickerForControl = useCallback(() => {
    modelPicker.setOpen(true);
  }, []);

  const prefetchSession = useCallback((workspaceId: string, sessionId: string) => {
    const workspace =
      workspaces.find((item) => item.id === workspaceId)
      ?? (workspaceId === selectedWorkspaceId ? selectedWorkspace : null);
    const endpoint = workspace ? endpointForWorkspace(workspace) : null;
    const snapshotClient =
      endpoint?.client
      ?? (workspaceId === selectedWorkspaceId ? client : null);
    prefetchSessionSnapshot(snapshotClient, workspaceId, sessionId);
  }, [client, endpointForWorkspace, selectedWorkspace, selectedWorkspaceId, workspaces]);

  useSessionControlActions({
    workspaces,
    sessionsByWorkspaceId,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
    selectedSessionId,
    canCreateTask,
    openworkClient: client,
    opencodeClient,
    navigateToSession: navigateToSessionForControl,
    navigateToSessionRoot: navigateToSessionRootForControl,
    createTaskInWorkspace: async (workspaceId) => {
      await handleCreateTaskInWorkspace(workspaceId);
    },
    openModelPicker: openModelPickerForControl,
    refreshRouteState,
  });

  const commandPaletteControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "command_palette.open",
    label: "Open the command palette",
    description: "Open the in-app command palette so the next choice is visible.",
    sideEffect: "none",
    execute: () => setCommandPaletteOpen(true),
  }), []);
  useControlAction(commandPaletteControlAction);

  const addProviderControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "settings.provider.add",
    label: "Add a model provider",
    description: "Open the provider connection modal, optionally pre-filtered to a specific provider.",
    sideEffect: "mutation",
    requiresArgs: false,
    args: [
      { name: "providerId", type: "string" as const, required: false, description: "Provider id to pre-select, e.g. 'anthropic', 'openai', 'google'." },
    ],
    execute: async (rawArgs: unknown) => {
      if (checkDesktopRestriction({ restriction: "allowCustomProviders" })) {
        return { ok: false, error: "Custom providers are disabled by your organization." };
      }
      const providerId = typeof rawArgs === "object" && rawArgs !== null
        ? (rawArgs as Record<string, unknown>).providerId
        : undefined;
      const preferred = typeof providerId === "string" ? providerId.trim() : undefined;
      await sessionProviderAuthStore.openProviderAuthModal(
        preferred ? { preferredProviderId: preferred } : undefined,
      );
      return { ok: true, opened: "provider_auth_modal", preferredProviderId: preferred ?? null };
    },
  }), [checkDesktopRestriction, sessionProviderAuthStore]);
  useControlAction(addProviderControlAction);

  const paletteSessionOptions = useMemo<PaletteSessionOption[]>(() => {
    const out: PaletteSessionOption[] = [];
    for (const workspace of workspaces) {
      const workspaceTitle =
        workspace.displayName?.trim() ||
        workspace.name?.trim() ||
        workspace.path?.trim() ||
        t("session.workspace_fallback");
      const list = sessionsByWorkspaceId[workspace.id] ?? [];
      for (const session of list) {
        const sessionId = (session as { id?: string }).id?.trim() ?? "";
        if (!sessionId) continue;
        const title = getDisplaySessionTitle(
          (session as { title?: string }).title ?? "",
        );
        const updatedAt =
          (session as { time?: { updated?: number; created?: number } }).time
            ?.updated ??
          (session as { time?: { updated?: number; created?: number } }).time
            ?.created ??
          0;
        out.push({
          workspaceId: workspace.id,
          sessionId,
          title,
          workspaceTitle,
          updatedAt,
          searchText: `${title} ${workspaceTitle}`.toLowerCase(),
          isActive: workspace.id === selectedWorkspaceId,
        });
      }
    }
    out.sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
    return out;
  }, [sessionsByWorkspaceId, selectedWorkspaceId, workspaces]);

  // Refresh the non-tab fields of the nav ref during render. The `options`
  // field is maintained by the `onSessionTabsChange` callback from SessionPage.
  sessionTabNavRef.current = {
    options: sessionTabNavRef.current.options,
    workspaceId: selectedWorkspaceId,
    sessionId: selectedSessionId,
    navigate: navigateToWorkspaceSession,
  };

  const paletteSessionGroups = useMemo<SessionGroupOption[]>(
    () => selectedWorkspaceGroupState?.groups ?? [],
    [selectedWorkspaceGroupState?.groups],
  );

  const currentSessionForGroupMove = useMemo(() => {
    if (!selectedWorkspaceId || !selectedSessionId) return null;
    return paletteSessionOptions.find(
      (session) => session.workspaceId === selectedWorkspaceId && session.sessionId === selectedSessionId,
    ) ?? null;
  }, [paletteSessionOptions, selectedSessionId, selectedWorkspaceId]);

  const currentSessionGroupId = selectedSessionId
    ? selectedWorkspaceGroupState?.assignments[selectedSessionId] ?? null
    : null;

  const handleMoveCurrentSessionToGroup = useCallback((groupId: string) => {
    if (!selectedWorkspaceId || !selectedSessionId) return;
    assignSessionToGroup(selectedWorkspaceId, selectedSessionId, groupId);
  }, [assignSessionToGroup, selectedSessionId, selectedWorkspaceId]);

  const sessionSearchFetcher = useMemo<SessionMessageFetcher | null>(() => {
    if (!client) return null;
    // Cap the transcript fetch to keep multi-workspace scans fast; matches in
    // anything older than the most recent 400 messages are traded away for
    // responsiveness.
    return async (workspaceId: string, sessionId: string) =>
      (await client.getSessionMessages(workspaceId, sessionId, { limit: 400 })).items;
  }, [client]);

  const sessionSearchPaletteItem = useMemo<PaletteItem>(() => ({
    id: "session-search.open",
    title: "Search session messages",
    detail: "Deep search every session, including message content",
    meta: "Cmd/Ctrl+Shift+F",
    searchText: "search find sessions messages history transcript content",
    action: () => {
      setCommandPaletteOpen(false);
      setSessionSearchOpen(true);
    },
  }), []);

  const terminalPaletteItems = useMemo<PaletteItem[]>(() => [
    {
      id: "terminal.toggle",
      title: terminalOpen ? "Hide terminal" : "Show terminal",
      detail: "Toggle the integrated terminal panel for this workspace",
      meta: "Cmd/Ctrl+J",
      searchText: "terminal shell command line console show hide toggle",
      action: () => {
        setCommandPaletteOpen(false);
        setTerminalOpen((value) => !value);
      },
    },
  ], [terminalOpen]);

  const developerModePaletteItem = useMemo<PaletteItem>(() => ({
    id: "developer-mode.toggle",
    title: developerMode ? t("settings.disable_developer_mode") : t("settings.enable_developer_mode"),
    detail: t("settings.developer_mode_desc"),
    meta: developerMode ? "On" : "Off",
    searchText: "developer dev mode debug diagnostics toggle enable disable",
    action: () => {
      setCommandPaletteOpen(false);
      setDeveloperMode((current) => {
        const next = !current;
        try { window.localStorage.setItem("openwork.developerMode", next ? "1" : "0"); } catch {}
        return next;
      });
    },
  }), [developerMode]);

  const wodeAppSessionDebugContext = useMemo<WodeAppSessionDebugContext>(() => ({
    workspaceId: selectedWorkspaceId ?? "",
    sessionId: selectedSessionId ?? "",
    workspaceRoot: selectedWorkspaceRoot ?? "",
    model: selectedModel ?? undefined,
    opencodeBaseUrl,
    sessionStatus: selectedWorkspaceId && selectedSessionId
      ? sessionActivityByWorkspaceId[selectedWorkspaceId]?.[selectedSessionId] ?? undefined
      : undefined,
    sessionError: selectedWorkspaceId && selectedSessionId
      ? selectedSessionError
      : null,
    wodeappWorkbench: shellConfig.wodeappWorkbench,
  }), [
    opencodeBaseUrl,
    selectedModel,
    selectedSessionId,
    selectedWorkspaceId,
    selectedWorkspaceRoot,
    selectedSessionError,
    sessionActivityByWorkspaceId,
    shellConfig.wodeappWorkbench,
  ]);

  const wodeAppCopySessionIdPaletteItem = useMemo<PaletteItem>(() => ({
    id: "wodeapp.copy-session-id",
    title: "复制对话 ID",
    detail: selectedSessionId ? `当前会话：${selectedSessionId}` : "请先打开一个对话",
    meta: "WodeAppX",
    searchText: "wodeapp copy session id conversation debug 对话 id",
    action: () => {
      if (!selectedSessionId) {
        setCommandPaletteOpen(false);
        toast.warning("当前没有可复制的对话");
        return;
      }
      void copyWodeAppSessionId(selectedSessionId).finally(() => {
        setCommandPaletteOpen(false);
      });
    },
  }), [selectedSessionId]);

  const wodeAppCopyDebugBundlePaletteItem = useMemo<PaletteItem>(() => ({
    id: "wodeapp.copy-session-debug",
    title: "复制调试信息",
    detail: "复制对话 ID、工作区、模型、错误信息等 JSON，便于发给 Cursor 排查",
    meta: "WodeAppX",
    searchText: "wodeapp copy debug bundle diagnostics 调试 排查",
    action: () => {
      if (!selectedSessionId) {
        setCommandPaletteOpen(false);
        toast.warning("当前没有可复制的对话");
        return;
      }
      void copyWodeAppSessionDebugBundle(wodeAppSessionDebugContext).finally(() => {
        setCommandPaletteOpen(false);
      });
    },
  }), [selectedSessionId, wodeAppSessionDebugContext]);

  const wodeAppPaletteItems = useMemo(
    () => shellConfig.wodeappWorkbench
      ? [wodeAppCopySessionIdPaletteItem, wodeAppCopyDebugBundlePaletteItem]
      : [],
    [
      shellConfig.wodeappWorkbench,
      wodeAppCopyDebugBundlePaletteItem,
      wodeAppCopySessionIdPaletteItem,
    ],
  );

  const nextSessionTabPaletteItem = useMemo<PaletteItem>(() => ({
    id: "session-tab.next",
    title: "Next session tab",
    detail: "Switch to the next session in this workspace",
    meta: "Cmd/Ctrl+T",
    searchText: "next session tab switch forward",
    action: () => {
      setCommandPaletteOpen(false);
      goToNextSessionTab();
    },
  }), [goToNextSessionTab]);

  const prevSessionTabPaletteItem = useMemo<PaletteItem>(() => ({
    id: "session-tab.previous",
    title: "Previous session tab",
    detail: "Switch to the previous session in this workspace",
    meta: "Cmd/Ctrl+Shift+T",
    searchText: "previous session tab switch back",
    action: () => {
      setCommandPaletteOpen(false);
      goToPrevSessionTab();
    },
  }), [goToPrevSessionTab]);

  const reloadConfigPaletteItem = useMemo<PaletteItem>(() => ({
    id: "reload-opencode-config",
    title: t("session.cmd_reload_config_title"),
    detail: t("session.cmd_reload_config_detail"),
    meta: reloadCoordinator.canReloadWorkspaceEngine
      ? t("config.reload_engine")
      : t("system.reload_unavailable"),
    searchText: "reload opencode config providers models mcp jsonc refresh re-read engine restart",
    action: () => {
      setCommandPaletteOpen(false);
      if (!reloadCoordinator.canReloadWorkspaceEngine) return;
      void reloadCoordinator.reloadWorkspaceEngine();
    },
  }), [reloadCoordinator.canReloadWorkspaceEngine, reloadCoordinator.reloadWorkspaceEngine]);

  const handleReorderWorkspaces = useCallback((workspaceIds: string[]) => {
    const activeWorkspaceIds = new Set(workspacesRef.current.map((workspace) => workspace.id));
    const nextOrderIds: string[] = [];
    const nextOrderIdSet = new Set<string>();

    for (const id of workspaceIds) {
      if (!activeWorkspaceIds.has(id) || nextOrderIdSet.has(id)) continue;
      nextOrderIds.push(id);
      nextOrderIdSet.add(id);
    }

    for (const workspace of workspacesRef.current) {
      if (nextOrderIdSet.has(workspace.id)) continue;
      nextOrderIds.push(workspace.id);
      nextOrderIdSet.add(workspace.id);
    }

    workspaceOrderIdsRef.current = nextOrderIds;
    setWorkspaceOrderIds(nextOrderIds);
    writeWorkspaceOrderIds(nextOrderIds);
    setWorkspaces((current) => orderRouteWorkspaces(current, nextOrderIds));
  }, []);

  const handleArchiveSession = useCallback(
    async (sessionId: string, archived: boolean) => {
      if (!opencodeClient) return;
      try {
        await setSessionArchived(
          opencodeClient,
          sessionId,
          archived,
          selectedWorkspaceRoot || undefined,
        );
        await refreshRouteState();
      } catch (error) {
        console.error("[session-route] archive session failed", error);
        toast.error(
          archived
            ? t("session_management.archive_failed")
            : t("session_management.unarchive_failed"),
          { description: describeRouteError(error) },
        );
      }
    },
    [opencodeClient, refreshRouteState, selectedWorkspaceRoot],
  );

  const handleCompactSession = useCallback(
    async (sessionId: string) => {
      const normalizedSessionId = sessionId.trim();
      if (!opencodeClient || !normalizedSessionId) return;
      const activityStatus = sidebarSessionStatusById[normalizedSessionId];
      if (
        activityStatus === "thinking"
        || activityStatus === "responding"
        || activityStatus === "waiting"
        || activityStatus === "compacting"
      ) {
        toast.warning("当前对话仍在运行", {
          description: "请等待本轮任务结束后再压缩上下文。",
        });
        return;
      }
      const modelState = resolveSessionModelState(
        local.prefs.defaultModel,
        local.prefs.modelVariant,
        sessionModelOverrides[normalizedSessionId],
      );
      if (!modelState.model) {
        toast.error("无法压缩上下文", {
          description: "请先为当前工作区选择一个文字模型。",
        });
        return;
      }

      const toastId = `session-compact-${normalizedSessionId}`;
      toast.loading("正在压缩上下文", {
        id: toastId,
        description: "WodeAppX 会保留会话摘要和附件按需读取能力。",
      });
      recordWodeAppContextHygieneEvent({
        sessionId: normalizedSessionId,
        event: "manual_compaction_started",
      });
      try {
        await compactSession(opencodeClient, normalizedSessionId, modelState.model, {
          directory: selectedWorkspaceRoot || undefined,
        });
        recordWodeAppContextHygieneEvent({
          sessionId: normalizedSessionId,
          event: "manual_compaction_finished",
        });
        toast.success("上下文已压缩", {
          id: toastId,
          description: "历史已整理，附件仍可在需要时重新读取。",
        });
      } catch (error) {
        recordWodeAppContextHygieneEvent({
          sessionId: normalizedSessionId,
          event: "manual_compaction_failed",
          details: { reason: error instanceof Error ? error.name : "unknown" },
        });
        toast.error("压缩上下文失败", {
          id: toastId,
          description: describeRouteError(error),
        });
      }
    },
    [
      local.prefs.defaultModel,
      local.prefs.modelVariant,
      opencodeClient,
      selectedWorkspaceRoot,
      sessionModelOverrides,
      sidebarSessionStatusById,
    ],
  );

  const handleCreateWorkspace = useCallback(async (preset: WorkspacePreset, folder: string | null) => {
    if (!folder) return;
    setCreateWorkspaceBusy(true);
    setCreateWorkspaceError(null);
    try {
      const workspaceName = folderNameFromPath(folder);
      let list: WorkspaceList | null = null;
      let createdOnServer = false;
      if (client) {
        list = await client
          .createLocalWorkspace({ folderPath: folder, name: workspaceName, preset })
          .then((serverList) => {
            createdOnServer = true;
            return serverList;
          })
          .catch(() => null);
      }
      if (!list) {
        throw new Error("OpenWork server is unavailable. Start or reconnect the server before creating a workspace.");
      }
      const createdId = resolveWorkspaceListSelectedId(list) || list.workspaces[list.workspaces.length - 1]?.id || "";
      let targetWorkspaceId = createdId;
      let targetWorkspace = list.workspaces.find((workspace: WorkspaceInfo) => workspace.id === createdId) ?? null;
      if (createdId) {
        await workspaceSetSelected(createdId).catch(() => undefined);
        await workspaceSetRuntimeActive(createdId).catch(() => undefined);
      }
      setCreateWorkspaceOpen(false);
      // Mark onboarding complete so the /welcome redirect never fires again.
      local.setPrefs((prev) => ({ ...prev, hasCompletedOnboarding: true }));
      await refreshRouteState();
      if (targetWorkspaceId) {
        const workspacePath = targetWorkspace?.path?.trim() || folder;
        const session = createdOnServer && baseUrl && token
          ? unwrap(await createClient(
              `${(buildOpenworkWorkspaceBaseUrl(baseUrl, targetWorkspaceId) ?? baseUrl).replace(/\/+$/, "")}/opencode`,
              workspacePath || undefined,
              { token, mode: "openwork" },
            ).session.create({ directory: workspacePath || undefined }))
          : null;
        setLegacySelectedWorkspaceId(targetWorkspaceId);
        writeActiveWorkspaceId(targetWorkspaceId);
        captureAnalyticsEvent("workspace_created", { workspace_type: "local" });
        if (session?.id) {
          captureAnalyticsEvent("task_created", { source: "workspace_created", workspace_type: "local" });
          writeLastSessionFor(targetWorkspaceId, session.id);
          rememberPendingCreatedSession(targetWorkspaceId, session.id);
          setSessionsByWorkspaceId((current) => {
            const next = {
              ...current,
              [targetWorkspaceId]: [session, ...(current[targetWorkspaceId] ?? [])],
            };
            sessionsByWorkspaceIdRef.current = next;
            return next;
          });
        }
        navigateToWorkspaceSession(targetWorkspaceId, session?.id ?? null, { replace: true });
        if (session?.id) focusPromptSoon();
      }
    } catch (error) {
      const message = describeWorkspaceCreateError(error);
      setCreateWorkspaceError(message);
      if (!createWorkspaceOpen) {
        toast.error("创建项目失败", { description: message });
      }
    } finally {
      setCreateWorkspaceBusy(false);
    }
  }, [baseUrl, client, createWorkspaceOpen, local, navigateToWorkspaceSession, refreshRouteState, rememberPendingCreatedSession, token]);

  const handleCreateBlankWorkspace = useCallback(async () => {
    if (!guardMultipleWorkspacesAllowed()) return;
    if (createWorkspaceBusy) return;
    setCreateWorkspaceError(null);
    try {
      const folder = await resolveBlankProjectFolder();
      if (!folder) {
        const picked = await pickDirectory({ title: t("onboarding.authorize_folder") });
        const path = typeof picked === "string" ? picked.trim() : "";
        if (!path) return;
        await handleCreateWorkspace("starter", path);
        return;
      }
      await handleCreateWorkspace("starter", folder);
    } catch (error) {
      toast.error("创建项目失败", {
        description: describeWorkspaceCreateError(error),
      });
    }
  }, [
    createWorkspaceBusy,
    guardMultipleWorkspacesAllowed,
    handleCreateWorkspace,
    resolveBlankProjectFolder,
  ]);

  const handleOpenExistingFolderWorkspace = useCallback(async () => {
    if (!guardMultipleWorkspacesAllowed()) return;
    if (createWorkspaceBusy) return;
    setCreateWorkspaceError(null);
    try {
      const picked = await pickDirectory({ title: t("onboarding.authorize_folder") });
      const path = typeof picked === "string" ? picked.trim() : "";
      if (!path) return;
      await handleCreateWorkspace("starter", path);
    } catch (error) {
      toast.error("创建项目失败", {
        description: describeWorkspaceCreateError(error),
      });
    }
  }, [createWorkspaceBusy, guardMultipleWorkspacesAllowed, handleCreateWorkspace]);

  const createWorkspaceControlAction = useMemo<OpenworkControlAction>(() => ({
    id: "workspace.create",
    label: "Create a local workspace",
    description: "Create a workspace at the given folder path without showing the file picker dialog.",
    sideEffect: "mutation",
    effect: "write",
    approval: "prompt",
    requiresArgs: true,
    args: [{ name: "path", type: "string", required: true, description: "Absolute folder path for the new workspace." }],
    execute: async (args) => {
      const folder = (args as { path?: string } | undefined)?.path?.trim();
      if (!folder) return { ok: false, error: "path is required" };
      await handleCreateWorkspace("starter", folder);
      return { path: folder };
    },
  }), [handleCreateWorkspace]);
  useControlAction(createWorkspaceControlAction);

  const handleCreateRemoteWorkspace = useCallback(async (input: {
    openworkHostUrl?: string | null;
    openworkToken?: string | null;
    directory?: string | null;
    displayName?: string | null;
  }) => {
    const baseUrlValue = input.openworkHostUrl?.trim() ?? "";
    if (!baseUrlValue) return false;
    setCreateWorkspaceRemoteBusy(true);
    setCreateWorkspaceRemoteError(null);
    try {
      const remoteType: "openwork" = "openwork";
      const payload = {
        baseUrl: baseUrlValue,
        openworkHostUrl: baseUrlValue,
        openworkToken: input.openworkToken?.trim() || null,
        displayName: input.displayName?.trim() || null,
        directory: input.directory?.trim() || null,
        remoteType,
      };
      let list: WorkspaceList | null = null;
      if (client) {
        list = await client.createRemoteWorkspace(payload).catch(() => null);
      }
      if (!list) {
        throw new Error("OpenWork server is unavailable. Start or reconnect the server before connecting a remote workspace.");
      }
      const createdId = resolveWorkspaceListSelectedId(list) || list.workspaces[list.workspaces.length - 1]?.id || "";
      if (createdId) {
        await workspaceSetSelected(createdId).catch(() => undefined);
        await workspaceSetRuntimeActive(createdId).catch(() => undefined);
      }
      setCreateWorkspaceOpen(false);
      // Mark onboarding complete so the /welcome redirect never fires again.
      local.setPrefs((prev) => ({ ...prev, hasCompletedOnboarding: true }));
      await refreshRouteState();
      return true;
    } catch (error) {
      setCreateWorkspaceRemoteError(error instanceof Error ? error.message : t("app.unknown_error"));
      return false;
    } finally {
      setCreateWorkspaceRemoteBusy(false);
    }
  }, [client, local, refreshRouteState]);

  return (
    <WorkspaceProvider
      client={opencodeClient}
      opencodeBaseUrl={opencodeBaseUrl}
      selectedWorkspaceRoot={selectedWorkspaceRoot}
      providerList={providerListQuery.data}
    >
    {opencodeClient && selectedWorkspaceEndpoint && opencodeBaseUrl && selectedWorkspaceServerToken ? (
      <ReactSessionRuntime
        // Use the server-side workspace id (the one without the `rem_`
        // prefix) so the React Query cache keys session-sync writes match
        // the keys SessionSurface reads from. Otherwise events arrive but
        // the UI never sees them and gets stuck on "thinking".
        workspaceId={selectedWorkspaceEndpoint.workspaceId}
        sessionId={selectedSessionId}
        activeSessionIds={activeSelectedWorkspaceSessionIds}
        opencodeBaseUrl={opencodeBaseUrl}
        openworkToken={selectedWorkspaceServerToken}
        onSessionUpdated={handleRuntimeSessionUpdated}
      />
    ) : null}
    <div className="wapp-route-root">
    <WodeAppWorkbenchShell
        selectedWorkspaceRoot={selectedWorkspaceRoot}
        automations={automationClient}
        feishuSetupSkillReady={feishuSetupSkillReady}
        onAuthorizeFeishu={authorizeFeishuFromWorkbench}
        sidebar={{
          selectedWorkspaceId,
          selectedSessionId,
          workspaceSessionGroups,
          sessionsLoading: effectiveLoading,
          sessionStatusById: sidebarSessionStatusById,
          connectingWorkspaceId: null,
          workspaceConnectionStateById,
          newTaskDisabled: !canCreateTask,
          onCreateTaskInWorkspace: (workspaceId, options) => {
            void handleCreateTaskInWorkspace(workspaceId, options);
          },
          onCreateTaskWithPrompt: (workspaceId, prompt) => (
            handleCreateTaskWithPrompt(workspaceId, prompt)
          ),
          onOpenSession: (workspaceId, sessionId) => {
            setLegacySelectedWorkspaceId(workspaceId);
            writeActiveWorkspaceId(workspaceId || null);
            writeLastSessionFor(workspaceId, sessionId);
            navigateToWorkspaceSession(workspaceId, sessionId);
          },
          onPrefetchSession: prefetchSession,
          onRenameSession:
            opencodeClient
              ? async (sessionId, nextTitle) => {
                  const trimmed = nextTitle.trim();
                  if (!trimmed) return;
                  await opencodeClient.session.update({
                    sessionID: sessionId,
                    title: trimmed,
                    directory: selectedWorkspaceRoot || undefined,
                  });
                  await refreshRouteState();
                }
              : undefined,
          onDeleteSession:
            client ? (sessionId) => handleDeleteSession(sessionId) : undefined,
          onCompactSession: opencodeClient ? handleCompactSession : undefined,
          onArchiveSession: opencodeClient ? handleArchiveSession : undefined,
          onSelectWorkspace: async (workspaceId) => {
            if (workspaceId === selectedWorkspaceId) return true;
            setLegacySelectedWorkspaceId(workspaceId);
            writeActiveWorkspaceId(workspaceId || null);
            const workspace = workspaces.find((item) => item.id === workspaceId);
            if (client && workspace && !sessionsByWorkspaceId[workspaceId]?.length) {
              setRetryingWorkspaceIds((current) => Array.from(new Set([...current, workspaceId])));
              void loadWorkspaceSessionsInBackground([workspace]);
            }
            if (isDesktopRuntime()) {
              void workspaceSetSelected(workspaceId).catch(() => undefined);
              void workspaceSetRuntimeActive(workspaceId).catch(() => undefined);
            }
            if (workspaceId) {
              const workspace = workspaces.find((item) => item.id === workspaceId) ?? null;
              const endpoint = endpointForWorkspace(workspace);
              if (endpoint) {
                // Auto-mounted Electron workspaces (e.g. Supor) may exist in the
                // desktop store before the OpenWork server has registered them.
                await ensureWorkspaceRegisteredOnServer(endpoint.client, workspace).catch(() => undefined);
              }
            }
            const remembered = readLastSessionFor(workspaceId);
            if (remembered && remembered !== selectedSessionId) {
              const known = sessionsByWorkspaceId[workspaceId];
              if (known?.some((session) => session?.id === remembered)) {
                navigateToWorkspaceSession(workspaceId, remembered);
              } else {
                navigateToWorkspaceSession(workspaceId);
              }
            } else {
              navigateToWorkspaceSession(workspaceId);
            }
            return true;
          },
          onOpenRenameWorkspace: handleOpenRenameWorkspace,
          onShareWorkspace: handleShareWorkspace,
          onRevealWorkspace: (id) => void handleRevealWorkspace(id),
          onRecoverWorkspace: (workspaceId) => runRemoteWorkspaceConnectionCheck(workspaceId, "recover"),
          onTestWorkspaceConnection: (workspaceId) => runRemoteWorkspaceConnectionCheck(workspaceId, "test"),
          onEditWorkspaceConnection: remoteWorkspaceConnectionEditor.open,
          onForgetWorkspace: (id) => void handleForgetWorkspace(id),
          onOpenCreateWorkspace: handleOpenCreateWorkspace,
          onCreateBlankWorkspace: handleCreateBlankWorkspace,
          onOpenExistingFolderWorkspace: handleOpenExistingFolderWorkspace,
          createWorkspaceBusy,
        }}
      >
        <SessionPage
      selectedSessionId={selectedSessionId}
      selectedWorkspaceId={selectedWorkspaceId}
      selectedWorkspaceDisplay={selectedWorkspace ? {
        id: selectedWorkspace.id,
        name: selectedWorkspace.name ?? undefined,
        displayName: selectedWorkspace.displayNameResolved,
        workspaceType: selectedWorkspace.workspaceType,
      } : { workspaceType: "local" }}
      selectedWorkspaceRoot={selectedWorkspaceRoot}
      selectedWorkspaceError={selectedWorkspaceError}
      runtimeWorkspaceId={selectedWorkspaceEndpoint?.workspaceId || null}
      opencodeBaseUrl={opencodeBaseUrl}
      workspaces={workspaces}
      clientConnected={canCreateTask}
      openworkServerStatus={client ? "connected" : "disconnected"}
      openworkServerClient={selectedWorkspaceEndpoint?.client ?? client}
      environmentClient={client}
      openworkServerToken={selectedWorkspaceServerToken}
      developerMode={developerMode}
      headerStatus={canCreateTask ? t("status.connected") : t("session.loading_detail")}
      busyHint={effectiveLoading ? t("session.loading_detail") : null}
      startupPhase={effectiveLoading ? "nativeInit" : "ready"}
      providerConnectedIds={providerConnectedIds}
      hasUsableModel={hasUsableModel}
      providers={providers}
      mcpConnectedCount={mcpConnectedCount}
      onSendFeedback={() => {
        platform.openLink(
          buildFeedbackUrl({
            entrypoint: "status-bar",
          }),
        );
      }}
      onOpenSettings={() => handleOpenSettings("/settings/service")}
      onOpenProviderAuth={() => {
        if (shellConfig.wodeappWorkbench) {
          window.dispatchEvent(new Event(WODEAPP_OPEN_BYOK_GUIDE_EVENT));
          return;
        }
        sessionProviderAuthStore.openProviderAuthModal({ returnFocusTarget: "composer" });
      }}
      providerAuthModal={sessionProviderAuthSnapshot.providerAuthModalOpen ? {
        open: true,
        loading: false,
        submitting: sessionProviderAuthSnapshot.providerAuthBusy,
        error: sessionProviderAuthSnapshot.providerAuthError,
        preferredProviderId: sessionProviderAuthSnapshot.providerAuthPreferredProviderId,
        workerType: sessionProviderAuthSnapshot.providerAuthWorkerType,
        providers: sessionProviderAuthSnapshot.providerAuthProviders.filter(
          (provider) => !isDesktopProviderBlocked({ providerId: provider.id, checkRestriction: checkDesktopRestriction }),
        ),
        connectedProviderIds: providerConnectedIds,
        authMethods: Object.fromEntries(
          Object.entries(sessionProviderAuthSnapshot.providerAuthMethods).filter(
            ([providerId]) => !isDesktopProviderBlocked({ providerId, checkRestriction: checkDesktopRestriction }),
          ),
        ),
        onSelect: sessionProviderAuthStore.startProviderAuth,
        onSubmitApiKey: async (providerId, apiKey) => {
          const resolved = resolveByokProviderIdForAuth(providerId, { apiKey });
          const result = await sessionProviderAuthStore.submitProviderApiKey(
            resolved.providerId,
            apiKey,
          );
          modelPicker.setRecentProviderIds(new Set([resolved.providerId]));
          modelPicker.setQuery("");
          modelPicker.setOpen(true);
          return result;
        },
        onConnectCloudProvider: async (cloudProviderId) => {
          const result = await sessionProviderAuthStore.connectCloudProvider(cloudProviderId);
          modelPicker.setRecentProviderIds(new Set([cloudProviderId]));
          modelPicker.setQuery("");
          modelPicker.setOpen(true);
          return result;
        },
        onSubmitOAuth: sessionProviderAuthStore.completeProviderAuthOAuth,
        onRefreshProviders: sessionProviderAuthStore.refreshProviders,
        onClose: () => sessionProviderAuthStore.closeProviderAuthModal(),
      } : null}
      settingsSlot={
        <SettingsSurface
          embedded
          initialPath="extensions"
          workspaceId={selectedWorkspaceId}
          onClose={() => {
            try {
              window.dispatchEvent(new CustomEvent("openwork-close-right-pane"));
            } catch {
              // ignore
            }
          }}
        />
      }
      terminalOpen={terminalOpen}
      onTerminalOpenChange={setTerminalOpen}
      onSessionTabsChange={(tabs) => {
        sessionTabNavRef.current = { ...sessionTabNavRef.current, options: tabs };
      }}
      sidebar={{
        workspaceSessionGroups,
        selectedWorkspaceId,
        selectedSessionId,
        developerMode: false,
        sessionStatusById: sidebarSessionStatusById,
        connectingWorkspaceId: null,
        workspaceConnectionStateById,
        newTaskDisabled: !canCreateTask,
        sidebarHydratedFromCache: Object.values(sessionsByWorkspaceId).some((list) => list.length > 0),
        startupPhase: effectiveLoading ? "nativeInit" : "ready",
        onSelectWorkspace: async (workspaceId) => {
          if (workspaceId === selectedWorkspaceId) return true;
          setLegacySelectedWorkspaceId(workspaceId);
          writeActiveWorkspaceId(workspaceId || null);
          const workspace = workspaces.find((item) => item.id === workspaceId);
          if (client && workspace && !sessionsByWorkspaceId[workspaceId]?.length) {
            setRetryingWorkspaceIds((current) => Array.from(new Set([...current, workspaceId])));
            void loadWorkspaceSessionsInBackground([workspace]);
          }
          // Fire Tauri updates but don't await them — they're bookkeeping and
          // awaiting 2 IPC roundtrips on every click used to stall rapid
          // workspace switches behind a queue.
          if (isDesktopRuntime()) {
            void workspaceSetSelected(workspaceId).catch(() => undefined);
            void workspaceSetRuntimeActive(workspaceId).catch(() => undefined);
          }
          // Tell the OpenWork server this workspace is now active so it can
          // emit a config reload event that the OpenCode engine picks up.
          // Without this, the permissions from opencode.jsonc are never
          // applied on the workspace the user is already on at launch. See
          // issue #870.
          // Also register Electron-only mounts (Supor etc.) via /workspaces/local
          // when activate returns workspace_not_found.
          if (workspaceId) {
            const workspace = workspaces.find((item) => item.id === workspaceId) ?? null;
            const endpoint = endpointForWorkspace(workspace);
            if (endpoint) {
              await ensureWorkspaceRegisteredOnServer(endpoint.client, workspace).catch(() => undefined);
            }
          }
          // If we remember what the user last opened here and that session
          // still exists in our local list, navigate. Otherwise stay put.
          const remembered = readLastSessionFor(workspaceId);
          if (remembered && remembered !== selectedSessionId) {
            const known = sessionsByWorkspaceId[workspaceId];
            if (known?.some((session) => session?.id === remembered)) {
              navigateToWorkspaceSession(workspaceId, remembered);
            } else {
              navigateToWorkspaceSession(workspaceId);
            }
          } else {
            navigateToWorkspaceSession(workspaceId);
          }
          return true;
        },
        onOpenSession: (workspaceId, sessionId) => {
          setLegacySelectedWorkspaceId(workspaceId);
          writeActiveWorkspaceId(workspaceId || null);
          writeLastSessionFor(workspaceId, sessionId);
          navigateToWorkspaceSession(workspaceId, sessionId);
        },
        onPrefetchSession: prefetchSession,
        onCreateTaskInWorkspace: (workspaceId) => {
          void handleCreateTaskInWorkspace(workspaceId);
        },
        onCreateTaskWithPrompt: (workspaceId, prompt) => (
          handleCreateTaskWithPrompt(workspaceId, prompt)
        ),
        onOpenRenameWorkspace: handleOpenRenameWorkspace,
        onShareWorkspace: handleShareWorkspace,
        onRevealWorkspace: (id) => void handleRevealWorkspace(id),
        onRecoverWorkspace: (workspaceId) => runRemoteWorkspaceConnectionCheck(workspaceId, "recover"),
        onTestWorkspaceConnection: (workspaceId) => runRemoteWorkspaceConnectionCheck(workspaceId, "test"),
        onEditWorkspaceConnection: remoteWorkspaceConnectionEditor.open,
        onForgetWorkspace: (id) => void handleForgetWorkspace(id),
        onOpenCreateWorkspace: handleOpenCreateWorkspace,
        onReorderWorkspaces: handleReorderWorkspaces,
      }}
      surface={surfaceProps}
      history={{
        canUndo: false,
        canRedo: false,
        busyAction: null,
        onUndo: () => {},
        onRedo: () => {},
      }}
      todos={todos}
      sessionLoadingById={(sessionId) => effectiveLoading && Boolean(sessionId && sessionId === selectedSessionId)}
      shareWorkspaceModal={
        shareWorkspaceState.shareWorkspaceOpen
          ? {
              open: true,
              mobileEntry: shareWorkspaceState.shareWorkspaceMobileEntry,
              onClose: shareWorkspaceState.closeShareWorkspace,
              workspaceName: shareWorkspaceState.shareWorkspaceName,
              workspaceDetail: shareWorkspaceState.shareWorkspaceDetail,
              fields: shareWorkspaceState.shareWorkspaceMobileEntry ? [] : shareWorkspaceState.shareFields,
              remoteAccess:
                isDesktopRuntime() && !shareWorkspaceState.shareWorkspaceMobileEntry && shareWorkspaceState.shareWorkspace?.workspaceType === "local"
                  ? {
                      enabled: openworkServerSettings.remoteAccessEnabled === true,
                      busy: remoteAccessRestart.busy,
                      error: remoteAccessRestart.error,
                      status: remoteAccessRestart.status,
                      onSave: handleSaveShareRemoteAccess,
                    }
                  : undefined,
              note: shareWorkspaceState.shareNote,
              onExportConfig:
                shareWorkspaceState.exportDisabledReason === null
                  ? () => {
                      const id = shareWorkspaceState.shareWorkspaceId;
                      if (!id) return;
                      void handleExportWorkspaceConfig(id);
                    }
                  : undefined,
              exportDisabledReason: shareWorkspaceState.exportDisabledReason,
            }
          : null
      }
      activePermission={activePermission}
      permissionReplyBusy={permissionReplyBusy}
      respondPermission={respondPermission}
      activeQuestion={activeQuestion}
      questionReplyBusy={questionReplyBusy}
      respondQuestion={respondQuestion}
      safeStringify={safeStringify}
      onRenameSession={
        opencodeClient
          ? async (sessionId, nextTitle) => {
              const trimmed = nextTitle.trim();
              if (!trimmed) return;
              await opencodeClient.session.update({
                sessionID: sessionId,
                title: trimmed,
                directory: selectedWorkspaceRoot || undefined,
              });
              await refreshRouteState();
            }
          : undefined
      }
      onDeleteSession={
        client ? (sessionId) => handleDeleteSession(sessionId) : undefined
      }
      onArchiveSession={opencodeClient ? handleArchiveSession : undefined}
      statusBar={{ loading: showPreparingStatus, reloadBusy: reloadCoordinator.reloadBusy, reloadError: reloadCoordinator.reloadError }}
      notFoundMessage={routeNotFoundMessage}
      onAccessibleTargetsChange={setPaletteAccessibleTargets}
    />
      </WodeAppWorkbenchShell>
    </div>
    <OpenWorkModelsStartupDialog
      open={!shellConfig.wodeappWorkbench && openWorkModelsPromo.open}
      isSignedIn={denAuth.isSignedIn}
      models={OPENWORK_MODEL_PREVIEWS}
      onSubscribe={openWorkModelsPromo.subscribe}
      onContinueWithout={openWorkModelsPromo.continueWithout}
    />
    <CreateWorkspaceModal
      open={createWorkspaceOpen}
      onClose={() => {
        setCreateWorkspaceOpen(false);
        setCreateWorkspaceError(null);
      }}
      onConfirm={handleCreateWorkspace}
      onConfirmRemote={handleCreateRemoteWorkspace}
      onPickFolder={() => pickDirectory({ title: t("onboarding.authorize_folder") }) as Promise<string | null>}
      submitting={createWorkspaceBusy}
      localError={createWorkspaceError}
      remoteSubmitting={createWorkspaceRemoteBusy}
      remoteError={createWorkspaceRemoteError}
    />
    <CreateRemoteWorkspaceModal
      open={remoteWorkspaceConnectionEditor.workspace !== null}
      onClose={remoteWorkspaceConnectionEditor.close}
      onConfirm={(input) => void remoteWorkspaceConnectionEditor.save(input)}
      initialValues={remoteWorkspaceConnectionEditor.initialValues}
      submitting={remoteWorkspaceConnectionEditor.busy}
      error={remoteWorkspaceConnectionEditor.error}
      title={t("dashboard.edit_remote_workspace_title")}
      subtitle={t("dashboard.edit_remote_workspace_subtitle")}
      confirmLabel={t("dashboard.edit_remote_workspace_confirm")}
    />
    <RenameWorkspaceModal
      open={renameWorkspaceId !== null}
      title={renameWorkspaceTitle}
      busy={renameWorkspaceBusy}
      canSave={!renameWorkspaceBusy && renameWorkspaceTitle.trim().length > 0}
      onClose={() => {
        if (renameWorkspaceBusy) return;
        setRenameWorkspaceId(null);
        setRenameWorkspaceTitle("");
      }}
      onSave={() => void handleSaveRenameWorkspace()}
      onTitleChange={setRenameWorkspaceTitle}
    />
    <CommandPalette
      open={commandPaletteOpen}
      onClose={() => setCommandPaletteOpen(false)}
      onCreateNewSession={() => {
        if (selectedWorkspaceId) {
          void handleCreateTaskInWorkspace(selectedWorkspaceId);
        }
      }}
      onOpenSession={(workspaceId, sessionId) => navigateToWorkspaceSession(workspaceId, sessionId)}
      onOpenSettings={(route) => handleOpenSettings(route ?? "/settings/service")}
      onOpenModelPicker={() => {
        modelPicker.setQuery("");
        modelPicker.setRecentProviderIds(new Set());
        window.requestAnimationFrame(() => modelPicker.setOpen(true));
      }}
      selectedModelLabel={modelLabel}
      accessibleTargets={paletteAccessibleTargets}
      onOpenAccessibleTarget={(target) => {
        try {
          window.dispatchEvent(new CustomEvent("openwork-open-accessible-target", { detail: target }));
        } catch {
          // ignore event dispatch failures
        }
      }}
      onHideAccessibleTarget={(target) => {
        try {
          window.dispatchEvent(new CustomEvent("openwork-hide-accessible-target", { detail: target }));
        } catch {
          // ignore event dispatch failures
        }
      }}
      sessions={paletteSessionOptions}
      sessionGroups={paletteSessionGroups}
      currentSessionForGroupMove={currentSessionForGroupMove}
      currentSessionGroupId={currentSessionGroupId}
      onMoveCurrentSessionToGroup={handleMoveCurrentSessionToGroup}
      extraItems={[sessionSearchPaletteItem, ...terminalPaletteItems, ...wodeAppPaletteItems, developerModePaletteItem, nextSessionTabPaletteItem, prevSessionTabPaletteItem, reloadConfigPaletteItem]}
    />
    <SessionSearchDialog
      open={sessionSearchOpen}
      onClose={() => setSessionSearchOpen(false)}
      sessions={paletteSessionOptions}
      fetchMessages={sessionSearchFetcher}
      onOpenSession={(workspaceId, sessionId) => navigateToWorkspaceSession(workspaceId, sessionId)}
    />
    <ModelPickerModal
      open={modelPicker.open}
      options={modelPicker.options}

      query={modelPicker.query}
      setQuery={modelPicker.setQuery}
      target="session"
      current={selectedModel ?? ({ providerID: "", modelID: "" } satisfies ModelRef)}
      onSelect={(next: ModelRef) => {
        const nextModel = shellConfig.wodeappWorkbench
          ? normalizeWodeAppModelRefForWorkbench(next, {
              connectedProviderIds: providerConnectedIds,
            })
          : next;
        rememberSelectedModel(nextModel);
        modelPicker.setOpen(false);
        focusPromptSoon();
      }}
      disabledProviders={disabledProviderIds}
      onBehaviorChange={() => {}}
      onToggleProvider={async (providerId, enable) => {
        if (!opencodeClient) return;
        try {
          const config = unwrap(await opencodeClient.config.get()) as { disabled_providers?: string[] };
          const current = Array.isArray(config.disabled_providers) ? config.disabled_providers : [];
          const next = enable
            ? current.filter((id: string) => id !== providerId)
            : [...current, providerId];
          await opencodeClient.config.update({ config: { ...config, disabled_providers: next } });
          setDisabledProviderIds(next);
        } catch {}
      }}
      onOpenSettings={() => {
        modelPicker.setOpen(false);
        handleOpenSettings("/settings/service");
      }}
      onClose={() => { modelPicker.setOpen(false); modelPicker.setRecentProviderIds(new Set()); }}
    />
    </WorkspaceProvider>
  );
}
