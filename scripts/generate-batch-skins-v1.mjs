#!/usr/bin/env node
/**
 * Emit the first batch of personalized WodeAppX workspace skins.
 * Re-run from the repository root: node wodeappx/scripts/generate-batch-skins-v1.mjs
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(scriptDir, "../integrations/openwork/wodeapp");

const skins = [
  {
    id: "aurora-night",
    short: "aurora",
    eyebrow: "AURORA NIGHT",
    title: "极光夜航",
    ink: "#E8F0FF",
    inkSoft: "#D7E3FF",
    secondary: "#A8B8D8",
    sidebar: "#12182A",
    sidebarText: "#E8F0FF",
    sidebarMeta: "#9BB0D4",
    sidebarIcon: "#5EEAD4",
    pearl: "#0B1220",
    panel: "#111B2F",
    accent: "#14B8A6",
    accentDeep: "#0F766E",
    accentHover: "#115E59",
    topbarInk: "#D7E3FF",
    ribbon: "linear-gradient(90deg, #14B8A6 0%, #8B5CF6 52%, #4338CA 100%)",
    sideImage: "/skin-aurora-night-side.jpg",
    sidebarWash: "linear-gradient(180deg, rgba(18, 24, 42, 0.48) 0%, rgba(11, 18, 32, 0.72) 100%)",
    dark: {
      ink: "#E8F0FF", inkSoft: "#D7E3FF", secondary: "#9BB0D4", sidebar: "#0E1422",
      sidebarText: "#E8F0FF", sidebarMeta: "#9BB0D4", pearl: "#070B14", panel: "#0D1728",
      topbarInk: "#D7E3FF", accentDeep: "#0F766E",
    },
    extra: `
/* Aurora: distant star field plus a slow polar wash. */
.wapp-skin-aurora-night .wapp-workspace-main::after {
  content: "";
  position: absolute;
  inset: 4px 0 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(circle at 14% 18%, #E8F0FF 0 1px, transparent 1.5px) 0 0 / 44px 44px,
    radial-gradient(circle at 76% 31%, #5EEAD4 0 1px, transparent 1.5px) 0 0 / 61px 61px,
    linear-gradient(128deg, rgba(20, 184, 166, 0.13), transparent 42%, rgba(139, 92, 246, 0.14));
  opacity: 0.7;
}
.wapp-skin-aurora-night .wapp-brand-spacer {
  background-image: linear-gradient(120deg, transparent 15%, rgba(94, 234, 212, 0.2), transparent 65%);
}
.wapp-skin-aurora-night .wapp-new-chat::after {
  content: "";
  width: 7px;
  height: 7px;
  margin-left: 8px;
  border-radius: 999px;
  background: #FFFFFF;
  box-shadow: 12px -4px 0 -2px #5EEAD4, -11px 3px 0 -3px #A8B8D8;
}`,
  },
  {
    id: "forest-mist",
    short: "forest",
    eyebrow: "FOREST MIST",
    title: "林间晨雾",
    ink: "#243528",
    inkSoft: "#2C4032",
    secondary: "#4E6754",
    sidebar: "#E7EFE6",
    sidebarText: "#243528",
    sidebarMeta: "#4E6754",
    sidebarIcon: "#3F6B4F",
    pearl: "#F7FBF6",
    panel: "#EDF5EC",
    accent: "#4E8060",
    accentDeep: "#3F6B4F",
    accentHover: "#31563E",
    topbarInk: "#2C4032",
    ribbon: "linear-gradient(90deg, #3F6B4F 0%, #F7FBF6 52%, #4E6754 100%)",
    sideImage: "/skin-forest-mist-side.jpg",
    sidebarWash: "linear-gradient(180deg, rgba(247, 251, 246, 0.42) 0%, rgba(231, 239, 230, 0.74) 100%)",
    dark: {
      ink: "#E4F0E6", inkSoft: "#D2E3D5", secondary: "#A7C0AE", sidebar: "#1A241C",
      sidebarText: "#E4F0E6", sidebarMeta: "#A7C0AE", pearl: "#121A14", panel: "#1E2A20",
      topbarInk: "#E4F0E6", accentDeep: "#3F6B4F",
    },
    extra: `
/* Forest: fog rises under the rail; a leaf marks the brand edge. */
.wapp-skin-forest-mist .wapp-sidebar::after {
  content: "";
  position: absolute;
  inset: auto 0 0;
  height: 118px;
  pointer-events: none;
  background: radial-gradient(ellipse at 25% 100%, rgba(247, 251, 246, 0.86), transparent 62%), radial-gradient(ellipse at 78% 100%, rgba(231, 239, 230, 0.9), transparent 58%);
  animation: wapp-forest-fog 10s ease-in-out infinite;
}
@keyframes wapp-forest-fog { 0%, 100% { opacity: .45; transform: translateY(8px); } 50% { opacity: .9; transform: translateY(-4px); } }
.wapp-skin-forest-mist .wapp-brand-spacer::before {
  padding-left: 28px;
  background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M20 3C10 3 4 8 4 17c7 0 13-5 16-14Z' fill='%233F6B4F' fill-opacity='.82'/%3E%3Cpath d='M5 18c4-4 8-7 13-10' fill='none' stroke='%23F7FBF6' stroke-width='1.2'/%3E%3C/svg%3E") left 4px center / 18px 18px no-repeat;
}
.wapp-skin-forest-mist .wapp-session-hero-chip { border-style: dashed; }`,
  },
  {
    id: "coffee-loft",
    short: "coffee",
    eyebrow: "COFFEE LOFT",
    title: "咖啡阁楼",
    ink: "#3A2A1C",
    inkSoft: "#4A3424",
    secondary: "#7A5A42",
    sidebar: "#F3E8DA",
    sidebarText: "#3A2A1C",
    sidebarMeta: "#7A5A42",
    sidebarIcon: "#6F4E37",
    pearl: "#FFF8F1",
    panel: "#F9EEDF",
    accent: "#8B5E3C",
    accentDeep: "#6F4E37",
    accentHover: "#4E3426",
    topbarInk: "#4A3424",
    ribbon: "linear-gradient(90deg, #6F4E37 0%, #FFF8F1 48%, #C69C6D 100%)",
    sideImage: "/skin-coffee-loft-side.jpg",
    sidebarWash: "linear-gradient(180deg, rgba(255, 248, 241, 0.45) 0%, rgba(243, 232, 218, 0.78) 100%)",
    dark: {
      ink: "#F6EDE2", inkSoft: "#E7D6C5", secondary: "#C9B09A", sidebar: "#241810",
      sidebarText: "#F6EDE2", sidebarMeta: "#C9B09A", pearl: "#1A120C", panel: "#2C1E14",
      topbarInk: "#F6EDE2", accentDeep: "#8B5E3C",
    },
    extra: `
/* Coffee: warm steam and architectural card corners. */
.wapp-skin-coffee-loft .wapp-sidebar::after {
  content: "";
  position: absolute;
  right: 20px;
  bottom: 26px;
  width: 68px;
  height: 112px;
  pointer-events: none;
  background: radial-gradient(ellipse at 35% 80%, rgba(255, 248, 241, 0.82) 0 9%, transparent 10%), radial-gradient(ellipse at 65% 47%, rgba(255, 248, 241, 0.68) 0 10%, transparent 11%), radial-gradient(ellipse at 35% 14%, rgba(255, 248, 241, 0.48) 0 10%, transparent 11%);
  filter: blur(4px);
  animation: wapp-coffee-steam 5.5s ease-in-out infinite;
}
@keyframes wapp-coffee-steam { 0%, 100% { opacity: .32; transform: translateY(6px) scaleX(.82); } 50% { opacity: .82; transform: translateY(-8px) scaleX(1.08); } }
.wapp-skin-coffee-loft .wapp-nav,
.wapp-skin-coffee-loft .wapp-recent { border-radius: 10px 18px 10px 18px; }
.wapp-skin-coffee-loft .wapp-brand-spacer { box-shadow: inset 0 -2px 0 #C69C6D; }`,
  },
  {
    id: "noir-jazz",
    short: "noir",
    eyebrow: "NOIR JAZZ",
    title: "午夜爵士",
    ink: "#F2E6C9",
    inkSoft: "#F2E6C9",
    secondary: "#C9B88A",
    sidebar: "#16151A",
    sidebarText: "#F2E6C9",
    sidebarMeta: "#C6A15B",
    sidebarIcon: "#C6A15B",
    pearl: "#0E0E10",
    panel: "#19181C",
    accent: "#A27D38",
    accentDeep: "#8A6A2F",
    accentHover: "#6B5220",
    topbarInk: "#F2E6C9",
    ribbon: "linear-gradient(90deg, #C6A15B 0%, #0E0E10 50%, #C6A15B 100%)",
    sideImage: "/skin-noir-jazz-side.jpg",
    sidebarWash: "linear-gradient(180deg, rgba(22, 21, 26, 0.5) 0%, rgba(14, 14, 16, 0.82) 100%)",
    dark: {
      ink: "#F2E6C9", inkSoft: "#F2E6C9", secondary: "#C9B88A", sidebar: "#121116",
      sidebarText: "#F2E6C9", sidebarMeta: "#C6A15B", pearl: "#0A0A0B", panel: "#161519",
      topbarInk: "#F2E6C9", accentDeep: "#8A6A2F",
    },
    extra: `
/* Noir: gold hairlines, vinyl grooves, and a tighter club composer. */
.wapp-skin-noir-jazz .wapp-workspace-main::after {
  content: "";
  position: absolute;
  inset: 4px 22px auto;
  height: 1px;
  z-index: 1;
  pointer-events: none;
  background: linear-gradient(90deg, transparent, #C6A15B 18%, #C6A15B 82%, transparent);
  opacity: .55;
}
.wapp-skin-noir-jazz .wapp-brand-spacer {
  background: repeating-radial-gradient(circle at 88% 52%, transparent 0 4px, rgba(198, 161, 91, .3) 4px 5px, transparent 5px 8px);
}
.wapp-skin-noir-jazz .wapp-composer { padding: 8px 10px; }
.wapp-skin-noir-jazz .wapp-session-hero-chip { border-color: #C6A15B; }`,
  },
];

function skinCss(s) {
  const p = `--wapp-${s.short}`;
  const shell = `.wapp-workspace-shell.wapp-skin-${s.id}`;
  const base = `.wapp-skin-${s.id}`;
  return `/**
 * WodeAppX personalized skin: ${s.id}
 * Generated by scripts/generate-batch-skins-v1.mjs. Do not hand-edit generated output.
 */

${shell} {
  ${p}-ink: ${s.ink};
  ${p}-ink-soft: ${s.inkSoft};
  ${p}-secondary: ${s.secondary};
  ${p}-sidebar: ${s.sidebar};
  ${p}-sidebar-text: ${s.sidebarText};
  ${p}-sidebar-meta: ${s.sidebarMeta};
  ${p}-sidebar-icon: ${s.sidebarIcon};
  ${p}-pearl: ${s.pearl};
  ${p}-panel: ${s.panel};
  ${p}-accent: ${s.accent};
  ${p}-accent-deep: ${s.accentDeep};
  ${p}-accent-hover: ${s.accentHover};
  ${p}-topbar-ink: ${s.topbarInk};
  ${p}-line: color-mix(in srgb, ${s.ink} 16%, transparent);
  ${p}-chip-border: color-mix(in srgb, ${s.ink} 20%, transparent);
  ${p}-scroll: ${s.secondary};
  ${p}-on-accent: #FFFFFF;
  background: var(${p}-pearl);
  color: var(${p}-ink);
}

${base} > .wapp-sidebar {
  position: relative;
  border-right: 1px solid var(${p}-line);
  background-color: var(${p}-sidebar) !important;
  background-image: ${s.sidebarWash}, url("${s.sideImage}");
  background-size: cover;
  background-position: center top;
  color: var(${p}-sidebar-text);
}
${base} > .wapp-sidebar-toggle { color: var(${p}-sidebar-meta); }
${base} > .wapp-sidebar-toggle:hover { background: color-mix(in srgb, var(${p}-accent-deep) 16%, transparent); color: var(${p}-sidebar-text); }
${base} > .wapp-workspace-main,
${base} .wapp-main-panel,
${base} .wapp-content { background: transparent; }
${base} .wapp-session-embed [data-slot="sidebar-inset"] { background: var(${p}-pearl); }

${base} .wapp-brand-mark,
${base} .wapp-new-chat,
${base} .wapp-surface-button.is-primary,
${base} .wapp-surface-toolbar-button.is-primary {
  background: var(${p}-accent-deep);
  color: #FFFFFF;
  border-color: var(${p}-accent-deep);
}
${base} .wapp-new-chat { border: 0; font-weight: 700; }
${base} .wapp-new-chat:hover:not(:disabled) { background: var(${p}-accent-hover); color: #FFFFFF; }
${base} .wapp-sidebar-scroll { scrollbar-color: var(${p}-scroll) transparent; }

${base} .wapp-nav,
${base} .wapp-recent {
  margin: 0 10px 10px;
  padding: 8px;
  border: 1px solid var(${p}-line);
  border-radius: 18px;
  background: color-mix(in srgb, var(${p}-sidebar) 88%, #FFFFFF);
}
${base} .wapp-nav-item,
${base} .wapp-nav-toggle,
${base} .wapp-nav-subitem,
${base} .wapp-recent-item,
${base} .wapp-recent-group-head,
${base} .wapp-nav-item span,
${base} .wapp-nav-subitem-title,
${base} .wapp-recent-title,
${base} .wapp-recent-item-head,
${base} .wapp-recent-group-title { color: var(${p}-sidebar-text); }
${base} .wapp-nav-subitem-meta,
${base} .wapp-recent-meta,
${base} .wapp-recent-count,
${base} .wapp-project-count { color: var(${p}-sidebar-meta); }
${base} .wapp-nav-item,
${base} .wapp-nav-subitem,
${base} .wapp-recent-item { border-radius: 999px; }
${base} .wapp-nav-item:hover,
${base} .wapp-nav-subitem:hover { background: color-mix(in srgb, var(${p}-accent-deep) 14%, var(${p}-sidebar)); color: var(${p}-sidebar-text); }
${base} .wapp-nav-item.is-active,
${base} .wapp-nav-subitem.is-active { background: color-mix(in srgb, var(${p}-accent-deep) 22%, var(${p}-sidebar)); box-shadow: inset 0 0 0 1px var(${p}-accent-deep); }
${base} .wapp-nav-icon,
${base} .wapp-sidebar-label,
${base} .wapp-sidebar-label-row .wapp-sidebar-label { color: var(${p}-sidebar-icon); }

${base} .wapp-recent-row:hover .wapp-recent-item,
${base} .wapp-recent-row.is-active .wapp-recent-item {
  background: ${s.accentDeep};
  color: #FFFFFF;
}
/* contrast-gate:active-recent */
${base} .wapp-recent-row.is-active .wapp-recent-item *,
${base} .wapp-recent-row:hover .wapp-recent-item * { color: #FFFFFF; }
${base} .wapp-recent-row.is-active .wapp-recent-action-trigger,
${base} .wapp-recent-row:hover .wapp-recent-action-trigger { color: #FFFFFF !important; }

${base} .wapp-topbar { border-bottom-color: var(${p}-line); background: color-mix(in srgb, var(${p}-pearl) 78%, transparent); }
${base} .wapp-breadcrumb { color: var(${p}-secondary); }
${base} .wapp-breadcrumb strong { color: var(${p}-topbar-ink); }
${base} .wapp-breadcrumb-link { color: var(${p}-ink-soft); }
${base} .wapp-breadcrumb-link:hover,
${base} .wapp-breadcrumb-link:focus-visible { color: var(${p}-accent-deep); }
${base} .wapp-help-button,
${base} .wapp-mobile-button,
${base} .wapp-icon-button {
  border-color: var(${p}-line) !important;
  background: var(${p}-pearl);
  color: var(${p}-accent-deep);
}
${base} .wapp-help-button.is-primary-outline { border-color: var(${p}-accent-deep) !important; color: var(${p}-accent-deep); }
${base} .wx-mention-kind-row button.is-active,
${base} .wapp-service-settings-preset.is-active {
  border-color: var(${p}-accent-deep);
  background: var(${p}-panel);
  box-shadow: inset 0 0 0 1px var(${p}-accent-deep);
}

${base} .wapp-brand-spacer {
  display: grid;
  align-content: end;
  height: 96px;
  margin: 0 4px 10px;
  border-bottom: 1px solid var(${p}-line);
}
${base} .wapp-brand-spacer::before {
  content: "${s.eyebrow}";
  display: block;
  padding: 8px 6px 4px;
  color: var(${p}-sidebar-meta);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .18em;
}
${base} .wapp-brand-spacer::after {
  content: "${s.title}";
  display: block;
  padding: 2px 6px 12px;
  color: var(${p}-sidebar-icon);
  font-size: 22px;
  font-weight: 650;
  letter-spacing: .03em;
  line-height: 1.1;
}

${base} .wapp-workspace-main,
${base} .wapp-conversation-workspace-main { position: relative; }
${base} .wapp-workspace-main::before,
${base} .wapp-conversation-workspace-main::before {
  content: "";
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  z-index: 5;
  height: 4px;
  pointer-events: none;
  background: ${s.ribbon};
}

${base} .wapp-session-surface {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  background: transparent;
  color: var(${p}-ink);
}
${base} .wapp-session-surface > *:not(.wapp-${s.short}-ambient-backdrop) {
  position: relative;
  z-index: 1;
}
.wapp-${s.short}-ambient-backdrop {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
}
.wapp-${s.short}-ambient-backdrop video,
.wapp-${s.short}-ambient-backdrop img { display: block; width: 100%; height: 100%; object-fit: cover; filter: saturate(1.15) brightness(1.12); }
.wapp-${s.short}-ambient-backdrop::after {
  content: "";
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, color-mix(in srgb, ${s.pearl} 28%, transparent), color-mix(in srgb, ${s.pearl} 44%, transparent));
}
${base} > .wapp-workspace-main {
  isolation: isolate;
  overflow: hidden;
}
${base} > .wapp-workspace-main > :not(.wapp-${s.short}-ambient-backdrop) {
  position: relative;
  z-index: 1;
}
.wapp-${s.short}-ambient-backdrop.is-main-stage { pointer-events: none; }
${base} .wapp-content main,
${base} .wapp-workspace-main-inner main,
${base} .wapp-stage main {
  background-color: transparent !important;
  background-image: none !important;
}

${base} .wapp-session-surface-top-composer { background: transparent; }
${base} .wapp-session-hero-chip { border-color: var(${p}-chip-border); background: var(${p}-panel); color: var(${p}-ink); }
${base} .wapp-msg-user {
  border: 1px solid var(${p}-accent-deep);
  border-radius: 20px;
  background: var(${p}-panel);
  color: var(${p}-ink);
}
${base} .wapp-composer { border-radius: 20px; }
${base} .wapp-composer:focus-within {
  border-color: var(${p}-accent-deep);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(${p}-accent-deep) 25%, transparent);
}
${base} .wapp-composer-dock-top .relative.overflow-visible.rounded-\\[24px\\],
${base} .wapp-composer-dock .relative.overflow-visible.rounded-\\[24px\\] {
  border-color: var(${p}-line);
  background: var(${p}-panel);
}
${base} .wapp-session-rail,
${base} aside.wapp-session-rail {
  background: var(${p}-panel);
  border-left-color: var(${p}-line);
  color: var(${p}-ink);
}
${shell}.is-sidebar-collapsed { grid-template-columns: 0 minmax(0,1fr); }

${s.extra}

/* contrast-gate:${s.id}-dark */
html[data-theme="dark"] ${shell} {
  ${p}-ink: ${s.dark.ink};
  ${p}-ink-soft: ${s.dark.inkSoft};
  ${p}-secondary: ${s.dark.secondary};
  ${p}-sidebar: ${s.dark.sidebar};
  ${p}-sidebar-text: ${s.dark.sidebarText};
  ${p}-sidebar-meta: ${s.dark.sidebarMeta};
  ${p}-sidebar-icon: ${s.sidebarIcon};
  ${p}-pearl: ${s.dark.pearl};
  ${p}-panel: ${s.dark.panel};
  ${p}-accent-deep: ${s.dark.accentDeep};
  ${p}-topbar-ink: ${s.dark.topbarInk};
  ${p}-line: color-mix(in srgb, ${s.dark.ink} 18%, transparent);
  ${p}-chip-border: color-mix(in srgb, ${s.dark.ink} 24%, transparent);
}
html[data-theme="dark"] ${base} > .wapp-sidebar {
  background-image: linear-gradient(180deg, color-mix(in srgb, ${s.dark.pearl} 72%, transparent), color-mix(in srgb, ${s.dark.sidebar} 88%, transparent)), url("${s.sideImage}");
}
html[data-theme="dark"] ${base} .wapp-nav,
html[data-theme="dark"] ${base} .wapp-recent { background: color-mix(in srgb, var(${p}-sidebar) 90%, #000000); }
html[data-theme="dark"] .wapp-${s.short}-ambient-backdrop::after {
  background: linear-gradient(180deg, color-mix(in srgb, ${s.dark.pearl} 32%, transparent), color-mix(in srgb, ${s.dark.pearl} 48%, transparent));
}
html[data-theme="dark"] ${base} .wapp-msg-user { background: var(${p}-panel); color: var(${p}-ink); }
html[data-theme="dark"] ${base} .wapp-help-button.is-primary-outline { background: var(${p}-pearl); }

@media (prefers-reduced-motion: reduce) {
  ${base} .wapp-sidebar::after { animation: none; }
}
`;
}

await mkdir(outputDir, { recursive: true });
for (const skin of skins) {
  const outputPath = resolve(outputDir, `wodeapp-skin-${skin.id}.css`);
  await writeFile(outputPath, skinCss(skin), "utf8");
  console.log(`wrote ${outputPath}`);
}
