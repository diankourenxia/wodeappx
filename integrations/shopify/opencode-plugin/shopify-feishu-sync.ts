export type JsonRecord = Record<string, unknown>;

export const DEFAULT_FEISHU_FIELD_MAP: Record<string, string> = {
  shopifyId: "Shopify ID",
  handle: "Handle",
  title: "标题",
  status: "状态",
  vendor: "Vendor",
  productType: "类型",
  price: "价格",
  inventory: "库存",
  imageUrl: "主图",
  tags: "Tags",
  onlineStoreUrl: "链接",
  updatedAt: "更新时间",
};

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeFeishuFieldMap(fieldMap?: Record<string, string>): Record<string, string> {
  return { ...DEFAULT_FEISHU_FIELD_MAP, ...(fieldMap || {}) };
}

function productPrice(product: JsonRecord): string {
  const range = isRecord(product.priceRange) ? product.priceRange : {};
  const min = isRecord(range.minVariantPrice) ? range.minVariantPrice : {};
  const amount = min.amount ?? min.value ?? product.price;
  const currency = min.currencyCode || min.currency || "";
  if (amount === undefined || amount === null || amount === "") return "";
  return currency ? `${amount} ${currency}` : String(amount);
}

export function mapShopifyProductToFeishuFields(
  product: JsonRecord,
  fieldMap?: Record<string, string>,
): Record<string, string> {
  const map = mergeFeishuFieldMap(fieldMap);
  const tags = Array.isArray(product.tags) ? product.tags.map(String).join(", ") : String(product.tags || "");
  const values: Record<string, string> = {
    [map.shopifyId]: String(product.id || product.shortId || ""),
    [map.handle]: String(product.handle || ""),
    [map.title]: String(product.title || ""),
    [map.status]: String(product.status || ""),
    [map.vendor]: String(product.vendor || ""),
    [map.productType]: String(product.productType || ""),
    [map.price]: productPrice(product),
    [map.inventory]: String(product.totalInventory ?? ""),
    [map.imageUrl]: String(product.imageUrl || ""),
    [map.tags]: tags,
    [map.onlineStoreUrl]: String(product.onlineStoreUrl || ""),
    [map.updatedAt]: String(product.updatedAt || ""),
  };
  for (const [key, value] of Object.entries(values)) {
    if (!key || value === "") delete values[key];
  }
  return values;
}
