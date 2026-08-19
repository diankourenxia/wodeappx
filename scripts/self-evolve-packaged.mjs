/**
 * Packaged A/B self-evolve helpers (no Electron import).
 *
 * Official binary is the immutable shell. Slot B is a userData copy of
 * app-dist plus a baked runtime patch. Candidate windows relaunch the
 * same packaged binary with WODEAPPX_SELF_EVOLVE_SLOT=B.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SELF_EVOLVE_LAUNCH_FILE = "self-evolve-launch.json";
export const SELF_EVOLVE_CURRENT_FILE = "self-evolve-current.json";
export const SELF_EVOLVE_SLOT_DIR = "self-evolve-slots";
export const SELF_EVOLVE_OVERLAY_DIR = "self-evolve-overlay";
export const SELF_EVOLVE_RUNTIME_FILE = "wodeappx-self-evolve-runtime.js";
export const DEFAULT_SLOT_A = "A";
export const DEFAULT_SLOT_B = "B";

export function sanitizeSlot(value, fallback = DEFAULT_SLOT_A) {
  const raw = String(value || "").trim();
  return /^[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(raw) ? raw : fallback;
}

export function launchFilePath(userDataPath) {
  return path.join(userDataPath, SELF_EVOLVE_LAUNCH_FILE);
}

export function currentFilePath(userDataPath) {
  return path.join(userDataPath, SELF_EVOLVE_CURRENT_FILE);
}

export function slotRendererIndex(userDataPath, slot) {
  return path.join(userDataPath, SELF_EVOLVE_SLOT_DIR, sanitizeSlot(slot), "app-dist", "index.html");
}

export function overlayDir(userDataPath) {
  return path.join(userDataPath, SELF_EVOLVE_OVERLAY_DIR);
}

export function readJsonFile(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJsonFile(file, payload) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}

export function writeSelfEvolveLaunchInfo(userDataPath, info) {
  const payload = {
    product: "WodeAppX",
    bin: String(info.bin || "").trim(),
    resourcesPath: String(info.resourcesPath || "").trim(),
    userData: path.resolve(userDataPath),
    version: String(info.version || "").trim(),
    writtenAt: new Date().toISOString(),
  };
  writeJsonFile(launchFilePath(userDataPath), payload);
  return payload;
}

export function readSelfEvolveLaunchInfo(userDataPath) {
  const parsed = readJsonFile(launchFilePath(userDataPath), null);
  if (!parsed || typeof parsed !== "object") return null;
  return parsed;
}

export function readCurrentSlot(userDataPath, env = process.env) {
  if (env?.WODEAPPX_SELF_EVOLVE_SLOT) return sanitizeSlot(env.WODEAPPX_SELF_EVOLVE_SLOT);
  const parsed = readJsonFile(currentFilePath(userDataPath), null);
  return sanitizeSlot(parsed?.slot, DEFAULT_SLOT_A);
}

export function writeCurrentSlot(userDataPath, slot) {
  const normalized = sanitizeSlot(slot);
  writeJsonFile(currentFilePath(userDataPath), {
    slot: normalized,
    updatedAt: new Date().toISOString(),
  });
  return normalized;
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
  if (slot && slot !== DEFAULT_SLOT_A) {
    const slotIndex = slotRendererIndex(userDataPath, slot);
    if (existsSync(slotIndex)) return slotIndex;
  }
  if (isPackaged) return packagedIndexPath || "";
  return devIndexPath || packagedIndexPath || "";
}

export function resolvePackagedBin({ env = process.env, userDataPath = "", vendorElectron = "" } = {}) {
  const fromEnv = String(env?.WODEAPPX_PACKAGED_BIN || env?.WODEAPPX_LINUX_BIN || "").trim();
  if (fromEnv && existsSync(fromEnv)) return { kind: "packaged", bin: fromEnv };
  if (userDataPath) {
    const launch = readSelfEvolveLaunchInfo(userDataPath);
    const bin = String(launch?.bin || "").trim();
    if (bin && existsSync(bin)) return { kind: "packaged", bin };
  }
  if (vendorElectron && existsSync(vendorElectron)) return { kind: "vendor", bin: vendorElectron };
  return { kind: "", bin: "" };
}

export function buildCandidateEnv({
  env = {},
  cfg,
  version = "",
  officialUserData = "",
  slot = DEFAULT_SLOT_B,
} = {}) {
  const clean = { ...env };
  delete clean.GIT_DIR;
  delete clean.GIT_WORK_TREE;
  delete clean.GIT_INDEX_FILE;
  delete clean.ELECTRON_RUN_AS_NODE;
  const overlay = officialUserData ? overlayDir(officialUserData) : "";
  const renderer = officialUserData ? slotRendererIndex(officialUserData, slot) : "";
  const rendererReady = Boolean(renderer && existsSync(renderer));
  const startUrl = rendererReady ? pathToFileURL(renderer).href : "";
  return {
    ...clean,
    OPENWORK_E2E_ALLOW_PARALLEL: "1",
    OPENWORK_ELECTRON_APP_NAME: cfg.appName,
    OPENWORK_ELECTRON_APP_IDENTIFIER: cfg.identifier,
    OPENWORK_ELECTRON_USERDATA: cfg.userDataDir,
    OPENWORK_ELECTRON_REMOTE_DEBUG_PORT: String(cfg.cdpPort),
    WODEAPPX_TEST_INSTANCE_ID: String(cfg.id),
    WODEAPPX_INSTANCE_LABEL: `候选实例 ${cfg.id}`,
    WODEAPPX_INSTANCE_VERSION: version,
    WODEAPPX_SELF_EVOLVE_SLOT: sanitizeSlot(slot, DEFAULT_SLOT_B),
    ...(officialUserData ? { WODEAPPX_SELF_EVOLVE_OFFICIAL_USERDATA: officialUserData } : {}),
    ...(overlay ? { WODEAPPX_SELF_EVOLVE_OVERLAY: overlay } : {}),
    ...(rendererReady ? { WODEAPPX_SELF_EVOLVE_RENDERER: renderer } : {}),
    // 1.0.1 already honors this, so current installers can open slot B
    // without waiting for a new shell. Newer main also reads the slot path.
    ...(startUrl ? { OPENWORK_ELECTRON_START_URL: startUrl, ELECTRON_START_URL: startUrl } : {}),
  };
}

export function packagedLaunchArgs(env = process.env) {
  const extra = String(env?.ELECTRON_EXTRA_LAUNCH_ARGS || "").trim();
  const defaults = ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"];
  if (!extra) return defaults;
  return extra.split(/\s+/).filter(Boolean);
}

function escapeJsString(value) {
  return JSON.stringify(String(value ?? ""));
}

export function buildSelfEvolveRuntimeSource({ overlayPath = "", manifest = null } = {}) {
  const baked = manifest && typeof manifest === "object" ? manifest : {};
  return `/* wodeappx self-evolve runtime — baked at apply time */
