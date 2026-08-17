import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

// The server package invokes this script with apps/server as its working directory.
const serverRoot = path.resolve(".");
const source = path.join(serverRoot, "src/opencode-plugins/wodeappx-browser-control-runtime.mjs");
const target = path.join(serverRoot, "dist/opencode-plugins/wodeappx-browser-control-runtime.mjs");

await mkdir(path.dirname(target), { recursive: true });
await copyFile(source, target);
console.log(`[browser-control-runtime] copied ${source} -> ${target}`);
