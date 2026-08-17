function resolveLocalFilePath(input: string, context?: OpenCodeContext): string {
  const trimmed = input.trim();
  const expanded = trimmed === "~" ? homedir() : trimmed.startsWith("~/") ? join(homedir(), trimmed.slice(2)) : trimmed;
  if (isAbsolute(expanded)) return resolve(expanded);
  return resolve(context?.directory ?? process.cwd(), expanded);
}

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean; chars: number } {
  if (text.length <= maxChars) return { text, truncated: false, chars: text.length };
  return { text: text.slice(0, maxChars), truncated: true, chars: text.length };
}

const ATTACHMENT_CONTEXT_ROOT = join(homedir(), ".wodeappx", "attachment-context-packs");

async function readAttachmentContextPack(
  refId: string,
  offset = 0,
  maxChars = 20_000,
): Promise<Record<string, unknown>> {
  const trimmedRefId = refId.trim();
  if (!/^ctx_[a-zA-Z0-9_-]{8,120}$/.test(trimmedRefId)) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: "contextRefId must use a persisted local pack reference (ctx_ prefix). Remote attachmentFingerprint values cannot be read with this tool.",
      data: {
        code: "INVALID_CONTEXT_REF",
        refId: trimmedRefId,
        hint: "Use contextRefId from conversation history, not attachmentFingerprint or contextPackId.",
      },
    };
  }
  const manifestPath = join(ATTACHMENT_CONTEXT_ROOT, trimmedRefId, "manifest.json");
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      recoverable: true,
      errorKind: "execution",
      error: "The attachment context pack is no longer available locally.",
      data: {
        code: "CONTEXT_PACK_NOT_FOUND",
        refId: trimmedRefId,
        fallbackTool: "openwork_file_extract_text",
      },
    };
  }
  if (manifest.refId !== trimmedRefId || typeof manifest.context !== "string") {
    return {
      ok: false,
      recoverable: true,
      errorKind: "execution",
      error: "The attachment context pack is invalid.",
      data: {
        code: "CONTEXT_PACK_INVALID",
        refId: trimmedRefId,
        fallbackTool: "openwork_file_extract_text",
      },
    };
  }

  const context = manifest.context;
  const safeOffset = Math.min(offset, context.length);
  const text = context.slice(safeOffset, safeOffset + maxChars);
  const nextOffset = safeOffset + text.length;
  const hasMore = nextOffset < context.length;
  return {
    ok: true,
    executor: "local",
    stage: "read_attachment_context",
    data: {
      refId: trimmedRefId,
      contextPackId: typeof manifest.contextPackId === "string" ? manifest.contextPackId : "",
      createdAt: typeof manifest.createdAt === "string" ? manifest.createdAt : "",
      offset: safeOffset,
      returnedChars: text.length,
      totalChars: context.length,
      hasMore,
      nextOffset: hasMore ? nextOffset : null,
      text,
      sources: Array.isArray(manifest.sources) ? manifest.sources : [],
      uploadedUrls: Array.isArray(manifest.uploadedUrls) ? manifest.uploadedUrls : [],
      files: Array.isArray(manifest.files) ? manifest.files : [],
    },
    warnings: [],
    nextActions: hasMore
      ? [`Call openwork_attachment_context_read again with offset=${nextOffset}.`]
      : [],
  };
}

function cleanExtractedText(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeXmlEntities(text: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    quot: "\"",
  };
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#x")) {
      try {
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      } catch {
        return match;
      }
    }
    if (entity.startsWith("#")) {
      try {
        return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      } catch {
        return match;
      }
    }
    return entities[entity] ?? match;
  });
}

function stripXmlText(xml: string): string {
  return cleanExtractedText(decodeXmlEntities(xml
    .replace(/<w:tab\s*\/>/g, "\t")
    .replace(/<w:br\s*\/>/g, "\n")
    .replace(/<\/(w:p|a:p|p|row)>/g, "\n")
    .replace(/<\/(w:tc|c)>/g, "\t")
    .replace(/<[^>]+>/g, " ")));
}

async function runUnzipEntry(filePath: string, entry: string): Promise<string> {
  const result = await runProcess("/usr/bin/unzip", ["-p", filePath, entry], { timeoutMs: 30_000 });
  if (result.code !== 0) return "";
  return result.stdout;
}

async function listZipEntries(filePath: string): Promise<string[]> {
  const result = await runProcess("/usr/bin/unzip", ["-Z1", filePath], { timeoutMs: 30_000 });
  if (result.code !== 0) return [];
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function naturalEntrySort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

async function extractDocxText(filePath: string): Promise<{ source: string; text: string; warning?: string }> {
  const xml = await runUnzipEntry(filePath, "word/document.xml");
  if (!xml) return { source: "docx", text: "", warning: "word/document.xml was not found or could not be read." };
  return { source: "docx:word/document.xml", text: stripXmlText(xml) };
}

async function extractPptxText(filePath: string): Promise<{ source: string; text: string; warning?: string }> {
  const entries = (await listZipEntries(filePath))
    .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry))
    .sort(naturalEntrySort)
    .slice(0, 120);
  if (!entries.length) return { source: "pptx", text: "", warning: "No slide XML files were found." };
  const slides: string[] = [];
  for (const entry of entries) {
    const xml = await runUnzipEntry(filePath, entry);
    const text = stripXmlText(xml);
    if (text) slides.push(`${entry}\n${text}`);
  }
  return { source: "pptx:slides", text: slides.join("\n\n") };
}

function extractSharedStrings(sharedXml: string): string[] {
  return Array.from(sharedXml.matchAll(/<si[\s\S]*?<\/si>/g)).map((match) => stripXmlText(match[0]));
}

function extractWorksheetRows(sheetXml: string, sharedStrings: string[]): string[] {
  const rows: string[] = [];
  for (const rowMatch of sheetXml.matchAll(/<row\b[\s\S]*?<\/row>/g)) {
    const values: string[] = [];
    for (const cellMatch of rowMatch[0].matchAll(/<c\b([\s\S]*?)<\/c>/g)) {
      const cellXml = cellMatch[0];
      const attrs = cellMatch[1] ?? "";
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const value = cellXml.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] ?? "";
      if (type === "s") {
        values.push(sharedStrings[Number.parseInt(value, 10)] ?? value);
      } else if (type === "inlineStr") {
        values.push(stripXmlText(cellXml));
      } else {
        values.push(decodeXmlEntities(value));
      }
    }
    const row = values.map((value) => value.trim()).filter(Boolean).join("\t");
    if (row) rows.push(row);
  }
  return rows;
}

