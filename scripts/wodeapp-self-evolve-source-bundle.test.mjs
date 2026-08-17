import assert from "node:assert/strict";
import {
  cpSync,
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pipeline } from "node:stream/promises";
import { createZstdCompress } from "node:zlib";
import { spawnSync } from "node:child_process";

import {
  looksLikeMonorepoRoot,
  resolveExtractedSelfEvolveMount,
} from "../integrations/openwork/fork/apps/desktop/electron/wodeapp-self-evolve-workspaces.mjs";
import {
  ensureBundledSelfEvolveMonorepo,
  resolveBundledSelfEvolvePaths,
} from "../integrations/openwork/fork/apps/desktop/electron/wodeapp-self-evolve-source-bundle.mjs";

function writePackage(dir, name) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name }, null, 2));
}

function makeMonorepoFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "wodeappx-bundle-mono-"));
  writePackage(root, "wodeapp");
  writePackage(path.join(root, "wodeappx"), "wodeappx");
  mkdirSync(path.join(root, "wodeappx", "scripts"), { recursive: true });
  writeFileSync(path.join(root, "wodeappx", "scripts", "self-evolve-guard.mjs"), "// fixture\n");
  writePackage(path.join(root, "runtime-server"), "runtime-server");
  writePackage(path.join(root, "runtime-app"), "runtime-app");
  return root;
}

async function writeFixtureArchive(resourcesDir, monorepo) {
  const bundled = resolveBundledSelfEvolvePaths(resourcesDir);
  mkdirSync(bundled.dir, { recursive: true });
  const stageParent = mkdtempSync(path.join(tmpdir(), "wodeappx-bundle-stage-"));
  const stagedRoot = path.join(stageParent, "wodeapp");
  // Windows CI has no `cp -R`; use Node recursive copy.
  cpSync(monorepo, stagedRoot, { recursive: true });
  // Avoid absolute Windows paths with tar (`C:` is parsed as a remote host).
  const tarName = "fixture.tar";
  const tar = spawnSync("tar", ["-cf", tarName, "wodeapp"], {
    cwd: stageParent,
    encoding: "buffer",
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(
    tar.status,
    0,
    `tar create failed (${tar.status}): ${String(tar.stderr || tar.error || "").slice(0, 400)}`,
  );
  const tarBytes = readFileSync(path.join(stageParent, tarName));
  assert.ok(tarBytes.length > 0, "tar create produced empty archive file");
  await pipeline(
    async function* () { yield tarBytes; },
    createZstdCompress(),
    createWriteStream(bundled.archivePath),
  );
  writeFileSync(bundled.manifestPath, JSON.stringify({
    version: "9.9.9-test",
    rootName: "wodeapp",
    archive: "self-evolve-source.tar.zst",
    fileCount: 4,
    sha256: "test",
  }, null, 2));
}

test("ensureBundledSelfEvolveMonorepo extracts archive into userData", async () => {
  const monorepo = makeMonorepoFixture();
  const resources = mkdtempSync(path.join(tmpdir(), "wodeappx-res-"));
  const userData = mkdtempSync(path.join(tmpdir(), "wodeappx-ud-"));
  await writeFixtureArchive(resources, monorepo);

  const logs = [];
  const first = await ensureBundledSelfEvolveMonorepo({
    resourcesPath: resources,
    userDataPath: userData,
    version: "9.9.9-test",
    looksLikeMonorepoRoot,
    log: (...args) => {
      logs.push(args.map((value) => {
        if (typeof value === "string") return value;
        try { return JSON.stringify(value); } catch { return String(value); }
      }).join(" "));
    },
  });
  assert.ok(first, `expected extract path, logs=${logs.join(" | ")}`);
  assert.equal(looksLikeMonorepoRoot(first), true);
  assert.ok(first.includes(path.join("self-evolve-source", "9.9.9-test", "wodeapp")));

  const second = await ensureBundledSelfEvolveMonorepo({
    resourcesPath: resources,
    userDataPath: userData,
    version: "9.9.9-test",
    looksLikeMonorepoRoot,
    log: () => {},
  });
  assert.equal(second, first);
  assert.ok(readFileSync(path.join(path.dirname(first), ".extracted"), "utf8").includes("9.9.9-test"));
});

test("ensureBundledSelfEvolveMonorepo accepts OSS standalone wrap without runtime-server", async () => {
  const standalone = mkdtempSync(path.join(tmpdir(), "wodeappx-bundle-oss-"));
  writePackage(path.join(standalone, "wodeappx"), "wodeappx");
  mkdirSync(path.join(standalone, "wodeappx", "scripts"), { recursive: true });
  writeFileSync(path.join(standalone, "wodeappx", "scripts", "self-evolve-guard.mjs"), "// fixture\n");

  const resources = mkdtempSync(path.join(tmpdir(), "wodeappx-res-"));
  const userData = mkdtempSync(path.join(tmpdir(), "wodeappx-ud-"));
  await writeFixtureArchive(resources, standalone);

  const root = await ensureBundledSelfEvolveMonorepo({
    resourcesPath: resources,
    userDataPath: userData,
    version: "1.0.0",
    looksLikeMonorepoRoot,
    resolveMount: resolveExtractedSelfEvolveMount,
    log: () => {},
  });
  assert.ok(root, "expected standalone wrap to extract");
  assert.equal(looksLikeMonorepoRoot(path.dirname(root)), false);
  assert.ok(root.endsWith(`${path.sep}wodeappx`) || root.endsWith("/wodeappx"));
});

test("ensureBundledSelfEvolveMonorepo coalesces concurrent extracts", async () => {
  const monorepo = makeMonorepoFixture();
  const resources = mkdtempSync(path.join(tmpdir(), "wodeappx-res-"));
  const userData = mkdtempSync(path.join(tmpdir(), "wodeappx-ud-"));
  await writeFixtureArchive(resources, monorepo);

  const extractedLogs = [];
  const run = () => ensureBundledSelfEvolveMonorepo({
    resourcesPath: resources,
    userDataPath: userData,
    version: "9.9.9-test",
    looksLikeMonorepoRoot,
    log: (message) => {
      if (String(message).includes("extracted bundled self-evolve source")) {
        extractedLogs.push(message);
      }
    },
  });

  const [a, b, c, d] = await Promise.all([run(), run(), run(), run()]);
  assert.ok(a && a === b && b === c && c === d);
  assert.equal(extractedLogs.length, 1);
  assert.equal(looksLikeMonorepoRoot(a), true);
});
