const localFileExtractTextArgsSchema = z.object({
  path: z.string().describe("Absolute path, ~/ path, or workspace-relative path to a local non-PDF document."),
  offset: z.number().int().min(0).optional().describe("Character offset for continuing a long document. Defaults to 0."),
  maxChars: z.number().int().min(1_000).max(24_000).optional().describe("Maximum characters to return. Defaults to 20,000."),
});

const attachmentContextReadArgsSchema = z.object({
  refId: z.string().regex(/^[a-zA-Z0-9_-]{16,128}$/).describe("Exact contextRefId from an attachment history stub."),
  offset: z.number().int().min(0).optional().describe("Character offset for continuing a long context pack. Defaults to 0."),
  maxChars: z.number().int().min(1_000).max(24_000).optional().describe("Maximum context characters to return. Defaults to 20,000."),
});

const localFilePreviewArgsSchema = z.object({
  path: z.string().describe("Absolute path, ~/ path, or workspace-relative path to a local PDF, Office document, image, audio, or video."),
  size: z.number().int().min(256).max(2400).optional().describe("Quick Look thumbnail size in pixels. Defaults to 1400."),
});

const localMediaProbeArgsSchema = z.object({
  path: z.string().describe("Absolute path, ~/ path, or workspace-relative path to a local image, audio, video, PDF, or Office file."),
});

const localPdfInfoArgsSchema = z.object({
  path: z.string().describe("Absolute path, ~/ path, or workspace-relative path to a local PDF."),
});

const localPdfExtractTextArgsSchema = z.object({
  path: z.string().describe("Absolute path, ~/ path, or workspace-relative path to a local PDF."),
  startPage: z.number().int().min(1).optional().describe("First page to extract, inclusive. Defaults to 1."),
  startChar: z.number().int().min(0).optional().describe("Character offset within startPage when continuing a truncated page. Defaults to 0."),
  endPage: z.number().int().min(1).optional().describe("Last page to extract, inclusive. Defaults to a five-page window from startPage."),
  maxChars: z.number().int().min(1_000).max(24_000).optional().describe("Maximum characters to return. Defaults to 20,000."),
});

const localPdfRenderPagesArgsSchema = z.object({
  path: z.string().describe("Absolute path, ~/ path, or workspace-relative path to a local PDF."),
  pages: z.array(z.number().int().min(1)).min(1).max(12).optional().describe("Page numbers to render. Defaults to the first 6 pages."),
  scale: z.number().min(0.5).max(3).optional().describe("Render scale. Defaults to 2."),
});

const localFileSearchArgsSchema = z.object({
  query: z.string().min(1).describe("File or folder name text to search for. Content is not read; results only include path metadata."),
  root: z.string().optional().describe("Optional directory to search. Defaults to the current workspace, then the user's home folder."),
  kind: z.enum(["any", "file", "folder", "image", "video", "audio", "document"]).optional().describe("Optional result type filter. Defaults to any."),
  limit: z.number().int().min(1).max(200).optional().describe("Maximum number of results. Defaults to 50."),
  includeHidden: z.boolean().optional().describe("Include hidden files and folders. Defaults to false."),
});

const localFileBatchOperationSchema = z.object({
  action: z.enum(["copy", "move", "rename", "mkdir"]).describe("Safe batch operation. Delete is intentionally unsupported."),
  source: z.string().optional().describe("Source path for copy, move, or rename. May be absolute, ~/ path, or baseDir-relative."),
  destination: z.string().describe("Destination path or directory to create. May be absolute, ~/ path, or baseDir-relative."),
  overwrite: z.boolean().optional().describe("Allow replacing an existing destination file. Defaults to false."),
});

const localFilePlanBatchArgsSchema = z.object({
  operations: z.array(localFileBatchOperationSchema).min(1).max(200).describe("Operations to preview. This does not modify files."),
  baseDir: z.string().optional().describe("Optional base directory for relative source/destination paths."),
});

const localFileApplyBatchArgsSchema = z.object({
  operations: z.array(localFileBatchOperationSchema).min(1).max(200).optional().describe("Operations returned by openwork_file_plan_batch."),
  planId: z.string().optional().describe("Plan id returned by openwork_file_plan_batch. If supplied, operations may be omitted."),
  baseDir: z.string().optional().describe("Optional base directory for relative source/destination paths."),
  confirmed: z.boolean().describe("Must be true. This prevents accidental file changes without an explicit confirmation step."),
});

const localFileOpenDirectoryArgsSchema = z.object({
  path: z.string().describe("Absolute path, ~/ path, or workspace-relative path to a local directory."),
});

const pageImportFromFileArgsSchema = z.object({
  projectId: z.string().min(1).describe("WodeApp project ID from create_project."),
  sourcePath: z
    .string()
    .min(1)
    .describe(
      "Local HTML file path (absolute, ~/, or workspace-relative). The host reads the file; never paste HTML into tool arguments.",
    ),
  pageId: z
    .string()
    .min(1)
    .optional()
    .describe("Existing page ID to update. Prefer when create_project already returned a page."),
  path: z
    .string()
    .optional()
    .describe("New page path when pageId is omitted (e.g. / or /map). Required with title when creating."),
  title: z.string().optional().describe("Page title for create, or optional title on import."),
});
