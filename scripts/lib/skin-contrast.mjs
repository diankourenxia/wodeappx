/**
 * Skin contrast contract + helpers (WCAG 2.2 AA).
 *
 * Layers:
 *   1) Token pairs — design FG/BG must meet AA
 *   2) CSS structure — interactive states must force solid AA text
 *   3) Live CDP — computed styles (specificity wars) + optional screenshot
 *
 * Acceptance entrypoints:
 *   node wodeappx/scripts/check-skin-contrast.mjs
 *   node wodeappx/scripts/check-skin-contrast-live.mjs
 */

export const WCAG_AA = {
  normalText: 4.5,
  largeText: 3,
  ui: 3,
};

/** Solid AA tokens for beauty skin (default / resting). */
export const BEAUTY_SKIN_CONTRAST_PAIRS = [
  { role: "sidebar-primary", fg: "#FFF5F2", bg: "#1A1216", min: WCAG_AA.normalText },
  { role: "sidebar-secondary", fg: "#F0D2D7", bg: "#1A1216", min: WCAG_AA.normalText },
  { role: "sidebar-meta", fg: "#E0B8BF", bg: "#1A1216", min: WCAG_AA.normalText },
  { role: "sidebar-accent-icon", fg: "#FFB4BE", bg: "#1A1216", min: WCAG_AA.ui },
  { role: "main-primary", fg: "#1A1216", bg: "#FFF7F4", min: WCAG_AA.normalText },
  { role: "main-secondary", fg: "#4A333B", bg: "#FFF7F4", min: WCAG_AA.normalText },
  { role: "main-link", fg: "#9B2F42", bg: "#FFF7F4", min: WCAG_AA.normalText },
  { role: "chip-text", fg: "#2A1A20", bg: "#FFFFFF", min: WCAG_AA.normalText },
  { role: "cta-on-coral", fg: "#FFFFFF", bg: "#9B2F42", min: WCAG_AA.normalText },
  { role: "topbar-text", fg: "#2A1A20", bg: "#FFF7F4", min: WCAG_AA.normalText },
];

/**
 * Interactive states: text on the *composited* highlight over sidebar ink.
 * rgba(155,47,66,0.45) over #1A1216 ≈ #541F2A
 * rgba(155,47,66,0.35) over #1A1216 ≈ #471C25
 */
export const BEAUTY_SKIN_INTERACTIVE_PAIRS = [
  { role: "sidebar-active-text", fg: "#FFFFFF", bg: "#541F2A", min: WCAG_AA.normalText },
  { role: "sidebar-hover-text", fg: "#FFFFFF", bg: "#471C25", min: WCAG_AA.normalText },
];

export const BEAUTY_ALL_CONTRAST_PAIRS = [
  ...BEAUTY_SKIN_CONTRAST_PAIRS,
  ...BEAUTY_SKIN_INTERACTIVE_PAIRS,
];

/** Solid AA tokens for Supor kitchen-appliance skin (light rail). */
export const SUPOR_SKIN_CONTRAST_PAIRS = [
  { role: "sidebar-primary", fg: "#1A1A1A", bg: "#FFFFFF", min: WCAG_AA.normalText },
  { role: "sidebar-secondary", fg: "#B34700", bg: "#FFFFFF", min: WCAG_AA.normalText },
  { role: "sidebar-meta", fg: "#4A4A4A", bg: "#FFFFFF", min: WCAG_AA.normalText },
  { role: "sidebar-accent-icon", fg: "#C24F00", bg: "#FFFFFF", min: WCAG_AA.ui },
  { role: "main-primary", fg: "#1A1A1A", bg: "#F7F7F5", min: WCAG_AA.normalText },
  { role: "main-secondary", fg: "#4A4A4A", bg: "#F7F7F5", min: WCAG_AA.normalText },
  { role: "main-link", fg: "#B34700", bg: "#F7F7F5", min: WCAG_AA.normalText },
  { role: "chip-text", fg: "#1A1A1A", bg: "#FFFFFF", min: WCAG_AA.normalText },
  { role: "cta-on-orange", fg: "#FFFFFF", bg: "#C24F00", min: WCAG_AA.normalText },
  { role: "topbar-text", fg: "#2C2C2C", bg: "#F7F7F5", min: WCAG_AA.normalText },
];

/** Active/hover use solid orange on the light rail. */
export const SUPOR_SKIN_INTERACTIVE_PAIRS = [
  { role: "sidebar-active-text", fg: "#FFFFFF", bg: "#C24F00", min: WCAG_AA.normalText },
  { role: "sidebar-hover-text", fg: "#FFFFFF", bg: "#B34700", min: WCAG_AA.normalText },
];

/**
 * Appearance dark (`html[data-theme=dark]`) — surfaces invert; CTA stays orange+white.
 * Brand accent on dark uses brighter link/secondary (#FF8533) for AA.
 */
