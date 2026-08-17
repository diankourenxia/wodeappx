import type { WodeAppCompanionKind } from "./wodeapp-companion-prefs";

/** Mirrors WODEAPP_SKIN_COMPANION_KIT in wodeapp-companion-prefs.ts (keep in sync). */
const SKIN_FLOAT_DEFAULT: Record<string, string> = {
  "pet-soft": "dog",
  "otome-diary": "otome-default",
  "summer-breeze": "otter",
};
const SKIN_PERCH_DEFAULT: Record<string, string> = {
  "pet-soft": "perch-poodle",
  "otome-diary": "perch-otome",
  "summer-breeze": "perch-otter",
};
const SKIN_KIT_FLOAT_IDS = new Set(Object.values(SKIN_FLOAT_DEFAULT));
const SKIN_KIT_PERCH_IDS = new Set(Object.values(SKIN_PERCH_DEFAULT));

/**
 * Companion avatars are placement-specific:
 * - float (桌宠): standing / full-body sheets + Live2D
 * - perch (趴宠): rim-peek 1×4 sheets only (different art + interaction)
 *
 * Add sprites via scripts/build-companion-sprite-sheet.mjs into apps/app/public.
 */
export type WodeAppCompanionAvatar = {
  id: string;
  kind: WodeAppCompanionKind;
  label: string;
  /** File name under apps/app/public (sprite kind only). */
  spriteSheet?: string;
  /** Frame count of the sprite sheet (4 / 8 / 16); defaults to 4. */
  frames?: number;
  /** Cubism2 model URL (live2d kind only). */
  live2dModelUrl?: string;
};

export type WodeAppCompanionPlacement = "float" | "perch";

/** Floating desktop companion (draggable). */
export const WODEAPP_FLOAT_COMPANION_AVATARS: readonly WodeAppCompanionAvatar[] = [
  { id: "dog", kind: "sprite", label: "小狗", spriteSheet: "skin-pet-sprite-sheet.png" },
  {
    id: "otome-default",
    kind: "sprite",
    label: "日记对象",
    spriteSheet: "skin-otome-sprite-sheet.png",
    frames: 4,
  },
  { id: "cat", kind: "sprite", label: "橘猫", spriteSheet: "companion-cat-sprite-sheet.png", frames: 16 },
  { id: "rabbit", kind: "sprite", label: "小白兔", spriteSheet: "companion-rabbit-sprite-sheet.png", frames: 16 },
  { id: "robot", kind: "sprite", label: "小机器人", spriteSheet: "companion-robot-sprite-sheet.png", frames: 16 },
  {
    id: "otter",
    kind: "sprite",
    label: "小海獭",
    spriteSheet: "companion-otter-sprite-sheet.png",
    frames: 4,
  },
  {
    id: "xiaoxue",
    kind: "live2d",
    label: "小雪",
    live2dModelUrl:
      "https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display@master/test/assets/shizuku/shizuku.model.json",
  },
] as const;

/**
 * Dialog-rim perch pets — peek sheets only (idle / sleep / watch / wave).
 * Do not reuse float standing sheets here.
 */
export const WODEAPP_PERCH_COMPANION_AVATARS: readonly WodeAppCompanionAvatar[] = [
  {
    id: "perch-poodle",
    kind: "sprite",
    label: "探头犬",
    spriteSheet: "skin-pet-perch-sheet.png",
    frames: 4,
  },
  {
    id: "perch-otome",
    kind: "sprite",
    label: "日记探头",
    spriteSheet: "skin-otome-perch-sheet.png",
    frames: 4,
  },
  {
    id: "perch-cat",
    kind: "sprite",
    label: "探头猫",
    spriteSheet: "companion-perch-cat-sheet.png",
    frames: 4,
  },
  {
    id: "perch-rabbit",
    kind: "sprite",
    label: "探头兔",
    spriteSheet: "companion-perch-rabbit-sheet.png",
    frames: 4,
  },
  {
    id: "perch-otter",
    kind: "sprite",
    label: "探头海獭",
    spriteSheet: "companion-perch-otter-sheet.png",
    frames: 4,
  },
] as const;

/** @deprecated Prefer float/perch-specific lists. */
export const WODEAPP_COMPANION_AVATARS: readonly WodeAppCompanionAvatar[] = [
  ...WODEAPP_FLOAT_COMPANION_AVATARS,
  ...WODEAPP_PERCH_COMPANION_AVATARS,
];

export function companionAvatarsForPlacement(
  placement: WodeAppCompanionPlacement,
): readonly WodeAppCompanionAvatar[] {
  return placement === "perch" ? WODEAPP_PERCH_COMPANION_AVATARS : WODEAPP_FLOAT_COMPANION_AVATARS;
}

