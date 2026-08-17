import { z } from "zod";

type OpenCodeClientResult<T> = T | {
  data?: T;
  error?: unknown;
};

type OpenCodeToolListItem = {
  id?: unknown;
  description?: unknown;
  parameters?: unknown;
};

type WodeAppToolDiscoveryClient = {
  config?: {
    get?: (options?: unknown) => Promise<OpenCodeClientResult<Record<string, unknown>>>;
  };
  mcp?: {
    status?: (options?: unknown) => Promise<OpenCodeClientResult<Record<string, unknown>>>;
  };
  tool?: {
    ids?: (options?: unknown) => Promise<OpenCodeClientResult<unknown[]>>;
    list?: (options: unknown) => Promise<OpenCodeClientResult<OpenCodeToolListItem[]>>;
  };
};

export type WodeAppToolDiscoveryInput = {
  client?: WodeAppToolDiscoveryClient;
  directory?: string;
};

type ToolSearchContext = {
  directory?: string;
};

type LiveTool = {
  id: string;
  description: string;
  parameters: unknown;
};

const toolSearchArgsSchema = z.object({
  query: z.string().min(1).describe("Describe the capability or integration needed, for example 'search Slack messages', '飞书文档', or 'database query'."),
  source: z.enum(["all", "mcp", "local"]).optional().describe("Optionally restrict results to connected MCP tools or local/plugin tools."),
  limit: z.number().int().min(1).max(30).optional().describe("Maximum matches to return. Defaults to 12."),
});

export const WODEAPP_TOOL_DISCOVERY_TOOL_NAME = "wodeappx_search_tools";

const QUERY_ALIASES: Readonly<Record<string, readonly string[]>> = {
  飞书: ["feishu", "lark"],
  文档: ["doc", "docs", "document"],
  表格: ["sheet", "spreadsheet", "table"],
  数据库: ["database", "db", "sql"],
  邮件: ["mail", "email", "gmail", "outlook"],
  日历: ["calendar", "schedule"],
  消息: ["message", "messages", "chat"],
  搜索: ["search", "find", "query"],
  查询: ["query", "search", "list"],
  创建: ["create", "add", "new"],
  修改: ["update", "edit", "change"],
  删除: ["delete", "remove"],
  文件: ["file", "files", "drive", "storage"],
};

function unwrapClientResult<T>(result: OpenCodeClientResult<T>): T | null {
  if (result && typeof result === "object" && !Array.isArray(result) && "data" in result) {
    return (result as { data?: T }).data ?? null;
  }
  return result as T;
}

function normalizedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeToolList(value: unknown): LiveTool[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as OpenCodeToolListItem;
    const id = normalizedString(record.id);
    if (!id) return [];
    return [{
      id,
      description: normalizedString(record.description),
      parameters: record.parameters,
    }];
  });
}

function normalizeToolIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizedString).filter(Boolean);
}

function parseConfiguredModel(config: Record<string, unknown> | null): {
  provider: string;
  model: string;
} | null {
  const value = normalizedString(config?.model);
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) return null;
  return {
    provider: value.slice(0, slash),
    model: value.slice(slash + 1),
  };
}

