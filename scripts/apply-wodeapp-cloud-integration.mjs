#!/usr/bin/env node
/**
 * Optional WodeApp Cloud patches: login + desktop-bootstrap + platform ai/v1 provider.
 * NOT applied in OSS default flow — use BYOK in OpenWork Settings instead.
 *
 * Run after bootstrap-openwork.mjs:
 *   node scripts/apply-wodeapp-cloud-integration.mjs
 */
import { copyFile, cp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const vendor = path.join(root, "vendor/openwork");
const cloud = path.join(root, "integrations/wodeapp-cloud");
const electronCloud = path.join(vendor, "apps/desktop/electron/wodeapp-cloud");

const PATCHES = [
  {
    file: path.join(vendor, "apps/desktop/electron/main.mjs"),
    marker: "WODEAPP_CLOUD_INTEGRATION",
    blocks: [
      {
        insertAfter: 'import { createWorkspaceStore } from "./workspace-store.mjs";',
        content: `// WODEAPP_CLOUD_INTEGRATION
import {
  prepareWodeAppBrowserSession,
  prepareWodeAppProviderForStartup,
  registerWodeAppAuthIpc,
  WODEAPP_BROWSER_SESSION_PARTITION,
} from "./wodeapp-cloud/wodeapp-auth-ipc.mjs";
import { registerWodeAppLocalAssetsIpc } from "./wodeapp-cloud/wodeapp-local-assets-ipc.mjs";`,
      },
      {
        insertAfter: 'ipcMain.handle("openwork:desktop", handleDesktopInvoke);',
        content: `// WODEAPP_CLOUD_INTEGRATION
registerWodeAppAuthIpc({
  readOpencodeConfig,
  writeOpencodeConfig,
  getBrowserSession: () => session.fromPartition(WODEAPP_BROWSER_SESSION_PARTITION),
});
registerWodeAppLocalAssetsIpc();`,
      },
    ],
  },
  {
    file: path.join(vendor, "apps/desktop/electron/preload.mjs"),
    marker: "WODEAPP_CLOUD_INTEGRATION",
    blocks: [
      {
        insertAfter: `    ackSnapshot() {
      return ipcRenderer.invoke("openwork:migration:ack");
    },
  },`,
        content: `  // WODEAPP_CLOUD_INTEGRATION
  wodeappAuth: {
    invoke(action, payload) {
      return ipcRenderer.invoke("wodeapp:auth", action, payload);
    },
  },
  wodeappAssets: {
    invoke(action, payload) {
      return ipcRenderer.invoke("wodeapp:assets", action, payload);
    },
  },`,
      },
    ],
  },
];

async function applyFilePatches(spec) {
  let content = await readFile(spec.file, "utf8");
  const normalized = content
    .replaceAll(
      '../../../../../integrations/wodeapp-cloud/electron/wodeapp-auth-ipc.mjs',
      './wodeapp-cloud/wodeapp-auth-ipc.mjs',
    )
    .replaceAll(
      '../../../../../integrations/wodeapp-cloud/electron/wodeapp-local-assets-ipc.mjs',
      './wodeapp-cloud/wodeapp-local-assets-ipc.mjs',
    );
  if (normalized !== content) {
    content = normalized;
    await writeFile(spec.file, content, "utf8");
    console.log("normalized cloud imports:", path.relative(root, spec.file));
  }
  if (content.includes(spec.marker)) {
    console.log("skip (already patched):", path.relative(root, spec.file));
    return;
  }
  for (const block of spec.blocks) {
    if (!content.includes(block.insertAfter)) {
      throw new Error(`Anchor not found in ${spec.file}`);
    }
    content = content.replace(block.insertAfter, `${block.insertAfter}\n${block.content}`);
  }
  await writeFile(spec.file, content, "utf8");
  console.log("patched:", path.relative(root, spec.file));
}

async function applyDesktopLocalFileBridgePatch() {
  const preloadFile = path.join(vendor, "apps/desktop/electron/preload.mjs");
  let preload = await readFile(preloadFile, "utf8");
  let preloadChanged = false;
  if (preload.includes('import { contextBridge, ipcRenderer } from "electron";')) {
    preload = preload.replace(
      'import { contextBridge, ipcRenderer } from "electron";',
      'import { contextBridge, ipcRenderer, webUtils } from "electron";',
    );
    preloadChanged = true;
  } else if (
    preload.includes('import { contextBridge, ipcRenderer, webUtils } from "electron";') === false
    && preload.includes("webUtils") === false
    && /from\s+"electron"/.test(preload)
  ) {
    // Keep patch idempotent when import order already diverged.
    preload = preload.replace(
      /import\s*\{\s*contextBridge\s*,\s*ipcRenderer\s*\}\s*from\s*"electron"\s*;/,
      'import { contextBridge, ipcRenderer, webUtils } from "electron";',
    );
    preloadChanged = true;
  }

  if (!preload.includes('from "node:fs"') && !preload.includes("from 'node:fs'")) {
    preload = preload.replace(
      'import { contextBridge, ipcRenderer, webUtils } from "electron";',
      'import { contextBridge, ipcRenderer, webUtils } from "electron";\nimport { statSync } from "node:fs";',
    );
    preloadChanged = true;
  }

  const filesBridgeBlock = `  files: {
    getPathForFile(file) {
      try {
        return webUtils.getPathForFile(file) || "";
      } catch {
        return "";
      }
    },
    readAsDataUrl(file, mimeType) {
      let filePath = "";
      try {
        filePath = webUtils.getPathForFile(file) || "";
      } catch {
        filePath = "";
      }
      if (!filePath) return Promise.resolve(null);
      return ipcRenderer.invoke("openwork:desktop", "__readSelectedFileAsDataUrl", filePath, mimeType);
    },
    readPathAsDataUrl(filePath, mimeType) {
      const normalizedPath = String(filePath ?? "").trim();
      if (!normalizedPath) return Promise.resolve(null);
      return ipcRenderer.invoke("openwork:desktop", "__readSelectedFileAsDataUrl", normalizedPath, mimeType);
    },
    statLocalPath(filePath) {
      const normalizedPath = String(filePath ?? "").trim();
      if (!normalizedPath) return null;
      try {
        const st = statSync(normalizedPath);
        if (!st.isFile()) return null;
        return { size: st.size, mtimeMs: st.mtimeMs };
      } catch {
        return null;
      }
    },
  },`;

  const statLocalPathBlock = `    statLocalPath(filePath) {
      const normalizedPath = String(filePath ?? "").trim();
      if (!normalizedPath) return null;
      try {
        const st = statSync(normalizedPath);
        if (!st.isFile()) return null;
        return { size: st.size, mtimeMs: st.mtimeMs };
      } catch {
        return null;
      }
    },`;

  if (!preload.includes("readAsDataUrl(file, mimeType)")) {
    const anchor = "  // WODEAPP_CLOUD_INTEGRATION";
    if (!preload.includes(anchor)) {
      throw new Error(`Desktop file bridge anchor not found in ${preloadFile}`);
    }
    preload = preload.replace(anchor, `${filesBridgeBlock}\n${anchor}`);
    preloadChanged = true;
  } else if (!preload.includes("readPathAsDataUrl(filePath, mimeType)")) {
    // Older builds exposed File-only reads; Agent absolute paths need path reads too.
    if (!preload.includes("readAsDataUrl(file, mimeType) {")) {
      throw new Error(`Desktop files.readAsDataUrl bridge shape unexpected in ${preloadFile}`);
    }
    preload = preload.replace(
      /readAsDataUrl\(file, mimeType\) \{\n[\s\S]*?\n    \},/,
      (match) => `${match}\n    readPathAsDataUrl(filePath, mimeType) {
      const normalizedPath = String(filePath ?? "").trim();
      if (!normalizedPath) return Promise.resolve(null);
      return ipcRenderer.invoke("openwork:desktop", "__readSelectedFileAsDataUrl", normalizedPath, mimeType);
    },`,
    );
    if (!preload.includes("readPathAsDataUrl(filePath, mimeType)")) {
      throw new Error(`Failed to add readPathAsDataUrl bridge in ${preloadFile}`);
    }
    preloadChanged = true;
  }

  if (preload.includes("readPathAsDataUrl(filePath, mimeType)") && !preload.includes("statLocalPath(filePath)")) {
    preload = preload.replace(
      /readPathAsDataUrl\(filePath, mimeType\) \{\n[\s\S]*?\n    \},/,
      (match) => `${match}\n${statLocalPathBlock}`,
    );
    if (!preload.includes("statLocalPath(filePath)")) {
      throw new Error(`Failed to add files.statLocalPath bridge in ${preloadFile}`);
    }
    preloadChanged = true;
  }

  if (preloadChanged) {
    await writeFile(preloadFile, preload, "utf8");
    console.log("patched:", path.relative(root, preloadFile));
  }

  const mainFile = path.join(vendor, "apps/desktop/electron/main.mjs");
  let main = await readFile(mainFile, "utf8");
  if (!main.includes('"__readSelectedFileAsDataUrl"')) {
    const anchor = `  "__fetch": async (event, ...args) => {`;
    if (!main.includes(anchor)) {
      throw new Error(`Desktop selected-file reader anchor not found in ${mainFile}`);
    }
    main = main.replace(anchor, `  "__readSelectedFileAsDataUrl": async (_event, ...args) => {
      const filePath = String(args[0] ?? "").trim();
      const requestedMime = String(args[1] ?? "").trim().toLowerCase();
      if (!filePath) throw new Error("Selected file path is required.");
      const info = await stat(filePath);
      if (!info.isFile()) throw new Error("Selected attachment is not a file.");
      const maxBytes = 60 * 1024 * 1024;
      if (info.size > maxBytes) throw new Error("Selected attachment exceeds the 60 MB desktop read limit.");
      const mimeType = /^[a-z0-9][a-z0-9_.+-]*\\/[a-z0-9][a-z0-9_.+-]*$/i.test(requestedMime)
        ? requestedMime
        : "application/octet-stream";
      const data = await readFile(filePath);
      return \`data:\${mimeType};base64,\${data.toString("base64")}\`;
  },
${anchor}`);
    await writeFile(mainFile, main, "utf8");
    console.log("patched:", path.relative(root, mainFile));
  }
}

async function applyDesktopStartupProviderPatch() {
  const file = path.join(vendor, "apps/desktop/electron/main.mjs");
  let content = await readFile(file, "utf8");
  let changed = false;

  const authImportPattern = /import\s*\{[^}]*registerWodeAppAuthIpc[^}]*\}\s*from\s*"\.\/wodeapp-cloud\/wodeapp-auth-ipc\.mjs";/s;
  const nextImport = `import {
  prepareWodeAppBrowserSession,
  prepareWodeAppProviderForStartup,
  registerWodeAppAuthIpc,
  WODEAPP_BROWSER_SESSION_PARTITION,
} from "./wodeapp-cloud/wodeapp-auth-ipc.mjs";`;
  if (authImportPattern.test(content)) {
    const next = content.replace(authImportPattern, nextImport);
    changed ||= next !== content;
    content = next;
  } else if (!content.includes(nextImport)) {
    throw new Error(`WodeApp auth import anchor not found in ${file}`);
  }

  const oldAuthRegistration = "registerWodeAppAuthIpc({ readOpencodeConfig, writeOpencodeConfig });";
  const nextAuthRegistration = `registerWodeAppAuthIpc({
  readOpencodeConfig,
  writeOpencodeConfig,
  getBrowserSession: () => session.fromPartition(WODEAPP_BROWSER_SESSION_PARTITION),
});`;
  if (content.includes(oldAuthRegistration)) {
    content = content.replace(oldAuthRegistration, nextAuthRegistration);
    changed = true;
  } else if (
    content.includes("registerWodeAppAuthIpc({")
    && !content.includes("getBrowserSession: () => session.fromPartition(WODEAPP_BROWSER_SESSION_PARTITION)")
  ) {
    throw new Error(`WodeApp auth registration anchor not found in ${file}`);
  }

  const oldStartupBlock = `      // WODEAPP_STARTUP_PROVIDER_READY
      // Persist the authenticated WodeApp provider before OpenCode reads its
      // startup config, so the first prompt cannot be sent as a guest.
      const startupProvider = await prepareWodeAppProviderForStartup(
        win.webContents.session,
        { readOpencodeConfig, writeOpencodeConfig },
      ).catch((error) => {
        console.warn("[wodeapp] startup provider preparation failed:", error);
        return null;
      });
      if (startupProvider && (!startupProvider.ok || !startupProvider.signedIn)) {
        console.warn("[wodeapp] startup provider is not authenticated");
      }

`;
  if (content.includes(oldStartupBlock)) {
    content = content.replace(oldStartupBlock, "");
    changed = true;
  }

  if (!content.includes("WODEAPP_STARTUP_PROVIDER_READY")) {
    const anchor = "    applicationMenu.install();";
    if (!content.includes(anchor)) {
      throw new Error(`Desktop startup window anchor not found in ${file}`);
    }
    const insert = `${anchor}
    // WODEAPP_STARTUP_PROVIDER_READY
    // Finish identity bootstrap before the renderer exists. The renderer can
    // request runtimeBootstrap as soon as it loads, so doing this after
    // createMainWindow still leaves a first-request guest race.
    const startupProvider = await prepareWodeAppProviderForStartup(
      session.defaultSession,
      { readOpencodeConfig, writeOpencodeConfig },
    ).catch((error) => {
      console.warn("[wodeapp] startup provider preparation failed:", error);
      return null;
    });
    if (startupProvider && (!startupProvider.ok || !startupProvider.signedIn)) {
      console.warn("[wodeapp] startup provider is not authenticated");
    }

`;
    content = content.replace(anchor, insert);
    changed = true;
  }

  if (!content.includes("WODEAPP_BROWSER_SESSION_READY")) {
    const anchor = `    if (startupProvider && (!startupProvider.ok || !startupProvider.signedIn)) {
      console.warn("[wodeapp] startup provider is not authenticated");
    }
`;
    if (!content.includes(anchor)) {
      throw new Error(`Desktop browser-session startup anchor not found in ${file}`);
    }
    const insert = `${anchor}
    // WODEAPP_BROWSER_SESSION_READY
    // The built-in browser deliberately uses an isolated persistent partition.
    // Mirror the signed-in first-column account into that partition before any
    // WodeApp workbench page can issue a credit-gated request.
    const browserSessionAuth = await prepareWodeAppBrowserSession(
      session.fromPartition(WODEAPP_BROWSER_SESSION_PARTITION),
    ).catch((error) => {
      console.warn("[wodeapp] built-in browser session preparation failed:", error);
      return null;
    });
    if (browserSessionAuth && (!browserSessionAuth.ok || !browserSessionAuth.signedIn)) {
      console.warn("[wodeapp] built-in browser session is not authenticated");
    }
`;
    content = content.replace(anchor, insert);
    changed = true;
  }

  if (changed) {
    await writeFile(file, content, "utf8");
    console.log("patched:", path.relative(root, file));
  } else {
    console.log("skip (already patched):", path.relative(root, file));
  }
}

