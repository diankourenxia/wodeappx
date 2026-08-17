const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createRequire } = require("node:module");
const { spawnSync } = require("node:child_process");

const SUPERVISOR_ASAR_ENTRY = "server/dist/opencode-plugins/wodeappx-scheduler-supervisor.js";

const computerUseHelperAppName = "OpenWork Computer Use.app";
const localSpeechHelperAppName = "wodeappx-local-speech.app";

/** Always required for a usable packaged runtime. */
const requiredSidecarBases = [
  "opencode",
  "openwork-orchestrator",
];

/**
 * Present when prepared for the target; skip quietly if missing.
 * Capture engine is WodeAppX-specific and may be absent on pure OSS trees.
 */
const optionalSidecarBases = [
  "openwork-server",
  "chrome-devtools-mcp",
  "wodeappx-capture-engine",
];

/**
 * electron-builder passes `context.arch` as the numeric Arch enum
 * (ia32=0, x64=1, armv7l=2, arm64=3, universal=4), not a string.
 */
function normalizePackArch(arch) {
  if (typeof arch === "string" && arch.trim()) return arch.trim();
  if (typeof arch === "number" && Number.isFinite(arch)) {
    const byIndex = ["ia32", "x64", "armv7l", "arm64", "universal"];
    if (byIndex[arch]) return byIndex[arch];
  }
  return null;
}

function targetTriple(platformName, arch) {
  const normalized = normalizePackArch(arch);
  if (!normalized || normalized === "universal") return null;

  if (platformName === "darwin") {
    if (normalized === "arm64") return "aarch64-apple-darwin";
    if (normalized === "x64") return "x86_64-apple-darwin";
  }
  if (platformName === "linux") {
    if (normalized === "arm64") return "aarch64-unknown-linux-gnu";
    if (normalized === "x64") return "x86_64-unknown-linux-gnu";
  }
  if (platformName === "win32") {
    if (normalized === "arm64") return "aarch64-pc-windows-msvc";
    if (normalized === "x64") return "x86_64-pc-windows-msvc";
  }
  return null;
}

function resolveSidecarsDir(context) {
  if (context.electronPlatformName === "darwin") {
    const entries = fs.existsSync(context.appOutDir) ? fs.readdirSync(context.appOutDir) : [];
    const appName = entries.find((entry) => entry.endsWith(".app"));
    return appName ? path.join(context.appOutDir, appName, "Contents", "Resources", "sidecars") : null;
  }
  return path.join(context.appOutDir, "resources", "sidecars");
}

function resolvePackagedResourcesDir(context) {
  if (context.electronPlatformName === "darwin") {
    const entries = fs.existsSync(context.appOutDir) ? fs.readdirSync(context.appOutDir) : [];
    const appName = entries.find((entry) => entry.endsWith(".app"));
    return appName ? path.join(context.appOutDir, appName, "Contents", "Resources") : null;
  }
  return path.join(context.appOutDir, "resources");
}

function resolveMacAppPath(context) {
  if (context.electronPlatformName !== "darwin") return null;
  const appName = `${context.packager.appInfo.productFilename}.app`;
  const direct = path.join(context.appOutDir, appName);
  if (fs.existsSync(direct)) return direct;

  const entries = fs.existsSync(context.appOutDir) ? fs.readdirSync(context.appOutDir) : [];
  const fallback = entries.find((entry) => entry.endsWith(".app"));
  return fallback ? path.join(context.appOutDir, fallback) : null;
}

function loadElectronAsar() {
  const desktopPkg = path.join(__dirname, "..", "package.json");
  return createRequire(desktopPkg)("@electron/asar");
}

