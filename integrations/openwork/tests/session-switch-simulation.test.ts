/**
 * Session-switch simulation.
 *
 * Mirrors the critical path when the user flips 历史对话:
 *   click → (prefetch?) → navigate → snapshot hydrate → MessageList paint
 *   …and the WodeApp recovery sweep that used to race that path.
 *
 * Asserts the Cursor/Codex-aligned behaviour we shipped:
 *   1. recovery sweep is deferred (does not hit OpenCode on the click tick)
 *   2. rapid flips cancel the previous pending sweep
 *   3. warm transcript cache skips a second full-history remap
 *   4. cold convert of a first-paint window stays bounded vs a deep dump
 */
import { describe, expect, test } from "bun:test";

import { snapshotToUIMessages } from "../src/react-app/domains/session/sync/usechat-adapter";
import { deriveRenderedSessionMessages } from "../src/react-app/domains/session/surface/session-render-state";
import { scheduleSessionHistoryRecoverySweep } from "../src/react-app/domains/wodeapp/wodeapp-vision-history-compact";
import type { OpenworkSessionSnapshot } from "../src/app/lib/openwork-server";

type FakeClient = {
  session: {
    status: (params?: { directory?: string }) => Promise<{ data?: unknown; error?: unknown }>;
    messages: (params: {
      sessionID: string;
      directory?: string;
      limit?: number;
    }) => Promise<{ data?: unknown; error?: unknown }>;
  };
  part: {
    delete: () => Promise<{ data?: unknown; error?: unknown }>;
    update: () => Promise<{ data?: unknown; error?: unknown }>;
  };
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSnapshot(sessionId: string, messageCount: number): OpenworkSessionSnapshot {
  const now = Date.now();
  const messages = Array.from({ length: messageCount }, (_, index) => {
    const messageId = `${sessionId}_msg_${index}`;
    const role = index % 2 === 0 ? "user" : "assistant";
    const parts = role === "user"
      ? [{
          id: `${messageId}_text`,
          messageID: messageId,
          sessionID: sessionId,
          type: "text" as const,
          text: `user turn ${index}: ${"商品图 ".repeat(8)}${index}`,
        }]
      : [
          {
            id: `${messageId}_text`,
            messageID: messageId,
            sessionID: sessionId,
            type: "text" as const,
            text: `assistant turn ${index}\n\n\`\`\`ts\nconst n = ${index};\nconsole.log(n);\n\`\`\`\n${"分析结论。".repeat(12)}`,
          },
          {
            id: `${messageId}_tool`,
            messageID: messageId,
            sessionID: sessionId,
            type: "tool" as const,
            tool: "bash",
            callID: `${messageId}_call`,
            state: {
              status: "completed" as const,
              input: { command: `echo turn-${index}` },
              output: `ok-${index}\n${"line\n".repeat(20)}`,
              title: "bash",
              metadata: {},
              time: { start: now + index, end: now + index + 5 },
            },
          },
        ];

    return {
      info: {
        id: messageId,
        sessionID: sessionId,
        role,
        time: { created: now + index, completed: now + index + 1 },
        ...(role === "assistant" ? { finish: "stop" as const } : {}),
      },
      parts,
    };
  });

  return {
    session: {
      id: sessionId,
      title: `Sim ${sessionId}`,
      time: { created: now, updated: now + messageCount },
    },
    messages: messages as OpenworkSessionSnapshot["messages"],
    todos: [],
    status: { type: "idle" },
  };
}

/**
 * Same reuse rule SessionSurface uses after the switch optimization:
 * if the live transcript already covers this snapshot, skip remapping.
 */
function resolveSnapshotMessagesForSwitch(input: {
  sessionId: string;
  snapshot: OpenworkSessionSnapshot | null;
  transcriptState: ReturnType<typeof snapshotToUIMessages>;
}) {
  const { snapshot, transcriptState, sessionId } = input;
  if (!snapshot || snapshot.messages.length === 0) return [] as ReturnType<typeof snapshotToUIMessages>;
  if (
    transcriptState.length >= snapshot.messages.length
    && snapshot.session.id === sessionId
  ) {
    return transcriptState;
  }
  return snapshotToUIMessages(snapshot);
}

function createCountingClient(calls: {
  status: string[];
  messages: Array<{ sessionID: string; limit?: number; atMs: number }>;
}): FakeClient {
  const started = performance.now();
  return {
    session: {
      status: async () => {
        calls.status.push("status");
        return { data: {} };
      },
      messages: async (params) => {
        calls.messages.push({
          sessionID: params.sessionID,
          limit: params.limit,
          atMs: performance.now() - started,
        });
        // Pretend the session id is idle in the status map shape the sweeper reads.
        return { data: [] };
      },
    },
    part: {
      delete: async () => ({}),
      update: async () => ({}),
    },
  };
}

describe("session switch simulation", () => {
  test("snapshot hydration preserves assistant finish metadata for final-reply authority", () => {
    const snapshot = buildSnapshot("ses_authority", 2);
    const assistantSource = snapshot.messages.find((message) => message.info.role === "assistant");
    const assistantMessage = snapshotToUIMessages(snapshot)
      .find((message) => message.role === "assistant");

    expect(assistantSource).toBeDefined();
    expect(assistantMessage?.metadata).toEqual({
      opencode: {
        created: assistantSource?.info.time.created,
        completed: assistantSource?.info.time.completed,
        finish: "stop",
      },
    });
  });

  test("recovery sweep does not touch OpenCode on the click tick", async () => {
    const calls = { status: [] as string[], messages: [] as Array<{ sessionID: string; limit?: number; atMs: number }> };
    const client = createCountingClient(calls);

    // Patch status to return idle for this session so a late run would proceed.
    client.session.status = async () => {
      calls.status.push("status");
      return { data: { ses_click: { type: "idle" } } };
    };

    scheduleSessionHistoryRecoverySweep({ client, sessionId: "ses_click" });

    await sleep(80);
    expect(calls.status).toEqual([]);
    expect(calls.messages).toEqual([]);
  });

  test("rapid history flips cancel the previous pending sweep", async () => {
    const calls = { status: [] as string[], messages: [] as Array<{ sessionID: string; limit?: number; atMs: number }> };
    const client = createCountingClient(calls);
    client.session.status = async () => {
      calls.status.push("status");
      // Always idle for whichever session is queried.
      return {
        data: {
          ses_flip_a: { type: "idle" },
          ses_flip_b: { type: "idle" },
        },
      };
    };

    scheduleSessionHistoryRecoverySweep({ client, sessionId: "ses_flip_a" });
    await sleep(20);
    scheduleSessionHistoryRecoverySweep({ client, sessionId: "ses_flip_b" });

    // Defer is 1500ms + idleCallback timeout up to 2500ms. Wait past defer.
    await sleep(2200);

    const messageSessions = calls.messages.map((item) => item.sessionID);
    expect(messageSessions).not.toContain("ses_flip_a");
    expect(messageSessions).toContain("ses_flip_b");
    expect(calls.messages.every((item) => (item.limit ?? 0) <= 120)).toBe(true);
  }, 10_000);

  test("warm transcript cache skips a second full-history remap on switch", () => {
    const snapshot = buildSnapshot("ses_warm", 72);
    const seeded = snapshotToUIMessages(snapshot);

    const coldStart = performance.now();
    const coldMessages = resolveSnapshotMessagesForSwitch({
      sessionId: "ses_warm",
      snapshot,
      transcriptState: [],
    });
    const coldMs = performance.now() - coldStart;

    const warmStart = performance.now();
    const warmMessages = resolveSnapshotMessagesForSwitch({
      sessionId: "ses_warm",
      snapshot,
      transcriptState: seeded,
    });
    const warmMs = performance.now() - warmStart;

    expect(coldMessages.length).toBeGreaterThan(0);
    expect(warmMessages).toBe(seeded);
    expect(warmMs).toBeLessThan(coldMs);
    // Warm path should be near-instant (pointer reuse), cold path does real work.
    expect(warmMs).toBeLessThan(2);
    expect(coldMs).toBeGreaterThan(warmMs);

    const rendered = deriveRenderedSessionMessages({
      transcriptState: seeded,
      snapshot,
      snapshotMessages: warmMessages,
    });
    expect(rendered.length).toBeGreaterThanOrEqual(seeded.length);
  });

  test("first-paint window convert stays cheaper than a deep 140-message dump", () => {
    const firstPaint = buildSnapshot("ses_window", 72);
    const deepHistory = buildSnapshot("ses_deep", 140);

    const paintStart = performance.now();
    const paintMessages = snapshotToUIMessages(firstPaint);
    const paintMs = performance.now() - paintStart;

    const deepStart = performance.now();
    const deepMessages = snapshotToUIMessages(deepHistory);
    const deepMs = performance.now() - deepStart;

    expect(paintMessages.length).toBeGreaterThan(0);
    expect(deepMessages.length).toBeGreaterThan(paintMessages.length);
    expect(paintMs).toBeLessThan(deepMs);

    // Soft budget: first-paint remap of 72 mixed turns should stay interactive.
    // Keep this loose for CI machines; the relative check above is the hard assert.
    expect(paintMs).toBeLessThan(250);

    console.log(
      `[session-switch-sim] convert 72=${paintMs.toFixed(1)}ms messages=${paintMessages.length}; `
      + `convert 140=${deepMs.toFixed(1)}ms messages=${deepMessages.length}; `
      + `speedup=${(deepMs / Math.max(paintMs, 0.01)).toFixed(2)}x`,
    );
  });

  test("switch critical path stays free of recovery IPC while snapshot remaps", async () => {
    const calls = { status: [] as string[], messages: [] as Array<{ sessionID: string; limit?: number; atMs: number }> };
    const client = createCountingClient(calls);
    client.session.status = async () => {
      calls.status.push("status");
      return { data: { ses_critical: { type: "idle" } } };
    };

    const snapshot = buildSnapshot("ses_critical", 72);

    // User clicks history → schedule hygiene (deferred) + hydrate snapshot (sync).
    scheduleSessionHistoryRecoverySweep({ client, sessionId: "ses_critical" });
    const hydrateStart = performance.now();
    const uiMessages = snapshotToUIMessages(snapshot);
    const hydrateMs = performance.now() - hydrateStart;
    const rendered = deriveRenderedSessionMessages({
      transcriptState: [],
      snapshot,
      snapshotMessages: uiMessages,
    });

    // Critical path finished; recovery must still be pending.
    expect(calls.messages).toEqual([]);
    expect(calls.status).toEqual([]);
    expect(rendered.length).toBe(uiMessages.length);
    expect(hydrateMs).toBeLessThan(250);

    console.log(
      `[session-switch-sim] critical-path hydrate=${hydrateMs.toFixed(1)}ms `
      + `messages=${rendered.length}; recovery IPC during hydrate=${calls.messages.length}`,
    );
  });
});
