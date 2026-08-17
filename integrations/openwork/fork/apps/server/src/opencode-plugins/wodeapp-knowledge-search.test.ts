import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { searchWodeAppKnowledge } from "./wodeapp-knowledge-search.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  delete process.env.WODEAPPX_WYNNE_KNOWLEDGE_ROOT;
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("WodeApp knowledge search", () => {
  test("returns real scoped chunks with citations and freshness", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wodeapp-knowledge-"));
    temporaryRoots.push(workspace);
    const root = join(workspace, ".wodeapp", "knowledge", "wynne");
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "measurement-guide.md"),
      "# Measurement guide\n\nMeasure the curtain track width twice before ordering.",
      "utf8",
    );

    const result = await searchWodeAppKnowledge(
      { query: "curtain track width", profile: "wynne-brand-agent", topK: 3 },
      { directory: workspace },
    );

    expect(result.ok).toBe(true);
    expect(result.matches).toEqual([
      expect.objectContaining({
        chunk: 1,
        text: expect.stringContaining("Measure the curtain track width"),
        source: expect.stringContaining("measurement-guide.md"),
        version: expect.any(String),
        updatedAt: expect.any(String),
      }),
    ]);
    expect(result.readback).toMatchObject({
      artifactKind: "knowledge source",
      policy: {
        version: "wodeappx.context-readback/1",
        searchFirst: true,
        neverWholeFile: true,
      },
      hint: expect.stringContaining("Never cat or read the entire artifact"),
    });
  });

  test("fails closed instead of returning sample knowledge", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "wodeapp-knowledge-empty-"));
    temporaryRoots.push(workspace);
    const result = await searchWodeAppKnowledge(
      { query: "returns policy", profile: "wynne-brand-agent" },
      { directory: workspace },
    );

    expect(result).toMatchObject({
      ok: false,
      code: "knowledge_scope_not_configured",
      matches: [],
    });
  });
});
