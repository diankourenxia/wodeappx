import { describe, expect, test } from "bun:test";

import {
  ATTACHMENT_INTELLIGENCE_COMPACT_MIN_CHARS,
  attachmentContextCanBeDehydrated,
  buildAttachmentIntelligenceHistoryStub,
  buildAttachmentIntelligencePart,
  buildAttachmentRequirementsFromDraft,
  stampComposerAttachmentLocalPaths,
  WODEAPP_ATTACHMENT_INTELLIGENCE_COMPACTED_MARKER,
} from "../src/react-app/domains/wodeapp/wodeapp-attachment-intelligence";

type ComposerAttachment = {
  id: string;
  name: string;
  mimeType: string;
  kind: "image" | "file" | "video" | "audio";
  file: File;
  size: number;
};

type ComposerDraft = {
  mode: "prompt";
  parts: [];
  text: string;
  attachments: ComposerAttachment[];
};

function attachment(input: {
  id: string;
  name: string;
  mimeType: string;
  kind: ComposerAttachment["kind"];
}): ComposerAttachment {
  const file = new File([new Uint8Array([0, 0, 0, 24])], input.name, { type: input.mimeType });
  return {
    ...input,
    file,
    size: file.size,
  };
}

function draft(text: string, attachments: ComposerAttachment[]): ComposerDraft {
  return {
    mode: "prompt",
    parts: [],
    text,
    attachments,
  };
}

