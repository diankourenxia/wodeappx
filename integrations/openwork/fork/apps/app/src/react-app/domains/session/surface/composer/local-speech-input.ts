import { useCallback, useEffect, useRef, useState } from "react";

type LocalSpeechInputOptions = {
  lang?: string;
  onResult: (text: string) => void;
  onError?: (message: string) => void;
};

type RecorderSession = {
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  silentGain: GainNode;
  stream: MediaStream;
  chunks: Float32Array[];
  sampleRate: number;
};

function mergeChunks(chunks: Float32Array[]) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function resampleMono(input: Float32Array, inputRate: number, outputRate = 16_000) {
  if (inputRate === outputRate) return input;
  const ratio = inputRate / outputRate;
  const output = new Float32Array(Math.max(1, Math.round(input.length / ratio)));
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.min(input.length, Math.floor((index + 1) * ratio));
    let sum = 0;
    for (let cursor = start; cursor < end; cursor += 1) sum += input[cursor] ?? 0;
    output[index] = sum / Math.max(1, end - start);
  }
  return output;
}

function encodePcm16Wav(samples: Float32Array, sampleRate = 16_000) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  }
  return new Uint8Array(buffer);
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function stopRecorder(session: RecorderSession) {
  session.processor.disconnect();
  session.source.disconnect();
  session.silentGain.disconnect();
  for (const track of session.stream.getTracks()) track.stop();
  void session.context.close();
}

/** Records locally and sends only a WAV buffer to the bundled macOS on-device recognizer. */
export function useLocalSpeechInput(options: LocalSpeechInputOptions) {
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<RecorderSession | null>(null);
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  const bridge = typeof window === "undefined" ? undefined : window.__OPENWORK_ELECTRON__?.system;
  const supported = Boolean(
    bridge?.localSpeechStatus &&
    bridge?.transcribeLocalSpeech &&
    typeof navigator !== "undefined" &&
    navigator.mediaDevices?.getUserMedia,
  );

  const finish = useCallback(async () => {
    const session = recorderRef.current;
    if (!session) return;
    recorderRef.current = null;
    setListening(false);
    stopRecorder(session);

    const samples = resampleMono(mergeChunks(session.chunks), session.sampleRate);
    if (samples.length < 1_600) {
      callbacksRef.current.onError?.("录音时间太短，请重新说一次。");
      return;
    }
    const transcribe = window.__OPENWORK_ELECTRON__?.system?.transcribeLocalSpeech;
    if (!transcribe) {
      callbacksRef.current.onError?.("本地语音识别组件未加载，请重启WodeAppX。");
      return;
    }

    setTranscribing(true);
    try {
      const result = await transcribe({
        wavBase64: bytesToBase64(encodePcm16Wav(samples)),
        language: callbacksRef.current.lang || navigator.language || "zh-CN",
      });
      const text = result.text?.trim();
      if (result.ok && text) callbacksRef.current.onResult(text);
      else callbacksRef.current.onError?.(result.error || "没有识别到语音，请重新说一次。");
    } catch (error) {
      callbacksRef.current.onError?.(error instanceof Error ? error.message : "本地语音识别失败。");
    } finally {
      setTranscribing(false);
    }
  }, []);

  const start = useCallback(async () => {
    if (!supported || transcribing) return;
    try {
      const system = window.__OPENWORK_ELECTRON__?.system;
      const status = await system?.localSpeechStatus?.();
      if (!status?.available) {
        callbacksRef.current.onError?.(status?.reason || "本地语音识别组件不可用。");
        return;
      }
      const microphone = await system?.askMicrophoneAccess?.();
      if (microphone && !microphone.granted) {
        callbacksRef.current.onError?.("麦克风权限被拒绝，请在系统设置的隐私与安全性中允许WodeAppX使用麦克风。");
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      const session: RecorderSession = { context, source, processor, silentGain, stream, chunks: [], sampleRate: context.sampleRate };
      processor.onaudioprocess = (event) => {
        if (recorderRef.current === session) session.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(silentGain);
      silentGain.connect(context.destination);
      recorderRef.current = session;
      setListening(true);
    } catch (error) {
      callbacksRef.current.onError?.(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "麦克风权限被拒绝，请在系统设置的隐私与安全性中允许WodeAppX使用麦克风。"
          : error instanceof Error ? error.message : "无法启动麦克风。",
      );
    }
  }, [supported, transcribing]);

  const toggle = useCallback(() => {
    if (listening) void finish();
    else void start();
  }, [finish, listening, start]);

  useEffect(() => () => {
    const session = recorderRef.current;
    recorderRef.current = null;
    if (session) stopRecorder(session);
  }, []);

  return { supported, listening, transcribing, toggle };
}
