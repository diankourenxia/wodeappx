import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  WODEAPP_CREDENTIAL_SLOTS,
  createWodeAppSecureCredentialStore,
  wodeAppDataDir,
} from "./wodeapp-secure-credentials.mjs";

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${[...value].reverse().join("")}`, "utf8"),
    decryptString: (value) => [...value.toString("utf8").replace(/^encrypted:/, "")].reverse().join(""),
  };
}

describe("WodeApp secure credential store", () => {
  it("allows an isolated credential directory only for explicit test instances", () => {
    const isolatedDir = path.join(os.tmpdir(), "wodeapp-isolated-data");
    assert.equal(wodeAppDataDir({ WODEAPPX_TEST_WODEAPP_DIR: isolatedDir }), path.join(os.homedir(), ".wodeapp"));
    assert.equal(wodeAppDataDir({
      WODEAPPX_TEST_INSTANCE_ID: "security-smoke",
      WODEAPPX_TEST_WODEAPP_DIR: isolatedDir,
    }), isolatedDir);
  });

  it("persists only OS-encrypted ciphertext in a user-only file", async () => {
    const userDir = mkdtempSync(path.join(os.tmpdir(), "wodeapp-credentials-"));
    try {
      const store = createWodeAppSecureCredentialStore({
        safeStorage: fakeSafeStorage(),
        platform: "darwin",
        userDir,
      });
      await store.set(WODEAPP_CREDENTIAL_SLOTS.quickAccount, "secret-quick-key");
      const raw = readFileSync(store.filePath, "utf8");
      assert.equal(raw.includes("secret-quick-key"), false);
      assert.equal(statSync(store.filePath).mode & 0o777, 0o600);
      assert.equal(await store.get(WODEAPP_CREDENTIAL_SLOTS.quickAccount), "secret-quick-key");
    } finally {
      rmSync(userDir, { recursive: true, force: true });
    }
  });

  it("keeps credential slots independent and deletes an empty envelope", async () => {
    const userDir = mkdtempSync(path.join(os.tmpdir(), "wodeapp-credentials-"));
    try {
      const store = createWodeAppSecureCredentialStore({
        safeStorage: fakeSafeStorage(),
        platform: "win32",
        userDir,
      });
      await store.set(WODEAPP_CREDENTIAL_SLOTS.quickAccount, "quick-key");
      await store.set(WODEAPP_CREDENTIAL_SLOTS.service, "service-key");
      await store.remove(WODEAPP_CREDENTIAL_SLOTS.quickAccount);
      assert.equal(await store.get(WODEAPP_CREDENTIAL_SLOTS.quickAccount), null);
      assert.equal(await store.get(WODEAPP_CREDENTIAL_SLOTS.service), "service-key");
      await store.remove(WODEAPP_CREDENTIAL_SLOTS.service);
      assert.throws(() => statSync(store.filePath), /ENOENT/);
    } finally {
      rmSync(userDir, { recursive: true, force: true });
    }
  });

  it("fails closed when Linux safeStorage falls back to basic_text", async () => {
    const store = createWodeAppSecureCredentialStore({
      safeStorage: {
        ...fakeSafeStorage(),
        getSelectedStorageBackend: () => "basic_text",
      },
      platform: "linux",
      userDir: path.join(os.tmpdir(), "unused-wodeapp-credentials"),
    });
    assert.deepEqual(store.status(), {
      available: false,
      backend: "basic_text",
      reason: "Linux 未检测到 Secret Service，已拒绝使用 basic_text 保存凭证",
    });
    await assert.rejects(
      store.set(WODEAPP_CREDENTIAL_SLOTS.quickAccount, "must-not-persist"),
      (error) => error instanceof Error
        && "code" in error
        && error.code === "SECURE_STORAGE_UNAVAILABLE",
    );
  });
});
