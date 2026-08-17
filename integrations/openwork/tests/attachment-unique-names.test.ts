import assert from "node:assert/strict";
import test from "node:test";

import {
  isGenericClipboardAttachmentName,
  uniquifyComposerAttachmentFileName,
  uniquifyComposerAttachmentFiles,
} from "../fork/apps/app/src/react-app/domains/session/sync/attachment-support.ts";

test("detects generic clipboard screenshot names", () => {
  assert.equal(isGenericClipboardAttachmentName("image.png"), true);
  assert.equal(isGenericClipboardAttachmentName("image.jpg"), true);
  assert.equal(isGenericClipboardAttachmentName("Screenshot 2026-08-05.png"), false);
  assert.equal(isGenericClipboardAttachmentName("brief.pdf"), false);
});

test("renames clipboard image.png to a unique paste-* name", () => {
  const used = new Set<string>();
  const first = uniquifyComposerAttachmentFileName(
    { name: "image.png", type: "image/png" },
    used,
    Date.parse("2026-08-05T02:12:19.783Z"),
  );
  const second = uniquifyComposerAttachmentFileName(
    { name: "image.png", type: "image/png" },
    used,
    Date.parse("2026-08-05T02:12:19.783Z"),
  );
  assert.match(first, /^paste-\d{14}-[a-z0-9]+\.png$/i);
  assert.match(second, /^paste-\d{14}-[a-z0-9]+(?:-\d+)?\.png$/i);
  assert.notEqual(first.toLowerCase(), second.toLowerCase());
});

test("uniquifyComposerAttachmentFiles rewrites File.name for clipboard pastes", () => {
  const file = new File([Uint8Array.from([1, 2, 3])], "image.png", { type: "image/png" });
  const [renamed] = uniquifyComposerAttachmentFiles([file], []);
  assert.ok(renamed);
  assert.notEqual(renamed.name, "image.png");
  assert.match(renamed.name, /^paste-.+\.png$/i);
});
