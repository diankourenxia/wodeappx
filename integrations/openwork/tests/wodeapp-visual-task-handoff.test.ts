import { beforeEach, describe, expect, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

class FakeRuntimeRequestError extends Error {
  readonly status: number;
  readonly bodySnippet: string;

  constructor(message: string, status = 500, bodySnippet = "") {
    super(message);
    this.name = "WodeAppRuntimeRequestError";
    this.status = status;
    this.bodySnippet = bodySnippet;
  }
}

type RuntimeCall = {
  path: string;
  method?: string;
  body?: string;
};

const runtimeCalls: RuntimeCall[] = [];
let runtimeHandler: (path: string, init?: { method?: string; body?: string }) => Promise<unknown> = async () => ({
  success: true,
  data: {},
});

mock.module("@/app/lib/wodeapp-auth", () => ({
  WodeAppRuntimeRequestError: FakeRuntimeRequestError,
  isWodeAppAuthAvailable: () => true,
  loadWodeAppAuthState: async () => ({ signedIn: true }),
  loadCachedWodeAppAuthState: async () => ({ signedIn: true }),
  refreshWodeAppAccountState: async () => ({ signedIn: true }),
  getWodeAppApiCredentials: async () => ({
    apiKey: "sk_test_handoff",
    origin: "https://example.wodeapp.cn",
  }),
  requestWodeAppChatCompletion: async () => ({}),
  requestWodeAppVision: async () => ({}),
  requestWodeAppAttachmentIntelligence: async () => ({
    results: [],
    combinedContext: "",
  }),
  requestWodeAppMainJson: async () => ({}),
  syncWodeAppAbilityProjects: async () => ({ projects: [] }),
  requestWodeAppRuntimeJson: async (
    requestPath: string,
    init: { method?: string; body?: string } = {},
  ) => {
    runtimeCalls.push({
      path: requestPath,
      method: init.method,
      body: typeof init.body === "string" ? init.body : undefined,
    });
    return runtimeHandler(requestPath, init);
  },
}));

const {
  buildVisualGenerationTaskUrlAsync,
} = await import("@/react-app/domains/wodeapp/wodeapp-pv-visual-task-url");
const {
  attachStoryboardPayloadToWorkbenchUrl,
  buildVideoStoryboardTaskUrlAsync,
  normalizeShareDocId,
} = await import("@/react-app/domains/wodeapp/wodeapp-pvs-storyboard-url");

function smallImageTask() {
  return {
    name: "测试耳机",
    productImages: ["https://assets.example.com/product.png"],
    productInfo: "降噪耳机",
    selectedCreativeTypes: ["product-photo"],
    iterCount: 1,
  };
}

function singleSceneRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run_test",
    topic: "商品短视频",
    scenes: [{
      id: "scene_1",
      name: "开场",
      prompt: "商品特写",
      duration: 5,
    }],
    subjects: [{
      name: "商品",
      imageUrl: "https://assets.example.com/product.png",
    }],
    ...overrides,
  };
}

beforeEach(() => {
  runtimeCalls.length = 0;
  runtimeHandler = async () => ({ success: true, data: {} });
});

