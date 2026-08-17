import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";
import { homedir, platform, tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { z } from "zod";
import WodeAppXShopify from "./wodeappx-shopify.js";
import {
  asToolResultJson,
  assertToolResultSucceeded,
  createToolItemFailure,
  executeWithContract,
  finalizeUiBridgeError,
  ToolItemFailure,
} from "./openwork-tool-result.js";
import {
  WODEAPP_DIRECT_ACTION_CONTRACT_BY_TOOL_NAME,
  modelFacingDirectActionInputSchema,
} from "./wodeapp-direct-action-contracts.js";
import {
  assertUiActionInvocation,
  buildUiExecuteActionJsonSchema,
  buildWodeAppDirectTools,
  modelVisibleUiActions,
} from "./wodeapp-direct-tools.js";
import { buildReadMediaGateHooks } from "./wodeapp-read-media-gate.js";
import { buildStubCallGateHooks } from "./wodeapp-stub-call-gate.js";
import { buildWodeAppKnowledgeSearchTool } from "./wodeapp-knowledge-search.js";
import { recordXlsExtractionOutcome } from "./wodeapp-xls-save-gate.js";
import {
  computerUseBackendFailureHint,
  computerUseBackendRequest,
  resolveComputerUseBackend,
} from "./computer-use-backend.js";
import { buildContextReadbackPlan } from "./wodeapp-context-artifacts.js";

type OpenCodeContext = {
  agent?: string;
  sessionID?: string;
  messageID?: string;
  directory?: string;
  worktree?: string;
};

type OpenCodePluginInput = {
  client?: {
    session?: {
      messages?: (input: { path: { id: string } }) => Promise<unknown>;
    };
  };
};

type ExtensionActionPayload = {
  extensionId: string;
  action: string;
  args: Record<string, unknown>;
  context: ReturnType<typeof contextPayload>;
};

const listActionsArgsSchema = z.object({
  extensionId: z.string().optional().describe("Optional extension id to filter by, such as google-workspace."),
});

const callArgsSchema = z.object({
  extensionId: z.string().describe("Extension id, such as google-workspace."),
  action: z.string().describe("Action id from openwork_extension_list_actions."),
  args: z.record(z.string(), z.unknown()).optional().describe("JSON arguments for the action."),
});

const uiExecuteArgsSchema = z.object({
  actionId: z.string().describe("A live UI action id allowed by this tool's runtime schema."),
  args: z.record(z.string(), z.unknown()).optional().describe("JSON arguments for the action, if required."),
});

const browserOpenUrlArgsSchema = z.object({
  url: z.string().describe("The website URL to open in the WodeAppX built-in browser."),
  provider: z.enum(["auto", "builtin", "external"]).optional().describe("Browser provider. Use builtin or auto; external is reserved for future support."),
});

const browserSetProxyArgsSchema = z.object({
  proxy: z.string().describe("Proxy URL like http://user:pass@host:8080 or socks5://host:1080. Prefer env:NAME (resolves the OPENWORK_BROWSER_PROXY_NAME environment variable on the user's machine) so credentials never enter the conversation."),
});

const captureListArgsSchema = z.object({
  kind: z.enum(["all", "image", "video", "audio", "json"]).optional().describe("Optional media kind filter. Use all or omit it to return every kind."),
  limit: z.number().int().min(1).max(100).optional().describe("Maximum number of captured items to return."),
  includeHeaders: z.boolean().optional().describe("Include captured request headers for download reproduction. Defaults to false."),
});

const localImagePathSchema = z.string().min(1).describe("Absolute path, ~/ path, or workspace-relative path to a local raster image.");
const localImageOutputPathSchema = z.string().min(1).describe("Destination path for a PNG, JPEG, or WebP image. Relative paths resolve from the workspace.");
const localImageDimensionSchema = z.number().int().min(1).max(16_384);
const localImageQualitySchema = z.number().int().min(1).max(100).optional().describe("JPEG/WebP quality from 1 to 100. Defaults to 90.");
const localImageWriteSchema = {
  outputPath: localImageOutputPathSchema,
  overwrite: z.boolean().optional().describe("Allow replacing an existing output file. Defaults to false."),
  quality: localImageQualitySchema,
};

const imageInspectArgsSchema = z.object({
  path: localImagePathSchema,
});

const mediaViewSourceSchema = z.string().min(1).describe(
  "Local raster path, https:// image URL, or image-proxy path (e.g. /runtime-server/api/image-proxy/<id> or https://wodeapp.cn/runtime-server/api/image-proxy/<id>). Prefer this for generated-image QA.",
);

const openworkMediaViewArgsSchema = z.object({
  path: mediaViewSourceSchema,
  maxEdge: z.number().int().min(256).max(1536).optional()
    .describe("Longest edge in pixels for the current-turn preview. Defaults to 1280 (capped 1536 to stay under durable part size)."),
  quality: z.number().int().min(40).max(90).optional()
    .describe("JPEG quality for the current-turn preview. Defaults to 70."),
});

const imageCropArgsSchema = z.object({
  path: localImagePathSchema,
  x: z.number().int().min(0).describe("Left crop coordinate in source pixels."),
  y: z.number().int().min(0).describe("Top crop coordinate in source pixels."),
  width: localImageDimensionSchema.describe("Crop width in pixels."),
  height: localImageDimensionSchema.describe("Crop height in pixels."),
  ...localImageWriteSchema,
});

const imageResizeArgsSchema = z.object({
  path: localImagePathSchema,
  width: localImageDimensionSchema.optional().describe("Output width. When height is omitted, preserves aspect ratio."),
  height: localImageDimensionSchema.optional().describe("Output height. When width is omitted, preserves aspect ratio."),
  fit: z.enum(["contain", "cover", "fill"]).optional().describe("contain preserves all pixels, cover fills and center-crops, fill stretches. Defaults to contain."),
  background: z.string().optional().describe("Canvas background color used by contain, such as #ffffff or transparent. Defaults to transparent for PNG/WebP and white for JPEG."),
  ...localImageWriteSchema,
});

const imageRotateFlipArgsSchema = z.object({
  path: localImagePathSchema,
  degrees: z.enum(["0", "90", "180", "270"]).optional().describe("Clockwise rotation. Defaults to 0."),
  flipHorizontal: z.boolean().optional().describe("Mirror left to right."),
  flipVertical: z.boolean().optional().describe("Mirror top to bottom."),
  ...localImageWriteSchema,
});

const imageCollageInputSchema = z.object({
  path: localImagePathSchema,
  label: z.string().max(120).optional().describe("Optional caption rendered below this image."),
});

const imageCollageArgsSchema = z.object({
  images: z.array(imageCollageInputSchema).min(2).max(36).describe("Images in the exact order they should appear."),
  layout: z.enum(["grid", "horizontal", "vertical"]).optional().describe("Layout mode. Defaults to grid."),
  columns: z.number().int().min(1).max(12).optional().describe("Grid column count. Defaults to a balanced square-like grid."),
  cellWidth: localImageDimensionSchema.optional().describe("Width of each image cell. Defaults to the widest input, capped at 1600."),
  cellHeight: localImageDimensionSchema.optional().describe("Height of each image cell. Defaults to the tallest input, capped at 1600."),
  fit: z.enum(["contain", "cover"]).optional().describe("contain preserves every source pixel; cover center-crops. Defaults to contain."),
  gap: z.number().int().min(0).max(512).optional().describe("Gap between cells in pixels. Defaults to 24."),
  padding: z.number().int().min(0).max(1024).optional().describe("Outer padding in pixels. Defaults to 24."),
  background: z.string().optional().describe("Canvas and cell background color. Defaults to #ffffff."),
  labelColor: z.string().optional().describe("Caption text color. Defaults to #111827."),
  labelHeight: z.number().int().min(24).max(240).optional().describe("Caption area height when any label is present. Defaults to 56."),
  ...localImageWriteSchema,
});

const imageCompositeOverlaySchema = z.object({
  path: localImagePathSchema,
  x: z.number().int().describe("Overlay left coordinate in base-image pixels."),
  y: z.number().int().describe("Overlay top coordinate in base-image pixels."),
  width: localImageDimensionSchema.optional().describe("Optional rendered width. Preserves aspect ratio when height is omitted."),
  height: localImageDimensionSchema.optional().describe("Optional rendered height. Preserves aspect ratio when width is omitted."),
  opacity: z.number().min(0).max(1).optional().describe("Overlay opacity from 0 to 1. Defaults to 1."),
});

const imageCompositeArgsSchema = z.object({
  path: localImagePathSchema.describe("Base image path."),
  overlays: z.array(imageCompositeOverlaySchema).min(1).max(36).describe("Overlays rendered in array order; later items appear on top."),
  ...localImageWriteSchema,
});

const localFileExtractTextArgsSchema = z.object({
  path: z.string().describe("Absolute path, ~/ path, or workspace-relative path to a local non-PDF document."),
  offset: z.number().int().min(0).optional().describe("Character offset for continuing a long document. Defaults to 0."),
  maxChars: z.number().int().min(1_000).max(24_000).optional().describe("Maximum characters to return. Defaults to 20,000."),
});

const attachmentContextReadArgsSchema = z.object({
  refId: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/).describe("Exact contextRefId from an attachment history stub."),
  offset: z.number().int().min(0).optional().describe("Character offset for continuing a long context pack. Defaults to 0."),
  maxChars: z.number().int().min(1_000).max(24_000).optional().describe("Maximum context characters to return. Defaults to 20,000."),
});

const localFilePreviewArgsSchema = z.object({
  path: z.string().describe("Absolute path, ~/ path, or workspace-relative path to a local PDF, Office document, image, audio, or video."),
  size: z.number().int().min(256).max(2400).optional().describe("Quick Look thumbnail size in pixels. Defaults to 1400."),
});

const localMediaProbeArgsSchema = z.object({
  path: z.string().describe("Absolute path, ~/ path, or workspace-relative path to a local image, audio, video, PDF, or Office file."),
});

const localPdfInfoArgsSchema = z.object({
  path: z.string().describe("Absolute path, ~/ path, or workspace-relative path to a local PDF."),
});

const localPdfExtractTextArgsSchema = z.object({
  path: z.string().describe("Absolute path, ~/ path, or workspace-relative path to a local PDF."),
  startPage: z.number().int().min(1).optional().describe("First page to extract, inclusive. Defaults to 1."),
  startChar: z.number().int().min(0).optional().describe("Character offset within startPage when continuing a truncated page. Defaults to 0."),
  endPage: z.number().int().min(1).optional().describe("Last page to extract, inclusive. Defaults to a five-page window from startPage."),
  maxChars: z.number().int().min(1_000).max(24_000).optional().describe("Maximum characters to return. Defaults to 20,000."),
});

const localPdfRenderPagesArgsSchema = z.object({
  path: z.string().describe("Absolute path, ~/ path, or workspace-relative path to a local PDF."),
  pages: z.array(z.number().int().min(1)).min(1).max(12).optional().describe("Page numbers to render. Defaults to the first 6 pages."),
  scale: z.number().min(0.5).max(3).optional().describe("Render scale. Defaults to 2."),
});

const localFileSearchArgsSchema = z.object({
  query: z.string().min(1).describe("File or folder name text to search for. Content is not read; results only include path metadata."),
  root: z.string().optional().describe("Optional directory to search. Defaults to the current workspace, then the user's home folder."),
  kind: z.enum(["any", "file", "folder", "image", "video", "audio", "document"]).optional().describe("Optional result type filter. Defaults to any."),
  limit: z.number().int().min(1).max(200).optional().describe("Maximum number of results. Defaults to 50."),
  includeHidden: z.boolean().optional().describe("Include hidden files and folders. Defaults to false."),
});

const localFileBatchOperationSchema = z.object({
  action: z.enum(["copy", "move", "rename", "mkdir"]).describe("Safe batch operation. Delete is intentionally unsupported."),
  source: z.string().optional().describe("Source path for copy, move, or rename. May be absolute, ~/ path, or baseDir-relative."),
  destination: z.string().describe("Destination path or directory to create. May be absolute, ~/ path, or baseDir-relative."),
  overwrite: z.boolean().optional().describe("Allow replacing an existing destination file. Defaults to false."),
});

const localFilePlanBatchArgsSchema = z.object({
  operations: z.array(localFileBatchOperationSchema).min(1).max(200).describe("Operations to preview. This does not modify files."),
  baseDir: z.string().optional().describe("Optional base directory for relative source/destination paths."),
});

const localFileApplyBatchArgsSchema = z.object({
  operations: z.array(localFileBatchOperationSchema).min(1).max(200).optional().describe("Operations returned by openwork_file_plan_batch."),
  planId: z.string().optional().describe("Plan id returned by openwork_file_plan_batch. If supplied, operations may be omitted."),
  baseDir: z.string().optional().describe("Optional base directory for relative source/destination paths."),
  confirmed: z.boolean().describe("Must be true. This prevents accidental file changes without an explicit confirmation step."),
});

const localFileOpenDirectoryArgsSchema = z.object({
  path: z.string().describe("Absolute path, ~/ path, or workspace-relative path to a local directory."),
});

const pageImportFromFileArgsSchema = z.object({
  projectId: z.string().min(1).describe("WodeApp project ID from create_project."),
  sourcePath: z
    .string()
    .min(1)
    .describe(
      "Local HTML file path (absolute, ~/, or workspace-relative). The host reads the file; never paste HTML into tool arguments.",
    ),
  pageId: z
    .string()
    .min(1)
    .optional()
    .describe("Existing page ID to update. Prefer when create_project already returned a page."),
  path: z
    .string()
    .optional()
    .describe("New page path when pageId is omitted (e.g. / or /map). Required with title when creating."),
  title: z.string().optional().describe("Page title for create, or optional title on import."),
});

const computerUseRawArgsSchema = z.object({
  tool: z.string().describe("Computer Use tool name, such as snapshot, click, type_text, press_key, scroll, list_apps, launch_app, activate_app, clipboard_read, or clipboard_write."),
  args: z.record(z.string(), z.unknown()).optional().describe("Arguments for the Computer Use tool."),
  timeoutMs: z.number().int().min(1_000).max(420_000).optional().describe("Optional timeout for long-running screenshot/setup operations."),
  includeImage: z.boolean().optional().describe("For screenshot tools, include raw base64 image data in the textual result. Defaults to false to keep responses compact."),
});

const computerUseSnapshotArgsSchema = z.object({
  app: z.string().optional().describe("Running app name or bundle id. Required on Windows/Linux. On macOS, omit for the frontmost app."),
  pid: z.number().int().optional().describe("Optional process id. Disambiguates multiple instances of the same app (macOS HandsFree)."),
  window_title: z.string().optional().describe("Optional window title to target a specific window (macOS HandsFree)."),
  strict: z.boolean().optional().describe("Keep actions on background-safe AX/postToPid paths on macOS. Default true."),
  text_limit: z.union([z.number().int().positive(), z.literal("max")]).optional().describe("Max semantic text characters for open-computer-use snapshots. Defaults to 500."),
  max_tree_nodes: z.number().int().positive().optional().describe("Max accessibility tree nodes for open-computer-use snapshots."),
  max_tree_depth: z.number().int().positive().optional().describe("Max accessibility tree depth for open-computer-use snapshots."),
  includeImage: z.boolean().optional().describe("Include raw base64 screenshot data in the returned text. Defaults to false."),
});

const computerUseClickArgsSchema = z.object({
  app: z.string().optional().describe("Target app name. Required on Windows/Linux unless a prior snapshot recorded it."),
  ref: z.string().optional().describe("Semantic ref from snapshot, e.g. {e1}. On Win/Linux maps to element_index."),
  snapshot_id: z.string().optional().describe("Optional snapshot id from the latest snapshot response (macOS HandsFree)."),
  index: z.number().int().optional().describe("Element id or zero-based compatibility index."),
  element_index: z.string().optional().describe("open-computer-use element index from get_app_state/snapshot."),
  x: z.number().optional().describe("Screenshot-image x coordinate from snapshot center.imageX."),
  y: z.number().optional().describe("Screenshot-image y coordinate from snapshot center.imageY."),
  screen_x: z.number().optional().describe("Absolute screen x coordinate. Takes precedence over x/y (macOS HandsFree)."),
  screen_y: z.number().optional().describe("Absolute screen y coordinate. Takes precedence over x/y (macOS HandsFree)."),
  click_count: z.number().int().min(1).max(2).optional().describe("1 or 2. Default 1."),
  strict: z.boolean().optional().describe("Override strict mode for this action (macOS HandsFree)."),
});

const computerUseTypeTextArgsSchema = z.object({
  app: z.string().optional().describe("Target app name. Required on Windows/Linux unless a prior snapshot recorded it."),
  text: z.string().describe("Text to type into the target process."),
  snapshot_id: z.string().optional().describe("Optional snapshot id from the latest snapshot response (macOS HandsFree)."),
  strict: z.boolean().optional().describe("Override strict mode for this action (macOS HandsFree)."),
});

const computerUsePressKeyArgsSchema = z.object({
  app: z.string().optional().describe("Target app name. Required on Windows/Linux unless a prior snapshot recorded it."),
  combo: z.string().describe("Key combo such as command+k, return, tab, or escape. Win/Linux maps command→super."),
  snapshot_id: z.string().optional().describe("Optional snapshot id from the latest snapshot response (macOS HandsFree)."),
  strict: z.boolean().optional().describe("Override strict mode for this action (macOS HandsFree)."),
});

const computerUseScrollArgsSchema = z.object({
  app: z.string().optional().describe("Target app name. Required on Windows/Linux unless a prior snapshot recorded it."),
  direction: z.enum(["up", "down", "left", "right"]).optional().describe("Scroll direction."),
  snapshot_id: z.string().optional().describe("Optional snapshot id from the latest snapshot response (macOS HandsFree)."),
  pages: z.number().optional().describe("Approximate page count. Default 1."),
  ref: z.string().optional().describe("Optional semantic ref / element target."),
  index: z.number().int().optional().describe("Optional element index."),
  element_index: z.string().optional().describe("open-computer-use element index."),
  x: z.number().optional().describe("Optional screenshot x coordinate."),
  y: z.number().optional().describe("Optional screenshot y coordinate."),
  strict: z.boolean().optional().describe("Override strict mode for this action (macOS HandsFree)."),
});

const computerUseSetValueArgsSchema = z.object({
  app: z.string().optional().describe("Target app name. Required on Windows/Linux unless a prior snapshot recorded it."),
  ref: z.string().optional().describe("Semantic ref from snapshot."),
  snapshot_id: z.string().optional().describe("Optional snapshot id from the latest snapshot response (macOS HandsFree)."),
  index: z.number().int().optional().describe("Element id or zero-based compatibility index."),
  element_index: z.string().optional().describe("open-computer-use element index."),
  value: z.string().describe("Value to set."),
});

const computerUsePerformActionArgsSchema = z.object({
  app: z.string().optional().describe("Target app name. Required on Windows/Linux unless a prior snapshot recorded it."),
  ref: z.string().optional().describe("Semantic ref from snapshot."),
  snapshot_id: z.string().optional().describe("Optional snapshot id from the latest snapshot response (macOS HandsFree)."),
  index: z.number().int().optional().describe("Element id or zero-based compatibility index."),
  element_index: z.string().optional().describe("open-computer-use element index."),
  action: z.string().optional().describe("AX / secondary action name. Default AXPress."),
});

const computerUseAppNameArgsSchema = z.object({
  name: z.string().describe("macOS app name, such as Safari, Google Chrome, Slack, or Finder."),
});

const computerUseOpenUrlArgsSchema = z.object({
  url: z.string().describe("URL to open."),
  app: z.string().optional().describe("Optional browser app name."),
});

const computerUseClipboardWriteArgsSchema = z.object({
  text: z.string().describe("Text to write to the macOS clipboard."),
});

const computerUseClipboardPasteArgsSchema = z.object({
  text: z.string().optional().describe("Optional text to write before pressing command+v. Omit to paste the current clipboard."),
  snapshot_id: z.string().optional().describe("Optional snapshot id from the latest snapshot response."),
  strict: z.boolean().optional().describe("Override strict mode for the paste key press."),
});

const chromeAppArgsSchema = z.object({
  app: z.string().optional().describe("Browser app name. Defaults to Google Chrome."),
});

const chromeOpenUrlArgsSchema = z.object({
  url: z.string().describe("URL to open in the user's real Chrome profile."),
  app: z.string().optional().describe("Browser app name. Defaults to Google Chrome."),
});

const chromeTabArgsSchema = z.object({
  windowIndex: z.number().int().min(1).describe("1-based Chrome window index from openwork_chrome_list_tabs."),
  tabIndex: z.number().int().min(1).describe("1-based tab index from openwork_chrome_list_tabs."),
  app: z.string().optional().describe("Browser app name. Defaults to Google Chrome."),
});

const chromeExecuteJavascriptArgsSchema = z.object({
  code: z.string().describe("JavaScript source to execute in the selected Chrome tab. Chrome requires View > Developer > Allow JavaScript from Apple Events."),
  windowIndex: z.number().int().min(1).optional().describe("1-based Chrome window index. Defaults to the first window."),
  tabIndex: z.number().int().min(1).optional().describe("1-based tab index. Defaults to the active tab in the selected window."),
  app: z.string().optional().describe("Browser app name. Defaults to Google Chrome."),
});

const chromeSnapshotArgsSchema = z.object({
  window_title: z.string().optional().describe("Optional Chrome window title to target."),
  strict: z.boolean().optional().describe("Keep actions on background-safe AX/postToPid paths. Default true."),
  includeImage: z.boolean().optional().describe("Include raw base64 screenshot data in the returned text. Defaults to false."),
});

const agentReachWebSearchArgsSchema = z.object({
  query: z.string().min(1).describe("Search query for current public web information."),
  limit: z.number().int().min(1).max(8).optional().describe("Maximum search results. Defaults to 5. Hard max 8 to protect context."),
  freshness: z.enum(["all", "day", "week", "month", "year"]).optional().describe("Optional freshness filter. Defaults to all."),
  region: z.string().optional().describe("DuckDuckGo region code, such as cn-zh or us-en. Inferred from the query when omitted."),
});

const agentReachWeatherArgsSchema = z.object({
  location: z.string().min(1).describe("City or place name, such as 杭州, Shanghai, or Paris."),
  forecastDays: z.number().int().min(1).max(7).optional().describe("Number of forecast days. Defaults to 3."),
  countryCode: z.string().length(2).optional().describe("Optional ISO 3166-1 alpha-2 country code to disambiguate the place, such as CN or US."),
  language: z.string().optional().describe("Geocoding result language. Defaults to zh."),
});

const agentReachWebReadArgsSchema = z.object({
  url: z.string().describe("Public http(s) URL to read through Jina Reader first, then direct fetch fallback."),
  maxChars: z.number().int().min(500).max(24_000).optional().describe("Maximum characters returned inline. Defaults to 6,000. Larger pages spill to a local pack for on-demand re-read."),
});

const agentReachRssReadArgsSchema = z.object({
  url: z.string().describe("Public RSS or Atom feed URL."),
  limit: z.number().int().min(1).max(50).optional().describe("Maximum feed items to return. Defaults to 10."),
});

