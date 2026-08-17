# WodeAppX Capability Matrix

> **Last updated:** 2026-07-21
> **Purpose:** Track WodeAppX desktop capabilities across releases: what comes from OpenWork/OpenCode, what WodeAppX adds, where it is implemented, and how to verify it after changes.

---

## 1. Status Labels

| Label | Meaning |
|-------|---------|
| `OpenCode native` | Provided by OpenCode runtime or built-in OpenCode tools. Preserve it; do not rebuild it in WodeAppX. |
| `OpenWork native` | Provided by the OpenWork desktop/session UI or vendor runtime. Preserve it unless there is a product reason to fork. |
| `OpenWork helper + WodeAppX wrapper` | OpenWork has the lower-level helper, while WodeAppX exposes a faster direct chat tool or safer alias. |
| `WodeAppX patch` | Added by WodeAppX through `integrations/` templates, patch scripts, or WodeAppX-only plugin code. |
| `Bundled plugin` | Third-party or local OpenCode plugin enabled by WodeAppX config. |
| `WodeApp only` | Depends on WodeApp cloud/platform APIs, MCP tools, or WodeApp-specific product pages. |

This table describes the current `vendor/openwork` tree after WodeAppX patches are applied. It is not a live claim about the newest upstream OpenWork release unless explicitly checked against upstream.

### Foundation capability rule

Capability routing is a prompt-size and latency optimization, not a feature switch. The small foundation layer is available in every conversation:

- `wodeappx_list_capabilities` discovers capability families.
- `openwork_ui_list_actions` discovers the current runtime action catalog.
- `openwork_ui_execute_action` invokes only an exact action ID returned by discovery or documented by the active skill.
- `openwork_attachment_context_read` rehydrates only the exact locally cached attachment context named by a `contextRefId` in conversation history.

Heavier Shopify, Computer Use, capture, PDF/Office extract, and browser-automation tools are still focused per turn. Workspace basics (read/bash/grep/edit/task/todo) and lean web search/fetch stay resident on substantive turns (Codex/Cursor parity). Missing a keyword may change which heavy schemas are preloaded, but it must never produce “项目尚未开通” or require the user to enable a built-in capability. Tool availability is not authorization: explicit no-execution requests and confirmation gates still apply.

---

## 2. Capability Matrix

