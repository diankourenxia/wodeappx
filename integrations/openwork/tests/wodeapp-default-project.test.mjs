import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createWorkspaceStore } from "../../../vendor/openwork/apps/desktop/electron/workspace-store.mjs";

test("does not seed the leftover WodeApp 自进化 sandbox", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "wodeappx-default-project-"));
  const userData = path.join(root, "user-data");
  const previousRecovery = process.env.OPENWORK_DESKTOP_DISABLE_WORKSPACE_RECOVERY;
  const previousServerConfig = process.env.OPENWORK_SERVER_CONFIG;
  const previousSelfEvolve = process.env.WODEAPPX_DISABLE_SELF_EVOLVE_WORKSPACES;
  process.env.OPENWORK_DESKTOP_DISABLE_WORKSPACE_RECOVERY = "1";
  process.env.OPENWORK_SERVER_CONFIG = path.join(root, "missing-server.json");
  process.env.WODEAPPX_DISABLE_SELF_EVOLVE_WORKSPACES = "1";

  try {
    const store = createWorkspaceStore({
      app: { getPath: (name) => name === "userData" ? userData : root },
      defaultDenBaseUrl: "https://example.test",
      defaultRequireSignin: false,
      forceRequireSignin: false,
    });

    const first = await store.readWorkspaceState();
    assert.equal(first.workspaces.some((entry) => entry.name === "WodeApp 自进化"), false);
    assert.equal(first.defaultSelfEvolutionProjectSeeded, undefined);
  } finally {
    if (previousRecovery === undefined) delete process.env.OPENWORK_DESKTOP_DISABLE_WORKSPACE_RECOVERY;
    else process.env.OPENWORK_DESKTOP_DISABLE_WORKSPACE_RECOVERY = previousRecovery;
    if (previousServerConfig === undefined) delete process.env.OPENWORK_SERVER_CONFIG;
    else process.env.OPENWORK_SERVER_CONFIG = previousServerConfig;
    if (previousSelfEvolve === undefined) delete process.env.WODEAPPX_DISABLE_SELF_EVOLVE_WORKSPACES;
    else process.env.WODEAPPX_DISABLE_SELF_EVOLVE_WORKSPACES = previousSelfEvolve;
    await rm(root, { recursive: true, force: true });
  }
});
