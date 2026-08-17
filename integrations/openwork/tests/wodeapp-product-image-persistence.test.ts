import { describe, expect, test } from "bun:test";

import { normalizeLocalAsset } from "@/react-app/domains/wodeapp/digital-assets-store";
import {
  isDurableProductImageUrl,
  isRemoteReadyProductImageUrl,
  validateRemoteReadyProductImageUrls,
} from "@/react-app/domains/wodeapp/wodeapp-direct-action-contracts";
import {
  materializeProductImageUrls,
} from "@/react-app/domains/wodeapp/wodeapp-product-image-materialize";

describe("WodeAppX product image persistence boundary", () => {
  test("migrates legacy local product images to an explicit local-only state", () => {
    const normalized = normalizeLocalAsset({
      id: "local-product-local-image",
      name: "本机商品",
      kind: "商品库",
      meta: "1 张图片 · 商品库",
      preview: "product",
      productImages: ["wodeappx-asset://local/product.png"],
    });

    expect(normalized?.productImageSyncStatus).toBe("local-only");
    expect(normalized?.productImageSyncError).toContain("远端生成前需要重新上传同步");
  });

  test("accepts local assets for preview but only HTTPS assets for remote handoff", () => {
    expect(isDurableProductImageUrl("https://assets.wodeapp.ai/a.jpg")).toBe(true);
    expect(isDurableProductImageUrl("http://assets.wodeapp.ai/a.jpg")).toBe(false);
    expect(isDurableProductImageUrl("wodeappx-asset://local/a.jpg")).toBe(true);

    expect(isRemoteReadyProductImageUrl("https://assets.example/b.jpg")).toBe(true);
    expect(isRemoteReadyProductImageUrl("wodeappx-asset://local/a.jpg")).toBe(false);
    expect(validateRemoteReadyProductImageUrls([
      "https://assets.example/b.jpg",
      "wodeappx-asset://local/a.jpg",
    ])).toContain("尚未同步");
  });

  test("does not silently promote insecure HTTP URLs to synced product images", async () => {
    const result = await materializeProductImageUrls(["http://assets.example/x.jpg"], {
      sessionId: "ses_test",
      deps: {
        uploadHttps: async () => "https://assets.example/x.jpg",
        persistLocal: async () => "wodeappx-asset://local/x.jpg",
      },
    });

    expect(result.urls).toEqual([]);
    expect(result.failed).toEqual(["http://assets.example/x.jpg"]);
  });
});
