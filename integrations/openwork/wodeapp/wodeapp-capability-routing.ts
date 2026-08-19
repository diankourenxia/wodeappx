import { SUBSTANTIVE_RESIDENT_TOOL_IDS } from "./wodeapp-creative-core";
import {
  WODEAPP_AGENT_DIRECT_TOOL_NAMES,
  WODEAPP_ASSET_DIRECT_TOOL_NAMES,
  WODEAPP_DIRECT_TOOL_NAMES,
  WODEAPP_FOUNDATION_DIRECT_TOOL_NAMES,
  WODEAPP_IMAGE_DIRECT_TOOL_NAMES,
} from "./wodeapp-direct-action-contracts";
import { asksAboutSelfEvolve, resolveSelfEvolveAwarenessPack } from "./wodeapp-self-evolve-awareness";
import {
  buildAgentProviderCapabilityPack,
  generationToolsHiddenBySnapshot,
  type ProviderCapabilitySnapshot,
} from "./wodeapp-provider-capability";

type DraftPartLike = {
  type?: string;
  name?: string;
  path?: string;
};

export type AttachmentRequirementDocument = {
  filename: string;
  mimeType?: string;
  extension?: string;
  readStatus: "unread" | "parsed" | "remote";
};

export type AttachmentRequirements = {
  localRead?: boolean;
  requiredCapabilities?: WodeAppCapabilityId[];
  requiredTools?: string[];
  localDocuments?: AttachmentRequirementDocument[];
};

export type CapabilityRoutingDraft = {
  text?: string;
  resolvedText?: string;
  /** Recent user-authored prompts, newest last. Used only to retain the active capability on a follow-up turn. */
  recentUserTexts?: string[];
  attachments?: Array<{ name?: string; mimeType?: string; kind?: string }>;
  assetMentions?: Array<{ kind?: string; name?: string }>;
  parts?: DraftPartLike[];
  attachmentRequirements?: AttachmentRequirements;
  /** Active workbench workspace display name (e.g. `wodeapp（自进化）`). */
  workspaceName?: string | null;
  /** Active OpenCode session / workspace root directory. */
  workspaceDirectory?: string | null;
  /** Live BYOK/cloud key probe: which generation modalities this machine can call. */
  providerCapability?: ProviderCapabilitySnapshot | null;
  /** Web chat vs desktop. Defaults to desktop unless the web build env is set. */
  runtime?: "web" | "desktop";
};

export type WodeAppCapabilityId =
  | "general"
  | "agent-app"
  | "app-ui"
  | "assets"
  | "automation"
  | "browser"
  | "browser-devtools"
  | "capture"
  | "desktop"
  | "discovery"
  | "docs"
  | "files"
  | "image"
  | "internet"
  | "shopify"
  | "site"
  | "video"
  | "video-url"
  | "workspace";

export type WodeAppCapabilityRoute = {
  capabilities: WodeAppCapabilityId[];
  system: string;
  tools: Record<string, boolean>;
  enabledTools: string[];
  disabledTools: string[];
};

export const WODEAPP_PLATFORM_MCP_TOOL_IDS = [
  "list_projects",
  "get_project",
  "create_project",
  "get_page",
  "list_pages",
  "list_actions",
  "execute_action",
  "ai_generate_text",
  "ai_generate_image",
  "list_image_models",
  "video_parse_link",
  "product_visual_batch_image_capability",
  "product_visual_batch_image_run",
  "publish_project",
  "create_page",
  "update_page",
  "delete_page",
  "list_versions",
  "rollback_version",
  "ai_generate_page",
  "ai_modify_section",
  "list_templates",
  "list_skill_manifests",
  "materialize_skill_app",
  "build_app",
] as const;

export const WODEAPP_SHOPIFY_ADMIN_MCP_TOOL_IDS = [
  "shopify_connections_list",
  "shopify_shop_info",
  "shopify_products_list",
  "shopify_orders_list",
  "shopify_graphql",
] as const;

const WODEAPP_PLATFORM_MCP_TOOL_ID_SET = new Set<string>(WODEAPP_PLATFORM_MCP_TOOL_IDS);
const WODEAPP_PLATFORM_MCP_PREFIX = "wodeapp-platform";
const WODEAPP_SHOPIFY_ADMIN_MCP_TOOL_ID_SET = new Set<string>(WODEAPP_SHOPIFY_ADMIN_MCP_TOOL_IDS);
const WODEAPP_SHOPIFY_ADMIN_MCP_PREFIX = "wodeapp-shopify-admin";

// Lightweight knowledge graph: capability nodes describe additive tool groups.
// Detection unions every relevant node for a mixed request. Routing is NOT the
// safety boundary. The patched OpenCode loop exposes a small direct set and
// defers the rest until tool_search loads matching live definitions.
// Effect/approval gates still control execution. Installed plugin and connected
// MCP tools remain owned by OpenCode's live registry; do not duplicate schemas.
const CAPABILITY_TOOL_GRAPH = {
  general: [],
  discovery: [
    "wodeappx_list_capabilities",
    "wodeapp_get_tool_docs",
  ],
  "agent-app": [
    "list_skill_manifests",
    "materialize_skill_app",
    "list_templates",
    "create_project",
    "get_project",
    "get_page",
    "list_pages",
    "create_page",
    "update_page",
    "wodeapp_page_import_from_file",
    "ai_generate_page",
    "ai_modify_section",
    "publish_project",
    ...WODEAPP_AGENT_DIRECT_TOOL_NAMES,
    "openwork_browser_open_url",
    "browser_snapshot",
    "browser_fill",
    "browser_click",
    "browser_eval",
  ],
  "app-ui": [
    "openwork_ui_snapshot",
    "openwork_ui_list_actions",
    "openwork_ui_execute_action",
  ],
  assets: WODEAPP_ASSET_DIRECT_TOOL_NAMES,
  image: [
    ...WODEAPP_IMAGE_DIRECT_TOOL_NAMES,
    "image_inspect",
    "openwork_media_view",
    "image_crop",
    "image_resize",
    "image_rotate_flip",
    "image_collage",
    "image_composite",
    "ai_generate_image",
    "list_image_models",
    "product_visual_batch_image_run",
    "render_design",
  ],
  video: [
    "video_generate",
    "video_task_status",
    "video_providers",
    "video_extract_frames",
    "product_video_storyboard_capability",
    "wodeapp_video_storyboard_open",
    "wodeapp_video_storyboard_update",
    "wodeapp_video_template_render",
    "wodeapp_image_asset_save",
    "openwork_ui_execute_action",
  ],
  "video-url": [
    "video_resolve_link",
    "video_extract_metadata",
    "video_parse_link",
    "media_analyze",
    "video_extract_frames",
  ],
  browser: [
    "wodeappx_browser_status",
    "wodeappx_browser_tabs",
    "wodeappx_browser_open_url",
    "wodeappx_browser_read_page",
    "wodeappx_browser_click",
    "wodeappx_browser_type",
    "wodeappx_browser_key",
    "wodeappx_browser_eval",
    "wodeappx_browser_screenshot",
    "openwork_media_view",
    "image_inspect",
  ],
  "browser-devtools": [
    "wodeappx_browser_cdp",
  ],
  internet: [
    "agent_reach_status",
    "agent_reach_web_search",
    "agent_reach_weather",
    "agent_reach_web_read",
    "agent_reach_rss_read",
    "agent_reach_youtube_transcript",
    "agent_reach_bilibili_search",
    "agent_reach_v2ex",
    "web_fetch",
    "web_search",
    "webfetch",
    "websearch",
  ],
  capture: [
    "openwork_capture_start",
    "openwork_capture_authorize_https",
    "openwork_capture_stop",
    "openwork_capture_list",
    "openwork_capture_clear",
    "openwork_capture_status",
  ],
  files: [
    "openwork_pdf_info",
    "openwork_pdf_extract_text",
    "openwork_pdf_render_pages",

    "image_inspect",
    "openwork_file_extract_text",
    "openwork_file_preview",
    "openwork_file_media_probe",
    "openwork_file_search",
    "openwork_file_plan_batch",
    "openwork_file_apply_batch",
    "openwork_file_open_directory",
  ],
  desktop: [
    "openwork_computer_call_tool",
    "openwork_computer_check_permissions",
    "openwork_computer_list_apps",
    "openwork_computer_snapshot",
    "openwork_screen_snapshot",
    "openwork_computer_click",
    "openwork_computer_type_text",
    "openwork_computer_press_key",
    "openwork_computer_scroll",
    "openwork_computer_set_value",
    "openwork_computer_perform_action",
    "openwork_computer_launch_app",
    "openwork_computer_activate_app",
    "openwork_computer_open_url",
    "openwork_computer_clipboard_read",
    "openwork_computer_clipboard_write",
    "openwork_clipboard_read",
    "openwork_clipboard_write",
    "openwork_clipboard_paste",
  ],
  shopify: [
    ...WODEAPP_SHOPIFY_ADMIN_MCP_TOOL_IDS,
    "wodeappx_shopify_connect_store",
    "wodeappx_shopify_auth_hint",
    "wodeappx_shopify_status",
    "wodeappx_shopify_dashboard",
    "wodeappx_shopify_products",
    "wodeappx_shopify_orders",
    "wodeappx_shopify_product_create_preview",
    "wodeappx_shopify_product_create_apply",
    "wodeappx_shopify_product_update_preview",
    "wodeappx_shopify_product_update_apply",
    "wodeappx_shopify_feishu_link_status",
    "wodeappx_shopify_feishu_sync_preview",
    "wodeappx_shopify_feishu_sync_apply",
    "fetch_full_docs",
    "introspect_graphql_schema",
    "learn_shopify_api",
    "search_docs_chunks",
    "validate_component_codeblocks",
    "validate_graphql_codeblocks",
    "validate_theme",
    "validate_theme_codeblocks",
  ],
  automation: [
    "schedule_job",
    "list_jobs",
    "get_version",
    "get_skill",
    "install_skill",
    "get_job",
    "update_job",
    "delete_job",
    "cleanup_global",
    "run_job",
    "job_logs",
  ],
  docs: [
    "openwork_docs_search",
    "openwork_docs_read",
  ],
  site: [
    "openwork_extension_list_actions",
    "openwork_extension_call",
    "openwork_ui_execute_action",
    "create_project",
    "list_projects",
    "get_project",
    "list_pages",
    "get_page",
    "list_actions",
    "execute_action",
    "publish_project",
    "list_versions",
    "rollback_version",
    "create_page",
    "update_page",
    "wodeapp_page_import_from_file",
    "delete_page",
    "ai_generate_page",
    "ai_modify_section",
    "ai_generate_text",
    "ai_generate_json",
    ...WODEAPP_AGENT_DIRECT_TOOL_NAMES,
  ],
  workspace: [
    "bash",
    "read",
    "write",
    "edit",
    "patch",
    "apply_patch",
    "glob",
    "grep",
    "list",
    "ls",
    "task",
    "question",
    "skill",
    "todowrite",
    "todoread",
  ],
} as const satisfies Record<WodeAppCapabilityId, readonly string[]>;

