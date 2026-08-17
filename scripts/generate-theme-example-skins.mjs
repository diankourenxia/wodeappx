#!/usr/bin/env node
/**
 * Generates example theme skins (pet / cute / ink-book / otome-diary) CSS into
 * integrations/openwork/wodeapp/. Re-run after palette tweaks.
 *
 *   node wodeappx/scripts/generate-theme-example-skins.mjs
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "integrations/openwork/wodeapp");

/** @typedef {{
 *  id: string,
 *  label: string,
 *  brandEyebrow: string,
 *  brandTitle: string,
 *  sidebarMode: "light" | "dark",
 *  decor: "paw" | "dots" | "ink" | "none",
 *  layout: "pet" | "cute" | "book",
 *  sidebarWidth: string,
 *  t: Record<string, string>,
 *  dark: Record<string, string>,
 * }} ThemeSpec */

/** @type {ThemeSpec[]} */
const THEMES = [
  {
    id: "pet-soft",
    label: "萌宠柔光",
    brandEyebrow: "PET SOFT",
    brandTitle: "萌宠柔光",
    sidebarMode: "light",
    decor: "paw",
    layout: "pet",
    sidebarWidth: "288px",
    t: {
      ink: "#3D2A22",
      inkSoft: "#4A342C",
      secondary: "#6B4E42",
      accent: "#E07A5F",
      accentDeep: "#B84A32",
      accentHover: "#A8432C",
      pearl: "#FFFCF8",
      pearlDeep: "#FFF5EB",
      sidebar: "#FFF5EB",
      sidebarText: "#3D2A22",
      sidebarSecondary: "#B84A32",
      sidebarMeta: "#7A5A4A",
      sidebarIcon: "#B84A32",
      panel: "#FFF8F2",
      line: "rgba(61, 42, 34, 0.12)",
      chipBorder: "rgba(61, 42, 34, 0.16)",
      onAccent: "#FFFFFF",
      scroll: "#D4B5A4",
    },
    dark: {
      ink: "#F8EDE6",
      inkSoft: "#F0D9CE",
      secondary: "#D4B5A4",
      pearl: "#1C1614",
      pearlDeep: "#241C18",
      sidebar: "#241C18",
      sidebarText: "#F8EDE6",
      sidebarSecondary: "#FF9B7A",
      sidebarMeta: "#D4B5A4",
      sidebarIcon: "#FF9B7A",
      panel: "#2A211C",
      accentDeep: "#B84A32",
      accentHover: "#A8432C",
      onAccent: "#FFFFFF",
    },
  },
  {
    id: "cute-pastel",
    label: "可爱马卡龙",
    brandEyebrow: "CUTE",
    brandTitle: "马卡龙",
    sidebarMode: "light",
    decor: "dots",
    layout: "cute",
    sidebarWidth: "320px",
    t: {
      ink: "#3A2430",
      inkSoft: "#4A3040",
      secondary: "#6A4A58",
      accent: "#DB6B8A",
      accentDeep: "#B34D6A",
      accentHover: "#A84460",
      pearl: "#FFF9FB",
      pearlDeep: "#FFE8F0",
      sidebar: "#E8F6F1",
      sidebarText: "#1F3D36",
      sidebarSecondary: "#B34D6A",
      sidebarMeta: "#5A6E68",
      sidebarIcon: "#B34D6A",
      panel: "#F2FBF7",
      line: "rgba(58, 36, 48, 0.12)",
      chipBorder: "rgba(58, 36, 48, 0.14)",
      onAccent: "#FFFFFF",
      scroll: "#B5D4C8",
    },
    dark: {
      ink: "#FFE8F0",
      inkSoft: "#F5D0DC",
      secondary: "#D4A8B6",
      pearl: "#1A1418",
      pearlDeep: "#22181E",
      sidebar: "#14201C",
      sidebarText: "#E8F6F1",
      sidebarSecondary: "#FF9BB4",
      sidebarMeta: "#B5D4C8",
      sidebarIcon: "#FF9BB4",
      panel: "#241C22",
      accentDeep: "#B34D6A",
      accentHover: "#A84460",
      onAccent: "#FFFFFF",
    },
  },
  {
    id: "ink-book",
    label: "水墨书卷",
    brandEyebrow: "INK BOOK",
    brandTitle: "水墨书卷",
    sidebarMode: "light",
    decor: "ink",
    layout: "book",
    sidebarWidth: "268px",
    t: {
      ink: "#1C1917",
      inkSoft: "#292524",
      secondary: "#57534E",
      accent: "#B4533C",
      accentDeep: "#9B2C1F",
      accentHover: "#7F1D1D",
      pearl: "#FAF6EE",
      pearlDeep: "#F4EFE4",
      sidebar: "#F4EFE4",
      sidebarText: "#1C1917",
      sidebarSecondary: "#9B2C1F",
      sidebarMeta: "#57534E",
      sidebarIcon: "#9B2C1F",
      panel: "#F7F1E6",
      line: "rgba(28, 25, 23, 0.12)",
      chipBorder: "rgba(28, 25, 23, 0.16)",
      onAccent: "#FFFFFF",
      scroll: "#A8A29E",
    },
    dark: {
      ink: "#F5F0E6",
      inkSoft: "#E7E0D4",
      secondary: "#A8A29E",
      pearl: "#161412",
      pearlDeep: "#1C1917",
      sidebar: "#1C1917",
      sidebarText: "#F5F0E6",
      sidebarSecondary: "#F0A090",
      sidebarMeta: "#A8A29E",
      sidebarIcon: "#F0A090",
      panel: "#221E1B",
      accentDeep: "#9B2C1F",
      accentHover: "#7F1D1D",
      onAccent: "#FFFFFF",
    },
  },
  {
    id: "otome-diary",
    label: "蔷薇日记",
    brandEyebrow: "ROSE",
    brandTitle: "蔷薇工作台",
    sidebarMode: "light",
    decor: "dots",
    layout: "pet",
    sidebarWidth: "288px",
    t: {
      ink: "#3A2430",
      inkSoft: "#4A3040",
      secondary: "#6A4A58",
      accent: "#DB6B8A",
      accentDeep: "#B04568",
      accentHover: "#963A58",
      pearl: "#FFFCF9",
      pearlDeep: "#FFF0F5",
      sidebar: "#FFF0F5",
      sidebarText: "#3A2430",
      sidebarSecondary: "#B04568",
      sidebarMeta: "#7A5A68",
      sidebarIcon: "#B04568",
      panel: "#FFF6F9",
      line: "rgba(58, 36, 48, 0.12)",
      chipBorder: "rgba(58, 36, 48, 0.14)",
      onAccent: "#FFFFFF",
      scroll: "#E0B8C4",
    },
    dark: {
      ink: "#FFE8F0",
      inkSoft: "#F5D0DC",
      secondary: "#D4A8B6",
      pearl: "#1A1418",
      pearlDeep: "#22181E",
      sidebar: "#22181E",
      sidebarText: "#FFE8F0",
      sidebarSecondary: "#FF9BB4",
      sidebarMeta: "#D4A8B6",
      sidebarIcon: "#FF9BB4",
      panel: "#2A1C24",
      accentDeep: "#B04568",
      accentHover: "#963A58",
      onAccent: "#FFFFFF",
    },
  },
];

