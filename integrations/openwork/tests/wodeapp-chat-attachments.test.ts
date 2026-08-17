import { describe, expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";

import type { ComposerAttachment, ComposerDraft } from "../src/app/types";
import {
  attachmentContextCanBeDehydrated,
  attachmentDisplayPlaceholderFromTextPart,
  buildAttachmentDisplayParts,
  buildAttachmentIntelligenceHistoryStub,
  buildAttachmentIntelligencePart,
  buildAttachmentRequirementsFromDraft,
  buildVisionEphemeralFollowupPart,
  CHAT_IMAGE_PATH_GUARD,
  collectDraftAttachmentInputs,
  draftRequestsAssetVisualUnderstanding,
  draftRequestsAssetVisualInspect,
  draftRequestsAssetGeneration,
  draftRequestsAssetForceReparse,
  draftRequestsAttachmentUse,
  isHiddenAttachmentIntelligenceText,
  shouldPreserveAttachmentsAsDisplayOnly,
  shouldIncludeAssetMentionFilesInPrompt,
  shouldIncludeRawAttachmentsInPrompt,
  shouldUseAttachmentIntelligence,
  understandDraftAttachments,
  WODEAPP_ATTACHMENT_INTELLIGENCE_COMPACTED_MARKER,
} from "../src/react-app/domains/wodeapp/wodeapp-attachment-intelligence";
import {
  draftRequestsAdditionalAttachmentWork,
  draftRequestsDigitalAssetSave,
  draftRequestsOnlyProductLibrarySave,
  draftRequestsProductLibrarySave,
  extractChatAttachmentAssetName,
  inspectChatAttachmentContent,
  mergeExistingProductWithChatAsset,
  resolveChatAttachmentUrlForStorage,
} from "../src/react-app/domains/wodeapp/wodeapp-chat-asset-sync";
import { selectVideoStoryboardAssetImages } from "../src/react-app/domains/wodeapp/wodeapp-video-storyboard-assets";
import {
  findExistingProductAssetIdForSave,
  normalizeLocalAsset,
} from "../src/react-app/domains/wodeapp/digital-assets-store";
import { assetMentionFileParts } from "../src/react-app/shell/asset-mention-file-parts";
import { isClearlyNonImageAssetUrl } from "../src/react-app/domains/wodeapp/wodeapp-digital-asset-contract";
import {
  WODEAPP_DIRECT_ACTION_CONTRACT_BY_ACTION_ID,
  isDurableProductImageUrl,
  validateDurableProductImageUrls,
  validateProductImageExpectation,
} from "../src/react-app/domains/wodeapp/wodeapp-direct-action-contracts";
import { routeWodeAppCapabilities } from "../src/react-app/domains/wodeapp/wodeapp-capability-routing";

function attachment(input: {
  id: string;
  name: string;
  mimeType: string;
  kind: ComposerAttachment["kind"];
}): ComposerAttachment {
  const file = new File([new Uint8Array([0, 0, 0, 24])], input.name, { type: input.mimeType });
  return {
    ...input,
    file,
    size: file.size,
  };
}

function draft(text: string, attachments: ComposerAttachment[]): ComposerDraft {
  return {
    mode: "prompt",
    parts: [],
    text,
    attachments,
  };
}

describe("WodeAppX chat attachment workflow", () => {
  test("reports visible stages while parsing a local text attachment", async () => {
    const textAttachment = attachment({
      id: "progress-text",
      name: "notes.txt",
      mimeType: "text/plain",
      kind: "file",
    });
    textAttachment.file = new File(["需要解析的正文"], textAttachment.name, { type: textAttachment.mimeType });
    textAttachment.size = textAttachment.file.size;
    const progress: string[] = [];

    const result = await understandDraftAttachments(
      draft("总结这个附件", [textAttachment]),
      false,
      { onProgress: (message) => progress.push(message) },
    );

    expect(result.combinedContext).toContain("需要解析的正文");
    expect(progress).toEqual([
      "已收到附件，正在读取…",
      "附件已解析，正在整理回答…",
    ]);
  });

  test("keeps hook and context modules free of business-library mutations", async () => {
    const sessionSurfaceSource = await readFile(
      new URL("../src/react-app/domains/session/surface/session-surface.tsx", import.meta.url),
      "utf8",
    );
    const hookDirectory = new URL("../src/react-app/domains/wodeapp/", import.meta.url);
    const hookLikeFiles = (await readdir(hookDirectory))
      .filter((name) => /(?:attachment|orchestration|handoff|sync|hook)/i.test(name) && /\.(?:ts|tsx)$/.test(name));
    const sources = await Promise.all([
      ...hookLikeFiles.map(async (name) => ({
        name,
        source: await readFile(new URL(name, hookDirectory), "utf8"),
      })),
      {
        name: "session-surface.tsx",
        source: sessionSurfaceSource,
      },
      {
        name: "session-route.tsx",
        source: await readFile(new URL("../src/react-app/shell/session-route.tsx", import.meta.url), "utf8"),
      },
    ]);
    const forbiddenBusinessMutators = [
      "depositChatAttachmentsToAssets",
      "saveChatAttachmentsToAssets",
      "saveLocalDigitalAsset",
      "saveBrandResearchAsset",
      "saveProductResearchAsset",
      "savePromptAsset",
      "saveGenerationHistoryAsset",
      "deleteLocalDigitalAsset",
      "deleteLocalDigitalAssets",
      "dedupeLocalDigitalAssets",
    ];

    expect(sessionSurfaceSource).toContain(
      "await props.onSendDraft(nextDraft, props.sessionId, setAttachmentUnderstandingLabel)",
    );
    for (const { name, source } of sources) {
      for (const mutator of forbiddenBusinessMutators) {
        expect(source, `${name} must not bypass executeTool with ${mutator}`).not.toContain(mutator);
      }
    }
    expect(sessionSurfaceSource).not.toContain("buildProductLibrarySaveConfirmationDraft");
  });

  test("uses native OpenCode compaction and cleans attachment context on session delete", async () => {
    const [routeSource, sidebarSource, providerSource] = await Promise.all([
      readFile(new URL("../src/react-app/shell/session-route.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/react-app/domains/session/sidebar/app-sidebar.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/react-app/domains/session/sidebar/app-sidebar-provider.tsx", import.meta.url), "utf8"),
    ]);

    expect(routeSource).toContain("compactSession(opencodeClient, normalizedSessionId");
    expect(routeSource).toContain("deleteAttachmentContextForSession(id)");
    expect(routeSource).not.toContain("function summarizeSessionHistory");
    expect(sidebarSource).toContain("压缩上下文");
    expect(sidebarSource).toContain("ctx.onCompactSession");
    expect(providerSource).toContain("onCompactSession?:");
  });

  test("exposes product persistence as one typed direct tool", async () => {
    const source = await readFile(
      new URL("../src/react-app/domains/wodeapp/wodeapp-session-control-actions.tsx", import.meta.url),
      "utf8",
    );
    const contract = WODEAPP_DIRECT_ACTION_CONTRACT_BY_ACTION_ID.get("wodeapp.product.save");

    expect(source).toContain('directActionMetadata("wodeapp.product.save")');
    expect(contract?.toolName).toBe("wodeapp_product_save");
    expect(contract?.inputSchema.properties.assetId?.type).toBe("string");
    expect(contract?.inputSchema.properties.assetFiles?.type).toBe("array");
    expect(contract?.inputSchema.properties.selectedImageIds?.type).toBe("array");
    expect(contract?.inputSchema.properties.expectedImageCount?.type).toBe("integer");
    expect(contract?.inputSchema.properties.sourceProductImages?.type).toBe("array");
    expect(contract?.inputSchema.properties.productImages?.type).toBe("array");
    expect(contract?.inputSchema.properties).not.toHaveProperty("actionId");
  });

  test("selects real product images for storyboard injection without duplicating the cover", () => {
    const images = Array.from({ length: 18 }, (_, index) => `wodeappx-asset://product/image-${index}.png`);
    expect(selectVideoStoryboardAssetImages({
      coverImage: images[0],
      productImages: images,
    })).toEqual(images.slice(0, 4));
  });

  test("can use a standalone image asset as the storyboard reference", () => {
    expect(selectVideoStoryboardAssetImages({
      assetFile: "wodeappx-asset://product/fingerprint-button.png",
      assetFileType: "image/png",
    })).toEqual(["wodeappx-asset://product/fingerprint-button.png"]);
  });

  test("extracts the requested digital asset name from each upload description", () => {
    expect(extractChatAttachmentAssetName(
      "这组图片作为同一组数字资产使用，名称记为 [阿尔法蛋 S1 多角度产品参考板]。",
    )).toBe("阿尔法蛋 S1 多角度产品参考板");
    expect(extractChatAttachmentAssetName(
      "这个视频叫 [阿尔法蛋 S1 开盖动作参考视频]，只用来参考真实开盖顺序。",
    )).toBe("阿尔法蛋 S1 开盖动作参考视频");
    expect(extractChatAttachmentAssetName(
      "这是阿尔法蛋 S1 的开盖演示，先帮我放进商品库，再看看操作步骤。",
    )).toBe("阿尔法蛋 S1");
    expect(extractChatAttachmentAssetName("没有提供显式资产名。")).toBeNull();
  });

  test("understands a short natural-language request to create one product entry", () => {
    const text = "这是阿尔法蛋 S1 的全部素材，帮我放进商品库，名字就叫阿尔法蛋 S1，后面做视频就用这些。";
    expect(extractChatAttachmentAssetName(text)).toBe("阿尔法蛋 S1");
    expect(draftRequestsProductLibrarySave(text)).toBe(true);
    expect(draftRequestsAdditionalAttachmentWork(text)).toBe(false);
    expect(draftRequestsOnlyProductLibrarySave(text)).toBe(true);
  });

  test("keeps ordinary task attachments temporary unless saving is explicit", () => {
    expect(draftRequestsDigitalAssetSave(
      "使用这些真实参考图生成 3 张商品主图，不要改变杯子结构。",
    )).toBe(false);
    expect(draftRequestsDigitalAssetSave(
      "分析这个开盖视频，告诉我白色管状部件怎么取出。",
    )).toBe(false);
    expect(draftRequestsDigitalAssetSave(
      "这些素材先放进商品库，名字叫阿尔法蛋 S1。",
    )).toBe(true);
    expect(draftRequestsDigitalAssetSave(
      "把这组图片保存到数字资产，名称记为产品参考图。",
    )).toBe(true);
    expect(draftRequestsDigitalAssetSave(
      "这些图片只用于本轮生成，不要保存到数字资产或商品库。",
    )).toBe(false);
    expect(draftRequestsDigitalAssetSave(
      "不要分析，直接放进商品库，名字叫阿尔法蛋 S1。",
    )).toBe(true);
  });

  test("understands bare 叫 naming and 商品库里留一个 dedupe wording", () => {
    const saveOnly = "这几个先帮我收进商品库，叫阿尔法蛋 S1 备用。先别分析，我过会儿再用。";
    expect(extractChatAttachmentAssetName(saveOnly)).toBe("阿尔法蛋 S1 备用");
    expect(draftRequestsProductLibrarySave(saveOnly)).toBe(true);
    expect(draftRequestsOnlyProductLibrarySave(saveOnly)).toBe(true);

    const dedupe = "这俩应该是同一个视频吧？帮我看看。要是重复，商品库里留一个就行，名字叫阿尔法蛋 S1 去重测试。";
    expect(extractChatAttachmentAssetName(dedupe)).toBe("阿尔法蛋 S1 去重测试");
    expect(draftRequestsProductLibrarySave(dedupe)).toBe(true);
  });

  test("adding chat media does not overwrite researched product information", () => {
    const merged = mergeExistingProductWithChatAsset({
      id: "local-product-1",
      name: "阿尔法蛋 S1",
      kind: "商品库",
      meta: "商品库",
      preview: "product",
      productInfo: "白色圆柱杯体，橙色翻盖，正面为黑色 A 按钮。",
      productProfile: { brandName: "阿尔法蛋", model: "S1" },
      assetTime: "刚刚",
      assetUse: "商品调研",
    }, {
      id: "local-chat-product-video",
      name: "阿尔法蛋 S1",
      kind: "商品库",
      meta: "1 个视频 · 商品库",
      preview: "product",
      assetFile: "file:///tmp/opening.mp4",
      assetFileName: "opening.mp4",
      assetFileType: "video/mp4",
      assetFiles: [{
        url: "file:///tmp/opening.mp4",
        name: "opening.mp4",
        type: "video/mp4",
        size: 100,
        mediaType: "video",
      }],
      assetTime: "刚刚",
      assetUse: "对话上传",
    });

    expect(merged.id).toBe("local-product-1");
    expect(merged.productInfo).toContain("白色圆柱杯体");
    expect(merged.productProfile).toMatchObject({ brandName: "阿尔法蛋", model: "S1" });
    expect(merged.assetFiles).toHaveLength(1);
    expect(merged.promptText).toBeUndefined();
  });

  test("migrates poisoned historical info from legacy local-product records", () => {
    const historicalTask = "商品库里留一个就行，名字叫阿尔法蛋 S1 去重测试。";
    const normalized = normalizeLocalAsset({
      id: "local-product-1784074961282",
      name: "阿尔法蛋 S1 去重测试",
      kind: "商品库",
      meta: "1 个视频 · 商品库",
      preview: "product",
      promptText: `${historicalTask}\n\n对话附件：opening.mp4`,
      productInfo: historicalTask,
      assetFile: "file:///tmp/opening.mp4",
      assetFileName: "opening.mp4",
      assetFileType: "video/mp4",
      assetTime: "刚刚",
      assetUse: "对话上传",
    });

    expect(normalized?.productInfo).toBeUndefined();
    expect(normalized?.promptText).toBeUndefined();
    expect(normalized?.assetFile).toBe("file:///tmp/opening.mp4");
  });

  test("reuses an existing product id when the normalized product name matches", () => {
    const id = findExistingProductAssetIdForSave([
      {
        id: "local-product-1784000000000",
        name: "阿尔法蛋智能指纹水杯 S1",
        kind: "商品库",
        meta: "3 张图片 · 商品库",
        preview: "product",
      },
      {
        id: "local-product-1785000000000",
        name: "阿尔法蛋智能指纹水杯-S1",
        kind: "商品库",
        meta: "6 张图片 · 商品库",
        preview: "product",
      },
    ], " 阿尔法蛋智能指纹水杯S1 ");

    expect(id).toBe("local-product-1785000000000");
  });

  test("uses content signatures instead of trusting an mp4 suffix", async () => {
    const fake = await inspectChatAttachmentContent({
      name: "not-a-video.mp4",
      mimeType: "video/mp4",
      bytes: new TextEncoder().encode("this is plain text"),
    });
    expect(fake.kind).toBe("video");
    expect(fake.integrityStatus).toBe("invalid");
    expect(fake.validationError).toContain("不匹配");

    const realHeader = new Uint8Array([
      0x00, 0x00, 0x00, 0x18,
      0x66, 0x74, 0x79, 0x70,
      0x69, 0x73, 0x6f, 0x6d,
      0x00, 0x00, 0x00, 0x00,
    ]);
    const first = await inspectChatAttachmentContent({ name: "a.mp4", mimeType: "video/mp4", bytes: realHeader });
    const second = await inspectChatAttachmentContent({ name: "renamed.mov", mimeType: "video/quicktime", bytes: realHeader });
    expect(first.integrityStatus).toBe("verified");
    expect(first.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(second.contentHash).toBe(first.contentHash);
  });

  test("verifies PDF file headers independently of the filename", async () => {
    const valid = await inspectChatAttachmentContent({
      name: "product.pdf",
      mimeType: "application/pdf",
      bytes: new TextEncoder().encode("%PDF-1.7\n1 0 obj\n"),
    });
    const invalid = await inspectChatAttachmentContent({
      name: "product.pdf",
      mimeType: "application/pdf",
      bytes: new TextEncoder().encode("not pdf"),
    });
    expect(valid.integrityStatus).toBe("verified");
    expect(invalid.integrityStatus).toBe("invalid");
  });

  test("prevents videos and documents from entering productImages", () => {
    expect(isClearlyNonImageAssetUrl("https://assets.example.com/opening.mp4")).toBe(true);
    expect(isClearlyNonImageAssetUrl("data:application/pdf;base64,JVBERg==")).toBe(true);
    expect(isClearlyNonImageAssetUrl("https://assets.example.com/product.png?token=1")).toBe(false);
    expect(isClearlyNonImageAssetUrl("data:image/png;base64,iVBORw0KGgo=")).toBe(false);
  });

  test("keeps attachments available when one message asks to save and continue working", () => {
    const text = "这是阿尔法蛋 S1 的开盖演示，先帮我放进商品库，再看看开盖和白色管状部件怎么操作，顺便做一张四宫格步骤图。";
    expect(draftRequestsProductLibrarySave(text)).toBe(true);
    expect(draftRequestsAdditionalAttachmentWork(text)).toBe(true);
    expect(draftRequestsOnlyProductLibrarySave(text)).toBe(false);
  });

  test("packs raw images into a vision-capable model instead of attachment intelligence", () => {
    const image = attachment({
      id: "image-product",
      name: "product.png",
      mimeType: "image/png",
      kind: "image",
    });
    const nextDraft = draft("请把这些图片作为 [产品多角度参考板] 使用", [image]);

    expect(shouldUseAttachmentIntelligence({
      enabled: true,
      draft: nextDraft,
      modelSupportsVision: true,
    })).toBe(false);
    expect(shouldIncludeRawAttachmentsInPrompt({
      modelSupportsVision: true,
      useAttachmentIntelligence: false,
      preserveAttachmentsAsDisplayOnly: false,
      draft: nextDraft,
    })).toEqual({ includeRawAttachments: true, imagesOnly: true });
  });

  test("skips remote attachment intelligence for local @ asset images when a vision model can inline them", () => {
    const productDraft = draft("看看 [阿尔法蛋 S1] 这个商品的素材", []);
    productDraft.assetMentions = [{
      id: "product-alphaegg",
      name: "阿尔法蛋 S1",
      kind: "商品库",
      meta: "18 张图片 · 1 个视频 · 1 份文件 · 商品库",
      productImages: ["wodeappx-asset://local/product.png"],
      assetFiles: [{
        url: "wodeappx-asset://local/product.pdf",
        name: "产品资料.pdf",
        type: "application/pdf",
        size: 1024,
      }],
    }];

    expect(draftRequestsAssetVisualInspect("看看 [阿尔法蛋 S1] 这个商品的素材")).toBe(true);
    expect(shouldUseAttachmentIntelligence({
      enabled: true,
      draft: productDraft,
      modelSupportsVision: true,
    })).toBe(false);
    expect(shouldIncludeAssetMentionFilesInPrompt({
      draft: productDraft,
      modelSupportsVision: true,
      useAttachmentIntelligence: false,
    })).toBe(true);
  });

  test("routes remote HTTPS @ images through attachment intelligence for visual inspection", () => {
    const productDraft = draft("核对一下杯盖颜色和 Logo 位置", []);
    productDraft.assetMentions = [{
      id: "product-https-only",
      name: "阿尔法蛋 S1",
      kind: "商品库",
      meta: "4 张图片 · 商品库",
      productImages: [
        "https://cdn.example.com/product-1.png",
        "https://cdn.example.com/product-2.png",
      ],
    }];

    expect(shouldUseAttachmentIntelligence({
      enabled: true,
      draft: productDraft,
      modelSupportsVision: true,
    })).toBe(true);
    expect(shouldIncludeAssetMentionFilesInPrompt({
      draft: productDraft,
      modelSupportsVision: true,
      useAttachmentIntelligence: true,
    })).toBe(false);
  });

  test("does not remotely re-parse @ product images for generation prompts", () => {
    const productDraft = draft("基于这个商品，批量生成一组电商主图", []);
    productDraft.assetMentions = [{
      id: "product-gen",
      name: "阿尔法蛋 S1",
      kind: "商品库",
      meta: "4 张图片 · 商品库",
      productImages: ["wodeappx-asset://local/product.png"],
    }];

    expect(draftRequestsAssetGeneration("基于这个商品，批量生成一组电商主图")).toBe(true);
    expect(draftRequestsAssetVisualInspect("基于这个商品，批量生成一组电商主图")).toBe(false);
    expect(shouldUseAttachmentIntelligence({
      enabled: true,
      draft: productDraft,
      modelSupportsVision: true,
    })).toBe(false);
    expect(shouldIncludeAssetMentionFilesInPrompt({
      draft: productDraft,
      modelSupportsVision: true,
      useAttachmentIntelligence: false,
    })).toBe(true);
  });

  test("does not remotely re-parse @ brand or model assets for generation prompts", () => {
    const draftWithAssets = draft("用这个真人和场景生成 3 张参考图", []);
    draftWithAssets.assetMentions = [
      {
        id: "model-1",
        name: "模特 A",
        kind: "真人/模特",
        meta: "真人库",
        assetImages: ["wodeappx-asset://local/model.png"],
      },
      {
        id: "scene-1",
        name: "客厅场景",
        kind: "场景",
        meta: "场景库",
        assetImages: ["wodeappx-asset://local/scene.png"],
      },
    ];

    expect(shouldUseAttachmentIntelligence({
      enabled: true,
      draft: draftWithAssets,
      modelSupportsVision: true,
    })).toBe(false);
    expect(shouldIncludeAssetMentionFilesInPrompt({
      draft: draftWithAssets,
      modelSupportsVision: true,
      useAttachmentIntelligence: false,
    })).toBe(true);
  });

  test("never emits remote HTTPS product images as OpenCode file parts", async () => {
    const parts = await assetMentionFileParts([{
      id: "product-file-parts",
      name: "测试商品",
      kind: "商品库",
      meta: "2 张图片",
      productImages: [
        "https://cdn.example.com/product-1.png",
        `data:image/png;base64,${Buffer.from("local-image").toString("base64")}`,
      ],
    }]);

    expect(parts).toHaveLength(1);
    expect(parts[0]?.url).toMatch(/^data:image\/png;base64,/);
  });

  test("reuses stored product context for metadata updates instead of re-understanding referenced images", () => {
    const currentRequest = "把这个信息更新到 @阿尔法蛋智能指纹水杯 里面去吧";
    const productDraft = draft(currentRequest, []);
    productDraft.resolvedText = `${currentRequest}\n\n[已关联数字资产：只读素材上下文]\n商品资料：4 张图片，儿童智能水杯。\n[只读素材上下文结束]`;
    productDraft.assetMentions = [{
      id: "local-product-alphaegg",
      name: "阿尔法蛋智能指纹水杯",
      kind: "商品库",
      meta: "4 张图片 · 商品库",
      productImages: Array.from({ length: 4 }, (_, index) =>
        `wodeappx-asset://local/product-${index + 1}.png`
      ),
    }];

    expect(draftRequestsAssetVisualUnderstanding(currentRequest)).toBe(false);
    expect(shouldUseAttachmentIntelligence({
      enabled: true,
      draft: productDraft,
      modelSupportsVision: true,
    })).toBe(false);
  });

  test("re-understands a referenced product when the current request explicitly needs visual evidence", () => {
    const currentRequest = "重新看一下这四张商品图，核对杯盖颜色和 Logo 位置";
    const productDraft = draft(currentRequest, []);
    productDraft.assetMentions = [{
      id: "local-product-alphaegg",
      name: "阿尔法蛋智能指纹水杯",
      kind: "商品库",
      meta: "4 张图片 · 商品库",
      productImages: ["wodeappx-asset://local/product.png"],
    }];

    expect(draftRequestsAssetForceReparse(currentRequest)).toBe(true);
    expect(draftRequestsAssetVisualUnderstanding(currentRequest)).toBe(true);
    expect(shouldUseAttachmentIntelligence({
      enabled: true,
      draft: productDraft,
      modelSupportsVision: true,
    })).toBe(false);
    expect(shouldIncludeAssetMentionFilesInPrompt({
      draft: productDraft,
      modelSupportsVision: true,
      useAttachmentIntelligence: false,
    })).toBe(true);
  });

  test("uses attachment intelligence for visual inspect when the model lacks vision", () => {
    const currentRequest = "核对一下杯盖颜色";
    const productDraft = draft(currentRequest, []);
    productDraft.assetMentions = [{
      id: "local-product-alphaegg",
      name: "阿尔法蛋智能指纹水杯",
      kind: "商品库",
      meta: "4 张图片 · 商品库",
      productImages: ["wodeappx-asset://local/product.png"],
    }];

    expect(shouldUseAttachmentIntelligence({
      enabled: true,
      draft: productDraft,
      modelSupportsVision: false,
    })).toBe(true);
  });

  test("sends up to twelve product mention images instead of a four-image sample cap", async () => {
    const productDraft = draft("用这套商品素材创建两段分镜", []);
    const images = Array.from({ length: 18 }, (_, index) =>
      `data:image/png;base64,${Buffer.from(`image-${index}`).toString("base64")}`
    );
    productDraft.assetMentions = [{
      id: "product-alphaegg",
      name: "阿尔法蛋 S1",
      kind: "商品库",
      meta: "18 张图片 · 1 个视频 · 1 份文件 · 商品库",
      coverImage: images[0],
      productImages: images,
      assetFiles: [
        {
          url: "data:video/mp4;base64,AAAA",
          name: "开盖参考.mp4",
          type: "video/mp4",
          size: 4,
        },
        {
          url: "data:application/pdf;base64,JVBERg==",
          name: "产品资料.pdf",
          type: "application/pdf",
          size: 8,
        },
      ],
    }];

    const inputs = await collectDraftAttachmentInputs(productDraft, true);
    expect(inputs.filter((item) => item.mimeType === "image/*")).toHaveLength(12);
    expect(inputs.filter((item) => item.mimeType === "video/mp4")).toHaveLength(1);
    expect(inputs.filter((item) => item.mimeType === "application/pdf")).toHaveLength(1);
    expect(inputs).toHaveLength(14);
  });

  test("an image-only product run does not parse bundled video or PDF files", async () => {
    const productDraft = draft(
      "用当前真实商品素材批量生成 5 张商品主图，突出按压开盖和吸管密封。",
      [],
    );
    productDraft.assetMentions = [{
      id: "product-alphaegg-image-only",
      name: "阿尔法蛋 S1 完整复验",
      kind: "商品库",
      meta: "18 张图片 · 1 个视频 · 1 份文件 · 商品库",
      productImages: Array.from({ length: 18 }, (_, index) =>
        `data:image/png;base64,${Buffer.from(`fingerprint-cup-${index}`).toString("base64")}`
      ),
      assetFiles: [
        {
          url: "data:video/mp4;base64,AAAA",
          name: "开盖参考.mp4",
          type: "video/mp4",
          size: 4,
        },
        {
          url: "data:application/pdf;base64,JVBERg==",
          name: "产品资料.pdf",
          type: "application/pdf",
          size: 8,
        },
      ],
    }];

    const inputs = await collectDraftAttachmentInputs(productDraft, true);
    expect(inputs).toHaveLength(12);
    expect(inputs.every((item) => item.mimeType === "image/*")).toBe(true);
  });

  test("a video-only product image run parses the video before generation", async () => {
    const productDraft = draft("基于这个商品，批量生成一组电商详情页套图。", []);
    productDraft.assetMentions = [{
      id: "product-video-only",
      name: "阿尔法蛋 S1 去重测试",
      kind: "商品库",
      meta: "1 个视频 · 商品库",
      assetFiles: [{
        url: `data:video/mp4;base64,${Buffer.from("video-source").toString("base64")}`,
        name: "alphaegg-opening-copy.mp4",
        type: "video/mp4",
        size: 12,
      }],
    }];

    expect(shouldUseAttachmentIntelligence({
      enabled: false,
      draft: productDraft,
      modelSupportsVision: true,
    })).toBe(true);

    const inputs = await collectDraftAttachmentInputs(productDraft, true);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].mimeType).toBe("video/mp4");
  });

  test("ignores non-image keywords inside read-only asset context and negative capability instructions", async () => {
    const currentRequest = "用真实商品素材生成 3 张商品主图，不读取 capability 契约。";
    const productDraft = draft(currentRequest, []);
    productDraft.resolvedText = `${currentRequest}\n\n[已关联数字资产：只读素材上下文]\n来源：18 张图片 · 1 个视频 · 1 份文件\n随附原始文件：产品资料.pdf\n[只读素材上下文结束]`;
    productDraft.assetMentions = [{
      id: "product-alphaegg-read-only-context",
      name: "阿尔法蛋 S1 完整复验",
      kind: "商品库",
      meta: "18 张图片 · 1 个视频 · 1 份文件 · 商品库",
      productImages: Array.from({ length: 6 }, (_, index) =>
        `data:image/png;base64,${Buffer.from(`fingerprint-cup-${index}`).toString("base64")}`
      ),
      assetFiles: [
        {
          url: "data:video/mp4;base64,AAAA",
          name: "开盖参考.mp4",
          type: "video/mp4",
          size: 4,
        },
        {
          url: "data:application/pdf;base64,JVBERg==",
          name: "产品资料.pdf",
          type: "application/pdf",
          size: 8,
        },
      ],
    }];

    const inputs = await collectDraftAttachmentInputs(productDraft, true);
    expect(inputs).toHaveLength(6);
    expect(inputs.every((item) => item.mimeType === "image/*")).toBe(true);
  });

  test("skips legacy file URLs without discarding valid product images", async () => {
    const productDraft = draft("用商品库里的指纹水杯生成三张商品图", []);
    productDraft.assetMentions = [{
      id: "product-alphaegg-current",
      name: "阿尔法蛋 S1 完整复验",
      kind: "商品库",
      meta: "18 张图片 · 1 个视频 · 1 份文件 · 商品库",
      productImages: Array.from({ length: 6 }, (_, index) =>
        `data:image/png;base64,${Buffer.from(`fingerprint-cup-${index}`).toString("base64")}`
      ),
      assetFiles: [
        {
          url: "file:///tmp/alphaegg-opening.mp4",
          name: "alphaegg-opening.mp4",
          type: "video/mp4",
          size: 1024,
        },
        {
          url: "file:///tmp/alphaegg-brief.pdf",
          name: "alphaegg-brief.pdf",
          type: "application/pdf",
          size: 2048,
        },
      ],
    }];

    const inputs = await collectDraftAttachmentInputs(productDraft, true);
    expect(inputs).toHaveLength(6);
    expect(inputs.every((item) => item.mimeType === "image/*")).toBe(true);
  });

  test("persists a selected desktop attachment through the File bridge instead of file URL", async () => {
    const previousWindow = globalThis.window;
    const expected = `data:application/pdf;base64,${Buffer.from("%PDF-1.7").toString("base64")}`;
    const file = new File(["%PDF-1.7"], "alphaegg-brief.pdf", { type: "application/pdf" });
    globalThis.window = Object.assign(globalThis.window || {}, {
      __OPENWORK_ELECTRON__: {
        files: {
          getPathForFile: () => "/tmp/alphaegg-brief.pdf",
          readAsDataUrl: async () => expected,
        },
      },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    }) as typeof window;
    try {
      const url = await resolveChatAttachmentUrlForStorage({
        id: "pdf-1",
        name: file.name,
        mimeType: file.type,
        kind: "file",
        file,
        size: file.size,
      });
      expect(url).toBe(expected);
      expect(url.startsWith("file://")).toBe(false);
    } finally {
      globalThis.window = previousWindow;
    }
  });

  test("recognizes PDF naming and verification language as attachment use", () => {
    expect(draftRequestsAttachmentUse(
      "这份资料叫 [产品信息 PDF]，只用来确认商品参数和审核注意事项。",
    )).toBe(true);
  });

  test("enables local file tools for an explicit parse-file request", () => {
    const route = routeWodeAppCapabilities({ text: "解析文件并且提取商品信息存到商品库里" });

    expect(route.capabilities).toContain("files");
    expect(route.tools.openwork_file_extract_text).toBe(true);
    expect(route.tools.openwork_file_preview).toBe(true);
    expect(route.tools.openwork_file_media_probe).toBe(true);
    expect(route.tools.openwork_pdf_info).toBe(true);
    expect(route.tools.openwork_pdf_extract_text).toBe(true);
    expect(route.tools.openwork_pdf_render_pages).toBe(true);
    expect(route.tools.skill).toBe(true);
  });

  test("always routes video through attachment intelligence instead of the text provider", () => {
    const video = attachment({
      id: "video-open",
      name: "open.mp4",
      mimeType: "video/mp4",
      kind: "file",
    });

    expect(shouldUseAttachmentIntelligence({
      enabled: true,
      draft: draft("先放着，稍后再用", [video]),
      modelSupportsVision: true,
    })).toBe(true);
  });

  test("never chat-inlines video even when catalog video capability is native", () => {
    const video = attachment({
      id: "video-native-cap",
      name: "meeting.mp4",
      mimeType: "video/mp4",
      kind: "file",
    });
    const nextDraft = draft("解析这个会议视频并做总结", [video]);
    const mediaInput = {
      image: true,
      video: true,
      pdf: false,
      office: false,
      remoteImageUrl: true,
      skipRemoteVisionParse: true,
      specKey: "test-video-native",
      notes: "test",
    };

    expect(shouldUseAttachmentIntelligence({
      enabled: true,
      draft: nextDraft,
      modelSupportsVision: true,
      mediaInput,
    })).toBe(true);
    expect(shouldPreserveAttachmentsAsDisplayOnly({
      enabled: true,
      draft: nextDraft,
      modelSupportsVision: true,
      mediaInput,
    })).toBe(true);
    expect(shouldIncludeRawAttachmentsInPrompt({
      modelSupportsVision: true,
      useAttachmentIntelligence: true,
      preserveAttachmentsAsDisplayOnly: true,
      draft: nextDraft,
      mediaInput,
    })).toEqual({ includeRawAttachments: false, imagesOnly: false });
  });

  test("refuses oversized PDF chat file parts even when catalog marks pdf native", () => {
    const largePdf = attachment({
      id: "large-pdf",
      name: "spec.pdf",
      mimeType: "application/pdf",
      kind: "file",
    });
    Object.defineProperty(largePdf.file, "size", { configurable: true, value: 6 * 1024 * 1024 });
    largePdf.size = 6 * 1024 * 1024;
    const nextDraft = draft("总结这份规格书", [largePdf]);
    const mediaInput = {
      image: true,
      video: false,
      pdf: true,
      office: false,
      remoteImageUrl: true,
      skipRemoteVisionParse: true,
      specKey: "test-pdf-native",
      notes: "test",
    };

    expect(shouldPreserveAttachmentsAsDisplayOnly({
      enabled: true,
      draft: nextDraft,
      modelSupportsVision: true,
      mediaInput,
    })).toBe(true);
    expect(shouldIncludeRawAttachmentsInPrompt({
      modelSupportsVision: true,
      useAttachmentIntelligence: false,
      preserveAttachmentsAsDisplayOnly: true,
      draft: nextDraft,
      mediaInput,
    })).toEqual({ includeRawAttachments: false, imagesOnly: false });
  });

  test("keeps attachment display cards in history without sending their content to the model again", () => {
    const image = attachment({
      id: "image-history",
      name: "product.png",
      mimeType: "image/png",
      kind: "image",
    });
    const document = attachment({
      id: "document-history",
      name: "brief.pdf",
      mimeType: "application/pdf",
      kind: "file",
    });

    const parts = buildAttachmentDisplayParts(
      [image, document],
      [{ filename: "product.png", url: "https://assets.example/product.png" }],
    );

    expect(parts).toEqual([
      expect.objectContaining({
        type: "text",
        synthetic: true,
        metadata: {
          wodeappAttachmentPlaceholder: {
            filename: "product.png",
            mime: "image/png",
            url: "https://assets.example/product.png",
          },
        },
      }),
      expect.objectContaining({
        type: "text",
        synthetic: true,
        metadata: {
          wodeappAttachmentPlaceholder: {
            filename: "brief.pdf",
            mime: "application/pdf",
          },
        },
      }),
    ]);
    expect(attachmentDisplayPlaceholderFromTextPart(parts[0])).toEqual({
      filename: "product.png",
      mime: "image/png",
      url: "https://assets.example/product.png",
    });
  });

  test("restores attachment history cards when the sidecar strips custom metadata", () => {
    expect(attachmentDisplayPlaceholderFromTextPart({
      type: "text",
      text: "[WodeApp attachment: 商品说明书.pdf]",
      ignored: true,
    })).toEqual({
      filename: "商品说明书.pdf",
      mime: "application/pdf",
    });

    expect(attachmentDisplayPlaceholderFromTextPart({
      type: "text",
      text: "[WodeApp attachment: 商品主图.png]",
      synthetic: true,
      metadata: {},
    })).toEqual({
      filename: "商品主图.png",
      mime: "image/png",
    });
  });

  test("packs vision-model image uploads into the prompt instead of display-only placeholders", () => {
    const image = attachment({
      id: "image-vision-direct",
      name: "image.png",
      mimeType: "image/png",
      kind: "image",
    });
    const nextDraft = draft("wodeappx 这里的背景色和边框没必要，去掉吧", [image]);

    expect(draftRequestsAttachmentUse(nextDraft.text)).toBe(false);
    expect(shouldUseAttachmentIntelligence({
      enabled: true,
      draft: nextDraft,
      modelSupportsVision: true,
    })).toBe(false);
    expect(shouldPreserveAttachmentsAsDisplayOnly({
      enabled: true,
      draft: nextDraft,
      modelSupportsVision: true,
    })).toBe(false);
    expect(shouldIncludeRawAttachmentsInPrompt({
      modelSupportsVision: true,
      useAttachmentIntelligence: false,
      preserveAttachmentsAsDisplayOnly: false,
      draft: nextDraft,
    })).toEqual({ includeRawAttachments: true, imagesOnly: true });
  });

  test("keeps an unused upload out of a text-model prompt while preserving its history card", () => {
    const image = attachment({
      id: "image-display-only",
      name: "attachment-proof.png",
      mimeType: "image/png",
      kind: "image",
    });
    const nextDraft = draft("请只回复：附件占位测试完成", [image]);

    expect(shouldUseAttachmentIntelligence({
      enabled: true,
      draft: nextDraft,
      modelSupportsVision: false,
    })).toBe(false);
    expect(shouldPreserveAttachmentsAsDisplayOnly({ enabled: true, draft: nextDraft })).toBe(true);
    expect(shouldIncludeRawAttachmentsInPrompt({
      modelSupportsVision: false,
      useAttachmentIntelligence: false,
      preserveAttachmentsAsDisplayOnly: true,
      draft: nextDraft,
    })).toEqual({ includeRawAttachments: false, imagesOnly: false });
  });

  test("sends mixed image and PDF uploads directly to a vision-capable model", () => {
    const image = attachment({
      id: "image-mixed",
      name: "ui.png",
      mimeType: "image/png",
      kind: "image",
    });
    const document = attachment({
      id: "pdf-mixed",
      name: "notes.pdf",
      mimeType: "application/pdf",
      kind: "file",
    });
    const nextDraft = draft("根据资料和截图分析一下", [image, document]);

    expect(shouldUseAttachmentIntelligence({
      enabled: true,
      draft: nextDraft,
      modelSupportsVision: true,
    })).toBe(false);
    expect(shouldPreserveAttachmentsAsDisplayOnly({
      enabled: true,
      draft: nextDraft,
      modelSupportsVision: true,
    })).toBe(false);
    expect(shouldIncludeRawAttachmentsInPrompt({
      modelSupportsVision: true,
      useAttachmentIntelligence: false,
      preserveAttachmentsAsDisplayOnly: false,
      draft: nextDraft,
    })).toEqual({ includeRawAttachments: true, imagesOnly: false });
  });

  test("never sends a PPTX binary as a raw vision-model prompt part", () => {
    const presentation = attachment({
      id: "pptx-local",
      name: "杭州西湖天幕裸眼3D制作参考.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      kind: "file",
    });
    const nextDraft = draft("根据这个参数制作一个 runtime 项目", [presentation]);

    expect(shouldUseAttachmentIntelligence({
      enabled: true,
      draft: nextDraft,
      modelSupportsVision: true,
    })).toBe(true);
    expect(shouldPreserveAttachmentsAsDisplayOnly({
      enabled: true,
      draft: nextDraft,
      modelSupportsVision: true,
    })).toBe(true);
    expect(shouldIncludeRawAttachmentsInPrompt({
      modelSupportsVision: true,
      useAttachmentIntelligence: true,
      preserveAttachmentsAsDisplayOnly: true,
      draft: nextDraft,
    })).toEqual({ includeRawAttachments: false, imagesOnly: false });
  });

  test("keeps a desktop PPTX local and gives the agent extraction tools", async () => {
    const presentation = attachment({
      id: "pptx-desktop-local",
      name: "reference.pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      kind: "file",
    });
    Object.defineProperty(presentation.file, "path", {
      configurable: true,
      value: "/tmp/reference.pptx",
    });

    const result = await understandDraftAttachments(
      draft("根据这份演示文稿制作方案", [presentation]),
      true,
    );

    expect(result.combinedContext).toContain("以下附件保留在本机");
    expect(result.combinedContext).toContain("/tmp/reference.pptx");
    expect(result.combinedContext).toContain("openwork_file_extract_text");
    expect(result.results[0]?.method).toBe("local-file-tool");
  });

  test("packs oversized image uploads into a vision-capable model instead of attachment intelligence", () => {
    const image = attachment({
      id: "large-image",
      name: "large-reference.png",
      mimeType: "image/png",
      kind: "image",
    });
    image.file = new File([new Uint8Array(6 * 1024 * 1024)], image.name, { type: image.mimeType });
    image.size = image.file.size;
    const nextDraft = draft("分析这张参考图", [image]);

    expect(shouldUseAttachmentIntelligence({
      enabled: true,
      draft: nextDraft,
      modelSupportsVision: true,
    })).toBe(false);
    expect(shouldIncludeRawAttachmentsInPrompt({
      modelSupportsVision: true,
      useAttachmentIntelligence: false,
      preserveAttachmentsAsDisplayOnly: false,
      draft: nextDraft,
    })).toEqual({ includeRawAttachments: true, imagesOnly: true });
  });

  test("tells the model not to search local folders after remote PDF parsing", () => {
    const part = buildAttachmentIntelligencePart(
      "PDF 摘要：产品参数和审核注意事项已提取。",
      [{ label: "上传附件", filename: "产品信息.pdf" }],
    );

    expect(part.text).toContain("不要再调用 openwork_file_search");
    expect(part.text).toContain("不要扫描工作区、桌面或外部目录");
    expect(part.text).toContain("不要要求用户重复上传");
    expect(part.text).not.toContain("需要内容时请调用 OpenCode 本地文件工具读取");
  });

  test("requires visible PDF tool calls and never promotes rendered pages to product images", () => {
    const part = buildAttachmentIntelligencePart(
      "以下附件保留在本机，尚未读取。\nPDF 固定流程：直接调用 openwork_pdf_info，然后调用 openwork_pdf_extract_text；需要视觉复核时调用 openwork_pdf_render_pages。",
      [{ label: "本地 PDF 工具", filename: "产品信息.pdf" }],
      [{ filename: "产品信息-page-1.jpg", url: "https://assets.example/pdf-page-1.jpg", kind: "document-page" }],
    );

    expect(part.text).toContain("PDF 工具已直接可用");
    expect(part.text).toContain("显式调用 openwork_pdf_info 与 openwork_pdf_extract_text");
    expect(part.text).toContain("需要视觉复核时再调用 openwork_pdf_render_pages");
    expect(part.text).toContain("不要调用 skill 加载器");
    expect(part.text).not.toContain("wodeappx-pdf");
    expect(part.text).toContain("页面渲染结果只用于视觉分析，不得写入 productImages");
    expect(part.text).not.toContain("本轮附件已由 WodeApp 附件理解服务处理");
    expect(part.text).not.toContain("productImages=[");
  });

  test("exposes absolute candidate image paths and forbids inventing default-workspace paths", () => {
    const part = buildAttachmentIntelligencePart(
      "附件理解结果：四张商品图已解析。",
      [
        { label: "对话上传", filename: "bottle.jpg" },
        { label: "对话上传", filename: "grill.jpg" },
      ],
      [
        { filename: "bottle.jpg", url: "https://assets.example/bottle.jpg", kind: "image" },
        { filename: "grill.jpg", url: "https://assets.example/grill.jpg", kind: "image" },
      ],
      {
        imageCandidates: [
          {
            imageId: "img_01",
            filename: "bottle.jpg",
            localPath: "/tmp/wodeapp-product-save-test/bottle.jpg",
            httpsUrl: "https://assets.example/bottle.jpg",
          },
          {
            imageId: "img_02",
            filename: "grill.jpg",
            localPath: "/tmp/wodeapp-product-save-test/grill.jpg",
          },
        ],
      },
    );

    expect(part.text).toContain('candidateImages=[{"id":"img_01","file":"bottle.jpg","path":"/tmp/wodeapp-product-save-test/bottle.jpg","https":"https://assets.example/bottle.jpg"},{"id":"img_02","file":"grill.jpg","path":"/tmp/wodeapp-product-save-test/grill.jpg"}]');
    expect(part.text).toContain(CHAT_IMAGE_PATH_GUARD);
    expect(part.text).toContain("禁止再对本轮对话图调用 image_inspect");
    expect(part.text).toContain("禁止把裸文件名拼到 default-workspace");
    expect(part.text).toContain("selectedImageIds");

    const visionPart = buildVisionEphemeralFollowupPart(
      [],
      {
        localPaths: ["/tmp/wodeapp-product-save-test/bottle.jpg"],
        imageCandidates: [
          {
            imageId: "img_01",
            filename: "bottle.jpg",
            localPath: "/tmp/wodeapp-product-save-test/bottle.jpg",
          },
        ],
      },
    );
    expect(visionPart.text).toContain('"path":"/tmp/wodeapp-product-save-test/bottle.jpg"');
    expect(visionPart.text).toContain(CHAT_IMAGE_PATH_GUARD);
    expect(visionPart.text).toContain("不要再 image_inspect");
    expect(visionPart.text).toContain("禁止把裸文件名拼到 default-workspace");
  });

  test("pins every uploaded image URL in one exact HTTPS candidate array", () => {
    const part = buildAttachmentIntelligencePart(
      "【SKU 保真锁定】圆角方柱杯身，正反面平直。",
      [
        { label: "商品库", filename: "cup-image-1" },
        { label: "商品库", filename: "cup-image-2" },
      ],
      [
        { filename: "cup-image-1", url: "https://assets.example/cup-1", kind: "image" },
        { filename: "cup-image-2", url: "https://assets.example/cup-2", kind: "image" },
      ],
    );

    expect(part.text).toContain('candidateHttpsImages=["https://assets.example/cup-1","https://assets.example/cup-2"]');
    expect(part.text).toContain("selectedImageIds");
    expect(part.text).toContain("【SKU 保真锁定】圆角方柱杯身");
  });

  test("preserves all eight uploaded product image URLs without applying the four-image asset sampling cap", () => {
    const urls = Array.from({ length: 8 }, (_, index) => `https://assets.example/cup-${index + 1}`);
    const part = buildAttachmentIntelligencePart(
      "八张商品实拍图。",
      urls.map((_, index) => ({ label: "对话上传", filename: `cup-${index + 1}.jpg` })),
      urls.map((url, index) => ({ filename: `cup-${index + 1}.jpg`, url, kind: "image" })),
    );

    expect(part.text).toContain(`candidateHttpsImages=${JSON.stringify(urls)}`);
    expect(part.text).toContain("selectedImageIds");
  });

  test("persists the real attachment URL in the stable history placeholder", () => {
    const image = attachment({ id: "image-history-url", name: "product.png", mimeType: "image/png", kind: "image" });
    const [part] = buildAttachmentDisplayParts(
      [image],
      [{ filename: "product.png", url: "https://assets.example/product.png", kind: "image" }],
    );

    expect(part.text).toContain('[WodeApp attachment reference: {"url":"https://assets.example/product.png","kind":"image"}]');
    expect(attachmentDisplayPlaceholderFromTextPart(part)).toEqual({
      filename: "product.png",
      mime: "image/png",
      url: "https://assets.example/product.png",
      kind: "image",
    });
  });

  test("persists the selected desktop path so a sent attachment can still be opened", () => {
    const document = attachment({
      id: "desktop-history-path",
      name: "brief.pdf",
      mimeType: "application/pdf",
      kind: "file",
    });
    Object.defineProperty(document.file, "path", {
      configurable: true,
      value: "/Users/test/Downloads/brief.pdf",
    });

    const [part] = buildAttachmentDisplayParts([document]);

    expect(attachmentDisplayPlaceholderFromTextPart(part)).toEqual({
      filename: "brief.pdf",
      mime: "application/pdf",
      url: "file:///Users/test/Downloads/brief.pdf",
    });
  });

  test("rejects product saves whose image count or source list differs from the attachment contract", () => {
    const sourceImages = Array.from({ length: 8 }, (_, index) => `https://assets.example/cup-${index + 1}`);
    expect(validateProductImageExpectation({
      imageInputProvided: true,
      productImages: sourceImages.slice(0, 6),
      expectedImageCount: 8,
      sourceProductImages: sourceImages,
      requireSourceProductImages: true,
    })).toContain("预期 8 张");
    expect(validateProductImageExpectation({
      imageInputProvided: true,
      productImages: [...sourceImages, "https://assets.example/unrelated-9", "https://assets.example/unrelated-10"],
      expectedImageCount: 8,
      sourceProductImages: sourceImages,
      requireSourceProductImages: true,
    })).toContain("预期 8 张");
    expect(validateProductImageExpectation({
      imageInputProvided: true,
      productImages: sourceImages,
      expectedImageCount: 8,
      sourceProductImages: sourceImages,
      requireSourceProductImages: true,
    })).toBeNull();
    // Same set, different order must still pass (agent reshuffles).
    expect(validateProductImageExpectation({
      imageInputProvided: true,
      productImages: [...sourceImages].reverse(),
      expectedImageCount: 8,
      sourceProductImages: sourceImages,
      requireSourceProductImages: true,
    })).toBeNull();
  });

  test("rejects bare filenames and ephemeral attachment refs for productImages", () => {
    expect(isDurableProductImageUrl("https://assets.wodeapp.ai/a.jpg")).toBe(true);
    expect(isDurableProductImageUrl("wodeappx-asset://local/abc.jpg")).toBe(true);
    expect(isDurableProductImageUrl("data:image/png;base64,aaaa")).toBe(false);
    expect(isDurableProductImageUrl("7a26126.jpg")).toBe(false);
    expect(isDurableProductImageUrl("wodeapp://attachment/7a26126.jpg")).toBe(false);
    expect(validateDurableProductImageUrls([
      "https://assets.example/a.jpg",
      "7a26126.jpg",
    ])).toContain("裸文件名");
    expect(validateDurableProductImageUrls([
      "wodeappx-asset://local/a.jpg",
      "https://assets.example/b.jpg",
    ])).toBeNull();
  });
});

