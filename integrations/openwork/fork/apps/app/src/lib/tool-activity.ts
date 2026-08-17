import type { DynamicToolUIPart, ToolUIPart, UIMessage } from "ai"
import {
  isApplyPatchToolPart,
  isBashToolPart,
  isEditToolPart,
  isEnvVarRequestToolPart,
  isGlobToolPart,
  isGrepToolPart,
  isLspToolPart,
  isQuestionToolPart,
  isReadToolPart,
  isSkillToolPart,
  isTaskToolPart,
  isTodoWriteToolPart,
  isWebFetchToolPart,
  isWebSearchToolPart,
  isWriteToolPart,
} from "@/lib/build-in-tools"
import { parseFilename, truncateText } from "@/components/tools/path"
import { getWodeAppToolActivityLabel } from "@/react-app/domains/wodeapp/wodeapp-tool-activity"

type AnyToolPart = ToolUIPart | DynamicToolUIPart

export function isToolPartInFlight(part: AnyToolPart): boolean {
  return part.state === "input-streaming" || part.state === "input-available"
}

export function collectToolParts(messages: UIMessage[]): DynamicToolUIPart[] {
  return messages.flatMap((message) =>
    message.parts.filter(
      (part): part is DynamicToolUIPart => part.type === "dynamic-tool"
    )
  )
}

function hostnameOf(url: string | undefined): string | undefined {
  if (!url) {
    return undefined
  }
  try {
    return new URL(url).hostname
  } catch {
    return undefined
  }
}

function withBuiltinTense(label: string, part: AnyToolPart): string {
  if (part.state === "output-error") {
    if (/(未完成|需调整|可重试)$/.test(label)) return label
    if (label.endsWith("失败")) return `${label.slice(0, -2)}未完成`
    return `${label}未完成`
  }
  if (isToolPartInFlight(part)) {
    return label
  }
  if (/^(Read|Wrote|Updated|Applied|Searched|Fetched|Loaded|Asked|Requested|Ran|Edited|Inspected)\b/i.test(label)) {
    return label
  }
  if (label.startsWith("Reading ")) return `Read ${label.slice("Reading ".length)}`
  if (label.startsWith("Editing ")) return `Edited ${label.slice("Editing ".length)}`
  if (label.startsWith("Writing ")) return `Wrote ${label.slice("Writing ".length)}`
  if (label.startsWith("Searching ")) return `Searched ${label.slice("Searching ".length)}`
  if (label.startsWith("Running ")) return `Ran ${label.slice("Running ".length)}`
  if (label.startsWith("Loading ")) return `Loaded ${label.slice("Loading ".length)}`
  if (label.startsWith("Updating ")) return `Updated ${label.slice("Updating ".length)}`
  if (label.startsWith("Applying ")) return `Applied ${label.slice("Applying ".length)}`
  if (label.startsWith("Fetching ")) return `Fetched ${label.slice("Fetching ".length)}`
  if (label.startsWith("Inspecting ")) return `Inspected ${label.slice("Inspecting ".length)}`
  if (label.startsWith("Asking ")) return `Asked ${label.slice("Asking ".length)}`
  if (label.startsWith("Requesting ")) return `Requested ${label.slice("Requesting ".length)}`
  return label
}

/**
 * Human-readable "what is this tool doing" label. Safe against partial
 * streamed input (fields may be missing despite the type contract).
 */
export function getToolActivityLabel(part: AnyToolPart): string {
  let label: string
  if (isBashToolPart(part)) {
    const description = part.input?.description?.trim()
    label = description ? truncateText(description, 64) : "Running a command"
  } else if (isReadToolPart(part)) {
    label = `Reading ${parseFilename(part.input?.filePath)}`
  } else if (isEditToolPart(part)) {
    label = `Editing ${parseFilename(part.input?.filePath)}`
  } else if (isWriteToolPart(part)) {
    label = `Writing ${parseFilename(part.input?.filePath)}`
  } else if (isApplyPatchToolPart(part)) {
    label = "Applying changes"
  } else if (isGrepToolPart(part) || isGlobToolPart(part)) {
    const pattern = part.input?.pattern?.trim()
    label = pattern
      ? `Searching for ${truncateText(pattern, 44)}`
      : "Searching files"
  } else if (isLspToolPart(part)) {
    label = `Inspecting ${parseFilename(part.input?.filePath)}`
  } else if (isSkillToolPart(part)) {
    const name = part.input?.name?.trim()
    label = name ? `Loading ${name} skill` : "Loading a skill"
  } else if (isTodoWriteToolPart(part)) {
    label = "Updating the plan"
  } else if (isWebFetchToolPart(part)) {
    const host = hostnameOf(part.input?.url)
    label = host ? `Reading ${host}` : "Fetching a page"
  } else if (isWebSearchToolPart(part)) {
    const query = part.input?.query?.trim()
    label = query
      ? `Searching the web for ${truncateText(query, 44)}`
      : "Searching the web"
  } else if (isQuestionToolPart(part)) {
    label = "Asking a question"
  } else if (isEnvVarRequestToolPart(part)) {
    const key = part.input?.key?.trim()
    label = key ? `Requesting ${key}` : "Requesting an environment variable"
  } else if (isTaskToolPart(part)) {
    const description = part.input?.description?.trim()
    label = description
      ? `Agent: ${truncateText(description, 56)}`
      : "Running an agent"
  } else {
    label = getWodeAppToolActivityLabel(part)
  }
  return withBuiltinTense(label, part)
}

/** Label for the most recent tool still in flight, if any. */
export function getActiveToolLabel(parts: DynamicToolUIPart[]): string | null {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index]
    if (part && isToolPartInFlight(part)) {
      return getToolActivityLabel(part)
    }
  }
  return null
}
