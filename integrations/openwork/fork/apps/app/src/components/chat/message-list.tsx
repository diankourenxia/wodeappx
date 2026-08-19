"use memo";

import * as React from "react"
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileIcon,
  History,
  LoaderCircle,
  Pencil,
  Split,
  Undo2,
} from "lucide-react"
import { t } from "@/i18n"
import {
  DynamicToolUIPart,
  isFileUIPart,
  ToolUIPart,
  type FileUIPart,
  type UIMessage,
} from "ai"
import type { SessionStatus } from "@opencode-ai/sdk/v2/client"
import { openDesktopUrl } from "@/app/lib/desktop"
import { SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX } from "@/app/types"
import { ApplyPatchTool } from "@/components/tools/apply-patch"
import { BashTool } from "@/components/tools/bash"
import { EditTool } from "@/components/tools/edit"
import { EnvVarRequestTool } from "@/components/tools/env-var-request"
import { ReadFileTool, WriteFileTool } from "@/components/tools/file"
import { GlobTool } from "@/components/tools/glob"
import { GrepTool } from "@/components/tools/grep"
import { LspTool } from "@/components/tools/lsp"
import { QuestionTool } from "@/components/tools/question"
import { SkillTool } from "@/components/tools/skill"
import { TodoWriteTool } from "@/components/tools/todowrite"
import { WebfetchTool } from "@/components/tools/webfetch"
import { WebsearchTool } from "@/components/tools/websearch"
import { useMessageList, useSessionErrorMessage } from "@/components/chat/message-list-provider"
import {
  canRenderInlineChatImage,
  filenameFromSlimmedLocalRef,
  isOpenableAttachmentUrl,
  isSlimmedLocalImageRef,
  isStubAttachmentUrl,
  toFileUrlFromAbsolutePath,
} from "@/components/chat/message-file-display"
import {
  readDesktopLocalPathAsDataUrl,
  resolveDesktopLocalOpenPath,
} from "@/react-app/domains/wodeapp/desktop-local-file"
import { AssistantQuickChoice, parseAssistantQuickChoice, stripAssistantQuickChoiceBlocks } from "@/components/chat/assistant-quick-choice"
import { ArtifactAccessActions } from "@/components/chat/artifact-access-actions"
import { isHiddenAttachmentIntelligenceText } from "@/react-app/domains/wodeapp/wodeapp-attachment-intelligence"
import { stripProviderThinkTags, splitAssistantThinkText } from "@/react-app/domains/wodeapp/assistant-think-text"
import { collapseOversizedHtmlFences } from "@/react-app/domains/wodeapp/wodeapp-assistant-html-fence"
import { isAbortNoiseMessage } from "@/react-app/domains/wodeapp/wodeapp-desktop-diagnostics"
import { isStuckToolAutoContinueText } from "@/react-app/domains/session/surface/stuck-tool-recovery"
import { recoverVisibleMarkdownFromUiParts } from "@/react-app/domains/session/surface/empty-visible-reply-recovery"
import {
  assistantMessageHasAuthoritativeFinalReply,
  buildWodeAppToolActivityPeek,
  collectSurfacedTaskResultProse,
  selectAssistantProseMessageIds,
  settleInFlightToolPartsForIdleSession,
  shouldSurfaceTaskResultFallback,
  summarizeWodeAppToolActivityGroup,
} from "@/react-app/domains/wodeapp/wodeapp-tool-activity"
import { renderUserTextWithResourceChips } from "@/components/chat/sent-asset-mentions"
import { ArtifactList } from "@/components/chat/artifact"
import { TaskSuggestions } from "@/components/chat/task-suggestions"
import { ImageLightbox, type LightboxImage } from "@/components/markdown/image-lightbox"
import {
  DescriptiveButtonContent,
  DescriptiveButtonDescription,
  DescriptiveButtonIcon,
  DescriptiveButtonTitle,
} from "@/components/descriptive-button"
import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@/components/ui/message"
import { Tool } from "@/components/ui/tool"
import {
  isApplyPatchToolPart,
  isBashToolPart,
  isEditToolPart,
  isEnvVarRequestToolPart,
  isGlobToolPart,
  isGrepToolPart,
  isLspToolPart,
  isQuestionToolPart,
  isReadToolPart,
  isSkillToolPart,
  isTodoWriteToolPart,
  isWebFetchToolPart,
  isWebSearchToolPart,
  isWriteToolPart,
} from "@/lib/build-in-tools"
import type { ThreadStatus } from "@/lib/messages"
import {
  collectToolParts,
  getActiveToolLabel,
  isToolPartInFlight,
} from "@/lib/tool-activity"
import { cn } from "@/lib/utils"
import { useOpenTargets } from "@/lib/target-provider"
import type { OpenTarget } from "@/react-app/domains/session/artifacts/open-target"
import { groupMessages, isMessageGroup, getLastTextPart, getAssistantRenderGroups, getFileTitle, getMediaBadge, getMessageCreated, formatMessageTimestamp, type UIMessageWithIndex, getMessagesText } from "./utils"
import {
  buildCompactionRows,
  findCompactionBoundaries,
  formatCompactionElapsed,
  type CompactionBoundary,
} from "@/react-app/domains/wodeapp/wodeapp-compaction-history"

function MessageTimestamp({ message, className }: { message: UIMessage; className?: string }) {
  const created = getMessageCreated(message)
  if (created === null) return null

  return (
    <span
      className={cn(
        "select-none whitespace-nowrap text-[11px] tabular-nums text-muted-foreground/70",
        className
      )}
      title={new Date(created).toLocaleString()}
    >
      {formatMessageTimestamp(created)}
    </span>
  )
}

interface ToolMessageProps {
  part: ToolUIPart | DynamicToolUIPart
}

/**
 * Error boundary around tool-part rendering. Tool inputs from streamed or
 * interrupted runs can violate their type contracts (partial/undefined
 * input); without this boundary a single bad part unmounts the entire app
 * (white screen). Seen in production on v0.15.3 via a todowrite part with
 * missing input.todos.
 */
class ToolMessage extends React.Component<ToolMessageProps, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    console.error("[tool-part] render failed", error)
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="text-xs text-muted-foreground">Tool step unavailable</div>
      )
    }
    return <ToolMessageInner part={this.props.part} />
  }
}

const ToolMessageInner = ({ part }: ToolMessageProps) => {
  if (isBashToolPart(part)) {
    return <BashTool part={part} />
  }

  if (isEditToolPart(part)) {
    return <EditTool part={part} />
  }

  if (isWriteToolPart(part)) {
    return <WriteFileTool part={part} />
  }

  if (isReadToolPart(part)) {
    return <ReadFileTool part={part} />
  }

  if (isGrepToolPart(part)) {
    return <GrepTool part={part} />
  }

  if (isGlobToolPart(part)) {
    return <GlobTool part={part} />
  }

  if (isLspToolPart(part)) {
    return <LspTool part={part} />
  }

  if (isApplyPatchToolPart(part)) {
    return <ApplyPatchTool part={part} />
  }

  if (isSkillToolPart(part)) {
    return <SkillTool part={part} />
  }

  if (isTodoWriteToolPart(part)) {
    return <TodoWriteTool part={part} />
  }

  if (isWebFetchToolPart(part)) {
    return <WebfetchTool part={part} />
  }

  if (isWebSearchToolPart(part)) {
    return <WebsearchTool part={part} />
  }

  if (isQuestionToolPart(part)) {
    return <QuestionTool part={part} />
  }

  if (isEnvVarRequestToolPart(part)) {
    return <EnvVarRequestTool part={part} />
  }

  return <Tool toolPart={part} />
}

function isCompactableToolPart(part: ToolUIPart | DynamicToolUIPart) {
  return !isQuestionToolPart(part) && !isEnvVarRequestToolPart(part)
}

/** Skip file/reasoning spacers when probing neighbors of a compact tool run. */
function probePastToolSpacers(
  groups: ReturnType<typeof getAssistantRenderGroups>,
  start: number,
  direction: -1 | 1,
): number {
  let probe = start
  while (probe >= 0 && probe < groups.length) {
    const kind = groups[probe]?.kind
    if (kind === "file" || kind === "reasoning") {
      probe += direction
      continue
    }
    break
  }
  return probe
}

