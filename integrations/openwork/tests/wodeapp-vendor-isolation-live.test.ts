import { describe, expect, test } from "bun:test";

import { runIsolatedVendor } from "../wodeapp/wodeapp-vendor-isolation";

describe("live vendor isolation via runIsolatedVendor", () => {
  test("1 volcano", async () => {
    const report = await runIsolatedVendor("volcano");
    expect(report.ok).toBe(true);
    expect(report.probeStatus).toBe("ok");
    expect(report.catalog?.match.text?.providerID).toBe("volcano");
    expect(report.catalog?.invokeCandidates.text[0]).toMatch(/seed-2/i);
    expect(report.catalog?.invokeCandidates.image[0]).toMatch(/seedream/i);
    expect(report.catalog?.invokeCandidates.video[0]).toMatch(/seedance/i);
    console.log(JSON.stringify({
      vendor: report.vendorId,
      probe: report.probeStatus,
      models: report.catalog?.modelCount,
      match: {
        text: report.catalog?.match.text?.modelID,
        image: report.catalog?.match.image?.modelID,
        video: report.catalog?.match.video?.modelID,
      },
      invoke: report.catalog?.invokeCandidates,
    }));
  }, 30_000);

  test("2 openrouter", async () => {
    const report = await runIsolatedVendor("openrouter");
    expect(report.ok).toBe(true);
    expect(report.probeStatus).toBe("ok");
    expect(report.catalog?.families).toEqual(expect.arrayContaining(["kimi", "deepseek"]));
    expect(report.catalog?.match.text?.providerID).toBe("openrouter");
    console.log(JSON.stringify({
      vendor: report.vendorId,
      probe: report.probeStatus,
      models: report.catalog?.modelCount,
      families: report.catalog?.families.slice(0, 12),
      invokeText: report.catalog?.invokeCandidates.text.slice(0, 4),
    }));
  }, 30_000);

  test("3 replicate", async () => {
    const report = await runIsolatedVendor("replicate");
    expect(report.ok).toBe(true);
    expect(["configured", "ok"]).toContain(report.probeStatus);
    expect(report.catalog?.match.text).toBeNull();
    expect(report.catalog?.invokeCandidates.image[0]).toBe("google/nano-banana");
    console.log(JSON.stringify({
      vendor: report.vendorId,
      probe: report.probeStatus,
      image: report.catalog?.invokeCandidates.image[0],
    }));
  }, 20_000);
});
