/**
 * AppX 批量出图默认契约 — 与 shared-components/sections/productVisual/agentImageCapability.ts 对齐。
 * wodeappx vendor 无法直接 import shared-components；变更 defaults / 主图 creativeTypes 时请同步两处。
 *
 * 默认模型：1 个主题（product-photo）× iterCount 2，不是 6 种类型各 1 张。
 */
export const PRODUCT_VISUAL_BATCH_IMAGE_CAPABILITY_ID = "product_visual_batch_image" as const;

export type BatchImageCreativeTypePayload = {
  id: string;
  label: string;
  promptSuffix: string;
  aspectRatios?: string[];
  plannerHint?: string;
};

/** 与 ProductVisual 内置 DEFAULT_CREATIVE_TYPES 保持一致，页面打开时优先复用已有提示词类型。 */
export const PRODUCT_VISUAL_MAIN_IMAGE_CREATIVE_TYPES: BatchImageCreativeTypePayload[] = [
  {
    id: "product-photo",
    label: "商品主图（推荐）",
    promptSuffix:
      "，用途为电商商品主图。突出产品本体、外观轮廓和核心卖点，构图干净，主体清晰居中或三分法摆放，光线柔和均匀；背景根据用户意图选择浅灰、材质台面、品牌色渐变、轻场景或白底，整体真实高级，适合淘宝、天猫、京东等平台展示",
    aspectRatios: ["1:1"],
    plannerHint: "每张图变化机位、背景材质和光线方向；保持产品清晰可读，避免过度装饰。背景和棚拍/场景化取向必须跟随用户意图。",
  },
  {
    id: "brand-campaign",
    label: "品牌大片",
    promptSuffix:
      "，用途为品牌宣传视觉。用更强的光影、材质、色彩和构图建立品牌调性，画面具有广告大片质感；保留足够留白，适合首页横幅、社媒首图或活动主视觉",
    aspectRatios: ["1:1", "16:9"],
    plannerHint: "每张图在灯光方案、背景材质、色调情绪、构图风格和氛围故事上做明显差异。横幅/首屏诉求优先用 16:9。",
  },
  {
    id: "detail-closeup",
    label: "细节特写",
    promptSuffix:
      "，用途为产品细节展示。聚焦材质纹理、工艺边缘、结构细节、标识或功能部位，浅景深但关键区域锐利，突出品质感和可信度，适合详情页卖点补充",
    aspectRatios: ["3:4", "1:1"],
    plannerHint: "每张图选择不同细节部位和微距角度；不要只重复同一个局部。默认竖版 3:4 适配详情页。",
  },
  {
    id: "lifestyle-scene",
    label: "场景种草",
    promptSuffix:
      "，用途为生活方式种草图。把产品放入真实可感的使用场景中，体现使用价值、情绪氛围和人群偏好；画面自然、有温度，配景克制，产品仍是明确视觉中心",
    aspectRatios: ["3:4", "1:1"],
    plannerHint: "每张图使用不同生活场景、道具组合和光线时段；画面要像真实内容种草，不要像硬广。默认竖版 3:4。",
  },
  {
    id: "selling-point",
    label: "卖点详情图",
    promptSuffix:
      "，用途为商品详情页卖点图。围绕一个核心卖点组织画面，产品、局部特写、使用场景和留白区域清晰分层，适合后期添加中文卖点文案；画面干净可信，突出功能、材质、结构或使用收益",
    aspectRatios: ["3:4", "1:1"],
    plannerHint: "每张图只讲一个卖点，分别变化功能角度、局部结构、使用收益和版式留白位置。默认竖版 3:4 适配详情页。",
  },
  {
    id: "comparison",
    label: "对比图",
    promptSuffix:
      "，用途为详情页对比说明图。采用左右对比、上下对比或分区构图，清楚呈现使用前后、普通方案与升级方案、不同材质或不同功能表现的差异；左右对比时必须左大右小——左侧本品/优势侧约占画宽 60–65%、主图更大更亮，右侧对照侧约占 35–40%、明显更窄略暗，禁止等宽对半分；对比关系直观，画面真实克制，预留文字标注空间",
    aspectRatios: ["3:4", "1:1"],
    plannerHint: "每张图使用不同对比逻辑，例如使用前后、材质差异、容量差异、细节工艺差异或场景效果差异。左右对比统一左大右小（本品左、对照右）。默认竖版 3:4。",
  },
  {
    id: "white-bg",
    label: "白底图",
    promptSuffix:
      "，用途为标准电商白底图。纯白或近白背景，产品完整、边缘清晰、比例充足，光线均匀，无多余道具、文字、水印和复杂阴影，适合商品列表与基础素材归档",
    aspectRatios: ["1:1"],
    plannerHint: "背景保持白色；每张图变化正面、侧面、四十五度、俯拍或细节角度。",
  },
];

