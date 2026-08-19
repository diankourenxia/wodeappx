#!/usr/bin/env node

/**
 * self-evolve-guard.mjs — WodeAppX 自进化 M1 安全底线
 *
 * 子命令：
 *   snapshot --label "<本次改动说明>"   改动前打快照（不动工作区，非破坏性）
 *   verify [--skip-typecheck] [--skip-patch-test] [--skip-skin-contrast]   改动后验证门禁
 *   rollback <snapshot-id> [--dry-run]  验证失败/用户要求时回滚到快照状态
 *   status                              列出所有快照
 *   version commit --label "<说明>"     验证通过且用户确认生效后，提交一个命名版本
 *   version log [--limit N]             查看版本历史
 *   version restore <commit> [--force]  回退到历史版本（追加式提交，不改写历史）
 *
 * 版本管理（version *）：使用独立影子仓库 ~/.wodeappx/self-evolve/repo.git
 * （GIT_WORK_TREE=wodeappx 根目录），与外层业务仓库完全隔离，且能把被
 * 外层 gitignore 的 vendor/openwork 源码纳入版本。不引入 Gitea 等服务端依赖。
 * 打包解包树故意不含 .git：snapshot/rollback 在本机对该工作树 `git init`
 * 做本地仓库（不写进 .app、不连远程）；packaged 路径的 version 库与开发机
 * 主影子库隔离，避免解包树写进 ~/.wodeappx/self-evolve/repo.git。
 *
 * 快照原理（不触碰工作区）：
 *   - `git stash create` 生成一个仅存在于 .git 对象库里的 stash 提交，
 *     其 tree = 快照时刻的已跟踪文件工作区状态（含用户已有的未提交改动）。
 *   - 同时记录当时的 untracked 文件清单。
 *   - 额外：wodeappx/vendor/openwork/ 等**被 gitignore 但会被自进化修改的源码树**
 *     （PROTECTED_IGNORED_ROOTS，可用 --protect 追加）做文件级 sha1 清单 + 内容备份，
 *     存放在 .git/self-evolve/<id>-files/。
 * 回滚原理：
 *   1. `git reset --hard <快照时HEAD>` 清掉快照后产生的一切已跟踪改动；
 *   2. `git checkout <stashCommit> -- .` 把用户快照前已有的改动恢复回来；
 *   3. 删除"快照时不存在、快照后才出现"的 untracked 文件（Agent 新建的文件），
 *      绝不删除快照清单里的既有 untracked 文件；
 *   4. 受保护的 ignored 源码树：hash 不一致/丢失的文件从备份恢复，
 *      清单之外的新文件删除。
 *
 * 注意：本脚本属于自进化"保护清单"，Agent 修改本文件必须先获得用户确认。
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wodeappxRoot = path.resolve(__dirname, "..");

/**
 * Isolated fixture hook for loop tests. Never point this at the real checkout
 * unless you intend to snapshot/rollback that tree.
 *   WODEAPPX_SELF_EVOLVE_WORKTREE  = fixture wodeappx/ or monorepo root
 *   WODEAPPX_SELF_EVOLVE_GIT_DIR   = fixture bare version repo
 */
export function runtimeWodeappxRoot() {
  const override = String(process.env.WODEAPPX_SELF_EVOLVE_WORKTREE || "").trim();
  if (!override) return wodeappxRoot;
  const start = path.resolve(override);
  if (existsSync(path.join(start, "wodeappx", "package.json"))) {
    return path.join(start, "wodeappx");
  }
  return start;
}

/**
 * 自进化版本管理：独立影子仓库（bare repo + GIT_WORK_TREE=wodeappx 根）。
 * 选本地 git 而不是内置 Gitea：git 本身就是完整版本系统，桌面端单用户场景
 * 不需要常驻服务端进程；Gitea 可作为后期可选 remote（多机同步 / Web 审阅）。
 */
function resolveVersionRepo() {
  const fromEnv = String(process.env.WODEAPPX_SELF_EVOLVE_GIT_DIR || "").trim();
  if (fromEnv) return fromEnv;
  const worktree = String(process.env.WODEAPPX_SELF_EVOLVE_WORKTREE || "").trim();
  if (worktree) {
    return path.join(path.resolve(worktree), ".self-evolve-version.git");
  }
  const home = os.homedir();
  const root = runtimeWodeappxRoot();
  if (root.split(path.sep).includes("self-evolve-source")) {
    const key = createHash("sha1").update(path.resolve(root)).digest("hex").slice(0, 12);
    return path.join(home, ".wodeappx", "self-evolve", "packaged", key, "repo.git");
  }
  return path.join(home, ".wodeappx", "self-evolve", "repo.git");
}

function versionRepoDir() {
  return resolveVersionRepo();
}

/** 纳入版本管理的 wodeappx 相对路径（源码级，避开二进制与构建产物） */
const VERSION_INCLUDE = Object.freeze([
  "branding",
  "docs",
  "integrations",
  "native",
  "packages",
  "scripts",
  "vendor/openwork",
  "package.json",
  "pnpm-workspace.yaml",
  "openwork.lock.json",
  "README.md",
  ".gitignore-standalone",
  "LICENSE",
  "NOTICE",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
]);

/** pathspec 排除（glob）：体积大户与派生产物 */
const VERSION_EXCLUDE = Object.freeze([
  "**/node_modules/**",
  "**/dist/**",
  "**/dist-electron*/**",
  "**/out/**",
  "**/.turbo/**",
  "**/.git/**",
  "**/coverage/**",
  "**/target/**",
  "**/.build/**",
  "**/*.log",
  "vendor/openwork/apps/desktop/resources/**",
  "vendor/openwork/evals/results/**",
  "apps/desktop/resources/**",
  "apps/desktop/dist-electron*/**",
]);

/**
 * 被 gitignore 但属于自进化高频改动目标的源码树（相对于仓库根）。
 * 备份体积可控（源码级，不含 node_modules / 构建产物）。
 * 改动其他 ignored 区域时，用 --protect <相对路径> 追加。
 */