describe("WodeAppX image task sync + readback", () => {
  test("rejects HTTP 2xx business failures and never falls back to inline when projectHeader exists", async () => {
    runtimeHandler = async (requestPath) => {
      if (requestPath === "/v1/data/sync") {
        return { success: false, error: "collection denied" };
      }
      throw new Error(`unexpected path ${requestPath}`);
    };

    const result = await buildVisualGenerationTaskUrlAsync(
      "https://yougi.wodeapp.cn/",
      smallImageTask(),
      { projectHints: { projectId: "proj_image" } },
    );

    expect(result.url).toBeNull();
    expect(result.mode).toBe("docId");
    expect(result.syncDiagnostic?.ok).toBe(false);
    expect(result.syncDiagnostic?.verified).not.toBe(true);
    expect(result.saveError).toContain("collection denied");
    expect(runtimeCalls.map((call) => call.path)).toEqual(["/v1/data/sync"]);
  });

  test("rejects empty sync payloads even when HTTP succeeds", async () => {
    runtimeHandler = async () => null;

    const result = await buildVisualGenerationTaskUrlAsync(
      "https://yougi.wodeapp.cn/",
      smallImageTask(),
      { projectHints: { slug: "yougi" } },
    );

    expect(result.url).toBeNull();
    expect(result.saveError).toContain("response did not confirm success");
  });

  test("requires matching pvi_* readback before opening the workbench", async () => {
    const task = smallImageTask();
    runtimeHandler = async (requestPath) => {
      if (requestPath === "/v1/data/sync") {
        return {
          success: true,
          data: { id: "rec_1", docId: "ignored" },
        };
      }
      if (requestPath === "/v1/data/query") {
        return {
          success: true,
          data: {
            records: [{
              _recordId: "rec_1",
              docId: "pvi_wrong_doc",
              task: { ...task, productInfo: "被改写的卖点" },
            }],
          },
        };
      }
      throw new Error(`unexpected path ${requestPath}`);
    };

    const result = await buildVisualGenerationTaskUrlAsync(
      "https://yougi.wodeapp.cn/",
      task,
      { projectHints: { subdomain: "yougi" } },
    );

    expect(result.url).toBeNull();
    expect(result.saveError).toContain("readback failed");
    expect(result.syncDiagnostic?.verified).not.toBe(true);
  });

  test("returns shareDoc=pvi_* only after sync and matching readback", async () => {
    const task = smallImageTask();
    let syncedDocId = "";

    runtimeHandler = async (requestPath, init) => {
      if (requestPath === "/v1/data/sync") {
        const body = JSON.parse(init?.body || "{}") as {
          data?: { docId?: string; task?: unknown };
        };
        syncedDocId = String(body.data?.docId || "");
        return {
          success: true,
          data: { id: "rec_ok", docId: syncedDocId },
        };
      }
      if (requestPath === "/v1/data/query") {
        return {
          success: true,
          data: {
            records: [{
              _recordId: "rec_ok",
              docId: syncedDocId,
              task,
              createdAt: Date.now(),
            }],
          },
        };
      }
      throw new Error(`unexpected path ${requestPath}`);
    };

    const result = await buildVisualGenerationTaskUrlAsync(
      "https://yougi.wodeapp.cn/home",
      task,
      { projectHints: { projectId: "proj_ok" } },
    );

    expect(syncedDocId.startsWith("pvi_")).toBe(true);
    expect(result.mode).toBe("docId");
    expect(result.taskDocId).toBe(syncedDocId);
    expect(result.syncDiagnostic?.ok).toBe(true);
    expect(result.syncDiagnostic?.verified).toBe(true);
    expect(new URL(result.url || "").searchParams.get("shareDoc")).toBe(syncedDocId);
    // Preserve ability/workbench launch path (e.g. `/` or `/home`); do not rewrite to `/product-visual`.
    expect(new URL(result.url || "").pathname).toBe("/home");
    expect(runtimeCalls.map((call) => call.path)).toEqual([
      "/v1/data/sync",
      "/v1/data/query",
    ]);
  });
});

