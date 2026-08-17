import { describe, expect, test } from "bun:test";
import { ToolItemFailure } from "./openwork-tool-result.js";
import {
  assertNotStubToolCall,
  isBashEchoStubCommand,
  isHiddenTmpMarkerPath,
  isJunkGenerationPrompt,
} from "./wodeapp-stub-call-gate.js";

describe("wodeapp-stub-call-gate", () => {
  test("detects hidden tmp marker paths", () => {
    expect(isHiddenTmpMarkerPath("/tmp/.genpage")).toBe(true);
    expect(isHiddenTmpMarkerPath("/tmp/.x")).toBe(true);
    expect(isHiddenTmpMarkerPath("/tmp/desc.txt")).toBe(false);
    expect(isHiddenTmpMarkerPath("/tmp/sw15y10q-frames/f1.jpg")).toBe(false);
    expect(isHiddenTmpMarkerPath("notes.md")).toBe(false);
  });

  test("detects junk generation prompts", () => {
    expect(isJunkGenerationPrompt("占位")).toBe(true);
    expect(isJunkGenerationPrompt("test")).toBe(true);
    expect(isJunkGenerationPrompt("stop")).toBe(true);
    expect(isJunkGenerationPrompt("x")).toBe(true);
    expect(
      isJunkGenerationPrompt("苏泊尔全玻璃养生壶白底主图，SUPOR 标志保真"),
    ).toBe(false);
    expect(isJunkGenerationPrompt("")).toBe(false);
  });

  test("blocks tiny writes to hidden tmp markers", () => {
    expect(() =>
      assertNotStubToolCall("write", {
        filePath: "/tmp/.genpage",
        content: "占位",
      }),
    ).toThrow(ToolItemFailure);
  });

  test("allows large writes to hidden tmp paths (real scratch files)", () => {
    expect(() =>
      assertNotStubToolCall("write", {
        filePath: "/tmp/.notes",
        content: "x".repeat(500),
      }),
    ).not.toThrow();
  });

  test("allows normal writes", () => {
    expect(() =>
      assertNotStubToolCall("write", {
        filePath: "/tmp/desc.txt",
        content: "短",
      }),
    ).not.toThrow();
  });

  test("blocks paid generation tools with junk prompts", () => {
    for (const tool of [
      "wodeapp-platform_ai_generate_image",
      "wodeapp-platform_product_visual_batch_image_run",
      "video_generate",
    ]) {
      expect(() => assertNotStubToolCall(tool, { prompt: "占位" })).toThrow(
        ToolItemFailure,
      );
    }
  });

  test("allows paid generation tools with real prompts", () => {
    expect(() =>
      assertNotStubToolCall("wodeapp-platform_ai_generate_image", {
        prompt: "苏泊尔全玻璃养生壶白底主图，保留刻度线",
      }),
    ).not.toThrow();
  });

  test("detects bare bash echo stubs", () => {
    expect(isBashEchoStubCommand("echo emit-edit-call")).toBe(true);
    expect(isBashEchoStubCommand("echo halt")).toBe(true);
    expect(isBashEchoStubCommand('echo "go-edit"')).toBe(true);
    expect(isBashEchoStubCommand("echo hello world")).toBe(false);
    expect(isBashEchoStubCommand("echo ok > /tmp/out.txt")).toBe(false);
    expect(isBashEchoStubCommand("ls -la")).toBe(false);
  });

  test("blocks bash echo stub commands", () => {
    for (const command of [
      "echo emit-edit-call",
      "echo attempt-real-call",
      "echo stop-loop",
      "echo halt",
      "echo now",
    ]) {
      expect(() => assertNotStubToolCall("bash", { command })).toThrow(
        ToolItemFailure,
      );
    }
  });

  test("allows real bash commands", () => {
    expect(() =>
      assertNotStubToolCall("bash", { command: "file /tmp/v3.jpg" }),
    ).not.toThrow();
    expect(() =>
      assertNotStubToolCall("bash", {
        command: 'curl -sL -o /tmp/v3.jpg "https://example.com/a.jpg"',
      }),
    ).not.toThrow();
  });

  test("ignores unrelated tools", () => {
    expect(() =>
      assertNotStubToolCall("wodeapp_product_save", { name: "占位" }),
    ).not.toThrow();
  });
});
