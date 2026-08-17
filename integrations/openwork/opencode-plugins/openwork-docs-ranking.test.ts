import { describe, expect, test } from "bun:test";

import { openWorkDocsQueryTerms, rankOpenWorkDocs } from "./openwork-docs-ranking.js";

const docs = [
  {
    path: "start-here/connect-your-stack/connect-slack-mcp.mdx",
    title: "Connect Slack MCP",
    description: "Connect OpenWork to Slack through MCP.",
    content: "Follow the authorization flow, then verify the Slack connection.",
  },
  {
    path: "reference/missing-languages.mdx",
    title: "Missing languages",
    description: "Language support notes.",
    content: "Some providers accept video input. Language availability varies.",
  },
  {
    path: "guides/video-models.mdx",
    title: "Video models",
    description: "Configure video providers and model access.",
    content: "Choose a provider and test video generation.",
  },
];

describe("OpenWork docs ranking", () => {
  test("returns a strong path/title match", () => {
    const matches = rankOpenWorkDocs(docs, "connect slack mcp");

    expect(matches).toHaveLength(1);
    expect(matches[0]?.entry.path).toContain("connect-slack-mcp");
    expect(matches[0]?.coverage).toBe(1);
  });

  test("rejects a body-only incidental token", () => {
    const matches = rankOpenWorkDocs(docs, "wodeapp video storyboard subjects");

    expect(matches).toEqual([]);
  });

  test("requires a strong field for a one-term query", () => {
    const matches = rankOpenWorkDocs(docs, "video");

    expect(matches.map((match) => match.entry.path)).toEqual(["guides/video-models.mdx"]);
  });

  test("drops product and documentation noise terms without discarding technical terms", () => {
    expect(openWorkDocsQueryTerms("WodeAppX API docs storyboard subjects")).toEqual([
      "api",
      "storyboard",
      "subjects",
    ]);
  });
});
