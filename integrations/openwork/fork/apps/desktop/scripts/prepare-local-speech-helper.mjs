import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildScript = resolve(__dirname, "../../../../../scripts/build-local-speech-helper.mjs");
const result = spawnSync(process.execPath, [buildScript], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
