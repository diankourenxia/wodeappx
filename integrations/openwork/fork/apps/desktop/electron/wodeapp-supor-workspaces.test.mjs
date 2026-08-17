import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  SUPOR_WORKSPACE_MARKER,
  SUPOR_WORKSPACE_NAME,
  ensureSuporWorkspaceDirectory,
  isSuporWorkspacePath,
  listSuporWorkspaceSpecs,
  mergeSuporWorkspaces,
  resolveSuporWorkspacePath,
} from "./wodeapp-supor-workspaces.mjs";

test("resolveSuporWorkspacePath defaults under ~/.wodeapp/projects/supor", () => {
  const resolved = resolveSuporWorkspacePath({});
  assert.equal(resolved, path.join(os.homedir(), ".wodeapp", "projects", "supor"));
});

test("ensureSuporWorkspaceDirectory writes marker and folders", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "wodeappx-supor-"));
  try {
    const ensured = ensureSuporWorkspaceDirectory(path.join(root, "supor"));
    assert.ok(existsSync(path.join(ensured, SUPOR_WORKSPACE_MARKER)));
    assert.ok(existsSync(path.join(ensured, "assets")));
    assert.ok(existsSync(path.join(ensured, "knowledge")));
    const marker = JSON.parse(readFileSync(path.join(ensured, SUPOR_WORKSPACE_MARKER), "utf8"));
    assert.equal(marker.brandId, "supor");
    assert.equal(isSuporWorkspacePath(ensured), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("mergeSuporWorkspaces is idempotent", () => {
  const folder = "/tmp/fake-supor-project";
  const specs = [{ key: "wodeapp-supor", name: SUPOR_WORKSPACE_NAME, path: folder, authorizedRoots: [folder] }];
  const helpers = {
    localWorkspaceId: (p) => `ws_${path.basename(p)}`,
    normalizeWorkspaceEntry: (entry) => entry,
  };
  const first = mergeSuporWorkspaces([], specs, helpers);
  assert.equal(first.changed, true);
  assert.equal(first.added.length, 1);
  assert.equal(first.workspaces[0].displayName, SUPOR_WORKSPACE_NAME);
  const second = mergeSuporWorkspaces(first.workspaces, specs, helpers);
  assert.equal(second.changed, false);
  assert.equal(second.added.length, 0);
  assert.equal(second.workspaces.length, 1);
});

test("listSuporWorkspaceSpecs is opt-in (hidden by default)", () => {
  assert.equal(listSuporWorkspaceSpecs({ env: {} }).length, 0);
  assert.equal(listSuporWorkspaceSpecs({ env: { WODEAPPX_DISABLE_SUPOR_WORKSPACE: "1" } }).length, 0);
  assert.equal(listSuporWorkspaceSpecs({ env: { WODEAPPX_ENABLE_SUPOR_WORKSPACE: "1" } }).length, 1);
  assert.equal(
    listSuporWorkspaceSpecs({
      env: { WODEAPPX_ENABLE_SUPOR_WORKSPACE: "1", WODEAPPX_DISABLE_SUPOR_WORKSPACE: "1" },
    }).length,
    0,
  );
});

test("mergeSuporWorkspaces skips forgotten paths (user deleted optional brand desk)", () => {
  const folder = "/tmp/fake-supor-forgotten";
  const specs = [{ key: "wodeapp-supor", name: SUPOR_WORKSPACE_NAME, path: folder, authorizedRoots: [folder] }];
  const helpers = {
    localWorkspaceId: (p) => `ws_${path.basename(p)}`,
    normalizeWorkspaceEntry: (entry) => entry,
    forgottenPathKeys: [folder],
  };
  const merged = mergeSuporWorkspaces([], specs, helpers);
  assert.equal(merged.changed, false);
  assert.equal(merged.added.length, 0);
  assert.equal(merged.workspaces.length, 0);
});
