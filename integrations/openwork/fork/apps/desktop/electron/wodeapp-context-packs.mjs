import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const CONTEXT_REF_RE = /^[a-zA-Z0-9_-]{16,128}$/;
const MAX_CONTEXT_CHARS = 2_000_000;
// Chat attachments are not capped by the product-library 12-image rule.
// Keep a generous file count so vision-direct uploads still land as real paths.
const MAX_FILES = 64;
// Align with chat remote attachment ceiling so typical PDFs/office packs still get a durable local path.
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TOTAL_FILE_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_STORE_BYTES = 512 * 1024 * 1024;

function positiveIntegerEnv(name, fallback) {
  const parsed = Number.parseInt(String(process.env[name] ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function contextPackRoot() {
  const override = String(process.env.WODEAPPX_ATTACHMENT_CONTEXT_ROOT ?? "").trim();
  return override
    ? path.resolve(override)
    : path.join(homedir(), ".wodeappx", "attachment-context-packs");
}

function maxStoreBytes() {
  return positiveIntegerEnv("WODEAPPX_ATTACHMENT_CONTEXT_MAX_BYTES", DEFAULT_MAX_STORE_BYTES);
}

function safeContextRefId(value) {
  const refId = String(value ?? "").trim();
  if (!CONTEXT_REF_RE.test(refId)) {
    throw new Error("Invalid attachment context reference.");
  }
  return refId;
}

function safeFilename(value, index) {
  const raw = String(value ?? "").trim() || `attachment-${index + 1}`;
  const basename = path.basename(raw).replace(/[^a-zA-Z0-9._-]+/g, "-");
  return basename.slice(0, 160) || `attachment-${index + 1}`;
}

function originalFilename(value, index) {
  const fallback = `attachment-${index + 1}`;
  const raw = String(value ?? "").trim() || fallback;
  const basename = path.basename(raw).replace(/[\u0000-\u001f\u007f]+/g, "-").trim();
  return basename.slice(0, 500) || fallback;
}

function normalizedString(value, maxChars = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxChars) : "";
}

function normalizedRecords(value, limit = 100) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    return Object.fromEntries(
      Object.entries(item)
        .filter(([, entry]) => typeof entry === "string")
        .map(([key, entry]) => [key.slice(0, 80), normalizedString(entry, 4_000)]),
    );
  }).filter(Boolean);
}

function decodeDataUrl(value) {
  // Accept optional parameters such as charset before `;base64,`.
  // FileReader / Blob data URLs sometimes look like:
  //   data:image/jpeg;charset=utf-8;base64,....
  // The old regex only allowed `data:<mime>;base64,...` and rejected those.
  const raw = String(value ?? "").trim();
  const comma = raw.indexOf(",");
  if (!raw.toLowerCase().startsWith("data:") || comma < 0) {
    throw new Error("Attachment context file must be a base64 data URL.");
  }
  const meta = raw.slice("data:".length, comma);
  const payload = raw.slice(comma + 1);
  const parts = meta.split(";").map((part) => part.trim()).filter(Boolean);
  if (!parts.length || !parts.some((part) => part.toLowerCase() === "base64")) {
    throw new Error("Attachment context file must be a base64 data URL.");
  }
  const mime = (parts[0] || "application/octet-stream").toLowerCase();
  const bytes = Buffer.from(payload.replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > MAX_FILE_BYTES) {
    throw new Error("Attachment context file is empty or exceeds the local cache limit.");
  }
  return { mime, bytes };
}

async function directoryBytes(directory) {
  let total = 0;
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      total += await directoryBytes(entryPath);
    } else if (entry.isFile()) {
      total += (await stat(entryPath).catch(() => null))?.size ?? 0;
    }
  }
  return total;
}

async function listContextPacks() {
  const root = contextPackRoot();
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const packs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const packDir = path.join(root, entry.name);
    const bytes = await directoryBytes(packDir);
    let sessionId = "";
    try {
      const manifest = JSON.parse(await readFile(path.join(packDir, "manifest.json"), "utf8"));
      if (manifest?.refId === entry.name && CONTEXT_REF_RE.test(entry.name)) {
        sessionId = normalizedString(manifest.sessionId, 240);
      }
    } catch {
      // Incomplete directories still count toward the hard capacity limit.
    }
    packs.push({
      refId: entry.name,
      sessionId,
      bytes,
    });
  }
  return packs;
}

function buildStatus(packs) {
  const totalBytes = packs.reduce((sum, pack) => sum + pack.bytes, 0);
  const capacity = maxStoreBytes();
  return {
    ok: true,
    packs: packs.length,
    totalBytes,
    maxStoreBytes: capacity,
    remainingBytes: Math.max(0, capacity - totalBytes),
  };
}

export async function getWodeAppContextPackStatus() {
  return buildStatus(await listContextPacks());
}

