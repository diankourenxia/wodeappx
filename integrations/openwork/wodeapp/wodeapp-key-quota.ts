export type WodeAppKeyQuotaUnit = "usd" | "cny";
export type WodeAppKeyQuotaRemainKind = "weekly" | "plan" | "balance";

export type WodeAppKeyQuotaRow = {
  vendorId: string;
  label: string;
  preview: string;
  active: boolean;
  ok: boolean;
  remainingPercent: number | null;
  remaining: number | null;
  limit: number | null;
  used: number | null;
  unit: WodeAppKeyQuotaUnit | null;
  remainKind?: WodeAppKeyQuotaRemainKind;
  note?: string;
  error?: string;
};

export type WodeAppKeyQuotaReport = {
  ok: boolean;
  rows: WodeAppKeyQuotaRow[];
  error?: string;
};

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function remainingPercent(remaining: number | null, limit: number | null): number | null {
  if (remaining == null || limit == null || limit <= 0) return null;
  return Math.max(0, Math.min(100, (remaining / limit) * 100));
}

export function summarizeOpenRouterQuota(input: {
  key?: { limit?: unknown; limit_remaining?: unknown; usage?: unknown } | null;
  credits?: { total_credits?: unknown; total_usage?: unknown } | null;
}): Pick<WodeAppKeyQuotaRow, "remainingPercent" | "remaining" | "limit" | "used" | "unit" | "ok"> {
  const keyLimit = num(input.key?.limit);
  const keyRemaining = num(input.key?.limit_remaining);
  const creditTotal = num(input.credits?.total_credits);
  const creditUsed = num(input.credits?.total_usage);
  const used = creditUsed ?? num(input.key?.usage);
  const limit = keyLimit != null && keyLimit > 0 ? keyLimit : creditTotal;
  const remaining = keyRemaining != null
    ? keyRemaining
    : limit != null && used != null
      ? Math.max(0, limit - used)
      : null;
  return {
    ok: remaining != null || used != null,
    remainingPercent: remainingPercent(remaining, limit),
    remaining,
    limit,
    used,
    unit: "usd",
  };
}

export function summarizeDeepSeekQuota(input: {
  balance_infos?: Array<{ currency?: string; total_balance?: unknown }> | null;
}): Pick<WodeAppKeyQuotaRow, "remainingPercent" | "remaining" | "limit" | "used" | "unit" | "ok"> {
  const rows = Array.isArray(input.balance_infos) ? input.balance_infos : [];
  const cny = rows.find((row) => String(row.currency || "").toUpperCase() === "CNY") || rows[0];
  const remaining = num(cny?.total_balance);
  return {
    ok: remaining != null,
    remainingPercent: remaining != null && remaining <= 0 ? 0 : null,
    remaining,
    limit: null,
    used: null,
    unit: "cny",
  };
}

export function summarizeGrokBuildQuota(input: {
  config?: {
    creditUsagePercent?: unknown;
    productUsage?: Array<{ product?: string; usagePercent?: unknown }> | null;
  } | null;
}): Pick<WodeAppKeyQuotaRow, "remainingPercent" | "remaining" | "limit" | "used" | "unit" | "ok" | "remainKind"> {
  const products = Array.isArray(input.config?.productUsage) ? input.config.productUsage : [];
  const build = products.find((item) => /grokbuild/i.test(String(item.product || "")));
  const used = num(build?.usagePercent) ?? num(input.config?.creditUsagePercent);
  if (used == null) {
    return { ok: false, remainingPercent: null, remaining: null, limit: null, used: null, unit: null };
  }
  return {
    ok: true,
    remainingPercent: Math.max(0, Math.min(100, 100 - used)),
    remaining: null,
    limit: null,
    used,
    unit: null,
    remainKind: "weekly",
  };
}

