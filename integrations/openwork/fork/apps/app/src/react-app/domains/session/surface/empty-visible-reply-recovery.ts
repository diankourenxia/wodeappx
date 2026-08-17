/**
 * Recovery for "empty visible" assistant finishes:
 * 1) Fake `<tool_call><invoke name="…">` XML dumped into reasoning / `<think>`,
 *    then finish=stop with no real tool part → blank idle UI.
 * 2) Plain reasoning-only stop after tools (ses_049432): stream ends with
 *    finish=stop, tokens often 0, only a truncated reasoning part, no text →
 *    same blank idle. Kimi thinking models are known to do this after tool steps.
 *
 * Prefer recovering `question` XML into ```wodeapp-choices``` for the transcript.
 * Otherwise kick a silent auto-continue (same marker family as stuck-tool).
 */

/** Keep identical to STUCK_TOOL_AUTO_CONTINUE_MARKER so transcript hiding still works. */
export const EMPTY_VISIBLE_REPLY_AUTO_CONTINUE_MARKER =
  "以下是WodeAppX 的系统自动续跑指令（非用户发言）。";

const TOOL_CALL_BLOCK_RE =
  /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/i;
const INVOKE_NAME_RE =
  /<invoke\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>/i;
const FUNCTION_CALL_RE =
  /<function(?:_call)?\b[^>]*\bname\s*=\s*["']([^"']+)["']/i;
const THINK_INNER_RE = /<think\b[^>]*>[\s\S]*?<\/think>/gi;
const THINK_UNCLOSED_RE = /<think\b[^>]*>[\s\S]*$/i;
const THINK_TAG_RE = /<\/?think\s*>/gi;

export type EmptyVisiblePartLike = {
  type?: string;
  text?: string;
  tool?: string;
  toolName?: string;
  state?: unknown;
};

export type EmptyVisibleMessageLike = {
  info?: {
    id?: string;
    role?: string;
    finish?: string;
    time?: { created?: number; completed?: number };
  };
  parts?: EmptyVisiblePartLike[];
};

export type EmptyVisibleSnapshotLike = {
  status?: { type?: string };
  messages?: EmptyVisibleMessageLike[];
};

export type RecoveredQuestionOption = {
  label: string;
  description?: string;
};

export type RecoveredQuestion = {
  header: string;
  question: string;
  options: RecoveredQuestionOption[];
};

export type EmptyVisibleRecovery = {
  messageId: string;
  toolName: string | null;
  recoveredMarkdown: string | null;
  recoverableQuestion: boolean;
};

/** Drop provider `<think>` bodies so only user-visible prose remains. */
export function stripThinkFraming(text: string): string {
  return text
    .replace(THINK_INNER_RE, " ")
    .replace(THINK_UNCLOSED_RE, " ")
    .replace(THINK_TAG_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

function firstTagText(source: string, tag: string): string {
  const match = source.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return match?.[1] ? decodeXmlEntities(match[1]).replace(/\s+/g, " ").trim() : "";
}

/** Extract inner HTML of the first balanced `<tag>…</tag>` (handles nested same-name tags). */
function extractBalancedTagInner(source: string, tag: string): string | null {
  const openRe = new RegExp(`<${tag}\\b[^>]*>`, "i");
  const open = openRe.exec(source);
  if (!open) return null;
  const start = open.index + open[0].length;
  const openTag = new RegExp(`<${tag}\\b`, "gi");
  const closeTag = new RegExp(`</${tag}\\s*>`, "gi");
  let depth = 1;
  let cursor = start;
  while (depth > 0 && cursor < source.length) {
    openTag.lastIndex = cursor;
    closeTag.lastIndex = cursor;
    const nextOpen = openTag.exec(source);
    const nextClose = closeTag.exec(source);
    if (!nextClose) return null;
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + nextOpen[0].length;
      continue;
    }
    depth -= 1;
    if (depth === 0) return source.slice(start, nextClose.index);
    cursor = nextClose.index + nextClose[0].length;
  }
  return null;
}

function collectDirectItemBlocks(source: string): string[] {
  const blocks: string[] = [];
  const openRe = /<item\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = openRe.exec(source))) {
    const inner = extractBalancedTagInner(source.slice(match.index), "item");
    if (inner == null) continue;
    blocks.push(inner);
    openRe.lastIndex = match.index + match[0].length + inner.length;
  }
  return blocks;
}

