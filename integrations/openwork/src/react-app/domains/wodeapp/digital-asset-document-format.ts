/**
 * Document-format helpers for digital assets (contract §1.4).
 *
 * Document kinds (品牌库 / 提示词 / 剧本):
 *   - persist Markdown as the primary portable file (Agent-friendly)
 *   - preview by rendering Markdown → styled HTML (images + video/audio tags)
 *
 * Media kinds (图片 / 视频 / 声音 / 真人 / 商品主图):
 *   - keep native binaries; do not wrap into Markdown
 */

import type { BrandAssetEntry, DigitalAssetItem } from "./digital-assets-data";

export const WODEAPP_DIGITAL_ASSET_DOCUMENT_CONTRACT = "wodeapp.digital-assets/1.2";

export const DIGITAL_ASSET_DOCUMENT_KINDS = ["品牌库", "提示词", "剧本"] as const;
export type DigitalAssetDocumentKind = (typeof DIGITAL_ASSET_DOCUMENT_KINDS)[number];

export const DIGITAL_ASSET_MD_MIME = "text/markdown";
export const DIGITAL_ASSET_HTML_MIME = "text/html";
export const DIGITAL_ASSET_DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function isDigitalAssetDocumentKind(kind: string | null | undefined): kind is DigitalAssetDocumentKind {
  return DIGITAL_ASSET_DOCUMENT_KINDS.includes(String(kind || "") as DigitalAssetDocumentKind);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlDocument(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  body { margin: 28px auto; max-width: 720px; padding: 0 20px 48px; color: #1a1a1a; font: 15px/1.65 "PingFang SC", "Microsoft YaHei", sans-serif; }
  h1 { font-size: 26px; line-height: 1.25; margin: 0 0 8px; }
  h2 { font-size: 17px; margin: 28px 0 10px; }
  h3 { font-size: 15px; margin: 20px 0 8px; }
  p, li { color: #2c2c2c; }
  blockquote { margin: 12px 0; padding: 8px 14px; border-left: 3px solid #FF6600; color: #4a4a4a; background: #fff7f0; }
  .meta { color: #4a4a4a; font-size: 13px; margin: 0 0 24px; }
  .swatches { display: flex; flex-wrap: wrap; gap: 10px; margin: 12px 0 8px; }
  .swatch { width: 28px; height: 28px; border-radius: 999px; border: 1px solid rgba(0,0,0,.12); }
  .chip { display: inline-block; margin: 0 6px 6px 0; padding: 4px 10px; border-radius: 999px; background: #fff4eb; color: #b34700; font-size: 12px; }
  section { margin-top: 18px; padding-top: 8px; border-top: 1px solid rgba(26,26,26,.08); }
  pre, code { white-space: pre-wrap; word-break: break-word; background: #f7f7f5; }
  pre { padding: 14px; border-radius: 10px; }
  img, video, audio { display: block; max-width: 100%; margin: 12px 0; border-radius: 10px; }
  video, audio { width: 100%; }
  a { color: #b34700; }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

export function buildBrandGuidelineHtml(input: {
  name: string;
  summary?: string;
  colors?: string[];
  voice?: string;
  rules?: string;
  entries?: BrandAssetEntry[];
}): string {
  const colors = (input.colors || []).filter(Boolean);
  const swatches = colors.length
    ? `<div class="swatches">${colors.map((color) =>
      `<span class="swatch" title="${escapeHtml(color)}" style="background:${escapeHtml(color)}"></span>`).join("")}</div>
       <p>${colors.map((color) => escapeHtml(color)).join(" · ")}</p>`
    : "<p>未指定品牌色</p>";
  const entries = (input.entries || []).map((entry) => {
    const chips = (entry.keywords || []).map((keyword) =>
      `<span class="chip">${escapeHtml(keyword)}</span>`).join("");
    return `<section>
  <h2>${escapeHtml(entry.category)} · ${escapeHtml(entry.title)}</h2>
  <p>${escapeHtml(entry.description || "")}</p>
  ${chips ? `<div>${chips}</div>` : ""}
  ${entry.scenePrompt ? `<p><strong>生成提示：</strong>${escapeHtml(entry.scenePrompt)}</p>` : ""}
</section>`;
  }).join("\n");

  const body = `
<h1>${escapeHtml(input.name)}</h1>
<p class="meta">品牌规范 · 由 Markdown 渲染</p>
${input.summary ? `<p>${escapeHtml(input.summary)}</p>` : ""}
<section>
  <h2>品牌色</h2>
  ${swatches}
</section>
${input.voice ? `<section><h2>语气</h2><p>${escapeHtml(input.voice)}</p></section>` : ""}
${input.rules ? `<section><h2>规范</h2><pre>${escapeHtml(input.rules)}</pre></section>` : ""}
${entries}
`;
  return htmlDocument(input.name, body);
}

export function buildPlainDocumentHtml(input: {
  name: string;
  kindLabel: string;
  summary?: string;
  body: string;
  tags?: string[];
}): string {
  const chips = (input.tags || []).map((tag) =>
    `<span class="chip">${escapeHtml(tag)}</span>`).join("");
  const html = `
<h1>${escapeHtml(input.name)}</h1>
<p class="meta">${escapeHtml(input.kindLabel)} · 由 Markdown 渲染</p>
${input.summary ? `<p>${escapeHtml(input.summary)}</p>` : ""}
${chips ? `<div>${chips}</div>` : ""}
<section>
  <h2>正文</h2>
  <pre>${escapeHtml(input.body)}</pre>
</section>
`;
  return htmlDocument(input.name, html);
}

export function htmlToDataUrl(html: string): string {
  return textToDataUrl(html, DIGITAL_ASSET_HTML_MIME);
}

export function markdownToDataUrl(markdown: string): string {
  return textToDataUrl(markdown, DIGITAL_ASSET_MD_MIME);
}

function textToDataUrl(text: string, mime: string): string {
  if (typeof Buffer !== "undefined") {
    return `data:${mime};base64,${Buffer.from(text, "utf8").toString("base64")}`;
  }
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return `data:${mime};base64,${btoa(binary)}`;
}

export function decodeDataUrlText(dataUrl: string | null | undefined): string | null {
  const raw = String(dataUrl || "").trim();
  if (!raw.startsWith("data:")) return null;
  const comma = raw.indexOf(",");
  if (comma < 0) return null;
  const header = raw.slice(0, comma);
  const payload = raw.slice(comma + 1);
  try {
    if (/;base64/i.test(header)) {
      if (typeof Buffer !== "undefined") return Buffer.from(payload, "base64").toString("utf8");
      const binary = atob(payload);
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
}

export function safeDocumentFileName(name: string, ext = "md"): string {
  const base = name.trim().replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").slice(0, 80) || "asset";
  return `${base}.${ext}`;
}

type DocumentMediaRef = {
  url: string;
  name?: string;
  mediaType: "image" | "video" | "audio";
};

function guessMediaType(url: string, typeHint?: string, nameHint?: string): DocumentMediaRef["mediaType"] | null {
  const type = String(typeHint || "").toLowerCase();
  const name = String(nameHint || "").toLowerCase();
  const lowerUrl = url.toLowerCase();
  if (type.startsWith("video/") || /\.(mp4|mov|webm|m4v|mkv)(\?|$)/i.test(name) || /\.(mp4|mov|webm|m4v|mkv)(\?|$)/i.test(lowerUrl) || lowerUrl.startsWith("data:video/")) {
    return "video";
  }
  if (type.startsWith("audio/") || /\.(mp3|wav|m4a|aac|flac|ogg)(\?|$)/i.test(name) || /\.(mp3|wav|m4a|aac|flac|ogg)(\?|$)/i.test(lowerUrl) || lowerUrl.startsWith("data:audio/")) {
    return "audio";
  }
  if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i.test(name) || /\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i.test(lowerUrl) || lowerUrl.startsWith("data:image/")) {
    return "image";
  }
  return null;
}

/** Collect image/video/audio URLs that belong in a document body (not the .md/.html file itself). */
export function collectDocumentMedia(item: DigitalAssetItem): DocumentMediaRef[] {
  const out: DocumentMediaRef[] = [];
  const push = (url: string | undefined, name?: string, typeHint?: string) => {
    const trimmed = String(url || "").trim();
    if (!trimmed) return;
    if (trimmed.startsWith("data:text/")) return;
    const mediaType = guessMediaType(trimmed, typeHint, name);
    if (!mediaType) return;
    if (out.some((entry) => entry.url === trimmed)) return;
    out.push({ url: trimmed, name, mediaType });
  };

  for (const url of item.brandAssets || []) push(url, undefined, "image/");
  for (const url of item.assetImages || []) push(url, undefined, "image/");
  for (const url of item.productImages || []) push(url, undefined, "image/");
  if (item.coverImage) push(item.coverImage, "封面", "image/");
  if (item.assetFile) {
    push(item.assetFile, item.assetFileName, item.assetFileType);
  }
  for (const file of item.assetFiles || []) {
    push(file.url, file.name, file.type || file.mediaType);
  }
  return out;
}

function formatMediaMarkdown(media: DocumentMediaRef[]): string[] {
  if (!media.length) return [];
  const lines = ["## 资源", ""];
  for (const entry of media) {
    const label = entry.name || (entry.mediaType === "image" ? "图片" : entry.mediaType === "video" ? "视频" : "音频");
    if (entry.mediaType === "image") {
      lines.push(`![${label}](${entry.url})`, "");
    } else if (entry.mediaType === "video") {
      lines.push(`${label}：`, "", `<video controls preload="metadata" src="${entry.url}"></video>`, "");
    } else {
      lines.push(`${label}：`, "", `<audio controls preload="metadata" src="${entry.url}"></audio>`, "");
    }
  }
  return lines;
}

function colorSwatchMarkdown(colors: string[]): string[] {
  if (!colors.length) return ["未指定品牌色"];
  return [
    colors.map((color) =>
      `<span class="swatch" title="${color}" style="background:${color}"></span>`
    ).join(""),
    "",
    ...colors.map((color) => `- \`${color}\``),
  ];
}

export function buildDocumentHtmlForAsset(item: DigitalAssetItem): string {
  return markdownToPreviewHtml(buildDocumentMarkdownForAsset(item), item.name);
}

/** Canonical Markdown body for document-like assets (Agent insert + storage). */
export function buildDocumentMarkdownForAsset(item: DigitalAssetItem): string {
  const media = collectDocumentMedia({
    ...item,
    // Avoid treating the primary document file as media when regenerating.
    assetFile: item.assetFileType?.includes("markdown") || item.assetFileType?.includes("html") || item.assetFileName?.match(/\.(md|html?)$/i)
      ? undefined
      : item.assetFile,
    assetFiles: (item.assetFiles || []).filter((file) => {
      const type = String(file.type || "").toLowerCase();
      const name = String(file.name || "").toLowerCase();
      return !(type.includes("markdown") || type.includes("text/html") || type.includes("wordprocessingml")
        || /\.(md|html?|docx?)$/i.test(name) || String(file.url || "").startsWith("data:text/"));
    }),
  });

  if (item.kind === "品牌库") {
    const lines = [
      `# ${item.name}`,
      "",
      "> 品牌规范 · Markdown",
      "",
      item.promptText?.trim() || "",
      "",
      "## 品牌色",
      "",
      ...colorSwatchMarkdown(item.brandColors || []),
      "",
      item.brandVoice ? `## 语气\n\n${item.brandVoice}\n` : "",
      item.brandRules ? `## 规范\n\n\`\`\`\n${item.brandRules}\n\`\`\`\n` : "",
      ...(item.brandEntries || []).flatMap((entry) => [
        `## ${entry.category} · ${entry.title}`,
        "",
        entry.description || "",
        "",
        ...(entry.keywords || []).map((keyword) => `- ${keyword}`),
        entry.scenePrompt ? `\n生成提示：${entry.scenePrompt}\n` : "",
        "",
      ]),
      ...formatMediaMarkdown(media),
    ];
    return collapseBlankLines(lines);
  }

  return collapseBlankLines([
    `# ${item.name}`,
    "",
    `> ${item.kind} · Markdown`,
    "",
    item.meta || "",
    "",
    ...(item.promptTags || []).map((tag) => `- ${tag}`),
    "",
    "## 正文",
    "",
    item.promptText || item.productInfo || "",
    "",
    ...formatMediaMarkdown(media),
  ]);
}

function collapseBlankLines(lines: string[]): string {
  return `${lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()}\n`;
}

const SAFE_HTML_BLOCK =
  /^(<(?:span|div|p|br|strong|em|code|pre|ul|ol|li|h[1-6]|blockquote|section|video|audio|img|a)\b[^>]*>.*<\/(?:span|div|p|strong|em|code|pre|ul|ol|li|h[1-6]|blockquote|section|video|audio|a)>|<br\s*\/?>|<(?:img|video|audio)\b[^>]*\/?>)$/i;

/** Lightweight Markdown → HTML for modal preview (supports images + video/audio tags). */
export function markdownToPreviewHtml(markdown: string, title = "文档预览"): string {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const htmlParts: string[] = [];
  let inList = false;
  let inCode = false;
  let codeBuffer: string[] = [];

  const closeList = () => {
    if (inList) {
      htmlParts.push("</ul>");
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine;
    if (line.trim().startsWith("```")) {
      if (inCode) {
        htmlParts.push(`<pre>${escapeHtml(codeBuffer.join("\n"))}</pre>`);
        codeBuffer = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuffer.push(line);
      continue;
    }

    if (!line.trim()) {
      closeList();
      continue;
    }

    if (SAFE_HTML_BLOCK.test(line.trim()) || /^<span class="swatch"[\s\S]*<\/span>$/i.test(line.trim()) || line.trim().startsWith("<span class=\"swatch\"")) {
      closeList();
      // Allow generated swatch rows / media tags through.
      if (line.includes("class=\"swatch\"") || line.includes("class='swatch'")) {
        htmlParts.push(`<div class="swatches">${line.trim()}</div>`);
      } else {
        htmlParts.push(line.trim());
      }
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length;
      htmlParts.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    if (/^>\s?/.test(line)) {
      closeList();
      htmlParts.push(`<blockquote><p>${inlineMarkdown(line.replace(/^>\s?/, ""))}</p></blockquote>`);
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        htmlParts.push("<ul>");
        inList = true;
      }
      htmlParts.push(`<li>${inlineMarkdown(line.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }

    const image = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(line.trim());
    if (image) {
      closeList();
      htmlParts.push(`<img src="${escapeHtml(image[2])}" alt="${escapeHtml(image[1])}" />`);
      continue;
    }

    closeList();
    htmlParts.push(`<p>${inlineMarkdown(line)}</p>`);
  }

  closeList();
  if (inCode) htmlParts.push(`<pre>${escapeHtml(codeBuffer.join("\n"))}</pre>`);
  return htmlDocument(title, htmlParts.join("\n"));
}

function inlineMarkdown(text: string): string {
  let value = escapeHtml(text);
  value = value.replace(/`([^`]+)`/g, "<code>$1</code>");
  value = value.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  value = value.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) =>
    `<img src="${url}" alt="${alt}" />`);
  value = value.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) =>
    `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>`);
  return value;
}

function isMarkdownFile(file: { url?: string; type?: string; name?: string } | null | undefined): boolean {
  if (!file?.url) return false;
  const type = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();
  const url = String(file.url || "");
  return type.includes("markdown")
    || type === "text/x-markdown"
    || name.endsWith(".md")
    || url.startsWith("data:text/markdown");
}

function isHtmlFile(file: { url?: string; type?: string; name?: string } | null | undefined): boolean {
  if (!file?.url) return false;
  const type = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();
  const url = String(file.url || "");
  return type.includes("text/html")
    || name.endsWith(".html")
    || name.endsWith(".htm")
    || url.startsWith("data:text/html");
}

function isPortableDocumentFile(file: { url?: string; type?: string; name?: string } | null | undefined): boolean {
  if (!file?.url) return false;
  if (isMarkdownFile(file) || isHtmlFile(file)) return true;
  const type = String(file.type || "").toLowerCase();
  const name = String(file.name || "").toLowerCase();
  return type.includes("wordprocessingml") || /\.docx?$/i.test(name);
}

function listCandidateFiles(item: DigitalAssetItem) {
  return [
    item.assetFile ? { url: item.assetFile, type: item.assetFileType, name: item.assetFileName, size: item.assetFileSize } : null,
    ...(item.assetFiles || []),
  ].filter(Boolean) as Array<{ url: string; type?: string; name?: string; size?: number }>;
}

export function resolveAssetDocumentMarkdown(item: DigitalAssetItem): string | null {
  for (const file of listCandidateFiles(item)) {
    if (!isMarkdownFile(file)) continue;
    if (file.url.startsWith("data:")) {
      const decoded = decodeDataUrlText(file.url);
      if (decoded) return decoded;
    }
  }
  if (isDigitalAssetDocumentKind(item.kind)) return buildDocumentMarkdownForAsset(item);
  return null;
}

export function resolveAssetDocumentHtml(item: DigitalAssetItem): string | null {
  const markdown = (() => {
    for (const file of listCandidateFiles(item)) {
      if (!isMarkdownFile(file)) continue;
      if (file.url.startsWith("data:")) return decodeDataUrlText(file.url);
    }
    return null;
  })();
  if (markdown) return markdownToPreviewHtml(markdown, item.name);

  for (const file of listCandidateFiles(item)) {
    if (!isHtmlFile(file)) continue;
    if (file.url.startsWith("data:text/html")) {
      const decoded = decodeDataUrlText(file.url);
      if (decoded) return decoded;
    }
  }

  if (isDigitalAssetDocumentKind(item.kind)) {
    return markdownToPreviewHtml(buildDocumentMarkdownForAsset(item), item.name);
  }
  return null;
}

/**
 * Attach a single primary Markdown document for document-like kinds.
 * Existing Markdown is kept; legacy HTML-only assets are migrated to Markdown.
 * Media binaries stay in brandAssets / assetImages / separate assetFiles and are
 * referenced from the Markdown body — not duplicated as the primary document.
 */
export function needsDigitalAssetDocumentMigration(item: DigitalAssetItem): boolean {
  if (!isDigitalAssetDocumentKind(item.kind)) return false;
  const candidates = listCandidateFiles(item);
  const markdownFiles = candidates.filter(isMarkdownFile);
  const htmlFiles = candidates.filter(isHtmlFile);
  const docFiles = candidates.filter(isPortableDocumentFile);
  if (!markdownFiles.length) return true;
  if (htmlFiles.length) return true;
  if (docFiles.length > 1) return true;
  if (/\bHTML\b/i.test(item.meta || "") && !/\bMarkdown\b/i.test(item.meta || "")) return true;
  if (!item.assetFileType?.toLowerCase().includes("markdown") && !item.assetFileName?.toLowerCase().endsWith(".md")) {
    return true;
  }
  return false;
}

function hasRichDocumentIndex(item: DigitalAssetItem): boolean {
  if ((item.brandEntries?.length || 0) > 0) return true;
  if ((item.promptText || "").trim().length >= 40) return true;
  if (`${item.brandVoice || ""}${item.brandRules || ""}`.trim().length >= 20) return true;
  if ((item.brandColors?.length || 0) > 0 && (item.promptText || "").trim()) return true;
  return false;
}

/** Best-effort HTML → Markdown when migrating legacy document attachments. */
export function htmlBodyToMarkdown(html: string, title = "文档"): string {
  let text = String(html || "");
  text = text.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, body) => `# ${stripTags(body).trim()}\n\n`);
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, body) => `## ${stripTags(body).trim()}\n\n`);
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, body) => `### ${stripTags(body).trim()}\n\n`);
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, body) => `- ${stripTags(body).trim()}\n`);
  text = text.replace(/<img\b[^>]*src=["']([^"']+)["'][^>]*>/gi, (_, src) => `![图片](${src})\n\n`);
  text = text.replace(/<video\b[^>]*src=["']([^"']+)["'][^>]*>[\s\S]*?<\/video>/gi, (_, src) =>
    `<video controls preload="metadata" src="${src}"></video>\n\n`);
  text = text.replace(/<audio\b[^>]*src=["']([^"']+)["'][^>]*>[\s\S]*?<\/audio>/gi, (_, src) =>
    `<audio controls preload="metadata" src="${src}"></audio>\n\n`);
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, body) => `\`\`\`\n${stripTags(body).trim()}\n\`\`\`\n\n`);
  text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, body) => `> ${stripTags(body).trim()}\n\n`);
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, body) => `${stripTags(body).trim()}\n\n`);
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = stripTags(text);
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return `# ${title}\n\n`;
  if (!/^#\s/m.test(text)) return `# ${title}\n\n${text}\n`;
  return `${text}\n`;
}