const agentReachYoutubeTranscriptArgsSchema = z.object({
  url: z.string().describe("Public YouTube video URL."),
  languages: z.array(z.string()).optional().describe("Preferred transcript language codes in order. Defaults to zh-Hans, zh, en."),
  maxChars: z.number().int().min(500).max(40_000).optional().describe("Maximum transcript characters to return. Defaults to 8,000."),
});

const localVideoResolveArgsSchema = z.object({
  input: z.string().min(1).describe("Video URL, video id, or share text containing a public video URL."),
  followRedirects: z.boolean().optional().describe("Resolve public short-link redirects locally. Defaults to true when an id is not already present."),
});

const localVideoExtractMetadataArgsSchema = z.object({
  url: z.string().min(1).describe("Canonical or public video URL returned by video_resolve_link."),
  includeDescription: z.boolean().optional().describe("Include a bounded description field. Defaults to true."),
});
const agentReachBilibiliSearchArgsSchema = z.object({
  query: z.string().min(1).describe("Bilibili video search keyword."),
  limit: z.number().int().min(1).max(30).optional().describe("Maximum search results to return. Defaults to 10."),
});

const agentReachV2exArgsSchema = z.object({
  action: z.enum(["hot", "node", "topic", "user"]).describe("V2EX read action."),
  nodeName: z.string().optional().describe("Node name when action=node, such as tech, python, jobs."),
  topicId: z.number().int().optional().describe("Topic id when action=topic."),
  username: z.string().optional().describe("Username when action=user."),
  limit: z.number().int().min(1).max(50).optional().describe("Maximum topics or replies to return. Defaults to 20."),
});

const OPENWORK_EXTENSION_DISCOVERY_INSTRUCTION =
  "List extension actions only when the requested capability is not already exposed, then call the matching action.";

const OPENWORK_UI_CONTROL_INSTRUCTION =
  "Stable business operations use direct typed tools. This generic executor is only for actions currently exposed by the WodeAppX UI registry.";

const OPENWORK_VISUAL_AUTOMATION_INSTRUCTION =
  "Inspect the relevant browser tab, screen, or named app before acting. Prefer semantic targets and the smallest reversible action.";

const AGENT_REACH_INTERNET_INSTRUCTION =
  "Use agent_reach_weather for weather and agent_reach_web_search for other current public information. Verify important claims with source pages and do not claim live information is unavailable before trying an enabled tool.";

// ── UI control bridge discovery ──

type UiBridge = { baseUrl: string; token: string };
let cachedBridge: UiBridge | null = null;
let cachedBridgeAt = 0;
const BRIDGE_CACHE_MS = 2_000;
const BRIDGE_TIMEOUT_MS = 5_000;
const BRIDGE_EXECUTE_TIMEOUT_MS = 10 * 60_000;
const BRIDGE_HEALTH_TIMEOUT_MS = 800;
const BRIDGE_REQUEST_ATTEMPTS = 4;
const BRIDGE_RETRY_DELAY_MS = 400;

function userAppDataDir(): string {
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support");
  if (platform() === "win32") return process.env.APPDATA || join(homedir(), "AppData", "Roaming");
  return process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
}

function uiControlDiscoveryPaths(): string[] {
  return [
    process.env.OPENWORK_UI_CONTROL_DISCOVERY?.trim(),
    join(userAppDataDir(), "com.differentai.openwork", "openwork-ui-control.json"),
    join(userAppDataDir(), "com.differentai.openwork.dev", "openwork-ui-control.json"),
  ].filter((p): p is string => Boolean(p));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBridgeConnectivityError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /unable to connect|econnrefused|econnreset|enetunreach|fetch failed|other side closed|socket|timed out|timeout|abort/i.test(message);
}

export async function probeUiBridgeHealth(bridge: UiBridge, timeoutMs = BRIDGE_HEALTH_TIMEOUT_MS): Promise<boolean> {
  try {
    const response = await fetch(`${bridge.baseUrl}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return false;
    const payload = await response.json().catch(() => null) as { ok?: unknown } | null;
    return payload?.ok === true;
  } catch {
    return false;
  }
}

function clearUiBridgeCache(): void {
  cachedBridge = null;
  cachedBridgeAt = 0;
}

export async function discoverUiBridge(options: {
  force?: boolean;
  requireHealthy?: boolean;
  discoveryPaths?: readonly string[];
} = {}): Promise<UiBridge | null> {
  const requireHealthy = options.requireHealthy !== false;
  if (!options.force && cachedBridge && Date.now() - cachedBridgeAt < BRIDGE_CACHE_MS) {
    if (!requireHealthy || await probeUiBridgeHealth(cachedBridge)) return cachedBridge;
    clearUiBridgeCache();
  }

  for (const candidate of options.discoveryPaths ?? uiControlDiscoveryPaths()) {
    try {
      const raw = await readFile(candidate, "utf8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.baseUrl !== "string" || typeof parsed.token !== "string") continue;
      const bridge = { baseUrl: parsed.baseUrl, token: parsed.token };
      if (requireHealthy && !(await probeUiBridgeHealth(bridge))) continue;
      cachedBridge = bridge;
      cachedBridgeAt = Date.now();
      return cachedBridge;
    } catch {
      // Try next discovery path.
    }
  }
  return null;
}

async function uiBridgeFetch(path: string, bridge: UiBridge, options: { method?: string; body?: unknown; timeoutMs?: number }): Promise<unknown> {
  const response = await fetch(`${bridge.baseUrl}${path}`, {
    method: options.method || "GET",
    signal: AbortSignal.timeout(options.timeoutMs ?? BRIDGE_TIMEOUT_MS),
    headers: {
      Authorization: `Bearer ${bridge.token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const text = await response.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    if (!response.ok) throw new Error(text || `HTTP ${response.status}`);
    payload = text;
  }
  if (!response.ok) {
    throw new Error(
      getStringProperty(payload, "error")
        ?? getStringProperty(payload, "message")
        ?? `HTTP ${response.status}`,
    );
  }
  return assertToolResultSucceeded(payload, "WodeAppX UI bridge request failed.");
}

async function uiBridgeRequest(path: string, options: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<unknown> {
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= BRIDGE_REQUEST_ATTEMPTS; attempt += 1) {
    const bridge = await discoverUiBridge({ force: attempt > 1, requireHealthy: true });
    if (!bridge) {
      lastError = createToolItemFailure({
        message: "WodeAppX UI bridge not available. The desktop app may not be running or its control port is stale.",
        recoverable: true,
        errorKind: "dependency",
      });
      if (attempt < BRIDGE_REQUEST_ATTEMPTS) {
        await sleep(BRIDGE_RETRY_DELAY_MS * attempt);
        continue;
      }
      break;
    }
    try {
      return await uiBridgeFetch(path, bridge, options);
    } catch (error) {
      lastError = error;
      clearUiBridgeCache();
      // Validation / domain ToolItemFailure will not heal by rediscovering the bridge.
      if (error instanceof ToolItemFailure) break;
      if (!isBridgeConnectivityError(error) || attempt >= BRIDGE_REQUEST_ATTEMPTS) break;
      await sleep(BRIDGE_RETRY_DELAY_MS * attempt);
    }
  }
  finalizeUiBridgeError(lastError);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function recordProperty(value: unknown, key: string): Record<string, unknown> | null {
  const property = asRecord(value)[key];
  return typeof property === "object" && property !== null && !Array.isArray(property) ? property as Record<string, unknown> : null;
}

function formatBytes(value: unknown): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatCaptureStatus(result: unknown): string {
  const data = asRecord(result);
  const proxy = recordProperty(data, "proxy");
  const engine = recordProperty(data, "engine");
  const httpsAuth = recordProperty(data, "httpsAuth");
  const error = getStringProperty(data, "error");
  const setupHint = getStringProperty(data, "setupHint");
  const lines = [
    `Capture: ${data.running ? "running" : "stopped"}`,
    `Source: ${getStringProperty(data, "source") || "system-proxy"}`,
  ];
  if (proxy) {
    const host = getStringProperty(proxy, "host");
    const port = proxy.port === undefined ? "" : String(proxy.port);
    if (host || port) lines.push(`Proxy: ${host || "localhost"}${port ? `:${port}` : ""}`);
  }
  if (engine) {
    const name = getStringProperty(engine, "name");
    const mode = getStringProperty(engine, "mode");
    const upstream = getStringProperty(engine, "upstream");
    if (name) lines.push(`Engine: ${name}${mode ? ` (${mode})` : ""}`);
    if (upstream) lines.push(`Upstream proxy: ${upstream}`);
  }
  if (httpsAuth) {
    const status = getStringProperty(httpsAuth, "status");
    const message = getStringProperty(httpsAuth, "message");
    const caPath = getStringProperty(httpsAuth, "caPath");
    if (status) lines.push(`HTTPS auth: ${status}`);
    if (message) lines.push(`HTTPS message: ${message}`);
    if (caPath) lines.push(`CA file: ${caPath}`);
  }
  if (Array.isArray(data.items)) lines.push(`Items: ${data.items.length}`);
  if (error) lines.push(`Error: ${error}`);
  if (setupHint) lines.push(`Hint: ${setupHint}`);
  return lines.join("\n");
}

function formatCaptureItem(item: unknown, index: number, options: { includeHeaders?: boolean } = {}): string {
  const data = asRecord(item);
  const url = getStringProperty(data, "url") || "";
  const size = formatBytes(data.sizeBytes);
  const lines = [
    `${index + 1}. ${getStringProperty(data, "kind") || "media"} ${getStringProperty(data, "filename") || url}`,
    `   URL: ${url}`,
    `   Host: ${getStringProperty(data, "host") || ""}${size ? ` | Size: ${size}` : ""}${getStringProperty(data, "mime") ? ` | MIME: ${getStringProperty(data, "mime")}` : ""}`,
  ];
  const referrer = getStringProperty(data, "referrer");
  if (referrer) lines.push(`   Referrer: ${referrer}`);
  if (options.includeHeaders && data.requestHeaders) {
    lines.push(`   Request headers: ${JSON.stringify(data.requestHeaders).slice(0, 4000)}`);
  }
  return lines.join("\n");
}

function captureItemsPath(kind?: string, limit?: number): string {
  const params = new URLSearchParams();
  if (kind) params.set("kind", kind);
  if (limit) params.set("limit", String(limit));
  return `/capture/items${params.size ? `?${params.toString()}` : ""}`;
}

function parsedComputerUseText(content: unknown[]): unknown {
  const textPart = content.find((item) => getStringProperty(item, "type") === "text");
  const text = getStringProperty(textPart, "text");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function computerUseToolResult(result: unknown, options: { includeImage?: boolean } = {}): string {
  const data = asRecord(result);
  const content = Array.isArray(data.content) ? data.content : [];
  const image = content.find((item) => getStringProperty(item, "type") === "image");
  const parsedResult = parsedComputerUseText(content) ?? data;
  assertToolResultSucceeded(data, "Computer Use failed.");
  assertToolResultSucceeded(parsedResult, "Computer Use failed.");
  const payload: Record<string, unknown> = {
    ok: true,
    backend: resolveComputerUseBackend(),
    tool: getStringProperty(data, "tool"),
    result: parsedResult,
  };
  if (image) {
    payload.image = options.includeImage
      ? image
      : {
          mimeType: getStringProperty(image, "mimeType") ?? "image/png",
          omitted: "Set includeImage=true to include raw base64 screenshot data.",
        };
  }
  return asToolResultJson(payload);
}

async function runComputerUseTool(tool: string, args: Record<string, unknown> = {}, options: { timeoutMs?: number; includeImage?: boolean } = {}): Promise<string> {
  try {
    const result = await computerUseBackendRequest(tool, args, { timeoutMs: options.timeoutMs });
    return computerUseToolResult(result, { includeImage: options.includeImage });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message} ${computerUseBackendFailureHint()}`);
  }
}

type ProcessResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

function runProcess(command: string, args: string[], options: { timeoutMs?: number } = {}): Promise<ProcessResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      rejectPromise(new Error(`${command} timed out.`));
    }, options.timeoutMs ?? 15_000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise({ code, signal, stdout, stderr });
    });
  });
}

async function runJxa(script: string, args: string[] = [], options: { timeoutMs?: number } = {}): Promise<unknown> {
  if (platform() !== "darwin") {
    return { ok: false, error: "User Chrome profile tools are only available on macOS." };
  }
  try {
    const result = await runProcess("/usr/bin/osascript", ["-l", "JavaScript", "-e", script, "--", ...args], {
      timeoutMs: options.timeoutMs ?? 15_000,
    });
    const output = result.stdout.trim();
    if (result.code !== 0) {
      return { ok: false, error: result.stderr.trim() || output || `osascript exited with ${result.code}` };
    }
    try {
      return JSON.parse(output);
    } catch {
      return { ok: true, output };
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function chromeAppName(app?: string): string {
  const trimmed = app?.trim();
  if (!trimmed) return "Google Chrome";
  if (trimmed.toLowerCase() === "chrome") return "Google Chrome";
  return trimmed;
}

function asJsonText(value: unknown): string {
  return asToolResultJson(value);
}

function isPrivateIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const [a, b] = match.slice(1).map((part) => Number(part));
  return a === 10
    || a === 127
    || a === 0
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168);
}

function assertPublicHttpUrl(rawUrl: string): URL {
  const trimmed = rawUrl.trim();
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only public http(s) URLs are supported.");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host === "metadata.google.internal") {
    throw new Error("Internal host is not allowed.");
  }
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:") || isPrivateIpv4(host)) {
    throw new Error("Private or local IP address is not allowed.");
  }
  return url;
}

function stripHtmlToText(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function xmlDecode(input: string): string {
  return stripHtmlToText(input
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCharCode(parseInt(code, 16))));
}

async function fetchTextWithTimeout(url: string, options: { timeoutMs?: number; headers?: Record<string, string> } = {}): Promise<{ text: string; status: number; contentType: string }> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; WodeAppX-AgentReach/0.1)",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      ...options.headers,
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  return { text, status: response.status, contentType: response.headers.get("content-type") || "" };
}

async function probeCommand(command: string, args: string[] = ["--version"], timeoutMs = 10_000): Promise<Record<string, unknown>> {
  try {
    const result = await runProcess(command, args, { timeoutMs });
    return {
      command,
      installed: result.code !== null,
      ok: result.code === 0,
      code: result.code,
      output: `${result.stdout}${result.stderr}`.trim().slice(0, 1200),
    };
  } catch (error) {
    return {
      command,
      installed: false,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function agentReachStatus(): Promise<Record<string, unknown>> {
  const [agentReach, ytDlp, opencli, bili, gh, mcporter, ffmpeg] = await Promise.all([
    probeCommand("agent-reach", ["--version"]),
    probeCommand("yt-dlp", ["--version"]),
    probeCommand("opencli", ["--version"]),
    probeCommand("bili", ["--version"]),
    probeCommand("gh", ["--version"]),
    probeCommand("mcporter", ["config", "list"]),
    probeCommand("ffmpeg", ["-version"]),
  ]);
  const opencliDaemon = opencli.ok ? await probeCommand("opencli", ["daemon", "status"]) : null;
  return {
    ok: true,
    mode: "wodeappx-agent-reach-local",
    note: "Read-only public routes are built in. Login-required social platforms should use explicit user-owned Chrome/OpenCLI setup.",
    commands: { agentReach, ytDlp, opencli, opencliDaemon, bili, gh, mcporter, ffmpeg },
    builtInTools: [
      "agent_reach_web_search",
      "agent_reach_weather",
      "agent_reach_web_read",
      "agent_reach_rss_read",
      "agent_reach_youtube_transcript",
      "video_resolve_link",
      "video_extract_metadata",
      "agent_reach_bilibili_search",
      "agent_reach_v2ex",
    ],
  };
}

/** Lean search payloads (Codex/Cursor: keep discovery thin; re-fetch pages on demand). */
const WEB_SEARCH_DEFAULT_LIMIT = 5;
const WEB_SEARCH_HARD_MAX = 8;
const WEB_SEARCH_TITLE_MAX = 120;
const WEB_SEARCH_SNIPPET_MAX = 160;
const WEB_READ_DEFAULT_MAX_CHARS = 6_000;
const WEB_READ_SPILL_THRESHOLD = 4_000;
const WEB_READ_SPILL_STORE_MAX = 80_000;
const WEB_READ_PACK_ROOT = join(homedir(), ".wodeappx", "web-read-packs");
const YOUTUBE_TRANSCRIPT_DEFAULT_MAX = 8_000;

function duckDuckGoResultUrl(rawHref: string): string {
  const decoded = xmlDecode(rawHref);
  try {
    const url = new URL(decoded.startsWith("//") ? `https:${decoded}` : decoded);
    const redirected = /(^|\.)duckduckgo\.com$/i.test(url.hostname) ? url.searchParams.get("uddg") : null;
    return redirected || url.toString();
  } catch {
    return decoded;
  }
}

function parseDuckDuckGoResults(html: string, limit: number): Array<Record<string, string>> {
  const resultAnchors = [...html.matchAll(/<a\b([^>]*\bclass=["'][^"']*\bresult__a\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi)];
  const results: Array<Record<string, string>> = [];
  for (let index = 0; index < resultAnchors.length && results.length < limit; index += 1) {
    const match = resultAnchors[index];
    const attributes = match[1];
    const href = /\bhref=["']([^"']+)["']/i.exec(attributes)?.[1] || "";
    const url = duckDuckGoResultUrl(href);
    if (!/^https?:\/\//i.test(url)) continue;
    const start = (match.index ?? 0) + match[0].length;
    const end = resultAnchors[index + 1]?.index ?? html.length;
    const resultTail = html.slice(start, end);
    const snippetHtml = /<(?:a|div)\b[^>]*\bclass=["'][^"']*\bresult__snippet\b[^"']*["'][^>]*>([\s\S]*?)<\/(?:a|div)>/i.exec(resultTail)?.[1] || "";
    let domain = "";
    try { domain = new URL(url).hostname; } catch { /* Keep an empty domain. */ }
    const title = truncateText(xmlDecode(match[2]).replace(/\s+/g, " ").trim(), WEB_SEARCH_TITLE_MAX).text;
    const snippet = truncateText(xmlDecode(snippetHtml).replace(/\s+/g, " ").trim(), WEB_SEARCH_SNIPPET_MAX).text;
    results.push({
      title,
      url,
      domain,
      snippet,
    });
  }
  return results;
}

async function agentReachWebSearch(rawArgs: z.infer<typeof agentReachWebSearchArgsSchema>): Promise<Record<string, unknown>> {
  const limit = Math.min(rawArgs.limit ?? WEB_SEARCH_DEFAULT_LIMIT, WEB_SEARCH_HARD_MAX);
  const params = new URLSearchParams({
    q: rawArgs.query,
    kl: rawArgs.region?.trim() || (/[^\u0000-\u00ff]/.test(rawArgs.query) ? "cn-zh" : "wt-wt"),
  });
  const freshness = rawArgs.freshness;
  const freshnessCode = freshness && freshness !== "all"
    ? ({ day: "d", week: "w", month: "m", year: "y" } as const)[freshness]
    : undefined;
  if (freshnessCode) params.set("df", freshnessCode);
  const response = await fetchTextWithTimeout(`https://html.duckduckgo.com/html/?${params.toString()}`, {
    timeoutMs: 25_000,
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  const results = parseDuckDuckGoResults(response.text, limit);
  return {
    ok: results.length > 0,
    backend: "DuckDuckGo HTML",
    query: rawArgs.query,
    searchedAt: new Date().toISOString(),
    resultCount: results.length,
    results,
    ...(results.length ? {} : { error: "The search provider returned no parseable results. Try a broader query or the built-in browser." }),
  };
}

function weatherCodeLabel(rawCode: unknown): string {
  const code = Number(rawCode);
  if (code === 0) return "晴 / Clear sky";
  if (code === 1) return "大部晴朗 / Mainly clear";
  if (code === 2) return "局部多云 / Partly cloudy";
  if (code === 3) return "阴 / Overcast";
  if ([45, 48].includes(code)) return "雾 / Fog";
  if ([51, 53, 55, 56, 57].includes(code)) return "毛毛雨 / Drizzle";
  if ([61, 63, 65, 66, 67].includes(code)) return "雨 / Rain";
  if ([71, 73, 75, 77].includes(code)) return "雪 / Snow";
  if ([80, 81, 82].includes(code)) return "阵雨 / Rain showers";
  if ([85, 86].includes(code)) return "阵雪 / Snow showers";
  if ([95, 96, 99].includes(code)) return "雷暴 / Thunderstorm";
  return `未知天气代码 / Unknown weather code (${Number.isFinite(code) ? code : "n/a"})`;
}

function weatherSeriesValue(series: Record<string, unknown>, key: string, index: number): unknown {
  const values = series[key];
  return Array.isArray(values) ? values[index] : undefined;
}

async function agentReachWeather(rawArgs: z.infer<typeof agentReachWeatherArgsSchema>): Promise<Record<string, unknown>> {
  const language = rawArgs.language?.trim() || "zh";
  const geocodingParams = new URLSearchParams({
    name: rawArgs.location,
    count: "8",
    language,
    format: "json",
  });
  const geocodingUrl = `https://geocoding-api.open-meteo.com/v1/search?${geocodingParams.toString()}`;
  const geocoding = asRecord(await getJsonWithTimeout(geocodingUrl));
  const candidates = (Array.isArray(geocoding.results) ? geocoding.results : [])
    .map((item) => asRecord(item))
    .filter((item) => typeof item.latitude === "number" && typeof item.longitude === "number");
  const countryCode = rawArgs.countryCode?.trim().toUpperCase();
  const place = (countryCode ? candidates.find((item) => String(item.country_code || "").toUpperCase() === countryCode) : null) || candidates[0];
  if (!place) {
    return { ok: false, location: rawArgs.location, error: "Location was not found by Open-Meteo geocoding.", source: geocodingUrl };
  }

  const forecastDays = rawArgs.forecastDays ?? 3;
  const forecastParams = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    timezone: "auto",
    forecast_days: String(forecastDays),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    hourly: "temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,sunrise,sunset,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max",
  });
  const forecastUrl = `https://api.open-meteo.com/v1/forecast?${forecastParams.toString()}`;
  const forecast = asRecord(await getJsonWithTimeout(forecastUrl));
  const current = asRecord(forecast.current);
  const hourly = asRecord(forecast.hourly);
  const daily = asRecord(forecast.daily);
  const dailyTimes = Array.isArray(daily.time) ? daily.time : [];
  const hourlyTimes = Array.isArray(hourly.time) ? hourly.time : [];
  const currentTime = typeof current.time === "string" ? current.time : "";
  const firstHourlyIndex = Math.max(0, hourlyTimes.findIndex((time) => String(time) >= currentTime));
  const next24Hours = hourlyTimes.slice(firstHourlyIndex, firstHourlyIndex + 24).map((time, offset) => {
    const index = firstHourlyIndex + offset;
    const weatherCode = weatherSeriesValue(hourly, "weather_code", index);
    return {
      time,
      temperature: weatherSeriesValue(hourly, "temperature_2m", index),
      precipitationProbability: weatherSeriesValue(hourly, "precipitation_probability", index),
      condition: weatherCodeLabel(weatherCode),
    };
  });
  const dailyForecast = dailyTimes.map((time, index) => {
    const weatherCode = weatherSeriesValue(daily, "weather_code", index);
    return {
      date: time,
      weatherCode,
      condition: weatherCodeLabel(weatherCode),
      temperatureMax: weatherSeriesValue(daily, "temperature_2m_max", index),
      temperatureMin: weatherSeriesValue(daily, "temperature_2m_min", index),
      apparentTemperatureMax: weatherSeriesValue(daily, "apparent_temperature_max", index),
      apparentTemperatureMin: weatherSeriesValue(daily, "apparent_temperature_min", index),
      precipitationProbabilityMax: weatherSeriesValue(daily, "precipitation_probability_max", index),
      precipitationSum: weatherSeriesValue(daily, "precipitation_sum", index),
      windSpeedMax: weatherSeriesValue(daily, "wind_speed_10m_max", index),
      windGustsMax: weatherSeriesValue(daily, "wind_gusts_10m_max", index),
      sunrise: weatherSeriesValue(daily, "sunrise", index),
      sunset: weatherSeriesValue(daily, "sunset", index),
    };
  });

  return {
    ok: true,
    backend: "Open-Meteo",
    requestedLocation: rawArgs.location,
    resolvedLocation: {
      name: place.name,
      admin1: place.admin1,
      admin2: place.admin2,
      country: place.country,
      countryCode: place.country_code,
      latitude: place.latitude,
      longitude: place.longitude,
      timezone: place.timezone || forecast.timezone,
    },
    answerReadySummary: {
      observedAt: current.time,
      condition: weatherCodeLabel(current.weather_code),
      temperatureCelsius: current.temperature_2m,
      apparentTemperatureCelsius: current.apparent_temperature,
      relativeHumidityPercent: current.relative_humidity_2m,
      precipitationMm: current.precipitation,
      windSpeedKmh: current.wind_speed_10m,
    },
    current: {
      time: current.time,
      temperatureCelsius: current.temperature_2m,
      apparentTemperatureCelsius: current.apparent_temperature,
      relativeHumidityPercent: current.relative_humidity_2m,
      precipitationMm: current.precipitation,
      weatherCode: current.weather_code,
      condition: weatherCodeLabel(current.weather_code),
      cloudCoverPercent: current.cloud_cover,
      windSpeedKmh: current.wind_speed_10m,
      windDirectionDegrees: current.wind_direction_10m,
      windGustsKmh: current.wind_gusts_10m,
    },
    units: { temperature: "°C", precipitation: "mm", windSpeed: "km/h", probability: "%" },
    dailyForecast,
    next24Hours,
    alternateLocations: candidates.slice(1, 3).map((item) => ({
      name: item.name,
      admin1: item.admin1,
      country: item.country,
      countryCode: item.country_code,
      latitude: item.latitude,
      longitude: item.longitude,
    })),
    source: { provider: "Open-Meteo", forecastUrl, geocodingUrl, retrievedAt: new Date().toISOString() },
  };
}

async function spillWebReadPack(input: {
  url: string;
  text: string;
  backend: string;
}): Promise<{ path: string; chars: number } | null> {
  try {
    await mkdir(WEB_READ_PACK_ROOT, { recursive: true });
    const hash = createHash("sha1")
      .update(`${input.url}\n${input.text.slice(0, 2048)}`)
      .digest("hex")
      .slice(0, 16);
    const filePath = join(WEB_READ_PACK_ROOT, `web_${hash}.txt`);
    const stored = input.text.length > WEB_READ_SPILL_STORE_MAX
      ? `${input.text.slice(0, WEB_READ_SPILL_STORE_MAX)}\n\n[truncated for storage at ${WEB_READ_SPILL_STORE_MAX} chars]`
      : input.text;
    const header = [
      "# WodeAppX web-read pack",
      `# url: ${input.url}`,
      `# backend: ${input.backend}`,
      `# storedAt: ${new Date().toISOString()}`,
      `# chars: ${stored.length}`,
      "",
    ].join("\n");
    await writeFile(filePath, `${header}${stored}`, "utf8");
    return { path: filePath, chars: stored.length };
  } catch {
    return null;
  }
}

async function agentReachWebRead(rawArgs: z.infer<typeof agentReachWebReadArgsSchema>): Promise<Record<string, unknown>> {
  const url = assertPublicHttpUrl(rawArgs.url);
  const maxChars = rawArgs.maxChars ?? WEB_READ_DEFAULT_MAX_CHARS;
  const jinaUrl = `https://r.jina.ai/${url.toString()}`;
  let backend = "Jina Reader";
  let contentType = "";
  let fullText = "";
  let jinaError: string | undefined;
  try {
    const jina = await fetchTextWithTimeout(jinaUrl, {
      timeoutMs: 30_000,
      headers: { Accept: "text/plain" },
    });
    contentType = jina.contentType;
    fullText = jina.text.trim();
  } catch (error) {
    backend = "direct-fetch";
    jinaError = error instanceof Error ? error.message : String(error);
    const direct = await fetchTextWithTimeout(url.toString(), { timeoutMs: 20_000 });
    contentType = direct.contentType;
    fullText = stripHtmlToText(direct.text);
  }

  const inline = truncateText(fullText, maxChars);
  const shouldSpill = inline.truncated || inline.text.length >= WEB_READ_SPILL_THRESHOLD;
  const spill = shouldSpill
    ? await spillWebReadPack({ url: url.toString(), text: fullText, backend })
    : null;
  const readback = spill
    ? buildContextReadbackPlan({
        artifactKind: "web-read spill",
        path: spill.path,
        queryHint: "the exact fact you still need",
      })
    : null;

  return {
    ok: true,
    url: url.toString(),
    backend,
    ...(jinaError ? { jinaError } : {}),
    contentType,
    text: inline.text,
    truncated: inline.truncated,
    chars: inline.chars,
    ...(spill
      ? {
          spilled: true,
          spillPath: spill.path,
          spillChars: spill.chars,
          readback,
          hint: `Inline text is capped at ${maxChars} chars (Cursor-like). ${readback?.hint}`,
        }
      : { spilled: false }),
  };
}

function firstXmlTag(block: string, tag: string): string {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block);
  return match ? xmlDecode(match[1]) : "";
}

function atomLink(block: string): string {
  const href = /<link[^>]+href=["']([^"']+)["'][^>]*>/i.exec(block)?.[1];
  if (href) return xmlDecode(href);
  return firstXmlTag(block, "link");
}

function parseFeedXml(xml: string, limit: number): Record<string, unknown> {
  const feedTitle = firstXmlTag(xml, "title");
  const itemMatches = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  const entryMatches = [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)].map((match) => match[1]);
  const blocks = (itemMatches.length ? itemMatches : entryMatches).slice(0, limit);
  const items = blocks.map((block) => ({
    title: firstXmlTag(block, "title"),
    link: atomLink(block),
    published: firstXmlTag(block, "pubDate") || firstXmlTag(block, "published") || firstXmlTag(block, "updated"),
    author: firstXmlTag(block, "author") || firstXmlTag(block, "dc:creator"),
    summary: truncateText(firstXmlTag(block, "description") || firstXmlTag(block, "summary") || firstXmlTag(block, "content"), 1000).text,
  }));
  return {
    ok: true,
    title: feedTitle,
    itemCount: items.length,
    items,
  };
}