describe("product image HTTPS-first materialize", () => {
  test("materializes duplicate Unicode attachments by stable attachment id", async () => {
    const previousWindow = globalThis.window;
    const storedPaths = [
      "/tmp/ctx_unicode/01--.pdf",
      "/tmp/ctx_unicode/02--.pdf",
    ];
    globalThis.window = {
      ...(previousWindow || {}),
      __OPENWORK_ELECTRON__: {
        files: {
          getPathForFile: () => "",
          readAsDataUrl: async () => "data:application/pdf;base64,JVBERg==",
        },
        invokeDesktop: async (command: string, input: {
          refId: string;
          files?: Array<{ filename: string; mime: string; dataUrl: string }>;
        }) => {
          expect(command).toBe("attachmentContextPut");
          return {
            ok: true,
            refId: input.refId,
            contextChars: 0,
            storedBytes: 8,
            storeBytes: 8,
            maxStoreBytes: 1024,
            files: (input.files || []).map((file, index) => ({
              originalFilename: file.filename,
              filename: "-.pdf",
              mime: file.mime,
              path: storedPaths[index],
              sizeBytes: 4,
            })),
          };
        },
      },
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    } as typeof window;

    try {
      const {
        materializeComposerAttachmentsForSend,
      } = await import("../src/react-app/domains/wodeapp/wodeapp-product-image-materialize");
      const {
        stampComposerAttachmentLocalPaths,
      } = await import("../src/react-app/domains/wodeapp/wodeapp-attachment-intelligence");
      const first = attachment({
        id: "unicode-first",
        name: "报价单.pdf",
        mimeType: "application/pdf",
        kind: "file",
      });
      const second = attachment({
        id: "unicode-second",
        name: "报价单.pdf",
        mimeType: "application/pdf",
        kind: "file",
      });

      const result = await materializeComposerAttachmentsForSend({
        sessionId: "ses_unicode",
        attachments: [first, second],
      });

      expect(result.pathByAttachmentId.get(first.id)).toBe(storedPaths[0]);
      expect(result.pathByAttachmentId.get(second.id)).toBe(storedPaths[1]);
      expect(result.pathByFilename.get("报价单.pdf")).toBe(storedPaths[0]);
      expect(result.localPaths).toEqual(storedPaths);

      expect(stampComposerAttachmentLocalPaths(
        [first, second],
        result.pathByFilename,
        result.pathByAttachmentId,
      )).toBe(2);
      expect((first.file as File & { path?: string }).path).toBe(storedPaths[0]);
      expect((second.file as File & { path?: string }).path).toBe(storedPaths[1]);
    } finally {
      globalThis.window = previousWindow;
    }
  });

  test("registers bare filenames and uploads HTTPS before local fallback", async () => {
    const {
      clearRegisteredProductImagePixels,
      materializeProductImageUrls,
      registerSessionProductImagePixels,
    } = await import("../src/react-app/domains/wodeapp/wodeapp-product-image-materialize");

    clearRegisteredProductImagePixels();
    registerSessionProductImagePixels({
      sessionId: "ses_test",
      images: [{
        filename: "7a26126.jpg",
        dataUrl: "data:image/jpeg;base64,aaaa",
      }],
    });

    const httpsResult = await materializeProductImageUrls(["7a26126.jpg", "wodeapp://attachment/7a26126.jpg"], {
      sessionId: "ses_test",
      deps: {
        uploadHttps: async () => "https://assets.wodeapp.ai/attachment-intelligence/7a26126.jpg",
        persistLocal: async () => "wodeappx-asset://local/should-not-use.jpg",
      },
    });
    expect(httpsResult.failed).toEqual([]);
    expect(httpsResult.httpsCount).toBe(2);
    expect(httpsResult.localCount).toBe(0);
    expect(httpsResult.urls).toEqual([
      "https://assets.wodeapp.ai/attachment-intelligence/7a26126.jpg",
      "https://assets.wodeapp.ai/attachment-intelligence/7a26126.jpg",
    ]);

    clearRegisteredProductImagePixels();
    registerSessionProductImagePixels({
      sessionId: "ses_local",
      images: [{
        filename: "7a26126.jpg",
        dataUrl: "data:image/jpeg;base64,bbbb",
      }],
    });
    const localFallback = await materializeProductImageUrls(["7a26126.jpg"], {
      sessionId: "ses_local",
      deps: {
        uploadHttps: async () => null,
        persistLocal: async () => "wodeappx-asset://local/7a26126.jpg",
      },
    });
    expect(localFallback.failed).toEqual([]);
    expect(localFallback.httpsCount).toBe(0);
    expect(localFallback.localCount).toBe(1);
    expect(localFallback.urls).toEqual(["wodeappx-asset://local/7a26126.jpg"]);

    const unresolved = await materializeProductImageUrls(["missing-only.jpg"], {
      sessionId: "ses_test",
      deps: {
        uploadHttps: async () => "https://assets.example/x.jpg",
        persistLocal: async () => "wodeappx-asset://local/x.jpg",
      },
    });
    expect(unresolved.failed).toEqual(["missing-only.jpg"]);
    clearRegisteredProductImagePixels();
  });

  test("resolves wodeapp://session-image/{id} via registry dataUrl for image_asset_save", async () => {
    const {
      clearRegisteredProductImagePixels,
      listCurrentSessionProductImageCandidates,
      materializeProductImageUrls,
      registerSessionProductImagePixels,
      resolveAndMaterializeSessionImages,
    } = await import("../src/react-app/domains/wodeapp/wodeapp-product-image-materialize");

    clearRegisteredProductImagePixels();
    registerSessionProductImagePixels({
      sessionId: "ses_session_image",
      images: [{
        filename: "sock-black.jpg",
        dataUrl: "data:image/jpeg;base64,YmFzZTY0cGl4ZWxz",
      }],
    });
    const candidates = listCurrentSessionProductImageCandidates("ses_session_image");
    expect(candidates).toHaveLength(1);
    const imageId = candidates[0]!.imageId;
    expect(imageId).toMatch(/^img_\d+$/);

    const byRef = await materializeProductImageUrls([`wodeapp://session-image/${imageId}`], {
      sessionId: "ses_session_image",
      deps: {
        uploadHttps: async () => "https://assets.wodeapp.ai/products/sock-black.jpg",
        persistLocal: async () => null,
      },
    });
    expect(byRef.failed).toEqual([]);
    expect(byRef.urls).toEqual(["https://assets.wodeapp.ai/products/sock-black.jpg"]);

    clearRegisteredProductImagePixels();
    registerSessionProductImagePixels({
      sessionId: "ses_session_image",
      images: [{
        filename: "sock-black.jpg",
        dataUrl: "data:image/jpeg;base64,YmFzZTY0cGl4ZWxz",
      }],
    });
    const saved = await resolveAndMaterializeSessionImages({
      sessionId: "ses_session_image",
      selectedImageIds: ["img_01"],
      deps: {
        uploadHttps: async () => "https://assets.wodeapp.ai/products/sock-black-2.jpg",
        persistLocal: async () => null,
      },
    });
    expect(saved.ok).toBe(true);
    if (saved.ok) {
      expect(saved.selectedImageIds).toEqual(["img_01"]);
      expect(saved.urls).toEqual(["https://assets.wodeapp.ai/products/sock-black-2.jpg"]);
    }
    clearRegisteredProductImagePixels();
  });

  test("shared cache keeps productImages and sourceProductImages from minting divergent HTTPS URLs", async () => {
    const {
      clearRegisteredProductImagePixels,
      materializeProductImageUrls,
      registerSessionProductImagePixels,
      sameProductImageIdentitySet,
    } = await import("../src/react-app/domains/wodeapp/wodeapp-product-image-materialize");

    clearRegisteredProductImagePixels();
    const names = [
      "7a26126ec60e296929edacd969a9b180.jpg",
      "8ee40bf263e0aadfbdf038bfde7a16c5.jpg",
    ];
    registerSessionProductImagePixels({
      sessionId: "ses_086653",
      images: names.map((filename) => ({
        filename,
        dataUrl: `data:image/jpeg;base64,${Buffer.from(filename).toString("base64")}`,
      })),
    });

    let uploadCount = 0;
    const deps = {
      uploadHttps: async (_dataUrl: string, filename: string) => {
        uploadCount += 1;
        return `https://assets.wodeapp.ai/upload/${uploadCount}-${filename}`;
      },
      persistLocal: async () => null as string | null,
    };
    const cache = new Map<string, string>();
    const product = await materializeProductImageUrls(names, {
      sessionId: "ses_086653",
      deps,
      cache,
    });
    // Bug reproduction before fix: second materialize minted fresh CDN URLs → "不完全一致".
    const source = await materializeProductImageUrls(names, {
      sessionId: "ses_086653",
      deps,
      cache,
    });
    expect(product.failed).toEqual([]);
    expect(source.failed).toEqual([]);
    expect(product.urls).toEqual(source.urls);
    expect(uploadCount).toBe(2);
    expect(sameProductImageIdentitySet(names, names)).toBe(true);
    expect(validateProductImageExpectation({
      imageInputProvided: true,
      productImages: product.urls,
      expectedImageCount: 2,
      sourceProductImages: source.urls,
      requireSourceProductImages: true,
    })).toBeNull();

    clearRegisteredProductImagePixels("ses_086653");
  });

  test("keeps same-name attachment pixels isolated by session", async () => {
    const {
      clearRegisteredProductImagePixels,
      lookupRegisteredProductImageDataUrl,
      registerSessionProductImagePixels,
    } = await import("../src/react-app/domains/wodeapp/wodeapp-product-image-materialize");

    clearRegisteredProductImagePixels();
    registerSessionProductImagePixels({
      sessionId: "ses_alpha",
      images: [{ filename: "main.jpg", dataUrl: "data:image/jpeg;base64,aaaa" }],
    });
    registerSessionProductImagePixels({
      sessionId: "ses_beta",
      images: [{ filename: "main.jpg", dataUrl: "data:image/jpeg;base64,bbbb" }],
    });

    expect(lookupRegisteredProductImageDataUrl("main.jpg", "ses_alpha"))
      .toBe("data:image/jpeg;base64,aaaa");
    expect(lookupRegisteredProductImageDataUrl("main.jpg", "ses_beta"))
      .toBe("data:image/jpeg;base64,bbbb");
    expect(lookupRegisteredProductImageDataUrl("main.jpg", "ses_missing")).toBeNull();
    clearRegisteredProductImagePixels();
  });
});