async function extractXlsxText(filePath: string): Promise<{ source: string; text: string; warning?: string }> {
  const entries = await listZipEntries(filePath);
  const sheetEntries = entries.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry)).sort(naturalEntrySort).slice(0, 80);
  if (!sheetEntries.length) return { source: "xlsx", text: "", warning: "No worksheet XML files were found." };
  const sharedStrings = extractSharedStrings(await runUnzipEntry(filePath, "xl/sharedStrings.xml"));
  const sheets: string[] = [];
  for (const entry of sheetEntries) {
    const xml = await runUnzipEntry(filePath, entry);
    const rows = extractWorksheetRows(xml, sharedStrings);
    if (rows.length) sheets.push(`${entry}\n${rows.join("\n")}`);
  }
  return { source: "xlsx:worksheets", text: sheets.join("\n\n") };
}

const XLS_MAX_BYTES = 40 * 1024 * 1024;
const XLS_MAX_SHEETS = 80;
const XLS_MAX_EVIDENCE_CELLS = 240;
const XLS_MAX_EVIDENCE_VALUE_CHARS = 256;
const XLS_CFB_MAGIC = Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]);

type XlsCellEvidence = {
  sheet: string;
  row: number;
  col: number;
  value: string;
  valueTruncated?: boolean;
};

type XlsSheetEvidence = {
  name: string;
  rowCount: number;
  nonEmptyCellCount: number;
  returnedCellCount: number;
  cells: XlsCellEvidence[];
};

type XlsWorkbookEvidence = {
  format: "biff8";
  backend: "sheetjs-biff8";
  sheetCount: number;
  totalNonEmptyCellCount: number;
  returnedCellCount: number;
  truncated: boolean;
  sheets: XlsSheetEvidence[];
};

type XlsExtractSuccess = {
  ok: true;
  source: "xls:sheetjs-biff8";
  text: string;
  evidence: XlsWorkbookEvidence;
  warning?: string;
};

type XlsExtractFailure = {
  ok: false;
  recoverable: boolean;
  errorKind: "dependency" | "execution" | "validation";
  error: string;
  data: Record<string, unknown>;
};

type XlsExtractResult = XlsExtractSuccess | XlsExtractFailure;

type SheetJsModule = {
  read: (data: Buffer, opts?: Record<string, unknown>) => {
    SheetNames: string[];
    Sheets: Record<string, Record<string, unknown> & { "!ref"?: string }>;
    Workbook?: unknown;
  };
  utils: {
    sheet_to_json: (sheet: unknown, opts?: Record<string, unknown>) => unknown[];
    decode_range: (ref: string) => { s: { r: number; c: number }; e: { r: number; c: number } };
    encode_cell: (address: { r: number; c: number }) => string;
  };
};

async function loadSheetJsModule(): Promise<SheetJsModule | null> {
  try {
    return await import("xlsx") as unknown as SheetJsModule;
  } catch {
    return null;
  }
}

function looksLikeZip(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4B;
}

function looksLikeCfb(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(XLS_CFB_MAGIC);
}

function buildXlsWorkbookEvidence(
  workbook: {
    SheetNames: string[];
    Sheets: Record<string, Record<string, unknown> & { "!ref"?: string }>;
  },
  XLSX: SheetJsModule,
): { text: string; evidence: XlsWorkbookEvidence } {
  const sheets: XlsSheetEvidence[] = [];
  const textBlocks: string[] = [];
  const selectedSheetNames = workbook.SheetNames.slice(0, XLS_MAX_SHEETS);
  const perSheetEvidenceLimit = Math.max(
    1,
    Math.floor(XLS_MAX_EVIDENCE_CELLS / Math.max(1, selectedSheetNames.length)),
  );
  let remainingEvidenceCells = XLS_MAX_EVIDENCE_CELLS;
  let totalNonEmptyCellCount = 0;

  for (const [sheetIndex, name] of selectedSheetNames.entries()) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
      blankrows: false,
    }) as Array<Array<string | number | boolean | null | undefined>>;
    const cells: XlsCellEvidence[] = [];
    const rowLines: string[] = [];
    let nonEmptyCellCount = 0;
    const sheetEvidenceLimit = sheetIndex === selectedSheetNames.length - 1
      ? remainingEvidenceCells
      : Math.min(perSheetEvidenceLimit, remainingEvidenceCells);

    matrix.forEach((row, rowIndex) => {
      const values: string[] = [];
      row.forEach((raw, colIndex) => {
        const value = String(raw ?? "").trim();
        if (!value) return;
        nonEmptyCellCount += 1;
        totalNonEmptyCellCount += 1;
        if (cells.length < sheetEvidenceLimit) {
          const valueTruncated = value.length > XLS_MAX_EVIDENCE_VALUE_CHARS;
          cells.push({
            sheet: name,
            row: rowIndex + 1,
            col: colIndex + 1,
            value: valueTruncated ? value.slice(0, XLS_MAX_EVIDENCE_VALUE_CHARS) : value,
            valueTruncated: valueTruncated || undefined,
          });
        }
        values.push(`C${colIndex + 1}=${value}`);
      });
      if (values.length) rowLines.push(`R${rowIndex + 1}\t${values.join("\t")}`);
    });

    // Prefer sheet-range traversal when dense JSON drops sparse cells.
    if (nonEmptyCellCount === 0 && sheet["!ref"]) {
      const range = XLSX.utils.decode_range(sheet["!ref"]);
      for (let row = range.s.r; row <= range.e.r; row += 1) {
        const values: string[] = [];
        for (let col = range.s.c; col <= range.e.c; col += 1) {
          const address = XLSX.utils.encode_cell({ r: row, c: col });
          const cell = sheet[address] as { w?: string; v?: unknown } | undefined;
          if (!cell) continue;
          const value = String(cell.w ?? cell.v ?? "").trim();
          if (!value) continue;
          nonEmptyCellCount += 1;
          totalNonEmptyCellCount += 1;
          if (cells.length < sheetEvidenceLimit) {
            const valueTruncated = value.length > XLS_MAX_EVIDENCE_VALUE_CHARS;
            cells.push({
              sheet: name,
              row: row + 1,
              col: col + 1,
              value: valueTruncated ? value.slice(0, XLS_MAX_EVIDENCE_VALUE_CHARS) : value,
              valueTruncated: valueTruncated || undefined,
            });
          }
          values.push(`C${col + 1}=${value}`);
        }
        if (values.length) rowLines.push(`R${row + 1}\t${values.join("\t")}`);
      }
    }

    remainingEvidenceCells = Math.max(0, remainingEvidenceCells - cells.length);
    sheets.push({
      name,
      rowCount: matrix.length || (sheet["!ref"] ? (XLSX.utils.decode_range(sheet["!ref"]).e.r + 1) : 0),
      nonEmptyCellCount,
      returnedCellCount: cells.length,
      cells,
    });
    textBlocks.push(`# sheet: ${name}\n${rowLines.join("\n") || "(empty)"}`);
  }

  const returnedCellCount = sheets.reduce((total, sheet) => total + sheet.returnedCellCount, 0);
  return {
    text: textBlocks.join("\n\n"),
    evidence: {
      format: "biff8",
      backend: "sheetjs-biff8",
      sheetCount: sheets.length,
      totalNonEmptyCellCount,
      returnedCellCount,
      truncated: totalNonEmptyCellCount > returnedCellCount,
      sheets,
    },
  };
}