function decorBlock(id, decor) {
  if (decor === "paw") {
    return `
.wapp-skin-${id} .wapp-session-surface::after {
  content: "";
  position: absolute;
  z-index: 0;
  pointer-events: none;
  right: 18px;
  bottom: 72px;
  width: 120px;
  height: 120px;
  opacity: 0.14;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'%3E%3Cellipse cx='60' cy='72' rx='22' ry='18' fill='%23B84A32'/%3E%3Ccircle cx='38' cy='48' r='10' fill='%23B84A32'/%3E%3Ccircle cx='55' cy='38' r='10' fill='%23B84A32'/%3E%3Ccircle cx='75' cy='40' r='10' fill='%23B84A32'/%3E%3Ccircle cx='88' cy='54' r='9' fill='%23B84A32'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-size: contain;
}`;
  }
  if (decor === "dots") {
    return `
.wapp-skin-${id} .wapp-session-surface::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: 0.22;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48' viewBox='0 0 48 48'%3E%3Ccircle cx='8' cy='10' r='3' fill='%23B34D6A' fill-opacity='0.2'/%3E%3Ccircle cx='28' cy='26' r='2.5' fill='%231F3D36' fill-opacity='0.12'/%3E%3C/svg%3E");
  background-size: 48px 48px;
}`;
  }
  if (decor === "ink") {
    return `
.wapp-skin-${id} .wapp-session-surface::before {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  opacity: 0.35;
  background:
    linear-gradient(90deg, rgba(28, 25, 23, 0.06) 0%, transparent 18%, transparent 82%, rgba(28, 25, 23, 0.05) 100%),
    linear-gradient(180deg, rgba(250, 246, 238, 0.2), transparent 30%);
}`;
  }
  return "";
}

