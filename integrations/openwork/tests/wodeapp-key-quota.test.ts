import { describe, expect, test } from "bun:test";

import {
  formatQuotaAmount,
  formatQuotaPercent,
  formatQuotaRemainLine,
  quotaTone,
  summarizeDeepSeekQuota,
  summarizeGrokBuildQuota,
  summarizeKimiCodeQuota,
  summarizeMoonshotQuota,
  summarizeOpenRouterQuota,
} from "../wodeapp/wodeapp-key-quota";

describe("wodeapp key quota", () => {
  test("openrouter remaining percent uses credits when key has no limit", () => {
    const row = summarizeOpenRouterQuota({
      key: { limit: null, limit_remaining: null, usage: 8.437 },
      credits: { total_credits: 10, total_usage: 8.437 },
    });
    expect(row.ok).toBe(true);
    expect(row.limit).toBe(10);
    expect(row.remaining).toBeCloseTo(1.563, 3);
    expect(row.remainingPercent).toBeCloseTo(15.63, 2);
    expect(formatQuotaPercent(row.remainingPercent)).toBe("16%");
    expect(formatQuotaRemainLine(row)).toBe("剩余 $1.56 / $10");
    expect(quotaTone(row.remainingPercent)).toBe("low");
  });

  test("deepseek only exposes remaining money", () => {
    const row = summarizeDeepSeekQuota({
      balance_infos: [{ currency: "CNY", total_balance: "83.25" }],
    });
    expect(row.ok).toBe(true);
    expect(row.remaining).toBe(83.25);
    expect(row.remainingPercent).toBeNull();
    expect(formatQuotaAmount(row.remaining, row.unit)).toBe("¥83.25");
    expect(formatQuotaRemainLine(row)).toBe("剩余 ¥83.25");
    expect(quotaTone(row.remainingPercent)).toBe("unknown");
  });

  test("grok build remaining is 100 minus weekly used percent", () => {
    const row = summarizeGrokBuildQuota({
      config: {
        creditUsagePercent: 1,
        productUsage: [{ product: "GrokBuild", usagePercent: 1 }],
      },
    });
    expect(row.ok).toBe(true);
    expect(row.remainingPercent).toBe(99);
    expect(formatQuotaPercent(row.remainingPercent)).toBe("99%");
    expect(formatQuotaRemainLine(row)).toBe("本周剩余 99%");
    expect(quotaTone(row.remainingPercent)).toBe("ok");
  });

  test("moonshot empty balance is 0%", () => {
    const row = summarizeMoonshotQuota({
      data: { available_balance: 0, cash_balance: -11.7 },
    });
    expect(row.remaining).toBe(0);
    expect(row.remainingPercent).toBe(0);
    expect(row.remainKind).toBe("balance");
    expect(formatQuotaPercent(0)).toBe("0%");
    expect(quotaTone(0)).toBe("empty");
  });

  test("moonshot token plan remaining is not treated as empty cash", () => {
    const row = summarizeMoonshotQuota({
      data: { available_balance: 0, cash_balance: -11.7 },
      account: {
        organization: { max_token_quota: 1_000_000 },
        organization_usage: { cur_token_usage: 350_000 },
      },
    });
    expect(row.ok).toBe(true);
    expect(row.remainKind).toBe("plan");
    expect(row.remainingPercent).toBeCloseTo(65, 5);
    expect(formatQuotaRemainLine(row)).toBe("套餐剩余 65%");
    expect(quotaTone(row.remainingPercent)).toBe("ok");
  });

  test("moonshot exhausted plan stays 0% with plan copy", () => {
    const row = summarizeMoonshotQuota({
      data: { available_balance: 0, cash_balance: -11.7 },
      account: {
        organization: { max_token_quota: 509490 },
        organization_usage: { cur_token_usage: 509772 },
      },
    });
    expect(row.remainingPercent).toBe(0);
    expect(row.remainKind).toBe("plan");
    expect(formatQuotaRemainLine(row)).toBe("套餐剩余 0%");
    expect(row.note).toBe("开放平台套餐额度已用完。");
  });

  test("kimi code weekly plan remaining uses /usages", () => {
    const row = summarizeKimiCodeQuota({
      usage: { limit: "100", used: "85", remaining: "15" },
    });
    expect(row.ok).toBe(true);
    expect(row.remainingPercent).toBe(15);
    expect(row.remainKind).toBe("weekly");
    expect(formatQuotaPercent(row.remainingPercent)).toBe("15%");
    expect(formatQuotaRemainLine(row)).toBe("本周剩余 15%");
    expect(quotaTone(row.remainingPercent)).toBe("low");
  });
});
