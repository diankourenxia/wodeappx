/**
 * Send-time account readiness for WodeAppX.
 *
 * Lanes (default is local; cloud is opt-in via sidebar login):
 * 1) local-byok — authorized non-platform provider selected → no WodeApp login
 * 2) local service (selfhost / local-only, the default) unsigned → never force cloud login;
 *    guide user to configure + select a local model Key
 * 3) cloud — platform `wodeapp` model after sidebar login → require signed-in identity + credits
 */

import {
  applyWodeAppProvider,
  getWodeAppServiceConfig,
  loadCachedWodeAppAuthState,
  type WodeAppAuthConfig,
} from "@/app/lib/wodeapp-auth";
import type { ModelRef } from "@/app/types";
import {
  WODEAPP_OPEN_LOGIN_EVENT,
  WODEAPP_OPEN_RECHARGE_EVENT,
  WODEAPP_OPEN_SERVICE_SETTINGS_EVENT,
} from "./wodeapp-model-display";
import {
  buildModelRoutesFromConnected,
  matchModelRoute,
} from "./wodeapp-model-route-match";

export type WodeAppSendBlockReason = "login" | "recharge" | "provider";

export type WodeAppSendGateKind =
  | "auth-required"
  | "insufficient-credits"
  | "provider-not-ready";

export type WodeAppSendMode = "cloud" | "local-byok";

export class WodeAppSendBlockedError extends Error {
  readonly reason: WodeAppSendBlockReason;
  readonly kind: WodeAppSendGateKind;

  constructor(reason: WodeAppSendBlockReason, message: string) {
    super(message);
    this.name = "WodeAppSendBlockedError";
    this.reason = reason;
    this.kind =
      reason === "login"
        ? "auth-required"
        : reason === "recharge"
          ? "insufficient-credits"
          : "provider-not-ready";
  }
}

export { WODEAPP_OPEN_SERVICE_SETTINGS_EVENT };

/** Local mode: configure + select a vendor Key; do not ask for WodeApp login. */
export const LOCAL_MODE_SEND_HINT =
  "本地模式：请在「设置 → 服务与模型」配置本机模型 Key，并在对话里选用该模型后再发送（无需登录云端）";

/** Unsigned / no local Key. Default is local; cloud is sidebar login. */
export const LOCAL_BYOK_SEND_HINT =
  "请先在「设置 → 服务与模型」配置本机模型 Key，并在对话里选用该模型后再发送";

export function openWodeAppLoginPrompt(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(WODEAPP_OPEN_LOGIN_EVENT));
}

export function openWodeAppRechargePrompt(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(WODEAPP_OPEN_RECHARGE_EVENT));
}

export function openWodeAppServiceSettingsPrompt(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(WODEAPP_OPEN_SERVICE_SETTINGS_EVENT));
}

export function isLocalServiceMode(
  origin?: string | null,
  profile?: string | null,
): boolean {
  if (profile === "local-only" || profile === "selfhost") return true;
  const o = String(origin || "");
  return /127\.0\.0\.1|localhost/i.test(o);
}

export function isWodeAppCreditGatedErrorText(raw: string): boolean {
  const text = raw.trim();
  if (!text) return false;
  return (
    /INSUFFICIENT_CREDITS/i.test(text)
    || /AUTH_REQUIRED/i.test(text)
    || /credit_error/i.test(text)
    || text.includes("积分不足")
    || text.includes("请先登录")
    || /Status:\s*402/i.test(text)
  );
}

export type ClassifyCreditGatedOptions = {
  /** True when the active send model is local BYOK (not platform wodeapp). */
  localByokActive?: boolean;
  /** True when Settings is on 本地 Origin / selfhost. */
  localServiceMode?: boolean;
  /** True when the user has no WodeApp cloud session. */
  unsigned?: boolean;
};

/**
 * Map a credit-gated upstream error using local account truth.
 * Local credits > 0 + 402 ⇒ treat as provider/auth race, not a real recharge demand.
 * Local mode / BYOK ⇒ point at Key setup instead of only "请先登录".
 */
