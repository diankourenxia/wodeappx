#!/usr/bin/env node
/**
 * Multi-trial matrix for stable busy-empty hang reproduction via OpenCode only.
 * Prints hang rate per concurrency; exit 0 when a cell reaches --stable-rate.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function arg(name, fallback) {
  const a = process.argv.slice(2);
  const d = a.find((v) => v.startsWith(`${name}=`));
  if (d) return d.slice(name.length + 1);
  const i = a.indexOf(name);
  return i >= 0 ? a[i + 1] : fallback;
}

const TRIALS = Math.max(1, Number(arg("--trials", "3")) || 3);
const HANG_MS = Math.max(5000, Number(arg("--hang-ms", "12000")) || 12000);
const BUDGET_MS = Math.max(20000, Number(arg("--budget-ms", "60000")) || 60000);
const STABLE_RATE = Math.min(1, Math.max(0, Number(arg("--stable-rate", "0.66")) || 0.66));
const CONCS = String(arg("--conc", "1,4,8,12"))
  .split(",")
  .map((x) => Number(x.trim()))
  .filter((n) => n > 0);
const PROMPT = "不要工具。只回复两个字：确认。";

async function loadEngine() {
  return JSON.parse(
    await readFile(
      path.join(homedir(), "Library/Application Support/com.differentai.openwork/openwork-engine.json"),
      "utf8",
    ),
  );
}

function headers(engine) {
  return {
    Authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}`,
    "Content-Type": "application/json",
    ...(engine.directory ? { "x-opencode-directory": engine.directory } : {}),
  };
}

async function req(baseUrl, h, method, pathname, body) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function lastAsst(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const info = list[i]?.info || list[i];
    if (info?.role === "assistant") return { info, parts: list[i]?.parts || [] };
  }
  return null;
}

function count443() {
  const ps = spawnSync("pgrep", ["-f", "resources/sidecars/opencode"], { encoding: "utf8" });
  const pid = (ps.stdout || "").trim().split(/\n/).filter(Boolean)[0];
  if (!pid) return { pid: null, to443: 0 };
  const out = spawnSync("lsof", ["-nP", "-a", "-p", pid.trim(), "-iTCP"], { encoding: "utf8" });
  const to443 = (out.stdout || "").split(/\n/).filter((l) => l.includes("ESTABLISHED") && l.includes(":443")).length;
  return { pid: pid.trim(), to443 };
}

async function oneWorker(ctx, i, trial, conc) {
  const session = await req(ctx.baseUrl, ctx.h, "POST", "/session", {
    title: `stable-hang c${conc} t${trial} w${i}`,
  });
  const started = Date.now();
  await req(ctx.baseUrl, ctx.h, "POST", `/session/${session.id}/prompt_async`, {
    model: ctx.model,
    parts: [{ type: "text", text: `${PROMPT} (c${conc}/t${trial}/w${i})` }],
  });
  let emptySince = null;
  let emptyMax = 0;
  let firstPartMs = null;
  let hang = false;
  let sockets = null;
  while (Date.now() - started < ctx.budgetMs) {
    await sleep(800);
    const stMap = await req(ctx.baseUrl, ctx.h, "GET", "/session/status");
    const st = stMap?.[session.id]?.type || stMap?.[session.id] || "missing";
    const messages = await req(ctx.baseUrl, ctx.h, "GET", `/session/${session.id}/message?limit=2`);
    const last = lastAsst(messages);
    const parts = last?.parts || [];
    const done = last?.info?.time?.completed;
    const err = last?.info?.error;
    const empty = Boolean(last) && parts.length === 0 && !done && !err;
    const busy = st === "busy" || st === "retry";
    if (parts.length && firstPartMs == null) firstPartMs = Date.now() - started;
    if (empty && busy) {
      if (emptySince == null) emptySince = Date.now();
      const age = Date.now() - emptySince;
      if (age > emptyMax) emptyMax = age;
      if (age >= ctx.hangMs && !hang) {
        hang = true;
        sockets = count443();
        try { await req(ctx.baseUrl, ctx.h, "POST", `/session/${session.id}/abort`); } catch {}
        break;
      }
    } else emptySince = null;
    if (!busy && st !== "retry") break;
  }
  return { sessionId: session.id, hang, emptyMax, firstPartMs, sockets, elapsedMs: Date.now() - started };
}

async function trial(ctx, conc, trialIdx) {
  const t0 = Date.now();
  const rows = await Promise.all(
    Array.from({ length: conc }, (_, i) => oneWorker(ctx, i, trialIdx, conc)),
  );
  const hangs = rows.filter((r) => r.hang);
  return {
    conc,
    trial: trialIdx,
    hangWorkers: hangs.length,
    hangWorkerRate: hangs.length / conc,
    trialHang: hangs.length > 0,
    maxEmpty: Math.max(0, ...rows.map((r) => r.emptyMax || 0)),
    p50FirstPart: (() => {
      const v = rows.map((r) => r.firstPartMs).filter((x) => typeof x === "number").sort((a, b) => a - b);
      return v.length ? v[Math.floor(v.length / 2)] : null;
    })(),
    socketsAtHang: hangs[0]?.sockets || null,
    elapsedMs: Date.now() - t0,
  };
}

async function main() {
  const engine = await loadEngine();
  const baseUrl = engine.baseUrl;
  const h = headers(engine);
  const model = { providerID: "wodeapp", modelID: "wode/kimi-code-k3-256k" };
  const ctx = { baseUrl, h, model, hangMs: HANG_MS, budgetMs: BUDGET_MS };
  console.log(JSON.stringify({ phase: "start", baseUrl, trials: TRIALS, hangMs: HANG_MS, budgetMs: BUDGET_MS, concs: CONCS, stableRate: STABLE_RATE }));

  const cells = [];
  let stableCell = null;
  for (const conc of CONCS) {
    const trials = [];
    for (let t = 0; t < TRIALS; t++) {
      const row = await trial(ctx, conc, t);
      trials.push(row);
      console.log(JSON.stringify({ phase: "trial", ...row }));
      // brief cool-down so sidecar/proxy settle
      await sleep(1500);
    }
    const hangTrials = trials.filter((x) => x.trialHang).length;
    const rate = hangTrials / TRIALS;
    const cell = {
      conc,
      trials: TRIALS,
      hangTrials,
      hangTrialRate: rate,
      meanHangWorkers: trials.reduce((s, x) => s + x.hangWorkers, 0) / TRIALS,
      maxEmptyAcross: Math.max(...trials.map((x) => x.maxEmpty)),
      stable: rate >= STABLE_RATE,
    };
    cells.push(cell);
    console.log(JSON.stringify({ phase: "cell", ...cell }));
    if (!stableCell && cell.stable) stableCell = cell;
  }

  const out = {
    phase: "done",
    stableReproduced: Boolean(stableCell),
    stableCell,
    cells,
    criterion: `hangTrialRate >= ${STABLE_RATE} over ${TRIALS} trials (hang = busy+empty >= ${HANG_MS}ms)`,
  };
  console.log(JSON.stringify(out, null, 2));
  process.exitCode = stableCell ? 0 : 2;
}

main().catch((e) => { console.error(e); process.exit(1); });
