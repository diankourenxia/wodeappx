import { describe, expect, test } from "bun:test";
import { z } from "zod";

import {
  WODEAPP_ASSET_DIRECT_TOOL_NAMES,
  WODEAPP_DIRECT_ACTION_CONTRACTS,
  WODEAPP_DIRECT_TOOL_NAMES,
  WODEAPP_FOUNDATION_DIRECT_TOOL_NAMES,
  WODEAPP_IMAGE_DIRECT_TOOL_NAMES,
  directActionInputSchemaToRendererArgs,
  type WodeAppDirectActionContract,
  type WodeAppJsonSchema,
} from "./wodeapp-direct-action-contracts.js";
import {
  WODEAPP_UI_ACTION_UNAVAILABLE,
  assertUiActionInvocation,
  buildUiExecuteActionJsonSchema,
  buildWodeAppDirectTools,
  jsonSchemaToZod,
  modelVisibleUiActions,
  type WodeAppLiveUiAction,
  type WodeAppUiBridgeRequest,
  type WodeAppUiBridgeRequestOptions,
} from "./wodeapp-direct-tools.js";
import {
  clearXlsExtractionGateForTests,
  recordXlsExtractionOutcome,
} from "./wodeapp-xls-save-gate.js";

function contractByActionId(actionId: string): WodeAppDirectActionContract {
  const contract = WODEAPP_DIRECT_ACTION_CONTRACTS.find((candidate) => candidate.actionId === actionId);
  if (!contract) throw new Error(`Missing test contract: ${actionId}`);
  return contract;
}

function liveAction(
  contract: WodeAppDirectActionContract,
  overrides: Partial<WodeAppLiveUiAction> = {},
): WodeAppLiveUiAction {
  return {
    id: contract.actionId,
    label: contract.label,
    effect: contract.effect,
    approval: contract.approval,
    disabled: false,
    args: directActionInputSchemaToRendererArgs(contract.inputSchema),
    ...overrides,
  };
}

function actionIdEnum(schema: WodeAppJsonSchema): readonly unknown[] {
  return schema.properties?.actionId?.enum ?? [];
}

