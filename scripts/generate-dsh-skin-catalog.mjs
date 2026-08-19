#!/usr/bin/env node
/**
 * Pack-time snapshot of WODEAPP_SKINS (listVisibleWodeAppSkins + hidden).
 * Do not hand-edit wodeappx-dsh/lib/skin-catalog.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "integrations/openwork/wodeapp/wodeapp-skins.ts");

export function parseWodeAppSkinsCatalog(source) {
  const start = source.indexOf("export const WODEAPP_SKINS");
  if (start < 0) throw new Error("WODEAPP_SKINS missing");
  const brace = source.indexOf("= [", start);
  if (brace < 0) throw new Error("WODEAPP_SKINS assignment missing");
  const open = source.indexOf("[", brace + 1);
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "[") depth += 1;
    else if (source[i] === "]") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error("WODEAPP_SKINS array unclosed");
  const block = source.slice(open, end + 1);
  const items = [];
  const lines = block.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const id = lines[i].match(/^\s*id:\s*"([^"]+)"/)?.[1];
    if (!id) continue;
    const label = lines[i + 1]?.match(/^\s*label:\s*"([^"]+)"/)?.[1];
    if (!label) continue;
    const window = lines.slice(i, i + 8).join("\n");
    items.push({ id, label, hidden: /hidden:\s*true/.test(window) });
  }
  if (items.length < 8) throw new Error(`parsed too few skins: ${items.length}`);
  return items;
}

export function visibleSkinCatalog(items) {
  return items.filter((item) => !item.hidden);
}

const invoked = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invoked) {
  const items = parseWodeAppSkinsCatalog(readFileSync(sourcePath, "utf8"));
  const out = resolve(root, "wodeappx-dsh/lib/skin-catalog.json");
  writeFileSync(
    out,
    `${JSON.stringify({ generatedFrom: "integrations/openwork/wodeapp/wodeapp-skins.ts", skins: items }, null, 2)}\n`,
  );
  console.log(`wrote ${out} (${items.length} skins, ${visibleSkinCatalog(items).length} visible)`);
}
