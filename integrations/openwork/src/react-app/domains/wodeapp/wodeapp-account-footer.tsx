/** @jsxImportSource react */
import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronRight,
  CircleUserRound,
  Coins,
  KeyRound,
  LogOut,
  PawPrint,
  Settings,
} from "lucide-react";

import {
  isWodeAppAuthAvailable,
  loadCachedWodeAppAuthState,
  refreshWodeAppAccountState,
  cancelWodeAppLogin,
  getWodeAppLoginStatus,
  saveWodeAppServiceConfig,
  signInWithWodeApp,
  signOutWodeApp,
  type WodeAppAuthConfig,
} from "@/app/lib/wodeapp-auth";
import { toast } from "@/components/ui/sonner";
import { openDesktopUrl } from "@/app/lib/desktop";
import { useLocal } from "@/react-app/kernel/local-provider";

import { resolveAccountMenuAuthActions } from "./wodeapp-account-menu";
import {
  readCachedProviderCapabilitySnapshot,
  unsignedLocalModeHint,
  WODEAPP_PROVIDER_CAPABILITY_EVENT,
  type ProviderCapabilitySnapshot,
} from "./wodeapp-provider-capability";
import {
  applyWodeAppDefaultModelToPrefs,
  hasUserChoseDefaultModel,
  shouldMigrateLegacyWodeAppDefault,
} from "./wodeapp-model-sync";
import {
  WODEAPP_OPEN_ACCOUNT_EVENT,
  WODEAPP_OPEN_LOCAL_KEY_EVENT,
  WODEAPP_OPEN_LOGIN_EVENT,
  WODEAPP_OPEN_RECHARGE_EVENT,
  WODEAPP_OPEN_SERVICE_SETTINGS_EVENT,
} from "./wodeapp-model-display";
import {
  WODEAPP_OPEN_BYOK_GUIDE_EVENT,
} from "./wodeapp-byok-guide";
import { WODEAPP_OPEN_FIRST_MILE_EVENT } from "./wodeapp-first-mile";
import {
  readWodeAppCompanionPrefs,
  resolveCompanionFloatEnabled,
  resolveCompanionPerchEnabled,
  WODEAPP_COMPANION_PREFS_EVENT,
  WODEAPP_OPEN_SKIN_PICKER_EVENT,
} from "./wodeapp-companion-prefs";
import { readStoredWodeAppSkin } from "./wodeapp-skins";
import { WodeAppLocalKeyDialog } from "./wodeapp-local-key-dialog";
import { WodeAppCloudLoginWaitingDialog, WodeAppCloudRegionDialog } from "./wodeapp-cloud-region-dialog";
import {
  originForCloudRegion,
  wodeAppCloudPricingUrl,
  writeStoredCloudRegion,
  type WodeAppCloudRegion,
} from "./wodeapp-cloud-region";
import { WodeAppByokGuideDialog, useFirstMileEntryCue } from "./wodeapp-byok-guide-dialog";
import { WodeAppMediaByokSettings } from "./wodeapp-media-byok-settings";
import { WodeAppSidebarUpdater } from "./wodeapp-sidebar-updater";
import {
  WODEAPP_OPEN_MEDIA_BYOK_EVENT,
  type MediaByokProviderId,
} from "./wodeapp-media-byok";

import "./wodeapp-legacy-chrome.css";

type WodeAppAccountFooterProps = {
  onOpenAccountPage?: () => void;
};