describe("vision-direct ephemeral history compaction", () => {
  test("plants a follow-up summary for vision-direct image uploads", () => {
    const image = attachment({
      id: "vision-ephemeral",
      name: "banner.png",
      mimeType: "image/png",
      kind: "image",
    });
    const part = buildVisionEphemeralFollowupPart([image], {
      localPaths: ["/tmp/banner.png"],
      durableProductImageUrls: ["https://assets.example/banner.png"],
    });
    expect(part.type).toBe("text");
    expect(part.synthetic).toBe(true);
    expect(part.text).toContain("视觉输入说明");
    expect(part.text).toContain("banner.png");
    expect(part.text).toContain("path=/tmp/banner.png");
    expect(part.text).toContain("productImages=");
    expect(part.text).toContain("https://assets.example/banner.png");
    expect(part.text).toContain("不再把像素送进后续模型轮次");
    // No triple-listing of the same path (sources + pathBlock + cards).
    expect(part.text.split("/tmp/banner.png").length - 1).toBe(1);
    expect(part.text).not.toContain("contextRefId=");
    expect(isHiddenAttachmentIntelligenceText(part.text)).toBe(true);
  });

  test("keeps pixels in history when there is no local path or context pack", () => {
    const image = attachment({
      id: "vision-no-ref",
      name: "banner.png",
      mimeType: "image/png",
      kind: "image",
    });
    const part = buildVisionEphemeralFollowupPart([image]);
    expect(part.text).toContain("未能落本地路径");
    expect(part.text).not.toContain("contextRefId=");
  });

  test("does not silently truncate more than twelve durable product images", () => {
    const image = attachment({
      id: "vision-many-images",
      name: "banner.png",
      mimeType: "image/png",
      kind: "image",
    });
    const durableProductImageUrls = Array.from(
      { length: 13 },
      (_, index) => `https://assets.example/image-${index + 1}.png`,
    );
    const part = buildVisionEphemeralFollowupPart([image], { durableProductImageUrls });
    expect(part.text).toContain("超过 12 张");
    expect(part.text).toContain("productImages=");
    for (const url of durableProductImageUrls) {
      expect(part.text).toContain(url);
    }
    expect(part.text).not.toContain("expectedImageCount=");
  });

  test("identifies data-url image file parts for compaction", async () => {
    const {
      isEphemeralVisionDataUrlFilePart,
      isFileSchemeImageFilePart,
      isModelSafeMediaUrl,
    } = await import(
      "../src/react-app/domains/wodeapp/wodeapp-vision-history-compact"
    );
    expect(isEphemeralVisionDataUrlFilePart({
      id: "prt_1",
      type: "file",
      mime: "image/png",
      filename: "banner.png",
      url: "data:image/png;base64,aaaa",
    }, new Set(["banner.png"]))).toBe(true);
    expect(isEphemeralVisionDataUrlFilePart({
      id: "prt_2",
      type: "file",
      mime: "image/png",
      filename: "other.png",
      url: "data:image/png;base64,aaaa",
    }, new Set(["banner.png"]))).toBe(false);
    expect(isEphemeralVisionDataUrlFilePart({
      id: "prt_3",
      type: "file",
      mime: "image/png",
      filename: "banner.png",
      url: "https://cdn.example/banner.png",
    }, new Set(["banner.png"]))).toBe(false);
    expect(isFileSchemeImageFilePart({
      id: "prt_file",
      type: "file",
      mime: "image/jpeg",
      filename: "local.jpg",
      url: "file:///tmp/local.jpg",
    })).toBe(true);
    expect(isModelSafeMediaUrl("https://cdn.example/a.png")).toBe(true);
    expect(isModelSafeMediaUrl("data:image/png;base64,aaaa")).toBe(true);
    expect(isModelSafeMediaUrl("file:///tmp/a.png")).toBe(false);
  });

  test("compacts data-url file parts to https or placeholders; never deletes or leaves file:// type:file", async () => {
    const { compactEphemeralVisionFilePartsAfterIdle } = await import(
      "../src/react-app/domains/wodeapp/wodeapp-vision-history-compact"
    );
    const deleted: string[] = [];
    const updates: Array<{ partID: string; part?: Record<string, unknown> }> = [];
    let statusCalls = 0;
    const client = {
      session: {
        status: async () => {
          statusCalls += 1;
          // busy once, then idle — mirrors first-turn vision then agent finish
          const type = statusCalls === 1 ? "busy" : "idle";
          return { data: { ses_test: { type } } };
        },
        messages: async () => ({
          data: [{
            info: { id: "msg_user", role: "user" },
            parts: [
              { id: "prt_keep", type: "text", text: "hello" },
              {
                id: "prt_img",
                messageID: "msg_user",
                type: "file",
                mime: "image/png",
                filename: "banner.png",
                url: "data:image/png;base64,aaaa",
              },
              {
                id: "prt_local",
                messageID: "msg_user",
                type: "file",
                mime: "image/jpeg",
                filename: "local.jpg",
                url: "data:image/jpeg;base64,bbbb",
              },
              {
                id: "prt_poison",
                messageID: "msg_user",
                type: "file",
                mime: "image/jpeg",
                filename: "poison.jpg",
                url: "file:///tmp/poison.jpg",
              },
            ],
          }],
        }),
      },
      part: {
        delete: async (params: { partID: string }) => {
          deleted.push(params.partID);
          return {};
        },
        update: async (params: { partID: string; part?: Record<string, unknown> }) => {
          updates.push(params);
          return {};
        },
      },
    };
    const result = await compactEphemeralVisionFilePartsAfterIdle({
      client,
      sessionId: "ses_test",
      filenames: ["banner.png", "local.jpg"],
      displayUrls: [
        { filename: "banner.png", url: "https://cdn.example/banner.png" },
        { filename: "local.jpg", url: "file:///tmp/local.jpg" },
      ],
      timeoutMs: 5_000,
      graceMs: 0,
      pollMs: 1,
    });
    expect(result.idle).toBe(true);
    expect(result.rewritten).toBe(2);
    expect(result.scrubbed).toBe(1);
    expect(deleted).toEqual([]);
    const byId = new Map(updates.map((item) => [item.partID, item.part]));
    expect(byId.get("prt_img")).toEqual(expect.objectContaining({
      type: "file",
      url: "https://cdn.example/banner.png",
    }));
    expect(byId.get("prt_local")).toEqual(expect.objectContaining({
      type: "text",
      synthetic: true,
      text: expect.stringContaining("[WodeApp attachment: local.jpg]"),
    }));
    expect(byId.get("prt_poison")).toEqual(expect.objectContaining({
      type: "text",
      synthetic: true,
      text: expect.stringContaining("[WodeApp attachment: poison.jpg]"),
    }));
    expect(updates.every((item) => {
      const url = typeof item.part?.url === "string" ? item.part.url : "";
      return !url.startsWith("file:");
    })).toBe(true);
  });
});

