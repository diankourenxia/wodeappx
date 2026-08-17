/** @jsxImportSource react */
import { useMemo } from "react";

import { useControlAction, type OpenworkControlAction } from "@/react-app/shell/control/control-provider";
import { openDesktopPath } from "@/app/lib/desktop";
import { isElectronRuntime } from "@/app/utils";
import {
  WodeAppRuntimeRequestError,
  getWodeAppApiCredentials,
  loadWodeAppAuthState,
  requestWodeAppRuntimeJson,
  requestWodeAppMainJson,
  syncWodeAppAbilityProjects,
} from "@/app/lib/wodeapp-auth";

import {
  digitalAssetToMention,
  type DigitalAssetFileRef,
  type DigitalAssetItem,
  type DigitalAssetKind,
  type ProductImageSyncStatus,
} from "./digital-assets-data";
import {
  dedupeLocalDigitalAssets,
  deleteLocalDigitalAssets,
  ensureLocalDigitalAssetsLoaded,
  findDigitalAssetByMentionValue,
  listDigitalAssetsForAgent,
  saveBrandResearchAsset,
  saveGenerationHistoryAsset,
  saveImageLibraryAsset,
  saveProductResearchAsset,
  savePromptResearchAsset,
} from "./digital-assets-store";
import {
  findWodeAppBuiltinAgent,
  matchAbilityProject,
  openWodeAppAgentTaskUrl,
  readWodeAppAbilityProjects,
  type WodeAppBuiltinAgent,
} from "./runtime-projects";
import {
  dispatchOpenScriptWorkbench,
} from "./wodeapp-script-pipeline";
import { listRememberedAssetMentions, rememberAssetMention } from "./wodeapp-workbench-context";
import { controlOptionalBooleanArgument, controlOptionalStringArgument, controlOptionalStringArrayArgument, controlOptionalRecordArrayArgument } from "./wodeapp-control-args";
import { buildVideoStoryboardTaskUrlAsync, normalizeShareDocId } from "./wodeapp-pvs-storyboard-url";
import { coalesceStoryboardBeatsIntoClips, coerceStoryboardSceneGroupId, collectAgentVideoModelHints, getVideoClipMaxSec, PRODUCT_VIDEO_DEFAULT_MODEL, PRODUCT_VIDEO_DEFAULT_MODEL_LABEL, resolveStoryboardGroupsForPayload, stripStoryboardSceneModels, unwrapJsonishToolValue, validateStoryboardClipDurations, VIDEO_CLIP_MAX_SEC, type StoryboardGroupPayload } from "./wodeapp-storyboard-clips";
import { selectVideoStoryboardAssetImages } from "./wodeapp-video-storyboard-assets";
import {
  WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
  isClearlyNonImageAssetUrl,
  wodeAppDigitalAssetCapabilities,
} from "./wodeapp-digital-asset-contract";
import {
  listCurrentSessionProductImageCandidates,
  materializeProductImageUrls,
  resolveAndMaterializeSessionImages,
  type SessionProductImageCandidate,
} from "./wodeapp-product-image-materialize";
import {
  WODEAPP_DIRECT_ACTION_CONTRACT_BY_ACTION_ID,
  directActionInputSchemaToRendererArgs,
  isDurableProductImageUrl,
  validateRemoteReadyProductImageUrls,
  validateDurableProductImageUrls,
  type WodeAppDirectActionId,
} from "./wodeapp-direct-action-contracts";
import { buildVisualGenerationTaskUrlAsync } from "./wodeapp-pv-visual-task-url";
import {
  PRODUCT_VISUAL_BATCH_IMAGE_CAPABILITY_ID,
  buildDefaultBatchImageVisualTask,
  withBatchImageDraftCards,
  inferBatchImageCreativeTypeIds,
  inferBatchImageIterCount,
  type BatchImageVisualTaskPayload,
} from "./wodeapp-pv-batch-image-capability";

const BATCH_IMAGE_ACTION_LOG_PREFIX = "[WodeAppX][batch-image-action]";

function directActionMetadata(actionId: WodeAppDirectActionId): Omit<OpenworkControlAction, "disabled" | "execute" | "previewArgs"> {
  const contract = WODEAPP_DIRECT_ACTION_CONTRACT_BY_ACTION_ID.get(actionId);
  if (!contract) throw new Error(`Missing direct action contract: ${actionId}`);
  return {
    id: contract.actionId,
    label: contract.label,
    description: contract.description,
    sideEffect: contract.effect === "read" ? "none" : "mutation",
    effect: contract.effect,
    approval: contract.approval,
    requiresConfirmation: contract.approval === "prompt",
    requiresArgs: contract.inputSchema.required.length > 0
      || Boolean(contract.inputSchema.anyOf?.some((schema) => (schema.required?.length ?? 0) > 0)),
    args: [...directActionInputSchemaToRendererArgs(contract.inputSchema)],
  };
}

function batchImageActionElapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

function summarizeBatchImageActionError(error: unknown): Record<string, unknown> {
  if (error instanceof WodeAppRuntimeRequestError) {
    return {
      name: error.name,
      message: error.message,
      status: error.status,
      bodySnippet: error.bodySnippet?.slice(0, 500),
    };
  }
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { message: String(error ?? "") };
}

function summarizeBatchImageTask(
  task: BatchImageVisualTaskPayload,
  input: {
    showUi: boolean;
    productImages: number;
    referenceImages: number;
    sourceAssetId?: string;
    projectHints: { slug?: string; subdomain?: string; projectId?: string };
  },
): Record<string, unknown> {
  return {
    productName: task.name,
    showUi: input.showUi,
    productImages: input.productImages,
    referenceImages: input.referenceImages,
    hasSourceAssetId: Boolean(input.sourceAssetId),
    selectedCreativeTypes: task.selectedCreativeTypes,
    iterCount: task.iterCount,
    targetTotalImages: task.targetTotalImages,
    parallel: task.parallel,
    model: task.model,
    projectHints: input.projectHints,
  };
}

function inferProductNameFromPrompt(prompt: string): string {
  const match = prompt.match(/(?:商品|产品|名称|product)\s*[：:]\s*([^\n，,。；;]+)/i);
  const value = match?.[1]?.trim();
  return value ? value.slice(0, 60) : "";
}

function normalizeGenerationHistoryKind(value: string): DigitalAssetKind {
  const normalized = normalizeDigitalAssetKind(value);
  if (normalized && normalized !== "全部") return normalized;
  return "图片";
}

const DIGITAL_ASSET_KIND_ALIASES: Record<string, DigitalAssetKind | "全部"> = {
  all: "全部",
  "全部": "全部",
  product: "商品库",
  "商品": "商品库",
  "商品库": "商品库",
  brand: "品牌库",
  "品牌": "品牌库",
  "品牌库": "品牌库",
  prompt: "提示词",
  "提示词": "提示词",
  image: "图片",
  "图片": "图片",
  file: "文件",
  "文件": "文件",
  video: "视频",
  "视频": "视频",
  script: "剧本",
  "剧本": "剧本",
  audio: "声音",
  voice: "声音",
  "声音": "声音",
  role: "真人",
  "真人": "真人",
  "角色": "真人",
  "角色库": "真人",
};

function normalizeDigitalAssetKind(value: string): DigitalAssetKind | "全部" | undefined {
  const raw = value.trim();
  if (!raw) return undefined;
  return DIGITAL_ASSET_KIND_ALIASES[raw] || DIGITAL_ASSET_KIND_ALIASES[raw.toLowerCase()];
}

function controlOptionalNumberArgument(args: unknown, name: string, fallback: number): number {
  if (!args || typeof args !== "object" || !(name in args)) return fallback;
  const value = (args as Record<string, unknown>)[name];
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : NaN;
  return Number.isFinite(numeric) ? numeric : fallback;
}

