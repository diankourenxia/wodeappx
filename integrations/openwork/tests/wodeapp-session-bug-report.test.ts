import { describe, expect, test } from "bun:test";
import {
  buildSessionBugInvestigationDisplayText,
  buildSessionBugInvestigationPrompt,
  buildSessionBugInvestigationTask,
} from "../wodeapp/wodeapp-session-bug-report-prompt";

describe("session bug investigation prompt", () => {
  test("display text includes session id", () => {
    expect(buildSessionBugInvestigationDisplayText("ses_0357fbf67ffefCzXUlKpEfRuaQ")).toBe(
      "排查对话故障 ses_0357fbf67ffefCzXUlKpEfRuaQ",
    );
  });

  test("prompt is empirical and includes session id + debug json", () => {
    const prompt = buildSessionBugInvestigationPrompt({
      workspaceId: "ws_test",
      sessionId: "ses_0357fbf67ffefCzXUlKpEfRuaQ",
      workspaceRoot: "/Users/example/wodeapp",
      sessionError: "URL scheme must be http, https, or data, got file:",
      sessionStatus: "idle",
      messageCount: 32,
      wodeappWorkbench: true,
    });
    expect(prompt).toContain("ses_0357fbf67ffefCzXUlKpEfRuaQ");
    expect(prompt).toContain("sqlite3");
    expect(prompt).toContain("opencode.db");
    expect(prompt).toContain("假说");
    expect(prompt).toContain("got file:");
    expect(prompt).toContain("```json");
    expect(prompt).toContain('"sessionId": "ses_0357fbf67ffefCzXUlKpEfRuaQ"');
    expect(prompt).toContain("最近");
    expect(prompt).toContain("项目");
  });

  test("task auto-sends with agent message longer than display", () => {
    const task = buildSessionBugInvestigationTask({
      workspaceId: "ws_test",
      sessionId: "ses_abc",
      workspaceRoot: "/tmp",
    });
    expect(task.autoSend).toBe(true);
    expect(task.displayText).toBe("排查对话故障 ses_abc");
    expect(task.agentMessage.length).toBeGreaterThan(task.displayText.length);
  });
});
