/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";

const DEFAULT_LIVE2D_MODEL_URL =
  "https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display@master/test/assets/shizuku/shizuku.model.json";

const LIVE2D_SCRIPTS = [
  "https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js",
  "https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js",
  "https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism2.min.js",
] as const;

/**
 * Cubism2 Live2D keeps a process-wide WebGL context. A second canvas steals it
 * and leaves the first model as a black silhouette (pixi-live2d-display#82).
 * Only one companion Live2D owner may hold the slot at a time.
 */
let live2dSlotOwner: symbol | null = null;
const live2dSlotWaiters: Array<() => void> = [];

function acquireLive2DSlot(owner: symbol): Promise<void> {
  if (live2dSlotOwner === null || live2dSlotOwner === owner) {
    live2dSlotOwner = owner;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    live2dSlotWaiters.push(() => {
      live2dSlotOwner = owner;
      resolve();
    });
  });
}

function releaseLive2DSlot(owner: symbol) {
  if (live2dSlotOwner !== owner) return;
  live2dSlotOwner = null;
  const next = live2dSlotWaiters.shift();
  next?.();
}

type Live2DModelInstance = {
  anchor: { set: (x: number, y?: number) => void };
  height: number;
  motion: (group: string) => Promise<unknown>;
  scale: { set: (value: number) => void };
  textures?: Array<{
    baseTexture?: {
      valid?: boolean;
      width?: number;
      height?: number;
    };
  }>;
  width: number;
  x: number;
  y: number;
  destroy: () => void;
};

type PixiApplication = {
  renderer: {
    resize: (width: number, height: number) => void;
    gl?: WebGLRenderingContext | null;
  };
  stage: { addChild: (model: Live2DModelInstance) => void };
  destroy: (removeView?: boolean, options?: { children?: boolean; texture?: boolean; baseTexture?: boolean }) => void;
};

type PixiNamespace = {
  Application: new (options: Record<string, unknown>) => PixiApplication;
  live2d?: { Live2DModel?: { from: (url: string) => Promise<Live2DModelInstance> } };
};

/**
 * Local structural view of the runtime globals. Kept as a cast instead of a
 * `declare global` augmentation so this file's PixiNamespace never collides
 * with the richer one in wodeapp-live2d-assistant.tsx (TS2717).
 */
type Live2DRuntimeWindow = Window & {
  PIXI?: PixiNamespace;
  Live2D?: unknown;
};

function live2dWindow(): Live2DRuntimeWindow {
  return window as Live2DRuntimeWindow;
}

let live2dRuntimePromise: Promise<void> | null = null;

function loadScript(src: string) {
  const existing = document.querySelector<HTMLScriptElement>(`script[data-wodeapp-live2d="${src}"]`);
  if (existing?.dataset.loaded === "true") return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const script = existing ?? document.createElement("script");
    const handleLoad = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    const handleError = () => reject(new Error(`无法加载 Live2D：${src}`));
    script.addEventListener("load", handleLoad, { once: true });
    script.addEventListener("error", handleError, { once: true });
    if (!existing) {
      script.src = src;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.dataset.wodeappLive2d = src;
      document.head.appendChild(script);
    }
  });
}

function loadLive2DRuntime() {
  const runtimeWindow = live2dWindow();
  if (runtimeWindow.PIXI?.live2d?.Live2DModel && runtimeWindow.Live2D) return Promise.resolve();
  live2dRuntimePromise ??= LIVE2D_SCRIPTS.reduce(
    (chain, src) => chain.then(() => loadScript(src)),
    Promise.resolve(),
  ).catch((error: unknown) => {
    live2dRuntimePromise = null;
    throw error;
  });
  return live2dRuntimePromise;
}

function modelTexturesReady(model: Live2DModelInstance) {
  const textures = model.textures;
  if (!Array.isArray(textures) || textures.length === 0) return false;
  return textures.every((texture) => {
    const base = texture?.baseTexture;
    if (!base) return false;
    if (base.valid === false) return false;
    if (typeof base.width === "number" && base.width <= 0) return false;
    if (typeof base.height === "number" && base.height <= 0) return false;
    return true;
  });
}

function softDestroyApp(app: PixiApplication | null, model: Live2DModelInstance | null) {
  try {
    model?.destroy();
  } catch {
    // ignore
  }
  try {
    // Keep shared baseTextures — destroying them blanks the next mount's face atlas.
    app?.destroy(false, { children: true, texture: false, baseTexture: false });
  } catch {
    // ignore
  }
}

function waitAnimationFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Compact Live2D canvas for the floating companion slot (no speech chrome).
 */
