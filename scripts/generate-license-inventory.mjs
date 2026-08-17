#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const vendor = path.join(root, "vendor/openwork");
const opencode = path.join(vendor, ".opencode");
const output = path.join(root, "release/third-party-licenses.json");
const packagedOutput = path.join(vendor, "apps/desktop/resources/licenses/third-party-licenses.json");

/** Packages that declare no SPDX string in the installed manifest. */
const LICENSE_OVERRIDES = {
  "khroma@2.1.0": "MIT",
};

function resolvePackageManager(command) {
  if (process.platform !== "win32") return command;
  if (command === "pnpm" || command === "npm" || command === "npx") return `${command}.cmd`;
  return command;
}

function run(command, args, cwd) {
  const file = resolvePackageManager(command);
  // Windows CreateProcess cannot launch .cmd/.bat without a shell (ENOENT/EINVAL).
  const useShell = process.platform === "win32" && (
    /\.(cmd|bat)$/i.test(file) || file === "pnpm" || file === "npm" || file === "npx"
  );
  const result = spawnSync(file, args, { cwd, encoding: "utf8", shell: useShell, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = `${result.stderr || ""}\n${result.stdout || ""}`.trim();
    throw new Error(`${file} ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout.trim();
}

async function reuseExistingInventory(reason) {
  try {
    const raw = await readFile(packagedOutput, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed.unknownCount !== 0 || !Array.isArray(parsed.packages) || parsed.packages.length < 1) {
      return false;
    }
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, raw);
    const notice = path.join(root, "THIRD_PARTY_LICENSES/OpenWork-LICENSE.txt");
    const packagedNotice = path.join(path.dirname(packagedOutput), "OpenWork-LICENSE.txt");
    await writeFile(packagedNotice, await readFile(notice));
    console.warn(`[licenses] ${reason}; reused ${parsed.packageCount} packages from ${packagedOutput}`);
    return true;
  } catch {
    return false;
  }
}

const packages = [];
let pnpmLicenses;
try {
  const pnpmOutput = run("pnpm", ["licenses", "list", "--prod", "--json"], vendor);
  pnpmLicenses = JSON.parse(pnpmOutput);
} catch (error) {
  if (await reuseExistingInventory(error instanceof Error ? error.message : String(error))) {
    process.exit(0);
  }
  throw error;
}
for (const [license, entries] of Object.entries(pnpmLicenses)) {
  for (const entry of entries) {
    for (const version of entry.versions || []) {
      packages.push({
        name: entry.name,
        version,
        license,
        ...(entry.homepage ? { homepage: entry.homepage } : {}),
        source: "openwork-pnpm",
      });
    }
  }
}

const npmEntries = JSON.parse(run("npm", ["query", "*", "--json"], opencode));
for (const entry of npmEntries) {
  if (!entry.location || !entry.path) continue;
  const manifest = JSON.parse(await readFile(path.join(entry.path, "package.json"), "utf8"));
  if (!manifest.name || !manifest.version) continue;
  const declaredLicense = typeof manifest.license === "string"
    ? manifest.license
    : manifest.license?.type;
  packages.push({
    name: manifest.name,
    version: manifest.version,
    license: declaredLicense || "UNKNOWN",
    ...(manifest.homepage ? { homepage: manifest.homepage } : {}),
    source: "opencode-npm",
  });
}

const unique = [...new Map(packages.map((entry) => [`${entry.name}@${entry.version}`, entry])).values()]
  .map((entry) => {
    const override = LICENSE_OVERRIDES[`${entry.name}@${entry.version}`];
    if (!override) return entry;
    return {
      ...entry,
      license: override,
      licenseSource: "override",
    };
  })
  .sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`, "en"));

const unknown = unique.filter((entry) => !entry.license || entry.license === "UNKNOWN" || entry.license === "Unknown");
if (unknown.length) {
  throw new Error(`unknown licenses: ${unknown.map((entry) => `${entry.name}@${entry.version}`).join(", ")}`);
}

const payload = `${JSON.stringify({
  schemaVersion: 1,
  generatedBy: "pnpm licenses + npm query",
  packageCount: unique.length,
  unknownCount: 0,
  packages: unique,
}, null, 2)}\n`;

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, payload);
await mkdir(path.dirname(packagedOutput), { recursive: true });
await writeFile(packagedOutput, payload);
const notice = path.join(root, "THIRD_PARTY_LICENSES/OpenWork-LICENSE.txt");
const packagedNotice = path.join(path.dirname(packagedOutput), "OpenWork-LICENSE.txt");
await writeFile(packagedNotice, await readFile(notice));
console.log(`[licenses] wrote ${unique.length} production packages to ${output} and ${packagedOutput}`);
