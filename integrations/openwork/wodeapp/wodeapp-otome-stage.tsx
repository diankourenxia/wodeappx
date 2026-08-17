/** @jsxImportSource react */
import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

const LEFT_POSTER = `${import.meta.env.BASE_URL}skin-otome-stage-left.png`;
const RIGHT_POSTER = `${import.meta.env.BASE_URL}skin-otome-stage-right.png`;
const LEFT_WEBP = `${import.meta.env.BASE_URL}skin-otome-stage-left.webp`;
const RIGHT_WEBP = `${import.meta.env.BASE_URL}skin-otome-stage-right.webp`;

function resolveOtomeStageHost(): HTMLElement | null {
  const chat = document.querySelector(".wapp-content-chat");
  return chat instanceof HTMLElement ? chat : null;
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

function OtomeStageFrame({
  side,
  poster,
  webp,
  reducedMotion,
}: {
  side: "left" | "right";
  poster: string;
  webp: string;
  reducedMotion: boolean;
}) {
  // Animated WebP via <img> — much lighter than dual <video> decode + blend.
  return (
    <img
      className={`wapp-otome-stage-frame is-${side}`}
      src={reducedMotion ? poster : webp}
      alt=""
      aria-hidden="true"
      draggable={false}
      decoding="async"
      loading="eager"
    />
  );
}

/**
 * Otome / 蔷薇日记 chat-column ambient: left & right handsome stage loops.
 * Portaled into `.wapp-content-chat` (not the browser stage pane).
 * Uses animated WebP (not video) for low CPU/GPU cost.
 */
export function WodeAppOtomeStage({ enabled }: { enabled: boolean }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  useLayoutEffect(() => {
    if (!enabled) {
      setHost(null);
      return;
    }
    const sync = () => {
      const next = resolveOtomeStageHost();
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
  }, [enabled]);

  if (!enabled || !host) return null;

  return createPortal(
    <div className="wapp-otome-stage" aria-hidden="true" data-reduced-motion={reducedMotion ? "1" : "0"}>
      <OtomeStageFrame side="left" poster={LEFT_POSTER} webp={LEFT_WEBP} reducedMotion={reducedMotion} />
      <OtomeStageFrame side="right" poster={RIGHT_POSTER} webp={RIGHT_WEBP} reducedMotion={reducedMotion} />
    </div>,
    host,
  );
}
