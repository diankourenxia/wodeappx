export type WodeAppDirectActionEffect = "read" | "write" | "destructive";

export type WodeAppDirectActionApproval = "auto" | "prompt" | "writes";

export type WodeAppDirectActionGroup = "agents" | "assets" | "foundation" | "image" | "video";

export type WodeAppJsonSchemaType =
  | "object"
  | "array"
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "null";

export type WodeAppJsonSchema = {
  readonly type?: WodeAppJsonSchemaType | readonly WodeAppJsonSchemaType[];
  readonly title?: string;
  readonly description?: string;
  readonly properties?: Readonly<Record<string, WodeAppJsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: WodeAppJsonSchema;
  readonly additionalProperties?: boolean | WodeAppJsonSchema;
  readonly enum?: readonly (string | number | boolean | null)[];
  readonly const?: string | number | boolean | null;
  readonly default?: unknown;
  readonly anyOf?: readonly WodeAppJsonSchema[];
  readonly oneOf?: readonly WodeAppJsonSchema[];
  readonly allOf?: readonly WodeAppJsonSchema[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
};

export type WodeAppDirectActionInputSchema = WodeAppJsonSchema & {
  readonly type: "object";
  readonly properties: Readonly<Record<string, WodeAppJsonSchema>>;
  readonly required: readonly string[];
  readonly additionalProperties: boolean;
};

export type WodeAppDirectActionContract = {
  readonly toolName: string;
  readonly actionId: string;
  readonly groups: readonly WodeAppDirectActionGroup[];
  readonly label: string;
  readonly description: string;
  readonly effect: WodeAppDirectActionEffect;
  readonly approval: WodeAppDirectActionApproval;
  readonly inputSchema: WodeAppDirectActionInputSchema;
};

/** Structurally identical to OpenworkControlActionArg in the renderer. */
export type WodeAppRendererActionArg = {
  readonly name: string;
  readonly type?: "string" | "number" | "boolean" | "object" | "array" | "unknown";
  readonly required?: boolean;
  readonly description?: string;
};

export type ProductImageExpectationInput = {
  imageInputProvided: boolean;
  productImages: readonly string[];
  expectedImageCount?: unknown;
  sourceProductImages?: readonly string[];
  requireSourceProductImages?: boolean;
};

/**
 * Final product-library image URLs after materialize.
 * Prefer https:// (remote upload). Accept wodeappx-asset:// only as offline/unauthenticated fallback.
 * Bare filenames, wodeapp://attachment/, and raw data: URLs are not acceptable at persistence time.
 */
export function isDurableProductImageUrl(url: string): boolean {
  const value = url.trim();
  if (!value) return false;
  if (/^https:\/\//i.test(value)) return true;
  if (value.startsWith("wodeappx-asset://")) return true;
  return false;
}

export function validateDurableProductImageUrls(productImages: readonly string[]): string | null {
  const invalid = productImages
    .map((url) => url.trim())
    .filter(Boolean)
    .filter((url) => !isDurableProductImageUrl(url));
  if (!invalid.length) return null;
  const sample = invalid.slice(0, 3).join("、");
  return `productImages 必须是可持久访问的图片地址（优先 https://，离线时可 wodeappx-asset://）。不能使用裸文件名、临时附件引用或未落盘的 data: URL。无效项示例：${sample}。`;
}

export function isRemoteReadyProductImageUrl(url: string): boolean {
  return /^https:\/\//i.test(url.trim());
}

export function validateRemoteReadyProductImageUrls(
  productImages: readonly string[],
): string | null {
  const invalid = productImages
    .map((url) => url.trim())
    .filter(Boolean)
    .filter((url) => !isRemoteReadyProductImageUrl(url));
  if (!invalid.length) return null;
  return `有 ${invalid.length} 张图片尚未同步为 HTTPS 云端资产，不能交给远端图片任务。请先重新上传或保存商品素材。`;
}

export type NonHttpsImageClass = "data" | "local" | "other";

export function classifyNonHttpsImageUrl(url: string): NonHttpsImageClass {
  const value = url.trim();
  if (/^data:image\//i.test(value)) return "data";
  if (
    value.startsWith("file://")
    || value.startsWith("wodeapp://attachment/")
    || value.startsWith("wodeappx-asset://")
    || /^\/(?:Users|home|tmp|var|private)\//i.test(value)
    || /^[A-Za-z]:[\\/]/.test(value)
  ) {
    return "local";
  }
  return "other";
}

/** Build a recoverable corrective payload when video refs are not HTTPS-ready. */
export function buildVideoReferenceCorrective(urls: readonly string[]): {
  error: string;
  correctiveAction: {
    tool: "wodeapp_image_asset_save";
    args: { name: string; imageUrls: string[]; requireHttps: true };
  } | null;
  invalidUrls: string[];
} {
  const invalid = urls.map((url) => url.trim()).filter(Boolean).filter((url) => !isRemoteReadyProductImageUrl(url));
  const dataUrls = invalid.filter((url) => classifyNonHttpsImageUrl(url) === "data");
  const localUrls = invalid.filter((url) => classifyNonHttpsImageUrl(url) === "local");
  if (dataUrls.length) {
    return {
      error: `检测到 ${dataUrls.length} 个 data:image 引用，远端视频任务不接受。请改用 https://、本机路径、selectedImageIds 或附件引用，再调用 wodeapp_image_asset_save({ requireHttps: true })。`,
      correctiveAction: null,
      invalidUrls: dataUrls,
    };
  }
  if (localUrls.length) {
    return {
      error: `有 ${localUrls.length} 张本地/附件图尚未同步为 HTTPS。请先调用 wodeapp_image_asset_save（优先 selectedImageIds，或 imageUrls）并设 requireHttps=true，再用返回的 httpsImageUrls 重试分镜。`,
      correctiveAction: {
        tool: "wodeapp_image_asset_save",
        args: {
          name: "视频分镜参考图",
          imageUrls: localUrls.slice(0, 12),
          requireHttps: true,
        },
      },
      invalidUrls: localUrls,
    };
  }
  return {
    error: `有 ${invalid.length} 张图片尚未同步为 HTTPS 云端资产，不能交给远端视频任务。请先 wodeapp_image_asset_save({ requireHttps: true }) 或对商品档案 wodeapp_product_save({ selectedImageIds }) 同步后再试。`,
    correctiveAction: null,
    invalidUrls: invalid,
  };
}

export function validateProductImageExpectation(input: ProductImageExpectationInput): string | null {
  if (!input.imageInputProvided) return null;
  if (!Number.isInteger(input.expectedImageCount) || Number(input.expectedImageCount) < 0 || Number(input.expectedImageCount) > 12) {
    return "传入商品图片时必须提供 0 到 12 之间的整数 expectedImageCount。";
  }
  const expectedImageCount = Number(input.expectedImageCount);
  if (input.productImages.length !== expectedImageCount) {
    return `商品图片数量不符合本轮附件预期：预期 ${expectedImageCount} 张，实际解析到 ${input.productImages.length} 张。`;
  }
  if (input.requireSourceProductImages && !input.sourceProductImages) {
    return "直接传入 productImages 时必须同时提供 sourceProductImages，以校验图片确实来自本轮附件。";
  }
  if (input.sourceProductImages) {
    const productImages = input.productImages.map((url) => url.trim()).filter(Boolean);
    const sourceImages = [...new Set(input.sourceProductImages.map((url) => url.trim()).filter(Boolean))];
    if (sourceImages.length !== expectedImageCount) {
      return `附件来源清单数量不符合预期：预期 ${expectedImageCount} 张，来源清单包含 ${sourceImages.length} 张。`;
    }
    // Compare as sets — agents often reshuffle the same URLs; index equality was a false reject.
    const productUnique = [...new Set(productImages)];
    if (productUnique.length !== sourceImages.length) {
      return "productImages 与本轮附件 sourceProductImages 不完全一致，商品未保存。";
    }
    const sourceSet = new Set(sourceImages);
    if (productUnique.some((url) => !sourceSet.has(url))) {
      return "productImages 与本轮附件 sourceProductImages 不完全一致，商品未保存。";
    }
  }
  return null;
}

const STRING_ARRAY_SCHEMA = {
  type: "array",
  items: { type: "string" },
} as const satisfies WodeAppJsonSchema;

const PRODUCT_CUSTOM_ATTRIBUTE_SCHEMA = {
  type: "object",
  properties: {
    label: { type: "string", description: "属性名称。" },
    value: { type: "string", description: "属性值。" },
    group: { type: "string", description: "属性分组。" },
  },
  required: ["label", "value"],
  additionalProperties: false,
} as const satisfies WodeAppJsonSchema;

const PRODUCT_VARIANT_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "规格名称。" },
    sku: { type: "string", description: "规格 SKU。" },
    price: { type: "string", description: "规格价格。" },
    stock: { type: "string", description: "规格库存。" },
    image: { type: "string", description: "规格图片 URL。" },
    attributes: {
      type: "array",
      description: "规格的自定义属性。",
      items: PRODUCT_CUSTOM_ATTRIBUTE_SCHEMA,
    },
  },
  required: [],
  additionalProperties: false,
} as const satisfies WodeAppJsonSchema;