export const SUPOR_SKIN_DARK_CONTRAST_PAIRS = [
  { role: "dark:sidebar-primary", fg: "#F5F5F2", bg: "#1C1C1A", min: WCAG_AA.normalText },
  { role: "dark:sidebar-secondary", fg: "#FF8533", bg: "#1C1C1A", min: WCAG_AA.normalText },
  { role: "dark:sidebar-meta", fg: "#C9C9C4", bg: "#1C1C1A", min: WCAG_AA.normalText },
  { role: "dark:sidebar-accent-icon", fg: "#FF8533", bg: "#1C1C1A", min: WCAG_AA.ui },
  { role: "dark:main-primary", fg: "#F5F5F2", bg: "#141413", min: WCAG_AA.normalText },
  { role: "dark:main-secondary", fg: "#C9C9C4", bg: "#141413", min: WCAG_AA.normalText },
  { role: "dark:main-link", fg: "#FF8533", bg: "#141413", min: WCAG_AA.normalText },
  { role: "dark:chip-text", fg: "#F5F5F2", bg: "#242422", min: WCAG_AA.normalText },
  { role: "dark:cta-on-orange", fg: "#FFFFFF", bg: "#C24F00", min: WCAG_AA.normalText },
  { role: "dark:topbar-text", fg: "#E8E8E3", bg: "#141413", min: WCAG_AA.normalText },
  { role: "dark:sidebar-active-text", fg: "#FFFFFF", bg: "#C24F00", min: WCAG_AA.normalText },
  { role: "dark:sidebar-hover-text", fg: "#FFFFFF", bg: "#B34700", min: WCAG_AA.normalText },
];

export const SUPOR_ALL_CONTRAST_PAIRS = [
  ...SUPOR_SKIN_CONTRAST_PAIRS,
  ...SUPOR_SKIN_INTERACTIVE_PAIRS,
  ...SUPOR_SKIN_DARK_CONTRAST_PAIRS,
];