async function agentReachRssRead(rawArgs: z.infer<typeof agentReachRssReadArgsSchema>): Promise<Record<string, unknown>> {
  const url = assertPublicHttpUrl(rawArgs.url);
  const limit = rawArgs.limit ?? 10;
  const response = await fetchTextWithTimeout(url.toString(), {
    timeoutMs: 20_000,
    headers: { Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
  });
  return {
    url: url.toString(),
    backend: "direct-feed",
    contentType: response.contentType,
    ...parseFeedXml(response.text, limit),
  };
}

function pickYoutubeCaption(info: Record<string, unknown>, languages: string[]): { language: string; url: string; ext: string } | null {
  const subtitles = asRecord(info.subtitles);
  const automatic = asRecord(info.automatic_captions);
  const stores = [subtitles, automatic];
  for (const language of languages) {
    for (const store of stores) {
      const entries = Array.isArray(store[language]) ? store[language] as Array<Record<string, unknown>> : [];
      const preferred = entries.find((entry) => getStringProperty(entry, "ext") === "json3")
        ?? entries.find((entry) => getStringProperty(entry, "ext") === "srv3")
        ?? entries.find((entry) => getStringProperty(entry, "ext") === "vtt")
        ?? entries.find((entry) => typeof entry.url === "string");
      if (preferred && typeof preferred.url === "string") {
        return {
          language,
          url: preferred.url,
          ext: getStringProperty(preferred, "ext") || "",
        };
      }
    }
  }
  for (const store of stores) {
    for (const [language, rawEntries] of Object.entries(store)) {
      const entries = Array.isArray(rawEntries) ? rawEntries as Array<Record<string, unknown>> : [];
      const entry = entries.find((item) => typeof item.url === "string");
      if (entry && typeof entry.url === "string") {
        return { language, url: entry.url, ext: getStringProperty(entry, "ext") || "" };
      }
    }
  }
  return null;
}

function parseYoutubeCaptionText(raw: string, ext: string): string {
  if (ext === "json3" || raw.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as { events?: Array<{ segs?: Array<{ utf8?: string }> }> };
      return (parsed.events || [])
        .flatMap((event) => event.segs || [])
        .map((seg) => seg.utf8 || "")
        .join("")
        .replace(/\s*\n\s*/g, "\n")
        .replace(/[ \t]+/g, " ")
        .trim();
    } catch {
      // Fall through to text cleanup.
    }
  }
  return raw
    .replace(/^WEBVTT[\s\S]*?\n\n/i, "")
    .replace(/^\d+\s*$/gm, "")
    .replace(/^\d{2}:\d{2}:\d{2}[.,]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[.,]\d{3}.*$/gm, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function agentReachYoutubeTranscript(rawArgs: z.infer<typeof agentReachYoutubeTranscriptArgsSchema>): Promise<Record<string, unknown>> {
  const url = assertPublicHttpUrl(rawArgs.url);
  if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(url.hostname)) {
    throw new Error("URL must be a YouTube video URL.");
  }
  const ytDlp = await probeCommand("yt-dlp", ["--version"]);
  if (!ytDlp.ok) {
    return {
      ok: false,
      error: "yt-dlp is not installed or not runnable.",
      installHint: "Install yt-dlp locally, then retry. Agent Reach can also install/check this dependency.",
      probe: ytDlp,
    };
  }
  const result = await runProcess("yt-dlp", [
    "--dump-single-json",
    "--skip-download",
    "--no-playlist",
    "--no-warnings",
    url.toString(),
  ], { timeoutMs: 90_000 });
  if (result.code !== 0) {
    throw new Error(result.stderr.trim() || `yt-dlp exited with ${result.code}`);
  }
  const info = JSON.parse(result.stdout) as Record<string, unknown>;
  const languages = rawArgs.languages?.length ? rawArgs.languages : ["zh-Hans", "zh", "en"];
  const caption = pickYoutubeCaption(info, languages);
  const availableLanguages = [
    ...Object.keys(asRecord(info.subtitles)),
    ...Object.keys(asRecord(info.automatic_captions)),
  ].filter((item, index, arr) => arr.indexOf(item) === index);
  if (!caption) {
    return {
      ok: true,
      url: url.toString(),
      backend: "yt-dlp",
      title: info.title,
      channel: info.channel || info.uploader,
      duration: info.duration,
      transcript: "",
      transcriptAvailable: false,
      availableLanguages,
    };
  }
  const captionText = await fetchTextWithTimeout(caption.url, { timeoutMs: 30_000 });
  return {
    ok: true,
    url: url.toString(),
    backend: "yt-dlp",
    title: info.title,
    channel: info.channel || info.uploader,
    duration: info.duration,
    captionLanguage: caption.language,
    captionExt: caption.ext,
    transcriptAvailable: true,
    availableLanguages,
    ...truncateText(parseYoutubeCaptionText(captionText.text, caption.ext), rawArgs.maxChars ?? YOUTUBE_TRANSCRIPT_DEFAULT_MAX),
  };
}

type LocalVideoPlatform = "douyin" | "kuaishou" | "bilibili" | "xiaohongshu" | "xigua" | "weibo" | "tiktok" | "youtube" | "unknown";

function firstPublicVideoUrl(input: string): URL | null {
  const match = input.match(/https?:\/\/[^\s)}\]>]+/i);
  if (!match) return null;
  return assertPublicHttpUrl(match[0].replace(/[)\]}>，。！？、；：]+$/u, ""));
}

function detectLocalVideoPlatform(url: URL): LocalVideoPlatform {
  const host = url.hostname.toLowerCase();
  if (host === "douyin.com" || host.endsWith(".douyin.com") || host === "iesdouyin.com" || host.endsWith(".iesdouyin.com")) return "douyin";
  if (host === "kuaishou.com" || host.endsWith(".kuaishou.com") || host === "gifshow.com" || host.endsWith(".gifshow.com")) return "kuaishou";
  if (host === "bilibili.com" || host.endsWith(".bilibili.com") || host === "b23.tv" || host.endsWith(".b23.tv")) return "bilibili";
  if (host === "xiaohongshu.com" || host.endsWith(".xiaohongshu.com") || host === "xhslink.com" || host.endsWith(".xhslink.com") || host === "xhs.cn") return "xiaohongshu";
  if (host === "ixigua.com" || host.endsWith(".ixigua.com") || host === "toutiao.com" || host.endsWith(".toutiao.com")) return "xigua";
  if (host === "weibo.com" || host.endsWith(".weibo.com") || host === "weibo.cn" || host.endsWith(".weibo.cn") || host === "t.cn") return "weibo";
  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "tiktok";
  if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") return "youtube";
  return "unknown";
}

function localVideoId(platform: LocalVideoPlatform, url: URL, input: string): string {
  const path = decodeURIComponent(url.pathname);
  if (platform === "douyin") return url.searchParams.get("modal_id") || /\/(?:share\/)?(?:video|note)\/(\d{15,21})/i.exec(path)?.[1] || /(\d{15,21})/.exec(input)?.[1] || "";
  if (platform === "bilibili") return /(BV[0-9A-Za-z]+|av\d+)/i.exec(path)?.[1] || url.searchParams.get("bvid") || "";
  if (platform === "youtube") return url.searchParams.get("v") || /\/(?:shorts|embed)\/([^/?]+)/i.exec(path)?.[1] || (url.hostname.toLowerCase() === "youtu.be" ? /^\/([^/]+)/.exec(path)?.[1] : "") || "";
  if (platform === "tiktok") return /\/video\/(\d+)/i.exec(path)?.[1] || "";
  if (platform === "kuaishou") return /\/(?:short-video|photo)\/([^/?]+)/i.exec(path)?.[1] || "";
  if (platform === "xiaohongshu") return /\/(?:explore|discovery\/item)\/([^/?]+)/i.exec(path)?.[1] || "";
  if (platform === "xigua") return /\/video\/(\d+)/i.exec(path)?.[1] || "";
  return "";
}

function canonicalLocalVideoUrl(platform: LocalVideoPlatform, videoId: string, resolvedUrl: URL): string {
  if (!videoId) return resolvedUrl.toString();
  if (platform === "douyin") return `https://www.douyin.com/video/${videoId}`;
  if (platform === "bilibili") return `https://www.bilibili.com/video/${videoId}`;
  if (platform === "youtube") return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  if (platform === "tiktok") return resolvedUrl.toString();
  if (platform === "kuaishou") return `https://www.kuaishou.com/short-video/${videoId}`;
  if (platform === "xiaohongshu") return `https://www.xiaohongshu.com/explore/${videoId}`;
  if (platform === "xigua") return `https://www.ixigua.com/${videoId}`;
  return resolvedUrl.toString();
}

async function followLocalVideoRedirects(initialUrl: URL): Promise<URL> {
  let current = initialUrl;
  for (let hop = 0; hop < 5; hop += 1) {
    const response = await fetch(current, {
      method: "HEAD",
      redirect: "manual",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; WodeAppX-LocalVideo/1.0)" },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status < 300 || response.status >= 400) return current;
    const location = response.headers.get("location");
    if (!location) return current;
    current = assertPublicHttpUrl(new URL(location, current).toString());
  }
  return current;
}

async function localVideoResolve(rawArgs: z.infer<typeof localVideoResolveArgsSchema>): Promise<Record<string, unknown>> {
  const original = rawArgs.input.trim();
  let url = firstPublicVideoUrl(original);
  if (!url && /^\d{15,21}$/.test(original)) url = new URL(`https://www.douyin.com/video/${original}`);
  if (!url) throw new Error("No public video URL or supported video id was found.");

  let platform = detectLocalVideoPlatform(url);
  let videoId = localVideoId(platform, url, original);
  let redirectFollowed = false;
  if (!videoId && rawArgs.followRedirects !== false) {
    const resolved = await followLocalVideoRedirects(url);
    redirectFollowed = resolved.toString() !== url.toString();
    url = resolved;
    platform = detectLocalVideoPlatform(url);
    videoId = localVideoId(platform, url, original);
  }

  return {
    ok: true,
    executor: "local",
    stage: "resolve_link",
    platform,
    videoId: videoId || null,
    originalInput: original,
    resolvedUrl: url.toString(),
    canonicalUrl: canonicalLocalVideoUrl(platform, videoId, url),
    redirectFollowed,
  };
}

function firstYtdlpMediaUrl(info: Record<string, unknown>): string {
  if (typeof info.url === "string") return info.url;
  const requested = Array.isArray(info.requested_formats) ? info.requested_formats as Array<Record<string, unknown>> : [];
  return requested.find((item) => typeof item.url === "string")?.url as string || "";
}

async function localVideoExtractMetadata(rawArgs: z.infer<typeof localVideoExtractMetadataArgsSchema>): Promise<Record<string, unknown>> {
  const url = assertPublicHttpUrl(rawArgs.url);
  const ytDlp = await probeCommand("yt-dlp", ["--version"]);
  if (!ytDlp.ok) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "dependency",
      executor: "local",
      stage: "extract_metadata",
      code: "DEPENDENCY_MISSING",
      error: "yt-dlp is not installed or not runnable.",
      fallbackTool: "video_parse_link",
      data: { code: "DEPENDENCY_MISSING", fallbackTool: "video_parse_link" },
      probe: ytDlp,
    };
  }
  const result = await runProcess("yt-dlp", ["--dump-single-json", "--skip-download", "--no-playlist", "--no-warnings", "--socket-timeout", "15", url.toString()], { timeoutMs: 90_000 });
  if (result.code !== 0) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "execution",
      executor: "local",
      stage: "extract_metadata",
      code: "LOCAL_EXTRACTION_FAILED",
      error: result.stderr.trim() || `yt-dlp exited with ${result.code}`,
      fallbackTool: "video_parse_link",
      data: { code: "LOCAL_EXTRACTION_FAILED", fallbackTool: "video_parse_link" },
    };
  }
  const info = JSON.parse(result.stdout) as Record<string, unknown>;
  const description = typeof info.description === "string" ? info.description : "";
  return {
    ok: true,
    executor: "local",
    stage: "extract_metadata",
    backend: "yt-dlp",
    platform: info.extractor_key || info.extractor || detectLocalVideoPlatform(url),
    videoId: info.id || null,
    canonicalUrl: info.webpage_url || url.toString(),
    title: info.title || info.fulltitle || "",
    author: info.uploader || info.channel || info.creator || "",
    duration: info.duration || null,
    coverUrl: info.thumbnail || "",
    videoUrl: firstYtdlpMediaUrl(info),
    description: rawArgs.includeDescription === false ? undefined : description.slice(0, 12_000),
    tags: Array.isArray(info.tags) ? info.tags.slice(0, 100) : [],
    subtitleLanguages: [...new Set([...Object.keys(asRecord(info.subtitles)), ...Object.keys(asRecord(info.automatic_captions))])],
  };
}
async function agentReachBilibiliSearch(rawArgs: z.infer<typeof agentReachBilibiliSearchArgsSchema>): Promise<Record<string, unknown>> {
  const limit = rawArgs.limit ?? 10;
  const params = new URLSearchParams({
    search_type: "video",
    keyword: rawArgs.query,
    page: "1",
  });
  let apiError = "";
  try {
    const response = await fetchTextWithTimeout(`https://api.bilibili.com/x/web-interface/search/type?${params.toString()}`, {
      timeoutMs: 20_000,
      headers: {
        Referer: "https://www.bilibili.com/",
        Accept: "application/json",
      },
    });
    const parsed = JSON.parse(response.text) as { code?: number; message?: string; data?: { result?: Array<Record<string, unknown>> } };
    if (parsed.code !== 0) {
      throw new Error(`Bilibili API error ${parsed.code}: ${parsed.message || "unknown"}`);
    }
    const results = (parsed.data?.result || []).slice(0, limit).map((item) => ({
      title: stripHtmlToText(String(item.title || "")),
      url: String(item.arcurl || (item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : "")),
      bvid: item.bvid,
      author: item.author,
      description: stripHtmlToText(String(item.description || "")).slice(0, 500),
      duration: item.duration,
      play: item.play,
      favorites: item.favorites,
      pubdate: item.pubdate,
    }));
    return {
      ok: true,
      backend: "Bilibili public search API",
      query: rawArgs.query,
      resultCount: results.length,
      results,
    };
  } catch (error) {
    apiError = error instanceof Error ? error.message : String(error);
  }

  const bili = await probeCommand("bili", ["--version"]);
  if (bili.ok) {
    const result = await runProcess("bili", ["search", rawArgs.query, "--type", "video", "-n", String(limit)], { timeoutMs: 30_000 });
    return {
      ok: result.code === 0,
      backend: "bili-cli",
      query: rawArgs.query,
      apiError,
      output: `${result.stdout}${result.stderr}`.trim().slice(0, 20_000),
      error: result.code === 0 ? undefined : `bili exited with ${result.code}`,
    };
  }

  return {
    ok: false,
    backend: "none",
    query: rawArgs.query,
    error: apiError,
    fallbackHint: "Bilibili public API was unavailable from this network. Install bili-cli locally to enable fallback: pipx install bilibili-cli",
  };
}