async function extractXlsText(
  filePath: string,
): Promise<XlsExtractResult> {
  const fileStat = await stat(filePath);
  if (fileStat.size > XLS_MAX_BYTES) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: `Legacy Excel (.xls) exceeds the ${XLS_MAX_BYTES} byte local extraction limit.`,
      data: {
        code: "XLS_TOO_LARGE",
        path: filePath,
        sizeBytes: fileStat.size,
        maxBytes: XLS_MAX_BYTES,
        productSaveAllowed: false,
      },
    };
  }

  const buffer = await readFile(filePath);
  if (looksLikeZip(buffer)) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: "File header is OOXML/ZIP rather than BIFF8 CFB. Rename to .xlsx or use the XLSX extractor path.",
      data: {
        code: "XLS_NOT_BIFF8",
        path: filePath,
        sizeBytes: fileStat.size,
        productSaveAllowed: false,
        fallbackTool: "openwork_file_extract_text",
      },
    };
  }
  if (!looksLikeCfb(buffer)) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: "File is not a valid BIFF8 Compound File Binary workbook.",
      data: {
        code: "XLS_CORRUPT",
        path: filePath,
        sizeBytes: fileStat.size,
        productSaveAllowed: false,
      },
    };
  }

  const XLSX = await loadSheetJsModule();
  if (!XLSX) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "dependency",
      error: "Legacy Excel (.xls) text extraction is not available in this build.",
      data: {
        code: "LEGACY_XLS_DEPENDENCY_MISSING",
        path: filePath,
        extension: ".xls",
        sizeBytes: fileStat.size,
        productSaveAllowed: false,
        backend: "sheetjs-biff8",
        sofficeRequired: false,
        hint: "The bundled SheetJS BIFF8 reader failed to load. Convert the workbook to .xlsx or rebuild openwork-server with the xlsx dependency.",
      },
    };
  }

  let workbook: {
    SheetNames: string[];
    Sheets: Record<string, Record<string, unknown> & { "!ref"?: string }>;
    Workbook?: unknown;
  };
  try {
    workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
      cellNF: false,
      cellText: true,
      bookVBA: false,
      password: "",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const encrypted = /encrypt|password|FilePass|WorkbookEncryption|ECMA-376 Encrypted/i.test(message);
    return {
      ok: false,
      recoverable: true,
      errorKind: encrypted ? "validation" : "execution",
      error: encrypted
        ? "Legacy Excel (.xls) appears encrypted and cannot be read without a password."
        : `Legacy Excel (.xls) parse failed: ${message}`,
      data: {
        code: encrypted ? "XLS_ENCRYPTED" : "XLS_CORRUPT",
        path: filePath,
        sizeBytes: fileStat.size,
        productSaveAllowed: false,
        detail: message,
      },
    };
  }

  if (!workbook.SheetNames?.length) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "execution",
      error: "Legacy Excel (.xls) parsed but contained no worksheets.",
      data: {
        code: "XLS_CORRUPT",
        path: filePath,
        sizeBytes: fileStat.size,
        productSaveAllowed: false,
      },
    };
  }

  // Encrypted BIFF books often surface through FilePass / encryption markers.
  const workbookKeys = Object.keys(workbook).join(" ");
  if (/FilePass|EncryptionInfo|EncryptedPackage/i.test(workbookKeys + JSON.stringify(workbook.Workbook ?? {}))) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: "Legacy Excel (.xls) appears encrypted and cannot be read without a password.",
      data: {
        code: "XLS_ENCRYPTED",
        path: filePath,
        sizeBytes: fileStat.size,
        productSaveAllowed: false,
      },
    };
  }

  const { text, evidence } = buildXlsWorkbookEvidence(workbook, XLSX);
  if (!evidence.sheets.some((sheet) => sheet.nonEmptyCellCount > 0)) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "execution",
      error: "Legacy Excel (.xls) contained no readable cell values.",
      data: {
        code: "XLS_CORRUPT",
        path: filePath,
        sizeBytes: fileStat.size,
        productSaveAllowed: false,
        evidence,
      },
    };
  }

  return {
    ok: true,
    source: "xls:sheetjs-biff8",
    text,
    evidence,
  };
}

export async function getOpenworkRuntimeStatus(): Promise<Record<string, unknown>> {
  const sheetJs = await loadSheetJsModule();
  return {
    ok: true,
    executor: "local",
    stage: "runtime_status",
    data: {
      fileExtract: {
        xls: {
          available: Boolean(sheetJs),
          backend: "sheetjs-biff8",
          sofficeRequired: false,
          maxBytes: XLS_MAX_BYTES,
          codes: [
            "XLS_TOO_LARGE",
            "XLS_NOT_BIFF8",
            "XLS_CORRUPT",
            "XLS_ENCRYPTED",
            "LEGACY_XLS_DEPENDENCY_MISSING",
          ],
        },
        xlsx: {
          available: true,
          backend: "unzip-ooxml",
          sofficeRequired: false,
        },
        pdf: {
          available: true,
          backend: "pdfjs",
          sofficeRequired: false,
        },
      },
    },
  };
}

type PdfDocumentHandle = Awaited<ReturnType<typeof import("pdfjs-dist/legacy/build/pdf.mjs")["getDocument"]>>["promise"] extends Promise<infer T> ? T : never;

async function loadPdfDocument(filePath: string): Promise<PdfDocumentHandle> {
  const bundledCanvasUrl = new URL("./node_modules/@napi-rs/canvas/index.js", import.meta.url);
  const canvas = existsSync(fileURLToPath(bundledCanvasUrl))
    ? await import(bundledCanvasUrl.href) as typeof import("@napi-rs/canvas")
    : await import(["@napi-rs", "canvas"].join("/")) as typeof import("@napi-rs/canvas");
  Object.assign(globalThis, {
    DOMMatrix: canvas.DOMMatrix,
    ImageData: canvas.ImageData,
    Path2D: canvas.Path2D,
  });
  const bundledPdfUrl = new URL("./pdf-runtime.js", import.meta.url);
  const pdfjs = existsSync(fileURLToPath(bundledPdfUrl))
    ? await import(bundledPdfUrl.href) as typeof import("pdfjs-dist/legacy/build/pdf.mjs")
    : await import(["pdfjs-dist", "legacy/build/pdf.mjs"].join("/")) as typeof import("pdfjs-dist/legacy/build/pdf.mjs");
  const bundledWorkerUrl = new URL("./pdf.worker.js", import.meta.url);
  if (existsSync(fileURLToPath(bundledWorkerUrl))) {
    pdfjs.GlobalWorkerOptions.workerSrc = bundledWorkerUrl.href;
  }
  const data = new Uint8Array(await readFile(filePath));
  return pdfjs.getDocument({ data, verbosity: pdfjs.VerbosityLevel.ERRORS }).promise;
}

