/** @jsxImportSource react */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const LEFT_POSTER = `${import.meta.env.BASE_URL}skin-otome-stage-left.png`;
const RIGHT_POSTER = `${import.meta.env.BASE_URL}skin-otome-stage-right.png`;
const LEFT_WEBM = `${import.meta.env.BASE_URL}skin-otome-stage-left.webm`;
const LEFT_MP4 = `${import.meta.env.BASE_URL}skin-otome-stage-left.mp4`;
const RIGHT_WEBM = `${import.meta.env.BASE_URL}skin-otome-stage-right.webm`;
const RIGHT_MP4 = `${import.meta.env.BASE_URL}skin-otome-stage-right.mp4`;

function resolveOtomeStageHost(): HTMLElement | null {
  const chat = document.querySelector(".wapp-content-chat");
  return chat instanceof HTMLElement ? chat : null;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  return reduced;
}

function OtomeStageVideo({
  side,
  poster,
  webm,
  mp4,
  reducedMotion,
}: {
  side: "left" | "right";
  poster: string;
  webm: string;
  mp4: string;
  reducedMotion: boolean;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reducedMotion) {
      el.pause();
      return;
    }
    const play = () => {
      void el.play().catch(() => undefined);
    };
    play();
    const onVis = () => {
      if (document.hidden) el.pause();
      else play();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [reducedMotion, webm, mp4]);

  return (
    <video
      ref={ref}
      className={`wapp-otome-stage-video is-${side}`}
      poster={poster}
      muted
      playsInline
      loop
      autoPlay={!reducedMotion}
      preload="metadata"
      aria-hidden="true"
      tabIndex={-1}
    >
      <source src={webm} type="video/webm" />
      <source src={mp4} type="video/mp4" />
    </video>
  );
}

/**
 * Otome / 蔷薇日记 chat-column ambient: left & right handsome stage loops.
 * Portaled into `.wapp-content-chat` (not the browser stage pane).
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
      <OtomeStageVideo
        side="left"
        poster={LEFT_POSTER}
        webm={LEFT_WEBM}
        mp4={LEFT_MP4}
        reducedMotion={reducedMotion}
      />
      <OtomeStageVideo
        side="right"
        poster={RIGHT_POSTER}
        webm={RIGHT_WEBM}
        mp4={RIGHT_MP4}
        reducedMotion={reducedMotion}
      />
    </div>,
    host,
  );
}