// welcome-route + provider-selection-step patches (same as former apply-openwork-integration)
function insertAfterIfMissing(content, { marker, anchor, insert }) {
  if (content.includes(marker)) return { content, changed: false };
  if (!content.includes(anchor)) throw new Error(`Insert anchor not found: ${anchor}`);
  return { content: content.replace(anchor, `${anchor}\n${insert}`), changed: true };
}

function replaceAnyOrKeep(content, { variants, to }) {
  for (const from of variants) {
    if (content.includes(from)) return { content: content.replace(from, to), changed: true };
  }
  if (content.includes(to)) return { content, changed: false };
  throw new Error(`Replacement anchors not found`);
}

function replaceCallbackBeforeReturn(content, callbackName, callbackSource) {
  const startToken = `  const ${callbackName} = useCallback(`;
  const returnToken = "\n  return (\n";
  const start = content.indexOf(startToken);
  const returnIndex = content.indexOf(returnToken);
  if (returnIndex === -1) throw new Error("WelcomeRoute return anchor not found");
  if (start === -1) {
    return {
      content: content.slice(0, returnIndex) + `\n${callbackSource}\n` + content.slice(returnIndex),
      changed: true,
    };
  }
  if (start > returnIndex) throw new Error(`${callbackName} appears after WelcomeRoute return`);
  const next = content.slice(0, start) + callbackSource + content.slice(returnIndex);
  return { content: next, changed: next !== content };
}