function pdfPageText(items: unknown): string {
  if (!Array.isArray(items)) return "";
  const parts: string[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object" || !("str" in item) || typeof item.str !== "string") continue;
    parts.push(item.str, "hasEOL" in item && item.hasEOL === true ? "\n" : " ");
  }
  return cleanExtractedText(parts.join(""));
}

async function inspectLocalPdf(filePath: string): Promise<Record<string, unknown>> {
  const fileStat = await stat(filePath);
  const pdf = await loadPdfDocument(filePath);
  try {
    const metadata = await pdf.getMetadata().catch(() => null);
    return {
      ok: true,
      path: filePath,
      name: basename(filePath),
      sizeBytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
      pageCount: pdf.numPages,
      fingerprints: pdf.fingerprints,
      metadata: metadata?.info ?? null,
      source: "pdfjs",
    };
  } finally {
    await pdf.destroy();
  }
}

export function buildBoundedPdfTextWindow(input: {
  pages: Array<{ page: number; text: string }>;
  pageCount: number;
  startPage: number;
  startChar?: number;
  maxChars: number;
}) {
  const pageBlocks: string[] = [];
  const startChar = Math.max(0, input.startChar ?? 0);
  let returnedChars = 0;
  let lastPage = input.startPage;
  let nextStartPage: number | null = null;
  let nextStartChar = 0;
  let truncated = false;

  for (const page of input.pages) {
    lastPage = page.page;
    const pageText = page.text || "（未检测到可用文本层，需要渲染页面进行视觉识别）";
    const pageOffset = page.page === input.startPage ? Math.min(startChar, pageText.length) : 0;
    const prefix = `【第 ${page.page} 页】\n`;
    const separator = pageBlocks.length ? "\n\n" : "";
    const available = Math.max(0, input.maxChars - returnedChars - separator.length - prefix.length);
    const remaining = pageText.slice(pageOffset);
    const chunk = remaining.slice(0, available);
    if (available > 0) {
      pageBlocks.push(`${prefix}${chunk}`);
      returnedChars += separator.length + prefix.length + chunk.length;
    }
    if (chunk.length < remaining.length) {
      truncated = true;
      nextStartPage = page.page;
      nextStartChar = pageOffset + chunk.length;
      break;
    }
  }
  if (nextStartPage === null && lastPage < input.pageCount) {
    nextStartPage = lastPage + 1;
    nextStartChar = 0;
  }
  const text = pageBlocks.join("\n\n");
  return {
    extractedPages: { start: input.startPage, end: lastPage, startChar },
    hasMorePages: nextStartPage !== null,
    nextStartPage,
    nextStartChar: nextStartPage !== null ? nextStartChar : null,
    pageChars: input.pages.map((page) => page.text.length),
    chars: text.length,
    truncated,
    text,
  };
}

async function extractLocalPdfPages(
  filePath: string,
  options: { startPage?: number; startChar?: number; endPage?: number; maxChars: number },
): Promise<Record<string, unknown>> {
  const pdf = await loadPdfDocument(filePath);
  try {
    const startPage = Math.min(Math.max(1, options.startPage ?? 1), pdf.numPages);
    const startChar = Math.max(0, options.startChar ?? 0);
    const endPage = Math.min(Math.max(startPage, options.endPage ?? startPage + 4), pdf.numPages);
    const pages: Array<{ page: number; text: string }> = [];
    for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = pdfPageText(content.items);
      page.cleanup();
      pages.push({ page: pageNumber, text });
    }
    const window = buildBoundedPdfTextWindow({
      pages,
      pageCount: pdf.numPages,
      startPage,
      startChar,
      maxChars: options.maxChars,
    });
    return {
      ok: true,
      path: filePath,
      name: basename(filePath),
      source: "pdfjs:text-layer",
      pageCount: pdf.numPages,
      ...window,
    };
  } finally {
    await pdf.destroy();
  }
}

async function renderLocalPdfPages(
  filePath: string,
  requestedPages: number[] | undefined,
  scale: number,
): Promise<Record<string, unknown>> {
    const bundledCanvasUrl = new URL("./node_modules/@napi-rs/canvas/index.js", import.meta.url);
    const canvasModule = existsSync(fileURLToPath(bundledCanvasUrl))
      ? await import(bundledCanvasUrl.href) as typeof import("@napi-rs/canvas")
      : await import(["@napi-rs", "canvas"].join("/")) as typeof import("@napi-rs/canvas");
  const pdf = await loadPdfDocument(filePath);
  try {
    const pages = [...new Set(requestedPages?.length ? requestedPages : Array.from(
      { length: Math.min(pdf.numPages, 6) },
      (_, index) => index + 1,
    ))].filter((page) => page >= 1 && page <= pdf.numPages).slice(0, 12);
    if (!pages.length) throw new Error(`No requested page exists in this ${pdf.numPages}-page PDF.`);
    const fileKey = createHash("sha256").update(`${filePath}:${(await stat(filePath)).mtimeMs}`).digest("hex").slice(0, 16);
    const outputDir = join(tmpdir(), "wodeappx-pdf-pages", fileKey);
    await mkdir(outputDir, { recursive: true });
    const rendered: Array<{ page: number; path: string; width: number; height: number }> = [];
    for (const pageNumber of pages) {
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = canvasModule.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const canvasContext = canvas.getContext("2d");
      await page.render({
        canvas: canvas as never,
        canvasContext: canvasContext as never,
        viewport,
      }).promise;
      const outputPath = join(outputDir, `page-${String(pageNumber).padStart(3, "0")}.png`);
      await writeFile(outputPath, canvas.toBuffer("image/png"));
      rendered.push({ page: pageNumber, path: outputPath, width: canvas.width, height: canvas.height });
      page.cleanup();
    }
    return {
      ok: true,
      path: filePath,
      pageCount: pdf.numPages,
      rendered,
      instruction: "Use the image/file read tool on every returned path needed for visual conclusions. These page images are previews, not productImages.",
      source: "pdfjs:canvas",
    };
  } finally {
    await pdf.destroy();
  }
}

async function extractPdfText(filePath: string): Promise<{ source: string; text: string; warning?: string }> {
  try {
    const extracted = await extractLocalPdfPages(filePath, { maxChars: 200_000 });
    return { source: String(extracted.source), text: String(extracted.text ?? "") };
  } catch (error) {
    throw new Error(
      `PDF.js could not parse this PDF: ${error instanceof Error ? error.message : String(error)}. `
      + "The file was not treated as plain text; use openwork_pdf_render_pages only if the PDF itself is valid.",
    );
  }
}

