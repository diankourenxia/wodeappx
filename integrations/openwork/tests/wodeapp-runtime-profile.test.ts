import { afterEach, describe, expect, test } from "bun:test";

import { WODEAPP_BRAND_AGENT_INDUSTRY_EXAMPLE, WODEAPP_BRAND_AGENT_WYNNE_EXAMPLE } from "../wodeapp/wodeapp-brand-agent-config";
import {
  WODEAPP_WYNNE_RUNTIME_PROFILE_ID,
  bindWodeAppRuntimeProfileToSession,
  buildWodeAppRuntimeProfileSystemContext,
  clearWodeAppRuntimeProfileForSession,
  findWodeAppRuntimeProfile,
  listWodeAppRuntimeProfiles,
  readWodeAppRuntimeProfileForSession,
  setWodeAppRuntimeProfilesFromBrandAgents,
  wodeAppRuntimeProfileAgentId,
  __testing,
} from "../wodeapp/wodeapp-runtime-profile";

afterEach(() => {
  __testing.reset();
});

describe("WodeApp runtime profiles", () => {
  test("binds a configured brand profile to a real conversation without embedding knowledge", () => {
    setWodeAppRuntimeProfilesFromBrandAgents([WODEAPP_BRAND_AGENT_WYNNE_EXAMPLE]);

    expect(bindWodeAppRuntimeProfileToSession(
      "workspace-1",
      "session-1",
      WODEAPP_WYNNE_RUNTIME_PROFILE_ID,
    )).toBe(true);

    const profile = readWodeAppRuntimeProfileForSession("workspace-1", "session-1");
    expect(profile?.id).toBe(WODEAPP_WYNNE_RUNTIME_PROFILE_ID);
    expect(wodeAppRuntimeProfileAgentId(profile)).toBe(WODEAPP_WYNNE_RUNTIME_PROFILE_ID);

    const context = buildWodeAppRuntimeProfileSystemContext(profile);
    expect(context).toContain('profile="wynne-brand-agent"');
    expect(context).toContain("knowledge_search");
    expect(context).toContain("only report a connector as connected after a live status tool confirms it");
    expect(context).not.toContain("128");
    expect(context).not.toContain("Avery");
  });

  test("uses the normal selected agent when no runtime profile is active", () => {
    expect(wodeAppRuntimeProfileAgentId(null)).toBeUndefined();
  });

  test("fails closed for unknown profiles", () => {
    expect(findWodeAppRuntimeProfile("unknown-profile")).toBeNull();
    expect(bindWodeAppRuntimeProfileToSession("workspace-1", "session-1", "unknown-profile")).toBe(false);
  });

  test("exposes beauty pack profile by default and clears a session binding", () => {
    setWodeAppRuntimeProfilesFromBrandAgents([]);
    const shippedIds = listWodeAppRuntimeProfiles().map((profile) => profile.id);
    expect(shippedIds).toContain("beauty-industry-agent");
    expect(shippedIds).not.toContain("home-textile-industry-agent");
    expect(shippedIds).not.toContain(WODEAPP_WYNNE_RUNTIME_PROFILE_ID);

    const beauty = findWodeAppRuntimeProfile("beauty-industry-agent");
    expect(beauty?.identity).toContain("美妆");
    expect(beauty?.recommendedSkills).toContain("wodeappx-beauty-industry");

    setWodeAppRuntimeProfilesFromBrandAgents([WODEAPP_BRAND_AGENT_WYNNE_EXAMPLE]);
    expect(listWodeAppRuntimeProfiles().map((profile) => profile.id))
      .toContain(WODEAPP_WYNNE_RUNTIME_PROFILE_ID);

    bindWodeAppRuntimeProfileToSession("workspace-1", "session-1", WODEAPP_WYNNE_RUNTIME_PROFILE_ID);
    expect(clearWodeAppRuntimeProfileForSession("workspace-1", "session-1")).toBe(true);
    expect(readWodeAppRuntimeProfileForSession("workspace-1", "session-1")).toBeNull();
  });

  test("registers Layer1 brand profile alongside beauty pack profile", () => {
    setWodeAppRuntimeProfilesFromBrandAgents([
      WODEAPP_BRAND_AGENT_INDUSTRY_EXAMPLE,
      WODEAPP_BRAND_AGENT_WYNNE_EXAMPLE,
    ]);
    const ids = listWodeAppRuntimeProfiles().map((profile) => profile.id);
    expect(ids).toContain("beauty-industry-agent");
    expect(ids).toContain("outdoor-gear-industry-agent");
    expect(ids).toContain(WODEAPP_WYNNE_RUNTIME_PROFILE_ID);

    expect(bindWodeAppRuntimeProfileToSession(
      "workspace-1",
      "session-industry",
      "outdoor-gear-industry-agent",
    )).toBe(true);
    const profile = readWodeAppRuntimeProfileForSession("workspace-1", "session-industry");
    expect(profile?.brandId).toBe("outdoor-gear");
    const context = buildWodeAppRuntimeProfileSystemContext(profile);
    expect(context).toContain('profile="outdoor-gear-industry-agent"');
    expect(context).toContain("knowledge_search");
  });
});
