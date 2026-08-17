#!/usr/bin/env node
/**
 * WodeAppX CLI — onboard writes ~/.wodeapp/config.json (same store as desktop).
 * @see wodeappx/docs/ARCHITECTURE.md
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  getConfigPath,
  loadConfig,
  saveConfig,
  verifyConfig,
  WODEAPP_CLOUD_ORIGIN,
  type WodeAppConfig,
  type WodeAppProfile,
} from "@wodeapp/app-core";
import { runPlazaCommand } from "./plaza-cmd.ts";

const LOCAL_ORIGIN = "http://127.0.0.1:3000";

const HELP = `WodeApp App CLI

  wodeapp onboard [--origin <url>] [--api-key <sk_live_...>] [--profile cloud|selfhost|local-only] [--yes]
                   Configure cloud/selfhost + API keys (writes ${getConfigPath()})
  wodeapp doctor   Connectivity check against saved config
  wodeapp plaza list|install|export|remove   Local custom plaza (agents / skins)
  wodeapp chat     Agent session (SSE) — not implemented yet
  wodeapp skill list / materialize   — not implemented yet
  wodeapp open <url>                 — not implemented yet

Docs: wodeappx/README.md
`;

function readArg(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

function inferProfile(origin: string, explicit?: string): WodeAppProfile {
  if (explicit === "cloud" || explicit === "selfhost" || explicit === "local-only") {
    return explicit;
  }
  try {
    const host = new URL(origin).hostname;
    if (host === "localhost" || host === "127.0.0.1") return "selfhost";
  } catch {
    // fall through
  }
  if (origin.replace(/\/$/, "") === WODEAPP_CLOUD_ORIGIN) return "cloud";
  return "selfhost";
}

async function prompt(question: string, fallback = ""): Promise<string> {
  if (!input.isTTY) return fallback;
  const rl = createInterface({ input, output });
  try {
    const answer = await rl.question(question);
    return answer.trim() || fallback;
  } finally {
    rl.close();
  }
}

async function runOnboard(argv: string[]): Promise<number> {
  const existing = await loadConfig();
  let origin = readArg(argv, "--origin") || existing?.origin || "";
  let apiKey = readArg(argv, "--api-key") || process.env.WODEAPP_API_KEY || "";
  const profileArg = readArg(argv, "--profile");
  const yes = hasFlag(argv, "--yes") || hasFlag(argv, "-y");

  if (!origin) {
    if (yes) {
      origin = WODEAPP_CLOUD_ORIGIN;
    } else {
      const choice = await prompt(
        `Origin preset [1=local ${LOCAL_ORIGIN} / 2=cloud ${WODEAPP_CLOUD_ORIGIN} / 3=custom] (default 2): `,
        "2",
      );
      if (choice === "1") origin = LOCAL_ORIGIN;
      else if (choice === "3") {
        origin = await prompt("Custom origin: ", "");
      } else {
        origin = WODEAPP_CLOUD_ORIGIN;
      }
    }
  }

  if (!origin) {
    console.error("Origin is required.");
    return 1;
  }
  if (!/^https?:\/\//i.test(origin)) {
    console.error("Origin must start with http:// or https://");
    return 1;
  }

  if (!apiKey && !yes) {
    apiKey = await prompt(
      existing?.apiKey
        ? "API Key (leave blank to keep existing): "
        : "API Key (sk_live_...): ",
      "",
    );
  }
  if (!apiKey) apiKey = existing?.apiKey || "";
  if (!apiKey) {
    console.error("API Key is required. Pass --api-key or set WODEAPP_API_KEY.");
    return 1;
  }

  const draft: WodeAppConfig = {
    profile: inferProfile(origin, profileArg),
    origin: origin.replace(/\/$/, ""),
    apiKey,
    issuedOrigin: origin.replace(/\/$/, ""),
  };

  try {
    const verified = await verifyConfig(draft);
    await saveConfig(verified);
    console.log(`Saved ${getConfigPath()}`);
    console.log(`  profile: ${verified.profile}`);
    console.log(`  origin:  ${verified.origin}`);
    console.log(`  issued:  ${verified.issuedOrigin || verified.origin}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Config was not saved. Fix origin/key and retry.");
    return 1;
  }
}

async function runDoctor(): Promise<number> {
  const config = await loadConfig();
  if (!config) {
    console.error(`No config at ${getConfigPath()}. Run: wodeapp onboard`);
    return 1;
  }
  try {
    const verified = await verifyConfig(config);
    console.log("OK");
    console.log(`  profile: ${verified.profile}`);
    console.log(`  origin:  ${verified.origin}`);
    console.log(`  issued:  ${verified.issuedOrigin || verified.origin}`);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(HELP);
    process.exit(0);
  }
  if (cmd === "onboard") {
    process.exit(await runOnboard(argv.slice(1)));
  }
  if (cmd === "doctor") {
    process.exit(await runDoctor());
  }
  if (cmd === "plaza") {
    process.exit(await runPlazaCommand(argv.slice(1)));
  }
  console.error(`Command "${cmd}" is not implemented yet.`);
  console.error(HELP);
  process.exit(1);
}

void main();