async function extractPlainTextFile(
  filePath: string,
  offset: number,
  maxChars: number,
): Promise<{ text: string; complete: boolean }> {
  const fileStat = await stat(filePath);
  const maxBytes = Math.max((offset + maxChars + 1) * 8, 64_000);
  if (fileStat.size > maxBytes) {
    const result = await runProcess("/usr/bin/head", ["-c", String(maxBytes), filePath], { timeoutMs: 15_000 });
    if (result.code === 0) return { text: result.stdout, complete: false };
  }
  return { text: await readFile(filePath, "utf8"), complete: true };
}

async function extractLocalFileText(
  filePath: string,
  offset: number,
  maxChars: number,
): Promise<Record<string, unknown>> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: "Path is not a file.",
      data: { path: filePath },
    };
  }

  const ext = extname(filePath).toLowerCase();
  const textExts = new Set([".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".jsonc", ".yaml", ".yml", ".html", ".htm", ".xml", ".svg", ".css", ".js", ".jsx", ".ts", ".tsx", ".py", ".rb", ".go", ".rs", ".java", ".c", ".cc", ".cpp", ".h", ".hpp", ".sh", ".sql"]);
  let extracted: { source: string; text: string; warning?: string; evidence?: XlsWorkbookEvidence };
  let sourceComplete = true;

  if (textExts.has(ext)) {
    const plainText = await extractPlainTextFile(filePath, offset, maxChars);
    sourceComplete = plainText.complete;
    extracted = { source: "utf8", text: plainText.text };
  } else if (ext === ".docx") {
    extracted = await extractDocxText(filePath);
  } else if (ext === ".pptx") {
    extracted = await extractPptxText(filePath);
  } else if (ext === ".xlsx") {
    extracted = await extractXlsxText(filePath);
  } else if (ext === ".xls") {
    const xlsResult = await extractXlsText(filePath);
    if (!xlsResult.ok) return xlsResult;
    extracted = {
      source: xlsResult.source,
      text: xlsResult.text,
      warning: xlsResult.warning,
      evidence: xlsResult.evidence,
    };
  } else if (ext === ".pdf") {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: "Use the dedicated PDF tools for bounded page-aware reading.",
      data: {
        code: "USE_PDF_TOOLS",
        path: filePath,
        fallbackTool: "openwork_pdf_info",
        nextTool: "openwork_pdf_extract_text",
      },
    };
  } else {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: "Unsupported text extraction type. Use openwork_file_preview or openwork_file_media_probe for this file.",
      data: {
        path: filePath,
        extension: ext,
        sizeBytes: fileStat.size,
        fallbackTool: "openwork_file_preview",
      },
    };
  }

  const cleaned = cleanExtractedText(extracted.text);
  const safeOffset = Math.min(offset, cleaned.length);
  const text = cleaned.slice(safeOffset, safeOffset + maxChars);
  const nextOffset = safeOffset + text.length;
  const hasMore = nextOffset < cleaned.length || !sourceComplete;
  return {
    ok: true,
    path: filePath,
    name: basename(filePath),
    extension: ext,
    sizeBytes: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString(),
    source: extracted.source,
    warning: extracted.warning,
    evidence: safeOffset === 0 ? extracted.evidence : undefined,
    evidenceIncluded: ext === ".xls" ? safeOffset === 0 && Boolean(extracted.evidence) : undefined,
    productSaveAllowed: ext === ".xls" ? true : undefined,
    offset: safeOffset,
    returnedChars: text.length,
    totalChars: sourceComplete ? cleaned.length : null,
    hasMore,
    nextOffset: hasMore ? nextOffset : null,
    truncated: hasMore,
    text,
    nextActions: hasMore
      ? [`Call openwork_file_extract_text again with offset=${nextOffset}.`]
      : [],
  };
}

function parseMdlsOutput(output: string): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([^=]+)=\s*(.*)$/);
    if (!match) continue;
    metadata[match[1].trim()] = match[2].trim();
  }
  return metadata;
}

async function probeLocalMedia(filePath: string): Promise<Record<string, unknown>> {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) return { ok: false, path: filePath, error: "Path is not a file." };
  const mime = await runProcess("/usr/bin/file", ["-b", "--mime-type", filePath], { timeoutMs: 10_000 });
  const metadataResult = platform() === "darwin"
    ? await runProcess("/usr/bin/mdls", [
        "-name", "kMDItemContentType",
        "-name", "kMDItemKind",
        "-name", "kMDItemPixelWidth",
        "-name", "kMDItemPixelHeight",
        "-name", "kMDItemDurationSeconds",
        "-name", "kMDItemCodecs",
        "-name", "kMDItemPageCount",
        filePath,
      ], { timeoutMs: 15_000 })
    : null;
  const sips = /\.(png|jpe?g|gif|webp|tiff?|bmp|heic|heif)$/i.test(filePath) && platform() === "darwin"
    ? await runProcess("/usr/bin/sips", ["-g", "pixelWidth", "-g", "pixelHeight", filePath], { timeoutMs: 10_000 })
    : null;

  return {
    ok: true,
    path: filePath,
    name: basename(filePath),
    extension: extname(filePath).toLowerCase(),
    sizeBytes: fileStat.size,
    modifiedAt: fileStat.mtime.toISOString(),
    mimeType: mime.code === 0 ? mime.stdout.trim() : null,
    spotlight: metadataResult && metadataResult.code === 0 ? parseMdlsOutput(metadataResult.stdout) : null,
    imageInfo: sips && sips.code === 0 ? sips.stdout.trim() : null,
  };
}

async function createQuickLookPreview(filePath: string, size: number): Promise<Record<string, unknown>> {
  if (platform() !== "darwin") {
    return { ok: false, path: filePath, error: "Quick Look previews are only available on macOS." };
  }
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) return { ok: false, path: filePath, error: "Path is not a file." };
  const outputDir = join(tmpdir(), "wodeappx-file-previews");
  await mkdir(outputDir, { recursive: true });
  const result = await runProcess("/usr/bin/qlmanage", ["-t", "-s", String(size), "-o", outputDir, filePath], { timeoutMs: 60_000 });
  const names = await readdir(outputDir).catch(() => []);
  const base = basename(filePath);
  const candidates = names
    .filter((name) => name === `${base}.png` || name.startsWith(`${base}.`))
    .map((name) => join(outputDir, name));
  const previewPath = candidates.find((candidate) => existsSync(candidate)) ?? null;
  return {
    ok: result.code === 0 && Boolean(previewPath),
    path: filePath,
    outputDir,
    previewPath,
    size,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim(),
    error: result.code === 0 ? undefined : `qlmanage exited with ${result.code}`,
  };
}

function isPathInside(childPath: string, parentPath: string): boolean {
  const child = resolve(childPath);
  const parent = resolve(parentPath);
  return child === parent || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
}

