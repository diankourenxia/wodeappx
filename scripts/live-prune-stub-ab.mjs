#!/usr/bin/env node
/**
 * Live A/B: coding-explore prompt against old vs new OpenCode sidecar.
 * Burns real WodeApp credits.
 *
 *   WODEAPP_API_KEY=sk_live_... node scripts/live-prune-stub-ab.mjs \
 *     --old-binary <path> --new-binary <path>
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const wodeappxRoot = path.resolve(scriptDir, "..");

function readArg(name, fallback) {
  const args = process.argv.slice(2);
  const direct = args.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

const apiKey = readArg("--api-key", process.env.WODEAPP_API_KEY);
const origin = (readArg("--origin", process.env.WODEAPP_ORIGIN || "https://www.wodeapp.cn")).replace(/\/+$/, "");
const model = readArg("--model", "wodeapp/wode/kimi-code-k3-256k");
const oldBinary = path.resolve(readArg("--old-binary", path.join(
  wodeappxRoot, "vendor/openwork/apps/desktop/resources/sidecars/opencode",
)));
const newBinary = path.resolve(readArg("--new-binary", ""));
const outRoot = path.resolve(readArg("--out-root", path.join(
  wodeappxRoot, "scripts/context-bench/runs/live-prune-stub-ab",
)));
const turnTimeoutMs = Number(readArg("--turn-timeout-ms", "900000"));

if (!apiKey) throw new Error("Missing WODEAPP_API_KEY / --api-key");
if (!newBinary) throw new Error("Missing --new-binary <patched opencode>");

const PROMPT = `你在工作区里做一个短探索（不要改文件、不要 git commit）：
1. 用 glob 找 wodeappx/integrations/opencode/**/*.ts
2. 连续 read 至少 8 个不同的 .ts 文件（每个用 offset/limit，不要整文件）
3. 用 bash grep 再搜 "PRUNE_PROTECT" 和 "compacted" 各一次
4. 最后用三句话总结：找到了哪些关键符号、分别在哪些路径、下一步若要改阈值该动哪个文件。
禁止调用无关 MCP；只用 read/glob/bash/grep。`;

function runBinary(binary, args, { cwd, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`timeout ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

function sqliteJson(dbPath, sql) {
  const result = spawnSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `sqlite3 failed: ${sql.slice(0, 80)}`);
  }
  const text = result.stdout.trim();
  if (!text) return [];
  return JSON.parse(text);
}