function maskWodeAppApiKey(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 12) return `${trimmed.slice(0, 4)}...`;
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-4)}`;
}

async function readWodeAppAuthStatusForAction() {
  const [authStateResult, credentialsResult] = await Promise.allSettled([
    loadWodeAppAuthState(),
    getWodeAppApiCredentials(),
  ]);
  const credentials = credentialsResult.status === "fulfilled" ? credentialsResult.value : null;
  const credentialSummary = {
    origin: credentials?.origin,
    hasApiKey: Boolean(credentials?.apiKey),
    apiKeyPreview: credentials?.apiKey ? maskWodeAppApiKey(credentials.apiKey) : undefined,
  };

  if (authStateResult.status !== "fulfilled") {
    return {
      ok: false,
      signedIn: Boolean(credentials),
      ...credentialSummary,
      error: authStateResult.reason instanceof Error ? authStateResult.reason.message : "读取 WodeApp 账户失败",
      userVisibleSummary: "未能读取 WodeApp 账户。",
    };
  }

  const authState = authStateResult.value;
  if (!authState.ok) {
    return {
      ok: false,
      signedIn: Boolean(credentials),
      ...credentialSummary,
      error: authState.error || "读取 WodeApp 账户失败",
      userVisibleSummary: "未能读取 WodeApp 账户。",
    };
  }

  if (!authState.signedIn || !authState.config) {
    return {
      ok: true,
      signedIn: false,
      ...credentialSummary,
      diagnostic: credentials ? "凭证通道有 API Key，但账号状态尚未同步。" : undefined,
      userVisibleSummary: credentials
        ? "检测到本地凭证，但账号状态尚未同步。"
        : "WodeApp 内嵌能力正在初始化。",
    };
  }

  const config = authState.config;
  const accountName = config.user?.name?.trim() || "WodeApp 用户";
  const abilityProjects = (config.abilityProjects || []).slice(0, 12).map((project) => ({
    id: project.id,
    kind: project.kind,
    title: project.title,
    slug: project.slug,
    subdomain: project.subdomain,
    launchUrl: project.launchUrl,
  }));
  const builtInTools = config.builtInTools
    ? {
        ok: config.builtInTools.ok,
        status: config.builtInTools.status,
        toolCount: config.builtInTools.toolCount,
        httpStatus: config.builtInTools.httpStatus,
        transport: config.builtInTools.transport,
        endpoint: config.builtInTools.endpoint,
        error: config.builtInTools.error,
      }
    : undefined;

  return {
    ok: true,
    signedIn: true,
    ...credentialSummary,
    origin: credentials?.origin || config.origin,
    account: {
      id: config.user?.id || null,
      name: config.user?.name || null,
    },
    credits: config.credits,
    providerId: config.providerId,
    defaultModelId: config.defaultModelId,
    modelCount: config.modelIds.length,
    builtInTools,
    abilityProjectCount: config.abilityProjects?.length || 0,
    abilityProjects,
    abilityProjectsSyncError: config.abilityProjectsSyncError || null,
    userVisibleSummary: `WodeApp 内嵌能力已就绪：${accountName}${typeof config.credits === "number" ? `，积分 ${config.credits}` : ""}。`,
  };
}

function compactDigitalAssetForAction(asset: DigitalAssetItem) {
  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    meta: asset.meta,
    source: asset.id.startsWith("local-") ? "local" : asset.id.startsWith("dasset_") ? "cloud" : "platform",
    assetTime: asset.assetTime,
    assetUse: asset.assetUse,
    productImageCount: asset.productImages?.length || 0,
    assetImageCount: asset.assetImages?.length || 0,
    brandAssetCount: asset.brandAssets?.length || 0,
    fileCount: asset.assetFiles?.length || (asset.assetFile ? 1 : 0),
    contentHashes: asset.contentHashes || [],
    integrityStatus: asset.integrityStatus || "unverified",
    processingStatus: asset.processingStatus || "ready",
    validationErrors: asset.validationErrors || [],
  };
}

function formatGenerationHistoryAssetLabel(kind: DigitalAssetKind, productName: string, taskId?: string): string {
  const subject = productName.trim() || "WodeAppX";
  const suffix = taskId ? ` · ${taskId.slice(0, 8)}` : "";
  return `${subject}${kind}生成${suffix}`;
}

// ── 多条/分镜视频工作台（product_video_storyboard 契约，对齐 shared-components/sections/productVideo/agentVideoCapability.ts）──

const PRODUCT_VIDEO_STORYBOARD_CAPABILITY_ID = "product_video_storyboard";

type VideoStoryboardVideoRefPayload = {
  id?: string;
  schemaVersion?: number;
  taskId?: string;
  status: "pending" | "processing" | "succeed" | "failed";
  url?: string;
  videoUrl?: string;
  coverUrl?: string;
  thumbnailUrl?: string;
  provider?: string;
  createdAt?: number;
  createdBy?: string;
  promptSnapshot?: string;
  inputParamsSnapshot?: Record<string, unknown>;
};

type VideoStoryboardScenePayload = {
  id?: string;
  name?: string;
  prompt: string;
  voiceoverText?: string;
  dialogue?: string;
  narration?: string;
  duration?: number;
  model?: string;
  camera?: string;
  imageUrl?: string;
  subjects?: VideoStoryboardSubjectPayload[];
  groupId?: string;
  orderInGroup?: number;
  videoRefs?: VideoStoryboardVideoRefPayload[];
  activeVideoId?: string;
  taskId?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  status?: "idle" | "generating" | "succeed" | "failed" | "pending" | "processing";
};

type VideoStoryboardSubjectPayload = {
  name: string;
  type?: "character" | "prop" | "scene";
  description?: string;
  imageUrl?: string;
};

type VideoStoryboardTaskPayload = {
  capabilityId: typeof PRODUCT_VIDEO_STORYBOARD_CAPABILITY_ID;
  id: string;
  topic?: string;
  inputSnapshot: { ratio: string; durationSec?: number; model?: string };
  scenes: VideoStoryboardScenePayload[];
  subjects?: VideoStoryboardSubjectPayload[];
  /** ProductVideo UI「新建分组」：一集/一幕一组，同一 shareDoc 内切换 */
  groups?: StoryboardGroupPayload[];
};

type DirectVideoTaskType = "text2video" | "image2video" | "firstlast" | "omni" | "avatar";

type DirectVideoTaskResponse = {
  success?: boolean;
  data?: {
    taskId?: string;
    status?: string;
    provider?: string;
    taskType?: string;
    providerTaskId?: string;
    videoUrl?: string | null;
    deduplicated?: boolean;
  };
  error?: string;
};

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeStoryboardVideoRefStatus(
  value: unknown,
  fallback: { hasTask: boolean; hasUrl: boolean },
): VideoStoryboardVideoRefPayload["status"] {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "succeed" || raw === "succeeded" || raw === "success" || raw === "completed" || raw === "complete" || raw === "done") {
    return "succeed";
  }
  if (raw === "failed" || raw === "fail" || raw === "error" || raw === "timeout" || raw === "cancelled" || raw === "canceled") {
    return "failed";
  }
  if (raw === "processing" || raw === "generating" || raw === "polling" || raw === "running" || raw === "submitted" || raw === "queued") {
    return "processing";
  }
  if (raw === "pending") return "pending";
  if (fallback.hasUrl) return "succeed";
  if (fallback.hasTask) return "processing";
  return "pending";
}

function normalizeStoryboardVideoRefs(raw: unknown, fallbackPrompt: string): VideoStoryboardVideoRefPayload[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const now = Date.now();
  const refs = raw
    .map((item, index): VideoStoryboardVideoRefPayload | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const taskId = asOptionalString(record.taskId);
      const url = asOptionalString(record.url) || asOptionalString(record.videoUrl);
      if (!taskId && !url) return null;
      const id = asOptionalString(record.id) || (taskId ? `vr-ext-${taskId}` : `vr-agent-${now}-${index}`);
      const createdAt = Number(record.createdAt);
      const inputParamsSnapshot = record.inputParamsSnapshot && typeof record.inputParamsSnapshot === "object"
        ? record.inputParamsSnapshot as Record<string, unknown>
        : undefined;
      return {
        id,
        schemaVersion: Number.isFinite(Number(record.schemaVersion)) ? Number(record.schemaVersion) : 1,
        taskId,
        status: normalizeStoryboardVideoRefStatus(record.status, { hasTask: Boolean(taskId), hasUrl: Boolean(url) }),
        url,
        coverUrl: asOptionalString(record.coverUrl) || asOptionalString(record.thumbnailUrl),
        provider: asOptionalString(record.provider),
        createdAt: Number.isFinite(createdAt) ? createdAt : now - (raw.length - index) * 1000,
        createdBy: asOptionalString(record.createdBy),
        promptSnapshot: asOptionalString(record.promptSnapshot) || asOptionalString(record.prompt) || fallbackPrompt,
        inputParamsSnapshot,
      };
    })
    .filter((ref): ref is VideoStoryboardVideoRefPayload => Boolean(ref));
  return refs.length ? refs : undefined;
}

function normalizeStoryboardSceneStatus(value: unknown): VideoStoryboardScenePayload["status"] | undefined {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (raw === "succeed" || raw === "success" || raw === "completed" || raw === "done") return "succeed";
  if (raw === "failed" || raw === "fail" || raw === "error" || raw === "timeout") return "failed";
  if (raw === "generating" || raw === "processing" || raw === "polling" || raw === "running" || raw === "submitted") return "generating";
  if (raw === "pending") return "pending";
  if (raw === "idle") return "idle";
  return undefined;
}

function normalizeStoryboardScenes(raw: unknown): VideoStoryboardScenePayload[] {
  const unwrappedRoot = unwrapJsonishToolValue(raw);
  if (!Array.isArray(unwrappedRoot)) return [];
  return unwrappedRoot
    .map((item, index): VideoStoryboardScenePayload | null => {
      const coerced = unwrapJsonishToolValue(item);
      if (typeof coerced === "string") {
        const prompt = coerced.trim();
        return prompt ? { name: `场景 ${index + 1}`, prompt } : null;
      }
      if (!coerced || typeof coerced !== "object" || Array.isArray(coerced)) return null;
      const record = coerced as Record<string, unknown>;
      let prompt = asOptionalString(record.prompt)
        || asOptionalString(record.script)
        || asOptionalString(record.description);
      if (!prompt) return null;
      const legacyAssetNames = Array.isArray(record.assets)
        ? record.assets.map(asOptionalString).filter((name): name is string => Boolean(name))
        : [];
      for (const assetName of legacyAssetNames) {
        if (prompt.includes(`[${assetName}]`)) continue;
        prompt = prompt.includes(assetName)
          ? prompt.replace(assetName, `[${assetName}]`)
          : `参考[${assetName}]，${prompt}`;
      }
      const duration = Number(record.duration);
      const videoRefs = normalizeStoryboardVideoRefs(record.videoRefs, prompt);
      const activeVideoId = asOptionalString(record.activeVideoId);
      const taskId = asOptionalString(record.taskId);
      const videoUrl = asOptionalString(record.videoUrl);
      const thumbnailUrl = asOptionalString(record.thumbnailUrl);
      const status = normalizeStoryboardSceneStatus(record.status);
      const model = asOptionalString(record.model) || asOptionalString(record.modelId);
      const legacyReferenceImage = Array.isArray(record.referenceImages)
        ? record.referenceImages.map(asOptionalString).find(Boolean)
        : undefined;
      return {
        id: asOptionalString(record.id),
        name: asOptionalString(record.name) || asOptionalString(record.title) || `场景 ${index + 1}`,
        prompt,
        ...(asOptionalString(record.voiceoverText) ? { voiceoverText: asOptionalString(record.voiceoverText) } : {}),
        ...(asOptionalString(record.dialogue) ? { dialogue: asOptionalString(record.dialogue) } : {}),
        ...(asOptionalString(record.narration) ? { narration: asOptionalString(record.narration) } : {}),
        duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
        ...(model ? { model } : {}),
        camera: asOptionalString(record.camera),
        imageUrl: asOptionalString(record.imageUrl)
          || asOptionalString(record.referenceImage)
          || legacyReferenceImage,
        subjects: normalizeStoryboardSubjects(record.subjects),
        groupId: coerceStoryboardSceneGroupId(record),
        orderInGroup: Number.isFinite(Number(record.orderInGroup)) ? Number(record.orderInGroup) : undefined,
        ...(videoRefs ? { videoRefs } : {}),
        ...(activeVideoId ? { activeVideoId } : {}),
        ...(taskId ? { taskId } : {}),
        ...(videoUrl ? { videoUrl } : {}),
        ...(thumbnailUrl ? { thumbnailUrl } : {}),
        ...(status ? { status } : {}),
      };
    })
    .filter((scene): scene is VideoStoryboardScenePayload => Boolean(scene));
}

function normalizeSubjectNameForVideo(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeStoryboardSubjects(raw: unknown): VideoStoryboardSubjectPayload[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): VideoStoryboardSubjectPayload | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const name = asOptionalString(record.name);
      if (!name) return null;
      const type = record.type === "prop" || record.type === "scene" ? record.type : record.type === "character" ? "character" : undefined;
      return {
        name,
        type,
        description: asOptionalString(record.description),
        imageUrl: asOptionalString(record.imageUrl),
      };
    })
    .filter((subject): subject is VideoStoryboardSubjectPayload => Boolean(subject));
}

function dedupeStoryboardSubjects(list: VideoStoryboardSubjectPayload[]): VideoStoryboardSubjectPayload[] {
  const seen = new Map<string, VideoStoryboardSubjectPayload>();
  for (const subject of list) {
    const key = `${normalizeSubjectNameForVideo(subject.name)}::${subject.type || "character"}`;
    if (!key.startsWith("::")) {
      const existing = seen.get(key);
      seen.set(key, {
        ...subject,
        ...(existing?.description && !subject.description ? { description: existing.description } : {}),
        ...(existing?.imageUrl && !subject.imageUrl ? { imageUrl: existing.imageUrl } : {}),
      });
    }
  }
  return Array.from(seen.values());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function promptHasSubjectTag(prompt: string, subjectName: string): boolean {
  return new RegExp(`\\[\\s*${escapeRegExp(subjectName)}\\s*\\]`).test(prompt);
}

function promptMentionsSubject(prompt: string, subjectName: string): boolean {
  const name = subjectName.trim();
  return Boolean(name && prompt.includes(name));
}

function tagSubjectInPrompt(prompt: string, subject: VideoStoryboardSubjectPayload): string {
  if (promptHasSubjectTag(prompt, subject.name)) return prompt;
  if (promptMentionsSubject(prompt, subject.name)) {
    return prompt.replace(subject.name, `[${subject.name}]`);
  }
  if (subject.type === "scene") {
    return `在无人[${subject.name}]环境中，${prompt}`;
  }
  if (subject.type === "character") {
    return `参考[${subject.name}]的外貌、服装和表演连续性，${prompt}`;
  }
  return `参考[${subject.name}]的外观、结构比例、材质和品牌标识，${prompt}`;
}

const PRODUCT_VIDEO_QUALITY_SUFFIX = [
  "【电商广告质感】真实商品短视频，不要短剧棚景或无关房间；场景必须服务商品品类和卖点，镜头节奏清楚，开场有钩子，中段有产品/使用证明，结尾有品牌收束。",
  "【商品保真】商品结构、关键部件、开合方式、材质、比例和品牌识别尽量贴近参考图，不要改款、不要变形、不要凭空增加不相关配件。",
  "【画面交付】9:16 竖屏主体清楚，产品始终是视觉中心；如需卖点文字，只留出字幕/贴片空间或使用极短词，避免生成乱码、错误品牌字和大段画面文字。",
].join("\n");

function addProductVideoQualityPrompt(prompt: string): string {
  if (!prompt.trim()) return prompt;
  if (prompt.includes("【电商广告质感】")) return prompt;
  return `${prompt.trim()}\n${PRODUCT_VIDEO_QUALITY_SUFFIX}`;
}

function inferStoryboardProductSubjectName(args: Record<string, unknown>, topic: string): string {
  const productName = controlOptionalStringArgument(args, "productName")
    || controlOptionalStringArgument(args, "name")
    || controlOptionalStringArgument(args, "product")
    || inferProductNameFromPrompt(controlOptionalStringArgument(args, "productInfo") || "")
    || inferProductNameFromPrompt(topic);
  return productName || "商品参考";
}

type ResolvedStoryboardAsset = {
  asset?: DigitalAssetItem;
  requestedAssetId?: string;
  requestedProductName?: string;
  matchedBy?: "id" | "name";
};

async function resolveStoryboardAsset(
  args: Record<string, unknown>,
  topic: string,
): Promise<ResolvedStoryboardAsset> {
  const legacyProductValue = controlOptionalStringArgument(args, "product");
  const explicitAssetId =
    controlOptionalStringArgument(args, "sourceAssetId")
    || controlOptionalStringArgument(args, "productId")
    || controlOptionalStringArgument(args, "assetId");
  const requestedAssetId = explicitAssetId
    || (/^(?:asset:)?local-/i.test(legacyProductValue) ? legacyProductValue : "");
  const requestedProductName =
    controlOptionalStringArgument(args, "productName")
    || controlOptionalStringArgument(args, "name")
    || (requestedAssetId ? "" : legacyProductValue)
    || inferProductNameFromPrompt(controlOptionalStringArgument(args, "productInfo") || "")
    || inferProductNameFromPrompt(topic);

  if (!requestedAssetId && !requestedProductName) return {};
  await ensureLocalDigitalAssetsLoaded();

  if (requestedAssetId) {
    const asset = findDigitalAssetByMentionValue(requestedAssetId);
    if (asset) return { asset, requestedAssetId, requestedProductName, matchedBy: "id" };
  }

  if (requestedProductName) {
    const exact = findDigitalAssetByMentionValue(requestedProductName);
    if (exact) return { asset: exact, requestedAssetId, requestedProductName, matchedBy: "name" };
    const normalizedName = requestedProductName.trim().toLowerCase();
    const productAsset = listDigitalAssetsForAgent({ kind: "商品库", q: requestedProductName, limit: 20 })
      .find((candidate) => candidate.name.trim().toLowerCase() === normalizedName);
    if (productAsset) return { asset: productAsset, requestedAssetId, requestedProductName, matchedBy: "name" };
  }

  return { requestedAssetId, requestedProductName };
}

function storyboardAssetProductInfo(asset: DigitalAssetItem | undefined): string {
  if (!asset) return "";
  if (asset.productInfo?.trim()) return asset.productInfo.trim();
  const profile = asset.productProfile;
  if (!profile) return "";
  return [
    profile.brandName,
    profile.category,
    profile.model,
    ...(profile.sellingPoints || []),
    profile.generationConstraints,
  ].filter(Boolean).join("；");
}

function buildStoryboardProductSubjects(
  args: Record<string, unknown>,
  topic: string,
  sourceAsset?: DigitalAssetItem,
): { subjects: VideoStoryboardSubjectPayload[]; primaryName?: string; sourceImageCount: number } {
  const explicitProductImages = controlOptionalStringArrayArgument(args, "productImages");
  const productImages = explicitProductImages.length
    ? explicitProductImages
    : sourceAsset
      ? selectVideoStoryboardAssetImages(sourceAsset)
      : [];
  const referenceImages = controlOptionalStringArrayArgument(args, "referenceImages");
  if (!productImages.length && !referenceImages.length) return { subjects: [], sourceImageCount: 0 };
  const name = controlOptionalStringArgument(args, "productName")
    || controlOptionalStringArgument(args, "product")
    || sourceAsset?.name
    || inferStoryboardProductSubjectName(args, topic);
  const productInfo = controlOptionalStringArgument(args, "productInfo")
    || controlOptionalStringArgument(args, "description")
    || storyboardAssetProductInfo(sourceAsset)
    || `来自数字资产或上传素材的商品参考图，用于锁定${name}的外观、结构比例、材质和品牌标识。`;
  const subjects: VideoStoryboardSubjectPayload[] = [];
  const usedImageUrls = new Set<string>();
  const primaryProductImage = productImages[0] || referenceImages[0];
  if (primaryProductImage) {
    usedImageUrls.add(primaryProductImage);
    subjects.push({
      name,
      type: "prop",
      description: productInfo,
      imageUrl: primaryProductImage,
    });
  }

  productImages.slice(1).forEach((imageUrl, index) => {
    if (usedImageUrls.has(imageUrl)) return;
    usedImageUrls.add(imageUrl);
    subjects.push({
      name: `${name}参考图${index + 2}`,
      type: "prop",
      description: productInfo,
      imageUrl,
    });
  });

  const referenceNames = controlOptionalStringArrayArgument(args, "referenceNames");
  const referenceTypes = controlOptionalStringArrayArgument(args, "referenceTypes");
  referenceImages.forEach((imageUrl, index) => {
    if (usedImageUrls.has(imageUrl)) return;
    usedImageUrls.add(imageUrl);
    const explicitType = normalizeVideoSubjectType(referenceTypes[index]);
    const inferredType = explicitType || inferReferenceSubjectType(topic, index);
    subjects.push({
      name: referenceNames[index] || defaultReferenceSubjectName(topic, inferredType, index),
      type: inferredType,
      description: `来自数字资产或上传素材的${defaultReferenceSubjectLabel(inferredType)}参考图，用于保持视频主体一致性。`,
      imageUrl,
    });
  });

  return {
    primaryName: subjects[0]?.name,
    subjects,
    sourceImageCount: productImages.length,
  };
}

function normalizeVideoSubjectType(value: string | undefined): VideoStoryboardSubjectPayload["type"] | undefined {
  const raw = (value || "").trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === "character" || raw === "person" || raw === "model" || raw === "真人" || raw === "模特" || raw === "人物") {
    return "character";
  }
  if (raw === "scene" || raw === "background" || raw === "场景" || raw === "环境") return "scene";
  if (raw === "prop" || raw === "product" || raw === "brand" || raw === "商品" || raw === "品牌" || raw === "道具") {
    return "prop";
  }
  return undefined;
}

function inferReferenceSubjectType(topic: string, index: number): VideoStoryboardSubjectPayload["type"] {
  const text = `${topic || ""} ${index + 1}`;
  if (/(模特|真人|人物|人像|角色|女|男|model|person|human|avatar)/i.test(text)) return "character";
  if (/(场景|环境|背景|空间|厨房|客厅|户外|scene|background|environment)/i.test(text)) return "scene";
  return "prop";
}

function defaultReferenceSubjectLabel(type: VideoStoryboardSubjectPayload["type"] | undefined): string {
  if (type === "character") return "人物/模特";
  if (type === "scene") return "场景";
  return "素材";
}

function defaultReferenceSubjectName(
  topic: string,
  type: VideoStoryboardSubjectPayload["type"] | undefined,
  index: number,
): string {
  if (type === "character") return `参考模特${index + 1}`;
  if (type === "scene") return `参考场景${index + 1}`;
  const brandLike = /(品牌|logo|标识|brand)/i.test(topic || "");
  return brandLike ? `参考品牌${index + 1}` : `参考素材${index + 1}`;
}

const VIDEO_WEBP_DATA_URL_RE = /^data:image\/(?:x-)?webp;base64,/i;
const VIDEO_LOCAL_ASSET_URL_RE = /^wodeappx-asset:\/\//i;

function videoImageUrlsFromAssetMention(ref: {
  coverImage?: string;
  productImages?: string[];
  assetImages?: string[];
  brandAssets?: string[];
  assetFile?: string;
  assetFileType?: string;
}): string[] {
  const urls = [
    ref.coverImage,
    ...(ref.productImages || []),
    ...(ref.assetImages || []),
    ...(ref.brandAssets || []),
    ref.assetFileType?.startsWith("image/") ? ref.assetFile : undefined,
  ].filter((url): url is string => Boolean(url?.trim()));
  return [...new Set(urls)];
}

function videoSubjectTypeFromAssetMention(ref: { kind?: string; name?: string }): VideoStoryboardSubjectPayload["type"] {
  const text = `${ref.kind || ""} ${ref.name || ""}`;
  if (/(真人|模特|人物|角色|人像|model|person|human|character)/i.test(text)) return "character";
  if (/(场景|环境|背景|空间|scene|background|environment)/i.test(text)) return "scene";
  return "prop";
}

function compactVideoAssetMatchText(value: string | undefined): string {
  return String(value || "").toLowerCase().replace(/\s+/g, "");
}

function rememberedVideoAssetMatchesAction(input: {
  ref: { id?: string; name?: string; kind?: string };
  actionText: string;
  subjectNames: string[];
}): boolean {
  const haystack = compactVideoAssetMatchText(input.actionText);
  const id = compactVideoAssetMatchText(input.ref.id);
  const name = compactVideoAssetMatchText(input.ref.name);
  if (id && haystack.includes(id)) return true;
  if (name && haystack.includes(name)) return true;
  return input.subjectNames.some((subjectName) => {
    const subject = compactVideoAssetMatchText(subjectName);
    return Boolean(subject && name && (subject.includes(name) || name.includes(subject)));
  });
}

function referenceImageUrlToElement(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode reference image"));
    image.src = url;
  });
}

async function normalizeVideoReferenceImageUrl(url: string): Promise<string> {
  const trimmed = url.trim();
  if (!VIDEO_WEBP_DATA_URL_RE.test(trimmed) && !VIDEO_LOCAL_ASSET_URL_RE.test(trimmed)) return trimmed;
  const image = await referenceImageUrlToElement(trimmed);
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) throw new Error("Reference image has no dimensions");
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Failed to prepare reference image");
  context.drawImage(image, 0, 0);
  return canvas.toDataURL("image/png");
}

async function buildRememberedVideoAssetSubjects(input: {
  args: Record<string, unknown>;
  topic: string;
  promptText: string;
  existingSubjects: VideoStoryboardSubjectPayload[];
}): Promise<VideoStoryboardSubjectPayload[]> {
  const remembered = listRememberedAssetMentions().slice(-16);
  if (!remembered.length) return [];
  const subjectNames = [
    ...input.existingSubjects.map((subject) => subject.name),
    ...controlOptionalStringArrayArgument(input.args, "referenceNames"),
  ].filter(Boolean);
  const actionText = [
    input.topic,
    input.promptText,
    JSON.stringify(input.args),
  ].join("\n");
  const usedUrls = new Set(input.existingSubjects.map((subject) => subject.imageUrl).filter(Boolean));
  const subjects: VideoStoryboardSubjectPayload[] = [];

  for (const ref of remembered) {
    if (!rememberedVideoAssetMatchesAction({ ref, actionText, subjectNames })) continue;
    const imageUrl = videoImageUrlsFromAssetMention(ref).find((url) => !usedUrls.has(url));
    if (!imageUrl) continue;
    const normalizedImageUrl = await normalizeVideoReferenceImageUrl(imageUrl);
    usedUrls.add(imageUrl);
    usedUrls.add(normalizedImageUrl);
    subjects.push({
      name: ref.name || "参考素材",
      type: videoSubjectTypeFromAssetMention(ref),
      description: ref.productInfo || ref.brandVoice || `来自 @${ref.name || "素材"} 的视频参考图。`,
      imageUrl: normalizedImageUrl,
    });
  }

  return subjects;
}

async function normalizeVideoSubjectImageUrls(
  subjects: VideoStoryboardSubjectPayload[],
): Promise<VideoStoryboardSubjectPayload[]> {
  return Promise.all(
    subjects.map(async (subject) => {
      const imageUrl = subject.imageUrl?.trim();
      if (!imageUrl) return subject;
      return {
        ...subject,
        imageUrl: await normalizeVideoReferenceImageUrl(imageUrl),
      };
    }),
  );
}

function sceneSubjectNames(scene: VideoStoryboardScenePayload): Set<string> {
  return new Set((scene.subjects || []).map((subject) => normalizeSubjectNameForVideo(subject.name)));
}

function attachStoryboardAssetReferences(
  scenes: VideoStoryboardScenePayload[],
  subjects: VideoStoryboardSubjectPayload[],
  options?: { primaryProductName?: string },
): {
  scenes: VideoStoryboardScenePayload[];
  subjects: VideoStoryboardSubjectPayload[];
  diagnostics: {
    imageSubjectCount: number;
    sceneCount: number;
    autoLinkedSceneCount: number;
    scenesMissingImageTagsBefore: number;
    primaryProductName?: string;
  };
} {
  const normalizedSubjects = dedupeStoryboardSubjects(subjects);
  const imageSubjects = normalizedSubjects.filter((subject) => Boolean(subject.imageUrl));
  const primaryKey = normalizeSubjectNameForVideo(options?.primaryProductName || "");
  let autoLinkedSceneCount = 0;
  let scenesMissingImageTagsBefore = 0;

  const nextScenes = scenes.map((scene) => {
    const beforePrompt = scene.prompt;
    let prompt = beforePrompt;
    const existingSceneSubjects = normalizeStoryboardSubjects(scene.subjects);
    const existingKeys = sceneSubjectNames({ ...scene, subjects: existingSceneSubjects });
    const selected: VideoStoryboardSubjectPayload[] = [];

    for (const subject of imageSubjects) {
      if (promptHasSubjectTag(beforePrompt, subject.name)) {
        selected.push(subject);
      } else if (promptMentionsSubject(beforePrompt, subject.name)) {
        selected.push(subject);
      } else if (existingKeys.has(normalizeSubjectNameForVideo(subject.name))) {
        selected.push(subject);
      }
    }

    const hasTaggedImageSubjectBefore = imageSubjects.some((subject) => promptHasSubjectTag(beforePrompt, subject.name));
    if (imageSubjects.length > 0 && !hasTaggedImageSubjectBefore) scenesMissingImageTagsBefore += 1;

    const hasAnySelectedImageSubject = selected.length > 0;
    const primarySubject = primaryKey
      ? imageSubjects.find((subject) => normalizeSubjectNameForVideo(subject.name) === primaryKey)
      : undefined;
    if (!hasAnySelectedImageSubject && primarySubject) {
      selected.push(primarySubject);
    } else if (!hasAnySelectedImageSubject && imageSubjects.length === 1) {
      selected.push(imageSubjects[0]);
    }

    for (const subject of selected) {
      prompt = tagSubjectInPrompt(prompt, subject);
    }
    if (prompt !== beforePrompt) autoLinkedSceneCount += 1;

    const nextSubjects = dedupeStoryboardSubjects([...existingSceneSubjects, ...selected]);
    const isProductBackedScene = selected.some((subject) => subject.type === "prop" && Boolean(subject.imageUrl));
    return {
      ...scene,
      prompt: isProductBackedScene ? addProductVideoQualityPrompt(prompt) : prompt,
      ...(nextSubjects.length ? { subjects: nextSubjects } : {}),
    };
  });

  return {
    scenes: nextScenes,
    subjects: normalizedSubjects,
    diagnostics: {
      imageSubjectCount: imageSubjects.length,
      sceneCount: scenes.length,
      autoLinkedSceneCount,
      scenesMissingImageTagsBefore,
      ...(options?.primaryProductName ? { primaryProductName: options.primaryProductName } : {}),
    },
  };
}

function normalizeDirectVideoTaskType(value: string): DirectVideoTaskType | undefined {
  const raw = value.trim().toLowerCase();
  if (!raw) return undefined;
  if (raw === "img2video" || raw === "image2vedio" || raw === "mage2video") return "image2video";
  if (raw === "text2vedio") return "text2video";
  if (raw === "text2video" || raw === "image2video" || raw === "firstlast" || raw === "omni" || raw === "avatar") {
    return raw;
  }
  return undefined;
}

/** MiniMax 引擎名（与 runtime-server PROVIDER_ALIASES 对齐）。 */
const MINIMAX_VIDEO_PROVIDER_NAMES = new Set(["minimax", "hailuo", "hailuoai", "hailuo-ai", "minimax-hailuo"]);

function resolveRequestedVideoProvider(args: Record<string, unknown>): string {
  return (
    controlOptionalStringArgument(args, "provider")
    || controlOptionalStringArgument(args, "engine")
    || "auto"
  ).trim().toLowerCase();
}

function isMiniMaxVideoProvider(provider: string): boolean {
  return MINIMAX_VIDEO_PROVIDER_NAMES.has(provider);
}

/** MiniMax-H3 单段上限（官方 4–15s）。 */
const MINIMAX_VIDEO_CLIP_MAX_SEC = 15;

function directVideoInputString(args: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) {
    const value = args[name];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function directVideoInputBoolean(args: Record<string, unknown>, ...names: string[]): boolean | undefined {
  for (const name of names) {
    if (!(name in args)) continue;
    const value = args[name];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
      if (normalized === "false" || normalized === "0" || normalized === "no") return false;
    }
  }
  return undefined;
}

function directVideoImageList(subjects: VideoStoryboardSubjectPayload[]): Array<{ image_url: string; name: string }> {
  const seen = new Set<string>();
  const list: Array<{ image_url: string; name: string }> = [];
  for (const subject of subjects) {
    const imageUrl = subject.imageUrl?.trim();
    if (!imageUrl || seen.has(imageUrl)) continue;
    seen.add(imageUrl);
    list.push({
      image_url: imageUrl,
      name: subject.name || defaultReferenceSubjectName("", subject.type, list.length),
    });
  }
  return list;
}

function normalizeDirectReferenceVideoUrls(args: Record<string, unknown>): string[] {
  const raw = controlOptionalStringArrayArgument(args, "referenceVideos");
  const https = raw.filter((url) => /^https?:\/\//i.test(url.trim()));
  return Array.from(new Set(https.map((url) => url.trim()))).slice(0, 3);
}

function buildDirectVideoRequestBody(input: {
  args: Record<string, unknown>;
  prompt: string;
  ratio: string;
  durationSec: number;
  subjects: VideoStoryboardSubjectPayload[];
  topic: string;
}): {
  taskType: DirectVideoTaskType;
  provider: string;
  body: Record<string, unknown>;
  imageSubjectCount: number;
  referenceVideoCount: number;
} {
  const imageList = directVideoImageList(input.subjects);
  const referenceVideos = normalizeDirectReferenceVideoUrls(input.args);
  const explicitTaskType = normalizeDirectVideoTaskType(directVideoInputString(input.args, "taskType", "videoTaskType"));
  const taskType = explicitTaskType
    || (referenceVideos.length > 0
      ? "omni"
      : imageList.length > 1
        ? "omni"
        : imageList.length === 1
          ? "image2video"
          : "text2video");
  const provider = directVideoInputString(input.args, "provider", "engine") || "auto";
  const mode = directVideoInputString(input.args, "mode", "qualityMode");
  const model = directVideoInputString(input.args, "model", "modelId");
  const resolution = directVideoInputString(input.args, "resolution");
  const negativePrompt = directVideoInputString(input.args, "negativePrompt");
  const watermark = directVideoInputBoolean(input.args, "watermark");
  const soundEnabled = directVideoInputBoolean(input.args, "soundEnabled", "generateAudio", "audioEnabled");

      const videoInput: Record<string, unknown> = {
        prompt: input.prompt,
        duration: input.durationSec,
        aspectRatio: input.ratio,
      };

  const voiceoverText = [
    directVideoInputString(input.args, "voiceoverText"),
    directVideoInputString(input.args, "dialogue"),
    directVideoInputString(input.args, "narration"),
  ].find(Boolean);
  if (voiceoverText) {
    videoInput.voiceoverText = voiceoverText;
    if (!String(videoInput.prompt).includes(voiceoverText)) {
      videoInput.prompt = `${String(videoInput.prompt).trimEnd()}\n对白/旁白：${voiceoverText}`;
    }
  }

  if (mode) videoInput.mode = mode;
  if (model) videoInput.model = model;
  if (resolution) videoInput.resolution = resolution;
  if (negativePrompt) videoInput.negativePrompt = negativePrompt;
  if (watermark !== undefined) videoInput.watermark = watermark;
  if (soundEnabled !== undefined) {
    videoInput.soundEnabled = soundEnabled;
    videoInput.generateAudio = soundEnabled;
  }
  if (referenceVideos.length) {
    videoInput.referenceVideos = referenceVideos;
  }

  if (imageList.length) {
    videoInput.imageList = imageList;
    if (taskType === "firstlast") {
      videoInput.imageUrl = imageList[0]?.image_url;
      videoInput.image = imageList[0]?.image_url;
      if (imageList.length > 1) {
        videoInput.lastFrameUrl = imageList[1]?.image_url;
        videoInput.imageTail = imageList[1]?.image_url;
      }
    } else if (taskType === "image2video") {
      videoInput.imageUrl = imageList[0]?.image_url;
      if (imageList.length > 1) {
        videoInput.referenceImages = imageList.slice(1).map((item) => item.image_url);
      }
    }
  }

  const explicitFirst =
    directVideoInputString(input.args, "imageUrl", "image", "firstFrameUrl")
    || (typeof videoInput.imageUrl === "string" ? videoInput.imageUrl : undefined);
  const explicitLast =
    directVideoInputString(input.args, "lastFrameUrl", "imageTail", "tailImageUrl")
    || (typeof videoInput.lastFrameUrl === "string" ? videoInput.lastFrameUrl : undefined);
  if (explicitFirst) {
    videoInput.imageUrl = explicitFirst;
    videoInput.image = explicitFirst;
  }
  if (explicitLast) {
    videoInput.lastFrameUrl = explicitLast;
    videoInput.imageTail = explicitLast;
  }

  return {
    taskType,
    provider,
    imageSubjectCount: imageList.length,
    referenceVideoCount: referenceVideos.length,
    body: {
      taskType,
      provider,
      input: videoInput,
      clientRequestId: `wodeappx-video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      extensions: {
        source: "wodeappx-chat",
        topic: input.topic,
      },
    },
  };
}

