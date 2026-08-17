import type { UIMessage } from "ai";
import { Download, Loader2, MessageSquareText, Pause, Play, RotateCcw, Settings2, Square, Trash2, UserRound, Volume2, VolumeX, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LocalNaturalVoice, LocalNaturalVoicePackProgress, LocalNaturalVoicePackStatus, LocalVoicePackProgress, LocalVoicePackStatus } from "@/app/lib/desktop";

/** Hard-off switch for WodeAppX Live2D. Flip to true only when re-enabling the feature. */
export const WODEAPPX_LIVE2D_ENABLED = false;

const LIVE2D_VISIBLE_KEY = "wodeappx.live2d.visible";
const LIVE2D_PAUSED_KEY = "wodeappx.live2d.paused";
const LIVE2D_VOICE_KEY = "wodeappx.live2d.voice";
const LIVE2D_GREETING_KEY = "wodeappx.live2d.greeting";
const LIVE2D_NATURAL_VOICE_KEY = "wodeappx.live2d.naturalVoice";
const DEFAULT_LIVE2D_GREETING = "你好，我是小雪。有什么需要，直接告诉我吧。";
const LIVE2D_MODEL_URL = "https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display@master/test/assets/shizuku/shizuku.model.json";
/** Prefer Chinese speakers that map to stable Kokoro sids. */
const PREFERRED_NATURAL_VOICE_IDS = ["zf_001", "zf_043", "zf_042", "zf_038", "zf_047", "zm_009", "zm_012", "zm_045"] as const;
/** Stored ids that silently fell back before — migrate away when still listed as unreliable. */
const UNRELIABLE_NATURAL_VOICE_IDS = new Set([
  "zf_002", "zf_003", "zf_004", "zf_005", "zf_007",
  "zf_017", "zf_018", "zf_019", "zf_021", "zf_026",
]);

const LIVE2D_SCRIPTS = [
  "https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js",
  "https://cdn.jsdelivr.net/gh/dylanNew/live2d/webgl/Live2D/lib/live2d.min.js",
  "https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism2.min.js",
] as const;

type Live2DCoreModel = {
  setParamFloat?: (id: string, value: number) => void;
  setParameterValueById?: (id: string, value: number) => void;
};

type Live2DModelInstance = {
  anchor: { set: (x: number, y?: number) => void };
  height: number;
  internalModel?: { coreModel?: Live2DCoreModel };
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
  renderer: { resize: (width: number, height: number) => void };
  stage: { addChild: (model: Live2DModelInstance) => void };
  destroy: (removeView?: boolean, options?: { children?: boolean; texture?: boolean; baseTexture?: boolean }) => void;
};

type PixiNamespace = {
  Application: new (options: Record<string, unknown>) => PixiApplication;
  live2d?: { Live2DModel?: { from: (url: string) => Promise<Live2DModelInstance> } };
};

declare global {
  interface Window {
    PIXI?: PixiNamespace;
    Live2D?: unknown;
  }
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
    const handleError = () => reject(new Error(`无法加载 Live2D 运行资源：${src}`));
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
  if (window.PIXI?.live2d?.Live2DModel && window.Live2D) return Promise.resolve();
  live2dRuntimePromise ??= LIVE2D_SCRIPTS.reduce(
    (chain, src) => chain.then(() => loadScript(src)),
    Promise.resolve(),
  ).catch((error: unknown) => {
    live2dRuntimePromise = null;
    throw error;
  });
  return live2dRuntimePromise;
}

function readStoredFlag(key: string, fallback: boolean) {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "true";
  } catch {
    return fallback;
  }
}

function writeStoredFlag(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Storage can be unavailable in hardened web builds; the current session still works.
  }
}

function readStoredText(key: string, fallback: string) {
  try {
    return window.localStorage.getItem(key)?.trim() || fallback;
  } catch {
    return fallback;
  }
}

function writeStoredText(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable in hardened web builds; the current session still works.
  }
}

function formatDownloadSize(bytes: number) {
  return `${Math.max(1, Math.round(bytes / 1_000_000))} MB`;
}

function wavBase64ToUrl(base64: string) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}

