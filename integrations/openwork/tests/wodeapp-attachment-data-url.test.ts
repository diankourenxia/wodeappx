import { describe, expect, test } from "bun:test";

import {
  attachmentToModelFileData,
  canInlineAttachmentAsModelDataUrl,
  modelFacingAttachmentMime,
} from "../attachment-data-url";

describe("attachment-data-url Codex-style guards", () => {
  test("only images may become model data URLs", () => {
    expect(canInlineAttachmentAsModelDataUrl("image/png")).toBe(true);
    expect(canInlineAttachmentAsModelDataUrl("image/jpeg")).toBe(true);
    expect(canInlineAttachmentAsModelDataUrl("video/mp4")).toBe(false);
    expect(canInlineAttachmentAsModelDataUrl("audio/mpeg")).toBe(false);
    expect(canInlineAttachmentAsModelDataUrl("application/pdf")).toBe(false);
  });

  test("refuses to base64 a video attachment", async () => {
    const file = new File([new Uint8Array([0, 0, 0, 0x18])], "meeting.mp4", {
      type: "video/mp4",
    });
    await expect(attachmentToModelFileData(file, "video/mp4")).rejects.toThrow(/non-image/i);
  });
});

describe("modelFacingAttachmentMime (OpenWork #3079)", () => {
  test("remaps text-like provider-unsafe mimes to text/plain", () => {
    expect(modelFacingAttachmentMime("text/xml")).toBe("text/plain");
    expect(modelFacingAttachmentMime("application/json")).toBe("text/plain");
    expect(modelFacingAttachmentMime("application/xml")).toBe("text/plain");
    expect(modelFacingAttachmentMime("text/csv")).toBe("text/plain");
    expect(modelFacingAttachmentMime("application/javascript")).toBe("text/plain");
    expect(modelFacingAttachmentMime("application/ld+json")).toBe("text/plain");
  });

  test("passes through image / pdf / office", () => {
    expect(modelFacingAttachmentMime("image/png")).toBe("image/png");
    expect(modelFacingAttachmentMime("application/pdf")).toBe("application/pdf");
    expect(modelFacingAttachmentMime(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  });

  test("drops binary / zip / video so they cannot poison session history", () => {
    expect(modelFacingAttachmentMime("application/zip")).toBeNull();
    expect(modelFacingAttachmentMime("application/octet-stream")).toBeNull();
    expect(modelFacingAttachmentMime("video/mp4")).toBeNull();
    expect(modelFacingAttachmentMime("audio/mpeg")).toBeNull();
    expect(modelFacingAttachmentMime("")).toBeNull();
  });
});
