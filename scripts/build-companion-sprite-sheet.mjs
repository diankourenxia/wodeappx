#!/usr/bin/env node
/**
 * Build a companion 1x4 sprite sheet from generated pose image(s).
 *
 * - Each input image is sliced into a `--rows` x `--columns` grid of equal
 *   cells, read row by row (default 1x4 strip; use 2x4 for an 8-pose grid,
 *   or 1x2 for side-by-side pose pairs).
 * - Background is flood-fill keyed from the borders to transparent, so
 *   near-white fur inside the character keeps its alpha.
 * - Every cell is trimmed to its content and re-centered on a square canvas
 *   so the idle/blink/wave/tilt frames stay aligned during CSS steps animation.
 * - All cells (must total 4) are stitched into a <frame*4>x<frame> sheet.
 *
 * Usage:
 *   node scripts/build-companion-sprite-sheet.mjs <output.png> <inputA.png> [inputB.png ...] \
 *     [--columns 4] [--rows 1] [--frames 4] [--frame 512] [--tol 26]
 *
 * Examples:
 *   # one 1x4 strip
 *   build-companion-sprite-sheet.mjs out.png strip.png --columns 4 --frames 4
 *   # one 2x4 pose grid (8 frames)
 *   build-companion-sprite-sheet.mjs out.png grid.png --columns 4 --rows 2 --frames 8
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const args = process.argv.slice(2);
  const flagNames = ["--columns", "--rows", "--frames", "--frame", "--tol"];
  const positional = args.filter((arg, index) => !flagNames.includes(arg)
    && (index === 0 || !flagNames.includes(args[index - 1])));
  const [output, ...inputs] = positional;
  if (!output || inputs.length === 0) {
    console.error("usage: build-companion-sprite-sheet.mjs <output.png> <input...> [--columns 4] [--rows 1] [--frames 4] [--frame 512] [--tol 26]");
    process.exit(2);
  }
  const flagValue = (name, fallback) => {
    const index = args.indexOf(name);
    return index >= 0 ? Number(args[index + 1]) : fallback;
  };
  const columns = flagValue("--columns", 4);
  const rows = flagValue("--rows", 1);
  const expectedFrames = flagValue("--frames", 4);
  const frame = flagValue("--frame", 512);
  const tolerance = flagValue("--tol", 26);

  const { default: sharp } = await import("sharp");

  const cells = [];
  for (const input of inputs) {
    const image = sharp(input);
    const meta = await image.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) throw new Error(`cannot read dimensions: ${input}`);

    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const channels = info.channels; // 4 after ensureAlpha

    // Dominant background color: average of the four corners.
    const cornerOffsets = [
      0,
      (width - 1) * channels,
      (height - 1) * width * channels,
      ((height - 1) * width + (width - 1)) * channels,
    ];
    let bg = [0, 0, 0];
    for (const offset of cornerOffsets) {
      bg[0] += data[offset];
      bg[1] += data[offset + 1];
      bg[2] += data[offset + 2];
    }
    bg = bg.map((v) => Math.round(v / 4));

    const isBackground = (offset) => {
      const dr = data[offset] - bg[0];
      const dg = data[offset + 1] - bg[1];
      const db = data[offset + 2] - bg[2];
      return Math.sqrt(dr * dr + dg * dg + db * db) <= tolerance;
    };

    // Flood-fill from the borders so only the CONNECTED background is keyed out.
    const pixelCount = width * height;
    const backgroundMask = new Uint8Array(pixelCount);
    const queue = [];
    const pushIfBackground = (x, y) => {
      const index = y * width + x;
      if (backgroundMask[index]) return;
      if (!isBackground(index * channels)) return;
      backgroundMask[index] = 1;
      queue.push(index);
    };
    for (let x = 0; x < width; x += 1) {
      pushIfBackground(x, 0);
      pushIfBackground(x, height - 1);
    }
    for (let y = 0; y < height; y += 1) {
      pushIfBackground(0, y);
      pushIfBackground(width - 1, y);
    }
    while (queue.length > 0) {
      const index = queue.pop();
      const x = index % width;
      const y = (index - x) / width;
      if (x > 0) pushIfBackground(x - 1, y);
      if (x < width - 1) pushIfBackground(x + 1, y);
      if (y > 0) pushIfBackground(x, y - 1);
      if (y < height - 1) pushIfBackground(x, y + 1);
    }
    for (let index = 0; index < pixelCount; index += 1) {
      if (backgroundMask[index]) data[index * channels + 3] = 0;
    }

    const keyedBuffer = await sharp(data, { raw: { width, height, channels } }).png().toBuffer();
    const cellWidth = Math.floor(width / columns);
    const cellHeight = Math.floor(height / rows);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const left = column * cellWidth;
        const top = row * cellHeight;
        const cellBuffer = await sharp(keyedBuffer)
          .extract({
            left,
            top,
            width: column === columns - 1 ? width - left : cellWidth,
            height: row === rows - 1 ? height - top : cellHeight,
          })
          .png()
          .toBuffer();
        cells.push({ source: input, cellBuffer, cellWidth, cellHeight });
      }
    }
    console.log(`${path.basename(input)}: ${width}x${height}, bg rgb(${bg.join(",")}), ${rows}x${columns} cell(s)`);
  }

  if (cells.length !== expectedFrames) {
    throw new Error(`expected ${expectedFrames} pose cells total, got ${cells.length} (adjust --rows/--columns/--frames or inputs)`);
  }

  const frames = [];
  for (const [index, cell] of cells.entries()) {
    const trimmed = await sharp(cell.cellBuffer).trim({ threshold: 8 }).png().toBuffer().catch(() => cell.cellBuffer);
    const trimmedMeta = await sharp(trimmed).metadata();
    const tw = trimmedMeta.width ?? 0;
    const th = trimmedMeta.height ?? 0;
    const scale = Math.min((frame * 0.86) / tw, (frame * 0.86) / th);
    const rw = Math.max(1, Math.round(tw * scale));
    const rh = Math.max(1, Math.round(th * scale));
    const resized = await sharp(trimmed).resize(rw, rh, { fit: "fill" }).png().toBuffer();
    const frameCanvas = await sharp({
      create: { width: frame, height: frame, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: resized, left: Math.round((frame - rw) / 2), top: Math.round(frame - rh - frame * 0.04) }])
      .png()
      .toBuffer();
    frames.push(frameCanvas);
    console.log(`pose${index + 1} (${path.basename(cell.source)}): content ${tw}x${th} -> ${rw}x${rh}`);
  }

  const sheet = await sharp({
    create: { width: frame * expectedFrames, height: frame, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(frames.map((inputFrame, index) => ({ input: inputFrame, left: index * frame, top: 0 })))
    .png({ compressionLevel: 9 })
    .toFile(output);
  console.log(`sheet ${sheet.width}x${sheet.height} -> ${path.relative(__dirname, output)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
