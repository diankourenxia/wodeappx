/** @jsxImportSource react */
import * as React from "react";
import { createPortal } from "react-dom";
import { Building2, CloudDownload, FileText, Film, ImagePlus, Mic, Package, PenLine, Search, Share2, Sparkles, Trash2, Upload, UserRound, ScrollText } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { ImageLightbox, type LightboxImage } from "@/components/markdown/image-lightbox";

import {
  ASSET_UPLOAD_ENTRY,
  BRAND_CREATE_ENTRY,
  DIGITAL_ASSET_FILTERS,
  PRODUCT_UPLOAD_ENTRY,
  PROMPT_ASSET_CATEGORIES,
  digitalAssetKindIcon,
  digitalAssetSearchText,
  digitalAssetToMention,
  type DigitalAssetFilter,
  type DigitalAssetItem,
  type DigitalAssetKind,
  type BrandAssetEntry,
  type PromptAssetCategory,
} from "./digital-assets-data";
import { analyzeProductImagesWithAI, extractBrandWithAI, lookupBrandWithWebSearch } from "./digital-assets-ai";
import {
  getDigitalAssetsList,
  deleteLocalDigitalAssets,
  isLocalDigitalAsset,
  saveLocalDigitalAsset,
  useDigitalAssetsList,
  useDigitalAssetsSignedIn,
} from "./digital-assets-store";
import { queueAssetMentionInsert, rememberAssetMention, useWodeAppWorkbench } from "./wodeapp-workbench-context";
import {
  handoffOptionsForAsset,
  requestAgentHandoff,
  requestProductGenerationHandoff,
} from "./wodeapp-agent-handoff";
import { WODEAPP_FEISHU_MCP_SERVER } from "./runtime-projects";
import { WodeAppAssetTileContent } from "./wodeapp-asset-tile";
import {
  WODEAPP_ASSET_SURFACE_MODE_EVENT,
  readWodeAppAssetSurfaceMode,
  type WodeAppAssetSurfaceModeEventDetail,
} from "./wodeapp-asset-surface-mode";
import {
  isDigitalAssetDocumentKind,
  resolveAssetDocumentHtml,
} from "./digital-asset-document-format";
import {
  canShareGenerationHistory,
  createGenerationHistoryShare,
  generationHistoryShareToastMessage,
} from "./wodeapp-generation-history-share";
import { openDesktopUrl } from "@/app/lib/desktop";

type ImageAssetDraft = {
  name: string;
  notes: string;
  images: string[];
};

type ProductAssetDraft = {
  name: string;
  info: string;
  images: string[];
};

type BrandAssetDraft = {
  sourceText: string;
  name: string;
  colors: string;
  voice: string;
  rules: string;
  logoImages: string[];
  resourceImages: string[];
  entries: BrandAssetEntry[];
};

type LocalFileDraft = {
  url: string;
  name: string;
  type: string;
  size: number;
};

type GenericAssetDraft = {
  kind: DigitalAssetFilter;
  name: string;
  notes: string;
  promptCategory: PromptAssetCategory;
  tags: string;
  files: LocalFileDraft[];
};

type AssetAiFeedback = {
  status: "idle" | "running" | "success" | "error";
  message: string;
};

const DEFAULT_BRAND_COLORS = "#FF6600, #C24F00, #1A1A1A";

const KNOWN_BRAND_COLOR_PRESETS: Array<{ match: RegExp; colors: string[] }> = [
  { match: /(苏泊尔|supor)/i, colors: ["#FF6600", "#1A1A1A", "#FFFFFF"] },
];

function emptyImageDraft(): ImageAssetDraft {
  return { name: "", notes: "", images: [] };
}

function emptyProductDraft(): ProductAssetDraft {
  return {
    name: "",
    info: "",
    images: [],
  };
}

function emptyBrandDraft(): BrandAssetDraft {
  return {
    sourceText: "",
    name: "",
    colors: DEFAULT_BRAND_COLORS,
    voice: "",
    rules: "",
    logoImages: [],
    resourceImages: [],
    entries: [],
  };
}

function emptyGenericDraft(kind: DigitalAssetFilter = "提示词"): GenericAssetDraft {
  return { kind, name: "", notes: "", promptCategory: "通用", tags: "", files: [] };
}

function emptyAiFeedback(): AssetAiFeedback {
  return { status: "idle", message: "" };
}

function isAssetCreationItem(item: DigitalAssetItem): boolean {
  return item.preview === "assetUpload" || item.preview === "productUpload" || item.preview === "brandCreate" || item.preview === "assetCreate";
}

function isGenerationHistoryItem(item: DigitalAssetItem): boolean {
  return item.assetUse === "生成历史";
}

function isHttpShareUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

async function writeClipboardText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Electron WebView may reject Clipboard API while focus is moving; fall back to execCommand.
    }
  }

  if (typeof document === "undefined") return false;

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}

const FILTER_DOT_COLORS: Record<DigitalAssetFilter, string> = {
  "全部": "#C24F00",
  "商品库": "#C24F00",
  "品牌库": "#B34700",
  "提示词": "#8A6A4A",
  "图片": "#C24F00",
  "文件": "#8A6A4A",
  "视频": "#B34700",
  "剧本": "#8A6A4A",
  "声音": "#B34700",
  "真人": "#8A6A4A",
};

const ASSET_VISIBLE_FILTERS = DIGITAL_ASSET_FILTERS;
const ASSET_INITIAL_RENDER_FALLBACK = 16;
const ASSET_RENDER_OVERSCAN_ROWS = 0;
const ASSET_RENDER_BATCH_ROWS = 2;

function assetScrollRoot(element: HTMLElement | null): HTMLElement | null {
  return element?.closest(".wapp-surface-scroll-host") as HTMLElement | null;
}

function getAssetGridColumnCount(grid: HTMLElement): number {
  if (typeof window === "undefined") return 4;
  const columns = window
    .getComputedStyle(grid)
    .gridTemplateColumns
    .split(" ")
    .filter((column) => column && column !== "none");
  return Math.max(1, columns.length || 4);
}

function estimateAssetRenderWindow(grid: HTMLElement): { limit: number; batchSize: number } {
  if (typeof window === "undefined") {
    return {
      limit: ASSET_INITIAL_RENDER_FALLBACK,
      batchSize: ASSET_INITIAL_RENDER_FALLBACK,
    };
  }
  const style = window.getComputedStyle(grid);
  const columns = getAssetGridColumnCount(grid);
  const firstCard = grid.querySelector<HTMLElement>(".wx-asset-card");
  const cardHeight = firstCard?.getBoundingClientRect().height || 210;
  const rowGap = Number.parseFloat(style.rowGap || style.gap || "0") || 18;
  const rowHeight = Math.max(1, cardHeight + rowGap);
  const scrollRoot = assetScrollRoot(grid);
  const gridRect = grid.getBoundingClientRect();
  const rootRect = scrollRoot?.getBoundingClientRect();
  const availableHeight = scrollRoot
    ? scrollRoot.clientHeight - Math.max(0, gridRect.top - (rootRect?.top ?? 0))
    : window.innerHeight - Math.max(0, gridRect.top);
  const visibleRows = Math.max(1, Math.ceil(Math.max(1, availableHeight) / rowHeight));
  const initialRows = visibleRows + ASSET_RENDER_OVERSCAN_ROWS;
  return {
    limit: Math.max(columns, columns * initialRows),
    batchSize: Math.max(columns, columns * ASSET_RENDER_BATCH_ROWS),
  };
}

const GENERIC_CREATE_LABELS: Record<DigitalAssetKind, { action: string; title: string; meta: string; accept: string }> = {
  "商品库": { action: "新建商品", title: "新建商品", meta: "商品图 · 名称 · 描述", accept: "image/*" },
  "品牌库": { action: "新建品牌", title: "新建品牌", meta: "Logo · 色彩 · 语气 · 规范", accept: "image/*" },
  "提示词": { action: "新建提示词", title: "新建提示词", meta: "文本 · 标签 · 分类", accept: ".txt,.md,text/plain,text/markdown" },
  "图片": { action: "上传图片", title: "上传图片", meta: "图片素材 · 海报 · 参考图", accept: "image/*" },
  "文件": { action: "上传文件", title: "上传文件", meta: "PDF · Word · 表格 · 简报", accept: ".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.txt,.md,.json,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/markdown,text/csv,application/json" },
  "视频": { action: "上传视频", title: "上传视频", meta: "MP4 · MOV · WebM", accept: "video/*" },
  "剧本": { action: "新增剧本", title: "新增剧本", meta: "文本 · 分镜 · 口播", accept: ".txt,.md,text/plain,text/markdown" },
  "声音": { action: "上传声音", title: "上传声音", meta: "MP3 · WAV · M4A", accept: "audio/*" },
  "真人": { action: "新建真人", title: "新建真人", meta: "头像 · 设定 · 参考图", accept: "image/*" },
};

function parseBrandColors(value: string): string[] {
  return uniqueBrandColors(value.split(/[，,\s]+/));
}

