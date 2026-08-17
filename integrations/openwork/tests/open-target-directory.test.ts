import { describe, expect, it } from "bun:test";
import type { UIMessage } from "ai";

import { deriveOpenTargets, pickChatInlineAccessTargets } from "../artifacts/open-target";

function message(id: string, role: "user" | "assistant", text: string): UIMessage {
  return { id, role, parts: [{ type: "text", text, state: "done" }] };
}

describe("deriveOpenTargets directory paths", () => {
  it("does not turn method names in shell commands into file actions", () => {
    const targets = deriveOpenTargets([{
      id: "msg_shell",
      role: "assistant",
      parts: [{
        type: "dynamic-tool",
        toolName: "bash",
        toolCallId: "call_shell",
        state: "output-available",
        input: {
          command: "python3 -c 'data = f.read(); text = data.decode(); print(re.findall(pattern, text))'",
          description: "Inspect PDF text",
        },
        output: "Saved to pdf_strings.txt",
      }],
    }]);

    expect(targets.map((target) => target.name)).toContain("pdf_strings.txt");
    expect(targets.map((target) => target.name)).not.toContain("f.read");
    expect(targets.map((target) => target.name)).not.toContain("data.decode");
    expect(targets.map((target) => target.name)).not.toContain("re.findall");
  });

  it("does not create open actions from paths inside shell command arguments", () => {
    const targets = deriveOpenTargets([{
      id: "msg_cp",
      role: "assistant",
      parts: [{
        type: "dynamic-tool",
        toolName: "bash",
        toolCallId: "call_cp",
        state: "output-available",
        input: {
          command: "cp /tmp/smartring_report/2025_smart_ring_dtc_report.pdf /Users/mac/default-workspace/",
          description: "Copy report into workspace",
        },
        output: "",
      }],
    }]);

    expect(targets.map((target) => target.name)).not.toContain("2025_smart_ring_dtc_report.pdf");
    expect(targets.map((target) => target.name)).not.toContain("generate_pdf.py");
    expect(targets.some((target) => target.value.includes("smartring_report"))).toBe(false);
    expect(targets.some((target) => target.value.includes("default-workspace"))).toBe(false);
  });

  it("does not create open actions from incidental paths in shell stdout without a save hint", () => {
    const targets = deriveOpenTargets([{
      id: "msg_ls",
      role: "assistant",
      parts: [{
        type: "dynamic-tool",
        toolName: "bash",
        toolCallId: "call_ls",
        state: "output-available",
        input: { command: "ls /tmp/smartring_report" },
        output: "generate_pdf.py\n2025_smart_ring_dtc_report.pdf\n",
      }],
    }]);

    expect(targets.map((target) => target.name)).not.toContain("generate_pdf.py");
    expect(targets.map((target) => target.name)).not.toContain("2025_smart_ring_dtc_report.pdf");
  });

  it("extracts trailing-slash directories from assistant download summaries", () => {
    const targets = deriveOpenTargets([
      message("msg_1", "assistant", "全部下载到 `outputs/ep01-videos/` ："),
    ]);

    expect(targets.map((target) => target.value)).toContain("outputs/ep01-videos");
    const dir = targets.find((target) => target.value === "outputs/ep01-videos");
    expect(dir?.kind).toBe("directory");
    expect(dir?.preview).toBe("folder");
  });

  it("extracts absolute directory paths", () => {
    const targets = deriveOpenTargets([
      message(
        "msg_1",
        "assistant",
        "文件在 /Users/mac/Desktop/wodeapp/outputs/ep01-videos/ 目录下。",
      ),
    ]);

    expect(targets.some((target) => target.kind === "directory" && target.value.includes("outputs/ep01-videos"))).toBe(true);
  });

  it("extracts download summaries with 已下载 and local media paths", () => {
    const targets = deriveOpenTargets([
      message(
        "msg_1",
        "assistant",
        "outputs/ep01-videos/EP02_02_Scars.mp4 – 8.7M，已下载。",
      ),
    ]);

    expect(targets.some((target) => target.kind === "file" && target.value.includes("EP02_02_Scars.mp4"))).toBe(true);
    expect(targets.some((target) => target.kind === "directory" && target.value.includes("outputs/ep01-videos"))).toBe(true);
  });
});

describe("pickChatInlineAccessTargets", () => {
  it("hides intermediate write-tool source files and their parent folders", () => {
    const targets = pickChatInlineAccessTargets({
      id: "msg_write",
      role: "assistant",
      parts: [{
        type: "dynamic-tool",
        toolName: "write",
        toolCallId: "call_write",
        state: "output-available",
        input: { filePath: "/tmp/taiping-check/compose.py", content: "print(1)" },
        output: "Wrote compose.py",
      }],
    });

    expect(targets).toEqual([]);
  });

  it("still shows final deliverables announced in assistant prose", () => {
    const targets = pickChatInlineAccessTargets({
      id: "msg_done",
      role: "assistant",
      parts: [
        {
          type: "text",
          text: "合成完成！文件在 /tmp/taiping-check/out.mp4 ，已保存。",
          state: "done",
        },
      ],
    });

    expect(targets.some((target) => target.kind === "file" && target.name === "out.mp4")).toBe(true);
    expect(targets.some((target) => target.kind === "file" && target.name === "compose.py")).toBe(false);
  });
});