/** Cursor/Codex-style: thinking is a stacked accordion, not the answer card. */
function ReasoningAccordion({
  text,
  isStreaming,
}: {
  text: string
  isStreaming: boolean
}) {
  // Default collapsed — even while streaming. Auto-open CoT was shoving the
  // answer (1./2./3.) off-screen and looked like the reply "flashed away".
  const [open, setOpen] = React.useState(false)
  const [userToggled, setUserToggled] = React.useState(false)

  React.useEffect(() => {
    if (userToggled) return
    // Stay collapsed when the block finishes unless the user opened it.
    if (!isStreaming) setOpen(false)
  }, [isStreaming, userToggled])

  return (
    <Collapsible
      className="w-full"
      open={open}
      onOpenChange={(next) => {
        setUserToggled(true)
        setOpen(next)
      }}
    >
      <CollapsibleTrigger className="group flex min-h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-start text-[13px] text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground">
        <span className="inline-flex size-4 shrink-0 items-center justify-center">
          {isStreaming ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <ChevronRight className="size-3.5 opacity-70 transition-transform group-data-panel-open:rotate-90" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate">{isStreaming ? "思考中" : "已思考"}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-60 transition-transform group-data-panel-open:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-150 ease-out data-starting-style:h-0 data-ending-style:h-0 [&[hidden]:not([hidden='until-found'])]:hidden">
        {open ? (
          <MessageContent
            className="prose max-h-[min(40vh,360px)] w-full min-w-0 flex-1 overflow-y-auto rounded-lg bg-transparent px-2 py-1.5 text-[13px] leading-5 text-muted-foreground [&_hr]:hidden"
            markdown
            isStreaming={isStreaming}
          >
            {text}
          </MessageContent>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  )
}

function ToolActivityGroup({
  parts,
  mediaParts = [],
  sessionLive = true,
  liveTail = false,
  surfaceTaskResults = false,
}: {
  parts: Array<ToolUIPart | DynamicToolUIPart>
  /** Tool-attachment image previews — shown only when the strip is expanded. */
  mediaParts?: FileUIPart[]
  /** Parent turn still streaming/busy. Idle ⇒ settle in-flight「正在…」. */
  sessionLive?: boolean
  /**
   * Latest activity strip on a live turn (no following prose yet).
   * Keep Codex-style busy chrome between tool gaps while the model continues.
   */
  liveTail?: boolean
  /** Interrupted parent fallback only; never promote task output during/following a real final. */
  surfaceTaskResults?: boolean
}) {
  const [open, setOpen] = React.useState(false)
  // PERF-07: keep busy chrome sticky for a short window so 16–50ms transcript
  // flushes do not flicker the tool strip every frame.
  const [throttledLive, setThrottledLive] = React.useState(sessionLive)
  React.useEffect(() => {
    if (sessionLive) {
      setThrottledLive(true)
      return
    }
    const timer = window.setTimeout(() => setThrottledLive(false), 200)
    return () => window.clearTimeout(timer)
  }, [sessionLive])
  const settledParts = React.useMemo(
    () => settleInFlightToolPartsForIdleSession(parts, throttledLive),
    [parts, throttledLive],
  )
  const { running, failed, summary } = summarizeWodeAppToolActivityGroup(settledParts, {
    sessionLive: throttledLive,
  })
  // Busy = a tool is in-flight, or this is the live trailing strip while the
  // turn continues (Codex keeps the latest row “working” between steps).
  const busy = running || (liveTail && throttledLive && failed === 0)
  // Cursor-style: always show a short content peek under the summary so the
  // strip feels concrete without expanding N identical rows.
  const peekLines = React.useMemo(
    () => buildWodeAppToolActivityPeek(settledParts, { maxLines: 6, maxLineChars: 88 }),
    [settledParts],
  )
  // Completed task answers may rescue an interrupted turn, but must not look
  // like the parent's final reply while execution is live or after a terminal
  // parent reply exists.
  const surfacedTaskResults = React.useMemo(
    () => surfaceTaskResults ? collectSurfacedTaskResultProse(settledParts) : [],
    [settledParts, surfaceTaskResults],
  )

  // Codex-style: muted inline activity strip between prose, not a heavy card of
  // identical "已运行命令" rows. Expand only when the merchant wants details.
  return (
    <div className="flex w-full flex-col gap-1">
      <Collapsible
        className="w-full"
        open={open}
        onOpenChange={setOpen}
      >
        <CollapsibleTrigger
          className="group flex min-h-7 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-start text-[12px] leading-5 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          <span className="inline-flex size-3.5 shrink-0 items-center justify-center">
            {busy ? (
              <LoaderCircle className="size-3 animate-spin text-foreground/55" />
            ) : failed > 0 ? (
              <AlertTriangle className="size-3 text-amber-600" />
            ) : (
              <Check className="size-3 text-emerald-500 dark:text-emerald-400" />
            )}
          </span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              failed > 0 && "text-amber-800",
              busy && "wapp-tool-activity-shimmer",
            )}
            data-tool-activity-busy={busy ? "1" : undefined}
          >
            {summary}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground/70 opacity-0 transition-opacity group-hover:opacity-100 group-data-panel-open:opacity-100">
            {t("session.tool_steps_details")}
          </span>
          <ChevronDown className="size-3 shrink-0 opacity-50 transition-transform group-data-panel-open:rotate-180" />
        </CollapsibleTrigger>
        {!open && peekLines.length > 0 ? (
          <div
            className="ml-[22px] mr-1 overflow-hidden rounded-md border border-border/50 bg-muted/35 px-2 py-1.5 font-mono text-[11px] leading-[1.35] text-muted-foreground"
            data-tool-activity-peek="1"
            aria-hidden
          >
            {peekLines.map((line, index) => (
              <div
                key={`${line.tone}-${index}`}
                className={cn(
                  "min-w-0 truncate whitespace-pre",
                  line.tone === "add" && "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
                  line.tone === "remove" && "bg-rose-500/10 text-rose-800 dark:text-rose-300",
                  line.tone === "meta" && "text-muted-foreground/75",
                )}
              >
                {line.text}
              </div>
            ))}
          </div>
        ) : null}
        <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-150 ease-out data-starting-style:h-0 data-ending-style:h-0 [&[hidden]:not([hidden='until-found'])]:hidden">
          {open ? (
            <div className="flex flex-col gap-1.5 border-l border-border/60 py-1 pl-3 ml-3">
              {mediaParts.length > 0 ? (
                <FileMessageStrip parts={mediaParts} tone="assistant" />
              ) : null}
              {settledParts.map((part) => (
                <ToolMessage key={part.toolCallId} part={part} />
              ))}
            </div>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
      {surfacedTaskResults.map((text, index) => (
        <div
          key={`task-result-${index}`}
          className="w-full min-w-0 px-1"
          data-surfaced-task-result="fallback"
        >
          <div className="mb-1 text-xs text-muted-foreground">子代理结果</div>
          <MessageContent
            className="prose w-full min-w-0 flex-1 cursor-text select-text bg-transparent py-0.5 text-foreground [&_hr]:hidden"
            markdown
          >
            {text}
          </MessageContent>
        </div>
      ))}
    </div>
  )
}

const isEmptyMessage = (message: UIMessage): boolean => message.parts.length === 0

type RetryStatus = Extract<SessionStatus, { type: "retry" }>

function isSessionErrorMessage(message: UIMessage) {
  return message.id.startsWith(SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX)
}

function retryDelaySeconds(status: RetryStatus) {
  return Math.max(0, Math.round((status.next - Date.now()) / 1000))
}

interface FileMessageProps {
  part: FileUIPart
  tone: "user" | "assistant"
}

interface FileMessageStripProps {
  parts: FileUIPart[]
  tone: "user" | "assistant"
}

type FileMessageTargetPart = {
  url: string
  providerMetadata?: unknown
}

function isWodeAppDisplayPlaceholder(part: FileMessageTargetPart) {
  return isStubAttachmentUrl(part.url)
    || Boolean((part as { providerMetadata?: { opencode?: { wodeappAttachmentPlaceholder?: boolean } } }).providerMetadata?.opencode?.wodeappAttachmentPlaceholder)
}

export { canRenderInlineChatImage } from "@/components/chat/message-file-display"

const GENERIC_ATTACHMENT_BASENAME_RE = /^(image|img|photo|screenshot|untitled|picture|paste)(\.(png|jpe?g|gif|webp|heic|bmp))?$/i

function absolutePathFromFileUrl(url: string): string | null {
  const trimmed = url.trim()
  if (!/^file:\/\//i.test(trimmed)) return null
  try {
    const pathname = decodeURIComponent(new URL(trimmed).pathname)
    return /^\/[a-zA-Z]:/.test(pathname) ? pathname.slice(1) : pathname
  } catch {
    return trimmed.replace(/^file:\/\//i, "") || null
  }
}

export function resolveFileMessageOpenTarget(
  part: FileMessageTargetPart,
  title: string,
): OpenTarget {
  const storedUrl = part.url.trim()
  // Only http(s) / file:// / wodeappx-asset: are openable. Never fall back to a
  // generic clipboard basename (image.png) — that opens ~/Downloads/image.png.
  // paste-<stamp>-<id>.ext is OK: Electron open-path resolves it from context packs.
  const shouldUseStoredUrl = isOpenableAttachmentUrl(storedUrl)
  let targetValue = shouldUseStoredUrl ? storedUrl : title
  if (!shouldUseStoredUrl && GENERIC_ATTACHMENT_BASENAME_RE.test(title.trim())) {
    targetValue = ""
  }
  const isRemoteUrl = /^https?:\/\//i.test(targetValue)

  return {
    id: `message-attachment:${targetValue || title}`,
    kind: isRemoteUrl ? "url" : "file",
    value: targetValue,
    name: title,
    preview: isRemoteUrl ? "browser" : "external",
    confidence: 1,
    reason: "message attachment",
  }
}

// TODO: Add tone to the file message
function FileMessage({ part }: FileMessageProps) {
  const [imagePreview, setImagePreview] = React.useState<LightboxImage | null>(null)
  const { onOpenTarget } = useOpenTargets()
  const placeholderSuffix = ".wodeapp-placeholder.txt"
  const isDisplayPlaceholder = isWodeAppDisplayPlaceholder(part)
  const title = isDisplayPlaceholder && part.filename?.endsWith(placeholderSuffix)
    ? part.filename.slice(0, -placeholderSuffix.length)
    : getFileTitle(part)
  const badge = isDisplayPlaceholder
    ? title.split(".").pop()?.toUpperCase() ?? null
    : getMediaBadge(part)
  // Electron renderer cannot paint file:// from the Vite origin. Hydrate local
  // image paths through the desktop bridge into data:image for display, while
  // open still uses the absolute file:// / context-pack path.
  // PERF-05 may leave url="" / wodeappx-local:filename after stripping fat data:image.
  // Scrub placeholders may only keep filename + data:text stub (no displayUrl).
  const directLocalImagePath = part.mediaType.startsWith("image/")
    ? absolutePathFromFileUrl(part.url)
    : null
  const needsLocalResolve = Boolean(
    part.mediaType.startsWith("image/")
    && !directLocalImagePath
    && (
      isSlimmedLocalImageRef(part.url)
      || isStubAttachmentUrl(part.url)
      || isDisplayPlaceholder
    ),
  )
  const slimmedImageName = needsLocalResolve
    ? (filenameFromSlimmedLocalRef(part.url, title) || title)
    : ""
  const [resolvedLocalImagePath, setResolvedLocalImagePath] = React.useState<string | null>(null)
  const [hydratedImageUrl, setHydratedImageUrl] = React.useState<string | null>(null)
  const [hydrateFailed, setHydrateFailed] = React.useState(false)
  React.useEffect(() => {
    let cancelled = false

    const hydrateFromPath = (absolutePath: string) => {
      void readDesktopLocalPathAsDataUrl(absolutePath, part.mediaType).then((dataUrl) => {
        if (cancelled) return
        if (dataUrl?.startsWith("data:image/")) {
          setHydratedImageUrl((current) => (current === dataUrl ? current : dataUrl))
          setHydrateFailed(false)
        } else {
          setHydrateFailed(true)
        }
      }).catch(() => {
        if (!cancelled) setHydrateFailed(true)
      })
    }

    if (directLocalImagePath) {
      setResolvedLocalImagePath((current) => (current === directLocalImagePath ? current : directLocalImagePath))
      setHydratedImageUrl(null)
      setHydrateFailed(false)
      hydrateFromPath(directLocalImagePath)
      return () => {
        cancelled = true
      }
    }

    if (!slimmedImageName) {
      setResolvedLocalImagePath(null)
      setHydratedImageUrl(null)
      setHydrateFailed(false)
      return
    }

    setHydratedImageUrl(null)
    setHydrateFailed(false)
    void resolveDesktopLocalOpenPath(slimmedImageName).then((absolutePath) => {
      if (cancelled) return
      if (!absolutePath) {
        setHydrateFailed(true)
        return
      }
      setResolvedLocalImagePath((current) => (current === absolutePath ? current : absolutePath))
      hydrateFromPath(absolutePath)
    }).catch(() => {
      if (!cancelled) setHydrateFailed(true)
    })

    return () => {
      cancelled = true
    }
  }, [directLocalImagePath, part.mediaType, slimmedImageName])

  const localImagePath = directLocalImagePath || resolvedLocalImagePath
  const displayUrl = hydratedImageUrl || (
    !directLocalImagePath && !slimmedImageName ? part.url : ""
  )
  const isImage = Boolean(
    part.mediaType.startsWith("image/")
    && (
      (displayUrl && canRenderInlineChatImage({ mediaType: part.mediaType, url: displayUrl }))
      || ((directLocalImagePath || slimmedImageName) && !hydrateFailed && !hydratedImageUrl)
      || Boolean(hydratedImageUrl)
      || (isSlimmedLocalImageRef(part.url) && Boolean(slimmedImageName))
    ),
  )
  const openTarget = resolveFileMessageOpenTarget(
    localImagePath
      ? { ...part, url: toFileUrlFromAbsolutePath(localImagePath) || part.url }
      : part,
    title,
  )

  if (isImage) {
    if (!displayUrl) {
      return (
        <div
          className="inline-flex size-[180px] max-w-full items-center justify-center overflow-hidden rounded-lg border border-border/70 bg-muted/20 text-xs text-muted-foreground"
          aria-label={`Loading image: ${title}`}
        >
          加载图片中…
        </div>
      )
    }
    return (
      <>
        <button
          type="button"
          className="inline-flex size-[180px] max-w-full cursor-zoom-in overflow-hidden rounded-lg border border-border/70 bg-muted/20 transition-colors hover:border-border hover:bg-muted/30"
          aria-label={`Open image preview: ${title}`}
          onClick={() => setImagePreview({ src: displayUrl, alt: title })}
        >
          <img
            src={displayUrl}
            alt={title}
            loading="lazy"
            decoding="async"
            className="h-full w-full overflow-hidden rounded-md object-contain p-1"
          />
        </button>
        <ImageLightbox image={imagePreview} allowEdit onClose={() => setImagePreview(null)} />
      </>
    )
  }

  return (
    <button
      type="button"
      title="打开文件"
      className="flex h-auto w-fit min-w-0 max-w-full shrink cursor-pointer items-center justify-start gap-2 rounded-xl border border-border ps-2 pe-4 py-1 text-left text-sm font-medium whitespace-normal transition-colors hover:border-foreground/30 hover:bg-muted/45"
      onClick={() => onOpenTarget?.(openTarget, { external: true })}
    >
      <DescriptiveButtonIcon>
        <FileIcon className="size-6 shrink-0" />
      </DescriptiveButtonIcon>
      <DescriptiveButtonContent className="gap-0">
        <DescriptiveButtonTitle>{title}</DescriptiveButtonTitle>
        {badge ? (
          <DescriptiveButtonDescription className="text-xs">
            {badge}
          </DescriptiveButtonDescription>
        ) : null}
      </DescriptiveButtonContent>
    </button>
  )
}

const FILE_STRIP_COLLAPSE_AFTER = 3

function FileMessageStrip({ parts, tone }: FileMessageStripProps) {
  const [expanded, setExpanded] = React.useState(false)
  if (parts.length === 0) return null

  const attachmentRank = (part: FileUIPart) => {
    const url = part.url.trim()
    if (/^(file:\/\/|https?:\/\/)/i.test(url)) return 4
    if (/^data:image\//i.test(url) || /^blob:/i.test(url)) return 3
    if (/^wodeappx-local:/i.test(url)) return 2
    if (isStubAttachmentUrl(url)) return 1
    return 0
  }

  // Vision-direct turns may keep both a slimmed raw file part and a durable
  // display placeholder for the same filename — show one chip only.
  const dedupedParts = (() => {
    const byName = new Map<string, FileUIPart>()
    for (const part of parts) {
      const name = getFileTitle(part).trim().toLowerCase()
      if (!name) {
        byName.set(`${part.url}-${byName.size}`, part)
        continue
      }
      const existing = byName.get(name)
      if (!existing || attachmentRank(part) > attachmentRank(existing)) {
        byName.set(name, part)
      }
    }
    return [...byName.values()]
  })()

  const isImagePart = (part: FileUIPart) => (
    canRenderInlineChatImage(part)
    || (
      part.mediaType.startsWith("image/")
      && (
        isSlimmedLocalImageRef(part.url)
        || isStubAttachmentUrl(part.url)
      )
      && Boolean(getFileTitle(part))
    )
  )

  const imageParts = dedupedParts.filter(isImagePart)
  const fileParts = dedupedParts.filter((part) => !isImagePart(part))
  const shouldCollapseFiles = fileParts.length > FILE_STRIP_COLLAPSE_AFTER

  const renderHorizontal = (items: FileUIPart[]) => (
    <div
      className={cn(
        "flex w-fit max-w-[85%] snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:thin] sm:max-w-[75%]",
        tone === "user" ? "self-end" : "self-start",
      )}
      role="group"
      aria-label={items.length > 1 ? `${items.length} attachments` : "Attachment"}
    >
      {items.map((part, index) => (
        <div key={`${part.url}-${index}`} className="shrink-0 snap-start">
          <FileMessage part={part} tone={tone} />
        </div>
      ))}
    </div>
  )

  if (!shouldCollapseFiles) {
    return renderHorizontal(dedupedParts)
  }

  return (
    <div
      className={cn(
        "flex w-full min-w-0 max-w-[85%] flex-col gap-1.5 sm:max-w-[75%]",
        tone === "user" ? "self-end items-end" : "self-start items-start",
      )}
    >
      {imageParts.length > 0 ? renderHorizontal(imageParts) : null}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="inline-flex w-fit max-w-full min-w-0 items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 truncate">{fileParts.length} 个文件</span>
      </button>
      {expanded ? (
        <div className="flex max-h-48 w-full min-w-0 flex-col gap-1 overflow-y-auto overscroll-contain">
          {fileParts.map((part, index) => (
            <div key={`${part.url}-list-${index}`} className="min-w-0">
              <FileMessage part={part} tone={tone} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function EmptyMessage({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-[1100px] flex-col items-start gap-2 px-2 md:px-10 text-muted-foreground",
        className
      )}
      {...props}
    >
      {t("session.assistant_empty_response")}
    </div>
  )
}

interface CopyMessageButtonProps {
  messages: UIMessage[]
}

function CopyMessageButton({ messages }: CopyMessageButtonProps) {
  const [copied, setCopied] = React.useState(false)
  const text = React.useMemo(() => getMessagesText(messages), [messages])

  const onCopy = React.useCallback(async () => {
    if (!text) {
      return
    }

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore clipboard failures
    }
  }, [text])

  if (!text) {
    return null
  }

  return (
    <MessageAction tooltip={copied ? "Copied!" : "Copy"}>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Copy message"
        onClick={() => void onCopy()}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </MessageAction>
  )
}

type AssistantMessageProps = {
  message: UIMessage
  isLastMessage: boolean
  isStreaming: boolean
  isLastStep: boolean
  showProse: boolean
  surfaceTaskResults: boolean
}

const AssistantMessage = React.memo(
  ({ message, isStreaming, showProse, surfaceTaskResults }: AssistantMessageProps) => {
    const { showThinking, setPrompt, submitPrompt } = useMessageList()
    // Model sometimes dumps <tool_call> XML into reasoning / <think> then stops
    // with no visible prose. Recover question XML into wodeapp-choices so the
    // transcript is not a blank "frozen" turn.
    const recoveredHiddenMarkdown = React.useMemo(() => {
      if (!showProse) return null
      if (isStreaming) return null
      const visible = getAssistantRenderGroups(message.parts, false)
        .filter((group): group is { kind: "text"; text: string } => group.kind === "text")
        .map((group) => group.text)
        .join("\n\n")
        .trim()
      const hasTool = message.parts.some((part) => String(part.type).includes("tool"))
      if (visible || hasTool) return null
      return recoverVisibleMarkdownFromUiParts(message.parts)
    }, [isStreaming, message.parts, showProse])
    const assistantRenderGroups = React.useMemo(() => {
      const prepareAssistantText = (text: string) =>
        collapseOversizedHtmlFences(stripAssistantQuickChoiceBlocks(text))
      const groups = getAssistantRenderGroups(message.parts, showThinking).map((group) =>
        group.kind === "text"
          ? { ...group, text: prepareAssistantText(group.text) }
          : group
      )
      const visibleGroups = showProse
        ? groups
        : groups.filter((group) => group.kind !== "text" && group.kind !== "reasoning")
      if (!recoveredHiddenMarkdown) return visibleGroups
      const alreadyHasRecovered = groups.some(
        (group) => group.kind === "text" && group.text.includes(recoveredHiddenMarkdown),
      )
      if (alreadyHasRecovered) return visibleGroups
      return [
        ...visibleGroups,
        { kind: "text" as const, text: prepareAssistantText(recoveredHiddenMarkdown) },
      ]
    }, [message.parts, recoveredHiddenMarkdown, showProse, showThinking])
    const assistantText = React.useMemo(() => {
      if (!showProse) return ""
      const visible = getAssistantRenderGroups(message.parts, false)
        .filter((group): group is Extract<(typeof assistantRenderGroups)[number], { kind: "text" }> => group.kind === "text")
        .map((group) => group.text)
        .join("\n\n")
      if (visible.trim()) return visible
      return recoveredHiddenMarkdown || ""
    }, [message.parts, recoveredHiddenMarkdown, showProse])
    const quickChoiceSpec = React.useMemo(
      () => (isStreaming ? null : parseAssistantQuickChoice(assistantText)),
      [assistantText, isStreaming]
    )

    if (assistantRenderGroups.length === 0 && !quickChoiceSpec) return null

    return (
      <Message
        className="mx-auto flex w-full max-w-[1100px] flex-col items-start gap-2 px-2 md:px-10"
        data-message-id={message.id}
        data-message-role={message.role}
      >
        <div className="group flex w-full flex-col gap-1.5">
          {assistantRenderGroups.map((group, index) => {
            if (group.kind === "text") {
              return (
                <MessageContent
                  key={`text-${index}`}
                  className="prose w-full min-w-0 flex-1 cursor-text select-text bg-transparent px-1 py-0.5 text-foreground [&_hr]:hidden"
                  markdown
                  isStreaming={isStreaming}
                >
                  {group.text}
                </MessageContent>
              )
            }

            if (group.kind === "reasoning") {
              // Thinking inside a compact tool run is noise — the activity strip
              // already covers the run. Keep reasoning that sits outside tools.
              const before = probePastToolSpacers(assistantRenderGroups, index - 1, -1)
              const after = probePastToolSpacers(assistantRenderGroups, index + 1, 1)
              const beforeTool =
                before >= 0
                && assistantRenderGroups[before]?.kind === "tool"
                && isCompactableToolPart(
                  (assistantRenderGroups[before] as Extract<(typeof assistantRenderGroups)[number], { kind: "tool" }>).part,
                )
              const afterTool =
                after < assistantRenderGroups.length
                && assistantRenderGroups[after]?.kind === "tool"
                && isCompactableToolPart(
                  (assistantRenderGroups[after] as Extract<(typeof assistantRenderGroups)[number], { kind: "tool" }>).part,
                )
              if (beforeTool && afterTool) return null

              return (
                <ReasoningAccordion
                  key={`reasoning-${index}`}
                  text={group.text}
                  isStreaming={group.isStreaming}
                />
              )
            }

            if (group.kind === "file") {
              // Codex/Cursor: tool attachment previews are not full-bleed
              // transcript images. session-sync expands tool.attachments into
              // sibling file parts (tool → file → tool → file), which used to
              // break compact grouping and shove the answer off-screen.
              let probe = index - 1
              while (probe >= 0 && assistantRenderGroups[probe]?.kind === "file") probe -= 1
              if (assistantRenderGroups[probe]?.kind === "tool") return null

              if (assistantRenderGroups[index - 1]?.kind === "file") return null

              const parts: FileUIPart[] = []
              for (let fileIndex = index; fileIndex < assistantRenderGroups.length; fileIndex += 1) {
                const item = assistantRenderGroups[fileIndex]
                if (item.kind !== "file") break
                parts.push(item.part)
              }

              return (
                <div key={`file-${index}`} className="w-full">
                  <FileMessageStrip parts={parts} tone="assistant" />
                </div>
              )
            }

            if (group.kind === "tool" && isCompactableToolPart(group.part)) {
              const previousProbe = probePastToolSpacers(assistantRenderGroups, index - 1, -1)
              const previous = previousProbe >= 0 ? assistantRenderGroups[previousProbe] : undefined
              // Skip tools already absorbed into an earlier compact strip
              // (allow intervening tool-attachment file parts and thinking).
              if (previous?.kind === "tool" && isCompactableToolPart(previous.part)) return null

              const parts: Array<ToolUIPart | DynamicToolUIPart> = []
              const mediaParts: FileUIPart[] = []
              let cursor = index
              for (; cursor < assistantRenderGroups.length; cursor += 1) {
                const item = assistantRenderGroups[cursor]
                if (item.kind === "tool" && isCompactableToolPart(item.part)) {
                  parts.push(item.part)
                  continue
                }
                if (item.kind === "file" || item.kind === "reasoning") {
                  if (item.kind === "file") mediaParts.push(item.part)
                  continue
                }
                break
              }

              const nextGroup = assistantRenderGroups[cursor]
              const followingVisibleProse = Boolean(
                nextGroup
                && nextGroup.kind === "text"
                && assistantTextHasVisibleProse(nextGroup.text),
              )

              // Always one collapsed strip — even a single tool. Expand for
              // details / previews (Codex activity row).
              return (
                <ToolActivityGroup
                  key={`tool-group-${index}`}
                  parts={parts}
                  mediaParts={mediaParts}
                  sessionLive={isStreaming}
                  liveTail={isStreaming && !followingVisibleProse}
                  surfaceTaskResults={surfaceTaskResults}
                />
              )
            }

            if (group.kind === "tool") {
              const [settled] = settleInFlightToolPartsForIdleSession([group.part], isStreaming)
              return (
                <div key={`tool-${index}`} className="w-full">
                  <ToolMessage part={settled ?? group.part} />
                </div>
              )
            }

            return null
          })}
          {quickChoiceSpec ? (
            <AssistantQuickChoice
              spec={quickChoiceSpec}
              onSetPrompt={setPrompt}
              onSubmitPrompt={submitPrompt}
            />
          ) : null}
          <ArtifactAccessActions message={message} />
        </div>
      </Message>
    )
  }
)

AssistantMessage.displayName = "AssistantMessage"

type UserMessageProps = {
  message: UIMessage
  isStreaming: boolean
}

const USER_SKILL_TOKEN_RE = /(Load \[skill [^\]]+\] and follow its instructions\.|\[skill [^\]]+\])/

function UserSkillChip(props: { name: string }) {
  return (
    <span className="mx-0.5 inline-flex max-w-full items-center overflow-hidden text-ellipsis whitespace-nowrap rounded-full border border-violet-6/35 bg-violet-3/20 px-2.5 py-1 text-xs font-medium text-violet-11 align-middle" title={`Skill: ${props.name}`}>
      {props.name}
    </span>
  )
}

function renderUserTextWithSkillChips(text: string) {
  if (!USER_SKILL_TOKEN_RE.test(text)) return text
  let offset = 0
  return text.split(USER_SKILL_TOKEN_RE).map((segment) => {
    const key = `${offset}:${segment}`
    offset += segment.length
    const skillMatch = segment.match(/^(?:Load )?\[skill ([^\]]+)\](?: and follow its instructions\.)?$/)
    if (skillMatch?.[1]) return <UserSkillChip key={key} name={skillMatch[1]} />
    return <React.Fragment key={key}>{segment}</React.Fragment>
  })
}

const UserMessage = React.memo(
  ({ message, isStreaming }: UserMessageProps) => {
    const { onRevertToUserMessage, onForkAtMessage, onEditUserMessage } = useMessageList()
    const messageText = React.useMemo(() => getMessagesText([message]), [message])
    const fileParts = React.useMemo(
      () => message.parts.filter(isFileUIPart),
      [message.parts],
    )
    const visibleText = React.useMemo(
      () =>
        stripProviderThinkTags(
          message.parts
            .filter(
              (part) =>
                part.type === "text" &&
                part.text &&
                !isHiddenAttachmentIntelligenceText(part.text) &&
                !isStuckToolAutoContinueText(part.text),
            )
            .map((part) => (part.type === "text" ? part.text : ""))
            .join(""),
        ).trim(),
      [message.parts],
    )
    // System auto-continue / hidden synthetic user turns must not leave an empty bubble.
    if (!visibleText && fileParts.length === 0) return null

    return (
      <Message
        className="mx-auto flex w-full max-w-[1100px] flex-col items-end gap-2 px-2 md:px-10"
        data-message-id={message.id}
        data-message-role={message.role}
      >
        <ContextMenu>
          <ContextMenuTrigger
            render={
              <div className="group relative flex w-full flex-col items-end gap-1">
                <FileMessageStrip parts={fileParts} tone="user" />
                {visibleText ? (
                  <MessageContent
                    layoutId={message.id}
                    className="bg-muted text-foreground min-w-0 max-w-[85%] cursor-text select-text break-words rounded-3xl px-5 py-2.5 whitespace-pre-wrap sm:max-w-[75%]"
                  >
                    {renderUserTextWithResourceChips(
                      visibleText,
                      renderUserTextWithSkillChips,
                    )}
                  </MessageContent>
                ) : null}
                {!isStreaming && (
                  <MessageActions
                    className={cn(
                      "pointer-events-auto absolute right-0 top-[calc(100%-1px)] z-10 flex items-center gap-0 rounded-lg bg-background/95 opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100 hover:opacity-100 focus-within:opacity-100"
                    )}
                  >
                    <MessageTimestamp message={message} className="mr-1.5" />
                    <CopyMessageButton messages={[message]} />
                    {messageText ? (
                      <MessageAction tooltip="Edit message">
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Edit message"
                          onClick={() => onEditUserMessage(message.id, messageText)}
                        >
                          <Pencil />
                        </Button>
                      </MessageAction>
                    ) : null}
                    <MessageAction tooltip="Branch in new chat">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Branch in new chat"
                        onClick={() => onForkAtMessage(message.id)}
                      >
                        <Split className="rotate-90" />
                      </Button>
                    </MessageAction>
                  </MessageActions>
                )}
              </div>
            }
          />
          <ContextMenuContent className="w-56">
            {messageText ? (
              <ContextMenuItem onClick={() => onEditUserMessage(message.id, messageText)}>
                <Pencil className="size-4" />
                Edit message
              </ContextMenuItem>
            ) : null}
            {messageText ? (
              <ContextMenuItem onClick={() => void navigator.clipboard.writeText(messageText)}>
                <Copy className="size-4" />
                Copy
              </ContextMenuItem>
            ) : null}
            <ContextMenuItem onClick={() => onForkAtMessage(message.id)}>
              <Split className="size-4 rotate-90" />
              Branch in new chat
            </ContextMenuItem>
            <ContextMenuItem
              className="text-amber-11 focus:text-amber-11"
              onClick={() => onRevertToUserMessage(message.id)}
            >
              <Undo2 className="size-4" />
              {t("session.revert_label")}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Message>
    )
  }
)

UserMessage.displayName = "UserMessage"

type MessageComponentProps = {
  message: UIMessage
  isLastMessage: boolean
  isStreaming: boolean
  isLastStep: boolean
  showProse: boolean
  surfaceTaskResults: boolean
}

const MessageComponent = React.memo(
  ({ message, isLastMessage, isStreaming, isLastStep, showProse, surfaceTaskResults }: MessageComponentProps) => {
    if (isSessionErrorMessage(message)) {
      return <ErrorMessage error={getMessagesText([message]) || "Session failed"} />
    }

    // A message.updated event creates an empty assistant shell before
    // its parts arrive. Never render that transport shell on its own; the
    // group-level fallback below handles the genuinely empty completed turn.
    if (isEmptyMessage(message)) {
      return null
    }

    if (message.role === "assistant") {
      return (
        <AssistantMessage
          message={message}
          isLastMessage={isLastMessage}
          isStreaming={isStreaming}
          isLastStep={isLastStep}
          showProse={showProse}
          surfaceTaskResults={surfaceTaskResults}
        />
      )
    }

    return (
      <UserMessage
        message={message}
        isStreaming={isStreaming}
      />
    )
  }
)

MessageComponent.displayName = "MessageComponent"

const LoadingMessage = React.memo(({ label }: { label?: string }) => {
  const statusLabel = label ?? t("wodeappx.status.thinking")

  return (
    <Message className="mx-auto flex w-full max-w-[1100px] flex-col items-start gap-2 px-2 md:px-10">
      <div className="group flex w-full flex-col gap-0">
        <div
          aria-label={statusLabel}
          aria-live="polite"
          role="status"
          className="flex min-w-0 max-w-full items-center gap-2 px-1 py-1 text-[13px] font-normal leading-5 text-muted-foreground"
        >
          <span aria-hidden="true" className="relative size-4 shrink-0">
            <span className="absolute inset-0 rounded-full bg-[conic-gradient(from_20deg,#818cf8,#fb7185,#fbbf24,#34d399,#818cf8)] motion-safe:animate-spin" />
            <span className="absolute inset-[3px] rounded-full bg-background" />
            <span className="absolute inset-[6px] rounded-full bg-primary motion-safe:animate-pulse" />
          </span>
          <span className="min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap">{statusLabel}</span>
          {!label && (
            <span aria-hidden="true" className="flex shrink-0 items-center gap-1">
              <span className="size-1 rounded-full bg-current motion-safe:animate-pulse" />
              <span className="size-1 rounded-full bg-current motion-safe:animate-pulse [animation-delay:160ms]" />
              <span className="size-1 rounded-full bg-current motion-safe:animate-pulse [animation-delay:320ms]" />
            </span>
          )}
        </div>
      </div>
    </Message>
  )
})

LoadingMessage.displayName = "LoadingMessage"

/** Keep the last visible assistant prose on screen while the live turn briefly blanks. */
function getLastUserMessageId(messages: UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return messages[index]?.id ?? ""
    }
  }
  return ""
}

/**
 * After the latest user message, the turn still needs a final assistant reply.
 * Tool-round gaps often flip ThreadStatus to ready while OpenCode emits an empty
 * assistant shell (ses_02ffe542 / ses_0490d614) — UI must keep Thinking, not
 * 「代理未返回任何内容」.
 */
function liveTurnLacksAuthoritativeFinalReply(messages: UIMessage[]): boolean {
  let lastUserIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index
      break
    }
  }
  if (lastUserIndex < 0) return false
  for (let index = lastUserIndex + 1; index < messages.length; index += 1) {
    const message = messages[index]
    if (!message || message.role !== "assistant") continue
    if (assistantMessageHasAuthoritativeFinalReply(message)) return false
  }
  return true
}

function readAssistantOpencodeMeta(message: UIMessage): {
  finish: string
  completed: number | null
} {
  const metadata = message.metadata && typeof message.metadata === "object"
    ? (message.metadata as Record<string, unknown>)
    : null
  const opencode = metadata?.opencode && typeof metadata.opencode === "object"
    ? (metadata.opencode as Record<string, unknown>)
    : null
  const finish = typeof opencode?.finish === "string" ? opencode.finish.trim().toLowerCase() : ""
  const completed = typeof opencode?.completed === "number" && Number.isFinite(opencode.completed)
    ? opencode.completed
    : null
  return { finish, completed }
}

/** Empty shell that already terminal-finished — the only case that may show EmptyMessage. */
function isTerminalCompletedEmptyAssistant(message: UIMessage): boolean {
  if (message.role !== "assistant") return false
  if (message.parts.length > 0) return false
  const { finish, completed } = readAssistantOpencodeMeta(message)
  if (completed == null) return false
  return finish === "stop"
    || finish === "length"
    || finish === "content-filter"
    || finish === "content_filter"
    || finish === "end-turn"
    || finish === "end_turn"
    || finish === "completed"
}

function assistantTextHasVisibleProse(text: string): boolean {
  return stripProviderThinkTags(text).trim().length > 0
}

/** True when the live turn already has a reasoning accordion to show (no blank Waiting). */
function hasLiveReasoningPreview(messages: UIMessage[]): boolean {
  let lastUserIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index
      break
    }
  }
  for (const message of messages.slice(lastUserIndex + 1)) {
    if (message.role !== "assistant") continue
    for (const part of message.parts) {
      const partType = String(part.type)
      if (partType === "reasoning" && "text" in part && typeof part.text === "string" && part.text.trim()) {
        return true
      }
      if (partType === "text" && "text" in part && typeof part.text === "string") {
        const segments = splitAssistantThinkText(part.text, part.state === "streaming")
        if (segments?.some((segment) => segment.kind === "reasoning" && segment.text.trim())) {
          return true
        }
      }
    }
  }
  return false
}

function getLiveTurnAssistantProse(messages: UIMessage[]): string {
  let lastUserIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index
      break
    }
  }
  const chunks: string[] = []
  for (const message of messages.slice(lastUserIndex + 1)) {
    if (message.role !== "assistant") continue
    for (const part of message.parts) {
      if (part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0) {
        // Provider <think> is not user-visible; sticky/waiting must ignore it
        // or think-only streams hide Thinking… and leave a blank gap.
        const visible = stripProviderThinkTags(part.text).trim()
        if (visible) chunks.push(visible)
      }
    }
  }
  return chunks.join("\n\n").trim()
}

