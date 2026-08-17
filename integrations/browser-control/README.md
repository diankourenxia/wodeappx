# WodeAppX Browser Control

Built-in browser-control bridge and Chrome chat side panel for WodeAppX / OpenWork.

This integration has three parts:

- `extension/`: the single canonical Chrome Web Store source. Clicking its toolbar icon opens a WodeAppX chat in Chrome's side panel; the same extension executes browser actions.
- `opencode-plugin/`: a native OpenCode plugin that exposes browser tools inside WodeAppX chat.
- `opencode-plugin/wodeappx-capabilities-bridge.ts`: auto-loads WodeAppX local UI, capture, file search/preview/batch planning, Computer Use, clipboard, privacy-safe real Chrome, and scheduler-adjacent desktop capabilities into the live chat sidecar without MCP.
- `skills/wodeappx-browser-control/SKILL.md`: operating guidance for browser-control tasks.

The desktop app registers the `com.wodeappx.browser_control` Chrome Native
Messaging host. The extension uses that host as its primary local transport;
the host proxies only the fixed browser-control operations to the OpenCode
bridge at `http://127.0.0.1:17654`. Direct extension-to-localhost HTTP remains
as a compatibility fallback while desktop and Web Store updates roll out.

## Tools

- `wodeappx_browser_status`
- `wodeappx_browser_tabs`
- `wodeappx_browser_open_url`
- `wodeappx_browser_read_page`
- `wodeappx_browser_click`
- `wodeappx_browser_type`
- `wodeappx_browser_key`
- `wodeappx_browser_eval`
- `wodeappx_browser_screenshot`
- `wodeappx_browser_execute`
- `wodeappx_browser_run`
- `wodeappx_browser_cdp`

The OpenCode runtime loads `wodeappx-browser-control` as an always-on sidecar
plugin. WodeAppX registers the native host and starts the bridge automatically,
so no separate service or extension login is required once the desktop app is
running.

## Install the Chrome extension

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Choose Load unpacked.
4. Select `wodeappx/integrations/browser-control/extension`.
5. Click the extension icon. The WodeAppX conversation opens in Chrome's side panel.
6. Keep WodeAppX open. The extension connects through the registered native
   host. The bridge URL setting is only for compatibility or development.

If you set `WODEAPPX_BROWSER_TOKEN` for WodeAppX, enter the same token in the side-panel settings.

## Chrome Web Store package

The already-published Chrome Web Store item `mfnpfomihliahiheofiijbmmhfeanhpb` should be updated from this directory. Do not upload `browser-extension/wodeapp-inline-copilot` as a second item.

```bash
pnpm pack:browser-control
```

The package is written to `dist/wodeappx-browser-control-<version>.zip`. Store copy, permission explanations, icons, promo art, and screenshots are documented in `extension/STORE_LISTING.md` and `extension/store-assets/`.

## Built into WodeAppX

Run the normal WodeAppX patch flow:

```bash
cd wodeappx
pnpm openwork:patch
```

The patch script syncs these files into `vendor/openwork/.opencode/`:

- `.opencode/plugins/wodeappx-browser-control.ts`
- `.opencode/plugins/wodeappx-browser-control-runtime.mjs`
- `.opencode/plugins/wodeappx-capabilities-bridge.ts`
- `.opencode/skills/wodeappx-browser-control/SKILL.md`

OpenCode automatically loads local plugin files from `.opencode/plugins/`, so no extra `opencode.json` plugin entry is required.

The capabilities bridge also exposes these high-frequency local tools directly in chat:

- Agent Reach style public internet routes: `agent_reach_status`, `agent_reach_web_search`, `agent_reach_weather`, `agent_reach_web_read`, `agent_reach_rss_read`, `agent_reach_youtube_transcript`, `agent_reach_bilibili_search`, `agent_reach_v2ex`.
- Privacy-safe Chrome overview: `openwork_chrome_tab_summary` returns only window/tab counts and indexes.
- Screen inspection shortcut: `openwork_screen_snapshot`.
- Clipboard shortcuts: `openwork_clipboard_read`, `openwork_clipboard_write`, `openwork_clipboard_paste`.
- Local file search and safe organization: `openwork_file_search`, `openwork_file_plan_batch`, `openwork_file_apply_batch`.

Then reload WodeAppX or run the config reload command. Ask the agent:

```text
检查浏览器控制状态，然后打开 https://example.com 并读取页面内容。
```

The extension long-polls the bridge (`waitMs=20000`) so a queued command is delivered immediately instead of waiting on the 500ms empty poll. `wodeappx_browser_run` executes a known multi-step sequence in Chrome without returning to the model between steps. The tab debugger stays attached for 10 minutes of idle (or until the tab closes) instead of attaching and detaching around every command.

When a browser command runs, the Chrome extension shows a `RUN` badge and attaches through Chrome's debugger API so Chrome can show its native top browser-control/debugging banner. When the target page allows extension script injection, WodeAppX also shows a short notice in the page corner. Completed commands briefly show `OK`; failed commands briefly show `ERR`.

If you update the unpacked extension files, open `chrome://extensions`, enable
Developer mode, and reload `WodeAppX Browser Control` once. Version `1.3.0`
adds structured interactive snapshots, exact `nodeId` targeting, unique-target
enforcement, and persistent Chrome-client selection. Version `1.3.1` adds
explicit extension identity reporting. Version `1.3.2` reports supported
actions and capability-gates raw CDP. Version `1.4.0` prefers the packaged
Chrome Native Messaging host and reports the actual local transport, while
retaining the old loopback HTTP path as a rollout fallback.

## Native host and compatibility bridge

Primary Chrome transport:

- Native host name: `com.wodeappx.browser_control`
- Chrome transport: length-prefixed JSON over stdin/stdout
- Host implementation: `native-host/`
- Desktop registration: `browser-native-host.mjs`

The native host exposes only these fixed bridge operations:

- `GET /health`
- `POST /sidepanel/message`
- `POST /extension/connect`
- `GET /extension/command`
- `POST /extension/result`

When `WODEAPPX_BROWSER_TOKEN` is non-empty, every extension request must include
the token. The native host does not store it and does not accept arbitrary URLs
or act as a general local proxy.

## Notes

- Browser tasks follow an observe → act → verify loop: bind one exact `clientId` and `tabId`, read the current structured snapshot, act on one current `nodeId`, and verify before continuing.
- `wodeappx_browser_read_page` returns bounded `interactiveElements`. Password values are never returned. `wodeappx_browser_click` and `wodeappx_browser_type` fail closed when a selector/text target is missing or ambiguous.
- `wodeappx_browser_cdp` is opt-in full developer access. Call `wodeappx_browser_tabs` first, obtain explicit user approval for the exact site and purpose, then pass `tabId`, `purpose`, and `userConfirmed: true`. Typed helpers remain the default for ordinary browser actions.
- Raw CDP currently returns only the direct `chrome.debugger.sendCommand` response. It does not buffer asynchronous protocol events, so `Log.enable`, `Network.enable`, and similar empty responses are not evidence that console or network data was captured.
- Never use raw CDP to read cookies, credentials, authentication headers, password fields, local/session storage, browser history, or unrelated network bodies.
- `wodeappx_browser_eval` is intentionally powerful. Use it only on trusted pages or local development pages and never to read secrets or browser storage.
- Screenshots are saved by the OpenCode plugin and returned as local file paths.
- This is a local host and bridge, not a cloud browser-control service. Browser
  state stays in the user's Chrome profile unless page text, screenshots, or
  results are returned through an agent conversation.
