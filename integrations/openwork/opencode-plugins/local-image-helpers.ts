type LocalCanvasModule = typeof import("@napi-rs/canvas");
type LocalCanvasImage = Awaited<ReturnType<LocalCanvasModule["loadImage"]>>;
type LocalCanvas = InstanceType<LocalCanvasModule["Canvas"]>;
type LocalCanvasContext = ReturnType<LocalCanvas["getContext"]>;

async function loadLocalCanvas(): Promise<LocalCanvasModule> {
  const bundledCanvasUrl = new URL("./node_modules/@napi-rs/canvas/index.js", import.meta.url);
  return existsSync(fileURLToPath(bundledCanvasUrl))
    ? await import(bundledCanvasUrl.href) as LocalCanvasModule
    : await import(["@napi-rs", "canvas"].join("/")) as LocalCanvasModule;
}

async function loadLocalRasterImage(pathInput: string, context?: OpenCodeContext): Promise<{
  path: string;
  image: LocalCanvasImage;
  sizeBytes: number;
  modifiedAt: string;
}> {
  const path = resolveLocalFilePath(pathInput, context);
  try {
    const fileStat = await stat(path);
    if (!fileStat.isFile()) throw new Error(`Image input is not a file: ${path}`);
    const canvas = await loadLocalCanvas();
    const image = await canvas.loadImage(path);
    if (!image.width || !image.height) throw new Error(`Image has invalid dimensions: ${path}`);
    return { path, image, sizeBytes: fileStat.size, modifiedAt: fileStat.mtime.toISOString() };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const inputTrimmed = pathInput.trim();
    const looksRelative = !inputTrimmed.startsWith("/")
      && !/^[A-Za-z]:[\\/]/.test(inputTrimmed)
      && inputTrimmed !== "~"
      && !inputTrimmed.startsWith("~/");
    const looksInventedWorkspacePath = /default-workspace/i.test(path)
      || (looksRelative && /ENOENT|no such file/i.test(message));
    if (looksInventedWorkspacePath) {
      throw new Error(
        [
          `Image path not found: ${path}`,
          "Do not invent default-workspace/workspace-relative paths from bare filenames.",
          "For chat uploads, use the absolute path from candidateImages[].path, or skip image_inspect and use selectedImageIds / candidateHttpsImages.",
        ].join(" "),
      );
    }
    throw error;
  }
}

function assertLocalImageCanvasSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error(`Invalid output size ${width}x${height}.`);
  }
  if (width > 16_384 || height > 16_384 || width * height > 100_000_000) {
    throw new Error(`Output canvas ${width}x${height} exceeds the safe local image limit.`);
  }
}

async function prepareLocalImageOutput(
  outputInput: string,
  context: OpenCodeContext | undefined,
  overwrite = false,
): Promise<{ path: string; format: "png" | "jpeg" | "webp" }> {
  const path = resolveLocalFilePath(outputInput, context);
  const extension = extname(path).toLowerCase();
  const format = extension === ".png"
    ? "png"
    : extension === ".jpg" || extension === ".jpeg"
      ? "jpeg"
      : extension === ".webp"
        ? "webp"
        : null;
  if (!format) throw new Error("outputPath must end in .png, .jpg, .jpeg, or .webp.");
  if (!overwrite && existsSync(path)) throw new Error(`Output already exists: ${path}. Set overwrite:true to replace it.`);
  await mkdir(dirname(path), { recursive: true });
  return { path, format };
}

function defaultImageBackground(format: "png" | "jpeg" | "webp", requested?: string): string {
  return requested ?? (format === "jpeg" ? "#ffffff" : "transparent");
}

function fillLocalImageBackground(
  context: LocalCanvasContext,
  width: number,
  height: number,
  color: string,
): void {
  context.save();
  context.fillStyle = color;
  context.fillRect(0, 0, width, height);
  context.restore();
}

