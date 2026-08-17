import { describe, expect, test } from "bun:test";

import {
  requireRuntimeDataMutationRecord,
  requireRuntimeDataQueryRecords,
  requireSuccessfulRuntimeDataResponse,
  runtimeDataPayloadMatches,
} from "@/react-app/domains/wodeapp/wodeapp-runtime-data-handoff";
import {
  attachStoryboardPayloadToWorkbenchUrl,
} from "@/react-app/domains/wodeapp/wodeapp-pvs-storyboard-url";

describe("WodeAppX runtime data handoff", () => {
  test("rejects empty, malformed and business-failure responses even on HTTP success", () => {
    expect(() => requireSuccessfulRuntimeDataResponse(null, "sync")).toThrow(
      "response did not confirm success",
    );
    expect(() => requireSuccessfulRuntimeDataResponse(undefined, "sync")).toThrow(
      "response did not confirm success",
    );
    expect(() => requireSuccessfulRuntimeDataResponse({ success: false }, "sync")).toThrow(
      "response did not confirm success",
    );
    expect(() => requireSuccessfulRuntimeDataResponse({
      success: false,
      error: "collection denied",
    }, "sync")).toThrow("collection denied");
    expect(() => requireSuccessfulRuntimeDataResponse({ success: true }, "sync")).not.toThrow();
    expect(() => requireRuntimeDataMutationRecord({ success: true }, "sync")).toThrow(
      "response data is missing or invalid",
    );
    expect(requireRuntimeDataMutationRecord({
      success: true,
      data: { id: "rec_1", docId: "pvi_ok" },
    }, "sync")).toEqual({ id: "rec_1", docId: "pvi_ok" });
  });

  test("requires a records array before accepting readback", () => {
    expect(() => requireRuntimeDataQueryRecords({
      success: true,
      data: {},
    }, "readback")).toThrow("response records are missing or invalid");
    expect(() => requireRuntimeDataQueryRecords({
      success: true,
      data: { records: [null] },
    }, "readback")).toThrow("response contains an invalid record");
    expect(requireRuntimeDataQueryRecords({
      success: true,
      data: { records: [{ docId: "pvi_test" }] },
    }, "readback")).toEqual([{ docId: "pvi_test" }]);
  });

  test("compares nested task payloads without depending on object key order", () => {
    const expected = {
      scenes: [{ name: "S1", prompt: "商品特写" }],
      subjects: [{ name: "商品", imageUrl: "https://assets.example.com/product.png" }],
    };
    const reordered = {
      subjects: [{ imageUrl: "https://assets.example.com/product.png", name: "商品" }],
      scenes: [{ prompt: "商品特写", name: "S1" }],
    };

    expect(runtimeDataPayloadMatches(expected, reordered)).toBe(true);
    expect(runtimeDataPayloadMatches(expected, {
      ...reordered,
      scenes: [],
    })).toBe(false);
  });

  test("compares readback with JSON wire semantics for optional undefined fields", () => {
    expect(runtimeDataPayloadMatches(
      {
        name: "测试商品",
        sourceAssetId: undefined,
        nested: { sourceAssetKind: undefined, count: 1 },
      },
      {
        nested: { count: 1 },
        name: "测试商品",
      },
    )).toBe(true);
  });

  test("keeps the documented small-storyboard inline fallback reachable", () => {
    const url = attachStoryboardPayloadToWorkbenchUrl(
      "https://ai.wodeapp.cn/video?pvsRun=legacy&pvsAutoRun=1",
      "eyJzY2VuZXMiOltdfQ==",
    );
    const parsed = new URL(url || "");

    expect(parsed.searchParams.get("shareDoc")).toBe("eyJzY2VuZXMiOltdfQ==");
    expect(parsed.searchParams.has("pvsRun")).toBe(false);
    expect(parsed.searchParams.has("pvsAutoRun")).toBe(false);
  });
});
