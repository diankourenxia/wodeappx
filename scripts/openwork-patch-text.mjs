/**
 * OpenWork locale sources sometimes store U+2026 as the JS escape `\u2026`
 * instead of the literal ellipsis character. Branding anchors must match both.
 */
const ELLIPSIS = "\u2026";
const ESCAPED_ELLIPSIS = "\\u2026";

export function expandJsStringEscapeVariants(value) {
  const text = String(value);
  const variants = [text];
  if (text.includes(ELLIPSIS)) {
    variants.push(text.replaceAll(ELLIPSIS, ESCAPED_ELLIPSIS));
  }
  if (text.includes(ESCAPED_ELLIPSIS)) {
    variants.push(text.replaceAll(ESCAPED_ELLIPSIS, ELLIPSIS));
  }
  return [...new Set(variants)];
}

export function brandingAnchorVariants(from) {
  const seeds = Array.isArray(from) ? from : [from];
  return seeds.flatMap((item) => expandJsStringEscapeVariants(item));
}

const SKIP_MCP_MARKER = "WODEAPPX_SKIP_MCP_IN_OPENCODE_CONFIG";
const OLD_MCP_CONST = `  const mcp = runtimeMcpMap(runtimeConfig);
  return {
    ...runtimeConfig,`;
const OLD_MCP_CONST_TO = `  // ${SKIP_MCP_MARKER}
  const { mcp: _runtimeMcpIgnored, ...runtimeConfigWithoutMcp } = runtimeConfig;
  return {
    ...runtimeConfigWithoutMcp,`;
const MCP_PROPERTY = /(?:\r?\n)[ \t]*mcp:\s*runtimeMcpMap\(runtimeConfig\),/;
const RUNTIME_SPREAD = `  return {
    ...runtimeConfig,`;
const RUNTIME_SPREAD_WITHOUT_MCP = `  // ${SKIP_MCP_MARKER}
  const { mcp: _runtimeMcpIgnored, ...runtimeConfigWithoutMcp } = runtimeConfig;
  return {
    ...runtimeConfigWithoutMcp,`;

export function skipMcpInOpencodeConfigSource(content) {
  if (content.includes(SKIP_MCP_MARKER) || content.includes("runtimeConfigWithoutMcp")) {
    return { content, changed: false };
  }

  let next = content;
  if (next.includes(OLD_MCP_CONST)) {
    next = next.replace(OLD_MCP_CONST, OLD_MCP_CONST_TO);
    const mcpSpread = `,\n    ...(Object.keys(mcp).length ? { mcp } : {}),\n  };`;
    if (next.includes(mcpSpread)) {
      next = next.replace(mcpSpread, "\n  };");
    }
  } else if (MCP_PROPERTY.test(next)) {
    next = next.replace(MCP_PROPERTY, "");
    if (!next.includes(RUNTIME_SPREAD)) {
      throw new Error("skip mcp in OPENCODE_CONFIG: runtime config spread");
    }
    next = next.replace(RUNTIME_SPREAD, RUNTIME_SPREAD_WITHOUT_MCP);
  } else {
    throw new Error("skip mcp in OPENCODE_CONFIG");
  }

  if (!next.includes("runtimeMcpMap(")) {
    next = next.replace(/\r?\n[ \t]*runtimeMcpMap,/, "");
  }

  return { content: next, changed: next !== content };
}

export const BUILT_IN_SKILLS_EXTRA_RESOURCE = `  - from: ../../.opencode/skills
    to: built-in-skills
    filter:
      - "**/*"
`;

export function collapseDuplicateBuiltInSkillsResources(content) {
  const block = BUILT_IN_SKILLS_EXTRA_RESOURCE;
  const first = content.indexOf(block);
  if (first === -1) return content;
  let next = content;
  let from = first + block.length;
  while (true) {
    const extra = next.indexOf(block, from);
    if (extra === -1) return next;
    next = next.slice(0, extra) + next.slice(extra + block.length);
  }
}

export function ensureBuiltInSkillsExtraResource(content) {
  const collapsed = collapseDuplicateBuiltInSkillsResources(content);
  if (collapsed.includes("to: built-in-skills")) return collapsed;
  const docs = `  - from: ../../packages/docs
    to: openwork-docs`;
  if (!collapsed.includes(docs)) {
    throw new Error("electron-builder.yml missing openwork-docs extraResources anchor");
  }
  return collapsed.replace(docs, `${BUILT_IN_SKILLS_EXTRA_RESOURCE}${docs}`);
}

export const SCHEDULER_SUPERVISOR_FILESET = `  - from: server/dist/opencode-plugins
    to: server/dist/opencode-plugins
    filter:
      - wodeappx-scheduler-supervisor.js`;

export const PACKAGED_LICENSES_EXTRA_RESOURCE = `  - from: resources/licenses
    to: licenses
    filter:
      - "**/*"`;

/** Reproduce release-only FileSets from a clean OpenWork checkout. */
export function ensureDesktopPackagingResources(content) {
  let next = content;

  if (!next.includes(SCHEDULER_SUPERVISOR_FILESET)) {
    const filesAnchor = `  - server/**/*
  - package.json`;
    const filesAnchorWithExclude = `  - server/**/*
  - "!server/dist/opencode-plugins/**"
  - package.json`;
    if (next.includes(filesAnchorWithExclude)) {
      next = next.replace(
        filesAnchorWithExclude,
        `${filesAnchorWithExclude}
${SCHEDULER_SUPERVISOR_FILESET}`,
      );
    } else if (next.includes(filesAnchor)) {
      next = next.replace(
        filesAnchor,
        `  - server/**/*
  - "!server/dist/opencode-plugins/**"
  - package.json
${SCHEDULER_SUPERVISOR_FILESET}`,
      );
    } else {
      throw new Error("electron-builder.yml missing server files anchor");
    }
  }

  if (!next.includes(PACKAGED_LICENSES_EXTRA_RESOURCE)) {
    const appDistAnchor = `  - from: ../app/dist
    to: app-dist`;
    if (!next.includes(appDistAnchor)) {
      throw new Error("electron-builder.yml missing app-dist extraResources anchor");
    }
    next = next.replace(
      appDistAnchor,
      `${appDistAnchor}
${PACKAGED_LICENSES_EXTRA_RESOURCE}`,
    );
  }

  return next;
}
