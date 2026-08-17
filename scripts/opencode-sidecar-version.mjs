/**
 * OpenWork 0.17.3 ships constants.json opencodeVersion v1.17.11.
 * WodeAppX dynamic-tools patches target OpenCode ≥1.18 session.ts
 * (`SessionMessage` from `@opencode-ai/schema/session-message`).
 * Local proven sidecar is v1.18.16; openwork:patch must pin this so
 * stranger CI does not compile 1.17.11 against 1.18 anchors.
 */
export const WODEAPPX_OPENCODE_SIDECAR_VERSION = "v1.18.16";

export function mergeOpenCodeSidecarConstants(existing = {}) {
  const next = existing && typeof existing === "object" && !Array.isArray(existing)
    ? { ...existing }
    : {};
  next.opencodeVersion = WODEAPPX_OPENCODE_SIDECAR_VERSION;
  return next;
}
