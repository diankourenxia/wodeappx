/**
 * Codex-style tool activity labels for WodeAppX.
 * OpenWork's default dynamic-tool label is `Running ${snake_case}` forever;
 * this module maps known tools/actions to short Chinese labels with tense.
 */

import type { DynamicToolUIPart, ToolUIPart } from "ai";

import {
  WODEAPP_DIRECT_ACTION_CONTRACT_BY_ACTION_ID,
  WODEAPP_DIRECT_ACTION_CONTRACT_BY_TOOL_NAME,
} from "./wodeapp-direct-action-contracts";

type AnyToolPart = ToolUIPart | DynamicToolUIPart;

const TOOL_NAME_LABELS: Record<string, string> = {
  openwork_ui_execute_action: "执行界面操作",
  openwork_ui_list_actions: "列出界面操作",
  openwork_ui_snapshot: "截取界面",
  openwork_file_search: "搜索本地文件",
  openwork_file_extract_text: "提取文件文本",
  openwork_attachment_context_read: "读取附件上下文",
  openwork_pdf_info: "读取 PDF 信息",
  openwork_pdf_extract_text: "提取 PDF 文本",
  openwork_pdf_render_pages: "渲染 PDF 页面",
  openwork_image_inspect: "检查图片",
  openwork_media_view: "预览图片",
  image_inspect: "检查图片",
  image_crop: "裁剪图片",
  openwork_image_collage: "拼接图片",
  ai_generate_image: "生成图片",
  list_image_models: "列出图片模型",
  ai_generate_video: "生成视频",
  video_generate: "生成单条视频",
  video_task_status: "查询视频任务",
  wodeapp_product_save: "保存商品",
  wodeapp_brand_save: "保存品牌",
  wodeapp_assets_list: "查询数字资产",
  wodeapp_auth_status: "查询账号状态",
  wodeapp_sidebar_agent_save: "保存侧栏智能体",
  wodeapp_video_storyboard_open: "打开多条/分镜视频",
  bash: "运行命令",
  read: "读取文件",
  write: "写入文件",
  edit: "编辑文件",
  grep: "搜索文件",
  glob: "匹配文件",
  task: "运行子代理",
  webfetch: "抓取网页",
  websearch: "搜索网页",
  todowrite: "更新计划",
  skill: "加载技能",
};

