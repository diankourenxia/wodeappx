/**
 * Prebuilt DSH bundle entry. Import scoped cordis only if a host injects it.
 * This file does not import Electron, vendor HTTP clients, or keys.json.
 */
import {
  applyEvolve,
  browserCdp,
  describeModels,
  listHandbookAgents,
  openHandbookAgent,
  planEvolve,
  probeBridgeHealth,
} from "./lib/core.js";

export const name = "wodeappx-dsh";
export const inject = ["tools"];

function tool(name, description, parameters, execute) {
  return {
    name,
    description,
    parameters,
    output: {
      schema: { type: "object" },
      render(_args, value) {
        return [{ type: "text", text: JSON.stringify(value) }];
      },
    },
    execute,
  };
}

export function apply(ctx) {
  ctx.tools.register(tool(
    "wodeappx_list_agents",
    "List handbook agents (image/video) and their workbenches. No skills/sites schema.",
    {},
    async () => ({ ok: true, agents: listHandbookAgents() }),
  ));
  ctx.tools.register(tool(
    "wodeappx_open_agent",
    "Open a handbook agent workbench via existing runtime. No vendor HTTP.",
    { id: { type: "string" } },
    async ({ id }) => openHandbookAgent(id),
  ));
  ctx.tools.register(tool(
    "wodeappx_models",
    "One OpenAI-compatible model row. Keys stay in local keys.json.",
    {},
    async () => describeModels(),
  ));
  ctx.tools.register(tool(
    "wodeappx_browser_status",
    "Probe 127.0.0.1:17654/health. Down: GitHub releases, do not launch Electron.",
    { force: { type: "boolean" } },
    async ({ force } = {}) => probeBridgeHealth({ force }),
  ));
  ctx.tools.register(tool(
    "wodeappx_browser_cdp",
    "CDP through the existing bridge. Requires userConfirmed.",
    { userConfirmed: { type: "boolean" } },
    async ({ userConfirmed } = {}) => browserCdp({ userConfirmed }),
  ));
  ctx.tools.register(tool(
    "wodeappx_evolve",
    "Self-evolve: backup, verify, rollback. Requires userConfirmed. No unattended rewrite.",
    {
      action: { type: "string" },
      id: { type: "string" },
      userConfirmed: { type: "boolean" },
    },
    async (input = {}) => (input.userConfirmed === true ? applyEvolve(input) : { ok: false, plan: planEvolve(input), error: "evolve requires userConfirmed" }),
  ));
}
