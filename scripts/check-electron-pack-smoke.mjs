#!/usr/bin/env node
/**
 * Cheap Electron packaging smoke checks:
 * 1. After openwork:patch — walk relative imports from packaged entrypoints.
 * 2. Optional — after electron-builder --dir / --win, verify app.asar contents
 *    without installing the NSIS/DMG.
 *
 * Usage:
 *   node scripts/check-electron-pack-smoke.mjs
 *   node scripts/check-electron-pack-smoke.mjs --asar path/to/app.asar
 *   node scripts/check-electron-pack-smoke.mjs --unpacked path/to/win-unpacked
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const electronDir = path.join(root, "vendor/openwork/apps/desktop/electron");

const args = process.argv.slice(2);
function argValue(flag) {
  const index = args.indexOf(flag);
  if (index < 0) return null;
  return args[index + 1] || null;
}

function fail(message) {
  console.error(`Electron pack smoke failed: ${message}`);
  process.exit(1);
}

function resolveImport(fromFile, spec) {
  if (!spec.startsWith(".")) return null;
  const base = path.dirname(fromFile);
  const candidates = [
    path.resolve(base, spec),
    path.resolve(base, `${spec}.mjs`),
    path.resolve(base, `${spec}.js`),
    path.resolve(base, `${spec}.cjs`),
    path.resolve(base, `${spec}.json`),
    path.resolve(base, spec, "index.mjs"),
    path.resolve(base, spec, "index.js"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function collectRelativeImports(filePath, text) {
  const found = [];
  const re = /(?:from\s+|import\(\s*|require\(\s*)["'](\.[^"']+)["']/g;
  let match;
  while ((match = re.exec(text))) found.push(match[1]);
  return found;
}

function walkImportGraph(entryRelativePaths) {
  const queue = entryRelativePaths.map((rel) => path.join(electronDir, rel));
  const seen = new Set();
  const missing = [];

  while (queue.length) {
    const filePath = queue.shift();
    if (!filePath || seen.has(filePath)) continue;
    seen.add(filePath);
    if (!existsSync(filePath)) {
      missing.push(path.relative(root, filePath));
      continue;
    }
    if (!/\.(mjs|cjs|js)$/.test(filePath)) continue;
    const text = readFileSync(filePath, "utf8");
    for (const spec of collectRelativeImports(filePath, text)) {
      const resolved = resolveImport(filePath, spec);
      if (!resolved) {
        missing.push(`${path.relative(root, filePath)} -> ${spec}`);
        continue;
      }
      queue.push(resolved);
    }
  }

  return { files: [...seen], missing };
}

function assertVendorGraph() {
  if (!existsSync(electronDir)) fail("vendor electron directory missing; run pnpm openwork:patch");

  const required = [
    "main.mjs",
    "browser-native-host.mjs",
    "preload.mjs",
    "local-tts-worker.mjs",
    "wodeapp-cloud/wodeapp-auth-ipc.mjs",
    "wodeapp-cloud/wodeapp-node-request.mjs",
    "wodeapp-model-catalog.json",
  ];
  for (const rel of required) {
    if (!existsSync(path.join(electronDir, rel))) fail(`missing required file electron/${rel}`);
  }

  const preload = readFileSync(path.join(electronDir, "preload.mjs"), "utf8");
  if (!preload.includes("wodeappAuth") || !preload.includes("wodeapp:auth")) {
    fail("preload.mjs is missing wodeappAuth bridge; account login will not work");
  }

  const main = readFileSync(path.join(electronDir, "main.mjs"), "utf8");
  if (!main.includes("applySelfEvolveRendererOverlay") || !main.includes("self-evolve-overlay")) {
    fail("main.mjs is missing self-evolve overlay loader; packaged skin edits will not apply");
  }

  const builderPath = path.join(root, "vendor/openwork/apps/desktop/electron-builder.yml");
  const builder = readFileSync(builderPath, "utf8");
  for (const entry of [
    "electron/local-tts-worker.mjs",
    "electron/wodeapp-cloud/wodeapp-node-request.mjs",
    "from: resources/native-hosts",
    "wodeappx-browser-native-host*",
    "from: server/dist/opencode-plugins",
    "wodeappx-scheduler-supervisor.js",
    "to: licenses",
  ]) {
    if (!builder.includes(entry)) fail(`electron-builder.yml missing ${entry}`);
  }

  const { missing } = walkImportGraph([
    "main.mjs",
    "browser-native-host.mjs",
    "preload.mjs",
    "local-tts-worker.mjs",
    "wodeapp-cloud/wodeapp-node-request.mjs",
    "browser-content-preload.cjs",
  ]);
  if (missing.length) {
    fail(`unresolved electron imports:\n  - ${missing.join("\n  - ")}`);
  }
}

function findAsarFromUnpacked(unpackedDir) {
  const resources = path.join(unpackedDir, "resources");
  const direct = path.join(resources, "app.asar");
  if (existsSync(direct)) return direct;
  fail(`app.asar not found under ${unpackedDir}`);
}

function loadElectronAsar() {
  const candidates = [
    path.join(root, "vendor/openwork/apps/desktop/package.json"),
    path.join(root, "vendor/openwork/package.json"),
    path.join(root, "vendor/openwork/node_modules/electron-builder/package.json"),
  ];
  const errors = [];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      return createRequire(candidate)("@electron/asar");
    } catch (error) {
      errors.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // Last resort: direct pnpm store path under vendor.
  try {
    return createRequire(path.join(root, "vendor/openwork/node_modules/.pnpm/electron-builder@25.1.8/node_modules/electron-builder/package.json"))("@electron/asar");
  } catch (error) {
    errors.push(`pnpm electron-builder: ${error instanceof Error ? error.message : String(error)}`);
  }
  fail(`unable to load @electron/asar from vendor OpenWork deps:\n  - ${errors.join("\n  - ")}`);
}

function listAsar(asarPath) {
  const asar = loadElectronAsar();
  if (typeof asar.listPackage !== "function") {
    fail("@electron/asar loaded but listPackage() is unavailable");
  }
  return asar.listPackage(asarPath);
}

function assertAsarContents(asarPath) {
  if (!existsSync(asarPath)) fail(`asar not found: ${asarPath}`);
  const listing = listAsar(asarPath).map((entry) => entry.replace(/\\/g, "/"));
  const required = [
    "electron/main.mjs",
    "electron/preload.mjs",
    "electron/local-tts-worker.mjs",
    "electron/wodeapp-cloud/wodeapp-auth-ipc.mjs",
    "electron/wodeapp-cloud/wodeapp-local-assets-ipc.mjs",
    "electron/wodeapp-cloud/wodeapp-node-request.mjs",
    "electron/wodeapp-cloud/wodeapp-provider.mjs",
    "electron/wodeapp-cloud/config-store.mjs",
    "electron/wodeapp-model-catalog.json",
    "server/dist/opencode-plugins/wodeappx-scheduler-supervisor.js",
  ];
  const missing = required.filter((entry) => !listing.some((item) => item === entry || item.endsWith(`/${entry}`)));
  if (missing.length) {
    fail(`app.asar missing required entries:\n  - ${missing.join("\n  - ")}`);
  }

  const unpackedRoot = path.join(path.dirname(asarPath), "app.asar.unpacked");
  const unpackedRequired = [
    path.join(unpackedRoot, "electron/local-tts-worker.mjs"),
    path.join(unpackedRoot, "electron/wodeapp-cloud/wodeapp-node-request.mjs"),
  ];
  const missingUnpacked = unpackedRequired.filter((filePath) => !existsSync(filePath));
  if (missingUnpacked.length) {
    fail(
      `app.asar.unpacked missing worker scripts (spawn/fork will fail on Windows):\n  - ${missingUnpacked.map((p) => path.relative(root, p)).join("\n  - ")}`,
    );
  }

  console.log(`asar smoke ok: ${path.relative(process.cwd(), asarPath)} (${listing.length} entries)`);
}

function discoverDefaultUnpacked() {
  const dist = path.join(root, "vendor/openwork/apps/desktop/dist-electron");
  if (!existsSync(dist)) return null;
  const candidates = [
    path.join(dist, "win-unpacked"),
    path.join(dist, "mac"),
    path.join(dist, "mac-arm64"),
    path.join(dist, "mac-x64"),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "resources", "app.asar"))) return candidate;
  }
  // electron-builder sometimes nests productName folders
  for (const name of readdirSync(dist)) {
    const nested = path.join(dist, name);
    if (!statSync(nested).isDirectory()) continue;
    if (existsSync(path.join(nested, "resources", "app.asar"))) return nested;
  }
  return null;
}

assertVendorGraph();

const asarArg = argValue("--asar");
const unpackedArg = argValue("--unpacked");
if (asarArg) {
  assertAsarContents(path.resolve(asarArg));
} else if (unpackedArg) {
  assertAsarContents(findAsarFromUnpacked(path.resolve(unpackedArg)));
} else if (args.includes("--require-asar")) {
  const unpacked = discoverDefaultUnpacked();
  if (!unpacked) fail("no unpacked Electron dir found; package with electron-builder --dir first");
  assertAsarContents(findAsarFromUnpacked(unpacked));
} else {
  const unpacked = discoverDefaultUnpacked();
  if (unpacked) assertAsarContents(findAsarFromUnpacked(unpacked));
}

console.log("Electron pack smoke passed.");
