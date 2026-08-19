import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

import { resolveAccountMenuAuthActions } from "../wodeapp/wodeapp-account-menu";

const here = dirname(fileURLToPath(import.meta.url));
const footerPath = join(here, "../wodeapp/wodeapp-account-footer.tsx");
const dialogPath = join(here, "../wodeapp/wodeapp-local-key-dialog.tsx");
const accountSurfacePath = join(here, "../wodeapp/wodeapp-account-surface.tsx");
const serviceSettingsPath = join(here, "../wodeapp/wodeapp-service-settings.tsx");
const capabilityPanelPath = join(here, "../wodeapp/wodeapp-provider-capability-panel.tsx");
const serviceViewPath = join(here, "../wodeapp/wodeapp-service-view.tsx");

describe("resolveAccountMenuAuthActions", () => {
  test("unsigned-in and embedded trial stay local: login dialog, no logout", () => {
    expect(resolveAccountMenuAuthActions({ signedIn: false })).toEqual({
      showLogin: true,
      showAccount: false,
      showLogout: false,
    });
    expect(resolveAccountMenuAuthActions({ signedIn: true, embedded: true })).toEqual({
      showLogin: true,
      showAccount: false,
      showLogout: false,
    });
  });

  test("phone/email login shows account + logout", () => {
    expect(resolveAccountMenuAuthActions({ signedIn: true, embedded: false })).toEqual({
      showLogin: false,
      showAccount: true,
      showLogout: true,
    });
  });

  test("never pairs 登录 with 退出登录", () => {
    for (const input of [
      { signedIn: false },
      { signedIn: false, embedded: true },
      { signedIn: true },
      { signedIn: true, embedded: true },
      { signedIn: true, embedded: false },
    ] as const) {
      const actions = resolveAccountMenuAuthActions(input);
      expect(actions.showLogin && actions.showLogout).toBe(false);
    }
  });
});

describe("account footer source", () => {
  test("local and cloud are actions with hints; local opens 配置 dialog", () => {
    const footer = readFileSync(footerPath, "utf8");
    const dialog = readFileSync(dialogPath, "utf8");
    expect(footer).toContain("wx-account-menu-modes");
    expect(footer).not.toContain("is-active");
    expect(footer).toContain("unsignedLocalModeHint");
    expect(footer).toContain("{localModeHint}");
    expect(footer).not.toContain("<span>本机 Key · 可不登录</span>");
    expect(footer).toContain("openLocalKey");
    expect(footer).toContain("switchToLocal");
    expect(footer).toContain("profile: \"local-only\"");
    expect(footer).toContain("WODEAPP_OPEN_LOCAL_KEY_EVENT");
    expect(footer).toContain("登录 · 所有能力立即可用");
    expect(footer).not.toContain("查看能力");
    expect(footer).toContain("setRegionDialogOpen(true)");
    expect(footer).toContain("WodeAppLocalKeyDialog");
    expect(footer).not.toContain("配置本机模型");
    expect(footer).toContain("useFirstMileEntryCue");
    expect(footer).toContain("is-first-mile-cue");
    expect(footer).toContain("title={firstMileCue ? \"开始使用\" : undefined}");
    expect(footer).not.toContain("初始化引导");
    expect(footer).not.toContain("检查更新");
    expect(footer).toContain("<span>账户</span>");
    expect(footer).toContain("<span>配置本机 Key</span>");
    expect(footer).toContain("<span>退出登录</span>");
    expect(dialog).toContain("配置本机 Key");
    expect(dialog).toContain("快速配置");
    expect(dialog).toContain("WodeAppProviderCapabilityPanel");
    expect(dialog).toContain("/settings/service");
  });
});

describe("account model surface source", () => {
  test("guide and local-key sit on the capability table header; bottom action row is gone", () => {
    const surface = readFileSync(accountSurfacePath, "utf8");
    const settings = readFileSync(serviceSettingsPath, "utf8");
    const panel = readFileSync(capabilityPanelPath, "utf8");
    expect(surface).not.toContain("初始化引导");
    expect(surface).not.toContain("导入本机 Key");
    expect(surface).not.toContain("获取 API Key");
    expect(settings).not.toContain("初始化引导");
    expect(settings).not.toContain("导入本机 Key");
    expect(settings).not.toContain("获取 API Key");
    expect(panel).toContain("初始化引导");
    expect(panel).toContain("导入本机 Key");
    expect(panel).toContain("openFirstMileGuide");
    expect(panel).toContain("WODEAPP_OPEN_LOCAL_KEY_EVENT");
    expect(panel).toContain("embedded ? null");
    expect(panel).toContain("自定义云厂商");
    expect(panel).toContain("保存并探测");
    expect(panel).toContain("saveWodeAppCustomVendor");
    const view = readFileSync(serviceViewPath, "utf8");
    expect(view).not.toContain("WodeAppServiceSettings");
    expect(view).not.toContain("WodeAppLocalByokImportSettings");
    expect(view).toContain("WodeAppByokGuideDialog");
    expect(view).toContain("useWodeAppFirstMileOpenState");
    expect(view).toContain("WodeAppLocalKeyDialog");
    expect(view).toContain("WODEAPP_OPEN_LOCAL_KEY_EVENT");
    expect(surface).not.toContain("WodeAppServiceSettings");
  });
});

describe("session model persistence source", () => {
  test("user model picks are remembered as the default for new chats", () => {
    const route = readFileSync(join(here, "../fork/apps/app/src/react-app/shell/session-route.tsx"), "utf8");
    const sync = readFileSync(join(here, "../wodeapp/wodeapp-model-sync.ts"), "utf8");
    expect(sync).toContain("rememberUserSelectedDefaultModel");
    expect(sync).toContain("USER_DEFAULT_MODEL_CHOICE_KEY");
    expect(route).toContain("rememberSelectedModel");
    expect(route).toContain("rememberUserSelectedDefaultModel");
    expect(route).toContain("onModelChange: (model: ModelRef) => {");
    expect(route).toContain("rememberSelectedModel(nextModel)");
  });
});
