import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

import {
  FIRST_MILE_DISMISS_KEY,
  FIRST_MILE_PHASE_LABELS,
  firstMileChromePrimaryLabel,
  firstMileChromeSecondaryLabel,
  isFirstMileCoreComplete,
  nextVisibleFirstMilePhase,
  normalizeFirstMileOpenDetail,
  pickInitialFirstMilePhase,
  prevVisibleFirstMilePhase,
  readFirstMileDismissed,
  resolveFirstMileChecklist,
  resolveFirstMileChromeFooter,
  resolveFirstMileHasUsableModel,
  shouldWaitForProviderListBeforeFirstMile,
  shouldAutoOpenFirstMile,
  shouldShowFirstMileEntryCue,
  visibleFirstMilePhases,
  writeFirstMileDismissed,
} from "../wodeapp/wodeapp-first-mile";
import { BYOK_GUIDE_DISMISS_KEY } from "../wodeapp/wodeapp-byok-guide";

const here = dirname(fileURLToPath(import.meta.url));

function memStorage() {
  const mem = new Map<string, string>();
  return {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
    removeItem: (k: string) => {
      mem.delete(k);
    },
    raw: mem,
  };
}

describe("isFirstMileCoreComplete", () => {
  test("requires usable model only (workspace is not a First Mile step)", () => {
    expect(isFirstMileCoreComplete({ hasUsableModel: true })).toBe(true);
    expect(isFirstMileCoreComplete({ hasUsableModel: false })).toBe(false);
  });
});

describe("resolveFirstMileHasUsableModel", () => {
  test("ignores workbench hide-detection: leftover wode/* default is not usable", () => {
    expect(resolveFirstMileHasUsableModel({
      hasSelectedModel: true,
      selectedModelUnavailable: true,
    })).toBe(false);
    expect(resolveFirstMileHasUsableModel({
      hasSelectedModel: true,
      selectedModelUnavailable: false,
    })).toBe(true);
    expect(resolveFirstMileHasUsableModel({
      hasSelectedModel: false,
      selectedModelUnavailable: false,
    })).toBe(false);
  });
});

describe("shouldAutoOpenFirstMile", () => {
  test("opens when model missing and not dismissed", () => {
    expect(shouldAutoOpenFirstMile({
      ready: true,
      dismissed: false,
      hasUsableModel: false,
    })).toBe(true);
    expect(shouldAutoOpenFirstMile({
      ready: true,
      dismissed: false,
      hasUsableModel: true,
    })).toBe(false);
    expect(shouldAutoOpenFirstMile({
      ready: false,
      dismissed: false,
      hasUsableModel: false,
    })).toBe(false);
    expect(shouldAutoOpenFirstMile({
      ready: true,
      dismissed: true,
      hasUsableModel: false,
    })).toBe(false);
  });
});

describe("shouldWaitForProviderListBeforeFirstMile", () => {
  test("waits only while a fetch is in flight, not on leftover isPending", () => {
    expect(shouldWaitForProviderListBeforeFirstMile({ isFetching: true })).toBe(true);
    expect(shouldWaitForProviderListBeforeFirstMile({ isFetching: false })).toBe(false);
  });
});

describe("shouldShowFirstMileEntryCue", () => {
  test("shows badge until dismissed or a model is ready", () => {
    expect(shouldShowFirstMileEntryCue({ dismissed: false, hasUsableModel: false })).toBe(true);
    expect(shouldShowFirstMileEntryCue({ dismissed: false, hasUsableModel: true })).toBe(false);
    expect(shouldShowFirstMileEntryCue({ dismissed: true, hasUsableModel: false })).toBe(false);
  });
});

