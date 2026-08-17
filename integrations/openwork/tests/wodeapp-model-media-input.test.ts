import { describe, expect, test } from "bun:test";

import {
  adaptKimiCodeModelForVideoInput,
  findModelMediaInputSpec,
  listCatalogMediaInputOverrides,
  resolveModelMediaInputCapabilities,
} from "../wodeapp/wodeapp-model-media-input";

describe("model media input (catalog-driven)", () => {
  test("branded models resolve from catalog; overrides only where needed", () => {
    const models = [
      "wode/minimax-m3",
      "wode/kimi-k3",
      "wode/doubao-pro",
      "wode/qwen3.8-max",
      "wode/deepseek-v4-pro",
      "wode/glm-5.2",
    ];
    for (const modelID of models) {
      const caps = resolveModelMediaInputCapabilities({
        providerID: "wodeapp",
        modelID,
      });
      expect(caps.specKey.length).toBeGreaterThan(0);
    }
    expect(listCatalogMediaInputOverrides().length).toBeGreaterThan(0);
  });

  test("MiniMax M3: image+video native; PDF stays file_api (catalog override)", () => {
    const caps = resolveModelMediaInputCapabilities({
      providerID: "wodeapp",
      modelID: "wode/minimax-m3",
    });
    expect(caps.image).toBe(true);
    expect(caps.video).toBe(true);
    expect(caps.pdf).toBe(false);
    expect(caps.office).toBe(false);
    expect(findModelMediaInputSpec({ providerID: "wodeapp", modelID: "wode/minimax-m3" })?.pdf).toBe("file_api");
  });

  test("Kimi K3 rejects public image URLs per catalog", () => {
    const caps = resolveModelMediaInputCapabilities({
      providerID: "wodeapp",
      modelID: "wode/kimi-k3",
    });
    expect(caps.image).toBe(true);
    expect(caps.video).toBe(true);
    expect(caps.remoteImageUrl).toBe(false);
  });

  test("Kimi Code k3 supports image+video; k3-256k image only", () => {
    const k3 = resolveModelMediaInputCapabilities({
      providerID: "wodeapp",
      modelID: "wode/kimi-code-k3",
    });
    expect(k3.image).toBe(true);
    expect(k3.video).toBe(true);
    expect(k3.remoteImageUrl).toBe(false);

    const k3256 = resolveModelMediaInputCapabilities({
      providerID: "wodeapp",
      modelID: "wode/kimi-code-k3-256k",
    });
    expect(k3256.image).toBe(true);
    expect(k3256.video).toBe(false);
  });

  test("adaptKimiCodeModelForVideoInput upgrades 256k → k3 when turn has video", () => {
    const base = { providerID: "wodeapp", modelID: "wode/kimi-code-k3-256k" };
    const noVideo = adaptKimiCodeModelForVideoInput(base, {
      attachments: [{ mimeType: "image/png", name: "a.png" }],
    });
    expect(noVideo?.upgraded).toBe(false);
    expect(noVideo?.model.modelID).toBe("wode/kimi-code-k3-256k");

    const withVideo = adaptKimiCodeModelForVideoInput(base, {
      attachments: [{ mimeType: "video/mp4", name: "clip.mp4" }],
    });
    expect(withVideo?.upgraded).toBe(true);
    expect(withVideo?.model.modelID).toBe("wode/kimi-code-k3");
    expect(withVideo?.reason).toBe("k3-256k_no_video_upgrade_to_k3");

    // Runtime configs often only register live kimicode/* ids.
    const upstream256 = { providerID: "wodeapp", modelID: "kimicode/k3-256k" };
    const upstreamUpgrade = adaptKimiCodeModelForVideoInput(
      upstream256,
      { attachments: [{ mimeType: "video/mp4", name: "clip.mp4" }] },
      { availableModelIds: ["kimicode/k3", "kimicode/k3-256k", "wode/kimi-k3"] },
    );
    expect(upstreamUpgrade?.upgraded).toBe(true);
    expect(upstreamUpgrade?.model.modelID).toBe("kimicode/k3");

    const missingK3 = adaptKimiCodeModelForVideoInput(
      base,
      { attachments: [{ mimeType: "video/mp4", name: "clip.mp4" }] },
      { availableModelIds: ["wode/kimi-code-k3-256k", "wode/deepseek-v4-pro"] },
    );
    expect(missingK3?.upgraded).toBe(false);
    expect(missingK3?.reason).toBe("k3-256k_video_but_no_k3_available");

    const alreadyK3 = adaptKimiCodeModelForVideoInput(
      { providerID: "wodeapp", modelID: "wode/kimi-code-k3" },
      { attachments: [{ mimeType: "video/mp4", name: "clip.mp4" }] },
    );
    expect(alreadyK3?.upgraded).toBe(false);
  });

  test("DeepSeek / GLM inherit text-only defaults (no mediaInput block needed)", () => {
    for (const modelID of ["wode/deepseek-v4-pro", "wode/glm-5.2"]) {
      const caps = resolveModelMediaInputCapabilities({
        providerID: "wodeapp",
        modelID,
      });
      expect(caps.image).toBe(false);
      expect(caps.video).toBe(false);
      expect(caps.pdf).toBe(false);
      expect(caps.office).toBe(false);
    }
  });

  test("unknown vision-like model only unlocks images by default", () => {
    const caps = resolveModelMediaInputCapabilities({
      providerID: "openrouter",
      modelID: "some-vendor/mystery-vl-model",
    });
    expect(caps.video).toBe(false);
  });
});
