/** ~/.wodeapp/skin.json SSOT. Schema {"id":"..."} only. Does not read models or key files. No CSS. */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

export const DEFAULT_SKIN_ID = "red-compact";
export const SKIN_RELATIVE_PATH = ".wodeapp/skin.json";
export const PLAZA_SKIN_RE = /^plaza-[a-z][a-z0-9-]{0,54}$/;

const catalogUrl = resolve(dirname(fileURLToPath(import.meta.url)), "skin-catalog.json");

export function loadSkinCatalog(source) {
  const parsed = typeof source === "string" ? JSON.parse(source) : source;
  const skins = Array.isArray(parsed?.skins) ? parsed.skins : [];
  return skins.map((item) => ({
    id: String(item.id),
    label: String(item.label ?? item.id),
    hidden: item.hidden === true,
  }));
}

export function readPackedSkinCatalog() {
  return loadSkinCatalog(readFileSync(catalogUrl, "utf8"));
}

export function visibleSkinCatalog(skins = readPackedSkinCatalog()) {
  return skins.filter((item) => !item.hidden);
}

export function isPlazaSkinId(value) {
  return PLAZA_SKIN_RE.test(String(value || ""));
}

export function isKnownSkinId(value, skins = readPackedSkinCatalog()) {
  const id = String(value || "");
  return skins.some((item) => item.id === id) || isPlazaSkinId(id);
}

export function isHiddenFromPicker(value, skins = readPackedSkinCatalog()) {
  return skins.some((item) => item.id === value && item.hidden === true);
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

export function resolveWodeAppSkinId(input = {}, skins = readPackedSkinCatalog()) {
  if (isKnownSkinId(input.fileId, skins)) return input.fileId;
  if (isKnownSkinId(input.cacheId, skins)) return input.cacheId;
  return DEFAULT_SKIN_ID;
}

export function skinFilePath(home = os.homedir()) {
  return resolve(home, SKIN_RELATIVE_PATH);
}

export function readSkinFileId(io = {}) {
  const file = io.path || skinFilePath(io.home);
  try {
    const text = typeof io.readFile === "function" ? io.readFile(file) : readFileSync(file, "utf8");
    const id = parseWodeAppSkinFileText(text);
    return isKnownSkinId(id, io.skins || readPackedSkinCatalog()) ? id : null;
  } catch {
    return null;
  }
}

export function writeSkinFileId(id, io = {}) {
  const skins = io.skins || readPackedSkinCatalog();
  const next = isKnownSkinId(id, skins) ? id : DEFAULT_SKIN_ID;
  const file = io.path || skinFilePath(io.home);
  const body = `${JSON.stringify({ id: next })}\n`;
  mkdirSync(dirname(file), { recursive: true });
  if (typeof io.writeFile === "function") {
    io.writeFile(file, body);
  } else {
    writeFileSync(file, body);
  }
  return { ok: true, id: next, path: file };
}

export function labelForSkin(id, skins = readPackedSkinCatalog()) {
  return skins.find((item) => item.id === id)?.label || id;
}

export function listSkins(io = {}) {
  const skins = io.skins || readPackedSkinCatalog();
  const visible = visibleSkinCatalog(skins);
  const current = resolveWodeAppSkinId({ fileId: readSkinFileId({ ...io, skins }), cacheId: io.cacheId }, skins);
  return {
    ok: true,
    current,
    skins: visible.map((item) => ({ id: item.id, label: item.label })),
    source: io.desktopUp === true ? "ssot" : "file",
  };
}

export function getSkin(io = {}) {
  const skins = io.skins || readPackedSkinCatalog();
  const id = resolveWodeAppSkinId({ fileId: readSkinFileId({ ...io, skins }), cacheId: io.cacheId }, skins);
  return { ok: true, id, label: labelForSkin(id, skins) };
}

export function setSkin(input = {}, io = {}) {
  if (input.userConfirmed !== true) {
    return { ok: false, error: "set requires userConfirmed", wrote: false };
  }
  const skins = io.skins || readPackedSkinCatalog();
  const requested = String(input.id || "").trim();
  const next = isKnownSkinId(requested, skins) ? requested : DEFAULT_SKIN_ID;
  const current = readSkinFileId({ ...io, skins });
  if (isHiddenFromPicker(next, skins) && current !== next) {
    return { ok: false, error: "hidden skin is not in the picker", wrote: false, id: current || DEFAULT_SKIN_ID };
  }
  const written = writeSkinFileId(next, { ...io, skins });
  const desktopUp = io.desktopUp === true;
  return {
    ok: true,
    id: written.id,
    wrote: true,
    applied: desktopUp ? "ssot" : "file",
    note: desktopUp
      ? "已写入 ~/.wodeapp/skin.json。桌面下次启动后按文件生效。"
      : "桌面未在线，已写入 ~/.wodeapp/skin.json，下次桌面启动后可见。",
    path: written.path,
  };
}
