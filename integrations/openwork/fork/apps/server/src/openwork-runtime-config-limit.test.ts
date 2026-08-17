import { describe, expect, test } from "bun:test";

import { buildOpenworkRuntimeConfigObject } from "./openwork-runtime-config.js";

describe("openwork agent runtime limits", () => {
  test("enforces a high finite model-step budget for every turn", async () => {
    const config = await buildOpenworkRuntimeConfigObject();
    const agents = config.agent as Record<string, Record<string, unknown>>;

    expect(agents.openwork?.steps).toBe(300);
    expect(agents["wynne-brand-agent"]).toMatchObject({
      description: "Wynne 品牌智能体 runtime agent",
      mode: "primary",
      hidden: true,
      steps: 100,
    });
    expect(String(agents["wynne-brand-agent"]?.prompt)).toContain("You are Wynne 品牌智能体");
    expect(String(agents["wynne-brand-agent"]?.prompt)).not.toContain("desktop workbench");
  });
});