describe("WodeAppX video storyboard sync + readback", () => {
  test("does not treat query failures as missing records that should be recreated", async () => {
    runtimeHandler = async (requestPath) => {
      if (requestPath === "/v1/data/query") {
        throw new FakeRuntimeRequestError("query boom", 503, "{\"error\":\"unavailable\"}");
      }
      throw new Error(`unexpected path ${requestPath}`);
    };

    const result = await buildVideoStoryboardTaskUrlAsync(
      "https://ai.wodeapp.cn/video",
      singleSceneRun(),
      {
        shareDocId: "pvs_existing_20260720_abcd",
        projectHints: { projectId: "proj_video" },
      },
    );

    expect(result.url).toBeNull();
    expect(result.saveError).toContain("读取现有视频分镜失败");
    expect(result.saveError).toContain("query boom");
    expect(runtimeCalls.some((call) => call.path === "/v1/data/sync")).toBe(false);
    expect(runtimeCalls.some((call) => call.method === "PUT")).toBe(false);
  });

  test("rejects sync success without matching storyboard readback for multi-scene docs", async () => {
    // ≥2 scenes require docId sync; failed readback must not open any URL.
    const run = singleSceneRun({
      scenes: [
        { id: "scene_1", name: "开场", prompt: "商品特写", duration: 5 },
        { id: "scene_2", name: "卖点", prompt: "功能演示", duration: 5 },
      ],
    });
    runtimeHandler = async (requestPath) => {
      if (requestPath === "/v1/data/sync") {
        return {
          success: true,
          data: { id: "rec_video", docId: "pvs_tmp" },
        };
      }
      if (requestPath === "/v1/data/query") {
        return {
          success: true,
          data: {
            records: [{
              _recordId: "rec_video",
              docId: "pvs_tmp",
              run: {
                ...run,
                scenes: [
                  { ...run.scenes[0], prompt: "内容被改写" },
                  run.scenes[1],
                ],
              },
            }],
          },
        };
      }
      throw new Error(`unexpected path ${requestPath}`);
    };

    const result = await buildVideoStoryboardTaskUrlAsync(
      "https://ai.wodeapp.cn/video",
      run,
      { projectHints: { slug: "video-demo" } },
    );

    expect(result.url).toBeNull();
    expect(result.saveError).toContain("readback failed");
  });

  test("returns shareDoc=pvs_* after verified sync", async () => {
    const run = singleSceneRun();
    let syncedDocId = "";

    runtimeHandler = async (requestPath, init) => {
      if (requestPath === "/v1/data/sync") {
        const body = JSON.parse(init?.body || "{}") as {
          data?: { docId?: string };
        };
        syncedDocId = String(body.data?.docId || "");
        return {
          success: true,
          data: { id: "rec_video_ok", docId: syncedDocId },
        };
      }
      if (requestPath === "/v1/data/query") {
        return {
          success: true,
          data: {
            records: [{
              _recordId: "rec_video_ok",
              docId: syncedDocId,
              run,
            }],
          },
        };
      }
      throw new Error(`unexpected path ${requestPath}`);
    };

    const result = await buildVideoStoryboardTaskUrlAsync(
      "https://ai.wodeapp.cn/video",
      run,
      { projectHints: { projectId: "proj_video_ok" } },
    );

    expect(syncedDocId.startsWith("pvs_")).toBe(true);
    expect(result.shareDocId).toBe(syncedDocId);
    expect(result.syncDiagnostic?.verified).toBe(true);
    expect(new URL(result.url || "").searchParams.get("shareDoc")).toBe(syncedDocId);
  });

  test("keeps shareDoc normalization strict so raw base64 cannot pretend to be a pvs_* docId", () => {
    expect(normalizeShareDocId("pvs_demo_20260720_abcd")).toBe("pvs_demo_20260720_abcd");
    expect(normalizeShareDocId("eyJzY2VuZXMiOltdfQ==")).toBeNull();
    // Explicit inline helper still exists for tiny payloads, but must not go through normalizeShareDocId.
    const inline = attachStoryboardPayloadToWorkbenchUrl(
      "https://ai.wodeapp.cn/video",
      "eyJzY2VuZXMiOltdfQ==",
    );
    expect(new URL(inline || "").searchParams.get("shareDoc")).toBe("eyJzY2VuZXMiOltdfQ==");
  });
});

