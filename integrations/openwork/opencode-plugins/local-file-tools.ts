    openwork_runtime_status: {
      description: "Report local runtime extraction capabilities for documents such as BIFF8 .xls, OOXML .xlsx, and PDF. Use this when diagnosing whether Legacy Excel reading is available without LibreOffice/soffice.",
      args: {},
      async execute() {
        return asJsonText(await getOpenworkRuntimeStatus());
      },
    },
    openwork_attachment_context_read: {
      description: "Read a locally cached attachment context by the exact contextRefId in conversation history. Returns bounded text, stable local media paths, and a next offset for continuation.",
      args: attachmentContextReadArgsSchema.shape,
      async execute(rawArgs: unknown) {
        const parsed = attachmentContextReadArgsSchema.safeParse(rawArgs);
        if (!parsed.success) {
          return asJsonText({
            ok: false,
            recoverable: true,
            errorKind: "validation",
            error: parsed.error.message,
          });
        }
        return asJsonText(await readAttachmentContextPack(
          parsed.data.refId,
          parsed.data.offset ?? 0,
          parsed.data.maxChars ?? 20_000,
        ));
      },
    },
    openwork_pdf_info: {
      description: "Inspect a local PDF before reading it. Returns reliable page count, file metadata, and PDF metadata using PDF.js.",
      args: localPdfInfoArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        try {
          const args = localPdfInfoArgsSchema.parse(rawArgs);
          return asJsonText(await inspectLocalPdf(resolveLocalFilePath(args.path, context)));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    openwork_pdf_extract_text: {
      description: "Extract a bounded PDF text window with continuation metadata. Defaults to five pages and 20,000 characters. Call openwork_pdf_info first; continue with nextStartPage and nextStartChar. Empty pages require openwork_pdf_render_pages.",
      args: localPdfExtractTextArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        try {
          const args = localPdfExtractTextArgsSchema.parse(rawArgs);
          return asJsonText(await extractLocalPdfPages(resolveLocalFilePath(args.path, context), {
            startPage: args.startPage,
            startChar: args.startChar,
            endPage: args.endPage,
            maxChars: args.maxChars ?? 20_000,
          }));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    openwork_pdf_render_pages: {
      description: "Render selected local PDF pages to PNG files for visual inspection of scans, tables, images, product appearance, parameters, and layout. Call image_inspect on each returned image path for a bounded current-turn preview. Never call OpenCode read on those PNG paths.",
      args: localPdfRenderPagesArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        try {
          const args = localPdfRenderPagesArgsSchema.parse(rawArgs);
          return asJsonText(await renderLocalPdfPages(resolveLocalFilePath(args.path, context), args.pages, args.scale ?? 2));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    openwork_file_extract_text: {
      description: "Extract a bounded text window from a local DOCX, XLSX, BIFF8 XLS, PPTX, plain text, or JSON file. Legacy .xls is parsed by the bundled SheetJS BIFF8 reader (no soffice). Continue with nextOffset when hasMore is true. For large storyboard payloads (scene_payload / tool_call_payload), use this to read in windows or sample episodes; small files may use OpenCode read. Structured sheet/row/cell evidence is included for .xls. Use openwork_pdf_info/openwork_pdf_extract_text for PDFs.",
      args: localFileExtractTextArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const parsed = localFileExtractTextArgsSchema.safeParse(rawArgs);
        if (!parsed.success) {
          return asJsonText({
            ok: false,
            recoverable: true,
            errorKind: "validation",
            error: parsed.error.message,
          });
        }
        const args = parsed.data;
        const requestedLegacyXls = extname(args.path).toLowerCase() === ".xls";
        let filePath = args.path;
        let result: Record<string, unknown>;
        try {
          filePath = resolveLocalFilePath(args.path, context);
          result = await extractLocalFileText(
            filePath,
            args.offset ?? 0,
            args.maxChars ?? 20_000,
          );
        } catch (error) {
          result = {
            ok: false,
            recoverable: true,
            errorKind: "execution",
            error: error instanceof Error ? error.message : String(error),
            ...(requestedLegacyXls
              ? {
                  productSaveAllowed: false,
                  data: {
                    code: "XLS_READ_FAILED",
                    productSaveAllowed: false,
                    path: filePath,
                  },
                }
              : {}),
          };
        }
        if (requestedLegacyXls) {
          recordXlsExtractionOutcome(context, filePath, result);
        }
        return asJsonText(result);
      },
    },
    openwork_file_preview: {
      description: "Create a macOS Quick Look preview thumbnail for a local PDF, Office document, image, audio, or video file. Returns the generated preview path.",
      args: localFilePreviewArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        try {
          const args = localFilePreviewArgsSchema.parse(rawArgs);
          const filePath = resolveLocalFilePath(args.path, context);
          return asJsonText(await createQuickLookPreview(filePath, args.size ?? 1400));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    openwork_file_media_probe: {
      description: "Read local file metadata for images, audio, video, PDF, and Office files using built-in system tools. Returns mime type, dimensions, duration, page count, and Spotlight metadata when available.",
      args: localMediaProbeArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        try {
          const args = localMediaProbeArgsSchema.parse(rawArgs);
          const filePath = resolveLocalFilePath(args.path, context);
          return asJsonText(await probeLocalMedia(filePath));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    openwork_file_search: {
      description: "Search local user/workspace files by name or Spotlight query without reading file contents. Returns path metadata only; use extract_text/preview/probe afterwards when needed.",
      args: localFileSearchArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        try {
          const args = localFileSearchArgsSchema.parse(rawArgs);
          return asJsonText(await searchLocalFiles(args, context));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    openwork_file_plan_batch: {
      description: "Preview safe batch file operations before changing anything. Supports copy, move, rename, and mkdir only. Delete is intentionally unsupported.",
      args: localFilePlanBatchArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        try {
          const args = localFilePlanBatchArgsSchema.parse(rawArgs);
          return asJsonText(await buildLocalFileBatchPlan(args.operations, context, args.baseDir));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    openwork_file_apply_batch: {
      description: "Apply a previously previewed safe batch file plan. Requires confirmed:true and either planId or operations. Supports copy, move, rename, and mkdir only.",
      args: localFileApplyBatchArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        try {
          const args = localFileApplyBatchArgsSchema.parse(rawArgs);
          if (args.confirmed !== true) {
            return asJsonText({ ok: false, error: "confirmed:true is required before changing files." });
          }
          const fromPlan = args.planId ? await readLocalFileBatchPlan(args.planId) : null;
          const operations = args.operations ?? fromPlan?.operations;
          if (!operations?.length) {
            return asJsonText({ ok: false, error: "Provide operations or a planId returned by openwork_file_plan_batch." });
          }
          return asJsonText(await applyLocalFileBatchPlan(operations, context, args.baseDir ?? fromPlan?.baseDir));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    openwork_file_open_directory: {
      description: "Open a local folder in Finder (macOS) or the system file manager. Use after downloading/exporting files so the user can review outputs. Paths may be absolute, ~/ paths, or workspace-relative.",
      args: localFileOpenDirectoryArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        try {
          const args = localFileOpenDirectoryArgsSchema.parse(rawArgs);
          const dirPath = resolveLocalFilePath(args.path, context);
          return asJsonText(await openLocalDirectory(dirPath));
        } catch (error) {
          return asJsonText({ ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      },
    },
    wodeapp_page_import_from_file: {
      description:
        "Import a local HTML file into a WodeApp page as CustomCode (file-first). Pass sourcePath only — the host reads the file and calls import-html. Prefer this over update_page with mega config. Then publish_project.",
      args: pageImportFromFileArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const parsed = pageImportFromFileArgsSchema.safeParse(rawArgs);
        if (!parsed.success) {
          return asJsonText({
            ok: false,
            recoverable: true,
            errorKind: "validation",
            error: parsed.error.message,
          });
        }
        try {
          return asJsonText(await importPageFromLocalHtmlFile(parsed.data, context));
        } catch (error) {
          return asJsonText({
            ok: false,
            recoverable: true,
            errorKind: "execution",
            error: error instanceof Error ? error.message : String(error),
            data: {
              code: "PAGE_IMPORT_FROM_FILE_FAILED",
              fallbackTool: "ai_generate_page",
            },
          });
        }
      },
    },
