import type { DigitalAssetItem } from "./digital-assets-data";
import { ensureDigitalAssetDocument } from "./digital-asset-document-format";

export const SUPOR_SITE_ORIGIN = "https://supor.wodeapp.cn";

const P = `${SUPOR_SITE_ORIGIN}/supor-assets/products`;

/** Brand mark (logo), not product photography. Data URL so desktop works without CDN deploy. */
const SUPOR_BRAND_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 120" role="img" aria-label="苏泊尔 SUPOR"><rect width="360" height="120" fill="#FFFFFF"/><text x="180" y="58" text-anchor="middle" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="44" font-weight="700" fill="#FF6600">苏泊尔</text><text x="180" y="92" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="16" font-weight="600" letter-spacing="8" fill="#1A1A1A">SUPOR</text></svg>`;
export const SUPOR_BRAND_LOGO_URL =
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SUPOR_BRAND_LOGO_SVG)}`;

/** Curated demo shelf: real product photos + brand logo guideline. */
const SUPOR_SITE_DIGITAL_ASSETS_RAW: DigitalAssetItem[] = [
  {
    id: "supor-site-product-12-titanium-wok-cc34jg3",
    name: "有钛无涂层不粘炒锅 CC34JG3",
    kind: "商品库",
    meta: "套图 · 炊具",
    preview: "product",
    coverImage: `${P}/12-苏泊尔有钛无涂层不粘炒锅-CC34JG3.png`,
    productImages: [
      `${P}/12-苏泊尔有钛无涂层不粘炒锅-CC34JG3.png`,
      `${P}/11-火红点无油烟煎炒锅-华彩系列.png`,
      `${P}/10-火红点无油烟煎锅-华彩系列.jpg`,
    ],
    productInfo: [
      "产品名称：苏泊尔有钛无涂层不粘炒锅",
      "型号：CC34JG3",
      "品类：炊具",
      "核心卖点：有钛合金熔覆、无涂层物理抗粘、耐磨耐用",
      "适用：日常炒菜、少油烟家庭厨房",
    ].join(" · "),
    promptTags: ["有钛合金熔覆", "无涂层不粘", "物理抗粘", "套图可生成"],
    assetTime: "supor.wodeapp.cn",
    assetUse: "演示商品 · 可直接生成图/视频",
  },
  {
    id: "supor-site-product-05-range-hood",
    name: "追风系列超薄快吸油烟机",
    kind: "商品库",
    meta: "套图 · 厨电",
    preview: "product",
    coverImage: `${P}/05-追风系列超薄快吸油烟机.jpg`,
    productImages: [
      `${P}/05-追风系列超薄快吸油烟机.jpg`,
      `${P}/06-新一代深腔全能系列集成灶-AQ80X.jpg`,
      `${P}/04-云渚系列净热一体机.jpg`,
    ],
    productInfo: [
      "产品名称：追风系列超薄快吸油烟机",
      "品类：厨卫电器",
      "核心卖点：顶侧双吸、25m³/min 爆炒吸力、1000Pa 变频风压、超薄机身",
    ].join(" · "),
    promptTags: ["顶侧双吸", "大吸力", "超薄", "套图可生成"],
    assetTime: "supor.wodeapp.cn",
    assetUse: "演示商品 · 可直接生成图/视频",
  },
  {
    id: "supor-site-product-02-floor-washer",
    name: "苏泊尔洗地机",
    kind: "商品库",
    meta: "套图 · 清洁电器",
    preview: "product",
    coverImage: `${P}/02-苏泊尔洗地机.png`,
    productImages: [
      `${P}/02-苏泊尔洗地机.png`,
      `${P}/03-X3手持式吸尘器-XC05S63C-X3.jpg`,
      `${P}/01-除湿机02A.png`,
    ],
    productInfo: [
      "产品名称：苏泊尔洗地机",
      "品类：家居生活电器",
      "核心卖点：吸拖洗烘、除菌清洁、贴边清洁、自动感应",
    ].join(" · "),
    promptTags: ["吸拖洗烘", "除菌", "贴边清洁", "套图可生成"],
    assetTime: "supor.wodeapp.cn",
    assetUse: "演示商品 · 可直接生成图/视频",
  },
  {
    id: "supor-site-product-09-bw18s-milk-maker",
    name: "智能即沸即凉泡奶机 BW18S",
    kind: "商品库",
    meta: "套图 · 母婴",
    preview: "product",
    coverImage: `${P}/09-苏泊尔智能即沸即凉泡奶机-BW18S.jpg`,
    productImages: [
      `${P}/09-苏泊尔智能即沸即凉泡奶机-BW18S.jpg`,
      `${P}/08-苏泊尔奶瓶消毒器.jpg`,
      `${P}/07-苏泊尔分月龄辅食机.jpg`,
    ],
    productInfo: [
      "产品名称：苏泊尔智能即沸即凉泡奶机",
      "型号：BW18S",
      "品类：厨房小家电 / 母婴",
      "核心卖点：8 秒速沸急降、45℃ 鲜活水、AI 智适应、10ml 可调",
    ].join(" · "),
    promptTags: ["速沸急降", "泡奶", "母婴", "套图可生成"],
    assetTime: "supor.wodeapp.cn",
    assetUse: "演示商品 · 可直接生成图/视频",
  },
  {
    id: "supor-site-brand-01-brand-assets",
    name: "苏泊尔 品牌资产",
    kind: "品牌库",
    meta: "品牌规范",
    preview: "brand",
    coverImage: SUPOR_BRAND_LOGO_URL,
    brandAssets: [SUPOR_BRAND_LOGO_URL],
    promptText: [
      "苏泊尔品牌内容与视觉总规范。",
      "封面仅为 Logo / 品牌识别，不绑定任何单一 SKU 商品图。",
      "做主图、短视频、详情页、门店物料前先读本规范；具体商品摄影从商品库按 SKU 引用。",
    ].join("\n"),
    promptTags: ["Logo", "品牌主色", "语气", "拍摄", "禁用项", "渠道"],
    brandColors: ["#FF6600", "#1A1A1A", "#FFFFFF", "#F7F7F5"],
    brandVoice: [
      "清晰、可信、现代厨房生活。",
      "少口号、多场景；先讲「谁在什么场合得到什么结果」，再跟参数。",
      "口语但克制，不喊麦、不恐吓、不医疗化。",
    ].join(""),
    brandRules: [
      "Logo：保持官方比例，不拉伸、不改色、不加阴影描边；深色底用反白版本。",
      "主色：苏泊尔橙 #FF6600；辅色近黑 #1A1A1A、留白 #FFFFFF、浅底 #F7F7F5。",
      "摄影：结构清晰、自然厨房光、真实使用动作；禁止插画冒充商品图。",
      "文案：场景 → 结果 → 参数；禁止医疗功效、绝对化承诺、「全网最低」等。",
      "商品图：从商品库按 SKU 引用，不把单一商品图写死进品牌资产。",
      "渠道：电商主图卖点 ≤3 条；短视频竖屏 9:16；门店物料价格以当场为准。",
    ].join("\n"),
    brandEntries: [
      {
        id: "supor-brand-logo",
        category: "识别",
        title: "Logo 使用",
        description: "标准横版「苏泊尔 / SUPOR」与橙底标识字。最小清晰尺寸以保证中文可读；周围留白不少于字高 1/4。禁止拉伸、旋转、改色、加特效。",
        keywords: ["Logo", "留白", "比例", "反白"],
        scenePrompt: "画面出现品牌识别时使用标准 Logo，主色 #FF6600，不变形不改色。",
      },
      {
        id: "supor-brand-positioning",
        category: "定位",
        title: "品牌定位",
        description: "现代厨房生活方式品牌，面向家庭厨房决策者，强调好用、好看、可信。价值关键词：健康烹饪、效率省心、家庭品质。",
        keywords: ["健康烹饪", "效率省心", "家庭品质", "可信赖"],
        scenePrompt: "保持苏泊尔可信赖的现代厨房生活方式语气，避免夸张促销腔。",
      },
      {
        id: "supor-brand-voice",
        category: "语气",
        title: "内容语气",
        description: "像靠谱的家庭厨电顾问：具体、好懂、不装。示例：用「油烟少一点、收拾快一点」代替「颠覆式革命性体验」。",
        keywords: ["具体", "克制", "场景化", "不喊麦"],
        scenePrompt: "文案先给可感知结果，再补一句参数背书。",
      },
      {
        id: "supor-brand-visual",
        category: "视觉",
        title: "视觉锚点",
        description: "干净台面、自然窗光、产品结构清楚、苏泊尔橙点缀。主图留白克制，卖点层不超过三条。",
        keywords: ["真实摄影", "自然光", "苏泊尔橙", "结构清晰"],
        scenePrompt: "主色使用 #FF6600，画面干净可信，优先真实厨房光。",
      },
      {
        id: "supor-brand-photo",
        category: "拍摄",
        title: "拍摄规范",
        description: "全貌 → 功能特写 → 使用场景。主图浅底或木台；细节拍按键、涂层、出风口等；场景落家庭用餐或清洁瞬间。",
        keywords: ["全貌", "特写", "场景", "自然光"],
        scenePrompt: "生成/拍摄顺序：产品全貌，再 1–2 个功能特写，最后家庭使用场景。",
      },
      {
        id: "supor-brand-copy",
        category: "文案",
        title: "卖点表达",
        description: "结构：场景痛点 → 产品动作 → 可感知结果 → 一句参数。禁用：医疗功效、绝对化、贬低竞品、虚假价格承诺。",
        keywords: ["场景优先", "结果可见", "参数背书", "禁用项"],
        scenePrompt: "写卖点时用可感知结果（更省心、更干净），再跟关键参数。",
      },
      {
        id: "supor-brand-channel",
        category: "渠道",
        title: "渠道适配",
        description: "电商：方/竖主图 + ≤3 卖点。短视频：9:16，前 3 秒出产品。门店：大字识别 + 当场活动价，不写死促销数字在品牌规范里。",
        keywords: ["电商", "短视频", "门店"],
        scenePrompt: "按渠道裁切与信息密度输出，不把门店价格写进品牌资产。",
      },
    ],
    assetTime: "supor.wodeapp.cn",
    assetUse: "品牌规范",
  },
];

export const SUPOR_SITE_DIGITAL_ASSETS: DigitalAssetItem[] =
  SUPOR_SITE_DIGITAL_ASSETS_RAW.map((asset) => ensureDigitalAssetDocument(asset));

function suporAssetKey(asset: DigitalAssetItem): string {
  return `${asset.kind}:${asset.name}`.toLowerCase();
}

export function withSuporSiteDigitalAssets(assets: DigitalAssetItem[]): DigitalAssetItem[] {
  const seen = new Set(assets.map(suporAssetKey));
  return [
    ...assets,
    ...SUPOR_SITE_DIGITAL_ASSETS.filter((asset) => !seen.has(suporAssetKey(asset))),
  ];
}
