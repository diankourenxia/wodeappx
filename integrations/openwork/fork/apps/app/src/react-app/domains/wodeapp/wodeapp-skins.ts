export type WodeAppSkinId =
  | "default"
  | "classic-blue"
  | "beauty"
  | "supor"
  | "pet-soft"
  | "cute-pastel"
  | "ink-book"
  | "otome-diary"
  | "red-compact"
  | "summer-breeze"
  | "aurora-night"
  | "forest-mist"
  | "coffee-loft"
  | "noir-jazz";

/** Mini preview swatches for the skin picker cards (CSS mock workbench). */
export type WodeAppSkinPreview = {
  sidebar: string;
  main: string;
  accent: string;
  topbar: string;
};

export type WodeAppSkinDefinition = {
  id: WodeAppSkinId;
  label: string;
  description: string;
  preview: WodeAppSkinPreview;
  /** Hidden from picker / promo surfaces; still loadable if already stored (e.g. brand desk). */
  hidden?: boolean;
};

export const WODEAPP_SKINS: readonly WodeAppSkinDefinition[] = [
  {
    id: "default",
    label: "默认外观",
    description: "现代工作台外观",
    preview: {
      sidebar: "#F7F8FA",
      main: "#FFFFFF",
      accent: "#256F6A",
      topbar: "#FFFFFF",
    },
  },
  {
    id: "classic-blue",
    label: "经典蓝色",
    description: "经典桌面软件三栏布局",
    preview: {
      sidebar: "#D6E8F8",
      main: "#EEF4FA",
      accent: "#1974C8",
      topbar: "#1974C8",
    },
  },
  {
    id: "beauty",
    label: "美妆种草",
    description: "自进化示例：美妆整机外观",
    preview: {
      sidebar: "#140E11",
      main: "#FFF7F4",
      accent: "#9B2F42",
      topbar: "#FFF7F4",
    },
  },
  {
    id: "supor",
    label: "苏泊尔",
    description: "自进化示例：厨电详情页经营台",
    hidden: true,
    preview: {
      sidebar: "#FFFFFF",
      main: "#F7F7F5",
      accent: "#C24F00",
      topbar: "#FFFFFF",
    },
  },
  {
    id: "pet-soft",
    label: "萌宠柔光",
    description: "示例主题：奶油杏侧栏与珊瑚点缀",
    preview: {
      sidebar: "#FFF5EB",
      main: "#FFFCF8",
      accent: "#B84A32",
      topbar: "#FFFCF8",
    },
  },
  {
    id: "cute-pastel",
    label: "可爱马卡龙",
    description: "示例主题：薄荷侧栏与桃色 accent",
    preview: {
      sidebar: "#E8F6F1",
      main: "#FFF9FB",
      accent: "#B34D6A",
      topbar: "#FFF9FB",
    },
  },
  {
    id: "ink-book",
    label: "水墨书卷",
    description: "示例主题：宣纸侧栏，对话装进书页并翻开阅读",
    preview: {
      sidebar: "#F4EFE4",
      main: "#FAF6EE",
      accent: "#9B2C1F",
      topbar: "#FAF6EE",
    },
  },
  {
    id: "otome-diary",
    label: "蔷薇日记",
    description: "示例主题：蔷薇奶油侧栏与默认帅哥陪伴",
    preview: {
      sidebar: "#FFF0F5",
      main: "#FFFCF9",
      accent: "#B04568",
      topbar: "#FFFCF9",
    },
  },
  {
    id: "red-compact",
    label: "红色紧凑",
    description: "自进化示例：红色主体与紧凑对话框",
    preview: {
      sidebar: "#FDF2F2",
      main: "#FFFBFB",
      accent: "#B91C1C",
      topbar: "#FFFBFB",
    },
  },
  {
    id: "summer-breeze",
    label: "夏日海风",
    description: "自进化示例：海盐蓝白与日落橙点缀",
    preview: {
      sidebar: "#E8F6F8",
      main: "#FAFEFE",
      accent: "#0E7490",
      topbar: "#FAFEFE",
    },
  },
  {
    id: "aurora-night",
    label: "极光夜航",
    description: "深空靛紫与极光青绿，对话区极光氛围",
    preview: {
      sidebar: "#12182A",
      main: "#0B1220",
      accent: "#0F766E",
      topbar: "#0B1220",
    },
  },
  {
    id: "forest-mist",
    label: "林间晨雾",
    description: "苔绿雾气与纸卡侧栏，静谧自然",
    preview: {
      sidebar: "#E7EFE6",
      main: "#F7FBF6",
      accent: "#3F6B4F",
      topbar: "#F7FBF6",
    },
  },
  {
    id: "coffee-loft",
    label: "咖啡阁楼",
    description: "espresso 暖木与拉花圆角，日常慢感",
    preview: {
      sidebar: "#F3E8DA",
      main: "#FFF8F1",
      accent: "#6F4E37",
      topbar: "#FFF8F1",
    },
  },
  {
    id: "noir-jazz",
    label: "午夜爵士",
    description: "黑金胶片感，低饱和夜店气质",
    preview: {
      sidebar: "#16151A",
      main: "#0E0E10",
      accent: "#8A6A2F",
      topbar: "#0E0E10",
    },
  },
] as const;

