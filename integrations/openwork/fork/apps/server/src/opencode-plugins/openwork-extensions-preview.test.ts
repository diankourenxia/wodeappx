import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  buildBoundedPdfTextWindow,
  discoverUiBridge,
  OpenWorkExtensionsPreview,
  wrapToolDefinitionsWithContract,
} from "./openwork-extensions-preview.js";
import { parseToolItemFailureTag } from "./openwork-tool-result.js";
import {
  WODEAPP_DIRECT_ACTION_CONTRACT_BY_ACTION_ID,
  directActionInputSchemaToRendererArgs,
} from "./wodeapp-direct-action-contracts.js";
import {
  clearXlsExtractionGateForTests,
  xlsExtractionGateSnapshot,
} from "./wodeapp-xls-save-gate.js";

describe("OpenWork extension registration contract", () => {
  test("publishes OpenCode v1 default export so helpers are not loaded as plugins", async () => {
    const mod = await import("./openwork-extensions-preview.js");
    expect(mod.default).toEqual({
      id: "openwork-extensions-preview",
      server: OpenWorkExtensionsPreview,
    });
  });

  test("registers visible Codex-style PDF inspection tools", async () => {
    const plugin = await OpenWorkExtensionsPreview();

    expect(plugin.tool.openwork_attachment_context_read).toBeDefined();
    expect(plugin.tool.openwork_pdf_info).toBeDefined();
    expect(plugin.tool.openwork_pdf_extract_text).toBeDefined();
    expect(plugin.tool.openwork_pdf_render_pages).toBeDefined();
    expect(plugin.tool.openwork_pdf_extract_text.description).toContain("Defaults to five pages");
    expect(plugin.tool.openwork_pdf_extract_text.description).toContain("nextStartPage");
  });

  test("wires the OpenCode session client into compact-history artifacts", async () => {
    const sessionID = `ses_compact_client_${Date.now()}`;
    const plugin = await OpenWorkExtensionsPreview({
      client: {
        session: {
          messages: async ({ path }) => ({
            data: [{
              info: { id: "msg_client_1", role: "user" },
              parts: [{ type: "text", text: `Exact client-loaded detail for ${path.id}.` }],
            }],
          }),
        },
      },
    });
    const output = { context: [] as string[] };
    await plugin["experimental.session.compacting"]({ sessionID }, output);

    const pathLiteral = /path=("(?:[^"\\]|\\.)*") bytes=/.exec(output.context[0] || "")?.[1];
    expect(pathLiteral).toBeDefined();
    const transcriptPath = JSON.parse(pathLiteral || '""') as string;
    try {
      expect(await readFile(transcriptPath, "utf8")).toContain(
        `Exact client-loaded detail for ${sessionID}.`,
      );
    } finally {
      if (transcriptPath) {
        await rm(dirname(transcriptPath), { recursive: true, force: true });
      }
    }
  });

  test("reads attachment context in bounded resumable windows", async () => {
    const refId = `ctx_test_${Date.now()}_read`;
    const packDir = join(homedir(), ".wodeappx", "attachment-context-packs", refId);
    await mkdir(packDir, { recursive: true });
    await writeFile(join(packDir, "manifest.json"), JSON.stringify({
      version: 1,
      refId,
      contextPackId: "pack_test",
      createdAt: new Date().toISOString(),
      context: "a".repeat(1_500),
      sources: [{ label: "对话上传", filename: "brief.pdf" }],
      uploadedUrls: [],
      files: [{
        filename: "reference.png",
        mime: "image/png",
        path: join(packDir, "reference.png"),
        sizeBytes: 12,
      }],
    }));

    try {
      const plugin = await OpenWorkExtensionsPreview();
      const execute = plugin.tool.openwork_attachment_context_read.execute as (
        args: unknown,
        context: unknown,
      ) => Promise<string>;
      const first = JSON.parse(await execute({
        refId,
        maxChars: 1_000,
      }, {})) as {
        data: {
          text: string;
          hasMore: boolean;
          nextOffset: number;
          files: Array<{ path: string }>;
        };
      };
      expect(first.data.text).toHaveLength(1_000);
      expect(first.data.hasMore).toBe(true);
      expect(first.data.nextOffset).toBe(1_000);
      expect(first.data.files[0]?.path).toBe(join(packDir, "reference.png"));

      const second = JSON.parse(await execute({
        refId,
        offset: first.data.nextOffset,
        maxChars: 1_000,
      }, {})) as { data: { text: string; hasMore: boolean; nextOffset: null } };
      expect(second.data.text).toHaveLength(500);
      expect(second.data.hasMore).toBe(false);
      expect(second.data.nextOffset).toBeNull();
    } finally {
      await rm(packDir, { recursive: true, force: true });
    }
  });

  test("continues an oversized PDF page without skipping truncated text", () => {
    const source = "规格参数与说明。".repeat(220);
    let startChar = 0;
    let reconstructed = "";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = buildBoundedPdfTextWindow({
        pages: [{ page: 1, text: source }],
        pageCount: 1,
        startPage: 1,
        startChar,
        maxChars: 1_000,
      });
      reconstructed += result.text.slice(result.text.indexOf("\n") + 1);
      if (!result.hasMorePages) break;
      expect(result.nextStartPage).toBe(1);
      expect(result.nextStartChar).toBeGreaterThan(startChar);
      startChar = result.nextStartChar ?? startChar;
    }
    expect(reconstructed).toBe(source);
  });

  test("continues to the next PDF page after a complete five-page window", () => {
    const result = buildBoundedPdfTextWindow({
      pages: Array.from({ length: 5 }, (_, index) => ({
        page: index + 1,
        text: `page-${index + 1}`,
      })),
      pageCount: 6,
      startPage: 1,
      maxChars: 20_000,
    });
    expect(result).toMatchObject({
      hasMorePages: true,
      nextStartPage: 6,
      nextStartChar: 0,
      truncated: false,
    });
  });

  test("reads a long plain-text file in bounded resumable windows", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wodeappx-file-read-"));
    const filePath = join(directory, "long.txt");
    const source = "abcdefghijklmnopqrstuvwxyz".repeat(100);
    await writeFile(filePath, source);
    try {
      const plugin = await OpenWorkExtensionsPreview();
      const execute = plugin.tool.openwork_file_extract_text.execute as (
        args: unknown,
        context: unknown,
      ) => Promise<string>;
      const first = JSON.parse(await execute({
        path: filePath,
        maxChars: 1_000,
      }, { directory })) as {
        text: string;
        hasMore: boolean;
        nextOffset: number;
      };
      expect(first.text).toHaveLength(1_000);
      expect(first.hasMore).toBe(true);
      expect(first.nextOffset).toBe(1_000);

      const second = JSON.parse(await execute({
        path: filePath,
        offset: first.nextOffset,
        maxChars: 1_000,
      }, { directory })) as {
        text: string;
        hasMore: boolean;
        nextOffset: number;
      };
      const third = JSON.parse(await execute({
        path: filePath,
        offset: second.nextOffset,
        maxChars: 1_000,
      }, { directory })) as {
        text: string;
        hasMore: boolean;
        nextOffset: null;
      };

      expect(first.text + second.text + third.text).toBe(source);
      expect(third.hasMore).toBe(false);
      expect(third.nextOffset).toBeNull();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("routes PDFs away from the generic text reader as a recoverable failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wodeappx-pdf-route-"));
    const filePath = join(directory, "sample.pdf");
    await writeFile(filePath, "%PDF-1.4\n");
    try {
      const plugin = await OpenWorkExtensionsPreview();
      const execute = plugin.tool.openwork_file_extract_text.execute as (
        args: unknown,
        context: unknown,
      ) => Promise<unknown>;
      let thrown: unknown;
      try {
        await execute({ path: filePath }, { directory });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(parseToolItemFailureTag((thrown as Error).message)).toEqual({
        recoverable: true,
        errorKind: "validation",
      });
      expect((thrown as Error & { data?: { fallbackTool?: string } }).data?.fallbackTool).toBe("openwork_pdf_info");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("reads a BIFF8 .xls workbook with sheet/row/cell evidence", async () => {
    clearXlsExtractionGateForTests();
    const XLSX = await import("xlsx");
    const directory = await mkdtemp(join(tmpdir(), "wodeappx-xls-ok-"));
    const filePath = join(directory, "wodeappx-local-xls-product-import.xls");
    const toolContext = {
      directory,
      sessionID: "ses_xls_success",
      messageID: "msg_xls_success",
    };
    const workbook = XLSX.utils.book_new();
    for (const [name, code] of [
      ["精油短袜", "SOCK-ANKLE-731"],
      ["精油商务中筒袜", "SOCK-BUSINESS-842"],
      ["精油中筒袜", "SOCK-MID-953"],
    ] as const) {
      const rows: string[][] = [
        ["字段", "值"],
        ["产品线", name],
        ["校验码", code],
        ["画幅", "9:16"],
        ["分辨率", "1080p"],
        ["帧率", "60"],
        ["字幕", "是"],
        ["格式", "MP4"],
        ["宣传语", "柔软舒适一整天"],
        ["硬参数", "精油含量 1.2%"],
      ];
      for (let index = 0; index < 80; index += 1) {
        rows.push([`扩展行${index}`, `DETAIL-${code}-${index}`]);
      }
      const sheet = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(workbook, sheet, name);
    }
    await writeFile(filePath, XLSX.write(workbook, { bookType: "biff8", type: "buffer" }));

    try {
      const plugin = await OpenWorkExtensionsPreview();
      expect(plugin.tool.openwork_runtime_status).toBeDefined();
      const statusRaw = await (plugin.tool.openwork_runtime_status.execute as () => Promise<string>)();
      const status = JSON.parse(statusRaw) as {
        ok: boolean;
        data: { fileExtract: { xls: { available: boolean; backend: string; sofficeRequired: boolean } } };
      };
      expect(status.ok).toBe(true);
      expect(status.data.fileExtract.xls).toMatchObject({
        available: true,
        backend: "sheetjs-biff8",
        sofficeRequired: false,
      });

      const execute = plugin.tool.openwork_file_extract_text.execute as (
        args: unknown,
        context: unknown,
      ) => Promise<string>;
      const first = JSON.parse(await execute({ path: filePath, maxChars: 1_000 }, toolContext)) as {
        ok: boolean;
        source: string;
        text: string;
        hasMore: boolean;
        nextOffset: number | null;
        productSaveAllowed?: boolean;
        evidenceIncluded?: boolean;
        evidence: {
          format: string;
          backend: string;
          sheetCount: number;
          totalNonEmptyCellCount: number;
          returnedCellCount: number;
          truncated: boolean;
          sheets: Array<{ name: string; cells: Array<{ value: string }> }>;
        };
      };
      expect(first.ok).toBe(true);
      expect(first.source).toBe("xls:sheetjs-biff8");
      expect(first.productSaveAllowed).toBe(true);
      expect(first.evidenceIncluded).toBe(true);
      expect(first.evidence.format).toBe("biff8");
      expect(first.evidence.backend).toBe("sheetjs-biff8");
      expect(first.evidence.sheetCount).toBe(3);
      expect(first.evidence.totalNonEmptyCellCount).toBeGreaterThan(240);
      expect(first.evidence.returnedCellCount).toBe(240);
      expect(first.evidence.truncated).toBe(true);
      expect(first.evidence.sheets.map((sheet) => sheet.name)).toEqual([
        "精油短袜",
        "精油商务中筒袜",
        "精油中筒袜",
      ]);
      const allCellValues = first.evidence.sheets.flatMap((sheet) => sheet.cells.map((cell) => cell.value));
      expect(allCellValues).toContain("SOCK-ANKLE-731");
      expect(allCellValues).toContain("SOCK-BUSINESS-842");
      expect(allCellValues).toContain("SOCK-MID-953");
      expect(first.hasMore).toBe(true);
      expect(typeof first.nextOffset).toBe("number");
      expect(xlsExtractionGateSnapshot(toolContext)).toEqual({
        tracked: 1,
        blocked: 0,
        allowed: 1,
      });

      const second = JSON.parse(await execute({
        path: filePath,
        offset: first.nextOffset,
        maxChars: 20_000,
      }, toolContext)) as {
        ok: boolean;
        text: string;
        hasMore: boolean;
        evidence?: unknown;
        evidenceIncluded?: boolean;
      };
      expect(second.ok).toBe(true);
      expect(second.evidence).toBeUndefined();
      expect(second.evidenceIncluded).toBe(false);
      expect(`${first.text}${second.text}`).toContain("SOCK-MID-953");
      expect(`${first.text}${second.text}`).toContain("硬参数");
    } finally {
      clearXlsExtractionGateForTests();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("rejects corrupt oversized and disguised .xls files without inventing rows", async () => {
    clearXlsExtractionGateForTests();
    const directory = await mkdtemp(join(tmpdir(), "wodeappx-xls-fail-"));
    const toolContext = {
      directory,
      sessionID: "ses_xls_failure",
      messageID: "msg_xls_failure",
    };
    try {
      const plugin = await OpenWorkExtensionsPreview();
      const execute = plugin.tool.openwork_file_extract_text.execute as (
        args: unknown,
        context: unknown,
      ) => Promise<unknown>;

      const corruptPath = join(directory, "corrupt.xls");
      await writeFile(corruptPath, "not-a-workbook");
      let corruptThrown: unknown;
      try {
        await execute({ path: corruptPath }, toolContext);
      } catch (error) {
        corruptThrown = error;
      }
      expect(corruptThrown).toBeInstanceOf(Error);
      expect(parseToolItemFailureTag((corruptThrown as Error).message)).toEqual({
        recoverable: true,
        errorKind: "validation",
      });
      expect((corruptThrown as Error & { data?: { code?: string; productSaveAllowed?: boolean } }).data).toMatchObject({
        code: "XLS_CORRUPT",
        productSaveAllowed: false,
      });
      expect((corruptThrown as Error).message).not.toContain("SOCK-");

      const disguisedPath = join(directory, "disguised.xls");
      await writeFile(disguisedPath, Buffer.from("PK\u0003\u0004fake-zip-payload"));
      let disguisedThrown: unknown;
      try {
        await execute({ path: disguisedPath }, toolContext);
      } catch (error) {
        disguisedThrown = error;
      }
      expect((disguisedThrown as Error & { data?: { code?: string } }).data?.code).toBe("XLS_NOT_BIFF8");

      const oversizedPath = join(directory, "huge.xls");
      const { openSync, closeSync, ftruncateSync, writeSync } = await import("node:fs");
      const fd = openSync(oversizedPath, "w");
      try {
        writeSync(fd, Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]));
        ftruncateSync(fd, 40 * 1024 * 1024 + 1);
      } finally {
        closeSync(fd);
      }
      let oversizedThrown: unknown;
      try {
        await execute({ path: oversizedPath }, toolContext);
      } catch (error) {
        oversizedThrown = error;
      }
      expect((oversizedThrown as Error & { data?: { code?: string; productSaveAllowed?: boolean } }).data).toMatchObject({
        code: "XLS_TOO_LARGE",
        productSaveAllowed: false,
      });

      const missingPath = join(directory, "missing.xls");
      let missingThrown: unknown;
      try {
        await execute({ path: missingPath }, toolContext);
      } catch (error) {
        missingThrown = error;
      }
      expect((missingThrown as Error & { data?: { code?: string; productSaveAllowed?: boolean } }).data).toMatchObject({
        code: "XLS_READ_FAILED",
        productSaveAllowed: false,
      });
      expect(xlsExtractionGateSnapshot(toolContext)).toEqual({
        tracked: 4,
        blocked: 4,
        allowed: 0,
      });

      let saveThrown: unknown;
      try {
        const productSave = (plugin.tool as unknown as Record<
          string,
          { execute: (args: unknown, context: unknown) => Promise<unknown> }
        >).wodeapp_product_save;
        await productSave.execute({ name: "不应保存的商品" }, toolContext);
      } catch (error) {
        saveThrown = error;
      }
      expect(saveThrown).toBeInstanceOf(Error);
      expect(saveThrown).toMatchObject({
        recoverable: true,
        errorKind: "validation",
        data: {
          code: "XLS_PRODUCT_SAVE_BLOCKED",
          productSaveAllowed: false,
        },
      });
    } finally {
      clearXlsExtractionGateForTests();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("marks a missing attachment context as a recoverable tool failure", async () => {
    const plugin = await OpenWorkExtensionsPreview();
    const execute = plugin.tool.openwork_attachment_context_read.execute as (
      args: unknown,
      context: unknown,
    ) => Promise<unknown>;
    let thrown: unknown;
    try {
      await execute({ refId: "ctx_missing_attachment_1234" }, {});
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(parseToolItemFailureTag((thrown as Error).message)).toEqual({
      recoverable: true,
      errorKind: "execution",
    });
  });

  test("registers local atomic video tools and resolves Douyin modal ids without extraction", async () => {
    const plugin = await OpenWorkExtensionsPreview();

    expect(plugin.tool.video_resolve_link).toBeDefined();
    expect(plugin.tool.video_extract_metadata).toBeDefined();

    const execute = plugin.tool.video_resolve_link.execute as (args: unknown, context: unknown) => Promise<string>;
    const raw = await execute({
      input: "https://www.douyin.com/jingxuan?modal_id=7649696609795077818",
    }, {});
    const result = JSON.parse(raw) as Record<string, unknown>;

    expect(result).toMatchObject({
      ok: true,
      executor: "local",
      stage: "resolve_link",
      platform: "douyin",
      videoId: "7649696609795077818",
      canonicalUrl: "https://www.douyin.com/video/7649696609795077818",
    });
  });

  test("upgrades JSON soft failures at the shared execute boundary", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const definitions = wrapToolDefinitionsWithContract({
      soft_failure: {
        description: "test",
        async execute() {
          return JSON.stringify({ ok: false, error: "bridge unavailable" });
        },
      },
    });

    let thrown: unknown;
    try {
      const execute = definitions.soft_failure.execute as (args: unknown, context: unknown) => Promise<unknown>;
      await execute({}, {
        metadata(input: Record<string, unknown>) {
          writes.push(input);
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(parseToolItemFailureTag((thrown as Error).message)).toEqual({
      recoverable: false,
      errorKind: "execution",
    });
    expect(writes[0]).toMatchObject({
      metadata: {
        wodeappxFailure: {
          status: "failed",
          recoverable: false,
          errorKind: "execution",
          message: "bridge unavailable",
        },
      },
    });
  });

  test("preserves successful results and arguments", async () => {
    const success = { ok: true, value: 42 };
    const definitions = wrapToolDefinitionsWithContract({
      success: {
        async execute(args: unknown) {
          expect(args).toEqual({ input: "kept" });
          return success;
        },
      },
    });

    const execute = definitions.success.execute as (args: unknown, context: unknown) => Promise<unknown>;
    await expect(execute({ input: "kept" }, {})).resolves.toBe(success);
  });

  test("simulates Codex-style resolution before a business tool reaches the UI bridge", async () => {
    const product = WODEAPP_DIRECT_ACTION_CONTRACT_BY_ACTION_ID.get("wodeapp.product.save");
    if (!product) throw new Error("Product direct action contract is missing.");

    const executeBodies: unknown[] = [];
    const server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/health") {
          return Response.json({ ok: true, app: "test", version: 1 });
        }
        if (url.pathname === "/actions") {
          return Response.json({
            ok: true,
            actions: [
              {
                id: product.actionId,
                label: product.label,
                effect: product.effect,
                approval: product.approval,
                args: directActionInputSchemaToRendererArgs(product.inputSchema),
              },
              {
                id: "settings.panel.open",
                label: "打开设置",
                effect: "read",
                approval: "auto",
                args: [{ name: "panel", type: "string", required: true }],
              },
            ],
          });
        }
        if (url.pathname === "/execute") {
          const body = await request.json();
          executeBodies.push(body);
          return Response.json({ ok: true, result: { assetId: "product-test" } });
        }
        return new Response("Not found", { status: 404 });
      },
    });
    const dir = await mkdtemp(join(tmpdir(), "wodeappx-tool-resolution-"));
    const discovery = join(dir, "ui-control.json");
    await writeFile(discovery, JSON.stringify({
      baseUrl: `http://127.0.0.1:${server.port}`,
      token: "test-token",
    }));
    const previousDiscovery = process.env.OPENWORK_UI_CONTROL_DISCOVERY;
    process.env.OPENWORK_UI_CONTROL_DISCOVERY = discovery;

    try {
      const plugin = await OpenWorkExtensionsPreview();
      const tools = plugin.tool as unknown as Record<string, {
        args: Record<string, unknown>;
        execute: (args: unknown, context: unknown) => Promise<unknown>;
      }>;
      expect(tools.wodeapp_product_save).toBeDefined();
      expect(tools.wodeapp_product_save.args.actionId).toBeUndefined();

      const definitionHook = plugin["tool.definition"] as (
        input: { toolID: string },
        output: { description: string; jsonSchema?: unknown },
      ) => Promise<void>;
      const directOutput: { description: string; jsonSchema?: unknown } = { description: "" };
      await definitionHook({ toolID: "wodeapp_product_save" }, directOutput);
      expect(directOutput.jsonSchema).toMatchObject({
        type: "object",
        required: ["name"],
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1 },
          assetFiles: {
            type: "array",
            items: {
              required: ["url", "name", "type"],
              additionalProperties: false,
            },
          },
        },
      });
      expect((directOutput.jsonSchema as { properties?: Record<string, unknown> }).properties?.actionId)
        .toBeUndefined();

      const deleteOutput: { description: string; jsonSchema?: unknown } = { description: "" };
      await definitionHook({ toolID: "wodeapp_assets_delete" }, deleteOutput);
      expect(deleteOutput.jsonSchema).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
      expect((deleteOutput.jsonSchema as { anyOf?: unknown }).anyOf).toBeUndefined();
      expect((deleteOutput.jsonSchema as { oneOf?: unknown }).oneOf).toBeUndefined();
      expect(String((deleteOutput.jsonSchema as { description?: string }).description || "")).toContain("assetId");

      const output: { description: string; jsonSchema?: unknown } = { description: "" };
      await definitionHook({ toolID: "openwork_ui_execute_action" }, output);
      const schema = output.jsonSchema as {
        properties?: { actionId?: { enum?: string[] } };
      };
      expect(schema.properties?.actionId?.enum).toEqual(["settings.panel.open"]);

      await expect(tools.openwork_ui_execute_action.execute({
        actionId: "wodeapp.assets.update",
        args: {},
      }, {})).rejects.toThrow(/not model-visible/);
      expect(executeBodies).toHaveLength(0);

      await tools.wodeapp_product_save.execute({ name: "真人测试商品" }, {});
      expect(executeBodies).toEqual([{
        actionId: "wodeapp.product.save",
        args: { name: "真人测试商品" },
      }]);
    } finally {
      if (previousDiscovery === undefined) delete process.env.OPENWORK_UI_CONTROL_DISCOVERY;
      else process.env.OPENWORK_UI_CONTROL_DISCOVERY = previousDiscovery;
      server.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("UI bridge discovery self-heal", () => {
  test("skips dead discovery ports and picks a healthy bridge", async () => {
    const healthy = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const url = new URL(request.url);
        if (url.pathname === "/health") return Response.json({ ok: true });
        return new Response("missing", { status: 404 });
      },
    });
    const dir = await mkdtemp(join(tmpdir(), "wodeappx-bridge-heal-"));
    const deadDiscovery = join(dir, "dead.json");
    const liveDiscovery = join(dir, "live.json");
    await writeFile(deadDiscovery, JSON.stringify({
      baseUrl: "http://127.0.0.1:1",
      token: "dead-token",
    }));
    await writeFile(liveDiscovery, JSON.stringify({
      baseUrl: `http://127.0.0.1:${healthy.port}`,
      token: "live-token",
    }));
    try {
      const bridge = await discoverUiBridge({
        force: true,
        requireHealthy: true,
        discoveryPaths: [deadDiscovery, liveDiscovery],
      });
      expect(bridge).toEqual({
        baseUrl: `http://127.0.0.1:${healthy.port}`,
        token: "live-token",
      });
    } finally {
      healthy.stop(true);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
