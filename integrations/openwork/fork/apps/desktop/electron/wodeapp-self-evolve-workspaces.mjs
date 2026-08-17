/**
 * Self-evolution workspace: auto-mount one local source tree covering
 * wodeappx + runtime (runtime-server / runtime-app) so in-app agents can edit
 * themselves without "use existing folder". Appears under sidebar 「项目」 as
 * `wodeapp（自进化）` — not the chat-only `default-workspace` under 「最近」.
 *
 * Prefer monorepo root when available.
 * Packaged builds: use WODEAPPX_SOURCE_ROOT / WODEAPP_MONOREPO_ROOT when set;
 * otherwise extract the filtered monorepo bundled in Resources and mount that.
 * Disable with WODEAPPX_DISABLE_SELF_EVOLVE_WORKSPACES=1.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ensureBundledSelfEvolveMonorepo } from "./wodeapp-self-evolve-source-bundle.mjs";

export const SELF_EVOLVE_WORKSPACE_NAME = "wodeapp（自进化）";
/** @deprecated kept for tests / older call sites */
export const SELF_EVOLVE_WODEAPPX_NAME = SELF_EVOLVE_WORKSPACE_NAME;
/** @deprecated kept for tests / older call sites */
export const SELF_EVOLVE_RUNTIME_NAME = SELF_EVOLVE_WORKSPACE_NAME;
/** First-launch empty sandbox from an old seeder. Not the monorepo desk. */
export const LEGACY_SAFE_SELF_EVOLVE_SANDBOX_NAME = "WodeApp 自进化";

