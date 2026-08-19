import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const backgroundUrl = new URL("../extension/background.js", import.meta.url);
const manifestUrl = new URL("../extension/manifest.json", import.meta.url);
const runtimeUrl = new URL("../opencode-plugin/wodeappx-browser-control-runtime.mjs", import.meta.url);

describe("WodeAppX browser-control extension contract", () => {
  test("read_page exposes bounded snapshot-scoped node ids without password values", async () => {
    const source = await readFile(backgroundUrl, "utf8");

    expect(source).toContain('const nodeAttribute = "data-wodeappx-node-id"');
    expect(source).toContain("interactiveElements");
    expect(source).toContain("interactiveElementsTruncated");
    expect(source).toContain("element.type === \"password\"");
    expect(source).toContain("password ? undefined");
    expect(source).toContain("Math.min(READ_PAGE_MAX_ELEMENTS_CAP");
    expect(source).toContain("pageText");
    expect(source).toContain("viewportOnly");
    expect(source).toContain("rect:");
  });

  test("click and type fail closed on missing, ambiguous, or invalid targets", async () => {
    const source = await readFile(backgroundUrl, "utf8");

    expect(source).toContain("TARGET_NOT_FOUND");
    expect(source).toContain("TARGET_AMBIGUOUS");
    expect(source).toContain("TARGET_SELECTOR_INVALID");
    expect(source).toContain("matches.length !== 1");
    expect(source).toContain('Object.getOwnPropertyDescriptor(prototype, "value")');
    expect(source).toContain("if (execution?.error)");
    expect(source).toContain('throw new Error(message || "Injected page operation failed")');
    expect(source).toContain('typeof value.__wodeappxError === "string"');
    expect(source).toContain("return { __wodeappxError: String(error?.message || error) }");
  });

  test("runtime binds one fresh Chrome client and advertises the operating workflow", async () => {
    const [source, background] = await Promise.all([
      readFile(runtimeUrl, "utf8"),
      readFile(backgroundUrl, "utf8"),
    ]);

    expect(source).toContain("CLIENT_STALE_MS");
    expect(source).toContain("selectedClientId");
    expect(source).toContain("recommendedClientId");
    expect(source).toContain("recommendedRawCdpClientId");
    expect(source).toContain("OFFICIAL_CHROME_WEB_STORE_EXTENSION_ID");
    expect(source).toContain("isExpectedExtensionClient");
    expect(source).toContain('clientSupportsRequiredAction(client, "page.cdp")');
    expect(source).toContain("extensionIdentityReported");
    expect(source).toContain('"chrome_web_store"');
    expect(source).toContain('"unpacked_or_other"');
    expect(source).toContain('"legacy_unknown"');
    expect(source).toContain("supportsRawCdp");
    expect(source).toContain("BROWSER_CLIENT_CAPABILITY_MISSING");
    expect(source).toContain("BROWSER_CDP_CLIENT_REQUIRED");
    expect(source).toContain("structuredDomSnapshot");
    expect(source).toContain("uniqueTargetEnforcement");
    expect(source).toContain("read_page (observe interactiveElements and nodeId)");
    expect(source).toContain("commandLongPoll");
    expect(source).toContain("batchedRun");
    expect(background).toContain("COMMAND_WAIT_MS");
    expect(background).toContain("page.run");
    expect(source).toContain("BROWSER_CLIENT_NOT_FOUND");
    expect(background).toContain("chrome.runtime.id");
    expect(background).toContain("extensionId,");
    expect(background).toContain("extensionName,");
    expect(background).toContain("supportedActions: SUPPORTED_ACTIONS");
    expect(background).toContain("Object.keys(ACTION_LABELS)");
  });

  test("prefers the packaged Native Messaging host with a localhost compatibility fallback", async () => {
    const [source, manifestText, runtime] = await Promise.all([
      readFile(backgroundUrl, "utf8"),
      readFile(manifestUrl, "utf8"),
      readFile(runtimeUrl, "utf8"),
    ]);
    const manifest = JSON.parse(manifestText);

    expect(manifest.version).toBe("1.4.4");
    expect(source).toContain('NOTICE_SKIP_ACTIONS = new Set(["tabs.list", "page.read"])');
    expect(source).toContain("DEBUGGER_ATTACH_ACTIONS");
    expect(source).toContain("pollInFlight");
    expect(source).toContain("BROWSER_DEBUGGER_OCCUPIED");
    expect(source).toContain("BROWSER_DEBUGGER_ATTACH_TIMEOUT");
    expect(source).toContain("if (NOTICE_SKIP_ACTIONS.has(action))");
    expect(source).toContain("READ_PAGE_DEFAULT_MAX_CHARS = 12000");
    expect(manifest.permissions).toContain("nativeMessaging");
    expect(source).toContain('const NATIVE_HOST_NAME = "com.wodeappx.browser_control"');
    expect(source).toContain("chrome.runtime.connectNative(NATIVE_HOST_NAME)");
    expect(source).toContain('transport: "native_messaging"');
    expect(source).toContain('transport: "localhost_http_fallback"');
    expect(source).toContain("if (error?.nativeHostReached && Number.isFinite(error.httpStatus))");
    expect(source).toContain('if (tab?.status !== "complete") return null');
    expect(source).toContain('notice?.action !== "tabs.open"');
    expect(source).toContain('notice?.action !== "tabs.navigate"');
    expect(source).toContain("chromeCall(chrome.tabs.create");
    expect(source).toContain("chromeCall(chrome.tabs.update");
    expect(runtime).toContain('const SERVER_VERSION = "0.7.2"');
    expect(runtime).toContain("stringifyBrowserResult");
    expect(runtime).toContain("prettyJson");
    expect(runtime).toContain("MAX_RESULT_CHARS || 200000");
    expect(runtime).toContain('req?.once?.("aborted"');
    expect(runtime).not.toContain('req?.once?.("close"');
    expect(runtime).toContain("if (commandWaiters.has(clientId))");
    expect(runtime).toContain("maxChars || 12000");
    expect(runtime).toContain("nativeMessagingPreferred: true");
    expect(runtime).toContain("localhostHttpFallback: true");
    expect(runtime).toContain("nativeHostVersion");
  });
});
