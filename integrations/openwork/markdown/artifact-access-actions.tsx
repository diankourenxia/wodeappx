/** @jsxImportSource react */
import type { UIMessage } from "ai";
import { ChevronDown, ChevronRight, ExternalLink, FolderOpen } from "lucide-react";
import { useMemo, useState } from "react";

import { openDesktopPath } from "@/app/lib/desktop";
import { isElectronRuntime } from "@/app/utils";
import {
  isOpenableDirectoryTarget,
  pickChatInlineAccessTargets,
  type OpenTarget,
} from "@/react-app/domains/session/artifacts/open-target";

/** Above this count, render a collapsed list instead of a wrapping chip row. */
const COLLAPSE_AFTER = 3;

async function openArtifactTarget(target: OpenTarget) {
  if (!isElectronRuntime()) return;

  try {
    await openDesktopPath(target.value);
  } catch {
    if (target.kind !== "file") return;
    const parent = target.value.replace(/[/\\][^/\\]+$/, "");
    if (parent && parent !== target.value) {
      await openDesktopPath(parent).catch(() => undefined);
    }
  }
}

function AccessTargetButton(props: {
  target: OpenTarget;
  layout: "chip" | "row";
}) {
  const isDir = isOpenableDirectoryTarget(props.target);
  const label = isDir
    ? `打开文件夹：${props.target.name}`
    : `打开文件：${props.target.name}`;
  const Icon = isDir ? FolderOpen : ExternalLink;

  return (
    <button
      type="button"
      title={props.target.value}
      onClick={() => void openArtifactTarget(props.target)}
      className={
        props.layout === "chip"
          ? "inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
          : "flex w-full min-w-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted"
      }
    >
      <Icon className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

export function ArtifactAccessActions(props: { message: UIMessage }) {
  const targets = useMemo(() => {
    if (props.message.role !== "assistant") return [];
    return pickChatInlineAccessTargets(props.message);
  }, [props.message]);
  const [expanded, setExpanded] = useState(false);

  if (!targets.length || !isElectronRuntime()) return null;

  const directories = targets.filter((target) => isOpenableDirectoryTarget(target));
  const files = targets.filter((target) => !isOpenableDirectoryTarget(target));
  const shouldCollapse = targets.length > COLLAPSE_AFTER;

  if (!shouldCollapse) {
    return (
      <div className="flex max-w-full flex-wrap gap-1.5">
        {targets.map((target) => (
          <AccessTargetButton key={target.id} target={target} layout="chip" />
        ))}
      </div>
    );
  }

  const summaryParts: string[] = [];
  if (directories.length > 0) summaryParts.push(`${directories.length} 个文件夹`);
  if (files.length > 0) summaryParts.push(`${files.length} 个文件`);
  const summary = summaryParts.join(" · ") || `${targets.length} 项`;

  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-1.5">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
        className="inline-flex w-fit max-w-full min-w-0 items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 truncate">本地路径 · {summary}</span>
      </button>
      {expanded ? (
        <div className="flex max-h-48 w-full min-w-0 flex-col gap-1 overflow-y-auto overscroll-contain pr-0.5">
          {targets.map((target) => (
            <AccessTargetButton key={target.id} target={target} layout="row" />
          ))}
        </div>
      ) : null}
    </div>
  );
}
