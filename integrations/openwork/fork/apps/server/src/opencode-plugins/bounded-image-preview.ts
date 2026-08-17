/**
 * Bounded JPEG preview for the current turn.
 * Used by openwork_media_view, screenshot, and pdf_render (maxEdge ≤1536, ≤512KB).
 * Accepts local raster paths or public http(s) / image-proxy URLs.
 */
import { isIP } from "node:net";
import { basename, extname, join } from "node:path";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";

const MEDIA_VIEW_MAX_PREVIEW_BYTES = 512 * 1024;
const MEDIA_VIEW_MAX_REMOTE_BYTES = 16 * 1024 * 1024;
const MEDIA_VIEW_MAX_REDIRECTS = 5;

type LocalCanvasModule = typeof import("@napi-rs/canvas");

async function loadLocalCanvas(): Promise<LocalCanvasModule> {
  const bundledCanvasUrl = new URL("./node_modules/@napi-rs/canvas/index.js", import.meta.url);
  return existsSync(fileURLToPath(bundledCanvasUrl))
    ? await import(bundledCanvasUrl.href) as LocalCanvasModule
    : await import(["@napi-rs", "canvas"].join("/")) as LocalCanvasModule;
}

export type BoundedImageAttachment = {
  type: "file";
  mime: string;
  url: string;
  filename: string;
};

export type BoundedImagePreview = {
  attachment: BoundedImageAttachment;
  previewWidth: number;
  previewHeight: number;
  previewBytes: number;
  sourceWidth: number;
  sourceHeight: number;
  path: string;
  sourceKind: "local" | "remote";
};

export function isRemoteImageSource(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (/^https?:\/\//i.test(trimmed)) return true;
  if (/^\/?(?:runtime-server\/api\/)?image-proxy\//i.test(trimmed)) return true;
  return false;
}

export function resolveDefaultWodeAppOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const raw = String(env.WODEAPP_ORIGIN || env.VITE_WODEAPP_ORIGIN || "https://wodeapp.cn").trim().replace(/\/$/, "");
  return raw || "https://wodeapp.cn";
}

/** Normalize local image-proxy paths and absolute http(s) URLs to an absolute URL string. */
export function normalizeRemoteImageUrl(input: string, env: NodeJS.ProcessEnv = process.env): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Image URL is required.");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;

  let path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const proxyMatch = path.match(/^\/(?:runtime-server\/api\/)?image-proxy\/(.+)$/i);
  if (proxyMatch) {
    path = `/runtime-server/api/image-proxy/${proxyMatch[1]}`;
  }
  return `${resolveDefaultWodeAppOrigin(env)}${path}`;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] === 0;
}

function isPrivateIpv6(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "::1"
    || normalized === "::"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized);
}

/** Reject loopback / private / credentialed URLs unless explicitly allowed for local dev. */
export function assertPublicImageFetchUrl(rawUrl: string, env: NodeJS.ProcessEnv = process.env): URL {
  let url: URL;
  try {
    url = new URL(String(rawUrl ?? "").trim());
  } catch {
    throw new Error("Image fetch requires a valid absolute URL.");
  }
  const allowInsecure = env.OPENWORK_ALLOW_INSECURE_REMOTE_FETCH === "1";
  if (url.protocol !== "https:" && !(allowInsecure && url.protocol === "http:")) {
    throw new Error("Image fetch requires HTTPS; set OPENWORK_ALLOW_INSECURE_REMOTE_FETCH=1 only for trusted local services.");
  }
  if (url.username || url.password) {
    throw new Error("Image fetch URLs must not contain credentials.");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const localName = !hostname
    || hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname.endsWith(".local")
    || hostname === "metadata.google.internal";
  const privateIp = isIP(hostname) === 4
    ? isPrivateIpv4(hostname)
    : isIP(hostname) === 6
      ? isPrivateIpv6(hostname)
      : false;
  if ((localName || privateIp) && env.OPENWORK_ALLOW_PRIVATE_REMOTE_FETCH !== "1") {
    throw new Error("Image fetch blocks loopback, link-local, and private-network targets by default.");
  }
  return url;
}

async function readBoundedResponseBytes(response: Response, maxBytes = MEDIA_VIEW_MAX_REMOTE_BYTES): Promise<Buffer> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Remote image exceeds the ${maxBytes}-byte download limit.`);
  }
  if (!response.body) {
    const fallback = Buffer.from(await response.arrayBuffer());
    if (fallback.byteLength > maxBytes) {
      throw new Error(`Remote image exceeds the ${maxBytes}-byte download limit.`);
    }
    return fallback;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Remote image exceeds the ${maxBytes}-byte download limit.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

export async function fetchRemoteImageBytes(
  input: string,
  options: { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ bytes: Buffer; finalUrl: string; contentType: string }> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  let current = assertPublicImageFetchUrl(normalizeRemoteImageUrl(input, env), env).toString();

  for (let hop = 0; hop <= MEDIA_VIEW_MAX_REDIRECTS; hop += 1) {
    const response = await fetchImpl(current, {
      method: "GET",
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WodeAppX-MediaView/0.1)",
        Accept: "image/*,*/*;q=0.8",
      },
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Remote image redirect missing Location (HTTP ${response.status}).`);
      current = assertPublicImageFetchUrl(new URL(location, current).toString(), env).toString();
      continue;
    }

    if (!response.ok) {
      throw new Error(`Remote image fetch failed (HTTP ${response.status}).`);
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType && !contentType.startsWith("image/") && !contentType.includes("octet-stream")) {
      throw new Error(`Remote URL did not return an image (content-type: ${contentType || "unknown"}).`);
    }

    const bytes = await readBoundedResponseBytes(response);
    if (bytes.byteLength < 32) {
      throw new Error("Remote image response was empty or too small.");
    }
    return { bytes, finalUrl: current, contentType };
  }

  throw new Error(`Remote image exceeded ${MEDIA_VIEW_MAX_REDIRECTS} redirects.`);
}

