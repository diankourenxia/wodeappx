import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { jsonSchema, tool as aiTool, type Tool } from "ai"

import {
  TOOL_NAMESPACE_CONTEXT_MAX_BYTES,
  TOOL_SEARCH_ID,
  ToolExposure,
  __testing,
  exposeDynamicTools,
  isSmallTalkSession,
  isSmallTalkUserText,
  resolveWorkspaceIdentitySystem,
  renderDynamicMcpContext,
} from "./dynamic-tool-discovery"
import { readStickyLeaseToolIDs, writeStickyLeaseToolIDs } from "./session-sticky-leases"

function definition(
  description: string,
  properties: Record<string, { type: "string"; description: string }> = {},
): Tool {
  return aiTool({
    description,
    inputSchema: jsonSchema({
      type: "object",
      properties,
      additionalProperties: false,
    }),
    execute: async () => ({ output: "ok", title: "ok", metadata: {} }),
  })
}

function definitionWithExecute(
  description: string,
  execute: (args: unknown) => Promise<unknown>,
): Tool {
  return aiTool({
    description,
    inputSchema: jsonSchema({
      type: "object",
      properties: {},
      additionalProperties: true,
    }),
    execute,
  })
}

function fixture() {
  const tools: Record<string, Tool> = {
    read: definition("Read a local file.", {
      filePath: { type: "string", description: "Local path to read." },
    }),
    lark_search_docs: definition("Search Feishu or Lark documents.", {
      query: { type: "string", description: "Document search query." },
    }),
    database_query: definition("Run a read-only SQL query.", {
      sql: { type: "string", description: "SQL query." },
    }),
    publish_report: definition("Publish a report to an external service.", {
      reportID: { type: "string", description: "Report identifier." },
    }),
  }
  const namespaces = [
    {
      name: "lark",
      instructions: "Use this server for Feishu and Lark documents.",
      tools: ["lark_search_docs"],
    },
    {
      name: "database",
      instructions: "Use this server for read-only database access.",
      tools: ["database_query"],
    },
  ]
  return { tools, namespaces }
}

let stickyLeaseDir = ""

beforeEach(() => {
  stickyLeaseDir = mkdtempSync(join(tmpdir(), "opencode-sticky-lease-"))
  process.env.OPENCODE_STICKY_LEASE_DIR = stickyLeaseDir
})

