    image_inspect: {
      description: "Inspect a local raster image before editing. Returns exact pixel dimensions, aspect ratio, file size, and path without changing the file. For pixels use openwork_media_view (local path, https://, or image-proxy) or chat attachments. Never call OpenCode read on PNG/JPEG paths.",
      args: imageInspectArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const args = imageInspectArgsSchema.parse(rawArgs);
        return asJsonText(await LOCAL_IMAGE_TOOL_IMPLEMENTATIONS.image_inspect(args.path, context));
      },
    },
    openwork_media_view: {
      description: "Attach a bounded JPEG preview for the current turn so the model can see pixels. Accepts a local raster path, https:// image URL, or image-proxy path (/runtime-server/api/image-proxy/<id>). Caps longest edge (default 1280, max 1536) and preview bytes (~512KB). Use this to visually QA generated image-proxy links. Prefer this over OpenCode read on PNG/JPEG. Do not set maxEdge above 1536.",
      args: openworkMediaViewArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const args = openworkMediaViewArgsSchema.parse(rawArgs);
        const { createBoundedImagePreview, isRemoteImageSource } = await import("./bounded-image-preview.js");
        const source = args.path.trim();
        const path = isRemoteImageSource(source) ? source : resolveLocalFilePath(source, context);
        const preview = await createBoundedImagePreview(path, {
          maxEdge: args.maxEdge,
          quality: args.quality,
        });
        const payload = {
          ok: true,
          executor: "local",
          stage: "media_view",
          data: {
            path: preview.path,
            name: basename(preview.path.split("?")[0] || preview.path),
            sourceKind: preview.sourceKind,
            sourceWidth: preview.sourceWidth,
            sourceHeight: preview.sourceHeight,
            previewWidth: preview.previewWidth,
            previewHeight: preview.previewHeight,
            previewBytes: preview.previewBytes,
            maxEdge: args.maxEdge ?? 1280,
            quality: args.quality ?? 70,
            ephemeral: true,
          },
          warnings: [
            "Preview pixels are for the current turn only. After idle, history keeps a path/URL stub.",
            "Do not call OpenCode read on screenshot/PNG/JPEG paths.",
            ...(preview.sourceKind === "remote"
              ? ["Remote URL was fetched and downscaled for this turn only; image_crop/image_resize still need a local file."]
              : []),
          ],
          nextActions: preview.sourceKind === "remote"
            ? []
            : ["image_inspect", "image_crop", "image_resize"],
        };
        return {
          title: "media view",
          output: asJsonText(payload),
          attachments: [preview.attachment],
        };
      },
    },
    image_crop: {
      description: "Crop an exact pixel rectangle from one local image without AI generation or visual reinterpretation. Writes a new PNG, JPEG, or WebP file.",
      args: imageCropArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const args = imageCropArgsSchema.parse(rawArgs);
        return asJsonText(await LOCAL_IMAGE_TOOL_IMPLEMENTATIONS.image_crop(args, context));
      },
    },
    image_resize: {
      description: "Resize one local image deterministically with contain, cover, or fill fitting. Writes a new PNG, JPEG, or WebP file.",
      args: imageResizeArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const args = imageResizeArgsSchema.parse(rawArgs);
        return asJsonText(await LOCAL_IMAGE_TOOL_IMPLEMENTATIONS.image_resize(args, context));
      },
    },
    image_rotate_flip: {
      description: "Rotate a local image by 0, 90, 180, or 270 degrees and optionally mirror it, without AI generation. Writes a new image file.",
      args: imageRotateFlipArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const args = imageRotateFlipArgsSchema.parse(rawArgs);
        return asJsonText(await LOCAL_IMAGE_TOOL_IMPLEMENTATIONS.image_rotate_flip(args, context));
      },
    },
    image_collage: {
      description: "Combine 2-36 local images into one deterministic grid, horizontal strip, or vertical strip. Use contain to preserve every source pixel and optional labels to identify angles. Never substitutes AI-generated views.",
      args: imageCollageArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const args = imageCollageArgsSchema.parse(rawArgs);
        return asJsonText(await LOCAL_IMAGE_TOOL_IMPLEMENTATIONS.image_collage(args, context));
      },
    },
    image_composite: {
      description: "Place one or more local images over a base image at exact coordinates, sizes, and opacity in deterministic array order. Writes a new image without AI generation.",
      args: imageCompositeArgsSchema.shape,
      async execute(rawArgs: unknown, context: OpenCodeContext) {
        const args = imageCompositeArgsSchema.parse(rawArgs);
        return asJsonText(await LOCAL_IMAGE_TOOL_IMPLEMENTATIONS.image_composite(args, context));
      },
    },