// The local graph is the foundation layer. Discovery/action-catalog tools are
// mounted only by their capability node instead of being offered every turn.
const ALWAYS_AVAILABLE_FOUNDATION_TOOL_IDS = [
  ...WODEAPP_FOUNDATION_DIRECT_TOOL_NAMES,
  "openwork_attachment_context_read",
  "openwork_runtime_status",
] as const;

const NON_PRIMARY_BROWSER_TOOL_IDS = [
  "browser_version",
  "browser_list",
  "browser_navigate",
  "browser_snapshot",
  "browser_screenshot",
  "browser_click",
  "browser_fill",
  "browser_eval",
  "openwork_browser_open_url",
  "openwork_browser_set_proxy",
  "openwork_browser_clear_proxy",
  "openwork_chrome_tab_summary",
  "openwork_chrome_list_tabs",
  "openwork_chrome_active_tab",
  "openwork_chrome_open_url",
  "openwork_chrome_activate_tab",
  "openwork_chrome_close_tab",
  "openwork_chrome_execute_javascript",
  "openwork_chrome_snapshot",
  "wodeappx_browser_execute",
] as const;

// Generic executors are not useful to a model unless their read-only catalog
// is visible in the same turn. Keep this relationship at the tool layer so a
// capability pack cannot accidentally expose an action tunnel without the
// registry metadata needed to use it safely.
const TOOL_DEPENDENCY_GRAPH: Readonly<Record<string, readonly string[]>> = {
  openwork_ui_execute_action: ["openwork_ui_list_actions"],
};

const FOCUSED_WEATHER_TOOL_IDS = [
  "agent_reach_web_search",
  "agent_reach_weather",
  "agent_reach_web_read",
] as const;

export {
  CREATIVE_CORE_RESIDENT_TOOL_IDS,
  CREATIVE_CORE_TOOL_IDS,
  INTERNET_RESIDENT_TOOL_IDS,
  PROJECT_READ_RESIDENT_TOOL_IDS,
  SUBSTANTIVE_RESIDENT_TOOL_IDS,
  WORKSPACE_RESIDENT_TOOL_IDS,
} from "./wodeapp-creative-core";

