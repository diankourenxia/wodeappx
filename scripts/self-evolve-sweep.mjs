#!/usr/bin/env node
/**
 * self-evolve-sweep.mjs — 候选实例启动前的孤儿进程清扫（纯逻辑，可单测）。
 *
 * 背景：实例崩溃 / 断电后，sidecar、Electron helper 等子进程可能被遗留并挂到
 * PPID 1 下，长期累积占用内存。启动新实例前按"可精确归因"的规则清扫。
 *
 * 安全规则（缺一不可误杀）：
 *   1. 只清 PPID === 1 的孤儿——健康实例的子进程都有活着的父进程；
 *   2. Electron 只清 helper（路径含 .app/Contents/Frameworks/），主进程不清——
 *      候选实例以 detached 方式启动，主进程 PPID 合法地为 1；
 *   3. 路径匹配必须是真实路径前缀（realpath），不做模糊的名称匹配；
 *   4. 永不杀调用方自身 pid。
 */

import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

/** 解析 `ps -eo pid=,ppid=,args=` 输出。 */
export function parsePs(output) {
  const procs = [];
  for (const line of String(output).split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S.*)$/.exec(line);
    if (!m) continue;
    procs.push({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] });
  }
  return procs;
}

/**
 * 从进程列表中挑出可安全清扫的孤儿。
 * roots: { sidecarsDir, electronDistDir, instanceRoot }（均可为 null 跳过该类）
 * 返回 [{ pid, ppid, args, reason }]，reason ∈ sidecar | electron-helper | instance-leftover
 */
export function selectSweepTargets(procs, roots, selfPid = process.pid) {
  const { sidecarsDir, electronDistDir, instanceRoot } = roots || {};
  const targets = [];
  for (const p of procs) {
    if (!p || p.ppid !== 1) continue; // 只清孤儿
    if (p.pid === selfPid) continue; // 永不杀自己
    let reason = null;
    if (sidecarsDir && p.args.startsWith(sidecarsDir + path.sep)) {
      reason = "sidecar";
    } else if (
      electronDistDir
      && p.args.startsWith(electronDistDir + path.sep)
      && p.args.includes(".app/Contents/Frameworks/")
    ) {
      // 渲染 / GPU 等 helper。主进程可执行文件不在 Frameworks 下，不会被匹配。
      reason = "electron-helper";
    } else if (instanceRoot && p.args.includes(instanceRoot)) {
      reason = "instance-leftover";
    }
    if (reason) targets.push({ ...p, reason });
  }
  return targets;
}

/** 由 launcher 路径推导清扫根（全部 realpath，失败项为 null 即跳过该类）。 */
export function resolveSweepRoots({ desktopDir, electronBin, instanceRoot }) {
  const roots = {
    sidecarsDir: null,
    electronDistDir: null,
    instanceRoot: instanceRoot ? path.resolve(instanceRoot) : null,
  };
  try {
    roots.sidecarsDir = realpathSync(path.join(desktopDir, "resources", "sidecars"));
  } catch { /* sidecars 目录不存在则跳过 */ }
  try {
    // .bin/electron 符号链接 → .../dist/<App>.app/Contents/MacOS/<App>，上三级即 dist 目录
    const realElectron = realpathSync(electronBin);
    roots.electronDistDir = path.dirname(path.dirname(path.dirname(realElectron)));
  } catch { /* electron 未安装则跳过 */ }
  return roots;
}

/**
 * 执行清扫：ps 扫描 → 规则筛选 → SIGTERM。
 * dryRun: 只返回目标不杀。返回 { scanned, targets }。
 */
export function sweepOrphans(roots, { dryRun = false } = {}) {
  const out = execFileSync("ps", ["-eo", "pid=,ppid=,args="], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  const procs = parsePs(out);
  const targets = selectSweepTargets(procs, roots);
  const done = [];
  for (const t of targets) {
    if (!dryRun) {
      try {
        process.kill(t.pid, "SIGTERM");
      } catch { /* 已退出或无权限，忽略 */ }
    }
    done.push(dryRun ? { ...t, dryRun: true } : t);
  }
  return { scanned: procs.length, targets: done };
}
