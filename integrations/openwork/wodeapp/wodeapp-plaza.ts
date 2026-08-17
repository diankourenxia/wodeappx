/**
 * Local custom plaza (能力中心「自定义广场」).
 * Users upload / publish agent and skin packs; install writes brand-agents or applies CSS.
 * Circulation layer only — not a second theming engine.
 */

import {
  type WodeAppBrandAgentConfig,
  type WodeAppBrandAgentFile,
  normalizeWodeAppBrandAgentsFile,
  validateWodeAppBrandAgentsFile,
  WODEAPP_BRAND_AGENT_ID_PATTERN,
} from "./wodeapp-brand-agent-config";
import {
  type WodeAppSkinDefinition,
  type WodeAppSkinId,
  type WodeAppSkinPreview,
} from "./wodeapp-skins";

export const WODEAPP_PLAZA_STORAGE_KEY = "wodeappx.plaza.catalog.v1";
export const WODEAPP_PLAZA_CHANGED_EVENT = "wodeapp:plaza-changed";
export const WODEAPP_PLAZA_PACK_VERSION = 1 as const;
export const WODEAPP_PLAZA_CSS_MAX = 80_000;
export const WODEAPP_PLAZA_JSON_MAX = 256_000;
export const WODEAPP_PLAZA_SKIN_ID_PATTERN = /^plaza-[a-z][a-z0-9-]{0,54}$/;

export type WodeAppPlazaKind = "agent" | "skin";
export type WodeAppPlazaSource = "upload" | "publish" | "example";
export type WodeAppPlazaSkinId = `plaza-${string}`;

export type WodeAppPlazaSkinPayload = {
  id: WodeAppPlazaSkinId;
  label: string;
  description: string;
  preview: WodeAppSkinPreview;
  css: string;
};

export type WodeAppPlazaItem = {
  id: string;
  kind: WodeAppPlazaKind;
  name: string;
  description: string;
  author?: string;
  createdAt: string;
  source: WodeAppPlazaSource;
  agent?: WodeAppBrandAgentConfig;
  skin?: WodeAppPlazaSkinPayload;
};

export type WodeAppPlazaPack = {
  wodeappxPlaza: typeof WODEAPP_PLAZA_PACK_VERSION;
  kind: WodeAppPlazaKind;
  id?: string;
  name?: string;
  description?: string;
  author?: string;
  agent?: WodeAppBrandAgentConfig;
  skin?: {
    id?: string;
    label?: string;
    description?: string;
    preview?: Partial<WodeAppSkinPreview>;
    css?: string;
  };
};

export type WodeAppPlazaParseResult =
  | { ok: true; items: WodeAppPlazaItem[]; warnings: string[] }
  | { ok: false; error: string; items: WodeAppPlazaItem[]; warnings: string[] };

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

function hashSeed(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36).slice(0, 8) || "item";
}

export function slugifyPlazaId(input: string): string {
  const ascii = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (WODEAPP_BRAND_AGENT_ID_PATTERN.test(ascii)) return ascii;
  return `item-${hashSeed(input.trim() || "plaza")}`;
}

export function isWodeAppPlazaSkinId(value: string | null | undefined): value is WodeAppPlazaSkinId {
  return WODEAPP_PLAZA_SKIN_ID_PATTERN.test(String(value || ""));
}

export function toPlazaSkinId(raw: string): WodeAppPlazaSkinId {
  const slug = slugifyPlazaId(raw.replace(/^plaza-/, ""));
  const id = `plaza-${slug}` as WodeAppPlazaSkinId;
  if (WODEAPP_PLAZA_SKIN_ID_PATTERN.test(id)) return id;
  return `plaza-item-${hashSeed(raw)}` as WodeAppPlazaSkinId;
}

export function isHexColor(value: string | null | undefined): boolean {
  return HEX_COLOR.test(String(value || "").trim());
}

function normalizeHex(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!isHexColor(trimmed)) return fallback;
  if (trimmed.length === 4) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return trimmed.toUpperCase();
}

