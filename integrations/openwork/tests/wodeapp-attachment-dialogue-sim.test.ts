/**
 * Multi-turn dialogue simulation for local-first attachment routing.
 *
 * Replays the session-route shape of:
 *   T1 send (materialize/stamp → understand → intelligence part)
 *   idle compact (history stub)
 *   T2/T3 follow-ups that must still be able to reread PDF via contextRefId/path
 *
 * Does not call a live model; asserts the prompt/tool contract the model would see.
 */
import { describe, expect, mock, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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

const remoteCalls: Array<{ filenames: string[]; userPrompt?: string }> = [];

mock.module("@/app/lib/wodeapp-auth", () => ({
  WodeAppRuntimeRequestError: class extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  },
  requestWodeAppAttachmentIntelligence: async (input: {
    files: Array<{ filename?: string }>;
    userPrompt?: string;
  }) => {
    remoteCalls.push({
      filenames: input.files.map((file) => file.filename || ""),
      userPrompt: input.userPrompt,
    });
    // Simulate the historical cloud failure: images OK-ish, PDF text layer dead.
    return {
      success: true,
      data: {
        results: input.files.map((file) => {
          const name = file.filename || "file";
          if (/\.pdf$/i.test(name)) {
            return {
              filename: name,
              kind: "document",
              method: "vision",
              summary: "",
              error: "文档解析失败 / provider 不可用",
            };
          }
          if (/\.(png|jpe?g|webp)$/i.test(name)) {
            return {
              filename: name,
              kind: "image",
              method: "vision",
              summary: "纽莱贵族精油袜礼袋包装图",
            };
          }
          return {
            filename: name,
            kind: "document",
            method: "text-extract",
            summary: "unexpected remote text",
          };
        }),
        combinedContext: [
          "### bag.jpg",
          "纽莱贵族精油袜礼袋包装图",
          "",
          "### product-quote.pdf",
          "解析失败：文档解析失败 / provider 不可用",
        ].join("\n"),
        contextPackId: "7cdb3244ea8263c77e6c86b64421339e",
        cacheHit: false,
      },
    };
  },
}));

mock.module("../src/react-app/domains/wodeapp/wodeapp-attachment-context-store", () => ({
  persistAttachmentContext: async (input: {
    sessionId: string;
    files?: Array<{ filename: string; mime: string; dataUrl: string }>;
  }) => {
    const packDir = join(tmpdir(), "wodeappx-sim-packs", input.sessionId);
    mkdirSync(packDir, { recursive: true });
    const files = (input.files || []).map((file, index) => {
      const path = join(packDir, `${String(index + 1).padStart(2, "0")}-${file.filename}`);
      const base64 = file.dataUrl.split(",")[1] || "";
      writeFileSync(path, Buffer.from(base64, "base64"));
      return {
        filename: file.filename,
        mime: file.mime,
        path,
        sizeBytes: Buffer.from(base64, "base64").length,
      };
    });
    return {
      refId: `ctx_sim_${input.sessionId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`,
      contextChars: 0,
      storedBytes: files.reduce((sum, file) => sum + file.sizeBytes, 0),
      storeBytes: 0,
      maxStoreBytes: 512 * 1024 * 1024,
      files,
    };
  },
}));

const {
  ATTACHMENT_INTELLIGENCE_COMPACT_MIN_CHARS,
  attachmentContextCanBeDehydrated,
  buildAttachmentIntelligenceHistoryStub,
  buildAttachmentIntelligencePart,
  buildAttachmentRequirementsFromDraft,
  stampComposerAttachmentLocalPaths,
  understandDraftAttachments,
  WODEAPP_ATTACHMENT_INTELLIGENCE_COMPACTED_MARKER,
} = await import("../src/react-app/domains/wodeapp/wodeapp-attachment-intelligence");

type ComposerAttachment = {
  id: string;
  name: string;
  mimeType: string;
  kind: "image" | "file";
  file: File;
  size: number;
};

function makeAttachment(input: {
  id: string;
  name: string;
  mimeType: string;
  kind: "image" | "file";
  bytes: Uint8Array;
  path?: string;
}): ComposerAttachment {
  const file = new File([input.bytes], input.name, { type: input.mimeType }) as File & { path?: string };
  if (input.path) {
    Object.defineProperty(file, "path", { configurable: true, value: input.path });
  }
  return {
    id: input.id,
    name: input.name,
    mimeType: input.mimeType,
    kind: input.kind,
    file,
    size: input.bytes.byteLength,
  };
}

function draft(text: string, attachments: ComposerAttachment[]) {
  return {
    mode: "prompt" as const,
    parts: [] as [],
    text,
    attachments,
  };
}