async function applyWelcomeRoutePatch() {
  const file = path.join(vendor, "apps/app/src/react-app/shell/welcome-route.tsx");
  let content = await readFile(file, "utf8");
  let changed = false;

  for (const step of [
    {
      marker: 'from "../../app/lib/wodeapp-auth"',
      anchor: 'import { ensureDesktopLocalOpenworkConnection } from "./desktop-local-openwork";',
      insert: 'import { isWodeAppAuthAvailable, signInWithWodeApp } from "../../app/lib/wodeapp-auth";',
    },
    {
      marker: 'from "../domains/wodeapp/wodeapp-cloud-region"',
      anchor: 'import { isWodeAppAuthAvailable, signInWithWodeApp } from "../../app/lib/wodeapp-auth";',
      insert: `import { WodeAppCloudRegionDialog } from "../domains/wodeapp/wodeapp-cloud-region-dialog";
import {
  originForCloudRegion,
  writeStoredCloudRegion,
  type WodeAppCloudRegion,
} from "../domains/wodeapp/wodeapp-cloud-region";`,
    },
    {
      marker: "const [wodeAppBusy, setWodeAppBusy]",
      anchor: '  const [manualFolder, setManualFolder] = useState("");',
      insert: '  const [wodeAppBusy, setWodeAppBusy] = useState(false);\n  const [wodeAppError, setWodeAppError] = useState<string | null>(null);',
    },
    {
      marker: "const [regionDialogOpen, setRegionDialogOpen]",
      anchor: '  const [wodeAppError, setWodeAppError] = useState<string | null>(null);',
      insert: '  const [regionDialogOpen, setRegionDialogOpen] = useState(false);',
    },
  ]) {
    const r = insertAfterIfMissing(content, step);
    content = r.content;
    changed ||= r.changed;
  }

  for (const replacement of [
    {
      variants: [
        `        markOnboardingComplete();
        dispatch({ type: "close" });
        // Show the provider selection step before navigating to the session.
        dispatch({ type: "provider-step", workspaceId: targetWorkspaceId, sessionId: targetSessionId });`,
      ],
      to: `        dispatch({ type: "close" });
        // Show the provider selection step before navigating to the session.
        dispatch({ type: "provider-step", workspaceId: targetWorkspaceId, sessionId: targetSessionId });`,
    },
    {
      variants: [
        `  const finishOnboarding = useCallback(() => {
    navigate(state.pendingRoute ?? "/session", { replace: true });
    if (state.pendingSessionId) focusPromptSoon();
  }, [navigate, state.pendingRoute, state.pendingSessionId]);`,
        `  const finishOnboarding = useCallback(() => {
    markOnboardingComplete();
    navigate(state.pendingRoute ?? "/session", { replace: true });
    if (state.pendingSessionId) focusPromptSoon();
  }, [markOnboardingComplete, navigate, state.pendingRoute, state.pendingSessionId]);`,
      ],
      to: `  const finishOnboarding = useCallback((route?: string) => {
    markOnboardingComplete();
    navigate(route ?? state.pendingRoute ?? "/session", { replace: true });
    if (state.pendingSessionId) focusPromptSoon();
  }, [markOnboardingComplete, navigate, state.pendingRoute, state.pendingSessionId]);`,
    },
  ]) {
    const r = replaceAnyOrKeep(content, replacement);
    content = r.content;
    changed ||= r.changed;
  }

  const handleWodeAppSignIn = `  const completeWodeAppSignIn = useCallback(async (region: WodeAppCloudRegion) => {
    if (!isWodeAppAuthAvailable()) {
      setWodeAppError("WodeApp sign-in is only available in the desktop app.");
      return;
    }
    setWodeAppBusy(true);
    setWodeAppError(null);
    writeStoredCloudRegion(region);
    try {
      const result = await signInWithWodeApp(originForCloudRegion(region));
      if (!result.ok) {
        setWodeAppError(result.error);
        return;
      }
      if (!result.signedIn || !result.config) {
        setWodeAppError("WodeApp sign-in did not return a usable model provider.");
        return;
      }
      local.setPrefs((previous) => ({
        ...previous,
        defaultModel: {
          providerID: result.config.providerId,
          modelID: result.config.defaultModelId,
        },
        modelVariant: null,
      }));
      try {
        window.dispatchEvent(new CustomEvent("openwork-server-settings-changed"));
      } catch {
        // ignore
      }
      const route = state.pendingWorkspaceId
        ? workspaceSessionRoute(state.pendingWorkspaceId, state.pendingSessionId)
        : "/session";
      finishOnboarding(route);
    } finally {
      setWodeAppBusy(false);
    }
  }, [finishOnboarding, local, state.pendingSessionId, state.pendingWorkspaceId]);

  const handleWodeAppSignIn = useCallback(() => {
    if (!isWodeAppAuthAvailable()) {
      setWodeAppError("WodeApp sign-in is only available in the desktop app.");
      return;
    }
    setWodeAppError(null);
    setRegionDialogOpen(true);
  }, []);
`;

  {
    const startName = content.includes("const completeWodeAppSignIn = useCallback(")
      ? "completeWodeAppSignIn"
      : "handleWodeAppSignIn";
    const r = replaceCallbackBeforeReturn(content, startName, handleWodeAppSignIn);
    content = r.content;
    changed ||= r.changed;
  }

  {
    const r = insertAfterIfMissing(content, {
      marker: "<WodeAppCloudRegionDialog",
      anchor: "  return (\n    <>\n",
      insert: `      <WodeAppCloudRegionDialog
        open={regionDialogOpen}
        onClose={() => setRegionDialogOpen(false)}
        onPick={(region) => {
          setRegionDialogOpen(false);
          void completeWodeAppSignIn(region);
        }}
      />
`,
    });
    content = r.content;
    changed ||= r.changed;
  }

  {
    const r = insertAfterIfMissing(content, {
      marker: "onWodeAppSignIn={isDesktopRuntime() && isWodeAppAuthAvailable() ? handleWodeAppSignIn : undefined}",
      anchor: `        <ProviderSelectionStep`,
      insert: `          onWodeAppSignIn={isDesktopRuntime() && isWodeAppAuthAvailable() ? handleWodeAppSignIn : undefined}
          wodeAppBusy={wodeAppBusy}
          wodeAppError={wodeAppError}`,
    });
    content = r.content;
    changed ||= r.changed;
  }

  if (changed) {
    await writeFile(file, content, "utf8");
    console.log("patched:", path.relative(root, file));
  } else {
    console.log("skip (already patched):", path.relative(root, file));
  }
}

