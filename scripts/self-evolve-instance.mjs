#!/usr/bin/env node

/**
 * self-evolve-instance.mjs — 自进化候选实例（B 窗口）最小启动器
 *
 * 用法：
 *   node scripts/self-evolve-instance.mjs start [--id 2] [--clean]
 *   node scripts/self-evolve-instance.mjs status [--id 2]
 *   node scripts/self-evolve-instance.mjs stop [--id 2]
 *
 * 设计原则（与文档 §4 Phase 3 一致）：只做**基础默认隔离**，风险告知不强制：
 *   - 默认给候选实例独立的数据目录 / 应用标识 / CDP 端口（干净环境，不影响主窗口）。
 *   - 不限制它连云端、不限制它控制 Chrome——key 与账号体系见设计文档 §2.1/§4，
 *     云端副作用（积分、推送）是否接受由用户自己判断。
 *   - 想改行为？直接改这个脚本（自进化流程适用）。
 */

import { spawn, execFileSync } from "node:child_process";
import { closeSync, existsSync, openSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { resolveSweepRoots, sweepOrphans } from "./self-evolve-sweep.mjs";
import {
  buildCandidateEnv,
  packagedLaunchArgs,
  resolvePackagedBin,
} from "./self-evolve-packaged.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wodeappxRoot = path.resolve(__dirname, "..");
// --root <代码副本路径>：从指定副本（如自进化 worktree）启动，默认主树
let desktopDir = path.join(wodeappxRoot, "vendor", "openwork", "apps", "desktop");
let electronBin = path.join(desktopDir, "node_modules", ".bin", "electron");

function instanceConfig(id) {
  const root = path.join(os.homedir(), ".wodeappx", "instances", `candidate-${id}`);
  return {
    id,
    root,
    userDataDir: path.join(root, "user-data"),
    logPath: path.join(root, "instance.log"),
    pidPath: path.join(root, "pid.json"),
    appName: `WodeAppX 候选 ${id}`,
    identifier: `com.differentai.openwork.candidate.${id}`,
    cdpPort: 9222 + id,
  };
}

function readPid(cfg) {
  try {
    return JSON.parse(readFileSync(cfg.pidPath, "utf8")).pid;
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function currentIterationVersion() {
  // 自进化影子版本库的当前版本，作为候选窗口顶部"迭代 xxxx"标识
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      env: { ...process.env, GIT_DIR: path.join(os.homedir(), ".wodeappx", "self-evolve", "repo.git") },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function officialUserDataPath() {
  return String(
    process.env.WODEAPPX_SELF_EVOLVE_OFFICIAL_USERDATA
      || process.env.OPENWORK_ELECTRON_USERDATA
      || "",
  ).trim();
}

function cmdStart(cfg, flags) {
  const officialUserData = officialUserDataPath();
  const launch = resolvePackagedBin({
    env: process.env,
    userDataPath: officialUserData,
    vendorElectron: electronBin,
  });
  if (!launch.bin) {
    console.error(
      `找不到可启动的 WodeAppX / Electron。安装包请先打开一次官方窗口（会写下 self-evolve-launch.json），或设置 WODEAPPX_PACKAGED_BIN。开发机请先 pnpm install。`,
    );
    process.exit(1);
  }
  const pid = readPid(cfg);
  if (pidAlive(pid)) {
    console.log(`候选实例 ${cfg.id} 已在运行（pid ${pid}，CDP http://127.0.0.1:${cfg.cdpPort}）。`);
    return;
  }
  // 启动前清扫上次运行残留的孤儿进程（实例崩溃/断电后，sidecar 与 Electron
  // helper 可能挂在 PPID 1 下持续占内存）。只清可精确归因的孤儿，规则见
  // self-evolve-sweep.mjs；健康的 detached 主进程不会被误伤。
  const sweep = sweepOrphans(resolveSweepRoots({ desktopDir, electronBin: launch.bin, instanceRoot: cfg.root }));
  if (sweep.targets.length > 0) {
    console.log(`已清扫 ${sweep.targets.length} 个残留孤儿进程：`);
    for (const t of sweep.targets) {
      console.log(`  pid ${t.pid}（${t.reason}）${t.args.slice(0, 100)}`);
    }
  }
  if (flags.has("--clean")) {
    rmSync(cfg.root, { recursive: true, force: true });
  }
  mkdirSync(cfg.userDataDir, { recursive: true });

  const logFd = openSync(cfg.logPath, "a");
  const childEnv = buildCandidateEnv({
    env: process.env,
    cfg,
    version: currentIterationVersion(),
    officialUserData,
    slot: "B",
  });
  childEnv.WODEAPPX_INSTANCE_COLOR = process.env.WODEAPPX_INSTANCE_COLOR || "#f59e0b";
  childEnv.WODEAPPX_DOCK_ICON = existsSync(path.join(os.homedir(), ".wodeappx", "instance-icons", `candidate-${cfg.id}.png`))
    ? path.join(os.homedir(), ".wodeappx", "instance-icons", `candidate-${cfg.id}.png`)
    : "";
  const spawnArgs = launch.kind === "packaged" ? packagedLaunchArgs(process.env) : ["./electron/main.mjs"];
  const child = spawn(launch.bin, spawnArgs, {
    cwd: launch.kind === "vendor" ? desktopDir : path.dirname(launch.bin),
    detached: true,
    env: childEnv,
    stdio: ["ignore", logFd, logFd],
  });
  child.unref();
  closeSync(logFd);
  writeFileSync(cfg.pidPath, JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString(), kind: launch.kind, bin: launch.bin }));

  console.log(`候选实例 ${cfg.id} 已启动：
  pid        ${child.pid}
  数据目录   ${cfg.userDataDir}（独立数据，首次打开是全新环境，需要重新登录）
  CDP        http://127.0.0.1:${cfg.cdpPort}
  日志       ${cfg.logPath}

提示：实例默认与主窗口数据分开；云端账号、积分、推送等副作用是否共用，由你自行判断（设计文档 §4 Phase 3）。`);
}

function cmdStatus(cfg) {
  const pid = readPid(cfg);
  const alive = pidAlive(pid);
  console.log(JSON.stringify({
    id: cfg.id,
    running: alive,
    pid: alive ? pid : null,
    userDataDir: cfg.userDataDir,
    cdp: `http://127.0.0.1:${cfg.cdpPort}`,
    logPath: existsSync(cfg.logPath) ? cfg.logPath : null,
  }, null, 2));
}

function cmdStop(cfg) {
  const pid = readPid(cfg);
  if (!pidAlive(pid)) {
    console.log(`候选实例 ${cfg.id} 未在运行。`);
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
    console.log(`已向候选实例 ${cfg.id}（pid ${pid}）发送退出信号。`);
  } catch (err) {
    console.error(`停止失败：${err.message}`);
    process.exit(1);
  }
}

// ------------------------------------------------------------------- main
const INSTANCES_ROOT = path.join(os.homedir(), ".wodeappx", "instances");

/** 扫描所有候选实例及其存活状态。 */
function listInstances() {
  if (!existsSync(INSTANCES_ROOT)) return [];
  const out = [];
  for (const name of readdirSync(INSTANCES_ROOT)) {
    const m = /^candidate-(\d+)$/.exec(name);
    if (!m) continue;
    const cfg = instanceConfig(Number(m[1]));
    const pid = readPid(cfg);
    out.push({ id: cfg.id, pid, alive: pidAlive(pid) });
  }
  return out.sort((a, b) => a.id - b.id);
}

/** 自动分配空闲实例号：每个自进化会话各占一个，避免互相杀进程。 */
function findFreeInstanceId() {
  const used = new Set(listInstances().map((i) => i.id));
  let id = 2;
  while (used.has(id)) id += 1;
  return id;
}

const [, , command, ...rest] = process.argv;
const flags = new Set(rest.filter((a) => a.startsWith("--") && a !== "--id" && a !== "--root"));
const idIdx = rest.indexOf("--id");
const explicitId = idIdx >= 0 ? Number(rest[idIdx + 1]) || null : null;
// --root <代码副本路径>：从自进化 worktree 等副本启动（二进制与 cwd 都走副本）
const rootIdx = rest.indexOf("--root");
if (rootIdx >= 0 && rest[rootIdx + 1]) {
  const codeRoot = path.resolve(rest[rootIdx + 1]);
  desktopDir = path.join(codeRoot, "vendor", "openwork", "apps", "desktop");
  electronBin = path.join(desktopDir, "node_modules", ".bin", "electron");
}
// 不指定 --id 时自动分配空闲编号（status 除外：不带 --id 列出全部实例）
const id = explicitId ?? (command === "start" ? findFreeInstanceId() : 2);
const cfg = instanceConfig(id);

switch (command) {
  case "start":
    if (explicitId == null) {
      console.log(`未指定 --id，自动分配空闲实例号 ${id}（各会话各占一个实例，互不干扰）。`);
    }
    cmdStart(cfg, flags);
    break;
  case "status":
    if (explicitId == null) {
      const all = listInstances();
      if (all.length === 0) {
        console.log("当前没有任何候选实例。");
        break;
      }
      console.log("所有候选实例：");
      for (const i of all) {
        console.log(`  候选 ${i.id}：${i.alive ? `运行中（pid ${i.pid}，CDP http://127.0.0.1:${9222 + i.id}）` : "已停止"}`);
      }
      console.log("\n提示：每个自进化对话固定使用一个实例号（start 不指定 --id 会自动分配空闲号）。");
      break;
    }
    cmdStatus(cfg);
    break;
  case "stop":
    cmdStop(cfg);
    break;
  case "sweep": {
    // 手动清扫孤儿进程（start 已自动执行；这里用于排查）。--dry-run 只列出目标不杀。
    const dryRun = flags.has("--dry-run");
    const roots = resolveSweepRoots({ desktopDir, electronBin, instanceRoot: explicitId == null ? null : cfg.root });
    const result = sweepOrphans(roots, { dryRun });
    console.log(`扫描 ${result.scanned} 个进程，命中 ${result.targets.length} 个孤儿${dryRun ? "（dry-run，未执行清理）" : "，已发送退出信号"}：`);
    for (const t of result.targets) {
      console.log(`  pid ${t.pid}（${t.reason}）${t.args.slice(0, 120)}`);
    }
    break;
  }
  default:
    console.log(`用法：
  node scripts/self-evolve-instance.mjs start [--id 2] [--clean] [--root <代码副本路径>]   # 不指定 --id 自动分配空闲号
  node scripts/self-evolve-instance.mjs status [--id 2]            # 不指定 --id 列出全部实例
  node scripts/self-evolve-instance.mjs stop [--id 2]
  node scripts/self-evolve-instance.mjs sweep [--id 2] [--dry-run] # 手动清扫孤儿进程`);
    process.exit(command ? 2 : 0);
}
