/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type UIEvent } from "react";
import { createPortal } from "react-dom";
import type { Agent } from "@opencode-ai/sdk/v2/client";
import { AppWindowMac, ArrowUp, Box, Check, ChevronDown, ChevronRight, ExternalLink, FileImage, FileText, Film, ListPlus, Loader2, Mic, Paperclip, Plug, Settings, Square, Terminal, X, Zap } from "lucide-react";
import fuzzysort from "fuzzysort";
import { toast } from "@/components/ui/sonner";
import { OPENWORK_EXTENSION_CATALOG, type McpDirectoryInfo } from "@/app/constants";
import type { CloudImportedPlugin, CloudImportedPluginFile } from "@/app/cloud/import-state";
import type { ComposerAttachment, McpServerEntry, McpStatusMap, ModelRef, SkillCard, SlashCommandOption } from "@/app/types";
import { formatBytes } from "@/app/utils";
import { t } from "@/i18n";
import { isOpenWorkExtensionEnabled, isOpenWorkExtensionHidden, OPENWORK_EXTENSION_STATE_CHANGED } from "@/react-app/domains/settings/extension-state";
import { useDesktopRestriction } from "@/react-app/domains/cloud/desktop-config-provider";
import { ModelBehaviorSelect } from "@/components/model-behavior-select";
import { ModelSelect } from "@/components/model-select";
import { WodeAppExternalDirectoryAccessSelect } from "@/react-app/domains/wodeapp/wodeapp-external-directory-access-select";
import { LexicalPromptEditor, type LexicalPromptEditorHandle } from "./editor";
import { useLocalSpeechInput } from "./local-speech-input";
import { listRunningAppsForMention } from "./app-mentions";
import { PREVIEW_ASSET_MENTION_EVENT, type ComposerMentionKind } from "./mention-encoding";
import { getSlashCommandQuery } from "./slash-command";
import { useShellConfig } from "@/react-app/shell/shell-config";
import {
  DIGITAL_ASSET_FILTERS,
  assetMentionLabel,
  assetMentionValue,
  digitalAssetKindIcon,
  digitalAssetToMention,
  type AssetMentionRef,
  type DigitalAssetFilter,
  type DigitalAssetKind,
} from "@/react-app/domains/wodeapp/digital-assets-data";
import { filterDigitalAssetsForMention } from "@/react-app/domains/wodeapp/wodeapp-assets-surface";
import { findDigitalAssetByMentionValue } from "@/react-app/domains/wodeapp/digital-assets-store";
import { rememberAssetMention, resolveAssetMentionById } from "@/react-app/domains/wodeapp/wodeapp-workbench-context";
import "@/react-app/domains/wodeapp/wodeapp-surfaces.css";

type MentionItem = {
  id: string;
  kind: ComposerMentionKind | "skill";
  value: string;
  label: string;
  assetKind?: DigitalAssetKind;
  paletteSection?: MentionPaletteSection;
  description?: string;
};

type MentionPaletteSection = DigitalAssetFilter | "智能体" | "技能";

const MENTION_PALETTE_SECTIONS: Array<{
  id: MentionPaletteSection;
  label: string;
  hint: string;
}> = [
  { id: "智能体", label: "智能体", hint: "切换当前会话" },
  ...DIGITAL_ASSET_FILTERS.map((filter) => ({
    id: filter as MentionPaletteSection,
    label: filter,
    hint:
      filter === "全部"
        ? "数字资产"
        : filter === "商品库"
          ? "商品与卖点"
          : filter === "品牌库"
          ? "品牌规范"
          : filter === "提示词"
            ? "生成提示"
            : filter === "真人"
              ? "人物资产"
              : "素材内容",
  })),
  { id: "技能", label: "技能", hint: "工作流指令" },
];
const WODEAPP_MENTION_BATCH_SIZE = 48;

function mentionKindLabel(item: MentionItem) {
  if (item.kind === "skill") return "技能";
  if (item.kind === "asset") return item.assetKind || "数字资产";
  if (item.kind === "agent") return t("composer.agent_label");
  if (item.kind === "app") return t("composer.app_kind");
  return t("composer.file_kind");
}

function skillMentionItems(items: SkillCard[]): MentionItem[] {
  return items.map((skill) => ({
    id: `skill:${skill.name}`,
    kind: "skill" as const,
    value: skill.name,
    label: skill.name,
    paletteSection: "技能" as const,
    description: skill.description || skill.trigger || "工作流指令",
  }));
}

function agentMentionItems(items: Agent[]): MentionItem[] {
  return items.map((agent) => ({
    id: `agent:${agent.name}`,
    kind: "agent" as const,
    value: agent.name,
    label: formatAgentDisplayName(agent.name),
    paletteSection: "智能体" as const,
    description: agent.description || "切换当前会话的智能体",
  }));
}

type PastedTextChip = {
  id: string;
  label: string;
  text: string;
  lines: number;
};

type ToolMenuSettingsSection = "commands" | "skills" | "mcps" | "plugins";
type ToolMenuSection = "agents" | "commands" | "skills" | "mcps" | "extensions" | `plugin:${string}`;

function isComposerExtensionAvailable(entry: McpDirectoryInfo) {
  const hasSessionSurface = entry.extensionManifest?.contributions?.some((contribution) =>
    contribution.type === "session-side-panel" || contribution.type === "session-rail-item"
  ) === true;
  if (hasSessionSurface) return isOpenWorkExtensionEnabled(entry);
  return !entry.defaultEnabled || isOpenWorkExtensionEnabled(entry);
}

type ComposerProps = {
  draft: string;
  mentions: Record<string, ComposerMentionKind>;
  onDraftChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  onSteer: () => void | Promise<void>;
  onQueue: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  busy: boolean;
  queuedCount: number;
  disabled: boolean;
  modelUnavailable?: boolean;
  statusLabel: string;
  modelPickerOpen: boolean;
  selectedModel: ModelRef;
  onModelPickerOpenChange: (open: boolean) => void;
  onModelChange: (model: ModelRef) => void;
  attachments: ComposerAttachment[];
  onAttachFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  attachmentsEnabled: boolean;
  attachmentsDisabledReason: string | null;
  modelVariantLabel: string;
  modelVariant: string | null;
  modelBehaviorOptions?: { value: string | null; label: string }[];
  onModelVariantChange: (value: string | null) => void;
  agentLabel: string;
  selectedAgent: string | null;
  listAgents: () => Promise<Agent[]>;
  onSelectAgent: (agent: string | null) => void;
  listCommands: () => Promise<SlashCommandOption[]>;
  listSkills?: () => Promise<SkillCard[]>;
  skills?: SkillCard[];
  listMcp?: () => Promise<{ servers: McpServerEntry[]; statuses: McpStatusMap; status: string | null }>;
  mcpServers?: McpServerEntry[];
  mcpStatus?: string | null;
  mcpStatuses?: McpStatusMap;
  listImportedPlugins?: () => Promise<CloudImportedPlugin[]>;
  importedPlugins?: CloudImportedPlugin[];
  onOpenSettingsSection?: (section: ToolMenuSettingsSection) => void;
  recentFiles: string[];
  searchFiles: (query: string) => Promise<string[]>;
  onInsertMention: (kind: ComposerMentionKind, value: string) => void;
  /** Sent-prompt history (oldest first) recalled with ArrowUp/ArrowDown (#2012). */
  inputHistory?: string[];
  onUnsupportedFileLinks: (links: string[]) => void;
  pastedText: PastedTextChip[];
  onExpandPastedText: (id: string) => void;
  onRemovePastedText: (id: string) => void;
  isRemoteWorkspace: boolean;
  isSandboxWorkspace: boolean;
  onUploadInboxFiles?: ((files: File[]) => void | Promise<unknown>) | null;
  draftScopeKey?: string;
  compactTopSpacing?: boolean;
  topAccessory?: ReactNode;
  wodeAppTopDock?: boolean;
};

const FLUSH_PROMPT_EVENT = "openwork:flushPromptDraft";
const FOCUS_PROMPT_EVENT = "openwork:focusPrompt";
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;
const WORKBENCH_ATTACHMENT_BYTES = Number.POSITIVE_INFINITY;
const IMAGE_COMPRESS_MAX_PX = 2048;
const IMAGE_COMPRESS_QUALITY = 0.82;
/** Keep vision-direct base64 prompts small; history compaction strips pixels after idle. */
const IMAGE_COMPRESS_TARGET_BYTES = 512 * 1024;
const FILE_URL_RE = /^file:\/\//i;
const HTTP_URL_RE = /^https?:\/\//i;
const DEFAULT_AGENT_NAME = "openwork";
const BROWSER_IMAGE_DROP_MIME = "application/x-openwork-browser-image";

type BrowserImageForComposerPayload = {
  url?: string;
  sourceUrl?: string;
  name?: string;
  label?: string;
  mimeType?: string;
  size?: number;
  bytes?: ArrayBuffer | Uint8Array | number[];
  error?: string;
  trigger?: string;
  pageUrl?: string;
};

type LightboxEditImagePayload = BrowserImageForComposerPayload & {
  file?: File;
};

function isNonDefaultAgent(agent: Agent) {
  return agent.name !== DEFAULT_AGENT_NAME;
}

/**
 * Map the two OpenCode built-in agent ids to localized display labels.
 * Returns the localized label when known; otherwise falls back to a
 * capitalized first letter so user-defined agents still render sensibly.
 */
const BUILTIN_AGENT_LABELS: Record<string, string> = {
  build: "执行智能体",
  plan: "计划智能体",
  "wynne-brand-agent": "Wynne 品牌智能体",
};

export function formatAgentDisplayName(name: string): string {
  return (
    BUILTIN_AGENT_LABELS[name] ??
    name.charAt(0).toUpperCase() + name.slice(1)
  );
}

/**
 * Extract external file/URL drops from a clipboard. Only used when the user
 * drag-drops a file reference from another app (Finder / browser), which sets
 * the text/uri-list MIME type explicitly. Plain text pastes — even ones that
 * contain absolute paths like "/Users/..." — are NEVER treated as links here
 * because that intercepted real text pastes and made composer paste feel
 * broken. Plain text goes straight into the editor via Lexical's default.
 */
function parseClipboardUriList(clipboard: DataTransfer) {
  const raw = clipboard.getData("text/uri-list") ?? "";
  if (!raw.trim()) return [];
  const links: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (!FILE_URL_RE.test(trimmed) && !HTTP_URL_RE.test(trimmed)) continue;
    const normalized = encodeURI(trimmed);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    links.push(normalized);
  }
  return links;
}

function isImageAttachment(attachment: ComposerAttachment) {
  return attachment.kind === "image" || attachment.mimeType.startsWith("image/");
}

function isProbablyImageUrl(value: string) {
  const raw = value.trim();
  if (!raw) return false;
  if (/^data:image\//i.test(raw)) return true;
  try {
    const parsed = new URL(raw);
    return /\.(?:png|jpe?g|webp|gif|avif|svg)(?:$|[?#])/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function bytesFromBrowserPayload(bytes: BrowserImageForComposerPayload["bytes"]): Uint8Array | null {
  if (!bytes) return null;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  if (Array.isArray(bytes)) return new Uint8Array(bytes);
  return null;
}

function fileExtensionFromMime(mimeType: string) {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    case "image/avif":
      return "avif";
    case "image/svg+xml":
      return "svg";
    case "image/png":
    default:
      return "png";
  }
}

function sanitizeBrowserImageFileName(value: string, mimeType: string) {
  let name = value
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 120)
    .trim();
  if (!name) name = "browser-image";
  if (!/\.(?:png|jpe?g|webp|gif|avif|svg)$/i.test(name)) {
    name = `${name}.${fileExtensionFromMime(mimeType)}`;
  }
  return name;
}

function browserImagePayloadToFile(payload: BrowserImageForComposerPayload): File | null {
  if (payload.error) return null;
  const bytes = bytesFromBrowserPayload(payload.bytes);
  if (!bytes) return null;
  const mimeType = payload.mimeType?.startsWith("image/") ? payload.mimeType : "image/png";
  const name = sanitizeBrowserImageFileName(payload.name || payload.label || "browser-image", mimeType);
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return new File([arrayBuffer], name, {
    type: mimeType,
    lastModified: Date.now(),
  });
}

async function fetchBrowserImageInRenderer(payload: BrowserImageForComposerPayload): Promise<File | null> {
  const url = payload.url || payload.sourceUrl || "";
  if (!url) return null;
  const response = await fetch(url, {
    credentials: "include",
    headers: {
      Accept: "image/avif,image/webp,image/png,image/svg+xml,image/*,*/*;q=0.8",
    },
  });
  if (!response.ok) return null;
  const mimeType = (response.headers.get("content-type") || "").split(";")[0].trim() || "image/png";
  if (!mimeType.startsWith("image/")) return null;
  const blob = await response.blob();
  const name = sanitizeBrowserImageFileName(payload.name || payload.label || "browser-image", mimeType);
  return new File([blob], name, {
    type: mimeType,
    lastModified: Date.now(),
  });
}

function isMissingBrowserImageHandlerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.includes("No handler registered for 'openwork:browser:readImageForComposer'");
}

function parseBrowserImageDrop(dataTransfer: DataTransfer | null): BrowserImageForComposerPayload | null {
  if (!dataTransfer) return null;
  const raw = dataTransfer.getData(BROWSER_IMAGE_DROP_MIME);
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as BrowserImageForComposerPayload;
    return parsed?.url ? parsed : null;
  } catch {
    return null;
  }
}

