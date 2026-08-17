import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import {
  CONTEXT_READBACK_POLICY,
  buildContextReadbackPlan,
  evaluateContextReadbackTrace,
  sanitizeContextArtifactValue,
  writeSessionTranscriptArtifact,
} from "./wodeapp-context-artifacts.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("WodeApp context artifacts", () => {
  test("uses one bounded readback contract for transcript, spill and knowledge artifacts", () => {
    for (const artifactKind of ["session transcript", "web-read spill", "knowledge source"]) {
      const path = `/tmp/${artifactKind.replaceAll(" ", "-")}.jsonl`;
      const plan = buildContextReadbackPlan({ artifactKind, path, queryHint: "exact detail" });
      expect(plan.policy).toEqual(CONTEXT_READBACK_POLICY);
      expect(plan.hint).toContain("Search first with grep/rg");
      expect(plan.hint).toContain(`limit<=${CONTEXT_READBACK_POLICY.maxLines}`);
      expect(plan.hint).toContain(`maxChars<=${CONTEXT_READBACK_POLICY.maxChars}`);
      expect(plan.hint).toContain("Never cat or read the entire artifact");

      expect(evaluateContextReadbackTrace({
        path,
        steps: [
          { tool: "grep", args: { pattern: "exact detail", path } },
          { tool: "read", args: { filePath: path, offset: 20, limit: 60 } },
        ],
      })).toEqual({ ok: true, violations: [] });
    }
  });

  test("rejects whole-file or unbounded recovery traces", () => {
    const path = "/tmp/transcript.jsonl";
    expect(evaluateContextReadbackTrace({
      path,
      steps: [{ tool: "bash", args: { command: `cat ${path}` } }],
    })).toMatchObject({
      ok: false,
      violations: expect.arrayContaining(["search_first_required", "whole_file_cat_forbidden"]),
    });
    expect(evaluateContextReadbackTrace({
      path,
      steps: [
        { tool: "grep", args: { pattern: "owner", path } },
        { tool: "openwork_file_extract_text", args: { path, offset: 0, maxChars: 50_000 } },
      ],
    })).toMatchObject({
      ok: false,
      violations: ["extract_window_unbounded"],
    });
  });

  test("writes a private reconstructable JSONL transcript without inline media or secrets", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "wodeapp-context-artifacts-"));
    temporaryRoots.push(artifactRoot);
    const artifact = await writeSessionTranscriptArtifact({
      sessionID: "ses/private",
      artifactRoot,
      messages: [{
        info: { id: "msg_1", role: "user", apiKey: "sk_live_privatevalue" },
        parts: [
          { type: "text", text: "Remember the exact order number A-1042." },
          { type: "file", url: "data:image/png;base64,aaaaaaaaaaaaaaaa" },
        ],
      }],
    });

    const content = await readFile(artifact.path, "utf8");
    const mode = (await stat(artifact.path)).mode & 0o777;
    expect(artifact.messageCount).toBe(1);
    expect(artifact.lines).toBe(4);
    expect(mode).toBe(0o600);
    expect(content).toContain("A-1042");
    expect(content).toContain('"kind":"message"');
    expect(content).toContain('"kind":"part"');
    expect(content).toContain("[WodeApp data URL omitted");
    expect(content).toContain('"apiKey":"[REDACTED]"');
    expect(content).not.toContain("sk_live_privatevalue");
    expect(content).not.toContain("data:image/png;base64");
  });

  test("redacts secrets embedded in structured values and output strings", () => {
    const sanitized = sanitizeContextArtifactValue({
      authorization: "Bearer long-secret-token",
      output: "Authorization: Bearer abcdefghijklmnop api_key=another-secret-value",
    });
    expect(sanitized).toEqual({
      authorization: "[REDACTED]",
      output: "Authorization: Bearer [REDACTED] api_key=[REDACTED]",
    });
  });
});
