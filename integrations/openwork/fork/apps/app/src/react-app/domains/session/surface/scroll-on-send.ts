/**
 * Follow-up send must chase the tail (Cursor/Codex).
 * Long sessions often leave scroll mode=manual after browsing tool rows;
 * without this, the new user bubble stays below the fold at a mid-list offset.
 */

type RoleMessage = {
  id?: unknown
  role?: unknown
}

export function lastUserMessageId(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as RoleMessage | undefined
    if (message?.role !== "user") continue
    if (typeof message.id !== "string" || message.id.length === 0) continue
    return message.id
  }
  return null
}

export function isTrailingUserMessage(messages: unknown): boolean {
  if (!Array.isArray(messages) || messages.length === 0) return false
  const last = messages[messages.length - 1] as RoleMessage | undefined
  return last?.role === "user"
}

export function shouldStickToBottomOnNewUserMessage(input: {
  sessionId: string | null
  sessionChanged: boolean
  prevLastUserMessageId: string | null
  nextLastUserMessageId: string | null
}): boolean {
  if (!input.sessionId || input.sessionChanged) return false
  if (!input.nextLastUserMessageId) return false
  return input.nextLastUserMessageId !== input.prevLastUserMessageId
}

/**
 * History-window prepend restore keeps a mid-list offset after slice(-60).
 * A new user turn must not restore that offset — even if an assistant
 * placeholder is already the trailing row in the same update.
 */
export function shouldClearHistoryWindowAnchorOnAppend(input: {
  prevLastUserMessageId: string | null
  nextLastUserMessageId: string | null
  messages: unknown
}): boolean {
  if (isTrailingUserMessage(input.messages)) return true
  return Boolean(
    input.nextLastUserMessageId
    && input.nextLastUserMessageId !== input.prevLastUserMessageId,
  )
}