/** UI / control action ids not always present in direct-action contracts. */
const ACTION_ID_LABELS: Record<string, string> = {
  "wodeapp.batch_image.open": "准备批量生图",
  "wodeapp.video_storyboard.open": "打开多条视频生成",
  "wodeapp.video_storyboard.update": "增量更新分镜视频",
  "wodeapp.video.generate": "生成单条视频",
  "wodeapp.video.status": "查询视频任务",
  "wodeapp.short_drama.open": "打开短剧智能体",
  "wodeapp.folder.open": "打开本地文件夹",
  "wodeapp.product.save": "保存商品到数字资产",
  "wodeapp.image_asset.save": "保存图片素材",
  "browser.open_url": "打开网页",
  "browser.set_proxy": "设置代理",
  "settings.panel.open": "打开设置",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function toolNameOf(part: AnyToolPart): string {
  if (part.type === "dynamic-tool") return part.toolName || "";
  if (typeof part.type === "string" && part.type.startsWith("tool-")) {
    return part.type.slice("tool-".length);
  }
  return typeof part.type === "string" ? part.type : "";
}

function actionIdOf(part: AnyToolPart): string {
  const input = asRecord(part.input);
  const actionId = input?.actionId;
  return typeof actionId === "string" ? actionId.trim() : "";
}

function canonicalizeToolName(name: string): string {
  return name
    .replace(/^wodeapp-platform_/, "")
    .replace(/^wodeapp_platform_/, "")
    .replace(/^mcp_wodeapp-platform_/, "")
    .trim();
}

function humanizeSnake(name: string): string {
  return canonicalizeToolName(name)
    .replace(/^openwork_/, "")
    .replace(/^wodeapp_/, "")
    .replace(/[_-]+/g, " ")
    .trim();
}

/** Base label without 正在/已 — used for grouping identical steps. */
export function getWodeAppToolBaseLabel(part: AnyToolPart): string {
  const rawToolName = toolNameOf(part);
  const toolName = canonicalizeToolName(rawToolName);
  const actionId = actionIdOf(part);
  const input = asRecord(part.input);

  if (toolName === "bash" || toolName === "shell" || toolName === "exec") {
    const description = typeof input?.description === "string" ? input.description.trim() : "";
    if (description) {
      return description.length > 48 ? `${description.slice(0, 48)}…` : description;
    }
    // Prefer a short command hint over the generic「运行命令」so single strips
    // carry signal; multi-bash runs still collapse via activityFamilyOf("bash").
    const command = typeof input?.command === "string" ? input.command.trim() : "";
    if (command) {
      const oneLine = command.split(/\r?\n/, 1)[0]?.trim() || command;
      return oneLine.length > 42 ? `${oneLine.slice(0, 42)}…` : oneLine;
    }
    return "运行命令";
  }

  if (actionId) {
    const fromAction = ACTION_ID_LABELS[actionId]
      || WODEAPP_DIRECT_ACTION_CONTRACT_BY_ACTION_ID.get(actionId)?.label;
    if (fromAction) return fromAction;
  }

  if (toolName) {
    const fromTool = TOOL_NAME_LABELS[toolName]
      || TOOL_NAME_LABELS[rawToolName]
      || WODEAPP_DIRECT_ACTION_CONTRACT_BY_TOOL_NAME.get(toolName)?.label
      || WODEAPP_DIRECT_ACTION_CONTRACT_BY_TOOL_NAME.get(rawToolName)?.label;
    if (fromTool) {
      // Prefer action-specific label when execute_action has a known actionId;
      // otherwise keep the generic tool label.
      if ((toolName === "openwork_ui_execute_action" || rawToolName === "openwork_ui_execute_action") && actionId) {
        const short = actionId.split(".").pop()?.replace(/[_-]+/g, " ") || actionId;
        return `执行 ${short}`;
      }
      return fromTool;
    }
  }

  if (toolName || rawToolName) return humanizeSnake(toolName || rawToolName) || "工具步骤";
  return "工具步骤";
}

export type ToolActivityTense = "running" | "done" | "error";

export type ToolActivityOptions = {
  /**
   * Parent turn still live (busy/retry/streaming). When false, in-flight tool
   * parts must not keep「正在…」— Codex invariant: idle ⇒ no running strip.
   */
  sessionLive?: boolean;
};

const ORPHANED_IDLE_TOOL_ERROR =
  "会话已空闲，步骤未正常收尾";

export function toolActivityTense(
  part: AnyToolPart,
  options?: ToolActivityOptions,
): ToolActivityTense {
  if (part.state === "output-error") return "error";
  if (part.state === "input-streaming" || part.state === "input-available") {
    // Parent idle + tool still mapped in-flight ⇒ treat as interrupted.
    if (options?.sessionLive === false) return "error";
    return "running";
  }
  return "done";
}

/**
 * Remap in-flight UI tool parts to output-error when the parent turn is idle,
 * so every tool renderer (bash card, activity strip, generic Tool) stops
 * claiming「正在…」.
 */
export function settleInFlightToolPartsForIdleSession<T extends AnyToolPart>(
  parts: T[],
  sessionLive: boolean,
): T[] {
  if (sessionLive || parts.length === 0) return parts;
  let changed = false;
  const next = parts.map((part) => {
    if (part.state !== "input-streaming" && part.state !== "input-available") return part;
    changed = true;
    const previousErrorText = asRecord(part)?.errorText;
    return {
      ...part,
      state: "output-error",
      errorText:
        typeof previousErrorText === "string" && previousErrorText.trim()
          ? previousErrorText
          : ORPHANED_IDLE_TOOL_ERROR,
    } as T;
  });
  return changed ? next : parts;
}

function clipReason(text: string, max = 72): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function summarizeZodIssue(issue: Record<string, unknown>): string {
  const path = Array.isArray(issue.path)
    ? issue.path.filter((part) => part != null && String(part).length > 0).map(String).join(".")
    : "";
  const message = typeof issue.message === "string" ? issue.message.trim() : "";
  if (path && message) return `${path}: ${message}`;
  if (message) return message;
  const code = typeof issue.code === "string" ? issue.code.trim() : "";
  const maximum = issue.maximum;
  if (path && code && maximum != null) return `${path}: ${code} (max ${maximum})`;
  if (path && code) return `${path}: ${code}`;
  if (code && maximum != null) return `${code} (max ${maximum})`;
  return code;
}

/** Collapse raw tool errorText for the activity row — keep Zod/tool wording, do not invent domain copy. */
export function formatWodeAppToolErrorReason(raw: string): string {
  let text = raw.trim();
  if (!text) return "";
  text = text.replace(/^\[wodeappxFailure[^\]]*\]\s*/i, "");
  text = text.replace(/^UI bridge request failed:\s*/i, "");
  if (/^Tool execution aborted$/i.test(text) || /^Aborted$/i.test(text)) {
    return "参数未完成被中断";
  }
  const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean) || text;
  if (firstLine.startsWith("[") || firstLine.startsWith("{")) {
    try {
      const parsed = JSON.parse(text) as unknown;
      const issues: unknown[] = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === "object" && Array.isArray((parsed as { issues?: unknown[] }).issues)
          ? (parsed as { issues: unknown[] }).issues
          : [parsed];
      const parts = issues
        .map((issue) => (issue && typeof issue === "object" ? summarizeZodIssue(issue as Record<string, unknown>) : ""))
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length > 0) return clipReason(parts.slice(0, 2).join("; "));
    } catch {
      // fall through
    }
    return "参数校验未通过";
  }
  return clipReason(firstLine);
}

