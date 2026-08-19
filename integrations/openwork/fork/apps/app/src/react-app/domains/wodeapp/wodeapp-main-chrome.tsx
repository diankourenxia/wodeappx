/** @jsxImportSource react */
import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, Flag, Palette, Settings, Smartphone } from "lucide-react";

import { LANGUAGE_OPTIONS, currentLocale, isLanguage, setLocale, t } from "@/i18n";
import { isWebDeployment } from "@/app/lib/openwork-deployment";
import type { WodeAppSurface } from "./wodeapp-types";
import { WODEAPP_NAV_ITEMS } from "./wodeapp-types";
import type { WodeAppSkinId } from "./wodeapp-skins";
import type { WodeAppProductDeskId } from "./wodeapp-supor-project";
import { copyWodeAppSessionId } from "./wodeapp-session-debug";
import { WODEAPP_OPEN_SKIN_PICKER_EVENT } from "./wodeapp-companion-prefs";
import { WodeAppSkinPickerDialog } from "./wodeapp-skin-picker-dialog";
import { WodeAppPerfHud } from "./wodeapp-perf-hud";
import { WODEAPP_MOBILE_REMOTE_ENABLED } from "./wodeapp-mobile-remote-feature";

const SURFACE_LABEL_KEYS: Record<WodeAppSurface, string> = {
  agents: "wodeappx.nav.agents",
  assets: "wodeappx.nav.assets",
  schedule: "wodeappx.nav.schedule",
  capabilities: "wodeappx.nav.capabilities",
  plugins: "wodeappx.nav.plugins",
  capture: "wodeappx.nav.capture",
  account: "wodeappx.nav.account",
};

/** Topbar 「上报」— cloud ingest still WIP; flip when ready to ship. */
const SHOW_SESSION_BUG_REPORT_BUTTON = false;

type WodeAppMainChromeProps = {
  activeSurface: WodeAppSurface;
  activeSurfaceLabel?: string;
  /** Current chat session id — shown in topbar for copy/debug when on agents. */
  sessionId?: string | null;
  /** Report current session as a bug and auto-start investigation chat. */
  onReportSessionBug?: () => void | Promise<void>;
  children: ReactNode;
  productDesk: WodeAppProductDeskId;
  skin: WodeAppSkinId;
  onSkinChange: (skin: WodeAppSkinId) => void;
};

