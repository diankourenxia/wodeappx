import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { WodeAppSkinId } from "./wodeapp-skins";

type AmbientSpec = {
  className: string;
  poster: string;
  video?: string;
  /** Ambient loop speed. Aurora stock clip is ~8s; keep well below 1 to avoid flicker. */
  playbackRate?: number;
  brandLine?: string;
  keepsakeClass: string;
};

const SKIN_AMBIENT: Partial<Record<WodeAppSkinId, AmbientSpec>> = {
  "aurora-night": {
    className: "wapp-aurora-ambient-backdrop",
    poster: "skin-aurora-night-poster.jpg",
    video: "skin-aurora-night.mp4",
    // 8s clip → ~20s perceived loop; stock 1x reads as flicker behind chat.
    playbackRate: 0.4,
    brandLine: "极光之下，心事可航行",
    keepsakeClass: "wapp-batch-keepsakes is-aurora",
  },
  "forest-mist": {
    className: "wapp-forest-ambient-backdrop",
    poster: "skin-forest-mist-poster.jpg",
    brandLine: "雾起林间，慢一点也好",
    keepsakeClass: "wapp-batch-keepsakes is-forest",
  },
  "coffee-loft": {
    className: "wapp-coffee-ambient-backdrop",
    poster: "skin-coffee-loft-poster.jpg",
    brandLine: "热饮在手，灵感慢炖",
    keepsakeClass: "wapp-batch-keepsakes is-coffee",
  },
  "noir-jazz": {
    className: "wapp-noir-ambient-backdrop",
    poster: "skin-noir-jazz-poster.jpg",
    brandLine: "低音铺底，金边留白",
    keepsakeClass: "wapp-batch-keepsakes is-noir",
  },
};

/**
 * Prefer the live chat surface; when the agents pane is empty (no session DOM),
 * fall back to the main column so the ambient still paints the workspace.
 */
function resolveAmbientHost(): HTMLElement | null {
  const surface = document.querySelector(".wapp-session-surface");
  if (surface instanceof HTMLElement) return surface;
  const main = document.querySelector(".wapp-workspace-shell > .wapp-workspace-main");
  return main instanceof HTMLElement ? main : null;
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

function syncBatchKeepsakes(keepsakeClass: string): void {
  const sidebar = document.querySelector(".wapp-sidebar");
  if (!(sidebar instanceof HTMLElement)) return;
  sidebar.querySelector(".wapp-batch-keepsakes")?.remove();
  const count = Math.min(5, Math.max(2, document.querySelectorAll(".wapp-recent-item").length || 3));
  const holder = document.createElement("div");
  holder.className = keepsakeClass;
  holder.setAttribute("aria-hidden", "true");
  for (let i = 0; i < count; i += 1) {
    const bead = document.createElement("i");
    bead.className = `wapp-batch-keepsake wapp-batch-keepsake-${i % 3}`;
    const tilt = ((i * 47) % 41) - 20;
    const drift = ((i * 31) % 15) - 7;
    bead.style.transform = `rotate(${tilt}deg) translateY(${drift}px)`;
    holder.appendChild(bead);
  }
  sidebar.appendChild(holder);
}

/**
 * Ambient layer for batch skins (image or looping video).
 * Portals into `.wapp-session-surface` when present, else `.wapp-workspace-main`.
 * Must stay `position:absolute` out of flex flow.
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
  const videoRef = useRef<HTMLVideoElement | null>(null);

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
    if (!enabled || !spec) return;
    const brand = document.querySelector(".wapp-brand-spacer");
    if (spec.brandLine) brand?.setAttribute("data-season", spec.brandLine);
    syncBatchKeepsakes(spec.keepsakeClass);
    const scroll = document.querySelector(".wapp-sidebar-scroll");
    const observer = new MutationObserver(() => syncBatchKeepsakes(spec.keepsakeClass));
    if (scroll) observer.observe(scroll, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.querySelector(".wapp-batch-keepsakes")?.remove();
    };
  }, [enabled, spec, sessionKey]);

  useLayoutEffect(() => {
    const video = videoRef.current;
    if (!video || !spec?.playbackRate) return;
    const rate = spec.playbackRate;
    const apply = () => {
      if (Math.abs(video.playbackRate - rate) > 0.001) video.playbackRate = rate;
    };
    apply();
    video.addEventListener("loadedmetadata", apply);
    video.addEventListener("play", apply);
    // Some engines reset rate on loop/seek; re-assert without fighting user agents.
    const onTime = () => apply();
    video.addEventListener("seeking", onTime);
    return () => {
      video.removeEventListener("loadedmetadata", apply);
      video.removeEventListener("play", apply);
      video.removeEventListener("seeking", onTime);
    };
  }, [spec?.playbackRate, host, skin, sessionKey, reducedMotion]);

  if (!enabled || !spec || !host) return null;

  const onMain = host.classList.contains("wapp-workspace-main");
  // Aurora (and other video ambients) play everywhere at playbackRate; reduced-motion stays poster-only.
  const showVideo = Boolean(spec.video) && !reducedMotion;

  return createPortal(
    <div
      className={`${spec.className}${onMain ? " is-main-stage" : ""}`}
      aria-hidden="true"
    >
      {showVideo ? (
        <video
          ref={videoRef}
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