/** Skins shown in the picker / marketing capture (excludes hidden brand skins like Supor). */
export function listVisibleWodeAppSkins(): readonly WodeAppSkinDefinition[] {
  return WODEAPP_SKINS.filter((skin) => !skin.hidden);
}

/** Promo / gallery skins — the visually distinctive demos (skips plain default/classic). */
export function listPromoWodeAppSkins(): readonly WodeAppSkinDefinition[] {
  return listVisibleWodeAppSkins().filter(
    (skin) => skin.id !== "default" && skin.id !== "classic-blue",
  );
}

const WODEAPP_SKIN_STORAGE_KEY = "wodeappx.skin";
export const WODEAPP_SKIN_CHANGED_EVENT = "wodeapp:skin-changed";

/** Current product demo skin (workbench shell). Independent of WODEAPPX_EDITION. */
export const WODEAPP_DEFAULT_SKIN_ID: WodeAppSkinId = "red-compact";

export function isWodeAppSkinId(value: string | null | undefined): value is WodeAppSkinId {
  return WODEAPP_SKINS.some((skin) => skin.id === value);
}

/** Map brand agent brandId / id → skin (optional). */
export function resolveSkinForBrandAgent(input: {
  id?: string | null;
  brandId?: string | null;
}): WodeAppSkinId | null {
  const brandId = String(input.brandId || "").trim().toLowerCase();
  const id = String(input.id || "").trim().toLowerCase();
  if (brandId === "supor" || id === "supor-brand-agent") return "supor";
  if (
    brandId === "beauty" ||
    brandId === "wynne" ||
    id === "wynne-brand-agent" ||
    id.includes("beauty")
  ) {
    return "beauty";
  }
  return null;
}

export function parseWodeAppSkinFile(text: string | null | undefined): WodeAppSkinId | null {
  try {
    const parsed = JSON.parse(String(text ?? "")) as { id?: unknown };
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const keys = Object.keys(parsed);
    if (keys.length !== 1 || keys[0] !== "id") return null;
    const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
    return isWodeAppSkinId(id) ? id : null;
  } catch {
    return null;
  }
}

export function resolveWodeAppSkinId(input: {
  fileId?: string | null;
  cacheId?: string | null;
}): WodeAppSkinId {
  if (isWodeAppSkinId(input.fileId)) return input.fileId;
  if (isWodeAppSkinId(input.cacheId)) return input.cacheId;
  return WODEAPP_DEFAULT_SKIN_ID;
}

export function readStoredWodeAppSkin(): WodeAppSkinId {
  if (typeof window === "undefined") return WODEAPP_DEFAULT_SKIN_ID;
  try {
    const fileId = (window as Window & { __WODEAPP_SKIN_FILE_ID__?: string | null }).__WODEAPP_SKIN_FILE_ID__;
    const cacheId = window.localStorage.getItem(WODEAPP_SKIN_STORAGE_KEY);
    return resolveWodeAppSkinId({ fileId, cacheId });
  } catch {
    return WODEAPP_DEFAULT_SKIN_ID;
  }
}

export function storeWodeAppSkin(skin: WodeAppSkinId): void {
  if (typeof window === "undefined") return;
  try {
    const previous = window.localStorage.getItem(WODEAPP_SKIN_STORAGE_KEY);
    window.localStorage.setItem(WODEAPP_SKIN_STORAGE_KEY, skin);
    (window as Window & { __WODEAPP_SKIN_FILE_ID__?: string }).__WODEAPP_SKIN_FILE_ID__ = skin;
    if (previous !== skin) {
      window.dispatchEvent(new CustomEvent(WODEAPP_SKIN_CHANGED_EVENT, { detail: skin }));
    }
  } catch {
    // The skin still applies for the current session when storage is unavailable.
  }
  const invoke = (
    window as Window & {
      __OPENWORK_ELECTRON__?: { invokeDesktop?: (command: string, payload: { id: string }) => Promise<unknown> };
    }
  ).__OPENWORK_ELECTRON__?.invokeDesktop;
  if (typeof invoke === "function") {
    void invoke("skinFileWrite", { id: skin });
  }
}