export async function deleteWodeAppContextPacksForSession(sessionIdInput) {
  const sessionId = normalizedString(sessionIdInput, 240);
  const packs = await listContextPacks();
  if (!sessionId) {
    return {
      ...buildStatus(packs),
      deletedPacks: 0,
      freedBytes: 0,
    };
  }

  const matches = packs.filter((pack) => pack.sessionId === sessionId);
  await Promise.all(
    matches.map((pack) => rm(path.join(contextPackRoot(), pack.refId), {
      recursive: true,
      force: true,
    })),
  );
  const remaining = packs.filter((pack) => pack.sessionId !== sessionId);
  return {
    ...buildStatus(remaining),
    deletedPacks: matches.length,
    freedBytes: matches.reduce((sum, pack) => sum + pack.bytes, 0),
  };
}

export async function clearWodeAppContextPacks() {
  const packs = await listContextPacks();
  await rm(contextPackRoot(), { recursive: true, force: true });
  return {
    ...buildStatus([]),
    deletedPacks: packs.length,
    freedBytes: packs.reduce((sum, pack) => sum + pack.bytes, 0),
  };
}

export async function putWodeAppContextPack(input = {}) {
  const refId = safeContextRefId(input.refId);
  const context = normalizedString(input.context, MAX_CONTEXT_CHARS);
  const rawFiles = Array.isArray(input.files) ? input.files.slice(0, MAX_FILES) : [];
  if (!context && !rawFiles.length) {
    throw new Error("Attachment context pack requires text or files.");
  }

  let totalFileBytes = 0;
  const preparedFiles = rawFiles.map((item, index) => {
    const decoded = decodeDataUrl(item?.dataUrl);
    const displayFilename = originalFilename(item?.filename, index);
    totalFileBytes += decoded.bytes.length;
    if (totalFileBytes > MAX_TOTAL_FILE_BYTES) {
      throw new Error("Attachment context files exceed the local cache total limit.");
    }
    return {
      originalFilename: displayFilename,
      filename: safeFilename(displayFilename, index),
      mime: normalizedString(item?.mime, 200) || decoded.mime,
      bytes: decoded.bytes,
    };
  });

  const root = contextPackRoot();
  const packDir = path.join(root, refId);
  const storedFiles = preparedFiles.map((item, index) => ({
    originalFilename: item.originalFilename,
    filename: item.filename,
    mime: item.mime,
    path: path.join(packDir, `${String(index + 1).padStart(2, "0")}-${item.filename}`),
    sizeBytes: item.bytes.length,
  }));
  const manifest = {
    version: 2,
    refId,
    contextPackId: normalizedString(input.contextPackId, 240),
    sessionId: normalizedString(input.sessionId, 240),
    createdAt: new Date().toISOString(),
    context,
    sources: normalizedRecords(input.sources),
    uploadedUrls: normalizedRecords(input.uploadedUrls),
    files: storedFiles,
    storedBytes: 0,
  };
  for (let iteration = 0; iteration < 3; iteration += 1) {
    manifest.storedBytes = totalFileBytes + Buffer.byteLength(JSON.stringify(manifest), "utf8");
  }

  const packs = await listContextPacks();
  const existingBytes = packs.find((pack) => pack.refId === refId)?.bytes ?? 0;
  const statusBefore = buildStatus(packs);
  if (statusBefore.totalBytes - existingBytes + manifest.storedBytes > statusBefore.maxStoreBytes) {
    throw new Error(
      `Attachment context storage is full (${statusBefore.totalBytes}/${statusBefore.maxStoreBytes} bytes).`,
    );
  }

  await mkdir(root, { recursive: true, mode: 0o700 });
  const stagingDir = path.join(root, `.pending-${refId}-${process.pid}-${Date.now()}`);
  const backupDir = path.join(root, `.backup-${refId}-${process.pid}-${Date.now()}`);
  await mkdir(stagingDir, { recursive: true, mode: 0o700 });

  let movedExisting = false;
  try {
    for (let index = 0; index < preparedFiles.length; index += 1) {
      const item = preparedFiles[index];
      const filename = `${String(index + 1).padStart(2, "0")}-${item.filename}`;
      await writeFile(path.join(stagingDir, filename), item.bytes, { mode: 0o600 });
    }
    await writeFile(
      path.join(stagingDir, "manifest.json"),
      JSON.stringify(manifest),
      { encoding: "utf8", mode: 0o600 },
    );

    try {
      await rename(packDir, backupDir);
      movedExisting = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await rename(stagingDir, packDir);
    if (movedExisting) {
      await rm(backupDir, { recursive: true, force: true });
    }

    const writtenBytes = await directoryBytes(packDir);
    return {
      ok: true,
      refId,
      contextChars: context.length,
      files: storedFiles,
      storedBytes: writtenBytes,
      storeBytes: statusBefore.totalBytes - existingBytes + writtenBytes,
      maxStoreBytes: statusBefore.maxStoreBytes,
    };
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    if (movedExisting) {
      await rm(packDir, { recursive: true, force: true }).catch(() => undefined);
      await rename(backupDir, packDir).catch(() => undefined);
    }
    throw error;
  } finally {
    await rm(backupDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
