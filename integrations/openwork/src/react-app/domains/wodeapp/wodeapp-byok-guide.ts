/**
 * Cold-start BYOK guide — when the workbench has no usable model yet.
 * Local Key only (no WodeApp cloud login). Console URLs from billing-links.
 */

export const WODEAPP_OPEN_BYOK_GUIDE_EVENT = "wodeapp:open-byok-guide";

export const BYOK_GUIDE_DISMISS_KEY = "wodeappx.byok-guide.dismissed";

export type ByokGuideStep = "vendor" | "console" | "paste";

export type ByokGuideVendorId = "deepseek" | "moonshot" | "openrouter" | "volcano" | "dashscope";

export type ByokGuideVendor = {
  id: ByokGuideVendorId;
  name: string;
  blurb: string;
  /** Env var name for .env / settings (never log the secret). */
  envVar: string;
  kind: "text" | "media" | "both";
};

/** First-mile vendors only — keep the picker short. */
export const BYOK_GUIDE_VENDORS: readonly ByokGuideVendor[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    blurb: "国内对话。项目里已有 Key 会立刻标出来，通常不能生图/生视频",
    envVar: "DEEPSEEK_API_KEY",
    kind: "text",
  },
  {
    id: "moonshot",
    name: "Kimi / Moonshot",
    blurb: "国内文字，适合先跑通对话",
    envVar: "MOONSHOT_API_KEY",
    kind: "text",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    blurb: "国际聚合，一张 Key 多模型；以已扫到的模型列表为准",
    envVar: "OPENROUTER_API_KEY",
    kind: "text",
  },
  {
    id: "dashscope",
    name: "通义 / 百炼",
    blurb: "千问对话；有生图模型才开生图",
    envVar: "DASHSCOPE_API_KEY",
    kind: "both",
  },
  {
    id: "volcano",
    name: "火山方舟 ARK",
    blurb: "豆包对话 / Seedream 生图 / Seedance 视频，有哪些开哪些",
    envVar: "ARK_API_KEY",
    kind: "both",
  },
] as const;

export type ByokGuideAutoOpenInput = {
  hasUsableModel: boolean;
  dismissed: boolean;
  /** Auth / provider hydrate finished — avoid flash before we know. */
  ready: boolean;
};

export function shouldAutoOpenByokGuide(input: ByokGuideAutoOpenInput): boolean {
  return Boolean(input.ready && !input.hasUsableModel && !input.dismissed);
}

export function readByokGuideDismissed(storage?: Pick<Storage, "getItem"> | null): boolean {
  try {
    const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    return store?.getItem(BYOK_GUIDE_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeByokGuideDismissed(
  dismissed: boolean,
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
): void {
  try {
    const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    if (!store) return;
    if (dismissed) store.setItem(BYOK_GUIDE_DISMISS_KEY, "1");
    else store.removeItem(BYOK_GUIDE_DISMISS_KEY);
  } catch {
    // ignore quota / private mode
  }
}

export function nextByokGuideStep(step: ByokGuideStep): ByokGuideStep | "done" {
  if (step === "vendor") return "console";
  if (step === "console") return "paste";
  return "done";
}

export function findByokGuideVendor(id: string | null | undefined): ByokGuideVendor | undefined {
  return BYOK_GUIDE_VENDORS.find((item) => item.id === id);
}

export type CapabilityJumpTarget =
  | { kind: "byok"; vendorId: ByokGuideVendorId }
  | { kind: "settings" };

export function resolveCapabilityJump(vendorId: string | null | undefined): CapabilityJumpTarget {
  const vendor = findByokGuideVendor(vendorId);
  if (vendor) return { kind: "byok", vendorId: vendor.id };
  return { kind: "settings" };
}

export function vendorHasConfiguredKey(
  sources: readonly { id: string }[] | null | undefined,
  vendorId: string,
): boolean {
  const id = String(vendorId || "").trim();
  if (!id || !Array.isArray(sources)) return false;
  return sources.some((item) => item.id === id);
}
