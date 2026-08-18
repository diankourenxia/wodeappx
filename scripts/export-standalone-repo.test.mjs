#!/usr/bin/env node
/**
 * Unit tests for export-standalone-repo.mjs guards
 * Run with: node --test scripts/export-standalone-repo.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert";
import { validateRemote, validateGitArgs, validatePushOrphanWithoutForce } from "./export-standalone-repo.mjs";

test("validateRemote rejects non-whitelisted remote", () => {
  assert.throws(
    () => validateRemote("git@github.com:attacker/malicious.git"),
    /not in whitelist/,
    "Should reject non-whitelisted remote"
  );
});

test("validateRemote accepts whitelisted remote (SSH)", () => {
  assert.doesNotThrow(
    () => validateRemote("git@github.com:diankourenxia/wodeappx.git"),
    "Should accept whitelisted SSH remote"
  );
});

test("validateRemote accepts whitelisted remote (HTTPS)", () => {
  assert.doesNotThrow(
    () => validateRemote("https://github.com/diankourenxia/wodeappx.git"),
    "Should accept whitelisted HTTPS remote"
  );
});

test("validateRemote rejects invalid URL format", () => {
  assert.throws(
    () => validateRemote("invalid-url"),
    /Invalid remote URL format/,
    "Should reject invalid URL format"
  );
});

test("validateGitArgs rejects bare --force", () => {
  assert.throws(
    () => validateGitArgs(["push", "--force", "origin", "main"]),
    /Bare --force is forbidden/,
    "Should reject bare --force flag"
  );
});

test("validateGitArgs rejects bare -f", () => {
  assert.throws(
    () => validateGitArgs(["push", "-f", "origin", "main"]),
    /Bare --force is forbidden/,
    "Should reject bare -f flag"
  );
});

test("validateGitArgs accepts --force-with-lease", () => {
  assert.doesNotThrow(
    () => validateGitArgs(["push", "--force-with-lease=refs/heads/main:abc123", "origin", "main"]),
    "Should accept --force-with-lease with explicit SHA"
  );
});

test("validateGitArgs accepts normal push", () => {
  assert.doesNotThrow(
    () => validateGitArgs(["push", "-u", "origin", "main"]),
    "Should accept normal push without force"
  );
});

test("validatePushOrphanWithoutForce rejects PUSH=1 + orphan without FORCE_EXPORT", () => {
  assert.throws(
    () => validatePushOrphanWithoutForce(true, "orphan", false),
    /PUSH=1 with --mode=orphan requires FORCE_EXPORT=1/,
    "Should reject PUSH=1 with orphan mode when FORCE_EXPORT is not set"
  );
});

test("validatePushOrphanWithoutForce accepts PUSH=1 + orphan with FORCE_EXPORT=1", () => {
  assert.doesNotThrow(
    () => validatePushOrphanWithoutForce(true, "orphan", true),
    "Should accept PUSH=1 with orphan mode when FORCE_EXPORT=1"
  );
});

test("validatePushOrphanWithoutForce accepts PUSH=1 + incremental", () => {
  assert.doesNotThrow(
    () => validatePushOrphanWithoutForce(true, "incremental", false),
    "Should accept PUSH=1 with incremental mode"
  );
});

test("validatePushOrphanWithoutForce accepts no push with orphan", () => {
  assert.doesNotThrow(
    () => validatePushOrphanWithoutForce(false, "orphan", false),
    "Should accept orphan mode without push"
  );
});
