import { randomUUID } from "node:crypto";
import { spawnSync, type SpawnOptions } from "node:child_process";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const MANAGED_GENERATION_ENV = "WODEAPPX_RUNTIME_GENERATION_ID";

export interface ManagedProcessGeneration {
  generationId: string;
  ownerKind: "server";
  supervisorPid: number;
  rootPid: number | null;
  processGroupId: number | null;
  startedAt: number;
  executablePath: string;
  cwd: string;
  platform: NodeJS.Platform;
}

interface TerminateOptions {
  platform?: NodeJS.Platform;
  killImpl?: typeof process.kill;
  spawnSyncImpl?: typeof spawnSync;
  wait?: (ms: number) => Promise<void>;
  termGraceMs?: number;
  killGraceMs?: number;
}

export function createManagedProcessGeneration(
  program: string,
  cwd: string,
  options: { id?: string; now?: () => number; platform?: NodeJS.Platform } = {},
): ManagedProcessGeneration {
  return {
    generationId: options.id ?? randomUUID(),
    ownerKind: "server",
    supervisorPid: process.pid,
    rootPid: null,
    processGroupId: null,
    startedAt: (options.now ?? Date.now)(),
    executablePath: program,
    cwd,
    platform: options.platform ?? process.platform,
  };
}

export function attachManagedProcessGeneration(
  generation: ManagedProcessGeneration,
  pid: number | undefined,
  platform: NodeJS.Platform = process.platform,
): ManagedProcessGeneration {
  if (!Number.isInteger(pid) || Number(pid) <= 0) {
    throw new Error("Managed OpenCode did not return a valid root PID");
  }
  generation.rootPid = Number(pid);
  generation.processGroupId = platform === "win32" ? null : Number(pid);
  return generation;
}

export function managedProcessSpawnOptions(
  generation: ManagedProcessGeneration,
  options: SpawnOptions,
  platform: NodeJS.Platform = process.platform,
): SpawnOptions {
  return {
    ...options,
    detached: platform !== "win32",
    windowsHide: true,
    env: {
      ...(options.env ?? process.env),
      [MANAGED_GENERATION_ENV]: generation.generationId,
    },
  };
}

function signal(killImpl: typeof process.kill, target: number, signalName: NodeJS.Signals | 0): boolean {
  try {
    killImpl(target, signalName);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ESRCH") return false;
    throw error;
  }
}

