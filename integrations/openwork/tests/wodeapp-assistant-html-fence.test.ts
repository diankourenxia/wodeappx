import { describe, expect, test } from "bun:test"

import {
  ASSISTANT_HTML_FENCE_COLLAPSE_CHARS,
  collapseOversizedHtmlFences,
  isFullHtmlDocumentFence,
} from "../wodeapp/wodeapp-assistant-html-fence"

describe("wodeapp-assistant-html-fence", () => {
  test("keeps short html snippets", () => {
    const md = "见下：\n\n```html\n<div>hi</div>\n```\n"
    expect(collapseOversizedHtmlFences(md)).toBe(md)
    expect(isFullHtmlDocumentFence("<div>hi</div>")).toBe(false)
  })

  test("collapses full HTML review pages (ses_0248febaa)", () => {
    const body = `<!DOCTYPE html>\n<html><head></head><body><script>keep.push(a[0])</script>${"x".repeat(ASSISTANT_HTML_FENCE_COLLAPSE_CHARS)}</body></html>`
    const md = `审查页：\n\n\`\`\`html\n${body}\n\`\`\`\n\n标完发我`
    const out = collapseOversizedHtmlFences(md)
    expect(out).not.toContain("keep.push")
    expect(out).toContain("已折叠完整 HTML 页面")
    expect(out).toContain("write")
    expect(out).toContain("标完发我")
  })
})
