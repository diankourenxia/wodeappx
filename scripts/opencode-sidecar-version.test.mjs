import assert from "node:assert/strict";
import test from "node:test";

import {
  WODEAPPX_OPENCODE_SIDECAR_VERSION,
  mergeOpenCodeSidecarConstants,
} from "./opencode-sidecar-version.mjs";

test("pins OpenWork 0.17.3 sidecar 1.17.11 up to the 1.18.16 patch target", () => {
  assert.equal(WODEAPPX_OPENCODE_SIDECAR_VERSION, "v1.18.16");
  const merged = mergeOpenCodeSidecarConstants({ opencodeVersion: "v1.17.11" });
  assert.equal(merged.opencodeVersion, "v1.18.16");
});

test("keeps unrelated constants.json keys", () => {
  const merged = mergeOpenCodeSidecarConstants({ extra: true, opencodeVersion: "v1.17.11" });
  assert.equal(merged.extra, true);
  assert.equal(merged.opencodeVersion, "v1.18.16");
});