/** Shared structure rules for example theme skins (pet/coser/cute/biz). */
export function themeExampleStructureRules(skinId, { activeTextHex = "#ffffff" } = {}) {
  const hex = String(activeTextHex).replace("#", "");
  const colorRe = new RegExp(`color:\\s*#${hex}\\b`, "i");
  return [
    {
      id: "active-recent-item-color",
      description: `Active recent row must set solid ${activeTextHex} on .wapp-recent-item`,
      test: (css) =>
        /\.wapp-recent-row\.is-active\s+\.wapp-recent-item\b[\s\S]{0,280}?color:\s*#/i.test(css) &&
        colorRe.test(
          String(css).match(
            /\.wapp-recent-row\.is-active\s+\.wapp-recent-item\b[\s\S]{0,280}?color:\s*#[0-9a-fA-F]{3,8}/i,
          )?.[0] || "",
        ),
    },
    {
      id: "active-recent-descendant-color",
      description:
        `Active recent row must force ${activeTextHex} on descendants. Marker: contrast-gate:active-recent`,
      test: (css) =>
        /contrast-gate:active-recent/i.test(css) &&
        /\.wapp-recent-row\.is-active\s+\.wapp-recent-item\s+\*[\s\S]{0,200}?color:\s*#/i.test(css) &&
        colorRe.test(
          String(css).match(
            /\.wapp-recent-row\.is-active\s+\.wapp-recent-item\s+\*[\s\S]{0,200}?color:\s*#[0-9a-fA-F]{3,8}/i,
          )?.[0] || "",
        ),
    },
    {
      id: "hover-recent-item-color",
      description: `Hover recent row must set solid ${activeTextHex} on .wapp-recent-item`,
      test: (css) =>
        /\.wapp-recent-row:hover\s+\.wapp-recent-item\b[\s\S]{0,280}?color:\s*#/i.test(css) &&
        colorRe.test(
          String(css).match(
            /\.wapp-recent-row:hover\s+\.wapp-recent-item\b[\s\S]{0,280}?color:\s*#[0-9a-fA-F]{3,8}/i,
          )?.[0] || "",
        ),
    },
    {
      id: `${skinId}-dark-token-block`,
      description: `Dark appearance must redefine tokens. Marker: contrast-gate:${skinId}-dark`,
      test: (css) =>
        new RegExp(`contrast-gate:${skinId}-dark`, "i").test(css) &&
        /html\[data-theme=["']dark["']\]/.test(css),
    },
  ];
}

function themeExamplePairs({
  sidebarText,
  sidebarMeta,
  sidebarIcon,
  sidebar,
  mainInk,
  mainSecondary,
  mainLink,
  pearl,
  accentDeep,
  topbarInk,
  dark,
}) {
  return [
    { role: "sidebar-primary", fg: sidebarText, bg: sidebar, min: WCAG_AA.normalText },
    { role: "sidebar-meta", fg: sidebarMeta, bg: sidebar, min: WCAG_AA.normalText },
    { role: "sidebar-accent-icon", fg: sidebarIcon, bg: sidebar, min: WCAG_AA.ui },
    { role: "main-primary", fg: mainInk, bg: pearl, min: WCAG_AA.normalText },
    { role: "main-secondary", fg: mainSecondary, bg: pearl, min: WCAG_AA.normalText },
    { role: "main-link", fg: mainLink, bg: pearl, min: WCAG_AA.normalText },
    { role: "cta-on-accent", fg: "#FFFFFF", bg: accentDeep, min: WCAG_AA.normalText },
    { role: "sidebar-active-text", fg: "#FFFFFF", bg: accentDeep, min: WCAG_AA.normalText },
    { role: "topbar-text", fg: topbarInk, bg: pearl, min: WCAG_AA.normalText },
    { role: "dark:sidebar-primary", fg: dark.sidebarText, bg: dark.sidebar, min: WCAG_AA.normalText },
    { role: "dark:sidebar-meta", fg: dark.sidebarMeta, bg: dark.sidebar, min: WCAG_AA.normalText },
    { role: "dark:main-primary", fg: dark.ink, bg: dark.pearl, min: WCAG_AA.normalText },
    { role: "dark:main-secondary", fg: dark.secondary, bg: dark.pearl, min: WCAG_AA.normalText },
    { role: "dark:cta-on-accent", fg: "#FFFFFF", bg: dark.accentDeep, min: WCAG_AA.normalText },
  ];
}

export const PET_SOFT_ALL_CONTRAST_PAIRS = themeExamplePairs({
  sidebarText: "#3D2A22",
  sidebarMeta: "#7A5A4A",
  sidebarIcon: "#B84A32",
  sidebar: "#FFF5EB",
  mainInk: "#3D2A22",
  mainSecondary: "#6B4E42",
  mainLink: "#B84A32",
  pearl: "#FFFCF8",
  accentDeep: "#B84A32",
  topbarInk: "#4A342C",
  dark: {
    sidebarText: "#F8EDE6",
    sidebarMeta: "#D4B5A4",
    sidebar: "#241C18",
    ink: "#F8EDE6",
    secondary: "#D4B5A4",
    pearl: "#1C1614",
    accentDeep: "#B84A32",
  },
}).map((pair) => {
  if (pair.role === "sidebar-active-text") {
    return { role: "sidebar-active-text", fg: "#3D2A22", bg: "#F5D0C2", min: WCAG_AA.normalText };
  }
  return pair;
});

export const PET_SOFT_REQUIRED_CSS_HEX = [
  "#3D2A22",
  "#FFF5EB",
  "#FFFCF8",
  "#B84A32",
  "#7A5A4A",
  "#FFFFFF",
  "#F5D0C2",
  "#F8EDE6",
  "#1C1614",
  "#241C18",
];

export const PET_SOFT_CSS_STRUCTURE_RULES = themeExampleStructureRules("pet-soft", {
  activeTextHex: "#3D2A22",
});

export const CUTE_PASTEL_ALL_CONTRAST_PAIRS = themeExamplePairs({
  sidebarText: "#1F3D36",
  sidebarMeta: "#5A6E68",
  sidebarIcon: "#B34D6A",
  sidebar: "#E8F6F1",
  mainInk: "#3A2430",
  mainSecondary: "#6A4A58",
  mainLink: "#B34D6A",
  pearl: "#FFF9FB",
  accentDeep: "#B34D6A",
  topbarInk: "#4A3040",
  dark: {
    sidebarText: "#E8F6F1",
    sidebarMeta: "#B5D4C8",
    sidebar: "#14201C",
    ink: "#FFE8F0",
    secondary: "#D4A8B6",
    pearl: "#1A1418",
    accentDeep: "#B34D6A",
  },
}).map((pair) => {
  if (pair.role === "sidebar-active-text") {
    return { role: "sidebar-active-text", fg: "#3A2430", bg: "#F3C4D4", min: WCAG_AA.normalText };
  }
  return pair;
});

export const CUTE_PASTEL_REQUIRED_CSS_HEX = [
  "#1F3D36",
  "#E8F6F1",
  "#FFF9FB",
  "#B34D6A",
  "#5A6E68",
  "#FFFFFF",
  "#F3C4D4",
  "#1A1418",
  "#14201C",
];

export const CUTE_PASTEL_CSS_STRUCTURE_RULES = themeExampleStructureRules("cute-pastel", {
  activeTextHex: "#3A2430",
});

export const INK_BOOK_ALL_CONTRAST_PAIRS = themeExamplePairs({
  sidebarText: "#1C1917",
  sidebarMeta: "#57534E",
  sidebarIcon: "#9B2C1F",
  sidebar: "#F4EFE4",
  mainInk: "#1C1917",
  mainSecondary: "#57534E",
  mainLink: "#9B2C1F",
  pearl: "#FAF6EE",
  accentDeep: "#9B2C1F",
  topbarInk: "#292524",
  dark: {
    sidebarText: "#F5F0E6",
    sidebarMeta: "#A8A29E",
    sidebar: "#1C1917",
    ink: "#F5F0E6",
    secondary: "#A8A29E",
    pearl: "#161412",
    accentDeep: "#9B2C1F",
  },
}).map((pair) => {
  if (pair.role === "sidebar-active-text") {
    return { role: "sidebar-active-text", fg: "#1C1917", bg: "#E4D8C4", min: WCAG_AA.normalText };
  }
  return pair;
});

export const INK_BOOK_REQUIRED_CSS_HEX = [
  "#1C1917",
  "#F4EFE4",
  "#FAF6EE",
  "#9B2C1F",
  "#57534E",
  "#FFFFFF",
  "#E4D8C4",
  "#F5F0E6",
  "#161412",
];

export const INK_BOOK_CSS_STRUCTURE_RULES = themeExampleStructureRules("ink-book", {
  activeTextHex: "#1C1917",
});

export const OTOME_DIARY_ALL_CONTRAST_PAIRS = themeExamplePairs({
  sidebarText: "#3A2430",
  sidebarMeta: "#7A5A68",
  sidebarIcon: "#B04568",
  sidebar: "#FFF0F5",
  mainInk: "#3A2430",
  mainSecondary: "#6A4A58",
  mainLink: "#B04568",
  pearl: "#FFFCF9",
  accentDeep: "#B04568",
  topbarInk: "#4A3040",
  dark: {
    sidebarText: "#FFE8F0",
    sidebarMeta: "#D4A8B6",
    sidebar: "#22181E",
    ink: "#FFE8F0",
    secondary: "#D4A8B6",
    pearl: "#1A1418",
    accentDeep: "#B04568",
  },
}).map((pair) => {
  if (pair.role === "sidebar-active-text") {
    return { role: "sidebar-active-text", fg: "#3A2430", bg: "#F8D4DE", min: WCAG_AA.normalText };
  }
  return pair;
});

export const OTOME_DIARY_REQUIRED_CSS_HEX = [
  "#3A2430",
  "#FFF0F5",
  "#FFFCF9",
  "#B04568",
  "#7A5A68",
  "#FFFFFF",
  "#F8D4DE",
  "#FFE8F0",
  "#1A1418",
  "#22181E",
];

export const OTOME_DIARY_CSS_STRUCTURE_RULES = themeExampleStructureRules("otome-diary", {
  activeTextHex: "#3A2430",
});

export const RED_COMPACT_ALL_CONTRAST_PAIRS = themeExamplePairs({
  sidebarText: "#3F1D1D",
  sidebarMeta: "#8A5555",
  sidebarIcon: "#B91C1C",
  sidebar: "#FDF2F2",
  mainInk: "#3F1D1D",
  mainSecondary: "#7A4A4A",
  mainLink: "#B91C1C",
  pearl: "#FFFBFB",
  accentDeep: "#B91C1C",
  topbarInk: "#553030",
  dark: {
    sidebarText: "#FBEAEA",
    sidebarMeta: "#D9A8A8",
    sidebar: "#241414",
    ink: "#FBEAEA",
    secondary: "#D9A8A8",
    pearl: "#1A0F0F",
    accentDeep: "#B91C1C",
  },
});

export const RED_COMPACT_REQUIRED_CSS_HEX = [
  "#3F1D1D",
  "#FDF2F2",
  "#FFFBFB",
  "#B91C1C",
  "#8A5555",
  "#7A4A4A",
  "#553030",
  "#FFFFFF",
  "#FBEAEA",
  "#D9A8A8",
  "#1A0F0F",
  "#241414",
];

export const RED_COMPACT_CSS_STRUCTURE_RULES = themeExampleStructureRules("red-compact");

export const SUMMER_BREEZE_ALL_CONTRAST_PAIRS = themeExamplePairs({
  sidebarText: "#123A3F",
  sidebarMeta: "#3D6B73",
  sidebarIcon: "#0E7490",
  sidebar: "#E8F6F8",
  mainInk: "#123A3F",
  mainSecondary: "#3F6B72",
  mainLink: "#0E7490",
  pearl: "#FAFEFE",
  accentDeep: "#0E7490",
  topbarInk: "#1F4E55",
  dark: {
    sidebarText: "#E3F4F6",
    sidebarMeta: "#9CC8CE",
    sidebar: "#122426",
    ink: "#E3F4F6",
    secondary: "#9CC8CE",
    pearl: "#0C1A1C",
    accentDeep: "#0E7490",
  },
});

export const SUMMER_BREEZE_REQUIRED_CSS_HEX = [
  "#123A3F",
  "#E8F6F8",
  "#FAFEFE",
  "#0E7490",
  "#3D6B73",
  "#3F6B72",
  "#1F4E55",
  "#FFFFFF",
  "#E3F4F6",
  "#9CC8CE",
  "#0C1A1C",
  "#122426",
];

export const SUMMER_BREEZE_CSS_STRUCTURE_RULES = themeExampleStructureRules("summer-breeze");

export const AURORA_NIGHT_ALL_CONTRAST_PAIRS = themeExamplePairs({
  sidebarText: "#E8F0FF",
  sidebarMeta: "#9BB0D4",
  sidebarIcon: "#5EEAD4",
  sidebar: "#12182A",
  mainInk: "#E8F0FF",
  mainSecondary: "#A8B8D8",
  mainLink: "#5EEAD4",
  pearl: "#0B1220",
  accentDeep: "#0F766E",
  topbarInk: "#D7E3FF",
  dark: {
    sidebarText: "#E8F0FF",
    sidebarMeta: "#9BB0D4",
    sidebar: "#0E1422",
    ink: "#E8F0FF",
    secondary: "#9BB0D4",
    pearl: "#070B14",
    accentDeep: "#0F766E",
  },
});

export const AURORA_NIGHT_REQUIRED_CSS_HEX = [
  "#E8F0FF",
  "#9BB0D4",
  "#5EEAD4",
  "#12182A",
  "#0B1220",
  "#0F766E",
  "#A8B8D8",
  "#D7E3FF",
  "#FFFFFF",
  "#0E1422",
  "#070B14",
];

export const AURORA_NIGHT_CSS_STRUCTURE_RULES = themeExampleStructureRules("aurora-night");

export const FOREST_MIST_ALL_CONTRAST_PAIRS = themeExamplePairs({
  sidebarText: "#243528",
  sidebarMeta: "#4E6754",
  sidebarIcon: "#3F6B4F",
  sidebar: "#E7EFE6",
  mainInk: "#243528",
  mainSecondary: "#4E6754",
  mainLink: "#3F6B4F",
  pearl: "#F7FBF6",
  accentDeep: "#3F6B4F",
  topbarInk: "#2C4032",
  dark: {
    sidebarText: "#E4F0E6",
    sidebarMeta: "#A7C0AE",
    sidebar: "#1A241C",
    ink: "#E4F0E6",
    secondary: "#A7C0AE",
    pearl: "#121A14",
    accentDeep: "#3F6B4F",
  },
});

export const FOREST_MIST_REQUIRED_CSS_HEX = [
  "#243528",
  "#4E6754",
  "#3F6B4F",
  "#E7EFE6",
  "#F7FBF6",
  "#2C4032",
  "#FFFFFF",
  "#E4F0E6",
  "#A7C0AE",
  "#1A241C",
  "#121A14",
];

export const FOREST_MIST_CSS_STRUCTURE_RULES = themeExampleStructureRules("forest-mist");

export const COFFEE_LOFT_ALL_CONTRAST_PAIRS = themeExamplePairs({
  sidebarText: "#3A2A1C",
  sidebarMeta: "#7A5A42",
  sidebarIcon: "#6F4E37",
  sidebar: "#F3E8DA",
  mainInk: "#3A2A1C",
  mainSecondary: "#7A5A42",
  mainLink: "#6F4E37",
  pearl: "#FFF8F1",
  accentDeep: "#6F4E37",
  topbarInk: "#4A3424",
  dark: {
    sidebarText: "#F6EDE2",
    sidebarMeta: "#C9B09A",
    sidebar: "#241810",
    ink: "#F6EDE2",
    secondary: "#C9B09A",
    pearl: "#1A120C",
    accentDeep: "#8B5E3C",
  },
});

export const COFFEE_LOFT_REQUIRED_CSS_HEX = [
  "#3A2A1C",
  "#7A5A42",
  "#6F4E37",
  "#F3E8DA",
  "#FFF8F1",
  "#4A3424",
  "#FFFFFF",
  "#F6EDE2",
  "#C9B09A",
  "#241810",
  "#1A120C",
  "#8B5E3C",
];

export const COFFEE_LOFT_CSS_STRUCTURE_RULES = themeExampleStructureRules("coffee-loft");

export const NOIR_JAZZ_ALL_CONTRAST_PAIRS = themeExamplePairs({
  sidebarText: "#F2E6C9",
  sidebarMeta: "#C6A15B",
  sidebarIcon: "#C6A15B",
  sidebar: "#16151A",
  mainInk: "#F2E6C9",
  mainSecondary: "#C9B88A",
  mainLink: "#C6A15B",
  pearl: "#0E0E10",
  accentDeep: "#8A6A2F",
  topbarInk: "#F2E6C9",
  dark: {
    sidebarText: "#F2E6C9",
    sidebarMeta: "#C6A15B",
    sidebar: "#121116",
    ink: "#F2E6C9",
    secondary: "#C9B88A",
    pearl: "#0A0A0B",
    accentDeep: "#8A6A2F",
  },
});

export const NOIR_JAZZ_REQUIRED_CSS_HEX = [
  "#F2E6C9",
  "#C6A15B",
  "#16151A",
  "#0E0E10",
  "#8A6A2F",
  "#C9B88A",
  "#FFFFFF",
  "#121116",
  "#0A0A0B",
];

export const NOIR_JAZZ_CSS_STRUCTURE_RULES = themeExampleStructureRules("noir-jazz");

export const THEME_EXAMPLE_SKIN_AUDITS = [
  {
    id: "pet-soft",
    cssRelative: "integrations/openwork/wodeapp/wodeapp-skin-pet-soft.css",
    pairs: PET_SOFT_ALL_CONTRAST_PAIRS,
    requiredHexes: PET_SOFT_REQUIRED_CSS_HEX,
    structureRules: PET_SOFT_CSS_STRUCTURE_RULES,
  },
  {
    id: "cute-pastel",
    cssRelative: "integrations/openwork/wodeapp/wodeapp-skin-cute-pastel.css",
    pairs: CUTE_PASTEL_ALL_CONTRAST_PAIRS,
    requiredHexes: CUTE_PASTEL_REQUIRED_CSS_HEX,
    structureRules: CUTE_PASTEL_CSS_STRUCTURE_RULES,
  },
  {
    id: "ink-book",
    cssRelative: "integrations/openwork/wodeapp/wodeapp-skin-ink-book.css",
    pairs: INK_BOOK_ALL_CONTRAST_PAIRS,
    requiredHexes: INK_BOOK_REQUIRED_CSS_HEX,
    structureRules: INK_BOOK_CSS_STRUCTURE_RULES,
  },
  {
    id: "otome-diary",
    cssRelative: "integrations/openwork/wodeapp/wodeapp-skin-otome-diary.css",
    pairs: OTOME_DIARY_ALL_CONTRAST_PAIRS,
    requiredHexes: OTOME_DIARY_REQUIRED_CSS_HEX,
    structureRules: OTOME_DIARY_CSS_STRUCTURE_RULES,
  },
  {
    id: "red-compact",
    cssRelative: "integrations/openwork/wodeapp/wodeapp-skin-red-compact.css",
    pairs: RED_COMPACT_ALL_CONTRAST_PAIRS,
    requiredHexes: RED_COMPACT_REQUIRED_CSS_HEX,
    structureRules: RED_COMPACT_CSS_STRUCTURE_RULES,
  },
  {
    id: "summer-breeze",
    cssRelative: "integrations/openwork/wodeapp/wodeapp-skin-summer-breeze.css",
    pairs: SUMMER_BREEZE_ALL_CONTRAST_PAIRS,
    requiredHexes: SUMMER_BREEZE_REQUIRED_CSS_HEX,
    structureRules: SUMMER_BREEZE_CSS_STRUCTURE_RULES,
  },
  {
    id: "aurora-night",
    cssRelative: "integrations/openwork/wodeapp/wodeapp-skin-aurora-night.css",
    pairs: AURORA_NIGHT_ALL_CONTRAST_PAIRS,
    requiredHexes: AURORA_NIGHT_REQUIRED_CSS_HEX,
    structureRules: AURORA_NIGHT_CSS_STRUCTURE_RULES,
  },
  {
    id: "forest-mist",
    cssRelative: "integrations/openwork/wodeapp/wodeapp-skin-forest-mist.css",
    pairs: FOREST_MIST_ALL_CONTRAST_PAIRS,
    requiredHexes: FOREST_MIST_REQUIRED_CSS_HEX,
    structureRules: FOREST_MIST_CSS_STRUCTURE_RULES,
  },
  {
    id: "coffee-loft",
    cssRelative: "integrations/openwork/wodeapp/wodeapp-skin-coffee-loft.css",
    pairs: COFFEE_LOFT_ALL_CONTRAST_PAIRS,
    requiredHexes: COFFEE_LOFT_REQUIRED_CSS_HEX,
    structureRules: COFFEE_LOFT_CSS_STRUCTURE_RULES,
  },
  {
    id: "noir-jazz",
    cssRelative: "integrations/openwork/wodeapp/wodeapp-skin-noir-jazz.css",
    pairs: NOIR_JAZZ_ALL_CONTRAST_PAIRS,
    requiredHexes: NOIR_JAZZ_REQUIRED_CSS_HEX,
    structureRules: NOIR_JAZZ_CSS_STRUCTURE_RULES,
  },
];

export const SUPOR_REQUIRED_CSS_HEX = [
  "#FFFFFF",
  "#1A1A1A",
  "#F7F7F5",
  "#4A4A4A",
  "#FF6600",
  "#C24F00",
  "#B34700",
  // dark appearance tokens
  "#141413",
  "#1C1C1A",
  "#242422",
  "#F5F5F2",
  "#C9C9C4",
  "#FF8533",
  "#E8E8E3",
];

export const SUPOR_CSS_STRUCTURE_RULES = [
  {
    id: "active-recent-item-color",
    description:
      "Active recent row must set solid light color on .wapp-recent-item",
    test: (css) =>
      /\.wapp-recent-row\.is-active\s+\.wapp-recent-item\b[\s\S]{0,280}?color:\s*#(?:fff|ffffff)\b/i.test(
        css,
      ),
  },
  {
    id: "active-recent-descendant-color",
    description:
      "Active recent row must force light color on descendants (specificity gate). Marker: contrast-gate:active-recent",
    test: (css) =>
      /contrast-gate:active-recent/i.test(css) &&
      /\.wapp-recent-row\.is-active\s+\.wapp-recent-item\s+\*[\s\S]{0,200}?color:\s*#(?:fff|ffffff)\b/i.test(
        css,
      ),
  },
  {
    id: "hover-recent-item-color",
    description: "Hover recent row must set solid light color on .wapp-recent-item",
    test: (css) =>
      /\.wapp-recent-row:hover\s+\.wapp-recent-item\b[\s\S]{0,280}?color:\s*#(?:fff|ffffff)\b/i.test(
        css,
      ),
  },
  {
    id: "supor-dark-token-block",
    description:
      "Dark appearance must redefine Supor tokens under html[data-theme=dark]. Marker: contrast-gate:supor-dark",
    test: (css) =>
      /contrast-gate:supor-dark/i.test(css) &&
      /html\[data-theme=["']dark["']\][\s\S]{0,800}?--supor-ink:\s*#F5F5F2/i.test(css) &&
      /html\[data-theme=["']dark["']\][\s\S]{0,1200}?--supor-pearl:\s*#141413/i.test(css),
  },
];

/**
 * CSS must declare these patterns so descendant OpenWork styles cannot
 * keep dark text on the coral highlight (the screenshot failure mode).
 */
export const BEAUTY_CSS_STRUCTURE_RULES = [
  {
    id: "active-recent-item-color",
    description:
      "Active recent row must set solid light color on .wapp-recent-item",
    test: (css) =>
      /\.wapp-recent-row\.is-active\s+\.wapp-recent-item\b[\s\S]{0,280}?color:\s*#(?:fff|ffffff)\b/i.test(
        css,
      ),
  },
  {
    id: "active-recent-descendant-color",
    description:
      "Active recent row must force light color on descendants (specificity gate). Marker: contrast-gate:active-recent",
    test: (css) =>
      /contrast-gate:active-recent/i.test(css) &&
      /\.wapp-recent-row\.is-active\s+\.wapp-recent-item\s+\*[\s\S]{0,200}?color:\s*#(?:fff|ffffff)\b/i.test(
        css,
      ),
  },
  {
    id: "hover-recent-item-color",
    description: "Hover recent row must set solid light color on .wapp-recent-item",
    test: (css) =>
      /\.wapp-recent-row:hover\s+\.wapp-recent-item\b[\s\S]{0,280}?color:\s*#(?:fff|ffffff)\b/i.test(
        css,
      ),
  },
  {
    id: "no-rgba-sidebar-meta-token",
    description: "Sidebar meta token must be solid hex",
    test: (css) => !/--beauty-sidebar-meta:\s*rgba/i.test(css),
  },
];