const PRODUCT_PROFILE_SCHEMA = {
  type: "object",
  description: "结构化商品字段。未列出的资料字段会作为自定义属性保留。",
  properties: {
    brandName: { type: "string", description: "品牌名称。" },
    category: { type: "string", description: "商品品类。" },
    sku: { type: "string", description: "SKU。" },
    spu: { type: "string", description: "SPU。" },
    model: { type: "string", description: "商品型号。" },
    barcode: { type: "string", description: "条码。" },
    status: { type: "string", description: "商品状态。" },
    price: { type: "string", description: "销售价格。" },
    marketPrice: { type: "string", description: "市场价格。" },
    currency: { type: "string", description: "币种。" },
    unit: { type: "string", description: "计量单位。" },
    stock: { type: "string", description: "库存。" },
    color: { type: "string", description: "颜色。" },
    size: { type: "string", description: "尺寸或尺码。" },
    material: { type: "string", description: "材质。" },
    dimensions: { type: "string", description: "外形尺寸。" },
    weight: { type: "string", description: "重量。" },
    packageSpec: { type: "string", description: "包装规格。" },
    sellingPoints: { ...STRING_ARRAY_SCHEMA, description: "商品卖点。" },
    targetAudience: { type: "string", description: "目标受众。" },
    usageScenarios: { ...STRING_ARRAY_SCHEMA, description: "使用场景。" },
    ingredients: { type: "string", description: "成分或配料。" },
    origin: { type: "string", description: "产地。" },
    shelfLife: { type: "string", description: "保质期。" },
    certifications: { ...STRING_ARRAY_SCHEMA, description: "认证信息。" },
    warranty: { type: "string", description: "质保信息。" },
    shippingNotes: { type: "string", description: "配送说明。" },
    afterSales: { type: "string", description: "售后说明。" },
    platform: { type: "string", description: "销售平台。" },
    channel: { type: "string", description: "销售渠道。" },
    listingTitle: { type: "string", description: "上架标题。" },
    shortDescription: { type: "string", description: "商品短描述。" },
    keywords: { ...STRING_ARRAY_SCHEMA, description: "商品关键词。" },
    generationConstraints: { type: "string", description: "内容生成约束。" },
    customAttributes: {
      type: "array",
      description: "自定义商品属性。",
      items: PRODUCT_CUSTOM_ATTRIBUTE_SCHEMA,
    },
    variants: {
      type: "array",
      description: "商品规格。",
      items: PRODUCT_VARIANT_SCHEMA,
    },
  },
  required: [],
  additionalProperties: true,
} as const satisfies WodeAppJsonSchema;

