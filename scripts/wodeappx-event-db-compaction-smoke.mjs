#!/usr/bin/env node
/**
 * PERF-06 步骤 3 的运行时补证：用 compaction 后的副本库启动真实 opencode 引擎，
 * 实测 会话列表 / 消息等价 / 续跑一轮 / revert+unrevert，证明 seq 空洞可容忍。
 *
 * 沙箱隔离：复制账户 xdg config（provider 配置，剔除 mcp 避免拉起外部进程）+
 * compaction 副本库到 test-results 下独立 XDG 目录，引擎用独立端口与独立凭据，
 * 不影响正在运行的桌面端引擎；副本库上的写入（新 turn）不进线上库。
 *
 * 用法：
 *   node scripts/wodeappx-event-db-compaction-smoke.mjs                 # 自动找最新 compaction 副本
 *   node scripts/wodeappx-event-db-compaction-smoke.mjs --copy <dir> --project <dir> --out <dir>
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { locateDb, redactString } from "./wodeappx-performance-soak.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const wodeappxRoot = resolve(scriptDir, "..");

const OPENCODE_BIN = join(homedir(), ".opencode", "bin", process.platform === "win32" ? "opencode.exe" : "opencode");
const SMOKE_PROMPT = "请只回复 OK-SMOKE，不要调用任何工具。";
const TURN_TIMEOUT_MS = 90_000;

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function latestCompactionCopy() {
  const root = join(wodeappxRoot, "test-results");
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("event-db-compaction-"))
    .map((entry) => join(root, entry.name, "copy", "opencode.db"))
    .filter((file) => existsSync(file))
    .map((file) => ({ file, mtimeMs: statSync(file).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  return dirs[0]?.file ?? null;
}

function openDbReadonly(dbPath) {
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA query_only = ON");
  return db;
}

/** 引擎 HTTP 客户端（basic auth + directory 查询参数）。 */
function makeClient({ baseUrl, username, password, directory }) {
  const headers = {
    Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
  return async function request(method, pathname, body) {
    const url = new URL(pathname, baseUrl);
    if (directory) url.searchParams.set("directory", directory);
    const response = await fetch(url, {
      method,
      headers: {
        ...headers,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let parsed;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: response.status, ok: response.ok, body: parsed };
  };
}

async function waitForEngine(request, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no attempt";
  while (Date.now() < deadline) {
    try {
      const response = await request("GET", "/session");
      if (response.ok || response.status === 401 || response.status === 200) return true;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  throw new Error(`引擎 30s 内未就绪：${lastError}`);
}

function messageFingerprint(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return {
    count: list.length,
    ids: list.map((item) => item?.info?.id ?? ""),
    textBytes: list.reduce((total, item) => total + (item?.parts ?? []).reduce((partTotal, part) => {
      const text = typeof part?.text === "string" ? part.text : "";
      const output = typeof part?.state?.output === "string" ? part.state.output : "";
      return partTotal + text.length + output.length;
    }, 0), 0),
  };
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    process.stdout.write(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(0, 12).join("\n") + "\n");
    return;
  }
  const copyDb = readArg("--copy") ? resolve(readArg("--copy")) : latestCompactionCopy();
  if (!copyDb || !existsSync(copyDb)) throw new Error("未找到 compaction 副本库，先跑 pnpm test:event-db-compaction:dryrun");
  if (!existsSync(OPENCODE_BIN)) throw new Error(`未找到 opencode 引擎：${OPENCODE_BIN}`);

  // 项目目录：优先 --project，其次副本库 project 表里的 worktree
  const copyReader = openDbReadonly(copyDb);
  let projectDir = readArg("--project");
  let sessionCountInDb = 0;
  let topAggregates = [];
  try {
    sessionCountInDb = copyReader.prepare("SELECT COUNT(*) AS n FROM session").get().n;
    topAggregates = copyReader.prepare(
      "SELECT aggregate_id AS id, COUNT(*) AS n FROM event GROUP BY aggregate_id ORDER BY n DESC LIMIT 5",
    ).all();
    if (!projectDir) {
      // 取事件量最大会话所属的 project（会话按 project 隔离，directory 必须匹配）
      projectDir = copyReader.prepare(
        `SELECT p.worktree FROM event e
         JOIN session s ON s.id = e.aggregate_id
         JOIN project p ON p.id = s.project_id
         GROUP BY p.worktree ORDER BY COUNT(*) DESC LIMIT 1`,
      ).get()?.worktree;
    }
  } finally {
    try { copyReader.close(); } catch { /* ignore */ }
  }
  if (!projectDir || !existsSync(projectDir)) throw new Error(`项目目录不可用：${projectDir}`);

  const outDir = resolve(readArg("--out") ?? join(wodeappxRoot, "test-results", `event-db-smoke-${new Date().toISOString().replace(/[:.]/g, "-")}`));
  const sandbox = join(outDir, "sandbox");
  mkdirSync(join(sandbox, "data", "opencode"), { recursive: true });
  mkdirSync(join(sandbox, "config"), { recursive: true });
  mkdirSync(join(sandbox, "state"), { recursive: true });

  // 副本库 → 沙箱（连 wal/shm 一起）
  for (const suffix of ["", "-wal", "-shm"]) {
    if (existsSync(`${copyDb}${suffix}`)) copyFileSync(`${copyDb}${suffix}`, join(sandbox, "data", "opencode", `opencode.db${suffix}`));
  }
  // 账户 xdg config → 沙箱（剔除 mcp，避免拉起外部进程/OAuth；保留 provider/model 保证续跑真实）
  // 注意：从「线上库」路径推导账户 xdg，副本库在 test-results 下、结构不同
  const liveDb = locateDb();
  const accountXdg = liveDb ? dirname(dirname(dirname(liveDb))) : null; // <account>/xdg/data/opencode/opencode.db → <account>/xdg
  const liveConfig = accountXdg ? join(accountXdg, "config", "opencode") : null;
  if (liveConfig && existsSync(liveConfig)) {
    cpSync(liveConfig, join(sandbox, "config", "opencode"), { recursive: true });
    const configFile = join(sandbox, "config", "opencode", "opencode.json");
    if (existsSync(configFile)) {
      const config = JSON.parse(readFileSync(configFile, "utf8"));
      delete config.mcp;
      writeFileSync(configFile, JSON.stringify(config, null, 2));
    }
  }
  const liveAuth = accountXdg ? join(accountXdg, "data", "opencode", "auth.json") : null;
  if (liveAuth && existsSync(liveAuth)) copyFileSync(liveAuth, join(sandbox, "data", "opencode", "auth.json"));

  const username = randomBytes(16).toString("hex");
  const password = randomBytes(16).toString("hex");
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const request = makeClient({ baseUrl, username, password, directory: projectDir });

  process.stdout.write(`[smoke] 启动沙箱引擎（${OPENCODE_BIN} serve :${port}，project=${projectDir}）…\n`);
  const engineLog = [];
  const child = spawn(OPENCODE_BIN, ["serve", "--hostname", "127.0.0.1", "--port", String(port), "--cors", "*"], {
    cwd: projectDir,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(sandbox, "config"),
      XDG_DATA_HOME: join(sandbox, "data"),
      XDG_STATE_HOME: join(sandbox, "state"),
      OPENCODE_CONFIG_DIR: join(sandbox, "config", "opencode"),
      OPENCODE_SERVER_USERNAME: username,
      OPENCODE_SERVER_PASSWORD: password,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => engineLog.push(String(chunk)));
  child.stderr.on("data", (chunk) => engineLog.push(String(chunk)));

  const results = [];
  const record = (id, ok, detail) => {
    results.push({ id, ok, detail });
    process.stdout.write(`[smoke] ${ok ? "PASS" : "FAIL"} ${id}：${detail}\n`);
  };

  try {
    await waitForEngine(request);
    record("engine-boot", true, `引擎用 compaction 副本库启动成功（${sessionCountInDb} 个 session 在库）`);

    // T1 会话列表
    const sessions = await request("GET", "/session");
    const sessionList = Array.isArray(sessions.body) ? sessions.body : [];
    // 注：GET /session 有默认分页上限（100），此处只判定「可读」，不期望等于库内总数
    record("session-list", sessions.ok && sessionList.length > 0, `GET /session 返回 ${sessionList.length} 个（API 默认分页上限；库内 ${sessionCountInDb}）`);

    // T2 消息等价：选 compaction 前后都在、事件量最大的会话，对照 live 引擎
    const targetSession = topAggregates[0]?.id;
    if (targetSession && sessionList.some((item) => item?.id === targetSession)) {
      const sandboxMessages = await request("GET", `/session/${encodeURIComponent(targetSession)}/message`, undefined);
      const fingerprint = messageFingerprint(sandboxMessages.body);
      const dbMessages = openDbReadonly(copyDb);
      const dbCount = dbMessages.prepare("SELECT COUNT(*) AS n FROM message WHERE session_id = ?").get(targetSession).n;
      try { dbMessages.close(); } catch { /* ignore */ }
      record(
        "transcript-intact",
        sandboxMessages.ok && fingerprint.count === dbCount && fingerprint.textBytes > 0,
        `最重压缩会话 ${targetSession}：引擎返回 ${fingerprint.count} 条消息 / ${fingerprint.textBytes} 字符（库内 ${dbCount} 条）`,
      );
    } else {
      record("transcript-intact", false, `目标会话 ${targetSession ?? "无"} 不在列表中`);
    }

    // T3 续跑一轮（烧一次最小积分，走默认模型路由）
    const continueSession = await request("POST", "/session", { title: `compaction-smoke ${Date.now()}` });
    const continueId = continueSession.body?.id;
    if (!continueSession.ok || !continueId) {
      record("continue-turn", false, `创建会话失败：HTTP ${continueSession.status}`);
    } else {
      const prompted = await request("POST", `/session/${encodeURIComponent(continueId)}/prompt_async`, {
        parts: [{ type: "text", text: SMOKE_PROMPT }],
      });
      if (!prompted.ok && prompted.status !== 204) {
        record("continue-turn", false, `prompt_async 失败：HTTP ${prompted.status} ${redactString(JSON.stringify(prompted.body))}`);
      } else {
        const deadline = Date.now() + TURN_TIMEOUT_MS;
        let idle = false;
        while (Date.now() < deadline) {
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
          const status = await request("GET", "/session/status");
          const sessionStatus = status.body?.[continueId];
          if (!sessionStatus || sessionStatus.type === "idle") { idle = true; break; }
        }
        const messages = await request("GET", `/session/${encodeURIComponent(continueId)}/message`);
        const reply = (Array.isArray(messages.body) ? messages.body : [])
          .flatMap((item) => item?.parts ?? [])
          .filter((part) => part?.type === "text")
          .map((part) => part.text ?? "")
          .join("\n");
        record("continue-turn", idle && /OK-SMOKE/.test(reply), idle ? `续跑完成，回复含 OK-SMOKE：${/OK-SMOKE/.test(reply)}` : "续跑超时");
      }
    }

    // T4 revert / unrevert（在 T2 的重压缩会话上做，最大化覆盖 seq 空洞影响面）
    if (targetSession) {
      const before = await request("GET", `/session/${encodeURIComponent(targetSession)}/message`);
      const beforeFp = messageFingerprint(before.body);
      const lastUser = [...(Array.isArray(before.body) ? before.body : [])]
        .reverse()
        .find((item) => item?.info?.role === "user");
      if (!lastUser) {
        record("revert-unrevert", false, "会话没有 user 消息可 revert");
      } else {
        const reverted = await request("POST", `/session/${encodeURIComponent(targetSession)}/revert`, { messageID: lastUser.info.id });
        const duringRevert = await request("GET", `/session/${encodeURIComponent(targetSession)}/message`);
        const duringFp = messageFingerprint(duringRevert.body);
        const unreverted = await request("POST", `/session/${encodeURIComponent(targetSession)}/unrevert`);
        const after = await request("GET", `/session/${encodeURIComponent(targetSession)}/message`);
        const afterFp = messageFingerprint(after.body);
        const restored = JSON.stringify(afterFp.ids) === JSON.stringify(beforeFp.ids);
        const shrinkOrMarked = reverted.ok && (duringFp.count <= beforeFp.count);
        record(
          "revert-unrevert",
          reverted.ok && unreverted.ok && shrinkOrMarked && restored,
          `revert ${reverted.status}（消息 ${beforeFp.count}→${duringFp.count}）/ unrevert ${unreverted.status}（恢复一致=${restored}）`,
        );
      }
    }

    // T5 引擎日志扫描：event/seq/replay 相关报错
    const logText = engineLog.join("");
    const badLines = logText.split("\n").filter((line) => /error/i.test(line) && /event|seq|replay|migration/i.test(line));
    record("engine-log-clean", badLines.length === 0, badLines.length ? `可疑日志 ${badLines.length} 行：${redactString(badLines[0])}` : "无 event/seq/replay 相关报错");
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_500));
    if (!child.killed) child.kill("SIGKILL");
  }

  const passed = results.filter((item) => item.ok).length;
  const evidence = {
    at: new Date().toISOString(),
    copyDb,
    projectDir,
    sandbox,
    results,
    passed,
    total: results.length,
    engineLogTail: redactString(engineLog.join("").slice(-4_000)),
  };
  writeFileSync(join(outDir, "smoke.json"), JSON.stringify(evidence, null, 2));
  writeFileSync(join(outDir, "report.md"), [
    `# compaction 副本库引擎冒烟（PERF-06 步骤 3 运行时证明）`,
    ``,
    `- 时间：${evidence.at}`,
    `- 副本库：${copyDb}`,
    `- 项目：${projectDir}`,
    ``,
    `| 检查 | 结果 | 明细 |`,
    `|---|---|---|`,
    ...results.map((item) => `| ${item.id} | ${item.ok ? "PASS" : "FAIL"} | ${item.detail} |`),
    ``,
    `沙箱说明：引擎使用独立 XDG 目录（${sandbox}），配置剔除了 mcp（避免拉起外部进程），保留 provider/model；副本库上的写入不进入线上库。`,
  ].join("\n"));

  process.stdout.write(`\n[smoke] ${passed}/${results.length} 通过，报告：${join(outDir, "report.md")}\n`);
  if (passed !== results.length) process.exit(1);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  main().catch((error) => {
    process.stderr.write(`[smoke] 失败：${redactString(error instanceof Error ? error.message : String(error))}\n`);
    process.exit(1);
  });
}