const CAPABILITY_PACKS: Partial<Record<WodeAppCapabilityId, string>> = {
  general: "General task: use the small direct coding/web surface when sufficient. Call tool_search when the needed operation is deferred, including WodeApp business actions, installed plugins, and connected MCP tools. Search by capability or integration instead of guessing an exact tool name. If tool_search returns no matches: broaden the query once, then use web_search/webfetch for public docs, or ask the user to connect the missing MCP/extension — do not invent tools or glob the workspace for a fake implementation.",
  "agent-app": "Agent App / create application: prefer Skill materialization for tool-like agents. First list_skill_manifests (optional query) → if a skillId matches (poster/landing/copywriting/etc.), call materialize_skill_app(skillId) — mounts SkillWorkbenchSection with a real skill contract and usually publishes; verify the returned url. Second: list_templates + create_project(templateId) only for known workbenches (storyboard-video-generator, ecommerce-video, infinite-canvas, image-creation-studio, parallel-styles-visual-kit, etc.). Third (no skill/template): create_project with name only (no templateId) → ai_generate_page with a full natural-language prompt (designBrief then skeleton/content, same as generate-stream) → verify publish. ai_generate_page writes one complete compiled app section using saveData/loadData; never assemble Hero/SmartForm/SmartTable stacks via update_page. Multi-page: create_page + ai_generate_page. Hand-authored HTML: write locally → wodeapp_page_import_from_file({projectId,pageId,sourcePath}) → publish_project (never paste mega template-configs into update_page.config). After publish_project, call wodeapp_sidebar_agent_save with the 智能体 name plus projectId and launchUrl so the site is written onto that agent record. The sidebar updates immediately; do not ask the user to refresh or restart. Skill.md is not the 智能体. Never invent a chat-only shell, fake upstream toast, or hand-write empty Hero stacks when a skill/template/generation path applies. Never use build_app unless the user asks for APK, PWA, Tauri, or extension packaging. Opening a URL is not verification: snapshot the published page and confirm real UI before reporting success. Return projectId and the verified projectUrl.",
  "app-ui": "App UI task: use the runtime UI action catalog and its constrained executor; browser tools must not control the WodeAppX app itself.",
  video: "Video: single ≤15s clip → video_generate / wodeapp.video.generate. N clips / multi-scene / storyboard / >15s → wodeapp_video_storyboard_open (do not loop video_generate or curl /video/tasks). Large follow-up batches / edit one scene → wodeapp_video_storyboard_update with the same shareDocId and ONLY delta scenes (≤25/call); never resend the full board. When board JSON is large, prefer openwork_file_extract_text(offset,maxChars) or grep by groupId/E0N to sample the episodes you will change (small files may use read). Multi-episode in one project: same shareDocId + groups[] + scene.groupId (one episode = one group tab); never one shareDoc per episode and never create_page/update_page as fake grouping. Do not pass model (ignored; platform default Seedance 2.0 Mini ≤15s — split longer clips). MiniMax tier: when the user asks MiniMax/H3/海螺官方 pass provider:'minimax' (default MiniMax-H3, 4–15s, omni/ref video) and omit model. Engine availability source of truth: GET /runtime-server/api/video/tasks/providers. Upload local refs via wodeapp_image_asset_save once. Character refs: ai_generate_image with seedream-5.0. Script visuals on the board: scriptFrameUrl (单帧) / nineGridUrl (九宫格) / videoRefs (视频), switch with previewMode; subjects may carry assetId for Visual Bible. Short-drama script editing: wodeapp.short_drama.open + series_preflight; production still uses video_storyboard. Product short-video: never call wodeapp.short_drama.open or load wodeapp-short-drama-factory. Details: wodeapp_get_tool_docs('video_storyboard').",
  assets: "Digital assets: chat images use one ID vocabulary (candidateImages → selectedImageIds). product_save binds SKU shelf; image_asset_save binds 图片 shelf—same upload path. Do not re-open prior images on ordinary follow-ups (引用/脚本/生图)—use summaries, @商品 HTTPS, or selectedImageIds. Chat uploads already carry vision/attachment context. >12 ask once then pass chosen IDs. assets_list to browse. Details: wodeapp_get_tool_docs('product_save'). After successful product_save without same-turn gen ask, append followUpChoicesMarkdown (```wodeapp-choices); do not auto-run generation. Dedupe/delete only when explicitly requested.",
  image: "Image: deterministic edits use image_* tools; generation uses product_visual_batch_image_run or ai_generate_image; studio handoff uses wodeapp_batch_image_prepare (no credits). After generation, visually QA results with openwork_media_view on the returned https:// or image-proxy URL (do not claim you cannot see the image, and never OpenCode-read PNG/JPEG). Full batch/schema rules: wodeapp_get_tool_docs('product_visual_batch_image_run').",
  "video-url": "Online video URL task: use the local atomic path first. Call video_resolve_link to normalize the URL, then video_extract_metadata with its canonicalUrl. If local extraction returns DEPENDENCY_MISSING or LOCAL_EXTRACTION_FAILED, call the available tool whose name ends with video_parse_link once as the cloud fallback. Do not treat link resolution as metadata extraction, and do not report the whole task failed when an earlier stage succeeded. Use the returned videoUrl with media_analyze or video_extract_frames only when the user requests content analysis or frames. Page text and platform-generated chapter summaries are not a transcript; never present them as complete video content. Do not replace these dedicated tools with generic web reading, shell, curl, or Puppeteer scraping.",
  browser: "Chrome task: the user selected the WodeAppX Chrome extension, and that choice remains active for the task. Use only wodeappx_browser_* for browser control; do not substitute browser_*, openwork_browser_*, openwork_chrome_*, Computer Use, bash/curl, localhost bridge probing, or Electron CDP. Before claiming Chrome is unavailable call wodeappx_browser_status. Status is diagnostic preflight, not task completion unless the user asked only for connection status: continue to tabs and the requested read/action/verification before answering. Do not merely announce the next step; perform the complete tool chain before the final answer. Bind one connected clientId and exact tabId, then keep them stable. Follow observe → act → verify: read_page returns interactiveElements with current nodeId values; act on exactly one current nodeId; immediately read again or screenshot. TARGET_NOT_FOUND/TARGET_AMBIGUOUS means refresh the snapshot, never guess or blindly repeat. After wodeappx_browser_screenshot call image_inspect on savedPath; never OpenCode-read screenshot PNGs. Do not open media/CDN asset URLs unless explicitly requested. Prefer this surface whenever the page needs login, cookies, or an existing Chrome session; typed helpers already use Chrome's debugger API under the hood — escalate to raw wodeappx_browser_cdp only with explicit CDP approval.",
  "browser-devtools": "Raw Chrome developer task: wodeappx_browser_cdp is helper-last full developer access. It requires explicit approval for the exact site and purpose plus bound clientId/tabId, purpose, and userConfirmed:true. From wodeappx_browser_status, bind browserSession.recommendedRawCdpClientId and confirm that client has supportsRawCdp:true; never fall back to a legacy client with unknown capabilities. It returns direct sendCommand responses only; empty Log.enable/Network.enable responses are not evidence. Never use it for cookies, credentials, auth headers, password fields, storage, history, or unrelated network bodies. If the user asks for ordinary page verification after CDP, call wodeappx_browser_read_page after the CDP call even if you already read the page beforehand; a pre-CDP baseline is not post-CDP verification.",
  internet: "Internet task: use agent_reach_weather for weather/forecasts and agent_reach_web_search for other current public information; read source pages when verification is needed. Never say real-time public information is unavailable before trying an enabled tool. State the observation/search time and include source URLs. Do not use shell networking when a dedicated tool is enabled. Login / paywall / cookie-session pages: stop retrying agent_reach_web_read, web_fetch, or curl; prefer the WodeAppX Chrome extension typed tools (wodeappx_browser_status → open_url → read_page) so the user's real Chrome login state can be reused. Tell the user to connect the extension via status().setup.url if needed. Raw wodeappx_browser_cdp stays helper-last and still needs explicit CDP approval for the exact site and purpose.",
  capture: "Capture task: start capture only when requested, report permission requirements, and stop the capture when the requested evidence is collected.",
  files: "Local file task: visibly call the tools appropriate to the file instead of claiming a hidden preprocessing result. When history supplies contextRefId, call openwork_attachment_context_read first and continue with nextOffset when hasMore is true. For long non-PDF documents, call openwork_file_extract_text in bounded windows and continue with nextOffset when hasMore is true. Legacy BIFF8 .xls is read by the bundled SheetJS backend; call openwork_runtime_status when you need to confirm .xls availability. PDF tools are already available; do not call the skill loader first. For PDF, call openwork_pdf_info followed by openwork_pdf_extract_text; when hasMorePages is true, continue with both nextStartPage and nextStartChar. Call openwork_pdf_render_pages when the PDF is scanned or the task depends on tables, images, product appearance, parameters, or layout. openwork_pdf_render_pages attaches bounded page previews for this turn; never call OpenCode read on those PNG paths. Search paths before reading only when an exact attachment path was not supplied. If the user explicitly requires an actual search or read for evidence, perform the tool call even when the same content is already present in conversation or system context; remembered context is not fresh evidence. When unread local Office/XLS attachments are listed, call openwork_file_extract_text first and wait for ok:true with sheet/row/cell evidence before wodeapp_product_save. Never invent product lines, and never call wodeapp_product_save after XLS_CORRUPT, XLS_ENCRYPTED, XLS_TOO_LARGE, XLS_NOT_BIFF8, or LEGACY_XLS_DEPENDENCY_MISSING. For batch organization, preview a plan first and apply it only after clear confirmation.",
  desktop: "Desktop task: inspect the named app or screen before acting, prefer semantic targets over raw coordinates, and use the smallest reversible action. Ask before consequential external actions.",
  shopify: "Shopify task: use the local connector for fast store context and the authenticated Shopify Admin MCP for resources that fixed local tools do not cover. Call shopify_connections_list to verify the mainserver OAuth connection; wodeappx_shopify_status only checks the runtime/CLI store bridge. Never expose Admin API tokens. Before shopify_graphql, use Shopify Dev schema/docs validation when the operation is unfamiliar. Queries are read-only; mutations must be previewed or described exactly and may pass confirmed:true only after explicit user confirmation. For Feishu sync: link_status -> sync_preview -> sync_apply(confirmed:true). Shopify Dev MCP is for API/docs/schema work, not store execution.",
  automation: "Scheduled task: confirm the schedule, timezone, working directory, and intended prompt before creating or changing a recurring job. Use list/status tools to verify the saved job.",
  docs: "Documentation lookup: openwork_docs_search covers only the bundled OpenWork desktop documentation. Inspect its corpus and status fields before reading a match. Treat status=no_match as a terminal search result; do not rephrase the same query repeatedly. It is not a WodeApp product-contract corpus, so use enabled workspace tools for repository docs when available and clearly report when the requested corpus is unavailable.",
  site: "Site / publish: prefer create_project (no templateId) → ai_generate_page (short prompt) → publish_project; preserve projectId. Hand-authored HTML: write the file locally first, then wodeapp_page_import_from_file({projectId, pageId, sourcePath}) — host reads the file; tool args stay path-sized — then publish_project. Never paste mega template-configs / cloned workbench source into update_page.config (causes finish=length or unavailable tool 'invalid'). On those errors do not retry the same large payload — call wodeapp_page_import_from_file or ai_generate_page, then still publish_project. List templates only when reusing one; build_app only for explicit packaging. Data apps: ai_generate_page writes one complete component using saveData/loadData/deleteData. Do not assemble SmartForm+SmartTable+Hero via update_page. Verify the published URL before reporting success. If this site belongs to a 智能体, call wodeapp_sidebar_agent_save with name + projectId + launchUrl after publish; the sidebar updates immediately, do not ask the user to refresh.",
  workspace: "Workspace task: inspect the relevant files before editing, preserve unrelated user changes, make scoped changes, and run the smallest meaningful verification.",
};