| Area | User-facing ability | Tool / surface | OpenWork status | WodeAppX status | Primary implementation | Minimum test |
|------|---------------------|----------------|-----------------|-----------------|------------------------|--------------|
| Workspace basics | Read/edit/search project files, run shell commands, patch code, LSP, subtask agents | OpenCode built-in tools | `OpenCode native` | Preserved | OpenCode runtime | Ask chat to list a workspace file and run a harmless command. |
| Providers | BYOK text model providers | Settings → 服务与模型（本机 Key 导入）；会话内选模型 | `OpenWork native` | Nav pages「模型服务商 / 模型偏好」已下线；WodeApp 与本机厂商平级 | `vendor/openwork` settings; WodeApp cloud patch | Send a basic chat on selected provider. |
| MCP | Add/list/use MCP servers | Settings -> MCP; OpenCode MCP runtime | `OpenWork native` | Preserved + WodeApp MCP defaults optional | `vendor/openwork`; `integrations/opencode/`; cloud patch | Discover WodeApp MCP tools and run one harmless capability tool. |
| Skills / commands | User skills, commands, plugin configs | OpenWork session/runtime | `OpenWork native` | Preserved + WodeApp skills synced | `.opencode/skills`; `apply-openwork-integration.mjs` | Confirm a synced skill is visible and can be selected. |
| Browser panel | Open an external website inside WodeAppX | `openwork_browser_open_url`, then browser automation tools | `OpenWork native` panel with WodeAppX bridge | Built in | `integrations/browser-control/`; desktop browser bridge | Open `https://example.com`, read page text. |
| App UI control | Inspect or operate WodeAppX UI | `openwork_ui_snapshot`, `openwork_ui_list_actions`, `openwork_ui_execute_action` | WodeAppX-specific bridge over OpenWork UI | Built in | Electron UI control server + `openwork-extensions-preview.ts` | Snapshot current app; open settings through UI action. |
| Capture | Capture system/browser media/network artifacts | `openwork_capture_start/status/list/clear/stop/authorize_https` | WodeAppX patch | Built in | Desktop capture bridge + `openwork-extensions-preview.ts` | Start capture, check status, stop capture. |
| Local document read | Extract bounded, resumable text from Office and plain-text files | `openwork_file_extract_text` | WodeAppX patch | Built in | `integrations/openwork/opencode-plugins/local-file-*`; `openwork-extensions-preview.ts` | Extract `wodeappx/docs/DESKTOP.md`, then continue with `nextOffset` when present. |
| Local PDF read | Inspect and extract page-aware PDF windows; render only the pages that need visual review | `openwork_pdf_info`, `openwork_pdf_extract_text`, `openwork_pdf_render_pages` | WodeAppX patch | Built in | `openwork-extensions-preview.ts` | Inspect a multi-page PDF, continue with `nextStartPage` / `nextStartChar`, and render selected pages. |
| Attachment context re-read | Rehydrate a cached attachment parse or original local media path without retaining the full first-turn payload in every later prompt | `openwork_attachment_context_read` | WodeAppX patch | Built in | `wodeapp-context-packs.mjs`; `wodeapp-attachment-context-store.ts`; `wodeapp-vision-history-compact.ts` | Send a long document/image attachment, wait for idle compaction, then re-read by the exact `contextRefId`. |
| Model media input | Decide per model whether image/video/PDF/Office go native to the LLM or need local/remote parse tools | catalog `mediaInput` + `resolveModelMediaInputCapabilities` | WodeAppX patch | Built in | `wode-branded-catalog.json`; `docs/MODEL_MEDIA_INPUT.md` | Switch model to MiniMax M3 / Kimi K3 / DeepSeek and confirm video/PDF routing follows catalog. |
| Local file preview | Quick Look preview for local files | `openwork_file_preview` | WodeAppX patch | Built in | Same as above; macOS `qlmanage` | Generate preview for a local image/PDF. |
| Local media probe | Read image/audio/video/PDF metadata | `openwork_file_media_probe` | WodeAppX patch | Built in | Same as above; `file`, `mdls`, `sips` | Probe `wodeappx/branding/wodeapp-icon-source.png`. |
| Local file search | Search user/workspace files without reading contents | `openwork_file_search` | WodeAppX patch | Built in | `local-file-schemas.ts`, `local-file-helpers.ts`, `local-file-tools.ts` | Search `DESKTOP.md` under `wodeappx/docs`. |
| Safe file batch | Preview then apply copy/move/rename/mkdir | `openwork_file_plan_batch`, `openwork_file_apply_batch` | WodeAppX patch | Built in | Same as above; dry-run plan files under temp dir | Rename a temp file only after `confirmed:true`. |
| Computer Use | Native desktop snapshot/click/type/key/scroll/value/action/app control | `openwork_computer_*` | OpenWork helper exists; direct chat wrapper is WodeAppX | Built in | macOS: HandsFree direct; Win/Linux: open-computer-use MCP via `computer-use-backend.ts` | Check permissions; snapshot a named app. |
| Screen inspect | Short "look at my screen" entry point | `openwork_screen_snapshot` | OpenWork helper + WodeAppX alias | Built in | `openwork-extensions-preview.ts`; bridge allowlist | Snapshot frontmost app and confirm `snapshotId`. |
| Clipboard | Read/write/paste clipboard | `openwork_clipboard_read/write/paste` | OpenWork helper + WodeAppX aliases | Built in | Computer Use clipboard helper + aliases | Save old clipboard, write test text, read, restore. |
| Real Chrome session | Use user's signed-in Chrome profile | `openwork_chrome_*` | WodeAppX patch | Built in | macOS Apple Events/JXA in `openwork-extensions-preview.ts` | Open/activate/snapshot a Chrome tab when permitted. |
| Privacy Chrome overview | Count Chrome windows/tabs without titles/URLs | `openwork_chrome_tab_summary` | WodeAppX patch | Built in | JXA summary tool + bridge allowlist | Real chat must call `tab_summary` only; output has no `title`/`url` fields. |
| Public internet routes | Read web pages, feeds, YouTube subtitles, Bilibili search, and V2EX | `agent_reach_*` | WodeAppX patch inspired by Agent Reach | Built in | `integrations/agent-reach/`; `openwork-extensions-preview.ts`; bridge allowlist | `agent_reach_status`, then read one public URL or V2EX hot topics. |
| Scheduler | Recurring jobs/reminders/long tasks | `schedule_job`, `list_jobs`, etc. | External OpenCode plugin | Bundled plugin | `.opencode/package.json`; `.opencode/opencode.json` | `get_version`, then `list_jobs`. |
| WodeApp cloud AI | WodeApp text model routing and credits | `wodeapp` provider | WodeApp only | Optional product/cloud build | `integrations/wodeapp-cloud/`; runtime config | Send chat through default `wodeapp` provider. |
| WodeApp MCP | Build/publish/runtime/project tools | WodeApp Platform / Project MCP | WodeApp only | Optional/product build | `integrations/opencode/`; cloud patch | Discover tools; run harmless capability query. |
| WodeApp workbench pages | Batch image (headless API), AI video, video storyboard (inject + manual), short-drama | `openwork_ui_execute_action`, `wodeapp_video_template_render` | WodeApp only + HyperFrames local renderer | Built into product build | `domains/wodeapp/` templates + built-in HyperFrames bridge + patch script | AI video: `wodeapp.video.generate`; data-driven product video: product assets → HyperFrames HTML → Chrome + FFmpeg; storyboard: sync + open studio, user clicks generate. |

