/** What a composer `@token` refers to: an agent, workspace file, macOS app, or WodeApp digital asset. */
export type ComposerMentionKind = "agent" | "file" | "app" | "asset";

export const PREVIEW_ASSET_MENTION_EVENT = "wodeapp:preview-asset-mention";

/**
 * Percent-encode a mention value so it can be embedded in the draft as a single `@token` with no spaces.
 * @param value The raw mention value to encode.
 */
export function encodeComposerMentionValue(value: string) {
  return value.replaceAll("%", "%25").replaceAll(" ", "%20");
}

/**
 * Recover the original mention value from its encoded form. Preserves literal `%20` sequences in the original.
 * @param value The encoded mention value to decode.
 */
export function decodeComposerMentionValue(value: string) {
  return value.replaceAll("%20", " ").replaceAll("%25", "%");
}

export function collectComposerMentionValues(
  text: string,
  mentions: Record<string, ComposerMentionKind>,
  kind?: ComposerMentionKind,
) {
  const values: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/@([^\s@]+)/g)) {
    const value = decodeComposerMentionValue(match[1] ?? "");
    if (!value || seen.has(value)) continue;
    if (kind && mentions[value] !== kind) continue;
    if (!kind && !mentions[value]) continue;
    seen.add(value);
    values.push(value);
  }
  return values;
}

