/**
 * Real send-path probe: mirrors session-route gates + measures whether remote
 * attachment intelligence would run. Does not call the LLM.
 */
import { describe, expect, test } from "bun:test";

import type { ComposerAttachment, ComposerDraft, ModelRef } from "../src/app/types";
import {
  shouldIncludeAssetMentionFilesInPrompt,
  shouldIncludeRawAttachmentsInPrompt,
  shouldPreserveAttachmentsAsDisplayOnly,
  shouldUseAttachmentIntelligence,
} from "../wodeapp/wodeapp-attachment-intelligence";
import { resolveModelMediaInputCapabilities } from "../wodeapp/wodeapp-model-media-input";

function attachment(input: {
  id: string;
  name: string;
  mimeType: string;
  kind: ComposerAttachment["kind"];
  bytes?: Uint8Array;
}): ComposerAttachment {
  const bytes = input.bytes || new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 24]);
  const file = new File([bytes], input.name, { type: input.mimeType });
  return {
    ...input,
    file,
    size: file.size,
  };
}

function draft(text: string, attachments: ComposerAttachment[] = []): ComposerDraft {
  return {
    mode: "prompt",
    parts: [],
    text,
    attachments,
  };
}

function model(id: string): ModelRef {
  return { providerID: "wodeapp", modelID: id };
}

type SendPlan = {
  modelId: string;
  useAttachmentIntelligence: boolean;
  includeRaw: boolean;
  imagesOnly: boolean;
  includeAssetMentionFiles: boolean;
  preserveDisplayOnly: boolean;
  gateMs: number;
};

function planSend(modelId: string, nextDraft: ComposerDraft): SendPlan {
  const t0 = performance.now();
  const mediaInput = resolveModelMediaInputCapabilities(model(modelId), null);
  const modelSupportsVision = mediaInput.image;
  const useAttachmentIntelligence = shouldUseAttachmentIntelligence({
    enabled: true,
    draft: nextDraft,
    modelSupportsVision,
    mediaInput,
  });
  const preserveDisplayOnly = shouldPreserveAttachmentsAsDisplayOnly({
    enabled: true,
    draft: nextDraft,
    modelSupportsVision,
    mediaInput,
  });
  const raw = shouldIncludeRawAttachmentsInPrompt({
    modelSupportsVision,
    useAttachmentIntelligence,
    preserveAttachmentsAsDisplayOnly: preserveDisplayOnly,
    draft: nextDraft,
    mediaInput,
  });
  const includeAssetMentionFiles = shouldIncludeAssetMentionFilesInPrompt({
    draft: nextDraft,
    modelSupportsVision,
    useAttachmentIntelligence,
    mediaInput,
  });
  const gateMs = performance.now() - t0;
  return {
    modelId,
    useAttachmentIntelligence,
    includeRaw: raw.includeRawAttachments,
    imagesOnly: raw.imagesOnly,
    includeAssetMentionFiles,
    preserveDisplayOnly,
    gateMs,
  };
}

