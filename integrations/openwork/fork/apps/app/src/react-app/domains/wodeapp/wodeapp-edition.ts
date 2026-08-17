/**
 * Product edition (distribution brand). Independent of workbench skins
 * (`supor` / `beauty` / …). See `scripts/wodeapp-edition.mjs` for Node source.
 *
 * Set at build/dev: `WODEAPPX_EDITION` / `VITE_WODEAPPX_EDITION` = `oss`.
 * Default: oss (WodeAppX). Leftover commercial env names also resolve to oss.
 */

export type WodeAppEditionId = "oss";

export type WodeAppEdition = {
  id: WodeAppEditionId;
  productName: string;
  productNameDev: string;
  productNameTest: string;
  defaultWorkspaceName: string;
  preferPlatformLogin: boolean;
  defaultCloudSignin: boolean;
};

export const WODEAPP_EDITIONS: Readonly<Record<WodeAppEditionId, WodeAppEdition>> = {
  oss: {
    id: "oss",
    productName: "WodeAppX",
    productNameDev: "WodeAppX - Dev",
    productNameTest: "WodeAppX - Test",
    defaultWorkspaceName: "WodeAppX",
    preferPlatformLogin: false,
    defaultCloudSignin: false,
  },
};

const ALIASES: Record<string, WodeAppEditionId> = {
  oss: "oss",
  "open-source": "oss",
  opensource: "oss",
  wodeappx: "oss",
  xiaolingtong: "oss",
  "xiaolingtong-ai": "oss",
  xlt: "oss",
  commercial: "oss",
};

function readEditionEnv(): string {
  if (typeof import.meta !== "undefined") {
    const vite = (import.meta as { env?: Record<string, string | undefined> }).env;
    const fromVite = String(vite?.VITE_WODEAPPX_EDITION ?? "").trim();
    if (fromVite) return fromVite;
  }
  if (typeof process !== "undefined" && process.env) {
    return String(process.env.WODEAPPX_EDITION ?? process.env.VITE_WODEAPPX_EDITION ?? "").trim();
  }
  return "";
}

export function parseWodeAppEditionId(rawInput?: string | null): WodeAppEditionId {
  const raw = String(rawInput ?? readEditionEnv()).trim().toLowerCase();
  if (!raw) return "oss";
  const mapped = ALIASES[raw];
  if (!mapped) {
    throw new Error(`Unknown WODEAPPX_EDITION=${JSON.stringify(raw)}; expected oss`);
  }
  return mapped;
}

export function resolveWodeAppEdition(rawInput?: string | null): WodeAppEdition {
  return WODEAPP_EDITIONS[parseWodeAppEditionId(rawInput)];
}

/** True for the only shipping product (WodeAppX). */
export function isOssEdition(rawInput?: string | null): boolean {
  return parseWodeAppEditionId(rawInput) === "oss";
}
