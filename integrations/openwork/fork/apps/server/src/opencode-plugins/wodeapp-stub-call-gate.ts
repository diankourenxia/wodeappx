/**
 * Stub-call gate: block obviously degenerate "placeholder" tool calls before
 * they execute.
 *
 * Observed failure mode (2026-08): under long / poisoned context the model
 * sometimes stops emitting the intended call and instead emits a minimal
 * "self-talk" call — writing hidden marker files like /tmp/.genpage with a
 * few bytes of content, calling a PAID generation tool with a junk prompt
 * ("占位" / "test" / "stop"), or running `bash` with `echo emit-edit-call`
 * / `echo halt` as a fake stand-in for the real tool. These calls succeed,
 * land in history, and get imitated by later turns; the paid ones also burn
 * credits on garbage images.
 *
 * This gate is a guardrail, not a root-cause fix: it refuses to execute the
 * stub and returns a recoverable correction so the loop cannot reinforce
 * itself. Poisoned sessions should still be abandoned for a fresh one.
 */

import { createToolItemFailure } from "./openwork-tool-result.js";

const WRITE_TOOL_NAMES = new Set(["write", "edit", "Write", "Edit"]);
const BASH_TOOL_NAMES = new Set(["bash", "Bash", "shell", "Shell"]);

/** Hidden marker files directly under /tmp, e.g. /tmp/.genpage, /tmp/.x */
const HIDDEN_TMP_MARKER_RE = /^\/tmp\/\.[A-Za-z0-9._-]+$/;

/**
 * Bare `echo <token>` with no pipes/redirection/chaining — the adapted thrash
 * after /tmp marker writes were blocked (ses_024ca612: echo emit-edit-call…).
 */
const BASH_ECHO_STUB_RE =
  /^\s*(?:\/bin\/)?echo\s+(?:['"]?)([A-Za-z0-9._-]{1,64})(?:['"]?)\s*$/;

/** Max content length for a hidden tmp marker write to still be treated as a stub. */
const STUB_MARKER_CONTENT_MAX = 120;

/** Tools whose junk invocation spends user credits (image / video generation). */
const PAID_GENERATION_TOOL_RE =
  /(ai_generate_image|product_visual_batch_image_run|batch_image_run|video_generate|video_storyboard_open|video_storyboard_update)/i;

const JUNK_PROMPT_WORDS = new Set([
  "占位",
  "测试",
  "占位符",
  "test",
  "testing",
  "stop",
  "ignore",
  "placeholder",
  "todo",
  "gen",
  "go",
  "ok",
  "x",
  "继续",
  "生成",
]);

const MIN_REAL_PROMPT_CHARS = 8;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function firstStringArg(args: unknown, keys: string[]): string {
  const record = asRecord(args);
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function isHiddenTmpMarkerPath(pathOrName: string): boolean {
  return HIDDEN_TMP_MARKER_RE.test(pathOrName.trim());
}

/** True when bash command is only `echo <short-token>` (no shell work). */
export function isBashEchoStubCommand(command: string): boolean {
  return BASH_ECHO_STUB_RE.test(command.trim());
}

export function isJunkGenerationPrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) return false; // missing prompt is a schema problem, not a stub
  if (JUNK_PROMPT_WORDS.has(trimmed.toLowerCase()) || JUNK_PROMPT_WORDS.has(trimmed)) return true;
  return trimmed.length < MIN_REAL_PROMPT_CHARS;
}

function stubCallFailure(reason: string, code: string, data: Record<string, unknown>): never {
  throw createToolItemFailure({
    message: [
      `疑似占位调用已拦截（${reason}），本次未执行。`,
      "请直接发出你真正意图的那个工具调用，并写全真实参数；",
      "不要先写 /tmp 隐藏标记文件，不要用 bash echo 假装调用，也不要用「占位/test/stop」之类的假 prompt 试探计费工具。",
    ].join(" "),
    recoverable: true,
    errorKind: "validation",
    data: { code, ...data },
  });
}

export function assertNotStubToolCall(tool: string, args: unknown): void {
  const toolName = tool.trim();

  if (WRITE_TOOL_NAMES.has(toolName)) {
    const filePath = firstStringArg(args, ["filePath", "filepath", "path"]);
    if (filePath && isHiddenTmpMarkerPath(filePath)) {
      const content = firstStringArg(args, ["content", "newString"]);
      if (content.length <= STUB_MARKER_CONTENT_MAX) {
        stubCallFailure("向 /tmp 写隐藏标记文件", "STUB_MARKER_WRITE_BLOCKED", {
          tool: toolName,
          filePath,
          contentLength: content.length,
        });
      }
    }
    return;
  }

  if (BASH_TOOL_NAMES.has(toolName)) {
    const command = firstStringArg(args, ["command", "cmd", "script"]);
    if (command && isBashEchoStubCommand(command)) {
      stubCallFailure("用 bash echo 假装工具调用", "STUB_BASH_ECHO_BLOCKED", {
        tool: toolName,
        command,
      });
    }
    return;
  }

  if (PAID_GENERATION_TOOL_RE.test(toolName)) {
    const prompt = firstStringArg(args, ["prompt"]);
    if (prompt && isJunkGenerationPrompt(prompt)) {
      stubCallFailure("计费生成工具收到乱词/过短 prompt", "STUB_PAID_GENERATION_BLOCKED", {
        tool: toolName,
        prompt,
      });
    }
  }
}

/** Hooks to merge into the OpenWorkExtensionsPreview plugin return value. */
export function buildStubCallGateHooks() {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: unknown },
    ) => {
      assertNotStubToolCall(input.tool, output.args);
    },
  };
}
