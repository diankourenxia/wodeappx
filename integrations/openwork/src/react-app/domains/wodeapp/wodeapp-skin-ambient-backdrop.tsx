import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { WodeAppSkinId } from "./wodeapp-skins";

type AmbientSpec = {
  className: string;
  poster: string;
  video?: string;
  brandLine?: string;
};

const SKIN_AMBIENT: Partial<Record<WodeAppSkinId, AmbientSpec>> = {
  "aurora-night": {
    className: "wapp-aurora-ambient-backdrop",
    poster: "skin-aurora-night-poster.jpg",
    video: "skin-aurora-night.mp4",
    brandLine: "极光之下，心事可航行",
  },
  "forest-mist": {
    className: "wapp-forest-ambient-backdrop",
    poster: "skin-forest-mist-poster.jpg",
    brandLine: "雾起林间，慢一点也好",
  },
  "coffee-loft": {
    className: "wapp-coffee-ambient-backdrop",
    poster: "skin-coffee-loft-poster.jpg",
    brandLine: "热饮在手，灵感慢炖",
  },
  "noir-jazz": {
    className: "wapp-noir-ambient-backdrop",
    poster: "skin-noir-jazz-poster.jpg",
    brandLine: "低音铺底，金边留白",
  },
};

function resolveAmbientHost(): HTMLElement | null {
  const surface = document.querySelector(".wapp-session-surface");
  return surface instanceof HTMLElement ? surface : null;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useLayoutEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  return reduced;
}

function assetUrl(file: string): string {
  return `${import.meta.env.BASE_URL}${file}`;
}

/**
 * Session-surface ambient layer for batch skins (image or looping video).
 * Portals into `.wapp-session-surface` as absolute backdrop — must stay out of flex flow.
 */
export function WodeAppSkinAmbientBackdrop({
  skin,
  sessionKey,
}: {
  skin: WodeAppSkinId;
  sessionKey?: string | null;
}) {
  const spec = SKIN_AMBIENT[skin];
  const enabled = Boolean(spec);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  useLayoutEffect(() => {
    if (!enabled) {
      setHost(null);
      return;
    }
    const sync = () => {
      const next = resolveAmbientHost();
      setHost((prev) => (prev === next ? prev : next));
    };
    sync();
    const retries = [80, 250, 800, 2000].map((ms) => window.setTimeout(sync, ms));
    window.addEventListener("focus", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      for (const id of retries) window.clearTimeout(id);
      window.removeEventListener("focus", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [enabled, skin, sessionKey]);

  useLayoutEffect(() => {
    if (!enabled || !spec?.brandLine) return;
    const brand = document.querySelector(".wapp-brand-spacer");
    brand?.setAttribute("data-season", spec.brandLine);
  }, [enabled, spec?.brandLine, sessionKey]);

  if (!enabled || !spec || !host) return null;

  const showVideo = Boolean(spec.video) && !reducedMotion;

  return createPortal(
    <div className={spec.className} aria-hidden="true">
      {showVideo ? (
        <video
          src={assetUrl(spec.video!)}
          poster={assetUrl(spec.poster)}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
        />
      ) : (
        <img src={assetUrl(spec.poster)} alt="" draggable={false} decoding="async" />
      )}
    </div>,
    host,
  );
}

export function skinHasAmbientBackdrop(skin: WodeAppSkinId): boolean {
  return Boolean(SKIN_AMBIENT[skin]);
}
