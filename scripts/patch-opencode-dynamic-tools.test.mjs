import assert from "node:assert/strict";
import test from "node:test";

import {
  injectDynamicToolsImport,
  injectDynamicToolsReturn,
} from "./patch-opencode-dynamic-tools.mjs";

const vanillaHeader = `import { isRecord } from "@/util/record"
import { RuntimeFlags } from "@/effect/runtime-flags"

export const resolve = Effect.fn("SessionTools.resolve")(function* (input) {
  return tools
})
`;

test("injects dynamic-tool-discovery import on OpenCode 1.18.16 LF checkout", () => {
  const next = injectDynamicToolsImport(vanillaHeader);
  assert.match(next, /extractLatestUserTask/);
  assert.match(next, /from "\.\/dynamic-tool-discovery"/);
  assert.equal(next.includes("\r\n"), false);
});

test("injects dynamic-tool-discovery import on Windows CRLF checkout", () => {
  const crlf = vanillaHeader.replace(/\n/g, "\r\n");
  const next = injectDynamicToolsImport(crlf);
  assert.match(next, /extractLatestUserTask/);
  assert.ok(next.includes("\r\n"), "must preserve CRLF");
  assert.equal(next.includes('record"\nimport'), false);
});

test("wraps return tools on Windows CRLF checkout", () => {
  const crlf = vanillaHeader.replace(/\n/g, "\r\n");
  const withImport = injectDynamicToolsImport(crlf);
  const next = injectDynamicToolsReturn(withImport);
  assert.match(next, /exposeDynamicTools\(/);
  assert.match(next, /return exposed\.tools/);
  assert.ok(next.includes("\r\n"));
});
