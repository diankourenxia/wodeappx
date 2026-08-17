import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildTruncatedOutputAutoContinueSystemContext,
  findTruncatedOutputAssistantTurn,
  looksLikeIncompleteVisibleReply,
} from "../fork/apps/app/src/react-app/domains/session/surface/truncated-output-recovery.ts";

test("looksLikeIncompleteVisibleReply catches ses_01562a mid-promise stops", () => {
  assert.equal(
    looksLikeIncompleteVisibleReply("标题已改好。现在把带分段配色和照片的完整页面写进去："),
    true,
  );
  assert.equal(
    looksLikeIncompleteVisibleReply("没断，刚才是我在提交大段页面配置时卡住了。现在重新把完整页面（分段配色 + "),
    true,
  );
  assert.equal(
    looksLikeIncompleteVisibleReply("线路图已发布：https://example.wodeapp.cn"),
    false,
  );
  assert.equal(
    looksLikeIncompleteVisibleReply("已完成更新并发布。"),
    false,
  );
});

test("findTruncatedOutputAssistantTurn recovers finish=length", () => {
  const hit = findTruncatedOutputAssistantTurn({
    status: { type: "idle" },
    messages: [
      { info: { id: "u1", role: "user", time: { created: 1 } }, parts: [{ type: "text", text: "发布" }] },
      {
        info: {
          id: "a1",
          role: "assistant",
          finish: "length",
          time: { created: 2, completed: 3 },
        },
        parts: [
          { type: "text", text: "正在写入…" },
          {
            type: "tool",
            tool: "wodeapp-platform_update_page",
            state: { status: "error" },
          },
        ],
      },
    ],
  });
  assert.ok(hit);
  assert.equal(hit?.kind, "length");
  assert.equal(hit?.messageId, "a1");
});

test("findTruncatedOutputAssistantTurn recovers incomplete stop without tool result", () => {
  const hit = findTruncatedOutputAssistantTurn({
    status: { type: "idle" },
    messages: [
      { info: { id: "u1", role: "user", time: { created: 1 } }, parts: [{ type: "text", text: "怎么断了" }] },
      {
        info: {
          id: "a2",
          role: "assistant",
          finish: "stop",
          time: { created: 2, completed: 3 },
        },
        parts: [
          {
            type: "text",
            text: "没断，刚才是我在提交大段页面配置时卡住了。现在重新把完整页面（分段配色 + ",
          },
        ],
      },
    ],
  });
  assert.ok(hit);
  assert.equal(hit?.kind, "incomplete_visible");
});

test("incomplete stop with a completed tool is not treated as truncated hang", () => {
  const hit = findTruncatedOutputAssistantTurn({
    status: { type: "idle" },
    messages: [
      { info: { id: "u1", role: "user", time: { created: 1 } }, parts: [{ type: "text", text: "改标题" }] },
      {
        info: {
          id: "a3",
          role: "assistant",
          finish: "stop",
          time: { created: 2, completed: 3 },
        },
        parts: [
          { type: "text", text: "标题已改好。现在把完整页面写进去：" },
          {
            type: "tool",
            tool: "wodeapp-platform_update_page",
            state: { status: "completed" },
          },
        ],
      },
    ],
  });
  assert.equal(hit, null);
});

test("busy status skips truncated recovery", () => {
  const hit = findTruncatedOutputAssistantTurn({
    status: { type: "busy" },
    messages: [
      { info: { id: "u1", role: "user", time: { created: 1 } }, parts: [{ type: "text", text: "发布" }] },
      {
        info: {
          id: "a1",
          role: "assistant",
          finish: "length",
          time: { created: 2, completed: 3 },
        },
        parts: [{ type: "text", text: "…" }],
      },
    ],
  });
  assert.equal(hit, null);
});

test("auto-continue context forces shrink-payload path", () => {
  const ctx = buildTruncatedOutputAutoContinueSystemContext("length");
  assert.match(ctx, /系统自动续跑指令/);
  assert.match(ctx, /finish=length/);
  assert.match(ctx, /禁止再次把超大 config/);
  assert.match(ctx, /write/);
});

test("integration patch materializes the truncated-output recovery module", async () => {
  const patcher = await readFile(
    new URL("../../../scripts/apply-openwork-integration.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    patcher,
    /fork\/apps\/app\/src\/react-app\/domains\/session\/surface\/truncated-output-recovery\.ts/,
  );
});
