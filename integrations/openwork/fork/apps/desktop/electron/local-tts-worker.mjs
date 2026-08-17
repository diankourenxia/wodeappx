/**
 * Local Kokoro TTS worker — separate OS process (Electron utilityProcess / fork).
 * Native aborts in sherpa-onnx must not take down the Electron main process.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { parentPort, isMainThread } from "node:worker_threads";

const require = createRequire(import.meta.url);
let NativeOfflineTts = null;
try {
  ({ OfflineTts: NativeOfflineTts } = require("sherpa-onnx-node/non-streaming-tts.js"));
} catch {
  NativeOfflineTts = null;
}
const sherpaWasm = NativeOfflineTts ? null : require("sherpa-onnx");
let tts = null;
let loadedModelDir = "";
let generationToken = 0;
let generationQueue = Promise.resolve();

/** Electron utilityProcess exposes process.parentPort; fork uses process.send. */
const utilityParentPort = typeof process.parentPort !== "undefined" ? process.parentPort : null;
const isUtilityChild = Boolean(utilityParentPort);
const isForkChild = !isUtilityChild && typeof process.send === "function" && isMainThread;

function postToHost(message) {
  try {
    if (isUtilityChild) {
      utilityParentPort.postMessage(message);
      return;
    }
    if (isForkChild) {
      process.send(message);
      return;
    }
    parentPort?.postMessage(message);
  } catch {
    /* parent gone */
  }
}

function onHostMessage(handler) {
  if (isUtilityChild) {
    utilityParentPort.on("message", (event) => handler(event?.data));
    return;
  }
  if (isForkChild) {
    process.on("message", handler);
    return;
  }
  parentPort?.on("message", handler);
}

process.on("uncaughtException", (error) => {
  postToHost({
    id: null,
    ok: false,
    fatal: true,
    error: error instanceof Error ? error.message : String(error),
  });
  // Exit so host can respawn; do not leave a half-dead native runtime.
  setTimeout(() => process.exit(1), 50);
});

process.on("unhandledRejection", (reason) => {
  postToHost({
    id: null,
    ok: false,
    fatal: true,
    error: reason instanceof Error ? reason.message : String(reason),
  });
  setTimeout(() => process.exit(1), 50);
});

/** Speakers verified to produce usable Chinese audio on kokoro-int8-multi-lang-v1_1. */
const FALLBACK_SPEAKER_SIDS = [3, 27, 26, 23, 1, 36, 59, 30, 10, 8, 57, 58, 61, 76];

function createTts(modelDir) {
  if (tts && loadedModelDir === modelDir) return tts;
  tts?.free?.();
  const ruleFsts = [
    path.join(modelDir, "phone-zh.fst"),
    path.join(modelDir, "date-zh.fst"),
    path.join(modelDir, "number-zh.fst"),
  ].join(",");
  if (NativeOfflineTts) {
    tts = new NativeOfflineTts({
      model: {
        kokoro: {
          model: path.join(modelDir, "model.int8.onnx"),
          voices: path.join(modelDir, "voices.bin"),
          tokens: path.join(modelDir, "tokens.txt"),
          dataDir: path.join(modelDir, "espeak-ng-data"),
          lexicon: [path.join(modelDir, "lexicon-us-en.txt"), path.join(modelDir, "lexicon-zh.txt")].join(","),
          dictDir: path.join(modelDir, "dict"),
          // espeak-ng Mandarin voice id is "cmn", not "zh-cn"
          lang: "cmn",
        },
      },
      numThreads: 4,
      provider: "cpu",
      ruleFsts,
      maxNumSentences: 1,
    });
  } else {
    tts = sherpaWasm.createOfflineTts({
      offlineTtsModelConfig: {
        offlineTtsKokoroModelConfig: {
          model: path.join(modelDir, "model.int8.onnx"),
          voices: path.join(modelDir, "voices.bin"),
          tokens: path.join(modelDir, "tokens.txt"),
          dataDir: path.join(modelDir, "espeak-ng-data"),
          lexicon: [path.join(modelDir, "lexicon-us-en.txt"), path.join(modelDir, "lexicon-zh.txt")].join(","),
          dictDir: path.join(modelDir, "dict"),
          lang: "cmn",
        },
        numThreads: 2,
        debug: 0,
        provider: "cpu",
      },
      ruleFsts,
      ruleFars: "",
      maxNumSentences: 1,
    });
  }
  loadedModelDir = modelDir;
  return tts;
}

function sampleStats(samples) {
  let energy = 0;
  let finite = 0;
  let nanCount = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    if (!Number.isFinite(value)) {
      nanCount += 1;
      continue;
    }
    energy += value * value;
    finite += 1;
  }
  return {
    finite,
    nanCount,
    rms: finite > 0 ? Math.sqrt(energy / finite) : 0,
  };
}

/** Replace NaN and trim leading/trailing near-silence so playback ends when speech ends. */
function sanitizeSamples(samples, sampleRate) {
  const cleaned = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    cleaned[index] = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
  }
  const threshold = 0.004;
  const pad = Math.max(1, Math.round(sampleRate * 0.08));
  let start = 0;
  while (start < cleaned.length && Math.abs(cleaned[start]) < threshold) start += 1;
  let end = cleaned.length - 1;
  while (end > start && Math.abs(cleaned[end]) < threshold) end -= 1;
  start = Math.max(0, start - pad);
  end = Math.min(cleaned.length - 1, end + pad);
  return cleaned.subarray(start, end + 1);
}

