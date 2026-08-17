import type { ComposerAttachment } from "@/app/types";
import { isDesktopRuntime } from "@/app/lib/runtime-env";
import { requestWodeAppRuntimeJson } from "@/app/lib/wodeapp-auth";

import {
  type DigitalAssetFileRef,
  type DigitalAssetItem,
} from "./digital-assets-data";
import { readDesktopLocalFileAsDataUrl } from "./desktop-local-file";
import {
  type DigitalAssetIntegrityStatus,
} from "./wodeapp-digital-asset-contract";

type ChatAttachmentAssetKind = "image" | "video" | "file";

type ChatAttachmentContentInspection = {
  kind: ChatAttachmentAssetKind;
  contentHash: string;
  integrityStatus: DigitalAssetIntegrityStatus;
  validationError?: string;
};

type InspectedChatAttachment = ChatAttachmentContentInspection & {
  attachment: ComposerAttachment;
  dataUrl?: string;
};

function bytesStartWith(bytes: Uint8Array, expected: number[], offset = 0): boolean {
  return expected.every((value, index) => bytes[offset + index] === value);
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function declaredAttachmentKind(name: string, mimeType: string): ChatAttachmentAssetKind {
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/") || /\.(?:png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(name)) return "image";
  if (mime.startsWith("video/") || /\.(?:mp4|mov|m4v|webm|mkv)$/i.test(name)) return "video";
  return "file";
}

function hasRecognizedImageSignature(bytes: Uint8Array, name: string, mimeType: string): boolean | null {
  if (bytesStartWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return true;
  if (bytesStartWith(bytes, [0xff, 0xd8, 0xff])) return true;
  if (asciiAt(bytes, 0, 6) === "GIF87a" || asciiAt(bytes, 0, 6) === "GIF89a") return true;
  if (asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "WEBP") return true;
  if (bytesStartWith(bytes, [0x42, 0x4d])) return true;
  if (asciiAt(bytes, 4, 4) === "ftyp" && /(?:avif|avis)/i.test(asciiAt(bytes, 8, 12))) return true;
  const declared = `${name} ${mimeType}`.toLowerCase();
  if (/\.svg\b|image\/svg\+xml/.test(declared)) {
    const prefix = asciiAt(bytes, 0, Math.min(bytes.length, 512)).replace(/^\uFEFF/, "").trimStart();
    return prefix.startsWith("<svg") || prefix.startsWith("<?xml") ? true : false;
  }
  if (/\.(?:png|jpe?g|gif|webp|bmp|avif)$/i.test(name)
    || /^image\/(?:png|jpeg|gif|webp|bmp|avif)$/i.test(mimeType)) return false;
  return null;
}

function hasRecognizedVideoSignature(bytes: Uint8Array, name: string, mimeType: string): boolean | null {
  if (asciiAt(bytes, 4, 4) === "ftyp") return true;
  if (bytesStartWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return true;
  if (asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "AVI ") return true;
  if (/\.(?:mp4|mov|m4v|webm|mkv)$/i.test(name) || /^video\//i.test(mimeType)) return false;
  return null;
}

function pdfSignatureStatus(bytes: Uint8Array, name: string, mimeType: string): boolean | null {
  if (asciiAt(bytes, 0, 5) === "%PDF-") return true;
  if (/\.pdf$/i.test(name) || /^application\/pdf$/i.test(mimeType)) return false;
  return null;
}

async function sha256ContentHash(bytes: Uint8Array): Promise<string> {
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", digestInput.buffer);
  const hex = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `sha256:${hex}`;
}

export async function inspectChatAttachmentContent(input: {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}): Promise<ChatAttachmentContentInspection> {
  const kind = declaredAttachmentKind(input.name, input.mimeType);
  const contentHash = await sha256ContentHash(input.bytes);
  if (!input.bytes.length) {
    return { kind, contentHash, integrityStatus: "invalid", validationError: "文件为空" };
  }

  const signature = kind === "image"
    ? hasRecognizedImageSignature(input.bytes, input.name, input.mimeType)
    : kind === "video"
      ? hasRecognizedVideoSignature(input.bytes, input.name, input.mimeType)
      : pdfSignatureStatus(input.bytes, input.name, input.mimeType);
  if (signature === true) return { kind, contentHash, integrityStatus: "verified" };
  if (signature === false) {
    return {
      kind,
      contentHash,
      integrityStatus: "invalid",
      validationError: "文件内容与扩展名或媒体类型不匹配",
    };
  }
  return { kind, contentHash, integrityStatus: "unverified" };
}

async function composerAttachmentToDataUrl(attachment: ComposerAttachment): Promise<string> {
  const desktopDataUrl = await readDesktopLocalFileAsDataUrl(attachment.file, attachment.mimeType);
  if (desktopDataUrl) return desktopDataUrl;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const timeout = window.setTimeout(() => {
      reader.abort();
      reject(new Error(`读取附件超时：${attachment.name}`));
    }, 30000);
    reader.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error(`Failed to read chat attachment: ${attachment.name}`));
    };
    reader.onload = () => {
      window.clearTimeout(timeout);
      resolve(typeof reader.result === "string" ? reader.result : "");
    };
    reader.onabort = () => window.clearTimeout(timeout);
    reader.readAsDataURL(new Blob([attachment.file], { type: attachment.mimeType }));
  });
}