async function getJsonWithTimeout(url: string, timeoutMs = 20_000): Promise<unknown> {
  const response = await fetch(url, {
    headers: { "User-Agent": "WodeAppX-AgentReach/0.1" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function agentReachV2ex(rawArgs: z.infer<typeof agentReachV2exArgsSchema>): Promise<Record<string, unknown>> {
  const limit = rawArgs.limit ?? 20;
  if (rawArgs.action === "hot") {
    const data = await getJsonWithTimeout("https://www.v2ex.com/api/topics/hot.json") as Array<Record<string, unknown>>;
    return { ok: true, action: "hot", items: data.slice(0, limit) };
  }
  if (rawArgs.action === "node") {
    if (!rawArgs.nodeName) throw new Error("nodeName is required for action=node.");
    const data = await getJsonWithTimeout(`https://www.v2ex.com/api/topics/show.json?node_name=${encodeURIComponent(rawArgs.nodeName)}&page=1`) as Array<Record<string, unknown>>;
    return { ok: true, action: "node", nodeName: rawArgs.nodeName, items: data.slice(0, limit) };
  }
  if (rawArgs.action === "topic") {
    if (!rawArgs.topicId) throw new Error("topicId is required for action=topic.");
    const topic = await getJsonWithTimeout(`https://www.v2ex.com/api/topics/show.json?id=${rawArgs.topicId}`) as Array<Record<string, unknown>>;
    const replies = await getJsonWithTimeout(`https://www.v2ex.com/api/replies/show.json?topic_id=${rawArgs.topicId}&page=1`) as Array<Record<string, unknown>>;
    return { ok: true, action: "topic", topic: topic[0] || null, replies: replies.slice(0, limit) };
  }
  if (!rawArgs.username) throw new Error("username is required for action=user.");
  const user = await getJsonWithTimeout(`https://www.v2ex.com/api/members/show.json?username=${encodeURIComponent(rawArgs.username)}`) as Record<string, unknown>;
  return { ok: true, action: "user", user };
}

const CHROME_LIST_TABS_JXA = `
function run(argv) {
  var appName = argv[0] || "Google Chrome";
  var chrome = Application(appName);
  if (!chrome.running()) return JSON.stringify({ok:false,error:appName + " is not running."});
  var windows = chrome.windows();
  var tabs = [];
  for (var wi = 0; wi < windows.length; wi++) {
    var w = windows[wi];
    var activeId = null;
    try { activeId = w.activeTab().id(); } catch (e) {}
    var windowTabs = w.tabs();
    for (var ti = 0; ti < windowTabs.length; ti++) {
      var tab = windowTabs[ti];
      var id = null;
      try { id = tab.id(); } catch (e) {}
      tabs.push({
        windowIndex: wi + 1,
        tabIndex: ti + 1,
        title: String(tab.title()),
        url: String(tab.url()),
        active: id === activeId
      });
    }
  }
  return JSON.stringify({ok:true, app:appName, windowCount:windows.length, tabs:tabs});
}`;

const CHROME_TAB_SUMMARY_JXA = `
function run(argv) {
  var appName = argv[0] || "Google Chrome";
  var chrome = Application(appName);
  if (!chrome.running()) return JSON.stringify({ok:false,error:appName + " is not running."});
  var windows = chrome.windows();
  var tabs = [];
  var active = null;
  for (var wi = 0; wi < windows.length; wi++) {
    var w = windows[wi];
    var activeId = null;
    try { activeId = w.activeTab().id(); } catch (e) {}
    var windowTabs = w.tabs();
    for (var ti = 0; ti < windowTabs.length; ti++) {
      var tab = windowTabs[ti];
      var id = null;
      try { id = tab.id(); } catch (e) {}
      var item = {
        windowIndex: wi + 1,
        tabIndex: ti + 1,
        active: id === activeId
      };
      if (item.active) active = { windowIndex: item.windowIndex, tabIndex: item.tabIndex };
      tabs.push(item);
    }
  }
  return JSON.stringify({ok:true, app:appName, privacy:"tab_titles_and_addresses_omitted", windowCount:windows.length, tabCount:tabs.length, active:active, tabs:tabs});
}`;

const CHROME_ACTIVE_TAB_JXA = `
function run(argv) {
  var appName = argv[0] || "Google Chrome";
  var chrome = Application(appName);
  if (!chrome.running()) return JSON.stringify({ok:false,error:appName + " is not running."});
  var windows = chrome.windows();
  for (var wi = 0; wi < windows.length; wi++) {
    var w = windows[wi];
    try {
      var tab = w.activeTab();
      return JSON.stringify({
        ok:true,
        app:appName,
        windowIndex:wi + 1,
        tabIndex:w.activeTabIndex(),
        title:String(tab.title()),
        url:String(tab.url())
      });
    } catch (e) {}
  }
  return JSON.stringify({ok:false,error:"No active Chrome tab found."});
}`;

const CHROME_OPEN_URL_JXA = `
function run(argv) {
  var appName = argv[0] || "Google Chrome";
  var url = argv[1] || "";
  if (!url) return JSON.stringify({ok:false,error:"URL is required."});
  var chrome = Application(appName);
  chrome.activate();
  chrome.openLocation(url);
  return JSON.stringify({ok:true, app:appName, url:url});
}`;

const CHROME_ACTIVATE_TAB_JXA = `
function run(argv) {
  var appName = argv[0] || "Google Chrome";
  var windowIndex = Number(argv[1] || "1");
  var tabIndex = Number(argv[2] || "1");
  var chrome = Application(appName);
  if (!chrome.running()) return JSON.stringify({ok:false,error:appName + " is not running."});
  var windows = chrome.windows();
  if (windowIndex < 1 || windowIndex > windows.length) return JSON.stringify({ok:false,error:"Chrome window index is out of range."});
  var w = windows[windowIndex - 1];
  var tabs = w.tabs();
  if (tabIndex < 1 || tabIndex > tabs.length) return JSON.stringify({ok:false,error:"Chrome tab index is out of range."});
  w.activeTabIndex = tabIndex;
  chrome.activate();
  var tab = w.activeTab();
  return JSON.stringify({ok:true, app:appName, windowIndex:windowIndex, tabIndex:tabIndex, title:String(tab.title()), url:String(tab.url())});
}`;

const CHROME_CLOSE_TAB_JXA = `
function run(argv) {
  var appName = argv[0] || "Google Chrome";
  var windowIndex = Number(argv[1] || "1");
  var tabIndex = Number(argv[2] || "1");
  var chrome = Application(appName);
  if (!chrome.running()) return JSON.stringify({ok:false,error:appName + " is not running."});
  var windows = chrome.windows();
  if (windowIndex < 1 || windowIndex > windows.length) return JSON.stringify({ok:false,error:"Chrome window index is out of range."});
  var w = windows[windowIndex - 1];
  var tabs = w.tabs();
  if (tabIndex < 1 || tabIndex > tabs.length) return JSON.stringify({ok:false,error:"Chrome tab index is out of range."});
  var tab = tabs[tabIndex - 1];
  var title = String(tab.title());
  var url = String(tab.url());
  tab.close();
  return JSON.stringify({ok:true, app:appName, closed:{windowIndex:windowIndex, tabIndex:tabIndex, title:title, url:url}});
}`;

const CHROME_EXECUTE_JAVASCRIPT_JXA = `
function run(argv) {
  var appName = argv[0] || "Google Chrome";
  var windowIndex = Number(argv[1] || "1");
  var tabIndexRaw = argv[2] || "";
  var code = argv[3] || "";
  var chrome = Application(appName);
  if (!chrome.running()) return JSON.stringify({ok:false,error:appName + " is not running."});
  var windows = chrome.windows();
  if (windowIndex < 1 || windowIndex > windows.length) return JSON.stringify({ok:false,error:"Chrome window index is out of range."});
  var w = windows[windowIndex - 1];
  var tab = tabIndexRaw ? w.tabs()[Number(tabIndexRaw) - 1] : w.activeTab();
  if (!tab) return JSON.stringify({ok:false,error:"Chrome tab index is out of range."});
  try {
    var value = tab.execute({javascript:code});
    return JSON.stringify({ok:true, app:appName, result:String(value)});
  } catch (e) {
    return JSON.stringify({
      ok:false,
      error:String(e),
      hint:"Chrome blocks JavaScript from Apple Events by default. Enable View > Developer > Allow JavaScript from Apple Events, or use openwork_chrome_snapshot/openwork_computer_* instead."
    });
  }
}`;

type LocalCanvasModule = typeof import("@napi-rs/canvas");
type LocalCanvasImage = Awaited<ReturnType<LocalCanvasModule["loadImage"]>>;
type LocalCanvas = InstanceType<LocalCanvasModule["Canvas"]>;
type LocalCanvasContext = ReturnType<LocalCanvas["getContext"]>;

async function loadLocalCanvas(): Promise<LocalCanvasModule> {
  const bundledCanvasUrl = new URL("./node_modules/@napi-rs/canvas/index.js", import.meta.url);
  return existsSync(fileURLToPath(bundledCanvasUrl))
    ? await import(bundledCanvasUrl.href) as LocalCanvasModule
    : await import(["@napi-rs", "canvas"].join("/")) as LocalCanvasModule;
}

async function loadLocalRasterImage(pathInput: string, context?: OpenCodeContext): Promise<{
  path: string;
  image: LocalCanvasImage;
  sizeBytes: number;
  modifiedAt: string;
}> {
  const path = resolveLocalFilePath(pathInput, context);
  try {
    const fileStat = await stat(path);
    if (!fileStat.isFile()) throw new Error(`Image input is not a file: ${path}`);
    const canvas = await loadLocalCanvas();
    const image = await canvas.loadImage(path);
    if (!image.width || !image.height) throw new Error(`Image has invalid dimensions: ${path}`);
    return { path, image, sizeBytes: fileStat.size, modifiedAt: fileStat.mtime.toISOString() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const inputTrimmed = pathInput.trim();
    const looksRelative = !inputTrimmed.startsWith("/")
      && !/^[A-Za-z]:[\\/]/.test(inputTrimmed)
      && inputTrimmed !== "~"
      && !inputTrimmed.startsWith("~/");
    const looksInventedWorkspacePath = /default-workspace/i.test(path)
      || (looksRelative && /ENOENT|no such file/i.test(message));
    if (looksInventedWorkspacePath) {
      throw new Error(
        [
          `Image path not found: ${path}`,
          "Do not invent default-workspace/workspace-relative paths from bare filenames.",
          "For chat uploads, use the absolute path from candidateImages[].path, or skip image_inspect and use selectedImageIds / candidateHttpsImages.",
        ].join(" "),
      );
    }
    throw error;
  }
}

function assertLocalImageCanvasSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`Invalid output size ${width}x${height}.`);
  }
  if (width > 16_384 || height > 16_384 || width * height > 100_000_000) {
    throw new Error(`Output canvas ${width}x${height} exceeds the safe local image limit.`);
  }
}

async function prepareLocalImageOutput(
  outputInput: string,
  context: OpenCodeContext | undefined,
  overwrite = false,
): Promise<{ path: string; format: "png" | "jpeg" | "webp" }> {
  const path = resolveLocalFilePath(outputInput, context);
  const extension = extname(path).toLowerCase();
  const format = extension === ".png"
    ? "png"
    : extension === ".jpg" || extension === ".jpeg"
      ? "jpeg"
      : extension === ".webp"
        ? "webp"
        : null;
  if (!format) throw new Error("outputPath must end in .png, .jpg, .jpeg, or .webp.");
  if (!overwrite && existsSync(path)) throw new Error(`Output already exists: ${path}. Set overwrite:true to replace it.`);
  await mkdir(dirname(path), { recursive: true });
  return { path, format };
}

function defaultImageBackground(format: "png" | "jpeg" | "webp", requested?: string): string {
  return requested ?? (format === "jpeg" ? "#ffffff" : "transparent");
}

function fillLocalImageBackground(
  context: LocalCanvasContext,
  width: number,
  height: number,
  color: string,
): void {
  context.save();
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
  context.restore();
}

function localImageDrawRect(
  sourceWidth: number,
  sourceHeight: number,
  targetX: number,
  targetY: number,
  targetWidth: number,
  targetHeight: number,
  fit: "contain" | "cover" | "fill",
): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } {
  if (fit === "fill") {
    return { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight, dx: targetX, dy: targetY, dw: targetWidth, dh: targetHeight };
  }
  const scale = fit === "cover"
    ? Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
    : Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  if (fit === "contain") {
    const dw = Math.max(1, Math.round(sourceWidth * scale));
    const dh = Math.max(1, Math.round(sourceHeight * scale));
    return {
      sx: 0,
      sy: 0,
      sw: sourceWidth,
      sh: sourceHeight,
      dx: targetX + Math.round((targetWidth - dw) / 2),
      dy: targetY + Math.round((targetHeight - dh) / 2),
      dw,
      dh,
    };
  }
  const sw = targetWidth / scale;
  const sh = targetHeight / scale;
  return {
    sx: (sourceWidth - sw) / 2,
    sy: (sourceHeight - sh) / 2,
    sw,
    sh,
    dx: targetX,
    dy: targetY,
    dw: targetWidth,
    dh: targetHeight,
  };
}

async function writeLocalImageCanvas(
  canvas: LocalCanvas,
  outputInput: string,
  context: OpenCodeContext | undefined,
  overwrite: boolean | undefined,
  quality: number | undefined,
): Promise<{ path: string; format: string; width: number; height: number; sizeBytes: number }> {
  const output = await prepareLocalImageOutput(outputInput, context, overwrite);
  const normalizedQuality = Math.max(1, Math.min(100, quality ?? 90));
  const buffer = output.format === "png"
    ? canvas.toBuffer("image/png")
    : output.format === "jpeg"
      ? canvas.toBuffer("image/jpeg", normalizedQuality)
      : canvas.toBuffer("image/webp", normalizedQuality);
  await writeFile(output.path, buffer);
  return { path: output.path, format: output.format, width: canvas.width, height: canvas.height, sizeBytes: buffer.byteLength };
}

async function inspectLocalImage(pathInput: string, context?: OpenCodeContext): Promise<Record<string, unknown>> {
  const source = await loadLocalRasterImage(pathInput, context);
  return {
    ok: true,
    executor: "local",
    stage: "inspect_image",
    data: {
      path: source.path,
      name: basename(source.path),
      width: source.image.width,
      height: source.image.height,
      aspectRatio: source.image.width / source.image.height,
      sizeBytes: source.sizeBytes,
      modifiedAt: source.modifiedAt,
    },
    warnings: [],
    nextActions: ["image_crop", "image_resize", "image_rotate_flip", "image_collage", "image_composite"],
  };
}

async function cropLocalImage(args: z.infer<typeof imageCropArgsSchema>, context?: OpenCodeContext): Promise<Record<string, unknown>> {
  const source = await loadLocalRasterImage(args.path, context);
  if (args.x + args.width > source.image.width || args.y + args.height > source.image.height) {
    throw new Error(`Crop rectangle exceeds source bounds ${source.image.width}x${source.image.height}.`);
  }
  assertLocalImageCanvasSize(args.width, args.height);
  const canvasModule = await loadLocalCanvas();
  const canvas = canvasModule.createCanvas(args.width, args.height);
  canvas.getContext("2d").drawImage(source.image, args.x, args.y, args.width, args.height, 0, 0, args.width, args.height);
  const output = await writeLocalImageCanvas(canvas, args.outputPath, context, args.overwrite, args.quality);
  return { ok: true, executor: "local", stage: "crop_image", data: { sourcePath: source.path, ...output }, warnings: [], nextActions: [] };
}

async function resizeLocalImage(args: z.infer<typeof imageResizeArgsSchema>, context?: OpenCodeContext): Promise<Record<string, unknown>> {
  const source = await loadLocalRasterImage(args.path, context);
  if (!args.width && !args.height) throw new Error("Provide width, height, or both.");
  const width = args.width ?? Math.max(1, Math.round(source.image.width * Number(args.height) / source.image.height));
  const height = args.height ?? Math.max(1, Math.round(source.image.height * Number(args.width) / source.image.width));
  assertLocalImageCanvasSize(width, height);
  const canvasModule = await loadLocalCanvas();
  const canvas = canvasModule.createCanvas(width, height);
  const outputFormat = extname(resolveLocalFilePath(args.outputPath, context)).toLowerCase();
  const drawContext = canvas.getContext("2d");
  fillLocalImageBackground(drawContext, width, height, defaultImageBackground(outputFormat === ".jpg" || outputFormat === ".jpeg" ? "jpeg" : outputFormat === ".webp" ? "webp" : "png", args.background));
  const rect = localImageDrawRect(source.image.width, source.image.height, 0, 0, width, height, args.fit ?? "contain");
  drawContext.drawImage(source.image, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh);
  const output = await writeLocalImageCanvas(canvas, args.outputPath, context, args.overwrite, args.quality);
  return { ok: true, executor: "local", stage: "resize_image", data: { sourcePath: source.path, fit: args.fit ?? "contain", ...output }, warnings: [], nextActions: [] };
}

async function rotateFlipLocalImage(args: z.infer<typeof imageRotateFlipArgsSchema>, context?: OpenCodeContext): Promise<Record<string, unknown>> {
  const source = await loadLocalRasterImage(args.path, context);
  const degrees = Number(args.degrees ?? "0");
  const swap = degrees === 90 || degrees === 270;
  const width = swap ? source.image.height : source.image.width;
  const height = swap ? source.image.width : source.image.height;
  assertLocalImageCanvasSize(width, height);
  const canvasModule = await loadLocalCanvas();
  const canvas = canvasModule.createCanvas(width, height);
  const drawContext = canvas.getContext("2d");
  drawContext.translate(width / 2, height / 2);
  drawContext.rotate(degrees * Math.PI / 180);
  drawContext.scale(args.flipHorizontal ? -1 : 1, args.flipVertical ? -1 : 1);
  drawContext.drawImage(source.image, -source.image.width / 2, -source.image.height / 2);
  const output = await writeLocalImageCanvas(canvas, args.outputPath, context, args.overwrite, args.quality);
  return { ok: true, executor: "local", stage: "rotate_flip_image", data: { sourcePath: source.path, degrees, flipHorizontal: args.flipHorizontal ?? false, flipVertical: args.flipVertical ?? false, ...output }, warnings: [], nextActions: [] };
}

async function collageLocalImages(args: z.infer<typeof imageCollageArgsSchema>, context?: OpenCodeContext): Promise<Record<string, unknown>> {
  const sources = await Promise.all(args.images.map(async (item) => ({ ...item, ...(await loadLocalRasterImage(item.path, context)) })));
  const layout = args.layout ?? "grid";
  const columns = layout === "vertical" ? 1 : layout === "horizontal" ? sources.length : Math.min(args.columns ?? Math.ceil(Math.sqrt(sources.length)), sources.length);
  const rows = Math.ceil(sources.length / columns);
  const cellWidth = args.cellWidth ?? Math.min(1600, Math.max(...sources.map((source) => source.image.width)));
  const cellHeight = args.cellHeight ?? Math.min(1600, Math.max(...sources.map((source) => source.image.height)));
  const gap = args.gap ?? 24;
  const padding = args.padding ?? 24;
  const hasLabels = sources.some((source) => Boolean(source.label));
  const labelHeight = hasLabels ? args.labelHeight ?? 56 : 0;
  const width = padding * 2 + columns * cellWidth + Math.max(0, columns - 1) * gap;
  const height = padding * 2 + rows * (cellHeight + labelHeight) + Math.max(0, rows - 1) * gap;
  assertLocalImageCanvasSize(width, height);
  const canvasModule = await loadLocalCanvas();
  const canvas = canvasModule.createCanvas(width, height);
  const drawContext = canvas.getContext("2d");
  fillLocalImageBackground(drawContext, width, height, args.background ?? "#ffffff");
  const items: Array<Record<string, unknown>> = [];
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = padding + column * (cellWidth + gap);
    const y = padding + row * (cellHeight + labelHeight + gap);
    const rect = localImageDrawRect(source.image.width, source.image.height, x, y, cellWidth, cellHeight, args.fit ?? "contain");
    drawContext.drawImage(source.image, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh);
    if (source.label) {
      drawContext.save();
      drawContext.fillStyle = args.labelColor ?? "#111827";
      drawContext.font = `${Math.max(16, Math.min(32, Math.floor(labelHeight * 0.42)))}px sans-serif`;
      drawContext.textAlign = "center";
      drawContext.textBaseline = "middle";
      const clippedLabel = source.label.length > 80 ? `${source.label.slice(0, 77)}...` : source.label;
      drawContext.fillText(clippedLabel, x + cellWidth / 2, y + cellHeight + labelHeight / 2, cellWidth - 16);
      drawContext.restore();
    }
    items.push({ sourcePath: source.path, label: source.label, index, cell: { row, column, x, y, width: cellWidth, height: cellHeight } });
  }
  const output = await writeLocalImageCanvas(canvas, args.outputPath, context, args.overwrite, args.quality);
  return { ok: true, executor: "local", stage: "collage_images", data: { layout, columns, rows, fit: args.fit ?? "contain", items, ...output }, warnings: [], nextActions: [] };
}

async function compositeLocalImages(args: z.infer<typeof imageCompositeArgsSchema>, context?: OpenCodeContext): Promise<Record<string, unknown>> {
  const base = await loadLocalRasterImage(args.path, context);
  assertLocalImageCanvasSize(base.image.width, base.image.height);
  const canvasModule = await loadLocalCanvas();
  const canvas = canvasModule.createCanvas(base.image.width, base.image.height);
  const drawContext = canvas.getContext("2d");
  drawContext.drawImage(base.image, 0, 0);
  const overlays: Array<Record<string, unknown>> = [];
  for (const overlayArgs of args.overlays) {
    const overlay = await loadLocalRasterImage(overlayArgs.path, context);
    const width = overlayArgs.width ?? (overlayArgs.height ? Math.max(1, Math.round(overlay.image.width * overlayArgs.height / overlay.image.height)) : overlay.image.width);
    const height = overlayArgs.height ?? (overlayArgs.width ? Math.max(1, Math.round(overlay.image.height * overlayArgs.width / overlay.image.width)) : overlay.image.height);
    drawContext.save();
    drawContext.globalAlpha = overlayArgs.opacity ?? 1;
    drawContext.drawImage(overlay.image, overlayArgs.x, overlayArgs.y, width, height);
    drawContext.restore();
    overlays.push({ sourcePath: overlay.path, x: overlayArgs.x, y: overlayArgs.y, width, height, opacity: overlayArgs.opacity ?? 1 });
  }
  const output = await writeLocalImageCanvas(canvas, args.outputPath, context, args.overwrite, args.quality);
  return { ok: true, executor: "local", stage: "composite_images", data: { sourcePath: base.path, overlays, ...output }, warnings: [], nextActions: [] };
}

const LOCAL_IMAGE_TOOL_IMPLEMENTATIONS = {
  image_inspect: inspectLocalImage,
  image_crop: cropLocalImage,
  image_resize: resizeLocalImage,
  image_rotate_flip: rotateFlipLocalImage,
  image_collage: collageLocalImages,
  image_composite: compositeLocalImages,
} as const;
function resolveLocalFilePath(input: string, context?: OpenCodeContext): string {
  const trimmed = input.trim();
  const expanded = trimmed === "~" ? homedir() : trimmed.startsWith("~/") ? join(homedir(), trimmed.slice(2)) : trimmed;
  if (isAbsolute(expanded)) return resolve(expanded);
  return resolve(context?.directory ?? process.cwd(), expanded);
}

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean; chars: number } {
  if (text.length <= maxChars) return { text, truncated: false, chars: text.length };
  return { text: text.slice(0, maxChars), truncated: true, chars: text.length };
}

const ATTACHMENT_CONTEXT_ROOT = join(homedir(), ".wodeappx", "attachment-context-packs");

