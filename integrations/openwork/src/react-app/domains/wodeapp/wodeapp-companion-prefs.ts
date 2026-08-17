export type WodeAppCompanionKind = "sprite" | "live2d";

export type WodeAppCompanionPrefs = {
  /** Floating desktop companion (draggable overlay). */
  enabled: boolean;
  kind: WodeAppCompanionKind;
  /** Selected float avatar id (see wodeapp-companion-avatars.ts). */
  avatarId?: string;

  /**
   * Dialog-rim perch pet (趴宠). Independent of float — own kind/avatar.
   * When `perchConfigured` is false, visibility falls back to legacy pet-soft only.
   */
  perchEnabled: boolean;
  /** True after the user has explicitly set `wodeappx.companion.perch`. */
  perchConfigured: boolean;
  perchKind: WodeAppCompanionKind;
  /** Selected perch avatar id. */
  perchAvatarId?: string;
};

const ENABLED_KEY = "wodeappx.companion.enabled";
const KIND_KEY = "wodeappx.companion.kind";
const AVATAR_KEY = "wodeappx.companion.avatar";
const PERCH_KEY = "wodeappx.companion.perch";
const PERCH_KIND_KEY = "wodeappx.companion.perch.kind";
const PERCH_AVATAR_KEY = "wodeappx.companion.perch.avatar";

export const WODEAPP_COMPANION_PREFS_EVENT = "wodeappx:companion-prefs";
/** Opens the workbench skin / companion picker (listened in main chrome). */
export const WODEAPP_OPEN_SKIN_PICKER_EVENT = "wodeapp:open-skin-picker";

/** Default peek-sheet avatar for dialog perch when unset. */
export const DEFAULT_PERCH_AVATAR_ID = "perch-poodle";

const DEFAULT_PREFS: WodeAppCompanionPrefs = Object.freeze({
  enabled: true,
  kind: "sprite",
  perchEnabled: false,
  perchConfigured: false,
  perchKind: "sprite",
  perchAvatarId: DEFAULT_PERCH_AVATAR_ID,
});

/** Stable snapshot for useSyncExternalStore getSnapshot (must be referentially equal when unchanged). */
let cachedPrefs: WodeAppCompanionPrefs = DEFAULT_PREFS;

function parseFlag(raw: string | null, fallback: boolean): boolean {
  if (raw === null) return fallback;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return fallback;
}

function readFlag(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    return parseFlag(window.localStorage.getItem(key), fallback);
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, value: boolean) {
  try {
    window.localStorage.setItem(key, value ? "true" : "false");
  } catch {
    // ignore
  }
}

