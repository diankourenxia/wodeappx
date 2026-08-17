import { describe, expect, test } from "bun:test";

import {
  cloudRegionFromOrigin,
  originForCloudRegion,
  wodeAppCloudPricingUrl,
  wodeAppCloudCreditsUrl,
  WODEAPP_CLOUD_ORIGIN_AI,
  WODEAPP_CLOUD_ORIGIN_CN,
} from "../wodeapp/wodeapp-cloud-region";

describe("wodeapp cloud region", () => {
  test("maps official origins without folding .ai into .cn", () => {
    expect(originForCloudRegion("ai")).toBe(WODEAPP_CLOUD_ORIGIN_AI);
    expect(originForCloudRegion("cn")).toBe(WODEAPP_CLOUD_ORIGIN_CN);
    expect(cloudRegionFromOrigin("https://wodeapp.ai/login")).toBe("ai");
    expect(cloudRegionFromOrigin("https://www.wodeapp.cn")).toBe("cn");
    expect(cloudRegionFromOrigin("http://127.0.0.1:3000")).toBeNull();
  });

  test("opens the matching official pricing page instead of embedding checkout", () => {
    expect(wodeAppCloudPricingUrl("https://wodeapp.ai")).toBe("https://wodeapp.ai/pricing");
    expect(wodeAppCloudPricingUrl("https://www.wodeapp.cn/account")).toBe("https://wodeapp.cn/pricing");
    expect(wodeAppCloudPricingUrl("https://wodeapp.ai/login")).toBe("https://wodeapp.ai/pricing");
    expect(wodeAppCloudPricingUrl(null)).toBe("https://wodeapp.ai/pricing");
    expect(wodeAppCloudPricingUrl("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000/pricing");
    expect(wodeAppCloudCreditsUrl("https://wodeapp.cn")).toBe("https://wodeapp.cn/credits");
    expect(wodeAppCloudCreditsUrl("https://wodeapp.ai/login")).toBe("https://wodeapp.ai/credits");
  });
});