const PROTECTED_IGNORED_ROOTS = Object.freeze([
  "wodeappx/vendor/openwork/apps/app/src",
  "wodeappx/vendor/openwork/apps/desktop/src",
  "wodeappx/vendor/openwork/apps/desktop/electron",
  "wodeappx/vendor/openwork/apps/server/src",
  "wodeappx/vendor/openwork/apps/orchestrator/src",
  "wodeappx/vendor/openwork/apps/opencode-router/src",
  "wodeappx/vendor/openwork/.opencode",
  "wodeappx/vendor/openwork/patches",
]);
const PROTECTED_EXCLUDE_DIRS = new Set(["node_modules", ".git", "dist", "out", ".turbo", "coverage"]);

function gitEnv(extra = {}) {
  // 防御：调用方环境可能残留 GIT_DIR/GIT_WORK_TREE（如刚从影子库操作完的 shell
  // 启动了候选实例），会污染本函数的 cwd 仓库定位，必须剥掉。
  const env = { ...process.env, ...extra };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  env.GIT_CONFIG_COUNT = "1";
  env.GIT_CONFIG_KEY_0 = "commit.gpgsign";
  env.GIT_CONFIG_VALUE_0 = "false";
  return env;
}

function git(args, opts = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
    env: gitEnv(opts.env || {}),
  });
}

/** Packaged extract is a filtered monorepo (`…/wodeapp/wodeappx`); dogfood is the outer clone. */
export function findMonorepoRoot(fromWodeappx = wodeappxRoot) {
  const override = String(process.env.WODEAPPX_SELF_EVOLVE_WORKTREE || "").trim();
  const start = path.resolve(override || fromWodeappx);
  if (
    existsSync(path.join(start, "wodeappx"))
    && (existsSync(path.join(start, "AGENTS.md")) || existsSync(path.join(start, "package.json")))
  ) {
    return start;
  }
  const parent = path.dirname(start);
  if (
    existsSync(path.join(parent, "wodeappx"))
    && (existsSync(path.join(parent, "AGENTS.md")) || existsSync(path.join(parent, "package.json")))
  ) {
    return parent;
  }
  return start;
}

/**
 * Installer tarball strips `.git`. Snapshot/rollback still need a working-tree
 * git on disk (local only, no remote). Seed once under the extract root.
 */
export function ensureWorkingTreeGit(root) {
  const resolved = path.resolve(root);
  if (existsSync(path.join(resolved, ".git"))) return { inited: false, root: resolved };
  git(["init"], { cwd: resolved, stdio: "pipe" });
  git(["config", "user.name", "wodeappx-self-evolve"], { cwd: resolved, stdio: "pipe" });
  git(["config", "user.email", "self-evolve@wodeappx.local"], { cwd: resolved, stdio: "pipe" });
  git(["add", "-A"], { cwd: resolved, stdio: "pipe" });
  git(["commit", "-m", "self-evolve: seed local working tree", "--allow-empty"], {
    cwd: resolved,
    stdio: "pipe",
  });
  return { inited: true, root: resolved };
}

function gitRoot() {
  const root = findMonorepoRoot();
  try {
    return git(["rev-parse", "--show-toplevel"], { cwd: root }).trim();
  } catch {
    ensureWorkingTreeGit(root);
    return git(["rev-parse", "--show-toplevel"], { cwd: root }).trim();
  }
}

function stateDir(root) {
  // 兼容 git worktree（.git 是文件而非目录）：统一存到主仓库 common git dir。
  // 必须带 cwd=root，否则 node --test 从真实 wodeappx/ 跑夹具时会写进本仓 .git。
  try {
    const common = git(["rev-parse", "--git-common-dir"], { cwd: root }).trim();
    return path.join(path.resolve(root, common), "self-evolve");
  } catch {
    return path.join(root, ".git", "self-evolve");
  }
}

// ------------------------------------------- 会话登记（礼貌回滚用，非锁）
// 设计上不加锁：多个会话可自由改代码；回滚只跳过"可能被别人动过"的文件并警告，
// 绝不静默覆盖他人改动。会话靠心跳登记，TTL 到期自动失效，不会卡死。
const SESSION_TTL_MS = 45 * 60 * 1000;

function sessionsDir(root) {
  return path.join(stateDir(root), "sessions");
}

function sessionRegister(root, id) {
  mkdirSync(sessionsDir(root), { recursive: true });
  writeFileSync(path.join(sessionsDir(root), `${id}.json`), JSON.stringify({
    id, beganAt: Date.now(), heartbeat: Date.now(),
  }));
}

function sessionHeartbeat(root, id) {
  const file = path.join(sessionsDir(root), `${id}.json`);
  if (!existsSync(file)) return;
  try {
    const s = JSON.parse(readFileSync(file, "utf8"));
    s.heartbeat = Date.now();
    writeFileSync(file, JSON.stringify(s));
  } catch { /* 忽略 */ }
}

function sessionEnd(root, id) {
  rmSync(path.join(sessionsDir(root), `${id}.json`), { force: true });
}

/** 其他仍活跃的自进化会话（心跳未过期），顺手清理过期登记。 */
function otherActiveSessions(root, selfId) {
  const dir = sessionsDir(root);
  if (!existsSync(dir)) return [];
  const now = Date.now();
  const out = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    const file = path.join(dir, name);
    try {
      const s = JSON.parse(readFileSync(file, "utf8"));
      if (s.id === selfId) continue;
      if (now - (s.heartbeat || 0) > SESSION_TTL_MS) {
        rmSync(file, { force: true });
        continue;
      }
      out.push(s);
    } catch { /* 忽略 */ }
  }
  return out.sort((a, b) => a.beganAt - b.beganAt);
}

/** 文件修改时间落在其他活跃会话开始之后 = 可能是别人改的，回滚应跳过。 */
function possiblyForeign(fileAbs, others) {
  if (others.length === 0) return false;
  let mtime;
  try {
    mtime = statSync(fileAbs).mtimeMs;
  } catch {
    return false; // 文件不存在（丢失待补回）：不涉及覆盖他人，允许恢复
  }
  return others.some((s) => mtime >= s.beganAt);
}

function listUntracked(root) {
  const out = git(["ls-files", "--others", "--exclude-standard", "-z"], { cwd: root });
  return out.split("\0").filter(Boolean).sort();
}

function porcelain(root) {
  return git(["status", "--porcelain"], { cwd: root })
    .split("\n")
    .filter(Boolean);
}

