/** @jsxImportSource react */
import type { UIMessage } from "ai";
import { ExternalLink, FolderOpen } from "lucide-react";
import { useMemo } from "react";

import { openDesktopPath } from "@/app/lib/desktop";
import { isElectronRuntime } from "@/app/utils";
import {
  isOpenableDirectoryTarget,
  pickChatInlineAccessTargets,
  type OpenTarget,
} from "@/react-app/domains/session/artifacts/open-target";

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

export function ArtifactAccessActions(props: { message: UIMessage }) {
  const targets = useMemo(() => {
    if (props.message.role !== "assistant") return [];
    return pickChatInlineAccessTargets(props.message);
  }, [props.message]);

  if (!targets.length || !isElectronRuntime()) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {targets.map((target) => {
        const isDir = isOpenableDirectoryTarget(target);
        const label = isDir ? `打开文件夹：${target.name}` : `打开文件：${target.name}`;
        const Icon = isDir ? FolderOpen : ExternalLink;

        return (
          <button
            key={target.id}
            type="button"
            onClick={() => void openArtifactTarget(target)}
            className="inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-muted"
          >
            <Icon className="size-3.5 shrink-0" />
            <span className="truncate">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
