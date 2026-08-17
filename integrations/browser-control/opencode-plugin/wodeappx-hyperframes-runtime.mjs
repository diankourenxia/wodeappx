import { spawn } from "node:child_process";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, resolve } from "node:path";

const DEFAULT_WIDTH = 1080;
const DEFAULT_HEIGHT = 1920;
const DEFAULT_FPS = 30;
const DEFAULT_QUALITY = "standard";
const DEFAULT_SECONDS_PER_PRODUCT = 5;
const DEFAULT_TRANSITION_DURATION = 0.35;

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeSlug(value, fallback) {
  const slug = String(value || "")
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fff_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallback;
}

function safeFileName(value, fallback = "product-video.mp4") {
  const raw = basename(String(value || fallback).trim()) || fallback;
  const safe = raw.replace(/[^a-z0-9\u4e00-\u9fff._-]+/gi, "-");
  return /\.[a-z0-9]{2,5}$/i.test(safe) ? safe : `${safe}.mp4`;
}

function validateRemoteUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid http(s) URL or local path.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} only accepts http(s) URLs.`);
  }
  return parsed.toString();
}

async function materializeImage(input, projectDir, workspaceRoot, index) {
  if (typeof input === "string") {
    return materializeImage({ url: input }, projectDir, workspaceRoot, index);
  }
  if (!isRecord(input)) throw new Error(`product ${index + 1} image must be a URL or local path.`);

  const url = typeof input.url === "string" ? input.url.trim() : "";
  const localPath = typeof input.path === "string" ? input.path.trim() : "";
  if (Boolean(url) === Boolean(localPath)) {
    throw new Error(`product ${index + 1} image must provide exactly one of url or path.`);
  }
  if (url) return validateRemoteUrl(url, `product ${index + 1} image`);

  const sourcePath = isAbsolute(localPath) ? localPath : resolve(workspaceRoot, localPath);
  const sourceStat = await stat(sourcePath).catch(() => null);
  if (!sourceStat?.isFile()) throw new Error(`product ${index + 1} image was not found: ${sourcePath}`);

  const assetsDir = join(projectDir, "assets");
  await mkdir(assetsDir, { recursive: true });
  const extension = extname(sourcePath).toLowerCase() || ".png";
  const targetName = `product-${String(index + 1).padStart(3, "0")}${extension}`;
  await copyFile(sourcePath, join(assetsDir, targetName));
  return `assets/${targetName}`;
}

function normalizeProduct(raw, index) {
  const product = isRecord(raw) ? raw : {};
  const images = Array.isArray(product.images)
    ? product.images
    : Array.isArray(product.productImages)
      ? product.productImages
      : [];
  const sellingPoints = Array.isArray(product.sellingPoints)
    ? product.sellingPoints
    : Array.isArray(product.points)
      ? product.points
      : [];
  return {
    id: typeof product.id === "string" ? product.id : `product-${index + 1}`,
    name: String(product.name || product.title || `商品 ${index + 1}`).trim(),
    brand: String(product.brand || "").trim(),
    category: String(product.category || product.productType || "").trim(),
    description: String(product.description || product.info || "").trim(),
    price: product.price === undefined || product.price === null ? "" : String(product.price).trim(),
    duration: product.duration,
    sellingPoints: sellingPoints.map((point) => String(point).trim()).filter(Boolean).slice(0, 4),
    images,
  };
}

function productDuration(product, fallback) {
  const duration = Number(product.duration);
  return Number.isFinite(duration) && duration > 0 ? duration : fallback;
}

function buildProductCompositionHtml(products, options) {
  const { width, height, transitionDuration, audioSource, audio, totalDuration } = options;
  const sceneMarkup = products.map((product, index) => {
    const image = product.imageSource
      ? `<img id="product-image-${index}" class="clip product-image" data-start="${product.start}" data-duration="${product.duration}" data-track-index="${index}" src="${escapeHtml(product.imageSource)}" crossorigin="anonymous" alt="${escapeHtml(product.name)}">`
      : `<div id="product-image-${index}" class="clip product-image-placeholder" data-start="${product.start}" data-duration="${product.duration}" data-track-index="${index}">无商品图片</div>`;
    const points = product.sellingPoints.length
      ? `<ul>${product.sellingPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>`
      : "";
    const price = product.price ? `<div class="price">${escapeHtml(product.price)}</div>` : "";
    const meta = [product.brand, product.category].filter(Boolean).join(" · ");
    return `<section class="product-scene" id="scene-${index}" style="z-index:${index + 1}"><div class="scene-media">${image}</div><div class="scene-copy">${meta ? `<div class="meta">${escapeHtml(meta)}</div>` : ""}<h1>${escapeHtml(product.name)}</h1>${price}${product.description ? `<p>${escapeHtml(product.description)}</p>` : ""}${points}</div></section>`;
  }).join("\n");
  const audioMarkup = audioSource
    ? `<audio id="background-audio" class="clip" data-start="0" data-duration="${totalDuration}" data-track-index="${products.length + 2}" data-media-start="${Number(audio?.mediaStart) || 0}" data-volume="${typeof audio?.volume === "number" ? audio.volume : 1}" src="${escapeHtml(audioSource)}"></audio>`
    : "";
  const timeline = products.map((product, index) => {
    const enter = index === 0
      ? `tl.fromTo("#scene-${index}", { opacity: 0.01 }, { opacity: 1, duration: 0.25, ease: "power2.out" }, ${product.start});`
      : `tl.fromTo("#scene-${index}", { opacity: 0 }, { opacity: 1, duration: ${transitionDuration}, ease: "power1.inOut" }, ${product.start});\n      tl.to("#scene-${index - 1}", { opacity: 0, duration: ${transitionDuration}, ease: "power1.inOut" }, ${product.start});`;
    return `${enter}\n      tl.fromTo("#scene-${index} h1", { y: 28, opacity: 0 }, { y: 0, opacity: 1, duration: 0.42, ease: "power3.out" }, ${product.start + 0.16});\n      tl.fromTo("#scene-${index} .scene-media", { scale: 1.08 }, { scale: 1, duration: ${product.duration}, ease: "none" }, ${product.start});\n      tl.fromTo("#scene-${index} .scene-copy", { y: 18 }, { y: 0, duration: 0.5, ease: "power2.out" }, ${product.start + 0.18});`;
  }).join("\n");
  return [
    "<!doctype html>",
    "<html lang=\"zh-CN\">",
    "  <head>",
    "    <meta charset=\"utf-8\">",
    "    <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "    <title>WodeAppX HyperFrames Product Video</title>",
    "    <style>",
    "      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #111827; }",
    "      .composition-root { position: relative; width: 100%; height: 100%; overflow: hidden; background: linear-gradient(145deg, #111827, #334155); }",
    "      .product-scene { position: absolute; inset: 0; display: grid; grid-template-rows: minmax(0, 1fr) auto; padding: 8%; box-sizing: border-box; opacity: 0; overflow: hidden; color: #fff; }",
    "      .scene-media { min-height: 0; display: flex; align-items: center; justify-content: center; transform-origin: center; }",
    "      .scene-media img { display: block; width: 100%; height: 100%; max-height: 68vh; object-fit: contain; border-radius: 28px; background: rgba(255,255,255,.94); box-shadow: 0 24px 70px rgba(0,0,0,.28); }",
    "      .product-image-placeholder { width: 100%; height: 48vh; display: flex; align-items: center; justify-content: center; border: 1px solid rgba(255,255,255,.28); border-radius: 28px; color: rgba(255,255,255,.7); background: rgba(255,255,255,.08); font: 600 32px/1.2 Inter,sans-serif; }",
    "      .scene-copy { padding-top: 6%; transform: translateY(0); font-family: Inter,sans-serif; }",
    "      .meta { color: rgba(255,255,255,.72); font-size: 25px; letter-spacing: .05em; }",
    "      h1 { margin: 10px 0 8px; max-width: 92%; font-size: clamp(44px, 7vw, 82px); line-height: 1.08; letter-spacing: -.025em; }",
    "      .price { margin: 4px 0 14px; color: #fde68a; font-size: 42px; font-weight: 800; }",
    "      p { max-width: 94%; margin: 0 0 16px; color: rgba(255,255,255,.82); font-size: 28px; line-height: 1.35; overflow-wrap: break-word; }",
    "      ul { display: flex; flex-wrap: wrap; gap: 10px; max-width: 96%; margin: 0; padding: 0; list-style: none; }",
    "      li { max-width: 100%; padding: 9px 16px; border: 1px solid rgba(255,255,255,.26); border-radius: 999px; background: rgba(15,23,42,.44); color: rgba(255,255,255,.92); font-size: 24px; line-height: 1.25; }",
    "    </style>",
    "    <script src=\"https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js\"></script>",
    "  </head>",
    "  <body>",
    `    <div id="composition-root" class="composition-root" data-composition-id="root" data-start="0" data-width="${width}" data-height="${height}">`,
    `      ${sceneMarkup}`,
    `      ${audioMarkup}`,
    "    </div>",
    "    <script>",
    "      window.__timelines = window.__timelines || {};",
    "      const tl = gsap.timeline({ paused: true });",
    `      ${timeline}`,
    "      window.__timelines[\"root\"] = tl;",
    "    </script>",
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

function runHyperframesRender(projectDir, outputName, quality, fps) {
  const configuredCli = process.env.WODEAPPX_HYPERFRAMES_CLI?.trim();
  const command = configuredCli || (process.platform === "win32" ? "npx.cmd" : "npx");
  const args = configuredCli
    ? ["render", "--output", outputName, "--quality", quality, "--fps", String(fps), "--workers", "1"]
    : ["--yes", "hyperframes", "render", "--output", outputName, "--quality", quality, "--fps", String(fps), "--workers", "1"];

  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: projectDir,
      env: { ...process.env, CI: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`HyperFrames render timed out after 30 minutes.\n${stderr.slice(-4000)}`));
    }, 30 * 60 * 1000);
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-20_000); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-20_000); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(new Error(`Unable to start HyperFrames (${command}): ${error.message}`));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`HyperFrames render failed with exit code ${code}.\n${stderr.slice(-8000) || stdout.slice(-8000)}`));
        return;
      }
      resolvePromise({ stdout, stderr });
    });
  });
}

async function renderProducts(products, options, projectDir, outputName, workspaceRoot) {
  await mkdir(projectDir, { recursive: true });
  const normalizedProducts = [];
  let cursor = 0;
  const transitionDuration = products.length > 1 ? options.transitionDuration : 0;
  for (let index = 0; index < products.length; index += 1) {
    const product = normalizeProduct(products[index], index);
    const duration = productDuration(product, options.secondsPerProduct);
    const imageSource = product.images.length
      ? await materializeImage(product.images[0], projectDir, workspaceRoot, index)
      : undefined;
    normalizedProducts.push({ ...product, imageSource, start: cursor, duration });
    cursor += duration;
    if (index < products.length - 1) cursor -= transitionDuration;
  }

  const totalDuration = Math.max(0.25, cursor);
  let audioSource;
  if (options.audio) audioSource = await materializeImage(options.audio, projectDir, workspaceRoot, 0);
  const html = buildProductCompositionHtml(normalizedProducts, {
    ...options,
    totalDuration,
    audioSource,
    transitionDuration,
  });
  await writeFile(join(projectDir, "index.html"), html, "utf8");
  await writeFile(join(projectDir, "composition-manifest.json"), JSON.stringify({
    engine: "hyperframes",
    route: "data-driven-product-video",
    products: normalizedProducts,
    totalDuration,
    width: options.width,
    height: options.height,
    fps: options.fps,
    quality: options.quality,
    transitionDuration,
  }, null, 2), "utf8");

  const baseResult = {
    ok: true,
    rendered: options.render,
    projectDir,
    compositionPath: join(projectDir, "index.html"),
    manifestPath: join(projectDir, "composition-manifest.json"),
    clipCount: normalizedProducts.length,
    totalDuration,
  };
  if (!options.render) return baseResult;

  await runHyperframesRender(projectDir, outputName, options.quality, options.fps);
  const outputPath = join(projectDir, outputName);
  const outputStat = await stat(outputPath).catch(() => null);
  if (!outputStat?.isFile() || outputStat.size === 0) {
    throw new Error(`HyperFrames reported success but output was not created: ${outputPath}`);
  }
  return { ...baseResult, outputPath };
}

export async function executeHyperframesProductVideo(rawArgs, context = {}) {
  if (!isRecord(rawArgs) || !Array.isArray(rawArgs.products) || rawArgs.products.length === 0) {
    return { ok: false, engine: "hyperframes", error: "products must contain at least one product record." };
  }

  const workspaceRoot = resolve(context.directory || context.worktree || process.cwd());
  const outputRoot = resolve(workspaceRoot, rawArgs.outputDir || ".wodeapp/media-output");
  const products = rawArgs.products.slice(0, 100);
  const firstName = normalizeProduct(products[0], 0).name;
  const batchDir = join(outputRoot, `${safeSlug(firstName, "product-video")}-${Date.now()}`);
  await mkdir(batchDir, { recursive: true });

  const options = {
    width: Number.isInteger(rawArgs.width) ? rawArgs.width : DEFAULT_WIDTH,
    height: Number.isInteger(rawArgs.height) ? rawArgs.height : DEFAULT_HEIGHT,
    fps: Number.isInteger(rawArgs.fps) ? rawArgs.fps : DEFAULT_FPS,
    quality: ["draft", "standard", "high"].includes(rawArgs.quality) ? rawArgs.quality : DEFAULT_QUALITY,
    secondsPerProduct: Number.isFinite(rawArgs.secondsPerProduct) && rawArgs.secondsPerProduct > 0
      ? rawArgs.secondsPerProduct
      : DEFAULT_SECONDS_PER_PRODUCT,
    transitionDuration: Number.isFinite(rawArgs.transitionDuration)
      ? Math.min(Math.max(rawArgs.transitionDuration, 0), 2)
      : DEFAULT_TRANSITION_DURATION,
    render: rawArgs.render !== false,
    audio: rawArgs.audio,
  };

  if (rawArgs.outputMode === "single") {
    const outputName = safeFileName(rawArgs.outputName, "product-catalog.mp4");
    const result = await renderProducts(products, options, batchDir, outputName, workspaceRoot);
    return {
      ...result,
      route: "data-driven-product-video",
      outputMode: "single",
      batchDir,
      userVisibleSummary: options.render
        ? `数据驱动商品目录视频已生成：${result.outputPath}`
        : `HyperFrames 商品目录项目已准备好：${result.compositionPath}`,
    };
  }

  const results = [];
  for (let index = 0; index < products.length; index += 1) {
    const product = normalizeProduct(products[index], index);
    const productDir = join(batchDir, `${String(index + 1).padStart(3, "0")}-${safeSlug(product.name, `product-${index + 1}`)}`);
    const outputName = safeFileName(rawArgs.outputName
      ? String(rawArgs.outputName).replace(/\{name\}/g, safeSlug(product.name, `product-${index + 1}`))
      : `${safeSlug(product.name, `product-${index + 1}`)}.mp4`);
    results.push(await renderProducts([product], options, productDir, outputName, workspaceRoot));
  }
  return {
    ok: true,
    engine: "hyperframes",
    route: "data-driven-product-video",
    outputMode: "per-product",
    batchDir,
    count: results.length,
    rendered: options.render,
    results,
    userVisibleSummary: options.render
      ? `已按商品批量生成 ${results.length} 条数据驱动视频。`
      : `已准备 ${results.length} 个 HyperFrames 商品视频项目。`,
  };
}
