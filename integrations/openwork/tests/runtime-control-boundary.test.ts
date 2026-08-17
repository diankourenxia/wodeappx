import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = path.dirname(fileURLToPath(import.meta.url));
const integrationRoot = path.resolve(here, "..");
const forkServerRoot = path.join(integrationRoot, "fork/apps/server/src");

async function source(relativePath: string): Promise<string> {
  return readFile(path.join(integrationRoot, relativePath), "utf8");
}

async function implementationFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return implementationFiles(target);
    if (!entry.isFile() || !/\.(?:ts|mjs)$/.test(entry.name) || /\.test\./.test(entry.name)) return [];
    return [target];
  }));
  return nested.flat();
}

test("OpenCode v1 dispose is contained by the adapter boundary", async () => {
  const files = await implementationFiles(forkServerRoot);
  const owners: string[] = [];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    if (content.includes("/instance/dispose")) owners.push(path.relative(forkServerRoot, file));
  }
  assert.deepEqual(owners, ["engine/opencode-v1-adapter.ts"]);
});

test("run control owns normalized contracts rather than SDK response types", async () => {
  const registry = await source("fork/apps/server/src/run-registry.ts");
  const operations = await source("fork/apps/server/src/routes/operations.ts");
  const adapterTypes = await source("fork/apps/server/src/engine/engine-types.ts");

  assert.doesNotMatch(registry, /@opencode-ai\/sdk|\/instance\/dispose/);
  assert.doesNotMatch(operations, /@opencode-ai\/sdk|\/instance\/dispose/);
  assert.doesNotMatch(adapterTypes, /@opencode-ai\/sdk/);
  assert.match(operations, /createEngineAdapter/);
  assert.match(operations, /runRegistry\.beginReload/);
});

test("patcher materializes both adapter and generation supervisor boundaries", async () => {
  const patcher = await readFile(path.resolve(integrationRoot, "../../scripts/apply-openwork-integration.mjs"), "utf8");

  assert.match(patcher, /engine\/opencode-v1-adapter\.ts/);
  assert.match(patcher, /run-registry\.ts/);
  assert.match(patcher, /runtime-generation\.mjs/);
  assert.match(patcher, /managed-process-tree\.ts/);
  assert.match(patcher, /applyRunControlServerPatch/);
  assert.match(patcher, /applyRuntimeGenerationSupervisorPatch/);
});

test("internal workspace bootstrap reload uses the same server-side lease", async () => {
  const materializedServer = await readFile(
    path.resolve(integrationRoot, "../../vendor/openwork/apps/server/src/server.ts"),
    "utf8",
  );
  const start = materializedServer.indexOf("async function reloadOpencodeEngineAfterInternalBootstrap");
  const end = materializedServer.indexOf("async function isAuthorizedRoot", start);
  assert.ok(start >= 0 && end > start);
  const implementation = materializedServer.slice(start, end);

  assert.match(implementation, /runRegistry\.beginReload/);
  assert.match(implementation, /adapter\.activeRuns/);
  assert.match(implementation, /await adapter\.reload/);
  assert.doesNotMatch(implementation, /void reloadOpencodeEngine/);
});