const FOUNDATION_CAPABILITY_PACK = "Deferred Visibility + Gated Execution: OpenCode initially exposes only a small direct coding/web surface plus tool_search. WodeApp business tools, installed plugins, connected MCP tools, Computer Use, capture, PDF/Office extraction, and browser automation are deferred; call tool_search with the required capability or integration and the matching live schemas become callable on the next model step. When tool_search returns zero matches: broaden the query once, then use web_search/webfetch for public guidance, or tell the user which MCP/extension/Skill to connect — never invent a tool schema and never glob/grep the repo hoping to find a missing integration. Visibility is not authorization: capability routing is only a relevance hint, while approvals and effect gates remain the safety boundary. Video routing: search for and use single-clip generation for one ≤15s clip; search for storyboard tools for N clips, multi-scene, storyboard, or >15s work. Preserve the same shareDocId for updates and send only delta scenes (≤25/call). Never use bash/curl /video/tasks for generation. Short-drama scripts use the short-drama editor; production remains on the video storyboard. Product short-video must not open short-drama."

const TOOL_LOOP_GUARD = "Tool-loop guard: use the smallest direct tool path. After three failed or repeated attempts at the same operation, stop and report the blocker instead of switching through unrelated browser, shell, rendering, or subagent paths. The runtime enforces a finite model-step budget for every turn; use the remaining step to explain a blocker instead of starting another search variant.";

const DEFAULT_RESPONSE_LANGUAGE_INSTRUCTION = "默认使用简体中文回答用户。只有用户明确要求其他语言时，才使用用户指定的语言；代码、命令、专有名词和必须保持原文的内容可保留原语言。";

export const WEB_SURFACE_IDENTITY_PACK =
  "Surface: WodeAppX web chat. You are WodeAppX. Do not describe yourself as a desktop workbench. 你是 WodeAppX 网页对话，不要自称桌面端、本机工作台，也不要声称能读写用户电脑上的文件。Help with conversation, writing, images, video, and browsing. Do not claim local file, folder, or self-evolve access; if the user needs those, tell them to use the WodeAppX desktop app.";

export const WEB_SELF_EVOLVE_HINT =
  "Self-evolution is only available in the WodeAppX desktop app. 自进化只在 WodeAppX 桌面端。Do not offer snapshot, verify, or rollback from web chat.";

export function isWodeAppWebRuntime(draft: Pick<CapabilityRoutingDraft, "runtime"> = {}): boolean {
  if (draft.runtime === "web") return true;
  if (draft.runtime === "desktop") return false;
  const env = (typeof import.meta !== "undefined"
    && (import.meta as { env?: { VITE_OPENWORK_DEPLOYMENT?: string } }).env?.VITE_OPENWORK_DEPLOYMENT)
    || "";
  return env.trim().toLowerCase() === "web";
}

const ALL_MANAGED_TOOLS = [...new Set([
  ...ALWAYS_AVAILABLE_FOUNDATION_TOOL_IDS,
  ...WODEAPP_DIRECT_TOOL_NAMES,
  ...SUBSTANTIVE_RESIDENT_TOOL_IDS,
  ...NON_PRIMARY_BROWSER_TOOL_IDS,
  ...Object.values(CAPABILITY_TOOL_GRAPH).flat(),
  ...WODEAPP_PLATFORM_MCP_TOOL_IDS,
  ...WODEAPP_SHOPIFY_ADMIN_MCP_TOOL_IDS,
])];

function toolPolicyKeys(toolName: string): string[] {
  if (WODEAPP_SHOPIFY_ADMIN_MCP_TOOL_ID_SET.has(toolName)) {
    return [toolName, `${WODEAPP_SHOPIFY_ADMIN_MCP_PREFIX}_${toolName}`];
  }
  if (!WODEAPP_PLATFORM_MCP_TOOL_ID_SET.has(toolName)) return [toolName];
  return [toolName, `${WODEAPP_PLATFORM_MCP_PREFIX}_${toolName}`];
}

function includesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function hasLoginSessionBrowserIntent(text: string): boolean {
  // Prefer real Chrome (extension typed tools) when the user signals a signed-in
  // session, login wall, or auth cookie is required — not WodeApp account login.
  if (/(?:请先|需要)?登录\s*(?:wodeappx|wodeapp|小灵通|我的appx|账户|账号)|退出登录|登录弹窗/i.test(text)) {
    return false;
  }
  return includesAny(text, [
    /(?:需要|要|得|必须|先).{0,8}登录/,
    /登录(?:后|才能|方可|才可以|才可以看|才可看|可见|才能看|才能打开|才能访问|才能抓|才能读)/,
    /登录态|登录状态|登录会话|已登录|带登录|用登录|真实登录|浏览器登录/,
    /(?:页面|网页|网站|链接|站点).{0,20}(?:需要|要|得).{0,8}登录/,
    /(?:抓取|爬取|读取|打开|访问|查看).{0,24}(?:需要|要).{0,8}登录/,
    /(?:登录墙|付费墙|鉴权|cookie\s*会话|会话cookie)/i,
    /\b(?:login[\s-]?wall|paywall|signed[\s-]?in|sign[\s-]?in required|requires?\s+login|authenticated\s+session|auth\s+cookie)\b/i,
    /\b(?:login|sign[\s-]?in|signed[\s-]?in).{0,32}\b(?:page|site|url|chrome|browser|session)\b/i,
  ]);
}

