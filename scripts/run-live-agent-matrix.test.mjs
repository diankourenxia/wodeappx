import test from "node:test";
import assert from "node:assert/strict";

import {
  activeEngineSessions,
  buildMatrix,
  compareTurnLatency,
  computeLatencySummary,
  evaluateTurn,
  summarizeRuntimeSignals,
} from "./run-live-agent-matrix.mjs";

function turn(overrides = {}) {
  return {
    finalAnswer: "完成：https://demo.wodeapp.cn/",
    enabledTools: [],
    disabledTools: [],
    toolCalls: [],
    timedOut: false,
    latencyMode: "fail",
    metrics: {
      sendToFirstUiTextMs: 1_000,
      sendToFirstEngineTextMs: 800,
      sendToFirstToolMs: 600,
      sendToCompleteMs: 2_000,
    },
    runtimeSignals: summarizeRuntimeSignals([]),
    ...overrides,
  };
}

test("matrix includes a no-tool/tool/no-tool latency regression case", () => {
  const matrix = buildMatrix("20260714", ["create_agent_app"]);
  const latency = matrix.find((item) => item.id === "latency-after-tool");
  assert.equal(latency.turns.length, 3);
  assert.equal(latency.turns[0].expected.noToolCall, true);
  assert.deepEqual(latency.turns[1].expected.requiredSuccessfulTools, ["wodeappx_list_capabilities"]);
  assert.equal(latency.turns[2].expected.noToolCall, true);
  assert.equal(latency.performanceComparison.metric, "sendToFirstUiTextMs");
});

test("web read accepts either public fetch or the built-in browser read path", () => {
  const matrix = buildMatrix("RUN", []);
  const webRead = matrix.find((item) => item.id === "web-read");
  assert.deepEqual(webRead.expected.toolCallAny, [
    "agent_reach_web_read",
    "wodeappx_browser_read_page",
    "browser_snapshot",
  ]);
});

