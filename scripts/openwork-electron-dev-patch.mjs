const MACOS_HELPER_MARKER = "function runPlistBuddy(command, plistPath) {";
const EXPECTED_MACOS_HELPER_FUNCTIONS = new Set([
  "runPlistBuddy",
  "setPlistString",
  "registerAppBundle",
  "pathExistsNoFollow",
  "prepareElectronDevBundleName",
]);

function normalizeNewlines(value) {
  return String(value).replace(/\r\n/g, "\n");
}

function markerIndexes(content, marker) {
  const indexes = [];
  let cursor = 0;
  while (cursor < content.length) {
    const index = content.indexOf(marker, cursor);
    if (index < 0) break;
    indexes.push(index);
    cursor = index + marker.length;
  }
  return indexes;
}

/**
 * Heal electron-dev.mjs files damaged by the old non-idempotent macOS helper
 * insertion. Repeated helpers are contiguous because every insertion replaced
 * the same trailing needsShell declaration. Keep the latest copy, which is the
 * one produced by the newest patcher, and fail closed if unrelated named
 * functions appear inside the range that would be removed.
 */
export function repairElectronDevMacosHelperDuplicates(
  input,
  fileLabel = "apps/desktop/scripts/electron-dev.mjs",
) {
  const usesCrlf = String(input).includes("\r\n");
  const content = normalizeNewlines(input);
  const indexes = markerIndexes(content, MACOS_HELPER_MARKER);
  if (indexes.length <= 1) {
    return { content: input, changed: false };
  }

  const first = indexes[0];
  const last = indexes[indexes.length - 1];
  const duplicatePrefix = content.slice(first, last);
  const declaredFunctions = [
    ...duplicatePrefix.matchAll(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm),
  ].map((match) => match[1]);
  const unexpectedFunctions = declaredFunctions.filter(
    (name) => !EXPECTED_MACOS_HELPER_FUNCTIONS.has(name),
  );
  const hasCompleteHelper = [...EXPECTED_MACOS_HELPER_FUNCTIONS].every(
    (name) => declaredFunctions.includes(name),
  );

  if (
    unexpectedFunctions.length
    || !hasCompleteHelper
    || duplicatePrefix.includes("function needsShell(")
  ) {
    throw new Error(
      `OpenWork integration could not safely repair duplicate macOS helpers in ${fileLabel}`,
    );
  }

  const repaired = `${content.slice(0, first)}${content.slice(last)}`;
  if (markerIndexes(repaired, MACOS_HELPER_MARKER).length !== 1) {
    throw new Error(
      `OpenWork integration failed to normalize macOS helpers in ${fileLabel}`,
    );
  }

  return {
    content: usesCrlf ? repaired.replace(/\n/g, "\r\n") : repaired,
    changed: true,
  };
}

export { MACOS_HELPER_MARKER };
