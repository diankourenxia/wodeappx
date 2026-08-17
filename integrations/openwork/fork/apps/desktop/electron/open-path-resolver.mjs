import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SKIPPED_DIRECTORY_NAMES = new Set([
  ".git",
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "node_modules",
]);

export function expandUserPath(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return "";
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  // Reject URL schemes other than file: — including workspace-joined garbage
  // like /Users/.../projects/supor/optimistic://attachment/foo.mp4.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^file:/i.test(trimmed)) {
    return "";
  }
  if (/[/\\][a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return "";
  }
  return trimmed;
}

const GENERIC_OPEN_BASENAME_RE = /^(image|img|photo|screenshot|untitled|picture|paste)(\.(png|jpe?g|gif|webp|heic|bmp))?$/i;

function isGenericOpenBasename(fileName) {
  return GENERIC_OPEN_BASENAME_RE.test(String(fileName || "").trim());
}

function attachmentContextPacksRoot() {
  const override = String(process.env.WODEAPPX_ATTACHMENT_CONTEXT_ROOT ?? "").trim();
  return override ? path.resolve(override) : path.join(os.homedir(), ".wodeappx", "attachment-context-packs");
}

function fileNameMatchesPackEntry(fileName, entryName) {
  if (!fileName || !entryName) return false;
  if (entryName === fileName) return true;
  // Context pack stores indexed copies: 01-paste-….png
  if (entryName.endsWith(`-${fileName}`)) return true;
  if (/^\d{2}-/.test(entryName) && entryName.slice(3) === fileName) return true;
  return false;
}

/** Prefer newest durable chat attachment over ~/Downloads/image.png collisions. */
export async function resolveFromAttachmentContextPacks(fileName) {
  const name = path.basename(String(fileName || "").trim());
  if (!name || name === "." || name === path.parse(name).root) return null;
  const root = attachmentContextPacksRoot();
  if (!existsSync(root)) return null;

  const matches = [];
  let packs;
  try {
    packs = await readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }

  for (const pack of packs) {
    if (!pack.isDirectory()) continue;
    const packDir = path.join(root, pack.name);
    let entries;
    try {
      entries = await readdir(packDir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !fileNameMatchesPackEntry(name, entry.name)) continue;
      const entryPath = path.join(packDir, entry.name);
      try {
        const info = await stat(entryPath);
        matches.push({ path: entryPath, updatedAt: info.mtimeMs });
      } catch {
        // Pack entry may have been deleted mid-scan.
      }
    }
  }

  matches.sort((left, right) => right.updatedAt - left.updatedAt);
  return matches[0]?.path ?? null;
}

export async function resolveMissingOpenPath(
  target,
  { searchRoots = [], maxDepth = 6, maxEntries = 10_000 } = {},
) {
  const requested = expandUserPath(target);
  if (!requested) return null;
  if (existsSync(requested)) return requested;

  const fileName = path.basename(requested);
  if (!fileName || fileName === "." || fileName === path.parse(fileName).root) return null;

  // Chat pastes land under ~/.wodeappx/attachment-context-packs as 01-<name>.
  // Always try that first so paste-* / image.png open the real attachment.
  const packed = await resolveFromAttachmentContextPacks(fileName);
  if (packed) return packed;

  // Clipboard pastes used to be named image.png — never guess ~/Downloads/image.png.
  if (isGenericOpenBasename(fileName)) return null;

  const roots = [...new Set(searchRoots.map((root) => String(root ?? "").trim()).filter(Boolean))];

  // Fast path: common download/desktop/workspace root + exact basename.
  for (const root of roots) {
    const direct = path.join(root, fileName);
    if (existsSync(direct)) return direct;
  }

  const matches = [];
  let visitedEntries = 0;

  for (const root of roots) {
    if (!existsSync(root) || visitedEntries >= maxEntries) continue;
    const queue = [{ directory: root, depth: 0 }];

    while (queue.length && visitedEntries < maxEntries) {
      const current = queue.shift();
      let entries;
      try {
        entries = await readdir(current.directory, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        visitedEntries += 1;
        if (visitedEntries > maxEntries) break;
        const entryPath = path.join(current.directory, entry.name);
        if (entry.isFile() && entry.name === fileName) {
          try {
            const info = await stat(entryPath);
            matches.push({ path: entryPath, updatedAt: info.mtimeMs });
          } catch {
            // The file may have disappeared while temporary outputs were scanned.
          }
          continue;
        }
        if (
          entry.isDirectory()
          && current.depth < maxDepth
          && !SKIPPED_DIRECTORY_NAMES.has(entry.name)
        ) {
          queue.push({ directory: entryPath, depth: current.depth + 1 });
        }
      }
    }
  }

  matches.sort((left, right) => right.updatedAt - left.updatedAt);
  return matches[0]?.path ?? null;
}
