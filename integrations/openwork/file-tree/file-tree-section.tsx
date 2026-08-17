/** @jsxImportSource react */
import * as React from "react";
import { ChevronRight, File, Folder, Loader2, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { SidebarMenuSubButton, SidebarMenuSubItem } from "@/components/ui/sidebar";
import { isElectronRuntime } from "@/app/utils";
import { revealDesktopItemInDir } from "@/app/lib/desktop";
import type { OpenworkServerClient } from "@/app/lib/openwork-server";
import { usePanelTabStore } from "../panel/panel-tab-store";
import { useExpandedFileTreePaths, useFileTreeStore, useWorkspaceFileTree } from "./file-tree-store";
import type { FileTreeNode } from "./build-file-tree";

type FileTreeSectionProps = {
  workspaceId: string;
  workspaceRoot: string;
  client: OpenworkServerClient | null;
  /** The session currently open for this workspace, if any. Files open into
   * that session's artifact panel; without one we fall back to revealing
   * the file in Finder/Explorer. */
  activeSessionId: string | null;
};

function absoluteWorkspacePath(root: string, relativePath: string) {
  const cleanRoot = root.trim().replace(/[/\\]+$/, "");
  return cleanRoot ? `${cleanRoot}/${relativePath}` : relativePath;
}

export function FileTreeSection({ workspaceId, workspaceRoot, client, activeSessionId }: FileTreeSectionProps) {
  const [expanded, setExpanded] = React.useState(false);
  const treeState = useWorkspaceFileTree(workspaceId);
  const expandedPaths = useExpandedFileTreePaths(workspaceId);

  const handleToggleSection = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && client && treeState.status === "idle") {
      void useFileTreeStore.getState().load(workspaceId, client);
    }
  };

  const handleRefresh = (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!client) return;
    void useFileTreeStore.getState().load(workspaceId, client);
  };

  const handleOpenFile = React.useCallback(async (path: string, name: string) => {
    if (client && activeSessionId) {
      try {
        const resolved = await client.resolveArtifacts(workspaceId, [
          { kind: "file", value: path, name, confidence: 100, reason: "file-tree" },
        ]);
        const target = resolved.items[0];
        if (target) {
          usePanelTabStore.getState().addExplicitArtifactTarget(activeSessionId, {
            id: target.id,
            kind: target.kind,
            value: target.value,
            name: target.name,
            preview: target.preview,
            confidence: target.confidence,
            reason: target.reason,
            exists: target.exists,
            size: target.size,
            updatedAt: target.updatedAt,
          });
          usePanelTabStore.getState().openTab(activeSessionId, {
            id: target.id,
            type: "artifact",
            label: target.name,
            preview: target.preview,
          });
          return;
        }
      } catch {
        // Fall through to the reveal-in-Finder fallback below.
      }
    }

    if (isElectronRuntime()) {
      void revealDesktopItemInDir(absoluteWorkspacePath(workspaceRoot, path));
    }
  }, [client, workspaceId, workspaceRoot, activeSessionId]);

  return (
    <SidebarMenuSubItem>
      <SidebarMenuSubButton
        className="group/file-tree-header text-xs font-medium text-muted-foreground"
        onClick={handleToggleSection}
        aria-expanded={expanded}
      >
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform duration-200",
            expanded && "rotate-90",
          )}
        />
        <span className="min-w-0 flex-1 truncate">文件</span>
        {treeState.status === "loading" ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <span
            role="button"
            tabIndex={0}
            className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground group-hover/file-tree-header:opacity-100"
            onClick={handleRefresh}
            aria-label="刷新文件列表"
          >
            <RefreshCw className="size-3" />
          </span>
        )}
      </SidebarMenuSubButton>
      {expanded ? (
        <div className="ml-1 mt-0.5 flex flex-col gap-px">
          {treeState.status === "error" ? (
            <div className="px-2 py-1 text-[11px] text-destructive">{treeState.error}</div>
          ) : treeState.status === "ready" && treeState.nodes.length === 0 ? (
            <div className="px-2 py-1 text-[11px] text-muted-foreground">空文件夹</div>
          ) : (
            <FileTreeNodeList
              nodes={treeState.nodes}
              depth={0}
              workspaceId={workspaceId}
              expandedPaths={expandedPaths}
              onOpenFile={handleOpenFile}
            />
          )}
          {treeState.truncated ? (
            <div className="px-2 py-1 text-[10px] text-muted-foreground/70">文件较多，仅显示部分内容</div>
          ) : null}
        </div>
      ) : null}
    </SidebarMenuSubItem>
  );
}

type FileTreeNodeListProps = {
  nodes: FileTreeNode[];
  depth: number;
  workspaceId: string;
  expandedPaths: Set<string>;
  onOpenFile: (path: string, name: string) => void;
};

function FileTreeNodeList({ nodes, depth, workspaceId, expandedPaths, onOpenFile }: FileTreeNodeListProps) {
  return (
    <>
      {nodes.map((node) => (
        <FileTreeRow
          key={node.path}
          node={node}
          depth={depth}
          workspaceId={workspaceId}
          expandedPaths={expandedPaths}
          onOpenFile={onOpenFile}
        />
      ))}
    </>
  );
}

type FileTreeRowProps = {
  node: FileTreeNode;
  depth: number;
  workspaceId: string;
  expandedPaths: Set<string>;
  onOpenFile: (path: string, name: string) => void;
};

function FileTreeRow({ node, depth, workspaceId, expandedPaths, onOpenFile }: FileTreeRowProps) {
  const isDir = node.kind === "dir";
  const isOpen = isDir && expandedPaths.has(node.path);

  return (
    <>
      <button
        type="button"
        className="flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-[12px] text-sidebar-foreground hover:bg-sidebar-accent/60"
        style={{ paddingLeft: `${8 + depth * 14}px` }}
        onClick={() => {
          if (isDir) {
            useFileTreeStore.getState().toggleExpanded(workspaceId, node.path);
          } else {
            void onOpenFile(node.path, node.name);
          }
        }}
        title={node.path}
      >
        {isDir ? (
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform duration-200",
              isOpen && "rotate-90",
            )}
          />
        ) : (
          <span className="size-3 shrink-0" />
        )}
        {isDir ? (
          <Folder className="size-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <File className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </button>
      {isDir && isOpen && node.children ? (
        <FileTreeNodeList
          nodes={node.children}
          depth={depth + 1}
          workspaceId={workspaceId}
          expandedPaths={expandedPaths}
          onOpenFile={onOpenFile}
        />
      ) : null}
    </>
  );
}
