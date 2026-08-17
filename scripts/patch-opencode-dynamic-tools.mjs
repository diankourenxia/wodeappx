#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const wodeappxRoot = path.resolve(scriptDir, "..");
const overlayPath = path.join(
  wodeappxRoot,
  "integrations",
  "opencode",
  "dynamic-tool-discovery.ts",
);
const overlayTestPath = path.join(
  wodeappxRoot,
  "integrations",
  "opencode",
  "dynamic-tool-discovery.test.ts",
);
const bashBackgroundDetachPath = path.join(
  wodeappxRoot,
  "integrations",
  "opencode",
  "bash-background-detach.ts",
);
const bashBackgroundDetachTestPath = path.join(
  wodeappxRoot,
  "integrations",
  "opencode",
  "bash-background-detach.test.ts",
);
const stickyLeasePath = path.join(
  wodeappxRoot,
  "integrations",
  "opencode",
  "session-sticky-leases.ts",
);
const productDirectToolsPath = path.join(
  wodeappxRoot,
  "integrations",
  "opencode",
  "wodeapp-capability-preload.ts",
);
const permissionOverlayPath = path.join(
  wodeappxRoot,
  "integrations",
  "opencode",
  "session-tool-permissions.ts",
);
const permissionOverlayTestPath = path.join(
  wodeappxRoot,
  "integrations",
  "opencode",
  "session-tool-permissions.test.ts",
);
const transientNetworkOverlayPath = path.join(
  wodeappxRoot,
  "integrations",
  "opencode",
  "session-transient-network-error.ts",
);
const transientNetworkOverlayTestPath = path.join(
  wodeappxRoot,
  "integrations",
  "opencode",
  "session-transient-network-error.test.ts",
);
const eventPayloadExternalizePath = path.join(
  wodeappxRoot,
  "integrations",
  "opencode",
  "event-payload-externalize.ts",
);
const eventPayloadExternalizeTestPath = path.join(
  wodeappxRoot,
  "integrations",
  "opencode",
  "event-payload-externalize.test.ts",
);
const compactedToolStubPath = path.join(
  wodeappxRoot,
  "integrations",
  "opencode",
  "compacted-tool-stub.ts",
);
const compactedToolStubTestPath = path.join(
  wodeappxRoot,
  "integrations",
  "opencode",
  "compacted-tool-stub.test.ts",
);

