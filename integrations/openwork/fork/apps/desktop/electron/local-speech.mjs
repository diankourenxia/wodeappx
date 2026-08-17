import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fork, spawn, spawnSync } from "node:child_process";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAX_WAV_BYTES = 24 * 1024 * 1024;
const HELPER_APP = "wodeappx-local-speech.app";
const OPENVOICE_PACK_ID = "openvoice-v2";
const OPENVOICE_REVISION = "fd981100305a0e4291f93a9ad169c6d9f7bed54a";
const OPENVOICE_FILES = [
  {
    path: "converter/checkpoint.pth",
    size: 131_320_490,
    sha256: "9652c27e92b6b2a91632590ac9962ef7ae2b712e5c5b7f4c34ec55ee2b37ab9e",
  },
  {
    path: "converter/config.json",
    size: 838,
    sha256: "9dfff60350b8c63f2c664efd92a61b2516efb22671466960f0e5dfebd881fa47",
  },
];
const OPENVOICE_TOTAL_BYTES = OPENVOICE_FILES.reduce((total, file) => total + file.size, 0);
let openVoiceInstallPromise = null;

const NATURAL_VOICE_PACK_ID = "kokoro-zh";
const NATURAL_VOICE_REVISION = "v1.1-int8";
const NATURAL_VOICE_ARCHIVE = {
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2",
  size: 147_031_220,
  sha256: "a1e94694776049035c4f2c6529f003aaece993c76aae9a78995831c3c4dcafc6",
};
const NATURAL_VOICE_CATALOG_URL = "https://huggingface.co/api/models/hexgrad/Kokoro-82M-v1.1-zh/tree/main/voices?recursive=true&expand=false";
const NATURAL_MODEL_DIR = "kokoro-int8-multi-lang-v1_1";
/** Prefer a smaller set that is currently audible; hide the rest so UI selection matches playback. */
const USABLE_NATURAL_VOICE_IDS = new Set([
  "zf_001", "zf_038", "zf_042", "zf_043", "zf_047",
  "zm_009", "zm_012", "zm_045",
]);
let naturalVoiceInstallPromise = null;
/** @type {{ postMessage: (msg: unknown) => void, terminate: () => Promise<void>, _child?: import('node:child_process').ChildProcess } | null} */
let naturalTtsWorker = null;
let naturalTtsRequestId = 0;
const naturalTtsRequests = new Map();
const TTS_WORKER_SCRIPT = fileURLToPath(new URL("./local-tts-worker.mjs", import.meta.url));

function naturalVoicePackDir(app) {
  return path.join(app.getPath("userData"), "voice-packs", NATURAL_VOICE_PACK_ID);
}

function naturalModelDir(app) {
  return path.join(naturalVoicePackDir(app), NATURAL_MODEL_DIR);
}

async function readNaturalVoiceCatalog(app) {
  try {
    const catalog = JSON.parse(await readFile(path.join(naturalVoicePackDir(app), "voice-catalog.json"), "utf8"));
    return Array.isArray(catalog) ? catalog : [];
  } catch {
    return [];
  }
}

async function naturalVoicePackStatus(app) {
  try {
    const packDir = naturalVoicePackDir(app);
    const manifest = JSON.parse(await readFile(path.join(packDir, "install.json"), "utf8"));
    if (manifest.revision !== NATURAL_VOICE_REVISION) throw new Error("revision_mismatch");
    for (const relativePath of ["model.int8.onnx", "voices.bin", "tokens.txt", "lexicon-zh.txt", "espeak-ng-data"]) {
      await stat(path.join(packDir, NATURAL_MODEL_DIR, relativePath));
    }
    const voices = await readNaturalVoiceCatalog(app);
    if (voices.length < 100) throw new Error("voice_catalog_missing");
    return {
      packId: NATURAL_VOICE_PACK_ID,
      installed: true,
      installing: Boolean(naturalVoiceInstallPromise),
      downloadedBytes: NATURAL_VOICE_ARCHIVE.size,
      totalBytes: NATURAL_VOICE_ARCHIVE.size,
      revision: NATURAL_VOICE_REVISION,
      voiceCount: voices.filter((voice) => voice.language === "zh-CN").length,
    };
  } catch {
    let downloadedBytes = 0;
    try {
      downloadedBytes = Math.min(NATURAL_VOICE_ARCHIVE.size, (await stat(path.join(naturalVoicePackDir(app), "model.tar.bz2.download"))).size);
    } catch {
      downloadedBytes = 0;
    }
    return {
      packId: NATURAL_VOICE_PACK_ID,
      installed: false,
      installing: Boolean(naturalVoiceInstallPromise),
      downloadedBytes,
      totalBytes: NATURAL_VOICE_ARCHIVE.size,
      revision: NATURAL_VOICE_REVISION,
      voiceCount: 0,
    };
  }
}