function setMouth(model: Live2DModelInstance, value: number) {
  const coreModel = model.internalModel?.coreModel;
  const next = Math.max(0, Math.min(1, value));
  coreModel?.setParamFloat?.("PARAM_MOUTH_OPEN_Y", next);
  coreModel?.setParameterValueById?.("ParamMouthOpenY", next);
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

function latestAssistantReply(messages: UIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    const text = message.parts
      .filter((part): part is Extract<UIMessage["parts"][number], { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (text) return { id: message.id, text };
  }
  return null;
}

function sanitizeSpeechText(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, "。")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/[|`*_~>]/g, " ")
    // Kokoro lexicon rejects some ornament/symbol glyphs (e.g. ❓) that are not always
    // covered by Extended_Pictographic alone — strip them before synthesis.
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[\u2000-\u27BF\uFE00-\uFE0F\uFFF0-\uFFFF]/g, " ")
    .replace(/[^\p{Script=Han}\p{L}\p{N}\s，。！？、；：,.!?;:'"（）()《》“”‘’—…%+\-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Short spoken digest for auto-reply: first 1–2 sentences, not the full answer. */
function speechTextFromReply(text: string) {
  const spoken = sanitizeSpeechText(text);
  if (!spoken) return "";
  if (spoken.length <= 72) return spoken;

  const sentences = spoken
    .split(/(?<=[。！？.!?])/)
    .map((part) => part.trim())
    .filter(Boolean);
  let digest = "";
  for (const sentence of sentences) {
    const next = `${digest}${sentence}`;
    if (!digest) {
      digest = sentence.length > 72 ? `${sentence.slice(0, 72)}。` : sentence;
      if (digest.length >= 48) break;
      continue;
    }
    if (next.length <= 72) {
      digest = next;
      break;
    }
    break;
  }
  return digest || `${spoken.slice(0, 72)}。`;
}

function preferredSpeechVoice(voices: SpeechSynthesisVoice[], language: string) {
  const languagePrefix = language.slice(0, 2).toLowerCase();
  const matching = voices.filter((voice) => voice.lang.toLowerCase().startsWith(languagePrefix));
  if (languagePrefix !== "zh") return matching[0];
  const preferredNames = [
    "xiaoxiao", "婷婷", "tingting", "美嘉", "mei-jia", "meijia",
    "flo", "sandy", "shelley", "hiu maan", "hiumaan", "sin-ji", "sinji",
  ];
  return matching.find((voice) => preferredNames.some((name) => voice.name.toLowerCase().includes(name))) ?? matching[0];
}

export function WodeAppLive2DAssistant(props: {
  active: boolean;
  messages: UIMessage[];
  sessionId: string;
}) {
  if (!WODEAPPX_LIVE2D_ENABLED) return null;
  return <WodeAppLive2DAssistantInner {...props} />;
}

function WodeAppLive2DAssistantInner({
  active,
  messages,
  sessionId,
}: {
  active: boolean;
  messages: UIMessage[];
  sessionId: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const modelRef = useRef<Live2DModelInstance | null>(null);
  const pendingSpeechRef = useRef(false);
  const lastSpokenReplyIdRef = useRef<string | null>(null);
  const lastSpokenTextRef = useRef<string | null>(null);
  const greetingPendingRef = useRef(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const speechSafetyTimerRef = useRef<number | null>(null);
  const speechSequenceRef = useRef(0);
  const [visible, setVisible] = useState(() => readStoredFlag(LIVE2D_VISIBLE_KEY, false));
  const [paused, setPaused] = useState(() => readStoredFlag(LIVE2D_PAUSED_KEY, false));
  const [voiceEnabled, setVoiceEnabled] = useState(() => readStoredFlag(LIVE2D_VOICE_KEY, true));
  const [greetingText, setGreetingText] = useState(() => readStoredText(LIVE2D_GREETING_KEY, DEFAULT_LIVE2D_GREETING));
  const [greetingDraft, setGreetingDraft] = useState(() => readStoredText(LIVE2D_GREETING_KEY, DEFAULT_LIVE2D_GREETING));
  const [editingGreeting, setEditingGreeting] = useState(false);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [voicePack, setVoicePack] = useState<LocalVoicePackStatus | null>(null);
  const [voicePackProgress, setVoicePackProgress] = useState<LocalVoicePackProgress | null>(null);
  const [voicePackBusy, setVoicePackBusy] = useState(false);
  const [voicePackError, setVoicePackError] = useState<string | null>(null);
  const [naturalVoicePack, setNaturalVoicePack] = useState<LocalNaturalVoicePackStatus | null>(null);
  const [naturalVoicePackProgress, setNaturalVoicePackProgress] = useState<LocalNaturalVoicePackProgress | null>(null);
  const [naturalVoicePackBusy, setNaturalVoicePackBusy] = useState(false);
  const [naturalVoicePackError, setNaturalVoicePackError] = useState<string | null>(null);
  const [naturalVoices, setNaturalVoices] = useState<LocalNaturalVoice[]>([]);
  const [naturalVoiceId, setNaturalVoiceId] = useState(() => readStoredText(LIVE2D_NATURAL_VOICE_KEY, ""));
  const [speaking, setSpeaking] = useState(false);
  const [speechBusy, setSpeechBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const reply = useMemo(() => latestAssistantReply(messages), [messages]);

  const close = useCallback(() => {
    setVisible(false);
    setEditingGreeting(false);
    setVoiceSettingsOpen(false);
    writeStoredFlag(LIVE2D_VISIBLE_KEY, false);
  }, []);

  const open = useCallback(() => {
    greetingPendingRef.current = true;
    setVisible(true);
    writeStoredFlag(LIVE2D_VISIBLE_KEY, true);
  }, []);

  const clearSpeechSafetyTimer = useCallback(() => {
    if (speechSafetyTimerRef.current !== null) {
      window.clearTimeout(speechSafetyTimerRef.current);
      speechSafetyTimerRef.current = null;
    }
  }, []);

  const stopLocalPlayback = useCallback(() => {
    clearSpeechSafetyTimer();
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.ontimeupdate = null;
      try {
        audio.pause();
      } catch {
        /* ignore */
      }
    }
    audioRef.current = null;
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
    setSpeaking(false);
    setSpeechBusy(false);
    if (modelRef.current) setMouth(modelRef.current, 0);
  }, [clearSpeechSafetyTimer]);

  const stopSpeech = useCallback(async () => {
    speechSequenceRef.current += 1;
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    stopLocalPlayback();
    // Soft-cancel in background so a new 试听 is not blocked on worker IPC.
    void window.__OPENWORK_ELECTRON__?.system?.cancelLocalNaturalSpeech?.().catch(() => undefined);
  }, [stopLocalPlayback]);

  const armSpeechSafetyTimer = useCallback((sequence: number, durationMs: number) => {
    clearSpeechSafetyTimer();
    speechSafetyTimerRef.current = window.setTimeout(() => {
      if (sequence !== speechSequenceRef.current) return;
      stopLocalPlayback();
    }, Math.max(2_500, durationMs + 1_500));
  }, [clearSpeechSafetyTimer, stopLocalPlayback]);

  const speakWithSystemVoice = useCallback((text: string, sequence: number) => {
    const normalized = text.trim();
    if (!normalized || !("speechSynthesis" in window)) {
      if (sequence === speechSequenceRef.current) {
        setSpeaking(false);
        setSpeechBusy(false);
      }
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(normalized);
    utterance.lang = "zh-CN";
    utterance.rate = 1;
    utterance.pitch = 1.05;
    const matchingVoice = preferredSpeechVoice(window.speechSynthesis.getVoices(), utterance.lang);
    if (matchingVoice) utterance.voice = matchingVoice;
    utterance.onstart = () => {
      if (sequence !== speechSequenceRef.current) return;
      setSpeaking(true);
      setSpeechBusy(true);
      armSpeechSafetyTimer(sequence, Math.min(60_000, Math.max(3_000, normalized.length * 220)));
    };
    utterance.onend = () => {
      if (sequence !== speechSequenceRef.current) return;
      stopLocalPlayback();
    };
    utterance.onerror = () => {
      if (sequence !== speechSequenceRef.current) return;
      stopLocalPlayback();
    };
    setSpeaking(true);
    setSpeechBusy(true);
    armSpeechSafetyTimer(sequence, Math.min(60_000, Math.max(3_000, normalized.length * 220)));
    window.speechSynthesis.speak(utterance);
  }, [armSpeechSafetyTimer, stopLocalPlayback]);

  const speakChineseText = useCallback(async (text: string, options?: { digest?: boolean; allowFallback?: boolean }) => {
    const normalized = (options?.digest === false ? sanitizeSpeechText(text) : speechTextFromReply(text)).trim() || text.trim();
    if (!normalized) return;
    // End previous turn immediately (do not await cancel IPC).
    void stopSpeech();
    const sequence = speechSequenceRef.current;
    const voice = naturalVoices.find((item) => item.id === naturalVoiceId) ?? naturalVoices[0];
    const synthesize = window.__OPENWORK_ELECTRON__?.system?.synthesizeLocalNaturalSpeech;
    // Preview must use the selected speaker; auto-reply may fall back for reliability.
    const allowFallback = options?.allowFallback ?? options?.digest !== false;
    if (naturalVoicePack?.installed && voice && synthesize) {
      try {
        // Keep mouth idle while synthesizing — only animate once audio actually plays.
        setSpeaking(false);
        setSpeechBusy(true);
        const result = await Promise.race([
          synthesize({ text: normalized, sid: voice.sid, speed: 1, allowFallback }),
          new Promise<never>((_resolve, reject) => {
            window.setTimeout(() => reject(new Error("自然语音生成超时")), 45_000);
          }),
        ]);
        if (sequence !== speechSequenceRef.current) return;
        if (!result?.wavBase64) throw new Error("自然语音返回为空");
        const url = wavBase64ToUrl(result.wavBase64);
        const audio = new Audio(url);
        audio.volume = 1;
        audioRef.current = audio;
        audioUrlRef.current = url;
        let finished = false;
        const finish = () => {
          if (finished || sequence !== speechSequenceRef.current) return;
          finished = true;
          stopLocalPlayback();
        };
        audio.onended = finish;
        audio.onerror = () => {
          if (sequence !== speechSequenceRef.current) return;
          finish();
          speakWithSystemVoice(normalized, sequence);
        };
        // Some Electron builds delay/skip `ended` after long silent tails — finish when playback catches duration.
        audio.ontimeupdate = () => {
          if (sequence !== speechSequenceRef.current) return;
          if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
          if (audio.currentTime >= audio.duration - 0.08) finish();
        };
        const durationMs = Number(result.durationMs) || normalized.length * 220;
        armSpeechSafetyTimer(sequence, durationMs);
        setSpeaking(true);
        setSpeechBusy(true);
        await audio.play();
        // Fallback if `ended` never fires (common when UI thinks speech already finished).
        window.setTimeout(() => {
          if (sequence !== speechSequenceRef.current) return;
          finish();
        }, Math.max(1_200, durationMs + 400));
        return;
      } catch (error) {
        if (sequence !== speechSequenceRef.current) return;
        stopLocalPlayback();
        if (!allowFallback) {
          const message = error instanceof Error ? error.message : "当前所选音色暂时无法发声，请换一个音色试听。";
          setNaturalVoicePackError(message);
          return;
        }
        console.warn("[live2d] natural speech failed, fallback to system voice", error);
        // Keep the same sequence so fallback is not treated as a cancelled turn.
        speakWithSystemVoice(normalized, sequence);
        return;
      }
    }
    if (sequence !== speechSequenceRef.current) return;
    speakWithSystemVoice(normalized, sequence);
  }, [armSpeechSafetyTimer, naturalVoiceId, naturalVoicePack?.installed, naturalVoices, speakWithSystemVoice, stopLocalPlayback, stopSpeech]);

  const loadNaturalVoices = useCallback(async () => {
    const system = window.__OPENWORK_ELECTRON__?.system;
    const status = await system?.localNaturalVoicePackStatus?.();
    if (!status) return;
    setNaturalVoicePack(status);
    if (!status.installed) {
      setNaturalVoices([]);
      return;
    }
    const voices = await system?.listLocalNaturalVoices?.() ?? [];
    setNaturalVoices(voices);
    const stored = readStoredText(LIVE2D_NATURAL_VOICE_KEY, "");
    const storedVoice = voices.find((voice) => voice.id === stored);
    const preferred = PREFERRED_NATURAL_VOICE_IDS
      .map((id) => voices.find((voice) => voice.id === id))
      .find(Boolean);
    const selected = (
      storedVoice && !UNRELIABLE_NATURAL_VOICE_IDS.has(storedVoice.id)
        ? storedVoice
        : null
    ) ?? preferred ?? voices.find((voice) => voice.gender === "female") ?? voices[0];
    if (selected) {
      setNaturalVoiceId(selected.id);
      writeStoredText(LIVE2D_NATURAL_VOICE_KEY, selected.id);
    }
  }, []);

  const installNaturalVoices = useCallback(async () => {
    const install = window.__OPENWORK_ELECTRON__?.system?.installLocalNaturalVoicePack;
    if (!install) {
      setNaturalVoicePackError("自然音色仅支持桌面版安装。");
      return;
    }
    setNaturalVoicePackBusy(true);
    setNaturalVoicePackError(null);
    try {
      await install();
      setNaturalVoicePackProgress(null);
      await loadNaturalVoices();
    } catch (reason) {
      setNaturalVoicePackError(reason instanceof Error ? reason.message : "自然音色安装失败，请重试。");
    } finally {
      setNaturalVoicePackBusy(false);
    }
  }, [loadNaturalVoices]);

  const removeNaturalVoices = useCallback(async () => {
    const remove = window.__OPENWORK_ELECTRON__?.system?.removeLocalNaturalVoicePack;
    if (!remove) return;
    setNaturalVoicePackBusy(true);
    setNaturalVoicePackError(null);
    await stopSpeech();
    try {
      setNaturalVoicePack(await remove());
      setNaturalVoices([]);
      setNaturalVoicePackProgress(null);
    } catch (reason) {
      setNaturalVoicePackError(reason instanceof Error ? reason.message : "自然音色删除失败，请重试。");
    } finally {
      setNaturalVoicePackBusy(false);
    }
  }, [stopSpeech]);

  const saveGreeting = useCallback(() => {
    const next = greetingDraft.trim() || DEFAULT_LIVE2D_GREETING;
    setGreetingText(next);
    setGreetingDraft(next);
    writeStoredText(LIVE2D_GREETING_KEY, next);
    setEditingGreeting(false);
  }, [greetingDraft]);

  const installAdvancedVoice = useCallback(async () => {
    const install = window.__OPENWORK_ELECTRON__?.system?.installLocalVoicePack;
    if (!install) {
      setVoicePackError("高级音色仅支持桌面版安装。");
      return;
    }
    setVoicePackBusy(true);
    setVoicePackError(null);
    try {
      setVoicePack(await install("openvoice-v2"));
      setVoicePackProgress(null);
    } catch (reason) {
      setVoicePackError(reason instanceof Error ? reason.message : "高级音色安装失败，请重试。");
    } finally {
      setVoicePackBusy(false);
    }
  }, []);

  const removeAdvancedVoice = useCallback(async () => {
    const remove = window.__OPENWORK_ELECTRON__?.system?.removeLocalVoicePack;
    if (!remove) return;
    setVoicePackBusy(true);
    setVoicePackError(null);
    try {
      setVoicePack(await remove("openvoice-v2"));
      setVoicePackProgress(null);
    } catch (reason) {
      setVoicePackError(reason instanceof Error ? reason.message : "高级音色删除失败，请重试。");
    } finally {
      setVoicePackBusy(false);
    }
  }, []);

  const togglePaused = useCallback(() => {
    setPaused((current) => {
      const next = !current;
      writeStoredFlag(LIVE2D_PAUSED_KEY, next);
      return next;
    });
  }, []);

  const toggleVoice = useCallback(() => {
    setVoiceEnabled((current) => {
      const next = !current;
      writeStoredFlag(LIVE2D_VOICE_KEY, next);
      if (!next) void stopSpeech();
      return next;
    });
  }, [stopSpeech]);

  useEffect(() => {
    pendingSpeechRef.current = false;
    lastSpokenReplyIdRef.current = reply?.id ?? null;
    lastSpokenTextRef.current = reply ? speechTextFromReply(reply.text) : null;
    void stopSpeech();
    // Only re-bind when the session changes; capture the latest reply at switch time.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- session-scoped baseline
  }, [sessionId, stopSpeech]);

  useEffect(() => {
    if (active) {
      // Agent is still working (tools / multi-round). Interrupt current playback but keep the
      // reply eligible so the final text is spoken when streaming settles.
      pendingSpeechRef.current = true;
      if (reply && lastSpokenReplyIdRef.current === reply.id) {
        lastSpokenReplyIdRef.current = null;
        lastSpokenTextRef.current = null;
      }
      void stopSpeech();
      return;
    }
    if (!pendingSpeechRef.current || !voiceEnabled || !reply) return;
    const text = speechTextFromReply(reply.text);
    if (!text) return;
    if (reply.id === lastSpokenReplyIdRef.current && text === lastSpokenTextRef.current) return;

    pendingSpeechRef.current = false;
    lastSpokenReplyIdRef.current = reply.id;
    lastSpokenTextRef.current = text;
    void speakChineseText(text);
  }, [active, reply, speakChineseText, stopSpeech, voiceEnabled]);

  useEffect(() => () => { void stopSpeech(); }, [stopSpeech]);

  useEffect(() => {
    void loadNaturalVoices().catch(() => undefined);
  }, [loadNaturalVoices]);

  useEffect(() => {
    if (!voiceSettingsOpen) return;
    const system = window.__OPENWORK_ELECTRON__?.system;
    setVoicePackError(null);
    setNaturalVoicePackError(null);
    void loadNaturalVoices().catch((reason: unknown) => setNaturalVoicePackError(reason instanceof Error ? reason.message : "无法读取自然音色状态。"));
    void system?.localVoicePackStatus?.()
      .then(setVoicePack)
      .catch((reason: unknown) => setVoicePackError(reason instanceof Error ? reason.message : "无法读取高级音色状态。"));
    const removeNaturalListener = system?.onLocalNaturalVoicePackProgress?.((progress) => setNaturalVoicePackProgress(progress));
    const removeAdvancedListener = system?.onLocalVoicePackProgress?.((progress) => setVoicePackProgress(progress));
    return () => {
      removeNaturalListener?.();
      removeAdvancedListener?.();
    };
  }, [loadNaturalVoices, voiceSettingsOpen]);

  useEffect(() => {
    if (!visible) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let app: PixiApplication | null = null;
    let model: Live2DModelInstance | null = null;
    setLoading(true);
    setError(null);

    void loadLive2DRuntime()
      .then(async () => {
        const PIXI = window.PIXI;
        const factory = PIXI?.live2d?.Live2DModel;
        if (!PIXI || !factory) throw new Error("Live2D 运行时初始化失败");

        app = new PIXI.Application({
          view: canvas,
          width: 280,
          height: 320,
          autoStart: true,
          backgroundAlpha: 0,
          antialias: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          autoDensity: true,
        });

        // Retry once: partial CDN/texture failures leave face/hair missing while body remains.
        let loaded: Live2DModelInstance | null = null;
        let lastError: unknown = null;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            loaded = await factory.from(LIVE2D_MODEL_URL);
            if (cancelled) {
              loaded.destroy();
              return;
            }
            // Give atlas uploads a frame; then verify all 6 Shizuku textures are valid.
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            if (!modelTexturesReady(loaded) && attempt === 0) {
              loaded.destroy();
              loaded = null;
              continue;
            }
            break;
          } catch (reason) {
            lastError = reason;
            loaded = null;
          }
        }
        if (!loaded) throw (lastError instanceof Error ? lastError : new Error("Live2D 模型贴图加载不完整"));
        if (cancelled) {
          loaded.destroy();
          return;
        }

        model = loaded;
        app.stage.addChild(model);
        model.anchor.set(0.5, 1);
        const scale = Math.min(270 / model.width, 310 / model.height);
        model.scale.set(scale);
        model.x = 140;
        model.y = 318;
        setMouth(model, 0);
        modelRef.current = model;
        setLoading(false);
        void model.motion("idle");
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setLoading(false);
        setError(reason instanceof Error ? reason.message : "Live2D 模型加载失败");
      });

    return () => {
      cancelled = true;
      modelRef.current = null;
      try {
        model?.destroy();
      } catch {
        /* ignore */
      }
      // Do not destroy shared baseTextures — that can leave the next mount with a blank face atlas.
      app?.destroy(false, { children: true, texture: false, baseTexture: false });
    };
  }, [retryKey, visible]);

  useEffect(() => {
    if (!greetingPendingRef.current || !visible || loading || error || !modelRef.current) return;
    greetingPendingRef.current = false;
    if (active || !voiceEnabled) return;
    speakChineseText(greetingText, { digest: false });
  }, [active, error, greetingText, loading, speakChineseText, visible, voiceEnabled]);

  useEffect(() => {
    const model = modelRef.current;
    const shouldAnimateSpeech = active || speaking;
    if (!model || paused || !shouldAnimateSpeech) {
      if (model) setMouth(model, 0);
      return;
    }

    let frame = 0;
    const startedAt = performance.now();
    const animate = (time: number) => {
      // Keep mouth motion modest — large open values can look broken on Cubism2 Shizuku.
      setMouth(model, 0.12 + Math.abs(Math.sin((time - startedAt) / 140)) * 0.45);
      frame = window.requestAnimationFrame(animate);
    };
    frame = window.requestAnimationFrame(animate);
    return () => {
      window.cancelAnimationFrame(frame);
      setMouth(model, 0);
    };
  }, [active, loading, paused, speaking]);

  if (!visible) {
    return (
      <button
        type="button"
        className="fixed bottom-24 right-4 z-40 flex h-11 max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-dls-border bg-dls-surface px-3 text-sm font-medium text-dls-primary shadow-lg transition-opacity hover:opacity-85 sm:bottom-6"
        onClick={open}
        aria-label="开启虚拟人"
      >
        <UserRound className="h-4 w-4 shrink-0" />
        <span className="min-w-0 truncate">开启虚拟人</span>
      </button>
    );
  }

  return (
    <aside className="group/live2d fixed bottom-24 right-4 z-40 w-[280px] max-w-[calc(100vw-2rem)] bg-transparent sm:bottom-6" aria-label="Live2D 虚拟人">
      <div className="absolute inset-x-0 top-0 z-10 flex h-10 items-center justify-between rounded-xl border border-dls-border bg-dls-surface px-3 opacity-100 shadow-[var(--dls-card-shadow)] transition-opacity duration-150 sm:invisible sm:opacity-0 sm:group-focus-within/live2d:visible sm:group-focus-within/live2d:opacity-100 sm:group-hover/live2d:visible sm:group-hover/live2d:opacity-100">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium text-dls-primary">
          <span className={`h-2 w-2 shrink-0 rounded-full ${active ? "bg-green-9" : "bg-dls-tertiary"}`} aria-hidden="true" />
          <span className="truncate">小雪 · Live2D</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="rounded-md p-1.5 text-dls-secondary hover:bg-dls-hover hover:text-dls-primary"
            onClick={() => {
              setGreetingDraft(greetingText);
              setVoiceSettingsOpen(false);
              setEditingGreeting((current) => !current);
            }}
            aria-label="自定义虚拟人发言"
          >
            <MessageSquareText className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded-md p-1.5 text-dls-secondary hover:bg-dls-hover hover:text-dls-primary"
            onClick={() => {
              setEditingGreeting(false);
              setVoiceSettingsOpen((current) => !current);
            }}
            aria-label="语音设置"
          >
            <Settings2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={`rounded-md p-1.5 hover:bg-dls-hover ${speechBusy || speaking ? "text-dls-accent" : "text-dls-secondary hover:text-dls-primary"}`}
            onClick={() => void stopSpeech()}
            disabled={!speechBusy && !speaking}
            aria-label="停止说话"
            title="停止说话"
          >
            <Square className="h-4 w-4" />
          </button>
          <button type="button" className="rounded-md p-1.5 text-dls-secondary hover:bg-dls-hover hover:text-dls-primary" onClick={toggleVoice} aria-label={voiceEnabled ? "关闭回复朗读" : "开启回复朗读"}>
            {voiceEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
          <button type="button" className="rounded-md p-1.5 text-dls-secondary hover:bg-dls-hover hover:text-dls-primary" onClick={togglePaused} aria-label={paused ? "继续虚拟人动画" : "暂停虚拟人动画"}>
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
          </button>
          <button type="button" className="rounded-md p-1.5 text-dls-secondary hover:bg-dls-hover hover:text-dls-primary" onClick={close} aria-label="收起虚拟人">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
      {editingGreeting ? (
        <div className="absolute right-0 top-11 z-20 max-h-[calc(100dvh-7rem)] w-[320px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-dls-border bg-dls-surface p-3 shadow-[var(--dls-card-shadow)]">
          <label className="block text-sm font-medium text-dls-primary" htmlFor="live2d-greeting">
            默认中文发言
          </label>
          <textarea
            id="live2d-greeting"
            className="mt-2 min-h-20 w-full resize-none rounded-lg border border-dls-border bg-dls-background px-3 py-2 text-sm text-dls-primary outline-none focus:border-dls-accent"
            maxLength={160}
            value={greetingDraft}
            onChange={(event) => setGreetingDraft(event.target.value)}
            placeholder={DEFAULT_LIVE2D_GREETING}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-xs text-dls-tertiary">{greetingDraft.length}/160</span>
            <div className="flex items-center gap-2">
              <button type="button" className="rounded-lg border border-dls-border px-3 py-1.5 text-sm text-dls-primary hover:bg-dls-hover" onClick={() => void speakChineseText(greetingDraft, { digest: false })}>
                试听
              </button>
              <button type="button" className="rounded-lg bg-dls-accent px-3 py-1.5 text-sm text-[var(--dls-accent-fg)] hover:bg-[var(--dls-accent-hover)]" onClick={saveGreeting}>
                保存
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {voiceSettingsOpen ? (
        <div className="absolute bottom-[280px] right-0 z-20 max-h-[calc(100dvh-4rem)] w-[320px] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-dls-border bg-dls-surface p-3 shadow-[var(--dls-card-shadow)]">
          <div className="flex items-center justify-between gap-2">
            <h3 className="min-w-0 truncate text-sm font-medium text-dls-primary">语音设置</h3>
            <button type="button" className="rounded-md p-1 text-dls-secondary hover:bg-dls-hover hover:text-dls-primary" onClick={() => setVoiceSettingsOpen(false)} aria-label="关闭语音设置">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 rounded-lg border border-dls-border bg-dls-background p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-dls-primary">自然中文音色</p>
                <p className="mt-0.5 text-xs text-dls-tertiary">Kokoro 离线语音，下载后可用 100 个音色</p>
              </div>
              {naturalVoicePack?.installed ? (
                <button type="button" className="shrink-0 rounded-md p-1.5 text-dls-secondary hover:bg-dls-hover hover:text-dls-primary disabled:opacity-50" onClick={() => void removeNaturalVoices()} disabled={naturalVoicePackBusy} aria-label="删除自然中文音色">
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            {naturalVoicePack?.installed ? (
              <div className="mt-3">
                <label className="block text-xs text-dls-secondary" htmlFor="live2d-natural-voice">默认音色</label>
                <select
                  id="live2d-natural-voice"
                  className="mt-1.5 min-h-9 w-full min-w-0 max-w-full rounded-lg border border-dls-border bg-dls-surface px-2 text-sm text-dls-primary outline-none focus:border-dls-accent"
                  value={naturalVoiceId}
                  onChange={(event) => {
                    setNaturalVoiceId(event.target.value);
                    writeStoredText(LIVE2D_NATURAL_VOICE_KEY, event.target.value);
                  }}
                >
                  <optgroup label="女声">
                    {naturalVoices.filter((voice) => voice.gender === "female").map((voice) => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
                  </optgroup>
                  <optgroup label="男声">
                    {naturalVoices.filter((voice) => voice.gender === "male").map((voice) => <option key={voice.id} value={voice.id}>{voice.label}</option>)}
                  </optgroup>
                </select>
                <button type="button" className="mt-2 inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg border border-dls-border px-3 py-2 text-sm font-medium text-dls-primary hover:bg-dls-hover disabled:opacity-50" onClick={() => {
                  setNaturalVoicePackError(null);
                  void speakChineseText("你好，我是小雪。", { digest: false, allowFallback: false });
                }} disabled={naturalVoices.length === 0}>
                  {speechBusy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Volume2 className="h-4 w-4 shrink-0" />}
                  <span className="min-w-0 truncate">{speechBusy ? (speaking ? "正在播放…" : "正在生成…") : "试听当前音色"}</span>
                </button>
                {speechBusy ? (
                  <button type="button" className="mt-2 inline-flex min-h-9 w-full items-center justify-center gap-2 rounded-lg bg-dls-accent px-3 py-2 text-sm font-medium text-[var(--dls-accent-fg)] hover:bg-[var(--dls-accent-hover)]" onClick={() => void stopSpeech()}>
                    <Square className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 truncate">停止说话</span>
                  </button>
                ) : null}
              </div>
            ) : null}
            {naturalVoicePackBusy || naturalVoicePackProgress ? (
              <div className="mt-3">
                <div className="h-1.5 overflow-hidden rounded-full bg-dls-hover">
                  <div className="h-full rounded-full bg-dls-accent transition-[width] duration-150" style={{ width: `${Math.min(100, Math.round(((naturalVoicePackProgress?.downloadedBytes ?? naturalVoicePack?.downloadedBytes ?? 0) / (naturalVoicePackProgress?.totalBytes || naturalVoicePack?.totalBytes || 1)) * 100))}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-dls-tertiary">
                  {naturalVoicePackProgress ? `${formatDownloadSize(naturalVoicePackProgress.downloadedBytes)} / ${formatDownloadSize(naturalVoicePackProgress.totalBytes)}` : "正在校验和安装音色…"}
                </p>
              </div>
            ) : null}
            {naturalVoicePackError ? <p className="mt-2 break-words text-xs text-red-10">{naturalVoicePackError}</p> : null}
            {!naturalVoicePack?.installed ? (
              <button type="button" className="mt-3 inline-flex min-h-9 w-full max-w-full items-center justify-center gap-2 rounded-lg bg-dls-accent px-3 py-2 text-sm font-medium text-[var(--dls-accent-fg)] hover:bg-[var(--dls-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50" onClick={() => void installNaturalVoices()} disabled={naturalVoicePackBusy}>
                {naturalVoicePackBusy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Download className="h-4 w-4 shrink-0" />}
                <span className="min-w-0 truncate">下载全部音色（{formatDownloadSize(naturalVoicePack?.totalBytes ?? 147_031_220)}）</span>
              </button>
            ) : null}
          </div>
          <div className="mt-3 rounded-lg border border-dls-border bg-dls-background p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-dls-primary">系统中文语音</p>
                <p className="mt-0.5 text-xs text-dls-tertiary">自然音色不可用时自动备用</p>
              </div>
              <span className="shrink-0 rounded-full bg-dls-hover px-2 py-1 text-xs text-dls-secondary">备用</span>
            </div>
          </div>
          <div className="mt-2 rounded-lg border border-dls-border bg-dls-background p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-dls-primary">自定义音色</p>
                <p className="mt-0.5 text-xs text-dls-tertiary">OpenVoice V2 高级组件</p>
              </div>
              {voicePack?.installed ? (
                <button type="button" className="shrink-0 rounded-md p-1.5 text-dls-secondary hover:bg-dls-hover hover:text-dls-primary disabled:opacity-50" onClick={() => void removeAdvancedVoice()} disabled={voicePackBusy} aria-label="删除高级音色组件">
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : null}
            </div>
            <p className="mt-2 text-xs leading-5 text-dls-secondary">
              用于创建个人音色。只有启用高级功能时才下载，不会增加主安装包体积。
            </p>
            {voicePackBusy || voicePackProgress ? (
              <div className="mt-3">
                <div className="h-1.5 overflow-hidden rounded-full bg-dls-hover">
                  <div
                    className="h-full rounded-full bg-dls-accent transition-[width] duration-150"
                    style={{ width: `${Math.min(100, Math.round(((voicePackProgress?.downloadedBytes ?? 0) / (voicePackProgress?.totalBytes || voicePack?.totalBytes || 1)) * 100))}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-dls-tertiary">
                  {voicePackProgress ? `${formatDownloadSize(voicePackProgress.downloadedBytes)} / ${formatDownloadSize(voicePackProgress.totalBytes)}` : "正在准备下载…"}
                </p>
              </div>
            ) : null}
            {voicePackError ? <p className="mt-2 break-words text-xs text-red-10">{voicePackError}</p> : null}
            <button
              type="button"
              className="mt-3 inline-flex min-h-9 w-full max-w-full items-center justify-center gap-2 rounded-lg border border-dls-border px-3 py-2 text-sm font-medium text-dls-primary hover:bg-dls-hover disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void installAdvancedVoice()}
              disabled={voicePackBusy || voicePack?.installed}
            >
              {voicePackBusy ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Download className="h-4 w-4 shrink-0" />}
              <span className="min-w-0 truncate">
                {voicePack?.installed ? "高级组件已下载" : `下载高级组件（${formatDownloadSize(voicePack?.totalBytes ?? 131_321_328)}）`}
              </span>
            </button>
          </div>
        </div>
      ) : null}
      <div className="relative h-[320px] bg-transparent">
        <canvas ref={canvasRef} className={`h-full w-full ${paused ? "opacity-70" : "opacity-100"}`} />
        {speechBusy ? (
          <button
            type="button"
            className="absolute bottom-3 left-1/2 z-10 inline-flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-full border border-dls-border bg-dls-surface px-3 py-2 text-sm font-medium text-dls-primary shadow-[var(--dls-card-shadow)] hover:bg-dls-hover"
            onClick={() => void stopSpeech()}
            aria-label="停止说话"
          >
            <Square className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 truncate">停止说话</span>
          </button>
        ) : null}
        {loading ? (
          <div className="absolute inset-0 grid place-items-center text-sm text-dls-secondary">正在唤醒虚拟人…</div>
        ) : null}
        {error ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <UserRound className="h-12 w-12 text-dls-tertiary" />
            <p className="max-w-full break-words text-sm text-dls-secondary">Live2D 资源暂时无法加载</p>
            <button type="button" className="inline-flex max-w-full items-center gap-2 rounded-lg border border-dls-border px-3 py-2 text-sm text-dls-primary hover:bg-dls-hover" onClick={() => setRetryKey((key) => key + 1)}>
              <RotateCcw className="h-4 w-4 shrink-0" />
              <span className="truncate">重新加载</span>
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
