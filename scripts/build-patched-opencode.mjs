#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const wodeappxRoot = path.resolve(scriptDir, "..");
const constantsPath = path.join(wodeappxRoot, "vendor", "openwork", "constants.json");
const patcherPath = path.join(scriptDir, "patch-opencode-dynamic-tools.mjs");
const overlayPaths = [
  patcherPath,
  path.join(wodeappxRoot, "integrations", "opencode", "dynamic-tool-discovery.ts"),
  path.join(wodeappxRoot, "integrations", "opencode", "dynamic-tool-discovery.test.ts"),
  path.join(wodeappxRoot, "integrations", "opencode", "bash-background-detach.ts"),
  path.join(wodeappxRoot, "integrations", "opencode", "bash-background-detach.test.ts"),
  path.join(wodeappxRoot, "integrations", "opencode", "session-sticky-leases.ts"),
  path.join(wodeappxRoot, "integrations", "opencode", "wodeapp-capability-preload.ts"),
  path.join(wodeappxRoot, "integrations", "opencode", "session-tool-permissions.ts"),
  path.join(wodeappxRoot, "integrations", "opencode", "session-tool-permissions.test.ts"),
  path.join(wodeappxRoot, "integrations", "opencode", "session-transient-network-error.ts"),
  path.join(wodeappxRoot, "integrations", "opencode", "session-transient-network-error.test.ts"),
  path.join(wodeappxRoot, "integrations", "opencode", "event-payload-externalize.ts"),
  path.join(wodeappxRoot, "integrations", "opencode", "event-payload-externalize.test.ts"),
  path.join(wodeappxRoot, "integrations", "opencode", "compacted-tool-stub.ts"),
  path.join(wodeappxRoot, "integrations", "opencode", "compacted-tool-stub.test.ts"),
];

function readArg(name) {
  const args = process.argv.slice(2);
  const direct = args.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.slice(2).includes(name);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: options.capture ? "utf8" : undefined,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? result.stderr?.trim() : "";
    throw new Error(`${command} exited with ${result.status}${detail ? `: ${detail}` : ""}`);
  }
  return options.capture ? result.stdout.trim() : "";
}

/**
 * bun test on windows-latest sometimes reports a phantom `(unnamed)` failure:
 * all named tests pass, then a file-level afterEach "hook timed out" at the
 * default 5s. Accept that single pattern so packaging is not blocked; any real
 * assertion failure still fails the build.
 */
function isWindowsPhantomHookTimeout(output) {
  if (process.platform !== "win32") return false;
  const pass = Number((output.match(/^\s*(\d+) pass\b/m) || [])[1] || 0);
  const fail = Number((output.match(/^\s*(\d+) fail\b/m) || [])[1] || 0);
  return (
    pass > 0
    && fail === 1
    && /\(fail\) \(unnamed\)/.test(output)
    && /hook timed out for this test/.test(output)
    && !/\(fail\) (?!\(unnamed\))/.test(output)
  );
}