async function downloadVerifiedFile(file, destination, onProgress, errorLabel) {
  await mkdir(path.dirname(destination), { recursive: true });
  const tempPath = `${destination}.download`;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let existingBytes = 0;
    try {
      existingBytes = (await stat(tempPath)).size;
    } catch {
      existingBytes = 0;
    }
    if (existingBytes > file.size) {
      await rm(tempPath, { force: true });
      existingBytes = 0;
    }
    try {
      const response = await fetch(file.url, {
        redirect: "follow",
        headers: existingBytes > 0 ? { Range: `bytes=${existingBytes}-` } : undefined,
      });
      if (!response.ok || !response.body) throw new Error(`${errorLabel}下载失败（${response.status}）。`);
      if (existingBytes > 0 && response.status !== 206) {
        await rm(tempPath, { force: true });
        continue;
      }
      let received = existingBytes;
      onProgress(received);
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length;
          onProgress(received);
          callback(null, chunk);
        },
      });
      await pipeline(response.body, meter, createWriteStream(tempPath, { flags: existingBytes > 0 ? "a" : "wx" }));
      if (received !== file.size) throw new Error(`${errorLabel}下载不完整，正在续传。`);
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(tempPath)) hash.update(chunk);
      if (hash.digest("hex") !== file.sha256) {
        await rm(tempPath, { force: true });
        throw new Error(`${errorLabel}校验失败，请重试。`);
      }
      await rename(tempPath, destination);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${errorLabel}下载失败，请重试。`);
}

async function fileMatches(filePath, file) {
  try {
    if ((await stat(filePath)).size !== file.size) return false;
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(filePath)) hash.update(chunk);
    return hash.digest("hex") === file.sha256;
  } catch {
    return false;
  }
}

function waitForProcess(command, args, errorMessage) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-20_000); });
    child.on("error", () => reject(new Error(errorMessage)));
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || errorMessage)));
  });
}

async function fetchNaturalVoiceCatalog() {
  const response = await fetch(NATURAL_VOICE_CATALOG_URL, { redirect: "follow" });
  if (!response.ok) throw new Error("无法读取自然音色目录，请稍后重试。");
  const entries = await response.json();
  const codes = (Array.isArray(entries) ? entries : [])
    .map((entry) => typeof entry?.path === "string" ? path.basename(entry.path, ".pt") : "")
    .filter((code) => /^(af|bf|zf|zm)_[a-z0-9]+$/.test(code))
    .sort((left, right) => left.localeCompare(right));
  const voices = codes.map((code, sid) => {
    const chinese = code.startsWith("zf_") || code.startsWith("zm_");
    const female = code.startsWith("af_") || code.startsWith("zf_");
    const suffix = code.slice(3);
    return {
      id: code,
      sid,
      language: chinese ? "zh-CN" : "en-US",
      gender: female ? "female" : "male",
      label: chinese ? `${female ? "女声" : "男声"} ${suffix}` : `English ${code}`,
    };
  });
  if (voices.filter((voice) => voice.language === "zh-CN").length < 100) {
    throw new Error("自然音色目录不完整，请稍后重试。");
  }
  return voices;
}

async function installNaturalVoicePack(app, event) {
  const packDir = naturalVoicePackDir(app);
  const archivePath = path.join(packDir, "model.tar.bz2");
  const stagingDir = path.join(packDir, `extract-${randomUUID()}`);
  await mkdir(packDir, { recursive: true });
  if (!(await fileMatches(archivePath, NATURAL_VOICE_ARCHIVE))) {
    await rm(archivePath, { force: true });
    await downloadVerifiedFile(NATURAL_VOICE_ARCHIVE, archivePath, (downloadedBytes) => {
      event.sender.send("openwork:system:localNaturalVoicePackProgress", {
        packId: NATURAL_VOICE_PACK_ID,
        downloadedBytes,
        totalBytes: NATURAL_VOICE_ARCHIVE.size,
      });
    }, "自然音色包");
  }
  const voices = await fetchNaturalVoiceCatalog();
  await mkdir(stagingDir, { recursive: true });
  try {
    await waitForProcess("tar", ["-xjf", archivePath, "-C", stagingDir], "自然音色包解压失败，请确认系统支持 tar 解压。 ");
    const extracted = path.join(stagingDir, NATURAL_MODEL_DIR);
    await stat(path.join(extracted, "model.int8.onnx"));
    await rm(naturalModelDir(app), { recursive: true, force: true });
    await rename(extracted, naturalModelDir(app));
    await writeFile(path.join(packDir, "voice-catalog.json"), JSON.stringify(voices, null, 2));
    await writeFile(path.join(packDir, "install.json"), JSON.stringify({
      packId: NATURAL_VOICE_PACK_ID,
      revision: NATURAL_VOICE_REVISION,
      installedAt: new Date().toISOString(),
      source: NATURAL_VOICE_ARCHIVE.url,
    }, null, 2));
    await rm(archivePath, { force: true });
  } finally {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
  }
  return naturalVoicePackStatus(app);
}

/**
 * Resolve worker path for packaged apps: asar scripts cannot always be forked;
 * prefer the asarUnpack sibling when present.
 */
function resolveTtsWorkerScript() {
  const script = TTS_WORKER_SCRIPT;
  const marker = `${path.sep}app.asar${path.sep}`;
  if (script.includes(marker)) {
    const unpacked = script.replace(marker, `${path.sep}app.asar.unpacked${path.sep}`);
    if (existsSync(unpacked)) return unpacked;
  }
  return script;
}

/**
 * Spawn Kokoro TTS in a separate OS process.
 * Prefer child_process.fork with the system Node binary: Electron's Node
 * (ELECTRON_RUN_AS_NODE / utilityProcess) often yields all-NaN Kokoro audio on macOS.
 */
function resolveSystemNodeExecPath() {
  try {
    const which = spawnSync("which", ["node"], { encoding: "utf8" }).stdout?.trim();
    if (which && existsSync(which) && !/Electron|WodeAppX|小灵通/i.test(which)) return which;
  } catch {
    /* ignore */
  }
  const candidates = [
    process.env.OPENWORK_TTS_NODE,
    process.env.NODE_BINARY,
    typeof process.execPath === "string" && !/Electron|WodeAppX|小灵通/i.test(process.execPath) ? process.execPath : "",
    "/usr/local/bin/node",
    "/opt/homebrew/bin/node",
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return "";
}

function buildTtsWorkerEnv(espeakDataDir, useSystemNode) {
  /** @type {NodeJS.ProcessEnv} */
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value == null) continue;
    // Electron-inherited vars can break native ONNX / eSpeak inside a system Node worker.
    if (
      key === "ELECTRON_RUN_AS_NODE"
      || key.startsWith("ELECTRON_")
      || key.startsWith("CHROME_")
      || key === "ORIGINAL_XDG_CURRENT_DESKTOP"
    ) {
      continue;
    }
    env[key] = value;
  }
  if (!useSystemNode) env.ELECTRON_RUN_AS_NODE = "1";
  env.ESPEAK_DATA_PATH = espeakDataDir;
  env.ESPEAKNG_DATA_PATH = espeakDataDir;
  return env;
}

function getNaturalTtsWorker(app) {
  if (naturalTtsWorker) return naturalTtsWorker;

  const script = resolveTtsWorkerScript();
  const modelDir = naturalModelDir(app);
  const espeakDataDir = path.join(modelDir, "espeak-ng-data");
  const nodeExecPath = resolveSystemNodeExecPath();
  /** @type {import('node:child_process').ChildProcess} */
  const child = fork(script, [], {
    cwd: modelDir,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    ...(nodeExecPath ? { execPath: nodeExecPath } : {}),
    env: buildTtsWorkerEnv(espeakDataDir, Boolean(nodeExecPath)),
    execArgv: [],
  });

  const api = {
    postMessage(message) {
      if (!child.connected) throw new Error("自然语音组件未就绪，请重试。");
      child.send(message);
    },
    async terminate() {
      try {
        if (child.killed || child.exitCode !== null) return;
        child.kill("SIGTERM");
        await new Promise((resolve) => {
          const timer = setTimeout(() => {
            try { child.kill("SIGKILL"); } catch { /* ignore */ }
            resolve();
          }, 1500);
          child.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        });
      } catch {
        /* ignore */
      }
    },
    _child: child,
  };

  const failPending = (error) => {
    if (naturalTtsWorker !== api) return;
    for (const request of naturalTtsRequests.values()) request.reject(error);
    naturalTtsRequests.clear();
    naturalTtsWorker = null;
  };

  child.on("message", (message) => {
    if (!message || typeof message !== "object") return;
    if (message.ready || message.pong) {
      if (message.ready) {
        console.info("[local-tts-worker] ready", {
          mode: message.mode,
          viaNative: message.viaNative,
          execPath: message.execPath,
          electron: message.electron,
        });
      }
      return;
    }
    if (message.fatal) {
      failPending(new Error(message.error || "自然语音组件异常退出。"));
      return;
    }
    const request = naturalTtsRequests.get(message.id);
    if (!request) return;
    if (!message.ok && message.error === "unreachable" && request.attempts < 1) {
      request.attempts += 1;
      setTimeout(() => {
        try { api.postMessage(request.message); } catch (error) {
          naturalTtsRequests.delete(message.id);
          request.reject(error instanceof Error ? error : new Error(String(error)));
        }
      }, 100);
      return;
    }
    naturalTtsRequests.delete(message.id);
    if (message.ok) request.resolve(message.result);
    else request.reject(new Error(message.error || "自然语音生成失败。"));
  });

  child.stderr?.on("data", (chunk) => {
    const text = String(chunk || "").trim();
    if (text) console.warn("[local-tts-worker]", text.slice(0, 500));
  });

  child.on("error", (error) => failPending(error));
  child.on("exit", (code, signal) => {
    if (naturalTtsWorker !== api) return;
    if (naturalTtsRequests.size > 0) {
      failPending(new Error(`自然语音组件已退出（code=${code ?? "null"}${signal ? ` signal=${signal}` : ""}），请重试。`));
      return;
    }
    naturalTtsWorker = null;
  });

  naturalTtsWorker = api;
  return api;
}

function synthesizeNaturalSpeechOnce(app, payload) {
  const id = ++naturalTtsRequestId;
  return new Promise((resolve, reject) => {
    const message = {
      id,
      modelDir: naturalModelDir(app),
      text: payload.text,
      sid: payload.sid,
      speed: payload.speed,
      allowFallback: payload.allowFallback !== false,
    };
    const timeout = setTimeout(() => {
      if (!naturalTtsRequests.has(id)) return;
      naturalTtsRequests.delete(id);
      const worker = naturalTtsWorker;
      naturalTtsWorker = null;
      void worker?.terminate().catch(() => undefined);
      reject(new Error("自然语音生成超时，请重试。"));
    }, 45_000);
    naturalTtsRequests.set(id, {
      resolve: (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
      attempts: 0,
      message,
    });
    try {
      getNaturalTtsWorker(app).postMessage(message);
    } catch (error) {
      clearTimeout(timeout);
      naturalTtsRequests.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function synthesizeNaturalSpeech(app, payload) {
  try {
    return await synthesizeNaturalSpeechOnce(app, payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const shouldRestart =
      message.includes("无有效音频")
      || message.includes("暂时无法发声")
      || message.includes("超时")
      || message.includes("异常退出")
      || message.includes("已退出");
    if (!shouldRestart) throw error;
    const worker = naturalTtsWorker;
    naturalTtsWorker = null;
    await worker?.terminate().catch(() => undefined);
    return synthesizeNaturalSpeechOnce(app, payload);
  }
}

async function cancelNaturalSpeech() {
  const pending = [...naturalTtsRequests.values()];
  naturalTtsRequests.clear();
  for (const request of pending) request.reject(new Error("自然语音生成已取消。"));
  // Soft cancel only — keep the warm worker. Hard-kill is reserved for timeouts so
  // preview/stop does not respawn into a cold utility crash loop.
  try { naturalTtsWorker?.postMessage({ cancel: true }); } catch { /* ignore */ }
  return { ok: true };
}

function voicePackDir(app) {
  return path.join(app.getPath("userData"), "voice-packs", OPENVOICE_PACK_ID);
}

async function openVoicePackStatus(app) {
  const packDir = voicePackDir(app);
  try {
    const manifest = JSON.parse(await readFile(path.join(packDir, "install.json"), "utf8"));
    if (manifest.revision !== OPENVOICE_REVISION) throw new Error("revision_mismatch");
    for (const file of OPENVOICE_FILES) {
      const info = await stat(path.join(packDir, file.path));
      if (!info.isFile() || info.size !== file.size) throw new Error("file_mismatch");
    }
    return {
      packId: OPENVOICE_PACK_ID,
      installed: true,
      installing: Boolean(openVoiceInstallPromise),
      downloadedBytes: OPENVOICE_TOTAL_BYTES,
      totalBytes: OPENVOICE_TOTAL_BYTES,
      revision: OPENVOICE_REVISION,
    };
  } catch {
    return {
      packId: OPENVOICE_PACK_ID,
      installed: false,
      installing: Boolean(openVoiceInstallPromise),
      downloadedBytes: 0,
      totalBytes: OPENVOICE_TOTAL_BYTES,
      revision: OPENVOICE_REVISION,
    };
  }
}

async function downloadOpenVoiceFile(file, destination, onProgress) {
  const url = `https://huggingface.co/myshell-ai/OpenVoiceV2/resolve/${OPENVOICE_REVISION}/${file.path}`;
  await mkdir(path.dirname(destination), { recursive: true });
  const tempPath = `${destination}.download`;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let existingBytes = 0;
    try {
      existingBytes = (await stat(tempPath)).size;
    } catch {
      existingBytes = 0;
    }
    if (existingBytes > file.size) {
      await rm(tempPath, { force: true });
      existingBytes = 0;
    }
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: existingBytes > 0 ? { Range: `bytes=${existingBytes}-` } : undefined,
      });
      if (!response.ok || !response.body) throw new Error(`高级音色资源下载失败（${response.status}）。`);
      if (existingBytes > 0 && response.status !== 206) {
        await rm(tempPath, { force: true });
        continue;
      }
      let received = existingBytes;
      onProgress(received);
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length;
          onProgress(received);
          callback(null, chunk);
        },
      });
      await pipeline(response.body, meter, createWriteStream(tempPath, { flags: existingBytes > 0 ? "a" : "wx" }));
      if (received !== file.size) throw new Error("高级音色资源下载不完整，正在续传。");

      const hash = createHash("sha256");
      for await (const chunk of createReadStream(tempPath)) hash.update(chunk);
      if (hash.digest("hex") !== file.sha256) {
        await rm(tempPath, { force: true });
        throw new Error("高级音色资源校验失败，请重试。");
      }
      await rename(tempPath, destination);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("高级音色资源下载失败，请重试。");
}

