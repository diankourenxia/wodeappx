import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applySelfEvolveSlot,
  buildCandidateEnv,
  injectSelfEvolveRuntime,
  readCurrentSlot,
  resolvePackagedBin,
  resolveSelfEvolveRendererIndex,
  writeCurrentSlot,
  writeSelfEvolveLaunchInfo,
} from "./self-evolve-packaged.mjs";

function tmp() {
  return mkdtempSync(path.join(tmpdir(), "wodeappx-se-packaged-"));
}

test("resolvePackagedBin prefers env, then launch.json, then vendor electron", () => {
  const root = tmp();
  const packaged = path.join(root, "WodeAppX");
  const vendor = path.join(root, "electron");
  writeFileSync(packaged, "");
  writeFileSync(vendor, "");
  const userData = path.join(root, "udata");
  mkdirSync(userData, { recursive: true });
  writeSelfEvolveLaunchInfo(userData, { bin: packaged, resourcesPath: root, version: "1.0.1" });

  assert.equal(resolvePackagedBin({ env: { WODEAPPX_PACKAGED_BIN: packaged } }).kind, "packaged");
  assert.equal(resolvePackagedBin({ userDataPath: userData }).bin, packaged);
  assert.equal(resolvePackagedBin({ vendorElectron: vendor }).kind, "vendor");
});

test("resolveSelfEvolveRendererIndex uses env, then slot B, then packaged", () => {
  const root = tmp();
  const packaged = path.join(root, "packaged", "index.html");
  const slotIndex = path.join(root, "udata", "self-evolve-slots", "B", "app-dist", "index.html");
  mkdirSync(path.dirname(packaged), { recursive: true });
  mkdirSync(path.dirname(slotIndex), { recursive: true });
  writeFileSync(packaged, "<html></html>");
  writeFileSync(slotIndex, "<html>B</html>");
  writeCurrentSlot(path.join(root, "udata"), "B");

  assert.equal(
    resolveSelfEvolveRendererIndex({
      userDataPath: path.join(root, "udata"),
      packagedIndexPath: packaged,
      isPackaged: true,
      env: {},
    }),
    slotIndex,
  );
  assert.equal(
    resolveSelfEvolveRendererIndex({
      userDataPath: path.join(root, "udata"),
      packagedIndexPath: packaged,
      isPackaged: true,
      env: { WODEAPPX_SELF_EVOLVE_SLOT: "A" },
    }),
    packaged,
  );
});

test("apply slot B then restore slot A points renderer back at packaged", () => {
  const root = tmp();
  const resources = path.join(root, "resources");
  const userData = path.join(root, "udata");
  const packaged = path.join(resources, "app-dist", "index.html");
  mkdirSync(path.dirname(packaged), { recursive: true });
  writeFileSync(packaged, "<html><body>official</body></html>");

  applySelfEvolveSlot({ resourcesPath: resources, userDataPath: userData, slot: "B" });
  writeCurrentSlot(userData, "B");
  assert.equal(
    resolveSelfEvolveRendererIndex({
      userDataPath: userData,
      packagedIndexPath: packaged,
      isPackaged: true,
      env: {},
    }),
    path.join(userData, "self-evolve-slots", "B", "app-dist", "index.html"),
  );

  writeCurrentSlot(userData, "A");
  assert.equal(readCurrentSlot(userData, {}), "A");
  assert.equal(
    resolveSelfEvolveRendererIndex({
      userDataPath: userData,
      packagedIndexPath: packaged,
      isPackaged: true,
      env: {},
    }),
    packaged,
  );
});

test("applySelfEvolveSlot copies app-dist and bakes a visible runtime patch", () => {
  const root = tmp();
  const resources = path.join(root, "resources");
  const userData = path.join(root, "udata");
  mkdirSync(path.join(resources, "app-dist"), { recursive: true });
  writeFileSync(path.join(resources, "app-dist", "index.html"), "<html><body>hello</body></html>");
  mkdirSync(path.join(userData, "self-evolve-overlay"), { recursive: true });
  writeFileSync(
    path.join(userData, "self-evolve-overlay", "manifest.json"),
    JSON.stringify({ domTextReplace: [{ from: "新建对话", to: "新对话" }] }),
  );

  const result = applySelfEvolveSlot({
    resourcesPath: resources,
    userDataPath: userData,
    slot: "B",
  });
  const html = readFileSync(result.rendererIndex, "utf8");
  const runtime = readFileSync(path.join(path.dirname(result.rendererIndex), "wodeappx-self-evolve-runtime.js"), "utf8");
  assert.match(html, /wodeappx-self-evolve-runtime\.js/);
  assert.match(runtime, /新建对话/);
  assert.match(runtime, /新对话/);
});

test("injectSelfEvolveRuntime is idempotent", () => {
  const once = injectSelfEvolveRuntime("<html><body>x</body></html>");
  const twice = injectSelfEvolveRuntime(once);
  assert.equal(once, twice);
});

test("buildCandidateEnv points B at official userData slot renderer", () => {
  const root = tmp();
  const official = path.join(root, "official");
  const slot = path.join(official, "self-evolve-slots", "B", "app-dist", "index.html");
  mkdirSync(path.dirname(slot), { recursive: true });
  writeFileSync(slot, "<html></html>");
  const env = buildCandidateEnv({
    env: { GIT_DIR: "nope", ELECTRON_RUN_AS_NODE: "1" },
    cfg: {
      id: 8,
      appName: "WodeAppX 候选 8",
      identifier: "com.differentai.openwork.candidate.8",
      userDataDir: path.join(root, "cand"),
      cdpPort: 9230,
    },
    officialUserData: official,
    slot: "B",
  });
  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(env.WODEAPPX_SELF_EVOLVE_SLOT, "B");
  assert.equal(env.WODEAPPX_SELF_EVOLVE_RENDERER, slot);
  assert.match(env.OPENWORK_ELECTRON_START_URL, /^file:\/\//);
  assert.equal(readCurrentSlot(official, {}), "A");
});
