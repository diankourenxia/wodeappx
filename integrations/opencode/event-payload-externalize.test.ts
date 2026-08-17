import { afterEach, describe, expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import {
  ARTIFACT_SCHEME_HINT,
  EVENT_PAYLOAD_LIMITS,
  EventPayloadExternalizeError,
  defaultSessionMediaRoot,
  externalizePartForEventStore,
  getEventPayloadMetrics,
  isAvOrPdfMedia,
  readExternalizedArtifact,
  resetEventPayloadMetrics,
  shouldSkipDataUrlInline,
  writeSessionArtifact,
} from "./event-payload-externalize"

function withRoot<T>(fn: (root: string) => T): T {
  const root = mkdtempSync(join(tmpdir(), "wodeappx-event-ext-"))
  try {
    return fn(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

describe("event-payload-externalize", () => {
  afterEach(() => {
    resetEventPayloadMetrics()
  })

  test("video data: URL is externalized to session-media (no inline data:)", () => {
    withRoot((root) => {
      const payload = Buffer.alloc(64 * 1024, 7)
      const dataUrl = `data:video/mp4;base64,${payload.toString("base64")}`
      const part = {
        id: "prt_1",
        sessionID: "ses_video",
        messageID: "msg_1",
        type: "file",
        mime: "video/mp4",
        filename: "clip.mp4",
        url: dataUrl,
      }
      const next = externalizePartForEventStore(part, { rootDir: root }) as typeof part & {
        source?: { path?: string; text?: { value?: string } }
      }
      expect(next.type).toBe("file")
      expect(next.url).toMatch(/^file:\/\//)
      expect(next.url.startsWith("data:")).toBe(false)
      expect(String(next.source?.text?.value || "")).toContain(ARTIFACT_SCHEME_HINT)
      expect(String(next.source?.text?.value || "")).toContain("session-media/")
      expect(String(next.source?.path || "").startsWith(root)).toBe(true)
      // Windows NTFS does not honor POSIX 0600/0700 the same way (CI saw 0666).
      if (process.platform !== "win32") {
        expect(statSync(next.source!.path!).mode & 0o777).toBe(0o600)
        expect(statSync(root).mode & 0o777).toBe(0o700)
      }
      const metrics = getEventPayloadMetrics()
      expect(metrics.externalized_count).toBeGreaterThanOrEqual(1)
      expect(metrics.externalized_bytes).toBeGreaterThanOrEqual(payload.byteLength)
      expect(metrics.max_event_bytes).toBeLessThan(EVENT_PAYLOAD_LIMITS.MAX_EVENT_BYTES)
      expect(JSON.stringify(next).length).toBeLessThan(dataUrl.length)
    })
  })

  test("wrong mime + .mp4 filename still skips data: inline (178MB regression)", () => {
    expect(shouldSkipDataUrlInline("application/octet-stream", "meeting.mp4")).toBe(true)
    expect(shouldSkipDataUrlInline("application/octet-stream", "notes.txt")).toBe(false)
    expect(isAvOrPdfMedia("", "clip.webm")).toBe(true)
    expect(isAvOrPdfMedia("video/mp4")).toBe(true)
    withRoot((root) => {
      const payload = Buffer.alloc(8 * 1024, 5)
      const dataUrl = `data:application/octet-stream;base64,${payload.toString("base64")}`
      const next = externalizePartForEventStore({
        id: "prt_bad_mime",
        sessionID: "ses_bad_mime",
        messageID: "msg_1",
        type: "file",
        mime: "application/octet-stream",
        filename: "meeting.mp4",
        url: dataUrl,
      }, { rootDir: root }) as { url: string }
      expect(next.url).toMatch(/^file:\/\//)
      expect(next.url.includes("data:")).toBe(false)
    })
  })

  test("defaultSessionMediaRoot prefers WODEAPPX_SESSION_MEDIA_ROOT", () => {
    const prevMedia = process.env.WODEAPPX_SESSION_MEDIA_ROOT
    const prevLegacy = process.env.WODEAPPX_SESSION_ARTIFACTS_ROOT
    process.env.WODEAPPX_SESSION_MEDIA_ROOT = "/tmp/wodeappx-session-media-test"
    delete process.env.WODEAPPX_SESSION_ARTIFACTS_ROOT
    try {
      expect(defaultSessionMediaRoot()).toBe(resolve("/tmp/wodeappx-session-media-test"))
    } finally {
      if (prevMedia === undefined) delete process.env.WODEAPPX_SESSION_MEDIA_ROOT
      else process.env.WODEAPPX_SESSION_MEDIA_ROOT = prevMedia
      if (prevLegacy === undefined) delete process.env.WODEAPPX_SESSION_ARTIFACTS_ROOT
      else process.env.WODEAPPX_SESSION_ARTIFACTS_ROOT = prevLegacy
    }
  })

  test("durable SQLite event write stores the sanitized payload, not the data URL", () => {
    withRoot((root) => {
      const payload = Buffer.alloc(96 * 1024, 3)
      const dataUrl = `data:video/mp4;base64,${payload.toString("base64")}`
      const db = new Database(":memory:")
      try {
        db.run("CREATE TABLE event (aggregate_id TEXT, seq INTEGER, data TEXT NOT NULL)")
        const part = {
          id: "prt_sqlite",
          sessionID: "ses_sqlite",
          messageID: "msg_sqlite",
          type: "file",
          mime: "video/mp4",
          filename: "clip.mp4",
          url: dataUrl,
        }
        // This mirrors Session.updatePart's durable boundary: sanitize first,
        // then serialize and insert the exact event payload.
        const sanitized = externalizePartForEventStore(part, { rootDir: root })
        const serialized = JSON.stringify(sanitized)
        db.query("INSERT INTO event VALUES (?, ?, ?)").run("ses_sqlite", 1, serialized)
        const row = db.query("SELECT data FROM event WHERE aggregate_id = ?").get("ses_sqlite") as { data: string }
        expect(row.data).not.toContain(dataUrl)
        expect(row.data).not.toContain("data:video/mp4")
        expect(Buffer.byteLength(row.data, "utf8")).toBeLessThan(EVENT_PAYLOAD_LIMITS.MAX_EVENT_BYTES)
        expect(row.data).toContain(ARTIFACT_SCHEME_HINT)
      } finally {
        db.close()
      }
    })
  })

  test("durable write: 3MB video + large tool output stay under 2MiB without silent truncate", () => {
    withRoot((root) => {
      const videoBytes = Buffer.alloc(3 * 1024 * 1024, 9)
      const videoUrl = `data:video/mp4;base64,${videoBytes.toString("base64")}`
      const toolOutput = "T".repeat(EVENT_PAYLOAD_LIMITS.TOOL_OUTPUT_EXTERNALIZE_BYTES + 64 * 1024)
      expect(videoUrl.length).toBeGreaterThan(EVENT_PAYLOAD_LIMITS.MAX_EVENT_BYTES)

      const db = new Database(":memory:")
      try {
        db.run("CREATE TABLE event (id TEXT PRIMARY KEY, type TEXT, data TEXT NOT NULL)")

        const filePart = externalizePartForEventStore({
          id: "prt_big_video",
          sessionID: "ses_big",
          messageID: "msg_file",
          type: "file",
          mime: "video/mp4",
          filename: "big.mp4",
          url: videoUrl,
        }, { rootDir: root })
        const fileEvent = JSON.stringify({ part: filePart })
        db.query("INSERT INTO event VALUES (?, ?, ?)").run("e_file", "message.part.updated.1", fileEvent)

        const toolPart = externalizePartForEventStore({
          id: "prt_big_tool",
          sessionID: "ses_big",
          messageID: "msg_tool",
          type: "tool",
          tool: "bash",
          callID: "call_big",
          state: { status: "completed", output: toolOutput },
        }, { rootDir: root }) as {
          state: { output: string }
        }
        const toolEvent = JSON.stringify({ part: toolPart })
        db.query("INSERT INTO event VALUES (?, ?, ?)").run("e_tool", "message.part.updated.1", toolEvent)

        const rows = db.query("SELECT id, data FROM event ORDER BY id").all() as Array<{ id: string; data: string }>
        expect(rows).toHaveLength(2)
        for (const row of rows) {
          expect(row.data.includes("data:video/mp4")).toBe(false)
          expect(row.data.includes(videoUrl)).toBe(false)
          expect(row.data.includes(toolOutput)).toBe(false)
          expect(Buffer.byteLength(row.data, "utf8")).toBeLessThan(EVENT_PAYLOAD_LIMITS.MAX_EVENT_BYTES)
          expect(row.data).toContain(ARTIFACT_SCHEME_HINT)
        }

        const pathLine = toolPart.state.output.split("\n").find((line) => line.startsWith("path: "))
        expect(pathLine).toBeTruthy()
        const artifactPath = pathLine!.slice("path: ".length)
        const page = readExternalizedArtifact(artifactPath, {
          offset: 100,
          maxChars: 32,
          rootDir: root,
        })
        expect(page.ok).toBe(true)
        if (page.ok) {
          expect(page.text).toBe("T".repeat(32))
          expect(page.bytes).toBe(toolOutput.length)
          expect(page.truncated).toBe(true)
        }

        // Fail-closed: still refuse silent truncate when payload cannot be made small enough.
        expect(() => externalizePartForEventStore({
          id: "prt_still_huge",
          sessionID: "ses_big",
          messageID: "msg_text",
          type: "text",
          text: "x".repeat(EVENT_PAYLOAD_LIMITS.MAX_EVENT_BYTES + 2048),
        }, { rootDir: root })).toThrow(EventPayloadExternalizeError)
        expect(getEventPayloadMetrics().payload_rejected).toBeGreaterThanOrEqual(1)
      } finally {
        db.close()
      }
    })
  })

  test("small data:image below threshold stays inline", () => {
    withRoot((root) => {
      const tiny = `data:image/png;base64,${Buffer.from("tiny").toString("base64")}`
      expect(tiny.length).toBeLessThan(EVENT_PAYLOAD_LIMITS.DATA_URL_EXTERNALIZE_CHARS)
      const part = {
        id: "prt_2",
        sessionID: "ses_img",
        messageID: "msg_1",
        type: "file",
        mime: "image/png",
        filename: "dot.png",
        url: tiny,
      }
      const next = externalizePartForEventStore(part, { rootDir: root })
      expect(next.url).toBe(tiny)
      expect(getEventPayloadMetrics().externalized_count).toBe(0)
    })
  })

  test("large pasted screenshot data:image stays inline (never file://)", () => {
    withRoot((root) => {
      // Mirrors ses_0357fbf67ffe* paste: ~256KiB PNG → data URL ≫ 2048 char spill threshold.
      const payload = Buffer.alloc(256 * 1024, 11)
      const dataUrl = `data:image/png;base64,${payload.toString("base64")}`
      expect(dataUrl.length).toBeGreaterThan(EVENT_PAYLOAD_LIMITS.DATA_URL_EXTERNALIZE_CHARS)
      const part = {
        id: "prt_screenshot",
        sessionID: "ses_paste",
        messageID: "msg_paste",
        type: "file",
        mime: "image/png",
        filename: "image.png",
        url: dataUrl,
      }
      const next = externalizePartForEventStore(part, { rootDir: root }) as typeof part
      expect(next.url).toBe(dataUrl)
      expect(next.url.startsWith("data:image/")).toBe(true)
      expect(next.url.startsWith("file:")).toBe(false)
      expect(getEventPayloadMetrics().externalized_count).toBe(0)
    })
  })

  test("large tool output is externalized with preview + readHint; offset read works", () => {
    withRoot((root) => {
      const big = "A".repeat(EVENT_PAYLOAD_LIMITS.TOOL_OUTPUT_EXTERNALIZE_BYTES + 2048)
      const part = {
        id: "prt_3",
        sessionID: "ses_tool",
        messageID: "msg_1",
        type: "tool",
        tool: "bash",
        callID: "call_1",
        state: {
          status: "completed",
          output: big,
          attachments: [
            {
              type: "file",
              mime: "application/pdf",
              filename: "doc.pdf",
              url: `data:application/pdf;base64,${Buffer.from("%PDF-fake").toString("base64")}`,
            },
          ],
        },
      }
      const next = externalizePartForEventStore(part, { rootDir: root }) as typeof part
      expect(typeof next.state.output).toBe("string")
      expect(next.state.output).toContain(ARTIFACT_SCHEME_HINT)
      expect(next.state.output).toContain("readHint:")
      expect(next.state.output.length).toBeLessThan(big.length)
      expect(next.state.output.includes(big)).toBe(false)
      expect(next.state.attachments![0].url).toMatch(/^file:\/\//)

      const pathLine = next.state.output.split("\n").find((line) => line.startsWith("path: "))
      expect(pathLine).toBeTruthy()
      const artifactPath = pathLine!.slice("path: ".length)
      const body = readFileSync(artifactPath, "utf8")
      expect(body.length).toBe(big.length)

      const page = readExternalizedArtifact(artifactPath, { offset: 10, maxChars: 20, rootDir: root })
      expect(page.ok).toBe(true)
      if (page.ok) {
        expect(page.text).toBe("A".repeat(20))
        expect(page.truncated).toBe(true)
      }
    })
  })

  test("payload still over 2 MiB after externalize is rejected (no silent truncate)", () => {
    withRoot((root) => {
      const huge = "x".repeat(EVENT_PAYLOAD_LIMITS.MAX_EVENT_BYTES + 1000)
      const part = {
        id: "prt_4",
        sessionID: "ses_reject",
        messageID: "msg_1",
        type: "text",
        text: huge,
      }
      expect(() => externalizePartForEventStore(part, { rootDir: root })).toThrow(EventPayloadExternalizeError)
      expect(getEventPayloadMetrics().payload_rejected).toBeGreaterThanOrEqual(1)
    })
  })

  test("oversized tool data:image soft-fails to tiny stub + artifact (ses_025ec834*)", () => {
    withRoot((root) => {
      const payload = Buffer.alloc(EVENT_PAYLOAD_LIMITS.MAX_EVENT_BYTES + 64 * 1024, 7)
      const dataUrl = `data:image/jpeg;base64,${payload.toString("base64")}`
      const part = {
        id: "prt_image_preview",
        sessionID: "ses_025ec834",
        messageID: "msg_view",
        type: "tool",
        tool: "wodeappx_browser_screenshot",
        callID: "call_view",
        state: {
          status: "completed",
          output: JSON.stringify({ ok: true, stage: "screenshot" }),
          attachments: [
            {
              type: "file",
              mime: "image/jpeg",
              filename: "all-view.jpg",
              url: dataUrl,
            },
          ],
        },
      }
      const next = externalizePartForEventStore(part, { rootDir: root }) as typeof part
      expect(Buffer.byteLength(JSON.stringify(next), "utf8")).toBeLessThanOrEqual(
        EVENT_PAYLOAD_LIMITS.MAX_EVENT_BYTES,
      )
      expect(next.state.attachments![0].url.startsWith("data:image/jpeg")).toBe(true)
      expect(next.state.attachments![0].url.length).toBeLessThan(2_048)
      expect(String(next.state.output)).toContain("Self-healed")
      expect(String(next.state.output)).toContain("wodeappx-session-artifact")
      expect(getEventPayloadMetrics().externalized_count).toBeGreaterThanOrEqual(1)
    })
  })

  test("writeSessionArtifact is idempotent by sha256", () => {
    withRoot((root) => {
      const bytes = Buffer.from("same-bytes")
      const a = writeSessionArtifact({ sessionID: "ses_id", bytes, mime: "text/plain", filename: "a.txt", rootDir: root })
      const b = writeSessionArtifact({ sessionID: "ses_id", bytes, mime: "text/plain", filename: "b.txt", rootDir: root })
      expect(a.path).toBe(b.path)
      expect(a.sha256).toBe(b.sha256)
    })
  })
})
