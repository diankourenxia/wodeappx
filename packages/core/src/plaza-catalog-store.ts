import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getConfigDir } from "./config-store.js";

export const BRAND_AGENTS_FILE_NAME = "brand-agents.json";
export const PLAZA_CATALOG_DIR_NAME = "plaza";
export const PLAZA_CATALOG_FILE_NAME = "catalog.json";

export type PlazaCatalogFile = {
  version: 1;
  items: unknown[];
};

export type BrandAgentsFile = {
  version: 1;
  agents: unknown[];
};

export function getBrandAgentsPath(): string {
  return join(getConfigDir(), BRAND_AGENTS_FILE_NAME);
}

export function getPlazaCatalogPath(): string {
  return join(getConfigDir(), PLAZA_CATALOG_DIR_NAME, PLAZA_CATALOG_FILE_NAME);
}

async function writePrivateJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(filePath, 0o600);
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

export async function loadPlazaCatalogFile(): Promise<{ exists: boolean; file: PlazaCatalogFile }> {
  try {
    const raw = JSON.parse(await readFile(getPlazaCatalogPath(), "utf8")) as unknown;
    const items = Array.isArray(raw)
      ? raw
      : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items)
        ? (raw as { items: unknown[] }).items
        : [];
    return { exists: true, file: { version: 1, items } };
  } catch (error) {
    if (isEnoent(error)) return { exists: false, file: { version: 1, items: [] } };
    throw error;
  }
}

export async function savePlazaCatalogFile(items: unknown[]): Promise<PlazaCatalogFile> {
  const file: PlazaCatalogFile = { version: 1, items };
  await writePrivateJson(getPlazaCatalogPath(), file);
  return file;
}

export async function loadBrandAgentsFile(): Promise<{ exists: boolean; file: BrandAgentsFile }> {
  try {
    const raw = JSON.parse(await readFile(getBrandAgentsPath(), "utf8")) as unknown;
    const agents =
      raw && typeof raw === "object" && Array.isArray((raw as { agents?: unknown }).agents)
        ? (raw as { agents: unknown[] }).agents
        : [];
    return { exists: true, file: { version: 1, agents } };
  } catch (error) {
    if (isEnoent(error)) return { exists: false, file: { version: 1, agents: [] } };
    throw error;
  }
}

export async function saveBrandAgentsFile(agents: unknown[]): Promise<BrandAgentsFile> {
  const file: BrandAgentsFile = { version: 1, agents };
  await writePrivateJson(getBrandAgentsPath(), file);
  return file;
}
