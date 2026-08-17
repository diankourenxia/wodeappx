#!/usr/bin/env node
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

test("buildLoggedInWodeAppConfig clears embedded billing flag", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "wodeapp-login-"));
  const configPath = path.join(dir, "config.json");
  const installPath = path.join(dir, "install.json");
  await writeFile(configPath, JSON.stringify({
    profile: "cloud",
    origin: "https://wodeapp.cn",
    apiKey: "sk_live_embedded_old",
    embedded: true,
    embeddedInstallId: "wodeappx-install-1",
    user: { id: "embedded-user", name: "WodeAppX 内嵌用户" },
  }, null, 2), "utf8");
  await writeFile(installPath, JSON.stringify({ installId: "wodeappx-install-1" }), "utf8");

  const previousHome = process.env.HOME;
  process.env.HOME = dir;
  try {
    // config-store reads ~/.wodeapp — point HOME so getConfigPath lands in tmp.
    await mkdir(path.join(dir, ".wodeapp"), { recursive: true });
    await writeFile(path.join(dir, ".wodeapp", "config.json"), await readFile(configPath, "utf8"));
    await writeFile(path.join(dir, ".wodeapp", "install.json"), await readFile(installPath, "utf8"));

    const { buildLoggedInWodeAppConfig } = await import("./code-login.mjs");
    const next = await buildLoggedInWodeAppConfig({
      profile: "cloud",
      origin: "https://wodeapp.cn",
      issuedOrigin: "https://wodeapp.cn",
      apiKey: "sk_live_phone_new",
      user: { id: "phone-user", name: "用户7695" },
      abilityProjects: [],
    });
    assert.equal(next.embedded, false);
    assert.equal(next.apiKey, "sk_live_phone_new");
    assert.equal(next.user.id, "phone-user");
    assert.equal(next.embeddedInstallId, "wodeappx-install-1");
  } finally {
    process.env.HOME = previousHome;
  }
});
