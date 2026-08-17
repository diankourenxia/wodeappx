/**
 * Self-evolve awareness for sessions in the `wodeapp（自进化）` workspace.
 * Product self-evolve = authorized edits to this app's source (guard + skill),
 * not autonomous model-weight mutation.
 */

export const SELF_EVOLVE_WORKSPACE_NAME_MARKERS = [
  "自进化",
  "self-evolve",
  "self evolve",
] as const;

/** Short pack appended to capability system context when the active workspace is self-evolve. */
export const SELF_EVOLVE_AWARENESS_PACK =
  "Identity override (this workspace): You are WodeAppX. In user-visible answers use WodeAppX (codename wodeappx). Self-evolution (本工作区): You CAN change this desktop app's own source (skins, copy, features, scripts) after the user confirms. Prefer slash `/自进化` (English `/evolve`) or skill `wodeappx-self-evolution`. Required flow: restate the plan → wait for explicit consent → `node wodeappx/scripts/self-evolve-guard.mjs snapshot --label \"…\"` → minimal edit → `verify` → on failure `rollback <snapshotId>` → after user accepts, `version commit`. Never claim you cannot self-evolve in this workspace. Do not confuse product self-evolve with unsupervised model-weight mutation or silent privilege escalation; consequential external actions still need confirmation.";

function normalizeKey(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\\/g, "/").toLowerCase();
}

export function isSelfEvolveWorkspaceName(name: string | null | undefined): boolean {
  const key = normalizeKey(name);
  if (!key) return false;
  return SELF_EVOLVE_WORKSPACE_NAME_MARKERS.some((marker) => key.includes(marker));
}

/**
 * Path heuristics when the workspace name is missing (session.directory only).
 * Avoid false positives on arbitrary folders named "wodeapp" under unrelated trees
 * by also accepting packaged self-evolve-source mounts.
 */
export function isSelfEvolveWorkspaceDirectory(directory: string | null | undefined): boolean {
  const key = normalizeKey(directory);
  if (!key) return false;
  if (key.includes("self-evolve-source")) return true;
  if (/(^|\/)wodeapp\/?$/.test(key)) return true;
  if (key.endsWith("/wodeappx") || key.includes("/wodeapp/wodeappx")) return true;
  return false;
}

export function isSelfEvolveWorkspace(input: {
  workspaceName?: string | null;
  workspaceDirectory?: string | null;
}): boolean {
  return isSelfEvolveWorkspaceName(input.workspaceName)
    || isSelfEvolveWorkspaceDirectory(input.workspaceDirectory);
}

export function asksAboutSelfEvolve(text: string | null | undefined): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  return /自进化|self[-\s]?evolv|\/evolve|\/自进化|改你自己|改本应用|改桌面端源码/i.test(raw);
}

export function shouldInjectSelfEvolveAwareness(input: {
  workspaceName?: string | null;
  workspaceDirectory?: string | null;
  text?: string | null;
}): boolean {
  if (isSelfEvolveWorkspace(input)) return true;
  // Outside the project, still answer honestly when asked — point to the project/slash.
  return asksAboutSelfEvolve(input.text);
}

export const SELF_EVOLVE_OFF_WORKSPACE_HINT =
  "Self-evolution: Product self-evolve means editing this desktop app under confirmation (skill `wodeappx-self-evolution`, slash `/自进化` / `/evolve`, guard snapshot→verify→rollback). Switch to sidebar project `wodeapp（自进化）` or run `/自进化` there. Do not refuse as if the product cannot self-evolve.";

export function resolveSelfEvolveAwarenessPack(input: {
  workspaceName?: string | null;
  workspaceDirectory?: string | null;
  text?: string | null;
}): string | undefined {
  if (isSelfEvolveWorkspace(input)) return SELF_EVOLVE_AWARENESS_PACK;
  if (asksAboutSelfEvolve(input.text)) return SELF_EVOLVE_OFF_WORKSPACE_HINT;
  return undefined;
}