async function applyProviderSelectionStepPatch() {
  const file = path.join(vendor, "apps/app/src/react-app/domains/onboarding/provider-selection-step.tsx");
  let content = await readFile(file, "utf8");
  let changed = false;

  if (!content.includes("UserRoundIcon")) {
    content = content.replace(
      'import { KeyRoundIcon, SkipForwardIcon, SparklesIcon } from "lucide-react";',
      'import { KeyRoundIcon, SkipForwardIcon, SparklesIcon, UserRoundIcon } from "lucide-react";',
    );
    changed = true;
  }

  const replacements = [
    {
      from: `  onBringYourOwn: () => void;
  onSkip: () => void;`,
      to: `  onBringYourOwn: () => void;
  onWodeAppSignIn?: () => void;
  wodeAppBusy?: boolean;
  wodeAppError?: string | null;
  onSkip: () => void;`,
    },
    {
      from: `  onBringYourOwn,
  onSkip,`,
      to: `  onBringYourOwn,
  onWodeAppSignIn,
  wodeAppBusy = false,
  wodeAppError = null,
  onSkip,`,
    },
  ];

  for (const { from, to } of replacements) {
    if (content.includes(from)) {
      content = content.replace(from, to);
      changed = true;
    } else if (!content.includes(to.split("\n")[0])) {
      throw new Error(`ProviderSelectionStep anchor missing: ${from.slice(0, 60)}`);
    }
  }

  {
    const r = insertAfterIfMissing(content, {
      marker: "onWodeAppSignIn ? (",
      anchor: `        <div className="space-y-3">`,
      insert: `          {onWodeAppSignIn ? (
            <button
              type="button"
              className="flex w-full items-start gap-4 rounded-xl border border-emerald-7/50 bg-emerald-2/30 p-4 text-left transition-colors hover:bg-emerald-3/40 disabled:opacity-60"
              onClick={onWodeAppSignIn}
              disabled={wodeAppBusy}
            >
              <UserRoundIcon className="mt-0.5 size-5 shrink-0 text-emerald-10" />
              <div>
                <div className="text-sm font-medium text-foreground">Sign in with WodeApp</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  WodeApp Cloud account and platform model credits (optional product build).
                </div>
                {wodeAppError ? (
                  <div className="mt-2 text-xs text-destructive">{wodeAppError}</div>
                ) : null}
              </div>
            </button>
          ) : null}
`,
    });
    content = r.content;
    changed ||= r.changed;
  }

  {
    // WodeAppX：永久删除 OpenWork Models 订阅入口；BYOK 保留。幂等。
    const r = replaceAnyOrKeep(content, {
      variants: [
        `          <button
            type="button"
            className="flex w-full items-start gap-4 rounded-xl border border-blue-7/50 bg-blue-2/30 p-4 text-left transition-colors hover:bg-blue-3/40"
            onClick={onOpenWorkModels}
          >
            <SparklesIcon className="mt-0.5 size-5 shrink-0 text-blue-10" />
            <div>
              <div className="text-sm font-medium text-foreground">
                Use OpenWork Models
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Pay through OpenWork Cloud and skip API key setup.
              </div>
            </div>
          </button>

          <button
            type="button"
            className="flex w-full items-start gap-4 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent"
            onClick={onBringYourOwn}
          >
            <KeyRoundIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium text-foreground">
                Bring your own API key
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Connect OpenAI, Anthropic, Google, or another provider, then run your first task.
              </div>
            </div>
          </button>`,
        `          {/* WodeAppX: 隐藏 OpenWork Models（OpenWork Cloud）——有 WodeApp 登录时不展示；
              "Bring your own API key"（用户自带 key / BYOK）始终保留。 */}
          {!onWodeAppSignIn ? (
          <button
            type="button"
            className="flex w-full items-start gap-4 rounded-xl border border-blue-7/50 bg-blue-2/30 p-4 text-left transition-colors hover:bg-blue-3/40"
            onClick={onOpenWorkModels}
          >
            <SparklesIcon className="mt-0.5 size-5 shrink-0 text-blue-10" />
            <div>
              <div className="text-sm font-medium text-foreground">
                Use OpenWork Models
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Pay through OpenWork Cloud and skip API key setup.
              </div>
            </div>
          </button>
          ) : null}

          <button
            type="button"
            className="flex w-full items-start gap-4 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent"
            onClick={onBringYourOwn}
          >
            <KeyRoundIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium text-foreground">
                Bring your own API key
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Connect OpenAI, Anthropic, Google, or another provider, then run your first task.
              </div>
            </div>
          </button>`,
        `          {/* 我的AppX: 隐藏 OpenWork Models（OpenWork Cloud）——有 WodeApp 登录时不展示；
              "Bring your own API key"（用户自带 key / BYOK）始终保留。 */}
          {!onWodeAppSignIn ? (
          <button
            type="button"
            className="flex w-full items-start gap-4 rounded-xl border border-blue-7/50 bg-blue-2/30 p-4 text-left transition-colors hover:bg-blue-3/40"
            onClick={onOpenWorkModels}
          >
            <SparklesIcon className="mt-0.5 size-5 shrink-0 text-blue-10" />
            <div>
              <div className="text-sm font-medium text-foreground">
                Use OpenWork Models
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Pay through OpenWork Cloud and skip API key setup.
              </div>
            </div>
          </button>
          ) : null}

          <button
            type="button"
            className="flex w-full items-start gap-4 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent"
            onClick={onBringYourOwn}
          >
            <KeyRoundIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium text-foreground">
                Bring your own API key
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Connect OpenAI, Anthropic, Google, or another provider, then run your first task.
              </div>
            </div>
          </button>`,
      ],
      to: `          {/* WodeAppX：永久移除 OpenWork Models 订阅入口。BYOK 保留。 */}

          <button
            type="button"
            className="flex w-full items-start gap-4 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:bg-accent"
            onClick={onBringYourOwn}
          >
            <KeyRoundIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div>
              <div className="text-sm font-medium text-foreground">
                Bring your own API key
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Connect OpenAI, Anthropic, Google, or another provider, then run your first task.
              </div>
            </div>
          </button>`,
      already: ["WodeAppX：永久移除 OpenWork Models 订阅入口"],
    });
    content = r.content;
    changed ||= r.changed;
  }

  if (changed) {
    await writeFile(file, content, "utf8");
    console.log("patched:", path.relative(root, file));
  } else {
    console.log("skip (already patched):", path.relative(root, file));
  }
}