export const PRODUCT_VISUAL_MAIN_IMAGE_TYPE_IDS = PRODUCT_VISUAL_MAIN_IMAGE_CREATIVE_TYPES.map((type) => type.id);
/** 默认批量：单主题商品主图 */
export const PRODUCT_VISUAL_DEFAULT_BATCH_IMAGE_TYPE_IDS = ["product-photo"] as const;
export const PRODUCT_VISUAL_BATCH_IMAGE_DEFAULT_MODEL = "openai/gpt-image-2";
export const PRODUCT_VISUAL_BATCH_IMAGE_DEFAULT_ITER_COUNT = 2;

/** 与 PRODUCT_VISUAL_BATCH_IMAGE_CAPABILITY.defaults 保持一致 */
export const PRODUCT_VISUAL_BATCH_IMAGE_DEFAULTS = {
  aspectRatio: "1:1",
  iterCount: PRODUCT_VISUAL_BATCH_IMAGE_DEFAULT_ITER_COUNT,
  parallel: 2,
  model: PRODUCT_VISUAL_BATCH_IMAGE_DEFAULT_MODEL,
  activeMode: "simple" as const,
};

const CREATIVE_TYPE_INTENT_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ["white-bg", /白底|纯白背景|搜索主图/],
  ["product-photo", /电商主图|商品主图|主图|电商图/],
  ["brand-campaign", /品牌大片|宣传物料|宣传图|海报|活动视觉|活动主视觉|横幅|banner/i],
  ["detail-closeup", /细节特写|细节图|局部特写|微距/],
  ["lifestyle-scene", /场景种草|种草图|生活方式|使用场景|场景图/],
  ["selling-point", /详情页|详情图|卖点图|卖点视觉/],
  ["comparison", /对比图|前后对比|效果对比/],
];

/**
 * WodeAppX 的轻量动作不要求模型先读取完整 capability；因此从用户原话中
 * 兜底识别内置类型。显式 selectedCreativeTypes 始终优先。
 */
export function inferBatchImageCreativeTypeIds(prompt: string): string[] {
  const normalized = prompt.trim();
  if (!normalized) return [];
  return CREATIVE_TYPE_INTENT_RULES
    .filter(([, pattern]) => pattern.test(normalized))
    .map(([id]) => id);
}

export function inferBatchImageIterCount(prompt: string): number | undefined {
  const normalized = prompt.trim();
  const arabic = normalized.match(/(?:每(?:种|类|个)|各)?\s*(\d{1,2})\s*张/);
  if (arabic) return Math.max(1, Math.min(20, Number(arabic[1])));
  const chinese = normalized.match(/(?:每(?:种|类|个)|各)?\s*([一二两三四五六七八九十])\s*张/);
  if (!chinese) return undefined;
  const values: Record<string, number> = {
    一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
    六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  };
  return values[chinese[1]];
}

export type BatchImageVisualTaskPayload = {
  capabilityId: typeof PRODUCT_VISUAL_BATCH_IMAGE_CAPABILITY_ID;
  name: string;
  productImages: string[];
  refImages: string[];
  supplement: string;
  productInfo: string;
  sourceAssetId?: string;
  sourceAssetKind?: string;
  aspectRatio: string;
  iterCount: number;
  targetTotalImages?: number;
  parallel: number;
  model?: string;
  /** Agent 侧已规划好的待生成卡片；runtime 打开 shareDoc 只恢复，不再跑 Planner */
  imageCards?: BatchImageDraftCard[];
  /** true = 打开工作台时不要再规划；卡片已由 Agent 写入 */
  skipPlanner?: boolean;
  selectedCreativeTypes: string[];
  creativeTypes: BatchImageCreativeTypePayload[];
  activeMode: "simple" | "full";
};

export type BatchImageDraftCard = {
  id: string;
  title: string;
  prompt: string;
  negativePrompt?: string;
  creativeTypeId: string;
  aspectRatio: string;
  model?: string;
  status: "draft" | "generating" | "succeeded" | "failed";
  resultUrl?: string;
  error?: string;
  createdAt: number;
};

const PRODUCT_FIDELITY =
  ", photorealistic, sharp focus, preserve exact product silhouette proportions colors logo material opacity and component layout, detailed material texture, no transparent cutaway, no invented lights displays seals or internal structures";

/**
 * Agent 在打开工作室前准备待生成卡片（本地组装，不调用页面 Planner）。
 * runtime ProductVisual 打开 shareDoc 只恢复这些卡片。
 */