async function installOpenVoicePack(app, event) {
  const packDir = voicePackDir(app);
  await mkdir(packDir, { recursive: true });
  let completedBytes = 0;
  for (const file of OPENVOICE_FILES) {
    const destination = path.join(packDir, file.path);
    let reusable = false;
    try {
      reusable = (await stat(destination)).size === file.size;
    } catch {
      reusable = false;
    }
    if (!reusable) {
      await downloadOpenVoiceFile(file, destination, (received) => {
        event.sender.send("openwork:system:localVoicePackProgress", {
          packId: OPENVOICE_PACK_ID,
          downloadedBytes: completedBytes + received,
          totalBytes: OPENVOICE_TOTAL_BYTES,
        });
      });
    }
    completedBytes += file.size;
    event.sender.send("openwork:system:localVoicePackProgress", {
      packId: OPENVOICE_PACK_ID,
      downloadedBytes: completedBytes,
      totalBytes: OPENVOICE_TOTAL_BYTES,
    });
  }
  await writeFile(path.join(packDir, "install.json"), JSON.stringify({
    packId: OPENVOICE_PACK_ID,
    revision: OPENVOICE_REVISION,
    installedAt: new Date().toISOString(),
  }, null, 2));
  return openVoicePackStatus(app);
}

function resolveHelperApp() {
  const candidates = [
    process.resourcesPath ? path.join(process.resourcesPath, "helpers", HELPER_APP) : "",
    path.resolve(__dirname, "../resources/helpers", HELPER_APP),
    path.resolve(__dirname, "../../../../apps/desktop/resources/helpers", HELPER_APP),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? "";
}

function isWav(bytes) {
  return bytes.length >= 44 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE";
}

function runHelper(helperApp, args) {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(os.tmpdir(), `wodeappx-local-speech-${randomUUID()}.json`);
    const child = spawn("/usr/bin/open", ["-W", "-n", helperApp, "--args", ...args, "--output", outputPath], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("本地语音识别超时。"));
    }, 100_000);
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(-100_000);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", async (code) => {
      clearTimeout(timeout);
      try {
        const payload = JSON.parse(await readFile(outputPath, "utf8"));
        resolve(payload);
      } catch {
        reject(new Error(stderr.trim() || `本地语音识别进程异常退出（${code ?? "unknown"}）。`));
      } finally {
        await rm(outputPath, { force: true }).catch(() => undefined);
      }
    });
  });
}