function browserImageUrlFromDroppedHtml(dataTransfer: DataTransfer | null): string {
  const html = dataTransfer?.getData("text/html") || "";
  if (!html.trim() || !/<img\b/i.test(html)) return "";
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const src = doc.querySelector("img")?.getAttribute("src") || "";
    return src.trim();
  } catch {
    const match = html.match(/<img\b[^>]*\bsrc=(["'])(.*?)\1/i);
    return (match?.[2] || "").trim();
  }
}

function hasBrowserImageDrag(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types || []);
  return types.includes(BROWSER_IMAGE_DROP_MIME) || types.includes("text/uri-list");
}

async function compressImageFile(file: File): Promise<File> {
  if (file.type === "image/gif") {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const maxDim = Math.max(width, height);
  const needsResize = maxDim > IMAGE_COMPRESS_MAX_PX;
  const needsShrink = file.size > IMAGE_COMPRESS_TARGET_BYTES;
  if (!needsResize && !needsShrink) {
    bitmap.close();
    return file;
  }
  const scale = needsResize ? IMAGE_COMPRESS_MAX_PX / maxDim : 1;
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  let blob: Blob | null = null;

  if (typeof OffscreenCanvas !== "undefined") {
    const offscreen = new OffscreenCanvas(targetW, targetH);
    const ctx = offscreen.getContext("2d");
    if (ctx) {
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      blob = await offscreen.convertToBlob({
        type: "image/jpeg",
        quality: IMAGE_COMPRESS_QUALITY,
      });
    }
  }

  if (!blob) {
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", IMAGE_COMPRESS_QUALITY),
      );
    }
  }

  bitmap.close();

  if (!blob || blob.size >= file.size) {
    return file;
  }

  const stem = file.name.replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${stem}.jpg`, { type: "image/jpeg" });
}

function formatMcpStatusLabel(status: McpServerStatus | undefined) {
  switch (status) {
    case "connected":
      return t("mcp.friendly_status_ready");
    case "needs_auth":
    case "needs_client_registration":
      return t("mcp.friendly_status_needs_signin");
    case "disabled":
      return t("mcp.friendly_status_paused");
    case "disconnected":
      return t("mcp.friendly_status_offline");
    case "failed":
    default:
      return t("mcp.friendly_status_issue");
  }
}

type McpServerStatus = "connected" | "needs_auth" | "needs_client_registration" | "failed" | "disabled" | "disconnected";

function toReactMcpStatus(name: string, entry: McpServerEntry, statuses: McpStatusMap): McpServerStatus {
  const configured = statuses[name];
  if (configured?.status === "connected") return "connected";
  if (configured?.status === "needs_auth") return "needs_auth";
  if (configured?.status === "needs_client_registration") return "needs_client_registration";
  if (configured?.status === "failed") return "failed";
  if (configured?.status === "disabled" || entry.config.enabled === false || entry.config.enabled === undefined && entry.config.type === "local" && entry.config.command?.length === 0) {
    return entry.config.enabled === false ? "disabled" : configured?.status === "disabled" ? "disabled" : "disconnected";
  }
  return "disconnected";
}

function mcpStatusBadgeClass(status: McpServerStatus) {
  switch (status) {
    case "connected":
      return "bg-green-3 text-green-11";
    case "needs_auth":
    case "needs_client_registration":
      return "bg-amber-3 text-amber-11";
    case "disabled":
    case "disconnected":
      return "bg-gray-3 text-gray-11";
    default:
      return "bg-red-3 text-red-11";
  }
}

function extensionIcon(entry: McpDirectoryInfo, size = 16) {
  if (entry.iconSrc) {
    return <img src={entry.iconSrc} alt="" width={size} height={size} loading="lazy" style={{ display: "block" }} />;
  }
  if (entry.iconSlug) {
    return <img src={`https://cdn.simpleicons.org/${entry.iconSlug}`} alt="" width={size} height={size} loading="lazy" style={{ display: "block" }} />;
  }
  return <Plug size={size} className="text-gray-9" />;
}

