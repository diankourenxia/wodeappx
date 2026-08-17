/** Codex-style external-directory access mode for WodeAppX desktop. */

export type ExternalDirectoryAccessMode = "ask" | "full";

/** Keep previous product default: confirm outside-folder access. */
export const DEFAULT_EXTERNAL_DIRECTORY_ACCESS: ExternalDirectoryAccessMode = "ask";

/** OpenWork maps this folder to OpenCode `permission.external_directory["/*"] = "allow"`. */
export const FULL_EXTERNAL_ACCESS_FOLDER = "/";

export function normalizeExternalDirectoryAccessMode(value: unknown): ExternalDirectoryAccessMode {
  return value === "full" ? "full" : "ask";
}

export function isFullExternalAccessFolder(folder: string): boolean {
  const normalized = folder.trim().replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  return normalized === "/" || normalized === "/*";
}

export function hasFullExternalAccess(folders: readonly string[]): boolean {
  return folders.some((folder) => isFullExternalAccessFolder(folder));
}

export function foldersWithFullExternalAccess(folders: readonly string[]): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const folder of folders) {
    const trimmed = folder.trim();
    if (!trimmed || isFullExternalAccessFolder(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    next.push(trimmed);
  }
  next.unshift(FULL_EXTERNAL_ACCESS_FOLDER);
  return next;
}

export function foldersWithoutFullExternalAccess(folders: readonly string[]): string[] {
  return folders.filter((folder) => !isFullExternalAccessFolder(folder));
}

export type AuthorizedFoldersClientLike = {
  listAuthorizedFolders: (workspaceId: string) => Promise<{ folders: string[] }>;
  setAuthorizedFolders: (
    workspaceId: string,
    folders: string[],
  ) => Promise<{ folders: string[] }>;
};

/** Ensure workspace OpenCode config matches the preferred external-directory mode. */
export async function syncExternalDirectoryAccessMode(options: {
  mode: ExternalDirectoryAccessMode;
  openworkClient: AuthorizedFoldersClientLike;
  openworkWorkspaceId: string;
}): Promise<{ folders: string[]; changed: boolean }> {
  const current = await options.openworkClient.listAuthorizedFolders(options.openworkWorkspaceId);
  const folders = current.folders ?? [];
  if (options.mode === "full") {
    if (hasFullExternalAccess(folders)) {
      return { folders, changed: false };
    }
    const next = foldersWithFullExternalAccess(folders);
    const response = await options.openworkClient.setAuthorizedFolders(
      options.openworkWorkspaceId,
      next,
    );
    return { folders: response.folders, changed: true };
  }

  if (!hasFullExternalAccess(folders)) {
    return { folders, changed: false };
  }
  const next = foldersWithoutFullExternalAccess(folders);
  const response = await options.openworkClient.setAuthorizedFolders(
    options.openworkWorkspaceId,
    next,
  );
  return { folders: response.folders, changed: true };
}
