type ToolPermissionRule = {
  permission: string
  pattern: string
  action: string
}

const LEGACY_SNAPSHOT_MIN_RULES = 40
const LEGACY_SNAPSHOT_MIN_CORE_TOOLS = 4
const LEGACY_SNAPSHOT_MIN_WODEAPP_TOOLS = 10

const CORE_TOOL_IDS = new Set([
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
])

const WODEAPP_TOOL_PREFIXES = [
  "openwork_",
  "wodeapp_",
  "wodeappx_",
]

/**
 * Older WodeAppX renderers sent their complete per-turn capability map through
 * PromptInput.tools. OpenCode persisted that deprecated visibility map as the
 * session permission ruleset, so a browser-focused turn could permanently deny
 * read/write/bash and every tool later loaded by tool_search.
 *
 * Keep this detector deliberately narrow: a legacy snapshot is a large,
 * unique, allow/deny-only catalog of "*" rules spanning both OpenCode core
 * tools and many WodeAppX/OpenWork tools. Normal user-authored permission
 * rules, wildcard policy, ask rules, and small allow/deny lists do not match.
 */
export function isLegacyWodeAppToolVisibilitySnapshot(
  rules: readonly ToolPermissionRule[] | undefined,
): boolean {
  if (!rules || rules.length < LEGACY_SNAPSHOT_MIN_RULES) return false

  const permissions = new Set<string>()
  let allowCount = 0
  let denyCount = 0
  let coreToolCount = 0
  let wodeAppToolCount = 0

  for (const rule of rules) {
    if (
      rule.pattern !== "*"
      || rule.permission === "*"
      || (rule.action !== "allow" && rule.action !== "deny")
      || permissions.has(rule.permission)
    ) {
      return false
    }

    permissions.add(rule.permission)
    if (rule.action === "allow") allowCount++
    if (rule.action === "deny") denyCount++
    if (CORE_TOOL_IDS.has(rule.permission)) coreToolCount++
    if (WODEAPP_TOOL_PREFIXES.some((prefix) => rule.permission.startsWith(prefix))) {
      wodeAppToolCount++
    }
  }

  return (
    allowCount > 0
    && denyCount > 0
    && coreToolCount >= LEGACY_SNAPSHOT_MIN_CORE_TOOLS
    && wodeAppToolCount >= LEGACY_SNAPSHOT_MIN_WODEAPP_TOOLS
  )
}
