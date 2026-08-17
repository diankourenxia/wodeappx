/**
 * Collapse full HTML documents pasted into assistant markdown.
 *
 * When discovery fails and the model dumps a review page into chat
 * (ses_0248febaa*), the JS/template body shows as "穿帮". Rendering must not
 * present whole HTML files as prose/code walls — point at write-to-disk instead.
 */

const HTML_FENCE_RE = /```html\b[^\n]*\n([\s\S]*?)```/gi

const FULL_DOCUMENT_RE = /<!DOCTYPE\s+html|<html[\s>]|<script[\s>]/i

/** ~2KB: short snippets stay; full review pages collapse. */
export const ASSISTANT_HTML_FENCE_COLLAPSE_CHARS = 2000

export function isFullHtmlDocumentFence(body: string): boolean {
  const text = body.trim()
  if (text.length < ASSISTANT_HTML_FENCE_COLLAPSE_CHARS) return false
  return FULL_DOCUMENT_RE.test(text)
}

export function collapseOversizedHtmlFences(markdown: string): string {
  if (!markdown || !markdown.includes("```html")) return markdown
  return markdown.replace(HTML_FENCE_RE, (full, body: string) => {
    if (!isFullHtmlDocumentFence(body)) return full
    const bytes = body.length
    return [
      "```text",
      `（已折叠完整 HTML 页面，约 ${bytes} 字符。请用 write 保存为 .html 后打开，不要把整页源码贴进聊天。）`,
      "```",
    ].join("\n")
  })
}
