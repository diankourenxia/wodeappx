import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  LEGACY_SAFE_SELF_EVOLVE_SANDBOX_NAME,
  SELF_EVOLVE_WORKSPACE_NAME,
  ensureSelfEvolveSourceWorkspaces,
  listSelfEvolveProbeRoots,
  listSelfEvolveWorkspaceSpecs,
  mergeSelfEvolveWorkspaces,
  resolveSelfEvolveSourceRoots,
} from "./wodeapp-self-evolve-workspaces.mjs";

function writePackage(dir, name) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name }, null, 2));
}

function makeMonorepoFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "wodeappx-self-evolve-ws-"));
  writePackage(root, "wodeapp");
  writePackage(path.join(root, "wodeappx"), "wodeappx");
  mkdirSync(path.join(root, "wodeappx", "scripts"), { recursive: true });
  writeFileSync(path.join(root, "wodeappx", "scripts", "self-evolve-guard.mjs"), "// fixture\n");
  writePackage(path.join(root, "runtime-server"), "runtime-server");
  writePackage(path.join(root, "runtime-app"), "runtime-app");
  return root;
}

test("resolveSelfEvolveSourceRoots walks from nested electron path", () => {
  const monorepo = makeMonorepoFixture();
  const moduleDir = path.join(
    monorepo,
    "wodeappx",
    "vendor",
    "openwork",
    "apps",
    "desktop",
    "electron",
  );
  mkdirSync(moduleDir, { recursive: true });

  const roots = resolveSelfEvolveSourceRoots({
    env: {},
    moduleDir,
    seedPaths: [],
  });

  assert.equal(roots.wodeappxRoot, path.join(monorepo, "wodeappx"));
  assert.equal(roots.monorepoRoot, monorepo);
  assert.equal(roots.runtimeServerRoot, path.join(monorepo, "runtime-server"));
  assert.equal(roots.runtimeAppRoot, path.join(monorepo, "runtime-app"));
});

test("listSelfEvolveWorkspaceSpecs returns one combined monorepo workspace", () => {
  const monorepo = makeMonorepoFixture();
  const specs = listSelfEvolveWorkspaceSpecs({
    env: { WODEAPP_MONOREPO_ROOT: monorepo },
    isPackaged: false,
  });

  assert.equal(specs.length, 1);
  assert.equal(specs[0].name, SELF_EVOLVE_WORKSPACE_NAME);
  assert.equal(specs[0].path, monorepo);
  assert.ok(specs[0].authorizedRoots.includes(monorepo));
  assert.ok(specs[0].authorizedRoots.includes(path.join(monorepo, "wodeappx")));
  assert.ok(specs[0].authorizedRoots.includes(path.join(monorepo, "runtime-server")));
  assert.ok(specs[0].authorizedRoots.includes(path.join(monorepo, "runtime-app")));
  assert.deepEqual(specs[0].legacyPaths, [
    path.join(monorepo, "wodeappx"),
    path.join(monorepo, "runtime-server"),
  ]);
});

test("packaged builds do not scan HOME probe roots", () => {
  assert.deepEqual(listSelfEvolveProbeRoots({ HOME: "/tmp/anything" }), []);

  const home = mkdtempSync(path.join(tmpdir(), "wodeappx-probe-home-"));
  const desktopClone = path.join(home, "Desktop", "wodeapp");
  writePackage(desktopClone, "wodeapp");
  writePackage(path.join(desktopClone, "wodeappx"), "wodeappx");
  mkdirSync(path.join(desktopClone, "wodeappx", "scripts"), { recursive: true });
  writeFileSync(path.join(desktopClone, "wodeappx", "scripts", "self-evolve-guard.mjs"), "// fixture\n");
  writePackage(path.join(desktopClone, "runtime-server"), "runtime-server");
  writePackage(path.join(desktopClone, "runtime-app"), "runtime-app");

  const found = listSelfEvolveWorkspaceSpecs({
    env: { HOME: home },
    isPackaged: true,
    seedPaths: [],
  });
  assert.deepEqual(found, []);
});

test("packaged builds mount when seedPaths point at extracted monorepo", () => {
  const monorepo = makeMonorepoFixture();
  const specs = listSelfEvolveWorkspaceSpecs({
    env: {},
    isPackaged: true,
    seedPaths: [monorepo],
  });
  assert.equal(specs.length, 1);
  assert.equal(specs[0].path, monorepo);
});

test("packaged builds still discover when explicit env is set", () => {
  const monorepo = makeMonorepoFixture();
  const specs = listSelfEvolveWorkspaceSpecs({
    env: { WODEAPP_MONOREPO_ROOT: monorepo },
    isPackaged: true,
    seedPaths: [],
  });
  assert.equal(specs.length, 1);
  assert.equal(specs[0].path, monorepo);
});

test("packaged builds stay empty without bundled seed or explicit env", () => {
  const specs = listSelfEvolveWorkspaceSpecs({
    env: { HOME: mkdtempSync(path.join(tmpdir(), "wodeappx-empty-home-")) },
    isPackaged: true,
    seedPaths: [],
  });
  assert.deepEqual(specs, []);
});

