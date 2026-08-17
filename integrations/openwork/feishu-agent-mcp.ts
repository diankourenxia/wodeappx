import { spawn } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { ApiError } from "../errors.js";
import type { EnvService } from "../env-file.js";
import type { ServerConfig } from "../types.js";

export const FEISHU_AGENT_MCP_EXTENSION_ID = "feishu-agent-mcp";

const FEISHU_AUTH_TIMEOUT_MS = 6 * 60 * 1000;
const FEISHU_DEFAULT_DOMAIN = "https://open.feishu.cn";
const FEISHU_DEFAULT_CALLBACK_PORT = 3000;
const FEISHU_DEFAULT_TOOLS = "preset.default,preset.base.batch,preset.task.default,preset.calendar.default";
const FEISHU_CLI_PACKAGE = "@larksuite/cli@1.0.78";
const FEISHU_CLI_STATUS_TIMEOUT_MS = 20_000;

export const FEISHU_AGENT_MCP_EXTENSION_ACTIONS = [
  {
    extensionId: FEISHU_AGENT_MCP_EXTENSION_ID,
    action: "status",
    title: "Feishu Agent MCP status",
    description: "Check whether Feishu Agent MCP can start a local OAuth authorization flow.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    extensionId: FEISHU_AGENT_MCP_EXTENSION_ID,
    action: "login",
    title: "Authorize Feishu",
    description: "Run the official lark-mcp OAuth login flow and open the Feishu authorization page.",
    inputSchema: {
      type: "object",
      properties: {
        appId: { type: "string", description: "Optional Feishu/Lark App ID override." },
        appSecret: { type: "string", description: "Optional Feishu/Lark App Secret override." },
        domain: { type: "string", description: "Feishu/Lark Open Platform domain." },
        tools: { type: "string", description: "Enabled lark-mcp tool preset or comma-separated tools." },
        language: { type: "string", description: "lark-mcp tool language." },
        callbackPort: { type: "number", description: "Local OAuth callback port. The Feishu app redirect URL must match it." },
        scope: { type: "string", description: "Optional OAuth scopes, separated by spaces or commas." },
      },
      additionalProperties: false,
    },
  },
];

type FeishuCredentials = {
  appId: string;
  appSecret: string;
  domain: string;
  tools: string;
  language: string;
  credentialSource: "input" | "env" | "missing";
};

