#!/usr/bin/env node
/**
 * Cross-turn sticky-loaded A/B against a patched OpenCode binary.
 *
 * Arm A (default sticky): tool_search loads a deferred tool on turn 1;
 * turn 2 must still expose that tool without another tool_search.
 * Arm B (OPENCODE_STICKY_LOADED=0): turn 2 must drop the deferred tool.
 *
 * Also checks same-turn empty-write thrash breaker.
 *
 * Usage:
 *   node scripts/test-sticky-loaded-ab.mjs --binary <path>
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const wodeappxRoot = path.resolve(scriptDir, "..");

function readArg(name) {
  const args = process.argv.slice(2);
  const direct = args.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function sseChunk(payload) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function toolCallChunks(name, args, callID) {
  const created = Math.floor(Date.now() / 1000);
  return [
    {
      id: `chatcmpl-${callID}`,
      object: "chat.completion.chunk",
      created,
      model: "fake",
      choices: [{
        index: 0,
        delta: {
          role: "assistant",
          tool_calls: [{
            index: 0,
            id: callID,
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          }],
        },
        finish_reason: null,
      }],
    },
    {
      id: `chatcmpl-${callID}`,
      object: "chat.completion.chunk",
      created,
      model: "fake",
      choices: [{
        index: 0,
        delta: {},
        finish_reason: "tool_calls",
      }],
    },
  ];
}

function textChunks(text, id = "final") {
  const created = Math.floor(Date.now() / 1000);
  return [
    {
      id: `chatcmpl-${id}`,
      object: "chat.completion.chunk",
      created,
      model: "fake",
      choices: [{
        index: 0,
        delta: { role: "assistant", content: text },
        finish_reason: null,
      }],
    },
    {
      id: `chatcmpl-${id}`,
      object: "chat.completion.chunk",
      created,
      model: "fake",
      choices: [{
        index: 0,
        delta: {},
        finish_reason: "stop",
      }],
    },
  ];
}

function requestToolNames(body) {
  if (!Array.isArray(body.tools)) return [];
  return body.tools.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const fn = item.function;
    if (!fn || typeof fn !== "object" || Array.isArray(fn)) return [];
    return typeof fn.name === "string" ? [fn.name] : [];
  });
}

function hasToolResult(body, toolName) {
  if (!Array.isArray(body.messages)) return false;
  return body.messages.some((message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return false;
    if (message.role !== "assistant" || !Array.isArray(message.tool_calls)) return false;
    return message.tool_calls.some((call) =>
      call
      && typeof call === "object"
      && !Array.isArray(call)
      && call.function
      && typeof call.function === "object"
      && !Array.isArray(call.function)
      && call.function.name === toolName
    );
  });
}

function userText(body) {
  if (!Array.isArray(body.messages)) return "";
  for (let i = body.messages.length - 1; i >= 0; i -= 1) {
    const message = body.messages[i];
    if (!message || typeof message !== "object" || Array.isArray(message)) continue;
    if (message.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .map((part) => (part && typeof part === "object" && typeof part.text === "string" ? part.text : ""))
        .join("\n");
    }
  }
  return "";
}

function captureChildOutput(child) {
  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  return {
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

async function stopChild(child) {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      resolve();
    }, 3_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function getFreePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = address && typeof address !== "string" ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  if (!port) throw new Error("Failed to allocate free port");
  return port;
}

async function waitFor(label, predicate, timeoutMs = 20_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeoutMs) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ""}`);
}

async function requestJson(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    throw new Error(`${init?.method ?? "GET"} ${url} -> ${response.status}: ${text.slice(0, 1000)}`);
  }
  return body;
}

async function runArm({ binary, stickyEnabled }) {
  const root = await mkdtemp(path.join(tmpdir(), "wodeappx-sticky-ab-"));
  let modelServer;
  let opencodeChild;
  const requests = [];
  try {
    const pluginPackage = path.join(
      wodeappxRoot,
      "vendor",
      "openwork",
      ".opencode",
      "node_modules",
      "@opencode-ai",
      "plugin",
      "dist",
      "index.js",
    );
    const pluginPath = path.join(root, "fixture-plugin.mjs");
    await writeFile(pluginPath, `import { tool } from ${JSON.stringify(pathToFileURL(pluginPackage).href)};

export const DynamicToolFixture = async () => ({
  tool: {
    publish_report: tool({
      description: "Publish a report to the connected reporting service.",
      args: {
        reportID: tool.schema.string().describe("Report identifier to publish."),
      },
      async execute(args) {
        return JSON.stringify({ ok: true, published: args.reportID });
      },
    }),
  },
});
`, "utf8");

    modelServer = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push(body);
      const text = userText(body);
      const tools = requestToolNames(body);

      let payload;
      if (text.includes("TURN2")) {
        // New user turn: answer immediately so we can inspect exposed tools.
        payload = textChunks(
          tools.includes("publish_report")
            ? "TURN2_HAS_PUBLISH"
            : "TURN2_MISSING_PUBLISH",
          `turn2-${requests.length}`,
        );
      } else if (hasToolResult(body, "publish_report")) {
        payload = textChunks("Published.", `pub-${requests.length}`);
      } else if (hasToolResult(body, "tool_search")) {
        payload = toolCallChunks("publish_report", { reportID: "report-1" }, `call-publish-${requests.length}`);
      } else if (text.includes("THRASH")) {
        const toolOutputs = (body.messages ?? [])
          .filter((message) => message?.role === "tool")
          .map((message) => (typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "")));
        const blocked = toolOutputs.some((content) => content.includes("EMPTY_WRITE_THRASH"));
        const writeResults = toolOutputs.filter((content) =>
          content.includes("Wrote")
          || content.includes("write")
          || content.includes("EMPTY_WRITE_THRASH")
          || content.includes("/tmp/m")
        ).length;
        if (blocked) {
          payload = textChunks("THRASH_BLOCKED", `thrash-${requests.length}`);
        } else if (writeResults >= 5) {
          payload = textChunks("THRASH_NOT_BLOCKED", `thrash-${requests.length}`);
        } else {
          payload = toolCallChunks(
            "write",
            { filePath: "/tmp/m", content: "" },
            `call-write-${requests.length}`,
          );
        }
      } else {
        payload = toolCallChunks("tool_search", { query: "publish external report" }, `call-search-${requests.length}`);
      }

      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      for (const item of payload) response.write(sseChunk(item));
      response.end("data: [DONE]\n\n");
    });
    await new Promise((resolve) => modelServer.listen(0, "127.0.0.1", resolve));
    const address = modelServer.address();
    if (!address || typeof address === "string") throw new Error("Failed to bind fake model server");

    const config = {
      model: "dynamic-test/fake",
      permission: { "*": "allow" },
      plugin: [pathToFileURL(pluginPath).href],
      provider: {
        "dynamic-test": {
          name: "Dynamic Tool Test",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: {
            fake: {
              name: "Fake",
              tool_call: true,
              limit: { context: 65_536, output: 4_096 },
            },
          },
          options: {
            apiKey: "test-key",
            baseURL: `http://127.0.0.1:${address.port}/v1`,
          },
        },
      },
    };
    const dataRoot = path.join(root, "data");
    const configRoot = path.join(root, "config");
    const cacheRoot = path.join(root, "cache");
    await Promise.all([
      mkdir(dataRoot, { recursive: true }),
      mkdir(configRoot, { recursive: true }),
      mkdir(cacheRoot, { recursive: true }),
    ]);

    const opencodePort = await getFreePort();
    const opencodeBaseUrl = `http://127.0.0.1:${opencodePort}`;
    opencodeChild = spawn(binary, [
      "serve",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(opencodePort),
    ], {
      cwd: root,
      env: {
        ...process.env,
        OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
        OPENCODE_DYNAMIC_TOOL_DISCOVERY: "1",
        OPENCODE_STICKY_LOADED: stickyEnabled ? "1" : "0",
        OPENCODE_EMPTY_WRITE_THRASH_LIMIT: "3",
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
        XDG_DATA_HOME: dataRoot,
        XDG_CONFIG_HOME: configRoot,
        XDG_CACHE_HOME: cacheRoot,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const childOutput = captureChildOutput(opencodeChild);
    await waitFor("OpenCode server startup", async () => {
      if (opencodeChild.exitCode != null || opencodeChild.signalCode != null) {
        throw new Error(
          `OpenCode exited during startup\n${childOutput.stderr()}\n${childOutput.stdout()}`,
        );
      }
      const response = await fetch(`${opencodeBaseUrl}/session/status`);
      return response.ok;
    }, 20_000);

    const session = await requestJson(`${opencodeBaseUrl}/session`, {
      method: "POST",
      body: JSON.stringify({ title: stickyEnabled ? "sticky-on" : "sticky-off" }),
    });
    if (!session?.id) throw new Error("missing session id");

    await requestJson(`${opencodeBaseUrl}/session/${session.id}/prompt_async`, {
      method: "POST",
      body: JSON.stringify({
        model: { providerID: "dynamic-test", modelID: "fake" },
        parts: [{ type: "text", text: "TURN1 Publish report report-1." }],
      }),
    });

    await waitFor("turn1 complete", async () => {
      if (opencodeChild.exitCode != null) {
        throw new Error(`OpenCode exited\n${childOutput.stderr()}\n${childOutput.stdout()}`);
      }
      const messages = await requestJson(`${opencodeBaseUrl}/session/${session.id}/message`);
      return JSON.stringify(messages).includes("Published.");
    }, 30_000);

    const turn1RequestCount = requests.length;
    const turn1Tools = requests.map(requestToolNames);
    if (!turn1Tools.some((names) => names.includes("publish_report"))) {
      throw new Error(`turn1 never loaded publish_report: ${JSON.stringify(turn1Tools)}`);
    }

    await requestJson(`${opencodeBaseUrl}/session/${session.id}/prompt_async`, {
      method: "POST",
      body: JSON.stringify({
        model: { providerID: "dynamic-test", modelID: "fake" },
        parts: [{ type: "text", text: "TURN2 check sticky." }],
      }),
    });

    await waitFor("turn2 complete", async () => {
      if (opencodeChild.exitCode != null) {
        throw new Error(`OpenCode exited\n${childOutput.stderr()}\n${childOutput.stdout()}`);
      }
      const messages = await requestJson(`${opencodeBaseUrl}/session/${session.id}/message`);
      const blob = JSON.stringify(messages);
      return blob.includes("TURN2_HAS_PUBLISH") || blob.includes("TURN2_MISSING_PUBLISH");
    }, 30_000);

    const turn2Requests = requests.slice(turn1RequestCount);
    const turn2FirstTools = turn2Requests[0] ? requestToolNames(turn2Requests[0]) : [];
    const turn2HadPublishOnFirstModelStep = turn2FirstTools.includes("publish_report");
    const messages = await requestJson(`${opencodeBaseUrl}/session/${session.id}/message`);
    const blob = JSON.stringify(messages);
    const turn2ReportedSticky = blob.includes("TURN2_HAS_PUBLISH");

    // Empty-write thrash in a fresh session (only meaningful with discovery on).
    const thrashSession = await requestJson(`${opencodeBaseUrl}/session`, {
      method: "POST",
      body: JSON.stringify({ title: "thrash" }),
    });
    const thrashBefore = requests.length;
    await requestJson(`${opencodeBaseUrl}/session/${thrashSession.id}/prompt_async`, {
      method: "POST",
      body: JSON.stringify({
        model: { providerID: "dynamic-test", modelID: "fake" },
        parts: [{ type: "text", text: "THRASH empty writes." }],
      }),
    });
    await waitFor("thrash complete", async () => {
      const thrashMessages = await requestJson(`${opencodeBaseUrl}/session/${thrashSession.id}/message`);
      const thrashBlob = JSON.stringify(thrashMessages);
      return thrashBlob.includes("THRASH_BLOCKED") || thrashBlob.includes("THRASH_NOT_BLOCKED");
    }, 30_000);
    const thrashMessages = await requestJson(`${opencodeBaseUrl}/session/${thrashSession.id}/message`);
    const thrashBlob = JSON.stringify(thrashMessages);
    const thrashBlocked = thrashBlob.includes("EMPTY_WRITE_THRASH") || thrashBlob.includes("THRASH_BLOCKED");

    return {
      stickyEnabled,
      sessionID: session.id,
      turn1RequestCount,
      turn2FirstTools,
      turn2HadPublishOnFirstModelStep,
      turn2ReportedSticky,
      thrashBlocked,
      thrashRequestCount: requests.length - thrashBefore,
      ok: stickyEnabled
        ? turn2HadPublishOnFirstModelStep && turn2ReportedSticky && thrashBlocked
        : !turn2HadPublishOnFirstModelStep && !turn2ReportedSticky && thrashBlocked,
    };
  } finally {
    await stopChild(opencodeChild);
    if (modelServer) await new Promise((resolve) => modelServer.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
}

async function main() {
  const binary = path.resolve(
    readArg("--binary")
      ?? path.join(
        wodeappxRoot,
        "vendor/openwork/apps/desktop/resources/sidecars/opencode-aarch64-apple-darwin",
      ),
  );

  const stickyOn = await runArm({ binary, stickyEnabled: true });
  const stickyOff = await runArm({ binary, stickyEnabled: false });
  const summary = {
    ok: stickyOn.ok && stickyOff.ok,
    binary,
    stickyOn,
    stickyOff,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