const StickyAssistantProsePlaceholder = React.memo(({ text }: { text: string }) => (
  <Message className="mx-auto flex w-full max-w-[1100px] flex-col items-start gap-2 px-2 md:px-10">
    <div className="group flex w-full flex-col gap-2">
      <MessageContent
        className="prose w-full min-w-0 flex-1 cursor-text select-text bg-transparent px-1 py-0.5 text-foreground opacity-90 [&_hr]:hidden"
        markdown
      >
        {text}
      </MessageContent>
      <div className="flex items-center gap-1.5 px-1 text-[12px] font-normal leading-5 text-muted-foreground">
        <span aria-hidden="true" className="relative size-3.5 shrink-0">
          <span className="absolute inset-0 rounded-full bg-[conic-gradient(from_20deg,#818cf8,#fb7185,#fbbf24,#34d399,#818cf8)] motion-safe:animate-spin" />
          <span className="absolute inset-[2.5px] rounded-full bg-background" />
          <span className="absolute inset-[5px] rounded-full bg-primary motion-safe:animate-pulse" />
        </span>
        <span>Continuing…</span>
      </div>
    </div>
  </Message>
))

StickyAssistantProsePlaceholder.displayName = "StickyAssistantProsePlaceholder"

interface ErrorMessageProps {
  error: string | null
}

