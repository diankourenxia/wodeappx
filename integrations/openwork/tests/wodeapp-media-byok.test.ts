import { describe, expect, it } from "vitest";

import {
  mediaByokProviderStatus,
  mediaByokToImageToken,
  mediaByokToVideoOverride,
  mediaByokProviderFromCapabilitySource,
  normalizeMediaByokFile,
  validateMediaByokProvider,
} from "../wodeapp/wodeapp-media-byok";

describe("wodeapp-media-byok", () => {
  it("requires both Kling AK and SK and guides missing fields", () => {
    const onlyAk = validateMediaByokProvider("kling", { accessKey: "ak-1" });
    expect(onlyAk.ok).toBe(false);
    if (!onlyAk.ok) {
      expect(onlyAk.missing).toContain("Secret Key (SK)");
      expect(onlyAk.message).toContain("还需填写");
    }

    const ready = validateMediaByokProvider("kling", {
      accessKey: "ak-1",
      secretKey: "sk-1",
    });
    expect(ready.ok).toBe(true);
    if (ready.ok) {
      expect(mediaByokToVideoOverride("kling", ready.values)).toEqual({
        apiKey: "ak-1",
        secretValue: "sk-1",
      });
    }
  });

  it("maps single-key video/image providers", () => {
    expect(mediaByokToVideoOverride("seedance", { apiKey: "ark-1" })).toEqual({
      apiKey: "ark-1",
    });
    expect(mediaByokToImageToken("replicate", { apiToken: "r8_x" })).toBe("r8_x");
    expect(mediaByokToImageToken("openai-image", { apiKey: "sk-x" })).toBe("sk-x");
    expect(mediaByokToImageToken("seedance", { apiKey: "ark-1" })).toBe("ark-1");
    expect(mediaByokToImageToken("volcano", { apiKey: "ark-2" })).toBe("ark-2");
  });

  it("normalizes and reports incomplete vs ready status", () => {
    const file = normalizeMediaByokFile({
      preferLocal: true,
      providers: {
        kling: { accessKey: "ak-only" },
        runway: { apiKey: "rw-1" },
      },
    });
    expect(mediaByokProviderStatus(file, "kling")).toBe("incomplete");
    expect(mediaByokProviderStatus(file, "runway")).toBe("ready");
    expect(mediaByokProviderStatus(file, "seedance")).toBe("empty");
  });

  it("maps capability sources onto media BYOK providers", () => {
    expect(mediaByokProviderFromCapabilitySource("kling")).toBe("kling");
    expect(mediaByokProviderFromCapabilitySource("openai-image")).toBe("openai-image");
    expect(mediaByokProviderFromCapabilitySource("volcano")).toBeNull();
    expect(mediaByokProviderFromCapabilitySource("volcano", "media-byok")).toBe("seedance");
    expect(mediaByokProviderFromCapabilitySource("deepseek")).toBeNull();
  });
});
