import { describe, expect, test } from "bun:test";

import {
  computeUploadScale,
  dataUrlByteLength,
  filenameWithExtension,
  parseDataUrl,
  resolveUploadOutputMime,
  shouldSkipUploadNormalize,
} from "../wodeapp/wodeapp-image-normalize-for-upload";

describe("wodeapp-image-normalize-for-upload helpers", () => {
  test("computeUploadScale caps long edge", () => {
    expect(computeUploadScale(4000, 3000, 2048)).toBeCloseTo(2048 / 4000);
    expect(computeUploadScale(1024, 768, 2048)).toBe(1);
  });

  test("resolveUploadOutputMime keeps product alpha and forces jpeg for reference photos", () => {
    expect(resolveUploadOutputMime("image/png", "product")).toBe("image/png");
    expect(resolveUploadOutputMime("image/png", "reference")).toBe("image/jpeg");
    expect(resolveUploadOutputMime("image/bmp", "reference")).toBe("image/jpeg");
    expect(resolveUploadOutputMime("image/jpeg", "reference")).toBe("image/jpeg");
  });

  test("shouldSkipUploadNormalize honors preserveOriginal / original purpose", () => {
    expect(shouldSkipUploadNormalize({ preserveOriginal: true })).toBe(true);
    expect(shouldSkipUploadNormalize({ purpose: "original" })).toBe(true);
    expect(shouldSkipUploadNormalize({ purpose: "reference" })).toBe(false);
  });

  test("parseDataUrl and byte length", () => {
    const dataUrl = "data:image/jpeg;base64,QQ==";
    expect(parseDataUrl(dataUrl)).toEqual({ mime: "image/jpeg", base64: "QQ==" });
    expect(dataUrlByteLength(dataUrl)).toBeGreaterThan(0);
    expect(filenameWithExtension("model.PNG", "jpg")).toBe("model.jpg");
  });
});