function formatSessionErrorText(raw: string): string {
  const text = String(raw || "").trim()
  if (!text) return "Session failed"
  if (/AUTH_REQUIRED|credit_error|请先登录/i.test(text)) {
    const lang = typeof document !== "undefined" ? document.documentElement.getAttribute("lang") || "" : ""
    return lang === "zh" ? "请先登录后再发送" : "Sign in to continue."
  }
  const jsonStart = text.indexOf("{")
  if (jsonStart >= 0) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart)) as { error?: { message?: string }; message?: string }
      const message = parsed?.error?.message || parsed?.message
      if (typeof message === "string" && message.trim()) return message.trim()
    } catch {
      /* keep original */
    }
  }
  return text
}

function ErrorMessage({ error }: ErrorMessageProps) {
  const text = formatSessionErrorText(String(error || "").trim() || "Session failed")
  // Manual stop / cancel is not a hard failure — keep a quiet chip, not a full-width banner.
  const abortNoise = isAbortNoiseMessage(text)

  return (
    <Message className="not-prose mx-auto flex w-full max-w-[1100px] flex-col items-start gap-1 px-0 md:px-10">
      <div className="group flex w-full flex-col items-start gap-0">
        {abortNoise ? (
          <div
            className="inline-flex max-w-full items-center gap-1 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[11px] leading-4 text-muted-foreground"
            data-abort-noise="1"
            title="已手动暂停"
          >
            <AlertTriangle className="size-2.5 shrink-0 opacity-70" />
            <span className="min-w-0 truncate">已暂停</span>
          </div>
        ) : (
          <div className="text-foreground flex w-auto max-w-full min-w-0 flex-row items-start gap-1.5 overflow-hidden rounded-md border border-red-300/70 bg-red-300/15 px-1.5 py-0.5">
            <AlertTriangle className="mt-0.5 size-3 shrink-0 text-destructive" />
            <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-[12px] leading-4 text-destructive">
              {text}
            </p>
          </div>
        )}
      </div>
    </Message>
  )
}

