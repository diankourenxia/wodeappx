import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  EMPTY_VISIBLE_REPLY_AUTO_CONTINUE_MARKER,
  assistantPartsHaveVisibleUserContent,
  buildEmptyVisibleReplyAutoContinueSystemContext,
  collectHiddenAssistantCorpus,
  detectMalformedToolName,
  findEmptyVisibleCompletedAssistantTurn,
  formatRecoveredQuestionMarkdown,
  parseRecoveredQuestion,
  recoverVisibleMarkdownFromHiddenCorpus,
  recoverVisibleMarkdownFromUiParts,
} from "../fork/apps/app/src/react-app/domains/session/surface/empty-visible-reply-recovery.ts";
import { isStuckToolAutoContinueText } from "../fork/apps/app/src/react-app/domains/session/surface/stuck-tool-recovery.ts";

const SAMPLE_QUESTION_XML = `
让我先问 skill 选择，再执行。<tool_call>
<invoke name="question"><questions><item><question>路径 A 有 20 个内置 skill（manifest 驱动），最贴合「灵感便签 → 真正生成东西」语义的有这几个，先选一个跑通？</question><header>选 skillId</header><options><item><label>xiaohongshu-copy（推荐）</label><description>输入零碎想法 → 输出小红书爆款文案。</description></item><item><label>voiceover</label><description>输入脚本 → AI 配音输出音频文件。</description></item><item><label>weekly-report</label><description>输入本周完成 / 下周计划 → 输出结构化周报。</description></item></options></item></questions></invoke>
</tool_call>
`.trim();

test("detects malformed question tool name from reasoning XML", () => {
  assert.equal(detectMalformedToolName(SAMPLE_QUESTION_XML), "question");
  assert.equal(detectMalformedToolName("plain reasoning"), null);
});

test("parses recovered question options from invoke XML", () => {
  const recovered = parseRecoveredQuestion(SAMPLE_QUESTION_XML);
  assert.ok(recovered);
  assert.match(recovered!.question, /灵感便签/);
  assert.equal(recovered!.header, "选 skillId");
  assert.equal(recovered!.options.length, 3);
  assert.equal(recovered!.options[0]?.label, "xiaohongshu-copy（推荐）");
});

