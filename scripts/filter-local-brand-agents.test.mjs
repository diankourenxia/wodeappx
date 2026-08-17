import assert from "node:assert/strict";
import test from "node:test";

import { stripWynneAgentFromOpenworkConfig } from "./filter-local-brand-agents.mjs";

test("strips Wynne agent prompt and agent block from runtime config", () => {
  const input = `
const OPENWORK_AGENT_PROMPT = \`You are WodeAppX\`;

const WYNNE_AGENT_PROMPT = \`You are Wynne 品牌智能体.

- Follow the active runtime_profile.\`;

export function build() {
  return {
    agent: {
      openwork: {
        description: "default",
        prompt: OPENWORK_AGENT_PROMPT,
      },
      "wynne-brand-agent": {
        description: "Wynne 品牌智能体 runtime agent",
        mode: "primary",
        hidden: true,
        prompt: WYNNE_AGENT_PROMPT,
      },
      other: {
        description: "keep",
      },
    },
  };
}
`;

  const next = stripWynneAgentFromOpenworkConfig(input);
  assert.equal(next.includes("WYNNE_AGENT_PROMPT"), false);
  assert.equal(next.includes("wynne-brand-agent"), false);
  assert.equal(next.includes("You are Wynne"), false);
  assert.equal(next.includes("openwork:"), true);
  assert.equal(next.includes('other:'), true);
});
