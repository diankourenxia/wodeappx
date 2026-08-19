#!/usr/bin/env node
/**
 * Materialize packaged slot B from official app-dist + overlay manifest.
 *
 *   node scripts/self-evolve-apply-slot.mjs --user-data <dir> --resources <dir> [--slot B]
 *   ELECTRON_RUN_AS_NODE=1 ./WodeAppX scripts/self-evolve-apply-slot.mjs ...
 */
import { existsSync } from "node:fs";
import path from "node:path";

import {
  applySelfEvolveSlot,
  readSelfEvolveLaunchInfo,
} from "./self-evolve-packaged.mjs";

function argValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? String(args[index + 1] || "").trim() : "";
}

const args = process.argv.slice(2);
const userData = path.resolve(argValue(args, "--user-data") || process.env.OPENWORK_ELECTRON_USERDATA || "");
const launch = userData ? readSelfEvolveLaunchInfo(userData) : null;
const resources = path.resolve(
  argValue(args, "--resources")
    || process.env.WODEAPPX_RESOURCES
    || launch?.resourcesPath
    || "",
);
const slot = argValue(args, "--slot") || "B";

if (!userData || !existsSync(userData)) {
  console.error("self-evolve-apply-slot: --user-data is required");
  process.exit(2);
}
if (!resources || !existsSync(path.join(resources, "app-dist", "index.html"))) {
  console.error("self-evolve-apply-slot: packaged resources/app-dist not found");
  process.exit(2);
}

const result = applySelfEvolveSlot({ resourcesPath: resources, userDataPath: userData, slot });
console.log(JSON.stringify({ ok: true, ...result }, null, 2));