export function WodeAppMainChrome({
  activeSurface,
  activeSurfaceLabel,
  sessionId,
  onReportSessionBug,
  children,
  productDesk,
  onSkinChange,
  skin,
}: WodeAppMainChromeProps) {
  const navigate = useNavigate();
  const deskAgentsLabel = productDesk === "supor" ? t("wodeappx.nav.agents_supor") : t("wodeappx.nav.agents");
  const surfaceLabel =
    activeSurfaceLabel
    || (activeSurface === "agents" ? deskAgentsLabel : t(SURFACE_LABEL_KEYS[activeSurface]));
  const [copyBusy, setCopyBusy] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [skinPickerOpen, setSkinPickerOpen] = useState(false);
  const visibleSessionId = !isWebDeployment() && activeSurface === "agents" ? (sessionId?.trim() || "") : "";

  useEffect(() => {
    const openSkinPicker = () => setSkinPickerOpen(true);
    window.addEventListener(WODEAPP_OPEN_SKIN_PICKER_EVENT, openSkinPicker);
    return () => window.removeEventListener(WODEAPP_OPEN_SKIN_PICKER_EVENT, openSkinPicker);
  }, []);

  const handleCopySessionId = async () => {
    if (!visibleSessionId || copyBusy) return;
    setCopyBusy(true);
    try {
      await copyWodeAppSessionId(visibleSessionId);
    } finally {
      setCopyBusy(false);
    }
  };

  const handleReportSessionBug = async () => {
    if (!visibleSessionId || reportBusy || !onReportSessionBug) return;
    setReportBusy(true);
    try {
      await onReportSessionBug();
    } finally {
      setReportBusy(false);
    }
  };

  const handleLanguageChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    if (!isLanguage(next) || next === currentLocale()) return;
    setLocale(next);
    window.location.reload();
  };

  return (
    <section className="wapp-main-panel">
      <header className="wapp-topbar mac:titlebar-drag">
        {/*
          Real DOM no-drag lead (not ::before): Electron app-region:drag ignores
          z-index, and ::before holes are unreliable on Electron 39. Only shown
          when the sidebar is collapsed (CSS). If this node is visible while the
          sidebar is expanded, it positions against the shell and steals clicks
          from the left 118px of the session list.
        */}
        <div className="wapp-topbar-traffic-nodrag mac:titlebar-no-drag" aria-hidden />
        <div className="wapp-breadcrumb">
          <button
            type="button"
            className="wapp-breadcrumb-link"
            onClick={() => window.dispatchEvent(new Event("wodeapp:focus-agents"))}
          >
            {isWebDeployment() ? "WodeAppX" : "wodeappx"}
          </button>
          <span>/</span>
          <strong>{surfaceLabel}</strong>
          {visibleSessionId ? (
            <span className="wapp-session-id-group mac:titlebar-no-drag">
              <button
                type="button"
                className="wapp-session-id"
                onClick={() => void handleCopySessionId()}
                disabled={copyBusy}
                title={t("wodeappx.chrome.copy_session", { id: visibleSessionId })}
                aria-label={t("wodeappx.chrome.copy_session_aria", { id: visibleSessionId })}
              >
                <span className="wapp-session-id-kicker">{t("wodeappx.chrome.session")}</span>
                <code className="wapp-session-id-value">{visibleSessionId}</code>
                <Copy aria-hidden className="wapp-session-id-icon" />
              </button>
              {SHOW_SESSION_BUG_REPORT_BUTTON && onReportSessionBug ? (
                <button
                  type="button"
                  className="wapp-session-report"
                  onClick={() => void handleReportSessionBug()}
                  disabled={reportBusy}
                  title="上报为故障并自动开始排查"
                  aria-label="上报对话故障并自动排查"
                >
                  <Flag aria-hidden className="wapp-session-report-icon" />
                  <span>{reportBusy ? "上报中" : "上报"}</span>
                </button>
              ) : null}
            </span>
          ) : null}
        </div>
        <div className="wapp-topbar-actions mac:titlebar-no-drag">
          {activeSurface !== "agents" ? (
            <button
              type="button"
              className="wapp-help-button is-primary-outline"
              onClick={() => window.dispatchEvent(new Event("wodeapp:focus-agents"))}
            >
              {t("wodeappx.chrome.back_to_chat")}
            </button>
          ) : null}
          {WODEAPP_MOBILE_REMOTE_ENABLED ? (
            <button
              type="button"
              className="wapp-mobile-button"
              onClick={() => window.dispatchEvent(new Event("wodeapp:open-mobile-remote"))}
            >
              <Smartphone aria-hidden />
              {t("wodeappx.chrome.mobile")}
            </button>
          ) : null}
          <div id="wapp-topbar-session-rail" className="wapp-topbar-session-rail" />
          <select
            className="wapp-help-button wapp-lang-switch"
            value={currentLocale()}
            aria-label={t("wodeappx.chrome.language")}
            title={t("wodeappx.chrome.language")}
            onChange={handleLanguageChange}
          >
            {LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.nativeName}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="wapp-icon-button"
            aria-label={t("wodeappx.chrome.settings")}
            onClick={() => navigate(isWebDeployment() ? "/settings/appearance" : "/settings/service")}
          >
            <Settings aria-hidden />
          </button>
          <button
            type="button"
            className="wapp-icon-button wapp-skin-button"
            aria-label={t("wodeappx.chrome.skin")}
            title={t("wodeappx.chrome.skin")}
            aria-haspopup="dialog"
            aria-expanded={skinPickerOpen}
            data-wapp-skin-active={skin}
            onClick={() => setSkinPickerOpen(true)}
          >
            <Palette aria-hidden />
          </button>
        </div>
      </header>
      <div className={`wapp-content${activeSurface === "agents" ? " wapp-content-chat" : ""}`}>
        {children}
      </div>
      <WodeAppSkinPickerDialog
        open={skinPickerOpen}
        activeSkin={skin}
        sessionId={visibleSessionId || null}
        onClose={() => setSkinPickerOpen(false)}
        onSelect={onSkinChange}
      />
      <WodeAppPerfHud />
    </section>
  );
}

export function wodeappSurfaceLabel(surface: WodeAppSurface): string {
  const item = WODEAPP_NAV_ITEMS.find((entry) => entry.id === surface);
  return t(item?.labelKey ?? SURFACE_LABEL_KEYS[surface]);
}