export function resolveWodeAppCompanionAvatar(
  id: string | null | undefined,
  placement: WodeAppCompanionPlacement = "float",
): WodeAppCompanionAvatar | null {
  if (!id) return null;
  return companionAvatarsForPlacement(placement).find((avatar) => avatar.id === id) ?? null;
}

export function defaultWodeAppCompanionAvatar(
  kind: WodeAppCompanionKind,
  placement: WodeAppCompanionPlacement = "float",
): WodeAppCompanionAvatar {
  const list = companionAvatarsForPlacement(placement);
  const fallback = list.find((avatar) => avatar.kind === kind);
  return fallback ?? list[0];
}

export function wodeAppCompanionAvatarsForKind(
  kind: WodeAppCompanionKind,
  placement: WodeAppCompanionPlacement = "float",
): WodeAppCompanionAvatar[] {
  return companionAvatarsForPlacement(placement).filter((avatar) => avatar.kind === kind);
}

/** Resolve the avatar implied by prefs, falling back to the kind default. */
export function resolveCompanionAvatarForPrefs(
  prefs: {
    kind: WodeAppCompanionKind;
    avatarId?: string;
  },
  placement: WodeAppCompanionPlacement = "float",
): WodeAppCompanionAvatar {
  const stored = resolveWodeAppCompanionAvatar(prefs.avatarId, placement);
  if (stored && stored.kind === prefs.kind) return stored;
  return defaultWodeAppCompanionAvatar(prefs.kind, placement);
}

/** Float desktop companion avatar (independent of perch). */
export function resolveFloatCompanionAvatar(prefs: {
  kind: WodeAppCompanionKind;
  avatarId?: string;
}): WodeAppCompanionAvatar {
  return resolveCompanionAvatarForPrefs(prefs, "float");
}

/** Dialog-rim perch avatar (independent of float). */
export function resolvePerchCompanionAvatar(prefs: {
  perchKind: WodeAppCompanionKind;
  perchAvatarId?: string;
}): WodeAppCompanionAvatar {
  return resolveCompanionAvatarForPrefs(
    {
      kind: prefs.perchKind,
      avatarId: prefs.perchAvatarId,
    },
    "perch",
  );
}

/**
 * Float avatar for the active skin.
 * Skin-owned defaults (dog / 日记对象) follow the skin; generic customs (cat…) stay.
 * No kit → null (caller must not render).
 */
export function resolveFloatCompanionAvatarForSkin(
  prefs: {
    kind: WodeAppCompanionKind;
    avatarId?: string;
  },
  skinId: string | null | undefined,
): WodeAppCompanionAvatar | null {
  const kitId = typeof skinId === "string" ? SKIN_FLOAT_DEFAULT[skinId] : undefined;
  if (!kitId) return null;
  const stored = resolveWodeAppCompanionAvatar(prefs.avatarId, "float");
  if (stored && stored.kind === prefs.kind && !SKIN_KIT_FLOAT_IDS.has(stored.id)) {
    return stored;
  }
  return resolveWodeAppCompanionAvatar(kitId, "float") ?? stored ?? defaultWodeAppCompanionAvatar(prefs.kind, "float");
}

/**
 * Perch avatar for the active skin.
 * Skin-owned defaults follow the skin; generic customs stay. No kit → null.
 */
export function resolvePerchCompanionAvatarForSkin(
  prefs: {
    perchConfigured: boolean;
    perchKind: WodeAppCompanionKind;
    perchAvatarId?: string;
  },
  skinId: string | null | undefined,
): WodeAppCompanionAvatar | null {
  const kitId = typeof skinId === "string" ? SKIN_PERCH_DEFAULT[skinId] : undefined;
  if (!kitId) return null;
  const kitDefault = resolveWodeAppCompanionAvatar(kitId, "perch");
  const stored = resolveWodeAppCompanionAvatar(prefs.perchAvatarId, "perch");
  if (stored && stored.kind === prefs.perchKind && !SKIN_KIT_PERCH_IDS.has(stored.id)) {
    return stored;
  }
  return kitDefault ?? stored ?? defaultWodeAppCompanionAvatar(prefs.perchKind, "perch");
}

export function companionAvatarSpriteSrc(avatar: WodeAppCompanionAvatar): string {
  const file = avatar.spriteSheet ?? "skin-pet-sprite-sheet.png";
  return `${import.meta.env.BASE_URL}${file}`;
}

/** Sprite element class, including the multi-frame animation variant. */
export function companionAvatarSpriteClass(avatar: WodeAppCompanionAvatar): string {
  if (avatar.frames === 16) return "wapp-theme-pet-sprite is-frames-16";
  if (avatar.frames === 8) return "wapp-theme-pet-sprite is-frames-8";
  return "wapp-theme-pet-sprite";
}