describe("WodeApp direct OpenCode tools", () => {
  test("derives direct tool groups from the canonical registry", () => {
    expect(WODEAPP_DIRECT_TOOL_NAMES).toEqual(
      WODEAPP_DIRECT_ACTION_CONTRACTS.map((contract) => contract.toolName),
    );
    expect(WODEAPP_FOUNDATION_DIRECT_TOOL_NAMES).toEqual(
      WODEAPP_DIRECT_ACTION_CONTRACTS
        .filter((contract) => contract.groups.some((group) => group === "foundation"))
        .map((contract) => contract.toolName),
    );
    expect(WODEAPP_ASSET_DIRECT_TOOL_NAMES).toEqual(
      WODEAPP_DIRECT_ACTION_CONTRACTS
        .filter((contract) => contract.groups.some((group) => group === "assets"))
        .map((contract) => contract.toolName),
    );
    expect(WODEAPP_IMAGE_DIRECT_TOOL_NAMES).toEqual(
      WODEAPP_DIRECT_ACTION_CONTRACTS
        .filter((contract) => contract.groups.some((group) => group === "image"))
        .map((contract) => contract.toolName),
    );
    expect(WODEAPP_FOUNDATION_DIRECT_TOOL_NAMES).toEqual(["wodeapp_auth_status"]);
    expect(WODEAPP_IMAGE_DIRECT_TOOL_NAMES).toEqual([
      "wodeapp_image_asset_save",
      "wodeapp_batch_image_prepare",
    ]);
    expect(WODEAPP_DIRECT_ACTION_CONTRACTS.every((contract) => contract.groups.length > 0)).toBe(true);
  });

  test("exposes image asset save as a non-product HTTPS materialize tool", () => {
    const contract = contractByActionId("wodeapp.image_asset.save");
    const schema = jsonSchemaToZod(contract.inputSchema);

    expect(contract).toMatchObject({
      toolName: "wodeapp_image_asset_save",
      effect: "write",
      approval: "auto",
    });
    expect(contract.description).toContain("selectedImageIds");
    expect(contract.description).toContain("imageUrls");
    expect(contract.description).toContain("requireHttps");
    expect(schema.parse({
      name: "场景参考",
      imageUrls: ["https://assets.example.com/scene.png"],
    })).toEqual({
      name: "场景参考",
      imageUrls: ["https://assets.example.com/scene.png"],
    });
    expect(schema.parse({ name: "仅名称" })).toEqual({ name: "仅名称" });
    expect(() => schema.parse({})).toThrow();
  });

  test("exposes batch image preparation as a fixed non-billing direct tool", () => {
    const prepareContract = contractByActionId("wodeapp.batch_image.open");
    const prepareSchema = jsonSchemaToZod(prepareContract.inputSchema);

    expect(prepareContract).toMatchObject({
      toolName: "wodeapp_batch_image_prepare",
      effect: "write",
      approval: "auto",
    });
    expect(prepareContract.description).toMatch(/不生图|不扣费|预填/);
    expect(prepareContract.description).toContain("product_visual_batch_image_run");
    expect(prepareSchema.parse({
      productName: "测试商品",
      productImages: ["https://assets.example.com/product.png"],
      showUi: false,
    })).toEqual({
      productName: "测试商品",
      productImages: ["https://assets.example.com/product.png"],
      showUi: false,
    });
    expect(() => prepareSchema.parse({
      productName: "测试商品",
      confirmRun: true,
    })).toThrow();
  });

  test("keeps approval in runtime metadata and splits dedupe preview from deletion", () => {
    const deleteContract = contractByActionId("wodeapp.assets.delete");
    const previewContract = contractByActionId("wodeapp.assets.dedupe.preview");
    const dedupeContract = contractByActionId("wodeapp.assets.dedupe");
    const deleteSchema = jsonSchemaToZod(deleteContract.inputSchema);
    const previewSchema = jsonSchemaToZod(previewContract.inputSchema);
    const dedupeSchema = jsonSchemaToZod(dedupeContract.inputSchema);

    expect(deleteContract).toMatchObject({ effect: "destructive", approval: "prompt" });
    expect(previewContract).toMatchObject({
      toolName: "wodeapp_assets_dedupe_preview",
      effect: "read",
      approval: "auto",
    });
    expect(dedupeContract).toMatchObject({ effect: "destructive", approval: "prompt" });

    expect(deleteContract.inputSchema.properties).not.toHaveProperty("confirmed");
    expect(previewContract.inputSchema.properties).not.toHaveProperty("dryRun");
    expect(previewContract.inputSchema.properties).not.toHaveProperty("confirmed");
    expect(dedupeContract.inputSchema.properties).not.toHaveProperty("dryRun");
    expect(dedupeContract.inputSchema.properties).not.toHaveProperty("confirmed");

    expect(() => deleteSchema.parse({})).toThrow();
    expect(deleteSchema.parse({ assetId: "asset-1" })).toEqual({ assetId: "asset-1" });
    expect(() => deleteSchema.parse({ assetId: "asset-1", confirmed: true })).toThrow();
    expect(previewSchema.parse({ keep: "newest" })).toEqual({ keep: "newest" });
    expect(() => previewSchema.parse({ dryRun: true })).toThrow();
    expect(dedupeSchema.parse({ keep: "oldest" })).toEqual({ keep: "oldest" });
    expect(() => dedupeSchema.parse({ confirmed: true })).toThrow();
  });

  test("routes dedupe preview and deletion through distinct fixed renderer actions", async () => {
    const previewContract = contractByActionId("wodeapp.assets.dedupe.preview");
    const dedupeContract = contractByActionId("wodeapp.assets.dedupe");
    const calls: Array<{ path: string; options?: WodeAppUiBridgeRequestOptions }> = [];
    const tools = buildWodeAppDirectTools({
      bridgeRequest: async (path, options) => {
        calls.push({ path, options });
        if (path === "/actions") {
          return {
            ok: true,
            actions: [liveAction(previewContract), liveAction(dedupeContract)],
          };
        }
        return { ok: true };
      },
    });

    await tools.wodeapp_assets_dedupe_preview.execute({ kind: "商品库", keep: "newest" });
    await tools.wodeapp_assets_dedupe.execute({ kind: "商品库", keep: "newest" });

    expect(calls.map((call) => call.path)).toEqual([
      "/actions",
      "/execute",
      "/actions",
      "/execute",
    ]);
    expect(calls[1].options?.body).toEqual({
      actionId: "wodeapp.assets.dedupe.preview",
      args: { kind: "商品库", keep: "newest" },
    });
    expect(calls[3].options?.body).toEqual({
      actionId: "wodeapp.assets.dedupe",
      args: { kind: "商品库", keep: "newest" },
    });
  });

  test("forwards OpenCode caller sessionId on /execute", async () => {
    const storyboard = contractByActionId("wodeapp.video_storyboard.open");
    const calls: Array<{ path: string; options?: WodeAppUiBridgeRequestOptions }> = [];
    const tools = buildWodeAppDirectTools({
      bridgeRequest: async (path, options) => {
        calls.push({ path, options });
        if (path === "/actions") {
          return { ok: true, actions: [liveAction(storyboard)] };
        }
        return { ok: true, actionId: storyboard.actionId, result: { opened: true } };
      },
    });

    await tools.wodeapp_video_storyboard_open.execute(
      {
        scenes: [{ name: "镜头1", prompt: "测试分镜" }],
      },
      { sessionID: "ses_background_caller" },
    );

    expect(calls.map((call) => call.path)).toEqual(["/actions", "/execute"]);
    expect(calls[1].options?.body).toEqual({
      actionId: "wodeapp.video_storyboard.open",
      args: {
        scenes: [{ name: "镜头1", prompt: "测试分镜" }],
      },
      sessionId: "ses_background_caller",
    });
  });

  test("exposes video_generate and video_task_status as typed direct tools", async () => {
    const generate = contractByActionId("wodeapp.video.generate");
    const status = contractByActionId("wodeapp.video.status");
    const generateSchema = jsonSchemaToZod(generate.inputSchema);
    const statusSchema = jsonSchemaToZod(status.inputSchema);
    const calls: Array<{ path: string; options?: WodeAppUiBridgeRequestOptions }> = [];
    const tools = buildWodeAppDirectTools({
      bridgeRequest: async (path, options) => {
        calls.push({ path, options });
        if (path === "/actions") {
          return { ok: true, actions: [liveAction(generate), liveAction(status)] };
        }
        return {
          ok: true,
          actionId: (options?.body as { actionId?: string } | undefined)?.actionId,
          result: { taskId: "vtask_test", status: "succeed" },
        };
      },
    });

    expect(generate).toMatchObject({
      toolName: "video_generate",
      effect: "write",
      approval: "auto",
    });
    expect(status).toMatchObject({
      toolName: "video_task_status",
      effect: "read",
      approval: "auto",
    });
    expect(generate.description).toContain("首尾帧");
    expect(generate.description).toContain("image-to-video");
    expect(generateSchema.parse({
      prompt: "按摩椅首尾帧环绕运镜",
      taskType: "firstlast",
      referenceImages: [
        "https://assets.example.com/start.jpg",
        "https://assets.example.com/end.jpg",
      ],
      durationSec: 8,
    })).toMatchObject({
      prompt: "按摩椅首尾帧环绕运镜",
      taskType: "firstlast",
      durationSec: 8,
    });
    expect(() => generateSchema.parse({})).toThrow();
    expect(statusSchema.parse({ taskId: "vtask_1" })).toEqual({ taskId: "vtask_1" });
    expect(() => statusSchema.parse({})).toThrow();

    await tools.video_generate.execute({
      prompt: "按摩椅首尾帧环绕运镜",
      taskType: "firstlast",
      referenceImages: [
        "https://assets.example.com/start.jpg",
        "https://assets.example.com/end.jpg",
      ],
    });
    await tools.video_task_status.execute({ taskId: "vtask_test" });

    expect(calls.map((call) => call.path)).toEqual([
      "/actions",
      "/execute",
      "/actions",
      "/execute",
    ]);
    expect(calls[1].options?.body).toMatchObject({
      actionId: "wodeapp.video.generate",
      args: {
        prompt: "按摩椅首尾帧环绕运镜",
        taskType: "firstlast",
      },
    });
    expect(calls[3].options?.body).toEqual({
      actionId: "wodeapp.video.status",
      args: { taskId: "vtask_test" },
    });
    expect(WODEAPP_DIRECT_TOOL_NAMES).toContain("video_generate");
    expect(WODEAPP_DIRECT_TOOL_NAMES).toContain("video_task_status");
  });

  test("generates one fixed-action tool for every direct contract", async () => {
    const product = contractByActionId("wodeapp.product.save");
    const calls: Array<{ path: string; options?: WodeAppUiBridgeRequestOptions }> = [];
    const bridgeRequest: WodeAppUiBridgeRequest = async (path, options) => {
      calls.push({ path, options });
      if (path === "/actions") return { ok: true, actions: [liveAction(product)] };
      return { ok: true, actionId: product.actionId, result: { assetId: "product-1" } };
    };
    const tools = buildWodeAppDirectTools({ bridgeRequest });

    expect(Object.keys(tools).sort()).toEqual(
      WODEAPP_DIRECT_ACTION_CONTRACTS.map((contract) => contract.toolName).sort(),
    );
    for (const definition of Object.values(tools)) {
      expect(Object.prototype.hasOwnProperty.call(definition.args, "actionId")).toBe(false);
    }

    await tools.wodeapp_product_save.execute({
      name: "真人测试商品",
      assetFiles: [{
        url: "file:///tmp/spec.pdf",
        name: "spec.pdf",
        type: "application/pdf",
        mediaType: "document",
      }],
    });

    expect(calls.map((call) => call.path)).toEqual(["/actions", "/execute"]);
    expect(calls[1].options).toMatchObject({
      method: "POST",
      body: {
        actionId: "wodeapp.product.save",
        args: {
          name: "真人测试商品",
          assetFiles: [{
            url: "file:///tmp/spec.pdf",
            name: "spec.pdf",
            type: "application/pdf",
            mediaType: "document",
          }],
        },
      },
    });
  });

  test("blocks product save after a failed XLS extraction in the same turn", async () => {
    clearXlsExtractionGateForTests();
    const product = contractByActionId("wodeapp.product.save");
    const calls: string[] = [];
    const tools = buildWodeAppDirectTools({
      bridgeRequest: async (path) => {
        calls.push(path);
        if (path === "/actions") return { ok: true, actions: [liveAction(product)] };
        return { ok: true, verified: true, assetId: "product-after-xls" };
      },
    });
    const context = {
      sessionID: "ses_xls_gate",
      messageID: "msg_xls_gate",
    };
    const filePath = "/tmp/blocked-product.xls";

    try {
      recordXlsExtractionOutcome(context, filePath, {
        ok: false,
        data: {
          code: "XLS_CORRUPT",
          productSaveAllowed: false,
        },
      });
      await expect(tools.wodeapp_product_save.execute({ name: "不应保存的商品" }, context))
        .rejects.toMatchObject({
          data: {
            code: "XLS_PRODUCT_SAVE_BLOCKED",
            productSaveAllowed: false,
          },
        });
      expect(calls).toEqual([]);

      recordXlsExtractionOutcome(context, filePath, {
        ok: true,
        productSaveAllowed: true,
      });
      await expect(tools.wodeapp_product_save.execute({ name: "已核验商品" }, context))
        .resolves.toContain('"assetId": "product-after-xls"');
      expect(calls).toEqual(["/actions", "/execute"]);
    } finally {
      clearXlsExtractionGateForTests();
    }
  });

  test("rejects unknown top-level fields and invalid nested assetFiles before bridge access", async () => {
    let bridgeCalls = 0;
    const tools = buildWodeAppDirectTools({
      bridgeRequest: async () => {
        bridgeCalls += 1;
        return { ok: true, actions: [] };
      },
    });

    await expect(tools.wodeapp_product_save.execute({
      name: "商品",
      actionId: "wodeapp.assets.update",
    })).rejects.toBeInstanceOf(z.ZodError);
    await expect(tools.wodeapp_product_save.execute({
      name: "商品",
      assetFiles: [{
        url: "file:///tmp/spec.pdf",
        name: "spec.pdf",
        type: "application/pdf",
        mediaType: "image",
      }],
    })).rejects.toBeInstanceOf(z.ZodError);
    await expect(tools.wodeapp_product_save.execute({
      name: "商品",
      assetFiles: [{ url: "file:///tmp/spec.pdf", type: "application/pdf" }],
    })).rejects.toBeInstanceOf(z.ZodError);

    expect(bridgeCalls).toBe(0);
  });

  test("recursively enforces object, array, primitive, union, and uniqueness constraints", () => {
    const schema = jsonSchemaToZod({
      type: "object",
      properties: {
        rows: {
          type: "array",
          minItems: 1,
          uniqueItems: true,
          items: {
            type: "object",
            properties: {
              count: { type: "integer", minimum: 1 },
              state: { type: "string", enum: ["ready", "done"] },
            },
            required: ["count", "state"],
            additionalProperties: false,
          },
        },
      },
      required: ["rows"],
      additionalProperties: false,
    });

    expect(schema.parse({ rows: [{ count: 1, state: "ready" }] })).toEqual({
      rows: [{ count: 1, state: "ready" }],
    });
    expect(() => schema.parse({ rows: [{ count: 1.5, state: "ready" }] })).toThrow();
    expect(() => schema.parse({ rows: [{ count: 1, state: "guessed" }] })).toThrow();
    expect(() => schema.parse({ rows: [{ count: 1, state: "ready", guessed: true }] })).toThrow();
    expect(() => schema.parse({
      rows: [
        { count: 1, state: "ready" },
        { state: "ready", count: 1 },
      ],
    })).toThrow();
  });

  test("fails closed on live contract drift before calling /execute", async () => {
    const product = contractByActionId("wodeapp.product.save");
    const driftedArgs = directActionInputSchemaToRendererArgs(product.inputSchema).map((argument) => (
      argument.name === "name" ? { ...argument, type: "number" as const } : argument
    ));
    const calls: string[] = [];
    const tools = buildWodeAppDirectTools({
      bridgeRequest: async (path) => {
        calls.push(path);
        if (path === "/actions") {
          return { ok: true, actions: [liveAction(product, { args: driftedArgs })] };
        }
        return { ok: true };
      },
    });

    await expect(tools.wodeapp_product_save.execute({ name: "商品" }))
      .rejects.toThrow(/contract drift/);
    expect(calls).toEqual(["/actions"]);
  });

  test("allows additive optional arg rollout drift either side", async () => {
    const storyboard = contractByActionId("wodeapp.video_storyboard.open");
    const expectedArgs = directActionInputSchemaToRendererArgs(storyboard.inputSchema);
    const olderLiveArgs = expectedArgs.filter((argument) => argument.name !== "model" && argument.name !== "modelId");
    const newerLiveArgs = [
      ...expectedArgs,
      { name: "experimentalFlag", type: "string" as const, required: false },
    ];
    const calls: string[] = [];
    const tools = buildWodeAppDirectTools({
      bridgeRequest: async (path, options) => {
        calls.push(path);
        if (path === "/actions") {
          const useOlder = calls.filter((item) => item === "/actions").length === 1;
          return {
            ok: true,
            actions: [liveAction(storyboard, { args: useOlder ? olderLiveArgs : newerLiveArgs })],
          };
        }
        return { ok: true, actionId: storyboard.actionId, result: { opened: true, echo: options?.body } };
      },
    });

    await expect(tools.wodeapp_video_storyboard_open.execute({
      scenes: [{ prompt: "展示商品", duration: 10 }],
    })).resolves.toContain('"opened": true');
    await expect(tools.wodeapp_video_storyboard_open.execute({
      scenes: [{ prompt: "展示商品", duration: 10 }],
      model: "seedance-2-5",
    })).resolves.toContain('"opened": true');
    expect(calls).toEqual(["/actions", "/execute", "/actions", "/execute"]);
  });

  test("fails closed when live drops a required arg", async () => {
    const storyboard = contractByActionId("wodeapp.video_storyboard.open");
    const withoutScenes = directActionInputSchemaToRendererArgs(storyboard.inputSchema)
      .filter((argument) => argument.name !== "scenes");
    const tools = buildWodeAppDirectTools({
      bridgeRequest: async (path) => {
        if (path === "/actions") {
          return { ok: true, actions: [liveAction(storyboard, { args: withoutScenes })] };
        }
        return { ok: true };
      },
    });

    await expect(tools.wodeapp_video_storyboard_open.execute({
      scenes: [{ prompt: "展示商品", duration: 10 }],
    })).rejects.toThrow(/missing required live arg scenes/);
  });

  test("storyboard update requires shareDocId and accepts delta scenes", async () => {
    const update = contractByActionId("wodeapp.video_storyboard.update");
    expect(update.inputSchema.required).toEqual(["shareDocId"]);
    expect(update.inputSchema.properties.scenes?.maxItems).toBe(25);
    const tools = buildWodeAppDirectTools({
      bridgeRequest: async (path, options) => {
        if (path === "/actions") {
          return { ok: true, actions: [liveAction(update)] };
        }
        return { ok: true, actionId: update.actionId, result: { updated: true, echo: options?.body } };
      },
    });

    await expect(tools.wodeapp_video_storyboard_update.execute({
      shareDocId: "pvs_demo_20260724",
      scenes: [{ name: "11-1", prompt: "雨夜对视", duration: 15 }],
    })).resolves.toContain('"updated": true');

    await expect(tools.wodeapp_video_storyboard_update.execute({
      scenes: [{ prompt: "missing share doc" }],
    })).rejects.toThrow();
  });

  test("allows non-destructive approval rollout drift", async () => {
    const product = contractByActionId("wodeapp.product.save");
    const calls: string[] = [];
    const tools = buildWodeAppDirectTools({
      bridgeRequest: async (path) => {
        calls.push(path);
        if (path === "/actions") {
          return { ok: true, actions: [liveAction(product, { approval: "prompt" })] };
        }
        return { ok: true, actionId: product.actionId, result: { savedCount: 1 } };
      },
    });

    await expect(tools.wodeapp_product_save.execute({ name: "商品" })).resolves.toContain('"savedCount": 1');
    expect(calls).toEqual(["/actions", "/execute"]);
  });

  test("keeps destructive approval fail-closed", async () => {
    const deleteContract = contractByActionId("wodeapp.assets.delete");
    const calls: string[] = [];
    const tools = buildWodeAppDirectTools({
      bridgeRequest: async (path) => {
        calls.push(path);
        if (path === "/actions") {
          return { ok: true, actions: [liveAction(deleteContract, { approval: "auto" })] };
        }
        return { ok: true };
      },
    });

    await expect(tools.wodeapp_assets_delete.execute({ assetId: "asset-1" }))
      .rejects.toThrow(/destructive actions require prompt approval/);
    expect(calls).toEqual(["/actions"]);
  });
});

