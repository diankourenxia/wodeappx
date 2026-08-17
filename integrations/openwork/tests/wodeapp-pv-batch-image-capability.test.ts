import { describe, expect, test } from "bun:test";

import {
  buildDefaultBatchImageVisualTask,
  inferBatchImageCreativeTypeIds,
  inferBatchImageIterCount,
} from "@/react-app/domains/wodeapp/wodeapp-pv-batch-image-capability";
import {
  runProductVisualBatchImageRemote,
} from "@/react-app/domains/wodeapp/wodeapp-pv-visual-batch-run";

describe("WodeAppX batch image task routing", () => {
  test("requires an explicit billing confirmation before any remote run", async () => {
    await expect(runProductVisualBatchImageRemote(
      buildDefaultBatchImageVisualTask({ name: "测试商品" }),
      {
        launchUrl: "https://yougi.wodeapp.cn/",
        confirmRun: false as true,
      },
    )).rejects.toThrow("confirmRun=true is required");

    await expect(runProductVisualBatchImageRemote(
      buildDefaultBatchImageVisualTask({ name: "测试商品" }),
      {
        launchUrl: "https://yougi.wodeapp.cn/",
      } as { launchUrl: string; confirmRun: true },
    )).rejects.toThrow("confirmRun=true is required");
  });

  test("opens multi-type ecommerce suites in full product mode", () => {
    const selectedCreativeTypes = inferBatchImageCreativeTypeIds(
      "根据品牌调性生成宣传物料、海报、活动详情页和电商主图，各三张",
    );
    const iterCount = inferBatchImageIterCount("每一种电商图各三张");
    const task = buildDefaultBatchImageVisualTask({
      name: "测试商品",
      productImages: ["https://assets.example.com/product.png"],
      refImages: [],
      productInfo: "品牌电商套图",
      selectedCreativeTypes,
      iterCount,
    });

    expect(selectedCreativeTypes).toEqual(["product-photo", "brand-campaign", "selling-point"]);
    expect(iterCount).toBe(3);
    expect(task.activeMode).toBe("full");
    expect(task.targetTotalImages).toBe(9);
  });

  test("keeps a single-theme batch in simple mode", () => {
    const task = buildDefaultBatchImageVisualTask({
      name: "测试商品",
      productImages: [],
      refImages: [],
      productInfo: "生成四张白底图",
      selectedCreativeTypes: ["white-bg"],
      iterCount: 4,
    });

    expect(task.activeMode).toBe("simple");
  });

  test("corrects an invalid simple override for a multi-type suite", () => {
    const task = buildDefaultBatchImageVisualTask({
      name: "测试商品",
      productImages: [],
      refImages: [],
      productInfo: "多类型任务",
      selectedCreativeTypes: ["product-photo", "selling-point"],
      activeMode: "simple",
    });

    expect(task.activeMode).toBe("full");
  });
});