function nowId() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ------------------------------------------- protected ignored trees
function walkFiles(rootAbs) {
  const out = [];
  const stack = [rootAbs];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!PROTECTED_EXCLUDE_DIRS.has(e.name)) stack.push(abs);
      } else if (e.isFile()) {
        out.push(abs);
      }
    }
  }
  return out.sort();
}

function sha1File(abs) {
  return createHash("sha1").update(readFileSync(abs)).digest("hex");
}

/** 受保护根的实际路径：清单相对外层仓库根书写（wodeappx/...），
 *  在 wodeappx 根或 worktree 根下运行时自动去掉前缀。 */
function resolveProtectedAbs(root, rel) {
  const direct = path.join(root, rel);
  if (existsSync(direct)) return direct;
  const stripped = path.join(root, rel.replace(/^wodeappx\//, ""));
  if (existsSync(stripped)) return stripped;
  return direct;
}

/** 对受保护的 ignored 源码树建 sha1 清单并备份内容。返回 manifest。 */
function backupProtectedRoots(root, id, extraRoots) {
  const roots = [...new Set([...PROTECTED_IGNORED_ROOTS, ...extraRoots])];
  const manifest = {};
  for (const rel of roots) {
    const abs = resolveProtectedAbs(root, rel);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) continue;
    const backupDir = path.join(stateDir(root), `${id}-files`, rel);
    const files = {};
    for (const fileAbs of walkFiles(abs)) {
      const fileRel = path.relative(abs, fileAbs);
      files[fileRel] = sha1File(fileAbs);
      const dest = path.join(backupDir, fileRel);
      mkdirSync(path.dirname(dest), { recursive: true });
      copyFileSync(fileAbs, dest);
    }
    manifest[rel] = files;
  }
  return manifest;
}

/** 按 manifest 恢复受保护树：改动的恢复、丢失的补回、新增的删除。
 *  others 非空时开启礼貌模式：可能被别人动过的文件跳过恢复/删除并计入警告。 */
function restoreProtectedRoots(root, id, manifest, others = []) {
  const report = { restored: [], deleted: [], skipped: [], roots: 0 };
  for (const [rel, files] of Object.entries(manifest || {})) {
    report.roots += 1;
    const abs = resolveProtectedAbs(root, rel);
    const backupDir = path.join(stateDir(root), `${id}-files`, rel);
    const expected = new Map(Object.entries(files));

    // 恢复改动 / 丢失的文件
    for (const [fileRel, hash] of expected) {
      const fileAbs = path.join(abs, fileRel);
      const current = existsSync(fileAbs) ? sha1File(fileAbs) : null;
      if (current !== hash) {
        if (possiblyForeign(fileAbs, others)) {
          report.skipped.push(`${rel}/${fileRel}`);
          continue;
        }
        const src = path.join(backupDir, fileRel);
        if (!existsSync(src)) {
          console.warn(`  警告：备份缺失 ${rel}/${fileRel}，无法恢复`);
          continue;
        }
        mkdirSync(path.dirname(fileAbs), { recursive: true });
        copyFileSync(src, fileAbs);
        report.restored.push(`${rel}/${fileRel}`);
      }
    }

    // 删除快照后新建的文件
    if (existsSync(abs)) {
      for (const fileAbs of walkFiles(abs)) {
        const fileRel = path.relative(abs, fileAbs);
        if (!expected.has(fileRel)) {
          if (possiblyForeign(fileAbs, others)) {
            report.skipped.push(`${rel}/${fileRel}（新建）`);
            continue;
          }
          rmSync(fileAbs, { force: true });
          report.deleted.push(`${rel}/${fileRel}`);
        }
      }
      // 清理空目录（自底向上）
      const dirs = [];
      const stack = [abs];
      while (stack.length > 0) {
        const d = stack.pop();
        for (const e of readdirSync(d, { withFileTypes: true })) {
          if (e.isDirectory() && !PROTECTED_EXCLUDE_DIRS.has(e.name)) {
            const sub = path.join(d, e.name);
            dirs.push(sub);
            stack.push(sub);
          }
        }
      }
      for (const d of dirs.sort((a, b) => b.length - a.length)) {
        try { rmdirSync(d); } catch { /* 非空，跳过 */ }
      }
    }
  }
  return report;
}

// ---------------------------------------------------------------- snapshot
function cmdSnapshot(label, extraRoots) {
  const root = gitRoot();
  const id = nowId();
  sessionRegister(root, id);
  const head = git(["rev-parse", "HEAD"], { cwd: root }).trim();
  // stash create: 只建对象，不动工作区 / stash 列表；无已跟踪改动时输出为空
  const stashCommit = git(
    ["stash", "create", `self-evolve/${id} ${label || ""}`.trim()],
    { cwd: root },
  ).trim();
  const untracked = listUntracked(root);
  const dirty = porcelain(root);
  // 快照前已被删除（相对 HEAD）的已跟踪文件：stash 树里没有它们，回滚时需重新删除
  const preDeleted = git(["diff", "--name-only", "--diff-filter=D", "HEAD"], { cwd: root })
    .split("\n").filter(Boolean);
  const protectedManifest = backupProtectedRoots(root, id, extraRoots);
  const protectedFileCount = Object.values(protectedManifest)
    .reduce((n, files) => n + Object.keys(files).length, 0);

  const dir = stateDir(root);
  mkdirSync(dir, { recursive: true });
  const state = {
    id,
    label: label || "",
    createdAt: new Date().toISOString(),
    head,
    stashCommit: stashCommit || null,
    preExistingDirty: dirty,
    preExistingDeleted: preDeleted,
    untracked,
    protectedManifest,
  };
  writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(state, null, 2));

  console.log(JSON.stringify({
    ok: true,
    snapshotId: id,
    sessionId: id,
    head: head.slice(0, 12),
    trackedChangesCaptured: Boolean(stashCommit),
    preExistingDirtyCount: dirty.length,
    untrackedCount: untracked.length,
    protectedRoots: Object.keys(protectedManifest).length,
    protectedFileCount,
    note: dirty.length > 0
      ? "检测到快照前已存在的未提交改动，已一并纳入快照保护，回滚时会恢复。"
      : "工作区干净，快照仅记录 HEAD。",
  }, null, 2));
}

