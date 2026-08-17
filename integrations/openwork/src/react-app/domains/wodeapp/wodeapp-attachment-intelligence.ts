import type { TextPartInput } from "@opencode-ai/sdk/v2/client";

import type { ComposerAssetMention, ComposerAttachment, ComposerDraft } from "@/app/types";
import type { AttachmentRequirements } from "./wodeapp-capability-routing";
import type { ResolvedMediaInputCapabilities } from "./wodeapp-model-media-input";
import {
  requestWodeAppAttachmentIntelligence,
  WodeAppRuntimeRequestError,
  type WodeAppAttachmentInput,
} from "@/app/lib/wodeapp-auth";
import {
  isWodeAppLocalAssetUrl,
  readWodeAppLocalAssetAsDataUrl,
} from "./wodeapp-local-asset";
import {
  desktopLocalFilePath,
  readDesktopLocalFileAsDataUrl,
  readDesktopLocalPathAsDataUrl,
} from "./desktop-local-file";

export type AttachmentIntelligenceSource = {
  label: string;
  filename: string;
};

export type AttachmentIntelligenceResult = {
  combinedContext: string;
  results: Array<{
    filename: string;
    kind: string;
    method: string;
    summary: string;
    url?: string;
    wordCount?: number;
    error?: string;
  }>;
  uploadedUrls: Array<{ filename: string; url: string; kind?: string }>;
  sources: AttachmentIntelligenceSource[];
  contextPackId?: string;
  /** Local pack id (ctx_…) for openwork_attachment_context_read / PDF re-read. */
  contextRefId?: string;
  cacheHit?: boolean;
  billing?: {
    creditsEstimated: number;
    creditsUsed: number;
    breakdown: Array<{ filename: string; kind: string; method: string; credits: number }>;
  };
};

export type UnderstandDraftAttachmentsOptions = {
  onProgress?: (message: string) => void;
  sessionId?: string;
};

/** 注入给模型的附件理解正文前缀；聊天 UI 不展示（见 `synthetic`）。 */
export const WODEAPP_ATTACHMENT_INTELLIGENCE_PREFIX =
  "以下是 WodeAppX 对话附件的本地工具与远程解析上下文。";
const LEGACY_WODEAPP_ATTACHMENT_INTELLIGENCE_PREFIX =
  "以下是 WodeApp 附件理解服务对用户上传与 @ 引用资产的结构化解析。";
/**
 * Vision 直塞首轮保留像素；同条消息植入的后续轮摘要前缀。
 * 会话空闲后不再把像素送进模型，附件卡片仍留在聊天里。
 */
export const WODEAPP_VISION_EPHEMERAL_SUMMARY_PREFIX =
  "以下是 WodeAppX 对话附件的视觉输入说明。";
/**
 * 空闲后把长附件理解正文压成 stub 时写入的标记；已含此标记则不再压缩。
 */
export const WODEAPP_ATTACHMENT_INTELLIGENCE_COMPACTED_MARKER =
  "[WodeAppX 附件上下文已压缩]";
/** 低于此长度的附件理解 part 不值得再压 stub（本身已接近指针体量）。 */
export const ATTACHMENT_INTELLIGENCE_COMPACT_MIN_CHARS = 400;

export function isHiddenAttachmentIntelligenceText(text: string | undefined): boolean {
  const value = (text || "").trim();
  if (!value) return false;
  return [
    WODEAPP_ATTACHMENT_INTELLIGENCE_PREFIX,
    LEGACY_WODEAPP_ATTACHMENT_INTELLIGENCE_PREFIX,
    WODEAPP_VISION_EPHEMERAL_SUMMARY_PREFIX,
  ].some((prefix) => value.startsWith(prefix));
}

export function isAttachmentIntelligencePartText(text: string | undefined): boolean {
  const value = (text || "").trim();
  if (!value) return false;
  return [
    WODEAPP_ATTACHMENT_INTELLIGENCE_PREFIX,
    LEGACY_WODEAPP_ATTACHMENT_INTELLIGENCE_PREFIX,
  ].some((prefix) => value.startsWith(prefix));
}

export function isAttachmentIntelligenceAlreadyCompacted(text: string | undefined): boolean {
  return (text || "").includes(WODEAPP_ATTACHMENT_INTELLIGENCE_COMPACTED_MARKER);
}

export function isValidLocalContextRefId(refId: string | undefined): boolean {
  const trimmed = refId?.trim() ?? "";
  return /^ctx_[a-zA-Z0-9_-]{8,120}$/.test(trimmed);
}

export function attachmentContextRefIdFromText(text: string | undefined): string {
  const match = (text || "").match(/\bcontextRefId=(ctx_[a-zA-Z0-9_-]{8,120})\b/);
  return match?.[1] ?? "";
}

export function attachmentHasUnreadLocalAttachments(text: string | undefined): boolean {
  return Boolean(text?.includes("以下附件保留在本机，尚未读取"));
}

export function attachmentLocalPathsFromText(text: string | undefined): string[] {
  return [...new Set(Array.from((text || "").matchAll(/^\s*path:\s*(.+?)\s*$/gm))
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value)))];
}

export function attachmentContextCanBeDehydrated(
  text: string | undefined,
  contextRefId?: string,
): boolean {
  if (!text || !isAttachmentIntelligencePartText(text)) return false;
  if (attachmentHasUnreadLocalAttachments(text)) return false;

  const ref = contextRefId?.trim() || attachmentContextRefIdFromText(text);
  if (isValidLocalContextRefId(ref)) return true;

  const hasRemoteParse = text.includes("附件理解结果：");
  const hasProductImages = text.includes("productImages=")
    || text.includes("candidateHttpsImages=")
    || text.includes("candidateImages=");
  if (hasRemoteParse && hasProductImages) return true;

  const localPaths = attachmentLocalPathsFromText(text);
  if (localPaths.length && hasRemoteParse && !attachmentHasUnreadLocalAttachments(text)) {
    return true;
  }

  return false;
}

function attachmentStubNeedsPdfTools(text: string, localPaths: string[]): boolean {
  if (localPaths.some((path) => /\.pdf$/i.test(path))) return true;
  const sourcesBlock = text.match(/附件来源：\n([\s\S]*?)(?:\n\n|$)/)?.[1] ?? "";
  return /\.pdf\b/i.test(sourcesBlock);
}

function attachmentStubNeedsOfficeTools(text: string, localPaths: string[]): boolean {
  if (localPaths.some((path) => /\.(docx?|xlsx?|xls|pptx?|csv)$/i.test(path))) return true;
  const sourcesBlock = text.match(/附件来源：\n([\s\S]*?)(?:\n\n|$)/)?.[1] ?? "";
  return /\.(docx?|xlsx?|xls|pptx?|csv)\b/i.test(sourcesBlock);
}

/**
 * 把首轮植入的长附件理解正文压成短 stub：保留来源、商品图 URL、contextPackId，
 * 去掉「附件理解结果」全文，提示模型需要时按工具重读。
 */
export function buildAttachmentIntelligenceHistoryStub(text: string): string | null {
  if (!isAttachmentIntelligencePartText(text)) return null;
  if (isAttachmentIntelligenceAlreadyCompacted(text)) return null;
  if (text.length < ATTACHMENT_INTELLIGENCE_COMPACT_MIN_CHARS) return null;
  if (attachmentHasUnreadLocalAttachments(text)) return null;

  const sourcesMatch = text.match(/附件来源：\n([\s\S]*?)(?:\n\n|$)/);
  const sourcesBlock = sourcesMatch
    ? `附件来源：\n${sourcesMatch[1].trim()}`
    : "";

  const packMatch = text.match(/\b(?:contextPackId|attachmentFingerprint)=([^\s\n]+)/);
  const attachmentFingerprint = packMatch?.[1]?.trim() || "";
  const contextRefId = attachmentContextRefIdFromText(text);
  const localPaths = attachmentLocalPathsFromText(text);

  const productLines = text
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => (
      line.includes("candidateImages=")
      || line.includes("candidateHttpsImages=")
      || line.includes("selectedImageIds")
      || line.includes("productImages=")
      || line.includes("wodeapp_product_save")
    ));
  // Prefer durable https pointers; drop prose metadata that bloats later turns.
  const httpsUrls = [...new Set(Array.from(text.matchAll(/https:\/\/[^\s"'<>\]]+/gi))
    .map((match) => match[0]?.replace(/[),.;]+$/g, "") || "")
    .filter(Boolean))];
  const httpsLine = httpsUrls.length
    ? `httpsImageUrls=${JSON.stringify(httpsUrls.slice(0, 16))}`
    : "";

  const needsPdfTools = attachmentStubNeedsPdfTools(text, localPaths);
  const needsOfficeTools = attachmentStubNeedsOfficeTools(text, localPaths);
  const hasRecoverableRemoteImages = productLines.length > 0 || httpsUrls.length > 0;
  if (!isValidLocalContextRefId(contextRefId) && !localPaths.length && !hasRecoverableRemoteImages) {
    return null;
  }
  const rereadInstruction = isValidLocalContextRefId(contextRefId)
    ? `完整解析已压缩。需要原文时调用 openwork_attachment_context_read(contextRefId=${contextRefId})；hasMore 时按 nextOffset 继续。禁止要求用户重复上传。`
    : needsPdfTools
    ? "完整解析已压缩。需要原文时按可重读本地路径调用 openwork_pdf_info / openwork_pdf_extract_text；禁止扫描无关目录或要求重复上传。"
    : needsOfficeTools
    ? "完整解析已压缩。需要原文时按可重读本地路径调用 openwork_file_extract_text / openwork_file_preview；禁止搜索其他目录或要求重复上传。"
    : hasRecoverableRemoteImages
    ? "远程图片解析已压缩。直接复用下方 https / candidateHttpsImages 或 @商品 URL；会话图用 selectedImageIds 绑定保存。普通后续对话不要再对本机大图做二次视觉灌入；复用 HTTPS / selectedImageIds。禁止再上传或扫描本机目录。"
    : "完整解析已压缩。需要细节时按可重读本地路径调用本地工具；禁止要求用户重复上传。";

  return [
    WODEAPP_ATTACHMENT_INTELLIGENCE_PREFIX,
    sourcesBlock,
    localPaths.length ? `可重读本地路径：\n${localPaths.join("\n")}` : "",
    WODEAPP_ATTACHMENT_INTELLIGENCE_COMPACTED_MARKER,
    attachmentFingerprint ? `attachmentFingerprint=${attachmentFingerprint}` : "",
    isValidLocalContextRefId(contextRefId) ? `contextRefId=${contextRefId}` : "",
    rereadInstruction,
    productLines.length ? productLines.join("\n") : "",
    // Avoid duplicating URLs already present in productImages= lines.
    httpsLine && !productLines.some((line) => line.includes("productImages=")) ? httpsLine : "",
  ].filter(Boolean).join("\n\n");
}

const DOCUMENT_FILE_PATTERN = /\.(pdf|docx?|xlsx?|csv|pptx?|txt|md)$/i;
const IMAGE_FILE_PATTERN = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;
/** 纯文本附件本地直读上限（无需远程凭证 / 不扣积分）。 */
const PLAIN_TEXT_INLINE_MAX_BYTES = 512 * 1024;
/**
 * OpenCode `prompt_async` inlines `file://` binaries into `data:` URLs.
 * Empirically a 6MB PDF became ~8.4MB `data:application/pdf` in the session DB.
 * Keep non-image chat file parts under this ceiling; larger docs use tools/placeholders.
 */
export const CHAT_NON_IMAGE_FILE_PART_MAX_BYTES = 512 * 1024;
const PLAIN_TEXT_FILE_PATTERN = /\.(txt|md|markdown|csv|json|ya?ml|log|srt|vtt)$/i;
const REMOTE_ATTACHMENT_MAX_FILE_BYTES = 50 * 1024 * 1024;
const REMOTE_ATTACHMENT_MAX_TOTAL_BYTES = 60 * 1024 * 1024;
/**
 * OpenCode Image.normalize default max edge is 2000 (not 2048).
 * Stay ≤2000 so photos never hit its PNG-first resize path.
 */
const IMAGE_COMPRESSION_MAX_DIMENSION = 2000;
/**
 * 小图透传阈值：
 * - 原始二进制 ≤ 300KB，且
 * - 长边 ≤ 2000（OpenCode 上限）
 * 超边长即使很小也必须先缩成 JPEG，否则 OpenCode 会 jpeg→png 爆体积。
 */
const IMAGE_COMPRESSION_MIN_BYTES = 300 * 1024;
/**
 * 上传侧规划预算（二进制字节）。OpenCode normalize 的硬上限一般是 ~3.75MB
 * base64（即 ~2.8MB 二进制），我们自压到 ≤1.5MB 二进制（base64 ≈ 2MB）
 * 以内，既留了安全余量，又不会让它二次编码。
 */
const IMAGE_COMPRESSION_PLANNED_MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_COMPRESSION_TARGET_BINARY_BYTES = 1536 * 1024; // ~1.5MB binary -> ~2MB base64
/** 照片类压缩质量阶梯：从高到低尝试，取第一个塞进预算的。 */
const IMAGE_JPEG_QUALITY_STEPS = [0.88, 0.8, 0.72, 0.64, 0.55];
const IMAGE_WEBP_QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55];
/** 分辨率下探阶梯（长边像素）：高画质塞不下时按比例缩小。首档对齐 OpenCode 2000。 */
const IMAGE_DIMENSION_STEPS = [2000, 1600, 1280, 1024, 768];
const COMPRESSIBLE_IMAGE_MIME_PATTERN = /^image\/(?:jpeg|jpg|png|webp|bmp)$/i;
/**
 * @ 数字资产直送视觉模型时，与商品库可保存上限对齐，不再人为截成 4 张。
 */