function localFileAllowedRoots(context?: OpenCodeContext): string[] {
  return [...new Set([
    homedir(),
    tmpdir(),
    context?.directory,
    context?.worktree,
    process.cwd(),
  ].filter((item): item is string => Boolean(item)).map((item) => resolve(item)))];
}

function requireSafeLocalUserPath(filePath: string, context?: OpenCodeContext): void {
  const resolved = resolve(filePath);
  const allowed = localFileAllowedRoots(context);
  if (!allowed.some((root) => isPathInside(resolved, root))) {
    throw new Error(`Path is outside allowed user/workspace roots: ${resolved}`);
  }
}

function resolveLocalUserPath(input: string, context?: OpenCodeContext, baseDir?: string): string {
  const trimmed = input.trim();
  const expanded = trimmed === "~" ? homedir() : trimmed.startsWith("~/") ? join(homedir(), trimmed.slice(2)) : trimmed;
  if (isAbsolute(expanded)) return resolve(expanded);
  const base = baseDir ? resolveLocalFilePath(baseDir, context) : context?.directory ?? context?.worktree ?? process.cwd();
  return resolve(base, expanded);
}

function hasHiddenPathSegment(filePath: string, root: string): boolean {
  const relativePath = resolve(filePath).slice(resolve(root).length).split("/").filter(Boolean);
  return relativePath.some((segment) => segment.startsWith("."));
}

function localFileKindMatches(filePath: string, fileStat: Awaited<ReturnType<typeof stat>>, kind: string): boolean {
  if (!kind || kind === "any") return true;
  if (kind === "folder") return fileStat.isDirectory();
  if (!fileStat.isFile()) return false;
  if (kind === "file") return true;
  const ext = extname(filePath).toLowerCase();
  const groups: Record<string, Set<string>> = {
    image: new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".tif", ".tiff", ".bmp", ".heic", ".heif", ".svg"]),
    video: new Set([".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv", ".flv", ".wmv"]),
    audio: new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".aiff", ".aif"]),
    document: new Set([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".txt", ".md", ".csv", ".tsv", ".rtf"]),
  };
  return groups[kind]?.has(ext) ?? false;
}

async function spotlightFileSearch(query: string, root: string, limit: number): Promise<string[]> {
  if (platform() !== "darwin" || !existsSync("/usr/bin/mdfind")) return [];
  const result = await runProcess("/usr/bin/mdfind", ["-onlyin", root, query], { timeoutMs: 12_000 });
  if (result.code !== 0) return [];
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, limit);
}

async function walkFileSearch(query: string, root: string, limit: number, includeHidden: boolean): Promise<string[]> {
  const lowerQuery = query.toLowerCase();
  const results: string[] = [];
  const stack = [root];
  let visited = 0;
  const maxVisited = 25_000;
  const skippedDirs = new Set([".git", "node_modules", ".Trash"]);

  while (stack.length && results.length < limit && visited < maxVisited) {
    const dir = stack.pop();
    if (!dir) continue;
    visited += 1;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
    if (!entries) continue;
    for (const entry of entries) {
      if (!includeHidden && entry.name.startsWith(".")) continue;
      const fullPath = join(dir, entry.name);
      if (entry.name.toLowerCase().includes(lowerQuery)) {
        results.push(fullPath);
        if (results.length >= limit) break;
      }
      if (entry.isDirectory() && !skippedDirs.has(entry.name)) {
        stack.push(fullPath);
      }
    }
  }

  return results;
}

async function searchLocalFiles(rawArgs: z.infer<typeof localFileSearchArgsSchema>, context?: OpenCodeContext): Promise<Record<string, unknown>> {
  const limit = rawArgs.limit ?? 50;
  const kind = rawArgs.kind ?? "any";
  const root = resolveLocalUserPath(rawArgs.root ?? context?.directory ?? context?.worktree ?? homedir(), context);
  requireSafeLocalUserPath(root, context);
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) return { ok: false, root, error: "Search root is not a directory." };

  const candidateLimit = Math.min(limit * 4, 500);
  const candidates = [
    ...(await spotlightFileSearch(rawArgs.query, root, candidateLimit)),
    ...(await walkFileSearch(rawArgs.query, root, candidateLimit, Boolean(rawArgs.includeHidden))),
  ];
  const seen = new Set<string>();
  const results: Array<Record<string, unknown>> = [];

  for (const candidate of candidates) {
    const filePath = resolve(candidate);
    if (seen.has(filePath) || !isPathInside(filePath, root)) continue;
    seen.add(filePath);
    if (!rawArgs.includeHidden && hasHiddenPathSegment(filePath, root)) continue;
    let fileStat: Awaited<ReturnType<typeof stat>>;
    try {
      fileStat = await stat(filePath);
    } catch {
      continue;
    }
    if (!localFileKindMatches(filePath, fileStat, kind)) continue;
    results.push({
      path: filePath,
      name: basename(filePath),
      kind: fileStat.isDirectory() ? "folder" : "file",
      extension: fileStat.isFile() ? extname(filePath).toLowerCase() : "",
      sizeBytes: fileStat.isFile() ? fileStat.size : null,
      modifiedAt: fileStat.mtime.toISOString(),
    });
    if (results.length >= limit) break;
  }

  return {
    ok: true,
    root,
    query: rawArgs.query,
    kind,
    returned: results.length,
    results,
  };
}

type LocalFileBatchOperation = {
  action: "copy" | "move" | "rename" | "mkdir";
  source?: string;
  destination: string;
  overwrite?: boolean;
};

type LocalFileBatchPlanOperation = LocalFileBatchOperation & {
  index: number;
  sourcePath?: string;
  destinationPath: string;
  status: "ready" | "blocked";
  reason?: string;
  sourceKind?: "file" | "folder";
  sizeBytes?: number | null;
  destinationExists?: boolean;
};

function localFileBatchPlanDir(): string {
  return join(tmpdir(), "wodeappx-file-batch-plans");
}

function localFileBatchPlanPath(planId: string): string {
  if (!/^wodeappx-[a-z0-9-]+$/i.test(planId)) {
    throw new Error("Invalid planId.");
  }
  return join(localFileBatchPlanDir(), `${planId}.json`);
}