function exists(killImpl: typeof process.kill, target: number): boolean {
  try {
    killImpl(target, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}

export async function terminateManagedProcessGeneration(
  generation: ManagedProcessGeneration,
  options: TerminateOptions = {},
): Promise<{ terminated: boolean; escalated: boolean }> {
  const rootPid = Number(generation.rootPid);
  if (!Number.isInteger(rootPid) || rootPid <= 0) return { terminated: true, escalated: false };
  const platform = options.platform ?? process.platform;
  const wait = options.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const termGraceMs = options.termGraceMs ?? 1_000;
  const killGraceMs = options.killGraceMs ?? 500;

  if (platform === "win32") {
    const spawnSyncImpl = options.spawnSyncImpl ?? spawnSync;
    spawnSyncImpl("taskkill", ["/PID", String(rootPid), "/T"], { windowsHide: true, stdio: "ignore" });
    await wait(termGraceMs);
    const forced = spawnSyncImpl("taskkill", ["/PID", String(rootPid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return { terminated: forced.status === 0 || forced.status === 128, escalated: true };
  }

  const killImpl = options.killImpl ?? process.kill.bind(process);
  const target = -Math.abs(Number(generation.processGroupId ?? rootPid));
  if (!signal(killImpl, target, "SIGTERM")) return { terminated: true, escalated: false };
  await wait(termGraceMs);
  if (!exists(killImpl, target)) return { terminated: true, escalated: false };
  signal(killImpl, target, "SIGKILL");
  await wait(killGraceMs);
  return { terminated: !exists(killImpl, target), escalated: true };
}

function managedGenerationRoot(env: NodeJS.ProcessEnv = process.env): string {
  const override = String(env.OPENWORK_DATA_DIR ?? "").trim();
  if (override) return join(override, "runtime-generations");
  const xdgState = String(env.XDG_STATE_HOME ?? "").trim();
  return join(xdgState || join(homedir(), ".local", "state"), "openwork", "runtime-generations");
}

function recordPath(generation: ManagedProcessGeneration, env?: NodeJS.ProcessEnv): string {
  return join(managedGenerationRoot(env), `${generation.generationId}.json`);
}

export async function persistManagedProcessGeneration(
  generation: ManagedProcessGeneration,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  const root = managedGenerationRoot(env);
  await mkdir(root, { recursive: true });
  await writeFile(recordPath(generation, env), `${JSON.stringify(generation, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function forgetManagedProcessGeneration(
  generation: ManagedProcessGeneration,
  env?: NodeJS.ProcessEnv,
): Promise<void> {
  await rm(recordPath(generation, env), { force: true });
}

function ownedPids(generation: ManagedProcessGeneration, spawnSyncImpl: typeof spawnSync): number[] {
  if (!generation.processGroupId) return [];
  const rows = spawnSyncImpl("ps", ["-Ao", "pid=,pgid="], { encoding: "utf8" });
  if (rows.status !== 0) return [];
  return String(rows.stdout ?? "")
    .split(/\r?\n/)
    .map((row) => row.trim().match(/^(\d+)\s+(\d+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .filter((match) => Number(match[2]) === generation.processGroupId)
    .map((match) => Number(match[1]))
    .filter((pid) => {
      if (pid <= 0 || pid === process.pid) return false;
      const command = spawnSyncImpl("ps", ["eww", "-p", String(pid), "-o", "command="], { encoding: "utf8" });
      return command.status === 0 &&
        String(command.stdout ?? "").includes(`${MANAGED_GENERATION_ENV}=${generation.generationId}`);
    });
}

export async function cleanupPersistedManagedProcessGenerations(
  env: NodeJS.ProcessEnv = process.env,
  options: TerminateOptions = {},
): Promise<{ cleaned: number; retained: number }> {
  const root = managedGenerationRoot(env);
  let names: string[];
  try {
    names = (await readdir(root)).filter((name) => name.endsWith(".json"));
  } catch {
    return { cleaned: 0, retained: 0 };
  }
  let cleaned = 0;
  let retained = 0;
  const platform = options.platform ?? process.platform;
  const spawnSyncImpl = options.spawnSyncImpl ?? spawnSync;
  const killImpl = options.killImpl ?? process.kill.bind(process);
  const wait = options.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  for (const name of names) {
    const file = join(root, name);
    let generation: ManagedProcessGeneration;
    try {
      generation = JSON.parse(await readFile(file, "utf8")) as ManagedProcessGeneration;
    } catch {
      await rm(file, { force: true });
      continue;
    }
    if (platform === "win32") {
      retained += 1;
      continue;
    }
    if (generation.supervisorPid && generation.supervisorPid !== process.pid && exists(killImpl, generation.supervisorPid)) {
      retained += 1;
      continue;
    }
    const pids = ownedPids(generation, spawnSyncImpl);
    for (const pid of pids) signal(killImpl, pid, "SIGTERM");
    if (pids.length > 0) await wait(options.termGraceMs ?? 1_000);
    const remaining = ownedPids(generation, spawnSyncImpl);
    for (const pid of remaining) signal(killImpl, pid, "SIGKILL");
    if (remaining.length > 0) await wait(options.killGraceMs ?? 500);
    if (ownedPids(generation, spawnSyncImpl).length === 0) {
      await rm(file, { force: true });
      cleaned += 1;
    } else {
      retained += 1;
    }
  }
  return { cleaned, retained };
}
