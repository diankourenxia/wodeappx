import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

const BEACH_VIDEO = `${import.meta.env.BASE_URL}skin-summer-beach.mp4`;
const BEACH_POSTER = `${import.meta.env.BASE_URL}skin-summer-beach-poster.jpg`;

function resolveSummerBackdropHost(): HTMLElement | null {
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

/** Time-of-day slot for the sidebar sand tint (跟着太阳走的沙滩). */
function summerTimeSlot(hour: number): "dawn" | "day" | "dusk" | "night" {
  if (hour >= 5 && hour < 8) return "dawn";
  if (hour >= 8 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}

/** Seasonal one-liner under the brand title (今日宜出海). */
const SUMMER_SEASON_LINES: Record<number, string> = {
  4: "初夏微醺，宜听潮",
  5: "仲夏初始，宜踏浪",
  6: "七月流火，宜出海",
  7: "夏末未央，宜拾贝",
};

function summerSeasonLine(month: number): string {
  return SUMMER_SEASON_LINES[month] ?? "心向海风，四季皆夏";
}

/** Beached shells: one keepsake per recent session, capped at 5. */
function syncBeachedShells(): void {
  const sidebar = document.querySelector(".wapp-sidebar");
  if (!sidebar) return;
  const count = Math.min(5, document.querySelectorAll(".wapp-recent-item").length);
  sidebar.querySelector(".wapp-summer-shells")?.remove();
  if (count === 0) return;
  const holder = document.createElement("div");
  holder.className = "wapp-summer-shells";
  holder.setAttribute("aria-hidden", "true");
  for (let i = 0; i < count; i += 1) {
    const shell = document.createElement("i");
    shell.className = `wapp-summer-shell wapp-summer-shell-${i % 3}`;
    const tilt = ((i * 47) % 41) - 20;
    const drift = ((i * 31) % 15) - 7;
    shell.style.transform = `rotate(${tilt}deg) translateY(${drift}px)`;
    holder.appendChild(shell);
  }
  sidebar.appendChild(holder);
}

/**
 * Summer-breeze session ambient: looping beach-wave video behind the whole
 * conversation surface (portaled into `.wapp-session-surface`, layered under
 * messages via CSS). Stays visible with or without messages. Falls back to a
 * static poster frame when the user prefers reduced motion.
 */
export function WodeAppSummerBackdrop({
  enabled,
  sessionKey,
}: {
  enabled: boolean;
  sessionKey?: string | null;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  useLayoutEffect(() => {
    if (!enabled) {
      setHost(null);
      return;
    }
    const sync = () => {
      const next = resolveSummerBackdropHost();
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
  }, [enabled, sessionKey]);

  // Sun-tracking sand tint + seasonal brand line, refreshed every 15 min.
  useLayoutEffect(() => {
    if (!enabled) return;
    const apply = () => {
      const now = new Date();
      const shell = document.querySelector(".wapp-skin-summer-breeze");
      shell?.setAttribute("data-summer-time", summerTimeSlot(now.getHours()));
      const brand = document.querySelector(".wapp-brand-spacer");
      brand?.setAttribute("data-season", summerSeasonLine(now.getMonth()));
      syncBeachedShells();
    };
    apply();
    const timer = window.setInterval(apply, 15 * 60 * 1000);
    const scroll = document.querySelector(".wapp-sidebar-scroll");
    const observer = new MutationObserver(() => syncBeachedShells());
    if (scroll) observer.observe(scroll, { childList: true, subtree: true });
    return () => {
      window.clearInterval(timer);
      observer.disconnect();
    };
  }, [enabled, sessionKey]);

  // Full-window seagull flyby: one fixed layer on body, CSS-only flight + flap.
  useLayoutEffect(() => {
    if (!enabled) return;
    const gull = document.createElement("div");
    gull.className = "wapp-summer-gull-layer";
    gull.setAttribute("aria-hidden", "true");
    document.body.appendChild(gull);
    return () => gull.remove();
  }, [enabled]);

  if (!enabled || !host) return null;

  const onMain = host.classList.contains("wapp-workspace-main");
  const showVideo = !reducedMotion && !onMain;

  return createPortal(
    <div className={`wapp-summer-beach-backdrop${onMain ? " is-main-stage" : ""}`} aria-hidden="true">
      {!showVideo ? (
        <img src={BEACH_POSTER} alt="" draggable={false} decoding="async" />
      ) : (
        <video
          src={BEACH_VIDEO}
          poster={BEACH_POSTER}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
        />
      )}
    </div>,
    host,
  );
}
