import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

import {
  findWodeAppProviderBillingLink,
  resolveCapabilityConsoleUrl,
  resolveCapabilityUsageUrl,
  resolveWodeAppProviderBillingUrl,
  sessionPathFromSettingsLocation,
  WODEAPP_PROVIDER_BILLING_LINKS,
} from "../wodeapp/wodeapp-provider-billing-links";

describe("WodeApp provider billing links", () => {
  test("includes MiniMax billing console for Token Plan top-up", () => {
    const minimax = findWodeAppProviderBillingLink("minimax");
    expect(minimax).toBeDefined();
    expect(minimax?.billingUrl).toContain("minimaxi.com");
    expect(WODEAPP_PROVIDER_BILLING_LINKS.length).toBeGreaterThanOrEqual(5);
  });

  test("resolves provider id or explicit url", () => {
    expect(resolveWodeAppProviderBillingUrl("minimax")).toContain("minimaxi.com");
    expect(resolveWodeAppProviderBillingUrl({ url: "https://example.com/pay" })).toBe("https://example.com/pay");
  });

  test("resolves capability console URLs including aliases", () => {
    expect(resolveCapabilityConsoleUrl("deepseek")).toContain("deepseek.com");
    expect(resolveCapabilityConsoleUrl("kimi")).toContain("moonshot.cn");
    expect(resolveCapabilityConsoleUrl("kling")).toContain("klingai.com");
    expect(resolveCapabilityConsoleUrl("openai-image")).toContain("openai.com");
    expect(resolveCapabilityConsoleUrl("seedance")).toContain("volcengine.com");
    expect(resolveCapabilityConsoleUrl("unknown-vendor")).toBe("");
  });

  test("configured rows resolve a usage URL for 查看用量", () => {
    expect(resolveCapabilityUsageUrl("deepseek")).toContain("platform.deepseek.com/usage");
    expect(resolveCapabilityUsageUrl("dashscope")).toContain("costing-balance");
    expect(resolveCapabilityUsageUrl("wodeapp", "https://wodeapp.cn")).toBe("https://wodeapp.cn/credits");
    expect(resolveCapabilityUsageUrl("wodeapp", "https://wodeapp.ai")).toBe("https://wodeapp.ai/credits");
    expect(resolveCapabilityUsageUrl("unknown-vendor")).toBe("");
  });

  test("DashScope console uses Bailian after dashscope.console shutdown", () => {
    const dashscope = findWodeAppProviderBillingLink("dashscope");
    expect(dashscope?.consoleUrl).toBe("https://bailian.console.aliyun.com/?tab=model#/api-key");
    expect(dashscope?.billingUrl).toBe(
      "https://bailian.console.aliyun.com/?tab=model#/costing-balance",
    );
    expect(dashscope?.consoleUrl).not.toContain("dashscope.console");
    expect(dashscope?.billingUrl).not.toContain("dashscope.console");
    expect(resolveCapabilityConsoleUrl("alibaba")).toContain("bailian.console.aliyun.com");
  });

  test("maps settings URLs back to a session route for the right pane", () => {
    expect(sessionPathFromSettingsLocation("/#/workspace/ws_1/session/ses_a")).toBeNull();
    expect(
      sessionPathFromSettingsLocation("/#/workspace/ws_demo/settings/service", "ses_abc"),
    ).toBe("/workspace/ws_demo/session/ses_abc");
    expect(sessionPathFromSettingsLocation("/#/workspace/ws_demo/settings/service")).toBe(
      "/workspace/ws_demo/session",
    );
  });

  test("capability panel shows 查看用量 on configured rows", () => {
    const panel = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../wodeapp/wodeapp-provider-capability-panel.tsx"),
      "utf8",
    );
    expect(panel).toContain("查看用量");
    expect(panel).toContain("resolveCapabilityUsageUrl");
    expect(panel).toContain("is-usage");
  });
});