function encodeWav(samples, sampleRate) {
  const dataBytes = samples.length * 2;
  const output = Buffer.allocUnsafe(44 + dataBytes);
  output.write("RIFF", 0);
  output.writeUInt32LE(36 + dataBytes, 4);
  output.write("WAVEfmt ", 8);
  output.writeUInt32LE(16, 16);
  output.writeUInt16LE(1, 20);
  output.writeUInt16LE(1, 22);
  output.writeUInt32LE(sampleRate, 24);
  output.writeUInt32LE(sampleRate * 2, 28);
  output.writeUInt16LE(2, 32);
  output.writeUInt16LE(16, 34);
  output.write("data", 36);
  output.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    output.writeInt16LE(Math.round(value < 0 ? value * 32768 : value * 32767), 44 + index * 2);
  }
  return output;
}

function generateWithSid(engine, text, sid, speed) {
  let audio = null;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      audio = engine.generate({ text, sid, speed: speed || 1, enableExternalBuffer: false });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || error.message !== "unreachable" || attempt === 2) break;
    }
  }
  if (lastError) throw lastError;
  return audio;
}

async function generateSpeech(message, token) {
  try {
    const allowFallback = message.allowFallback !== false;
    const attemptGenerate = (recreate) => {
      if (recreate) {
        try { tts?.free?.(); } catch { /* ignore */ }
        tts = null;
        loadedModelDir = "";
      }
      let engine = createTts(message.modelDir);
      const requestedSid = Number.isInteger(message.sid) && message.sid >= 0 && message.sid < engine.numSpeakers
        ? message.sid
        : FALLBACK_SPEAKER_SIDS[0];
      // Preview must keep the selected speaker. Auto-speak may fall back for reliability.
      const candidateSids = allowFallback
        ? [requestedSid, ...FALLBACK_SPEAKER_SIDS.filter((sid) => sid !== requestedSid)]
        : [requestedSid];

      let audio = null;
      let usedSid = requestedSid;
      const rejected = [];
      for (let index = 0; index < candidateSids.length; index += 1) {
        const sid = candidateSids[index];
        let accepted = false;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const candidate = generateWithSid(engine, message.text, sid, message.speed);
          if (token !== generationToken) return { cancelled: true };
          if (!candidate?.samples?.length) {
            if (attempt === 2) rejected.push({ sid, reason: "empty" });
          } else {
            const sampleInfo = sampleStats(candidate.samples);
            if (sampleInfo.finite >= 500 && sampleInfo.rms >= 0.002) {
              audio = candidate;
              usedSid = sid;
              accepted = true;
              break;
            }
            if (attempt === 2) {
              rejected.push({
                sid,
                reason: "silent",
                rms: Number(sampleInfo.rms.toFixed(5)),
                nan: sampleInfo.nanCount,
                finite: sampleInfo.finite,
              });
            }
          }
          // All-NaN / empty: recreate engine before retrying the same speaker.
          if (attempt < 2) {
            try { tts?.free?.(); } catch { /* ignore */ }
            tts = null;
            loadedModelDir = "";
            engine = createTts(message.modelDir);
          }
        }
        if (accepted) break;
      }
      return { engine, audio, usedSid, requestedSid, rejected };
    };

    let result = attemptGenerate(false);
    if (result.cancelled) return;
    // If every candidate is all-NaN, the native engine is likely poisoned — recreate once.
    const allPoisoned = !result.audio
      && (result.rejected?.length || 0) > 0
      && result.rejected.every((item) => item.reason === "silent" && item.finite === 0);
    if (allPoisoned) {
      console.warn("[local-tts-worker] recreating engine after silent/NaN output");
      result = attemptGenerate(true);
      if (result.cancelled) return;
    }

    if (!result.audio) {
      console.warn("[local-tts-worker] all speakers rejected", JSON.stringify({
        text: String(message.text || "").slice(0, 40),
        allowFallback,
        rejected: result.rejected,
      }));
      throw new Error(allowFallback
        ? "自然语音生成失败：当前音色无有效音频，请换一个女声后重试。"
        : "当前所选音色暂时无法发声，请换一个音色试听。");
    }
    if (result.usedSid !== result.requestedSid) {
      console.warn("[local-tts-worker] fell back speaker", JSON.stringify({
        requestedSid: result.requestedSid,
        usedSid: result.usedSid,
      }));
    }
    const samples = sanitizeSamples(result.audio.samples, result.audio.sampleRate);
    if (samples.length < 500) {
      throw new Error("自然语音生成失败：当前音色无有效音频，请换一个女声后重试。");
    }
    const wav = encodeWav(samples, result.audio.sampleRate);
    postToHost({
      id: message.id,
      ok: true,
      result: {
        ok: true,
        wavBase64: wav.toString("base64"),
        durationMs: Math.round((samples.length / result.audio.sampleRate) * 1000),
        sampleRate: result.audio.sampleRate,
        numSpeakers: result.engine.numSpeakers,
        sid: result.usedSid,
      },
    });
  } catch (error) {
    if (token !== generationToken) return;
    postToHost({ id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

onHostMessage((message) => {
  if (message?.cancel) {
    generationToken += 1;
    return;
  }
  if (message?.ping) {
    postToHost({ pong: true });
    return;
  }
  const token = generationToken;
  generationQueue = generationQueue.then(() => generateSpeech(message, token));
});

// Ready signal for host (process isolation path).
if (isUtilityChild || isForkChild) {
  postToHost({
    ready: true,
    mode: isUtilityChild ? "utilityProcess" : "fork",
    viaNative: Boolean(NativeOfflineTts),
    execPath: process.execPath,
    electron: process.versions.electron || null,
  });
}
