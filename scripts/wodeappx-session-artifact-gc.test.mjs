import { afterEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyArtifactGc,
  collectReferencedArtifactPaths,
  planArtifactGc,
} from "./wodeappx-session-artifact-gc.mjs";

const roots = new Set();

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "wodeappx-artifact-gc-"));
  roots.add(root);
  return root;
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

describe("wodeappx-session-artifact-gc", () => {
  test("collects file URL and artifactRef references without leaving the root", () => {
    const root = makeRoot();
    const referenced = collectReferencedArtifactPaths([
      `{"path":"file://${root}/ses-a/hash.mp4"}`,
      '{"artifactRef":"session-artifacts/ses-a/hash.mp4"}',
      '{"artifactRef":"session-media/ses-a/hash.mp4"}',
      '{"path":"/tmp/not-an-artifact.txt"}',
    ], root);
    assert.equal(referenced.size, 1);
    assert.equal([...referenced][0], join(root, "ses-a", "hash.mp4"));
  });

  test("dry-run only proposes old unreferenced files and stale temp files", () => {
    const root = makeRoot();
    const session = join(root, "ses-a");
    const other = join(root, "ses-b");
    mkdirSync(session, { recursive: true });
    mkdirSync(other, { recursive: true });
    const now = Date.now();
    const old = new Date(now - 40 * 24 * 60 * 60 * 1000);
    const staleTemp = join(session, ".tmp-crash");
    const referencedFile = join(session, "keep.mp4");
    const unreferencedFile = join(other, "remove.mp4");
    writeFileSync(staleTemp, "temp");
    writeFileSync(referencedFile, "keep");
    writeFileSync(unreferencedFile, "remove");
    utimesSync(staleTemp, old, old);
    utimesSync(referencedFile, old, old);
    utimesSync(unreferencedFile, old, old);

    const plan = planArtifactGc({
      rootDir: root,
      referencedPaths: new Set([referencedFile]),
      referencesComplete: true,
      now,
    });
    assert.equal(plan.candidateFiles, 2);
    assert.deepEqual(plan.candidates.map((item) => item.reason).sort(), ["stale-temp", "unreferenced"]);
    assert.equal(existsSync(unreferencedFile), true);
  });

  test("incomplete reference scan never proposes normal artifacts", () => {
    const root = makeRoot();
    const session = join(root, "ses-a");
    const file = join(session, "keep.mp4");
    mkdirSync(session, { recursive: true });
    writeFileSync(file, "keep");
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    utimesSync(file, old, old);
    const plan = planArtifactGc({ rootDir: root, referencesComplete: false, now: Date.now() });
    assert.equal(plan.candidateFiles, 0);
  });

  test("apply removes only planned files inside the artifact root", () => {
    const root = makeRoot();
    const session = join(root, "ses-a");
    const file = join(session, "remove.mp4");
    mkdirSync(session, { recursive: true });
    writeFileSync(file, "remove");
    const plan = { rootDir: root, candidates: [{ path: file, bytes: 6 }] };
    const removed = applyArtifactGc(plan);
    assert.equal(removed.length, 1);
    assert.equal(existsSync(file), false);
  });

  test("session quota drops oldest unreferenced first and never touches referenced", () => {
    const root = makeRoot();
    const session = join(root, "ses-quota");
    mkdirSync(session, { recursive: true });
    const now = Date.now();
    const keep = join(session, "keep.bin");
    const older = join(session, "older.bin");
    const newer = join(session, "newer.bin");
    writeFileSync(keep, "K".repeat(40));
    writeFileSync(older, "O".repeat(40));
    writeFileSync(newer, "N".repeat(40));
    utimesSync(keep, new Date(now - 3_000), new Date(now - 3_000));
    utimesSync(older, new Date(now - 2_000), new Date(now - 2_000));
    utimesSync(newer, new Date(now - 1_000), new Date(now - 1_000));

    const plan = planArtifactGc({
      rootDir: root,
      referencedPaths: new Set([keep]),
      referencesComplete: true,
      now,
      minAgeMs: 30 * 24 * 60 * 60 * 1000, // young files would not hit TTL alone
      sessionMaxBytes: 50, // keep(40) + need room → drop older(40), keep newer if under
    });
    assert.ok(plan.sessionsOverQuota.length >= 1);
    assert.equal(plan.candidates.every((item) => item.path !== keep), true);
    assert.ok(plan.candidates.some((item) => item.path === older && item.reason === "session-quota"));
    // After dropping older (40), remaining keep(40)+newer(40)=80 still over 50 → also drop newer
    assert.ok(plan.candidates.some((item) => item.path === newer && item.reason === "session-quota"));
  });
});
