import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertTestInstanceLaunchDisabled,
  buildInstanceConfig,
  parseInstanceIds,
} from "./wodeappx-test-instances.mjs";

test("test instances default to a single instance", () => {
  assert.deepEqual(parseInstanceIds(), [1]);
});

test("legacy instance selection is validated and deduplicated for cleanup", () => {
  assert.deepEqual(parseInstanceIds("3,1,3,2"), [3, 1, 2]);
  assert.throws(() => parseInstanceIds("0,abc,100"), /1-99/);
});

test("launching or seeding every test instance is prohibited", () => {
  assert.throws(() => assertTestInstanceLaunchDisabled("start"), /全部禁用/);
  assert.throws(() => assertTestInstanceLaunchDisabled("seed"), /全部禁用/);
  assert.doesNotThrow(() => assertTestInstanceLaunchDisabled("status"));
  assert.doesNotThrow(() => assertTestInstanceLaunchDisabled("stop"));
});

test("each instance has a semantic role, distinct identity, state directory, and CDP port", () => {
  const stateRoot = path.join(os.tmpdir(), "wodeappx-test-config");
  const configs = [1, 2, 3].map((id) => buildInstanceConfig({ id, stateRoot }));

  assert.deepEqual(configs.map((item) => item.name), [
    "WodeAppX · 1 交互回归",
    "WodeAppX · 2 商品生图",
    "WodeAppX · 3 路由与画布",
  ]);
  assert.deepEqual(configs.map((item) => item.cdpPort), [9223, 9224, 9225]);
  assert.equal(new Set(configs.map((item) => item.identifier)).size, 3);
  assert.equal(new Set(configs.map((item) => item.userDataDir)).size, 3);
  for (const config of configs) {
    assert.match(config.identifier, new RegExp(`\\.${config.id}$`));
    assert.ok(config.userDataDir.startsWith(stateRoot));
  }
});