async function applyWebCreditFetchPatch() {
  const file = path.join(vendor, "apps/app/src/app/lib/opencode.ts");
  let content = await readFile(file, "utf8");
  let changed = false;

  if (!content.includes("peekWebApiKey")) {
    const needle = 'import { createOpencodeClient,';
    const idx = content.indexOf(needle);
    if (idx < 0) throw new Error("opencode createOpencodeClient import missing");
    content = `import { peekWebApiKey } from "@/app/lib/wodeapp-auth";\n` + content;
    changed = true;
  }

  if (!content.includes("createWebCreditFetch")) {
    const from = `  const fetchImpl = isDesktopRuntime()
    ? createDesktopFetch(auth)
    : (input: RequestInfo | URL, init?: RequestInit) =>
        fetchWithTimeout(globalThis.fetch, input, init, DEFAULT_OPENCODE_REQUEST_TIMEOUT_MS);`;
    const to = `  const fetchImpl = isDesktopRuntime()
    ? createDesktopFetch(auth)
    : createWebCreditFetch();`;
    if (!content.includes(from)) throw new Error("opencode fetchImpl block missing");
    content = content.replace(from, to);
    const helperFn = `
const WEB_OPENCODE_REQUEST_TIMEOUT_MS = 30_000;
function createWebCreditFetch() {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(input instanceof Request ? input.headers : init?.headers);
    const apiKey = peekWebApiKey();
    if (apiKey && !headers.has("X-API-Key")) headers.set("X-API-Key", apiKey);
    const url = String(input instanceof Request ? input.url : input);
    const sessionMatch = url.match(/session\\/(ses_[A-Za-z0-9]+)/);
    if (apiKey && sessionMatch) {
      try {
        await fetch("/wodeappx-credits/bind", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sessionMatch[1], apiKey }),
        });
      } catch {
        // ignore bind failures; the model call will 401 if the key never arrived
      }
    }
    if (input instanceof Request) {
      return fetchWithTimeout(globalThis.fetch, new Request(input, { headers }), undefined, WEB_OPENCODE_REQUEST_TIMEOUT_MS);
    }
    return fetchWithTimeout(globalThis.fetch, input, { ...init, headers }, WEB_OPENCODE_REQUEST_TIMEOUT_MS);
  };
}

`;
    content = content.replace("export function createClient(", helperFn + "export function createClient(");
    changed = true;
  }

  if (content.includes("function createWebCreditFetch()") && !content.includes("WEB_OPENCODE_REQUEST_TIMEOUT_MS")) {
    content = content.replace(
      "function createWebCreditFetch() {",
      "const WEB_OPENCODE_REQUEST_TIMEOUT_MS = 30_000;\nfunction createWebCreditFetch() {",
    );
    content = content.replaceAll(
      "fetchWithTimeout(globalThis.fetch, new Request(input, { headers }), undefined, DEFAULT_OPENCODE_REQUEST_TIMEOUT_MS)",
      "fetchWithTimeout(globalThis.fetch, new Request(input, { headers }), undefined, WEB_OPENCODE_REQUEST_TIMEOUT_MS)",
    );
    content = content.replaceAll(
      "fetchWithTimeout(globalThis.fetch, input, { ...init, headers }, DEFAULT_OPENCODE_REQUEST_TIMEOUT_MS)",
      "fetchWithTimeout(globalThis.fetch, input, { ...init, headers }, WEB_OPENCODE_REQUEST_TIMEOUT_MS)",
    );
    changed = true;
  }

  if (changed) {
    await writeFile(file, content, "utf8");
    console.log("patched web credit fetch");
  } else {
    console.log("skip (already patched): web credit fetch");
  }
}


async function applyWebForceOpenworkUrlPatch() {
  const connectionFile = path.join(vendor, "apps/app/src/react-app/shell/openwork-connection.ts");
  let connection = await readFile(connectionFile, "utf8");
  let connectionChanged = false;
  if (!connection.includes('import { isWebDeployment }')) {
    const needle = 'import { isDesktopRuntime } from "../../app/utils";';
    if (!connection.includes(needle)) throw new Error("openwork-connection desktop import missing");
    connection = connection.replace(
      needle,
      'import { isWebDeployment } from "../../app/lib/openwork-deployment";\nimport { isDesktopRuntime } from "../../app/utils";',
    );
    connectionChanged = true;
  }
  const webGate = `  if (isWebDeployment()) {
    const envUrl =
      typeof import.meta.env?.VITE_OPENWORK_URL === "string"
        ? import.meta.env.VITE_OPENWORK_URL.trim()
        : "";
    const envToken =
      typeof import.meta.env?.VITE_OPENWORK_TOKEN === "string"
        ? import.meta.env.VITE_OPENWORK_TOKEN.trim()
        : "";
    const settings = readOpenworkServerSettings();
    const normalizedBaseUrl = normalizeOpenworkServerUrl(envUrl || settings.urlOverride || "") ?? "";
    const resolvedToken = (envToken || settings.token || "").trim();
    if (hasUsableConnection(normalizedBaseUrl, resolvedToken)) {
      return {
        normalizedBaseUrl,
        resolvedToken,
        resolvedHostToken: "",
        hostInfo: null,
        source: "stored-settings",
      };
    }
  }

`;
  if (!connection.includes("if (isWebDeployment()) {")) {
    const anchor = `  const settings = readOpenworkServerSettings();
  const normalizedBaseUrl = normalizeOpenworkServerUrl(settings.urlOverride ?? "") ?? "";`;
    if (!connection.includes(anchor)) throw new Error("openwork-connection stored-settings anchor missing");
    connection = connection.replace(anchor, webGate + anchor);
    connectionChanged = true;
  }
  if (connectionChanged) {
    await writeFile(connectionFile, connection, "utf8");
    console.log("patched web force openwork url (connection)");
  } else {
    console.log("skip (already patched): web force openwork url (connection)");
  }

  const settingsFile = path.join(vendor, "apps/app/src/app/lib/openwork-server.ts");
  let settings = await readFile(settingsFile, "utf8");
  let settingsChanged = false;
  if (!settings.includes('import { isWebDeployment }')) {
    const needle = 'import { isDesktopRuntime } from "./runtime-env";';
    if (!settings.includes(needle)) throw new Error("openwork-server runtime-env import missing");
    settings = settings.replace(
      needle,
      'import { isDesktopRuntime } from "./runtime-env";\nimport { isWebDeployment } from "./openwork-deployment";',
    );
    settingsChanged = true;
  }
  const hydrateFrom = `    if (!current.urlOverride && envUrl) {
      next.urlOverride = normalizeOpenworkServerUrl(envUrl) ?? undefined;
      changed = true;
    }`;
  const hydrateTo = `    if (envUrl && (!current.urlOverride || isWebDeployment())) {
      next.urlOverride = normalizeOpenworkServerUrl(envUrl) ?? undefined;
      changed = true;
    }`;
  if (settings.includes(hydrateFrom)) {
    settings = settings.replace(hydrateFrom, hydrateTo);
    settingsChanged = true;
  }
  const tokenFrom = `    if (!current.token && envToken) {
      next.token = envToken;
      changed = true;
    }`;
  const tokenTo = `    if (envToken && (!current.token || isWebDeployment())) {
      next.token = envToken;
      changed = true;
    }`;
  if (settings.includes(tokenFrom)) {
    settings = settings.replace(tokenFrom, tokenTo);
    settingsChanged = true;
  }
  if (settingsChanged) {
    await writeFile(settingsFile, settings, "utf8");
    console.log("patched web force openwork url (hydrate)");
  } else {
    console.log("skip (already patched): web force openwork url (hydrate)");
  }
}

