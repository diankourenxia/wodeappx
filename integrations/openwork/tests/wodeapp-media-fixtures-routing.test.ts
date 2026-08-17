/**
 * Fixture-backed media routing probe.
 * Uses real tiny PNG/PDF/DOCX/XLSX/MP4/TXT bytes from disk.
 * Still not a desktop UI / LLM live send — it exercises the real send gates
 * + local understandDraftAttachments where no remote API is required.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import type { ComposerAttachment, ComposerDraft, ModelRef } from "../src/app/types";
import {
  shouldIncludeRawAttachmentsInPrompt,
  shouldPreserveAttachmentsAsDisplayOnly,
  shouldUseAttachmentIntelligence,
  understandDraftAttachments,
} from "../wodeapp/wodeapp-attachment-intelligence";
import { resolveModelMediaInputCapabilities } from "../wodeapp/wodeapp-model-media-input";

const FIXTURE_DIR = join(import.meta.dir, "fixtures/media-routing");

const FIXTURES = [
  {
    id: "png",
    name: "sample.png",
    mimeType: "image/png",
    kind: "image" as const,
    prompt: "这张图主色是什么？",
  },
  {
    id: "pdf",
    name: "sample.pdf",
    mimeType: "application/pdf",
    kind: "file" as const,
    prompt: "总结这份 PDF 的内容",
  },
  {
    id: "docx",
    name: "sample.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    kind: "file" as const,
    prompt: "总结这份 Word 文档",
  },
  {
    id: "xlsx",
    name: "sample.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    kind: "file" as const,
    prompt: "看看这个 Excel 里有什么",
  },
  {
    id: "mp4",
    name: "sample.mp4",
    mimeType: "video/mp4",
    kind: "file" as const,
    prompt: "看看这段视频讲了什么",
  },
  {
    id: "txt",
    name: "sample.txt",
    mimeType: "text/plain",
    kind: "file" as const,
    prompt: "总结这份文本",
  },
] as const;

/** Branded chat models we care about for media routing. */
const MODELS = [
  "wode/minimax-m3",
  "wode/kimi-k3",
  "wode/doubao-pro",
  "wode/doubao-turbo",
  "wode/qwen3.8-max",
  "wode/deepseek-v4-pro",
  "wode/glm-5.2",
] as const;

const VISION_NATIVE_MODELS = [
  "wode/minimax-m3",
  "wode/kimi-k3",
  "wode/doubao-pro",
  "wode/doubao-turbo",
  "wode/qwen3.8-max",
] as const;

const PDF_CHAT_NATIVE_MODELS = [
  "wode/doubao-pro",
  "wode/doubao-turbo",
  "wode/qwen3.8-max",
] as const;

const TEXT_ONLY_MODELS = [
  "wode/deepseek-v4-pro",
  "wode/glm-5.2",
] as const;

function model(id: string): ModelRef {
  return { providerID: "wodeapp", modelID: id };
}

