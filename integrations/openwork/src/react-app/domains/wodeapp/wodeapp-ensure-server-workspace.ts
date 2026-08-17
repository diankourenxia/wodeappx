/**
 * Electron may mount folder workspaces into openwork-workspaces.json before the
 * OpenWork server has ever seen them (e.g. auto-mounted Supor brand project).
 * Activating / creating sessions then returns workspace_not_found until the
 * path is registered via POST /workspaces/local.
 */
import { OpenworkServerError, type OpenworkServerClient } from "@/app/lib/openwork-server";

export type EnsureServerWorkspaceInput = {
  id: string;
  path?: string | null;
  name?: string | null;
  displayName?: string | null;
  preset?: string | null;
  workspaceType?: string | null;
};

function isWorkspaceNotFound(error: unknown): boolean {
  return error instanceof OpenworkServerError && error.code === "workspace_not_found";
}

function workspaceDisplayName(workspace: EnsureServerWorkspaceInput, folderPath: string): string {
  const named = String(workspace.displayName || workspace.name || "").trim();
  if (named) return named;
  const parts = folderPath.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] || "Workspace";
}

export async function ensureWorkspaceRegisteredOnServer(
  client: Pick<OpenworkServerClient, "activateWorkspace" | "createLocalWorkspace">,
  workspace: EnsureServerWorkspaceInput | null | undefined,
): Promise<boolean> {
  if (!workspace?.id) return false;
  try {
    await client.activateWorkspace(workspace.id, { persist: true });
    return true;
  } catch (error) {
    if (!isWorkspaceNotFound(error)) return false;
    if (workspace.workspaceType === "remote") return false;
    const folderPath = String(workspace.path || "").trim();
    if (!folderPath) return false;
    await client.createLocalWorkspace({
      folderPath,
      name: workspaceDisplayName(workspace, folderPath),
      preset: String(workspace.preset || "starter").trim() || "starter",
    });
    await client.activateWorkspace(workspace.id, { persist: true });
    return true;
  }
}
