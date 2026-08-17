import type { OpenworkWorkspaceFileCatalogEntry } from "@/app/lib/openwork-server";

export type FileTreeNode = {
  path: string;
  name: string;
  kind: "file" | "dir";
  children?: FileTreeNode[];
};

/**
 * Directory names that are hidden from the file tree by default. These are
 * almost never useful when browsing a workspace during development and can
 * make the recursive catalog snapshot very large (e.g. node_modules).
 */
export const DEFAULT_IGNORED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".pnpm-store",
  ".npm-cache",
  ".npm-tmp-cache",
  ".turbo",
  ".next",
  ".venv",
  "__pycache__",
  ".cache",
  "dist",
  "dist-electron",
  "build",
]);

function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

function parentPathOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function isUnderIgnoredDir(path: string, ignoredDirNames: Set<string>): boolean {
  const segments = path.split("/");
  // Only directory segments (not the final entry itself) should be checked,
  // so an ignored *file* named e.g. "build.txt" is still shown.
  for (let i = 0; i < segments.length - 1; i += 1) {
    if (ignoredDirNames.has(segments[i])) return true;
  }
  return false;
}

/**
 * Converts the flat, path-sorted catalog snapshot returned by the workspace
 * file-session API into a nested tree the sidebar can render. Assumes the
 * input is sorted so parent directories appear before their children (the
 * catalog snapshot endpoint already returns entries in path order).
 */
export function buildFileTree(
  entries: OpenworkWorkspaceFileCatalogEntry[],
  options?: { ignoredDirNames?: Set<string> },
): FileTreeNode[] {
  const ignoredDirNames = options?.ignoredDirNames ?? DEFAULT_IGNORED_DIR_NAMES;
  const nodesByPath = new Map<string, FileTreeNode>();
  const roots: FileTreeNode[] = [];

  for (const entry of entries) {
    if (isUnderIgnoredDir(entry.path, ignoredDirNames)) continue;

    const node: FileTreeNode = {
      path: entry.path,
      name: basename(entry.path),
      kind: entry.kind,
      children: entry.kind === "dir" ? [] : undefined,
    };
    nodesByPath.set(entry.path, node);

    const parentPath = parentPathOf(entry.path);
    const parent = parentPath ? nodesByPath.get(parentPath) : undefined;
    if (parent?.children) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortSiblings = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children) sortSiblings(node.children);
    }
  };
  sortSiblings(roots);

  return roots;
}
