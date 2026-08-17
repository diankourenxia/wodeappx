/**
 * Codex-style compaction transcript helpers.
 *
 * OpenCode stores context compaction as a user message holding a single
 * `compaction` part; the model-facing summary arrives as the next assistant
 * message. OpenCode also keeps a recent "tail" (`tail_start_id` /
 * `compaction.tail_turns`) in full context — those turns must stay visible
 * in the chat, not disappear under the「已处理 xx」strip.
 *
 * MessageList collapses only the pre-tail segment into one expandable strip;
 * the tail + summary render below as normal bubbles.
 */

export const OPENCODE_COMPACTION_PART_TYPE = "data-opencode-compaction";

export type OpencodeCompactionMarker = {
  auto: boolean;
  overflow: boolean;
  /** First message id that stays outside the fold (OpenCode tail). */
  tailStartId: string | null;
};

type CompactionDataPart = {
  type: string;
  id?: string;
  data?: unknown;
  auto?: boolean;
  overflow?: boolean;
  tail_start_id?: string;
  tailStartId?: string;
};

export type OpencodeCompactionUIPart = {
  type: typeof OPENCODE_COMPACTION_PART_TYPE;
  id: string;
  data: {
    auto: boolean;
    overflow: boolean;
    partId: string;
    tailStartId: string | null;
  };
};

function readTailStartId(source: Record<string, unknown>): string | null {
  const snake = source.tail_start_id;
  if (typeof snake === "string" && snake) return snake;
  const camel = source.tailStartId;
  if (typeof camel === "string" && camel) return camel;
  return null;
}

/** UI data part carried through the transcript in place of the raw part. */
export function toOpencodeCompactionUIPart(part: {
  id: string;
  auto?: boolean;
  overflow?: boolean;
  tail_start_id?: string;
  tailStartId?: string;
}): OpencodeCompactionUIPart {
  return {
    type: OPENCODE_COMPACTION_PART_TYPE,
    id: part.id,
    data: {
      auto: part.auto === true,
      overflow: part.overflow === true,
      partId: part.id,
      tailStartId: readTailStartId(part as Record<string, unknown>),
    },
  };
}

function markerFromData(data: unknown): OpencodeCompactionMarker | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  return {
    auto: record.auto === true,
    overflow: record.overflow === true,
    tailStartId: readTailStartId(record),
  };
}

export function getOpencodeCompactionMarkerFromPart(part: unknown): OpencodeCompactionMarker | null {
  if (!part || typeof part !== "object") return null;
  const candidate = part as CompactionDataPart;
  if (candidate.type === OPENCODE_COMPACTION_PART_TYPE) {
    return markerFromData(candidate.data);
  }
  // Live SSE / snapshot may still hand us the raw OpenCode part before mapping.
  if (candidate.type === "compaction") {
    return {
      auto: candidate.auto === true,
      overflow: candidate.overflow === true,
      tailStartId: readTailStartId(candidate as Record<string, unknown>),
    };
  }
  return null;
}

/** Original OpenCode part id, for idempotent live upserts. */
export function getOpencodeCompactionPartId(part: unknown): string | null {
  if (!part || typeof part !== "object") return null;
  const candidate = part as CompactionDataPart;
  if (candidate.type !== OPENCODE_COMPACTION_PART_TYPE) return null;
  const data = candidate.data;
  if (data && typeof data === "object") {
    const partId = (data as Record<string, unknown>).partId;
    if (typeof partId === "string" && partId) return partId;
  }
  return typeof candidate.id === "string" && candidate.id ? candidate.id : null;
}

export function getOpencodeCompactionMarker(message: { parts: unknown[] }): OpencodeCompactionMarker | null {
  for (const part of message.parts) {
    const marker = getOpencodeCompactionMarkerFromPart(part);
    if (marker) return marker;
  }
  return null;
}