const MAX_ASSET_MENTION_REFERENCE_IMAGES = 12;

// 任务意图关键词：只有用户确实要基于资料生成/总结/分析等时才触发解析。
const ATTACHMENT_INTENT_PATTERN =
  /(总结|概括|提炼|归纳|梓理|梳理|分析|解读|解析|描述|读一?下|读取|看一?下|看看|基于|根据|依据|结合|参考|确认|记住|使用|沉淀|入库|保存|素材|资料|提取|抽取|整理|生成|制作|做一?[个份]|写一?[个份篇]|写成|改写|润色|翻译|转成|转换|摘要|要点|讲了什么|说了什么|内容是|里面有什么|识别|讲解|评估|审阅|校对|对比|比较|回答|问答|脚本|文案|方案|报告|大纲|表格|数据|图表|summari[sz]e|analy[sz]e|extract|translate|explain|describe|read|based on|according to|generate|write|rewrite|caption|transcribe|outline|summary)/i;
// 延后处理的表述：用户只是把资料“先放着”，不应自动解析扣费。
const ATTACHMENT_DEFER_PATTERN =
  /(先放着|先放这|放着|存着|先存|备用|待会|等会|稍后|暂时不|先不|以后再|回头再|留着)/;

const NON_IMAGE_ASSET_INTENT_PATTERN =
  /(视频|录像|录屏|动图|音频|声音|录音|pdf|文档|文件|说明书|手册|资料|表格|分镜|四宫格|关键帧|抽帧|转录|字幕|逐字稿|里面有什么|打开后|怎么开盖|video|audio|document|manual|transcri|keyframes?|contact sheet)/i;
// 显式要求重新识图 / 再解析：仍走附件理解服务。
const ASSET_FORCE_REPARSE_PATTERN =
  /(重新(?:解析|分析|识别|理解|看)|再次(?:解析|分析|识别|理解|看))/i;
// 本轮需要模型“看见”画面做核对（非生图）。有视觉模型时优先直送像素，
// 否则才回退远程附件理解。
const ASSET_VISUAL_INSPECT_PATTERN =
  /((?:看一?下|看看|查看|检查|核对).{0,24}(?:素材|商品|图片|照片|图)|看图|读图|查看图片|检查图片|核对图片|照片|画面|外观|实物|颜色|配色|轮廓|形状|造型|logo|标识|视觉|角度|细节|image|photo|visual|appearance)/i;
// 生图 / 分镜等：只读上下文里已有稳定图 URL，不走远程识图旁路。
const ASSET_GENERATION_PATTERN =
  /(主图|商品图|详情页套图|套图|生图|生成图|参考图|分镜|四宫格|关键帧|抽帧|storyboard|keyframes?|contact sheet|批量生成|生成一组|生成\s*\d+\s*张)/i;
// 兼容旧调用：强制重解析或需要看图，均视为“视觉相关”。
const ASSET_VISUAL_UNDERSTANDING_PATTERN = new RegExp(
  `${ASSET_FORCE_REPARSE_PATTERN.source}|${ASSET_VISUAL_INSPECT_PATTERN.source}`,
  "i",
);
const READ_ONLY_ASSET_CONTEXT_MARKER = "[已关联数字资产：只读素材上下文]";

const PRODUCT_IDENTITY_ANALYSIS_INSTRUCTION = [
  "[商品参考图解析要求]",
  "请在摘要中单独输出【SKU 保真锁定】，只依据图片逐项描述：整体几何轮廓与长宽比例（例如圆柱、圆角方柱、扁平正反面）、原始颜色、材质是否不透明、Logo 位置，以及按钮、杯盖、吸管等部件的准确形状和相对位置。",
  "不得把高亮颜色或反光推断成发光灯效，不得补充参考图未显示的密封圈、内部结构、屏幕或其他功能部件。",
].join("\n");

function draftIntentText(draft: ComposerDraft): string {
  const resolved = (draft.resolvedText ?? draft.text).trim();
  const contextIndex = resolved.indexOf(READ_ONLY_ASSET_CONTEXT_MARKER);
  return contextIndex >= 0 ? resolved.slice(0, contextIndex).trim() : resolved;
}

function draftHasProductAssetMention(draft: ComposerDraft): boolean {
  return (draft.assetMentions || []).some((mention) =>
    /商品|产品|product/i.test(mention.kind || "")
    || Boolean(mention.productImages?.length),
  );
}

function assetMentionReferenceImageCount(refs: ComposerAssetMention[] | undefined): number {
  return (refs || []).reduce((count, ref) => count + [
    ref.coverImage,
    ...(ref.productImages || []),
    ...(ref.assetImages || []),
    ...(ref.brandAssets || []),
    ...(isImageMime(ref.assetFileType) ? [ref.assetFile] : []),
    ...(ref.assetFiles || []).filter((file) => isImageMime(file.type)).map((file) => file.url),
  ].filter(Boolean).length, 0);
}

function assetMentionsHaveVideo(refs: ComposerAssetMention[] | undefined): boolean {
  return (refs || []).some((ref) =>
    isVideoMime(ref.assetFileType, ref.assetFileName || ref.name) ||
    (ref.assetFiles || []).some((file) => isVideoMime(file.type, file.name)),
  );
}

function shouldUseProductVideoFallback(draft: ComposerDraft): boolean {
  return draftHasProductAssetMention(draft)
    && draftRequestsAttachmentUse(draftIntentText(draft))
    && assetMentionReferenceImageCount(draft.assetMentions) === 0
    && assetMentionsHaveVideo(draft.assetMentions);
}

/** 判断用户文本是否表达了“需要用到附件”的意图。 */
export function draftRequestsAttachmentUse(text: string | undefined): boolean {
  const value = (text || "").trim();
  if (!value) return false;
  if (ATTACHMENT_DEFER_PATTERN.test(value)) return false;
  if (/[?？]/.test(value)) return true;
  return ATTACHMENT_INTENT_PATTERN.test(value);
}

export function draftRequestsNonImageAssetUse(text: string | undefined): boolean {
  const value = (text || "").trim();
  if (!value || ATTACHMENT_DEFER_PATTERN.test(value)) return false;
  return NON_IMAGE_ASSET_INTENT_PATTERN.test(value);
}

/** 判断本轮是否显式要求重新解析 / 再看 @ 数字资产画面。 */
export function draftRequestsAssetForceReparse(text: string | undefined): boolean {
  const value = (text || "").trim();
  if (!value || ATTACHMENT_DEFER_PATTERN.test(value)) return false;
  return ASSET_FORCE_REPARSE_PATTERN.test(value);
}

/** 判断本轮是否需要模型看见画面做核对（不含纯生图意图）。 */
export function draftRequestsAssetVisualInspect(text: string | undefined): boolean {
  const value = (text || "").trim();
  if (!value || ATTACHMENT_DEFER_PATTERN.test(value)) return false;
  if (draftRequestsAssetForceReparse(value)) return true;
  if (ASSET_GENERATION_PATTERN.test(value) && !ASSET_VISUAL_INSPECT_PATTERN.test(value)) {
    return false;
  }
  return ASSET_VISUAL_INSPECT_PATTERN.test(value);
}

/** 判断本轮是否主要为生图 / 分镜等生成任务。 */
export function draftRequestsAssetGeneration(text: string | undefined): boolean {
  const value = (text || "").trim();
  if (!value || ATTACHMENT_DEFER_PATTERN.test(value)) return false;
  return ASSET_GENERATION_PATTERN.test(value);
}

/** 判断本轮任务是否必须重新查看 @ 数字资产的原始画面（强制重解析或核对）。 */
export function draftRequestsAssetVisualUnderstanding(text: string | undefined): boolean {
  const value = (text || "").trim();
  if (!value || ATTACHMENT_DEFER_PATTERN.test(value)) return false;
  return ASSET_VISUAL_UNDERSTANDING_PATTERN.test(value);
}

function assetMentionImageUrls(refs: ComposerAssetMention[] | undefined): string[] {
  return [...new Set((refs || []).flatMap((ref) => [
    ref.coverImage,
    ...(ref.productImages || []),
    ...(ref.assetImages || []),
    ...(ref.brandAssets || []),
    ...(isImageMime(ref.assetFileType) ? [ref.assetFile] : []),
    ...(ref.assetFiles || []).filter((file) => isImageMime(file.type)).map((file) => file.url),
  ].filter(Boolean) as string[]))];
}

/**
 * @ 引用图是否已经是 OpenCode 接受的视觉 file part。
 * OpenCode 的 Image.normalize 只接受 base64 data URL；远程 HTTPS URL 必须
 * 保留在只读素材上下文或工具参数中，不能伪装成 file part。
 */
export function assetMentionHasInlinableImages(refs: ComposerAssetMention[] | undefined): boolean {
  return assetMentionImageUrls(refs).some((url) => {
    const trimmed = url.trim();
    return trimmed.startsWith("data:image/")
      || isWodeAppLocalAssetUrl(trimmed);
  });
}

async function attachmentToDataUrl(file: File, mimeType: string): Promise<string> {
  const desktopDataUrl = await readDesktopLocalFileAsDataUrl(file, mimeType);
  if (desktopDataUrl) return desktopDataUrl;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const timeout = globalThis.setTimeout(() => {
      reader.abort();
      reject(new Error(`读取附件超时：${file.name}`));
    }, 30000);
    reader.onerror = () => {
      globalThis.clearTimeout(timeout);
      reject(new Error(`Failed to read attachment: ${file.name}`));
    };
    reader.onload = () => {
      globalThis.clearTimeout(timeout);
      resolve(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onabort = () => globalThis.clearTimeout(timeout);
    reader.readAsDataURL(new Blob([file], { type: mimeType }));
  });
}

function attachmentTimingNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function roundAttachmentTiming(value: number): number {
  return Math.round(Math.max(0, value) * 10) / 10;
}

function createAttachmentTimingId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to a portable identifier for older desktop runtimes.
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function logAttachmentTiming(event: Record<string, unknown>): void {
  try {
    console.info("[AttachmentIntelligenceTiming]", JSON.stringify({ source: "client", ...event }));
  } catch {
    // Diagnostics must never interrupt attachment understanding.
  }
}

function dataUrlByteLength(dataUrl: string): number {
  const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
  return payload ? Math.floor(payload.length * 0.75) : 0;
}

type PreparedAttachmentData = {
  data: string;
  mimeType: string;
  originalBytes: number;
  preparedBytes: number;
  compressed: boolean;
  elapsedMs: number;
  width?: number;
  height?: number;
};

type ImageCandidate = {
  data: string;
  mimeType: string;
  bytes: number;
  width: number;
  height: number;
  quality: number;
};

/**
 * 判断图像是否含透明通道。
 * 采样策略：每隔若干像素取 1x1 小方块读 alpha，避免把整图像素拉进内存。
 * 对产品白底图/截图边缘来说，稀疏采样足够识别是否有 alpha；未命中则按不
 * 透明走 JPEG（安全降级）。
 */
function imageHasTransparency(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
): boolean {
  try {
    // 长边最多分 ~48 个采样格，覆盖均匀；每格只读 1x1 像素。
    const gridCount = Math.min(48, Math.max(24, Math.floor(Math.min(width, height) / 64)));
    const stepX = Math.max(1, Math.floor(width / gridCount));
    const stepY = Math.max(1, Math.floor(height / gridCount));
    // 留 4px 边距，避免正好落在画布边缘抗锯齿上。
    const margin = 4;
    for (let y = margin; y < height - margin; y += stepY) {
      for (let x = margin; x < width - margin; x += stepX) {
        const pixel = context.getImageData(x, y, 1, 1);
        const alpha = pixel.data[3];
        if (alpha < 250) return true;
      }
    }
  } catch {
    // CORS 污染或读取失败，按不透明处理（安全降级到 JPEG）。
    return false;
  }
  return false;
}

/**
 * 在给定 canvas 上生成一个候选编码（dataURL），返回字节大小。
 */
function encodeCanvasCandidate(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): { data: string; bytes: number } | null {
  try {
    const data = canvas.toDataURL(mimeType, quality);
    if (!data || !data.startsWith("data:")) return null;
    return { data, bytes: dataUrlByteLength(data) };
  } catch {
    return null;
  }
}

/**
 * 从一组候选里选出最优：
 * 1) 优先"不超目标字节"的候选里，按 bytes 降序（保真度最高，因为同样合
 *    规越大越清晰）；
 * 2) 全都超限则选 bytes 最小的（勉强塞进上传）。
 * 另外强制：若候选比原图 base64 还大，直接淘汰。
 */
function pickBestCandidate(
  candidates: ImageCandidate[],
  originalDataUrlBytes: number,
): ImageCandidate | null {
  const usable = candidates
    .filter((c) => c.data && c.bytes > 0 && c.bytes < originalDataUrlBytes);
  if (!usable.length) return null;
  const compliant = usable.filter((c) => c.bytes <= IMAGE_COMPRESSION_TARGET_BINARY_BYTES);
  if (compliant.length) {
    // 合规里挑最大的（画质最高）。
    return compliant.reduce((best, c) => (c.bytes > best.bytes ? c : best));
  }
  // 全都超目标：挑最小的，尽量少超。
  return usable.reduce((best, c) => (c.bytes < best.bytes ? c : best));
}

function drawImageToCanvas(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  fillBackground: boolean,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: !fillBackground });
  if (!context) throw new Error("canvas 2d context unavailable");
  if (fillBackground) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
  }
  context.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

async function prepareAttachmentDataForUnderstanding(
  file: File,
  mimeType: string,
): Promise<PreparedAttachmentData> {
  const startedAt = attachmentTimingNow();
  const originalData = await attachmentToDataUrl(file, mimeType);
  const originalDataBytes = dataUrlByteLength(originalData);
  const fallback = (extra: Partial<PreparedAttachmentData> = {}): PreparedAttachmentData => ({
    data: originalData,
    mimeType,
    originalBytes: file.size,
    preparedBytes: originalDataBytes,
    compressed: false,
    elapsedMs: roundAttachmentTiming(attachmentTimingNow() - startedAt),
    ...extra,
  });

  if (
    !COMPRESSIBLE_IMAGE_MIME_PATTERN.test(mimeType) ||
    typeof createImageBitmap !== "function" ||
    typeof document === "undefined"
  ) {
    return fallback();
  }

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file);
    const maxDimension = Math.max(bitmap.width, bitmap.height);

    // 小图直接透传：大小 + 尺寸都在 OpenCode 安全区（≤2000 边且 ≤300KB）。
    if (file.size <= IMAGE_COMPRESSION_MIN_BYTES && maxDimension <= IMAGE_COMPRESSION_MAX_DIMENSION) {
      return fallback({ width: bitmap.width, height: bitmap.height });
    }

    // 先按目标上限尺寸画一次，顺便用采样判断是否含 alpha，决定输出 MIME。
    // 用 2000 档做 probe：超大原图没必要全尺寸画进 canvas 只为读 alpha。
    const probeScale = Math.min(1, IMAGE_COMPRESSION_MAX_DIMENSION / maxDimension);
    const probeW = Math.max(1, Math.round(bitmap.width * probeScale));
    const probeH = Math.max(1, Math.round(bitmap.height * probeScale));
    const probeCanvas = drawImageToCanvas(bitmap, probeW, probeH, false);
    const probeCtx = probeCanvas.getContext("2d", { alpha: true });
    const hasAlpha = Boolean(probeCtx && imageHasTransparency(probeCtx, probeW, probeH));

    // 格式决策：
    // - 有透明通道 → WebP（体积比 PNG 小 25-45%，视觉模型兼容）
    // - 照片/不透明 → JPEG（q0.8+ 时体积远小于 PNG，照片无肉眼损失）
    // - 不再把 PNG 作为输出候选，避免 "PNG 优先"坑。
    const outputMime = hasAlpha ? "image/webp" : "image/jpeg";
    const qualitySteps = hasAlpha ? IMAGE_WEBP_QUALITY_STEPS : IMAGE_JPEG_QUALITY_STEPS;

    const candidates: ImageCandidate[] = [];

    // 分辨率阶梯：从最大的目标尺寸开始往下探，先保留像素再降质量。
    const dimSteps = IMAGE_DIMENSION_STEPS.filter((d) => d < maxDimension);
    // 如果原图已经 ≤ 2000，也要把"原尺寸"放进候选。
    if (maxDimension <= IMAGE_COMPRESSION_MAX_DIMENSION) {
      dimSteps.unshift(maxDimension);
    }

    for (const targetDim of dimSteps) {
      const scale = Math.min(1, targetDim / maxDimension);
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = drawImageToCanvas(bitmap, w, h, !hasAlpha);
      for (const q of qualitySteps) {
        const enc = encodeCanvasCandidate(canvas, outputMime, q);
        if (enc) {
          candidates.push({
            data: enc.data,
            mimeType: outputMime,
            bytes: enc.bytes,
            width: w,
            height: h,
            quality: q,
          });
        }
      }
      // 已经找到合规的，就没必要再缩更小尺寸了。
      const alreadyOk = candidates.some((c) => c.bytes <= IMAGE_COMPRESSION_TARGET_BINARY_BYTES);
      if (alreadyOk) break;
    }

    // 带透明图兜底：若 WebP 候选全部失败（极少数旧环境），退化到 PNG；
    // 但 PNG 只在这一个兜底分支出现，绝不优先。
    if (hasAlpha && candidates.length === 0) {
      for (const targetDim of dimSteps) {
        const scale = Math.min(1, targetDim / maxDimension);
        const w = Math.max(1, Math.round(bitmap.width * scale));
        const h = Math.max(1, Math.round(bitmap.height * scale));
        const canvas = drawImageToCanvas(bitmap, w, h, false);
        const enc = encodeCanvasCandidate(canvas, "image/png", 1);
        if (enc) {
          candidates.push({
            data: enc.data,
            mimeType: "image/png",
            bytes: enc.bytes,
            width: w,
            height: h,
            quality: 1,
          });
        }
      }
    }

    const best = pickBestCandidate(candidates, originalDataBytes);
    if (!best) {
      return fallback({ width: bitmap.width, height: bitmap.height });
    }

    return {
      data: best.data,
      mimeType: best.mimeType,
      originalBytes: file.size,
      preparedBytes: best.bytes,
      // 只要比原图小就算 compressed；若只是换了 MIME 但分辨率没变也算。
      compressed: best.bytes < originalDataBytes,
      elapsedMs: roundAttachmentTiming(attachmentTimingNow() - startedAt),
      width: best.width,
      height: best.height,
    };
  } catch {
    return fallback();
  } finally {
    bitmap?.close();
  }
}

function isImageMime(mimeType: string | undefined) {
  return Boolean(mimeType?.startsWith("image/"));
}

function isDocumentLikeMime(mimeType: string | undefined, filename: string) {
  const mime = mimeType || "";
  if (mime === "application/pdf" || mime.includes("presentation") || mime.includes("powerpoint")) return true;
  if (mime.includes("word") || mime.includes("spreadsheet") || mime.includes("csv")) return true;
  if (mime.startsWith("text/")) return true;
  return DOCUMENT_FILE_PATTERN.test(filename);
}

function isVideoMime(mimeType: string | undefined, filename: string) {
  return mimeType?.startsWith("video/") || /\.(mp4|mov|webm|mkv)$/i.test(filename);
}

function isAudioMime(mimeType: string | undefined, filename: string) {
  return mimeType?.startsWith("audio/") || /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(filename);
}

export function isComposerImageAttachment(attachment: ComposerAttachment): boolean {
  if (attachment.kind === "image") return true;
  const mime = (attachment.mimeType || attachment.file?.type || "").trim().toLowerCase();
  if (mime.startsWith("image/")) return true;
  // Clipboard / Electron File often arrives with empty mime; never treat
  // image.jpg as a path-only non-image (that writes model-facing file://).
  return IMAGE_FILE_PATTERN.test(attachment.name || attachment.file?.name || "");
}

export function isComposerPdfAttachment(attachment: ComposerAttachment): boolean {
  const mime = (attachment.mimeType || "").toLowerCase();
  return mime === "application/pdf" || /\.pdf$/i.test(attachment.name || "");
}

export function isComposerOfficeAttachment(attachment: ComposerAttachment): boolean {
  const mime = (attachment.mimeType || "").toLowerCase();
  const name = attachment.name || "";
  if (mime.includes("word") || mime.includes("presentation") || mime.includes("powerpoint") || mime.includes("spreadsheet")) {
    return true;
  }
  return /\.(docx?|xlsx?|pptx?)$/i.test(name);
}

/** 视觉/多模态模型可直接吃的上传附件：图片 + PDF（Word/PPT/视频仍走工具链）。 */
export function isComposerVisionInlineableAttachment(attachment: ComposerAttachment): boolean {
  return isComposerImageAttachment(attachment) || isComposerPdfAttachment(attachment);
}

export function hasNonImageAttachments(attachments: ComposerAttachment[]): boolean {
  return attachments.some((attachment) => !isComposerImageAttachment(attachment));
}

export function draftHasImageAttachments(draft: ComposerDraft): boolean {
  return draft.attachments.some(isComposerImageAttachment);
}