/** Selectors sampled by live CDP acceptance. */
export const BEAUTY_LIVE_SAMPLE_SELECTORS = [
  { role: "cta-new-chat", sel: ".wapp-new-chat", min: WCAG_AA.normalText },
  { role: "nav-title", sel: ".wapp-nav-subitem-title", min: WCAG_AA.normalText },
  { role: "nav-meta", sel: ".wapp-nav-subitem-meta", min: WCAG_AA.normalText },
  { role: "sidebar-label", sel: ".wapp-sidebar-label", min: WCAG_AA.normalText },
  { role: "hero-title", sel: ".wapp-session-hero-strip h1", min: WCAG_AA.normalText },
  { role: "hero-body", sel: ".wapp-session-hero-strip p", min: WCAG_AA.normalText },
  { role: "hero-chip", sel: ".wapp-session-hero-chip", min: WCAG_AA.normalText },
  { role: "breadcrumb", sel: ".wapp-breadcrumb", min: WCAG_AA.normalText },
  {
    role: "recent-resting-title",
    sel: ".wapp-recent-row:not(.is-active) .wapp-recent-title",
    min: WCAG_AA.normalText,
    required: true,
  },
  {
    role: "recent-active-item",
    sel: ".wapp-recent-row.is-active .wapp-recent-item",
    min: WCAG_AA.normalText,
    required: false,
  },
  {
    // Regression: item can be white while .wapp-recent-title stays dark (specificity).
    role: "recent-active-title",
    sel: ".wapp-recent-row.is-active .wapp-recent-title",
    min: WCAG_AA.normalText,
    required: true,
  },
];

