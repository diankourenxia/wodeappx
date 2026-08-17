import { describe, expect, test } from "bun:test";

import { mapShopifyProductToFeishuFields } from "../opencode-plugin/shopify-feishu-sync";

describe("Shopify → Feishu field mapping", () => {
  test("maps core product fields with default Chinese column names", () => {
    const fields = mapShopifyProductToFeishuFields({
      id: "gid://shopify/Product/123",
      handle: "brook-linen",
      title: "Brook Linen Curtains",
      status: "ACTIVE",
      vendor: "Wynne",
      productType: "Curtains",
      totalInventory: 12,
      imageUrl: "https://cdn.example/a.jpg",
      tags: ["linen", "custom"],
      onlineStoreUrl: "https://wynnecurtains.com/products/brook-linen",
      updatedAt: "2026-07-27T00:00:00Z",
      priceRange: {
        minVariantPrice: { amount: "89.00", currencyCode: "USD" },
      },
    });

    expect(fields["Shopify ID"]).toBe("gid://shopify/Product/123");
    expect(fields.Handle).toBe("brook-linen");
    expect(fields["标题"]).toBe("Brook Linen Curtains");
    expect(fields["状态"]).toBe("ACTIVE");
    expect(fields.Vendor).toBe("Wynne");
    expect(fields["类型"]).toBe("Curtains");
    expect(fields["价格"]).toBe("89.00 USD");
    expect(fields["库存"]).toBe("12");
    expect(fields["主图"]).toBe("https://cdn.example/a.jpg");
    expect(fields.Tags).toBe("linen, custom");
    expect(fields["链接"]).toContain("brook-linen");
    expect(fields["更新时间"]).toContain("2026-07-27");
  });

  test("allows fieldMap overrides", () => {
    const fields = mapShopifyProductToFeishuFields(
      { id: "p1", title: "Demo" },
      { title: "商品名", shopifyId: "外部ID" },
    );
    expect(fields["商品名"]).toBe("Demo");
    expect(fields["外部ID"]).toBe("p1");
    expect(fields["标题"]).toBeUndefined();
  });
});