const PRODUCT_ASSET_FILE_SCHEMA = {
  type: "object",
  properties: {
    url: { type: "string", minLength: 1, description: "文件 URL。" },
    name: { type: "string", minLength: 1, description: "包含扩展名的文件名。" },
    type: { type: "string", minLength: 1, description: "文件 MIME 类型。" },
    size: { type: "number", minimum: 0, description: "文件字节数。" },
    mediaType: {
      type: "string",
      enum: ["video", "audio", "document", "other"],
      description: "文件媒体分类。",
    },
    contentHash: { type: "string", description: "文件内容哈希。" },
    integrityStatus: {
      type: "string",
      enum: ["verified", "unverified"],
      description: "文件完整性状态。",
    },
  },
  required: ["url", "name", "type"],
  additionalProperties: false,
} as const satisfies WodeAppJsonSchema;

export const WODEAPP_DIRECT_ACTION_CONTRACTS = Object.freeze([
  {
    toolName: "wodeapp_auth_status",
    actionId: "wodeapp.auth.status",
    groups: ["foundation"],
    label: "查询账号状态",
    description: "读取当前账户、登录状态、积分、模型服务、内置工具健康状态和专属项目列表。",
    effect: "read",
    approval: "auto",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    toolName: "wodeapp_sidebar_agent_save",
    actionId: "wodeapp.sidebar_agent.save",
    groups: ["agents"],
    label: "保存侧栏智能体",
    description: "把 WodeAppX 智能体钉到侧栏，并写入它的项目信息。智能体=名字+策略+对应站点。创建或发布了 runtime 项目后必须回写 projectId 与 launchUrl，侧栏立刻更新，不要让用户刷新或重启。不要用 Skill.md 代替智能体。",
    effect: "write",
    approval: "auto",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 64, description: "侧栏显示的智能体名称。" },
        meta: { type: "string", maxLength: 80, description: "一行简介。" },
        samplePrompt: { type: "string", maxLength: 4000, description: "这个智能体的能力说明或短策略。" },
        projectId: { type: "string", maxLength: 80, description: "对应 runtime 项目 ID。" },
        launchUrl: { type: "string", maxLength: 500, description: "已发布站点 URL。" },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    toolName: "wodeapp_assets_capabilities",
    actionId: "wodeapp.assets.capabilities",
    groups: ["assets"],
    label: "查看数字资产能力契约",
    description: "读取数字资产的分类、存储、文件校验、去重和事务结果契约。",
    effect: "read",
    approval: "auto",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    toolName: "wodeapp_assets_list",
    actionId: "wodeapp.assets.list",
    groups: ["assets"],
    label: "查询数字资产",
    description: "查询已保存的数字资产。用户要找之前存的商品、品牌、图片、视频、剧本、提示词、声音/真人模特时使用（如「商品库里有什么」「找一下模特图」）。可按 kind 和 q 过滤。",
    effect: "read",
    approval: "auto",
    inputSchema: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          description: "分类：商品库、品牌库、提示词、图片、文件、视频、剧本、声音、真人。",
        },
        q: { type: "string", description: "匹配名称/正文/标签/资产 ID 的关键词。" },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          default: 50,
          description: "最多返回条数。",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    toolName: "wodeapp_assets_delete",
    actionId: "wodeapp.assets.delete",
    groups: ["assets"],
    label: "删除本地数字资产",
    description: "按资产 ID 删除数字资产（破坏性，需用户确认）。单个传 assetId，批量传 assetIds[]。",
    effect: "destructive",
    approval: "prompt",
    inputSchema: {
      type: "object",
      properties: {
        assetId: { type: "string", minLength: 1, description: "单个资产 ID。" },
        assetIds: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          uniqueItems: true,
          description: "要删除的资产 ID 列表。",
        },
      },
      required: [],
      anyOf: [
        { required: ["assetId"] },
        { required: ["assetIds"] },
      ],
      additionalProperties: false,
    },
  },
  {
    toolName: "wodeapp_assets_dedupe_preview",
    actionId: "wodeapp.assets.dedupe.preview",
    groups: ["assets"],
    label: "预览本地数字资产重复项",
    description: "预览本地数字资产重复项（不删除）。用户问「有没有重复素材/图片」时先用本工具。按内容哈希或规范名识别。",
    effect: "read",
    approval: "auto",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", description: "缩小范围的资产分类。" },
        q: { type: "string", description: "缩小范围的关键词。" },
        keep: {
          type: "string",
          enum: ["newest", "oldest"],
          default: "newest",
          description: "每组计划保留 newest 或 oldest。",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    toolName: "wodeapp_assets_dedupe",
    actionId: "wodeapp.assets.dedupe",
    groups: ["assets"],
    label: "去重本地数字资产",
    description: "删除本地数字资产重复项（破坏性，需确认）。通常先用 dedupe_preview。keep=newest 保留最新，keep=oldest 保留最早。",
    effect: "destructive",
    approval: "prompt",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", description: "缩小范围的资产分类。" },
        q: { type: "string", description: "缩小范围的关键词。" },
        keep: {
          type: "string",
          enum: ["newest", "oldest"],
          default: "newest",
          description: "每组保留 newest 或 oldest。",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    toolName: "wodeapp_brand_save",
    actionId: "wodeapp.brand.save",
    groups: ["assets"],
    label: "保存品牌到数字资产",
    description: "保存品牌档案到品牌库。用户要整理/入库品牌色、语气、规范时调用。必填 name + sourceText。",
    effect: "write",
    approval: "auto",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, description: "品牌名称。" },
        sourceText: { type: "string", minLength: 1, description: "完整品牌档案正文。" },
        voice: { type: "string", description: "品牌语气或调性。" },
        rules: { type: "string", description: "品牌使用规范或禁用项。" },
        colors: { ...STRING_ARRAY_SCHEMA, description: "品牌色列表。" },
      },
      required: ["name", "sourceText"],
      additionalProperties: false,
    },
  },
  {
    toolName: "wodeapp_product_save",
    actionId: "wodeapp.product.save",
    groups: ["assets"],
    label: "保存商品到数字资产",
    description: "创建/更新商品档案。优先 selectedImageIds（如 img_01）；也可从 media[].imageId 推断。最多 12 张，必填 name。",
    effect: "write",
    approval: "auto",
    inputSchema: {
      type: "object",
      properties: {
        assetId: { type: "string", minLength: 1, description: "需要更新的既有商品资产 ID。" },
        name: { type: "string", minLength: 1, description: "商品名称。" },
        productInfo: { type: "string", description: "从资料中整理出的完整商品说明。" },
        productProfile: PRODUCT_PROFILE_SCHEMA,
        selectedImageIds: {
          type: "array",
          items: { type: "string" },
          maxItems: 12,
          uniqueItems: true,
          description: "会话上传图 ID（如 img_01）。省略且候选≤12时用全部。",
        },
        productImages: {
          type: "array",
          items: { type: "string" },
          maxItems: 12,
          description: "兼容旧参：图片 URL/路径。优先改传 selectedImageIds；若无 ID 则用本字段上传绑定。",
        },
        expectedImageCount: {
          type: "integer",
          minimum: 0,
          maximum: 12,
          description: "兼容旧参，可忽略。",
        },
        sourceProductImages: {
          type: "array",
          items: { type: "string" },
          maxItems: 12,
          description: "兼容旧参，可忽略。",
        },
        media: {
          type: "array",
          items: {
            type: "object",
            properties: {
              imageId: { type: "string", minLength: 1, description: "对应 selectedImageIds 中的 ID。" },
              url: { type: "string", minLength: 1 },
              name: {
                type: "string",
                description: "画面内容短名（如主机带盖）。禁止图1/图2。",
              },
            },
            additionalProperties: false,
          },
          maxItems: 12,
          description: "可选短名，优先传 {imageId,name}。",
        },
        skipImageNaming: {
          type: "boolean",
          description: "为 true 时跳过新图视觉命名。默认 false。",
        },
        assetFiles: {
          type: "array",
          items: PRODUCT_ASSET_FILE_SCHEMA,
          description: "与商品关联的视频、音频、PDF 或其他文档。",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    toolName: "wodeapp_prompt_save",
    actionId: "wodeapp.prompt.save",
    groups: ["assets"],
    label: "保存提示词到数字资产",
    description: "把可复用的生成提示词保存到提示词库。",
    effect: "write",
    approval: "auto",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, description: "提示词资产名称。" },
        promptText: { type: "string", minLength: 1, description: "完整提示词正文。" },
        promptCategory: { type: "string", description: "提示词分类。" },
        tags: { ...STRING_ARRAY_SCHEMA, description: "提示词标签。" },
      },
      required: ["name", "promptText"],
      additionalProperties: false,
    },
  },
  {
    toolName: "wodeapp_image_asset_save",
    actionId: "wodeapp.image_asset.save",
    groups: ["assets", "image"],
    label: "保存图片素材",
    description: "保存图片库素材。对话图传 selectedImageIds（与 wodeapp_product_save 同一套会话图 ID）；也可传 imageUrls。远端必须 HTTPS 时传 requireHttps。必填 name。",
    effect: "write",
    approval: "auto",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, description: "素材名称。" },
        selectedImageIds: {
          type: "array",
          items: { type: "string" },
          maxItems: 12,
          uniqueItems: true,
          description: "会话上传图 ID（如 img_02）。与 imageUrls 二选一；有候选且都省略时自动用全部（≤12）。",
        },
        imageUrls: {
          type: "array",
          items: { type: "string", minLength: 1 },
          maxItems: 12,
          uniqueItems: true,
          description: "可选。https://、本地路径、file://、附件名；禁止 data:base64。优先用 selectedImageIds。",
        },
        notes: { type: "string", description: "可选备注。" },
        assetId: { type: "string", minLength: 1, description: "更新既有素材时传入。" },
        requireHttps: {
          type: "boolean",
          description: "默认 false：尽量上传 HTTPS，失败仍可本地入库。为 true 时必须出 HTTPS（否则失败），远端视频分镜用。",
        },
        preserveOriginal: {
          type: "boolean",
          description: "默认 false。为 true 时跳过上传前缩放/压缩（仅用户明确要求原图存档时使用）。",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    toolName: "wodeapp_batch_image_prepare",
    actionId: "wodeapp.batch_image.open",
    groups: ["image"],
    label: "准备批量生图",
    description: "打开图片工作室预填草稿（不生图、不扣费）。用户想先在工作台挑图/调 prompt 再生成时用。直接出图用 product_visual_batch_image_run。",
    effect: "write",
    approval: "auto",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "商品生图任务简述，包括产品、卖点、主题和张数。" },
        productName: { type: "string", description: "商品名称。" },
        productInfo: { type: "string", description: "商品卖点、规格、颜色和使用场景。" },
        productImages: {
          type: "array",
          items: { type: "string" },
          uniqueItems: true,
          description: "已云同步、可供远端工作台读取的 HTTPS 商品图。",
        },
        referenceImages: {
          type: "array",
          items: { type: "string" },
          uniqueItems: true,
          description: "已云同步、可供远端工作台读取的 HTTPS 风格或场景参考图。",
        },
        sourceAssetId: { type: "string", description: "来源商品资产 ID。" },
        selectedCreativeTypes: {
          type: "array",
          items: { type: "string" },
          uniqueItems: true,
          description: "要在工作室预选的图片类型 ID。",
        },
        iterCount: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          description: "每个图片类型计划准备的卡片数。未传数量时，工具按总计 10 张卡片分配。",
        },
        targetTotalImages: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description: "计划准备的待生成卡片总数；未传时默认为 10。",
        },
        aspectRatio: { type: "string", description: "计划使用的画幅比例。" },
        activeMode: {
          type: "string",
          enum: ["full"],
          description: "固定为 full，以便工作室先展示 Planner 生成的待生成卡片。",
        },
        showUi: {
          type: "boolean",
          default: true,
          description: "是否打开第三栏工作室；设为 false 时只保存草稿，仍不会执行生成。",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    toolName: "wodeapp_generation_history_save",
    actionId: "wodeapp.generation_history.save",
    groups: ["assets"],
    label: "保存生成记录",
    description: "把生成成功的 URL 写入生成历史。video_generate / video_task_status（wodeapp.video.generate / .status）成功后已自动保存，不必再调。其他出图/出片路径成功后、或用户要「收藏/记到历史」时主动调用。必填 kind + url/urls。",
    effect: "write",
    approval: "auto",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", minLength: 1, description: "生成内容分类。" },
        urls: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          uniqueItems: true,
          description: "一个或多个生成结果 URL。",
        },
        url: { type: "string", minLength: 1, description: "单个生成结果 URL。" },
        name: { type: "string", description: "生成记录名称。" },
        productName: { type: "string", description: "关联商品名称。" },
        prompt: { type: "string", description: "本次生成提示词或需求摘要。" },
        taskId: { type: "string", description: "生成任务 ID。" },
        model: { type: "string", description: "生成模型。" },
        provider: { type: "string", description: "模型供应商或执行路径。" },
        shareUrl: { type: "string", description: "可分享的项目或任务 URL。" },
        taskUrl: { type: "string", description: "可分享的任务 URL。" },
        launchUrl: { type: "string", description: "可打开的项目 URL。" },
        durationLabel: { type: "string", description: "时长标签。" },
        sourceAssetId: { type: "string", description: "来源商品、品牌或素材资产 ID。" },
      },
      required: ["kind"],
      anyOf: [
        { required: ["url"] },
        { required: ["urls"] },
      ],
      additionalProperties: false,
    },
  },
  {
    toolName: "video_generate",
    actionId: "wodeapp.video.generate",
    groups: ["video"],
    label: "生成单条视频",
    description: "单条 AI 视频（文生/图生/参考视频/首尾帧运镜）。≤15s；多条用 wodeapp_video_storyboard_open。传 prompt，可选 productImages/referenceImages/referenceVideos；有参考视频时默认 Seedance omni，也可 provider=minimax（MiniMax-H3）。首尾帧两张图 + taskType=firstlast。勿传 model（minimax 由服务端默认 MiniMax-H3）。默认 wait=true。",
    effect: "write",
    approval: "auto",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", minLength: 1, description: "完整连续视频提示词，不要拆成多条分镜；需要包含开场钩子、商品/主体动作、卖点证明和结尾。" },
        topic: { type: "string", description: "任务标题，如「有钛炒锅模特手持 15 秒竖版视频」。" },
        duration: { type: "number", description: "视频时长秒数。用户指定了时长则必须按该秒数传入；未指定时默认 15。平台默认模型上限 15s；更长请拆多段。" },
        durationSec: { type: "number", description: "同 duration；优先使用。用户要 15 秒时传 15，不要省略。" },
        wait: { type: "boolean", description: "是否提交后阻塞轮询到完成。默认 true。仅当用户明确只要提交不等结果时才传 false。" },
        waitTimeoutSec: { type: "number", description: "wait=true 时最长等待秒数，默认 720（12 分钟）。超时仍 processing 时返回 taskId，并应继续调 video_task_status。" },
        ratio: { type: "string", description: "画幅，如 9:16、1:1、16:9，默认 9:16。" },
        aspectRatio: { type: "string", description: "同 ratio。" },
        productName: { type: "string", description: "来自 @商品 或用户描述的商品名称。" },
        productInfo: { type: "string", description: "商品卖点、规格、材质、品牌约束。" },
        productImages: {
          type: "array",
          items: { type: "string" },
          description: "商品图 URL 数组（HTTPS）。",
        },
        referenceImages: {
          type: "array",
          items: { type: "string" },
          description: "模特、场景、品牌、首尾帧、上一轮生成图等参考图 URL 数组。不要传 data:image...；首尾帧运镜时按顺序传起止两帧（会映射为 imageUrl + lastFrameUrl）。",
        },
        referenceVideos: {
          type: "array",
          items: { type: "string" },
          description: "动作/运动参考视频 HTTPS URL 数组（mp4/webm 等可播地址；GIF 须先转成视频再上传拿 HTTPS）。写入 input.referenceVideos，Seedance 以 reference_video 角色参考运动；provider=minimax 时自动升 MiniMax-H3（官方 V2）。有值时默认 taskType=omni。最多建议 1–3 条。不要传 data: 或 file://。",
        },
        image: { type: "string", description: "首帧图 URL（firstlast/image2video）；也可放在 referenceImages[0]。" },
        imageUrl: { type: "string", description: "同 image。" },
        imageTail: { type: "string", description: "尾帧图 URL（firstlast）；也可放在 referenceImages[1]。" },
        lastFrameUrl: { type: "string", description: "同 imageTail。" },
        referenceNames: {
          type: "array",
          items: { type: "string" },
          description: "referenceImages 对应的主体名，如 参考模特、首帧、尾帧。",
        },
        referenceTypes: {
          type: "array",
          items: { type: "string" },
          description: "referenceImages 对应类型：character、scene、prop。",
        },
        subjects: {
          type: "array",
          items: { type: "object" },
          description: "显式素材主体数组 {name,type:character|prop|scene,description?,imageUrl?}。",
        },
        provider: { type: "string", description: "视频引擎：auto、seedance、kling、minimax（Hailuo 低成本档，6s/10s）等。默认 auto。有 referenceVideos 时用 auto/seedance。可用引擎以 GET /runtime-server/api/video/tasks/providers 返回为准。" },
        model: { type: "string", description: "一般忽略勿传：auto/seedance 固定平台默认 Seedance 2.0 Mini（≤15s）；provider=minimax 时由服务端选 Hailuo 默认模型（≤10s），仅允许传 Hailuo 系别名（如 hailuo-02）。" },
        modelId: { type: "string", description: "model 别名；同样忽略。" },
        taskType: { type: "string", description: "text2video、image2video、omni、firstlast；首尾帧运镜用 firstlast；有 referenceVideos 时默认 omni；否则按参考图数量自动判断。" },
        mode: { type: "string", description: "质量模式，如 std、pro、1080p。" },
        resolution: { type: "string", description: "分辨率，如 720p、1080p。" },
        soundEnabled: { type: "boolean", description: "是否生成/保留音频，支持的引擎会透传。" },
        voiceoverText: { type: "string", description: "对白、旁白或口播文字，会随视频提示词一起提交。" },
        dialogue: { type: "string", description: "兼容字段：角色对白。" },
        narration: { type: "string", description: "兼容字段：旁白或解说。" },
      },
      required: ["prompt"],
      additionalProperties: false,
    },
  },
  {
    toolName: "video_task_status",
    actionId: "wodeapp.video.status",
    groups: ["video"],
    label: "查询视频任务",
    description: "查询 video_generate 已提交任务的状态与 videoUrl。generate 默认会自行等待；仅在其超时仍 processing、用户要复查旧 taskId、或显式 wait=false 时调用。若仍未完成，应继续轮询本工具直到 succeed/failed，不要停下来让用户自己追问进度。",
    effect: "read",
    approval: "auto",
    inputSchema: {
      type: "object",
      properties: {
        taskId: { type: "string", minLength: 1, description: "视频任务 ID，如 vtask_xxx。" },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
  },
  {
    toolName: "wodeapp_video_storyboard_open",
    actionId: "wodeapp.video_storyboard.open",
    groups: ["video"],
    label: "打开多条/分镜视频",
    description: "新建分镜工作台。N 条/分镜/短剧出片首包用本工具；单条文生/图生/首尾帧用 video_generate。勿传 model（默认 Seedance 2.0 Mini≤15s）。必填 scenes[]；多集 groups+groupId。大批量追加用 wodeapp_video_storyboard_update（shareDocId+delta≤25）。勿 create_page 冒充分组。",
    effect: "write",
    approval: "auto",
    inputSchema: {
      type: "object",
      properties: {
        shareDocId: { type: "string", description: "已有分镜 ID（pvs_*）。修参/补素材/追加集分组时必带，原地更新；省略则新建。禁止每集新建 shareDoc。大批量增量请改用 wodeapp_video_storyboard_update。" },
        pvsRun: { type: "string", description: "shareDocId 旧别名；优先 shareDocId。" },
        topic: { type: "string", description: "任务主题。" },
        aspectRatio: { type: "string", description: "画幅，如 9:16；默认 9:16。" },
        durationSec: { type: "number", description: "全局单段秒数，默认 15。平台默认模型上限 15s；scene.duration 可覆盖，更长请拆条。" },
        model: { type: "string", description: "已忽略勿传。平台默认 Seedance 2.0 Mini（≤15s）。" },
        modelId: { type: "string", description: "model 别名；同样忽略。" },
        groups: {
          type: "array",
          description: "工作台「新建分组」定义（幕/集/段落）。多集时必传：每项 {id, title?, order?}；scene.groupId 引用 groups[].id。同一项目不同分组 = 1 个 shareDoc + 多个 groups。",
          items: { type: "object" },
        },
        scenes: {
          type: "array",
          minItems: 1,
          description: "视频段数组。用户要 N 条/N 段就传 N 项。每项含 prompt（画面脚本，参考图用 [subject名] 引用）、duration（默认上限 15s）、groupId（= groups[].id，多集时一集一组）、orderInGroup。勿传 scene.model。prompt 时间轴不得超过该条 duration。",
          items: { type: "object" },
        },
        subjects: {
          type: "array",
          description: "参考图素材 {name, type:character|prop|scene, imageUrl}。name 须与 scenes[].prompt 里 [name] 逐字一致。imageUrl 须为 https://。",
          items: { type: "object" },
        },
        productId: { type: "string", description: "商品库 assetId；动作自动取商品图并挂载。" },
        sourceAssetId: { type: "string", description: "productId 别名。" },
        product: { type: "string", description: "兼容字段：assetId 或商品名；优先传 productId。" },
        productName: { type: "string", description: "商品 subject 名；prompt 用 [productName] 引用。" },
        productInfo: { type: "string", description: "商品卖点/规格描述。" },
        productImages: {
          type: "array",
          items: { type: "string" },
          description: "HTTPS 商品图列表；一般传 productId 即可。",
        },
        referenceImages: {
          type: "array",
          items: { type: "string" },
          description: "HTTPS 额外参考图（模特/场景等），须在 prompt 用 [name] 引用。",
        },
      },
      required: ["scenes"],
      additionalProperties: false,
    },
  },
  {
    toolName: "wodeapp_video_storyboard_update",
    actionId: "wodeapp.video_storyboard.update",
    groups: ["video"],
    label: "增量更新分镜视频",
    description: "增量更新已有分镜 shareDoc（合并追加，保留各镜 videoRefs）。必填 shareDocId；只传本批新增或要改的 scenes（同名/同 id 覆盖，新名追加），禁止把已有全集再塞一遍。可选只传本批新增 groups（按 id 合并，不传则保留原 groups）。每批 scenes 建议 ≤25 条；更大请多批调用。subjects/productId 可选。不自动开跑。",
    effect: "write",
    approval: "auto",
    inputSchema: {
      type: "object",
      properties: {
        shareDocId: { type: "string", minLength: 1, description: "必填。已有分镜 docId（pvs_* / pvs-*）。" },
        pvsRun: { type: "string", description: "shareDocId 旧别名；优先 shareDocId。" },
        topic: { type: "string", description: "可选；不传则保留原 topic。" },
        aspectRatio: { type: "string", description: "可选画幅；不传则保留原 inputSnapshot。" },
        durationSec: { type: "number", description: "本批默认单段秒数；不传则沿用原默认。" },
        model: { type: "string", description: "已忽略勿传。" },
        modelId: { type: "string", description: "model 别名；同样忽略。" },
        groups: {
          type: "array",
          minItems: 1,
          description: "可选。只传本批新增/要改的分组 {id,title?,order?}；按 id 与现有 groups 合并。勿为「追加几集」重传全部 30 个 groups，除非要改标题。",
          items: { type: "object" },
        },
        scenes: {
          type: "array",
          minItems: 1,
          maxItems: 25,
          description: "本批新增或修改的分镜（≤25）。只传 delta：新 name 追加，同 name/id 更新并保留 videoRefs。禁止重传整个项目的全部 scenes。",
          items: { type: "object" },
        },
        subjects: {
          type: "array",
          description: "本批要补充的参考图 subjects；按 name 合并。",
          items: { type: "object" },
        },
        productId: { type: "string", description: "商品库 assetId；可选。" },
        sourceAssetId: { type: "string", description: "productId 别名。" },
        product: { type: "string", description: "兼容字段：assetId 或商品名。" },
        productName: { type: "string", description: "商品 subject 名。" },
        productInfo: { type: "string", description: "商品卖点/规格描述。" },
        productImages: {
          type: "array",
          items: { type: "string" },
          description: "HTTPS 商品图列表。",
        },
        referenceImages: {
          type: "array",
          items: { type: "string" },
          description: "HTTPS 额外参考图。",
        },
      },
      required: ["shareDocId"],
      anyOf: [
        { required: ["scenes"] },
        { required: ["groups"] },
      ],
      additionalProperties: false,
    },
  },
] as const satisfies readonly WodeAppDirectActionContract[]);