function subscribeCompanionPrefs(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key.startsWith("wodeappx.companion.")) onStoreChange();
  };
  window.addEventListener(WODEAPP_COMPANION_PREFS_EVENT, onStoreChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(WODEAPP_COMPANION_PREFS_EVENT, onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function WodeAppAccountFooter({
  onOpenAccountPage,
}: WodeAppAccountFooterProps) {
  const navigate = useNavigate();
  const { prefs, setPrefs } = useLocal();
  const companion = React.useSyncExternalStore(
    subscribeCompanionPrefs,
    readWodeAppCompanionPrefs,
    readWodeAppCompanionPrefs,
  );
  const [accountOpen, setAccountOpen] = React.useState(false);
  const [loginLoading, setLoginLoading] = React.useState(false);
  const [loginPhase, setLoginPhase] = React.useState<"browser" | "initializing">("browser");
  const [loginOrigin, setLoginOrigin] = React.useState("");
  const [regionDialogOpen, setRegionDialogOpen] = React.useState(false);
  const [localKeyDialogOpen, setLocalKeyDialogOpen] = React.useState(false);
  const [byokGuideOpen, setByokGuideOpen] = React.useState(false);
  const [mediaByokOpen, setMediaByokOpen] = React.useState(false);
  const [mediaByokDocked, setMediaByokDocked] = React.useState(false);
  const [mediaByokProviderId, setMediaByokProviderId] = React.useState<MediaByokProviderId | undefined>();
  const [localModeHint, setLocalModeHint] = React.useState(() => (
    unsignedLocalModeHint(readCachedProviderCapabilitySnapshot()?.sources ?? [])
  ));
  const [logoutLoading, setLogoutLoading] = React.useState(false);
  const firstMileCue = useFirstMileEntryCue();
  const [authConfig, setAuthConfig] = React.useState<WodeAppAuthConfig | null>(null);
  const [authChecked, setAuthChecked] = React.useState(false);
  const [authRefreshing, setAuthRefreshing] = React.useState(false);
  const [authRefreshFailed, setAuthRefreshFailed] = React.useState(false);
  const refreshPromiseRef = React.useRef<Promise<void> | null>(null);

  const refreshAuth = React.useCallback(() => {
    if (refreshPromiseRef.current) return refreshPromiseRef.current;
    const task = (async () => {
      setAuthRefreshing(true);
      setAuthRefreshFailed(false);
      try {
        const result = await refreshWodeAppAccountState();
        if (result.ok && result.signedIn && result.config) {
          setAuthConfig((current) => ({
            ...result.config,
            user: result.config.user ?? current?.user ?? null,
            credits: result.config.credits ?? current?.credits ?? null,
          }));
        } else {
          setAuthRefreshFailed(true);
        }
      } catch {
        setAuthRefreshFailed(true);
      } finally {
        setAuthChecked(true);
        setAuthRefreshing(false);
        refreshPromiseRef.current = null;
      }
    })();
    refreshPromiseRef.current = task;
    return task;
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!isWodeAppAuthAvailable()) {
        if (!cancelled) {
          setAuthConfig(null);
          setAuthChecked(true);
        }
        return;
      }
      try {
        const cached = await loadCachedWodeAppAuthState();
        if (cancelled) return;
        if (cached.ok && cached.signedIn && cached.config) {
          setAuthConfig(cached.config);
        } else {
          setAuthConfig(null);
        }
      } catch {
        if (!cancelled) setAuthRefreshFailed(true);
      } finally {
        if (!cancelled) {
          setAuthChecked(true);
          void refreshAuth();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshAuth]);

  React.useEffect(() => {
    if (accountOpen) void refreshAuth();
  }, [accountOpen, refreshAuth]);

  React.useEffect(() => {
    const handleAuthChanged = () => void refreshAuth();
    window.addEventListener("wodeapp:auth-changed", handleAuthChanged);
    return () => window.removeEventListener("wodeapp:auth-changed", handleAuthChanged);
  }, [refreshAuth]);

  const applySignedIn = React.useCallback((config: WodeAppAuthConfig) => {
    applyWodeAppDefaultModelToPrefs(config, setPrefs, prefs.defaultModel, {
      workbench: true,
      force: shouldMigrateLegacyWodeAppDefault(prefs.defaultModel) && !hasUserChoseDefaultModel(),
    });
    setAuthConfig(config);
    setAuthRefreshFailed(false);
    toast.success("登录成功");
    try {
      window.dispatchEvent(new CustomEvent("openwork-server-settings-changed"));
    } catch {
      // ignore
    }
    void refreshAuth();
  }, [prefs.defaultModel, refreshAuth, setPrefs]);

  const openCloudPricing = React.useCallback(async () => {
    setAccountOpen(false);
    if (typeof authConfig?.credits !== "number") {
      void refreshAuth();
    }
    const url = wodeAppCloudPricingUrl(authConfig?.origin);
    toast.message("已在浏览器打开充值页");
    try {
      await openDesktopUrl(url);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "无法打开充值页");
    }
  }, [authConfig?.credits, authConfig?.origin, refreshAuth]);

  const loginInFlightRef = React.useRef(false);
  const startWebLogin = React.useCallback(async (region: WodeAppCloudRegion) => {
    setAccountOpen(false);
    if (!isWodeAppAuthAvailable()) {
      setRegionDialogOpen(false);
      navigate("/signin");
      return;
    }
    if (loginInFlightRef.current) {
      setRegionDialogOpen(false);
      return;
    }
    loginInFlightRef.current = true;
    writeStoredCloudRegion(region);
    const origin = originForCloudRegion(region);
    setLoginOrigin(origin);
    setLoginLoading(true);
    setRegionDialogOpen(false);
    toast.message("已在浏览器打开登录页");
    try {
      const result = await signInWithWodeApp(origin);
      if (!result.ok) {
        const error = "error" in result ? result.error : "";
        if (error && error !== "已取消绑定") {
          toast.error(error);
        }
        return;
      }
      if (!result.signedIn || !result.config) {
        toast.error("登录未完成，请重试");
        return;
      }
      applySignedIn(result.config);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "登录失败");
    } finally {
      loginInFlightRef.current = false;
      setLoginLoading(false);
      setLoginOrigin("");
    }
  }, [applySignedIn, navigate]);

  const cancelWebLogin = React.useCallback(() => {
    void cancelWodeAppLogin();
  }, []);

  React.useEffect(() => {
    if (!loginLoading) {
      setLoginPhase("browser");
      return;
    }
    let cancelled = false;
    const tick = async () => {
      const status = await getWodeAppLoginStatus();
      if (cancelled) return;
      if (status.phase === "initializing" || status.phase === "browser") {
        setLoginPhase(status.phase);
      }
    };
    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 400);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loginLoading]);

  const openLogin = React.useCallback(() => {
    setAccountOpen(false);
    if (loginLoading) return;
    if (!isWodeAppAuthAvailable()) {
      navigate("/signin");
      return;
    }
    setRegionDialogOpen(true);
  }, [loginLoading, navigate]);

  React.useEffect(() => {
    const onOpenLogin = () => {
      openLogin();
    };
    window.addEventListener(WODEAPP_OPEN_LOGIN_EVENT, onOpenLogin);
    return () => window.removeEventListener(WODEAPP_OPEN_LOGIN_EVENT, onOpenLogin);
  }, [openLogin]);

  React.useEffect(() => {
    const openAccountMenu = () => setAccountOpen(true);
    window.addEventListener(WODEAPP_OPEN_ACCOUNT_EVENT, openAccountMenu);
    return () => window.removeEventListener(WODEAPP_OPEN_ACCOUNT_EVENT, openAccountMenu);
  }, []);

  React.useEffect(() => {
    const openRecharge = () => {
      void openCloudPricing();
    };
    window.addEventListener(WODEAPP_OPEN_RECHARGE_EVENT, openRecharge);
    return () => window.removeEventListener(WODEAPP_OPEN_RECHARGE_EVENT, openRecharge);
  }, [openCloudPricing]);

  React.useEffect(() => {
    const openService = () => {
      setAccountOpen(false);
      navigate("/settings/service");
    };
    window.addEventListener(WODEAPP_OPEN_SERVICE_SETTINGS_EVENT, openService);
    return () => window.removeEventListener(WODEAPP_OPEN_SERVICE_SETTINGS_EVENT, openService);
  }, [navigate]);

  React.useEffect(() => {
    const openLocalKeyFromPicker = () => {
      setAccountOpen(false);
      setLocalKeyDialogOpen(true);
    };
    window.addEventListener(WODEAPP_OPEN_LOCAL_KEY_EVENT, openLocalKeyFromPicker);
    return () => window.removeEventListener(WODEAPP_OPEN_LOCAL_KEY_EVENT, openLocalKeyFromPicker);
  }, []);

  React.useEffect(() => {
    const openFirstMile = () => {
      setAccountOpen(false);
      setByokGuideOpen(true);
    };
    window.addEventListener(WODEAPP_OPEN_FIRST_MILE_EVENT, openFirstMile);
    window.addEventListener(WODEAPP_OPEN_BYOK_GUIDE_EVENT, openFirstMile);
    return () => {
      window.removeEventListener(WODEAPP_OPEN_FIRST_MILE_EVENT, openFirstMile);
      window.removeEventListener(WODEAPP_OPEN_BYOK_GUIDE_EVENT, openFirstMile);
    };
  }, []);

  React.useEffect(() => {
    const openMedia = (event: Event) => {
      const detail = (event as CustomEvent<{ providerId?: MediaByokProviderId; docked?: boolean }>).detail;
      setMediaByokProviderId(detail?.providerId);
      setMediaByokDocked(Boolean(detail?.docked));
      setMediaByokOpen(true);
    };
    window.addEventListener(WODEAPP_OPEN_MEDIA_BYOK_EVENT, openMedia);
    return () => window.removeEventListener(WODEAPP_OPEN_MEDIA_BYOK_EVENT, openMedia);
  }, []);

  React.useEffect(() => {
    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<ProviderCapabilitySnapshot>).detail;
      setLocalModeHint(unsignedLocalModeHint(detail?.sources ?? []));
    };
    window.addEventListener(WODEAPP_PROVIDER_CAPABILITY_EVENT, onUpdate);
    setLocalModeHint(unsignedLocalModeHint(readCachedProviderCapabilitySnapshot()?.sources ?? []));
    return () => window.removeEventListener(WODEAPP_PROVIDER_CAPABILITY_EVENT, onUpdate);
  }, []);

  const isEmbedded = Boolean(authConfig?.embedded);
  const menuAuth = resolveAccountMenuAuthActions({
    signedIn: Boolean(authConfig),
    embedded: isEmbedded,
  });
  const cloudSignedIn = menuAuth.showAccount;
  const accountName = authConfig?.user?.name?.trim() || "WodeApp 账户";
  const creditsText =
    typeof authConfig?.credits === "number"
      ? authConfig.credits.toLocaleString()
      : authRefreshing
        ? "刷新中"
        : authRefreshFailed
          ? "点击重试"
          : "加载中";
  const accountMeta = cloudSignedIn
    ? typeof authConfig?.credits === "number"
      ? `${authConfig.credits.toLocaleString()} 积分`
      : authRefreshing
        ? "正在同步积分"
        : "积分待刷新"
    : localModeHint;

  const handleSignOut = async () => {
    setLogoutLoading(true);
    try {
      await signOutWodeApp();
    } catch (error) {
      // Main-process logout must still clear UI; otherwise a thrown sync leaves the
      // chip stuck on the previous account name with "no reaction".
      console.warn("[wodeapp] signOut failed", error);
    } finally {
      setAuthConfig(null);
      setAuthRefreshFailed(false);
      setAccountOpen(false);
      setLogoutLoading(false);
    }
  };

  const openAccount = () => {
    onOpenAccountPage?.();
    setAccountOpen(false);
  };

  const openCredits = () => {
    void openCloudPricing();
  };

  const openLocalKey = () => {
    setAccountOpen(false);
    setLocalKeyDialogOpen(true);
  };

  const switchToLocal = () => {
    void saveWodeAppServiceConfig({
      origin: authConfig?.origin || "https://wodeapp.ai",
      profile: "local-only",
    });
    openLocalKey();
  };

  const accountDockRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!accountOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (accountDockRef.current?.contains(target)) return;
      setAccountOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [accountOpen]);

  const mediaByokDialog = (
    <WodeAppMediaByokSettings
      open={mediaByokOpen}
      docked={mediaByokDocked}
      initialProviderId={mediaByokProviderId}
      onClose={() => {
        setMediaByokOpen(false);
        setMediaByokDocked(false);
      }}
    />
  );

  const regionDialog = (
    <WodeAppCloudRegionDialog
      open={regionDialogOpen}
      onClose={() => setRegionDialogOpen(false)}
      onPick={(region) => {
        void startWebLogin(region);
      }}
    />
  );
  const loginWaitingDialog = (
    <WodeAppCloudLoginWaitingDialog
      open={loginLoading}
      origin={loginOrigin}
      phase={loginPhase}
      onCancel={cancelWebLogin}
    />
  );

  if (!authChecked) {
    return (
      <>
        {mediaByokDialog}
        {regionDialog}
        {loginWaitingDialog}
        <div className="wx-account-dock">
          <footer className="wx-runtime-card">
            <p className="wapp-sidebar-muted">账号加载中...</p>
          </footer>
        </div>
      </>
    );
  }

  return (
    <>
      {mediaByokDialog}
      {regionDialog}
      {loginWaitingDialog}
      <WodeAppLocalKeyDialog
        open={localKeyDialogOpen}
        onClose={() => setLocalKeyDialogOpen(false)}
      />

      <WodeAppByokGuideDialog
        open={byokGuideOpen}
        onClose={() => setByokGuideOpen(false)}
      />

      <div ref={accountDockRef} className="wx-account-dock">
        {accountOpen ? (
          <section className="wx-account-menu" aria-label="账号菜单">
            {cloudSignedIn ? (
              <>
                <div className="wx-account-menu-identity">
                  <CircleUserRound aria-hidden />
                  <span>{accountName}</span>
                </div>
                {menuAuth.showAccount ? (
                  <button type="button" className="wx-account-menu-row" onClick={openAccount}>
                    <CircleUserRound aria-hidden />
                    <span>账户</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="wx-account-menu-row"
                  aria-haspopup="dialog"
                  onClick={openLocalKey}
                >
                  <KeyRound aria-hidden />
                  <span>配置本机 Key</span>
                  <strong className="wx-account-menu-value">
                    {localModeHint.endsWith("已配置") ? "已配置" : "去配置"}
                  </strong>
                </button>
                <button type="button" className="wx-account-menu-row" onClick={openCredits}>
                  <Coins aria-hidden />
                  <span>积分</span>
                  <strong className="wx-account-menu-value">{creditsText}</strong>
                </button>
                <button
                  type="button"
                  className="wx-account-menu-row"
                  aria-haspopup="dialog"
                  onClick={() => {
                    setAccountOpen(false);
                    window.dispatchEvent(new Event(WODEAPP_OPEN_SKIN_PICKER_EVENT));
                  }}
                >
                  <PawPrint aria-hidden />
                  <span>桌面陪伴</span>
                  <strong className="wx-account-menu-value">
                    {resolveCompanionFloatEnabled(companion, readStoredWodeAppSkin()) ||
                    resolveCompanionPerchEnabled(companion, readStoredWodeAppSkin())
                      ? "开"
                      : "关"}
                  </strong>
                </button>
                <button
                  type="button"
                  className="wx-account-menu-row"
                  onClick={() => {
                    navigate("/settings/service");
                    setAccountOpen(false);
                  }}
                >
                  <Settings aria-hidden />
                  <span>设置</span>
                </button>
                {menuAuth.showLogout ? (
                  <>
                    <div className="wx-account-menu-divider" />
                    <button
                      type="button"
                      className="wx-account-menu-row wx-account-menu-logout"
                      disabled={logoutLoading}
                      onClick={() => void handleSignOut()}
                    >
                      <LogOut aria-hidden />
                      <span>退出登录</span>
                    </button>
                  </>
                ) : null}
              </>
            ) : (
              <div className="wx-account-menu-modes" role="group" aria-label="运行方式">
                <button
                  type="button"
                  className="wx-account-menu-mode"
                  onClick={switchToLocal}
                >
                  <span className="wx-account-menu-mode-label">本地</span>
                  <span className="wx-account-menu-mode-hint">{localModeHint}</span>
                </button>
                <button
                  type="button"
                  className="wx-account-menu-mode"
                  onClick={openLogin}
                  disabled={loginLoading}
                >
                  <span className="wx-account-menu-mode-label">云端</span>
                  <span className="wx-account-menu-mode-hint">
                    {loginLoading
                      ? loginPhase === "initializing"
                        ? "登录成功，初始化中"
                        : "正在打开浏览器登录..."
                      : "登录 · 所有能力立即可用"}
                  </span>
                </button>
              </div>
            )}
          </section>
        ) : null}

        <footer className="wx-runtime-card">
          <div className="wx-account-footer-row">
            {cloudSignedIn ? (
              <button
                type="button"
                className={`wx-account-trigger${firstMileCue ? " is-first-mile-cue" : ""}`}
                onClick={() => setAccountOpen((open) => !open)}
                aria-expanded={accountOpen}
                title={firstMileCue ? "开始使用" : undefined}
              >
                <span className="wx-account-avatar" aria-hidden>
                  WA
                </span>
                <span className="wx-account-trigger-copy">
                  <strong>{accountName}</strong>
                  <span>{accountMeta}</span>
                </span>
                <ChevronRight aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                className={`wx-account-trigger${firstMileCue ? " is-first-mile-cue" : ""}`}
                onClick={() => setAccountOpen((open) => !open)}
                aria-expanded={accountOpen}
                title={firstMileCue ? "开始使用" : undefined}
              >
                <span className="wx-account-avatar" aria-hidden>
                  BY
                </span>
                <span className="wx-account-trigger-copy">
                  <strong>本地</strong>
                  <span>{localModeHint}</span>
                </span>
                <ChevronRight aria-hidden />
              </button>
            )}
            <WodeAppSidebarUpdater />
          </div>
        </footer>
      </div>
    </>
  );
}
