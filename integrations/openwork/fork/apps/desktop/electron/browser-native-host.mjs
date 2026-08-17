import { execFile } from "node:child_process";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WODEAPPX_BROWSER_NATIVE_HOST_NAME = "com.wodeappx.browser_control";
export const WODEAPPX_BROWSER_NATIVE_HOST_VERSION = "0.1.0";
export const WODEAPPX_BROWSER_EXTENSION_ORIGINS = Object.freeze([
  "chrome-extension://mfnpfomihliahiheofiijbmmhfeanhpb/",
  "chrome-extension://jcpoknmofkccjkhkgdgnlemnemfjkbmp/",
]);

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

export function nativeHostTargetTriple(platform = process.platform, arch = process.arch) {
  if (platform === "darwin") {
    if (arch === "arm64") return "aarch64-apple-darwin";
    if (arch === "x64") return "x86_64-apple-darwin";
  }
  if (platform === "linux") {
    if (arch === "arm64") return "aarch64-unknown-linux-gnu";
    if (arch === "x64") return "x86_64-unknown-linux-gnu";
  }
  if (platform === "win32") {
    if (arch === "arm64") return "aarch64-pc-windows-msvc";
    if (arch === "x64") return "x86_64-pc-windows-msvc";
  }
  return null;
}

export function nativeHostManifest(hostPath, origins = WODEAPPX_BROWSER_EXTENSION_ORIGINS) {
  return {
    name: WODEAPPX_BROWSER_NATIVE_HOST_NAME,
    description: "WodeAppX Browser Control native messaging host",
    path: path.resolve(hostPath),
    type: "stdio",
    allowed_origins: [...origins],
  };
}

