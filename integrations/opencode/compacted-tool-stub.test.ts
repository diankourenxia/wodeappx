import { describe, expect, test } from "bun:test"

import {
  COMPACTED_TOOL_STUB_MARKER,
  buildCompactedToolOutputStub,
  hasCompactedToolStubMarker,
  modelFacingCompactedToolOutput,
} from "./compacted-tool-stub"

describe("compacted-tool-stub", () => {
  test("keeps path and conclusion for read", () => {
    const stub = buildCompactedToolOutputStub({
      tool: "read",
      input: { filePath: "/tmp/message-list.tsx", offset: 880, limit: 120 },
      output: "export function UserMessage() {\n  return <div className=\"rounded-3xl\" />\n}\n",
    })
    expect(stub.includes(COMPACTED_TOOL_STUB_MARKER)).toBe(true)
    expect(stub.includes("tool: read")).toBe(true)
    expect(stub.includes("filePath: /tmp/message-list.tsx")).toBe(true)
    expect(stub.includes("offset: 880")).toBe(true)
    expect(stub.includes("rounded-3xl")).toBe(true)
    expect(stub.includes("re-run the same tool")).toBe(true)
    expect(hasCompactedToolStubMarker(stub)).toBe(true)
  })

  test("keeps command for bash", () => {
    const stub = buildCompactedToolOutputStub({
      tool: "bash",
      input: { command: 'grep -rn "bubble" wodeappx/vendor --include="*.tsx" | head' },
      output: "wodeappx/vendor/openwork/apps/app/src/components/chat/message-list.tsx:1122",
    })
    expect(stub.includes("tool: bash")).toBe(true)
    expect(stub.includes("command:")).toBe(true)
    expect(stub.includes("message-list.tsx:1122")).toBe(true)
  })

  test("modelFacing reuses existing stub", () => {
    const existing = buildCompactedToolOutputStub({
      tool: "read",
      input: { filePath: "/a.ts" },
      output: "const x = 1",
    })
    const again = modelFacingCompactedToolOutput({
      tool: "read",
      state: { input: { filePath: "/a.ts" }, output: existing },
    })
    expect(again).toBe(existing)
  })

  test("modelFacing builds stub from legacy full output", () => {
    const text = modelFacingCompactedToolOutput({
      tool: "bash",
      state: {
        input: { cmd: "ls" },
        output: "this should become a conclusion stub\nline2",
        title: "Bash",
      },
    })
    expect(text.includes(COMPACTED_TOOL_STUB_MARKER)).toBe(true)
    expect(text.includes("cmd: ls")).toBe(true)
    expect(text.includes("this should become a conclusion stub")).toBe(true)
    expect(text.includes("[Old tool result content cleared]")).toBe(false)
  })
})