/**
 * Supor live samples — hero strip is often hidden on agents surface;
 * focus CTA / nav / breadcrumb / recent rows.
 */
export const SUPOR_LIVE_SAMPLE_SELECTORS = [
  { role: "cta-new-chat", sel: ".wapp-new-chat", min: WCAG_AA.normalText, required: true },
  { role: "nav-title", sel: ".wapp-nav-subitem-title", min: WCAG_AA.normalText, required: true },
  { role: "nav-meta", sel: ".wapp-nav-subitem-meta", min: WCAG_AA.normalText, required: false },
  { role: "sidebar-label", sel: ".wapp-sidebar-label", min: WCAG_AA.normalText, required: true },
  { role: "breadcrumb", sel: ".wapp-breadcrumb", min: WCAG_AA.normalText, required: true },
  { role: "breadcrumb-strong", sel: ".wapp-breadcrumb strong", min: WCAG_AA.normalText, required: true },
  { role: "help-button", sel: ".wapp-help-button", min: WCAG_AA.normalText, required: false },
  { role: "account-card", sel: ".wx-runtime-card", min: WCAG_AA.normalText, required: true },
  { role: "account-trigger", sel: ".wx-account-trigger", min: WCAG_AA.normalText, required: true },
  {
    // Outer composer shell is layout-only (transparent); contrast the visible card.
    role: "composer-strip",
    sel: ".wapp-session-surface .wapp-composer-shell .relative.overflow-visible.rounded-\\[24px\\], .wapp-session-surface .wapp-composer-dock .relative.overflow-visible.rounded-\\[24px\\], .wapp-session-surface .wapp-composer-dock-top .relative.overflow-visible.rounded-\\[24px\\]",
    min: WCAG_AA.normalText,
    required: true,
  },
  {
    role: "composer-card",
    sel: ".wapp-composer-dock .relative.overflow-visible.rounded-\\[24px\\], .wapp-composer-dock-top .relative.overflow-visible.rounded-\\[24px\\]",
    min: WCAG_AA.normalText,
    required: false,
  },
  {
    role: "recent-resting-title",
    sel: ".wapp-recent-row:not(.is-active) .wapp-recent-title",
    min: WCAG_AA.normalText,
    required: false,
  },
  {
    role: "recent-active-item",
    sel: ".wapp-recent-row.is-active .wapp-recent-item",
    min: WCAG_AA.normalText,
    required: false,
  },
  {
    role: "recent-active-title",
    sel: ".wapp-recent-row.is-active .wapp-recent-title",
    min: WCAG_AA.normalText,
    required: false,
  },
];

