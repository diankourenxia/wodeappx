import { describe, expect, test } from "bun:test";

import { buildWodeAppToolSearch } from "./wodeapp-tool-discovery.js";

function fakeInput(): any {
  return {
    directory: "/workspace",
    client: {
      config: {
        async get() {
          return {
            data: {
              model: "wodeapp/wode/minimax-m3",
              mcp: {
                "lark-mcp": { type: "local" },
                "custom-db": { type: "remote" },
              },
            },
          };
        },
      },
      mcp: {
        async status() {
          return {
            data: {
              "lark-mcp": { status: "connected" },
              "custom-db": { status: "connected" },
              "paused-mcp": { status: "disabled" },
            },
          };
        },
      },
      tool: {
        async ids() {
          return {
            data: [
              "read",
              "lark-mcp_search_docs",
              "custom-db_query_database",
              "installed_plugin_publish_report",
            ],
          };
        },
        async list() {
          return {
            data: [
              {
                id: "read",
                description: "Read a local file.",
                parameters: {
                  type: "object",
                  properties: { filePath: { type: "string" } },
                  required: ["filePath"],
                },
              },
              {
                id: "lark-mcp_search_docs",
                description: "Search Feishu or Lark documents.",
                parameters: {
                  type: "object",
                  properties: { query: { type: "string" } },
                  required: ["query"],
                },
              },
              {
                id: "custom-db_query_database",
                description: "Run a read-only SQL database query.",
                parameters: {
                  type: "object",
                  properties: { sql: { type: "string" } },
                  required: ["sql"],
                },
              },
              {
                id: "installed_plugin_publish_report",
                description: "Publish a report through an installed plugin.",
                parameters: {
                  type: "object",
                  properties: { reportId: { type: "string" } },
                  required: ["reportId"],
                },
              },
            ],
          };
        },
      },
    },
  };
}

describe("WodeAppX live tool discovery", () => {
  test("rejects an empty capability query before registry access", async () => {
    const tool = buildWodeAppToolSearch(fakeInput());

    await expect(tool.execute({ query: "" })).rejects.toThrow();
  });

  test("searches connected MCP and installed plugin tools from the live registry", async () => {
    const tool = buildWodeAppToolSearch(fakeInput());
    const raw = await tool.execute({ query: "飞书文档", source: "all" });
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.totalAvailable).toBe(4);
    expect(result.connectedMcpServers).toEqual(["custom-db", "lark-mcp"]);
    expect(result.mcpStatusAvailable).toBe(true);
    expect(result.mcpServerMatches).toEqual([]);
    expect(result.matches[0]).toMatchObject({
      id: "lark-mcp_search_docs",
      source: "mcp",
      mcpServer: "lark-mcp",
      inputKeys: ["query"],
      required: ["query"],
    });
  });

  test("can restrict search to MCP tools without a hardcoded provider catalog", async () => {
    const tool = buildWodeAppToolSearch(fakeInput());
    const raw = await tool.execute({ query: "database query", source: "mcp" });
    const result = JSON.parse(raw);

    expect(result.matches.map((match: { id: string }) => match.id)).toEqual([
      "custom-db_query_database",
    ]);
  });

  test("reports connected MCP servers even when OpenCode omits their tool schemas", async () => {
    const input = fakeInput();
    input.client.config.get = async () => ({
      data: {
        model: "wodeapp/wode/minimax-m3",
        mcp: {},
      },
    });
    input.client.mcp.status = async () => ({
      data: {
        "feishu-agent-mcp": { status: "connected" },
        "offline-calendar": { status: "failed" },
      },
    });
    input.client.tool.ids = async () => ({ data: ["read"] });
    input.client.tool.list = async () => ({
      data: [{
        id: "read",
        description: "Read a local file.",
        parameters: { type: "object", properties: {} },
      }],
    });

    const tool = buildWodeAppToolSearch(input);
    const raw = await tool.execute({ query: "飞书文档", source: "mcp" });
    const result = JSON.parse(raw);

    expect(result.connectedMcpServers).toEqual(["feishu-agent-mcp"]);
    expect(result.matches).toEqual([]);
    expect(result.mcpServerMatches).toEqual([{
      id: "feishu-agent-mcp",
      source: "mcp",
      kind: "connected_mcp_server",
      status: "connected",
      toolCatalogAvailable: false,
      callable: false,
    }]);
    expect(result.nextActions).toEqual([
      "use_matching_connected_mcp_tools_in_a_normal_prompt",
    ]);
  });

  test("falls back to live IDs when model-specific schemas are unavailable", async () => {
    const input = fakeInput();
    input.client.tool.list = async () => {
      throw new Error("provider unavailable");
    };
    const tool = buildWodeAppToolSearch(input);
    const raw = await tool.execute({ query: "publish report" });
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.schemaAvailable).toBe(false);
    expect(result.matches[0]).toMatchObject({
      id: "installed_plugin_publish_report",
      source: "local",
    });
  });

  test("returns a recoverable dependency error when the live registry is absent", async () => {
    const tool = buildWodeAppToolSearch({});
    const raw = await tool.execute({ query: "calendar" });
    const result = JSON.parse(raw);

    expect(result).toMatchObject({
      ok: false,
      recoverable: true,
      errorKind: "dependency",
      data: {
        code: "LIVE_TOOL_REGISTRY_UNAVAILABLE",
        fallbackTool: "wodeappx_list_capabilities",
      },
    });
  });
});
