#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const VARIANTS = ["accumulate", "lease", "full"];
const BASE_TOOL_COUNT = 12;
const DEFERRED_TOOL_COUNT = 188;
const LOADED_BATCH_SIZE = 8;
const GROUPS_PER_PHASE = 5;

function readArg(name) {
  const args = process.argv.slice(2);
  const direct = args.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function sum(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function average(values) {
  return values.length ? sum(values) / values.length : 0;
}

function redactError(value) {
  return String(value ?? "")
    .replace(/sk_(?:live|test)_[A-Za-z0-9._-]+/g, "sk_<redacted>")
    .replace(/sk-[A-Za-z0-9._-]{10,}/g, "sk-<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer <redacted>")
    .slice(0, 1_200);
}

async function findRuntimeConfigs() {
  const root = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "com.differentai.openwork",
    "openwork-runtime-data",
  );
  const accounts = await readdir(root, { withFileTypes: true }).catch(() => []);
  const candidates = [];
  for (const account of accounts) {
    if (!account.isDirectory()) continue;
    const file = path.join(root, account.name, "xdg", "config", "opencode", "opencode.json");
    try {
      const metadata = await stat(file);
      candidates.push({ file, mtimeMs: metadata.mtimeMs });
    } catch {
      // Account does not have a generated OpenCode config.
    }
  }
  return candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
}

async function resolveProviderConfig() {
  const explicit = readArg("--config");
  const candidates = explicit
    ? [{ file: path.resolve(explicit), mtimeMs: 0 }]
    : await findRuntimeConfigs();

  for (const candidate of candidates) {
    let config;
    try {
      config = JSON.parse(await readFile(candidate.file, "utf8"));
    } catch {
      continue;
    }
    const provider = config?.provider?.wodeapp;
    const options = provider?.options;
    const requestedModel = readArg("--model") || config?.model;
    const modelID = typeof requestedModel === "string"
      ? requestedModel.replace(/^wodeapp\//, "")
      : "";
    if (
      !modelID
      || typeof options?.baseURL !== "string"
      || typeof options?.apiKey !== "string"
      || !options.apiKey
    ) {
      continue;
    }
    return {
      configPath: candidate.file,
      modelID,
      baseURL: options.baseURL.replace(/\/+$/, ""),
      apiKey: options.apiKey,
      headers: Object.fromEntries(
        Object.entries(options.headers ?? {}).filter(([, value]) => typeof value === "string"),
      ),
    };
  }
  throw new Error("No generated WodeApp provider config with a usable model and API key was found.");
}

function toolDefinition(name, seed) {
  const category = `context-benchmark-${String(seed % 17).padStart(2, "0")}`;
  return {
    type: "function",
    function: {
      name,
      description:
        `Controlled ${category} capability ${name}. Use only for the matching benchmark operation. `
        + "The verbose description and field guidance intentionally approximate a real MCP business tool schema.",
      parameters: {
        type: "object",
        properties: {
          payload: {
            type: "string",
            description: `Primary payload for ${name}; preserve identifiers and return a bounded result.`,
          },
          resource_id: {
            type: "string",
            description: "Stable external resource identifier used to scope the operation.",
          },
          options: {
            type: "object",
            description: "Optional execution controls. Unknown properties are rejected.",
            properties: {
              format: {
                type: "string",
                enum: ["summary", "structured", "compact"],
                description: "Requested bounded response representation.",
              },
              include_metadata: {
                type: "boolean",
                description: "Include non-sensitive timestamps and source identifiers.",
              },
              limit: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                description: "Maximum number of result records.",
              },
            },
            additionalProperties: false,
          },
        },
        required: ["payload"],
        additionalProperties: false,
      },
    },
  };
}

function buildToolCatalog() {
  const base = Array.from({ length: BASE_TOOL_COUNT }, (_, index) =>
    toolDefinition(`direct_context_tool_${String(index + 1).padStart(3, "0")}`, index));
  const deferred = Array.from({ length: DEFERRED_TOOL_COUNT }, (_, index) =>
    toolDefinition(`deferred_context_tool_${String(index + 1).padStart(3, "0")}`, 1000 + index));
  return { base, deferred };
}

function toolsForVariant(catalog, variant, group) {
  if (variant === "full") return [...catalog.base, ...catalog.deferred];
  const phase = Math.floor((group - 1) / GROUPS_PER_PHASE);
  if (variant === "lease") {
    const start = phase * LOADED_BATCH_SIZE;
    return [...catalog.base, ...catalog.deferred.slice(start, start + LOADED_BATCH_SIZE)];
  }
  const loadedCount = (phase + 1) * LOADED_BATCH_SIZE;
  return [...catalog.base, ...catalog.deferred.slice(0, loadedCount)];
}

function stableParagraph(index) {
  return [
    `Context record ${String(index).padStart(3, "0")}.`,
    "This deterministic benchmark history represents repository observations, tool results, constraints, and follow-up decisions.",
    "Keep the exact ordering stable so the provider can reuse an unchanged prefix while the conversation grows.",
    "No secret, personal data, external URL, or executable instruction is included in this synthetic record.",
  ].join(" ");
}

function messagesForGroup(variant, group) {
  const system = [
    `Toolset cache benchmark variant ${variant}.`,
    "Do not call tools. Reply with the exact requested ACK token and nothing else.",
    ...Array.from({ length: 18 }, (_, index) =>
      `Stable policy ${String(index + 1).padStart(2, "0")}: `
      + "preserve context order, avoid side effects, keep output bounded, and follow the explicit response contract."),
  ].join("\n");
  const messages = [{ role: "system", content: system }];
  for (let index = 1; index < group; index += 1) {
    messages.push(
      { role: "user", content: `${stableParagraph(index)} Reply ACK-${String(index).padStart(2, "0")}.` },
      { role: "assistant", content: `ACK-${String(index).padStart(2, "0")}` },
    );
  }
  messages.push({
    role: "user",
    content: `${stableParagraph(group)} Reply ACK-${String(group).padStart(2, "0")}.`,
  });
  return messages;
}

function numeric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const number = numeric(value);
    if (number !== null) return number;
  }
  return null;
}