function configuredMcpServerNames(config: Record<string, unknown> | null): string[] {
  const mcp = config?.mcp;
  if (!mcp || typeof mcp !== "object" || Array.isArray(mcp)) return [];
  return Object.keys(mcp)
    .map((name) => name.trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
}

function connectedMcpServerNames(status: Record<string, unknown> | null): string[] {
  if (!status) return [];
  return Object.entries(status)
    .flatMap(([name, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const state = normalizedString((value as Record<string, unknown>).status).toLowerCase();
      return state === "connected" ? [name.trim()] : [];
    })
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
}

function uniqueNames(...groups: string[][]): string[] {
  return [...new Set(groups.flat())].sort((left, right) => right.length - left.length);
}

function toolSource(id: string, mcpServers: string[]): {
  source: "mcp" | "local";
  mcpServer?: string;
} {
  const server = mcpServers.find((name) => id === name || id.startsWith(`${name}_`));
  return server ? { source: "mcp", mcpServer: server } : { source: "local" };
}

function scoreText(id: string, description: string, query: string, terms: string[]): number {
  const normalizedId = id.toLowerCase();
  const normalizedDescription = description.toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();
  let score = 0;
  if (normalizedId === normalizedQuery) score += 500;
  if (normalizedId.includes(normalizedQuery)) score += 180;
  if (normalizedDescription.includes(normalizedQuery)) score += 120;
  for (const term of terms) {
    if (normalizedId === term) score += 120;
    else if (normalizedId.includes(term)) score += 40;
    if (normalizedDescription.includes(term)) score += 24;
  }
  return score;
}

function queryTerms(query: string): string[] {
  const base = query
    .toLowerCase()
    .split(/[\s,，。.!！?？:：;；/\\|()[\]{}"'`~_-]+/)
    .map((term) => term.trim())
    .filter(Boolean);
  const expanded = base.flatMap((term) => [term, ...(QUERY_ALIASES[term] ?? [])]);
  for (const [term, aliases] of Object.entries(QUERY_ALIASES)) {
    if (query.includes(term)) expanded.push(term, ...aliases);
  }
  return [...new Set(expanded)];
}

function scoreTool(tool: LiveTool, query: string, terms: string[]): number {
  return scoreText(tool.id, tool.description, query, terms);
}

function parameterSummary(parameters: unknown): {
  inputKeys: string[];
  required: string[];
} | undefined {
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return undefined;
  const record = parameters as Record<string, unknown>;
  const properties = record.properties;
  const inputKeys = properties && typeof properties === "object" && !Array.isArray(properties)
    ? Object.keys(properties).slice(0, 20)
    : [];
  const required = Array.isArray(record.required)
    ? record.required.map(normalizedString).filter(Boolean).slice(0, 20)
    : [];
  return inputKeys.length || required.length ? { inputKeys, required } : undefined;
}

async function readRuntimeToolCatalog(
  input: WodeAppToolDiscoveryInput,
  directory: string,
): Promise<{
  tools: LiveTool[];
  configuredMcpServers: string[];
  mcpServers: string[];
  toolNamespaceServers: string[];
  mcpStatusAvailable: boolean;
  schemaAvailable: boolean;
}> {
  const client = input.client;
  if (!client?.tool?.ids) {
    throw new Error("Local engine live tool registry is unavailable");
  }

  let config: Record<string, unknown> | null = null;
  if (client.config?.get) {
    try {
      config = unwrapClientResult(await client.config.get({
        query: directory ? { directory } : undefined,
      }));
    } catch {
      config = null;
    }
  }

  let mcpStatus: Record<string, unknown> | null = null;
  let mcpStatusAvailable = false;
  if (client.mcp?.status) {
    try {
      mcpStatus = unwrapClientResult(await client.mcp.status({
        query: directory ? { directory } : undefined,
      }));
      mcpStatusAvailable = Boolean(mcpStatus);
    } catch {
      mcpStatus = null;
    }
  }

  const configuredMcpServers = configuredMcpServerNames(config);
  const connectedMcpServers = connectedMcpServerNames(mcpStatus);
  const mcpServers = mcpStatusAvailable ? connectedMcpServers : configuredMcpServers;
  const toolNamespaceServers = uniqueNames(
    configuredMcpServers,
    connectedMcpServers,
  );

  const idsResult = await client.tool.ids({
    query: directory ? { directory } : undefined,
  });
  const ids = normalizeToolIds(unwrapClientResult(idsResult));
  const model = parseConfiguredModel(config);

  if (model && client.tool.list) {
    try {
      const listed = normalizeToolList(unwrapClientResult(await client.tool.list({
        query: {
          ...(directory ? { directory } : {}),
          provider: model.provider,
          model: model.model,
        },
      })));
      if (listed.length) {
        const listedIds = new Set(listed.map((tool) => tool.id));
        return {
          tools: [
            ...listed,
            ...ids.filter((id) => !listedIds.has(id)).map((id) => ({
              id,
              description: "",
              parameters: undefined,
            })),
          ],
          configuredMcpServers,
          mcpServers,
          toolNamespaceServers,
          mcpStatusAvailable,
          schemaAvailable: true,
        };
      }
    } catch {
      // Tool IDs are still a valid live fallback when a model-specific schema
      // projection cannot be generated.
    }
  }

  return {
    tools: ids.map((id) => ({ id, description: "", parameters: undefined })),
    configuredMcpServers,
    mcpServers,
    toolNamespaceServers,
    mcpStatusAvailable,
    schemaAvailable: false,
  };
}

export function buildWodeAppToolSearch(input: WodeAppToolDiscoveryInput = {}) {
  return {
    description: "Search the live WodeAppX/OpenCode local and plugin tool registry, plus connected MCP availability. MCP tool details are returned when OpenCode exposes them through its public tool catalog; otherwise the connected server is reported separately. This is read-only and does not install, connect, or execute a tool.",
    args: toolSearchArgsSchema.shape,
    async execute(rawArgs: unknown, context: ToolSearchContext = {}) {
      const args = toolSearchArgsSchema.parse(rawArgs);
      const directory = normalizedString(context.directory) || normalizedString(input.directory);
      try {
        const catalog = await readRuntimeToolCatalog(input, directory);
        const terms = queryTerms(args.query);
        const rankedTools = catalog.tools
          .map((tool) => ({
            tool,
            score: scoreTool(tool, args.query, terms),
            ...toolSource(tool.id, catalog.toolNamespaceServers),
          }))
          .filter((entry) => entry.score > 0)
          .filter((entry) => !args.source || args.source === "all" || entry.source === args.source)
          .sort((left, right) => right.score - left.score || left.tool.id.localeCompare(right.tool.id));
        const matches = rankedTools
          .slice(0, args.limit ?? 12)
          .map((entry) => ({
            id: entry.tool.id,
            source: entry.source,
            ...(entry.mcpServer ? { mcpServer: entry.mcpServer } : {}),
            ...(entry.tool.description ? { description: entry.tool.description.slice(0, 320) } : {}),
            ...parameterSummary(entry.tool.parameters),
          }));
        const mcpServersWithVisibleTools = uniqueNames(
          catalog.tools.flatMap((tool) => {
            const source = toolSource(tool.id, catalog.toolNamespaceServers);
            return source.source === "mcp" && source.mcpServer ? [source.mcpServer] : [];
          }),
        );
        const statusOnlyMcpServers = catalog.mcpServers
          .filter((server) => !catalog.tools.some((tool) => toolSource(tool.id, [server]).source === "mcp"));
        const mcpServerMatches = args.source === "local"
          ? []
          : statusOnlyMcpServers
            .map((server) => ({
              id: server,
              source: "mcp" as const,
              kind: "connected_mcp_server" as const,
              status: "connected" as const,
              score: scoreText(server, "connected MCP integration server", args.query, terms),
              toolCatalogAvailable: false,
              callable: false,
            }))
            .filter((entry) => entry.score > 0)
            .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
            .slice(0, args.limit ?? 12)
            .map(({ score: _score, ...entry }) => entry);
        const found = matches.length > 0 || mcpServerMatches.length > 0;
        const warnings = [
          ...(!found
            ? ["No live tool or connected MCP server matched this wording. Try a broader capability or integration name."]
            : []),
          ...(mcpServerMatches.length
            ? ["Matched MCP servers are connected, but this OpenCode version does not expose their tool schemas through the public tool registry. The model still receives connected MCP tools directly during a normal prompt."]
            : []),
        ];

        return JSON.stringify({
          ok: true,
          executor: "local",
          stage: "search_live_tool_registry",
          query: args.query,
          totalAvailable: catalog.tools.length,
          connectedMcpServers: catalog.mcpServers,
          configuredMcpServers: catalog.configuredMcpServers,
          mcpStatusAvailable: catalog.mcpStatusAvailable,
          mcpServersWithVisibleTools,
          mcpServerMatches,
          schemaAvailable: catalog.schemaAvailable,
          matches,
          warnings,
          nextActions: matches.length
            ? ["call_the_best_matching_tool"]
            : mcpServerMatches.length
              ? ["use_matching_connected_mcp_tools_in_a_normal_prompt"]
              : ["broaden_query", "open_extensions_to_connect_a_provider"],
        }, null, 2);
      } catch (error) {
        return JSON.stringify({
          ok: false,
          recoverable: true,
          errorKind: "dependency",
          error: error instanceof Error ? error.message : "Live tool registry lookup failed",
          data: {
            code: "LIVE_TOOL_REGISTRY_UNAVAILABLE",
            fallbackTool: "wodeappx_list_capabilities",
          },
        }, null, 2);
      }
    },
  };
}

export function buildWodeAppToolDiscoveryTools(input: WodeAppToolDiscoveryInput = {}) {
  return {
    [WODEAPP_TOOL_DISCOVERY_TOOL_NAME]: buildWodeAppToolSearch(input),
  };
}
