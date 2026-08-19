import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, test } from "bun:test";

function existingSourceUrl(...relativeCandidates: string[]): URL {
  for (const relativePath of relativeCandidates) {
    const candidate = new URL(relativePath, import.meta.url);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Unable to locate source file: ${relativeCandidates.join(", ")}`);
}

const footerUrl = existingSourceUrl(
  "../wodeapp/wodeapp-account-footer.tsx",
  "../src/react-app/domains/wodeapp/wodeapp-account-footer.tsx",
);
const chromeUrl = existingSourceUrl(
  "../wodeapp/wodeapp-main-chrome.tsx",
  "../fork/apps/app/src/react-app/domains/wodeapp/wodeapp-main-chrome.tsx",
);
const settingsPageUrl = existingSourceUrl(
  "../fork/apps/app/src/react-app/domains/settings/shell/settings-page.tsx",
);
const surfaceUrl = existingSourceUrl(
  "../fork/apps/app/src/react-app/domains/session/surface/session-surface.tsx",
  "../src/react-app/domains/session/surface/session-surface.tsx",
);
const i18nUrl = existingSourceUrl("../fork/apps/app/src/i18n/index.ts");
const sessionRouteUrl = existingSourceUrl("../fork/apps/app/src/react-app/shell/session-route.tsx");
const messageListUrl = existingSourceUrl("../fork/apps/app/src/components/chat/message-list.tsx");

describe("web-facing copy", () => {
  test("download card and unsigned footer use product Chinese", async () => {
    const source = await readFile(footerUrl, "utf8");
    expect(source).toContain("本机运行，自定义智能体更完整");
    expect(source).not.toContain("自动化，自定义智能体等完整功能吧");
    expect(source).toContain('{isWebDeployment() ? "登" : "BY"}');
    expect(source).toContain('{isWebDeployment() ? "登录" : "本地"}');
  });

  test("topbar uses public WodeAppX on web and hides desktop settings", async () => {
    const chrome = await readFile(chromeUrl, "utf8");
    const settings = await readFile(settingsPageUrl, "utf8");
    expect(chrome).toContain('{isWebDeployment() ? "WodeAppX" : "wodeappx"}');
    expect(chrome).toContain('navigate(isWebDeployment() ? "/settings/appearance" : "/settings/service")');
    expect(settings).toContain('if (isWebDeployment()) return ["appearance"]');
  });

  test("empty hero says 自定义智能体 and does not keep Agent English", async () => {
    const source = await readFile(surfaceUrl, "utf8");
    expect(source).toContain("自定义智能体");
    expect(source).not.toContain("自定义 Agent");
    expect(source).toContain("firstMileCue && !isWebDeployment()");
  });

  test("web locale follows official site or .cn/.ai host, not a stale OS pref", async () => {
    const source = await readFile(i18nUrl, "utf8");
    expect(source).toContain('const OFFICIAL_SETTINGS_KEY = "app-settings"');
    expect(source).toContain('host.endsWith(".wodeapp.cn")');
    expect(source).toContain("if (isWebDeploymentEnv())");
  });

  test("web send injects browser-chat identity and sanitizes leftover 401 JSON", async () => {
    const sessionRoute = await readFile(sessionRouteUrl, "utf8");
    const messageList = await readFile(messageListUrl, "utf8");
    expect(sessionRoute).toContain("WEB_SURFACE_IDENTITY_PACK");
    expect(sessionRoute).toContain("isWebDeployment() ? WEB_SURFACE_IDENTITY_PACK");
    expect(messageList).toContain("AUTH_REQUIRED|credit_error|请先登录");
    expect(messageList).toContain("请先登录后再发送");
  });
});
