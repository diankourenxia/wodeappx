#!/usr/bin/env node
/**
 * Pinpoint where busy-empty hangs sit:
 * A) Direct cloud chat/completions TTFT (bypass OpenCode)
 * B) OpenCode sequential vs concurrent empty-shell age + outbound sockets
 *
 * Usage:
 *   node wodeappx/scripts/pinpoint-busy-empty-hang.mjs
 *   node wodeappx/scripts/pinpoint-busy-empty-hang.mjs --direct-n=4 --oc-n=8
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function arg(name, fallback) {
  const args = process.argv.slice(2);
  const direct = args.find((v) => v.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}

const DIRECT_N = Math.max(1, Number(arg("--direct-n", "4")) || 4);
const OC_SEQ_N = Math.max(1, Number(arg("--oc-seq", "4")) || 4);
const OC_CONC_N = Math.max(1, Number(arg("--oc-n", "8")) || 8);
const HANG_MS = Math.max(5_000, Number(arg("--hang-ms", "12000")) || 12_000);
const BUDGET_MS = Math.max(30_000, Number(arg("--budget-ms", "90000")) || 90_000);
const PROMPT = "不要工具。只回复两个字：确认。";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function loadApiKey() {
  const credPath = path.join(homedir(), ".wodeapp/credentials.v1.json");
  const cfgPath = path.join(homedir(), ".wodeapp/config.json");
  try {
    const cred = await loadJson(credPath);
    const key = cred?.apiKey || cred?.accounts?.[0]?.apiKey || cred?.current?.apiKey;
    if (typeof key === "string" && key.startsWith("sk_")) return key;
  } catch { /* fallthrough */ }
  try {
    const cfg = await loadJson(cfgPath);
    const key = cfg?.apiKey || cfg?.wodeappApiKey;
    if (typeof key === "string" && key.startsWith("sk_")) return key;
  } catch { /* fallthrough */ }
  if (process.env.WODEAPP_API_KEY?.startsWith("sk_")) return process.env.WODEAPP_API_KEY;
  throw new Error("No WodeApp API key in ~/.wodeapp or WODEAPP_API_KEY");
}

async function loadEngine() {
  const file = path.join(
    homedir(),
    "Library/Application Support/com.differentai.openwork/openwork-engine.json",
  );
  return loadJson(file);
}

function authHeaders(engine) {
  return {
    Authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}`,
    "Content-Type": "application/json",
    ...(engine.directory ? { "x-opencode-directory": engine.directory } : {}),
  };
}

async function requestJson(baseUrl, headers, method, pathname, body) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${pathname} → ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function opencodePid() {
  const ps = spawnSync("pgrep", ["-f", "resources/sidecars/opencode"], { encoding: "utf8" });
  const line = (ps.stdout || "").trim().split(/\n/).filter(Boolean)[0];
  return line ? Number(line.trim()) : null;
}

function countOutboundHttps(pid) {
  if (!pid) return { established: 0, to443: 0, sample: [] };
  const out = spawnSync("lsof", ["-nP", "-a", "-p", String(pid), "-iTCP"], { encoding: "utf8" });
  const lines = (out.stdout || "").split(/\n/).filter((l) => l.includes("ESTABLISHED"));
  const to443 = lines.filter((l) => /:443\s+\(ESTABLISHED\)/.test(l) || /->[^ ]+:443 \(ESTABLISHED\)/.test(l));
  return {
    established: lines.length,
    to443: to443.length,
    sample: to443.slice(0, 6).map((l) => l.replace(/\s+/g, " ").trim()),
  };
}

/** Direct SSE TTFT against cloud mainserver (no OpenCode). */
async function directTtft(apiKey, i) {
  const started = Date.now();
  let firstByteMs = null;
  let firstDataMs = null;
  let doneMs = null;
  let status = 0;
  let err = null;
  let bytes = 0;
  try {
    const res = await fetch("https://wodeapp.cn/mainserver/api/ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "wode/kimi-code-k3-256k",
        stream: true,
        messages: [{ role: "user", content: `${PROMPT} (#${i})` }],
        max_tokens: 16,
      }),
    });
    status = res.status;
    if (!res.ok || !res.body) {
      err = `http_${status}`;
      return { i, mode: "direct", status, firstByteMs, firstDataMs, doneMs, err, elapsedMs: Date.now() - started };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (firstByteMs == null) firstByteMs = Date.now() - started;
      bytes += value?.byteLength || 0;
      buf += decoder.decode(value, { stream: true });
      if (firstDataMs == null && /data:\s*\{/.test(buf)) firstDataMs = Date.now() - started;
      if (buf.includes("[DONE]")) {
        doneMs = Date.now() - started;
        break;
      }
    }
    if (doneMs == null) doneMs = Date.now() - started;
  } catch (e) {
    err = String(e?.message || e).slice(0, 160);
  }
  return {
    i,
    mode: "direct",
    status,
    firstByteMs,
    firstDataMs,
    doneMs,
    bytes,
    err,
    elapsedMs: Date.now() - started,
  };
}

