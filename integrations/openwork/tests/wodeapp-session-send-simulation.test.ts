/**
 * Session-route send simulation.
 * Mirrors the real composer → gate → (optional) attachment intelligence → prompt parts
 * sequence used by session-route.tsx, with a mocked remote understand API so we can
 * prove vision models never hit it and text-only models do.
 */
import { describe, expect, mock, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Bun has no DOM FileReader; attachment intelligence uses it to prepare image uploads.
if (typeof globalThis.FileReader === "undefined") {
  // @ts-expect-error test polyfill
  globalThis.FileReader = class FileReaderPolyfill {
    result: string | null = null;
    onload: ((event: { target: FileReaderPolyfill }) => void) | null = null;
    onerror: ((error: unknown) => void) | null = null;
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then((buffer) => {
        const mime = blob.type || "application/octet-stream";
        this.result = `data:${mime};base64,${Buffer.from(buffer).toString("base64")}`;
        this.onload?.({ target: this });
      }).catch((error) => {
        this.onerror?.(error);
      });
    }
  };
}

type RemoteCall = {
  fileCount: number;
  userPrompt?: string;
  atMs: number;
};

const remoteCalls: RemoteCall[] = [];
let remoteLatencyMs = 25;

class FakeRuntimeRequestError extends Error {
  readonly status: number;
  readonly bodySnippet: string;
  constructor(message: string, status = 500, bodySnippet = "") {
    super(message);
    this.name = "WodeAppRuntimeRequestError";
    this.status = status;
    this.bodySnippet = bodySnippet;
  }
}

mock.module("@/app/lib/wodeapp-auth", () => ({
  WodeAppRuntimeRequestError: FakeRuntimeRequestError,
  getWodeAppApiCredentials: async () => ({
    apiKey: "sk_test_session_sim",
    origin: "https://example.wodeapp.cn",
  }),
  requestWodeAppAttachmentIntelligence: async (input: {
    files: Array<{ filename?: string }>;
    userPrompt?: string;
  }) => {
    const started = performance.now();
    await Bun.sleep(remoteLatencyMs);
    remoteCalls.push({
      fileCount: input.files.length,
      userPrompt: input.userPrompt,
      atMs: performance.now() - started,
    });
    return {
      success: true,
      data: {
        results: input.files.map((file, index) => ({
          filename: file.filename || `file-${index}`,
          summary: `mocked remote parse for ${file.filename || index}`,
        })),
        combinedContext: `MOCK_REMOTE_CONTEXT\nfiles=${input.files.length}`,
        cacheHit: false,
      },
    };
  },
}));

const { default: catalog } = await import("../wodeapp/wode-branded-catalog.json");
const {
  shouldIncludeAssetMentionFilesInPrompt,
  shouldIncludeRawAttachmentsInPrompt,
  shouldPreserveAttachmentsAsDisplayOnly,
  shouldUseAttachmentIntelligence,
  understandDraftAttachments,
  isComposerImageAttachment,
  buildAttachmentDisplayParts,
} = await import("../wodeapp/wodeapp-attachment-intelligence");
const { resolveModelMediaInputCapabilities } = await import(
  "../wodeapp/wodeapp-model-media-input"
);
const {
  attachmentToModelFileData,
  canInlineAttachmentAsModelDataUrl,
  modelFacingAttachmentMime,
} = await import("../attachment-data-url");

import type { ComposerAttachment, ComposerDraft, ModelRef } from "../src/app/types";

async function fileToDataUrlPart(attachment: ComposerAttachment) {
  const mime = attachment.mimeType || "application/octet-stream";
  if (!canInlineAttachmentAsModelDataUrl(mime)) {
    throw new Error(`simulateSessionSend refused data URL for ${attachment.name} (${mime})`);
  }
  const modelFile = await attachmentToModelFileData(attachment.file, mime);
  return {
    type: "file" as const,
    filename: modelFile.filename,
    mime: modelFile.mime,
    chars: modelFile.url.length,
    urlChars: modelFile.url.length,
    urlPrefix: modelFile.url.slice(0, 32),
  };
}