async function readAttachmentContextPack(
  refId: string,
  offset = 0,
  maxChars = 20_000,
): Promise<Record<string, unknown>> {
  const trimmedRefId = refId.trim();
  if (!/^ctx_[a-zA-Z0-9_-]{8,120}$/.test(trimmedRefId)) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: "contextRefId must use a persisted local pack reference (ctx_ prefix). Remote attachmentFingerprint values cannot be read with this tool.",
      data: {
        code: "INVALID_CONTEXT_REF",
        refId: trimmedRefId,
        hint: "Use contextRefId from conversation history, not attachmentFingerprint or contextPackId.",
      },
    };
  }
  const manifestPath = join(ATTACHMENT_CONTEXT_ROOT, trimmedRefId, "manifest.json");
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      recoverable: true,
      errorKind: "execution",
      error: "The attachment context pack is no longer available locally.",
      data: {
        code: "CONTEXT_PACK_NOT_FOUND",
        refId: trimmedRefId,
        fallbackTool: "openwork_file_extract_text",
      },
    };
  }
  if (manifest.refId !== trimmedRefId || typeof manifest.context !== "string") {
    return {
      ok: false,
      recoverable: true,
      errorKind: "execution",
      error: "The attachment context pack is invalid.",
      data: {
        code: "CONTEXT_PACK_INVALID",
        refId: trimmedRefId,
        fallbackTool: "openwork_file_extract_text",
      },
    };
  }

  const context = manifest.context;
  const safeOffset = Math.min(offset, context.length);
  const text = context.slice(safeOffset, safeOffset + maxChars);
  const nextOffset = safeOffset + text.length;
  const hasMore = nextOffset < context.length;
  return {
    ok: true,
    executor: "local",
    stage: "read_attachment_context",
    data: {
      refId: trimmedRefId,
      contextPackId: typeof manifest.contextPackId === "string" ? manifest.contextPackId : "",
      createdAt: typeof manifest.createdAt === "string" ? manifest.createdAt : "",
      offset: safeOffset,
      returnedChars: text.length,
      totalChars: context.length,
      hasMore,
      nextOffset: hasMore ? nextOffset : null,
      text,
      sources: Array.isArray(manifest.sources) ? manifest.sources : [],
      uploadedUrls: Array.isArray(manifest.uploadedUrls) ? manifest.uploadedUrls : [],
      files: Array.isArray(manifest.files) ? manifest.files : [],
    },
    warnings: [],
    nextActions: hasMore
      ? [`Call openwork_attachment_context_read again with offset=${nextOffset}.`]
      : [],
  };
}

function cleanExtractedText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeXmlEntities(text: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: "\"",
  };
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x")) {
      try {
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      } catch {
        return match;
      }
    }
    if (entity.startsWith("#")) {
      try {
        return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      } catch {
        return match;
      }
    }
    return entities[entity] ?? match;
  });
}

function stripXmlText(xml: string): string {
  return cleanExtractedText(decodeXmlEntities(xml
    .replace(/<w:tab\s*\/>/g, "\t")
    .replace(/<w:br\s*\/>/g, "\n")
    .replace(/<\/(w:p|a:p|p|row)>/g, "\n")
    .replace(/<\/(w:tc|c)>/g, "\t")
    .replace(/<[^>]+>/g, " ")));
}

async function runUnzipEntry(filePath: string, entry: string): Promise<string> {
  const result = await runProcess("/usr/bin/unzip", ["-p", filePath, entry], { timeoutMs: 30_000 });
  if (result.code !== 0) return "";
  return result.stdout;
}

async function listZipEntries(filePath: string): Promise<string[]> {
  const result = await runProcess("/usr/bin/unzip", ["-Z1", filePath], { timeoutMs: 30_000 });
  if (result.code !== 0) return [];
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function naturalEntrySort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

async function extractDocxText(filePath: string): Promise<{ source: string; text: string; warning?: string }> {
  const xml = await runUnzipEntry(filePath, "word/document.xml");
  if (!xml) return { source: "docx", text: "", warning: "word/document.xml was not found or could not be read." };
  return { source: "docx:word/document.xml", text: stripXmlText(xml) };
}

async function extractPptxText(filePath: string): Promise<{ source: string; text: string; warning?: string }> {
  const entries = (await listZipEntries(filePath))
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry))
    .sort(naturalEntrySort)
    .slice(0, 120);
  if (!entries.length) return { source: "pptx", text: "", warning: "No slide XML files were found." };
  const slides: string[] = [];
  for (const entry of entries) {
    const xml = await runUnzipEntry(filePath, entry);
    const text = stripXmlText(xml);
    if (text) slides.push(`${entry}\n${text}`);
  }
  return { source: "pptx:slides", text: slides.join("\n\n") };
}

function extractSharedStrings(sharedXml: string): string[] {
  return Array.from(sharedXml.matchAll(/<si[\s\S]*?<\/si>/g)).map((match) => stripXmlText(match[0]));
}

function extractWorksheetRows(sheetXml: string, sharedStrings: string[]): string[] {
  const rows: string[] = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b[\s\S]*?<\/row>/g)) {
    const values: string[] = [];
    for (const cellMatch of rowMatch[0].matchAll(/<c\b([\s\S]*?)<\/c>/g)) {
      const cellXml = cellMatch[0];
      const attrs = cellMatch[1] ?? "";
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const value = cellXml.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
      if (type === "s") {
        values.push(sharedStrings[Number.parseInt(value, 10)] ?? value);
      } else if (type === "inlineStr") {
        values.push(stripXmlText(cellXml));
      } else {
        values.push(decodeXmlEntities(value));
      }
    }
    const row = values.map((value) => value.trim()).filter(Boolean).join("\t");
    if (row) rows.push(row);
  }
  return rows;
}

async function extractXlsxText(filePath: string): Promise<{ source: string; text: string; warning?: string }> {
  const entries = await listZipEntries(filePath);
  const sheetEntries = entries.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry)).sort(naturalEntrySort).slice(0, 80);
  if (!sheetEntries.length) return { source: "xlsx", text: "", warning: "No worksheet XML files were found." };
  const sharedStrings = extractSharedStrings(await runUnzipEntry(filePath, "xl/sharedStrings.xml"));
  const sheets: string[] = [];
  for (const entry of sheetEntries) {
    const xml = await runUnzipEntry(filePath, entry);
    const rows = extractWorksheetRows(xml, sharedStrings);
    if (rows.length) sheets.push(`${entry}\n${rows.join("\n")}`);
  }
  return { source: "xlsx:worksheets", text: sheets.join("\n\n") };
}

const XLS_MAX_BYTES = 40 * 1024 * 1024;
const XLS_MAX_SHEETS = 80;
const XLS_MAX_EVIDENCE_CELLS = 240;
const XLS_MAX_EVIDENCE_VALUE_CHARS = 256;
const XLS_CFB_MAGIC = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);

type XlsCellEvidence = {
  sheet: string;
  row: number;
  col: number;
  value: string;
  valueTruncated?: boolean;
};

type XlsSheetEvidence = {
  name: string;
  rowCount: number;
  nonEmptyCellCount: number;
  returnedCellCount: number;
  cells: XlsCellEvidence[];
};

type XlsWorkbookEvidence = {
  format: "biff8";
  backend: "sheetjs-biff8";
  sheetCount: number;
  totalNonEmptyCellCount: number;
  returnedCellCount: number;
  truncated: boolean;
  sheets: XlsSheetEvidence[];
};

type XlsExtractSuccess = {
  ok: true;
  source: "xls:sheetjs-biff8";
  text: string;
  evidence: XlsWorkbookEvidence;
  warning?: string;
};

type XlsExtractFailure = {
  ok: false;
  recoverable: boolean;
  errorKind: "dependency" | "execution" | "validation";
  error: string;
  data: Record<string, unknown>;
};

type XlsExtractResult = XlsExtractSuccess | XlsExtractFailure;

type SheetJsModule = {
  read: (data: Buffer, opts?: Record<string, unknown>) => {
    SheetNames: string[];
    Sheets: Record<string, Record<string, unknown> & { "!ref"?: string }>;
    Workbook?: unknown;
  };
  utils: {
    sheet_to_json: (sheet: unknown, opts?: Record<string, unknown>) => unknown[];
    decode_range: (ref: string) => { s: { r: number; c: number }; e: { r: number; c: number } };
    encode_cell: (address: { r: number; c: number }) => string;
  };
};

async function loadSheetJsModule(): Promise<SheetJsModule | null> {
  try {
    return await import("xlsx") as unknown as SheetJsModule;
  } catch {
    return null;
  }
}

function looksLikeZip(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4B;
}

function looksLikeCfb(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(XLS_CFB_MAGIC);
}

function buildXlsWorkbookEvidence(
  workbook: {
    SheetNames: string[];
    Sheets: Record<string, Record<string, unknown> & { "!ref"?: string }>;
  },
  XLSX: SheetJsModule,
): { text: string; evidence: XlsWorkbookEvidence } {
  const sheets: XlsSheetEvidence[] = [];
  const textBlocks: string[] = [];
  const selectedSheetNames = workbook.SheetNames.slice(0, XLS_MAX_SHEETS);
  const perSheetEvidenceLimit = Math.max(
    1,
    Math.floor(XLS_MAX_EVIDENCE_CELLS / Math.max(1, selectedSheetNames.length)),
  );
  let remainingEvidenceCells = XLS_MAX_EVIDENCE_CELLS;
  let totalNonEmptyCellCount = 0;

  for (const [sheetIndex, name] of selectedSheetNames.entries()) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
      blankrows: false,
    }) as Array<Array<string | number | boolean | null | undefined>>;
    const cells: XlsCellEvidence[] = [];
    const rowLines: string[] = [];
    let nonEmptyCellCount = 0;
    const sheetEvidenceLimit = sheetIndex === selectedSheetNames.length - 1
      ? remainingEvidenceCells
      : Math.min(perSheetEvidenceLimit, remainingEvidenceCells);

    matrix.forEach((row, rowIndex) => {
      const values: string[] = [];
      row.forEach((raw, colIndex) => {
        const value = String(raw ?? "").trim();
        if (!value) return;
        nonEmptyCellCount += 1;
        totalNonEmptyCellCount += 1;
        if (cells.length < sheetEvidenceLimit) {
          const valueTruncated = value.length > XLS_MAX_EVIDENCE_VALUE_CHARS;
          cells.push({
            sheet: name,
            row: rowIndex + 1,
            col: colIndex + 1,
            value: valueTruncated ? value.slice(0, XLS_MAX_EVIDENCE_VALUE_CHARS) : value,
            valueTruncated: valueTruncated || undefined,
          });
        }
        values.push(`C${colIndex + 1}=${value}`);
      });
      if (values.length) rowLines.push(`R${rowIndex + 1}\t${values.join("\t")}`);
    });

    // Prefer sheet-range traversal when dense JSON drops sparse cells.
    if (nonEmptyCellCount === 0 && sheet["!ref"]) {
      const range = XLSX.utils.decode_range(sheet["!ref"]);
      for (let row = range.s.r; row <= range.e.r; row += 1) {
        const values: string[] = [];
        for (let col = range.s.c; col <= range.e.c; col += 1) {
          const address = XLSX.utils.encode_cell({ r: row, c: col });
          const cell = sheet[address] as { w?: string; v?: unknown } | undefined;
          if (!cell) continue;
          const value = String(cell.w ?? cell.v ?? "").trim();
          if (!value) continue;
          nonEmptyCellCount += 1;
          totalNonEmptyCellCount += 1;
          if (cells.length < sheetEvidenceLimit) {
            const valueTruncated = value.length > XLS_MAX_EVIDENCE_VALUE_CHARS;
            cells.push({
              sheet: name,
              row: row + 1,
              col: col + 1,
              value: valueTruncated ? value.slice(0, XLS_MAX_EVIDENCE_VALUE_CHARS) : value,
              valueTruncated: valueTruncated || undefined,
            });
          }
          values.push(`C${col + 1}=${value}`);
        }
        if (values.length) rowLines.push(`R${row + 1}\t${values.join("\t")}`);
      }
    }

    remainingEvidenceCells = Math.max(0, remainingEvidenceCells - cells.length);
    sheets.push({
      name,
      rowCount: matrix.length || (sheet["!ref"] ? (XLSX.utils.decode_range(sheet["!ref"]).e.r + 1) : 0),
      nonEmptyCellCount,
      returnedCellCount: cells.length,
      cells,
    });
    textBlocks.push(`# sheet: ${name}\n${rowLines.join("\n") || "(empty)"}`);
  }

  const returnedCellCount = sheets.reduce((total, sheet) => total + sheet.returnedCellCount, 0);
  return {
    text: textBlocks.join("\n\n"),
    evidence: {
      format: "biff8",
      backend: "sheetjs-biff8",
      sheetCount: sheets.length,
      totalNonEmptyCellCount,
      returnedCellCount,
      truncated: totalNonEmptyCellCount > returnedCellCount,
      sheets,
    },
  };
}

async function extractXlsText(
  filePath: string,
): Promise<XlsExtractResult> {
  const fileStat = await stat(filePath);
  if (fileStat.size > XLS_MAX_BYTES) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: `Legacy Excel (.xls) exceeds the ${XLS_MAX_BYTES} byte local extraction limit.`,
      data: {
        code: "XLS_TOO_LARGE",
        path: filePath,
        sizeBytes: fileStat.size,
        maxBytes: XLS_MAX_BYTES,
        productSaveAllowed: false,
      },
    };
  }

  const buffer = await readFile(filePath);
  if (looksLikeZip(buffer)) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: "File header is OOXML/ZIP rather than BIFF8 CFB. Rename to .xlsx or use the XLSX extractor path.",
      data: {
        code: "XLS_NOT_BIFF8",
        path: filePath,
        sizeBytes: fileStat.size,
        productSaveAllowed: false,
        fallbackTool: "openwork_file_extract_text",
      },
    };
  }
  if (!looksLikeCfb(buffer)) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: "File is not a valid BIFF8 Compound File Binary workbook.",
      data: {
        code: "XLS_CORRUPT",
        path: filePath,
        sizeBytes: fileStat.size,
        productSaveAllowed: false,
      },
    };
  }

  const XLSX = await loadSheetJsModule();
  if (!XLSX) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "dependency",
      error: "Legacy Excel (.xls) text extraction is not available in this build.",
      data: {
        code: "LEGACY_XLS_DEPENDENCY_MISSING",
        path: filePath,
        extension: ".xls",
        sizeBytes: fileStat.size,
        productSaveAllowed: false,
        backend: "sheetjs-biff8",
        sofficeRequired: false,
        hint: "The bundled SheetJS BIFF8 reader failed to load. Convert the workbook to .xlsx or rebuild openwork-server with the xlsx dependency.",
      },
    };
  }

  let workbook: {
    SheetNames: string[];
    Sheets: Record<string, Record<string, unknown> & { "!ref"?: string }>;
    Workbook?: unknown;
  };
  try {
    workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
      cellNF: false,
      cellText: true,
      bookVBA: false,
      password: "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const encrypted = /encrypt|password|FilePass|WorkbookEncryption|ECMA-376 Encrypted/i.test(message);
    return {
      ok: false,
      recoverable: true,
      errorKind: encrypted ? "validation" : "execution",
      error: encrypted
        ? "Legacy Excel (.xls) appears encrypted and cannot be read without a password."
        : `Legacy Excel (.xls) parse failed: ${message}`,
      data: {
        code: encrypted ? "XLS_ENCRYPTED" : "XLS_CORRUPT",
        path: filePath,
        sizeBytes: fileStat.size,
        productSaveAllowed: false,
        detail: message,
      },
    };
  }

  if (!workbook.SheetNames?.length) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "execution",
      error: "Legacy Excel (.xls) parsed but contained no worksheets.",
      data: {
        code: "XLS_CORRUPT",
        path: filePath,
        sizeBytes: fileStat.size,
        productSaveAllowed: false,
      },
    };
  }

  // Encrypted BIFF books often surface through FilePass / encryption markers.
  const workbookKeys = Object.keys(workbook).join(" ");
  if (/FilePass|EncryptionInfo|EncryptedPackage/i.test(workbookKeys + JSON.stringify(workbook.Workbook ?? {}))) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: "Legacy Excel (.xls) appears encrypted and cannot be read without a password.",
      data: {
        code: "XLS_ENCRYPTED",
        path: filePath,
        sizeBytes: fileStat.size,
        productSaveAllowed: false,
      },
    };
  }

  const { text, evidence } = buildXlsWorkbookEvidence(workbook, XLSX);
  if (!evidence.sheets.some((sheet) => sheet.nonEmptyCellCount > 0)) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "execution",
      error: "Legacy Excel (.xls) contained no readable cell values.",
      data: {
        code: "XLS_CORRUPT",
        path: filePath,
        sizeBytes: fileStat.size,
        productSaveAllowed: false,
        evidence,
      },
    };
  }

  return {
    ok: true,
    source: "xls:sheetjs-biff8",
    text,
    evidence,
  };
}

export async function getOpenworkRuntimeStatus(): Promise<Record<string, unknown>> {
  const sheetJs = await loadSheetJsModule();
  return {
    ok: true,
    executor: "local",
    stage: "runtime_status",
    data: {
      fileExtract: {
        xls: {
          available: Boolean(sheetJs),
          backend: "sheetjs-biff8",
          sofficeRequired: false,
          maxBytes: XLS_MAX_BYTES,
          codes: [
            "XLS_TOO_LARGE",
            "XLS_NOT_BIFF8",
            "XLS_CORRUPT",
            "XLS_ENCRYPTED",
            "LEGACY_XLS_DEPENDENCY_MISSING",
          ],
        },
        xlsx: {
          available: true,
          backend: "unzip-ooxml",
          sofficeRequired: false,
        },
        pdf: {
          available: true,
          backend: "pdfjs",
          sofficeRequired: false,
        },
      },
    },
  };
}

type PdfDocumentHandle = Awaited<ReturnType<typeof import("pdfjs-dist/legacy/build/pdf.mjs")["getDocument"]>>["promise"] extends Promise<infer T> ? T : never;

async function loadPdfDocument(filePath: string): Promise<PdfDocumentHandle> {
  const bundledCanvasUrl = new URL("./node_modules/@napi-rs/canvas/index.js", import.meta.url);
  const canvas = existsSync(fileURLToPath(bundledCanvasUrl))
    ? await import(bundledCanvasUrl.href) as typeof import("@napi-rs/canvas")
    : await import(["@napi-rs", "canvas"].join("/")) as typeof import("@napi-rs/canvas");
  Object.assign(globalThis, {
    DOMMatrix: canvas.DOMMatrix,
    ImageData: canvas.ImageData,
    Path2D: canvas.Path2D,
  });
  const bundledPdfUrl = new URL("./pdf-runtime.js", import.meta.url);
  const pdfjs = existsSync(fileURLToPath(bundledPdfUrl))
    ? await import(bundledPdfUrl.href) as typeof import("pdfjs-dist/legacy/build/pdf.mjs")
    : await import(["pdfjs-dist", "legacy/build/pdf.mjs"].join("/")) as typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  const bundledWorkerUrl = new URL("./pdf.worker.js", import.meta.url);
  if (existsSync(fileURLToPath(bundledWorkerUrl))) {
    pdfjs.GlobalWorkerOptions.workerSrc = bundledWorkerUrl.href;
  }
  const data = new Uint8Array(await readFile(filePath));
  return pdfjs.getDocument({ data, verbosity: pdfjs.VerbosityLevel.ERRORS }).promise;
}

function pdfPageText(items: unknown): string {
  if (!Array.isArray(items)) return "";
  const parts: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item) || typeof item.str !== "string") continue;
    parts.push(item.str, "hasEOL" in item && item.hasEOL === true ? "\n" : " ");
  }
  return cleanExtractedText(parts.join(""));
}

async function inspectLocalPdf(filePath: string): Promise<Record<string, unknown>> {
  const fileStat = await stat(filePath);
  const pdf = await loadPdfDocument(filePath);
  try {
    const metadata = await pdf.getMetadata().catch(() => null);
    return {
      ok: true,
      path: filePath,
      name: basename(filePath),
      sizeBytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
      pageCount: pdf.numPages,
      fingerprints: pdf.fingerprints,
      metadata: metadata?.info ?? null,
      source: "pdfjs",
    };
  } finally {
    await pdf.destroy();
  }
}

export function buildBoundedPdfTextWindow(input: {
  pages: Array<{ page: number; text: string }>;
  pageCount: number;
  startPage: number;
  startChar?: number;
  maxChars: number;
}) {
  const pageBlocks: string[] = [];
  const startChar = Math.max(0, input.startChar ?? 0);
  let returnedChars = 0;
  let lastPage = input.startPage;
  let nextStartPage: number | null = null;
  let nextStartChar = 0;
  let truncated = false;

  for (const page of input.pages) {
    lastPage = page.page;
    const pageText = page.text || "（未检测到可用文本层，需要渲染页面进行视觉识别）";
    const pageOffset = page.page === input.startPage ? Math.min(startChar, pageText.length) : 0;
    const prefix = `【第 ${page.page} 页】\n`;
    const separator = pageBlocks.length ? "\n\n" : "";
    const available = Math.max(0, input.maxChars - returnedChars - separator.length - prefix.length);
    const remaining = pageText.slice(pageOffset);
    const chunk = remaining.slice(0, available);
    if (available > 0) {
      pageBlocks.push(`${prefix}${chunk}`);
      returnedChars += separator.length + prefix.length + chunk.length;
    }
    if (chunk.length < remaining.length) {
      truncated = true;
      nextStartPage = page.page;
      nextStartChar = pageOffset + chunk.length;
      break;
    }
  }
  if (nextStartPage === null && lastPage < input.pageCount) {
    nextStartPage = lastPage + 1;
    nextStartChar = 0;
  }
  const text = pageBlocks.join("\n\n");
  return {
    extractedPages: { start: input.startPage, end: lastPage, startChar },
    hasMorePages: nextStartPage !== null,
    nextStartPage,
    nextStartChar: nextStartPage !== null ? nextStartChar : null,
    pageChars: input.pages.map((page) => page.text.length),
    chars: text.length,
    truncated,
    text,
  };
}

async function extractLocalPdfPages(
  filePath: string,
  options: { startPage?: number; startChar?: number; endPage?: number; maxChars: number },
): Promise<Record<string, unknown>> {
  const pdf = await loadPdfDocument(filePath);
  try {
    const startPage = Math.min(Math.max(1, options.startPage ?? 1), pdf.numPages);
    const startChar = Math.max(0, options.startChar ?? 0);
    const endPage = Math.min(Math.max(startPage, options.endPage ?? startPage + 4), pdf.numPages);
    const pages: Array<{ page: number; text: string }> = [];
    for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = pdfPageText(content.items);
      page.cleanup();
      pages.push({ page: pageNumber, text });
    }
    const window = buildBoundedPdfTextWindow({
      pages,
      pageCount: pdf.numPages,
      startPage,
      startChar,
      maxChars: options.maxChars,
    });
    return {
      ok: true,
      path: filePath,
      name: basename(filePath),
      source: "pdfjs:text-layer",
      pageCount: pdf.numPages,
      ...window,
    };
  } finally {
    await pdf.destroy();
  }
}