export const BEAUTY_REQUIRED_CSS_HEX = [
  "#1A1216",
  "#FFF5F2",
  "#FFF7F4",
  "#4A333B",
  "#9B2F42",
  "#F0D2D7",
  "#E0B8BF",
  "#FFFFFF",
];

export function parseHexColor(input) {
  const raw = String(input || "").trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) {
    throw new Error(`expected #RRGGBB, got ${input}`);
  }
  return {
    r: Number.parseInt(raw.slice(0, 2), 16),
    g: Number.parseInt(raw.slice(2, 4), 16),
    b: Number.parseInt(raw.slice(4, 6), 16),
  };
}

function channelToLinear(channel) {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex) {
  const { r, g, b } = parseHexColor(hex);
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  );
}

export function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

export function auditContrastPairs(pairs = BEAUTY_ALL_CONTRAST_PAIRS) {
  const results = pairs.map((pair) => {
    const ratio = contrastRatio(pair.fg, pair.bg);
    return {
      ...pair,
      ratio,
      pass: ratio + 1e-9 >= pair.min,
    };
  });
  return {
    ok: results.every((item) => item.pass),
    results,
  };
}

export function auditCssStructure(cssText, rules = BEAUTY_CSS_STRUCTURE_RULES) {
  const results = rules.map((rule) => ({
    id: rule.id,
    description: rule.description,
    pass: Boolean(rule.test(cssText)),
  }));
  return {
    ok: results.every((item) => item.pass),
    results,
  };
}

