import assert from "node:assert/strict";
import test from "node:test";

import {
  brandingAnchorVariants,
  collapseDuplicateBuiltInSkillsResources,
  ensureDesktopPackagingResources,
  ensureBuiltInSkillsExtraResource,
  expandJsStringEscapeVariants,
  skipMcpInOpencodeConfigSource,
} from "./openwork-patch-text.mjs";

test("expands a literal ellipsis into the JS unicode escape used by OpenWork 0.17.3", () => {
  const from = '"welcome.creating_workspace": "Creating workspace\u2026",';
  const variants = expandJsStringEscapeVariants(from);
  assert.ok(variants.includes(from));
  assert.ok(variants.includes('"welcome.creating_workspace": "Creating workspace\\u2026",'));
});

test("branding anchors match the escaped locale line from a clean zip extract", () => {
  const fileLine = '  "welcome.creating_workspace": "Creating workspace\\u2026",';
  const from = [
    '"welcome.creating_workspace": "Creating workspace\u2026",',
    '"welcome.creating_workspace": "Creating workspace...",',
  ];
  const variants = brandingAnchorVariants(from);
  assert.ok(variants.some((candidate) => fileLine.includes(candidate)));
});

test("skip-mcp patch accepts OpenWork 0.17.3 property form", () => {
  const source = `import {
  runtimeDisabledProviderList,
  runtimeMcpMap,
  runtimePluginList,
} from "./runtime-opencode-config-store.js";

export async function buildOpenworkRuntimeConfigObject() {
  const runtimeConfig = {};
  const disabledProviders = runtimeDisabledProviderList(runtimeConfig);
  return {
    ...runtimeConfig,
    default_agent: runtimeConfig.default_agent ?? "openwork",
    ...(disabledProviders.length ? { disabled_providers: disabledProviders } : {}),
    mcp: runtimeMcpMap(runtimeConfig),
  };
}
`;
  const first = skipMcpInOpencodeConfigSource(source);
  assert.equal(first.changed, true);
  assert.match(first.content, /WODEAPPX_SKIP_MCP_IN_OPENCODE_CONFIG/);
  assert.match(first.content, /runtimeConfigWithoutMcp/);
  assert.doesNotMatch(first.content, /mcp:\s*runtimeMcpMap/);
  assert.doesNotMatch(first.content, /runtimeMcpMap,/);
  const second = skipMcpInOpencodeConfigSource(first.content);
  assert.equal(second.changed, false);
});

test("collapses a second built-in-skills extraResources block", () => {
  const skills = `  - from: ../../.opencode/skills
    to: built-in-skills
    filter:
      - "**/*"
`;
  const source = `extraResources:
${skills}  - from: ../../.opencode/commands
    to: built-in-commands
    filter:
      - "evolve.md"
${skills}  - from: ../../packages/docs
    to: openwork-docs
`;
  const next = collapseDuplicateBuiltInSkillsResources(source);
  assert.equal(next.split("to: built-in-skills").length - 1, 1);
  assert.match(next, /to: built-in-commands/);
});

test("ensureBuiltInSkillsExtraResource is idempotent after commands are inserted", () => {
  const once = ensureBuiltInSkillsExtraResource(`extraResources:
  - from: ../../packages/docs
    to: openwork-docs
`);
  const withCommands = once.replace(
    "to: built-in-skills\n    filter:\n      - \"**/*\"\n",
    "to: built-in-skills\n    filter:\n      - \"**/*\"\n  - from: ../../.opencode/commands\n    to: built-in-commands\n    filter:\n      - \"evolve.md\"\n",
  );
  const twice = ensureBuiltInSkillsExtraResource(withCommands);
  assert.equal(twice.split("to: built-in-skills").length - 1, 1);
});

test("ensureDesktopPackagingResources is clean-checkout reproducible and idempotent", () => {
  const source = `files:
  - electron/**/*
  - server/**/*
  - package.json
extraResources:
  - from: ../app/dist
    to: app-dist
  - from: server/dist/opencode-plugins
    to: opencode-plugins
    filter:
      - "**/*"
`;
  const once = ensureDesktopPackagingResources(source);
  assert.match(once, /!server\/dist\/opencode-plugins\/\*\*/);
  assert.match(once, /to: server\/dist\/opencode-plugins/);
  assert.match(once, /wodeappx-scheduler-supervisor\.js/);
  assert.match(once, /from: resources\/licenses/);
  assert.match(once, /to: licenses/);
  assert.equal(ensureDesktopPackagingResources(once), once);
});

test("ensureDesktopPackagingResources accepts an already-excluded server fileset", () => {
  const source = `files:
  - electron/**/*
  - server/**/*
  - "!server/dist/opencode-plugins/**"
  - package.json
extraResources:
  - from: ../app/dist
    to: app-dist
`;
  const once = ensureDesktopPackagingResources(source);
  assert.match(once, /wodeappx-scheduler-supervisor\.js/);
  assert.equal(ensureDesktopPackagingResources(once), once);
});
