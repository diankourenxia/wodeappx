#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  closeSync,
  constants as fsConstants,
  openSync,
} from "node:fs";
import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const DEFAULT_INSTANCE_IDS = Object.freeze([1]);
const DEFAULT_CDP_BASE_PORT = 9222;
const DEFAULT_INSTANCE_ROLES = Object.freeze({
  1: "交互回归",
  2: "商品生图",
  3: "路由与画布",
});

function defaultStateRoot() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "com.differentai.openwork.test-instances");
  }
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || os.homedir(), "Different AI", "OpenWork Test Instances");
  }
  return path.join(process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "wodeappx-test-instances");
}

export function parseInstanceIds(value) {
  if (!value) return [...DEFAULT_INSTANCE_IDS];
  const ids = String(value)
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isInteger(item) && item > 0 && item <= 99);
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    throw new Error("--instances 需要 1-99 之间的编号，例如 1,2,3");
  }
  return unique;
}

export function assertTestInstanceLaunchDisabled(command) {
  if (["start", "seed"].includes(command)) {
    throw new Error("WodeAppX 测试实例已全部禁用；请直接使用开发版");
  }
}

export function buildInstanceConfig({
  id,
  stateRoot = defaultStateRoot(),
  cdpBasePort = DEFAULT_CDP_BASE_PORT,
}) {
  const instanceRoot = path.join(path.resolve(stateRoot), `instance-${id}`);
  const role = DEFAULT_INSTANCE_ROLES[id] || "专项测试";
  return {
    id,
    role,
    name: `WodeAppX · ${id} ${role}`,
    identifier: `com.differentai.openwork.test.${id}`,
    cdpPort: cdpBasePort + id,
    instanceRoot,
    userDataDir: path.join(instanceRoot, "user-data"),
    logPath: path.join(instanceRoot, "desktop.log"),
    processStatePath: path.join(instanceRoot, "process.json"),
    uiControlDiscoveryPath: path.join(instanceRoot, "user-data", "openwork-ui-control.json"),
  };
}

function parseArgs(argv) {
  const options = {
    command: argv[0] || "help",
    instanceIds: [...DEFAULT_INSTANCE_IDS],
    stateRoot: defaultStateRoot(),
    appPath: process.env.WODEAPPX_TEST_APP?.trim() || "",
    waitMs: 45_000,
    clean: false,
    dryRun: false,
    json: false,
    accountId: "",
    sourceDataRoot: process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support", "com.differentai.openwork")
      : "",
  };

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--instances") {
      options.instanceIds = parseInstanceIds(argv[++index]);
    } else if (arg === "--state-root") {
      options.stateRoot = path.resolve(argv[++index]);
    } else if (arg === "--app") {
      options.appPath = path.resolve(argv[++index]);
    } else if (arg === "--wait-ms") {
      options.waitMs = Math.max(0, Number.parseInt(argv[++index], 10) || 0);
    } else if (arg === "--account") {
      options.accountId = String(argv[++index] || "").trim();
    } else if (arg === "--source-data") {
      options.sourceDataRoot = path.resolve(argv[++index]);
    } else if (arg === "--clean") {
      options.clean = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      options.command = "help";
    } else {
      throw new Error(`未知参数：${arg}`);
    }
  }
  return options;
}

