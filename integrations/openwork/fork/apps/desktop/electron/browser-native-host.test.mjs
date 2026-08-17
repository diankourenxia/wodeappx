import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  isEphemeralFsPath,
  nativeHostManifest,
  nativeHostManifestTargets,
  nativeHostTargetTriple,
  registerBrowserNativeHost,
  shouldSkipNativeHostRegistration,
  WODEAPPX_BROWSER_EXTENSION_ORIGINS,
  WODEAPPX_BROWSER_NATIVE_HOST_NAME,
} from "./browser-native-host.mjs";

describe("WodeAppX Chrome native-host registration", () => {
  it("maps supported desktop architectures", () => {
    assert.equal(nativeHostTargetTriple("darwin", "arm64"), "aarch64-apple-darwin");
    assert.equal(nativeHostTargetTriple("darwin", "x64"), "x86_64-apple-darwin");
    assert.equal(nativeHostTargetTriple("win32", "x64"), "x86_64-pc-windows-msvc");
    assert.equal(nativeHostTargetTriple("linux", "arm64"), "aarch64-unknown-linux-gnu");
    assert.equal(nativeHostTargetTriple("freebsd", "x64"), null);
  });

  it("builds a fixed stdio manifest for only the WodeAppX extensions", () => {
    const manifest = nativeHostManifest("/tmp/wodeappx-browser-native-host");
    assert.equal(manifest.name, WODEAPPX_BROWSER_NATIVE_HOST_NAME);
    assert.equal(manifest.type, "stdio");
    assert.equal(manifest.allowed_origins.length, 2);
    assert.deepEqual(manifest.allowed_origins, [...WODEAPPX_BROWSER_EXTENSION_ORIGINS]);
  });

  it("uses the per-user Chrome, Chrome for Testing, and Chromium manifest directories on macOS", () => {
    const targets = nativeHostManifestTargets({
      platform: "darwin",
      homeDir: "/Users/tester",
    }).map((target) => target.replaceAll("\\", "/"));
    assert.equal(targets.length, 3);
    assert.match(targets[0], /Google\/Chrome\/NativeMessagingHosts/);
    assert.match(targets[1], /Google\/Chrome for Testing\/NativeMessagingHosts/);
    assert.match(targets[2], /Chromium\/NativeMessagingHosts/);
  });

  it("writes manifests that point at the packaged host", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wodeappx-native-host-"));
    try {
      const resourcesPath = path.join(root, "resources");
      const nativeHostDir = path.join(resourcesPath, "native-hosts");
      const hostPath = path.join(nativeHostDir, "wodeappx-browser-native-host");
      const homeDir = path.join(root, "home");
      await mkdir(nativeHostDir, { recursive: true });
      await writeFile(hostPath, "native-host");

      const result = await registerBrowserNativeHost({
        app: { getPath: () => path.join(root, "user-data") },
        platform: "darwin",
        arch: "arm64",
        homeDir,
        resourcesPath,
      });

      assert.equal(result.ok, true);
      assert.equal(result.hostPath, hostPath);
      const installed = JSON.parse(await readFile(result.manifestPaths[0], "utf8"));
      assert.equal(installed.path, hostPath);
      assert.equal(installed.name, WODEAPPX_BROWSER_NATIVE_HOST_NAME);
      assert.deepEqual(installed.allowed_origins, [...WODEAPPX_BROWSER_EXTENSION_ORIGINS]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns a structured result when the packaged host is missing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wodeappx-native-host-missing-"));
    try {
      const result = await registerBrowserNativeHost({
        app: { getPath: () => path.join(root, "user-data") },
        platform: "darwin",
        arch: "arm64",
        homeDir: path.join(root, "home"),
        resourcesPath: path.join(root, "resources"),
        developmentRoot: path.join(root, "development"),
      });
      assert.deepEqual(result, {
        ok: false,
        reason: "host_missing",
        hostName: WODEAPPX_BROWSER_NATIVE_HOST_NAME,
        target: "aarch64-apple-darwin",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("treats /tmp packaged hosts as ephemeral", () => {
    assert.equal(isEphemeralFsPath("/tmp/WodeAppX-OSS-qa.app/Contents/Resources/native-hosts/host"), true);
    assert.equal(isEphemeralFsPath("/private/tmp/WodeAppX-OSS-qa.app/Contents/Resources/native-hosts/host"), true);
    assert.equal(
      isEphemeralFsPath("/Users/tester/Desktop/wodeapp/wodeappx/vendor/openwork/apps/desktop/resources/native-hosts/host"),
      false,
    );
  });

  it("does not write an ephemeral host into the real user Chrome directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wodeappx-native-host-ephemeral-"));
    try {
      const resourcesPath = path.join(root, "resources");
      const nativeHostDir = path.join(resourcesPath, "native-hosts");
      const hostPath = path.join(nativeHostDir, "wodeappx-browser-native-host");
      const realHome = path.join(root, "real-home");
      await mkdir(nativeHostDir, { recursive: true });
      await writeFile(hostPath, "native-host");

      const skip = shouldSkipNativeHostRegistration({
        hostPath,
        homeDir: realHome,
        realHome,
      });
      assert.equal(skip.skip, true);
      assert.equal(skip.reason, "ephemeral_host_skipped");

      const result = await registerBrowserNativeHost({
        app: { getPath: () => path.join(root, "user-data") },
        platform: "darwin",
        arch: "arm64",
        homeDir: realHome,
        realHome,
        resourcesPath,
      });
      assert.equal(result.ok, false);
      assert.equal(result.reason, "ephemeral_host_skipped");
      await assert.rejects(
        () => readFile(path.join(realHome, "Library/Application Support/Google/Chrome/NativeMessagingHosts", `${WODEAPPX_BROWSER_NATIVE_HOST_NAME}.json`)),
        { code: "ENOENT" },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("still registers an ephemeral host into an isolated HOME (tests/QA)", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wodeappx-native-host-isolated-"));
    try {
      const resourcesPath = path.join(root, "resources");
      const nativeHostDir = path.join(resourcesPath, "native-hosts");
      const hostPath = path.join(nativeHostDir, "wodeappx-browser-native-host");
      const isolatedHome = path.join(root, "isolated-home");
      const realHome = path.join(root, "real-home");
      await mkdir(nativeHostDir, { recursive: true });
      await writeFile(hostPath, "native-host");

      const result = await registerBrowserNativeHost({
        app: { getPath: () => path.join(root, "user-data") },
        platform: "darwin",
        arch: "arm64",
        homeDir: isolatedHome,
        realHome,
        resourcesPath,
      });
      assert.equal(result.ok, true);
      const installed = JSON.parse(await readFile(result.manifestPaths[0], "utf8"));
      assert.equal(installed.path, hostPath);
      await assert.rejects(
        () => readFile(path.join(realHome, "Library/Application Support/Google/Chrome/NativeMessagingHosts", `${WODEAPPX_BROWSER_NATIVE_HOST_NAME}.json`)),
        { code: "ENOENT" },
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