export type WodeAppDirectToolName = typeof WODEAPP_DIRECT_ACTION_CONTRACTS[number]["toolName"];
export type WodeAppDirectActionId = typeof WODEAPP_DIRECT_ACTION_CONTRACTS[number]["actionId"];

function indexDirectActionContracts(
  key: "actionId" | "toolName",
): ReadonlyMap<string, WodeAppDirectActionContract> {
  const indexed = new Map<string, WodeAppDirectActionContract>();
  for (const contract of WODEAPP_DIRECT_ACTION_CONTRACTS) {
    const value = contract[key];
    if (indexed.has(value)) throw new Error(`Duplicate WodeApp direct action ${key}: ${value}`);
    indexed.set(value, contract);
  }
  return indexed;
}

export const WODEAPP_DIRECT_ACTION_CONTRACT_BY_ACTION_ID = indexDirectActionContracts("actionId");

export const WODEAPP_DIRECT_ACTION_CONTRACT_BY_TOOL_NAME = indexDirectActionContracts("toolName");

export const WODEAPP_DIRECT_TOOL_NAMES = Object.freeze(
  WODEAPP_DIRECT_ACTION_CONTRACTS.map((contract) => contract.toolName),
) as readonly WodeAppDirectToolName[];

function directToolNamesForGroup(
  group: WodeAppDirectActionGroup,
): readonly WodeAppDirectToolName[] {
  return Object.freeze(
    WODEAPP_DIRECT_ACTION_CONTRACTS
      .filter((contract: WodeAppDirectActionContract) => contract.groups.includes(group))
      .map((contract) => contract.toolName),
  );
}