test("formats recovered question as wodeapp-choices markdown", () => {
  const recovered = parseRecoveredQuestion(SAMPLE_QUESTION_XML);
  assert.ok(recovered);
  const markdown = formatRecoveredQuestionMarkdown(recovered!);
  assert.match(markdown, /```wodeapp-choices/);
  assert.match(markdown, /xiaohongshu-copy/);
  assert.match(markdown, /"mode": "single"/);
});

test("recovers visible markdown from hidden UI parts including think-framed text", () => {
  const markdown = recoverVisibleMarkdownFromUiParts([
    { type: "reasoning", text: "draft" },
    { type: "text", text: `<think>${SAMPLE_QUESTION_XML}</think>` },
  ]);
  assert.ok(markdown);
  assert.match(markdown!, /wodeapp-choices/);
});

test("visible content ignores think-only text and counts real tools/files", () => {
  assert.equal(
    assistantPartsHaveVisibleUserContent([
      { type: "text", text: `<think>${SAMPLE_QUESTION_XML}</think>` },
      { type: "reasoning", text: SAMPLE_QUESTION_XML },
    ]),
    false,
  );
  assert.equal(
    assistantPartsHaveVisibleUserContent([{ type: "text", text: "已完成" }]),
    true,
  );
  assert.equal(
    assistantPartsHaveVisibleUserContent([{ type: "tool", tool: "question", state: { status: "pending" } }]),
    true,
  );
});

test("finds empty-visible completed turn with recoverable question", () => {
  const hit = findEmptyVisibleCompletedAssistantTurn({
    status: { type: "idle" },
    messages: [
      { info: { id: "u1", role: "user" }, parts: [{ type: "text", text: "试试路径 A" }] },
      {
        info: { id: "a1", role: "assistant", finish: "stop", time: { completed: 1 } },
        parts: [
          { type: "reasoning", text: SAMPLE_QUESTION_XML },
          { type: "text", text: `<think>${SAMPLE_QUESTION_XML}</think>` },
        ],
      },
    ],
  });
  assert.ok(hit);
  assert.equal(hit!.messageId, "a1");
  assert.equal(hit!.toolName, "question");
  assert.equal(hit!.recoverableQuestion, true);
  assert.match(hit!.recoveredMarkdown || "", /wodeapp-choices/);
});

test("does not treat busy sessions or visible prose turns as empty", () => {
  assert.equal(
    findEmptyVisibleCompletedAssistantTurn({
      status: { type: "busy" },
      messages: [
        { info: { id: "u1", role: "user" }, parts: [] },
        {
          info: { id: "a1", role: "assistant", finish: "stop", time: { completed: 1 } },
          parts: [{ type: "reasoning", text: SAMPLE_QUESTION_XML }],
        },
      ],
    }),
    null,
  );
  assert.equal(
    findEmptyVisibleCompletedAssistantTurn({
      status: { type: "idle" },
      messages: [
        { info: { id: "u1", role: "user" }, parts: [] },
        {
          info: { id: "a1", role: "assistant", finish: "stop", time: { completed: 1 } },
          parts: [{ type: "text", text: "这是可见回复" }],
        },
      ],
    }),
    null,
  );
});

test("auto-continues plain reasoning-only stop (no visible prose)", () => {
  const hit = findEmptyVisibleCompletedAssistantTurn({
    status: { type: "idle" },
    messages: [
      { info: { id: "u1", role: "user" }, parts: [] },
      {
        info: { id: "a1", role: "assistant", finish: "stop", time: { completed: 1 } },
        parts: [{ type: "reasoning", text: "Internal draft without tools" }],
      },
    ],
  });
  assert.ok(hit);
  assert.equal(hit!.messageId, "a1");
  assert.equal(hit!.toolName, null);
  assert.equal(hit!.recoveredMarkdown, null);
  assert.equal(hit!.recoverableQuestion, false);
});

test("ses_049432 shape: tools then reasoning-only stop → auto-continue", () => {
  const reasoning = `Now I have a good understanding of the current implementation vs design mockup:

**Current (wx-cap-*)**:
- Every card: icon block (36px indigo-soft square) + badges row. Indigo accent #4f46e5 — doesn't match design's blue accent #3f6fe0.
`;
  const hit = findEmptyVisibleCompletedAssistantTurn({
    status: { type: "idle" },
    messages: [
      {
        info: { id: "u1", role: "user" },
        parts: [{ type: "text", text: "有没有优化的方案" }],
      },
      {
        info: { id: "a0", role: "assistant", finish: "tool-calls", time: { completed: 1 } },
        parts: [
          { type: "text", text: "我先对比一下现在的样式和之前的设计稿，找出差距在哪，再给你优化方案。" },
          { type: "tool", tool: "bash", state: { status: "completed" } },
        ],
      },
      {
        info: { id: "a1", role: "assistant", finish: "tool-calls", time: { completed: 2 } },
        parts: [{ type: "tool", tool: "bash", state: { status: "completed" } }],
      },
      {
        info: { id: "a2", role: "assistant", finish: "tool-calls", time: { completed: 3 } },
        parts: [{ type: "tool", tool: "bash", state: { status: "completed" } }],
      },
      {
        info: { id: "a3", role: "assistant", finish: "tool-calls", time: { completed: 4 } },
        parts: [{ type: "tool", tool: "bash", state: { status: "completed" } }],
      },
      {
        info: {
          id: "msg_fb6c900800012yRGKR9pTpMiMT",
          role: "assistant",
          finish: "stop",
          time: { completed: 5 },
        },
        parts: [
          { type: "step-start" },
          { type: "reasoning", text: reasoning },
          { type: "step-finish" },
        ],
      },
    ],
  });
  assert.ok(hit);
  assert.equal(hit!.messageId, "msg_fb6c900800012yRGKR9pTpMiMT");
  assert.equal(hit!.recoverableQuestion, false);
  assert.equal(hit!.recoveredMarkdown, null);
});

test("auto-continue context reuses silent marker and forbids XML reasoning", () => {
  const text = buildEmptyVisibleReplyAutoContinueSystemContext("question");
  assert.equal(text.startsWith(EMPTY_VISIBLE_REPLY_AUTO_CONTINUE_MARKER), true);
  assert.equal(isStuckToolAutoContinueText(EMPTY_VISIBLE_REPLY_AUTO_CONTINUE_MARKER), true);
  assert.match(text, /原生 question/);
  assert.match(text, /禁止.*tool_call/);
});

test("reasoning-only auto-continue context asks for visible prose", () => {
  const text = buildEmptyVisibleReplyAutoContinueSystemContext(null);
  assert.equal(text.startsWith(EMPTY_VISIBLE_REPLY_AUTO_CONTINUE_MARKER), true);
  assert.match(text, /可见正文/);
  assert.match(text, /thinking 空停|reasoning/);
});

test("collectHiddenAssistantCorpus joins reasoning and text", () => {
  const corpus = collectHiddenAssistantCorpus([
    { type: "reasoning", text: "r1" },
    { type: "text", text: "t1" },
    { type: "file" },
  ]);
  assert.equal(corpus, "r1\nt1");
});

test("recoverVisibleMarkdownFromHiddenCorpus returns null for non-question tools", () => {
  const corpus = `<tool_call><invoke name="bash"><parameter>ls</parameter></invoke></tool_call>`;
  const recovered = recoverVisibleMarkdownFromHiddenCorpus(corpus);
  assert.equal(recovered.toolName, "bash");
  assert.equal(recovered.recoverableQuestion, false);
  assert.equal(recovered.recoveredMarkdown, null);
});

test("integration patch materializes the empty-visible recovery module", async () => {
  const patcher = await readFile(
    new URL("../../../scripts/apply-openwork-integration.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    patcher,
    /fork\/apps\/app\/src\/react-app\/domains\/session\/surface\/empty-visible-reply-recovery\.ts/,
  );
});
