import type {
  BrandAssetEntry,
  DigitalAssetItem,
  DigitalAssetKind,
} from "./digital-assets-data";
import { requestWodeAppRuntimeJson } from "@/app/lib/wodeapp-auth";

type LegacyModelLibraryAsset = {
  id?: string;
  name?: string;
  image?: string;
  filename?: string;
  gender?: string;
  age?: string;
  region?: string;
  country?: string;
  skinTone?: string;
  desc?: string;
};

type ModelLibraryResponse = {
  success?: boolean;
  data?: {
    version?: string;
    models?: LegacyModelLibraryAsset[];
  };
};

type PlatformDigitalAssetKind =
  | "product"
  | "brand"
  | "prompt"
  | "image"
  | "file"
  | "video"
  | "script"
  | "audio"
  | "role";

type ServerDigitalAssetMedia = {
  url?: string;
  role?: string;
  mediaType?: string;
  mimeType?: string;
  name?: string;
  size?: number;
  contentHash?: string;
  integrityStatus?: "verified" | "unverified" | "invalid";
  processingStatus?: "pending" | "ready" | "failed";
  validationError?: string;
};

type DigitalAssetsResponse = {
  success?: boolean;
  data?: unknown;
  assets?: unknown;
  items?: unknown;
  records?: unknown;
  list?: unknown;
};

const API_KIND_TO_UI_KIND: Record<PlatformDigitalAssetKind, DigitalAssetKind> = {
  product: "商品库",
  brand: "品牌库",
  prompt: "提示词",
  image: "图片",
  file: "文件",
  video: "视频",
  script: "剧本",
  audio: "声音",
  role: "真人",
};

const UI_KINDS = new Set<DigitalAssetKind>([
  "商品库",
  "品牌库",
  "提示词",
  "图片",
  "文件",
  "视频",
  "剧本",
  "声音",
  "真人",
]);

const VALID_PREVIEWS = new Set<DigitalAssetItem["preview"]>([
  "prompt",
  "image",
  "file",
  "video",
  "script",
  "audio",
  "role",
  "product",
  "productUpload",
  "assetUpload",
  "assetCreate",
  "brand",
  "brandCreate",
]);

function compactAssetText(values: Array<string | undefined>): string {
  return values.map((value) => value?.trim()).filter(Boolean).join(" · ");
}

function safeAssetId(value: string): string {
  return value
    .trim()
    .replace(/[^a-z0-9_.:-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown): string | undefined {
  const next = stringValue(value);
  return next || undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(stringValue).filter(Boolean);
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    const trimmed = value?.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    result.push(trimmed);
  });
  return result;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeUiKind(value: unknown): DigitalAssetKind | null {
  const raw = stringValue(value);
  if (!raw) return null;
  if (raw === "角色库") return "真人";
  if (UI_KINDS.has(raw as DigitalAssetKind)) return raw as DigitalAssetKind;
  return API_KIND_TO_UI_KIND[raw as PlatformDigitalAssetKind] || null;
}

function previewForKind(kind: DigitalAssetKind): DigitalAssetItem["preview"] {
  switch (kind) {
    case "商品库":
      return "product";
    case "品牌库":
      return "brand";
    case "提示词":
      return "prompt";
    case "文件":
      return "file";
    case "视频":
      return "video";
    case "剧本":
      return "script";
    case "声音":
      return "audio";
    case "真人":
      return "role";
    case "图片":
    default:
      return "image";
  }
}

function previewValue(value: unknown): DigitalAssetItem["preview"] | undefined {
  const raw = stringValue(value) as DigitalAssetItem["preview"];
  return VALID_PREVIEWS.has(raw) ? raw : undefined;
}

function normalizeMedia(value: unknown): ServerDigitalAssetMedia[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    url: optionalString(item.url),
    role: optionalString(item.role),
    mediaType: optionalString(item.mediaType),
    mimeType: optionalString(item.mimeType),
    name: optionalString(item.name),
    size: numberValue(item.size),
    contentHash: /^sha256:[a-f0-9]{64}$/i.test(stringValue(item.contentHash)) ? stringValue(item.contentHash) : undefined,
    integrityStatus: ["verified", "unverified", "invalid"].includes(stringValue(item.integrityStatus))
      ? stringValue(item.integrityStatus) as ServerDigitalAssetMedia["integrityStatus"]
      : undefined,
    processingStatus: ["pending", "ready", "failed"].includes(stringValue(item.processingStatus))
      ? stringValue(item.processingStatus) as ServerDigitalAssetMedia["processingStatus"]
      : undefined,
    validationError: optionalString(item.validationError),
  }));
}

