import { requestWodeAppChatCompletion, requestWodeAppRuntimeJson, requestWodeAppVision } from "@/app/lib/wodeapp-auth";
import {
  PRODUCT_IMAGE_NAME_BATCH_MS,
  PRODUCT_IMAGE_NAME_MAX_LEN,
  PRODUCT_IMAGE_NAME_PER_IMAGE_MS,
  sanitizeProductImageName,
} from "./digital-assets-image-name";

export { sanitizeProductImageName } from "./digital-assets-image-name";

const DEFAULT_WODEAPP_TEXT_MODEL = "wode/kimi-code-k3-256k";
const AI_IMAGE_MAX_PX = 1280;
const AI_IMAGE_QUALITY = 0.72;

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: string | { message?: string };
};

export type ProductVisionDraft = {
  name?: string;
  info?: string;
};

export type BrandExtractDraft = {
  name?: string;
  colors?: string[];
  voice?: string;
  rules?: string;
  entries?: Array<{
    category?: string;
    title?: string;
    description?: string;
    keywords?: string[];
    scenePrompt?: string;
  }>;
};

export type BrandWebLookupSource = {
  title: string;
  url: string;
  snippet?: string;
  publishedDate?: string;
  source?: string;
};

export type BrandWebLookupResult = {
  brandName: string;
  query: string;
  sourceText: string;
  sources: BrandWebLookupSource[];
};

type BrandLookupApiResponse = {
  success?: boolean;
  error?: string;
  brandName?: string;
  query?: string;
  sourceText?: string;
  sources?: BrandWebLookupSource[];
};

function readErrorMessage(payload: ChatCompletionResponse | null, fallback: string): string {
  if (!payload?.error) return fallback;
  if (typeof payload.error === "string") return payload.error;
  return payload.error.message || fallback;
}

function extractResponseText(payload: ChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" || !part.type ? part.text || "" : ""))
      .join("\n")
      .trim();
  }
  return "";
}

function parseJsonObject<T>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const direct = JSON.parse(trimmed) as T;
  return direct;
}

function parseJsonFromText<T>(text: string): T {
  try {
    return parseJsonObject<T>(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return parseJsonObject<T>(text.slice(start, end + 1));
    }
    throw new Error("AI 返回格式无法解析");
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片读取失败"));
    image.src = src;
  });
}

async function compressDataUrlForAI(src: string): Promise<string> {
  if (!src.startsWith("data:image/")) return src;
  try {
    const image = await loadImage(src);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const maxDim = Math.max(width, height);
    if (!width || !height || maxDim <= AI_IMAGE_MAX_PX) return src;

    const scale = AI_IMAGE_MAX_PX / maxDim;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return src;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", AI_IMAGE_QUALITY);
  } catch {
    return src;
  }
}

async function prepareImagesForAI(images: string[]): Promise<string[]> {
  return Promise.all(images.map(compressDataUrlForAI));
}

async function requestTextAssetDraft<T>(prompt: string): Promise<T> {
  const payload = await requestWodeAppChatCompletion({
    model: DEFAULT_WODEAPP_TEXT_MODEL,
    stream: false,
    temperature: 0.2,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  }) as ChatCompletionResponse | null;

  const text = payload ? extractResponseText(payload) : "";
  if (payload?.error) throw new Error(readErrorMessage(payload, "AI 提取失败，请稍后再试。"));
  if (!text) throw new Error("AI 没有返回可用内容。");
  return parseJsonFromText<T>(text);
}

async function requestVisionAssetDraft<T>(prompt: string, imageUrl: string[]): Promise<T> {
  const payload = await requestWodeAppVision({
    imageUrl,
    prompt,
    systemPrompt: "你是严谨的品牌和商品视觉资产整理助手。只输出用户要求的 JSON，不要输出 Markdown 或解释。",
    mediaType: "image",
  });
  const text = payload.data?.content?.trim() || "";
  if (!text) throw new Error("AI 没有返回可用内容。");
  return parseJsonFromText<T>(text);
}

export async function analyzeProductImagesWithAI(images: string[]): Promise<ProductVisionDraft> {
  const selectedImages = images.filter(Boolean).slice(0, 4);
  if (!selectedImages.length) throw new Error("请先上传商品图。");
  const preparedImages = await prepareImagesForAI(selectedImages);

  const prompt =
    "请识别这些商品图片，并只返回一个 JSON 对象，不要 Markdown。格式：" +
    '{"name":"商品名称或类型","info":"商品外观、用途、材质、颜色和适合生成时参考的要点。"}' +
    " 只描述能从图片或包装中判断的内容；看不清的品牌、型号、SKU、价格或资质不要写，不要臆造。";

  return requestVisionAssetDraft<ProductVisionDraft>(prompt, preparedImages);
}

const PRODUCT_IMAGE_NAME_PROMPT =
  "给这张商品参考图起一个短标签，必须对应画面里看得见的主体/配件/角度。" +
  "只输出一个短语：纯中文、2到16个字、不要标点、不要引号、不要解释、不要营销词。" +
  "正确示例：主机带盖、平烤盘、条纹烤盘、不锈钢蒸格、开盖俯视。" +
  "禁止：图1、图2、图片1、参考图2、商品图3、附件1 等序号名。" +
  "看不清就输出空。";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function nameProductImageLightweight(imageUrl: string): Promise<string | undefined> {
  const prepared = await compressDataUrlForAI(imageUrl);
  const payload = await requestWodeAppVision({
    imageUrl: [prepared],
    prompt: PRODUCT_IMAGE_NAME_PROMPT,
    systemPrompt: "你只输出商品图短标签，遵守用户格式约束，不要 JSON，不要 Markdown。",
    mediaType: "image",
  });
  return sanitizeProductImageName(payload.data?.content);
}