export function WodeAppCompanionLive2D({
  reacting,
  className,
  modelUrl,
}: {
  reacting?: boolean;
  className?: string;
  /** Cubism2 model URL; defaults to the built-in 小雪 model. */
  modelUrl?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const modelRef = useRef<Live2DModelInstance | null>(null);
  const appRef = useRef<PixiApplication | null>(null);
  const ownerRef = useRef<symbol>(Symbol("wodeapp-companion-live2d"));
  const failureStreakRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [remountKey, setRemountKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | null = null;
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const owner = ownerRef.current;
    if (!host || !canvas) return;

    const width = Math.max(120, host.clientWidth || 148);
    const height = Math.max(120, host.clientHeight || 148);
    setReady(false);

    const bumpRemount = () => {
      if (cancelled) return;
      setRemountKey((value) => value + 1);
    };

    const onContextLost = (event: Event) => {
      event.preventDefault();
      bumpRemount();
    };

    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const model = modelRef.current;
      const gl = appRef.current?.renderer?.gl;
      if (gl?.isContextLost?.() || (model && !modelTexturesReady(model))) {
        bumpRemount();
      }
    };

    canvas.addEventListener("webglcontextlost", onContextLost);
    document.addEventListener("visibilitychange", onVisibility);

    (async () => {
      let app: PixiApplication | null = null;
      let model: Live2DModelInstance | null = null;
      try {
        await acquireLive2DSlot(owner);
        if (cancelled) return;
        await loadLive2DRuntime();
        if (cancelled) return;
        const PIXI = live2dWindow().PIXI;
        const Live2DModel = PIXI?.live2d?.Live2DModel;
        if (!PIXI?.Application || !Live2DModel) {
          throw new Error("Live2D 运行时未就绪");
        }

        app = new PIXI.Application({
          view: canvas,
          width,
          height,
          backgroundAlpha: 0,
          antialias: true,
          autoDensity: true,
          autoStart: true,
          resolution: Math.min(2, window.devicePixelRatio || 1),
          powerPreference: "low-power",
          // Keep the last frame readable (CDP/toDataURL) and avoid rare blank flips after composite.
          preserveDrawingBuffer: true,
        });
        appRef.current = app;

        // Retry once: partial CDN/texture failures leave a black silhouette body.
        let loaded: Live2DModelInstance | null = null;
        let lastError: unknown = null;
        const url = modelUrl?.trim() || DEFAULT_LIVE2D_MODEL_URL;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            loaded = await Live2DModel.from(url);
            if (cancelled) {
              softDestroyApp(app, loaded);
              app = null;
              return;
            }
            await waitAnimationFrame();
            await waitAnimationFrame();
            if (!modelTexturesReady(loaded) && attempt === 0) {
              try {
                loaded.destroy();
              } catch {
                // ignore
              }
              loaded = null;
              continue;
            }
            break;
          } catch (reason) {
            lastError = reason;
            loaded = null;
          }
        }
        if (!loaded) {
          throw lastError instanceof Error ? lastError : new Error("Live2D 贴图加载不完整");
        }

        model = loaded;
        const scale = Math.min(width / model.width, height / model.height) * 0.92;
        model.scale.set(scale);
        model.anchor.set(0.5, 0.9);
        model.x = width / 2;
        model.y = height * 0.92;
        if (!app) {
          throw new Error("Live2D 画布初始化失败");
        }
        app.stage.addChild(model);
        modelRef.current = model;
        failureStreakRef.current = 0;
        setReady(true);
        setError(null);
        void model.motion("idle").catch(() => undefined);
      } catch (err) {
        softDestroyApp(app, model);
        appRef.current = null;
        modelRef.current = null;
        if (!cancelled) {
          failureStreakRef.current += 1;
          setReady(false);
          setError(err instanceof Error ? err.message : "Live2D 加载失败");
          // Auto-recover from flaky CDN / transient WebGL loss (canvas sits inside a <button>).
          if (failureStreakRef.current <= 3) {
            retryTimer = window.setTimeout(() => {
              if (!cancelled) bumpRemount();
            }, 800 * failureStreakRef.current);
          }
        }
      }
    })();

    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      document.removeEventListener("visibilitychange", onVisibility);
      const model = modelRef.current;
      const app = appRef.current;
      modelRef.current = null;
      appRef.current = null;
      softDestroyApp(app, model);
      releaseLive2DSlot(owner);
    };
  }, [modelUrl, remountKey]);

  useEffect(() => {
    const model = modelRef.current;
    if (!model || !reacting) return;
    void model.motion("tap_body").catch(() => model.motion("idle").catch(() => undefined));
  }, [reacting]);

  return (
    <div ref={hostRef} className={className || "wapp-theme-pet-live2d"}>
      <canvas ref={canvasRef} className="wapp-theme-pet-live2d-canvas" aria-hidden />
      {!ready && !error ? <span className="wapp-theme-pet-live2d-status">加载中</span> : null}
      {error ? <span className="wapp-theme-pet-live2d-status is-error">加载失败</span> : null}
    </div>
  );
}