describe("attachment-intelligence idle history stub", () => {
  test("plants attachmentFingerprint and stubs long attachment intelligence text", () => {
    const longBody = `附件理解结果正文：${"产品规格与审核要点。".repeat(80)}`;
    const part = buildAttachmentIntelligencePart(
      longBody,
      [{ label: "上传附件", filename: "手册.pdf" }],
      [],
      {
        contextPackId: "pack_test_123",
        contextRefId: "ctx_attachment_manual_1234",
      },
    );
    expect(part.text).toContain("attachmentFingerprint=pack_test_123");
    expect(part.text).toContain("contextRefId=ctx_attachment_manual_1234");
    expect(part.text.length).toBeGreaterThan(800);

    const stub = buildAttachmentIntelligenceHistoryStub(part.text);
    expect(stub).toBeTruthy();
    expect(stub!).toContain(WODEAPP_ATTACHMENT_INTELLIGENCE_COMPACTED_MARKER);
    expect(stub!).toContain("手册.pdf");
    expect(stub!).toContain("attachmentFingerprint=pack_test_123");
    expect(stub!).toContain("openwork_attachment_context_read");
    expect(stub!).toContain("contextRefId=ctx_attachment_manual_1234");
    expect(stub!).not.toContain(longBody.slice(0, 40));
    expect(stub!.length).toBeLessThan(part.text.length);
    expect(buildAttachmentIntelligenceHistoryStub(stub!)).toBeNull();
  });

  test("keeps candidate HTTPS URLs when stubbing attachment intelligence", () => {
    const urls = ["https://assets.example/a.png", "https://assets.example/b.png"];
    const part = buildAttachmentIntelligencePart(
      `长摘要：${"细节".repeat(400)}`,
      [
        { label: "对话上传", filename: "a.png" },
        { label: "对话上传", filename: "b.png" },
      ],
      urls.map((url, index) => ({
        filename: `${index === 0 ? "a" : "b"}.png`,
        url,
        kind: "image",
      })),
      {
        contextPackId: "pack_images",
        contextRefId: "ctx_attachment_images_1234",
      },
    );
    const stub = buildAttachmentIntelligenceHistoryStub(part.text);
    expect(stub).toBeTruthy();
    expect(stub!).toContain(`candidateHttpsImages=${JSON.stringify(urls)}`);
    expect(stub!).toContain("selectedImageIds");
    expect(stub!).toContain(WODEAPP_ATTACHMENT_INTELLIGENCE_COMPACTED_MARKER);
  });

  test("stubs attachment intelligence parts after idle via part.update", async () => {
    const { compactAttachmentIntelligencePartsAfterIdle } = await import(
      "../src/react-app/domains/wodeapp/wodeapp-vision-history-compact"
    );
    const longText = buildAttachmentIntelligencePart(
      `视频摘要：${"镜头与旁白。".repeat(100)}`,
      [{ label: "上传附件", filename: "demo.mp4" }],
      [],
      {
        contextPackId: "pack_video",
        contextRefId: "ctx_attachment_video_1234",
      },
    ).text as string;
    const updated: string[] = [];
    let statusCalls = 0;
    const client = {
      session: {
        status: async () => {
          statusCalls += 1;
          return { data: { ses_attach: { type: statusCalls === 1 ? "busy" : "idle" } } };
        },
        messages: async () => ({
          data: [{
            info: { id: "msg_user", role: "user" },
            parts: [
              {
                id: "prt_intel",
                messageID: "msg_user",
                type: "text",
                synthetic: true,
                text: longText,
              },
            ],
          }],
        }),
      },
      part: {
        delete: async () => ({}),
        update: async (params: { partID: string; part?: { text?: string } }) => {
          if (params.part?.text) updated.push(params.part.text);
          return {};
        },
      },
    };
    const result = await compactAttachmentIntelligencePartsAfterIdle({
      client,
      sessionId: "ses_attach",
      timeoutMs: 5_000,
      graceMs: 0,
      pollMs: 1,
    });
    expect(result.idle).toBe(true);
    expect(result.stubbed).toBe(1);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toContain(WODEAPP_ATTACHMENT_INTELLIGENCE_COMPACTED_MARKER);
    expect(updated[0]).toContain("attachmentFingerprint=pack_video");
    expect(updated[0]).toContain("contextRefId=ctx_attachment_video_1234");
    expect(updated[0]).toContain("demo.mp4");
  });

  test("does not stub remote attachment text without a safe reference", () => {
    const part = buildAttachmentIntelligencePart(
      `远程摘要：${"关键内容。".repeat(160)}`,
      [{ label: "上传附件", filename: "remote.pdf" }],
      [],
      { contextPackId: "pack_without_ref" },
    );
    expect(part.text.length).toBeGreaterThan(800);
    expect(buildAttachmentIntelligenceHistoryStub(part.text)).toBeNull();
  });

  test("does not stub unread local attachments even when paths are present", () => {
    const localPath = "/Users/test/Downloads/manual.pdf";
    const part = buildAttachmentIntelligencePart(
      [
        "以下附件保留在本机，尚未读取。",
        `path: ${localPath}`,
        "PDF 固定流程：直接调用 openwork_pdf_info，然后调用 openwork_pdf_extract_text。",
        "细节：",
        "规格参数。".repeat(160),
      ].join("\n"),
      [{ label: "上传附件", filename: "manual.pdf" }],
    );
    expect(buildAttachmentIntelligenceHistoryStub(part.text)).toBeNull();
    expect(attachmentContextCanBeDehydrated(part.text)).toBe(false);
  });

  test("buildAttachmentRequirementsFromDraft unions files for local xls plus product library intent", () => {
    const xls = attachment({
      id: "xls-local",
      name: "socks.xls",
      mimeType: "application/vnd.ms-excel",
      kind: "file",
    });
    Object.defineProperty(xls.file, "path", {
      configurable: true,
      value: "/tmp/socks.xls",
    });
    const images = Array.from({ length: 11 }, (_, index) => {
      const item = attachment({
        id: `img-${index}`,
        name: `img-${index}.jpg`,
        mimeType: "image/jpeg",
        kind: "image",
      });
      Object.defineProperty(item.file, "path", {
        configurable: true,
        value: `/tmp/img-${index}.jpg`,
      });
      return item;
    });
    const requirements = buildAttachmentRequirementsFromDraft(
      draft("解析并且总结商品信息，存到商品库", [xls, ...images]),
    );
    const route = routeWodeAppCapabilities({
      text: "解析并且总结商品信息，存到商品库",
      attachmentRequirements: requirements,
    });

    expect(requirements.localRead).toBe(true);
    expect(requirements.localDocuments).toHaveLength(1);
    expect(requirements.localDocuments?.[0]?.extension).toBe(".xls");
    expect(route.capabilities).toContain("files");
    expect(route.capabilities).toContain("assets");
    expect(route.tools.openwork_file_extract_text).toBe(true);
  });

  test("uses office guidance instead of pdf guidance for local xls attachments", async () => {
    const workbook = attachment({
      id: "xls-desktop-local",
      name: "socks.xls",
      mimeType: "application/vnd.ms-excel",
      kind: "file",
    });
    Object.defineProperty(workbook.file, "path", {
      configurable: true,
      value: "/tmp/socks.xls",
    });

    const result = await understandDraftAttachments(
      draft("解析并且总结商品信息，存到商品库", [workbook]),
      true,
    );

    expect(result.combinedContext).toContain("以下附件保留在本机");
    expect(result.combinedContext).toContain("BIFF8");
    expect(result.combinedContext).toContain("openwork_file_extract_text");
    expect(result.combinedContext).toContain("XLS_CORRUPT");
    expect(result.combinedContext).not.toContain("openwork_pdf_info");
  });

  test("preserves exact local paths when replacing a long local PDF context after read", () => {
    const localPath = "/Users/test/Downloads/manual.pdf";
    const part = buildAttachmentIntelligencePart(
      [
        `path: ${localPath}`,
        "PDF 已读取完毕。",
        "细节：",
        "规格参数。".repeat(160),
      ].join("\n"),
      [{ label: "上传附件", filename: "manual.pdf" }],
    );
    const stub = buildAttachmentIntelligenceHistoryStub(part.text);
    expect(stub).toBeTruthy();
    expect(stub).toContain(localPath);
    expect(stub).toContain("可重读本地路径");
    expect(stub).toContain("openwork_pdf_extract_text");
  });

  test("normal idle wait requires observing busy before cleanup", async () => {
    const { waitForSessionIdle } = await import(
      "../src/react-app/domains/wodeapp/wodeapp-vision-history-compact"
    );
    const client = {
      session: {
        status: async () => ({ data: { ses_idle_only: { type: "idle" } } }),
        messages: async () => ({ data: [] }),
      },
      part: {
        delete: async () => ({}),
        update: async () => ({}),
      },
    };
    await expect(waitForSessionIdle(client, "ses_idle_only", {
      timeoutMs: 10,
      graceMs: 0,
      pollMs: 1,
    })).resolves.toBe(false);
  });

  test("stubs tool read attachments after idle via part.update", async () => {
    const {
      buildToolMediaAttachmentStub,
      compactToolMediaAttachmentsAfterIdle,
      isToolPartWithEphemeralMediaAttachments,
    } = await import(
      "../src/react-app/domains/wodeapp/wodeapp-vision-history-compact"
    );
    const toolPart = {
      id: "prt_read_shot",
      messageID: "msg_assistant",
      type: "tool",
      callID: "call_read_1",
      tool: "read",
      state: {
        status: "completed",
        input: { path: "/tmp/browser-screenshot-123.png" },
        output: "Image read successfully",
        title: "/tmp/browser-screenshot-123.png",
        attachments: [{
          type: "file",
          mime: "image/png",
          url: "data:image/png;base64,QUJD",
        }],
        time: { start: 1, end: 2 },
      },
    };
    expect(isToolPartWithEphemeralMediaAttachments(toolPart)).toBe(true);
    const stubbed = buildToolMediaAttachmentStub(
      toolPart as never,
      "ses_test",
      "msg_assistant",
    );
    expect(stubbed?.state).toMatchObject({
      attachments: [],
      metadata: { wodeappMediaStubbed: true },
    });
    expect(String((stubbed?.state as { output?: string }).output)).toContain("image_inspect");
    expect(String((stubbed?.state as { output?: string }).output)).toContain("Only if the user explicitly asks to re-check pixels");
    expect(String((stubbed?.state as { output?: string }).output)).toContain("Do not re-open this image for ordinary follow-ups");
    expect(String((stubbed?.state as { output?: string }).output)).not.toContain("Re-view with image_inspect");

    const updates: Array<Record<string, unknown>> = [];
    const client = {
      session: {
        status: async () => ({ data: { ses_tool: { type: "idle" } } }),
        messages: async () => ({
          data: [{ info: { id: "msg_assistant" }, parts: [toolPart] }],
        }),
      },
      part: {
        delete: async () => ({}),
        update: async (params: { part?: Record<string, unknown> }) => {
          updates.push(params.part ?? {});
          return {};
        },
      },
    };
    const result = await compactToolMediaAttachmentsAfterIdle({
      client,
      sessionId: "ses_tool",
      alreadyIdle: true,
    });
    expect(result.stubbed).toBe(1);
    expect(updates[0]?.state).toMatchObject({ attachments: [] });
  });

  test("stubs tool PDF read attachments after idle (not only data:image)", async () => {
    const {
      buildToolMediaAttachmentStub,
      isEphemeralToolMediaAttachment,
      isToolPartWithEphemeralMediaAttachments,
    } = await import(
      "../src/react-app/domains/wodeapp/wodeapp-vision-history-compact"
    );
    expect(isEphemeralToolMediaAttachment({
      mime: "application/pdf",
      url: "data:application/pdf;base64,JVBERg==",
    })).toBe(true);
    const toolPart = {
      id: "prt_read_pdf",
      messageID: "msg_assistant",
      type: "tool",
      callID: "call_read_pdf",
      tool: "read",
      state: {
        status: "completed",
        input: { path: "/tmp/quote.pdf" },
        output: "PDF read successfully",
        title: "/tmp/quote.pdf",
        attachments: [{
          type: "file",
          mime: "application/pdf",
          url: "data:application/pdf;base64,JVBERi0xLjQK",
        }],
        time: { start: 1, end: 2 },
      },
    };
    expect(isToolPartWithEphemeralMediaAttachments(toolPart)).toBe(true);
    const stubbed = buildToolMediaAttachmentStub(
      toolPart as never,
      "ses_test",
      "msg_assistant",
    );
    expect(stubbed?.state).toMatchObject({
      attachments: [],
      metadata: { wodeappMediaStubbed: true },
    });
    expect(String((stubbed?.state as { output?: string }).output)).toContain("openwork_pdf");
    expect(String((stubbed?.state as { output?: string }).output)).toContain("Never call OpenCode read on PDF");
  });

  test("recovery sweep no longer deletes vision pixels (keep chat thumbnails)", async () => {
    const { sweepRecoverableSessionHistory } = await import(
      "../src/react-app/domains/wodeapp/wodeapp-vision-history-compact"
    );
    const deleted: string[] = [];
    const client = {
      session: {
        status: async () => ({ data: { ses_recovery: { type: "idle" } } }),
        messages: async () => ({
          data: [
            {
              info: { id: "msg_safe" },
              parts: [
                buildVisionEphemeralFollowupPart([
                  attachment({
                    id: "safe-image",
                    name: "safe.png",
                    mimeType: "image/png",
                    kind: "image",
                  }),
                ], { contextRefId: "ctx_recovery_vision_1234" }),
                {
                  id: "prt_safe",
                  type: "file",
                  filename: "safe.png",
                  mime: "image/png",
                  url: "data:image/png;base64,aaaa",
                },
              ],
            },
            {
              info: { id: "msg_unsafe" },
              parts: [
                buildVisionEphemeralFollowupPart([
                  attachment({
                    id: "unsafe-image",
                    name: "unsafe.png",
                    mimeType: "image/png",
                    kind: "image",
                  }),
                ]),
                {
                  id: "prt_unsafe",
                  type: "file",
                  filename: "unsafe.png",
                  mime: "image/png",
                  url: "data:image/png;base64,bbbb",
                },
              ],
            },
          ],
        }),
      },
      part: {
        delete: async (params: { partID: string }) => {
          deleted.push(params.partID);
          return {};
        },
        update: async () => ({}),
      },
    };
    const result = await sweepRecoverableSessionHistory({
      client,
      sessionId: "ses_recovery",
    });
    expect(result).toMatchObject({ idle: true, deletedVision: 0 });
    expect(deleted).toEqual([]);
  });
});