export function classifyWodeAppCreditGatedError(
  raw: string,
  localCredits: number | null | undefined,
  options?: ClassifyCreditGatedOptions,
): { message: string; kind: WodeAppSendGateKind; reason: WodeAppSendBlockReason } | null {
  if (!isWodeAppCreditGatedErrorText(raw)) return null;

  if (/AUTH_REQUIRED/i.test(raw) || raw.includes("请先登录")) {
    if (options?.localByokActive || options?.localServiceMode) {
      return {
        reason: "login",
        kind: "auth-required",
        message: LOCAL_MODE_SEND_HINT,
      };
    }
    if (options?.unsigned) {
      return {
        reason: "login",
        kind: "auth-required",
        message: LOCAL_BYOK_SEND_HINT,
      };
    }
    if (typeof localCredits === "number" && localCredits >= 1) {
      return {
        reason: "provider",
        kind: "provider-not-ready",
        message: "账号未就绪，请重试发送",
      };
    }
    return {
      reason: "login",
      kind: "auth-required",
      message: "请先登录后再发送",
    };
  }

  if (options?.localByokActive || options?.localServiceMode) {
    return {
      reason: "provider",
      kind: "provider-not-ready",
      message: "本机模型未就绪，请检查「设置 → 服务与模型」中的 Key，并确认已选用该模型",
    };
  }

  if (typeof localCredits === "number" && localCredits >= 1) {
    return {
      reason: "provider",
      kind: "provider-not-ready",
      message: "账号未就绪，请重试发送",
    };
  }

  if (options?.unsigned) {
    return {
      reason: "login",
      kind: "auth-required",
      message: LOCAL_BYOK_SEND_HINT,
    };
  }

  return {
    reason: "recharge",
    kind: "insufficient-credits",
    message: "积分不足，请充值或领取每日积分",
  };
}

export type EnsureWodeAppSendReadyOptions = {
  selectedModel?: ModelRef | null;
  connectedProviderIds?: readonly string[] | null;
  connectedModels?: ReadonlyArray<{ id: string; models: readonly string[] }> | null;
};

export function resolveSendLaneModel(
  selectedModel?: ModelRef | null,
  connectedModels?: ReadonlyArray<{ id: string; models: readonly string[] }> | null,
): ModelRef | null {
  if (connectedModels?.length) {
    const matched = matchModelRoute(
      selectedModel,
      buildModelRoutesFromConnected(connectedModels),
      "text",
    );
    if (matched) return { providerID: matched.providerID, modelID: matched.modelID };
  }
  return selectedModel ?? null;
}

export function isLocalByokSendLane(
  selectedModel?: ModelRef | null,
  connectedProviderIds?: readonly string[] | null,
  connectedModels?: ReadonlyArray<{ id: string; models: readonly string[] }> | null,
): boolean {
  const resolved = resolveSendLaneModel(selectedModel, connectedModels) ?? selectedModel;
  const providerID = resolved?.providerID?.trim() || "";
  const modelID = String(resolved?.modelID ?? "").trim();
  if (!providerID || !modelID) return false;
  // Platform / zen providers still require WodeApp cloud identity (unless local service + key).
  if (providerID === "wodeapp" || providerID === "opencode" || providerID === "openwork") {
    return false;
  }
  if (!connectedProviderIds?.length) return false;
  return connectedProviderIds.includes(providerID);
}

export async function ensureWodeAppSendReady(
  options?: EnsureWodeAppSendReadyOptions,
): Promise<{
  mode: WodeAppSendMode;
  config: WodeAppAuthConfig | null;
  credits: number | null;
  localServiceMode: boolean;
}> {
  const localByok = isLocalByokSendLane(
    options?.selectedModel,
    options?.connectedProviderIds,
    options?.connectedModels,
  );

  if (localByok) {
    // Local provider credentials live in OpenCode auth.json — no WodeApp session needed.
    return { mode: "local-byok", config: null, credits: null, localServiceMode: true };
  }

  let localServiceMode = false;
  try {
    const service = await getWodeAppServiceConfig();
    localServiceMode = isLocalServiceMode(service.config?.origin, service.config?.profile);
  } catch {
    localServiceMode = false;
  }

  const auth = await loadCachedWodeAppAuthState();
  if (!auth.ok || !auth.signedIn || !auth.config) {
    // 本地模式：绝不弹云端登录；引导配 Key + 选用本机模型
    openWodeAppServiceSettingsPrompt();
    throw new WodeAppSendBlockedError(
      "login",
      localServiceMode ? LOCAL_MODE_SEND_HINT : LOCAL_BYOK_SEND_HINT,
    );
  }

  const credits = typeof auth.config.credits === "number" ? auth.config.credits : null;
  if (typeof credits === "number" && credits < 1) {
    if (localServiceMode) {
      openWodeAppServiceSettingsPrompt();
      throw new WodeAppSendBlockedError("login", LOCAL_MODE_SEND_HINT);
    }
    openWodeAppRechargePrompt();
    throw new WodeAppSendBlockedError("recharge", "积分不足，请充值或领取每日积分");
  }

  const provider = await applyWodeAppProvider();
  if (!provider.ok) {
    throw new WodeAppSendBlockedError(
      "provider",
      provider.error?.trim() || "账号未就绪，请稍后重试",
    );
  }

  return { mode: "cloud", config: auth.config, credits, localServiceMode };
}