---

## 3. OpenWork Upstream Policy

Use OpenWork native features first. WodeAppX should add only the missing product layer, safer defaults, or WodeApp-specific workflows.

| Capability type | Upstream candidate? | Rule |
|-----------------|--------------------|------|
| General desktop assistant feature, not WodeApp-specific | Usually yes | Keep implementation separated and document platform limits. Examples: clipboard aliases, privacy Chrome summary, safe file batch. |
| Thin alias over an OpenWork helper | Usually yes | Prefer upstreaming if it improves common UX without WodeApp dependencies. |
| WodeApp cloud/MCP/product workflow | No | Keep in WodeAppX. Do not push WodeApp credentials, billing, or product defaults upstream. |
| macOS-only automation | Maybe | Guard by platform and provide clear failure messages. |
| Privacy/safety wrapper | Usually yes | Design so raw/private tools are not needed for common requests. |

Before claiming "OpenWork upstream has this", verify against the upstream OpenWork repo or release being merged. This document only records the WodeAppX-patched local tree.

---

## 4. Adding A New Built-In Capability

1. Decide the layer:
   - Use `OpenCode native` or `OpenWork native` if it already exists.
   - Add a WodeAppX local tool only when it removes MCP startup cost, avoids a fragile manual flow, or adds privacy/safety.
   - Keep WodeApp product workflows in WodeApp actions/MCP/provider/skills.

2. Add schemas and helpers:
   - Reusable local file/tool snippets live in `wodeappx/integrations/openwork/opencode-plugins/`.
   - Runtime source lives in `wodeappx/vendor/openwork/apps/server/src/opencode-plugins/openwork-extensions-preview.ts`.
   - Patch/sync logic lives in `wodeappx/scripts/apply-openwork-integration.mjs`.

3. Expose to live chat:
   - Add the tool id to `wodeappx/integrations/browser-control/opencode-plugin/wodeappx-capabilities-bridge.ts`.
   - Run `node wodeappx/scripts/apply-openwork-integration.mjs` so `vendor/openwork/.opencode/plugins/` receives the bridge.

4. Build:
   - From `wodeappx/vendor/openwork`, run:

   ```bash
   pnpm --filter openwork-server typecheck
   pnpm --filter openwork-server build
   ```

5. Reload sidecar:
   - Restart the OpenCode sidecar. `/instance/dispose` is not always enough for plugin module cache changes.
   - Ensure `WODEAPPX_OPENWORK_EXTENSIONS_PLUGIN` points to `vendor/openwork/apps/server/dist/opencode-plugins/openwork-extensions-preview.js`.
   - Ensure `OPENWORK_UI_CONTROL_DISCOVERY` points to WodeAppX UI bridge discovery JSON when UI/capture tools are needed.

6. Test:
   - Direct plugin load: import `wodeappx-capabilities-bridge.ts`, check the tool id is present.
   - Direct tool call: execute one safe scenario with deterministic inputs.
   - Real chat: create a fresh session, send a natural prompt, and confirm tool parts show the expected tool id.
   - For privacy tools, inspect tool output, not just the final model answer.

7. Update docs:
   - Add/modify the row in this matrix.
   - Update `docs/DESKTOP.md` only if the public overview changes.
   - Add release notes in `docs/RELEASE.md` when a packaged release needs migration notes.

---