function lastAssistant(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const info = list[i]?.info || list[i];
    if (info?.role === "assistant") return { info, parts: list[i]?.parts || [] };
  }
  return null;
}

async function ocOneTurn(ctx, i, label) {
  const session = await requestJson(ctx.baseUrl, ctx.headers, "POST", "/session", {
    title: `pinpoint-${label}-${i}-${Date.now()}`,
  });
  const started = Date.now();
  await requestJson(ctx.baseUrl, ctx.headers, "POST", `/session/${session.id}/prompt_async`, {
    model: ctx.model,
    parts: [{ type: "text", text: `${PROMPT} (#${label}-${i})` }],
  });

  let firstPartMs = null;
  let emptyAgeMax = 0;
  let emptySince = null;
  let hang = false;
  let socketsAtHang = null;
  let finalStatus = null;
  let err = null;

  while (Date.now() - started < ctx.budgetMs) {
    await sleep(1000);
    const statusMap = await requestJson(ctx.baseUrl, ctx.headers, "GET", "/session/status");
    const st = statusMap?.[session.id];
    finalStatus = st?.type || st || "missing";
    const messages = await requestJson(ctx.baseUrl, ctx.headers, "GET", `/session/${session.id}/message?limit=3`);
    const last = lastAssistant(messages);
    const parts = last?.parts || [];
    const completed = last?.info?.time?.completed;
    const error = last?.info?.error;
    const empty = Boolean(last) && parts.length === 0 && !completed && !error;
    const busy = finalStatus === "busy" || finalStatus === "retry";

    if (parts.length > 0 && firstPartMs == null) firstPartMs = Date.now() - started;

    if (empty && busy) {
      if (emptySince == null) emptySince = Date.now();
      const age = Date.now() - emptySince;
      if (age > emptyAgeMax) emptyAgeMax = age;
      if (age >= ctx.hangMs && !hang) {
        hang = true;
        socketsAtHang = countOutboundHttps(ctx.pid);
      }
    } else {
      emptySince = null;
    }

    if (!busy && finalStatus !== "retry") break;
  }

  if (hang) {
    try {
      await requestJson(ctx.baseUrl, ctx.headers, "POST", `/session/${session.id}/abort`);
    } catch { /* ignore */ }
  }

  return {
    i,
    mode: `oc-${label}`,
    sessionId: session.id,
    firstPartMs,
    emptyAgeMaxMs: emptyAgeMax,
    hang,
    socketsAtHang,
    finalStatus,
    err,
    elapsedMs: Date.now() - started,
  };
}

function summarize(rows, keyMs) {
  const vals = rows.map((r) => r[keyMs]).filter((v) => typeof v === "number");
  if (!vals.length) return { n: 0 };
  vals.sort((a, b) => a - b);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return {
    n: vals.length,
    min: vals[0],
    p50: vals[Math.floor(vals.length * 0.5)],
    p90: vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.9))],
    max: vals[vals.length - 1],
    mean: Math.round(mean),
  };
}