/** Short user-visible reason from a failed tool part (collapsed row). */
export function shortWodeAppToolErrorReason(part: AnyToolPart): string {
  if (part.state !== "output-error") return "";
  const errorText = asRecord(part)?.errorText;
  const raw = typeof errorText === "string" ? errorText : "";
  return formatWodeAppToolErrorReason(raw);
}

export function withWodeAppToolTense(label: string, tense: ToolActivityTense): string {
  const trimmed = label.trim();
  if (!trimmed) return tense === "running" ? "处理中" : tense === "error" ? "步骤未完成" : "已完成";

  if (tense === "error") {
    if (/(未完成|需调整|可重试)$/.test(trimmed)) return trimmed;
    if (trimmed.endsWith("失败")) return `${trimmed.slice(0, -2)}未完成`;
    return `${trimmed}未完成`;
  }

  if (tense === "running") {
    if (trimmed.startsWith("正在")) return trimmed;
    return `正在${trimmed}`;
  }

  // done
  if (trimmed.startsWith("正在")) return `已${trimmed.slice(2)}`;
  if (trimmed.startsWith("已")) return trimmed;
  if (/^(打开|执行|查询|保存|准备|生成|调用|读取|搜索|更新|提取|渲染|截取|列出|运行|匹配|编辑|写入|抓取|加载)/.test(trimmed)) {
    return `已${trimmed}`;
  }
  return `已完成：${trimmed}`;
}

/**
 * Primary row label for a single tool part (Codex-like: short, tense-aware, zh).
 */
export function getWodeAppToolActivityLabel(
  part: AnyToolPart,
  options?: ToolActivityOptions,
): string {
  const tense = toolActivityTense(part, options);
  const base = withWodeAppToolTense(getWodeAppToolBaseLabel(part), tense);
  if (tense !== "error") return base;
  const errorPart =
    part.state === "output-error"
      ? part
      : ({
          ...part,
          state: "output-error",
          errorText: ORPHANED_IDLE_TOOL_ERROR,
        } as AnyToolPart);
  const reason = shortWodeAppToolErrorReason(errorPart);
  return reason ? `${base} · ${reason}` : base;
}

type ActivityFamily = {
  key: string;
  done: string;
  running: string;
  multiDone: string;
};

