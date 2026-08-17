#!/usr/bin/env node
/**
 * Live/runtime truncate gate A/B:
 *   - old vendor sidecar vs new patched binary
 *   - arm1: read a >8KB fixture (expects Truncate on new)
 *   - arm2: bash large output (expects truncateHandled / no blow-up)
 *
 *   source /tmp/wodeappx-live-ab.env
 *   node scripts/live-truncate-gate-ab.mjs \
 *     --old-binary <path> --new-binary <path>
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const wodeappxRoot = path.resolve(scriptDir, "..");

function readArg(name, fallback) {
  const args = process.argv.slice(2);
  const direct = args.find((v) => v.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}

const apiKey = readArg("--api-key", process.env.WODEAPP_API_KEY);
const origin = (readArg("--origin", process.env.WODEAPP_ORIGIN || "https://www.wodeapp.cn")).replace(/\/+$/, "");
const oldBinary = path.resolve(readArg("--old-binary", path.join(
  wodeappxRoot, "vendor/openwork/apps/desktop/resources/sidecars/opencode",
)));
const newBinary = path.resolve(readArg("--new-binary", path.join(
  wodeappxRoot, "scripts/context-bench/runs/live-truncate-gate/opencode-patched",
)));
const outRoot = path.resolve(readArg("--out-root", path.join(
  wodeappxRoot, "scripts/context-bench/runs/live-truncate-gate",
)));
const fixture = path.resolve(readArg("--fixture", path.join(outRoot, "fixture_fat.txt")));
const turnTimeoutMs = Number(readArg("--turn-timeout-ms", "300000"));

if (!apiKey) throw new Error("Missing WODEAPP_API_KEY");

const fixtureRel = path.relative(wodeappxRoot, fixture).split(path.sep).join("/");
const READ_PROMPT = `只做一件事：用 read 工具读取文件 ${fixtureRel}（不要 limit 太小；offset=1 limit=250）。读完后用一句话回复「已读」。禁止改文件、禁止其它工具。`;
const SHELL_PROMPT = `只用 bash 执行一次：python3 -c "print(('Z'*200+'\\n')*120)" 。看完输出后用一句话回复「shell完成」。禁止其它工具、禁止改文件。`;

function runBinary(binary, prompt, { cwd, env, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["run", "--format", "json", prompt], {
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
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

function sqliteJson(dbPath, sql) {
  const r = spawnSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr || sql);
  const t = r.stdout.trim();
  return t ? JSON.parse(t) : [];
}

function analyzeTools(dbPath) {
  const session = sqliteJson(dbPath, "SELECT id FROM session ORDER BY time_created DESC LIMIT 1")[0];
  if (!session) return { error: "no session" };
  const rows = sqliteJson(
    dbPath,
    `SELECT data FROM part WHERE session_id='${session.id}' AND json_extract(data,'$.type')='tool' ORDER BY time_created`,
  );
  const tools = [];
  for (const row of rows) {
    const part = JSON.parse(row.data);
    const st = part.state || {};
    if (st.status !== "completed") continue;
    const output = typeof st.output === "string" ? st.output : "";
    const meta = st.metadata || {};
    tools.push({
      tool: part.tool,
      bytes: Buffer.byteLength(output, "utf-8"),
      truncatedMeta: meta.truncated,
      truncateHandled: meta.truncateHandled === true,
      hasOutputPath: Boolean(meta.outputPath),
      hasTruncateHint: /truncated|Full output saved|spilled|Use Grep|Use the Task tool/i.test(output),
      outputHead: output.slice(0, 160).replace(/\n/g, "\\n"),
    });
  }
  return { sessionId: session.id, tools };
}

function buildConfig() {
  return {
    model: "wodeapp/wode/kimi-code-k3-256k",
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
        options: { apiKey, baseURL: `${origin}/mainserver/api/ai/v1` },
      },
    },
    compaction: { auto: true, prune: true, reserved: 128000 },
    tool_output: { max_lines: 80, max_bytes: 8192 },
  };
}

async function runArm(label, binary, prompt, kind) {
  const runDir = path.join(outRoot, label);
  const xdgData = path.join(runDir, "xdg", "data");
  const xdgConfig = path.join(runDir, "xdg", "config");
  const xdgCache = path.join(runDir, "xdg", "cache");
  await Promise.all([xdgData, xdgConfig, xdgCache].map((d) => mkdir(d, { recursive: true })));
  const env = {
    OPENCODE_CONFIG_CONTENT: JSON.stringify(buildConfig()),
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
    XDG_DATA_HOME: xdgData,
    XDG_CONFIG_HOME: xdgConfig,
    XDG_CACHE_HOME: xdgCache,
  };
  const started = Date.now();
  let result;
  let note = "completed";
  try {
    result = await runBinary(binary, prompt, { cwd: wodeappxRoot, env, timeoutMs: turnTimeoutMs });
  } catch (e) {
    note = String(e);
    result = { code: null, stdout: "", stderr: String(e) };
  }
  await writeFile(path.join(runDir, "stdout.jsonl"), result.stdout || "");
  await writeFile(path.join(runDir, "stderr.txt"), result.stderr || "");
  const dbPath = path.join(xdgData, "opencode", "opencode.db");
  let analysis = { error: "no db" };
  try {
    analysis = analyzeTools(dbPath);
  } catch (e) {
    analysis = { error: String(e) };
  }
  const metrics = {
    label,
    kind,
    binary,
    wallMs: Date.now() - started,
    exitCode: result.code,
    note,
    fixtureBytes: (await stat(fixture)).size,
    ...analysis,
  };
  await writeFile(path.join(runDir, "metrics.json"), JSON.stringify(metrics, null, 2));
  return metrics;
}

function verdict(readOld, readNew, shellOld, shellNew) {
  const pickRead = (m) => (m.tools || []).find((t) => t.tool === "read") || (m.tools || [])[0];
  const pickShell = (m) => (m.tools || []).find((t) => t.tool === "bash" || t.tool === "shell") || (m.tools || [])[0];
  const ro = pickRead(readOld);
  const rn = pickRead(readNew);
  const so = pickShell(shellOld);
  const sn = pickShell(shellNew);
  const checks = [];
  if (rn) {
    checks.push({
      name: "new_read_under_cap",
      pass: rn.bytes <= 8192 + 400 || rn.hasTruncateHint,
      detail: { bytes: rn.bytes, hint: rn.hasTruncateHint, handled: rn.truncateHandled },
    });
    checks.push({
      name: "new_read_not_truncateHandled",
      pass: rn.truncateHandled !== true,
      detail: { truncateHandled: rn.truncateHandled },
    });
  } else {
    checks.push({ name: "new_read_present", pass: false, detail: readNew });
  }
  if (ro && rn) {
    checks.push({
      name: "new_read_smaller_or_capped_vs_old",
      pass: rn.bytes < ro.bytes || (rn.bytes <= 8192 + 400 && ro.bytes > 8192),
      detail: { oldBytes: ro.bytes, newBytes: rn.bytes },
    });
  }
  if (sn) {
    checks.push({
      name: "new_shell_truncateHandled_or_under_cap",
      pass: sn.truncateHandled === true || sn.bytes <= 8192 + 400 || sn.hasTruncateHint,
      detail: { bytes: sn.bytes, handled: sn.truncateHandled, hint: sn.hasTruncateHint },
    });
  } else {
    checks.push({ name: "new_shell_present", pass: false, detail: shellNew });
  }
  return {
    ok: checks.every((c) => c.pass),
    checks,
    summary: { readOld: ro, readNew: rn, shellOld: so, shellNew: sn },
  };
}

const fixtureText = await readFile(fixture, "utf8").catch(() => "");
if (!fixtureText || Buffer.byteLength(fixtureText) <= 8192) {
  throw new Error(`Fixture missing or too small: ${fixture}`);
}

console.log("[live-truncate-gate] fixture", fixture, Buffer.byteLength(fixtureText));
console.log("[live-truncate-gate] old", oldBinary);
console.log("[live-truncate-gate] new", newBinary);

const readOld = await runArm("A-old-read", oldBinary, READ_PROMPT, "read");
console.log("[A-old-read]", JSON.stringify({ note: readOld.note, tools: readOld.tools }, null, 2));
const readNew = await runArm("B-new-read", newBinary, READ_PROMPT, "read");
console.log("[B-new-read]", JSON.stringify({ note: readNew.note, tools: readNew.tools }, null, 2));
const shellOld = await runArm("C-old-shell", oldBinary, SHELL_PROMPT, "shell");
console.log("[C-old-shell]", JSON.stringify({ note: shellOld.note, tools: shellOld.tools }, null, 2));
const shellNew = await runArm("D-new-shell", newBinary, SHELL_PROMPT, "shell");
console.log("[D-new-shell]", JSON.stringify({ note: shellNew.note, tools: shellNew.tools }, null, 2));

const report = {
  generatedAt: new Date().toISOString(),
  fixture,
  fixtureBytes: Buffer.byteLength(fixtureText),
  tool_output: { max_lines: 80, max_bytes: 8192 },
  arms: { readOld, readNew, shellOld, shellNew },
  verdict: verdict(readOld, readNew, shellOld, shellNew),
};
await writeFile(path.join(outRoot, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.verdict, null, 2));
if (!report.verdict.ok) process.exitCode = 1;
