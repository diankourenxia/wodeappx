import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ToolItemFailure } from "./openwork-tool-result.js";
import {
  assertReadToolAllowsPath,
  applyCompactionRequestKindHeader,
  applyHangTraceRequestHeaders,
  appendHangTraceJsonl,
  filterHangTraceJsonlLines,
  __resetHangTraceJsonlPruneForTest,
  buildReadMediaGateHooks,
  classifyReadMediaPath,
  extractReadPathFromArgs,
  isUnsafeToolAttachment,
  stripUnsafeToolAttachmentsFromMessages,
  WODEAPP_REQUEST_KIND_COMPACTION,
  WODEAPP_REQUEST_KIND_HEADER,
  WODEAPP_REQUEST_ID_HEADER,
  WODEAPP_SESSION_ID_HEADER,
  HANG_TRACE_JSONL_RETENTION_MS,
} from "./wodeapp-read-media-gate.js";

describe("wodeapp-read-media-gate", () => {
  test("classifies media paths for Codex-style redirects", () => {
    expect(classifyReadMediaPath("/tmp/quote.pdf")).toBe("pdf");
    expect(classifyReadMediaPath("bag.jpg")).toBe("image");
    expect(classifyReadMediaPath("sheet.xlsx")).toBe("office");
    expect(classifyReadMediaPath("clip.mp4")).toBe("media");
    expect(classifyReadMediaPath("notes.md")).toBe(null);
    expect(extractReadPathFromArgs({ filePath: "/a/b.pdf" })).toBe("/a/b.pdf");
    expect(extractReadPathFromArgs({ path: "/a/b.png" })).toBe("/a/b.png");
  });

  test("blocks OpenCode read on PDF/image with recoverable failure", () => {
    expect(() => assertReadToolAllowsPath("read", { path: "/tmp/quote.pdf" })).toThrow(ToolItemFailure);
    try {
      assertReadToolAllowsPath("read", { filePath: "/tmp/bag.jpg" });
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolItemFailure);
      const failure = error as ToolItemFailure;
      expect(failure.recoverable).toBe(true);
      expect(failure.message).toContain("openwork_media_view");
    }
    expect(() => assertReadToolAllowsPath("read", { path: "/tmp/notes.md" })).not.toThrow();
    expect(() => assertReadToolAllowsPath("bash", { path: "/tmp/quote.pdf" })).not.toThrow();
  });

  test("marks PDF and read-tool attachments unsafe for model path", () => {
    expect(isUnsafeToolAttachment({
      mime: "application/pdf",
      url: "data:application/pdf;base64,JVBERg==",
    }, "read")).toBe(true);
    expect(isUnsafeToolAttachment({
      mime: "image/png",
      url: "data:image/png;base64,aaaa",
    }, "read")).toBe(true);
    expect(isUnsafeToolAttachment({
      mime: "image/jpeg",
      url: "data:image/jpeg;base64,bbbb",
    }, "image_inspect")).toBe(false);
    expect(isUnsafeToolAttachment({
      mime: "application/pdf",
      url: "data:application/pdf;base64,JVBERg==",
    }, "image_inspect")).toBe(true);
  });

  test("messages.transform strips PDF attachment from read before model call", async () => {
    const hooks = buildReadMediaGateHooks();
    const messages = [{
      info: { role: "assistant", id: "msg_1" },
      parts: [{
        id: "prt_1",
        type: "tool",
        tool: "read",
        callID: "call_1",
        state: {
          status: "completed",
          output: "PDF read successfully",
          attachments: [{
            type: "file",
            mime: "application/pdf",
            url: "data:application/pdf;base64,JVBERi0xLjQK",
          }],
        },
      }],
    }];
    await hooks["experimental.chat.messages.transform"]({}, { messages });
    const state = (messages[0].parts[0] as { state: Record<string, unknown> }).state;
    expect(state.attachments).toEqual([]);
    expect(String(state.output)).toContain("WodeApp stripped unsafe tool attachment");
    expect((state.metadata as { wodeappUnsafeAttachmentStripped?: boolean }).wodeappUnsafeAttachmentStripped).toBe(true);
  });

  test("strip helper keeps tool-produced image attachments", () => {
    const messages = [{
      parts: [{
        type: "tool",
        tool: "wodeappx_browser_screenshot",
        state: {
          status: "completed",
          output: "ok",
          attachments: [{
            mime: "image/jpeg",
            url: "data:image/jpeg;base64,bbbb",
          }],
        },
      }],
    }];
    const result = stripUnsafeToolAttachmentsFromMessages(messages);
    expect(result.stripped).toBe(0);
    expect((messages[0].parts![0] as { state: { attachments: unknown[] } }).state.attachments).toHaveLength(1);
  });

  test("chat.headers marks compaction requests for aiProxy gate", async () => {
    const hooks = buildReadMediaGateHooks();
    const compactionHeaders: Record<string, string> = {};
    await hooks["chat.headers"](
      { agent: "compaction", sessionID: "ses_1" },
      { headers: compactionHeaders },
    );
    expect(compactionHeaders[WODEAPP_REQUEST_KIND_HEADER]).toBe(WODEAPP_REQUEST_KIND_COMPACTION);
    expect(compactionHeaders[WODEAPP_SESSION_ID_HEADER]).toBe("ses_1");

    const normalHeaders: Record<string, string> = { "X-Keep": "1" };
    await hooks["chat.headers"](
      { agent: "build", sessionID: "ses_1" },
      { headers: normalHeaders },
    );
    expect(normalHeaders).toEqual({
      "X-Keep": "1",
      [WODEAPP_SESSION_ID_HEADER]: "ses_1",
    });

    const output = { headers: {} as Record<string, string> };
    applyHangTraceRequestHeaders({ agent: "compaction", sessionID: "ses_2" }, output);
    expect(output.headers[WODEAPP_REQUEST_KIND_HEADER]).toBe("compaction");
    expect(output.headers[WODEAPP_SESSION_ID_HEADER]).toBe("ses_2");
    applyCompactionRequestKindHeader({ agent: "compaction" }, output);
    expect(output.headers[WODEAPP_REQUEST_KIND_HEADER]).toBe("compaction");
  });

  test("chat.headers correlates WodeApp turns without leaking ids to direct providers", async () => {
    const hooks = buildReadMediaGateHooks();
    const wodeHeaders: Record<string, string> = {};
    await hooks["chat.headers"](
      {
        agent: "build",
        sessionID: "ses_trace_1",
        message: { id: "msg_trace_1" },
        provider: { id: "wodeapp" },
      },
      { headers: wodeHeaders },
    );
    expect(wodeHeaders[WODEAPP_SESSION_ID_HEADER]).toBe("ses_trace_1");
    expect(wodeHeaders[WODEAPP_REQUEST_ID_HEADER]).toBe("msg_trace_1");

    const directHeaders: Record<string, string> = {};
    await hooks["chat.headers"](
      {
        agent: "build",
        sessionID: "ses_direct_1",
        message: { id: "msg_direct_1" },
        provider: { id: "openai" },
      },
      { headers: directHeaders },
    );
    expect(directHeaders[WODEAPP_SESSION_ID_HEADER]).toBe("ses_direct_1");
    expect(directHeaders[WODEAPP_REQUEST_ID_HEADER]).toBeUndefined();
  });

  test("hang-trace jsonl filter drops lines older than retention", () => {
    const now = Date.parse("2026-08-04T12:00:00.000Z");
    const oldAt = new Date(now - HANG_TRACE_JSONL_RETENTION_MS - 86_400_000).toISOString();
    const freshAt = new Date(now - 60_000).toISOString();
    const content = [
      JSON.stringify({ at: oldAt, tag: "old" }),
      JSON.stringify({ at: freshAt, tag: "fresh" }),
      "{not-json",
      "",
    ].join("\n");
    const filtered = filterHangTraceJsonlLines(content, { now });
    expect(filtered.removed).toBe(1);
    expect(filtered.total).toBe(3);
    expect(filtered.kept).toContain('"tag":"fresh"');
    expect(filtered.kept).toContain("{not-json");
    expect(filtered.kept).not.toContain('"tag":"old"');
  });

  test("appendHangTraceJsonl prunes aged rows when forced", () => {
    __resetHangTraceJsonlPruneForTest();
    const now = Date.parse("2026-08-04T12:00:00.000Z");
    const oldAt = new Date(now - HANG_TRACE_JSONL_RETENTION_MS - 86_400_000).toISOString();
    let stored = `${JSON.stringify({ at: oldAt, tag: "old" })}\n`;
    const memFs = {
      appendFileSync: (_path: string, data: string) => {
        stored += data;
      },
      existsSync: () => true,
      readFileSync: () => stored,
      writeFileSync: (_path: string, data: string) => {
        stored = data;
      },
      statSync: () => ({ size: Buffer.byteLength(stored, "utf8") }),
    };
    const result = appendHangTraceJsonl(
      { tag: "fresh", at: new Date(now).toISOString() },
      { fs: memFs, now, forcePrune: true, path: "/tmp/fake-hang-trace.jsonl" },
    );
    expect(result.pruned).toBe(1);
    expect(stored).toContain('"tag":"fresh"');
    expect(stored).not.toContain('"tag":"old"');
  });

  test("compaction writes a private transcript artifact and preserves bounded recovery instructions", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "wodeapp-compact-history-"));
    try {
      const hooks = buildReadMediaGateHooks({
        artifactRoot,
        loadSessionMessages: async () => [{
          info: { id: "msg_1", role: "user", authorization: "Bearer hidden-token" },
          parts: [{ type: "text", text: "The exact approval owner is Lin." }],
        }],
      });
      const output = { context: [] as string[] };
      await hooks["experimental.session.compacting"](
        { sessionID: "ses_compact_1" },
        output,
      );

      expect(output.context).toHaveLength(1);
      expect(output.context[0]).toContain("Recoverable history artifact");
      expect(output.context[0]).toContain("Search first with grep/rg");
      expect(output.context[0]).toContain("Never cat or read the entire artifact");

      const sessionDirectories = await readdir(artifactRoot);
      expect(sessionDirectories).toHaveLength(1);
      const transcriptPath = join(artifactRoot, sessionDirectories[0], "transcript.jsonl");
      const transcript = await readFile(transcriptPath, "utf8");
      expect((await stat(transcriptPath)).mode & 0o777).toBe(0o600);
      expect(transcript).toContain("The exact approval owner is Lin.");
      expect(transcript).toContain('"authorization":"[REDACTED]"');
      expect(transcript).not.toContain("hidden-token");
    } finally {
      await rm(artifactRoot, { recursive: true, force: true });
    }
  });
});