export async function readComposerAttachmentDataUrl(attachment: ComposerAttachment): Promise<string> {
  return composerAttachmentToDataUrl(attachment);
}

function dataUrlBytes(dataUrl: string): Uint8Array | null {
  const match = dataUrl.match(/^data:[^,]*?(;base64)?,([\s\S]*)$/i);
  if (!match) return null;
  try {
    const raw = match[1]
      ? globalThis.atob(match[2] || "")
      : decodeURIComponent(match[2] || "");
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

async function readAttachmentBytes(attachment: ComposerAttachment): Promise<{ bytes: Uint8Array; dataUrl?: string }> {
  try {
    const buffer = await Promise.race([
      attachment.file.arrayBuffer(),
      new Promise<null>((resolve) => globalThis.setTimeout(() => resolve(null), 15_000)),
    ]);
    if (buffer && buffer.byteLength > 0) return { bytes: new Uint8Array(buffer) };
  } catch {
    // The Electron File wrapper can fail to expose bytes directly. Use the preload bridge below.
  }

  const dataUrl = await composerAttachmentToDataUrl(attachment);
  const bytes = dataUrlBytes(dataUrl);
  if (!bytes) throw new Error(`无法读取附件内容：${attachment.name}`);
  return { bytes, dataUrl };
}

async function inspectChatAttachment(attachment: ComposerAttachment): Promise<InspectedChatAttachment> {
  const read = await readAttachmentBytes(attachment);
  return {
    attachment,
    dataUrl: read.dataUrl,
    ...(await inspectChatAttachmentContent({
      name: attachment.name,
      mimeType: attachment.mimeType || attachment.file.type || "application/octet-stream",
      bytes: read.bytes,
    })),
  };
}

async function uploadChatAttachmentDataUrl(attachment: ComposerAttachment, dataUrl: string): Promise<string> {
  try {
    const payload = await requestWodeAppRuntimeJson<{
      success?: boolean;
      data?: { url?: string };
    }>("/upload/file", {
      method: "POST",
      body: JSON.stringify({
        data: dataUrl,
        filename: attachment.name || "chat-attachment",
      }),
    }, 120000);
    return payload.data?.url?.trim() || dataUrl;
  } catch (error) {
    console.warn("[WodeAppX] Failed to upload chat attachment asset", error);
    return dataUrl;
  }
}

export async function resolveChatAttachmentUrlForStorage(
  attachment: ComposerAttachment,
  knownDataUrl?: string,
): Promise<string> {
  if (isDesktopRuntime()) {
    // Keep the selected File as the trust boundary. The desktop bridge reads
    // that File so a later explicit asset tool can persist the resulting data
    // URL into the account-scoped wodeappx-asset store. Persisting a raw file:// path
    // leaves a non-portable reference that remote attachment intelligence must
    // reject and also grants a compromised renderer a path-based read primitive.
    return knownDataUrl || await composerAttachmentToDataUrl(attachment);
  }
  const dataUrl = knownDataUrl || await composerAttachmentToDataUrl(attachment);
  if (!dataUrl) return "";
  return uploadChatAttachmentDataUrl(attachment, dataUrl);
}

export function extractChatAttachmentAssetName(text: string | undefined): string | null {
  const value = (text || "").trim();
  if (!value) return null;
  const named = value.match(
    /(?:名称(?:记为|填写为|是)?|名字(?:叫|是)?|命名为|叫)\s*[：:]?\s*[`'"“”‘’]*\[([^\]\r\n]{1,80})\]/i,
  )?.[1]?.trim();
  if (named) return named;
  const bracketed = value.match(/\[([^\]\r\n]{1,80})\]/)?.[1]?.trim();
  if (bracketed) return bracketed;
  const naturalName = value.match(
    /(?:名字(?:就)?叫|名称(?:就)?(?:叫|是|为)|命名为|叫做|叫)\s*[：:]?\s*[`'"“”‘’]*([^，。；;,.\r\n]{1,80})/i,
  )?.[1]?.trim();
  if (naturalName) return naturalName.replace(/[`'"“”‘’\[\]]+$/g, "").trim() || null;
  const introducedProduct = value.match(
    /这是\s*([^，。；;,.\r\n]{1,48}?)(?:的(?:全部|所有)?(?:素材|图片|视频|开盖(?:演示|视频)?|产品(?:资料|素材)?|资料)|[，,。])/i,
  )?.[1]?.trim();
  return introducedProduct?.replace(/[`'"“”‘’\[\]]+$/g, "").trim() || null;
}

function draftExplicitlyRejectsDigitalAssetSave(value: string): boolean {
  return /(?:不要|无需|不需要|不必|别|禁止|先不|暂不)\s*(?:自动|再|先)?\s*(?:保存|存入|放进|放到|加入|收进|收录|入库|沉淀|归档|留存|收藏|导入)/.test(value);
}

export function draftRequestsProductLibrarySave(text: string | undefined): boolean {
  const value = (text || "").trim();
  if (!value) return false;
  if (draftExplicitlyRejectsDigitalAssetSave(value)) return false;
  return /(?:放|存|收|留|保留|加入|整理|建|建立|创建|沉淀|录入|导入).{0,10}(?:商品库|产品库)|(?:商品库|产品库).{0,10}(?:放|存|收|留|保留|加入|整理|建|建立|创建|沉淀|录入|导入)/.test(value);
}

/**
 * Attachments are temporary conversation inputs by default. Persist them only
 * when the user explicitly asks to save them as a reusable asset.
 */
export function draftRequestsDigitalAssetSave(text: string | undefined): boolean {
  const value = (text || "").trim();
  if (!value) return false;
  if (draftExplicitlyRejectsDigitalAssetSave(value)) return false;
  if (draftRequestsProductLibrarySave(value)) return true;
  const saveVerb = "(?:保存|存入|放进|放到|加入|收进|收录|入库|沉淀|归档|留存|收藏|建|建立|创建|导入)";
  const assetTarget = "(?:数字资产|素材库|图片库|视频库|文件库|品牌库|提示词库|角色库)";
  return new RegExp(`${saveVerb}.{0,12}${assetTarget}|${assetTarget}.{0,12}${saveVerb}`).test(value)
    || /作为.{0,8}(?:数字资产|素材库)(?:保存|留存|使用)/.test(value);
}

export function draftRequestsAdditionalAttachmentWork(text: string | undefined): boolean {
  const value = (text || "").trim();
  if (!value) return false;
  const immediateRequest = value.replace(
    /(?:后面|以后|之后).{0,20}(?:做|生成|制作).{0,10}(?:视频|图片|素材).{0,20}(?:用|引用|使用).{0,10}(?:这些|它们|素材)/g,
    "",
  );
  return /(?:看(?:看)?|分析|解析|识别|提取|总结|说明|告诉|判断|检查|对比|比较|标注|截图|抽帧|生成|制作|画|做|写).{0,30}(?:视频|图片|素材|内容|动作|步骤|方向|部件|四宫格|分镜|脚本|说明|操作图)/.test(immediateRequest);
}

export function draftRequestsOnlyProductLibrarySave(text: string | undefined): boolean {
  return draftRequestsProductLibrarySave(text) && !draftRequestsAdditionalAttachmentWork(text);
}

function stableAttachmentGroupId(attachments: Array<{ attachment: ComposerAttachment; contentHash?: string }>): string {
  const seed = attachments.map((item) => item.contentHash || item.attachment.id).sort().join("|");
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function defaultAssetName(kind: ChatAttachmentAssetKind, attachments: ComposerAttachment[]): string {
  const firstName = attachments[0]?.name?.trim();
  if (kind === "image") {
    return attachments.length > 1 ? `对话图片组 · ${attachments.length} 张` : `对话图片 · ${firstName || "未命名图片"}`;
  }
  if (kind === "video") return `对话视频 · ${firstName || "未命名视频"}`;
  return `对话文件 · ${firstName || "未命名文件"}`;
}

function defaultProductName(attachments: ComposerAttachment[]): string {
  const firstName = attachments[0]?.name?.trim().replace(/\.[a-z0-9]{1,8}$/i, "");
  return `对话商品 · ${firstName || "上传素材"}`.slice(0, 80);
}

function combinedIntegrityStatus(entries: Array<{ integrityStatus: DigitalAssetIntegrityStatus }>): DigitalAssetIntegrityStatus {
  if (entries.some((entry) => entry.integrityStatus === "invalid")) return "invalid";
  if (entries.some((entry) => entry.integrityStatus === "unverified")) return "unverified";
  return "verified";
}

function groupAssetName(input: {
  explicitName: string | null;
  kind: ChatAttachmentAssetKind;
  attachments: ComposerAttachment[];
  groupCount: number;
}): string {
  if (!input.explicitName) return defaultAssetName(input.kind, input.attachments);
  if (input.groupCount === 1) return input.explicitName;
  if (input.kind === "image") return `${input.explicitName} · 图片`;
  return `${input.explicitName} · ${input.attachments[0]?.name || (input.kind === "video" ? "视频" : "文件")}`;
}

function attachmentPromptText(description: string, attachments: ComposerAttachment[]): string {
  const filenames = attachments.map((attachment) => attachment.name).filter(Boolean);
  return [
    description.trim(),
    filenames.length ? `对话附件：${filenames.join("、")}` : "",
  ].filter(Boolean).join("\n\n");
}

function countLabel(count: number, unit: string): string {
  return count > 0 ? `${count} ${unit}` : "";
}

function buildChatProductAsset(input: {
  entries: Array<InspectedChatAttachment & { url: string }>;
  explicitName: string | null;
}): DigitalAssetItem {
  const entries = input.entries;
  const attachments = entries.map((entry) => entry.attachment);
  const images = entries
    .filter((entry) => entry.kind === "image")
    .filter((entry, index, values) => values.findIndex((candidate) => candidate.url === entry.url) === index);
  const videos = entries.filter((entry) => entry.kind === "video");
  const documents = entries.filter((entry) => entry.kind === "file");
  const supportingFiles: DigitalAssetFileRef[] = [...videos, ...documents]
    .filter((entry, index, values) => values.findIndex((candidate) => candidate.url === entry.url) === index)
    .map(({ attachment, url, kind, contentHash, integrityStatus, validationError }) => ({
      url,
      name: attachment.name,
      type: attachment.mimeType || attachment.file.type || "application/octet-stream",
      size: attachment.size,
      mediaType: kind === "video" ? "video" : /^application\/pdf$/i.test(attachment.mimeType) || /\.pdf$/i.test(attachment.name) ? "document" : "other",
      contentHash,
      integrityStatus,
      processingStatus: "ready",
      validationError,
    }));
  const primaryFile = supportingFiles[0];
  const name = input.explicitName || defaultProductName(attachments);
  const videoCount = supportingFiles.filter((file) => file.mediaType === "video").length;
  const documentCount = supportingFiles.length - videoCount;
  const meta = [
    countLabel(images.length, "张图片"),
    countLabel(videoCount, "个视频"),
    countLabel(documentCount, "份文件"),
    "商品库",
  ].filter(Boolean).join(" · ");

  return {
    id: `local-chat-product-${stableAttachmentGroupId(entries)}`,
    name,
    kind: "商品库",
    meta,
    preview: "product",
    // The chat request describes what to do now, not durable product facts.
    // Keep it out of promptText/productInfo so future @ mentions cannot replay
    // historical instructions such as "make a grid" or "generate images".
    coverImage: images[0]?.url,
    productImages: images.length ? images.map((entry) => entry.url) : undefined,
    assetFile: primaryFile?.url,
    assetFileName: primaryFile?.name,
    assetFileType: primaryFile?.type,
    assetFileSize: primaryFile?.size,
    assetFiles: supportingFiles.length ? supportingFiles : undefined,
    contentHashes: [...new Set(entries.map((entry) => entry.contentHash))],
    integrityStatus: combinedIntegrityStatus(entries),
    processingStatus: "ready",
    assetTime: "刚刚",
    assetUse: "对话上传",
  };
}

function mergeAssetFiles(
  current: DigitalAssetFileRef[] | undefined,
  incoming: DigitalAssetFileRef[] | undefined,
): DigitalAssetFileRef[] | undefined {
  const merged: DigitalAssetFileRef[] = [];
  const seen = new Set<string>();
  for (const file of [...(incoming || []), ...(current || [])]) {
    const key = file.contentHash?.trim() || file.url.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(file);
  }
  return merged.length ? merged : undefined;
}

/**
 * Adding chat attachments to an existing product must not replace product
 * research already written by wodeapp.product.save. Older builds replaced the
 * whole record and could turn an instruction such as "商品库里留一个" into the
 * product description used by later generations.
 */
export function mergeExistingProductWithChatAsset(
  existing: DigitalAssetItem,
  incoming: DigitalAssetItem,
): DigitalAssetItem {
  const existingInfoIsHistoricalRequest = Boolean(
    existing.productInfo && existing.promptText?.includes(existing.productInfo),
  );
  const productImages = [...new Set([
    ...(incoming.productImages || []),
    ...(existing.productImages || []),
  ].filter(Boolean))];
  const assetFiles = mergeAssetFiles(existing.assetFiles, incoming.assetFiles);
  const primaryFile = assetFiles?.[0];
  const videoCount = (assetFiles || []).filter((file) =>
    file.mediaType === "video" || file.type.startsWith("video/"),
  ).length;
  const documentCount = (assetFiles?.length || 0) - videoCount;
  const meta = [
    productImages.length ? `${productImages.length} 张图片` : "",
    videoCount ? `${videoCount} 个视频` : "",
    documentCount ? `${documentCount} 份文件` : "",
    "商品库",
  ].filter(Boolean).join(" · ");

  return {
    ...incoming,
    id: existing.id,
    meta,
    promptText: undefined,
    productInfo: existingInfoIsHistoricalRequest ? undefined : existing.productInfo,
    productProfile: existing.productProfile,
    promptTags: existing.promptTags,
    coverImage: incoming.coverImage || existing.coverImage || productImages[0],
    productImages: productImages.length ? productImages : undefined,
    assetFile: primaryFile?.url || incoming.assetFile || existing.assetFile,
    assetFileName: primaryFile?.name || incoming.assetFileName || existing.assetFileName,
    assetFileType: primaryFile?.type || incoming.assetFileType || existing.assetFileType,
    assetFileSize: primaryFile?.size || incoming.assetFileSize || existing.assetFileSize,
    assetFiles,
    contentHashes: [...new Set([
      ...(incoming.contentHashes || []),
      ...(existing.contentHashes || []),
      ...(assetFiles || []).map((file) => file.contentHash || ""),
    ].filter(Boolean))],
  };
}

function buildChatAttachmentAsset(input: {
  entries: Array<InspectedChatAttachment & { url: string }>;
  description: string;
  explicitName: string | null;
  groupCount: number;
}): DigitalAssetItem {
  const attachments = input.entries.map((entry) => entry.attachment);
  const first = attachments[0];
  const kind = input.entries[0].kind;
  const name = groupAssetName({
    explicitName: input.explicitName,
    kind,
    attachments,
    groupCount: input.groupCount,
  });
  const totalSize = attachments.reduce((sum, attachment) => sum + attachment.size, 0);
  const common = {
    id: `local-chat-${kind}-${stableAttachmentGroupId(input.entries)}`,
    name,
    promptText: attachmentPromptText(input.description, attachments),
    assetFileName: attachments.length === 1 ? first.name : undefined,
    assetFileType: attachments.length === 1 ? first.mimeType : undefined,
    assetFileSize: totalSize,
    contentHashes: input.entries.map((entry) => entry.contentHash),
    integrityStatus: combinedIntegrityStatus(input.entries),
    processingStatus: "ready" as const,
    assetTime: "刚刚",
    assetUse: "对话上传",
  };

  if (kind === "image") {
    return {
      ...common,
      kind: "图片",
      meta: `对话上传 · ${input.entries.length} 张图片`,
      preview: "image",
      coverImage: input.entries[0].url,
      assetImages: input.entries.map((entry) => entry.url),
    };
  }
  if (kind === "video") {
    return {
      ...common,
      kind: "视频",
      meta: "对话上传 · 视频素材",
      preview: "video",
      assetFile: input.entries[0].url,
      assetFiles: input.entries.map((entry) => ({
        url: entry.url,
        name: entry.attachment.name,
        type: entry.attachment.mimeType || "video/*",
        size: entry.attachment.size,
        mediaType: "video",
        contentHash: entry.contentHash,
        integrityStatus: entry.integrityStatus,
        processingStatus: "ready",
      })),
    };
  }
  return {
    ...common,
    kind: "文件",
    meta: "对话上传 · 文件素材",
    preview: "file",
    assetFile: input.entries[0].url,
    assetFiles: input.entries.map((entry) => ({
      url: entry.url,
      name: entry.attachment.name,
      type: entry.attachment.mimeType || "application/octet-stream",
      size: entry.attachment.size,
      mediaType: /^application\/pdf$/i.test(entry.attachment.mimeType) || /\.pdf$/i.test(entry.attachment.name) ? "document" : "other",
      contentHash: entry.contentHash,
      integrityStatus: entry.integrityStatus,
      processingStatus: "ready",
    })),
  };
}
