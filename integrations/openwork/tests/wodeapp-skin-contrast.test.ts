import { describe, expect, test } from "bun:test";

import {
  BEAUTY_ALL_CONTRAST_PAIRS,
  BEAUTY_CSS_STRUCTURE_RULES,
  PET_SOFT_ALL_CONTRAST_PAIRS,
  CUTE_PASTEL_ALL_CONTRAST_PAIRS,
  INK_BOOK_ALL_CONTRAST_PAIRS,
  SUPOR_ALL_CONTRAST_PAIRS,
  SUPOR_CSS_STRUCTURE_RULES,
  SUPOR_SKIN_DARK_CONTRAST_PAIRS,
  auditContrastPairs,
  auditCssStructure,
  auditLiveSamples,
  compositeRgbaOverHex,
  contrastRatio,
} from "../../../scripts/lib/skin-contrast.mjs";

const CSS_WITHOUT_ACTIVE_DESCENDANT_GATE = `
.wapp-skin-beauty .wapp-recent-row.is-active .wapp-recent-item {
  background: rgba(155, 47, 66, 0.45);
  color: #FFFFFF;
}
.wapp-skin-beauty .wapp-recent-row:hover .wapp-recent-item {
  color: #FFFFFF;
}
--beauty-sidebar-meta: #E0B8BF;
`;

const CSS_WITH_ACTIVE_DESCENDANT_GATE = `
.wapp-skin-beauty .wapp-recent-row.is-active .wapp-recent-item {
  background: rgba(155, 47, 66, 0.45);
  color: #FFFFFF;
}
/* contrast-gate:active-recent */
.wapp-skin-beauty .wapp-recent-row.is-active .wapp-recent-item,
.wapp-skin-beauty .wapp-recent-row.is-active .wapp-recent-item * {
  color: #FFFFFF;
}
.wapp-skin-beauty .wapp-recent-row:hover .wapp-recent-item {
  color: #FFFFFF;
}
--beauty-sidebar-meta: #E0B8BF;
`;

describe("skin contrast acceptance", () => {
  test("all registered beauty pairs meet WCAG AA", () => {
    const audit = auditContrastPairs(BEAUTY_ALL_CONTRAST_PAIRS);
    expect(audit.results.filter((item) => !item.pass)).toEqual([]);
    expect(audit.ok).toBe(true);
  });

  test("example theme skins meet WCAG AA", () => {
    for (const pairs of [
      PET_SOFT_ALL_CONTRAST_PAIRS,
      CUTE_PASTEL_ALL_CONTRAST_PAIRS,
      INK_BOOK_ALL_CONTRAST_PAIRS,
    ]) {
      const audit = auditContrastPairs(pairs);
      expect(audit.results.filter((item) => !item.pass)).toEqual([]);
      expect(audit.ok).toBe(true);
    }
  });

  test("all registered supor light+dark pairs meet WCAG AA", () => {
    const audit = auditContrastPairs(SUPOR_ALL_CONTRAST_PAIRS);
    expect(audit.results.filter((item) => !item.pass)).toEqual([]);
    expect(audit.ok).toBe(true);
  });

  test("supor dark pairs are registered and meet AA", () => {
    expect(SUPOR_SKIN_DARK_CONTRAST_PAIRS.length).toBeGreaterThanOrEqual(10);
    const audit = auditContrastPairs(SUPOR_SKIN_DARK_CONTRAST_PAIRS);
    expect(audit.ok).toBe(true);
  });

  test("known strong pair stays high", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeGreaterThan(20);
  });

  test("composited active highlight matches contract bg", () => {
    expect(compositeRgbaOverHex("rgba(155, 47, 66, 0.45)", "#1A1216")).toBe("#541F2A");
    expect(compositeRgbaOverHex("rgba(155, 47, 66, 0.35)", "#1A1216")).toBe("#471C25");
  });

  test("structure rules include active-recent descendant gate", () => {
    expect(BEAUTY_CSS_STRUCTURE_RULES.some((r) => r.id === "active-recent-descendant-color")).toBe(
      true,
    );
    expect(SUPOR_CSS_STRUCTURE_RULES.some((r) => r.id === "supor-dark-token-block")).toBe(true);
  });

  test("structure auditor rejects CSS missing descendant force-color", () => {
    const audit = auditCssStructure(CSS_WITHOUT_ACTIVE_DESCENDANT_GATE);
    expect(audit.ok).toBe(false);
    expect(
      audit.results.find((r) => r.id === "active-recent-descendant-color")?.pass,
    ).toBe(false);
  });

  test("structure auditor accepts CSS with contrast-gate:active-recent", () => {
    const audit = auditCssStructure(CSS_WITH_ACTIVE_DESCENDANT_GATE);
    expect(audit.results.filter((r) => !r.pass)).toEqual([]);
    expect(audit.ok).toBe(true);
  });

  test("live sample auditor fails dark-on-dark active row", () => {
    const audit = auditLiveSamples([
      {
        role: "recent-active",
        required: true,
        fg: "#541F2A",
        bg: "#541F2A",
        min: 4.5,
      },
    ]);
    expect(audit.ok).toBe(false);
  });

  test("live sample auditor passes white on active highlight", () => {
    const audit = auditLiveSamples([
      {
        role: "recent-active",
        required: true,
        fg: "#FFFFFF",
        bg: "#541F2A",
        min: 4.5,
      },
    ]);
    expect(audit.ok).toBe(true);
  });
});