afterEach(() => {
  delete process.env.OPENCODE_COMPACT_DIRECT_TOOL_DESCRIPTIONS
  delete process.env.OPENCODE_STICKY_LOADED
  delete process.env.OPENCODE_EMPTY_WRITE_THRASH_LIMIT
  delete process.env.OPENCODE_DYNAMIC_TOOL_HIDDEN
  delete process.env.OPENCODE_DYNAMIC_TOOL_DISCOVERY
  __testing.reset()
  delete process.env.OPENCODE_STICKY_LEASE_DIR
  if (stickyLeaseDir) {
    try {
      rmSync(stickyLeaseDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
    stickyLeaseDir = ""
  }
})

describe("dynamic tool discovery", () => {
  test("exposes only direct tools and tool_search on the first model step", () => {
    const input = fixture()
    const result = exposeDynamicTools({
      sessionID: "session-1",
      turnID: "turn-1",
      ...input,
    })

    expect(Object.keys(result.tools).sort()).toEqual(["read", TOOL_SEARCH_ID])
    expect(result.stats).toMatchObject({
      total: 4,
      direct: 1,
      deferred: 3,
      hidden: 0,
      loaded: 0,
      visible_tools: 2,
      toolset_changed: false,
      toolset_added: 0,
      toolset_removed: 0,
    })
    expect(result.stats.toolset_hash).toMatch(/^[a-f0-9]{16}$/)
    expect(result.stats.visible_schema_bytes).toBeGreaterThan(0)
    expect(result.stats).not.toHaveProperty("visibleToolIDs")
  })

  test("keeps Wynne conversational turns to tool_search until a capability is discovered", () => {
    const input = fixture()
    const initial = exposeDynamicTools({
      sessionID: "wynne-session",
      turnID: "turn-1",
      profile: "wynne-brand-agent",
      ...input,
    })

    expect(Object.keys(initial.tools)).toEqual([TOOL_SEARCH_ID])
    expect(initial.stats).toMatchObject({
      total: 4,
      direct: 0,
      deferred: 4,
      hidden: 0,
      loaded: 0,
      visible_tools: 1,
    })

    __testing.load("wynne-session", "turn-1", ["read"])
    const loaded = exposeDynamicTools({
      sessionID: "wynne-session",
      turnID: "turn-1",
      profile: "wynne-brand-agent",
      ...input,
    })
    expect(Object.keys(loaded.tools).sort()).toEqual(["read", TOOL_SEARCH_ID])
    expect(loaded.stats.loaded).toBe(1)
  })

  test("compacts resident tool descriptions without changing schemas or execution", () => {
    const execute = async () => ({ output: "ok", title: "ok", metadata: {} })
    const inputSchema = jsonSchema({
      type: "object",
      properties: {
        command: { type: "string", description: "Command to execute." },
      },
      required: ["command"],
      additionalProperties: false,
    })
    const bash = aiTool({
      description: "Long duplicated host policy. ".repeat(240),
      inputSchema,
      execute,
    })
    const tools = { bash }

    process.env.OPENCODE_COMPACT_DIRECT_TOOL_DESCRIPTIONS = "0"
    const original = exposeDynamicTools({
      sessionID: "session-original",
      turnID: "turn-1",
      tools,
      namespaces: [],
    })

    delete process.env.OPENCODE_COMPACT_DIRECT_TOOL_DESCRIPTIONS
    const compact = exposeDynamicTools({
      sessionID: "session-compact",
      turnID: "turn-1",
      tools,
      namespaces: [],
    })

    expect(compact.tools.bash?.description).toBe(__testing.directToolDescription("bash"))
    expect(__testing.directToolDescription("glob")).toContain("Spotlight")
    expect(compact.tools.bash?.inputSchema).toBe(inputSchema)
    // bash execute is wrapped for background detach (ses_03523d86); schema/description still compacted
    expect(typeof compact.tools.bash?.execute).toBe("function")
    expect(compact.tools.bash?.execute).not.toBe(execute)
    expect(compact.stats.visible_schema_bytes).toBeLessThan(original.stats.visible_schema_bytes * 0.25)
  })

  test("BM25 searches names, descriptions, and parameter schema text", async () => {
    const input = fixture()

    await expect(__testing.search({
      ...input,
      query: "飞书文档",
    })).resolves.toEqual([
      {
        id: "lark_search_docs",
        source: "mcp",
        namespace: "lark",
      },
    ])

    const sqlMatches = await __testing.search({
      ...input,
      query: "SQL query",
    })
    expect(sqlMatches[0]).toEqual({
      id: "database_query",
      source: "mcp",
      namespace: "database",
    })
  })

  test("runtime profiles soft-boost relevant tools without making irrelevant tools match", async () => {
    const input = fixture()
    input.tools.generic_inventory = definition("List product inventory.")
    input.tools.wodeappx_shopify_products = definition("List Shopify product inventory.")

    const matches = await __testing.search({
      ...input,
      query: "product inventory",
      profile: "wynne-brand-agent",
    })
    expect(matches[0]?.id).toBe("wodeappx_shopify_products")

    const unrelated = await __testing.search({
      ...input,
      query: "weather forecast",
      profile: "wynne-brand-agent",
    })
    expect(unrelated).toEqual([])
  })

  test("keeps sticky loaded leases across user turns in the same session", () => {
    const input = fixture()
    const initial = exposeDynamicTools({
      sessionID: "session-1",
      turnID: "turn-1",
      ...input,
    })
    __testing.load("session-1", "turn-1", ["lark_search_docs"])

    const loaded = exposeDynamicTools({
      sessionID: "session-1",
      turnID: "turn-1",
      ...input,
    })
    expect(Object.keys(loaded.tools).sort()).toEqual(["lark_search_docs", "read", TOOL_SEARCH_ID])
    expect(loaded.stats).toMatchObject({
      visible_tools: 3,
      toolset_changed: true,
      toolset_added: 1,
      toolset_removed: 0,
      previous_toolset_hash: initial.stats.toolset_hash,
    })
    expect(loaded.stats.toolset_hash).not.toBe(initial.stats.toolset_hash)

    const stable = exposeDynamicTools({
      sessionID: "session-1",
      turnID: "turn-1",
      ...input,
    })
    expect(stable.stats).toMatchObject({
      toolset_changed: false,
      toolset_added: 0,
      toolset_removed: 0,
      previous_toolset_hash: loaded.stats.toolset_hash,
    })

    const nextTurn = exposeDynamicTools({
      sessionID: "session-1",
      turnID: "turn-2",
      ...input,
    })
    expect(Object.keys(nextTurn.tools).sort()).toEqual(["lark_search_docs", "read", TOOL_SEARCH_ID])
    expect(nextTurn.stats.loaded).toBe(1)
    expect(nextTurn.tools.lark_search_docs).toBeTruthy()
  })

  test("does not carry sticky loaded tools into a different unrelated session", () => {
    const input = fixture()
    __testing.load("session-a", "turn-1", ["lark_search_docs"])
    expect(Object.keys(exposeDynamicTools({
      sessionID: "session-a",
      turnID: "turn-1",
      ...input,
    }).tools)).toContain("lark_search_docs")

    const other = exposeDynamicTools({
      sessionID: "session-b",
      turnID: "turn-1",
      ...input,
    })
    expect(Object.keys(other.tools).sort()).toEqual(["read", TOOL_SEARCH_ID])
    expect(other.stats.loaded).toBe(0)
  })

  test("fork inherits parent sticky leases for deferred tools", () => {
    const input = fixture()
    writeStickyLeaseToolIDs("session-parent-fork", ["lark_search_docs", "database_query"])
    const inherited = __testing.inheritStickyLeasesOnFork("session-parent-fork", "session-child-fork")
    expect(inherited).toEqual(expect.arrayContaining(["lark_search_docs", "database_query"]))
    expect(readStickyLeaseToolIDs("session-child-fork")).toEqual(
      expect.arrayContaining(["lark_search_docs", "database_query"]),
    )

    const child = exposeDynamicTools({
      sessionID: "session-child-fork",
      turnID: "turn-1",
      ...input,
    })
    expect(child.tools.lark_search_docs).toBeTruthy()
    expect(child.tools.database_query).toBeTruthy()
    expect(child.stats.loaded).toBe(2)
  })

  test("site intent sticky-preloads pack tools (progressive disclosure, not Direct)", () => {
    expect(__testing.exposureFor("publish_project")).toBe(ToolExposure.Deferred)
    expect(__testing.exposureFor("wodeapp-platform_publish_project")).toBe(ToolExposure.Deferred)
    expect(__testing.exposureFor("wodeapp_page_import_from_file")).toBe(ToolExposure.Deferred)
    expect(__testing.exposureFor("read")).toBe(ToolExposure.Direct)
    expect(__testing.detectCapabilityPreloadPacks("把本地 html 发布成站点")).toEqual(["site"])
    expect(__testing.bareNamesForPreloadPacks(["site"])).toEqual(
      expect.arrayContaining(["publish_project", "wodeapp_page_import_from_file"]),
    )

    const input = {
      tools: {
        read: definition("Read a file"),
        wodeapp_page_import_from_file: definition("Import local HTML into a page"),
        "wodeapp-platform_publish_project": definition("Publish a WodeApp project"),
        "wodeapp-platform_create_project": definition("Create project"),
        lark_search_docs: definition("Search Feishu docs"),
      },
      namespaces: [] as { name: string; instructions: string; tools: string[] }[],
    }
    const exposed = exposeDynamicTools({
      sessionID: "session-site-preload",
      turnID: "turn-1",
      userText: "把工作区里的 内蒙古自驾线路图.html 发布成站点",
      ...input,
    })
    expect(exposed.tools.wodeapp_page_import_from_file).toBeTruthy()
    expect(exposed.tools["wodeapp-platform_publish_project"]).toBeTruthy()
    expect(exposed.tools["wodeapp-platform_create_project"]).toBeTruthy()
    // Feishu is not in the site pack — remains deferred and unloaded.
    expect(exposed.tools.lark_search_docs).toBeUndefined()
    expect(exposed.stats.direct).toBe(1)
    expect(exposed.stats.loaded).toBeGreaterThanOrEqual(3)
  })

  test("synthetic auto-continue inherits the real site task and restores publish visibility", async () => {
    const sessionID = "session-site-auto-continue"
    const realTaskID = "msg-real-site-task"
    const realTask = "导入工作区里的 内蒙古自驾线路图.html，然后发布成可访问站点"
    const tools: Record<string, Tool> = {
      read: definition("Read a file"),
      wodeapp_page_import_from_file: definition("Import local HTML into a page"),
      "wodeapp-platform_publish_project": definition("Publish a WodeApp project"),
      "wodeapp-platform_create_project": definition("Create project"),
      lark_search_docs: definition("Search Feishu docs"),
    }
    const namespaces = [
      {
        name: "wodeapp-platform",
        instructions: "WodeApp platform MCP for projects and pages.",
        tools: Object.keys(tools).filter((id) => id.startsWith("wodeapp-platform_")),
      },
    ]

    // Reproduce the bad A branch: tool_search loaded import only, then import
    // succeeded while publish was still absent from the model's tool surface.
    __testing.load(sessionID, "turn-import", ["wodeapp_page_import_from_file"])
    const beforeContinue = exposeDynamicTools({
      sessionID,
      turnID: "turn-import",
      tools,
      namespaces,
    })
    expect(beforeContinue.tools.wodeapp_page_import_from_file).toBeTruthy()
    expect(beforeContinue.tools["wodeapp-platform_publish_project"]).toBeUndefined()
    await __testing.invokeTool(
      sessionID,
      "turn-import",
      tools,
      "wodeapp_page_import_from_file",
      { projectId: "project-1", pageId: "page-1", sourcePath: "/tmp/site.html" },
    )

    const latestRealUserText = __testing.extractLatestUserText([
      {
        info: { id: realTaskID, role: "user" },
        parts: [{ type: "text", text: realTask }],
      },
      {
        info: { id: "msg-import-result", role: "assistant" },
        parts: [{ type: "text", text: "页面已导入。" }],
      },
      {
        info: { id: "msg-synthetic-continue", role: "user" },
        parts: [{
          type: "text",
          text: "以下是WodeAppX 的系统自动续跑指令（非用户发言）。",
          synthetic: true,
        }],
      },
    ])
    expect(latestRealUserText).toBe(realTask)
    expect(__testing.extractLatestUserTask([
      {
        info: { id: realTaskID, role: "user" },
        parts: [{ type: "text", text: realTask }],
      },
      {
        info: { id: "msg-synthetic-continue", role: "user" },
        parts: [{ type: "text", text: "系统续跑", synthetic: true }],
      },
    ])).toEqual({ messageID: realTaskID, text: realTask })

    const afterContinue = exposeDynamicTools({
      sessionID,
      turnID: "turn-auto-continue",
      taskEpoch: realTaskID,
      userText: latestRealUserText,
      tools,
      namespaces,
    })
    expect(afterContinue.tools.wodeapp_page_import_from_file).toBeTruthy()
    expect(afterContinue.tools["wodeapp-platform_publish_project"]).toBeTruthy()
    expect(afterContinue.tools["wodeapp-platform_create_project"]).toBeTruthy()
    expect(afterContinue.tools.lark_search_docs).toBeUndefined()
  })

  test("deduplicates successful import and publish writes inside the real task epoch", async () => {
    const sessionID = "session-write-idempotency"
    const taskEpoch = "msg-real-write-task"
    const sourcePath = join(stickyLeaseDir, "site.html")
    writeFileSync(sourcePath, "<main>v1</main>")
    let importRuns = 0
    let publishRuns = 0
    const tools: Record<string, Tool> = {
      read: definition("Read a file"),
      wodeapp_page_import_from_file: definitionWithExecute(
        "Import local HTML into a page",
        async () => {
          importRuns++
          return {
            title: "imported",
            output: JSON.stringify({ ok: true, data: { pageId: "page-1" } }),
            metadata: {},
          }
        },
      ),
      "wodeapp-platform_publish_project": definitionWithExecute(
        "Publish a WodeApp project",
        async () => {
          publishRuns++
          return {
            title: "published",
            output: JSON.stringify({ success: true, version: publishRuns }),
            metadata: {},
          }
        },
      ),
    }
    __testing.load(sessionID, "turn-import", [
      "wodeapp_page_import_from_file",
      "wodeapp-platform_publish_project",
    ])
    const exposed = exposeDynamicTools({
      sessionID,
      turnID: "turn-import",
      taskEpoch,
      tools,
      namespaces: [],
    })
    const importTool = exposed.tools.wodeapp_page_import_from_file as Tool & {
      execute?: (args: unknown, options?: unknown) => Promise<unknown>
    }
    const publishTool = exposed.tools["wodeapp-platform_publish_project"] as Tool & {
      execute?: (args: unknown, options?: unknown) => Promise<unknown>
    }
    if (!importTool.execute || !publishTool.execute) throw new Error("write tools missing")
    const importArgs = {
      projectId: "project-1",
      pageId: "page-1",
      sourcePath,
    }

    await importTool.execute(importArgs, { toolCallId: "call-import-1" })
    const duplicateImport = await importTool.execute(importArgs, { toolCallId: "call-import-2" })
    expect(importRuns).toBe(1)
    expect(JSON.parse(String((duplicateImport as { output?: unknown })?.output))).toMatchObject({
      ok: true,
      executed: false,
      deduplicated: true,
      previousCallId: "call-import-1",
      nextActions: ["publish_project"],
    })

    await publishTool.execute({ projectId: "project-1" }, { toolCallId: "call-publish-1" })
    const duplicatePublish = await publishTool.execute(
      { projectId: "project-1" },
      { toolCallId: "call-publish-2" },
    )
    expect(publishRuns).toBe(1)
    expect(JSON.parse(String((duplicatePublish as { output?: unknown })?.output))).toMatchObject({
      ok: true,
      executed: false,
      deduplicated: true,
      previousCallId: "call-publish-1",
    })

    const continued = exposeDynamicTools({
      sessionID,
      turnID: "turn-synthetic-continue",
      taskEpoch,
      tools,
      namespaces: [],
    })
    const continuedImport = continued.tools.wodeapp_page_import_from_file as Tool & {
      execute?: (args: unknown, options?: unknown) => Promise<unknown>
    }
    await continuedImport.execute?.(importArgs, { toolCallId: "call-import-3" })
    expect(importRuns).toBe(1)

    // Changed file content is a new resource revision, so import and publish run.
    writeFileSync(sourcePath, "<main>v2</main>")
    await continuedImport.execute?.(importArgs, { toolCallId: "call-import-4" })
    expect(importRuns).toBe(2)
    const continuedPublish = continued.tools["wodeapp-platform_publish_project"] as Tool & {
      execute?: (args: unknown, options?: unknown) => Promise<unknown>
    }
    await continuedPublish.execute?.({ projectId: "project-1" }, { toolCallId: "call-publish-3" })
    expect(publishRuns).toBe(2)

    // A real user message starts a fresh idempotency epoch.
    const nextTask = exposeDynamicTools({
      sessionID,
      turnID: "turn-real-follow-up",
      taskEpoch: "msg-next-real-task",
      tools,
      namespaces: [],
    })
    const nextTaskImport = nextTask.tools.wodeapp_page_import_from_file as Tool & {
      execute?: (args: unknown, options?: unknown) => Promise<unknown>
    }
    await nextTaskImport.execute?.(importArgs, { toolCallId: "call-import-5" })
    expect(importRuns).toBe(3)
  })

  test("does not record a failed import as an idempotent success", async () => {
    const sessionID = "session-write-idempotency-failure"
    const sourcePath = join(stickyLeaseDir, "retry.html")
    writeFileSync(sourcePath, "<main>retry</main>")
    let runs = 0
    const tools: Record<string, Tool> = {
      read: definition("Read a file"),
      wodeapp_page_import_from_file: definitionWithExecute(
        "Import local HTML into a page",
        async () => {
          runs++
          return {
            title: runs === 1 ? "failed" : "imported",
            output: JSON.stringify(runs === 1 ? { ok: false, error: "temporary" } : { ok: true }),
            metadata: {},
          }
        },
      ),
    }
    __testing.load(sessionID, "turn-import", ["wodeapp_page_import_from_file"])
    const exposed = exposeDynamicTools({
      sessionID,
      turnID: "turn-import",
      taskEpoch: "msg-retry-task",
      tools,
      namespaces: [],
    })
    const importTool = exposed.tools.wodeapp_page_import_from_file as Tool & {
      execute?: (args: unknown, options?: unknown) => Promise<unknown>
    }
    if (!importTool.execute) throw new Error("import tool missing")
    const args = { projectId: "project-1", pageId: "page-1", sourcePath }
    await importTool.execute(args, { toolCallId: "call-failed" })
    await importTool.execute(args, { toolCallId: "call-success" })
    await importTool.execute(args, { toolCallId: "call-deduplicated" })
    expect(runs).toBe(2)
  })

  test("drops sticky leases when the tool disappears from the catalog", () => {
    const input = fixture()
    __testing.load("session-offline", "turn-1", ["lark_search_docs"])
    expect(exposeDynamicTools({
      sessionID: "session-offline",
      turnID: "turn-1",
      ...input,
    }).tools.lark_search_docs).toBeTruthy()

    const withoutLark = {
      tools: {
        read: input.tools.read,
        database_query: input.tools.database_query,
        publish_report: input.tools.publish_report,
      },
      namespaces: input.namespaces.filter((namespace) => namespace.name !== "lark"),
    }
    const next = exposeDynamicTools({
      sessionID: "session-offline",
      turnID: "turn-2",
      ...withoutLark,
    })
    expect(next.tools.lark_search_docs).toBeUndefined()
    expect(next.stats.loaded).toBe(0)
  })

  test("keeps sticky leases without idle TTL (Codex/Cursor-style session retention)", () => {
    const input = fixture()
    __testing.load("session-ttl", "turn-1", ["lark_search_docs"])
    // Aging lastUsedAt must not drop the lease — there is no idle expiry.
    expect(__testing.setLeaseTimes("session-ttl", "lark_search_docs", {
      lastUsedAt: Date.now() - 24 * 60 * 60_000,
    })).toBe(true)
    const still = exposeDynamicTools({
      sessionID: "session-ttl",
      turnID: "turn-2",
      ...input,
    })
    expect(still.tools.lark_search_docs).toBeTruthy()
    expect(still.stats.loaded).toBe(1)
  })

  test("rehydrates sticky leases after process memory clear (sidecar restart)", () => {
    const input = fixture()
    __testing.load("session-restart", "turn-1", ["lark_search_docs", "database_query"])
    expect(exposeDynamicTools({
      sessionID: "session-restart",
      turnID: "turn-1",
      ...input,
    }).stats.loaded).toBe(2)

    // Simulate sidecar process death: memory gone, durable lease file kept.
    __testing.reset({ keepPersisted: true })
    expect(__testing.leaseCount("session-restart")).toBe(0)

    const afterRestart = exposeDynamicTools({
      sessionID: "session-restart",
      turnID: "turn-2",
      ...input,
    })
    expect(Object.keys(afterRestart.tools).sort()).toEqual([
      "database_query",
      "lark_search_docs",
      "read",
      TOOL_SEARCH_ID,
    ])
    expect(afterRestart.stats.loaded).toBe(2)
  })

  test("does not wipe durable sticky leases when cold-start catalog has no deferred tools", () => {
    const input = fixture()
    __testing.load("session-cold-prune", "turn-1", ["lark_search_docs", "database_query"])
    expect(exposeDynamicTools({
      sessionID: "session-cold-prune",
      turnID: "turn-1",
      ...input,
    }).stats.loaded).toBe(2)

    __testing.reset({ keepPersisted: true })
    expect(__testing.leaseCount("session-cold-prune")).toBe(0)

    // Cold-start snapshot: coding foundation only (matches ses_025ec834 total=12 deferred=0).
    const cold = exposeDynamicTools({
      sessionID: "session-cold-prune",
      turnID: "turn-cold",
      tools: { read: input.tools.read },
      namespaces: [],
    })
    expect(cold.stats.deferred).toBe(0)
    expect(cold.stats.loaded).toBe(0)
    expect(__testing.catalogReadyForStickyPrune({ read: input.tools.read })).toBe(false)
    // Leases stay rehydrated in memory and on disk; not pruned against incomplete catalog.
    expect(__testing.leaseCount("session-cold-prune")).toBe(2)

    const warm = exposeDynamicTools({
      sessionID: "session-cold-prune",
      turnID: "turn-warm",
      ...input,
    })
    expect(warm.stats.loaded).toBe(2)
    expect(warm.tools.lark_search_docs).toBeTruthy()
    expect(warm.tools.database_query).toBeTruthy()
  })

  test("rehydrates from disk when in-memory leases are empty but durable file exists", () => {
    const input = fixture()
    __testing.load("session-empty-memory", "turn-1", ["lark_search_docs"])
    expect(exposeDynamicTools({
      sessionID: "session-empty-memory",
      turnID: "turn-1",
      ...input,
    }).stats.loaded).toBe(1)

    // Simulate empty memory while durable leases still exist on disk.
    expect(__testing.dropLease("session-empty-memory", "lark_search_docs")).toBe(true)
    expect(__testing.leaseCount("session-empty-memory")).toBe(0)
    writeStickyLeaseToolIDs("session-empty-memory", ["lark_search_docs", "database_query"])

    const recovered = exposeDynamicTools({
      sessionID: "session-empty-memory",
      turnID: "turn-2",
      ...input,
    })
    expect(recovered.stats.loaded).toBe(2)
    expect(recovered.tools.lark_search_docs).toBeTruthy()
    expect(recovered.tools.database_query).toBeTruthy()
  })

  test("OPENCODE_STICKY_LOADED=0 does not rehydrate durable leases", () => {
    const input = fixture()
    __testing.load("session-nodurable", "turn-1", ["lark_search_docs"])
    __testing.reset({ keepPersisted: true })

    process.env.OPENCODE_STICKY_LOADED = "0"
    const next = exposeDynamicTools({
      sessionID: "session-nodurable",
      turnID: "turn-2",
      ...input,
    })
    expect(next.tools.lark_search_docs).toBeUndefined()
    expect(next.stats.loaded).toBe(0)
  })

  test("renews sticky lastUsedAt when a deferred tool actually executes", async () => {
    const input = fixture()
    __testing.load("session-renew", "turn-1", ["lark_search_docs"])
    expect(__testing.leaseSnapshot("session-renew", "lark_search_docs")).toBeTruthy()
    const agedLastUsedAt = Date.now() - 60_000
    expect(__testing.setLeaseTimes("session-renew", "lark_search_docs", {
      lastUsedAt: agedLastUsedAt,
    })).toBe(true)

    await __testing.invokeTool("session-renew", "turn-1", input.tools, "lark_search_docs", {
      query: "docs",
    })

    const after = __testing.leaseSnapshot("session-renew", "lark_search_docs")
    expect(after).toBeTruthy()
    expect(after!.lastUsedAt).toBeGreaterThan(agedLastUsedAt)
  })

  test("keeps all sticky leases without max-count eviction", () => {
    const tools: Record<string, Tool> = {
      read: fixture().tools.read,
      tool_a: definition("Deferred tool A."),
      tool_b: definition("Deferred tool B."),
      tool_c: definition("Deferred tool C."),
    }
    __testing.load("session-no-max", "turn-1", ["tool_a", "tool_b", "tool_c"])
    expect(__testing.leaseCount("session-no-max")).toBe(3)
    expect(__testing.leaseSnapshot("session-no-max", "tool_a")).toBeTruthy()
    expect(__testing.leaseSnapshot("session-no-max", "tool_b")).toBeTruthy()
    expect(__testing.leaseSnapshot("session-no-max", "tool_c")).toBeTruthy()

    const exposed = exposeDynamicTools({
      sessionID: "session-no-max",
      turnID: "turn-2",
      tools,
      namespaces: [],
    })
    expect(Object.keys(exposed.tools).sort()).toEqual([
      "read",
      "tool_a",
      "tool_b",
      "tool_c",
      TOOL_SEARCH_ID,
    ])
    expect(exposed.stats.loaded).toBe(3)
  })

  test("OPENCODE_STICKY_LOADED=0 restores turn-scoped clear", () => {
    const input = fixture()
    __testing.load("session-nosticky", "turn-1", ["lark_search_docs"])
    expect(exposeDynamicTools({
      sessionID: "session-nosticky",
      turnID: "turn-1",
      ...input,
    }).tools.lark_search_docs).toBeTruthy()

    process.env.OPENCODE_STICKY_LOADED = "0"
    const nextTurn = exposeDynamicTools({
      sessionID: "session-nosticky",
      turnID: "turn-2",
      ...input,
    })
    expect(nextTurn.tools.lark_search_docs).toBeUndefined()
    expect(nextTurn.stats.loaded).toBe(0)
    expect(Object.keys(nextTurn.tools).sort()).toEqual(["read", TOOL_SEARCH_ID])
  })

  test("drops sticky leases when a tool becomes hidden", () => {
    const input = fixture()
    __testing.load("session-hidden", "turn-1", ["lark_search_docs"])
    expect(exposeDynamicTools({
      sessionID: "session-hidden",
      turnID: "turn-1",
      ...input,
    }).tools.lark_search_docs).toBeTruthy()

    process.env.OPENCODE_DYNAMIC_TOOL_HIDDEN = "lark_search_docs"
    const next = exposeDynamicTools({
      sessionID: "session-hidden",
      turnID: "turn-2",
      ...input,
    })
    expect(next.tools.lark_search_docs).toBeUndefined()
    expect(next.stats.hidden).toBe(1)
    expect(next.stats.loaded).toBe(0)
    expect(__testing.leaseSnapshot("session-hidden", "lark_search_docs")).toBeNull()
  })

  test("empty-write thrash is per path; other-path empty writes do not reset the counter", async () => {
    const writeCalls: unknown[] = []
    const tools = {
      read: fixture().tools.read,
      write: aiTool({
        description: "Write a file.",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            filePath: { type: "string" },
            content: { type: "string" },
          },
          additionalProperties: false,
        }),
        execute: async (args: unknown) => {
          writeCalls.push(args)
          return { title: "wrote", output: "Wrote file successfully.", metadata: {} }
        },
      }),
    }
    process.env.OPENCODE_EMPTY_WRITE_THRASH_LIMIT = "3"

    await __testing.invokeWrite("session-path", "turn-1", tools, { filePath: "/tmp/m", content: "" })
    await __testing.invokeWrite("session-path", "turn-1", tools, { filePath: "/tmp/other", content: "" })
    await __testing.invokeWrite("session-path", "turn-1", tools, { filePath: "/tmp/m", content: "" })
    expect(writeCalls).toHaveLength(3)

    const blocked = await __testing.invokeWrite("session-path", "turn-1", tools, {
      filePath: "/tmp/m",
      content: "",
    }) as { metadata?: { emptyWriteThrash?: boolean }; output?: string }
    expect(writeCalls).toHaveLength(3)
    expect(blocked.metadata?.emptyWriteThrash).toBe(true)
    expect(blocked.output).toContain("EMPTY_WRITE_THRASH")
  })

  test("ses_03523d86: bash wrap rewrites nohup background before execute", async () => {
    if (process.platform === "win32") return
    const seen: string[] = []
    const tools = {
      ...fixture().tools,
      bash: aiTool({
        description: "Run shell.",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            command: { type: "string" },
            timeout: { type: "number" },
          },
          additionalProperties: false,
        }),
        execute: async (args: unknown) => {
          const command = typeof (args as { command?: unknown })?.command === "string"
            ? (args as { command: string }).command
            : ""
          seen.push(command)
          return { title: "bash", output: "ok", metadata: {} }
        },
      }),
    }

    await __testing.invokeBash("session-bash-bg", "turn-1", tools, {
      command:
        "nohup node --eval 'setInterval(()=>{},6e4)' >/tmp/preview.log 2>&1 &\nsleep 2; curl -s http://127.0.0.1:17655/setup",
      timeout: 120000,
    })

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatch(/^set \+m\n/)
    expect(seen[0]).toContain("setsid nohup")
    expect(seen[0]).toContain("curl")
  })

  test("rejects repeated empty writes to the same path within one turn", async () => {
    const writeCalls: unknown[] = []
    const tools = {
      read: fixture().tools.read,
      write: aiTool({
        description: "Write a file.",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            filePath: { type: "string" },
            content: { type: "string" },
          },
          additionalProperties: false,
        }),
        execute: async (args: unknown) => {
          writeCalls.push(args)
          return { title: "wrote", output: "Wrote file successfully.", metadata: {} }
        },
      }),
    }

    const limit = __testing.emptyWriteThrashLimit()
    for (let i = 0; i < limit - 1; i += 1) {
      const result = await __testing.invokeWrite("session-thrash", "turn-1", tools, {
        filePath: "/tmp/m",
        content: "",
      }) as { output?: string }
      expect(result.output).toContain("Wrote file successfully.")
    }
    expect(writeCalls).toHaveLength(limit - 1)

    const blocked = await __testing.invokeWrite("session-thrash", "turn-1", tools, {
      filePath: "/tmp/m",
      content: "",
    }) as { output?: string; metadata?: { emptyWriteThrash?: boolean } }
    expect(writeCalls).toHaveLength(limit - 1)
    expect(blocked.metadata?.emptyWriteThrash).toBe(true)
    expect(blocked.output).toContain("EMPTY_WRITE_THRASH")

    // New user turn resets thrash counters.
    const afterTurn = await __testing.invokeWrite("session-thrash", "turn-2", tools, {
      filePath: "/tmp/m",
      content: "",
    }) as { output?: string }
    expect(afterTurn.output).toContain("Wrote file successfully.")
    expect(writeCalls).toHaveLength(limit)
  })

  test("keeps deferred MCP namespace context bounded and expands only selected instructions", () => {
    const input = fixture()
    const initial = renderDynamicMcpContext({
      namespaces: input.namespaces,
      visibleToolIDs: new Set(["read", TOOL_SEARCH_ID]),
    })
    expect(initial).toContain("<tool_namespaces>")
    expect(initial).toContain('name="lark"')
    expect(initial).not.toContain("<mcp_instructions>")
    expect(Buffer.byteLength(initial ?? "")).toBeLessThanOrEqual(TOOL_NAMESPACE_CONTEXT_MAX_BYTES)

    const selected = renderDynamicMcpContext({
      namespaces: input.namespaces,
      visibleToolIDs: new Set(["read", "lark_search_docs", TOOL_SEARCH_ID]),
    })
    expect(selected).toContain("<mcp_instructions>")
    expect(selected).toContain("Use this server for Feishu and Lark documents.")
    expect(selected).toContain('name="database"')

    const manyNamespaces = Array.from({ length: 100 }, (_, index) => ({
      name: `namespace-${index}`,
      instructions: "x".repeat(500),
      tools: [`tool-${index}`],
    }))
    const bounded = renderDynamicMcpContext({
      namespaces: manyNamespaces,
      visibleToolIDs: new Set([TOOL_SEARCH_ID]),
    })
    expect(Buffer.byteLength(bounded ?? "")).toBeLessThanOrEqual(TOOL_NAMESPACE_CONTEXT_MAX_BYTES)
  })

  test("empty tool_search recovery steers to web/MCP instead of inventing tools", () => {
    const empty = __testing.buildToolSearchRecovery({
      matchCount: 0,
      namespaces: fixture().namespaces,
      totalDeferred: 3,
    })
    expect(empty.nextActions).toContain("broaden_query_and_retry_tool_search")
    expect(empty.nextActions).toContain("web_search_or_webfetch_for_public_docs_or_api_guidance")
    expect(empty.nextActions).toContain("retry_tool_search_with_a_connected_mcp_namespace_name")
    expect(empty.connectedNamespaces).toEqual(["lark", "database"])
    expect(empty.doNot).toContain("invent_or_guess_a_tool_name")
    expect(empty.doNot).toContain("glob_grep_read_the_repo_hoping_to_find_a_missing_integration")
    expect(empty.nextAction).toContain("Do not invent a tool name")

    const noMcp = __testing.buildToolSearchRecovery({
      matchCount: 0,
      namespaces: [],
      totalDeferred: 0,
    })
    expect(noMcp.nextActions).toContain("open_extensions_or_connect_mcp_for_the_missing_integration")

    const hit = __testing.buildToolSearchRecovery({
      matchCount: 2,
      namespaces: fixture().namespaces,
      totalDeferred: 3,
    })
    expect(hit.nextActions).toEqual(["call_the_best_matching_loaded_tool"])
    expect(hit.doNot).toEqual([])
  })

  /**
   * Regression: ses_0248febaaffel60DLhPV2Q38bi
   *
   * Root contract (not tool ranking): tool_search must not sticky-load deferred
   * substitutes when Direct tools already cover the query. Pre-fix BM25 loaded
   * Feishu docx/import for `write file … 写文件` (create+file overlap) and told
   * the model to call those — model then pasted HTML into chat.
   */
  test("ses_0248febaa: Direct coverage blocks deferred substitute loads", async () => {
    const tools: Record<string, Tool> = {
      write: definition("Create or overwrite a local file.", {
        filePath: { type: "string", description: "Path to write." },
        content: { type: "string", description: "File contents." },
      }),
      bash: definition("Run a shell command.", {
        command: { type: "string", description: "Shell command." },
      }),
      read: definition("Read a local file.", {
        filePath: { type: "string", description: "Local path to read." },
      }),
      "feishu-agent-mcp_docx_builtin_import": definition(
        "Import and create a Feishu cloud document from a local file upload.",
        { file: { type: "string", description: "Local file to import." } },
      ),
      "feishu-agent-mcp_docx_builtin_search": definition("Search Feishu documents.", {
        query: { type: "string", description: "Search query." },
      }),
      wodeapp_product_save: definition("Save a product asset to the library.", {
        name: { type: "string", description: "Product name." },
      }),
    }
    const namespaces = [
      {
        name: "feishu-agent-mcp",
        instructions: "Feishu / Lark document and drive tools.",
        tools: [
          "feishu-agent-mcp_docx_builtin_import",
          "feishu-agent-mcp_docx_builtin_search",
        ],
      },
    ]

    const query = "write file bash terminal create html file 写文件"
    expect(__testing.findAlreadyAvailableDirectTools(query, tools).sort()).toEqual([
      "bash",
      "write",
    ])
    expect(__testing.queryRequestsDeferredDiscovery(query)).toBe(false)

    const detailed = await __testing.searchDetailed({ tools, namespaces, query })
    expect(detailed.alreadyAvailable).toEqual(["bash", "write"])
    expect(detailed.loadBlockedReason).toBe("already_available_direct")
    expect(detailed.loadedToolIds).toEqual([])
    // Weak Feishu hit still appears in raw ranking diagnostics, but must not load.
    expect(detailed.scores.some((row) => row.id.includes("feishu"))).toBe(true)
    expect(detailed.nextActions).toContain("call_already_available_direct_tool")
    expect(detailed.nextActions).toContain("do_not_use_tool_search_for_direct_capabilities")
    expect(detailed.doNot).toContain("sticky_load_deferred_substitutes_for_direct_capabilities")
    expect(detailed.nextAction).toContain("tool_search does not apply")

    // Fail-closed floor: create+file overlap (~2.4) is below TOOL_SEARCH_MIN_SCORE (3)
    // even if Direct short-circuit were bypassed.
    const feishuNoise = detailed.scores.filter((item) => item.id.includes("feishu"))
    expect(feishuNoise.length).toBeGreaterThan(0)
    for (const row of feishuNoise) {
      expect(row.score).toBeLessThan(__testing.toolSearchMinScore())
    }
    const weakLoads = __testing.resolveToolSearchLoads({
      query: "飞书 write file",
      alreadyAvailable: [],
      catalogMatches: detailed.scores.map((row) => ({
        document: { id: row.id },
        score: row.score,
      })),
    })
    expect(weakLoads.matches).toEqual([])

    // Real deferred intent with strong description still loads.
    const feishu = await __testing.searchDetailed({
      tools,
      namespaces,
      query: "search Feishu documents",
    })
    expect(feishu.loadedToolIds.length).toBeGreaterThan(0)
    expect(feishu.loadedToolIds.some((id) => id.includes("feishu") || id.includes("docx"))).toBe(true)
  })

  /**
   * Regression: ses_0356c0a50ffefJm9VR7kcEPO12
   * Formerly TTL dropped unused update_page while get_page renewed → thrash.
   * Session-lifetime sticky must keep unused siblings callable.
   */
  test("ses_0356: unused sibling page tool stays loaded without idle TTL", async () => {
    const tools: Record<string, Tool> = {
      read: definition("Read a local file.", {
        filePath: { type: "string", description: "Local path to read." },
      }),
      "wodeapp-platform_update_page": definition("更新页面配置（标题、路径或 JSON config）", {
        pageId: { type: "string", description: "Page id." },
        config: { type: "string", description: "Page JSON config." },
      }),
      "wodeapp-platform_get_page": definition("获取页面详情，包含完整 JSON Config", {
        pageId: { type: "string", description: "Page id." },
      }),
      "wodeapp-platform_ai_generate_page": definition("AI 根据描述生成完整页面", {
        pageId: { type: "string", description: "Page id." },
        prompt: { type: "string", description: "Generation prompt." },
      }),
      "wodeapp-platform_publish_project": definition("发布项目上线", {
        projectId: { type: "string", description: "Project id." },
      }),
      "wodeapp-platform_create_project": definition("创建网站 / 工作台项目草稿", {
        name: { type: "string", description: "Project name." },
      }),
      "wodeapp-platform_list_templates": definition("列出可用的项目模板", {}),
      "wodeapp-platform_list_pages": definition("列出项目的所有页面", {
        projectId: { type: "string", description: "Project id." },
      }),
      "wodeapp-platform_get_project": definition("获取项目详情", {
        projectId: { type: "string", description: "Project id." },
      }),
      "wodeapp-platform_create_page": definition("为项目添加新页面", {
        projectId: { type: "string", description: "Project id." },
        title: { type: "string", description: "Page title." },
        path: { type: "string", description: "Page path." },
      }),
      "wodeapp-platform_delete_page": definition("删除页面", {
        pageId: { type: "string", description: "Page id." },
      }),
      "wodeapp-platform_build_app": definition("将项目打包成 App", {
        projectId: { type: "string", description: "Project id." },
        platform: { type: "string", description: "Target platform." },
      }),
      "wodeapp-platform_list_skill_manifests": definition("列出可物化的 Skill IO 契约", {
        query: { type: "string", description: "Skill query." },
      }),
      "wodeapp-platform_materialize_skill_app": definition("将 Skill 物化为可发布智能体页", {
        skillId: { type: "string", description: "Skill id." },
      }),
      "wodeapp-platform_ai_modify_section": definition("AI 修改页面中某个组件的 props", {
        sectionType: { type: "string", description: "Section type." },
        prompt: { type: "string", description: "Modify prompt." },
      }),
      "wodeapp-platform_ai_generate_text": definition("通过 WodeApp 平台文字模型中转生成文本", {
        prompt: { type: "string", description: "Text prompt." },
      }),
    }
    const namespaces = [
      {
        name: "wodeapp-platform",
        instructions: "WodeApp platform MCP for projects and pages.",
        tools: Object.keys(tools).filter((id) => id.startsWith("wodeapp-platform_")),
      },
    ]
    const sessionID = "ses_0356_repro"
    const batch1 = [
      "wodeapp-platform_create_project",
      "wodeapp-platform_materialize_skill_app",
      "wodeapp-platform_list_templates",
      "wodeapp-platform_publish_project",
      "wodeapp-platform_build_app",
      "wodeapp-platform_list_skill_manifests",
      "wodeapp-platform_create_page",
      "wodeapp-platform_list_pages",
      "wodeapp-platform_get_project",
      "wodeapp-platform_update_page",
    ]
    const batch2 = [
      "wodeapp-platform_ai_generate_page",
      "wodeapp-platform_ai_modify_section",
      "wodeapp-platform_ai_generate_text",
      "wodeapp-platform_delete_page",
      "wodeapp-platform_get_page",
      "wodeapp-platform_create_page",
    ]

    __testing.load(sessionID, "turn-create", batch1)
    __testing.load(sessionID, "turn-create", batch2)
    const afterSearch = exposeDynamicTools({
      sessionID,
      turnID: "turn-create",
      tools,
      namespaces,
    })
    expect(afterSearch.stats.loaded).toBe(15)
    expect(afterSearch.tools["wodeapp-platform_update_page"]).toBeTruthy()
    expect(afterSearch.tools["wodeapp-platform_get_page"]).toBeTruthy()

    for (const toolID of [
      "wodeapp-platform_get_page",
      "wodeapp-platform_ai_generate_page",
      "wodeapp-platform_publish_project",
    ]) {
      await __testing.invokeTool(sessionID, "turn-create", tools, toolID, { pageId: "p1" })
    }

    const now = Date.now()
    // Age unused siblings the way the old 30m TTL would have — they must stay.
    for (const toolID of batch1.concat(batch2)) {
      if (
        toolID === "wodeapp-platform_get_page"
        || toolID === "wodeapp-platform_ai_generate_page"
        || toolID === "wodeapp-platform_publish_project"
      ) {
        continue
      }
      expect(__testing.setLeaseTimes(sessionID, toolID, {
        lastUsedAt: now - 40 * 60_000,
      })).toBe(true)
    }

    const afterAge = exposeDynamicTools({
      sessionID,
      turnID: "turn-fix-empty-code",
      tools,
      namespaces,
    })
    expect(afterAge.stats.loaded).toBe(15)
    expect(afterAge.tools["wodeapp-platform_get_page"]).toBeTruthy()
    expect(afterAge.tools["wodeapp-platform_update_page"]).toBeTruthy()
    expect(afterAge.stats.toolset_removed).toBe(0)

    await __testing.invokeTool(sessionID, "turn-fix-empty-code", tools, "wodeapp-platform_update_page", {
      pageId: "p1",
      config: "{}",
    })
  })
})

