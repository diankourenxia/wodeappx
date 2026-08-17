import { describe, expect, test } from "bun:test";

import {
  BYOK_GUIDE_DISMISS_KEY,
  BYOK_GUIDE_VENDORS,
  findByokGuideVendor,
  nextByokGuideStep,
  readByokGuideDismissed,
  resolveCapabilityJump,
  shouldAutoOpenByokGuide,
  vendorHasConfiguredKey,
  writeByokGuideDismissed,
} from "../wodeapp/wodeapp-byok-guide";

describe("shouldAutoOpenByokGuide", () => {
  test("opens only when ready, no usable model, not dismissed", () => {
    expect(shouldAutoOpenByokGuide({ ready: true, hasUsableModel: false, dismissed: false })).toBe(true);
    expect(shouldAutoOpenByokGuide({ ready: false, hasUsableModel: false, dismissed: false })).toBe(false);
    expect(shouldAutoOpenByokGuide({ ready: true, hasUsableModel: true, dismissed: false })).toBe(false);
    expect(shouldAutoOpenByokGuide({ ready: true, hasUsableModel: false, dismissed: true })).toBe(false);
  });
});

describe("nextByokGuideStep", () => {
  test("vendor → console → paste → done (local Key only)", () => {
    expect(nextByokGuideStep("vendor")).toBe("console");
    expect(nextByokGuideStep("console")).toBe("paste");
    expect(nextByokGuideStep("paste")).toBe("done");
  });
});

describe("byok guide dismiss storage", () => {
  test("round-trips dismissed flag", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => {
        mem.set(k, v);
      },
      removeItem: (k: string) => {
        mem.delete(k);
      },
    };
    expect(readByokGuideDismissed(storage)).toBe(false);
    writeByokGuideDismissed(true, storage);
    expect(mem.get(BYOK_GUIDE_DISMISS_KEY)).toBe("1");
    expect(readByokGuideDismissed(storage)).toBe(true);
    writeByokGuideDismissed(false, storage);
    expect(readByokGuideDismissed(storage)).toBe(false);
  });
});

describe("BYOK_GUIDE_VENDORS", () => {
  test("includes DeepSeek and treats Volcano as probeable both", () => {
    expect(BYOK_GUIDE_VENDORS.map((item) => item.id)).toContain("deepseek");
    expect(BYOK_GUIDE_VENDORS.find((item) => item.id === "volcano")?.kind).toBe("both");
  });
});

describe("resolveCapabilityJump", () => {
  test("BYOK vendors stay in the guide; others go to settings", () => {
    expect(resolveCapabilityJump("volcano")).toEqual({ kind: "byok", vendorId: "volcano" });
    expect(resolveCapabilityJump("moonshot")).toEqual({ kind: "byok", vendorId: "moonshot" });
    expect(resolveCapabilityJump("kling")).toEqual({ kind: "settings" });
    expect(findByokGuideVendor("kling")).toBeUndefined();
  });
});

describe("vendorHasConfiguredKey", () => {
  test("matches scanned project keys before paste", () => {
    expect(vendorHasConfiguredKey([{ id: "volcano" }, { id: "deepseek" }], "volcano")).toBe(true);
    expect(vendorHasConfiguredKey([{ id: "deepseek" }], "volcano")).toBe(false);
    expect(vendorHasConfiguredKey([], "deepseek")).toBe(false);
  });
});
