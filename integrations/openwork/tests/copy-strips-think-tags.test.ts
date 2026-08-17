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
const utilsPath = path.join(
  here,
  "../../../vendor/openwork/apps/app/src/components/chat/utils.ts",
);
const sessionSurfacePath = path.join(
  here,
  "../fork/apps/app/src/react-app/domains/session/surface/session-surface.tsx",
);
const applyScriptPath = path.join(here, "../../../scripts/apply-openwork-integration.mjs");

/** Mirror of getMessagesText for assistant: visible answer only. */
function copyVisibleAssistantText(raw: string): string {
  const segments = splitAssistantThinkText(raw, false);
  if (!segments) return stripProviderThinkTags(raw).trim();
  return segments
    .filter((segment) => segment.kind === "text")
    .map((segment) => segment.text)
    .join("\n\n")
    .trim();
}

test("copy path drops provider <think> framing from assistant text", () => {
  const raw =
    "<think>Work tree has many uncommitted changes…</think>\n\n软墙结论接受，校准假设。";
  const copied = copyVisibleAssistantText(raw);
  assert.equal(copied, "软墙结论接受，校准假设。");
  assert.doesNotMatch(copied, /<\/?think\b/i);
});

test("copy path drops a pure think bubble", () => {
  const copied = copyVisibleAssistantText("<think>internal only</think>");
  assert.equal(copied, "");
});

test("vendor getMessagesText uses visible assistant groups + stripProviderThinkTags", async () => {
  const source = await readFile(utilsPath, "utf8");
  assert.match(source, /stripProviderThinkTags/);
  assert.match(source, /getAssistantRenderGroups\(message\.parts, false\)/);
  assert.match(source, /group\.kind === "text"/);
  assert.match(source, /never paste provider/);
});

test("session transcript copy skips reasoning and strips think tags", async () => {
  const source = await readFile(sessionSurfacePath, "utf8");
  assert.match(source, /stripProviderThinkTags/);
  assert.match(source, /if \(part\.type === "reasoning"\) return \[\]/);
  assert.match(source, /stripProviderThinkTags\(part\.text\)/);
});

test("apply integration keeps the copy-strip think patch", async () => {
  const source = await readFile(applyScriptPath, "utf8");
  assert.match(source, /Assistant think-text copy strip anchor/);
  assert.match(source, /getAssistantRenderGroups\(message\.parts, false\)/);
  assert.match(source, /stripProviderThinkTags/);
});
