import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  WODEAPP_QUICK_ORIGIN,
  migrateWodeAppLegacyCredential,
  normalizeWodeAppLoginTarget,
  normalizeWodeAppQuickOrigin,
  sanitizeWodeAppQuickAccount,
} from "./wodeapp-account-bridge.mjs";

test("quick mode pins account traffic to official WodeApp origins", () => {
  assert.equal(normalizeWodeAppQuickOrigin("https://www.wodeapp.cn/path"), "https://wodeapp.cn");
  assert.equal(normalizeWodeAppQuickOrigin("https://wodeapp.ai"), "https://wodeapp.ai");
  assert.equal(normalizeWodeAppQuickOrigin("http://127.0.0.1:3000"), WODEAPP_QUICK_ORIGIN);
  assert.equal(normalizeWodeAppQuickOrigin("https://attacker.invalid"), WODEAPP_QUICK_ORIGIN);
});

test("login targets are normalized without widening accepted identity data", () => {
  assert.equal(normalizeWodeAppLoginTarget("phone", "+86 138-0013-8000"), "13800138000");
  assert.equal(normalizeWodeAppLoginTarget("email", " USER@Example.COM "), "user@example.com");
});

test("quick account persistence keeps only the fields required by the client", () => {
  const account = sanitizeWodeAppQuickAccount({
    origin: "https://wodeapp.cn/ignored",
    apiKey: " sk_test_123 ",
    user: { id: "u1", name: "测试用户", admin: true },
    modelIds: ["m1", "m1", "", null],
    abilityProjects: [
      { id: "p1", name: "项目", url: "https://wodeapp.cn/p1", secret: "drop" },
      { id: "invalid" },
    ],
    arbitrary: "drop",
  });
  assert.equal(account.origin, "https://wodeapp.cn");
  assert.equal(account.version, 2);
  assert.equal("apiKey" in account, false);
  assert.deepEqual(account.user, { id: "u1", name: "测试用户" });
  assert.deepEqual(account.modelIds, ["m1"]);
  assert.equal(account.abilityProjects.length, 1);
  assert.equal("arbitrary" in account, false);
  assert.equal("secret" in account.abilityProjects[0], false);
});

test("quick account rejects missing credentials", () => {
  assert.equal(sanitizeWodeAppQuickAccount({ origin: WODEAPP_QUICK_ORIGIN }), null);
});

test("legacy account migration verifies secure storage before removing the plaintext key", async () => {
  const userDir = mkdtempSync(path.join(os.tmpdir(), "wodeapp-account-migration-"));
  const filePath = path.join(userDir, "account.json");
  const input = {
    origin: WODEAPP_QUICK_ORIGIN,
    apiKey: "legacy-plain-key",
    user: { id: "u1", name: "测试用户" },
  };
  const secrets = new Map();
  const credentialStore = {
    set: async (slot, value) => secrets.set(slot, value),
    get: async (slot) => secrets.get(slot) || null,
  };
  try {
    writeFileSync(filePath, JSON.stringify(input));
    await migrateWodeAppLegacyCredential({
      credentialStore,
      filePath,
      input,
      metadata: sanitizeWodeAppQuickAccount(input),
      slot: "quick-account",
    });
    const migrated = JSON.parse(readFileSync(filePath, "utf8"));
    assert.equal(migrated.version, 2);
    assert.equal("apiKey" in migrated, false);
    assert.equal(secrets.get("quick-account"), "legacy-plain-key");
  } finally {
    rmSync(userDir, { recursive: true, force: true });
  }
});
