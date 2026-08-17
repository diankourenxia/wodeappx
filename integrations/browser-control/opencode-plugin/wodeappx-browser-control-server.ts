/**
 * Runtime OpenCode plugin (zod tool shape) for the always-on Chrome bridge.
 * Synced into apps/server/src/opencode-plugins/wodeappx-browser-control.ts.
 *
 * Codex-like behavior: the host/bridge starts with the sidecar, so the Chrome
 * extension can connect as soon as WodeAppX is running.
 */
import { z } from "zod";
import {
  assertRawCdpAuthorization,
  BROWSER_TOOL_DESCRIPTIONS,
  buildSidePanelBrowserPrompt,
  OPTIONAL_TAB_ID_DESCRIPTION,
} from "./wodeappx-browser-control-guidance.js";

type BrowserControlRuntime = {
  startBridge: () => Promise<boolean>;
  callBrowserControl: (action: string, args?: Record<string, unknown>) => Promise<string>;
  registerSidePanelChatAdapter: (adapter: {
    message: (input: {
      sessionId?: string;
      prompt: string;
      activeTab?: unknown;
    }) => Promise<unknown>;
  } | null) => void;
};

type OpenCodeClient = {
  session?: {
    create: (input: { body: { title?: string } }) => Promise<unknown>;
    prompt: (input: { path: { id: string }; body: { parts: Array<{ type: string; text: string }> } }) => Promise<unknown>;
  };
};

const optionalTabId = z.number().optional().describe(OPTIONAL_TAB_ID_DESCRIPTION);
const optionalClientId = z.string().optional().describe("Exact connected Chrome client id returned by wodeappx_browser_status. Bind it once when more than one client is listed.");
const optionalTimeoutMs = z.number().optional().describe("Command timeout in milliseconds.");

function responseData<T>(value: T): any {
  return (value as any)?.data ?? value;
}

