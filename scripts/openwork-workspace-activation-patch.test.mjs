import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  patchWorkspaceActivationReload,
  SAFE_ACTIVATION_COMMENT,
} from "./openwork-workspace-activation-patch.mjs";

/** Windows CI may check out fixtures as CRLF; assert against LF always. */
function lf(value) {
  return String(value).replace(/\r\n/g, "\n");
}

const currentVendorFixture = lf(
  await readFile(
    new URL("./fixtures/openwork-workspaces-activation-current.txt", import.meta.url),
    "utf8",
  ),
);

const commentPattern = new RegExp(
  SAFE_ACTIVATION_COMMENT.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
);

test("patches the current !wasActive vendor fixture and removes unused bindings", () => {
  const result = patchWorkspaceActivationReload(currentVendorFixture);

  assert.equal(result.changed, true);
  assert.match(lf(result.content), commentPattern);
  assert.doesNotMatch(lf(result.content), /await\s+reloadOpencodeEngine\s*\(/);
  assert.doesNotMatch(lf(result.content), /^\s*reloadOpencodeEngine,\s*$/m);
  assert.doesNotMatch(lf(result.content), /\bconst\s+wasActive\b/);
  assert.match(lf(result.content), /reloadOpencodeEngine:/);
});

test("patches CRLF fixtures the same way Windows checkout does", () => {
  const crlfFixture = currentVendorFixture.replace(/\n/g, "\r\n");
  const result = patchWorkspaceActivationReload(crlfFixture);

  assert.equal(result.changed, true);
  assert.match(result.content, /\r\n/);
  assert.match(lf(result.content), commentPattern);
  assert.doesNotMatch(lf(result.content), /await\s+reloadOpencodeEngine\s*\(/);
});

test("patches the pinned OpenWork 0.17.3 single-line activation condition", () => {
  const oldVendorFixture = currentVendorFixture
    .replace("    const wasActive = config.workspaces[0]?.id === workspace.id;\n", "")
    .replace(
      `    if (
      !wasActive &&
      workspace.workspaceType === "local" &&
      resolveWorkspaceOpencodeConnection(config, workspace).baseUrl?.trim()
    ) {`,
      `    if (workspace.workspaceType === "local" && resolveWorkspaceOpencodeConnection(config, workspace).baseUrl?.trim()) {`,
    );

  const result = patchWorkspaceActivationReload(oldVendorFixture);

  assert.equal(result.changed, true);
  assert.match(lf(result.content), /activation must stay non-\n\s*\/\/ destructive\./);
  assert.doesNotMatch(lf(result.content), /await\s+reloadOpencodeEngine\s*\(/);
});

test("is idempotent when the current vendor fixture is patched twice", () => {
  const first = patchWorkspaceActivationReload(currentVendorFixture);
  const second = patchWorkspaceActivationReload(first.content);

  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(second.content, first.content);
});

test("fails closed for an unrelated activation reload condition", () => {
  const unsupported = currentVendorFixture.replace(
    "!wasActive &&",
    "forceReload &&",
  );

  assert.throws(
    () => patchWorkspaceActivationReload(unsupported),
    /supported workspace activation reload/,
  );
});
