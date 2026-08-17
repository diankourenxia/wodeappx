#!/usr/bin/env node

import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const testsDir = resolve(root, "integrations/openwork/tests");
const entries = (await readdir(testsDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.test\.(?:mjs|ts|tsx)$/.test(entry.name))
  .map((entry) => resolve(testsDir, entry.name))
  .sort();

if (entries.length === 0) {
  throw new Error(`No OpenWork tests found in ${testsDir}`);
}

let passed = 0;
for (const testFile of entries) {
  const relative = testFile.slice(root.length + 1);
  process.stdout.write(`\n[openwork:test] ${relative}\n`);
  const exitCode = await new Promise((resolveExit, reject) => {
    const child = spawn("bun", ["test", testFile], {
      cwd: root,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${relative} terminated by ${signal}`));
      else resolveExit(code ?? 1);
    });
  });
  if (exitCode !== 0) process.exit(exitCode);
  passed += 1;
}

console.log(`\n[openwork:test] ${passed}/${entries.length} files passed in isolated Bun processes.`);