function formatPluginObjectType(type: string) {
  const normalized = type.trim().toLowerCase();
  if (!normalized) return "File";
  if (normalized === "mcp") return "MCP";
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}`;
}

function pluginSlashCommandName(file: CloudImportedPluginFile) {
  const path = file.path.trim();
  if (file.objectType === "command") {
    const command = path.match(/^\.opencode\/(?:command|commands)\/(.+)\.md$/i)?.[1];
    return command?.trim() || null;
  }
  if (file.objectType === "skill") {
    const skill = path.match(/^\.opencode\/(?:skill|skills)\/(?:[^/]+\/)?([^/]+)\/SKILL\.md$/i)?.[1];
    return skill?.trim() || null;
  }
  return null;
}

type AssetMentionPreview = {
  value: string;
  ref: AssetMentionRef;
  mediaKind: "brand" | "prompt" | "image" | "video" | "audio" | "file";
  images: string[];
  sourceUrl?: string;
  thumbnailUrl?: string;
  fileName?: string;
  fileType?: string;
  fileSize?: number;
  durationLabel?: string;
};

function assetIdFromMentionValue(value: string) {
  return value.startsWith("asset:") ? value.slice("asset:".length) : value;
}

function resolveAssetMentionRef(value: string): AssetMentionRef | null {
  const asset = findDigitalAssetByMentionValue(value);
  if (asset) {
    const ref = digitalAssetToMention(asset);
    rememberAssetMention(ref);
    return ref;
  }
  return resolveAssetMentionById(assetIdFromMentionValue(value)) ?? null;
}

function compactAssetImages(ref: AssetMentionRef, fallback?: string) {
  const seen = new Set<string>();
  const images = [
    ref.coverImage,
    ...(ref.productImages || []),
    ...(ref.assetImages || []),
    fallback,
  ].filter((url): url is string => Boolean(url));
  return images.filter((url) => {
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function createAssetMentionPreview(value: string): AssetMentionPreview | null {
  const ref = resolveAssetMentionRef(value);
  if (!ref) return null;
  const fileType = ref.assetFileType || "";
  const fileUrl = ref.assetFile;
  const imageFallback = fileType.startsWith("image/") ? fileUrl : undefined;
  const images = compactAssetImages(ref, imageFallback);
  const isBrandAsset = ref.kind === "品牌库";
  const isPromptAsset = ref.kind === "提示词";
  const sourceUrl = isBrandAsset || isPromptAsset ? undefined : fileUrl || images[0];
  const mediaKind =
    isBrandAsset
      ? "brand"
      : isPromptAsset
        ? "prompt"
        : fileType.startsWith("video/")
          ? "video"
          : fileType.startsWith("audio/")
            ? "audio"
            : images.length > 0
              ? "image"
              : "file";
  return {
    value,
    ref,
    mediaKind,
    images,
    sourceUrl,
    thumbnailUrl: images[0],
    fileName: ref.assetFileName,
    fileType,
    fileSize: ref.assetFileSize,
    durationLabel: ref.durationLabel,
  };
}

function assetPreviewLabel(preview: AssetMentionPreview) {
  if (preview.mediaKind === "brand") {
    return preview.ref.brandEntries?.length ? `${preview.ref.brandEntries.length} 个品牌条目` : "品牌信息";
  }
  if (preview.mediaKind === "prompt") return "正文";
  if (preview.mediaKind === "video") return preview.durationLabel || "可播放";
  if (preview.mediaKind === "audio") return "可播放";
  if (preview.mediaKind === "image") return preview.images.length > 1 ? `${preview.images.length} 张图片` : "图片";
  return "文件";
}

export function ReactSessionComposer(props: ComposerProps) {
  const { config: shellConfig } = useShellConfig();
  const useWodeAppTopDock = shellConfig.wodeappWorkbench && props.wodeAppTopDock === true;
  const builtInExtensionsDisabled = useDesktopRestriction("allowBuiltInExtensions");
  let fileInput: HTMLInputElement | undefined;
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const [commands, setCommands] = useState<SlashCommandOption[]>([]);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skills, setSkills] = useState<SkillCard[]>(props.skills ?? []);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServerEntry[]>(props.mcpServers ?? []);
  const [mcpStatus, setMcpStatus] = useState<string | null>(props.mcpStatus ?? null);
  const [mcpStatuses, setMcpStatuses] = useState<McpStatusMap>(props.mcpStatuses ?? {});
  const [importedPlugins, setImportedPlugins] = useState<CloudImportedPlugin[]>(props.importedPlugins ?? []);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [toolMenuSection, setToolMenuSection] = useState<ToolMenuSection>("commands");
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionPaletteSection, setMentionPaletteSection] = useState<MentionPaletteSection>("全部");
  const [mentionVisibleCount, setMentionVisibleCount] = useState(WODEAPP_MENTION_BATCH_SIZE);
  const [menuIndex, setMenuIndex] = useState(0);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const commandsCacheRef = useRef<SlashCommandOption[] | null>(null);
  const commandsRequestRef = useRef<Promise<SlashCommandOption[]> | null>(null);
  const commandsLoadVersionRef = useRef(0);
  const listCommandsRef = useRef(props.listCommands);
  const listSkillsRef = useRef(props.listSkills);
  const listMcpRef = useRef(props.listMcp);
  const listImportedPluginsRef = useRef(props.listImportedPlugins);
  const skillsRef = useRef<SkillCard[]>(props.skills ?? []);
  const toolMenuLoadRef = useRef({
    openId: 0,
    commands: false,
    skills: false,
    mcps: false,
    plugins: false,
  });
  const [commandsLoaded, setCommandsLoaded] = useState(false);
  const [skillsLoaded, setSkillsLoaded] = useState(Boolean(props.skills));
  const [mcpLoaded, setMcpLoaded] = useState(Boolean(props.mcpServers));
  const [pluginsLoaded, setPluginsLoaded] = useState(Boolean(props.importedPlugins));
  const [, setExtensionStateVersion] = useState(0);
  const [agentMenuIndex, setAgentMenuIndex] = useState(0);
  const agentItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [dropzoneActive, setDropzoneActive] = useState(false);
  const [assetPreview, setAssetPreview] = useState<AssetMentionPreview | null>(null);
  const toolMenuRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<LexicalPromptEditorHandle | null>(null);
  const agentMenuRef = useRef<HTMLDivElement | null>(null);
  // IME composition guard: while an IME composition is active, we must not
  // treat Enter as a submit. Three signals keep this reliable across WebKit,
  // Chrome, and Safari: event.isComposing, event.keyCode === 229, and the
  // compositionstart/compositionend events below.
  const imeComposingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [attachmentProcessingCount, setAttachmentProcessingCount] = useState(0);
  const attachmentsProcessing = attachmentProcessingCount > 0;
  const draftRef = useRef(props.draft);
  useEffect(() => {
    draftRef.current = props.draft;
  }, [props.draft]);

  const appendLocalSpeechResult = useCallback((text: string) => {
    const currentDraft = draftRef.current;
    const separator = currentDraft.length > 0 && !/\s$/.test(currentDraft) ? " " : "";
    const nextDraft = `${currentDraft}${separator}${text}`;
    draftRef.current = nextDraft;
    props.onDraftChange(nextDraft);
    window.dispatchEvent(new Event(FOCUS_PROMPT_EVENT));
  }, [props.onDraftChange]);
  const localSpeech = useLocalSpeechInput({
    lang: "zh-CN",
    onResult: appendLocalSpeechResult,
    onError: (message) => toast.warning(message),
  });

  // Follow-up message UX (only relevant while the agent is busy):
  // - Enter / Send queues the message above the composer; it drains once idle.
  // - Escape arms a "Hit Escape again to stop the agent" prompt for 3s;
  //   a second Escape within that window stops the agent.
  const [escapeArmed, setEscapeArmed] = useState(false);
  const escapeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disarmEscape = useCallback(() => {
    if (escapeTimerRef.current) {
      clearTimeout(escapeTimerRef.current);
      escapeTimerRef.current = null;
    }
    setEscapeArmed(false);
  }, []);

  // Reset the escape-to-stop prompt whenever the agent stops being busy.
  useEffect(() => {
    if (!props.busy) disarmEscape();
  }, [props.busy, disarmEscape]);

  // Input history recall (#2012): ArrowUp on an empty composer recalls the
  // previous sent prompt; repeated ArrowUp/ArrowDown walk the history.
  // Editing the recalled text exits recall mode, and ArrowDown past the
  // newest entry restores whatever was typed before recall started.
  const historyPosRef = useRef<number | null>(null);
  const historyExpectedRef = useRef<string | null>(null);
  const historyStashRef = useRef("");

  useEffect(() => {
    if (historyPosRef.current === null) return;
    if (props.draft !== historyExpectedRef.current) {
      historyPosRef.current = null;
      historyExpectedRef.current = null;
    }
  }, [props.draft]);

  useEffect(() => () => {
    if (escapeTimerRef.current) clearTimeout(escapeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!shellConfig.wodeappWorkbench) return;
    const handleFocusComposer = () => {
      window.dispatchEvent(new Event(FOCUS_PROMPT_EVENT));
    };
    window.addEventListener("wodeapp:focus-composer", handleFocusComposer);
    return () => window.removeEventListener("wodeapp:focus-composer", handleFocusComposer);
  }, [shellConfig.wodeappWorkbench]);

  useEffect(() => {
    const handleAssetPreview = (event: Event) => {
      const detail = (event as CustomEvent<{ value?: string; id?: string }>).detail;
      const rawValue = detail?.value || detail?.id;
      if (!rawValue) return;
      const value = rawValue.startsWith("asset:") ? rawValue : `asset:${rawValue}`;
      const preview = createAssetMentionPreview(value);
      if (preview) setAssetPreview(preview);
    };
    window.addEventListener(PREVIEW_ASSET_MENTION_EVENT, handleAssetPreview);
    return () => window.removeEventListener(PREVIEW_ASSET_MENTION_EVENT, handleAssetPreview);
  }, []);

  // Editor submit (Enter). Idle sends now; busy queues above the transcript.
  const handleEditorSubmit = useCallback((_options: { steer: boolean }) => {
    if (attachmentsProcessing) return;
    const hasContent = props.draft.trim().length > 0 || props.attachments.length > 0;
    if (!hasContent) return;
    if (props.busy) {
      void props.onQueue();
      return;
    }
    void props.onSend();
  }, [attachmentsProcessing, props.busy, props.draft, props.attachments, props.onSend, props.onQueue]);

  const slashCommandQuery = getSlashCommandQuery(props.draft);
  const slashOpenNext = slashCommandQuery !== null;
  const slashQuery = slashCommandQuery ?? "";
  const mentionMatch = props.draft.match(/@([^\s@]*)$/);
  const mentionOpenNext = Boolean(mentionMatch);
  const mentionQuery = mentionMatch?.[1] ?? "";
  const nonDefaultAgents = useMemo(() => agents.filter(isNonDefaultAgent), [agents]);
  const showAgentPicker = props.selectedAgent !== null || nonDefaultAgents.length > 0;

  useEffect(() => {
    setSlashOpen(slashOpenNext);
    setMenuIndex(0);
  }, [slashOpenNext, slashQuery]);

  useEffect(() => {
    setMentionOpen(mentionOpenNext);
    setMenuIndex(0);
    if (!mentionOpenNext) setMentionPaletteSection("全部");
  }, [mentionOpenNext, mentionQuery]);

  useEffect(() => {
    if (!agentMenuOpen && !(toolMenuOpen && toolMenuSection === "agents")) return;
    void props.listAgents().then(setAgents).catch(() => setAgents([]));
  }, [agentMenuOpen, toolMenuOpen, toolMenuSection, props.listAgents]);

  useEffect(() => {
    if (!showAgentPicker) setAgentMenuOpen(false);
  }, [showAgentPicker]);

  useEffect(() => {
    let cancelled = false;
    void props.listAgents().then((next) => {
      if (!cancelled) setAgents(next);
    }).catch(() => {
      if (!cancelled) setAgents([]);
    });
    return () => {
      cancelled = true;
    };
  }, [props.listAgents]);

  useEffect(() => {
    const next = props.skills ?? [];
    skillsRef.current = next;
    setSkills(next);
  }, [props.skills]);

  useEffect(() => {
    setMcpServers(props.mcpServers ?? []);
    setMcpStatus(props.mcpStatus ?? null);
    setMcpStatuses(props.mcpStatuses ?? {});
  }, [props.mcpServers, props.mcpStatus, props.mcpStatuses]);

  useEffect(() => {
    setImportedPlugins(props.importedPlugins ?? []);
  }, [props.importedPlugins]);

  useEffect(() => {
    listCommandsRef.current = props.listCommands;
  }, [props.listCommands]);

  useEffect(() => {
    listSkillsRef.current = props.listSkills;
  }, [props.listSkills]);

  useEffect(() => {
    listMcpRef.current = props.listMcp;
  }, [props.listMcp]);

  useEffect(() => {
    listImportedPluginsRef.current = props.listImportedPlugins;
  }, [props.listImportedPlugins]);

  useEffect(() => {
    setAgentMenuIndex(0);
  }, [agentMenuOpen]);

  useEffect(() => {
    const target = agentItemRefs.current[agentMenuIndex];
    target?.scrollIntoView({ block: "nearest" });
  }, [agentMenuIndex, agentMenuOpen]);

  useEffect(() => {
    commandsLoadVersionRef.current += 1;
    commandsCacheRef.current = null;
    commandsRequestRef.current = null;
  }, [props.listCommands]);

  const loadCommands = useCallback(() => {
    if (commandsCacheRef.current !== null) {
      return Promise.resolve(commandsCacheRef.current);
    }
    if (commandsRequestRef.current) {
      return commandsRequestRef.current;
    }
    const version = commandsLoadVersionRef.current;
    const request = listCommandsRef.current().then((next) => {
      if (commandsLoadVersionRef.current === version) {
        commandsCacheRef.current = next;
      }
      return next;
    }).finally(() => {
      if (commandsLoadVersionRef.current === version) {
        commandsRequestRef.current = null;
      }
    });
    commandsRequestRef.current = request;
    return request;
  }, []);

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
    if (!toolMenuOpen) return;
    toolMenuLoadRef.current = {
      openId: toolMenuLoadRef.current.openId + 1,
      commands: false,
      skills: false,
      mcps: false,
      plugins: false,
    };
    setCommandsLoaded(false);
    setSkillsLoaded(Boolean(props.skills));
    setMcpLoaded(Boolean(props.mcpServers));
    setPluginsLoaded(Boolean(props.importedPlugins));
  }, [toolMenuOpen]);

  useEffect(() => {
    if (!slashOpen && !toolMenuOpen) return;
    const openId = toolMenuLoadRef.current.openId;
    if (toolMenuOpen && toolMenuLoadRef.current.commands) return;
    if (toolMenuOpen) toolMenuLoadRef.current.commands = true;
    let cancelled = false;
    const cached = commandsCacheRef.current;
    if (cached !== null) {
      setCommands(cached);
      setCommandsLoading(false);
      if (toolMenuOpen && toolMenuLoadRef.current.openId === openId) setCommandsLoaded(true);
      return () => {
        cancelled = true;
      };
    }
    setCommandsLoading(true);
    void loadCommands()
      .then((next) => {
        if (!cancelled) {
          setCommands(next);
          if (toolMenuOpen && toolMenuLoadRef.current.openId === openId) setCommandsLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCommands([]);
          if (toolMenuOpen && toolMenuLoadRef.current.openId === openId) setCommandsLoaded(true);
        }
      })
      .finally(() => {
        if (!cancelled) setCommandsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slashOpen, toolMenuOpen, loadCommands]);

  useEffect(() => {
    if (!mentionOpen) return;
    let cancelled = false;
    const assetItems: MentionItem[] = shellConfig.wodeappWorkbench
      ? filterDigitalAssetsForMention(mentionQuery, "全部", "全部").map((item) => {
          const ref = digitalAssetToMention(item);
          rememberAssetMention(ref);
          const value = assetMentionValue(item);
          return {
            id: `asset:${item.id}`,
            kind: "asset" as const,
            value,
            label: assetMentionLabel(item),
            assetKind: item.kind,
            description: item.meta,
          };
        })
      : [];
    if (shellConfig.wodeappWorkbench) {
      setMentionItems([...assetItems, ...skillMentionItems(skillsRef.current)]);
      const listSkills = listSkillsRef.current;
      void Promise.all([
        props.listAgents().catch(() => []),
        listSkills ? listSkills().catch(() => skillsRef.current) : Promise.resolve(skillsRef.current),
      ]).then(([agentList, skillList]) => {
        if (cancelled) return;
        skillsRef.current = skillList;
        setSkills(skillList);
        setSkillsLoaded(true);
        setMentionItems([
          ...agentMentionItems(agentList),
          ...assetItems,
          ...skillMentionItems(skillList),
        ]);
      });
      return () => {
        cancelled = true;
      };
    }
    void Promise.all([props.listAgents(), props.searchFiles(mentionQuery), listRunningAppsForMention()]).then(([agentList, files, apps]) => {
      if (cancelled) return;
      const recent = props.recentFiles.slice(0, 8);
      const next: MentionItem[] = [
        ...assetItems,
        ...agentMentionItems(agentList),
        ...recent.map((file) => ({ id: `file:${file}`, kind: "file" as const, value: file, label: file })),
        ...apps.map((appName) => ({ id: `app:${appName}`, kind: "app" as const, value: appName, label: appName })),
        ...files.filter((file) => !recent.includes(file)).map((file) => ({ id: `file:${file}`, kind: "file" as const, value: file, label: file })),
      ];
      setMentionItems(next);
    }).catch(() => {
      if (!cancelled) setMentionItems(assetItems);
    });
    return () => {
      cancelled = true;
    };
  }, [mentionOpen, mentionQuery, props.listAgents, props.recentFiles, props.searchFiles, shellConfig.wodeappWorkbench]);

  useEffect(() => {
    if (!toolMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (toolMenuRef.current?.contains(target)) return;
      setToolMenuOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [toolMenuOpen]);

  useEffect(() => {
    if (!agentMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (agentMenuRef.current?.contains(target)) return;
      setAgentMenuOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [agentMenuOpen]);

  useEffect(() => {
    if (!toolMenuOpen) return;
    const openId = toolMenuLoadRef.current.openId;
    const listImportedPlugins = listImportedPluginsRef.current;
    if (listImportedPlugins && !toolMenuLoadRef.current.plugins) {
      let cancelled = false;
      toolMenuLoadRef.current.plugins = true;
      setPluginsLoading(true);
      void listImportedPlugins()
        .then((next) => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) {
            setImportedPlugins(next);
            setPluginsLoaded(true);
          }
        })
        .catch(() => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) {
            setImportedPlugins([]);
            setPluginsLoaded(true);
          }
        })
        .finally(() => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) setPluginsLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [toolMenuOpen]);

  useEffect(() => {
    if (!toolMenuOpen) return;
    const openId = toolMenuLoadRef.current.openId;
    const listSkills = listSkillsRef.current;
    const listMcp = listMcpRef.current;
    if (toolMenuSection === "skills" && listSkills && !toolMenuLoadRef.current.skills) {
      let cancelled = false;
      toolMenuLoadRef.current.skills = true;
      setSkillsLoading(true);
      void listSkills()
        .then((next) => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) {
            setSkills(next);
            setSkillsLoaded(true);
          }
        })
        .catch(() => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) {
            setSkills([]);
            setSkillsLoaded(true);
          }
        })
        .finally(() => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) setSkillsLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    if (toolMenuSection === "mcps" && listMcp && !toolMenuLoadRef.current.mcps) {
      let cancelled = false;
      toolMenuLoadRef.current.mcps = true;
      setMcpLoading(true);
      void listMcp()
        .then((next) => {
          if (cancelled || toolMenuLoadRef.current.openId !== openId) return;
          setMcpServers(next.servers);
          setMcpStatuses(next.statuses);
          setMcpStatus(next.status);
          setMcpLoaded(true);
        })
        .catch(() => {
          if (cancelled || toolMenuLoadRef.current.openId !== openId) return;
          setMcpServers([]);
          setMcpStatuses({});
          setMcpLoaded(true);
        })
        .finally(() => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) setMcpLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [toolMenuOpen, toolMenuSection]);

  const slashFiltered = useMemo(() => {
    if (!slashOpen) return [];
    if (!slashQuery) return commands.slice(0, 8);
    return fuzzysort.go(slashQuery, commands, { keys: ["name", "description"], limit: 8 }).map((entry) => entry.obj);
  }, [commands, slashOpen, slashQuery]);
  const mentionFiltered = useMemo(() => {
    if (!mentionOpen) return [];
    if (shellConfig.wodeappWorkbench) {
      return mentionItems;
    }
    if (!mentionQuery) return mentionItems.slice(0, 8);
    return fuzzysort.go(mentionQuery, mentionItems, { keys: ["label"], limit: 8 }).map((entry) => entry.obj);
  }, [mentionItems, mentionOpen, mentionQuery, shellConfig.wodeappWorkbench]);
  const mentionKindCounts = useMemo<Record<MentionPaletteSection, number>>(() => {
    const counts = Object.fromEntries(MENTION_PALETTE_SECTIONS.map((section) => [section.id, 0])) as Record<MentionPaletteSection, number>;
    mentionFiltered.forEach((item) => {
      const section = item.paletteSection ?? item.assetKind;
      if (section) counts[section] += 1;
    });
    counts["全部"] = mentionFiltered.length;
    return counts;
  }, [mentionFiltered]);
  const visibleMentionPaletteSections = useMemo(
    () => MENTION_PALETTE_SECTIONS.filter((section) => section.id === "全部" || mentionKindCounts[section.id] > 0),
    [mentionKindCounts],
  );
  const effectiveMentionPaletteSection = useMemo<MentionPaletteSection>(() => {
    if (!shellConfig.wodeappWorkbench) return mentionPaletteSection;
    if (visibleMentionPaletteSections.some((section) => section.id === mentionPaletteSection)) return mentionPaletteSection;
    return visibleMentionPaletteSections[0]?.id ?? "全部";
  }, [mentionPaletteSection, shellConfig.wodeappWorkbench, visibleMentionPaletteSections]);
  const activeMentionItems = useMemo(() => {
    if (!shellConfig.wodeappWorkbench || effectiveMentionPaletteSection === "全部") return mentionFiltered;
    return mentionFiltered.filter((item) => (item.paletteSection ?? item.assetKind) === effectiveMentionPaletteSection);
  }, [effectiveMentionPaletteSection, mentionFiltered, shellConfig.wodeappWorkbench]);
  const visibleActiveMentionItems = useMemo(() => {
    if (!shellConfig.wodeappWorkbench) return activeMentionItems;
    return activeMentionItems.slice(0, mentionVisibleCount);
  }, [activeMentionItems, mentionVisibleCount, shellConfig.wodeappWorkbench]);
  const hasMoreActiveMentionItems =
    shellConfig.wodeappWorkbench && visibleActiveMentionItems.length < activeMentionItems.length;
  const pastedTextTokens = useMemo(
    () => props.pastedText.map((item) => ({ label: item.label, lines: item.lines })),
    [props.pastedText],
  );

  const handleExpandPastedText = useCallback((label: string) => {
    const target = props.pastedText.find((item) => item.label === label);
    if (!target) return;
    props.onExpandPastedText(target.id);
  }, [props.onExpandPastedText, props.pastedText]);

  const activeMenu = slashOpen ? "slash" : mentionOpen ? "mention" : null;
  const activeItems = activeMenu === "slash" ? slashFiltered : activeMenu === "mention" ? visibleActiveMentionItems : [];
  const toolCommandItems = commands.filter((command) => !command.source || command.source === "command");
  const toolSkillItems = commands.filter((command) => command.source === "skill");
  const toolMcpItems = commands.filter((command) => command.source === "mcp");
  void toolMcpItems;
  const pluginSections = importedPlugins
    .filter((plugin) => plugin.files.length > 0)
    .map((plugin) => ({ section: `plugin:${plugin.pluginId}` as const, plugin }));
  const activePlugin = toolMenuSection.startsWith("plugin:")
    ? pluginSections.find((entry) => entry.section === toolMenuSection)?.plugin ?? null
    : null;
  const composerExtensions = OPENWORK_EXTENSION_CATALOG.filter((entry) =>
    !builtInExtensionsDisabled &&
    !isOpenWorkExtensionHidden(entry) && isComposerExtensionAvailable(entry)
  );
  const canSend = !attachmentsProcessing && (props.draft.trim().length > 0 || props.attachments.length > 0);

  useEffect(() => {
    if (!mentionOpen || !shellConfig.wodeappWorkbench || effectiveMentionPaletteSection === mentionPaletteSection) return;
    setMentionPaletteSection(effectiveMentionPaletteSection);
    setMenuIndex(0);
  }, [effectiveMentionPaletteSection, mentionOpen, mentionPaletteSection, shellConfig.wodeappWorkbench]);

  useEffect(() => {
    if (!mentionOpen || !shellConfig.wodeappWorkbench) return;
    setMentionVisibleCount(WODEAPP_MENTION_BATCH_SIZE);
  }, [effectiveMentionPaletteSection, mentionOpen, mentionQuery, shellConfig.wodeappWorkbench]);

  useEffect(() => {
    if (!toolMenuSection.startsWith("plugin:")) return;
    if (activePlugin) return;
    setToolMenuSection("commands");
  }, [activePlugin, toolMenuSection]);

  useEffect(() => {
    if (!activeItems.length) {
      setMenuIndex(0);
      return;
    }
    setMenuIndex((current) => Math.max(0, Math.min(current, activeItems.length - 1)));
  }, [activeItems.length]);

  useEffect(() => {
    menuItemRefs.current.length = activeItems.length;
    const target = menuItemRefs.current[menuIndex];
    target?.scrollIntoView({ block: "nearest" });
  }, [menuIndex, activeItems.length]);

  const applyCommandSelection = (command: SlashCommandOption, options?: { replaceSkillDraft?: boolean }) => {
    if (command.source === "skill") {
      applySkillSelection(command.name, options);
      return;
    }
    props.onDraftChange(`/${command.name} `);
    setSlashOpen(false);
    setToolMenuOpen(false);
  };

  const applySkillSelection = (name: string, options?: { replaceSkillDraft?: boolean }) => {
    if (options?.replaceSkillDraft) {
      props.onDraftChange(`[skill ${name}] `);
    } else {
      const editor = editorRef.current;
      if (editor) {
        editor.insertSkillAtSelection(name);
      } else {
        const separator = props.draft.length > 0 && !/\s$/.test(props.draft) ? " " : "";
        props.onDraftChange(`${props.draft}${separator}[skill ${name}] `);
      }
    }
    setSlashOpen(false);
    setToolMenuOpen(false);
  };

  const applyMentionSelection = (item: MentionItem) => {
    if (item.kind === "skill") {
      applySkillSelection(item.value);
    } else {
      props.onInsertMention(item.kind, item.value);
    }
    setMentionOpen(false);
  };

  const applyPluginFileSelection = (file: CloudImportedPluginFile) => {
    const commandName = pluginSlashCommandName(file);
    if (commandName) {
      if (file.objectType === "skill") applySkillSelection(commandName);
      else applyCommandSelection({
        id: `plugin:${file.configObjectId}`,
        name: commandName,
        source: "command",
      });
      return;
    }
    props.onInsertMention("file", file.path);
    setToolMenuOpen(false);
  };

  const applyAgentSelection = (name: string | null) => {
    props.onSelectAgent(name);
    setAgentMenuOpen(false);
    setToolMenuOpen(false);
  };

  const applyExtensionSelection = (entry: McpDirectoryInfo) => {
    props.onDraftChange(entry.composerPrompt ?? `Use ${entry.name} to `);
    setToolMenuOpen(false);
  };

  const openToolMenuSettings = () => {
    const section: ToolMenuSettingsSection = toolMenuSection === "commands" || toolMenuSection === "skills" || toolMenuSection === "mcps"
      ? toolMenuSection
      : "plugins";
    props.onOpenSettingsSection?.(section);
  };

  const acceptActiveItem = () => {
    if (!activeItems.length) return false;
    if (activeMenu === "slash") {
      const command = slashFiltered[menuIndex];
      if (!command) return false;
      applyCommandSelection(command, { replaceSkillDraft: true });
      return true;
    }
    if (activeMenu === "mention") {
      const item = visibleActiveMentionItems[menuIndex];
      if (!item) return false;
      applyMentionSelection(item);
      return true;
    }
    return false;
  };

  // Listen for cross-app focus + draft flush events. The Solid shell uses
  // these from deep-link handlers, the command palette, and the browser
  // pagehide/beforeunload cycle so no in-flight draft is lost.
  useEffect(() => {
    const handleFocus = () => {
      const root = rootRef.current;
      if (!root) return;
      const editable = root.querySelector<HTMLElement>("[contenteditable='true']");
      editable?.focus();
    };
    const handleFlush = () => {
      // onDraftChange always runs synchronously on every keystroke, so this
      // listener is effectively a hook for the shell to signal "we're about
      // to unmount, commit any debounced state". Re-fire with the current
      // draft so downstream stores can checkpoint it.
      props.onDraftChange(draftRef.current);
    };
    window.addEventListener(FOCUS_PROMPT_EVENT, handleFocus);
    window.addEventListener(FLUSH_PROMPT_EVENT, handleFlush);
    window.addEventListener("beforeunload", handleFlush);
    window.addEventListener("pagehide", handleFlush);
    return () => {
      window.removeEventListener(FOCUS_PROMPT_EVENT, handleFocus);
      window.removeEventListener(FLUSH_PROMPT_EVENT, handleFlush);
      window.removeEventListener("beforeunload", handleFlush);
      window.removeEventListener("pagehide", handleFlush);
    };
  }, [props.onDraftChange]);

  const handleKeyDownCapture: React.KeyboardEventHandler<HTMLDivElement> = (event) => {
    // IME composition guard — block Enter while IME is mid-character.
    const imeActive =
      imeComposingRef.current ||
      (event.nativeEvent as KeyboardEvent).isComposing === true ||
      event.keyCode === 229;
    if (event.key === "Enter" && imeActive) {
      return;
    }
    // Escape-to-stop while the agent is busy. Only when no menu is open so
    // Escape can still close menus. First press arms a confirmation prompt
    // for 3s; a second Escape within that window stops the agent.
    const anyMenuOpen = agentMenuOpen || toolMenuOpen || Boolean(activeMenu);
    if (event.key === "Escape" && props.busy && !anyMenuOpen) {
      event.preventDefault();
      if (escapeArmed) {
        disarmEscape();
        void props.onStop();
      } else {
        setEscapeArmed(true);
        if (escapeTimerRef.current) clearTimeout(escapeTimerRef.current);
        escapeTimerRef.current = setTimeout(() => {
          setEscapeArmed(false);
          escapeTimerRef.current = null;
        }, 3000);
      }
      return;
    }
    if (agentMenuOpen) {
      const total = nonDefaultAgents.length + 1;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setAgentMenuIndex((current) => (current + 1) % total);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setAgentMenuIndex((current) => (current - 1 + total) % total);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const selected = agentMenuIndex === 0 ? null : nonDefaultAgents[agentMenuIndex - 1]?.name ?? null;
        props.onSelectAgent(selected);
        setAgentMenuOpen(false);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setAgentMenuOpen(false);
        return;
      }
    }

    if (toolMenuOpen && event.key === "Escape") {
      event.preventDefault();
      setToolMenuOpen(false);
      return;
    }

    // Input history recall (#2012). Only when no menu is consuming the
    // arrow keys and IME composition is not active.
    if (
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      !imeActive &&
      !agentMenuOpen &&
      !toolMenuOpen &&
      (!activeMenu || !activeItems.length)
    ) {
      const history = props.inputHistory ?? [];
      const position = historyPosRef.current;
      if (event.key === "ArrowUp") {
        const startRecall = position === null && props.draft.trim() === "" && history.length > 0;
        const continueRecall = position !== null && position > 0;
        if (startRecall || continueRecall) {
          const nextPos = position === null ? history.length - 1 : position - 1;
          if (position === null) historyStashRef.current = props.draft;
          historyPosRef.current = nextPos;
          historyExpectedRef.current = history[nextPos];
          event.preventDefault();
          props.onDraftChange(history[nextPos]);
          return;
        }
      } else if (position !== null) {
        event.preventDefault();
        const nextPos = position + 1;
        if (nextPos >= history.length) {
          historyPosRef.current = null;
          historyExpectedRef.current = null;
          props.onDraftChange(historyStashRef.current);
        } else {
          historyPosRef.current = nextPos;
          historyExpectedRef.current = history[nextPos];
          props.onDraftChange(history[nextPos]);
        }
        return;
      }
    }

    if (!activeMenu || !activeItems.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMenuIndex((current) => (current + 1) % activeItems.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setMenuIndex((current) => (current - 1 + activeItems.length) % activeItems.length);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      void acceptActiveItem();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSlashOpen(false);
      setMentionOpen(false);
    }
  };

  const addAttachments = async (inputFiles: File[]) => {
    if (!inputFiles.length) return;
    if (!props.attachmentsEnabled) {
      toast.warning(props.attachmentsDisabledReason ?? t("composer.attachments_unavailable"));
      return;
    }

    setAttachmentProcessingCount((count) => count + 1);
    try {

    const accepted: File[] = [];
    const oversize: string[] = [];

    const attachmentLimitBytes = shellConfig.wodeappWorkbench
      ? WORKBENCH_ATTACHMENT_BYTES
      : MAX_ATTACHMENT_BYTES;

    for (const original of inputFiles) {
      const processed = original.type.startsWith("image/") ? await compressImageFile(original) : original;
      if (Number.isFinite(attachmentLimitBytes) && processed.size > attachmentLimitBytes) {
        oversize.push(processed.name || original.name);
        continue;
      }
      accepted.push(processed);
    }

    if (accepted.length) {
      props.onAttachFiles(accepted);
    }

    if (oversize.length) {
      const limitMb = Math.round(attachmentLimitBytes / 1024 / 1024);
      toast.warning(
        oversize.length === 1
          ? t("composer.file_exceeds_limit", { name: oversize[0], limitMb })
          : t("composer.files_exceed_limit", { count: oversize.length, limitMb }),
      );
    }
    } finally {
      setAttachmentProcessingCount((count) => Math.max(0, count - 1));
    }
  };

  const addBrowserImageFromUrl = async (payload: BrowserImageForComposerPayload) => {
    const url = payload.url || payload.sourceUrl || "";
    if (!url) return;
    const bridge = window.__OPENWORK_ELECTRON__?.browser;
    let bridgeError: unknown;
    let bridgeResponse: BrowserImageForComposerPayload | undefined;

    if (bridge?.readImageForComposer) {
      const readImageForComposer = bridge.readImageForComposer;
      const readImage = readImageForComposer as unknown as (
        input: string | BrowserImageForComposerPayload,
      ) => ReturnType<typeof readImageForComposer>;
      try {
        try {
          bridgeResponse = await readImage({ ...payload, url });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error || "");
          if (!message.includes("No image URL found")) throw error;
          bridgeResponse = await readImage(url);
        }
        const file = browserImagePayloadToFile({
          ...payload,
          ...bridgeResponse,
          name: bridgeResponse?.name || payload.name || payload.label,
        });
        if (file) {
          await addAttachments([file]);
          toast.success("图片已添加到对话框");
          return;
        }
      } catch (error) {
        bridgeError = error;
      }
    }

    try {
      const fallbackFile = await fetchBrowserImageInRenderer({ ...payload, url });
      if (fallbackFile) {
        await addAttachments([fallbackFile]);
        toast.success("图片已添加到对话框");
        return;
      }
    } catch {
      // Cross-origin images may only be readable by the desktop bridge.
    }

    if (!bridge?.readImageForComposer) {
      props.onUnsupportedFileLinks([url]);
      return;
    }
    if (bridgeResponse?.error) {
      toast.warning(bridgeResponse.error);
      return;
    }
    if (isMissingBrowserImageHandlerError(bridgeError)) {
      toast.warning("图片添加功能需要重启 WodeAppX 后生效");
      return;
    }
    toast.warning(bridgeError instanceof Error ? bridgeError.message : "没有找到可添加的图片");
  };

  const addAttachmentsRef = useRef(addAttachments);
  const addBrowserImageFromUrlRef = useRef(addBrowserImageFromUrl);
  useEffect(() => {
    addAttachmentsRef.current = addAttachments;
    addBrowserImageFromUrlRef.current = addBrowserImageFromUrl;
  });

  useEffect(() => {
    const handleEditImage = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail = event.detail as LightboxEditImagePayload | undefined;
      if (detail?.file instanceof File) {
        void addAttachmentsRef.current([detail.file]).then(() => {
          toast.success("图片已添加到对话框");
        });
        return;
      }
      const url = detail?.url || detail?.sourceUrl || "";
      if (!url) return;
      void addBrowserImageFromUrlRef.current({
        ...detail,
        url,
        trigger: "lightbox-edit",
      });
    };
    window.addEventListener("openwork:edit-image", handleEditImage);
    return () => window.removeEventListener("openwork:edit-image", handleEditImage);
  }, []);

  useEffect(() => {
    const unsubscribe = window.__OPENWORK_ELECTRON__?.browser?.onImageForComposer?.((payload) => {
      if (payload?.error) {
        toast.warning(payload.error);
        return;
      }
      const file = browserImagePayloadToFile(payload ?? {});
      if (!file) {
        toast.warning("没有找到可添加的图片");
        return;
      }
      void addAttachmentsRef.current([file]).then(() => {
        toast.success("图片已添加到对话框");
      });
    });
    return unsubscribe;
  }, []);

  const activeMcpItems = mcpServers.map((entry) => ({
    entry,
    status: toReactMcpStatus(entry.name, entry, mcpStatuses),
  }));
  const loadMoreMentionItems = useCallback(() => {
    if (!shellConfig.wodeappWorkbench) return;
    setMentionVisibleCount((current) => Math.min(current + WODEAPP_MENTION_BATCH_SIZE, activeMentionItems.length));
  }, [activeMentionItems.length, shellConfig.wodeappWorkbench]);
  const handleMentionMenuScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    if (!hasMoreActiveMentionItems) return;
    const target = event.currentTarget;
    if (target.scrollTop + target.clientHeight >= target.scrollHeight - 48) {
      loadMoreMentionItems();
    }
  }, [hasMoreActiveMentionItems, loadMoreMentionItems]);

  const panelRoundedClass =
    mentionOpen || slashOpen
      ? "rounded-t-[18px] border-t-transparent"
      : "";

  const renderSlashMenu = () => {
    if (!slashOpen) return null;
    return (
      <div className="absolute bottom-full left-[-1px] right-[-1px] z-30">
          <div className="overflow-hidden rounded-t-[20px] border border-dls-border border-b-0 bg-dls-surface shadow-[var(--dls-shell-shadow)]">
            <div
              role="presentation"
              className="max-h-64 overflow-y-auto p-2"
              onMouseDown={(event) => event.preventDefault()}
          >
            {slashFiltered.length > 0 ? (
              <div className="grid gap-1">
                {slashFiltered.map((command, index) => (
                  <button
                    key={command.id}
                    ref={(element) => {
                      menuItemRefs.current[index] = element;
                    }}
                    type="button"
                    className={`flex w-full items-start gap-3 rounded-[16px] px-3 py-2.5 text-left transition-colors hover:bg-gray-2/70 ${activeMenu === "slash" && slashFiltered[menuIndex]?.id === command.id ? "bg-gray-3 text-gray-12" : "text-gray-11"}`}
                    onMouseEnter={() => setMenuIndex(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      applyCommandSelection(command, { replaceSkillDraft: true });
                    }}
                    onClick={(event) => {
                      if (event.detail === 0) applyCommandSelection(command, { replaceSkillDraft: true });
                    }}
                  >
                    <Terminal size={14} className="mt-0.5 shrink-0 text-gray-9" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <div className="truncate text-xs font-semibold">/{command.name}</div>
                        {command.source && command.source !== "command" ? (
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${command.source === "skill" ? "bg-violet-3/40 text-violet-11" : "bg-cyan-3/40 text-cyan-11"}`}>
                            {command.source === "skill" ? t("composer.skill_source") : t("composer.mcps_label")}
                          </span>
                        ) : null}
                      </div>
                      {command.description ? <div className="truncate text-xs text-gray-10">{command.description}</div> : null}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-3 py-2 text-xs text-gray-10">
                {!commandsLoaded && commandsLoading ? t("composer.loading_commands") : t("composer.no_commands")}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderMentionMenu = () => {
    if (!mentionOpen || mentionFiltered.length === 0) return null;
    if (shellConfig.wodeappWorkbench) {
      const activeSection =
        visibleMentionPaletteSections.find((section) => section.id === effectiveMentionPaletteSection) ??
        visibleMentionPaletteSections[0];
      return (
        <div className={useWodeAppTopDock ? "wapp-composer-mention-layer" : "absolute bottom-full left-[-1px] right-[-1px] z-30"}>
          <div className="wx-mention-menu wapp-composer-mention-menu" role="listbox" aria-label="关联智能体、数字资产和技能">
            <div className="wx-mention-palette">
              <div className="wx-mention-sidebar" role="tablist" aria-label="关联类型">
                {visibleMentionPaletteSections.map((section) => {
                  const count = mentionKindCounts[section.id];
                  const active = section.id === effectiveMentionPaletteSection;
                  return (
                    <button
                      key={section.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      className={`wx-mention-nav-item ${active ? "is-active" : ""}`}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setMentionPaletteSection(section.id);
                        setMentionVisibleCount(WODEAPP_MENTION_BATCH_SIZE);
                        setMenuIndex(0);
                      }}
                    >
                      <span className="wx-mention-nav-copy">
                        <strong>{section.label}</strong>
                        <small>{section.hint}</small>
                      </span>
                      <span className="wx-mention-nav-trailing">
                        <small>{count}</small>
                        <ChevronRight aria-hidden />
                      </span>
                    </button>
                  );
                })}
              </div>
              <div className="wx-mention-results">
                <div className="wx-mention-results-head">
                  <span>{activeSection.label}</span>
                  <small>{mentionQuery ? `搜索“${mentionQuery}”` : activeSection.hint}</small>
                </div>
                <div className="wx-mention-menu-list" onScroll={handleMentionMenuScroll}>
                  {visibleActiveMentionItems.length > 0 ? visibleActiveMentionItems.map((item, index) => {
                    const AssetIcon = item.kind === "skill" ? ListPlus : item.assetKind ? digitalAssetKindIcon(item.assetKind) : Box;
                    return (
                      <button
                        key={item.id}
                        ref={(element) => {
                          menuItemRefs.current[index] = element;
                        }}
                        type="button"
                        role="option"
                        aria-selected={activeMenu === "mention" && visibleActiveMentionItems[menuIndex]?.id === item.id}
                        className={`wx-mention-option ${activeMenu === "mention" && visibleActiveMentionItems[menuIndex]?.id === item.id ? "is-active" : ""}`}
                        onMouseEnter={() => setMenuIndex(index)}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          applyMentionSelection(item);
                        }}
                      >
                        <span className="wx-mention-thumb">
                          <AssetIcon aria-hidden />
                        </span>
                        <span className="wx-mention-option-copy">
                          <strong>@{item.label}</strong>
                          <small>{item.description || mentionKindLabel(item)}</small>
                        </span>
                      </button>
                    );
                  }) : (
                    <div className="wx-mention-empty" role="status">
                      当前分类没有可关联内容
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="absolute bottom-full left-[-1px] right-[-1px] z-30">
          <div className="overflow-hidden rounded-t-[20px] border border-dls-border border-b-0 bg-dls-surface shadow-[var(--dls-shell-shadow)]">
            <div
              role="presentation"
              className="max-h-64 overflow-y-auto p-2"
              onMouseDown={(event) => event.preventDefault()}
          >
            <div className="grid gap-1">
              {mentionFiltered.map((item, index) => (
                <button
                  key={item.id}
                  ref={(element) => {
                    menuItemRefs.current[index] = element;
                  }}
                  type="button"
                  className={`flex w-full items-start gap-3 rounded-[16px] px-3 py-2.5 text-left transition-colors hover:bg-gray-2/70 ${activeMenu === "mention" && mentionFiltered[menuIndex]?.id === item.id ? "bg-gray-3 text-gray-12" : "text-gray-11"}`}
                  onMouseEnter={() => setMenuIndex(index)}
                  onClick={() => {
                    applyMentionSelection(item);
                  }}
                >
                  {item.kind === "agent" ? (
                    <Zap size={14} className="mt-0.5 shrink-0 text-gray-9" />
                  ) : item.kind === "app" ? (
                    <AppWindowMac size={14} className="mt-0.5 shrink-0 text-gray-9" />
                  ) : item.kind === "skill" ? (
                    <ListPlus size={14} className="mt-0.5 shrink-0 text-gray-9" />
                  ) : (
                    <FileText size={14} className="mt-0.5 shrink-0 text-gray-9" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold">@{item.label}</div>
                    <div className="truncate text-xs text-gray-10">
                      {item.kind === "agent"
                        ? t("composer.agent_label")
                        : item.kind === "app"
                          ? t("composer.app_kind")
                          : item.kind === "skill"
                            ? "技能"
                            : t("composer.file_kind")}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderAssetPreviewDialog = () => {
    if (!assetPreview || typeof document === "undefined") return null;
    const PreviewIcon =
      assetPreview.mediaKind === "brand"
        ? Box
        : assetPreview.mediaKind === "prompt"
          ? FileText
        : assetPreview.mediaKind === "video"
        ? Film
        : assetPreview.mediaKind === "audio"
          ? Mic
          : assetPreview.mediaKind === "image"
            ? FileImage
            : FileText;
    const sourceUrl = assetPreview.sourceUrl;
    return createPortal(
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
        role="dialog"
        aria-modal="true"
        aria-label={assetPreview.ref.name}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setAssetPreview(null);
        }}
      >
        <div className="flex max-h-[calc(100dvh-32px)] w-[min(760px,calc(100vw-32px))] flex-col overflow-hidden rounded-[20px] border border-dls-border bg-dls-surface shadow-2xl">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-dls-border px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-gray-6 bg-gray-2 text-gray-10">
                <PreviewIcon size={17} />
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-gray-12">{assetPreview.ref.name}</div>
                <div className="truncate text-xs text-gray-10">
                  {assetPreview.ref.kind} · {assetPreviewLabel(assetPreview)}
                  {assetPreview.fileSize ? ` · ${formatBytes(assetPreview.fileSize)}` : ""}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12"
              onClick={() => setAssetPreview(null)}
              aria-label="关闭预览"
              title="关闭"
            >
              <X size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {assetPreview.mediaKind === "brand" ? (
              <div className="grid gap-4">
                {assetPreview.ref.brandColors?.length ? (
                  <section className="rounded-xl border border-gray-6 bg-gray-2 p-4">
                    <div className="mb-3 text-xs font-semibold text-gray-12">品牌色</div>
                    <div className="flex flex-wrap gap-2">
                      {assetPreview.ref.brandColors.map((color) => (
                        <span key={color} className="inline-flex items-center gap-2 rounded-full border border-gray-6 bg-dls-surface px-2.5 py-1 text-xs text-gray-11">
                          <i className="h-4 w-4 rounded-full border border-gray-6" style={{ backgroundColor: color }} />
                          <span>{color}</span>
                        </span>
                      ))}
                    </div>
                  </section>
                ) : null}
                {assetPreview.ref.brandVoice ? (
                  <section className="rounded-xl border border-gray-6 bg-gray-2 p-4">
                    <div className="mb-2 text-xs font-semibold text-gray-12">品牌语气</div>
                    <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-gray-11">{assetPreview.ref.brandVoice}</p>
                  </section>
                ) : null}
                {assetPreview.ref.brandRules ? (
                  <section className="rounded-xl border border-gray-6 bg-gray-2 p-4">
                    <div className="mb-2 text-xs font-semibold text-gray-12">使用规范</div>
                    <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-gray-11">{assetPreview.ref.brandRules}</p>
                  </section>
                ) : null}
                {assetPreview.ref.brandEntries?.length ? (
                  <section className="grid gap-2">
                    {assetPreview.ref.brandEntries.map((entry) => (
                      <article key={entry.id} className="rounded-xl border border-gray-6 bg-gray-2 p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-violet-6/35 bg-violet-3/20 px-2 py-0.5 text-[11px] font-medium text-violet-11">{entry.category}</span>
                          <strong className="min-w-0 text-sm text-gray-12">{entry.title}</strong>
                        </div>
                        <p className="mb-0 mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-gray-11">{entry.description}</p>
                        {entry.keywords?.length ? (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {entry.keywords.slice(0, 8).map((keyword) => (
                              <span key={keyword} className="rounded-full bg-gray-4 px-2 py-0.5 text-[11px] text-gray-10">{keyword}</span>
                            ))}
                          </div>
                        ) : null}
                        {entry.scenePrompt ? (
                          <p className="mb-0 mt-3 whitespace-pre-wrap break-words text-xs leading-5 text-gray-10">场景提示：{entry.scenePrompt}</p>
                        ) : null}
                      </article>
                    ))}
                  </section>
                ) : null}
              </div>
            ) : assetPreview.mediaKind === "prompt" ? (
              <section className="grid gap-3 rounded-xl border border-gray-6 bg-gray-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-gray-12">提示词正文</span>
                  {assetPreview.ref.promptTags?.map((tag) => (
                    <span key={tag} className="max-w-full truncate rounded-full border border-violet-6/35 bg-violet-3/20 px-2 py-0.5 text-[11px] text-violet-11">
                      {tag}
                    </span>
                  ))}
                </div>
                <p className="m-0 whitespace-pre-wrap break-words text-sm leading-6 text-gray-11">
                  {assetPreview.ref.promptText?.trim() || "暂无提示词正文"}
                </p>
              </section>
            ) : assetPreview.mediaKind === "image" ? (
              <div className="grid gap-3">
                {assetPreview.images.map((url, index) => (
                  <figure key={`${url}-${index}`} className="m-0 grid gap-2">
                    <img
                      src={url}
                      alt={assetPreview.ref.name}
                      decoding="async"
                      className="max-h-[68dvh] w-full rounded-xl border border-gray-6 bg-gray-2 object-contain"
                    />
                    {assetPreview.images.length > 1 ? (
                      <figcaption className="text-center text-xs text-gray-10">
                        {index + 1} / {assetPreview.images.length}
                      </figcaption>
                    ) : null}
                  </figure>
                ))}
              </div>
            ) : assetPreview.mediaKind === "video" && sourceUrl ? (
              <video
                src={sourceUrl}
                poster={assetPreview.thumbnailUrl}
                controls
                playsInline
                className="max-h-[68dvh] w-full rounded-xl border border-gray-6 bg-black object-contain"
              />
            ) : assetPreview.mediaKind === "audio" && sourceUrl ? (
              <div className="rounded-xl border border-gray-6 bg-gray-2 p-4">
                <audio src={sourceUrl} controls className="w-full" />
              </div>
            ) : (
              <div className="flex min-h-44 flex-col items-center justify-center gap-3 rounded-xl border border-gray-6 bg-gray-2 p-6 text-center">
                <PreviewIcon size={34} className="text-gray-10" />
                <div className="max-w-full">
                  <div className="truncate text-sm font-semibold text-gray-12">
                    {assetPreview.fileName || assetPreview.ref.name}
                  </div>
                  <div className="mt-1 text-xs text-gray-10">
                    {assetPreview.fileType || assetPreview.ref.meta}
                    {assetPreview.fileSize ? ` · ${formatBytes(assetPreview.fileSize)}` : ""}
                  </div>
                </div>
              </div>
            )}
          </div>
          {sourceUrl ? (
            <div className="flex shrink-0 justify-end border-t border-dls-border px-4 py-3">
              <a
                href={sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-2 rounded-lg border border-dls-border px-3 text-xs font-medium text-gray-11 transition-colors hover:bg-gray-2"
              >
                <ExternalLink size={14} />
                <span>打开原文件</span>
              </a>
            </div>
          ) : null}
        </div>
      </div>,
      document.body,
    );
  };

  return (
    <div
      ref={rootRef}
      className={
        useWodeAppTopDock
          ? `relative z-20 wapp-composer-dock-top px-6 pb-2 pt-0 md:px-10 ${toolMenuOpen ? "z-50" : ""}`
          : shellConfig.wodeappWorkbench
            ? `sticky bottom-0 ${toolMenuOpen ? "z-50" : "z-20"} wapp-composer-dock px-4 pb-2 md:px-8 ${props.compactTopSpacing ? "pt-0" : "pt-1"}`
            : `sticky bottom-0 ${toolMenuOpen ? "z-50" : "z-20"} bg-gradient-to-t from-dls-surface via-dls-surface/95 to-transparent px-4 pb-2 md:px-8 ${props.compactTopSpacing ? "pt-0" : "pt-1"}`
      }
      style={{ contain: "layout style" }}
      onKeyDownCapture={handleKeyDownCapture}
      onCompositionStart={() => {
        imeComposingRef.current = true;
      }}
      onCompositionEnd={() => {
        imeComposingRef.current = false;
      }}
    >
      <div className={useWodeAppTopDock ? "mx-auto w-full max-w-[1106px]" : "max-w-[800px] mx-auto"}>
        {/* Main composer panel — 趴宠 portals into this card so rim position follows the dialog. */}
        <div
          className={`wapp-composer-card relative overflow-visible rounded-[24px] border border-dls-border bg-dls-surface transition-all ${panelRoundedClass}`}
        >
          {props.topAccessory ? <div className="relative z-10">{props.topAccessory}</div> : null}

          {renderMentionMenu()}
          {renderSlashMenu()}

          {props.attachments.length > 0 ? (() => {
            const imageAttachments = props.attachments.filter((attachment) => (
              isImageAttachment(attachment) && Boolean(attachment.previewUrl)
            ));
            const fileAttachments = props.attachments.filter((attachment) => (
              !isImageAttachment(attachment) || !attachment.previewUrl
            ));
            return (
              <div className="mx-5 mt-5 space-y-2.5 md:mx-6">
                {imageAttachments.length > 0 ? (
                  <div className="grid max-w-full grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
                    {imageAttachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="group relative aspect-square min-w-0 overflow-hidden rounded-xl border border-gray-6 bg-gray-2"
                        title={`${attachment.name} · ${formatBytes(attachment.size)}`}
                      >
                        <img
                          src={attachment.previewUrl}
                          alt={attachment.name}
                          decoding="async"
                          className="h-full w-full object-cover"
                        />
                        <button
                          type="button"
                          className="absolute right-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity hover:bg-black/85 group-hover:opacity-100 focus-visible:opacity-100"
                          onClick={() => props.onRemoveAttachment(attachment.id)}
                          title={t("action.remove")}
                          aria-label={t("action.remove")}
                        >
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
                {fileAttachments.length > 0 ? (
                  <div className="flex max-w-full flex-wrap gap-2 overflow-hidden">
                    {fileAttachments.map((attachment) => (
                      <div
                        key={attachment.id}
                        className="flex min-w-0 max-w-full items-center gap-2 rounded-2xl border border-gray-6 bg-gray-2 px-3 py-2 text-xs text-gray-10"
                      >
                        <FileText size={14} className="shrink-0 text-gray-9" />
                        <div className="min-w-0 max-w-[140px]">
                          <div className="truncate text-[12px] font-medium text-gray-11">{attachment.name}</div>
                          <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-gray-10">
                            <span className="shrink-0">{t("composer.file_kind")}</span>
                            <span className="shrink-0">·</span>
                            <span className="min-w-0 truncate">{formatBytes(attachment.size)}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          className="ml-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12"
                          onClick={() => props.onRemoveAttachment(attachment.id)}
                          title={t("action.remove")}
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })() : null}

          {/*
            The pasted-text chip used to render twice — once inline inside
            the Lexical editor (via ComposerPastedTextNode) and again as a
            separate rail here above the composer. Keep only the inline
            chip; its pill already shows label + line count, and the user
            removes it with backspace like any other inline token.
          */}

          {dropzoneActive ? (
            <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-[20px] border-2 border-dashed border-dls-accent bg-[color:color-mix(in_oklab,var(--dls-accent)_10%,transparent)]">
              <div className="rounded-2xl border border-dls-border bg-dls-surface/95 px-5 py-4 text-center backdrop-blur-sm">
                <div className="text-sm font-medium text-dls-text">{t("composer.attach_files")}</div>
                <div className="mt-1 text-xs text-dls-secondary">{t("composer.any_file_type_supported")}</div>
              </div>
            </div>
          ) : null}

          <div className="px-4 pt-3 pb-2">
            {/* Editor */}
            <LexicalPromptEditor
              ref={editorRef}
              value={props.draft}
              mentions={props.mentions}
              pastedText={pastedTextTokens}
              disabled={props.disabled}
              placeholder={
                shellConfig.wodeappWorkbench
                  ? props.busy
                    ? "运行中可继续追加，完成后自动发送…"
                    : "随心输入，/ 唤起命令，@ 引用技能与素材…"
                  : t("composer.placeholder")
              }
              onChange={props.onDraftChange}
              onSubmit={handleEditorSubmit}
              onExpandPastedText={handleExpandPastedText}
              onPaste={(event) => {
                // Paste policy:
                // 1. Actual files on the clipboard -> attach them.
                // 2. Plain text/URL text -> DO NOTHING. Let Lexical's PlainTextPlugin
                //    handle the paste natively so newlines render correctly
                //    and no content is silently promoted into attachments or
                //    browser targets. Dropped uri-list values are handled in
                //    onDrop, where the user's file/resource intent is clearer.
                const files = Array.from(event.clipboardData?.files ?? []);
                if (files.length) {
                  event.preventDefault();
                  void addAttachments(files);
                  return;
                }

                const text = event.clipboardData?.getData("text/plain") ?? "";

                // Plain text pastes are left to Lexical as editable content
                // (no collapse-to-chip).

                if (
                  text.trim() &&
                  (props.isRemoteWorkspace || props.isSandboxWorkspace) &&
                  /file:\/\/|(^|\s)\/(Users|home|var|etc|opt|tmp|private|Volumes|Applications)\//.test(text)
                ) {
                  const attachedFiles = props.attachments.map((attachment) => attachment.file);
                  toast.warning(t("composer.remote_worker_paste_warning"), {
                    action:
                      props.onUploadInboxFiles && attachedFiles.length > 0
                        ? {
                            label: t("composer.upload_to_shared_folder"),
                            onClick: () => void props.onUploadInboxFiles?.(attachedFiles),
                          }
                        : undefined,
                  });
                  // Intentionally no preventDefault — the notice is advisory,
                  // the paste still goes through the editor.
                }
              }}
              onDragOver={(event) => {
                if (event.dataTransfer?.files?.length || hasBrowserImageDrag(event.dataTransfer ?? null)) {
                  event.preventDefault();
                  if (!dropzoneActive) setDropzoneActive(true);
                }
              }}
              onDragLeave={(event) => {
                const nextTarget = event.relatedTarget;
                if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
                setDropzoneActive(false);
              }}
              onDrop={(event) => {
                const files = Array.from(event.dataTransfer?.files ?? []);
                setDropzoneActive(false);
                if (files.length) {
                  event.preventDefault();
                  void addAttachments(files);
                  return;
                }
                const browserImageDrop = parseBrowserImageDrop(event.dataTransfer ?? null);
                if (browserImageDrop?.url) {
                  event.preventDefault();
                  void addBrowserImageFromUrl(browserImageDrop);
                  return;
                }
                const htmlImageUrl = browserImageUrlFromDroppedHtml(event.dataTransfer ?? null);
                if (htmlImageUrl) {
                  event.preventDefault();
                  void addBrowserImageFromUrl({ url: htmlImageUrl, trigger: "drop" });
                  return;
                }
                const productVisualCandidate = event.dataTransfer?.getData("application/x-wodeapp-product-visual-candidate") || "";
                if (productVisualCandidate) {
                  try {
                    const parsed = JSON.parse(productVisualCandidate) as { label?: string; url?: string };
                    if (parsed.url) {
                      event.preventDefault();
                      void addBrowserImageFromUrl({ url: parsed.url, label: parsed.label, trigger: "drop" });
                      return;
                    }
                  } catch {
                    // Fall through to generic URL drop handling.
                  }
                }
                const uriList = event.dataTransfer
                  ? parseClipboardUriList(event.dataTransfer)
                  : [];
                if (uriList.length) {
                  event.preventDefault();
                  const imageUrl = uriList.find(isProbablyImageUrl);
                  if (imageUrl) {
                    void addBrowserImageFromUrl({ url: imageUrl, trigger: "drop" });
                    return;
                  }
                  props.onUnsupportedFileLinks(uriList);
                }
              }}
            />

            {/* Action row — attachments, quick actions, model controls, and send */}
            <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                <input
                  ref={(element) => {
                    fileInput = element ?? undefined;
                  }}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    if (files.length) void addAttachments(files);
                    event.currentTarget.value = "";
                  }}
                />
                <button
                  type="button"
                  className={`inline-flex h-9 max-h-9 w-9 items-center justify-center rounded-md text-gray-10 transition-colors hover:bg-gray-3 ${
                    !props.attachmentsEnabled ? "cursor-not-allowed opacity-60" : ""
                  }`}
                  onClick={() => {
                    if (!props.attachmentsEnabled) return;
                    fileInput?.click();
                  }}
                  disabled={!props.attachmentsEnabled}
                  title={props.attachmentsDisabledReason ?? t("composer.attach_files")}
                >
                  <Paperclip size={16} />
                </button>
                <div
                  ref={toolMenuRef}
                  className="relative"
                  onMouseDown={(event) => {
                    const target = event.target;
                    if (target instanceof Element && target.closest("button")) event.preventDefault();
                  }}
                >
                  <button
                    type="button"
                    className={`inline-flex h-9 max-h-9 w-9 items-center justify-center rounded-md transition-colors ${toolMenuOpen ? "bg-gray-3 text-gray-12" : "text-gray-10 hover:bg-gray-3"}`}
                    onClick={() => {
                      setMentionOpen(false);
                      setMentionItems([]);
                      setSlashOpen(false);
                      setToolMenuOpen((value) => !value);
                    }}
                    aria-expanded={toolMenuOpen}
                    aria-haspopup="dialog"
                    title={t("composer.tools_label")}
                  >
                    <Plug size={16} />
                  </button>
                  {toolMenuOpen ? (
                    <div className="absolute bottom-full left-0 z-40 mb-3 w-[min(calc(100vw-2.5rem),34rem)] overflow-hidden rounded-[22px] border border-dls-border bg-dls-surface shadow-[var(--dls-shell-shadow)]">
                      <div className="grid grid-cols-[152px_minmax(0,1fr)] sm:grid-cols-[176px_minmax(0,1fr)]">
                        <div className="border-r border-dls-border bg-gray-2/30 p-2">
                          {([
                            ["agents", t("composer.agents_label")],
                            ["commands", t("dashboard.commands")],
                            ["skills", t("dashboard.skills")],
                            ["extensions", "Extensions"],
                            ["mcps", t("composer.mcps_label")],
                          ] as const).map(([section, label]) => (
                            <button
                              key={section}
                              type="button"
                              className={`mb-1 flex w-full items-center justify-between rounded-[16px] px-3 py-2.5 text-left text-sm transition-colors ${toolMenuSection === section ? "bg-gray-3 text-gray-12" : "text-gray-11 hover:bg-gray-2"}`}
                              onClick={() => setToolMenuSection(section)}
                            >
                              <span className="truncate">{label}</span>
                              <ChevronRight size={14} className="shrink-0 text-gray-9" />
                            </button>
                          ))}
                          {pluginSections.length > 0 ? <div className="my-2 border-t border-dls-border" /> : null}
                          {pluginSections.map(({ section, plugin }) => (
                            <button
                              key={plugin.pluginId}
                              type="button"
                              className={`mb-1 flex w-full items-center justify-between rounded-[16px] px-3 py-2.5 text-left text-sm transition-colors ${toolMenuSection === section ? "bg-gray-3 text-gray-12" : "text-gray-11 hover:bg-gray-2"}`}
                              onClick={() => setToolMenuSection(section)}
                            >
                              <span className="truncate">{plugin.name}</span>
                              <ChevronRight size={14} className="shrink-0 text-gray-9" />
                            </button>
                          ))}
                        </div>
                        <div className="max-h-72 overflow-y-auto p-2">
                          <div className="mb-2 flex justify-end border-b border-dls-border px-1 pb-2">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 rounded-full border border-dls-border px-3 py-1.5 text-[12px] font-medium text-gray-11 transition-colors hover:bg-gray-2"
                              onClick={() => {
                                setToolMenuOpen(false);
                                openToolMenuSettings();
                              }}
                            >
                              <Settings size={12} />
                              {t("composer.configure")}
                            </button>
                          </div>
                          {toolMenuSection === "agents" ? (
                            <div className="grid gap-1">
                              <button
                                type="button"
                                className={`flex w-full items-start gap-3 rounded-[16px] px-3 py-2.5 text-left transition-colors hover:bg-gray-2/70 ${props.selectedAgent === null ? "bg-gray-2 text-gray-12" : "text-gray-11"}`}
                                onClick={() => applyAgentSelection(null)}
                              >
                                <Zap size={14} className="mt-0.5 shrink-0 text-gray-9" />
                                <div className="min-w-0 flex-1 truncate text-xs font-semibold">{t("composer.default_agent")}</div>
                                {props.selectedAgent === null ? <Check size={14} className="mt-0.5 shrink-0 text-gray-10" /> : null}
                              </button>
                              {nonDefaultAgents.map((agent) => {
                                const active = props.selectedAgent === agent.name;
                                return (
                                  <button
                                    key={agent.name}
                                    type="button"
                                    className={`flex w-full items-start gap-3 rounded-[16px] px-3 py-2.5 text-left transition-colors hover:bg-gray-2/70 ${active ? "bg-gray-2 text-gray-12" : "text-gray-11"}`}
                                    onClick={() => applyAgentSelection(agent.name)}
                                  >
                                    <Zap size={14} className="mt-0.5 shrink-0 text-gray-9" />
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate text-xs font-semibold">{formatAgentDisplayName(agent.name)}</div>
                                      {agent.description ? <div className="truncate text-xs text-gray-10">{agent.description}</div> : null}
                                    </div>
                                    {active ? <Check size={14} className="mt-0.5 shrink-0 text-gray-10" /> : null}
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                          {toolMenuSection === "commands" ? (
                            toolCommandItems.length > 0 ? (
                              <div className="grid gap-1">
                                {toolCommandItems.map((command) => (
                                  <button
                                    key={command.id}
                                    type="button"
                                    className="flex w-full items-start gap-3 rounded-[16px] px-3 py-2.5 text-left text-gray-11 transition-colors hover:bg-gray-2/70"
                                    onClick={() => applyCommandSelection(command)}
                                  >
                                    <Terminal size={14} className="mt-0.5 shrink-0 text-gray-9" />
                                    <div className="min-w-0">
                                      <div className="truncate text-xs font-semibold text-gray-11">/{command.name}</div>
                                      {command.description ? <div className="truncate text-xs text-gray-10">{command.description}</div> : null}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div className="px-3 py-2 text-xs text-gray-10">
                                {!commandsLoaded && commandsLoading ? t("composer.loading_commands") : t("composer.no_commands")}
                              </div>
                            )
                          ) : null}
                          {toolMenuSection === "skills" ? (
                            (skills.length > 0 || toolSkillItems.length > 0) ? (
                              <div className="grid gap-1">
                                {[...toolSkillItems, ...skills.filter((skill) => !toolSkillItems.some((command) => command.name === skill.name)).map((skill) => ({ id: `skill:${skill.name}`, name: skill.name, description: skill.description, source: "skill" as const }))].map((command) => (
                                  <button
                                    key={command.id}
                                    type="button"
                                    className="flex w-full items-start gap-3 rounded-[16px] px-3 py-2.5 text-left text-gray-11 transition-colors hover:bg-gray-2/70"
                                    onClick={() => applyCommandSelection(command)}
                                  >
                                    <Zap size={14} className="mt-0.5 shrink-0 text-gray-9" />
                                    <div className="min-w-0">
                                      <div className="truncate text-xs font-semibold text-gray-11">/{command.name}</div>
                                      {command.description ? <div className="truncate text-xs text-gray-10">{command.description}</div> : null}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div className="px-3 py-2 text-xs text-gray-10">
                                {(!skillsLoaded && skillsLoading) || (!commandsLoaded && commandsLoading) ? t("composer.loading_commands") : t("context_panel.no_skills")}
                              </div>
                            )
                          ) : null}
                          {toolMenuSection === "mcps" ? (
                            activeMcpItems.length > 0 ? (
                              <div className="grid gap-1">
                                {activeMcpItems.map(({ entry, status }) => (
                                  <div key={entry.name} className="flex items-start gap-3 rounded-[16px] px-3 py-2.5 text-gray-11">
                                    <Plug size={14} className="mt-0.5 shrink-0 text-gray-9" />
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="truncate text-xs font-semibold text-gray-11">{entry.name}</div>
                                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${mcpStatusBadgeClass(status)}`}>
                                          {formatMcpStatusLabel(status)}
                                        </span>
                                      </div>
                                      <div className="truncate text-xs text-gray-10">{entry.config.type === "remote" ? entry.config.url ?? entry.config.command?.join(" ") ?? "Remote MCP" : entry.config.command?.join(" ") ?? "Local MCP"}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="px-3 py-2 text-xs text-gray-10">
                                {!mcpLoaded && mcpLoading ? t("composer.loading_commands") : (mcpStatus ?? t("context_panel.no_mcp"))}
                              </div>
                            )
                          ) : null}
                          {toolMenuSection === "extensions" ? (
                            composerExtensions.length > 0 ? (
                              <div className="grid gap-1">
                                {composerExtensions.map((entry) => (
                                  <button
                                    key={entry.id ?? entry.serverName ?? entry.name}
                                    type="button"
                                    className="flex w-full items-start gap-3 rounded-[16px] px-3 py-2.5 text-left text-gray-11 transition-colors hover:bg-gray-2/70"
                                    onClick={() => applyExtensionSelection(entry)}
                                  >
                                    <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-dls-border bg-white shadow-sm">
                                      {extensionIcon(entry, 16)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="truncate text-xs font-semibold text-gray-11">{entry.name}</div>
                                        {entry.defaultEnabled ? (
                                          <span className="shrink-0 rounded-full bg-green-3 px-2 py-0.5 text-[10px] font-medium text-green-11">Enabled</span>
                                        ) : null}
                                      </div>
                                      <div className="truncate text-xs text-gray-10">{entry.description}</div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div className="px-3 py-2 text-xs text-gray-10">No extensions enabled. Open Extensions to enable them.</div>
                            )
                          ) : null}
                          {activePlugin ? (
                            activePlugin.files.length > 0 ? (
                              <div className="grid gap-1">
                                {activePlugin.files.map((file) => (
                                  <button
                                    key={`${file.configObjectId}:${file.path}`}
                                    type="button"
                                    className="flex w-full items-start gap-3 rounded-[16px] px-3 py-2.5 text-left text-gray-11 transition-colors hover:bg-gray-2/70"
                                    onClick={() => applyPluginFileSelection(file)}
                                  >
                                    <FileText size={14} className="mt-0.5 shrink-0 text-gray-9" />
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="truncate text-xs font-semibold text-gray-11">{file.title}</div>
                                        <span className="shrink-0 rounded-full bg-gray-3 px-2 py-0.5 text-[10px] font-medium text-gray-11">
                                          {formatPluginObjectType(file.objectType)}
                                        </span>
                                      </div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div className="px-3 py-2 text-xs text-gray-10">No plugin files imported yet.</div>
                            )
                          ) : toolMenuSection.startsWith("plugin:") ? (
                            <div className="px-3 py-2 text-xs text-gray-10">
                              {!pluginsLoaded && pluginsLoading ? t("composer.loading_commands") : "Plugin files are unavailable."}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                {/* Agent picker (#2101/#1971). Shows the active agent and lets
                    the user switch without leaving the composer. The same
                    selection is reachable from the plug menu, the command
                    palette ("Switch agent"), and @agent mentions. */}
                <div ref={agentMenuRef} className={showAgentPicker ? "relative" : "hidden"}>
                  <button
                    type="button"
                    className="flex h-9 max-h-9 items-center gap-1 rounded-md px-1.5 text-[12px] font-medium text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12"
                    onClick={() => setAgentMenuOpen((value) => !value)}
                    aria-expanded={agentMenuOpen}
                    title={t("composer.agent_label")}
                  >
                    <span className="max-w-[140px] truncate">{props.agentLabel}</span>
                    <ChevronDown size={13} />
                  </button>
                  {agentMenuOpen ? (
                    <div className="absolute left-0 bottom-full z-40 mb-2 w-64 overflow-hidden rounded-[18px] border border-dls-border bg-dls-surface shadow-[var(--dls-shell-shadow)]">
                      <div className="border-b border-dls-border px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-10">
                        {t("composer.agent_label")}
                      </div>
                      <div
                        role="presentation"
                        className="max-h-64 space-y-1 overflow-y-auto p-2"
                        onMouseDown={(event) => event.preventDefault()}
                      >
                        <button
                          ref={(element) => {
                            agentItemRefs.current[0] = element;
                          }}
                          type="button"
                          className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors ${!props.selectedAgent || agentMenuIndex === 0 ? "bg-gray-2 text-gray-12" : "text-gray-11 hover:bg-gray-2/70"}`}
                          onMouseEnter={() => setAgentMenuIndex(0)}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            applyAgentSelection(null);
                          }}
                        >
                          <span>{t("composer.default_agent")}</span>
                          {!props.selectedAgent ? <Check size={14} className="text-gray-10" /> : null}
                        </button>
                        {nonDefaultAgents.map((agent, index) => {
                          const active = props.selectedAgent === agent.name;
                          return (
                            <button
                              key={agent.name}
                              ref={(element) => {
                                agentItemRefs.current[index + 1] = element;
                              }}
                              type="button"
                              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs transition-colors ${active || agentMenuIndex === index + 1 ? "bg-gray-2 text-gray-12" : "text-gray-11 hover:bg-gray-2/70"}`}
                              onMouseEnter={() => setAgentMenuIndex(index + 1)}
                              onMouseDown={(event) => {
                                event.preventDefault();
                                applyAgentSelection(agent.name);
                              }}
                            >
                              <span className="truncate">{formatAgentDisplayName(agent.name)}</span>
                              {active ? <Check size={14} className="text-gray-10" /> : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>

                <ModelSelect
                  open={props.modelPickerOpen}
                  value={props.selectedModel}
                  onOpenChange={props.onModelPickerOpenChange}
                  onChange={props.onModelChange}
                />
                <WodeAppExternalDirectoryAccessSelect />
                {props.modelUnavailable && !shellConfig.wodeappWorkbench ? (
                  <span className="text-xs font-medium text-red-10">Model no longer available</span>
                ) : null}

                <ModelBehaviorSelect
                  value={props.modelVariant}
                  label={props.modelVariantLabel}
                  options={props.modelBehaviorOptions}
                  onChange={props.onModelVariantChange}
                />
              </div>

              {/*
                Action area.
                - Idle: single send button.
                - Busy: Stop on the left, then the same send button (queues
                  above the transcript until the agent finishes). Escape arms
                  a "Hit Escape again to stop" prompt.
              */}
              <div className="ml-auto flex shrink-0 items-end gap-1.5">
                {props.busy ? (
                  <>
                    {escapeArmed ? (
                      <span className="self-center pr-1 text-[12px] font-medium text-gray-10">
                        {t("composer.escape_to_stop")}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={props.onStop}
                      className="mr-2 inline-flex h-9 max-h-9 items-center gap-2 rounded-full border border-dls-border bg-transparent px-4 text-[13px] font-medium text-gray-11 transition-colors hover:bg-gray-3"
                      title={t("composer.stop")}
                    >
                      <Square size={12} fill="currentColor" />
                      <span>{t("composer.stop")}</span>
                    </button>
                    <button
                      type="button"
                      className={`inline-flex h-9 max-h-9 w-9 items-center justify-center rounded-full transition-colors ${
                        localSpeech.listening
                          ? "bg-red-3 text-red-11 animate-pulse"
                          : "text-gray-10 hover:bg-gray-3 hover:text-gray-12"
                      } ${!localSpeech.supported || props.disabled || localSpeech.transcribing ? "cursor-not-allowed opacity-50" : ""}`}
                      onClick={localSpeech.toggle}
                      disabled={!localSpeech.supported || props.disabled || localSpeech.transcribing}
                      title={!localSpeech.supported ? "当前系统不支持本地语音输入" : localSpeech.transcribing ? "正在本地识别" : localSpeech.listening ? "停止并识别" : "本地语音输入"}
                      aria-label={localSpeech.transcribing ? "正在本地识别" : localSpeech.listening ? "停止并识别" : "本地语音输入"}
                      aria-pressed={localSpeech.listening}
                    >
                      {localSpeech.transcribing ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
                    </button>
                    <button
                      type="button"
                      onClick={canSend ? props.onQueue : undefined}
                      disabled={!canSend}
                      className={`relative inline-flex h-9 max-h-9 items-center gap-2 rounded-full px-4 text-[13px] font-medium transition-colors ${
                        canSend
                          ? "bg-[var(--dls-accent)] text-[var(--dls-accent-fg)] hover:bg-[var(--dls-accent-hover)]"
                          : "bg-gray-4 text-gray-10"
                      }`}
                      title={attachmentsProcessing ? "正在处理附件" : t("composer.queue_hint")}
                    >
                      <ArrowUp size={15} />
                      <span>{t("composer.run_task")}</span>
                      {props.queuedCount > 0 ? (
                        <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-gray-12 px-1 text-[10px] font-semibold text-gray-1">
                          {props.queuedCount}
                        </span>
                      ) : null}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className={`inline-flex h-9 max-h-9 w-9 items-center justify-center rounded-full transition-colors ${
                        localSpeech.listening
                          ? "bg-red-3 text-red-11 animate-pulse"
                          : "text-gray-10 hover:bg-gray-3 hover:text-gray-12"
                      } ${!localSpeech.supported || props.disabled || localSpeech.transcribing ? "cursor-not-allowed opacity-50" : ""}`}
                      onClick={localSpeech.toggle}
                      disabled={!localSpeech.supported || props.disabled || localSpeech.transcribing}
                      title={!localSpeech.supported ? "当前系统不支持本地语音输入" : localSpeech.transcribing ? "正在本地识别" : localSpeech.listening ? "停止并识别" : "本地语音输入"}
                      aria-label={localSpeech.transcribing ? "正在本地识别" : localSpeech.listening ? "停止并识别" : "本地语音输入"}
                      aria-pressed={localSpeech.listening}
                    >
                      {localSpeech.transcribing ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
                    </button>
                    <button
                      type="button"
                      onClick={canSend ? props.onSend : undefined}
                      disabled={props.disabled || !canSend}
                      className={`inline-flex h-9 max-h-9 items-center gap-2 rounded-full px-4 text-[13px] font-medium transition-colors ${
                        !canSend || props.disabled
                          ? "bg-gray-4 text-gray-10"
                          : "bg-[var(--dls-accent)] text-[var(--dls-accent-fg)] hover:bg-[var(--dls-accent-hover)]"
                      }`}
                      title={attachmentsProcessing ? "正在处理附件" : t("composer.run_task")}
                    >
                      <ArrowUp size={15} />
                      <span>{t("composer.run_task")}</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

      </div>
      {renderAssetPreviewDialog()}
    </div>
  );
}
