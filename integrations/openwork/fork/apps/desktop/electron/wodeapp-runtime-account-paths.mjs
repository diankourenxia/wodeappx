import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * OpenCode sidecar XDG roots are per signed-in WodeApp user id under
 * `<userData>/openwork-runtime-data/<accountId>/xdg/...`.
 * Electron main must write provider/MCP credentials into these dirs — not
 * `~/.config/opencode` — or the UI wallet and sidecar wallet diverge.
 */

export function sanitizeRuntimeAccountScope(value) {
  const scope = String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return scope || "anonymous";
}

export function managedRuntimeDataPaths(userDataDir, accountId) {
  const root = path.join(
    String(userDataDir ?? ""),
    "openwork-runtime-data",
    sanitizeRuntimeAccountScope(accountId),
  );
  return {
    root,
    xdgConfigHome: path.join(root, "xdg", "config"),
    xdgDataHome: path.join(root, "xdg", "data"),
    xdgStateHome: path.join(root, "xdg", "state"),
    opencodeConfigDir: path.join(root, "xdg", "config", "opencode"),
    opencodeAuthPath: path.join(root, "xdg", "data", "opencode", "auth.json"),
  };
}

/**
 * Scheduled `opencode run` jobs get a sibling XDG tree so they never open the
 * interactive UI `opencode.db` (dual-writer corruption risk).
 *
 * UI:        <account>/xdg/{config,data,state}
 * Scheduler: <account>/scheduler-xdg/{config,data,state}
 */
export function managedSchedulerRuntimeDataPaths(userDataDir, accountId) {
  const root = path.join(
    String(userDataDir ?? ""),
    "openwork-runtime-data",
    sanitizeRuntimeAccountScope(accountId),
  );
  return {
    root,
    xdgConfigHome: path.join(root, "scheduler-xdg", "config"),
    xdgDataHome: path.join(root, "scheduler-xdg", "data"),
    xdgStateHome: path.join(root, "scheduler-xdg", "state"),
    opencodeConfigDir: path.join(root, "scheduler-xdg", "config", "opencode"),
    opencodeAuthPath: path.join(root, "scheduler-xdg", "data", "opencode", "auth.json"),
  };
}

/** Remap a managed UI XDG path segment `/xdg/` → `/scheduler-xdg/`. */
export function remapUiXdgPathToSchedulerIsolation(filePath) {
  const raw = String(filePath ?? "");
  if (!raw.includes("openwork-runtime-data")) return raw;
  return raw.replace(/([/\\])xdg([/\\])/g, "$1scheduler-xdg$2");
}

/**
 * Copy of process env XDG_* / OPENCODE_CONFIG_DIR remapped onto scheduler-xdg.
 * Non-managed paths are left unchanged.
 */
export function remapUiXdgEnvToSchedulerIsolation(env = {}) {
  const keys = [
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_STATE_HOME",
    "XDG_CACHE_HOME",
    "OPENCODE_CONFIG_DIR",
  ];
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(env ?? {})) {
    if (typeof value === "string") out[key] = value;
  }
  for (const key of keys) {
    const value = typeof out[key] === "string" ? out[key].trim() : "";
    if (!value) continue;
    out[key] = remapUiXdgPathToSchedulerIsolation(value);
  }
  return out;
}

export function resolveAccountIdFromWodeAppConfig(config) {
  const fromUser = typeof config?.user?.id === "string" ? config.user.id.trim() : "";
  if (fromUser) return fromUser;
  const fromEnv = typeof process.env.WODEAPP_USER_ID === "string"
    ? process.env.WODEAPP_USER_ID.trim()
    : "";
  return fromEnv || "anonymous";
}

export function resolveActiveOpencodeConfigDir(userDataDir, config) {
  return managedRuntimeDataPaths(userDataDir, resolveAccountIdFromWodeAppConfig(config)).opencodeConfigDir;
}

/**
 * Every account-scoped OpenCode config dir that already exists on disk.
 * Login must refresh MCP/provider keys in all of them so a still-running
 * sidecar under a previous account id cannot keep billing the old wallet.
 */
export async function listExistingOpencodeConfigDirs(userDataDir) {
  const root = path.join(String(userDataDir ?? ""), "openwork-runtime-data");
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => managedRuntimeDataPaths(userDataDir, entry.name).opencodeConfigDir);
}

export async function listExistingRuntimeAccountPaths(userDataDir) {
  const root = path.join(String(userDataDir ?? ""), "openwork-runtime-data");
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => managedRuntimeDataPaths(userDataDir, entry.name));
}
