import { describe, expect, mock, test } from "bun:test";

mock.module("@/app/types", () => ({}));

import { isolateVendorCatalog, rankInvokeCandidates } from "../wodeapp/wodeapp-vendor-isolation";
import { buildModelRoutesFromSources } from "../wodeapp/wodeapp-model-route-match";

describe("isolateVendorCatalog", () => {
  test("ranks later catalog dates ahead of stale ARK entries", () => {
    const catalog = isolateVendorCatalog({
      id: "volcano",
      modelIds: [
        "doubao-lite-128k-240428",
        "doubao-embedding-text-240515",
        "doubao-seed-2-1-pro-260628",
        "doubao-seedream-4-0-250828",
        "doubao-seedream-5-0-260128",
        "doubao-seedance-1-0-lite-i2v-250428",
        "doubao-seedance-2-0-260128",
        "kimi-k2-250711",
        "deepseek-v4-flash-ga-260731",
      ],
    });
    expect(catalog.match.text?.modelID).toBe("doubao-seed-2-1-pro-260628");
    expect(catalog.invokeCandidates.text[0]).toBe("doubao-seed-2-1-pro-260628");
    expect(catalog.invokeCandidates.text[0]).not.toBe("deepseek-v4-flash-ga-260731");
    expect(catalog.invokeCandidates.text).not.toContain("doubao-embedding-text-240515");
    expect(catalog.invokeCandidates.image[0]).toBe("doubao-seedream-5-0-260128");
    expect(catalog.invokeCandidates.video[0]).toBe("doubao-seedance-2-0-260128");
    expect(catalog.match.image?.modelID).toBe("doubao-seedream-5-0-260128");
    expect(catalog.families).toEqual(expect.arrayContaining(["volcano", "kimi"]));
  });

  test("OpenRouter catalog still groups by family and keeps unmapped leftover ids", () => {
    const catalog = isolateVendorCatalog({
      id: "openrouter",
      modelIds: [
        "moonshotai/kimi-k2.5",
        "deepseek/deepseek-v4-flash",
        "liquid/lfm-2.5-2.6b:free",
      ],
    });
    expect(catalog.families).toEqual(expect.arrayContaining(["kimi", "deepseek"]));
    expect(catalog.families).toContain("openrouter");
  });

  test("Replicate assumed key is image-only", () => {
    const catalog = isolateVendorCatalog({
      id: "replicate",
      modelIds: [],
      estimated: true,
      modalities: { text: false, image: true, video: false },
    });
    expect(catalog.match.text).toBeNull();
    expect(catalog.invokeCandidates.text).toEqual([]);
    expect(catalog.invokeCandidates.image[0]).toBe("google/nano-banana");
    const ranked = rankInvokeCandidates(buildModelRoutesFromSources([{
      id: "replicate",
      estimated: true,
      modalities: { text: false, image: true, video: false },
    }]), "image");
    expect(ranked).toEqual(["google/nano-banana"]);
  });
});
