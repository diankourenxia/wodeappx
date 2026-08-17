#!/usr/bin/env node
/**
 * Local gate before tagging / release:macos.
 * Catches the class of CI failures where a dirty local vendor tree already
 * passes patch, but a fresh OpenWork bootstrap would not.
 *
 * Usage:
 *   node scripts/release-preflight.mjs
 *   node scripts/release-preflight.mjs --fresh-bootstrap
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const freshBootstrap = args.has("--fresh-bootstrap");

function run(label, command, commandArgs, opts = {}) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
    ...opts,
  });
  if (result.status !== 0) {
    console.error(`\npreflight failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

run("patch unit tests", "pnpm", ["openwork:patch:test"]);

if (freshBootstrap) {
  run("fresh openwork bootstrap", "pnpm", ["openwork:bootstrap", "--", "--force"]);
}

run("openwork:patch (+ cloud)", "pnpm", ["openwork:patch"]);
run("openwork:patch-cloud", "pnpm", ["openwork:patch-cloud"]);
if (freshBootstrap) {
  // CI installs vendor deps before agent-capability typecheck; local fresh
  // bootstrap wipes node_modules and must do the same or tsc resolves to the
  // monorepo root and fails on missing @opencode-ai/sdk / wrong React types.
  run("openwork:install (fresh bootstrap)", "pnpm", ["openwork:install"]);
}
run("release:check", "pnpm", ["release:check"]);
run("agent capability contract", "pnpm", ["test:agent-capabilities"]);

const sessionSyncPath = path.join(
  root,
  "vendor/openwork/apps/app/src/react-app/domains/session/sync/session-sync.ts",
);
run("session-sync canary", process.execPath, [
  "-e",
  `
  import { readFileSync, existsSync } from 'node:fs';
  const p = ${JSON.stringify(sessionSyncPath)};
  if (!existsSync(p)) {
    console.log('session-sync canary skipped (vendor not bootstrapped)');
    process.exit(0);
  }
  const src = readFileSync(p, 'utf8');
  if (/^\\s*,\\s*$/m.test(src)) {
    console.error('session-sync.ts has a lone comma line — syntax corruption');
    process.exit(1);
  }
  if (!src.includes('const slimSnapshot = slimOpenworkSessionSnapshot(snapshot);')) {
    console.error('session-sync.ts missing slimSnapshot seedSessionState body');
    process.exit(1);
  }
  const starts = src.split('export function seedSessionState').length - 1;
  if (starts !== 1) {
    console.error('expected exactly one seedSessionState, found', starts);
    process.exit(1);
  }
  console.log('session-sync canary ok');
  `,
]);

console.log("\npreflight ok — safe to release:macos / tag for Windows CI");
if (!freshBootstrap) {
  console.log("tip: for CI-parity, re-run with --fresh-bootstrap (slower, re-downloads OpenWork).");
}