async function renderLocalPdfPages(
  filePath: string,
  requestedPages: number[] | undefined,
  scale: number,
): Promise<Record<string, unknown>> {
    const bundledCanvasUrl = new URL("./node_modules/@napi-rs/canvas/index.js", import.meta.url);
    const canvasModule = existsSync(fileURLToPath(bundledCanvasUrl))
      ? await import(bundledCanvasUrl.href) as typeof import("@napi-rs/canvas")
      : await import(["@napi-rs", "canvas"].join("/")) as typeof import("@napi-rs/canvas");
  const pdf = await loadPdfDocument(filePath);
  try {
    const pages = [...new Set(requestedPages?.length ? requestedPages : Array.from(
      { length: Math.min(pdf.numPages, 6) },
      (_, index) => index + 1,
    ))].filter((page) => page >= 1 && page <= pdf.numPages).slice(0, 12);
    if (!pages.length) throw new Error(`No requested page exists in this ${pdf.numPages}-page PDF.`);
    const fileKey = createHash("sha256").update(`${filePath}:${(await stat(filePath)).mtimeMs}`).digest("hex").slice(0, 16);
    const outputDir = join(tmpdir(), "wodeappx-pdf-pages", fileKey);
    await mkdir(outputDir, { recursive: true });
    const rendered: Array<{ page: number; path: string; width: number; height: number }> = [];
    for (const pageNumber of pages) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const canvasContext = canvas.getContext("2d");
      await page.render({
        canvas: canvas as never,
        canvasContext: canvasContext as never,
        viewport,
      }).promise;
      const outputPath = join(outputDir, `page-${String(pageNumber).padStart(3, "0")}.png`);
      await writeFile(outputPath, canvas.toBuffer("image/png"));
      rendered.push({ page: pageNumber, path: outputPath, width: canvas.width, height: canvas.height });
      page.cleanup();
    }
    return {
      ok: true,
      path: filePath,
      pageCount: pdf.numPages,
      rendered,
      instruction: "Use the image/file read tool on every returned path needed for visual conclusions. These page images are previews, not productImages.",
      source: "pdfjs:canvas",
    };
  } finally {
    await pdf.destroy();
  }
}

async function extractPdfText(filePath: string): Promise<{ source: string; text: string; warning?: string }> {
  try {
    const extracted = await extractLocalPdfPages(filePath, { maxChars: 200_000 });
    return { source: String(extracted.source), text: String(extracted.text ?? "") };
  } catch (error) {
    throw new Error(
      `PDF.js could not parse this PDF: ${error instanceof Error ? error.message : String(error)}. `
      + "The file was not treated as plain text; use openwork_pdf_render_pages only if the PDF itself is valid.",
    );
  }
}

async function extractPlainTextFile(
  filePath: string,
  offset: number,
  maxChars: number,
): Promise<{ text: string; complete: boolean }> {
  const fileStat = await stat(filePath);
  const maxBytes = Math.max((offset + maxChars + 1) * 8, 64_000);
  if (fileStat.size > maxBytes) {
    const result = await runProcess("/usr/bin/head", ["-c", String(maxBytes), filePath], { timeoutMs: 15_000 });
    if (result.code === 0) return { text: result.stdout, complete: false };
  }
  return { text: await readFile(filePath, "utf8"), complete: true };
}

async function extractLocalFileText(
  filePath: string,
  offset: number,
  maxChars: number,
): Promise<Record<string, unknown>> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: "Path is not a file.",
      data: { path: filePath },
    };
  }

  const ext = extname(filePath).toLowerCase();
  const textExts = new Set([".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonc", ".yaml", ".yml", ".html", ".htm", ".xml", ".svg", ".css", ".js", ".jsx", ".ts", ".tsx", ".py", ".rb", ".go", ".rs", ".java", ".c", ".cc", ".cpp", ".h", ".hpp", ".sh", ".sql"]);
  let extracted: { source: string; text: string; warning?: string; evidence?: XlsWorkbookEvidence };
  let sourceComplete = true;

  if (textExts.has(ext)) {
    const plainText = await extractPlainTextFile(filePath, offset, maxChars);
    sourceComplete = plainText.complete;
    extracted = { source: "utf8", text: plainText.text };
  } else if (ext === ".docx") {
    extracted = await extractDocxText(filePath);
  } else if (ext === ".pptx") {
    extracted = await extractPptxText(filePath);
  } else if (ext === ".xlsx") {
    extracted = await extractXlsxText(filePath);
  } else if (ext === ".xls") {
    const xlsResult = await extractXlsText(filePath);
    if (!xlsResult.ok) return xlsResult;
    extracted = {
      source: xlsResult.source,
      text: xlsResult.text,
      warning: xlsResult.warning,
      evidence: xlsResult.evidence,
    };
  } else if (ext === ".pdf") {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: "Use the dedicated PDF tools for bounded page-aware reading.",
      data: {
        code: "USE_PDF_TOOLS",
        path: filePath,
        fallbackTool: "openwork_pdf_info",
        nextTool: "openwork_pdf_extract_text",
      },
    };
  } else {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: "Unsupported text extraction type. Use openwork_file_preview or openwork_file_media_probe for this file.",
      data: {
        path: filePath,
        extension: ext,
        sizeBytes: fileStat.size,
        fallbackTool: "openwork_file_preview",
      },
    };
  }

  const cleaned = cleanExtractedText(extracted.text);
  const safeOffset = Math.min(offset, cleaned.length);
  const text = cleaned.slice(safeOffset, safeOffset + maxChars);
  const nextOffset = safeOffset + text.length;
  const hasMore = nextOffset < cleaned.length || !sourceComplete;
  return {
    ok: true,
    path: filePath,
    name: basename(filePath),
    extension: ext,
    sizeBytes: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString(),
    source: extracted.source,
    warning: extracted.warning,
    evidence: safeOffset === 0 ? extracted.evidence : undefined,
    evidenceIncluded: ext === ".xls" ? safeOffset === 0 && Boolean(extracted.evidence) : undefined,
    productSaveAllowed: ext === ".xls" ? true : undefined,
    offset: safeOffset,
    returnedChars: text.length,
    totalChars: sourceComplete ? cleaned.length : null,
    hasMore,
    nextOffset: hasMore ? nextOffset : null,
    truncated: hasMore,
    text,
    nextActions: hasMore
      ? [`Call openwork_file_extract_text again with offset=${nextOffset}.`]
      : [],
  };
}

function parseMdlsOutput(output: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([^=]+)=\s*(.*)$/);
    if (!match) continue;
    metadata[match[1].trim()] = match[2].trim();
  }
  return metadata;
}

async function probeLocalMedia(filePath: string): Promise<Record<string, unknown>> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) return { ok: false, path: filePath, error: "Path is not a file." };
  const mime = await runProcess("/usr/bin/file", ["-b", "--mime-type", filePath], { timeoutMs: 10_000 });
  const metadataResult = platform() === "darwin"
    ? await runProcess("/usr/bin/mdls", [
        "-name", "kMDItemContentType",
        "-name", "kMDItemKind",
        "-name", "kMDItemPixelWidth",
        "-name", "kMDItemPixelHeight",
        "-name", "kMDItemDurationSeconds",
        "-name", "kMDItemCodecs",
        "-name", "kMDItemPageCount",
        filePath,
      ], { timeoutMs: 15_000 })
    : null;
  const sips = /\.(png|jpe?g|gif|webp|tiff?|bmp|heic|heif)$/i.test(filePath) && platform() === "darwin"
    ? await runProcess("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", filePath], { timeoutMs: 10_000 })
    : null;

  return {
    ok: true,
    path: filePath,
    name: basename(filePath),
    extension: extname(filePath).toLowerCase(),
    sizeBytes: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString(),
    mimeType: mime.code === 0 ? mime.stdout.trim() : null,
    spotlight: metadataResult && metadataResult.code === 0 ? parseMdlsOutput(metadataResult.stdout) : null,
    imageInfo: sips && sips.code === 0 ? sips.stdout.trim() : null,
  };
}

async function createQuickLookPreview(filePath: string, size: number): Promise<Record<string, unknown>> {
  if (platform() !== "darwin") {
    return { ok: false, path: filePath, error: "Quick Look previews are only available on macOS." };
  }
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) return { ok: false, path: filePath, error: "Path is not a file." };
  const outputDir = join(tmpdir(), "wodeappx-file-previews");
  await mkdir(outputDir, { recursive: true });
  const result = await runProcess("/usr/bin/qlmanage", ["-t", "-s", String(size), "-o", outputDir, filePath], { timeoutMs: 60_000 });
  const names = await readdir(outputDir).catch(() => []);
  const base = basename(filePath);
  const candidates = names
    .filter((name) => name === `${base}.png` || name.startsWith(`${base}.`))
    .map((name) => join(outputDir, name));
  const previewPath = candidates.find((candidate) => existsSync(candidate)) ?? null;
  return {
    ok: result.code === 0 && Boolean(previewPath),
    path: filePath,
    outputDir,
    previewPath,
    size,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    error: result.code === 0 ? undefined : `qlmanage exited with ${result.code}`,
  };
}

function isPathInside(childPath: string, parentPath: string): boolean {
  const child = resolve(childPath);
  const parent = resolve(parentPath);
  return child === parent || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
}

function localFileAllowedRoots(context?: OpenCodeContext): string[] {
  return [...new Set([
    homedir(),
    tmpdir(),
    context?.directory,
    context?.worktree,
    process.cwd(),
  ].filter((item): item is string => Boolean(item)).map((item) => resolve(item)))];
}

function requireSafeLocalUserPath(filePath: string, context?: OpenCodeContext): void {
  const resolved = resolve(filePath);
  const allowed = localFileAllowedRoots(context);
  if (!allowed.some((root) => isPathInside(resolved, root))) {
    throw new Error(`Path is outside allowed user/workspace roots: ${resolved}`);
  }
}

function resolveLocalUserPath(input: string, context?: OpenCodeContext, baseDir?: string): string {
  const trimmed = input.trim();
  const expanded = trimmed === "~" ? homedir() : trimmed.startsWith("~/") ? join(homedir(), trimmed.slice(2)) : trimmed;
  if (isAbsolute(expanded)) return resolve(expanded);
  const base = baseDir ? resolveLocalFilePath(baseDir, context) : context?.directory ?? context?.worktree ?? process.cwd();
  return resolve(base, expanded);
}

function hasHiddenPathSegment(filePath: string, root: string): boolean {
  const relativePath = resolve(filePath).slice(resolve(root).length).split("/").filter(Boolean);
  return relativePath.some((segment) => segment.startsWith("."));
}

function localFileKindMatches(filePath: string, fileStat: Awaited<ReturnType<typeof stat>>, kind: string): boolean {
  if (!kind || kind === "any") return true;
  if (kind === "folder") return fileStat.isDirectory();
  if (!fileStat.isFile()) return false;
  if (kind === "file") return true;
  const ext = extname(filePath).toLowerCase();
  const groups: Record<string, Set<string>> = {
    image: new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".tif", ".tiff", ".bmp", ".heic", ".heif", ".svg"]),
    video: new Set([".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv", ".flv", ".wmv"]),
    audio: new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".aiff", ".aif"]),
    document: new Set([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".txt", ".md", ".csv", ".tsv", ".rtf"]),
  };
  return groups[kind]?.has(ext) ?? false;
}

async function spotlightFileSearch(query: string, root: string, limit: number): Promise<string[]> {
  if (platform() !== "darwin" || !existsSync("/usr/bin/mdfind")) return [];
  const result = await runProcess("/usr/bin/mdfind", ["-onlyin", root, query], { timeoutMs: 12_000 });
  if (result.code !== 0) return [];
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, limit);
}

async function walkFileSearch(query: string, root: string, limit: number, includeHidden: boolean): Promise<string[]> {
  const lowerQuery = query.toLowerCase();
  const results: string[] = [];
  const stack = [root];
  let visited = 0;
  const maxVisited = 25_000;
  const skippedDirs = new Set([".git", "node_modules", ".Trash"]);

  while (stack.length && results.length < limit && visited < maxVisited) {
    const dir = stack.pop();
    if (!dir) continue;
    visited += 1;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) continue;
    for (const entry of entries) {
      if (!includeHidden && entry.name.startsWith(".")) continue;
      const fullPath = join(dir, entry.name);
      if (entry.name.toLowerCase().includes(lowerQuery)) {
        results.push(fullPath);
        if (results.length >= limit) break;
      }
      if (entry.isDirectory() && !skippedDirs.has(entry.name)) {
        stack.push(fullPath);
      }
    }
  }

  return results;
}

async function searchLocalFiles(rawArgs: z.infer<typeof localFileSearchArgsSchema>, context?: OpenCodeContext): Promise<Record<string, unknown>> {
  const limit = rawArgs.limit ?? 50;
  const kind = rawArgs.kind ?? "any";
  const root = resolveLocalUserPath(rawArgs.root ?? context?.directory ?? context?.worktree ?? homedir(), context);
  requireSafeLocalUserPath(root, context);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) return { ok: false, root, error: "Search root is not a directory." };

  const candidateLimit = Math.min(limit * 4, 500);
  const candidates = [
    ...(await spotlightFileSearch(rawArgs.query, root, candidateLimit)),
    ...(await walkFileSearch(rawArgs.query, root, candidateLimit, Boolean(rawArgs.includeHidden))),
  ];
  const seen = new Set<string>();
  const results: Array<Record<string, unknown>> = [];

  for (const candidate of candidates) {
    const filePath = resolve(candidate);
    if (seen.has(filePath) || !isPathInside(filePath, root)) continue;
    seen.add(filePath);
    if (!rawArgs.includeHidden && hasHiddenPathSegment(filePath, root)) continue;
    let fileStat: Awaited<ReturnType<typeof stat>>;
    try {
      fileStat = await stat(filePath);
    } catch {
      continue;
    }
    if (!localFileKindMatches(filePath, fileStat, kind)) continue;
    results.push({
      path: filePath,
      name: basename(filePath),
      kind: fileStat.isDirectory() ? "folder" : "file",
      extension: fileStat.isFile() ? extname(filePath).toLowerCase() : "",
      sizeBytes: fileStat.isFile() ? fileStat.size : null,
      modifiedAt: fileStat.mtime.toISOString(),
    });
    if (results.length >= limit) break;
  }

  return {
    ok: true,
    root,
    query: rawArgs.query,
    kind,
    returned: results.length,
    results,
  };
}

type LocalFileBatchOperation = {
  action: "copy" | "move" | "rename" | "mkdir";
  source?: string;
  destination: string;
  overwrite?: boolean;
};

type LocalFileBatchPlanOperation = LocalFileBatchOperation & {
  index: number;
  sourcePath?: string;
  destinationPath: string;
  status: "ready" | "blocked";
  reason?: string;
  sourceKind?: "file" | "folder";
  sizeBytes?: number | null;
  destinationExists?: boolean;
};

function localFileBatchPlanDir(): string {
  return join(tmpdir(), "wodeappx-file-batch-plans");
}

function localFileBatchPlanPath(planId: string): string {
  if (!/^wodeappx-[a-z0-9-]+$/i.test(planId)) {
    throw new Error("Invalid planId.");
  }
  return join(localFileBatchPlanDir(), `${planId}.json`);
}

async function normalizeLocalFileBatchOperation(
  operation: LocalFileBatchOperation,
  index: number,
  context?: OpenCodeContext,
  baseDir?: string,
): Promise<LocalFileBatchPlanOperation> {
  const destinationPath = resolveLocalUserPath(operation.destination, context, baseDir);
  requireSafeLocalUserPath(destinationPath, context);

  const planned: LocalFileBatchPlanOperation = {
    ...operation,
    index,
    destinationPath,
    status: "ready",
  };

  if (operation.action === "mkdir") {
    const existing = await stat(destinationPath).catch(() => null);
    planned.destinationExists = Boolean(existing);
    if (existing && !existing.isDirectory()) {
      planned.status = "blocked";
      planned.reason = "Destination exists and is not a folder.";
    }
    return planned;
  }

  if (!operation.source) {
    return { ...planned, status: "blocked", reason: "Source path is required for this action." };
  }

  const sourcePath = resolveLocalUserPath(operation.source, context, baseDir);
  requireSafeLocalUserPath(sourcePath, context);
  planned.sourcePath = sourcePath;

  const sourceStat = await stat(sourcePath).catch(() => null);
  if (!sourceStat) {
    planned.status = "blocked";
    planned.reason = "Source path does not exist.";
    return planned;
  }
  planned.sourceKind = sourceStat.isDirectory() ? "folder" : "file";
  planned.sizeBytes = sourceStat.isFile() ? sourceStat.size : null;

  if (operation.action === "copy" && !sourceStat.isFile()) {
    planned.status = "blocked";
    planned.reason = "Copy currently supports files only.";
    return planned;
  }

  const destinationParent = dirname(destinationPath);
  const parentStat = await stat(destinationParent).catch(() => null);
  if (!parentStat || !parentStat.isDirectory()) {
    planned.status = "blocked";
    planned.reason = "Destination parent folder does not exist.";
    return planned;
  }

  const destinationStat = await stat(destinationPath).catch(() => null);
  planned.destinationExists = Boolean(destinationStat);
  if (destinationStat && !operation.overwrite) {
    planned.status = "blocked";
    planned.reason = "Destination already exists. Set overwrite:true only when replacement is intended.";
  }

  return planned;
}

async function buildLocalFileBatchPlan(
  operations: LocalFileBatchOperation[],
  context?: OpenCodeContext,
  baseDir?: string,
): Promise<Record<string, unknown>> {
  const planned: LocalFileBatchPlanOperation[] = [];
  for (let index = 0; index < operations.length; index += 1) {
    planned.push(await normalizeLocalFileBatchOperation(operations[index], index, context, baseDir));
  }

  const planId = `wodeappx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const blocked = planned.filter((item) => item.status === "blocked");
  const plan = {
    ok: blocked.length === 0,
    planId,
    operationCount: planned.length,
    blockedCount: blocked.length,
    createdAt: new Date().toISOString(),
    dryRun: true,
    baseDir,
    operations: planned,
  };
  await mkdir(localFileBatchPlanDir(), { recursive: true });
  await writeFile(localFileBatchPlanPath(planId), JSON.stringify(plan, null, 2), "utf8");
  return plan;
}

async function readLocalFileBatchPlan(planId: string): Promise<{ operations: LocalFileBatchOperation[]; baseDir?: string }> {
  const content = await readFile(localFileBatchPlanPath(planId), "utf8");
  const plan = JSON.parse(content) as { operations?: Array<LocalFileBatchPlanOperation & LocalFileBatchOperation>; baseDir?: string };
  if (!Array.isArray(plan.operations)) throw new Error("Plan file does not contain operations.");
  return { operations: plan.operations, baseDir: plan.baseDir };
}

async function openLocalDirectory(dirPath: string): Promise<Record<string, unknown>> {
  const fileStat = await stat(dirPath);
  if (!fileStat.isDirectory()) {
    return { ok: false, path: dirPath, error: "Path is not a directory." };
  }
  const os = platform();
  if (os === "darwin") {
    const result = await runProcess("/usr/bin/open", [dirPath], { timeoutMs: 15_000 });
    if (result.code !== 0) {
      return { ok: false, path: dirPath, error: result.stderr.trim() || `open exited with ${result.code}` };
    }
    return { ok: true, path: dirPath, platform: os };
  }
  if (os === "win32") {
    const result = await runProcess("explorer.exe", [dirPath], { timeoutMs: 15_000 });
    if (result.code !== 0) {
      return { ok: false, path: dirPath, error: result.stderr.trim() || `explorer exited with ${result.code}` };
    }
    return { ok: true, path: dirPath, platform: os };
  }
  const result = await runProcess("xdg-open", [dirPath], { timeoutMs: 15_000 });
  if (result.code !== 0) {
    return { ok: false, path: dirPath, error: result.stderr.trim() || `xdg-open exited with ${result.code}` };
  }
  return { ok: true, path: dirPath, platform: os };
}

async function applyLocalFileBatchPlan(
  operations: LocalFileBatchOperation[],
  context?: OpenCodeContext,
  baseDir?: string,
): Promise<Record<string, unknown>> {
  const preview = await buildLocalFileBatchPlan(operations, context, baseDir);
  const planned = preview.operations as LocalFileBatchPlanOperation[];
  const blocked = planned.filter((item) => item.status === "blocked");
  if (blocked.length) {
    return {
      ok: false,
      error: "Batch plan has blocked operations. Nothing was changed.",
      blocked,
      plan: preview,
    };
  }

  const applied: Array<Record<string, unknown>> = [];
  for (const operation of planned) {
    if (operation.action === "mkdir") {
      await mkdir(operation.destinationPath, { recursive: true });
    } else if (operation.action === "copy") {
      await copyFile(operation.sourcePath ?? "", operation.destinationPath);
    } else {
      await rename(operation.sourcePath ?? "", operation.destinationPath);
    }
    applied.push({
      index: operation.index,
      action: operation.action,
      source: operation.sourcePath,
      destination: operation.destinationPath,
    });
  }

  return {
    ok: true,
    appliedCount: applied.length,
    applied,
  };
}

const MAX_PAGE_IMPORT_HTML_BYTES = 1_500_000;

function resolveWodeAppMainApiBase(): string {
  const origin = (
    process.env.WODEAPP_ORIGIN
    || process.env.VITE_WODEAPP_ORIGIN
    || "https://wodeapp.cn"
  ).trim().replace(/\/+$/, "");
  return (
    process.env.WODEAPPX_MAIN_API_BASE
    || process.env.WODEAPP_MAIN_API_BASE
    || `${origin}/mainserver/api`
  ).replace(/\/+$/, "");
}

function resolveWodeAppApiKey(): string {
  return (
    process.env.WODEAPPX_API_KEY
    || process.env.WODEAPP_API_KEY
    || ""
  ).trim();
}

async function wodeAppMainserverJson(
  path: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null; text: string }> {
  const apiKey = resolveWodeAppApiKey();
  if (!apiKey) {
    return {
      ok: false,
      status: 401,
      json: null,
      text: "WODEAPP_API_KEY is not set in the OpenWork engine process.",
    };
  }
  const url = `${resolveWodeAppMainApiBase()}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("X-API-Key", apiKey);
  headers.set("Authorization", `Bearer ${apiKey}`);
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        json = parsed as Record<string, unknown>;
      }
    } catch {
      json = null;
    }
  }
  return { ok: response.ok, status: response.status, json, text };
}

