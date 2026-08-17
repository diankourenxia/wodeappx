import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  WODEAPP_FEISHU_AUTHORIZE_DEEP_LINK,
  isWodeAppFeishuAuthorizeDeepLink,
  parseWodeAppFeishuAuthorizeDeepLink,
} from "../wodeapp/wodeapp-feishu-deep-link";
import {
  bindFeishuAuthorizationPromptToSession,
  selectFeishuAuthorizationPromptForSession,
} from "../wodeapp/wodeapp-feishu-authorization-scope";
import { takePendingDeepLinks } from "../../../vendor/openwork/apps/app/src/app/lib/deep-link-bridge";

describe("WodeAppX Feishu authorization deep links", () => {
  test("accepts the branded link and the OpenWork compatibility aliases", () => {
    expect(parseWodeAppFeishuAuthorizeDeepLink(WODEAPP_FEISHU_AUTHORIZE_DEEP_LINK)).toEqual({
      action: "authorize",
      source: null,
    });
    expect(isWodeAppFeishuAuthorizeDeepLink("openwork://feishu/authorize?source=download-page")).toBe(true);
    expect(isWodeAppFeishuAuthorizeDeepLink("openwork-dev://feishu/authorize")).toBe(true);
  });

  test("rejects unrelated routes and any link carrying secrets", () => {
    expect(isWodeAppFeishuAuthorizeDeepLink("https://wodeapp.cn/feishu/authorize")).toBe(false);
    expect(isWodeAppFeishuAuthorizeDeepLink("wodeappx://shopify/authorize")).toBe(false);
    expect(isWodeAppFeishuAuthorizeDeepLink("wodeappx://feishu/authorize?appSecret=do-not-put-secrets-in-links")).toBe(false);
    expect(isWodeAppFeishuAuthorizeDeepLink("wodeappx://feishu/authorize?APP_SECRET=do-not-put-secrets-in-links")).toBe(false);
  });

  test("takes only Feishu links and preserves pending links for other consumers", () => {
    const target = {
      __OPENWORK__: {
        deepLinks: [
          "openwork://den-auth?grant=grant-1",
          WODEAPP_FEISHU_AUTHORIZE_DEEP_LINK,
          "openwork://other/action",
        ],
      },
    } as unknown as Window;

    expect(takePendingDeepLinks(target, isWodeAppFeishuAuthorizeDeepLink)).toEqual([
      WODEAPP_FEISHU_AUTHORIZE_DEEP_LINK,
    ]);
    expect(target.__OPENWORK__?.deepLinks).toEqual([
      "openwork://den-auth?grant=grant-1",
      "openwork://other/action",
    ]);
  });

  test("registers and forwards the branded protocol in the packaged desktop app", () => {
    const integrationRoot = resolve(import.meta.dir, "..");
    const desktopMain = readFileSync(
      resolve(integrationRoot, "fork/apps/desktop/electron/main.mjs"),
      "utf8",
    );
    const desktopBuilder = readFileSync(
      resolve(integrationRoot, "../../vendor/openwork/apps/desktop/electron-builder.yml"),
      "utf8",
    );
    const desktopPreload = readFileSync(
      resolve(integrationRoot, "../../vendor/openwork/apps/desktop/electron/preload.mjs"),
      "utf8",
    );
    const desktopBridge = readFileSync(
      resolve(integrationRoot, "fork/apps/app/src/app/lib/desktop.ts"),
      "utf8",
    );

    expect(desktopMain).toContain('const DESKTOP_PROTOCOL_SCHEMES = ["openwork", "wodeappx"]');
    expect(desktopMain).toContain("app.setAsDefaultProtocolClient(scheme)");
    expect(desktopMain).toContain('entry.startsWith("wodeappx://")');
    expect(desktopBuilder).toMatch(/schemes:\s*\n\s*- openwork\s*\n\s*- wodeappx/);
    expect(desktopPreload).toContain("pendingNativeDeepLinks");
    expect(desktopPreload).toContain("takePending()");
    expect(desktopBridge).toContain("deepLinks?.takePending?.()");
  });

  test("renders a Codex-style authorization card with explicit actions above the composer", () => {
    const panelSource = readFileSync(
      resolve(import.meta.dir, "../wodeapp/wodeapp-feishu-authorization-panel.tsx"),
      "utf8",
    );
    expect(panelSource).toContain("data-wodeapp-feishu-authorization");
    expect(panelSource).toContain("允许WodeAppX 连接飞书？");
    expect(panelSource).toContain("打开飞书授权");
    expect(panelSource).toContain("配置飞书应用后继续");
    expect(panelSource).toContain("配置飞书应用");
    expect(panelSource).toContain("稍后");
    expect(panelSource).not.toContain("transition-all");
  });

  test("routes a deep link into the composer accessory before starting OAuth", () => {
    const integrationRoot = resolve(import.meta.dir, "..");
    const shellSource = readFileSync(
      resolve(integrationRoot, "wodeapp/wodeapp-workbench-shell.tsx"),
      "utf8",
    );
    const surfaceSource = readFileSync(
      resolve(integrationRoot, "fork/apps/app/src/react-app/domains/session/surface/session-surface.tsx"),
      "utf8",
    );

    expect(shellSource).toContain("requestFeishuAuthorization({ source: parsed.source })");
    expect(shellSource).toContain("onConfirmFeishuAuthorization: confirmFeishuAuthorization");
    expect(shellSource).toContain("retainedFeishuAuthorizationPrompt");
    expect(shellSource).toContain("() => retainedFeishuAuthorizationPrompt");
    expect(shellSource).toContain("bindFeishuAuthorizationPromptToSession");
    expect(shellSource).toContain("selectFeishuAuthorizationPromptForSession");
    expect(surfaceSource).toContain(
      "wodeAppWorkbench?.feishuAuthorizationPrompt?.sessionId === props.sessionId",
    );
    expect(surfaceSource).toContain("showFeishuAuthorizationPrompt");
    expect(surfaceSource).toContain("<WodeAppFeishuAuthorizationAccessory />");
  });

  test("shows a pending authorization prompt only in its owning session", () => {
    const pending = {
      status: "ready" as const,
      source: "e2e",
      requestedAt: 1,
      workspaceId: "workspace-a",
      sessionId: null,
    };
    const bound = bindFeishuAuthorizationPromptToSession(
      pending,
      "workspace-a",
      "session-a",
    );

    expect(bound?.sessionId).toBe("session-a");
    expect(
      selectFeishuAuthorizationPromptForSession(
        bound,
        "workspace-a",
        "session-a",
      ),
    ).toEqual(bound);
    expect(
      selectFeishuAuthorizationPromptForSession(
        bound,
        "workspace-a",
        "session-b",
      ),
    ).toBeNull();
    expect(
      selectFeishuAuthorizationPromptForSession(
        bound,
        "workspace-b",
        "session-a",
      ),
    ).toBeNull();
  });

  test("recognizes an authorized official Feishu CLI profile before legacy credentials", () => {
    const integrationRoot = resolve(import.meta.dir, "..");
    const extensionSource = readFileSync(
      resolve(integrationRoot, "feishu-agent-mcp.ts"),
      "utf8",
    );
    const routeSource = readFileSync(
      resolve(integrationRoot, "fork/apps/app/src/react-app/shell/session-route.tsx"),
      "utf8",
    );
    const settingsSource = readFileSync(
      resolve(integrationRoot, "feishu-mcp-config.tsx"),
      "utf8",
    );

    expect(extensionSource).toContain('args: ["whoami", "--json"]');
    expect(extensionSource).toContain('integration: cli.authorized ? "lark-cli"');
    expect(extensionSource).toContain("configured: cli.authorized || legacyConfigured");
    expect(routeSource).toContain('status.authorized && status.integration === "lark-cli"');
    expect(routeSource).toContain("飞书已连接");
    expect(settingsSource).toContain("Feishu CLI is connected");
    expect(settingsSource).toContain("cliConnected");
  });
});