describe("media send-path live routing + speed", () => {
  test("MiniMax image upload: direct vision, no remote parse, sub-ms gate", () => {
    const image = attachment({
      id: "live-img",
      name: "product.jpg",
      mimeType: "image/jpeg",
      kind: "image",
    });
    const nextDraft = draft("这张图主色是什么？边框有没有多余装饰？", [image]);
    const plan = planSend("wode/minimax-m3", nextDraft);

    expect(plan.useAttachmentIntelligence).toBe(false);
    expect(plan.includeRaw).toBe(true);
    expect(plan.imagesOnly).toBe(true);
    expect(plan.gateMs).toBeLessThan(5);

    console.log("[send-path]", JSON.stringify({
      case: "minimax-image-upload",
      ...plan,
      remoteParseWouldRun: plan.useAttachmentIntelligence,
    }));
  });

  test("DeepSeek image upload: must parse, still sub-ms gate", () => {
    const image = attachment({
      id: "live-img-ds",
      name: "product.jpg",
      mimeType: "image/jpeg",
      kind: "image",
    });
    const nextDraft = draft("这张图主色是什么？", [image]);
    const plan = planSend("wode/deepseek-v4-pro", nextDraft);

    expect(plan.useAttachmentIntelligence).toBe(true);
    expect(plan.includeRaw).toBe(false);
    expect(plan.gateMs).toBeLessThan(5);

    console.log("[send-path]", JSON.stringify({
      case: "deepseek-image-upload",
      ...plan,
      remoteParseWouldRun: plan.useAttachmentIntelligence,
    }));
  });

  test("@ local asset look: MiniMax inlines files, skips remote parse", () => {
    const nextDraft = draft("看看 [阿尔法蛋] 这个商品的素材颜色和 Logo", []);
    nextDraft.assetMentions = [{
      id: "p1",
      name: "阿尔法蛋",
      kind: "商品库",
      meta: "商品库",
      productImages: ["wodeappx-asset://local/product.png"],
    }];
    const plan = planSend("wode/minimax-m3", nextDraft);

    expect(plan.useAttachmentIntelligence).toBe(false);
    expect(plan.includeAssetMentionFiles).toBe(true);
    expect(plan.gateMs).toBeLessThan(5);

    console.log("[send-path]", JSON.stringify({
      case: "minimax-at-local-look",
      ...plan,
      remoteParseWouldRun: plan.useAttachmentIntelligence,
    }));
  });

  test("MiniMax video upload: never raw-inline; path/tool intelligence only", () => {
    const video = attachment({
      id: "live-video",
      name: "meeting.mp4",
      mimeType: "video/mp4",
      kind: "file",
      bytes: new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]),
    });
    const nextDraft = draft("解析这个会议视频并做总结", [video]);
    const mediaInput = resolveModelMediaInputCapabilities(model("wode/minimax-m3"), null);
    expect(mediaInput.video).toBe(true);
    const plan = planSend("wode/minimax-m3", nextDraft);

    expect(plan.useAttachmentIntelligence).toBe(true);
    expect(plan.includeRaw).toBe(false);
    expect(plan.preserveDisplayOnly).toBe(true);
    expect(plan.gateMs).toBeLessThan(5);

    console.log("[send-path]", JSON.stringify({
      case: "minimax-video-upload",
      ...plan,
      mediaVideoNative: mediaInput.video,
      remoteParseWouldRun: plan.useAttachmentIntelligence,
    }));
  });

  test("MiniMax PDF: no chat-native PDF; no remote vision parse for file_api", () => {
    const pdf = attachment({
      id: "live-pdf",
      name: "spec.pdf",
      mimeType: "application/pdf",
      kind: "file",
      bytes: new TextEncoder().encode("%PDF-1.7\n"),
    });
    const nextDraft = draft("总结这份规格书", [pdf]);
    const mediaInput = resolveModelMediaInputCapabilities(model("wode/minimax-m3"), null);
    expect(mediaInput.pdf).toBe(false); // file_api → not chat native
    const plan = planSend("wode/minimax-m3", nextDraft);
    // PDF still needs tool/extract path; gate may enable intelligence when user asks to use it.
    expect(plan.useAttachmentIntelligence).toBe(true);
    console.log("[send-path]", JSON.stringify({
      case: "minimax-pdf",
      ...plan,
      mediaPdfNative: mediaInput.pdf,
      notes: mediaInput.notes,
    }));
  });

  test("gate matrix timing across branded models stays under 2ms average", () => {
    const image = attachment({
      id: "bench",
      name: "a.png",
      mimeType: "image/png",
      kind: "image",
    });
    const nextDraft = draft("描述图片", [image]);
    const models = [
      "wode/minimax-m3",
      "wode/kimi-k3",
      "wode/doubao-pro",
      "wode/qwen3.8-max",
      "wode/deepseek-v4-pro",
      "wode/glm-5.2",
    ];
    const rows = models.map((id) => planSend(id, nextDraft));
    const avg = rows.reduce((sum, row) => sum + row.gateMs, 0) / rows.length;
    expect(avg).toBeLessThan(2);
    const expectedParse = new Set(["wode/deepseek-v4-pro", "wode/glm-5.2"]);
    for (const row of rows) {
      expect(row.useAttachmentIntelligence).toBe(expectedParse.has(row.modelId));
      if (!expectedParse.has(row.modelId)) {
        expect(row.includeRaw).toBe(true);
      }
    }
    console.log("[send-path-bench]", JSON.stringify({
      avgGateMs: Number(avg.toFixed(4)),
      rows: rows.map((row) => ({
        model: row.modelId,
        parse: row.useAttachmentIntelligence,
        raw: row.includeRaw,
        gateMs: Number(row.gateMs.toFixed(4)),
      })),
    }));
  });
});
