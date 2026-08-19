import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const GUARD = fileURLToPath(new URL("./self-evolve-guard.mjs", import.meta.url));
const MARKER = "integrations/openwork/wodeapp/marker.ts";
const IGNORED = "vendor/openwork/apps/app/src/react-app/domains/wodeapp/loop.css";

function git(cwd, args) {
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "commit.gpgsign",
      GIT_CONFIG_VALUE_0: "false",
    },
  });
}

function write(file, text) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function parseGuardJson(text) {
  const objects = [];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "{") continue;
    let depth = 0;
    for (let j = i; j < text.length; j += 1) {
      if (text[j] === "{") depth += 1;
      else if (text[j] === "}") {
        depth -= 1;
        if (depth === 0) {
          try {
            objects.push(JSON.parse(text.slice(i, j + 1)));
          } catch {
            /* inner brace, keep scanning */
          }
          i = j;
          break;
        }
      }
    }
  }
  const useful = objects.filter((row) => row?.snapshotId || row?.version || row?.newVersion || row?.restoredTo);
  if (useful.length === 0) throw new Error(`no guard JSON in output:\n${text}`);
  return useful[useful.length - 1];
}

function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "wodeappx-se-loop-"));
  const wx = path.join(root, "wodeappx");
  write(path.join(root, "AGENTS.md"), "# fixture\n");
  write(path.join(root, ".gitignore"), "wodeappx/vendor/\n");
  write(path.join(wx, "package.json"), JSON.stringify({ name: "wodeappx-fixture" }, null, 2) + "\n");
  write(path.join(wx, MARKER), "export const marker = \"v1\";\n");
  write(path.join(wx, IGNORED), ".loop { color: #111; }\n");
  const init = git(root, ["init"]);
  assert.equal(init.status, 0, init.stderr);
  git(root, ["config", "user.name", "wodeappx-loop-test"]);
  git(root, ["config", "user.email", "loop@wodeappx.local"]);
  const add = git(root, ["add", "AGENTS.md", ".gitignore", "wodeappx/package.json", `wodeappx/${MARKER}`]);
  assert.equal(add.status, 0, add.stderr);
  const commit = git(root, ["commit", "-m", "seed"]);
  assert.equal(commit.status, 0, commit.stderr);
  return {
    root,
    wx,
    versionGit: path.join(root, ".self-evolve-version.git"),
    marker: path.join(wx, MARKER),
    ignored: path.join(wx, IGNORED),
  };
}

function runGuard(fx, args) {
  return spawnSync(process.execPath, [GUARD, ...args], {
    cwd: fx.root,
    encoding: "utf8",
    env: {
      ...process.env,
      WODEAPPX_SELF_EVOLVE_WORKTREE: fx.wx,
      WODEAPPX_SELF_EVOLVE_GIT_DIR: fx.versionGit,
      WODEAPPX_SELF_EVOLVE_OVERLAY: path.join(fx.root, ".self-evolve-overlay"),
      HOME: fx.root,
    },
  });
}

