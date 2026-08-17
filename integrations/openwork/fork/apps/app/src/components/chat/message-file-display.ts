const DISPLAYABLE_IMAGE_URL_PATTERN = /^(data:image\/|https?:\/\/|blob:|file:\/\/|wodeappx-asset:)/i
const OPENABLE_ATTACHMENT_URL_PATTERN = /^(https?:\/\/|file:\/\/|wodeappx-asset:)/i
/** Marker left by PERF-05 slim when a fat data:image was stripped from the transcript cache. */
export const WODEAPPX_LOCAL_ATTACHMENT_SCHEME = "wodeappx-local:"

/**
 * Synthetic / non-filesystem URLs that must never be joined onto a workspace
 * root or passed to shell.openPath. Includes the old optimistic:// scheme and
 * history scrub stubs.
 */
export function isStubAttachmentUrl(url: string) {
  const trimmed = String(url ?? "").trim()
  if (!trimmed) return true
  if (trimmed === "data:text/plain;base64,IA==") return true
  if (/^data:[^;]+;base64,$/i.test(trimmed)) return true
  if (/^optimistic:\/\//i.test(trimmed)) return true
  if (/^blob:/i.test(trimmed)) return true
  if (/^wodeappx-local:/i.test(trimmed)) return true
  return false
}

/** PERF-05 slim marker or empty url — still an image attachment that can be hydrated. */
export function isSlimmedLocalImageRef(url: string) {
  const trimmed = String(url ?? "").trim()
  return !trimmed || /^wodeappx-local:/i.test(trimmed)
}

export function filenameFromSlimmedLocalRef(url: string, fallbackFilename?: string | null) {
  const trimmed = String(url ?? "").trim()
  if (/^wodeappx-local:/i.test(trimmed)) {
    try {
      return decodeURIComponent(trimmed.slice(WODEAPPX_LOCAL_ATTACHMENT_SCHEME.length)).trim() || (fallbackFilename || "").trim()
    } catch {
      return trimmed.slice(WODEAPPX_LOCAL_ATTACHMENT_SCHEME.length).trim() || (fallbackFilename || "").trim()
    }
  }
  return (fallbackFilename || "").trim()
}

export function toSlimmedLocalAttachmentUrl(filename: string) {
  const name = String(filename ?? "").trim() || "image"
  return `${WODEAPPX_LOCAL_ATTACHMENT_SCHEME}${encodeURIComponent(name)}`
}

/** URLs safe to open externally or in the in-app browser. */
export function isOpenableAttachmentUrl(url: string) {
  return OPENABLE_ATTACHMENT_URL_PATTERN.test(String(url ?? "").trim())
}

/** Absolute local path → file:// URL for chat chips / open targets. */
export function toFileUrlFromAbsolutePath(absolutePath: string): string | null {
  const trimmed = String(absolutePath ?? "").trim()
  if (!trimmed) return null
  if (/^file:\/\//i.test(trimmed)) return trimmed
  if (!(trimmed.startsWith("/") || /^[A-Za-z]:[\\/]/.test(trimmed))) return null
  const normalized = trimmed.replace(/\\/g, "/")
  return `file://${normalized.split("/").map((segment) => encodeURIComponent(segment)).join("/")}`
}

/**
 * Compacted/model-scrubbed parts may still carry a local/https preview URL.
 * Those should render as inline chat thumbnails, not click-to-open file chips.
 * Live composer / optimistic bubbles use blob: previews (Electron-safe).
 */
export function canRenderInlineChatImage(part: { mediaType: string; url: string }) {
  if (!part.mediaType.startsWith("image/")) return false
  if (/^blob:/i.test(part.url.trim())) return true
  // Only the explicit PERF-05 marker counts as an inline image candidate here.
  // Bare empty urls stay file chips until FileMessage resolves+hydrates them.
  if (/^wodeappx-local:/i.test(part.url.trim())) return true
  return DISPLAYABLE_IMAGE_URL_PATTERN.test(part.url)
    && !isStubAttachmentUrl(part.url)
}