function localImageDrawRect(
  sourceWidth: number,
  sourceHeight: number,
  targetX: number,
  targetY: number,
  targetWidth: number,
  targetHeight: number,
  fit: "contain" | "cover" | "fill",
): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } {
  if (fit === "fill") {
    return { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight, dx: targetX, dy: targetY, dw: targetWidth, dh: targetHeight };
  }
  const scale = fit === "cover"
    ? Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight)
    : Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  if (fit === "contain") {
    const dw = Math.max(1, Math.round(sourceWidth * scale));
    const dh = Math.max(1, Math.round(sourceHeight * scale));
    return {
      sx: 0,
      sy: 0,
      sw: sourceWidth,
      sh: sourceHeight,
      dx: targetX + Math.round((targetWidth - dw) / 2),
      dy: targetY + Math.round((targetHeight - dh) / 2),
      dw,
      dh,
    };
  }
  const sw = targetWidth / scale;
  const sh = targetHeight / scale;
  return {
    sx: (sourceWidth - sw) / 2,
    sy: (sourceHeight - sh) / 2,
    sw,
    sh,
    dx: targetX,
    dy: targetY,
    dw: targetWidth,
    dh: targetHeight,
  };
}

async function writeLocalImageCanvas(
  canvas: LocalCanvas,
  outputInput: string,
  context: OpenCodeContext | undefined,
  overwrite: boolean | undefined,
  quality: number | undefined,
): Promise<{ path: string; format: string; width: number; height: number; sizeBytes: number }> {
  const output = await prepareLocalImageOutput(outputInput, context, overwrite);
  const normalizedQuality = Math.max(1, Math.min(100, quality ?? 90));
  const buffer = output.format === "png"
    ? canvas.toBuffer("image/png")
    : output.format === "jpeg"
      ? canvas.toBuffer("image/jpeg", normalizedQuality)
      : canvas.toBuffer("image/webp", normalizedQuality);
  await writeFile(output.path, buffer);
  return { path: output.path, format: output.format, width: canvas.width, height: canvas.height, sizeBytes: buffer.byteLength };
}

async function inspectLocalImage(pathInput: string, context?: OpenCodeContext): Promise<Record<string, unknown>> {
  const source = await loadLocalRasterImage(pathInput, context);
  return {
    ok: true,
    executor: "local",
    stage: "inspect_image",
    data: {
      path: source.path,
      name: basename(source.path),
      width: source.image.width,
      height: source.image.height,
      aspectRatio: source.image.width / source.image.height,
      sizeBytes: source.sizeBytes,
      modifiedAt: source.modifiedAt,
    },
    warnings: [],
    nextActions: ["image_crop", "image_resize", "image_rotate_flip", "image_collage", "image_composite"],
  };
}

async function cropLocalImage(args: z.infer<typeof imageCropArgsSchema>, context?: OpenCodeContext): Promise<Record<string, unknown>> {
  const source = await loadLocalRasterImage(args.path, context);
  if (args.x + args.width > source.image.width || args.y + args.height > source.image.height) {
    throw new Error(`Crop rectangle exceeds source bounds ${source.image.width}x${source.image.height}.`);
  }
  assertLocalImageCanvasSize(args.width, args.height);
  const canvasModule = await loadLocalCanvas();
  const canvas = canvasModule.createCanvas(args.width, args.height);
  canvas.getContext("2d").drawImage(source.image, args.x, args.y, args.width, args.height, 0, 0, args.width, args.height);
  const output = await writeLocalImageCanvas(canvas, args.outputPath, context, args.overwrite, args.quality);
  return { ok: true, executor: "local", stage: "crop_image", data: { sourcePath: source.path, ...output }, warnings: [], nextActions: [] };
}

