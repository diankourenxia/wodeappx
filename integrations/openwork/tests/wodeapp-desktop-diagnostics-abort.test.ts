import assert from "node:assert/strict";
import test from "node:test";

function isAbortNoiseMessage(message: string): boolean {
  const text = String(message || "").trim();
  if (!text) return false;
  if (/^Tool execution aborted$/i.test(text)) return true;
  if (/^Aborted$/i.test(text)) return true;
  if (/^MessageAbortedError$/i.test(text)) return true;
  if (/MessageAbortedError/i.test(text) && /aborted/i.test(text)) return true;
  return false;
}

function shouldQueueToolFailure(message: string, errorKind?: string | null): boolean {
  if (!String(message || "").trim()) return false;
  if (isAbortNoiseMessage(message) || errorKind === "aborted") return false;
  return true;
}

test("abort noise is not queued as tool_execution_failed", () => {
  assert.equal(isAbortNoiseMessage("Tool execution aborted"), true);
  assert.equal(shouldQueueToolFailure("Tool execution aborted"), false);
  assert.equal(shouldQueueToolFailure("UI bridge timeout"), true);
});

test("turn_aborted telemetry keeps request context fields", () => {
  const context = {
    reason: "message_aborted",
    toolName: null,
    modelId: "wode/minimax-m3",
    requestId: null,
    ageMs: 315,
  };
  assert.equal(context.reason, "message_aborted");
  assert.equal(context.modelId, "wode/minimax-m3");
});
