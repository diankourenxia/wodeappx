export type ToolErrorKind = "validation" | "ambiguous" | "dependency" | "execution";

export type ToolItemFailurePayload = {
  status: "failed";
  recoverable: boolean;
  errorKind: ToolErrorKind;
  message: string;
  data?: unknown;
};

const FAILURE_TAG_RE = /^\[wodeappxFailure recoverable=(true|false) errorKind=(validation|ambiguous|dependency|execution)\]\s*/;

export function stripFailureMessageTag(message: string): string {
  return message.replace(FAILURE_TAG_RE, "").trim() || message.trim();
}

export function formatToolItemFailureTag(input: {
  recoverable: boolean;
  errorKind: ToolErrorKind;
  message: string;
}): string {
  const readable = stripFailureMessageTag(input.message);
  return `[wodeappxFailure recoverable=${input.recoverable ? "true" : "false"} errorKind=${input.errorKind}] ${readable}`;
}

export function parseToolItemFailureTag(
  message: string,
): Pick<ToolItemFailurePayload, "recoverable" | "errorKind"> | null {
  const match = FAILURE_TAG_RE.exec(message.trim());
  if (!match) return null;
  return {
    recoverable: match[1] === "true",
    errorKind: match[2] as ToolErrorKind,
  };
}

/**
 * Rebuild structured failure metadata from the durable error-string transport.
 * OpenCode 1.17.11 drops running-state metadata when settling an errored Item.
 */
export function failurePayloadFromTaggedMessage(message: string): ToolItemFailurePayload | null {
  const tagged = parseToolItemFailureTag(message);
  if (!tagged) return null;
  return {
    status: "failed",
    recoverable: tagged.recoverable,
    errorKind: tagged.errorKind,
    message: stripFailureMessageTag(message),
  };
}

