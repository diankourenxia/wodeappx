import { describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import { existsSync, readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { MessageList, resolveFileMessageOpenTarget } from "../src/components/chat/message-list";
import { MessageListProvider } from "../src/components/chat/message-list-provider";
import { getAssistantRenderGroups } from "../src/components/chat/utils";
import { recoverVisibleMarkdownFromUiParts } from "../src/react-app/domains/session/surface/empty-visible-reply-recovery";
import { t } from "../src/i18n";
import type { ThreadStatus } from "../src/lib/messages";

const noop = () => undefined;

function existingSourceUrl(...relativeCandidates: string[]): URL {
  for (const relativePath of relativeCandidates) {
    const candidate = new URL(relativePath, import.meta.url);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`Unable to locate source file: ${relativeCandidates.join(", ")}`);
}

const messageListSourceUrl = existingSourceUrl(
  "../fork/apps/app/src/components/chat/message-list.tsx",
  "../src/components/chat/message-list.tsx",
);

function assistantMessage(id: string, parts: UIMessage["parts"]): UIMessage {
  return { id, role: "assistant", parts };
}

function userMessage(id: string, text: string): UIMessage {
  return { id, role: "user", parts: [{ type: "text", text }] };
}

function renderMessageList(
  messages: UIMessage[],
  status: ThreadStatus = "ready",
  showThinking = true,
) {
  return renderToStaticMarkup(
    <MessageListProvider
      workspaceId="workspace-message-list-test"
      sessionId="session-message-list-test"
      showThinking={showThinking}
      developerMode={false}
      displaySuggestions={false}
      providerConnectedCount={0}
      dispatchAction={noop}
      setPrompt={noop}
      submitPrompt={noop}
      onRevertToUserMessage={noop}
      onForkAtMessage={noop}
      onEditUserMessage={noop}
    >
      <MessageList
        messages={messages}
        status={status}
        historyKey="session-message-list-test"
      />
    </MessageListProvider>,
  );
}

describe("MessageList empty assistant handling", () => {
  test("keeps pending @asset references as read-only resource chips", () => {
    const html = renderMessageList([
      userMessage("user-asset-pending", "用 @asset:product%201 生成主图"),
    ]);

    expect(html).toContain("@product 1");
    expect(html).toContain("rounded-full");
    expect(html).not.toContain("@asset:product%201");
  });

  test("restores sent asset context as chips without exposing transport context", () => {
    const html = renderMessageList([
      userMessage("user-asset-sent", [
        "生成一张商品主图。",
        "",
        "[已关联数字资产：只读素材上下文]",
        "以下字段只描述所选资产。",
        "1. 商品库：便携榨汁杯",
        "资产ID：product-1",
        "来源：测试资源",
        "[只读素材上下文结束]",
      ].join("\n")),
    ]);

    expect(html).toContain("@便携榨汁杯");
    expect(html).toContain("生成一张商品主图。");
    expect(html).not.toContain("已关联数字资产：只读素材上下文");
    expect(html).not.toContain("来源：测试资源");
  });

  test("keeps user text selectable and hover actions reachable outside the message flow", () => {
    const html = renderMessageList([
      userMessage("user-before", "First question"),
      userMessage("user-after", "Follow-up"),
    ]);

    expect(html).toContain("flex flex-col gap-3 @container/message-list");
    expect(html).toContain("cursor-text select-text");
    expect(html).toContain("pointer-events-auto absolute right-0 top-[calc(100%-1px)]");
    expect(html).toContain("hover:opacity-100 focus-within:opacity-100");
  });

  test("keeps assistant text selectable and its actions reachable below the answer", () => {
    const source = readFileSync(messageListSourceUrl, "utf8");

    expect(source).toContain("flex-1 cursor-text select-text");
    expect(source).toContain("bg-transparent px-1 py-0.5");
    expect(source).not.toContain("shadow-[var(--dls-card-shadow)]");
    expect(source).toContain("showGroupActions");
    expect(source).toContain("!isLiveGroup");
    expect(source).toContain("showGroupActions && \"pb-9\"");
    expect(source).toContain("pointer-events-auto absolute inset-x-0 bottom-0 z-10");
    expect(source).toContain("group-hover/message-group:opacity-100 hover:opacity-100 focus-within:opacity-100");
    expect(source).toContain('gap-1.5');
    expect(source).toContain("showWaitingIndicator");
    expect(source).toContain("hasVisibleLiveAssistantContent");
  });

  test("keeps a submitted empty shell in the waiting state", () => {
    const html = renderMessageList(
      [assistantMessage("assistant-empty", [])],
      "submitted",
    );

    expect(html).toContain(t("wodeappx.status.thinking"));
    expect(html).not.toContain("<canvas");
    expect(html).not.toContain("Empty message");
    expect(html).not.toContain(t("session.assistant_empty_response"));
  });

  test("does not flash Thinking under completed tool steps while still streaming", () => {
    const html = renderMessageList(
      [
        userMessage("user-1", "分析工具 description"),
        assistantMessage("assistant-tools", [
          {
            type: "dynamic-tool",
            toolName: "openwork_ui_execute_action",
            toolCallId: "call-1",
            state: "output-available",
            input: {},
            output: { ok: true },
          } as UIMessage["parts"][number],
        ]),
      ],
      "streaming",
    );

    expect(html).not.toContain(t("wodeappx.status.thinking"));
  });

  test("shows Thinking when a later empty assistant shell follows completed tools (ses_049432e88ffe)", () => {
    const html = renderMessageList(
      [
        userMessage("user-empty-shell", "安装按钮的颜色可以再浅一点的吧？"),
        assistantMessage("assistant-tools-done", [
          {
            type: "dynamic-tool",
            toolName: "edit",
            toolCallId: "call-edit-done",
            state: "output-available",
            input: { filePath: "a.css", oldString: "a", newString: "b" },
            output: "ok",
          } as UIMessage["parts"][number],
        ]),
        // OpenCode next step stub: busy parent, zero parts yet.
        assistantMessage("assistant-empty-shell", []),
      ],
      "streaming",
    );

    expect(html).toContain(t("wodeappx.status.thinking"));
    expect(html).toContain("已编辑文件");
  });

  test("keeps user bubble + Thinking when ready flickers on empty shell between tool rounds (ses_02ffe542)", () => {
    const html = renderMessageList(
      [
        userMessage("user-minimax", "m5 可以本机部署 minimaxh3 吗"),
        assistantMessage("assistant-tools-done", [
          {
            type: "dynamic-tool",
            toolName: "bash",
            toolCallId: "call-bash-done",
            state: "output-available",
            input: { command: "uname -m" },
            output: "arm64",
          } as UIMessage["parts"][number],
        ]),
        // Transport shell after tool-calls; status briefly ready (liveStatus idle gap).
        assistantMessage("assistant-empty-shell", []),
      ],
      "ready",
    );

    expect(html).toContain("m5 可以本机部署 minimaxh3 吗");
    expect(html).toContain(t("wodeappx.status.thinking"));
    expect(html).not.toContain(t("session.assistant_empty_response"));
    expect(html).not.toContain("Empty message");
  });

  test("keeps the waiting indicator while hidden reasoning streams (showThinking off)", () => {
    const html = renderMessageList(
      [
        userMessage("user-reasoning-hidden", "思考一下版本管理方案"),
        assistantMessage("assistant-reasoning-hidden", [
          { type: "reasoning", text: "Let me think through the options…", state: "streaming" } as UIMessage["parts"][number],
        ]),
      ],
      "streaming",
      false,
    );

    // Reasoning accordion is hidden by the display preference, so the Waiting
    // indicator must stay — otherwise the transcript looks frozen mid-thought.
    expect(html).toContain(t("wodeappx.status.thinking"));
  });

  test("suppresses the waiting indicator when the reasoning accordion is visible", () => {
    const html = renderMessageList(
      [
        userMessage("user-reasoning-visible", "思考一下版本管理方案"),
        assistantMessage("assistant-reasoning-visible", [
          { type: "reasoning", text: "Let me think through the options…", state: "streaming" } as UIMessage["parts"][number],
        ]),
      ],
      "streaming",
      true,
    );

    expect(html).not.toContain(t("wodeappx.status.thinking"));
    expect(html).toContain("思考中");
  });

  test("hides waiting indicator once the live turn already has assistant prose", () => {
    const source = readFileSync(messageListSourceUrl, "utf8");
    expect(source).toContain("!liveActionLabel && !hasVisibleLiveAssistantContent");
    expect(source).toContain('partType === "text"');
    expect(source).toContain("assistantTextHasVisibleProse");
    expect(source).toContain("showWaitingIndicator");
    expect(source).toContain("StickyAssistantProsePlaceholder");
    expect(source).toContain("showStickyProsePlaceholder");
    expect(source).toContain("Never shrink sticky prose while streaming");
  });

  test("keeps a sticky prose placeholder helper for blanked live turns", () => {
    const source = readFileSync(messageListSourceUrl, "utf8");
    expect(source).toContain("function getLiveTurnAssistantProse");
    expect(source).toContain("function getLastUserMessageId");
    expect(source).toContain("liveTurnUserId");
    expect(source).toContain("stickyTurnUserIdRef");
    expect(source).toContain("Bind sticky prose to the current user turn");
    expect(source).toContain("Continuing…");
    expect(source).toContain("bg-transparent px-1 py-0.5");
    expect(source).not.toContain("shadow-[var(--dls-card-shadow)]");
  });

  test("clears sticky prose when the live user turn changes", () => {
    const source = readFileSync(new URL("../src/components/chat/message-list.tsx", import.meta.url), "utf8");
    expect(source).toContain("liveTurnUserId !== stickyTurnUserIdRef.current");
    expect(source).toContain("stickyTurnUserIdRef.current === liveTurnUserId");
    expect(source).toContain("Never shrink sticky prose while streaming");
  });

  test("shows one localized fallback only for a genuinely empty completed turn", () => {
    const html = renderMessageList([
      assistantMessage("assistant-empty", []),
    ]);

    expect(html).toContain(t("session.assistant_empty_response"));
    expect(html).not.toContain("Empty message");
  });

  test("does not append an empty fallback after a tool-only turn", () => {
    const html = renderMessageList([
      assistantMessage("assistant-tool", [
        {
          type: "dynamic-tool",
          toolName: "write",
          toolCallId: "call-write",
          state: "output-available",
          input: { filePath: "a.txt", content: "hello" },
          output: "ok",
        },
      ]),
    ]);

    expect(html).toContain("已写入文件");
    expect(html).not.toContain(t("session.assistant_empty_response"));
    expect(html).not.toContain("Empty message");
  });

  test("collapses consecutive execution steps into one concise summary", () => {
    const steps = ["Extract PDF text", "Recover text encoding", "Inspect document structure"];
    const html = renderMessageList(steps.map((description, index) =>
      assistantMessage(`assistant-tool-${index}`, [{
        type: "dynamic-tool" as const,
        toolName: "bash",
        toolCallId: `call-bash-${index}`,
        state: "output-available" as const,
        input: { command: `python3 step_${index}.py`, description },
        output: `step ${index} complete`,
      }])
    ));

    // Codex-style: aggregate bash runs into one activity phrase, not "已完成 N 个步骤".
    expect(html).toContain("运行了 3 个命令");
    expect(html).not.toContain("已完成 3 个步骤");
    expect(html).toContain(t("session.tool_steps_details"));
    // Peek may list commands; the collapsed summary must not dump them in the title row.
    expect(html).not.toContain("Running bash");
    expect(html).not.toContain("Running openwork");
  });

  test("shows Codex shimmer chrome while a tool step is in flight", () => {
    const html = renderMessageList(
      [
        userMessage("user-shimmer", "改一下标题 loading"),
        assistantMessage("assistant-shimmer", [
          {
            type: "dynamic-tool",
            toolName: "edit",
            toolCallId: "call-edit-live",
            state: "input-streaming",
            input: { filePath: "message-list.tsx", oldString: "a", newString: "b" },
          } as UIMessage["parts"][number],
        ]),
      ],
      "streaming",
    );

    expect(html).toContain("wapp-tool-activity-shimmer");
    expect(html).toContain('data-tool-activity-busy="1"');
    expect(html).toContain("animate-spin");
    expect(html).toMatch(/正在编辑|正在/);
  });

  test("keeps shimmer on the live trailing activity strip between completed tools", () => {
    const html = renderMessageList(
      [
        userMessage("user-live-tail", "继续改"),
        assistantMessage("assistant-live-tail", [
          {
            type: "dynamic-tool",
            toolName: "edit",
            toolCallId: "call-edit-done",
            state: "output-available",
            input: { filePath: "a.ts", oldString: "1", newString: "2" },
            output: "ok",
          } as UIMessage["parts"][number],
        ]),
      ],
      "streaming",
    );

    expect(html).toContain("已编辑文件");
    expect(html).toContain("wapp-tool-activity-shimmer");
    expect(html).toContain('data-tool-activity-busy="1"');
  });

  test("does not expose hidden reasoning as an empty response", () => {
    const html = renderMessageList(
      [
        assistantMessage("assistant-reasoning", [
          { type: "reasoning", text: "Internal reasoning", state: "done" },
        ]),
      ],
      "ready",
      false,
    );

    expect(html).not.toContain(t("session.assistant_empty_response"));
    expect(html).not.toContain("Empty message");
  });

  test("recovers fake question tool XML from reasoning into visible choices", () => {
    const source = readFileSync(new URL("../src/components/chat/message-list.tsx", import.meta.url), "utf8");
    expect(source).toContain("recoverVisibleMarkdownFromUiParts");
    expect(source).toContain("empty-visible-reply-recovery");
    expect(source).toContain("recoveredHiddenMarkdown");

    const xml = [
      "<tool_call>",
      '<invoke name="question"><questions><item>',
      "<question>先选一个 skill 跑通？</question>",
      "<header>选 skillId</header>",
      "<options>",
      "<item><label>xiaohongshu-copy（推荐）</label><description>文案</description></item>",
      "<item><label>voiceover</label><description>配音</description></item>",
      "</options>",
      "</item></questions></invoke>",
      "</tool_call>",
    ].join("");

    // Full MessageContent markdown SSR hits DOMPurify; assert the recovery
    // helper that MessageList wires in, which is what turns blank finishes
    // into clickable wodeapp-choices.
    const markdown = recoverVisibleMarkdownFromUiParts([
      { type: "reasoning", text: xml },
      { type: "text", text: `<think>${xml}</think>` },
    ]);
    expect(markdown).toContain("先选一个 skill 跑通");
    expect(markdown).toContain("xiaohongshu-copy");
    expect(markdown).toContain("```wodeapp-choices");
  });

  test("message-list imports empty-visible recovery helper", () => {
    const source = readFileSync(new URL("../src/components/chat/message-list.tsx", import.meta.url), "utf8");
    expect(source).toContain("recoverVisibleMarkdownFromUiParts");
    expect(source).toContain("empty-visible-reply-recovery");
  });

  test("hides provider think tags before and after the closing tag arrives", () => {
    const streaming = getAssistantRenderGroups([
      { type: "text", text: "<think>Internal draft that is still streaming", state: "streaming" },
    ], false);
    const completed = getAssistantRenderGroups([
      { type: "text", text: "<think>Internal draft</think>Stable final answer", state: "done" },
    ], false);

    expect(streaming).toEqual([]);
    expect(completed).toEqual([{ kind: "text", text: "Stable final answer" }]);
  });

  test("holds partial opening think tags until the streaming frame is complete", () => {
    for (const text of ["<", "<t", "<thi", "<think", "<think "]) {
      expect(getAssistantRenderGroups([
        { type: "text", text, state: "streaming" },
      ], false)).toEqual([]);
    }

    expect(getAssistantRenderGroups([
      { type: "text", text: "<", state: "done" },
    ], false)).toEqual([{ kind: "text", text: "<" }]);
  });

  test("never exposes provider think-tag content through the thinking preference", () => {
    const groups = getAssistantRenderGroups([
      { type: "text", text: "<think>Visible reasoning</think>Final answer", state: "done" },
    ], true);

    expect(groups).toEqual([{ kind: "text", text: "Final answer" }]);
  });

  test("does not render an empty carcass beside a session error", () => {
    const html = renderMessageList([
      assistantMessage("assistant-failed", []),
      assistantMessage("session-error:assistant-failed", [
        {
          type: "text",
          text: "The message was interrupted",
          state: "done",
        },
      ]),
    ]);

    expect(html).toContain("The message was interrupted");
    expect(html).not.toContain(t("session.assistant_empty_response"));
    expect(html).not.toContain("Empty message");
  });

  test("continues rendering file-only assistant output", () => {
    const html = renderMessageList([
      assistantMessage("assistant-file", [
        {
          type: "file",
          url: "https://example.com/report.pdf",
          filename: "report.pdf",
          mediaType: "application/pdf",
        },
      ]),
    ]);

    expect(html).toContain("report.pdf");
    expect(html).not.toContain(t("session.assistant_empty_response"));
    expect(html).not.toContain("Empty message");
  });

  test("keeps a sent user attachment visible as an openable file card", () => {
    const html = renderMessageList([{
      id: "user-file",
      role: "user",
      parts: [{
        type: "file",
        url: "file:///Users/test/Downloads/brief.pdf",
        filename: "brief.pdf",
        mediaType: "application/pdf",
      }],
    }]);

    expect(html).toContain("brief.pdf");
    expect(html).toContain('title="打开文件"');
    expect(html).toContain("<button");
  });

  test("opens a restored history attachment by its stored URL instead of its filename", () => {
    const localUrl = "file:///var/folders/example/wodeappx-live-mime-fixtures/clip.mp4";
    const localTarget = resolveFileMessageOpenTarget({
      url: localUrl,
      providerMetadata: {
        opencode: {
          wodeappAttachmentPlaceholder: true,
        },
      },
    }, "clip.mp4");

    expect(localTarget).toMatchObject({
      kind: "file",
      value: localUrl,
      preview: "external",
    });

    const remoteUrl = "https://assets.example/report.pdf";
    const remoteTarget = resolveFileMessageOpenTarget({
      url: remoteUrl,
      providerMetadata: {
        opencode: {
          wodeappAttachmentPlaceholder: true,
        },
      },
    }, "report.pdf");

    expect(remoteTarget).toMatchObject({
      kind: "url",
      value: remoteUrl,
      preview: "browser",
    });
  });

  test("never opens optimistic:// fake schemes as workspace-relative paths", () => {
    expect(resolveFileMessageOpenTarget({
      url: "optimistic://attachment/295fa96dc564e18ed81d69b7d5c3a3a7.mp4",
    }, "295fa96dc564e18ed81d69b7d5c3a3a7.mp4")).toMatchObject({
      kind: "file",
      value: "295fa96dc564e18ed81d69b7d5c3a3a7.mp4",
      preview: "external",
    });
  });

  test("refuses bare clipboard image.png open targets (would hit Downloads)", () => {
    expect(resolveFileMessageOpenTarget({
      url: "data:text/plain;base64,IA==",
      providerMetadata: {
        opencode: {
          wodeappAttachmentPlaceholder: true,
        },
      },
    }, "image.png")).toMatchObject({
      kind: "file",
      value: "",
      name: "image.png",
    });
  });

  test("falls back to the filename only when a history attachment has no openable URL", () => {
    expect(resolveFileMessageOpenTarget({
      url: "data:text/plain;base64,IA==",
      providerMetadata: {
        opencode: {
          wodeappAttachmentPlaceholder: true,
        },
      },
    }, "brief.pdf")).toMatchObject({
      kind: "file",
      value: "brief.pdf",
      preview: "external",
    });
  });
});
