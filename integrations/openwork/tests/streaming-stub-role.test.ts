import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  splitAssistantThinkText,
  stripProviderThinkTags,
} from "../wodeapp/assistant-think-text.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const sessionSyncPath = path.join(
  here,
  "../fork/apps/app/src/react-app/domains/session/sync/session-sync.ts",
);
const messageListPath = path.join(
  here,
  "../fork/apps/app/src/components/chat/message-list.tsx",
);
const applyScriptPath = path.join(here, "../../../scripts/apply-openwork-integration.mjs");

test("session-sync defaults unknown streaming stubs to assistant (no role alternation)", async () => {
  const source = await readFile(sessionSyncPath, "utf8");
  assert.match(source, /export function stubRoleForUnknownMessage\(\)/);
  assert.match(source, /return "assistant"/);
  assert.match(source, /stubRoleForUnknownMessage\(\)/);
  assert.doesNotMatch(source, /function inferStubRole\(/);
  assert.doesNotMatch(source, /if \(lastMessage\.role === "assistant"\) return "user"/);
  assert.doesNotMatch(source, /inferStubRole\(current\)/);
  assert.doesNotMatch(source, /inferStubRole\(next\)/);
});

test("apply integration keeps the assistant-default stub copy + patch", async () => {
  const source = await readFile(applyScriptPath, "utf8");
  assert.match(source, /stubRoleForUnknownMessage/);
  assert.match(
    source,
    /\[\"fork\/apps\/app\/src\/react-app\/domains\/session\/sync\/session-sync\.ts\"/,
  );
});

test("stripProviderThinkTags removes framing without collapsing real newlines", () => {
  const text = "line 1\n\n<think>internal draft</think>\nline 2";
  assert.equal(stripProviderThinkTags(text), "line 1\n\n\nline 2");
});

test("stripProviderThinkTags hides a pure think bubble mislabeled as user content", () => {
  const text = "<think>Same $text issue. Retry with objects.</think>";
  assert.equal(stripProviderThinkTags(text).trim(), "");
  assert.deepEqual(splitAssistantThinkText(text), [
    { kind: "reasoning", text: "Same $text issue. Retry with objects." },
  ]);
});

test("UserMessage strips provider think tags before rendering", async () => {
  const source = await readFile(messageListPath, "utf8");
  assert.match(source, /stripProviderThinkTags/);
  assert.match(source, /from "@\/react-app\/domains\/wodeapp\/assistant-think-text"/);
});

test("think-only streams do not count as visible live content (avoids blank gap)", async () => {
  const source = await readFile(messageListPath, "utf8");
  assert.match(source, /function assistantTextHasVisibleProse/);
  assert.match(source, /return assistantTextHasVisibleProse\(part\.text\)/);
  assert.match(source, /const visible = stripProviderThinkTags\(part\.text\)\.trim\(\)/);
  assert.match(
    source,
    /Raw <think> must not count — otherwise Waiting is suppressed/,
  );
});
