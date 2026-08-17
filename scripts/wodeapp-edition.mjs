/**
 * Product edition layer (distribution brand) — independent of workbench skins
 * like `supor` / `beauty`.
 *
 *   WODEAPPX_EDITION=oss
 *
 * Aliases: open-source|wodeappx → oss.
 * Leftover commercial env names also resolve to oss (single product: WodeAppX).
 */

export const WODEAPP_EDITION_IDS = Object.freeze(["oss"]);

/** @typedef {"oss"} WodeAppEditionId */

/**
 * @typedef {object} WodeAppEdition
 * @property {WodeAppEditionId} id
 * @property {string} productName
 * @property {string} productNameDev
 * @property {string} productNameTest
 * @property {string} defaultWorkspaceName
 * @property {boolean} preferPlatformLogin
 * @property {boolean} defaultCloudSignin
 */

/** @type {Readonly<Record<WodeAppEditionId, WodeAppEdition>>} */
export const WODEAPP_EDITIONS = Object.freeze({
  oss: Object.freeze({
    id: "oss",
    productName: "WodeAppX",
    productNameDev: "WodeAppX - Dev",
    productNameTest: "WodeAppX - Test",
    defaultWorkspaceName: "WodeAppX",
    preferPlatformLogin: false,
    defaultCloudSignin: false,
  }),
});

const ALIASES = Object.freeze({
  oss: "oss",
  "open-source": "oss",
  opensource: "oss",
  wodeappx: "oss",
  xiaolingtong: "oss",
  "xiaolingtong-ai": "oss",
  xlt: "oss",
  commercial: "oss",
});

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {WodeAppEditionId}
 */
export function parseWodeAppEditionId(env = process.env) {
  const raw = String(env.WODEAPPX_EDITION ?? env.VITE_WODEAPPX_EDITION ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return "oss";
  const mapped = ALIASES[raw];
  if (!mapped) {
    throw new Error(
      `Unknown WODEAPPX_EDITION=${JSON.stringify(raw)}; expected oss`,
    );
  }
  return mapped;
}

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @returns {WodeAppEdition}
 */
export function resolveWodeAppEdition(env = process.env) {
  return WODEAPP_EDITIONS[parseWodeAppEditionId(env)];
}

/**
 * @param {{ isDevMode?: boolean, isTestInstance?: boolean, env?: NodeJS.ProcessEnv | Record<string, string | undefined> }} [options]
 */
export function resolveEditionAppName(options = {}) {
  const env = options.env ?? process.env;
  const explicit = String(env.OPENWORK_ELECTRON_APP_NAME ?? "").trim();
  if (explicit) return explicit;
  const edition = resolveWodeAppEdition(env);
  if (options.isTestInstance) return edition.productNameTest;
  if (options.isDevMode) return edition.productNameDev;
  return edition.productName;
}

/**
 * Env bag to inject into Electron / Vite child processes for a given edition.
 * Does not override an already-set OPENWORK_ELECTRON_APP_NAME.
 *
 * @param {WodeAppEditionId | string} editionId
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 */
export function editionProcessEnv(editionId, env = process.env) {
  const id = ALIASES[String(editionId).trim().toLowerCase()] ?? parseWodeAppEditionId({ WODEAPPX_EDITION: String(editionId) });
  const edition = WODEAPP_EDITIONS[id];
  /** @type {Record<string, string>} */
  const next = {
    WODEAPPX_EDITION: edition.id,
    VITE_WODEAPPX_EDITION: edition.id,
  };
  if (!String(env.OPENWORK_ELECTRON_APP_NAME ?? "").trim()) {
    next.OPENWORK_ELECTRON_APP_NAME = edition.productName;
  }
  return next;
}