function activityFamilyOf(part: AnyToolPart): ActivityFamily {
  const tool = canonicalizeToolName(toolNameOf(part));
  if (tool === "bash" || tool === "shell" || tool === "exec") {
    return { key: "bash", done: "已运行命令", running: "正在运行命令", multiDone: "运行了命令" };
  }
  if (tool === "read") {
    return { key: "read", done: "已读取文件", running: "正在读取文件", multiDone: "已读取文件" };
  }
  if (tool === "write") {
    return { key: "write", done: "已写入文件", running: "正在写入文件", multiDone: "已写入文件" };
  }
  if (tool === "edit" || tool === "apply_patch" || tool === "apply-patch") {
    return { key: "edit", done: "编辑了文件", running: "正在编辑文件", multiDone: "编辑了文件" };
  }
  if (tool === "grep") {
    return { key: "grep", done: "已搜索文件", running: "正在搜索文件", multiDone: "已搜索文件" };
  }
  if (tool === "glob") {
    return { key: "glob", done: "已匹配文件", running: "正在匹配文件", multiDone: "已匹配文件" };
  }
  if (tool === "websearch" || tool === "web_search") {
    return { key: "websearch", done: "已搜索网页", running: "正在搜索网页", multiDone: "已搜索网页" };
  }
  if (tool === "webfetch" || tool === "web_fetch") {
    return { key: "webfetch", done: "已抓取网页", running: "正在抓取网页", multiDone: "已抓取网页" };
  }
  const base = getWodeAppToolBaseLabel(part);
  return {
    key: `other:${base}`,
    done: withWodeAppToolTense(base, "done"),
    running: withWodeAppToolTense(base, "running"),
    multiDone: withWodeAppToolTense(base, "done"),
  };
}

/**
 * Codex-style muted activity line between prose:
 * "已读取文件 运行了多个命令 已搜索网页"
 */
export function formatCodexStyleActivitySummary(
  parts: AnyToolPart[],
  options?: ToolActivityOptions,
): string {
  if (parts.length === 0) return "";

  const order: string[] = [];
  const buckets = new Map<string, { family: ActivityFamily; count: number; running: number; failed: number }>();

  for (const part of parts) {
    const family = activityFamilyOf(part);
    const tense = toolActivityTense(part, options);
    let bucket = buckets.get(family.key);
    if (!bucket) {
      bucket = { family, count: 0, running: 0, failed: 0 };
      buckets.set(family.key, bucket);
      order.push(family.key);
    }
    bucket.count += 1;
    if (tense === "running") bucket.running += 1;
    if (tense === "error") bucket.failed += 1;
  }

  const phrases = order.slice(0, 4).map((key) => {
    const bucket = buckets.get(key)!;
    if (bucket.running > 0) {
      return bucket.count > 1 ? `${bucket.family.running}（${bucket.count}）` : bucket.family.running;
    }
    if (bucket.failed > 0 && bucket.failed === bucket.count) {
      return withWodeAppToolTense(bucket.family.done.replace(/^已/, "").replace(/了文件$/, "文件"), "error");
    }
    if (bucket.count > 1) {
      if (bucket.family.key === "bash") return `运行了 ${bucket.count} 个命令`;
      if (bucket.family.key === "read") return `已读取 ${bucket.count} 个文件`;
      if (bucket.family.key === "edit") return `编辑了 ${bucket.count} 个文件`;
      if (bucket.family.key === "write") return `已写入 ${bucket.count} 个文件`;
      if (bucket.family.key === "grep" || bucket.family.key === "glob") {
        return `${bucket.family.multiDone} ×${bucket.count}`;
      }
      return `${bucket.family.multiDone} ×${bucket.count}`;
    }
    return bucket.family.done;
  });

  if (order.length > 4) phrases.push("…");
  return phrases.join(" ");
}

export type ToolActivityPeekLine = {
  tone: "neutral" | "add" | "remove" | "meta";
  text: string;
};

function clipPeekLine(text: string, maxChars: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  if (!oneLine) return "";
  return oneLine.length > maxChars ? `${oneLine.slice(0, maxChars)}…` : oneLine;
}

function pathOfToolInput(input: Record<string, unknown> | null): string {
  if (!input) return "";
  for (const key of ["filePath", "path", "file", "target"]) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function peekLinesFromText(
  text: string,
  tone: ToolActivityPeekLine["tone"],
  maxLines: number,
  maxChars: number,
  prefix = "",
): ToolActivityPeekLine[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0);
  return lines.slice(0, maxLines).flatMap((line) => {
    const clipped = clipPeekLine(`${prefix}${line}`, maxChars);
    return clipped ? [{ tone, text: clipped }] : [];
  });
}

/**
 * Cursor-style collapsed peek: a few real content lines under the activity
 * summary so merchants can see what ran without expanding every step.
 */