function summarizeImportedPage(page: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const configRaw = page?.config;
  let sectionsCount = 0;
  let sectionTypes: string[] = [];
  let customCodeChars = 0;
  let config: Record<string, unknown> | null = null;
  if (typeof configRaw === "string") {
    try {
      const parsed: unknown = JSON.parse(configRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config = parsed as Record<string, unknown>;
    } catch {
      config = null;
    }
  } else if (configRaw && typeof configRaw === "object" && !Array.isArray(configRaw)) {
    config = configRaw as Record<string, unknown>;
  }
  const sections = Array.isArray(config?.sections) ? config.sections : [];
  sectionsCount = sections.length;
  sectionTypes = sections
    .map((section) => {
      if (!section || typeof section !== "object") return "unknown";
      const type = Reflect.get(section, "type");
      return typeof type === "string" && type.trim() ? type : "unknown";
    })
    .slice(0, 12);
  for (const section of sections) {
    if (!section || typeof section !== "object") continue;
    const props = Reflect.get(section, "props");
    if (!props || typeof props !== "object") continue;
    const code = Reflect.get(props, "code");
    if (typeof code === "string") customCodeChars += code.length;
  }
  return {
    id: typeof page?.id === "string" ? page.id : undefined,
    path: typeof page?.path === "string" ? page.path : undefined,
    title: typeof page?.title === "string" ? page.title : undefined,
    sectionsCount,
    sectionTypes,
    customCodeChars,
  };
}

async function importPageFromLocalHtmlFile(
  args: {
    projectId: string;
    sourcePath: string;
    pageId?: string;
    path?: string;
    title?: string;
  },
  context?: OpenCodeContext,
): Promise<Record<string, unknown>> {
  const projectId = args.projectId.trim();
  if (!projectId) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: "projectId is required.",
      data: { code: "PROJECT_ID_REQUIRED" },
    };
  }

  const sourcePath = resolveLocalFilePath(args.sourcePath, context);
  requireSafeLocalUserPath(sourcePath, context);
  const sourceStat = await stat(sourcePath).catch(() => null);
  if (!sourceStat || !sourceStat.isFile()) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: `Local HTML file not found: ${sourcePath}`,
      data: { code: "SOURCE_FILE_MISSING", sourcePath },
    };
  }
  if (sourceStat.size > MAX_PAGE_IMPORT_HTML_BYTES) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: `HTML file too large (${sourceStat.size} bytes; max ${MAX_PAGE_IMPORT_HTML_BYTES}).`,
      data: { code: "HTML_TOO_LARGE", sourcePath, byteLength: sourceStat.size },
    };
  }

  const html = await readFile(sourcePath, "utf8");
  const byteLength = Buffer.byteLength(html, "utf8");
  if (!html.trim()) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: "HTML file is empty.",
      data: { code: "HTML_EMPTY", sourcePath },
    };
  }
  if (byteLength > MAX_PAGE_IMPORT_HTML_BYTES) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: `HTML too large (${byteLength} bytes; max ${MAX_PAGE_IMPORT_HTML_BYTES}).`,
      data: { code: "HTML_TOO_LARGE", sourcePath, byteLength },
    };
  }

  let pageId = typeof args.pageId === "string" ? args.pageId.trim() : "";
  const title = typeof args.title === "string" ? args.title.trim() : "";
  const pathRaw = typeof args.path === "string" ? args.path.trim() : "";
  const createdPage = !pageId;

  if (!pageId) {
    if (!pathRaw || !title) {
      return {
        ok: false,
        recoverable: true,
        errorKind: "validation",
        error: "Provide pageId to update an existing page, or path + title to create a new page.",
        data: {
          code: "PAGE_TARGET_REQUIRED",
          nextActions: [
            "Pass pageId from create_project / list_pages, or pass path and title to create a page.",
          ],
        },
      };
    }
    const normalizedPath = pathRaw.startsWith("/") ? pathRaw : `/${pathRaw}`;
    const createRes = await wodeAppMainserverJson(`/json-schema/projects/${encodeURIComponent(projectId)}/pages`, {
      method: "POST",
      body: JSON.stringify({
        path: normalizedPath,
        title,
        config: { title, path: normalizedPath, mode: "real", sections: [] },
      }),
    });
    if (!createRes.ok) {
      return {
        ok: false,
        recoverable: true,
        errorKind: "execution",
        error: `Failed to create page (HTTP ${createRes.status}): ${(createRes.json?.error as string) || createRes.text.slice(0, 400)}`,
        data: {
          code: "PAGE_CREATE_FAILED",
          status: createRes.status,
          fallbackTool: "create_page",
        },
      };
    }
    const created = createRes.json?.data;
    const createdId =
      created && typeof created === "object" && !Array.isArray(created)
        ? Reflect.get(created, "id")
        : undefined;
    if (typeof createdId !== "string" || !createdId.trim()) {
      return {
        ok: false,
        recoverable: true,
        errorKind: "execution",
        error: "Page create succeeded but returned no page id.",
        data: { code: "PAGE_CREATE_NO_ID" },
      };
    }
    pageId = createdId.trim();
  }

  const importRes = await wodeAppMainserverJson(
    `/json-schema/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(pageId)}/import-html`,
    {
      method: "POST",
      body: JSON.stringify({
        html,
        ...(title ? { title } : {}),
      }),
    },
  );
  if (!importRes.ok) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "execution",
      error: `import-html failed (HTTP ${importRes.status}): ${(importRes.json?.error as string) || importRes.text.slice(0, 400)}`,
      data: {
        code: "IMPORT_HTML_FAILED",
        status: importRes.status,
        pageId,
        sourcePath,
        scanIssues: importRes.json?.scanIssues,
        nextActions: [
          "Fix the local HTML file, then retry wodeapp_page_import_from_file with the same sourcePath.",
          "Do not paste the HTML into update_page.config.",
        ],
      },
    };
  }

  const page =
    importRes.json?.data && typeof importRes.json.data === "object" && !Array.isArray(importRes.json.data)
      ? (importRes.json.data as Record<string, unknown>)
      : null;
  const meta =
    importRes.json?.meta && typeof importRes.json.meta === "object" && !Array.isArray(importRes.json.meta)
      ? (importRes.json.meta as Record<string, unknown>)
      : undefined;

  return {
    ok: true,
    executor: "local",
    stage: "page_import_from_file",
    data: {
      projectId,
      pageId,
      sourcePath,
      createdPage,
      byteLength,
      page: summarizeImportedPage(page),
      meta,
    },
    warnings: [],
    nextActions: [
      "Call publish_project with the same projectId after verifying sectionsCount > 0.",
      "Do not call update_page with mega CustomCode / template-configs.",
    ],
  };
}

function serverUrl(): string {
  return String(process.env.OPENWORK_SERVER_URL || "").replace(/\/$/, "");
}

function serverToken(): string {
  return String(process.env.OPENWORK_SERVER_TOKEN || "");
}

function requireOpenWorkServer(): { url: string; token: string } {
  const url = serverUrl();
  const token = serverToken();
  if (!url || !token) {
    throw new Error("WodeAppX extension tools are only available when OpenCode is launched by WodeAppX.");
  }
  return { url, token };
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return { message: text };
  }
}

function getStringProperty(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const property = Reflect.get(value, key);
  return typeof property === "string" ? property : null;
}

function addContext(payload: unknown, context: OpenCodeContext): object {
  if (typeof payload === "object" && payload !== null && !Array.isArray(payload)) {
    return Object.assign({}, payload, { context: contextPayload(context) });
  }
  return { payload, context: contextPayload(context) };
}

function errorMessage(payload: unknown, fallback: string): string {
  return getStringProperty(payload, "message") ?? getStringProperty(payload, "code") ?? fallback;
}