## 5. Capability Test Scenarios

Use these smoke prompts after each capability change.

| Capability | Real chat scenario | Pass condition |
|------------|-------------------|----------------|
| General progressive discovery | "把这件从未预设过的事情处理好，先判断需要哪些能力再完成。" | Unclassified substantive requests keep foundation + `wodeappx_list_capabilities` only; heavy packs stay off until the user restates with a matched intent or an explicit discovery follow-up. |
| Always-on foundation | "你好" followed by “打开内置分镜工作台” | Capability discovery and runtime action discovery/execution remain available; the assistant never asks the user to enable a built-in feature. Heavy unrelated tools remain off until the task selects them. |
| Privacy Chrome overview | "Tell me how many Chrome tabs are open. Do not reveal titles or URLs." | Tool part uses `openwork_chrome_tab_summary`; no `title` or `url` keys in tool output. |
| Screen inspect | "Look at my current screen and tell me whether the app is visible." | Tool part uses `openwork_screen_snapshot`; result contains a snapshot id or elements. |
| Clipboard | "Write this temporary string to clipboard, read it back, then restore the old clipboard." | `openwork_clipboard_write/read` succeed; old text is not printed. |
| File search | "Find DESKTOP.md under the WodeAppX docs folder; only report filename and path." | `openwork_file_search` returns the expected file; no content is read. |
| Safe batch files | "Preview renaming this temp file, then apply after confirmation." | `plan_batch` returns `blockedCount:0`; `apply_batch` returns `appliedCount`. |
| Local document extract | "Read the first part of this local markdown." | `openwork_file_extract_text` returns bounded text and continuation metadata. |
| Local PDF extract | "Read the first five pages of this local PDF and continue if needed." | `openwork_pdf_info` runs first; extraction returns page-aware continuation metadata without skipping a truncated page. |
| Attachment context re-read | Attach a long document/image, finish the first turn, then ask for a detail only present in the attachment. | History keeps a short `contextRefId` stub; the agent calls `openwork_attachment_context_read` and does not request a duplicate upload. |
| Media probe | "Inspect this image/video metadata." | `openwork_file_media_probe` returns mime/dimensions/duration when available. |
| UI control | "Open settings in WodeAppX." | `openwork_ui_execute_action` runs the settings action. |
| Capture | "Start capture, check status, then stop." | Capture tools return `ok:true` or a clear permission error. |
| Scheduler 黑盒创建 | 在「自动任务」输入：`每天晚上 11 点，总结今天修改的代码，提交推送，更新文档，删除过时文档等`。不要补充工具名、cron 或参数。 | 能识别每天 23:00；对“过时文档”判定等真实歧义只追问必要问题；确认后创建任务并显示正确工作区、时区和下次运行。不要立即执行该高风险任务，核对后删除。 |
| Scheduler 安全生命周期 | 黑盒创建通过后，另建一个自然表达、无副作用的每日总结任务，再依次暂停、恢复、立即运行、查看结果并删除。固定输出或指定工具名只允许用于失败诊断。 | 暂停/恢复状态正确；安全任务运行成功并显示结果摘要；删除后任务、日志和系统调度单元均清理。 |
| Live weather | "杭州的天气" | Intent route mounts `agent_reach_weather`; response contains resolved location, observation time, current conditions, hourly/daily forecast, and Open-Meteo source URLs. |
| Public web search | "今天有什么重要新闻？" | Intent route mounts `agent_reach_web_search`; response contains timestamped results and source URLs without MCP or a browser extension. |
| Public page reading | "Read https://example.com." | Uses `agent_reach_web_read`; no MCP or browser extension required. Login-wall / paywall / cookie-session intents automatically escalate to the Chrome extension typed tools (`wodeappx_browser_*`) instead of retrying HTTP readers; raw CDP stays explicit-approval only. |

---

## 6. Planned Capabilities

### Tencent official Weixin channel

