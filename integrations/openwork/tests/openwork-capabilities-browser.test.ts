import { describe, expect, test } from "bun:test";

import { OpenWorkCapabilitiesKnowledge } from "../../../vendor/openwork/apps/server/src/opencode-plugins/openwork-capabilities-knowledge";

describe("WodeAppX browser capability discovery", () => {
  test("searches the live registry instead of a fixed integration catalog", async () => {
    const plugin = await OpenWorkCapabilitiesKnowledge({
      directory: "/workspace",
      client: {
        config: {
          async get() {
            return {
              data: {
                model: "wodeapp/wode/minimax-m3",
                mcp: {
                  "calendar-mcp": { type: "remote" },
                },
              },
            };
          },
        },
        tool: {
          async ids() {
            return {
              data: [
                "calendar-mcp_list_events",
                "installed_plugin_create_document",
              ],
            };
          },
          async list() {
            return {
              data: [{
                id: "calendar-mcp_list_events",
                description: "List events from the connected calendar.",
                parameters: {
                  type: "object",
                  properties: { start: { type: "string" } },
                },
              }],
            };
          },
        },
      },
    });
    const raw = await plugin.tool.wodeappx_search_tools.execute({
      query: "calendar events",
    });
    const result = JSON.parse(raw);

    expect(result.ok).toBe(true);
    expect(result.matches[0]).toMatchObject({
      id: "calendar-mcp_list_events",
      source: "mcp",
      mcpServer: "calendar-mcp",
    });
  });

  test("natural multi-term Chrome queries return the WodeAppX extension surface", async () => {
    const plugin = await OpenWorkCapabilitiesKnowledge();
    const raw = await plugin.tool.wodeappx_list_capabilities.execute({
      detail: "tools",
      query: "chrome 插件 操作",
    });
    const result = JSON.parse(raw);

    expect(result.note).toContain("does not mutate");
    expect(result.capabilities).toHaveLength(1);
    expect(result.capabilities[0].id).toBe("browser");
    expect(result.capabilities[0].toolFamilies).toContain("wodeappx_browser_status");
    expect(result.capabilities[0].toolFamilies).toContain("wodeappx_browser_read_page");
    expect(result.capabilities[0].toolFamilies).not.toContain("browser_*");
    expect(result.capabilities[0].toolFamilies).not.toContain("openwork_chrome_*");
  });

  test("exact category filtering does not require every query word to match", async () => {
    const plugin = await OpenWorkCapabilitiesKnowledge();
    const raw = await plugin.tool.wodeappx_list_capabilities.execute({
      category: "browser",
      query: "登录态 页面 操作",
    });
    const result = JSON.parse(raw);

    expect(result.capabilities.map((item: { id: string }) => item.id)).toEqual(["browser"]);
  });
});