/** Codex row label: "45s" / "32m 12s" / "1h 5m". */
export function formatCompactionElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = totalSeconds % 60;
    return seconds > 0 ? `${totalMinutes}m ${seconds}s` : `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

export type CompactionBoundary = {
  messageId: string;
  /** Index into the probed message array. */
  messageIndex: number;
  /**
   * Exclusive end index of the folded segment. Equals `messageIndex` when
   * there is no tail; otherwise the index of `tailStartId` so recent turns
   * stay visible below the strip.
   */
  foldUntilIndex: number;
  auto: boolean;
  /** Wall-clock span of the collapsed segment; null when timestamps are missing. */
  elapsedMs: number | null;
  tailStartId: string | null;
};

function messageCreatedMs(message: unknown): number | null {
  if (!message || typeof message !== "object") return null;
  const metadata = (message as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") return null;
  const opencode = (metadata as { opencode?: unknown }).opencode;
  if (!opencode || typeof opencode !== "object") return null;
  const created = (opencode as { created?: unknown }).created;
  return typeof created === "number" && Number.isFinite(created) ? created : null;
}

/**
 * Locate compaction boundaries in transcript order. Each boundary collapses
 * the segment since the previous boundary (or the first message) up to — but
 * not including — the OpenCode tail. The boundary message itself only carries
 * the marker part, so it is never rendered as a bubble — the strip replaces it.
 */
export function findCompactionBoundaries<T extends { id: string; parts: unknown[] }>(
  messages: T[],
): CompactionBoundary[] {
  const boundaries: CompactionBoundary[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    const marker = getOpencodeCompactionMarker(message);
    if (!marker) continue;

    let foldUntilIndex = index;
    if (marker.tailStartId) {
      const tailIndex = messages.findIndex((candidate) => candidate.id === marker.tailStartId);
      if (tailIndex >= 0 && tailIndex < index) {
        foldUntilIndex = tailIndex;
      }
    }

    const foldEndCreated = foldUntilIndex > 0
      ? messageCreatedMs(messages[foldUntilIndex - 1]!)
      : null;
    let segmentStartCreated: number | null = null;
    for (let probe = foldUntilIndex - 1; probe >= 0; probe -= 1) {
      if (getOpencodeCompactionMarker(messages[probe]!)) break;
      const created = messageCreatedMs(messages[probe]!);
      if (created !== null) segmentStartCreated = created;
    }

    boundaries.push({
      messageId: message.id,
      messageIndex: index,
      foldUntilIndex,
      auto: marker.auto,
      elapsedMs: foldEndCreated !== null && segmentStartCreated !== null
        ? Math.max(0, foldEndCreated - segmentStartCreated)
        : null,
      tailStartId: marker.tailStartId,
    });
  }
  return boundaries;
}

export type VisibleCompactionBoundary = CompactionBoundary & {
  /** Boundary index translated into the rendered (possibly windowed) message slice. */
  visibleIndex: number;
  /** foldUntilIndex translated into the rendered slice. */
  foldUntilVisibleIndex: number;
};

export type CompactionRow<T> =
  | { kind: "item"; item: T }
  | { kind: "boundary"; boundary: VisibleCompactionBoundary; hidden: T[] };

/**
 * Partition render items around compaction boundaries. Only pre-tail items
 * collapse under the strip; the OpenCode tail stays as normal bubbles between
 * the strip and the summary. The marker message itself is consumed by the
 * strip and never rendered as a bubble.
 */
export function buildCompactionRows<T>(
  items: T[],
  itemLastIndex: (item: T) => number,
  boundaries: VisibleCompactionBoundary[],
): Array<CompactionRow<T>> {
  const rows: Array<CompactionRow<T>> = [];
  let cursor = 0;
  for (const boundary of boundaries) {
    const foldUntil = Number.isFinite(boundary.foldUntilVisibleIndex)
      ? boundary.foldUntilVisibleIndex
      : boundary.visibleIndex;
    const hidden: T[] = [];
    while (cursor < items.length && itemLastIndex(items[cursor]!) < foldUntil) {
      hidden.push(items[cursor]!);
      cursor += 1;
    }
    if (hidden.length > 0) rows.push({ kind: "boundary", boundary, hidden });
    // Keep the OpenCode tail visible between the strip and the marker.
    while (cursor < items.length && itemLastIndex(items[cursor]!) < boundary.visibleIndex) {
      rows.push({ kind: "item", item: items[cursor]! });
      cursor += 1;
    }
    // Skip the marker message item itself — the strip replaces it.
    if (cursor < items.length && itemLastIndex(items[cursor]!) === boundary.visibleIndex) {
      cursor += 1;
    }
  }
  for (; cursor < items.length; cursor += 1) {
    rows.push({ kind: "item", item: items[cursor]! });
  }
  return rows;
}