function responseText(value: unknown): string {
  const data = responseData(value);
  const parts = Array.isArray(data?.parts) ? data.parts : [];
  return parts
    .filter((part: any) => part?.type === "text" && typeof part.text === "string")
    .map((part: any) => part.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

async function loadRuntime(): Promise<BrowserControlRuntime> {
  // Runtime is plain ESM; resolve by URL so tsc does not require a .d.ts sibling.
  const href = new URL("./wodeappx-browser-control-runtime.mjs", import.meta.url).href;
  const mod = await import(href);
  return mod as BrowserControlRuntime;
}

export default async ({ client }: { client?: OpenCodeClient } = {}) => {
  const { startBridge, callBrowserControl, registerSidePanelChatAdapter } = await loadRuntime();
  await startBridge();

  if (client?.session) {
    registerSidePanelChatAdapter({
      async message({ sessionId, prompt, activeTab }: { sessionId?: string; prompt: string; activeTab?: any }) {
        let resolvedSessionId = String(sessionId || "").trim();
        if (!resolvedSessionId) {
          const created = responseData(await client.session!.create({
            body: { title: prompt.trim().slice(0, 48) || "Chrome 浏览器任务" },
          }));
          resolvedSessionId = String(created?.id || created?.sessionID || "");
        }
        if (!resolvedSessionId) throw new Error("WodeAppX could not create a chat session");

        const result = await client.session!.prompt({
          path: { id: resolvedSessionId },
          body: {
            parts: [{ type: "text", text: buildSidePanelBrowserPrompt(prompt, activeTab) }],
          },
        });
        return {
          sessionId: resolvedSessionId,
          reply: responseText(result) || "WodeAppX 已完成本轮处理。",
        };
      },
    });
  }

  return {
    tool: {
      wodeappx_browser_status: {
        description: BROWSER_TOOL_DESCRIPTIONS.status,
        args: {},
        async execute() {
          return callBrowserControl("status", {});
        },
      },
      wodeappx_browser_tabs: {
        description: BROWSER_TOOL_DESCRIPTIONS.tabs,
        args: {
          clientId: optionalClientId,
          activeOnly: z.boolean().optional().describe("Return only the active tab."),
          timeoutMs: optionalTimeoutMs,
        },
        async execute(args: { clientId?: string; activeOnly?: boolean; timeoutMs?: number }) {
          return callBrowserControl("tabs", args);
        },
      },
      wodeappx_browser_open_url: {
        description: BROWSER_TOOL_DESCRIPTIONS.openUrl,
        args: {
          clientId: optionalClientId,
          url: z.string().describe("URL to open."),
          newTab: z.boolean().optional().describe("Open in a new tab. Defaults to true."),
          tabId: z.number().optional().describe("Existing tab id to navigate when newTab is false."),
          allowAssetUrl: z.boolean().optional().describe("Set true only when the user explicitly asked to inspect an image/media/CDN asset URL."),
          timeoutMs: optionalTimeoutMs,
        },
        async execute(args: { clientId?: string; url: string; newTab?: boolean; tabId?: number; allowAssetUrl?: boolean; timeoutMs?: number }) {
          return callBrowserControl("open_url", args);
        },
      },
      wodeappx_browser_read_page: {
        description: BROWSER_TOOL_DESCRIPTIONS.readPage,
        args: {
          clientId: optionalClientId,
          tabId: optionalTabId,
          maxChars: z.number().optional().describe("Maximum page text characters to return. Defaults to 8000."),
          maxElements: z.number().optional().describe("Maximum visible interactive elements to return. Defaults to 160 and is capped at 240."),
          timeoutMs: optionalTimeoutMs,
        },
        async execute(args: { clientId?: string; tabId?: number; maxChars?: number; maxElements?: number; timeoutMs?: number }) {
          return callBrowserControl("read_page", args);
        },
      },
      wodeappx_browser_click: {
        description: BROWSER_TOOL_DESCRIPTIONS.click,
        args: {
          clientId: optionalClientId,
          tabId: optionalTabId,
          nodeId: z.string().optional().describe("Preferred exact nodeId from the latest read_page interactiveElements snapshot."),
          selector: z.string().optional().describe("Fallback CSS selector. It must match exactly one visible element."),
          text: z.string().optional().describe("Fallback exact visible/accessibility text. Partial matches are rejected."),
          timeoutMs: optionalTimeoutMs,
        },
        async execute(args: { clientId?: string; tabId?: number; nodeId?: string; selector?: string; text?: string; timeoutMs?: number }) {
          return callBrowserControl("click", args);
        },
      },
      wodeappx_browser_type: {
        description: BROWSER_TOOL_DESCRIPTIONS.type,
        args: {
          clientId: optionalClientId,
          tabId: optionalTabId,
          nodeId: z.string().optional().describe("Preferred exact nodeId from the latest read_page interactiveElements snapshot."),
          selector: z.string().optional().describe("Fallback CSS selector for exactly one editable element."),
          text: z.string().describe("Text to enter."),
          replace: z.boolean().optional().describe("Replace current value. Defaults to true."),
          pressEnter: z.boolean().optional().describe("Press Enter after typing."),
          timeoutMs: optionalTimeoutMs,
        },
        async execute(args: { clientId?: string; tabId?: number; nodeId?: string; selector?: string; text: string; replace?: boolean; pressEnter?: boolean; timeoutMs?: number }) {
          return callBrowserControl("type", args);
        },
      },
      wodeappx_browser_key: {
        description: BROWSER_TOOL_DESCRIPTIONS.key,
        args: {
          clientId: optionalClientId,
          tabId: optionalTabId,
          nodeId: z.string().optional().describe("Preferred exact nodeId to focus before sending the key."),
          selector: z.string().optional().describe("Fallback unique CSS selector to focus first."),
          key: z.string().describe("Key value such as Enter, Escape, ArrowDown, or Tab."),
          timeoutMs: optionalTimeoutMs,
        },
        async execute(args: { clientId?: string; tabId?: number; nodeId?: string; selector?: string; key: string; timeoutMs?: number }) {
          return callBrowserControl("key", args);
        },
      },
      wodeappx_browser_eval: {
        description: BROWSER_TOOL_DESCRIPTIONS.eval,
        args: {
          clientId: optionalClientId,
          tabId: optionalTabId,
          code: z.string().describe("JavaScript expression or async code to evaluate."),
          timeoutMs: optionalTimeoutMs,
        },
        async execute(args: { clientId?: string; tabId?: number; code: string; timeoutMs?: number }) {
          return callBrowserControl("eval", args);
        },
      },
      wodeappx_browser_screenshot: {
        description: BROWSER_TOOL_DESCRIPTIONS.screenshot,
        args: {
          clientId: optionalClientId,
          tabId: optionalTabId,
          savePath: z.string().optional().describe("Optional absolute or relative PNG output path."),
          timeoutMs: optionalTimeoutMs,
        },
        async execute(args: { clientId?: string; tabId?: number; savePath?: string; timeoutMs?: number }) {
          return callBrowserControl("screenshot", args);
        },
      },
      wodeappx_browser_run: {
        description: BROWSER_TOOL_DESCRIPTIONS.run,
        args: {
          clientId: optionalClientId,
          tabId: optionalTabId,
          steps: z.array(z.record(z.string(), z.any())).describe("Ordered Chrome actions. Each step uses do/action plus args, for example {do:\"click\",nodeId:\"n-1\"} or {do:\"open_url\",url:\"https://example.com\"}."),
          timeoutMs: optionalTimeoutMs,
        },
        async execute(args: { clientId?: string; tabId?: number; steps: Array<Record<string, unknown>>; timeoutMs?: number }) {
          return callBrowserControl("run", args);
        },
      },
      wodeappx_browser_execute: {
        description: BROWSER_TOOL_DESCRIPTIONS.execute,
        args: {
          clientId: optionalClientId,
          action: z.string().describe("Raw action name, for example tabs.list or page.read."),
          argsJson: z.string().optional().describe("Optional JSON object string with raw action arguments."),
          timeoutMs: optionalTimeoutMs,
        },
        async execute(args: { clientId?: string; action: string; argsJson?: string; timeoutMs?: number }) {
          const rawArgs = args.argsJson ? JSON.parse(args.argsJson) : {};
          return callBrowserControl("execute", { clientId: args.clientId, action: args.action, args: rawArgs, timeoutMs: args.timeoutMs });
        },
      },
      wodeappx_browser_cdp: {
        description: BROWSER_TOOL_DESCRIPTIONS.cdp,
        args: {
          clientId: optionalClientId,
          tabId: z.number().describe("Exact Chrome tab id returned by wodeappx_browser_tabs. Raw CDP never guesses or defaults this target."),
          purpose: z.string().describe("Short, bounded reason for using raw CDP on this site."),
          userConfirmed: z.boolean().describe("Must be true only after the user explicitly approves raw CDP for this site and purpose."),
          method: z.string().describe("CDP method such as Runtime.evaluate or Input.dispatchKeyEvent."),
          paramsJson: z.string().optional().describe("Optional JSON object string with CDP params."),
          timeoutMs: optionalTimeoutMs,
        },
        async execute(args: { clientId?: string; tabId: number; purpose: string; userConfirmed: boolean; method: string; paramsJson?: string; timeoutMs?: number }) {
          const authorization = assertRawCdpAuthorization(args);
          const params = args.paramsJson ? JSON.parse(args.paramsJson) : {};
          return callBrowserControl("execute", {
            clientId: args.clientId,
            action: "page.cdp",
            args: { tabId: authorization.tabId, purpose: authorization.purpose, method: args.method, params },
            timeoutMs: args.timeoutMs,
          });
        },
      },
    },
  };
};
