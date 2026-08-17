#!/usr/bin/env node

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";

function redactString(value) {
  return String(value)
    .replace(/^(\s*(?:\d+:\s*)?(?:export\s+)?[A-Z0-9_]*(?:API_KEY|ACCESS_KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|DIRECT_URL|PRIVATE_KEY|CLIENT_SECRET|CREDENTIAL)[A-Z0-9_]*\s*=\s*).*$/gim, "$1<redacted>")
    .replace(/((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/]+:)[^@\s/]+@/gi, "$1<redacted>@")
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, "<redacted-jwt>")
    .replace(/\br8_[A-Za-z0-9_-]{20,}\b/g, "r8_<redacted>")
    .replace(/sk_(?:live|test)_[A-Za-z0-9._-]+/g, "sk_<redacted>")
    .replace(/sk-[A-Za-z0-9._-]{10,}/g, "sk-<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer <redacted>")
    .replace(/Basic\s+[A-Za-z0-9+/]+=*/gi, "Basic <redacted>")
    .replace(/((?:api[_-]?key|access[_-]?key|access[_-]?token|refresh[_-]?token|service[_-]?role[_-]?key|client[_-]?secret|private[_-]?key|password|secret|token|credential)[A-Za-z0-9_-]*)(["'=: ]+)[^\s"',}]+/gi, "$1$2<redacted>")
    .replace(/data:image\/[^;]+;base64,[A-Za-z0-9+/=]+/gi, "data:image/<redacted>");
}

function sanitize(value, depth = 0) {
  if (depth > 20) return "<max-depth>";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /(?:password|authorization|apiKey|accessKey|accessToken|refreshToken|ownerToken|clientToken|secret|credential|databaseUrl|directUrl|privateKey)$/i.test(key)
        ? "<redacted>"
        : sanitize(item, depth + 1),
    ]));
  }
  return value;
}

function filesUnder(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(target));
    else if (entry.isFile() && /\.(?:json|jsonl|md)$/i.test(entry.name)) files.push(target);
  }
  return files;
}

function sanitizeFile(file) {
  const raw = readFileSync(file, "utf8");
  let next;
  if (file.endsWith(".json")) {
    next = `${JSON.stringify(sanitize(JSON.parse(raw)), null, 2)}\n`;
  } else if (file.endsWith(".jsonl")) {
    next = raw.split("\n").map((line) => {
      if (!line.trim()) return "";
      return JSON.stringify(sanitize(JSON.parse(line)));
    }).join("\n");
  } else {
    next = redactString(raw);
  }
  if (next !== raw) writeFileSync(file, next, "utf8");
  return next !== raw;
}

const roots = process.argv.slice(2).map((value) => path.resolve(value));
if (!roots.length) {
  process.stderr.write("Usage: node scripts/sanitize-live-agent-evidence.mjs <evidence-dir>...\n");
  process.exit(1);
}
let changed = 0;
let total = 0;
for (const root of roots) {
  for (const file of filesUnder(root)) {
    total += 1;
    if (sanitizeFile(file)) changed += 1;
  }
}
process.stdout.write(`Sanitized ${changed}/${total} evidence files.\n`);
