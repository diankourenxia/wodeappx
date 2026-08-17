/**
 * Progressive disclosure: intent → sticky-preload that capability pack's
 * deferred tools (not OpenCode Direct). Keep packs small; heavy Shopify /
 * browser / Computer Use stay tool_search-only unless their pack matches.
 *
 * Bare names resolve against the live catalog (including MCP
 * `wodeapp-platform_*` ids) inside dynamic-tool-discovery.
 */
export const CAPABILITY_PRELOAD_PACKS = {
  site: [
    "create_project",
    "list_projects",
    "get_project",
    "list_pages",
    "get_page",
    "create_page",
    "update_page",
    "wodeapp_page_import_from_file",
    "ai_generate_page",
    "ai_modify_section",
    "publish_project",
    "delete_page",
  ],
  "agent-app": [
    "list_skill_manifests",
    "materialize_skill_app",
    "list_templates",
    "create_project",
    "get_project",
    "get_page",
    "list_pages",
    "create_page",
    "update_page",
    "wodeapp_page_import_from_file",
    "ai_generate_page",
    "publish_project",
  ],
} as const

export type CapabilityPreloadPackId = keyof typeof CAPABILITY_PRELOAD_PACKS

const SITE_HINT =
  /发布|站点|网站|建站|落地页|landing|publish|website|site\b|html\s*文件|import.?html|page_import|自驾|线路图/i
const AGENT_APP_HINT =
  /智能体应用|agent\s*app|materialize_skill|物化|工作台应用|create_project/i

/** Detect which deferred packs to sticky-preload for this user turn. */
export function detectCapabilityPreloadPacks(text: string): CapabilityPreloadPackId[] {
  const raw = text.trim()
  if (!raw) return []
  const packs: CapabilityPreloadPackId[] = []
  if (SITE_HINT.test(raw)) packs.push("site")
  if (AGENT_APP_HINT.test(raw)) packs.push("agent-app")
  return packs
}

export function bareNamesForPreloadPacks(packs: readonly CapabilityPreloadPackId[]): string[] {
  const out = new Set<string>()
  for (const pack of packs) {
    for (const name of CAPABILITY_PRELOAD_PACKS[pack]) out.add(name)
  }
  return [...out]
}

/** Map bare tool names to live catalog ids (exact or MCP `server_bare`). */
export function resolvePreloadCatalogIDs(
  bareNames: readonly string[],
  catalogToolIDs: readonly string[],
): string[] {
  const bareSet = new Set(bareNames.map((name) => name.trim()).filter(Boolean))
  if (!bareSet.size) return []
  const out: string[] = []
  for (const toolID of catalogToolIDs) {
    if (bareSet.has(toolID)) {
      out.push(toolID)
      continue
    }
    const namespaced = toolID.match(/^([a-z0-9]+(?:-[a-z0-9]+)+)_(.+)$/i)
    if (namespaced?.[2] && bareSet.has(namespaced[2])) out.push(toolID)
  }
  return out
}

type UserMessageLike = {
  info?: { id?: string; role?: string }
  parts?: readonly { type?: string; text?: string; synthetic?: boolean }[]
}

export type LatestUserTask = {
  messageID: string
  text: string
}

/**
 * Return the latest real user task for capability preload and write idempotency.
 *
 * OpenCode persists recovery/compaction prompts as user messages whose parts
 * are marked `synthetic:true`. Those turns continue the current task; they
 * must not replace its intent, task epoch, or deferred tool surface.
 */
export function extractLatestUserTask(messages: readonly UserMessageLike[]): LatestUserTask {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.info?.role !== "user") continue
    const chunks = (message.parts ?? [])
      .filter(
        (part) => part?.type === "text"
          && part.synthetic !== true
          && typeof part.text === "string",
      )
      .map((part) => part.text!.trim())
      .filter(Boolean)
    if (chunks.length) {
      return {
        messageID: typeof message.info.id === "string" ? message.info.id.trim() : "",
        text: chunks.join("\n"),
      }
    }
  }
  return { messageID: "", text: "" }
}

export function extractLatestUserText(messages: readonly UserMessageLike[]): string {
  return extractLatestUserTask(messages).text
}