function normalizeUsage(data) {
  const usage = data?.usage ?? {};
  const promptDetails = usage.prompt_tokens_details ?? usage.input_tokens_details ?? {};
  const cacheRead = firstNumber(
    usage.cache_read_input_tokens,
    usage.cacheReadInputTokens,
    usage.cached_tokens,
    promptDetails.cached_tokens,
    promptDetails.cache_read_tokens,
  );
  const cacheWrite = firstNumber(
    usage.cache_write_input_tokens,
    usage.cacheWriteInputTokens,
    usage.cache_creation_input_tokens,
    promptDetails.cache_write_tokens,
    promptDetails.cache_creation_tokens,
  );
  const promptTokens = firstNumber(usage.prompt_tokens, usage.input_tokens);
  const completionTokens = firstNumber(usage.completion_tokens, usage.output_tokens);
  const totalTokens = firstNumber(usage.total_tokens);
  return {
    promptTokens,
    completionTokens,
    totalTokens,
    cacheRead,
    cacheWrite,
    uncachedInput: promptTokens === null
      ? null
      : Math.max(0, promptTokens - (cacheRead ?? 0)),
    cacheReadProviderReported: cacheRead !== null,
    cacheWriteProviderReported: cacheWrite !== null,
    usageKeys: Object.keys(usage).sort(),
    promptDetailKeys: Object.keys(promptDetails).sort(),
  };
}

