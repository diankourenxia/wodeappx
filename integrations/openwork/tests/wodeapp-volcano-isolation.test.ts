import { describe, expect, mock, test } from "bun:test";

mock.module("@/app/constants", () => ({
  DEFAULT_MODEL: { providerID: "opencode", modelID: "big-pickle" },
}));
mock.module("@/app/lib/wodeapp-auth", () => ({
  applyWodeAppProvider: async () => ({ ok: true }),
  loadCachedWodeAppAuthState: async () => ({ ok: false, signedIn: false }),
  getWodeAppServiceConfig: async () => ({ ok: true, config: { profile: "local-only" } }),
}));
mock.module("@/react-app/kernel/local-provider", () => ({}));
mock.module("@/react-app/kernel/model-config", () => ({
  writeStoredDefaultModel: () => {},
}));
mock.module("@/react-app/infra/provider-list-query", () => ({
  getConnectedProviderItems: (list: { all?: Array<{ id: string }> } | null | undefined) => list?.all ?? [],
}));
mock.module("@/app/types", () => ({}));
mock.module("@/app/utils", () => ({
  modelEquals: (
    a: { providerID?: string; modelID?: string } | null | undefined,
    b: { providerID?: string; modelID?: string } | null | undefined,
  ) => Boolean(a && b && a.providerID === b.providerID && a.modelID === b.modelID),
  parseModelRef: (raw: string | null | undefined) => {
    const value = String(raw ?? "").trim();
    const slash = value.indexOf("/");
    if (slash <= 0) return null;
    return { providerID: value.slice(0, slash), modelID: value.slice(slash + 1) };
  },
}));
mock.module("@opencode-ai/sdk/v2/client", () => ({}));

import {
  groupModelsForPicker,
  isModelPickerVendorConfigured,
  modelPickerVendorId,
  withLocalPickerVendorPlaceholders,
} from "../wodeapp/wodeapp-model-display";
import { buildPickerFamiliesFromSources } from "../wodeapp/wodeapp-model-picker-families";
import {
  buildProviderCapabilitySnapshot,
  capabilityConfigActionLabel,
  generationToolsHiddenBySnapshot,
} from "../wodeapp/wodeapp-provider-capability";
import { isLocalByokSendLane } from "../wodeapp/wodeapp-send-readiness";

const {
  normalizeWodeAppModelRefForWorkbench,
  resolvePreferredWorkbenchModel,
  WODEAPP_DEFAULT_MODEL,
} = await import("../wodeapp/wodeapp-model-sync");

/** Live ARK /models sample from 2026-08-13 isolation probe. */
const VOLCANO_ONLY_MODELS = [
  "doubao-seed-2-1-pro-260628",
  "doubao-seed-2-1-turbo-260628",
  "doubao-seed-2-0-lite-260215",
  "doubao-seedream-5-0-260128",
  "doubao-seedream-5-0-pro-260628",
  "doubao-seedance-2-0-mini-260615",
  "doubao-seedance-2-0-260128",
];

function providerList(connected: Array<{ id: string; models: string[] }>) {
  return {
    connected: connected.map((item) => item.id),
    default: {},
    all: connected.map((item) => ({
      id: item.id,
      name: item.id,
      source: "custom",
      env: [],
      models: Object.fromEntries(item.models.map((id) => [id, { id, name: id }])),
    })),
  } as Parameters<typeof resolvePreferredWorkbenchModel>[0];
}

const volcanoOnlyList = providerList([
  { id: "volcano", models: VOLCANO_ONLY_MODELS },
]);

describe("Volcano-only isolation (no cloud, no other vendor keys)", () => {
  test("unsigned default uses Volcano chat model, not WodeApp cloud", () => {
    expect(normalizeWodeAppModelRefForWorkbench(null, {
      connectedProviderIds: ["volcano"],
    })).toEqual({ providerID: "", modelID: "" });
    expect(resolvePreferredWorkbenchModel(volcanoOnlyList, null)).toEqual({
      providerID: "volcano",
      modelID: "doubao-seed-2-1-pro-260628",
    });
    expect(resolvePreferredWorkbenchModel(volcanoOnlyList, WODEAPP_DEFAULT_MODEL)).toEqual({
      providerID: "volcano",
      modelID: "doubao-seed-2-1-pro-260628",
    });
  });

  test("picker shows catalog Doubao families, not the full Volcano dump", () => {
    expect(modelPickerVendorId("volcano", "doubao-seed-2-1-pro-260628")).toBe("volcano");
    const grouped = withLocalPickerVendorPlaceholders(groupModelsForPicker(
      VOLCANO_ONLY_MODELS.map((modelID) => ({ providerID: "volcano", modelID })),
    ));
    expect(grouped.find((item) => item.vendorId === "volcano")?.items).toHaveLength(VOLCANO_ONLY_MODELS.length);
    expect(grouped.find((item) => item.vendorId === "deepseek")?.items).toEqual([]);
    expect(grouped.find((item) => item.vendorId === "kimi")?.items).toEqual([]);

    const families = buildPickerFamiliesFromSources([{
      id: "volcano",
      modelIds: VOLCANO_ONLY_MODELS,
    }]);
    expect(families.map((item) => item.title)).toEqual([
      "豆包 Seed 2.1 Pro",
      "豆包 Seed 2.1 Turbo",
    ]);
    expect(families.every((item) => item.providerID === "volcano")).toBe(true);
    expect(families.some((item) => item.modelID.includes("seed-2-0-lite"))).toBe(false);
  });

  test("probed Volcano list unlocks chat + image + video tools", () => {
    const snapshot = buildProviderCapabilitySnapshot([{
      id: "volcano",
      label: "火山方舟 ARK",
      keyPreview: "ark-***4544",
      probeStatus: "ok",
      models: VOLCANO_ONLY_MODELS.map((id) => ({ id })),
    }]);
    expect(snapshot.union).toEqual({ text: true, image: true, video: true });
    expect(snapshot.missing).toEqual([]);
    expect(generationToolsHiddenBySnapshot(snapshot)).toEqual([]);
    expect(capabilityConfigActionLabel(snapshot.sources[0]!)).toBe("已配置");
    expect(isModelPickerVendorConfigured("volcano", snapshot.sources, false)).toBe(true);
    expect(isModelPickerVendorConfigured("deepseek", snapshot.sources, false)).toBe(false);
  });

  test("preferred Volcano model sends on the local-key lane", () => {
    const preferred = resolvePreferredWorkbenchModel(volcanoOnlyList, null);
    expect(isLocalByokSendLane(WODEAPP_DEFAULT_MODEL, ["volcano"])).toBe(false);
    expect(isLocalByokSendLane(preferred, ["volcano"])).toBe(true);
  });

  test("WodeApp is a peer vendor: empty current prefers Volcano, remembered WodeApp stays", () => {
    const both = providerList([
      { id: "wodeapp", models: ["wode/deepseek-v4-flash"] },
      { id: "volcano", models: VOLCANO_ONLY_MODELS },
    ]);
    expect(resolvePreferredWorkbenchModel(both, null)).toEqual({
      providerID: "volcano",
      modelID: "doubao-seed-2-1-pro-260628",
    });
    expect(resolvePreferredWorkbenchModel(both, WODEAPP_DEFAULT_MODEL)).toEqual(WODEAPP_DEFAULT_MODEL);
  });
});
