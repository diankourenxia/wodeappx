/**
 * Rewrite electron-builder generic updater manifests so relative asset names
 * become absolute URLs. Gitea can host the tiny yml; the binaries stay on
 * wodeapp.cn / GitHub.
 */

export function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

export function joinPublicAssetUrl(publicBase, name) {
  const base = String(publicBase || "").trim().replace(/\/+$/, "");
  const file = String(name || "").trim().replace(/^['"]|['"]$/g, "");
  if (!base || !file) return file;
  if (isAbsoluteUrl(file)) return file;
  return `${base}/${file.split("/").map(encodeURIComponent).join("/")}`;
}

export function rewriteUpdaterYml(raw, { publicBase } = {}) {
  const text = String(raw || "");
  if (!publicBase) return text;
  return text.replace(/^(\s*(?:-\s+url:|path:)\s*)(.+?)\s*$/gm, (full, prefix, value) => {
    const current = String(value || "").trim().replace(/^['"]|['"]$/g, "");
    if (!current || isAbsoluteUrl(current)) return full;
    return `${prefix}${joinPublicAssetUrl(publicBase, current)}`;
  });
}

export function updaterYmlVersion(raw) {
  const match = String(raw || "").match(/^version:\s*['"]?([0-9][^'"\s]*)/m);
  return match?.[1] || "";
}