async function resizeLocalImage(args: z.infer<typeof imageResizeArgsSchema>, context?: OpenCodeContext): Promise<Record<string, unknown>> {
  const source = await loadLocalRasterImage(args.path, context);
  if (!args.width && !args.height) throw new Error("Provide width, height, or both.");
  const width = args.width ?? Math.max(1, Math.round(source.image.width * Number(args.height) / source.image.height));
  const height = args.height ?? Math.max(1, Math.round(source.image.height * Number(args.width) / source.image.width));
  assertLocalImageCanvasSize(width, height);
  const canvasModule = await loadLocalCanvas();
  const canvas = canvasModule.createCanvas(width, height);
  const outputFormat = extname(resolveLocalFilePath(args.outputPath, context)).toLowerCase();
  const drawContext = canvas.getContext("2d");
  fillLocalImageBackground(drawContext, width, height, defaultImageBackground(outputFormat === ".jpg" || outputFormat === ".jpeg" ? "jpeg" : outputFormat === ".webp" ? "webp" : "png", args.background));
  const rect = localImageDrawRect(source.image.width, source.image.height, 0, 0, width, height, args.fit ?? "contain");
  drawContext.drawImage(source.image, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh);
  const output = await writeLocalImageCanvas(canvas, args.outputPath, context, args.overwrite, args.quality);
  return { ok: true, executor: "local", stage: "resize_image", data: { sourcePath: source.path, fit: args.fit ?? "contain", ...output }, warnings: [], nextActions: [] };
}

async function rotateFlipLocalImage(args: z.infer<typeof imageRotateFlipArgsSchema>, context?: OpenCodeContext): Promise<Record<string, unknown>> {
  const source = await loadLocalRasterImage(args.path, context);
  const degrees = Number(args.degrees ?? "0");
  const swap = degrees === 90 || degrees === 270;
  const width = swap ? source.image.height : source.image.width;
  const height = swap ? source.image.width : source.image.height;
  assertLocalImageCanvasSize(width, height);
  const canvasModule = await loadLocalCanvas();
  const canvas = canvasModule.createCanvas(width, height);
  const drawContext = canvas.getContext("2d");
  drawContext.translate(width / 2, height / 2);
  drawContext.rotate(degrees * Math.PI / 180);
  drawContext.scale(args.flipHorizontal ? -1 : 1, args.flipVertical ? -1 : 1);
  drawContext.drawImage(source.image, -source.image.width / 2, -source.image.height / 2);
  const output = await writeLocalImageCanvas(canvas, args.outputPath, context, args.overwrite, args.quality);
  return { ok: true, executor: "local", stage: "rotate_flip_image", data: { sourcePath: source.path, degrees, flipHorizontal: args.flipHorizontal ?? false, flipVertical: args.flipVertical ?? false, ...output }, warnings: [], nextActions: [] };
}