function hasAffirmativeRawCdpIntent(text: string): boolean {
  const signal = /\bcdp\b|devtools|chrome\s*debugger|开发者工具|调试协议/i;
  if (!signal.test(text)) return false;
  // Scope negation to the punctuation-delimited clause that actually mentions
  // CDP. A later clause such as "不要使用 ChatGPT 插件" must not disable an
  // explicitly authorized CDP request earlier in the prompt.
  const cdpClauses = text
    .split(/[。！？!?；;\n]+/)
    .map((clause) => clause.trim())
    .filter((clause) => signal.test(clause));
  return !cdpClauses.some((clause) => includesAny(clause, [
    /(?:不要|请勿|禁止|别|不用|不使用|无需|不需要).{0,120}(?:\bcdp\b|devtools|chrome\s*debugger|开发者工具|调试协议)/i,
    /(?:\bcdp\b|devtools|chrome\s*debugger|开发者工具|调试协议).{0,24}(?:不要用|请勿使用|禁止使用|禁用|不允许|不用|不使用|无需|不需要)/i,
    /\b(?:do not|don't|never|without)\b.{0,120}\b(?:cdp|devtools|chrome debugger)\b/i,
    /\b(?:cdp|devtools|chrome debugger)\b.{0,64}\b(?:disabled|forbidden|not allowed)\b/i,
  ]));
}

function hasPart(draft: CapabilityRoutingDraft, type: string): boolean {
  return (draft.parts ?? []).some((part) => part?.type === type);
}

function isSmallTalkOnly(text: string): boolean {
  return /^(?:你好|您好|嗨|哈喽|在吗|早上好|下午好|晚上好|早安|晚安|谢谢|感谢|再见|好的|好|收到|行|可以|你是谁|介绍一下自己|hello|hi|hey|thanks|thank you|bye|ok|okay)[!！?？。,.，\s]*$/i.test(text);
}

function explicitlyRequestsNoExecution(text: string): boolean {
  return includesAny(text, [
    /(?:不要|请勿|禁止|无需|不需要).{0,10}(?:调用|使用).{0,6}(?:任何)?工具/,
    /(?:还没|尚未|没有|未).{0,8}授权.{0,12}(?:执行|操作).{0,24}(?:只|仅).{0,12}(?:告诉|说明|列出).{0,12}(?:确认|授权|需要)/,
    /(?:先不要|暂不|不要|别).{0,8}(?:执行|操作).{0,24}(?:只|仅).{0,12}(?:告诉|说明|列出)/,
    /(?:只|仅).{0,12}(?:告诉|说明|列出).{0,24}(?:不要|先别|暂不|无需).{0,8}(?:执行|操作)/,
    /\b(?:do not|don't|never)\s+(?:call|use)\s+(?:any\s+)?tools?\b/i,
    /\b(?:do not|don't)\s+(?:execute|take action|make changes).{0,48}\b(?:only|just)\s+(?:tell|explain|list)\b/i,
  ]);
}

function isFocusedWeatherRequest(draft: CapabilityRoutingDraft): boolean {
  const text = `${draft.resolvedText ?? draft.text ?? ""}`.trim().toLowerCase();
  if (!/天气|气温|温度|降雨|降水|空气质量|天气预报|weather|forecast|temperature/i.test(text)) return false;
  return !/新闻|热搜|比分|赛程|股价|行情|汇率|总统|总理|主席|ceo|首席执行官|youtube|bilibili|哔哩哔哩|v2ex|rss|latest news|stock price|exchange rate/i.test(text);
}

function isFocusedStoryboardRequest(draft: CapabilityRoutingDraft): boolean {
  const text = `${draft.resolvedText ?? draft.text ?? ""}`.trim().toLowerCase();
  if (!/分镜|storyboard/i.test(text)) return false;
  return /创建|整理|准备|打开|项目|多条|批量|create|prepare|open|project|multi[- ]scene|batch/i.test(text);
}

function isFocusedAttachmentVideoAnalysisRequest(draft: CapabilityRoutingDraft): boolean {
  const text = `${draft.resolvedText ?? draft.text ?? ""}`.trim().toLowerCase();
  const hasVideoAttachment = (draft.attachments ?? []).some((attachment) =>
    attachment?.kind === "video" || String(attachment?.mimeType ?? "").toLowerCase().startsWith("video/"),
  );
  if (!hasVideoAttachment) return false;
  return /解析|分析|抽帧|关键帧|截图|四宫格|怎么开|如何开|操作步骤|analy[sz]e|extract frames?|keyframes?|contact sheet/i.test(text);
}

function isPackagingRequest(text: string): boolean {
  return /\b(?:apk|pwa|tauri|extension|browser extension|desktop package)\b|安卓安装包|桌面安装包|浏览器扩展|打包/i.test(text);
}

function isTemplateRequest(text: string): boolean {
  return /模板|template/i.test(text);
}

function requestsFullProductVisualContract(draft: CapabilityRoutingDraft): boolean {
  const text = `${draft.resolvedText ?? draft.text ?? ""}`.trim().toLowerCase();
  return includesAny(text, [
    /product_visual_batch_image(?:_capability)?.{0,24}(?:完整|全部|full|schema|defaults?|examples?|契约|参数定义)/i,
    /(?:批量生图|商品生图|商品图).{0,20}(?:完整契约|完整参数|全部参数|schema|defaults?|examples?|能力定义)/i,
    /(?:完整契约|完整参数|全部参数|schema|defaults?|examples?|能力定义).{0,20}(?:批量生图|商品生图|商品图)/i,
  ]);
}

export function detectWodeAppCapabilities(draft: CapabilityRoutingDraft): WodeAppCapabilityId[] {
  const text = `${draft.resolvedText ?? draft.text ?? ""}`.trim().toLowerCase();
  if (explicitlyRequestsNoExecution(text)) return [];
  const focusedStoryboardRequest = isFocusedStoryboardRequest(draft);
  const selected = new Set<WodeAppCapabilityId>();
  const add = (capability: WodeAppCapabilityId) => selected.add(capability);

  // Fine-grained graph node: URL parsing is not part of the default video
  // generation/attachment pack and must not inject its tools or instructions.
  const onlineVideoUrlIntent = /https?:\/\/(?:www\.)?(?:douyin\.com|iesdouyin\.com|v\.douyin\.com|kuaishou\.com|v\.kuaishou\.com|bilibili\.com|b23\.tv|xiaohongshu\.com|xhslink\.com|ixigua\.com|weibo\.com|weibo\.cn|t\.cn|tiktok\.com|vm\.tiktok\.com|youtube\.com|youtu\.be)\//i.test(text)
    || (/https?:\/\//i.test(text)
      && /视频|短片|录像|录屏|\bvideo\b|\bclip\b/i.test(text)
      && /解析|提取|抓取|下载|分析|parse|extract|download|analy[sz]e/i.test(text));
  if (onlineVideoUrlIntent) add("video-url");

  const contextualOnlineVideoIntent = !/https?:\/\//i.test(text)
    && !(draft.attachments ?? []).some((attachment) =>
      attachment?.kind === "video" || String(attachment?.mimeType ?? "").toLowerCase().startsWith("video/"),
    )
    && /(?:这个|该|刚才|上面|前面|它|this|that|previous).{0,8}(?:视频|短片|video|clip)|(?:视频|短片|video|clip).{0,8}(?:内容|继续|下载|解析|分析|抓取)/i.test(text)
    && /解析|分析|提取|抓取|下载|内容|字幕|转录|parse|analy[sz]e|extract|download|transcri/i.test(text);
  if (contextualOnlineVideoIntent) add("video-url");

  const asksCapabilityList = includesAny(text, [
    /你能做什么|有什么能力|支持什么|能力列表|能力类别|能力发现|工具列表|列出.*(?:能力|工具)|list (?:your )?(?:capabilities|tools)|what can you do/i,
  ]);
  if (asksCapabilityList) add("discovery");

  const hasImageAttachment = (draft.attachments ?? []).some((attachment) =>
    attachment?.kind === "image"
    || String(attachment?.mimeType ?? "").toLowerCase().startsWith("image/"),
  );
  const imageIntent = includesAny(text, [
    /(生成|创建|制作|设计|画|绘制|出图|生图|修图|改图|抠图|换背景|扩图|裁图|裁剪|缩放|旋转|翻转|拼图|拼接|合成|叠图).{0,16}(图片|图像|照片|海报|主图|套图|配图|封面|头像|参考图)/,
    /(图片|图像|照片|海报|主图|套图|配图|封面|头像|参考图).{0,12}(生成|创建|制作|设计|修复|编辑|修改|裁剪|缩放|旋转|翻转|拼接|合成)/,
    /(打开|进入|预填|准备|查看|切换到?).{0,16}(图片智能体|图片工作室|图片工作台|生图工作室|生图工作台)/,
    /(图片智能体|图片工作室|图片工作台|生图工作室|生图工作台).{0,16}(打开|进入|预填|准备|查看|切换)/,
    /\b(generate|create|design|draw|edit|retouch|crop|resize|rotate|flip|collage|composite|stitch).{0,24}\b(image|photo|poster|cover|thumbnail|contact sheet)s?\b/i,
    /\b(open|show|enter|prepare|prefill|switch to).{0,24}\b(image agent|image studio|image workbench)\b/i,
  ]);
  const imageAttachmentUnderstandIntent = hasImageAttachment && includesAny(text, [
    /这张图|识图|看图|看下图|看看图|图片|图像|照片|截图|讲了什么|什么内容|描述|识别|看一下|看看/,
    /\b(image|photo|picture|screenshot|describe|what.*(see|show|in)|look at)\b/i,
  ]);
  if (imageIntent || imageAttachmentUnderstandIntent || requestsFullProductVisualContract(draft)) add("image");

  // Video intent: strong regex signals (explicit "make/analyze a video") + weak
  // semantic signals (colloquial phrases like 弄个/写脚本/发抖音/N条/开工作台/种草带货/短剧剧本).
  // Weak signals intentionally skew toward recall: mounting the video pack only
  // surfaces more tools; missing it blocks the task entirely. When the user is
  // clearly talking about coding (python/shell 脚本) we still suppress workspace
  // via creativeScriptIntent below, so video + non-workspace is the safe default.
  const videoStrongIntent = includesAny(text, [
    /(生成|创建|制作|做|拍|剪|剪辑|剪接|裁切|渲染|合成|混剪|二创|录|录制).{0,18}(视频|短片|短视频|广告片|宣传片|tvc|预告片|片花|剧情片|成片|影片|短剧|分镜|口播视频|种草视频|带货视频)/,
    /(视频|短片|短视频|广告片|宣传片|tvc|预告片|片花|剧情片|成片|影片|短剧|分镜).{0,14}(生成|创建|制作|做|剪辑|渲染|合成|混剪|二创|录|录制)/,
    /\d+\s*[条段个集期部].{0,12}(视频|短片|短视频|短剧|分镜)/,
    /(视频|短片|短视频|短剧|分镜).{0,12}\d+\s*[条段个集期部]/,
    /(解析|分析|抽帧|关键帧|截图|四宫格|操作步骤|转写|字幕).{0,18}(视频|短片|录像|录屏|影片)/,
    /(视频|短片|录像|录屏|影片).{0,14}(解析|分析|抽帧|关键帧|截图|四宫格|操作步骤|转写|字幕)/,
    /\b(generate|create|make|render|edit|produce|shoot).{0,24}\b(video|clip|commercial|trailer|storyboard|short film|reel|tiktok)\b/i,
    /\b(analy[sz]e|extract frames?|make).{0,24}\b(video|clip|keyframes?|contact sheet|footage)s?\b/i,
  ]);
  const videoNoun = /(?:视频|短片|短视频|视频号|抖音|抖加|抖\+|快手|小红书|b站|哔哩哔哩|bilibili|youtube|油管|youtu\.be|tiktok|reels?|shorts?|短剧|微短剧|分镜|口播|种草|带货|宣传片|广告片|tvc|成片|影片|录像|录屏|旁白|字幕|剧情片|预告片|片花|混剪|二创|剧集|连续剧|剧本)/i;
  const videoPlatformNoun = /(?:抖音|快手|小红书|视频号|b站|哔哩哔哩|bilibili|youtube|油管|youtu\.be|tiktok|reels?|shorts?|视频平台)/i;
  const videoAction = /(?:弄|做|写|搞|来|出|拍|剪|发|生成|制作|渲染|合成|剪辑|录|录制|开|准备|起|搭|攒|写个|做个|弄个|来个|出个|搞个|发个|生成个|开个|准备个|工作[台室]|studio|workbench|脚本|剧本|文案|口播稿|分镜稿|copy|script|storyboard|条|段|集|期|部)/i;
  const videoWeakIntent = includesAny(text, [
    // "写个脚本发抖音 / 弄个种草视频 / 来5条带货短视频 / 开视频工作台 / 做个短剧剧本"
    new RegExp(videoNoun.source + ".{0,24}" + videoAction.source, "i"),
    new RegExp(videoAction.source + ".{0,24}" + videoNoun.source, "i"),
    // Post/publish to a video platform: 发抖音 / 上传小红书 / 发到B站
    new RegExp("(?:发|上传|投|投放|同步|publish|upload|post|share).{0,16}" + videoPlatformNoun.source, "i"),
    // "N条/N段/N个/N集" video-sized batch, even without the word 视频 nearby
    /\d+\s*[条段个集期部].{0,20}(?:带货|种草|口播|剧情|宣传|广告|预告)/,
    /(?:带货|种草|口播|剧情|宣传|广告|预告).{0,12}\d+\s*[条段个集期部]/,
    // Explicit workbench/studio open
    /(?:打开|进入|开|切换到?|预填|准备).{0,16}(?:视频(?:工作[台室]|智能体|分镜)|分镜工作[台室]|短剧(?:工作[台室]|工厂))/,
    /(?:视频(?:工作[台室]|智能体|分镜)|分镜工作[台室]|短剧(?:工作[台室]|工厂)).{0,16}(?:打开|进入|开|切换|预填|准备)/,
    // English colloquial
    /\b(make|whip up|draft|write|shoot|cut|edit|post|publish|upload).{0,24}\b(script|storyboard|short (?:drama|film)|tiktok|reel|youtube (?:short|video)|shorts)\b/i,
    /\b(short (?:drama|film)|tiktok|reel|youtube (?:short|video)|shorts).{0,24}\b(script|storyboard|idea|batch|workbench|studio)\b/i,
  ]);
  // Avoid false positives: pure coding "python脚本/shell脚本" is filtered later
  // by creativeScriptIntent for workspace, but here we avoid mounting video
  // when the only "video-ish" hit is a generic 脚本/文案 with zero video nouns.
  const videoFalsePositive = !videoNoun.test(text)
    && !/\d+\s*[条段个集期部]/.test(text)
    && !/(?:工作[台室]|studio|workbench|storyboard)/i.test(text);
  const videoIntent = videoStrongIntent || (videoWeakIntent && !videoFalsePositive);
  if (videoIntent && !onlineVideoUrlIntent) add("video");

  const assetIntent = (draft.assetMentions?.length ?? 0) > 0 || includesAny(text, [
    /数字资产|商品库|品牌库|素材库|角色库|提示词库|产品资料|商品资料|保存.{0,10}(品牌|商品|素材|提示词)/,
    /(?:之前|以前).{0,16}(?:存|保存|上传).{0,20}(?:找|查|看看|搜)/,
    /(?:找|查|看看|搜).{0,16}(?:之前|以前).{0,12}(?:存|保存|上传)/,
    /(?:找|查|看看).{0,12}(?:模特图|素材|商品图|品牌色|品牌库)/,
    /(?:删除|清理|去重).{0,12}(?:资产|素材|图片|商品|品牌|重复)/,
    /\b(digital asset|asset library|product catalog|brand library|prompt library|dedupe|delete asset)s?\b/i,
  ]);
  if (assetIntent || ((imageIntent || videoIntent) && /商品|产品|品牌|sku|product|brand/i.test(text))) add("assets");

  const rawCdpIntent = hasAffirmativeRawCdpIntent(text);
  const loginSessionBrowserIntent = hasLoginSessionBrowserIntent(text);
  const browserIntent = rawCdpIntent || loginSessionBrowserIntent || includesAny(text, [
    /(打开|访问|进入|浏览|读取|点击|填写|输入|登录|检查|查看|看看|测试|控制|操作|连接|链接|接入|配置|调试).{0,24}(浏览器|chrome|网页|网站|页面|标签页|链接|插件)/,
    /(浏览器|chrome|chrome插件|浏览器插件|标签页).{0,24}(打开|操作|读取|点击|填写|输入|登录|查看|看看|测试|控制|连接|链接|接入|配置|调试|执行)/,
    /(?:通过|使用|用|在).{0,8}(?:chrome|浏览器)(?:插件)?.{0,24}(?:操作|执行|打开|读取|查看|检查|测试|调试|连接)/i,
    /(?:打开|访问|进入|浏览|点击|填写|登录|检查).{0,12}https?:\/\//i,
    /\b(open|visit|browse|read|click|fill|sign in|log in|inspect).{0,24}\b(browser|chrome|website|web page|tab|url|link)\b/i,
  ]);
  if (browserIntent) add("browser");
  if (browserIntent && rawCdpIntent) {
    add("browser-devtools");
  }

  const explicitInternetResearchIntent = includesAny(text, [
    /上网|联网|网络搜索|搜索网页/,
    /(?:搜索|查询|查找|检索|调研).{0,20}(?:公开资料|网络资料|行业数据|市场数据|公开数据|官网|新闻|舆情)/,
    /(?:公开资料|网络资料|行业数据|市场数据|公开数据|官网|新闻|舆情).{0,20}(?:搜索|查询|查找|检索|调研)/,
    /天气|气温|温度|降雨|降水|空气质量|天气预报|台风路径|地震速报|新闻|热搜|比分|赛程|股价|行情|汇率|现任/,
    /\b(search the web|web search|look up online|research (?:public|industry|market)|public information|industry data|market data|latest news|weather|forecast|temperature|news|score|schedule|stock price|exchange rate)\b/i,
  ]);
  const internetIntent = includesAny(text, [
    /上网|联网|网络搜索|搜索网页|查一下.{0,12}(最新|新闻|资料|官网)|读取.{0,8}(网页|链接)|youtube|bilibili|哔哩哔哩|v2ex|rss/,
    /(?:搜索|查询|查找|检索|调研).{0,20}(?:公开资料|网络资料|行业数据|市场数据|公开数据|官网|新闻|舆情)/,
    /(?:公开资料|网络资料|行业数据|市场数据|公开数据|官网|新闻|舆情).{0,20}(?:搜索|查询|查找|检索|调研)/,
    /(?:读取|查看|总结|分析|解析|提取|抓取|下载).{0,16}https?:\/\//i,
    /https?:\/\/\S+.{0,16}(?:读取|查看|总结|分析|解析|提取|抓取|下载)/i,
    /天气|气温|温度|降雨|降水|空气质量|天气预报|台风路径|地震速报/,
    /实时|最新|最近|刚刚|近期|本周|本月|新闻|热搜|比分|赛程|股价|行情|汇率|现任|(?:今天|今日|现在|目前).{0,12}(?:天气|气温|温度|降雨|降水|新闻|热搜|比分|赛程|股价|行情|汇率|总统|总理|主席|ceo|首席执行官)/i,
    /\b(search the web|web search|look up online|research (?:public|industry|market)|public information|industry data|market data|latest news|read (?:this )?(?:url|link)|youtube|bilibili|rss|weather|forecast|temperature|current|today|latest|recent|news|score|schedule|stock price|exchange rate)\b/i,
  ]);
  const videoUrlCapabilitySelected = onlineVideoUrlIntent || contextualOnlineVideoIntent;
  if (!browserIntent && internetIntent && (!videoUrlCapabilitySelected || explicitInternetResearchIntent)) add("internet");

  const desktopIntent = hasPart(draft, "app") || includesAny(text, [
    /(操作|控制|打开|切换|点击|输入|滚动).{0,14}(电脑|桌面|本机|应用|app|窗口)/,
    /(看|查看|检查|截).{0,10}(屏幕|桌面|窗口)/,
    /\b(control|operate|open|switch|click|type|scroll|inspect).{0,20}\b(desktop|computer|native app|window|screen)\b/i,
  ]);
  if (desktopIntent) add("desktop");

  const captureIntent = includesAny(text, [
    /抓包|网络捕获|请求捕获|录制.{0,8}(请求|网络)|capture.{0,8}(traffic|request)/i,
  ]);
  if (captureIntent) add("capture");

  const hasOnlineUrl = /https?:\/\//i.test(text);
  const fileIntent = !focusedStoryboardRequest
    && (!hasOnlineUrl || hasPart(draft, "file"))
    && (hasPart(draft, "file") || includesAny(text, [
    /(查找|搜索|读取|打开|预览|整理|移动|重命名|提取|分析|解析).{0,16}(文件|文件夹|目录|pdf|word|excel|ppt|音频|视频)/,
    /(查找|搜索|读取|打开|预览|整理|移动|重命名|提取|分析|解析).{0,48}(agents?\.md|[\w.-]+\.(?:md|txt|json|ya?ml|toml|csv|tsv|pdf|docx?|xlsx?|pptx?))/i,
    /\b(find|search|read|open|preview|organize|move|rename|extract|analyze).{0,24}\b(file|folder|directory|pdf|word|excel|powerpoint|audio|video)s?\b/i,
  ]));
  if (fileIntent) add("files");

  const shopifyIntent = /shopify|shop pay|店铺后台|独立站订单|商品上架|运费模板|配送模板|shipping profiles?|delivery profiles?|飞书.{0,8}(同步|商品)|同步.{0,8}(飞书|shopify)|bitable|多维表/i.test(text);
  if (shopifyIntent) add("shopify");

  const automationIntent = includesAny(text, [
    /自动化|一次性.{0,8}(任务|提醒)|计划时间|自动执行/,
    /定时|每天.{0,8}(执行|运行|提醒)|每周|每月|周期任务|自动运行|计划任务|调度任务/,
    /(?:每天|每日|每晚).{0,24}(?:总结|检查|整理|同步|提交|推送|更新|删除|清理|备份|发送|生成|抓取|统计)/,
    /\b(schedule|scheduled|recurring|cron|one[- ]time task|automation|every day|daily|weekly|monthly)\b/i,
  ]);
  if (automationIntent) add("automation");

  const docsIntent = includesAny(text, [
    /(wodeapp|我的appx|wodeappx|接口|api|mcp).{0,16}(文档|配置|契约|怎么接入|实现细节)/i,
    /(文档|配置|契约|接入).{0,12}(wodeapp|我的appx|wodeappx|api|mcp)/i,
    /\b(wodeapp|wodeappx).{0,24}\b(docs?|documentation|api|contract|configuration)\b/i,
  ]);
  if (docsIntent) add("docs");

  const appUiIntent = includesAny(text, [
    /(打开|进入|修改|查看).{0,12}(设置|模型设置|扩展|权限|技能|provider|服务商)/,
    /\b(open|go to|change|inspect).{0,18}\b(settings|extensions|permissions|skills|providers)\b/i,
  ]);
  if (appUiIntent) add("app-ui");

  const localAgentDefinitionIntent = includesAny(text, [
    /(?:opencode|codex|claude|cursor).{0,16}(?:智能体|agent)/i,
    /(?:智能体|agent).{0,16}(?:配置文件|定义文件|agents?\.md|skill\.md)/i,
  ]);
  const agentAppIntent = !localAgentDefinitionIntent && includesAny(text, [
    /\bagent\s*app(?:lication)?\b|agent.{0,8}应用|智能体应用/i,
    /(创建|生成|搭建|制作|发布|开发|保存).{0,20}(?:ai\s*)?(智能体|助手|对话机器人|客服机器人)/i,
    /(?:ai\s*)?(智能体|助手|对话机器人|客服机器人).{0,16}(创建|生成|搭建|制作|发布|开发|保存|应用|网站|页面)/i,
    /\b(?:build|create|publish|launch).{0,24}\b(?:ai agent|assistant|chatbot|bot)\b/i,
    /(?:打开|进入|使用)?创建智能体/,
  ]);
  const complexAgentAppIntent = agentAppIntent
    && /多页|数据(?:库|应用)?|工作流|表单|crm|collection|database|workflow/i.test(text);
  if (agentAppIntent) {
    add("agent-app");
    if (complexAgentAppIntent) add("site");
  }

  const siteIntent = includesAny(text, [
    /建站/,
    /模板.{0,8}(建|创建|生成).{0,8}(网站|站点|页面)/,
    /(打包|构建|导出).{0,14}(网站|站点|web app|应用)/i,
    /(网站|站点|web app|应用).{0,14}(打包|构建|导出)/i,
    /(创建|生成|搭建|制作|发布|修改).{0,18}(网站|站点|网页|页面|web app|应用|工作流)/,
    /(网站|站点|网页|页面|web app|应用|工作流).{0,14}(创建|生成|搭建|制作|发布|修改)/,
    /\b(build|create|publish|modify).{0,24}\b(site|website|web app|landing page|workflow)\b/i,
  ]);
  if (siteIntent && !agentAppIntent) add("site");

  // Coding/repo tools only — do not piggyback on generic file/PDF intent
  // (that already mounts the `files` pack). Product chat must not get bash/read.
  // Avoid false positives like「摩飞测试2…视频脚本」(测试…脚本 within 18 chars).
  // Still allow「写个 python 脚本 / 跑 shell」— exclude creative 视频/口播/分镜脚本.
  const creativeScriptIntent = /(?:视频|口播|分镜|带货|种草|短剧|旁白|文案).{0,10}脚本|脚本.{0,10}(?:视频|口播|分镜|带货|种草|短剧)/.test(text);
  const codingScriptIntent = !creativeScriptIntent && includesAny(text, [
    /(?:写|跑|运行|执行|调试|生成).{0,18}(?:python|\.py\b|shell|bash|powershell|脚本)/i,
    /(?:python|\.py\b|shell|bash|powershell).{0,18}(?:写|跑|运行|执行|脚本|代码)/i,
    /\bpip\s+install\b|requirements\.txt|\bvenv\b|virtualenv/i,
  ]);
  const workspaceIntent = codingScriptIntent || includesAny(text, [
    /(修改|实现|修复|重构|调试|审查|编译).{0,18}(代码|代码项目|仓库|源码|组件|函数|接口|单元测试|bug|报错)/,
    /(代码|代码项目|仓库|源码|组件|函数|单元测试|bug|报错).{0,14}(修改|实现|修复|重构|调试|审查|编译|运行|构建)/,
    /(?:写|改|修|跑|看).{0,6}代码|(?:代码).{0,8}(?:写|改|修|跑|测|看)/,
    /\b(implement|fix|refactor|debug|review).{0,24}\b(code|repo|component|function|bug|error)s?\b/i,
    /\b(code|repo|source).{0,16}\b(fix|bug|refactor|implement)\b/i,
  ]);
  if (workspaceIntent) add("workspace");

  // Unclassified substantive requests still get a general pack for system
  // guidance; creative-core tools are mounted in routeWodeAppCapabilities.
  if (selected.size === 0 && text && !isSmallTalkOnly(text)) add("general");

  return [...selected];
}

function mergeAttachmentRequirementCapabilities(
  detected: WodeAppCapabilityId[],
  requirements?: AttachmentRequirements,
): WodeAppCapabilityId[] {
  const merged = new Set<WodeAppCapabilityId>(detected);
  if (requirements?.localRead) merged.add("files");
  for (const capability of requirements?.requiredCapabilities ?? []) merged.add(capability);
  return [...merged];
}

const CONTEXT_ONLY_CAPABILITIES = new Set<WodeAppCapabilityId>([
  "discovery",
  "docs",
  "general",
]);

function activeTaskCapabilities(capabilities: WodeAppCapabilityId[]): WodeAppCapabilityId[] {
  return capabilities.filter((capability) => !CONTEXT_ONLY_CAPABILITIES.has(capability));
}

function mergeRecentConversationCapabilities(
  detected: WodeAppCapabilityId[],
  draft: CapabilityRoutingDraft,
): WodeAppCapabilityId[] {
  const text = `${draft.resolvedText ?? draft.text ?? ""}`.trim().toLowerCase();
  if (!text || isSmallTalkOnly(text) || explicitlyRequestsNoExecution(text)) return detected;

  const currentTaskCapabilities = activeTaskCapabilities(detected);
  if (currentTaskCapabilities.length > 0) return detected;

  // When this turn only has context-only packs (general/discovery/docs) or no
  // pack, retain the recent active task pack. Short imperative follow-ups
  // ("直接用 https…") often lack pronouns and previously fell through to the
  // old complete-tool fail-open.
  const recentTexts = (draft.recentUserTexts ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(-3)
    .reverse();
  for (const recentText of recentTexts) {
    const previousTaskCapabilities = activeTaskCapabilities(
      detectWodeAppCapabilities({ text: recentText }),
    );
    if (!previousTaskCapabilities.length) continue;
    return [
      ...detected.filter((capability) => capability !== "general"),
      ...previousTaskCapabilities.filter((capability) => !detected.includes(capability)),
    ];
  }

  return detected;
}

export function routeWodeAppCapabilities(draft: CapabilityRoutingDraft): WodeAppCapabilityRoute {
  const capabilities = mergeAttachmentRequirementCapabilities(
    mergeRecentConversationCapabilities(detectWodeAppCapabilities(draft), draft),
    draft.attachmentRequirements,
  );
  const text = `${draft.resolvedText ?? draft.text ?? ""}`.trim().toLowerCase();
  const noExecution = explicitlyRequestsNoExecution(text);
  const enabled = new Set<string>(
    noExecution ? [] : ALWAYS_AVAILABLE_FOUNDATION_TOOL_IDS,
  );
  const focusedWeatherRequest = isFocusedWeatherRequest(draft);
  const focusedAttachmentVideoAnalysisRequest = isFocusedAttachmentVideoAnalysisRequest(draft);
  const substantiveTask = Boolean(text) && !isSmallTalkOnly(text) && !noExecution;
  const focusedBrowserRequest = capabilities.includes("browser");

  // This graph now supplies relevance hints for dynamic discovery. The patched
  // OpenCode loop owns actual visibility and initially exposes only its direct
  // set plus tool_search.
  if (substantiveTask && !focusedBrowserRequest) {
    for (const toolName of SUBSTANTIVE_RESIDENT_TOOL_IDS) enabled.add(toolName);
  }

  for (const capability of capabilities) {
    if (capability === "general") {
      // Creative core already includes discovery; keep the branch for clarity.
      for (const toolName of CAPABILITY_TOOL_GRAPH.discovery) {
        enabled.add(toolName);
      }
      continue;
    }
    if (capability === "internet" && focusedWeatherRequest) {
      for (const toolName of FOCUSED_WEATHER_TOOL_IDS) enabled.add(toolName);
      continue;
    }
    if (capability === "video" && focusedAttachmentVideoAnalysisRequest) {
      // Frames/contact sheet already injected as attachment context. Video pack
      // tools remain visible via creative core; skip re-adding from the pack only.
      continue;
    }
    for (const toolName of CAPABILITY_TOOL_GRAPH[capability]) enabled.add(toolName);
  }

  if (capabilities.includes("image") && requestsFullProductVisualContract(draft)) {
    enabled.add("product_visual_batch_image_capability");
  }

  if (capabilities.includes("site") && isTemplateRequest(text)) enabled.add("list_templates");
  if ((capabilities.includes("site") || capabilities.includes("agent-app")) && isPackagingRequest(text)) {
    enabled.add("build_app");
  }

  for (const toolName of draft.attachmentRequirements?.requiredTools ?? []) {
    enabled.add(toolName);
  }

  for (const toolName of generationToolsHiddenBySnapshot(draft.providerCapability)) {
    enabled.delete(toolName);
  }

  const dependencyQueue = [...enabled];
  for (let index = 0; index < dependencyQueue.length; index += 1) {
    const toolName = dependencyQueue[index];
    for (const dependency of TOOL_DEPENDENCY_GRAPH[toolName] ?? []) {
      if (enabled.has(dependency)) continue;
      enabled.add(dependency);
      dependencyQueue.push(dependency);
    }
  }

  const tools = Object.fromEntries(ALL_MANAGED_TOOLS.flatMap((toolName) =>
    toolPolicyKeys(toolName).map((policyKey) => [policyKey, enabled.has(toolName)]),
  ));
  const enabledTools = ALL_MANAGED_TOOLS.filter((toolName) => enabled.has(toolName));
  const disabledTools = ALL_MANAGED_TOOLS.filter((toolName) => !enabled.has(toolName));
  const system = [
    FOUNDATION_CAPABILITY_PACK,
    ...capabilities.map((capability) => CAPABILITY_PACKS[capability]),
    capabilities.length || substantiveTask ? TOOL_LOOP_GUARD : undefined,
    isWodeAppWebRuntime(draft)
      ? WEB_SURFACE_IDENTITY_PACK
      : resolveSelfEvolveAwarenessPack({
        workspaceName: draft.workspaceName,
        workspaceDirectory: draft.workspaceDirectory,
        text: `${draft.resolvedText ?? draft.text ?? ""}`,
      }),
    isWodeAppWebRuntime(draft) && asksAboutSelfEvolve(`${draft.resolvedText ?? draft.text ?? ""}`)
      ? WEB_SELF_EVOLVE_HINT
      : undefined,
    buildAgentProviderCapabilityPack(draft.providerCapability),
    DEFAULT_RESPONSE_LANGUAGE_INSTRUCTION,
  ].filter((value): value is string => Boolean(value)).join("\n");

  return {
    capabilities,
    system,
    tools,
    enabledTools,
    disabledTools,
  };
}
