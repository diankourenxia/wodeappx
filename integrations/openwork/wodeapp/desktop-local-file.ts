type DesktopFileBridge = {
  getPathForFile?: (file: File) => string;
  readAsDataUrl?: (file: File, mimeType?: string) => Promise<string | null>;
  readPathAsDataUrl?: (filePath: string, mimeType?: string) => Promise<string | null>;
  /** Sync local-file fingerprint for cache keys (size + mtime). */
  statLocalPath?: (filePath: string) => { size: number; mtimeMs: number } | null;
};

function desktopFileBridge(): DesktopFileBridge | null {
  if (typeof window === "undefined") return null;
  return ((window as Window & {
    __OPENWORK_ELECTRON__?: { files?: DesktopFileBridge };
  }).__OPENWORK_ELECTRON__?.files) ?? null;
}

export function desktopLocalFilePath(file: File): string | null {
  const legacyPath = (file as File & { path?: string }).path?.trim();
  if (legacyPath) return legacyPath;
  try {
    return desktopFileBridge()?.getPathForFile?.(file)?.trim() || null;
  } catch {
    return null;
  }
}

/** Sync size/mtime for local-path identity keys (overwrite-safe HTTPS reuse). */
export function desktopLocalPathStat(filePath: string): { size: number; mtimeMs: number } | null {
  const normalizedPath = filePath.trim();
  if (!normalizedPath) return null;
  try {
    const st = desktopFileBridge()?.statLocalPath?.(normalizedPath);
    if (st && Number.isFinite(st.size) && Number.isFinite(st.mtimeMs)) {
      return { size: st.size, mtimeMs: st.mtimeMs };
    }
  } catch {
    // Bridge missing or path unreadable — fall through to Node when available.
  }
  try {
    // Bun/Node hosts (unit tests). Avoid static `node:fs` import so browser bundles stay clean.
    const req = typeof require === "function" ? require : null;
    if (!req) return null;
    const { statSync } = req("node:fs") as typeof import("node:fs");
    const st = statSync(normalizedPath);
    return { size: st.size, mtimeMs: Number(st.mtimeMs) };
  } catch {
    return null;
  }
}

export async function readDesktopLocalFileAsDataUrl(
  file: File,
  mimeType: string,
): Promise<string | null> {
  const bridge = desktopFileBridge();
  if (!bridge?.readAsDataUrl) return null;
  const timeoutMs = 15_000;
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      bridge.readAsDataUrl(file, mimeType || file.type || "application/octet-stream"),
      new Promise<null>((resolve) => {
        timeoutId = window.setTimeout(() => {
          console.warn(`[WodeAppX] Desktop file bridge timed out after ${timeoutMs}ms`, {
            filename: file.name,
            size: file.size,
          });
          resolve(null);
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    console.warn("[WodeAppX] Failed to read selected file through the desktop bridge", error);
    return null;
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

export async function readDesktopLocalPathAsDataUrl(
  filePath: string,
  mimeType: string,
): Promise<string | null> {
  const normalizedPath = filePath.trim();
  const bridge = desktopFileBridge();
  if (!normalizedPath || !bridge?.readPathAsDataUrl) return null;
  const timeoutMs = 15_000;
  let timeoutId: number | undefined;
  try {
    return await Promise.race([
      bridge.readPathAsDataUrl(normalizedPath, mimeType || "application/octet-stream"),
      new Promise<null>((resolve) => {
        timeoutId = window.setTimeout(() => {
          console.warn(`[WodeAppX] Desktop path bridge timed out after ${timeoutMs}ms`, {
            filePath: normalizedPath,
          });
          resolve(null);
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    console.warn("[WodeAppX] Failed to read a local path through the desktop bridge", error);
    return null;
  } finally {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  }
}

/** Resolve bare attachment names (paste-*.png) via Electron open-path (packs first). */
export async function resolveDesktopLocalOpenPath(
  target: string,
  workspaceRoot?: string | null,
): Promise<string | null> {
  const trimmed = String(target ?? "").trim();
  if (!trimmed) return null;
  const invoke = (typeof window !== "undefined"
    ? (window as Window & {
      __OPENWORK_ELECTRON__?: {
        invokeDesktop?: (command: string, ...args: unknown[]) => Promise<unknown>;
      };
    }).__OPENWORK_ELECTRON__?.invokeDesktop
    : undefined);
  if (!invoke) return null;
  try {
    const resolved = await invoke(
      "__resolveOpenPath",
      trimmed,
      typeof workspaceRoot === "string" ? workspaceRoot.trim() : "",
    );
    return typeof resolved === "string" && resolved.trim() ? resolved.trim() : null;
  } catch (error) {
    console.warn("[WodeAppX] Failed to resolve local open path", error);
    return null;
  }
}