async function applyRelativeOpenworkUrlPatch() {
  const file = path.join(vendor, "apps/app/src/react-app/kernel/server-provider.tsx");
  let content = await readFile(file, "utf8");
  const from = `export function normalizeServerUrl(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return;
  const withProtocol = /^https?:\\/\\//.test(trimmed) ? trimmed : \`http://\${trimmed}\`;
  return withProtocol.replace(/\\/+$/, "");
}`;
  const to = `export function normalizeServerUrl(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return;
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    const origin =
      typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
    return \`\${origin}\${trimmed}\`.replace(/\\/+$/, "") || trimmed.replace(/\\/+$/, "");
  }
  const withProtocol = /^https?:\\/\\//.test(trimmed) ? trimmed : \`http://\${trimmed}\`;
  return withProtocol.replace(/\\/+$/, "");
}`;
  if (content.includes('trimmed.startsWith("/") && !trimmed.startsWith("//")')) {
    console.log("skip (already patched): relative openwork url");
    return;
  }
  if (!content.includes(from)) throw new Error("normalizeServerUrl block missing");
  await writeFile(file, content.replace(from, to), "utf8");
  console.log("patched relative openwork url");
}

async function applyWebAuthSetGuard() {
  const file = path.join(vendor, "apps/app/src/react-app/shell/session-route.tsx");
  let content = await readFile(file, "utf8");
  let changed = false;
  const replacements = [
    [
      `    if (!shellConfig.wodeappWorkbench) return;
    if (!isWodeAppAuthAvailable()) return;
    if (!opencodeClient?.auth?.set) return;`,
      `    if (!shellConfig.wodeappWorkbench) return;
    if (isWebDeployment()) return;
    if (!isWodeAppAuthAvailable()) return;
    if (!opencodeClient?.auth?.set) return;`,
    ],
    [
      `        if (creds?.apiKey && opencodeClient) {
          try {
            await opencodeClient.auth.set({
              providerID: WODEAPP_PROVIDER_ID,
              auth: { type: "api", key: creds.apiKey },
            });`,
      `        if (creds?.apiKey && opencodeClient && !isWebDeployment()) {
          try {
            await opencodeClient.auth.set({
              providerID: WODEAPP_PROVIDER_ID,
              auth: { type: "api", key: creds.apiKey },
            });`,
    ],
    [
      `          if (ready.mode === "cloud") {
            const creds = await getWodeAppApiCredentials();
            if (creds?.apiKey && opencodeClient?.auth?.set) {`,
      `          if (ready.mode === "cloud" && !isWebDeployment()) {
            const creds = await getWodeAppApiCredentials();
            if (creds?.apiKey && opencodeClient?.auth?.set) {`,
    ],
  ];
  for (const [from, to] of replacements) {
    if (content.includes(to)) continue;
    if (!content.includes(from)) throw new Error("web auth.set guard anchor missing");
    content = content.replace(from, to);
    changed = true;
  }
  if (changed) {
    await writeFile(file, content, "utf8");
    console.log("patched web auth.set guard");
  } else {
    console.log("skip (already patched): web auth.set guard");
  }
}


async function applyWebNewTaskWhileLoadingPatch() {
  const file = path.join(vendor, "apps/app/src/react-app/shell/session-route.tsx");
  let content = await readFile(file, "utf8");
  const fromCan = `  const canCreateTask = Boolean(
    opencodeClient && selectedWorkspaceId && !loading && !selectedWorkspaceError && !effectiveModelUnavailable,
  );`;
  const toCan = `  const canCreateTask = Boolean(
    opencodeClient && selectedWorkspaceId && !selectedWorkspaceError && !effectiveModelUnavailable,
  );`;
  const fromCreate = `    if (
      !workspace ||
      loading ||
      retryingWorkspaceIds.includes(workspaceId)
    ) {`;
  const toCreate = `    if (
      !workspace ||
      retryingWorkspaceIds.includes(workspaceId)
    ) {`;
  let changed = false;
  if (content.includes(fromCan)) {
    content = content.replace(fromCan, toCan);
    changed = true;
  }
  if (content.includes(fromCreate)) {
    content = content.replace(fromCreate, toCreate);
    changed = true;
  }
  if (changed) {
    await writeFile(file, content, "utf8");
    console.log("patched web new-task while loading");
  } else {
    console.log("skip (already patched): web new-task while loading");
  }
}

