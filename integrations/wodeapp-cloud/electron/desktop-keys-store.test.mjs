import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ensureDesktopKeysMigrated,
  envMapToMediaByok,
  isVendorEnvKey,
  desktopStoreHasLocalVendorKeys,
  loadDesktopKeysStore,
  mediaByokToEnvEntries,
} from "./desktop-keys-store.mjs";

async function withTempHome(fn) {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "wodeapp-keys-"));
  const prevStore = process.env.OPENWORK_ENV_STORE;
  const prevXdg = process.env.XDG_CONFIG_HOME;
  process.env.OPENWORK_ENV_STORE = path.join(homeDir, ".wodeapp", "keys.json");
  delete process.env.XDG_CONFIG_HOME;
  try {
    return await fn(homeDir);
  } finally {
    if (prevStore === undefined) delete process.env.OPENWORK_ENV_STORE;
    else process.env.OPENWORK_ENV_STORE = prevStore;
    if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = prevXdg;
    await rm(homeDir, { recursive: true, force: true });
  }
}

test("stores known vendors, groq/custom suffixes, and still drops payment/jwt/db", () => {
  assert.equal(isVendorEnvKey("ARK_API_KEY"), true);
  assert.equal(isVendorEnvKey("GROQ_API_KEY"), true);
  assert.equal(isVendorEnvKey("MY_PROXY_API_KEY"), true);
  assert.equal(isVendorEnvKey("MY_PROXY_BASE_URL"), true);
  assert.equal(isVendorEnvKey("ANTHROPIC_AUTH_TOKEN"), true);
  assert.equal(isVendorEnvKey("WODEAPP_API_KEY"), false);
  assert.equal(isVendorEnvKey("JWT_SECRET"), false);
  assert.equal(isVendorEnvKey("STRIPE_SECRET_KEY"), false);
  assert.equal(isVendorEnvKey("ALIPAY_PRIVATE_KEY"), false);
  assert.equal(isVendorEnvKey("ALIYUN_SMS_ACCESS_KEY_SECRET"), false);
  assert.equal(isVendorEnvKey("DATABASE_URL"), false);
  assert.equal(isVendorEnvKey("PORT"), false);
});

test("migrates vendor keys once and skips secrets outside the allowlist", async () => {
  await withTempHome(async (homeDir) => {
    await mkdir(path.join(homeDir, ".config", "openwork"), { recursive: true });
    await writeFile(
      path.join(homeDir, ".config", "openwork", "env.json"),
      JSON.stringify({
        schemaVersion: 1,
        variables: [
          { key: "DEEPSEEK_API_KEY", value: "sk-deepseek-legacy-fixture" },
          { key: "JWT_SECRET", value: "should-not-copy" },
        ],
      }),
    );
    const first = await ensureDesktopKeysMigrated({
      homeDir,
      projectEnvMap: {
        ARK_API_KEY: "ark-from-project-fixture",
        GROQ_API_KEY: "gsk-custom-fixture",
        MY_PROXY_API_KEY: "sk-my-proxy-fixture",
        STRIPE_SECRET_KEY: "sk_live_should-not-copy",
        DATABASE_URL: "postgres://local",
      },
      mediaFile: {
        version: 1,
        providers: { kling: { accessKey: "kling-ak-fixture", secretKey: "kling-sk-fixture" } },
      },
    });
    assert.equal(first.migrated, true);
    const keys = Object.fromEntries(first.store.variables.map((item) => [item.key, item.value]));
    assert.equal(keys.DEEPSEEK_API_KEY, "sk-deepseek-legacy-fixture");
    assert.equal(keys.ARK_API_KEY, "ark-from-project-fixture");
    assert.equal(keys.GROQ_API_KEY, "gsk-custom-fixture");
    assert.equal(keys.MY_PROXY_API_KEY, "sk-my-proxy-fixture");
    assert.equal(keys.KLING_ACCESS_KEY, "kling-ak-fixture");
    assert.equal(keys.JWT_SECRET, undefined);
    assert.equal(keys.STRIPE_SECRET_KEY, undefined);
    assert.equal(keys.DATABASE_URL, undefined);
    assert.ok(first.store.migratedAt > 0);

    const second = await ensureDesktopKeysMigrated({
      homeDir,
      projectEnvMap: { ARK_API_KEY: "ark-changed-after-migrate" },
    });
    assert.equal(second.migrated, false);
    const after = Object.fromEntries(second.store.variables.map((item) => [item.key, item.value]));
    assert.equal(after.ARK_API_KEY, "ark-from-project-fixture");
  });
});

test("media-byok shape round-trips through env entries", () => {
  const media = {
    version: 1,
    preferLocal: true,
    providers: {
      kling: { accessKey: "ak", secretKey: "sk" },
      seedance: { apiKey: "ark-media" },
    },
  };
  const entries = mediaByokToEnvEntries(media);
  const envMap = new Map(entries.map((item) => [item.key, item.value]));
  const back = envMapToMediaByok(envMap, true);
  assert.equal(back.providers.kling.accessKey, "ak");
  assert.equal(back.providers.kling.secretKey, "sk");
  assert.equal(back.providers.seedance.apiKey, "ark-media");
});

test("loadDesktopKeysStore reads OPENWORK_ENV_STORE", async () => {
  await withTempHome(async (homeDir) => {
    await ensureDesktopKeysMigrated({
      homeDir,
      projectEnvMap: { OPENAI_API_KEY: "sk-openai-fixture-key" },
    });
    const loaded = await loadDesktopKeysStore(homeDir);
    const raw = JSON.parse(await readFile(loaded.storePath, "utf8"));
    assert.equal(path.basename(loaded.storePath), "keys.json");
    assert.equal(raw.variables[0].key, "OPENAI_API_KEY");
    assert.equal(JSON.stringify(raw).includes("sk-openai-fixture-key"), true);
  });
});

test("desktopStoreHasLocalVendorKeys detects ARK and ignores placeholders / WodeApp", () => {
  assert.equal(desktopStoreHasLocalVendorKeys({
    variables: [{ key: "ARK_API_KEY", value: "ark-live-fixture" }],
  }), true);
  assert.equal(desktopStoreHasLocalVendorKeys({
    variables: [{ key: "ARK_API_KEY", value: "your_ark_api_key" }],
  }), false);
  assert.equal(desktopStoreHasLocalVendorKeys({
    variables: [{ key: "WODEAPP_API_KEY", value: "sk_live_platform" }],
  }), false);
  assert.equal(desktopStoreHasLocalVendorKeys({ variables: [] }), false);
});