export function draftHasOnlyImageAttachments(draft: ComposerDraft): boolean {
  return draft.attachments.length > 0 && draft.attachments.every(isComposerImageAttachment);
}

export function draftHasOnlyVisionInlineableAttachments(draft: ComposerDraft): boolean {
  return draft.attachments.length > 0
    && draft.attachments.every(isComposerVisionInlineableAttachment);
}

function resolveMediaCaps(input: {
  modelSupportsVision: boolean;
  mediaInput?: ResolvedMediaInputCapabilities;
}): ResolvedMediaInputCapabilities {
  if (input.mediaInput) return input.mediaInput;
  return {
    image: input.modelSupportsVision,
    video: false,
    pdf: input.modelSupportsVision,
    office: false,
    remoteImageUrl: input.modelSupportsVision,
    skipRemoteVisionParse: input.modelSupportsVision,
    specKey: "legacy-vision-flag",
    notes: "兼容旧调用：仅传 modelSupportsVision 时，按看图能力直送图片/PDF。",
  };
}

function attachmentTooLargeForChatFilePart(attachment: ComposerAttachment): boolean {
  const fileSize = Number(attachment.file?.size || 0);
  const metaSize = Number(attachment.size || 0);
  const size = Math.max(
    Number.isFinite(fileSize) ? fileSize : 0,
    Number.isFinite(metaSize) ? metaSize : 0,
  );
  return size > CHAT_NON_IMAGE_FILE_PART_MAX_BYTES;
}

function attachmentMatchesMediaCaps(
  attachment: ComposerAttachment,
  caps: ResolvedMediaInputCapabilities,
): boolean {
  if (isComposerImageAttachment(attachment)) return caps.image;
  // Cursor/Codex-style: video/audio stay path + tools. Never chat-inline as data:/file parts
  // even when catalog says video:"native" — that flag must not authorize session base64.
  if (isVideoMime(attachment.mimeType, attachment.name)) return false;
  if (isAudioMime(attachment.mimeType, attachment.name)) return false;
  // PDF/Office: only tiny files may ride chat file parts. Larger ones are inlined by
  // OpenCode into multi-MB data:application payloads and poison session hydrate.
  if (isComposerPdfAttachment(attachment)) {
    return caps.pdf && !attachmentTooLargeForChatFilePart(attachment);
  }
  if (isComposerOfficeAttachment(attachment)) {
    return caps.office && !attachmentTooLargeForChatFilePart(attachment);
  }
  if (isPlainTextInlineAttachment(attachment)) return true;
  return false;
}

function canInlineDraftMediaInPrompt(
  draft: ComposerDraft,
  caps: ResolvedMediaInputCapabilities,
): boolean {
  return draft.attachments.length > 0
    && draft.attachments.every((attachment) => attachmentMatchesMediaCaps(attachment, caps));
}

/** @deprecated Prefer canInlineDraftMediaInPrompt with mediaInput matrix. */
function canInlineDraftImagesInPrompt(draft: ComposerDraft, modelSupportsVision: boolean): boolean {
  return canInlineDraftMediaInPrompt(draft, resolveMediaCaps({ modelSupportsVision }));
}

export function isPlainTextInlineAttachment(attachment: ComposerAttachment): boolean {
  const mime = (attachment.mimeType || "").toLowerCase();
  if (mime.startsWith("text/")) return true;
  if (mime === "application/json" || mime === "application/x-yaml" || mime === "application/csv") {
    return true;
  }
  return PLAIN_TEXT_FILE_PATTERN.test(attachment.name);
}

/** 对话附件是否全部为可本地直读的纯文本（不含 @ 文档资产）。 */
export function draftHasOnlyInlinePlainTextAttachments(draft: ComposerDraft): boolean {
  if (!draft.attachments.length) return false;
  if (hasDocumentAssetMentions(draft.assetMentions)) return false;
  return draft.attachments.every((attachment) => {
    if (attachment.kind === "image" || attachment.mimeType.startsWith("image/")) return false;
    if (!isPlainTextInlineAttachment(attachment)) return false;
    return attachment.file.size <= PLAIN_TEXT_INLINE_MAX_BYTES;
  });
}

/**
 * 从草稿中提取所有可直读纯文本（允许与图片/PDF 混传）。
 * 混传时远程附件理解不应再吞掉 TXT——先本地抽出正文，再让 PDF 走本地工具。
 */
export async function extractInlinePlainTextFromDraft(
  draft: ComposerDraft,
): Promise<{
  combinedContext: string;
  results: AttachmentIntelligenceResult["results"];
  sources: AttachmentIntelligenceSource[];
} | null> {
  const results: AttachmentIntelligenceResult["results"] = [];
  const blocks: string[] = [];
  const sources: AttachmentIntelligenceSource[] = [];

  for (const attachment of draft.attachments) {
    if (attachment.kind === "image" || attachment.mimeType.startsWith("image/")) continue;
    if (!isPlainTextInlineAttachment(attachment)) continue;
    if (attachment.file.size > PLAIN_TEXT_INLINE_MAX_BYTES) continue;
    const text = await attachment.file.text();
    const trimmed = text.trim();
    sources.push({ label: "对话上传", filename: attachment.name });
    if (!trimmed) {
      results.push({
        filename: attachment.name,
        kind: "document",
        method: "text-extract",
        summary: "",
        error: "文件为空",
      });
      continue;
    }
    results.push({
      filename: attachment.name,
      kind: "document",
      method: "text-extract",
      summary: trimmed,
      wordCount: trimmed.split(/\s+/).filter(Boolean).length,
    });
    blocks.push(`### ${attachment.name}\n${trimmed}`);
  }

  if (!blocks.length) return null;
  return {
    combinedContext: [
      "以下纯文本附件已在本机直接读取（无需远程附件理解）：",
      blocks.join("\n\n"),
    ].join("\n\n"),
    results,
    sources,
  };
}

export async function understandPlainTextAttachmentsLocally(
  draft: ComposerDraft,
): Promise<AttachmentIntelligenceResult | null> {
  if (!draftHasOnlyInlinePlainTextAttachments(draft)) return null;
  const extracted = await extractInlinePlainTextFromDraft(draft);
  if (!extracted?.combinedContext) return null;
  return {
    combinedContext: extracted.combinedContext,
    results: extracted.results,
    uploadedUrls: [],
    sources: extracted.sources,
  };
}

export function imageAttachmentsFromDraft(draft: ComposerDraft): ComposerAttachment[] {
  return draft.attachments.filter(
    (attachment) => attachment.kind === "image" || attachment.mimeType.startsWith("image/"),
  );
}

function isDocumentAssetMention(ref: ComposerAssetMention): boolean {
  if ((ref.assetFiles || []).some((file) =>
    isDocumentLikeMime(file.type, file.name) || isVideoMime(file.type, file.name),
  )) return true;
  const filename = ref.assetFileName || ref.name || "";
  const mimeType = ref.assetFileType || "";
  if (ref.kind === "文件") return true;
  if (ref.assetFile && isDocumentLikeMime(mimeType, filename)) return true;
  if (ref.assetFile && isVideoMime(mimeType, filename)) return true;
  return false;
}

function hasDocumentAssetMentions(refs: ComposerAssetMention[] | undefined): boolean {
  return (refs || []).some((ref) => isDocumentAssetMention(ref));
}

function uniqueKey(input: { filename: string; data?: string; url?: string }) {
  return [input.filename, input.url || "", String(input.data?.length || 0)].join("|");
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const mb = bytes / 1024 / 1024;
  return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
}

type LocalAttachmentToolRef = {
  filename: string;
  mimeType: string;
  path: string;
  size: number;
  reason: string;
};

type SkippedAttachmentRef = {
  filename: string;
  mimeType: string;
  size: number;
  reason: string;
};

type AttachmentRoutePlan = {
  uploadAttachments: ComposerAttachment[];
  localToolRefs: LocalAttachmentToolRef[];
  skippedRefs: SkippedAttachmentRef[];
};

