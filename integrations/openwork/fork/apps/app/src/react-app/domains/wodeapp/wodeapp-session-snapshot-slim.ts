/**
 * Defense-in-depth for OpenCode userMessage.summary.diffs patch bodies.
 * Server snapshot already strips patches; keep the renderer cache lean even if
 * an older server/proxy path still forwards fat payloads.
 *
 * Live SSE (`message.part.updated`) and snapshot hydrate must share the same
 * part slimming contract (PERF-05): do not only optimize hydrate.
 */

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Drop fat inline pixels from renderer cache; chat cards still keep filename/mime. */
export const SLIM_DATA_URL_MIN_CHARS = 2_048;
/** Bound tool dumps so a 72-message storyboard session does not remap 500KB+ on switch. */
export const SLIM_TOOL_TEXT_MAX_CHARS = 6_000;

function slimmedLocalAttachmentUrl(filename: string) {
  const name = filename.trim() || "image";
  return `wodeappx-local:${encodeURIComponent(name)}`;
}

function slimDataUrlFileRecord(record: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof record.url !== "string") return null;
  const url = record.url;
  if (!/^data:/i.test(url) || url.length <= SLIM_DATA_URL_MIN_CHARS) return null;
  const filename = typeof record.filename === "string" && record.filename.trim()
    ? record.filename.trim()
    : "image";
  return {
    ...record,
    // Keep a recoverable local marker instead of "" — empty urls leave permanent
    // PNG chips because idle compact only rewrites real data:/file: parts.
    url: slimmedLocalAttachmentUrl(filename),
    filename,
  };
}

function slimSessionPart(part: unknown): unknown {
  const record = asRecord(part);
  if (!record) return part;

  if (record.type === "file") {
    const slimmed = slimDataUrlFileRecord(record);
    return slimmed ?? part;
  }

  if (record.type === "tool") {
    const state = asRecord(record.state);
    if (!state) return part;
    let changed = false;
    const nextState: Record<string, unknown> = { ...state };
    for (const key of ["output", "error"] as const) {
      const value = nextState[key];
      if (typeof value === "string" && value.length > SLIM_TOOL_TEXT_MAX_CHARS) {
        nextState[key] = `${value.slice(0, SLIM_TOOL_TEXT_MAX_CHARS)}\n…[slimmed ${value.length - SLIM_TOOL_TEXT_MAX_CHARS} chars]`;
        changed = true;
      }
    }
    // Tool attachments are expanded to file UI parts on live SSE; slim nested
    // data URLs here so snapshot and live share one contract.
    if (Array.isArray(nextState.attachments)) {
      const nextAttachments = nextState.attachments.map((attachment) => {
        const entry = asRecord(attachment);
        if (!entry) return attachment;
        const slimmed = slimDataUrlFileRecord(entry);
        if (!slimmed) return attachment;
        changed = true;
        return slimmed;
      });
      if (changed) nextState.attachments = nextAttachments;
    }
    if (!changed) return part;
    return { ...record, state: nextState };
  }

  if (record.type === "text" && typeof record.text === "string" && record.text.length > SLIM_TOOL_TEXT_MAX_CHARS * 2) {
    // Reasoning/think dumps are expensive to remap; keep a head sample.
    return {
      ...record,
      text: `${record.text.slice(0, SLIM_TOOL_TEXT_MAX_CHARS * 2)}\n…[slimmed]`,
    };
  }

  return part;
}

/**
 * Shared live/snapshot part contract for PERF-05.
 * Apply after observe hooks and before `toUIParts` on `message.part.updated`.
 */
export function slimLiveMessagePart<T>(part: T): T {
  return slimSessionPart(part) as T;
}

export function slimSessionSummaryDiffs(summary: unknown): unknown {
  const record = asRecord(summary);
  if (!record || !Array.isArray(record.diffs)) return summary;
  return {
    ...record,
    diffs: record.diffs.map((diff) => {
      const entry = asRecord(diff);
      if (!entry) return diff;
      const slim: Record<string, unknown> = {};
      if (typeof entry.file === "string") slim.file = entry.file;
      if (typeof entry.path === "string") slim.path = entry.path;
      if (typeof entry.status === "string") slim.status = entry.status;
      if (typeof entry.additions === "number") slim.additions = entry.additions;
      if (typeof entry.deletions === "number") slim.deletions = entry.deletions;
      return slim;
    }),
  };
}

export function slimOpenworkSessionMessage<T extends { info: unknown; parts?: unknown[] }>(message: T): T {
  const info = asRecord(message.info);
  const parts = Array.isArray(message.parts) ? message.parts.map((part) => slimSessionPart(part)) : message.parts;
  const nextInfo = info && info.summary !== undefined
    ? {
        ...info,
        summary: slimSessionSummaryDiffs(info.summary),
      }
    : message.info;
  if (nextInfo === message.info && parts === message.parts) return message;
  return {
    ...message,
    info: nextInfo,
    ...(parts ? { parts } : {}),
  };
}

export function slimOpenworkSessionSnapshot<T extends { messages: Array<{ info: unknown }> }>(snapshot: T): T {
  return {
    ...snapshot,
    messages: snapshot.messages.map((message) => slimOpenworkSessionMessage(message)),
  };
}