export const WODEAPP_ASSET_DIRECT_TOOL_NAMES = directToolNamesForGroup("assets");

export const WODEAPP_FOUNDATION_DIRECT_TOOL_NAMES = directToolNamesForGroup("foundation");

export const WODEAPP_AGENT_DIRECT_TOOL_NAMES = directToolNamesForGroup("agents");

export const WODEAPP_IMAGE_DIRECT_TOOL_NAMES = directToolNamesForGroup("image");

export const WODEAPP_VIDEO_DIRECT_TOOL_NAMES = directToolNamesForGroup("video");

function rendererArgumentType(
  schemaType: WodeAppJsonSchema["type"],
): WodeAppRendererActionArg["type"] {
  if (Array.isArray(schemaType)) return "unknown";
  if (schemaType === "integer") return "number";
  if (
    schemaType === "string"
    || schemaType === "number"
    || schemaType === "boolean"
    || schemaType === "object"
    || schemaType === "array"
  ) {
    return schemaType;
  }
  return "unknown";
}

export function directActionInputSchemaToRendererArgs(
  inputSchema: WodeAppDirectActionInputSchema,
): readonly WodeAppRendererActionArg[] {
  const required = new Set(inputSchema.required);
  return Object.entries(inputSchema.properties).map(([name, propertySchema]) => ({
    name,
    type: rendererArgumentType(propertySchema.type),
    required: required.has(name),
    ...(propertySchema.description ? { description: propertySchema.description } : {}),
  }));
}

