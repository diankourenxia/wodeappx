import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePs, selectSweepTargets } from "./self-evolve-sweep.mjs";

const DIST = "/repo/wodeappx/vendor/openwork/node_modules/.pnpm/electron@39.8.5/node_modules/electron/dist";
const SIDECARS = "/repo/wodeappx/vendor/openwork/apps/desktop/resources/sidecars";
const INSTANCE = "/Users/me/.wodeappx/instances/candidate-2";

const ROOTS = { sidecarsDir: SIDECARS, electronDistDir: DIST, instanceRoot: INSTANCE };

function psRow(pid, ppid, args) {
  return `${String(pid).padStart(6)} ${String(ppid).padStart(3)}  ${args}`;
}

test("parsePs 解析 pid/ppid/args，容忍前导空白", () => {
  const rows = parsePs(`${psRow(100, 1, "/bin/sidecar serve --port 1")}\n${psRow(200, 100, "/usr/bin/node x.js")}\n`);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { pid: 100, ppid: 1, args: "/bin/sidecar serve --port 1" });
  assert.deepEqual(rows[1], { pid: 200, ppid: 100, args: "/usr/bin/node x.js" });
});

test("孤儿 sidecar（PPID=1，路径在 sidecars 目录下）被选中", () => {
  const rows = parsePs(psRow(501, 1, `${SIDECARS}/opencode-aarch64-apple-darwin serve --port 63864`));
  const targets = selectSweepTargets(rows, ROOTS, 999);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].reason, "sidecar");
});

test("有活父进程的 sidecar（PPID≠1）不清", () => {
  const rows = parsePs(psRow(502, 60003, `${SIDECARS}/opencode-aarch64-apple-darwin serve --port 63864`));
  assert.equal(selectSweepTargets(rows, ROOTS, 999).length, 0);
});

test("孤儿 Electron helper（路径含空格也匹配）被选中", () => {
  const helper = `${DIST}/WodeAppX.app/Contents/Frameworks/Electron Helper (Renderer).app/Contents/MacOS/Electron Helper (Renderer)`;
  const rows = parsePs(psRow(503, 1, helper));
  const targets = selectSweepTargets(rows, ROOTS, 999);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].reason, "electron-helper");
});

test("孤儿 Electron 主进程不清：detached 候选实例主进程 PPID 合法为 1", () => {
  const mainBin = `${DIST}/WodeAppX.app/Contents/MacOS/WodeAppX`;
  const rows = parsePs(psRow(504, 1, mainBin));
  assert.equal(selectSweepTargets(rows, ROOTS, 999).length, 0);
});

test("引用实例目录的孤儿残留被选中", () => {
  const rows = parsePs(psRow(505, 1, `node /tmp/agent-runner.js --user-data=${INSTANCE}/user-data`));
  const targets = selectSweepTargets(rows, ROOTS, 999);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].reason, "instance-leftover");
});

test("无关孤儿进程（如 Cursor helper）绝不清", () => {
  const rows = parsePs(psRow(506, 1, "/Applications/Cursor.app/Contents/Frameworks/Cursor Helper.app/Contents/MacOS/Cursor Helper"));
  assert.equal(selectSweepTargets(rows, ROOTS, 999).length, 0);
});

test("调用方自身 pid 永不入选", () => {
  const rows = parsePs(psRow(507, 1, `${SIDECARS}/opencode serve`));
  assert.equal(selectSweepTargets(rows, ROOTS, 507).length, 0);
});

test("roots 某项为 null 时跳过对应类别", () => {
  const rows = parsePs(`${psRow(508, 1, `${SIDECARS}/opencode serve`)}\n${psRow(509, 1, `node x --dir=${INSTANCE}`)}`);
  const targets = selectSweepTargets(rows, { sidecarsDir: null, electronDistDir: null, instanceRoot: INSTANCE }, 999);
  assert.deepEqual(targets.map((t) => t.pid), [509]);
});