test("mergeSelfEvolveWorkspaces is idempotent and drops legacy split mounts", () => {
  const monorepo = makeMonorepoFixture();
  const specs = listSelfEvolveWorkspaceSpecs({
    env: { WODEAPP_MONOREPO_ROOT: monorepo },
    isPackaged: false,
  });
  const helpers = {
    localWorkspaceId: (folderPath) => `ws_${path.basename(folderPath)}`,
    normalizeWorkspaceEntry: (input) => ({ ...input }),
  };

  const legacy = [
    {
      id: "ws_wodeappx",
      name: "wodeappx（自进化）",
      path: path.join(monorepo, "wodeappx"),
      workspaceType: "local",
    },
    {
      id: "ws_runtime-server",
      name: "runtime",
      path: path.join(monorepo, "runtime-server"),
      workspaceType: "local",
    },
  ];

  const first = mergeSelfEvolveWorkspaces(legacy, specs, helpers);
  assert.equal(first.changed, true);
  assert.equal(first.workspaces.length, 1);
  assert.equal(first.workspaces[0].path, monorepo);
  assert.equal(first.workspaces[0].name, SELF_EVOLVE_WORKSPACE_NAME);
  assert.deepEqual(first.removedIds.sort(), ["ws_runtime-server", "ws_wodeappx"]);

  const second = mergeSelfEvolveWorkspaces(first.workspaces, specs, helpers);
  assert.equal(second.changed, false);
  assert.equal(second.workspaces.length, 1);
});

test("mergeSelfEvolveWorkspaces drops leftover WodeApp 自进化 sandbox", () => {
  const monorepo = makeMonorepoFixture();
  const specs = listSelfEvolveWorkspaceSpecs({
    env: { WODEAPP_MONOREPO_ROOT: monorepo },
    isPackaged: false,
  });
  const helpers = {
    localWorkspaceId: (folderPath) => `ws_${path.basename(folderPath)}`,
    normalizeWorkspaceEntry: (input) => ({ ...input }),
  };
  const sandboxPath = path.join(tmpdir(), "user-data", "projects", LEGACY_SAFE_SELF_EVOLVE_SANDBOX_NAME);
  const existing = [
    {
      id: "ws_sandbox",
      name: LEGACY_SAFE_SELF_EVOLVE_SANDBOX_NAME,
      displayName: LEGACY_SAFE_SELF_EVOLVE_SANDBOX_NAME,
      path: sandboxPath,
      workspaceType: "local",
    },
    {
      id: "ws_keep",
      name: "我的AppX",
      path: path.join(tmpdir(), "user-data", "default-workspace"),
      workspaceType: "local",
    },
  ];

  const result = mergeSelfEvolveWorkspaces(existing, specs, helpers);
  assert.equal(result.changed, true);
  assert.equal(result.workspaces.some((entry) => entry.id === "ws_sandbox"), false);
  assert.equal(result.workspaces.some((entry) => entry.id === "ws_keep"), true);
  assert.equal(result.workspaces.some((entry) => entry.name === SELF_EVOLVE_WORKSPACE_NAME), true);
  assert.ok(result.removedIds.includes("ws_sandbox"));

  const emptySpecs = mergeSelfEvolveWorkspaces(existing, [], helpers);
  assert.equal(emptySpecs.changed, false);
  assert.equal(emptySpecs.workspaces.some((entry) => entry.id === "ws_sandbox"), true);
});

test("disable env skips all specs", () => {
  const monorepo = makeMonorepoFixture();
  const specs = listSelfEvolveWorkspaceSpecs({
    env: {
      WODEAPP_MONOREPO_ROOT: monorepo,
      WODEAPPX_DISABLE_SELF_EVOLVE_WORKSPACES: "1",
    },
    isPackaged: false,
  });
  assert.deepEqual(specs, []);
});

test("ensureSelfEvolveSourceWorkspaces uses bundled extract seed on packaged app", async () => {
  const monorepo = makeMonorepoFixture();
  const userData = mkdtempSync(path.join(tmpdir(), "wodeappx-userdata-"));
  const resources = mkdtempSync(path.join(tmpdir(), "wodeappx-resources-"));
  // Pretend extract already happened by pointing ensure at monorepo via a fake
  // resources miss + seed: we only verify seedPaths wiring through env-less packaged mode
  // by calling list path via ensure with a mock app that is packaged and an explicit
  // pre-seeded monorepo passed through a custom ensure that uses seedPaths.
  const result = await ensureSelfEvolveSourceWorkspaces({
    workspaces: [],
    app: {
      isPackaged: true,
      getAppPath: () => "/Applications/Fake.app",
      getPath: (name) => (name === "userData" ? userData : ""),
      getVersion: () => "0.0.0-test",
    },
    env: {},
    seedPaths: [monorepo],
    resourcesPath: resources,
    normalizeLocalWorkspacePath: async (value) => path.resolve(value),
    normalizeWorkspaceEntry: (input) => ({ ...input }),
    localWorkspaceId: (folderPath) => `ws_${path.basename(folderPath)}`,
    writeWorkspaceOpenworkConfig: async () => {},
    defaultWorkspaceOpenworkConfig: (workspacePath) => ({ path: workspacePath }),
    pathExists: async (target) => {
      try {
        mkdirSync(target, { recursive: true });
        return true;
      } catch {
        return false;
      }
    },
    log: () => {},
  });

  assert.equal(result.changed, true);
  assert.equal(result.workspaces.length, 1);
  assert.equal(result.workspaces[0].path, monorepo);
  assert.equal(result.workspaces[0].name, SELF_EVOLVE_WORKSPACE_NAME);
});
