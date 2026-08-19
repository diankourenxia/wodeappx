/** ~/.wodeapp/skin.json for desktop boot + storeWodeAppSkin dual-write. Schema {"id"} only. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function wodeAppSkinFilePath(home = os.homedir()) {
  return path.join(home, ".wodeapp", "skin.json");
}

export function parseWodeAppSkinFileText(text) {
  try {
    const parsed = JSON.parse(String(text ?? ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const keys = Object.keys(parsed);
    if (keys.length !== 1 || keys[0] !== "id") return null;
    const id = String(parsed.id || "").trim();
    return id || null;
  } catch {
    return null;
  }
}

export function readWodeAppSkinFileId(home = os.homedir()) {
  try {
    return parseWodeAppSkinFileText(readFileSync(wodeAppSkinFilePath(home), "utf8"));
  } catch {
    return null;
  }
}

export function writeWodeAppSkinFileId(id, home = os.homedir()) {
  const next = String(id || "").trim();
  if (!next) return { ok: false, error: "missing id" };
  const file = wodeAppSkinFilePath(home);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ id: next })}\n`);
  return { ok: true, id: next, path: file };
}
