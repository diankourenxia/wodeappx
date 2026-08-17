/**
 * Main-process safety net: swallow broken-pipe console crashes (EPIPE),
 * append critical lines to userData, and invoke a crash-dump hook for
 * non-pipe fatals so the next launch still has evidence.
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_LOG_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_RECENT_MAX = 200;

/**
 * @param {unknown} error
 */
export function isBrokenPipeError(error) {
  if (!error || typeof error !== "object") return false;
  const code = /** @type {{ code?: unknown, errno?: unknown, message?: unknown }} */ (error).code;
  const message = String(/** @type {{ message?: unknown }} */ (error).message ?? "");
  if (code === "EPIPE" || code === "EIO") return true;
  if (/^write EPIPE\b/i.test(message) || /\bEPIPE\b/i.test(message)) return true;
  return false;
}

/**
 * @param {unknown} value
 */
export function serializeLogArg(value) {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: typeof value.stack === "string" ? value.stack.split("\n").slice(0, 12).join("\n") : undefined,
      code: /** @type {{ code?: unknown }} */ (value).code ?? undefined,
    };
  }
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

/**
 * @param {{
 *   getLogDir: () => string,
 *   logFileName?: string,
 *   maxBytes?: number,
 *   recentMax?: number,
 * }} options
 */
export function createCriticalLogger(options) {
  const {
    getLogDir,
    logFileName = "wodeappx-main.log",
    maxBytes = DEFAULT_LOG_MAX_BYTES,
    recentMax = DEFAULT_RECENT_MAX,
  } = options;

  /** @type {string[]} */
  const recent = [];

  function logPath() {
    return path.join(getLogDir(), logFileName);
  }

  function ensureDir() {
    mkdirSync(getLogDir(), { recursive: true });
  }

  function rotateIfNeeded(target) {
    try {
      const size = statSync(target).size;
      if (size < maxBytes) return;
      renameSync(target, `${target}.1`);
    } catch {
      // missing or rename race — ignore
    }
  }

  /**
   * @param {string} level
   * @param {string} tag
   * @param {...unknown} args
   */
  function write(level, tag, ...args) {
    const at = new Date().toISOString();
    const payload = {
      at,
      level,
      tag,
      args: args.map((arg) => serializeLogArg(arg)),
    };
    const line = `${JSON.stringify(payload)}\n`;
    recent.push(line.trimEnd());
    while (recent.length > recentMax) recent.shift();
    try {
      ensureDir();
      const target = logPath();
      rotateIfNeeded(target);
      appendFileSync(target, line, "utf8");
    } catch {
      // disk full / sandbox — never throw from logger
    }
    return payload;
  }

  /**
   * console.warn that never kills the process on a broken stdout/stderr pipe.
   * Always mirrors to the critical log file.
   * @param {string} tag
   * @param {...unknown} args
   */
  function safeWarn(tag, ...args) {
    write("warn", tag, ...args);
    try {
      console.warn(tag, ...args);
    } catch (error) {
      if (!isBrokenPipeError(error)) {
        write("error", "safeWarn.console", error);
      }
    }
  }

  function recentLines() {
    return [...recent];
  }

  function readTail(maxChars = 64_000) {
    try {
      const raw = readFileSync(logPath(), "utf8");
      return raw.length <= maxChars ? raw : raw.slice(-maxChars);
    } catch {
      return "";
    }
  }

  return {
    write,
    safeWarn,
    recentLines,
    readTail,
    logPath,
  };
}

/**
 * @param {{
 *   onFatal?: (error: Error, meta: { kind: string }) => void,
 * }} [options]
 */
export function installMainProcessGuards(options = {}) {
  const { onFatal } = options;
  let installed = false;

  function ignoreBrokenPipe(error) {
    return isBrokenPipeError(error);
  }

  function bindStream(stream) {
    if (!stream || typeof stream.on !== "function") return;
    stream.on("error", (error) => {
      if (ignoreBrokenPipe(error)) return;
      try {
        onFatal?.(error instanceof Error ? error : new Error(String(error)), { kind: "stdio" });
      } catch {
        // ignore
      }
    });
  }

  function install() {
    if (installed) return;
    installed = true;
    bindStream(process.stdout);
    bindStream(process.stderr);

    process.on("uncaughtException", (error) => {
      if (ignoreBrokenPipe(error)) return;
      try {
        onFatal?.(error instanceof Error ? error : new Error(String(error)), { kind: "uncaughtException" });
      } catch {
        // ignore nested failures from dump path
      }
    });

    process.on("unhandledRejection", (reason) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      if (ignoreBrokenPipe(error)) return;
      try {
        onFatal?.(error, { kind: "unhandledRejection" });
      } catch {
        // ignore
      }
    });
  }

  return { install, isBrokenPipeError };
}
