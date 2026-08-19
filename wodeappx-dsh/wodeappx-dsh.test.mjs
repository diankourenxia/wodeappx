import { describe, expect, test, beforeEach } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
import { parseWodeAppSkinsCatalog, visibleSkinCatalog } from "../scripts/generate-dsh-skin-catalog.mjs";
import {
  DEFAULT_SKIN_ID,
  getSkin,
  listSkins,
  parseWodeAppSkinFileText,
  readPackedSkinCatalog,
  resolveWodeAppSkinId,
  setSkin,
  visibleSkinCatalog as visiblePacked,
} from "./lib/skin-store.js";

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

describe("wodeappx-dsh skins", () => {
  const skinsTs = readFileSync(resolve(root, "integrations/openwork/wodeapp/wodeapp-skins.ts"), "utf8");
  const packed = JSON.parse(readFileSync(resolve(root, "wodeappx-dsh/lib/skin-catalog.json"), "utf8"));
  const parsed = parseWodeAppSkinsCatalog(skinsTs);

  function tmpIo() {
    const home = mkdtempSync(join(tmpdir(), "wodeappx-skin-"));
    const writes = [];
    return {
      home,
      writes,
      writeFile(file, body) {
        writes.push(file);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, body);
      },
      cleanup() {
        rmSync(home, { recursive: true, force: true });
      },
    };
  }

  test("catalog snapshot matches wodeapp-skins.ts and hides supor", () => {
    expect(parsed.map((item) => item.id)).toEqual(packed.skins.map((item) => item.id));
    expect(parsed).toEqual(packed.skins);
    expect(visibleSkinCatalog(parsed).some((item) => item.id === "supor")).toBe(false);
    expect(visiblePacked().some((item) => item.id === "supor")).toBe(false);
    expect(readPackedSkinCatalog().length).toBe(parsed.length);
  });

  test("list and get do not need confirm; resolve is file then cache then default", () => {
    const io = tmpIo();
    try {
      const listed = listSkins(io);
      expect(listed.ok).toBe(true);
      expect(listed.current).toBe(DEFAULT_SKIN_ID);
      expect(listed.skins.some((item) => item.id === "supor")).toBe(false);
      expect(listed.skins.some((item) => item.id === "red-compact")).toBe(true);
      expect(getSkin(io).id).toBe("red-compact");
      expect(resolveWodeAppSkinId({ fileId: "noir-jazz", cacheId: "default" })).toBe("noir-jazz");
      expect(resolveWodeAppSkinId({ fileId: "nope", cacheId: "coffee-loft" })).toBe("coffee-loft");
      expect(resolveWodeAppSkinId({ fileId: "nope", cacheId: "nope" })).toBe("red-compact");
    } finally {
      io.cleanup();
    }
  });

  test("set requires userConfirmed and writes {id} only", () => {
    const io = tmpIo();
    try {
      const denied = setSkin({ id: "coffee-loft" }, io);
      expect(denied.ok).toBe(false);
      expect(denied.wrote).toBe(false);
      expect(io.writes).toEqual([]);
      const ok = setSkin({ id: "coffee-loft", userConfirmed: true }, io);
      expect(ok.ok).toBe(true);
      expect(ok.id).toBe("coffee-loft");
      const raw = readFileSync(join(io.home, ".wodeapp", "skin.json"), "utf8");
      expect(JSON.parse(raw)).toEqual({ id: "coffee-loft" });
      expect(parseWodeAppSkinFileText(raw)).toBe("coffee-loft");
      expect(getSkin(io).label).toBe("咖啡阁楼");
    } finally {
      io.cleanup();
    }
  });

  test("unknown id falls back to red-compact; hidden rejected unless stored", () => {
    const io = tmpIo();
    try {
      const unknown = setSkin({ id: "not-a-skin", userConfirmed: true }, io);
      expect(unknown.id).toBe("red-compact");
      const hidden = setSkin({ id: "supor", userConfirmed: true }, io);
      expect(hidden.ok).toBe(false);
      expect(hidden.wrote).toBe(false);
      expect(getSkin(io).id).toBe("red-compact");
      mkdirSync(join(io.home, ".wodeapp"), { recursive: true });
      writeFileSync(join(io.home, ".wodeapp", "skin.json"), `${JSON.stringify({ id: "supor" })}\n`);
      const keep = setSkin({ id: "supor", userConfirmed: true }, io);
      expect(keep.ok).toBe(true);
      expect(keep.id).toBe("supor");
    } finally {
      io.cleanup();
    }
  });

  test("plugin still registers six original tools plus three skin tools", () => {
    const source = readFileSync(resolve(root, "wodeappx-dsh/index.js"), "utf8");
    for (const name of [
      "wodeappx_list_agents",
      "wodeappx_open_agent",
      "wodeappx_models",
      "wodeappx_browser_status",
      "wodeappx_browser_cdp",
      "wodeappx_evolve",
      "wodeappx_list_skins",
      "wodeappx_get_skin",
      "wodeappx_set_skin",
    ]) {
      expect(source).toContain(name);
    }
    expect(source).not.toContain("data-theme");
    expect(source).not.toContain("appearance");
  });

  test("skin store never touches keys.json or models.json", () => {
    const store = readFileSync(resolve(root, "wodeappx-dsh/lib/skin-store.js"), "utf8");
    expect(store).toContain("skin.json");
    expect(store).not.toContain("keys.json");
    expect(store).not.toContain("models.json");
  });
});