(() => {
  const manifest = ${JSON.stringify(baked)};
  const overlay = ${escapeJsString(overlayPath)};
  const replace = Array.isArray(manifest.domTextReplace) ? manifest.domTextReplace : [];
  const apply = () => {
    for (const rule of replace) {
      const from = String(rule?.from || "");
      const to = String(rule?.to ?? "");
      if (!from) continue;
      const nodes = rule?.selector
        ? document.querySelectorAll(rule.selector)
        : document.querySelectorAll("button, a, [role='button'], h1, h2, span");
      for (const node of nodes) {
        const text = (node.textContent || "").trim();
        if (text === from) node.textContent = to;
      }
    }
  };
  const start = () => {
    apply();
    if (document.body) {
      new MutationObserver(apply).observe(document.body, { subtree: true, childList: true, characterData: true });
    }
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
  window.__WODEAPPX_SELF_EVOLVE_RUNTIME__ = { overlay, manifest };
})();
`;
}

export function injectSelfEvolveRuntime(indexHtml, scriptName = SELF_EVOLVE_RUNTIME_FILE) {
  const html = String(indexHtml || "");
  const tag = `<script src="./${scriptName}"></script>`;
  if (html.includes(tag) || html.includes(scriptName)) return html;
  if (html.includes("</body>")) return html.replace("</body>", `  ${tag}\n</body>`);
  return `${html}\n${tag}\n`;
}

export function applySelfEvolveSlot({
  resourcesPath,
  userDataPath,
  slot = DEFAULT_SLOT_B,
  manifest = null,
} = {}) {
  const packagedIndex = path.join(resourcesPath, "app-dist", "index.html");
  if (!existsSync(packagedIndex)) {
    throw new Error(`packaged app-dist missing: ${packagedIndex}`);
  }
  const destDir = path.dirname(slotRendererIndex(userDataPath, slot));
  mkdirSync(destDir, { recursive: true });
  cpSync(path.join(resourcesPath, "app-dist"), destDir, { recursive: true });
  const indexPath = path.join(destDir, "index.html");
  const injected = injectSelfEvolveRuntime(readFileSync(indexPath, "utf8"));
  writeFileSync(indexPath, injected);
  const overlayPath = overlayDir(userDataPath);
  mkdirSync(overlayPath, { recursive: true });
  const overlayManifest = readJsonFile(path.join(overlayPath, "manifest.json"), null);
  const runtime = buildSelfEvolveRuntimeSource({
    overlayPath,
    manifest: manifest || overlayManifest || {},
  });
  writeFileSync(path.join(destDir, SELF_EVOLVE_RUNTIME_FILE), runtime);
  writeJsonFile(path.join(userDataPath, SELF_EVOLVE_SLOT_DIR, sanitizeSlot(slot), "slot.json"), {
    slot: sanitizeSlot(slot),
    source: packagedIndex,
    appliedAt: new Date().toISOString(),
  });
  return {
    slot: sanitizeSlot(slot),
    rendererIndex: indexPath,
    overlayPath,
  };
}