/**
 * JSON Schema sent to the LLM via tool.definition.
 * Keep anyOf/oneOf on the contract for local Zod validation, but strip them from
 * model-facing schemas — Moonshot rejects parent `type` + `anyOf`.
 */
export function modelFacingDirectActionInputSchema(
  inputSchema: WodeAppDirectActionInputSchema,
): WodeAppDirectActionInputSchema {
  const clone = structuredClone(inputSchema) as WodeAppDirectActionInputSchema & {
    anyOf?: unknown;
    oneOf?: unknown;
    description?: string;
  };
  const alternatives = [
    ...(Array.isArray(clone.anyOf) ? clone.anyOf : []),
    ...(Array.isArray(clone.oneOf) ? clone.oneOf : []),
  ] as Array<{ required?: readonly string[] }>;
  const requiredOnly = alternatives.filter((alt) => (
    alt
    && typeof alt === "object"
    && Array.isArray(alt.required)
    && Object.keys(alt).every((key) => key === "required" || key === "type")
  ));
  if (requiredOnly.length > 0) {
    const hint = requiredOnly
      .map((alt) => (alt.required ?? []).join("+"))
      .filter(Boolean)
      .join(" 或 ");
    if (hint) {
      const note = `须满足其一：${hint}`;
      clone.description = clone.description?.trim()
        ? `${clone.description}（${note}）`
        : note;
    }
  }
  delete clone.anyOf;
  delete clone.oneOf;
  return clone;
}
