import type { FilePartInput } from "@opencode-ai/sdk/v2/client";

import type { ComposerDraft } from "@/app/types";
import { attachmentToModelFileData } from "@/react-app/domains/session/sync/attachment-data-url";
import {
  isLikelyImageAssetUrl,
  isWodeAppLocalAssetUrl,
  readWodeAppLocalAssetAsDataUrl,
} from "@/react-app/domains/wodeapp/wodeapp-local-asset";

/** Align with product-library save cap: send up to 12 reference images to the vision model. */
const ASSET_MENTION_FILE_PART_LIMIT = 12;
const WEBP_DATA_URL_RE = /^data:image\/(?:x-)?webp;base64,/i;

function mimeFromDataUrl(url: string, fallback = "image/*") {
  const dataMatch = url.match(/^data:([^;,]+)[;,]/i);
  return dataMatch?.[1]?.toLowerCase() || fallback;
}

function isBase64ImageDataUrl(url: string) {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(url.trim());
}

async function dataUrlToFile(url: string, filename: string, mime: string): Promise<File> {
  const response = await fetch(url);
  const blob = await response.blob();
  return new File([blob], filename, { type: mime });
}

export async function assetMentionFileParts(refs: ComposerDraft["assetMentions"] | undefined): Promise<FilePartInput[]> {
  if (!refs?.length) return [];
  const seen = new Set<string>();
  const parts: FilePartInput[] = [];
  const push = async (url: string | undefined, fallbackMime: string, filename: string) => {
    const raw = url?.trim();
    if (!raw || seen.has(raw) || parts.length >= ASSET_MENTION_FILE_PART_LIMIT) return;
    if (isWodeAppLocalAssetUrl(raw)) {
      if (!isLikelyImageAssetUrl(raw, fallbackMime)) return;
      let trimmed = "";
      try {
        trimmed = await readWodeAppLocalAssetAsDataUrl(raw, fallbackMime, filename);
      } catch (error) {
        console.warn("[WodeAppX] Skipped an unavailable local image reference", { filename, error });
        return;
      }
      if (!isBase64ImageDataUrl(trimmed)) return;
      seen.add(raw);
      const mime = mimeFromDataUrl(trimmed, fallbackMime);
      if (WEBP_DATA_URL_RE.test(trimmed)) {
        const modelFileData = await attachmentToModelFileData(await dataUrlToFile(trimmed, filename, mime), mime);
        parts.push({
          type: "file",
          url: modelFileData.url,
          filename: modelFileData.filename,
          mime: modelFileData.mime,
        });
        return;
      }
      parts.push({
        type: "file",
        url: trimmed,
        filename,
        mime,
      });
      return;
    }

    // OpenCode Image.normalize rejects remote URLs in file parts. HTTPS product
    // images remain available in the structured read-only asset context and in
    // prepare-tool arguments; only data URLs or materialized local assets belong
    // in the prompt's file-part array.
    if (!isBase64ImageDataUrl(raw)) return;
    seen.add(raw);
    const mime = mimeFromDataUrl(raw, fallbackMime);
    if (WEBP_DATA_URL_RE.test(raw)) {
      const modelFileData = await attachmentToModelFileData(await dataUrlToFile(raw, filename, mime), mime);
      parts.push({
        type: "file",
        url: modelFileData.url,
        filename: modelFileData.filename,
        mime: modelFileData.mime,
      });
      return;
    }
    parts.push({
      type: "file",
      url: raw,
      filename,
      mime,
    });
  };

  for (const [refIndex, ref] of refs.entries()) {
    const prefix = `${ref.kind || "asset"}-${refIndex + 1}`;
    await push(ref.coverImage, "image/*", `${prefix}-cover`);
    for (const [index, url] of (ref.productImages || []).entries()) {
      await push(url, "image/*", `${prefix}-product-${index + 1}`);
    }
    for (const [index, url] of (ref.assetImages || []).entries()) {
      await push(url, "image/*", `${prefix}-image-${index + 1}`);
    }
    for (const [index, url] of (ref.brandAssets || []).entries()) {
      await push(url, "image/*", `${prefix}-brand-${index + 1}`);
    }
    for (const [index, file] of (ref.assetFiles || []).entries()) {
      if (file.type.startsWith("image/")) {
        await push(file.url, file.type, file.name || `${prefix}-attached-${index + 1}`);
      }
    }
    await push(ref.assetFile, ref.assetFileType || "image/*", ref.assetFileName || `${prefix}-file`);
  }

  return parts;
}
