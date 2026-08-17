#!/usr/bin/env node
/**
 * Concurrent LIVE repro: busy + empty assistant shell (parts=0) with no first part.
 *
 * This is the ses_033f064afffe* failure shape — not empty-args bash.
 * Burns real credits. UI/CDP not required.
 *
 * Usage:
 *   node wodeappx/scripts/repro-busy-empty-shell-hang.mjs
 *   node wodeappx/scripts/repro-busy-empty-shell-hang.mjs --concurrency=6 --hang-ms=45000 --budget-ms=180000
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function readArg(name, fallback) {
  const args = process.argv.slice(2);
  const direct = args.find((v) => v.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}

const concurrency = Math.max(1, Number(readArg("--concurrency", "6")) || 6);
const hangMs = Math.max(5_000, Number(readArg("--hang-ms", "45000")) || 45_000);
const budgetMs = Math.max(30_000, Number(readArg("--budget-ms", "180000")) || 180_000);
const pollMs = Math.max(1_000, Number(readArg("--poll-ms", "2000")) || 2_000);

const ENGINE_CANDIDATES = [
  process.env.OPENWORK_ENGINE_JSON?.trim(),
  path.join(homedir(), "Library/Application Support/com.differentai.openwork/openwork-engine.json"),
  path.join(homedir(), ".openwork/openwork-engine.json"),
].filter(Boolean);

async function loadEngine() {
  for (const file of ENGINE_CANDIDATES) {
    try {
      const raw = JSON.parse(await readFile(file, "utf8"));
      if (raw?.username && raw?.password && raw?.baseUrl) return raw;
    } catch {
      /* try next */
    }
  }
  throw new Error("openwork-engine.json with basic auth not found");
}