describe("WodeAppX prepare/open billing boundary contracts", () => {
  test("batch image open prepare path never starts a remote billed run", async () => {
    const source = await readFile(path.resolve(
      import.meta.dir,
      "../src/react-app/domains/wodeapp/wodeapp-session-control-actions.tsx",
    ), "utf8");
    const start = source.indexOf("function buildBatchImageControlAction(");
    const end = source.indexOf("function buildGenerationHistorySaveControlAction(", start);
    const actionSource = start >= 0 && end > start ? source.slice(start, end) : "";

    expect(actionSource).toContain('stage: "prepare_batch_image"');
    expect(actionSource).toContain("generationStarted: false");
    expect(actionSource).toContain("confirmRunRequired: true");
    expect(actionSource).toContain("PRODUCT_IMAGES_NOT_SYNCED");
    expect(actionSource).toContain("validateRemoteReadyProductImageUrls");
    expect(actionSource).toContain("inferredImageCount || 10");
    expect(actionSource).toContain('const activeMode = "full" as const;');
    expect(actionSource).not.toContain("creativeTypes: []");
    expect(actionSource).not.toContain("runProductVisualBatchImageRemote");
  });

  test("video storyboard handoff blocks references that are not HTTPS cloud assets", async () => {
    const source = await readFile(path.resolve(
      import.meta.dir,
      "../src/react-app/domains/wodeapp/wodeapp-session-control-actions.tsx",
    ), "utf8");
    const start = source.indexOf("function buildVideoStoryboardControlAction(");
    const end = source.indexOf("export function useWodeAppSessionControlActions(", start);
    const actionSource = start >= 0 && end > start ? source.slice(start, end) : "";

    expect(actionSource).toContain("validateRemoteReadyProductImageUrls");
    expect(actionSource).toContain("VIDEO_REFERENCE_IMAGES_NOT_SYNCED");
    expect(actionSource).toContain('status: "reference_images_not_synced"');
    expect(actionSource).toContain('fallbackTool: "wodeapp_image_asset_save"');
    expect(actionSource).toContain("correctiveAction");
    expect(actionSource).toContain("wodeapp_image_asset_save");
    expect(actionSource).not.toContain("【硬规则");
    expect(actionSource.length).toBeLessThan(12_000);
  });

  test("image asset save is a typed direct tool separate from product save", async () => {
    const {
      WODEAPP_DIRECT_ACTION_CONTRACT_BY_ACTION_ID,
      WODEAPP_ASSET_DIRECT_TOOL_NAMES,
      WODEAPP_IMAGE_DIRECT_TOOL_NAMES,
    } = await import("@/react-app/domains/wodeapp/wodeapp-direct-action-contracts");
    const contract = WODEAPP_DIRECT_ACTION_CONTRACT_BY_ACTION_ID.get("wodeapp.image_asset.save");

    expect(contract?.toolName).toBe("wodeapp_image_asset_save");
    expect(contract?.groups.includes("assets")).toBe(true);
    expect(contract?.groups.includes("image")).toBe(true);
    expect(contract?.description).toContain("HTTPS");
    expect(contract?.inputSchema.properties.imageUrls?.description).toContain("禁止 data");
    expect(WODEAPP_ASSET_DIRECT_TOOL_NAMES).toContain("wodeapp_image_asset_save");
    expect(WODEAPP_IMAGE_DIRECT_TOOL_NAMES).toContain("wodeapp_image_asset_save");
  });

  test("direct prepare tool contract documents non-billing behavior", async () => {
    const {
      WODEAPP_DIRECT_ACTION_CONTRACT_BY_ACTION_ID,
    } = await import("@/react-app/domains/wodeapp/wodeapp-direct-action-contracts");
    const contract = WODEAPP_DIRECT_ACTION_CONTRACT_BY_ACTION_ID.get("wodeapp.batch_image.open");

    expect(contract?.toolName).toBe("wodeapp_batch_image_prepare");
    expect(contract?.description).toContain("不生图");
    expect(contract?.description).toContain("不扣费");
  });
});
