export type VideoStoryboardAssetImageSource = {
  coverImage?: string;
  productImages?: string[];
  assetImages?: string[];
  brandAssets?: string[];
  assetFile?: string;
  assetFileType?: string;
};

export const MAX_VIDEO_STORYBOARD_ASSET_IMAGES = 4;

/**
 * Keep the complete material set in Digital Assets, but only inject a small,
 * deterministic visual sample into one storyboard payload. This avoids huge
 * share documents while still ensuring the video model receives real product
 * references instead of inventing an object from the product name alone.
 */
export function selectVideoStoryboardAssetImages(
  asset: VideoStoryboardAssetImageSource,
  limit = MAX_VIDEO_STORYBOARD_ASSET_IMAGES,
): string[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const urls = [
    asset.coverImage,
    ...(asset.productImages || []),
    ...(asset.assetImages || []),
    ...(asset.brandAssets || []),
    asset.assetFileType?.startsWith("image/") ? asset.assetFile : undefined,
  ]
    .map((url) => url?.trim())
    .filter((url): url is string => Boolean(url));

  return [...new Set(urls)].slice(0, Math.floor(limit));
}