/**
 * Best-effort naming for newly added product images.
 * Failures / timeouts leave names empty and never throw to the caller.
 */
export async function nameNewProductImages(
  imageUrls: string[],
  options?: { perImageTimeoutMs?: number; batchTimeoutMs?: number },
): Promise<Map<string, string>> {
  const urls = [...new Set(imageUrls.map((url) => url.trim()).filter(Boolean))];
  const named = new Map<string, string>();
  if (!urls.length) return named;

  const perImageTimeoutMs = options?.perImageTimeoutMs ?? PRODUCT_IMAGE_NAME_PER_IMAGE_MS;
  const batchTimeoutMs = options?.batchTimeoutMs ?? PRODUCT_IMAGE_NAME_BATCH_MS;
  const drafts = new Map<string, string>();

  const tasks = urls.map(async (url) => {
    try {
      const label = await withTimeout(nameProductImageLightweight(url), perImageTimeoutMs);
      if (label) drafts.set(url, label);
    } catch {
      // leave empty
    }
  });

  try {
    await withTimeout(Promise.all(tasks), batchTimeoutMs);
  } catch {
    // keep whatever finished
  }

  const used = new Set<string>();
  for (const url of urls) {
    const label = drafts.get(url);
    if (!label) continue;
    let unique = label;
    let suffix = 2;
    while (used.has(unique)) {
      const base = label.slice(0, Math.max(1, PRODUCT_IMAGE_NAME_MAX_LEN - String(suffix).length));
      unique = `${base}${suffix}`;
      suffix += 1;
    }
    used.add(unique);
    named.set(url, unique);
  }
  return named;
}

export async function extractBrandWithAI(input: { text: string; images?: string[] }): Promise<BrandExtractDraft> {
  const sourceText = input.text.trim();
  const selectedImages = (input.images || []).filter(Boolean).slice(0, 4);
  if (!sourceText && !selectedImages.length) {
    throw new Error("请先输入品牌资料，或上传 Logo / 品牌资源。");
  }
  const preparedImages = await prepareImagesForAI(selectedImages);

  const prompt =
    "请从品牌资料和图片中提取品牌资产草稿，并只返回一个 JSON 对象，不要 Markdown。格式：" +
    '{"name":"品牌名称","colors":["#000000"],"voice":"品牌语气摘要","rules":"产品画面、Logo、色彩、版式、画面风格和禁用事项。","entries":[{"category":"产品","title":"条目标题","description":"用于搜索和生成的说明","keywords":["关键词"],"scenePrompt":"生成对应场景时的提示"}]}' +
    " entries 输出 6 到 10 个条目，优先覆盖核心产品或服务、用户场景、交付物、关键流程、界面/包装/门店等真实触点，再覆盖定位、Logo、色彩、文案语气和禁用规则。" +
    " 如果资料里能识别出产品线、功能模块、SKU、套餐、服务流程、销售渠道或典型用户任务，必须至少输出 2 个产品/服务相关条目，不要只输出抽象品牌规范。" +
    " colors 必须是 1 到 6 个十六进制色值；如果公开品牌的 Logo 或主视觉色彩非常明确，可以给出适合设计落地的近似 hex；只有完全无法判断时才留空，不要返回示例色。" +
    " 如果资料中只有品牌名称，或图片无法识别出足够信息，不要输出“无更多资料”“无法生成场景提示”等占位条目；只返回可确认字段，缺失字段留空。" +
    " 如果资料包含“品牌名称：xxx”，将 name 设为该名称。" +
    `\n\n品牌资料：\n${sourceText || "未提供文字资料"}`;

  return preparedImages.length
    ? requestVisionAssetDraft<BrandExtractDraft>(prompt, preparedImages)
    : requestTextAssetDraft<BrandExtractDraft>(prompt);
}

export async function lookupBrandWithWebSearch(input: { brandName: string }): Promise<BrandWebLookupResult> {
  const brandName = input.brandName.trim();
  if (!brandName) throw new Error("请先输入品牌名称。");

  const requestInit = {
    method: "POST",
    body: JSON.stringify({
      brandName,
      maxResults: 6,
    }),
  };
  let payload: BrandLookupApiResponse;
  try {
    payload = await requestWodeAppRuntimeJson<BrandLookupApiResponse>("/research/brand-lookup", requestInit, 90000);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "");
    const shouldTryCompatPath =
      message.includes("接口不存在") ||
      message.includes("NOT_FOUND") ||
      message.includes("404");
    if (!shouldTryCompatPath) throw error;
    payload = await requestWodeAppRuntimeJson<BrandLookupApiResponse>("/brand-lookup", requestInit, 90000);
  }

  if (payload.success === false) {
    throw new Error(payload.error || "联网补全失败，请稍后再试。");
  }
  const sourceText = payload.sourceText?.trim();
  const sources = Array.isArray(payload.sources) ? payload.sources.filter((source) => source?.url || source?.snippet) : [];
  if (!sourceText || !sources.length) {
    throw new Error("没有找到可用的品牌公开资料。");
  }

  return {
    brandName: payload.brandName?.trim() || brandName,
    query: payload.query?.trim() || brandName,
    sourceText,
    sources,
  };
}