function readStoredString(key: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(key);
    return raw?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function writeStoredString(key: string, value: string | undefined) {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function samePrefs(a: WodeAppCompanionPrefs, b: WodeAppCompanionPrefs): boolean {
  return (
    a.enabled === b.enabled &&
    a.kind === b.kind &&
    a.avatarId === b.avatarId &&
    a.perchEnabled === b.perchEnabled &&
    a.perchConfigured === b.perchConfigured &&
    a.perchKind === b.perchKind &&
    a.perchAvatarId === b.perchAvatarId
  );
}

export function isWodeAppCompanionKind(value: string | null | undefined): value is WodeAppCompanionKind {
  return value === "sprite" || value === "live2d";
}

function readPerchState(): Pick<WodeAppCompanionPrefs, "perchEnabled" | "perchConfigured"> {
  if (typeof window === "undefined") {
    return { perchEnabled: DEFAULT_PREFS.perchEnabled, perchConfigured: DEFAULT_PREFS.perchConfigured };
  }
  try {
    const raw = window.localStorage.getItem(PERCH_KEY);
    if (raw === null) {
      return { perchEnabled: false, perchConfigured: false };
    }
    return { perchEnabled: parseFlag(raw, false), perchConfigured: true };
  } catch {
    return { perchEnabled: DEFAULT_PREFS.perchEnabled, perchConfigured: DEFAULT_PREFS.perchConfigured };
  }
}

/**
 * Per-skin companion kit. Empty kit = that skin has no 桌宠/趴宠.
 * Switching skins shows whatever this kit has, and hides the rest.
 */
export type WodeAppSkinCompanionKit = {
  floatAvatarId?: string;
  perchAvatarId?: string;
};

export const WODEAPP_SKIN_COMPANION_KIT: Record<string, WodeAppSkinCompanionKit> = {
  "pet-soft": { floatAvatarId: "dog", perchAvatarId: "perch-poodle" },
  "otome-diary": { floatAvatarId: "otome-default", perchAvatarId: "perch-otome" },
  "summer-breeze": { floatAvatarId: "otter", perchAvatarId: "perch-otter" },
};

export function skinCompanionKit(skinId: string | null | undefined): WodeAppSkinCompanionKit {
  if (!skinId) return {};
  return WODEAPP_SKIN_COMPANION_KIT[skinId] ?? {};
}

export function skinHasFloatCompanion(skinId: string | null | undefined): boolean {
  return Boolean(skinCompanionKit(skinId).floatAvatarId);
}

export function skinHasPerchCompanion(skinId: string | null | undefined): boolean {
  return Boolean(skinCompanionKit(skinId).perchAvatarId);
}

/** @deprecated Kit-owned perch skins; prefer skinHasPerchCompanion. */
export const WODEAPP_LEGACY_PERCH_SKINS = new Set(
  Object.entries(WODEAPP_SKIN_COMPANION_KIT)
    .filter(([, kit]) => Boolean(kit.perchAvatarId))
    .map(([id]) => id),
);

/** Effective float visibility: skin must ship a 桌宠, then honor the user toggle. */
export function resolveCompanionFloatEnabled(
  prefs: WodeAppCompanionPrefs,
  skinId: string | null | undefined,
): boolean {
  if (!skinHasFloatCompanion(skinId)) return false;
  return prefs.enabled;
}

/**
 * Effective perch visibility.
 * No kit → never show. Unconfigured → show when the skin ships a 趴宠.
 * Configured → stored flag, still gated by kit.
 */
export function resolveCompanionPerchEnabled(
  prefs: WodeAppCompanionPrefs,
  skinId: string | null | undefined,
): boolean {
  if (!skinHasPerchCompanion(skinId)) return false;
  if (prefs.perchConfigured) return prefs.perchEnabled;
  return true;
}

/** Default perch avatar id for a skin when the user has not configured perch. */
export function defaultPerchAvatarIdForSkin(skinId: string | null | undefined): string {
  return skinCompanionKit(skinId).perchAvatarId ?? DEFAULT_PERCH_AVATAR_ID;
}

/** Default float avatar id for a skin. */
export function defaultFloatAvatarIdForSkin(skinId: string | null | undefined): string | undefined {
  return skinCompanionKit(skinId).floatAvatarId;
}

export function readWodeAppCompanionPrefs(): WodeAppCompanionPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const kindRaw = window.localStorage.getItem(KIND_KEY);
    const perchKindRaw = window.localStorage.getItem(PERCH_KIND_KEY);
    const perch = readPerchState();
    const next: WodeAppCompanionPrefs = {
      enabled: readFlag(ENABLED_KEY, DEFAULT_PREFS.enabled),
      kind: isWodeAppCompanionKind(kindRaw) ? kindRaw : DEFAULT_PREFS.kind,
      avatarId: readStoredString(AVATAR_KEY),
      perchEnabled: perch.perchEnabled,
      perchConfigured: perch.perchConfigured,
      perchKind: isWodeAppCompanionKind(perchKindRaw) ? perchKindRaw : DEFAULT_PREFS.perchKind,
      perchAvatarId: readStoredString(PERCH_AVATAR_KEY) ?? DEFAULT_PREFS.perchAvatarId,
    };
    if (samePrefs(cachedPrefs, next)) return cachedPrefs;
    cachedPrefs = next;
    return cachedPrefs;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function storeWodeAppCompanionPrefs(next: Partial<WodeAppCompanionPrefs>): WodeAppCompanionPrefs {
  const current = readWodeAppCompanionPrefs();
  const perchTouched = typeof next.perchEnabled === "boolean";
  const merged: WodeAppCompanionPrefs = {
    enabled: typeof next.enabled === "boolean" ? next.enabled : current.enabled,
    kind: next.kind && isWodeAppCompanionKind(next.kind) ? next.kind : current.kind,
    avatarId:
      typeof next.avatarId === "string" && next.avatarId.trim()
        ? next.avatarId.trim()
        : current.avatarId,
    perchEnabled: perchTouched ? next.perchEnabled! : current.perchEnabled,
    perchConfigured: perchTouched ? true : current.perchConfigured,
    perchKind:
      next.perchKind && isWodeAppCompanionKind(next.perchKind) ? next.perchKind : current.perchKind,
    perchAvatarId:
      typeof next.perchAvatarId === "string" && next.perchAvatarId.trim()
        ? next.perchAvatarId.trim()
        : current.perchAvatarId,
  };
  writeFlag(ENABLED_KEY, merged.enabled);
  if (merged.perchConfigured) {
    writeFlag(PERCH_KEY, merged.perchEnabled);
  }
  writeStoredString(KIND_KEY, merged.kind);
  writeStoredString(AVATAR_KEY, merged.avatarId);
  writeStoredString(PERCH_KIND_KEY, merged.perchKind);
  writeStoredString(PERCH_AVATAR_KEY, merged.perchAvatarId);
  cachedPrefs = samePrefs(cachedPrefs, merged) ? cachedPrefs : merged;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(WODEAPP_COMPANION_PREFS_EVENT, { detail: cachedPrefs }));
  }
  return cachedPrefs;
}

export function companionKindLabel(kind: WodeAppCompanionKind): string {
  return kind === "live2d" ? "Live2D" : "精灵图";
}