function isPathInside(parent, child) {
  const resolvedParent = path.resolve(parent);
  const resolvedChild = path.resolve(child);
  const relative = path.relative(resolvedParent, resolvedChild);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Passwd/home-directory home, ignoring $HOME. Electron on macOS can keep
 * os.homedir() on the real user while $HOME is isolated for QA.
 */
export function realUserHomeDir() {
  try {
    const home = os.userInfo().homedir;
    if (typeof home === "string" && home.trim()) return home;
  } catch {
    /* no passwd entry in some sandboxes */
  }
  return os.homedir();
}

export function isEphemeralFsPath(targetPath, extraRoots = []) {
  if (!targetPath) return false;
  const resolved = path.resolve(targetPath);
  const roots = [os.tmpdir(), "/tmp", "/private/tmp", "/var/tmp", ...extraRoots].filter(Boolean);
  return roots.some((root) => isPathInside(root, resolved));
}

/**
 * Isolated /tmp builds must not overwrite the user's real Chrome native-host
 * manifest. Chrome would then keep spawning the ephemeral binary.
 */
export function shouldSkipNativeHostRegistration({
  hostPath,
  homeDir,
  realHome = realUserHomeDir(),
  env = process.env,
} = {}) {
  if (env?.WODEAPPX_SKIP_NATIVE_HOST === "1") {
    return { skip: true, reason: "skipped_by_env" };
  }
  if (!isEphemeralFsPath(hostPath)) return { skip: false, reason: "" };
  if (path.resolve(homeDir || "") === path.resolve(realHome || "")) {
    return { skip: true, reason: "ephemeral_host_skipped" };
  }
  return { skip: false, reason: "" };
}

export function nativeHostManifestTargets({
  platform = process.platform,
  homeDir = process.env.HOME || os.homedir(),
  appDataDir = process.env.APPDATA || "",
  userDataDir = "",
} = {}) {
  const fileName = `${WODEAPPX_BROWSER_NATIVE_HOST_NAME}.json`;
  if (platform === "darwin") {
    return [
      path.join(homeDir, "Library/Application Support/Google/Chrome/NativeMessagingHosts", fileName),
      path.join(homeDir, "Library/Application Support/Google/Chrome for Testing/NativeMessagingHosts", fileName),
      path.join(homeDir, "Library/Application Support/Chromium/NativeMessagingHosts", fileName),
    ];
  }
  if (platform === "linux") {
    const configRoot = process.env.XDG_CONFIG_HOME || path.join(homeDir, ".config");
    return [
      path.join(configRoot, "google-chrome/NativeMessagingHosts", fileName),
      path.join(configRoot, "chromium/NativeMessagingHosts", fileName),
    ];
  }
  if (platform === "win32") {
    const base = userDataDir || path.join(appDataDir || homeDir, "WodeAppX");
    return [path.join(base, "browser-native-host", fileName)];
  }
  return [];
}

export async function resolveBrowserNativeHostPath({
  platform = process.platform,
  arch = process.arch,
  resourcesPath = process.resourcesPath || "",
  developmentRoot = path.resolve(moduleDir, ".."),
} = {}) {
  const triple = nativeHostTargetTriple(platform, arch);
  if (!triple) return null;
  const suffix = platform === "win32" ? ".exe" : "";
  const alias = `wodeappx-browser-native-host${suffix}`;
  const target = `wodeappx-browser-native-host-${triple}${suffix}`;
  const candidates = [
    resourcesPath && path.join(resourcesPath, "native-hosts", alias),
    resourcesPath && path.join(resourcesPath, "native-hosts", target),
    path.join(developmentRoot, "resources", "native-hosts", alias),
    path.join(developmentRoot, "resources", "native-hosts", target),
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (await access(candidate).then(() => true).catch(() => false)) {
      return path.resolve(candidate);
    }
  }
  return null;
}

function execFileAsync(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

async function registerWindowsManifest(manifestPath, runRegistry = execFileAsync) {
  const registryKeys = [
    `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${WODEAPPX_BROWSER_NATIVE_HOST_NAME}`,
    `HKCU\\Software\\Chromium\\NativeMessagingHosts\\${WODEAPPX_BROWSER_NATIVE_HOST_NAME}`,
  ];
  for (const key of registryKeys) {
    await runRegistry("reg.exe", [
      "ADD",
      key,
      "/ve",
      "/t",
      "REG_SZ",
      "/d",
      manifestPath,
      "/f",
    ]);
  }
}

/**
 * @param {{
 *   app?: { getPath?: (name: string) => string },
 *   platform?: NodeJS.Platform,
 *   arch?: NodeJS.Architecture,
 *   homeDir?: string,
 *   resourcesPath?: string,
 *   developmentRoot?: string,
 *   runRegistry?: (command: string, args: string[]) => Promise<unknown>,
 * }} [options]
 */
export async function registerBrowserNativeHost({
  app,
  platform = process.platform,
  arch = process.arch,
  homeDir = process.env.HOME || os.homedir(),
  realHome = realUserHomeDir(),
  resourcesPath = process.resourcesPath || "",
  developmentRoot,
  runRegistry,
  env = process.env,
} = {}) {
  const userDataDir = app?.getPath?.("userData") || "";
  const hostPath = await resolveBrowserNativeHostPath({
    platform,
    arch,
    resourcesPath,
    developmentRoot,
  });
  if (!hostPath) {
    return {
      ok: false,
      reason: "host_missing",
      hostName: WODEAPPX_BROWSER_NATIVE_HOST_NAME,
      target: nativeHostTargetTriple(platform, arch),
    };
  }

  const skip = shouldSkipNativeHostRegistration({ hostPath, homeDir, realHome, env });
  if (skip.skip) {
    return {
      ok: false,
      reason: skip.reason,
      hostName: WODEAPPX_BROWSER_NATIVE_HOST_NAME,
      hostPath,
      target: nativeHostTargetTriple(platform, arch),
    };
  }

  if (platform !== "win32") {
    await chmod(hostPath, 0o755).catch(() => undefined);
  }
  const manifest = nativeHostManifest(hostPath);
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const targets = nativeHostManifestTargets({
    platform,
    homeDir,
    appDataDir: process.env.APPDATA || "",
    userDataDir,
  });
  if (!targets.length) {
    return {
      ok: false,
      reason: "platform_unsupported",
      hostName: WODEAPPX_BROWSER_NATIVE_HOST_NAME,
      target: nativeHostTargetTriple(platform, arch),
    };
  }

  for (const target of targets) {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, manifestText, { encoding: "utf8", mode: 0o600 });
  }
  if (platform === "win32") {
    await registerWindowsManifest(targets[0], runRegistry || execFileAsync);
  }

  return {
    ok: true,
    hostName: WODEAPPX_BROWSER_NATIVE_HOST_NAME,
    hostVersion: WODEAPPX_BROWSER_NATIVE_HOST_VERSION,
    hostPath,
    manifestPaths: targets,
    allowedOrigins: [...WODEAPPX_BROWSER_EXTENSION_ORIGINS],
    transport: "native_messaging",
  };
}
