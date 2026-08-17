#!/usr/bin/env node
/**
 * Static skin contrast acceptance (token pairs + CSS structure).
 *
 * Usage:
 *   node wodeappx/scripts/check-skin-contrast.mjs
 *   node wodeappx/scripts/check-skin-contrast.mjs --json
 *
 * Live computed-style gate (when desktop CDP is up):
 *   node wodeappx/scripts/check-skin-contrast-live.mjs
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const {
  BEAUTY_ALL_CONTRAST_PAIRS,
  BEAUTY_REQUIRED_CSS_HEX,
  BEAUTY_CSS_STRUCTURE_RULES,
  SUPOR_ALL_CONTRAST_PAIRS,
  SUPOR_REQUIRED_CSS_HEX,
  SUPOR_CSS_STRUCTURE_RULES,
  THEME_EXAMPLE_SKIN_AUDITS,
  auditContrastPairs,
  auditCssStructure,
  assertCssUsesTokens,
} = await import(pathToFileURL(path.join(root, "scripts/lib/skin-contrast.mjs")).href);

const asJson = process.argv.includes("--json");

function auditSkin({ id, cssRelative, pairs, requiredHexes, structureRules }) {
  const cssPath = path.join(root, cssRelative);
  const cssText = readFileSync(cssPath, "utf8");
  const pairAudit = auditContrastPairs(pairs);
  const structure = auditCssStructure(cssText, structureRules);
  const missingCss = assertCssUsesTokens(cssText, requiredHexes);
  return {
    id,
    ok: pairAudit.ok && structure.ok && missingCss.length === 0,
    pairs: pairAudit.results.map((item) => ({
      role: item.role,
      fg: item.fg,
      bg: item.bg,
      min: item.min,
      ratio: Number(item.ratio.toFixed(2)),
      pass: item.pass,
    })),
    structure: structure.results,
    missingCssTokens: missingCss,
  };
}

const skins = [
  auditSkin({
    id: "beauty",
    cssRelative: "integrations/openwork/wodeapp/wodeapp-skin-beauty.css",
    pairs: BEAUTY_ALL_CONTRAST_PAIRS,
    requiredHexes: BEAUTY_REQUIRED_CSS_HEX,
    structureRules: BEAUTY_CSS_STRUCTURE_RULES,
  }),
  auditSkin({
    id: "supor",
    cssRelative: "integrations/openwork/wodeapp/wodeapp-skin-supor.css",
    pairs: SUPOR_ALL_CONTRAST_PAIRS,
    requiredHexes: SUPOR_REQUIRED_CSS_HEX,
    structureRules: SUPOR_CSS_STRUCTURE_RULES,
  }),
  ...THEME_EXAMPLE_SKIN_AUDITS.map((skin) =>
    auditSkin({
      id: skin.id,
      cssRelative: skin.cssRelative,
      pairs: skin.pairs,
      requiredHexes: skin.requiredHexes,
      structureRules: skin.structureRules,
    }),
  ),
];

const ok = skins.every((skin) => skin.ok);
const payload = {
  ok,
  layer: "static",
  standard: "WCAG 2.2 AA",
  skins,
  next:
    "Also run live gate when desktop is up: node wodeappx/scripts/check-skin-contrast-live.mjs",
};

if (asJson) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} else {
  console.log(`Skin contrast static audit (${payload.standard})`);
  for (const skin of skins) {
    console.log(`\n[${skin.id}]`);
    for (const row of skin.pairs) {
      console.log(
        `  [${row.pass ? "PASS" : "FAIL"}] pair ${row.role}: ${row.fg} on ${row.bg} → ${row.ratio}:1 (min ${row.min})`,
      );
    }
    for (const row of skin.structure) {
      console.log(`  [${row.pass ? "PASS" : "FAIL"}] css ${row.id}: ${row.description}`);
    }
    if (skin.missingCssTokens.length) {
      console.log(`  Missing solid tokens in wodeapp-skin-${skin.id}.css:`);
      for (const hex of skin.missingCssTokens) console.log(`  - ${hex}`);
    }
  }
  console.log(ok ? "\nOK" : "\nFAILED");
  if (!ok) {
    console.log("Hint: fix contract in CSS, then re-run. Live CDP gate still required for specificity.");
  }
}

process.exit(ok ? 0 : 1);
