import * as React from "react";

import {
  isWodeAppAuthAvailable,
  loadWodeAppAuthState,
  type WodeAppAuthConfig,
} from "@/app/lib/wodeapp-auth";

import { setWodeAppAbilityProjects, clearWodeAppAbilityProjects, setAbilityWorkbenchContext } from "./runtime-projects";
import { isOssEdition } from "./wodeapp-edition";
import { WODEAPP_OPEN_LOGIN_EVENT } from "./wodeapp-model-display";

function syncAbilityWorkbenchContext(config: WodeAppAuthConfig | null) {
  setAbilityWorkbenchContext({
    origin: config?.origin ?? null,
    profile: config?.profile ?? null,
    ossEdition: isOssEdition(),
    hasLocalKeys: config?.hasLocalKeys,
  });
}

export function useWodeAppAuthSession() {
  const [authConfig, setAuthConfig] = React.useState<WodeAppAuthConfig | null>(null);
  const [authChecked, setAuthChecked] = React.useState(false);

  const refreshAuth = React.useCallback(async () => {
    if (!isWodeAppAuthAvailable()) {
      syncAbilityWorkbenchContext(null);
      setAuthConfig(null);
      setAuthChecked(true);
      return null;
    }
    const result = await loadWodeAppAuthState();
    if (result.ok && result.signedIn && result.config) {
      const uid = result.config.user?.id ?? null;
      syncAbilityWorkbenchContext(result.config);
      setWodeAppAbilityProjects(result.config.abilityProjects || [], uid);
      setAuthConfig(result.config);
      setAuthChecked(true);
      return result.config;
    }
    syncAbilityWorkbenchContext(null);
    clearWodeAppAbilityProjects();
    setAuthConfig(null);
    setAuthChecked(true);
    return null;
  }, []);

  React.useEffect(() => {
    void refreshAuth();
  }, [refreshAuth]);

  React.useEffect(() => {
    const userId = authConfig?.user?.id ?? null;
    if (!authConfig) {
      syncAbilityWorkbenchContext(null);
      clearWodeAppAbilityProjects();
      return;
    }
    syncAbilityWorkbenchContext(authConfig);
    setWodeAppAbilityProjects(authConfig.abilityProjects || [], userId);
  }, [authConfig]);

  React.useEffect(() => {
    const onAuthChanged = () => {
      void refreshAuth();
    };
    window.addEventListener("wodeapp:auth-changed", onAuthChanged);
    window.addEventListener(WODEAPP_OPEN_LOGIN_EVENT, onAuthChanged);
    return () => {
      window.removeEventListener("wodeapp:auth-changed", onAuthChanged);
      window.removeEventListener(WODEAPP_OPEN_LOGIN_EVENT, onAuthChanged);
    };
  }, [refreshAuth]);

  const accountName = authConfig?.user?.name?.trim() || "WodeApp 用户";
  const creditsText =
    typeof authConfig?.credits === "number" ? authConfig.credits.toLocaleString() : null;

  return {
    authChecked,
    signedIn: Boolean(authConfig),
    authConfig,
    accountName,
    creditsText,
    refreshAuth,
  };
}
