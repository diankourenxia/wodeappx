/**
 * Supor brand workspace: isolated local project root under ~/.wodeapp/projects/supor.
 * Sessions, files, and (with renderer asset scope) digital assets stay separate from
 * the default / self-evolve workspaces.
 *
 * Hidden by default for OSS / public demos. Opt in with WODEAPPX_ENABLE_SUPOR_WORKSPACE=1.
 * Also respects WODEAPPX_DISABLE_SUPOR_WORKSPACE=1 as a hard off switch.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const SUPOR_WORKSPACE_NAME = "苏泊尔经营台";
export const SUPOR_WORKSPACE_KEY = "wodeapp-supor";
export const SUPOR_WORKSPACE_MARKER = ".wodeapp-supor-workspace";
export const SUPOR_BRAND_AGENT_ID = "supor-brand-agent";
export const SUPOR_BRAND_ID = "supor";

export function normalizePathKey(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? path.resolve(trimmed).replace(/\\/g, "/").toLowerCase() : "";
}

export function resolveSuporWorkspacePath(env = process.env) {
  const explicit = String(env.WODEAPPX_SUPOR_WORKSPACE_ROOT || "").trim();
  if (explicit) return path.resolve(explicit);
  return path.join(os.homedir(), ".wodeapp", "projects", "supor");
}

export function ensureSuporWorkspaceDirectory(folderPath) {
  const root = path.resolve(folderPath);
  mkdirSync(root, { recursive: true });
  mkdirSync(path.join(root, ".opencode"), { recursive: true });
  mkdirSync(path.join(root, "assets"), { recursive: true });
  mkdirSync(path.join(root, "knowledge"), { recursive: true });
  const markerPath = path.join(root, SUPOR_WORKSPACE_MARKER);
  if (!existsSync(markerPath)) {
    writeFileSync(
      markerPath,
      `${JSON.stringify({ brandId: SUPOR_BRAND_ID, key: SUPOR_WORKSPACE_KEY, version: 1 }, null, 2)}\n`,
      "utf8",
    );
  }
  const readmePath = path.join(root, "README.md");
  if (!existsSync(readmePath)) {
    writeFileSync(
      readmePath,
      `# ${SUPOR_WORKSPACE_NAME}\n\n本目录为苏泊尔智能体独立工作区：会话、本地文件与数字资产与主工作区隔离。\n`,
      "utf8",
    );
  }
  return root;
}

export function isSuporWorkspacePath(folderPath, env = process.env) {
  const key = normalizePathKey(folderPath);
  if (!key) return false;
  if (key === normalizePathKey(resolveSuporWorkspacePath(env))) return true;
  try {
    return existsSync(path.join(path.resolve(folderPath), SUPOR_WORKSPACE_MARKER));
  } catch {
    return false;
  }
}

/**
 * @returns {{ key: string, name: string, path: string, authorizedRoots: string[] }[]}
 */
export function listSuporWorkspaceSpecs(options = {}) {
  const env = options.env || process.env;
  if (env.WODEAPPX_DISABLE_SUPOR_WORKSPACE === "1") return [];
  // Default: hidden. Brand / internal demos opt in explicitly.
  if (env.WODEAPPX_ENABLE_SUPOR_WORKSPACE !== "1") return [];
  const folderPath = resolveSuporWorkspacePath(env);
  return [{
    key: SUPOR_WORKSPACE_KEY,
    name: SUPOR_WORKSPACE_NAME,
    path: folderPath,
    authorizedRoots: [folderPath],
  }];
}

export function mergeSuporWorkspaces(existingWorkspaces, specs, helpers) {
  const {
    localWorkspaceId,
    normalizeWorkspaceEntry,
    normalizePathKey: pathKeyFn = normalizePathKey,
    forgottenPathKeys = [],
  } = helpers;

  let workspaces = Array.isArray(existingWorkspaces) ? [...existingWorkspaces] : [];
  let changed = false;
  const forgotten = new Set(
    (Array.isArray(forgottenPathKeys) ? forgottenPathKeys : [])
      .map((value) => pathKeyFn(value))
      .filter(Boolean),
  );
  const seen = new Set(
    workspaces
      .map((entry) => pathKeyFn(entry?.path))
      .filter(Boolean),
  );
  const added = [];

  for (const spec of specs) {
    const key = pathKeyFn(spec.path);
    // User removed this optional brand desk from the sidebar — do not re-seed it.
    // (Unlike wodeapp self-evolve, Supor is not a must-keep system project.)
    if (!key || forgotten.has(key)) continue;
    if (seen.has(key)) {
      const index = workspaces.findIndex((entry) => pathKeyFn(entry?.path) === key);
      if (index >= 0) {
        const current = workspaces[index];
        if (current.name !== spec.name || current.displayName !== spec.name) {
          workspaces[index] = normalizeWorkspaceEntry({
            ...current,
            name: spec.name,
            displayName: spec.name,
          });
          changed = true;
        }
      }
      continue;
    }
    const workspace = normalizeWorkspaceEntry({
      id: localWorkspaceId(spec.path),
      name: spec.name,
      displayName: spec.name,
      path: spec.path,
      preset: "starter",
      workspaceType: "local",
    });
    workspaces.push(workspace);
    seen.add(key);
    added.push({ workspace, authorizedRoots: spec.authorizedRoots || [spec.path] });
    changed = true;
  }

  return { workspaces, changed, added, removedIds: [] };
}

export async function ensureSuporBrandWorkspaces(params) {
  const {
    workspaces,
    env = process.env,
    forgottenWorkspacePaths = [],
    normalizeLocalWorkspacePath,
    normalizeWorkspaceEntry,
    localWorkspaceId,
    writeWorkspaceOpenworkConfig,
    defaultWorkspaceOpenworkConfig,
    log = console.info.bind(console),
  } = params;

  if (env.WODEAPPX_DISABLE_SUPOR_WORKSPACE === "1") {
    return { workspaces, changed: false, added: [], removedIds: [] };
  }

  const specs = listSuporWorkspaceSpecs({ env });
  if (specs.length === 0) {
    return { workspaces, changed: false, added: [], removedIds: [] };
  }

  const resolvedSpecs = [];
  for (const spec of specs) {
    const ensuredPath = ensureSuporWorkspaceDirectory(spec.path);
    const folderPath = await normalizeLocalWorkspacePath(ensuredPath);
    if (!folderPath) continue;
    resolvedSpecs.push({
      ...spec,
      path: folderPath,
      authorizedRoots: [folderPath],
    });
  }

  const merged = mergeSuporWorkspaces(workspaces, resolvedSpecs, {
    localWorkspaceId,
    normalizeWorkspaceEntry,
    forgottenPathKeys: forgottenWorkspacePaths,
  });

  for (const item of merged.added) {
    const roots = item.authorizedRoots?.length ? item.authorizedRoots : [item.workspace.path];
    const config = defaultWorkspaceOpenworkConfig(item.workspace.path, "starter");
    config.authorizedRoots = roots;
    await writeWorkspaceOpenworkConfig(item.workspace.path, config);
    log("[workspace] mounted supor brand workspace", {
      workspaceId: item.workspace.id,
      path: item.workspace.path,
    });
  }

  return merged;
}