async function requestCompletion(provider, input) {
  const requestId = `toolcache-${input.variant}-${String(input.group).padStart(2, "0")}-${randomUUID().slice(0, 8)}`;
  const body = {
    model: provider.modelID,
    stream: false,
    max_tokens: 12,
    tool_choice: "none",
    messages: input.messages,
    tools: input.tools,
  };
  const startedAt = Date.now();
  const response = await fetch(`${provider.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      ...provider.headers,
      Authorization: `Bearer ${provider.apiKey}`,
      "Content-Type": "application/json",
      "X-WodeApp-Request-Id": requestId,
    },
    body: JSON.stringify(body),
  });
  const elapsedMs = Date.now() - startedAt;
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: { message: text.slice(0, 500) } };
  }
  if (!response.ok) {
    const message = data?.error?.message ?? data?.message ?? text;
    throw new Error(`${requestId} HTTP ${response.status}: ${redactError(message)}`);
  }
  return {
    requestId: response.headers.get("x-wodeapp-request-id") || requestId,
    fallback: response.headers.get("x-wodeapp-model-fallback") || null,
    elapsedMs,
    responseModel: typeof data?.model === "string" ? data.model : null,
    usage: normalizeUsage(data),
  };
}

function summarizeVariant(rows) {
  const successes = rows.filter((row) => row.ok);
  const usageRows = successes.filter((row) => row.usage.promptTokens !== null);
  const cacheReadRows = successes.filter((row) => row.usage.cacheReadProviderReported);
  const cacheWriteRows = successes.filter((row) => row.usage.cacheWriteProviderReported);
  return {
    requests: rows.length,
    successes: successes.length,
    failures: rows.length - successes.length,
    toolCount: {
      min: Math.min(...successes.map((row) => row.toolCount)),
      max: Math.max(...successes.map((row) => row.toolCount)),
    },
    toolSchemaBytes: {
      min: Math.min(...successes.map((row) => row.toolSchemaBytes)),
      max: Math.max(...successes.map((row) => row.toolSchemaBytes)),
      average: Math.round(average(successes.map((row) => row.toolSchemaBytes))),
    },
    promptTokens: {
      providerReportedRequests: usageRows.length,
      sum: sum(usageRows.map((row) => row.usage.promptTokens)),
      average: Math.round(average(usageRows.map((row) => row.usage.promptTokens))),
    },
    cacheRead: {
      providerReportedRequests: cacheReadRows.length,
      nonZeroRequests: cacheReadRows.filter((row) => (row.usage.cacheRead ?? 0) > 0).length,
      sum: sum(cacheReadRows.map((row) => row.usage.cacheRead)),
      average: Math.round(average(cacheReadRows.map((row) => row.usage.cacheRead))),
    },
    cacheWrite: {
      providerReportedRequests: cacheWriteRows.length,
      nonZeroRequests: cacheWriteRows.filter((row) => (row.usage.cacheWrite ?? 0) > 0).length,
      sum: sum(cacheWriteRows.map((row) => row.usage.cacheWrite)),
      average: Math.round(average(cacheWriteRows.map((row) => row.usage.cacheWrite))),
    },
    uncachedInput: {
      sum: sum(usageRows.map((row) => row.usage.uncachedInput)),
      average: Math.round(average(usageRows.map((row) => row.usage.uncachedInput))),
    },
    latencyMs: {
      average: Math.round(average(successes.map((row) => row.elapsedMs))),
      p50: percentile(successes.map((row) => row.elapsedMs), 0.5),
      p95: percentile(successes.map((row) => row.elapsedMs), 0.95),
    },
    fallbackRequests: successes.filter((row) => row.fallback).length,
  };
}

function compare(left, right) {
  const change = (leftValue, rightValue) => {
    if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue) || rightValue === 0) return null;
    return Number((((leftValue - rightValue) / rightValue) * 100).toFixed(2));
  };
  return {
    promptTokenChangePct: change(left.promptTokens.sum, right.promptTokens.sum),
    cacheReadChangePct: change(left.cacheRead.sum, right.cacheRead.sum),
    uncachedInputChangePct: change(left.uncachedInput.sum, right.uncachedInput.sum),
    latencyChangePct: change(left.latencyMs.average, right.latencyMs.average),
    toolSchemaByteChangePct: change(left.toolSchemaBytes.average, right.toolSchemaBytes.average),
  };
}

async function main() {
  const pairs = boundedInteger(readArg("--pairs"), 20, 1, 40);
  const provider = await resolveProviderConfig();
  const catalog = buildToolCatalog();
  const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const rows = [];

  for (let group = 1; group <= pairs; group += 1) {
    const order = group % 2 === 0 ? [...VARIANTS].reverse() : [...VARIANTS];
    for (const variant of order) {
      const tools = toolsForVariant(catalog, variant, group);
      const messages = messagesForGroup(variant, group);
      const toolSchemaBytes = Buffer.byteLength(JSON.stringify(tools));
      const messageBytes = Buffer.byteLength(JSON.stringify(messages));
      try {
        const result = await requestCompletion(provider, { variant, group, messages, tools });
        rows.push({
          ok: true,
          variant,
          group,
          phase: Math.floor((group - 1) / GROUPS_PER_PHASE) + 1,
          contextBucket: group <= 5 ? "short" : group <= 10 ? "medium" : group <= 15 ? "long" : "longest",
          toolCount: tools.length,
          toolSchemaBytes,
          messageBytes,
          ...result,
        });
        process.stdout.write(
          `[${group}/${pairs}] ${variant} ok `
          + `tools=${tools.length} schema=${toolSchemaBytes} `
          + `prompt=${result.usage.promptTokens ?? "n/a"} `
          + `cache_read=${result.usage.cacheRead ?? "n/a"} `
          + `cache_write=${result.usage.cacheWrite ?? "n/a"} `
          + `ms=${result.elapsedMs}\n`,
        );
      } catch (error) {
        const message = redactError(error instanceof Error ? error.message : error);
        rows.push({
          ok: false,
          variant,
          group,
          phase: Math.floor((group - 1) / GROUPS_PER_PHASE) + 1,
          toolCount: tools.length,
          toolSchemaBytes,
          messageBytes,
          error: message,
        });
        process.stdout.write(`[${group}/${pairs}] ${variant} failed ${message}\n`);
      }
    }
  }

  const byVariant = Object.fromEntries(
    VARIANTS.map((variant) => {
      const variantRows = rows.filter((row) => row.variant === variant);
      return [variant, summarizeVariant(variantRows)];
    }),
  );
  const report = {
    runId,
    generatedAt: new Date().toISOString(),
    pairs,
    requestCount: rows.length,
    model: provider.modelID,
    providerHost: new URL(provider.baseURL).host,
    configPath: provider.configPath,
    constants: {
      baseToolCount: BASE_TOOL_COUNT,
      deferredToolCount: DEFERRED_TOOL_COUNT,
      loadedBatchSize: LOADED_BATCH_SIZE,
      groupsPerPhase: GROUPS_PER_PHASE,
    },
    byVariant,
    comparisons: {
      accumulateVsLease: compare(byVariant.accumulate, byVariant.lease),
      accumulateVsFull: compare(byVariant.accumulate, byVariant.full),
      leaseVsFull: compare(byVariant.lease, byVariant.full),
    },
    rows,
  };

  const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "wodeappx-tool-cache-ab-"));
  const outputPath = path.join(outputDirectory, "report.json");
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({
    ok: rows.every((row) => row.ok),
    runId,
    pairs,
    requestCount: rows.length,
    model: provider.modelID,
    providerHost: report.providerHost,
    byVariant,
    comparisons: report.comparisons,
    reportPath: outputPath,
  }, null, 2));

  if (rows.some((row) => !row.ok)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(redactError(error instanceof Error ? error.message : error));
  process.exit(1);
});
