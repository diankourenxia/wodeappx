#!/usr/bin/env node
/**
 * Filter local / customer brand agents out of shippable trees.
 *
 * Local keep: ~/.wodeapp/brand-agents.json (never in the repo / installer).
 * Example keep: docs/examples/brand-agents.*.example.json
 *
 * Used by release packaging. Set WODEAPPX_KEEP_LOCAL_BRAND_AGENTS=1 to skip
 * (local debug packages only).
 *
 * After packaging, re-run `pnpm openwork:patch` if you still need the local
 * Wynne runtime agent in the vendor tree for development.
 */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const vendor = path.join(root, "vendor/openwork");

export function stripWynneAgentFromOpenworkConfig(content) {
  let next = content;
  next = next.replace(
    /\nconst WYNNE_AGENT_PROMPT = `[\s\S]*?`;\n/g,
    "\n",
  );
  next = next.replace(
    /\n\s*"wynne-brand-agent": \{[\s\S]*?\n\s*\},/g,
    "\n",
  );
  // Keep the OPENWORK_AGENT_PROMPT → buildOpenworkRuntimeConfigObject anchor stable for re-patch.
  next = next.replace(
    /`;\n{2,}export async function buildOpenworkRuntimeConfigObject/g,
    "`;\n\nexport async function buildOpenworkRuntimeConfigObject",
  );
  return next;
}

async function assertNoShippedBrandDefaults() {
  const errors = [];
  const builtinPath = path.join(
    root,
    "integrations/openwork/wodeapp/wodeapp-builtin-agents.default.json",
  );
  const raw = await readFile(builtinPath, "utf8");
  const file = JSON.parse(raw);
  const agents = Array.isArray(file.agents) ? file.agents : [];
  for (const agent of agents) {
    const id = String(agent?.id || "");
    if (id.includes("wynne") || id.endsWith("-brand-agent")) {
      errors.push(`Layer0 builtin agents must not include brand agent id: ${id}`);
    }
  }

  const bannedInTree = [
    "brand-agents.json",
    path.join("integrations", "openwork", "wodeapp", "brand-agents.json"),
    path.join("docs", "brand-agents.json"),
  ];
  for (const relative of bannedInTree) {
    if (existsSync(path.join(root, relative))) {
      errors.push(
        `customer brand-agents.json must not ship: ${relative} (use docs/examples/*.example.json + ~/.wodeapp/)`,
      );
    }
  }
  return errors;
}

async function stripVendorRuntimeConfig() {
  const errors = [];
  const changed = [];
  const relative = "apps/server/src/openwork-runtime-config.ts";
  const absolute = path.join(vendor, relative);
  if (!existsSync(absolute)) {
    errors.push(`missing vendor file for brand filter: ${relative}`);
    return { errors, changed };
  }
  const raw = await readFile(absolute, "utf8");
  if (!raw.includes("wynne-brand-agent") && !raw.includes("WYNNE_AGENT_PROMPT")) {
    console.log(`[brand-filter] skip (already clean): ${relative}`);
    return { errors, changed };
  }
  const next = stripWynneAgentFromOpenworkConfig(raw);
  if (next === raw) {
    errors.push(`failed to strip wynne-brand-agent from ${relative}`);
    return { errors, changed };
  }
  if (next.includes("wynne-brand-agent") || next.includes("WYNNE_AGENT_PROMPT")) {
    errors.push(`wynne residues remain in ${relative} after strip`);
    return { errors, changed };
  }
  await writeFile(absolute, next);
  changed.push(relative);
  return { errors, changed };
}

async function main() {
  if (process.env.WODEAPPX_KEEP_LOCAL_BRAND_AGENTS === "1") {
    console.log("[brand-filter] skipped (WODEAPPX_KEEP_LOCAL_BRAND_AGENTS=1)");
    return;
  }

  const errors = await assertNoShippedBrandDefaults();
  const stripped = await stripVendorRuntimeConfig();
  errors.push(...stripped.errors);

  if (errors.length) {
    for (const error of errors) console.error(`[brand-filter] error: ${error}`);
    process.exit(1);
  }

  console.log(
    `[brand-filter] ok; stripped ${stripped.changed.length} file(s)`
      + (stripped.changed.length ? `: ${stripped.changed.join(", ")}` : ""),
  );
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