async function applyWebDemoSessionPatches() {
  const file = path.join(vendor, "apps/app/src/react-app/shell/session-route.tsx");
  let content = await readFile(file, "utf8");
  let changed = false;

  if (!content.includes('import { isWebDeployment } from "@/app/lib/openwork-deployment";')) {
    const needle = [
      'import { t } from "@/i18n";\n',
      'import { hideEngineBrand, t } from "@/i18n";\n',
    ].find((line) => content.includes(line));
    if (!needle) throw new Error("session-route i18n import missing");
    content = content.replace(needle, needle + 'import { isWebDeployment } from "@/app/lib/openwork-deployment";\n');
    changed = true;
  }

  if (content.includes("  loadWodeAppAuthState,\n") && content.includes("wodeapp web: stay on workbench")) {
    content = content.replace("  loadWodeAppAuthState,\n", "");
    changed = true;
  }

  const firstMileStay = `    if (isWebDeployment()) {
      // wodeapp web: stay on workbench; login is opt-in
      firstMileAutoOpenedRef.current = true;
      return;
    }`;
  const firstMileAutoLogin = `    if (isWebDeployment()) {
      // wodeapp web: open cloud login
      firstMileAutoOpenedRef.current = true;
      const timer = window.setTimeout(() => {
        void loadWodeAppAuthState().then((state) => {
          if (state.ok && state.signedIn) return;
          window.dispatchEvent(new Event("wodeapp:open-login"));
        }).catch(() => {
          window.dispatchEvent(new Event("wodeapp:open-login"));
        });
      }, 400);
      return () => window.clearTimeout(timer);
    }`;
  if (content.includes(firstMileAutoLogin)) {
    content = content.replace(firstMileAutoLogin, firstMileStay);
    changed = true;
  } else if (!content.includes("wodeapp web: stay on workbench")) {
    const from = `    if (providerListSettling) return;
    if (!shouldAutoOpenFirstMile({`;
    const to = `    if (providerListSettling) return;
${firstMileStay}
    if (!shouldAutoOpenFirstMile({`;
    if (!content.includes(from)) throw new Error("session-route first-mile effect missing");
    content = content.replace(from, to);
    changed = true;
  }

  if (!content.includes("webDefaultSessionStartedRef")) {
    const from = `  }, [baseUrl, loading, navigateToWorkspaceSession, rememberPendingCreatedSession, retryingWorkspaceIds, shellConfig.wodeappWorkbench, token, workspaces]);

  const handleCreateTaskWithPrompt = useCallback(async (workspaceId: string, prompt: string | WodeAppTaskPromptInput): Promise<string | null> => {`;
    const to = `  }, [baseUrl, loading, navigateToWorkspaceSession, rememberPendingCreatedSession, retryingWorkspaceIds, shellConfig.wodeappWorkbench, token, workspaces]);

  const webDefaultSessionStartedRef = useRef(false);
  useEffect(() => {
    if (!isWebDeployment()) return;
    if (webDefaultSessionStartedRef.current) return;
    if (!canCreateTask || !selectedWorkspaceId || selectedSessionId) return;
    if (loading || selectedWorkspaceIsLoading) return;
    const sessions = sessionsByWorkspaceId[selectedWorkspaceId];
    if (!Array.isArray(sessions) || sessions.length > 0) return;
    webDefaultSessionStartedRef.current = true;
    void handleCreateTaskInWorkspace(selectedWorkspaceId);
  }, [canCreateTask, handleCreateTaskInWorkspace, loading, selectedSessionId, selectedWorkspaceId, selectedWorkspaceIsLoading, sessionsByWorkspaceId]);

  const handleCreateTaskWithPrompt = useCallback(async (workspaceId: string, prompt: string | WodeAppTaskPromptInput): Promise<string | null> => {`;
    if (!content.includes(from)) throw new Error("session-route create-task anchor missing");
    content = content.replace(from, to);
    changed = true;
  }

  if (changed) {
    await writeFile(file, content, "utf8");
    console.log("patched web demo session-route");
  } else {
    console.log("skip (already patched): web demo session-route");
  }
}


async function applyWebViteSplitPatch() {
  const file = path.join(vendor, "apps/app/vite.config.ts");
  let content = await readFile(file, "utf8");
  if (content.includes("wodeapp web split chunks v5")) {
    console.log("skip (already patched): web vite split");
    return;
  }
  const from = `  build: {
    target: "esnext",
    rollupOptions: {
      input: {
        app: resolve(appRoot, "index.html"),
        overlay: resolve(appRoot, "overlay.html"),
      },
    },
  },`;
  const fromV1 = "wodeapp web split chunks\n";
  const to = `  build: {
    target: "esnext",
    chunkSizeWarningLimit: 2000,
    modulePreload: {
      resolveDependencies(_filename: string, deps: string[]) {
        return deps.filter((dep) => {
          const name = dep.split("/").pop() || dep;
          return !name.includes("settings-") && !name.includes("desktop-extra") && !name.includes("xlsx");
        });
      },
    },
    rollupOptions: {
      // wodeapp web split chunks v5 — only core react in the react chunk
      input: process.env.VITE_OPENWORK_DEPLOYMENT === "web"
        ? { app: resolve(appRoot, "index.html") }
        : {
            app: resolve(appRoot, "index.html"),
            overlay: resolve(appRoot, "overlay.html"),
          },
      output: {
        manualChunks(id) {
          if (id.includes("shiki") || id.includes("@shikijs")) return;
          if (id.includes("node_modules")) {
            if (/(?:^|[\\/])node_modules[\\/](?:react|react-dom|scheduler)(?:[\\/]|$)/.test(id)) return "react";
            if (id.includes("react-router")) return "router";
            if (id.includes("@tanstack")) return "query";
            if (id.includes("lucide-react")) return "icons";
            if (id.includes("@radix-ui") || id.includes("/cmdk") || id.includes("/sonner")) return "ui";
            if (id.includes("xlsx") || id.includes("exceljs")) return "xlsx";
            return "vendor";
          }
          if (id.includes("/react-app/domains/settings/")) return "settings";
          if (id.includes("/markdown") || id.includes("streamdown") || id.includes("/remark-") || id.includes("/rehype-")) return "markdown";
          if (id.includes("file-tree") || id.includes("computer-use") || id.includes("/xterm")) return "desktop-extra";
        },
      },
    },
  },`;
  if (content.includes(from)) {
    content = content.replace(from, to);
  } else if (content.includes(fromV1) || content.includes("wodeapp web split chunks v3") || content.includes("wodeapp web split chunks v4")) {
    // replace the whole build block from a previous v1/v3 patch
    const startAt = content.indexOf("  build: {");
    const resolveAt = content.indexOf("  resolve: {", startAt);
    if (startAt < 0 || resolveAt < 0) throw new Error("vite build block missing for v1 upgrade");
    content = content.slice(0, startAt) + to + "\n" + content.slice(resolveAt);
  } else {
    throw new Error("vite build block missing");
  }
  await writeFile(file, content, "utf8");
  console.log("patched web vite split");
}

