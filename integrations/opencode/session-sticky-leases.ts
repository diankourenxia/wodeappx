/**
 * Durable sticky tool leases for deferred discovery.
 *
 * In-memory leases die with the OpenCode sidecar process. Session chat history
 * survives. Persist loaded tool IDs per sessionID so a restart can rehydrate
 * the same callable surface (design A: lease lifetime = session lifetime).
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export type StickyLeaseRecord = {
  toolIDs: string[]
  updatedAt: number
}

function safeSessionFileName(sessionID: string) {
  const trimmed = sessionID.trim()
  if (!trimmed) return "_empty"
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180)
}

export function stickyLeaseRootDir() {
  const override = process.env.OPENCODE_STICKY_LEASE_DIR?.trim()
  if (override) return override
  const xdg = process.env.XDG_DATA_HOME?.trim()
  if (xdg) return join(xdg, "opencode", "session-sticky-leases")
  return join(homedir(), ".wodeappx", "session-sticky-leases")
}

function leasePath(sessionID: string) {
  return join(stickyLeaseRootDir(), `${safeSessionFileName(sessionID)}.json`)
}

function ensureRoot() {
  const root = stickyLeaseRootDir()
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true, mode: 0o700 })
  }
  try {
    chmodSync(root, 0o700)
  } catch {
    // best-effort on platforms that ignore mode
  }
  return root
}

export function readStickyLeaseToolIDs(sessionID: string): string[] {
  const id = sessionID.trim()
  if (!id) return []
  const path = leasePath(id)
  if (!existsSync(path)) return []
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as StickyLeaseRecord
    if (!Array.isArray(raw?.toolIDs)) return []
    return [...new Set(raw.toolIDs.map((item) => String(item).trim()).filter(Boolean))]
  } catch {
    return []
  }
}

export function writeStickyLeaseToolIDs(sessionID: string, toolIDs: Iterable<string>) {
  const id = sessionID.trim()
  if (!id) return
  const unique = [...new Set([...toolIDs].map((item) => String(item).trim()).filter(Boolean))].sort()
  if (unique.length === 0) {
    clearStickyLeaseToolIDs(id)
    return
  }
  ensureRoot()
  const path = leasePath(id)
  const tmp = `${path}.${process.pid}.tmp`
  const body: StickyLeaseRecord = {
    toolIDs: unique,
    updatedAt: Date.now(),
  }
  writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  try {
    chmodSync(tmp, 0o600)
  } catch {
    // ignore
  }
  renameSync(tmp, path)
}

export function clearStickyLeaseToolIDs(sessionID: string) {
  const id = sessionID.trim()
  if (!id) return
  const path = leasePath(id)
  if (!existsSync(path)) return
  try {
    unlinkSync(path)
  } catch {
    // ignore
  }
}

/**
 * Copy durable sticky tool IDs from one session to another (Session.fork).
 * Forked transcripts inherit the parent's loaded deferred surface so the model
 * does not lose publish/create tools that history already used.
 */
export function copyStickyLeaseToolIDs(fromSessionID: string, toSessionID: string): string[] {
  const from = fromSessionID.trim()
  const to = toSessionID.trim()
  if (!from || !to || from === to) return []
  const toolIDs = readStickyLeaseToolIDs(from)
  if (!toolIDs.length) return []
  writeStickyLeaseToolIDs(to, toolIDs)
  return toolIDs
}