function readArg(name) {
  const args = process.argv.slice(2);
  const direct = args.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function normalizeNewlines(text) {
  return String(text).replace(/\r\n/g, "\n");
}

function restoreNewlines(text, usesCrlf) {
  return usesCrlf ? String(text).replace(/\n/g, "\r\n") : text;
}

export function injectDynamicToolsImport(source) {
  const usesCrlf = String(source).includes("\r\n");
  let toolsSource = normalizeNewlines(source);
  if (!toolsSource.includes("extractLatestUserTask")) {
    if (toolsSource.includes('import { exposeDynamicTools, extractLatestUserText } from "./dynamic-tool-discovery"')) {
      toolsSource = toolsSource.replace(
        'import { exposeDynamicTools, extractLatestUserText } from "./dynamic-tool-discovery"\n',
        'import { exposeDynamicTools, extractLatestUserTask } from "./dynamic-tool-discovery"\n',
      );
    } else if (toolsSource.includes('import { exposeDynamicTools } from "./dynamic-tool-discovery"')) {
      toolsSource = toolsSource.replace(
        'import { exposeDynamicTools } from "./dynamic-tool-discovery"\n',
        'import { exposeDynamicTools, extractLatestUserTask } from "./dynamic-tool-discovery"\n',
      );
    } else if (toolsSource.includes('import { isRecord } from "@/util/record"\n')) {
      toolsSource = toolsSource.replace(
        'import { isRecord } from "@/util/record"\n',
        'import { isRecord } from "@/util/record"\nimport { exposeDynamicTools, extractLatestUserTask } from "./dynamic-tool-discovery"\n',
      );
    } else {
      throw new Error("OpenCode tools.ts missing import anchor for dynamic-tool-discovery");
    }
  }
  toolsSource = toolsSource.replace(
    'import { exposeDynamicTools, extractLatestUserTask, extractLatestUserText } from "./dynamic-tool-discovery"\n',
    'import { exposeDynamicTools, extractLatestUserTask } from "./dynamic-tool-discovery"\n',
  );
  return restoreNewlines(toolsSource, usesCrlf);
}

export function injectDynamicToolsReturn(source) {
  const usesCrlf = String(source).includes("\r\n");
  let toolsSource = normalizeNewlines(source);
  if (toolsSource.includes("  return tools\n})\n") && !toolsSource.includes("exposeDynamicTools({")) {
    toolsSource = toolsSource.replace(
      "  return tools\n})\n",
      `  const latestUserTask = extractLatestUserTask(input.messages)
  const exposed = exposeDynamicTools({
    sessionID: input.session.id,
    turnID: input.processor.message.parentID,
    tools,
    namespaces: mcpNamespaces,
    profile: input.agent.name,
    userText: latestUserTask.text,
    taskEpoch: latestUserTask.messageID,
  })
  yield* Effect.logInfo("dynamic tool exposure", {
    "session.id": input.session.id,
    "turn.id": input.processor.message.parentID,
    "assistant.id": input.processor.message.id,
    "message.id": input.processor.message.parentID,
    ...exposed.stats,
  })
  return exposed.tools
})
`,
    );
  }
  return restoreNewlines(toolsSource, usesCrlf);
}

function replaceRequired(source, before, after, filePath) {
  const usesCrlf = source.includes("\r\n");
  const normalizedSource = normalizeNewlines(source);
  const normalizedAfter = normalizeNewlines(after);
  if (normalizedSource.includes(normalizedAfter)) {
    return source;
  }
  const variants = Array.isArray(before) ? before : [before];
  for (const variant of variants) {
    const normalizedBefore = normalizeNewlines(variant);
    if (!normalizedSource.includes(normalizedBefore)) continue;
    const next = normalizedSource.replace(normalizedBefore, normalizedAfter);
    return restoreNewlines(next, usesCrlf);
  }
  throw new Error(`OpenCode patch anchor not found in ${filePath}: ${variants[0].slice(0, 120)}`);
}

async function patchFile(sourceRoot, relativePath, replacements) {
  const filePath = path.join(sourceRoot, relativePath);
  let source = await readFile(filePath, "utf8");
  for (const [before, after] of replacements) {
    source = replaceRequired(source, before, after, filePath);
  }
  await writeFile(filePath, source, "utf8");
}

async function writeGeneratedTest(sourceRoot, relativePath, source) {
  const filePath = path.join(sourceRoot, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, source, "utf8");
}

async function main() {
  const sourceRoot = path.resolve(readArg("--source") ?? "");
  if (!readArg("--source")) {
    throw new Error("Usage: patch-opencode-dynamic-tools.mjs --source <opencode checkout>");
  }

  await copyFile(
    overlayPath,
    path.join(sourceRoot, "packages", "opencode", "src", "session", "dynamic-tool-discovery.ts"),
  );
  await copyFile(
    overlayTestPath,
    path.join(sourceRoot, "packages", "opencode", "src", "session", "dynamic-tool-discovery.test.ts"),
  );
  await copyFile(
    bashBackgroundDetachPath,
    path.join(sourceRoot, "packages", "opencode", "src", "session", "bash-background-detach.ts"),
  );
  await copyFile(
    bashBackgroundDetachTestPath,
    path.join(sourceRoot, "packages", "opencode", "src", "session", "bash-background-detach.test.ts"),
  );
  await copyFile(
    stickyLeasePath,
    path.join(sourceRoot, "packages", "opencode", "src", "session", "session-sticky-leases.ts"),
  );
  await copyFile(
    productDirectToolsPath,
    path.join(sourceRoot, "packages", "opencode", "src", "session", "wodeapp-capability-preload.ts"),
  );
  await copyFile(
    permissionOverlayPath,
    path.join(sourceRoot, "packages", "opencode", "src", "session", "session-tool-permissions.ts"),
  );
  await copyFile(
    permissionOverlayTestPath,
    path.join(sourceRoot, "packages", "opencode", "src", "session", "session-tool-permissions.test.ts"),
  );
  await copyFile(
    transientNetworkOverlayPath,
    path.join(sourceRoot, "packages", "opencode", "src", "session", "session-transient-network-error.ts"),
  );
  await copyFile(
    transientNetworkOverlayTestPath,
    path.join(sourceRoot, "packages", "opencode", "src", "session", "session-transient-network-error.test.ts"),
  );
  await copyFile(
    eventPayloadExternalizePath,
    path.join(sourceRoot, "packages", "opencode", "src", "session", "event-payload-externalize.ts"),
  );
  await copyFile(
    eventPayloadExternalizeTestPath,
    path.join(sourceRoot, "packages", "opencode", "src", "session", "event-payload-externalize.test.ts"),
  );
  await copyFile(
    compactedToolStubPath,
    path.join(sourceRoot, "packages", "opencode", "src", "session", "compacted-tool-stub.ts"),
  );
  await copyFile(
    compactedToolStubTestPath,
    path.join(sourceRoot, "packages", "opencode", "src", "session", "compacted-tool-stub.test.ts"),
  );

  // PERF-05: externalize fat data:/tool payloads before durable event write.
  await patchFile(sourceRoot, "packages/opencode/src/session/session.ts", [
    [
      // OpenCode ≥1.18 (≤1.17.11 used SessionMessageID from session-message-id)
      `import { SessionMessage } from "@opencode-ai/schema/session-message"
`,
      `import { SessionMessage } from "@opencode-ai/schema/session-message"
import { externalizePartForEventStore } from "./event-payload-externalize"
`,
    ],
    [
      `    const updatePart = <T extends SessionV1.Part>(part: T): Effect.Effect<T> =>
      Effect.gen(function* () {
        yield* events.publish(SessionV1.Event.PartUpdated, {
          sessionID: part.sessionID,
          part: structuredClone(part),
          time: Date.now(),
        })
        return part
      }).pipe(Effect.withSpan("Session.updatePart"))
`,
      `    const updatePart = <T extends SessionV1.Part>(part: T): Effect.Effect<T> =>
      Effect.gen(function* () {
        // WodeAppX PERF-05: never persist megabyte data: / fat tool output into event+part.
        const sanitized = externalizePartForEventStore(part) as T
        yield* events.publish(SessionV1.Event.PartUpdated, {
          sessionID: sanitized.sessionID,
          part: structuredClone(sanitized),
          time: Date.now(),
        })
        return sanitized
      }).pipe(Effect.withSpan("Session.updatePart"))
`,
    ],
    [
      `import { externalizePartForEventStore } from "./event-payload-externalize"
`,
      `import { externalizePartForEventStore } from "./event-payload-externalize"
import { inheritStickyLeasesOnFork } from "./dynamic-tool-discovery"
`,
    ],
    // OpenCode 1.18.16+: fork uses msgs.slice(0, target)
    [
      `      for (const msg of msgs.slice(0, target < 0 ? msgs.length : target)) {
        const newID = MessageID.ascending()
        idMap.set(msg.info.id, newID)

        const parentID = msg.info.role === "assistant" && msg.info.parentID ? idMap.get(msg.info.parentID) : undefined
        const cloned = yield* updateMessage({
          ...msg.info,
          sessionID: session.id,
          id: newID,
          ...(parentID && { parentID }),
        })

        for (const part of msg.parts) {
          const p: SessionV1.Part = {
            ...part,
            id: PartID.ascending(),
            messageID: cloned.id,
            sessionID: session.id,
          }
          if (p.type === "compaction" && p.tail_start_id) {
            p.tail_start_id = idMap.get(p.tail_start_id)
          }
          yield* updatePart(p)
        }
      }
      return session
    })
`,
      `      for (const msg of msgs.slice(0, target < 0 ? msgs.length : target)) {
        const newID = MessageID.ascending()
        idMap.set(msg.info.id, newID)

        const parentID = msg.info.role === "assistant" && msg.info.parentID ? idMap.get(msg.info.parentID) : undefined
        const cloned = yield* updateMessage({
          ...msg.info,
          sessionID: session.id,
          id: newID,
          ...(parentID && { parentID }),
        })

        for (const part of msg.parts) {
          const p: SessionV1.Part = {
            ...part,
            id: PartID.ascending(),
            messageID: cloned.id,
            sessionID: session.id,
          }
          if (p.type === "compaction" && p.tail_start_id) {
            p.tail_start_id = idMap.get(p.tail_start_id)
          }
          yield* updatePart(p)
        }
      }
      // WodeAppX: forked transcript inherits sticky deferred tools (publish/create/…).
      inheritStickyLeasesOnFork(input.sessionID, session.id)
      return session
    })
`,
    ],
  ]);

  await patchFile(sourceRoot, "packages/opencode/src/session/prompt.ts", [
    [
      `import { MessageV2 } from "./message-v2"
`,
      `import { MessageV2 } from "./message-v2"
import { externalizeRawBytesToFileUrl, shouldSkipDataUrlInline } from "./event-payload-externalize"
`,
    ],
    [
      `              return [
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: \`Called the Read tool with the following input: {"filePath":"\${filepath}"}\`,
                },
                {
                  id: part.id,
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "file",
                  url:
                    \`data:\${mime};base64,\` +
                    Buffer.from(yield* fsys.readFile(filepath).pipe(Effect.catch(Effect.die))).toString("base64"),
                  mime,
                  filename: part.filename!,
                  source: part.source,
                },
              ]
`,
      `              {
                const bytes = Buffer.from(yield* fsys.readFile(filepath).pipe(Effect.catch(Effect.die)))
                // WodeAppX PERF-05: video/audio/PDF → session-media file:// (never data: into event DB).
                // Filename matters: octet-stream + .mp4 must not re-inline (178MB meeting-video case).
                const url = shouldSkipDataUrlInline(mime, part.filename)
                  ? externalizeRawBytesToFileUrl({
                      sessionID: input.sessionID,
                      bytes,
                      mime,
                      filename: part.filename!,
                    })
                  : \`data:\${mime};base64,\` + bytes.toString("base64")
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: \`Called the Read tool with the following input: {"filePath":"\${filepath}"}\`,
                  },
                  {
                    id: part.id,
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "file",
                    url,
                    mime,
                    filename: part.filename!,
                    source: part.source,
                  },
                ]
              }
`,
    ],
  ]);

  // OpenCode #37124: default to one subagent level unless users opt in.
  await patchFile(sourceRoot, "packages/core/src/v1/config/config.ts", [
    [
      `  default_agent: Schema.optional(Schema.String).annotate({
    description:
      "Default agent to use when none is specified. Must be a primary agent. Falls back to 'build' if not set or if the specified agent is invalid.",
  }),
  username: Schema.optional(Schema.String).annotate({
`,
      `  default_agent: Schema.optional(Schema.String).annotate({
    description:
      "Default agent to use when none is specified. Must be a primary agent. Falls back to 'build' if not set or if the specified agent is invalid.",
  }),
  subagent_depth: Schema.optional(NonNegativeInt).annotate({
    description: "Maximum subagent nesting depth. Defaults to 1, which prevents subagents from launching subagents.",
  }),
  username: Schema.optional(Schema.String).annotate({
`,
    ],
  ]);

  await patchFile(sourceRoot, "packages/sdk/js/src/v2/gen/types.gen.ts", [
    [
      `  default_agent?: string
  username?: string
`,
      `  default_agent?: string
  subagent_depth?: number
  username?: string
`,
    ],
  ]);

  await patchFile(sourceRoot, "packages/opencode/src/tool/task.ts", [
    [
      `      if (!ctx.extra?.bypassAgentCheck) {
`,
      `      const parent = yield* sessions.get(ctx.sessionID)
      let current = parent
      let depth = 0
      while (current.parentID) {
        depth++
        current = yield* sessions.get(current.parentID)
      }
      if (depth >= (cfg.subagent_depth ?? 1)) {
        return yield* Effect.fail(
          new Error(
            \`Subagent depth limit reached (\${cfg.subagent_depth ?? 1}). Increase "subagent_depth" to allow nested subagents.\`,
          ),
        )
      }

      if (!ctx.extra?.bypassAgentCheck) {
`,
    ],
    [
      `      const session = params.task_id
        ? yield* sessions.get(SessionID.make(params.task_id)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const parent = yield* sessions.get(ctx.sessionID)
      const childPermission = deriveSubagentSessionPermission({
`,
      `      const session = params.task_id
        ? yield* sessions.get(SessionID.make(params.task_id)).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
        : undefined
      const childPermission = deriveSubagentSessionPermission({
`,
    ],
  ]);

  await patchFile(sourceRoot, "packages/opencode/test/tool/task.test.ts", [
    [
      `  it.instance(
    "execute shapes child permissions for task, todowrite, and primary tools",
`,
      `  it.instance("prevents subagents from launching subagents by default", () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const { chat, assistant } = yield* seed()
      const child = yield* sessions.create({ parentID: chat.id, title: "child" })
      const nestedAssistant = yield* sessions.updateMessage({
        ...assistant,
        id: MessageID.ascending(),
        parentID: MessageID.ascending(),
        sessionID: child.id,
      })
      const tool = yield* TaskTool
      const def = yield* tool.init()
      let asked = false

      const exit = yield* def
        .execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: child.id,
            messageID: nestedAssistant.id,
            agent: "general",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.sync(() => (asked = true)),
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(asked).toBe(false)
      expect(yield* sessions.children(child.id)).toHaveLength(0)
    }),
  )

  it.instance(
    "allows nested subagents up to the configured depth",
    () =>
      Effect.gen(function* () {
        const sessions = yield* Session.Service
        const { chat, assistant } = yield* seed()
        const child = yield* sessions.create({ parentID: chat.id, title: "child" })
        const nestedAssistant = yield* sessions.updateMessage({
          ...assistant,
          id: MessageID.ascending(),
          parentID: MessageID.ascending(),
          sessionID: child.id,
        })
        const tool = yield* TaskTool
        const def = yield* tool.init()

        const result = yield* def.execute(
          {
            description: "inspect bug",
            prompt: "look into the cache key path",
            subagent_type: "general",
          },
          {
            sessionID: child.id,
            messageID: nestedAssistant.id,
            agent: "general",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )

        expect((yield* sessions.get(result.metadata.sessionId)).parentID).toBe(child.id)
      }),
    { config: { subagent_depth: 2 } },
  )

  it.instance(
    "execute shapes child permissions for task, todowrite, and primary tools",
`,
    ],
  ]);

  // OpenCode #39697: a JSON-RPC error is still a terminal SSE response.
  await patchFile(sourceRoot, "patches/@modelcontextprotocol%2Fsdk@1.29.0.patch", [
    [
      `+++ b/dist/cjs/client/streamableHttp.js
@@ -290,7 +290,38 @@ class StreamableHTTPClientTransport {
`,
      `+++ b/dist/cjs/client/streamableHttp.js
@@ -204,7 +204,7 @@ class StreamableHTTPClientTransport {
                     if (!event.event || event.event === 'message') {
                         try {
                             const message = types_js_1.JSONRPCMessageSchema.parse(JSON.parse(event.data));
-                            if ((0, types_js_1.isJSONRPCResultResponse)(message)) {
+                            if ((0, types_js_1.isJSONRPCResultResponse)(message) || (0, types_js_1.isJSONRPCErrorResponse)(message)) {
                                 // Mark that we received a response - no need to reconnect for this request
                                 receivedResponse = true;
                                 if (replayMessageId !== undefined) {
@@ -290,7 +290,38 @@ class StreamableHTTPClientTransport {
`,
    ],
    [
      `+import { isInitializedNotification, isInitializeRequest, isJSONRPCRequest, isJSONRPCResultResponse, JSONRPCMessageSchema } from '../types.js';
`,
      `+import { isInitializedNotification, isInitializeRequest, isJSONRPCErrorResponse, isJSONRPCRequest, isJSONRPCResultResponse, JSONRPCMessageSchema } from '../types.js';
`,
    ],
    [
      ` // Default reconnection options for StreamableHTTP connections
@@ -286,7 +286,38 @@ export class StreamableHTTPClientTransport {
`,
      ` // Default reconnection options for StreamableHTTP connections
@@ -200,7 +200,7 @@ export class StreamableHTTPClientTransport {
                     if (!event.event || event.event === 'message') {
                         try {
                             const message = JSONRPCMessageSchema.parse(JSON.parse(event.data));
-                            if (isJSONRPCResultResponse(message)) {
+                            if (isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)) {
                                 // Mark that we received a response - no need to reconnect for this request
                                 receivedResponse = true;
                                 if (replayMessageId !== undefined) {
@@ -286,7 +286,38 @@ export class StreamableHTTPClientTransport {
`,
    ],
  ]);

  await writeGeneratedTest(
    sourceRoot,
    "packages/opencode/test/mcp/transport.test.ts",
    `import { expect, test } from "bun:test"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

test("does not reconnect an SSE stream after a JSON-RPC error response", async () => {
  let requests = 0
  const transport = new StreamableHTTPClientTransport(new URL("http://mcp.invalid"), {
    fetch: async () => {
      requests += 1
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("id: prime\\nretry: 1\\ndata:\\n\\n"))
            controller.enqueue(
              new TextEncoder().encode(
                'id: error\\ndata: {"jsonrpc":"2.0","error":{"code":-32601,"message":"Method not found"},"id":1}\\n\\n',
              ),
            )
            controller.close()
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      )
    },
    reconnectionOptions: {
      initialReconnectionDelay: 1,
      maxReconnectionDelay: 1,
      reconnectionDelayGrowFactor: 1,
      maxRetries: 2,
    },
  })

  await transport.start()
  await transport.send({ jsonrpc: "2.0", method: "resources/list", id: 1 })
  await Bun.sleep(25)
  await transport.close()

  expect(requests).toBe(1)
})
`,
  );

  // OpenCode #35671: route GLM/Z.AI overflow through normal compaction.
  await patchFile(sourceRoot, "packages/llm/src/provider-error.ts", [
    [
      `  /input token count.*exceeds the maximum/i,
`,
      `  /input token count.*exceeds the maximum/i,
  /tokens in request more than max tokens allowed/i,
`,
    ],
  ]);

  await writeGeneratedTest(
    sourceRoot,
    "packages/llm/test/provider-error.test.ts",
    `import { describe, expect, test } from "bun:test"
import { isContextOverflow } from "../src"

describe("provider error classification", () => {
  test("classifies Z.AI GLM token limit messages as context overflow", () => {
    expect(isContextOverflow("tokens in request more than max tokens allowed")).toBe(true)
  })
})
`,
  );

  await patchFile(sourceRoot, "packages/opencode/src/session/message-v2.ts", [
    [
      'import { errorMessage } from "@/util/error"\n',
      'import { errorMessage } from "@/util/error"\nimport {\n  isTransientNetworkErrorMessage,\n  transientNetworkErrorMessage,\n} from "./session-transient-network-error"\n',
    ],
    [
      `    case e instanceof Error:
      return new NamedError.Unknown({ message: errorMessage(e) }, { cause: e }).toObject()
`,
      `    case e instanceof Error && isTransientNetworkErrorMessage(e.message):
      return new APIError(
        {
          message: transientNetworkErrorMessage(e),
          isRetryable: true,
          metadata: {
            code: "TRANSIENT_NETWORK",
            message: e.message,
          },
        },
        { cause: e },
      ).toObject()
    case e instanceof Error:
      return new NamedError.Unknown({ message: errorMessage(e) }, { cause: e }).toObject()
`,
    ],
  ]);

  await patchFile(sourceRoot, "packages/opencode/src/session/retry.ts", [
    [
      'import { isRecord } from "@/util/record"\n',
      'import { isRecord } from "@/util/record"\nimport {\n  TRANSIENT_NETWORK_RETRY_MAX_ATTEMPTS,\n  isTransientNetworkErrorMessage,\n} from "./session-transient-network-error"\n',
    ],
    [
      [
        // OpenCode ≤1.17.11
        `  // Check for rate limit patterns in plain text error messages
  const msg = isRecord(error.data) ? error.data.message : undefined
  if (typeof msg === "string") {
    const lower = msg.toLowerCase()
    if (
      lower.includes("rate increased too quickly") ||
      lower.includes("rate limit") ||
      lower.includes("too many requests")
    ) {
      return { message: msg }
    }
  }
`,
        // OpenCode ≥1.18.14 consolidated retryable message patterns
        `  if (matchesRetryableMessage(message)) return { message }
  return undefined
`,
      ],
      `  if (matchesRetryableMessage(message)) return { message }
  if (isTransientNetworkErrorMessage(message)) return { message }
  return undefined
`,
    ],
    [
      `      const retry = retryable(error, opts.provider)
      if (!retry) return Cause.done(meta.attempt)
      return Effect.gen(function* () {
        const wait = delay(meta.attempt, SessionV1.APIError.isInstance(error) ? error : undefined)
`,
      `      const retry = retryable(error, opts.provider)
      if (!retry) return Cause.done(meta.attempt)
      if (
        isTransientNetworkErrorMessage(retry.message) &&
        meta.attempt >= TRANSIENT_NETWORK_RETRY_MAX_ATTEMPTS
      ) {
        return Cause.done(meta.attempt)
      }
      return Effect.gen(function* () {
        const wait = delay(meta.attempt, SessionV1.APIError.isInstance(error) ? error : undefined)
`,
    ],
  ]);

  await patchFile(sourceRoot, "packages/opencode/test/session/retry.test.ts", [
    [
      `    expect(SessionRetry.retryable(result, retryProvider)).toEqual({
      message: "An error occurred while processing your request.",
    })
  })
})
`,
      `    expect(SessionRetry.retryable(result, retryProvider)).toEqual({
      message: "An error occurred while processing your request.",
    })
  })

  test("converts certificate verification errors to retryable APIError", () => {
    const result = MessageV2.fromError(new Error("unknown certificate verification error"), { providerID })
    expect(SessionV1.APIError.isInstance(result)).toBe(true)
    if (!SessionV1.APIError.isInstance(result)) throw new Error("expected APIError")
    expect(result.data.isRetryable).toBe(true)
    expect(result.data.message).toBe("TLS certificate verification failed")
    expect(SessionRetry.retryable(result, retryProvider)).toEqual({
      message: "TLS certificate verification failed",
    })
  })
})
`,
    ],
  ]);

  {
    const toolsPath = path.join(sourceRoot, "packages/opencode/src/session/tools.ts");
    const rawTools = await readFile(toolsPath, "utf8");
    const usesCrlf = rawTools.includes("\r\n");
    let toolsSource = normalizeNewlines(injectDynamicToolsImport(rawTools));
    if (
      toolsSource.includes("namespaces: mcpNamespaces,\n    profile: input.agent.name,\n  })")
      && !toolsSource.includes("userText: extractLatestUserText(input.messages)")
    ) {
      toolsSource = toolsSource.replace(
        `  const latestUserTask = extractLatestUserTask(input.messages)
  const exposed = exposeDynamicTools({
    sessionID: input.session.id,
    turnID: input.processor.message.parentID,
    tools,
    namespaces: mcpNamespaces,
    profile: input.agent.name,
  })
`,
        `  const exposed = exposeDynamicTools({
    sessionID: input.session.id,
    turnID: input.processor.message.parentID,
    tools,
    namespaces: mcpNamespaces,
    profile: input.agent.name,
    userText: latestUserTask.text,
    taskEpoch: latestUserTask.messageID,
  })
`,
      );
    }
    if (
      toolsSource.includes("  const exposed = exposeDynamicTools({")
      && !toolsSource.includes("  const latestUserTask = extractLatestUserTask(input.messages)")
    ) {
      toolsSource = toolsSource.replace(
        "  const exposed = exposeDynamicTools({",
        "  const latestUserTask = extractLatestUserTask(input.messages)\n  const exposed = exposeDynamicTools({",
      );
    }
    if (toolsSource.includes("    userText: extractLatestUserText(input.messages),")) {
      toolsSource = toolsSource.replace(
        "    userText: extractLatestUserText(input.messages),",
        "    userText: latestUserTask.text,\n    taskEpoch: latestUserTask.messageID,",
      );
    }
    await writeFile(toolsPath, restoreNewlines(toolsSource, usesCrlf), "utf8");
  }

  await patchFile(sourceRoot, "packages/opencode/src/session/tools.ts", [
    [
      // OpenCode ≥1.18; ≤1.17.11 used `item` as the tool value directly.
      '  for (const [key, entry] of Object.entries(yield* mcp.tools())) {\n',
      '  const mcpNamespaces = yield* mcp.instructions()\n\n  for (const [key, entry] of Object.entries(yield* mcp.tools())) {\n',
    ],
  ]);
  {
    const toolsPath = path.join(sourceRoot, "packages/opencode/src/session/tools.ts");
    const toolsSource = injectDynamicToolsReturn(await readFile(toolsPath, "utf8"));
    await writeFile(toolsPath, toolsSource, "utf8");
  }

  await patchFile(sourceRoot, "packages/opencode/src/session/processor.ts", [
    [
      `    const create = Effect.fn("SessionProcessor.create")(function* (input: Input) {
      // Pre-capture snapshot before the LLM stream starts. The AI SDK
      // may execute tools internally before emitting start-step events,
      // so capturing inside the event handler can be too late.
      const initialSnapshot = yield* snapshot.track()
      const ctx: ProcessorContext = {
        assistantMessage: input.assistantMessage,
        sessionID: input.sessionID,
        model: input.model,
        toolcalls: {},
        shouldBreak: false,
        snapshot: initialSnapshot,
`,
      `    const create = Effect.fn("SessionProcessor.create")(function* (input: Input) {
      // Do not snapshot on create. Cold git init/add of a huge worktree can take
      // minutes; greetings never need a snapshot. Capture on first tool event.
      const ctx: ProcessorContext = {
        assistantMessage: input.assistantMessage,
        sessionID: input.sessionID,
        model: input.model,
        toolcalls: {},
        shouldBreak: false,
        snapshot: undefined,
`,
    ],
    [
      `        reasoningMap: {},
      }
      let aborted = false
`,
      `        reasoningMap: {},
      }
      let toolsUsed = false
      const ensureSnapshot = Effect.fn("SessionProcessor.ensureSnapshot")(function* () {
        if (ctx.snapshot) return ctx.snapshot
        ctx.snapshot = yield* snapshot.track()
        return ctx.snapshot
      })
      let aborted = false
`,
    ],
    [
      `          case "tool-input-start":
            if (ctx.assistantMessage.summary) {
              throw new Error(\`Tool call not allowed while generating summary: \${value.name}\`)
            }
            yield* ensureToolCall(value)
            return
`,
      `          case "tool-input-start":
            if (ctx.assistantMessage.summary) {
              throw new Error(\`Tool call not allowed while generating summary: \${value.name}\`)
            }
            toolsUsed = true
            yield* ensureSnapshot()
            yield* ensureToolCall(value)
            return
`,
    ],
    [
      `          case "tool-call": {
            if (ctx.assistantMessage.summary) {
              throw new Error(\`Tool call not allowed while generating summary: \${value.name}\`)
            }
            yield* ensureToolCall(value)
`,
      `          case "tool-call": {
            if (ctx.assistantMessage.summary) {
              throw new Error(\`Tool call not allowed while generating summary: \${value.name}\`)
            }
            toolsUsed = true
            yield* ensureSnapshot()
            yield* ensureToolCall(value)
`,
    ],
    [
      `          case "step-start":
            if (!ctx.snapshot) ctx.snapshot = yield* snapshot.track()
            yield* session.updatePart({
`,
      `          case "step-start":
            yield* session.updatePart({
`,
    ],
    [
      `          case "step-finish": {
            const completedSnapshot = yield* snapshot.track()
            yield* Effect.forEach(Object.keys(ctx.reasoningMap), finishReasoning)
`,
      `          case "step-finish": {
            const completedSnapshot = toolsUsed ? yield* snapshot.track() : ctx.snapshot
            yield* Effect.forEach(Object.keys(ctx.reasoningMap), finishReasoning)
`,
    ],
    [
      `            const usage = Session.getUsage({
              model: ctx.model,
              usage: value.usage ?? new Usage({}),
              metadata: value.providerMetadata,
            })
`,
      `            const usage = Session.getUsage({
              model: ctx.model,
              usage: value.usage ?? new Usage({}),
              metadata: value.providerMetadata,
            })
            yield* Effect.logInfo("llm step usage", {
              "session.id": ctx.sessionID,
              "turn.id": ctx.assistantMessage.parentID,
              "assistant.id": ctx.assistantMessage.id,
              "llm.provider": ctx.model.providerID,
              "llm.model": ctx.model.id,
              "tokens.input": usage.tokens.input,
              "tokens.output": usage.tokens.output,
              "tokens.reasoning": usage.tokens.reasoning,
              "tokens.cache.read": usage.tokens.cache.read,
              "tokens.cache.write": usage.tokens.cache.write,
              "tokens.prompt": usage.tokens.input + usage.tokens.cache.read + usage.tokens.cache.write,
              "cache.read.provider_reported": value.usage?.cacheReadInputTokens !== undefined,
              "cache.write.provider_reported": value.usage?.cacheWriteInputTokens !== undefined,
            })
`,
    ],
  ]);

  await patchFile(sourceRoot, "packages/opencode/src/session/system.ts", [
    [
      'import { Context, Effect, Layer } from "effect"\n',
      'import { Context, Effect, Layer } from "effect"\nimport { dynamicToolDiscoveryEnabled, renderDynamicMcpContext } from "./dynamic-tool-discovery"\n',
    ],
    [
      "  readonly mcp: (agent: Agent.Info, permission?: PermissionV1.Ruleset) => Effect.Effect<string | undefined>\n",
      "  readonly mcp: (agent: Agent.Info, permission?: PermissionV1.Ruleset, visibleToolIDs?: ReadonlySet<string>) => Effect.Effect<string | undefined>\n",
    ],
    [
      '      mcp: Effect.fn("SystemPrompt.mcp")(function* (agent: Agent.Info, permission?: PermissionV1.Ruleset) {\n',
      '      mcp: Effect.fn("SystemPrompt.mcp")(function* (agent: Agent.Info, permission?: PermissionV1.Ruleset, visibleToolIDs?: ReadonlySet<string>) {\n',
    ],
    [
      `        if (instructions.length === 0) return

        return [
`,
      `        if (instructions.length === 0) return
        if (dynamicToolDiscoveryEnabled() && visibleToolIDs) {
          return renderDynamicMcpContext({
            namespaces: instructions,
            visibleToolIDs,
          })
        }

        return [
`,
    ],
  ]);

  await patchFile(sourceRoot, "packages/opencode/src/session/prompt.ts", [
    [
      'import { LLMEvent } from "@opencode-ai/llm"\n',
      'import { LLMEvent } from "@opencode-ai/llm"\nimport { extractLatestUserText, isLeanRuntimeProfile, isSmallTalkSession, resolveWorkspaceIdentitySystem } from "./dynamic-tool-discovery"\nimport { isLegacyWodeAppToolVisibilitySnapshot } from "./session-tool-permissions"\n',
    ],
    [
      [
        `      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      yield* revert.cleanup(session)
      const message = yield* createUserMessage(input)
      yield* sessions.touch(input.sessionID)

      const permissions: PermissionV1.Rule[] = []
      for (const [t, enabled] of Object.entries(input.tools ?? {})) {
        permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
      }
      if (permissions.length > 0) {
        session.permission = permissions
        yield* sessions.setPermission({ sessionID: session.id, permission: permissions })
      }
`,
        `      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      if (isLegacyWodeAppToolVisibilitySnapshot(session.permission)) {
        const removedRuleCount = session.permission?.length ?? 0
        session.permission = []
        yield* sessions.setPermission({ sessionID: session.id, permission: [] })
        yield* Effect.logWarning("cleared legacy WodeAppX tool visibility permission snapshot", {
          "session.id": session.id,
          "permission.rules.removed": removedRuleCount,
        })
      }
      if (Object.keys(input.tools ?? {}).length > 0) {
        yield* Effect.logWarning("ignored deprecated prompt tool visibility map", {
          "session.id": session.id,
          "prompt.tools.count": Object.keys(input.tools ?? {}).length,
        })
      }
      yield* revert.cleanup(session)
      const message = yield* createUserMessage(input)
      yield* sessions.touch(input.sessionID)
`,
      ],
      `      const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
      if (isLegacyWodeAppToolVisibilitySnapshot(session.permission)) {
        const removedRuleCount = session.permission?.length ?? 0
        session.permission = []
        yield* sessions.setPermission({ sessionID: session.id, permission: [] })
        yield* Effect.logWarning("cleared legacy WodeAppX tool visibility permission snapshot", {
          "session.id": session.id,
          "permission.rules.removed": removedRuleCount,
        })
      }
      const deprecatedToolVisibilityCount = Object.keys(input.tools ?? {}).length
      if (deprecatedToolVisibilityCount > 0) {
        yield* Effect.logWarning("ignored deprecated prompt tool visibility map", {
          "session.id": session.id,
          "prompt.tools.count": deprecatedToolVisibilityCount,
        })
      }
      const promptInput = deprecatedToolVisibilityCount > 0
        ? { ...input, tools: undefined }
        : input
      yield* revert.cleanup(session)
      const message = yield* createUserMessage(promptInput)
      yield* sessions.touch(input.sessionID)
`,
    ],
    [
      "              sys.mcp(agent, session.permission),\n",
      "              sys.mcp(agent, session.permission, new Set(Object.keys(tools))),\n",
    ],
    [
      `            const [skills, env, instructions, mcpInstructions, modelMsgs] = yield* Effect.all([
              sys.skills(agent),
              sys.environment(model),
              instruction.system().pipe(Effect.orDie),
              sys.mcp(agent, session.permission, new Set(Object.keys(tools))),
              MessageV2.toModelMessagesEffect(msgs, model),
            ])
`,
      `            const leanRuntimeContext = isLeanRuntimeProfile(agent.name) || isSmallTalkSession(msgs)
            const [skills, env, instructions, mcpInstructions, modelMsgs] = yield* Effect.all([
              leanRuntimeContext
                ? Effect.succeed<string | undefined>(undefined)
                : sys.skills(agent),
              sys.environment(model),
              leanRuntimeContext
                ? Effect.succeed<string[]>([])
                : instruction.system().pipe(Effect.orDie),
              sys.mcp(agent, session.permission, new Set(Object.keys(tools))),
              MessageV2.toModelMessagesEffect(msgs, model),
            ])
            yield* Effect.logInfo("runtime context exposure", {
              "session.id": sessionID,
              "turn.id": lastUser.id,
              "runtime.profile": isLeanRuntimeProfile(agent.name)
                ? agent.name
                : isSmallTalkSession(msgs)
                  ? "small-talk"
                  : "default",
              "context.repository_instructions": instructions.length,
              "context.skills": skills ? 1 : 0,
              "context.mcp_chars": mcpInstructions?.length ?? 0,
              "context.user_system_chars": lastUser.system?.length ?? 0,
            })
`,
    ],
    [
      `            const system = [
              ...env,
              ...instructions,
              ...(mcpInstructions ? [mcpInstructions] : []),
              ...(skills ? [skills] : []),
            ]
            const format = lastUser.format ?? { type: "text" as const }
`,
      `            const system = [
              ...env,
              ...instructions,
              ...(mcpInstructions ? [mcpInstructions] : []),
              ...(skills ? [skills] : []),
            ]
            const workspaceIdentity = resolveWorkspaceIdentitySystem({
              directory: ctx.directory,
              userText: extractLatestUserText(msgs),
            })
            if (workspaceIdentity) system.push(workspaceIdentity)
            const format = lastUser.format ?? { type: "text" as const }
`,
    ],
  ]);

  await patchFile(sourceRoot, "packages/opencode/script/build.ts", [
    [
      'const skipEmbedWebUi = process.argv.includes("--skip-embed-web-ui")\n',
      `const skipEmbedWebUi = process.argv.includes("--skip-embed-web-ui")
const requestedTarget = process.argv.find((arg) => arg.startsWith("--target="))?.slice("--target=".length)
`,
    ],
    [
      `const targets = singleFlag
  ? allTargets.filter((item) => {
`,
      `const targets = requestedTarget
  ? allTargets.filter((item) => {
      const triple = [
        item.arch === "arm64" ? "aarch64" : "x86_64",
        item.os === "darwin" ? "apple-darwin" : item.os === "win32" ? "pc-windows-msvc" : "unknown-linux-gnu",
      ].join("-")
      if (triple !== requestedTarget) return false
      return requestedTarget.includes("x86_64") ? item.avx2 === false : item.avx2 !== false && item.abi === undefined
    })
  : singleFlag
  ? allTargets.filter((item) => {
`,
    ],
  ]);

  // WodeAppX: prune tool dumps inside the active turn (Codex-like).
  // Upstream skips the newest 2 user turns (`turns < 2`), so a long explore
  // chain (50+ bash/read) never clears until two later prompts — context
  // swells and each step gets slower. Keep PRUNE_PROTECT newest tool tokens;
  // rewrite older outputs to conclusion stubs (paths/commands/excerpts) and
  // mark time.compacted so the model does not re-pay for full dumps.
  //
  // Empiric (ses_00c083e71ffe*, 2026-08-12 offline A/B): stock
  // PRUNE_PROTECT=40k + PRUNE_MINIMUM=20k never fired (agree-turn tools ≈8k;
  // full-session tools ≈50k < 60k threshold). Lower to 8k/4k so in-turn prune
  // actually runs on coding explore; stubs retain path/command conclusions.
  await patchFile(sourceRoot, "packages/opencode/src/session/compaction.ts", [
    [
      `export const PRUNE_MINIMUM = 20_000
export const PRUNE_PROTECT = 40_000
`,
      `export const PRUNE_MINIMUM = 4_000
export const PRUNE_PROTECT = 8_000
`,
    ],
    [
      `    // goes backwards through parts until there are PRUNE_PROTECT tokens worth of tool
    // calls, then erases output of older tool calls to free context space
`,
      `    // Goes backwards through parts until there are PRUNE_PROTECT tokens worth of tool
    // calls, then erases output of older tool calls to free context space.
    // WodeAppX: also prune within the current turn (upstream skipped turns < 2),
    // and rewrite pruned output to a conclusion stub (not a blank cleared line).
`,
    ],
    [
      `import { buildPrompt } from "@opencode-ai/core/session/compaction"
`,
      `import { buildPrompt } from "@opencode-ai/core/session/compaction"
import { buildCompactedToolOutputStub } from "./compacted-tool-stub"
`,
    ],
    [
      `      let total = 0
      let pruned = 0
      const toPrune: SessionV1.ToolPart[] = []
      let turns = 0

      loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
        const msg = msgs[msgIndex]
        if (msg.info.role === "user") turns++
        if (turns < 2) continue
        if (msg.info.role === "assistant" && msg.info.summary) break loop
`,
      `      let total = 0
      let pruned = 0
      const toPrune: SessionV1.ToolPart[] = []

      loop: for (let msgIndex = msgs.length - 1; msgIndex >= 0; msgIndex--) {
        const msg = msgs[msgIndex]
        if (msg.info.role === "assistant" && msg.info.summary) break loop
`,
    ],
    [
      `      if (pruned > PRUNE_MINIMUM) {
        for (const part of toPrune) {
          if (part.state.status === "completed") {
            part.state.time.compacted = Date.now()
            yield* session.updatePart(part)
          }
        }
        yield* Effect.logInfo("pruned", { count: toPrune.length })
      }
`,
      `      if (pruned > PRUNE_MINIMUM) {
        for (const part of toPrune) {
          if (part.state.status === "completed") {
            // Keep useful conclusions (path/command + excerpt); drop raw dump.
            part.state.output = buildCompactedToolOutputStub({
              tool: part.tool,
              input: part.state.input,
              output: part.state.output,
              title: typeof part.state.title === "string" ? part.state.title : undefined,
            })
            part.state.time.compacted = Date.now()
            yield* session.updatePart(part)
          }
        }
        yield* Effect.logInfo("pruned", { count: toPrune.length })
      }
`,
    ],
  ]);

  // Model path: compacted tools expose conclusion stubs, not a blank cleared line.
  await patchFile(sourceRoot, "packages/opencode/src/session/message-v2.ts", [
    [
      'import { errorMessage } from "@/util/error"\n',
      'import { errorMessage } from "@/util/error"\nimport { modelFacingCompactedToolOutput } from "./compacted-tool-stub"\n',
    ],
    [
      `          if (part.state.status === "completed") {
            const outputText = part.state.time.compacted
              ? "[Old tool result content cleared]"
              : truncateToolOutput(part.state.output, options?.toolOutputMaxChars)
`,
      `          if (part.state.status === "completed") {
            const outputText = part.state.time.compacted
              ? modelFacingCompactedToolOutput(part)
              : truncateToolOutput(part.state.output, options?.toolOutputMaxChars)
`,
    ],
  ]);

  await patchFile(sourceRoot, "packages/opencode/test/session/message-v2.test.ts", [
    [
      `            output: { type: "text", value: "[Old tool result content cleared]" },
`,
      `            output: {
              type: "text",
              value: expect.stringContaining("[WodeApp compacted tool]"),
            },
`,
    ],
  ]);

  // Codex-style hard gate: Truncate.output must run unless the tool already
  // applied Truncate.limits/output itself. Upstream skipped whenever
  // `metadata.truncated !== undefined`, but read/glob/grep use that field for
  // pagination — so they bypassed managed tool_output (8KB/80 lines).
  // Split the signal: only `truncateHandled: true` opts out (shell sets it).
  await patchFile(sourceRoot, "packages/opencode/src/tool/tool.ts", [
    [
      `          const result = yield* execute(decoded as Schema.Schema.Type<Parameters>, ctx)
          if (result.metadata.truncated !== undefined) {
            return result
          }
`,
      `          const result = yield* execute(decoded as Schema.Schema.Type<Parameters>, ctx)
          // WodeAppX: only skip when the tool already applied Truncate.limits/output.
          // Do not treat pagination \`truncated\` (read/glob/grep) as an opt-out.
          if (result.metadata.truncateHandled === true) {
            return result
          }
`,
    ],
  ]);

  await patchFile(sourceRoot, "packages/opencode/src/tool/shell.ts", [
    [
      `      return {
        title: input.command,
        metadata: {
          output: last || preview(output),
          exit: code,
          truncated: cut,
          ...(cut && file ? { outputPath: file } : {}),
        },
        output,
      }
`,
      `      return {
        title: input.command,
        metadata: {
          output: last || preview(output),
          exit: code,
          truncated: cut,
          // Already applied Truncate.limits (streaming + tail); skip wrap Truncate.output.
          truncateHandled: true,
          ...(cut && file ? { outputPath: file } : {}),
        },
        output,
      }
`,
    ],
  ]);

  // Empiric live A/B (2026-08-12): prune was only invoked after the whole prompt
  // loop exits (`prompt.ts` end-of-turn fork). Long explore hung or finished with
  // 100k+ tool chars but stubbed=0 mid-turn because steps never saw prune. Await
  // prune on each "continue" so the next model call gets stubs.
  await patchFile(sourceRoot, "packages/opencode/src/session/prompt.ts", [
    [
      `          if (outcome === "break") break
          continue
        }

        yield* compaction.prune({ sessionID }).pipe(Effect.ignore, Effect.forkIn(scope))
`,
      `          if (outcome === "break") break
          // WodeAppX: await prune between steps so mid-turn explore does not swell.
          // Upstream only forks prune after the whole loop exits.
          yield* compaction.prune({ sessionID })
          continue
        }

        yield* compaction.prune({ sessionID }).pipe(Effect.ignore, Effect.forkIn(scope))
`,
    ],
  ]);

  // Full LLM compaction: insist summary sections keep durable tool findings.
  // OpenCode ≤1.17 used Critical Context; ≥1.18.16 uses Important Details (+ symbols/URLs in Rules).
  await patchFile(sourceRoot, "packages/core/src/session/compaction.ts", [
    [
      [
        `Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, commands, error strings, and identifiers when known.
- Do not mention the summary process or that context was compacted.`,
        `Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers when known.
- Do not mention the summary process or that context was compacted.`,
      ],
      `Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers when known.
- When prior turns used tools, put durable findings under Important Details / Critical Context and Relevant Files (paths that mattered, errors, decisions). Do not list every failed search or raw tool dump.
- Do not mention the summary process or that context was compacted.`,
    ],
  ]);

  await writeGeneratedTest(
    sourceRoot,
    "packages/opencode/test/session/compaction-in-turn-prune.test.ts",
    `import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

test("WodeAppX prune walks the current turn (no turns < 2 skip)", () => {
  const source = readFileSync(
    path.join(import.meta.dir, "../../src/session/compaction.ts"),
    "utf8",
  )
  expect(source).not.toContain("if (turns < 2) continue")
  expect(source).toContain("also prune within the current turn")
  expect(source).toContain("buildCompactedToolOutputStub")
  expect(source).toContain("export const PRUNE_PROTECT = 8_000")
  expect(source).toContain("export const PRUNE_MINIMUM = 4_000")
})

test("WodeAppX message-v2 uses compacted tool conclusion stubs", () => {
  const source = readFileSync(
    path.join(import.meta.dir, "../../src/session/message-v2.ts"),
    "utf8",
  )
  expect(source).toContain("modelFacingCompactedToolOutput")
  expect(source).not.toContain('? "[Old tool result content cleared]"')
})

test("WodeAppX awaits prune between prompt loop steps", () => {
  const source = readFileSync(
    path.join(import.meta.dir, "../../src/session/prompt.ts"),
    "utf8",
  )
  expect(source).toContain("await prune between steps so mid-turn explore does not swell")
  expect(source).toContain("yield* compaction.prune({ sessionID })")
})

test("WodeAppX Truncate gate uses truncateHandled not pagination truncated", () => {
  const tool = readFileSync(
    path.join(import.meta.dir, "../../src/tool/tool.ts"),
    "utf8",
  )
  const shell = readFileSync(
    path.join(import.meta.dir, "../../src/tool/shell.ts"),
    "utf8",
  )
  expect(tool).toContain("truncateHandled === true")
  expect(tool).not.toContain("if (result.metadata.truncated !== undefined)")
  expect(shell).toContain("truncateHandled: true")
})
`,
  );

  await writeGeneratedTest(
    sourceRoot,
    "packages/opencode/test/tool/truncate-handled-gate.runtime.test.ts",
    `import { describe, expect } from "bun:test"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { filesystem } from "@opencode-ai/core/effect/app-node-platform"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Effect, Schema } from "effect"
import { Agent } from "../../src/agent/agent"
import { MessageID, SessionID } from "../../src/session/schema"
import { Tool } from "@/tool/tool"
import { Truncate } from "@/tool/truncate"
import { Config } from "@/config/config"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"

const fat = Array.from({ length: 200 }, (_, i) => \`line-\${i}-\${"y".repeat(100)}\`).join("\\n")
const params = Schema.Struct({ input: Schema.String })

function makeCtx(): Tool.Context {
  return {
    sessionID: SessionID.descending(),
    messageID: MessageID.ascending(),
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata() {
      return Effect.void
    },
    ask() {
      return Effect.void
    },
  }
}

const truncIt = testEffect(
  LayerNode.compile(LayerNode.group([Truncate.node, FSUtil.node, filesystem, Config.node]), [
    [
      Config.node,
      TestConfig.layer({
        get: () =>
          Effect.succeed({
            tool_output: { max_lines: 80, max_bytes: 8192 },
          } as ConfigV1.Info),
      }),
    ],
  ]),
)

const wrapIt = testEffect(LayerNode.compile(LayerNode.group([Truncate.node, Agent.node])))

describe("WodeAppX truncateHandled runtime", () => {
  truncIt.live("managed tool_output 8KB/80 truncates fat read-like payload", () =>
    Effect.gen(function* () {
      expect(Buffer.byteLength(fat, "utf-8")).toBeGreaterThan(8192)
      const result = yield* (yield* Truncate.Service).output(fat)
      expect(result.truncated).toBe(true)
      expect(Buffer.byteLength(result.content, "utf-8")).toBeLessThanOrEqual(8192 + 600)
      expect(result.content).toMatch(/truncated|Full output saved|Grep|Task tool/i)
      if (!result.truncated) throw new Error("expected truncated")
      expect(result.outputPath).toBeDefined()
      const written = yield* (yield* FSUtil.Service).readFileString(result.outputPath!)
      expect(written).toBe(fat)
    }),
  )

  wrapIt.effect("Tool.define skips Truncate when truncateHandled:true", () =>
    Effect.gen(function* () {
      const info = yield* Tool.define(
        "shell-sim",
        Effect.succeed({
          description: "sim shell",
          parameters: params,
          execute() {
            return Effect.succeed({
              title: "cmd",
              output: fat,
              metadata: { truncated: true, truncateHandled: true },
            })
          },
        }),
      )
      const tool = yield* info.init()
      const execute = tool.execute as unknown as (
        args: unknown,
        ctx: Tool.Context,
      ) => Effect.Effect<{ output: string; metadata: Record<string, unknown> }>
      const result = yield* execute({ input: "x" }, makeCtx())
      expect(result.metadata.truncateHandled).toBe(true)
      expect(result.output).toBe(fat)
    }),
  )
})
`,
  );

  console.log(`Patched OpenCode dynamic tool discovery in ${sourceRoot}`);
}

const isDirectRun = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
  : false;
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
