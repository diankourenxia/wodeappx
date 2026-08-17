import { describe, expect, test } from "bun:test";

import {
  ToolItemFailure,
  asToolResultJson,
  assertToolResultSucceeded,
  createToolItemFailure,
  executeWithContract,
  failurePayloadFromTaggedMessage,
  failureFromStructuredResult,
  finalizeUiBridgeError,
  formatToolItemFailureMessage,
  normalizeToolError,
  parseToolItemFailureTag,
  publishToolItemFailure,
} from "./openwork-tool-result.js";

describe("OpenWork custom tool result contract", () => {
  test("preserves successful structured results", () => {
    const result = { ok: true, value: 42 };

    expect(assertToolResultSucceeded(result)).toBe(result);
    expect(JSON.parse(asToolResultJson(result))).toEqual(result);
  });

  test.each([
    [{ ok: false, error: "file not found" }, "file not found"],
    [{ success: false, message: "request rejected" }, "request rejected"],
    [{ isError: true, error: { message: "MCP failed" } }, "MCP failed"],
    [{ is_error: true }, "Tool execution failed."],
  ] as const)("turns an explicit failure result into a thrown tool error", (result, message) => {
    expect(() => assertToolResultSucceeded(result)).toThrow(ToolItemFailure);
    expect(() => assertToolResultSucceeded(result)).toThrow(message);
    expect(() => asToolResultJson(result)).toThrow(message);
  });

  test("does not guess failure from ordinary domain data", () => {
    const result = { status: "error", message: "a search result can contain these words" };

    expect(assertToolResultSucceeded(result)).toBe(result);
  });

  test("maps legacy shouldContinue JSON strings to recoverable Item failures", () => {
    const failure = failureFromStructuredResult(JSON.stringify({
      success: false,
      output: "请提供 scopeRoot",
      shouldContinue: true,
      data: { matches: [{ workdir: "/a" }] },
    }));

    expect(failure).toBeInstanceOf(ToolItemFailure);
    expect(failure?.status).toBe("failed");
    expect(failure?.recoverable).toBe(true);
    expect(failure?.errorKind).toBe("ambiguous");
    expect(failure?.message).toContain("scopeRoot");
    expect(failure?.toPayload()).toMatchObject({
      status: "failed",
      recoverable: true,
      errorKind: "ambiguous",
    });
  });

  test("publishToolItemFailure writes wodeappxFailure metadata and tags the error string", async () => {
    const writes: Array<Record<string, unknown>> = [];
    const failure = createToolItemFailure({
      message: "参数不合法",
      recoverable: true,
      errorKind: "validation",
    });

    const published = await publishToolItemFailure({
      metadata(input: { title?: string; metadata?: Record<string, unknown> }) {
        writes.push(input as Record<string, unknown>);
      },
    }, failure);

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      title: "Recoverable tool failure",
      metadata: {
        wodeappxFailure: {
          status: "failed",
          recoverable: true,
          errorKind: "validation",
          message: "参数不合法",
        },
      },
    });
    expect(published.message).toBe(formatToolItemFailureMessage(failure));
    expect(parseToolItemFailureTag(published.message)).toEqual({
      recoverable: true,
      errorKind: "validation",
    });
  });

  test("executeWithContract upgrades soft failures through metadata + tagged throw", async () => {
    const writes: Array<Record<string, unknown>> = [];

    await expect(executeWithContract(async () => ({
      success: false,
      output: "参数不合法",
      shouldContinue: true,
    }), {}, {
      metadata(input: { title?: string; metadata?: Record<string, unknown> }) {
        writes.push(input as Record<string, unknown>);
      },
    })).rejects.toMatchObject({
      name: "ToolItemFailure",
      recoverable: true,
      errorKind: "validation",
    });

    expect(writes[0]?.metadata).toMatchObject({
      wodeappxFailure: {
        status: "failed",
        recoverable: true,
        errorKind: "validation",
        message: "参数不合法",
      },
    });
  });

  test("rebuilds durable Item failure metadata from the stable error tag", () => {
    expect(failurePayloadFromTaggedMessage(
      "[wodeappxFailure recoverable=true errorKind=validation] 参数不合法",
    )).toEqual({
      status: "failed",
      recoverable: true,
      errorKind: "validation",
      message: "参数不合法",
    });
    expect(failurePayloadFromTaggedMessage("ordinary tool failure")).toBeNull();
  });

  test("validation_failed UI-bridge payloads stay recoverable without an explicit flag", () => {
    const failure = failureFromStructuredResult({
      ok: false,
      code: "validation_failed",
      error: "商品图片最多保存 12 张，当前解析到 25 张；未执行静默截断，商品未保存。",
    });
    expect(failure).toMatchObject({
      name: "ToolItemFailure",
      recoverable: true,
      errorKind: "validation",
      message: "商品图片最多保存 12 张，当前解析到 25 张；未执行静默截断，商品未保存。",
    });
  });

  test("non-recoverable execution failures normalize without success wrapping", () => {
    const failure = normalizeToolError(new Error("disk full"));
    expect(failure.status).toBe("failed");
    expect(failure.recoverable).toBe(false);
    expect(failure.errorKind).toBe("execution");
    expect(failure.message).toBe("disk full");
  });

  test("storyboard scenes_prompt_required stays recoverable without explicit recoverable flag", () => {
    const failure = failureFromStructuredResult({
      ok: false,
      error: "scenes received 7 item(s) but none had a usable prompt.",
      status: "scenes_prompt_required",
      code: "validation_failed",
      errorKind: "validation",
    });
    expect(failure).toBeInstanceOf(ToolItemFailure);
    expect(failure?.recoverable).toBe(true);
    expect(failure?.errorKind).toBe("validation");
  });

  test("finalizeUiBridgeError rethrows ToolItemFailure without wrapping", () => {
    const original = createToolItemFailure({
      message: "scenes is required: every scene needs a complete prompt.",
      recoverable: true,
      errorKind: "validation",
    });
    try {
      finalizeUiBridgeError(original);
      throw new Error("expected finalizeUiBridgeError to throw");
    } catch (error) {
      expect(error).toBe(original);
      expect(error).toBeInstanceOf(ToolItemFailure);
      expect((error as ToolItemFailure).recoverable).toBe(true);
      expect((error as ToolItemFailure).errorKind).toBe("validation");
    }
  });

  test("finalizeUiBridgeError maps bridge-down to recoverable dependency", () => {
    try {
      finalizeUiBridgeError(new Error("WodeAppX UI bridge not available. The desktop app may not be running or its control port is stale."));
      throw new Error("expected finalizeUiBridgeError to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ToolItemFailure);
      expect((error as ToolItemFailure).recoverable).toBe(true);
      expect((error as ToolItemFailure).errorKind).toBe("dependency");
      expect((error as ToolItemFailure).message).toContain("UI bridge request failed");
    }
  });
});
