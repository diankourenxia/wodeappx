/**
 * Packaged A/B renderer pointer. Keep path names aligned with
 * wodeappx/scripts/self-evolve-packaged.mjs.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SELF_EVOLVE_LAUNCH_FILE = "self-evolve-launch.json";
export const SELF_EVOLVE_CURRENT_FILE = "self-evolve-current.json";
export const SELF_EVOLVE_SLOT_DIR = "self-evolve-slots";
export const SELF_EVOLVE_OVERLAY_DIR = "self-evolve-overlay";

export function sanitizeSlot(value, fallback = "A") {
  const raw = String(value || "").trim();
  return /^[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(raw) ? raw : fallback;
}

export function writeSelfEvolveLaunchInfo(userDataPath, info) {
  mkdirSync(userDataPath, { recursive: true });
  const payload = {
    product: "WodeAppX",
    bin: String(info.bin || "").trim(),
    resourcesPath: String(info.resourcesPath || "").trim(),
    userData: path.resolve(userDataPath),
    version: String(info.version || "").trim(),
    writtenAt: new Date().toISOString(),
  };
  writeFileSync(
    path.join(userDataPath, SELF_EVOLVE_LAUNCH_FILE),
    `${JSON.stringify(payload, null, 2)}\n`,
  );
  return payload;
}

export function readCurrentSlot(userDataPath, env = process.env) {
  if (env?.WODEAPPX_SELF_EVOLVE_SLOT) return sanitizeSlot(env.WODEAPPX_SELF_EVOLVE_SLOT);
  try {
    const parsed = JSON.parse(readFileSync(path.join(userDataPath, SELF_EVOLVE_CURRENT_FILE), "utf8"));
    return sanitizeSlot(parsed?.slot, "A");
  } catch {
    return "A";
  }
}

export function resolveSelfEvolveRendererIndex({
  userDataPath,
  packagedIndexPath,
  devIndexPath,
  isPackaged,
  env = process.env,
} = {}) {
  const fromEnv = String(env?.WODEAPPX_SELF_EVOLVE_RENDERER || "").trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const slot = readCurrentSlot(userDataPath, env);
  if (slot && slot !== "A") {
    const slotIndex = path.join(userDataPath, SELF_EVOLVE_SLOT_DIR, slot, "app-dist", "index.html");
    if (existsSync(slotIndex)) return slotIndex;
  }
  if (isPackaged) return packagedIndexPath || "";
  return devIndexPath || packagedIndexPath || "";
}

export function selfEvolveOverlayDirs(userDataPath, env = process.env) {
  const fromEnv = String(env?.WODEAPPX_SELF_EVOLVE_OVERLAY || "").trim();
  const dirs = [];
  if (fromEnv) dirs.push(fromEnv);
  if (userDataPath) dirs.push(path.join(userDataPath, SELF_EVOLVE_OVERLAY_DIR));
  return dirs;
}
