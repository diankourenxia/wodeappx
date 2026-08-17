import type { UIMessage } from "ai";

type OpenTargetKind = "url" | "file" | "directory";
export type OpenTargetPreview = "browser" | "markdown" | "sheet" | "slides" | "image" | "pdf" | "html" | "text" | "external" | "folder";

export interface TextData {
  kind: "text";
  data: string;
}

export interface BinaryData {
  kind: "binary";
  data: ArrayBuffer;
}

export type Data = TextData | BinaryData;

export type OpenTarget = {
  id: string;
  kind: OpenTargetKind;
  value: string;
  name: string;
  preview: OpenTargetPreview;
  confidence: number;
  reason: string;
  exists?: boolean;
  size?: number;
  updatedAt?: number;
};

const WORKSPACES_PREFIX_PATTERN = /^workspaces\/[^/]+\//i;
const WORKSPACE_ID_PREFIX_PATTERN = /^workspace\/(?:ws_[^/]+|\d+|[0-9a-f-]{6,})\//i;

const FILE_PATTERN = /(?:^|[\s"'`([{])((?:\.{1,2}[/\\]|~[/\\]|[/\\])?[\w.\-]+(?:[/\\][\w.\-]+)+\.[a-z][a-z0-9]{0,9}|[\w.\-]+\.[a-z][a-z0-9]{0,9})/gi;
const DIRECTORY_SLASH_PATTERN = /(?:^|[\s"'`([{])((?:\.{1,2}[/\\]|~[/\\]|[/\\]|[A-Za-z]:[/\\])?[\w.\-]+(?:[/\\][\w.\-]+)+)\/(?=[\s"'`)\]}>,.;:!?]|$)/gi;
const OUTPUT_DIR_HINT_PATTERN = /(?:下载到|保存到|输出到|写入目录|mkdir\s+-p|saved to|downloaded to|written to|output directory)\s*[`"']?([^\s`"']+)[`"']?/gi;
const URL_PATTERN = /https?:\/\/[^\s)\]}>"'`]+/gi;
const SOCKET_PATTERN = /(?:ws|wss):\/\/[^\s)\]}>"'`]+/gi;
const SIDEBAR_ARTIFACT_FILE_PREVIEWS = new Set<OpenTargetPreview>(["markdown", "sheet", "slides", "image", "pdf", "html"]);
const MARKDOWN_LINK_PATTERN = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const ASSISTANT_ARTIFACT_MENTION_PATTERN = /\b(?:artifact|created|deck|deliverable|downloaded|exported|file|folder|generated|opened|presentation|saved|slides?|updated|wrote)\b|(?:下载到|保存到|输出到|写入目录|全部下载|目录下|已下载|已保存|下载完成|本地文件|文件在|保存在)/i;
const LOCAL_OUTPUT_PATH_PATTERN = /(?:^|[\s(])outputs\/[\w.\-/]+/i;
const LOCAL_MEDIA_FILE_PATTERN = /(?:^|[\s(])[\w.\-/]+\.(?:mp4|mov|webm|mkv|m4v|mp3|wav|png|jpe?g|webp|pdf)/im;
const DISCOVERY_TOOL_NAMES = new Set(["glob", "grep", "search", "find"]);
const ARTIFACT_METADATA_TOOL_NAMES = new Set(["openwork_extension_call"]);
const WRITE_TOOL_NAMES = new Set([
  "apply_patch",
  "edit",
  "edit_file",
  "multi_edit",
  "multiedit",
  "patch",
  "str_replace_editor",
  "write",
  "write_file",
]);
/** Shell tools may mention incidental paths in the command; never treat those as open actions. */
const SHELL_TOOL_NAMES = new Set([
  "bash",
  "shell",
  "exec",
  "run_terminal_cmd",
]);
const DOWNLOAD_TOOL_NAMES = new Set([
  "browser_eval",
  "browser_evaluate",
]);
const FILE_METADATA_KEYS = ["path", "file", "filePath", "filepath"];
const DIRECTORY_METADATA_KEYS = ["directory", "dir", "folder", "outputDir", "outputDirectory"];
const PATCH_FILE_PATTERN = /^\*\*\* (?:Add File|Update File):\s*(.+)$/gmi;
const PATCH_MOVE_TO_PATTERN = /^\*\*\* Move to:\s*(.+)$/gmi;
const URI_PATTERN = /^(?:https?|wss?|file):\/\//i;
const OPENABLE_BARE_FILE_EXTENSIONS = new Set([
  ".csv", ".gif", ".html", ".htm", ".jpeg", ".jpg", ".json", ".log", ".md",
  ".mov", ".mp3", ".mp4", ".pdf", ".png", ".ppt", ".pptx", ".svg", ".tsv",
  ".txt", ".wav", ".webm", ".webp", ".xls", ".xlsx", ".yaml", ".yml", ".zip",
]);

type DeriveOpenTargetsOptions = {
  includeFileMentions?: boolean;
};

function normalizePath(path: string) {
  return path
    .trim()
    .replace(/[\\]+/g, "/")
    .replace(/^\.\//, "")
    .replace(WORKSPACES_PREFIX_PATTERN, "")
    .replace(WORKSPACE_ID_PREFIX_PATTERN, "");
}

function basename(value: string) {
  const clean = value.split(/[?#]/)[0] ?? value;
  return clean.split("/").filter(Boolean).pop() ?? value;
}

function extname(value: string) {
  const name = basename(value).toLowerCase();
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index) : "";
}

function looksLikeFilePath(path: string) {
  const last = basename(path.replace(/\/+$/, ""));
  return /\.[a-z][a-z0-9]{0,9}$/i.test(last);
}

function classifyOpenTarget(value: string, kind: OpenTargetKind): OpenTargetPreview {
  if (kind === "directory") return "folder";
  if (kind === "url") return "browser";
  const ext = extname(value);
  if ([".md", ".markdown", ".mdx"].includes(ext)) return "markdown";
  if ([".csv", ".tsv", ".xlsx", ".xls", ".ods"].includes(ext)) return "sheet";
  if ([".ppt", ".pptx", ".pptm", ".pot", ".potx", ".odp", ".key", ".sxi"].includes(ext)) return "slides";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"].includes(ext)) return "image";
  if (ext === ".pdf") return "pdf";
  if ([".html", ".htm"].includes(ext)) return "html";
  if ([".txt", ".log", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".xml", ".ts", ".tsx", ".js", ".jsx", ".css", ".scss"].includes(ext)) return "text";
  return "external";
}

function shouldScanAssistantFileMentions(text: string) {
  if (ASSISTANT_ARTIFACT_MENTION_PATTERN.test(text)) return true;
  if (LOCAL_OUTPUT_PATH_PATTERN.test(text)) return true;
  if (LOCAL_MEDIA_FILE_PATTERN.test(text)) return true;
  return false;
}

function textWithoutRedundantMarkdownLinkLabels(text: string) {
  return text.replace(MARKDOWN_LINK_PATTERN, (match, label: string, href: string) => {
    const cleanLabel = label.trim();
    const cleanHref = href.trim();
    return cleanLabel === basename(cleanHref) ? `[](${cleanHref})` : match;
  });
}

function targetFromFile(path: string, confidence: number, reason: string): OpenTarget | null {
  const normalized = normalizePath(path).replace(/[.,;:]+$/, "");
  if (!normalized || normalized.length > 500 || !normalized.includes(".")) return null;
  if (!normalized.includes("/") && !OPENABLE_BARE_FILE_EXTENSIONS.has(extname(normalized))) return null;
  return {
    id: `file:${normalized.toLowerCase()}`,
    kind: "file",
    value: normalized,
    name: basename(normalized),
    preview: classifyOpenTarget(normalized, "file"),
    confidence,
    reason,
  };
}

function targetFromDirectory(path: string, confidence: number, reason: string): OpenTarget | null {
  let normalized = normalizePath(path).replace(/[.,;:]+$/, "").replace(/\/+$/, "");
  if (!normalized || normalized.length > 500 || URI_PATTERN.test(normalized)) return null;
  if (looksLikeFilePath(normalized)) return null;
  if (!normalized.includes("/") && !/^[A-Za-z]:/.test(normalized)) return null;
  return {
    id: `dir:${normalized.toLowerCase()}`,
    kind: "directory",
    value: normalized,
    name: basename(normalized) || normalized,
    preview: "folder",
    confidence,
    reason,
  };
}

function targetFromFileParentDirectory(path: string, confidence: number, reason: string): OpenTarget | null {
  const normalized = normalizePath(path).replace(/[.,;:]+$/, "");
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) return null;
  return targetFromDirectory(`${normalized.slice(0, slash)}/`, confidence - 2, `${reason}:parent-dir`);
}

function targetFromUrl(url: string, confidence: number, reason: string): OpenTarget | null {
  const stripped = url.trim().replace(/[.,;:`\\]+$/, "");
  let clean = stripped;
  try {
    const parsed = new URL(stripped);
    if (/^\/+$/i.test(parsed.pathname) && !parsed.search && !parsed.hash) {
      clean = parsed.origin;
    }
  } catch {
    // Keep the stripped value; regex extraction already validated the shape.
  }
  if (!clean) return null;
  return {
    id: `url:${clean}`,
    kind: "url",
    value: clean,
    name: basename(clean) || clean,
    preview: "browser",
    confidence,
    reason,
  };
}

function addFileTarget(map: Map<string, OpenTarget>, path: string, confidence: number, reason: string) {
  addTarget(map, targetFromFile(path, confidence, reason));
  addTarget(map, targetFromFileParentDirectory(path, confidence, reason));
}

function addTarget(map: Map<string, OpenTarget>, target: OpenTarget | null) {
  if (!target) return;
  const existing = map.get(target.id);
  if (!existing || target.confidence >= existing.confidence) map.set(target.id, target);
}

function isArtifactTarget(target: OpenTarget) {
  return target.kind === "url" || target.kind === "file" || target.kind === "directory";
}

export function isCollectibleArtifactTarget(target: OpenTarget) {
  return target.kind === "file" && target.exists === true && SIDEBAR_ARTIFACT_FILE_PREVIEWS.has(target.preview);
}

export function isOpenableFileTarget(target: OpenTarget) {
  return target.kind === "file" && target.exists === true;
}

export function isOpenableDirectoryTarget(target: OpenTarget) {
  return target.kind === "directory";
}

export function isAccessibleArtifactTarget(target: OpenTarget) {
  return isOpenableDirectoryTarget(target) || target.kind === "file";
}

/** Source / config extensions that write/edit tools touch mid-task — not user deliverables. */
const INTERMEDIATE_SOURCE_EXTENSIONS = new Set([
  ".py", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".go", ".rs",
  ".java", ".kt", ".swift", ".c", ".cpp", ".h", ".hpp", ".cs",
  ".css", ".scss", ".less", ".vue", ".svelte", ".rb", ".php",
  ".sh", ".bash", ".zsh", ".sql", ".toml", ".yaml", ".yml",
  ".json", ".jsonc", ".lock", ".map",
]);

const CHAT_DELIVERABLE_EXTENSIONS = new Set([
  ".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp",
  ".pdf", ".pptx", ".ppt", ".docx", ".doc", ".xlsx", ".xls", ".csv",
  ".zip", ".mp3", ".wav", ".m4a", ".aac", ".html", ".htm", ".md", ".markdown",
]);

function isWriteDerivedReason(reason: string) {
  return /write tool|patch metadata/i.test(reason);
}

export function messageHasAssistantProse(message: UIMessage) {
  return message.parts.some(
    (part) => part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0,
  );
}

/**
 * Chat inline "打开文件 / 打开文件夹" buttons should only surface user-facing
 * deliverables (e.g. out.mp4), not every intermediate compose.py write.
 */
export function isChatInlineAccessTarget(target: OpenTarget) {
  if (!isAccessibleArtifactTarget(target)) return false;

  if (target.kind === "directory") {
    if (isWriteDerivedReason(target.reason)) return false;
    return /message|shell tool|download|open directory|output-dir|artifact tool/i.test(target.reason);
  }

  if (target.kind !== "file") return false;
  const ext = extname(target.name);

  if (isWriteDerivedReason(target.reason) && INTERMEDIATE_SOURCE_EXTENSIONS.has(ext)) {
    return false;
  }

  if (CHAT_DELIVERABLE_EXTENSIONS.has(ext)) return true;

  // Non-deliverable files only when the assistant prose explicitly mentioned them.
  if (/\bmessage\b/i.test(target.reason)) {
    return !INTERMEDIATE_SOURCE_EXTENSIONS.has(ext);
  }

  return false;
}

export function pickChatInlineAccessTargets(message: UIMessage, limit = 4): OpenTarget[] {
  if (message.role !== "assistant") return [];
  // Tool-only steps (Updated/Write/failed) should not sprout open buttons.
  if (!messageHasAssistantProse(message)) return [];

  const picked: OpenTarget[] = [];
  const seen = new Set<string>();
  for (const target of deriveOpenTargets([message])) {
    if (!isChatInlineAccessTarget(target) || seen.has(target.id)) continue;
    seen.add(target.id);
    picked.push({ ...target, exists: target.exists ?? true });
    if (picked.length >= limit) break;
  }
  return picked;
}

export function isLocalhostBrowserTarget(target: OpenTarget) {
  return target.kind === "url" && /(?:https?|wss?):\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(target.value);
}

export function selectAutoOpenTarget(_targets: OpenTarget[]): OpenTarget | null {
  return null;
}

export function augmentResolvedOpenTargets(derived: OpenTarget[], resolved: OpenTarget[]): OpenTarget[] {
  const map = new Map(resolved.map((target) => [target.id, target]));
  for (const target of derived) {
    if (target.kind !== "directory") continue;
    const existing = map.get(target.id);
    map.set(target.id, {
      ...target,
      ...existing,
      kind: "directory",
      preview: "folder",
      exists: existing?.exists ?? true,
    });
  }
  return Array.from(map.values()).sort((left, right) => right.confidence - left.confidence);
}

function scanText(
  map: Map<string, OpenTarget>,
  text: string,
  confidence: number,
  reason: string,
  options: { includeFiles: boolean },
) {
  if (!text) {
    return;
  }

  let scanValue = text;

  MARKDOWN_LINK_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(MARKDOWN_LINK_PATTERN)) {
    const href = match[2];
    if (!href) continue;
    if (/^(?:https?|wss?):\/\//i.test(href)) {
      addTarget(map, targetFromUrl(href, confidence, reason));
    } else if (options.includeFiles) {
      addTarget(map, targetFromDirectory(href, confidence, reason));
      addFileTarget(map, href, confidence, reason);
    }
  }

  if (options.includeFiles) {
    scanValue = textWithoutRedundantMarkdownLinkLabels(text);
  }

  URL_PATTERN.lastIndex = 0;

  for (const match of scanValue.matchAll(URL_PATTERN)) {
    if (match[0]) addTarget(map, targetFromUrl(match[0], confidence, reason));
  }

  SOCKET_PATTERN.lastIndex = 0;

  for (const match of scanValue.matchAll(SOCKET_PATTERN)) {
    if (match[0]) addTarget(map, targetFromUrl(match[0], confidence, reason));
  }

  if (!options.includeFiles) return;

  OUTPUT_DIR_HINT_PATTERN.lastIndex = 0;
  for (const match of scanValue.matchAll(OUTPUT_DIR_HINT_PATTERN)) {
    if (match[1]) addTarget(map, targetFromDirectory(match[1], confidence + 5, `${reason}:output-dir`));
  }

  DIRECTORY_SLASH_PATTERN.lastIndex = 0;
  for (const match of scanValue.matchAll(DIRECTORY_SLASH_PATTERN)) {
    if (match[1]) addTarget(map, targetFromDirectory(`${match[1]}/`, confidence, `${reason}:directory`));
  }

  FILE_PATTERN.lastIndex = 0;
  for (const match of scanValue.matchAll(FILE_PATTERN)) {
    if (match[1]) addFileTarget(map, match[1], confidence, reason);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function normalizedToolName(toolName: string) {
  return toolName.trim().toLowerCase().replace(/^functions[._-]/, "");
}

function isDiscoveryTool(toolName: string) {
  return DISCOVERY_TOOL_NAMES.has(normalizedToolName(toolName));
}

function isWriteTool(toolName: string) {
  return WRITE_TOOL_NAMES.has(normalizedToolName(toolName));
}

function isShellTool(toolName: string) {
  return SHELL_TOOL_NAMES.has(normalizedToolName(toolName));
}

function isDownloadTool(toolName: string) {
  return DOWNLOAD_TOOL_NAMES.has(normalizedToolName(toolName));
}

/** Shell stdout only yields open buttons when it looks like a saved/exported deliverable. */
function shouldScanShellOutputForFiles(output: string) {
  // Do not use bare media filenames alone — `ls` listing `report.pdf` is not a deliverable.
  OUTPUT_DIR_HINT_PATTERN.lastIndex = 0;
  LOCAL_OUTPUT_PATH_PATTERN.lastIndex = 0;
  ASSISTANT_ARTIFACT_MENTION_PATTERN.lastIndex = 0;
  return (
    ASSISTANT_ARTIFACT_MENTION_PATTERN.test(output) ||
    OUTPUT_DIR_HINT_PATTERN.test(output) ||
    LOCAL_OUTPUT_PATH_PATTERN.test(output)
  );
}

function isArtifactMetadataTool(toolName: string) {
  return ARTIFACT_METADATA_TOOL_NAMES.has(normalizedToolName(toolName));
}

function collectFileMetadataValues(value: unknown) {
  if (!isObject(value)) return [];
  const values: string[] = [];
  for (const key of FILE_METADATA_KEYS) {
    const file = value[key];
    if (typeof file === "string") values.push(file);
  }
  const files = value.files;
  if (Array.isArray(files)) {
    for (const file of files) {
      if (typeof file === "string") values.push(file);
    }
  }
  return values;
}

function collectDirectoryMetadataValues(value: unknown) {
  if (!isObject(value)) return [];
  const values: string[] = [];
  for (const key of DIRECTORY_METADATA_KEYS) {
    const dir = value[key];
    if (typeof dir === "string") values.push(dir);
  }
  return values;
}

function collectNestedFileMetadataValues(value: unknown) {
  if (!isObject(value)) return [];
  return [value, value.result].flatMap(collectFileMetadataValues);
}

function collectNestedDirectoryMetadataValues(value: unknown) {
  if (!isObject(value)) return [];
  return [value, value.result].flatMap(collectDirectoryMetadataValues);
}

function collectPatchFileValues(value: unknown) {
  if (!isObject(value)) return [];
  const patchText = value.patchText ?? value.patch ?? value.diff;
  if (typeof patchText !== "string") return [];
  const values: string[] = [];
  PATCH_FILE_PATTERN.lastIndex = 0;
  for (const match of patchText.matchAll(PATCH_FILE_PATTERN)) {
    if (match[1]) values.push(match[1]);
  }
  PATCH_MOVE_TO_PATTERN.lastIndex = 0;
  for (const match of patchText.matchAll(PATCH_MOVE_TO_PATTERN)) {
    if (match[1]) values.push(match[1]);
  }
  return values;
}

function addFileValues(map: Map<string, OpenTarget>, values: string[], confidence: number, reason: string) {
  for (const value of values) {
    addFileTarget(map, value, confidence, reason);
  }
}

function addDirectoryValues(map: Map<string, OpenTarget>, values: string[], confidence: number, reason: string) {
  for (const value of values) {
    addTarget(map, targetFromDirectory(value, confidence, reason));
  }
}

export function deriveOpenTargets(messages: UIMessage[], options: DeriveOpenTargetsOptions = {}): OpenTarget[] {
  const targets = new Map<string, OpenTarget>();

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "text" && typeof part.text === "string") {
        scanText(targets, part.text, message.role === "assistant" ? 65 : 40, "message", {
          includeFiles: options.includeFileMentions === true || (message.role === "assistant" && shouldScanAssistantFileMentions(part.text)),
        });
        continue;
      }

      if (part.type === "source-document") {
        addTarget(
          targets,
          part.filename
            ? targetFromFile(part.filename, 95, "attachment source")
            : URI_PATTERN.test(part.title)
              ? targetFromUrl(part.title, 95, "attachment source")
              : targetFromFile(part.title, 95, "attachment source"),
        );
        continue;
      }

      if (part.type !== "dynamic-tool") {
        continue;
      }

      const discoveryTool = isDiscoveryTool(part.toolName);
      const writeTool = isWriteTool(part.toolName);
      const artifactMetadataTool = isArtifactMetadataTool(part.toolName);

      if (writeTool) {
        addFileValues(
          targets,
          [part.input, part.output].flatMap(collectFileMetadataValues),
          95,
          "write tool metadata",
        );
        addDirectoryValues(
          targets,
          [part.input, part.output].flatMap(collectDirectoryMetadataValues),
          95,
          "write tool metadata",
        );
        addFileValues(targets, collectPatchFileValues(part.input), 95, "patch metadata");
        if (typeof part.output === "string") {
          scanText(targets, part.output, 90, "write tool output", { includeFiles: true });
        }
      }

      if (isShellTool(part.toolName)) {
        // Never scan the command string — `python /tmp/foo.py` / `cp a.pdf b/` is not a deliverable.
        if (typeof part.output === "string" && shouldScanShellOutputForFiles(part.output)) {
          scanText(targets, part.output, 92, "shell tool output", { includeFiles: true });
        }
      } else if (isDownloadTool(part.toolName)) {
        const chunks: string[] = [];
        if (typeof part.output === "string") chunks.push(part.output);
        if (typeof part.input === "string") chunks.push(part.input);
        if (isObject(part.input)) {
          for (const value of Object.values(part.input)) {
            if (typeof value === "string") chunks.push(value);
          }
        }
        for (const chunk of chunks) {
          scanText(targets, chunk, 92, "download tool output", { includeFiles: true });
        }
      }

      if (artifactMetadataTool) {
        addFileValues(
          targets,
          [part.input, part.output].flatMap(collectNestedFileMetadataValues),
          95,
          "artifact tool metadata",
        );
        addDirectoryValues(
          targets,
          [part.input, part.output].flatMap(collectNestedDirectoryMetadataValues),
          95,
          "artifact tool metadata",
        );
      }

      if (!discoveryTool) {
        scanText(targets, JSON.stringify(part.output ?? part.input ?? ""), 75, "tool output", { includeFiles: false });
        if (normalizedToolName(part.toolName) === "openwork_file_open_directory") {
          addDirectoryValues(
            targets,
            [part.input, part.output].flatMap(collectNestedDirectoryMetadataValues),
            98,
            "open directory tool",
          );
          const pathValue = isObject(part.input) && typeof part.input.path === "string" ? part.input.path : null;
          if (pathValue) addTarget(targets, targetFromDirectory(pathValue, 98, "open directory tool"));
        }
      }
    }
  }

  return Array.from(targets.values())
    .filter(isArtifactTarget)
    .sort((left, right) => right.confidence - left.confidence);
}
