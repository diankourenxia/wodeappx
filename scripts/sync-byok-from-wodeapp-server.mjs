#!/usr/bin/env node
/**
 * Dev helper: pull a platform LLM key from WodeApp server env into OpenCode auth.
 *
 * Priority: OPENAI_API_KEY > OPENROUTER_API_KEY > DEEPSEEK_API_KEY
 * Env file precedence: root < server < runtime-server, so runtime-server wins conflicts.
 * Does not print secret values.
 */
import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PROVIDERS = {
  openai: {
    id: "openai",
    defaultModel: "openai/gpt-4o",
  },
  openrouter: {
    id: "openrouter",
    defaultModel: "openrouter/deepseek/deepseek-v4-flash",
    legacyDefaults: ["openrouter/openai/gpt-4o"],
  },
  deepseek: {
    id: "deepseek",
    defaultModel: "deepseek/deepseek-v4-flash",
  },
};

const ENV_PRIORITY = ["OPENAI_API_KEY", "OPENROUTER_API_KEY", "DEEPSEEK_API_KEY"];

function parseEnvFile(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function pickProvider(env) {
  for (const name of ENV_PRIORITY) {
    const value = env[name]?.trim();
    if (!value) continue;
    if (name === "OPENAI_API_KEY") return { kind: "openai", apiKey: value };
    if (name === "OPENROUTER_API_KEY") return { kind: "openrouter", apiKey: value };
    if (name === "DEEPSEEK_API_KEY") return { kind: "deepseek", apiKey: value };
  }
  return null;
}

function loadLocalEnvFiles() {
  const root = path.resolve(__dirname, "../..");
  const files = [
    path.join(root, ".env"),
    path.join(root, "server/.env"),
    path.join(root, "runtime-server/.env"),
  ];
  const merged = {};
  for (const file of files) {
    try {
      Object.assign(merged, parseEnvFile(readFileSyncSafe(file)));
    } catch {
      // ignore missing
    }
  }
  return merged;
}

function readFileSyncSafe(file) {
  return execFileSync("cat", [file], { encoding: "utf8" });
}

async function loadRemoteEnv(sshHost) {
  const remoteFiles = [
    "/var/www/wodeapp/server/.env",
    "/var/www/wodeapp/runtime-server/.env",
  ];
  const script = remoteFiles
    .map((file) => `if [ -f ${file} ]; then cat ${file}; fi`)
    .join("; ");
  const text = execFileSync("ssh", ["-o", "ProxyCommand=none", "-o", "StrictHostKeyChecking=no", sshHost, script], {
    encoding: "utf8",
  });
  return parseEnvFile(text);
}

function stripJsoncComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

async function readOpencodeConfig(configPath) {
  try {
    const raw = await readFile(configPath, "utf8");
    const trimmed = raw.trim();
    if (!trimmed) return {};
    return JSON.parse(stripJsoncComments(trimmed));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

async function readJsonFile(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const trimmed = raw.trim();
    return trimmed ? JSON.parse(trimmed) : {};
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw error;
  }
}

async function writeOpencodeConfig(configPath, config) {
  await mkdir(path.dirname(configPath), { recursive: true });
  const body = {
    $schema: "https://opencode.ai/config.json",
    ...config,
  };
  await writeFile(configPath, `${JSON.stringify(body, null, 2)}\n`, "utf8");
}

async function writeOpencodeAuth(authPath, providerId, apiKey) {
  await mkdir(path.dirname(authPath), { recursive: true });
  const current = await readJsonFile(authPath);
  const next = {
    ...current,
    [providerId]: {
      type: "api",
      key: apiKey,
    },
  };
  await writeFile(authPath, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(authPath, 0o600);
}

function preserveProviderOverrides(providerBlock) {
  if (!providerBlock || typeof providerBlock !== "object") return undefined;
  const next = {};
  for (const key of ["models", "whitelist", "blacklist"]) {
    if (providerBlock[key] !== undefined) next[key] = providerBlock[key];
  }
  return Object.keys(next).length ? next : undefined;
}

function resolveDefaultModel(currentModel, spec) {
  if (!currentModel) return spec.defaultModel;
  if (spec.legacyDefaults?.includes(currentModel)) return spec.defaultModel;
  return currentModel;
}

async function main() {
  const sshHost = process.env.WODEAPP_SSH_HOST?.trim() || "wode-cn-tencent";
  const source = process.argv.includes("--local") ? "local" : "remote";

  const env =
    source === "local"
      ? loadLocalEnvFiles()
      : await loadRemoteEnv(sshHost).catch((error) => {
          console.warn(`Remote env via ${sshHost} failed: ${error.message}`);
          return loadLocalEnvFiles();
        });

  const picked = pickProvider(env);
  if (!picked) {
    throw new Error(
      "No OPENAI_API_KEY / OPENROUTER_API_KEY / DEEPSEEK_API_KEY found in server env. Add one to runtime-server/.env or pass --local after setting env locally.",
    );
  }

  const spec = PROVIDERS[picked.kind];
  const configPath = path.join(os.homedir(), ".config/opencode/opencode.jsonc");
  const authPath = path.join(os.homedir(), ".local/share/opencode/auth.json");
  const current = await readOpencodeConfig(configPath);
  const provider = { ...(current.provider ?? {}) };
  const preservedProvider = preserveProviderOverrides(provider[spec.id]);
  if (preservedProvider) provider[spec.id] = preservedProvider;
  else delete provider[spec.id];

  const next = {
    ...current,
    model: resolveDefaultModel(current.model, spec),
    small_model: resolveDefaultModel(current.small_model, spec),
    provider,
  };
  if (Object.keys(next.provider).length === 0) delete next.provider;

  await writeOpencodeAuth(authPath, spec.id, picked.apiKey);
  await writeOpencodeConfig(configPath, next);

  console.log(`Synced ${picked.kind} provider from ${source === "local" ? "local env" : sshHost}.`);
  console.log(`Wrote OpenCode credentials: ${authPath}`);
  console.log(`Wrote global OpenCode config: ${configPath}`);
  console.log(`Default model: ${next.model}`);
  console.log("Restart OpenWork dev if it is already running.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
