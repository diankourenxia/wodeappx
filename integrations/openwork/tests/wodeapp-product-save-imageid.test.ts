import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  WODEAPP_DIRECT_ACTION_CONTRACT_BY_TOOL_NAME,
} from "../wodeapp/wodeapp-direct-action-contracts";

const WODEAPP_DIR = resolve(import.meta.dir, "../wodeapp");

describe("unified session image path", () => {
  test("product_save and image_asset_save share selectedImageIds vocabulary", () => {
    const product = WODEAPP_DIRECT_ACTION_CONTRACT_BY_TOOL_NAME.get("wodeapp_product_save")!;
    const image = WODEAPP_DIRECT_ACTION_CONTRACT_BY_TOOL_NAME.get("wodeapp_image_asset_save")!;

    expect(product.inputSchema.properties.selectedImageIds?.type).toBe("array");
    expect(image.inputSchema.properties.selectedImageIds?.type).toBe("array");
    expect(product.inputSchema.properties.productImages?.type).toBe("array"); // compat legacy
    expect(product.inputSchema.properties.expectedImageCount?.type).toBe("integer"); // compat ignore
    expect(product.inputSchema.properties.sourceProductImages?.type).toBe("array"); // compat ignore
    expect(image.inputSchema.required).toEqual(["name"]);
    expect(product.description).toContain("selectedImageIds");
    expect(image.description).toContain("selectedImageIds");
    expect(image.description).toContain("wodeapp_product_save");
  });

  test("product_save execute uses shared materialize and does not clear turn on success", () => {
    const source = readFileSync(resolve(WODEAPP_DIR, "wodeapp-session-control-actions.tsx"), "utf8");
    const start = source.indexOf("function buildProductSaveControlAction");
    const end = source.indexOf("function buildImageAssetSaveControlAction", start);
    const body = source.slice(start, end);
    expect(body).toContain("resolveAndMaterializeSessionImages");
    expect(body).toContain("selectedImageIds");
    expect(body).toContain("materializeProductImageUrls");
    expect(body).toContain("mediaImageIds");
    expect(body).not.toContain("clearCurrentSessionProductImageTurn");
    expect(body).not.toContain("validateProductImageExpectation");
  });

  test("image_asset_save execute accepts selectedImageIds via shared materialize", () => {
    const source = readFileSync(resolve(WODEAPP_DIR, "wodeapp-session-control-actions.tsx"), "utf8");
    const start = source.indexOf("function buildImageAssetSaveControlAction");
    const end = source.indexOf("function buildPromptSaveControlAction", start);
    const body = source.slice(start, end);
    expect(body).toContain("resolveAndMaterializeSessionImages");
    expect(body).toContain("selectedImageIds");
    expect(body).toContain("imageUrls");
    expect(body).toContain("materializedIds.httpsCount !== imageUrls.length");
    expect(body).toContain("materialized.httpsCount !== imageUrls.length");
  });

  test("materialize exports shared resolveAndMaterializeSessionImages helper", () => {
    const source = readFileSync(resolve(WODEAPP_DIR, "wodeapp-product-image-materialize.ts"), "utf8");
    expect(source).toContain("export async function resolveAndMaterializeSessionImages");
    expect(source).toContain("previously registered session images");
    expect(source).toContain("NEED_USER_SELECT");
    expect(source).toContain("超过 ${maxImages} 张上限");
  });

  test(">12 candidates require NEED_USER_SELECT before product or image shelf save", () => {
    const actions = readFileSync(resolve(WODEAPP_DIR, "wodeapp-session-control-actions.tsx"), "utf8");
    expect(actions).toContain("buildNeedUserSelectError");
    expect(actions).toContain("超过 12 张上限");
    expect(actions).toContain('operation: "product_save"');
    expect(actions).toContain('operation: "image_asset_save"');
    const materialize = readFileSync(resolve(WODEAPP_DIR, "wodeapp-product-image-materialize.ts"), "utf8");
    // 14 > 12 must ask once; auto-select only when candidates ≤ maxImages
    expect(materialize).toContain("if (candidates.length > maxImages)");
    expect(materialize).toContain("code: \"NEED_USER_SELECT\"");
  });

  test("attachment and vision prompts publish unified candidate guidance", () => {
    const attachment = readFileSync(resolve(WODEAPP_DIR, "wodeapp-attachment-intelligence.ts"), "utf8");
    const promptStart = attachment.indexOf("export function buildAttachmentIntelligencePart");
    const promptEnd = attachment.indexOf("export const WODEAPP_ATTACHMENT_PLACEHOLDER_URL", promptStart);
    const promptSource = attachment.slice(promptStart, promptEnd);
    expect(attachment).toContain("candidateImages=");
    expect(attachment).toContain("candidateHttpsImages=");
    expect(attachment).toContain("按用户意图选货架");
    expect(attachment).toContain("wodeapp_product_save");
    expect(attachment).toContain("wodeapp_image_asset_save");
    expect(attachment).not.toContain("不要先调 image_asset_save");
    expect(promptSource).not.toContain("`productImages=${");
    expect(promptSource).not.toContain("expectedImageCount=");
    expect(promptSource).not.toContain("sourceProductImages=");
  });
});
