/**
 * Helpers for one-click blank local projects in the WodeAppX workbench.
 * Blank projects live under `<userData>/projects/项目-YYYYMMDD-HHmmss`
 * (sibling of the managed `default-workspace`).
 */

export function formatBlankProjectStamp(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function blankProjectName(date: Date = new Date()): string {
  return `项目-${formatBlankProjectStamp(date)}`;
}

function pathSeparator(sample: string): "\\" | "/" {
  return sample.includes("\\") && !sample.includes("/") ? "\\" : "/";
}

function dirnamePath(sample: string): string {
  const sep = pathSeparator(sample);
  const trimmed = sample.replace(/[/\\]+$/, "");
  const parts = trimmed.split(/[/\\]/);
  if (parts.length <= 1) return trimmed;
  return parts.slice(0, -1).join(sep);
}

/** Prefer sibling of managed default-workspace; else sibling of any local workspace. */
export function resolveBlankProjectFolderPath(
  workspacePaths: readonly string[],
  name: string = blankProjectName(),
): string | null {
  const paths = workspacePaths.map((item) => String(item || "").trim()).filter(Boolean);
  if (paths.length === 0) return null;

  const defaultWorkspace = paths.find((item) =>
    /[/\\]default-workspace$/i.test(item.replace(/\\/g, "/")),
  );
  const anchor = defaultWorkspace || paths[0];
  if (!anchor) return null;

  const sep = pathSeparator(anchor);
  const normalized = anchor.replace(/[/\\]+$/, "");
  const root = /[/\\]default-workspace$/i.test(normalized)
    ? normalized.replace(/[/\\]default-workspace$/i, "")
    : dirnamePath(normalized);
  if (!root) return null;
  return `${root}${sep}projects${sep}${name}`;
}
