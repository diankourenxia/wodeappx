import { describe, expect, test } from "bun:test";

import {
  addWodeAppPlazaItems,
  coercePlazaCatalog,
  generatePlazaSkinCss,
  listWodeAppPlazaItems,
  mergeBrandAgentsWithPlaza,
  parsePlazaUpload,
  plazaItemToPack,
  sanitizePlazaCss,
  slugifyPlazaId,
  toPlazaSkinId,
} from "../wodeapp/wodeapp-plaza";
import { WODEAPP_BRAND_AGENT_INDUSTRY_EXAMPLE } from "../wodeapp/wodeapp-brand-agent-config";

describe("custom plaza packs", () => {
  test("parses a brand-agent JSON upload", () => {
    const parsed = parsePlazaUpload({
      wodeappxPlaza: 1,
      kind: "agent",
      name: "调研助手",
      description: "整理资料",
      agent: {
        id: "research-notes-agent",
        name: "调研助手",
        brandId: "research",
        entryPrompt: "帮我整理这份调研",
      },
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.kind).toBe("agent");
    expect(parsed.items[0]?.agent?.id).toBe("research-notes-agent");
    expect(parsed.items[0]?.agent?.name).toBe("调研助手");
  });

  test("parses a raw brand-agents file with multiple agents", () => {
    const parsed = parsePlazaUpload({
      version: 1,
      agents: [WODEAPP_BRAND_AGENT_INDUSTRY_EXAMPLE],
    });
    expect(parsed.ok).toBe(true);
    expect(parsed.items[0]?.id).toBe("outdoor-gear-industry-agent");
  });

  test("parses a skin pack and generates scoped CSS", () => {
    const parsed = parsePlazaUpload({
      wodeappxPlaza: 1,
      kind: "skin",
      name: "松绿工作台",
      skin: {
        preview: {
          sidebar: "#E8F1EE",
          main: "#FBFCFB",
          accent: "#2A7A6A",
          topbar: "#FBFCFB",
        },
      },
    });
    expect(parsed.ok).toBe(true);
    const skin = parsed.items[0]?.skin;
    expect(skin?.id.startsWith("plaza-")).toBe(true);
    expect(skin?.css).toContain(`wapp-skin-${skin?.id}`);
    expect(skin?.css).toContain("contrast-gate:active-recent");
    expect(skin?.css).toContain("#2A7A6A");
  });

  test("rejects empty and non-json uploads", () => {
    expect(parsePlazaUpload("").ok).toBe(false);
    expect(parsePlazaUpload("{").ok).toBe(false);
    expect(parsePlazaUpload({ hello: true }).ok).toBe(false);
  });

  test("strips unsafe CSS before applying a custom skin", () => {
    const css = sanitizePlazaCss("@import url('https://evil.test'); body { behavior: url(x); } .ok { color: red; }");
    expect(css).not.toContain("@import");
    expect(css).not.toContain("behavior:");
    expect(css).toContain(".ok { color: red; }");
  });

  test("slugifies chinese names and prefixes plaza skin ids", () => {
    expect(slugifyPlazaId("松绿工作台")).toMatch(/^item-[a-z0-9]+$/);
    expect(toPlazaSkinId("Mint Desk")).toBe("plaza-mint-desk");
  });

  test("merges plaza agents into brand-agents without dropping others", () => {
    const merged = mergeBrandAgentsWithPlaza(
      [WODEAPP_BRAND_AGENT_INDUSTRY_EXAMPLE],
      {
        id: "research-notes-agent",
        name: "调研助手",
        brandId: "research",
        enabled: true,
      },
    );
    expect(merged.agents.map((item) => item.id)).toEqual([
      "outdoor-gear-industry-agent",
      "research-notes-agent",
    ]);
  });

  test("round-trips a pack through export JSON", () => {
    const parsed = parsePlazaUpload({
      wodeappxPlaza: 1,
      kind: "agent",
      agent: WODEAPP_BRAND_AGENT_INDUSTRY_EXAMPLE,
      name: WODEAPP_BRAND_AGENT_INDUSTRY_EXAMPLE.name,
    });
    expect(parsed.ok).toBe(true);
    const pack = plazaItemToPack(parsed.items[0]!);
    const again = parsePlazaUpload(JSON.stringify(pack));
    expect(again.ok).toBe(true);
    expect(again.items[0]?.id).toBe("outdoor-gear-industry-agent");
  });

  test("generated skin css keeps collapsed sidebar from leaving a blank column", () => {
    const id = toPlazaSkinId("pine-desk");
    const css = generatePlazaSkinCss(id, {
      sidebar: "#E8F1EE",
      main: "#FBFCFB",
      accent: "#2A7A6A",
      topbar: "#FBFCFB",
    });
    expect(css).toContain(`${id}.is-sidebar-collapsed`);
    expect(css).toContain("grid-template-columns: 0 minmax(0, 1fr)");
  });

  test("empty disk catalog stays empty instead of seeding examples", () => {
    expect(coercePlazaCatalog({ version: 1, items: [] })).toEqual([]);
    expect(coercePlazaCatalog(null)).toEqual([]);
    expect(listWodeAppPlazaItems({ version: 1, items: [] })).toEqual([]);
    expect(listWodeAppPlazaItems().some((item) => item.source === "example")).toBe(true);
  });

  test("add to an in-memory catalog replaces the same id", () => {
    const first = parsePlazaUpload({
      wodeappxPlaza: 1,
      kind: "agent",
      agent: { id: "demo-agent", name: "Demo", brandId: "demo" },
      name: "Demo",
    });
    const updated = parsePlazaUpload({
      wodeappxPlaza: 1,
      kind: "agent",
      agent: { id: "demo-agent", name: "Demo 2", brandId: "demo" },
      name: "Demo 2",
    });
    expect(first.ok && updated.ok).toBe(true);
    const next = addWodeAppPlazaItems(first.items, updated.items);
    expect(next).toHaveLength(1);
    expect(next[0]?.name).toBe("Demo 2");
  });
});