export type FeishuCliAuthorization = {
  available: boolean;
  authorized: boolean;
  profile: string;
  appId: string;
  userName: string;
  userOpenId: string;
  tokenStatus: string;
  error: string;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(value: unknown, key: string): string {
  if (!isRecord(value)) return "";
  const field = value[key];
  return typeof field === "string" ? field.trim() : "";
}

function readNumberField(value: unknown, key: string): number | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  if (typeof field === "number" && Number.isFinite(field)) return field;
  if (typeof field === "string" && field.trim()) {
    const parsed = Number(field.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseJsonOutput(output: string): unknown {
  const trimmed = output.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error("lark-cli did not return JSON.");
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

export function normalizeFeishuCliAuthorization(value: unknown): FeishuCliAuthorization {
  if (!isRecord(value)) {
    return {
      available: false,
      authorized: false,
      profile: "",
      appId: "",
      userName: "",
      userOpenId: "",
      tokenStatus: "",
      error: "",
    };
  }
  const onBehalfOf = isRecord(value.onBehalfOf) ? value.onBehalfOf : {};
  const identity = readStringField(value, "identity");
  const tokenStatus = readStringField(value, "tokenStatus");
  const userOpenId = readStringField(onBehalfOf, "openId");
  const available = value.available === true;
  return {
    available,
    authorized: available && identity === "user" && tokenStatus === "ready" && Boolean(userOpenId),
    profile: readStringField(value, "profile"),
    appId: readStringField(value, "appId"),
    userName: readStringField(onBehalfOf, "userName"),
    userOpenId,
    tokenStatus,
    error: "",
  };
}

function lastSafeCliOutput(stdout: string, stderr: string): string {
  return `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-4)
    .join("\n")
    .slice(0, 1_000);
}

function runJsonProcess(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: process.env,
    });
    const finish = (error: Error | null, value?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error("lark-cli status timed out."));
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 200_000) stdout = stdout.slice(-200_000);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });
    child.once("error", (error) => finish(error));
    child.once("close", (code) => {
      if (code !== 0) {
        finish(new Error(lastSafeCliOutput(stdout, stderr) || `lark-cli exited with code ${code ?? "unknown"}.`));
        return;
      }
      try {
        finish(null, parseJsonOutput(stdout));
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

async function resolveFeishuCliAuthorization(): Promise<FeishuCliAuthorization> {
  const explicitCli = process.env.WODEAPPX_LARK_CLI_PATH?.trim() || "";
  const invocations = explicitCli
    ? [{ command: explicitCli, args: ["whoami", "--json"] }]
    : [
        { command: "lark-cli", args: ["whoami", "--json"] },
        { command: "npx", args: ["-y", FEISHU_CLI_PACKAGE, "whoami", "--json"] },
      ];
  let lastError = "";
  for (const invocation of invocations) {
    try {
      return normalizeFeishuCliAuthorization(
        await runJsonProcess(invocation.command, invocation.args, FEISHU_CLI_STATUS_TIMEOUT_MS),
      );
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  return {
    available: false,
    authorized: false,
    profile: "",
    appId: "",
    userName: "",
    userOpenId: "",
    tokenStatus: "",
    error: lastError.slice(0, 1_000),
  };
}

async function readEnvMap(env: EnvService): Promise<Record<string, string>> {
  const entries = await env.list().catch(() => []);
  return Object.fromEntries(entries.map((entry) => [entry.key, entry.value]));
}

function pickEnvValue(env: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = env[key]?.trim() || process.env[key]?.trim() || "";
    if (value) return value;
  }
  return "";
}

async function resolveFeishuCredentials(args: Record<string, unknown>, env: EnvService): Promise<FeishuCredentials> {
  const envMap = await readEnvMap(env);
  const inputAppId = readStringField(args, "appId");
  const inputAppSecret = readStringField(args, "appSecret");
  const envAppId = pickEnvValue(envMap, ["APP_ID", "FEISHU_APP_ID"]);
  const envAppSecret = pickEnvValue(envMap, ["APP_SECRET", "FEISHU_APP_SECRET"]);
  const appId = inputAppId || envAppId;
  const appSecret = inputAppSecret || envAppSecret;
  return {
    appId,
    appSecret,
    domain: sanitizeDomain(readStringField(args, "domain") || pickEnvValue(envMap, ["LARK_DOMAIN"]) || FEISHU_DEFAULT_DOMAIN),
    tools: readStringField(args, "tools") || pickEnvValue(envMap, ["LARK_TOOLS"]) || FEISHU_DEFAULT_TOOLS,
    language: readStringField(args, "language") || "zh",
    credentialSource: inputAppId && inputAppSecret ? "input" : appId && appSecret ? "env" : "missing",
  };
}

function sanitizeDomain(domain: string): string {
  const trimmed = domain.trim() || FEISHU_DEFAULT_DOMAIN;
  if (!/^https:\/\/[A-Za-z0-9.-]+(?::\d+)?(?:\/)?$/.test(trimmed)) {
    throw new ApiError(400, "invalid_feishu_domain", "Feishu Open Platform domain must be an https URL.");
  }
  return trimmed.replace(/\/+$/, "");
}

function sanitizeCallbackPort(port: number | null): number {
  const resolved = port ?? FEISHU_DEFAULT_CALLBACK_PORT;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > 65535) {
    throw new ApiError(400, "invalid_feishu_callback_port", "Feishu OAuth callback port must be between 1 and 65535.");
  }
  return resolved;
}

function redact(value: string, secret: string): string {
  if (!secret) return value;
  return value.split(secret).join("[redacted]");
}

function lastUsefulOutput(stdout: string, stderr: string, appSecret: string): string {
  const combined = `${stdout}\n${stderr}`
    .split(/\r?\n/)
    .map((line) => redact(line.trim(), appSecret))
    .filter(Boolean)
    .slice(-8)
    .join("\n");
  return combined || "lark-mcp login exited without details.";
}

function splitTools(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function feishuMcpConfigPath(): string {
  return join(homedir(), ".config", "openwork", "feishu-agent-mcp.json");
}

async function writeFeishuMcpConfig(credentials: FeishuCredentials): Promise<string> {
  const target = feishuMcpConfigPath();
  await mkdir(dirname(target), { recursive: true });
  await writeFile(
    target,
    JSON.stringify({
      appId: credentials.appId,
      appSecret: credentials.appSecret,
      domain: credentials.domain,
      tools: splitTools(credentials.tools),
      language: credentials.language,
      oauth: true,
      tokenMode: "user_access_token",
    }, null, 2) + "\n",
    { encoding: "utf8", mode: 0o600 },
  );
  await chmod(target, 0o600).catch(() => undefined);
  return target;
}

async function runFeishuLogin(args: Record<string, unknown>, env: EnvService) {
  const credentials = await resolveFeishuCredentials(args, env);
  const callbackPort = sanitizeCallbackPort(readNumberField(args, "callbackPort"));
  const scope = readStringField(args, "scope");

  if (!credentials.appId) throw new ApiError(400, "missing_feishu_app_id", "Feishu App ID is required.");
  if (!credentials.appSecret) throw new ApiError(400, "missing_feishu_app_secret", "Feishu App Secret is required.");

  const cliArgs = [
    "-y",
    "@larksuiteoapi/lark-mcp",
    "login",
    "-a",
    credentials.appId,
    "-s",
    credentials.appSecret,
    "-d",
    credentials.domain,
    "--host",
    "localhost",
    "-p",
    String(callbackPort),
  ];
  if (scope) cliArgs.push("--scope", scope);

  const configPath = await writeFeishuMcpConfig(credentials);

  return await new Promise<{ authorized: true; callbackUrl: string; configPath: string; credentialSource: FeishuCredentials["credentialSource"] }>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn("npx", cliArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        APP_ID: credentials.appId,
        APP_SECRET: credentials.appSecret,
        LARK_DOMAIN: credentials.domain,
        LARK_TOKEN_MODE: "user_access_token",
      },
    });

    const finish = (error: Error | null, result?: { authorized: true; callbackUrl: string; configPath: string; credentialSource: FeishuCredentials["credentialSource"] }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result ?? { authorized: true, callbackUrl: `http://localhost:${callbackPort}/callback`, configPath, credentialSource: credentials.credentialSource });
    };

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new ApiError(408, "feishu_oauth_timeout", "Feishu authorization timed out. Start again and approve the browser authorization page."));
    }, FEISHU_AUTH_TIMEOUT_MS);

    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 20_000) stdout = stdout.slice(-20_000);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
    });
    child.once("error", (error) => {
      finish(new ApiError(500, "feishu_oauth_start_failed", `Could not start lark-mcp login: ${error.message}`));
    });
    child.once("close", (code) => {
      if (code === 0) {
        finish(null, {
          authorized: true,
          callbackUrl: `http://localhost:${callbackPort}/callback`,
          configPath,
          credentialSource: credentials.credentialSource,
        });
        return;
      }
      finish(new ApiError(
        500,
        "feishu_oauth_failed",
        `Feishu authorization failed. ${lastUsefulOutput(stdout, stderr, credentials.appSecret)}`,
      ));
    });
  });
}