function asarHasEntry(listing, entry) {
  const normalized = entry.replace(/\\/g, "/").replace(/^\//, "");
  return listing.some((item) => {
    const value = String(item).replace(/\\/g, "/").replace(/^\//, "");
    return value === normalized || value.endsWith(`/${normalized}`);
  });
}

function ensureSchedulerSupervisorInAsar(context) {
  const resourcesDir = resolvePackagedResourcesDir(context);
  if (!resourcesDir) {
    throw new Error("afterPack could not resolve Resources for scheduler-supervisor asar inject");
  }
  const asarPath = path.join(resourcesDir, "app.asar");
  const extraPath = path.join(resourcesDir, "opencode-plugins", "wodeappx-scheduler-supervisor.js");
  if (!fs.existsSync(asarPath)) {
    throw new Error(`Packaged app.asar missing at ${asarPath}`);
  }
  if (!fs.existsSync(extraPath)) {
    throw new Error(`Packaged extraResource supervisor missing at ${extraPath}`);
  }
  const asar = loadElectronAsar();
  const listing = asar.listPackage(asarPath);
  if (asarHasEntry(listing, SUPERVISOR_ASAR_ENTRY)) {
    return { injected: false, asarPath };
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wodeappx-asar-supervisor-"));
  try {
    asar.extractAll(asarPath, tmp);
    const dest = path.join(tmp, ...SUPERVISOR_ASAR_ENTRY.split("/"));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(extraPath, dest);
    fs.rmSync(asarPath);
    asar.createPackage(tmp, asarPath);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { injected: true, asarPath };
}

function signComputerUseHelper(context) {
  const appPath = resolveMacAppPath(context);
  if (!appPath) return;

  const helperPath = path.join(appPath, "Contents", "Resources", "helpers", computerUseHelperAppName);
  if (!fs.existsSync(helperPath)) {
    throw new Error(`Missing Computer Use helper app at ${helperPath}`);
  }

  const identity = process.env.OPENWORK_COMPUTER_USE_CODESIGN_IDENTITY
    || process.env.CSC_NAME
    || process.env.APPLE_CODESIGN_IDENTITY
    || "-";
  const args = ["--force", "--deep", "--options", "runtime", "--sign", identity];
  if (identity !== "-") args.push("--timestamp");
  args.push(helperPath);

  const result = spawnSync("codesign", args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`codesign failed for Computer Use helper app with status ${result.status}`);
  }
}

function signLocalSpeechHelper(context) {
  const appPath = resolveMacAppPath(context);
  if (!appPath) return;
  const helperPath = path.join(appPath, "Contents", "Resources", "helpers", localSpeechHelperAppName);
  if (!fs.existsSync(helperPath)) throw new Error(`Missing local speech helper app at ${helperPath}`);
  const identity = process.env.CSC_NAME || process.env.APPLE_CODESIGN_IDENTITY || "-";
  const args = ["--force", "--deep", "--options", "runtime", "--sign", identity];
  if (identity !== "-") args.push("--timestamp");
  args.push(helperPath);
  const result = spawnSync("codesign", args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`codesign failed for local speech helper with status ${result.status}`);
}

function signBrowserNativeHost(context, nativeHostPath) {
  if (context.electronPlatformName !== "darwin") return;
  if (!fs.existsSync(nativeHostPath)) {
    throw new Error(`Missing WodeAppX browser native host at ${nativeHostPath}`);
  }
  const identity = process.env.CSC_NAME || process.env.APPLE_CODESIGN_IDENTITY || "-";
  const args = ["--force", "--options", "runtime", "--sign", identity];
  if (identity !== "-") args.push("--timestamp");
  args.push(nativeHostPath);
  const result = spawnSync("codesign", args, { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`codesign failed for browser native host with status ${result.status}`);
  }
}

/**
 * Ensure the short alias exists from the arch-specific triple binary, then drop
 * the triple-named duplicate so each packaged arch only ships one copy
 * (~200MB savings on macOS). Never fall back to a pre-existing alias alone —
 * that alias may be the host/other arch from a multi-arch prepare.
 * Runtime resolves both `opencode` and `opencode-<triple>` (alias is enough).
 */
function materializeAliasOnly(sidecarsDir, targetName, aliasName, { required }) {
  const targetPath = path.join(sidecarsDir, targetName);
  const aliasPath = path.join(sidecarsDir, aliasName);
  const targetExists = fs.existsSync(targetPath);

  if (!targetExists) {
    if (required) {
      throw new Error(`Missing packaged sidecar for target: ${targetName}`);
    }
    // Drop a stale wrong-arch alias if the matching triple is absent.
    if (fs.existsSync(aliasPath)) {
      fs.rmSync(aliasPath, { force: true });
    }
    return false;
  }

  fs.copyFileSync(targetPath, aliasPath);
  try {
    fs.chmodSync(aliasPath, 0o755);
  } catch {
    // Windows and some filesystems may ignore chmod.
  }

  if (targetName !== aliasName) {
    fs.rmSync(targetPath, { force: true });
  }
  return true;
}

async function afterPack(context) {
  const triple = targetTriple(context.electronPlatformName, context.arch);
  if (!triple) {
    throw new Error(
      `afterPack could not resolve target triple for platform=${context.electronPlatformName} arch=${JSON.stringify(context.arch)}`,
    );
  }

  const sidecarsDir = resolveSidecarsDir(context);
  if (!sidecarsDir || !fs.existsSync(sidecarsDir)) {
    throw new Error(`Packaged sidecars directory missing for ${triple}: ${sidecarsDir || "(unresolved)"}`);
  }

  const isWindows = context.electronPlatformName === "win32";
  const executableSuffix = isWindows ? ".exe" : "";
  const keep = new Set();

  for (const base of requiredSidecarBases) {
    const aliasName = `${base}${executableSuffix}`;
    const targetName = `${base}-${triple}${executableSuffix}`;
    materializeAliasOnly(sidecarsDir, targetName, aliasName, { required: true });
    keep.add(aliasName);
  }

  for (const base of optionalSidecarBases) {
    const aliasName = `${base}${executableSuffix}`;
    const targetName = `${base}-${triple}${executableSuffix}`;
    if (materializeAliasOnly(sidecarsDir, targetName, aliasName, { required: false })) {
      keep.add(aliasName);
    }
  }

  const versionsAlias = "versions.json";
  const versionsTarget = `versions.json-${triple}${executableSuffix}`;
  const versionsTargetPath = path.join(sidecarsDir, versionsTarget);
  const versionsAliasPath = path.join(sidecarsDir, versionsAlias);
  if (fs.existsSync(versionsTargetPath)) {
    fs.copyFileSync(versionsTargetPath, versionsAliasPath);
    fs.rmSync(versionsTargetPath, { force: true });
    keep.add(versionsAlias);
  } else if (fs.existsSync(versionsAliasPath)) {
    keep.add(versionsAlias);
  } else {
    throw new Error(`Missing packaged sidecar metadata for target: ${versionsTarget}`);
  }

  for (const entry of fs.readdirSync(sidecarsDir)) {
    if (!keep.has(entry)) {
      fs.rmSync(path.join(sidecarsDir, entry), { force: true, recursive: true });
    }
  }

  const resourcesDir = resolvePackagedResourcesDir(context);
  ensureSchedulerSupervisorInAsar(context);
  const nativeHostsDir = resourcesDir ? path.join(resourcesDir, "native-hosts") : null;
  if (!nativeHostsDir || !fs.existsSync(nativeHostsDir)) {
    throw new Error(`Packaged browser native-host directory missing for ${triple}`);
  }
  const nativeHostAlias = `wodeappx-browser-native-host${executableSuffix}`;
  const nativeHostTarget = `wodeappx-browser-native-host-${triple}${executableSuffix}`;
  materializeAliasOnly(nativeHostsDir, nativeHostTarget, nativeHostAlias, { required: true });
  for (const entry of fs.readdirSync(nativeHostsDir)) {
    if (entry !== nativeHostAlias) {
      fs.rmSync(path.join(nativeHostsDir, entry), { force: true, recursive: true });
    }
  }
  const nativeHostPath = path.join(nativeHostsDir, nativeHostAlias);

  // Fail closed: never ship a wrong-arch OpenCode binary for this package.
  const opencodeAlias = path.join(sidecarsDir, `opencode${executableSuffix}`);
  if (!fs.existsSync(opencodeAlias)) {
    throw new Error(`afterPack left no opencode alias for ${triple}`);
  }

  if (context.electronPlatformName === "darwin") {
    signBrowserNativeHost(context, nativeHostPath);
    signComputerUseHelper(context);
    signLocalSpeechHelper(context);
  }
}

module.exports = afterPack;
module.exports.default = afterPack;
module.exports.normalizePackArch = normalizePackArch;
module.exports.targetTriple = targetTriple;
module.exports.materializeAliasOnly = materializeAliasOnly;
module.exports.ensureSchedulerSupervisorInAsar = ensureSchedulerSupervisorInAsar;
module.exports.asarHasEntry = asarHasEntry;
module.exports.resolvePackagedResourcesDir = resolvePackagedResourcesDir;