describe("small-talk lean runtime context", () => {
  test("matches greeting phrases used for AGENTS.md skip", () => {
    expect(isSmallTalkUserText("你好")).toBe(true)
    expect(isSmallTalkUserText("您好！")).toBe(true)
    expect(isSmallTalkUserText("hello")).toBe(true)
    expect(isSmallTalkUserText("Thank you")).toBe(true)
    expect(isSmallTalkUserText("帮我改按钮")).toBe(false)
    expect(isSmallTalkUserText("")).toBe(false)
    expect(isSmallTalkUserText(undefined)).toBe(false)
  })

  test("skips repository instructions only when every real user turn is small talk", () => {
    expect(isSmallTalkSession([
      { info: { role: "user" }, parts: [{ type: "text", text: "你好" }] },
    ])).toBe(true)
    expect(isSmallTalkSession([
      { info: { role: "user" }, parts: [{ type: "text", text: "你好" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "你好，需要我做什么？" }] },
      { info: { role: "user" }, parts: [{ type: "text", text: "帮我改 AGENTS.md" }] },
    ])).toBe(false)
    expect(isSmallTalkSession([
      { info: { role: "user" }, parts: [{ type: "text", text: "帮我改按钮" }] },
      { info: { role: "user" }, parts: [{ type: "text", text: "好" }] },
    ])).toBe(false)
    expect(isSmallTalkSession([
      { info: { role: "user" }, parts: [{ type: "text", text: "你好" }] },
      { info: { role: "user" }, parts: [{ type: "text", text: "系统续跑", synthetic: true }] },
    ])).toBe(true)
    expect(isSmallTalkSession([])).toBe(false)
  })

  test("injects WodeAppX identity from workspace directory, not UI packs", () => {
    expect(resolveWorkspaceIdentitySystem({
      directory: "/Users/me/Desktop/wodeapp",
      userText: "你好",
    })).toContain("You are WodeAppX")
    expect(resolveWorkspaceIdentitySystem({
      directory: "/tmp/notes",
      userText: "你可以自进化吗",
    })).toContain("wodeappx-self-evolution")
    expect(resolveWorkspaceIdentitySystem({
      directory: "/tmp/notes",
      userText: "你好",
    })).toBeUndefined()
  })
})