// ----------------------------------------------------------------- verify
function runStep(name, command, args, cwd) {
  console.log(`\n=== [verify] ${name} ===`);
  console.log(`$ ${command} ${args.join(" ")}  (cwd: ${cwd})`);
  const res = spawnSync(command, args, { cwd, stdio: "inherit" });
  const ok = res.status === 0;
  console.log(`=== [verify] ${name}: ${ok ? "PASS" : "FAIL"} ===`);
  return { name, ok };
}

function cmdVerify(flags) {
  const steps = [];
  if (!flags.has("--skip-typecheck")) {
    steps.push(() => runStep(
      "typecheck (@openwork/app)",
      "pnpm", ["typecheck"],
      path.join(wodeappxRoot, "vendor", "openwork"),
    ));
  }
  if (!flags.has("--skip-patch-test")) {
    steps.push(() => runStep(
      "openwork patch unit tests",
      "pnpm", ["openwork:patch:test"],
      wodeappxRoot,
    ));
  }
  if (!flags.has("--skip-skin-contrast")) {
    steps.push(() => runStep(
      "skin contrast WCAG AA (static)",
      "node", ["scripts/check-skin-contrast.mjs"],
      wodeappxRoot,
    ));
    steps.push(() => runStep(
      "skin contrast WCAG AA (live if CDP up)",
      "node", ["scripts/check-skin-contrast-live.mjs", "--screenshot"],
      wodeappxRoot,
    ));
  }
  if (steps.length === 0) {
    console.log("verify: 所有步骤均被跳过，无事可做。");
    process.exit(2);
  }
  const results = steps.map((fn) => fn());
  const failed = results.filter((r) => !r.ok);
  console.log("\n=== [verify] 汇总 ===");
  for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
  if (failed.length > 0) {
    console.log(`\nverify FAILED (${failed.length} 步未过)。应执行回滚：node scripts/self-evolve-guard.mjs rollback <snapshot-id>`);
    process.exit(1);
  }
  console.log("\nverify OK。可以向用户报告并请求'生效'确认。");
}

// --------------------------------------------------------------- rollback
function loadState(root, id) {
  const file = path.join(stateDir(root), `${id}.json`);
  if (!existsSync(file)) {
    throw new Error(`找不到快照 ${id}（${file}）。用 status 子命令查看可用快照。`);
  }
  return JSON.parse(readFileSync(file, "utf8"));
}

function cmdRollback(id, flags) {
  const root = gitRoot();
  const dryRun = flags.has("--dry-run");
  const force = flags.has("--force");
  const state = loadState(root, id);
  sessionHeartbeat(root, state.id);

  // 礼貌回滚：存在其他活跃自进化会话时，可能被别人动过的文件只警告不覆盖。
  // 不加锁、不阻止任何人改代码；--force 可关闭礼貌模式（人工确认后）。
  const others = force ? [] : otherActiveSessions(root, state.id);
  if (others.length > 0) {
    console.log(`礼貌模式：检测到 ${others.length} 个其他活跃自进化会话（${others.map((s) => s.id).join("、")}）。`);
    console.log("  修改时间落在这些会话开始之后的文件将被跳过（不覆盖、不删除），只恢复确定属于本快照的改动。");
  }
  // 共享工作区防护：快照后 HEAD 移动过 = 有人提交了 / rebase 过，
  // reset --hard 会丢失这些提交引入的状态，必须人工确认（--force）。
  const currentHead = git(["rev-parse", "HEAD"], { cwd: root }).trim();
  if (currentHead !== state.head && !force) {
    console.error(`拒绝回滚：快照后 HEAD 已移动（${state.head.slice(0, 12)} -> ${currentHead.slice(0, 12)}）。`);
    console.error("说明快照后有人提交了新的 commit，直接回滚可能丢失他人工作。");
    console.error("请先人工核对 git log，确认无误后加 --force 重试。");
    process.exit(1);
  }

  const currentUntracked = listUntracked(root);
  const preSet = new Set(state.untracked || []);
  const toDelete = currentUntracked.filter((f) => !preSet.has(f));

  // 快照后新出现的已跟踪改动（正常=本次自进化改动；共享工作区也可能混入他人改动）
  const preDirtySet = new Set((state.preExistingDirty || []).map((l) => l.slice(3)));
  const postSnapshotTracked = porcelain(root)
    .filter((l) => !l.startsWith("??") && !preDirtySet.has(l.slice(3)))
    .map((l) => l.slice(3));

  console.log(`回滚到快照 ${state.id}${state.label ? `（${state.label}）` : ""}`);
  console.log(`  HEAD -> ${state.head.slice(0, 12)}`);
  console.log(`  将删除快照后新建的 untracked 文件 ${toDelete.length} 个：`);
  for (const f of toDelete) console.log(`    - ${f}`);
  console.log(`  将恢复快照前已有的未提交改动 ${state.preExistingDirty.length} 项（不逐项列出）`);
  if (postSnapshotTracked.length > 0) {
    console.log(`  注意：以下 ${postSnapshotTracked.length} 个已跟踪文件的改动将被丢弃（正常应全部是本次自进化改动；若混入他人未提交改动，请先人工核对）：`);
    for (const f of postSnapshotTracked.slice(0, 20)) console.log(`    - ${f}`);
  }

  if (dryRun) {
    console.log("\n[dry-run] 未执行任何修改。");
    return;
  }

  // 1. 清掉快照后的一切已跟踪改动（含 Agent 改的 + 用户快照前的，下一步恢复用户的）
  execFileSync("git", ["reset", "--hard", state.head], { cwd: root, stdio: "inherit" });

  // 2. 恢复快照前用户已有的已跟踪改动
  if (state.stashCommit) {
    execFileSync("git", ["checkout", state.stashCommit, "--", "."], { cwd: root, stdio: "inherit" });
  }

  // 2b. 快照前已被删除的文件，reset --hard 会把它们带回 HEAD 状态，需重新删除
  for (const f of state.preExistingDeleted || []) {
    try {
      rmSync(path.join(root, f), { force: true });
    } catch (err) {
      console.warn(`  警告：重新删除 ${f} 失败：${err.message}`);
    }
  }

  // 3. 恢复受保护的 ignored 源码树（git 管不到的区域，如 vendor/openwork 源码）
  if (state.protectedManifest && Object.keys(state.protectedManifest).length > 0) {
    const rep = restoreProtectedRoots(root, state.id, state.protectedManifest, others);
    console.log(`\n受保护源码树：恢复 ${rep.restored.length} 个文件，删除新建文件 ${rep.deleted.length} 个（覆盖 ${rep.roots} 个根）`);
    for (const f of rep.restored.slice(0, 10)) console.log(`  恢复 ${f}`);
    for (const f of rep.deleted.slice(0, 10)) console.log(`  删除 ${f}`);
    if (rep.skipped.length > 0) {
      console.log(`\n  礼貌跳过 ${rep.skipped.length} 个可能被其他会话修改的文件（未覆盖、未删除）：`);
      for (const f of rep.skipped.slice(0, 20)) console.log(`    - ${f}`);
      console.log("  这些文件保持现状。确认无他人工作后可用 --force 重新回滚，或人工核对差异。");
    }
  }

  // 3. 删除快照后新建的 untracked 文件，并清理因此产生的空目录
  const removedDirs = new Set();
  for (const f of toDelete) {
    const abs = path.join(root, f);
    try {
      rmSync(abs, { force: true });
      let dir = path.dirname(abs);
      while (dir !== root && !removedDirs.has(dir)) {
        try {
          rmdirSync(dir); // 仅当目录为空时成功
          removedDirs.add(dir);
          dir = path.dirname(dir);
        } catch {
          break;
        }
      }
    } catch (err) {
      console.warn(`  警告：删除 ${f} 失败：${err.message}`);
    }
  }

  const after = porcelain(root);
  console.log("\n回滚完成。当前未提交改动：");
  for (const line of after) console.log(`  ${line}`);
  console.log(after.length === state.preExistingDirty.length
    ? "\n校验通过：已恢复到快照前状态。"
    : `\n提示：改动项数（${after.length}）与快照前（${state.preExistingDirty.length}）不一致，请人工核对 git status。`);
  // 回滚是本快照工作周期的终点：注销自己的会话，避免残留登记误伤后续会话的回滚
  sessionEnd(root, state.id);
}

