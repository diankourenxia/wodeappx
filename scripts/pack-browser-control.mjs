#!/usr/bin/env node

import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const source = path.join(root, "integrations/browser-control/extension");

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  }
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function header(size) {
  return Buffer.alloc(size);
}

async function runtimeFiles(directory, relative = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (["STORE_LISTING.md", "store-assets", "store-screenshots"].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    const name = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await runtimeFiles(absolute, name));
    else if (entry.isFile()) files.push({ absolute, name });
  }
  return files;
}

export async function buildExtensionArchive(outputPath) {
  const manifest = JSON.parse(await readFile(path.join(source, "manifest.json"), "utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version || "")) {
    throw new Error("Chrome extension manifest must contain a three-part numeric version");
  }
  const output = outputPath || path.join(root, `dist/wodeappx-browser-control-${manifest.version}.zip`);
  const files = (await runtimeFiles(source)).sort((a, b) => a.name.localeCompare(b.name, "en"));
  const required = ["manifest.json", "background.js", "popup.html", "popup.js", "sidepanel.html", "sidepanel.js"];
  for (const name of required) {
    if (!files.some((file) => file.name === name)) throw new Error(`Missing extension runtime file: ${name}`);
  }

  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = await readFile(file.absolute);
    const crc = crc32(data);
    const local = header(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = header(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x0021, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = header(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, Buffer.concat([...localParts, centralDirectory, end]));
  console.log(`[browser-control] packed ${files.length} runtime files: ${output}`);
  return { output, files: files.map((file) => file.name), version: manifest.version };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await buildExtensionArchive();
}
