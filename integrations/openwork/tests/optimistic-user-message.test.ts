import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";

import {
  OPTIMISTIC_USER_MESSAGE_PREFIX,
  buildOptimisticUserMessage,
  isOptimisticUserMessage,
  mergeOptimisticUserMessage,
  shouldClearOptimisticUserMessage,
} from "../fork/apps/app/src/react-app/domains/session/surface/optimistic-user-message.ts";

test("buildOptimisticUserMessage creates a local user bubble", () => {
  const message = buildOptimisticUserMessage("继续");
  assert.equal(message.role, "user");
  assert.equal(isOptimisticUserMessage(message), true);
  assert.ok(message.id.startsWith(OPTIMISTIC_USER_MESSAGE_PREFIX));
  assert.equal((message.parts[0] as { text?: string }).text, "继续");
});

test("optimistic attachments use file:// when a local path is known", () => {
  const message = buildOptimisticUserMessage("参考这个视频", [
    { name: "clip.mp4", mimeType: "video/mp4", path: "/Users/test/Downloads/clip.mp4" },
  ]);
  const filePart = message.parts.find((part) => part.type === "file") as {
    url?: string;
    filename?: string;
    mediaType?: string;
  };
  assert.equal(filePart?.filename, "clip.mp4");
  assert.equal(filePart?.mediaType, "video/mp4");
  assert.equal(filePart?.url, "file:///Users/test/Downloads/clip.mp4");
  assert.equal(String(filePart?.url || "").includes("optimistic://"), false);
});

test("optimistic attachments omit chips without a real openable path (no data stub)", () => {
  const message = buildOptimisticUserMessage("参考这个视频", [
    { name: "295fa96dc564e18ed81d69b7d5c3a3a7.mp4", mimeType: "video/mp4" },
  ]);
  assert.equal(message.parts.some((part) => part.type === "file"), false);
  assert.equal(
    message.parts.some((part) => String((part as { url?: string }).url || "").includes("optimistic://")),
    false,
  );
  assert.equal(
    message.parts.some((part) => String((part as { url?: string }).url || "").startsWith("data:")),
    false,
  );
});

test("optimistic bubble clears once the server user turn appears", () => {
  const pending = buildOptimisticUserMessage("继续");
  const rendered: UIMessage[] = [
    { id: "msg_old", role: "assistant", parts: [{ type: "text", text: "ok" }] },
    { id: "msg_real", role: "user", parts: [{ type: "text", text: "继续" }] },
  ];
  assert.equal(shouldClearOptimisticUserMessage(pending, rendered, { baselineMessageCount: 1 }), true);
  assert.deepEqual(mergeOptimisticUserMessage(rendered, pending, { baselineMessageCount: 1 }), rendered);
});

test("optimistic bubble stays until the server echoes the same text", () => {
  const pending = buildOptimisticUserMessage("继续");
  const rendered: UIMessage[] = [
    { id: "msg_old", role: "assistant", parts: [{ type: "text", text: "thinking" }] },
  ];
  assert.equal(shouldClearOptimisticUserMessage(pending, rendered, { baselineMessageCount: 1 }), false);
  const merged = mergeOptimisticUserMessage(rendered, pending, { baselineMessageCount: 1 });
  assert.equal(merged.length, 2);
  assert.equal(merged[1]?.id, pending.id);
});

test("repeating the same prompt does not clear against the previous user turn", () => {
  const pending = buildOptimisticUserMessage("你好");
  const rendered: UIMessage[] = [
    { id: "msg_prev_user", role: "user", parts: [{ type: "text", text: "你好" }] },
    { id: "msg_prev_asst", role: "assistant", parts: [{ type: "text", text: "你好！" }] },
  ];
  assert.equal(
    shouldClearOptimisticUserMessage(pending, rendered, { baselineMessageCount: rendered.length }),
    false,
  );
  const merged = mergeOptimisticUserMessage(rendered, pending, { baselineMessageCount: rendered.length });
  assert.equal(merged.length, 3);
  assert.equal(merged[2]?.id, pending.id);
});

test("empty user transport shell does not clear the optimistic bubble", () => {
  const pending = buildOptimisticUserMessage("你好");
  const rendered: UIMessage[] = [
    { id: "msg_prev_asst", role: "assistant", parts: [{ type: "text", text: "ok" }] },
    { id: "msg_shell", role: "user", parts: [] },
  ];
  assert.equal(
    shouldClearOptimisticUserMessage(pending, rendered, { baselineMessageCount: 1 }),
    false,
  );
  const merged = mergeOptimisticUserMessage(rendered, pending, { baselineMessageCount: 1 });
  assert.equal(merged.at(-1)?.id, pending.id);
});

test("new echoed user turn after baseline clears optimistic", () => {
  const pending = buildOptimisticUserMessage("你好");
  const rendered: UIMessage[] = [
    { id: "msg_prev_user", role: "user", parts: [{ type: "text", text: "你好" }] },
    { id: "msg_prev_asst", role: "assistant", parts: [{ type: "text", text: "你好！" }] },
    { id: "msg_new_user", role: "user", parts: [{ type: "text", text: "你好" }] },
  ];
  assert.equal(
    shouldClearOptimisticUserMessage(pending, rendered, { baselineMessageCount: 2 }),
    true,
  );
});