/** Minimal PDF with a text stream (enough for path/routing; not for real pdfjs extract). */
function tinyPdfBytes(label: string): Uint8Array {
  const content = `BT /F1 12 Tf 100 700 Td (${label}) Tj ET`;
  const objects = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n",
    `4 0 obj<< /Length ${content.length} >>stream\n${content}\nendstream\nendobj\n`,
    "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += object;
  }
  const xrefStart = Buffer.byteLength(body, "utf8");
  body += `xref\n0 ${offsets.length}\n`;
  body += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) {
    body += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

describe("multi-turn dialogue simulation: mixed image+txt+pdf", () => {
  test("T1→idle→T2→T3 keeps local PDF reread contract", async () => {
    remoteCalls.length = 0;
    const sessionId = "ses_sim_mixed_0731";
    const packRoot = join(tmpdir(), "wodeappx-sim-packs", sessionId);
    mkdirSync(packRoot, { recursive: true });

    const briefText = [
      "产品名称：摩飞四代多功能锅",
      "卖点：煎烤蒸煮一体，适合家庭聚餐",
      "目标：输出种草短视频脚本",
    ].join("\n");
    const image = makeAttachment({
      id: "img",
      name: "bag.jpg",
      mimeType: "image/jpeg",
      kind: "image",
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9, 0x00, 0x01]),
    });
    const brief = makeAttachment({
      id: "txt",
      name: "product-brief.txt",
      mimeType: "text/plain",
      kind: "file",
      bytes: new TextEncoder().encode(briefText),
    });
    const pdf = makeAttachment({
      id: "pdf",
      name: "product-quote.pdf",
      mimeType: "application/pdf",
      kind: "file",
      bytes: tinyPdfBytes("WodeApp quote PDF"),
    });

    // --- Turn 1: user uploads mixed attachments and asks for understanding ---
    const turn1Draft = draft("根据这三个附件分别说清楚图、brief、报价单各自是什么", [
      image,
      brief,
      pdf,
    ]);

    // session-route: materialize → stamp durable paths (mock pack)
    const stampedPaths = new Map<string, string>([
      ["bag.jpg", join(packRoot, "01-bag.jpg")],
      ["product-brief.txt", join(packRoot, "02-product-brief.txt")],
      ["product-quote.pdf", join(packRoot, "03-product-quote.pdf")],
    ]);
    for (const [filename, path] of stampedPaths) {
      const bytes = filename.endsWith(".pdf")
        ? tinyPdfBytes("WodeApp quote PDF")
        : filename.endsWith(".txt")
        ? new TextEncoder().encode(briefText)
        : new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
      writeFileSync(path, bytes);
    }
    stampComposerAttachmentLocalPaths(turn1Draft.attachments, stampedPaths);

    const requirementsT1 = buildAttachmentRequirementsFromDraft(turn1Draft as never);
    expect(requirementsT1.localRead).toBe(true);
    expect(requirementsT1.localDocuments?.map((doc) => doc.filename).sort()).toEqual([
      "product-brief.txt",
      "product-quote.pdf",
    ]);
    expect(requirementsT1.requiredTools).toContain("openwork_pdf_extract_text");

    const understood = await understandDraftAttachments(turn1Draft as never, true, {
      sessionId,
    });

    // Documents must stay local; only the image (if any) may hit remote.
    const remotePdf = remoteCalls.some((call) =>
      call.filenames.some((name) => /\.pdf$/i.test(name)),
    );
    const remoteTxt = remoteCalls.some((call) =>
      call.filenames.some((name) => /\.txt$/i.test(name)),
    );
    expect(remotePdf).toBe(false);
    expect(remoteTxt).toBe(false);

    expect(understood.combinedContext).toContain("摩飞四代多功能锅");
    expect(understood.combinedContext).toContain("以下附件保留在本机");
    expect(understood.combinedContext).toContain("product-quote.pdf");
    expect(understood.combinedContext).toContain(stampedPaths.get("product-quote.pdf")!);
    expect(understood.combinedContext).toContain("openwork_pdf_extract_text");

    const contextRefId = understood.contextRefId || `ctx_sim_${sessionId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 24)}`;
    const turn1Part = buildAttachmentIntelligencePart(
      understood.combinedContext,
      understood.sources,
      understood.uploadedUrls,
      {
        contextPackId: understood.contextPackId || "7cdb3244ea8263c77e6c86b64421339e",
        contextRefId,
      },
    );

    // Assistant would be instructed to call PDF tools — never "already understood, don't use local tools".
    expect(turn1Part.text).toContain("openwork_pdf_extract_text");
    expect(turn1Part.text).toContain(`contextRefId=${contextRefId}`);
    expect(turn1Part.text).not.toContain("不要再调用 openwork_file_search");

    // Simulate model finishing PDF tool read before idle.
    const afterToolRead = turn1Part.text
      .replace("以下附件保留在本机，尚未读取", "以下附件已在本机读取完毕")
      .replace(
        "附件理解结果：",
        [
          "附件理解结果：",
          `path: ${stampedPaths.get("product-quote.pdf")}`,
          "PDF 文本提取成功：WodeApp 报价单 / 套餐明细",
          "填充：".padEnd(ATTACHMENT_INTELLIGENCE_COMPACT_MIN_CHARS, "报价行。"),
        ].join("\n"),
      );

    // --- Idle compaction (history stub) ---
    expect(attachmentContextCanBeDehydrated(afterToolRead)).toBe(true);
    const stub = buildAttachmentIntelligenceHistoryStub(afterToolRead);
    expect(stub).toBeTruthy();
    expect(stub!).toContain(WODEAPP_ATTACHMENT_INTELLIGENCE_COMPACTED_MARKER);
    expect(stub!).toContain(`contextRefId=${contextRefId}`);
    expect(stub!).toContain(stampedPaths.get("product-quote.pdf")!);
    expect(stub!).toMatch(/openwork_attachment_context_read|openwork_pdf_extract_text/);
    // Full brief/prose should be gone from stub; only pointers remain.
    expect(stub!).not.toContain("卖点：煎烤蒸煮一体");

    // --- Turn 2: "报价 PDF 里有什么" — model only sees stub + user text ---
    const turn2History = [
      { role: "user", text: turn1Draft.text },
      { role: "system-hidden", text: stub! },
      { role: "user", text: "报价 PDF 里有什么？不要让我重新上传" },
    ];
    expect(turn2History[1]?.text).toContain("contextRefId=");
    expect(turn2History[1]?.text).toContain("可重读本地路径");
    expect(turn2History[1]?.text).not.toContain("不要再调用 openwork_file_search");

    // --- Turn 3: ask about brief product name after compression ---
    const turn3History = [
      ...turn2History,
      { role: "assistant", text: "（模拟）按 stub 的 path 调用 openwork_pdf_extract_text 后回答报价内容" },
      { role: "user", text: "brief 里的产品名是什么？是袜子还是锅？" },
    ];
    // Brief was inlined in T1 combinedContext; after stub it is gone from history.
    // Correct agent behavior: either remember prior answer, or reread txt path from stub if present.
    const stubHasBriefPath = stub!.includes("product-brief.txt");
    if (stubHasBriefPath) {
      expect(stub!).toContain(stampedPaths.get("product-brief.txt")!);
    } else {
      // Even if txt path is omitted from stub, PDF/contextRef must remain recoverable.
      expect(stub!).toContain(`contextRefId=${contextRefId}`);
    }

    // Second idle must not destroy the stub.
    expect(buildAttachmentIntelligenceHistoryStub(stub!)).toBeNull();

    // Dialogue transcript for human review in test output.
    console.info("[DialogueSim]", JSON.stringify({
      turn1: {
        user: turn1Draft.text,
        localDocuments: requirementsT1.localDocuments?.map((doc) => doc.filename),
        remoteFilenames: remoteCalls.flatMap((call) => call.filenames),
        sawMorfeiBrief: understood.combinedContext.includes("摩飞四代多功能锅"),
        contextRefId,
        forbidsLocalTools: turn1Part.text.includes("不要再调用 openwork_file_search"),
      },
      afterIdle: {
        hasStub: Boolean(stub),
        contextRefIdKept: stub!.includes(`contextRefId=${contextRefId}`),
        pdfPathKept: stub!.includes(stampedPaths.get("product-quote.pdf")!),
      },
      turn2: { user: turn2History[2]?.text, canRereadFromStub: true },
      turn3: { user: turn3History[4]?.text, stubHasBriefPath },
    }, null, 2));
  });

  test("T1 without stamp still materializes pathless PDF into local tool refs via understand()", async () => {
    remoteCalls.length = 0;
    const brief = makeAttachment({
      id: "txt2",
      name: "product-brief.txt",
      mimeType: "text/plain",
      kind: "file",
      bytes: new TextEncoder().encode("产品名称：摩飞四代多功能锅\n"),
    });
    const pdf = makeAttachment({
      id: "pdf2",
      name: "product-quote.pdf",
      mimeType: "application/pdf",
      kind: "file",
      bytes: tinyPdfBytes("quote"),
      // intentionally no File.path — regresses the original bug
    });
    const image = makeAttachment({
      id: "img2",
      name: "bag.jpg",
      mimeType: "image/jpeg",
      kind: "image",
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    });

    const result = await understandDraftAttachments(
      draft("看附件", [image, brief, pdf]) as never,
      true,
      { sessionId: "ses_sim_pathless" },
    );

    expect(remoteCalls.some((call) => call.filenames.some((name) => /\.pdf$/i.test(name)))).toBe(false);
    expect(result.combinedContext).toContain("摩飞四代多功能锅");
    expect(result.combinedContext).toContain("openwork_pdf_extract_text");
    expect(result.combinedContext).toMatch(/path:\s+\//);
    expect(result.contextRefId || "").toMatch(/^ctx_/);
  });
});