function normalizeHexColor(value: string): string {
  const match = value.trim().match(/^#?([0-9a-f]{6})$/i);
  return match ? `#${match[1].toUpperCase()}` : "";
}

function uniqueBrandColors(colors: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  colors.forEach((color) => {
    const hex = normalizeHexColor(color);
    if (!hex || seen.has(hex)) return;
    seen.add(hex);
    normalized.push(hex);
  });
  return normalized.slice(0, 6);
}

function extractHexColorsFromText(value: string): string[] {
  return uniqueBrandColors(value.match(/#[0-9a-f]{6}\b/gi) || []);
}

function knownBrandColorsFor(value: string): string[] {
  const preset = KNOWN_BRAND_COLOR_PRESETS.find((item) => item.match.test(value));
  return preset ? preset.colors : [];
}

function resolveBrandColorList(input: {
  aiColors?: string[];
  brandName?: string;
  sourceText?: string;
}): string[] {
  const aiColors = uniqueBrandColors(input.aiColors || []);
  if (aiColors.length) return aiColors;

  const sourceColors = extractHexColorsFromText(input.sourceText || "");
  if (sourceColors.length) return sourceColors;

  return uniqueBrandColors(knownBrandColorsFor([input.brandName || "", input.sourceText || ""].join("\n")));
}

function hasMeaningfulBrandDetails(value: string): boolean {
  const text = value.trim().replace(/^(?:品牌名称|品牌名|名称|brand name|brand)\s*[:：]\s*/i, "").trim();
  if (!text) return false;
  if (text.length >= 24) return true;
  return /[，,。；;\n]|定位|人群|色彩|颜色|语气|口吻|风格|禁用|规范|场景|产品|服务|平台|行业|卖点|价值|口号|slogan|logo/i.test(text);
}

function buildBrandExtractionText(draft: BrandAssetDraft): string {
  return [
    draft.name.trim() ? `品牌名称：${draft.name.trim()}` : "",
    draft.sourceText.trim() ? `品牌资料：${draft.sourceText.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function getBrandLookupName(draft: BrandAssetDraft): string {
  const raw = draft.name.trim() || draft.sourceText.trim();
  return raw
    .replace(/^(?:品牌名称|品牌名|名称|brand name|brand)\s*[:：]\s*/i, "")
    .split(/\r?\n/)[0]
    .trim()
    .slice(0, 80);
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function normalizeBrandEntries(entries: Array<Partial<BrandAssetEntry>> | undefined, idPrefix = "brand-entry"): BrandAssetEntry[] {
  const normalized: BrandAssetEntry[] = [];
  (entries || []).forEach((entry, index) => {
    const title = entry.title?.trim();
    const description = entry.description?.trim();
    if (!title || !description) return;
    const category = entry.category?.trim() || "条目";
    const keywords = (entry.keywords || [])
      .map((keyword) => keyword.trim())
      .filter(Boolean)
      .slice(0, 8);
    normalized.push({
      id: entry.id?.trim() || `${idPrefix}-${index + 1}`,
      category,
      title,
      description,
      keywords: keywords.length ? keywords : undefined,
      scenePrompt: entry.scenePrompt?.trim() || undefined,
    });
  });
  return normalized.slice(0, 12);
}

function buildBrandEntriesFromDraft(draft: BrandAssetDraft): BrandAssetEntry[] {
  const normalized = normalizeBrandEntries(draft.entries, "brand-draft-entry");
  if (normalized.length) return normalized;

  return normalizeBrandEntries([
    draft.sourceText.trim()
      ? {
        id: "brand-source",
        category: "资料",
        title: "品牌原始资料",
        description: compactText(draft.sourceText, 220),
        keywords: ["品牌资料", "搜索", "参考"],
        scenePrompt: "生成场景时优先遵循这段品牌原始资料，不确定的信息不要补写。",
      }
      : {},
    draft.voice.trim()
      ? {
        id: "brand-voice",
        category: "文案",
        title: "品牌语气",
        description: compactText(draft.voice, 180),
        keywords: ["品牌语气", "文案", "表达"],
        scenePrompt: "生成文案时保持该语气，避免偏离品牌表达方式。",
      }
      : {},
    draft.rules.trim()
      ? {
        id: "brand-rules",
        category: "规范",
        title: "视觉与使用规范",
        description: compactText(draft.rules, 220),
        keywords: ["Logo", "色彩", "版式", "禁用规则"],
        scenePrompt: "生成视觉场景时遵循这些 Logo、色彩、版式和禁用要求。",
      }
      : {},
  ], "brand-auto-entry");
}

function formatErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatAiFeedbackClass(feedback: AssetAiFeedback): string {
  return [
    "wx-asset-ai-message",
    feedback.status === "success" ? "is-success" : "",
    feedback.status === "error" ? "is-error" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function productDraftHasContent(draft: ProductAssetDraft): boolean {
  return Boolean(
    draft.name.trim()
    || draft.info.trim()
    || draft.images.length,
  );
}

function readImageFiles(files: FileList | null): Promise<string[]> {
  const imageFiles = Array.from(files || []).filter((file) => file.type.startsWith("image/"));
  return Promise.all(
    imageFiles.map(
      (file) =>
        new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
          reader.onerror = () => resolve("");
          reader.readAsDataURL(file);
        }),
    ),
  ).then((images) => images.filter(Boolean));
}

function productPreviewImages(item: DigitalAssetItem): string[] {
  return [
    ...(item.productImages || []),
    item.coverImage,
  ].filter((image, index, images): image is string => Boolean(image) && images.indexOf(image) === index);
}

function productImageSyncFields(images: string[]): Pick<
  DigitalAssetItem,
  "productImageSyncStatus" | "productImageSyncError"
> {
  if (!images.length) return {};
  const localCount = images.filter((url) => !/^https:\/\//i.test(url.trim())).length;
  if (!localCount) return { productImageSyncStatus: "synced" };
  return {
    productImageSyncStatus: "local-only",
    productImageSyncError: `${localCount} 张商品图仅在当前设备可用，远端生成前需要重新上传同步。`,
  };
}

function productImageSyncLabel(item: DigitalAssetItem): string | null {
  switch (item.productImageSyncStatus) {
    case "local-only":
      return item.productImageSyncError || "商品图仅在当前设备可用，远端生成前需要重新上传同步。";
    case "syncing":
      return "商品图正在同步，完成前不能用于远端生成。";
    case "failed":
      return item.productImageSyncError || "商品图同步未完成，远端生成已被阻止。";
    case "synced":
      return "商品图已同步，可用于远端图片和视频任务。";
    default:
      return null;
  }
}

function uniqueAssetUrls(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  values.forEach((value) => {
    const url = value?.trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  });
  return urls;
}

function promptCategoryForDraft(value: string | undefined): PromptAssetCategory {
  const normalized = value?.trim();
  if (normalized && normalized !== "全部" && PROMPT_ASSET_CATEGORIES.includes(normalized as PromptAssetCategory)) {
    return normalized as PromptAssetCategory;
  }
  return "通用";
}

function editableLocalAssetId(item: DigitalAssetItem): string {
  if (isLocalDigitalAsset(item)) return item.id;
  return `local-copy-${item.kind}-${Date.now()}`;
}

function editedAssetUse(item: DigitalAssetItem): string {
  if (isLocalDigitalAsset(item)) return item.assetUse || "本地资产";
  return "本地副本";
}

function editedSourceAssetId(item: DigitalAssetItem): string | undefined {
  return isLocalDigitalAsset(item) ? item.generationSourceAssetId : item.id;
}

function imageDraftFromAsset(item: DigitalAssetItem): ImageAssetDraft {
  return {
    name: item.name,
    notes: item.promptText || "",
    images: uniqueAssetUrls([...(item.assetImages || []), item.coverImage]),
  };
}

function productDraftFromAsset(item: DigitalAssetItem): ProductAssetDraft {
  const profile = item.productProfile;
  const profileDescription = [
    profile?.shortDescription,
    ...(profile?.sellingPoints || []),
    profile?.generationConstraints,
  ]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join("\n");
  return {
    ...emptyProductDraft(),
    name: item.name,
    info: item.productInfo || item.promptText || profileDescription,
    images: productPreviewImages(item),
  };
}

function brandDraftFromAsset(item: DigitalAssetItem): BrandAssetDraft {
  const logoImages = uniqueAssetUrls([item.coverImage]);
  const resourceImages = uniqueAssetUrls(item.brandAssets || []).filter((url) => !logoImages.includes(url));
  return {
    sourceText: item.promptText || "",
    name: item.name,
    colors: item.brandColors?.length ? item.brandColors.join(", ") : DEFAULT_BRAND_COLORS,
    voice: item.brandVoice || "",
    rules: item.brandRules || "",
    logoImages,
    resourceImages,
    entries: normalizeBrandEntries(item.brandEntries, "brand-edit-entry"),
  };
}

function fileDraftsFromAsset(item: DigitalAssetItem): LocalFileDraft[] {
  const drafts: LocalFileDraft[] = [];
  const pushDraft = (url: string | undefined, name: string, type: string, size = 0) => {
    const normalizedUrl = url?.trim();
    if (!normalizedUrl || drafts.some((draft) => draft.url === normalizedUrl)) return;
    drafts.push({
      url: normalizedUrl,
      name,
      type,
      size,
    });
  };

  if (item.kind === "真人") {
    uniqueAssetUrls([...(item.assetImages || []), item.coverImage, item.assetFile]).forEach((url, index) => {
      const isPrimaryFile = url === item.assetFile;
      pushDraft(
        url,
        isPrimaryFile && item.assetFileName ? item.assetFileName : `${item.name || "真人"}-${index + 1}.png`,
        isPrimaryFile && item.assetFileType ? item.assetFileType : "image/png",
        isPrimaryFile ? item.assetFileSize || 0 : 0,
      );
    });
    return drafts;
  }

  pushDraft(
    item.assetFile,
    item.assetFileName || `${item.name || defaultNameForKind(item.kind)}.${item.kind === "视频" ? "mp4" : item.kind === "声音" ? "mp3" : "txt"}`,
    item.assetFileType || (item.kind === "视频" ? "video/mp4" : item.kind === "声音" ? "audio/mpeg" : "text/plain"),
    item.assetFileSize || 0,
  );
  return drafts;
}

function genericDraftFromAsset(item: DigitalAssetItem): GenericAssetDraft {
  const promptCategory = promptCategoryForDraft(item.promptCategory);
  const tags = (item.promptTags || [])
    .map((tag) => tag.trim())
    .filter((tag) => tag && tag !== promptCategory)
    .join(", ");
  return {
    kind: item.kind,
    name: item.name,
    notes: item.promptText || item.productInfo || "",
    promptCategory,
    tags,
    files: fileDraftsFromAsset(item),
  };
}

function readLocalFiles(files: FileList | null, accept: (file: File) => boolean): Promise<LocalFileDraft[]> {
  const localFiles = Array.from(files || []).filter(accept);
  return Promise.all(
    localFiles.map(
      (file) =>
        new Promise<LocalFileDraft | null>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result !== "string") {
              resolve(null);
              return;
            }
            resolve({
              url: reader.result,
              name: file.name || "未命名文件",
              type: file.type || "application/octet-stream",
              size: file.size || 0,
            });
          };
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        }),
    ),
  ).then((items) => items.filter((item): item is LocalFileDraft => Boolean(item)));
}

function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(size > 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function fileExtension(name: string): string {
  const ext = name.match(/\.([a-zA-Z0-9]{1,8})$/)?.[1];
  return ext ? ext.toUpperCase() : "FILE";
}

function genericCreateEntryForFilter(filter: DigitalAssetFilter): DigitalAssetItem {
  if (filter === "商品库") return PRODUCT_UPLOAD_ENTRY;
  if (filter === "品牌库") return BRAND_CREATE_ENTRY;
  if (filter === "图片" || filter === "全部") return ASSET_UPLOAD_ENTRY;
  const labels = GENERIC_CREATE_LABELS[filter];
  return {
    id: `create-${filter}`,
    name: labels.title,
    kind: filter,
    meta: labels.meta,
    preview: "assetCreate",
    createKind: filter,
  };
}

function previewForKind(kind: DigitalAssetKind): DigitalAssetItem["preview"] {
  switch (kind) {
    case "提示词":
      return "prompt";
    case "视频":
      return "video";
    case "文件":
      return "file";
    case "剧本":
      return "script";
    case "声音":
      return "audio";
    case "真人":
      return "role";
    case "商品库":
      return "product";
    case "品牌库":
      return "brand";
    case "图片":
    default:
      return "image";
  }
}

function defaultNameForKind(kind: DigitalAssetKind): string {
  switch (kind) {
    case "提示词":
      return "未命名提示词";
    case "视频":
      return "未命名视频";
    case "文件":
      return "未命名文件";
    case "剧本":
      return "未命名剧本";
    case "声音":
      return "未命名声音";
    case "真人":
      return "未命名真人";
    default:
      return "未命名资产";
  }
}

function acceptsGenericFile(file: File, kind: DigitalAssetFilter): boolean {
  if (kind === "视频") return file.type.startsWith("video/");
  if (kind === "声音") return file.type.startsWith("audio/");
  if (kind === "真人") return file.type.startsWith("image/");
  if (kind === "文件") {
    return (
      /\.(pdf|doc|docx|xls|xlsx|csv|ppt|pptx|txt|md|json)$/i.test(file.name) ||
      file.type === "application/pdf" ||
      file.type === "application/msword" ||
      file.type.includes("wordprocessingml") ||
      file.type === "application/vnd.ms-excel" ||
      file.type.includes("spreadsheetml") ||
      file.type === "application/vnd.ms-powerpoint" ||
      file.type.includes("presentationml") ||
      file.type.startsWith("text/") ||
      file.type === "application/json"
    );
  }
  if (kind === "剧本" || kind === "提示词") {
    return file.type.startsWith("text/") || /\.(txt|md)$/i.test(file.name);
  }
  return file.type.startsWith("image/");
}

function isGenericAssetKind(kind: DigitalAssetKind): boolean {
  return kind !== "商品库" && kind !== "品牌库" && kind !== "图片";
}

function assetKindFromFilter(kind: DigitalAssetFilter): DigitalAssetKind {
  return kind === "全部" ? "提示词" : kind;
}

export function WodeAppAssetsSurface() {
  const {
    feishuSetupSkillReady,
    onAuthorizeFeishu,
    onOpenExtensionsSettings,
    onCreateTaskWithPrompt,
    selectedWorkspaceId,
  } = useWodeAppWorkbench();
  const [activeFilter, setActiveFilter] = React.useState<DigitalAssetFilter>("全部");
  const [activePromptCategory, setActivePromptCategory] = React.useState<PromptAssetCategory>("全部");
  const [showGenerationHistory, setShowGenerationHistory] = React.useState(
    () => readWodeAppAssetSurfaceMode() === "generation-history",
  );
  const [searchQuery, setSearchQuery] = React.useState("");
  const [preview, setPreview] = React.useState<DigitalAssetItem | null>(null);
  const [imageLightbox, setImageLightbox] = React.useState<LightboxImage | null>(null);
  const [editingAssetId, setEditingAssetId] = React.useState<string | null>(null);
  const [imageDraft, setImageDraft] = React.useState<ImageAssetDraft>(() => emptyImageDraft());
  const [productDraft, setProductDraft] = React.useState<ProductAssetDraft>(() => emptyProductDraft());
  const [brandDraft, setBrandDraft] = React.useState<BrandAssetDraft>(() => emptyBrandDraft());
  const [genericDraft, setGenericDraft] = React.useState<GenericAssetDraft>(() => emptyGenericDraft());
  const [productAiFeedback, setProductAiFeedback] = React.useState<AssetAiFeedback>(() => emptyAiFeedback());
  const [brandAiFeedback, setBrandAiFeedback] = React.useState<AssetAiFeedback>(() => emptyAiFeedback());
  const [deletingAssetId, setDeletingAssetId] = React.useState<string | null>(null);
  const [sharingAssetId, setSharingAssetId] = React.useState<string | null>(null);
  const assetGridRef = React.useRef<HTMLDivElement | null>(null);
  const assetLazySentinelRef = React.useRef<HTMLDivElement | null>(null);
  const [renderedAssetLimit, setRenderedAssetLimit] = React.useState(ASSET_INITIAL_RENDER_FALLBACK);
  const [assetRenderBatchSize, setAssetRenderBatchSize] = React.useState(ASSET_INITIAL_RENDER_FALLBACK);
  const digitalAssets = useDigitalAssetsList();
  const signedIn = useDigitalAssetsSignedIn();
  const catalogAssets = React.useMemo(() => digitalAssets.filter((item) => !isAssetCreationItem(item)), [digitalAssets]);
  const generationHistoryAssets = React.useMemo(
    () => catalogAssets.filter(isGenerationHistoryItem),
    [catalogAssets],
  );
  const libraryAssets = React.useMemo(
    () => catalogAssets.filter((item) => !isGenerationHistoryItem(item)),
    [catalogAssets],
  );

  const openFeishuConnect = React.useCallback(() => {
    if (onAuthorizeFeishu) {
      void onAuthorizeFeishu();
      return;
    }
    onOpenExtensionsSettings("mcp", {
      mcpSearch: "feishu",
      mcpDetailServerName: WODEAPP_FEISHU_MCP_SERVER,
    });
  }, [onAuthorizeFeishu, onOpenExtensionsSettings]);

  React.useEffect(() => {
    const onAssetSurfaceMode = (event: Event) => {
      const mode = (event as CustomEvent<WodeAppAssetSurfaceModeEventDetail>).detail?.mode;
      const nextShowHistory = mode === "generation-history";
      setShowGenerationHistory(nextShowHistory);
      setActiveFilter("全部");
      setActivePromptCategory("全部");
    };
    window.addEventListener(WODEAPP_ASSET_SURFACE_MODE_EVENT, onAssetSurfaceMode);
    return () => window.removeEventListener(WODEAPP_ASSET_SURFACE_MODE_EVENT, onAssetSurfaceMode);
  }, []);

  const resetCreationDraft = React.useCallback((item: DigitalAssetItem) => {
    if (item.preview === "assetUpload") setImageDraft(emptyImageDraft());
    if (item.preview === "productUpload") {
      setProductDraft(emptyProductDraft());
      setProductAiFeedback(emptyAiFeedback());
    }
    if (item.preview === "brandCreate") {
      setBrandDraft(emptyBrandDraft());
      setBrandAiFeedback(emptyAiFeedback());
    }
    if (item.preview === "assetCreate") {
      setGenericDraft(emptyGenericDraft(item.createKind || item.kind));
    }
  }, []);

  const emptyCopy = React.useMemo(() => {
    if (showGenerationHistory) return "暂无生成历史。在对话中生成内容后会自动保存到这里。";
    if (!signedIn) return "可先保存本地资产；登录后可同步已有商品库与素材。";
    if (activeFilter === "商品库") return "商品库暂无商品。在对话中上传商品图、或让智能体生成后会自动入库。";
    if (activeFilter === "品牌库") return "品牌库暂无品牌。可以先新建品牌，把 Logo、色彩、语气和规范放进来。";
    if (activeFilter === "图片") return "暂无生成图片。在对话中生成图片后会出现在这里。";
    if (activeFilter === "文件") return "文件库暂无文件。可以上传 PDF、Word、表格、简报或资料文档。";
    if (activeFilter === "视频") return "暂无生成视频。在对话中生成视频后会出现在这里。";
    if (activeFilter === "全部") return "暂无资产。在对话中生成内容、或上传商品后会自动同步到这里。";
    return `暂无${activeFilter}资产。`;
  }, [signedIn, activeFilter, showGenerationHistory]);

  const visibleAssets = React.useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const sourceAssets = showGenerationHistory ? generationHistoryAssets : libraryAssets;
    return sourceAssets.filter((item) => {
      if (activeFilter !== "全部" && item.kind !== activeFilter) return false;
      if (!showGenerationHistory && activeFilter === "提示词" && activePromptCategory !== "全部") {
        if (item.promptCategory !== activePromptCategory && !item.promptTags?.includes(activePromptCategory)) return false;
      }
      if (normalizedQuery && !digitalAssetSearchText(item).includes(normalizedQuery)) return false;
      return true;
    });
  }, [activeFilter, activePromptCategory, generationHistoryAssets, libraryAssets, searchQuery, showGenerationHistory]);

  React.useLayoutEffect(() => {
    const grid = assetGridRef.current;
    if (!grid) {
      setRenderedAssetLimit(Math.min(visibleAssets.length, ASSET_INITIAL_RENDER_FALLBACK));
      setAssetRenderBatchSize(ASSET_INITIAL_RENDER_FALLBACK);
      return;
    }
    let frameId = 0;
    let shouldResetRenderLimit = true;
    const updateRenderWindow = () => {
      const renderWindow = estimateAssetRenderWindow(grid);
      setAssetRenderBatchSize(renderWindow.batchSize);
      setRenderedAssetLimit((currentLimit) => {
        const nextLimit = Math.min(visibleAssets.length, renderWindow.limit);
        if (shouldResetRenderLimit) {
          shouldResetRenderLimit = false;
          return nextLimit;
        }
        return Math.min(visibleAssets.length, Math.max(currentLimit, nextLimit));
      });
    };
    updateRenderWindow();
    frameId = window.requestAnimationFrame(updateRenderWindow);

    const scrollRoot = assetScrollRoot(grid);
    const resizeObserver = typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(updateRenderWindow)
      : null;
    resizeObserver?.observe(grid);
    if (scrollRoot) resizeObserver?.observe(scrollRoot);
    window.addEventListener("resize", updateRenderWindow);

    return () => {
      if (frameId) window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateRenderWindow);
    };
  }, [activeFilter, activePromptCategory, searchQuery, showGenerationHistory, visibleAssets.length]);

  const renderedAssets = React.useMemo(
    () => visibleAssets.slice(0, renderedAssetLimit),
    [renderedAssetLimit, visibleAssets],
  );
  const hasMoreRenderedAssets = renderedAssets.length < visibleAssets.length;

  React.useEffect(() => {
    const sentinel = assetLazySentinelRef.current;
    const grid = assetGridRef.current;
    if (!sentinel || !grid || !hasMoreRenderedAssets || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        setRenderedAssetLimit((limit) => Math.min(visibleAssets.length, limit + assetRenderBatchSize));
      },
      {
        root: assetScrollRoot(grid),
        rootMargin: "0px",
        threshold: 0,
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [assetRenderBatchSize, hasMoreRenderedAssets, visibleAssets.length]);

  const generationHistoryFilterCounts = React.useMemo(
    () => {
      const counts = new Map<DigitalAssetFilter, number>();
      counts.set("全部", generationHistoryAssets.length);
      for (const filter of DIGITAL_ASSET_FILTERS) {
        if (filter === "全部") continue;
        const count = generationHistoryAssets.filter((item) => item.kind === filter).length;
        if (count > 0) counts.set(filter, count);
      }
      return counts;
    },
    [generationHistoryAssets],
  );

  const generationHistoryFilters = React.useMemo(
    () => DIGITAL_ASSET_FILTERS.filter((filter) => filter === "全部" || (generationHistoryFilterCounts.get(filter) || 0) > 0),
    [generationHistoryFilterCounts],
  );

  React.useEffect(() => {
    if (!showGenerationHistory || generationHistoryFilters.includes(activeFilter)) return;
    setActiveFilter("全部");
  }, [activeFilter, generationHistoryFilters, showGenerationHistory]);

  const filterCounts = React.useMemo(() => {
    const counts = new Map<DigitalAssetFilter, number>();
    counts.set("全部", libraryAssets.length);
    for (const filter of DIGITAL_ASSET_FILTERS) {
      if (filter === "全部") continue;
      counts.set(filter, libraryAssets.filter((item) => item.kind === filter).length);
    }
    return counts;
  }, [libraryAssets]);

  const contextCreateEntry = React.useMemo(() => genericCreateEntryForFilter(activeFilter), [activeFilter]);
  const ContextCreateIcon = activeFilter === "商品库"
    ? Package
    : activeFilter === "品牌库"
      ? Building2
      : activeFilter === "提示词"
        ? ScrollText
        : activeFilter === "视频"
          ? Film
          : activeFilter === "文件" || activeFilter === "剧本"
            ? FileText
            : activeFilter === "声音"
              ? Mic
              : activeFilter === "真人"
                ? UserRound
                : Upload;
  const contextCreateLabel =
    activeFilter === "全部" ? "上传素材" : GENERIC_CREATE_LABELS[activeFilter].action;

  const isEditingAsset = Boolean(preview && editingAssetId === preview.id && !isAssetCreationItem(preview));
  const canEditPreview = Boolean(preview && !isAssetCreationItem(preview) && !isGenerationHistoryItem(preview));
  const genericFormKind = assetKindFromFilter(genericDraft.kind);
  const isImageFormOpen = Boolean(preview && (preview.preview === "assetUpload" || (isEditingAsset && preview.kind === "图片")));
  const isProductFormOpen = Boolean(preview && (preview.preview === "productUpload" || (isEditingAsset && preview.kind === "商品库")));
  const isBrandFormOpen = Boolean(preview && (preview.preview === "brandCreate" || (isEditingAsset && preview.kind === "品牌库")));
  const isGenericFormOpen = Boolean(preview && (preview.preview === "assetCreate" || (isEditingAsset && isGenericAssetKind(preview.kind))));
  const showPreviewDetails = Boolean(preview && !isEditingAsset && !isAssetCreationItem(preview));

  const closePreview = React.useCallback(() => {
    setImageLightbox(null);
    setPreview(null);
    setEditingAssetId(null);
  }, []);

  const openImageLightbox = React.useCallback((src: string, alt: string) => {
    if (!src.trim()) return;
    setImageLightbox({ src, alt });
  }, []);

  const cancelEditPreview = React.useCallback(() => {
    setEditingAssetId(null);
    setProductAiFeedback(emptyAiFeedback());
    setBrandAiFeedback(emptyAiFeedback());
  }, []);

  const beginEditPreview = React.useCallback(() => {
    if (!preview || isAssetCreationItem(preview) || isGenerationHistoryItem(preview)) return;
    if (preview.kind === "图片") {
      setImageDraft(imageDraftFromAsset(preview));
    } else if (preview.kind === "商品库") {
      setProductDraft(productDraftFromAsset(preview));
      setProductAiFeedback(emptyAiFeedback());
    } else if (preview.kind === "品牌库") {
      setBrandDraft(brandDraftFromAsset(preview));
      setBrandAiFeedback(emptyAiFeedback());
    } else {
      setGenericDraft(genericDraftFromAsset(preview));
    }
    setEditingAssetId(preview.id);
  }, [preview]);

  const handleDeleteAsset = React.useCallback(async (item: DigitalAssetItem) => {
    if (!isLocalDigitalAsset(item)) return;
    if (typeof window !== "undefined" && !window.confirm(`确定删除「${item.name}」吗？删除后无法恢复。`)) return;

    setDeletingAssetId(item.id);
    try {
      const result = await deleteLocalDigitalAssets([item.id]);
      if (result.deleted.length) {
        toast.success(`已删除「${item.name}」`);
        if (preview?.id === item.id) closePreview();
      } else {
        toast.error(result.skipped[0]?.reason || "删除失败，请稍后再试");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "删除失败，请稍后再试");
    } finally {
      setDeletingAssetId(null);
    }
  }, [closePreview, preview?.id]);

  const openPreview = (item: DigitalAssetItem) => {
    setEditingAssetId(null);
    if (isAssetCreationItem(item)) {
      resetCreationDraft(item);
    } else {
      rememberAssetMention(digitalAssetToMention(item));
    }
    setPreview(item);
  };

  const saveCreatedAsset = async (item: DigitalAssetItem) => {
    const saved = await saveLocalDigitalAsset(item);
    setActiveFilter(saved.kind);
    if (saved.kind !== "提示词") setActivePromptCategory("全部");
    closePreview();
  };

  const saveImageAsset = async () => {
    if (!imageDraft.images.length) return;
    const name = imageDraft.name.trim() || "未命名素材";
    await saveCreatedAsset({
      id: `local-image-${Date.now()}`,
      name,
      kind: "图片",
      meta: `${imageDraft.images.length} 张 · 本地素材`,
      preview: "image",
      coverImage: imageDraft.images[0],
      assetImages: imageDraft.images,
      promptText: imageDraft.notes.trim() || undefined,
    });
    setImageDraft(emptyImageDraft());
  };

  const runProductVisionFill = React.useCallback(async () => {
    if (!productDraft.images.length) {
      setProductAiFeedback({ status: "error", message: "请先上传商品图。" });
      return;
    }

    setProductAiFeedback({ status: "running", message: "正在识别商品图..." });
    try {
      const draft = await analyzeProductImagesWithAI(productDraft.images);
      setProductDraft((current) => ({
        ...current,
        name: draft.name?.trim() || current.name,
        info: draft.info?.trim() || current.info,
      }));
      setProductAiFeedback({ status: "success", message: "已根据商品图填入草稿。" });
    } catch (error) {
      setProductAiFeedback({
        status: "error",
        message: formatErrorMessage(error, "AI 识别失败，请稍后再试。"),
      });
    }
  }, [productDraft.images]);

  const saveProductAsset = async () => {
    if (!productDraftHasContent(productDraft)) return;
    const name = productDraft.name.trim() || "未命名商品";
    const productImages = productDraft.images.slice(0, 12);
    const imageSyncFields = productImageSyncFields(productImages);
    await saveCreatedAsset({
      id: `local-product-${Date.now()}`,
      name,
      kind: "商品库",
      meta: productImages.length ? `${productImages.length} 张 · 商品库` : "商品描述 · 商品库",
      preview: "product",
      coverImage: productImages[0],
      productImages: productImages.length ? productImages : undefined,
      ...imageSyncFields,
      productInfo: productDraft.info.trim() || undefined,
    });
    setProductDraft(emptyProductDraft());
    setProductAiFeedback(emptyAiFeedback());
  };

  const runBrandWebLookup = React.useCallback(async () => {
    const brandName = getBrandLookupName(brandDraft);
    if (!brandName) {
      setBrandAiFeedback({ status: "error", message: "请先输入品牌名称。" });
      return;
    }

    const brandImages = [...brandDraft.logoImages, ...brandDraft.resourceImages].slice(0, 4);
    setBrandAiFeedback({ status: "running", message: "正在联网查询品牌资料..." });
    try {
      const lookup = await lookupBrandWithWebSearch({ brandName });
      setBrandAiFeedback({ status: "running", message: "已找到公开资料，正在用 AI 整理品牌资产..." });
      const draft = await extractBrandWithAI({
        text: lookup.sourceText,
        images: brandImages,
      });
      const colorList = resolveBrandColorList({
        aiColors: Array.isArray(draft.colors) ? draft.colors.map((color) => String(color)) : [],
        brandName: draft.name?.trim() || lookup.brandName || brandName,
        sourceText: lookup.sourceText,
      });
      const entries = normalizeBrandEntries(draft.entries, "brand-web-entry");
      setBrandDraft((current) => {
        const originalSource = current.sourceText.trim();
        const shouldKeepOriginal = originalSource && hasMeaningfulBrandDetails(originalSource);
        return {
          ...current,
          sourceText: shouldKeepOriginal ? `${originalSource}\n\n${lookup.sourceText}` : lookup.sourceText,
          name: draft.name?.trim() || lookup.brandName || current.name || brandName,
          colors: colorList.length ? colorList.join(", ") : current.colors,
          voice: draft.voice?.trim() || current.voice,
          rules: draft.rules?.trim() || current.rules,
          entries: entries.length ? entries : current.entries,
        };
      });
      setBrandAiFeedback({
        status: "success",
        message: `已联网查询 ${lookup.sources.length} 个来源，并由 AI 整理为品牌草稿${colorList.length ? `，更新 ${colorList.length} 个品牌色` : ""}。`,
      });
    } catch (error) {
      setBrandAiFeedback({
        status: "error",
        message: formatErrorMessage(error, "联网补全失败，请稍后再试。"),
      });
    }
  }, [brandDraft.logoImages, brandDraft.name, brandDraft.resourceImages, brandDraft.sourceText]);

  const runBrandExtract = React.useCallback(async () => {
    const brandImages = [...brandDraft.logoImages, ...brandDraft.resourceImages].slice(0, 4);
    const extractionText = buildBrandExtractionText(brandDraft);
    const hasDetails = hasMeaningfulBrandDetails(brandDraft.sourceText);
    if (!extractionText && !brandImages.length) {
      setBrandAiFeedback({ status: "error", message: "请先输入品牌资料，或上传 Logo / 品牌资源。" });
      return;
    }
    if (!hasDetails && !brandImages.length) {
      const nameCandidate = brandDraft.name.trim() || brandDraft.sourceText.trim();
      if (nameCandidate && !brandDraft.name.trim()) {
        setBrandDraft((current) => ({ ...current, name: nameCandidate }));
      }
      await runBrandWebLookup();
      return;
    }

    setBrandAiFeedback({ status: "running", message: "正在提取品牌资产..." });
    try {
      const draft = await extractBrandWithAI({
        text: extractionText,
        images: brandImages,
      });
      const colorList = resolveBrandColorList({
        aiColors: Array.isArray(draft.colors) ? draft.colors.map((color) => String(color)) : [],
        brandName: draft.name?.trim() || brandDraft.name,
        sourceText: extractionText,
      });
      const entries = normalizeBrandEntries(draft.entries, "brand-ai-entry");
      setBrandDraft((current) => ({
        ...current,
        name: draft.name?.trim() || current.name,
        colors: colorList.length ? colorList.join(", ") : current.colors,
        voice: draft.voice?.trim() || current.voice,
        rules: draft.rules?.trim() || current.rules,
        entries: entries.length ? entries : current.entries,
      }));
      setBrandAiFeedback({ status: "success", message: "已提取品牌信息，可继续微调。" });
    } catch (error) {
      setBrandAiFeedback({
        status: "error",
        message: formatErrorMessage(error, "AI 提取失败，请稍后再试。"),
      });
    }
  }, [brandDraft.logoImages, brandDraft.name, brandDraft.resourceImages, brandDraft.sourceText, runBrandWebLookup]);

  const saveBrandAsset = async () => {
    const name = brandDraft.name.trim();
    if (!name) return;
    const brandAssets = [...brandDraft.logoImages, ...brandDraft.resourceImages];
    const brandEntries = buildBrandEntriesFromDraft(brandDraft);
    await saveCreatedAsset({
      id: `local-brand-${Date.now()}`,
      name,
      kind: "品牌库",
      meta: brandAssets.length ? `${brandAssets.length} 张资源 · 品牌库` : "品牌规范 · 品牌库",
      preview: "brand",
      coverImage: brandAssets[0],
      promptText: brandDraft.sourceText.trim() || undefined,
      brandColors: parseBrandColors(brandDraft.colors),
      brandVoice: brandDraft.voice.trim() || undefined,
      brandRules: brandDraft.rules.trim() || undefined,
      brandAssets,
      brandEntries,
    });
    setBrandDraft(emptyBrandDraft());
    setBrandAiFeedback(emptyAiFeedback());
  };

  const saveGenericAsset = async () => {
    const kind = genericDraft.kind;
    if (kind === "全部" || kind === "商品库" || kind === "品牌库" || kind === "图片") return;
    const primaryFile = genericDraft.files[0];
    const imageFiles = genericDraft.files.filter((file) => file.type.startsWith("image/"));
    const name = genericDraft.name.trim() || primaryFile?.name?.replace(/\.[^.]+$/, "") || defaultNameForKind(kind);
    const notes = genericDraft.notes.trim();
    const parsedTags = genericDraft.tags
      .split(/[，,\s]+/)
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 8);
    const fileMeta = primaryFile
      ? `${fileExtension(primaryFile.name)}${formatFileSize(primaryFile.size) ? ` · ${formatFileSize(primaryFile.size)}` : ""}`
      : GENERIC_CREATE_LABELS[kind].meta;
    await saveCreatedAsset({
      id: `local-${kind}-${Date.now()}`,
      name,
      kind,
      meta: kind === "提示词" ? `${genericDraft.promptCategory} · 本地提示词` : `${fileMeta} · 本地资产`,
      preview: previewForKind(kind),
      promptCategory: kind === "提示词" ? genericDraft.promptCategory : undefined,
      promptTags: kind === "提示词" ? [genericDraft.promptCategory, ...parsedTags] : parsedTags,
      promptText: notes || undefined,
      coverImage: imageFiles[0]?.url,
      assetImages: imageFiles.length ? imageFiles.map((file) => file.url) : undefined,
      assetFile: primaryFile?.url,
      assetFileName: primaryFile?.name,
      assetFileType: primaryFile?.type,
      assetFileSize: primaryFile?.size,
    });
    setGenericDraft(emptyGenericDraft(kind));
  };

  const finishEditedAssetSave = async (original: DigitalAssetItem, item: DigitalAssetItem) => {
    const saved = await saveLocalDigitalAsset(item);
    setPreview(saved);
    setEditingAssetId(null);
    setActiveFilter(saved.kind);
    if (saved.kind === "提示词") {
      setActivePromptCategory(promptCategoryForDraft(saved.promptCategory));
    } else {
      setActivePromptCategory("全部");
    }
    toast.success(isLocalDigitalAsset(original) ? "已保存修改" : "已保存为本地副本");
  };

  const saveEditedImageAsset = async (original: DigitalAssetItem) => {
    if (!imageDraft.images.length) return;
    const name = imageDraft.name.trim() || original.name || "未命名素材";
    await finishEditedAssetSave(original, {
      ...original,
      id: editableLocalAssetId(original),
      name,
      kind: "图片",
      meta: `${imageDraft.images.length} 张 · 本地素材`,
      preview: "image",
      coverImage: imageDraft.images[0],
      assetImages: imageDraft.images,
      promptText: imageDraft.notes.trim() || undefined,
      assetTime: "刚刚",
      assetUse: editedAssetUse(original),
      generationSourceAssetId: editedSourceAssetId(original),
    });
  };

  const saveEditedProductAsset = async (original: DigitalAssetItem) => {
    if (!productDraftHasContent(productDraft)) return;
    const name = productDraft.name.trim() || original.name || "未命名商品";
    const productImages = productDraft.images.slice(0, 12);
    const imageSyncFields = productImageSyncFields(productImages);
    await finishEditedAssetSave(original, {
      ...original,
      id: editableLocalAssetId(original),
      name,
      kind: "商品库",
      meta: productImages.length ? `${productImages.length} 张 · 商品库` : "商品描述 · 商品库",
      preview: "product",
      coverImage: productImages[0],
      productImages: productImages.length ? productImages : undefined,
      ...imageSyncFields,
      productInfo: productDraft.info.trim() || undefined,
      productProfile: undefined,
      assetTime: "刚刚",
      assetUse: editedAssetUse(original),
      generationSourceAssetId: editedSourceAssetId(original),
    });
    setProductAiFeedback(emptyAiFeedback());
  };

  const saveEditedBrandAsset = async (original: DigitalAssetItem) => {
    const name = brandDraft.name.trim();
    if (!name) return;
    const brandAssets = [...brandDraft.logoImages, ...brandDraft.resourceImages];
    const brandEntries = buildBrandEntriesFromDraft(brandDraft);
    await finishEditedAssetSave(original, {
      ...original,
      id: editableLocalAssetId(original),
      name,
      kind: "品牌库",
      meta: brandAssets.length ? `${brandAssets.length} 张资源 · 品牌库` : "品牌规范 · 品牌库",
      preview: "brand",
      coverImage: brandAssets[0],
      promptText: brandDraft.sourceText.trim() || undefined,
      brandColors: parseBrandColors(brandDraft.colors),
      brandVoice: brandDraft.voice.trim() || undefined,
      brandRules: brandDraft.rules.trim() || undefined,
      brandAssets,
      brandEntries,
      assetTime: "刚刚",
      assetUse: editedAssetUse(original),
      generationSourceAssetId: editedSourceAssetId(original),
    });
    setBrandAiFeedback(emptyAiFeedback());
  };

  const saveEditedGenericAsset = async (original: DigitalAssetItem) => {
    const kind = assetKindFromFilter(genericDraft.kind);
    if (!isGenericAssetKind(kind)) return;
    const primaryFile = genericDraft.files[0];
    const imageFiles = genericDraft.files.filter((file) => file.type.startsWith("image/") || file.url.startsWith("data:image/"));
    const name = genericDraft.name.trim() || primaryFile?.name?.replace(/\.[^.]+$/, "") || original.name || defaultNameForKind(kind);
    const notes = genericDraft.notes.trim();
    const parsedTags = genericDraft.tags
      .split(/[，,\s]+/)
      .map((tag) => tag.trim())
      .filter(Boolean)
      .slice(0, 8);
    const fileMeta = primaryFile
      ? `${fileExtension(primaryFile.name)}${formatFileSize(primaryFile.size) ? ` · ${formatFileSize(primaryFile.size)}` : ""}`
      : GENERIC_CREATE_LABELS[kind].meta;
    await finishEditedAssetSave(original, {
      ...original,
      id: editableLocalAssetId(original),
      name,
      kind,
      meta: kind === "提示词" ? `${genericDraft.promptCategory} · 本地提示词` : `${fileMeta} · 本地资产`,
      preview: previewForKind(kind),
      promptCategory: kind === "提示词" ? genericDraft.promptCategory : undefined,
      promptTags: kind === "提示词" ? [genericDraft.promptCategory, ...parsedTags] : parsedTags,
      promptText: notes || undefined,
      coverImage: imageFiles[0]?.url,
      assetImages: imageFiles.length ? imageFiles.map((file) => file.url) : undefined,
      assetFile: primaryFile?.url,
      assetFileName: primaryFile?.name,
      assetFileType: primaryFile?.type,
      assetFileSize: primaryFile?.size,
      assetTime: "刚刚",
      assetUse: editedAssetUse(original),
      generationSourceAssetId: editedSourceAssetId(original),
    });
  };

  const saveEditedAsset = async () => {
    if (!preview || !isEditingAsset) return;
    if (preview.kind === "图片") {
      await saveEditedImageAsset(preview);
      return;
    }
    if (preview.kind === "商品库") {
      await saveEditedProductAsset(preview);
      return;
    }
    if (preview.kind === "品牌库") {
      await saveEditedBrandAsset(preview);
      return;
    }
    await saveEditedGenericAsset(preview);
  };

  const insertPreviewToConversation = (item: DigitalAssetItem) => {
    const mention = digitalAssetToMention(item);
    queueAssetMentionInsert(mention);
    try {
      window.dispatchEvent(new Event("wodeapp:focus-agents"));
      [0, 80, 240, 600].forEach((delay) => {
        window.setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("wodeapp:insert-asset-mention", {
              detail: mention,
            }),
          );
        }, delay);
      });
    } catch {
      // ignore
    }
    closePreview();
  };

  const startProductGeneration = (item: DigitalAssetItem, kind: "image" | "video") => {
    if (!selectedWorkspaceId) {
      toast.warning("请先选择工作区");
      return;
    }
    requestProductGenerationHandoff(selectedWorkspaceId, onCreateTaskWithPrompt, item, kind);
    closePreview();
    toast.message(kind === "image" ? "已打开生图草稿，请补全需求后发送" : "已打开视频脚本草稿，请补全需求后发送");
  };

  const startAssetHandoff = (item: DigitalAssetItem, optionLabel: string) => {
    if (!selectedWorkspaceId) {
      toast.warning("请先选择工作区");
      return;
    }
    const option = handoffOptionsForAsset(item).find((entry) => entry.label === optionLabel);
    if (!option) return;
    requestAgentHandoff(selectedWorkspaceId, onCreateTaskWithPrompt, option, item);
    closePreview();
    toast.message("已打开创作草稿，请补全需求后发送");
  };

  const shareGenerationHistory = React.useCallback(async (item: DigitalAssetItem) => {
    if (!canShareGenerationHistory(item)) {
      toast.warning("这条生成记录还没有可分享的媒体链接");
      return;
    }
    setSharingAssetId(item.id);
    try {
      const result = await createGenerationHistoryShare(item);
      if (result.shareUrl !== item.generationShareUrl && isLocalDigitalAsset(item)) {
        await saveLocalDigitalAsset({
          ...item,
          generationShareUrl: result.shareUrl,
        });
        if (preview?.id === item.id) {
          setPreview({ ...item, generationShareUrl: result.shareUrl });
        }
      }

      const shareTitle = `${item.name}生成记录`;
      const nativeShare = typeof navigator !== "undefined"
        ? (navigator as Navigator & { share?: (data: { title?: string; text?: string; url?: string }) => Promise<void> }).share
        : undefined;

      let sharedNatively = false;
      if (nativeShare) {
        try {
          const nativePayload = isHttpShareUrl(result.shareUrl)
            ? { title: shareTitle, text: item.name, url: result.shareUrl }
            : { title: shareTitle, text: result.shareUrl };
          await nativeShare.call(navigator, nativePayload);
          sharedNatively = true;
        } catch (error) {
          if ((error as { name?: string }).name === "AbortError") return;
        }
      }

      if (!sharedNatively) {
        const copied = await writeClipboardText(result.shareUrl);
        if (copied) {
          toast.message(generationHistoryShareToastMessage(result.mode));
        } else if (isHttpShareUrl(result.shareUrl)) {
          toast.message("已生成分享链接，正在打开");
        } else {
          toast.message(`分享链接：${result.shareUrl}`);
        }
      }

      if (isHttpShareUrl(result.shareUrl)) {
        try {
          await openDesktopUrl(result.shareUrl);
        } catch {
          if (typeof window !== "undefined") {
            window.open(result.shareUrl, "_blank", "noopener,noreferrer");
          }
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "分享失败");
    } finally {
      setSharingAssetId(null);
    }
  }, [preview]);

  const handlePrimaryAction = () => {
    if (!preview) return;
    if (isEditingAsset) {
      void saveEditedAsset();
      return;
    }
    if (preview.preview === "assetUpload") {
      void saveImageAsset();
      return;
    }
    if (preview.preview === "productUpload") {
      void saveProductAsset();
      return;
    }
    if (preview.preview === "brandCreate") {
      void saveBrandAsset();
      return;
    }
    if (preview.preview === "assetCreate") {
      void saveGenericAsset();
      return;
    }
    insertPreviewToConversation(preview);
  };

  const primaryActionLabel = React.useMemo(() => {
    if (!preview) return "插入到对话";
    if (isEditingAsset) return isLocalDigitalAsset(preview) ? "保存修改" : "保存为本地副本";
    if (preview.preview === "assetUpload") return "保存到素材库";
    if (preview.preview === "productUpload") return "保存到商品库";
    if (preview.preview === "brandCreate") return "保存到品牌库";
    if (preview.preview === "assetCreate") {
      const kind = preview.createKind || preview.kind;
      return kind === "提示词" ? "保存到提示词" : `保存到${kind}`;
    }
    return "插入到对话";
  }, [isEditingAsset, preview]);

  const primaryActionDisabled = React.useMemo(() => {
    if (!preview) return true;
    if (isEditingAsset) {
      if (preview.kind === "图片") return imageDraft.images.length === 0;
      if (preview.kind === "商品库") return !productDraftHasContent(productDraft);
      if (preview.kind === "品牌库") return !brandDraft.name.trim();
      if (isGenericAssetKind(preview.kind)) {
        const kind = assetKindFromFilter(genericDraft.kind);
        if (kind === "提示词") return !genericDraft.name.trim() && !genericDraft.notes.trim();
        if (kind === "剧本") return !genericDraft.name.trim() && !genericDraft.notes.trim() && genericDraft.files.length === 0;
        return genericDraft.files.length === 0;
      }
      return false;
    }
    if (preview.preview === "assetUpload") return imageDraft.images.length === 0;
    if (preview.preview === "productUpload") return !productDraftHasContent(productDraft);
    if (preview.preview === "brandCreate") return !brandDraft.name.trim();
    if (preview.preview === "assetCreate") {
      const kind = genericDraft.kind;
      if (kind === "提示词") return !genericDraft.name.trim() && !genericDraft.notes.trim();
      if (kind === "剧本") return !genericDraft.name.trim() && !genericDraft.notes.trim() && genericDraft.files.length === 0;
      return genericDraft.files.length === 0;
    }
    return false;
  }, [brandDraft.name, genericDraft.files.length, genericDraft.kind, genericDraft.name, genericDraft.notes, imageDraft.images.length, isEditingAsset, preview, productDraft]);

  const footerNote = React.useMemo(() => {
    if (!preview) return "";
    if (isEditingAsset) {
      return isLocalDigitalAsset(preview) ? "修改会保存到桌面本地资产库" : "同步资产会保存为本地副本，原始记录不变";
    }
    if (isAssetCreationItem(preview)) return "保存后可在对话中随时复用";
    if (preview.kind === "商品库") return "可生成图片/视频，或插入对话后 @ 引用";
    return "插入后 Agent 可直接引用这条资产";
  }, [isEditingAsset, preview]);

  const renderImageStrip = (images: string[], onRemove?: (index: number) => void) =>
    images.length ? (
      <div className="wx-asset-preview-strip" aria-label="已选择图片">
        {images.map((image, index) => {
          const alt = preview?.name ? `${preview.name} ${index + 1}` : `图片 ${index + 1}`;
          return (
            <span key={`${index}-${image.slice(0, 28)}`}>
              <button
                type="button"
                className="wx-asset-preview-thumb"
                aria-label={`放大预览：${alt}`}
                onClick={() => openImageLightbox(image, alt)}
              >
                <img src={image} alt="" />
              </button>
              {onRemove ? (
                <button
                  type="button"
                  className="wx-asset-preview-remove"
                  onClick={() => onRemove(index)}
                  aria-label="移除图片"
                >
                  移除
                </button>
              ) : null}
            </span>
          );
        })}
      </div>
    ) : null;

  const renderFileStrip = (files: LocalFileDraft[], onRemove?: (index: number) => void) =>
    files.length ? (
      <div className="wx-asset-file-strip" aria-label="已选择文件">
        {files.map((file, index) => (
          <span key={`${file.name}-${file.size}-${file.url.slice(0, 24)}`}>
            <strong>{file.name}</strong>
            <small>{[file.type || fileExtension(file.name), formatFileSize(file.size)].filter(Boolean).join(" · ")}</small>
            {onRemove ? (
              <button type="button" onClick={() => onRemove(index)} aria-label={`移除${file.name}`}>
                移除
              </button>
            ) : null}
          </span>
        ))}
      </div>
    ) : null;

  const renderSavedFilePreview = (item: DigitalAssetItem) => {
    if (!item.assetFile) return null;
    if (item.assetFileType?.startsWith("video/")) {
      return (
        <div className="wx-asset-media-preview">
          <video src={item.assetFile} controls />
        </div>
      );
    }
    if (item.assetFileType?.startsWith("audio/")) {
      return (
        <div className="wx-asset-media-preview">
          <audio src={item.assetFile} controls />
        </div>
      );
    }
    return (
      <p className="wx-asset-file-preview">
        <span>{item.assetFileName || "本地文件"}</span>
        {item.assetFileSize ? <small>{formatFileSize(item.assetFileSize)}</small> : null}
      </p>
    );
  };

  const renderSavedAttachmentFiles = (item: DigitalAssetItem) =>
    item.assetFiles?.length ? renderFileStrip(item.assetFiles) : null;

  const renderBrandEntryList = (entries: BrandAssetEntry[] | undefined) =>
    entries?.length ? (
      <div className="wx-asset-brand-entry-list" aria-label="品牌条目">
        {entries.map((entry) => (
          <article className="wx-asset-brand-entry" key={entry.id}>
            <div>
              <span>{entry.category}</span>
              <strong>{entry.title}</strong>
            </div>
            <p>{entry.description}</p>
            {entry.keywords?.length ? (
              <ul aria-label="关键词">
                {entry.keywords.slice(0, 6).map((keyword) => (
                  <li key={keyword}>{keyword}</li>
                ))}
              </ul>
            ) : null}
            {entry.scenePrompt ? <small>场景提示：{entry.scenePrompt}</small> : null}
          </article>
        ))}
      </div>
    ) : null;

  const renderProductTextField = (
    field: Exclude<keyof ProductAssetDraft, "images">,
    label: string,
    placeholder: string,
    multiline = false,
  ) => (
    <label className="wx-asset-form-field">
      <span>{label}</span>
      {multiline ? (
        <textarea
          value={productDraft[field]}
          onChange={(event) => setProductDraft((draft) => ({ ...draft, [field]: event.target.value }))}
          placeholder={placeholder}
        />
      ) : (
        <input
          value={productDraft[field]}
          onChange={(event) => setProductDraft((draft) => ({ ...draft, [field]: event.target.value }))}
          placeholder={placeholder}
        />
      )}
    </label>
  );

  const previewProductImages = preview ? productPreviewImages(preview) : [];
  const documentPreviewHtml = React.useMemo(() => {
    if (!preview || !showPreviewDetails) return null;
    const type = preview.assetFileType?.toLowerCase() || "";
    const name = preview.assetFileName?.toLowerCase() || "";
    const canBeDocument = isDigitalAssetDocumentKind(preview.kind)
      || type.includes("html")
      || type.includes("markdown")
      || name.endsWith(".md")
      || name.endsWith(".html")
      || name.endsWith(".htm")
      || preview.kind === "文件";
    if (!canBeDocument) return null;
    return resolveAssetDocumentHtml(preview);
  }, [preview, showPreviewDetails]);

  return (
    <>
      <section className="wx-surface-frame wx-asset-design-frame">
        <header className="wx-asset-hero">
          <p className="wx-asset-kicker">
            {showGenerationHistory ? "生成历史 / GENERATION HISTORY" : "资产库 / ASSET LIBRARY"}
          </p>
          <div className="wx-asset-hero-main">
            <div className="wx-asset-hero-copy">
              <h1>{showGenerationHistory ? "生成历史" : "数字资产"}</h1>
              <p>
                {showGenerationHistory
                  ? "每一次生成都会沉淀为一条记录，可继续预览、分享或复用结果。"
                  : "集中管理提示词、图片、视频、剧本、声音与品牌，随时在对话中复用。"}
              </p>
            </div>
            {!showGenerationHistory ? (
              <div className="wx-asset-hero-actions" aria-label="新增数字资产">
                {feishuSetupSkillReady ? (
                  <button type="button" className="is-feishu" onClick={openFeishuConnect}>
                    <CloudDownload aria-hidden />
                    <span>飞书接入</span>
                  </button>
                ) : null}
                <button type="button" className="is-material" onClick={() => openPreview(ASSET_UPLOAD_ENTRY)}>
                  <Upload aria-hidden />
                  <span>上传素材</span>
                </button>
                <button type="button" className="is-product" onClick={() => openPreview(PRODUCT_UPLOAD_ENTRY)}>
                  <Package aria-hidden />
                  <span>新建商品</span>
                </button>
                <button type="button" className="is-brand" onClick={() => openPreview(BRAND_CREATE_ENTRY)}>
                  <Building2 aria-hidden />
                  <span>新建品牌</span>
                </button>
              </div>
            ) : null}
          </div>
        </header>
        <div className="wx-asset-library">
          <div className="wx-asset-filter-row" aria-label={showGenerationHistory ? "生成历史筛选" : "资产分类"}>
            {(showGenerationHistory ? generationHistoryFilters : ASSET_VISIBLE_FILTERS).map((filter) => (
                <button
                  type="button"
                  key={filter}
                  className={[
                    filter === activeFilter ? "is-active" : "",
                    !showGenerationHistory && filter === "商品库" ? "is-product-filter" : "",
                    !showGenerationHistory && filter === "品牌库" ? "is-brand-filter" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-pressed={filter === activeFilter}
                  onClick={() => {
                    setActiveFilter(filter);
                    if (filter !== "提示词") setActivePromptCategory("全部");
                  }}
                >
                  {filter !== "全部" ? <i style={{ backgroundColor: FILTER_DOT_COLORS[filter] }} /> : null}
                  <span>{filter}</span>
                  <small>
                    {(showGenerationHistory ? generationHistoryFilterCounts : filterCounts).get(filter) || 0}
                  </small>
                </button>
              ))}
            <label className="wx-asset-search">
              <Search aria-hidden />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={showGenerationHistory ? "搜索生成历史..." : "搜索资产..."}
                aria-label={showGenerationHistory ? "搜索生成历史" : "搜索数字资产"}
              />
            </label>
            <button
              type="button"
              className="wx-asset-context-action"
              hidden={showGenerationHistory}
              onClick={() => openPreview(contextCreateEntry)}
            >
              <ContextCreateIcon aria-hidden />
              <span>{contextCreateLabel}</span>
            </button>
          </div>

          {!showGenerationHistory && activeFilter === "提示词" ? (
            <div className="wx-prompt-category-row" aria-label="提示词分类">
              {PROMPT_ASSET_CATEGORIES.map((category) => (
                <button
                  type="button"
                  key={category}
                  className={activePromptCategory === category ? "is-active" : ""}
                  aria-pressed={activePromptCategory === category}
                  onClick={() => setActivePromptCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>
          ) : null}

          <div className="wx-asset-grid" ref={assetGridRef}>
            {visibleAssets.length === 0 ? (
              <p className="wx-asset-empty-copy">{emptyCopy}</p>
            ) : null}
            {renderedAssets.map((item) => {
              const CornerIcon = item.kind === "图片" ? digitalAssetKindIcon(item.kind) : null;
              const generationHistory = isGenerationHistoryItem(item);
              const canShare = generationHistory && canShareGenerationHistory(item);
              const productHandoffs = item.kind === "商品库" && !isAssetCreationItem(item)
                ? handoffOptionsForAsset(item)
                : [];
              const showCardActions = Boolean(canShare || isLocalDigitalAsset(item) || productHandoffs.length);
              return (
                <article
                  key={item.id}
                  className={[
                    "wx-asset-card",
                    showCardActions ? "has-card-actions" : "",
                    item.kind === "商品库" ? "is-product" : "",
                    item.kind === "品牌库" ? "is-brand" : "",
                    item.preview === "assetUpload" ? "is-upload-action" : "",
                    item.preview === "productUpload" ? "is-product-upload" : "",
                    item.preview === "brandCreate" ? "is-brand-action" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <button
                    type="button"
                    className="wx-asset-card-main"
                    onClick={() => openPreview(item)}
                  >
                    <span className="wx-asset-tile">
                      <span className="wx-asset-badge">
                        <i style={{ backgroundColor: FILTER_DOT_COLORS[item.kind] }} />
                        <span>{item.kind}</span>
                      </span>
                      {CornerIcon ? <CornerIcon className="wx-asset-corner-icon" aria-hidden /> : null}
                      <WodeAppAssetTileContent item={item} />
                      <span className="wx-asset-tile-meta">{item.meta}</span>
                    </span>
                    <span className="wx-asset-card-title">
                      <span>{item.name}</span>
                    </span>
                    <span className="wx-asset-card-foot">
                      <span>{item.assetTime || "刚刚"} · {item.assetUse || "可复用"}</span>
                      {!generationHistory ? <PenLine aria-hidden /> : null}
                    </span>
                  </button>
                  {showCardActions ? (
                    <div className="wx-asset-card-actions">
                      {productHandoffs.map((option) => (
                        <button
                          key={option.label}
                          type="button"
                          className="wx-asset-generate-action"
                          title={option.label}
                          aria-label={`${option.label}${item.name}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            startAssetHandoff(item, option.label);
                          }}
                        >
                          {option.targetAgentId === "video-generation" ? <Film aria-hidden /> : <ImagePlus aria-hidden />}
                          <span>{option.label}</span>
                        </button>
                      ))}
                      {canShare ? (
                        <button
                          type="button"
                          className="wx-asset-share-action"
                          title="生成并复制分享链接"
                          aria-label={`分享${item.name}`}
                          disabled={sharingAssetId === item.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void shareGenerationHistory(item);
                          }}
                        >
                          <Share2 aria-hidden />
                          <span>{sharingAssetId === item.id ? "分享中" : "分享"}</span>
                        </button>
                      ) : null}
                      {isLocalDigitalAsset(item) ? (
                        <button
                          type="button"
                          className="wx-asset-delete-action"
                          title="删除本地资产"
                          aria-label={`删除${item.name}`}
                          disabled={deletingAssetId === item.id}
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDeleteAsset(item);
                          }}
                        >
                          <Trash2 aria-hidden />
                          <span>{deletingAssetId === item.id ? "删除中" : "删除"}</span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
          {hasMoreRenderedAssets ? (
            <div className="wx-asset-lazy-sentinel" ref={assetLazySentinelRef} aria-hidden />
          ) : null}
        </div>
      </section>

      {preview
        ? createPortal(
            <div className="wx-asset-modal-backdrop" role="presentation" onClick={closePreview}>
              <div
                className={[
                  "wx-asset-modal",
                  preview.kind === "商品库" ? "is-product-modal" : "",
                  preview.kind === "品牌库" ? "is-brand-modal" : "",
                  isAssetCreationItem(preview) ? "is-create-modal" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                role="dialog"
                aria-modal="true"
                aria-label={`${preview.name} ${isEditingAsset ? "编辑" : "预览"}`}
                onClick={(event) => event.stopPropagation()}
              >
                <header>
                  <span>{preview.kind}</span>
                  <div>
                    <h2>{preview.name}</h2>
                    <p>{preview.meta}</p>
                  </div>
                  <button type="button" onClick={closePreview} aria-label="关闭预览">
                    关闭
                  </button>
                </header>
                <div className="wx-asset-modal-body">
                  {isImageFormOpen ? (
                    <div className="wx-asset-create-form">
                      <label className="wx-asset-form-field">
                        <span>素材名称</span>
                        <input
                          value={imageDraft.name}
                          onChange={(event) => setImageDraft((draft) => ({ ...draft, name: event.target.value }))}
                          placeholder="例如：夏季海报参考图"
                        />
                      </label>
                      <label className="wx-asset-upload-field">
                        <input
                          className="wx-asset-file-input"
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(event) => {
                            const input = event.currentTarget;
                            void readImageFiles(input.files).then((images) => {
                              setImageDraft((draft) => ({ ...draft, images: [...draft.images, ...images].slice(0, 12) }));
                              input.value = "";
                            });
                          }}
                        />
                        <Upload aria-hidden />
                        <strong>选择图片</strong>
                        <small>支持多张素材或参考图</small>
                      </label>
                      {renderImageStrip(imageDraft.images, (index) => {
                        setImageDraft((draft) => ({
                          ...draft,
                          images: draft.images.filter((_, imageIndex) => imageIndex !== index),
                        }));
                      })}
                      <label className="wx-asset-form-field">
                        <span>备注</span>
                        <textarea
                          value={imageDraft.notes}
                          onChange={(event) => setImageDraft((draft) => ({ ...draft, notes: event.target.value }))}
                          placeholder="用途、风格、生成时要注意的点"
                        />
                      </label>
                    </div>
                  ) : null}

                  {isProductFormOpen ? (
                    <div className="wx-asset-create-form">
                      {renderProductTextField("name", "商品名称", "例如：便携保温杯")}
                      <label className="wx-asset-upload-field is-product">
                        <input
                          className="wx-asset-file-input"
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(event) => {
                            const input = event.currentTarget;
                            void readImageFiles(input.files).then((images) => {
                              setProductDraft((draft) => ({ ...draft, images: [...draft.images, ...images].slice(0, 12) }));
                              setProductAiFeedback(emptyAiFeedback());
                              input.value = "";
                            });
                          }}
                        />
                        <Package aria-hidden />
                        <strong>上传商品图</strong>
                        <small>主图、详情图或包装图都可以放进来</small>
                      </label>
                      {renderImageStrip(productDraft.images, (index) => {
                        setProductDraft((draft) => ({
                          ...draft,
                          images: draft.images.filter((_, imageIndex) => imageIndex !== index),
                        }));
                        setProductAiFeedback(emptyAiFeedback());
                      })}
                      <div className="wx-asset-ai-row">
                        <button
                          type="button"
                          onClick={runProductVisionFill}
                          disabled={productAiFeedback.status === "running"}
                        >
                          <Sparkles aria-hidden />
                          <span>{productAiFeedback.status === "running" ? "识别中..." : "AI 识图填入"}</span>
                        </button>
                        <span className={formatAiFeedbackClass(productAiFeedback)} aria-live="polite">
                          {productAiFeedback.message || "上传商品图后，可自动生成商品名称和描述。"}
                        </span>
                      </div>
                      {renderProductTextField("info", "商品描述", "简单描述这个商品的外观、用途或适合生成时参考的要点", true)}
                    </div>
                  ) : null}

                  {isBrandFormOpen ? (
                    <div className="wx-asset-create-form">
                      <label className="wx-asset-form-field">
                        <span>品牌资料</span>
                        <textarea
                          value={brandDraft.sourceText}
                          onChange={(event) => {
                            setBrandDraft((draft) => ({ ...draft, sourceText: event.target.value }));
                            setBrandAiFeedback(emptyAiFeedback());
                          }}
                          placeholder="输入品牌名称、官网介绍、品牌手册、定位、目标人群、禁用表达等"
                        />
                      </label>
                      <div className="wx-asset-form-grid">
                        <label className="wx-asset-upload-field is-brand">
                          <input
                            className="wx-asset-file-input"
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={(event) => {
                              const input = event.currentTarget;
                              void readImageFiles(input.files).then((images) => {
                                setBrandDraft((draft) => ({ ...draft, logoImages: [...draft.logoImages, ...images].slice(0, 6) }));
                                setBrandAiFeedback(emptyAiFeedback());
                                input.value = "";
                              });
                            }}
                          />
                          <Building2 aria-hidden />
                          <strong>上传 Logo</strong>
                          <small>可放主标、反白标或图标</small>
                        </label>
                        <label className="wx-asset-upload-field is-brand">
                          <input
                            className="wx-asset-file-input"
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={(event) => {
                              const input = event.currentTarget;
                              void readImageFiles(input.files).then((images) => {
                                setBrandDraft((draft) => ({ ...draft, resourceImages: [...draft.resourceImages, ...images].slice(0, 12) }));
                                setBrandAiFeedback(emptyAiFeedback());
                                input.value = "";
                              });
                            }}
                          />
                          <Upload aria-hidden />
                          <strong>上传品牌资源</strong>
                          <small>KV、样张、纹理、字体截图</small>
                        </label>
                      </div>
                      {renderImageStrip([...brandDraft.logoImages, ...brandDraft.resourceImages], (index) => {
                        setBrandDraft((draft) => {
                          if (index < draft.logoImages.length) {
                            return {
                              ...draft,
                              logoImages: draft.logoImages.filter((_, imageIndex) => imageIndex !== index),
                            };
                          }
                          const resourceIndex = index - draft.logoImages.length;
                          return {
                            ...draft,
                            resourceImages: draft.resourceImages.filter((_, imageIndex) => imageIndex !== resourceIndex),
                          };
                        });
                        setBrandAiFeedback(emptyAiFeedback());
                      })}
                      <div className="wx-asset-ai-row">
                        <button
                          type="button"
                          onClick={runBrandExtract}
                          disabled={brandAiFeedback.status === "running"}
                        >
                          <Sparkles aria-hidden />
                          <span>{brandAiFeedback.status === "running" ? "处理中..." : "AI 联网补全品牌信息"}</span>
                        </button>
                        <span className={formatAiFeedbackClass(brandAiFeedback)} aria-live="polite">
                          {brandAiFeedback.message || "输入资料或上传素材后会提取；只有品牌名时会联网查询并用 AI 整理。"}
                        </span>
                      </div>
                      {renderBrandEntryList(brandDraft.entries)}
                      <div className="wx-asset-form-grid">
                        <label className="wx-asset-form-field">
                          <span>品牌名称</span>
                          <input
                            value={brandDraft.name}
                            onChange={(event) => setBrandDraft((draft) => ({ ...draft, name: event.target.value }))}
                            placeholder="例如：Wode Coffee"
                          />
                        </label>
                        <label className="wx-asset-form-field">
                          <span>品牌色</span>
                          <input
                            value={brandDraft.colors}
                            onChange={(event) => setBrandDraft((draft) => ({ ...draft, colors: event.target.value }))}
                            placeholder="#FF6600, #C24F00"
                          />
                        </label>
                      </div>
                      <div className="wx-asset-brand-swatch-row" aria-label="品牌色预览">
                        {parseBrandColors(brandDraft.colors).map((color) => (
                          <i key={color} style={{ backgroundColor: color }} />
                        ))}
                      </div>
                      <label className="wx-asset-form-field">
                        <span>品牌语气</span>
                        <textarea
                          value={brandDraft.voice}
                          onChange={(event) => setBrandDraft((draft) => ({ ...draft, voice: event.target.value }))}
                          placeholder="例如：清晰、可信、轻量，避免夸张口吻"
                        />
                      </label>
                      <label className="wx-asset-form-field">
                        <span>使用规范</span>
                        <textarea
                          value={brandDraft.rules}
                          onChange={(event) => setBrandDraft((draft) => ({ ...draft, rules: event.target.value }))}
                          placeholder="Logo 留白、禁止事项、配色比例、画面风格"
                        />
                      </label>
                    </div>
                  ) : null}

                  {isGenericFormOpen ? (
                    <div className="wx-asset-create-form">
                      <label className="wx-asset-form-field">
                        <span>{genericFormKind}名称</span>
                        <input
                          value={genericDraft.name}
                          onChange={(event) => setGenericDraft((draft) => ({ ...draft, name: event.target.value }))}
                          placeholder={defaultNameForKind(genericFormKind)}
                        />
                      </label>
                      {genericFormKind === "提示词" ? (
                        <div className="wx-asset-form-grid">
                          <label className="wx-asset-form-field">
                            <span>提示词分类</span>
                            <select
                              value={genericDraft.promptCategory}
                              onChange={(event) => setGenericDraft((draft) => ({ ...draft, promptCategory: event.target.value as PromptAssetCategory }))}
                            >
                              {PROMPT_ASSET_CATEGORIES.filter((category) => category !== "全部").map((category) => (
                                <option key={category} value={category}>{category}</option>
                              ))}
                            </select>
                          </label>
                          <label className="wx-asset-form-field">
                            <span>标签</span>
                            <input
                              value={genericDraft.tags}
                              onChange={(event) => setGenericDraft((draft) => ({ ...draft, tags: event.target.value }))}
                              placeholder="风格、人物、产品图"
                            />
                          </label>
                        </div>
                      ) : null}
                      {genericFormKind !== "提示词" ? (
                        <label className="wx-asset-upload-field">
                          <input
                            className="wx-asset-file-input"
                            type="file"
                            accept={GENERIC_CREATE_LABELS[genericFormKind].accept}
                            multiple={genericFormKind === "真人"}
                            onChange={(event) => {
                              const input = event.currentTarget;
                              void readLocalFiles(input.files, (file) => acceptsGenericFile(file, genericFormKind)).then((files) => {
                                setGenericDraft((draft) => ({
                                  ...draft,
                                  files: genericFormKind === "真人" ? [...draft.files, ...files].slice(0, 12) : files.slice(0, 1),
                                }));
                                input.value = "";
                              });
                            }}
                          />
                          {genericFormKind === "视频" ? <Film aria-hidden /> : null}
                          {genericFormKind === "剧本" ? <FileText aria-hidden /> : null}
                          {genericFormKind === "声音" ? <Mic aria-hidden /> : null}
                          {genericFormKind === "真人" ? <UserRound aria-hidden /> : null}
                          <strong>{GENERIC_CREATE_LABELS[genericFormKind].action}</strong>
                          <small>{GENERIC_CREATE_LABELS[genericFormKind].meta}</small>
                        </label>
                      ) : null}
                      {renderFileStrip(genericDraft.files, (index) => {
                        setGenericDraft((draft) => ({
                          ...draft,
                          files: draft.files.filter((_, fileIndex) => fileIndex !== index),
                        }));
                      })}
                      <label className="wx-asset-form-field">
                        <span>{genericFormKind === "提示词" ? "提示词正文" : genericFormKind === "剧本" ? "剧本内容" : "备注"}</span>
                        <textarea
                          value={genericDraft.notes}
                          onChange={(event) => setGenericDraft((draft) => ({ ...draft, notes: event.target.value }))}
                          placeholder={
                            genericFormKind === "提示词"
                              ? "输入可复用的生成提示词"
                              : genericFormKind === "剧本"
                                ? "输入口播、分镜或剧情内容"
                                : "用途、风格、人物设定或生成时要注意的点"
                          }
                        />
                      </label>
                    </div>
                  ) : null}

                  {showPreviewDetails && documentPreviewHtml ? (
                    <div className="wx-asset-document-preview">
                      <iframe
                        className="wx-asset-document-frame"
                        title={`${preview.name} 文档预览`}
                        sandbox=""
                        srcDoc={documentPreviewHtml}
                      />
                    </div>
                  ) : null}
                  {showPreviewDetails && !documentPreviewHtml && preview.kind === "商品库" && previewProductImages.length ? renderImageStrip(previewProductImages) : null}
                  {showPreviewDetails && !documentPreviewHtml && preview.kind === "商品库" && productImageSyncLabel(preview) ? (
                    <p className="wx-asset-prompt-copy" role="status">
                      图片状态：{productImageSyncLabel(preview)}
                    </p>
                  ) : null}
                  {showPreviewDetails && !documentPreviewHtml && preview.promptText ? <p className="wx-asset-prompt-copy">{preview.promptText}</p> : null}
                  {showPreviewDetails && !documentPreviewHtml && preview.productInfo ? <p className="wx-asset-prompt-copy">{preview.productInfo}</p> : null}
                  {showPreviewDetails && !documentPreviewHtml && (preview.brandColors?.length || preview.brandVoice || preview.brandRules || preview.brandEntries?.length) ? (
                    <div className="wx-asset-brand-detail">
                      {preview.brandColors?.length ? (
                        <div className="wx-asset-brand-swatch-row" aria-label="品牌色">
                          {preview.brandColors.map((color) => (
                            <i key={color} style={{ backgroundColor: color }} />
                          ))}
                        </div>
                      ) : null}
                      {preview.brandVoice ? <p>{preview.brandVoice}</p> : null}
                      {preview.brandRules ? <p>{preview.brandRules}</p> : null}
                      {renderBrandEntryList(preview.brandEntries)}
                    </div>
                  ) : null}
                  {showPreviewDetails && !documentPreviewHtml && preview.kind !== "商品库" && preview.productImages?.length ? renderImageStrip(preview.productImages) : null}
                  {showPreviewDetails && !documentPreviewHtml && preview.assetImages?.length ? renderImageStrip(preview.assetImages) : null}
                  {showPreviewDetails && !documentPreviewHtml && preview.brandAssets?.length ? renderImageStrip(preview.brandAssets) : null}
                  {showPreviewDetails && !documentPreviewHtml ? renderSavedFilePreview(preview) : null}
                  {showPreviewDetails && !documentPreviewHtml ? renderSavedAttachmentFiles(preview) : null}
                  {showPreviewDetails && !documentPreviewHtml && !previewProductImages.length && !preview.assetImages?.length && !preview.brandAssets?.length && preview.coverImage ? (
                    <p className="wx-asset-cover-preview">
                      <button
                        type="button"
                        className="wx-asset-preview-thumb"
                        aria-label={`放大预览：${preview.name}`}
                        onClick={() => openImageLightbox(preview.coverImage || "", preview.name)}
                      >
                        <img src={preview.coverImage} alt="" />
                      </button>
                    </p>
                  ) : null}
                  {showPreviewDetails && !documentPreviewHtml && !preview.promptText && !preview.productInfo && !preview.brandVoice && !preview.brandRules && !preview.brandEntries?.length ? (
                    <p className="wx-asset-prompt-copy">
                      素材会进入数字资产库；在同一会话里 Agent 会自动读取工具产出、商品库与品牌库，一般无需手动 @。
                    </p>
                  ) : null}
                </div>
                <footer className="wx-asset-modal-footer">
                  <span className="wx-asset-footer-note">{footerNote}</span>
                  <div className="wx-asset-footer-actions">
                    <button type="button" onClick={isEditingAsset ? cancelEditPreview : closePreview}>
                      {isEditingAsset ? "取消编辑" : "取消"}
                    </button>
                    {canEditPreview && !isEditingAsset ? (
                      <button type="button" onClick={beginEditPreview}>
                        编辑
                      </button>
                    ) : null}
                    {preview
                      && !isEditingAsset
                      && !isAssetCreationItem(preview)
                      && preview.kind === "商品库"
                      ? (
                        <>
                          <button
                            type="button"
                            className="is-generate"
                            onClick={() => startProductGeneration(preview, "image")}
                          >
                            <ImagePlus aria-hidden />
                            <span>生成图片</span>
                          </button>
                          <button
                            type="button"
                            className="is-generate"
                            onClick={() => startProductGeneration(preview, "video")}
                          >
                            <Film aria-hidden />
                            <span>生成视频</span>
                          </button>
                        </>
                      ) : null}
                    {preview
                      && !isEditingAsset
                      && isGenerationHistoryItem(preview)
                      && canShareGenerationHistory(preview)
                      ? (
                        <button
                          type="button"
                          disabled={sharingAssetId === preview.id}
                          onClick={() => void shareGenerationHistory(preview)}
                        >
                          <Share2 aria-hidden />
                          <span>{sharingAssetId === preview.id ? "分享中" : "分享"}</span>
                        </button>
                      ) : null}
                    {preview
                      && !isEditingAsset
                      && isGenerationHistoryItem(preview)
                      && canShareGenerationHistory(preview)
                      ? (
                        <button
                          type="button"
                          disabled={sharingAssetId === preview.id}
                          onClick={() => void shareGenerationHistory(preview)}
                        >
                          <Share2 aria-hidden />
                          <span>{sharingAssetId === preview.id ? "分享中" : "分享"}</span>
                        </button>
                      ) : null}
                    {preview && isLocalDigitalAsset(preview) && !isEditingAsset ? (
                      <button
                        type="button"
                        className="is-danger"
                        disabled={deletingAssetId === preview.id}
                        onClick={() => void handleDeleteAsset(preview)}
                      >
                        <Trash2 aria-hidden />
                        <span>{deletingAssetId === preview.id ? "删除中" : "删除"}</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="is-primary"
                      disabled={primaryActionDisabled}
                      onClick={handlePrimaryAction}
                    >
                      {primaryActionLabel}
                    </button>
                  </div>
                </footer>
              </div>
            </div>,
            document.body,
          )
        : null}
      <ImageLightbox image={imageLightbox} onClose={() => setImageLightbox(null)} />
    </>
  );
}

export function filterDigitalAssetsForMention(query: string, kindFilter: DigitalAssetFilter, promptCategory: PromptAssetCategory) {
  const normalized = query.trim().toLowerCase();
  return getDigitalAssetsList().filter((item) => {
    if (isAssetCreationItem(item)) return false;
    if (kindFilter !== "全部" && item.kind !== kindFilter) return false;
    if (kindFilter === "提示词" && promptCategory !== "全部") {
      if (item.promptCategory !== promptCategory && !item.promptTags?.includes(promptCategory)) return false;
    }
    if (!normalized) return true;
    return digitalAssetSearchText(item).includes(normalized);
  });
}