async function collageLocalImages(args: z.infer<typeof imageCollageArgsSchema>, context?: OpenCodeContext): Promise<Record<string, unknown>> {
  const sources = await Promise.all(args.images.map(async (item) => ({ ...item, ...(await loadLocalRasterImage(item.path, context)) })));
  const layout = args.layout ?? "grid";
  const columns = layout === "vertical" ? 1 : layout === "horizontal" ? sources.length : Math.min(args.columns ?? Math.ceil(Math.sqrt(sources.length)), sources.length);
  const rows = Math.ceil(sources.length / columns);
  const cellWidth = args.cellWidth ?? Math.min(1600, Math.max(...sources.map((source) => source.image.width)));
  const cellHeight = args.cellHeight ?? Math.min(1600, Math.max(...sources.map((source) => source.image.height)));
  const gap = args.gap ?? 24;
  const padding = args.padding ?? 24;
  const hasLabels = sources.some((source) => Boolean(source.label));
  const labelHeight = hasLabels ? args.labelHeight ?? 56 : 0;
  const width = padding * 2 + columns * cellWidth + Math.max(0, columns - 1) * gap;
  const height = padding * 2 + rows * (cellHeight + labelHeight) + Math.max(0, rows - 1) * gap;
  assertLocalImageCanvasSize(width, height);
  const canvasModule = await loadLocalCanvas();
  const canvas = canvasModule.createCanvas(width, height);
  const drawContext = canvas.getContext("2d");
  fillLocalImageBackground(drawContext, width, height, args.background ?? "#ffffff");
  const items: Array<Record<string, unknown>> = [];
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = padding + column * (cellWidth + gap);
    const y = padding + row * (cellHeight + labelHeight + gap);
    const rect = localImageDrawRect(source.image.width, source.image.height, x, y, cellWidth, cellHeight, args.fit ?? "contain");
    drawContext.drawImage(source.image, rect.sx, rect.sy, rect.sw, rect.sh, rect.dx, rect.dy, rect.dw, rect.dh);
    if (source.label) {
      drawContext.save();
      drawContext.fillStyle = args.labelColor ?? "#111827";
      drawContext.font = `${Math.max(16, Math.min(32, Math.floor(labelHeight * 0.42)))}px sans-serif`;
      drawContext.textAlign = "center";
      drawContext.textBaseline = "middle";
      const clippedLabel = source.label.length > 80 ? `${source.label.slice(0, 77)}...` : source.label;
      drawContext.fillText(clippedLabel, x + cellWidth / 2, y + cellHeight + labelHeight / 2, cellWidth - 16);
      drawContext.restore();
    }
    items.push({ sourcePath: source.path, label: source.label, index, cell: { row, column, x, y, width: cellWidth, height: cellHeight } });
  }
  const output = await writeLocalImageCanvas(canvas, args.outputPath, context, args.overwrite, args.quality);
  return { ok: true, executor: "local", stage: "collage_images", data: { layout, columns, rows, fit: args.fit ?? "contain", items, ...output }, warnings: [], nextActions: [] };
}

async function compositeLocalImages(args: z.infer<typeof imageCompositeArgsSchema>, context?: OpenCodeContext): Promise<Record<string, unknown>> {
  const base = await loadLocalRasterImage(args.path, context);
  assertLocalImageCanvasSize(base.image.width, base.image.height);
  const canvasModule = await loadLocalCanvas();
  const canvas = canvasModule.createCanvas(base.image.width, base.image.height);
  const drawContext = canvas.getContext("2d");
  drawContext.drawImage(base.image, 0, 0);
  const overlays: Array<Record<string, unknown>> = [];
  for (const overlayArgs of args.overlays) {
    const overlay = await loadLocalRasterImage(overlayArgs.path, context);
    const width = overlayArgs.width ?? (overlayArgs.height ? Math.max(1, Math.round(overlay.image.width * overlayArgs.height / overlay.image.height)) : overlay.image.width);
    const height = overlayArgs.height ?? (overlayArgs.width ? Math.max(1, Math.round(overlay.image.height * overlayArgs.width / overlay.image.width)) : overlay.image.height);
    drawContext.save();
    drawContext.globalAlpha = overlayArgs.opacity ?? 1;
    drawContext.drawImage(overlay.image, overlayArgs.x, overlayArgs.y, width, height);
    drawContext.restore();
    overlays.push({ sourcePath: overlay.path, x: overlayArgs.x, y: overlayArgs.y, width, height, opacity: overlayArgs.opacity ?? 1 });
  }
  const output = await writeLocalImageCanvas(canvas, args.outputPath, context, args.overwrite, args.quality);
  return { ok: true, executor: "local", stage: "composite_images", data: { sourcePath: base.path, overlays, ...output }, warnings: [], nextActions: [] };
}

const LOCAL_IMAGE_TOOL_IMPLEMENTATIONS = {
  image_inspect: inspectLocalImage,
  image_crop: cropLocalImage,
  image_resize: resizeLocalImage,
  image_rotate_flip: rotateFlipLocalImage,
  image_collage: collageLocalImages,
  image_composite: compositeLocalImages,
} as const;