/** Hidden channels that can hold fake tool XML (reasoning + think-framed text). */
export function collectHiddenAssistantCorpus(parts: EmptyVisiblePartLike[] | undefined): string {
  if (!Array.isArray(parts) || parts.length === 0) return "";
  const chunks: string[] = [];
  for (const part of parts) {
    const type = String(part.type || "");
    const text = typeof part.text === "string" ? part.text : "";
    if (!text.trim()) continue;
    if (type === "reasoning") {
      chunks.push(text);
      continue;
    }
    if (type === "text") {
      // Keep raw text so we can still find XML inside <think>…</think>.
      chunks.push(text);
    }
  }
  return chunks.join("\n");
}

export function detectMalformedToolName(corpus: string): string | null {
  if (!corpus.trim()) return null;
  const block = corpus.match(TOOL_CALL_BLOCK_RE)?.[1] || corpus;
  const invoke = block.match(INVOKE_NAME_RE)?.[1]
    || corpus.match(INVOKE_NAME_RE)?.[1]
    || corpus.match(FUNCTION_CALL_RE)?.[1];
  if (!invoke) {
    // Broad signal: tool_call framing without a parseable name.
    if (/<tool_call\b/i.test(corpus) || /<invoke\b/i.test(corpus)) return "tool";
    return null;
  }
  return invoke.trim();
}