export function registerLocalSpeechIpc({ app, ipcMain }) {
  ipcMain.handle("openwork:system:localNaturalVoicePackStatus", async () => naturalVoicePackStatus(app));

  ipcMain.handle("openwork:system:installLocalNaturalVoicePack", async (event) => {
    if (!naturalVoiceInstallPromise) {
      naturalVoiceInstallPromise = installNaturalVoicePack(app, event).finally(() => {
        naturalVoiceInstallPromise = null;
      });
    }
    return naturalVoiceInstallPromise;
  });

  ipcMain.handle("openwork:system:removeLocalNaturalVoicePack", async () => {
    if (naturalVoiceInstallPromise) throw new Error("自然音色正在安装，请稍后再删除。");
    const worker = naturalTtsWorker;
    naturalTtsWorker = null;
    await worker?.terminate();
    await rm(naturalVoicePackDir(app), { recursive: true, force: true });
    return naturalVoicePackStatus(app);
  });

  ipcMain.handle("openwork:system:listLocalNaturalVoices", async () => {
    const status = await naturalVoicePackStatus(app);
    if (!status.installed) return [];
    return (await readNaturalVoiceCatalog(app))
      .filter((voice) => voice.language === "zh-CN" && USABLE_NATURAL_VOICE_IDS.has(voice.id));
  });

  ipcMain.handle("openwork:system:synthesizeLocalNaturalSpeech", async (_event, payload = {}) => {
    const status = await naturalVoicePackStatus(app);
    if (!status.installed) throw new Error("请先下载自然中文音色。");
    const text = typeof payload.text === "string"
      ? payload.text.replace(/[^\p{Script=Han}\p{L}\p{N}\s，。！？、；：,.!?;:'"（）()《》“”‘’—…%+\-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 1000)
      : "";
    if (!text) throw new Error("朗读内容不能为空。");
    const sid = Number.isInteger(payload.sid) ? payload.sid : 5;
    const speed = Number.isFinite(payload.speed) ? Math.max(0.7, Math.min(1.3, payload.speed)) : 1;
    const allowFallback = payload.allowFallback !== false;
    return synthesizeNaturalSpeech(app, { text, sid, speed, allowFallback });
  });

  ipcMain.handle("openwork:system:cancelLocalNaturalSpeech", async () => cancelNaturalSpeech());

  ipcMain.handle("openwork:system:localVoicePackStatus", async () => openVoicePackStatus(app));

  ipcMain.handle("openwork:system:installLocalVoicePack", async (event, payload = {}) => {
    if (payload.packId !== OPENVOICE_PACK_ID) throw new Error("不支持的高级音色包。");
    if (!openVoiceInstallPromise) {
      openVoiceInstallPromise = installOpenVoicePack(app, event).finally(() => {
        openVoiceInstallPromise = null;
      });
    }
    return openVoiceInstallPromise;
  });

  ipcMain.handle("openwork:system:removeLocalVoicePack", async (_event, payload = {}) => {
    if (payload.packId !== OPENVOICE_PACK_ID) throw new Error("不支持的高级音色包。");
    if (openVoiceInstallPromise) throw new Error("高级音色正在安装，请稍后再删除。");
    await rm(voicePackDir(app), { recursive: true, force: true });
    return openVoicePackStatus(app);
  });

  ipcMain.handle("openwork:system:localSpeechStatus", async () => {
    const helperApp = process.platform === "darwin" ? resolveHelperApp() : "";
    return {
      available: Boolean(helperApp),
      platform: process.platform,
      onDevice: true,
      reason: helperApp ? undefined : process.platform === "darwin" ? "本地语音识别组件未安装。" : "当前仅支持 macOS 本地语音识别。",
    };
  });

  ipcMain.handle("openwork:system:transcribeLocalSpeech", async (_event, payload = {}) => {
    if (process.platform !== "darwin") {
      return { ok: false, code: "unsupported_platform", error: "当前仅支持 macOS 本地语音识别。", onDevice: true };
    }
    const helperApp = resolveHelperApp();
    if (!helperApp) {
      return { ok: false, code: "helper_missing", error: "本地语音识别组件未安装，请重新安装WodeAppX。", onDevice: true };
    }
    const base64 = typeof payload.wavBase64 === "string" ? payload.wavBase64 : "";
    if (!base64 || base64.length > Math.ceil(MAX_WAV_BYTES * 4 / 3) + 16) {
      return { ok: false, code: "invalid_audio", error: "本地录音为空或过长。", onDevice: true };
    }
    const bytes = Buffer.from(base64, "base64");
    if (bytes.length > MAX_WAV_BYTES || !isWav(bytes)) {
      return { ok: false, code: "invalid_wav", error: "本地录音格式无效。", onDevice: true };
    }

    const tempDir = path.join(app.getPath("temp") || os.tmpdir(), "wodeappx-local-speech");
    const wavPath = path.join(tempDir, `${randomUUID()}.wav`);
    await mkdir(tempDir, { recursive: true });
    await writeFile(wavPath, bytes);
    try {
      const language = typeof payload.language === "string" && payload.language.trim() ? payload.language.trim() : "zh-CN";
      return await runHelper(helperApp, ["--file", wavPath, "--language", language]);
    } finally {
      await rm(wavPath, { force: true }).catch(() => undefined);
    }
  });
}