async function postJson(path: string, body: ExtensionActionPayload): Promise<unknown> {
  const { url, token } = requireOpenWorkServer();
  const response = await fetch(url + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await parseResponse(response);
  if (!response.ok) {
    throw new Error(errorMessage(payload, "WodeAppX extension call failed"));
  }
  return assertToolResultSucceeded(payload, "WodeAppX extension call failed");
}

function contextPayload(context: OpenCodeContext) {
  return {
    agent: context.agent,
    sessionId: context.sessionID,
    messageId: context.messageID,
    directory: context.directory,
    worktree: context.worktree,
  };
}

type ContractToolDefinition = {
  execute?: (args: unknown, context: unknown) => unknown | Promise<unknown>;
  [key: string]: unknown;
};

/** One registration boundary for every WodeAppX/OpenWork extension tool. */
export function wrapToolDefinitionsWithContract<T extends Record<string, object>>(definitions: T): T {
  return Object.fromEntries(Object.entries(definitions).map(([name, definition]) => {
    const tool = definition as ContractToolDefinition;
    if (typeof tool.execute !== "function") return [name, definition];
    const original = tool.execute;
    return [name, {
      ...definition,
      execute(args: unknown, context: unknown) {
        return executeWithContract(original, args, context, `${name} failed.`);
      },
    }];
  })) as T;
}

export const OpenWorkExtensionsPreview = async (pluginInput: OpenCodePluginInput = {}) => {
  const directTools = buildWodeAppDirectTools({
    bridgeRequest: uiBridgeRequest,
    executeTimeoutMs: BRIDGE_EXECUTE_TIMEOUT_MS,
  });
  const definitions = {
    ...(await WodeAppXShopify()).tool,
    knowledge_search: buildWodeAppKnowledgeSearchTool(),
    ...directTools,
    /**
     * OpenCode sometimes surfaces a built-in placeholder tool named `invalid`
     * in the model-visible tool list. MiniMax then calls it (86 local samples).
     * Shadow it with an actionable recoverable redirect instead of a dead error.
     */
    invalid: {
      description:
        "Do not call this tool. It is not a real capability. If you see it in the tool list, ignore it and call wodeappx_search_tools, wodeappx_list_capabilities, or openwork_ui_list_actions to discover valid tools, then retry the user task with a real tool name.",
      args: {},
      async execute() {
        return asJsonText({
          ok: false,
          recoverable: true,
          errorKind: "validation",
          code: "invalid_tool_placeholder",
          error:
            "Do not call tool `invalid`. It is a placeholder, not a real action. Call wodeappx_search_tools, wodeappx_list_capabilities, or openwork_ui_list_actions, pick a real tool for the user task, and retry. Do not stop after this message.",
          data: {
            code: "INVALID_TOOL_PLACEHOLDER",
            fallbackTools: ["wodeappx_search_tools", "wodeappx_list_capabilities", "openwork_ui_list_actions", "openwork_ui_execute_action"],
          },
          userVisibleSummary: "刚才误点了无效工具占位符，正在改用真实能力继续任务。",
        });
      },
    },
    agent_reach_status: {
      description: "Check WodeAppX local internet capability status: installed upstream commands, OpenCLI readiness, and built-in read-only Agent Reach style tools.",
      args: {},
      async execute() {
        return asJsonText(await agentReachStatus());
      },
    },
    agent_reach_web_search: {
      description: "Search the public web for current information and return titles, snippets, and source URLs. Use this for news, recent facts, prices, schedules, public figures, and any query that may have changed.",
      args: agentReachWebSearchArgsSchema.shape,
      async execute(rawArgs: unknown) {
        try {
          const args = agentReachWebSearchArgsSchema.parse(rawArgs);
          return asJsonText(await agentReachWebSearch(args));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    agent_reach_weather: {
      description: "Get current weather, a daily forecast, and the next 24 hourly observations for a city or place. Uses Open-Meteo and requires no API key.",
      args: agentReachWeatherArgsSchema.shape,
      async execute(rawArgs: unknown) {
        try {
          const args = agentReachWeatherArgsSchema.parse(rawArgs);
          return asJsonText(await agentReachWeather(args));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    agent_reach_web_read: {
      description: "Read a public web page as text. Uses Jina Reader first and direct fetch fallback. Use this for known URLs before general browser automation.",
      args: agentReachWebReadArgsSchema.shape,
      async execute(rawArgs: unknown) {
        try {
          const args = agentReachWebReadArgsSchema.parse(rawArgs);
          return asJsonText(await agentReachWebRead(args));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    agent_reach_rss_read: {
      description: "Read a public RSS or Atom feed and return recent items. This is read-only and does not require a browser or MCP server.",
      args: agentReachRssReadArgsSchema.shape,
      async execute(rawArgs: unknown) {
        try {
          const args = agentReachRssReadArgsSchema.parse(rawArgs);
          return asJsonText(await agentReachRssRead(args));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    agent_reach_youtube_transcript: {
      description: "Extract YouTube video metadata and transcript through local yt-dlp. Requires yt-dlp installed on the user's machine.",
      args: agentReachYoutubeTranscriptArgsSchema.shape,
      async execute(rawArgs: unknown) {
        try {
          const args = agentReachYoutubeTranscriptArgsSchema.parse(rawArgs);
          return asJsonText(await agentReachYoutubeTranscript(args));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    video_resolve_link: {
      description: "Resolve a public video URL locally into platform, video id, resolved URL, and canonical URL. This performs no media extraction and should be the first step for online video links.",
      args: localVideoResolveArgsSchema.shape,
      async execute(rawArgs: unknown) {
        try {
          const args = localVideoResolveArgsSchema.parse(rawArgs);
          return asJsonText(await localVideoResolve(args));
        } catch (error) {
          return asJsonText({ ok: false, executor: "local", stage: "resolve_link", error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    video_extract_metadata: {
      description: "Extract video metadata and a playable media URL locally with yt-dlp. Call video_resolve_link first. This does not download, transcribe, analyze, or modify the video.",
      args: localVideoExtractMetadataArgsSchema.shape,
      async execute(rawArgs: unknown) {
        try {
          const args = localVideoExtractMetadataArgsSchema.parse(rawArgs);
          return asJsonText(await localVideoExtractMetadata(args));
        } catch (error) {
          return asJsonText({
            ok: false,
            recoverable: true,
            errorKind: "execution",
            executor: "local",
            stage: "extract_metadata",
            error: error instanceof Error ? error.message : String(error),
            fallbackTool: "video_parse_link",
            data: { code: "LOCAL_EXTRACTION_FAILED", fallbackTool: "video_parse_link" },
          });
        }
      },
    },
    agent_reach_bilibili_search: {
      description: "Search Bilibili videos through the public search API. Use this for discovery; use real Chrome/OpenCLI only when login-required content is needed.",
      args: agentReachBilibiliSearchArgsSchema.shape,
      async execute(rawArgs: unknown) {
        try {
          const args = agentReachBilibiliSearchArgsSchema.parse(rawArgs);
          return asJsonText(await agentReachBilibiliSearch(args));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    agent_reach_v2ex: {
      description: "Read V2EX public data: hot topics, node topics, topic replies, or user profile.",
      args: agentReachV2exArgsSchema.shape,
      async execute(rawArgs: unknown) {
        try {
          const args = agentReachV2exArgsSchema.parse(rawArgs);
          return asJsonText(await agentReachV2ex(args));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    openwork_extension_list_actions: {
      description: `List extension actions currently exposed by WodeAppX. ${OPENWORK_EXTENSION_DISCOVERY_INSTRUCTION}`,
      args: listActionsArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const args = listActionsArgsSchema.parse(rawArgs);
        const query = args.extensionId ? `?extensionId=${encodeURIComponent(args.extensionId)}` : "";
        const { url, token } = requireOpenWorkServer();
        const response = await fetch(`${url}/experimental/extensions/actions${query}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = await parseResponse(response);
        if (!response.ok) throw new Error(errorMessage(payload, "WodeAppX extension action listing failed"));
        return JSON.stringify(addContext(payload, context), null, 2);
      },
    },
    openwork_extension_call: {
      description: `Call a WodeAppX extension action. Use openwork_extension_list_actions first to inspect available actions and schemas. ${OPENWORK_EXTENSION_DISCOVERY_INSTRUCTION}`,
      args: callArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const args = callArgsSchema.parse(rawArgs);
        const payload = await postJson("/experimental/extensions/call", {
          extensionId: args.extensionId,
          action: args.action,
          args: args.args ?? {},
          context: contextPayload(context),
        });
        return JSON.stringify(payload, null, 2);
      },
    },
    openwork_ui_snapshot: {
      description: "Get a snapshot of the current WodeAppX UI state: active route, narration, visible actions, and status. Use this to understand what the user sees before taking action.",
      args: {},
      async execute() {
        const result = await uiBridgeRequest("/snapshot");
        return JSON.stringify(result, null, 2);
      },
    },
    openwork_ui_list_actions: {
      description: `List runtime UI controls currently available through the generic executor. ${OPENWORK_UI_CONTROL_INSTRUCTION}`,
      args: {},
      async execute() {
        const payload = await uiBridgeRequest("/actions");
        return JSON.stringify({ ok: true, actions: modelVisibleUiActions(payload) }, null, 2);
      },
    },
    openwork_ui_execute_action: {
      description: `Execute a runtime UI control allowed by the live registry. ${OPENWORK_UI_CONTROL_INSTRUCTION}`,
      args: uiExecuteArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const { actionId, args } = uiExecuteArgsSchema.parse(rawArgs);
        const actions = await uiBridgeRequest("/actions");
        const validatedArgs = assertUiActionInvocation(actions, actionId, args);
        const callerSessionId = typeof context?.sessionID === "string" ? context.sessionID.trim() : "";
        const result = await uiBridgeRequest("/execute", {
          method: "POST",
          body: {
            actionId,
            args: validatedArgs,
            ...(callerSessionId ? { sessionId: callerSessionId } : {}),
          },
          timeoutMs: BRIDGE_EXECUTE_TIMEOUT_MS,
        });
        return JSON.stringify(result, null, 2);
      },
    },
    openwork_browser_open_url: {
      description: "Open a URL in the WodeAppX built-in browser and return the exact CDP browser_url and target_id to use for browser_* automation tools. Always use this before browser_snapshot/click/fill/eval for web browsing tasks.",
      args: browserOpenUrlArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = browserOpenUrlArgsSchema.parse(rawArgs);
        const result = await uiBridgeRequest("/execute", {
          method: "POST",
          body: {
            actionId: "browser.open_url",
            args: { url: args.url, provider: args.provider ?? "builtin" },
          },
        });
        return JSON.stringify(result, null, 2);
      },
    },
    openwork_browser_set_proxy: {
      description: "Route all WodeAppX built-in browser traffic through an HTTP/SOCKS proxy — for example to fetch search results or pages as seen from another location. Applies to every built-in browser tab (including browser_* automation) until cleared with openwork_browser_clear_proxy. If the user has named proxies configured as OPENWORK_BROWSER_PROXY_<NAME> environment variables, pass env:NAME instead of a raw URL.",
      args: browserSetProxyArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = browserSetProxyArgsSchema.parse(rawArgs);
        const result = await uiBridgeRequest("/execute", {
          method: "POST",
          body: { actionId: "browser.set_proxy", args: { proxy: args.proxy } },
        });
        return JSON.stringify(result, null, 2);
      },
    },
    openwork_browser_clear_proxy: {
      description: "Clear the WodeAppX built-in browser proxy and restore the system network settings.",
      args: {},
      async execute() {
        const result = await uiBridgeRequest("/execute", {
          method: "POST",
          body: { actionId: "browser.set_proxy", args: { proxy: "" } },
        });
        return JSON.stringify(result, null, 2);
      },
    },
    openwork_capture_start: {
      description: "Start WodeAppX system-level media capture without starting an MCP server. This prepares the local capture runtime if needed, enables the local proxy automatically, and records image/video/audio/json responses from system HTTP/HTTPS traffic.",
      args: {},
      async execute() {
        const result = await uiBridgeRequest("/capture/start", {
          method: "POST",
          body: {},
          timeoutMs: 420_000,
        });
        return formatCaptureStatus(result);
      },
    },
    openwork_capture_authorize_https: {
      description: "Open the explicit HTTPS deep-capture authorization flow without starting an MCP server. This starts capture if needed, generates the local CA, and opens the OS/browser trust flow so the user can approve it.",
      args: {},
      async execute() {
        const result = await uiBridgeRequest("/capture/authorize-https", {
          method: "POST",
          body: {},
          timeoutMs: 420_000,
        });
        return formatCaptureStatus(result);
      },
    },
    openwork_capture_stop: {
      description: "Stop WodeAppX system-level media capture and restore the system proxy settings saved before capture started.",
      args: {},
      async execute() {
        const result = await uiBridgeRequest("/capture/stop", {
          method: "POST",
          body: {},
          timeoutMs: 30_000,
        });
        return formatCaptureStatus(result);
      },
    },
    openwork_capture_list: {
      description: "List media items captured by WodeAppX without starting an MCP server. Filter by kind to inspect videos, images, audio, or JSON endpoints.",
      args: captureListArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const { kind, limit, includeHeaders } = captureListArgsSchema.parse(rawArgs);
        const result = await uiBridgeRequest(captureItemsPath(kind, limit), {
          timeoutMs: 15_000,
        });
        const data = asRecord(result);
        if (!Array.isArray(data.items) || data.items.length === 0) {
          return `${formatCaptureStatus(result)}\nNo captured items yet.`;
        }
        const items = data.items.map((item, index) => formatCaptureItem(item, index, { includeHeaders })).join("\n\n");
        return `${formatCaptureStatus(result)}\n\n${items}`;
      },
    },
    openwork_capture_clear: {
      description: "Clear the WodeAppX media capture list without stopping capture.",
      args: {},
      async execute() {
        const result = await uiBridgeRequest("/capture/clear", {
          method: "POST",
          body: {},
          timeoutMs: 15_000,
        });
        return formatCaptureStatus(result);
      },
    },
    openwork_capture_status: {
      description: "Check WodeAppX system-level media capture status without starting an MCP server.",
      args: {},
      async execute() {
        const result = await uiBridgeRequest("/capture/status", { timeoutMs: 10_000 });
        return formatCaptureStatus(result);
      },
    },
    openwork_runtime_status: {
      description: "Report local runtime extraction capabilities for documents such as BIFF8 .xls, OOXML .xlsx, and PDF. Use this when diagnosing whether Legacy Excel reading is available without LibreOffice/soffice.",
      args: {},
      async execute() {
        return asJsonText(await getOpenworkRuntimeStatus());
      },
    },
    openwork_attachment_context_read: {
      description: "Read a locally cached attachment context by the exact contextRefId in conversation history. Returns bounded text, stable local media paths, and a next offset for continuation.",
      args: attachmentContextReadArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const parsed = attachmentContextReadArgsSchema.safeParse(rawArgs);
        if (!parsed.success) {
          return asJsonText({
            ok: false,
            recoverable: true,
            errorKind: "validation",
            error: parsed.error.message,
          });
        }
        return asJsonText(await readAttachmentContextPack(
          parsed.data.refId,
          parsed.data.offset ?? 0,
          parsed.data.maxChars ?? 20_000,
        ));
      },
    },
    image_inspect: {
      description: "Inspect a local raster image before editing. Returns exact pixel dimensions, aspect ratio, file size, and path without changing the file. For pixels use openwork_media_view (local path, https://, or image-proxy) or chat attachments. Never call OpenCode read on PNG/JPEG paths.",
      args: imageInspectArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const args = imageInspectArgsSchema.parse(rawArgs);
        return asJsonText(await LOCAL_IMAGE_TOOL_IMPLEMENTATIONS.image_inspect(args.path, context));
      },
    },
    openwork_media_view: {
      description: "Attach a bounded JPEG preview for the current turn so the model can see pixels. Accepts a local raster path, https:// image URL, or image-proxy path (/runtime-server/api/image-proxy/<id>). Caps longest edge (default 1280, max 1536) and preview bytes (~512KB). Use this to visually QA generated image-proxy links. Prefer this over OpenCode read on PNG/JPEG. Do not set maxEdge above 1536.",
      args: openworkMediaViewArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const args = openworkMediaViewArgsSchema.parse(rawArgs);
        const { createBoundedImagePreview, isRemoteImageSource } = await import("./bounded-image-preview.js");
        const source = args.path.trim();
        const path = isRemoteImageSource(source) ? source : resolveLocalFilePath(source, context);
        const preview = await createBoundedImagePreview(path, {
          maxEdge: args.maxEdge,
          quality: args.quality,
        });
        const payload = {
          ok: true,
          executor: "local",
          stage: "media_view",
          data: {
            path: preview.path,
            name: basename(preview.path.split("?")[0] || preview.path),
            sourceKind: preview.sourceKind,
            sourceWidth: preview.sourceWidth,
            sourceHeight: preview.sourceHeight,
            previewWidth: preview.previewWidth,
            previewHeight: preview.previewHeight,
            previewBytes: preview.previewBytes,
            maxEdge: args.maxEdge ?? 1280,
            quality: args.quality ?? 70,
            ephemeral: true,
          },
          warnings: [
            "Preview pixels are for the current turn only. After idle, history keeps a path/URL stub.",
            "Do not call OpenCode read on screenshot/PNG/JPEG paths.",
            ...(preview.sourceKind === "remote"
              ? ["Remote URL was fetched and downscaled for this turn only; image_crop/image_resize still need a local file."]
              : []),
          ],
          nextActions: preview.sourceKind === "remote"
            ? []
            : ["image_inspect", "image_crop", "image_resize"],
        };
        return {
          title: "media view",
          output: asJsonText(payload),
          attachments: [preview.attachment],
        };
      },
    },
    image_crop: {
      description: "Crop an exact pixel rectangle from one local image without AI generation or visual reinterpretation. Writes a new PNG, JPEG, or WebP file.",
      args: imageCropArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const args = imageCropArgsSchema.parse(rawArgs);
        return asJsonText(await LOCAL_IMAGE_TOOL_IMPLEMENTATIONS.image_crop(args, context));
      },
    },
    image_resize: {
      description: "Resize one local image deterministically with contain, cover, or fill fitting. Writes a new PNG, JPEG, or WebP file.",
      args: imageResizeArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const args = imageResizeArgsSchema.parse(rawArgs);
        return asJsonText(await LOCAL_IMAGE_TOOL_IMPLEMENTATIONS.image_resize(args, context));
      },
    },
    image_rotate_flip: {
      description: "Rotate a local image by 0, 90, 180, or 270 degrees and optionally mirror it, without AI generation. Writes a new image file.",
      args: imageRotateFlipArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const args = imageRotateFlipArgsSchema.parse(rawArgs);
        return asJsonText(await LOCAL_IMAGE_TOOL_IMPLEMENTATIONS.image_rotate_flip(args, context));
      },
    },
    image_collage: {
      description: "Combine 2-36 local images into one deterministic grid, horizontal strip, or vertical strip. Use contain to preserve every source pixel and optional labels to identify angles. Never substitutes AI-generated views.",
      args: imageCollageArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const args = imageCollageArgsSchema.parse(rawArgs);
        return asJsonText(await LOCAL_IMAGE_TOOL_IMPLEMENTATIONS.image_collage(args, context));
      },
    },
    image_composite: {
      description: "Place one or more local images over a base image at exact coordinates, sizes, and opacity in deterministic array order. Writes a new image without AI generation.",
      args: imageCompositeArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const args = imageCompositeArgsSchema.parse(rawArgs);
        return asJsonText(await LOCAL_IMAGE_TOOL_IMPLEMENTATIONS.image_composite(args, context));
      },
    },
    openwork_pdf_info: {
      description: "Inspect a local PDF before reading it. Returns reliable page count, file metadata, and PDF metadata using PDF.js.",
      args: localPdfInfoArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        try {
          const args = localPdfInfoArgsSchema.parse(rawArgs);
          return asJsonText(await inspectLocalPdf(resolveLocalFilePath(args.path, context)));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    openwork_pdf_extract_text: {
      description: "Extract a bounded PDF text window with continuation metadata. Defaults to five pages and 20,000 characters. Call openwork_pdf_info first; continue with nextStartPage and nextStartChar. Empty pages require openwork_pdf_render_pages.",
      args: localPdfExtractTextArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        try {
          const args = localPdfExtractTextArgsSchema.parse(rawArgs);
          return asJsonText(await extractLocalPdfPages(resolveLocalFilePath(args.path, context), {
            startPage: args.startPage,
            startChar: args.startChar,
            endPage: args.endPage,
            maxChars: args.maxChars ?? 20_000,
          }));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    openwork_pdf_render_pages: {
      description: "Render selected local PDF pages to PNG files for visual inspection of scans, tables, images, product appearance, parameters, and layout. Call image_inspect on each returned image path for a bounded current-turn preview. Never call OpenCode read on those PNG paths.",
      args: localPdfRenderPagesArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        try {
          const args = localPdfRenderPagesArgsSchema.parse(rawArgs);
          return asJsonText(await renderLocalPdfPages(resolveLocalFilePath(args.path, context), args.pages, args.scale ?? 2));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    openwork_file_extract_text: {
      description: "Extract a bounded text window from a local DOCX, XLSX, BIFF8 XLS, PPTX, plain text, or JSON file. Legacy .xls is parsed by the bundled SheetJS BIFF8 reader (no soffice). Continue with nextOffset when hasMore is true. For large storyboard payloads (scene_payload / tool_call_payload), use this to read in windows or sample episodes; small files may use OpenCode read. Structured sheet/row/cell evidence is included for .xls. Use openwork_pdf_info/openwork_pdf_extract_text for PDFs.",
      args: localFileExtractTextArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const parsed = localFileExtractTextArgsSchema.safeParse(rawArgs);
        if (!parsed.success) {
          return asJsonText({
            ok: false,
            recoverable: true,
            errorKind: "validation",
            error: parsed.error.message,
          });
        }
        const args = parsed.data;
        const requestedLegacyXls = extname(args.path).toLowerCase() === ".xls";
        let filePath = args.path;
        let result: Record<string, unknown>;
        try {
          filePath = resolveLocalFilePath(args.path, context);
          result = await extractLocalFileText(
            filePath,
            args.offset ?? 0,
            args.maxChars ?? 20_000,
          );
        } catch (error) {
          result = {
            ok: false,
            recoverable: true,
            errorKind: "execution",
            error: error instanceof Error ? error.message : String(error),
            ...(requestedLegacyXls
              ? {
                  productSaveAllowed: false,
                  data: {
                    code: "XLS_READ_FAILED",
                    productSaveAllowed: false,
                    path: filePath,
                  },
                }
              : {}),
          };
        }
        if (requestedLegacyXls) {
          recordXlsExtractionOutcome(context, filePath, result);
        }
        return asJsonText(result);
      },
    },
    openwork_file_preview: {
      description: "Create a macOS Quick Look preview thumbnail for a local PDF, Office document, image, audio, or video file. Returns the generated preview path.",
      args: localFilePreviewArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        try {
          const args = localFilePreviewArgsSchema.parse(rawArgs);
          const filePath = resolveLocalFilePath(args.path, context);
          return asJsonText(await createQuickLookPreview(filePath, args.size ?? 1400));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    openwork_file_media_probe: {
      description: "Read local file metadata for images, audio, video, PDF, and Office files using built-in system tools. Returns mime type, dimensions, duration, page count, and Spotlight metadata when available.",
      args: localMediaProbeArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        try {
          const args = localMediaProbeArgsSchema.parse(rawArgs);
          const filePath = resolveLocalFilePath(args.path, context);
          return asJsonText(await probeLocalMedia(filePath));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    openwork_file_search: {
      description: "Search local user/workspace files by name or Spotlight query without reading file contents. Returns path metadata only; use extract_text/preview/probe afterwards when needed.",
      args: localFileSearchArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        try {
          const args = localFileSearchArgsSchema.parse(rawArgs);
          return asJsonText(await searchLocalFiles(args, context));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    openwork_file_plan_batch: {
      description: "Preview safe batch file operations before changing anything. Supports copy, move, rename, and mkdir only. Delete is intentionally unsupported.",
      args: localFilePlanBatchArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        try {
          const args = localFilePlanBatchArgsSchema.parse(rawArgs);
          return asJsonText(await buildLocalFileBatchPlan(args.operations, context, args.baseDir));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    openwork_file_apply_batch: {
      description: "Apply a previously previewed safe batch file plan. Requires confirmed:true and either planId or operations. Supports copy, move, rename, and mkdir only.",
      args: localFileApplyBatchArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        try {
          const args = localFileApplyBatchArgsSchema.parse(rawArgs);
          if (args.confirmed !== true) {
            return asJsonText({ ok: false, error: "confirmed:true is required before changing files." });
          }
          const fromPlan = args.planId ? await readLocalFileBatchPlan(args.planId) : null;
          const operations = args.operations ?? fromPlan?.operations;
          if (!operations?.length) {
            return asJsonText({ ok: false, error: "Provide operations or a planId returned by openwork_file_plan_batch." });
          }
          return asJsonText(await applyLocalFileBatchPlan(operations, context, args.baseDir ?? fromPlan?.baseDir));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    openwork_file_open_directory: {
      description: "Open a local folder in Finder (macOS) or the system file manager. Use after downloading/exporting files so the user can review outputs. Paths may be absolute, ~/ paths, or workspace-relative.",
      args: localFileOpenDirectoryArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        try {
          const args = localFileOpenDirectoryArgsSchema.parse(rawArgs);
          const dirPath = resolveLocalFilePath(args.path, context);
          return asJsonText(await openLocalDirectory(dirPath));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    wodeapp_page_import_from_file: {
      description:
        "Import a local HTML file into a WodeApp page as CustomCode (file-first). Pass sourcePath only — the host reads the file and calls import-html. Prefer this over update_page with mega config. Then publish_project.",
      args: pageImportFromFileArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const parsed = pageImportFromFileArgsSchema.safeParse(rawArgs);
        if (!parsed.success) {
          return asJsonText({
            ok: false,
            recoverable: true,
            errorKind: "validation",
            error: parsed.error.message,
          });
        }
        try {
          return asJsonText(await importPageFromLocalHtmlFile(parsed.data, context));
        } catch (error) {
          return asJsonText({
            ok: false,
            recoverable: true,
            errorKind: "execution",
            error: error instanceof Error ? error.message : String(error),
            data: {
              code: "PAGE_IMPORT_FROM_FILE_FAILED",
              fallbackTool: "ai_generate_page",
            },
          });
        }
      },
    },

    openwork_computer_call_tool: {
      description: "Call a macOS Computer Use tool through WodeAppX's direct helper, without starting a Computer Use MCP server. Prefer the typed openwork_computer_* tools for common actions.",
      args: computerUseRawArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const { tool, args, timeoutMs, includeImage } = computerUseRawArgsSchema.parse(rawArgs);
        return runComputerUseTool(tool, args ?? {}, { timeoutMs, includeImage });
      },
    },
    openwork_computer_check_permissions: {
      description: "Check macOS Accessibility and Screen Recording permission status for the direct Computer Use helper.",
      args: {},
      async execute() {
        return runComputerUseTool("check_permissions", {}, { timeoutMs: 15_000 });
      },
    },
    openwork_computer_list_apps: {
      description: "List running apps for Computer Use targeting. macOS uses HandsFree; Windows/Linux use open-computer-use.",
      args: {},
      async execute() {
        return runComputerUseTool("list_apps", {}, { timeoutMs: 15_000 });
      },
    },
    openwork_computer_snapshot: {
      description: "Take a semantic accessibility snapshot of a desktop app/window. On macOS use refs like {e1}; on Windows/Linux pass app and use element_index from the result.",
      args: computerUseSnapshotArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = computerUseSnapshotArgsSchema.parse(rawArgs);
        const { includeImage, ...toolArgs } = args;
        return runComputerUseTool("snapshot", toolArgs, { timeoutMs: 90_000, includeImage });
      },
    },
    openwork_screen_snapshot: {
      description: "User-friendly alias for taking a semantic screenshot/snapshot of the current screen, app, or named window. Prefer this for 'look at my screen' requests.",
      args: computerUseSnapshotArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = computerUseSnapshotArgsSchema.parse(rawArgs);
        const { includeImage, ...toolArgs } = args;
        return runComputerUseTool("snapshot", toolArgs, { timeoutMs: 90_000, includeImage });
      },
    },
    openwork_computer_click: {
      description: "Click a semantic ref, element index, screenshot coordinate, or screen coordinate in the latest direct Computer Use snapshot.",
      args: computerUseClickArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = computerUseClickArgsSchema.parse(rawArgs);
        return runComputerUseTool("click", args, { timeoutMs: 30_000 });
      },
    },
    openwork_computer_type_text: {
      description: "Type text into the target process from the latest direct Computer Use snapshot. In strict mode this uses background-safe postToPid events.",
      args: computerUseTypeTextArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = computerUseTypeTextArgsSchema.parse(rawArgs);
        return runComputerUseTool("type_text", args, { timeoutMs: 30_000 });
      },
    },
    openwork_computer_press_key: {
      description: "Press a key combo such as command+k, return, tab, or escape in the target process from the latest direct Computer Use snapshot.",
      args: computerUsePressKeyArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = computerUsePressKeyArgsSchema.parse(rawArgs);
        return runComputerUseTool("press_key", args, { timeoutMs: 30_000 });
      },
    },
    openwork_computer_scroll: {
      description: "Scroll the target window from the latest direct Computer Use snapshot.",
      args: computerUseScrollArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = computerUseScrollArgsSchema.parse(rawArgs);
        return runComputerUseTool("scroll", args, { timeoutMs: 30_000 });
      },
    },
    openwork_computer_set_value: {
      description: "Set a semantic AX element value directly through Computer Use. Prefer this over typing when the target ref supports setValue.",
      args: computerUseSetValueArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = computerUseSetValueArgsSchema.parse(rawArgs);
        return runComputerUseTool("set_value", args, { timeoutMs: 30_000 });
      },
    },
    openwork_computer_perform_action: {
      description: "Perform a named AX action such as AXPress, AXShowMenu, AXIncrement, or AXDecrement on a semantic ref.",
      args: computerUsePerformActionArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = computerUsePerformActionArgsSchema.parse(rawArgs);
        return runComputerUseTool("perform_action", args, { timeoutMs: 30_000 });
      },
    },
    openwork_computer_launch_app: {
      description: "Launch a macOS app by name through the direct Computer Use helper.",
      args: computerUseAppNameArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = computerUseAppNameArgsSchema.parse(rawArgs);
        return runComputerUseTool("launch_app", args, { timeoutMs: 30_000 });
      },
    },
    openwork_computer_activate_app: {
      description: "Bring a running macOS app to the foreground through the direct Computer Use helper.",
      args: computerUseAppNameArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = computerUseAppNameArgsSchema.parse(rawArgs);
        return runComputerUseTool("activate_app", args, { timeoutMs: 15_000 });
      },
    },
    openwork_computer_open_url: {
      description: "Open a URL in the default browser or a named browser app through the direct Computer Use helper. Use openwork_browser_open_url for built-in-browser automation.",
      args: computerUseOpenUrlArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = computerUseOpenUrlArgsSchema.parse(rawArgs);
        return runComputerUseTool("open_url", args, { timeoutMs: 30_000 });
      },
    },
    openwork_computer_clipboard_read: {
      description: "Read text from the macOS clipboard through the direct Computer Use helper.",
      args: {},
      async execute() {
        return runComputerUseTool("clipboard_read", {}, { timeoutMs: 15_000 });
      },
    },
    openwork_computer_clipboard_write: {
      description: "Write text to the macOS clipboard through the direct Computer Use helper.",
      args: computerUseClipboardWriteArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = computerUseClipboardWriteArgsSchema.parse(rawArgs);
        return runComputerUseTool("clipboard_write", args, { timeoutMs: 15_000 });
      },
    },
    openwork_clipboard_read: {
      description: "Read text from the macOS clipboard. Short alias for the built-in Computer Use clipboard reader.",
      args: {},
      async execute() {
        return runComputerUseTool("clipboard_read", {}, { timeoutMs: 15_000 });
      },
    },
    openwork_clipboard_write: {
      description: "Write text to the macOS clipboard. Short alias for the built-in Computer Use clipboard writer.",
      args: computerUseClipboardWriteArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = computerUseClipboardWriteArgsSchema.parse(rawArgs);
        return runComputerUseTool("clipboard_write", args, { timeoutMs: 15_000 });
      },
    },
    openwork_clipboard_paste: {
      description: "Paste the current clipboard into the active target, optionally writing text first and then pressing command+v.",
      args: computerUseClipboardPasteArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = computerUseClipboardPasteArgsSchema.parse(rawArgs);
        const results: Record<string, unknown> = {};
        if (typeof args.text === "string") {
          results.write = JSON.parse(await runComputerUseTool("clipboard_write", { text: args.text }, { timeoutMs: 15_000 }));
        }
        results.paste = JSON.parse(await runComputerUseTool("press_key", {
          combo: "command+v",
          snapshot_id: args.snapshot_id,
          strict: args.strict,
        }, { timeoutMs: 15_000 }));
        return asJsonText({ ok: true, ...results });
      },
    },
    openwork_chrome_tab_summary: {
      description: "Privacy-preserving summary of the user's real Chrome windows/tabs. Returns counts and indexes only; never returns tab titles or URLs.",
      args: chromeAppArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = chromeAppArgsSchema.parse(rawArgs);
        return asJsonText(await runJxa(CHROME_TAB_SUMMARY_JXA, [chromeAppName(args.app)], { timeoutMs: 15_000 }));
      },
    },
    openwork_chrome_list_tabs: {
      description: "List tabs from the user's real Google Chrome profile via macOS Apple Events. Use this when the task depends on the user's logged-in Chrome session.",
      args: chromeAppArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = chromeAppArgsSchema.parse(rawArgs);
        return asJsonText(await runJxa(CHROME_LIST_TABS_JXA, [chromeAppName(args.app)], { timeoutMs: 15_000 }));
      },
    },
    openwork_chrome_active_tab: {
      description: "Return the active tab from the user's real Google Chrome profile.",
      args: chromeAppArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = chromeAppArgsSchema.parse(rawArgs);
        return asJsonText(await runJxa(CHROME_ACTIVE_TAB_JXA, [chromeAppName(args.app)], { timeoutMs: 15_000 }));
      },
    },
    openwork_chrome_open_url: {
      description: "Open a URL in the user's real Google Chrome profile, preserving their login/session. Use openwork_browser_open_url for isolated built-in-browser automation.",
      args: chromeOpenUrlArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = chromeOpenUrlArgsSchema.parse(rawArgs);
        return asJsonText(await runJxa(CHROME_OPEN_URL_JXA, [chromeAppName(args.app), args.url], { timeoutMs: 15_000 }));
      },
    },
    openwork_chrome_activate_tab: {
      description: "Activate a tab in the user's real Google Chrome profile by windowIndex/tabIndex from openwork_chrome_list_tabs.",
      args: chromeTabArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = chromeTabArgsSchema.parse(rawArgs);
        return asJsonText(await runJxa(CHROME_ACTIVATE_TAB_JXA, [
          chromeAppName(args.app),
          String(args.windowIndex),
          String(args.tabIndex),
        ], { timeoutMs: 15_000 }));
      },
    },
    openwork_chrome_close_tab: {
      description: "Close a tab in the user's real Google Chrome profile by windowIndex/tabIndex from openwork_chrome_list_tabs.",
      args: chromeTabArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = chromeTabArgsSchema.parse(rawArgs);
        return asJsonText(await runJxa(CHROME_CLOSE_TAB_JXA, [
          chromeAppName(args.app),
          String(args.windowIndex),
          String(args.tabIndex),
        ], { timeoutMs: 15_000 }));
      },
    },
    openwork_chrome_execute_javascript: {
      description: "Execute JavaScript in a real Chrome tab through Apple Events. Chrome requires View > Developer > Allow JavaScript from Apple Events; if disabled, use openwork_chrome_snapshot or openwork_computer_* instead.",
      args: chromeExecuteJavascriptArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = chromeExecuteJavascriptArgsSchema.parse(rawArgs);
        return asJsonText(await runJxa(CHROME_EXECUTE_JAVASCRIPT_JXA, [
          chromeAppName(args.app),
          String(args.windowIndex ?? 1),
          args.tabIndex ? String(args.tabIndex) : "",
          args.code,
        ], { timeoutMs: 30_000 }));
      },
    },
    openwork_chrome_snapshot: {
      description: "Take a semantic Computer Use snapshot of the user's real Google Chrome app. Use after openwork_chrome_activate_tab when you need visual interaction with a signed-in Chrome page.",
      args: chromeSnapshotArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const args = chromeSnapshotArgsSchema.parse(rawArgs);
        const { includeImage, ...rest } = args;
        return runComputerUseTool("snapshot", { app: "Google Chrome", ...rest }, { timeoutMs: 90_000, includeImage });
      },
    },
  };
  const sessionMessages = pluginInput.client?.session?.messages;
  const readMediaGate = buildReadMediaGateHooks({
    ...(sessionMessages
      ? {
          loadSessionMessages: async (sessionID: string) => {
            const response = await pluginInput.client!.session!.messages!({
              path: { id: sessionID },
            });
            const messages = Array.isArray(response)
              ? response
              : asRecord(response).data;
            if (!Array.isArray(messages)) {
              throw new Error("Local engine session.messages returned no message array");
            }
            return messages as Array<{ info?: unknown; parts?: unknown[] }>;
          },
        }
      : {}),
  });
  const stubCallGate = buildStubCallGateHooks();
  return {
    tool: wrapToolDefinitionsWithContract(definitions),
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: unknown },
    ) => {
      await stubCallGate["tool.execute.before"](input, output);
      await readMediaGate["tool.execute.before"](input, output);
    },
    "chat.headers": readMediaGate["chat.headers"],
    "experimental.chat.messages.transform": readMediaGate["experimental.chat.messages.transform"],
    "experimental.session.compacting": readMediaGate["experimental.session.compacting"],
    "tool.definition": async (
      input: { toolID: string },
      output: { description: string; jsonSchema?: unknown },
    ) => {
      await readMediaGate["tool.definition"](input, output);
      const directContract = WODEAPP_DIRECT_ACTION_CONTRACT_BY_TOOL_NAME.get(input.toolID);
      if (directContract) {
        output.description = directContract.description;
        output.jsonSchema = modelFacingDirectActionInputSchema(directContract.inputSchema);
        return;
      }
      if (input.toolID !== "openwork_ui_execute_action") return;
      let actions: unknown = { ok: true, actions: [] };
      try {
        actions = await uiBridgeRequest("/actions", { timeoutMs: 1_000 });
      } catch {
        // Keep the generic executor closed when the live UI registry is unavailable.
      }
      output.description = `Execute a runtime UI control allowed by the live registry. ${OPENWORK_UI_CONTROL_INSTRUCTION}`;
      output.jsonSchema = buildUiExecuteActionJsonSchema(actions);
    },
  };
};

/**
 * OpenCode path plugins must use the v1 default export shape.
 * Legacy loaders treat every named function export as a plugin entry and will
 * invoke helpers like buildBoundedPdfTextWindow(pluginInput), which throws
 * `undefined is not an object (evaluating 'input.pages')`.
 */
export default {
  id: "openwork-extensions-preview",
  server: OpenWorkExtensionsPreview,
};
