import assert from "node:assert/strict";
import test from "node:test";

class OpenworkServerError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function ensureWorkspaceRegisteredOnServer(client, workspace) {
  if (!workspace?.id) return false;
  try {
    await client.activateWorkspace(workspace.id, { persist: true });
    return true;
  } catch (error) {
    if (!(error instanceof OpenworkServerError) || error.code !== "workspace_not_found") return false;
    if (workspace.workspaceType === "remote") return false;
    const folderPath = String(workspace.path || "").trim();
    if (!folderPath) return false;
    const named = String(workspace.displayName || workspace.name || "").trim();
    const parts = folderPath.replace(/\\/g, "/").split("/").filter(Boolean);
    await client.createLocalWorkspace({
      folderPath,
      name: named || parts[parts.length - 1] || "Workspace",
      preset: String(workspace.preset || "starter").trim() || "starter",
    });
    await client.activateWorkspace(workspace.id, { persist: true });
    return true;
  }
}

test("registers missing local workspace then activates", async () => {
  const calls = [];
  let activateCount = 0;
  const client = {
    async activateWorkspace(id, opts) {
      calls.push(["activate", id, opts]);
      activateCount += 1;
      if (activateCount === 1) {
        throw new OpenworkServerError(404, "workspace_not_found", "Workspace not found");
      }
    },
    async createLocalWorkspace(payload) {
      calls.push(["create", payload]);
      return { workspaces: [{ id: "ws_supor" }] };
    },
  };
  const ok = await ensureWorkspaceRegisteredOnServer(client, {
    id: "ws_b2cdc88e3847",
    path: "/Users/me/.wodeapp/projects/supor",
    displayName: "苏泊尔经营台",
    preset: "starter",
  });
  assert.equal(ok, true);
  assert.deepEqual(calls[0], ["activate", "ws_b2cdc88e3847", { persist: true }]);
  assert.equal(calls[1][0], "create");
  assert.equal(calls[1][1].folderPath, "/Users/me/.wodeapp/projects/supor");
  assert.equal(calls[1][1].name, "苏泊尔经营台");
  assert.deepEqual(calls[2], ["activate", "ws_b2cdc88e3847", { persist: true }]);
});

test("no-ops when activate already succeeds", async () => {
  const calls = [];
  const client = {
    async activateWorkspace(id) {
      calls.push(id);
    },
    async createLocalWorkspace() {
      throw new Error("should not create");
    },
  };
  const ok = await ensureWorkspaceRegisteredOnServer(client, {
    id: "ws_ok",
    path: "/tmp/ok",
  });
  assert.equal(ok, true);
  assert.deepEqual(calls, ["ws_ok"]);
});

test("returns false for remote workspace_not_found", async () => {
  const client = {
    async activateWorkspace() {
      throw new OpenworkServerError(404, "workspace_not_found", "Workspace not found");
    },
    async createLocalWorkspace() {
      throw new Error("should not create");
    },
  };
  const ok = await ensureWorkspaceRegisteredOnServer(client, {
    id: "ws_remote",
    path: "/tmp/x",
    workspaceType: "remote",
  });
  assert.equal(ok, false);
});