/** Structural layout remakes — not just recolor. */
function layoutBlock(spec) {
  const { id, layout, t, sidebarWidth } = spec;
  const tok = (name) => `var(--wapp-${id}-${name})`;

  if (layout === "pet") {
    return `
/* layout:pet — Codex-style global floating companion (details in theme-align) */
.wapp-skin-${id} .wapp-theme-pet-buddy {
  display: flex;
  position: fixed;
  z-index: 920;
  right: 16px;
  bottom: 24px;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: auto;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: ${tok("ink")};
  box-shadow: none;
  pointer-events: auto;
}
.wapp-skin-${id} .wapp-theme-pet-buddy-face {
  display: none;
}
.wapp-skin-${id} .wapp-theme-pet-buddy-label {
  display: none !important;
}
.wapp-skin-${id} .wapp-theme-pet-buddy strong {
  font-size: 13px;
  font-weight: 700;
}
.wapp-skin-${id} .wapp-theme-pet-buddy span {
  color: ${tok("secondary")};
  font-size: 11px;
  line-height: 1.35;
}
.wapp-skin-${id} .wapp-nav,
.wapp-skin-${id} .wapp-sidebar-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0 2px 10px;
  padding: 10px;
  border: 1px solid ${tok("line")};
  border-radius: 18px;
  background: color-mix(in srgb, ${tok("pearl")} 70%, ${tok("sidebar")});
}
.wapp-skin-${id} .wapp-recent-item,
.wapp-skin-${id} .wapp-nav-item,
.wapp-skin-${id} .wapp-nav-subitem {
  border-radius: 999px;
  min-height: 40px;
}
.wapp-skin-${id} .wapp-workspace-main-inner {
  max-width: none;
  width: 100%;
  margin-inline: 0;
}
.wapp-skin-${id} .wapp-session-surface {
  max-width: 920px;
  margin-inline: auto;
}
.wapp-skin-${id} .wapp-brand-spacer {
  height: 92px;
}`;
  }

  if (layout === "cute") {
    return `
/* layout:cute — wide soft rail + ribbon + bubbly controls */
.wapp-skin-${id} .wapp-theme-cute-ribbon {
  display: flex;
  position: absolute;
  z-index: 30;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  align-items: center;
  gap: 10px;
  padding: 8px 16px;
  border-radius: 999px;
  background: ${tok("panel")};
  border: 1px solid ${tok("line")};
  color: ${tok("ink")};
  pointer-events: none;
}
.wapp-skin-${id} .wapp-theme-cute-ribbon strong {
  font-size: 12px;
}
.wapp-skin-${id} .wapp-theme-cute-ribbon span {
  color: ${tok("secondary")};
  font-size: 11px;
}
.wapp-skin-${id} > .wapp-workspace-main {
  padding-top: 44px;
}
.wapp-skin-${id} .wapp-new-chat {
  border-radius: 999px;
  min-height: 48px;
}
.wapp-skin-${id} .wapp-nav-item,
.wapp-skin-${id} .wapp-recent-item {
  border-radius: 18px;
  min-height: 44px;
}
.wapp-skin-${id} .wapp-sidebar-scroll {
  gap: 14px;
}
.wapp-skin-${id} .wapp-session-hero-chip {
  border-radius: 22px;
}`;
  }

  if (layout === "book") {
    return `
/* layout:book — rice-paper rail + open-book chat (no top ribbon) */
.wapp-workspace-shell.wapp-skin-${id} {
  grid-template-rows: minmax(0, 1fr);
  grid-template-columns: ${sidebarWidth} minmax(0, 1fr);
}
.wapp-skin-${id} > .wapp-theme-ink-book {
  display: none !important;
}
.wapp-skin-${id} > .wapp-sidebar,
.wapp-skin-${id} > .wapp-workspace-main,
.wapp-skin-${id} > .wapp-sidebar-toggle {
  grid-row: 1;
}
.wapp-skin-${id} .wapp-brand-spacer {
  height: 96px;
}
.wapp-skin-${id} .wapp-new-chat {
  border-radius: 4px;
  min-height: 42px;
}
.wapp-skin-${id} .wapp-nav-item,
.wapp-skin-${id} .wapp-recent-item,
.wapp-skin-${id} .wapp-nav-subitem {
  border-radius: 4px;
  min-height: 36px;
}
.wapp-skin-${id} .wapp-workspace-main-inner {
  max-width: none;
  width: 100%;
  margin-inline: 0;
}
.wapp-skin-${id} .wapp-session-surface {
  max-width: 960px;
  margin-inline: auto;
}`;
  }

  return "";
}

