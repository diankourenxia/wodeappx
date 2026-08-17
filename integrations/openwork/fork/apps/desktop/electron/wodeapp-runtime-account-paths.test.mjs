import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  listExistingOpencodeConfigDirs,
  managedRuntimeDataPaths,
  managedSchedulerRuntimeDataPaths,
  remapUiXdgEnvToSchedulerIsolation,
  remapUiXdgPathToSchedulerIsolation,
  resolveAccountIdFromWodeAppConfig,
  resolveActiveOpencodeConfigDir,
  sanitizeRuntimeAccountScope,
} from "./wodeapp-runtime-account-paths.mjs";

test("sanitizeRuntimeAccountScope keeps uuid-like ids", () => {
  assert.equal(
    sanitizeRuntimeAccountScope("791d7d28-296a-40d5-818d-a3b267346a1c"),
    "791d7d28-296a-40d5-818d-a3b267346a1c",
  );
  assert.equal(sanitizeRuntimeAccountScope(""), "anonymous");
});

test("resolveActiveOpencodeConfigDir follows signed-in user id", () => {
  const userData = "/tmp/wodeapp-user-data";
  const dir = resolveActiveOpencodeConfigDir(userData, {
    user: { id: "791d7d28-296a-40d5-818d-a3b267346a1c" },
  });
  assert.equal(
    dir,
    managedRuntimeDataPaths(userData, "791d7d28-296a-40d5-818d-a3b267346a1c").opencodeConfigDir,
  );
  assert.equal(resolveAccountIdFromWodeAppConfig({}), "anonymous");
});

test("scheduler XDG is a sibling tree under the same account root", () => {
  const userData = "/tmp/wodeapp-user-data";
  const accountId = "791d7d28-296a-40d5-818d-a3b267346a1c";
  const ui = managedRuntimeDataPaths(userData, accountId);
  const scheduler = managedSchedulerRuntimeDataPaths(userData, accountId);
  assert.equal(ui.root, scheduler.root);
  assert.equal(
    scheduler.xdgDataHome,
    path.join(ui.root, "scheduler-xdg", "data"),
  );
  assert.notEqual(ui.xdgDataHome, scheduler.xdgDataHome);
  assert.equal(
    remapUiXdgPathToSchedulerIsolation(ui.xdgDataHome),
    scheduler.xdgDataHome,
  );
  assert.deepEqual(
    remapUiXdgEnvToSchedulerIsolation({
      XDG_DATA_HOME: ui.xdgDataHome,
      OPENCODE_CONFIG_DIR: ui.opencodeConfigDir,
      WODEAPP_API_KEY: "secret",
    }),
    {
      XDG_DATA_HOME: scheduler.xdgDataHome,
      OPENCODE_CONFIG_DIR: scheduler.opencodeConfigDir,
      WODEAPP_API_KEY: "secret",
    },
  );
});

test("listExistingOpencodeConfigDirs discovers sibling account wallets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wodeapp-runtime-paths-"));
  const a = managedRuntimeDataPaths(root, "account-a").opencodeConfigDir;
  const b = managedRuntimeDataPaths(root, "account-b").opencodeConfigDir;
  await mkdir(a, { recursive: true });
  await mkdir(b, { recursive: true });
  await writeFile(path.join(a, "opencode.jsonc"), "{}\n", "utf8");
  const dirs = await listExistingOpencodeConfigDirs(root);
  assert.deepEqual(dirs.sort(), [a, b].sort());
});