function readPackageName(dir) {
  try {
    const raw = readFileSync(path.join(dir, "package.json"), "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed?.name === "string" ? parsed.name.trim() : "";
  } catch {
    return "";
  }
}

function isDirectory(target) {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

export function looksLikeWodeappxRoot(dir) {
  if (!dir || !isDirectory(dir)) return false;
  if (readPackageName(dir) === "wodeappx") return true;
  return existsSync(path.join(dir, "scripts", "self-evolve-guard.mjs"));
}

export function looksLikeMonorepoRoot(dir) {
  if (!dir || !isDirectory(dir)) return false;
  return looksLikeWodeappxRoot(path.join(dir, "wodeappx"))
    && isDirectory(path.join(dir, "runtime-server"));
}

/**
 * Official OSS / standalone packs nest `wodeappx/` under archive root `wodeapp`
 * and omit monorepo siblings (`runtime-server`, `AGENTS.md`). Accept that tree
 * so packaged extract can still mount `wodeapp（自进化）`.
 */
export function resolveExtractedSelfEvolveMount(dir) {
  if (!dir || !isDirectory(dir)) return "";
  if (looksLikeMonorepoRoot(dir)) return path.resolve(dir);
  const nested = path.join(dir, "wodeappx");
  if (looksLikeWodeappxRoot(nested)) return path.resolve(nested);
  if (looksLikeWodeappxRoot(dir)) return path.resolve(dir);
  return "";
}

export function looksLikeExtractedSelfEvolveTree(dir) {
  return Boolean(resolveExtractedSelfEvolveMount(dir));
}

export function normalizePathKey(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed ? path.resolve(trimmed).replace(/\\/g, "/").toLowerCase() : "";
}

/**
 * Empty first-launch folder `…/projects/WodeApp 自进化`. Keep the real
 * `wodeapp（自进化）` mount even if someone reused the old display name.
 */
export function isLegacySafeSelfEvolveSandbox(entry, options = {}) {
  const pathKeyFn = options.normalizePathKey || normalizePathKey;
  const specKeys = options.specKeys instanceof Set ? options.specKeys : new Set();
  const key = pathKeyFn(entry?.path);
  if (key && specKeys.has(key)) return false;
  const name = String(entry?.name || "").trim();
  const display = String(entry?.displayName || "").trim();
  if (name === LEGACY_SAFE_SELF_EVOLVE_SANDBOX_NAME || display === LEGACY_SAFE_SELF_EVOLVE_SANDBOX_NAME) {
    return true;
  }
  return /\/projects\/wodeapp 自进化$/.test(key);
}

/**
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   seedPaths?: string[],
 *   moduleDir?: string,
 *   seedPathsOnly?: boolean,
 * }} [options]
 */
export function resolveSelfEvolveSourceRoots(options = {}) {
  const env = options.env || process.env;
  const explicitWodeappx = String(env.WODEAPPX_SOURCE_ROOT || "").trim();
  const explicitMonorepo = String(env.WODEAPP_MONOREPO_ROOT || "").trim();

  let wodeappxRoot = "";
  let monorepoRoot = "";

  if (explicitWodeappx && looksLikeWodeappxRoot(explicitWodeappx)) {
    wodeappxRoot = path.resolve(explicitWodeappx);
  }
  if (explicitMonorepo && looksLikeMonorepoRoot(explicitMonorepo)) {
    monorepoRoot = path.resolve(explicitMonorepo);
    if (!wodeappxRoot) wodeappxRoot = path.join(monorepoRoot, "wodeappx");
  }

  const seeds = [
    ...(Array.isArray(options.seedPaths) ? options.seedPaths : []),
  ];
  // Packaged probes should not inherit process.cwd() / electron module path —
  // those often point at unrelated trees or the .app bundle.
  if (!options.seedPathsOnly) {
    seeds.push(
      options.moduleDir || path.dirname(fileURLToPath(import.meta.url)),
      process.cwd(),
    );
  }

  for (const seed of seeds) {
    if (wodeappxRoot && monorepoRoot) break;
    let current = path.resolve(seed);
    for (let depth = 0; depth < 12; depth += 1) {
      if (!monorepoRoot && looksLikeMonorepoRoot(current)) {
        monorepoRoot = current;
        if (!wodeappxRoot) wodeappxRoot = path.join(current, "wodeappx");
      }
      if (!wodeappxRoot && looksLikeWodeappxRoot(current)) {
        wodeappxRoot = current;
        const parent = path.dirname(current);
        if (!monorepoRoot && looksLikeMonorepoRoot(parent)) {
          monorepoRoot = parent;
        }
      }
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }

  const runtimeServer = monorepoRoot ? path.join(monorepoRoot, "runtime-server") : "";
  const runtimeApp = monorepoRoot ? path.join(monorepoRoot, "runtime-app") : "";

  return {
    wodeappxRoot: wodeappxRoot && isDirectory(wodeappxRoot) ? wodeappxRoot : "",
    monorepoRoot: monorepoRoot && isDirectory(monorepoRoot) ? monorepoRoot : "",
    runtimeServerRoot: runtimeServer && isDirectory(runtimeServer) ? runtimeServer : "",
    runtimeAppRoot: runtimeApp && isDirectory(runtimeApp) ? runtimeApp : "",
  };
}

/**
 * @deprecated HOME directory scanning removed — packaged apps use the bundled
 * filtered monorepo under Resources instead.
 * @returns {string[]}
 */
export function listSelfEvolveProbeRoots(_env = process.env) {
  return [];
}

/**
 * Single combined workspace: monorepo when present, else wodeappx-only.
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   isPackaged?: boolean,
 *   seedPaths?: string[],
 *   moduleDir?: string,
 * }} [options]
 */
export function listSelfEvolveWorkspaceSpecs(options = {}) {
  const env = options.env || process.env;
  if (env.WODEAPPX_DISABLE_SELF_EVOLVE_WORKSPACES === "1") return [];

  const hasExplicitRoot = Boolean(
    String(env.WODEAPPX_SOURCE_ROOT || "").trim()
    || String(env.WODEAPP_MONOREPO_ROOT || "").trim(),
  );
  const seedPaths = [
    ...(Array.isArray(options.seedPaths) ? options.seedPaths : []),
  ];

  const roots = resolveSelfEvolveSourceRoots({
    env,
    seedPaths,
    // Packaged: only explicit env + provided seeds (bundled extract path).
    seedPathsOnly: Boolean(options.isPackaged && !hasExplicitRoot),
    moduleDir: options.isPackaged ? undefined : options.moduleDir,
  });
  if (roots.monorepoRoot) {
    const authorizedRoots = [roots.monorepoRoot];
    if (roots.wodeappxRoot) authorizedRoots.push(roots.wodeappxRoot);
    if (roots.runtimeServerRoot) authorizedRoots.push(roots.runtimeServerRoot);
    if (roots.runtimeAppRoot) authorizedRoots.push(roots.runtimeAppRoot);
    return [{
      key: "wodeapp-self-evolve",
      name: SELF_EVOLVE_WORKSPACE_NAME,
      path: roots.monorepoRoot,
      authorizedRoots: [...new Set(authorizedRoots)],
      legacyPaths: [
        roots.wodeappxRoot,
        roots.runtimeServerRoot,
      ].filter(Boolean),
    }];
  }

  if (roots.wodeappxRoot) {
    return [{
      key: "wodeapp-self-evolve",
      name: SELF_EVOLVE_WORKSPACE_NAME,
      path: roots.wodeappxRoot,
      authorizedRoots: [roots.wodeappxRoot],
      legacyPaths: [],
    }];
  }

  return [];
}

/**
 * Merge missing self-evolve workspaces into an existing list (by path key).
 * Also drops legacy split wodeappx/runtime mounts and the empty
 * `WodeApp 自进化` sandbox when replacing with the combined monorepo workspace.
 * Does not change selection unless the selected id was one of the removed
 * legacy entries (caller keeps selection as-is).
 *
 * @returns {{ workspaces: any[], changed: boolean, added: any[], removedIds: string[] }}
 */
export function mergeSelfEvolveWorkspaces(existingWorkspaces, specs, helpers) {
  const {
    localWorkspaceId,
    normalizeWorkspaceEntry,
    normalizePathKey: pathKeyFn = normalizePathKey,
  } = helpers;

  let workspaces = Array.isArray(existingWorkspaces) ? [...existingWorkspaces] : [];
  const removedIds = [];
  let changed = false;

  const legacyKeys = new Set();
  for (const spec of specs) {
    for (const legacyPath of spec.legacyPaths || []) {
      const key = pathKeyFn(legacyPath);
      if (key) legacyKeys.add(key);
    }
  }

  const specKeys = new Set(
    specs
      .map((spec) => pathKeyFn(spec.path))
      .filter(Boolean),
  );
  const dropLegacySandbox = specs.length > 0;

  if (legacyKeys.size > 0 || dropLegacySandbox) {
    const kept = [];
    for (const entry of workspaces) {
      const key = pathKeyFn(entry?.path);
      const dropSplit = Boolean(key && legacyKeys.has(key));
      const dropSandbox = dropLegacySandbox
        && isLegacySafeSelfEvolveSandbox(entry, { normalizePathKey: pathKeyFn, specKeys });
      if (dropSplit || dropSandbox) {
        removedIds.push(String(entry.id || ""));
        changed = true;
        continue;
      }
      kept.push(entry);
    }
    workspaces = kept;
  }

  const seen = new Set(
    workspaces
      .map((entry) => pathKeyFn(entry?.path))
      .filter(Boolean),
  );
  const added = [];

  for (const spec of specs) {
    const key = pathKeyFn(spec.path);
    if (!key || seen.has(key)) continue;
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

  // Refresh display name if the combined path already exists under an old label.
  for (const spec of specs) {
    const key = pathKeyFn(spec.path);
    if (!key) continue;
    const index = workspaces.findIndex((entry) => pathKeyFn(entry?.path) === key);
    if (index < 0) continue;
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

  return {
    workspaces,
    changed,
    added,
    removedIds: removedIds.filter(Boolean),
  };
}

/**
 * High-level ensure used by workspace-store bootstrap.
 */
export async function ensureSelfEvolveSourceWorkspaces(params) {
  const {
    workspaces,
    app,
    env = process.env,
    seedPaths = [],
    normalizeLocalWorkspacePath,
    normalizeWorkspaceEntry,
    localWorkspaceId,
    writeWorkspaceOpenworkConfig,
    defaultWorkspaceOpenworkConfig,
    pathExists,
    log = console.info.bind(console),
    resourcesPath,
  } = params;

  if (env.WODEAPPX_DISABLE_SELF_EVOLVE_WORKSPACES === "1") {
    return { workspaces, changed: false, added: [], removedIds: [] };
  }

  const isPackaged = Boolean(app?.isPackaged);
  const appPath = typeof app?.getAppPath === "function" ? app.getAppPath() : "";
  const hasExplicitRoot = Boolean(
    String(env.WODEAPPX_SOURCE_ROOT || "").trim()
    || String(env.WODEAPP_MONOREPO_ROOT || "").trim(),
  );

  const effectiveSeeds = [...seedPaths, appPath].filter(Boolean);
  if (isPackaged && !hasExplicitRoot) {
    const resolvedResources = typeof resourcesPath === "string" && resourcesPath.trim()
      ? resourcesPath.trim()
      : (typeof process.resourcesPath === "string" ? process.resourcesPath : "");
    const userDataPath = typeof app?.getPath === "function" ? app.getPath("userData") : "";
    const version = typeof app?.getVersion === "function" ? app.getVersion() : "";
    if (resolvedResources && userDataPath) {
      const bundledRoot = await ensureBundledSelfEvolveMonorepo({
        resourcesPath: resolvedResources,
        userDataPath,
        version,
        looksLikeMonorepoRoot,
        resolveMount: resolveExtractedSelfEvolveMount,
        log,
      });
      if (bundledRoot) effectiveSeeds.unshift(bundledRoot);
    }
  }

  const specs = listSelfEvolveWorkspaceSpecs({
    env,
    isPackaged,
    seedPaths: effectiveSeeds,
  });
  if (specs.length === 0) {
    return { workspaces, changed: false, added: [], removedIds: [] };
  }

  const resolvedSpecs = [];
  for (const spec of specs) {
    const folderPath = await normalizeLocalWorkspacePath(spec.path);
    if (!folderPath || !(await pathExists(folderPath))) continue;
    const authorizedRoots = [];
    for (const root of spec.authorizedRoots || [spec.path]) {
      const normalizedRoot = await normalizeLocalWorkspacePath(root);
      if (normalizedRoot) authorizedRoots.push(normalizedRoot);
    }
    const legacyPaths = [];
    for (const legacy of spec.legacyPaths || []) {
      const normalizedLegacy = await normalizeLocalWorkspacePath(legacy);
      if (normalizedLegacy) legacyPaths.push(normalizedLegacy);
    }
    resolvedSpecs.push({
      ...spec,
      path: folderPath,
      authorizedRoots: authorizedRoots.length > 0 ? authorizedRoots : [folderPath],
      legacyPaths,
    });
  }

  const merged = mergeSelfEvolveWorkspaces(workspaces, resolvedSpecs, {
    localWorkspaceId,
    normalizeWorkspaceEntry,
  });

  for (const item of merged.added) {
    const roots = item.authorizedRoots?.length ? item.authorizedRoots : [item.workspace.path];
    const config = defaultWorkspaceOpenworkConfig(
      item.workspace.path,
      "starter",
      item.workspace.name,
    );
    config.authorizedRoots = roots;
    await writeWorkspaceOpenworkConfig(item.workspace.path, config);
    log("[workspace] mounted self-evolve source workspace", {
      name: item.workspace.name,
      workspaceId: item.workspace.id,
      path: item.workspace.path,
      authorizedRoots: roots,
    });
  }

  if (merged.removedIds.length > 0) {
    log("[workspace] removed legacy split self-evolve workspaces", {
      removedIds: merged.removedIds,
    });
  }

  return merged;
}