function runBunTest(testArgs, options = {}) {
  const args = ["test", "--timeout=30000", ...testArgs];
  const result = spawnSync("bun", args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  if (output) process.stdout.write(output);
  if (result.status === 0) return;
  if (isWindowsPhantomHookTimeout(output)) {
    console.warn(
      "[build-patched-opencode] ignoring Windows bun phantom afterEach hook timeout "
      + "(named tests already passed)",
    );
    return;
  }
  throw new Error(`bun exited with ${result.status}`);
}

function signDarwinBinary(filePath, target) {
  if (!target.includes("apple-darwin")) return;
  // Bun's standalone Mach-O can carry a stale linker signature after the
  // WodeAppX overlay build/copy. macOS then kills it with SIGKILL before
  // `--version` runs. Re-sign the final artifact ad hoc on every materialize.
  run("codesign", ["--force", "--sign", "-", filePath]);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function opencodeVersion() {
  const constants = JSON.parse(await readFile(constantsPath, "utf8"));
  const value = typeof constants.opencodeVersion === "string"
    ? constants.opencodeVersion.trim().replace(/^v/, "")
    : "";
  if (!value) throw new Error(`Missing opencodeVersion in ${constantsPath}`);
  return value;
}

async function patchID(version) {
  const hash = createHash("sha256");
  hash.update(`opencode:${version}\n`);
  for (const filePath of overlayPaths) {
    hash.update(path.basename(filePath));
    hash.update("\n");
    hash.update(await readFile(filePath));
    hash.update("\n");
  }
  return `wodeappx-dynamic-tools-${version}-${hash.digest("hex").slice(0, 16)}`;
}

function defaultTarget() {
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  if (process.platform === "linux") {
    return process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
  }
  if (process.platform === "win32") {
    return process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }
  throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`);
}

function builtBinaryPath(sourceRoot, target) {
  const suffix = target.includes("windows") ? ".exe" : "";
  const directory = target === "aarch64-apple-darwin"
    ? "opencode-darwin-arm64"
    : target === "x86_64-apple-darwin"
      ? "opencode-darwin-x64-baseline"
      : target === "aarch64-unknown-linux-gnu"
        ? "opencode-linux-arm64"
        : target === "x86_64-unknown-linux-gnu"
          ? "opencode-linux-x64-baseline"
          : target === "aarch64-pc-windows-msvc"
            ? "opencode-windows-arm64"
            : target === "x86_64-pc-windows-msvc"
              ? "opencode-windows-x64-baseline"
              : "";
  if (!directory) throw new Error(`Unsupported OpenCode build target: ${target}`);
  return path.join(sourceRoot, "packages", "opencode", "dist", directory, "bin", `opencode${suffix}`);
}

async function writeMarker(markerPath, payload) {
  if (!markerPath) return;
  await mkdir(path.dirname(markerPath), { recursive: true });
  await writeFile(markerPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function main() {
  const version = await opencodeVersion();
  const id = await patchID(version);
  if (hasFlag("--print-id")) {
    console.log(id);
    return;
  }

  const outputArg = readArg("--out");
  if (!outputArg) {
    throw new Error("Usage: build-patched-opencode.mjs --out <binary> [--target <triple>]");
  }

  const target = readArg("--target") ?? defaultTarget();
  const outputPath = path.resolve(outputArg);
  const markerPath = readArg("--marker") ? path.resolve(readArg("--marker")) : undefined;
  const cacheBase = process.env.WODEAPPX_OPENCODE_BUILD_CACHE?.trim()
    || path.join(process.env.XDG_CACHE_HOME?.trim() || path.join(homedir(), ".cache"), "wodeappx", "opencode");
  const cacheRoot = path.join(cacheBase, id);
  const sourceRoot = process.env.WODEAPPX_OPENCODE_SOURCE?.trim()
    ? path.resolve(process.env.WODEAPPX_OPENCODE_SOURCE)
    : path.join(cacheRoot, "source");
  const cachedBinary = path.join(cacheRoot, target, target.includes("windows") ? "opencode.exe" : "opencode");
  const sourceMarker = path.join(sourceRoot, ".wodeappx-dynamic-tools");

  if (!await exists(cachedBinary)) {
    if (!await exists(path.join(sourceRoot, ".git"))) {
      await mkdir(path.dirname(sourceRoot), { recursive: true });
      run("git", [
        "clone",
        "--quiet",
        "--depth",
        "1",
        "--branch",
        `v${version}`,
        "https://github.com/anomalyco/opencode.git",
        sourceRoot,
      ]);
    }

    const currentMarker = await readFile(sourceMarker, "utf8").catch(() => "");
    if (currentMarker.trim() !== id) {
      run(process.execPath, [patcherPath, "--source", sourceRoot]);
      await writeFile(sourceMarker, `${id}\n`, "utf8");
    }

    // Install optional native deps for the *target* platform, not the host:
    // building darwin-x64 on an arm64 Mac otherwise misses packages such as
    // @ff-labs/fff-bin-darwin-x64 and the compile step fails to resolve them.
    // Bun's --os flag uses Node-style names (win32), not "windows".
    const targetOs = target.includes("darwin") ? "darwin" : target.includes("windows") ? "win32" : "linux";
    const targetCpu = target.startsWith("aarch64") || target.includes("arm64") ? "arm64" : "x64";
    run("bun", ["install", "--ignore-scripts", `--os=${targetOs}`, `--cpu=${targetCpu}`], { cwd: sourceRoot });
    run("bun", ["run", "typecheck"], {
      cwd: path.join(sourceRoot, "packages", "opencode"),
    });
    runBunTest(["src/session/dynamic-tool-discovery.test.ts"], {
      cwd: path.join(sourceRoot, "packages", "opencode"),
    });
    runBunTest(["src/session/bash-background-detach.test.ts"], {
      cwd: path.join(sourceRoot, "packages", "opencode"),
    });
    runBunTest(["src/session/session-tool-permissions.test.ts"], {
      cwd: path.join(sourceRoot, "packages", "opencode"),
    });
    runBunTest(["src/session/event-payload-externalize.test.ts"], {
      cwd: path.join(sourceRoot, "packages", "opencode"),
    });
    runBunTest(["test/session/compaction-in-turn-prune.test.ts"], {
      cwd: path.join(sourceRoot, "packages", "opencode"),
    });
    runBunTest(["test/tool/truncate-handled-gate.runtime.test.ts"], {
      cwd: path.join(sourceRoot, "packages", "opencode"),
    });
    runBunTest(["test/tool/task.test.ts", "test/mcp/transport.test.ts"], {
      cwd: path.join(sourceRoot, "packages", "opencode"),
    });
    runBunTest(["test/provider-error.test.ts"], {
      cwd: path.join(sourceRoot, "packages", "llm"),
    });
    run("bun", [
      "run",
      "packages/opencode/script/build.ts",
      "--skip-embed-web-ui",
      "--skip-install",
      `--target=${target}`,
    ], {
      cwd: sourceRoot,
      env: {
        ...process.env,
        OPENCODE_VERSION: version,
      },
    });

    const built = builtBinaryPath(sourceRoot, target);
    if (!await exists(built)) throw new Error(`Patched OpenCode build output missing: ${built}`);
    await mkdir(path.dirname(cachedBinary), { recursive: true });
    await copyFile(built, cachedBinary);
    if (!target.includes("windows")) await chmod(cachedBinary, 0o755);
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await copyFile(cachedBinary, outputPath);
  if (!target.includes("windows")) await chmod(outputPath, 0o755);
  signDarwinBinary(outputPath, target);
  await writeMarker(markerPath, {
    patchID: id,
    opencodeVersion: version,
    target,
    builtAt: new Date().toISOString(),
  });
  console.log(`Prepared patched OpenCode ${version} (${id}) for ${target}: ${outputPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