export function buildWodeAppToolActivityPeek(
  parts: AnyToolPart[],
  options?: { maxLines?: number; maxLineChars?: number },
): ToolActivityPeekLine[] {
  const maxLines = Math.max(1, options?.maxLines ?? 6);
  const maxChars = Math.max(24, options?.maxLineChars ?? 88);
  const out: ToolActivityPeekLine[] = [];

  const push = (line: ToolActivityPeekLine | null | undefined) => {
    if (!line?.text || out.length >= maxLines) return;
    out.push(line);
  };

  // Prefer edit/write peeks (diff-like) when present — closest to Cursor.
  for (const part of parts) {
    if (out.length >= maxLines) break;
    const tool = canonicalizeToolName(toolNameOf(part));
    const input = asRecord(part.input);
    if (tool !== "edit" && tool !== "apply_patch" && tool !== "apply-patch" && tool !== "write" && tool !== "strreplace") {
      continue;
    }
    const path = pathOfToolInput(input);
    if (path) push({ tone: "meta", text: clipPeekLine(path, maxChars) });
    const oldText =
      (typeof input?.oldString === "string" && input.oldString)
      || (typeof input?.old_string === "string" && input.old_string)
      || "";
    const newText =
      (typeof input?.newString === "string" && input.newString)
      || (typeof input?.new_string === "string" && input.new_string)
      || (typeof input?.content === "string" && input.content)
      || "";
    for (const line of peekLinesFromText(String(oldText), "remove", 2, maxChars, "- ")) {
      push(line);
    }
    for (const line of peekLinesFromText(String(newText), "add", tool === "write" ? 4 : 3, maxChars, "+ ")) {
      push(line);
    }
  }

  // Bash / shell: show `$ command` lines (and a tiny output sniff for single runs).
  const bashParts = parts.filter((part) => {
    const tool = canonicalizeToolName(toolNameOf(part));
    return tool === "bash" || tool === "shell" || tool === "exec";
  });
  if (bashParts.length > 0 && out.length < maxLines) {
    const budget = Math.min(4, maxLines - out.length);
    const shown = bashParts.slice(0, budget);
    for (const part of shown) {
      const input = asRecord(part.input);
      const command = typeof input?.command === "string" ? input.command.trim() : "";
      if (!command) continue;
      const oneLine = command.split(/\r?\n/, 1)[0]?.trim() || command;
      push({ tone: "neutral", text: clipPeekLine(`$ ${oneLine}`, maxChars) });
    }
    if (bashParts.length > shown.length) {
      push({ tone: "meta", text: `…另有 ${bashParts.length - shown.length} 条命令` });
    } else if (bashParts.length === 1) {
      const only = bashParts[0]!;
      const output = "output" in only ? only.output : undefined;
      const outputText =
        typeof output === "string"
          ? output
          : output && typeof output === "object" && !Array.isArray(output) && typeof (output as { text?: unknown }).text === "string"
            ? String((output as { text: string }).text)
            : "";
      for (const line of peekLinesFromText(outputText, "neutral", Math.min(2, maxLines - out.length), maxChars)) {
        push(line);
      }
    }
  }

  // Read / grep: path or query so the strip is not empty for file runs.
  if (out.length === 0) {
    for (const part of parts) {
      if (out.length >= maxLines) break;
      const tool = canonicalizeToolName(toolNameOf(part));
      const input = asRecord(part.input);
      if (tool === "read" || tool === "grep" || tool === "glob") {
        const path = pathOfToolInput(input);
        const pattern = typeof input?.pattern === "string" ? input.pattern.trim() : "";
        if (path) push({ tone: "meta", text: clipPeekLine(path, maxChars) });
        else if (pattern) push({ tone: "neutral", text: clipPeekLine(pattern, maxChars) });
      }
    }
  }

  return out;
}

/**
 * Collapsed multi-step header. Prefer Codex-style activity phrases over
 * opaque "已完成 N 个步骤" when steps are heterogeneous.
 */
