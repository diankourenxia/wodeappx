import { describe, expect, test } from "bun:test";

import {
  DIGITAL_ASSET_HTML_MIME,
  DIGITAL_ASSET_MD_MIME,
  ensureDigitalAssetDocument,
  ensureDigitalAssetHtmlDocument,
  buildBrandGuidelineHtml,
  buildDocumentMarkdownForAsset,
  htmlBodyToMarkdown,
  htmlToDataUrl,
  markdownToPreviewHtml,
  needsDigitalAssetDocumentMigration,
  resolveAssetDocumentHtml,
  resolveAssetDocumentMarkdown,
} from "../wodeapp/digital-asset-document-format";
import { SUPOR_SITE_DIGITAL_ASSETS } from "../wodeapp/supor-site-assets";
import { wodeAppDigitalAssetCapabilities } from "../wodeapp/wodeapp-digital-asset-contract";

describe("digital asset document format (§1.4)", () => {
  test("brand guideline html includes title and colors", () => {
    const html = buildBrandGuidelineHtml({
      name: "苏泊尔 品牌资产",
      colors: ["#FF6600", "#1A1A1A"],
      voice: "清晰可信",
    });
    expect(html).toContain("苏泊尔 品牌资产");
    expect(html).toContain("#FF6600");
    expect(html).toContain("清晰可信");
  });

  test("document kinds get a markdown assetFile attached", () => {
    const withDoc = ensureDigitalAssetDocument({
      id: "t1",
      name: "测试提示词",
      kind: "提示词",
      meta: "提示词",
      preview: "prompt",
      promptText: "生成一张干净主图",
    });
    expect(withDoc.assetFileType).toBe(DIGITAL_ASSET_MD_MIME);
    expect(withDoc.assetFile?.startsWith("data:text/markdown")).toBe(true);
    expect(withDoc.assetFileName || "").toMatch(/\.md$/);
    expect(withDoc.assetFiles?.length).toBe(1);
    expect(withDoc.meta).toContain("Markdown");
  });

  test("legacy html alias still migrates to markdown", () => {
    const withDoc = ensureDigitalAssetHtmlDocument({
      id: "t1b",
      name: "测试剧本",
      kind: "剧本",
      meta: "HTML · 分镜",
      preview: "script",
      promptText: "第一镜：特写",
    });
    expect(withDoc.assetFileType).toBe(DIGITAL_ASSET_MD_MIME);
    expect(withDoc.meta).toContain("Markdown");
  });

  test("ensureDigitalAssetDocument collapses duplicate document rows", () => {
    const markdown = buildDocumentMarkdownForAsset({
      id: "t2",
      name: "苏泊尔 品牌资产",
      kind: "品牌库",
      meta: "品牌规范",
      preview: "brand",
      brandColors: ["#FF6600"],
    });
    const dataUrl = `data:text/markdown;base64,${Buffer.from(markdown, "utf8").toString("base64")}`;
    const collapsed = ensureDigitalAssetDocument({
      id: "t2",
      name: "苏泊尔 品牌资产",
      kind: "品牌库",
      meta: "HTML · 品牌规范",
      preview: "brand",
      assetFile: dataUrl,
      assetFileName: "苏泊尔 品牌资产.md",
      assetFileType: DIGITAL_ASSET_MD_MIME,
      assetFileSize: markdown.length,
      assetFiles: [
        { url: dataUrl, name: "苏泊尔 品牌资产.md", type: DIGITAL_ASSET_MD_MIME, size: markdown.length, mediaType: "document" },
        { url: dataUrl, name: "苏泊尔 品牌资产.md", type: DIGITAL_ASSET_MD_MIME, size: markdown.length, mediaType: "document" },
      ],
    });
    expect(collapsed.assetFiles?.length).toBe(1);
    expect(resolveAssetDocumentMarkdown(collapsed)).toContain("苏泊尔 品牌资产");
  });

  test("markdown preview renders images and video tags", () => {
    const md = [
      "# 示例",
      "",
      "![Logo](https://example.com/logo.png)",
      "",
      '<video controls preload="metadata" src="https://example.com/a.mp4"></video>',
      "",
    ].join("\n");
    const html = markdownToPreviewHtml(md, "示例");
    expect(html).toContain("<img src=\"https://example.com/logo.png\"");
    expect(html).toContain("<video controls");
    expect(html).toContain("https://example.com/a.mp4");
  });

  test("brand markdown includes media references", () => {
    const md = buildDocumentMarkdownForAsset({
      id: "t3",
      name: "品牌",
      kind: "品牌库",
      meta: "品牌规范",
      preview: "brand",
      brandColors: ["#FF6600"],
      brandAssets: ["https://example.com/logo.png"],
      assetFiles: [{
        url: "https://example.com/spot.mp4",
        name: "spot.mp4",
        type: "video/mp4",
        size: 12,
        mediaType: "video",
      }],
    });
    expect(md).toContain("![");
    expect(md).toContain("https://example.com/logo.png");
    expect(md).toContain("<video");
    expect(md).toContain("https://example.com/spot.mp4");
  });

  test("legacy html data url still previews", () => {
    const html = buildBrandGuidelineHtml({ name: "旧 HTML", colors: ["#FF6600"] });
    const item = {
      id: "legacy",
      name: "旧 HTML",
      kind: "品牌库" as const,
      meta: "HTML · 品牌规范",
      preview: "brand" as const,
      assetFile: htmlToDataUrl(html),
      assetFileName: "旧.html",
      assetFileType: DIGITAL_ASSET_HTML_MIME,
    };
    expect(resolveAssetDocumentHtml(item)).toContain("旧 HTML");
  });

  test("supor seed catalog stays lean with real photo sets", () => {
    const brand = SUPOR_SITE_DIGITAL_ASSETS.find((item) => item.kind === "品牌库");
    const products = SUPOR_SITE_DIGITAL_ASSETS.filter((item) => item.kind === "商品库");
    const imageSets = SUPOR_SITE_DIGITAL_ASSETS.filter((item) => item.kind === "图片");
    expect(brand?.assetFileType).toBe(DIGITAL_ASSET_MD_MIME);
    expect(brand?.coverImage).toBeTruthy();
    expect(brand?.coverImage?.includes("svg") || brand?.coverImage?.startsWith("data:image/svg")).toBe(true);
    expect(brand?.brandAssets?.length).toBe(1);
    expect(brand?.brandColors?.slice(0, 1)).toEqual(["#FF6600"]);
    expect((brand?.brandEntries || []).length).toBeGreaterThanOrEqual(5);
    expect(resolveAssetDocumentMarkdown(brand!)).toContain("Logo");
    expect(products.length).toBe(4);
    expect(imageSets.length).toBe(0);
    expect(SUPOR_SITE_DIGITAL_ASSETS.some((item) => item.kind === "视频")).toBe(false);
    expect(SUPOR_SITE_DIGITAL_ASSETS.some((item) => item.kind === "提示词")).toBe(false);
    expect(SUPOR_SITE_DIGITAL_ASSETS.some((item) => item.kind === "剧本")).toBe(false);
    expect(SUPOR_SITE_DIGITAL_ASSETS.length).toBe(5);
    for (const product of products) {
      expect((product.productImages || []).length).toBeGreaterThanOrEqual(2);
    }
    for (const item of SUPOR_SITE_DIGITAL_ASSETS) {
      const urls = [
        item.coverImage,
        ...(item.productImages || []),
        ...(item.assetImages || []),
        ...(item.brandAssets || []),
      ].filter(Boolean) as string[];
      for (const url of urls) {
        // Brand logo may be SVG data URL; product/demo assets must stay real photography.
        if (url.startsWith("data:image/svg")) continue;
        expect(url.includes(".svg")).toBe(false);
      }
    }
  });

  test("capabilities advertise markdown-first documentFormats at 1.2", () => {
    const caps = wodeAppDigitalAssetCapabilities();
    expect(caps.contractVersion).toBe("wodeapp.digital-assets/1.2");
    expect(caps.documentFormats.preferredMime[0]).toBe("text/markdown");
    expect(caps.documentFormats.preferredMime).toContain("text/html");
  });

  test("migrates legacy html-only brand asset to markdown", () => {
    const html = buildBrandGuidelineHtml({
      name: "旧品牌",
      colors: ["#FF6600"],
      voice: "清晰可信",
      summary: "沉淀品牌主色与语气",
    });
    const legacy = {
      id: "local-brand-legacy",
      name: "旧品牌",
      kind: "品牌库" as const,
      meta: "HTML · 品牌规范",
      preview: "brand" as const,
      assetFile: htmlToDataUrl(html),
      assetFileName: "旧品牌.html",
      assetFileType: DIGITAL_ASSET_HTML_MIME,
      assetFiles: [{
        url: htmlToDataUrl(html),
        name: "旧品牌.html",
        type: DIGITAL_ASSET_HTML_MIME,
        size: html.length,
        mediaType: "document" as const,
      }],
    };
    expect(needsDigitalAssetDocumentMigration(legacy)).toBe(true);
    const migrated = ensureDigitalAssetDocument(legacy);
    expect(migrated.assetFileType).toBe(DIGITAL_ASSET_MD_MIME);
    expect(migrated.assetFileName || "").toMatch(/\.md$/);
    expect(migrated.meta).toContain("Markdown");
    expect(needsDigitalAssetDocumentMigration(migrated)).toBe(false);
    expect(resolveAssetDocumentMarkdown(migrated)).toContain("旧品牌");
  });

  test("htmlBodyToMarkdown keeps headings and images", () => {
    const md = htmlBodyToMarkdown(
      "<h1>标题</h1><p>说明</p><img src=\"https://example.com/a.png\" alt=\"a\" />",
      "标题",
    );
    expect(md).toContain("# 标题");
    expect(md).toContain("说明");
    expect(md).toContain("https://example.com/a.png");
  });
});
