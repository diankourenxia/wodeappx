import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSafeRemoteDir,
  buildAptBootstrapCommand,
  DEFAULT_REMOTE_DIR,
  parseArgs,
  parsePhases,
  summarizeExportTree,
} from "./oss-vps-verify-lib.mjs";

test("default phases cover stranger setup", () => {
  assert.deepEqual(parsePhases(""), ["export", "contract", "setup", "patch-idempotent"]);
});

test("parses a subset of phases", () => {
  assert.deepEqual(parsePhases("export,contract"), ["export", "contract"]);
});

test("rejects unknown phases", () => {
  assert.throws(() => parsePhases("export,pwn"), /unknown phase "pwn"/);
});

test("remote dir must stay in the isolated verify prefix", () => {
  assert.equal(assertSafeRemoteDir(DEFAULT_REMOTE_DIR), DEFAULT_REMOTE_DIR);
  assert.equal(assertSafeRemoteDir("/tmp/wodeappx-oss-verify/run"), "/tmp/wodeappx-oss-verify/run");
  assert.throws(() => assertSafeRemoteDir("/var/www/wodeapp"), /production path/);
  assert.throws(() => assertSafeRemoteDir("/"), /unsafe remote dir/);
  assert.throws(() => assertSafeRemoteDir("/opt/other"), /must be under/);
});

test("export summary fails closed on secrets and vendor", () => {
  const dirty = summarizeExportTree([
    "README.md",
    ".env",
    "vendor/openwork/package.json",
    "ee/secret.ts",
    "brand-agents.json",
  ]);
  assert.equal(dirty.ok, false);
  assert.deepEqual(dirty.envFiles, [".env"]);
  assert.ok(dirty.vendorTracked.includes("vendor/openwork/package.json"));
  assert.ok(dirty.eePaths.includes("ee/secret.ts"));
  assert.deepEqual(dirty.brandAgents, ["brand-agents.json"]);

  const clean = summarizeExportTree(["README.md", ".env.example", "docs/examples/brand-agents.wynne.example.json"]);
  assert.equal(clean.ok, true);
});

test("CLI accepts isolated host and local-only contract mode", () => {
  const options = parseArgs([
    "node",
    "oss-vps-verify.mjs",
    "--host",
    "wode-cn-tencent",
    "--local-only",
    "--phase",
    "export,contract",
  ]);
  assert.equal(options.host, "wode-cn-tencent");
  assert.equal(options.remoteDir, DEFAULT_REMOTE_DIR);
  assert.equal(options.localOnly, true);
  assert.deepEqual(options.phases, ["export", "contract"]);
  assert.equal(options.keepRemoteVendor, false);
});

test("retry flag keeps the remote OpenWork vendor tree", () => {
  const options = parseArgs([
    "node",
    "oss-vps-verify.mjs",
    "--skip-export",
    "--keep-remote-vendor",
    "--phase",
    "setup,patch-idempotent",
  ]);
  assert.equal(options.skipExport, true);
  assert.equal(options.keepRemoteVendor, true);
  assert.deepEqual(options.phases, ["setup", "patch-idempotent"]);
});

test("bootstrap never targets production wodeapp paths", () => {
  const command = buildAptBootstrapCommand();
  assert.match(command, /corepack prepare pnpm@9\.15\.0/);
  assert.doesNotMatch(command, /\/var\/www\/wodeapp/);
  assert.doesNotMatch(command, /apt-get/);
  assert.match(command, /SHELL=\/bin\/bash/);
});

test("orchestrator can rsync without wiping remote vendor", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./oss-vps-verify.mjs", import.meta.url), "utf8"),
  );
  assert.match(source, /keepRemoteVendor/);
  assert.match(source, /--exclude", "vendor\//);
  assert.match(source, /ELECTRON_MIRROR/);
});

test("remote runner uses pnpm run setup not the pnpm builtin", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./oss-vps-verify-remote.mjs", import.meta.url), "utf8"),
  );
  assert.match(source, /\["run", "setup"\]/);
  assert.doesNotMatch(source, /\["setup"\]/);
});
