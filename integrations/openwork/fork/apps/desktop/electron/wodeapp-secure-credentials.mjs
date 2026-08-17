import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const WODEAPP_CREDENTIAL_SLOTS = Object.freeze({
  quickAccount: "quick-account",
  service: "service",
  legacyConfig: "legacy-config",
});

const CREDENTIALS_FILE = "credentials.v1.json";
const ENVELOPE_VERSION = 1;

export class WodeAppCredentialStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "WodeAppCredentialStoreError";
    this.code = code;
  }
}

export function wodeAppDataDir(env = process.env) {
  const isolatedDir = typeof env.WODEAPPX_TEST_WODEAPP_DIR === "string"
    ? env.WODEAPPX_TEST_WODEAPP_DIR.trim()
    : "";
  if (env.WODEAPPX_TEST_INSTANCE_ID?.trim() && isolatedDir) {
    return path.resolve(isolatedDir);
  }
  return path.join(os.homedir(), ".wodeapp");
}

export function wodeAppSecureCredentialsPath(userDir = wodeAppDataDir()) {
  return path.join(userDir, CREDENTIALS_FILE);
}

function emptyEnvelope() {
  return { version: ENVELOPE_VERSION, storage: "electron-safeStorage", credentials: {} };
}

async function readEnvelope(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    if (parsed?.version !== ENVELOPE_VERSION || parsed?.storage !== "electron-safeStorage") {
      return emptyEnvelope();
    }
    return {
      version: ENVELOPE_VERSION,
      storage: "electron-safeStorage",
      credentials: parsed.credentials && typeof parsed.credentials === "object"
        ? parsed.credentials
        : {},
    };
  } catch (error) {
    if (error?.code === "ENOENT" || error instanceof SyntaxError) return emptyEnvelope();
    throw error;
  }
}

async function writePrivateJsonAtomic(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, filePath);
    await chmod(filePath, 0o600);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

function normalizeSlot(slot) {
  const value = String(slot ?? "").trim();
  if (!Object.values(WODEAPP_CREDENTIAL_SLOTS).some((candidate) => candidate === value)) {
    throw new WodeAppCredentialStoreError("INVALID_SLOT", "不支持的 WodeApp 凭证类型");
  }
  return value;
}

/**
 * Electron safeStorage encrypts data with an OS-protected key. Ciphertext is
 * kept in a user-only file so account metadata never contains a reusable key.
 * @param {{
 *   safeStorage: {
 *     isEncryptionAvailable: () => boolean;
 *     encryptString: (value: string) => Buffer;
 *     decryptString: (value: Buffer) => string;
 *     getSelectedStorageBackend?: () => string;
 *   };
 *   platform?: NodeJS.Platform;
 *   userDir?: string;
 * }} options
 */
export function createWodeAppSecureCredentialStore({
  safeStorage,
  platform = process.platform,
  userDir = wodeAppDataDir(),
}) {
  const filePath = wodeAppSecureCredentialsPath(userDir);
  let mutationQueue = Promise.resolve();

  function status() {
    if (!safeStorage || typeof safeStorage.isEncryptionAvailable !== "function") {
      return { available: false, backend: "unavailable", reason: "系统安全存储不可用" };
    }
    let available = false;
    try {
      available = safeStorage.isEncryptionAvailable();
    } catch {
      available = false;
    }
    if (!available) {
      return { available: false, backend: "unavailable", reason: "系统安全存储尚不可用" };
    }
    if (platform === "linux" && typeof safeStorage.getSelectedStorageBackend === "function") {
      const backend = safeStorage.getSelectedStorageBackend();
      if (backend === "basic_text" || backend === "unknown") {
        return {
          available: false,
          backend,
          reason: backend === "basic_text"
            ? "Linux 未检测到 Secret Service，已拒绝使用 basic_text 保存凭证"
            : "Linux 安全存储后端尚未初始化",
        };
      }
      return { available: true, backend, reason: null };
    }
    return {
      available: true,
      backend: platform === "darwin" ? "keychain" : platform === "win32" ? "dpapi" : "safeStorage",
      reason: null,
    };
  }

  function assertAvailable() {
    const current = status();
    if (!current.available) {
      throw new WodeAppCredentialStoreError("SECURE_STORAGE_UNAVAILABLE", current.reason);
    }
    return current;
  }

  async function get(slot) {
    const key = normalizeSlot(slot);
    assertAvailable();
    const envelope = await readEnvelope(filePath);
    const encoded = envelope.credentials[key]?.ciphertext;
    if (typeof encoded !== "string" || !encoded) return null;
    try {
      return safeStorage.decryptString(Buffer.from(encoded, "base64"));
    } catch {
      throw new WodeAppCredentialStoreError(
        "CREDENTIAL_DECRYPT_FAILED",
        "系统安全存储无法解密 WodeApp 凭证，请重新登录",
      );
    }
  }

  function mutate(operation) {
    const next = mutationQueue.then(operation, operation);
    mutationQueue = next.catch(() => undefined);
    return next;
  }

  async function set(slot, secret) {
    const key = normalizeSlot(slot);
    const value = typeof secret === "string" ? secret.trim() : "";
    if (!value) throw new WodeAppCredentialStoreError("EMPTY_CREDENTIAL", "WodeApp 凭证不能为空");
    const current = assertAvailable();
    return mutate(async () => {
      const ciphertext = safeStorage.encryptString(value).toString("base64");
      const envelope = await readEnvelope(filePath);
      envelope.credentials[key] = {
        ciphertext,
        updatedAt: new Date().toISOString(),
      };
      await writePrivateJsonAtomic(filePath, envelope);
      return { ok: true, backend: current.backend };
    });
  }

  async function remove(slot) {
    const key = normalizeSlot(slot);
    return mutate(async () => {
      const envelope = await readEnvelope(filePath);
      if (!Object.prototype.hasOwnProperty.call(envelope.credentials, key)) return;
      delete envelope.credentials[key];
      if (Object.keys(envelope.credentials).length === 0) {
        await rm(filePath, { force: true });
        return;
      }
      await writePrivateJsonAtomic(filePath, envelope);
    });
  }

  return { filePath, get, remove, set, status };
}