function isImageMedia(media: ServerDigitalAssetMedia): boolean {
  return media.mediaType === "image" || Boolean(media.mimeType?.startsWith("image/"));
}

function normalizeBrandEntries(value: unknown): BrandAssetEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((entry, index): BrandAssetEntry | null => {
      const title = stringValue(entry.title);
      const description = stringValue(entry.description);
      if (!title || !description) return null;
      return {
        id: stringValue(entry.id) || `brand-entry-${index + 1}`,
        category: stringValue(entry.category) || "条目",
        title,
        description,
        keywords: stringArray(entry.keywords).slice(0, 8) || undefined,
        scenePrompt: optionalString(entry.scenePrompt),
      };
    })
    .filter((entry): entry is BrandAssetEntry => Boolean(entry));
}

function extractDigitalAssetRecords(response: DigitalAssetsResponse | unknown): unknown[] {
  if (Array.isArray(response)) return response;
  if (!isRecord(response)) return [];

  const topLevelKeys = ["assets", "items", "records", "list"] as const;
  for (const key of topLevelKeys) {
    if (Array.isArray(response[key])) return response[key] as unknown[];
  }

  const data = response.data;
  if (Array.isArray(data)) return data;
  if (isRecord(data)) {
    for (const key of topLevelKeys) {
      if (Array.isArray(data[key])) return data[key] as unknown[];
    }
  }
  return [];
}

function defaultMetaForKind(kind: DigitalAssetKind, mediaCount: number): string {
  if (mediaCount > 0) return `${mediaCount} 个资源 · ${kind}`;
  return `WodeApp · ${kind}`;
}

