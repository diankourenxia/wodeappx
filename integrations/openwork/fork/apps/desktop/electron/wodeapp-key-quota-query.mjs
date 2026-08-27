import { spawn } from "node:child_process";

const PROBE_TIMEOUT_MS = 8000;

export const KEY_QUOTA_SPECS = [
  {
    id: "openrouter",
    label: "OpenRouter",
    envKeys: ["OPENROUTER_API_KEY"],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    envKeys: ["DEEPSEEK_API_KEY"],
  },
  {
    id: "moonshot",
    label: "Kimi / Moonshot",
    envKeys: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
  },
  {
    id: "kimicode",
    label: "Kimi Code",
    envKeys: ["KIMICODE_API_KEY"],
  },
];

function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function kimiCodeUsagesUrl(vars = {}) {
  const base = String(vars.KIMICODE_BASE_URL || "https://api.kimi.com/coding/v1").replace(/\/$/, "");
  return `${base}/usages`;
}

function maskKeyPreview(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.length <= 8) return `${raw.slice(0, 2)}***`;
  return `${raw.slice(0, 4)}***${raw.slice(-4)}`;
}

export function remainingPercent(remaining, limit) {
  if (remaining == null || limit == null || limit <= 0) return null;
  return Math.max(0, Math.min(100, (remaining / limit) * 100));
}

export function summarizeOpenRouterQuota(input = {}) {
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

export function summarizeDeepSeekQuota(input = {}) {
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

export function summarizeMoonshotQuota(input = {}) {
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

export function summarizeKimiCodeQuota(input = {}) {
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

export function summarizeGrokBuildQuota(input = {}) {
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

function curlJson(url, headers) {
  return new Promise((resolve, reject) => {
    const bin = process.platform === "win32" ? "curl.exe" : "curl";
    const args = ["-sS", "-m", "15"];
    for (const [name, value] of Object.entries(headers || {})) {
      if (value) args.push("-H", `${name}: ${value}`);
    }
    args.push(url);
    const child = spawn(bin, args, { env: process.env });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      err += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(String(err || `curl ${code}`).trim()));
        return;
      }
      try {
        resolve(JSON.parse(out));
      } catch {
        reject(new Error("invalid json"));
      }
    });
  });
}

export function collectQuotaKeyTargets(store) {
  const vars = Object.fromEntries(
    (store?.variables || []).map((item) => [item.key, item.value]),
  );
  const out = [];
  for (const spec of KEY_QUOTA_SPECS) {
    const sets = (store?.vendorKeySets || []).filter((item) => item.vendorId === spec.id);
    if (sets.length > 0) {
      for (const set of sets) {
        const apiKey = (set.entries || []).find((entry) => spec.envKeys.includes(entry.key))?.value;
        if (!apiKey) continue;
        out.push({
          vendorId: spec.id,
          label: spec.label,
          preview: maskKeyPreview(apiKey),
          active: set.active === true,
          apiKey,
          usagesUrl: spec.id === "kimicode" ? kimiCodeUsagesUrl(vars) : undefined,
        });
      }
      continue;
    }
    const apiKey = spec.envKeys.map((key) => vars[key]).find(Boolean);
    if (!apiKey) continue;
    out.push({
      vendorId: spec.id,
      label: spec.label,
      preview: maskKeyPreview(apiKey),
      active: true,
      apiKey,
      usagesUrl: spec.id === "kimicode" ? kimiCodeUsagesUrl(vars) : undefined,
    });
  }
  return out;
}

async function readJson(url, apiKey) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return json;
}

export async function probeVendorQuota(target) {
  const base = {
    vendorId: target.vendorId,
    label: target.label,
    preview: target.preview,
    active: target.active === true,
    ok: false,
    remainingPercent: null,
    remaining: null,
    limit: null,
    used: null,
    unit: null,
  };
  try {
    if (target.vendorId === "openrouter") {
      const [key, credits] = await Promise.all([
        readJson("https://openrouter.ai/api/v1/key", target.apiKey),
        readJson("https://openrouter.ai/api/v1/credits", target.apiKey),
      ]);
      return { ...base, ...summarizeOpenRouterQuota({ key: key?.data, credits: credits?.data }) };
    }
    if (target.vendorId === "deepseek") {
      const json = await readJson("https://api.deepseek.com/user/balance", target.apiKey);
      return { ...base, ...summarizeDeepSeekQuota(json) };
    }
    if (target.vendorId === "moonshot") {
      const [balanceResult, accountResult] = await Promise.allSettled([
        readJson("https://api.moonshot.cn/v1/users/me/balance", target.apiKey),
        readJson("https://api.moonshot.cn/v1/users/me", target.apiKey),
      ]);
      const balance = balanceResult.status === "fulfilled" ? balanceResult.value : null;
      const account = accountResult.status === "fulfilled" ? accountResult.value : null;
      if (!balance && !account) {
        throw new Error(balanceResult.status === "rejected"
          ? balanceResult.reason?.message || String(balanceResult.reason)
          : accountResult.reason?.message || String(accountResult.reason));
      }
      return {
        ...base,
        ...summarizeMoonshotQuota({
          data: balance?.data,
          account: account?.data,
        }),
      };
    }
    if (target.vendorId === "kimicode") {
      const json = await readJson(
        target.usagesUrl || "https://api.kimi.com/coding/v1/usages",
        target.apiKey,
      );
      return { ...base, ...summarizeKimiCodeQuota(json) };
    }
    if (target.vendorId === "grok") {
      const json = await curlJson("https://cli-chat-proxy.grok.com/v1/billing?format=credits", {
        Authorization: `Bearer ${target.apiKey}`,
        "X-XAI-Token-Auth": "xai-grok-cli",
        "x-grok-client-version": target.clientVersion || "1.0.5",
        "x-grok-client-surface": "grok-build",
        "x-userid": target.userId || "",
        Accept: "application/json",
      });
      return { ...base, ...summarizeGrokBuildQuota(json) };
    }
    return { ...base, error: "unsupported" };
  } catch (error) {
    return {
      ...base,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function loadWodeAppKeyQuota({ home } = {}) {
  try {
    const { loadDesktopKeysStore } = await import("./wodeapp-cloud/desktop-keys-store.mjs");
    const { store } = await loadDesktopKeysStore(home);
    const { readGrokCliClientVersion, readGrokCliSessionMeta } = await import("./wodeapp-managed-models.mjs");
    const grok = readGrokCliSessionMeta();
    const grokTargets = grok.key
      ? [{
        vendorId: "grok",
        label: "Grok Build",
        preview: "Grok 登录",
        active: true,
        apiKey: grok.key,
        userId: grok.userId,
        clientVersion: readGrokCliClientVersion(),
      }]
      : [];
    const targets = [...grokTargets, ...collectQuotaKeyTargets(store)];
    const rows = await Promise.all(targets.map((target) => probeVendorQuota(target)));
    return { ok: true, rows };
  } catch (error) {
    return {
      ok: false,
      rows: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
