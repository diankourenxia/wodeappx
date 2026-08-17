/** @jsxImportSource react */
import { useLayoutEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import type { WorkspaceSessionGroup } from "@/app/types";

import {
  readWodeAppCompanionPrefs,
  resolveCompanionFloatEnabled,
  resolveCompanionPerchEnabled,
  WODEAPP_COMPANION_PREFS_EVENT,
} from "./wodeapp-companion-prefs";
import {
  resolveFloatCompanionAvatarForSkin,
  resolvePerchCompanionAvatarForSkin,
} from "./wodeapp-companion-avatars";
import { WodeAppPetBuddy } from "./wodeapp-pet-buddy";
import { WodeAppOtomeStage } from "./wodeapp-otome-stage";
import { WodeAppSummerBackdrop } from "./wodeapp-summer-backdrop";
import { WodeAppSkinAmbientBackdrop } from "./wodeapp-skin-ambient-backdrop";
import {
  getWodeAppPlazaSnapshot,
  readPlazaSkinCss,
  subscribeWodeAppPlaza,
} from "./wodeapp-plaza";
import { isWodeAppPlazaSkinId, type WodeAppSkinId } from "./wodeapp-skins";

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

function resolveFloatHost(): HTMLElement | null {
  const shell = document.querySelector(".wapp-workspace-shell");
  return shell instanceof HTMLElement ? shell : null;
}

/**
 * Host is the white composer card itself. Absolute `top:0` then follows the
 * dialog in empty (centered) and filled (bottom) layouts.
 */
export function resolvePerchHost(root: ParentNode = document): HTMLElement | null {
  const card =
    root.querySelector(".wapp-session-surface .wapp-composer-card") ||
    root.querySelector(".wapp-composer-card");
  return card instanceof HTMLElement ? card : null;
}

/**
 * Structural chrome for example theme skins (not just recolor).
 *
 * Two independent companions, gated by the active skin's kit:
 * - 桌宠 float: skin ships a float avatar AND companion.enabled
 * - 趴宠 perch: skin ships a perch avatar AND perch prefs
 */
export function WodeAppThemeChrome({
  skin,
  workspaceSessionGroups = [],
  selectedSessionId = null,
  sessionStatusById,
  onOpenSession,
}: {
  skin: WodeAppSkinId;
  workspaceSessionGroups?: WorkspaceSessionGroup[];
  selectedSessionId?: string | null;
  sessionStatusById?: Record<string, string>;
  onOpenSession?: (workspaceId: string, sessionId: string) => void;
}) {
  const companion = useSyncExternalStore(
    subscribeCompanionPrefs,
    readWodeAppCompanionPrefs,
    readWodeAppCompanionPrefs,
  );
  const plazaStamp = useSyncExternalStore(
    subscribeWodeAppPlaza,
    getWodeAppPlazaSnapshot,
    getWodeAppPlazaSnapshot,
  );
  const showPerch = resolveCompanionPerchEnabled(companion, skin);
  const showFloat = resolveCompanionFloatEnabled(companion, skin);
  const floatAvatar = resolveFloatCompanionAvatarForSkin(companion, skin);
  const perchAvatar = resolvePerchCompanionAvatarForSkin(companion, skin);
  const [floatHost, setFloatHost] = useState<HTMLElement | null>(null);
  const [perchHost, setPerchHost] = useState<HTMLElement | null>(null);
  const openSession = onOpenSession || (() => undefined);

  useLayoutEffect(() => {
    const css = isWodeAppPlazaSkinId(skin) ? readPlazaSkinCss(skin) : "";
    const existing = document.getElementById("wapp-plaza-skin-style");
    if (!css) {
      existing?.remove();
      return;
    }
    const el = existing instanceof HTMLStyleElement ? existing : document.createElement("style");
    el.id = "wapp-plaza-skin-style";
    el.textContent = css;
    if (!el.parentNode) document.head.appendChild(el);
  }, [skin, plazaStamp]);

  useLayoutEffect(() => {
    if (!showFloat) {
      setFloatHost(null);
      return;
    }
    const sync = () => {
      const next = resolveFloatHost();
      setFloatHost((prev) => (prev === next ? prev : next));
    };
    sync();
  }, [showFloat, skin]);

  useLayoutEffect(() => {
    if (!showPerch) {
      setPerchHost(null);
      return;
    }
    const sync = () => {
      const next = resolvePerchHost();
      setPerchHost((prev) => (prev === next ? prev : next));
    };
    sync();
    const retries = [80, 250, 800, 2000].map((ms) => window.setTimeout(sync, ms));
    const surface = document.querySelector(".wapp-session-surface") || document.body;
    const observer = new MutationObserver(sync);
    observer.observe(surface, { childList: true, subtree: true });
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      for (const id of retries) window.clearTimeout(id);
      observer.disconnect();
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [showPerch, selectedSessionId]);

  const floatBuddy = showFloat && floatAvatar ? (
    <WodeAppPetBuddy
      kind={companion.kind}
      avatar={floatAvatar}
      placement="float"
      workspaceSessionGroups={workspaceSessionGroups}
      selectedSessionId={selectedSessionId}
      sessionStatusById={sessionStatusById}
      onOpenSession={openSession}
    />
  ) : null;

  const perchBuddy = showPerch && perchAvatar ? (
    <WodeAppPetBuddy
      kind={companion.perchKind}
      avatar={perchAvatar}
      placement="perch"
      showSessionPanel={false}
      workspaceSessionGroups={workspaceSessionGroups}
      selectedSessionId={selectedSessionId}
      sessionStatusById={sessionStatusById}
      onOpenSession={openSession}
    />
  ) : null;

  const floatTarget = floatHost || (typeof document !== "undefined" ? document.body : null);

  return (
    <>
      {floatBuddy && floatTarget ? createPortal(floatBuddy, floatTarget) : null}
      {perchBuddy && perchHost ? createPortal(perchBuddy, perchHost) : null}
      <WodeAppOtomeStage enabled={skin === "otome-diary"} />
      <WodeAppSummerBackdrop enabled={skin === "summer-breeze"} sessionKey={selectedSessionId} />
      <WodeAppSkinAmbientBackdrop skin={skin} sessionKey={selectedSessionId} />

      {skin === "cute-pastel" ? (
        <div className="wapp-theme-cute-ribbon" data-active="1">
          <strong>可爱马卡龙</strong>
          <span>软圆角工作台</span>
        </div>
      ) : null}
    </>
  );
}
