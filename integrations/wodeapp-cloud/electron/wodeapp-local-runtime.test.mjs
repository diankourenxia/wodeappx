#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  listLocalOriginCandidates,
  describeLocalRuntimePlan,
  shouldAutoStartLocalSidecar,
  looksLikeMonorepoRoot,
  resolveLocalRuntimeDataDir,
  resolveLocalSidecarMonorepoRoot,
} from "./wodeapp-local-runtime.mjs";

test("lists local origins with env override first", () => {
  const previous = process.env.WODEAPPX_LOCAL_ORIGIN;
  process.env.WODEAPPX_LOCAL_ORIGIN = "http://127.0.0.1:3999";
  try {
    const list = listLocalOriginCandidates(["http://127.0.0.1:3000"]);
    assert.equal(list[0], "http://127.0.0.1:3999");
    assert.ok(list.includes("http://127.0.0.1:3000"));
  } finally {
    if (previous == null) delete process.env.WODEAPPX_LOCAL_ORIGIN;
    else process.env.WODEAPPX_LOCAL_ORIGIN = previous;
  }
});

test("describes mvp local runtime data dir", () => {
  const plan = describeLocalRuntimePlan("/tmp/wodeappx-user");
  assert.equal(plan.status, "mvp");
  assert.match(plan.dataDir, /wodeapp-local-runtime$/);
  assert.match(plan.note, /optional|OPEN_SOURCE|Postgres/i);
});

test("auto-start respects flag / profile / oss+monorepo", () => {
  assert.equal(shouldAutoStartLocalSidecar({ env: { WODEAPPX_LOCAL_SIDECAR: "0" }, monorepoRoot: "/x" }), false);
  assert.equal(shouldAutoStartLocalSidecar({ env: { WODEAPPX_LOCAL_SIDECAR: "1" } }), true);
  assert.equal(shouldAutoStartLocalSidecar({ env: {}, profile: "local-only" }), true);
  assert.equal(shouldAutoStartLocalSidecar({ env: {}, edition: "oss", monorepoRoot: "/repo" }), true);
  assert.equal(shouldAutoStartLocalSidecar({ env: {}, edition: "oss", monorepoRoot: "" }), false);
  assert.equal(shouldAutoStartLocalSidecar({ env: {}, edition: "oss", monorepoRoot: "/repo", packaged: true }), false);
  assert.equal(shouldAutoStartLocalSidecar({ env: { WODEAPPX_LOCAL_SIDECAR: "1" }, packaged: true }), true);
});

test("packaged trees do not walk Desktop/wodeapp for sidecar", () => {
  assert.equal(resolveLocalSidecarMonorepoRoot({
    packaged: true,
    seedPaths: ["/Users/someone/Desktop/wodeapp"],
  }), "");
});

test("resolveLocalRuntimeDataDir prefers env then userData", () => {
  const previous = process.env.WODEAPPX_LOCAL_RUNTIME_DIR;
  process.env.WODEAPPX_LOCAL_RUNTIME_DIR = "/tmp/custom-local-rt";
  try {
    assert.equal(resolveLocalRuntimeDataDir("/unused"), path.resolve("/tmp/custom-local-rt"));
  } finally {
    if (previous == null) delete process.env.WODEAPPX_LOCAL_RUNTIME_DIR;
    else process.env.WODEAPPX_LOCAL_RUNTIME_DIR = previous;
  }
  assert.match(resolveLocalRuntimeDataDir("/tmp/wodeappx-user"), /wodeapp-local-runtime$/);
});

test("looksLikeMonorepoRoot requires sidecar script", () => {
  assert.equal(looksLikeMonorepoRoot("/tmp/does-not-exist-wodeapp"), false);
});
