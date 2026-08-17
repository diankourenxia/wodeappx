import { describe, expect, test } from "bun:test"

import { isLegacyWodeAppToolVisibilitySnapshot } from "./session-tool-permissions"

type Rule = {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

function legacySnapshot(): Rule[] {
  const core = [
    "apply_patch",
    "bash",
    "edit",
    "glob",
    "grep",
    "question",
    "read",
    "skill",
    "task",
    "todowrite",
    "webfetch",
    "write",
  ]
  const branded = Array.from({ length: 28 }, (_, index) => (
    index % 2 === 0
      ? `openwork_fixture_${index}`
      : `wodeappx_fixture_${index}`
  ))
  const other = Array.from({ length: 20 }, (_, index) => `fixture_tool_${index}`)

  return [...core, ...branded, ...other].map((permission, index) => ({
    permission,
    pattern: "*",
    action: index < 8 ? "allow" : "deny",
  }))
}

describe("legacy WodeAppX tool permission migration", () => {
  test("detects the large per-turn capability snapshot persisted by older renderers", () => {
    expect(isLegacyWodeAppToolVisibilitySnapshot(legacySnapshot())).toBe(true)
  })

  test("does not clear normal user-authored permission rules", () => {
    expect(isLegacyWodeAppToolVisibilitySnapshot([
      { permission: "bash", pattern: "*", action: "ask" },
      { permission: "read", pattern: "*", action: "allow" },
      { permission: "write", pattern: "*", action: "deny" },
    ])).toBe(false)
  })

  test("does not clear wildcard policy even when the ruleset is large", () => {
    const rules = legacySnapshot()
    rules[0] = { permission: "*", pattern: "*", action: "deny" }
    expect(isLegacyWodeAppToolVisibilitySnapshot(rules)).toBe(false)
  })

  test("does not clear large unrelated tool policies", () => {
    const rules = legacySnapshot().map((rule, index) => ({
      ...rule,
      permission: `unrelated_tool_${index}`,
    }))
    expect(isLegacyWodeAppToolVisibilitySnapshot(rules)).toBe(false)
  })

  test("does not clear patterned or duplicate permission rules", () => {
    const patterned = legacySnapshot()
    patterned[0] = { ...patterned[0], pattern: "/tmp/**" }
    expect(isLegacyWodeAppToolVisibilitySnapshot(patterned)).toBe(false)

    const duplicated = legacySnapshot()
    duplicated[1] = { ...duplicated[1], permission: duplicated[0].permission }
    expect(isLegacyWodeAppToolVisibilitySnapshot(duplicated)).toBe(false)
  })
})