function localAttachmentPath(file: File): string | null {
  const raw = desktopLocalFilePath(file);
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return null;
  if (/^file:\/\//i.test(raw)) {
    try {
      return decodeURIComponent(new URL(raw).pathname);
    } catch {
      return raw.replace(/^file:\/\//i, "");
    }
  }
  return raw;
}

/**
 * Stamp durable absolute paths onto composer File objects so planAttachmentRoutes
 * can keep PDF/Office on the local tool path (Codex-style), even when the browser
 * File blob had no native path.
 */
export function stampComposerAttachmentLocalPaths(
  attachments: ComposerAttachment[],
  pathByFilename: Map<string, string> | Record<string, string>,
  pathByAttachmentId: Map<string, string> | Record<string, string> = new Map(),
): number {
  const lookup = pathByFilename instanceof Map
    ? pathByFilename
    : new Map(Object.entries(pathByFilename));
  const idLookup = pathByAttachmentId instanceof Map
    ? pathByAttachmentId
    : new Map(Object.entries(pathByAttachmentId));
  let stamped = 0;
  for (const attachment of attachments) {
    const filename = (attachment.name || attachment.file.name || "").trim();
    if (!filename) continue;
    const nextPath = (idLookup.get(attachment.id) || lookup.get(filename) || "").trim();
    if (!nextPath || /^https?:\/\//i.test(nextPath)) continue;
    let absolute = nextPath;
    if (/^file:\/\//i.test(nextPath)) {
      try {
        absolute = decodeURIComponent(new URL(nextPath).pathname);
      } catch {
        absolute = nextPath.replace(/^file:\/\//i, "");
      }
    }
    if (!(absolute.startsWith("/") || /^[A-Za-z]:[\\/]/.test(absolute))) continue;
    Object.defineProperty(attachment.file, "path", {
      configurable: true,
      value: absolute,
    });
    stamped += 1;
  }
  return stamped;
}

/** Attachments that still lack a durable absolute path after materialize/stamp. */
export function listComposerAttachmentsMissingLocalPath(
  attachments: ComposerAttachment[],
): string[] {
  const missing: string[] = [];
  for (const attachment of attachments) {
    const name = (attachment.name || attachment.file.name || "attachment").trim() || "attachment";
    if (!desktopLocalFilePath(attachment.file)?.trim()) {
      missing.push(name);
    }
  }
  return missing;
}

function skippedRef(attachment: ComposerAttachment, reason: string): SkippedAttachmentRef {
  return {
    filename: attachment.name || attachment.file.name || "attachment",
    mimeType: attachment.mimeType || attachment.file.type || "application/octet-stream",
    size: attachment.file.size,
    reason,
  };
}

function planAttachmentRoutes(
  attachments: ComposerAttachment[],
  pathOverrides: Map<string, string> = new Map(),
  pathOverridesByAttachmentId: Map<string, string> = new Map(),
): AttachmentRoutePlan {
  const uploadAttachments: ComposerAttachment[] = [];
  const localToolRefs: LocalAttachmentToolRef[] = [];
  const skippedRefs: SkippedAttachmentRef[] = [];
  let uploadBytes = 0;

  for (const attachment of attachments) {
    const filename = attachment.name || attachment.file.name || "attachment";
    const overridePath = pathOverrides.get(filename)?.trim() || "";
    const attachmentOverridePath = pathOverridesByAttachmentId.get(attachment.id)?.trim() || "";
    const resolvedPath = attachmentOverridePath || overridePath || localAttachmentPath(attachment.file) || "";
    const isVideo = isVideoMime(attachment.mimeType, filename);
    const isAudio = isAudioMime(attachment.mimeType, filename);
    const isAv = isVideo || isAudio;
    const canStayLocal = Boolean(
      resolvedPath
      && (isDocumentLikeMime(attachment.mimeType, filename) || isAv)
      && !(attachment.kind === "image" || attachment.mimeType.startsWith("image/")),
    );
    const isLocalDocument = canStayLocal && isDocumentLikeMime(attachment.mimeType, filename);
    const isLocalPdf = canStayLocal && (
      attachment.mimeType.toLowerCase() === "application/pdf" || /\.pdf$/i.test(filename)
    );
    // Prefer local PDF/Office/text tools — do not send PDF to remote attachment intelligence.
    const forceLocalDocument = isDocumentLikeMime(attachment.mimeType, filename)
      && !(attachment.kind === "image" || attachment.mimeType.startsWith("image/"))
      && Boolean(resolvedPath);
    // Video/audio must never be POSTed as data: to /ai/attachments/understand.
    // A 3MB mp4 becomes ~4MB JSON and 413s the gateway; keep path + local media tools.
    const forceLocalAv = isAv
      && !(attachment.kind === "image" || attachment.mimeType.startsWith("image/"));
    const tooLarge = attachment.file.size > REMOTE_ATTACHMENT_MAX_FILE_BYTES;
    const plannedBytes = COMPRESSIBLE_IMAGE_MIME_PATTERN.test(attachment.mimeType)
      ? Math.min(attachment.file.size, IMAGE_COMPRESSION_PLANNED_MAX_BYTES)
      : attachment.file.size;
    const wouldExceedTotal = uploadBytes + plannedBytes > REMOTE_ATTACHMENT_MAX_TOTAL_BYTES;

    if (
      isLocalDocument
      || forceLocalDocument
      || (forceLocalAv && resolvedPath)
      || (canStayLocal && (tooLarge || wouldExceedTotal))
    ) {
      localToolRefs.push({
        filename,
        mimeType: attachment.mimeType || attachment.file.type || "application/octet-stream",
        path: resolvedPath,
        size: attachment.file.size,
        reason: isLocalPdf || /\.pdf$/i.test(filename)
          ? "PDF 保留在本机，由 Agent 显式调用 openwork_pdf_info / openwork_pdf_extract_text（不走远程 pdf-parse）"
          : isVideo || isAudio
          ? "视频/音频保留在本机，由 Agent 使用 openwork_file_media_probe / openwork_media_view 按 path 查看（不走远程附件理解）"
          : isLocalDocument || forceLocalDocument
          ? "文档保留在本机，由 Agent 使用本地文件工具提取文字并按需生成预览"
          : tooLarge
          ? "文件较大，保留在本机用本地文件工具读取"
          : "本次附件总量较大，保留在本机分步读取",
      });
      continue;
    }

    if (forceLocalAv) {
      skippedRefs.push(skippedRef(
        attachment,
        "视频/音频未取得可用本地路径，未上传远程附件理解服务。请用本机文件重新添加。",
      ));
      continue;
    }

    if (tooLarge || wouldExceedTotal) {
      skippedRefs.push(skippedRef(
        attachment,
        tooLarge ? "文件较大且当前未取得可用本地路径，未上传远程附件理解服务" : "本次附件总量较大且当前未取得可用本地路径，未上传远程附件理解服务",
      ));
      continue;
    }

    uploadAttachments.push(attachment);
    uploadBytes += plannedBytes;
  }

  return { uploadAttachments, localToolRefs, skippedRefs };
}

/** Persist chat PDF/Office/text blobs that lack Electron paths so local tools can read them. */
async function materializeDocumentPathOverrides(
  attachments: ComposerAttachment[],
  sessionId?: string,
): Promise<{
  pathOverrides: Map<string, string>;
  pathOverridesByAttachmentId: Map<string, string>;
  contextRefId?: string;
}> {
  const pathOverrides = new Map<string, string>();
  const pathOverridesByAttachmentId = new Map<string, string>();
  const needPersist: Array<{
    attachmentId: string;
    filename: string;
    mime: string;
    dataUrl: string;
  }> = [];

  for (const attachment of attachments) {
    const filename = attachment.name || attachment.file.name || "attachment";
    if (attachment.kind === "image" || attachment.mimeType.startsWith("image/")) continue;
    if (
      !isDocumentLikeMime(attachment.mimeType, filename)
      && !isVideoMime(attachment.mimeType, filename)
      && !isAudioMime(attachment.mimeType, filename)
    ) continue;
    if (isPlainTextInlineAttachment(attachment) && attachment.file.size <= PLAIN_TEXT_INLINE_MAX_BYTES) {
      // Plain text is inlined separately; no need to force a path.
      continue;
    }
    const existing = localAttachmentPath(attachment.file);
    if (existing) {
      pathOverridesByAttachmentId.set(attachment.id, existing);
      if (!pathOverrides.has(filename)) pathOverrides.set(filename, existing);
      continue;
    }
    try {
      const buffer = await attachment.file.arrayBuffer();
      if (!buffer.byteLength) continue;
      const mime = attachment.mimeType || attachment.file.type || "application/octet-stream";
      const bytes = new Uint8Array(buffer);
      let binary = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      needPersist.push({
        attachmentId: attachment.id,
        filename,
        mime,
        dataUrl: `data:${mime};base64,${btoa(binary)}`,
      });
    } catch (error) {
      console.warn("[WodeAppX] failed to read document attachment for local materialize", error);
    }
  }

  if (!needPersist.length) return { pathOverrides, pathOverridesByAttachmentId };
  if (typeof window === "undefined" || !window.__OPENWORK_ELECTRON__?.invokeDesktop) {
    return { pathOverrides, pathOverridesByAttachmentId };
  }

  const { persistAttachmentContext } = await import("./wodeapp-attachment-context-store");
  const stored = await persistAttachmentContext({
    sessionId: sessionId || "attachment-docs",
    context: "local document attachment paths",
    sources: needPersist.map((file) => ({ label: "对话上传", filename: file.filename })),
    files: needPersist.map(({ filename, mime, dataUrl }) => ({ filename, mime, dataUrl })),
  });
  for (let index = 0; index < (stored?.files.length || 0); index += 1) {
    const file = stored!.files[index];
    const pending = needPersist[index];
    const path = file?.path?.trim() || "";
    if (!path || !pending) continue;
    pathOverridesByAttachmentId.set(pending.attachmentId, path);
    const originalFilename = file.originalFilename?.trim() || pending.filename;
    if (!pathOverrides.has(originalFilename)) pathOverrides.set(originalFilename, path);
  }
  return {
    pathOverrides,
    pathOverridesByAttachmentId,
    contextRefId: stored?.refId,
  };
}

function attachmentFileExtension(filename: string): string {
  const match = filename.match(/(\.[^./\\]+)$/);
  return match?.[1]?.toLowerCase() ?? "";
}

export function buildAttachmentRequirementsFromDraft(draft: ComposerDraft): AttachmentRequirements {
  const routePlan = planAttachmentRoutes(draft.attachments ?? []);
  const localDocuments = routePlan.localToolRefs.map((ref) => ({
    filename: ref.filename,
    mimeType: ref.mimeType,
    extension: attachmentFileExtension(ref.filename),
    readStatus: "unread" as const,
  }));
  const localRead = localDocuments.length > 0;
  const requiredTools = new Set<string>();
  if (localRead) {
    requiredTools.add("openwork_file_extract_text");
    requiredTools.add("openwork_file_preview");
    requiredTools.add("openwork_file_media_probe");
    const hasPdf = localDocuments.some((doc) =>
      doc.extension === ".pdf" || doc.mimeType?.toLowerCase() === "application/pdf",
    );
    if (hasPdf) {
      requiredTools.add("openwork_pdf_info");
      requiredTools.add("openwork_pdf_extract_text");
      requiredTools.add("openwork_pdf_render_pages");
    }
  }
  return {
    localRead,
    requiredCapabilities: localRead ? ["files"] : undefined,
    requiredTools: [...requiredTools],
    localDocuments,
  };
}

function buildLocalAttachmentReadingGuidance(plan: AttachmentRoutePlan): string {
  const hasPdf = plan.localToolRefs.some((ref) =>
    /\.pdf$/i.test(ref.filename) || ref.mimeType.toLowerCase() === "application/pdf",
  );
  const hasLegacyXls = plan.localToolRefs.some((ref) => /\.xls$/i.test(ref.filename));
  const hasOffice = plan.localToolRefs.some((ref) =>
    /\.(docx?|xlsx?|pptx?|csv)$/i.test(ref.filename),
  ) || hasLegacyXls;
  const hasAv = plan.localToolRefs.some((ref) =>
    isVideoMime(ref.mimeType, ref.filename) || isAudioMime(ref.mimeType, ref.filename),
  );
  const lines: string[] = [];
  if (hasAv) {
    lines.push(
      "视频/音频：使用 openwork_file_media_probe 查看时长与编码，需要看画面时调用 openwork_media_view({ path })；按上方精确绝对 path 操作，禁止把整段文件改成 data: 再上传。",
    );
  }
  if (hasPdf) {
    lines.push(
      "PDF 固定流程：PDF 工具已直接可用。先调用 openwork_pdf_info 检查页数与元数据，然后调用 openwork_pdf_extract_text 逐页提取文本；扫描件、表格、商品参数或视觉版式任务再调用 openwork_pdf_render_pages 渲染相关页面并读取生成的图片。",
    );
  }
  if (hasOffice) {
    lines.push(
      "Office/表格/文本文档：使用 openwork_file_extract_text / openwork_file_preview / openwork_file_media_probe 按精确 path 读取；不要扫描其他目录。",
    );
  }
  if (hasLegacyXls) {
    lines.push(
      "Legacy .xls：直接调用 openwork_file_extract_text（内置 BIFF8/SheetJS，不依赖 soffice）。成功结果含 sheet/row/cell 证据；若返回 XLS_CORRUPT、XLS_ENCRYPTED、XLS_TOO_LARGE、XLS_NOT_BIFF8 或 LEGACY_XLS_DEPENDENCY_MISSING，如实报告并禁止调用 wodeapp_product_save，不要假装已读取表格内容。",
    );
  }
  if (!lines.length) {
    lines.push(
      "大体积本地附件：使用 openwork_file_extract_text / openwork_file_preview / openwork_file_media_probe 分步读取。",
    );
  }
  return lines.join("\n");
}

function buildLocalAttachmentToolContext(plan: AttachmentRoutePlan): string {
  const localLines = plan.localToolRefs
    .map((ref, index) => [
      `${index + 1}. ${ref.filename}`,
      `   path: ${ref.path}`,
      `   mime: ${ref.mimeType}`,
      `   size: ${formatBytes(ref.size)}`,
      `   reason: ${ref.reason}`,
    ].join("\n"))
    .join("\n");
  const skippedLines = plan.skippedRefs
    .map((ref, index) => `${index + 1}. ${ref.filename} (${ref.mimeType}, ${formatBytes(ref.size)}): ${ref.reason}`)
    .join("\n");

  return [
    localLines
      ? [
          "以下附件保留在本机，尚未读取。请先加载并调用对应的本地工具，不要在工具返回前声称已经读取内容。",
          localLines,
          buildLocalAttachmentReadingGuidance(plan),
        ].join("\n\n")
      : "",
    skippedLines
      ? [
          "以下附件因体积较大且没有可用本地路径，未上传远程附件理解服务。请提示用户改用本地文件路径、拆分文件，或上传到资源库后再引用。",
          skippedLines,
        ].join("\n\n")
      : "",
  ].filter(Boolean).join("\n\n");
}

function routePlanResults(plan: AttachmentRoutePlan): AttachmentIntelligenceResult["results"] {
  return [
    ...plan.localToolRefs.map((ref) => ({
      filename: ref.filename,
      kind: "document",
      method: "local-file-tool",
      summary: ref.reason,
    })),
    ...plan.skippedRefs.map((ref) => ({
      filename: ref.filename,
      kind: "document",
      method: "deferred",
      summary: ref.reason,
      error: ref.reason,
    })),
  ];
}

function routePlanSources(plan: AttachmentRoutePlan): AttachmentIntelligenceSource[] {
  return [
    ...plan.localToolRefs.map((ref) => ({ label: "本地文件工具", filename: ref.filename })),
    ...plan.skippedRefs.map((ref) => ({ label: "未上传附件", filename: ref.filename })),
  ];
}

function isRequestEntityTooLarge(error: unknown) {
  if (error instanceof WodeAppRuntimeRequestError && error.status === 413) return true;
  const message = error instanceof Error ? error.message : String(error || "");
  return /413|request entity too large|payload too large/i.test(message);
}

async function resolveRemoteAttachmentInput(
  url: string,
  filename: string,
  mimeType?: string,
): Promise<WodeAppAttachmentInput | null> {
  const trimmed = url.trim();
  if (trimmed.startsWith("data:")) {
    return { filename, mimeType, data: trimmed };
  }
  if (isWodeAppLocalAssetUrl(trimmed)) {
    try {
      const data = await readWodeAppLocalAssetAsDataUrl(trimmed, mimeType, filename);
      return { filename, mimeType, data };
    } catch (error) {
      console.warn("[WodeAppX] Skipped an unavailable local asset reference", { filename, error });
      return null;
    }
  }
  if (/^file:\/\//i.test(trimmed)) {
    try {
      const filePath = decodeURIComponent(new URL(trimmed).pathname);
      const data = await readDesktopLocalPathAsDataUrl(filePath, mimeType || "application/octet-stream");
      return data ? { filename, mimeType, data } : null;
    } catch (error) {
      console.warn("[WodeAppX] Skipped an unavailable local file asset reference", { filename, error });
      return null;
    }
  }
  try {
    const protocol = new URL(trimmed).protocol.toLowerCase();
    if (protocol !== "http:" && protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { filename, mimeType, url: trimmed };
}

async function collectAssetMentionInputs(
  refs: ComposerAssetMention[] | undefined,
  _modelSupportsVision: boolean,
  includeNonImageFiles: boolean,
): Promise<Array<WodeAppAttachmentInput & { sourceLabel: string }>> {
  const items: Array<WodeAppAttachmentInput & { sourceLabel: string }> = [];
  const seen = new Set<string>();

  const push = async (
    sourceLabel: string,
    filename: string,
    mimeType: string | undefined,
    data?: string,
    url?: string,
  ) => {
    const input: WodeAppAttachmentInput | null = data
      ? { filename, mimeType, data }
      : url
        ? await resolveRemoteAttachmentInput(url, filename, mimeType)
        : null;
    if (!input) return;
    const key = uniqueKey(input);
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ ...input, sourceLabel });
  };

  for (const ref of refs || []) {
    const refLabel = `${ref.kind} · ${ref.name}`;
    const fileName = ref.assetFileName || ref.name || "asset-file";
    const fileType = ref.assetFileType || "";

    if (ref.assetFile) {
      const documentLike = isDocumentLikeMime(fileType, fileName);
      const videoLike = isVideoMime(fileType, fileName);
      const imageLike = isImageMime(fileType) || IMAGE_FILE_PATTERN.test(fileName);
      if (imageLike || (includeNonImageFiles && (documentLike || videoLike))) {
        if (ref.assetFile.startsWith("data:")) {
          await push(refLabel, fileName, fileType, ref.assetFile);
        } else {
          await push(refLabel, fileName, fileType, undefined, ref.assetFile);
        }
      }
    }

    for (const file of ref.assetFiles || []) {
      const documentLike = isDocumentLikeMime(file.type, file.name);
      const videoLike = isVideoMime(file.type, file.name);
      const imageLike = isImageMime(file.type) || IMAGE_FILE_PATTERN.test(file.name);
      if (imageLike || (includeNonImageFiles && (documentLike || videoLike))) {
        if (file.url.startsWith("data:")) {
          await push(refLabel, file.name, file.type, file.url);
        } else {
          await push(refLabel, file.name, file.type, undefined, file.url);
        }
      }
    }

    const imageUrls = [...new Set([
      ref.coverImage,
      ...(ref.productImages || []),
      ...(ref.assetImages || []),
      ...(ref.brandAssets || []),
      ...(ref.assetFiles || []).filter((file) => isImageMime(file.type)).map((file) => file.url),
    ].filter(Boolean) as string[])].slice(0, MAX_ASSET_MENTION_REFERENCE_IMAGES);
    for (const [index, imageUrl] of imageUrls.entries()) {
      const name = `${ref.name || fileName}-image-${index + 1}`;
      if (imageUrl.startsWith("data:")) {
        await push(refLabel, name, "image/*", imageUrl);
      } else {
        await push(refLabel, name, "image/*", undefined, imageUrl);
      }
    }
  }

  return items;
}

async function collectDraftAttachmentInputsForPlan(
  draft: ComposerDraft,
  modelSupportsVision: boolean,
  routePlan: AttachmentRoutePlan,
): Promise<Array<WodeAppAttachmentInput & { sourceLabel: string }>> {
  const items: Array<WodeAppAttachmentInput & { sourceLabel: string }> = [];
  const seen = new Set<string>();

  for (const attachment of routePlan.uploadAttachments) {
    const prepared = await prepareAttachmentDataForUnderstanding(attachment.file, attachment.mimeType);
    logAttachmentTiming({
      phase: isImageMime(attachment.mimeType) ? "image-prepare" : "attachment-prepare",
      filename: attachment.name,
      mimeType: attachment.mimeType,
      preparedMimeType: prepared.mimeType,
      originalBytes: prepared.originalBytes,
      preparedBytes: prepared.preparedBytes,
      compressed: prepared.compressed,
      width: prepared.width,
      height: prepared.height,
      elapsedMs: prepared.elapsedMs,
    });
    const input = {
      filename: attachment.name,
      mimeType: prepared.mimeType,
      data: prepared.data,
      sourceLabel: "对话上传",
    };
    const key = uniqueKey(input);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(input);
  }

  const includeNonImageFiles = draftRequestsNonImageAssetUse(draftIntentText(draft))
    || shouldUseProductVideoFallback(draft);
  for (const mentionInput of await collectAssetMentionInputs(
    draft.assetMentions,
    modelSupportsVision,
    includeNonImageFiles,
  )) {
    const key = uniqueKey(mentionInput);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(mentionInput);
  }

  return items;
}

export async function collectDraftAttachmentInputs(
  draft: ComposerDraft,
  modelSupportsVision: boolean,
): Promise<Array<WodeAppAttachmentInput & { sourceLabel: string }>> {
  return collectDraftAttachmentInputsForPlan(draft, modelSupportsVision, planAttachmentRoutes(draft.attachments));
}

export function shouldUseAttachmentIntelligence(input: {
  enabled: boolean;
  draft: ComposerDraft;
  modelSupportsVision: boolean;
  /** Per-model media input matrix (preferred). */
  mediaInput?: ResolvedMediaInputCapabilities;
  /** 显式“解析附件”动作：跳过意图判断直接解析。 */
  explicitParse?: boolean;
}): boolean {
  const attachments = input.draft.attachments;
  const mentions = input.draft.assetMentions;
  if (!attachments.length && !mentions?.length) return false;
  const intentText = draftIntentText(input.draft);
  const mediaCaps = resolveMediaCaps(input);

  // 入库/保存意图不强制附件理解：能看图就 vision-direct（或带本机路径立刻开跑），
  // HTTPS 只在真正调用 wodeapp_product_save / image_asset_save 时由 materialize 上传。

  const hasVideoAttachment = attachments.some((attachment) =>
    isVideoMime(attachment.mimeType, attachment.name),
  );
  const hasVideoAssetMention = assetMentionsHaveVideo(mentions);
  const requestsNonImageAssetUse = draftRequestsNonImageAssetUse(
    intentText,
  );
  const hasRelevantVideoAssetMention = hasVideoAssetMention
    && (requestsNonImageAssetUse || shouldUseProductVideoFallback(input.draft));
  // Video mentions without native video input still need parse / tools even when
  // the workbench flag is absent.
  if (!input.enabled && !hasVideoAttachment && !hasRelevantVideoAssetMention) return false;
  const mentionImageCount = assetMentionReferenceImageCount(mentions);

  const hasParseable =
    attachments.length > 0 ||
    (hasRelevantVideoAssetMention && hasDocumentAssetMentions(mentions)) ||
    mentionImageCount > 0;
  if (!hasParseable) return false;

  if (input.explicitParse) return true;

  // Video always stays on the local path / tool / attachment-intelligence path.
  // Catalog video:"native" must not put megabyte data:video blobs into the transcript.
  if (hasVideoAttachment || hasRelevantVideoAssetMention) {
    return true;
  }

  if (canInlineDraftMediaInPrompt(input.draft, mediaCaps)) return false;
  if (attachments.length > 0) {
    return draftRequestsAttachmentUse(intentText);
  }

  // @ 数字资产：有图能力时直送采样图，跳过远程识图旁路。
  if (mentionImageCount <= 0) return false;
  const needsPixels = draftRequestsAssetForceReparse(intentText)
    || draftRequestsAssetVisualInspect(intentText)
    || draftRequestsAssetGeneration(intentText);
  if (!needsPixels) return false;
  if (mediaCaps.image && assetMentionHasInlinableImages(mentions)) return false;
  return true;
}

/**
 * 是否把 @ 引用图打成视觉 file part。
 * 生图 / 看图 / 重新看都把采样图直接交给大模型。
 */
export function shouldIncludeAssetMentionFilesInPrompt(input: {
  draft: ComposerDraft;
  modelSupportsVision: boolean;
  useAttachmentIntelligence: boolean;
  mediaInput?: ResolvedMediaInputCapabilities;
}): boolean {
  if (input.useAttachmentIntelligence) return false;
  const mediaCaps = resolveMediaCaps(input);
  if (!mediaCaps.image) return false;
  if (!assetMentionHasInlinableImages(input.draft.assetMentions)) return false;
  const intentText = draftIntentText(input.draft);
  return draftRequestsAssetForceReparse(intentText)
    || draftRequestsAssetVisualInspect(intentText)
    || draftRequestsAssetGeneration(intentText);
}

/**
 * 是否把原始上传附件折叠成聊天记录占位（不送模型）。
 * 模型原生支持的媒体直送；其余保留占位并走工具。
 */
export function shouldPreserveAttachmentsAsDisplayOnly(input: {
  enabled: boolean;
  draft: ComposerDraft;
  modelSupportsVision?: boolean;
  mediaInput?: ResolvedMediaInputCapabilities;
}): boolean {
  if (!input.enabled || input.draft.attachments.length === 0) return false;
  const mediaCaps = resolveMediaCaps({
    modelSupportsVision: input.modelSupportsVision ?? false,
    mediaInput: input.mediaInput,
  });
  if (canInlineDraftMediaInPrompt(input.draft, mediaCaps)) return false;
  return true;
}

/**
 * 把模型原生支持的附件打成 file part。
 */
export function shouldIncludeRawAttachmentsInPrompt(input: {
  modelSupportsVision: boolean;
  useAttachmentIntelligence: boolean;
  preserveAttachmentsAsDisplayOnly: boolean;
  draft: ComposerDraft;
  mediaInput?: ResolvedMediaInputCapabilities;
}): { includeRawAttachments: boolean; imagesOnly: boolean } {
  const mediaCaps = resolveMediaCaps(input);
  if (canInlineDraftMediaInPrompt(input.draft, mediaCaps)) {
    return {
      includeRawAttachments: true,
      imagesOnly: draftHasOnlyImageAttachments(input.draft),
    };
  }
  return {
    includeRawAttachments: !input.useAttachmentIntelligence && !input.preserveAttachmentsAsDisplayOnly,
    imagesOnly: false,
  };
}

/** Prompt-facing candidateImages row: keep absolute path/https so tools never invent workspace paths. */
export type AttachmentPromptImageCandidate = {
  imageId: string;
  filename: string;
  localPath?: string;
  httpsUrl?: string;
};

export function serializeCandidateImageForPrompt(item: AttachmentPromptImageCandidate): Record<string, string> {
  const row: Record<string, string> = {
    id: item.imageId,
    file: item.filename,
  };
  const path = item.localPath?.trim() || "";
  const https = item.httpsUrl?.trim() || "";
  if (path) row.path = path;
  if (https && /^https:\/\//i.test(https)) row.https = https;
  return row;
}

export const CHAT_IMAGE_PATH_GUARD =
  "对话上传图片：存商品/进图片库直接用 selectedImageIds（或已有 candidateHttpsImages），对话图已走附件/视觉直送，勿再对本轮图做二次视觉灌入；存库用 selectedImageIds。禁止把裸文件名拼到 default-workspace/工作区相对路径。";

/**
 * 视觉模型直塞图片时，同轮植入后续轮摘要（synthetic，UI 隐藏）。
 * 附件在发送时落成本机路径；HTTPS 等到 wodeapp_product_save 时再上传。
 * 禁止把裸文件名当作唯一身份。
 */
export function buildVisionEphemeralFollowupPart(
  attachments: ComposerAttachment[],
  options: {
    contextRefId?: string;
    localPaths?: string[];
    durableProductImageUrls?: string[];
    imageCandidates?: AttachmentPromptImageCandidate[];
  } = {},
): TextPartInput {
  const images = attachments.filter(isComposerImageAttachment);
  const filenames = images.map((attachment) => attachment.name.trim()).filter(Boolean);
  const localPaths = [...new Set(
    (options.localPaths || [])
      .map((value) => value.trim())
      .filter(Boolean),
  )];
  const durableProductImageUrls = [...new Set(
    (options.durableProductImageUrls || [])
      .map((value) => value.trim())
      .filter(Boolean),
  )];
  const imageCandidates = options.imageCandidates || [];
  const contextRefId = options.contextRefId?.trim() || "";

  // One compact listing only — do not triple-repeat filename/path/cards (context bloat).
  const attachmentLines = filenames.map((filename, index) => {
    const path = localPaths[index];
    return path
      ? `${index + 1}. ${filename} path=${path}`
      : `${index + 1}. ${filename}`;
  });

  const candidateLine = imageCandidates.length
    ? `candidateImages=${JSON.stringify(imageCandidates.map(serializeCandidateImageForPrompt))}`
    : "";
  const productImagesLine = durableProductImageUrls.length
    ? `productImages=${JSON.stringify(durableProductImageUrls)}`
    : "";
  const overLimit = Math.max(imageCandidates.length, durableProductImageUrls.length) > 12
    ? "超过 12 张：只问用户一次，再按意图传 selectedImageIds（商品库 product_save / 图片库 image_asset_save）；禁止自动补图。"
    : (imageCandidates.length || durableProductImageUrls.length)
      ? "会话图可用 selectedImageIds：存商品用 wodeapp_product_save，进图片库用 wodeapp_image_asset_save。"
      : "";
  const chatImageGuard = imageCandidates.length || localPaths.length ? CHAT_IMAGE_PATH_GUARD : "";

  const recoverHint = localPaths.length
    ? "后续按上方精确绝对 path 读文档/PDF；对话图片存库用 selectedImageIds。禁止把裸文件名拼到 default-workspace/工作区相对路径。"
    : contextRefId
      ? "后续轮次可调用 openwork_attachment_context_read 获取缓存精确本地路径；对话图片存库仍用 selectedImageIds，禁止拼 default-workspace/文件名。"
      : "本轮未能落本地路径；请要求用户重新上传，或改用附件理解链路。不要猜测 default-workspace 路径。";

  return {
    type: "text",
    synthetic: true,
    text: [
      WODEAPP_VISION_EPHEMERAL_SUMMARY_PREFIX,
      "本轮已通过视觉模型直接查看上述图片像素。空闲后默认不再把像素送进后续模型轮次，聊天里仍保留附件卡片。",
      attachmentLines.length ? `附件：\n${attachmentLines.join("\n")}` : "",
      recoverHint,
      chatImageGuard,
      candidateLine,
      productImagesLine,
      overLimit,
      contextRefId ? `contextRefId=${contextRefId}` : "",
    ].filter(Boolean).join("\n\n"),
  } as TextPartInput;
}

export async function understandDraftAttachments(
  draft: ComposerDraft,
  modelSupportsVision: boolean,
  options: UnderstandDraftAttachmentsOptions = {},
): Promise<AttachmentIntelligenceResult> {
  const startedAt = attachmentTimingNow();
  const timingId = createAttachmentTimingId();
  options.onProgress?.("已收到附件，正在读取…");
  const localReadStartedAt = attachmentTimingNow();
  const localPlainText = await understandPlainTextAttachmentsLocally(draft);
  if (localPlainText?.combinedContext) {
    logAttachmentTiming({
      phase: "batch",
      timingId,
      mode: "local-text",
      fileCount: draft.attachments.length,
      localReadMs: roundAttachmentTiming(attachmentTimingNow() - localReadStartedAt),
      totalMs: roundAttachmentTiming(attachmentTimingNow() - startedAt),
      cacheHit: false,
    });
    options.onProgress?.("附件已解析，正在整理回答…");
    return localPlainText;
  }

  // Mixed uploads: still inline TXT/MD locally, and materialize PDF/Office to disk
  // so openwork_pdf_* / openwork_file_* can read them (no remote pdf-parse).
  const mixedPlainText = await extractInlinePlainTextFromDraft(draft);
  const {
    pathOverrides,
    pathOverridesByAttachmentId,
    contextRefId: docContextRefId,
  } = await materializeDocumentPathOverrides(
    draft.attachments,
    options.sessionId,
  );
  const routePlan = planAttachmentRoutes(
    draft.attachments,
    pathOverrides,
    pathOverridesByAttachmentId,
  );
  const localToolContext = [
    mixedPlainText?.combinedContext || "",
    buildLocalAttachmentToolContext(routePlan),
    docContextRefId ? `contextRefId=${docContextRefId}` : "",
  ].filter(Boolean).join("\n\n");
  options.onProgress?.("正在准备附件…");
  const prepareStartedAt = attachmentTimingNow();
  const files = await collectDraftAttachmentInputsForPlan(draft, modelSupportsVision, routePlan);
  const prepareMs = roundAttachmentTiming(attachmentTimingNow() - prepareStartedAt);
  if (!files.length) {
    logAttachmentTiming({
      phase: "batch",
      timingId,
      mode: "local-or-deferred",
      fileCount: draft.attachments.length,
      preparedFileCount: 0,
      prepareMs,
      totalMs: roundAttachmentTiming(attachmentTimingNow() - startedAt),
      cacheHit: false,
    });
    options.onProgress?.("附件已解析，正在整理回答…");
    return {
      combinedContext: localToolContext,
      results: [
        ...(mixedPlainText?.results || []),
        ...routePlanResults(routePlan),
      ],
      uploadedUrls: [],
      sources: [
        ...(mixedPlainText?.sources || []),
        ...routePlanSources(routePlan),
      ],
      contextRefId: docContextRefId,
    };
  }

  options.onProgress?.(`正在解析 ${files.length} 个附件…`);

  const baseUserPrompt = (draft.resolvedText ?? draft.text).trim();
  const userPrompt = draftHasProductAssetMention(draft)
    ? [baseUserPrompt, PRODUCT_IDENTITY_ANALYSIS_INSTRUCTION].filter(Boolean).join("\n\n")
    : baseUserPrompt;
  const requestStartedAt = attachmentTimingNow();
  let payload: Awaited<ReturnType<typeof requestWodeAppAttachmentIntelligence>>;
  try {
    payload = await requestWodeAppAttachmentIntelligence({
      files: files.map(({ sourceLabel: _sourceLabel, ...file }) => file),
      userPrompt: userPrompt || undefined,
      timingId,
    });
  } catch (error) {
    logAttachmentTiming({
      phase: "batch",
      timingId,
      mode: "remote",
      fileCount: draft.attachments.length,
      preparedFileCount: files.length,
      prepareMs,
      requestMs: roundAttachmentTiming(attachmentTimingNow() - requestStartedAt),
      totalMs: roundAttachmentTiming(attachmentTimingNow() - startedAt),
      cacheHit: false,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    if (isRequestEntityTooLarge(error)) {
      if (localToolContext) {
        return {
          combinedContext: [
            localToolContext,
            "远程附件复核因网关大小限制未完成；请继续调用上面列出的本地工具。",
          ].filter(Boolean).join("\n\n"),
          results: routePlanResults(routePlan),
          uploadedUrls: [],
          sources: routePlanSources(routePlan),
        };
      }
      const avFallback = routePlan.uploadAttachments.some((attachment) =>
        isVideoMime(attachment.mimeType, attachment.name)
        || isAudioMime(attachment.mimeType, attachment.name),
      );
      if (avFallback) {
        return {
          combinedContext: "视频/音频因网关大小限制未上传。请用本机路径调用 openwork_file_media_probe / openwork_media_view。",
          results: routePlanResults(routePlan),
          uploadedUrls: [],
          sources: routePlanSources(routePlan),
        };
      }
      throw new Error("附件太大，已超过网关接收上限。请压缩或拆分 PDF，或减少一次发送的图片数量后重试。");
    }
    const fallback = await understandPlainTextAttachmentsLocally(draft);
    if (fallback?.combinedContext) {
      options.onProgress?.("附件已解析，正在整理回答…");
      return fallback;
    }
    if (localToolContext) {
      options.onProgress?.("附件已解析，正在整理回答…");
      return {
        combinedContext: [
          localToolContext,
          "远程附件复核暂时不可用；请继续调用上面列出的本地工具。",
        ].filter(Boolean).join("\n\n"),
        results: routePlanResults(routePlan),
        uploadedUrls: [],
        sources: routePlanSources(routePlan),
      };
    }
    throw error;
  }
  logAttachmentTiming({
    phase: "batch",
    timingId,
    mode: "remote",
    fileCount: draft.attachments.length,
    preparedFileCount: files.length,
    prepareMs,
    requestMs: roundAttachmentTiming(attachmentTimingNow() - requestStartedAt),
    totalMs: roundAttachmentTiming(attachmentTimingNow() - startedAt),
    cacheHit: payload.data?.cacheHit === true,
    success: payload.success !== false,
  });
  const results = payload.data?.results ?? [];
  const uploadedUrls = results
    .filter((item) => item.url && item.kind !== "document-page")
    .map((item) => ({ filename: item.filename, url: item.url!, kind: item.kind }));

  options.onProgress?.("附件已解析，正在整理回答…");
  return {
    combinedContext: [
      localToolContext,
      payload.data?.combinedContext?.trim() ?? "",
    ].filter(Boolean).join("\n\n"),
    results: [
      ...(mixedPlainText?.results || []),
      ...routePlanResults(routePlan),
      ...results,
    ],
    uploadedUrls,
    sources: [
      ...(mixedPlainText?.sources || []),
      ...routePlanSources(routePlan),
      ...files.map((file) => ({ label: file.sourceLabel, filename: file.filename })),
    ],
    contextPackId: payload.data?.contextPackId,
    contextRefId: docContextRefId,
    cacheHit: payload.data?.cacheHit,
    billing: payload.data?.billing,
  };
}

export function buildAttachmentIntelligencePart(
  combinedContext: string,
  sources: AttachmentIntelligenceSource[],
  uploadedUrls: Array<{ filename: string; url: string; kind?: string }> = [],
  options: {
    contextPackId?: string;
    contextRefId?: string;
    imageCandidates?: AttachmentPromptImageCandidate[];
  } = {},
): TextPartInput {
  const filenames = sources
    .map((source, index) => `${index + 1}. [${source.label}] ${source.filename}`)
    .join("\n");
  const contextPackIdEarly = typeof options.contextPackId === "string"
    ? options.contextPackId.trim()
    : "";
  const contextRefIdEarly = typeof options.contextRefId === "string"
    ? options.contextRefId.trim()
    : "";
  const safeContextRefIdEarly = isValidLocalContextRefId(contextRefIdEarly) ? contextRefIdEarly : "";
  const requiresLocalFileTool = combinedContext.includes("以下附件保留在本机");
  const remoteParseFailed = /解析失败/.test(combinedContext);
  const hasPdfSource = sources.some((source) => /\.pdf$/i.test(source.filename))
    || combinedContext.includes("openwork_pdf_info")
    || /\.pdf\b/i.test(combinedContext);
  const hasRereadHandle = Boolean(safeContextRefIdEarly)
    || combinedContext.includes("可重读本地路径")
    || requiresLocalFileTool
    || /path:\s+\//.test(combinedContext);
  const requiresPdfTools = (requiresLocalFileTool || remoteParseFailed)
    && hasPdfSource
    && hasRereadHandle;
  const attachmentAccessInstruction = requiresPdfTools
    ? "PDF 尚未读取或远程解析失败。PDF 工具已直接可用；请显式调用 openwork_pdf_info 与 openwork_pdf_extract_text，需要视觉复核时再调用 openwork_pdf_render_pages。不要调用 skill 加载器。页面渲染结果只用于视觉分析，不得写入 productImages。本地工具不够时可按精确 path 用脚本补读；禁止扫描无关目录。"
    : requiresLocalFileTool
    ? "摘要明确标记为本机大附件时，才可按摘要给出的精确路径调用本地文件工具；不要搜索其他目录。"
    : remoteParseFailed && hasRereadHandle
    ? "部分附件远程解析失败。请按 contextRefId / 可重读本地路径调用 openwork_attachment_context_read 或对应本地文件/PDF 工具补读；不够时可用脚本按精确 path 提取。禁止假装已读失败附件。"
    : remoteParseFailed
    ? "部分附件远程解析失败且没有可重读本地句柄。请明确告知用户解析失败，并请用户重新上传或提供本机绝对路径；禁止编造附件正文。"
    : [
        "本轮附件已由 WodeApp 附件理解服务处理，下面的解析结果就是本轮默认依据。",
        "不要再调用 openwork_file_search、openwork_file_extract_text 或其他本地文件工具，不要扫描工作区、桌面或外部目录，也不要要求用户重复上传。",
      ].join("\n");
  const imageCandidates = options.imageCandidates || [];
  const candidateImagesBlock = imageCandidates.length === 0
    ? ""
    : [
        `candidateImages=${JSON.stringify(imageCandidates.map(serializeCandidateImageForPrompt))}`,
        CHAT_IMAGE_PATH_GUARD,
        imageCandidates.length > 12
          ? "超过 12 张：只问用户一次，再按意图传 selectedImageIds（商品库 product_save / 图片库 image_asset_save）；禁止自动补图。"
          : "会话图可用 selectedImageIds：存商品用 wodeapp_product_save，进图片库用 wodeapp_image_asset_save。按用户意图选货架。",
      ].join("\n");
  const exactProductImageUrls = [...new Set(uploadedUrls
    .filter((item) => item.kind === "image" || (!item.kind && IMAGE_FILE_PATTERN.test(item.filename)))
    .map((item) => item.url.trim())
    .filter(Boolean))];
  const exactProductImageBlock = exactProductImageUrls.length === 0
    ? ""
    : [
        `candidateHttpsImages=${JSON.stringify(exactProductImageUrls.slice(0, 40))}`,
        imageCandidates.length
          ? ""
          : exactProductImageUrls.length > 12
            ? "超过 12 张：只问一次；再用 candidateImages + selectedImageIds 按意图保存。"
            : "若本轮已有 candidateImages，按用户意图用 selectedImageIds 保存到商品库或图片库。",
      ].filter(Boolean).join("\n");
  const contextPackId = contextPackIdEarly;
  const safeContextRefId = safeContextRefIdEarly;
  return {
    type: "text",
    // OpenCode 的 `ignored` part 会从下一轮模型 prompt 中剔除；`synthetic`
    // 仍会送入模型，同时由聊天同步层隐藏，适合承载这段内部附件上下文。
    // 空闲后会压成短 stub（见 buildAttachmentIntelligenceHistoryStub），首轮仍给全文。
    synthetic: true,
    text: [
      WODEAPP_ATTACHMENT_INTELLIGENCE_PREFIX,
      filenames ? `附件来源：\n${filenames}` : "",
      attachmentAccessInstruction,
      candidateImagesBlock,
      exactProductImageBlock,
      contextPackId ? `attachmentFingerprint=${contextPackId}` : "",
      safeContextRefId ? `contextRefId=${safeContextRefId}` : "",
      `附件理解结果：\n${combinedContext}`,
    ].filter(Boolean).join("\n\n"),
  } as TextPartInput;
}

export const WODEAPP_ATTACHMENT_PLACEHOLDER_URL = "data:text/plain;base64,IA==";
const WODEAPP_ATTACHMENT_PLACEHOLDER_METADATA_KEY = "wodeappAttachmentPlaceholder";

export type WodeAppAttachmentDisplayPlaceholder = {
  filename: string;
  mime: string;
  url?: string;
  kind?: string;
};

const WODEAPP_ATTACHMENT_TEXT_PLACEHOLDER_PATTERN = /^\[WodeApp attachment: (.+)\](?:\n|$)/;
const WODEAPP_ATTACHMENT_REFERENCE_PATTERN = /^\[WodeApp attachment reference: (.+)\]$/m;

function inferAttachmentPlaceholderMime(filename: string): string {
  const extension = filename.split(".").pop()?.trim().toLowerCase() ?? "";
  const mimeByExtension: Record<string, string> = {
    bmp: "image/bmp",
    csv: "text/csv",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    gif: "image/gif",
    jpeg: "image/jpeg",
    jpg: "image/jpeg",
    md: "text/markdown",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    pdf: "application/pdf",
    png: "image/png",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    svg: "image/svg+xml",
    txt: "text/plain",
    wav: "audio/wav",
    webm: "video/webm",
    webp: "image/webp",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    zip: "application/zip",
  };
  return mimeByExtension[extension] ?? "application/octet-stream";
}

export function attachmentDisplayPlaceholderFromTextPart(
  part: unknown,
): WodeAppAttachmentDisplayPlaceholder | null {
  if (!part || typeof part !== "object") return null;
  const record = part as {
    type?: unknown;
    text?: unknown;
    ignored?: unknown;
    synthetic?: unknown;
    metadata?: unknown;
  };
  if (record.type !== "text" || (record.ignored !== true && record.synthetic !== true)) return null;

  if (record.metadata && typeof record.metadata === "object") {
    const raw = (record.metadata as Record<string, unknown>)[WODEAPP_ATTACHMENT_PLACEHOLDER_METADATA_KEY];
    if (raw && typeof raw === "object") {
      const filename = (raw as Record<string, unknown>).filename;
      const mime = (raw as Record<string, unknown>).mime;
      const url = (raw as Record<string, unknown>).url;
      const kind = (raw as Record<string, unknown>).kind;
      if (typeof filename === "string" && filename.trim()) {
        return {
          filename: filename.trim(),
          mime: typeof mime === "string" && mime.trim() ? mime.trim() : inferAttachmentPlaceholderMime(filename),
          ...(typeof url === "string" && url.trim() ? { url: url.trim() } : {}),
          ...(typeof kind === "string" && kind.trim() ? { kind: kind.trim() } : {}),
        };
      }
    }
  }

  // Some sidecars discard custom metadata while persisting text parts. Recover
  // the attachment card from the stable text payload so sent files do not
  // vanish as soon as the optimistic user message is replaced by the snapshot.
  const textMatch = typeof record.text === "string"
    ? record.text.match(WODEAPP_ATTACHMENT_TEXT_PLACEHOLDER_PATTERN)
    : null;
  const filename = textMatch?.[1]?.trim();
  if (!filename) return null;
  const referenceMatch = typeof record.text === "string"
    ? record.text.match(WODEAPP_ATTACHMENT_REFERENCE_PATTERN)
    : null;
  let reference: { url?: string; kind?: string } = {};
  if (referenceMatch?.[1]) {
    try {
      const parsed = JSON.parse(referenceMatch[1]) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const value = parsed as Record<string, unknown>;
        reference = {
          url: typeof value.url === "string" && value.url.trim() ? value.url.trim() : undefined,
          kind: typeof value.kind === "string" && value.kind.trim() ? value.kind.trim() : undefined,
        };
      }
    } catch {
      // Older history rows contain only the display placeholder. Keep them readable.
    }
  }
  return { filename, mime: inferAttachmentPlaceholderMime(filename), ...reference };
}

/**
 * 持久化为 synthetic text part，并由同步层恢复成文件卡片。
 * `ignored` parts 会在部分 OpenCode 版本中于 prompt 入库前被直接删除，
 * 导致发送完成后附件卡片消失；synthetic 会保留在历史里，正文仍由 UI 隐藏。
 */
export function buildAttachmentDisplayParts(
  attachments: ComposerAttachment[],
  uploadedUrls: Array<{ filename: string; url: string; kind?: string }> = [],
): TextPartInput[] {
  const referencesByFilename = new Map<string, Array<{ url: string; kind?: string }>>();
  for (const item of uploadedUrls) {
    const filename = item.filename.trim();
    const url = item.url.trim();
    if (!filename || !url) continue;
    const references = referencesByFilename.get(filename) || [];
    references.push({ url, kind: item.kind });
    referencesByFilename.set(filename, references);
  }
  return attachments.map((attachment) => {
    const reference = referencesByFilename.get(attachment.name)?.shift();
    const localPath = desktopLocalFilePath(attachment.file);
    const localUrl = localPath
      ? `file://${localPath.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`
      : undefined;
    const displayUrl = reference?.url || localUrl;
    // Always persist an openable URL in the synthetic text payload (Cursor/Codex:
    // chips reopen the real file). Sidecars sometimes drop custom metadata.
    const referencePayload = reference?.url
      ? { url: reference.url, ...(reference.kind ? { kind: reference.kind } : {}) }
      : displayUrl
        ? { url: displayUrl }
        : null;
    const referenceText = referencePayload
      ? `\n[WodeApp attachment reference: ${JSON.stringify(referencePayload)}]`
      : "";
    return {
      type: "text",
      text: `[WodeApp attachment: ${attachment.name}]${referenceText}`,
      synthetic: true,
      metadata: {
        [WODEAPP_ATTACHMENT_PLACEHOLDER_METADATA_KEY]: {
          filename: attachment.name,
          mime: attachment.mimeType || attachment.file.type || "application/octet-stream",
          ...(displayUrl ? { url: displayUrl } : {}),
          ...(reference?.kind ? { kind: reference.kind } : {}),
        },
      },
    };
  });
}

/** @deprecated Use understandDraftAttachments */
export async function understandComposerAttachments(draft: ComposerDraft): Promise<AttachmentIntelligenceResult> {
  return understandDraftAttachments(draft, false);
}