function normalizeDigitalAssetRecord(value: unknown): DigitalAssetItem | null {
  if (!isRecord(value)) return null;

  const payload = recordValue(value.payload);
  const wodeappx = recordValue(payload?.wodeappx) || {};
  const prompt = recordValue(payload?.prompt);
  const product = recordValue(payload?.product);
  const productProfilePayload = recordValue(product?.profile);
  const brand = recordValue(payload?.brand);
  const role = recordValue(payload?.role);
  const assetPayload = recordValue(payload?.asset);
  const filePayload = recordValue(payload?.file);
  const source = recordValue(value.source);

  const kind = normalizeUiKind(wodeappx.kind) || normalizeUiKind(value.kind);
  if (!kind) return null;

  const id = stringValue(wodeappx.id) || stringValue(value.id);
  const name = stringValue(wodeappx.name) || stringValue(value.name);
  if (!id || !name) return null;

  const media = normalizeMedia(value.media);
  const imageUrls = uniqueStrings(media.filter(isImageMedia).map((item) => item.url));
  const allMediaUrls = uniqueStrings(media.map((item) => item.url));
  const coverImage =
    optionalString(wodeappx.coverImage)
    || optionalString(value.coverImage)
    || media.find((item) => item.role === "cover" && item.url)?.url
    || imageUrls[0]
    || undefined;

  const productImages = uniqueStrings([
    ...stringArray(wodeappx.productImages),
    ...stringArray(value.productImages),
    ...stringArray(product?.images),
    ...(kind === "商品库" ? imageUrls : []),
  ]);
  const assetImages = uniqueStrings([
    ...stringArray(wodeappx.assetImages),
    ...stringArray(value.assetImages),
    ...stringArray(assetPayload?.images),
    ...stringArray(role?.images),
    ...(kind !== "商品库" && kind !== "品牌库" ? imageUrls : []),
  ]);
  const brandAssets = uniqueStrings([
    ...stringArray(wodeappx.brandAssets),
    ...stringArray(value.brandAssets),
    ...stringArray(brand?.assets),
    ...(kind === "品牌库" ? imageUrls : []),
  ]);
  const promptTags = uniqueStrings([
    ...stringArray(wodeappx.promptTags),
    ...stringArray(value.promptTags),
    ...stringArray(value.tags),
    ...stringArray(prompt?.tags),
  ]).slice(0, 12);
  const fileMedia = media.find((item) => item.role === "file" && item.url)
    || media.find((item) => item.url && !isImageMedia(item));
  const fileMediaRefs = media.filter((item) => item.url && !isImageMedia(item)).map((item): import("./digital-assets-data").DigitalAssetFileRef => ({
    url: item.url as string,
    name: item.name || "未命名文件",
    type: item.mimeType || "application/octet-stream",
    size: item.size || 0,
    mediaType: item.mediaType === "video" || item.mediaType === "audio" || item.mediaType === "document"
      ? item.mediaType
      : "other",
    contentHash: item.contentHash,
    integrityStatus: item.integrityStatus,
    processingStatus: item.processingStatus,
    validationError: item.validationError,
  }));
  const contentHashes = uniqueStrings(media.map((item) => item.contentHash));
  const integrityStatuses = media.map((item) => item.integrityStatus).filter(Boolean);
  const processingStatuses = media.map((item) => item.processingStatus).filter(Boolean);
  const integrityStatus = integrityStatuses.includes("invalid")
    ? "invalid"
    : integrityStatuses.includes("unverified")
      ? "unverified"
      : integrityStatuses.length ? "verified" : undefined;
  const processingStatus = processingStatuses.includes("failed")
    ? "failed"
    : processingStatuses.includes("pending")
      ? "pending"
      : processingStatuses.length ? "ready" : undefined;
  const assetFile =
    optionalString(wodeappx.assetFile)
    || optionalString(value.assetFile)
    || optionalString(filePayload?.url)
    || (kind === "文件" || kind === "视频" || kind === "声音" ? fileMedia?.url || allMediaUrls[0] : undefined);

  const brandEntries = [
    ...normalizeBrandEntries(wodeappx.brandEntries),
    ...normalizeBrandEntries(value.brandEntries),
    ...normalizeBrandEntries(brand?.entries),
  ];
  const promptText =
    optionalString(wodeappx.promptText)
    || optionalString(value.promptText)
    || optionalString(prompt?.text)
    || optionalString(role?.description)
    || optionalString(assetPayload?.notes);
  const productImageSyncStatusRaw =
    optionalString(wodeappx.productImageSyncStatus)
    || optionalString(value.productImageSyncStatus);
  const explicitProductImageSyncStatus = (
    productImageSyncStatusRaw === "local-only"
    || productImageSyncStatusRaw === "syncing"
    || productImageSyncStatusRaw === "synced"
    || productImageSyncStatusRaw === "failed"
  ) ? productImageSyncStatusRaw : undefined;
  const legacyLocalImageCount = productImages.filter((url) => !/^https:\/\//i.test(url.trim())).length;
  const productImageSyncStatus = productImages.length
    ? legacyLocalImageCount > 0
      ? "local-only"
      : explicitProductImageSyncStatus || "synced"
    : undefined;
  return {
    id,
    name,
    kind,
    meta:
      optionalString(wodeappx.meta)
      || optionalString(value.meta)
      || optionalString(value.summary)
      || defaultMetaForKind(kind, media.length),
    preview: previewValue(wodeappx.preview) || previewValue(value.preview) || previewForKind(kind),
    createKind: normalizeUiKind(wodeappx.createKind) || undefined,
    promptCategory:
      optionalString(wodeappx.promptCategory)
      || optionalString(value.promptCategory)
      || optionalString(prompt?.category),
    promptTags: promptTags.length ? promptTags : undefined,
    promptText,
    productInfo:
      optionalString(wodeappx.productInfo)
      || optionalString(value.productInfo)
      || optionalString(product?.info)
      || optionalString(product?.description)
      || optionalString(product?.summary)
      || optionalString(productProfilePayload?.shortDescription),
    productImages: productImages.length ? productImages : undefined,
    media: media.length
      ? media
          .filter((item) => item.url)
          .map((item) => ({
            url: item.url as string,
            name: item.name || undefined,
            role: (["cover", "reference", "attachment", "output", "thumbnail", "file"].includes(String(item.role))
              ? item.role
              : undefined) as import("./digital-assets-data").DigitalAssetMediaItem["role"],
            mediaType: (["image", "video", "audio", "document", "other"].includes(String(item.mediaType))
              ? item.mediaType
              : undefined) as import("./digital-assets-data").DigitalAssetMediaItem["mediaType"],
          }))
      : productImages.length
        ? productImages.map((url, index) => ({
          url,
          role: (index === 0 ? "cover" : "reference") as "cover" | "reference",
          mediaType: "image" as const,
        }))
        : undefined,
    productImageSyncStatus,
    productImageSyncError:
      optionalString(wodeappx.productImageSyncError)
      || optionalString(value.productImageSyncError)
      || (productImageSyncStatus === "local-only"
        ? `${legacyLocalImageCount} 张商品图仅在原设备可用，远端生成前需要重新上传同步。`
        : undefined),
    assetImages: assetImages.length ? assetImages : undefined,
    assetFile,
    assetFileName:
      optionalString(wodeappx.assetFileName)
      || optionalString(value.assetFileName)
      || optionalString(filePayload?.name)
      || fileMedia?.name,
    assetFileType:
      optionalString(wodeappx.assetFileType)
      || optionalString(value.assetFileType)
      || optionalString(filePayload?.type)
      || fileMedia?.mimeType,
    assetFileSize:
      numberValue(wodeappx.assetFileSize)
      || numberValue(value.assetFileSize)
      || numberValue(filePayload?.size)
      || fileMedia?.size,
    assetFiles: fileMediaRefs.length ? fileMediaRefs : undefined,
    contentHashes: contentHashes.length ? contentHashes : undefined,
    integrityStatus,
    processingStatus,
    validationErrors: uniqueStrings(media.map((item) => item.validationError)).length
      ? uniqueStrings(media.map((item) => item.validationError))
      : undefined,
    brandColors: stringArray(wodeappx.brandColors).length
      ? stringArray(wodeappx.brandColors)
      : stringArray(brand?.colors),
    brandVoice:
      optionalString(wodeappx.brandVoice)
      || optionalString(value.brandVoice)
      || optionalString(brand?.voice),
    brandRules:
      optionalString(wodeappx.brandRules)
      || optionalString(value.brandRules)
      || optionalString(brand?.rules),
    brandAssets: brandAssets.length ? brandAssets : undefined,
    brandEntries: brandEntries.length ? brandEntries.slice(0, 12) : undefined,
    coverImage,
    assetTime:
      optionalString(wodeappx.assetTime)
      || optionalString(value.assetTime)
      || optionalString(value.updatedAt)
      || optionalString(value.createdAt),
    assetUse:
      optionalString(wodeappx.assetUse)
      || optionalString(value.assetUse)
      || optionalString(source?.type),
    durationLabel:
      optionalString(wodeappx.durationLabel)
      || optionalString(value.durationLabel)
      || optionalString(assetPayload?.durationLabel),
    generationTaskId:
      optionalString(wodeappx.generationTaskId)
      || optionalString(value.generationTaskId)
      || optionalString(value.taskId)
      || optionalString(assetPayload?.taskId),
    generationModel:
      optionalString(wodeappx.generationModel)
      || optionalString(value.generationModel)
      || optionalString(value.model)
      || optionalString(assetPayload?.model),
    generationProvider:
      optionalString(wodeappx.generationProvider)
      || optionalString(value.generationProvider)
      || optionalString(value.provider)
      || optionalString(assetPayload?.provider),
    generationSourceAssetId:
      optionalString(wodeappx.generationSourceAssetId)
      || optionalString(value.generationSourceAssetId)
      || optionalString(value.sourceAssetId)
      || optionalString(assetPayload?.sourceAssetId),
    generationShareUrl:
      optionalString(wodeappx.generationShareUrl)
      || optionalString(value.generationShareUrl)
      || optionalString(value.shareUrl)
      || optionalString(value.taskUrl)
      || optionalString(value.launchUrl)
      || optionalString(assetPayload?.shareUrl)
      || optionalString(assetPayload?.taskUrl)
      || optionalString(assetPayload?.launchUrl),
  };
}

export function normalizeDigitalAssetsResponse(response: DigitalAssetsResponse | unknown): DigitalAssetItem[] {
  const seen = new Set<string>();
  const assets: DigitalAssetItem[] = [];
  for (const record of extractDigitalAssetRecords(response)) {
    const asset = normalizeDigitalAssetRecord(record);
    if (!asset || seen.has(asset.id)) continue;
    seen.add(asset.id);
    assets.push(asset);
  }
  return assets;
}

function legacyModelToDigitalAsset(model: LegacyModelLibraryAsset, index: number): DigitalAssetItem | null {
  const imageUrl = model.image?.trim();
  if (!imageUrl) return null;

  const rawId = model.id?.trim() || model.filename?.trim() || `model-${index + 1}`;
  const id = safeAssetId(rawId) || `model-${index + 1}`;
  const name = model.name?.trim() || `平台模特 ${index + 1}`;
  const meta = compactAssetText([model.country, model.gender, model.age, model.skinTone]) || "平台角色参考";
  const tags = [
    "平台角色",
    model.country,
    model.region,
    model.gender,
    model.age,
    model.skinTone,
  ]
    .map((value) => value?.trim())
    .filter((value, tagIndex, values): value is string => Boolean(value) && values.indexOf(value) === tagIndex);
  const promptText = [
    `${name}，${meta}。`,
    model.desc?.trim(),
    "作为人物/模特参考图使用时，请保持五官、年龄感、肤色、发型气质与整体人像真实感一致。",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    id: `platform-role-${id}`,
    name,
    kind: "真人",
    meta,
    preview: "role",
    coverImage: imageUrl,
    assetImages: [imageUrl],
    promptTags: tags,
    promptText,
    assetTime: "平台真人库",
    assetUse: "角色参考",
  };
}

function normalizeModelLibraryAssets(models: LegacyModelLibraryAsset[] | undefined): DigitalAssetItem[] {
  if (!Array.isArray(models)) return [];
  const seen = new Set<string>();
  const assets: DigitalAssetItem[] = [];
  models.forEach((model, index) => {
    const asset = legacyModelToDigitalAsset(model, index);
    if (!asset || seen.has(asset.id)) return;
    seen.add(asset.id);
    assets.push(asset);
  });
  return assets;
}

export async function fetchWodeAppDigitalAssets(input: {
  origin: string;
  apiKey: string;
}): Promise<DigitalAssetItem[]> {
  if (!input.origin || !input.apiKey) return [];

  try {
    const digitalAssets = await requestWodeAppRuntimeJson<DigitalAssetsResponse>(
      "/v1/digital-assets?includePlatform=true",
      { method: "GET", wodeAppCredentials: input },
      30000,
    );
    const normalized = normalizeDigitalAssetsResponse(digitalAssets);
    if (normalized.length) return normalized;
  } catch {
    // The v1 digital-assets API may not be deployed yet. Keep the legacy model library as a read-only fallback.
  }

  const modelLibrary = await requestWodeAppRuntimeJson<ModelLibraryResponse>(
    "/commerce-studio/model-library",
    { method: "GET", wodeAppCredentials: input },
    30000,
  );

  return normalizeModelLibraryAssets(modelLibrary.data?.models);
}