export async function callFeishuAgentMcpExtensionAction(
  _config: ServerConfig,
  _env: EnvService,
  action: string,
  args: Record<string, unknown>,
  context: Record<string, unknown>,
) {
  if (action === "status") {
    const cli = await resolveFeishuCliAuthorization();
    const credentials = await resolveFeishuCredentials(args, _env);
    const missing = [
      credentials.appId ? "" : "APP_ID",
      credentials.appSecret ? "" : "APP_SECRET",
    ].filter(Boolean);
    const legacyConfigured = missing.length === 0;
    return {
      ok: true,
      extensionId: FEISHU_AGENT_MCP_EXTENSION_ID,
      action,
      result: {
        configured: cli.authorized || legacyConfigured,
        authorized: cli.authorized,
        integration: cli.authorized ? "lark-cli" : legacyConfigured ? "lark-mcp" : "missing",
        missing: cli.authorized ? [] : missing,
        callbackUrl: `http://localhost:${FEISHU_DEFAULT_CALLBACK_PORT}/callback`,
        credentialSource: cli.authorized ? "lark-cli" : credentials.credentialSource,
        packageName: cli.authorized ? FEISHU_CLI_PACKAGE : "@larksuiteoapi/lark-mcp",
        profile: cli.profile,
        userName: cli.userName,
        userOpenId: cli.userOpenId,
        tokenStatus: cli.tokenStatus,
        cliAvailable: cli.available,
      },
      context,
    };
  }

  if (action === "login") {
    const cli = await resolveFeishuCliAuthorization();
    if (cli.authorized) {
      return {
        ok: true,
        extensionId: FEISHU_AGENT_MCP_EXTENSION_ID,
        action,
        result: {
          authorized: true,
          integration: "lark-cli",
          credentialSource: "lark-cli",
          configPath: "",
          profile: cli.profile,
          userName: cli.userName,
          userOpenId: cli.userOpenId,
          tokenStatus: cli.tokenStatus,
        },
        context,
      };
    }
    const result = await runFeishuLogin(args, _env);
    return {
      ok: true,
      extensionId: FEISHU_AGENT_MCP_EXTENSION_ID,
      action,
      result: {
        ...result,
        integration: "lark-mcp",
      },
      context,
    };
  }

  return null;
}
