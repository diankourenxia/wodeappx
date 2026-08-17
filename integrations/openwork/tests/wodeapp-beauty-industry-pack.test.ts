import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  WODEAPP_BEAUTY_INDUSTRY_AGENT_ID,
  WODEAPP_BEAUTY_INDUSTRY_PACK,
  findWodeAppIndustryPack,
} from "../wodeapp/wodeapp-industry-packs";
import {
  buildWodeAppRuntimeProfileSystemContext,
  setWodeAppRuntimeProfilesFromBrandAgents,
  findWodeAppRuntimeProfile,
  __testing,
} from "../wodeapp/wodeapp-runtime-profile";
import { WODEAPP_DEFAULT_SKIN_ID } from "../wodeapp/wodeapp-skins";
import { WODEAPP_NAV_ITEMS } from "../wodeapp/wodeapp-types";

describe("beauty shell theme (self-evolve demo)", () => {
  test("ships beauty pack and skin without replacing default agents", () => {
    const pack = findWodeAppIndustryPack(WODEAPP_BEAUTY_INDUSTRY_AGENT_ID);
    expect(pack).not.toBeNull();
    expect(pack?.recommendedSkills).toContain("wodeappx-beauty-industry");
    expect(WODEAPP_BEAUTY_INDUSTRY_PACK.policy.some((line) => /clinical|功效|medical/i.test(line))).toBe(true);
    expect(WODEAPP_DEFAULT_SKIN_ID).toBe("default");
    expect(WODEAPP_NAV_ITEMS.find((item) => item.id === "agents")?.label).toBe("默认智能体");
  });

  test("registers beauty profile from pack for theme routing metadata", () => {
    __testing.reset();
    setWodeAppRuntimeProfilesFromBrandAgents([]);
    const live = findWodeAppRuntimeProfile(WODEAPP_BEAUTY_INDUSTRY_AGENT_ID);
    expect(live?.brandId).toBe("beauty");
    const context = buildWodeAppRuntimeProfileSystemContext(live);
    expect(context).toContain("Playbook:");
    expect(context).toContain("wodeappx-beauty-industry");
  });

  test("edition manifest is theme-only", () => {
    const manifestPath = join(
      import.meta.dir,
      "../skills/wodeappx-beauty-industry/edition.manifest.json",
    );
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      kind: string;
      shell: { skinId: string; note?: string };
      hideSidebarKinds: string[];
    };
    expect(manifest.kind).toBe("product-shell-adaptation");
    expect(manifest.shell.skinId).toBe("beauty");
    expect(manifest.shell.note || "").toMatch(/Theme\/layout only/i);
    expect(manifest.hideSidebarKinds).toContain("industry");
    expect((manifest.shell as { enabledAgentIds?: string[] }).enabledAgentIds).toBeUndefined();
  });
});