interface RetryMessageProps {
  status: RetryStatus
}

function RetryActionButton(props: { link: string; label: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 border-amber-500/70 bg-amber-50 text-xs text-amber-950 hover:bg-amber-100"
      onClick={() => void openDesktopUrl(props.link)}
    >
      {props.label}
    </Button>
  )
}

const RetryMessage = React.memo(({ status }: RetryMessageProps) => {
  const [seconds, setSeconds] = React.useState(() => retryDelaySeconds(status))

  React.useEffect(() => {
    const update = () => setSeconds(retryDelaySeconds(status))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [status])

  const info = seconds > 0
    ? `Retrying in ${seconds}s · attempt ${status.attempt}`
    : `Retrying · attempt ${status.attempt}`
  const action = status.action

  return (
    <Message className="not-prose mx-auto flex w-full max-w-[1100px] flex-col items-start gap-2 px-0 md:px-10">
      <div className="group flex w-full flex-col items-start gap-0">
        <div className="text-foreground flex w-full min-w-0 max-w-full flex-1 flex-col gap-2 overflow-hidden rounded-lg border-2 border-amber-300 bg-amber-300/20 px-3 py-2">
          <div className="flex items-start gap-2">
            <LoaderCircle size={16} className="mt-0.5 shrink-0 animate-spin text-amber-700" />
            <div className="min-w-0 space-y-1">
              <p className="whitespace-pre-wrap break-words text-sm font-medium text-amber-900">{status.message}</p>
              <p className="break-words text-xs text-amber-800">{info}</p>
            </div>
          </div>
          {action ? (
            <div className="ml-6 space-y-1 border-t border-amber-400/60 pt-2">
              <p className="break-words text-xs font-medium text-amber-950">{action.title}</p>
              <p className="break-words text-xs text-amber-900">{action.message}</p>
              {action.link ? (
                <RetryActionButton link={action.link} label={action.label} />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </Message>
  )
})

RetryMessage.displayName = "RetryMessage"

const isMessageEmptyGroup = (messages: UIMessageWithIndex[]) =>
  messages.every(message => isEmptyMessage(message.message));

const getRenderableMessages = (messages: UIMessageWithIndex[]) =>
  messages.flatMap((item) => {
    const renderableMessage = getRenderableMessage(item.message);

    return renderableMessage ? [{ ...item, message: renderableMessage }] : []
  })

function getRenderableMessage(message: UIMessage) {
  const parts = message.parts.filter((part) => part.type === "text" || part.type === "file");
  if (parts.length > 0) {
    // Think-only text is not user-visible; fall through to recovery when the
    // visible prose is empty and there is no file part.
    const hasFile = parts.some((part) => part.type === "file");
    const visibleText = parts
      .filter((part) => part.type === "text" && "text" in part && typeof part.text === "string")
      .map((part) => (part as { text: string }).text)
      .join("\n")
      .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, " ")
      .replace(/<think\b[^>]*>[\s\S]*$/i, " ")
      .trim();
    if (hasFile || visibleText) {
      return { ...message, parts };
    }
  }

  const recovered = recoverVisibleMarkdownFromUiParts(message.parts);
  if (recovered) {
    return {
      ...message,
      parts: [{ type: "text" as const, text: recovered }],
    };
  }

  return null;
}

/**
 * Tool-only assistant messages (no visible prose/file) that can fold into one
 * Codex activity strip. Returns null when the message must render on its own.
 */
function collectCompactableToolPartsFromMessage(
  message: UIMessage,
): Array<ToolUIPart | DynamicToolUIPart> | null {
  if (getRenderableMessage(message)) return null
  const tools = getAssistantRenderGroups(message.parts, false).flatMap((group) =>
    group.kind === "tool" ? [group.part] : [],
  )
  if (tools.length === 0) return null
  if (!tools.every(isCompactableToolPart)) return null
  return tools
}

type AssistantGroupSegment =
  | { kind: "tool-run"; parts: Array<ToolUIPart | DynamicToolUIPart> }
  | { kind: "messages"; items: UIMessageWithIndex[] }

/** Collapse consecutive tool-only messages anywhere in the turn, not only leading. */
function buildAssistantGroupSegments(items: UIMessageWithIndex[]): AssistantGroupSegment[] {
  const segments: AssistantGroupSegment[] = []
  let toolParts: Array<ToolUIPart | DynamicToolUIPart> = []
  let messageBuf: UIMessageWithIndex[] = []

  const flushTools = () => {
    if (toolParts.length === 0) return
    segments.push({ kind: "tool-run", parts: toolParts })
    toolParts = []
  }
  const flushMessages = () => {
    if (messageBuf.length === 0) return
    segments.push({ kind: "messages", items: messageBuf })
    messageBuf = []
  }

  for (const item of items) {
    const compact = collectCompactableToolPartsFromMessage(item.message)
    if (compact) {
      flushMessages()
      toolParts.push(...compact)
      continue
    }
    flushTools()
    messageBuf.push(item)
  }
  flushTools()
  flushMessages()
  return segments
}

const MessageArtifacts = React.memo(function MessageArtifacts(props: { message: UIMessage }) {
  // Tool-only write/edit steps already show "Updated compose.py" — don't also chip the source file.
  const hasAssistantProse = props.message.parts.some(
    (part) => part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0,
  );
  if (props.message.role === "assistant" && !hasAssistantProse) return null;
  return <ArtifactList messages={[props.message]} includeTargetFallbacks={false} />;
});

MessageArtifacts.displayName = "MessageArtifacts";

interface AssistantMessageGroupProps {
  items: UIMessageWithIndex[]
  messages: UIMessage[]
  isStreaming: boolean
}

function MessageGroupImpl({
  items,
  messages,
  isStreaming,
}: AssistantMessageGroupProps) {
  const { onForkAtMessage } = useMessageList()
  const lastItem = items[items.length - 1]
  // Branch must target a real server-side message id. Synthetic
  // client-side messages (e.g. session errors) don't exist on the server and
  // silently corrupt fork boundaries.
  const lastRealItem = items.findLast((item) => !isSessionErrorMessage(item.message))
  const isLiveGroup = isStreaming && lastItem !== undefined && lastItem.index === messages.length - 1
  const visibleProseMessageIds = new Set(
    selectAssistantProseMessageIds(items.map(({ message }) => message))
  )
  const hasAuthoritativeFinalReply = items.some(({ message }) =>
    assistantMessageHasAuthoritativeFinalReply(message)
  )
  const surfaceTaskResults = shouldSurfaceTaskResultFallback({
    sessionLive: isLiveGroup,
    hasAuthoritativeFinalReply,
  })
  const stepsRef = React.useRef<HTMLDivElement>(null)

  // Keep the capped step run near the latest step while streaming, but only
  // when already near the bottom. Blind pin-to-end made earlier tool rows
  // (especially media previews) vanish mid-turn — same "闪没" as main sticky.
  React.useEffect(() => {
    const node = stepsRef.current
    if (!node || !isLiveGroup) return

    const pinToLatestIfSticky = () => {
      const gap = node.scrollHeight - node.scrollTop - node.clientHeight
      if (gap <= 48) {
        node.scrollTop = node.scrollHeight
      }
    }
    pinToLatestIfSticky()

    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(pinToLatestIfSticky)
    observer.observe(node)
    return () => observer.disconnect()
  }, [isLiveGroup])

  if (!lastItem || isMessageEmptyGroup(items)) {
    // Empty transport shells (message.updated before parts) are normal while
    // streaming/submitted. Painting「代理未返回任何内容」here races the OpenWork
    // Thinking spinner and flashes a false blank finish (ses_0490d614 /
    // ses_02ffe542*). Between tool rounds ThreadStatus can briefly be ready
    // while the live turn still lacks an authoritative final reply — keep the
    // gap empty so MessageList Waiting ("思考中") stays visible with the user
    // bubble, never the false empty-response copy.
    if (isStreaming) {
      return null;
    }
    const isTrailingGroup = lastItem !== undefined && lastItem.index === messages.length - 1
    if (
      isTrailingGroup
      && liveTurnLacksAuthoritativeFinalReply(messages)
      && !isTerminalCompletedEmptyAssistant(lastItem.message)
    ) {
      return null;
    }

    return <EmptyMessage />
  }

  const renderableItems = getRenderableMessages(items)
    .filter(({ message }) => visibleProseMessageIds.has(message.id))
  const lastTextMessage = getLastTextPart(lastItem.message)
  // Keep copy/actions on finished turns even while a newer reply is streaming.
  // Only the live group should hide its chrome mid-generation.
  const showGroupActions = Boolean(lastTextMessage) && !isLiveGroup

  // Collapse consecutive tool-only messages anywhere in the turn into one
  // Codex activity strip (not only leading steps before first prose).
  const groupSegments = buildAssistantGroupSegments(items)
  const stepsScrollSegmentIndex = groupSegments.findIndex(
    (segment) =>
      segment.kind === "messages"
      && segment.items.every((item) => !getRenderableMessage(item.message)),
  )

  const renderItem = (item: UIMessageWithIndex, groupIndex: number) => {
    const isLastMessage = item.index === messages.length - 1
    const showProse = visibleProseMessageIds.has(item.message.id)

    return (
      <div key={item.message.id}>
        <MessageComponent
          message={item.message}
          isLastMessage={isLastMessage}
          isStreaming={isLastMessage && isStreaming}
          isLastStep={groupIndex === items.length - 1}
          showProse={showProse}
          surfaceTaskResults={surfaceTaskResults}
        />
        {showProse ? <MessageArtifacts message={item.message} /> : null}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "group/message-group relative flex flex-col gap-2",
        // Reserve space inside the hover target so older replies' copy bar is
        // not covered by the next user bubble (absolute overflow + sibling paint).
        showGroupActions && "pb-9",
      )}
    >
      {groupSegments.map((segment, segmentIndex) => {
        if (segment.kind === "tool-run") {
          const laterBusyContent = groupSegments.slice(segmentIndex + 1).some((next) => {
            if (next.kind === "tool-run") return true
            if (next.kind !== "messages") return false
            return next.items.some((item) => visibleProseMessageIds.has(item.message.id))
          })
          return (
            <Message
              key={`tool-run-${segmentIndex}`}
              className="mx-auto flex w-full max-w-[1100px] flex-col items-start gap-1 px-2 md:px-10"
            >
              <ToolActivityGroup
                parts={segment.parts}
                sessionLive={isLiveGroup}
                liveTail={isLiveGroup && !laterBusyContent}
                surfaceTaskResults={surfaceTaskResults}
              />
            </Message>
          )
        }

        const onlyNonProse = segment.items.every((item) => !getRenderableMessage(item.message))
        if (onlyNonProse) {
          return (
            <div
              key={`steps-${segmentIndex}`}
              ref={segmentIndex === stepsScrollSegmentIndex ? stepsRef : undefined}
              data-scrollable="steps"
              className="max-h-[520px] overflow-y-auto"
            >
              {segment.items.map((item) => renderItem(item, item.index))}
            </div>
          )
        }

        return (
          <React.Fragment key={`messages-${segmentIndex}`}>
            {segment.items.map((item) => renderItem(item, item.index))}
          </React.Fragment>
        )
      })}
      {showGroupActions ? (
        <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-10 mx-auto flex w-full max-w-[1100px] flex-wrap items-center gap-2 px-2 opacity-0 transition-opacity duration-150 group-hover/message-group:opacity-100 hover:opacity-100 focus-within:opacity-100 md:px-10">
          <MessageActions className="flex gap-0 rounded-lg bg-background/95 shadow-sm">
            <CopyMessageButton messages={renderableItems.map((item) => item.message)} />
            {lastRealItem ? (
              <>
                <MessageAction tooltip="Branch in new chat">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Branch in new chat"
                    onClick={() => onForkAtMessage(lastRealItem.message.id)}
                  >
                    <Split className="rotate-90" />
                  </Button>
                </MessageAction>
              </>
            ) : null}
          </MessageActions>
          <MessageTimestamp message={lastItem.message} />
          {/* <MessageSources messages={items.map((item) => item.message)} /> */}
        </div>
      ) : null}
    </div>
  )
}

const MessageGroup = React.memo(
  MessageGroupImpl,
  (previous, next) => {
    if (previous.isStreaming !== next.isStreaming) return false;
    if (previous.messages.length !== next.messages.length) return false;
    if (previous.items.length !== next.items.length) return false;
    for (let index = 0; index < previous.items.length; index += 1) {
      const previousItem = previous.items[index];
      const nextItem = next.items[index];
      if (
        previousItem?.index !== nextItem?.index
        || previousItem?.message !== nextItem?.message
      ) {
        return false;
      }
    }
    return true;
  },
);

MessageGroup.displayName = "MessageGroup";

interface MessageListProps {
  messages: UIMessage[]
  status: ThreadStatus
  retryStatus?: RetryStatus | null
  onStartBuiltinAgent?: (agent: import("@/react-app/domains/wodeapp/runtime-projects").WodeAppBuiltinAgent) => void
  attachmentActivityLabel?: string | null
  historyKey?: string
  /** Fetch older messages from the server once the local window is fully expanded. */
  onLoadEarlierHistory?: () => Promise<{ added: number; exhausted: boolean } | void> | void
  /** Server reported that a larger limit returned fewer messages than requested. */
  historyExhausted?: boolean
}

import {
  lastUserMessageId,
  shouldClearHistoryWindowAnchorOnAppend,
} from "@/react-app/domains/session/surface/scroll-on-send"
import {
  HISTORY_LOAD_ROOT_MARGIN,
  INITIAL_HISTORY_WINDOW,
  adjustLoadedHistoryCountOnMessageGrowth,
  findTranscriptScrollParent,
  nextLoadedHistoryCount,
  scrollTopAfterPrepend,
} from "./message-list-history-window"

type TranscriptRenderItem = ReturnType<typeof groupMessages>[number]

function transcriptItemLastIndex(item: TranscriptRenderItem): number {
  if (isMessageGroup(item)) return item.messages.at(-1)?.index ?? -1
  return item.index
}

/**
 * Codex-style compaction strip: after 压缩上下文, earlier turns fold into one
 * muted「已处理 xx」row; expand to inspect the folded history. The summary
 * answer keeps rendering below as the normal assistant reply.
 */
function CompactionHistoryStrip({
  boundary,
  children,
}: {
  boundary: CompactionBoundary
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const label = boundary.elapsedMs !== null
    ? `已处理 ${formatCompactionElapsed(boundary.elapsedMs)}`
    : "已处理更早的上下文"

  return (
    <div className="mx-auto flex w-full max-w-[1100px] flex-col px-2 md:px-10">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          className="group flex min-h-7 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-start text-[12px] leading-5 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        >
          <History className="size-3.5 shrink-0 opacity-60" />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60 transition-transform group-data-panel-open:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-150 ease-out data-starting-style:h-0 data-ending-style:h-0 [&[hidden]:not([hidden='until-found'])]:hidden">
          {open ? (
            <div className="flex flex-col gap-3 pb-1 pt-2">{children}</div>
          ) : null}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

export function MessageList({
  messages,
  status,
  retryStatus,
  onStartBuiltinAgent,
  attachmentActivityLabel,
  historyKey,
  onLoadEarlierHistory,
  historyExhausted = false,
}: MessageListProps) {
  const isStreaming = status === "submitted" || status === "streaming" || status === "retrying"
  const [loadedCount, setLoadedCount] = React.useState(INITIAL_HISTORY_WINDOW)
  const [isLoadingEarlier, setIsLoadingEarlier] = React.useState(false)
  const historyIdentity = historyKey ?? messages[0]?.id ?? ""
  const listRootRef = React.useRef<HTMLDivElement | null>(null)
  const topSentinelRef = React.useRef<HTMLDivElement | null>(null)
  const prevMessageCountRef = React.useRef(messages.length)
  const prevLastUserMessageIdRef = React.useRef(lastUserMessageId(messages))
  const pendingDistanceFromBottomRef = React.useRef<number | null>(null)
  const loadLockRef = React.useRef(false)
  const loadedCountRef = React.useRef(loadedCount)
  loadedCountRef.current = loadedCount

  const captureScrollAnchor = React.useCallback(() => {
    const container =
      findTranscriptScrollParent(listRootRef.current)
      ?? findTranscriptScrollParent(topSentinelRef.current)
    if (container) {
      pendingDistanceFromBottomRef.current = container.scrollHeight - container.scrollTop
    }
  }, [])

  React.useEffect(() => {
    setLoadedCount(INITIAL_HISTORY_WINDOW)
    setIsLoadingEarlier(false)
    loadLockRef.current = false
    pendingDistanceFromBottomRef.current = null
    prevMessageCountRef.current = messages.length
    prevLastUserMessageIdRef.current = lastUserMessageId(messages)
  }, [historyIdentity])

  React.useEffect(() => {
    const prev = prevMessageCountRef.current
    const next = messages.length
    prevMessageCountRef.current = next
    if (next > prev) {
      // Follow-up send must land on the new bubble. Restoring the previous
      // mid-list distanceFromBottom after the trailing window slides would
      // keep the viewport in the middle of the old turn — including when an
      // assistant placeholder arrives in the same update as the user row.
      const nextUserId = lastUserMessageId(messages)
      if (shouldClearHistoryWindowAnchorOnAppend({
        prevLastUserMessageId: prevLastUserMessageIdRef.current,
        nextLastUserMessageId: nextUserId,
        messages,
      })) {
        pendingDistanceFromBottomRef.current = null
      } else if (
        // Default trailing window drops the oldest visible row on append.
        // Without a bottom-distance anchor (and with overflow-anchor:none while
        // sticky), that removal shifts the viewport upward after send.
        loadedCountRef.current <= INITIAL_HISTORY_WINDOW
        && prev >= INITIAL_HISTORY_WINDOW
      ) {
        captureScrollAnchor()
      }
      setLoadedCount((current) =>
        adjustLoadedHistoryCountOnMessageGrowth({
          currentLoaded: current,
          prevTotal: prev,
          nextTotal: next,
        }),
      )
      prevLastUserMessageIdRef.current = nextUserId
      return
    }
    if (next < prev) {
      setLoadedCount((current) => Math.min(Math.max(current, INITIAL_HISTORY_WINDOW), next))
    }
    prevLastUserMessageIdRef.current = lastUserMessageId(messages)
  }, [captureScrollAnchor, messages.length])

  const effectiveLoaded = Math.min(Math.max(loadedCount, 0), messages.length)
  const hasHiddenLocal = messages.length > effectiveLoaded
  const canFetchServer = Boolean(onLoadEarlierHistory) && !historyExhausted
  const hasHiddenHistory = hasHiddenLocal || canFetchServer
  const visibleMessages = React.useMemo(
    () => hasHiddenLocal ? messages.slice(-effectiveLoaded) : messages,
    [effectiveLoaded, hasHiddenLocal, messages],
  )

  const loadEarlier = React.useCallback(() => {
    if (loadLockRef.current || isLoadingEarlier) return

    if (messages.length > loadedCount) {
      captureScrollAnchor()
      loadLockRef.current = true
      setIsLoadingEarlier(true)
      setLoadedCount((current) => nextLoadedHistoryCount(current, messages.length))
      return
    }

    if (!onLoadEarlierHistory || historyExhausted) return

    captureScrollAnchor()
    loadLockRef.current = true
    setIsLoadingEarlier(true)
    void Promise.resolve(onLoadEarlierHistory())
      .catch(() => undefined)
      .finally(() => {
        // If the server added nothing, release the lock here; otherwise the
        // messages-length layout effect unlocks after the transcript grows.
        window.requestAnimationFrame(() => {
          if (loadLockRef.current) {
            loadLockRef.current = false
            setIsLoadingEarlier(false)
            pendingDistanceFromBottomRef.current = null
          }
        })
      })
  }, [
    captureScrollAnchor,
    historyExhausted,
    isLoadingEarlier,
    loadedCount,
    messages.length,
    onLoadEarlierHistory,
  ])

  React.useLayoutEffect(() => {
    const distance = pendingDistanceFromBottomRef.current
    if (distance != null) {
      const container =
        findTranscriptScrollParent(listRootRef.current)
        ?? findTranscriptScrollParent(topSentinelRef.current)
      if (container) {
        container.scrollTop = scrollTopAfterPrepend(container.scrollHeight, distance)
      }
      pendingDistanceFromBottomRef.current = null
    }
    if (loadLockRef.current) {
      loadLockRef.current = false
      setIsLoadingEarlier(false)
    }
  }, [visibleMessages])

  // Scroll-to-top lazy load: when the top sentinel enters the scrollport, reveal a batch.
  React.useEffect(() => {
    if (!hasHiddenHistory) return
    const sentinel = topSentinelRef.current
    if (!sentinel) return
    const root =
      findTranscriptScrollParent(listRootRef.current)
      ?? findTranscriptScrollParent(sentinel)

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadEarlier()
        }
      },
      { root, rootMargin: HISTORY_LOAD_ROOT_MARGIN, threshold: 0 },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasHiddenHistory, historyIdentity, loadEarlier, visibleMessages.length])

  // If the visible window still does not fill the scrollport, keep loading until it
  // does (or history is exhausted) so users can actually scroll upward.
  React.useEffect(() => {
    if (!hasHiddenHistory || loadLockRef.current) return
    const container =
      findTranscriptScrollParent(listRootRef.current)
      ?? findTranscriptScrollParent(topSentinelRef.current)
    if (!container) return
    if (container.scrollHeight <= container.clientHeight + 8) {
      loadEarlier()
    }
  }, [hasHiddenHistory, loadEarlier, visibleMessages])

  const items = React.useMemo(() => groupMessages(visibleMessages, status), [visibleMessages, status]);
  // Codex-style folded history: one「已处理 xx」strip per compaction boundary.
  // Only the pre-tail segment folds — OpenCode's tail_start_id recent turns
  // stay visible. Boundaries use the full transcript so elapsed + tail survive
  // the INITIAL_HISTORY_WINDOW slice.
  const compactionBoundaries = React.useMemo(() => {
    const offset = messages.length - visibleMessages.length
    if (offset < 0) return []
    return findCompactionBoundaries(messages)
      .map((boundary) => ({
        ...boundary,
        visibleIndex: boundary.messageIndex - offset,
        foldUntilVisibleIndex: boundary.foldUntilIndex - offset,
      }))
      .filter((boundary) => boundary.visibleIndex > 0)
  }, [messages, visibleMessages]);
  const compactionRows = React.useMemo(
    () => compactionBoundaries.length > 0
      ? buildCompactionRows(items, transcriptItemLastIndex, compactionBoundaries)
      : null,
    [items, compactionBoundaries],
  );
  const error = useSessionErrorMessage();
  const hasSessionErrorMessage = React.useMemo(() => messages.some(isSessionErrorMessage), [messages])
  const liveActionLabel = isStreaming
    ? getActiveToolLabel(collectToolParts(visibleMessages))
    : null
  // Only the *trailing* assistant in the live turn suppresses Waiting.
  // OpenCode emits multi-step assistants: tools may finish in msg N while msg
  // N+1 is still an empty shell (ses_049432e88ffe* repro). Counting earlier
  // tools as "visible" left a blank gap with Stop still armed.
  const hasVisibleLiveAssistantContent = React.useMemo(() => {
    let lastUserIndex = -1
    for (let index = visibleMessages.length - 1; index >= 0; index -= 1) {
      if (visibleMessages[index]?.role === "user") {
        lastUserIndex = index
        break
      }
    }
    for (let index = visibleMessages.length - 1; index > lastUserIndex; index -= 1) {
      const message = visibleMessages[index]
      if (message?.role !== "assistant") continue
      return message.parts.some((part) => {
        const partType = String(part.type)
        if (partType === "text" && "text" in part && typeof part.text === "string") {
          // Raw <think> must not count — otherwise Waiting is suppressed while
          // getAssistantRenderGroups strips think and paints nothing (blank gap).
          return assistantTextHasVisibleProse(part.text)
        }
        if (partType === "file") return true
        return partType.includes("tool")
      })
    }
    return false
  }, [visibleMessages])
  // Reasoning only replaces the Waiting indicator when the thinking accordion
  // is actually rendered. The thinking preference hides reasoning parts by
  // default, so suppressing Waiting on hidden reasoning leaves a blank gap in
  // the transcript while the model is still thinking (no "思考中" row, no
  // accordion — looks frozen even though the sidebar spinner is active).
  const { showThinking: showThinkingPreference } = useMessageList()
  const hasLiveReasoning = React.useMemo(
    () => showThinkingPreference && hasLiveReasoningPreview(visibleMessages),
    [showThinkingPreference, visibleMessages],
  )
  const liveTurnUserId = React.useMemo(
    () => getLastUserMessageId(visibleMessages),
    [visibleMessages],
  )
  const liveTurnProse = React.useMemo(
    () => getLiveTurnAssistantProse(visibleMessages),
    [visibleMessages],
  )
  const stickyProseRef = React.useRef("")
  const stickyTurnUserIdRef = React.useRef("")
  const [stickyProse, setStickyProse] = React.useState("")
  React.useEffect(() => {
    // Bind sticky prose to the current user turn. Otherwise a finished reply
    // leaks under the next prompt while the new assistant turn is still empty.
    if (liveTurnUserId !== stickyTurnUserIdRef.current) {
      stickyTurnUserIdRef.current = liveTurnUserId
      stickyProseRef.current = ""
      setStickyProse("")
    }
    if (liveTurnProse) {
      // Never shrink sticky prose while streaming — snapshot/live races can
      // briefly replace a longer draft with an empty/shorter shell.
      if (!isStreaming || liveTurnProse.length >= stickyProseRef.current.length) {
        stickyProseRef.current = liveTurnProse
        setStickyProse(liveTurnProse)
      }
      return
    }
    if (!isStreaming) {
      stickyProseRef.current = ""
      setStickyProse("")
    }
  }, [isStreaming, liveTurnProse, liveTurnUserId, historyIdentity])
  const showStickyProsePlaceholder =
    isStreaming
    && liveTurnProse.length === 0
    && stickyProse.length > 0
    && stickyTurnUserIdRef.current === liveTurnUserId
  // Also wait when status briefly reports ready between tool rounds but the
  // live user turn still has no authoritative final reply (empty shell gap).
  const pendingLiveTurnWithoutFinal =
    liveTurnLacksAuthoritativeFinalReply(visibleMessages)
    && !hasVisibleLiveAssistantContent
    && !hasLiveReasoning
  const showWaitingIndicator =
    (status === "submitted" || status === "streaming" || pendingLiveTurnWithoutFinal)
    && !showStickyProsePlaceholder
    && (
      Boolean(attachmentActivityLabel)
      || (!liveActionLabel && !hasVisibleLiveAssistantContent && !hasLiveReasoning)
    )

  const renderTranscriptItem = (item: TranscriptRenderItem): React.ReactNode => {
    if (isMessageGroup(item)) {
      return (
        <MessageGroup
          key={item.messages[0]?.message.id ?? "empty-assistant-group"}
          items={item.messages}
          messages={visibleMessages}
          isStreaming={isStreaming}
        />
      )
    }

    const isLastMessage = item.index === messages.length - 1
    const isLastStep =
      !messages[item.index + 1] || messages[item.index + 1].role !== item.message.role

    return (
      <div key={item.message.id}>
        <MessageComponent
          message={item.message}
          isLastMessage={isLastMessage}
          isStreaming={isLastMessage && isStreaming}
          isLastStep={isLastStep}
          showProse={true}
          surfaceTaskResults={false}
        />
        <MessageArtifacts message={item.message} />
      </div>
    )
  }

  return (
    <div
      ref={listRootRef}
      className={cn("flex flex-col gap-3 @container/message-list")}
      data-wodeapp-history-loaded={effectiveLoaded}
      data-wodeapp-history-total={messages.length}
      data-wodeapp-history-exhausted={historyExhausted ? "1" : "0"}
      data-wodeapp-history-hidden={hasHiddenHistory ? "1" : "0"}
    >
      {hasHiddenHistory ? (
        <div
          ref={topSentinelRef}
          className="mx-auto flex h-6 w-full max-w-[1100px] items-center justify-center px-2 md:px-10"
          aria-hidden={!isLoadingEarlier}
          data-wodeapp-history-sentinel="1"
        >
          {isLoadingEarlier ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <LoaderCircle className="size-3 animate-spin" aria-hidden />
              加载更早消息
            </span>
          ) : (
            <span className="sr-only">继续向上滚动加载更早消息</span>
          )}
        </div>
      ) : null}
      {messages.length === 0 ? (
        <TaskSuggestions
          className="w-full shrink-0 px-4 pb-4 pt-2 md:px-6 md:pb-6"
          onStartBuiltinAgent={onStartBuiltinAgent}
        />
      ) : null}

      {(compactionRows ?? items.map((item) => ({ kind: "item" as const, item }))).map((row) => {
        if (row.kind === "boundary") {
          return (
            <CompactionHistoryStrip
              key={`compaction-${row.boundary.messageId}`}
              boundary={row.boundary}
            >
              {row.hidden.map(renderTranscriptItem)}
            </CompactionHistoryStrip>
          )
        }

        return renderTranscriptItem(row.item)
      })}

      {showStickyProsePlaceholder ? (
        <StickyAssistantProsePlaceholder text={stickyProse} />
      ) : null}
      {showWaitingIndicator && (
        <LoadingMessage label={attachmentActivityLabel ?? liveActionLabel ?? undefined} />
      )}
      {retryStatus ? <RetryMessage status={retryStatus} /> : null}
      {error && !hasSessionErrorMessage ? <ErrorMessage error={error} /> : null}
    </div>
  )
}
