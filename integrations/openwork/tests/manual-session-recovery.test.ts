import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const integrationRoot = path.resolve(here, "..");

async function sessionSurfaceSource(): Promise<string> {
  return readFile(
    path.join(
      integrationRoot,
      "fork/apps/app/src/react-app/domains/session/surface/session-surface.tsx",
    ),
    "utf8",
  );
}

test("manual Stop latches userStopped so silent auto-continue cannot revive the run", async () => {
  const source = await sessionSurfaceSource();
  assert.match(source, /userStoppedRef/);
  assert.match(source, /userStoppedRef\.current = true/);
  assert.match(
    source,
    /if \(userStoppedRef\.current\) \{[\s\S]*?return false;/,
  );
  // Real user sends clear the latch; silent auto-continue drafts must not.
  assert.match(
    source,
    /if \(!silentAutoContinue\) \{\s*userStoppedRef\.current = false/s,
  );
  // Failed abort releases the latch so recoveries can still help.
  assert.match(source, /Abort did not land/);
});

test("manual Stop keeps user queued drafts and only pauses auto-idle drain", async () => {
  const source = await sessionSurfaceSource();
  const start = source.indexOf("const handleAbort = useCallback");
  const end = source.indexOf("const handleDismissError", start);
  assert.ok(start > 0 && end > start);
  const abort = source.slice(start, end);
  assert.match(abort, /Keep user follow-ups after Stop/);
  assert.match(abort, /retainNonSilentQueuedDrafts/);
  assert.match(abort, /userStoppedRef\.current = true/);
  // Must not wipe the whole queue on Stop (old #2014 blunt fix).
  assert.doesNotMatch(
    abort,
    /drop queued follow-ups before aborting[\s\S]*clearQueuedDrafts\(props\.sessionId\);\s*\n\s*\/\/ Latch/,
  );
  assert.match(source, /userStopped:\s*userStoppedRef\.current/);
});

test("all session recoveries silently auto-continue — no continue/ignore banner", async () => {
  const source = await sessionSurfaceSource();
  assert.doesNotMatch(source, /manual-recovery-notice/);
  assert.doesNotMatch(source, /继续任务/);
  assert.doesNotMatch(source, /offerManualRecovery/);
  assert.doesNotMatch(source, /handleManualRecovery/);
  assert.doesNotMatch(source, /ManualRecoveryRequest/);
  assert.match(source, /sendSilentAutoContinue/);
  assert.match(source, /STUCK_TOOL_AUTO_CONTINUE_MAX/);
});

test("stuck-tool recovery silently auto-continues after abort", async () => {
  const source = await sessionSurfaceSource();
  const start = source.indexOf("// Empty-args auto-abort");
  const end = source.indexOf("// Blank idle finish:");
  assert.ok(start > 0 && end > start);

  const stuckBlock = source.slice(start, end);
  assert.match(stuckBlock, /abortSessionSafe/);
  assert.match(stuckBlock, /sendSilentAutoContinue/);
  assert.match(stuckBlock, /buildStuckToolAutoContinueSystemContext/);
});

test("idle recoveries also call sendSilentAutoContinue", async () => {
  const source = await sessionSurfaceSource();
  const start = source.indexOf("// Blank idle finish:");
  const end = source.indexOf("props.onDraftChange(buildDraft(draft, attachments))");
  assert.ok(start > 0 && end > start);

  const effects = source.slice(start, end);
  assert.match(effects, /sendSilentAutoContinue\(buildEmptyVisibleReplyAutoContinueSystemContext/);
  assert.match(effects, /findTruncatedOutputAssistantTurn/);
  assert.match(effects, /buildTruncatedOutputAutoContinueSystemContext/);
  assert.match(effects, /buildOrphanedRunningToolAutoContinueSystemContext/);
  assert.match(effects, /sendSilentAutoContinue\(systemContext\)/);
  assert.match(effects, /sendSilentAutoContinue\(buildStalledBackgroundBashAutoContinueSystemContext/);
  assert.doesNotMatch(effects, /offerManualRecovery/);
});

test("legacy synthetic recovery drafts are dropped before idle queue drain", async () => {
  const source = await sessionSurfaceSource();
  const flushStart = source.indexOf("const flushQueuedDrafts");
  const flushEnd = source.indexOf("const handleSendQueuedNow", flushStart);
  assert.ok(flushStart > 0 && flushEnd > flushStart);

  const flush = source.slice(flushStart, flushEnd);
  assert.match(flush, /mode === "auto-idle"/);
  assert.match(flush, /retainNonSilentQueuedDrafts/);
  assert.match(flush, /return false/);
});