export function summarizeMoonshotQuota(input: {
  data?: { available_balance?: unknown; cash_balance?: unknown } | null;
  account?: {
    organization?: { max_token_quota?: unknown } | null;
    organization_usage?: { cur_token_usage?: unknown } | null;
  } | null;
}): Pick<WodeAppKeyQuotaRow, "remainingPercent" | "remaining" | "limit" | "used" | "unit" | "ok" | "remainKind" | "note"> {
  const cash = num(input.data?.available_balance) ?? num(input.data?.cash_balance);
  const quota = num(input.account?.organization?.max_token_quota);
  const used = num(input.account?.organization_usage?.cur_token_usage);
  const hasPlan = quota != null && quota > 0 && used != null;
  if (hasPlan) {
    const left = Math.max(0, quota - used);
    if (left > 0 || cash == null || cash <= 0) {
      const remainingPercentValue = remainingPercent(left, quota);
      return {
        ok: true,
        remainingPercent: remainingPercentValue,
        remaining: null,
        limit: quota,
        used,
        unit: null,
        remainKind: "plan",
        note: remainingPercentValue != null && remainingPercentValue <= 0
          ? "开放平台套餐额度已用完。"
          : undefined,
      };
    }
  }
  return {
    ok: cash != null,
    remainingPercent: cash != null && cash <= 0 ? 0 : null,
    remaining: cash,
    limit: null,
    used: null,
    unit: "cny",
    remainKind: "balance",
  };
}

export function summarizeKimiCodeQuota(input: {
  usage?: { limit?: unknown; used?: unknown; remaining?: unknown } | null;
} | null): Pick<WodeAppKeyQuotaRow, "remainingPercent" | "remaining" | "limit" | "used" | "unit" | "ok" | "remainKind"> {
  const usage = input?.usage || {};
  const limit = num(usage.limit);
  const used = num(usage.used);
  const remaining = num(usage.remaining);
  if (limit == null || limit <= 0) {
    return {
      ok: false,
      remainingPercent: null,
      remaining: null,
      limit: null,
      used: null,
      unit: null,
      remainKind: "weekly",
    };
  }
  const left = remaining != null ? Math.max(0, remaining) : used != null ? Math.max(0, limit - used) : null;
  return {
    ok: left != null,
    remainingPercent: remainingPercent(left, limit),
    remaining: null,
    limit: null,
    used,
    unit: null,
    remainKind: "weekly",
  };
}

export function formatQuotaPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value <= 0) return "0%";
  if (value >= 99.5) return "100%";
  if (value < 1) return "<1%";
  return `${Math.round(value)}%`;
}

export function formatQuotaAmount(value: number | null, unit: WodeAppKeyQuotaUnit | null): string {
  if (value == null || !Number.isFinite(value) || !unit) return "—";
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : 2;
  const text = value.toFixed(digits).replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1");
  return unit === "usd" ? `$${text}` : `¥${text}`;
}

export function formatQuotaRemainLine(row: Pick<WodeAppKeyQuotaRow, "remaining" | "limit" | "unit" | "remainingPercent" | "remainKind">): string {
  if (row.remaining == null && row.remainingPercent != null) {
    return row.remainKind === "plan"
      ? `套餐剩余 ${formatQuotaPercent(row.remainingPercent)}`
      : `本周剩余 ${formatQuotaPercent(row.remainingPercent)}`;
  }
  const remain = formatQuotaAmount(row.remaining, row.unit);
  if (row.limit != null && row.unit) return `剩余 ${remain} / ${formatQuotaAmount(row.limit, row.unit)}`;
  if (row.remaining == null) return "这个 Key 还读不到剩余额度";
  return `剩余 ${remain}`;
}

export function quotaTone(remainingPercentValue: number | null): "ok" | "low" | "empty" | "unknown" {
  if (remainingPercentValue == null) return "unknown";
  if (remainingPercentValue <= 0) return "empty";
  if (remainingPercentValue < 20) return "low";
  return "ok";
}
