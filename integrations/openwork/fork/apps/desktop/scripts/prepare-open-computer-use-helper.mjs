import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildScript = resolve(__dirname, "../../../../../scripts/prepare-open-computer-use-helper.mjs");
const helperOutDir = resolve(__dirname, "../resources/helpers");
const result = spawnSync(process.execPath, [
  buildScript,
  "--force",
  "--outdir",
  helperOutDir,
  ...process.argv.slice(2),
], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
