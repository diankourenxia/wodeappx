import { describe, expect, test } from "bun:test";

import {
  brandAgentConfigToBuiltinAgent,
  brandAgentConfigToRuntimeProfile,
  validateWodeAppBrandAgentsFile,
  WODEAPP_BRAND_AGENT_INDUSTRY_EXAMPLE,
  WODEAPP_BRAND_AGENT_WYNNE_EXAMPLE,
} from "../wodeapp/wodeapp-brand-agent-config";

describe("brand-agents config contract", () => {
  test("accepts the Wynne example", () => {
    const result = validateWodeAppBrandAgentsFile({
      version: 1,
      agents: [WODEAPP_BRAND_AGENT_WYNNE_EXAMPLE],
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.file.agents).toHaveLength(1);
    expect(result.file.agents[0].workbench).toBe("wynne");
  });

  test("accepts the industry generic example and maps to chat handoff", () => {
    const result = validateWodeAppBrandAgentsFile({
      version: 1,
      agents: [WODEAPP_BRAND_AGENT_INDUSTRY_EXAMPLE],
    });
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.file.agents[0].workbench).toBe("generic");
    expect(result.file.agents[0].id).toBe("outdoor-gear-industry-agent");

    const builtin = brandAgentConfigToBuiltinAgent(result.file.agents[0]);
    expect(builtin.kind).toBe("brand");
    expect(builtin.runtimeProfileId).toBe("outdoor-gear-industry-agent");
    expect(builtin.autoSend).toBe(false);
    expect(builtin.entryPrompt).toContain("户外");

    const profile = brandAgentConfigToRuntimeProfile(result.file.agents[0]);
    expect(profile.brandId).toBe("outdoor-gear");
    expect(profile.knowledgeScopes).toEqual(["outdoor-gear"]);
    expect(profile.connectorScopes).toEqual([]);
  });

  test("accepts industry + brand agents together without id clash", () => {
    const result = validateWodeAppBrandAgentsFile({
      version: 1,
      agents: [WODEAPP_BRAND_AGENT_INDUSTRY_EXAMPLE, WODEAPP_BRAND_AGENT_WYNNE_EXAMPLE],
    });
    expect(result.ok).toBe(true);
    expect(result.file.agents.map((item) => item.id)).toEqual([
      "outdoor-gear-industry-agent",
      "wynne-brand-agent",
    ]);
    expect(result.file.agents.map((item) => item.workbench)).toEqual(["generic", "wynne"]);
  });

  test("rejects unsupported version", () => {
    const result = validateWodeAppBrandAgentsFile({ version: 2, agents: [] });
    expect(result.ok).toBe(false);
    expect(result.errors.some((item) => item.code === "unsupported_version")).toBe(true);
    expect(result.file.agents).toEqual([]);
  });

  test("rejects reserved builtin ids and drops unknown connectors", () => {
    const result = validateWodeAppBrandAgentsFile({
      version: 1,
      agents: [
        {
          id: "visual-generation",
          name: "Conflict",
          brandId: "acme",
        },
        {
          id: "acme-brand-agent",
          name: "Acme",
          brandId: "acme",
          connectorScopes: ["shopify", "twitter"],
          workbench: "wynne",
        },
      ],
    });
    expect(result.file.agents.map((item) => item.id)).toEqual(["acme-brand-agent"]);
    expect(result.file.agents[0].connectorScopes).toEqual(["shopify"]);
    expect(result.file.agents[0].workbench).toBe("generic");
    expect(result.errors.some((item) => item.code === "reserved_id")).toBe(true);
    expect(result.warnings.some((item) => item.code === "unknown_scope")).toBe(true);
    expect(result.warnings.some((item) => item.code === "workbench_downgraded")).toBe(true);
  });
});
