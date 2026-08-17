#!/usr/bin/env node
/**
 * context-bench driver — replay a scripted task file against the patched
 * opencode sidecar with a real model, producing per-run opencode.log data
 * for join-metrics.mjs.
 *
 * Usage:
 *   node run-task.mjs --task tasks/t2-one-search.md \
 *     --api-key sk_live_... [--origin https://www.wodeapp.cn] \
 *     [--runs 3] [--label exp1-t2] [--context-limit 64000] [--soft-wall 65] \
 *     [--output-limit 4096] [--keep-tokens 8000] \
 *     [--fixture-tools 24] [--binary <path>] [--turn-timeout-ms 600000]
 *
 * Env fallbacks: WODEAPP_API_KEY, WODEAPP_ORIGIN.
 *
 * Output: <out-root>/<label>/run-<i>/ with xdg dirs (logs under
 * xdg/data/opencode/log), work dir, bench plugin, run-meta.json.
 */
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const wodeappxRoot = path.resolve(scriptDir, "..", "..");

function readArg(name, fallback) {
  const args = process.argv.slice(2);
  const direct = args.find((value) => value.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

const taskFile = readArg("--task");
const apiKey = readArg("--api-key", process.env.WODEAPP_API_KEY);
const origin = (readArg("--origin", process.env.WODEAPP_ORIGIN || "https://www.wodeapp.cn")).replace(/\/+$/, "");
const model = readArg("--model", "wodeapp/wode/kimi-code-k3-256k");
const contextLimit = Number(readArg("--context-limit", "64000"));
const softWall = Number(readArg("--soft-wall", "65")); // percent of context usable before compaction
const outputLimit = Number(readArg("--output-limit", "4096"));
const keepTokens = Number(readArg("--keep-tokens", "8000"));
const fixtureToolCount = Number(readArg("--fixture-tools", "24"));
const runs = Number(readArg("--runs", "1"));
const maxTurns = Number(readArg("--max-turns", "0"));
const turnTimeoutMs = Number(readArg("--turn-timeout-ms", "600000"));
const label = readArg("--label", taskFile ? path.basename(taskFile).replace(/\.md$/, "") : "bench");
const outRoot = path.resolve(readArg("--out-root", path.join(scriptDir, "runs")));
const binary = path.resolve(
  readArg("--binary", path.join(
    wodeappxRoot, "vendor", "openwork", "apps", "desktop", "resources", "sidecars",
    process.platform === "win32" ? "opencode.exe" : "opencode",
  )),
);

if (!taskFile) throw new Error("Missing --task <file>");
if (!apiKey) throw new Error("Missing --api-key or WODEAPP_API_KEY");
if (!(contextLimit > 0)) throw new Error("--context-limit must be positive");
if (!(softWall > 0 && softWall < 100)) throw new Error("--soft-wall must be between 0 and 100");
if (!(outputLimit > 0 && outputLimit < contextLimit)) throw new Error("--output-limit must be between 0 and context-limit");
if (!(keepTokens >= 0 && keepTokens < contextLimit)) throw new Error("--keep-tokens must be between 0 and context-limit");

// ---------------------------------------------------------------------------
// Fixture plugin: deferred bench tools across commerce domains. Descriptions
// carry the same keywords the task prompts use, so BM25 tool_search finds them.
// ---------------------------------------------------------------------------
const FIXTURE_TOOLS = [
  ["bench_sales_metrics", "查询电商销售指标：GMV、订单量、客单价、退款率。Query sales metrics (GMV, orders, AOV, refund rate) for a date range.", "range"],
  ["bench_traffic_sources", "分析流量来源与渠道构成。Analyze traffic sources and channel mix.", "range"],
  ["bench_ads_performance", "查询广告投放数据：消耗、点击、转化、ROI。Query ads spend, clicks, conversions and ROI.", "range"],
  ["bench_inventory_list", "盘点当前库存，列出各 SKU 库存量与安全线。List inventory levels per SKU with safety thresholds.", ""],
  ["bench_inventory_turnover", "查询库存周转与积压 SKU。Query inventory turnover and slow-moving SKUs.", "range"],
  ["bench_restock_create", "为低库存 SKU 创建补货单。Create restock purchase orders for low-stock SKUs.", "skus"],
  ["bench_coupon_create", "生成优惠券：面额、门槛、数量、有效期。Create discount coupons with amount, threshold, count and validity.", "skus"],
  ["bench_campaign_create", "创建大促/营销活动并设置时间与玩法。Create a marketing campaign with schedule and mechanics.", "name"],
  ["bench_member_push", "给核心会员发送定向推送通知。Send targeted push notifications to member segments.", "segment"],
  ["bench_ticket_hotspots", "查询客服工单中的投诉与售后热点。Summarize customer-service ticket complaint hotspots.", "range"],
  ["bench_export_csv", "把查询结果汇总导出为 CSV 文件。Export aggregated results to a CSV file.", "name"],
  ["bench_publish_brief", "把经营简报/总结发布到团队频道。Publish a business brief or summary to the team channel.", "title"],
  ["bench_competitor_pricing", "查询竞品价格带与促销力度。Query competitor price bands and promotion intensity.", "category"],
  ["bench_category_trend", "查询类目最近趋势与热搜词。Query category trends and trending search terms.", "category"],
  ["bench_reviews_moderate", "审核并回复商品评价。Moderate and reply to product reviews.", "range"],
  ["bench_logistics_track", "查询物流时效与异常包裹。Track logistics SLA and abnormal parcels.", "range"],
  ["bench_refund_policy", "查询与配置退换货政策。Read and configure refund/return policies.", ""],
  ["bench_live_schedule", "创建直播排期与货盘。Create livestream schedule and product lineup.", "date"],
  ["bench_shortvideo_script", "生成商品短视频脚本。Generate a short-video script for a product.", "sku"],
  ["bench_image_template", "套用主图/详情页图片模板。Apply image templates for main images and detail pages.", "sku"],
  ["bench_store_theme", "配置店铺装修主题与配色。Configure store decoration theme and palette.", "name"],
  ["bench_seo_keywords", "查询并优化搜索关键词。Research and optimize SEO keywords.", "category"],
  ["bench_price_history", "查询商品历史价格曲线。Query historical price curve of products.", "skus"],
  ["bench_supplier_list", "查询供应商名录与起订量。List suppliers with MOQ and lead time.", "category"],
];

function fixtureReply(id) {
  return [
    `【${id} 模拟数据】`,
    `指标快照：GMV ¥182,340（环比 +6.2%），订单量 1,437，客单价 ¥126.9，退款率 4.1%。`,
    `渠道：搜索 41% / 推荐 33% / 直播 18% / 其他 8%。ROI 最高渠道：搜索（3.8）。`,
    `SKU 明细：SKU-1001 库存 62（安全线 80，偏低）；SKU-1002 库存 540；SKU-1003 库存 12（安全线 50，告急）。`,
    `价格带：¥79-¥129 占 58%，¥129-¥199 占 31%。竞品均价 ¥118。`,
    `投诉热点：物流延迟 37%，包装破损 22%，口味不符 15%。`,
    `备注：本数据由 context-bench fixture 生成，仅用于压测，不代表真实经营数据。`,
  ].join("\n");
}

function buildFixturePluginSource(pluginPackageUrl, tools) {
  const perTool = tools.map(([id, description, argName]) => `    ${JSON.stringify(id)}: tool({
      description: ${JSON.stringify(description)},
      args: {
        ${argName || "query"}: tool.schema.string().optional().describe("Optional filter, e.g. date range or SKU list."),
      },
      async execute() {
        return ${JSON.stringify(fixtureReply(id))};
      },
    }),`).join("\n");
  return `import { tool } from ${JSON.stringify(pluginPackageUrl)};

export const ContextBenchFixtures = async () => ({
  tool: {
${perTool}
  },
});
`;
}

// ---------------------------------------------------------------------------
// Task file parsing: markdown with "## Turn N" sections.
// ---------------------------------------------------------------------------
function parseTask(markdown) {
  const parts = markdown.split(/^## Turn \d+\s*$/m).slice(1);
  const turns = parts.map((part) => expandTaskMacros(part.trim())).filter(Boolean);
  if (turns.length === 0) throw new Error("Task file has no '## Turn N' sections");
  return turns;
}

function expandTaskMacros(value) {
  return value.replace(/\{\{PAD:(\d+):([A-Za-z0-9_-]+)\}\}/g, (_match, rawChars, seed) => {
    const chars = Math.min(20_000, Math.max(0, Number(rawChars)));
    let output = "";
    let index = 1;
    while (output.length < chars) {
      output += `context-bench padding ${seed} record ${String(index).padStart(4, "0")} alpha bravo charlie delta echo foxtrot; `;
      index += 1;
    }
    return output.slice(0, chars);
  });
}

// ---------------------------------------------------------------------------
// Sidecar invocation
// ---------------------------------------------------------------------------
function runTurn({ cwd, env, message, sessionId, title, stdoutFile, stderrFile }) {
  return new Promise((resolve) => {
    const args = ["run", message, "--model", model, "--format", "json", "--dangerously-skip-permissions"];
    if (sessionId) args.push("--session", sessionId);
    if (title) args.push("--title", title);
    const startedAt = Date.now();
    const child = spawn(binary, args, {
      cwd,
      env: { ...process.env, ...env, PWD: cwd },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, turnTimeoutMs);
    child.once("error", (error) => {
      clearTimeout(timeout);
      resolve({ exitCode: -1, wallMs: Date.now() - startedAt, stdout, stderr: `${stderr}\n${error}` });
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      Promise.all([
        writeFile(stdoutFile, stdout, "utf8"),
        writeFile(stderrFile, stderr, "utf8"),
      ]).then(() => resolve({ exitCode: code ?? -1, wallMs: Date.now() - startedAt, stdout, stderr }));
    });
  });
}

function runSidecarCommand({ cwd, env, args }) {
  return new Promise((resolve) => {
    const child = spawn(binary, args, {
      cwd,
      env: { ...process.env, ...env, PWD: cwd },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error) => resolve({ exitCode: -1, stdout, stderr: `${stderr}\n${error}` }));
    child.once("close", (code) => resolve({ exitCode: code ?? -1, stdout, stderr }));
  });
}

async function collectSessionMetrics({ cwd, env, sessionId }) {
  if (!/^ses_[A-Za-z0-9]+$/.test(sessionId)) throw new Error(`Unsafe session id: ${sessionId}`);
  const sessionQuery = [
    "select id, tokens_input, tokens_output, tokens_reasoning,",
    "tokens_cache_read, tokens_cache_write, time_created, time_updated",
    `from session where id='${sessionId}'`,
  ].join(" ");
  const messageQuery = [
    "select m.time_created, m.id, json_extract(m.data,'$.role') role,",
    "json_extract(m.data,'$.summary') summary,",
    "(select group_concat(json_extract(p.data,'$.type')) from part p where p.message_id=m.id) part_types",
    `from message m where m.session_id='${sessionId}' order by m.time_created`,
  ].join(" ");
  // Keep these sequential: two sidecar db commands racing during process
  // shutdown can contend on SQLite and intermittently return "database is locked".
  const sessionResult = await runSidecarCommand({
    cwd,
    env,
    args: ["db", sessionQuery, "--format", "json"],
  });
  const messageResult = await runSidecarCommand({
    cwd,
    env,
    args: ["db", messageQuery, "--format", "json"],
  });
  if (sessionResult.exitCode !== 0 || messageResult.exitCode !== 0) {
    return {
      ok: false,
      error: [sessionResult.stderr, messageResult.stderr].filter(Boolean).join("\n"),
    };
  }
  return {
    ok: true,
    data: {
      session: JSON.parse(sessionResult.stdout)[0],
      messages: JSON.parse(messageResult.stdout),
    },
  };
}

async function findSessionId(logDir) {
  const files = await readdir(logDir).catch(() => []);
  for (const name of files) {
    const text = await readFile(path.join(logDir, name), "utf8").catch(() => "");
    const match = /session\.id=(ses_[A-Za-z0-9]+)/.exec(text) || /created id=(ses_[A-Za-z0-9]+)/.exec(text);
    if (match) return match[1];
  }
  return undefined;
}

async function main() {
  const taskSource = await readFile(path.resolve(taskFile), "utf8");
  const parsedTurns = parseTask(taskSource);
  const turns = maxTurns > 0 ? parsedTurns.slice(0, maxTurns) : parsedTurns;
  const pluginPackage = path.join(
    wodeappxRoot, "vendor", "openwork", ".opencode", "node_modules",
    "@opencode-ai", "plugin", "dist", "index.js",
  );
  const fixtureTools = FIXTURE_TOOLS.slice(0, Math.max(0, fixtureToolCount));
  const reserved = Math.round(contextLimit * (1 - softWall / 100));
  const benchRoot = path.join(outRoot, label);
  await mkdir(benchRoot, { recursive: true });

  console.log(`[bench] task=${taskFile} turns=${turns.length} runs=${runs}`);
  console.log(`[bench] model=${model} context=${contextLimit} softWall=${softWall}% reserved=${reserved}`);
  console.log(`[bench] outputLimit=${outputLimit} keepTokens=${keepTokens}`);
  console.log(`[bench] fixtureTools=${fixtureTools.length} origin=${origin}`);
  console.log(`[bench] binary=${binary}`);
  console.log(`[bench] output=${benchRoot}`);

  for (let runIndex = 1; runIndex <= runs; runIndex++) {
    const runDir = path.join(benchRoot, `run-${runIndex}`);
    const workDir = path.join(runDir, "work");
    const xdgData = path.join(runDir, "xdg", "data");
    const xdgConfig = path.join(runDir, "xdg", "config");
    const xdgCache = path.join(runDir, "xdg", "cache");
    await Promise.all([workDir, xdgData, xdgConfig, xdgCache].map((dir) => mkdir(dir, { recursive: true })));

    let pluginUrls = [];
    if (fixtureTools.length > 0) {
      const pluginPath = path.join(runDir, "bench-plugin.mjs");
      await writeFile(pluginPath, buildFixturePluginSource(pathToFileURL(pluginPackage).href, fixtureTools), "utf8");
      pluginUrls = [pathToFileURL(pluginPath).href];
    }

    const config = {
      model,
      plugin: pluginUrls,
      provider: {
        wodeapp: {
          name: "WodeApp",
          npm: "@ai-sdk/openai-compatible",
          env: [],
          models: {
            [model.split("/").slice(1).join("/")]: {
              name: "Bench model",
              tool_call: true,
              limit: { context: contextLimit, input: contextLimit, output: outputLimit },
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
        preserve_recent_tokens: keepTokens,
        reserved,
      },
    };

    const env = {
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      OPENCODE_DYNAMIC_TOOL_DISCOVERY: "1",
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
      XDG_DATA_HOME: xdgData,
      XDG_CONFIG_HOME: xdgConfig,
      XDG_CACHE_HOME: xdgCache,
    };

    const meta = {
      label,
      taskFile: path.basename(taskFile),
      runIndex,
      model,
      contextLimit,
      softWall,
      reserved,
      outputLimit,
      keepTokens,
      fixtureTools: fixtureTools.length,
      origin,
      startedAt: new Date().toISOString(),
      turns: [],
    };

    let sessionId;
    for (let turnIndex = 0; turnIndex < turns.length; turnIndex++) {
      const turnNo = turnIndex + 1;
      const result = await runTurn({
        cwd: workDir,
        env,
        message: turns[turnIndex],
        sessionId,
        title: turnNo === 1 ? `bench ${label}` : undefined,
        stdoutFile: path.join(runDir, `turn-${turnNo}.stdout.json`),
        stderrFile: path.join(runDir, `turn-${turnNo}.stderr.log`),
      });
      meta.turns.push({ turn: turnNo, wallMs: result.wallMs, exitCode: result.exitCode });
      console.log(`[bench] run-${runIndex} turn-${turnNo}: exit=${result.exitCode} wall=${(result.wallMs / 1000).toFixed(1)}s`);
      if (!sessionId) {
        sessionId = await findSessionId(path.join(xdgData, "opencode", "log"));
        if (!sessionId) {
          console.error(`[bench] run-${runIndex}: session id not found after turn 1, aborting run`);
          break;
        }
        meta.sessionId = sessionId;
      }
      if (result.exitCode !== 0) {
        console.error(`[bench] run-${runIndex} turn-${turnNo} failed, stopping this run`);
        break;
      }
    }

    if (sessionId) {
      const metrics = await collectSessionMetrics({ cwd: workDir, env, sessionId });
      if (metrics.ok) {
        await writeFile(
          path.join(runDir, "session-metrics.json"),
          `${JSON.stringify(metrics.data, null, 2)}\n`,
          "utf8",
        );
        meta.sessionMetricsCollected = true;
      } else {
        await writeFile(path.join(runDir, "session-metrics.stderr.log"), metrics.error, "utf8");
        meta.sessionMetricsCollected = false;
      }
    }

    meta.finishedAt = new Date().toISOString();
    await writeFile(path.join(runDir, "run-meta.json"), JSON.stringify(meta, null, 2), "utf8");
  }

  console.log(`[bench] done. Tool/cache metrics: node join-metrics.mjs --runs ${JSON.stringify(benchRoot)} --summary`);
  console.log(`[bench] soft-wall metrics: node summarize-soft-wall.mjs --runs ${JSON.stringify(benchRoot)}`);
}

await main();
