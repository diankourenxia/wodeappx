import type { DigitalAssetItem } from "./digital-assets-data";
import { ensureDigitalAssetDocument } from "./digital-asset-document-format";

export const SUPOR_SITE_ORIGIN = "https://supor.wodeapp.cn";

const P = `${SUPOR_SITE_ORIGIN}/supor-assets/products`;

/** Curated demo shelf: real product photos only. No SVG placeholders, no hollow scripts. */
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
    id: "supor-site-image-cookware-set",
    name: "炊具真实套图",
    kind: "图片",
    meta: "3 张 · 真实商品摄影",
    preview: "image",
    coverImage: `${P}/12-苏泊尔有钛无涂层不粘炒锅-CC34JG3.png`,
    assetImages: [
      `${P}/12-苏泊尔有钛无涂层不粘炒锅-CC34JG3.png`,
      `${P}/11-火红点无油烟煎炒锅-华彩系列.png`,
      `${P}/10-火红点无油烟煎锅-华彩系列.jpg`,
    ],
    promptText: "炊具类真实商品摄影套图，可作主图参考、详情页拼图或视频分镜静帧。",
    promptTags: ["套图", "炊具", "真实摄影"],
    assetTime: "supor.wodeapp.cn",
    assetUse: "演示套图",
  },
  {
    id: "supor-site-image-kitchen-appliance-set",
    name: "厨电真实套图",
    kind: "图片",
    meta: "3 张 · 真实商品摄影",
    preview: "image",
    coverImage: `${P}/05-追风系列超薄快吸油烟机.jpg`,
    assetImages: [
      `${P}/05-追风系列超薄快吸油烟机.jpg`,
      `${P}/06-新一代深腔全能系列集成灶-AQ80X.jpg`,
      `${P}/04-云渚系列净热一体机.jpg`,
    ],
    promptText: "厨电类真实商品摄影套图，适合场景合成与短视频静帧参考。",
    promptTags: ["套图", "厨电", "真实摄影"],
    assetTime: "supor.wodeapp.cn",
    assetUse: "演示套图",
  },
  {
    id: "supor-site-brand-01-brand-assets",
    name: "苏泊尔 品牌资产",
    kind: "品牌库",
    meta: "Markdown · 品牌规范",
    preview: "brand",
    coverImage: `${P}/12-苏泊尔有钛无涂层不粘炒锅-CC34JG3.png`,
    brandAssets: [
      `${P}/12-苏泊尔有钛无涂层不粘炒锅-CC34JG3.png`,
      `${P}/05-追风系列超薄快吸油烟机.jpg`,
    ],
    promptText: "生成苏泊尔电商主图、短视频与详情页时先对齐本规范。视觉参考为真实商品摄影。",
    promptTags: ["品牌主色", "语气", "拍摄锚点"],
    brandColors: ["#FF6600", "#1A1A1A", "#FFFFFF"],
    brandVoice: "清晰、可信、现代厨房生活。少口号、多场景；突出健康烹饪、效率省心与家庭品质。",
    brandRules: [
      "主色 #FF6600；辅色 #1A1A1A / #FFFFFF。",
      "摄影：结构清晰、自然厨房光、真实使用动作；禁止 SVG/插画冒充商品图。",
      "文案：场景 → 结果 → 参数；禁止医疗功效与绝对化承诺。",
    ].join("\n"),
    brandEntries: [
      {
        id: "supor-brand-positioning",
        category: "定位",
        title: "品牌定位",
        description: "现代厨房生活方式品牌，强调好用、好看、可信。",
        keywords: ["健康烹饪", "效率省心", "家庭品质"],
        scenePrompt: "保持苏泊尔可信赖的现代厨房生活方式语气。",
      },
      {
        id: "supor-brand-visual",
        category: "视觉",
        title: "视觉锚点",
        description: "干净台面、自然光、产品结构清楚、苏泊尔橙点缀。",
        keywords: ["真实摄影", "自然光", "苏泊尔橙"],
        scenePrompt: "主色使用 #FF6600，画面干净可信。",
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
