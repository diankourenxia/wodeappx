import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  listSelfEvolveSourceFiles,
  shouldIncludeSelfEvolveRelativePath,
} from "./pack-self-evolve-source.mjs";

test("filter keeps self-evolve guard and runtime-server sources", () => {
  assert.equal(
    shouldIncludeSelfEvolveRelativePath("wodeappx/scripts/self-evolve-guard.mjs"),
    true,
  );
  assert.equal(
    shouldIncludeSelfEvolveRelativePath("runtime-server/src/index.ts"),
    true,
  );
  assert.equal(shouldIncludeSelfEvolveRelativePath("AGENTS.md"), true);
});

test("filter drops vendor, strip paths, docs media, and secret key files", () => {
  assert.equal(
    shouldIncludeSelfEvolveRelativePath("wodeappx/vendor/openwork/package.json"),
    false,
  );
  assert.equal(
    shouldIncludeSelfEvolveRelativePath("server/src/routes/stripe.ts"),
    false,
  );
  assert.equal(shouldIncludeSelfEvolveRelativePath("SERVERS.md"), false);
  assert.equal(
    shouldIncludeSelfEvolveRelativePath("server/src/routes/wechatpay.ts"),
    false,
  );
  assert.equal(
    shouldIncludeSelfEvolveRelativePath("server/src/services/alipayService.ts"),
    false,
  );
  assert.equal(
    shouldIncludeSelfEvolveRelativePath("server/src/services/wechatPayService.ts"),
    false,
  );
  assert.equal(
    shouldIncludeSelfEvolveRelativePath("docs/test-evidence/foo.mp4"),
    false,
  );
  assert.equal(
    shouldIncludeSelfEvolveRelativePath("docs/demo.png"),
    false,
  );
  assert.equal(
    shouldIncludeSelfEvolveRelativePath("wodeappx/docs/promo/wodeappx-promo.mp4"),
    false,
  );
  assert.equal(
    shouldIncludeSelfEvolveRelativePath("wodeappx/docs/promo/skins/ink-book-light.png"),
    false,
  );
  assert.equal(
    shouldIncludeSelfEvolveRelativePath("wodeappx/scripts/context-bench/runs/live-truncate-gate/opencode-patched"),
    false,
  );
  assert.equal(
    shouldIncludeSelfEvolveRelativePath("wodeappx/docs/examples/skin-mocks/live-accept/pet-soft.png"),
    false,
  );
  assert.equal(
    shouldIncludeSelfEvolveRelativePath("wodeappx/docs/examples/companion-assets/cat-strip-raw.png"),
    false,
  );
  assert.equal(shouldIncludeSelfEvolveRelativePath("_fix_local.mjs"), false);
  assert.equal(
    shouldIncludeSelfEvolveRelativePath("server/certs/private.wx1ccb4596e4e4b4cc.key"),
    false,
  );
  assert.equal(
    shouldIncludeSelfEvolveRelativePath("scripts/.venv-pdf/lib/foo.py"),
    false,
  );
});

test("listSelfEvolveSourceFiles walks a tiny fixture without vendor or stripe", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "wodeappx-pack-src-"));
  mkdirSync(path.join(root, "wodeappx", "scripts"), { recursive: true });
  writeFileSync(path.join(root, "wodeappx", "package.json"), JSON.stringify({ name: "wodeappx" }));
  writeFileSync(path.join(root, "wodeappx", "scripts", "self-evolve-guard.mjs"), "// x\n");
  mkdirSync(path.join(root, "wodeappx", "vendor", "openwork"), { recursive: true });
  writeFileSync(path.join(root, "wodeappx", "vendor", "openwork", "x.js"), "nope\n");
  mkdirSync(path.join(root, "runtime-server", "src"), { recursive: true });
  writeFileSync(path.join(root, "runtime-server", "package.json"), "{}");
  writeFileSync(path.join(root, "runtime-server", "src", "index.ts"), "export {}\n");
  mkdirSync(path.join(root, "server", "src", "routes"), { recursive: true });
  writeFileSync(path.join(root, "server", "src", "routes", "stripe.ts"), "secret\n");
  writeFileSync(path.join(root, "server", "src", "routes", "health.ts"), "ok\n");
  writeFileSync(path.join(root, "AGENTS.md"), "# agents\n");

  const files = await listSelfEvolveSourceFiles(root);
  assert.ok(files.includes("wodeappx/scripts/self-evolve-guard.mjs"));
  assert.ok(files.includes("runtime-server/src/index.ts"));
  assert.ok(files.includes("AGENTS.md"));
  assert.ok(files.includes("server/src/routes/health.ts"));
  assert.equal(files.includes("server/src/routes/stripe.ts"), false);
  assert.equal(files.some((f) => f.includes("/vendor/")), false);
});
