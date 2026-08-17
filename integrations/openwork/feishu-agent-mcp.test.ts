import { describe, expect, test } from "bun:test";

import { normalizeFeishuCliAuthorization } from "./feishu-agent-mcp.js";

describe("Feishu CLI authorization normalization", () => {
  test("accepts a ready user identity", () => {
    expect(normalizeFeishuCliAuthorization({
      profile: "wodeappx",
      appId: "cli_test",
      identity: "user",
      available: true,
      tokenStatus: "ready",
      onBehalfOf: {
        userName: "Test User",
        openId: "ou_test",
      },
    })).toEqual({
      available: true,
      authorized: true,
      profile: "wodeappx",
      appId: "cli_test",
      userName: "Test User",
      userOpenId: "ou_test",
      tokenStatus: "ready",
      error: "",
    });
  });

  test("does not treat a bot-only identity as user authorization", () => {
    expect(normalizeFeishuCliAuthorization({
      profile: "wodeappx",
      appId: "cli_test",
      identity: "bot",
      available: true,
      tokenStatus: "ready",
    })).toMatchObject({
      available: true,
      authorized: false,
      profile: "wodeappx",
      tokenStatus: "ready",
    });
  });

  test("fails closed for malformed CLI output", () => {
    expect(normalizeFeishuCliAuthorization(null)).toMatchObject({
      available: false,
      authorized: false,
      profile: "",
      userOpenId: "",
    });
  });
});