function remotePreviewFilename(url: string): string {
  try {
    const base = basename(new URL(url).pathname) || "remote-image";
    const stem = basename(base, extname(base)) || "remote-image";
    return `${stem}-view.jpg`;
  } catch {
    return "remote-image-view.jpg";
  }
}

async function encodeBoundedJpegPreview(
  loaded: { width: number; height: number; image: Awaited<ReturnType<LocalCanvasModule["loadImage"]>> },
  options: { maxEdge?: number; quality?: number; filename: string; path: string; sourceKind: "local" | "remote" },
): Promise<BoundedImagePreview> {
  const canvasModule = await loadLocalCanvas();
  if (!loaded.width || !loaded.height) throw new Error(`Image has invalid dimensions: ${options.path}`);

  let maxEdge = Math.max(256, Math.min(1536, options.maxEdge ?? 1280));
  let quality = Math.max(40, Math.min(80, options.quality ?? 70));
  let width = 0;
  let height = 0;
  let buffer = Buffer.alloc(0);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const scale = Math.min(1, maxEdge / Math.max(loaded.width, loaded.height));
    width = Math.max(1, Math.round(loaded.width * scale));
    height = Math.max(1, Math.round(loaded.height * scale));
    const canvas = canvasModule.createCanvas(width, height);
    canvas.getContext("2d").drawImage(loaded.image, 0, 0, width, height);
    const jpeg = canvas.toBuffer("image/jpeg", quality);
    buffer = Buffer.alloc(jpeg.byteLength);
    jpeg.copy(buffer);
    if (buffer.byteLength <= MEDIA_VIEW_MAX_PREVIEW_BYTES) break;
    if (quality > 45) quality = Math.max(45, quality - 10);
    else maxEdge = Math.max(256, Math.floor(maxEdge * 0.75));
  }

  return {
    path: options.path,
    sourceKind: options.sourceKind,
    sourceWidth: loaded.width,
    sourceHeight: loaded.height,
    previewWidth: width,
    previewHeight: height,
    previewBytes: buffer.byteLength,
    attachment: {
      type: "file",
      mime: "image/jpeg",
      url: `data:image/jpeg;base64,${buffer.toString("base64")}`,
      filename: options.filename,
    },
  };
}

/** Downscale a local raster or public image URL for the current turn only (data:image/jpeg). */
export async function createBoundedImagePreview(
  pathInput: string,
  options: {
    maxEdge?: number;
    quality?: number;
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<BoundedImagePreview> {
  const path = pathInput.trim();
  if (!path) throw new Error("Image path or URL is required.");

  if (isRemoteImageSource(path)) {
    const remote = await fetchRemoteImageBytes(path, {
      env: options.env,
      fetchImpl: options.fetchImpl,
    });
    // @napi-rs/canvas loadImage(Buffer) fails on some large PNGs ("Invalid SVG image");
    // always stage remote bytes to a temp file, then load by path.
    const stagingDir = await mkdtemp(join(tmpdir(), "wodeappx-media-view-"));
    const ext = (() => {
      try {
        const fromUrl = extname(new URL(remote.finalUrl).pathname).toLowerCase();
        if (fromUrl === ".jpg" || fromUrl === ".jpeg" || fromUrl === ".png" || fromUrl === ".webp" || fromUrl === ".gif") {
          return fromUrl;
        }
      } catch {
        // ignore
      }
      if (remote.contentType.includes("jpeg") || remote.contentType.includes("jpg")) return ".jpg";
      if (remote.contentType.includes("webp")) return ".webp";
      if (remote.contentType.includes("gif")) return ".gif";
      return ".png";
    })();
    const stagingPath = join(stagingDir, `source${ext}`);
    try {
      await writeFile(stagingPath, remote.bytes);
      const canvasModule = await loadLocalCanvas();
      const image = await canvasModule.loadImage(stagingPath);
      return encodeBoundedJpegPreview(
        { width: image.width, height: image.height, image },
        {
          maxEdge: options.maxEdge,
          quality: options.quality,
          filename: remotePreviewFilename(remote.finalUrl),
          path: remote.finalUrl,
          sourceKind: "remote",
        },
      );
    } finally {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  const fileStat = await stat(path);
  if (!fileStat.isFile()) throw new Error(`Image input is not a file: ${path}`);

  const canvasModule = await loadLocalCanvas();
  const image = await canvasModule.loadImage(path);
  return encodeBoundedJpegPreview(
    { width: image.width, height: image.height, image },
    {
      maxEdge: options.maxEdge,
      quality: options.quality,
      filename: `${basename(path, extname(path)) || "media"}-view.jpg`,
      path,
      sourceKind: "local",
    },
  );
}
