/**
 * Recovery when a turn ends mid-work because output was truncated.
 *
 * Gaps vs empty-visible-reply-recovery:
 * - empty-visible only handles finish=stop/tool-calls with NO visible prose
 * - finish=length was explicitly ignored there
 * - finish=stop with a half sentence ("现在把…写进去：") also skipped — user sees "断了"
 *
 * ses_01562a732ffe*: length ×3 on update_page, then stop with 26–38 char
 * truncated promises; idle for minutes until the user pinged.
 */

import { STUCK_TOOL_AUTO_CONTINUE_MARKER } from "./stuck-tool-recovery";
import {
  stripThinkFraming,
  type EmptyVisibleMessageLike,
  type EmptyVisiblePartLike,
  type EmptyVisibleSnapshotLike,
} from "./empty-visible-reply-recovery";

export const TRUNCATED_OUTPUT_AUTO_CONTINUE_MARKER = STUCK_TOOL_AUTO_CONTINUE_MARKER;

export type TruncatedOutputKind = "length" | "incomplete_visible";

export type TruncatedOutputRecovery = {
  messageId: string;
  kind: TruncatedOutputKind;
  visiblePreview: string;
};

const TRAILING_INCOMPLETE_RE = /[：:+\-—–、，,（(【\[]\s*$/u;
const PROMISE_WITHOUT_CLOSE_RE =
  /(?:现在|接下来|然后|重新).{0,24}(?:把|写|提交|更新|发布|继续)|写进去|完整页面|重新提交/u;
const TERMINAL_PUNCT_RE = /[。！？!?…]["'」』）)\]]*\s*$/u;

function collectVisibleAssistantText(parts: EmptyVisiblePartLike[] | undefined): string {
  if (!parts?.length) return "";
  const chunks: string[] = [];
  for (const part of parts) {
    if (part.type !== "text" || typeof part.text !== "string") continue;
    const visible = stripThinkFraming(part.text);
    if (visible) chunks.push(visible);
  }
  return chunks.join("\n").trim();
}

function hasCompletedToolCall(parts: EmptyVisiblePartLike[] | undefined): boolean {
  if (!parts?.length) return false;
  return parts.some((part) => {
    const type = String(part.type || "");
    if (type !== "tool" && !type.includes("tool")) return false;
    const status = String((part.state as { status?: string } | undefined)?.status || "");
    return status === "completed" || status === "error";
  });
}

/** Half-finished visible prose that leaves the user thinking the chat hung. */
export function looksLikeIncompleteVisibleReply(text: string): boolean {
  const visible = stripThinkFraming(text);
  if (!visible) return false;
  if (visible.length > 400) return false;
  if (TRAILING_INCOMPLETE_RE.test(visible)) return true;
  if (PROMISE_WITHOUT_CLOSE_RE.test(visible) && !TERMINAL_PUNCT_RE.test(visible)) {
    return true;
  }
  return false;
}

function lastAssistantAfterUser(
  snapshot: EmptyVisibleSnapshotLike,
): EmptyVisibleMessageLike | null {
  let lastUserIndex = -1;
  const messages = snapshot.messages || [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.info?.role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex < 0) return null;
  const assistants = messages.slice(lastUserIndex + 1).filter(
    (message) => message.info?.role === "assistant",
  );
  if (assistants.length === 0) return null;
  return assistants[assistants.length - 1] || null;
}

/**
 * Idle + truncated last assistant → silent auto-continue.
 * Prefer length; also catch stop/unknown with incomplete visible promise text.
 */
export function findTruncatedOutputAssistantTurn(
  snapshot: EmptyVisibleSnapshotLike | null | undefined,
): TruncatedOutputRecovery | null {
  if (!snapshot?.messages?.length) return null;
  const status = snapshot.status?.type;
  if (status === "busy" || status === "retry") return null;

  const last = lastAssistantAfterUser(snapshot);
  if (!last?.info?.id) return null;

  const finish = String(last.info.finish || "");
  const completed = last.info.time?.completed;
  if (finish && finish !== "length" && finish !== "stop" && finish !== "end-turn" && finish !== "unknown") {
    return null;
  }
  // Prefer settled turns; length/stop without completed can still be mid-stream.
  if (finish !== "length" && typeof completed !== "number") return null;

  const visible = collectVisibleAssistantText(last.parts);

  if (finish === "length") {
    return {
      messageId: last.info.id,
      kind: "length",
      visiblePreview: visible.slice(0, 120),
    };
  }

  // stop with incomplete promise — but not if a real tool already finished
  // this step (user got a result even if prose trails off).
  if (looksLikeIncompleteVisibleReply(visible) && !hasCompletedToolCall(last.parts)) {
    return {
      messageId: last.info.id,
      kind: "incomplete_visible",
      visiblePreview: visible.slice(0, 120),
    };
  }

  return null;
}

export function buildTruncatedOutputAutoContinueSystemContext(
  kind: TruncatedOutputKind,
): string {
  const why = kind === "length"
    ? "上一轮因输出长度上限结束（finish=length），工具参数/正文被截断，用户侧像对话断了。"
    : "上一轮可见正文在半句停住（例如「写进去：」后无下文），没有完成承诺的动作，用户侧像对话断了。";
  return [
    TRUNCATED_OUTPUT_AUTO_CONTINUE_MARKER,
    why,
    "请立刻用可见正文说明卡点，并继续完成用户原任务。",
    "若涉及大段 CustomCode/页面 JSON：禁止再次把超大 config 塞进 update_page；先 write 到工作区文件，再用短参数更新/发布。",
    "禁止只写 reasoning 就 stop；禁止原样重试已被截断的大 payload。",
  ].join("");
}