describe("resolveFirstMileChecklist", () => {
  test("starts at model; chrome optional; projects hidden", () => {
    const checklist = resolveFirstMileChecklist({
      hasUsableModel: false,
      hasPlatformIdentity: false,
      abilityProjectCount: 0,
      chrome: { kind: "ready", connected: false, setupUrl: "http://127.0.0.1:17654/setup" },
    });
    expect(checklist.model).toBe("todo");
    expect(checklist.chrome).toBe("optional");
    expect(checklist.projects).toBe("hidden");
    expect(pickInitialFirstMilePhase(checklist)).toBe("model");
    expect(visibleFirstMilePhases(checklist)).toEqual([
      "model",
      "chrome",
    ]);
    expect(FIRST_MILE_PHASE_LABELS.model).toBe("本机 Key");
  });

  test("capability table 去配置 honors onJumpSource from First Mile / 配置本机 Key", () => {
    const panel = readFileSync(
      join(here, "../wodeapp/wodeapp-provider-capability-panel.tsx"),
      "utf8",
    );
    expect(panel).toContain("onJumpSource");
    expect(panel).toMatch(/if \(onJumpSource\) \{\s*onJumpSource\(source\);/);
    const dialog = readFileSync(join(here, "../wodeapp/wodeapp-byok-guide-dialog.tsx"), "utf8");
    expect(dialog).toContain("onJumpSource={(source) => jumpToVendor(source.id)}");
    const localKey = readFileSync(join(here, "../wodeapp/wodeapp-local-key-dialog.tsx"), "utf8");
    expect(localKey).toContain("onJumpSource={goQuickSetup}");
  });

  test("dialog first step offers 本地 and 云端 as equal cards", () => {
    const dialog = readFileSync(join(here, "../wodeapp/wodeapp-byok-guide-dialog.tsx"), "utf8");
    expect(dialog).toContain("FIRST_MILE_LOCAL_LABEL");
    expect(dialog).toContain("FIRST_MILE_CLOUD_LOGIN_LABEL");
    expect(dialog).toContain("WODEAPP_OPEN_LOGIN_EVENT");
    expect(dialog).toContain("openCloudLogin");
    expect(dialog).toContain("wx-first-mile-local");
    expect(dialog).toContain("wx-first-mile-cloud");
    expect(dialog).toContain("本机 Key · 可不登录");
    expect(dialog).toContain("登录 · 所有能力立即可用");
    expect(dialog).toContain("wx-account-menu-modes wx-first-mile-paths");
  });

  test("empty session chip reopens the same first-mile dialog", () => {
    const surface = readFileSync(
      join(here, "../fork/apps/app/src/react-app/domains/session/surface/session-surface.tsx"),
      "utf8",
    );
    expect(surface).toContain("useFirstMileEntryCue");
    expect(surface).toContain("开始使用");
    expect(surface).toContain("openFirstMileGuide()");
  });

  test("chrome connected → done; ability projects stay out of the wizard", () => {
    const checklist = resolveFirstMileChecklist({
      hasUsableModel: true,
      hasPlatformIdentity: true,
      abilityProjectCount: 5,
      chrome: { kind: "ready", connected: true, setupUrl: "http://127.0.0.1:17654/setup" },
    });
    expect(checklist.model).toBe("done");
    expect(checklist.chrome).toBe("done");
    expect(checklist.projects).toBe("hidden");
    expect(pickInitialFirstMilePhase(checklist)).toBe("model");
    expect(nextVisibleFirstMilePhase("chrome", checklist)).toBe("done");
    expect(visibleFirstMilePhases(checklist)).toEqual(["model", "chrome"]);
  });
});

describe("resolveFirstMileChromeFooter", () => {
  test("continue never opens Chrome; 忽略 + 安装调试", () => {
    const expected = { primary: "skip", secondary: "install" };
    expect(resolveFirstMileChromeFooter({ kind: "unknown" })).toEqual(expected);
    expect(resolveFirstMileChromeFooter({
      kind: "ready",
      connected: false,
      setupUrl: "http://127.0.0.1:17654/setup",
    })).toEqual(expected);
    expect(resolveFirstMileChromeFooter({
      kind: "ready",
      connected: true,
      setupUrl: "http://127.0.0.1:17654/setup",
    })).toEqual(expected);
    expect(resolveFirstMileChromeFooter({ kind: "unavailable" })).toEqual(expected);
    expect(firstMileChromePrimaryLabel()).toBe("忽略");
    expect(firstMileChromeSecondaryLabel()).toBe("安装调试");
  });
});

describe("first mile dismiss storage", () => {
  test("writes both first-mile and legacy byok keys", () => {
    const storage = memStorage();
    expect(readFirstMileDismissed(storage)).toBe(false);
    writeFirstMileDismissed(true, storage);
    expect(storage.raw.get(FIRST_MILE_DISMISS_KEY)).toBe("1");
    expect(storage.raw.get(BYOK_GUIDE_DISMISS_KEY)).toBe("1");
    expect(readFirstMileDismissed(storage)).toBe(true);
  });

  test("migrates legacy byok dismiss", () => {
    const storage = memStorage();
    storage.setItem(BYOK_GUIDE_DISMISS_KEY, "1");
    expect(readFirstMileDismissed(storage)).toBe(true);
  });
});

describe("guided phase helpers", () => {
  test("prevVisibleFirstMilePhase walks backward", () => {
    const checklist = resolveFirstMileChecklist({
      hasUsableModel: false,
      hasPlatformIdentity: false,
      abilityProjectCount: 0,
      chrome: { kind: "ready", connected: false, setupUrl: "http://127.0.0.1:17654/setup" },
    });
    expect(prevVisibleFirstMilePhase("model", checklist)).toBe(null);
    expect(prevVisibleFirstMilePhase("chrome", checklist)).toBe("model");
    expect(prevVisibleFirstMilePhase("projects", checklist)).toBe(null);
    expect(nextVisibleFirstMilePhase("chrome", checklist)).toBe("done");
  });

  test("normalizeFirstMileOpenDetail keeps optional phase seed", () => {
    expect(normalizeFirstMileOpenDetail({ hasUsableModel: true, phase: "chrome" })).toEqual({
      hasUsableModel: true,
      phase: "chrome",
    });
    expect(normalizeFirstMileOpenDetail({ phase: "nope" })).toEqual({});
  });
});