async function normalizeLocalFileBatchOperation(
  operation: LocalFileBatchOperation,
  index: number,
  context?: OpenCodeContext,
  baseDir?: string,
): Promise<LocalFileBatchPlanOperation> {
  const destinationPath = resolveLocalUserPath(operation.destination, context, baseDir);
  requireSafeLocalUserPath(destinationPath, context);

  const planned: LocalFileBatchPlanOperation = {
    ...operation,
    index,
    destinationPath,
    status: "ready",
  };

  if (operation.action === "mkdir") {
    const existing = await stat(destinationPath).catch(() => null);
    planned.destinationExists = Boolean(existing);
    if (existing && !existing.isDirectory()) {
      planned.status = "blocked";
      planned.reason = "Destination exists and is not a folder.";
    }
    return planned;
  }

  if (!operation.source) {
    return { ...planned, status: "blocked", reason: "Source path is required for this action." };
  }

  const sourcePath = resolveLocalUserPath(operation.source, context, baseDir);
  requireSafeLocalUserPath(sourcePath, context);
  planned.sourcePath = sourcePath;

  const sourceStat = await stat(sourcePath).catch(() => null);
  if (!sourceStat) {
    planned.status = "blocked";
    planned.reason = "Source path does not exist.";
    return planned;
  }
  planned.sourceKind = sourceStat.isDirectory() ? "folder" : "file";
  planned.sizeBytes = sourceStat.isFile() ? sourceStat.size : null;

  if (operation.action === "copy" && !sourceStat.isFile()) {
    planned.status = "blocked";
    planned.reason = "Copy currently supports files only.";
    return planned;
  }

  const destinationParent = dirname(destinationPath);
  const parentStat = await stat(destinationParent).catch(() => null);
  if (!parentStat || !parentStat.isDirectory()) {
    planned.status = "blocked";
    planned.reason = "Destination parent folder does not exist.";
    return planned;
  }

  const destinationStat = await stat(destinationPath).catch(() => null);
  planned.destinationExists = Boolean(destinationStat);
  if (destinationStat && !operation.overwrite) {
    planned.status = "blocked";
    planned.reason = "Destination already exists. Set overwrite:true only when replacement is intended.";
  }

  return planned;
}

async function buildLocalFileBatchPlan(
  operations: LocalFileBatchOperation[],
  context?: OpenCodeContext,
  baseDir?: string,
): Promise<Record<string, unknown>> {
  const planned: LocalFileBatchPlanOperation[] = [];
  for (let index = 0; index < operations.length; index += 1) {
    planned.push(await normalizeLocalFileBatchOperation(operations[index], index, context, baseDir));
  }

  const planId = `wodeappx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const blocked = planned.filter((item) => item.status === "blocked");
  const plan = {
    ok: blocked.length === 0,
    planId,
    operationCount: planned.length,
    blockedCount: blocked.length,
    createdAt: new Date().toISOString(),
    dryRun: true,
    baseDir,
    operations: planned,
  };
  await mkdir(localFileBatchPlanDir(), { recursive: true });
  await writeFile(localFileBatchPlanPath(planId), JSON.stringify(plan, null, 2), "utf8");
  return plan;
}

async function readLocalFileBatchPlan(planId: string): Promise<{ operations: LocalFileBatchOperation[]; baseDir?: string }> {
  const content = await readFile(localFileBatchPlanPath(planId), "utf8");
  const plan = JSON.parse(content) as { operations?: Array<LocalFileBatchPlanOperation & LocalFileBatchOperation>; baseDir?: string };
  if (!Array.isArray(plan.operations)) throw new Error("Plan file does not contain operations.");
  return { operations: plan.operations, baseDir: plan.baseDir };
}

async function openLocalDirectory(dirPath: string): Promise<Record<string, unknown>> {
  const fileStat = await stat(dirPath);
  if (!fileStat.isDirectory()) {
    return { ok: false, path: dirPath, error: "Path is not a directory." };
  }
  const os = platform();
  if (os === "darwin") {
    const result = await runProcess("/usr/bin/open", [dirPath], { timeoutMs: 15_000 });
    if (result.code !== 0) {
      return { ok: false, path: dirPath, error: result.stderr.trim() || `open exited with ${result.code}` };
    }
    return { ok: true, path: dirPath, platform: os };
  }
  if (os === "win32") {
    const result = await runProcess("explorer.exe", [dirPath], { timeoutMs: 15_000 });
    if (result.code !== 0) {
      return { ok: false, path: dirPath, error: result.stderr.trim() || `explorer exited with ${result.code}` };
    }
    return { ok: true, path: dirPath, platform: os };
  }
  const result = await runProcess("xdg-open", [dirPath], { timeoutMs: 15_000 });
  if (result.code !== 0) {
    return { ok: false, path: dirPath, error: result.stderr.trim() || `xdg-open exited with ${result.code}` };
  }
  return { ok: true, path: dirPath, platform: os };
}

async function applyLocalFileBatchPlan(
  operations: LocalFileBatchOperation[],
  context?: OpenCodeContext,
  baseDir?: string,
): Promise<Record<string, unknown>> {
  const preview = await buildLocalFileBatchPlan(operations, context, baseDir);
  const planned = preview.operations as LocalFileBatchPlanOperation[];
  const blocked = planned.filter((item) => item.status === "blocked");
  if (blocked.length) {
    return {
      ok: false,
      error: "Batch plan has blocked operations. Nothing was changed.",
      blocked,
      plan: preview,
    };
  }

  const applied: Array<Record<string, unknown>> = [];
  for (const operation of planned) {
    if (operation.action === "mkdir") {
      await mkdir(operation.destinationPath, { recursive: true });
    } else if (operation.action === "copy") {
      await copyFile(operation.sourcePath ?? "", operation.destinationPath);
    } else {
      await rename(operation.sourcePath ?? "", operation.destinationPath);
    }
    applied.push({
      index: operation.index,
      action: operation.action,
      source: operation.sourcePath,
      destination: operation.destinationPath,
    });
  }

  return {
    ok: true,
    appliedCount: applied.length,
    applied,
  };
}

const MAX_PAGE_IMPORT_HTML_BYTES = 1_500_000;

function resolveWodeAppMainApiBase(): string {
  const origin = (
    process.env.WODEAPP_ORIGIN
    || process.env.VITE_WODEAPP_ORIGIN
    || "https://wodeapp.cn"
  ).trim().replace(/\/+$/, "");
  return (
    process.env.WODEAPPX_MAIN_API_BASE
    || process.env.WODEAPP_MAIN_API_BASE
    || `${origin}/mainserver/api`
  ).replace(/\/+$/, "");
}

function resolveWodeAppApiKey(): string {
  return (
    process.env.WODEAPPX_API_KEY
    || process.env.WODEAPP_API_KEY
    || ""
  ).trim();
}

async function wodeAppMainserverJson(
  path: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> | null; text: string }> {
  const apiKey = resolveWodeAppApiKey();
  if (!apiKey) {
    return {
      ok: false,
      status: 401,
      json: null,
      text: "WODEAPP_API_KEY is not set in the OpenWork engine process.",
    };
  }
  const url = `${resolveWodeAppMainApiBase()}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("X-API-Key", apiKey);
  headers.set("Authorization", `Bearer ${apiKey}`);
  const response = await fetch(url, { ...init, headers });
  const text = await response.text();
  let json: Record<string, unknown> | null = null;
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        json = parsed as Record<string, unknown>;
      }
    } catch {
      json = null;
    }
  }
  return { ok: response.ok, status: response.status, json, text };
}

