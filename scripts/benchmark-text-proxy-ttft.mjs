#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadWodeAppConfig,
  normalizeWodeAppCloudConfig,
  resolvePlatformOrigin,
} from "../integrations/wodeapp-cloud/electron/config-store.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");

function readArg(name, fallback = "") {
  const args = process.argv.slice(2);
  const direct = args.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function csvArg(name, fallback) {
  return readArg(name, fallback)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function buildTools() {
  return Array.from({ length: 12 }, (_, index) => ({
    type: "function",
    function: {
      name: `diagnostic_tool_${String(index + 1).padStart(2, "0")}`,
      description: [
        "Diagnostic placeholder. Do not call for greetings.",
        "This deliberately resembles a normal coding-agent tool description so the request exercises tool-schema prefill.",
        "Parameters are bounded and contain no external data or side effects.",
        "Return a short textual result only when explicitly asked.",
      ].join(" ").repeat(3),
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Short diagnostic query." },
          limit: { type: "integer", minimum: 1, maximum: 20, description: "Maximum result count." },
          includeMetadata: { type: "boolean", description: "Include bounded metadata." },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  }));
}

function observeSseBlock(block, elapsedMs, state) {
  const raw = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!raw || raw === "[DONE]") return;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  const delta = data?.choices?.[0]?.delta || {};
  const content = typeof delta.content === "string" ? delta.content : "";
  const reasoning = typeof delta.reasoning_content === "string" ? delta.reasoning_content : "";
  const toolText = Array.isArray(delta.tool_calls) ? JSON.stringify(delta.tool_calls) : "";
  if (state.firstEffectiveMs === null && (content || reasoning || toolText)) {
    state.firstEffectiveMs = elapsedMs;
  }
  if (state.firstMessageMs === null && content) state.firstMessageMs = elapsedMs;
  if (content) state.outputChars += content.length;
  if (data?.usage) state.usage = data.usage;
}

async function runOne({ endpoint, apiKey, model, profile, systemText, tools, timeoutMs }) {
  const requestId = `diag_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
  const messages = profile === "full"
    ? [
        { role: "system", content: systemText },
        { role: "user", content: "只回复：你好" },
      ]
    : [
        { role: "system", content: "你是一个简洁的助手。" },
        { role: "user", content: "只回复：你好" },
      ];
  const requestTools = profile === "full" ? tools : [];
  const body = {
    model,
    stream: true,
    max_tokens: 32,
    messages,
    ...(requestTools.length ? { tools: requestTools, tool_choice: "auto" } : {}),
  };
  const startedAt = performance.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-API-Key": apiKey,
      "X-WodeApp-Request-Id": requestId,
      "X-WodeApp-Session-Id": `diag-session-${profile}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const headersMs = Math.round(performance.now() - startedAt);
  const base = {
    model,
    profile,
    status: response.status,
    requestId,
    responseRequestId: response.headers.get("x-wodeapp-request-id"),
    upstreamRequestId: response.headers.get("x-wodeapp-upstream-request-id"),
    serverTiming: response.headers.get("server-timing"),
    messageBytes: byteLength(messages),
    toolSchemaBytes: byteLength(requestTools),
    responseHeadersMs: headersMs,
  };
  if (!response.body) {
    return { ...base, error: "missing response body" };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state = {
    firstChunkMs: null,
    firstEffectiveMs: null,
    firstMessageMs: null,
    outputChars: 0,
    usage: null,
  };
  let carry = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const elapsedMs = Math.round(performance.now() - startedAt);
    state.firstChunkMs ??= elapsedMs;
    carry = `${carry}${decoder.decode(value, { stream: true })}`.replace(/\r\n/g, "\n");
    const blocks = carry.split("\n\n");
    carry = blocks.pop() || "";
    for (const block of blocks) observeSseBlock(block, elapsedMs, state);
  }
  carry += decoder.decode();
  if (carry.trim()) observeSseBlock(carry, Math.round(performance.now() - startedAt), state);
  return {
    ...base,
    ...state,
    totalMs: Math.round(performance.now() - startedAt),
  };
}

async function main() {
  const models = csvArg(
    "--models",
    "kimicode/k3-256k,minimax/MiniMax-M3,qwen3.8-max,bytedance/doubao-seed-2-1-turbo",
  );
  const profiles = csvArg("--profiles", "full");
  const timeoutMs = Number(readArg("--timeout-ms", "120000"));
  const config = normalizeWodeAppCloudConfig(await loadWodeAppConfig());
  if (!config.apiKey?.trim()) throw new Error("WodeApp API key is not configured");
  const origin = readArg("--origin") || resolvePlatformOrigin(config);
  const endpoint = `${origin.replace(/\/+$/, "")}/mainserver/api/ai/v1/chat/completions`;
  const systemText = await readFile(path.join(repoRoot, "AGENTS.md"), "utf8");
  const tools = buildTools();

  console.log(JSON.stringify({
    event: "benchmark.start",
    origin,
    models,
    profiles,
    systemBytes: Buffer.byteLength(systemText, "utf8"),
    toolSchemaBytes: byteLength(tools),
  }));
  for (const profile of profiles) {
    if (!new Set(["tiny", "full"]).has(profile)) throw new Error(`Unknown profile: ${profile}`);
    for (const model of models) {
      try {
        const result = await runOne({
          endpoint,
          apiKey: config.apiKey,
          model,
          profile,
          systemText,
          tools,
          timeoutMs,
        });
        console.log(JSON.stringify({ event: "benchmark.result", ...result }));
      } catch (error) {
        console.log(JSON.stringify({
          event: "benchmark.error",
          model,
          profile,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