/** @param {ThemeSpec} spec */
function buildCss(spec) {
  const { id, brandEyebrow, brandTitle, sidebarMode, decor, t, dark, sidebarWidth } = spec;
  const tok = (name) => `var(--wapp-${id}-${name})`;

  const rootVars = Object.entries({
    ink: t.ink,
    "ink-soft": t.inkSoft,
    secondary: t.secondary,
    accent: t.accent,
    "accent-deep": t.accentDeep,
    "accent-hover": t.accentHover,
    pearl: t.pearl,
    "pearl-deep": t.pearlDeep,
    sidebar: t.sidebar,
    "sidebar-text": t.sidebarText,
    "sidebar-secondary": t.sidebarSecondary,
    "sidebar-meta": t.sidebarMeta,
    "sidebar-icon": t.sidebarIcon,
    panel: t.panel,
    line: t.line,
    "chip-border": t.chipBorder,
    "on-accent": t.onAccent,
    scroll: t.scroll,
  })
    .map(([k, val]) => `  --wapp-${id}-${k}: ${val};`)
    .join("\n");

  const darkVars = Object.entries({
    ink: dark.ink,
    "ink-soft": dark.inkSoft,
    secondary: dark.secondary,
    pearl: dark.pearl,
    "pearl-deep": dark.pearlDeep,
    sidebar: dark.sidebar,
    "sidebar-text": dark.sidebarText,
    "sidebar-secondary": dark.sidebarSecondary,
    "sidebar-meta": dark.sidebarMeta,
    "sidebar-icon": dark.sidebarIcon,
    panel: dark.panel,
    "accent-deep": dark.accentDeep,
    "accent-hover": dark.accentHover,
    "on-accent": dark.onAccent,
  })
    .map(([k, val]) => `  --wapp-${id}-${k}: ${val};`)
    .join("\n");

  const shellBg =
    sidebarMode === "dark"
      ? `linear-gradient(165deg, ${t.pearl} 0%, ${t.pearlDeep} 55%, ${t.panel} 100%)`
      : `radial-gradient(900px 420px at 78% -8%, color-mix(in srgb, ${t.accent} 12%, transparent), transparent 55%), linear-gradient(165deg, ${t.pearl} 0%, ${t.pearlDeep} 50%, ${t.panel} 100%)`;

  const activeInk =
    sidebarMode === "light"
      ? id === "cute-pastel" || id === "otome-diary"
        ? "#3A2430"
        : id === "ink-book"
          ? "#1C1917"
          : "#3D2A22"
      : "#FFFFFF";
  const activeBg =
    sidebarMode === "light"
      ? id === "cute-pastel"
        ? "#F3C4D4"
        : id === "otome-diary"
          ? "#F8D4DE"
          : id === "ink-book"
            ? "#E4D8C4"
            : "#F5D0C2"
      : null;
  const hoverBg =
    sidebarMode === "light"
      ? id === "cute-pastel"
        ? "#F8D7E2"
        : id === "otome-diary"
          ? "#FBE4EB"
          : id === "ink-book"
            ? "#EDE4D4"
            : "#F8E0D6"
      : null;

  const interactiveBlock =
    sidebarMode === "light"
      ? `.wapp-skin-${id} .wapp-nav-item:hover,
.wapp-skin-${id} .wapp-nav-subitem:hover,
.wapp-skin-${id} .wapp-recent-row:hover .wapp-recent-item {
  background: ${hoverBg};
  color: ${activeInk};
}

.wapp-skin-${id} .wapp-nav-item.is-active,
.wapp-skin-${id} .wapp-nav-subitem.is-active,
.wapp-skin-${id} .wapp-recent-row.is-active .wapp-recent-item {
  background: ${activeBg};
  color: ${activeInk};
  box-shadow: inset 0 0 0 1px ${t.accent};
}

.wapp-skin-${id} .wapp-nav-item.is-active span,
.wapp-skin-${id} .wapp-nav-subitem.is-active .wapp-nav-subitem-title,
.wapp-skin-${id} .wapp-nav-item:hover span,
.wapp-skin-${id} .wapp-nav-subitem:hover .wapp-nav-subitem-title {
  color: ${activeInk};
}

/* contrast-gate:active-recent */
.wapp-skin-${id} .wapp-recent-row.is-active .wapp-recent-item,
.wapp-skin-${id} .wapp-recent-row.is-active .wapp-recent-item *,
.wapp-skin-${id} .wapp-recent-row:hover .wapp-recent-item,
.wapp-skin-${id} .wapp-recent-row:hover .wapp-recent-item * {
  color: ${activeInk};
}`
      : `.wapp-skin-${id} .wapp-nav-item:hover,
.wapp-skin-${id} .wapp-nav-subitem:hover,
.wapp-skin-${id} .wapp-recent-row:hover .wapp-recent-item {
  background: ${tok("accent-hover")};
  color: #FFFFFF;
}

.wapp-skin-${id} .wapp-nav-item.is-active,
.wapp-skin-${id} .wapp-nav-subitem.is-active,
.wapp-skin-${id} .wapp-recent-row.is-active .wapp-recent-item {
  background: ${tok("accent-deep")};
  color: #FFFFFF;
}

.wapp-skin-${id} .wapp-nav-item.is-active span,
.wapp-skin-${id} .wapp-nav-subitem.is-active .wapp-nav-subitem-title,
.wapp-skin-${id} .wapp-nav-item:hover span,
.wapp-skin-${id} .wapp-nav-subitem:hover .wapp-nav-subitem-title {
  color: #FFFFFF;
}

/* contrast-gate:active-recent */
.wapp-skin-${id} .wapp-recent-row.is-active .wapp-recent-item,
.wapp-skin-${id} .wapp-recent-row.is-active .wapp-recent-item *,
.wapp-skin-${id} .wapp-recent-row:hover .wapp-recent-item,
.wapp-skin-${id} .wapp-recent-row:hover .wapp-recent-item * {
  color: #FFFFFF;
}`;

  return `/**
 * Example theme skin: ${spec.label} (${id})
 * Generated by scripts/generate-theme-example-skins.mjs — edit palette there and re-run.
 * Contrast: scripts/lib/skin-contrast.mjs + check:skin-contrast
 * Layout profile: ${spec.layout} (structure remake, not recolor-only)
 *
 * Theme chrome (pets / ribbon / stage) is mount/unmount by React — do not emit
 * unscoped global display:none for .wapp-theme-* here (causes cross-skin wars).
 */

.wapp-workspace-shell.wapp-skin-${id} {
${rootVars}
  position: relative;
  grid-template-columns: ${sidebarWidth} minmax(0, 1fr);
  background: ${shellBg};
  color: ${tok("ink")};
}

.wapp-workspace-shell.wapp-skin-${id}.is-sidebar-collapsed {
  grid-template-columns: 0 minmax(0, 1fr);
}

.wapp-skin-${id} .wapp-nav-agent-group-label {
  display: none !important;
}

.wapp-skin-${id} > .wapp-sidebar {
  position: relative;
  z-index: 5;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  border-right: 1px solid ${tok("line")};
  background-color: ${tok("sidebar")} !important;
  color: ${tok("sidebar-text")};
  contain: paint;
}

.wapp-skin-${id} > .wapp-sidebar-toggle {
  color: ${tok("sidebar-meta")};
}

.wapp-skin-${id} > .wapp-sidebar-toggle:hover {
  background: color-mix(in srgb, ${tok("accent-deep")} 12%, transparent);
  color: ${tok("sidebar-text")};
}

.wapp-skin-${id} > .wapp-workspace-main {
  position: relative;
  z-index: 1;
  background: transparent;
  overflow: hidden;
  isolation: isolate;
  contain: paint;
}

.wapp-skin-${id} .wapp-main-panel,
.wapp-skin-${id} .wapp-content,
.wapp-skin-${id} .wapp-session-embed [data-slot="sidebar-inset"] {
  background: transparent;
}

.wapp-skin-${id} .wapp-sidebar-top {
  padding: 14px 14px 0;
}

.wapp-skin-${id} .wapp-brand-spacer {
  display: grid;
  align-content: end;
  height: 78px;
  margin: 0 4px 10px;
  border-bottom: 1px solid ${tok("line")};
}

.wapp-skin-${id} .wapp-brand-spacer::before {
  display: block;
  padding: 8px 4px 0;
  content: "${brandEyebrow}";
  color: ${tok("sidebar-secondary")};
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
}

.wapp-skin-${id} .wapp-brand-spacer::after {
  display: block;
  padding: 4px 4px 12px;
  content: "${brandTitle}";
  color: ${tok("sidebar-text")};
  font-size: 22px;
  font-weight: 650;
  letter-spacing: 0.02em;
  line-height: 1.1;
}

.wapp-skin-${id} .wapp-new-chat {
  width: calc(100% - 8px);
  min-height: 44px;
  margin: 8px 4px 12px;
  border: 0;
  border-radius: ${sidebarMode === "light" ? "14px" : "8px"};
  background: ${t.accentDeep};
  color: #FFFFFF;
  font-weight: 700;
}

.wapp-skin-${id} .wapp-new-chat:hover {
  background: ${t.accentHover};
  color: #FFFFFF;
}

.wapp-skin-${id} .wapp-sidebar-scroll {
  padding: 0 10px 16px;
  background-color: ${tok("sidebar")};
  scrollbar-color: ${tok("scroll")} transparent;
}

.wapp-skin-${id} .wapp-nav-item,
.wapp-skin-${id} .wapp-nav-toggle,
.wapp-skin-${id} .wapp-nav-subitem,
.wapp-skin-${id} .wapp-recent-item,
.wapp-skin-${id} .wapp-recent-group-head {
  border-radius: 10px;
  color: ${tok("sidebar-text")};
}

.wapp-skin-${id} .wapp-nav-item span,
.wapp-skin-${id} .wapp-nav-subitem-title,
.wapp-skin-${id} .wapp-recent-title,
.wapp-skin-${id} .wapp-recent-item-head,
.wapp-skin-${id} .wapp-recent-group-title {
  color: ${tok("sidebar-text")};
}

.wapp-skin-${id} .wapp-nav-subitem-meta,
.wapp-skin-${id} .wapp-recent-meta,
.wapp-skin-${id} .wapp-recent-count,
.wapp-skin-${id} .wapp-project-count {
  color: ${tok("sidebar-meta")};
}

${interactiveBlock}

.wapp-skin-${id} .wapp-nav-icon {
  color: ${tok("sidebar-icon")};
}

.wapp-skin-${id} .wapp-sidebar-label,
.wapp-skin-${id} .wapp-sidebar-label-row .wapp-sidebar-label {
  color: ${tok("sidebar-secondary")};
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.wapp-skin-${id} .wapp-topbar {
  min-height: 48px;
  border-bottom: 1px solid ${tok("line")};
  background: color-mix(in srgb, ${tok("pearl")} 92%, transparent);
}

.wapp-skin-${id} .wapp-breadcrumb,
.wapp-skin-${id} .wapp-breadcrumb strong,
.wapp-skin-${id} .wapp-breadcrumb-link {
  color: ${tok("ink-soft")};
}

.wapp-skin-${id} .wapp-help-button,
.wapp-skin-${id} .wapp-mobile-button,
.wapp-skin-${id} .wapp-icon-button {
  border-color: ${tok("line")} !important;
  background: ${tok("pearl")};
  color: ${tok("accent-deep")};
}

.wapp-skin-${id} .wapp-session-surface {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  background: ${tok("pearl")};
  color: ${tok("ink")};
}

.wapp-skin-${id} .wapp-session-surface > * {
  position: relative;
  z-index: 1;
}
${decorBlock(id, decor)}

.wapp-skin-${id} .wapp-session-surface-top-composer .wapp-session-hero-strip h1 {
  color: ${tok("ink")};
}

.wapp-skin-${id} .wapp-session-surface-top-composer .wapp-session-hero-strip p {
  color: ${tok("secondary")};
}

.wapp-skin-${id} .wapp-session-hero-chip {
  border: 1px solid ${tok("chip-border")};
  background: ${tok("panel")};
  color: ${tok("ink")};
}

.wapp-skin-${id} .wx-runtime-card,
.wapp-skin-${id} .wapp-session-surface .shrink-0.px-0.pb-2.pt-2 {
  background: ${tok("pearl")} !important;
  color: ${tok("ink")};
}

.wapp-skin-${id} .wapp-composer-dock-top .relative.overflow-visible {
  background: ${tok("panel")};
  border-color: ${tok("line")};
}

/* contrast-gate:${id}-dark */
html[data-theme="dark"] .wapp-workspace-shell.wapp-skin-${id} {
${darkVars}
}
${layoutBlock(spec)}
`;
}

for (const theme of THEMES) {
  const file = path.join(outDir, `wodeapp-skin-${theme.id}.css`);
  writeFileSync(file, buildCss(theme), "utf8");
  console.log("wrote", path.relative(root, file));
}

// Emit JSON palette contract for contrast.mjs hand-sync hint
writeFileSync(
  path.join(root, "docs/examples/skin-theme-palettes.json"),
  `${JSON.stringify(
    THEMES.map((theme) => ({
      id: theme.id,
      label: theme.label,
      preview: {
        sidebar: theme.t.sidebar,
        main: theme.t.pearl,
        accent: theme.t.accentDeep,
        topbar: theme.t.pearl,
      },
      light: theme.t,
      dark: theme.dark,
    })),
    null,
    2,
  )}\n`,
  "utf8",
);
console.log("wrote docs/examples/skin-theme-palettes.json");
