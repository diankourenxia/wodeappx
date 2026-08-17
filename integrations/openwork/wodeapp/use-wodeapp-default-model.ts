import * as React from "react";

import {
  applyWodeAppProvider,
  isWodeAppAuthAvailable,
  loadWodeAppAuthState,
} from "@/app/lib/wodeapp-auth";
import { useLocal } from "@/react-app/kernel/local-provider";

import {
  applyWodeAppDefaultModelToPrefs,
  FLASH_DEFAULT_MIGRATION_KEY,
  hasUserChoseDefaultModel,
  shouldMigrateLegacyWodeAppDefault,
  WODEAPP_DEFAULT_MODEL,
} from "./wodeapp-model-sync";

const PROVIDER_RELOAD_MIN_INTERVAL_MS = 30_000;
let lastProviderReloadAt = 0;

function hasCompletedFlashDefaultMigration(): boolean {
  try {
    return window.localStorage.getItem(FLASH_DEFAULT_MIGRATION_KEY) === "1";
  } catch {
    return false;
  }
}

function markFlashDefaultMigrationComplete() {
  try {
    window.localStorage.setItem(FLASH_DEFAULT_MIGRATION_KEY, "1");
  } catch {
    // The in-memory preference still applies for this run.
  }
}

function notifyProviderReloadIfNeeded(force = false) {
  const now = Date.now();
  if (!force && now - lastProviderReloadAt < PROVIDER_RELOAD_MIN_INTERVAL_MS) {
    return;
  }
  lastProviderReloadAt = now;
  try {
    window.dispatchEvent(new CustomEvent("openwork-server-settings-changed"));
  } catch {
    // ignore
  }
}

/** WodeAppX 工作台：同步 provider 配置；仅在首次/迁移时写入默认模型，不覆盖用户手动选择 */
export function useWodeAppDefaultModelSync() {
  const { prefs, setPrefs } = useLocal();
  const prefsRef = React.useRef(prefs);
  prefsRef.current = prefs;

  const syncInFlightRef = React.useRef(false);
  const didInitialProviderSyncRef = React.useRef(false);

  const syncDefaultModel = React.useCallback(async (options?: { forceProvider?: boolean }) => {
    if (!isWodeAppAuthAvailable()) return;
    if (syncInFlightRef.current) return;
    syncInFlightRef.current = true;

    let prefsChanged = false;
    let providerApplied = false;

    try {
      const result = await loadWodeAppAuthState();
      const config = result.ok && result.signedIn && result.config ? result.config : null;
      const migrationSupported = config?.defaultModelId === WODEAPP_DEFAULT_MODEL.modelID;
      const migrationComplete = hasCompletedFlashDefaultMigration();
      const shouldMigrateLegacyDefault = Boolean(
        migrationSupported
          && !migrationComplete
          && !hasUserChoseDefaultModel()
          && shouldMigrateLegacyWodeAppDefault(prefsRef.current.defaultModel),
      );

      const shouldApplyProvider =
        Boolean(options?.forceProvider) || !didInitialProviderSyncRef.current;
      if (config && shouldApplyProvider) {
        try {
          const applied = await applyWodeAppProvider();
          providerApplied = applied.ok;
          if (providerApplied) {
            didInitialProviderSyncRef.current = true;
          }
        } catch {
          // ignore — session-route 会在 provider 列表刷新后再次对齐
        }
      }

      const switched = applyWodeAppDefaultModelToPrefs(
        config,
        (updater) => {
          setPrefs((previous) => {
            const next = updater(previous);
            if (next !== previous) prefsChanged = true;
            return next;
          });
        },
        prefsRef.current.defaultModel,
        { workbench: true, force: shouldMigrateLegacyDefault },
      );
      prefsChanged ||= switched;

      if (migrationSupported && !migrationComplete && (!shouldMigrateLegacyDefault || switched)) {
        markFlashDefaultMigrationComplete();
      }

      if (prefsChanged || providerApplied) {
        notifyProviderReloadIfNeeded(Boolean(options?.forceProvider));
      }
    } finally {
      syncInFlightRef.current = false;
    }
  }, [setPrefs]);

  React.useEffect(() => {
    void syncDefaultModel({ forceProvider: true });
  }, [syncDefaultModel]);

  React.useEffect(() => {
    const onAuthChanged = () => {
      didInitialProviderSyncRef.current = false;
      void syncDefaultModel({ forceProvider: true });
    };
    window.addEventListener("wodeapp:auth-changed", onAuthChanged);
    return () => window.removeEventListener("wodeapp:auth-changed", onAuthChanged);
  }, [syncDefaultModel]);
}
