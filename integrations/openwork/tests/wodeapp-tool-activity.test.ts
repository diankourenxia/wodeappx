import { describe, expect, test } from "bun:test";

import {
  getWodeAppToolActivityLabel,
  getWodeAppToolBaseLabel,
  summarizeWodeAppToolActivityGroup,
  buildWodeAppToolActivityPeek,
  extractTaskResultProse,
  collectSurfacedTaskResultProse,
  assistantMessageHasAuthoritativeFinalReply,
  selectAssistantProseMessageIds,
  shouldSurfaceTaskResultFallback,
} from "../src/react-app/domains/wodeapp/wodeapp-tool-activity";

function dynamicTool(input: {
  toolName: string;
  state?: "input-streaming" | "input-available" | "output-available" | "output-error";
  actionId?: string;
  toolCallId?: string;
}) {
  return {
    type: "dynamic-tool" as const,
    toolName: input.toolName,
    toolCallId: input.toolCallId ?? "call_1",
    state: input.state ?? "output-available",
    input: input.actionId ? { actionId: input.actionId } : {},
  };
}

describe("wodeapp tool activity labels", () => {
  test("uses Chinese tense-aware labels instead of Running snake_case", () => {
    const running = dynamicTool({
      toolName: "openwork_ui_execute_action",
      state: "input-available",
      actionId: "wodeapp.batch_image.open",
    });
    const done = dynamicTool({
      toolName: "openwork_ui_execute_action",
      state: "output-available",
      actionId: "wodeapp.batch_image.open",
    });

    expect(getWodeAppToolBaseLabel(running)).toBe("准备批量生图");
    expect(getWodeAppToolActivityLabel(running)).toBe("正在准备批量生图");
    expect(getWodeAppToolActivityLabel(done)).toBe("已准备批量生图");
    expect(getWodeAppToolActivityLabel(done)).not.toContain("Running");
  });

  test("falls back to generic UI action label without actionId", () => {
    const part = dynamicTool({
      toolName: "openwork_ui_execute_action",
      state: "output-available",
    });
    expect(getWodeAppToolActivityLabel(part)).toBe("已执行界面操作");
  });

  test("labels attachment context reads as a visible local step", () => {
    const part = dynamicTool({
      toolName: "openwork_attachment_context_read",
      state: "output-available",
    });
    expect(getWodeAppToolActivityLabel(part)).toBe("已读取附件上下文");
  });

  test("softens error labels instead of harsh 失败/failed copy", () => {
    const part = dynamicTool({
      toolName: "wodeapp-platform_ai_generate_image",
      state: "output-error",
    });
    expect(getWodeAppToolBaseLabel(part)).toBe("生成图片");
    expect(getWodeAppToolActivityLabel(part)).toBe("生成图片未完成");
    expect(getWodeAppToolActivityLabel(part)).not.toContain("失败");
  });

  test("summarizes identical consecutive tools like Codex", () => {
    const parts = [
      dynamicTool({
        toolName: "openwork_ui_execute_action",
        state: "output-available",
        actionId: "wodeapp.video_storyboard.open",
        toolCallId: "a",
      }),
      dynamicTool({
        toolName: "openwork_ui_execute_action",
        state: "output-available",
        actionId: "wodeapp.video_storyboard.open",
        toolCallId: "b",
      }),
    ];
    const summary = summarizeWodeAppToolActivityGroup(parts);
    expect(summary.running).toBe(false);
    expect(summary.summary).toBe("已打开多条视频生成 ×2");
  });

  test("summarizes mixed running steps with a count", () => {
    const summary = summarizeWodeAppToolActivityGroup([
      dynamicTool({
        toolName: "openwork_pdf_extract_text",
        state: "output-available",
        toolCallId: "a",
      }),
      dynamicTool({
        toolName: "openwork_ui_snapshot",
        state: "input-available",
        toolCallId: "b",
      }),
    ]);
    expect(summary.running).toBe(true);
    expect(summary.summary).toBe("已提取 PDF 文本 正在截取界面");
  });

  test("formats mixed finished tools like Codex activity chips", () => {
    const summary = summarizeWodeAppToolActivityGroup([
      {
        type: "dynamic-tool" as const,
        toolName: "read",
        toolCallId: "r1",
        state: "output-available" as const,
        input: { filePath: "a.ts" },
      },
      {
        type: "dynamic-tool" as const,
        toolName: "bash",
        toolCallId: "b1",
        state: "output-available" as const,
        input: { command: "ls" },
      },
      {
        type: "dynamic-tool" as const,
        toolName: "bash",
        toolCallId: "b2",
        state: "output-available" as const,
        input: { command: "pwd" },
      },
      {
        type: "dynamic-tool" as const,
        toolName: "websearch",
        toolCallId: "w1",
        state: "output-available" as const,
        input: { query: "shopify liquid" },
      },
    ]);
    expect(summary.running).toBe(false);
    expect(summary.summary).toBe("已读取文件 运行了 2 个命令 已搜索网页");
  });

  test("collapses many bash steps into a counted command summary", () => {
    const parts = Array.from({ length: 9 }, (_, index) => ({
      type: "dynamic-tool" as const,
      toolName: "bash",
      toolCallId: `b${index}`,
      state: "output-available" as const,
      input: { command: `echo ${index}` },
    }));
    const summary = summarizeWodeAppToolActivityGroup(parts);
    expect(summary.summary).toBe("运行了 9 个命令");
  });

  test("single bash strip prefers a short command hint", () => {
    const summary = summarizeWodeAppToolActivityGroup([
      {
        type: "dynamic-tool" as const,
        toolName: "bash",
        toolCallId: "b1",
        state: "output-available" as const,
        input: { command: 'grep -rn "existingSourceUrl" integrations/openwork/tests' },
      },
    ]);
    expect(summary.summary).toContain("grep -rn");
    expect(summary.summary).not.toBe("已运行命令");
  });

  test("builds a Cursor-style peek with bash commands and edit diffs", () => {
    const peek = buildWodeAppToolActivityPeek([
      {
        type: "dynamic-tool" as const,
        toolName: "edit",
        toolCallId: "e1",
        state: "output-available" as const,
        input: {
          filePath: "wodeapp-tool-activity.ts",
          oldString: "运行了多个命令",
          newString: "运行了命令",
        },
      },
      {
        type: "dynamic-tool" as const,
        toolName: "bash",
        toolCallId: "b1",
        state: "output-available" as const,
        input: { command: "bun test tests/wodeapp-tool-activity.test.ts" },
      },
    ]);
    expect(peek.some((line) => line.tone === "meta" && line.text.includes("wodeapp-tool-activity.ts"))).toBe(true);
    expect(peek.some((line) => line.tone === "remove" && line.text.includes("运行了多个命令"))).toBe(true);
    expect(peek.some((line) => line.tone === "add" && line.text.includes("运行了命令"))).toBe(true);
    expect(peek.some((line) => line.tone === "neutral" && line.text.startsWith("$ bun test"))).toBe(true);
  });

  test("caps multi-bash peek and mentions remaining commands", () => {
    const parts = Array.from({ length: 6 }, (_, index) => ({
      type: "dynamic-tool" as const,
      toolName: "bash",
      toolCallId: `b${index}`,
      state: "output-available" as const,
      input: { command: `echo ${index}` },
    }));
    const peek = buildWodeAppToolActivityPeek(parts, { maxLines: 6 });
    expect(peek.filter((line) => line.text.startsWith("$ ")).length).toBeLessThanOrEqual(4);
    expect(peek.some((line) => line.text.includes("另有"))).toBe(true);
  });

  test("extracts task_result prose and surfaces completed task outputs", () => {
    const wrapped = `<task id="ses_x" state="completed">
<task_result>
Now I have a thorough picture of the codebase. Let me compile the complete report.

---

# 互动影游调研报告

项目中目前没有现成的互动影游框架。
</task_result>
</task>`;

    expect(extractTaskResultProse(wrapped)).toContain("# 互动影游调研报告");
    expect(extractTaskResultProse(wrapped)).not.toContain("Now I have a thorough picture");
    expect(extractTaskResultProse(wrapped)).not.toContain("<task_result>");

    const shortCancel = collectSurfacedTaskResultProse([
      {
        type: "dynamic-tool" as const,
        toolName: "task",
        toolCallId: "t0",
        state: "output-available" as const,
        input: {},
        output: "Task cancelled",
      },
    ]);
    expect(shortCancel).toEqual([]);

    const surfaced = collectSurfacedTaskResultProse([
      {
        type: "dynamic-tool" as const,
        toolName: "task",
        toolCallId: "t1",
        state: "output-available" as const,
        input: { description: "搜索互动影游框架" },
        output: wrapped,
      },
      {
        type: "dynamic-tool" as const,
        toolName: "todowrite",
        toolCallId: "td1",
        state: "output-available" as const,
        input: {},
        output: "ok",
      },
    ]);
    expect(surfaced).toHaveLength(1);
    expect(surfaced[0]).toContain("# 互动影游调研报告");
    expect(surfaced[0]).toContain("没有现成的互动影游框架");
  });

  test("does not treat an intermediate tool-calls message as the parent final reply", () => {
    expect(assistantMessageHasAuthoritativeFinalReply({
      role: "assistant",
      parts: [{ type: "text", text: "子代理已经给出报告，但父代理仍在执行。" }],
      metadata: {
        opencode: {
          created: 1,
          completed: 2,
          finish: "tool-calls",
        },
      },
    })).toBe(false);
  });

  test("recognizes only completed terminal assistant prose as authoritative", () => {
    expect(assistantMessageHasAuthoritativeFinalReply({
      role: "assistant",
      parts: [{ type: "text", text: "这是父代理最终回复。" }],
      metadata: {
        opencode: {
          created: 1,
          completed: 2,
          finish: "stop",
        },
      },
    })).toBe(true);

    expect(assistantMessageHasAuthoritativeFinalReply({
      role: "assistant",
      parts: [{ type: "text", text: "<think>只有内部思考，没有用户可见回复。</think>" }],
      metadata: {
        opencode: {
          created: 1,
          completed: 2,
          finish: "stop",
        },
      },
    })).toBe(false);
  });

  test("surfaces a task result only as an idle fallback without a parent final reply", () => {
    expect(shouldSurfaceTaskResultFallback({
      sessionLive: true,
      hasAuthoritativeFinalReply: false,
    })).toBe(false);
    expect(shouldSurfaceTaskResultFallback({
      sessionLive: false,
      hasAuthoritativeFinalReply: true,
    })).toBe(false);
    expect(shouldSurfaceTaskResultFallback({
      sessionLive: false,
      hasAuthoritativeFinalReply: false,
    })).toBe(true);
  });

  test("drops tool-call narration but preserves the last report before a short terminal addendum", () => {
    const messages = [
      {
        id: "progress-1",
        role: "assistant",
        parts: [{ type: "text", text: "Got the conditional rendering snapshot. Now let me find the send logic." }],
        metadata: { opencode: { completed: 2, finish: "tool-calls" } },
      },
      {
        id: "progress-2",
        role: "assistant",
        parts: [{ type: "text", text: "All three key claims verified. Now let me check the remaining UI state." }],
        metadata: { opencode: { completed: 3, finish: "tool-calls" } },
      },
      {
        id: "report",
        role: "assistant",
        parts: [{
          type: "text",
          text: "已经对照源码核完了三个关键证据点。\n\n## 核验结果\n\n1. 条件渲染与源码一致。\n2. 发送链路没有 optimistic turn。\n3. workspaceId 注释与实现一致。",
        }],
        metadata: { opencode: { completed: 4, finish: "tool-calls" } },
      },
      {
        id: "terminal",
        role: "assistant",
        parts: [{ type: "text", text: "本次只读验证，没有修改文件。" }],
        metadata: { opencode: { completed: 5, finish: "stop" } },
      },
    ];

    expect(selectAssistantProseMessageIds(messages)).toEqual(["report", "terminal"]);
  });

  test("keeps only a self-contained terminal answer after tool-call narration", () => {
    const messages = [
      {
        id: "progress",
        role: "assistant",
        parts: [{ type: "text", text: "I found the relevant files. Now let me compile the answer." }],
        metadata: { opencode: { completed: 2, finish: "tool-calls" } },
      },
      {
        id: "terminal",
        role: "assistant",
        parts: [{
          type: "text",
          text: `## 结论

根因是状态链路和消息链路时序不同，同时非空会话没有进行中占位。

## 建议

复用现有状态，在消息列表旁显示轻量进度行，并保留 transcript 渲染链路。`,
        }],
        metadata: { opencode: { completed: 3, finish: "stop" } },
      },
    ];

    expect(selectAssistantProseMessageIds(messages)).toEqual(["terminal"]);
  });

  test("does not hide progress prose before a terminal reply exists", () => {
    const messages = [
      {
        id: "progress-1",
        role: "assistant",
        parts: [{ type: "text", text: "正在核对条件渲染。" }],
        metadata: { opencode: { completed: 2, finish: "tool-calls" } },
      },
      {
        id: "progress-2",
        role: "assistant",
        parts: [{ type: "text", text: "正在检查发送逻辑。" }],
        metadata: { opencode: { completed: 3, finish: "tool-calls" } },
      },
      {
        id: "reasoning-only",
        role: "assistant",
        parts: [{ type: "reasoning", text: "内部推理仍应由思考折叠区控制。" }],
        metadata: { opencode: { created: 4 } },
      },
    ];

    expect(selectAssistantProseMessageIds(messages)).toEqual([
      "progress-1",
      "progress-2",
      "reasoning-only",
    ]);
  });
});