export function summarizeWodeAppToolActivityGroup(
  parts: AnyToolPart[],
  options?: ToolActivityOptions,
): {
  running: boolean;
  failed: number;
  summary: string;
} {
  const settled = settleInFlightToolPartsForIdleSession(parts, options?.sessionLive !== false);
  const running = settled.some((part) => toolActivityTense(part, options) === "running");
  const failedParts = settled.filter((part) => toolActivityTense(part, options) === "error");
  const failed = failedParts.length;
  const bases = settled.map((part) => getWodeAppToolBaseLabel(part));
  const unique = [...new Set(bases.filter(Boolean))];
  const count = settled.length;
  const latestReason = [...failedParts]
    .reverse()
    .map((part) => shortWodeAppToolErrorReason(part))
    .find(Boolean) || "";

  if (unique.length === 1) {
    const base = unique[0]!;
    const family = activityFamilyOf(settled[0]!);
    if (family.key === "bash" && count > 1 && !running && failed === 0) {
      return { running: false, failed: 0, summary: `运行了 ${count} 个命令` };
    }
    if (running) {
      return {
        running: true,
        failed,
        summary: count > 1 ? `正在${base}（${count}）` : `正在${base}`,
      };
    }
    if (failed > 0) {
      const head = count > 1
        ? `${withWodeAppToolTense(base, "done").replace(/^已/, "")} ×${count} · ${failed} 个未完成`
        : withWodeAppToolTense(base, "error");
      return {
        running: false,
        failed,
        summary: latestReason ? `${head} · ${latestReason}` : head,
      };
    }
    return {
      running: false,
      failed: 0,
      summary: count > 1
        ? `${withWodeAppToolTense(base, "done")} ×${count}`
        : withWodeAppToolTense(base, "done"),
    };
  }

  // Mixed tool types / bash descriptions → Codex activity strip.
  const codex = formatCodexStyleActivitySummary(settled, options);
  if (failed > 0) {
    const head = `${codex} · ${failed} 个未完成`;
    return {
      running,
      failed,
      summary: latestReason ? `${head} · ${latestReason}` : head,
    };
  }
  return { running, failed: 0, summary: codex || (running ? `正在执行 ${count} 个步骤` : `已完成 ${count} 个步骤`) };
}

/**
 * Subagent `task` results are the real answer for many turns, but the UI
 * collapses them behind「查看详情」. Pull `<task_result>` (or stripped
 * `<task>` body) into flat prose so the transcript matches what was produced.
 */
export const SURFACED_TASK_RESULT_MIN_CHARS = 40;

function shouldSurfaceTaskResultProse(prose: string, minChars: number): boolean {
  if (!prose) return false;
  if (prose.length >= minChars) return true;
  // Short Chinese reports still count when they open with a markdown heading.
  return /^#{1,3}\s+\S/m.test(prose);
}

