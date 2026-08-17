import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

if (process.platform !== "darwin") {
  process.stdout.write(`${JSON.stringify({ ok: true, skipped: true, reason: "macOS-only helper" })}\n`);
  process.exit(0);
}

const source = join(root, "native", "local-speech", "main.swift");
const buildRoot = join(root, "native", "local-speech", ".build");
const helperName = "wodeappx-local-speech.app";
const executableName = "wodeappx-local-speech";
const bundlePath = join(buildRoot, helperName);
const contentsPath = join(bundlePath, "Contents");
const executableDir = join(contentsPath, "MacOS");
const executablePath = join(executableDir, executableName);

rmSync(bundlePath, { recursive: true, force: true });
mkdirSync(executableDir, { recursive: true });

function compileArch(arch, outPath) {
  const compile = spawnSync("xcrun", [
    "swiftc",
    "-O",
    "-target",
    `${arch}-apple-macos13.0`,
    "-framework",
    "Speech",
    source,
    "-o",
    outPath,
  ], { stdio: "inherit" });
  if (compile.status !== 0) process.exit(compile.status ?? 1);
}

const armOut = join(buildRoot, `${executableName}-arm64`);
const x64Out = join(buildRoot, `${executableName}-x86_64`);
compileArch("arm64", armOut);
compileArch("x86_64", x64Out);
const lipo = spawnSync("lipo", ["-create", armOut, x64Out, "-output", executablePath], { stdio: "inherit" });
if (lipo.status !== 0) process.exit(lipo.status ?? 1);
chmodSync(executablePath, 0o755);
rmSync(armOut, { force: true });
rmSync(x64Out, { force: true });

const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>CFBundleDisplayName</key><string>WodeAppX 语音识别</string>
  <key>CFBundleExecutable</key><string>${executableName}</string>
  <key>CFBundleIdentifier</key><string>com.wodeapp.wodeappx.local-speech</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleName</key><string>WodeAppX 语音识别</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSSpeechRecognitionUsageDescription</key><string>WodeAppX 使用设备端语音识别，将你的语音转换为输入文字。</string>
</dict>
</plist>
`;
writeFileSync(join(contentsPath, "Info.plist"), infoPlist, "utf8");

const sign = spawnSync("codesign", ["--force", "--deep", "--sign", "-", bundlePath], { stdio: "inherit" });
if (sign.status !== 0) process.exit(sign.status ?? 1);

const destinations = [
  join(root, "vendor", "openwork", "apps", "desktop", "resources", "helpers", helperName),
  join(root, "apps", "desktop", "resources", "helpers", helperName),
];
for (const destination of destinations) {
  mkdirSync(dirname(destination), { recursive: true });
  rmSync(destination, { recursive: true, force: true });
  cpSync(bundlePath, destination, { recursive: true });
}

process.stdout.write(`${JSON.stringify({ ok: true, bundlePath, destinations, arch: "universal" }, null, 2)}\n`);
