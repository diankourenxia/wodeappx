import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(path.join(process.cwd(), "package.json"));
const canvasEntry = require.resolve("@napi-rs/canvas");
const canvasPackageDir = path.dirname(canvasEntry);
const napiScopeDir = path.dirname(canvasPackageDir);
const pluginDir = path.resolve(process.cwd(), "dist/opencode-plugins");
const outputDir = path.join(pluginDir, "node_modules/@napi-rs/canvas");

await rm(path.join(pluginDir, "canvas-runtime"), { recursive: true, force: true });
await rm(path.join(pluginDir, "canvas-runtime.js"), { force: true });
await mkdir(outputDir, { recursive: true });
await cp(canvasPackageDir, outputDir, { recursive: true, force: true, dereference: true });

for (const entry of await readdir(napiScopeDir, { withFileTypes: true })) {
  if (!entry.name.startsWith("canvas-") || entry.name === "canvas") continue;
  const nativePackageDir = path.join(napiScopeDir, entry.name);
  for (const nativeFile of await readdir(nativePackageDir)) {
    if (!nativeFile.endsWith(".node")) continue;
    await cp(path.join(nativePackageDir, nativeFile), path.join(outputDir, nativeFile), { force: true, dereference: true });
  }
}

console.log(`[pdf-canvas-runtime] copied ${canvasPackageDir} -> ${outputDir}`);