async function isExecutable(candidate) {
  if (!candidate) return false;
  try {
    await access(candidate, fsConstants.X_OK);
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} 执行失败（${code}）：${stderr.trim() || stdout.trim()}`));
    });
  });
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export async function resolveSeedAccount(sourceDataRoot, explicitAccountId = "") {
  const runtimeRoot = path.join(sourceDataRoot, "openwork-runtime-data");
  if (explicitAccountId) {
    const databasePath = path.join(runtimeRoot, explicitAccountId, "xdg", "data", "opencode", "opencode.db");
    if (await stat(databasePath).then((info) => info.isFile()).catch(() => false)) {
      return explicitAccountId;
    }
    throw new Error(`主实例中找不到账号 ${explicitAccountId} 的会话数据库`);
  }

  const entries = await readdir(runtimeRoot, { withFileTypes: true }).catch(() => []);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const databasePath = path.join(runtimeRoot, entry.name, "xdg", "data", "opencode", "opencode.db");
    const databaseInfo = await stat(databasePath).catch(() => null);
    const walInfo = await stat(`${databasePath}-wal`).catch(() => null);
    if (!databaseInfo?.isFile()) continue;
    candidates.push({
      accountId: entry.name,
      activityMs: Math.max(databaseInfo.mtimeMs, walInfo?.mtimeMs || 0),
      size: databaseInfo.size + (walInfo?.size || 0),
    });
  }
  candidates.sort((left, right) => right.activityMs - left.activityMs || right.size - left.size);
  if (!candidates[0]) throw new Error(`主实例没有可用于初始化的会话数据库：${runtimeRoot}`);
  return candidates[0].accountId;
}

async function copyUserWorkspaceFiles(sourceDataRoot, config) {
  const sourceWorkspace = path.join(sourceDataRoot, "default-workspace");
  const entries = await readdir(sourceWorkspace, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === ".opencode" || entry.name === "opencode.jsonc") continue;
    const source = path.join(sourceWorkspace, entry.name);
    const destination = path.join(config.userDataDir, "default-workspace", entry.name);
    await rm(destination, { recursive: true, force: true });
    await cp(source, destination, { recursive: entry.isDirectory(), force: true });
  }
}

async function seedInstance(config, { sourceDataRoot, accountId }) {
  const sourceAccountRoot = path.join(sourceDataRoot, "openwork-runtime-data", accountId);
  const sourceOpenCodeData = path.join(sourceAccountRoot, "xdg", "data", "opencode");
  const sourceDatabase = path.join(sourceOpenCodeData, "opencode.db");
  const targetOpenCodeData = path.join(
    config.userDataDir,
    "openwork-runtime-data",
    accountId,
    "xdg",
    "data",
    "opencode",
  );
  const targetDatabase = path.join(targetOpenCodeData, "opencode.db");
  const stagedDatabase = `${targetDatabase}.seed`;
  await mkdir(targetOpenCodeData, { recursive: true });
  await rm(stagedDatabase, { force: true });
  const escapedStagedDatabase = stagedDatabase.replaceAll("'", "''");
  await runCommand("sqlite3", [sourceDatabase, `.backup '${escapedStagedDatabase}'`]);
  const sourceWorkspace = path.join(sourceDataRoot, "default-workspace");
  const targetWorkspace = path.join(config.userDataDir, "default-workspace");
  const sourceSessionPath = sourceWorkspace.replace(/^\/+/, "");
  const targetSessionPath = targetWorkspace.replace(/^\/+/, "");
  await runCommand("sqlite3", [stagedDatabase, [
    "begin immediate;",
    `update session set directory = ${sqlString(targetWorkspace)} where directory = ${sqlString(sourceWorkspace)};`,
    `update session set path = ${sqlString(targetSessionPath)} where path = ${sqlString(sourceSessionPath)};`,
    "commit;",
  ].join(" ")]);
  const integrity = String(await runCommand("sqlite3", [stagedDatabase, "pragma quick_check;"])).trim();
  if (integrity !== "ok") throw new Error(`账号 ${accountId} 的会话快照校验失败：${integrity}`);
  await rm(targetDatabase, { force: true });
  await rm(`${targetDatabase}-wal`, { force: true });
  await rm(`${targetDatabase}-shm`, { force: true });
  await rename(stagedDatabase, targetDatabase);

  const sourceToolOutput = path.join(sourceOpenCodeData, "tool-output");
  const targetToolOutput = path.join(targetOpenCodeData, "tool-output");
  await rm(targetToolOutput, { recursive: true, force: true });
  if (await stat(sourceToolOutput).then((info) => info.isDirectory()).catch(() => false)) {
    await cp(sourceToolOutput, targetToolOutput, { recursive: true, force: true });
  }

  const sourceAssets = path.join(sourceDataRoot, "wodeappx-assets", "accounts", accountId);
  const targetAssets = path.join(config.userDataDir, "wodeappx-assets", "accounts", accountId);
  await rm(targetAssets, { recursive: true, force: true });
  if (await stat(sourceAssets).then((info) => info.isDirectory()).catch(() => false)) {
    await mkdir(path.dirname(targetAssets), { recursive: true });
    await cp(sourceAssets, targetAssets, { recursive: true, force: true });
  }

  await copyUserWorkspaceFiles(sourceDataRoot, config);
  return {
    accountId,
    databaseBytes: (await stat(targetDatabase)).size,
    assetsCopied: await stat(targetAssets).then((info) => info.isDirectory()).catch(() => false),
  };
}

async function macExecutableInDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.endsWith(".app")) continue;
    const macOsDir = path.join(directory, entry.name, "Contents", "MacOS");
    const executables = await readdir(macOsDir, { withFileTypes: true }).catch(() => []);
    for (const executable of executables) {
      const candidate = path.join(macOsDir, executable.name);
      if (executable.isFile() && await isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

export async function resolvePackagedExecutable(explicitPath = "") {
  if (explicitPath) {
    if (await isExecutable(explicitPath)) return path.resolve(explicitPath);
    throw new Error(`找不到可执行的 WodeAppX：${explicitPath}`);
  }

  const distRoot = path.join(repoRoot, "vendor", "openwork", "apps", "desktop", "dist-electron");
  const preferredDirectories = process.platform === "darwin"
    ? (process.arch === "arm64" ? ["mac-arm64", "mac"] : ["mac", "mac-x64"])
    : [];
  const entries = await readdir(distRoot, { withFileTypes: true }).catch(() => []);
  const remainingDirectories = entries
    .filter((entry) => entry.isDirectory() && !preferredDirectories.includes(entry.name))
    .map((entry) => entry.name)
    .sort();

  if (process.platform === "darwin") {
    for (const name of [...preferredDirectories, ...remainingDirectories]) {
      const executable = await macExecutableInDirectory(path.join(distRoot, name));
      if (executable) return executable;
    }
  } else {
    for (const name of remainingDirectories) {
      const directory = path.join(distRoot, name);
      const files = await readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const file of files) {
        if (!file.isFile()) continue;
        if (process.platform === "win32" && !file.name.endsWith(".exe")) continue;
        const candidate = path.join(directory, file.name);
        if (await isExecutable(candidate)) return candidate;
      }
    }
  }

  throw new Error("没有找到已打包的 WodeAppX。请先完成 Electron 打包，或用 --app 指定可执行文件。");
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readProcessState(config) {
  try {
    return JSON.parse(await readFile(config.processStatePath, "utf8"));
  } catch {
    return null;
  }
}

async function probeJson(url, timeoutMs = 1_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function readUiControl(config) {
  try {
    return JSON.parse(await readFile(config.uiControlDiscoveryPath, "utf8"));
  } catch {
    return null;
  }
}

async function inspectInstance(config) {
  const processState = await readProcessState(config);
  const pid = Number(processState?.pid);
  const running = processIsAlive(pid);
  const cdp = running
    ? await probeJson(`http://127.0.0.1:${config.cdpPort}/json/version`)
    : null;
  const cdpPages = running
    ? await probeJson(`http://127.0.0.1:${config.cdpPort}/json/list`)
    : null;
  const page = Array.isArray(cdpPages)
    ? cdpPages.find((item) => item?.type === "page")
    : null;
  const uiControl = running ? await readUiControl(config) : null;
  const uiHealth = uiControl?.baseUrl
    ? await probeJson(`${uiControl.baseUrl}/health`)
    : null;
  return {
    id: config.id,
    name: config.name,
    identifier: config.identifier,
    pid: running ? pid : null,
    running,
    ready: Boolean(cdp && uiHealth?.ok),
    cdpPort: config.cdpPort,
    cdpUrl: `http://127.0.0.1:${config.cdpPort}`,
    pageTitle: page?.title || null,
    pageUrl: page?.url || null,
    userDataDir: config.userDataDir,
    logPath: config.logPath,
    uiControlUrl: uiControl?.baseUrl || null,
    uiControlApp: uiHealth?.app || null,
  };
}

