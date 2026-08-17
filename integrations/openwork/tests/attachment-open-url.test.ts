import assert from "node:assert/strict";
import test from "node:test";

import {
  isOpenableAttachmentUrl,
  isStubAttachmentUrl,
  toFileUrlFromAbsolutePath,
} from "../fork/apps/app/src/components/chat/message-file-display.ts";

test("optimistic:// is a stub and never openable", () => {
  const url = "optimistic://attachment/295fa96dc564e18ed81d69b7d5c3a3a7.mp4";
  assert.equal(isStubAttachmentUrl(url), true);
  assert.equal(isOpenableAttachmentUrl(url), false);
});

test("file:// and https remain openable", () => {
  assert.equal(isOpenableAttachmentUrl("file:///Users/test/clip.mp4"), true);
  assert.equal(isOpenableAttachmentUrl("https://assets.example/a.mp4"), true);
  assert.equal(isStubAttachmentUrl("file:///Users/test/clip.mp4"), false);
});

test("toFileUrlFromAbsolutePath encodes absolute paths", () => {
  assert.equal(
    toFileUrlFromAbsolutePath("/Users/test/Downloads/clip.mp4"),
    "file:///Users/test/Downloads/clip.mp4",
  );
  assert.equal(toFileUrlFromAbsolutePath("optimistic://attachment/x.mp4"), null);
});
