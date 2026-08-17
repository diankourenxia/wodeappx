const PRODUCT_IMAGE_NAME_MAX = 16;
const PRODUCT_IMAGE_NAME_MIN = 2;

/** Ordinal / placeholder labels that must never become product media names. */
const GENERIC_PRODUCT_IMAGE_NAME_PATTERN =
  /^(?:图|图片|照片|相片|参考图|商品图|附件|素材|截图)(?:\s*[0-9０-９a-zA-Z一二三四五六七八九十百nN]+)?$|^第[0-9０-９一二三四五六七八九十]+张$|^(?:image|photo|pic|img|file)\s*[0-9０-９a-zA-Z]*$/i;

export function isGenericProductImageName(raw: string | undefined | null): boolean {
  const text = String(raw || "").trim().replace(/\s+/g, "");
  if (!text) return true;
  return GENERIC_PRODUCT_IMAGE_NAME_PATTERN.test(text);
}

/** Post-process vision output into a short Chinese product-image label, or empty. */
export function sanitizeProductImageName(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  let text = String(raw)
    .trim()
    .replace(/^```(?:\w+)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^["'「『【\[]+|["'」』】\]]+$/g, "")
    .split(/[\r\n]+/)[0]
    ?.trim() || "";
  text = text
    .replace(/[，。！？、；：,.!?;:"""''（）()【】\[\]{}<>《》·…—\-_/\\|]+/g, "")
    .replace(/\s+/g, "");
  if (!text) return undefined;
  if (!/[\u4e00-\u9fff]/.test(text)) return undefined;
  if (text.length > PRODUCT_IMAGE_NAME_MAX) text = text.slice(0, PRODUCT_IMAGE_NAME_MAX);
  if (text.length < PRODUCT_IMAGE_NAME_MIN) return undefined;
  if (/(展示图|宣传|种草|爆款|好物|推荐|这是|一张|图片)/.test(text)) {
    text = text
      .replace(/展示图|宣传图|种草|爆款|好物推荐|好物|推荐|这是一张|这是|一张|图片/g, "")
      .trim();
    if (text.length < PRODUCT_IMAGE_NAME_MIN || text.length > PRODUCT_IMAGE_NAME_MAX) return undefined;
  }
  if (isGenericProductImageName(text)) return undefined;
  return text;
}

export const PRODUCT_IMAGE_NAME_PER_IMAGE_MS = 3000;
export const PRODUCT_IMAGE_NAME_BATCH_MS = 10000;
export const PRODUCT_IMAGE_NAME_MAX_LEN = PRODUCT_IMAGE_NAME_MAX;
