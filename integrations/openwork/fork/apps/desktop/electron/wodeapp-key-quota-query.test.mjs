import assert from "node:assert/strict";
import test from "node:test";

import {
  collectQuotaKeyTargets,
  summarizeDeepSeekQuota,
  summarizeGrokBuildQuota,
  summarizeKimiCodeQuota,
  summarizeMoonshotQuota,
  summarizeOpenRouterQuota,
} from "./wodeapp-key-quota-query.mjs";

test("collects one target per configured vendor key", () => {
  const targets = collectQuotaKeyTargets({
    variables: [
      { key: "DEEPSEEK_API_KEY", value: "sk-abcdefghijklmnop" },
      { key: "OPENROUTER_API_KEY", value: "sk-or-v1-1234567890abcdef" },
      { key: "KIMICODE_API_KEY", value: "sk-kimi-abcdefghijklmnop" },
      { key: "KIMICODE_BASE_URL", value: "https://api.kimi.com/coding/v1" },
    ],
    vendorKeySets: [],
  });
  assert.deepEqual(targets.map((item) => [item.vendorId, item.preview]), [
    ["openrouter", "sk-o***cdef"],
    ["deepseek", "sk-a***mnop"],
    ["kimicode", "sk-k***mnop"],
  ]);
  assert.equal(targets.at(-1)?.usagesUrl, "https://api.kimi.com/coding/v1/usages");
});

test("moonshot cash zero still shows remaining token plan", () => {
  const row = summarizeMoonshotQuota({
    data: { available_balance: 0, cash_balance: -11.7 },
    account: {
      organization: { max_token_quota: 1000 },
      organization_usage: { cur_token_usage: 250 },
    },
  });
  assert.equal(row.ok, true);
  assert.equal(row.remainKind, "plan");
  assert.equal(row.remainingPercent, 75);
});

test("kimi code weekly remaining comes from usages", () => {
  const row = summarizeKimiCodeQuota({
    usage: { limit: "100", used: "85", remaining: "15" },
  });
  assert.equal(row.ok, true);
  assert.equal(row.remainingPercent, 15);
  assert.equal(row.remainKind, "weekly");
});

test("summarizes live OpenRouter credit shape", () => {
  const row = summarizeOpenRouterQuota({
    key: { limit: null, limit_remaining: null, usage: 8.437 },
    credits: { total_credits: 10, total_usage: 8.437 },
  });
  assert.equal(row.ok, true);
  assert.equal(row.limit, 10);
  assert.ok(Math.abs(row.remaining - 1.563) < 0.001);
});

test("summarizes Grok Build weekly remaining percent", () => {
  const row = summarizeGrokBuildQuota({
    config: {
      creditUsagePercent: 1,
      productUsage: [{ product: "GrokBuild", usagePercent: 1 }],
    },
  });
  assert.equal(row.ok, true);
  assert.equal(row.remainingPercent, 99);
});

test("summarizes DeepSeek CNY balance", () => {
  const row = summarizeDeepSeekQuota({
    balance_infos: [{ currency: "CNY", total_balance: "83.25" }],
  });
  assert.equal(row.remaining, 83.25);
  assert.equal(row.remainingPercent, null);
});
