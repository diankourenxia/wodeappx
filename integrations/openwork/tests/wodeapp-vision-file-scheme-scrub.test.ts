import { describe, expect, test } from "bun:test";
import {
  compactEphemeralVisionFilePartsAfterIdle,
  isChatThumbnailDisplayUrl,
  isEphemeralNonImageDataUrlFilePart,
  isEphemeralVisionDataUrlFilePart,
  isFileSchemeImageFilePart,
  isFileSchemeUnsafeFilePart,
  isModelSafeMediaUrl,
  scrubUnsafeModelMediaBeforePrompt,
} from "../wodeapp/wodeapp-vision-history-compact";
import { isComposerImageAttachment } from "../wodeapp/wodeapp-attachment-intelligence";
import { canRenderInlineChatImage } from "../fork/apps/app/src/components/chat/message-file-display";

describe("vision compact keep-ui drop-model-pixels", () => {
  test("detects unsafe file scheme image parts", () => {
    expect(isFileSchemeImageFilePart({
      id: "prt_file",
      type: "file",
      mime: "image/jpeg",
      filename: "local.jpg",
      url: "file:///tmp/local.jpg",
    })).toBe(true);
    expect(isFileSchemeUnsafeFilePart({
      id: "prt_video_path",
      type: "file",
      mime: "video/mp4",
      filename: "meeting.mp4",
      url: "file:///tmp/meeting.mp4",
    })).toBe(true);
    expect(isEphemeralNonImageDataUrlFilePart({
      id: "prt_video_data",
      type: "file",
      mime: "video/mp4",
      filename: "meeting.mp4",
      url: "data:video/mp4;base64,AAAA",
    })).toBe(true);
    expect(isModelSafeMediaUrl("https://cdn.example/a.png")).toBe(true);
    expect(isModelSafeMediaUrl("file:///tmp/a.png")).toBe(false);
    expect(isEphemeralVisionDataUrlFilePart({
      id: "prt_1",
      type: "file",
      mime: "image/png",
      filename: "banner.png",
      url: "data:image/png;base64,aaaa",
    }, new Set(["banner.png"]))).toBe(true);
  });

  test("session spill file:// is not kept as chat thumbnail after scrub", () => {
    expect(isChatThumbnailDisplayUrl(
      "file:///Users/test/.wodeappx/session-artifacts/ses_x/hash.png",
    )).toBe(false);
    expect(isChatThumbnailDisplayUrl(
      "file:///Users/test/.wodeappx/session-media/ses_x/hash.mp4",
    )).toBe(false);
    expect(isChatThumbnailDisplayUrl(
      "file:///Users/test/.wodeappx/attachment-context-packs/ctx_x/01-image.png",
    )).toBe(true);
    expect(isChatThumbnailDisplayUrl("https://cdn.example/a.png")).toBe(true);
  });

  test("treats empty-mime screenshot filenames as images (no file:// fallback)", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "image.jpg", { type: "" });
    expect(isComposerImageAttachment({
      id: "att_empty_mime",
      name: "image.jpg",
      mimeType: "",
      kind: "file",
      file,
    } as any)).toBe(true);
    expect(isComposerImageAttachment({
      id: "att_pdf",
      name: "brief.pdf",
      mimeType: "",
      kind: "file",
      file: new File([new Uint8Array([1])], "brief.pdf", { type: "" }),
    } as any)).toBe(false);
  });

  test("scrubbed local image placeholders still render as inline chat thumbnails", () => {
    expect(canRenderInlineChatImage({
      mediaType: "image/jpeg",
      url: "file:///Users/test/.wodeappx/attachment-context-packs/ctx_x/01-image.jpg",
    })).toBe(true);
    expect(canRenderInlineChatImage({
      mediaType: "image/png",
      url: "https://cdn.example/a.png",
    })).toBe(true);
    expect(canRenderInlineChatImage({
      mediaType: "image/jpeg",
      url: "data:text/plain;base64,IA==",
    })).toBe(false);
    expect(canRenderInlineChatImage({
      mediaType: "application/pdf",
      url: "file:///tmp/brief.pdf",
    })).toBe(false);
  });

  test("pre-prompt scrub heals file:// without waiting for idle or touching data:image", async () => {
    const updates: Array<{ partID: string; part?: Record<string, unknown> }> = [];
    const client = {
      session: {
        status: async () => ({ data: { ses_test: { type: "busy" } } }),
        messages: async () => ({
          data: [{
            info: { id: "msg_user", role: "user" },
            parts: [
              {
                id: "prt_poison",
                messageID: "msg_user",
                type: "file",
                mime: "image/jpeg",
                filename: "poison.jpg",
                url: "file:///tmp/poison.jpg",
              },
              {
                id: "prt_artifact",
                messageID: "msg_user",
                type: "file",
                mime: "image/png",
                filename: "image.png",
                url: "file:///Users/test/.wodeappx/session-artifacts/ses_x/hash.png",
              },
              {
                id: "prt_keep_pixels",
                messageID: "msg_user",
                type: "file",
                mime: "image/png",
                filename: "fresh.png",
                url: "data:image/png;base64,aaaa",
              },
            ],
          }],
        }),
      },
      part: {
        delete: async () => ({}),
        update: async (params: { partID: string; part?: Record<string, unknown> }) => {
          updates.push(params);
          return {};
        },
      },
    };
    const result = await scrubUnsafeModelMediaBeforePrompt({
      client,
      sessionId: "ses_test",
    });
    expect(result.scrubbed).toBe(2);
    expect(updates).toHaveLength(2);
    expect(updates.map((item) => item.partID).sort()).toEqual(["prt_artifact", "prt_poison"]);
    for (const item of updates) {
      expect(item.part?.type).toBe("text");
      const meta = (item.part?.metadata as { wodeappAttachmentPlaceholder?: { url?: string } } | undefined)
        ?.wodeappAttachmentPlaceholder;
      expect(String(meta?.url || "")).not.toContain("session-artifacts");
    }
    expect(String(updates.find((item) => item.partID === "prt_poison")?.part?.text || "")).toContain("poison.jpg");
  });

  test("rewrites https, placeholders local/data, never deletes or leaves file:// type:file", async () => {
    const deleted: string[] = [];
    const updates: Array<{ partID: string; part?: Record<string, unknown> }> = [];
    let statusCalls = 0;
    const client = {
      session: {
        status: async () => {
          statusCalls += 1;
          return { data: { ses_test: { type: statusCalls === 1 ? "busy" : "idle" } } };
        },
        messages: async () => ({
          data: [{
            info: { id: "msg_user", role: "user" },
            parts: [
              {
                id: "prt_https",
                messageID: "msg_user",
                type: "file",
                mime: "image/png",
                filename: "banner.png",
                url: "data:image/png;base64,aaaa",
              },
              {
                id: "prt_local",
                messageID: "msg_user",
                type: "file",
                mime: "image/jpeg",
                filename: "local.jpg",
                url: "data:image/jpeg;base64,bbbb",
              },
              {
                id: "prt_poison",
                messageID: "msg_user",
                type: "file",
                mime: "image/jpeg",
                filename: "poison.jpg",
                url: "file:///tmp/poison.jpg",
              },
              {
                id: "prt_video",
                messageID: "msg_user",
                type: "file",
                mime: "video/mp4",
                filename: "meeting.mp4",
                url: "data:video/mp4;base64,AAAA",
              },
            ],
          }],
        }),
      },
      part: {
        delete: async (params: { partID: string }) => {
          deleted.push(params.partID);
          return {};
        },
        update: async (params: { partID: string; part?: Record<string, unknown> }) => {
          updates.push(params);
          return {};
        },
      },
    };
    const result = await compactEphemeralVisionFilePartsAfterIdle({
      client,
      sessionId: "ses_test",
      filenames: ["banner.png", "local.jpg"],
      displayUrls: [
        { filename: "banner.png", url: "https://cdn.example/banner.png" },
        { filename: "local.jpg", url: "file:///tmp/local.jpg" },
      ],
      timeoutMs: 5_000,
      graceMs: 0,
      pollMs: 1,
    });
    expect(result.idle).toBe(true);
    expect(result.rewritten).toBe(2);
    expect(result.scrubbed).toBe(2);
    expect(deleted).toEqual([]);
    const byId = new Map(updates.map((item) => [item.partID, item.part]));
    expect(byId.get("prt_https")?.type).toBe("file");
    expect(byId.get("prt_https")?.url).toBe("https://cdn.example/banner.png");
    expect(byId.get("prt_local")?.type).toBe("text");
    expect(String(byId.get("prt_local")?.text || "")).toContain("local.jpg");
    expect(byId.get("prt_poison")?.type).toBe("text");
    expect(byId.get("prt_video")?.type).toBe("text");
    expect(String(byId.get("prt_video")?.text || "")).toContain("meeting.mp4");
    expect(updates.every((item) => {
      const url = typeof item.part?.url === "string" ? item.part.url : "";
      return !url.startsWith("file:") && !url.startsWith("data:video/");
    })).toBe(true);
  });
});
