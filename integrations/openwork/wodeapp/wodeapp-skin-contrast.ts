/**
 * Skin contrast gate — WCAG AA for user-visible text/UI.
 * Runtime truth: ../../scripts/lib/skin-contrast.mjs
 * Acceptance:
 *   node wodeappx/scripts/check-skin-contrast.mjs
 *   node wodeappx/scripts/check-skin-contrast-live.mjs
 */

export {
  WCAG_AA,
  BEAUTY_SKIN_CONTRAST_PAIRS,
  BEAUTY_SKIN_INTERACTIVE_PAIRS,
  BEAUTY_ALL_CONTRAST_PAIRS,
  BEAUTY_CSS_STRUCTURE_RULES,
  BEAUTY_LIVE_SAMPLE_SELECTORS,
  BEAUTY_REQUIRED_CSS_HEX,
  SUPOR_SKIN_CONTRAST_PAIRS,
  SUPOR_SKIN_INTERACTIVE_PAIRS,
  SUPOR_SKIN_DARK_CONTRAST_PAIRS,
  SUPOR_ALL_CONTRAST_PAIRS,
  SUPOR_REQUIRED_CSS_HEX,
  SUPOR_CSS_STRUCTURE_RULES,
  SUPOR_LIVE_SAMPLE_SELECTORS,
  parseHexColor,
  relativeLuminance,
  contrastRatio,
  auditContrastPairs,
  auditCssStructure,
  assertCssUsesTokens,
  parseCssColorToHex,
  compositeRgbaOverHex,
  auditLiveSamples,
} from "../../../scripts/lib/skin-contrast.mjs";
