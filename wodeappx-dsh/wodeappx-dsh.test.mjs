import { describe, expect, test, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyEvolve,
  assertNoSecrets,
  BRIDGE_CACHE_MS,
  BRIDGE_ORIGIN,
  browserCdp,
  clearBridgeHealthCache,
  describeModels,
  listHandbookAgents,
  openHandbookAgent,
  planEvolve,
  probeBridgeHealth,
  RELEASES_URL,
} from "./lib/core.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("wodeappx-dsh bundle", () => {
  beforeEach(() => {
    clearBridgeHealthCache();
  });

  test("plugin package declares dsh.bundle; Electron root does not", () => {
    const plugin = JSON.parse(readFileSync(resolve(root, "wodeappx-dsh/package.json"), "utf8"));
    const electron = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
    expect(plugin.name).toBe("wodeappx-dsh");
    expect(plugin.license).toBe("Apache-2.0");
    expect(plugin.dsh.bundle.patch).toBe("./cordis.patch.yml");
    expect(electron.dsh).toBeUndefined();
    expect(electron.name).toBe("wodeappx");
  });

  test("lists image/video handbook agents and can open workbenches", () => {
    const agents = listHandbookAgents();
    expect(agents.map((item) => item.id)).toEqual(["visual-generation", "video-generation"]);
    expect(openHandbookAgent("visual-generation").workbench).toContain("http");
    expect(openHandbookAgent("video-generation").workbench).toContain("http");
    expect(openHandbookAgent("visual-generation").runtime).toBe("runtime-server");
  });

  test("user handbook overlay wins without new schema fields", () => {
    const agents = listHandbookAgents({
      "visual-generation": "---\nid: visual-generation\nname: 我的图片\n---\n",
    });
    expect(agents[0].name).toBe("我的图片");
    expect(agents[0].handbook).toContain("~/.wodeapp/agents/");
    expect(agents[0].skills).toBeUndefined();
  });

  test("models are one OpenAI-compatible row and carry no secrets", () => {
    const models = describeModels();
    expect(models.rows).toHaveLength(1);
    expect(models.rows[0].id).toBe("openai-compatible");
    expect(models.keys).toBe("~/.wodeapp/keys.json");
    expect(assertNoSecrets(models)).toBe(true);
  });

  test("bridge down returns releases URL and does not launch Electron", async () => {
    const result = await probeBridgeHealth({
      fetchImpl: () => Promise.reject(new Error("down")),
    });
    expect(result.up).toBe(false);
    expect(result.download).toBe(RELEASES_URL);
    expect(result.electron).toBe(false);
    expect(result.origin).toBe(BRIDGE_ORIGIN);
  });

  test("bridge health caches 60s", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return { ok: true, status: 200 };
    };
    const first = await probeBridgeHealth({ fetchImpl, now: 1_000 });
    const second = await probeBridgeHealth({ fetchImpl, now: 1_000 + BRIDGE_CACHE_MS - 1 });
    expect(first.up).toBe(true);
    expect(second.cached).toBe(true);
    expect(calls).toBe(1);
  });

  test("CDP and evolve require userConfirmed", () => {
    expect(browserCdp({}).ok).toBe(false);
    expect(browserCdp({ userConfirmed: true }).ok).toBe(true);
    const denied = applyEvolve({ id: "visual-generation" });
    expect(denied.applied).toBe(false);
    expect(denied.plan.needsConfirm).toBe(true);
    let wrote = false;
    const ok = applyEvolve({ id: "visual-generation", userConfirmed: true }, {
      backup: () => "backup",
      write: () => {
        wrote = true;
      },
      verify: () => true,
    });
    expect(ok.applied).toBe(true);
    expect(wrote).toBe(true);
    expect(planEvolve({ id: "visual-generation" }).backup).toContain(".backup");
  });
});
