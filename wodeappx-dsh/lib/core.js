/** Thin DSH helpers. No vendor HTTP. No secrets in the plugin. */

export const BRIDGE_ORIGIN = "http://127.0.0.1:17654";
export const BRIDGE_HEALTH_PATH = "/health";
export const BRIDGE_TIMEOUT_MS = 3000;
export const BRIDGE_CACHE_MS = 60_000;
export const RELEASES_URL = "https://github.com/diankourenxia/wodeappx/releases";
export const KEYS_PATH = "~/.wodeapp/keys.json";
export const USER_HANDBOOK_DIR = "~/.wodeapp/agents";

export const SHIPPED_HANDBOOK_AGENTS = Object.freeze([
  {
    id: "visual-generation",
    name: "图片智能体",
    abilityKind: "image",
    defaultUrl: "https://yougi.wodeapp.cn/",
    handbook: "docs/agents/visual-generation.md",
  },
  {
    id: "video-generation",
    name: "视频智能体",
    abilityKind: "video",
    defaultUrl: "https://ai.wodeapp.cn/video",
    handbook: "docs/agents/video-generation.md",
  },
]);

export const OPENAI_COMPAT_MODEL_ROW = Object.freeze({
  id: "openai-compatible",
  label: "OpenAI 兼容",
  keys: KEYS_PATH,
});

/** @type {{ expiresAt: number, result: object } | null} */
let healthCache = null;

export function clearBridgeHealthCache() {
  healthCache = null;
}

export function parseHandbookFrontmatter(text) {
  const match = String(text ?? "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const id = match[1].match(/^id:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const name = match[1].match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? "";
  if (!id || !name) return null;
  return { id, name };
}

export function listHandbookAgents(userHandbooks = {}) {
  const out = SHIPPED_HANDBOOK_AGENTS.map((agent) => {
    const overlay = userHandbooks[agent.id];
    const fm = overlay ? parseHandbookFrontmatter(overlay) : null;
    if (fm && fm.id === agent.id) {
      return {
        ...agent,
        name: fm.name,
        handbook: `${USER_HANDBOOK_DIR}/${agent.id}.md`,
        source: "user",
      };
    }
    return { ...agent, source: "official" };
  });
  return out;
}

export function openHandbookAgent(id, userHandbooks = {}) {
  const agent = listHandbookAgents(userHandbooks).find((item) => item.id === id);
  if (!agent) return { ok: false, error: "unknown agent" };
  return {
    ok: true,
    id: agent.id,
    name: agent.name,
    handbook: agent.handbook,
    workbench: agent.defaultUrl,
    runtime: "runtime-server",
  };
}

export function describeModels() {
  return {
    rows: [OPENAI_COMPAT_MODEL_ROW],
    keys: KEYS_PATH,
    note: "BYOK 与本机/兼容端点同一行。插件不读、不写密钥。",
  };
}

export async function probeBridgeHealth(input = {}) {
  const now = Number(input.now) || Date.now();
  const force = input.force === true;
  if (!force && healthCache && healthCache.expiresAt > now) {
    return { ...healthCache.result, cached: true };
  }
  const fetchImpl = input.fetchImpl || globalThis.fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`${BRIDGE_ORIGIN}${BRIDGE_HEALTH_PATH}`, {
      method: "GET",
      signal: controller.signal,
    });
    const up = Boolean(res && (res.ok === true || res.status === 200));
    const result = up
      ? { ok: true, up: true, origin: BRIDGE_ORIGIN, tools: ["wodeappx_browser_status"] }
      : { ok: false, up: false, origin: BRIDGE_ORIGIN, download: RELEASES_URL, electron: false };
    healthCache = { expiresAt: now + BRIDGE_CACHE_MS, result };
    return { ...result, cached: false };
  } catch {
    const result = {
      ok: false,
      up: false,
      origin: BRIDGE_ORIGIN,
      download: RELEASES_URL,
      electron: false,
    };
    healthCache = { expiresAt: now + BRIDGE_CACHE_MS, result };
    return { ...result, cached: false };
  } finally {
    clearTimeout(timer);
  }
}

export function browserCdp(input = {}) {
  if (input.userConfirmed !== true) {
    return { ok: false, error: "CDP requires userConfirmed" };
  }
  return { ok: true, origin: BRIDGE_ORIGIN, note: "use existing bridge; do not launch Electron" };
}

export function planEvolve(input = {}) {
  const action = String(input.action || "handbook").trim();
  const id = String(input.id || "").trim();
  return {
    action,
    id,
    backup: `${USER_HANDBOOK_DIR}/.backup/${id || "agent"}`,
    verify: "frontmatter id+name",
    rollback: `${USER_HANDBOOK_DIR}/.backup/${id || "agent"}`,
    needsConfirm: true,
  };
}

export function applyEvolve(input = {}, io = {}) {
  const plan = planEvolve(input);
  if (input.userConfirmed !== true) {
    return { ok: false, applied: false, plan, error: "evolve requires userConfirmed" };
  }
  const writes = [];
  const backup = typeof io.backup === "function" ? io.backup(plan) : plan.backup;
  writes.push({ kind: "backup", path: backup });
  if (typeof io.write === "function") io.write(plan);
  if (typeof io.verify === "function" && io.verify(plan) === false) {
    if (typeof io.rollback === "function") io.rollback(plan);
    return { ok: false, applied: false, plan, rolledBack: true, error: "verify failed" };
  }
  writes.push({ kind: "apply", path: plan.id });
  return { ok: true, applied: true, plan, writes };
}

export function assertNoSecrets(value) {
  const text = JSON.stringify(value);
  return !/(sk-|api[_-]?key|BEGIN [A-Z ]*PRIVATE KEY)/i.test(text);
}
