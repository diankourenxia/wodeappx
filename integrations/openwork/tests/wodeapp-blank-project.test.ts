import assert from "node:assert/strict";
import test from "node:test";

import {
  blankProjectName,
  formatBlankProjectStamp,
  resolveBlankProjectFolderPath,
} from "../wodeapp/wodeapp-blank-project.ts";

test("formatBlankProjectStamp is zero-padded and sortable", () => {
  const stamp = formatBlankProjectStamp(new Date(2026, 6, 24, 9, 5, 7));
  assert.equal(stamp, "20260724-090507");
});

test("blankProjectName uses 项目- prefix", () => {
  assert.match(blankProjectName(new Date(2026, 0, 2, 3, 4, 5)), /^项目-20260102-030405$/);
});

test("resolveBlankProjectFolderPath prefers default-workspace sibling projects dir", () => {
  const path = resolveBlankProjectFolderPath(
    [
      "/Users/mac/Desktop/wodeapp",
      "/Users/mac/Library/Application Support/com.differentai.openwork/default-workspace",
    ],
    "项目-demo",
  );
  assert.equal(
    path,
    "/Users/mac/Library/Application Support/com.differentai.openwork/projects/项目-demo",
  );
});

test("resolveBlankProjectFolderPath falls back beside first local workspace", () => {
  const path = resolveBlankProjectFolderPath(
    ["/Users/mac/Desktop/shop-a"],
    "项目-demo",
  );
  assert.equal(path, "/Users/mac/Desktop/projects/项目-demo");
});

test("resolveBlankProjectFolderPath returns null without workspace paths", () => {
  assert.equal(resolveBlankProjectFolderPath([]), null);
});
