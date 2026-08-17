#!/usr/bin/env node
/**
 * Copy WodeApp icon assets into vendor/openwork (app favicons + Electron icons).
 */
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const vendor = path.join(root, "vendor/openwork");
const brandingDir = path.join(root, "branding");
const source128 = path.join(brandingDir, "wodeapp-icon-source.png");

const appPublic = path.join(vendor, "apps/app/public");
const desktopIcons = path.join(vendor, "apps/desktop/resources/icons");
const desktopDevIcons = path.join(desktopIcons, "dev");

function run(cmd, args) {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (${result.status ?? "unknown"})`);
  }
}

async function resizePng(src, dest, size) {
  await mkdir(path.dirname(dest), { recursive: true });
  run("sips", ["-z", String(size), String(size), src, "--out", dest]);
}

async function writeMarkSvg(dest) {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="WodeAppX">
  <image href="/wodeapp-mark.png" width="128" height="128" />
</svg>
`;
  await writeFile(dest, svg, "utf8");
}

async function prepareRoundedIconSource(src) {
  try {
    const { default: sharp } = await import("sharp");
    const size = 1024;
    const radius = 220;
    const rounded = path.join(tmpdir(), "wodeappx-rounded-icon.png");
    const mask = Buffer.from(
      `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`,
    );

    await sharp(src)
      .resize(size, size, { fit: "cover" })
      .ensureAlpha()
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toFile(rounded);
    return rounded;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[branding] Rounded icon mask unavailable; using the checked-in source icon (${detail}).`);
    return src;
  }
}

async function buildIcns(src, dest) {
  const iconset = `${dest}.iconset`;
  await rm(iconset, { recursive: true, force: true });
  await mkdir(iconset, { recursive: true });

  const sizes = [16, 32, 128, 256, 512];
  for (const size of sizes) {
    await resizePng(src, path.join(iconset, `icon_${size}x${size}.png`), size);
    if (size <= 256) {
      await resizePng(src, path.join(iconset, `icon_${size}x${size}@2x.png`), size * 2);
    }
  }

  run("iconutil", ["-c", "icns", iconset, "-o", dest]);
  await rm(iconset, { recursive: true, force: true });
}

export async function syncWodeAppBrandingAssets() {
  await mkdir(brandingDir, { recursive: true });
  if (process.platform === "darwin") {
    // noop — source files should exist in branding/
  }

  const iconSource = await prepareRoundedIconSource(source128);

  const targets = [
    [iconSource, path.join(appPublic, "wodeapp-mark.png")],
    [path.join(brandingDir, "wodeapp-icon-16.png"), path.join(appPublic, "favicon-16x16.png")],
    [path.join(brandingDir, "wodeapp-icon-32.png"), path.join(appPublic, "favicon-32x32.png")],
    [iconSource, path.join(appPublic, "apple-touch-icon.png")],
    [iconSource, path.join(desktopIcons, "icon.png")],
    [iconSource, path.join(desktopDevIcons, "icon.png")],
  ];

  await mkdir(appPublic, { recursive: true });
  await mkdir(desktopDevIcons, { recursive: true });

  for (const [from, to] of targets) {
    await cp(from, to);
  }

  await writeMarkSvg(path.join(appPublic, "wodeapp-mark.svg"));

  if (process.platform === "darwin") {
    await resizePng(iconSource, path.join(desktopIcons, "icon.png"), 512);
    await resizePng(iconSource, path.join(desktopDevIcons, "icon.png"), 512);
    await buildIcns(iconSource, path.join(desktopIcons, "icon.icns"));
    await buildIcns(iconSource, path.join(desktopDevIcons, "icon-dev.icns"));
  } else {
    console.warn("[branding] Non-macOS: skipped .icns generation; PNG icons updated only.");
  }

  console.log("[branding] WodeApp icons synced into vendor/openwork");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  syncWodeAppBrandingAssets().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