describe("generic UI action boundary", () => {
  const navigationAction: WodeAppLiveUiAction = {
    id: "settings.panel.open",
    label: "打开设置",
    effect: "read",
    approval: "auto",
    disabled: false,
    args: [
      { name: "panel", type: "string", required: true },
      { name: "focus", type: "boolean", required: false },
    ],
  };

  test("enum excludes direct actions, disabled actions, and every guessed id from the failure", () => {
    const product = contractByActionId("wodeapp.product.save");
    const payload = {
      ok: true,
      actions: [
        navigationAction,
        liveAction(product),
        { ...navigationAction, id: "session.delete", disabled: true },
      ],
    };
    const visible = modelVisibleUiActions(payload);
    const schema = buildUiExecuteActionJsonSchema(payload);
    const ids = actionIdEnum(schema);

    expect(visible.map((action) => action.id)).toEqual(["settings.panel.open"]);
    expect(ids).toEqual(["settings.panel.open"]);
    expect(schema.oneOf).toBeUndefined();
    expect(ids).not.toContain("wodeapp.product.save");
    expect(ids).not.toContain("session.delete");
    expect(ids).not.toContain("openwork_ui_list_actions");
    expect(ids).not.toContain("wodeappx_list_capabilities");
    expect(ids).not.toContain("wodeapp.assets.update");
  });

  test("guessed ids and malformed args fail before a bridge execute can happen", () => {
    const payload = { ok: true, actions: [navigationAction] };
    let bridgeExecuteCalls = 0;
    const validatedExecute = (actionId: string, args: unknown) => {
      const validatedArgs = assertUiActionInvocation(payload, actionId, args);
      bridgeExecuteCalls += 1;
      return { actionId, args: validatedArgs };
    };

    for (const guessed of [
      "openwork_ui_list_actions",
      "wodeappx_list_capabilities",
      "wodeapp.assets.update",
    ]) {
      expect(() => validatedExecute(guessed, {})).toThrow(/not model-visible/);
    }
    expect(() => validatedExecute("settings.panel.open", {})).toThrow(/panel required/);
    expect(() => validatedExecute("settings.panel.open", { panel: 42 })).toThrow(/panel must be string/);
    expect(bridgeExecuteCalls).toBe(0);
    // Unknown extras are stripped (not fatal) so model slips like aspectRatio on
    // a sibling schema do not block the call.
    expect(validatedExecute("settings.panel.open", { panel: "account", guessed: true })).toEqual({
      actionId: "settings.panel.open",
      args: { panel: "account" },
    });
    expect(bridgeExecuteCalls).toBe(1);

    expect(validatedExecute("settings.panel.open", { panel: "account", focus: "true" })).toEqual({
      actionId: "settings.panel.open",
      args: { panel: "account", focus: true },
    });
    expect(bridgeExecuteCalls).toBe(2);
  });

  test("array args unwrap MiniMax {item:[...]} wrappers before type checks", () => {
    const actionWithImages = {
      id: "studio.batch_preview.open",
      label: "batch",
      disabled: false,
      args: [
        { name: "productImages", type: "array", required: false },
        { name: "prompt", type: "string", required: false },
      ],
    };
    const payload = { ok: true, actions: [actionWithImages] };
    expect(assertUiActionInvocation(payload, "studio.batch_preview.open", {
      prompt: "出图",
      productImages: { item: ["https://a.example/1.png", "https://a.example/2.png"] },
    })).toEqual({
      prompt: "出图",
      productImages: ["https://a.example/1.png", "https://a.example/2.png"],
    });
    expect(assertUiActionInvocation(payload, "studio.batch_preview.open", {
      productImages: "https://a.example/1.png",
    })).toEqual({
      productImages: ["https://a.example/1.png"],
    });
  });

  test("an empty live catalog is closed with an unavailable sentinel", () => {
    const schema = buildUiExecuteActionJsonSchema({ ok: true, actions: [] });
    expect(actionIdEnum(schema)).toEqual([WODEAPP_UI_ACTION_UNAVAILABLE]);
    expect(() => assertUiActionInvocation({ ok: true, actions: [] }, WODEAPP_UI_ACTION_UNAVAILABLE, {}))
      .toThrow(/not model-visible/);
  });
});