async function applyWebBootSplashPatch() {
  const file = path.join(vendor, "apps/app/index.html");
  let content = await readFile(file, "utf8");
  if (content.includes("wodeapp-web-boot")) {
    console.log("skip (already patched): web boot splash");
    return;
  }
  const from = `    <div id="root"></div>`;
  if (!content.includes(from)) throw new Error("app index.html root missing");
  content = content.replace(
    from,
    `    <div id="root">
      <div class="wodeapp-web-boot" role="status" aria-live="polite" aria-busy="true">
        <div class="wodeapp-web-boot__spin" aria-hidden="true"></div>
        <p class="wodeapp-web-boot__title">Opening chat</p>
        <span class="wodeapp-web-boot__hint">First load may take a moment</span>
      </div>
    </div>
    <style>
      .wodeapp-web-boot{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;box-sizing:border-box;background:#f7f7f5;color:#1a1a18;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
      html[data-theme=dark] .wodeapp-web-boot{background:#161615;color:#f3f3f0}
      .wodeapp-web-boot__spin{width:36px;height:36px;border:3px solid rgba(99,102,241,.18);border-top-color:#6366f1;border-radius:999px;animation:wodeapp-web-boot-spin .8s linear infinite}
      .wodeapp-web-boot__title{margin:0;font-size:14px;font-weight:600}
      .wodeapp-web-boot__hint{font-size:12px;color:#8a8680}
      html[data-theme=dark] .wodeapp-web-boot__hint{color:#9a9690}
      @keyframes wodeapp-web-boot-spin{to{transform:rotate(360deg)}}
    </style>
    <script>
      (function () {
        var zh = (location.hostname || "").indexOf(".cn") !== -1;
        var title = document.querySelector(".wodeapp-web-boot__title");
        var hint = document.querySelector(".wodeapp-web-boot__hint");
        if (title) title.textContent = zh ? "正在打开对话" : "Opening chat";
        if (hint) hint.textContent = zh ? "首次打开会稍慢，请稍候" : "First load may take a moment";
      })();
    </script>`,
  );
  await writeFile(file, content, "utf8");
  console.log("patched web boot splash");
}

async function applyWebLazyRoutesPatch() {
  const file = path.join(vendor, "apps/app/src/react-app/shell/app-root.tsx");
  let content = await readFile(file, "utf8");
  if (content.includes("wodeapp web lazy routes")) {
    console.log("skip (already patched): web lazy routes");
    return;
  }
  const fromImp = `import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";`;
  const toImp = `import { lazy, Suspense, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";`;
  if (!content.includes(fromImp)) throw new Error("app-root react import missing");
  content = content.replace(fromImp, toImp);
  const fromRoutes = `import { SessionRoute } from "./session-route";
import { SettingsRoute } from "./settings-route";
import { ShellConfigProvider } from "./shell-config";
import { WelcomeRoute } from "./welcome-route";`;
  const toRoutes = `import { SessionRoute } from "./session-route";
import { ShellConfigProvider } from "./shell-config";
// wodeapp web lazy routes
const SettingsRoute = lazy(() => import("./settings-route").then((m) => ({ default: m.SettingsRoute })));
const WelcomeRoute = lazy(() => import("./welcome-route").then((m) => ({ default: m.WelcomeRoute })));
const ForcedSigninPage = lazy(() => import("../domains/cloud/forced-signin-page").then((m) => ({ default: m.ForcedSigninPage })));
const OrgOnboardingPage = lazy(() => import("../domains/cloud/org-onboarding-page").then((m) => ({ default: m.OrgOnboardingPage })));`;
  if (!content.includes(fromRoutes)) throw new Error("app-root route imports missing");
  content = content.replace(fromRoutes, toRoutes);
  content = content.replace(
    `import { ForcedSigninPage } from "../domains/cloud/forced-signin-page";
import { OrgOnboardingPage } from "../domains/cloud/org-onboarding-page";
`,
    "",
  );
  const fromWrap = `            <Routes>`;
  const toWrap = `            <Suspense fallback={null}>
            <Routes>`;
  if (!content.includes(fromWrap)) throw new Error("Routes open missing");
  content = content.replace(fromWrap, toWrap);
  const fromClose = `            </Routes>
          </DenSigninGate>`;
  const toClose = `            </Routes>
            </Suspense>
          </DenSigninGate>`;
  if (!content.includes(fromClose)) throw new Error("Routes close missing");
  content = content.replace(fromClose, toClose);
  await writeFile(file, content, "utf8");
  console.log("patched web lazy routes");
}

async function applyWebViteBasePatch() {
  const file = path.join(vendor, "apps/app/vite.config.ts");
  let content = await readFile(file, "utf8");
  const from = `  base: isElectronPackagedBuild ? "./" : "/",`;
  const to = `  base: isElectronPackagedBuild || process.env.VITE_OPENWORK_DEPLOYMENT === "web" ? "./" : "/",`;
  if (content.includes(to)) {
    console.log("skip (already patched): web vite relative base");
    return;
  }
  if (!content.includes(from)) {
    console.log("skip vite base (already customized)");
    return;
  }
  await writeFile(file, content.replace(from, to), "utf8");
  console.log("patched web vite relative base");
}

async function applyWebSessionTitlePatch() {
  const file = path.join(vendor, "apps/app/src/app/lib/session-title.ts");
  let content = await readFile(file, "utf8");
  if (content.includes("trimmed === DEFAULT_SESSION_TITLE")) {
    console.log("skip session-title New session");
    return;
  }
  const from = `export function isGeneratedSessionTitle(title: string | null | undefined) {
  const trimmed = title?.trim() ?? "";
  if (!trimmed.startsWith(GENERATED_SESSION_TITLE_PREFIX)) return false;
  const suffix = trimmed.slice(GENERATED_SESSION_TITLE_PREFIX.length).trim();
  return Boolean(suffix) && Number.isFinite(Date.parse(suffix));
}`;
  const to = `function looksLikeGeneratedTitle(trimmed: string, prefix: string) {
  if (!trimmed.startsWith(prefix)) return false;
  const suffix = trimmed.slice(prefix.length).trim();
  return Boolean(suffix) && Number.isFinite(Date.parse(suffix));
}

export function isGeneratedSessionTitle(title: string | null | undefined) {
  const trimmed = title?.trim() ?? "";
  return (
    looksLikeGeneratedTitle(trimmed, GENERATED_SESSION_TITLE_PREFIX)
    || looksLikeGeneratedTitle(trimmed, "New session - ")
  );
}`;
  if (!content.includes(from)) {
    console.log("skip session-title (already customized)");
    return;
  }
  await writeFile(file, content.replace(from, to), "utf8");
  console.log("patched session-title New session");
}

async function main() {
  for (const spec of PATCHES) {
    await applyFilePatches(spec);
  }
  await applyDesktopLocalFileBridgePatch();
  await applyDesktopStartupProviderPatch();
  await rm(electronCloud, { recursive: true, force: true });
  await cp(path.join(cloud, "electron"), electronCloud, { recursive: true });
  console.log("copied wodeapp-cloud electron integration");
  await applyWelcomeRoutePatch();
  await applyProviderSelectionStepPatch();
  await copyFile(
    path.join(cloud, "app/wodeapp-auth.ts"),
    path.join(vendor, "apps/app/src/app/lib/wodeapp-auth.ts"),
  );
  console.log("copied wodeapp-auth.ts (cloud)");
  await applyWebViteSplitPatch();
  await applyWebBootSplashPatch();
  await applyWebLazyRoutesPatch();
  await applyWebNewTaskWhileLoadingPatch();
  await applyWebDemoSessionPatches();
  await applyWebCreditFetchPatch();
  await applyRelativeOpenworkUrlPatch();
  await applyWebForceOpenworkUrlPatch();
  await applyWebAuthSetGuard();
  await applyWebSessionTitlePatch();
  await applyWebViteBasePatch();
  console.log("\nWodeApp Cloud integration applied. OSS users: skip this script and use BYOK + MCP examples.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