function findLivePort() {
  const ps = spawnSync("pgrep", ["-lf", "resources/sidecars/opencode"], { encoding: "utf8" });
  for (const line of (ps.stdout || "").split(/\r?\n/).filter(Boolean)) {
    const m = line.match(/--port\s+(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}

function authHeaders(engine) {
  return {
    Authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}`,
    "Content-Type": "application/json",
    ...(engine.directory ? { "x-opencode-directory": engine.directory } : {}),
  };
}

async function requestJson(baseUrl, headers, method, pathname, body) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${pathname} → ${response.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

function pickModel(config) {
  const preferred = ["wode/kimi-code-k3-256k", "kimicode/k3-256k", "wode/kimi-code-k3"];
  const wodeModels = config?.provider?.wodeapp?.models || {};
  for (const cand of preferred) {
    const bare = cand.includes("/") ? cand.split("/").slice(1).join("/") : cand;
    if (wodeModels[bare] || wodeModels[cand] || wodeModels[`wode/${bare}`]) {
      return {
        providerID: "wodeapp",
        modelID: wodeModels[bare] ? bare : wodeModels[cand] ? cand : `wode/${bare}`,
      };
    }
  }
  const configured = typeof config?.model === "string" ? config.model : "";
  if (configured.includes("/")) {
    const [providerID, ...rest] = configured.split("/");
    return { providerID, modelID: rest.join("/") };
  }
  return { providerID: "wodeapp", modelID: "wode/kimi-code-k3-256k" };
}

const PROMPTS = [
  "只用一句话回答：现在几点概念上的时间？不要调用任何工具。",
  "不要工具。用两句中文解释什么是 HTTP 429。",
  "先 tool_search query=bash，然后只调用一次 bash：echo hang-repro-$RANDOM。不要长文。",
  "不要工具。列出 3 条降低 Agent 空转的规则，每条一行。",
  "调用一次 bash：sleep 2; echo done。然后用一句话总结退出码。",
  "不要工具。回复 OK 即可。",
  "连续调用两次 bash：echo A 然后 echo B。中间不要长文。",
  "不要工具。用一句话说明 soft wall 是什么。",
];

function lastAssistant(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const info = list[i]?.info || list[i];
    if (info?.role === "assistant") {
      return { info, parts: list[i]?.parts || [], message: list[i] };
    }
  }
  return null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runWorker(workerId, ctx) {
  const title = `busy-empty-repro w${workerId} ${new Date().toISOString()}`;
  const session = await requestJson(ctx.baseUrl, ctx.headers, "POST", "/session", { title });
  if (!session?.id) throw new Error(`worker ${workerId}: create session failed`);

  const prompt = PROMPTS[workerId % PROMPTS.length];
  const started = Date.now();
  await requestJson(ctx.baseUrl, ctx.headers, "POST", `/session/${session.id}/prompt_async`, {
    model: ctx.model,
    parts: [{ type: "text", text: prompt }],
  });

  let hangHit = null;
  let emptySince = null;
  let emptyMsgId = null;
  let maxEmptyAgeMs = 0;
  let emptySamples = 0;
  let lastStatus = null;
  let turns = 0;
  const events = [];
  const maxTurns = Number(ctx.maxTurns || 4);

  while (Date.now() - started < ctx.budgetMs) {
    await sleep(ctx.pollMs);
    const statusMap = await requestJson(ctx.baseUrl, ctx.headers, "GET", "/session/status");
    const status = statusMap?.[session.id] || null;
    lastStatus = status?.type || status || "missing";
    const messages = await requestJson(ctx.baseUrl, ctx.headers, "GET", `/session/${session.id}/message?limit=6`);
    const last = lastAssistant(messages);
    const parts = last?.parts || [];
    const created = last?.info?.time?.created;
    const completed = last?.info?.time?.completed;
    const err = last?.info?.error;
    const msgId = last?.info?.id || null;
    const empty = Boolean(last) && parts.length === 0 && !completed && !err;
    const busy = lastStatus === "busy" || lastStatus === "retry";

    if (empty && busy) {
      if (emptyMsgId !== msgId) {
        emptyMsgId = msgId;
        emptySince = created || Date.now();
      }
      emptySamples += 1;
      const age = Date.now() - emptySince;
      if (age > maxEmptyAgeMs) maxEmptyAgeMs = age;
      if (age >= ctx.hangMs && !hangHit) {
        hangHit = {
          ageMs: age,
          messageId: msgId,
          status: lastStatus,
          at: new Date().toISOString(),
        };
        events.push({ type: "HANG", ...hangHit });
        try {
          await requestJson(ctx.baseUrl, ctx.headers, "POST", `/session/${session.id}/abort`);
          events.push({ type: "ABORTED_AFTER_HANG" });
        } catch (e) {
          events.push({ type: "ABORT_FAILED", error: String(e?.message || e) });
        }
        break;
      }
    } else if (!empty) {
      emptySince = null;
      emptyMsgId = null;
    }

    if (!busy && lastStatus !== "retry") {
      turns += 1;
      if (turns < maxTurns && !hangHit) {
        const wave = [
          "继续：不要工具，只回 DONE。",
          "继续：连续调用三次 bash（echo 1; echo 2; echo 3），每次单独 tool call，最后一句话结束。",
          "继续：先 grep package.json 里的 name，再一句话总结。",
          "继续：调用 bash sleep 3; echo woke。然后 DONE。",
        ][turns % 4];
        await requestJson(ctx.baseUrl, ctx.headers, "POST", `/session/${session.id}/prompt_async`, {
          model: ctx.model,
          parts: [{ type: "text", text: wave }],
        });
        continue;
      }
      break;
    }
  }

  const finalStatusMap = await requestJson(ctx.baseUrl, ctx.headers, "GET", "/session/status");
  const finalStatus = finalStatusMap?.[session.id]?.type || finalStatusMap?.[session.id] || "idle/missing";
  return {
    workerId,
    sessionId: session.id,
    prompt: prompt.slice(0, 60),
    hangHit: Boolean(hangHit),
    hang: hangHit,
    maxEmptyAgeMs,
    emptySamples,
    turns,
    elapsedMs: Date.now() - started,
    finalStatus,
    events,
  };
}

async function main() {
  const engine = await loadEngine();
  const port = findLivePort();
  const baseUrl = engine.baseUrl || (port ? `http://127.0.0.1:${port}` : null);
  if (!baseUrl) throw new Error("No LIVE sidecar baseUrl/port");
  const headers = authHeaders(engine);
  const config = await requestJson(baseUrl, headers, "GET", "/config");
  const model = pickModel(config);

  const maxTurns = Math.max(1, Number(readArg("--max-turns", "4")) || 4);
  const ctx = { baseUrl, headers, model, hangMs, budgetMs, pollMs, maxTurns };
  console.log(JSON.stringify({
    phase: "start",
    baseUrl,
    model,
    concurrency,
    hangMs,
    budgetMs,
    maxTurns,
    credits: true,
  }));

  const started = Date.now();
  const results = await Promise.all(
    Array.from({ length: concurrency }, (_, i) =>
      runWorker(i, ctx).catch((error) => ({
        workerId: i,
        hangHit: false,
        maxEmptyAgeMs: 0,
        error: String(error?.message || error),
      })),
    ),
  );

  const hangs = results.filter((r) => r.hangHit);
  const errors = results.filter((r) => r.error);
  const maxEmpty = Math.max(0, ...results.map((r) => Number(r.maxEmptyAgeMs) || 0));
  const summary = {
    phase: "done",
    elapsedMs: Date.now() - started,
    concurrency,
    hangMs,
    hangCount: hangs.length,
    errorCount: errors.length,
    maxEmptyAgeMs: maxEmpty,
    softHangGe20s: results.filter((r) => (r.maxEmptyAgeMs || 0) >= 20_000).length,
    softHangGe45s: results.filter((r) => (r.maxEmptyAgeMs || 0) >= 45_000).length,
    reproduced: hangs.length > 0,
    hangs: hangs.map((h) => ({
      workerId: h.workerId,
      sessionId: h.sessionId,
      ageMs: h.hang?.ageMs,
      messageId: h.hang?.messageId,
    })),
    results,
  };
  console.log(JSON.stringify(summary, null, 2));
  // 0 = hard hang reproduced; 3 = soft empty-shell ≥20s observed; 2 = clean
  if (hangs.length > 0) process.exitCode = 0;
  else if (maxEmpty >= 20_000) process.exitCode = 3;
  else process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
