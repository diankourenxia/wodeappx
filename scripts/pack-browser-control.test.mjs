import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { buildExtensionArchive } from "./pack-browser-control.mjs";

test("browser extension archive is deterministic and contains runtime files only", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "wodeappx-browser-zip-"));
  const first = path.join(directory, "first.zip");
  const second = path.join(directory, "second.zip");
  const one = await buildExtensionArchive(first);
  const two = await buildExtensionArchive(second);
  assert.deepEqual(await readFile(first), await readFile(second));
  assert.deepEqual(one.files, two.files);
  assert.ok(one.files.includes("manifest.json"));
  assert.ok(one.files.includes("icons/icon128.png"));
  assert.ok(one.files.every((name) => !name.startsWith("__MACOSX/")));
  assert.ok(one.files.every((name) => !name.startsWith("store-assets/")));
  assert.ok(one.files.every((name) => !name.startsWith("store-screenshots/")));
  assert.ok(!one.files.includes("STORE_LISTING.md"));
});