function stripTags(value: string): string {
  return String(value || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function resolveMarkdownForMigration(item: DigitalAssetItem): string {
  if (hasRichDocumentIndex(item)) return buildDocumentMarkdownForAsset(item);
  const htmlFile = listCandidateFiles(item).find(isHtmlFile);
  if (htmlFile?.url?.startsWith("data:")) {
    const html = decodeDataUrlText(htmlFile.url);
    if (html?.trim()) return htmlBodyToMarkdown(html, item.name);
  }
  return buildDocumentMarkdownForAsset(item);
}

function keepMediaAttachments(item: DigitalAssetItem) {
  return (item.assetFiles || []).filter((file) => !isPortableDocumentFile(file));
}

export function ensureDigitalAssetDocument(item: DigitalAssetItem): DigitalAssetItem {
  if (!isDigitalAssetDocumentKind(item.kind)) return item;

  const candidates = listCandidateFiles(item);
  const existingMd = candidates.find(isMarkdownFile);
  const mediaFiles = keepMediaAttachments(item);

  if (existingMd?.url && !needsDigitalAssetDocumentMigration(item)) {
    const fileName = existingMd.name || safeDocumentFileName(item.name, "md");
    const type = existingMd.type || DIGITAL_ASSET_MD_MIME;
    const size = existingMd.size || item.assetFileSize || item.assetFiles?.find((file) => file.url === existingMd.url)?.size || 0;
    return {
      ...item,
      meta: normalizeDocumentMeta(item.meta, item.kind, "Markdown"),
      assetFile: existingMd.url,
      assetFileName: fileName,
      assetFileType: type,
      assetFileSize: size,
      assetFiles: [{
        url: existingMd.url,
        name: fileName,
        type,
        size,
        mediaType: "document",
      }, ...mediaFiles],
    };
  }

  // Prefer an existing Markdown body when present; otherwise migrate HTML / rebuild from indexes.
  let markdown = "";
  if (existingMd?.url?.startsWith("data:")) {
    markdown = decodeDataUrlText(existingMd.url) || "";
  }
  if (!markdown.trim()) {
    markdown = resolveMarkdownForMigration(item);
  }

  const fileName = safeDocumentFileName(item.name, "md");
  const dataUrl = markdownToDataUrl(markdown);
  const fileRef = {
    url: dataUrl,
    name: fileName,
    type: DIGITAL_ASSET_MD_MIME,
    size: markdown.length,
    mediaType: "document" as const,
  };

  return {
    ...item,
    meta: normalizeDocumentMeta(item.meta, item.kind, "Markdown"),
    assetFile: dataUrl,
    assetFileName: fileName,
    assetFileType: DIGITAL_ASSET_MD_MIME,
    assetFileSize: markdown.length,
    assetFiles: [fileRef, ...mediaFiles],
  };
}

function normalizeDocumentMeta(meta: string | undefined, kind: string, format: "Markdown" | "HTML"): string {
  const raw = String(meta || "").trim();
  if (!raw) return `${format} · ${kind}`;
  if (/markdown|html/i.test(raw)) return raw.replace(/\bHTML\b/gi, format).replace(/\bMarkdown\b/gi, format);
  return `${format} · ${raw}`;
}

/** @deprecated Use ensureDigitalAssetDocument — kept for import compatibility. */
export const ensureDigitalAssetHtmlDocument = ensureDigitalAssetDocument;