// ------------------------------------------------- version（影子仓库版本管理）
function vgit(args, opts = {}) {
  const root = runtimeWodeappxRoot();
  return execFileSync("git", args, {
    cwd: root,
    env: { ...process.env, GIT_DIR: versionRepoDir(), GIT_WORK_TREE: root },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
}

export function versionPathspecs(root = runtimeWodeappxRoot()) {
  // OSS extract omits native/ and vendor/openwork; `git add -f -- native` fatals.
  const present = VERSION_INCLUDE.filter((rel) => existsSync(path.join(root, rel)));
  return [...present, ...VERSION_EXCLUDE.map((e) => `:(exclude,glob)${e}`)];
}

function ensureVersionRepo() {
  const repo = versionRepoDir();
  if (existsSync(repo)) return;
  mkdirSync(path.dirname(repo), { recursive: true });
  execFileSync("git", ["init", "--bare", repo], { stdio: "pipe" });
  const env = { ...process.env, GIT_DIR: repo };
  execFileSync("git", ["config", "user.name", "wodeappx-self-evolve"], { env });
  execFileSync("git", ["config", "user.email", "self-evolve@wodeappx.local"], { env });
  console.log(`已初始化自进化版本库：${repo}`);
}

function versionHasCommits() {
  try {
    vgit(["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

function overlayDestDirs() {
  const fromEnv = String(process.env.WODEAPPX_SELF_EVOLVE_OVERLAY || "").trim();
  if (fromEnv) return [path.resolve(fromEnv)];
  const worktree = String(process.env.WODEAPPX_SELF_EVOLVE_WORKTREE || "").trim();
  if (worktree) return [path.join(path.resolve(worktree), ".self-evolve-overlay")];
  const dirs = [path.join(os.homedir(), ".wodeappx", "self-evolve", "overlay")];
  const userData = String(process.env.OPENWORK_ELECTRON_USERDATA || "").trim();
  if (userData) dirs.push(path.join(userData, "self-evolve-overlay"));
  return dirs;
}

export function cmdOverlaySync({ wodeappx = runtimeWodeappxRoot(), destDirs = overlayDestDirs() } = {}) {
  const srcDir = path.join(wodeappx, "integrations", "openwork", "wodeapp");
  const files = existsSync(srcDir)
    ? readdirSync(srcDir).filter((name) => /^wodeapp-skin-.*\.css$/.test(name))
    : [];
  const copied = [];
  for (const dest of destDirs) {
    mkdirSync(dest, { recursive: true });
    for (const name of files) {
      const to = path.join(dest, name);
      copyFileSync(path.join(srcDir, name), to);
      copied.push(to);
    }
  }
  const report = { ok: true, files: files.length, dests: destDirs, copied: copied.length };
  console.log(JSON.stringify(report, null, 2));
  return report;
}

function cmdVersionCommit(label) {
  ensureVersionRepo();
  vgit(["add", "-f", "--", ...versionPathspecs()]);
  const staged = vgit(["status", "--porcelain"]).split("\n").filter(Boolean);
  if (staged.length === 0) {
    console.log("没有可提交的变化（版本库已是最新）。");
    cmdOverlaySync();
    return;
  }
  const msg = label || `self-evolve ${nowId()}`;
  vgit(["commit", "-m", msg]);
  const hash = vgit(["rev-parse", "--short", "HEAD"]).trim();
  const overlay = cmdOverlaySync();
  console.log(JSON.stringify({ ok: true, version: hash, label: msg, changedFiles: staged.length, overlay }, null, 2));
}

function cmdVersionLog(limit) {
  ensureVersionRepo();
  if (!versionHasCommits()) {
    console.log("版本库还没有任何版本。验证通过后执行：version commit --label \"<说明>\"");
    return;
  }
  const out = vgit(["log", "--oneline", "--decorate", "-n", String(limit)]);
  console.log("自进化版本历史（新的在前）：");
  console.log(out.split("\n").map((l) => `  ${l}`).join("\n"));
}

function cmdVersionRestore(target, flags) {
  ensureVersionRepo();
  if (!versionHasCommits()) throw new Error("版本库为空，无可回退版本。");
  const force = flags.has("--force");

  let full;
  try {
    full = vgit(["rev-parse", "--verify", `${target}^{commit}`]).trim();
  } catch {
    throw new Error(`找不到版本 ${target}，用 version log 查看可用版本。`);
  }
  const head = vgit(["rev-parse", "HEAD"]).trim();
  if (full === head) {
    console.log("目标版本就是当前版本，无需回退。");
    return;
  }

  // 未提交改动防护：只检查纳管路径内的变化（纳管范围外的文件不属于版本库职责）
  const dirty = vgit(["status", "--porcelain", "--", ...versionPathspecs()]).split("\n").filter(Boolean);
  if (dirty.length > 0 && !force) {
    console.error(`拒绝回退：wodeappx 有 ${dirty.length} 项未提交到版本库的变化，回退会覆盖它们。`);
    console.error("请先 version commit 保存当前状态，或人工核对后加 --force。前 10 项：");
    for (const l of dirty.slice(0, 10)) console.error(`  ${l}`);
    process.exit(1);
  }

  // 目标版本中不存在、当前版本中存在的文件：restore 不会自动删，需手动清理。
  // restore/diff 用全树 pathspec（:），避免个别目录在某版本中不存在导致 pathspec 报错；
  // 版本库内容本来就只来自 VERSION_INCLUDE。
  const toDelete = vgit(["diff", "--name-only", "--diff-filter=D", full, head, "--", ":"])
    .split("\n").filter(Boolean);

  // 礼貌模式：存在其他活跃自进化会话时，可能被别人动过的文件跳过恢复/删除。
  // --session <自己的会话ID> 用于区分"别人"和"自己"（不传则保守地把所有登记会话都当作别人）。
  const vrRoot = gitRoot();
  const wxRoot = runtimeWodeappxRoot();
  const selfSessionId = flags.__sessionId || null;
  if (selfSessionId) sessionHeartbeat(vrRoot, selfSessionId);
  const others = force ? [] : otherActiveSessions(vrRoot, selfSessionId);
  const changed = vgit(["diff", "--name-only", full, head, "--", ":"]).split("\n").filter(Boolean);
  const skipped = [];
  const safeChanged = [];
  for (const f of changed) {
    if (possiblyForeign(path.join(wxRoot, f), others)) skipped.push(f);
    else safeChanged.push(f);
  }
  if (others.length > 0) {
    console.log(`礼貌模式：检测到 ${others.length} 个其他活跃自进化会话，${skipped.length} 个可能被他人修改的文件将跳过。`);
  }

  if (skipped.length === 0) {
    vgit(["restore", "--source", full, "--worktree", "--", ":"]);
  } else if (safeChanged.length > 0) {
    vgit(["restore", "--source", full, "--worktree", "--", ...safeChanged]);
  }
  for (const f of toDelete) {
    if (skipped.includes(f)) continue;
    try { rmSync(path.join(wxRoot, f), { force: true }); }
    catch (err) { console.warn(`  警告：删除 ${f} 失败：${err.message}`); }
  }
  if (skipped.length > 0) {
    console.log(`  礼貌跳过 ${skipped.length} 个文件（保持现状，未回退）：`);
    for (const f of skipped.slice(0, 20)) console.log(`    - ${f}`);
    console.log("  确认无他人工作后可加 --force 重新回退。");
  }

  vgit(["add", "-f", "--", ...versionPathspecs()]);
  const targetLabel = vgit(["log", "-1", "--pretty=%s", full]).trim();
  vgit(["commit", "-m", `restore to ${full.slice(0, 8)}: ${targetLabel}`, "--allow-empty"]);
  const newHash = vgit(["rev-parse", "--short", "HEAD"]).trim();
  console.log(JSON.stringify({
    ok: true,
    restoredTo: full.slice(0, 8),
    targetLabel,
    newVersion: newHash,
    deletedFiles: toDelete.length,
    next: "建议立即执行 verify 确认回退后的代码可正常工作。",
  }, null, 2));
}

// ------------------------------------------- worktree（每对话独立代码副本）
// 借鉴 Cursor 后台 Agent / Codex 云端任务的隔离思路：每个自进化对话在影子版本库上
// 开一个独立 worktree（独立分支、独立 node_modules、独立构建产物），互不覆盖；
// 验证满意后 promote 合并回主线。主线树继续走 snapshot/rollback 流程。
const WORKTREES_ROOT = path.join(os.homedir(), ".wodeappx", "worktrees");

/** worktree 管理操作只带 GIT_DIR，不带 GIT_WORK_TREE（避免路径混淆）。 */
function vgitBare(args) {
  return execFileSync("git", args, {
    cwd: runtimeWodeappxRoot(),
    env: { ...process.env, GIT_DIR: versionRepoDir() },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function worktreeIndexPath() {
  return path.join(WORKTREES_ROOT, "worktrees.json");
}

function loadWorktreeIndex() {
  try {
    return JSON.parse(readFileSync(worktreeIndexPath(), "utf8"));
  } catch {
    return { worktrees: [] };
  }
}

function saveWorktreeIndex(idx) {
  mkdirSync(WORKTREES_ROOT, { recursive: true });
  writeFileSync(worktreeIndexPath(), JSON.stringify(idx, null, 2));
}

function worktreeDirty(wtPath) {
  return execFileSync("git", ["-C", wtPath, "status", "--porcelain"], { encoding: "utf8" })
    .split("\n").filter(Boolean);
}

function cmdWorktreeCreate(label) {
  ensureVersionRepo();
  if (!versionHasCommits()) throw new Error("版本库为空，先在主树 version commit 一个基线版本再开 worktree。");
  const idx = loadWorktreeIndex();
  let id = 1;
  while (idx.worktrees.some((w) => w.id === id && w.status !== "removed")
    || existsSync(path.join(WORKTREES_ROOT, `wt-${id}`))) id += 1;
  const dir = path.join(WORKTREES_ROOT, `wt-${id}`);
  const branch = `evolve/wt-${id}`;
  vgitBare(["worktree", "add", "-b", branch, dir, "HEAD"]);
  idx.worktrees.push({
    id, path: dir, branch, label: label || "", status: "active",
    createdAt: new Date().toISOString(),
  });
  saveWorktreeIndex(idx);
  const base = vgitBare(["rev-parse", "--short", "HEAD"]).trim();
  console.log(JSON.stringify({
    ok: true,
    worktreeId: id,
    path: dir,
    branch,
    baseVersion: base,
    next: [
      `cd ${dir}/vendor/openwork && pnpm install   # 约 1 分钟（pnpm store 复用，增量磁盘很小）`,
      `cd ${dir}/vendor/openwork/apps/server && pnpm build   # 首次必须：构建嵌入式服务端（dist 不入版本库）`,
      "# 在这个副本里自由改代码；界面改动后构建：cd vendor/openwork/apps/app && pnpm build",
      `node ${dir}/scripts/self-evolve-guard.mjs verify   # 用 worktree 自己的守卫副本验证`,
      `node ${dir}/scripts/self-evolve-instance.mjs start --root ${dir}   # 从副本起候选实例`,
      `满意后转正：node scripts/self-evolve-guard.mjs worktree promote ${id}`,
      "# 注意：若实例窗口加载了 localhost 开发服务器地址，说明被外部会话导航/干扰，重启实例即可",
    ],
  }, null, 2));
}

function cmdWorktreeList() {
  const idx = loadWorktreeIndex();
  if (idx.worktrees.length === 0) {
    console.log("还没有任何 worktree。创建：worktree create --label \"<说明>\"");
    return;
  }
  console.log("自进化 worktree 列表：");
  for (const w of idx.worktrees) {
    const alive = existsSync(w.path);
    let extra = "";
    if (alive && w.status === "active") {
      const dirty = worktreeDirty(w.path).length;
      extra = dirty > 0 ? `，${dirty} 项未提交` : "，工作区干净";
    }
    console.log(`  wt-${w.id} [${w.status}] ${w.branch}${alive ? "" : "（目录已不存在）"}${extra}`);
    console.log(`      ${w.path}${w.label ? `  —— ${w.label}` : ""}`);
  }
}

function cmdWorktreePromote(id, flags) {
  ensureVersionRepo();
  const idx = loadWorktreeIndex();
  const w = idx.worktrees.find((x) => x.id === id);
  if (!w) throw new Error(`找不到 worktree wt-${id}，用 worktree list 查看。`);
  if (w.status !== "active") throw new Error(`wt-${id} 状态为 ${w.status}，不能 promote。`);
  if (!existsSync(w.path)) throw new Error(`wt-${id} 目录不存在：${w.path}`);

  // 1. worktree 必须先提交干净（或 --commit 自动全量提交）
  const dirty = worktreeDirty(w.path);
  if (dirty.length > 0) {
    if (flags.__commitMsg) {
      execFileSync("git", ["-C", w.path, "add", "-A"], { stdio: "inherit" });
      execFileSync("git", ["-C", w.path, "commit", "-m", flags.__commitMsg], { stdio: "inherit" });
    } else {
      console.error(`拒绝 promote：wt-${id} 有 ${dirty.length} 项未提交改动。`);
      console.error("请先在 worktree 里提交，或加 --commit \"<说明>\" 自动全量提交。前 10 项：");
      for (const l of dirty.slice(0, 10)) console.error(`  ${l}`);
      process.exit(1);
    }
  }

  // 2. 主线有未提交变化时拒绝（礼貌：不覆盖主线他人工作），--force 除外
  const mainDirty = vgit(["status", "--porcelain", "--", ...versionPathspecs()]).split("\n").filter(Boolean);
  if (mainDirty.length > 0 && !flags.has("--force")) {
    console.error(`拒绝 promote：主线有 ${mainDirty.length} 项未提交到版本库的变化，合并会与之纠缠。`);
    console.error("请先 version commit 保存主线状态，或人工核对后加 --force。前 10 项：");
    for (const l of mainDirty.slice(0, 10)) console.error(`  ${l}`);
    process.exit(1);
  }

  // 3. 合并回主线（--no-ff 保留来路，可溯源）
  const msg = `promote wt-${id}${w.label ? `: ${w.label}` : ""}`;
  try {
    vgit(["merge", "--no-ff", w.branch, "-m", msg]);
  } catch (err) {
    console.error("合并冲突：worktree 与主线改到了相同位置。请人工处理：");
    console.error(`  主线树已处于合并中状态，解决冲突后：GIT_DIR=${versionRepoDir()} GIT_WORK_TREE=<wodeappx根> git commit`);
    console.error("  放弃合并：同一环境变量下 git merge --abort");
    throw err;
  }
  w.status = "promoted";
  w.promotedAt = new Date().toISOString();
  saveWorktreeIndex(idx);
  const hash = vgit(["rev-parse", "--short", "HEAD"]).trim();
  console.log(JSON.stringify({
    ok: true,
    promoted: `wt-${id}`,
    newVersion: hash,
    next: [
      "界面改动需在主树重新构建：cd vendor/openwork/apps/app && pnpm build",
      "主进程改动需重启正式版才生效（渲染层刷新即可）",
      `worktree 副本可保留继续用，或清理：worktree remove ${id}`,
    ],
  }, null, 2));
}

function cmdWorktreeRemove(id, flags) {
  const idx = loadWorktreeIndex();
  const w = idx.worktrees.find((x) => x.id === id);
  if (!w) throw new Error(`找不到 worktree wt-${id}。`);
  if (existsSync(w.path)) {
    const dirty = worktreeDirty(w.path);
    if (dirty.length > 0 && !flags.has("--force")) {
      console.error(`拒绝删除：wt-${id} 有 ${dirty.length} 项未提交改动，加 --force 确认丢弃。`);
      process.exit(1);
    }
    vgitBare(["worktree", "remove", "--force", w.path]);
  }
  w.status = "removed";
  w.removedAt = new Date().toISOString();
  saveWorktreeIndex(idx);
  console.log(`已删除 worktree wt-${id}（分支 ${w.branch} 保留在版本库中，历史不丢）。`);
}

// ----------------------------------------------------------------- status
function cmdStatus() {  const root = gitRoot();
  const dir = stateDir(root);
  if (!existsSync(dir)) {
    console.log("还没有任何自进化快照。");
    return;
  }
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort().reverse();
  if (files.length === 0) {
    console.log("还没有任何自进化快照。");
    return;
  }
  console.log("自进化快照（新的在前）：");
  for (const f of files) {
    const s = JSON.parse(readFileSync(path.join(dir, f), "utf8"));
    console.log(`  ${s.id}  ${s.createdAt}  ${s.label || "(无说明)"}  dirty:${s.preExistingDirty.length} untracked:${s.untracked.length}`);
  }
}

// ------------------------------------------------------------------- main
const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
const [, , command, ...rest] = process.argv;
const VALUE_FLAGS = new Set(["--label", "--protect", "--session", "--commit"]);
const flags = new Set(rest.filter((a) => a.startsWith("--") && !VALUE_FLAGS.has(a)));
const positional = [];
let label = "";
const extraRoots = [];
for (let i = 0; i < rest.length; i += 1) {
  const a = rest[i];
  if (a === "--label") { label = rest[i + 1] || ""; i += 1; }
  else if (a === "--protect") { if (rest[i + 1]) extraRoots.push(rest[i + 1]); i += 1; }
  else if (a === "--session") { flags.__sessionId = rest[i + 1] || null; i += 1; }
  else if (a === "--commit") { flags.__commitMsg = rest[i + 1] || ""; i += 1; }
  else if (!a.startsWith("--")) positional.push(a);
}

try {
  switch (command) {
    case "snapshot":
      cmdSnapshot(label, extraRoots);
      break;
    case "verify":
      cmdVerify(flags);
      break;
    case "rollback":
      if (!positional[0]) throw new Error("rollback 需要快照 ID，例如：rollback 20260729-153000");
      cmdRollback(positional[0], flags);
      break;
    case "status":
      cmdStatus();
      break;
    case "session": {
      const sub = positional[0];
      const root = gitRoot();
      if (sub === "list") {
        const dir = sessionsDir(root);
        const now = Date.now();
        const rows = [];
        if (existsSync(dir)) {
          for (const name of readdirSync(dir)) {
            if (!name.endsWith(".json")) continue;
            try {
              const s = JSON.parse(readFileSync(path.join(dir, name), "utf8"));
              rows.push({
                id: s.id,
                beganAt: new Date(s.beganAt).toLocaleString(),
                活跃: now - (s.heartbeat || 0) <= SESSION_TTL_MS ? "是" : "否（已过期，回滚时自动忽略）",
              });
            } catch { /* 忽略 */ }
          }
        }
        console.log(rows.length === 0 ? "当前没有登记中的自进化会话。" : rows);
      } else if (sub === "end") {
        const target = positional[1];
        const dir = sessionsDir(root);
        if (flags.has("--all")) {
          let n = 0;
          if (existsSync(dir)) {
            for (const name of readdirSync(dir)) {
              if (name.endsWith(".json")) { rmSync(path.join(dir, name), { force: true }); n += 1; }
            }
          }
          console.log(`已清理 ${n} 个会话登记。`);
        } else if (!target) {
          throw new Error("session end 需要会话 ID，或 --all 清理全部");
        } else {
          rmSync(path.join(dir, `${target}.json`), { force: true });
          console.log(`已结束会话 ${target}。`);
        }
      } else {
        throw new Error("session 子命令：list / end <id|--all>");
      }
      break;
    }
    case "overlay":
      if (positional[0] !== "sync") throw new Error("overlay 子命令：sync");
      cmdOverlaySync();
      break;
    case "version": {
      const sub = positional[0];
      if (sub === "commit") cmdVersionCommit(label);
      else if (sub === "log") {
        const limitIdx = rest.indexOf("--limit");
        cmdVersionLog(limitIdx >= 0 ? Number(rest[limitIdx + 1]) || 20 : 20);
      }
      else if (sub === "restore") {
        if (!positional[1]) throw new Error("version restore 需要版本号，例如：version restore a1b2c3d4");
        cmdVersionRestore(positional[1], flags);
      }
      else throw new Error("version 子命令：commit / log / restore");
      break;
    }
    case "worktree": {
      const sub = positional[0];
      if (sub === "create") cmdWorktreeCreate(label);
      else if (sub === "list") cmdWorktreeList();
      else if (sub === "promote") {
        if (!positional[1]) throw new Error("worktree promote 需要 ID，例如：worktree promote 1 [--commit \"说明\"] [--force]");
        cmdWorktreePromote(Number(positional[1]), flags);
      }
      else if (sub === "remove") {
        if (!positional[1]) throw new Error("worktree remove 需要 ID，例如：worktree remove 1 [--force]");
        cmdWorktreeRemove(Number(positional[1]), flags);
      }
      else throw new Error("worktree 子命令：create / list / promote / remove");
      break;
    }
    default:
      console.log(`用法：
  node scripts/self-evolve-guard.mjs snapshot --label "<改动说明>" [--protect <额外保护的相对路径>]
  node scripts/self-evolve-guard.mjs verify [--skip-typecheck] [--skip-patch-test] [--skip-skin-contrast]
  node scripts/self-evolve-guard.mjs rollback <snapshot-id> [--dry-run] [--force]
  node scripts/self-evolve-guard.mjs status
  node scripts/self-evolve-guard.mjs session list
  node scripts/self-evolve-guard.mjs session end <id|--all>
  node scripts/self-evolve-guard.mjs overlay sync
  node scripts/self-evolve-guard.mjs version commit --label "<说明>"
  node scripts/self-evolve-guard.mjs version log [--limit N]
  node scripts/self-evolve-guard.mjs version restore <commit> [--force] [--session <id>]
  node scripts/self-evolve-guard.mjs worktree create --label "<说明>"
  node scripts/self-evolve-guard.mjs worktree list
  node scripts/self-evolve-guard.mjs worktree promote <id> [--commit "<说明>"] [--force]
  node scripts/self-evolve-guard.mjs worktree remove <id> [--force]`);
      process.exit(command ? 2 : 0);
  }
} catch (err) {
  console.error(`self-evolve-guard 失败：${err.message}`);
  process.exit(1);
}
}
