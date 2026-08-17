import { homedir } from 'node:os';
import { join } from 'node:path';
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import type { WodeAppConfig } from './config.js';
import { CONFIG_DIR_NAME, CONFIG_FILE_NAME, normalizeWodeAppCloudConfig } from './config.js';

export function getConfigDir(): string {
  const override = String(process.env.WODEAPP_CONFIG_DIR || "").trim();
  if (override) return override;
  return join(homedir(), CONFIG_DIR_NAME);
}

export function getConfigPath(): string {
  return join(getConfigDir(), CONFIG_FILE_NAME);
}

export async function loadConfig(): Promise<WodeAppConfig | null> {
  try {
    const raw = await readFile(getConfigPath(), 'utf8');
    const parsed = JSON.parse(raw) as WodeAppConfig;
    if (!parsed.origin) return null;
    return normalizeWodeAppCloudConfig(parsed);
  } catch {
    return null;
  }
}

export async function saveConfig(config: WodeAppConfig): Promise<void> {
  const normalized = normalizeWodeAppCloudConfig(config);
  const dir = getConfigDir();
  await mkdir(dir, { recursive: true });
  const configPath = getConfigPath();
  await writeFile(configPath, JSON.stringify(normalized, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 });
  await chmod(configPath, 0o600);
}

export async function clearConfig(): Promise<void> {
  try {
    await unlink(getConfigPath());
  } catch {
    // no config file
  }
}
