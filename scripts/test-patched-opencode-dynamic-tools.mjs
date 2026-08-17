#!/usr/bin/env node
/**
 * Regression harness for patched OpenCode dynamic tools + permission migration.
 *
 * Uses a local fake OpenAI-compatible provider (no WodeApp credits). That is
 * allowed only for this harness's migration/telemetry checks.
 *
 * NOT an acceptance gate for sticky leases / cross-turn browser tools / "desktop
 * sidecar already has sticky". For those, use:
 *   pnpm check:sticky-loaded
 *   pnpm check:sticky-loaded:live
 * See TOOL_DISCOVERY.md § Verification (no fake model).
 */
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
            function: {
              name,
              arguments: JSON.stringify(args),
            },
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

function textChunks(text) {
  const created = Math.floor(Date.now() / 1000);
  return [
    {
      id: "chatcmpl-final",
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
      id: "chatcmpl-final",
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

function captureChildOutput(child) {
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  return {
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

async function stopChild(child) {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 3_000)),
  ]);
  if (graceful) return;
  child.kill("SIGKILL");
  await exited;
}

async function getFreePort() {
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  if (!address || typeof address === "string") {
    await new Promise((resolve) => probe.close(resolve));
    throw new Error("Failed to reserve an OpenCode test port");
  }
  await new Promise((resolve) => probe.close(resolve));
  return address.port;
}

async function waitFor(label, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `${label} timed out after ${timeoutMs}ms${lastError ? `: ${String(lastError)}` : ""}`,
  );
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${options.method ?? "GET"} ${url} failed with ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

function legacyPermissionSnapshot() {
  const core = [
    "apply_patch",
    "bash",
    "edit",
    "glob",
    "grep",
    "question",
    "read",
    "skill",
    "task",
    "todowrite",
    "webfetch",
    "write",
  ];
  const branded = Array.from({ length: 28 }, (_, index) => (
    index % 2 === 0
      ? `openwork_fixture_${index}`
      : `wodeappx_fixture_${index}`
  ));
  const other = [
    "publish_report",
    ...Array.from({ length: 19 }, (_, index) => `fixture_tool_${index}`),
  ];
  return [...core, ...branded, ...other].map((permission, index) => ({
    permission,
    pattern: "*",
    action: index < 8 ? "allow" : "deny",
  }));
}

async function main() {
  const binary = path.resolve(
    readArg("--binary")
      ?? path.join(
        wodeappxRoot,
        "vendor",
        "openwork",
        "apps",
        "desktop",
        "resources",
        "sidecars",
        process.platform === "win32" ? "opencode.exe" : "opencode",
      ),
  );
  const root = await mkdtemp(path.join(tmpdir(), "wodeappx-dynamic-tools-e2e-"));
  const requests = [];
  let modelServer;
  let opencodeChild;

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

      const payload = hasToolResult(body, "publish_report")
        ? textChunks("Published.")
        : hasToolResult(body, "tool_search")
          ? toolCallChunks("publish_report", { reportID: "report-1" }, "call-publish")
          : toolCallChunks("tool_search", { query: "publish external report" }, "call-search");

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
    }, 15_000);

    const legacyPermissions = legacyPermissionSnapshot();
    const deprecatedToolVisibility = Object.fromEntries(
      legacyPermissions.map((rule) => [rule.permission, rule.action === "allow"]),
    );
    deprecatedToolVisibility.tool_search = true;
    deprecatedToolVisibility.publish_report = false;

    const session = await requestJson(`${opencodeBaseUrl}/session`, {
      method: "POST",
      body: JSON.stringify({
        title: "Dynamic tool permission migration E2E",
        permission: legacyPermissions,
      }),
    });
    if (!session?.id) throw new Error("OpenCode did not return a session id");
    if (session.permission?.length !== legacyPermissions.length) {
      throw new Error(
        `Legacy permission fixture was not persisted: expected ${legacyPermissions.length}, received ${session.permission?.length ?? 0}`,
      );
    }

    await requestJson(`${opencodeBaseUrl}/session/${session.id}/prompt_async`, {
      method: "POST",
      body: JSON.stringify({
        model: { providerID: "dynamic-test", modelID: "fake" },
        parts: [{ type: "text", text: "Publish report report-1." }],
        tools: deprecatedToolVisibility,
      }),
    });

    let messages = [];
    await waitFor("dynamic tool execution", async () => {
      if (opencodeChild.exitCode != null || opencodeChild.signalCode != null) {
        throw new Error(
          `OpenCode exited during prompt execution\n${childOutput.stderr()}\n${childOutput.stdout()}`,
        );
      }
      if (requests.length < 3) return false;
      messages = await requestJson(`${opencodeBaseUrl}/session/${session.id}/message`);
      return JSON.stringify(messages).includes("Published.");
    });

    const migratedSession = await requestJson(`${opencodeBaseUrl}/session/${session.id}`);
    const migratedPermissions = migratedSession.permission ?? [];
    if (migratedPermissions.length !== 0) {
      throw new Error(
        `Legacy/deprecated tool visibility rules survived prompt migration: ${migratedPermissions.length}`,
      );
    }
    if (requests.length < 3) {
      throw new Error(`Expected at least three model requests, received ${requests.length}`);
    }

    const firstTools = requestToolNames(requests[0]);
    const secondTools = requestToolNames(requests[1]);
    if (!firstTools.includes("tool_search")) throw new Error("Initial request did not expose tool_search");
    if (firstTools.includes("publish_report")) throw new Error("Initial request leaked deferred publish_report schema");
    if (!secondTools.includes("publish_report")) {
      throw new Error(
        `Second request did not load publish_report after tool_search: ${JSON.stringify(
          requests.map((request) => requestToolNames(request)),
        )}\nSession messages: ${JSON.stringify(messages).slice(-12_000)}`,
      );
    }

    await stopChild(opencodeChild);
    opencodeChild = null;
    const runtimeLogDirectory = path.join(dataRoot, "opencode", "log");
    const runtimeLogFiles = await readdir(runtimeLogDirectory).catch(() => []);
    const runtimeLog = [
      childOutput.stdout(),
      childOutput.stderr(),
      ...await Promise.all(runtimeLogFiles.map((name) =>
        readFile(path.join(runtimeLogDirectory, name), "utf8").catch(() => "")
      )),
    ].join("\n");
    const toolsetTelemetryObserved =
      runtimeLog.includes("dynamic tool exposure")
      && runtimeLog.includes("toolset_hash=")
      && runtimeLog.includes("visible_schema_bytes=")
      && runtimeLog.includes("toolset_added=");
    if (!toolsetTelemetryObserved) {
      throw new Error(`Dynamic toolset telemetry was not observed in the runtime log\n${runtimeLog.slice(-8_000)}`);
    }
    const legacyPermissionMigrationObserved =
      runtimeLog.includes("cleared legacy WodeAppX tool visibility permission snapshot")
      && runtimeLog.includes(`session.id=${session.id}`)
      && runtimeLog.includes(`permission.rules.removed=${legacyPermissions.length}`);
    if (!legacyPermissionMigrationObserved) {
      throw new Error(`Legacy permission migration telemetry was not observed\n${runtimeLog.slice(-8_000)}`);
    }
    const deprecatedToolMapIgnored =
      runtimeLog.includes("ignored deprecated prompt tool visibility map")
      && runtimeLog.includes(`session.id=${session.id}`);
    if (!deprecatedToolMapIgnored) {
      throw new Error(`Deprecated prompt tool map was not ignored\n${runtimeLog.slice(-8_000)}`);
    }
    const summary = {
      ok: true,
      binary,
      sessionID: session.id,
      requests: requests.length,
      legacyPermissionCount: legacyPermissions.length,
      migratedPermissionCount: migratedPermissions.length,
      initialToolCount: firstTools.length,
      initialTools: firstTools,
      initialToolSchemaBytes: Buffer.byteLength(JSON.stringify(requests[0].tools ?? [])),
      secondToolCount: secondTools.length,
      secondTools,
      secondToolSchemaBytes: Buffer.byteLength(JSON.stringify(requests[1].tools ?? [])),
      deferredAbsentInitially: !firstTools.includes("publish_report"),
      deferredLoadedNextStep: secondTools.includes("publish_report"),
      toolsetTelemetryObserved,
      legacyPermissionMigrationObserved,
      deprecatedToolMapIgnored,
      finalOutputObserved: JSON.stringify(messages).includes("Published."),
    };
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await stopChild(opencodeChild);
    if (modelServer) await new Promise((resolve) => modelServer.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