export function assertCssUsesTokens(cssText, requiredHexes = BEAUTY_REQUIRED_CSS_HEX) {
  const missing = [];
  const lower = String(cssText || "").toLowerCase();
  for (const hex of requiredHexes) {
    if (!lower.includes(hex.toLowerCase())) missing.push(hex);
  }
  return missing;
}

export function parseCssColorToHex(raw) {
  const text = String(raw || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text.toUpperCase();
  if (/^#[0-9a-fA-F]{3}$/.test(text)) {
    const r = text[1];
    const g = text[2];
    const b = text[3];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  const m = text.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!m) return null;
  const h = (n) => Number(n).toString(16).padStart(2, "0");
  return `#${h(m[1])}${h(m[2])}${h(m[3])}`.toUpperCase();
}

/**
 * Composite source-over: fg rgba over opaque bg hex → #RRGGBB
 */
export function compositeRgbaOverHex(fgRgba, bgHex) {
  const m = String(fgRgba || "").match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)/i,
  );
  if (!m) throw new Error(`expected rgba(...), got ${fgRgba}`);
  const alpha = m[4] === undefined ? 1 : Number(m[4]);
  const bg = parseHexColor(bgHex);
  const mix = (c, b) => Math.round(alpha * Number(c) + (1 - alpha) * b);
  const h = (n) => n.toString(16).padStart(2, "0");
  return `#${h(mix(m[1], bg.r))}${h(mix(m[2], bg.g))}${h(mix(m[3], bg.b))}`.toUpperCase();
}

export function auditLiveSamples(samples) {
  const results = (samples || []).map((sample) => {
    if (sample.missing) {
      return {
        ...sample,
        pass: sample.required === false,
        note: "missing",
      };
    }
    const fg = sample.fg || parseCssColorToHex(sample.colorRaw);
    const bg = sample.bg || parseCssColorToHex(sample.bgRaw);
    if (!fg || !bg) {
      return { ...sample, fg, bg, pass: false, note: "unparsed" };
    }
    const min = sample.min ?? WCAG_AA.normalText;
    const ratio = contrastRatio(fg, bg);
    return {
      ...sample,
      fg,
      bg,
      min,
      ratio,
      pass: ratio + 1e-9 >= min,
    };
  });
  return {
    ok: results.every((item) => item.pass !== false),
    results,
  };
}
