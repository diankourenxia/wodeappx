const ACTIVATION_ROUTE_PATTERN =
  /addRoute\(\s*routes\s*,\s*["']POST["']\s*,\s*["']\/workspaces\/:id\/activate["']/;

const SAFE_ACTIVATION_COMMENT = `    // Activating a workspace only changes navigation/order state. Disposing the
    // directory-scoped OpenCode instance here aborts any response that is
    // currently streaming in that workspace. Explicit config/MCP changes have
    // their own guarded engine-reload path, so activation must stay non-
    // destructive.`;

const RELOAD_IF_PATTERN =
  /(^[ \t]*)if\s*\(([^;{}]*?)\)\s*\{\s*await\s+reloadOpencodeEngine\s*\(\s*config\s*,\s*workspace\s*\)\s*;\s*\}/gm;

const SUPPORTED_RELOAD_CONDITION =
  /^(?:!wasActive&&)?workspace\.workspaceType===["']local["']&&resolveWorkspaceOpencodeConnection\(config,workspace\)\.baseUrl\?\.trim\(\)$/;

function normalizeNewlines(value) {
  return String(value).replace(/\r\n/g, "\n");
}

function routeRange(content, fileLabel) {
  const match = ACTIVATION_ROUTE_PATTERN.exec(content);
  if (!match) {
    throw new Error(
      `OpenWork integration anchor not found in ${fileLabel}: workspace activation route`,
    );
  }
  const start = match.index;
  const nextRoute = content.indexOf("\n  addRoute(", start + match[0].length);
  return {
    start,
    end: nextRoute < 0 ? content.length : nextRoute,
  };
}

function stripUnusedActivationBindings(content, routeStart) {
  let next = content;
  const nextRoute = next.indexOf("\n  addRoute(", routeStart + 1);
  const routeEnd = nextRoute < 0 ? next.length : nextRoute;
  let activationRoute = next.slice(routeStart, routeEnd);

  const wasActiveDeclaration =
    /^[ \t]*const\s+wasActive\s*=\s*config\.workspaces\[0\]\?\.id\s*===\s*workspace\.id\s*;\s*\n/m;
  const wasActiveReferences = activationRoute.match(/\bwasActive\b/g) ?? [];
  if (wasActiveReferences.length === 1 && wasActiveDeclaration.test(activationRoute)) {
    activationRoute = activationRoute.replace(wasActiveDeclaration, "");
    next = `${next.slice(0, routeStart)}${activationRoute}${next.slice(routeEnd)}`;
  }

  if (!/\breloadOpencodeEngine\s*\(/.test(next)) {
    next = next.replace(/^[ \t]*reloadOpencodeEngine,\s*\n/m, "");
  }
  return next;
}

/**
 * Remove the destructive OpenCode reload from the workspace activation route.
 *
 * OpenWork 0.17.3 used one inline condition. Newer upstream revisions prefix
 * the same condition with `!wasActive` and format it over multiple lines. This
 * matcher is scoped to the activation route and validates the normalized
 * condition before replacing anything, so unrelated reload paths remain intact.
 */
export function patchWorkspaceActivationReload(
  input,
  fileLabel = "apps/server/src/routes/workspaces.ts",
) {
  const usesCrlf = String(input).includes("\r\n");
  const content = normalizeNewlines(input);
  const { start, end } = routeRange(content, fileLabel);
  const activationRoute = content.slice(start, end);

  const reloadCalls = activationRoute.match(/\breloadOpencodeEngine\s*\(/g) ?? [];
  if (reloadCalls.length === 0) {
    const cleaned = stripUnusedActivationBindings(content, start);
    return {
      content: usesCrlf ? cleaned.replace(/\n/g, "\r\n") : cleaned,
      changed: cleaned !== content,
    };
  }

  const candidates = [...activationRoute.matchAll(RELOAD_IF_PATTERN)].filter((match) => {
    const normalizedCondition = match[2].replace(/\s+/g, "");
    return SUPPORTED_RELOAD_CONDITION.test(normalizedCondition);
  });

  if (reloadCalls.length !== 1 || candidates.length !== 1) {
    throw new Error(
      `OpenWork integration anchor not found in ${fileLabel}: supported workspace activation reload`,
    );
  }

  const candidate = candidates[0];
  const routePatched = `${activationRoute.slice(0, candidate.index)}${SAFE_ACTIVATION_COMMENT}${activationRoute.slice(
    candidate.index + candidate[0].length,
  )}`;
  let patched = `${content.slice(0, start)}${routePatched}${content.slice(end)}`;
  patched = stripUnusedActivationBindings(patched, start);

  return {
    content: usesCrlf ? patched.replace(/\n/g, "\r\n") : patched,
    changed: patched !== content,
  };
}

export { SAFE_ACTIVATION_COMMENT };
