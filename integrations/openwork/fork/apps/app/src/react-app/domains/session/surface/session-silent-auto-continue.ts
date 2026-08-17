/**
 * Silent auto-continue user messages.
 *
 * The server may inject a synthetic user turn to push a stuck or attachment-only
 * prompt past the assistant (see stuck-tool-recovery and wodeapp-attachment-
 * intelligence). Those turns must never render as visible user bubbles.
 *
 * Keeping this rule in its own module lets the composer render path and the
 * regression test share a single source of truth instead of duplicating the
 * detection.
 */
import type { UIMessage } from "@ai-sdk/react";
import { isStuckToolAutoContinueText } from "./stuck-tool-recovery";
import { isHiddenAttachmentIntelligenceText } from "@/react-app/domains/wodeapp/wodeapp-attachment-intelligence";

function filePartCount(message: UIMessage) {
  return message.parts.filter((part) => part.type === "file").length;
}

export function isSilentAutoContinueUserMessage(message: UIMessage): boolean {
  if (message.role !== "user") return false;
  if (filePartCount(message) > 0) return false;
  const texts = message.parts
    .filter((part): part is Extract<UIMessage["parts"][number], { type: "text" }> => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean);
  if (texts.length === 0) return false;
  return texts.every(
    (text) => isStuckToolAutoContinueText(text) || isHiddenAttachmentIntelligenceText(text),
  );
}
