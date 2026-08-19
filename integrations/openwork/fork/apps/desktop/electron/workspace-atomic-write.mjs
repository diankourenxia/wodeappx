import { randomBytes } from "node:crypto";
import { copyFile, mkdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const RETRYABLE_REPLACE_CODES = new Set(["EPERM", "EACCES", "EBUSY", "EEXIST"]);

export function isRetryableReplaceError(error) {
  return Boolean(error && typeof error === "object" && RETRYABLE_REPLACE_CODES.has(error.code));
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Atomically put `tempPath` at `outputPath`.
 * Windows often returns EPERM when the destination is briefly locked (AV,
 * indexer, a previous Electron instance). Retry rename, then copy-over,
 * then delete-and-rename.
 */
export async function replaceFileAtomic(tempPath, outputPath, deps = {}) {
  const renameFn = deps.rename ?? rename;
  const copyFileFn = deps.copyFile ?? copyFile;
  const unlinkFn = deps.unlink ?? unlink;
  const rmFn = deps.rm ?? rm;
  const sleep = deps.sleep ?? defaultSleep;
  const maxAttempts = deps.maxAttempts ?? 6;
  const delayMs = deps.delayMs ?? 40;

  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await renameFn(tempPath, outputPath);
      return { method: "rename", attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      if (!isRetryableReplaceError(error)) throw error;
      if (attempt < maxAttempts - 1) {
        await sleep(delayMs * 2 ** attempt);
      }
    }
  }

  try {
    await copyFileFn(tempPath, outputPath);
    await unlinkFn(tempPath).catch(() => {});
    return { method: "copy", attempts: maxAttempts };
  } catch (copyError) {
    try {
      await rmFn(outputPath, { force: true });
      await renameFn(tempPath, outputPath);
      return { method: "rm-rename", attempts: maxAttempts + 1 };
    } catch {
      throw lastError ?? copyError;
    }
  }
}

export async function writeJsonFileAtomic(outputPath, value, deps = {}) {
  const writeFileFn = deps.writeFile ?? writeFile;
  const mkdirFn = deps.mkdir ?? mkdir;
  const pid = deps.pid ?? process.pid;
  const bytes = deps.randomBytes ?? randomBytes;
  const content = `${JSON.stringify(value, null, 2)}\n`;
  JSON.parse(content);
  await mkdirFn(path.dirname(outputPath), { recursive: true });
  const tempPath = `${outputPath}.${pid}.${bytes(6).toString("hex")}.tmp`;
  await writeFileFn(tempPath, content, "utf8");
  return replaceFileAtomic(tempPath, outputPath, deps);
}

export async function persistWorkspaceStateSafe(outputPath, value, deps = {}) {
  try {
    await writeJsonFileAtomic(outputPath, value, deps);
    return { persisted: true };
  } catch (error) {
    const warn = deps.warn ?? console.warn;
    warn("[workspace] persist failed; continuing with in-memory state", {
      path: outputPath,
      code: error && typeof error === "object" && "code" in error ? error.code : null,
      error: error instanceof Error ? error.message : String(error),
    });
    return { persisted: false, error };
  }
}
