#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] || "release");
const output = path.resolve(process.argv[3] || path.join(root, "SHA256SUMS.txt"));

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (absolute === output) continue;
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

async function sha256(file) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .once("error", reject)
      .once("end", resolve);
  });
  return hash.digest("hex");
}

if (!(await stat(root)).isDirectory()) throw new Error(`${root} is not a directory`);
const files = (await walk(root)).sort((a, b) => a.localeCompare(b, "en"));
if (files.length === 0) throw new Error(`No release files found in ${root}`);

const lines = [];
for (const file of files) {
  lines.push(`${await sha256(file)}  ${path.relative(root, file).replaceAll(path.sep, "/")}`);
}
await writeFile(output, `${lines.join("\n")}\n`, "utf8");
console.log(`[checksums] wrote ${lines.length} SHA-256 entries to ${output}`);
