const OPENABLE_LOCAL_FILE_EXTENSIONS = new Set([
  ".csv", ".gif", ".html", ".htm", ".jpeg", ".jpg", ".json", ".log", ".md",
  ".mov", ".mp3", ".mp4", ".pdf", ".png", ".ppt", ".pptx", ".svg", ".tsv",
  ".txt", ".wav", ".webm", ".webp", ".xls", ".xlsx", ".yaml", ".yml", ".zip",
]);

const WORKSPACES_PREFIX_PATTERN = /^workspaces\/[^/]+\//i;
const WORKSPACE_ID_PREFIX_PATTERN = /^workspace\/(?:ws_[^/]+|\d+|[0-9a-f-]{6,})\//i;

function looksLikeLocalAbsoluteOrHomePath(value: string) {
  return /^(?:~(?:[/\\]|$)|\/|[A-Za-z]:[/\\])/.test(value);
}

/**
 * Detect a lone http(s) URL inside markdown inline/fenced code so chat can
 * render it as a clickable link (models often wrap taskUrl in backticks).
 */
export function httpUrlFromCode(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 2000) return null;
  if (/[\r\n]/.test(trimmed)) return null;

  const unwrapped = (
    (trimmed.startsWith("<") && trimmed.endsWith(">"))
    || (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  )
    ? trimmed.slice(1, -1).trim()
    : trimmed;

  if (!/^https?:\/\/[^\s<>"'`]+$/i.test(unwrapped)) return null;
  return unwrapped;
}

/**
 * Detect local file/directory paths inside markdown inline code so they become
 * clickable open buttons. Supports Chinese filenames and `~/…` home paths.
 */
export function localFileReferenceFromCode(text: string) {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 500 || /[\r\n]/.test(trimmed)) return null;
  if (/^(?:https?|mailto|data|blob):/i.test(trimmed)) return null;
  if (/^(?:npx|npm|pnpm|bunx?|node|python\d*|uvx?|deno|ffmpeg|hyperframes)\s+/i.test(trimmed)) return null;

  const unquoted = (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) ? trimmed.slice(1, -1).trim() : trimmed;
  const cleanPath = (unquoted.split(/[?#]/)[0] ?? unquoted).replace(/\/+$/, "");
  if (!cleanPath || cleanPath.includes("...")) return null;

  const fileName = cleanPath.split(/[/\\]/).filter(Boolean).pop() ?? cleanPath;
  const extensionIndex = fileName.lastIndexOf(".");
  const extension = extensionIndex >= 0 ? fileName.slice(extensionIndex).toLowerCase() : "";

  if (OPENABLE_LOCAL_FILE_EXTENSIONS.has(extension)) return unquoted.replace(/\/+$/, "") || unquoted;

  // Absolute / home directories (e.g. /var/folders/.../project or ~/Desktop/out)
  if (looksLikeLocalAbsoluteOrHomePath(cleanPath) && cleanPath.includes("/") && !extension) {
    return cleanPath;
  }

  return null;
}

export function localFileReferenceKind(path: string): "file" | "directory" {
  const clean = path.trim().replace(/\/+$/, "");
  const fileName = clean.split(/[/\\]/).filter(Boolean).pop() ?? clean;
  const extensionIndex = fileName.lastIndexOf(".");
  const extension = extensionIndex >= 0 ? fileName.slice(extensionIndex).toLowerCase() : "";
  return OPENABLE_LOCAL_FILE_EXTENSIONS.has(extension) ? "file" : "directory";
}

/** Normalize for chip ↔ artifact path matching (case/slash/workspace-prefix insensitive). */
export function normalizeLocalFilePathForMatch(path: string) {
  return path
    .trim()
    .replace(/[\\]+/g, "/")
    .replace(/^\.\//, "")
    .replace(WORKSPACES_PREFIX_PATTERN, "")
    .replace(WORKSPACE_ID_PREFIX_PATTERN, "")
    .replace(/[/]+$/, "")
    .toLowerCase();
}

/**
 * Match a markdown chip path to a derived open-target value.
 * Bare chips like `demo.mp4` must match full paths ending in that basename.
 */
export function localFilePathMatchesTarget(path: string, targetValue: string) {
  const normalizedPath = normalizeLocalFilePathForMatch(path);
  const normalizedTarget = normalizeLocalFilePathForMatch(targetValue);
  if (!normalizedPath || !normalizedTarget) return false;
  if (normalizedPath === normalizedTarget) return true;
  if (normalizedTarget.endsWith(`/${normalizedPath}`)) return true;
  if (normalizedPath.endsWith(`/${normalizedTarget}`)) return true;

  const pathBase = normalizedPath.split("/").pop() ?? normalizedPath;
  const targetBase = normalizedTarget.split("/").pop() ?? normalizedTarget;
  if (!normalizedPath.includes("/") && pathBase === targetBase) return true;
  return false;
}

type PathMatchCandidate = {
  value: string;
  confidence?: number;
  kind?: string;
};

/** Prefer absolute / longer / higher-confidence targets when a bare chip matches many. */
export function pickBestLocalFilePathMatch<T extends PathMatchCandidate>(
  path: string,
  candidates: T[],
): T | null {
  const matches = candidates.filter((candidate) => localFilePathMatchesTarget(path, candidate.value));
  if (!matches.length) return null;
  const score = (candidate: PathMatchCandidate) => {
    const value = candidate.value.trim();
    const absolute = looksLikeLocalAbsoluteOrHomePath(value) ? 10_000 : 0;
    const nested = value.includes("/") || value.includes("\\") ? 1_000 : 0;
    return absolute + nested + value.length + (candidate.confidence ?? 0);
  };
  return [...matches].sort((left, right) => score(right) - score(left))[0] ?? null;
}