async function setInstancePageTitle(config) {
  const pages = await probeJson(`http://127.0.0.1:${config.cdpPort}/json/list`);
  const page = Array.isArray(pages)
    ? pages.find((item) => item?.type === "page" && item?.webSocketDebuggerUrl)
    : null;
  if (!page?.webSocketDebuggerUrl || typeof WebSocket !== "function") return false;

  return new Promise((resolve) => {
    const socket = new WebSocket(page.webSocketDebuggerUrl);
    let settled = false;
    const timeout = setTimeout(() => finish(false), 2_000);
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.close();
      resolve(ok);
    };
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: {
          expression: `document.title = ${JSON.stringify(config.name)}; document.title`,
          returnByValue: true,
        },
      }));
    });
    socket.addEventListener("message", (event) => {
      try {
        const message = JSON.parse(String(event.data));
        if (message.id === 1) finish(message.result?.result?.value === config.name);
      } catch {
        finish(false);
      }
    });
    socket.addEventListener("error", () => finish(false));
  });
}

async function waitForReady(config, waitMs) {
  const deadline = Date.now() + waitMs;
  let result = await inspectInstance(config);
  while (!result.ready && result.running && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    result = await inspectInstance(config);
  }
  return result;
}

async function startInstance(config, executable, options) {
  const existing = await inspectInstance(config);
  if (existing.running) return { ...existing, action: "already-running" };

  if (options.dryRun) {
    return {
      ...existing,
      action: "dry-run",
      executable,
    };
  }

  if (options.clean) {
    await rm(config.instanceRoot, { recursive: true, force: true });
  }
  await mkdir(config.userDataDir, { recursive: true });

  const logFd = openSync(config.logPath, "a");
  const child = spawn(executable, [], {
    detached: true,
    env: {
      ...process.env,
      OPENWORK_E2E_ALLOW_PARALLEL: "0",
      OPENWORK_ELECTRON_APP_NAME: config.name,
      OPENWORK_ELECTRON_APP_IDENTIFIER: config.identifier,
      OPENWORK_ELECTRON_USERDATA: config.userDataDir,
      OPENWORK_ELECTRON_REMOTE_DEBUG_PORT: String(config.cdpPort),
      WODEAPPX_TEST_INSTANCE_ID: String(config.id),
    },
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  closeSync(logFd);

  await writeFile(config.processStatePath, `${JSON.stringify({
    version: 1,
    id: config.id,
    pid: child.pid,
    name: config.name,
    identifier: config.identifier,
    cdpPort: config.cdpPort,
    executable,
    startedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");

  let status = options.waitMs > 0
    ? await waitForReady(config, options.waitMs)
    : await inspectInstance(config);
  if (status.ready) {
    await setInstancePageTitle(config);
    status = await inspectInstance(config);
  }
  return { ...status, action: "started" };
}

async function stopInstance(config, clean) {
  const processState = await readProcessState(config);
  const pid = Number(processState?.pid);
  let action = "not-running";

  if (processIsAlive(pid)) {
    action = "stopped";
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process may have exited between the liveness check and the signal.
    }
    const deadline = Date.now() + 8_000;
    while (processIsAlive(pid) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (processIsAlive(pid)) {
      process.kill(pid, "SIGKILL");
      action = "force-stopped";
    }
  }

  await rm(config.processStatePath, { force: true });
  if (clean) await rm(config.instanceRoot, { recursive: true, force: true });
  return {
    ...(await inspectInstance(config)),
    action: clean ? `${action}-and-cleaned` : action,
  };
}

function printHuman(results) {
  for (const result of results) {
    const state = result.ready ? "ready" : result.running ? "starting" : "stopped";
    const pid = result.pid ? ` pid=${result.pid}` : "";
    console.log(`${result.name}: ${state} (${result.action || "status"})${pid} CDP=${result.cdpPort}`);
    if (result.pageTitle) console.log(`  窗口：${result.pageTitle}`);
    console.log(`  数据：${result.userDataDir}`);
    if (result.uiControlUrl) console.log(`  控制：${result.uiControlUrl}`);
    console.log(`  日志：${result.logPath}`);
  }
}

function printHelp() {
  console.log(`WodeAppX 测试实例清理工具\n\n` +
    `用法：\n` +
    `  node scripts/wodeappx-test-instances.mjs status\n` +
    `  node scripts/wodeappx-test-instances.mjs stop [--clean]\n\n` +
    `测试实例的 start/seed 已全部禁用，请直接使用开发版。\n` +
    `可选：--instances 1  --state-root <目录>  --json\n` +
    `清理旧实例仍可使用：stop --instances 1,2,3 --clean`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "help") {
    printHelp();
    return;
  }
  if (!["start", "seed", "status", "stop"].includes(options.command)) {
    throw new Error(`未知命令：${options.command}`);
  }
  assertTestInstanceLaunchDisabled(options.command);

  const configs = options.instanceIds.map((id) => buildInstanceConfig({
    id,
    stateRoot: options.stateRoot,
  }));

  let results;
  if (options.command === "start") {
    const executable = await resolvePackagedExecutable(options.appPath);
    results = await Promise.all(configs.map((config) => startInstance(config, executable, options)));
  } else if (options.command === "seed") {
    if (!options.sourceDataRoot) throw new Error("seed 需要 --source-data 指定正式主实例数据目录");
    const executable = await resolvePackagedExecutable(options.appPath);
    const accountId = await resolveSeedAccount(options.sourceDataRoot, options.accountId);
    if (options.dryRun) {
      results = await Promise.all(configs.map(async (config) => ({
        ...(await inspectInstance(config)),
        action: "seed-dry-run",
        seed: { accountId, sourceDataRoot: options.sourceDataRoot },
      })));
    } else {
      await Promise.all(configs.map((config) => stopInstance(config, false)));
      const seedResults = [];
      for (const config of configs) {
        seedResults.push(await seedInstance(config, {
          sourceDataRoot: options.sourceDataRoot,
          accountId,
        }));
      }
      const startResults = await Promise.all(configs.map((config) => startInstance(config, executable, options)));
      results = startResults.map((result, index) => ({
        ...result,
        action: "seeded-and-started",
        seed: seedResults[index],
      }));
    }
  } else if (options.command === "stop") {
    results = await Promise.all(configs.map((config) => stopInstance(config, options.clean)));
  } else {
    results = await Promise.all(configs.map((config) => inspectInstance(config)));
  }

  if (options.json) {
    console.log(JSON.stringify({ command: options.command, results }, null, 2));
  } else {
    printHuman(results);
  }

  if (["start", "seed"].includes(options.command) && !options.dryRun && results.some((item) => !item.ready)) {
    process.exitCode = 2;
  }
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error(`[wodeappx-test-instances] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