export function buildBatchImageDraftCards(
  task: BatchImageVisualTaskPayload,
): BatchImageDraftCard[] {
  const byId = new Map(task.creativeTypes.map((type) => [type.id, type]));
  const selected = task.selectedCreativeTypes.length
    ? task.selectedCreativeTypes
    : [...PRODUCT_VISUAL_DEFAULT_BATCH_IMAGE_TYPE_IDS];
  const iterCount = Math.max(1, Math.min(20, Math.round(task.iterCount || 1)));
  const maxTotal = Math.max(
    1,
    Math.min(24, Math.round(task.targetTotalImages || selected.length * iterCount)),
  );
  const hasProductImages = task.productImages.some(Boolean);
  const supplement = [task.productInfo, task.supplement]
    .map((value) => value?.trim())
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index)
    .join("\n");
  const baseName = task.name.trim()
    ? `Product: ${task.name.trim()}`
    : "Product photography";
  const model = task.model?.trim() || PRODUCT_VISUAL_BATCH_IMAGE_DEFAULT_MODEL;
  const globalRatio = task.aspectRatio?.trim() || "1:1";
  const now = Date.now();
  const cards: BatchImageDraftCard[] = [];

  for (const typeId of selected) {
    if (cards.length >= maxTotal) break;
    const creativeType = byId.get(typeId);
    if (!creativeType) continue;
    const aspectRatio = creativeType.aspectRatios?.[0]?.trim() || globalRatio;
    for (let index = 0; index < iterCount; index += 1) {
      if (cards.length >= maxTotal) break;
      let prompt = baseName;
      if (hasProductImages) {
        prompt +=
          ". Use the provided product photo as the main subject — preserve shape, logo, and material only. Freely change background, lighting, color grading, and atmosphere";
      }
      if (supplement) prompt += `. ${supplement}`;
      if (creativeType.promptSuffix?.trim()) prompt += creativeType.promptSuffix.trim();
      if (iterCount > 1) {
        prompt +=
          `. Variation ${index + 1} of ${iterCount}: use a distinct camera angle, composition, background, props, and lighting mood.`;
      }
      prompt += PRODUCT_FIDELITY;
      const sequence = cards.length + 1;
      cards.push({
        id: `pv_card_${now}_${sequence}`,
        title: `${creativeType.label}${iterCount > 1 ? ` ${index + 1}` : ""}`,
        prompt,
        creativeTypeId: creativeType.id,
        aspectRatio,
        model,
        status: "draft",
        createdAt: now + sequence,
      });
    }
  }
  return cards;
}

export function withBatchImageDraftCards(
  task: BatchImageVisualTaskPayload,
): BatchImageVisualTaskPayload {
  if (task.imageCards?.length) {
    return { ...task, skipPlanner: true };
  }
  const imageCards = buildBatchImageDraftCards(task);
  return {
    ...task,
    imageCards,
    skipPlanner: true,
  };
}

export function buildDefaultBatchImageVisualTask(
  input: {
    name: string;
    productImages: string[];
    refImages: string[];
    productInfo: string;
    supplement?: string;
    sourceAssetId?: string;
    sourceAssetKind?: string;
    selectedCreativeTypes?: string[];
    creativeTypes?: BatchImageCreativeTypePayload[];
    targetTotalImages?: number;
    iterCount?: number;
    aspectRatio?: string;
    model?: string;
    parallel?: number;
    activeMode?: "simple" | "full";
  },
): BatchImageVisualTaskPayload {
  const defaults = PRODUCT_VISUAL_BATCH_IMAGE_DEFAULTS;
  const selectedCreativeTypes = input.selectedCreativeTypes?.length
    ? input.selectedCreativeTypes
    : [...PRODUCT_VISUAL_DEFAULT_BATCH_IMAGE_TYPE_IDS];
  const iterCount = input.iterCount ?? defaults.iterCount;
  // 多类型套图只能使用商品模式；即使调用方误传 simple，也在任务边界纠正，
  // 避免 UI 显示、Planner 语义和云端 payload 三者不一致。
  const activeMode = selectedCreativeTypes.length > 1
    ? "full"
    : input.activeMode ?? defaults.activeMode;

  return {
    capabilityId: PRODUCT_VISUAL_BATCH_IMAGE_CAPABILITY_ID,
    name: input.name,
    productImages: input.productImages,
    refImages: input.refImages,
    productInfo: input.productInfo,
    supplement: input.supplement ?? input.productInfo,
    sourceAssetId: input.sourceAssetId,
    sourceAssetKind: input.sourceAssetKind,
    aspectRatio: input.aspectRatio ?? defaults.aspectRatio,
    iterCount,
    targetTotalImages: input.targetTotalImages ?? selectedCreativeTypes.length * iterCount,
    parallel: input.parallel ?? defaults.parallel,
    model: input.model ?? defaults.model,
    selectedCreativeTypes,
    creativeTypes: input.creativeTypes ?? PRODUCT_VISUAL_MAIN_IMAGE_CREATIVE_TYPES,
    activeMode,
  };
}