export function extractTaskResultProse(output: unknown): string {
  let raw = "";
  if (typeof output === "string") {
    raw = output;
  } else if (output && typeof output === "object" && !Array.isArray(output)) {
    const record = output as Record<string, unknown>;
    if (typeof record.text === "string") raw = record.text;
    else if (typeof record.result === "string") raw = record.result;
    else if (typeof record.output === "string") raw = record.output;
  }
  raw = raw.trim();
  if (!raw) return "";

  const tagged = raw.match(/<task_result\b[^>]*>\s*([\s\S]*?)\s*<\/task_result>/i);
  let body = (tagged?.[1] ?? raw).trim();
  if (!tagged) {
    body = body
      .replace(/^<task\b[^>]*>\s*/i, "")
      .replace(/\s*<\/task>\s*$/i, "")
      .trim();
    const nested = body.match(/<task_result\b[^>]*>\s*([\s\S]*?)\s*<\/task_result>/i);
    if (nested?.[1]) body = nested[1].trim();
  }

  // Drop short English preamble before the first markdown heading when the
  // heading is nearby (common explore wrap-up: "Now I have…\n\n---\n\n# …").
  const headingAt = body.search(/\n#{1,3}\s+\S/);
  if (headingAt > 0 && headingAt < 600) {
    const before = body.slice(0, headingAt).trim();
    if (
      /^(Now I have|I (?:now )?have|Let me|Here(?:'s| is)|Compiling)/i.test(before)
      || /\n---\s*$/.test(before)
      || /^---\s*$/m.test(before)
    ) {
      body = body.slice(headingAt + 1).trim();
    }
  }

  return body;
}

export function collectSurfacedTaskResultProse(
  parts: AnyToolPart[],
  options?: { minChars?: number },
): string[] {
  const minChars = typeof options?.minChars === "number" && Number.isFinite(options.minChars)
    ? Math.max(0, options.minChars)
    : SURFACED_TASK_RESULT_MIN_CHARS;
  const out: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const name = canonicalizeToolName(toolNameOf(part));
    if (name !== "task") continue;
    if (part.state !== "output-available") continue;
    if (!("output" in part)) continue;
    const prose = extractTaskResultProse(part.output);
    if (!shouldSurfaceTaskResultProse(prose, minChars)) continue;
    const key = prose.slice(0, 240);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(prose);
  }

  return out;
}

const AUTHORITATIVE_ASSISTANT_FINISH_REASONS = new Set([
  "stop",
  "length",
  "content-filter",
  "content_filter",
  "end-turn",
  "end_turn",
  "completed",
]);

type AssistantMessageAuthorityInput = {
  role?: unknown;
  parts?: unknown;
  metadata?: unknown;
};

function visibleAssistantText(parts: unknown): string {
  if (!Array.isArray(parts)) return "";
  return parts
    .map((part) => {
      const record = asRecord(part);
      if (record?.type !== "text" || typeof record.text !== "string") return "";
      return record.text.replace(/<think\b[^>]*>[\s\S]*?(?:<\/think>|$)/gi, "").trim();
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * OpenCode emits multiple assistant messages in one visual turn. Only a
 * completed terminal message with user-visible prose is the parent's
 * authoritative final reply; `finish: "tool-calls"` is an intermediate step.
 */
export function assistantMessageHasAuthoritativeFinalReply(
  message: AssistantMessageAuthorityInput,
): boolean {
  if (message.role !== "assistant") return false;
  const metadata = asRecord(message.metadata);
  const opencode = asRecord(metadata?.opencode);
  const finish = typeof opencode?.finish === "string"
    ? opencode.finish.trim().toLowerCase()
    : "";
  if (!AUTHORITATIVE_ASSISTANT_FINISH_REASONS.has(finish)) return false;
  if (typeof opencode?.completed !== "number" || !Number.isFinite(opencode.completed)) return false;
  return visibleAssistantText(message.parts).length > 0;
}

const SELF_CONTAINED_TERMINAL_PROSE_MIN_CHARS = 240;

function terminalProseIsSelfContained(text: string): boolean {
  if (text.length >= SELF_CONTAINED_TERMINAL_PROSE_MIN_CHARS) return true;
  return (
    /^#{1,3}\s+\S/m.test(text)
    || /(?:^|\n)\s*\d+[.)、]\s+\S/m.test(text)
    || /(?:^|\n)\s*[-*]\s+\S/m.test(text)
    || /(?:^|\n)\|.+\|\s*$/m.test(text)
  );
}

/**
 * Once a turn has a terminal reply, collapse earlier tool-call narration out
 * of the prose lane. Some models write the real report immediately before a
 * final todo tool and then emit only a short `stop` addendum, so retain the
 * last preceding prose in that case.
 */
export function selectAssistantProseMessageIds(
  messages: Array<AssistantMessageAuthorityInput & { id?: unknown }>,
): string[] {
  const allMessageIds = messages.flatMap((message) =>
    typeof message.id === "string" && message.id ? [message.id] : []
  );
  const textEntries = messages.flatMap((message, index) => {
    const id = typeof message.id === "string" ? message.id : "";
    const text = visibleAssistantText(message.parts);
    return id && text ? [{ id, index, text, message }] : [];
  });
  if (textEntries.length === 0) return allMessageIds;

  let terminalEntry: (typeof textEntries)[number] | undefined;
  for (const entry of textEntries) {
    if (assistantMessageHasAuthoritativeFinalReply(entry.message)) terminalEntry = entry;
  }
  if (!terminalEntry) return allMessageIds;

  const keep = new Set<string>([terminalEntry.id]);
  if (!terminalProseIsSelfContained(terminalEntry.text)) {
    for (let index = textEntries.length - 1; index >= 0; index -= 1) {
      const entry = textEntries[index];
      if (!entry || entry.index >= terminalEntry.index) continue;
      keep.add(entry.id);
      break;
    }
  }
  return textEntries.filter((entry) => keep.has(entry.id)).map((entry) => entry.id);
}

/**
 * A completed subagent report is useful when the parent never produced a
 * terminal reply (cancel/interruption), but must never masquerade as final
 * prose while the parent is still live or after a real parent final exists.
 */
export function shouldSurfaceTaskResultFallback(input: {
  sessionLive: boolean;
  hasAuthoritativeFinalReply: boolean;
}): boolean {
  return !input.sessionLive && !input.hasAuthoritativeFinalReply;
}