async function submitDirectVideoTask(body: Record<string, unknown>): Promise<DirectVideoTaskResponse> {
  return requestWodeAppRuntimeJson<DirectVideoTaskResponse>(
    "/video/tasks",
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    180000,
  );
}

async function readDirectVideoTaskStatus(taskId: string): Promise<DirectVideoTaskResponse> {
  return requestWodeAppRuntimeJson<DirectVideoTaskResponse>(
    `/video/tasks/${encodeURIComponent(taskId)}`,
    { method: "GET" },
    90000,
  );
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isDirectVideoTaskTerminalStatus(status: string | undefined): "succeed" | "failed" | null {
  const raw = (status || "").trim().toLowerCase();
  if (!raw) return null;
  if (
    raw === "succeed"
    || raw === "succeeded"
    || raw === "success"
    || raw === "completed"
    || raw === "complete"
    || raw === "done"
  ) {
    return "succeed";
  }
  if (
    raw === "failed"
    || raw === "fail"
    || raw === "error"
    || raw === "timeout"
    || raw === "cancelled"
    || raw === "canceled"
    || raw === "payment_failed"
  ) {
    return "failed";
  }
  return null;
}

/** Poll /video/tasks/:id until terminal status, videoUrl, or timeout. */
async function pollDirectVideoTaskUntilDone(input: {
  taskId: string;
  initial?: DirectVideoTaskResponse["data"];
  timeoutMs: number;
  intervalMs?: number;
  onProgress?: (status: string, elapsedMs: number) => void;
}): Promise<{
  data: NonNullable<DirectVideoTaskResponse["data"]>;
  timedOut: boolean;
  polls: number;
}> {
  const startedAt = Date.now();
  const intervalMs = Math.max(2000, input.intervalMs ?? 5000);
  let polls = 0;
  let latest: NonNullable<DirectVideoTaskResponse["data"]> = {
    ...(input.initial || {}),
    taskId: input.initial?.taskId || input.taskId,
    status: input.initial?.status || "submitted",
  };

  while (Date.now() - startedAt < input.timeoutMs) {
    const terminal = isDirectVideoTaskTerminalStatus(latest.status);
    if (terminal === "succeed" && latest.videoUrl) {
      return { data: latest, timedOut: false, polls };
    }
    if (terminal === "failed") {
      return { data: latest, timedOut: false, polls };
    }
    if (terminal === "succeed" && !latest.videoUrl) {
      // Rare: marked succeed without URL yet — keep polling briefly for URL.
    }

    await sleepMs(intervalMs);
    polls += 1;
    try {
      const response = await readDirectVideoTaskStatus(input.taskId);
      if (response.success !== false && response.data) {
        latest = {
          ...latest,
          ...response.data,
          taskId: response.data.taskId || input.taskId,
        };
      }
    } catch {
      // Transient status errors should not abort the wait loop.
    }
    input.onProgress?.(String(latest.status || "polling"), Date.now() - startedAt);
  }

  return { data: latest, timedOut: true, polls };
}


export type WodeAppSessionControlActionDeps = {
  enabled: boolean;
  modelUnavailable?: boolean;
  workspaceRoot?: string;
  sessionId?: string;
  handleStartBuiltinAgent: (
    agent: WodeAppBuiltinAgent,
    options?: { displayText?: string; autoSend?: boolean },
  ) => void;
};

export const WODEAPP_DIGITAL_ASSET_CONTROL_ACTION_IDS = [
  "wodeapp.auth.status",
  "wodeapp.assets.capabilities",
  "wodeapp.assets.list",
  "wodeapp.assets.delete",
  "wodeapp.assets.dedupe.preview",
  "wodeapp.assets.dedupe",
  "wodeapp.brand.save",
  "wodeapp.product.save",
  "wodeapp.image_asset.save",
  "wodeapp.prompt.save",
  "wodeapp.generation_history.save",
  "wodeapp.batch_image.open",
  "wodeapp.video.generate",
  "wodeapp.video.status",
  "wodeapp.video_storyboard.open",
  "wodeapp.video_storyboard.update",
] as const;

function buildDigitalAssetsCapabilitiesControlAction(enabled: boolean): OpenworkControlAction {
  return {
    ...directActionMetadata("wodeapp.assets.capabilities"),
    disabled: !enabled,
    execute: async () => ({
      ok: true,
      operation: "digital_asset_capabilities",
      code: "ready",
      ...wodeAppDigitalAssetCapabilities(),
      userVisibleSummary: "商品与素材是 WodeAppX 的内置基础能力，详细契约已返回。",
    }),
  };
}

function buildWodeAppAuthStatusControlAction(enabled: boolean): OpenworkControlAction {
  return {
    ...directActionMetadata("wodeapp.auth.status"),
    disabled: !enabled,
    execute: async (_args, helpers) => {
      helpers.setNarration("正在检查 WodeApp 账户");
      return readWodeAppAuthStatusForAction();
    },
  };
}

function buildDigitalAssetsListControlAction(enabled: boolean): OpenworkControlAction {
  return {
    ...directActionMetadata("wodeapp.assets.list"),
    previewArgs: { kind: "品牌库", q: "苏泊尔", limit: 20 },
    disabled: !enabled,
    execute: async (args) => {
      await ensureLocalDigitalAssetsLoaded();
      const kind = normalizeDigitalAssetKind(controlOptionalStringArgument(args, "kind"));
      const q =
        controlOptionalStringArgument(args, "q")
        || controlOptionalStringArgument(args, "query")
        || controlOptionalStringArgument(args, "name");
      const limit = controlOptionalNumberArgument(args, "limit", 50);
      const assets = listDigitalAssetsForAgent({ kind, q, limit });
      return {
        ok: true,
        count: assets.length,
        assets: assets.map(compactDigitalAssetForAction),
        userVisibleSummary: assets.length
          ? `找到 ${assets.length} 条数字资产。`
          : "没有找到匹配的数字资产。",
      };
    },
  };
}

function buildDigitalAssetsDeleteControlAction(enabled: boolean): OpenworkControlAction {
  return {
    ...directActionMetadata("wodeapp.assets.delete"),
    previewArgs: { assetIds: ["local-brand-1783505002452"] },
    disabled: !enabled,
    execute: async (args, helpers) => {
      const assetIds = [
        controlOptionalStringArgument(args, "assetId"),
        ...controlOptionalStringArrayArgument(args, "assetIds"),
        ...controlOptionalStringArrayArgument(args, "ids"),
      ].filter(Boolean);
      if (!assetIds.length) return { ok: false, error: "assetId or assetIds is required" };
      helpers.setNarration(`正在删除 ${assetIds.length} 条本地数字资产`);
      const result = await deleteLocalDigitalAssets(assetIds);
      return {
        ok: true,
        deletedCount: result.deleted.length,
        deleted: result.deleted.map(compactDigitalAssetForAction),
        skipped: result.skipped,
        userVisibleSummary: result.deleted.length
          ? `已删除 ${result.deleted.length} 条本地数字资产。${result.skipped.length ? `有 ${result.skipped.length} 条未删除。` : ""}`
          : `没有删除任何资产。${result.skipped.length ? result.skipped.map((item) => item.reason).join("；") : ""}`,
      };
    },
  };
}

function buildDigitalAssetsDedupeControlAction(
  enabled: boolean,
  mode: "preview" | "delete",
): OpenworkControlAction {
  const previewOnly = mode === "preview";
  return {
    ...directActionMetadata(
      previewOnly ? "wodeapp.assets.dedupe.preview" : "wodeapp.assets.dedupe",
    ),
    previewArgs: { kind: "品牌库", q: "苏泊尔", keep: "newest" },
    disabled: !enabled,
    execute: async (args, helpers) => {
      const kind = normalizeDigitalAssetKind(controlOptionalStringArgument(args, "kind"));
      const q =
        controlOptionalStringArgument(args, "q")
        || controlOptionalStringArgument(args, "query")
        || controlOptionalStringArgument(args, "name");
      const keepRaw = controlOptionalStringArgument(args, "keep").toLowerCase();
      const keep = keepRaw === "oldest" ? "oldest" : "newest";
      helpers.setNarration(previewOnly ? "正在预览数字资产重复项" : "正在清理本地数字资产重复项");
      const result = await dedupeLocalDigitalAssets({ kind, q, keep, dryRun: previewOnly });
      return {
        ok: true,
        preview: previewOnly,
        groupCount: result.groups.length,
        deletedCount: result.deleted.length,
        groups: result.groups.map((group) => ({
          key: group.key,
          kept: compactDigitalAssetForAction(group.kept),
          duplicates: group.duplicates.map(compactDigitalAssetForAction),
        })),
        deleted: result.deleted.map(compactDigitalAssetForAction),
        skipped: result.skipped,
        userVisibleSummary: result.groups.length
          ? previewOnly
            ? `找到 ${result.groups.length} 组重复数字资产，可确认后清理。`
            : `已清理 ${result.deleted.length} 条重复本地数字资产。`
          : "没有发现匹配的重复本地数字资产。",
      };
    },
  };
}

function buildBrandSaveControlAction(enabled: boolean): OpenworkControlAction {
  return {
    ...directActionMetadata("wodeapp.brand.save"),
    previewArgs: { name: "小匠视觉", sourceText: "杭州小匠文化创意有限公司，专注 CG 创意策划与执行..." },
    disabled: !enabled,
    execute: async (args, helpers) => {
      const name = controlOptionalStringArgument(args, "name");
      const sourceText = controlOptionalStringArgument(args, "sourceText");
      if (!name || !sourceText) {
        return { ok: false, error: "name and sourceText are required" };
      }
      helpers.setNarration(`正在保存品牌「${name}」到数字资产`);
      const saved = await saveBrandResearchAsset({
        name,
        sourceText,
        voice: controlOptionalStringArgument(args, "voice") || undefined,
        rules: controlOptionalStringArgument(args, "rules") || undefined,
        colors: controlOptionalStringArrayArgument(args, "colors"),
      });
      rememberAssetMention(digitalAssetToMention(saved));
      return { ok: true, assetId: saved.id, name: saved.name, kind: saved.kind };
    },
  };
}

function buildNeedUserSelectError(
  operation: "product_save" | "image_asset_save",
  candidates: SessionProductImageCandidate[],
  error?: string,
) {
  return {
    ok: false as const,
    contractVersion: WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
    operation,
    code: "NEED_USER_SELECT" as const,
    verified: false as const,
    candidates: candidates.map((item) => ({ id: item.imageId, file: item.filename })),
    data: { code: "NEED_USER_SELECT" },
    error: error
      || `本轮有 ${candidates.length} 张候选图，超过 12 张上限。请只问用户一次，选最多 12 张后传 selectedImageIds。`,
    userVisibleSummary: "候选图超过 12 张，需要用户选择后再保存。",
  };
}

function buildProductSaveControlAction(enabled: boolean, sessionId?: string): OpenworkControlAction {
  return {
    ...directActionMetadata("wodeapp.product.save"),
    previewArgs: {
      name: "蓝牙耳机 Pro",
      productInfo: "入耳式降噪耳机，黑色哑光机身。",
      selectedImageIds: ["img_01", "img_02", "img_03"],
    },
    disabled: !enabled,
    execute: async (args, helpers) => {
      const inputRecord = args && typeof args === "object" && !Array.isArray(args)
        ? args as Record<string, unknown>
        : {};
      const requestedAssetId = controlOptionalStringArgument(args, "assetId")
        || controlOptionalStringArgument(args, "sourceAssetId");
      let existingProduct: DigitalAssetItem | undefined;
      if (requestedAssetId) {
        await ensureLocalDigitalAssetsLoaded();
        existingProduct = listDigitalAssetsForAgent({ kind: "商品库", limit: 200 })
          .find((asset) => asset.id === requestedAssetId);
        if (!existingProduct) {
          return {
            ok: false,
            contractVersion: WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
            operation: "product_save",
            code: "not_found",
            verified: false,
            error: `商品资产 ${requestedAssetId} 不存在，未执行保存。`,
          };
        }
      }

      const name = controlOptionalStringArgument(args, "name") || existingProduct?.name || "";
      if (!name) {
        return {
          ok: false,
          contractVersion: WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
          operation: "product_save",
          code: "invalid_input",
          verified: false,
          error: "name is required",
        };
      }
      const productInfo = (
        controlOptionalStringArgument(args, "productInfo")
        || controlOptionalStringArgument(args, "description")
        || controlOptionalStringArgument(args, "info")
        || existingProduct?.productInfo
        || ""
      );
      const rawProductProfile = inputRecord.productProfile;
      const productProfile = rawProductProfile && typeof rawProductProfile === "object" && !Array.isArray(rawProductProfile)
        ? rawProductProfile as import("./digital-assets-data").ProductAssetProfile
        : existingProduct?.productProfile;

      const selectedImageIdsInput = controlOptionalStringArrayArgument(args, "selectedImageIds");
      const legacyProductImages = controlOptionalStringArrayArgument(args, "productImages");
      const rawMediaEarly = Array.isArray(inputRecord.media) ? inputRecord.media : [];
      const mediaImageIds = rawMediaEarly
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
        .map((item) => typeof item.imageId === "string" ? item.imageId.trim() : "")
        .filter(Boolean);
      let selectedImageIds = [...selectedImageIdsInput];
      if (!selectedImageIds.length && mediaImageIds.length) {
        selectedImageIds = [...new Set(mediaImageIds)].slice(0, 12);
      }
      let productImages: string[] = [];
      const hasSessionCandidates = Boolean(sessionId && listCurrentSessionProductImageCandidates(sessionId).length);

      if (selectedImageIds.length || (hasSessionCandidates && !legacyProductImages.length)) {
        if (!sessionId) {
          return {
            ok: false,
            contractVersion: WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
            operation: "product_save",
            code: "invalid_input",
            verified: false,
            error: "selectedImageIds 需要当前会话上下文，未保存。",
          };
        }
        helpers.setNarration(`正在上传并绑定「${name}」的会话图片`);
        const materialized = await resolveAndMaterializeSessionImages({
          sessionId,
          selectedImageIds,
          autoSelectFromCurrentTurn: !selectedImageIds.length,
        });
        if (!materialized.ok) {
          if (materialized.code === "NEED_USER_SELECT") {
            return buildNeedUserSelectError(
              "product_save",
              materialized.candidates || listCurrentSessionProductImageCandidates(sessionId),
              materialized.error,
            );
          }
          return {
            ok: false,
            contractVersion: WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
            operation: "product_save",
            code: materialized.code,
            verified: false,
            missingImageIds: materialized.missingImageIds,
            error: `${materialized.error} 商品未保存。`,
            userVisibleSummary: materialized.code === "UNKNOWN_IMAGE_ID"
              ? "选中的图片 ID 无效，商品未保存。"
              : "图片上传或落盘失败，未保存。",
          };
        }
        selectedImageIds = materialized.selectedImageIds;
        productImages = materialized.urls;
      } else if (legacyProductImages.length) {
        helpers.setNarration(`正在上传并绑定「${name}」的 ${legacyProductImages.length} 张图片`);
        const materialized = await materializeProductImageUrls(legacyProductImages, { sessionId });
        if (materialized.failed.length || !materialized.urls.length) {
          return {
            ok: false,
            contractVersion: WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
            operation: "product_save",
            code: "UPLOAD_OR_PERSIST_FAILED",
            verified: false,
            error: `有 ${materialized.failed.length || legacyProductImages.length} 张图无法落成可用地址，商品未保存。`,
            userVisibleSummary: "图片上传或落盘失败，未保存。",
          };
        }
        productImages = materialized.urls;
      } else if (existingProduct?.productImages?.length) {
        productImages = [...existingProduct.productImages];
      }

      const rawAssetFiles = Array.isArray(inputRecord.assetFiles) ? inputRecord.assetFiles : [];
      const assetFiles: DigitalAssetFileRef[] = rawAssetFiles
        .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
        .map((item) => {
          const url = typeof item.url === "string" ? item.url.trim() : "";
          const fileName = typeof item.name === "string" ? item.name.trim() : "";
          const type = typeof item.type === "string" && item.type.trim() ? item.type.trim() : "application/octet-stream";
          const mediaType = ["image", "video", "audio", "document", "other"].includes(String(item.mediaType))
            ? item.mediaType as DigitalAssetFileRef["mediaType"]
            : undefined;
          const integrityStatus = ["verified", "unverified", "invalid"].includes(String(item.integrityStatus))
            ? item.integrityStatus as DigitalAssetFileRef["integrityStatus"]
            : undefined;
          return {
            url,
            name: fileName,
            type,
            size: typeof item.size === "number" && Number.isFinite(item.size) && item.size >= 0 ? item.size : 0,
            mediaType,
            contentHash: typeof item.contentHash === "string" ? item.contentHash.trim() || undefined : undefined,
            integrityStatus,
            processingStatus: "ready" as const,
          };
        })
        .filter((file) => file.url && file.name);
      const effectiveAssetFiles = Object.prototype.hasOwnProperty.call(inputRecord, "assetFiles")
        ? assetFiles
        : [...(existingProduct?.assetFiles || [])];
      if (rawAssetFiles.length !== assetFiles.length) {
        return {
          ok: false,
          contractVersion: WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
          operation: "product_save",
          code: "validation_failed",
          verified: false,
          error: "assetFiles 结构无效；会话图片请用 selectedImageIds。商品未保存。",
        };
      }

      const durableImageError = validateDurableProductImageUrls(productImages);
      if (durableImageError) {
        return {
          ok: false,
          contractVersion: WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
          operation: "product_save",
          code: "UPLOAD_OR_PERSIST_FAILED",
          verified: false,
          error: durableImageError,
          invalidProductImages: productImages.filter((url) => !isDurableProductImageUrl(url.trim())),
        };
      }
      if (!productInfo && !productProfile && !productImages.length && !effectiveAssetFiles.length) {
        return {
          ok: false,
          contractVersion: WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
          operation: "product_save",
          code: "invalid_input",
          verified: false,
          error: "至少需要 productInfo、productProfile、selectedImageIds 或 assetFiles 之一。",
        };
      }

      const rawMedia = Array.isArray(inputRecord.media) ? inputRecord.media : [];
      const mediaNameByImageId = new Map<string, string>();
      const mediaNameByUrl = new Map<string, string>();
      for (const item of rawMedia) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const record = item as Record<string, unknown>;
        const mediaName = typeof record.name === "string" ? record.name.trim() : "";
        const imageId = typeof record.imageId === "string" ? record.imageId.trim() : "";
        const url = typeof record.url === "string" ? record.url.trim() : "";
        if (mediaName && imageId) mediaNameByImageId.set(imageId, mediaName);
        if (mediaName && url) mediaNameByUrl.set(url, mediaName);
      }
      const media = productImages.map((url, index) => {
        const imageId = selectedImageIds[index] || "";
        const nameFromId = imageId ? mediaNameByImageId.get(imageId) : undefined;
        const nameFromUrl = mediaNameByUrl.get(url);
        return {
          url,
          name: nameFromId || nameFromUrl || undefined,
        };
      });

      helpers.setNarration(`正在保存商品「${name}」`);
      const saved = await saveProductResearchAsset({
        assetId: existingProduct?.id,
        name,
        productInfo: productInfo || existingProduct?.productInfo || name,
        productProfile,
        productImages,
        media: media.some((item) => item.name) ? media : undefined,
        assetFiles: effectiveAssetFiles.length ? effectiveAssetFiles : undefined,
      });
      const savedImages = saved.productImages || [];
      if (productImages.length && savedImages.length !== productImages.length) {
        return {
          ok: false,
          contractVersion: WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
          operation: "product_save",
          code: "SAVE_VERIFY_FAILED",
          verified: false,
          error: `保存校验失败：期望 ${productImages.length} 张图，实际 ${savedImages.length} 张。`,
          userVisibleSummary: "商品保存校验失败。",
        };
      }
      // Keep session image IDs resolvable after save so later turns can still bind img_XX.
      // New uploads call beginSessionProductImageTurn and reset the current-turn candidate set.
      const httpsCount = savedImages.filter((url) => /^https:\/\//i.test(url)).length;
      const localCount = savedImages.length - httpsCount;
      return {
        ok: true,
        contractVersion: WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
        operation: "product_save",
        code: "ok",
        verified: true,
        assetId: saved.id,
        name: saved.name,
        kind: saved.kind,
        imageIds: selectedImageIds,
        productImages: savedImages,
        productImageCount: savedImages.length,
        remoteReady: localCount === 0,
        imageStorage: { httpsCount, localCount },
        fileCount: saved.assetFiles?.length || 0,
        userVisibleSummary: savedImages.length
          ? localCount > 0
            ? `商品已保存；其中 ${localCount} 张仅本机可用，远端任务前需再同步。`
            : "商品已保存。"
          : "商品已保存。",
      };
    },
  };
}

function buildImageAssetSaveControlAction(enabled: boolean, sessionId?: string): OpenworkControlAction {
  return {
    ...directActionMetadata("wodeapp.image_asset.save"),
    previewArgs: {
      name: "通勤模特半身参考",
      selectedImageIds: ["img_02", "img_05"],
      notes: "竖屏半身，自然光",
    },
    disabled: !enabled,
    execute: async (args, helpers) => {
      const name = controlOptionalStringArgument(args, "name");
      const selectedImageIdsInput = controlOptionalStringArrayArgument(args, "selectedImageIds");
      let imageUrls = controlOptionalStringArrayArgument(args, "imageUrls");
      let selectedImageIds = [...selectedImageIdsInput];
      const notes = controlOptionalStringArgument(args, "notes");
      const assetId = controlOptionalStringArgument(args, "assetId");
      const requireHttps = controlOptionalBooleanArgument(args, "requireHttps", false);

      if (!name) {
        return {
          ok: false,
          contractVersion: WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
          operation: "image_asset_save",
          code: "invalid_input",
          verified: false,
          error: "name is required",
        };
      }

      if (selectedImageIdsInput.length || (!imageUrls.length && sessionId && listCurrentSessionProductImageCandidates(sessionId).length)) {
        if (!sessionId) {
          return {
            ok: false,
            contractVersion: WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
            operation: "image_asset_save",
            code: "invalid_input",
            verified: false,
            error: "selectedImageIds 需要当前会话上下文，未保存。",
          };
        }
        helpers.setNarration(`正在上传并保存图片素材「${name}」`);
        const materializedIds = await resolveAndMaterializeSessionImages({
          sessionId,
          selectedImageIds: selectedImageIdsInput,
          autoSelectFromCurrentTurn: !selectedImageIdsInput.length && !imageUrls.length,
        });
        if (!materializedIds.ok) {
          if (materializedIds.code === "NEED_USER_SELECT") {
            return buildNeedUserSelectError(
              "image_asset_save",
              materializedIds.candidates || listCurrentSessionProductImageCandidates(sessionId),
              materializedIds.error,
            );
          }
          return {
            ok: false,
            recoverable: true,
            errorKind: "execution",
            contractVersion: WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
            operation: "image_asset_save",
            code: materializedIds.code,
            verified: false,
            missingImageIds: materializedIds.missingImageIds,
            error: materializedIds.error,
            status: "image_materialize_failed",
            data: {
              code: materializedIds.code,
              failed: materializedIds.failed,
            },
            userVisibleSummary: "图片素材未能物化，未写入数字资产。",
          };
        }
        selectedImageIds = materializedIds.selectedImageIds;
        imageUrls = materializedIds.urls;
        if (requireHttps && materializedIds.httpsCount !== imageUrls.length) {
          return {
            ok: false,
            recoverable: true,
            errorKind: "execution",
            contractVersion: WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
            operation: "image_asset_save",
            code: "validation_failed",
            verified: false,
            error: "图片仅落成本地地址，尚未获得 HTTPS。远端视频分镜不能使用本地图；请确认已登录并可上传后重试。",
            status: "image_assets_not_cloud_synced",
            data: {
              code: "IMAGE_ASSETS_NOT_CLOUD_SYNCED",
              localUrls: materializedIds.urls,
            },
            userVisibleSummary: "图片未能上传为 HTTPS，未写入可供视频分镜使用的素材。",
          };
        }
      } else if (!imageUrls.length) {
        return {
          ok: false,
          contractVersion: WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
          operation: "image_asset_save",
          code: "invalid_input",
          verified: false,
          error: "至少需要 selectedImageIds 或 imageUrls 之一。",
        };
      } else {
        const inlineDataUrls = imageUrls.filter((url) => /^data:image\//i.test(url.trim()));
        if (inlineDataUrls.length) {
          return {
            ok: false,
            recoverable: true,
            errorKind: "execution",
            contractVersion: WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
            operation: "image_asset_save",
            code: "invalid_input",
            verified: false,
            error: `禁止在 imageUrls 中传入 data:image base64（检测到 ${inlineDataUrls.length} 项）。请改传 selectedImageIds、附件短文件名或 https://。`,
            status: "inline_image_payload_rejected",
            data: {
              code: "INLINE_IMAGE_PAYLOAD_REJECTED",
              fallbackTool: "wodeapp_assets_list",
            },
            userVisibleSummary: "图片素材保存已拒绝内联 base64。请只传 selectedImageIds、短 HTTPS 或附件文件名。",
          };
        }

        const invalidImages = imageUrls.filter(isClearlyNonImageAssetUrl);
        if (invalidImages.length) {
          return {
            ok: false,
            contractVersion: WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
            operation: "image_asset_save",
            code: "validation_failed",
            verified: false,
            error: "imageUrls 只能包含图片引用；检测到视频、音频或文档地址。",
          };
        }

        helpers.setNarration(`正在保存图片素材「${name}」并上传云端`);
        const materialized = await materializeProductImageUrls(imageUrls, { sessionId });
        if (materialized.failed.length || !materialized.urls.length) {
          return {
            ok: false,
            recoverable: true,
            errorKind: "execution",
            contractVersion: WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
            operation: "image_asset_save",
            code: "validation_failed",
            verified: false,
            error: `有 ${materialized.failed.length || imageUrls.length} 张图片无法落成可用地址。请确认本轮仍保留上传附件，或改用已有 https:// 链接。`,
            status: "image_materialize_failed",
            data: {
              code: "IMAGE_MATERIALIZE_FAILED",
              failed: materialized.failed,
            },
            userVisibleSummary: "图片素材未能物化，未写入数字资产。",
          };
        }
        imageUrls = materialized.urls;
        if (requireHttps && materialized.httpsCount !== imageUrls.length) {
          return {
            ok: false,
            recoverable: true,
            errorKind: "execution",
            contractVersion: WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
            operation: "image_asset_save",
            code: "validation_failed",
            verified: false,
            error: "图片仅落成本地地址，尚未获得 HTTPS。远端视频分镜不能使用本地图；请确认已登录并可上传后重试。",
            status: "image_assets_not_cloud_synced",
            data: {
              code: "IMAGE_ASSETS_NOT_CLOUD_SYNCED",
              localUrls: materialized.urls,
            },
            userVisibleSummary: "图片未能上传为 HTTPS，未写入可供视频分镜使用的素材。",
          };
        }
      }

      if (assetId) {
        await ensureLocalDigitalAssetsLoaded();
        const existing = listDigitalAssetsForAgent({ kind: "图片", limit: 200 })
          .find((asset) => asset.id === assetId);
        if (!existing) {
          return {
            ok: false,
            contractVersion: WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
            operation: "image_asset_save",
            code: "not_found",
            verified: false,
            error: `图片素材 ${assetId} 不存在，未执行保存。`,
          };
        }
      }

      const saved = await saveImageLibraryAsset({
        assetId: assetId || undefined,
        name,
        imageUrls,
        notes: notes || undefined,
      });
      rememberAssetMention(digitalAssetToMention(saved));
      const httpsUrls = (saved.assetImages || []).filter((url) => /^https:\/\//i.test(url));
      const localOnlyCount = (saved.assetImages || []).length - httpsUrls.length;

      return {
        ok: true,
        contractVersion: WODEAPP_DIGITAL_ASSET_CONTRACT_VERSION,
        operation: "image_asset_save",
        code: assetId ? "updated" : "saved",
        verified: true,
        inputCount: imageUrls.length,
        savedCount: 1,
        duplicateCount: 0,
        rejectedCount: 0,
        assetIds: [saved.id],
        actualNames: [saved.name],
        assetId: saved.id,
        name: saved.name,
        imageIds: selectedImageIds,
        imageUrls: saved.assetImages || [],
        httpsImageUrls: httpsUrls,
        httpsCount: httpsUrls.length,
        localOnlyCount,
        remoteReady: localOnlyCount === 0,
        userVisibleSummary: localOnlyCount > 0
          ? `图片素材已保存；其中 ${localOnlyCount} 张仅本机可用，远端任务前需再同步。`
          : "图片素材已保存。",
      };
    },
  };
}
function buildPromptSaveControlAction(enabled: boolean): OpenworkControlAction {
  return {
    ...directActionMetadata("wodeapp.prompt.save"),
    previewArgs: {
      name: "电商主图 · 白底棚拍",
      promptText: "专业电商白底棚拍，产品居中，柔和顶光，干净阴影，4K 细节。",
      promptCategory: "产品图",
      tags: ["白底", "主图", "电商"],
    },
    disabled: !enabled,
    execute: async (args, helpers) => {
      const name = controlOptionalStringArgument(args, "name");
      const promptText = controlOptionalStringArgument(args, "promptText");
      if (!name || !promptText) {
        return { ok: false, error: "name and promptText are required" };
      }
      helpers.setNarration(`正在保存提示词「${name}」到数字资产`);
      const saved = await savePromptResearchAsset({
        name,
        promptText,
        promptCategory: controlOptionalStringArgument(args, "promptCategory") || undefined,
        tags: controlOptionalStringArrayArgument(args, "tags"),
      });
      rememberAssetMention(digitalAssetToMention(saved));
      return { ok: true, assetId: saved.id, name: saved.name, kind: saved.kind };
    },
  };
}

function buildBatchImageControlAction(
  enabled: boolean,
  modelUnavailable: boolean | undefined,
  mountedSessionId?: string,
): OpenworkControlAction {
  return {
    ...directActionMetadata("wodeapp.batch_image.open"),
    previewArgs: {
      prompt: "为某品牌蓝牙耳机生成天猫 1:1 商品投放素材套图，包含角度、质感氛围、细节、场景和卖点图，不重复生成白底原图",
      productName: "蓝牙耳机 Pro",
      productInfo: "入耳式降噪耳机，主打通勤与运动场景。",
      productImages: ["https://assets.example.com/product.png"],
      referenceImages: ["https://assets.example.com/ref.png"],
      selectedCreativeTypes: ["product-photo", "brand-campaign", "selling-point"],
      iterCount: 3,
      activeMode: "full",
    },
    disabled: !enabled || Boolean(modelUnavailable),
    execute: async (args, helpers) => {
      const actionStartedAt = Date.now();
      const abilityProjects = readWodeAppAbilityProjects();
      const agent = findWodeAppBuiltinAgent("visual-generation", abilityProjects);
      if (!agent) {
        console.error(`${BATCH_IMAGE_ACTION_LOG_PREFIX} unavailable`, {
          elapsedMs: batchImageActionElapsedMs(actionStartedAt),
          reason: "visual-generation agent is unavailable",
          abilityProjects: abilityProjects.length,
        });
        return { ok: false, error: "visual-generation agent is unavailable" };
      }
      const abilityProject = matchAbilityProject(agent, abilityProjects);
      const prompt =
        controlOptionalStringArgument(args, "prompt")
        || "为我的商品自动出主图和场景图，需要的话继续做成视频。";
      const productName =
        controlOptionalStringArgument(args, "productName")
        || inferProductNameFromPrompt(prompt)
        || "AppX 商品主图任务";
      const productInfo = controlOptionalStringArgument(args, "productInfo") || prompt;
      const productImages = controlOptionalStringArrayArgument(args, "productImages");
      const referenceImages = controlOptionalStringArrayArgument(args, "referenceImages");
      const sourceAssetId = controlOptionalStringArgument(args, "sourceAssetId");
      const taskProductImages = productImages.length ? productImages : referenceImages;
      const taskReferenceImages = productImages.length
        ? referenceImages.filter((url) => !productImages.includes(url))
        : [];
      const remoteImageError = validateRemoteReadyProductImageUrls([
        ...taskProductImages,
        ...taskReferenceImages,
      ]);
      if (remoteImageError) {
        const localOnlyImages = [...taskProductImages, ...taskReferenceImages]
          .filter((url) => !/^https:\/\//i.test(url.trim()));
        return {
          ok: false,
          recoverable: true,
          errorKind: "execution",
          error: remoteImageError,
          data: {
            code: "PRODUCT_IMAGES_NOT_SYNCED",
            localOnlyImages,
            fallbackTool: "wodeapp_image_asset_save",
            fallbackHint: "用 selectedImageIds 或 imageUrls 同步为 HTTPS 后重试；若要写入商品档案可用 wodeapp_product_save。",
          },
          userVisibleSummary: "图片尚未完成云端同步，已阻止远端图片任务。请先同步为 HTTPS 后重试。",
        };
      }
      const explicitCreativeTypes = controlOptionalStringArrayArgument(args, "selectedCreativeTypes");
      const selectedCreativeTypes = explicitCreativeTypes.length
        ? explicitCreativeTypes
        : inferBatchImageCreativeTypeIds(`${prompt}\n${productInfo}`);
      const inferredImageCount = inferBatchImageIterCount(prompt);
      const explicitIterCount = controlOptionalNumberArgument(args, "iterCount", Number.NaN);
      const explicitTargetTotalImages = controlOptionalNumberArgument(args, "targetTotalImages", Number.NaN);
      const selectedTypeCount = Math.max(1, selectedCreativeTypes.length || 1);
      const targetTotalImages = Number.isFinite(explicitTargetTotalImages)
        ? Math.max(1, explicitTargetTotalImages)
        : Number.isFinite(explicitIterCount)
          ? selectedTypeCount * Math.max(1, explicitIterCount)
          : inferredImageCount || 10;
      const iterCount = Number.isFinite(explicitIterCount)
        ? Math.max(1, explicitIterCount)
        : Math.max(1, Math.ceil(targetTotalImages / selectedTypeCount));
      // 图片智能体固定进入商品模式：Agent 侧先写好待生成卡片，再打开工作室；页面不再跑 Planner。
      const activeMode = "full" as const;
      const visualTask: BatchImageVisualTaskPayload = withBatchImageDraftCards(
        buildDefaultBatchImageVisualTask({
          name: productName,
          productImages: taskProductImages,
          refImages: taskReferenceImages,
          productInfo,
          sourceAssetId: sourceAssetId || undefined,
          sourceAssetKind: sourceAssetId ? "商品库" : undefined,
          selectedCreativeTypes: selectedCreativeTypes.length ? selectedCreativeTypes : undefined,
          iterCount,
          targetTotalImages,
          aspectRatio: controlOptionalStringArgument(args, "aspectRatio") || undefined,
          activeMode,
        }),
      );
      const showUi = controlOptionalBooleanArgument(args, "showUi", true);
      const projectHints = {
        slug: abilityProject?.slug,
        subdomain: abilityProject?.subdomain,
        projectId: abilityProject?.projectId,
      };
      const expectedImages = visualTask.targetTotalImages
        || visualTask.selectedCreativeTypes.length * Math.max(1, visualTask.iterCount || 1);
      const taskSummary = summarizeBatchImageTask(visualTask, {
        showUi,
        productImages: taskProductImages.length,
        referenceImages: taskReferenceImages.length,
        sourceAssetId,
        projectHints,
      });
      console.info(`${BATCH_IMAGE_ACTION_LOG_PREFIX} start`, {
        ...taskSummary,
        expectedImages,
        agentId: agent.id,
        hasDemoUrl: Boolean(agent.demoUrl),
        abilityProjects: abilityProjects.length,
      });

      helpers.setNarration(`正在准备「${productName}」图片工作室草稿（计划 ${expectedImages} 张，不会自动生成）`);
      try {
        if (!agent.demoUrl) {
          return {
            ok: false,
            recoverable: true,
            errorKind: "execution",
            error: "visual-generation workbench URL is unavailable",
            data: { code: "WORKBENCH_URL_UNAVAILABLE" },
          };
        }
        const previewStartedAt = Date.now();
        console.info(`${BATCH_IMAGE_ACTION_LOG_PREFIX} prepare:start`, {
          productName,
          expectedImages,
        });
        const injected = await buildVisualGenerationTaskUrlAsync(
          agent.demoUrl,
          visualTask,
          { projectHints },
        );
        const previewUrl = injected.url;
        const taskDocId = injected.taskDocId;
        console.info(`${BATCH_IMAGE_ACTION_LOG_PREFIX} prepare:done`, {
          productName,
          elapsedMs: batchImageActionElapsedMs(previewStartedAt),
          hasPreviewUrl: Boolean(previewUrl),
          taskDocId,
          mode: injected.mode,
          syncVerified: injected.syncDiagnostic?.verified === true,
          saveError: injected.saveError,
        });
        if (!previewUrl || injected.syncDiagnostic?.ok !== true) {
          return {
            ok: false,
            recoverable: true,
            errorKind: "execution",
            error: injected.saveError || "visual-studio draft could not be verified",
            data: {
              code: "BATCH_IMAGE_DRAFT_SYNC_FAILED",
              taskDocId,
              syncDiagnostic: injected.syncDiagnostic,
            },
            userVisibleSummary: injected.saveError
              || "图片工作室草稿未通过云端写入和回读校验，未打开第三栏；请重试。",
          };
        }
        const openSessionId = (
          (typeof helpers.callerSessionId === "string" && helpers.callerSessionId.trim())
          || (typeof mountedSessionId === "string" && mountedSessionId.trim())
          || ""
        ) || undefined;
        const previewOpened = showUi
          ? await openWodeAppAgentTaskUrl(agent, previewUrl, openSessionId)
          : false;
        if (showUi && !previewOpened) {
          return {
            ok: false,
            recoverable: true,
            errorKind: "execution",
            error: "图片工作室草稿已保存，但第三栏未能打开",
            data: {
              code: "WORKBENCH_OPEN_FAILED",
              taskDocId,
              taskUrl: previewUrl,
            },
            taskDocId,
            taskUrl: previewUrl,
            launchUrl: previewUrl,
            status: "prepared_not_opened",
            generationStarted: false,
          };
        }
        helpers.setNarration(
          showUi
            ? "图片工作室草稿已打开，请确认后点击生成"
            : "图片工作室草稿已保存，尚未执行生成",
        );
        console.info(`${BATCH_IMAGE_ACTION_LOG_PREFIX} prepared`, {
          productName,
          elapsedMs: batchImageActionElapsedMs(actionStartedAt),
          taskDocId,
          previewOpened,
        });
        return {
          ok: true,
          executor: "direct",
          stage: "prepare_batch_image",
          status: "ready_for_manual_generate",
          agentId: agent.id,
          mode: "product-visual-studio-draft",
          taskDocId,
          taskUrl: previewUrl,
          launchUrl: previewUrl,
          previewOpened,
          generationStarted: false,
          confirmRunRequired: true,
          expectedImages,
          productName,
          sourceAssetId,
          productImages: taskProductImages,
          referenceImages: taskReferenceImages,
          syncDiagnostic: injected.syncDiagnostic,
          warnings: [],
          nextActions: ["用户在图片工作室确认后点击生成"],
          userVisibleSummary: showUi
            ? `图片工作室草稿已保存并打开（shareDoc=${taskDocId}，已准备 ${visualTask.imageCards?.length || expectedImages} 张待生成卡片），尚未创建生成任务或消耗生成额度。请确认参数后在工作室点击生成。`
            : `图片工作室草稿已保存（shareDoc=${taskDocId}，已准备 ${visualTask.imageCards?.length || expectedImages} 张待生成卡片），尚未创建生成任务或消耗生成额度。`,
        };
      } catch (error) {
        console.error(`${BATCH_IMAGE_ACTION_LOG_PREFIX} prepare:error`, {
          productName,
          elapsedMs: batchImageActionElapsedMs(actionStartedAt),
          error: summarizeBatchImageActionError(error),
        });
        return {
          ok: false,
          recoverable: true,
          errorKind: "execution",
          error: error instanceof Error ? error.message : "batch image draft preparation failed",
          data: { code: "BATCH_IMAGE_PREPARE_FAILED" },
        };
      }
    },
  };
}

function buildGenerationHistorySaveControlAction(
  enabled: boolean,
): OpenworkControlAction {
  return {
    ...directActionMetadata("wodeapp.generation_history.save"),
    previewArgs: {
      kind: "视频",
      productName: "苏泊尔有钛无涂层不粘炒锅 CC34JG3",
      urls: ["https://assets.example.com/demo.mp4"],
      taskId: "video-task-id",
      model: "doubao-seedance-2-0-mini-260615",
      provider: "seedance",
      durationLabel: "15s",
    },
    disabled: !enabled,
    execute: async (args) => {
      const kind = normalizeGenerationHistoryKind(controlOptionalStringArgument(args, "kind"));
      const urlList = [
        ...controlOptionalStringArrayArgument(args, "urls"),
        ...controlOptionalStringArrayArgument(args, "imageUrls"),
        ...controlOptionalStringArrayArgument(args, "videoUrls"),
        ...controlOptionalStringArrayArgument(args, "audioUrls"),
        ...controlOptionalStringArrayArgument(args, "fileUrls"),
        controlOptionalStringArgument(args, "url"),
      ].filter(Boolean);
      const urls = [...new Set(urlList)];
      if (!urls.length) {
        return { ok: false, error: "urls or url is required" };
      }
      const productName = controlOptionalStringArgument(args, "productName");
      const taskId = controlOptionalStringArgument(args, "taskId");
      const name =
        controlOptionalStringArgument(args, "name")
        || formatGenerationHistoryAssetLabel(kind, productName, taskId);
      const saved = await saveGenerationHistoryAsset({
        kind,
        name,
        urls,
        promptText: controlOptionalStringArgument(args, "prompt")
          || controlOptionalStringArgument(args, "promptText")
          || controlOptionalStringArgument(args, "summary"),
        taskId,
        model: controlOptionalStringArgument(args, "model"),
        provider: controlOptionalStringArgument(args, "provider"),
        shareUrl: controlOptionalStringArgument(args, "shareUrl")
          || controlOptionalStringArgument(args, "taskUrl")
          || controlOptionalStringArgument(args, "launchUrl"),
        durationLabel: controlOptionalStringArgument(args, "durationLabel"),
        sourceAssetId: controlOptionalStringArgument(args, "sourceAssetId")
          || controlOptionalStringArgument(args, "assetId"),
        productName,
      });
      rememberAssetMention(digitalAssetToMention(saved));
      return {
        ok: true,
        assetId: saved.id,
        name: saved.name,
        kind: saved.kind,
        urlCount: urls.length,
        userVisibleSummary: `${kind}生成结果已保存到生成历史；后续可直接 @${saved.name} 继续生成。`,
      };
    },
  };
}

function buildFolderOpenControlAction(
  enabled: boolean,
): OpenworkControlAction {
  return {
    id: "wodeapp.folder.open",
    label: "打开本地文件夹",
    description:
      "在 Finder / 资源管理器中打开本地目录。path 可为绝对路径、~/ 或工作区相对路径。批量下载/导出完成后调用，方便用户直接查看输出文件；也可让用户点击聊天里识别出的目录链接。",
    sideEffect: "navigation",
    effect: "read",
    approval: "auto",
    requiresArgs: true,
    args: [
      { name: "path", type: "string", required: true, description: "要打开的目录路径，如 outputs/ep01-videos 或绝对路径。" },
    ],
    previewArgs: {
      path: "outputs",
    },
    disabled: !enabled,
    execute: async (args) => {
      if (!isElectronRuntime()) {
        return { ok: false, error: "打开文件夹需要 WodeAppX 桌面端" };
      }
      const rawPath = controlOptionalStringArgument(args, "path");
      if (!rawPath?.trim()) return { ok: false, error: "path is required" };
      const path = rawPath.trim();
      try {
        await openDesktopPath(path);
        return {
          ok: true,
          path,
          userVisibleSummary: `已在访达中打开：${path}`,
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

function buildShortDramaOpenControlAction(
  enabled: boolean,
  mountedSessionId?: string,
): OpenworkControlAction {
  return {
    id: "wodeapp.short_drama.open",
    label: "打开短剧智能体",
    description:
      "打开「短剧智能体」剧本/梗概写作页（script.wodeapp.cn / script-storyboard）。用于写剧本、季线、角色/场景定妆文案；不是出片入口。出片与脚本可视化（单帧 scriptFrameUrl / 九宫格 nineGridUrl / 视频 videoRefs）必须用 wodeapp_video_storyboard_open。商品短视频禁止调用本动作。",
    sideEffect: "navigation",
    effect: "read",
    approval: "auto",
    requiresArgs: false,
    args: [
      { name: "topic", type: "string", required: false, description: "短剧题材或剧名，用于 narration。" },
    ],
    previewArgs: {
      topic: "治愈校园热血竖屏短剧",
    },
    disabled: !enabled,
    execute: async (args, helpers) => {
      const abilityProjects = readWodeAppAbilityProjects();
      const agent = findWodeAppBuiltinAgent("script-storyboard", abilityProjects);
      if (!agent) return { ok: false, error: "script-storyboard agent is unavailable" };
      const topic = controlOptionalStringArgument(args, "topic") || "短剧智能体";
      helpers.setNarration(`正在打开「${topic}」短剧智能体页面`);
      const openSessionId = (
        (typeof helpers.callerSessionId === "string" && helpers.callerSessionId.trim())
        || (typeof mountedSessionId === "string" && mountedSessionId.trim())
        || ""
      ) || undefined;
      dispatchOpenScriptWorkbench({ topic, sessionId: openSessionId });
      const launchUrl = agent.demoUrl || "";
      return {
        ok: true,
        agentId: agent.id,
        mode: "short-drama-page",
        launchUrl,
        status: "opened",
        userVisibleSummary:
          "短剧智能体页面已在第三栏打开；这是内置剧本工作台。需要时在聊天继续写梗概/分集，并把 launchUrl 展示给用户。",
        topic,
      };
    },
  };
}

type SeriesPreflightApiResponse = {
  success: boolean;
  data?: {
    ok: boolean;
    blocked: boolean;
    policyVersion: string;
    summary: string;
    issues: Array<{
      severity: string;
      type: string;
      check: string;
      episodeNo?: number;
      characterName?: string;
      evidence: string;
      fix: string;
    }>;
    stats: {
      episodeCount: number;
      coreCharacterCount: number;
      p0Count: number;
      p1Count: number;
    };
  };
  error?: string;
};

function buildShortDramaSeriesPreflightControlAction(
  enabled: boolean,
): OpenworkControlAction {
  return {
    id: "wodeapp.short_drama.series_preflight",
    label: "季线定稿检查",
    description:
      "在整季剧本定稿、进入分镜/出片前，自动跑季线级检查（伏笔铺垫、核心角色缺席、信息集情绪密度、季末续看钩）。调用 mainserver POST /drama/series-preflight；blocked=true 时必须先修 P0 再继续定稿。短剧流程默认在「全季剧本写完」或「准备定稿」时调用，不要跳过。",
    sideEffect: "none",
    requiresArgs: true,
    args: [
      { name: "episodes", type: "array", required: true, description: "分集数组：每项含 no、hook、beat、scriptText、sequelHook、contentPlan 等。" },
      { name: "totalEpisodes", type: "number", required: false, description: "总集数，默认 episodes.length。" },
      { name: "characters", type: "array", required: false, description: "角色表 {name,tier:core|support|exempt,exemptAbsence?,retiredAfterEp?}。" },
      { name: "foreshadowRegistry", type: "array", required: false, description: "伏笔登记 {id,keywords[],plantBeforeEp,payoffEp}；省略时按大纲钩概念组推导。" },
      { name: "absenceThreshold", type: "number", required: false, description: "核心角色连续缺席集数阈值，默认 3。" },
      { name: "sequelMode", type: "boolean", required: false, description: "是否按续季模式检查季末钩，默认 true。" },
    ],
    previewArgs: {
      totalEpisodes: 3,
      characters: [{ name: "陆寒州", tier: "core" }],
      episodes: [
        { no: 1, hook: "威胁纸条字迹与父亲笔记相同", scriptText: "△ 她把恐吓信叠在父亲遗物笔记上，两处笔锋完全重合。" },
        { no: 2, scriptText: "△ 陆寒州在走廊停步。\n陆寒州：你确定要签？" },
        { no: 3, sequelHook: "背后还有更大的签名", scriptText: "△ 陆寒州握紧文件夹。" },
      ],
    },
    disabled: !enabled,
    execute: async (args, helpers) => {
      const episodes = controlOptionalRecordArrayArgument(args, "episodes");
      if (!episodes.length) {
        return { ok: false, error: "episodes is required and must be a non-empty array" };
      }

      const payload: Record<string, unknown> = { episodes };
      const totalEpisodes = controlOptionalNumberArgument(args, "totalEpisodes", episodes.length);
      if (totalEpisodes > 0) payload.totalEpisodes = totalEpisodes;

      const characters = controlOptionalRecordArrayArgument(args, "characters");
      if (characters.length) payload.characters = characters;

      const foreshadowRegistry = controlOptionalRecordArrayArgument(args, "foreshadowRegistry");
      if (foreshadowRegistry.length) payload.foreshadowRegistry = foreshadowRegistry;

      const absenceThreshold = controlOptionalNumberArgument(args, "absenceThreshold", 0);
      if (absenceThreshold > 0) payload.absenceThreshold = absenceThreshold;

      if (args && typeof args === "object" && "sequelMode" in args) {
        payload.sequelMode = controlOptionalBooleanArgument(args, "sequelMode", true);
      }

      helpers.setNarration(`正在检查 ${episodes.length} 集季线定稿门禁`);
      const response = await requestWodeAppMainJson<SeriesPreflightApiResponse>(
        "/drama/series-preflight",
        { method: "POST", body: JSON.stringify(payload) },
        60000,
      );
      if (!response.success || !response.data) {
        return { ok: false, error: response.error || "series preflight request failed" };
      }

      const { data } = response;
      const topIssues = data.issues.slice(0, 6).map((issue) => {
        const prefix = issue.episodeNo ? `EP${issue.episodeNo} ` : "";
        return `${issue.severity} ${prefix}${issue.evidence}`;
      });

      return {
        ok: !data.blocked,
        blocked: data.blocked,
        policyVersion: data.policyVersion,
        summary: data.summary,
        issueCount: data.issues.length,
        p0Count: data.stats.p0Count,
        p1Count: data.stats.p1Count,
        issues: data.issues,
        topIssues,
        userVisibleSummary: data.blocked
          ? `${data.summary}。请先修复 P0 项再继续定稿。`
          : data.ok
            ? "季线定稿检查通过，可进入分镜/出片。"
            : `${data.summary}。建议按 issues 修复后再定稿。`,
      };
    },
  };
}

function buildSingleVideoGenerateControlAction(
  enabled: boolean,
  modelUnavailable: boolean | undefined,
): OpenworkControlAction {
  return {
    ...directActionMetadata("wodeapp.video.generate"),
    previewArgs: {
      topic: "蓝牙耳机 Pro 模特佩戴 15 秒竖版视频",
      prompt: "年轻通勤模特佩戴蓝牙耳机走进地铁站，镜头先给耳机近景，再展示降噪通勤场景，结尾产品定格。",
      durationSec: 15,
      wait: true,
      ratio: "9:16",
      productName: "蓝牙耳机 Pro",
      productImages: ["https://assets.example.com/product.png"],
      referenceImages: ["https://assets.example.com/model.png"],
      referenceVideos: ["https://assets.example.com/motion-ref.mp4"],
      referenceNames: ["参考模特1"],
      referenceTypes: ["character"],
    },
    disabled: !enabled || Boolean(modelUnavailable),
    execute: async (args, helpers) => {
      const actionArgs = args && typeof args === "object" ? args as Record<string, unknown> : {};
      const prompt =
        controlOptionalStringArgument(args, "prompt")
        || controlOptionalStringArgument(args, "script")
        || controlOptionalStringArgument(args, "description");
      if (!prompt) return { ok: false, error: "prompt is required for wodeapp.video.generate" };

      const topic =
        controlOptionalStringArgument(args, "topic")
        || controlOptionalStringArgument(args, "title")
        || inferProductNameFromPrompt(prompt)
        || "AppX 单条视频任务";
      const ratio =
        controlOptionalStringArgument(args, "aspectRatio")
        || controlOptionalStringArgument(args, "ratio")
        || "9:16";
      const referenceVideos = normalizeDirectReferenceVideoUrls(actionArgs);
      // 智能体传入的 model 一律忽略：默认走平台 Seedance 2.0 Mini（≤15s）；
      // 显式 provider=minimax → MiniMax-H3（官方 V2）。
      const requestedProvider = resolveRequestedVideoProvider(actionArgs);
      const useMiniMaxEngine = isMiniMaxVideoProvider(requestedProvider);
      const ignoredAgentModels = collectAgentVideoModelHints({
        model: controlOptionalStringArgument(args, "model"),
        modelId: controlOptionalStringArgument(args, "modelId"),
      });
      const model = useMiniMaxEngine ? "" : PRODUCT_VIDEO_DEFAULT_MODEL;
      const maxClipSec = useMiniMaxEngine
        ? MINIMAX_VIDEO_CLIP_MAX_SEC
        : getVideoClipMaxSec(PRODUCT_VIDEO_DEFAULT_MODEL);
      const durationSec = Math.max(
        1,
        Math.min(
          maxClipSec,
          controlOptionalNumberArgument(args, "durationSec", controlOptionalNumberArgument(args, "duration", Math.min(15, maxClipSec))),
        ),
      );
      const explicitSubjects = normalizeStoryboardSubjects(actionArgs.subjects);
      const productSubjectResult = buildStoryboardProductSubjects(actionArgs, `${topic}\n${prompt}`);
      const rememberedSubjects = await buildRememberedVideoAssetSubjects({
        args: actionArgs,
        topic,
        promptText: prompt,
        existingSubjects: [...explicitSubjects, ...productSubjectResult.subjects],
      });
      const subjects = await normalizeVideoSubjectImageUrls(dedupeStoryboardSubjects([
        ...explicitSubjects,
        ...productSubjectResult.subjects,
        ...rememberedSubjects,
      ]));
      const linked = attachStoryboardAssetReferences([
        {
          name: controlOptionalStringArgument(args, "sceneName") || "单条视频",
          prompt,
          duration: durationSec,
        },
      ], subjects, {
        primaryProductName: productSubjectResult.primaryName,
      });

      const scenePrompt = linked.scenes[0]?.prompt || prompt;
      const sanitizedArgs: Record<string, unknown> = {
        ...actionArgs,
        model: PRODUCT_VIDEO_DEFAULT_MODEL,
      };
      delete sanitizedArgs.modelId;
      if (useMiniMaxEngine) {
        // 不把 Seedance 默认模型 ID 发给 MiniMax；显式默认 MiniMax-H3。
        sanitizedArgs.model = "MiniMax-H3";
      }
      const directRequest = buildDirectVideoRequestBody({
        args: sanitizedArgs,
        prompt: scenePrompt,
        ratio,
        durationSec,
        subjects: linked.subjects,
        topic,
      });

      helpers.setNarration(`正在直接提交「${topic}」视频生成任务`);
      let response: DirectVideoTaskResponse;
      try {
        response = await submitDirectVideoTask(directRequest.body);
      } catch (error) {
        const httpStatus = error instanceof WodeAppRuntimeRequestError ? error.status : undefined;
        const bodySnippet = error instanceof WodeAppRuntimeRequestError ? error.bodySnippet : undefined;
        return {
          ok: false,
          error: error instanceof Error ? error.message : "视频任务提交失败",
          httpStatus,
          bodySnippet,
          topic,
          durationSec,
          ratio,
          provider: directRequest.provider,
          taskType: directRequest.taskType,
          directGeneration: true,
          generationStarted: false,
          subjectCount: linked.subjects.length,
          referenceVideoCount: directRequest.referenceVideoCount,
          assetBindingDiagnostics: linked.diagnostics,
          ignoredAgentModels,
        };
      }
      if (response.success === false) {
        return {
          ok: false,
          error: response.error || "视频任务提交失败",
          topic,
          durationSec,
          ratio,
          provider: directRequest.provider,
          taskType: directRequest.taskType,
          directGeneration: true,
          generationStarted: false,
          subjectCount: linked.subjects.length,
          referenceVideoCount: directRequest.referenceVideoCount,
          assetBindingDiagnostics: linked.diagnostics,
          ignoredAgentModels,
        };
      }
      let data = response.data || {};
      const taskId = data.taskId || "";
      const wait = controlOptionalBooleanArgument(args, "wait", true);
      const waitTimeoutSec = Math.max(
        30,
        Math.min(1800, controlOptionalNumberArgument(args, "waitTimeoutSec", 720)),
      );
      let timedOut = false;
      let polls = 0;

      if (wait && taskId && !data.videoUrl && isDirectVideoTaskTerminalStatus(data.status) !== "failed") {
        helpers.setNarration(`视频任务已提交（${taskId}），正在等待生成完成…`);
        const polled = await pollDirectVideoTaskUntilDone({
          taskId,
          initial: data,
          timeoutMs: waitTimeoutSec * 1000,
          onProgress: (status, elapsedMs) => {
            const elapsedSec = Math.max(1, Math.round(elapsedMs / 1000));
            helpers.setNarration(`视频生成中（${status}），已等待 ${elapsedSec}s…`);
          },
        });
        data = polled.data;
        timedOut = polled.timedOut;
        polls = polled.polls;
      }

      const videoUrl = typeof data.videoUrl === "string" ? data.videoUrl : "";
      const terminal = isDirectVideoTaskTerminalStatus(data.status);
      if (videoUrl) {
        try {
          const productName = controlOptionalStringArgument(args, "productName") || productSubjectResult.primaryName || "";
          const saved = await saveGenerationHistoryAsset({
            kind: "视频",
            name: formatGenerationHistoryAssetLabel("视频", productName || topic, taskId),
            urls: [videoUrl],
            promptText: scenePrompt,
            taskId,
            model: directVideoInputString(actionArgs, "model", "modelId"),
            provider: data.provider || directRequest.provider,
            durationLabel: `${durationSec}s`,
            productName,
          });
          rememberAssetMention(digitalAssetToMention(saved));
        } catch {
          // Video generation succeeded; history save can be retried after status polling.
        }
      }

      let userVisibleSummary: string;
      if (videoUrl) {
        userVisibleSummary = `视频已生成完成：${videoUrl}`;
      } else if (terminal === "failed") {
        userVisibleSummary = `视频任务失败（${taskId || "无 taskId"}）：${data.status || "failed"}。`;
      } else if (timedOut && taskId) {
        userVisibleSummary = `视频任务仍在生成中（已等待约 ${waitTimeoutSec}s）。任务 ID：${taskId}，当前状态：${data.status || "polling"}。请继续调用 video_task_status，不要让用户自己追问。`;
      } else if (taskId) {
        userVisibleSummary = `视频任务已提交，任务 ID：${taskId}，当前状态：${data.status || "submitted"}。${wait ? "" : "未开启等待；请调用 video_task_status 轮询直到拿到 videoUrl。"}`;
      } else {
        userVisibleSummary = "视频任务已提交；平台未返回 taskId，请稍后通过视频任务列表核对。";
      }

      return {
        ok: terminal !== "failed",
        actionId: "wodeapp.video.generate",
        mode: "direct-video-task",
        directGeneration: true,
        generationStarted: Boolean(taskId),
        requiresManualGenerate: false,
        waited: wait,
        timedOut,
        polls,
        status: data.status || "submitted",
        taskId,
        provider: data.provider || directRequest.provider,
        taskType: data.taskType || directRequest.taskType,
        providerTaskId: data.providerTaskId,
        videoUrl: videoUrl || undefined,
        deduplicated: Boolean(data.deduplicated),
        statusPath: taskId ? `/runtime-server/api/video/tasks/${taskId}` : undefined,
        nextAction: (!videoUrl && taskId && terminal !== "failed")
          ? { tool: "video_task_status", args: { taskId } }
          : undefined,
        userVisibleSummary,
        topic,
        durationSec,
        ratio,
        subjectCount: linked.subjects.length,
        imageSubjectCount: directRequest.imageSubjectCount,
        referenceVideoCount: directRequest.referenceVideoCount,
        assetBindingDiagnostics: linked.diagnostics,
        ignoredAgentModels,
        ...(terminal === "failed"
          ? { error: `video task failed with status ${data.status || "failed"}` }
          : {}),
      };
    },
  };
}

function buildVideoStatusControlAction(enabled: boolean): OpenworkControlAction {
  return {
    ...directActionMetadata("wodeapp.video.status"),
    previewArgs: {
      taskId: "vtask_example",
    },
    disabled: !enabled,
    execute: async (args) => {
      const taskId = controlOptionalStringArgument(args, "taskId");
      if (!taskId) return { ok: false, error: "taskId is required" };
      let response: DirectVideoTaskResponse;
      try {
        response = await readDirectVideoTaskStatus(taskId);
      } catch (error) {
        const httpStatus = error instanceof WodeAppRuntimeRequestError ? error.status : undefined;
        const bodySnippet = error instanceof WodeAppRuntimeRequestError ? error.bodySnippet : undefined;
        return {
          ok: false,
          actionId: "wodeapp.video.status",
          taskId,
          error: error instanceof Error ? error.message : "视频任务状态查询失败",
          httpStatus,
          bodySnippet,
        };
      }
      if (response.success === false) {
        return {
          ok: false,
          actionId: "wodeapp.video.status",
          taskId,
          error: response.error || "视频任务状态查询失败",
        };
      }
      const data = response.data || {};
      const videoUrl = typeof data.videoUrl === "string" ? data.videoUrl : "";
      const terminal = isDirectVideoTaskTerminalStatus(data.status);
      if (videoUrl) {
        try {
          const saved = await saveGenerationHistoryAsset({
            kind: "视频",
            name: formatGenerationHistoryAssetLabel("视频", "", data.taskId || taskId),
            urls: [videoUrl],
            taskId: data.taskId || taskId,
            provider: data.provider,
          });
          rememberAssetMention(digitalAssetToMention(saved));
        } catch {
          // Status query should still succeed even if local history save is unavailable.
        }
      }
      const stillRunning = !videoUrl && terminal !== "failed";
      return {
        ok: terminal !== "failed",
        actionId: "wodeapp.video.status",
        taskId: data.taskId || taskId,
        status: data.status || "submitted",
        provider: data.provider,
        taskType: data.taskType,
        videoUrl: videoUrl || undefined,
        nextAction: stillRunning
          ? { tool: "video_task_status", args: { taskId: data.taskId || taskId } }
          : undefined,
        userVisibleSummary: videoUrl
          ? `视频任务已完成：${videoUrl}`
          : terminal === "failed"
            ? `视频任务失败：${data.taskId || taskId}（${data.status || "failed"}）。`
            : `视频任务 ${data.taskId || taskId} 当前状态：${data.status || "submitted"}，尚未完成。请继续调用 video_task_status，不要让用户自己追问。`,
        ...(terminal === "failed"
          ? { error: `video task failed with status ${data.status || "failed"}` }
          : {}),
      };
    },
  };
}

function buildVideoStoryboardControlAction(
  enabled: boolean,
  modelUnavailable: boolean | undefined,
  mode: "open" | "update" = "open",
  mountedSessionId?: string,
): OpenworkControlAction {
  const isUpdate = mode === "update";
  const openPreviewArgs = {
      topic: "蓝牙耳机 Pro 30 秒竖屏短片",
      aspectRatio: "9:16",
      durationSec: 15,
      productName: "蓝牙耳机 Pro",
      productImages: ["https://assets.example.com/product.png"],
      groups: [
        { id: "act-1", title: "开场", order: 0 },
        { id: "act-2", title: "卖点", order: 1 },
      ],
      subjects: [
        {
          name: "通勤模特半身",
          type: "character",
          imageUrl: "https://assets.example.com/model.png",
          description: "年轻亚洲女性，通勤穿搭半身参考",
        },
      ],
      scenes: [
        {
          name: "00-04 开场",
          groupId: "act-1",
          orderInGroup: 0,
          prompt: "城市清晨通勤人群中，[通勤模特半身]戴上[蓝牙耳机 Pro]，镜头推近耳机特写，光线柔和真实",
        },
        {
          name: "04-08 卖点",
          groupId: "act-2",
          orderInGroup: 0,
          prompt: "[蓝牙耳机 Pro]悬浮在深色背景中旋转，音波粒子环绕，展示降噪芯片细节，运镜环绕",
        },
      ],
  };
  const updatePreviewArgs = {
    shareDocId: "pvs_example_storyboard_20260724_abcd",
    scenes: [
      {
        name: "第11集-镜头1",
        groupId: "G11",
        orderInGroup: 0,
        prompt: "雨夜巷口，女主回望受伤的狼，镜头缓推至对视",
        duration: 15,
      },
    ],
    groups: [{ id: "G11", title: "[觉醒] 第11集", order: 11 }],
  };

  if (isUpdate) {
    return {
      ...directActionMetadata("wodeapp.video_storyboard.update"),
      previewArgs: updatePreviewArgs,
      disabled: !enabled || Boolean(modelUnavailable),
      execute: async (args, helpers) => executeVideoStoryboardControlAction(
        args && typeof args === "object" && !Array.isArray(args)
          ? args as Record<string, unknown>
          : {},
        helpers,
        "update",
        mountedSessionId,
      ),
    };
  }

  return {
    id: "wodeapp.video_storyboard.open",
    label: "打开多条视频生成",
    description: `新建分镜工作台。多条用本工具，单条用 wodeapp.video.generate。勿传 model（默认≤${VIDEO_CLIP_MAX_SEC}s）。必填 scenes[]；多集 groups+groupId。大批量追加用 wodeapp_video_storyboard_update（shareDocId+delta≤25）。`,
    sideEffect: "mutation",
    effect: "write",
    approval: "auto",
    requiresArgs: true,
    args: [
      { name: "shareDocId", type: "string", required: false, description: "已有分镜 shareDoc docId（pvs_* 或 pvs-*）。传入时 PUT 更新同一记录并保留各镜 videoRefs/生成状态；省略则创建新 shareDoc。大批量增量请改用 wodeapp_video_storyboard_update。" },
      { name: "pvsRun", type: "string", required: false, description: "shareDocId 的旧别名（只读兼容）；与 shareDocId 二选一，优先 shareDocId。" },
      { name: "topic", type: "string", required: false, description: "任务主题，如「RT9000 真人太空超跑变形 60秒竖屏」。" },
      { name: "aspectRatio", type: "string", required: false, description: "视频画幅，如 9:16、1:1、16:9；默认 9:16。" },
      { name: "durationSec", type: "number", required: false, description: `全局单条时长（秒），默认 ${VIDEO_CLIP_MAX_SEC}。平台默认模型上限 ${VIDEO_CLIP_MAX_SEC}s；scene.duration 可覆盖，更长请拆条。` },
      { name: "model", type: "string", required: false, description: `已忽略勿传。平台默认 Seedance 2.0 Mini（≤${VIDEO_CLIP_MAX_SEC}s）；更长请拆条，用户可在工作台手动改模型。` },
      { name: "modelId", type: "string", required: false, description: "model 别名；同样忽略。" },
      { name: "groups", type: "array", required: false, description: "工作台「新建分组」定义（幕/集/段落）。同一 shareDoc 内多集时必传：每项 {id, title?, order?}；scene.groupId 必须引用 groups[].id。例：30 集短剧 = 1 个 shareDoc + 30 个 groups，每集分镜挂对应 groupId。勿为每集新建 shareDoc，勿改站点页面。" },
      { name: "scenes", type: "array", required: true, description: `可独立生成的视频段数组。用户要求 N 段/条时必须恰好传 N 项。每项 {name?, prompt, duration?, camera?, imageUrl?, subjects?, groupId?, group?, orderInGroup?, videoRefs?, activeVideoId?}。groupId（别名 group/episode）对应工作台分组 Tab（= groups[].id；多集时一集一组）。勿传 scene.model（已忽略）。duration 默认上限 ${VIDEO_CLIP_MAX_SEC}s；prompt 时间轴不得超过该条 duration。【必做】画面内要绑定参考图的资产，prompt 必须包含与顶层/本镜 subjects[].name 逐字一致的 [精确素材名]。【禁止】不要传 productImageUrl、imageRefs、scene.referenceImages[] 多图列表。` },
      { name: "subjects", type: "array", required: false, description: "素材主体数组 {name, type: character|prop|scene, description?, imageUrl?}，是参考图仓库。name 是 scene.prompt 里 [方括号] 的唯一引用键：prompt 写 [name] 才会把该 subject.imageUrl 绑进该镜。复用数字资产时 name 必须复制资产原名，不要简称。有 imageUrl 的 subject 必须被至少一个 scene.prompt 用完全相同的 [name] 引用，否则该图不会进入视频参考图。多图同一镜：登记多个 subject，再在同一 prompt 写多个 [name]。例：name=\"阿尔法蛋 S1 卡通讲解角色参考图\" 时 prompt 必须含 [阿尔法蛋 S1 卡通讲解角色参考图]，不能写 [卡通角色]。" },
      { name: "productId", type: "string", required: false, description: "wodeapp.assets.list 返回的商品库 assetId。动作会自动从该商品条目读取最多 4 张去重代表图并绑定到分镜；无需复制本地素材 URL。" },
      { name: "sourceAssetId", type: "string", required: false, description: "productId 的通用别名；来自 @商品 上下文的数字资产 ID。" },
      { name: "product", type: "string", required: false, description: "旧兼容字段，可传商品库 assetId 或商品名称；动作会自动解析为 productId/productName。新调用优先传 productId。" },
      { name: "productName", type: "string", required: false, description: "商品 subject 的 name；有 productImages 时会注册为 prop subject。各镜要锁商品外观时，prompt 必须写 [productName 原文]，例如 productName=\"纽莱贵族 EOMC航天者科技袜\" → prompt 含 [纽莱贵族 EOMC航天者科技袜]。" },
      { name: "productInfo", type: "string", required: false, description: "商品卖点、规格、材质、品牌约束，用于商品 subject 描述。" },
      { name: "productImages", type: "array", required: false, description: "商品图 URL 列表，会注册成 subjects（第 1 张用 productName，其余自动命名为「productName参考图2/3…」）。注册不等于已绑定：每个需要出镜的图，对应 scene.prompt 仍须写 [该 subject 的 name]。不要指望只传 productImages 就会让每镜显示多张参考图。" },
      { name: "referenceImages", type: "array", required: false, description: "顶层额外参考图 URL（模特/场景/道具等），会注册为独立 subjects；同样必须在相关 scene.prompt 用 [subjects.name] 引用后才进入该镜。不要传 data:image...；不要改用场景级 imageRefs/productImageUrl。" },
    ],
    previewArgs: openPreviewArgs,
    disabled: !enabled || Boolean(modelUnavailable),
    execute: async (args, helpers) => executeVideoStoryboardControlAction(
      args && typeof args === "object" && !Array.isArray(args)
        ? args as Record<string, unknown>
        : {},
      helpers,
      "open",
      mountedSessionId,
    ),
  };
}

const STORYBOARD_UPDATE_MAX_SCENES = 25;

async function executeVideoStoryboardControlAction(
  args: Record<string, unknown>,
  helpers: { setNarration: (text: string) => void; callerSessionId?: string },
  mode: "open" | "update",
  mountedSessionId?: string,
): Promise<Record<string, unknown>> {
  const isUpdate = mode === "update";
  const openSessionId = (
    (typeof helpers.callerSessionId === "string" && helpers.callerSessionId.trim())
    || (typeof mountedSessionId === "string" && mountedSessionId.trim())
    || ""
  ) || undefined;
      let abilityProjects = readWodeAppAbilityProjects();
      let agent = findWodeAppBuiltinAgent("video-generation", abilityProjects);
      if (!agent) return { ok: false, error: "video-generation agent is unavailable" };
      let abilityProject = matchAbilityProject(agent, abilityProjects);

      // 视频分镜是内置能力。普通问答不加载动作；用户明确调用后若本地尚无项目，
      // 在动作内部按需初始化一次，不能把 bootstrap 缺失误报成“尚未开通”。
      let abilitySyncError: string | null = null;
      if (!abilityProject) {
        try {
          const synced = await syncWodeAppAbilityProjects();
          abilitySyncError = synced.error?.trim() || null;
          if (synced.projects.length > 0) {
            abilityProjects = synced.projects;
            agent = findWodeAppBuiltinAgent("video-generation", abilityProjects) || agent;
            abilityProject = matchAbilityProject(agent, abilityProjects);
          }
        } catch (error) {
          abilitySyncError = error instanceof Error ? error.message : "视频工作台初始化失败";
        }
      }
      const shareDocId =
        normalizeShareDocId(controlOptionalStringArgument(args, "shareDocId"))
        || normalizeShareDocId(controlOptionalStringArgument(args, "pvsRun"));
      if (isUpdate && !shareDocId) {
        return {
          ok: false,
          recoverable: true,
          errorKind: "validation",
          code: "validation_failed",
          error: "shareDocId is required for wodeapp_video_storyboard_update. Pass the existing pvs_* id; do not create a new shareDoc.",
          status: "share_doc_id_required",
          nextActions: ["pass_existing_shareDocId", "retry_wodeapp_video_storyboard_update"],
        };
      }
      const incomingScenes = (args as Record<string, unknown>).scenes;
      const incomingGroupsRaw = (args as Record<string, unknown>).groups;
      const hasIncomingGroups = Array.isArray(incomingGroupsRaw) && incomingGroupsRaw.length > 0;
      const rawScenes = normalizeStoryboardScenes(incomingScenes);
      const ignoredAgentModels = collectAgentVideoModelHints({
        model: controlOptionalStringArgument(args, "model"),
        modelId: controlOptionalStringArgument(args, "modelId"),
        scenes: rawScenes,
      });
      const normalizedScenes = stripStoryboardSceneModels(rawScenes);
      if (isUpdate && normalizedScenes.length > STORYBOARD_UPDATE_MAX_SCENES) {
        return {
          ok: false,
          recoverable: true,
          errorKind: "validation",
          code: "validation_failed",
          error: `wodeapp_video_storyboard_update accepts at most ${STORYBOARD_UPDATE_MAX_SCENES} scenes per call (got ${normalizedScenes.length}). Send only this batch's new/changed scenes and call again for the next batch; do not resend the full storyboard.`,
          status: "storyboard_update_batch_too_large",
          nextActions: [
            "split_scenes_into_batches_of_25_or_fewer",
            "pass_only_delta_scenes",
            "retry_wodeapp_video_storyboard_update",
          ],
        };
      }
      if (!normalizedScenes.length) {
        if (isUpdate && hasIncomingGroups) {
          // groups-only delta update: keep existing scenes via merge
        } else {
        const incomingCount = Array.isArray(incomingScenes) ? incomingScenes.length : 0;
        const toolHint = isUpdate ? "wodeapp_video_storyboard_update" : "wodeapp_video_storyboard_open";
        return {
          ok: false,
          recoverable: true,
          errorKind: "validation",
          code: "validation_failed",
          error: incomingCount > 0
            ? `scenes received ${incomingCount} item(s) but none had a usable prompt. Pass scenes as objects {name?, prompt, duration?} (not JSON strings / $text wrappers). Retry ${toolHint}; do not fall back to short_drama.open for video handoff.`
            : isUpdate
              ? "Provide scenes[{prompt}] (delta only) and/or groups[{id,title}]; shareDocId is required. Do not resend the full storyboard."
              : "scenes is required: every scene needs a complete prompt. Retry wodeapp_video_storyboard_open with scenes[{prompt}]; do not open short_drama for video handoff.",
          status: "scenes_prompt_required",
          nextActions: [
            "pass_scenes_as_object_array_with_prompt",
            isUpdate ? "retry_wodeapp_video_storyboard_update" : "retry_wodeapp_video_storyboard_open",
            "do_not_fallback_to_short_drama_open",
          ],
        };
        }
      }
      const actionArgs = args as Record<string, unknown>;
      const topic = controlOptionalStringArgument(args, "topic") || (isUpdate ? "" : "AppX 视频条目任务");
      const ratio = controlOptionalStringArgument(args, "aspectRatio") || "9:16";
      // 智能体传入的 model / scene.model 一律忽略，走平台默认 Seedance 2.0 Mini（≤15s）。
      const model = PRODUCT_VIDEO_DEFAULT_MODEL;
      const maxClipSec = getVideoClipMaxSec(model);
      const durationRaw = Number(actionArgs.durationSec);
      const durationSec = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : undefined;
      const durationGate = normalizedScenes.length
        ? validateStoryboardClipDurations({
          scenes: normalizedScenes,
          durationSec,
          model,
        })
        : { ok: true as const, issues: [] as never[] };
      if (!durationGate.ok) {
        return {
          ok: false,
          recoverable: true,
          errorKind: "validation",
          status: "clip_duration_exceeds_model_limit",
          error: durationGate.error || "scene duration exceeds selected model limit",
          issues: durationGate.issues,
          model: PRODUCT_VIDEO_DEFAULT_MODEL,
          maxClipSec,
          ignoredAgentModels,
          userVisibleSummary: `分镜时长不合规：平台默认 ${PRODUCT_VIDEO_DEFAULT_MODEL_LABEL} 单镜最多 ${maxClipSec} 秒（智能体传入的 model 已忽略）。请拆成 ≤${maxClipSec}s 并重写 prompt 时间轴后再打开。`,
          nextActions: [
            "rewrite_each_scene_duration_within_15s",
            "align_prompt_timeline_to_scene_duration",
            isUpdate ? "retry_wodeapp_video_storyboard_update" : "retry_wodeapp_video_storyboard_open",
          ],
        };
      }
      const scenes = shareDocId
        ? normalizedScenes
        : coalesceStoryboardBeatsIntoClips(normalizedScenes, durationSec || Math.min(VIDEO_CLIP_MAX_SEC, maxClipSec));
      const explicitSubjects = normalizeStoryboardSubjects(actionArgs.subjects);
      const resolvedAsset = await resolveStoryboardAsset(actionArgs, topic);
      const explicitVisualReferenceCount = [
        ...controlOptionalStringArrayArgument(actionArgs, "productImages"),
        ...controlOptionalStringArrayArgument(actionArgs, "referenceImages"),
        ...explicitSubjects.map((subject) => subject.imageUrl || ""),
        ...scenes.map((scene) => scene.imageUrl || ""),
      ].filter(Boolean).length;
      if (resolvedAsset.requestedAssetId && !resolvedAsset.asset && explicitVisualReferenceCount === 0) {
        return {
          ok: false,
          error: `商品素材 ${resolvedAsset.requestedAssetId} 未找到，分镜项目未创建。请重新查询商品库后再试。`,
          status: "source_asset_not_found",
          sourceAssetId: resolvedAsset.requestedAssetId,
          userVisibleSummary: "指定的商品素材没有从商品库解析出来，因此没有创建无参考图的分镜项目。请重新选择商品素材后再试。",
        };
      }
      if (resolvedAsset.requestedProductName && !resolvedAsset.asset && explicitVisualReferenceCount === 0) {
        return {
          ok: false,
          error: `商品库中未找到「${resolvedAsset.requestedProductName}」，分镜项目未创建。请重新查询商品库并传 productId。`,
          status: "source_product_not_found",
          sourceAssetName: resolvedAsset.requestedProductName,
          userVisibleSummary: `商品库中没有解析到「${resolvedAsset.requestedProductName}」，因此没有创建无参考图的分镜项目。请重新选择商品后再试。`,
        };
      }
      const productSubjectResult = buildStoryboardProductSubjects(actionArgs, topic, resolvedAsset.asset);
      if (resolvedAsset.asset && productSubjectResult.sourceImageCount === 0 && explicitVisualReferenceCount === 0) {
        return {
          ok: false,
          error: `商品素材「${resolvedAsset.asset.name}」没有可用商品图，分镜项目未创建。`,
          status: "source_asset_has_no_images",
          sourceAssetId: resolvedAsset.asset.id,
          sourceAssetName: resolvedAsset.asset.name,
          userVisibleSummary: `商品库中的「${resolvedAsset.asset.name}」没有可用图片，因此没有创建无参考图的分镜项目。`,
        };
      }
      const rememberedSubjects = await buildRememberedVideoAssetSubjects({
        args: actionArgs,
        topic,
        promptText: scenes.map((scene) => `${scene.name || ""}\n${scene.prompt}`).join("\n"),
        existingSubjects: [...explicitSubjects, ...productSubjectResult.subjects],
      });
      const storyboardSubjects = dedupeStoryboardSubjects([
        ...explicitSubjects,
        ...productSubjectResult.subjects,
        ...rememberedSubjects,
      ]);
      const remoteReferenceError = validateRemoteReadyProductImageUrls([
        ...storyboardSubjects.map((subject) => subject.imageUrl || ""),
        ...scenes.map((scene) => scene.imageUrl || ""),
      ]);
      if (remoteReferenceError) {
        return {
          ok: false,
          recoverable: true,
          errorKind: "execution",
          error: remoteReferenceError,
          status: "reference_images_not_synced",
          sourceAssetId: resolvedAsset.asset?.id,
          sourceAssetName: resolvedAsset.asset?.name,
          userVisibleSummary: "视频分镜引用图尚未完成云端同步，已阻止远端交接。请先用 wodeapp_image_asset_save({ selectedImageIds 或 imageUrls, requireHttps: true }) 同步 HTTPS，或对商品档案调用 wodeapp_product_save({ selectedImageIds }) 后再重试。",
          data: {
            code: "VIDEO_REFERENCE_IMAGES_NOT_SYNCED",
            fallbackTool: "wodeapp_image_asset_save",
          },
        };
      }
      const subjects = await normalizeVideoSubjectImageUrls(storyboardSubjects);
      const linked = attachStoryboardAssetReferences(scenes, subjects, {
        primaryProductName: productSubjectResult.primaryName,
      });
      const grouped = resolveStoryboardGroupsForPayload(linked.scenes, actionArgs.groups);
      const groupingReminder =
        grouped.groups.length === 0
          ? "【分组提醒】用户要「同一项目不同分组/多集」时：必须 1 个 shareDocId 内写 groups[] + scene.groupId（可用别名 group/episode），再用 wodeapp_video_storyboard_update 按批追加；禁止每集新建 shareDoc，禁止 create_page/update_page 冒充分组。本次 groupCount=0。"
          : isUpdate
            ? "【分组提醒】继续用 wodeapp_video_storyboard_update + 同一 shareDocId，只传本批新增/修改的 scenes（≤25），勿全量重推。"
            : "【分组提醒】后续大批量追加请用 wodeapp_video_storyboard_update + 同一 shareDocId（只传 delta scenes），勿再为下一集新建 shareDoc。";
      const withGroupingReminder = (summary: string) => `${summary} ${groupingReminder}`;
      const payload: VideoStoryboardTaskPayload = {
        capabilityId: PRODUCT_VIDEO_STORYBOARD_CAPABILITY_ID,
        id: shareDocId ? `run-${shareDocId}` : `run-agent-${Date.now()}`,
        topic: topic || "AppX 视频条目任务",
        inputSnapshot: {
          ratio,
          ...(durationSec ? { durationSec } : {}),
          model: PRODUCT_VIDEO_DEFAULT_MODEL,
        },
        scenes: grouped.scenes.map((scene) => ({
          ...scene,
          duration: scene.duration ?? durationSec ?? Math.min(15, maxClipSec),
          model: PRODUCT_VIDEO_DEFAULT_MODEL,
        })),
        ...(linked.subjects.length ? { subjects: linked.subjects } : {}),
        ...(grouped.groups.length ? { groups: grouped.groups } : {}),
      };
      if (!agent.demoUrl) {
        return {
          ok: false,
          error: abilitySyncError
            ? `内置视频分镜工作台初始化失败：${abilitySyncError}`
            : "内置视频分镜工作台暂时无法初始化，请稍后重试。",
          agentId: agent.id,
          mode: "builtin-workbench-initialization-failed",
          status: "storyboard_workbench_unavailable",
          userVisibleSummary: "内置视频分镜工作台暂时未能初始化，本次未提交视频生成任务，请稍后重试。",
          topic,
          sceneCount: linked.scenes.length,
          subjectCount: linked.subjects.length,
          sourceAssetId: resolvedAsset.asset?.id,
          sourceAssetName: resolvedAsset.asset?.name,
          sourceAssetMatchedBy: resolvedAsset.matchedBy,
          sourceAssetImageCount: productSubjectResult.sourceImageCount,
          assetBindingDiagnostics: linked.diagnostics,
        };
      }
      const { url: taskUrl, mode: injectionMode, saveError, syncDiagnostic, shareDocId: resolvedShareDocId, updated } =
        await buildVideoStoryboardTaskUrlAsync(
        agent.demoUrl,
        payload,
        {
          shareDocId,
          projectHints: {
            slug: abilityProject?.slug,
            subdomain: abilityProject?.subdomain,
            projectId: abilityProject?.projectId,
          },
        },
      );
      helpers.setNarration(
        shareDocId
          ? `正在${isUpdate ? "增量更新" : "更新"}「${topic || resolvedShareDocId || shareDocId}」视频任务并打开工作台`
          : `正在把「${topic}」视频任务发送到视频生成工作台`,
      );
      const mustUseDocId = scenes.length >= 2;
      if (!taskUrl) {
        return {
          ok: false,
          error: saveError || "无法生成视频任务链接",
          agentId: agent.id,
          topic,
          sceneCount: linked.scenes.length,
          subjectCount: linked.subjects.length,
          sourceAssetId: resolvedAsset.asset?.id,
          sourceAssetName: resolvedAsset.asset?.name,
          sourceAssetMatchedBy: resolvedAsset.matchedBy,
          sourceAssetImageCount: productSubjectResult.sourceImageCount,
          assetBindingDiagnostics: linked.diagnostics,
          injectionMode,
          syncDiagnostic,
        };
      }
      if (mustUseDocId && injectionMode !== "docId") {
        return {
          ok: false,
          error:
            saveError
            || `多条视频任务（${scenes.length} 条）禁止 inline 注入，必须写入 pvs_video_shares 短链`,
          agentId: agent.id,
          topic,
          sceneCount: linked.scenes.length,
          subjectCount: linked.subjects.length,
          sourceAssetId: resolvedAsset.asset?.id,
          sourceAssetName: resolvedAsset.asset?.name,
          sourceAssetMatchedBy: resolvedAsset.matchedBy,
          sourceAssetImageCount: productSubjectResult.sourceImageCount,
          assetBindingDiagnostics: linked.diagnostics,
          injectionMode,
          syncDiagnostic,
        };
      }
      if (await openWodeAppAgentTaskUrl(agent, taskUrl, openSessionId)) {
        const deltaSceneCount = linked.scenes.length;
        const mergedSceneCount = typeof syncDiagnostic?.sceneCount === "number"
          ? syncDiagnostic.sceneCount
          : deltaSceneCount;
        const mergedGroupCount = grouped.groups.length;
        return {
          ok: true,
          agentId: agent.id,
          mode: injectionMode === "docId"
            ? (updated || isUpdate ? "product-video-storyboard-docid-updated" : "product-video-storyboard-docid")
            : "product-video-storyboard-inline",
          taskUrl,
          launchUrl: taskUrl,
          shareDocId: resolvedShareDocId,
          updated: Boolean(updated || isUpdate),
          status: "ready_for_manual_generate",
          userVisibleSummary: withGroupingReminder(injectionMode === "docId"
            ? (updated || isUpdate
              ? `视频工作台已增量更新并打开（shareDoc=${resolvedShareDocId}，本批 ${deltaSceneCount} 条分镜已合并，当前共 ${mergedSceneCount} 条${mergedGroupCount ? `、${mergedGroupCount} 个分组` : ""}，已保留各镜生成版本）；请用可点击 Markdown 链接展示 taskUrl。后续继续只传 delta，勿全量重推。`
              : `视频生成工作台已打开（视频条目和素材已写入云端短链，${mergedGroupCount ? `${mergedGroupCount} 个分组、` : ""}${deltaSceneCount} 条分镜，实际绑定 ${linked.diagnostics.imageSubjectCount} 个图片主体）；请用可点击 Markdown 链接展示 taskUrl/launchUrl（例如 [打开视频工作台](url) 或裸写 https URL），禁止用反引号/代码块；并说明工作台已准备好，用户确认后点击「生成当前组」。`)
            : `视频生成工作台已打开并注入视频条目和素材（${mergedGroupCount ? `${mergedGroupCount} 个分组、` : ""}${deltaSceneCount} 条分镜，实际绑定 ${linked.diagnostics.imageSubjectCount} 个图片主体）；请用可点击 Markdown 链接展示 taskUrl/launchUrl（例如 [打开视频工作台](url) 或裸写 https URL），禁止用反引号/代码块；并说明工作台已准备好，用户确认后点击「生成当前组」。`),
          topic: topic || undefined,
          sceneCount: mergedSceneCount,
          deltaSceneCount,
          groupCount: mergedGroupCount,
          groups: grouped.groups.map((group) => ({ id: group.id, title: group.title, order: group.order })),
          subjectCount: linked.subjects.length,
          sourceAssetId: resolvedAsset.asset?.id,
          sourceAssetName: resolvedAsset.asset?.name,
          sourceAssetMatchedBy: resolvedAsset.matchedBy,
          sourceAssetImageCount: productSubjectResult.sourceImageCount,
          assetBindingDiagnostics: linked.diagnostics,
          injectionMode,
          syncDiagnostic,
          ignoredAgentModels,
        };
      }
      return {
        ok: false,
        error: "内置视频分镜工作台未能打开，请稍后重试。",
        agentId: agent.id,
        mode: "builtin-workbench-open-failed",
        status: "storyboard_workbench_unavailable",
        userVisibleSummary: "内置视频分镜工作台暂时未能打开，本次未提交视频生成任务，请稍后重试。",
        topic,
        sceneCount: linked.scenes.length,
        groupCount: grouped.groups.length,
        subjectCount: linked.subjects.length,
        sourceAssetId: resolvedAsset.asset?.id,
        sourceAssetName: resolvedAsset.asset?.name,
        sourceAssetMatchedBy: resolvedAsset.matchedBy,
        sourceAssetImageCount: productSubjectResult.sourceImageCount,
        assetBindingDiagnostics: linked.diagnostics,
        ignoredAgentModels,
      };
}

export function useWodeAppSessionControlActions(deps: WodeAppSessionControlActionDeps) {
  const authStatusControlAction = useMemo(
    () => buildWodeAppAuthStatusControlAction(deps.enabled),
    [deps.enabled],
  );
  const digitalAssetsCapabilitiesControlAction = useMemo(
    () => buildDigitalAssetsCapabilitiesControlAction(deps.enabled),
    [deps.enabled],
  );
  const digitalAssetsListControlAction = useMemo(
    () => buildDigitalAssetsListControlAction(deps.enabled),
    [deps.enabled],
  );
  const digitalAssetsDeleteControlAction = useMemo(
    () => buildDigitalAssetsDeleteControlAction(deps.enabled),
    [deps.enabled],
  );
  const digitalAssetsDedupePreviewControlAction = useMemo(
    () => buildDigitalAssetsDedupeControlAction(deps.enabled, "preview"),
    [deps.enabled],
  );
  const digitalAssetsDedupeControlAction = useMemo(
    () => buildDigitalAssetsDedupeControlAction(deps.enabled, "delete"),
    [deps.enabled],
  );
  const brandSaveControlAction = useMemo(
    () => buildBrandSaveControlAction(deps.enabled),
    [deps.enabled],
  );
  const productSaveControlAction = useMemo(
    () => buildProductSaveControlAction(deps.enabled, deps.sessionId),
    [deps.enabled, deps.sessionId],
  );
  const imageAssetSaveControlAction = useMemo(
    () => buildImageAssetSaveControlAction(deps.enabled, deps.sessionId),
    [deps.enabled, deps.sessionId],
  );
  const promptSaveControlAction = useMemo(
    () => buildPromptSaveControlAction(deps.enabled),
    [deps.enabled],
  );
  const batchImageControlAction = useMemo(
    () => buildBatchImageControlAction(deps.enabled, deps.modelUnavailable, deps.sessionId),
    [deps.enabled, deps.modelUnavailable, deps.sessionId],
  );
  const generationHistorySaveControlAction = useMemo(
    () => buildGenerationHistorySaveControlAction(deps.enabled),
    [deps.enabled],
  );
  const shortDramaOpenControlAction = useMemo(
    () => buildShortDramaOpenControlAction(deps.enabled, deps.sessionId),
    [deps.enabled, deps.sessionId],
  );
  const shortDramaSeriesPreflightControlAction = useMemo(
    () => buildShortDramaSeriesPreflightControlAction(deps.enabled),
    [deps.enabled],
  );
  const singleVideoGenerateControlAction = useMemo(
    () => buildSingleVideoGenerateControlAction(deps.enabled, deps.modelUnavailable),
    [deps.enabled, deps.modelUnavailable],
  );
  const videoStatusControlAction = useMemo(
    () => buildVideoStatusControlAction(deps.enabled),
    [deps.enabled],
  );
  const videoStoryboardControlAction = useMemo(
    () => buildVideoStoryboardControlAction(deps.enabled, deps.modelUnavailable, "open", deps.sessionId),
    [deps.enabled, deps.modelUnavailable, deps.sessionId],
  );
  const videoStoryboardUpdateControlAction = useMemo(
    () => buildVideoStoryboardControlAction(deps.enabled, deps.modelUnavailable, "update", deps.sessionId),
    [deps.enabled, deps.modelUnavailable, deps.sessionId],
  );
  const folderOpenControlAction = useMemo(
    () => buildFolderOpenControlAction(deps.enabled),
    [deps.enabled],
  );

  useControlAction(authStatusControlAction);
  useControlAction(digitalAssetsCapabilitiesControlAction);
  useControlAction(digitalAssetsListControlAction);
  useControlAction(digitalAssetsDeleteControlAction);
  useControlAction(digitalAssetsDedupePreviewControlAction);
  useControlAction(digitalAssetsDedupeControlAction);
  useControlAction(brandSaveControlAction);
  useControlAction(productSaveControlAction);
  useControlAction(imageAssetSaveControlAction);
  useControlAction(promptSaveControlAction);
  useControlAction(batchImageControlAction);
  useControlAction(generationHistorySaveControlAction);
  useControlAction(shortDramaOpenControlAction);
  useControlAction(shortDramaSeriesPreflightControlAction);
  useControlAction(singleVideoGenerateControlAction);
  useControlAction(videoStatusControlAction);
  useControlAction(videoStoryboardControlAction);
  useControlAction(videoStoryboardUpdateControlAction);
  useControlAction(folderOpenControlAction);
}