async function main() {
  const apiKey = await loadApiKey();
  const engine = await loadEngine();
  const baseUrl = engine.baseUrl;
  const headers = authHeaders(engine);
  const config = await requestJson(baseUrl, headers, "GET", "/config");
  const model = {
    providerID: "wodeapp",
    modelID: config?.provider?.wodeapp?.models?.["wode/kimi-code-k3-256k"]
      ? "wode/kimi-code-k3-256k"
      : "wode/kimi-code-k3-256k",
  };
  const pid = opencodePid();
  const socketsIdle = countOutboundHttps(pid);

  console.log(JSON.stringify({
    phase: "start",
    baseUrl,
    model,
    pid,
    socketsIdle,
    directN: DIRECT_N,
    ocSeqN: OC_SEQ_N,
    ocConcN: OC_CONC_N,
    hangMs: HANG_MS,
  }));

  // A1 sequential direct
  const directSeq = [];
  for (let i = 0; i < DIRECT_N; i += 1) {
    directSeq.push(await directTtft(apiKey, i));
  }

  // A2 concurrent direct
  const directConc = await Promise.all(
    Array.from({ length: DIRECT_N }, (_, i) => directTtft(apiKey, 100 + i)),
  );

  const ctx = { baseUrl, headers, model, budgetMs: BUDGET_MS, hangMs: HANG_MS, pid };

  // B1 sequential OpenCode
  const ocSeq = [];
  for (let i = 0; i < OC_SEQ_N; i += 1) {
    ocSeq.push(await ocOneTurn(ctx, i, "seq"));
  }

  // B2 concurrent OpenCode
  const ocConc = await Promise.all(
    Array.from({ length: OC_CONC_N }, (_, i) => ocOneTurn(ctx, i, "conc")),
  );

  const summary = {
    phase: "done",
    verdict: null,
    direct_seq_ttft: summarize(directSeq, "firstDataMs"),
    direct_conc_ttft: summarize(directConc, "firstDataMs"),
    direct_seq_done: summarize(directSeq, "doneMs"),
    direct_conc_done: summarize(directConc, "doneMs"),
    oc_seq_firstPart: summarize(ocSeq, "firstPartMs"),
    oc_conc_firstPart: summarize(ocConc, "firstPartMs"),
    oc_seq_emptyMax: summarize(ocSeq, "emptyAgeMaxMs"),
    oc_conc_emptyMax: summarize(ocConc, "emptyAgeMaxMs"),
    oc_conc_hangCount: ocConc.filter((r) => r.hang).length,
    oc_seq_hangCount: ocSeq.filter((r) => r.hang).length,
    hangSocketSamples: ocConc.filter((r) => r.socketsAtHang).map((r) => ({
      sessionId: r.sessionId,
      emptyAgeMaxMs: r.emptyAgeMaxMs,
      sockets: r.socketsAtHang,
    })),
    directSeq,
    directConc,
    ocSeq,
    ocConc,
  };

  // Heuristic verdict (labeled as measured deltas, not absolute root cause alone)
  const dSeq = summary.direct_seq_ttft.p50 || 0;
  const dConc = summary.direct_conc_ttft.p50 || 0;
  const oSeq = summary.oc_seq_emptyMax.p50 || 0;
  const oConc = summary.oc_conc_emptyMax.p50 || 0;
  const concHang = summary.oc_conc_hangCount;
  const hasOutboundOnHang = summary.hangSocketSamples.some((h) => (h.sockets?.to443 || 0) > 0);

  let verdict;
  if (concHang > 0 && dConc > 0 && dConc < HANG_MS && oConc >= HANG_MS) {
    verdict = hasOutboundOnHang
      ? "LIKELY_WAIT_ON_UPSTREAM_STREAM_UNDER_OC_FANOUT (cloud TTFT ok; OC empty-shell hang with outbound :443 still open)"
      : "LIKELY_OC_ENGINE_STUCK_WITHOUT_OUTBOUND (cloud TTFT ok; OC hang with no/few :443 sockets)";
  } else if (dConc > (dSeq * 2 + 3000) && concHang > 0) {
    verdict = "LIKELY_UPSTREAM_OR_PROXY_CONTENTION (direct concurrent TTFT much worse + OC hangs)";
  } else if (concHang === 0 && oConc < HANG_MS) {
    verdict = "NO_HARD_HANG_THIS_RUN (compare p50/max; flaky)";
  } else {
    verdict = "MIXED_OR_INCONCLUSIVE — inspect raw rows";
  }
  summary.verdict = verdict;
  summary.deltas = {
    direct_conc_vs_seq_p50_ms: (summary.direct_conc_ttft.p50 || 0) - (summary.direct_seq_ttft.p50 || 0),
    oc_conc_vs_seq_empty_p50_ms: (summary.oc_conc_emptyMax.p50 || 0) - (summary.oc_seq_emptyMax.p50 || 0),
  };

  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = concHang > 0 ? 0 : 2;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
