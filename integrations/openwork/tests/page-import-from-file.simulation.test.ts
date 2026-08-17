/**
 * Simulation: local HTML → import-html without stuffing HTML into model tool args.
 * Mocks fetch; proves host reads file and posts html only on the wire.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { routeWodeAppCapabilities } from "../wodeapp/wodeapp-capability-routing";
import { resolveWodeAppToolDocs } from "../wodeapp/wodeapp-tool-docs";
import { CREATIVE_CORE_RESIDENT_TOOL_IDS } from "../wodeapp/wodeapp-creative-core";

type FetchCall = {
  url: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
};

const MAX_PAGE_IMPORT_HTML_BYTES = 1_500_000;

async function simulateImportPageFromLocalHtmlFile(
  args: {
    projectId: string;
    sourcePath: string;
    pageId?: string;
    path?: string;
    title?: string;
  },
  opts: {
    apiKey: string;
    mainApiBase: string;
    fetchImpl: typeof fetch;
  },
): Promise<Record<string, unknown>> {
  const html = await Bun.file(args.sourcePath).text();
  const byteLength = Buffer.byteLength(html, "utf8");
  if (!html.trim()) {
    return { ok: false, recoverable: true, errorKind: "validation", data: { code: "HTML_EMPTY" } };
  }
  if (byteLength > MAX_PAGE_IMPORT_HTML_BYTES) {
    return { ok: false, recoverable: true, errorKind: "validation", data: { code: "HTML_TOO_LARGE", byteLength } };
  }

  const headers = {
    "Content-Type": "application/json",
    "X-API-Key": opts.apiKey,
    Authorization: `Bearer ${opts.apiKey}`,
  };

  let pageId = args.pageId?.trim() || "";
  let createdPage = false;
  if (!pageId) {
    if (!args.path?.trim() || !args.title?.trim()) {
      return {
        ok: false,
        recoverable: true,
        errorKind: "validation",
        data: { code: "PAGE_TARGET_REQUIRED" },
      };
    }
    const normalizedPath = args.path.startsWith("/") ? args.path : `/${args.path}`;
    const createRes = await opts.fetchImpl(
      `${opts.mainApiBase}/json-schema/projects/${encodeURIComponent(args.projectId)}/pages`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          path: normalizedPath,
          title: args.title,
          config: { title: args.title, path: normalizedPath, mode: "real", sections: [] },
        }),
      },
    );
    const createJson = await createRes.json() as { data?: { id?: string } };
    pageId = createJson.data?.id || "";
    if (!pageId) {
      return { ok: false, recoverable: true, errorKind: "execution", data: { code: "PAGE_CREATE_NO_ID" } };
    }
    createdPage = true;
  }

  const importRes = await opts.fetchImpl(
    `${opts.mainApiBase}/json-schema/projects/${encodeURIComponent(args.projectId)}/pages/${encodeURIComponent(pageId)}/import-html`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        html,
        ...(args.title ? { title: args.title } : {}),
      }),
    },
  );
  if (!importRes.ok) {
    return {
      ok: false,
      recoverable: true,
      errorKind: "execution",
      data: { code: "IMPORT_HTML_FAILED", status: importRes.status, pageId },
    };
  }
  const importJson = await importRes.json() as {
    data?: { id?: string; path?: string; title?: string; config?: { sections?: unknown[] } };
    meta?: { sectionType?: string; byteLength?: number };
  };
  const sections = importJson.data?.config?.sections || [];
  return {
    ok: true,
    executor: "local",
    stage: "page_import_from_file",
    data: {
      projectId: args.projectId,
      pageId,
      sourcePath: args.sourcePath,
      createdPage,
      byteLength,
      page: {
        id: importJson.data?.id,
        path: importJson.data?.path,
        title: importJson.data?.title,
        sectionsCount: sections.length,
        sectionTypes: sections.map((s) => (s && typeof s === "object" && "type" in s ? String((s as { type: string }).type) : "unknown")),
      },
      meta: importJson.meta,
    },
    nextActions: ["Call publish_project with the same projectId after verifying sectionsCount > 0."],
  };
}

describe("page_import_from_file simulation matrix", () => {
  const dirs: string[] = [];
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    calls.length = 0;
    for (const dir of dirs.splice(0)) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  });

  function mockFetchOk() {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method || "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      const headers: Record<string, string> = {};
      const h = init?.headers;
      if (h && typeof h === "object" && !(h instanceof Headers)) {
        Object.assign(headers, h as Record<string, string>);
      } else if (h instanceof Headers) {
        h.forEach((v, k) => {
          headers[k] = v;
        });
      }
      calls.push({ url, method, body, headers });

      if (url.includes("/pages") && method === "POST" && !url.includes("import-html")) {
        return new Response(JSON.stringify({ success: true, data: { id: "page_sim_1", path: body?.path, title: body?.title } }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("import-html") && method === "POST") {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              id: "page_sim_1",
              path: "/",
              title: "仿真线路图",
              config: {
                title: "仿真线路图",
                sections: [{ type: "CustomCode", props: { code: "export default function X(){return null}" } }],
              },
            },
            meta: { strategy: "raw_html", byteLength: Buffer.byteLength(String(body?.html || ""), "utf8"), sectionType: "CustomCode", language: "html" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    }) as typeof fetch;
  }

  test("routing enables from_file for local HTML publish (hints only; OpenCode Direct is separate)", () => {
    expect(CREATIVE_CORE_RESIDENT_TOOL_IDS).toContain("wodeapp_page_import_from_file");
    expect(CREATIVE_CORE_RESIDENT_TOOL_IDS).toContain("publish_project");
    const route = routeWodeAppCapabilities({
      text: "把工作区里的 内蒙古自驾线路图.html 发布成站点，不要把整页 HTML 塞进 update_page",
    });
    expect(route.capabilities).toContain("site");
    expect(route.tools.wodeapp_page_import_from_file).toBe(true);
    expect(route.tools.publish_project).toBe(true);
    expect(route.system).toContain("wodeapp_page_import_from_file");
    expect(route.system).toContain("sourcePath");
    const docs = resolveWodeAppToolDocs("wodeapp_page_import_from_file");
    expect(docs?.requiredFields).toEqual(expect.arrayContaining(["projectId", "sourcePath"]));
  });

  test("happy path: tool args stay path-sized; HTML only appears on import-html wire", async () => {
    mockFetchOk();
    const dir = mkdtempSync(join(tmpdir(), "pv-import-sim-"));
    dirs.push(dir);
    const html = `<!doctype html><html><body><h1>内蒙古金秋自驾</h1><p>${"x".repeat(2000)}</p></body></html>`;
    const sourcePath = join(dir, "内蒙古自驾线路图.html");
    writeFileSync(sourcePath, html, "utf8");

    const toolArgs = {
      projectId: "proj_sim",
      pageId: "page_existing",
      sourcePath,
    };
    // Model-visible args must stay small (path-sized), never embed html.
    expect(JSON.stringify(toolArgs).length).toBeLessThan(500);
    expect(JSON.stringify(toolArgs)).not.toContain("<!doctype");

    const result = await simulateImportPageFromLocalHtmlFile(toolArgs, {
      apiKey: "sk_test_sim",
      mainApiBase: "https://example.wodeapp.cn/mainserver/api",
      fetchImpl: globalThis.fetch,
    });

    expect(result.ok).toBe(true);
    expect((result.data as { page?: { sectionsCount?: number } })?.page?.sectionsCount).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain("/import-html");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers["X-API-Key"]).toBe("sk_test_sim");
    expect(String((calls[0].body as { html?: string })?.html || "")).toContain("内蒙古金秋自驾");
    expect(String((calls[0].body as { html?: string })?.html || "").length).toBeGreaterThan(2000);
  });

  test("create path: page create then import-html when pageId omitted", async () => {
    mockFetchOk();
    const dir = mkdtempSync(join(tmpdir(), "pv-import-sim-"));
    dirs.push(dir);
    const sourcePath = join(dir, "map.html");
    writeFileSync(sourcePath, "<html><body>map</body></html>", "utf8");

    const result = await simulateImportPageFromLocalHtmlFile(
      { projectId: "proj_sim", path: "/map", title: "线路图", sourcePath },
      {
        apiKey: "sk_test_sim",
        mainApiBase: "https://example.wodeapp.cn/mainserver/api",
        fetchImpl: globalThis.fetch,
      },
    );

    expect(result.ok).toBe(true);
    expect((result.data as { createdPage?: boolean })?.createdPage).toBe(true);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toMatch(/\/pages$/);
    expect(calls[1].url).toContain("import-html");
    expect(calls[0].body).not.toHaveProperty("html");
  });

  test("validation: missing page target fails recoverable without network", async () => {
    mockFetchOk();
    const dir = mkdtempSync(join(tmpdir(), "pv-import-sim-"));
    dirs.push(dir);
    const sourcePath = join(dir, "x.html");
    writeFileSync(sourcePath, "<html></html>", "utf8");

    const result = await simulateImportPageFromLocalHtmlFile(
      { projectId: "proj_sim", sourcePath },
      {
        apiKey: "sk_test_sim",
        mainApiBase: "https://example.wodeapp.cn/mainserver/api",
        fetchImpl: globalThis.fetch,
      },
    );
    expect(result.ok).toBe(false);
    expect((result.data as { code?: string })?.code).toBe("PAGE_TARGET_REQUIRED");
    expect(calls).toHaveLength(0);
  });
});
