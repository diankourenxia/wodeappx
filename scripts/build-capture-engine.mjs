import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const engineRoot = join(root, "capture-engine");
const sidecarDir = join(root, "vendor", "openwork", "apps", "desktop", "resources", "sidecars");
const legacySidecarDir = join(root, "apps", "desktop", "resources", "sidecars");

function envTargetTriple() {
  return (
    process.env.TAURI_ENV_TARGET_TRIPLE ||
    process.env.CARGO_CFG_TARGET_TRIPLE ||
    process.env.TARGET ||
    ""
  ).trim();
}

function targetInfo() {
  const explicit = envTargetTriple();
  if (explicit === "aarch64-apple-darwin") {
    return { platform: "darwin", arch: "arm64", goos: "darwin", goarch: "arm64", triple: explicit };
  }
  if (explicit === "x86_64-apple-darwin") {
    return { platform: "darwin", arch: "x64", goos: "darwin", goarch: "amd64", triple: explicit };
  }
  if (explicit === "aarch64-unknown-linux-gnu") {
    return { platform: "linux", arch: "arm64", goos: "linux", goarch: "arm64", triple: explicit };
  }
  if (explicit === "x86_64-unknown-linux-gnu") {
    return { platform: "linux", arch: "x64", goos: "linux", goarch: "amd64", triple: explicit };
  }
  if (explicit === "aarch64-pc-windows-msvc") {
    return { platform: "win32", arch: "arm64", goos: "windows", goarch: "arm64", triple: explicit };
  }
  if (explicit === "x86_64-pc-windows-msvc") {
    return { platform: "win32", arch: "x64", goos: "windows", goarch: "amd64", triple: explicit };
  }

  if (process.platform === "darwin") {
    if (process.arch === "arm64") {
      return { platform: "darwin", arch: "arm64", goos: "darwin", goarch: "arm64", triple: "aarch64-apple-darwin" };
    }
    if (process.arch === "x64") {
      return { platform: "darwin", arch: "x64", goos: "darwin", goarch: "amd64", triple: "x86_64-apple-darwin" };
    }
  }
  if (process.platform === "linux") {
    if (process.arch === "arm64") {
      return { platform: "linux", arch: "arm64", goos: "linux", goarch: "arm64", triple: "aarch64-unknown-linux-gnu" };
    }
    if (process.arch === "x64") {
      return { platform: "linux", arch: "x64", goos: "linux", goarch: "amd64", triple: "x86_64-unknown-linux-gnu" };
    }
  }
  if (process.platform === "win32") {
    if (process.arch === "arm64") {
      return { platform: "win32", arch: "arm64", goos: "windows", goarch: "arm64", triple: "aarch64-pc-windows-msvc" };
    }
    if (process.arch === "x64") {
      return { platform: "win32", arch: "x64", goos: "windows", goarch: "amd64", triple: "x86_64-pc-windows-msvc" };
    }
  }
  return null;
}

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(command),
    env: { ...process.env, ...env },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function makeExecutable(filePath) {
  if (process.platform === "win32") return;
  chmodSync(filePath, 0o755);
}

function adHocSignDarwin(filePath) {
  if (process.platform !== "darwin" || !existsSync(filePath)) return;
  const result = spawnSync("codesign", ["--force", "--sign", "-", filePath], {
    encoding: "utf8",
  });
  if (result.error && result.error.code === "ENOENT") return;
  if (result.status !== 0) {
    process.stderr.write(result.stderr || "");
  }
}

const target = targetInfo();
if (!target) {
  throw new Error(`Unsupported capture engine target: ${envTargetTriple() || `${process.platform}-${process.arch}`}`);
}

const binary = `wodeappx-capture-engine${target.platform === "win32" ? ".exe" : ""}`;
const platformArch = `${target.platform}-${target.arch}`;
const triple = target.triple;
const binDir = join(engineRoot, "bin", platformArch);
const outputPath = join(binDir, binary);

mkdirSync(binDir, { recursive: true });
run("go", ["build", "-o", outputPath, "./cmd/wodeappx-capture-engine"], engineRoot, {
  GOOS: target.goos,
  GOARCH: target.goarch,
});
makeExecutable(outputPath);
adHocSignDarwin(outputPath);

const names = [
  binary,
  `wodeappx-capture-engine-${platformArch}${target.platform === "win32" ? ".exe" : ""}`,
  triple ? `wodeappx-capture-engine-${triple}${target.platform === "win32" ? ".exe" : ""}` : "",
].filter(Boolean);

for (const dir of [sidecarDir, legacySidecarDir]) {
  mkdirSync(dir, { recursive: true });
  for (const name of names) {
    const target = join(dir, name);
    copyFileSync(outputPath, target);
    makeExecutable(target);
    adHocSignDarwin(target);
  }
}

process.stdout.write(`${JSON.stringify({ ok: true, output: outputPath, sidecarDir, legacySidecarDir }, null, 2)}\n`);
