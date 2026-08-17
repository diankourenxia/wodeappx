import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  canFlushQueuedDrafts,
  listVisibleQueuedDraftEntries,
  pickQueuedDraftFlushIndex,
  retainNonSilentQueuedDrafts,
} from "../fork/apps/app/src/react-app/domains/session/surface/queued-draft-flush.ts";

const SILENT = "以下是WodeAppX 的系统自动续跑指令（非用户发言）。";
const isSilent = (text: string | undefined) => (text || "").trim() === SILENT;

test("auto-idle drains when OpenCode is idle even if local UI still looks busy", () => {
  // Regression: conversation finished (live idle, not sending) but sticky
  // hasWodeAppLocalActivity / awaitingAssistantBaseline kept chatStreaming true.
  assert.equal(
    canFlushQueuedDrafts({
      mode: "auto-idle",
      queueLength: 1,
      draining: false,
      openCodeRunActive: false,
      liveStatusType: "idle",
    }),
    true,
  );
});

test("auto-idle does not drain while OpenCode run is still active", () => {
  assert.equal(
    canFlushQueuedDrafts({
      mode: "auto-idle",
      queueLength: 2,
      draining: false,
      openCodeRunActive: true,
      liveStatusType: "busy",
    }),
    false,
  );
  assert.equal(
    canFlushQueuedDrafts({
      mode: "auto-idle",
      queueLength: 1,
      draining: false,
      openCodeRunActive: true,
      liveStatusType: "idle", // sending gap before busy event
    }),
    false,
  );
  assert.equal(
    canFlushQueuedDrafts({
      mode: "auto-idle",
      queueLength: 1,
      draining: false,
      openCodeRunActive: false,
      liveStatusType: "retry",
    }),
    false,
  );
});

test("auto-idle pauses after manual Stop so queued follow-ups stay visible", () => {
  // Regression: Stop used to clearQueuedDrafts; keep the queue and gate drain
  // with userStopped so abort→idle cannot instantly re-prompt (#2014).
  assert.equal(
    canFlushQueuedDrafts({
      mode: "auto-idle",
      queueLength: 3,
      draining: false,
      openCodeRunActive: false,
      liveStatusType: "idle",
      userStopped: true,
    }),
    false,
  );
  assert.equal(
    canFlushQueuedDrafts({
      mode: "now",
      queueLength: 3,
      draining: false,
      openCodeRunActive: false,
      liveStatusType: "idle",
      userStopped: true,
      index: 0,
    }),
    true,
  );
});

test("now mode can flush a single index even mid-run", () => {
  assert.equal(
    canFlushQueuedDrafts({
      mode: "now",
      queueLength: 3,
      draining: false,
      openCodeRunActive: true,
      liveStatusType: "busy",
      index: 1,
    }),
    true,
  );
  assert.equal(
    canFlushQueuedDrafts({
      mode: "now",
      queueLength: 3,
      draining: false,
      openCodeRunActive: true,
      liveStatusType: "busy",
      index: 3,
    }),
    false,
  );
});

test("pickQueuedDraftFlushIndex prefers silent auto-continue on auto-idle", () => {
  assert.equal(
    pickQueuedDraftFlushIndex(
      "auto-idle",
      [{ text: "user follow-up" }, { text: SILENT }, { text: "another" }],
      undefined,
      isSilent,
    ),
    1,
  );
  assert.equal(
    pickQueuedDraftFlushIndex(
      "auto-idle",
      [{ text: "only user" }],
      undefined,
      isSilent,
    ),
    0,
  );
  assert.equal(
    pickQueuedDraftFlushIndex(
      "now",
      [{ text: "a" }, { text: "b" }],
      1,
      isSilent,
    ),
    1,
  );
});

test("visible queue hides silent auto-continue after user already sent", () => {
  // Screenshot bug: system continue stayed in "已排队 1 条" after the user
  // successfully sent a real follow-up. Panel must not show silent drafts.
  const drafts = [
    { text: SILENT },
    { text: "先做前三集" },
  ];
  const visible = listVisibleQueuedDraftEntries(drafts, isSilent);
  assert.equal(visible.length, 1);
  assert.equal(visible[0]?.index, 1);
  assert.equal(visible[0]?.draft.text, "先做前三集");

  const purged = retainNonSilentQueuedDrafts(drafts, isSilent);
  assert.deepEqual(purged.map((d) => d.text), ["先做前三集"]);
  assert.deepEqual(retainNonSilentQueuedDrafts([{ text: SILENT }], isSilent), []);
});

test("integration patch materializes the queued draft flush module", async () => {
  const patcher = await readFile(
    new URL("../../../scripts/apply-openwork-integration.mjs", import.meta.url),
    "utf8",
  );
  assert.match(
    patcher,
    /fork\/apps\/app\/src\/react-app\/domains\/session\/surface\/queued-draft-flush\.ts/,
  );
});