function shortModelId(modelId: string): string {
  return modelId.replace(/^wode\//, "");
}

function loadAttachment(fixture: (typeof FIXTURES)[number]): ComposerAttachment {
  const path = join(FIXTURE_DIR, fixture.name);
  const bytes = readFileSync(path);
  const file = new File([bytes], fixture.name, { type: fixture.mimeType }) as File & { path?: string };
  // Desktop Electron stamps absolute paths onto File; simulate that for local-tool routing.
  file.path = path;
  return {
    id: `fixture-${fixture.id}`,
    name: fixture.name,
    mimeType: fixture.mimeType,
    kind: fixture.kind,
    file,
    size: file.size,
  };
}

function draft(text: string, attachments: ComposerAttachment[]): ComposerDraft {
  return { mode: "prompt", parts: [], text, attachments };
}

function planSend(modelId: string, nextDraft: ComposerDraft) {
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
  return {
    modelId,
    mediaInput,
    useAttachmentIntelligence,
    includeRaw: raw.includeRawAttachments,
    imagesOnly: raw.imagesOnly,
    gateMs: performance.now() - t0,
  };
}

describe("fixture media routing matrix (real small files)", () => {
  test("fixtures exist and stay tiny", () => {
    for (const fixture of FIXTURES) {
      const size = statSync(join(FIXTURE_DIR, fixture.name)).size;
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThan(20_000);
      console.log(`[fixture] ${fixture.name} ${size} bytes`);
    }
  });

  test("branded models routing for png/pdf/docx/xlsx/mp4/txt", () => {
    const rows: Array<Record<string, unknown>> = [];
    for (const fixture of FIXTURES) {
      const attachment = loadAttachment(fixture);
      const nextDraft = draft(fixture.prompt, [attachment]);
      for (const modelId of MODELS) {
        const plan = planSend(modelId, nextDraft);
        rows.push({
          file: fixture.name,
          model: shortModelId(modelId),
          parse: plan.useAttachmentIntelligence,
          raw: plan.includeRaw,
          imagesOnly: plan.imagesOnly,
          imageNative: plan.mediaInput.image,
          videoNative: plan.mediaInput.video,
          pdfNative: plan.mediaInput.pdf,
          officeNative: plan.mediaInput.office,
          remoteImageUrl: plan.mediaInput.remoteImageUrl,
          gateMs: Number(plan.gateMs.toFixed(3)),
        });
      }
    }
    console.log("[fixture-route-matrix]", JSON.stringify(rows, null, 2));

    const by = (file: string, modelId: string) => {
      const short = shortModelId(modelId);
      return rows.find((row) => row.file === file && row.model === short);
    };

    for (const modelId of VISION_NATIVE_MODELS) {
      expect(by("sample.png", modelId)?.parse).toBe(false);
      expect(by("sample.png", modelId)?.raw).toBe(true);
      // Video stays path/tools/attachment-intelligence even when catalog video is native
      // (never chat-inline data:video). See MODEL_MEDIA_INPUT.md.
      expect(by("sample.mp4", modelId)?.parse).toBe(true);
      expect(by("sample.mp4", modelId)?.videoNative).toBe(true);
      expect(by("sample.mp4", modelId)?.raw).toBe(false);
      // Office is never chat-native in catalog defaults/overrides.
      expect(by("sample.docx", modelId)?.parse).toBe(true);
      expect(by("sample.xlsx", modelId)?.parse).toBe(true);
      expect(by("sample.docx", modelId)?.raw).toBe(false);
    }

    for (const modelId of TEXT_ONLY_MODELS) {
      expect(by("sample.png", modelId)?.parse).toBe(true);
      expect(by("sample.mp4", modelId)?.parse).toBe(true);
      expect(by("sample.png", modelId)?.imageNative).toBe(false);
    }

    // Doubao / Qwen: PDF is chat-native → direct, no attachment-intelligence.
    for (const modelId of PDF_CHAT_NATIVE_MODELS) {
      expect(by("sample.pdf", modelId)?.pdfNative).toBe(true);
      expect(by("sample.pdf", modelId)?.parse).toBe(false);
      expect(by("sample.pdf", modelId)?.raw).toBe(true);
    }

    // MiniMax / Kimi: PDF via file_api → not chat-native → parse/tool path.
    for (const modelId of ["wode/minimax-m3", "wode/kimi-k3"] as const) {
      expect(by("sample.pdf", modelId)?.pdfNative).toBe(false);
      expect(by("sample.pdf", modelId)?.parse).toBe(true);
    }

    // Kimi docs: public HTTPS image URL not accepted.
    expect(by("sample.png", "wode/kimi-k3")?.remoteImageUrl).toBe(false);
    expect(by("sample.png", "wode/doubao-pro")?.remoteImageUrl).toBe(true);
    expect(by("sample.png", "wode/qwen3.8-max")?.remoteImageUrl).toBe(true);
  });

  test("local understandDraftAttachments for txt/docx/xlsx/pdf with real paths (no remote vision)", async () => {
    const localKinds = FIXTURES.filter((item) => item.id !== "png");
    const results: Array<Record<string, unknown>> = [];
    for (const fixture of localKinds) {
      const attachment = loadAttachment(fixture);
      const nextDraft = draft(fixture.prompt, [attachment]);
      const t0 = performance.now();
      const understood = await understandDraftAttachments(nextDraft, false);
      const totalMs = performance.now() - t0;
      results.push({
        file: fixture.name,
        totalMs: Number(totalMs.toFixed(2)),
        contextChars: understood.combinedContext.length,
        hasContext: Boolean(understood.combinedContext),
        sources: understood.sources,
      });
      expect(understood.combinedContext.length).toBeGreaterThan(0);
      // Local path fixtures must not take seconds (that would mean remote side-path).
      expect(totalMs).toBeLessThan(500);
    }
    console.log("[fixture-local-understand]", JSON.stringify(results, null, 2));
  });

  test("vision-native models skip remote understand for image fixture", () => {
    const attachment = loadAttachment(FIXTURES[0]);
    const nextDraft = draft(FIXTURES[0].prompt, [attachment]);
    const summary = VISION_NATIVE_MODELS.map((modelId) => {
      const plan = planSend(modelId, nextDraft);
      expect(plan.useAttachmentIntelligence).toBe(false);
      expect(plan.includeRaw).toBe(true);
      return {
        model: shortModelId(modelId),
        remoteParseWouldRun: plan.useAttachmentIntelligence,
        includeRaw: plan.includeRaw,
        gateMs: Number(plan.gateMs.toFixed(3)),
      };
    });
    console.log("[fixture-image-fast-path]", JSON.stringify({
      file: FIXTURES[0].name,
      bytes: attachment.size,
      models: summary,
      note: "session-route would skip understandDraftAttachments and send file part",
    }));
  });
});
