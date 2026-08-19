#!/usr/bin/env node
/**
 * Bump only wodeappx/package.json. Desktop/app versions are synced by openwork:patch.
 * Same shape as OpenWork: patch | minor | major | --set X.Y.Z
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = path.join(root, "package.json");

function parseSemver(value) {
  const match = String(value ?? "").trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`not a stable semver: ${value}`);
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function format(parts) {
  return `${parts.major}.${parts.minor}.${parts.patch}`;
}

const args = process.argv.slice(2);
const raw = await readFile(pkgPath, "utf8");
const pkg = JSON.parse(raw);
const current = parseSemver(pkg.version);

let next;
if (args[0] === "--set") {
  next = parseSemver(args[1]);
} else if (args[0] === "patch") {
  next = { ...current, patch: current.patch + 1 };
} else if (args[0] === "minor") {
  next = { major: current.major, minor: current.minor + 1, patch: 0 };
} else if (args[0] === "major") {
  next = { major: current.major + 1, minor: 0, patch: 0 };
} else {
  throw new Error("usage: node scripts/bump-version.mjs patch|minor|major|--set X.Y.Z");
}

const nextVersion = format(next);
const updated = raw.replace(
  /^(\s*"version":\s*")\d+\.\d+\.\d+(")/m,
  `$1${nextVersion}$2`,
);
if (updated === raw) throw new Error(`failed to rewrite version in ${pkgPath}`);
await writeFile(pkgPath, updated);
console.log(`${format(current)} -> ${nextVersion}`);