test("snapshot → edit tracked + ignored + untracked → rollback restores all three", () => {
  const fx = makeFixture();
  try {
    const snap = runGuard(fx, ["snapshot", "--label", "loop-rollback"]);
    assert.equal(snap.status, 0, snap.stderr + snap.stdout);
    const { snapshotId } = parseGuardJson(snap.stdout);
    assert.match(snapshotId, /^\d{8}-\d{6}$/);
    assert.ok(existsSync(path.join(fx.root, ".git", "self-evolve", `${snapshotId}.json`)));
    const leaked = path.resolve(path.dirname(GUARD), "..", "..", ".git", "self-evolve", `${snapshotId}.json`);
    assert.ok(!existsSync(leaked), `fixture snapshot leaked into real repo: ${leaked}`);

    writeFileSync(fx.marker, "export const marker = \"dirty\";\n");
    writeFileSync(fx.ignored, ".loop { color: #f00; }\n");
    write(path.join(fx.wx, "integrations/openwork/wodeapp/new-agent.ts"), "export const n = 1;\n");

    const rb = runGuard(fx, ["rollback", snapshotId]);
    assert.equal(rb.status, 0, rb.stderr + rb.stdout);
    assert.equal(readFileSync(fx.marker, "utf8"), "export const marker = \"v1\";\n");
    assert.equal(readFileSync(fx.ignored, "utf8"), ".loop { color: #111; }\n");
    assert.equal(existsSync(path.join(fx.wx, "integrations/openwork/wodeapp/new-agent.ts")), false);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("rollback refuses after HEAD moves; --force still restores", () => {
  const fx = makeFixture();
  try {
    const snap = runGuard(fx, ["snapshot", "--label", "head-moved"]);
    assert.equal(snap.status, 0, snap.stderr);
    const { snapshotId } = parseGuardJson(snap.stdout);
    writeFileSync(fx.marker, "export const marker = \"after-snap\";\n");
    git(fx.root, ["add", `wodeappx/${MARKER}`]);
    const committed = git(fx.root, ["commit", "-m", "post-snapshot"]);
    assert.equal(committed.status, 0, committed.stderr);

    const refused = runGuard(fx, ["rollback", snapshotId]);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /拒绝回滚：快照后 HEAD 已移动/);
    assert.equal(readFileSync(fx.marker, "utf8"), "export const marker = \"after-snap\";\n");

    const forced = runGuard(fx, ["rollback", snapshotId, "--force"]);
    assert.equal(forced.status, 0, forced.stderr + forced.stdout);
    assert.equal(readFileSync(fx.marker, "utf8"), "export const marker = \"v1\";\n");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("polite rollback skips a protected file touched by another session", () => {
  const fx = makeFixture();
  try {
    const snap = runGuard(fx, ["snapshot", "--label", "polite"]);
    assert.equal(snap.status, 0, snap.stderr);
    const { snapshotId } = parseGuardJson(snap.stdout);
    const sessions = path.join(fx.root, ".git", "self-evolve", "sessions");
    mkdirSync(sessions, { recursive: true });
    writeFileSync(path.join(sessions, "other.json"), JSON.stringify({
      id: "other",
      beganAt: Date.now() - 1000,
      heartbeat: Date.now(),
    }));
    writeFileSync(fx.ignored, ".loop { color: #0a0; }\n");
    writeFileSync(fx.marker, "export const marker = \"mine\";\n");

    const rb = runGuard(fx, ["rollback", snapshotId]);
    assert.equal(rb.status, 0, rb.stderr + rb.stdout);
    assert.match(rb.stdout, /礼貌跳过/);
    assert.equal(readFileSync(fx.ignored, "utf8"), ".loop { color: #0a0; }\n");
    assert.equal(readFileSync(fx.marker, "utf8"), "export const marker = \"v1\";\n");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("version commit then restore is append-only and brings files back", () => {
  const fx = makeFixture();
  try {
    const v1 = runGuard(fx, ["version", "commit", "--label", "v1-baseline"]);
    assert.equal(v1.status, 0, v1.stderr + v1.stdout);
    const first = parseGuardJson(v1.stdout);
    assert.ok(first.ok);
    assert.ok(existsSync(fx.versionGit));
    assert.ok(existsSync(path.join(fx.root, ".self-evolve-overlay")));

    writeFileSync(fx.marker, "export const marker = \"v2\";\n");
    const v2 = runGuard(fx, ["version", "commit", "--label", "v2-change"]);
    assert.equal(v2.status, 0, v2.stderr + v2.stdout);
    const second = parseGuardJson(v2.stdout);
    assert.notEqual(second.version, first.version);
    assert.equal(readFileSync(fx.marker, "utf8"), "export const marker = \"v2\";\n");

    const restored = runGuard(fx, ["version", "restore", first.version]);
    assert.equal(restored.status, 0, restored.stderr + restored.stdout);
    const back = parseGuardJson(restored.stdout);
    assert.ok(back.ok);
    assert.notEqual(back.newVersion, first.version);
    assert.notEqual(back.newVersion, second.version);
    assert.equal(readFileSync(fx.marker, "utf8"), "export const marker = \"v1\";\n");

    const log = runGuard(fx, ["version", "log", "--limit", "10"]);
    assert.equal(log.status, 0, log.stderr);
    assert.match(log.stdout, /v1-baseline/);
    assert.match(log.stdout, /v2-change/);
    assert.match(log.stdout, /restore to /);
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});

test("version restore refuses dirty worktree unless --force", () => {
  const fx = makeFixture();
  try {
    const v1 = runGuard(fx, ["version", "commit", "--label", "clean"]);
    assert.equal(v1.status, 0, v1.stderr + v1.stdout);
    const first = parseGuardJson(v1.stdout);
    writeFileSync(fx.marker, "export const marker = \"v2\";\n");
    const v2 = runGuard(fx, ["version", "commit", "--label", "next"]);
    assert.equal(v2.status, 0, v2.stderr + v2.stdout);

    writeFileSync(fx.marker, "export const marker = \"dirty\";\n");
    const refused = runGuard(fx, ["version", "restore", first.version]);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /拒绝回退：wodeappx 有 .* 项未提交/);
    assert.equal(readFileSync(fx.marker, "utf8"), "export const marker = \"dirty\";\n");

    const forced = runGuard(fx, ["version", "restore", first.version, "--force"]);
    assert.equal(forced.status, 0, forced.stderr + forced.stdout);
    assert.equal(readFileSync(fx.marker, "utf8"), "export const marker = \"v1\";\n");
  } finally {
    rmSync(fx.root, { recursive: true, force: true });
  }
});
