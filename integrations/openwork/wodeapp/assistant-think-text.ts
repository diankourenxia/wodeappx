export type AssistantTextSegment = {
  kind: "text" | "reasoning";
  text: string;
};

const THINK_TAG_PATTERN = /<\/?think\s*>/gi;
const THINK_BLOCK_RE = /<think\b[^>]*>[\s\S]*?<\/think>/gi;
const THINK_UNCLOSED_RE = /<think\b[^>]*>[\s\S]*$/i;
const COMPLETE_OPENING_THINK_TAG = "<think>";

function isPartialOpeningThinkTag(text: string): boolean {
  const candidate = text.trimStart();
  if (!candidate) return false;

  const normalized = candidate.toLowerCase();
  return COMPLETE_OPENING_THINK_TAG.startsWith(normalized) || /^<think\s*$/i.test(candidate);
}

/**
 * Drop provider `<think>` framing without collapsing ordinary whitespace.
 * Used as defense when think text is mis-attributed onto a user bubble.
 */
export function stripProviderThinkTags(text: string): string {
  return text
    .replace(THINK_BLOCK_RE, "")
    .replace(THINK_UNCLOSED_RE, "")
    .replace(THINK_TAG_PATTERN, "");
}

/**
 * Some OpenAI-compatible providers stream chain-of-thought inside a normal
 * text part using <think> tags. Markdown can briefly paint an unclosed block
 * and then remove it when </think> arrives, which looks like lost output.
 *
 * Only treat the tags as protocol framing when the first non-whitespace
 * content is <think>. This avoids rewriting ordinary answers that merely show
 * a <think> tag as an example.
 */
export function splitAssistantThinkText(
  text: string,
  isStreaming = false,
): AssistantTextSegment[] | null {
  const first = THINK_TAG_PATTERN.exec(text);
  THINK_TAG_PATTERN.lastIndex = 0;
  if (!first || first.index !== text.search(/\S/)) {
    return isStreaming && isPartialOpeningThinkTag(text) ? [] : null;
  }

  const segments: AssistantTextSegment[] = [];
  let cursor = 0;
  let reasoning = false;

  for (const match of text.matchAll(THINK_TAG_PATTERN)) {
    const index = match.index ?? 0;
    const before = text.slice(cursor, index);
    if (before) segments.push({ kind: reasoning ? "reasoning" : "text", text: before });
    reasoning = !match[0].startsWith("</");
    cursor = index + match[0].length;
  }

  const tail = text.slice(cursor);
  if (tail) segments.push({ kind: reasoning ? "reasoning" : "text", text: tail });
  return segments;
}
