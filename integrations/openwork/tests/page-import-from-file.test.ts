import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { CREATIVE_CORE_RESIDENT_TOOL_IDS } from "../wodeapp/wodeapp-creative-core";
import { routeWodeAppCapabilities } from "../wodeapp/wodeapp-capability-routing";
import { resolveWodeAppToolDocs } from "../wodeapp/wodeapp-tool-docs";

const root = join(import.meta.dir, "..");

describe("wodeapp_page_import_from_file contract", () => {
  test("is resident and routed for site publish", () => {
    expect(CREATIVE_CORE_RESIDENT_TOOL_IDS).toContain("wodeapp_page_import_from_file");
    const route = routeWodeAppCapabilities({ text: "把本地 html 发布成站点" });
    expect(route.tools.wodeapp_page_import_from_file).toBe(true);
    expect(route.system).toContain("wodeapp_page_import_from_file");
  });

  test("tool docs and aliases resolve", () => {
    const docs = resolveWodeAppToolDocs("wodeapp_page_import_from_file");
    expect(docs?.requiredFields).toEqual(expect.arrayContaining(["projectId", "sourcePath"]));
    expect(resolveWodeAppToolDocs("page_import_html")?.title).toContain("HTML");
  });

  test("local-file snippets and generated host register the tool", () => {
    const tools = readFileSync(join(root, "opencode-plugins/local-file-tools.ts"), "utf8");
    const helpers = readFileSync(join(root, "opencode-plugins/local-file-helpers.ts"), "utf8");
    const schemas = readFileSync(join(root, "opencode-plugins/local-file-schemas.ts"), "utf8");
    const generated = readFileSync(
      join(root, "fork/apps/server/src/opencode-plugins/openwork-extensions-preview.ts"),
      "utf8",
    );
    expect(tools).toContain("wodeapp_page_import_from_file:");
    expect(helpers).toContain("async function importPageFromLocalHtmlFile");
    expect(schemas).toContain("pageImportFromFileArgsSchema");
    expect(generated).toContain("wodeapp_page_import_from_file:");
    expect(generated).toContain("import-html");
  });
});
