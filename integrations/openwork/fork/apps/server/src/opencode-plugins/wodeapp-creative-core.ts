/**
 * Tools mounted on every substantive turn (non-small-talk, not no-execution).
 *
 * Parity target: Codex / Cursor keep coding-agent basics always visible and
 * gate risk at approval/execution — not by hiding read/bash behind intent regex.
 *
 * Packaged WodeAppX chats use a small default workspace (not the monorepo), so
 * resident bash/read is safe for “write a python script” without requiring
 * magic keywords. Creative product tools stay resident for commerce defaults.
 * Heavy packs (Shopify, Computer Use, capture, PDF extract, browser
 * automation) remain lazy via intent or wodeappx_list_capabilities.
 */

/** OpenCode workspace / Codex+Cursor coding-agent parity. */
export const WORKSPACE_RESIDENT_TOOL_IDS = [
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
] as const;

/**
 * Lean public-web lookup — Cursor WebSearch / WebFetch parity.
 * Weather, RSS, YouTube, Bilibili stay on the lazy internet pack.
 */
export const INTERNET_RESIDENT_TOOL_IDS = [
  "agent_reach_web_search",
  "agent_reach_web_read",
  "webfetch",
  "web_fetch",
  "web_search",
  "websearch",
] as const;

/** Read-side project inspection after create/publish (often needed to verify). */
export const PROJECT_READ_RESIDENT_TOOL_IDS = [
  "get_project",
  "list_projects",
  "list_pages",
  "get_page",
] as const;

/**
 * High-frequency creative / commerce tool *names* for capability routing
 * (enabledTools + system packs). Progressive disclosure: OpenCode Direct stays
 * coding/web only; these remain Deferred until tool_search or capability-pack
 * sticky preload. Keep descriptions short; field details via wodeapp_get_tool_docs.
 */
export const CREATIVE_CORE_RESIDENT_TOOL_IDS = [
  "wodeappx_search_tools",
  "wodeappx_list_capabilities",
  "wodeapp_get_tool_docs",
  "wodeapp_assets_list",
  "wodeapp_product_save",
  "wodeapp_image_asset_save",
  "wodeapp_brand_save",
  "wodeapp_prompt_save",
  "wodeapp_generation_history_save",
  "wodeapp_batch_image_prepare",
  "product_visual_batch_image_run",
  "ai_generate_image",
  "image_inspect",
  "openwork_media_view",
  "image_collage",
  "video_generate",
  "video_task_status",
  "wodeapp_video_storyboard_open",
  "wodeapp_video_storyboard_update",
  "wodeapp_video_template_render",
  "openwork_ui_execute_action",
  "openwork_ui_list_actions",
  "create_project",
  "create_page",
  "update_page",
  "wodeapp_page_import_from_file",
  "publish_project",
  ...PROJECT_READ_RESIDENT_TOOL_IDS,
] as const;

/** Union mounted on every substantive turn. */
export const SUBSTANTIVE_RESIDENT_TOOL_IDS = [
  ...CREATIVE_CORE_RESIDENT_TOOL_IDS,
  ...WORKSPACE_RESIDENT_TOOL_IDS,
  ...INTERNET_RESIDENT_TOOL_IDS,
] as const;

/** @deprecated Use CREATIVE_CORE_RESIDENT_TOOL_IDS — kept for tests and imports. */
export const CREATIVE_CORE_TOOL_IDS = CREATIVE_CORE_RESIDENT_TOOL_IDS;

/**
 * Heavy / niche packs — mount on explicit intent or discover, not resident.
 * `workspace` tools are resident; the capability id remains for system-pack hints.
 * `internet` niche tools (weather/rss/…) stay lazy; lean web search is resident.
 */
export const LAZY_CAPABILITY_IDS = [
  "browser",
  "desktop",
  "shopify",
  "capture",
  "files",
  "automation",
  "internet",
  "docs",
] as const;

/** Soft char budget for resident routing system hints (≈ tokens/4). */
export const CREATIVE_CORE_SYSTEM_PROMPT_CHAR_BUDGET = 6_000;

export function estimateTokenBudgetFromChars(charCount: number): number {
  return Math.ceil(charCount / 4);
}
