#!/usr/bin/env node
import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const vendor = path.join(root, "vendor/openwork");

async function readText(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

async function readVendorText(relativePath) {
  return readFile(path.join(vendor, relativePath), "utf8");
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

async function readVendorJson(relativePath) {
  return JSON.parse(await readVendorText(relativePath));
}

function fail(message) {
  throw new Error(`[release-contract] ${message}`);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    fail(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(content, needle, message) {
  if (!content.includes(needle)) {
    fail(`${message}: missing ${JSON.stringify(needle)}`);
  }
}

function assertNotIncludes(content, needle, message) {
  if (content.includes(needle)) {
    fail(`${message}: found ${JSON.stringify(needle)}`);
  }
}

async function assertVendorFileExists(relativePath, message) {
  try {
    await access(path.join(vendor, relativePath));
  } catch {
    fail(`${message}: missing ${relativePath}`);
  }
}

const rootPackage = await readJson("package.json");
const desktopPackage = await readVendorJson("apps/desktop/package.json");
const builder = await readVendorText("apps/desktop/electron-builder.yml");
const main = await readVendorText("apps/desktop/electron/main.mjs");
const nativeHostSrc = await readVendorText("apps/desktop/electron/browser-native-host.mjs");
const selfEvolveBundle = await readVendorText("apps/desktop/electron/wodeapp-self-evolve-source-bundle.mjs");
const updater = await readVendorText("apps/desktop/electron/updater.mjs");
const workspaceStore = await readVendorText("apps/desktop/electron/workspace-store.mjs");
const architectureGate = await readVendorText("apps/app/src/react-app/shell/architecture-mismatch-gate.tsx");

assertEqual(
  rootPackage.version,
  desktopPackage.version,
  "wodeappx package version must match the desktop app version shown in-app",
);

assertIncludes(builder, "productName: WodeAppX", "desktop package product name");
assertIncludes(builder, "executableName: WodeAppX", "desktop executable must not inherit @openwork/desktop");
assertIncludes(builder, "shortcutName: WodeAppX", "Windows Start Menu shortcut must be WodeAppX");
assertIncludes(builder, "oneClick: false", "Windows installer must show the setup wizard");
assertIncludes(builder, "allowToChangeInstallationDirectory: true", "Windows installer must let users choose the install folder");
assertIncludes(updater, "shouldInstallUpdateSilently()", "Windows in-app updates must install silently into the chosen folder");
assertIncludes(builder, "artifactName: wodeappx-${os}-${arch}-${version}.${ext}", "artifact naming must include product, OS, arch, and version");
assertIncludes(builder, "from: resources/native-hosts", "desktop package must include browser native-host resources");
assertIncludes(builder, "wodeappx-browser-native-host*", "desktop package must include the arch-specific browser native host");
assertIncludes(builder, "owner: wodeapp", "electron-builder publish owner");
assertIncludes(builder, "repo: wodeappx", "electron-builder publish repo");

for (const marker of [
  "opencode-aarch64-apple-darwin",
  "opencode-x86_64-apple-darwin",
  "openwork-orchestrator-aarch64-apple-darwin",
  "openwork-orchestrator-x86_64-apple-darwin",
  "wodeappx-capture-engine-aarch64-apple-darwin",
  "wodeappx-capture-engine-x86_64-apple-darwin",
]) {
  assertIncludes(builder, marker, `mac release resource ${marker}`);
}

assertIncludes(main, "https://wodeapp.cn/downloads/wodeappx", "architecture download feed");
assertIncludes(main, "https://x.wodeapp.cn/", "architecture release page");
assertIncludes(main, "wodeappx-${platformDownloadSlug()}-${downloadAssetArch(targetArch)}-${version}.${downloadAssetExtension()}", "architecture fallback asset name");
assertNotIncludes(main, "openwork-${platformDownloadSlug()}-${downloadAssetArch(targetArch)}", "architecture fallback must not use upstream asset name");

assertIncludes(updater, "https://wodeapp.cn/downloads/wodeappx", "stable updater feed");
assertIncludes(updater, "https://gitea.com/diankourenxia/wodeappx/releases/download/alpha-macos-latest", "alpha updater feed");

assertIncludes(main, 'const APP_IDENTIFIER_PRODUCTION = "com.differentai.openwork";', "production app data identifier must remain stable for conversation compatibility");
assertIncludes(main, 'path.join(app.getPath("appData"), APP_IDENTIFIER_PRODUCTION)', "user data path must be based on the stable production app identifier");
assertIncludes(main, "applySelfEvolveRendererOverlay", "packaged desktop must load self-evolve overlay CSS from userData");
assertIncludes(main, "resolveSelfEvolveRendererIndex", "packaged desktop must prefer self-evolve slot renderer over sealed app-dist");
assertIncludes(main, "writeSelfEvolveLaunchInfo", "packaged desktop must write self-evolve-launch.json so B can relaunch the same binary");
assertIncludes(main, "selfEvolveOverlayDirs", "self-evolve overlay dirs must honor WODEAPPX_SELF_EVOLVE_OVERLAY");
assertIncludes(main, "self-evolve-overlay", "self-evolve overlay must read userData overlay dir");
assertIncludes(main, 'localStorage.getItem("wodeappx.skin")', "self-evolve overlay must apply the active skin last, not every overlay CSS file");
assertIncludes(main, "^[a-z0-9][a-z0-9_-]{0,63}$", "self-evolve overlay skin filename must reject path traversal");
assertIncludes(main, "wodeappx-self-evolve-overlay", "self-evolve overlay must inject a document style tag so author !important in app-dist can be overridden");
{
  const overlayCall = main.indexOf("void applySelfEvolveRendererOverlay(mainWindow)");
  const loadCall = main.lastIndexOf("await loadMainRenderer(mainWindow)");
  if (overlayCall < 0 || loadCall < 0 || overlayCall > loadCall) {
    fail("self-evolve overlay listener must be registered before loadMainRenderer so the first paint is covered");
  }
}
assertIncludes(main, 'from "./wodeapp-cloud/wodeapp-auth-ipc.mjs"', "desktop main must import WodeApp auth IPC");
assertIncludes(main, 'from "./browser-native-host.mjs"', "desktop main must import browser native-host registration");
assertIncludes(main, "registerBrowserNativeHost({ app })", "desktop startup must register the Chrome native host");
assertIncludes(nativeHostSrc, "ephemeral_host_skipped", "native host must refuse ephemeral /tmp hosts that would overwrite real Chrome");
assertIncludes(nativeHostSrc, "shouldSkipNativeHostRegistration", "native host registration must have an ephemeral/isolation guard");
assertIncludes(selfEvolveBundle, "withDestLock", "bundled self-evolve extract must serialize concurrent tars");
assertIncludes(builder, "wodeappx-scheduler-supervisor.js", "asar must keep scheduler-supervisor next to automations.js");
assertIncludes(builder, "from: server/dist/opencode-plugins", "scheduler-supervisor must be a dedicated electron-builder FileSet so the plugin exclude cannot drop it");
assertIncludes(builder, "to: licenses", "installers must ship the third-party license inventory");
await assertVendorFileExists(
  "apps/desktop/electron/browser-native-host.mjs",
  "packaged desktop must include browser-native-host.mjs next to main.mjs",
);
await assertVendorFileExists(
  "apps/desktop/electron/wodeapp-cloud/wodeapp-auth-ipc.mjs",
  "packaged desktop must include wodeapp-auth-ipc.mjs next to main.mjs",
);
await assertVendorFileExists(
  "apps/desktop/electron/wodeapp-cloud/wodeapp-local-assets-ipc.mjs",
  "packaged desktop must include wodeapp-local-assets-ipc.mjs next to main.mjs",
);
await assertVendorFileExists(
  "apps/desktop/electron/wodeapp-cloud/wodeapp-node-request.mjs",
  "packaged desktop must include wodeapp-node-request.mjs worker",
);
await assertVendorFileExists(
  "apps/desktop/electron/local-tts-worker.mjs",
  "packaged desktop must include local-tts-worker.mjs",
);
assertIncludes(builder, "electron/local-tts-worker.mjs", "local TTS worker must be asarUnpack'd");
assertIncludes(builder, "electron/wodeapp-cloud/wodeapp-node-request.mjs", "node request worker must be asarUnpack'd");
const preload = await readVendorText("apps/desktop/electron/preload.mjs");
assertIncludes(preload, "wodeappAuth", "preload must expose wodeappAuth for account binding");
assertIncludes(preload, 'invoke("wodeapp:auth"', "preload must bridge wodeapp:auth IPC");
assertIncludes(workspaceStore, "openwork-workspaces.json", "workspace state filename must stay stable");
assertIncludes(workspaceStore, "selectedWorkspaceId", "workspace state must preserve legacy selected workspace key");
assertIncludes(workspaceStore, "watchedWorkspaceId", "workspace state must preserve legacy watched workspace key");
assertIncludes(workspaceStore, "replaceFileAtomic", "workspace persist must use Windows-safe replace");
assertIncludes(workspaceStore, "persistWorkspaceStateSafe", "workspace persist must not crash boot on EPERM");
await assertVendorFileExists(
  "apps/desktop/electron/workspace-atomic-write.mjs",
  "packaged desktop must include Windows-safe workspace atomic write",
);
const loadingOverlay = await readVendorText("apps/app/src/react-app/shell/loading-overlay.tsx");
assertIncludes(loadingOverlay, "https://x.wodeapp.cn/", "boot error download page");
assertNotIncludes(loadingOverlay, "github.com/different-ai/openwork/releases", "boot error must not send users to OpenWork GitHub");

assertIncludes(architectureGate, "Install the correct WodeAppX build", "architecture mismatch page branding");
assertIncludes(architectureGate, "workspaces, settings, and conversations", "architecture mismatch page conversation compatibility copy");

console.log(`release contract ok: WodeAppX ${rootPackage.version}`);