| Item | Plan |
|------|------|
| Status | Backlog; schedule after the current P0 desktop capability work. |
| Product goal | Let users connect Weixin by QR code and send instructions to a WodeAppX Agent from a dedicated Weixin bot conversation, with replies delivered back to Weixin. |
| Official dependency | Adapt Tencent's MIT-licensed `openclaw-weixin` channel transport and its documented HTTP JSON protocol. Do not install the OpenClaw-bound package directly into WodeAppX. |
| Runtime path | `Weixin getUpdates -> sender/account session mapping -> existing OpenCode session.promptAsync -> completed assistant response -> Weixin sendMessage`. Keep the existing OpenWork/OpenCode session and permission model; do not add a second Agent runtime. |
| Initial scope | QR-code authorization, connection/reconnection status, one or more accounts, per-account/channel/sender session isolation, text messages, basic image/file ingress and egress, duplicate-event protection, and a settings entry for connect/disconnect. |
| Safety | Store credentials encrypted locally; require an allowlist or explicit pairing; keep shell, file mutation, outbound messaging, and other high-risk tools behind WodeAppX permission approval; never auto-approve requests from Weixin. |
| Explicit non-goals | No community Accessibility-based personal-WeChat automation, no reading arbitrary personal chat history, and no dependency on an unofficial desktop protocol. |
| Availability | The channel is online while the WodeAppX Agent runtime is running. Persistent tray/background or cloud execution requires a separate lifecycle design. |
| Minimum acceptance test | Scan and connect; send a text instruction in Weixin; verify it reaches the mapped OpenCode session exactly once; verify the final response returns to the same sender; verify a high-risk tool pauses for WodeAppX approval. |

Implementation must preserve the architecture rules in `docs/ARCHITECTURE.md`. Before development, re-check the current Tencent package compatibility, protocol, license, and Weixin product terms rather than relying on the versions recorded during planning.

---

## 7. Current P0 Capability Change Log

