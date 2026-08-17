"use client"

import { SquareTerminalIcon } from "lucide-react"
import {
  CollapsibleTool,
  CollapsibleToolContent,
  CollapsibleToolStep,
  CollapsibleToolTrigger,
} from "@/components/tools/collapsible-tool"
import type { BashToolPart } from "@/lib/build-in-tools"
import { isToolPartInFlight } from "@/lib/tool-activity"
import { getWodeAppToolActivityLabel } from "@/react-app/domains/wodeapp/wodeapp-tool-activity"

interface BashToolProps {
  part: BashToolPart
}

function bashSummary(part: BashToolPart): string {
  // Prefer shared tense-aware labels so expanded rows are not all "已运行命令".
  const shared = getWodeAppToolActivityLabel(part).trim()
  if (shared && shared !== "已运行命令" && shared !== "正在运行命令") return shared
  const description = part.input?.description?.trim()
  if (description) return description
  if (isToolPartInFlight(part)) return "正在运行命令"
  if (part.state === "output-error") return "命令未完成"
  return "已运行命令"
}

function truncateOutput(output: unknown, maxChars = 2_000): string {
  const text = typeof output === "string" ? output : output == null ? "" : String(output)
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}\n\n…已截断 ${text.length - maxChars} 个字符`
}

/**
 * Codex-like: one short status line by default. Full command/output only after expand.
 */
export function BashTool({ part }: BashToolProps) {
  const summary = bashSummary(part)
  const command = part.input?.command?.trim() ?? ""
  const inFlight = isToolPartInFlight(part)

  return (
    <CollapsibleTool>
      <CollapsibleToolStep>
        <CollapsibleToolTrigger leftIcon={<SquareTerminalIcon className="size-4" />}>
          <span className="min-w-0 truncate">{summary}</span>
        </CollapsibleToolTrigger>
        <CollapsibleToolContent className="bg-muted mt-1 rounded-lg p-2">
          <div className="flex flex-col gap-2 text-xs">
            {command ? <pre className="whitespace-pre-wrap wrap-break-word">$ {command}</pre> : null}
            {"output" in part && part.output != null ? (
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap wrap-break-word opacity-80">
                {truncateOutput(part.output)}
              </pre>
            ) : null}
            {part.state === "output-error" && "errorText" in part && part.errorText ? (
              <pre className="whitespace-pre-wrap wrap-break-word text-amber-800">{part.errorText}</pre>
            ) : null}
            {inFlight && !command ? (
              <span className="text-muted-foreground">等待命令…</span>
            ) : null}
          </div>
        </CollapsibleToolContent>
      </CollapsibleToolStep>
    </CollapsibleTool>
  )
}