test("Chrome extension live case is natural, external, and requires WodeAppX plugin tools", () => {
  const matrix = buildMatrix("RUN", []);
  const chrome = matrix.find((item) => item.id === "chrome-extension-control");
  assert.match(chrome.prompt, /WodeAppX Chrome 插件/);
  assert.match(chrome.prompt, /https:\/\/example\.com\//);
  assert.doesNotMatch(chrome.prompt, /wodeappx_browser_|clientId|tabId|localhost|127\.0\.0\.1/);
  assert.deepEqual(chrome.expected.requiredSuccessfulTools, [
    "wodeappx_browser_status",
    "wodeappx_browser_open_url",
    "wodeappx_browser_read_page",
  ]);
  assert.ok(chrome.expected.forbiddenToolCalls.includes("openwork_browser_open_url"));
  assert.ok(chrome.expected.forbiddenToolCalls.includes("wodeappx_browser_cdp"));
});

test("Chrome extension CDP live case requires identity, approval, exact CDP, and ordinary verification", () => {
  const matrix = buildMatrix("RUN", []);
  const chrome = matrix.find((item) => item.id === "chrome-extension-cdp-control");
  assert.match(chrome.prompt, /明确授权/);
  assert.match(chrome.prompt, /example\.com/);
  assert.match(chrome.prompt, /Runtime\.evaluate/);
  assert.match(chrome.prompt, /不要使用 ChatGPT Chrome 插件/);
  assert.deepEqual(chrome.expected.toolCallSequencesAny, [[
    "wodeappx_browser_status",
    "wodeappx_browser_open_url",
    "wodeappx_browser_cdp",
    "wodeappx_browser_read_page",
  ]]);
  assert.deepEqual(chrome.expected.requiredSuccessfulTools, [
    "wodeappx_browser_status",
    "wodeappx_browser_open_url",
    "wodeappx_browser_cdp",
    "wodeappx_browser_read_page",
  ]);
  assert.ok(chrome.expected.toolInputPatterns.wodeappx_browser_cdp.includes('"userConfirmed"\\s*:\\s*true'));
  assert.ok(chrome.expected.toolOutputPatterns.wodeappx_browser_status.includes('"extensionId"\\s*:\\s*"[a-p]{32}"'));
  assert.ok(chrome.expected.toolOutputPatterns.wodeappx_browser_status.includes('"supportsRawCdp"\\s*:\\s*true'));
  assert.ok(chrome.expected.forbiddenToolCalls.includes("openwork_chrome_execute_javascript"));
});

test("Chrome extension local CDP case is deterministic and still requires the native transport", () => {
  const matrix = buildMatrix("RUN", []);
  const chrome = matrix.find((item) => item.id === "chrome-extension-cdp-local");
  assert.match(chrome.prompt, /file:.*browser-control\/tests\/fixtures\/cdp-test\.html/);
  assert.match(chrome.prompt, /Runtime\.evaluate/);
  assert.ok(chrome.expected.toolOutputPatterns.wodeappx_browser_status.includes('"transport"\\s*:\\s*"native_messaging"'));
  assert.ok(chrome.expected.toolOutputPatterns.wodeappx_browser_status.includes('"hostBridgeTransport"\\s*:\\s*"unix_socket"'));
  assert.deepEqual(chrome.expected.requiredSuccessfulTools, [
    "wodeappx_browser_status",
    "wodeappx_browser_open_url",
    "wodeappx_browser_cdp",
    "wodeappx_browser_read_page",
  ]);
});

test("active-session preflight treats every non-idle engine state as interference", () => {
  assert.deepEqual(activeEngineSessions({
    ses_idle: { type: "idle" },
    ses_busy: { type: "busy" },
    ses_retry: { type: "retry" },
  }), [
    { sessionId: "ses_busy", status: "busy" },
    { sessionId: "ses_retry", status: "retry" },
  ]);
});

test("agent app matrix requires atomic create and a second real conversation", () => {
  const matrix = buildMatrix("RUN", ["create_agent_app"]);
  const agent = matrix.find((item) => item.id === "agent-app-create");
  assert.deepEqual(agent.turns[0].expected.toolCallSequencesAny, [["create_agent_app"]]);
  assert.equal(agent.turns[0].expected.maxEnabledTools, 12);
  assert.deepEqual(
    agent.turns[1].expected.toolCallSequencesAny[0],
    ["openwork_browser_open_url", "browser_snapshot", "browser_fill", "browser_click", "browser_snapshot"],
  );
  assert.deepEqual(agent.turns[1].expected.answerPatterns, ["PONG-RUN"]);
});

test("storyboard matrix stays on the direct preparation action", () => {
  const matrix = buildMatrix("RUN", []);
  const storyboard = matrix.find((item) => item.id === "storyboard-project-preparation");
  assert.equal(storyboard.expected.maxEnabledTools, 2);
  assert.deepEqual(storyboard.expected.toolCallAny, ["openwork_ui_execute_action"]);
  assert.deepEqual(storyboard.expected.toolCallSequencesAny, [["openwork_ui_execute_action"]]);
  assert.equal(storyboard.expected.maxToolCalls, 1);
  assert.deepEqual(storyboard.expected.disabledAll, [
    "product_video_storyboard_capability",
    "video_generate",
    "wodeapp_video_template_render",
    "wodeappx_browser_open_url",
    "bash",
    "task",
  ]);
  assert.deepEqual(storyboard.expected.toolInputPatterns, {
    openwork_ui_execute_action: ["wodeapp\\.video_storyboard\\.open"],
  });
  assert.deepEqual(storyboard.expected.storyboardPreparation, {
    sceneCount: 2,
    durationSec: 15,
    assetTag: "test-product.png",
    referenceUrl: "https://placehold.co/900x900/effaf3/1f6f5b.png?text=Storyboard+Test",
  });
});

test("storyboard contract validation checks scene details and reference preservation", () => {
  const expected = buildMatrix("RUN", []).find((item) => item.id === "storyboard-project-preparation").expected;
  const baseCall = {
    tool: "openwork_ui_execute_action",
    status: "completed",
    output: '{"ok":true}',
    input: {
      actionId: "wodeapp.video_storyboard.open",
      args: {
        scenes: [
          { duration: 15, prompt: "展示 test-product.png", assets: ["test-product.png"], referenceImages: [expected.storyboardPreparation.referenceUrl] },
          { duration: 15, prompt: "旋转 [test-product.png]", referenceImages: [expected.storyboardPreparation.referenceUrl] },
        ],
      },
    },
  };
  const passed = evaluateTurn(turn({
    enabledTools: ["wodeappx_list_capabilities", "openwork_ui_execute_action"],
    disabledTools: expected.disabledAll,
    toolCalls: [baseCall],
    finalAnswer: "分镜已准备",
  }), expected);
  assert.equal(passed.verdict, "PASS");

  const failed = evaluateTurn(turn({
    enabledTools: ["wodeappx_list_capabilities", "openwork_ui_execute_action"],
    disabledTools: expected.disabledAll,
    toolCalls: [{ ...baseCall, input: { ...baseCall.input, args: { scenes: [{ duration: 10, prompt: "无素材" }] } } }],
    finalAnswer: "分镜已准备",
  }), expected);
  assert.equal(failed.verdict, "FAIL");
  assert.match(failed.reason, /scene count mismatch/);
  assert.match(failed.reason, /reference image URL/);
});

test("ordered tool validation rejects publish before page update", () => {
  const result = evaluateTurn(turn({
    toolCalls: [
      { tool: "create_project", status: "completed", output: '{"success":true}' },
      { tool: "publish_project", status: "completed", output: '{"success":true}' },
      { tool: "update_page", status: "completed", output: '{"success":true}' },
    ],
  }), {
    toolCallSequencesAny: [["create_project", "update_page", "publish_project"]],
  });
  assert.equal(result.verdict, "FAIL");
  assert.match(result.reason, /ordered tool sequences/);
});

test("tool input validation rejects the wrong action id", () => {
  const result = evaluateTurn(turn({
    toolCalls: [{ tool: "openwork_ui_execute_action", status: "completed", input: { actionId: "composer.set_text" }, output: '{"ok":true}' }],
  }), {
    toolInputPatterns: { openwork_ui_execute_action: ["wodeapp\\.video_storyboard\\.open"] },
  });
  assert.equal(result.verdict, "FAIL");
  assert.match(result.reason, /input did not match/);
});

test("duplicate publish and failed required tools are release failures", () => {
  const result = evaluateTurn(turn({
    toolCalls: [
      { tool: "publish_project", status: "error", output: '{"success":false,"error":"boom"}' },
      { tool: "publish_project", status: "completed", output: '{"success":true}' },
    ],
  }), {
    requiredSuccessfulTools: ["publish_project"],
    maxCallsByTool: { publish_project: 1 },
  });
  assert.equal(result.verdict, "FAIL");
  assert.match(result.reason, /maximum is 1/);
});

test("tool-call budget overflow fails and an external abort is inconclusive", () => {
  const overflow = evaluateTurn(turn({
    toolCallBudgetExceeded: { observed: 21, limit: 20 },
  }), {});
  assert.equal(overflow.verdict, "FAIL");
  assert.match(overflow.reason, /hard tool-call budget exceeded/);

  const aborted = evaluateTurn(turn({
    finalAnswer: "",
    models: [{ error: { name: "MessageAbortedError", data: { message: "Aborted" } } }],
  }), {});
  assert.equal(aborted.verdict, "INCONCLUSIVE");
  assert.match(aborted.reason, /response was aborted/);
});

test("published URL probe must independently succeed", () => {
  const result = evaluateTurn(turn({
    urlProbes: [{ url: "https://demo.wodeapp.cn/", ok: true, status: 200, notFoundSignal: false }],
  }), { probePublishedUrl: true });
  assert.equal(result.verdict, "PASS");
  assert.match(result.evidence.join("\n"), /HTTP 200/);
});

test("runtime exceptions and server errors fail a clean-runtime assertion", () => {
  const signals = summarizeRuntimeSignals([
    { type: "runtime.exception", text: "boom" },
    { type: "network.response", status: 500, url: "https://example.invalid" },
  ]);
  const result = evaluateTurn(turn({ runtimeSignals: signals }), { noRuntimeErrors: true });
  assert.equal(result.verdict, "FAIL");
  assert.match(result.reason, /runtime\/network errors/);

  const consoleOnly = evaluateTurn(turn({
    runtimeSignals: summarizeRuntimeSignals([{ type: "console.error", text: "React render warning" }]),
  }), { noRuntimeErrors: true });
  assert.equal(consoleOnly.verdict, "FAIL");
  assert.match(consoleOnly.reason, /console=1/);
});

test("latency budgets warn by default and fail in strict mode", () => {
  const slow = turn({ metrics: { sendToFirstUiTextMs: 30_000 }, latencyMode: "warn" });
  const warned = evaluateTurn(slow, { latencyBudget: { firstUiTextMs: 20_000 } });
  assert.equal(warned.verdict, "PASS");
  assert.match(warned.evidence.join("\n"), /latency warning/);

  const failed = evaluateTurn({ ...slow, latencyMode: "fail" }, { latencyBudget: { firstUiTextMs: 20_000 } });
  assert.equal(failed.verdict, "FAIL");
});

test("post-tool latency comparison needs both a large ratio and delta", () => {
  const turns = [
    { metrics: { sendToFirstUiTextMs: 2_000 } },
    { metrics: { sendToFirstUiTextMs: 1_000 } },
    { metrics: { sendToFirstUiTextMs: 15_000 } },
  ];
  const comparison = compareTurnLatency(turns, {
    baselineTurn: 1,
    candidateTurn: 3,
    metric: "sendToFirstUiTextMs",
    maxRatio: 2.5,
    maxDeltaMs: 10_000,
  }, "fail");
  assert.equal(comparison.verdict, "FAIL");
  assert.equal(comparison.deltaMs, 13_000);
});

test("latency summary reports median, p95, and max", () => {
  const summary = computeLatencySummary([{ turns: [
    { metrics: { sendToFirstUiTextMs: 100, sendToCompleteMs: 1_000 } },
    { metrics: { sendToFirstUiTextMs: 200, sendToCompleteMs: 2_000 } },
    { metrics: { sendToFirstUiTextMs: 900, sendToCompleteMs: 3_000 } },
  ] }]);
  assert.equal(summary.firstUiText.medianMs, 200);
  assert.equal(summary.firstUiText.p95Ms, 900);
  assert.equal(summary.completion.maxMs, 3_000);
});