function localAttachmentFileUrl(file: File): string | null {
  const path = (file as File & { path?: string }).path?.trim();
  if (!path) return null;
  if (/^file:\/\//i.test(path)) return path;
  if (/^https?:\/\//i.test(path)) return path;
  return `file://${path}`;
}
const FIXTURE_DIR = join(import.meta.dir, "fixtures/media-routing");

const FIXTURES = [
  { id: "png", name: "sample.png", mimeType: "image/png", kind: "image" as const, prompt: "这张图主色是什么？" },
  { id: "pdf", name: "sample.pdf", mimeType: "application/pdf", kind: "file" as const, prompt: "总结这份 PDF" },
  { id: "docx", name: "sample.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "file" as const, prompt: "总结这份 Word" },
  { id: "xlsx", name: "sample.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "file" as const, prompt: "看看这个 Excel" },
  { id: "mp4", name: "sample.mp4", mimeType: "video/mp4", kind: "file" as const, prompt: "看看这段视频" },
  { id: "txt", name: "sample.txt", mimeType: "text/plain", kind: "file" as const, prompt: "总结这份文本" },
] as const;

const MODELS = [
  "wode/minimax-m3",
  "wode/kimi-k3",
  "wode/doubao-pro",
  "wode/qwen3.8-max",
  "wode/deepseek-v4-pro",
] as const;

function model(id: string): ModelRef {
  return { providerID: "wodeapp", modelID: id };
}

function loadAttachment(fixture: (typeof FIXTURES)[number]): ComposerAttachment {
  const path = join(FIXTURE_DIR, fixture.name);
  const bytes = readFileSync(path);
  const file = new File([bytes], fixture.name, { type: fixture.mimeType }) as File & { path?: string };
  file.path = path;
  return {
    id: `session-sim-${fixture.id}`,
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

/** Same decision order as session-route.tsx onSendDraft (attachment branch). */
async function simulateSessionSend(modelId: string, nextDraft: ComposerDraft) {
  remoteCalls.length = 0;
  const startedAt = performance.now();
  const mediaInput = resolveModelMediaInputCapabilities(model(modelId), null);
  const modelSupportsVision = mediaInput.image;
  const useAttachmentIntelligence = shouldUseAttachmentIntelligence({
    enabled: true,
    draft: nextDraft,
    modelSupportsVision,
    mediaInput,
  });
  const preserveAttachmentsAsDisplayOnly = shouldPreserveAttachmentsAsDisplayOnly({
    enabled: true,
    draft: nextDraft,
    modelSupportsVision,
    mediaInput,
  });
  const rawAttachmentPlan = shouldIncludeRawAttachmentsInPrompt({
    modelSupportsVision,
    useAttachmentIntelligence,
    preserveAttachmentsAsDisplayOnly,
    draft: nextDraft,
    mediaInput,
  });
  const includeAssetMentionFiles = shouldIncludeAssetMentionFilesInPrompt({
    draft: nextDraft,
    modelSupportsVision,
    useAttachmentIntelligence,
    mediaInput,
  });

  let attachmentIntelligence: Awaited<ReturnType<typeof understandDraftAttachments>> | null = null;
  let understandMs = 0;
  if (useAttachmentIntelligence) {
    const t0 = performance.now();
    attachmentIntelligence = await understandDraftAttachments(nextDraft, modelSupportsVision);
    understandMs = performance.now() - t0;
  }

  const promptParts: Array<{ type: string; filename?: string; mime?: string; chars?: number }> = [];
  const promptText = (nextDraft.resolvedText ?? nextDraft.text).trim();
  if (promptText) promptParts.push({ type: "text", chars: promptText.length });
  if (attachmentIntelligence?.combinedContext) {
    promptParts.push({ type: "attachment-context", chars: attachmentIntelligence.combinedContext.length });
  }

  if (rawAttachmentPlan.includeRawAttachments) {
    const attachments = nextDraft.attachments.filter((attachment) =>
      !rawAttachmentPlan.imagesOnly || isComposerImageAttachment(attachment),
    );
    for (const attachment of attachments) {
      const mime = attachment.mimeType || "application/octet-stream";
      if (isComposerImageAttachment(attachment) || mime.startsWith("image/")) {
        promptParts.push(await fileToDataUrlPart(attachment));
        continue;
      }
      // Mirror session-route draftToParts: non-images are path-only, never data:.
      // Provider-safe mime only (#3079): json/xml → text/plain; zip/binary → skip.
      const modelMime = modelFacingAttachmentMime(mime);
      if (!modelMime) continue;
      const localUrl = localAttachmentFileUrl(attachment.file);
      if (!localUrl) continue;
      promptParts.push({
        type: "file",
        filename: attachment.name,
        mime: modelMime,
        chars: localUrl.length,
        urlPrefix: localUrl.slice(0, 32),
      });
    }
  }

  if (preserveAttachmentsAsDisplayOnly) {
    for (const part of buildAttachmentDisplayParts(nextDraft.attachments)) {
      promptParts.push({
        type: "display-placeholder",
        filename: nextDraft.attachments[0]?.name,
        chars: typeof part.text === "string" ? part.text.length : 0,
      });
    }
  }

  const hasDataVideoPart = promptParts.some((part) =>
    typeof (part as { urlPrefix?: string }).urlPrefix === "string"
    && String((part as { urlPrefix?: string }).urlPrefix).startsWith("data:video/"),
  );

  return {
    modelId,
    useAttachmentIntelligence,
    preserveDisplayOnly: preserveAttachmentsAsDisplayOnly,
    remoteParseCalls: remoteCalls.length,
    remoteParseMs: remoteCalls.reduce((sum, call) => sum + call.atMs, 0),
    understandMs: Number(understandMs.toFixed(2)),
    includeRaw: rawAttachmentPlan.includeRawAttachments,
    imagesOnly: rawAttachmentPlan.imagesOnly,
    includeAssetMentionFiles,
    contextChars: attachmentIntelligence?.combinedContext.length ?? 0,
    promptParts,
    hasDataVideoPart,
    totalMs: Number((performance.now() - startedAt).toFixed(2)),
    media: {
      image: mediaInput.image,
      video: mediaInput.video,
      pdf: mediaInput.pdf,
      office: mediaInput.office,
    },
  };
}

describe("session-route send simulation", () => {
  test("catalog still lists branded models used in simulation", () => {
    const ids = new Set((catalog as Array<{ apiId: string }>).map((entry) => entry.apiId));
    for (const modelId of MODELS) expect(ids.has(modelId)).toBe(true);
    for (const fixture of FIXTURES) {
      expect(statSync(join(FIXTURE_DIR, fixture.name)).size).toBeGreaterThan(0);
    }
  });

  test("simulate send for each model × media fixture and assert remote parse behavior", async () => {
    remoteLatencyMs = 40;
    const rows: Array<Record<string, unknown>> = [];

    for (const fixture of FIXTURES) {
      const attachment = loadAttachment(fixture);
      const nextDraft = draft(fixture.prompt, [attachment]);
      for (const modelId of MODELS) {
        const result = await simulateSessionSend(modelId, nextDraft);
        rows.push({
          file: fixture.name,
          model: modelId.replace("wode/", ""),
          parseGate: result.useAttachmentIntelligence,
          remoteCalls: result.remoteParseCalls,
          raw: result.includeRaw,
          understandMs: result.understandMs,
          remoteParseMs: Number(result.remoteParseMs.toFixed(2)),
          totalMs: result.totalMs,
          parts: result.promptParts.map((part) => part.type).join("+"),
        });

        if (fixture.id === "png") {
          if (modelId === "wode/deepseek-v4-pro") {
            expect(result.useAttachmentIntelligence).toBe(true);
            expect(result.remoteParseCalls).toBeGreaterThan(0);
            expect(result.remoteParseMs).toBeGreaterThanOrEqual(remoteLatencyMs - 5);
          } else {
            expect(result.useAttachmentIntelligence).toBe(false);
            expect(result.remoteParseCalls).toBe(0);
            expect(result.includeRaw).toBe(true);
          }
        }

        // Codex-style: video never becomes session data: / raw vision file parts,
        // even when catalog video capability is native (MiniMax etc.).
        if (fixture.id === "mp4") {
          expect(result.useAttachmentIntelligence).toBe(true);
          expect(result.includeRaw).toBe(false);
          expect(result.preserveDisplayOnly).toBe(true);
          expect(result.hasDataVideoPart).toBe(false);
          expect(result.remoteParseCalls).toBe(0);
          expect(result.contextChars).toBeGreaterThan(0);
          expect(result.promptParts.some((part) => part.type === "display-placeholder")).toBe(true);
          expect(
            result.promptParts.some((part) =>
              typeof (part as { urlPrefix?: string }).urlPrefix === "string"
              && String((part as { urlPrefix?: string }).urlPrefix).startsWith("data:"),
            ),
          ).toBe(false);
        }

        if (fixture.id === "docx" || fixture.id === "xlsx") {
          expect(result.useAttachmentIntelligence).toBe(true);
          // Local path Office stays on local-tool path → no remote call.
          expect(result.remoteParseCalls).toBe(0);
          expect(result.contextChars).toBeGreaterThan(0);
        }

        if (fixture.id === "pdf") {
          if (modelId === "wode/doubao-pro" || modelId === "wode/qwen3.8-max") {
            expect(result.useAttachmentIntelligence).toBe(false);
            expect(result.remoteParseCalls).toBe(0);
            expect(result.includeRaw).toBe(true);
          } else if (modelId === "wode/minimax-m3" || modelId === "wode/kimi-k3") {
            expect(result.useAttachmentIntelligence).toBe(true);
            expect(result.remoteParseCalls).toBe(0); // local PDF tool path with file.path
          }
        }
      }
    }

    console.log("[session-sim-matrix]", JSON.stringify(rows, null, 2));

    const pngMiniMax = rows.find((row) => row.file === "sample.png" && row.model === "minimax-m3");
    const pngDeepSeek = rows.find((row) => row.file === "sample.png" && row.model === "deepseek-v4-pro");
    expect(pngMiniMax?.remoteCalls).toBe(0);
    expect(Number(pngMiniMax?.totalMs)).toBeLessThan(Number(pngDeepSeek?.totalMs));
    console.log("[session-sim-speed]", JSON.stringify({
      minimaxPngTotalMs: pngMiniMax?.totalMs,
      deepseekPngTotalMs: pngDeepSeek?.totalMs,
      deepseekRemoteMs: pngDeepSeek?.remoteParseMs,
      note: "DeepSeek pays mocked remote latency; MiniMax skips remote entirely",
    }));
  });

  test("Doubao/Qwen/Kimi image send never touches remote understand", async () => {
    remoteLatencyMs = 80;
    const attachment = loadAttachment(FIXTURES[0]);
    const nextDraft = draft(FIXTURES[0].prompt, [attachment]);
    for (const modelId of ["wode/doubao-pro", "wode/qwen3.8-max", "wode/kimi-k3"] as const) {
      const result = await simulateSessionSend(modelId, nextDraft);
      expect(result.remoteParseCalls).toBe(0);
      expect(result.useAttachmentIntelligence).toBe(false);
      expect(result.promptParts.some((part) => part.type === "file")).toBe(true);
      console.log("[session-sim-vision-direct]", JSON.stringify({
        model: modelId.replace("wode/", ""),
        totalMs: result.totalMs,
        remoteCalls: result.remoteParseCalls,
        parts: result.promptParts,
      }));
    }
  });

  test("large meeting video without File.path never becomes data:video base64", async () => {
    const huge = new Uint8Array(2 * 1024 * 1024);
    huge.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70], 0);
    const file = new File([huge], "meeting-54min.mp4", { type: "video/mp4" });
    // Intentionally no file.path — this is the path that previously poisoned sessions.
    const attachment: ComposerAttachment = {
      id: "sim-huge-video",
      name: "meeting-54min.mp4",
      mimeType: "video/mp4",
      kind: "file",
      file,
      size: file.size,
    };
    const nextDraft = draft("解析这个会议视频并做总结", [attachment]);

    await expect(attachmentToModelFileData(file, "video/mp4")).rejects.toThrow(/non-image/i);

    const result = await simulateSessionSend("wode/minimax-m3", nextDraft);
    expect(result.media.video).toBe(true);
    expect(result.useAttachmentIntelligence).toBe(true);
    expect(result.includeRaw).toBe(false);
    expect(result.preserveDisplayOnly).toBe(true);
    expect(result.hasDataVideoPart).toBe(false);
    expect(result.remoteParseCalls).toBe(0);
    expect(result.contextChars).toBeGreaterThan(0);
    expect(result.promptParts.every((part) => part.type !== "file" || !(part as { urlPrefix?: string }).urlPrefix?.startsWith("data:"))).toBe(true);

    console.log("[session-sim-huge-video]", JSON.stringify({
      sizeMb: Number((file.size / 1024 / 1024).toFixed(2)),
      useAttachmentIntelligence: result.useAttachmentIntelligence,
      includeRaw: result.includeRaw,
      preserveDisplayOnly: result.preserveDisplayOnly,
      hasDataVideoPart: result.hasDataVideoPart,
      parts: result.promptParts.map((part) => part.type),
      totalMs: result.totalMs,
    }));
  });

  test("3MB hash-named mp4 with File.path never hits remote understand", async () => {
    const bytes = new Uint8Array(3 * 1024 * 1024);
    bytes.set([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70], 0);
    const file = new File([bytes], "5470b2e3825c9ed6bd2f2bded446c3b4.mp4", {
      type: "video/mp4",
    }) as File & { path?: string };
    file.path = "/tmp/5470b2e3825c9ed6bd2f2bded446c3b4.mp4";
    const nextDraft = draft("可以让 blender 实现这种效果吗，可以那个公开模型试试", [{
      id: "sim-3mb-mp4",
      name: "5470b2e3825c9ed6bd2f2bded446c3b4.mp4",
      mimeType: "video/mp4",
      kind: "file",
      file,
      size: file.size,
    }]);

    const result = await simulateSessionSend("wode/kimi-k3", nextDraft);
    expect(result.useAttachmentIntelligence).toBe(true);
    expect(result.remoteParseCalls).toBe(0);
    expect(result.hasDataVideoPart).toBe(false);
    expect(result.contextChars).toBeGreaterThan(0);
    expect(result.includeRaw).toBe(false);

    console.log("[session-sim-3mb-mp4]", JSON.stringify({
      sizeMb: Number((file.size / 1024 / 1024).toFixed(2)),
      remoteParseCalls: result.remoteParseCalls,
      contextChars: result.contextChars,
      parts: result.promptParts.map((part) => part.type),
    }));
  });

  test("xml/json attachments remap to text/plain and zip never becomes a model file part", async () => {
    const xmlFile = new File([`<root><sku>A</sku></root>`], "spec.xml", { type: "text/xml" });
    Object.defineProperty(xmlFile, "path", { value: "/tmp/spec.xml" });
    const jsonFile = new File([`{"sku":"A"}`], "spec.json", { type: "application/json" });
    Object.defineProperty(jsonFile, "path", { value: "/tmp/spec.json" });
    const zipFile = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04])], "bundle.zip", {
      type: "application/zip",
    });
    Object.defineProperty(zipFile, "path", { value: "/tmp/bundle.zip" });

    const xmlDraft = draft("根据这个 XML 总结规格", [{
      id: "sim-xml",
      name: "spec.xml",
      mimeType: "text/xml",
      kind: "file",
      file: xmlFile,
      size: xmlFile.size,
    }]);
    const jsonDraft = draft("根据这个 JSON 总结规格", [{
      id: "sim-json",
      name: "spec.json",
      mimeType: "application/json",
      kind: "file",
      file: jsonFile,
      size: jsonFile.size,
    }]);
    const zipDraft = draft("这个压缩包里有什么", [{
      id: "sim-zip",
      name: "bundle.zip",
      mimeType: "application/zip",
      kind: "file",
      file: zipFile,
      size: zipFile.size,
    }]);

    const xmlResult = await simulateSessionSend("wode/minimax-m3", xmlDraft);
    const jsonResult = await simulateSessionSend("wode/minimax-m3", jsonDraft);
    const zipResult = await simulateSessionSend("wode/minimax-m3", zipDraft);

    const xmlFilePart = xmlResult.promptParts.find((part) => part.type === "file");
    const jsonFilePart = jsonResult.promptParts.find((part) => part.type === "file");
    expect(xmlFilePart?.mime).toBe("text/plain");
    expect(jsonFilePart?.mime).toBe("text/plain");
    expect(zipResult.promptParts.some((part) => part.type === "file")).toBe(false);
    expect(modelFacingAttachmentMime("text/xml")).toBe("text/plain");
    expect(modelFacingAttachmentMime("application/zip")).toBeNull();

    console.log("[session-sim-provider-safe-mime]", JSON.stringify({
      xmlMime: xmlFilePart?.mime,
      jsonMime: jsonFilePart?.mime,
      zipHasFilePart: zipResult.promptParts.some((part) => part.type === "file"),
      xmlParts: xmlResult.promptParts.map((part) => part.type),
      zipParts: zipResult.promptParts.map((part) => part.type),
    }));
  });
});