describe("WodeAppX local-first attachment routing", () => {
  test("stamps durable absolute paths onto composer File blobs", () => {
    const pdf = attachment({
      id: "stamp-pdf",
      name: "quote.pdf",
      mimeType: "application/pdf",
      kind: "file",
    });
    const stamped = stampComposerAttachmentLocalPaths([pdf], {
      "quote.pdf": "/Users/test/.wodeappx/attachment-context-packs/ctx_abc/01-quote.pdf",
    });
    expect(stamped).toBe(1);
    expect((pdf.file as File & { path?: string }).path).toBe(
      "/Users/test/.wodeappx/attachment-context-packs/ctx_abc/01-quote.pdf",
    );
  });

  test("stamps duplicate Unicode filenames by attachment id without collisions", () => {
    const first = attachment({
      id: "quote-first",
      name: "报价单.pdf",
      mimeType: "application/pdf",
      kind: "file",
    });
    const second = attachment({
      id: "quote-second",
      name: "报价单.pdf",
      mimeType: "application/pdf",
      kind: "file",
    });

    const stamped = stampComposerAttachmentLocalPaths(
      [first, second],
      { "报价单.pdf": "/tmp/filename-fallback.pdf" },
      {
        "quote-first": "/tmp/01--.pdf",
        "quote-second": "/tmp/02--.pdf",
      },
    );

    expect(stamped).toBe(2);
    expect((first.file as File & { path?: string }).path).toBe("/tmp/01--.pdf");
    expect((second.file as File & { path?: string }).path).toBe("/tmp/02--.pdf");
  });

  test("mixed image+txt+pdf with local paths keeps documents on local tool route", () => {
    const image = attachment({
      id: "mix-img",
      name: "bag.jpg",
      mimeType: "image/jpeg",
      kind: "image",
    });
    const text = attachment({
      id: "mix-txt",
      name: "product-brief.txt",
      mimeType: "text/plain",
      kind: "file",
    });
    const pdf = attachment({
      id: "mix-pdf",
      name: "product-quote.pdf",
      mimeType: "application/pdf",
      kind: "file",
    });
    Object.defineProperty(text.file, "path", {
      configurable: true,
      value: "/tmp/product-brief.txt",
    });
    Object.defineProperty(pdf.file, "path", {
      configurable: true,
      value: "/tmp/product-quote.pdf",
    });

    const requirements = buildAttachmentRequirementsFromDraft(
      draft("根据附件做商品脚本", [image, text, pdf]) as never,
    );
    expect(requirements.localRead).toBe(true);
    expect(requirements.localDocuments?.map((doc) => doc.filename).sort()).toEqual([
      "product-brief.txt",
      "product-quote.pdf",
    ]);
    expect(requirements.requiredTools).toContain("openwork_pdf_extract_text");
    expect(requirements.requiredTools).toContain("openwork_file_extract_text");
  });

  test("remote PDF parse failure with contextRefId must not forbid local PDF tools", () => {
    const part = buildAttachmentIntelligencePart(
      [
        "### product-quote.pdf",
        "解析失败：文档解析失败 / provider 不可用",
      ].join("\n"),
      [{ label: "对话上传", filename: "product-quote.pdf" }],
      [],
      { contextRefId: "ctx_abcdefghijklmnop" },
    );
    expect(part.text).toContain("openwork_pdf_extract_text");
    expect(part.text).toContain("contextRefId=ctx_abcdefghijklmnop");
    expect(part.text).not.toContain("不要再调用 openwork_file_search");
  });

  test("remote PDF parse failure without a local handle asks for re-upload", () => {
    const part = buildAttachmentIntelligencePart(
      [
        "### 报价单.pdf",
        "解析失败：provider 不可用",
      ].join("\n"),
      [{ label: "对话上传", filename: "报价单.pdf" }],
      [],
    );

    expect(part.text).toContain("没有可重读本地句柄");
    expect(part.text).toContain("重新上传");
    expect(part.text).not.toContain("PDF 工具已直接可用");
  });

  test("multi-turn: unread local PDF must not dehydrate before tools run", () => {
    const unread = buildAttachmentIntelligencePart(
      [
        "以下附件保留在本机，尚未读取。",
        "path: /Users/test/.wodeappx/attachment-context-packs/ctx_unread1/01-quote.pdf",
        "PDF 固定流程：直接调用 openwork_pdf_info，然后调用 openwork_pdf_extract_text。",
        "细节：".padEnd(ATTACHMENT_INTELLIGENCE_COMPACT_MIN_CHARS, "报价明细。"),
      ].join("\n"),
      [{ label: "本地文件工具", filename: "quote.pdf" }],
      [],
      { contextRefId: "ctx_unreadpdf123456" },
    );
    expect(attachmentContextCanBeDehydrated(unread.text)).toBe(false);
    expect(buildAttachmentIntelligenceHistoryStub(unread.text)).toBeNull();
  });

  test("multi-turn: after local PDF is marked read, idle stub keeps contextRefId and path", () => {
    const localPath = "/Users/test/.wodeappx/attachment-context-packs/ctx_readpdf1/01-quote.pdf";
    const readPart = buildAttachmentIntelligencePart(
      [
        "附件理解结果：",
        `path: ${localPath}`,
        "PDF 已读取完毕。",
        "报价正文：".padEnd(ATTACHMENT_INTELLIGENCE_COMPACT_MIN_CHARS, "摩飞锅配件明细。"),
      ].join("\n"),
      [{ label: "本地文件工具", filename: "quote.pdf" }],
      [],
      {
        contextPackId: "7cdb3244ea8263c77e6c86b64421339e",
        contextRefId: "ctx_readpdfabcdef12",
      },
    );

    expect(attachmentContextCanBeDehydrated(readPart.text)).toBe(true);
    const stub = buildAttachmentIntelligenceHistoryStub(readPart.text);
    expect(stub).toBeTruthy();
    expect(stub!).toContain(WODEAPP_ATTACHMENT_INTELLIGENCE_COMPACTED_MARKER);
    expect(stub!).toContain("contextRefId=ctx_readpdfabcdef12");
    expect(stub!).toContain(localPath);
    expect(stub!).toContain("openwork_attachment_context_read");
    expect(stub!).toContain("attachmentFingerprint=7cdb3244ea8263c77e6c86b64421339e");
    expect(stub!).not.toContain("摩飞锅配件明细。摩飞锅配件明细。");
    // Second idle must not wipe the stub again.
    expect(buildAttachmentIntelligenceHistoryStub(stub!)).toBeNull();
  });

  test("multi-turn: remote PDF failure stub still points at contextRefId for reread", () => {
    const failed = buildAttachmentIntelligencePart(
      [
        "附件理解结果：",
        "### product-quote.pdf",
        "解析失败：文档解析失败 / provider 不可用",
        "path: /tmp/durable/01-product-quote.pdf",
        "细节：".padEnd(ATTACHMENT_INTELLIGENCE_COMPACT_MIN_CHARS, "失败上下文填充。"),
      ].join("\n"),
      [{ label: "对话上传", filename: "product-quote.pdf" }],
      [],
      { contextRefId: "ctx_failpdfabcdef12" },
    );

    const stub = buildAttachmentIntelligenceHistoryStub(failed.text);
    expect(stub).toBeTruthy();
    expect(stub!).toContain("contextRefId=ctx_failpdfabcdef12");
    expect(stub!).toContain("/tmp/durable/01-product-quote.pdf");
    expect(stub!).toMatch(/openwork_attachment_context_read|openwork_pdf_extract_text/);
  });
});