function summarizeImportedPage(page: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const configRaw = page?.config;
  let sectionsCount = 0;
  let sectionTypes: string[] = [];
  let customCodeChars = 0;
  let config: Record<string, unknown> | null = null;
  if (typeof configRaw === "string") {
    try {
      const parsed: unknown = JSON.parse(configRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config = parsed as Record<string, unknown>;
    } catch {
      config = null;
    }
  } else if (configRaw && typeof configRaw === "object" && !Array.isArray(configRaw)) {
    config = configRaw as Record<string, unknown>;
  }
  const sections = Array.isArray(config?.sections) ? config.sections : [];
  sectionsCount = sections.length;
  sectionTypes = sections
    .map((section) => {
      if (!section || typeof section !== "object") return "unknown";
      const type = Reflect.get(section, "type");
      return typeof type === "string" && type.trim() ? type : "unknown";
    })
    .slice(0, 12);
  for (const section of sections) {
    if (!section || typeof section !== "object") continue;
    const props = Reflect.get(section, "props");
    if (!props || typeof props !== "object") continue;
    const code = Reflect.get(props, "code");
    if (typeof code === "string") customCodeChars += code.length;
  }
  return {
    id: typeof page?.id === "string" ? page.id : undefined,
    path: typeof page?.path === "string" ? page.path : undefined,
    title: typeof page?.title === "string" ? page.title : undefined,
    sectionsCount,
    sectionTypes,
    customCodeChars,
  };
}

async function importPageFromLocalHtmlFile(
  args: {
    projectId: string;
    sourcePath: string;
    pageId?: string;
    path?: string;
    title?: string;
  },
  context?: OpenCodeContext,
): Promise<Record<string, unknown>> {
  const projectId = args.projectId.trim();
  if (!projectId) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: "projectId is required.",
      data: { code: "PROJECT_ID_REQUIRED" },
    };
  }

  const sourcePath = resolveLocalFilePath(args.sourcePath, context);
  requireSafeLocalUserPath(sourcePath, context);
  const sourceStat = await stat(sourcePath).catch(() => null);
  if (!sourceStat || !sourceStat.isFile()) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: `Local HTML file not found: ${sourcePath}`,
      data: { code: "SOURCE_FILE_MISSING", sourcePath },
    };
  }
  if (sourceStat.size > MAX_PAGE_IMPORT_HTML_BYTES) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: `HTML file too large (${sourceStat.size} bytes; max ${MAX_PAGE_IMPORT_HTML_BYTES}).`,
      data: { code: "HTML_TOO_LARGE", sourcePath, byteLength: sourceStat.size },
    };
  }

  const html = await readFile(sourcePath, "utf8");
  const byteLength = Buffer.byteLength(html, "utf8");
  if (!html.trim()) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: "HTML file is empty.",
      data: { code: "HTML_EMPTY", sourcePath },
    };
  }
  if (byteLength > MAX_PAGE_IMPORT_HTML_BYTES) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "validation",
      error: `HTML too large (${byteLength} bytes; max ${MAX_PAGE_IMPORT_HTML_BYTES}).`,
      data: { code: "HTML_TOO_LARGE", sourcePath, byteLength },
    };
  }

  let pageId = typeof args.pageId === "string" ? args.pageId.trim() : "";
  const title = typeof args.title === "string" ? args.title.trim() : "";
  const pathRaw = typeof args.path === "string" ? args.path.trim() : "";
  const createdPage = !pageId;

  if (!pageId) {
    if (!pathRaw || !title) {
      return {
        ok: false,
        recoverable: true,
        errorKind: "validation",
        error: "Provide pageId to update an existing page, or path + title to create a new page.",
        data: {
          code: "PAGE_TARGET_REQUIRED",
          nextActions: [
            "Pass pageId from create_project / list_pages, or pass path and title to create a page.",
          ],
        },
      };
    }
    const normalizedPath = pathRaw.startsWith("/") ? pathRaw : `/${pathRaw}`;
    const createRes = await wodeAppMainserverJson(`/json-schema/projects/${encodeURIComponent(projectId)}/pages`, {
      method: "POST",
      body: JSON.stringify({
        path: normalizedPath,
        title,
        config: { title, path: normalizedPath, mode: "real", sections: [] },
      }),
    });
    if (!createRes.ok) {
      return {
        ok: false,
        recoverable: true,
        errorKind: "execution",
        error: `Failed to create page (HTTP ${createRes.status}): ${(createRes.json?.error as string) || createRes.text.slice(0, 400)}`,
        data: {
          code: "PAGE_CREATE_FAILED",
          status: createRes.status,
          fallbackTool: "create_page",
        },
      };
    }
    const created = createRes.json?.data;
    const createdId =
      created && typeof created === "object" && !Array.isArray(created)
        ? Reflect.get(created, "id")
        : undefined;
    if (typeof createdId !== "string" || !createdId.trim()) {
      return {
        ok: false,
        recoverable: true,
        errorKind: "execution",
        error: "Page create succeeded but returned no page id.",
        data: { code: "PAGE_CREATE_NO_ID" },
      };
    }
    pageId = createdId.trim();
  }

  const importRes = await wodeAppMainserverJson(
    `/json-schema/projects/${encodeURIComponent(projectId)}/pages/${encodeURIComponent(pageId)}/import-html`,
    {
      method: "POST",
      body: JSON.stringify({
        html,
        ...(title ? { title } : {}),
      }),
    },
  );
  if (!importRes.ok) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "execution",
      error: `import-html failed (HTTP ${importRes.status}): ${(importRes.json?.error as string) || importRes.text.slice(0, 400)}`,
      data: {
        code: "IMPORT_HTML_FAILED",
        status: importRes.status,
        pageId,
        sourcePath,
        scanIssues: importRes.json?.scanIssues,
        nextActions: [
          "Fix the local HTML file, then retry wodeapp_page_import_from_file with the same sourcePath.",
          "Do not paste the HTML into update_page.config.",
        ],
      },
    };
  }

  const page =
    importRes.json?.data && typeof importRes.json.data === "object" && !Array.isArray(importRes.json.data)
      ? (importRes.json.data as Record<string, unknown>)
      : null;
  const meta =
    importRes.json?.meta && typeof importRes.json.meta === "object" && !Array.isArray(importRes.json.meta)
      ? (importRes.json.meta as Record<string, unknown>)
      : undefined;

  return {
    ok: true,
    executor: "local",
    stage: "page_import_from_file",
    data: {
      projectId,
      pageId,
      sourcePath,
      createdPage,
      byteLength,
      page: summarizeImportedPage(page),
      meta,
    },
    warnings: [],
    nextActions: [
      "Call publish_project with the same projectId after verifying sectionsCount > 0.",
      "Do not call update_page with mega CustomCode / template-configs.",
    ],
  };
}
