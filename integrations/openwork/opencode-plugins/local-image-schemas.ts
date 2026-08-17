const localImagePathSchema = z.string().min(1).describe("Absolute path, ~/ path, or workspace-relative path to a local raster image.");
const localImageOutputPathSchema = z.string().min(1).describe("Destination path for a PNG, JPEG, or WebP image. Relative paths resolve from the workspace.");
const localImageDimensionSchema = z.number().int().min(1).max(16_384);
const localImageQualitySchema = z.number().int().min(1).max(100).optional().describe("JPEG/WebP quality from 1 to 100. Defaults to 90.");
const localImageWriteSchema = {
  outputPath: localImageOutputPathSchema,
  overwrite: z.boolean().optional().describe("Allow replacing an existing output file. Defaults to false."),
  quality: localImageQualitySchema,
};

const imageInspectArgsSchema = z.object({
  path: localImagePathSchema,
});

const mediaViewSourceSchema = z.string().min(1).describe(
  "Local raster path, https:// image URL, or image-proxy path (e.g. /runtime-server/api/image-proxy/<id> or https://wodeapp.cn/runtime-server/api/image-proxy/<id>). Prefer this for generated-image QA.",
);

const openworkMediaViewArgsSchema = z.object({
  path: mediaViewSourceSchema,
  maxEdge: z.number().int().min(256).max(1536).optional()
    .describe("Longest edge in pixels for the current-turn preview. Defaults to 1280 (capped 1536 to stay under durable part size)."),
  quality: z.number().int().min(40).max(90).optional()
    .describe("JPEG quality for the current-turn preview. Defaults to 70."),
});

const imageCropArgsSchema = z.object({
  path: localImagePathSchema,
  x: z.number().int().min(0).describe("Left crop coordinate in source pixels."),
  y: z.number().int().min(0).describe("Top crop coordinate in source pixels."),
  width: localImageDimensionSchema.describe("Crop width in pixels."),
  height: localImageDimensionSchema.describe("Crop height in pixels."),
  ...localImageWriteSchema,
});

const imageResizeArgsSchema = z.object({
  path: localImagePathSchema,
  width: localImageDimensionSchema.optional().describe("Output width. When height is omitted, preserves aspect ratio."),
  height: localImageDimensionSchema.optional().describe("Output height. When width is omitted, preserves aspect ratio."),
  fit: z.enum(["contain", "cover", "fill"]).optional().describe("contain preserves all pixels, cover fills and center-crops, fill stretches. Defaults to contain."),
  background: z.string().optional().describe("Canvas background color used by contain, such as #ffffff or transparent. Defaults to transparent for PNG/WebP and white for JPEG."),
  ...localImageWriteSchema,
});

const imageRotateFlipArgsSchema = z.object({
  path: localImagePathSchema,
  degrees: z.enum(["0", "90", "180", "270"]).optional().describe("Clockwise rotation. Defaults to 0."),
  flipHorizontal: z.boolean().optional().describe("Mirror left to right."),
  flipVertical: z.boolean().optional().describe("Mirror top to bottom."),
  ...localImageWriteSchema,
});

const imageCollageInputSchema = z.object({
  path: localImagePathSchema,
  label: z.string().max(120).optional().describe("Optional caption rendered below this image."),
});

const imageCollageArgsSchema = z.object({
  images: z.array(imageCollageInputSchema).min(2).max(36).describe("Images in the exact order they should appear."),
  layout: z.enum(["grid", "horizontal", "vertical"]).optional().describe("Layout mode. Defaults to grid."),
  columns: z.number().int().min(1).max(12).optional().describe("Grid column count. Defaults to a balanced square-like grid."),
  cellWidth: localImageDimensionSchema.optional().describe("Width of each image cell. Defaults to the widest input, capped at 1600."),
  cellHeight: localImageDimensionSchema.optional().describe("Height of each image cell. Defaults to the tallest input, capped at 1600."),
  fit: z.enum(["contain", "cover"]).optional().describe("contain preserves every source pixel; cover center-crops. Defaults to contain."),
  gap: z.number().int().min(0).max(512).optional().describe("Gap between cells in pixels. Defaults to 24."),
  padding: z.number().int().min(0).max(1024).optional().describe("Outer padding in pixels. Defaults to 24."),
  background: z.string().optional().describe("Canvas and cell background color. Defaults to #ffffff."),
  labelColor: z.string().optional().describe("Caption text color. Defaults to #111827."),
  labelHeight: z.number().int().min(24).max(240).optional().describe("Caption area height when any label is present. Defaults to 56."),
  ...localImageWriteSchema,
});

const imageCompositeOverlaySchema = z.object({
  path: localImagePathSchema,
  x: z.number().int().describe("Overlay left coordinate in base-image pixels."),
  y: z.number().int().describe("Overlay top coordinate in base-image pixels."),
  width: localImageDimensionSchema.optional().describe("Optional rendered width. Preserves aspect ratio when height is omitted."),
  height: localImageDimensionSchema.optional().describe("Optional rendered height. Preserves aspect ratio when width is omitted."),
  opacity: z.number().min(0).max(1).optional().describe("Overlay opacity from 0 to 1. Defaults to 1."),
});

const imageCompositeArgsSchema = z.object({
  path: localImagePathSchema.describe("Base image path."),
  overlays: z.array(imageCompositeOverlaySchema).min(1).max(36).describe("Overlays rendered in array order; later items appear on top."),
  ...localImageWriteSchema,
});