async function runArm(label, binary) {
  const runDir = path.join(outRoot, label);
  const xdgData = path.join(runDir, "xdg", "data");
  const xdgConfig = path.join(runDir, "xdg", "config");
  const xdgCache = path.join(runDir, "xdg", "cache");
  await Promise.all([xdgData, xdgConfig, xdgCache].map((dir) => mkdir(dir, { recursive: true })));

  const cwd = wodeappxRoot;
  const config = {
    model,
    provider: {
      wodeapp: {
        name: "WodeApp",
        npm: "@ai-sdk/openai-compatible",
        env: [],
        models: {
          "wode/kimi-code-k3-256k": {
            name: "Kimi Code K3 256K",
            tool_call: true,
            limit: { context: 256000, input: 256000, output: 8192 },
          },
        },
        options: {
          apiKey,
          baseURL: `${origin}/mainserver/api/ai/v1`,
        },
      },
    },
    compaction: {
      auto: true,
      prune: true,
      tail_turns: 4,
      preserve_recent_tokens: 8000,
      reserved: 128000,
    },
    tool_output: { max_lines: 80, max_bytes: 8192 },
  };

  const env = {
    OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    XDG_DATA_HOME: xdgData,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_CACHE_HOME: xdgCache,
  };

  console.log(`[live-ab] start ${label}`);
  const started = Date.now();
  const result = await runBinary(binary, ["run", "--format", "json", PROMPT], {
    cwd,
    env,
    timeoutMs: turnTimeoutMs,
  });
  const wallMs = Date.now() - started;
  await writeFile(path.join(runDir, "stdout.jsonl"), result.stdout, "utf8");
  await writeFile(path.join(runDir, "stderr.txt"), result.stderr, "utf8");

  const dbPath = path.join(xdgData, "opencode", "opencode.db");
  let metrics = { label, binary, wallMs, exitCode: result.code, dbPath };

  try {
    const sessions = sqliteJson(dbPath, "SELECT id, tokens_input, tokens_output, tokens_reasoning, tokens_cache_read, title FROM session ORDER BY time_created DESC LIMIT 1");
    const session = sessions[0];
    if (!session) throw new Error("no session in db");
    const toolParts = sqliteJson(dbPath, `SELECT data FROM part WHERE session_id='${session.id}' AND json_extract(data,'$.type')='tool' ORDER BY time_created`);
    let tools = 0;
    let stubbed = 0;
    let cleared = 0;
    let toolChars = 0;
    let modelFacingChars = 0;
    for (const row of toolParts) {
      const part = JSON.parse(row.data);
      const state = part.state || {};
      if (state.status !== "completed") continue;
      tools += 1;
      const output = typeof state.output === "string" ? state.output : "";
      toolChars += output.length;
      const compacted = Boolean(state.time && state.time.compacted);
      if (compacted && output.includes("[WodeApp compacted tool]")) {
        stubbed += 1;
        modelFacingChars += output.length;
      } else if (compacted) {
        cleared += 1;
        modelFacingChars += "[Old tool result content cleared]".length;
      } else {
        modelFacingChars += output.length;
      }
    }
    const stepFinishes = sqliteJson(dbPath, `SELECT data FROM part WHERE session_id='${session.id}' AND json_extract(data,'$.type')='step-finish' ORDER BY time_created`);
    const totals = stepFinishes.map((row) => {
      const d = JSON.parse(row.data);
      return d.tokens && typeof d.tokens.total === "number" ? d.tokens.total : null;
    }).filter((n) => typeof n === "number");
    metrics = {
      ...metrics,
      sessionId: session.id,
      tokens_input: session.tokens_input,
      tokens_output: session.tokens_output,
      tokens_reasoning: session.tokens_reasoning,
      tokens_cache_read: session.tokens_cache_read,
      tools,
      stubbed,
      clearedBlank: cleared,
      toolCharsStored: toolChars,
      modelFacingToolCharsApprox: modelFacingChars,
      stepCount: stepFinishes.length,
      tokensTotalStart: totals[0] ?? null,
      tokensTotalEnd: totals.length ? totals[totals.length - 1] : null,
      tokensTotalMax: totals.length ? Math.max(...totals) : null,
    };
  } catch (error) {
    metrics.dbError = String(error && error.message ? error.message : error);
  }

  await writeFile(path.join(runDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  console.log(`[live-ab] done ${label} wall=${(wallMs / 1000).toFixed(1)}s tools=${metrics.tools} stubbed=${metrics.stubbed}`);
  return metrics;
}

const arms = [];
arms.push(await runArm("A-old-sidecar", oldBinary));
arms.push(await runArm("B-new-patched", newBinary));

const report = {
  startedAt: new Date().toISOString(),
  model,
  origin,
  promptChars: PROMPT.length,
  arms,
};
await mkdir(outRoot, { recursive: true });
await writeFile(path.join(outRoot, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

console.log("\n=== LIVE A/B ===");
for (const arm of arms) {
  console.log(
    arm.label,
    `wall=${(arm.wallMs / 1000).toFixed(1)}s`,
    `steps=${arm.stepCount}`,
    `tools=${arm.tools}`,
    `stubbed=${arm.stubbed}`,
    `clearedBlank=${arm.clearedBlank}`,
    `tokIn=${arm.tokens_input}`,
    `tokMax=${arm.tokensTotalMax}`,
    `facingToolChars≈${arm.modelFacingToolCharsApprox}`,
    arm.dbError ? `ERR=${arm.dbError}` : "",
  );
}
console.log(`report -> ${path.join(outRoot, "report.json")}`);