export function parseRecoveredQuestion(corpus: string): RecoveredQuestion | null {
  const toolName = detectMalformedToolName(corpus);
  if (toolName && toolName !== "question" && toolName !== "tool") return null;
  if (!/<question\b/i.test(corpus) && !/name\s*=\s*["']question["']/i.test(corpus)) {
    return null;
  }

  const question = firstTagText(corpus, "question");
  const header = firstTagText(corpus, "header") || "请选择";
  const optionsBlock = extractBalancedTagInner(corpus, "options") || "";
  const options = collectDirectItemBlocks(optionsBlock).flatMap((block) => {
    const label = firstTagText(block, "label");
    if (!label) return [];
    const description = firstTagText(block, "description") || undefined;
    return [{ label, description }];
  });

  if (!question && options.length === 0) return null;
  return {
    header,
    question: question || header,
    options,
  };
}

export function formatRecoveredQuestionMarkdown(recovered: RecoveredQuestion): string {
  const lines = [
    recovered.question,
    "",
    "```wodeapp-choices",
    JSON.stringify(
      {
        title: recovered.header,
        submitLabel: "继续",
        questions: [
          {
            id: "recovered_question",
            label: recovered.header,
            helper: recovered.question !== recovered.header ? recovered.question : undefined,
            mode: "single",
            allowCustom: true,
            customPlaceholder: "其他补充...",
            options: recovered.options.map((option) => ({
              label: option.label,
              value: option.label,
            })),
          },
        ],
      },
      null,
      2,
    ),
    "```",
  ];
  return lines.join("\n").trim();
}

export function recoverVisibleMarkdownFromHiddenCorpus(corpus: string): {
  toolName: string | null;
  recoveredMarkdown: string | null;
  recoverableQuestion: boolean;
} {
  const toolName = detectMalformedToolName(corpus);
  const question = parseRecoveredQuestion(corpus);
  if (question && question.options.length > 0) {
    return {
      toolName: toolName || "question",
      recoveredMarkdown: formatRecoveredQuestionMarkdown(question),
      recoverableQuestion: true,
    };
  }
  return {
    toolName,
    recoveredMarkdown: null,
    recoverableQuestion: false,
  };
}

export function assistantPartsHaveVisibleUserContent(
  parts: EmptyVisiblePartLike[] | undefined,
): boolean {
  if (!Array.isArray(parts) || parts.length === 0) return false;
  for (const part of parts) {
    const type = String(part.type || "");
    if (type === "file") return true;
    if (type === "tool" || type.includes("tool")) return true;
    if (type === "text" && typeof part.text === "string") {
      const visible = stripThinkFraming(part.text);
      // Ignore leftover fake tool XML if it somehow escaped think framing.
      if (!visible) continue;
      if (/^<tool_call\b/i.test(visible) || /^<invoke\b/i.test(visible)) continue;
      return true;
    }
  }
  return false;
}

export function findEmptyVisibleCompletedAssistantTurn(
  snapshot: EmptyVisibleSnapshotLike | null | undefined,
): EmptyVisibleRecovery | null {
  if (!snapshot?.messages?.length) return null;
  const status = snapshot.status?.type;
  if (status === "busy" || status === "retry") return null;

  let lastUserIndex = -1;
  for (let i = snapshot.messages.length - 1; i >= 0; i -= 1) {
    if (snapshot.messages[i]?.info?.role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  if (lastUserIndex < 0) return null;

  const assistants = snapshot.messages.slice(lastUserIndex + 1).filter(
    (message) => message.info?.role === "assistant",
  );
  if (assistants.length === 0) return null;

  const last = assistants[assistants.length - 1];
  // Only the final assistant in the turn must deliver visible prose. Earlier
  // steps often say "我先看看…" + tools; a trailing reasoning-only stop still
  // leaves the user without the promised answer (ses_049432).
  if (assistantPartsHaveVisibleUserContent(last.parts)) {
    return null;
  }

  const messageId = last.info?.id;
  if (!messageId) return null;
  // Prefer completed turns; also accept missing completed when status is idle
  // (some snapshots settle finish without time.completed in edge races).
  const completed = last.info?.time?.completed;
  const finish = last.info?.finish;
  if (finish && finish !== "stop" && finish !== "end-turn" && finish !== "unknown") {
    // Tool-call finishes should still have a tool part; if not, still recover.
    if (finish !== "tool-calls") return null;
  }
  if (typeof completed === "number" && !Number.isFinite(completed) && finish == null) {
    return null;
  }

  const corpus = collectHiddenAssistantCorpus(last.parts);
  const recovered = recoverVisibleMarkdownFromHiddenCorpus(corpus);
  if (!recovered.toolName && !corpus.trim() && !(last.parts || []).length) {
    // Genuinely empty shell with no hidden corpus — still worth one continue.
    return {
      messageId,
      toolName: null,
      recoveredMarkdown: null,
      recoverableQuestion: false,
    };
  }
  if (!recovered.toolName && !/<tool_call\b|<invoke\b|<think\b/i.test(corpus)) {
    // Plain reasoning-only (or other hidden corpus without fake tool XML):
    // user still sees a blank finish — auto-continue (ses_049432).
    return {
      messageId,
      toolName: null,
      recoveredMarkdown: null,
      recoverableQuestion: false,
    };
  }

  return {
    messageId,
    toolName: recovered.toolName,
    recoveredMarkdown: recovered.recoveredMarkdown,
    recoverableQuestion: recovered.recoverableQuestion,
  };
}

export function buildEmptyVisibleReplyAutoContinueSystemContext(
  toolName: string | null,
): string {
  const name = (toolName || "").trim();
  const toolHint = name && name !== "tool"
    ? `上一轮把「${name}」写成了 reasoning / <think> 里的伪 XML（<tool_call>/<invoke>），没有真正发起工具调用，用户侧看到空白结束。`
    : "上一轮助手在 finish=stop 时没有可见正文（只有 reasoning / 空壳，常见于工具步之后的 thinking 空停），会话已 idle。";
  const actionHint = name === "question"
    ? "请立刻用原生 question 工具，或在可见正文输出 ```wodeapp-choices JSON；禁止再把 tool_call XML 写进 reasoning。"
    : "请立刻用可见正文继续完成用户原任务（给出结论或下一步）；如需提问，用原生 question 工具或 ```wodeapp-choices；禁止只写 reasoning 就 stop；禁止把 <tool_call> XML 写进 reasoning。";
  return [
    EMPTY_VISIBLE_REPLY_AUTO_CONTINUE_MARKER,
    toolHint,
    actionHint,
  ].join("");
}

/** UIMessage-shaped parts (AI SDK) for transcript recovery. */
export function recoverVisibleMarkdownFromUiParts(
  parts: Array<{ type?: string; text?: string }> | undefined,
): string | null {
  const corpus = collectHiddenAssistantCorpus(parts);
  return recoverVisibleMarkdownFromHiddenCorpus(corpus).recoveredMarkdown;
}