function relativeLuminance(hex: string): number {
  const full = normalizeHex(hex, "#888888").slice(1);
  const channel = (offset: number) => {
    const value = Number.parseInt(full.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

export function onColorFor(background: string): string {
  return relativeLuminance(background) > 0.45 ? "#1F2633" : "#FFFFFF";
}

export function sanitizePlazaCss(input: string): string {
  let css = String(input || "");
  css = css.replace(/<\/style/gi, "");
  css = css.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "");
  css = css.replace(/@import\b[^;{]*;?/gi, "");
  css = css.replace(/expression\s*\(/gi, "invalid(");
  css = css.replace(/url\s*\(\s*['"]?\s*javascript:/gi, "url(");
  css = css.replace(/behavior\s*:/gi, "invalid:");
  css = css.replace(/-moz-binding\s*:/gi, "invalid:");
  if (css.length > WODEAPP_PLAZA_CSS_MAX) css = css.slice(0, WODEAPP_PLAZA_CSS_MAX);
  return css.trim();
}

export function generatePlazaSkinCss(skinId: WodeAppPlazaSkinId, preview: WodeAppSkinPreview): string {
  const sidebar = normalizeHex(preview.sidebar, "#F4F6F8");
  const main = normalizeHex(preview.main, "#FFFFFF");
  const accent = normalizeHex(preview.accent, "#256F6A");
  const topbar = normalizeHex(preview.topbar, main);
  const ink = onColorFor(main);
  const sidebarInk = onColorFor(sidebar);
  const onAccent = onColorFor(accent);
  const meta = sidebarInk === "#FFFFFF" ? "rgba(247,248,250,0.72)" : "#6B7280";
  const line = sidebarInk === "#FFFFFF" ? "rgba(247,248,250,0.16)" : "rgba(31,38,51,0.12)";
  const root = `.wapp-workspace-shell.wapp-skin-${skinId}`;
  return `
${root} {
  --wapp-plaza-ink: ${ink};
  --wapp-plaza-sidebar: ${sidebar};
  --wapp-plaza-sidebar-text: ${sidebarInk};
  --wapp-plaza-sidebar-meta: ${meta};
  --wapp-plaza-main: ${main};
  --wapp-plaza-accent: ${accent};
  --wapp-plaza-on-accent: ${onAccent};
  --wapp-plaza-topbar: ${topbar};
  --wapp-plaza-line: ${line};
  background: var(--wapp-plaza-main);
  color: var(--wapp-plaza-ink);
}
${root}.is-sidebar-collapsed {
  grid-template-columns: 0 minmax(0, 1fr);
}
${root} > .wapp-sidebar {
  border-right: 1px solid var(--wapp-plaza-line);
  background-color: var(--wapp-plaza-sidebar) !important;
  color: var(--wapp-plaza-sidebar-text);
}
${root} > .wapp-workspace-main,
${root} .wapp-main-panel,
${root} .wapp-content,
${root} .wapp-session-embed [data-slot="sidebar-inset"] {
  background: var(--wapp-plaza-main);
  color: var(--wapp-plaza-ink);
}
${root} .wapp-topbar {
  background: var(--wapp-plaza-topbar);
  color: ${onColorFor(topbar)};
}
${root} .wapp-new-chat,
${root} .wapp-brand-mark {
  background: var(--wapp-plaza-accent);
  color: var(--wapp-plaza-on-accent);
  border: 0;
  font-weight: 700;
}
${root} .wapp-nav-item,
${root} .wapp-nav-toggle,
${root} .wapp-nav-subitem,
${root} .wapp-recent-item,
${root} .wapp-recent-title,
${root} .wapp-recent-item-head {
  color: var(--wapp-plaza-sidebar-text);
}
${root} .wapp-recent-meta,
${root} .wapp-nav-subitem-meta,
${root} .wapp-sidebar-label {
  color: var(--wapp-plaza-sidebar-meta);
}
/* contrast-gate:active-recent */
${root} .wapp-nav-item.is-active,
${root} .wapp-nav-subitem.is-active,
${root} .wapp-recent-row.is-active .wapp-recent-item {
  background: var(--wapp-plaza-accent);
  color: var(--wapp-plaza-on-accent);
}
${root} .wapp-recent-row.is-active .wapp-recent-item,
${root} .wapp-recent-row.is-active .wapp-recent-item *,
${root} .wapp-recent-row.is-active .wapp-recent-title {
  color: var(--wapp-plaza-on-accent) !important;
}
${root} .wapp-composer-card,
${root} .wx-runtime-card {
  background: var(--wapp-plaza-main);
  color: var(--wapp-plaza-ink);
}
`.trim();
}

function defaultPreview(): WodeAppSkinPreview {
  return {
    sidebar: "#E8F1EE",
    main: "#FBFCFB",
    accent: "#2A7A6A",
    topbar: "#FBFCFB",
  };
}

function normalizePreview(input: Partial<WodeAppSkinPreview> | undefined): WodeAppSkinPreview {
  const fallback = defaultPreview();
  return {
    sidebar: normalizeHex(String(input?.sidebar || ""), fallback.sidebar),
    main: normalizeHex(String(input?.main || ""), fallback.main),
    accent: normalizeHex(String(input?.accent || ""), fallback.accent),
    topbar: normalizeHex(String(input?.topbar || ""), fallback.topbar),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function exampleCatalog(): WodeAppPlazaItem[] {
  const skinId = toPlazaSkinId("pine-desk");
  const preview = defaultPreview();
  return [
    {
      id: "local-notes-agent",
      kind: "agent",
      name: "本地笔记助手",
      description: "示例智能体：整理笔记、提炼待办；不连接外部店铺。",
      source: "example",
      createdAt: nowIso(),
      agent: {
        id: "local-notes-agent",
        name: "本地笔记助手",
        brandId: "local-notes",
        meta: "笔记 · 待办 · 本地",
        entryPrompt: "帮我整理这段笔记，列出待办和关键结论。",
        samplePrompt: "按本地笔记助手处理；不要编造未提供的事实。",
        workbench: "generic",
        enabled: true,
      },
    },
    {
      id: skinId,
      kind: "skin",
      name: "松绿工作台",
      description: "示例皮肤：侧栏松绿、主区浅底、松绿强调色。",
      source: "example",
      createdAt: nowIso(),
      skin: {
        id: skinId,
        label: "松绿工作台",
        description: "侧栏松绿、主区浅底、松绿强调色",
        preview,
        css: generatePlazaSkinCss(skinId, preview),
      },
    },
  ];
}

function readStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(WODEAPP_PLAZA_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorage(items: WodeAppPlazaItem[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(WODEAPP_PLAZA_STORAGE_KEY, JSON.stringify({ version: 1, items }));
    window.dispatchEvent(new CustomEvent(WODEAPP_PLAZA_CHANGED_EVENT, { detail: { items } }));
  } catch {
    // quota / private mode — in-memory session still holds the React state
  }
}

function coerceItem(input: unknown): WodeAppPlazaItem | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const kind = record.kind === "skin" ? "skin" : record.kind === "agent" ? "agent" : null;
  if (!kind) return null;
  const name = clip(String(record.name || ""), 64);
  if (!name) return null;
  const source: WodeAppPlazaSource =
    record.source === "upload" || record.source === "publish" || record.source === "example"
      ? record.source
      : "upload";
  if (kind === "agent") {
    const validated = validateWodeAppBrandAgentsFile({
      version: 1,
      agents: [record.agent && typeof record.agent === "object" ? record.agent : record],
    });
    const agent = validated.file.agents[0];
    if (!agent) return null;
    return {
      id: agent.id,
      kind: "agent",
      name: clip(name || agent.name, 64),
      description: clip(String(record.description || agent.meta || ""), 160),
      author: typeof record.author === "string" ? clip(record.author, 64) : undefined,
      createdAt: typeof record.createdAt === "string" ? record.createdAt : nowIso(),
      source,
      agent,
    };
  }
  const skinRecord = record.skin && typeof record.skin === "object"
    ? record.skin as Record<string, unknown>
    : record;
  const skinId = toPlazaSkinId(String(skinRecord.id || record.id || name));
  const preview = normalizePreview(skinRecord.preview as Partial<WodeAppSkinPreview> | undefined);
  const generated = generatePlazaSkinCss(skinId, preview);
  const extra = sanitizePlazaCss(String(skinRecord.css || ""));
  const css = extra.includes(`.wapp-skin-${skinId}`) ? `${generated}\n${extra}` : generated;
  return {
    id: skinId,
    kind: "skin",
    name: clip(name || String(skinRecord.label || "自定义皮肤"), 64),
    description: clip(String(record.description || skinRecord.description || ""), 160),
    author: typeof record.author === "string" ? clip(record.author, 64) : undefined,
    createdAt: typeof record.createdAt === "string" ? record.createdAt : nowIso(),
    source,
    skin: {
      id: skinId,
      label: clip(String(skinRecord.label || name || "自定义皮肤"), 64),
      description: clip(String(skinRecord.description || record.description || ""), 160),
      preview,
      css,
    },
  };
}

export function coercePlazaCatalog(raw: unknown): WodeAppPlazaItem[] {
  if (raw == null) return [];
  const items = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items)
      ? (raw as { items: unknown[] }).items
      : [];
  const out: WodeAppPlazaItem[] = [];
  const seen = new Set<string>();
  for (const entry of items) {
    const item = coerceItem(entry);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export function listWodeAppPlazaItems(raw?: unknown): WodeAppPlazaItem[] {
  const parsed = raw ?? (() => {
    const stored = readStorage();
    if (!stored) return null;
    try {
      return JSON.parse(stored) as unknown;
    } catch {
      return null;
    }
  })();
  if (parsed == null) return exampleCatalog();
  return coercePlazaCatalog(parsed);
}

export function upsertWodeAppPlazaItems(nextItems: WodeAppPlazaItem[]): WodeAppPlazaItem[] {
  const seen = new Set<string>();
  const items: WodeAppPlazaItem[] = [];
  for (const item of nextItems) {
    const coerced = coerceItem(item);
    if (!coerced || seen.has(coerced.id)) continue;
    seen.add(coerced.id);
    items.push(coerced);
  }
  writeStorage(items);
  return items;
}

export function addWodeAppPlazaItems(
  catalog: WodeAppPlazaItem[],
  incoming: WodeAppPlazaItem[],
): WodeAppPlazaItem[] {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, { ...item, createdAt: item.createdAt || nowIso() });
  return upsertWodeAppPlazaItems([...byId.values()]);
}

export function removeWodeAppPlazaItem(catalog: WodeAppPlazaItem[], id: string): WodeAppPlazaItem[] {
  return upsertWodeAppPlazaItems(catalog.filter((item) => item.id !== id));
}

export function findPlazaSkin(skinId: string, catalog = listWodeAppPlazaItems()): WodeAppPlazaSkinPayload | null {
  const item = catalog.find((entry) => entry.kind === "skin" && entry.skin?.id === skinId);
  return item?.skin ?? null;
}

export function readPlazaSkinCss(skinId: string, catalog = listWodeAppPlazaItems()): string {
  return findPlazaSkin(skinId, catalog)?.css ?? "";
}

export function listPlazaSkinDefinitions(catalog = listWodeAppPlazaItems()): WodeAppSkinDefinition[] {
  return catalog
    .filter((item): item is WodeAppPlazaItem & { skin: WodeAppPlazaSkinPayload } => Boolean(item.kind === "skin" && item.skin))
    .map((item) => ({
      id: item.skin.id as WodeAppSkinId,
      label: item.skin.label,
      description: item.skin.description || "自定义广场皮肤",
      preview: item.skin.preview,
    }));
}

export function plazaItemToPack(item: WodeAppPlazaItem): WodeAppPlazaPack {
  return {
    wodeappxPlaza: 1,
    kind: item.kind,
    id: item.id,
    name: item.name,
    description: item.description,
    author: item.author,
    agent: item.agent,
    skin: item.skin,
  };
}

export function parsePlazaUpload(input: unknown): WodeAppPlazaParseResult {
  const warnings: string[] = [];
  if (input == null) return { ok: false, error: "文件是空的", items: [], warnings };
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) return { ok: false, error: "文件是空的", items: [], warnings };
    if (trimmed.length > WODEAPP_PLAZA_JSON_MAX) {
      return { ok: false, error: "文件过大，请保持在 256KB 以内", items: [], warnings };
    }
    try {
      return parsePlazaUpload(JSON.parse(trimmed) as unknown);
    } catch {
      return { ok: false, error: "不是合法 JSON", items: [], warnings };
    }
  }

  const asAgentsFile = (value: unknown): WodeAppBrandAgentFile | null => {
    if (!value || typeof value !== "object") return null;
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.agents) || Array.isArray(value)) {
      const validated = validateWodeAppBrandAgentsFile(value);
      if (!validated.file.agents.length) return null;
      return validated.file;
    }
    return null;
  };

  const record = input && typeof input === "object" ? input as Record<string, unknown> : null;
  const items: WodeAppPlazaItem[] = [];

  if (record && (record.wodeappxPlaza === 1 || record.wodeappxPlaza === "1" || record.kind === "agent" || record.kind === "skin")) {
    if (record.kind === "agent" && Array.isArray(record.agents)) {
      for (const agent of normalizeWodeAppBrandAgentsFile({ version: 1, agents: record.agents }).agents) {
        const item = coerceItem({ kind: "agent", name: agent.name, description: agent.meta, agent, source: "upload" });
        if (item) items.push(item);
      }
    } else {
      const item = coerceItem({ ...record, source: "upload" });
      if (item) items.push(item);
    }
  } else {
    const file = asAgentsFile(input);
    if (file) {
      for (const agent of file.agents) {
        const item = coerceItem({ kind: "agent", name: agent.name, description: agent.meta, agent, source: "upload" });
        if (item) items.push(item);
      }
    } else {
      const item = coerceItem({ ...(record || {}), kind: record?.brandId ? "agent" : record?.preview ? "skin" : record?.kind, source: "upload" });
      if (item) items.push(item);
    }
  }

  if (!items.length) {
    return { ok: false, error: "无法识别为智能体或皮肤包", items: [], warnings };
  }
  return { ok: true, items, warnings };
}

export function publishAgentToPlaza(
  catalog: WodeAppPlazaItem[],
  agent: WodeAppBrandAgentConfig,
): WodeAppPlazaParseResult {
  const item = coerceItem({
    kind: "agent",
    name: agent.name,
    description: agent.meta || "",
    agent,
    source: "publish",
  });
  if (!item) return { ok: false, error: "智能体配置无效，无法发布", items: [], warnings: [] };
  return { ok: true, items: addWodeAppPlazaItems(catalog, [item]), warnings: [] };
}

export function publishSkinToPlaza(
  catalog: WodeAppPlazaItem[],
  input: { name: string; description?: string; preview: WodeAppSkinPreview; css?: string },
): WodeAppPlazaParseResult {
  const item = coerceItem({
    kind: "skin",
    name: input.name,
    description: input.description || "",
    source: "publish",
    skin: {
      id: toPlazaSkinId(input.name),
      label: input.name,
      description: input.description || "",
      preview: input.preview,
      css: input.css || "",
    },
  });
  if (!item) return { ok: false, error: "皮肤配置无效，无法发布", items: [], warnings: [] };
  return { ok: true, items: addWodeAppPlazaItems(catalog, [item]), warnings: [] };
}

export function mergeBrandAgentsWithPlaza(
  existing: WodeAppBrandAgentConfig[],
  agent: WodeAppBrandAgentConfig,
): WodeAppBrandAgentFile {
  const next = existing.filter((item) => item.id !== agent.id);
  next.push({ ...agent, enabled: true });
  return normalizeWodeAppBrandAgentsFile({ version: 1, agents: next });
}

export function dropBrandAgent(existing: WodeAppBrandAgentConfig[], agentId: string): WodeAppBrandAgentFile {
  return normalizeWodeAppBrandAgentsFile({
    version: 1,
    agents: existing.filter((item) => item.id !== agentId),
  });
}

export function subscribeWodeAppPlaza(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key === WODEAPP_PLAZA_STORAGE_KEY) onChange();
  };
  window.addEventListener(WODEAPP_PLAZA_CHANGED_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(WODEAPP_PLAZA_CHANGED_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function getWodeAppPlazaSnapshot(): string {
  return listWodeAppPlazaItems()
    .map((item) => `${item.id}:${item.kind}:${item.skin?.css.length ?? 0}`)
    .join("|");
}