| Date | Change | Verification |
|------|--------|--------------|
| 2026-08-08 | `openwork_media_view` now accepts `https://` URLs and `/runtime-server/api/image-proxy/<id>` paths in addition to local raster paths, so the model can visually QA generated image-proxy links without claiming it cannot see them. Remote fetch is gated: HTTPS-only by default, blocks loopback/private-IP/link-local/credentials, ≤16 MB, ≤5 redirects with per-hop host revalidation, 20 s timeout. Remote previews are ephemeral (staged to tmp then removed); `image_crop`/`image_resize` still require a local path. | bounded-image-preview unit tests (source detection, URL normalization, private-host block, redirect following, local+remote preview) pass; openwork:patch idempotent. |
| 2026-08-08 | Login-wall / paywall / cookie-session intents auto-route to the WodeAppX Chrome extension typed tools (`wodeappx_browser_*`) instead of retrying `agent_reach_web_read` / `web_fetch` / `curl`. Detects both Chinese (需要登录才能看 / 登录态 / 付费墙) and English (login wall / paywall / signed-in session / requires login) signals, and explicitly excludes WodeApp account login wording (登录小灵通账户 etc.) so it does not mount browser tools against the app itself. Raw `wodeappx_browser_cdp` still requires explicit per-site approval. | 4 new routing tests (login-wall crawl, login-session wording, WodeApp-account non-route, internet-pack fallback hint); browser-control SKILL and agent-reach README/schemas updated. |
| 2026-07-21 | Product library: card/modal「生成图片/生成视频」opens a new chat draft with @商品 prefill (`autoSend:false`). Successful `product_save` returns `followUpChoicesMarkdown` so the assistant can offer 生图/视频/先不用 without auto-running generation. | product-generation-handoff + capability routing tests. |
| 2026-08-07 | Removed `image_inspect` (not in Cursor/Codex). Screenshots/PDF render attach bounded previews on the producing tool; chat images stay on attachments / selectedImageIds. | creative-core + routing updated. |
| 2026-07-21 | Made `wodeapp_video_storyboard_open` a typed direct resident tool (wraps `wodeapp.video_storyboard.open`); video pack + orchestration + foundation resident tip name it for N-clip / multi-scene routing so models do not fall back to bash/curl `/video/tasks`. | creative-core + capability routing + description-slim tests. |
| 2026-07-21 | Second knife: trimmed AUTO_ORCHESTRATION to ~580 chars (decision routing only); added trigger phrases to `assets_list` / `product_save` / `image_asset_save` / `generation_history_save` (auto-save vs manual); delete/dedupe intent mounts assets pack; product↔image_asset boundary clarified. | description-slim tests. |
| 2026-07-21 | First-knife description slim: `wodeapp.video_storyboard.open` / `video.generate` / `image_asset_save` cut to decision labels; hard-rule essays removed from auto-orchestration + video samplePrompt; storyboard executor returns `correctiveAction` for local refs; docs expanded for storyboard. | description-slim + visual-task-handoff + creative-core tests. |
| 2026-07-21 | Resident creative core trimmed to ~22 tools; heavy packs stay lazy. Added `wodeapp_get_tool_docs`; shortened tool descriptions and capability system packs; domain details moved out of always-on prompts. | creative-core + capability routing tests passing. |
| 2026-07-21 | Switched substantive turns to Flat Visibility + Gated Execution: creative-core tools (assets, image, video/storyboard UI, page CRUD, discovery) always visible; routing only distinguishes small-talk vs task; removed focused storyboard/asset hard-hiding. Heavy packs (Shopify, Computer Use, capture, packaging, shell) stay intent-mounted or discoverable. | Capability routing tests updated and passing. |
| 2026-07-21 | Replaced general complete-tool fail-open with progressive disclosure: unclassified turns expose foundation + `wodeappx_list_capabilities` only. Short follow-ups retain the recent task pack; attached-image understanding mounts the image pack. | Capability routing tests updated and passing. |
| 2026-07-20 | Bundled open-computer-use helpers for Windows/Linux installers via `prepare-open-computer-use-helper.mjs` + electron-builder `resources/helpers`. Sidecar inherits `WODEAPPX_OPEN_COMPUTER_USE_BINARY`. | Helper path unit tests; dry-run prepare for win32/linux binaries. |
| 2026-07-20 | Computer Use backend adapter: macOS keeps HandsFree direct; Windows/Linux route the same `openwork_computer_*` tools through open-computer-use MCP. | `computer-use-backend` unit tests; platform permission/MCP command resolution in desktop `computer-use.mjs`. |
| 2026-07-15 | Made capability discovery plus runtime action discovery/execution an always-available foundation layer. Per-turn routing now focuses heavy tools only and no longer acts as a built-in feature enablement boundary. | 29 routing tests passed; greetings retain only the three foundation tools, uploaded-video analysis keeps generation tools off, and storyboard actions remain callable without an enable-project step. |
| 2026-07-14 | Replaced fail-closed regex gating with layered routing: always-on read-only core, focused packs for known intents, and complete-tool fail-open fallback for unknown substantive tasks. | 11 routing tests passed; arbitrary new task classes expose internet, files, desktop, generation, site, automation, Shopify, and workspace tools while greetings keep heavy tools off. |
| 2026-07-14 | Added API-key-free current web search and weather tools: `agent_reach_web_search` and `agent_reach_weather`; expanded per-turn routing to recognize natural weather and time-sensitive questions. | Routing tests passed; direct plugin calls returned Hangzhou live weather and public search results; running Agent engine reported both tool IDs after restart. |
| 2026-07-08 | Added live sidecar bridge for built-in local capabilities. | Tool table exposed UI, browser, capture, file, Computer Use, Chrome, scheduler-adjacent tools. |
| 2026-07-08 | Added privacy Chrome summary: `openwork_chrome_tab_summary`. | Real chat used only `tab_summary`; tool output had no `title`/`url` fields. |
| 2026-07-08 | Added screen shortcut: `openwork_screen_snapshot`. | Direct tool call returned `ok:true` with `snapshotId`. |
| 2026-07-08 | Added clipboard aliases: `openwork_clipboard_read/write/paste`. | Direct tool call wrote, read back, and restored clipboard. |
| 2026-07-08 | Added local file search: `openwork_file_search`. | Search under `wodeappx/docs` returned `DESKTOP.md`. |
| 2026-07-08 | Added safe batch file plan/apply tools. | Direct and real-chat runs previewed and applied a temp-file rename. |
| 2026-07-08 | Added Agent Reach style read-only internet routes: `agent_reach_status`, `agent_reach_web_read`, `agent_reach_rss_read`, `agent_reach_youtube_transcript`, `agent_reach_bilibili_search`, `agent_reach_v2ex`. | Typecheck plus direct plugin smoke expected before release; login-required social platforms remain opt-in. |

---

## 8. Guardrails

- Do not expose raw private data when a summary tool is enough.
- Do not add delete support to batch file tools without a separate design review.
- Do not read file contents during file search; search returns metadata only.
- Do not require MCP for high-frequency desktop basics when a safe built-in tool can do it faster.
- Do not replace OpenWork native providers, MCP, skills, commands, browser automation, Computer Use, artifacts, permissions, or session controls.
- Keep WodeApp-specific business flows out of generic OpenWork capability names.
